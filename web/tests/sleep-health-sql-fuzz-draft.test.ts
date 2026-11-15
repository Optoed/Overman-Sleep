import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {snapshotHealthScore} from '../components/sleep/sleep-health-score';
test('sampled sleep indexes match PostgreSQL double-precision arithmetic',async()=>{
 let seed=0x1234abcd;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 const values=[];for(let i=0;i<10000;i++){
  const interval=1+Math.floor(random()*86400000),sleep=Math.floor(random()*(interval+1)),goal=240+Math.round(random()*48000)/100;
  const session={start:0,end:interval,stages:[...(sleep?[{start:0,end:sleep,kind:'sleeping' as const}]:[]),...(sleep<interval?[{start:sleep,end:interval,kind:'awake' as const}]:[])]};
  const s=snapshotHealthScore(session,goal)!;values.push({sleep:s.sleepMinutes,interval:s.intervalMinutes,goal:s.goalMinutes,score:s.score});
 }
 const db=new PGlite();try{
  const r=await db.query<{mismatches:number}>(`select count(*)::integer mismatches from jsonb_to_recordset($1::jsonb) as t(sleep double precision, interval double precision, goal double precision, score integer)
   where floor(0.5 + 70*least(1,sleep/goal) + 30*least(1,sleep/goal)*least(1,sleep/interval/0.85::double precision))<>score`,[JSON.stringify(values)]);
  assert.equal(r.rows[0].mismatches,0);
 }finally{await db.close();}
});
