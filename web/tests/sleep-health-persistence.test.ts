import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {freshSleep,editNight,parseSleep,recordNight,deleteNight} from '../components/sleep/sleep-state';
import {importHealthNight} from '../components/sleep/sleep-health-import';
import {snapshotHealthScoreV2,validateHealthScoreSnapshot} from '../components/sleep/sleep-health-score';
import {backupText,readBackup,nightScore} from '../components/sleep/sleep-insights';
import {archiveScoreVersion} from '../components/sleep/sleep-score-version';
import {parseSleepSnapshot,readSleepQueue,enqueueSleepOperation,sendFirstSleepOperation,sleepQueueKey} from '../lib/sleep-sync-queue';
import {prepareOwnSleepDatabase} from './sleep-postgres-fixture';
import {reviewSleepReconciliation} from '../lib/sleep-sync-reconcile';
import {persistSleepProductState,readSleepProductState} from '../components/sleep/sleep-product-storage';
import {prepareSleepSyncPull} from '../lib/sleep-sync-engine';
import {openSleepSyncArchive} from '../lib/sleep-sync-archive';
import {SLEEP_KEY} from '../components/sleep/sleep-state';
import {resolveDiaryScoreVersion as previousResolve} from '../../docs/product-evidence/sleep-upgrade-20261111/files/web/components/sleep/sleep-score-version';

const m=60000,bed=Date.UTC(2026,0,1,23),wake=bed+480*m,now=wake+m;
const session={start:bed,end:wake,stages:[{start:bed,end:bed+240*m,kind:'sleeping' as const},{start:bed+240*m,end:wake,kind:'awake' as const}]};
const imported=()=>importHealthNight(freshSleep(),[session],0,{bed:0,wake:0},4,now);

test('the actual frozen previous resolver rejects the new archive version before a downgrade can rewrite it',()=>{
 const raw=backupText(imported()),copy=JSON.parse(raw);assert.throws(()=>previousResolve(copy.state.scoreVersion),/Обнови приложение/);assert.equal(raw,JSON.stringify(copy,null,2));
});

test('separate v2 snapshot survives correction, changed goal, backup, and later manual nights without altering old scores',()=>{
 const legacy=recordNight(freshSleep(),{bed:bed-86400000,wake:wake-86400000,bedOffset:0,wakeOffset:0,sleepMinutes:480,rested:2},now);
 const old=structuredClone(legacy.nights[0]),oldScore=nightScore(old),state=importHealthNight(legacy,[session],0,{bed:0,wake:0},4,now),night=state.nights[0],snapshot=structuredClone(night.healthScore!);
 assert.equal(state.scoreVersion,'health-intervals-v5');assert.equal(snapshot.version,'health-preview-v2');assert.equal(snapshot.score,44);assert.equal(night.rested,4);
 const corrected=editNight({...state,schedule:{...state.schedule,hours:9,wake:'08:00'}},night,{...night,sleepMinutes:300,awakeMinutes:180,rested:1},now);
 assert.deepEqual(corrected.nights[0].healthScore,snapshot);assert.equal(corrected.nights[0].rested,1);assert.notEqual(nightScore(corrected.nights[0]),nightScore(night));
 assert.deepEqual(readBackup(backupText(corrected)).nights,JSON.parse(JSON.stringify(corrected.nights)));assert.deepEqual(parseSleep(JSON.stringify(corrected))!.nights,JSON.parse(JSON.stringify(corrected.nights)));
 assert.deepEqual(corrected.nights[1],old);assert.equal(nightScore(corrected.nights[1]),oldScore);assert.deepEqual(corrected.credits,state.credits);
 const removed=deleteNight(state,night);assert.equal(archiveScoreVersion(removed),'health-intervals-v5');assert.equal(removed.nights[0].healthScore,undefined);
});

test('only complete supported snapshots are accepted; missing history is never backfilled',()=>{
 const s=imported(),n=s.nights[0];assert.equal(snapshotHealthScoreV2({...session,stages:[]},480),null);
 const invalid=[{...n.healthScore,score:100},{...n.healthScore,version:'future'},{...n.healthScore,referenceMinutes:240},{...n.healthScore,extra:true},{...n.healthScore,goalMinutes:Infinity}];
 for(const healthScore of invalid){assert.equal(validateHealthScoreSnapshot(healthScore),false);assert.throws(()=>parseSleep(JSON.stringify({...s,nights:[{...n,healthScore}]})));}
 assert.throws(()=>parseSleep(JSON.stringify({...s,nights:[{...n,source:'manual'}]})));
 const {healthScore:_snapshot,healthInterval:_bounds,...old}=n;assert.equal(parseSleep(JSON.stringify({...s,nights:[old]}))!.nights[0].healthScore,undefined);
});

