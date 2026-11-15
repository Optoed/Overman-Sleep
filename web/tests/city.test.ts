import test from 'node:test';
import assert from 'node:assert/strict';
import { completeDistrict, demoCity, finishDay, levelOf, newCity, parseCity, population, settleTimer, writeJournal, DISTRICTS } from '../components/city/city-state.ts';

test('a new city starts with plots; first habit builds and cannot award twice', () => {
  const empty = newCity(42); assert.equal(population(empty), 3);
  assert.ok(DISTRICTS.every(d => levelOf(empty.districts[d.id]) === 0));
  const built = completeDistrict(empty, 'sleep'); assert.equal(levelOf(built.districts.sleep), 1);
  assert.equal(completeDistrict(built, 'sleep'), built); assert.equal(empty.districts.sleep.xp, 0);
});
test('only scheduled, unfinished, already built districts incur damage', () => {
  const c = newCity(42); c.districts.sport.xp = 4; c.districts.travel.xp = 4;
  const next = finishDay(c);
  assert.equal(next.districts.sport.damage, 15); assert.equal(next.districts.travel.damage, 0);
  assert.equal(next.districts.sleep.damage, 0); assert.equal(next.day, 2);
  const resting = finishDay(next); assert.equal(resting.districts.sport.damage, 15);
});
test('misses escalate and recovery takes multiple completed days without losing construction XP', () => {
  let c = newCity(42); c.districts.sleep.xp = 8;
  for (let i = 0; i < 5; i++) c = finishDay(c);
  assert.equal(c.districts.sleep.damage, 100); assert.equal(c.districts.sleep.xp, 8);
  c = completeDistrict(c, 'sleep'); assert.equal(c.districts.sleep.damage, 80);
  assert.equal(completeDistrict(c, 'sleep').districts.sleep.damage, 80);
  for (let i = 0; i < 4; i++) c = completeDistrict(finishDay(c), 'sleep');
  assert.equal(c.districts.sleep.damage, 0); assert.equal(c.districts.sleep.xp, 13);
});
test('construction caps at five levels and consecutive days reset daily marks', () => {
  let c = newCity(1);
  for (let i = 0; i < 30; i++) c = finishDay(completeDistrict(c, 'sleep'));
  assert.equal(c.districts.sleep.xp, 15); assert.equal(levelOf(c.districts.sleep), 5);
  assert.equal(c.districts.sleep.done, false); assert.equal(c.districts.sleep.damage, 0);
});
test('expired focus restores after reload, awards once, and day advance cancels timer', () => {
  let c = newCity(1); c.timer = { deadline: 5000, remaining: 1500000, day: 1 };
  const saved = parseCity(JSON.stringify(c))!;
  assert.equal(settleTimer(saved, 4999).districts.career.xp, 0);
  c = settleTimer(saved, 5000); assert.equal(c.districts.career.xp, 1); assert.equal(c.timer, null);
  assert.equal(settleTimer(c, 6000), c);
  c.timer = { deadline: null, remaining: 100000, day: 1 };
  assert.equal(settleTimer(c, 1e9).timer?.remaining, 100000);
  assert.equal(finishDay(c).timer, null);
});
test('journal replaces same day, adds local themes, and mood never damages city', () => {
  let c = newCity(99); c = writeJournal(c, 'Читал книгу, гулял в саду, мечтал о путешествии', 'Вернуться к работе', 'rain');
  assert.deepEqual(c.decorations, ['library', 'garden', 'stars']); assert.equal(c.weather, 'rain');
  assert.ok(DISTRICTS.every(d => c.districts[d.id].damage === 0));
  c = writeJournal(c, 'Спокойный вечер', '', 'mist'); assert.equal(c.journal.length, 1);
});
test('examples are deterministic, independent of personal city, and serializable', () => {
  assert.deepEqual(demoCity('growth'), demoCity('growth'));
  const own = newCity(3), example = completeDistrict(demoCity('crisis'), 'sleep');
  assert.equal(example.districts.sleep.damage, 65); assert.equal(own.districts.sleep.xp, 0);
  assert.deepEqual(parseCity(JSON.stringify(example)), example);
});
test('storage validation rejects corrupted, oversized, and incomplete state', () => {
  assert.equal(parseCity('broken'), null); assert.equal(parseCity(null), null); assert.equal(parseCity('{}'), null);
  const c = newCity(3); c.districts.sleep.damage = 101; assert.equal(parseCity(JSON.stringify(c)), null);
  c.districts.sleep.damage = 0; c.timer = { deadline: 1234, remaining: 10, day: 2 }; assert.equal(parseCity(JSON.stringify(c)), null);
  c.timer = null; c.districts.travel.schedule = [8]; assert.equal(parseCity(JSON.stringify(c)), null);
});
