begin;
create schema overman;
create table overman.users(id uuid primary key,created_at timestamptz not null default now());
create table overman.sessions(token_hash bytea primary key,user_id uuid not null references overman.users(id) on delete cascade,
  expires_at timestamptz not null,revoked boolean not null default false);
do $$begin
  if not exists(select 1 from pg_roles where rolname='overman_anonymous') then create role overman_anonymous nologin;end if;
  if not exists(select 1 from pg_roles where rolname='overman_client') then create role overman_client nologin;end if;
  if not exists(select 1 from pg_roles where rolname='overman_service') then create role overman_service nologin;end if;
end$$;
create function overman.request_owner() returns uuid language sql stable set search_path=pg_catalog as $$
  select nullif(current_setting('overman.owner_id',true),'')::uuid
$$;
create function overman.resolve_session(p_hash bytea) returns uuid language sql stable security definer set search_path=pg_catalog,overman as $$
  select user_id from overman.sessions where token_hash=p_hash and not revoked and expires_at>now()
$$;
revoke all on schema overman from public;
revoke all on all tables in schema overman from public,overman_anonymous,overman_client;
revoke all on all functions in schema overman from public,overman_anonymous,overman_client;
grant usage on schema overman to overman_client;
grant execute on function overman.request_owner(),overman.resolve_session(bytea) to overman_client;
commit;
