/** Real loopback Go/PostgreSQL regression. Requires the NEW portable QA cluster.
 * Never imports the existing database helper, .env, or development credentials.
 * Tokens/passwords are generated in memory and excluded from every artifact.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,renameSync,openSync,closeSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {freshSleep,parseSleep,editNight,deleteNight,recordNight,SLEEP_KEY,type SleepState} from '../../web/components/sleep/sleep-state';
import {importHealthNight} from '../../web/components/sleep/sleep-health-import';
import {backupText,readBackup} from '../../web/components/sleep/sleep-insights';
import {persistSleepProductState,readSleepProductState} from '../../web/components/sleep/sleep-product-storage';
import {createSleepProductSync} from '../../web/lib/sleep-product-sync';
import {inspectSleepSyncArchive} from '../../web/lib/sleep-sync-archive';
import {createSleepAccount} from '../../web/lib/sleep-auth';
import {createSleepApi,SleepApiError} from '../../web/lib/sleep-api';

const root=fileURLToPath(new URL('../../',import.meta.url)),qa=resolve(root,'.tools/pg-fractional-qa');
const {Client}=createRequire(new URL('../package.json',import.meta.url))('pg');
const metadata=JSON.parse(readFileSync(resolve(qa,'test-metadata.json'),'utf8'));
assert.equal(metadata.kind,'overman-isolated-postgres-qa');assert.equal(metadata.host,'127.0.0.1');assert.equal(metadata.port,55437);
assert.match(metadata.database,/^overman_fractional_qa_[0-9a-f]{12}$/);
const base='http://127.0.0.1:3902',data=resolve(qa,'data'),bin=resolve(root,'.tools/postgres-18.7/binaries/pgsql/bin');
const params={host:'127.0.0.1',port:55437,database:metadata.database,user:'overman_qa_admin',password:'public-qa-placeholder-unused-with-trust',ssl:false,connectionTimeoutMillis:5000};
let admin=new Client(params);admin.on('error',()=>{});await admin.connect();
const actualData=(await admin.query('show data_directory')).rows[0].data_directory.replaceAll('\\','/').toLowerCase();assert.equal(actualData,data.replaceAll('\\','/').toLowerCase(),'Refuse an unrelated database');
const version=(await admin.query('show server_version')).rows[0].server_version;assert.match(version,/^18\.7/);
const directory=resolve(qa,'run-'+randomUUID());mkdirSync(directory);const checks:{name:string;status:'passed'}[]=[],pass=(name:string)=>{checks.push({name,status:'passed'});console.log('PASS '+name);};
const minute=60000,bed=Date.UTC(2026,0,2,23),wake=bed+510*minute+1,session={start:bed,end:wake,stages:[{start:bed,end:wake,kind:'sleeping' as const}]};
const initial=importHealthNight(freshSleep(),[session],0,{bed:0,wake:0},4,wake+minute);parseSleep(JSON.stringify(initial));const night=initial.nights[0];
const login='qa_'+randomUUID().replaceAll('-','').slice(0,20),password=randomBytes(32).toString('base64url');
let dropCommitted=false;
const actualFetch:typeof fetch=async(input,init)=>{
 const response=await fetch(input,init);
 if(dropCommitted&&new URL(String(input)).pathname==='/v1/diary/operations'&&response.ok){dropCommitted=false;await response.body?.cancel();throw Error('Controlled discard AFTER actual Go/PostgreSQL commit');}
 return response;
};
const archive=resolve(directory,'client.json'),backup=resolve(directory,'client.before-import.json');writeFileSync(archive,JSON.stringify(initial));
const storage={getItem(key:string){assert.ok([SLEEP_KEY,SLEEP_KEY+'.before-import'].includes(key));try{return readFileSync(key===SLEEP_KEY?archive:backup,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}},
 setItem(key:string,raw:string){assert.ok([SLEEP_KEY,SLEEP_KEY+'.before-import'].includes(key));const target=key===SLEEP_KEY?archive:backup,temp=target+'.'+randomUUID()+'.tmp';assert.equal(dirname(target),directory);writeFileSync(temp,raw);renameSync(temp,target);}};
let state=readSleepProductState(storage.getItem(SLEEP_KEY))!;
const make=()=>createSleepProductSync({getStorage:()=>storage,getState:()=>state,assertWritable:()=>{assert.equal(state.active,null);},onSaved:s=>{state=s;},allowLoopbackHttp:true,fetch:actualFetch,
 guardImport:async()=>{assert.equal(state.active,null);},prepareImportCommit:async next=>{assert.equal(next.active,null);assert.equal(next.alarm?.enabled??false,false);},restoreImportDevice:async previous=>{assert.equal(previous.active,null);}});
let controller=make();const directAccount=createSleepAccount({baseUrl:base,allowLoopbackHttp:true});
try{
 assert.deepEqual(await(await fetch(base+'/health')).json(),{database:'postgresql',protocolVersion:1,runtime:'go',status:'ok'});
 controller.configure(base);await controller.signIn('register',login,password);const owner=controller.view().profile!.userId;
 await controller.compare();controller.approve(true);assert.equal(inspectSleepSyncArchive(storage)?.pending,1);
 const queued=JSON.parse(storage.getItem(SLEEP_KEY)!)._sleepSync.queue.operations[0],before=storage.getItem(SLEEP_KEY);
 await assert.rejects(controller.sendNext());assert.equal(storage.getItem(SLEEP_KEY),before);assert.equal(inspectSleepSyncArchive(storage)?.pending,1);
 assert.equal((await admin.query('select count(*)::int n from public.sleep_reward_dates where user_id=$1',[owner])).rows[0].n,0);
 pass('Before011: actual product queue receives real Go422 for exact fractional night; disk archive stays byte-identical and PostgreSQL grants no reward');

 await admin.query(await readFile(resolve(root,'server/db/migrations/011_sleep_fractional_sync.sql'),'utf8'));
 dropCommitted=true;await assert.rejects(controller.sendNext());assert.equal(dropCommitted,false);assert.equal(storage.getItem(SLEEP_KEY),before);
 assert.equal((await admin.query('select count(*)::int n from public.sleep_reward_dates where user_id=$1',[owner])).rows[0].n,1);
 pass('After011: real server commits the same valid operation; discarding its actual HTTP response preserves the durable queue');

 state=readSleepProductState(readFileSync(archive,'utf8'))!;controller=make();controller.configure(base);assert.equal(controller.view().profile,null);await controller.signIn('login',login,password);
 const preview=await controller.sendNext();assert.equal(preview.reviewKind,'upload_receipt');assert.equal(storage.getItem(SLEEP_KEY),before);assert.throws(()=>controller.approve(false));controller.approve(true);
 assert.equal(inspectSleepSyncArchive(storage)?.pending,0);assert.deepEqual(state.credits,[night.date]);assert.equal(state.nights[0].sleepMinutes,night.sleepMinutes);
 pass('Fresh controller rereads actual disk queue; same-UUID network retry and explicit receipt approval retire it once, retaining one earned date');

 await directAccount.login(login,password);const api=createSleepApi({baseUrl:base,allowLoopbackHttp:true,getSession:directAccount.getSession});
 const replays=await Promise.all(Array.from({length:20},()=>api.saveOperation(queued,owner)));
 for(const reply of replays){assert.deepEqual(reply.credits,[night.date]);assert.equal(reply.dates[0].revision,1);}
 assert.equal((await admin.query('select count(*)::int n from public.sleep_reward_dates where user_id=$1',[owner])).rows[0].n,1);
 pass('Twenty concurrent real HTTP replays through product API adapter return one record/reward and revision1');

 const competing=await Promise.allSettled([1,2].map(rested=>api.saveOperation({...queued,operationId:randomUUID(),expectedRevision:1,night:{...night,rested}},owner)));
 assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);assert.equal(competing.filter(r=>r.status==='rejected'&&r.reason instanceof SleepApiError&&r.reason.code==='conflict').length,1);
 await controller.compare();controller.approve(true);assert.equal(state.credits.length,1);
 pass('Two real competing revisions produce one winner and one conflict; reviewed pull retains earned reward');

 const update=(next:SleepState)=>{state=persistSleepProductState(storage,SLEEP_KEY,state,next);};
 const send=async()=>{await controller.sendNext();controller.approve(true);assert.equal(inspectSleepSyncArchive(storage)?.pending,0);assert.deepEqual(state.credits,[night.date]);};
 update(editNight(state,state.nights[0],{...state.nights[0],sleepMinutes:100,latencyMinutes:0,awakeMinutes:night.sleepMinutes-100}));await send();assert.equal(state.nights[0].success,false);
 update(deleteNight(state,state.nights[0]));await send();assert.equal(state.nights.length,0);
 const stale=await api.saveOperation(queued,owner);assert.equal(stale.dates[0].night,null);assert.deepEqual(stale.credits,[night.date]);
 update(recordNight(state,{...night,rested:4}));await send();assert.equal(state.nights.length,1);
 pass('Actual product edit, delete, stale old-UUID replay and re-add preserve one earned date; stale retry never resurrects deleted night');

 const imported=readBackup(backupText(state));await controller.prepareImport(imported);await controller.startImport(true);await controller.approveImport(true);
 assert.equal(inspectSleepSyncArchive(storage)?.pending,0);assert.deepEqual(state.credits,[night.date]);assert.equal(state.nights.length,1);
 assert.equal((await admin.query('select count(*)::int n from public.sleep_reward_dates where user_id=$1',[owner])).rows[0].n,1);
 pass('Backup roundtrip plus real-network product import/review keeps one reward, with desktop-only inactive-alarm guards');

 const accountB=createSleepAccount({baseUrl:base,allowLoopbackHttp:true});const bob=await accountB.register('qa_'+randomUUID().replaceAll('-','').slice(0,20),randomBytes(32).toString('base64url'));
 const apiB=createSleepApi({baseUrl:base,allowLoopbackHttp:true,getSession:accountB.getSession});assert.equal((await apiB.readSnapshot()).snapshot.dates.length,0);
 await assert.rejects(apiB.saveOperation(queued,owner));await apiB.saveOperation(queued,bob.userId);assert.equal((await apiB.readSnapshot()).snapshot.credits.length,1);assert.equal((await api.readSnapshot()).snapshot.credits.length,1);await accountB.logout();
 pass('Two truly registered accounts keep the same date and UUID isolated under real opaque sessions');

 const beforeInvalid=(await api.readSnapshot()).snapshot,token=directAccount.getSession()!.token;
 const invalid=await fetch(base+'/v1/diary/operations',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({operationId:randomUUID(),date:night.date,expectedRevision:beforeInvalid.dates[0].revision,night:{...state.nights[0],sleepMinutes:night.sleepMinutes+.001},expectedOwnerId:owner})});
 assert.equal(invalid.status,422);assert.deepEqual(await invalid.json(),{error:'invalid_diary_operation'});assert.deepEqual((await api.readSnapshot()).snapshot,beforeInvalid);
 pass('Raw real HTTP material overrun is rejected422 without reward, diary, or SQL-detail leakage');

 let seed=0x05a21;
 for(let i=0;i<1000;i++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;const start=Date.UTC(2026,0,2),end=start+3600000+seed%79200000;
  const sample=importHealthNight(freshSleep(),[{start,end,stages:[{start,end,kind:'sleeping'}]}],0,{bed:0,wake:0},4,end+minute).nights[0];
  await admin.query('select public.validate_sleep_night($1::jsonb,$2::date)',[JSON.stringify(sample),sample.date]);
  if(i%100===0)await assert.rejects(admin.query('select public.validate_sleep_night($1::jsonb,$2::date)',[JSON.stringify({...sample,sleepMinutes:sample.sleepMinutes+.001}),sample.date]));
 }
 pass('1000 deterministic valid fractional durations pass actual PostgreSQL validation; sampled material overruns fail');

 const restricted=new Client({...params,user:'overman_qa_runtime'});await restricted.connect();try{await assert.rejects(restricted.query('select * from public.sleep_diary_dates'),e=>e.code==='42501');await assert.rejects(restricted.query('select * from overman.credentials'),e=>e.code==='42501');}finally{await restricted.end();}
 const beforeRestart=(await api.readSnapshot()).snapshot,rawBeforeRestart=readFileSync(archive,'utf8');await admin.end();
 execFileSync(resolve(bin,'pg_ctl.exe'),['stop','-D',data,'-m','fast','-w','-t','20'],{windowsHide:true,stdio:'pipe',timeout:30000});
 const log=openSync(resolve(qa,'postgres-restart.log'),'a');const pg=spawn(resolve(bin,'postgres.exe'),['-D',data,'-h','127.0.0.1','-p','55437','-c','max_connections=20','-c','shared_buffers=32MB'],{detached:true,windowsHide:true,stdio:['ignore',log,log]});pg.unref();closeSync(log);writeFileSync(resolve(qa,'postgres-process-id.txt'),String(pg.pid));
 let healthy=false;for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).status===200){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert.equal(healthy,true);
 admin=new Client(params);admin.on('error',()=>{});await admin.connect();assert.deepEqual((await api.readSnapshot()).snapshot,beforeRestart);assert.equal(readFileSync(archive,'utf8'),rawBeforeRestart);assert.deepEqual((await api.saveOperation(queued,owner)).credits,[night.date]);
 pass('Only the verified QA PostgreSQL cluster restarted; real Go pool reconnects and sessions, disk archive, receipts and earned date persist');

 const raw=readFileSync(archive,'utf8');assert.equal(raw.includes(password),false);assert.equal(raw.includes(token),false);const counts=await admin.query('select count(*)::int reward_dates from public.sleep_reward_dates where user_id=$1',[owner]);assert.equal(counts.rows[0].reward_dates,1);
 const result={requirementId:'05.02',result:'partial',verifiedAt:new Date().toISOString(),database:'PostgreSQL '+version,runtime:'actual Go API',endpoint:base,checks,
  limitations:['New loopback synthetic database only; no personal/remote database or deployment touched.','Node product-controller and real disk archive; no physical phone, installed-APK HTTPS, notification, or sensor-quality acceptance.','Controlled lost reply discarded a real committed HTTP body; actual airplane-mode or radio interruption not tested.','Import device guards cover only inactive desktop alarm state; no native alarm claims.'],
  migration011Sha256:createHash('sha256').update(await readFile(resolve(root,'server/db/migrations/011_sleep_fractional_sync.sql'))).digest('hex'),rewardDatesForMainActor:1,rawArchiveSha256:createHash('sha256').update(raw).digest('hex')};
 await writeFile(resolve(root,'docs/product-evidence/05.02-standalone-postgres-20261113.json'),JSON.stringify(result,null,2)+'\n');console.log('All real PostgreSQL/Go regression checks passed; requirement remains unaccepted pending remaining UI/current-APK review.');
}finally{await directAccount.logout().catch(()=>{});await controller.logout().catch(()=>{});await admin.end().catch(()=>{});}
