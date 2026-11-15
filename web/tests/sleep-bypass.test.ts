import test from 'node:test';
import assert from 'node:assert/strict';
import {beginNight,captureWake,freshSleep,recordNight,editNight,NightDateConflict} from '../components/sleep/sleep-state';
import {defaultAlarm} from '../components/sleep/sleep-state';
import {playTone,stopTone,stopPreview} from '../components/sleep/sleep-device';
const start=+new Date('2026-11-01T23:00:00+03:00'),wake=start+8*3600000;
const input={bed:start,wake,sleepMinutes:480,rested:4};
test('manual records and overlapping history corrections never finish a sleeping night',()=>{
 const s=beginNight(recordNight(freshSleep(),input,wake),start+60000);
 const next=editNight(s,s.nights[0],{...input,note:'corrected'},wake);
 assert.deepEqual(next.active,s.active);assert.equal(next.nights.length,1);assert.equal(next.nights[0].note,'corrected');
 assert.throws(()=>recordNight(s,input,wake,{started:s.active!.started,wokeAt:wake}));
});
test('history edits preserve pending morning, its original goal and confirmed wake',()=>{
 const s=captureWake(beginNight(freshSleep(),start),wake,start,wake);
 const changed={...s,schedule:{...s.schedule,bed:'22:00'}};
 const next=recordNight(changed,input,wake);
 assert.deepEqual(next.active,s.active);assert.deepEqual(next.nights[0].target,changed.schedule);
});
test('only matching confirmed morning explicitly completes its own session',()=>{
 const s=captureWake(beginNight(freshSleep(),start),wake,start,wake);
 const next=recordNight({...s,schedule:{...s.schedule,bed:'22:00'}},input,wake,{started:start,wokeAt:wake});
 assert.equal(next.active,null);assert.deepEqual(next.nights[0].target,s.active!.target);
 const withHistory=recordNight({...s,schedule:{...s.schedule,bed:'22:00'}},input,wake);
 const before=structuredClone(withHistory);assert.throws(()=>recordNight(withHistory,input,wake,{started:start,wokeAt:wake}),NightDateConflict);
 assert.deepEqual(withHistory,before,'same-date completion cannot replace the saved history or lose the pending live goal');
 for(const scope of [{started:start+1,wokeAt:wake},{started:start,wokeAt:wake+1}])assert.throws(()=>recordNight(s,input,wake,scope));
 assert.throws(()=>recordNight(freshSleep(),input,wake,{started:start,wokeAt:wake}));
});
test('preview stop, preview play and asynchronous preview resume cannot silence or revive alarm audio',async t=>{
 const original=globalThis.AudioContext,oscillators:{stops:number[]}[]=[];let release:(()=>void)|undefined;
 class AudioFixture {
  currentTime=10;destination={};
  resume(){return release?new Promise<void>(r=>{release=r;}):Promise.resolve();}
  createOscillator(){const o={stops:[] as number[],type:'sine',frequency:{setValueAtTime(){}},connect(){},start(){},stop(at?:number){this.stops.push(at??-1);}};oscillators.push(o);return o;}
  createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};}
 }
 globalThis.AudioContext=AudioFixture as unknown as typeof AudioContext;
 t.mock.timers.enable({apis:['setTimeout']});
 try{
  await playTone(defaultAlarm,true);const preview=oscillators.slice();
  await playTone(defaultAlarm);const alarms=oscillators.slice(preview.length);
  assert.ok(preview.every(o=>o.stops.includes(-1)));
  stopPreview();await playTone({...defaultAlarm,volume:0},true);
  assert.equal(oscillators.length,preview.length+alarms.length);assert.ok(alarms.every(o=>!o.stops.includes(-1)));
  t.mock.timers.tick(3500);await Promise.resolve();assert.ok(oscillators.length>preview.length+alarms.length,'alarm repeats despite preview controls');
  stopTone();const count=oscillators.length;t.mock.timers.tick(10000);await Promise.resolve();assert.equal(oscillators.length,count);
  release=()=>{};const pending=playTone(defaultAlarm,true);stopPreview();release!();await pending;assert.equal(oscillators.length,count,'closed preview cannot start after delayed audio resume');
  release=()=>{};const pendingAlarm=playTone(defaultAlarm);stopTone();release!();await pendingAlarm;assert.equal(oscillators.length,count,'confirmed stop invalidates delayed alarm resume');
 }finally{stopTone();globalThis.AudioContext=original;t.mock.timers.reset();}
});
