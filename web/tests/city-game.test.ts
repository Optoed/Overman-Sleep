import test from 'node:test';
import assert from 'node:assert/strict';
import { completeDistrict, finishDay, newCity, parseCity } from '../components/city/city-state.ts';
import { buyUpgrade, claimQuest, harvestEnergy, settleConstruction, startConstruction, touchActivity } from '../components/city/city-game.ts';

test('energy accrues only on return, once, in whole minutes with caps and clock bounds', () => {
  const start = 1_000_000, c = touchActivity(newCity(1), start);
  assert.equal(harvestEnergy(c, start + 59999).game.energy, 40);
  const returned = harvestEnergy(c, start + 3_600_000);
  assert.equal(returned.game.energy, 100); assert.equal(returned.game.lastHarvest, 60);
  assert.equal(harvestEnergy(returned, start + 3_600_000).game.energy, 100);
  assert.equal(harvestEnergy(c, start - 100).game.energy, 40);
  assert.equal(harvestEnergy(c, start + 86400000).game.energy, 500);
  const full = { ...c, game: { ...c.game, energy: 495 } };
  assert.equal(harvestEnergy(full, start + 600000).game.lastHarvest, 5);
});
test('visible heartbeats do not earn energy and prevent an active session from accumulating it', () => {
  let c = touchActivity(newCity(1), 100000);
  for (let t = 110000; t <= 3700000; t += 10000) c = touchActivity(c, t);
  assert.equal(c.game.energy, 40); assert.equal(harvestEnergy(c, 3710000).game.energy, 40);
});
test('energy construction costs once, survives reload and never completes a habit', () => {
  const c = startConstruction(newCity(1), 'sport', 100000);
  assert.equal(c.game.energy, 20); assert.equal(startConstruction(c, 'sport', 100001), c);
  const restored = parseCity(JSON.stringify(c))!;
  assert.equal(settleConstruction(restored, 129999), restored);
  const done = settleConstruction(restored, 130000);
  assert.equal(done.districts.sport.xp, 1); assert.equal(done.districts.sport.done, false);
  assert.equal(done.game.jobs.length, 0); assert.equal(done.game.builds, 1);
  assert.equal(settleConstruction(done, 200000), done);
});
test('construction cannot overspend or buy maxed buildings; repairs are bounded', () => {
  let c = newCity(1); c.game.energy = 19; assert.equal(startConstruction(c, 'sleep', 1000), c);
  c.game.energy = 40; c.districts.sleep.xp = 15; assert.equal(startConstruction(c, 'sleep', 1000), c);
  c.districts.sleep.damage = 5; c = settleConstruction(startConstruction(c, 'sleep', 1000), 31000);
  assert.equal(c.districts.sleep.xp, 15); assert.equal(c.districts.sleep.damage, 0); assert.equal(c.game.repairs, 1);
});
test('habit rewards, three-action bonus, and quest claims are idempotent', () => {
  let c = newCity(1); assert.equal(claimQuest(c, 'first'), c);
  c = completeDistrict(c, 'sleep'); assert.equal(c.game.coins, 45);
  assert.equal(completeDistrict(c, 'sleep'), c);
  c = completeDistrict(completeDistrict(c, 'career'), 'knowledge'); assert.equal(c.game.coins, 85);
  c = claimQuest(c, 'trio'); assert.equal(c.game.coins, 120); assert.equal(c.game.energy, 55);
  assert.equal(claimQuest(c, 'trio'), c); assert.equal(claimQuest(c, 'unknown'), c);
});
test('a pending construction refunds energy if a habit finishes the building first', () => {
  let c = newCity(1); c.districts.sleep.xp = 14;
  c = startConstruction(c, 'sleep', 1000); c = completeDistrict(c, 'sleep');
  c = settleConstruction(c, 31000);
  assert.equal(c.game.energy, 40); assert.equal(c.game.jobs.length, 0); assert.equal(c.game.builds, 0);
  assert.equal(c.districts.sleep.xp, 15);
});
test('upgrades charge once and apply park, rescue and workshop bonuses', () => {
  let c = newCity(1); assert.equal(buyUpgrade(c, 'workshop'), c);
  c.game.coins = 500; c = buyUpgrade(c, 'park'); assert.equal(c.game.coins, 440); assert.equal(buyUpgrade(c, 'park'), c);
  c = completeDistrict(c, 'sleep'); assert.equal(c.game.coins, 460);
  c = buyUpgrade(c, 'rescue'); c = finishDay(finishDay(c)); assert.equal(c.districts.sleep.damage, 10);
  c = buyUpgrade(c, 'workshop'); c = startConstruction(c, 'knowledge', 1000); assert.equal(c.game.jobs[0].end, 16000);
});
test('v1 saves migrate without losing history, buildings or journal; malformed economy rejected', () => {
  const original = completeDistrict(newCity(42), 'knowledge');
  const legacy = { ...original, version: 1, game: undefined };
  const migrated = parseCity(JSON.stringify(legacy))!; assert.ok(migrated); assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.districts, original.districts); assert.deepEqual(migrated.events, original.events);
  assert.equal(migrated.game.energy, 40);
  const invalid = newCity(42); invalid.game.coins = -1; assert.equal(parseCity(JSON.stringify(invalid)), null);
  invalid.game.coins = 20; invalid.game.jobs = [{ district: 'sport', start: 1000, end: 2000 }, { district: 'sport', start: 1000, end: 2000 }];
  assert.equal(parseCity(JSON.stringify(invalid)), null);
});
