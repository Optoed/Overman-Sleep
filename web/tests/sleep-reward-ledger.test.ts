import { test } from 'node:test';
import assert from 'node:assert/strict';
import {prepareOwnSleepDatabase} from './sleep-postgres-fixture';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

test('05.02: trusted reward ledger retries, conflicts, deletion, isolation and garden', async () => {
  const db = new PGlite();
  const alice = randomUUID(), bob = randomUUID();
  try {
    await prepareOwnSleepDatabase(db,[alice,bob],{diary:false});
    const apply = async (day: string, revision: number, present = true, success = true, operation = randomUUID(), user = alice) => {
      const result = await db.query<{value: {credits:string[];deletedCredits:string[];garden:boolean;dates:{revision:number}[]}}>(
        'select public.apply_verified_sleep_reward($1,$2,$3,$4,$5,$6) as value',
        [user,operation,day,revision,present,success]);
      return result.rows[0].value;
    };
    await db.exec('set role overman_service');
    const op = randomUUID();
    const first = await apply('2026-01-01',0,true,true,op);
    for (let i=0;i<20;i++) assert.deepEqual(await apply('2026-01-01',0,true,true,op),first);
    await assert.rejects(apply('2026-01-01',0,true,false,op),/different content/);
    await assert.rejects(apply('2026-01-01',0),/revision conflict/);
    const bad = await apply('2026-01-01',1,true,false);
    assert.equal(bad.credits.length,1);
    const removed = await apply('2026-01-01',2,false,false);
    assert.deepEqual(removed.deletedCredits,['2026-01-01']);
    const restored = await apply('2026-01-01',3);
    assert.equal(restored.credits.length,1);
    assert.deepEqual(restored.deletedCredits,[]);
    // Lost response / old retry returns the latest authoritative revision.
    assert.deepEqual(await apply('2026-01-01',0,true,true,op),restored);
    await assert.rejects(apply('2026-01-01',2,false,false),/revision conflict/);
    for(let day=2;day<=7;day++) {
      const result = await apply(`2026-01-0${day}`,0);
      assert.equal(result.credits.length,day);
      assert.equal(result.garden,day===7);
    }
    for(let day=1;day<=7;day++) {
      const result = await apply(`2026-01-0${day}`,day===1?4:1,false,false);
      assert.equal(result.credits.length,7);
      assert.equal(result.garden,true);
    }
    const independent = await apply('2026-01-01',0,true,true,op,bob);
    assert.equal(independent.credits.length,1);
    assert.equal(independent.garden,false);
    await assert.rejects(apply('2026-01-02',0,false,true,randomUUID(),bob),/Invalid/);
    await assert.rejects(apply('2099-01-01',0),/Invalid/);
    // The trusted handler is required: mobile/anonymous roles cannot forge rewards.
    for(const role of ['overman_anonymous','overman_client']) {
      await db.exec(`reset role; set role ${role}`);
      await assert.rejects(apply('2026-01-08',0),/permission denied/);
      await assert.rejects(db.query('select * from public.sleep_reward_dates'),/permission denied/);
      await assert.rejects(db.query('update public.sleep_reward_owners set garden=true'),/permission denied/);
    }
  } finally { await db.close(); }
});
