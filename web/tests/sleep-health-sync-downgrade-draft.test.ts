import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {freshSleep} from '../components/sleep/sleep-state';import {importHealthNight} from '../components/sleep/sleep-health-import';import {snapshotHealthScore} from '../components/sleep/sleep-health-score';
import {readSleepQueue,enqueueSleepOperation,sendFirstSleepOperation,sleepQueueKey} from '../lib/sleep-sync-queue';

test('sync rejects an unsupported future health score without consuming its pending operation',async()=>{
 const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}};
 const m=60000,bed=Date.UTC(2026,0,1,23),wake=bed+480*m,session={start:bed,end:wake,stages:[{start:bed,end:wake,kind:'sleeping' as const}]};
 const night=importHealthNight(freshSleep(),[session],0,{bed:0,wake:0},4,wake+m).nights[0],owner=randomUUID();
 const queue=enqueueSleepOperation(storage,readSleepQueue(storage,owner),{operationId:randomUUID(),date:night.date,expectedRevision:0,night});
 const raw=storage.getItem(sleepQueueKey(owner));
 const future={protocolVersion:1,garden:false,credits:night.success?[night.date]:[],deletedCredits:[],dates:[{date:night.date,revision:1,night:{...night,healthScore:{...snapshotHealthScore(session,480),version:'future-unsupported'}}}]};
 await assert.rejects(sendFirstSleepOperation(storage,queue,{rpc:async()=>({data:future,error:null})}),/Invalid server diary snapshot/);
 assert.equal(storage.getItem(sleepQueueKey(owner)),raw);assert.deepEqual(readSleepQueue(storage,owner),queue);
});
