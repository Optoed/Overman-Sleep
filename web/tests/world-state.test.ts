import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, completeSleep, completeFocus, completeGoal, advanceDay, reconcileDate, settleWorld, floorsOf, dayComplete, parseWorld, inferMotifs, saveJournal, stageWorld, seeded } from '../components/tower/world-state';

test('empty island grows through actions, duplicate sleep does not farm rewards', () => {
  const start=createWorld(42,'2026-10-07');
  assert.equal(floorsOf(start),0);
  const sleep=completeSleep(start);
  assert.equal(completeSleep(sleep),sleep);
  let next=completeFocus(sleep);
  assert.equal(next.xp,75); assert.equal(dayComplete(next),true);
  next=advanceDay(next,'done'); next=completeSleep(next);
  assert.equal(floorsOf(next),1); assert.equal(next.streak,1);
  assert.equal(next.events.some(e=>e.title==='Первый этаж'),true);
});
test('skip damages strength but preserves floors; recovery and damage are bounded',()=>{
  let w=stageWorld(createWorld(42),12);
  for(let i=0;i<12;i++)w=advanceDay(w,'skip');
  assert.equal(w.strength,18); assert.equal(floorsOf(w),12);
  w=completeSleep(w);assert.equal(w.strength,30);
  assert.equal(w.events[0].kind,'repair');
});
test('absence is unknown, not automatic punishment',()=>{
  const w=createWorld(42,'2026-10-01');const n=reconcileDate(w,'2026-10-07');
  assert.equal(n.day,7); assert.equal(n.strength,w.strength);assert.equal(n.history[0].status,'unknown');
  assert.equal(reconcileDate(n,'2026-10-07'),n);
});
test('timer survives midnight and is awarded once on its completion date',()=>{
  const w=createWorld(42,'2026-10-07');
  w.timer={duration:1500,remaining:1500,deadline:new Date('2026-10-08T00:10:00').getTime()};
  const midnight=settleWorld(w,new Date('2026-10-08T00:00:00').getTime());
  assert.deepEqual(midnight.timer,w.timer);
  const done=settleWorld(midnight,new Date('2026-10-08T00:11:00').getTime());
  assert.equal(done.today.focus,1);assert.equal(done.timer,null);assert.equal(done.xp,35);
  assert.deepEqual(settleWorld(done,new Date('2026-10-08T00:12:00').getTime()),done);
  const reopened=settleWorld(w,new Date('2026-10-08T00:11:00').getTime());
  assert.deepEqual(reopened,done);
});
test('paused timer survives date rollover and storage',()=>{
  const w=createWorld(42,'2026-10-07');w.timer={deadline:null,remaining:321,duration:1500};
  const next=reconcileDate(w,'2026-10-08');
  assert.deepEqual(parseWorld(JSON.stringify(next))?.timer,w.timer);
});
test('goal completion is idempotent and mode-aware',()=>{
  const w=createWorld(42);w.mode='roadmap';w.goals=[{id:'read',label:'Читать',motif:'library'}];
  assert.equal(dayComplete(w),false);const n=completeGoal(w,'read');
  assert.equal(dayComplete(n),true);assert.equal(n.xp,25);assert.equal(completeGoal(n,'read'),n);assert.equal(completeGoal(n,'invalid'),n);
});
test('diary replaces same-day entry, applies chosen mood and preserves motifs',()=>{
  const motifs=inferMotifs('Прочитал книгу, поработал над проектом');
  assert.deepEqual(motifs,['library','forge']);
  let w=saveJournal(createWorld(42),'Прочитал книгу','Прогулка','heavy',motifs);
  assert.equal(w.weather,'rain');
  w=saveJournal(w,'Теперь спокойно','','bright',['garden']);
  assert.equal(w.weather,'sun');assert.equal(w.journal.length,1);assert.equal(w.motifs.length,3);
});
test('seed is repeatable, demo stages bounded, unsafe storage rejected',()=>{
  assert.deepEqual(createWorld(42,'2026-10-07'),createWorld(42,'2026-10-07'));
  const a=seeded(42),b=seeded(42);assert.deepEqual([a(),a(),a()],[b(),b(),b()]);
  const w=stageWorld(createWorld(42),1000);assert.equal(floorsOf(w),100);
  assert.deepEqual(parseWorld(JSON.stringify(w)),w);
  assert.equal(parseWorld('{'),null);assert.equal(parseWorld(JSON.stringify({...w,xp:1e9})),null);
  assert.equal(parseWorld(JSON.stringify({...w,material:'invalid'})),null);
  assert.equal(parseWorld(JSON.stringify({...w,timer:{duration:1500,remaining:5,deadline:'bad'}})),null);
});
