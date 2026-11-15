import{test}from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import {prepareOwnSleepDatabase} from './sleep-postgres-fixture';
import{PGlite}from'@electric-sql/pglite';
import{openSleepSyncArchive,sleepDiaryForExport}from'../lib/sleep-sync-archive';
import{enqueueSleepOperation,sendFirstSleepOperation,parseSleepSnapshot}from'../lib/sleep-sync-queue';
import{reviewSleepReconciliation}from'../lib/sleep-sync-reconcile';
import{freshSleep,recordNight,persistSleep,SLEEP_KEY,parseSleep,sleepWorld}from'../components/sleep/sleep-state';
import{createSleepStorage}from'../components/sleep/sleep-storage';
const now=Date.parse('2026-11-08T12:00:00Z'),wake=Date.parse('2026-06-01T07:30:00+03:00');
const input={bed:wake-510*60000,wake,bedOffset:180,wakeOffset:180,sleepMinutes:480,rested:3};
function file(raw:string){let value=raw,writes=0,fail=false;return{
  getItem:(key:string)=>{assert.equal(key,SLEEP_KEY);return value;},
  setItem:(key:string,v:string)=>{assert.equal(key,SLEEP_KEY);if(fail)throw Error('Disk full');value=v;writes++;},
  get raw(){return value;},get writes(){return writes;},set fail(v:boolean){fail=v;},external:(v:string)=>{value=v;}
};}
function queued(storage:ReturnType<typeof file>,owner:string){
  const tx=openSleepSyncArchive(storage,owner),before=tx.diary,next=recordNight(before,input,now);
  persistSleep(tx.storage,SLEEP_KEY,before,next);
  const n=tx.diary.nights[0],op={operationId:randomUUID(),date:n.date,expectedRevision:0,night:n};
  enqueueSleepOperation(tx.storage,tx.queue,op);return{tx,op};
}
test('05.02 one archive commit binds diary and queue; abort/no-op/reload/export are safe',()=>{
  const s=file(JSON.stringify(freshSleep())),original=s.raw,owner=randomUUID();
  const {tx}=queued(s,owner);assert.equal(s.raw,original);assert.equal(s.writes,0);
  tx.abort();assert.equal(s.raw,original);assert.throws(()=>tx.commit(owner),/closed/);
  const retry=queued(s,owner);const saved=retry.tx.commit(owner);
  assert.equal(s.writes,1);assert.equal(saved.revision,1);assert.equal(saved.nights.length,1);
  const cold=openSleepSyncArchive(s,owner);assert.equal(cold.queue.operations.length,1);assert.deepEqual(cold.diary,saved);
  cold.commit(owner);assert.equal(s.writes,1);
  const exported=sleepDiaryForExport(s.raw);assert.ok(!exported.includes('_sleepSync'));assert.ok(!exported.includes(owner));
  assert.deepEqual(parseSleep(exported),saved);
  assert.throws(()=>openSleepSyncArchive(s,randomUUID()),/owner changed/);
});
test('05.02 disk error and competing archive change preserve the complete old envelope',()=>{
  const owner=randomUUID(),s=file(JSON.stringify(freshSleep())),old=s.raw;
  const {tx}=queued(s,owner);s.fail=true;
  assert.throws(()=>tx.commit(owner),/Disk full/);assert.equal(s.raw,old);assert.equal(s.writes,0);
  s.fail=false;tx.commit(owner);const original=s.raw,open=openSleepSyncArchive(s,owner);
  const newer={...JSON.parse(original),revision:2,theme:'light'};s.external(JSON.stringify(newer));
  assert.throws(()=>open.commit(owner),/archive changed/);assert.equal(s.raw,JSON.stringify(newer));
  const again=openSleepSyncArchive(s,owner);
  assert.throws(()=>again.commit(randomUUID()),/owner changed/);assert.equal(s.raw,JSON.stringify(newer));
});
test('05.02 malformed metadata is never reset; imported metadata cannot rebind an account',()=>{
  const owner=randomUUID(),s=file(JSON.stringify(freshSleep()));queued(s,owner).tx.commit(owner);
  const original=s.raw,bad={...JSON.parse(original),_sleepSync:{version:99}};s.external(JSON.stringify(bad));
  assert.throws(()=>openSleepSyncArchive(s,owner),/metadata damaged/);assert.equal(s.raw,JSON.stringify(bad));
  assert.ok(!sleepDiaryForExport(s.raw).includes('_sleepSync'));
  s.external(original);const tx=openSleepSyncArchive(s,owner);
  tx.storage.setItem(SLEEP_KEY,JSON.stringify({...tx.diary,_sleepSync:{ownerId:randomUUID(),token:'fictional'}}));
  assert.throws(()=>tx.storage.getItem('foreign-key'),/Unsupported/);
  assert.throws(()=>tx.storage.setItem('foreign-key','{}'),/Unsupported/);
  tx.commit(owner);const cold=openSleepSyncArchive(s,owner);
  assert.equal(cold.queue.ownerId,owner);assert.equal(cold.queue.operations.length,1);assert.ok(!s.raw.includes('fictional'));
});
test('05.02 unknown transport fields and oversized staged data are rejected without changing the archive',()=>{
  const owner=randomUUID(),s=file(JSON.stringify(freshSleep())),old=s.raw,tx=openSleepSyncArchive(s,owner);
  assert.throws(()=>parseSleepSnapshot({protocolVersion:1,garden:false,credits:[],deletedCredits:[],dates:[],unexpected:'fixture'}),/Invalid server/);
  assert.throws(()=>tx.storage.setItem(SLEEP_KEY,JSON.stringify({...tx.diary,padding:'x'.repeat(3000000)})));
  assert.equal(s.raw,old);tx.commit(owner);assert.equal(s.writes,0);
  queued(s,owner).tx.commit(owner);const root=JSON.parse(s.raw);root._sleepSync.queue.unexpected='fixture';s.external(JSON.stringify(root));
  const corrupted=s.raw;assert.throws(()=>openSleepSyncArchive(s,owner),/queue is damaged/);assert.equal(s.raw,corrupted);
});
test('05.02 reading a valid combined archive does not force a potentially oversized history merge',()=>{
  const owner=randomUUID(),local=freshSleep();
  const nights=(start:string)=>Array.from({length:2000},(_,i)=>{
    const wake=Date.parse(start+'T07:30:00+03:00')+i*86400000;
    return{date:new Date(wake+180*60000).toISOString().slice(0,10),bed:wake-510*60000,wake,
      bedOffset:180,wakeOffset:180,bedClock:'23:00',wakeClock:'07:30',sleepMinutes:0,rested:3,
      target:{bed:'23:00',wake:'07:30',hours:8,tolerance:45},success:false};
  });
  local.nights=nights('2000-01-01');
  const remote=parseSleepSnapshot({protocolVersion:1,garden:false,credits:[],deletedCredits:[],
    dates:nights('2010-01-01').map(n=>({date:n.date,revision:1,night:n}))});
  const raw=JSON.stringify({...local,_sleepSync:{version:1,ownerId:owner,
    queue:{version:1,ownerId:owner,revision:0,operations:[]},baseline:{ownerId:owner,snapshot:remote}}});
  const s=file(raw),tx=openSleepSyncArchive(s,owner);assert.equal(tx.diary.nights.length,2000);assert.equal(tx.baseline?.snapshot.dates.length,2000);
  assert.throws(()=>reviewSleepReconciliation(tx.diary,owner,null,{ownerId:owner,snapshot:remote}));
  tx.abort();assert.equal(s.raw,raw);assert.equal(s.writes,0);
});
test('05.02 receipt cannot remove durable pending data until the reviewed snapshot is staged',async()=>{
  const owner=randomUUID(),s=file(JSON.stringify(freshSleep()));queued(s,owner).tx.commit(owner);const original=s.raw;
  const tx=openSleepSyncArchive(s,owner),op=tx.queue.operations[0];
  const snapshot=parseSleepSnapshot({protocolVersion:1,garden:false,credits:[op.date],deletedCredits:[],dates:[{date:op.date,revision:1,night:op.night}]});
  await sendFirstSleepOperation(tx.storage,tx.queue,{rpc:async()=>({data:snapshot,error:null})});
  assert.equal(tx.queue.operations.length,0);assert.equal(s.raw,original);
  assert.throws(()=>tx.commit(owner),/reviewed server receipt/);assert.equal(s.raw,original);
  const review=reviewSleepReconciliation(tx.diary,owner,tx.baseline,{ownerId:owner,snapshot});
  tx.applyReview(review,true);tx.commit(owner);
  const cold=openSleepSyncArchive(s,owner);assert.equal(cold.queue.operations.length,0);assert.equal(cold.baseline?.snapshot.dates[0].revision,1);
  assert.equal(cold.diary.credits.length,1);assert.equal(cold.diary.revision,2);
});
test('05.02 actual SQL + staged archive: commit failure after server acknowledgement retries once after cold read',async()=>{
  const db=new PGlite(),owner=randomUUID();
  try{
    await prepareOwnSleepDatabase(db,[owner]);
    await db.query("select set_config('overman.owner_id',$1,false)",[owner]);await db.exec('set role overman_client');
    const requests:unknown[]=[];
    const client={rpc:async(_name:string,args:Record<string,unknown>)=>{requests.push(structuredClone(args));
      const r=await db.query<{s:unknown}>('select public.save_sleep_diary_operation($1,$2,$3,$4::jsonb,$5) s',
        [args.p_operation,args.p_date,args.p_expected,JSON.stringify(args.p_night),args.p_expected_owner]);return{data:r.rows[0].s,error:null};}};
    const s=file(JSON.stringify(freshSleep()));queued(s,owner).tx.commit(owner);const durable=s.raw;
    let tx=openSleepSyncArchive(s,owner),result=await sendFirstSleepOperation(tx.storage,tx.queue,client);
    assert.ok(result);tx.applyReview(reviewSleepReconciliation(tx.diary,owner,tx.baseline,{ownerId:owner,snapshot:result.snapshot}),true);
    s.fail=true;assert.throws(()=>tx.commit(owner),/Disk full/);assert.equal(s.raw,durable);
    // Recreate all transient state: only the old combined file survives.
    s.fail=false;tx=openSleepSyncArchive(s,owner);assert.equal(tx.queue.operations.length,1);
    result=await sendFirstSleepOperation(tx.storage,tx.queue,client);assert.ok(result);
    tx.applyReview(reviewSleepReconciliation(tx.diary,owner,tx.baseline,{ownerId:owner,snapshot:result.snapshot}),true);
    tx.commit(owner);assert.deepEqual(requests[0],requests[1]);
    const cold=openSleepSyncArchive(s,owner);assert.equal(cold.queue.operations.length,0);assert.equal(cold.diary.nights.length,1);
    assert.equal(cold.diary.credits.length,1);assert.equal(cold.baseline?.snapshot.credits.length,1);
    assert.equal(sleepWorld(cold.diary,now).xp,sleepWorld(recordNight(freshSleep(),input,now),now).xp);
  }finally{await db.close();}
});
test('05.02 existing native adapter receives exactly one combined write; mirror failure does not split it',()=>{
  const owner=randomUUID(),initial=JSON.stringify(freshSleep());let native=initial,writes=0;
  const mirror={length:1,key:()=>SLEEP_KEY,getItem:()=>initial,setItem:()=>{throw Error('Mirror full');},removeItem:()=>{},clear:()=>{}};
  const adapter=createSleepStorage(mirror,{readSleepArchive:()=>JSON.stringify({raw:native}),
    writeSleepArchive:(key,expected,raw)=>{assert.equal(key,SLEEP_KEY);assert.equal(expected,initial);writes++;native=raw;return '';}});
  const tx=openSleepSyncArchive(adapter,owner),before=tx.diary;
  persistSleep(tx.storage,SLEEP_KEY,before,recordNight(before,input,now));const n=tx.diary.nights[0];
  enqueueSleepOperation(tx.storage,tx.queue,{operationId:randomUUID(),date:n.date,expectedRevision:0,night:n});
  tx.commit(owner);assert.equal(writes,1);
  const cold=openSleepSyncArchive({getItem:()=>native,setItem:()=>{throw Error('Read only');}},owner);
  assert.equal(cold.diary.nights.length,1);assert.equal(cold.queue.operations.length,1);
  // Actual JS adapter with a bridge fixture; no Android AtomicFile run claimed.
});
