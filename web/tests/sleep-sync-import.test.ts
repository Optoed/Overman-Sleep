import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {prepareSleepSyncImport,resumeSleepSyncImport,recoverPausedSleepImport} from '../lib/sleep-sync-import';
import {openSleepSyncArchive,readSleepImportPause} from '../lib/sleep-sync-archive';
import {prepareSleepSyncPull,prepareSleepSyncUpload} from '../lib/sleep-sync-engine';
import {persistSleepSyncEdit} from '../lib/sleep-sync-edit';
import {freshSleep,recordNight,defaultAlarm,SLEEP_KEY,type SleepState} from '../components/sleep/sleep-state';
import type {SleepSnapshot,SleepOperation} from '../lib/sleep-sync-queue';
import type {SleepCancellationReceipt} from '../lib/sleep-api';
const owner=randomUUID(),wake=Date.parse('2026-06-01T07:30:00+03:00');
const empty=():SleepSnapshot=>({protocolVersion:1,garden:false,credits:[],deletedCredits:[],dates:[]});
function file(){let raw=JSON.stringify(freshSleep()),writes=0;return{fail:false,backupFail:false,backup:null as string|null,
 getItem:(key:string)=>{assert.equal(key,SLEEP_KEY);return raw;},
 setItem(key:string,v:string){assert.equal(key,SLEEP_KEY);if(this.fail)throw Error('Disk full');raw=v;writes++;},
 async backupOriginal(value:string){if(this.backupFail)throw Error('Backup failed');this.backup=value;},
 get raw(){return raw;},get writes(){return writes;}};}
function transport(snapshot=empty(),applied=false){return{snapshot,calls:[] as SleepOperation[],
 readSnapshot:async()=>({ownerId:owner,snapshot:structuredClone(snapshot)}),
 async cancelOperation(op:SleepOperation):Promise<SleepCancellationReceipt>{this.calls.push(structuredClone(op));return{protocolVersion:1,ownerId:owner,operationId:op.operationId,cancelled:!applied,snapshot:structuredClone(snapshot)};}};}
async function fixture(){const s=file(),c=transport();const link=await prepareSleepSyncPull(s,owner,{...c,rpc:async()=>{throw Error('Must not send');}});link.approve(true,owner);
 let tx=openSleepSyncArchive(s,owner),before=tx.diary;tx.abort();
 const next=recordNight(before,{bed:wake-510*60000,wake,bedOffset:180,wakeOffset:180,sleepMinutes:480,rested:3,note:'Original'},Date.now());
 persistSleepSyncEdit(s,owner,before,next);tx=openSleepSyncArchive(s,owner);const original=tx.diary,op=tx.queue.operations[0];tx.abort();
 const source={...structuredClone(original),theme:'light',nights:original.nights.map(n=>({...n,note:'Imported'})),alarm:{...(original.alarm??defaultAlarm),enabled:true,reminder:true}} as SleepState;
 const options={getOwnerId:()=>owner,backupOriginal:(raw:string)=>s.backupOriginal(raw)};
 return{s,c,original,op,source,options};}

test('05.02 import preparation reads only; explicit pause approval backs up original and blocks normal sends',async()=>{
 const {s,c,source,options}=await fixture(),before=s.raw,writes=s.writes;
 const p=await prepareSleepSyncImport(s,owner,source,c,options);assert.equal(s.raw,before);assert.equal(c.calls.length,0);assert.equal(s.backup,null);
 const exposed=p.pending;exposed.length=0;assert.equal(p.pending.length,1);
 await assert.rejects(p.start(false),/explicit approval/);assert.equal(s.writes,writes);
 const ready=await p.start(true);assert.equal(s.backup,before);assert.equal(s.writes,writes+1);assert.equal(c.calls.length,1);
 assert.ok(readSleepImportPause(s,owner));assert.throws(()=>openSleepSyncArchive(s,owner),/Import is paused/);
 await assert.rejects(prepareSleepSyncUpload(s,owner,{...c,rpc:async()=>{throw Error('Must not send');}}),/Import is paused/);
 assert.throws(()=>ready.approve(false),/final approval/);
 const fenced=s.raw;ready.discard();assert.equal(s.raw,fenced);
});

