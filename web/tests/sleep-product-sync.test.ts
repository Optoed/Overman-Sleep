import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {SleepApiError} from '../lib/sleep-api';
import {createSleepProductSync,sleepProductSyncMessage} from '../lib/sleep-product-sync';
import {freshSleep,recordNight,parseSleep,SLEEP_KEY,type SleepState} from '../components/sleep/sleep-state';
import {persistSleepProductState,readSleepProductState} from '../components/sleep/sleep-product-storage';
import {openSleepSyncArchive,inspectSleepSyncArchive} from '../lib/sleep-sync-archive';
const owner=randomUUID(),password='fictional-password-only',origin='http://127.0.0.1:3902',reply=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}}),empty=()=>({protocolVersion:1 as const,garden:false,credits:[] as string[],deletedCredits:[] as string[],dates:[] as {date:string;revision:number;night:SleepState['nights'][0]|null}[]});
const wake=Date.parse('2026-06-01T07:30:00+03:00'),input={bed:wake-510*60000,wake,bedOffset:180,wakeOffset:180,sleepMinutes:480,rested:3};
function setup(initial:string|null=JSON.stringify(freshSleep())){let raw=initial,state=raw?readSleepProductState(raw)!:freshSleep(),readonly=false,fail=false,who:string=owner,snapshot=empty(),saved=0;const calls:string[]=[],store={getItem:(key:string)=>{assert.equal(key,SLEEP_KEY);return raw;},setItem:(key:string,next:string)=>{assert.equal(key,SLEEP_KEY);if(fail)throw Error('Disk');raw=next;}};
 const fetcher:typeof fetch=async(input,init)=>{const path=new URL(String(input)).pathname;calls.push(path);if(path==='/v1/auth/login'||path==='/v1/auth/register')return reply({protocolVersion:1,userId:who,username:JSON.parse(String(init?.body)).login,token:'a'.repeat(43),expiresAt:Date.now()+86400000});if(path==='/v1/auth/logout')return reply({signedOut:true});if(path==='/v1/session')return reply({userId:who});if(path==='/v1/diary')return reply(snapshot);throw Error('Unexpected test route');};
 const make=()=>createSleepProductSync({getStorage:()=>store,getState:()=>state,assertWritable:()=>{if(readonly)throw Error('Read only');},onSaved:s=>{state=s;saved++;},allowLoopbackHttp:true,fetch:fetcher});const c=make();const login=async()=>{c.configure(origin);await c.signIn('login','qa_user',password);};return{c,make,store,calls,login,get raw(){return raw;},get state(){return state;},set state(v:SleepState){state=v;},get saved(){return saved;},set readonly(v:boolean){readonly=v;},set fail(v:boolean){fail=v;},set who(v:string){who=v;},set snapshot(v:ReturnType<typeof empty>){snapshot=v;}};
}

test('product sync controller: sign-in/compare/discard never materialize an absent diary; first explicit approval writes diary+origin+owner once',async()=>{
 const s=setup(null);await s.login();assert.equal(s.raw,null);assert.equal(s.saved,0);await s.c.compare();assert.equal(s.raw,null);s.c.discard();assert.equal(s.raw,null);await s.c.compare();assert.throws(()=>s.c.approve(false));assert.equal(s.raw,null);s.c.approve(true);
 assert.equal(s.saved,1);assert.equal(s.state.revision,1);const binding=inspectSleepSyncArchive(s.store);assert.equal(binding?.ownerId,owner);assert.equal(binding?.serverOrigin,origin);assert.equal(binding?.pending,0);assert(!s.raw!.includes(password));assert(!s.raw!.includes('token'));assert.equal(s.make().view().profile,null);assert.equal(s.make().view().binding?.serverOrigin,origin);
});

test('product sync controller: link approval only queues reviewed local nights; does not send them automatically',async()=>{
 const s=setup(JSON.stringify(recordNight(freshSleep(),input)));await s.login();const before=s.raw;const view=await s.c.compare();assert.equal(view.review?.uploads.length,1);assert.equal(s.raw,before);s.c.approve(true);assert.equal(inspectSleepSyncArchive(s.store)?.pending,1);assert(!s.calls.includes('/v1/diary/operations'));
 await s.c.logout();const raw=s.raw;const saved=persistSleepProductState(s.store,SLEEP_KEY,s.state,{...s.state,theme:'light'});s.state=saved;assert.equal(inspectSleepSyncArchive(s.store)?.serverOrigin,origin);assert.equal(inspectSleepSyncArchive(s.store)?.pending,1);assert.notEqual(s.raw,raw);
});

test('product sync controller: another account or server cannot receive an existing diary',async()=>{
 const s=setup();await s.login();await s.c.compare();s.c.approve(true);await s.c.logout();const raw=s.raw,calls=s.calls.length;assert.throws(()=>s.c.configure('https://other.example'),/другим сервером/);assert.equal(s.calls.length,calls);s.who=randomUUID();await assert.rejects(s.c.signIn('login','qa_other',password),/другим аккаунтом/);assert.equal(s.c.view().profile,null);assert.equal(s.raw,raw);assert.equal(s.calls.filter(p=>p==='/v1/diary').length,1);
});

