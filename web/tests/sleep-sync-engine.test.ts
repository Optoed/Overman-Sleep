import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {prepareSleepSyncPull,prepareSleepSyncUpload} from '../lib/sleep-sync-engine';
import {openSleepSyncArchive} from '../lib/sleep-sync-archive';
import {enqueueSleepOperation,type SleepSnapshot} from '../lib/sleep-sync-queue';
import {freshSleep,recordNight,persistSleep,SLEEP_KEY} from '../components/sleep/sleep-state';
const owner=randomUUID(),wake=Date.parse('2026-06-01T07:30:00+03:00');
function file(){let raw=JSON.stringify(freshSleep()),writes=0,fail=false;return{getItem:(key:string)=>{assert.equal(key,SLEEP_KEY);return raw;},
 setItem:(key:string,v:string)=>{assert.equal(key,SLEEP_KEY);if(fail)throw Error('Disk full');raw=v;writes++;},get raw(){return raw;},get writes(){return writes;},set fail(v:boolean){fail=v;}};}
function local(s:ReturnType<typeof file>,pending=false){const tx=openSleepSyncArchive(s,owner),before=tx.diary;
 persistSleep(tx.storage,SLEEP_KEY,before,recordNight(before,{bed:wake-510*60000,wake,bedOffset:180,wakeOffset:180,sleepMinutes:480,rested:3,note:'Local'},Date.now()));
 const n=tx.diary.nights[0];if(pending)enqueueSleepOperation(tx.storage,tx.queue,{operationId:randomUUID(),date:n.date,expectedRevision:0,night:n});tx.commit(owner);return n;}
const empty=():SleepSnapshot=>({protocolVersion:1,garden:false,credits:[],deletedCredits:[],dates:[]});
function client(snapshot:SleepSnapshot){let reads=0,sends=0;return{get reads(){return reads;},get sends(){return sends;},
 readSnapshot:async()=>{reads++;return{ownerId:owner,snapshot};},rpc:async()=>{sends++;return{data:snapshot,error:null};}};}

test('05.02 coordinator: first link is read-only until approval; proposals become a single durable queue commit',async()=>{
 const s=file();local(s);const before=s.raw,writes=s.writes,c=client(empty());let ids=0;
 const p=await prepareSleepSyncPull(s,owner,c,()=>{ids++;return randomUUID();});assert.equal(p.review.uploads.length,1);assert.equal(s.raw,before);assert.equal(c.sends,0);
 assert.throws(()=>p.approve(false,owner),/explicit approval/);assert.equal(s.raw,before);
 const exposed=p.review;exposed.next.nights=[];assert.equal(p.review.next.nights.length,1);
 p.approve(true,owner);assert.equal(s.writes,writes+1);assert.equal(ids,1);assert.equal(c.sends,0);
 const cold=openSleepSyncArchive(s,owner);assert.equal(cold.queue.operations.length,1);assert.equal(cold.baseline!.snapshot.dates.length,0);cold.abort();
 assert.throws(()=>p.review,/closed/);
});

test('05.02 coordinator: discarded receipt keeps its durable pending UUID for retry',async()=>{
 const s=file(),night=local(s,true),before=s.raw,op=openSleepSyncArchive(s,owner).queue.operations[0];
 const c=client({...empty(),credits:[night.date],dates:[{date:night.date,revision:1,night}]});
 const cancelled=await prepareSleepSyncUpload(s,owner,c);assert.ok(cancelled);assert.equal(s.raw,before);cancelled.discard();assert.equal(s.raw,before);
 const pending=openSleepSyncArchive(s,owner);assert.equal(pending.queue.operations[0].operationId,op.operationId);pending.abort();
 const approved=await prepareSleepSyncUpload(s,owner,c);approved!.approve(true,owner);
 const cold=openSleepSyncArchive(s,owner);assert.equal(cold.queue.operations.length,0);assert.equal(cold.diary.credits.length,1);cold.abort();
 assert.equal(c.sends,2);
});

