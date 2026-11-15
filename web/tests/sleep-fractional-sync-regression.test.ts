import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
import {prepareOwnSleepDatabase} from './sleep-postgres-fixture';import {freshSleep} from '../components/sleep/sleep-state';import {importHealthNight} from '../components/sleep/sleep-health-import';
import {importBeforeInterval} from './sleep-health-legacy-fixture';
test('fractional Health Connect night syncs and retry does not duplicate rewards',async()=>{
 const db=new PGlite(),owner=randomUUID(),operation=randomUUID(),minute=60000,bed=Date.UTC(2026,0,2,23),wake=bed+510*minute+1;
 const session={start:bed,end:wake,stages:[{start:bed,end:wake,kind:'sleeping' as const}]};const night=importBeforeInterval(freshSleep(),[session],0,{bed:0,wake:0},4,wake+minute).nights[0];
 try{await prepareOwnSleepDatabase(db,[owner],{through:10});await db.query("select set_config('overman.owner_id',$1,false)",[owner]);
  const save=(id:string,n:unknown,revision=0)=>db.query('select public.save_sleep_diary_operation_v1($1,$2,$3,$4::jsonb,$5) as snapshot',[id,night.date,revision,JSON.stringify(n),owner]);
  const {healthScore:_snapshot,...oldPayload}=night;await assert.rejects(save(operation,oldPayload),/Invalid sleep duration/);
  const before=await db.query<{n:number}>('select count(*)::integer n from public.sleep_reward_dates where user_id=$1',[owner]);assert.equal(before.rows[0].n,0);
  for(const file of ['011_sleep_fractional_sync.sql','012_health_score_snapshot.sql'])await db.exec(await readFile(new URL('../../server/db/migrations/'+file,import.meta.url),'utf8'));
  const first=await save(operation,night),again=await save(operation,night);assert.deepEqual(again.rows,first.rows);
  const rows=await db.query<{n:number}>('select count(*)::integer n from public.sleep_reward_dates where user_id=$1 and wake_date=$2',[owner,night.date]);assert.equal(rows.rows[0].n,1);
  await assert.rejects(save(randomUUID(),{...night,sleepMinutes:night.sleepMinutes+0.001},1));
 }finally{await db.close();}
});

test('fractional full-sleep records across the day pass without permitting a material overrun',async()=>{
 const db=new PGlite(),minute=60000,bed=Date.UTC(2026,0,2,0);let seed=0x05a21;
 try{await prepareOwnSleepDatabase(db,[]);
  for(let i=0;i<1000;i++){
   seed=(Math.imul(seed,1664525)+1013904223)>>>0;const duration=3600000+(seed%79200000),wake=bed+duration;
   const session={start:bed,end:wake,stages:[{start:bed,end:wake,kind:'sleeping' as const}]};const night=importHealthNight(freshSleep(),[session],0,{bed:0,wake:0},4,wake+minute).nights[0];
   await db.query('select public.validate_sleep_night($1::jsonb,$2::date)',[JSON.stringify(night),night.date]);
   if(i%100===0)await assert.rejects(db.query('select public.validate_sleep_night($1::jsonb,$2::date)',[JSON.stringify({...night,sleepMinutes:night.sleepMinutes+0.001}),night.date]));
  }
 }finally{await db.close();}
});
