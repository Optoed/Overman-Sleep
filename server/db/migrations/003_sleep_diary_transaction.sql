-- 05.02: prepare overman_client, atomic diary/reward operations.
-- Deployment and real two-client delivery remain separate acceptance conditions.
begin;
create table public.sleep_diary_dates (
  user_id uuid not null references public.sleep_reward_owners(user_id) on delete cascade,
  wake_date date not null,
  night jsonb,
  primary key(user_id,wake_date)
);
create table public.sleep_diary_receipts (
  user_id uuid not null references public.sleep_reward_owners(user_id) on delete cascade,
  operation_id uuid not null,
  fingerprint bytea not null,
  primary key(user_id,operation_id)
);
alter table public.sleep_diary_dates enable row level security;
alter table public.sleep_diary_receipts enable row level security;
revoke all on public.sleep_diary_dates,public.sleep_diary_receipts from public,overman_anonymous,overman_client;

-- JSON numbers must be numbers, never numeric strings, null, NaN or infinity.
create function public.sleep_json_number(v jsonb, lo numeric, hi numeric)
returns boolean language sql immutable set search_path=pg_catalog as $$
  select case when jsonb_typeof(v)='number' then (v::numeric between lo and hi) else false end
$$;
revoke all on function public.sleep_json_number(jsonb,numeric,numeric) from public,overman_anonymous,overman_client;

-- Requires explicit historical UTC offsets. A future client adapter must resolve
-- legacy offsets before upload; today's device timezone is never substituted.
create function public.validate_sleep_night(n jsonb, expected_date date)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare
  bed_ms numeric; wake_ms numeric; total numeric; sleep_min numeric;
  latency numeric; awake numeric; hours numeric; tolerance numeric;
  bed_min integer; wake_min integer; target_bed integer; target_wake integer;
  bed_local timestamp; wake_local timestamp; successful boolean;
