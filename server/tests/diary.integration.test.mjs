import{test}from'node:test';import assert from'node:assert/strict';import{randomUUID,randomBytes,createHash}from'node:crypto';
import{spawnSync}from'node:child_process';import{writeFile}from'node:fs/promises';import{databasePool}from'../src/database.mjs';
const base=process.env.OVERMAN_API_TEST_URL||'http://127.0.0.1:3902',hash=t=>createHash('sha256').update(t).digest();
if(!['http://127.0.0.1:3901','http://127.0.0.1:3902'].includes(base))throw Error('Tests require the isolated loopback Overman API');
function night(date='2026-06-01',note='Alice test record'){
 const wake=Date.parse(date+'T07:30:00+03:00');return{date,bed:wake-510*60000,wake,bedOffset:180,wakeOffset:180,
  bedClock:'23:00',wakeClock:'07:30',sleepMinutes:480,rested:3,target:{bed:'23:00',wake:'07:30',hours:8,tolerance:45},success:true,note};
}
test('05.02 real Go HTTP API + dedicated PostgreSQL: authentication, concurrency, retries and restart',async t=>{
 const admin=databasePool({admin:true}),runtime=databasePool();admin.on('error',()=>{});runtime.on('error',()=>{});
 const checks=[];
 try{
  const health=await(await fetch(base+'/health')).json();assert.equal(health.runtime,'go');assert.equal(health.database,'postgresql');
  async function identity({expired=false,revoked=false}={}){
   const id=randomUUID(),token=randomBytes(32).toString('base64url');
   await admin.query('insert into overman.users(id) values($1)',[id]);
   await admin.query("insert into overman.sessions values($1,$2,now()+($3::int*interval '1 hour'),$4)",[hash(token),id,expired?-1:24,revoked]);return{id,token};
  }
  const alice=await identity(),bob=await identity(),expired=await identity({expired:true}),revoked=await identity({revoked:true});
  const call=async(user,path='/v1/diary',body,options={})=>{
   const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(user?{Authorization:'Bearer '+user.token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...options.headers},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json()};
  };
  const save=(user,n,rev,op=randomUUID(),date=n?.date??'2026-06-01')=>call(user,'/v1/diary/operations',{operationId:op,date,expectedRevision:rev,night:n,expectedOwnerId:user.id});
  await t.test('real opaque sessions, expiry/revocation, owner guard and private DB permissions',async()=>{
   for(const u of [null,expired,revoked,{token:randomBytes(32).toString('base64url')}])assert.equal((await call(u)).status,401);
   assert.deepEqual((await call(alice,'/v1/session')).body,{userId:alice.id});assert.deepEqual((await call(bob)).body.dates,[]);
   assert.equal((await call(alice,'/v1/diary/operations',{operationId:randomUUID(),date:'2026-06-01',expectedRevision:0,night:night(),expectedOwnerId:bob.id})).status,403);
   await assert.rejects(runtime.query('select * from overman.sessions'),e=>e.code==='42501');
   await assert.rejects(runtime.query('select * from public.sleep_diary_dates'),e=>e.code==='42501');
   assert.equal((await runtime.query('select overman.request_owner() owner')).rows[0].owner,null);
   checks.push('Real session verification, expired/revoked/anonymous rejection, owner guard, restricted runtime role');
  });
  const initial=night(),op=randomUUID();
  await t.test('discarded committed response and twenty parallel replays produce one credit',async()=>{
   const dropped=await fetch(base+'/v1/diary/operations',{method:'POST',headers:{Authorization:'Bearer '+alice.token,'Content-Type':'application/json'},
    body:JSON.stringify({operationId:op,date:initial.date,expectedRevision:0,night:initial,expectedOwnerId:alice.id})});
   assert.equal(dropped.status,200);await dropped.body.cancel(); // Commit occurred; client discards its response body.
   const repeats=await Promise.all(Array.from({length:20},()=>save(alice,initial,0,op)));
   for(const r of repeats){assert.equal(r.status,200);assert.deepEqual(r.body.credits,[initial.date]);assert.equal(r.body.dates[0].revision,1);}
   checks.push('Actual HTTP response discarded after commit; twenty concurrent duplicate requests: one record/credit');
  });
  await t.test('competing distinct operations have one winner; reuse with changed payload fails',async()=>{
   const results=await Promise.all([save(alice,{...initial,rested:1},1),save(alice,{...initial,rested:2},1)]);
   assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
   assert.equal((await save(alice,{...initial,note:'Changed UUID content'},0,op)).status,409);
   const retried=await save(alice,initial,0,op);assert.equal(retried.body.dates[0].revision,2);assert.equal(retried.body.credits.length,1);
   checks.push('Real concurrent connections: distinct stale writes yield one success/one conflict; immutable operation IDs');
  });
  await t.test('server rule, deletion, stale replay and re-add retain the same earned credit',async()=>{
   const bad=await save(alice,{...initial,sleepMinutes:100,success:true},2);assert.equal(bad.body.dates[0].night.success,false);assert.equal(bad.body.credits.length,1);
   const removed=await save(alice,null,3);assert.equal(removed.body.dates[0].night,null);assert.deepEqual(removed.body.deletedCredits,[initial.date]);
   const replay=await save(alice,initial,0,op);assert.equal(replay.body.dates[0].night,null);
   const restored=await save(alice,initial,4);assert.equal(restored.status,200);assert.equal(restored.body.credits.length,1);
   checks.push('Server recomputes reward-v1; delete/re-add and old request replay preserve one earned date');
  });
  await t.test('two real accounts stay isolated across pooled HTTP requests',async()=>{
   assert.equal((await save(bob,night('2026-06-01','Bob private test record'),0,op)).status,200);
   for(const r of await Promise.all(Array.from({length:20},async(_,i)=>({user:i%2?alice:bob,result:await call(i%2?alice:bob)})))){
    assert.equal(r.result.status,200);assert.equal(r.result.body.dates[0].night.note,r.user===alice?'Alice test record':'Bob private test record');
   }
   assert.equal((await call(expired)).status,401);checks.push('Two opaque sessions and pooled requests cannot read or write each other');
  });
  await t.test('HTTP boundary rejects oversized/invalid/foreign-origin input without leaking SQL details',async()=>{
   assert.equal((await call(alice,'/v1/diary',undefined,{headers:{Origin:'https://untrusted.invalid'}})).status,403);
   assert.equal((await call(alice,'/v1/diary/operations',{operationId:"'; drop table overman.users;--",date:'2026-06-02',expectedRevision:0,night:night('2026-06-02'),expectedOwnerId:alice.id})).status,422);
   const large=await call(alice,'/v1/diary/operations',{padding:'x'.repeat(70000)});assert.ok([400,413].includes(large.status));
   const invalid=await save(alice,{...night('2026-06-02'),bedClock:'04:00'},0);assert.equal(invalid.status,422);assert.deepEqual(Object.keys(invalid.body),['error']);
   assert.equal((await call(alice)).body.dates.length,1);checks.push('Bounded JSON, invalid clocks/UUIDs, foreign origins rejected; no SQL/credential response details');
  });
  await t.test('SQL failure after reward insert rolls back diary and receipt; same ID retries once',async()=>{
   const f='overman_test_write_failure',day='2026-05-07',id=randomUUID();
   await admin.query(`create function public.${f}() returns trigger language plpgsql as $$begin if new.wake_date=date '${day}' then raise exception 'Controlled test failure';end if;return new;end$$;
    create trigger ${f} before insert or update on public.sleep_diary_dates for each row execute function public.${f}();`);
   try{assert.equal((await save(alice,night(day),0,id)).status,422);
    assert.ok(!(await call(alice)).body.dates.some(d=>d.date===day));
    assert.equal((await admin.query('select count(*)::int n from public.sleep_reward_receipts where user_id=$1 and operation_id=$2',[alice.id,id])).rows[0].n,0);
   }finally{await admin.query(`drop trigger ${f} on public.sleep_diary_dates;drop function public.${f}()`);}
   const retry=await save(alice,night(day),0,id);assert.equal(retry.status,200);assert.equal(retry.body.credits.filter(d=>d===day).length,1);
   checks.push('Real PostgreSQL transaction rolls back controlled post-ledger write error; same UUID then succeeds once');
  });
  await t.test('dedicated database container restart retains both accounts and committed ledger',async()=>{
   const beforeA=(await call(alice)).body,beforeB=(await call(bob)).body;
   const label=spawnSync('docker',['inspect','--format','{{index .Config.Labels "app.overman.role"}}','overman-postgres-dev'],{encoding:'utf8',windowsHide:true});
   assert.equal(label.stdout.trim(),'dev-db');
   const restart=spawnSync('docker',['restart','overman-postgres-dev'],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(restart.status,0);
   let ready=false;for(let i=0;i<40;i++){try{if((await fetch(base+'/health')).status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
   assert.equal(ready,true);assert.deepEqual((await call(alice)).body,beforeA);assert.deepEqual((await call(bob)).body,beforeB);
   checks.push('Only labelled Overman PostgreSQL container restarted; persistent volume and both account snapshots retained');
  });
  const version=(await admin.query('show server_version')).rows[0].server_version;
  await writeFile(new URL('../../docs/product-evidence/05.02-owned-postgres-20261109-http.json',import.meta.url),JSON.stringify({result:'passed',verifiedAt:new Date().toISOString(),runtime:'Go',database:'PostgreSQL '+version,baseUrl:base,checks,scope:'Real loopback HTTP and isolated Docker PostgreSQL, real opaque test sessions and concurrent requests. No public deployment, real phone or installed-app sync claimed. Tokens/passwords deliberately excluded.'},null,2)+'\n');
 }finally{await admin.end();await runtime.end();}
});
