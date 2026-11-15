import test from 'node:test';
import assert from 'node:assert/strict';
import {demoSleep,freshSleep,recordNight,parseSleep,type SleepState} from '../components/sleep/sleep-state';
import {towerPresentation,towerProgress} from '../components/sleep/sleep-growth';
import {withTowerCondition} from '../components/sleep/sleep-tower-condition';
import {backupText,readBackup} from '../components/sleep/sleep-insights';
import {floorsOf,createWorld} from '../components/tower/world-state';

const now=Date.parse('2026-11-13T12:00Z');
function add(state:SleepState,date:string,success=true){const wake=Date.parse(date+'T07:30Z');return recordNight(state,{bed:wake-510*60000,wake,bedOffset:0,wakeOffset:0,sleepMinutes:success?480:300,rested:3},now);}

test('100 earned floors remain capped across collapse, four repair nights and backup roundtrip',()=>{
 let state=withTowerCondition(demoSleep(100,Date.parse('2026-10-31T12:00Z')),true,'2026-10-31');
 const originalCredits=[...state.credits];
 for(let day=1;day<=8;day++)state=add(state,`2026-11-${String(day).padStart(2,'0')}`,false);
 let presentation=towerPresentation(state,now);
 assert.equal(towerProgress(state).floors,100);assert.equal(towerProgress(state).complete,true);
 assert.equal(presentation.condition?.status,'collapsed');assert.equal(floorsOf(presentation.world),0);
 assert.deepEqual(state.credits,originalCredits);assert.equal(state.garden,true);
 for(let day=9;day<=12;day++){
  state=add(state,`2026-11-${String(day).padStart(2,'0')}`);const before=JSON.stringify(state);
  presentation=towerPresentation(state,now);
  assert.equal(floorsOf(presentation.world),(day-8)*25);
  assert.equal(towerProgress(state).floors,100);assert.equal(towerProgress(state).remaining,0);
  assert.equal(state.credits.length,700+day-8);assert.equal(state.garden,true);
  assert.equal(JSON.stringify(state),before);assert.deepEqual(parseSleep(before),state);
 }
 const restored=readBackup(backupText(state));
 assert.deepEqual(restored.credits,state.credits);assert.deepEqual(restored.nights,state.nights);
 assert.deepEqual(restored.towerCondition,state.towerCondition);assert.equal(restored.garden,true);
 assert.equal(floorsOf(towerPresentation(restored,now).world),100);
});

test('seven accumulated successes build a floor even when gaps have never unlocked a garden',()=>{
 let state=freshSleep(createWorld(27182));state.configured=true;
 for(const date of ['2026-10-31','2026-11-02','2026-11-04','2026-11-06','2026-11-08','2026-11-10','2026-11-12'])state=add(state,date);
 assert.equal(towerProgress(state).floors,1);assert.equal(towerProgress(state).nights,0);
 assert.equal(state.garden,false);assert.equal(towerPresentation(state,now).world.motifs.includes('garden'),false);
 assert.deepEqual(parseSleep(JSON.stringify(state)),state);
});

test('legacy 99-floor baseline reaches100 after seven new successes without an overflow floor',()=>{
 let state=freshSleep({...createWorld(27182),xp:9900});state.configured=true;
 for(let day=1;day<=12;day++){
  state=add(state,`2026-11-${String(day).padStart(2,'0')}`);
  const progress=towerProgress(state);assert.equal(progress.floors,day<7?99:100);
  assert.equal(progress.remaining,day<7?7-day:0);assert.equal(progress.total,day);
  assert.equal(state.world.xp,9900);assert.deepEqual(parseSleep(JSON.stringify(state)),state);
 }
});
