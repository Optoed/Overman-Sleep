import test from 'node:test';
import assert from 'node:assert/strict';
import {healthSleepScore,healthSleepScoreV2,snapshotHealthScore,validateHealthScoreSnapshot} from '../components/sleep/sleep-health-score';
import type {HealthSleepSession} from '../components/sleep/sleep-health-session';
const m=60_000;
const night=(sleep:number,awake:number):HealthSleepSession=>({start:0,end:(sleep+awake)*m,stages:[...(sleep?[{start:0,end:sleep*m,kind:'sleeping' as const}]:[]),...(awake?[{start:sleep*m,end:(sleep+awake)*m,kind:'awake' as const}]:[])]});
test('complete session: duration and continuity contribute separately',()=>{
 const full=healthSleepScore(night(480,0),480)!,short=healthSleepScore(night(240,0),480)!,interrupted=healthSleepScore(night(480,180),480)!;
 assert.equal(full.score,100);assert.equal(short.score,50);assert.ok(interrupted.score<full.score);assert.equal(interrupted.sleepMinutes,480);assert.equal(interrupted.awakeMinutes,180);
});
test('versioned snapshots retain their inputs across goal changes and survive JSON',()=>{
 const s=snapshotHealthScore(night(420,60),480)!;assert.equal(validateHealthScoreSnapshot(JSON.parse(JSON.stringify(s))),true);
 assert.equal(s.goalMinutes,480);assert.notEqual(healthSleepScore(night(420,60),600)!.score,s.score);
 assert.equal(snapshotHealthScore({start:0,end:480*m,stages:[]},480),null);
});
test('snapshot validator rejects altered scores, unknown versions and non-finite values',()=>{
 const s=snapshotHealthScore(night(420,60),480)!;
 for(const bad of [{...s,score:s.score-1},{...s,version:'future'}, {...s,extra:1}, {...s,goalMinutes:NaN}, {...s,sleepMinutes:999}, {...s,intervalMinutes:0}])assert.equal(validateHealthScoreSnapshot(bad),false);
});
test('unknown or missing intervals never produce a score',()=>{
 assert.equal(healthSleepScore({start:0,end:480*m,stages:[]},480),null);
 assert.equal(healthSleepScore({start:0,end:480*m,stages:[{start:0,end:480*m,kind:'unknown'}]},480),null);
});
test('score never invents restfulness, stays bounded, and rejects invalid inputs',()=>{
 const noSleep=healthSleepScore(night(0,480),480)!;assert.equal(noSleep.score,0);assert.equal('rested' in noSleep,false);
 assert.throws(()=>healthSleepScore(night(480,0),0));assert.throws(()=>healthSleepScore(night(480,0),NaN));
 assert.throws(()=>healthSleepScore({start:0,end:120*m,stages:[{start:0,end:90*m,kind:'sleeping'},{start:60*m,end:120*m,kind:'awake'}]},480));
});
test('adult reference prevents a short custom goal from producing a perfect preview',()=>{
 const short=night(240,0),before=snapshotHealthScore(short,240)!;
 assert.equal(before.score,100);assert.equal(healthSleepScoreV2(short,240)!.score,57);
 assert.equal(healthSleepScoreV2(night(420,0),240)!.score,100);
 assert.equal(healthSleepScoreV2(night(480,0),540)!.score,89);
 assert.equal(validateHealthScoreSnapshot(before),true);
 assert.equal(healthSleepScoreV2({start:0,end:480*m,stages:[]},480),null);
});