begin
  if n is null or jsonb_typeof(n)<>'object' or octet_length(n::text)>20000 then
    raise exception 'Invalid sleep night object';
  end if;
  if exists(select 1 from jsonb_object_keys(n) k where k not in
    ('date','bed','wake','bedOffset','wakeOffset','bedClock','wakeClock','sleepMinutes',
     'rested','target','success','rewardRule','source','sessionId','latencyMinutes','awakeMinutes','noiseDbfs','note')) then
    raise exception 'Unsupported sleep night field';
  end if;
  if jsonb_typeof(n->'date') is distinct from 'string' or n->>'date' is distinct from expected_date::text
    or not public.sleep_json_number(n->'bed',0,extract(epoch from now())*1000)
    or not public.sleep_json_number(n->'wake',0,extract(epoch from now())*1000+60000)
    or not public.sleep_json_number(n->'bedOffset',-840,840)
    or not public.sleep_json_number(n->'wakeOffset',-840,840)
    or (n->>'bedOffset')::numeric <> trunc((n->>'bedOffset')::numeric)
    or (n->>'wakeOffset')::numeric <> trunc((n->>'wakeOffset')::numeric)
    or not public.sleep_json_number(n->'rested',1,5)
    or (n->>'rested')::numeric <> trunc((n->>'rested')::numeric) then
    raise exception 'Invalid sleep date, time, offset or mood';
  end if;
  bed_ms=(n->>'bed')::numeric; wake_ms=(n->>'wake')::numeric;
  if n->>'source'='manual' and wake_ms>extract(epoch from now())*1000 then
    raise exception 'Manual sleep cannot end in the future';
  end if;
  total=(wake_ms-bed_ms)/60000;
  if total<=0 or total>1440 or not public.sleep_json_number(n->'sleepMinutes',0,total) then
    raise exception 'Invalid sleep duration';
  end if;
  sleep_min=(n->>'sleepMinutes')::numeric;
  if (n?'latencyMinutes' and not public.sleep_json_number(n->'latencyMinutes',0,total-sleep_min+0.01))
    or (n?'awakeMinutes' and not public.sleep_json_number(n->'awakeMinutes',0,total-sleep_min+0.01)) then
    raise exception 'Invalid sleep pauses';
  end if;
  latency=coalesce((n->>'latencyMinutes')::numeric,0);
  awake=coalesce((n->>'awakeMinutes')::numeric,0);
  if sleep_min+latency+awake>total+0.01
    or (n?'latencyMinutes' and n?'awakeMinutes' and total-sleep_min-latency-awake>1.000001) then
    raise exception 'Inconsistent sleep pauses';
  end if;
  if (n?'note' and (jsonb_typeof(n->'note')<>'string' or char_length(n->>'note')+
      (select count(*) from regexp_split_to_table(n->>'note','') c where ascii(c)>65535)>2000))
    or (n?'noiseDbfs' and not public.sleep_json_number(n->'noiseDbfs',-120,0))
    or (n?'source' and (jsonb_typeof(n->'source')<>'string' or n->>'source' not in ('manual','timer')))
    or (n?'sessionId' and (jsonb_typeof(n->'sessionId')<>'string' or n->>'sessionId' !~ '^[A-Za-z0-9-]{1,80}$'))
    or (n?'rewardRule' and n->'rewardRule'<>'"v1"'::jsonb)
    or (n?'success' and jsonb_typeof(n->'success')<>'boolean') then
    raise exception 'Invalid sleep details or unsupported reward rule';
  end if;
  if jsonb_typeof(n->'target') is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(n->'target') k where k not in ('bed','wake','hours','tolerance'))
    or jsonb_typeof(n#>'{target,bed}') is distinct from 'string'
    or jsonb_typeof(n#>'{target,wake}') is distinct from 'string'
    or (n#>>'{target,bed}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or (n#>>'{target,wake}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or not public.sleep_json_number(n#>'{target,hours}',4,12)
    or not public.sleep_json_number(n#>'{target,tolerance}',30,60)
    or (n#>>'{target,tolerance}')::numeric not in (30,45,60) then
    raise exception 'Invalid sleep target';
  end if;
  hours=(n#>>'{target,hours}')::numeric; tolerance=(n#>>'{target,tolerance}')::numeric;
  target_bed=extract(hour from (n#>>'{target,bed}')::time)*60+extract(minute from (n#>>'{target,bed}')::time);
  target_wake=extract(hour from (n#>>'{target,wake}')::time)*60+extract(minute from (n#>>'{target,wake}')::time);
  if (target_wake-target_bed+1440)%1440 < hours*60 or (target_wake-target_bed+1440)%1440>960 then
    raise exception 'Invalid sleep target window';
  end if;
  bed_local=(to_timestamp((bed_ms/1000)::double precision) at time zone 'UTC')+make_interval(mins=>(n->>'bedOffset')::integer);
  wake_local=(to_timestamp((wake_ms/1000)::double precision) at time zone 'UTC')+make_interval(mins=>(n->>'wakeOffset')::integer);
  if wake_local::date<>expected_date
    or n->'bedClock' is distinct from to_jsonb(to_char(bed_local,'HH24:MI'))
    or n->'wakeClock' is distinct from to_jsonb(to_char(wake_local,'HH24:MI')) then
    raise exception 'Sleep clocks do not match historical offsets';
  end if;
  bed_min=extract(hour from bed_local)*60+extract(minute from bed_local);
  wake_min=extract(hour from wake_local)*60+extract(minute from wake_local);
  successful=least(abs(bed_min-target_bed),1440-abs(bed_min-target_bed))<=tolerance
    and least(abs(wake_min-target_wake),1440-abs(wake_min-target_wake))<=tolerance
    and sleep_min>=hours*60-30;
  -- The server computes the flag, even if the client sends a forged success.
  return n || jsonb_build_object('success',successful,'rewardRule','v1');
end $$;
revoke all on function public.validate_sleep_night(jsonb,date) from public,overman_anonymous,overman_client;

create function public.sleep_diary_snapshot(p_user uuid)
returns jsonb language sql volatile security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object('protocolVersion',1,
    'garden',coalesce((select garden from public.sleep_reward_owners where user_id=p_user),false),
    'credits',coalesce((select jsonb_agg(wake_date order by wake_date) from public.sleep_reward_dates where user_id=p_user and earned),'[]'::jsonb),
    'deletedCredits',coalesce((select jsonb_agg(wake_date order by wake_date) from public.sleep_reward_dates where user_id=p_user and earned and not present),'[]'::jsonb),
    'dates',coalesce((select jsonb_agg(jsonb_build_object('date',r.wake_date,'revision',r.revision,'night',d.night) order by r.wake_date)
      from public.sleep_reward_dates r left join public.sleep_diary_dates d using(user_id,wake_date) where r.user_id=p_user),'[]'::jsonb))
$$;
revoke all on function public.sleep_diary_snapshot(uuid) from public,overman_anonymous,overman_client;

create function public.read_sleep_diary()
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare owner_id uuid=overman.request_owner();
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  return public.sleep_diary_snapshot(owner_id);
end $$;
revoke all on function public.read_sleep_diary() from public,overman_anonymous;
grant execute on function public.read_sleep_diary() to overman_client;

create function public.save_sleep_diary_operation(p_operation uuid,p_date date,p_expected bigint,p_night jsonb,p_expected_owner uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  owner_id uuid=overman.request_owner(); fingerprint bytea; prior bytea; canonical jsonb; old_night jsonb;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  -- An identity guard, never a choice of target account. Prevent an old queue
  -- being delivered under a different session after sign-out/sign-in.
  if p_expected_owner is distinct from owner_id then raise exception 'Synchronization owner changed'; end if;
  if p_operation is null or p_date is null or p_expected is null or p_expected<0 or p_expected>9007199254740990
    or p_date<date '1970-01-01' or p_date>(now() at time zone 'UTC')::date+1
    or (p_night is not null and octet_length(p_night::text)>20000) then
    raise exception 'Invalid diary operation';
  end if;
  fingerprint=sha256(convert_to(jsonb_build_object('date',p_date,'expected',p_expected,'night',p_night)::text,'UTF8'));
  insert into public.sleep_reward_owners(user_id) values(owner_id) on conflict do nothing;
  perform 1 from public.sleep_reward_owners where user_id=owner_id for update;
  select r.fingerprint into prior from public.sleep_diary_receipts r where user_id=owner_id and operation_id=p_operation;
  if found then
    if prior<>fingerprint then raise exception 'Operation identifier reused with different diary content'; end if;
    return public.sleep_diary_snapshot(owner_id);
  end if;
  if exists(select 1 from public.sleep_reward_receipts where user_id=owner_id and operation_id=p_operation) then
    raise exception 'Operation belongs to another reward protocol';
  end if;
  if not exists(select 1 from public.sleep_reward_dates where user_id=owner_id and wake_date=p_date)
    and (select count(*) from public.sleep_reward_dates where user_id=owner_id)>=2000 then
    raise exception 'Sleep archive limit reached';
  end if;
  if p_night is not null then
    canonical=public.validate_sleep_night(p_night,p_date);
    select night into old_night from public.sleep_diary_dates where user_id=owner_id and wake_date=p_date;
    if old_night is not null and old_night->'target'<>canonical->'target' then
      raise exception 'An existing night keeps its original target';
    end if;
  end if;
  perform public.apply_verified_sleep_reward(owner_id,p_operation,p_date,p_expected,
    p_night is not null,coalesce((canonical->>'success')::boolean,false));
  insert into public.sleep_diary_dates values(owner_id,p_date,canonical)
    on conflict(user_id,wake_date) do update set night=excluded.night;
  insert into public.sleep_diary_receipts values(owner_id,p_operation,fingerprint);
  return public.sleep_diary_snapshot(owner_id);
end $$;
revoke all on function public.save_sleep_diary_operation(uuid,date,bigint,jsonb,uuid) from public,overman_anonymous;
grant execute on function public.save_sleep_diary_operation(uuid,date,bigint,jsonb,uuid) to overman_client;
commit;
