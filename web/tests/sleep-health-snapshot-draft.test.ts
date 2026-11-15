import {importBeforeInterval} from './sleep-health-legacy-fixture';
import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
import {prepareOwnSleepDatabase} from './sleep-postgres-fixture';import {freshSleep} from '../components/sleep/sleep-state';import {importHealthNight} from '../components/sleep/sleep-health-import';import {snapshotHealthScore} from '../components/sleep/sleep-health-score';
test('draft transaction validates and preserves health score against older clients',async()=>{
 const db=new PGlite(),owner=randomUUID(),minute=60000,bed=Date.UTC(2026,0,1,23),wake=bed+480*minute,session={start:bed,end:wake,stages:[{start:bed,end:wake,kind:'sleeping' as const}]};
 const n=importBeforeInterval(freshSleep(),[session],0,{bed:0,wake:0},4,wake+minute).nights[0];const healthScore=snapshotHealthScore(session,480)!;const complete={...n,healthScore};
 try{await prepareOwnSleepDatabase(db,[owner]);for(const name of ['health-score-snapshot-draft.sql','health-score-immutable-draft.sql'])await db.exec(await readFile(new URL('../../server/tests/fixtures/'+name,import.meta.url),'utf8'));
 await db.query("select set_config('overman.owner_id',$1,false)",[owner]);
 const save=(value:unknown,revision:number)=>db.query('select public.save_sleep_diary_operation_v1($1,$2,$3,$4::jsonb,$5)',[randomUUID(),n.date,revision,JSON.stringify(value),owner]);
 await save(complete,0);
 const {healthScore:_newSnapshot,...older}=n;await assert.rejects(save(older,1),/original health score/);
 await assert.rejects(save({...complete,healthScore:{...healthScore,score:0}},1));
 const {rested:_ignored,...withoutMood}=complete;
 await assert.rejects(save(withoutMood,1),/self-report cannot disappear/);
 await save({...complete,rested:5},1);
 const row=await db.query<{night:typeof complete}>('select night from public.sleep_diary_dates where user_id=$1 and wake_date=$2',[owner,n.date]);assert.deepEqual(row.rows[0].night.healthScore,healthScore);assert.equal(row.rows[0].night.rested,5);
 }finally{await db.close();}
});

test('draft initial save accepts fractional milliseconds and fractional-hour goals',async()=>{
 const db=new PGlite(),owner=randomUUID(),minute=60000,bed=Date.UTC(2026,0,2,23),wake=bed+510*minute+1;
 const session={start:bed,end:wake,stages:[{start:bed,end:wake,kind:'sleeping' as const}]};const state=freshSleep();state.schedule.hours=8.2;
 const night=importBeforeInterval(state,[session],0,{bed:0,wake:0},4,wake+minute).nights[0];const healthScore=snapshotHealthScore(session,state.schedule.hours*60)!;
 try{await prepareOwnSleepDatabase(db,[owner]);for(const name of ['health-score-snapshot-draft.sql','health-score-immutable-draft.sql'])await db.exec(await readFile(new URL('../../server/tests/fixtures/'+name,import.meta.url),'utf8'));
  await db.query("select set_config('overman.owner_id',$1,false)",[owner]);
  await db.query('select public.save_sleep_diary_operation_v1($1,$2,$3,$4::jsonb,$5)',[randomUUID(),night.date,0,JSON.stringify({...night,healthScore}),owner]);
 }finally{await db.close();}
});

test('SQL draft agrees with JS for fractional intervals around half-point boundaries',async()=>{
 const db=new PGlite(),minute=60000,bed=Date.UTC(2026,0,1,23),wake=bed+480*minute,baseSession={start:bed,end:wake,stages:[{start:bed,end:wake,kind:'sleeping' as const}]};
 const n=importBeforeInterval(freshSleep(),[baseSession],0,{bed:0,wake:0},4,wake+minute).nights[0];
 try{await prepareOwnSleepDatabase(db,[]);await db.exec(await readFile(new URL('../../server/tests/fixtures/health-score-snapshot-draft.sql',import.meta.url),'utf8'));
  const makeSession=(split:number)=>({start:0,end:480*minute,stages:[{start:0,end:split,kind:'sleeping' as const},{start:split,end:480*minute,kind:'awake' as const}]});
  for(let i=0;i<100;i++){
   let lo=1,hi=480*minute-1;
   while(lo<hi){const mid=Math.floor((lo+hi)/2);if(snapshotHealthScore(makeSession(mid),480)!.score>i)hi=mid;else lo=mid+1;}
   for(const split of [lo-1,lo,lo+1]){const score=snapshotHealthScore(makeSession(split),480)!;await db.query('select public.validate_sleep_night($1::jsonb,$2::date)',[JSON.stringify({...n,healthScore:score}),n.date]);}
  }
 }finally{await db.close();}
});

test('SQL draft agrees with JS near score transitions across different goals and intervals',async()=>{
 const db=new PGlite(),minute=60000,bed=Date.UTC(2026,0,1,23),wake=bed+480*minute,baseSession={start:bed,end:wake,stages:[{start:bed,end:wake,kind:'sleeping' as const}]};
 const n=importBeforeInterval(freshSleep(),[baseSession],0,{bed:0,wake:0},4,wake+minute).nights[0];
 try{await prepareOwnSleepDatabase(db,[]);await db.exec(await readFile(new URL('../../server/tests/fixtures/health-score-snapshot-draft.sql',import.meta.url),'utf8'));
  for(const [goal,end] of [[240,300*minute],[465,510*minute],[600,720*minute],[720,1440*minute]] as const){
   const makeSession=(split:number)=>({start:0,end,stages:[{start:0,end:split,kind:'sleeping' as const},{start:split,end,kind:'awake' as const}]});
   for(let i=0;i<100;i++){
    let lo=1,hi=end-1;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(snapshotHealthScore(makeSession(mid),goal)!.score>i)hi=mid;else lo=mid+1;}
    for(const split of [lo-1,lo,lo+1]){if(split<=0||split>=end)continue;const score=snapshotHealthScore(makeSession(split),goal)!;await db.query('select public.validate_sleep_night($1::jsonb,$2::date)',[JSON.stringify({...n,healthScore:score}),n.date]);}
   }
  }
 }finally{await db.close();}
});
