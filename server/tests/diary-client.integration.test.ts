import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {databasePool} from '../src/database.mjs';
import {createSleepApi,type SleepApiSession} from '../../web/lib/sleep-api';
import {openSleepSyncArchive} from '../../web/lib/sleep-sync-archive';
import {persistSleepSyncEdit} from '../../web/lib/sleep-sync-edit';
import {prepareSleepSyncPull,prepareSleepSyncUpload} from '../../web/lib/sleep-sync-engine';
import {freshSleep,recordNight,SLEEP_KEY,sleepWorld,type SleepState} from '../../web/components/sleep/sleep-state';
const base='http://127.0.0.1:3902',runId=randomUUID(),root=join('server','.local','transport-qa-'+runId),checks:string[]=[];
const label=spawnSync('docker',['inspect','--format','{{index .Config.Labels "app.overman.role"}}','overman-api-dev'],{encoding:'utf8',windowsHide:true});
assert.equal(label.stdout.trim(),'dev-api');
mkdirSync(root,{recursive:true});
class Archive{
  readonly path:string;fail=false;writes=0;
  constructor(name:string,raw=JSON.stringify({...freshSleep(),bed:'23:00',wake:'07:30',hours:8,tolerance:45})){this.path=join(root,name+'.json');writeFileSync(this.path,raw,{flag:'wx'});}
  getItem(key:string){assert.equal(key,SLEEP_KEY);return readFileSync(this.path,'utf8');}
  setItem(key:string,raw:string){assert.equal(key,SLEEP_KEY);if(this.fail)throw Error('Controlled file write failure');
    const temp=this.path+'.next';writeFileSync(temp,raw);renameSync(temp,this.path);this.writes++;}
  get raw(){return this.getItem(SLEEP_KEY);}
}
const api=(getSession:()=>SleepApiSession|null,fetcher:typeof fetch=fetch)=>createSleepApi({baseUrl:base,allowLoopbackHttp:true,getSession,fetch:fetcher});
async function newNight(s:Archive,owner:string,client:ReturnType<typeof api>,day='2026-06-01'){
  let tx=openSleepSyncArchive(s,owner);const linked=tx.baseline!==null;tx.abort();
  if(!linked){const link=await prepareSleepSyncPull(s,owner,client);link.approve(true,owner);}
  tx=openSleepSyncArchive(s,owner);const before=tx.diary;tx.abort();
  const wake=Date.parse(day+'T07:30:00+03:00');
  const next=recordNight(before,{bed:wake-510*60000,wake,bedOffset:180,wakeOffset:180,sleepMinutes:480,rested:3,note:'Synthetic diary'},Date.now());
  persistSleepSyncEdit(s,owner,before,next);
  const cold=openSleepSyncArchive(s,owner),op=cold.queue.operations.find(op=>op.date===day)!;
  assert.ok(op);assert.equal(op.night!.success,true);cold.abort();return op;
}
function edit(s:Archive,owner:string,note:string){
  const tx=openSleepSyncArchive(s,owner),before=tx.diary;tx.abort();
  persistSleepSyncEdit(s,owner,before,{...before,nights:before.nights.map(n=>n.date==='2026-06-01'?{...n,note}:n)});
  const cold=openSleepSyncArchive(s,owner),op=cold.queue.operations.find(op=>op.date==='2026-06-01')!;cold.abort();return op;
}
async function send(s:Archive,owner:string,client:ReturnType<typeof api>,chooseServer=false){
  const pending=await prepareSleepSyncUpload(s,owner,client);assert.ok(pending);
  if(chooseServer)pending.choose({'2026-06-01':'server'});
  return pending.approve(true,owner);
}