test('conflict review forbids overwriting the server source snapshot even when the target is identical',()=>{
 const local=imported(),n=local.nights[0],owner=randomUUID(),remote={...n,healthScore:snapshotHealthScoreV2({...session,stages:[{start:bed,end:wake,kind:'sleeping'}]},480)!};
 const incoming={ownerId:owner,snapshot:{protocolVersion:1 as const,garden:false,credits:[],deletedCredits:[],dates:[{date:n.date,revision:1,night:remote}]}};
 const review=reviewSleepReconciliation(local,owner,null,incoming);assert.equal(review.conflicts.length,1);assert.equal(review.conflicts[0].canKeepLocal,false);
 assert.throws(()=>reviewSleepReconciliation(local,owner,null,incoming,{[n.date]:'local'}),/original server target and health score/);
});

test('actual offline product writer atomically preserves index in diary and durable queue after cold read',async()=>{
 const owner=randomUUID();let raw=JSON.stringify(freshSleep());const storage={getItem:()=>raw,setItem:(_k:string,v:string)=>{raw=v;}};
 const pull=await prepareSleepSyncPull(storage,owner,{readSnapshot:async()=>({ownerId:owner,snapshot:{protocolVersion:1,garden:false,credits:[],deletedCredits:[],dates:[]}}),rpc:async()=>{throw Error('No network during offline save');}});pull.approve(true,owner);
 const before=readSleepProductState(raw)!,next=importHealthNight(before,[session],0,{bed:0,wake:0},4,now);persistSleepProductState(storage,SLEEP_KEY,before,next);
 const cold=openSleepSyncArchive(storage,owner);assert.equal(cold.queue.operations.length,1);assert.deepEqual(cold.queue.operations[0].night!.healthScore,next.nights[0].healthScore);assert.deepEqual(cold.diary.nights[0].healthScore,next.nights[0].healthScore);cold.abort();assert.equal(readSleepProductState(raw)!.scoreVersion,'health-intervals-v5');
});

test('actual migration preserves snapshots, rejects initial mismatch and older rewrites, and cold queue round-trips',async()=>{
 const db=new PGlite(),owner=randomUUID(),state=imported(),n=state.nights[0];
 try{await prepareOwnSleepDatabase(db,[owner]);await db.query("select set_config('overman.owner_id',$1,false)",[owner]);
  const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}};
  const operation={operationId:randomUUID(),date:n.date,expectedRevision:0,night:n};
  const queue=enqueueSleepOperation(storage,readSleepQueue(storage,owner),operation);assert.deepEqual(readSleepQueue(storage,owner),queue);
  const save=async(night:unknown,revision:number,id=randomUUID())=>(await db.query<{result:unknown}>('select public.save_sleep_diary_operation_v1($1,$2,$3,$4::jsonb,$5) result',[id,n.date,revision,JSON.stringify(night),owner])).rows[0].result;
  await assert.rejects(save({...n,healthScore:snapshotHealthScoreV2({...session,stages:[{start:bed,end:wake,kind:'sleeping'}]},480)},0),/does not match/);
  const sent=await sendFirstSleepOperation(storage,queue,{rpc:async()=>({data:await save(n,0,operation.operationId),error:null})});assert.equal(sent!.queue.operations.length,0);assert.deepEqual(sent!.snapshot.dates[0].night!.healthScore,n.healthScore);
  assert.deepEqual(parseSleepSnapshot(await save(n,0,operation.operationId)),sent!.snapshot);
  const {healthScore:_snapshot,healthInterval:_bounds,...older}=n;await assert.rejects(save(older,1),/original health score/);
  await assert.rejects(save({...n,healthScore:{...n.healthScore,score:0}},1));
  const edited=editNight(state,n,{...n,sleepMinutes:300,awakeMinutes:180,rested:1},now).nights[0];const response=parseSleepSnapshot(await save(edited,1));assert.deepEqual(response.dates[0].night!.healthScore,n.healthScore);assert.equal(response.dates[0].night!.rested,1);
  assert.equal(JSON.parse(storage.getItem(sleepQueueKey(owner))!).operations.length,0);
 }finally{await db.close();}
});
