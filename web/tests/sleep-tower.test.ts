import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, floorsOf } from '../components/tower/world-state';
import { defaultSchedule, demoSleep, distance, freshSleep, parseSleep, persistSleep, recordNight, editNight, sleepWorld, streaks, validSchedule, type SleepState } from '../components/sleep/sleep-state';
const now = +new Date('2026-10-20T12:00:00');
function night(s: SleepState, day: number, good = true) {
  const input={ bed: +new Date(`2026-10-${String(day - 1).padStart(2, '0')}T${good ? '23:00' : '22:00'}`), wake: +new Date(`2026-10-${String(day).padStart(2, '0')}T07:30`), sleepMinutes: 480, rested: 1 };
  const old=s.nights.find(n=>n.date===`2026-10-${String(day).padStart(2,'0')}`);return old?editNight(s,old,input,now):recordNight(s,input,now);
}
test('seven cumulative successful nights build exactly one floor, streak earns a permanent garden', () => {
  let s = freshSleep(createWorld(42));
  for (let i = 2; i <= 7; i++) { s = night(s, i); assert.equal(floorsOf(sleepWorld(s)), 0); }
  s = night(s, 8); assert.equal(floorsOf(sleepWorld(s)), 1); assert.equal(s.garden, true);
  assert.equal(streaks(s.nights, '2026-10-08').current, 7); assert.equal(streaks(s.nights, '2026-10-09').current, 7); assert.equal(streaks(s.nights, '2026-10-10').current, 0);
  s = night(s, 9, false); assert.equal(s.garden, true); assert.equal(floorsOf(sleepWorld(s)), 1); assert.equal(streaks(s.nights, '2026-10-09').current, 0);
  assert.equal(sleepWorld(s).strength, 90); // Self-reported tiredness never damages buildings.
});
test('gaps break the streak but never remove cumulative construction or old-world floors', () => {
  let base = createWorld(42); base = { ...base, xp: 495 };
  let s = freshSleep(base);
  for (const day of [2, 3, 5, 7, 9, 11]) { s = night(s, day); assert.equal(floorsOf(sleepWorld(s)), 4); }
  s = night(s, 12); assert.equal(floorsOf(sleepWorld(s)), 5); assert.equal(s.garden, false); assert.equal(base.xp, 495);
});
test('corrections replace one night without farming rewards, preserve target snapshot and earned floors', () => {
  let s = night(freshSleep(), 2); const old = s.nights[0];
  s = night(s, 2); assert.equal(s.credits.length, 1); assert.equal(s.nights.length, 1);
  s = { ...s, schedule: { ...defaultSchedule, bed: '21:00' } };
  s = night(s, 2, false); assert.deepEqual(s.nights[0].target, old.target); assert.equal(s.nights[0].success, false); assert.equal(s.credits.length, 1);
  s = night(s, 2); assert.equal(s.credits.length, 1); assert.equal(s.nights[0].success, true);
});
test('night capture survives reload, old history does not end a current night, invalid dates and durations fail', () => {
  let s = freshSleep(); s.active = { started: +new Date('2026-10-19T23:00'), target: { ...defaultSchedule } };
  assert.deepEqual(parseSleep(JSON.stringify(s)), s);
  s = night(s, 2); assert.notEqual(s.active, null);
  const input = { bed: now - 8 * 3600000, wake: now, sleepMinutes: 480, rested: 3 };
  assert.throws(() => recordNight(s, { ...input, sleepMinutes: 600 }, now));
  assert.throws(() => recordNight(s, { ...input, bed: now + 1 }, now));
  assert.throws(() => recordNight(s, { ...input, wake: now + 3600000 }, now));
  assert.deepEqual(recordNight(s, input, now).active, s.active);
  assert.equal(distance('23:55', '00:10'), 15); assert.equal(validSchedule({ ...defaultSchedule, wake: '04:00' }), false);
});
test('storage errors, corrupted records and conflicting revisions never overwrite data', () => {
  let raw: string | null = null; const storage = { getItem: () => raw, setItem: (_: string, value: string) => { raw = value; } };
  const initial = freshSleep(); const saved = persistSleep(storage, 'test', initial, night(initial, 2));
  assert.equal(saved.revision, 1); assert.throws(() => persistSleep(storage, 'test', initial, initial));
  const before = raw; assert.throws(() => persistSleep({ ...storage, setItem: () => { throw Error('quota'); } }, 'test', saved, saved)); assert.equal(raw, before);
  assert.throws(() => parseSleep('{')); assert.throws(() => parseSleep(JSON.stringify({ ...saved, nights: [...saved.nights, saved.nights[0]] })));
  assert.throws(() => parseSleep(JSON.stringify({ ...saved, credits: [] })));
  assert.equal(parseSleep(null), null);
});
test('all demo stages render exact floor counts without sharing personal state', () => {
  for (const floors of [0, 4, 12, 24, 100]) { const s = demoSleep(floors, now); assert.equal(floorsOf(sleepWorld(s)), floors); assert.ok(parseSleep(JSON.stringify(s))); }
});
