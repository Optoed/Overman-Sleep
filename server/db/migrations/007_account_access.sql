-- Minimal own-account access required by diary sync05.02. No friends/email delivery.
begin;
do $$begin if not exists(select 1 from pg_roles where rolname='overman_authenticator') then create role overman_authenticator nologin;end if;end$$;
create table overman.credentials(user_id uuid primary key references overman.users(id) on delete cascade,login text unique not null check(login~'^[a-z0-9_]{3,32}$'),salt bytea not null check(octet_length(salt)=32),digest bytea not null check(octet_length(digest)=32),algorithm text not null default 'argon2id-v1' check(algorithm='argon2id-v1'));
create table overman.auth_attempts(key bytea primary key,failures integer not null default 0,blocked_until timestamptz,updated_at timestamptz not null default now());
create table overman.auth_rate_buckets(key bytea primary key,started_at timestamptz not null default now(),requests integer not null default 0);
revoke all on overman.credentials,overman.auth_attempts,overman.auth_rate_buckets from public,overman_anonymous,overman_client,overman_service,overman_authenticator;

create function overman.auth_rate(p_key bytea) returns boolean language plpgsql security definer set search_path=pg_catalog,overman as $$
declare n integer;
begin
 if octet_length(p_key) is distinct from 32 then raise exception 'Invalid auth key';end if;
 -- Only expired transient counters are pruned, never accounts/credentials/diary.
 delete from overman.auth_rate_buckets where started_at<now()-interval '1 day';
 insert into overman.auth_rate_buckets(key,requests) values(p_key,1) on conflict(key) do update set
  requests=case when auth_rate_buckets.started_at<now()-interval '1 minute' then 1 else auth_rate_buckets.requests+1 end,
  started_at=case when auth_rate_buckets.started_at<now()-interval '1 minute' then now() else auth_rate_buckets.started_at end returning requests into n;
 return n<=120;
end$$;
create function overman.register_account(p_user uuid,p_login text,p_salt bytea,p_digest bytea,p_token bytea) returns timestamptz language plpgsql security definer set search_path=pg_catalog,overman as $$
declare expires timestamptz=now()+interval '30 days';
begin
 if p_user is null or p_login is null or p_login!~'^[a-z0-9_]{3,32}$' or octet_length(p_salt) is distinct from 32 or octet_length(p_digest) is distinct from 32 or octet_length(p_token) is distinct from 32 then raise exception 'Invalid registration';end if;
 insert into overman.users(id) values(p_user);
 insert into overman.credentials(user_id,login,salt,digest) values(p_user,p_login,p_salt,p_digest);
 insert into overman.sessions(token_hash,user_id,expires_at,revoked) values(p_token,p_user,expires,false);
 return expires;
end$$;
create function overman.auth_challenge(p_login text) returns table(user_id uuid,salt bytea,digest bytea,blocked boolean) language plpgsql security definer set search_path=pg_catalog,overman as $$
declare attempt_key bytea=sha256(convert_to(p_login,'UTF8'));
begin
 if p_login is null or p_login!~'^[a-z0-9_]{3,32}$' then raise exception 'Invalid login';end if;
 insert into overman.auth_attempts(key) values(attempt_key) on conflict do nothing;
 perform 1 from overman.auth_attempts where key=attempt_key for update;
 update overman.auth_attempts set failures=0,blocked_until=null where key=attempt_key and ((blocked_until is not null and blocked_until<=now()) or updated_at<now()-interval '15 minutes');
 return query select c.user_id,c.salt,c.digest,coalesce(a.blocked_until>now(),false) from overman.auth_attempts a left join overman.credentials c on c.login=p_login where a.key=attempt_key;
end$$;
create function overman.finish_login(p_login text,p_success boolean,p_token bytea) returns timestamptz language plpgsql security definer set search_path=pg_catalog,overman as $$
declare attempt_key bytea=sha256(convert_to(p_login,'UTF8'));owner_id uuid;expires timestamptz=now()+interval '30 days';
begin
 if p_login is null or p_login!~'^[a-z0-9_]{3,32}$' or p_success is null or octet_length(p_token) is distinct from 32 then raise exception 'Invalid login completion';end if;
 perform 1 from overman.auth_attempts where key=attempt_key and (blocked_until is null or blocked_until<=now()) for update;
 if not found then raise exception 'Login attempt not available';end if;
 if not p_success then
  update overman.auth_attempts set failures=failures+1,updated_at=now(),blocked_until=case when failures+1>=5 then now()+interval '5 minutes' else null end where key=attempt_key;return null;
 end if;
 select id into owner_id from overman.users u join overman.credentials c on c.user_id=u.id where c.login=p_login;
 if owner_id is null then raise exception 'Invalid login completion';end if;
 update overman.auth_attempts set failures=0,blocked_until=null,updated_at=now() where key=attempt_key;
 insert into overman.sessions(token_hash,user_id,expires_at,revoked) values(p_token,owner_id,expires,false);return expires;
end$$;
create function overman.revoke_session(p_token bytea) returns void language sql security definer set search_path=pg_catalog,overman as $$update overman.sessions set revoked=true where token_hash=p_token$$;
revoke all on function overman.auth_rate(bytea),overman.register_account(uuid,text,bytea,bytea,bytea),overman.auth_challenge(text),overman.finish_login(text,boolean,bytea),overman.revoke_session(bytea) from public,overman_anonymous,overman_client,overman_service;
grant usage on schema overman to overman_authenticator;
grant execute on function overman.auth_rate(bytea),overman.register_account(uuid,text,bytea,bytea,bytea),overman.auth_challenge(text),overman.finish_login(text,boolean,bytea),overman.revoke_session(bytea) to overman_authenticator;
commit;