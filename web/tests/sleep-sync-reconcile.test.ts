import {test}from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';
import{reviewSleepReconciliation,applyReviewedSleepReconciliation,type OwnedSleepSnapshot}from'../lib/sleep-sync-reconcile';
import{freshSleep,recordNight,deleteNight,sleepWorld,SLEEP_KEY,type Night}from'../components/sleep/sleep-state';
import{parseSleepSnapshot}from'../lib/sleep-sync-queue';
import{createSleepStorage}from'../components/sleep/sleep-storage';
const now=Date.parse('2026-11-08T12:00:00Z');
function state(day='2026-06-01'){
  const s=freshSleep(),wake=Date.parse(day+'T07:30:00+03:00');
  return recordNight(s,{bed:wake-510*60000,wake,bedOffset:180,wakeOffset:180,sleepMinutes:480,rested:3,note:'Тестовая запись'},now);
}
function snapshot(ownerId:string,nights:Night[],rev=1,deleted:string[]=[]):OwnedSleepSnapshot{
  return {ownerId,snapshot:parseSleepSnapshot({protocolVersion:1,garden:false,
    credits:[...nights.filter(n=>n.success).map(n=>n.date),...deleted],deletedCredits:deleted,
    dates:[...nights.map(n=>({date:n.date,revision:rev,night:n})),...deleted.map(date=>({date,revision:rev,night:null}))]})};
}
function memory(raw:string){let value=raw,writes=0;return{getItem:(_key:string)=>value,setItem:(_key:string,v:string)=>{value=v;writes++;},raw:()=>value,writes:()=>writes};}

