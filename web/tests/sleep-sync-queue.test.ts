import {test} from 'node:test';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';import {prepareOwnSleepDatabase} from './sleep-postgres-fixture';
import {PGlite} from '@electric-sql/pglite';
import {readSleepQueue,enqueueSleepOperation,sendFirstSleepOperation,sleepQueueKey,parseSleepSnapshot,type SleepOperation} from '../lib/sleep-sync-queue';
import type {Night} from '../components/sleep/sleep-state';
function memory(){const values=new Map<string,string>();return{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}};}
function operation():SleepOperation{
  const wake=Date.parse('2026-06-01T07:30:00+03:00');
  const night:Night={date:'2026-06-01',bed:wake-510*60000,wake,bedOffset:180,wakeOffset:180,
    bedClock:'23:00',wakeClock:'07:30',sleepMinutes:480,rested:3,target:{bed:'23:00',wake:'07:30',hours:8,tolerance:45},success:true};
  return{operationId:randomUUID(),date:night.date,expectedRevision:0,night};
}
test('05.02 queue: reload, immutable inputs, account separation and corruption preservation',()=>{
  const s=memory(),owner=randomUUID(),op=operation(),before=readSleepQueue(s,owner);
  const queued=enqueueSleepOperation(s,before,op);op.night!.rested=1;
  assert.equal(queued.operations[0].night?.rested,3);assert.deepEqual(readSleepQueue(s,owner),queued);
  assert.deepEqual(readSleepQueue(s,randomUUID()).operations,[]);
  assert.throws(()=>enqueueSleepOperation(s,before,operation()),/queue changed/);
  assert.throws(()=>enqueueSleepOperation(s,queued,operation()),/pending operation/);
  const damaged='{partial';s.setItem(sleepQueueKey(owner),damaged);
  assert.throws(()=>readSleepQueue(s,owner),/damaged/);assert.equal(s.getItem(sleepQueueKey(owner)),damaged);
});
test('05.02 queue: failed response/storage/conflict never clears an unconfirmed operation',async()=>{
  const s=memory(),owner=randomUUID(),q=enqueueSleepOperation(s,readSleepQueue(s,owner),operation());
  for(const rpc of [async()=>{throw Error('Network lost');},async()=>({data:null,error:{code:'conflict'}}),
    async()=>({data:{protocolVersion:1,garden:false,credits:[],deletedCredits:[],dates:[]},error:null}),
    async()=>({data:{protocolVersion:1,garden:false,credits:['2026-06-01'],deletedCredits:[],dates:[]},error:null})]){
    await assert.rejects(sendFirstSleepOperation(s,q,{rpc}));assert.deepEqual(readSleepQueue(s,owner),q);
  }
  const raw={protocolVersion:1,garden:false,credits:[q.operations[0].date],deletedCredits:[],dates:[{date:q.operations[0].date,revision:1,night:q.operations[0].night}]};
  const broken={getItem:s.getItem,setItem:()=>{throw Error('Disk full');}};
  await assert.rejects(sendFirstSleepOperation(broken,q,{rpc:async()=>({data:raw,error:null})}),/Disk full/);
  assert.deepEqual(readSleepQueue(s,owner),q);
  assert.throws(()=>parseSleepSnapshot({...raw,credits:['2026-06-01','2026-06-01']}),/reward snapshot/);
  // A change made while the response is in flight must survive acknowledgement.
  let changed=q;
  await assert.rejects(sendFirstSleepOperation(s,q,{rpc:async()=>{
    changed=enqueueSleepOperation(s,q,{operationId:randomUUID(),date:'2026-06-02',expectedRevision:0,night:null});
    return{data:raw,error:null};
  }}),/queue changed/);
  assert.deepEqual(readSleepQueue(s,owner),changed);assert.equal(changed.operations.length,2);
});
test('05.02 queue + actual SQL: lost response, restart, second client conflict, deleted replay and session change',async()=>{
  const db=new PGlite(),alice=randomUUID(),bob=randomUUID();
  try{
    await prepareOwnSleepDatabase(db,[alice,bob]);
    await db.query("select set_config('overman.owner_id',$1,false)",[alice]);await db.exec('set role overman_client');
    let loseResponse=true;const requests:unknown[]=[];
    const client={rpc:async(name:string,args:Record<string,unknown>)=>{
      assert.equal(name,'save_sleep_diary_operation');requests.push(structuredClone(args));
      try{const r=await db.query<{s:unknown}>('select public.save_sleep_diary_operation($1,$2,$3,$4::jsonb,$5) s',
        [args.p_operation,args.p_date,args.p_expected,args.p_night===null?null:JSON.stringify(args.p_night),args.p_expected_owner]);
        if(loseResponse){loseResponse=false;throw Error('Response lost after commit');}return{data:r.rows[0].s,error:null};
      }catch(error){return{data:null,error};}
    }};
    const first=memory(),second=memory(),op=operation();
    const firstQ=enqueueSleepOperation(first,readSleepQueue(first,alice),op);
    const secondQ=enqueueSleepOperation(second,readSleepQueue(second,alice),{...operation(),night:{...op.night!,rested:1}});
    await assert.rejects(sendFirstSleepOperation(first,firstQ,client),/not confirmed/);
    const afterRestart=readSleepQueue(first,alice);assert.deepEqual(afterRestart,firstQ);
    const confirmed=await sendFirstSleepOperation(first,afterRestart,client);
    assert.deepEqual(requests[0],requests[1]);assert.equal(confirmed?.snapshot.credits.length,1);
    assert.equal(confirmed?.queue.operations.length,0);
    await assert.rejects(sendFirstSleepOperation(second,secondQ,client),/not confirmed/);
    assert.deepEqual(readSleepQueue(second,alice),secondQ); // No automatic rebase or overwrite.
    const deleteQ=enqueueSleepOperation(first,readSleepQueue(first,alice),{...op,operationId:randomUUID(),expectedRevision:1,night:null});
    const removed=await sendFirstSleepOperation(first,deleteQ,client);assert.equal(removed?.snapshot.dates[0].night,null);
    assert.deepEqual(removed?.snapshot.deletedCredits,[op.date]);
    // Simulate an old device retrying a committed save after another device deleted it.
    const oldDevice=memory(),oldQ=enqueueSleepOperation(oldDevice,readSleepQueue(oldDevice,alice),op);
    const replay=await sendFirstSleepOperation(oldDevice,oldQ,client);
    assert.equal(replay?.snapshot.dates[0].night,null);assert.equal(replay?.snapshot.credits.length,1);
    const pending=enqueueSleepOperation(first,readSleepQueue(first,alice),{...op,operationId:randomUUID(),expectedRevision:2});
    await db.exec('reset role');await db.query("select set_config('overman.owner_id',$1,false)",[bob]);await db.exec('set role overman_client');
    await assert.rejects(sendFirstSleepOperation(first,pending,client),/not confirmed/);
    assert.deepEqual(readSleepQueue(first,alice),pending);
    const bobState=await db.query<{s:{dates:unknown[]}}>('select public.read_sleep_diary() s');assert.deepEqual(bobState.rows[0].s.dates,[]);
  }finally{await db.close();}
});

