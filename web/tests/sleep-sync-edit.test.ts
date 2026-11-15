import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {persistSleepSyncEdit} from '../lib/sleep-sync-edit';
import {openSleepSyncArchive} from '../lib/sleep-sync-archive';
import {prepareSleepSyncPull} from '../lib/sleep-sync-engine';
import {freshSleep,recordNight,deleteNight,parseSleep,SLEEP_KEY,type SleepState} from '../components/sleep/sleep-state';
const owner=randomUUID(),wake=Date.parse('2026-06-01T07:30:00+03:00');
const input={bed:wake-510*60000,wake,bedOffset:180,wakeOffset:180,sleepMinutes:480,rested:3,note:'Original'};
function file(initial=freshSleep()){let raw=JSON.stringify(initial),writes=0,fail=false;return{
 getItem:(key:string)=>{assert.equal(key,SLEEP_KEY);return raw;},setItem:(key:string,value:string)=>{assert.equal(key,SLEEP_KEY);if(fail)throw Error('Disk full');raw=value;writes++;},
 get raw(){return raw;},get writes(){return writes;},set fail(v:boolean){fail=v;}};}
const read=(s:ReturnType<typeof file>)=>parseSleep(s.raw)!;
async function link(s:ReturnType<typeof file>,dates:{date:string;revision:number;night:ReturnType<typeof recordNight>['nights'][0]}[]=[]){
 const p=await prepareSleepSyncPull(s,owner,{readSnapshot:async()=>({ownerId:owner,snapshot:{protocolVersion:1,garden:false,credits:dates.filter(d=>d.night.success).map(d=>d.date),deletedCredits:[],dates}}),rpc:async()=>{throw Error('No send');}});
 p.approve(true,owner);
}

test('05.02 edit outbox: first account linking cannot be silently triggered by an ordinary save',()=>{
 const s=file(),before=read(s);assert.throws(()=>persistSleepSyncEdit(s,owner,before,recordNight(before,input)),/first account link/);
 assert.equal(s.writes,0);assert.equal(read(s).nights.length,0);
});

test('05.02 edit outbox: new night and pending UUID are one authoritative write and one revision',async()=>{
 const s=file();await link(s);const before=read(s),writes=s.writes,next=recordNight(before,input);
 const saved=persistSleepSyncEdit(s,owner,before,next);assert.equal(s.writes,writes+1);assert.equal(saved.revision,before.revision+1);
 const cold=openSleepSyncArchive(s,owner);assert.equal(cold.queue.operations.length,1);assert.equal(cold.queue.operations[0].expectedRevision,0);
 assert.equal(cold.queue.operations[0].night?.note,'Original');assert.equal(cold.diary.credits.length,1);assert.ok(!JSON.stringify(saved).includes('_sleepSync'));cold.abort();
});

test('05.02 edit outbox: repeated offline edits and deletion preserve immutable pending content and earned credit',async()=>{
 const s=file();await link(s);let before=read(s);persistSleepSyncEdit(s,owner,before,recordNight(before,input));
 const initial=openSleepSyncArchive(s,owner),original=initial.queue.operations[0];initial.abort();
 for(let i=0;i<5;i++){before=read(s);persistSleepSyncEdit(s,owner,before,{...before,nights:before.nights.map(n=>({...n,note:'Offline '+i}))});}
 before=read(s);persistSleepSyncEdit(s,owner,before,deleteNight(before,before.nights[0]));
 const cold=openSleepSyncArchive(s,owner);assert.deepEqual(cold.queue.operations,[original]);assert.equal(cold.diary.nights.length,0);
 assert.equal(cold.diary.credits.length,1);assert.deepEqual(cold.diary.deletedCredits,[original.date]);cold.abort();
});

test('05.02 edit outbox: acknowledged server revision is captured for a new operation',async()=>{
 const initial=recordNight(freshSleep(),input),night=initial.nights[0],s=file(initial);await link(s,[{date:night.date,revision:3,night}]);
 const before=read(s);persistSleepSyncEdit(s,owner,before,{...before,nights:[{...before.nights[0],note:'Edited after ACK'}]});
 const cold=openSleepSyncArchive(s,owner);assert.equal(cold.queue.operations.length,1);assert.equal(cold.queue.operations[0].expectedRevision,3);cold.abort();
});

test('05.02 edit outbox: settings and active night stay local and preserve the bound baseline',async()=>{
 const s=file();await link(s);const before=read(s),active={id:randomUUID(),started:wake,bedOffset:180,wakeOffset:180,target:before.schedule};
 persistSleepSyncEdit(s,owner,before,{...before,theme:'light',active});const cold=openSleepSyncArchive(s,owner);
 assert.equal(cold.queue.operations.length,0);assert.equal(cold.queue.revision,0);assert.equal(cold.diary.theme,'light');assert.deepEqual(cold.diary.active,active);
 assert.ok(cold.baseline);assert.deepEqual(cold.diary.world,before.world);cold.abort();
});

test('05.02 edit outbox: stale state, wrong owner, disk failure and invalid generated UUID preserve complete archive',async()=>{
 for(const fault of ['stale','owner','disk','uuid']){
   const s=file();await link(s);const before=read(s),next=recordNight(before,input);
   if(fault==='stale')s.setItem(SLEEP_KEY,JSON.stringify({...before,theme:'light'}));
   if(fault==='disk')s.fail=true;const raw=s.raw;
   assert.throws(()=>persistSleepSyncEdit(s,fault==='owner'?randomUUID():owner,before,next,()=>fault==='uuid'?'invalid':randomUUID()));assert.equal(s.raw,raw);
 }
});

test('05.02 edit outbox: caller metadata cannot rebind account; ordinary edits cannot erase earned progress',async()=>{
 const s=file();await link(s);let before=read(s);const next={...recordNight(before,input),_sleepSync:{ownerId:randomUUID(),token:'synthetic-token-marker'}} as SleepState;
 persistSleepSyncEdit(s,owner,before,next);assert.ok(!s.raw.includes('synthetic-token-marker'));
 before=read(s);const raw=s.raw;assert.throws(()=>persistSleepSyncEdit(s,owner,before,{...before,nights:[],credits:[],deletedCredits:[]}),/Archive replacement/);assert.equal(s.raw,raw);
});
test('05.02 edit outbox: valid legacy clock metadata is normalized for transport without changing captured target',async()=>{
 const initial=recordNight(freshSleep(),input),legacy={...initial.nights[0]};delete legacy.bedOffset;delete legacy.wakeOffset;delete legacy.rewardRule;
 const s=file({...initial,nights:[legacy]});await link(s,[{date:legacy.date,revision:1,night:{...legacy,bedOffset:180,wakeOffset:180,rewardRule:'v1'}}]);const before=read(s);
 const edited={...before.nights[0],note:'Legacy edit'};delete edited.bedOffset;delete edited.wakeOffset;delete edited.rewardRule;
 persistSleepSyncEdit(s,owner,before,{...before,nights:[edited]});
 const cold=openSleepSyncArchive(s,owner),pending=cold.queue.operations[0];assert.ok(Number.isInteger(pending.night?.bedOffset));assert.ok(Number.isInteger(pending.night?.wakeOffset));
 assert.equal(pending.night?.rewardRule,'v1');assert.deepEqual(pending.night?.target,legacy.target);assert.equal(pending.expectedRevision,1);cold.abort();
});