test('05.02 reconciliation keeps local settings, unfinished morning, world base and pending local dates',()=>{
  const owner=randomUUID(),local=state(),base=snapshot(owner,local.nights);
  local.active={id:randomUUID(),started:now-60000,wokeAt:now,target:{...local.schedule},bedOffset:180,wakeOffset:180};
  local.theme='light';local.alarm={enabled:true,reminder:true,reminderMinutes:15,ringtone:'bell',volume:.7,vibration:false,smart:false,smartMinutes:20,noise:false};
  local.world.xp=321;local.schedule={bed:'22:00',wake:'06:00',hours:8,tolerance:30};
  const remoteNight=state('2026-06-02').nights[0],remote=snapshot(owner,[...base.snapshot.dates.flatMap(d=>d.night?[d.night]:[]),remoteNight]);
  const original=structuredClone(local),review=reviewSleepReconciliation(local,owner,base,remote);
  assert.deepEqual(local,original);assert.equal(review.conflicts.length,0);assert.equal(review.next.nights.length,2);
  for(const key of ['active','alarm','schedule','theme','world','revision']as const)assert.deepEqual(review.next[key],local[key]);
  const added=state('2026-06-03').nights[0];local.nights.push(added);local.credits.push(added.date);
  const withPending=reviewSleepReconciliation(local,owner,base,remote);
  assert.equal(withPending.uploads.length,1);assert.equal(withPending.uploads[0].expectedRevision,0);assert.equal(withPending.uploads[0].date,added.date);
});
test('05.02 concurrent edits require an explicit reviewed choice and retain losing copy',()=>{
  const owner=randomUUID(),local=state(),base=snapshot(owner,local.nights),day=local.nights[0].date;
  local.nights[0].note='Правка на устройстве';
  const remote=snapshot(owner,[{...base.snapshot.dates[0].night!,note:'Правка на сервере'}],2);
  const review=reviewSleepReconciliation(local,owner,base,remote),s=memory(JSON.stringify(local));
  assert.equal(review.conflicts.length,1);assert.equal(review.next.nights[0].note,'Правка на устройстве');
  assert.equal(review.conflicts[0].server?.note,'Правка на сервере');assert.equal(review.uploads.length,0);
  assert.throws(()=>applyReviewedSleepReconciliation(s,SLEEP_KEY,local,review,true,owner),/every conflict/);assert.equal(s.writes(),0);
  const keepLocal=reviewSleepReconciliation(local,owner,base,remote,{[day]:'local'});
  assert.equal(keepLocal.conflicts.length,0);assert.equal(keepLocal.uploads[0].expectedRevision,2);
  assert.equal(keepLocal.uploads[0].night?.note,'Правка на устройстве');
  const keepServer=reviewSleepReconciliation(local,owner,base,remote,{[day]:'server'});
  assert.equal(keepServer.next.nights[0].note,'Правка на сервере');assert.equal(keepServer.uploads.length,0);
  assert.throws(()=>reviewSleepReconciliation(local,owner,base,remote,{'2026-01-01':'local'}),/stale/);
});
test('05.02 remote/local deletion and repeated snapshots retain earned floors and garden',()=>{
  const owner=randomUUID();let local=state();local.garden=true;
  const base=snapshot(owner,local.nights),day=local.nights[0].date,remote=snapshot(owner,[],2,[day]);
  const review=reviewSleepReconciliation(local,owner,base,remote);
  assert.equal(review.next.nights.length,0);assert.deepEqual(review.next.deletedCredits,[day]);assert.equal(review.next.garden,true);
  const xp=sleepWorld(local,now).xp;assert.equal(sleepWorld(review.next,now).xp,xp);
  for(let i=0;i<100;i++){
    const next=reviewSleepReconciliation(review.next,owner,remote,remote);
    assert.equal(sleepWorld(next.next,now).xp,xp);assert.equal(next.next.credits.length,1);assert.equal(next.uploads.length,0);
  }
  local=deleteNight(local,local.nights[0]);
  const pending=reviewSleepReconciliation(local,owner,base,base);
  assert.equal(pending.uploads[0].night,null);assert.equal(pending.uploads[0].expectedRevision,1);
});
test('05.02 first link, incompatible target and unprovable old credits never overwrite silently',()=>{
  const owner=randomUUID(),local=state(),day=local.nights[0].date;
  const remote=snapshot(owner,[{...local.nights[0],rested:1}]);
  assert.equal(reviewSleepReconciliation(local,owner,null,remote).conflicts.length,1);
  assert.equal(reviewSleepReconciliation(local,owner,null,snapshot(owner,[],1,[day])).conflicts.length,1);
  const base=snapshot(owner,local.nights);local.nights[0].target={...local.nights[0].target,hours:7};
  const goal=reviewSleepReconciliation(local,owner,base,base);
  assert.equal(goal.conflicts[0].reason,'original_target');assert.equal(goal.conflicts[0].canKeepLocal,false);
  assert.throws(()=>reviewSleepReconciliation(local,owner,base,base,{[day]:'local'}),/original server target/);
  const deleted=deleteNight(state(),state().nights[0]);
  const unverified=reviewSleepReconciliation(deleted,owner,null,snapshot(owner,[]));
  assert.deepEqual(unverified.unverifiedCredits,[day]);assert.deepEqual(unverified.next.credits,[day]);
  const storage=memory(JSON.stringify(deleted));
  assert.throws(()=>applyReviewedSleepReconciliation(storage,SLEEP_KEY,deleted,unverified,true,owner),/explicit migration/);
  assert.equal(storage.writes(),0);
});
test('05.02 rejects owner changes, stale/truncated server snapshots, regressed credit and same-version mutation',()=>{
  const owner=randomUUID(),local=state(),base=snapshot(owner,local.nights,2);
  assert.throws(()=>reviewSleepReconciliation(local,owner,base,snapshot(randomUUID(),local.nights)),/owner changed/);
  for(const bad of [snapshot(owner,[]),snapshot(owner,local.nights,1),snapshot(owner,[{...local.nights[0],rested:1}],2)])
    assert.throws(()=>reviewSleepReconciliation(local,owner,base,bad),/backwards/);
  const lostCredit=snapshot(owner,[{...local.nights[0],sleepMinutes:100,success:false}],3);
  assert.throws(()=>reviewSleepReconciliation(local,owner,base,lostCredit),/reward history/);
});
test('05.02 reviewed persistence refuses changed inputs and storage failures without clobbering data',()=>{
  const owner=randomUUID(),local=state(),base=snapshot(owner,local.nights),remote=snapshot(owner,[{...local.nights[0],rested:1}],2);
  const review=reviewSleepReconciliation(local,owner,base,remote),raw=JSON.stringify(local),storage=memory(raw);
  assert.throws(()=>applyReviewedSleepReconciliation(storage,SLEEP_KEY,local,review,false,owner),/Review every/);
  assert.throws(()=>applyReviewedSleepReconciliation(storage,SLEEP_KEY,local,review,true,randomUUID()),/owner changed/);
  const modified=structuredClone(local);modified.nights[0].note='Новая правка после просмотра';
  assert.throws(()=>applyReviewedSleepReconciliation(storage,SLEEP_KEY,modified,review,true,owner),/changed after review/);
  const stale=memory(JSON.stringify(modified));
  assert.throws(()=>applyReviewedSleepReconciliation(stale,SLEEP_KEY,local,review,true,owner),/Stored diary changed/);assert.equal(stale.writes(),0);
  const full={getItem:storage.getItem,setItem:()=>{throw Error('Disk full');}};
  assert.throws(()=>applyReviewedSleepReconciliation(full,SLEEP_KEY,local,review,true,owner),/Disk full/);assert.equal(storage.raw(),raw);
  const saved=applyReviewedSleepReconciliation(storage,SLEEP_KEY,local,review,true,owner);
  assert.equal(saved.revision,local.revision+1);assert.equal(saved.nights[0].rested,1);
  assert.throws(()=>applyReviewedSleepReconciliation(storage,SLEEP_KEY,local,review,true,owner),/Stored diary changed/);
});
test('05.02 review uses existing authoritative storage adapter; mirror failure cannot undo its commit',()=>{
  const owner=randomUUID(),local=state(),base=snapshot(owner,local.nights),remote=snapshot(owner,[{...local.nights[0],rested:1}],2);
  const review=reviewSleepReconciliation(local,owner,base,remote),original=JSON.stringify(local);
  let native=original,calls=0;
  const mirror={length:1,key:()=>SLEEP_KEY,getItem:()=>original,setItem:()=>{throw Error('Mirror quota full');},removeItem:()=>{},clear:()=>{}};
  const adapter=createSleepStorage(mirror,{
    readSleepArchive:key=>{assert.equal(key,SLEEP_KEY);return JSON.stringify({raw:native});},
    writeSleepArchive:(key,expected,raw)=>{assert.equal(key,SLEEP_KEY);assert.equal(expected,original);calls++;native=raw;return '';}
  });
  const saved=applyReviewedSleepReconciliation(adapter,SLEEP_KEY,local,review,true,owner);
  assert.equal(calls,1);assert.deepEqual(JSON.parse(native),saved);assert.equal(saved.nights[0].rested,1);
  // This fixture exercises the real JS adapter; it is not an Android device test.
});
test('05.02 legacy offsets and changed JSON key order compare as the same reviewed night',()=>{
  const owner=randomUUID(),local=state(),n=local.nights[0],base=snapshot(owner,[{...n,rewardRule:'v1'}]);
  delete local.nights[0].bedOffset;delete local.nights[0].wakeOffset;delete local.nights[0].rewardRule;
  local.nights[0].target={tolerance:n.target.tolerance,hours:n.target.hours,wake:n.target.wake,bed:n.target.bed};
  const review=reviewSleepReconciliation(local,owner,base,base);
  assert.equal(review.conflicts.length,0);assert.equal(review.uploads.length,0);
  assert.equal(review.next.nights[0].bedOffset,180);assert.equal(review.next.nights[0].wakeOffset,180);
});
