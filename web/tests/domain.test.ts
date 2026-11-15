import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDay, shiftDay, stats, type Checkin } from '../lib/domain.ts';

const checkin = (day: string, success = true): Checkin => ({
  id: day, user_id: 'one', day, bedtime: '23:00', sleep_minutes: 480,
  rested: success, on_time: true, unplugged: true, discipline: 4,
  target_bedtime: '23:00', target_min: 480, target_max: 540, created_at: '',
});

test('a pending day preserves yesterday’s streak, but a missed day breaks it', () => {
  const items = [checkin('2026-09-27'), checkin('2026-09-28')];
  assert.equal(stats(items, '2026-09-29').current, 2);
  assert.equal(stats(items, '2026-09-30').current, 0);
});
test('partial check-in breaks streak; correcting today restores it', () => {
  const items = [checkin('2026-09-28'), checkin('2026-09-29', false)];
  assert.equal(stats(items, '2026-09-29').current, 0);
  assert.equal(stats([...items.slice(0, 1), checkin('2026-09-29')], '2026-09-29').current, 2);
});
test('week excludes old days, best survives gaps, dates cross years and leap days', () => {
  const items = ['2026-09-19','2026-09-20','2026-09-21','2026-09-28'].map(day => checkin(day));
  assert.deepEqual(stats(items, '2026-09-29'), { current: 1, best: 3, week: 1, total: 4 });
  assert.equal(shiftDay('2027-01-01', -1), '2026-12-31');
  assert.equal(shiftDay('2028-03-01', -1), '2028-02-29');
});
test('reporting day respects player timezone, including midnight', () => {
  const now = new Date('2026-09-28T22:00:00Z');
  assert.equal(localDay('Europe/Moscow', now), '2026-09-29');
  assert.equal(localDay('America/New_York', now), '2026-09-28');
});
