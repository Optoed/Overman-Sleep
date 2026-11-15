import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {readSleepProductState,persistSleepProductState,assertSleepLocalRestoreAllowed,restoreSleepProductState} from '../components/sleep/sleep-product-storage';
import {freshSleep,recordNight,beginNight,captureWake,deleteNight,SLEEP_KEY,type SleepState} from '../components/sleep/sleep-state';
import {backupText,readBackup} from '../components/sleep/sleep-insights';
import {createSleepStorage,type ArchiveBridge} from '../components/sleep/sleep-storage';
import {openSleepSyncArchive} from '../lib/sleep-sync-archive';
import {prepareSleepSyncPull} from '../lib/sleep-sync-engine';
import {recoverPausedSleepImport} from '../lib/sleep-sync-import';
const owner=randomUUID(),wake=Date.parse('2026-06-01T07:30:00+03:00'),input={bed:wake-510*60000,wake,bedOffset:180,wakeOffset:180,sleepMinutes:480,rested:3,note:'Synthetic writer test'};
function file(initial:string|null=JSON.stringify(freshSleep())){let raw=initial,writes=0,fail=false;return{getItem:(_key:string)=>raw,setItem:(_key:string,v:string)=>{if(fail)throw Error('Disk full');raw=v;writes++;},get raw(){return raw;},get writes(){return writes;},set fail(v:boolean){fail=v;}};}
const read=(s:ReturnType<typeof file>)=>readSleepProductState(s.raw)!;
const server=()=>({ownerId:owner,snapshot:{protocolVersion:1 as const,garden:false,credits:[],deletedCredits:[],dates:[]}});
async function link(s:ReturnType<typeof file>){const p=await prepareSleepSyncPull(s,owner,{readSnapshot:async()=>server(),rpc:async()=>{throw Error('No send');}});p.approve(true,owner);}
function pause(s:ReturnType<typeof file>,kind:'import'|'legacy'){const tx=openSleepSyncArchive(s,owner),op=randomUUID();if(kind==='import')tx.pauseImport({id:op,sourceSha256:'a'.repeat(64)});else tx.beginLegacyMigration({operationId:op,dates:['2020-01-01'],garden:false});tx.commit(owner);return JSON.parse(s.raw!)._sleepSync;}

test('product writer: existing local data remains readable; metadata from a caller or backup never binds a local diary',()=>{
 const s=file(),before=read(s),forged={...recordNight(before,input),_sleepSync:{ownerId:owner,token:'synthetic marker'}} as SleepState;
 const saved=persistSleepProductState(s,SLEEP_KEY,before,forged);assert.equal(saved.revision,1);assert.equal(saved.credits.length,1);assert.ok(!s.raw!.includes('_sleepSync'));assert.deepEqual(read(s),saved);
 const imported=readBackup(JSON.stringify(forged));assert.ok(!JSON.stringify(imported).includes('_sleepSync'));assert.ok(!backupText(forged).includes(owner));assert.equal(JSON.parse(backupText(forged)).state.nights[0].note,input.note);
});

test('product writer: logged-out offline saves preserve reviewed owner, baseline and immutable UUID through correction, deletion and cold read',async()=>{
 const s=file();await link(s);const before=read(s),writes=s.writes;let saved=persistSleepProductState(s,SLEEP_KEY,before,recordNight(before,input));
 assert.equal(s.writes,writes+1);assert.equal(saved.revision,before.revision+1);const original=JSON.parse(s.raw!)._sleepSync;
 saved=persistSleepProductState(s,SLEEP_KEY,saved,{...saved,nights:saved.nights.map(n=>({...n,note:'Offline correction'}))});
 saved=persistSleepProductState(s,SLEEP_KEY,saved,deleteNight(saved,saved.nights[0]));const cold=openSleepSyncArchive(s,owner);
 assert.deepEqual(cold.queue,original.queue);assert.equal(cold.queue.operations.length,1);assert.equal(cold.queue.operations[0].night!.note,input.note);assert.equal(cold.diary.credits.length,1);assert.equal(cold.diary.nights.length,0);assert.deepEqual(cold.baseline,original.baseline);cold.abort();assert.ok(!JSON.stringify(read(s)).includes('_sleepSync'));
});

