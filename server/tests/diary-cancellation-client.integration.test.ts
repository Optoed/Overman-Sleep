import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID,randomBytes,createHash} from 'node:crypto';import {writeFileSync} from 'node:fs';
import {databasePool} from '../src/database.mjs';import {createSleepApi,SleepApiError,type SleepApiSession} from '../../web/lib/sleep-api';
import {readSleepQueue,enqueueSleepOperation,type SleepOperation} from '../../web/lib/sleep-sync-queue';
const baseUrl='http://127.0.0.1:3902';
function op(day='2026-06-01'):SleepOperation{const wake=Date.parse(day+'T07:30:00+03:00');return{operationId:randomUUID(),date:day,expectedRevision:0,
 night:{date:day,bed:wake-510*60000,wake,bedOffset:180,wakeOffset:180,bedClock:'23:00',wakeClock:'07:30',sleepMinutes:480,rested:3,target:{bed:'23:00',wake:'07:30',hours:8,tolerance:45},success:true}};}
test('05.02 cancellation SDK against actual Go/PostgreSQL keeps pending data until separate import approval',async t=>{
 const admin=databasePool({admin:true,max:1});const checks:string[]=[];try{
  async function identity(){const ownerId=randomUUID(),token=randomBytes(32).toString('base64url');await admin.query('insert into overman.users(id) values($1)',[ownerId]);
   await admin.query("insert into overman.sessions values($1,$2,now()+interval '1 hour',false)",[createHash('sha256').update(token).digest(),ownerId]);return{ownerId,token};}
  const alice=await identity(),bob=await identity();let active:SleepApiSession|null=alice;
  const api=createSleepApi({baseUrl,allowLoopbackHttp:true,getSession:()=>active}),values=new Map<string,string>();
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,raw:string)=>{values.set(key,raw);}},original=op();
  const queue=enqueueSleepOperation(storage,readSleepQueue(storage,alice.ownerId),original),raw=JSON.stringify([...values]);
  await t.test('real cancellation receipt matches queue UUID, prevents later send and preserves client pending state',async()=>{
   const receipt=await api.cancelOperation(original,alice.ownerId);assert.equal(receipt.cancelled,true);assert.equal(receipt.ownerId,alice.ownerId);assert.equal(receipt.operationId,original.operationId);
   assert.deepEqual(receipt.snapshot.dates,[]);assert.deepEqual(await api.cancelOperation(original,alice.ownerId),receipt);
   await assert.rejects(api.saveOperation(original,alice.ownerId),e=>e instanceof SleepApiError&&e.code==='conflict');
   assert.equal(JSON.stringify([...values]),raw);assert.deepEqual(readSleepQueue(storage,alice.ownerId),queue);assert.ok(!raw.includes(alice.token));
   checks.push('Actual SDK/Go cancellation receipt bound to owner and UUID; late save conflicts, retry is stable, durable pending bytes unchanged');
  });
  await t.test('already applied receipt and account mismatch cannot erase an applied night or another account',async()=>{
   const applied=op('2026-06-02');await api.saveOperation(applied,alice.ownerId);const receipt=await api.cancelOperation(applied,alice.ownerId);
   assert.equal(receipt.cancelled,false);assert.equal(receipt.snapshot.credits.length,1);assert.equal(receipt.snapshot.dates[0].revision,1);
   active={ownerId:alice.ownerId,token:bob.token};await assert.rejects(api.cancelOperation(original,alice.ownerId),e=>e instanceof SleepApiError&&e.code==='owner_changed');
   active=bob;assert.deepEqual((await api.readSnapshot()).snapshot.dates,[]);active=alice;assert.equal((await api.readSnapshot()).snapshot.credits.length,1);
   assert.equal(JSON.stringify([...values]),raw);checks.push('Actual SDK validates already-applied receipt without undo; wrong owner/token rejected and other account stays empty');
  });
  writeFileSync(new URL('../../docs/product-evidence/05.02-own-cancel-20261109-client-real.json',import.meta.url),JSON.stringify({requirementId:'05.02',result:'passed',verifiedAt:new Date().toISOString(),checks:checks.map(name=>({name,passed:true})),
   scope:'Actual browser-compatible TypeScript transport via Node fetch to loopback Go/Docker PostgreSQL. Synthetic sessions; memory queue bytes preserved. Not a product browser/import UI or Android test; no token artifacts.'},null,2)+'\n');
 }finally{await admin.end();}
});