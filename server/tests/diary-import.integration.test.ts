import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,mkdirSync,readdirSync} from 'node:fs';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
import {databasePool} from '../src/database.mjs';import {createSleepApi,type SleepApiSession} from '../../web/lib/sleep-api';
import {openSleepSyncArchive,readSleepImportPause} from '../../web/lib/sleep-sync-archive';import {persistSleepSyncEdit} from '../../web/lib/sleep-sync-edit';
import {prepareSleepSyncPull,prepareSleepSyncUpload} from '../../web/lib/sleep-sync-engine';
import {prepareSleepSyncImport,resumeSleepSyncImport,recoverPausedSleepImport} from '../../web/lib/sleep-sync-import';
import {freshSleep,recordNight,SLEEP_KEY,type SleepState} from '../../web/components/sleep/sleep-state';
const base='http://127.0.0.1:3902',root=join('server','.local','import-qa-'+randomUUID()),checks:string[]=[];
const role=spawnSync('docker',['inspect','--format','{{index .Config.Labels "app.overman.role"}}','overman-api-dev'],{encoding:'utf8',windowsHide:true});assert.equal(role.stdout.trim(),'dev-api');mkdirSync(root,{recursive:true});
class Archive{
 readonly path:string;fail=false;writes=0;
 constructor(name:string){this.path=join(root,name+'.json');writeFileSync(this.path,JSON.stringify(freshSleep()),{flag:'wx'});}
 getItem(key:string){assert.equal(key,SLEEP_KEY);return readFileSync(this.path,'utf8');}
 setItem(key:string,raw:string){assert.equal(key,SLEEP_KEY);if(this.fail)throw Error('Controlled final file failure');const tmp=this.path+'.next';writeFileSync(tmp,raw);renameSync(tmp,this.path);this.writes++;}
 backupOriginal(raw:string){writeFileSync(this.path+'.before-import',raw);}
 get raw(){return this.getItem(SLEEP_KEY);}
}
const api=(session:()=>SleepApiSession|null,fetcher:typeof fetch=fetch)=>createSleepApi({baseUrl:base,allowLoopbackHttp:true,getSession:session,fetch:fetcher});
test('05.02 confirmed import + durable pause + real Go/PostgreSQL + separate filesystem clients',async t=>{
 const admin=databasePool({admin:true,max:1});admin.on('error',()=>{});
 try{
  async function identity(){const ownerId=randomUUID(),token=randomBytes(32).toString('base64url');await admin.query('insert into overman.users(id) values($1)',[ownerId]);await admin.query("insert into overman.sessions values($1,$2,now()+interval '1 hour',false)",[createHash('sha256').update(token).digest(),ownerId]);return{ownerId,token};}
  async function fixture(name:string){const user=await identity(),s=new Archive(name),c=api(()=>user);const link=await prepareSleepSyncPull(s,user.ownerId,c);link.approve(true,user.ownerId);
   const tx=openSleepSyncArchive(s,user.ownerId),before=tx.diary;tx.abort();const wake=Date.parse('2026-06-01T07:30:00+03:00');
   persistSleepSyncEdit(s,user.ownerId,before,recordNight(before,{bed:wake-510*60000,wake,bedOffset:180,wakeOffset:180,sleepMinutes:480,rested:3,note:'Original synthetic'},Date.now()));
   const cold=openSleepSyncArchive(s,user.ownerId),original=cold.diary,op=cold.queue.operations[0];cold.abort();
   const source={...original,nights:original.nights.map(n=>({...n,note:'Imported synthetic'}))};
   const options={getOwnerId:()=>user.ownerId,backupOriginal:(raw:string)=>s.backupOriginal(raw)};
   return{user,s,c,op,source,original,options};
  }
  async function send(f:Awaited<ReturnType<typeof fixture>>){const p=await prepareSleepSyncUpload(f.s,f.user.ownerId,f.c);assert.ok(p);return p.approve(true,f.user.ownerId);}
  await t.test('lost cancellation reply pauses outgoing work across cold resume, then imports and syncs once to second client',async()=>{
   const f=await fixture('lost'),before=f.s.raw;let lost=false;
   const lossy=api(()=>f.user,async(input,init)=>{const response=await fetch(input,init);if(String(input).endsWith('/cancellations')&&!lost){lost=true;await response.body?.cancel();throw Error('Discard committed cancel response');}return response;});
   const p=await prepareSleepSyncImport(f.s,f.user.ownerId,f.source,lossy,f.options);await assert.rejects(p.start(true));
   assert.equal(readFileSync(f.s.path+'.before-import','utf8'),before);assert.ok(readSleepImportPause(f.s,f.user.ownerId));
   await assert.rejects(prepareSleepSyncUpload(f.s,f.user.ownerId,f.c),/Import is paused/);assert.equal((await f.c.readSnapshot()).snapshot.dates.length,0);
   const ready=await resumeSleepSyncImport(f.s,f.user.ownerId,f.source,f.c,f.options);ready.approve(true);await send(f);
   await assert.rejects(f.c.saveOperation(f.op,f.user.ownerId),e=>e instanceof Error&&'code'in e&&e.code==='conflict');
   const second=new Archive('lost-second'),pull=await prepareSleepSyncPull(second,f.user.ownerId,f.c);pull.approve(true,f.user.ownerId);
   const cold=openSleepSyncArchive(second,f.user.ownerId);assert.equal(cold.diary.nights[0].note,'Imported synthetic');assert.equal(cold.diary.credits.length,1);assert.equal(cold.queue.operations.length,0);cold.abort();
   checks.push('Actual post-commit cancellation response lost; cold durable fence blocks upload, same UUID retry resumes import; new UUID syncs one credit to second filesystem client and late old UUID409');
  });
  await t.test('already applied pending operation imports at revision1, old replay keeps latest note and one credit',async()=>{
   const f=await fixture('applied');await f.c.saveOperation(f.op,f.user.ownerId);
   const p=await prepareSleepSyncImport(f.s,f.user.ownerId,f.source,f.c,f.options),ready=await p.start(true);ready.approve(true);
   const tx=openSleepSyncArchive(f.s,f.user.ownerId);assert.equal(tx.queue.operations[0].expectedRevision,1);tx.abort();await send(f);
   const replay=await f.c.saveOperation(f.op,f.user.ownerId);assert.equal(replay.dates[0].revision,2);assert.equal(replay.dates[0].night!.note,'Imported synthetic');assert.equal(replay.credits.length,1);
   checks.push('Actual already-applied cancellation returns applied snapshot; imported edit uses revision1; old committed UUID replay returns latest revision2 and one credit');
  });
  await t.test('failed final file commit keeps fence; explicit original recovery requeues original under fresh UUID',async()=>{
   const f=await fixture('recover'),p=await prepareSleepSyncImport(f.s,f.user.ownerId,f.source,f.c,f.options),ready=await p.start(true),fenced=f.s.raw;
   f.s.fail=true;assert.throws(()=>ready.approve(true),/Controlled final file/);assert.equal(f.s.raw,fenced);f.s.fail=false;
   const recovery=await recoverPausedSleepImport(f.s,f.user.ownerId,f.c,f.options);recovery.approve(true);
   const tx=openSleepSyncArchive(f.s,f.user.ownerId);assert.notEqual(tx.queue.operations[0].operationId,f.op.operationId);assert.equal(tx.diary.nights[0].note,'Original synthetic');tx.abort();await send(f);
   assert.equal((await f.c.readSnapshot()).snapshot.credits.length,1);await assert.rejects(f.c.saveOperation(f.op,f.user.ownerId));
   checks.push('Real final archive rename/write failure preserves paused bytes; cold explicit original recovery creates fresh UUID, syncs original note once, old cancelled UUID still rejects');
  });
  await t.test('imported deletion retains earned credit and propagates tombstone to another client',async()=>{
   const f=await fixture('delete');await f.c.saveOperation(f.op,f.user.ownerId);const source={...f.original,nights:[],deletedCredits:[f.op.date]};
   const p=await prepareSleepSyncImport(f.s,f.user.ownerId,source,f.c,f.options),ready=await p.start(true);ready.approve(true);await send(f);
   const replay=await f.c.saveOperation(f.op,f.user.ownerId);assert.equal(replay.dates[0].night,null);assert.equal(replay.dates[0].revision,2);assert.equal(replay.credits.length,1);
   const second=new Archive('delete-second'),pull=await prepareSleepSyncPull(second,f.user.ownerId,f.c);pull.approve(true,f.user.ownerId);
   const tx=openSleepSyncArchive(second,f.user.ownerId);assert.equal(tx.diary.nights.length,0);assert.deepEqual(tx.diary.deletedCredits,[f.op.date]);assert.equal(tx.diary.credits.length,1);tx.abort();
   checks.push('Real applied-date import deletion preserves earned credit; tombstone revision2 survives old UUID replay and second filesystem-client cold pull');
  });
  await t.test('account changes after server cancellation cannot attach response or drop pending locally',async()=>{
   const f=await fixture('switch'),other=await identity();let session:SleepApiSession|null=f.user;
   const c=api(()=>session,async(input,init)=>{const response=await fetch(input,init);if(String(input).endsWith('/cancellations'))session=other;return response;});
   const options={...f.options,getOwnerId:()=>session?.ownerId??null},p=await prepareSleepSyncImport(f.s,f.user.ownerId,f.source,c,options);await assert.rejects(p.start(true));assert.ok(readSleepImportPause(f.s,f.user.ownerId));
   assert.deepEqual((await api(()=>other).readSnapshot()).snapshot.dates,[]);session=f.user;
   const ready=await resumeSleepSyncImport(f.s,f.user.ownerId,f.source,f.c,options);ready.approve(true);await send(f);assert.equal((await f.c.readSnapshot()).snapshot.credits.length,1);
   checks.push('Actual account switch after Go cancellation commit rejects response locally and keeps fence/pending; other account stays empty; original account resumes without duplicate credit');
  });
  await t.test('second client edit after import preview causes real409, preserving queued imported content until explicit review',async()=>{
   const f=await fixture('race'),p=await prepareSleepSyncImport(f.s,f.user.ownerId,f.source,f.c,f.options),ready=await p.start(true);
   await f.c.saveOperation({...f.op,operationId:randomUUID(),night:{...f.op.night!,note:'Second client edit'}},f.user.ownerId);ready.approve(true);const before=f.s.raw;
   await assert.rejects(send(f));assert.equal(f.s.raw,before);
   const review=await prepareSleepSyncPull(f.s,f.user.ownerId,f.c);assert.equal(review.review.conflicts.length,1);review.choose({[f.op.date]:'local'});review.approve(true,f.user.ownerId);await send(f);
   const remote=(await f.c.readSnapshot()).snapshot;assert.equal(remote.dates[0].revision,2);assert.equal(remote.dates[0].night!.note,'Imported synthetic');assert.equal(remote.credits.length,1);
   checks.push('Actual second-client update after import preview rejects stale queued revision409 without data loss; explicit local conflict choice uploads revision2 with one credit');
  });
  writeFileSync('docs/product-evidence/05.02-own-import-20261109-real.json',JSON.stringify({requirementId:'05.02',result:'passed',verifiedAt:new Date().toISOString(),checks:checks.map(name=>({name,passed:true})),archiveDirectory:root,archiveFiles:readdirSync(root).filter(n=>!n.endsWith('.next')),baseUrl:base,
   scope:'Actual prepared import coordinator, own Go/PostgreSQL HTTP, synthetic sessions and separate filesystem archives/backups. Controlled lost response/file failure/account switch labelled. Not product SleepApp UI/native AtomicFile/Android/physical phone; no tokens in artifacts.'},null,2)+'\n');
 }finally{await admin.end();}
});