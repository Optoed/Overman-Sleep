/** SQL-only fixtures load the exact migrations used by our Go/PostgreSQL API.
 * Owner context is injected for SQL unit tests; this is not session/auth proof.
 */
import {readFile} from 'node:fs/promises';
import type {PGlite} from '@electric-sql/pglite';
export async function prepareOwnSleepDatabase(db:PGlite,users:string[],options:{diary?:boolean;through?:10|11|12|13|14}={}){
  const migrations=new URL('../../server/db/migrations/',import.meta.url);
  await db.exec(await readFile(new URL('001_accounts.sql',migrations),'utf8'));
  for(const id of users)await db.query('insert into overman.users(id) values($1)',[id]);
  await db.exec(await readFile(new URL('002_sleep_reward_ledger.sql',migrations),'utf8'));
  if(options.diary!==false){
    await db.exec(await readFile(new URL('003_sleep_diary_transaction.sql',migrations),'utf8'));
    await db.exec(await readFile(new URL('004_sleep_diary_cancellation.sql',migrations),'utf8'));
    await db.exec(await readFile(new URL('005_payload_free_cancellation.sql',migrations),'utf8'));
    await db.exec(await readFile(new URL('006_legacy_credit_import.sql',migrations),'utf8'));
    await db.exec(await readFile(new URL('007_account_access.sql',migrations),'utf8'));
    await db.exec(await readFile(new URL('008_sleep_score_model.sql',migrations),'utf8'));
    await db.exec(await readFile(new URL('009_health_connect_source.sql',migrations),'utf8'));
    await db.exec(await readFile(new URL('010_health_source_immutable.sql',migrations),'utf8'));
    if((options.through??14)>=11)await db.exec(await readFile(new URL('011_sleep_fractional_sync.sql',migrations),'utf8'));
    if((options.through??14)>=12)await db.exec(await readFile(new URL('012_health_score_snapshot.sql',migrations),'utf8'));
    if((options.through??14)>=13)await db.exec(await readFile(new URL('013_health_origin_snapshot.sql',migrations),'utf8'));
    if((options.through??14)>=14)await db.exec(await readFile(new URL('014_health_interval_snapshot.sql',migrations),'utf8'));
  }
}
