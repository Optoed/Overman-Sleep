import{test}from'node:test';import assert from'node:assert/strict';import{randomUUID,randomBytes,createHash}from'node:crypto';import{readFileSync,writeFileSync,renameSync,mkdirSync,readdirSync}from'node:fs';import{join}from'node:path';import{spawnSync}from'node:child_process';
import{databasePool}from'../src/database.mjs';import{createSleepApi,SleepApiError}from'../../web/lib/sleep-api';import{prepareSleepLegacyMigration,resumeSleepLegacyMigration,stopSleepLegacyMigration}from'../../web/lib/sleep-sync-legacy';import{prepareSleepSyncPull}from'../../web/lib/sleep-sync-engine';import{openSleepSyncArchive}from'../../web/lib/sleep-sync-archive';import{freshSleep,SLEEP_KEY}from'../../web/components/sleep/sleep-state';import{validateSleepSnapshotProgress}from'../../web/lib/sleep-sync-reconcile';
const base='http://127.0.0.1:3902',root=join('server','.local','legacy-qa-'+randomUUID()),checks:string[]=[];mkdirSync(root,{recursive:true});
const role=spawnSync('docker',['inspect','--format','{{index .Config.Labels "app.overman.role"}}','overman-api-dev'],{encoding:'utf8',windowsHide:true});assert.equal(role.stdout.trim(),'dev-api');
class Archive{readonly path:string;fail=false;constructor(name:string,raw=JSON.stringify(freshSleep())){this.path=join(root,name+'.json');writeFileSync(this.path,raw,{flag:'wx'});}getItem(key:string){assert.equal(key,SLEEP_KEY);return readFileSync(this.path,'utf8');}setItem(key:string,raw:string){assert.equal(key,SLEEP_KEY);if(this.fail)throw Error('Controlled legacy file failure');const tmp=this.path+'.next';writeFileSync(tmp,raw);renameSync(tmp,this.path);}get raw(){return this.getItem(SLEEP_KEY);}}
function night(date='2026-06-01',success=true){const wake=Date.parse(date+'T07:30:00+03:00');return{date,bed:wake-510*60000,wake,bedOffset:180,wakeOffset:180,bedClock:'23:00',wakeClock:'07:30',sleepMinutes:success?480:0,rested:3,target:{bed:'23:00',wake:'07:30',hours:8,tolerance:45},success,note:'Synthetic existing night'};}
test('05.02 legacy dates + actual Go/PostgreSQL + SDK + explicit reconciliation and two filesystem archives',async t=>{
 const admin=databasePool({admin:true,max:1}),runtime=databasePool({max:1});admin.on('error',()=>{});runtime.on('error',()=>{});
 try{
  async function identity(){const ownerId=randomUUID(),token=randomBytes(32).toString('base64url');await admin.query('insert into overman.users(id) values($1)',[ownerId]);await admin.query("insert into overman.sessions values($1,$2,now()+interval '1 hour',false)",[createHash('sha256').update(token).digest(),ownerId]);return{ownerId,token};}
  const alice=await identity(),bob=await identity(),make=(user=alice,fetcher:typeof fetch=fetch)=>createSleepApi({baseUrl:base,allowLoopbackHttp:true,getSession:()=>user,fetch:fetcher}),api=make(),claim={operationId:randomUUID(),dates:['2026-05-01','2026-05-02'],garden:true};
  const local={...freshSleep(),credits:claim.dates,deletedCredits:claim.dates,garden:true},A=new Archive('first-link',JSON.stringify(local)),B=new Archive('second');
  await t.test('first-link date-only credits block until explicit labelled import; lost reply and20 concurrent retries never add nights or duplicate credits',async()=>{
   const before=A.raw,p=await prepareSleepSyncPull(A,alice.ownerId,api);assert.equal(p.review.unverifiedCredits.length,2);assert.throws(()=>p.approve(true,alice.ownerId),/explicit migration/);assert.equal(A.raw,before);
   let lose=true;const lossy=make(alice,async(input,init)=>{const response=await fetch(input,init);if(String(input).endsWith('/legacy-credits')&&lose){lose=false;await response.body?.cancel();throw Error('Discard committed legacy reply');}return response;});
   const options={getOwnerId:()=>alice.ownerId},migration=await prepareSleepLegacyMigration(A,alice.ownerId,lossy,options);assert.ok(migration);claim.operationId=migration.operation.operationId;await assert.rejects(migration.start(true));const paused=A.raw;assert.notEqual(paused,before);assert.deepEqual(JSON.parse(paused).credits,claim.dates);
   const retries=await Promise.all(Array.from({length:20},()=>api.importLegacyCredits(claim,alice.ownerId)));
   for(const r of retries){assert.deepEqual(r.snapshot.credits,claim.dates);assert.deepEqual(r.snapshot.legacyCredits,claim.dates);assert.equal(r.snapshot.legacyGarden,true);assert.ok(r.snapshot.dates.every(d=>d.night===null&&d.revision===1));}
   const ready=await resumeSleepLegacyMigration(A,alice.ownerId,api,options);assert.equal(ready.review.unverifiedCredits.length,0);A.fail=true;assert.throws(()=>ready.approve(true),/Controlled legacy file failure/);assert.equal(A.raw,paused);A.fail=false;const final=await resumeSleepLegacyMigration(A,alice.ownerId,api,options);final.approve(true);
   checks.push('Actual legacy first-link gate, explicitly invoked claim, lost post-commit reply and20 parallel same-UUID retries: labelled two credits/garden, zero invented nights; durable intent and original diary survive lost reply/final file failure; cold same-batch coordinator resume applies one approved archive');
  });
  await t.test('second filesystem client restores date-only history; repeated different UUID claim does not add credit or revision',async()=>{
   const before=(await api.readSnapshot()).snapshot;await api.importLegacyCredits({...claim,operationId:randomUUID()},alice.ownerId);assert.deepEqual((await api.readSnapshot()).snapshot,before);
   const pull=await prepareSleepSyncPull(B,alice.ownerId,api);pull.approve(true,alice.ownerId);const tx=openSleepSyncArchive(B,alice.ownerId);assert.equal(tx.diary.nights.length,0);assert.deepEqual(tx.diary.credits,claim.dates);assert.deepEqual(tx.diary.deletedCredits,claim.dates);assert.deepEqual(tx.baseline!.snapshot.legacyCredits,claim.dates);tx.abort();
   checks.push('Actual second filesystem-client cold pull restores date-only credits/garden and provenance baseline; different migration UUID leaves credits/revisions unchanged');
  });
  await t.test('later successful night on migrated date and original receipt replay preserve one credit per date',async()=>{
   const result=await api.saveOperation({operationId:randomUUID(),date:claim.dates[0],expectedRevision:1,night:night(claim.dates[0])},alice.ownerId);assert.equal(result.dates[0].revision,2);assert.equal(result.credits.length,2);assert.deepEqual(result.legacyCredits,claim.dates);
   const replay=await api.importLegacyCredits(claim,alice.ownerId);assert.equal(replay.snapshot.dates[0].revision,2);assert.equal(replay.snapshot.dates[0].night!.success,true);assert.equal(replay.snapshot.credits.length,2);
   checks.push('Actual full-night save after migrated tombstone uses revision1, remains two total credits; old migration UUID returns latest revision2 without reverting night');
  });
  await t.test('existing unsuccessful corrected night keeps exact payload while legacy credit advances its revision',async()=>{
   const user=await identity(),client=make(user),n=night('2026-03-01',false),old=await client.saveOperation({operationId:randomUUID(),date:n.date,expectedRevision:0,night:n},user.ownerId);
   const receipt=await client.importLegacyCredits({operationId:randomUUID(),dates:[n.date],garden:false},user.ownerId);assert.deepEqual(receipt.snapshot.dates[0].night,old.dates[0].night);assert.equal(receipt.snapshot.dates[0].revision,2);assert.deepEqual(receipt.snapshot.legacyCredits,[n.date]);assert.equal(receipt.snapshot.garden,false);
   validateSleepSnapshotProgress(user.ownerId,{ownerId:user.ownerId,snapshot:old},{ownerId:user.ownerId,snapshot:receipt.snapshot});
   checks.push('Actual unsuccessful existing night preserved byte-equivalent in canonical JSON; imported earned credit advances revision1 to2, carries provenance and does not create garden');
  });
  await t.test('controlled AFTER INSERT fault rolls back all dates, provenance, garden and receipt; same UUID retries successfully',async()=>{
   const user=await identity(),client=make(user),op={operationId:randomUUID(),dates:['2026-02-01','2026-02-02'],garden:true},fn='overman_test_legacy_failure';const before=(await client.readSnapshot()).snapshot;
   await admin.query(`create function public.${fn}() returns trigger language plpgsql as $$begin if new.user_id='${user.ownerId}'::uuid and new.wake_date=date '2026-02-02' then raise exception 'Controlled legacy failure';end if;return new;end$$;create trigger ${fn} after insert on public.sleep_legacy_credit_dates for each row execute function public.${fn}();`);
   try{await assert.rejects(client.importLegacyCredits(op,user.ownerId),e=>e instanceof SleepApiError&&e.status===422);assert.deepEqual((await client.readSnapshot()).snapshot,before);assert.equal((await admin.query('select count(*)::int n from public.sleep_legacy_credit_receipts where user_id=$1',[user.ownerId])).rows[0].n,0);}
   finally{await admin.query(`drop trigger ${fn} on public.sleep_legacy_credit_dates;drop function public.${fn}()`);}
   assert.equal((await client.importLegacyCredits(op,user.ownerId)).snapshot.credits.length,2);
   checks.push('Real SQL AFTER INSERT fault on second date rolls back ledger/provenance/garden/receipt atomically; same UUID succeeds once after controlled trigger removal');
  });
  await t.test('HTTP boundaries, owner/session/private table guard and cross-protocol UUID collision hold',async()=>{
   const post=async(body:unknown,auth=alice.token)=>fetch(base+'/v1/diary/legacy-credits',{method:'POST',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:JSON.stringify(body)});
   assert.equal((await fetch(base+'/v1/diary/legacy-credits',{method:'POST'})).status,401);assert.equal((await fetch(base+'/v1/diary/legacy-credits')).status,405);
   const value={...claim,expectedOwnerId:alice.ownerId};assert.equal((await post({...value,night:night()})).status,400);assert.equal((await post({...value,expectedOwnerId:bob.ownerId})).status,403);
   for(const dates of [['2026-02-30'],['2026-06-01','2026-06-01'],['9999-01-01']])assert.equal((await post({...value,operationId:randomUUID(),dates})).status,422);
   await assert.rejects(runtime.query('select * from public.sleep_legacy_credit_receipts'),e=>e.code==='42501');
   await assert.rejects(api.saveOperation({operationId:claim.operationId,date:'2026-01-01',expectedRevision:0,night:null},alice.ownerId),e=>e instanceof SleepApiError&&e.code==='conflict');
   const pending={operationId:randomUUID(),date:'2026-01-01',expectedRevision:0,night:null};await api.cancelOperation(pending,alice.ownerId);await assert.rejects(api.importLegacyCredits({...claim,operationId:pending.operationId},alice.ownerId),e=>e instanceof SleepApiError&&e.code==='conflict');
   await assert.rejects(api.cancelOperation({...pending,operationId:claim.operationId},alice.ownerId),e=>e instanceof SleepApiError&&e.code==='conflict');
   assert.equal((await make(bob).importLegacyCredits({operationId:claim.operationId,dates:['2026-01-02'],garden:false},bob.ownerId)).snapshot.credits.length,1);
   checks.push('Actual401/405/extra night400/owner403/invalid dates422/private table42501; legacy/save/cancel UUID domains reject conflicts409 while identical UUID under another account is independent');
  });
  await t.test('2000-date import respects archive capacity, no seven-success garden is inferred; overflow rolls back',async()=>{
   const user=await identity(),client=make(user),dates=Array.from({length:2000},(_,i)=>new Date(Date.UTC(2000,0,1)+i*86400000).toISOString().slice(0,10)),op={operationId:randomUUID(),dates,garden:false};
   const full=(await client.importLegacyCredits(op,user.ownerId)).snapshot;assert.equal(full.credits.length,2000);assert.equal(full.legacyCredits!.length,2000);assert.equal(full.garden,false);assert.ok(full.dates.every(d=>d.night===null));
   await assert.rejects(client.importLegacyCredits({operationId:randomUUID(),dates:['2026-01-01'],garden:true},user.ownerId),e=>e instanceof SleepApiError&&e.status===422);assert.deepEqual((await client.readSnapshot()).snapshot,full);
   checks.push('Actual2000-date HTTP/SQL boundary accepted without invented nights/streak garden;2001st distinct date rejected atomically and full snapshot unchanged');
  });
  await t.test('stopping unknown-outcome local retry preserves diary and later pull restores committed additive server claim',async()=>{
   const user=await identity(),client=make(user),day='2026-01-10',archive=new Archive('stop-retry',JSON.stringify({...freshSleep(),credits:[day],deletedCredits:[day]})),options={getOwnerId:()=>user.ownerId};let lose=true;
   const lossy=make(user,async(input,init)=>{const response=await fetch(input,init);if(String(input).endsWith('/legacy-credits')&&lose){lose=false;await response.body?.cancel();throw Error('Discard committed legacy reply');}return response;});
   const p=await prepareSleepLegacyMigration(archive,user.ownerId,lossy,options);assert.ok(p);await assert.rejects(p.start(true));const saved=stopSleepLegacyMigration(archive,user.ownerId,options,true);assert.deepEqual(saved.credits,[day]);assert.equal(saved.nights.length,0);
   const pull=await prepareSleepSyncPull(archive,user.ownerId,client);pull.approve(true,user.ownerId);const cold=openSleepSyncArchive(archive,user.ownerId);assert.deepEqual(cold.baseline!.snapshot.legacyCredits,[day]);assert.equal(cold.diary.credits.length,1);cold.abort();
   checks.push('Actual unknown-outcome committed claim: explicit stop clears only local retry intent, keeps earned diary/queue; later normal pull restores labelled server claim once without pretending to undo it');
  });
  await t.test('same UUID concurrent legacy/save requests serialize with one committed protocol and one credit',async()=>{
   for(let i=0;i<10;i++){const user=await identity(),client=make(user),id=randomUUID(),migration={operationId:id,dates:['2026-01-11'],garden:false},operation={operationId:id,date:'2026-01-12',expectedRevision:0,night:night('2026-01-12')};
    const requests=i%2?[client.importLegacyCredits(migration,user.ownerId),client.saveOperation(operation,user.ownerId)]:[client.saveOperation(operation,user.ownerId),client.importLegacyCredits(migration,user.ownerId)];
    const results=await Promise.allSettled(requests);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);for(const r of results)if(r.status==='rejected')assert.ok(r.reason instanceof SleepApiError&&r.reason.code==='conflict');
    const snapshot=(await client.readSnapshot()).snapshot;assert.equal(snapshot.credits.length,1);assert.equal(snapshot.dates.length,1);const overlap=await client.importLegacyCredits({operationId:randomUUID(),dates:[snapshot.credits[0]],garden:false},user.ownerId);assert.deepEqual(overlap.snapshot,snapshot);
    if(snapshot.credits[0]==='2026-01-12')assert.equal(snapshot.legacyCredits,undefined);
   }
   checks.push('Ten actual same-UUID legacy/save races serialize on owner lock: one protocol commits and one409, one credit/date; overlap with verified credit does not relabel it legacy');
  });
  await t.test('own database restart retains legacy origins and idempotent receipt',async()=>{
   const before=(await api.readSnapshot()).snapshot;const label=spawnSync('docker',['inspect','--format','{{index .Config.Labels "app.overman.role"}}','overman-postgres-dev'],{encoding:'utf8',windowsHide:true});assert.equal(label.stdout.trim(),'dev-db');const restart=spawnSync('docker',['restart','overman-postgres-dev'],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(restart.status,0);
   let ready=false;for(let i=0;i<40;i++){try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert(ready);assert.deepEqual((await api.importLegacyCredits(claim,alice.ownerId)).snapshot,before);
   checks.push('Only labelled own PostgreSQL restarted: imported credits/garden/provenance and old-UUID latest-state replay survive exactly');
  });
  writeFileSync('docs/product-evidence/05.02-own-legacy-20261109-real.json',JSON.stringify({requirementId:'05.02',result:'passed',verifiedAt:new Date().toISOString(),checks:checks.map(name=>({name,passed:true})),archiveDirectory:root,archiveFiles:readdirSync(root).filter(n=>!n.endsWith('.next')),baseUrl:base,
   scope:'Actual own Go/PostgreSQL, TypeScript SDK, explicit reconciliation and two synthetic filesystem clients. Faults/response discard labelled. Legacy claims preserve self-declared prior rewards, not proof of successful sleep. No automatic product migration coordinator/UI/Android/physical phone; no credential artifacts.'},null,2)+'\n');
 }finally{await admin.end();await runtime.end();}
});