import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';import {writeFileSync} from 'node:fs';import {databasePool} from '../src/database.mjs';
const base=process.env.OVERMAN_API_TEST_URL||'http://127.0.0.1:3902';
if(!['http://127.0.0.1:3901','http://127.0.0.1:3902'].includes(base))throw Error('Dedicated loopback API required');
const label=spawnSync('docker',['inspect','--format','{{index .Config.Labels "app.overman.role"}}','overman-api-dev'],{encoding:'utf8',windowsHide:true});assert.equal(label.stdout.trim(),'dev-api');
function operation(date='2026-06-01'){
 const wake=Date.parse(date+'T07:30:00+03:00');return{operationId:randomUUID(),date,expectedRevision:0,
 night:{date,bed:wake-510*60000,wake,bedOffset:180,wakeOffset:180,bedClock:'23:00',wakeClock:'07:30',sleepMinutes:480,rested:3,target:{bed:'23:00',wake:'07:30',hours:8,tolerance:45},success:true}};
}
test('05.02 real Go/PostgreSQL cancellation: commit loss, applied operation, race, isolation and restart',async t=>{
 const admin=databasePool({admin:true}),runtime=databasePool();admin.on('error',()=>{});runtime.on('error',()=>{});const checks=[];
 try{
  async function identity(){const id=randomUUID(),token=randomBytes(32).toString('base64url');await admin.query('insert into overman.users(id) values($1)',[id]);
   await admin.query("insert into overman.sessions values($1,$2,now()+interval '1 hour',false)",[createHash('sha256').update(token).digest(),id]);return{id,token};}
  const alice=await identity(),bob=await identity(),cancelled=operation(),applied=operation('2026-06-02');
  const call=async(user,path,op)=>{const response=await fetch(base+path,{method:op?'POST':'GET',headers:{Authorization:'Bearer '+user.token,...(op?{'Content-Type':'application/json'}:{})},
   ...(op?{body:JSON.stringify(path.endsWith('/cancellations')?{operationId:op.operationId,expectedOwnerId:user.id}:{...op,expectedOwnerId:user.id})}:{})});return{status:response.status,body:await response.json()};};
  const cancel=(u,o)=>call(u,'/v1/diary/cancellations',o),save=(u,o)=>call(u,'/v1/diary/operations',o),read=u=>call(u,'/v1/diary');
  await t.test('lost cancellation response and parallel retries never create its night/reward',async()=>{
   const lost=await fetch(base+'/v1/diary/cancellations',{method:'POST',headers:{Authorization:'Bearer '+alice.token,'Content-Type':'application/json'},body:JSON.stringify({operationId:cancelled.operationId,expectedOwnerId:alice.id})});
   assert.equal(lost.status,200);await lost.body.cancel();
   const retries=await Promise.all(Array.from({length:20},(_,i)=>i%2?cancel(alice,cancelled):save(alice,cancelled)));
   for(let i=0;i<retries.length;i++){assert.equal(retries[i].status,i%2?200:409);if(i%2)assert.equal(retries[i].body.cancelled,true);}
   assert.deepEqual((await read(alice)).body.dates,[]);assert.deepEqual((await read(alice)).body.credits,[]);
   assert.equal((await cancel(alice,cancelled)).body.cancelled,true);
   assert.equal((await admin.query('select fingerprint from public.sleep_diary_cancellations where user_id=$1 and operation_id=$2',[alice.id,cancelled.operationId])).rows[0].fingerprint,null);
   checks.push('Real post-commit cancellation response discarded; 20 concurrent cancel/save retries retain one cancellation and no diary/reward');
  });
  await t.test('already committed save is reported as applied, never reversed or rewarded twice',async()=>{
   assert.equal((await save(alice,applied)).status,200);const result=await cancel(alice,applied);assert.equal(result.status,200);assert.equal(result.body.cancelled,false);
   assert.equal(result.body.snapshot.dates[0].revision,1);assert.equal(result.body.snapshot.credits.length,1);
   assert.equal((await save(alice,applied)).body.credits.length,1);
   checks.push('Cancel after save reports cancelled=false with authoritative applied snapshot; old UUID replay remains one credit');
  });
  await t.test('save/cancel races serialize on owner lock, with exactly one valid outcome',async()=>{
   for(let i=0;i<10;i++){
    const op=operation('2026-05-'+String(i+1).padStart(2,'0'));
    const [c,s]=await Promise.all(i%2?[cancel(alice,op),save(alice,op)]:[save(alice,op),cancel(alice,op)]).then(r=>i%2?r:[r[1],r[0]]);
    assert.equal(c.status,200);assert.equal(s.status,c.body.cancelled?409:200);
    const snapshot=(await read(alice)).body;assert.equal(snapshot.credits.filter(d=>d===op.date).length,c.body.cancelled?0:1);
    assert.equal(snapshot.dates.filter(d=>d.date===op.date).length,c.body.cancelled?0:1);
   }
   checks.push('Ten actual concurrent save/cancel races: cancel wins with no night, or save wins with one credit; no mixed state');
  });
  await t.test('owner guard, private table/internal function and independent account UUID isolation',async()=>{
   const response=await fetch(base+'/v1/diary/cancellations',{method:'POST',headers:{Authorization:'Bearer '+alice.token,'Content-Type':'application/json'},body:JSON.stringify({operationId:randomUUID(),expectedOwnerId:bob.id})});assert.equal(response.status,403);
   const extra=await fetch(base+'/v1/diary/cancellations',{method:'POST',headers:{Authorization:'Bearer '+alice.token,'Content-Type':'application/json'},body:JSON.stringify({operationId:randomUUID(),expectedOwnerId:alice.id,night:cancelled.night})});assert.equal(extra.status,400);
   await assert.rejects(runtime.query('select public.cancel_sleep_diary_operation($1::uuid,$2::date,0,$3::jsonb,$4::uuid)',[randomUUID(),cancelled.date,JSON.stringify(cancelled.night),alice.id]),e=>e.code==='42501');
   await assert.rejects(runtime.query('select * from public.sleep_diary_cancellations'),e=>e.code==='42501');
   await assert.rejects(runtime.query('select public.save_sleep_diary_operation_v1($1,$2,0,$3::jsonb,$4)',[randomUUID(),cancelled.date,JSON.stringify(cancelled.night),alice.id]),e=>e.code==='42501');
   assert.equal((await save(bob,cancelled)).status,200);assert.equal((await read(bob)).body.credits.length,1);
   assert.equal((await save(alice,cancelled)).status,409);
   checks.push('Real owner mismatch403/unknown night field400; payload-taking prototype and private table/v1 denied; same UUID under second account is independent');
  });
  await t.test('controlled insert failure rolls back cancellation; the original UUID can still save',async()=>{
   const fail=operation('2026-04-01'),fn='overman_test_cancel_failure';
   await admin.query(`create function public.${fn}() returns trigger language plpgsql as $$begin if new.operation_id='${fail.operationId}'::uuid then raise exception 'Controlled cancellation failure';end if;return new;end$$;
    create trigger ${fn} after insert on public.sleep_diary_cancellations for each row execute function public.${fn}();`);
   try{assert.equal((await cancel(alice,fail)).status,422);assert.equal((await admin.query('select count(*)::int n from public.sleep_diary_cancellations where user_id=$1 and operation_id=$2',[alice.id,fail.operationId])).rows[0].n,0);}
   finally{await admin.query(`drop trigger ${fn} on public.sleep_diary_cancellations;drop function public.${fn}()`);}
   assert.equal((await save(alice,fail)).status,200);assert.equal((await cancel(alice,fail)).body.cancelled,false);
   checks.push('Real AFTER INSERT fault rolls back cancellation record; original UUID subsequently saves once');
  });
  await t.test('own database restart retains cancellation and both account snapshots',async()=>{
   const a=(await read(alice)).body,b=(await read(bob)).body;
   const role=spawnSync('docker',['inspect','--format','{{index .Config.Labels "app.overman.role"}}','overman-postgres-dev'],{encoding:'utf8',windowsHide:true});assert.equal(role.stdout.trim(),'dev-db');
   const restarted=spawnSync('docker',['restart','overman-postgres-dev'],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(restarted.status,0);
   let ready=false;for(let i=0;i<40;i++){try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert.equal(ready,true);
   assert.deepEqual((await read(alice)).body,a);assert.deepEqual((await read(bob)).body,b);assert.equal((await cancel(alice,cancelled)).body.cancelled,true);assert.equal((await save(alice,cancelled)).status,409);
   checks.push('Only labelled Overman PostgreSQL restarted: cancellation survives, late save rejects and both snapshots remain exact');
  });
  writeFileSync(new URL('../../docs/product-evidence/05.02-own-cancel-20261109-real.json',import.meta.url),JSON.stringify({requirementId:'05.02',result:'passed',verifiedAt:new Date().toISOString(),checks:checks.map(name=>({name,passed:true})),baseUrl:base,
   scope:'Actual own Go API and Docker PostgreSQL, synthetic sessions, controlled post-commit response discard and SQL failure. No public service, product import UI, Android or physical phone claimed. No token/password artifacts.'},null,2)+'\n');
 }finally{await admin.end();await runtime.end();}
});