import{test}from'node:test';import assert from'node:assert/strict';import{randomBytes,randomUUID,createHash}from'node:crypto';import{readFileSync,writeFileSync,mkdirSync,renameSync,readdirSync}from'node:fs';import{join}from'node:path';import{spawnSync}from'node:child_process';
import{databasePool}from'../src/database.mjs';import{createSleepAccount}from'../../web/lib/sleep-auth';import{createSleepApi}from'../../web/lib/sleep-api';import{freshSleep,recordNight,SLEEP_KEY}from'../../web/components/sleep/sleep-state';import{openSleepSyncArchive}from'../../web/lib/sleep-sync-archive';import{persistSleepSyncEdit}from'../../web/lib/sleep-sync-edit';import{prepareSleepSyncPull,prepareSleepSyncUpload}from'../../web/lib/sleep-sync-engine';
const base='http://127.0.0.1:3902',root=join('server','.local','account-qa-'+randomUUID()),checks:string[]=[];mkdirSync(root,{recursive:true});
const role=spawnSync('docker',['inspect','--format','{{index .Config.Labels "app.overman.role"}}','overman-api-dev'],{encoding:'utf8',windowsHide:true});assert.equal(role.stdout.trim(),'dev-api');
class Archive{readonly path:string;constructor(name:string){this.path=join(root,name+'.json');writeFileSync(this.path,JSON.stringify(freshSleep()),{flag:'wx'});}getItem(key:string){assert.equal(key,SLEEP_KEY);return readFileSync(this.path,'utf8');}setItem(key:string,raw:string){assert.equal(key,SLEEP_KEY);const tmp=this.path+'.next';writeFileSync(tmp,raw);renameSync(tmp,this.path);}get raw(){return this.getItem(SLEEP_KEY);}}
const name=()=>('qa_'+randomUUID().replaceAll('-','').slice(0,20));
test('05.02 own-account HTTP login + real Go/PostgreSQL + diary retry across two filesystem clients',async t=>{
 const admin=databasePool({admin:true,max:1}),runtime=databasePool({max:1});admin.on('error',()=>{});runtime.on('error',()=>{});
 try{
 const username=name(),otherName=name(),password=randomBytes(24).toString('base64url'),alice=createSleepAccount({baseUrl:base,allowLoopbackHttp:true}),bob=createSleepAccount({baseUrl:base,allowLoopbackHttp:true});let aliceId='',bobId='';
 const post=async(path:string,value:unknown,token?:string)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(value)});
 const diary=(account:ReturnType<typeof createSleepAccount>,fetcher:typeof fetch=fetch)=>createSleepApi({baseUrl:base,allowLoopbackHttp:true,getSession:account.getSession,fetch:fetcher});
 const A=new Archive('client-a'),B=new Archive('client-b');
 await t.test('register uses own HTTP account creation; same password has independent salts/hashes and empty isolated diaries',async()=>{
  const a=await alice.register(username.toUpperCase(),password),b=await bob.register(otherName,password);aliceId=a.userId;bobId=b.userId;assert(aliceId!==bobId);assert.equal(a.username,username);assert.ok(!Object.hasOwn(a,'token'));
  assert.deepEqual((await diary(alice).readSnapshot()).snapshot.dates,[]);assert.deepEqual((await diary(bob).readSnapshot()).snapshot.dates,[]);
  const metadata=(await admin.query("select count(distinct encode(salt,'hex'))::int salts,count(distinct encode(digest,'hex'))::int hashes,min(octet_length(salt))::int salt_bytes,min(octet_length(digest))::int hash_bytes from overman.credentials where login=any($1::text[])",[[username,otherName]])).rows[0];assert.deepEqual(metadata,{salts:2,hashes:2,salt_bytes:32,hash_bytes:32});
  await assert.rejects(runtime.query('select * from overman.credentials'),e=>e.code==='42501');
  checks.push('Two actual HTTP registrations, no admin-created sessions: same synthetic password yields different32-byte salts/Argon2 digests; separate empty owner diaries; trusted runtime still has no direct credential-table read');
 });
 await t.test('lost diary commit reply survives logout/new own-account login and cold UUID retry; second file restores one reward',async()=>{
  const api=diary(alice),link=await prepareSleepSyncPull(A,aliceId,api);link.approve(true,aliceId);const tx=openSleepSyncArchive(A,aliceId),before=tx.diary;tx.abort();const wake=Date.parse('2026-06-01T07:30:00+03:00');persistSleepSyncEdit(A,aliceId,before,recordNight(before,{bed:wake-510*60000,wake,bedOffset:180,wakeOffset:180,sleepMinutes:480,rested:3,note:'Synthetic account diary'},Date.now()));
  let lost=false;const lossy=diary(alice,async(input,init)=>{const r=await fetch(input,init);if(String(input).endsWith('/operations')&&!lost){lost=true;await r.body?.cancel();throw Error('Discard committed diary reply');}return r;});const pending=A.raw;await assert.rejects(prepareSleepSyncUpload(A,aliceId,lossy));assert.equal(A.raw,pending);
  // A fresh controller logs in through the actual password route, not SQL fixtures.
  const fresh=createSleepAccount({baseUrl:base,allowLoopbackHttp:true});const profile=await fresh.login(username,password);assert.equal(profile.userId,aliceId);assert.equal(A.raw,pending);
  const uploaded=await prepareSleepSyncUpload(A,aliceId,diary(fresh));assert.ok(uploaded);uploaded.approve(true,aliceId);const restored=await prepareSleepSyncPull(B,aliceId,diary(fresh));restored.approve(true,aliceId);const cold=openSleepSyncArchive(B,aliceId);assert.equal(cold.diary.credits.length,1);assert.equal(cold.diary.nights.length,1);assert.equal(cold.queue.operations.length,0);cold.abort();
  assert.ok(!A.raw.includes(password)&&!B.raw.includes(password));await fresh.logout();assert.equal(fresh.getSession(),null);assert.equal((await diary(alice).readSnapshot()).snapshot.credits.length,1);
  checks.push('Actual password login in fresh memory controller resumes durable old diary UUID after lost post-commit reply; second filesystem client restores one night/credit; logout revokes only that session and leaves original session/archive intact');
 });
 await t.test('logout revokes exactly its bearer; expired session rejects; diary bytes and unrelated account stay intact',async()=>{
  const account=createSleepAccount({baseUrl:base,allowLoopbackHttp:true});await account.login(username,password);const own=account.getSession()!,old=A.raw;
  await account.logout();assert.equal(account.getSession(),null);assert.equal((await fetch(base+'/v1/session',{headers:{Authorization:'Bearer '+own.token}})).status,401);assert.equal(A.raw,old);assert.deepEqual((await diary(bob).readSnapshot()).snapshot.dates,[]);
  const expiring=createSleepAccount({baseUrl:base,allowLoopbackHttp:true});await expiring.login(username,password);const digest=createHash('sha256').update(expiring.getSession()!.token).digest();await admin.query("update overman.sessions set expires_at=now()-interval '1 second' where token_hash=$1",[digest]);await assert.rejects(diary(expiring).readSnapshot(),e=>e instanceof Error&&'code'in e&&e.code==='authentication');assert.equal(A.raw,old);
  checks.push('Actual logout invalidates exactly its opaque bearer; controlled synthetic expiry rejects401; other account, prior valid session and both diary archives remain intact');
 });
 await t.test('registration SQL failure rolls back account/credentials/session; same name retries without an orphan user',async()=>{
  const badName=name(),fn='overman_test_auth_failure',count=async()=>Number((await admin.query('select count(*)::text n from overman.users')).rows[0].n),before=await count();
  await admin.query(`create function overman.${fn}() returns trigger language plpgsql as $$begin if new.login='${badName}' then raise exception 'Controlled auth failure';end if;return new;end$$;create trigger ${fn} after insert on overman.credentials for each row execute function overman.${fn}();`);
  try{const r=await post('/v1/auth/register',{login:badName,password});assert.equal(r.status,503);const body=await r.json();assert.deepEqual(body,{error:'authentication_unavailable'});assert.equal(await count(),before);}finally{await admin.query(`drop trigger ${fn} on overman.credentials;drop function overman.${fn}()`);}
  const retry=createSleepAccount({baseUrl:base,allowLoopbackHttp:true});await retry.register(badName,password);assert.equal(await count(),before+1);await retry.logout();
  checks.push('Controlled real AFTER INSERT credential fault rolls back user/credential/session together; response is redacted503; same username then registers once without orphan user');
 });
 await t.test('fixed auth routes reject caller-owned IDs, malformed input, foreign origins and unknown logout fields',async()=>{
  assert.equal((await post('/v1/auth/register',{login:name(),password,userId:randomUUID()})).status,400);assert.equal((await post('/v1/auth/login',{login:username,password:'short'})).status,422);
  assert.equal((await fetch(base+'/v1/auth/login')).status,405);assert.equal((await post('/v1/auth/unknown',{})).status,404);
  const wrong=await fetch(base+'/v1/auth/register',{method:'POST',headers:{Origin:'https://untrusted.invalid','Content-Type':'application/json'},body:JSON.stringify({login:name(),password})});assert.equal(wrong.status,403);
  const token=alice.getSession()!.token;assert.equal((await post('/v1/auth/logout',{token:'not accepted'},token)).status,400);assert.equal((await post('/v1/auth/logout',{})).status,401);assert.equal((await diary(alice).readSnapshot()).snapshot.credits.length,1);
  const duplicate=await post('/v1/auth/register',{login:username,password});assert.equal(duplicate.status,409);assert.deepEqual(await duplicate.json(),{error:'account_unavailable'});
  checks.push('Actual strict fixed routes: caller userId400, short password422, wrong method405, unknown path404, foreign Origin403, unknown logout body400/missing bearer401; duplicate name409 cannot replace account');
 });
 await t.test('Unicode password keeps exact spaces and characters; chunked logout with extra fields cannot revoke bearer',async()=>{
  const account=createSleepAccount({baseUrl:base,allowLoopbackHttp:true}),login=name(),secret='🌙'.repeat(15)+' exact spaces ';await account.register(login,secret);const fresh=createSleepAccount({baseUrl:base,allowLoopbackHttp:true});await fresh.login(login,secret);
  const bad=await post('/v1/auth/login',{login,password:secret.trim()});assert.equal(bad.status,401);
  const token=account.getSession()!.token,body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"unexpected":true}'));c.close();}});
  const response=await fetch(base+'/v1/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body,duplex:'half'} as RequestInit);assert.equal(response.status,400);assert.deepEqual((await diary(account).readSnapshot()).snapshot.dates,[]);await fresh.logout();await account.logout();
  checks.push('Actual Unicode/space-sensitive password verifies only exact input; chunked unknown-field logout400 leaves authenticated bearer valid');
 });
 await t.test('known and unknown login failures have the same generic401 and both persist a five-attempt lock',async()=>{
  const missing=name(),wrongPassword=randomBytes(24).toString('base64url');for(const login of[username,missing]){for(let i=0;i<5;i++){const r=await post('/v1/auth/login',{login,password:wrongPassword});assert.equal(r.status,401);assert.deepEqual(await r.json(),{error:'invalid_credentials'});}const blocked=await post('/v1/auth/login',{login,password});assert.equal(blocked.status,429);}
  assert.equal((await diary(alice).readSnapshot()).snapshot.credits.length,1);
  checks.push('Actual Argon2 verification for known/unknown valid-shape passwords gives identical redacted401; five consecutive failures lock both names, sixth returns429; existing session/diary remains usable');
 });
 await t.test('database restart retains credential ownership, lock and issued-session diary access',async()=>{
  const label=spawnSync('docker',['inspect','--format','{{index .Config.Labels "app.overman.role"}}','overman-postgres-dev'],{encoding:'utf8',windowsHide:true});assert.equal(label.stdout.trim(),'dev-db');const restart=spawnSync('docker',['restart','overman-postgres-dev'],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(restart.status,0);let ready=false;for(let i=0;i<40;i++){try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert(ready);
  assert.equal((await post('/v1/auth/login',{login:username,password})).status,429);assert.equal((await diary(alice).readSnapshot()).snapshot.credits.length,1);assert.deepEqual((await diary(bob).readSnapshot()).snapshot.dates,[]);
  checks.push('Only labelled own PostgreSQL restarted: password-account ownership, persistent failure lock and issued bearer access survive; two owner diaries retain exact separation');
 });
 writeFileSync('docs/product-evidence/05.02-own-auth-20261109-real.json',JSON.stringify({requirementId:'05.02',result:'passed',verifiedAt:new Date().toISOString(),checks:checks.map(name=>({name,passed:true})),archiveDirectory:root,archiveFiles:readdirSync(root).filter(f=>!f.endsWith('.next')),baseUrl:base,
  scope:'Actual own Go/PostgreSQL HTTP registration/login/password verification/revocation and two synthetic filesystem clients. No admin-seeded sessions for new auth scenarios. Passwords/tokens/digests never exported; aggregate hash metadata only. Controlled response/SQL/expiry faults labelled. No product UI/native Android/physical phone or production deployment claim.'},null,2)+'\n');
 }finally{await admin.end();await runtime.end();}
});