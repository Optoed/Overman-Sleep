import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {prepareOwnSleepDatabase} from './sleep-postgres-fixture';
import { PGlite } from '@electric-sql/pglite';
import { nightChecks, type Night } from '../components/sleep/sleep-state';

type Snapshot={protocolVersion:number;credits:string[];deletedCredits:string[];garden:boolean;dates:{date:string;revision:number;night:Night|null}[]};
function night(date='2026-01-01'):Night {
  const wake=Date.parse(`${date}T07:30:00+03:00`),bed=wake-510*60000;
  return {date,bed,wake,bedOffset:180,wakeOffset:180,bedClock:'23:00',wakeClock:'07:30',
    sleepMinutes:480,rested:3,target:{bed:'23:00',wake:'07:30',hours:8,tolerance:45},success:true,
    source:'manual',rewardRule:'v1',note:'Вымышленная тестовая ночь'};
}

test('05.02: authenticated diary and reward form one PostgreSQL transaction',async t=>{
  const db=new PGlite(),alice=randomUUID(),bob=randomUUID(),createdOperation=randomUUID();
  try{
    await prepareOwnSleepDatabase(db,[alice,bob]);
    await db.exec("set timezone='Pacific/Honolulu'");
    let activeOwner:string=alice;
    const as=async(user:string,role='overman_client')=>{
      await db.exec('reset role');await db.query("select set_config('overman.owner_id',$1,false)",[user]);
      await db.exec(`set role ${role}`);activeOwner=user||alice;
    };
    const read=async()=> (await db.query<{s:Snapshot}>('select public.read_sleep_diary() s')).rows[0].s;
    const save=async(n:Night|null,rev:number,op=randomUUID(),date=n?.date??'2026-01-01')=>
      (await db.query<{s:Snapshot}>('select public.save_sleep_diary_operation($1,$2,$3,$4::jsonb,$5) s',[op,date,rev,n===null?null:JSON.stringify(n),activeOwner])).rows[0].s;
    await as(alice);
    await t.test('lost responses, edited payloads, stale edits and own-account reads',async()=>{
      assert.deepEqual((await read()).dates,[]);
      const n=night(),op=createdOperation,first=await save(n,0,op);
      assert.equal(first.protocolVersion,1);assert.deepEqual(first.credits,[n.date]);
      assert.equal(first.dates[0].revision,1);assert.deepEqual(first.dates[0].night,n);
      for(let i=0;i<20;i++)assert.deepEqual(await save(n,0,op),first);
      await assert.rejects(save({...n,note:'Подмена при том же UUID'},0,op),/different diary content/);
      const edited=await save({...n,rested:1},1);
      assert.deepEqual(await save(n,0,op),edited);
      await assert.rejects(save({...n,rested:5},1),/revision conflict/);
      assert.deepEqual(await read(),edited);
      await assert.rejects(save({...n,target:{...n.target,hours:7}},2),/original target/);
      assert.deepEqual(await read(),edited);
      await as(bob);assert.deepEqual((await read()).dates,[]);
      const b=await save(n,0,op);assert.equal(b.dates[0].night?.rested,3);
      await as(alice);assert.equal((await read()).dates[0].night?.rested,1);
    });
    await t.test('server recomputes success; correction/delete/re-add preserve one credit',async()=>{
      const n=night();let result=await save({...n,sleepMinutes:100,success:true},2);
      assert.equal(result.dates[0].night?.success,false);assert.equal(result.credits.length,1);
      result=await save(null,3);assert.deepEqual(result.deletedCredits,[n.date]);
      assert.equal(result.dates[0].night,null);
      assert.deepEqual(await save(n,0,createdOperation),result); // No resurrection after deletion.
      result=await save(n,4);assert.equal(result.credits.length,1);assert.deepEqual(result.deletedCredits,[]);
      const bad={...night('2026-01-02'),sleepMinutes:100,success:true};
      result=await save(bad,0);assert.equal(result.credits.length,1);
      result=await save(night('2026-01-02'),1);assert.equal(result.credits.length,2);
    });
    await t.test('invalid payloads roll back without consuming their operation identifier',async()=>{
      const good=night('2026-02-01');
      const invalid:unknown[]=[{...good,bed:'123'},{...good,rested:1.5},{...good,bedOffset:900},
        {...good,wakeOffset:null},{...good,bedClock:'22:59'},{...good,date:'2026-02-02'},
        {...good,wake:good.bed},{...good,sleepMinutes:511},{...good,latencyMinutes:31,awakeMinutes:0},
        {...good,latencyMinutes:0,awakeMinutes:0},{...good,rewardRule:'v2'},
        {...good,note:'😀'.repeat(1001)},{...good,note:null},{...good,success:'true'},
        {...good,user_id:bob},{...good,target:{...good.target,hours:'8'}},
        {...good,target:{...good.target,tolerance:46}},{...good,target:{...good.target,wake:'01:00'}},
        {...good,wake:Date.now()+86400000},[],42];
      const before=await read();
      for(const bad of invalid){const op=randomUUID();
        await assert.rejects(save(bad as Night,0,op,good.date));assert.deepEqual(await read(),before);
      }
      const op=randomUUID();await assert.rejects(save({...good,rested:0},0,op));
      assert.equal((await save(good,0,op)).dates.find(d=>d.date===good.date)?.revision,1);
    });
    await t.test('SQL reward calculation matches frozen client v1 at time and duration boundaries',async()=>{
      await db.exec('reset role');
      const base=night('2026-03-01');
      for(const shift of [-46,-45,0,45,46])for(const duration of [449,450,460]){
        const n={...base,bed:base.bed+shift*60000,bedClock:new Date(base.bed+(shift+180)*60000).toISOString().slice(11,16),sleepMinutes:duration};
        // Positive bedtime shift shortens the interval to at least 464 min.
        const result=await db.query<{n:Night}>('select public.validate_sleep_night($1::jsonb,$2::date) n',[JSON.stringify(n),n.date]);
        assert.equal(result.rows[0].n.success,Object.values(nightChecks(n)).every(Boolean));
      }
      for(const shift of [-46,-45,0,45,46]){
        const n={...base,wake:base.wake+shift*60000,wakeClock:new Date(base.wake+(shift+180)*60000).toISOString().slice(11,16),sleepMinutes:450};
        const result=await db.query<{n:Night}>('select public.validate_sleep_night($1::jsonb,$2::date) n',[JSON.stringify(n),n.date]);
        assert.equal(result.rows[0].n.success,Object.values(nightChecks(n)).every(Boolean));
      }
      const dst={...base,bedOffset:120,bedClock:'22:00'};
      const result=await db.query<{n:Night}>('select public.validate_sleep_night($1::jsonb,$2::date) n',[JSON.stringify(dst),dst.date]);
      assert.equal(result.rows[0].n.success,Object.values(nightChecks(dst)).every(Boolean));
      await as(alice);
      await assert.rejects(db.query('select public.save_sleep_diary_operation($1,$2,0,$3::jsonb,$4)',
        [randomUUID(),'2026-05-01',JSON.stringify(night('2026-05-01')),bob]),/owner changed/);
    });
    await t.test('a failure after reward insertion rolls back diary, ledger and receipts',async()=>{
      await db.exec(`reset role;create function public.test_diary_failure() returns trigger language plpgsql as $$
        begin if new.wake_date=date '2026-04-01' then raise exception 'Injected diary write failure';end if;return new;end $$;
        create trigger test_failure before insert or update on public.sleep_diary_dates
        for each row execute function public.test_diary_failure();`);
      await as(alice);const before=await read(),op=randomUUID(),n=night('2026-04-01');
      await assert.rejects(save(n,0,op),/Injected diary write failure/);assert.deepEqual(await read(),before);
      await db.exec('reset role;drop trigger test_failure on public.sleep_diary_dates;drop function public.test_diary_failure()');
      await as(alice);const result=await save(n,0,op);
      assert.equal(result.dates.find(d=>d.date===n.date)?.revision,1);
      assert.equal(result.credits.filter(d=>d===n.date).length,1);
    });
    await t.test('unknown identities and full archive cannot leave partial rewards; old dates still editable',async()=>{
      const missing=randomUUID();await as(missing);
      await assert.rejects(save(night('2026-05-01'),0),/foreign key/);
      await db.exec('reset role');
      assert.equal((await db.query('select * from public.sleep_reward_owners where user_id=$1',[missing])).rows.length,0);
      const full=randomUUID();await db.query('insert into overman.users(id) values ($1)',[full]);
      await db.query('insert into public.sleep_reward_owners(user_id) values ($1)',[full]);
      await db.query(`insert into public.sleep_reward_dates
        select $1,date '2010-01-01'+i,1,false,false,false from generate_series(0,1999) i`,[full]);
      await as(full);await assert.rejects(save(night('2026-05-01'),0),/archive limit/);
      const restored=await save(night('2010-01-01'),1);
      assert.equal(restored.dates.length,2000);assert.deepEqual(restored.credits,['2010-01-01']);
      const removed=await save(null,2,randomUUID(),'2010-01-01');
      assert.deepEqual(removed.deletedCredits,['2010-01-01']);
      await as(alice);
    });
    await t.test('seven days open a permanent garden; deleting all payloads retains only dates/digests',async()=>{
      await as(bob);
      for(let d=2;d<=7;d++)assert.equal((await save(night(`2026-01-0${d}`),0)).garden,d===7);
      for(let d=1;d<=7;d++){const s=await save(null,1,randomUUID(),`2026-01-0${d}`);
        assert.equal(s.garden,true);assert.equal(s.credits.length,7);}
      const s=await read();assert.ok(s.dates.every(d=>d.night===null));assert.equal(s.deletedCredits.length,7);
      await db.exec('reset role');
      const receipts=await db.query<{bytes:number}>('select octet_length(fingerprint) bytes from public.sleep_diary_receipts');
      assert.ok(receipts.rows.every(r=>r.bytes===32));
    });
    await t.test('anonymous, identity-free and direct table/validator access are rejected',async()=>{
      await as('', 'overman_anonymous');await assert.rejects(read(),/permission denied/);
      await assert.rejects(save(night('2026-05-01'),0),/permission denied/);
      await as('');await assert.rejects(read(),/Authentication required/);await assert.rejects(save(night(),0),/Authentication required/);
      await as(alice);
      for(const sql of ['select * from public.sleep_diary_dates','select * from public.sleep_diary_receipts',
        `select public.sleep_diary_snapshot('${bob}')`,`select public.validate_sleep_night('{}','2026-01-01')`,
        `select public.apply_verified_sleep_reward('${alice}','${randomUUID()}','2026-01-01',0,true,true)`])
        await assert.rejects(db.query(sql),/permission denied/);
    });
  }finally{await db.close();}
});