for(const kind of ['import','legacy'] as const)test('product writer: '+kind+' pause does not block start/wake/morning; old intent/queue preserved and no send or UUID generated',async()=>{
 const s=file();await link(s);let saved=persistSleepProductState(s,SLEEP_KEY,read(s),recordNight(read(s),input));const old=pause(s,kind),newWake=wake+86400000;
 const save=(next:SleepState)=>saved=persistSleepProductState(s,SLEEP_KEY,read(s),next,()=>{throw Error('Paused edits must not enqueue');});
 save(beginNight(read(s),newWake-510*60000));assert.ok(saved.active);save(captureWake(read(s),newWake));assert.equal(saved.active!.wokeAt,newWake);
 save({...recordNight(read(s),{...input,bed:newWake-510*60000,wake:newWake}),active:null});assert.equal(saved.nights.length,2);assert.equal(saved.credits.length,2);
 assert.deepEqual(JSON.parse(s.raw!)._sleepSync,old);assert.equal(read(s).active,null);assert.equal(read(s).credits.length,2);
 const original=s.raw;assert.throws(()=>persistSleepProductState(s,SLEEP_KEY,read(s),{...read(s),credits:[],nights:[],deletedCredits:[]}),/прогресс/);assert.equal(s.raw,original);
});

test('product writer: migration before first account review preserves new local nights without implicit linking or network',()=>{
 const s=file(),old=pause(s,'legacy'),saved=persistSleepProductState(s,SLEEP_KEY,read(s),recordNight(read(s),input),()=>{throw Error('No UUID before review');});
 assert.equal(saved.nights.length,1);assert.deepEqual(JSON.parse(s.raw!)._sleepSync,old);assert.equal(JSON.parse(s.raw!)._sleepSync.baseline,null);
});

test('product writer: any earlier pull or paused recovery preview fails after a newer local save',async()=>{
 const s=file();await link(s);let p=await prepareSleepSyncPull(s,owner,{readSnapshot:async()=>server(),rpc:async()=>{throw Error('No send');}});
 persistSleepProductState(s,SLEEP_KEY,read(s),{...read(s),theme:'light'});const raw=s.raw;assert.throws(()=>p.approve(true,owner),/archive changed/);assert.equal(s.raw,raw);
 pause(s,'import');const recovery=await recoverPausedSleepImport(s,owner,{readSnapshot:async()=>server(),cancelOperation:async()=>{throw Error('No pending operations');}},{getOwnerId:()=>owner,backupOriginal:()=>{}});
 persistSleepProductState(s,SLEEP_KEY,read(s),recordNight(read(s),input));const newRaw=s.raw;assert.throws(()=>recovery.approve(true),/archive changed/);assert.equal(s.raw,newRaw);assert.equal(read(s).nights.length,1);
});

test('product writer: paused original recovery reopens newest diary and queues the captured night once under a fresh UUID',async()=>{
 const s=file();await link(s);pause(s,'import');persistSleepProductState(s,SLEEP_KEY,read(s),recordNight(read(s),input));
 const recovery=await recoverPausedSleepImport(s,owner,{readSnapshot:async()=>server(),cancelOperation:async()=>{throw Error('No pending operations');}},{getOwnerId:()=>owner,backupOriginal:()=>{}});const saved=recovery.approve(true);
 const tx=openSleepSyncArchive(s,owner);assert.equal(tx.importPause,null);assert.equal(tx.queue.operations.length,1);assert.equal(tx.queue.operations[0].date,saved.nights[0].date);assert.equal(tx.diary.credits.length,1);tx.abort();
});