test('05.02 confirmed import retires only cancelled UUID; diary/new queue/baseline share one final commit',async()=>{
 const {s,c,source,op,options}=await fixture(),p=await prepareSleepSyncImport(s,owner,{...source,_sleepSync:{ownerId:randomUUID(),token:'fixture-only'}} as SleepState,c,options);
 const ready=await p.start(true),writes=s.writes;const data=ready.review;data.next.nights=[];assert.equal(ready.review.next.nights.length,1);
 const saved=ready.approve(true);assert.equal(s.writes,writes+1);assert.equal(saved.nights[0].note,'Imported');assert.equal(saved.theme,'light');assert.equal(saved.active,null);
 assert.equal(saved.alarm!.enabled,false);assert.equal(saved.alarm!.reminder,false);assert.equal(saved.credits.length,1);assert.equal(readSleepImportPause(s,owner),null);
 const tx=openSleepSyncArchive(s,owner);assert.equal(tx.queue.operations.length,1);assert.notEqual(tx.queue.operations[0].operationId,op.operationId);assert.equal(tx.queue.operations[0].expectedRevision,0);assert.equal(tx.baseline!.snapshot.dates.length,0);tx.abort();
 assert.ok(!s.raw.includes('fixture-only'));assert.throws(()=>ready.review,/closed/);
});

test('05.02 applied receipt preserves one earned date and queues imported edit at actual revision',async()=>{
 const f=await fixture(),snapshot={...empty(),credits:[f.op.date],dates:[{date:f.op.date,revision:1,night:f.op.night}]},c=transport(snapshot,true);
 const p=await prepareSleepSyncImport(f.s,owner,f.source,c,f.options),ready=await p.start(true);ready.approve(true);
 const tx=openSleepSyncArchive(f.s,owner);assert.equal(tx.queue.operations[0].expectedRevision,1);assert.equal(tx.diary.credits.length,1);assert.equal(tx.diary.nights[0].note,'Imported');assert.equal(tx.baseline!.snapshot.dates[0].revision,1);tx.abort();
});

test('05.02 lost cancellation response leaves durable pause; cold resume retries same UUID and same source only',async()=>{
 const f=await fixture();let lose=true;const c={...f.c,cancelOperation:async(op:SleepOperation)=>{const receipt=await f.c.cancelOperation(op);if(lose){lose=false;throw Error('Lost committed response');}return receipt;}};
 const p=await prepareSleepSyncImport(f.s,owner,f.source,c,f.options);await assert.rejects(p.start(true),/Lost committed/);const fenced=f.s.raw;
 assert.ok(readSleepImportPause(f.s,owner));await assert.rejects(resumeSleepSyncImport(f.s,owner,f.original,c,f.options),/same import file/);assert.equal(f.s.raw,fenced);
 const ready=await resumeSleepSyncImport(f.s,owner,f.source,c,f.options);assert.equal(f.c.calls.length,2);assert.deepEqual(f.c.calls[0],f.c.calls[1]);ready.approve(true);
 assert.equal(readSleepImportPause(f.s,owner),null);assert.ok(!f.s.raw.includes('sourceSha256'));
});

test('05.02 discarding after cancellation requires explicit original recovery with a fresh pending UUID',async()=>{
 const f=await fixture(),p=await prepareSleepSyncImport(f.s,owner,f.source,f.c,f.options),ready=await p.start(true);ready.discard();
 const recovery=await recoverPausedSleepImport(f.s,owner,f.c,f.options);assert.equal(recovery.kind,'recover_original');recovery.approve(true);
 const tx=openSleepSyncArchive(f.s,owner);assert.equal(tx.diary.nights[0].note,'Original');assert.equal(tx.diary.theme,f.original.theme);assert.notEqual(tx.queue.operations[0].operationId,f.op.operationId);assert.equal(tx.queue.operations.length,1);tx.abort();
});

test('05.02 final disk failure retains entire paused archive; cold retry commits after receipts again',async()=>{
 const f=await fixture(),p=await prepareSleepSyncImport(f.s,owner,f.source,f.c,f.options),ready=await p.start(true),fenced=f.s.raw;
 f.s.fail=true;assert.throws(()=>ready.approve(true),/Disk full/);assert.equal(f.s.raw,fenced);f.s.fail=false;
 const again=await resumeSleepSyncImport(f.s,owner,f.source,f.c,f.options);again.approve(true);assert.equal(f.c.calls.length,2);assert.equal(readSleepImportPause(f.s,owner),null);
});

