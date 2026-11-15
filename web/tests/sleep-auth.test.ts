import{test}from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import{createSleepAccount,SleepAuthError}from'../lib/sleep-auth';
const owner=randomUUID(),password='fictional-password-only',at=Date.parse('2026-11-09T01:00:00Z');
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const session=(name='qa_user',id=owner,token='a'.repeat(43))=>({protocolVersion:1,userId:id,username:name,token,expiresAt:at+86400000});
const make=(fetcher:typeof fetch,extra:Record<string,unknown>={})=>createSleepAccount({baseUrl:'http://127.0.0.1:3902',allowLoopbackHttp:true,fetch:fetcher,now:()=>at,...extra});
const code=(expected:string)=>(e:unknown)=>e instanceof SleepAuthError&&e.code===expected;
test('05.02 account SDK stores session only in its instance; profile excludes credentials and transport disables cookies/cache/redirects',async()=>{
 const calls:{url:string;init:RequestInit}[]=[],a=make(async(input,init)=>{calls.push({url:String(input),init:init!});return reply(session());});const profile=await a.register(' QA_USER ',password);
 assert.deepEqual(profile,{userId:owner,username:'qa_user',expiresAt:at+86400000});assert.equal(a.getSession()!.ownerId,owner);assert.ok(!JSON.stringify(profile).includes(password));assert.ok(!Object.hasOwn(profile,'token'));
 const clone=a.getSession()!;clone.ownerId=randomUUID();assert.equal(a.getSession()!.ownerId,owner);assert.equal(make(async()=>reply({})).getSession(),null);
 assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith('/auth/register'));assert.deepEqual(JSON.parse(String(calls[0].init.body)),{login:'qa_user',password});
 for(const {init}of calls){assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.referrerPolicy,'no-referrer');}
});
test('05.02 account SDK invalid config/input sends nothing; Unicode password length counts code points',async()=>{
 let calls=0;const f:typeof fetch=async()=>{calls++;return reply(session());};assert.throws(()=>createSleepAccount({baseUrl:'http://example.com',fetch:f}),code('configuration'));
 const a=make(f);for(const [name,pwd]of[['ab',password],['qa_user','short'],['кириллица',password],['qa_user','a'.repeat(129)]])await assert.rejects(a.login(name,pwd),code('invalid_input'));assert.equal(calls,0);
 await a.login('qa_user','🌙'.repeat(15));assert.equal(calls,1);
});
test('05.02 account SDK malformed/expired/oversized receipts preserve existing account',async()=>{
 let raw:unknown=session(),a=make(async()=>reply(raw));await a.login('qa_user',password);
 for(const bad of [{...session(),extra:true},{...session(),username:'other'},{...session(),userId:'bad'},{...session(),token:'short'},{...session(),expiresAt:at},{...session(),expiresAt:String(at+86400000)},{...session(),expiresAt:at+40*86400000},{...session(),padding:'x'.repeat(3000)}]){raw=bad;await assert.rejects(a.login('qa_user',password),code('invalid_response'));assert.equal(a.getSession()!.ownerId,owner);}
});
test('05.02 logout clears memory even if server revocation fails and never changes a diary',async()=>{
 let fail=false,calls=0;const a=make(async(input)=>{calls++;if(String(input).endsWith('/logout')){assert(fail);throw Error(password);}return reply(session());});await a.login('qa_user',password);fail=true;
 await assert.rejects(a.logout(),e=>code('unavailable')(e)&&!(e as Error).message.includes(password));assert.equal(a.getSession(),null);assert.equal(a.getProfile(),null);assert.equal(calls,2);
});
test('05.02 a late sign-in after logout cannot restore a session and its returned token is revoked',async()=>{
 let release:(r:Response)=>void=()=>{},revoked=0;const a=make(async input=>String(input).endsWith('/logout')?(revoked++,reply({signedOut:true})):new Promise<Response>(r=>{release=r;}));
 const pending=a.login('qa_user',password);await a.logout();release(reply(session()));await assert.rejects(pending,code('cancelled'));assert.equal(a.getSession(),null);assert.equal(revoked,1);
});
test('05.02 latest sign-in wins; stale different-account response cannot replace it',async()=>{
 let release:(r:Response)=>void=()=>{},revoked=0;const other=randomUUID(),a=make(async(input,init)=>{if(String(input).endsWith('/logout')){revoked++;return reply({signedOut:true});}const body=JSON.parse(String(init!.body));return body.login==='qa_first'?new Promise<Response>(r=>{release=r;}):reply(session('qa_second',other,'b'.repeat(43)));});
 const first=a.login('qa_first',password);await a.login('qa_second',password);release(reply(session('qa_first')));await assert.rejects(first,code('cancelled'));assert.equal(a.getSession()!.ownerId,other);assert.equal(revoked,1);
});
test('05.02 auth failures and aborted network errors never echo response/password; expiry removes available session',async()=>{
 for(const [status,expected]of[[401,'invalid_credentials'],[409,'name_unavailable'],[429,'limited']]as const){const a=make(async()=>reply({private:password},status));await assert.rejects(a.login('qa_user',password),e=>code(expected)(e)&&!(e as Error).message.includes(password));}
 let clock=at;const a=make(async()=>reply(session()),{now:()=>clock});await a.login('qa_user',password);clock+=2*86400000;assert.equal(a.getSession(),null);assert.equal(a.getProfile(),null);
 const aborted=new AbortController();aborted.abort();await assert.rejects(make(async()=>{throw Error(password);}).login('qa_user',password,aborted.signal),code('cancelled'));
});