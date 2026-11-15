import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {PGlite} from '@electric-sql/pglite';
import {validHealthOrigin,healthOriginLabel,type HealthOrigin} from '../components/sleep/sleep-health-origin';import {summarizeHealthSession} from '../components/sleep/sleep-health-session';import {importHealthNight} from '../components/sleep/sleep-health-import';import {freshSleep,editNight,parseSleep,deleteNight} from '../components/sleep/sleep-state';import {backupText,readBackup} from '../components/sleep/sleep-insights';import {archiveScoreVersion} from '../components/sleep/sleep-score-version';import {parseSleepSnapshot} from '../lib/sleep-sync-queue';import {reviewSleepReconciliation} from '../lib/sleep-sync-reconcile';import {prepareOwnSleepDatabase} from './sleep-postgres-fixture';
import {resolveDiaryScoreVersion as previousResolve} from '../../docs/product-evidence/health-snapshot-20261113/snapshot/source/web/components/sleep/sleep-score-version';
import {persistSleepProductState,readSleepProductState} from '../components/sleep/sleep-product-storage';import {prepareSleepSyncPull} from '../lib/sleep-sync-engine';import {openSleepSyncArchive} from '../lib/sleep-sync-archive';import {SLEEP_KEY} from '../components/sleep/sleep-state';
const m=60000,bed=Date.UTC(2026,0,4,23),wake=bed+480*m,now=wake+m;
const origin:HealthOrigin={version:'health-connect-origin-v1',packageName:'app.overman.healthfixture',recordingMethod:'manual'},session={start:bed,end:wake,stages:[{start:bed,end:wake,kind:'sleeping' as const}],origin};

test('origin accepts four source assertions and explicit missing package; rejects malformed/unexpected identifiers and future schema',()=>{
 for(const recordingMethod of ['manual','active','automatic','unknown'] as const)for(const packageName of ['app.overman.healthfixture','android',null])assert.equal(validHealthOrigin({...origin,recordingMethod,packageName}),true);
 for(const value of [{...origin,packageName:''},{...origin,packageName:'com.app\n'},{...origin,packageName:'<script>'},{...origin,packageName:'x'.repeat(256)},{...origin,recordingMethod:2},{...origin,recordingMethod:'verified-sensor'},{...origin,version:'future'},{...origin,deviceId:'do-not-retain'}]){assert.equal(validHealthOrigin(value),false);assert.throws(()=>summarizeHealthSession({...session,origin:value as HealthOrigin}));}
 assert.match(healthOriginLabel(origin),/Ручной ввод/);assert.match(healthOriginLabel({...origin,recordingMethod:'automatic'}),/по отметке источника/);assert.match(healthOriginLabel(),/не сохранено/);
});

test('import freezes provenance independently of later provider mutation, diary correction and self-report; old history remains unknown',()=>{
 const input=structuredClone(session),before=freshSleep(),old=importHealthNight(before,[{...session,origin:undefined}],0,{bed:0,wake:0},4,now);assert.equal(old.nights[0].healthOrigin,undefined);assert.equal(old.scoreVersion,'health-intervals-v5');
 const s=importHealthNight(before,[input],0,{bed:0,wake:0},4,now),n=s.nights[0];assert.equal(s.scoreVersion,'health-intervals-v5');assert.deepEqual(n.healthOrigin,origin);assert.equal(n.healthScore!.score,100);input.origin.recordingMethod='automatic';assert.equal(n.healthOrigin!.recordingMethod,'manual');
 const corrected=editNight(s,n,{...n,sleepMinutes:420,awakeMinutes:60,rested:1},now);assert.deepEqual(corrected.nights[0].healthOrigin,origin);assert.deepEqual(corrected.nights[0].healthScore,n.healthScore);assert.deepEqual(readBackup(backupText(corrected)).nights,JSON.parse(JSON.stringify(corrected.nights)));assert.deepEqual(parseSleep(JSON.stringify(corrected))!.nights,JSON.parse(JSON.stringify(corrected.nights)));assert.equal(archiveScoreVersion(deleteNight(s,n)),'health-intervals-v5');assert.throws(()=>previousResolve(s.scoreVersion),/Обнови приложение/);
 assert.throws(()=>parseSleep(JSON.stringify({...s,nights:[{...n,source:'manual'}]})));assert.throws(()=>parseSleep(JSON.stringify({...s,nights:[{...n,healthScore:undefined}]})));
});

test('source recording method cannot manufacture a different score, duration or reward',()=>{
 const records=(['manual','automatic','active','unknown'] as const).map(recordingMethod=>importHealthNight(freshSleep(),[{...session,origin:{...origin,recordingMethod}}],0,{bed:0,wake:0},4,now));
 for(const s of records){assert.deepEqual(s.nights[0].healthScore,records[0].nights[0].healthScore);assert.equal(s.nights[0].sleepMinutes,480);assert.deepEqual(s.credits,records[0].credits);}
});