test('product sync controller: read-only/active night prohibit network; user confirmation cannot overwrite changed diary or failed disk',async()=>{
 const s=setup();s.readonly=true;assert.throws(()=>s.c.configure(origin));assert.equal(s.calls.length,0);s.readonly=false;await s.login();await s.c.compare();s.state=persistSleepProductState(s.store,SLEEP_KEY,s.state,{...s.state,theme:'light'});const raw=s.raw;assert.throws(()=>s.c.approve(true));assert.equal(s.raw,raw);assert.equal(s.saved,0);
 await s.c.compare();s.fail=true;assert.throws(()=>s.c.approve(true));assert.equal(s.raw,raw);s.fail=false;s.state={...s.state,active:{started:wake,target:s.state.schedule}};const count=s.calls.length;await assert.rejects(s.c.compare(),/текущую ночь/);assert.equal(s.calls.length,count);
});

test('product sync controller: old origin-less archive cannot send before a separately confirmed server link',async()=>{
 const s=setup();const tx=openSleepSyncArchive(s.store,owner);tx.storage.setItem(SLEEP_KEY,JSON.stringify(tx.diary));tx.commit(owner);s.state=readSleepProductState(s.raw)!;await s.login();const count=s.calls.length;await assert.rejects(s.c.sendNext(),/Сначала сравни/);assert.equal(s.calls.length,count);await s.c.compare();s.c.approve(true);assert.equal(inspectSleepSyncArchive(s.store)?.serverOrigin,origin);
});

test('product sync controller: unverified earned dates block apply without fabricating a successful night',async()=>{
 const base=freshSleep(),s=setup(JSON.stringify({...base,credits:['2020-01-01'],deletedCredits:['2020-01-01']}));await s.login();const raw=s.raw,view=await s.c.compare();assert.deepEqual(view.review?.unverifiedCredits,['2020-01-01']);assert.throws(()=>s.c.approve(true));assert.equal(s.raw,raw);assert.equal(s.saved,0);
});

test('product sync controller: concurrent change has explicit local/server choices, retaining device settings and permanent reward',async()=>{
 const local=recordNight(freshSleep(),input),s=setup(JSON.stringify(local));s.snapshot={protocolVersion:1,garden:false,credits:[local.nights[0].date],deletedCredits:[],dates:[{date:local.nights[0].date,revision:3,night:{...local.nights[0],note:'Remote note'}}]};await s.login();let view=await s.c.compare();assert.equal(view.conflicts.length,1);assert.throws(()=>s.c.approve(true));view=await s.c.compare();s.c.choose(local.nights[0].date,'server');assert.equal(s.c.view().review!.conflicts.length,0);s.c.approve(true);assert.equal(s.state.nights[0].note,'Remote note');assert.deepEqual(s.state.schedule,local.schedule);assert.equal(s.state.credits.length,1);
});

test('product sync controller: invalid or credential-bearing origins send nothing; error messages do not expose arbitrary failures',()=>{
 const s=setup();for(const value of ['http://example.com','https://user:secret@example.com','https://example.com/path','https://example.com/?secret=1'])assert.throws(()=>s.c.configure(value));assert.equal(s.calls.length,0);assert(!sleepProductSyncMessage(Error(password)).includes(password));
 const native=createSleepProductSync({getStorage:()=>s.store,getState:()=>s.state,assertWritable:()=>{},onSaved:()=>{}});assert.throws(()=>native.configure(origin));assert.equal(s.calls.length,0);
});

test('product sync controller: stored origin is immutable, validated on cold read and preserved through paused local capture',async()=>{
 const s=setup();await s.login();await s.c.compare();s.c.approve(true);const tx=openSleepSyncArchive(s.store,owner);assert.throws(()=>tx.bindServerOrigin('https://other.example'));tx.pauseImport({id:randomUUID(),sourceSha256:'a'.repeat(64)});tx.commit(owner);s.state=readSleepProductState(s.raw)!;const before=JSON.parse(s.raw!)._sleepSync;s.state=persistSleepProductState(s.store,SLEEP_KEY,s.state,recordNight(s.state,input));assert.deepEqual(JSON.parse(s.raw!)._sleepSync,before);const raw=s.raw;await assert.rejects(s.c.compare(),/незавершённый перенос/);assert.equal(s.raw,raw);
 const invalid=JSON.parse(raw!);invalid._sleepSync.serverOrigin='https://user:secret@example.com';s.store.setItem(SLEEP_KEY,JSON.stringify(invalid));assert.throws(()=>readSleepProductState(s.raw));assert.throws(()=>inspectSleepSyncArchive(s.store));
});
test('product sync controller: queued transport errors retain a useful redacted authentication/network message',()=>{assert.match(sleepProductSyncMessage(Error('Queue',{cause:new SleepApiError('network')})),/Сервер недоступен/);assert.match(sleepProductSyncMessage(Error('Queue',{cause:new SleepApiError('authentication')})),/Войди снова/);});
