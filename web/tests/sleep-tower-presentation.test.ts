import test from 'node:test';
import assert from 'node:assert/strict';
import {freshSleep,recordNight,parseSleep,sleepWorld,type SleepState} from '../components/sleep/sleep-state';
import {floorsOf} from '../components/tower/world-state';
import {towerPresentation,towerProgress} from '../components/sleep/sleep-growth';
import {withTowerCondition} from '../components/sleep/sleep-tower-condition';
import {backupText,readBackup,nightScore} from '../components/sleep/sleep-insights';
import {reviewSleepReconciliation} from '../lib/sleep-sync-reconcile';

const now=Date.parse('2026-11-13T12:00Z');
function add(s:SleepState,day:number,success:boolean){
 const wake=Date.parse(`2026-11-${String(day).padStart(2,'0')}T07:30Z`);
 return recordNight(s,{bed:wake-510*60000,wake,bedOffset:0,wakeOffset:0,sleepMinutes:success?480:300,rested:1},now);
}
function base(){const s=freshSleep();s.world.xp=2000;s.garden=true;return s;}
function collapsed(){let s=withTowerCondition(base(),true,'2026-10-31');for(let day=1;day<=8;day++)s=add(s,day,false);return s;}

test('old archives retain their full scene until opt-in; enabling starts tomorrow without retroactive punishment',()=>{
 let s=base();for(let day=1;day<=8;day++)s=add(s,day,false);
 const before=JSON.stringify(s),scores=s.nights.map(n=>nightScore(n));
 assert.deepEqual(towerPresentation(s,now),{world:sleepWorld(s,now),condition:null});
 const enabled=withTowerCondition(s,true,'2026-11-13');assert.equal(enabled.towerCondition?.activatedDate,'2026-11-14');
 assert.equal(towerPresentation(enabled,now).condition?.integrity,100);assert.equal(towerPresentation(enabled,now).world.xp,sleepWorld(s,now).xp);
 assert.equal(JSON.stringify(s),before);assert.deepEqual(enabled.nights.map(n=>nightScore(n)),scores);
 assert.equal(withTowerCondition(enabled,true,'2026-11-20'),enabled);
});

test('scene loses floors then collapses; four real recorded successes restore the retained tower',()=>{
 let s=withTowerCondition(base(),true,'2026-10-31');for(let day=1;day<=8;day++){
  s=add(s,day,false);const view=towerPresentation(s,now);
  assert.equal(view.condition?.visibleFloors,day<4?20:day===8?0:(8-day)*4);
  assert.equal(floorsOf(view.world),view.condition?.visibleFloors);
 }
 const raw=JSON.stringify(s),scores=s.nights.map(n=>nightScore(n));assert.equal(towerPresentation(s,now).condition?.status,'collapsed');
 assert.equal(towerProgress(s).floors,20);assert.equal(s.world.xp,2000);assert.equal(s.garden,true);
 for(let day=9;day<=12;day++){s=add(s,day,true);assert.equal(towerPresentation(s,now).condition?.integrity,(day-8)*25);}
 assert.equal(floorsOf(towerPresentation(s,now).world),20);assert.equal(towerPresentation(s,now).world.xp,sleepWorld(s,now).xp);
 assert.deepEqual((JSON.parse(raw) as SleepState).nights.map(n=>nightScore(n)),scores);assert.equal(s.credits.length,4);
});

test('policy survives archive and backup round trips; disabling restores the scene without changing rewards',()=>{
 const s=collapsed(),raw=JSON.stringify(s);assert.deepEqual(parseSleep(raw),s);assert.deepEqual(readBackup(backupText(s)),s);
 const off=withTowerCondition(s,false,'2026-11-13');assert.equal(off.towerCondition,undefined);assert.equal(towerPresentation(off,now).world.xp,2000);
 for(const key of ['world','nights','credits','garden'] as const)assert.deepEqual(off[key],s[key]);
 assert.equal(withTowerCondition(off,true,'2026-11-13').towerCondition?.activatedDate,'2026-11-14');assert.equal(JSON.stringify(s),raw);
});

test('invalid or unknown policy is rejected without replacing the original archive',()=>{
 for(const policy of [null,[],{}, {version:'future',activatedDate:'2026-11-01'}, {version:'condition-v1',activatedDate:'2026-02-30'}, {version:'condition-v1',activatedDate:'2026-11-01',extra:true}]){
  const raw=JSON.stringify({...base(),towerCondition:policy});assert.throws(()=>parseSleep(raw),/повреждено/);
 }
 assert.throws(()=>withTowerCondition(base(),true,'not-a-date'));
});

test('clock rollback before activation and unknown later days cause no new loss or automatic repair',()=>{
 const s=collapsed();assert.equal(towerPresentation(s,Date.parse('2026-10-30T12:00Z')).condition?.integrity,100);
 assert.equal(towerPresentation(s,Date.parse('2026-12-20T12:00Z')).condition?.integrity,0);
 const empty=withTowerCondition(base(),true,'2026-10-31');assert.equal(towerPresentation(empty,now).condition?.integrity,100);
});

test('reviewed sync keeps local opt-in settings and does not upload them as night data',()=>{
 const s=collapsed(),owner='00000000-0000-4000-8000-000000000001';
 const server={ownerId:owner,snapshot:{protocolVersion:1 as const,garden:true,credits:[],deletedCredits:[],dates:s.nights.map(n=>({date:n.date,revision:1,night:n}))}};
 const review=reviewSleepReconciliation(s,owner,null,server);assert.deepEqual(review.next.towerCondition,s.towerCondition);
 assert.equal(review.uploads.length,0);assert.equal(review.conflicts.length,0);assert.equal(towerPresentation(review.next,now).condition?.integrity,0);
});
