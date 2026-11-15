import test from 'node:test';
import assert from 'node:assert/strict';
import { shadowSchedule } from '../components/tower/shadow-schedule';

test('shadow reuse is bounded while lighting changes and fast geometry always refresh immediately',()=>{
  const clock=shadowSchedule();assert.equal(clock.due(0),true);
  assert.equal(clock.due(32),false);assert.equal(clock.due(64),false);assert.equal(clock.due(65),true);
  clock.invalidate();assert.equal(clock.due(66),true);assert.equal(clock.due(67),false);
  for(let now=68;now<100;now++)assert.equal(clock.due(now,true),true);
  assert.equal(clock.due(100),false);assert.equal(clock.due(170),true);
  assert.equal(clock.due(1),true); // Clock reset cannot leave a stale map.
});