test('05.02 owner change and competing file change cannot complete an import after cancellation',async()=>{
 for(const fault of ['owner','file'] as const){const f=await fixture();let active=owner;const options={...f.options,getOwnerId:()=>active};
 const p=await prepareSleepSyncImport(f.s,owner,f.source,f.c,options),ready=await p.start(true);let expected=f.s.raw;
 if(fault==='owner')active=randomUUID();else{f.s.setItem(SLEEP_KEY,JSON.stringify({...JSON.parse(f.s.raw),theme:'light',revision:9}));expected=f.s.raw;}
 assert.throws(()=>ready.approve(true),fault==='owner'?/owner changed/:/archive changed/);assert.equal(f.s.raw,expected);assert.ok(readSleepImportPause(f.s,owner));}
});

test('05.02 malformed owner/UUID/applied receipts never retire durable pending operations',async()=>{
 for(const fault of ['owner','uuid','applied'] as const){const f=await fixture(),c={...f.c,cancelOperation:async(op:SleepOperation)=>({...await f.c.cancelOperation(op),...(fault==='owner'?{ownerId:randomUUID()}:fault==='uuid'?{operationId:randomUUID()}:{cancelled:false})})};
 const p=await prepareSleepSyncImport(f.s,owner,f.source,c,f.options);await assert.rejects(p.start(true));
 const pause=readSleepImportPause(f.s,owner)!,tx=openSleepSyncArchive(f.s,owner,pause.id);assert.equal(tx.queue.operations[0].operationId,f.op.operationId);assert.equal(tx.diary.nights[0].note,'Original');tx.abort();}
});

test('05.02 backup failure and unverified earned dates stop before any server cancellation',async()=>{
 const f=await fixture(),before=f.s.raw;f.s.backupFail=true;const p=await prepareSleepSyncImport(f.s,owner,f.source,f.c,f.options);await assert.rejects(p.start(true),/Backup failed/);assert.equal(f.s.raw,before);assert.equal(f.c.calls.length,0);
 f.s.backupFail=false;const source={...f.source,nights:[],deletedCredits:[f.op.date]};const next=await prepareSleepSyncImport(f.s,owner,source,f.c,f.options);assert.equal(next.review.unverifiedCredits.length,1);
 await assert.rejects(next.start(true),/explicit migration/);assert.equal(f.s.raw,before);assert.equal(f.c.calls.length,0);next.discard();
});

test('05.02 original server target needs explicit server choice; no new reward or overwritten target',async()=>{
 const f=await fixture(),snapshot={...empty(),credits:[f.op.date],dates:[{date:f.op.date,revision:1,night:f.op.night}]},c=transport(snapshot,true);
 const source={...f.source,nights:f.source.nights.map(n=>({...n,target:{...n.target,hours:7}}))};
 const p=await prepareSleepSyncImport(f.s,owner,source,c,f.options),ready=await p.start(true);assert.equal(ready.review.conflicts[0].canKeepLocal,false);
 assert.throws(()=>ready.approve(true),/Review every conflict/);assert.ok(readSleepImportPause(f.s,owner));
 const again=await resumeSleepSyncImport(f.s,owner,source,c,f.options);assert.throws(()=>again.choose({[f.op.date]:'local'}),/original server target/);again.choose({[f.op.date]:'server'});again.approve(true);
 const tx=openSleepSyncArchive(f.s,owner);assert.equal(tx.queue.operations.length,0);assert.equal(tx.diary.nights[0].target.hours,8);assert.equal(tx.diary.credits.length,1);tx.abort();
});

