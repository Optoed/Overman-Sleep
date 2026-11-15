import test from 'node:test';
import assert from 'node:assert/strict';
import {beginNight,captureWake,freshSleep,nightPhase,parseSleep} from '../components/sleep/sleep-state';
const start=+new Date('2026-11-01T23:00:00+03:00'),wake=start+8*3600000;

test('night phases and immutable transitions preserve the original state',()=>{
 const initial=freshSleep(),night=beginNight(initial,start),morning=captureWake(night,wake,start,wake);
 assert.equal(nightPhase(initial),'idle');assert.equal(nightPhase(night),'sleeping');assert.equal(nightPhase(morning),'awaiting_mood');
 assert.equal(initial.active,null);assert.equal(night.active?.wokeAt,undefined);assert.equal(morning.active?.wokeAt,wake);
 assert.notEqual(night.active?.target,initial.schedule);assert.deepEqual(night.active?.target,initial.schedule);
});
test('repeated starts preserve the first night and its historical target, including pending morning',()=>{
 const night=beginNight(freshSleep(),start),changed={...night,schedule:{...night.schedule,bed:'22:00'}};
 assert.equal(beginNight(night,start+5000),night);assert.equal(beginNight(changed,start+9000),changed);
 assert.equal(changed.active?.target.bed,'23:00');
 const morning=captureWake(changed,wake,start,wake);assert.equal(beginNight(morning,wake+100000),morning);
});
test('first wake wins across retries and reloads without extending the night',()=>{
 const morning=captureWake(beginNight(freshSleep(),start),wake,start,wake),reloaded=parseSleep(JSON.stringify(morning))!;
 assert.equal(captureWake(morning,wake+600000,start,wake+600000),morning);
 assert.equal(captureWake(reloaded,wake+600000,start,wake+600000),reloaded);assert.equal(reloaded.active?.wokeAt,wake);
});
test('events from an earlier session cannot wake a newer night',()=>{
 const later=beginNight(freshSleep(),start+86400000,start+86400000);
 assert.throws(()=>captureWake(later,wake,start,wake));assert.equal(later.active?.wokeAt,undefined);
 assert.throws(()=>captureWake(freshSleep(),wake,start,wake));
});
test('invalid clock data fail without mutating the active session',()=>{
 const night=beginNight(freshSleep(),start);
 for(const invalid of [start-1,NaN,Infinity,wake+60001])assert.throws(()=>captureWake(night,invalid,start,wake));
 assert.equal(night.active?.wokeAt,undefined);assert.throws(()=>beginNight(freshSleep(),NaN));
});