test('05.02 ordinary edits + sync coordinator + HTTP + real Go/PostgreSQL + separate durable client archives',async t=>{
  const admin=databasePool({admin:true,max:1});admin.on('error',()=>{});
  try{
    const health=await(await fetch(base+'/health')).json();assert.equal(health.runtime,'go');assert.equal(health.database,'postgresql');
    async function identity(){const ownerId=randomUUID(),token=randomBytes(32).toString('base64url');
      await admin.query('insert into overman.users(id) values($1)',[ownerId]);
      await admin.query("insert into overman.sessions values($1,$2,now()+interval '1 hour',false)",[createHash('sha256').update(token).digest(),ownerId]);return{ownerId,token};}
    const alice=await identity(),bob=await identity();const A=new Archive('client-a'),B=new Archive('client-b');
    const normal=api(()=>alice),first=await newNight(A,alice.ownerId,normal),oldDeviceRaw=A.raw;
    await t.test('committed response loss, cold read, failed local commit and same-UUID replay keep one credit',async()=>{
      let lost=false;const lossy=api(()=>alice,async(input,init)=>{
        const response=await fetch(input,init);if(init?.method==='POST'&&!lost){lost=true;await response.body?.cancel();throw Error('Discard committed response');}return response;
      });
      const before=A.raw;await assert.rejects(send(A,alice.ownerId,lossy));assert.equal(A.raw,before);
      assert.equal((await normal.readSnapshot()).snapshot.credits.length,1);
      A.fail=true;await assert.rejects(send(A,alice.ownerId,normal),/Controlled file write failure/);assert.equal(A.raw,before);
      A.fail=false;const result=await send(A,alice.ownerId,normal);assert.equal(result.credits.length,1);
      const cold=openSleepSyncArchive(A,alice.ownerId);assert.equal(cold.queue.operations.length,0);assert.equal(cold.baseline!.snapshot.dates[0].revision,1);cold.abort();
      checks.push('Actual committed Go response discarded; durable queue survives cold read and failed file commit; same UUID retry produces one credit');
    });
    await t.test('second durable client restores real snapshot; divergent writes preserve conflict and local note',async()=>{
      const restored=await prepareSleepSyncPull(B,alice.ownerId,normal);restored.approve(true,alice.ownerId);
      edit(A,alice.ownerId,'Device A edit');const staleB=edit(B,alice.ownerId,'Device B edit');
      await send(A,alice.ownerId,normal);const before=B.raw;
      await assert.rejects(send(B,alice.ownerId,normal));assert.equal(B.raw,before);
      const preview=await prepareSleepSyncPull(B,alice.ownerId,normal),review=preview.review;
      assert.equal(review.conflicts.length,1);assert.equal(review.conflicts[0].local?.note,'Device B edit');assert.equal(review.conflicts[0].server?.note,'Device A edit');
      assert.throws(()=>preview.approve(true,alice.ownerId),/Review every conflict/);assert.equal(B.raw,before);
      const approved=await prepareSleepSyncPull(B,alice.ownerId,normal);approved.choose({'2026-06-01':'server'});approved.approve(true,alice.ownerId);
      const cold=openSleepSyncArchive(B,alice.ownerId);assert.equal(cold.queue.operations.length,0);assert.equal(cold.diary.nights[0].note,'Device A edit');cold.abort();
      await assert.rejects(normal.saveOperation(staleB,alice.ownerId),e=>e instanceof Error&&'code' in e&&e.code==='conflict');
      assert.equal((await normal.readSnapshot()).snapshot.dates[0].night!.note,'Device A edit');
      checks.push('Real second-client 409 preserved local pending data until explicit server choice; advanced-revision stale UUID retired atomically and late retry still rejects');
    });
    await t.test('server deletion cannot be reversed by old committed UUID from a cold client',async()=>{
      const tx=openSleepSyncArchive(A,alice.ownerId),before=tx.diary;tx.abort();
      persistSleepSyncEdit(A,alice.ownerId,before,{...before,nights:before.nights.filter(n=>n.date!==first.date),deletedCredits:[first.date]});
      const deleted=await send(A,alice.ownerId,normal);assert.equal(deleted.nights.length,0);assert.equal(deleted.credits.length,1);
      const C=new Archive('old-device',oldDeviceRaw);await send(C,alice.ownerId,normal,true);
      const cold=openSleepSyncArchive(C,alice.ownerId);assert.equal(cold.queue.operations.length,0);assert.equal(cold.diary.nights.length,0);
      assert.deepEqual(cold.diary.deletedCredits,[first.date]);assert.equal(cold.baseline!.snapshot.dates[0].revision,3);cold.abort();
      checks.push('Real tombstone revision survives replay of old committed UUID; explicit server choice saves deletion and retained single credit in cold archive');
    });
    await t.test('real account mismatch and account switch after commit cannot attach another account response',async()=>{
      const wrong=api(()=>({ownerId:alice.ownerId,token:bob.token}));await assert.rejects(wrong.readSnapshot(),e=>e instanceof Error&&/account changed/.test(e.message));
      const bobApi=api(()=>bob);assert.deepEqual((await bobApi.readSnapshot()).snapshot.dates,[]);
      await newNight(A,alice.ownerId,normal,'2026-06-02');const before=A.raw;let current:SleepApiSession|null=alice;
      const switching=api(()=>current,async(input,init)=>{const response=await fetch(input,init);if(init?.method==='POST')current=bob;return response;});
      await assert.rejects(send(A,alice.ownerId,switching));assert.equal(A.raw,before);
      assert.deepEqual((await bobApi.readSnapshot()).snapshot.dates,[]);
      const saved=await send(A,alice.ownerId,normal);assert.equal(saved.credits.length,2);assert.equal(saved.nights.length,1);
      assert.equal((await normal.readSnapshot()).snapshot.credits.length,2);
      const final=openSleepSyncArchive(A,alice.ownerId);assert.equal(final.queue.operations.length,0);final.abort();
      checks.push('Two real sessions: wrong token-owner pair rejected; account switch after Go commit preserves pending UUID and retry once; other account remains empty');
    });
    await t.test('ordinary offline edits keep the old UUID; reviewed ACK queues and sends the latest content once',async()=>{
      const D=new Archive('client-bob'),bobApi=api(()=>bob),original=await newNight(D,bob.ownerId,bobApi,'2026-06-03');
      const tx=openSleepSyncArchive(D,bob.ownerId),before=tx.diary;tx.abort();
      persistSleepSyncEdit(D,bob.ownerId,before,{...before,nights:before.nights.map(n=>({...n,note:'Later offline edit'}))});
      let cold=openSleepSyncArchive(D,bob.ownerId);assert.equal(cold.queue.operations[0].operationId,original.operationId);cold.abort();
      const receipt=await prepareSleepSyncUpload(D,bob.ownerId,bobApi);assert.ok(receipt);assert.equal(receipt.review.conflicts.length,1);
      receipt.choose({'2026-06-03':'local'});receipt.approve(true,bob.ownerId);
      cold=openSleepSyncArchive(D,bob.ownerId);const latest=cold.queue.operations[0];assert.notEqual(latest.operationId,original.operationId);assert.equal(latest.expectedRevision,1);cold.abort();
      await send(D,bob.ownerId,bobApi);
      const replay=await bobApi.saveOperation(original,bob.ownerId);assert.equal(replay.dates[0].revision,2);assert.equal(replay.dates[0].night!.note,'Later offline edit');assert.equal(replay.credits.length,1);
      cold=openSleepSyncArchive(D,bob.ownerId);assert.equal(cold.queue.operations.length,0);assert.equal(cold.diary.credits.length,1);cold.abort();
      assert.equal((await normal.readSnapshot()).snapshot.credits.length,2);
      checks.push('Real ordinary-edit outbox: offline edit preserves initial UUID, explicit ACK review queues fresh revision, latest upload and original replay keep one credit and latest note');
    });
    const state=openSleepSyncArchive(A,alice.ownerId),summary={nights:state.diary.nights.length,credits:state.diary.credits.length,floors:sleepWorld(state.diary).floors,pending:state.queue.operations.length};state.abort();
    writeFileSync('docs/product-evidence/05.02-own-edit-20261109-real.json',JSON.stringify({requirementId:'05.02',result:'passed',verifiedAt:new Date().toISOString(),checks:checks.map(name=>({name,passed:true})),
      summary,baseUrl:base,scope:'Actual sync review coordinator, Go HTTP and dedicated Docker PostgreSQL, two synthetic accounts and four separate real filesystem archives. No network/DB mock. File failure and discarded post-commit response are controlled fault injection. Not a browser/SleepApp/Android/physical-device test; no token/password artifacts.',archiveDirectory:root},null,2)+'\n');
  }finally{await admin.end();}
});