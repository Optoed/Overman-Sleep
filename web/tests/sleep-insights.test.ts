import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultAlarm, freshSleep, parseSleep, recordNight } from '../components/sleep/sleep-state';
import { backupText, bedtimeMinute, clockLabel, dateRange, debt, nightScore, readBackup, reminderTime, summarize, sleepTrend } from '../components/sleep/sleep-insights';
const now=+new Date('2026-11-01T12:00:00');
function entry(bed='23:00',wake='07:30',sleepMinutes=480){return recordNight(freshSleep(),{bed:+new Date(`2026-10-31T${bed}`),wake:+new Date(`2026-11-01T${wake}`),sleepMinutes,rested:3},now);}
test('sleep index is bounded, respects historical targets, and does not reward oversleeping',()=>{
  const n=entry().nights[0];assert.equal(nightScore(n),99);
  assert.equal(nightScore({...n,sleepMinutes:0}),0);
  assert.equal(nightScore({...n,sleepMinutes:510}),100);
  assert.equal(nightScore({...n,bedClock:'04:00',wakeClock:'12:00'}),79);
  assert.equal(debt({...n,sleepMinutes:420}),60);
  assert.equal(debt({...n,sleepMinutes:510}),0);
});
test('bedtime averages cross midnight, missing nights are excluded, and each night keeps its own goal',()=>{
  const base=entry().nights[0],early={...base,date:'2026-10-31',bedClock:'23:30'},late={...base,date:'2026-11-01',bedClock:'00:30',sleepMinutes:420,target:{...base.target,hours:7}};
  const s=summarize([early,late],'2026-11-01',7);
  assert.equal(clockLabel(s.bedtime),'00:00');assert.equal(s.rows.length,2);assert.equal(s.duration,450);assert.equal(s.debt,0);
  assert.equal(s.latency,null);assert.equal(s.noise,null);assert.equal(bedtimeMinute(late),1470);
  assert.equal(summarize([],'2026-11-01',7).debt,null);
});
test('calendar ranges cross month/year boundaries and include leap days',()=>{
  assert.deepEqual(dateRange('2027-01-02',3),['2026-12-31','2027-01-01','2027-01-02']);
  assert.deepEqual(dateRange('2028-03-01',3),['2028-02-28','2028-02-29','2028-03-01']);
  const t=reminderTime({bed:'23:00',wake:'07:30',hours:8,tolerance:45},30,+new Date('2026-11-01T22:45'));
  assert.equal(new Date(t).getDate(),2);assert.equal(new Date(t).getHours(),22);assert.equal(new Date(t).getMinutes(),30);
});
test('validated backups round-trip old and new saves, reject malformed and unsupported files',()=>{
  const state={...entry(),alarm:{...defaultAlarm,reminder:true},theme:'night' as const};
  assert.deepEqual(readBackup(backupText(state)),state);assert.deepEqual(readBackup(JSON.stringify(state)),state);
  assert.throws(()=>readBackup('{'));assert.throws(()=>readBackup(JSON.stringify({format:'overman-sleep',version:9,state})));
  assert.throws(()=>readBackup(' '.repeat(3500001)));
  assert.throws(()=>readBackup(JSON.stringify({...state,alarm:{...defaultAlarm,volume:2}})));
});
test('manual latency and wake periods must fit outside the reported sleep, and raw signal is bounded',()=>{
  const s=freshSleep(),n=entry().nights[0];
  const input={bed:n.bed,wake:n.wake,sleepMinutes:450,rested:4,latencyMinutes:20,awakeMinutes:40,noiseDbfs:-45};
  assert.ok(parseSleep(JSON.stringify(recordNight(s,input,now))));
  assert.throws(()=>recordNight(s,{...input,awakeMinutes:41},now));
  assert.throws(()=>recordNight(s,{...input,noiseDbfs:30},now));
  assert.throws(()=>recordNight(s,{...input,latencyMinutes:-1},now));
  assert.throws(()=>recordNight(s,{...input,note:'x'.repeat(2001)},now));
});

test('calculated score is independent from mood and penalizes time awake in bed',()=>{
 const n=entry().nights[0];
 assert.equal(nightScore({...n,rested:1}),nightScore({...n,rested:5}));
 assert.ok(nightScore({...n,sleepMinutes:300})<nightScore(n));
 assert.ok(nightScore({...n,bed:n.bed-3600000})<nightScore(n));
 for(let sleepMinutes=0;sleepMinutes<=510;sleepMinutes++)assert.ok(nightScore({...n,sleepMinutes})>=0&&nightScore({...n,sleepMinutes})<=100);
});
test('two-line trend uses seven calendar days, excludes missing dates and retains separate scales',()=>{
 const n=entry().nights[0],old={...n,date:'2026-10-25',rested:1},recent={...n,date:'2026-10-31',rested:5};
 const trend=sleepTrend([old,recent,n],'2026-11-01',3);
 assert.equal(trend[0].score,null);assert.equal(trend[0].mood,null);
 assert.equal(trend[2].mood,4);assert.equal(trend[2].count,2);assert.equal(trend[2].score,nightScore(n));
});
test('captured wake survives reload and invalid snapshots cannot overwrite storage',()=>{
 const s=freshSleep(),started=now-8*3600000,wokeAt=now;
 const active={...s,active:{started,wokeAt,target:s.schedule}};
 assert.equal(parseSleep(JSON.stringify(active))?.active?.wokeAt,wokeAt);
 assert.throws(()=>parseSleep(JSON.stringify({...active,active:{...active.active,wokeAt:started-1}})));
});
