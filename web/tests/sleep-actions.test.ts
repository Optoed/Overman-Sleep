import test from 'node:test';
import assert from 'node:assert/strict';
import {createActionGate} from '../components/sleep/sleep-actions';

test('rapid inputs share one action until an asynchronous device reply arrives',async()=>{
 const gate=createActionGate();let release!:()=>void,calls=0;
 const reply=new Promise<void>(resolve=>{release=resolve;});
 const first=gate.run(async()=>{calls++;await reply;});
 assert.equal(gate.busy,true);
 const duplicates=await Promise.all(Array.from({length:20},()=>gate.run(()=>{calls++;})));
 assert.ok(duplicates.every(v=>v===false));assert.equal(calls,1);
 release();assert.equal(await first,true);assert.equal(gate.busy,false);
 assert.equal(await gate.run(()=>{calls++;}),true);assert.equal(calls,2);
});
test('native rejection and synchronous failures release the action for an intentional retry',async()=>{
 const gate=createActionGate();
 await assert.rejects(gate.run(async()=>{throw Error('Android rejected start');}),/Android rejected/);
 assert.equal(gate.busy,false);await assert.rejects(gate.run(()=>{throw Error('storage failed');}),/storage failed/);
 let calls=0;assert.equal(await gate.run(()=>{calls++;}),true);assert.equal(calls,1);
});
test('different mutations and reentrant actions cannot overlap',async()=>{
 const gate=createActionGate();let nested=true;
 await gate.run(async()=>{nested=await gate.run(()=>{throw Error('must not execute');});});
 assert.equal(nested,false);assert.equal(gate.busy,false);
});