test('05.02 coordinator: account switch, disk error and local change while reviewing preserve old data',async()=>{
 for(const fault of ['owner','disk','changed']){
   const s=file(),night=local(s,true),c=client({...empty(),credits:[night.date],dates:[{date:night.date,revision:1,night}]});
   const p=await prepareSleepSyncUpload(s,owner,c);const before=s.raw;
   if(fault==='disk')s.fail=true;
   if(fault==='changed')s.setItem(SLEEP_KEY,JSON.stringify({...JSON.parse(s.raw),theme:'light',revision:2}));
   const expected=s.raw;assert.throws(()=>p!.approve(true,fault==='owner'?randomUUID():owner));assert.equal(s.raw,expected);
   if(fault!=='changed')assert.equal(s.raw,before);assert.throws(()=>p!.review,/closed/);
 }
});

test('05.02 coordinator: own old receipt plus newer local edit requires a choice and queues a fresh UUID',async()=>{
 const s=file(),old=local(s,true),pending=openSleepSyncArchive(s,owner).queue.operations[0];
 const edit=openSleepSyncArchive(s,owner),before=edit.diary;
 persistSleep(edit.storage,SLEEP_KEY,before,{...before,nights:[{...old,note:'New local edit'}]});edit.commit(owner);
 const c=client({...empty(),credits:[old.date],dates:[{date:old.date,revision:1,night:old}]});
 const p=await prepareSleepSyncUpload(s,owner,c);assert.equal(p!.review.conflicts.length,1);const unchanged=s.raw;
 p!.choose({[old.date]:'local'});assert.equal(s.raw,unchanged);assert.equal(p!.review.uploads.length,1);p!.approve(true,owner);
 const cold=openSleepSyncArchive(s,owner);assert.equal(cold.queue.operations.length,1);const next=cold.queue.operations[0];
 assert.notEqual(next.operationId,pending.operationId);assert.equal(next.expectedRevision,1);assert.equal(next.night?.note,'New local edit');assert.equal(cold.diary.credits.length,1);cold.abort();
});

test('05.02 coordinator: pull cannot replace or rebase an unacknowledged UUID with a different proposal',async()=>{
 const s=file(),old=local(s,true),tx=openSleepSyncArchive(s,owner),before=tx.diary;
 persistSleep(tx.storage,SLEEP_KEY,before,{...before,nights:[{...old,note:'Changed offline'}]});tx.commit(owner);const raw=s.raw;
 const p=await prepareSleepSyncPull(s,owner,client(empty()));assert.throws(()=>p.approve(true,owner),/different pending operation/);assert.equal(s.raw,raw);
});

test('05.02 coordinator: no pending work sends nothing; damaged identity and unverified historical credits block safely',async()=>{
 const s=file(),c=client(empty());assert.equal(await prepareSleepSyncUpload(s,owner,c),null);assert.equal(c.sends,0);assert.equal(s.writes,0);
 await assert.rejects(prepareSleepSyncPull(s,owner,{...c,readSnapshot:async()=>({ownerId:randomUUID(),snapshot:empty()})}));assert.equal(s.writes,0);
 const tx=openSleepSyncArchive(s,owner),before=tx.diary;
 persistSleep(tx.storage,SLEEP_KEY,before,{...before,credits:['2026-06-01'],deletedCredits:['2026-06-01']});tx.commit(owner);const raw=s.raw;
 const p=await prepareSleepSyncPull(s,owner,c);assert.deepEqual(p.review.unverifiedCredits,['2026-06-01']);
 assert.throws(()=>p.approve(true,owner),/explicit migration/);assert.equal(s.raw,raw);
});
test('05.02 coordinator: reviewed advanced server revision retires stale UUID; local choice receives a new one',async()=>{
 for(const choice of ['server','local'] as const){
   const s=file(),night=local(s,true),old=openSleepSyncArchive(s,owner).queue.operations[0];
   const c=client({...empty(),credits:[night.date],dates:[{date:night.date,revision:2,night:{...night,note:'Remote edit'}}]});
   const p=await prepareSleepSyncPull(s,owner,c),raw=s.raw;assert.equal(p.review.conflicts.length,1);
   p.choose({[night.date]:choice});assert.equal(s.raw,raw);p.approve(true,owner);
   const cold=openSleepSyncArchive(s,owner);assert.equal(cold.diary.nights[0].note,choice==='server'?'Remote edit':'Local');
   assert.equal(cold.queue.operations.length,choice==='server'?0:1);
   if(choice==='local'){assert.equal(cold.queue.operations[0].expectedRevision,2);assert.notEqual(cold.queue.operations[0].operationId,old.operationId);}
   assert.equal(cold.diary.credits.length,1);cold.abort();
 }
});