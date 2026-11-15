import{test}from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import{PGlite}from'@electric-sql/pglite';
import{prepareOwnSleepDatabase}from'./sleep-postgres-fixture';import{parseSleepSnapshot,validateSleepLegacyCredits,type SleepSnapshot}from'../lib/sleep-sync-queue';
import{validateSleepSnapshotProgress}from'../lib/sleep-sync-reconcile';
test('05.02 SQL legacy import: provenance, idempotency, existing payloads and ownership',async t=>{
 const db=new PGlite(),owner=randomUUID(),other=randomUUID();try{await prepareOwnSleepDatabase(db,[owner,other]);await db.query("select set_config('overman.owner_id',$1,false)",[owner]);await db.exec('set role overman_client');
 const claim=async(id:string,dates:unknown,garden=false,expected=owner)=>{const r=await db.query<{v:{snapshot:SleepSnapshot}}>('select public.import_legacy_sleep_credits($1,$2::jsonb,$3,$4) v',[id,JSON.stringify(dates),garden,expected]);return r.rows[0].v;};
 await t.test('date-only tombstones have labelled credits but no invented successful nights; garden requires its own claim',async()=>{
  const id=randomUUID(),first=await claim(id,['2026-06-02','2026-06-01']);const snapshot=parseSleepSnapshot(first.snapshot);assert.deepEqual(snapshot.credits,['2026-06-01','2026-06-02']);assert.deepEqual(snapshot.legacyCredits,snapshot.credits);assert.equal(snapshot.legacyGarden,false);assert.equal(snapshot.garden,false);
  assert.ok(snapshot.dates.every(d=>d.night===null&&d.revision===1));assert.deepEqual(snapshot.deletedCredits,snapshot.credits);
  assert.deepEqual(await claim(id,['2026-06-01','2026-06-02']),first);assert.deepEqual((await claim(randomUUID(),['2026-06-02'])).snapshot,snapshot);
  const garden=(await claim(randomUUID(),[],true)).snapshot;assert.equal(garden.garden,true);assert.equal(garden.legacyGarden,true);assert.equal(garden.credits.length,2);
 });
 await t.test('changed UUID payload, duplicate/invalid dates, owner mismatch and private table access reject',async()=>{
  const id=randomUUID();await claim(id,['2026-05-01']);await assert.rejects(claim(id,['2026-05-02']),/identifier reused/);
  for(const dates of [['2026-02-30'],['2026-06-01','2026-06-01'],['9999-01-01'],[null],['2026-6-1'],[]])await assert.rejects(claim(randomUUID(),dates));
  await assert.rejects(claim(randomUUID(),['2026-06-01'],false,other),/owner changed/);
  await assert.rejects(db.query('select * from public.sleep_legacy_credit_dates'),/permission denied/);
 });
 await t.test('legacy UUID cannot enter diary/cancellation protocol; cancelled UUID cannot become a legacy receipt',async()=>{
  const id=randomUUID();await claim(id,['2026-04-01']);await assert.rejects(db.query('select public.save_sleep_diary_operation($1,$2,0,null,$3)',[id,'2026-04-02',owner]),/another reward protocol/);
  await assert.rejects(db.query('select public.cancel_sleep_diary_operation($1,$2)',[id,owner]),/another reward protocol/);
  const cancelled=randomUUID();await db.query('select public.cancel_sleep_diary_operation($1,$2)',[cancelled,owner]);await assert.rejects(claim(cancelled,['2026-04-03']),/another reward protocol/);
 });
 await t.test('corrected unsuccessful night keeps payload, advances revision for imported credit; later success is one credit',async()=>{
  const wake=Date.parse('2026-03-01T07:30:00+03:00'),night={date:'2026-03-01',bed:wake-510*60000,wake,bedOffset:180,wakeOffset:180,bedClock:'23:00',wakeClock:'07:30',sleepMinutes:0,rested:3,target:{bed:'23:00',wake:'07:30',hours:8,tolerance:45},success:false};
  const save=async(op:string,rev:number,n:unknown)=>{const r=await db.query<{v:SleepSnapshot}>('select public.save_sleep_diary_operation($1,$2,$3,$4::jsonb,$5) v',[op,night.date,rev,JSON.stringify(n),owner]);return r.rows[0].v;};
  const old=await save(randomUUID(),0,night),after=(await claim(randomUUID(),[night.date])).snapshot;
  assert.equal(after.dates.find(d=>d.date===night.date)!.revision,2);assert.deepEqual(after.dates.find(d=>d.date===night.date)!.night,old.dates.find(d=>d.date===night.date)!.night);
  validateSleepSnapshotProgress(owner,{ownerId:owner,snapshot:old},{ownerId:owner,snapshot:after});
  const success=await save(randomUUID(),2,{...night,sleepMinutes:480,success:true});assert.equal(success.credits.filter(d=>d===night.date).length,1);assert.ok(success.legacyCredits?.includes(night.date));
 });
 await t.test('same operation UUID in another account stays independent',async()=>{
  const id=randomUUID();await claim(id,['2026-02-01']);await db.query("select set_config('overman.owner_id',$1,false)",[other]);const bob=(await claim(id,['2026-02-02'],false,other)).snapshot;assert.deepEqual(bob.credits,['2026-02-02']);assert.deepEqual(bob.legacyCredits,['2026-02-02']);
 });
 }finally{await db.close();}
});

test('05.02 strict legacy snapshot/operation parsing and monotonic provenance',()=>{
 const ownerId=randomUUID(),op=validateSleepLegacyCredits({operationId:randomUUID(),dates:['2026-06-02','2026-06-01'],garden:false});assert.deepEqual(op.dates,['2026-06-01','2026-06-02']);
 for(const bad of [{...op,night:null},{...op,dates:[]},{...op,dates:[null]},{...op,dates:['2026-06-01','2026-06-01']}])assert.throws(()=>validateSleepLegacyCredits(bad));
 const snapshot:SleepSnapshot={protocolVersion:1,garden:true,credits:['2026-06-01'],deletedCredits:['2026-06-01'],dates:[{date:'2026-06-01',revision:1,night:null}],legacyCredits:['2026-06-01'],legacyGarden:true};parseSleepSnapshot(snapshot);
 for(const bad of [{...snapshot,legacyCredits:['2026-06-02']},{...snapshot,legacyCredits:undefined},{...snapshot,legacyGarden:null},{...snapshot,garden:false}])assert.throws(()=>parseSleepSnapshot(bad));
 const removed={...snapshot};delete removed.legacyCredits;delete removed.legacyGarden;assert.throws(()=>validateSleepSnapshotProgress(ownerId,{ownerId,snapshot},{ownerId,snapshot:removed}),/provenance moved backwards/);
});