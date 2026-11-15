import test from 'node:test';import assert from 'node:assert/strict';
import {inputAt,parseTimeInput,timeCandidates,shiftCalendarDate,historyOffsets,timeReview} from '../components/sleep/sleep-time';
import {beginNight,captureWake,freshSleep,parseSleep,recordNight} from '../components/sleep/sleep-state';
import {initialMorningFields} from '../components/sleep/sleep-morning-draft';
import {recoverWake,validWakeReceipt} from '../components/sleep/sleep-wake-recovery';
import {dateRange,nextClock} from '../components/sleep/sleep-insights';
function zone<T>(name:string,run:()=>T){const old=process.env.TZ;process.env.TZ=name;try{return run();}finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}}
test('calendar arithmetic spans midnight, month, leap day and year independently of device zone',()=>{
 for(const name of ['Europe/Moscow','America/New_York','Pacific/Honolulu','Pacific/Kiritimati'])zone(name,()=>{
  assert.equal(shiftCalendarDate('2026-12-31',1),'2027-01-01');assert.equal(shiftCalendarDate('2024-03-01',-1),'2024-02-29');assert.equal(shiftCalendarDate('2026-03-01',-1),'2026-02-28');
  assert.deepEqual(dateRange('2027-01-02',4),['2026-12-30','2026-12-31','2027-01-01','2027-01-02']);assert.equal(new Set(dateRange('2026-11-03',7)).size,7);
 });
});
test('invalid calendar and missing spring-forward local time are rejected without silent normalization',()=>zone('America/New_York',()=>{
 for(const value of ['', '2026-02-30T10:00','2026-13-01T10:00','2026-11-01T24:00','2026-03-08T02:30'])assert.throws(()=>parseTimeInput(value));
 assert.equal(parseTimeInput('2026-03-08T03:30'),Date.parse('2026-03-08T07:30:00Z'));
}));
test('repeated fall-back hour requires an explicit offset and can represent either real occurrence',()=>zone('America/New_York',()=>{
 const options=timeCandidates('2026-11-01T01:30');assert.deepEqual(options.map(x=>x.offset),[-240,-300]);assert.throws(()=>parseTimeInput('2026-11-01T01:30'),/повторяется/);
 assert.equal(parseTimeInput('2026-11-01T01:30',-240),Date.parse('2026-11-01T05:30:00Z'));assert.equal(parseTimeInput('2026-11-01T01:30',-300),Date.parse('2026-11-01T06:30:00Z'));
}));
test('DST changes real elapsed duration; endpoint offsets retain each original local clock',()=>zone('America/New_York',()=>{
 const bed=parseTimeInput('2026-03-07T23:30'),wake=parseTimeInput('2026-03-08T07:30');assert.equal((wake-bed)/3600000,7);
 const s=recordNight(freshSleep(),{bed,wake,sleepMinutes:420,rested:4},wake);assert.equal(s.nights[0].bedOffset,-300);assert.equal(s.nights[0].wakeOffset,-240);assert.equal(s.nights[0].date,'2026-03-08');
}));
test('history and legacy history keep original date/clocks after crossing the date line',()=>{
 const s=zone('America/New_York',()=>recordNight(freshSleep(),{bed:Date.parse('2026-11-01T04:30Z'),wake:Date.parse('2026-11-01T06:30Z'),sleepMinutes:120,rested:4},Date.parse('2026-11-01T07:30Z'))),n=s.nights[0];
 zone('Pacific/Honolulu',()=>{const offsets=historyOffsets(n);assert.equal(inputAt(n.bed,offsets.bed),'2026-11-01T00:30');assert.equal(inputAt(n.wake,offsets.wake),'2026-11-01T01:30');assert.deepEqual(historyOffsets({...n,bedOffset:undefined,wakeOffset:undefined}),offsets);assert.deepEqual(parseSleep(JSON.stringify(s)),s);});
});
test('too-long unclosed night has no invented sleep estimate and remains pending for correction',()=>{
 const start=Date.now()-72*3600000,s=captureWake(beginNight(freshSleep(),start),Date.now());assert.match(timeReview(s.active!),/24 часов/);assert.equal(initialMorningFields(s.active!).sleep,'');const before=structuredClone(s);
 assert.throws(()=>recordNight(s,{bed:start,wake:s.active!.wokeAt!,sleepMinutes:480,rested:4}));assert.deepEqual(s,before);
});
test('clock rollback preserves actual confirmed wake only as explicit review, without a diary record or reward',()=>{
 const now=Date.now(),s=beginNight(freshSleep(),now),receipt={version:1 as const,id:s.active!.id,started:now,target:s.schedule,wokeAt:now-3600000,timeReview:true};assert.equal(validWakeReceipt(receipt),true);
 const recovered=recoverWake(s,receipt,true,now);assert.equal(recovered.active!.wokeAt,receipt.wokeAt);assert.equal(initialMorningFields(recovered.active!).sleep,'');assert.equal(recovered.nights.length,0);assert.equal(recovered.credits.length,0);assert.deepEqual(parseSleep(JSON.stringify(recovered)),recovered);
 assert.throws(()=>recordNight(recovered,{bed:now,wake:receipt.wokeAt,sleepMinutes:0,rested:4},now));
});
test('future dates, negative duration, invalid offset and excessive duration leave state unchanged',()=>{
 const now=Date.now(),s=freshSleep(),before=structuredClone(s),valid={bed:now-8*3600000,wake:now,sleepMinutes:480,rested:4};
 for(const input of [{...valid,wake:now+61000},{...valid,bed:now+1},{...valid,sleepMinutes:-1},{...valid,bedOffset:1000},{...valid,bed:now-25*3600000}])assert.throws(()=>recordNight(s,input,now));assert.deepEqual(s,before);assert.throws(()=>beginNight(s,now+61000,now));
});
test('pending morning and its endpoint offsets do not move after device timezone changes',()=>{
 const start=Date.parse('2026-10-31T23:00Z'),wake=start+8*3600000,s=zone('Europe/Moscow',()=>captureWake(beginNight(freshSleep(),start),wake,start,wake)),fields=initialMorningFields(s.active!);
 zone('Pacific/Honolulu',()=>assert.deepEqual(initialMorningFields(s.active!),fields));
});
test('next alarm chooses first repeated hour and shifts a missing hour forward, matching native policy',()=>zone('America/New_York',()=>{
 assert.equal(nextClock('01:30',Date.parse('2026-11-01T04:30Z')),Date.parse('2026-11-01T05:30Z'));
 assert.equal(nextClock('02:30',Date.parse('2026-03-08T05:00Z')),Date.parse('2026-03-08T07:30Z'));
}));
test('half-hour DST transition preserves both occurrences and shifts the alarm by the actual gap',()=>zone('Australia/Lord_Howe',()=>{
 assert.deepEqual(timeCandidates('2026-04-05T01:45').map(x=>x.offset),[660,630]);
 assert.throws(()=>parseTimeInput('2026-04-05T01:45'),/повторяется/);
 assert.equal(parseTimeInput('2026-04-05T01:45',630)-parseTimeInput('2026-04-05T01:45',660),30*60000);
 assert.throws(()=>parseTimeInput('2026-10-04T02:15'),/местного времени нет/);
 assert.equal(nextClock('02:15',Date.parse('2026-10-03T13:00Z')),Date.parse('2026-10-03T15:45Z'));
}));
test('quarter-hour timezone and leap-month boundary retain real duration and original history offsets',()=>zone('Asia/Kathmandu',()=>{
 const bed=parseTimeInput('2028-02-29T23:30'),wake=parseTimeInput('2028-03-01T07:30');
 assert.equal(wake-bed,8*3600000);const s=recordNight(freshSleep(),{bed,wake,sleepMinutes:480,rested:4},wake);
 assert.equal(s.nights[0].date,'2028-03-01');assert.equal(s.nights[0].bedOffset,345);assert.equal(s.nights[0].wakeOffset,345);
 zone('Pacific/Honolulu',()=>{const offsets=historyOffsets(s.nights[0]);assert.equal(inputAt(bed,offsets.bed),'2028-02-29T23:30');assert.equal(inputAt(wake,offsets.wake),'2028-03-01T07:30');assert.deepEqual(parseSleep(JSON.stringify(s)),s);});
}));