test('05.02 cancelled UUID cannot be reused by injected identifier factory',async()=>{
 const f=await fixture();let ids=0;const options={...f.options,createId:()=>++ids===1?randomUUID():f.op.operationId};
 const p=await prepareSleepSyncImport(f.s,owner,f.source,f.c,options),ready=await p.start(true),raw=f.s.raw;
 assert.throws(()=>ready.approve(true),/cannot be reused/);assert.equal(f.s.raw,raw);assert.ok(readSleepImportPause(f.s,owner));
});
test('05.02 second prepared import cannot bypass an existing durable fence or cancel again',async()=>{
 const f=await fixture(),first=await prepareSleepSyncImport(f.s,owner,f.source,f.c,f.options),second=await prepareSleepSyncImport(f.s,owner,f.original,f.c,f.options);
 const ready=await first.start(true),paused=f.s.raw;await assert.rejects(second.start(true),/Archive changed/);assert.equal(f.s.raw,paused);assert.equal(f.c.calls.length,1);ready.discard();
});

test('05.02 account switch during cancellation keeps pause and prevents subsequent requests',async()=>{
 const f=await fixture();let active=owner;const c={...f.c,cancelOperation:async(op:SleepOperation)=>{const result=await f.c.cancelOperation(op);active=randomUUID();return result;}};
 const p=await prepareSleepSyncImport(f.s,owner,f.source,c,{...f.options,getOwnerId:()=>active});await assert.rejects(p.start(true),/owner changed/);
 const pause=readSleepImportPause(f.s,owner)!,tx=openSleepSyncArchive(f.s,owner,pause.id);assert.equal(tx.queue.operations.length,1);assert.equal(tx.diary.nights[0].note,'Original');tx.abort();
});

test('05.02 server snapshot cannot move behind an applied cancellation receipt before showing import review',async()=>{
 const f=await fixture(),applied={...empty(),credits:[f.op.date],dates:[{date:f.op.date,revision:1,night:f.op.night}]};
 const c={readSnapshot:async()=>({ownerId:owner,snapshot:empty()}),cancelOperation:async(op:SleepOperation):Promise<SleepCancellationReceipt>=>({protocolVersion:1,ownerId:owner,operationId:op.operationId,cancelled:false,snapshot:applied})};
 const p=await prepareSleepSyncImport(f.s,owner,f.source,c,f.options);await assert.rejects(p.start(true),/moved backwards/);assert.ok(readSleepImportPause(f.s,owner));
});

test('05.02 active local night and failed fence write stop before cancellation',async()=>{
 const f=await fixture(),before=f.s.raw;const active={...JSON.parse(before),active:{started:wake-510*60000,target:f.original.schedule}};f.s.setItem(SLEEP_KEY,JSON.stringify(active));
 await assert.rejects(prepareSleepSyncImport(f.s,owner,f.source,f.c,f.options),/active night/);assert.equal(f.c.calls.length,0);
 f.s.setItem(SLEEP_KEY,before);const p=await prepareSleepSyncImport(f.s,owner,f.source,f.c,f.options);f.s.fail=true;await assert.rejects(p.start(true),/Disk full/);assert.equal(f.s.raw,before);assert.equal(f.c.calls.length,0);assert.equal(readSleepImportPause(f.s,owner),null);
});

test('05.02 corrupt pause or changed owner cannot be silently resumed or reset',async()=>{
 const f=await fixture(),p=await prepareSleepSyncImport(f.s,owner,f.source,f.c,f.options),ready=await p.start(true);ready.discard();const old=f.s.raw;
 assert.throws(()=>readSleepImportPause(f.s,randomUUID()),/owner changed/);
 const root=JSON.parse(old);root._sleepSync.importPause.sourceSha256='broken';f.s.setItem(SLEEP_KEY,JSON.stringify(root));const corrupted=f.s.raw;
 assert.throws(()=>readSleepImportPause(f.s,owner),/pause is damaged/);await assert.rejects(resumeSleepSyncImport(f.s,owner,f.source,f.c,f.options));assert.equal(f.s.raw,corrupted);
});

test('05.02 archive cannot release pause while original pending UUID is still present',async()=>{
 const f=await fixture(),p=await prepareSleepSyncImport(f.s,owner,f.source,f.c,f.options),ready=await p.start(true);ready.discard();const raw=f.s.raw,pause=readSleepImportPause(f.s,owner)!,tx=openSleepSyncArchive(f.s,owner,pause.id);
 assert.throws(()=>tx.finishImport(pause.id),/Apply the import review/);tx.abort();assert.equal(f.s.raw,raw);
});