test('05.02 batch queue: 2000 reviewed dates become one immutable write; duplicate/capacity failures preserve storage',async()=>{
  const {enqueueSleepOperations}=await import('../lib/sleep-sync-queue');const s=memory(),owner=randomUUID(),before=readSleepQueue(s,owner),base=operation();let writes=0;
  const storage={getItem:s.getItem,setItem:(k:string,v:string)=>{writes++;s.setItem(k,v);}};
  const values=Array.from({length:2000},(_,i)=>{
    const wake=Date.parse('2000-01-01T07:30:00+03:00')+i*86400000,date=new Date(wake+180*60000).toISOString().slice(0,10);
    return{...base,operationId:randomUUID(),date,night:{...base.night!,date,bed:wake-510*60000,wake}};
  });
  const queued=enqueueSleepOperations(storage,before,values);assert.equal(writes,1);assert.equal(queued.revision,1);assert.equal(queued.operations.length,2000);
  values[0].night!.rested=1;assert.equal(readSleepQueue(s,owner).operations[0].night!.rested,3);
  const old=JSON.stringify(readSleepQueue(s,owner));assert.throws(()=>enqueueSleepOperations(storage,queued,[operation()]),/queue is full/);
  assert.equal(writes,1);assert.equal(JSON.stringify(readSleepQueue(s,owner)),old);
  const empty=memory();assert.throws(()=>enqueueSleepOperations(empty,readSleepQueue(empty,owner),[base,{...base,operationId:randomUUID()}]),/pending operation/);
  assert.equal(empty.getItem(sleepQueueKey(owner)),null);
});