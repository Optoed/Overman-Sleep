import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {PGlite} from '@electric-sql/pglite';
import {prepareOwnSleepDatabase} from './sleep-postgres-fixture';
const day='2026-06-01',wake=Date.parse(day+'T07:30:00+03:00');
const night={date:day,bed:wake-510*60000,wake,bedOffset:180,wakeOffset:180,bedClock:'23:00',wakeClock:'07:30',sleepMinutes:480,rested:3,target:{bed:'23:00',wake:'07:30',hours:8,tolerance:45},success:true};
test('05.02 own SQL cancellation: never applied, already applied, identity and private implementation',async t=>{
 const db=new PGlite(),alice=randomUUID(),bob=randomUUID();try{
  await prepareOwnSleepDatabase(db,[alice,bob]);
  const as=async(id:string)=>{await db.exec('reset role');await db.query("select set_config('overman.owner_id',$1,false)",[id]);await db.exec('set role overman_client');};
  type State={credits:string[];dates:{revision:number;night:unknown}[]};type Receipt={ownerId:string;operationId:string;cancelled:boolean;snapshot:State};
  const cancel=async(id:string,owner=alice)=>
   (await db.query<{s:Receipt}>('select public.cancel_sleep_diary_operation($1,$2) s',[id,owner])).rows[0].s;
  const save=async(id:string,n:unknown=night,owner=alice)=>
   (await db.query<{s:State}>('select public.save_sleep_diary_operation($1,$2,0,$3::jsonb,$4) s',[id,day,n===null?null:JSON.stringify(n),owner])).rows[0].s;
  await as(alice);
  await t.test('cancellation retries reserve only that UUID; later save cannot create a night or reward',async()=>{
   const id=randomUUID(),first=await cancel(id);assert.equal(first.cancelled,true);assert.equal(first.ownerId,alice);assert.equal(first.operationId,id);
   assert.deepEqual(first.snapshot.dates,[]);assert.deepEqual(await cancel(id),first);await assert.rejects(save(id),/was cancelled/);
   assert.equal((await cancel(id)).cancelled,true);await assert.rejects(save(id,{...night,note:'Changed'}),/was cancelled/);
  });
  await t.test('an applied operation cannot be undone by cancellation; replay stays idempotent',async()=>{
   const id=randomUUID(),applied=await save(id),receipt=await cancel(id);assert.equal(receipt.cancelled,false);
   assert.deepEqual(receipt.snapshot,applied);assert.equal(receipt.snapshot.credits.length,1);assert.deepEqual(await save(id),applied);
   assert.equal((await cancel(id)).cancelled,false);
  });
  await t.test('cross-owner guard and private table/renamed implementation prevent bypass',async()=>{
   await assert.rejects(cancel(randomUUID(),bob),/owner changed/);
   await assert.rejects(db.query('select * from public.sleep_diary_cancellations'),/permission denied/);
   await assert.rejects(db.query('select public.save_sleep_diary_operation_v1($1,$2,0,$3::jsonb,$4)',[randomUUID(),day,JSON.stringify(night),alice]),/permission denied/);
   const id=randomUUID();await cancel(id);await as(bob);const independent=await save(id,night,bob);assert.equal(independent.credits.length,1);
   await as('');await assert.rejects(cancel(randomUUID()),/Authentication required/);
  });
 }finally{await db.close();}
});