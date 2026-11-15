import{readdir,readFile}from'node:fs/promises';import{createHash}from'node:crypto';
import{databasePool,localConfig}from'../src/database.mjs';
const pool=databasePool({admin:true,max:1});
try{
  const client=await pool.connect();
  try{
    await client.query('create table if not exists public.overman_schema_migrations(name text primary key,sha256 text not null,applied_at timestamptz not null default now())');
    await client.query('revoke all on public.overman_schema_migrations from public');
    await client.query("select pg_advisory_lock(hashtext('overman-migrations-v1'))");
    const dir=new URL('../db/migrations/',import.meta.url);
    for(const name of(await readdir(dir)).filter(f=>f.endsWith('.sql')).sort()){
      const sql=await readFile(new URL(name,dir),'utf8'),sha=createHash('sha256').update(sql).digest('hex');
      const old=await client.query('select sha256 from public.overman_schema_migrations where name=$1',[name]);
      if(old.rows.length){if(old.rows[0].sha256!==sha)throw Error('Applied migration changed');continue;}
      // The individual migrations own their BEGIN/COMMIT. They are applied only
      // to this dedicated database; checksum records are written after success.
      await client.query(sql);await client.query('insert into public.overman_schema_migrations(name,sha256) values($1,$2)',[name,sha]);
    }
    const role=await client.query("select 1 from pg_roles where rolname='overman_runtime'");
    if(!role.rows.length){const command=await client.query("select format('create role overman_runtime login password %L', $1::text) sql",[localConfig().runtimePassword]);await client.query(command.rows[0].sql);}
    await client.query('grant overman_client to overman_runtime');
    await client.query('grant overman_authenticator to overman_runtime');
    const version=await client.query('show server_version');console.log('Owned PostgreSQL migrations applied; server version '+version.rows[0].server_version);
  }finally{try{await client.query("select pg_advisory_unlock(hashtext('overman-migrations-v1'))");}finally{client.release();}}
}catch(e){console.error('Database migration failed ('+(e.code??'migration_error')+'); details suppressed to keep credentials private.');process.exitCode=1;}
finally{await pool.end();}
