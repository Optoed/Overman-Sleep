import {importBeforeInterval} from './sleep-health-legacy-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {prepareOwnSleepDatabase} from './sleep-postgres-fixture';
import {freshSleep} from '../components/sleep/sleep-state';
import {importHealthNight} from '../components/sleep/sleep-health-import';

test('draft SQL accepts only a health v2 night without self-report and preserves old data',async()=>{
 const minute=60000,bed=Date.UTC(2026,0,1,23),wake=bed+480*minute;
 const state=importBeforeInterval(freshSleep(),[{start:bed,end:wake,stages:[{start:bed,end:wake,kind:'sleeping'}]}],0,{bed:0,wake:0},4,wake+minute);
 const old=JSON.parse(JSON.stringify(state.nights[0]));delete old.healthScore;const withoutMood={...old};delete withoutMood.rested;
 const db=new PGlite();try{
  await prepareOwnSleepDatabase(db,[]);
  await db.exec(await readFile(new URL('../../server/tests/fixtures/health-optional-mood-draft.sql',import.meta.url),'utf8'));
  const validate=async(n:unknown)=>db.query<{night:Record<string,unknown>}>('select public.validate_sleep_night($1::jsonb,$2::date) night',[JSON.stringify(n),old.date]);
  assert.deepEqual((await validate(old)).rows[0].night,old);
  const saved=(await validate(withoutMood)).rows[0].night;assert.equal(Object.hasOwn(saved,'rested'),false);
  await assert.rejects(validate({...withoutMood,source:'manual'}));
  await assert.rejects(validate({...withoutMood,scoreModel:undefined}));
  await assert.rejects(validate({...withoutMood,rested:null}));
  await assert.rejects(validate({...withoutMood,rested:0}));
 }finally{await db.close();}
});