test('product writer: malformed durable binding never silently falls back to a local overwrite',async()=>{
 const s=file();await link(s);const valid=read(s),root=JSON.parse(s.raw!);for(const bad of [null,{version:9},{...root._sleepSync,ownerId:randomUUID()},{...root._sleepSync,unknown:'marker'}]){
 s.setItem(SLEEP_KEY,JSON.stringify({...root,_sleepSync:bad}));const raw=s.raw;assert.throws(()=>read(s));assert.throws(()=>persistSleepProductState(s,SLEEP_KEY,valid,valid));assert.equal(s.raw,raw);assert.throws(()=>assertSleepLocalRestoreAllowed(s.raw),/связан/);
 }
});

test('product writer: disk rejection, stale same-revision input and invalid queue UUID retain complete original archive',async()=>{
 for(const fault of ['disk','stale','uuid']){const s=file();await link(s);const before=read(s),next=recordNight(before,input);if(fault==='disk')s.fail=true;if(fault==='stale')s.setItem(SLEEP_KEY,JSON.stringify({...JSON.parse(s.raw!),theme:'light'}));const raw=s.raw;
 assert.throws(()=>persistSleepProductState(s,SLEEP_KEY,before,next,()=>fault==='uuid'?'invalid':randomUUID()));assert.equal(s.raw,raw);}
});

test('product writer: native CAS stays authoritative during mirror failure and a second writer cannot replace it',async()=>{
 const initial=file();await link(initial);let disk=initial.raw!,reject=false;const bridge:ArchiveBridge={readSleepArchive:()=>JSON.stringify({raw:disk}),writeSleepArchive:(_key,expected,next)=>{if(reject)return 'Disk full';if(expected!==disk)return 'Conflict';disk=next;return '';}};
 const mirror=()=>({getItem:()=>null,setItem:()=>{throw Error('Quota');},removeItem:()=>{},clear:()=>{},key:()=>null,length:0});
 const a=createSleepStorage(mirror(),bridge),b=createSleepStorage(mirror(),bridge),before=readSleepProductState(a.getItem(SLEEP_KEY))!;b.getItem(SLEEP_KEY);
 const saved=persistSleepProductState(a,SLEEP_KEY,before,recordNight(before,input));assert.deepEqual(readSleepProductState(createSleepStorage(mirror(),bridge).getItem(SLEEP_KEY)),saved);
 const raw=disk;assert.throws(()=>persistSleepProductState(b,SLEEP_KEY,before,{...before,theme:'light'}));assert.equal(disk,raw);reject=true;assert.throws(()=>persistSleepProductState(a,SLEEP_KEY,saved,{...saved,theme:'light'}));assert.equal(disk,raw);assert.equal(JSON.parse(disk)._sleepSync.queue.operations.length,1);
});

test('product writer: linked restore is blocked; local damaged recovery works and rechecks archive after asynchronous native preparation',async()=>{
 const s=file();await link(s);const raw=s.raw;assert.throws(()=>restoreSleepProductState(s,SLEEP_KEY,raw,freshSleep()),/связан/);assert.equal(s.raw,raw);
 const local=file('{broken original');assertSleepLocalRestoreAllowed(local.raw);const recovered=restoreSleepProductState(local,SLEEP_KEY,local.raw,freshSleep());assert.equal(recovered.nights.length,0);
 const original=local.raw;local.setItem(SLEEP_KEY,JSON.stringify({...recovered,theme:'light'}));const changed=local.raw;assert.throws(()=>restoreSleepProductState(local,SLEEP_KEY,original,recovered),/изменилось/);assert.equal(local.raw,changed);
 const imported=readBackup(raw!);assert.ok(!JSON.stringify(imported).includes(owner));const empty=file();restoreSleepProductState(empty,SLEEP_KEY,empty.raw,imported);assert.ok(!empty.raw!.includes('_sleepSync'));
});

test('product writer: demo key cannot create an account binding from source metadata',async()=>{
 const s=file();await link(s);const key=SLEEP_KEY+'.demo',state=readSleepProductState(s.raw,key)!;const saved=persistSleepProductState(s,key,state,{...state,theme:'light'});assert.equal(saved.theme,'light');assert.ok(!s.raw!.includes('_sleepSync'));
});