test('actual product writer retains provenance in durable offline queue and exported backup after cold read',async()=>{
 const owner=randomUUID();let raw=JSON.stringify(freshSleep());const storage={getItem:()=>raw,setItem:(_k:string,v:string)=>{raw=v;}};
 const pull=await prepareSleepSyncPull(storage,owner,{readSnapshot:async()=>({ownerId:owner,snapshot:{protocolVersion:1,garden:false,credits:[],deletedCredits:[],dates:[]}}),rpc:async()=>{throw Error('Offline only');}});pull.approve(true,owner);const before=readSleepProductState(raw)!,next=importHealthNight(before,[session],0,{bed:0,wake:0},4,now);persistSleepProductState(storage,SLEEP_KEY,before,next);
 const cold=openSleepSyncArchive(storage,owner);assert.deepEqual(cold.queue.operations[0].night!.healthOrigin,origin);assert.deepEqual(cold.diary.nights[0].healthOrigin,origin);cold.abort();assert.equal(readSleepProductState(raw)!.scoreVersion,'health-intervals-v5');assert.deepEqual(readBackup(backupText(next)).nights[0].healthOrigin,origin);
});

test('conflict review forbids replacing the original package/method while retaining the source index',()=>{
 const s=importHealthNight(freshSleep(),[session],0,{bed:0,wake:0},4,now),n=s.nights[0],owner=randomUUID(),incoming={ownerId:owner,snapshot:{protocolVersion:1 as const,garden:false,credits:s.credits,deletedCredits:[],dates:[{date:n.date,revision:1,night:{...n,healthOrigin:{...origin,recordingMethod:'automatic' as const}}}]}};
 const review=reviewSleepReconciliation(s,owner,null,incoming);assert.equal(review.conflicts.length,1);assert.equal(review.conflicts[0].canKeepLocal,false);
});

test('SQL preserves metadata, rejects downgrade/changed origin and arbitrary extra fields, and keeps replay idempotent',async()=>{
 const db=new PGlite(),owner=randomUUID(),s=importHealthNight(freshSleep(),[session],0,{bed:0,wake:0},4,now),n=s.nights[0],id=randomUUID();
 try{await prepareOwnSleepDatabase(db,[owner]);await db.query("select set_config('overman.owner_id',$1,false)",[owner]);const save=async(night:unknown,revision:number,operation=randomUUID())=>parseSleepSnapshot((await db.query<{result:unknown}>('select public.save_sleep_diary_operation_v1($1,$2,$3,$4::jsonb,$5) result',[operation,n.date,revision,JSON.stringify(night),owner])).rows[0].result);
  for(const packageName of ['android','com.valid_App.source',null])for(const recordingMethod of ['manual','automatic','active','unknown'])await db.query('select public.validate_sleep_night($1::jsonb,$2::date)',[JSON.stringify({...n,healthOrigin:{...origin,packageName,recordingMethod}}),n.date]);
  for(const invalid of [{...origin,packageName:''},{...origin,packageName:'com.app\n'},{...origin,packageName:'<script>'},{...origin,packageName:'x'.repeat(256)},{...origin,recordingMethod:2},{...origin,recordingMethod:'verified-sensor'},{...origin,version:'future'},{...origin,packageName:undefined}])await assert.rejects(db.query('select public.validate_sleep_night($1::jsonb,$2::date)',[JSON.stringify({...n,healthOrigin:invalid}),n.date]),/Invalid health origin/);
  const first=await save(n,0,id);assert.deepEqual(first.dates[0].night!.healthOrigin,origin);assert.deepEqual(await save(n,0,id),first);
  const {healthOrigin:_ignored,...older}=n;await assert.rejects(save(older,1),/original health origin/);await assert.rejects(save({...n,healthOrigin:{...origin,recordingMethod:'automatic'}},1),/original health origin/);await assert.rejects(save({...n,healthOrigin:{...origin,deviceId:'not-retained'}},1),/Invalid health origin/);
  const corrected=editNight(s,n,{...n,sleepMinutes:420,awakeMinutes:60,rested:1},now).nights[0],updated=await save(corrected,1);assert.deepEqual(updated.dates[0].night!.healthOrigin,origin);assert.deepEqual(updated.dates[0].night!.healthScore,n.healthScore);assert.equal(updated.dates[0].night!.rested,1);
  assert.equal((await db.query<{n:number}>('select count(*)::int n from public.sleep_diary_receipts where user_id=$1',[owner])).rows[0].n,2);
 }finally{await db.close();}
});
