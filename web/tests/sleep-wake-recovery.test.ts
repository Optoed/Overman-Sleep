import test from 'node:test';
import assert from 'node:assert/strict';
import {beginNight,captureWake,freshSleep,recordNight} from '../components/sleep/sleep-state';
import {recoverWake,validWakeReceipt,type WakeReceipt} from '../components/sleep/sleep-wake-recovery';
const now=Date.now(),started=now-8*3600000;
function fixture(){const state=beginNight(freshSleep(),started);return{state,receipt:{version:1,id:state.active!.id,started,target:{...state.active!.target},wokeAt:now} as WakeReceipt};}
test('journal restores a confirmed wake without changing the original archive',()=>{
 const{state,receipt}=fixture(),before=structuredClone(state),recovered=recoverWake(state,receipt,true,now);
 assert.deepEqual(state,before);assert.equal(recovered.active!.wokeAt,now);assert.equal(recovered.active!.started,started);assert.deepEqual(recovered.active!.target,state.active!.target);
 assert.equal(recoverWake(recovered,{...receipt,wokeAt:now+1000},true,now+1000),recovered);
});
test('missing or unreadable archive can recover the night snapshot without fabricated history',()=>{
 const{receipt}=fixture(),recovered=recoverWake(freshSleep(),receipt,false,now);
 assert.equal(recovered.active!.wokeAt,now);assert.equal(recovered.configured,true);assert.deepEqual(recovered.nights,[]);
});
test('stale receipt cannot resurrect a completed night or end a different night',()=>{
 const{state,receipt}=fixture(),completed=recordNight(captureWake(state,now),{bed:started,wake:now,sleepMinutes:450,rested:4},now);
 assert.equal(recoverWake(completed,receipt,true,now),completed);
 const other=beginNight(freshSleep(),started+10000);assert.equal(recoverWake(other,receipt,true,now),other);
});
test('invalid receipt or impossible future wake cannot overwrite a state',()=>{
 const{state,receipt}=fixture();for(const bad of [null,{}, {...receipt,wokeAt:NaN},{...receipt,wokeAt:started-1},{...receipt,target:{}}])assert.equal(validWakeReceipt(bad),false);
 assert.throws(()=>recoverWake(state,{...receipt,wokeAt:now+61000},true,now));
});
