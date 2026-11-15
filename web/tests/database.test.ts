import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Historical schema regression only. This does not test the current Go API or product friends.
test('Legacy SQL archive: reports, ownership and former friendship privacy', async t => {
  const db = new PGlite();
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';
  const eve = '33333333-3333-4333-8333-333333333333';
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    insert into auth.users values ('${alice}'), ('${bob}'), ('${eve}');`);
  await db.exec(await readFile(new URL('../../docs/legacy/2026-11-09-hosted-backend/web-supabase/migrations/202609290001_initial.sql', import.meta.url), 'utf8'));
  const todayResult = await db.query<{ today: string }>("select ((now() at time zone 'Europe/Moscow')::date)::text as today");
  const today = todayResult.rows[0].today;
  const actAs = async (id: string) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await db.exec('set role authenticated');
  };
  const profile = (name: string) => db.query("select public.save_profile($1, '23:00', 480, 540, 'Europe/Moscow')", [name]);
  const report = (day = today, minutes = 480, rested = true) => db.query(
    "select public.save_checkin($1::date, '23:00', $2, $3, true, true, 4)", [day, minutes, rested]);

  await t.test('profiles have unique nicknames, private email is never in public tables', async () => {
    await actAs(alice); await profile('Alice');
    await actAs(bob);
    await assert.rejects(profile('alice'), /profiles_nickname_unique/);
    await profile('Bob');
    const result = await db.query<Record<string, unknown>>('select * from public.profiles');
    assert.equal(result.rows.length, 2);
    assert.ok(!('email' in result.rows[0]!));
  });
  await t.test('daily saves are idempotent and cannot change another owner', async () => {
    await actAs(alice); await report(); await report();
    const result = await db.query<{ user_id: string }>('select * from public.checkins');
    assert.equal(result.rows.length, 1); assert.equal(result.rows[0].user_id, alice);
    await actAs(bob); await report();
    await assert.rejects(db.query('update public.checkins set discipline = 5 where user_id = $1', [alice]), /permission denied/);
    await assert.rejects(db.query('delete from public.profiles where id = $1', [alice]), /permission denied/);
  });
  await t.test('server rejects backdating, future dates and inconsistent duration', async () => {
    await assert.rejects(report('2000-01-01'), /report_day_closed/);
    await assert.rejects(report('2100-01-01'), /report_day_closed/);
    await assert.rejects(report(today, 300, true), /sleep_target_mismatch/);
    await report(today, 300, false);
    await assert.rejects(db.query("select public.save_checkin($1::date, '23:00', 480, true, true, true, 6)", [today]), /check constraint/);
  });
  await t.test('changing a target preserves the current day and historical goals', async () => {
    await actAs(alice);
    await db.query("select public.save_profile('Alice', '22:00', 420, 480, 'Europe/Moscow')");
    await report();
    const result = await db.query<{ target_min: number }>('select target_min from public.checkins where user_id = $1', [alice]);
    assert.equal(result.rows[0].target_min, 480);
    await assert.rejects(report(today, 420, true), /sleep_target_mismatch/);
  });
  await t.test('friend requests require recipient acceptance and remain private', async () => {
    await actAs(alice);
    await db.query("select public.manage_friendship($1, 'request')", [bob]);
    await db.query("select public.manage_friendship($1, 'request')", [bob]);
    assert.equal((await db.query('select * from public.friendships')).rows.length, 1);
    await assert.rejects(db.query("select public.manage_friendship($1, 'accept')", [bob]), /request_not_found/);
    await actAs(eve); await profile('Eve');
    assert.equal((await db.query('select * from public.friendships')).rows.length, 0);
    await actAs(bob); await db.query("select public.manage_friendship($1, 'accept')", [alice]);
    const result = await db.query<{ status: string }>('select status from public.friendships');
    assert.equal(result.rows[0].status, 'accepted');
    await db.query("select public.manage_friendship($1, 'remove')", [alice]);
    assert.equal((await db.query('select * from public.friendships')).rows.length, 0);
  });
  await t.test('anonymous visitors cannot read or write participant data', async () => {
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from public.profiles'), /permission denied/);
    await assert.rejects(profile('Anonymous'), /permission denied/);
    await assert.rejects(report(), /permission denied/);
  });
  await db.close();
});
