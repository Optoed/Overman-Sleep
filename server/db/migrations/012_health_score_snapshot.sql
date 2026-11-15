-- Preserve a separate, versioned Health Connect index. Existing diary scores stay unchanged.
BEGIN;
alter function public.validate_sleep_night(jsonb,date) rename to validate_sleep_night_v11;
create function public.validate_sleep_night(n jsonb, expected_date date)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare canonical jsonb; h jsonb; reference_min double precision; duration_part double precision; efficiency_part double precision;
begin
  -- The previous validator still owns every diary/reward rule and its rounding tolerance.
  canonical=public.validate_sleep_night_v11(n-'healthScore',expected_date);
  if not n?'healthScore' then return canonical; end if;
  h=n->'healthScore';
  if n->>'source' is distinct from 'health-connect' or n->>'scoreModel' is distinct from 'diary-v2'
    or jsonb_typeof(h) is distinct from 'object' then raise exception 'Invalid health score source'; end if;
  if h->>'version' not in ('health-preview-v1','health-preview-v2') or h->>'version' is null
    or exists(select 1 from jsonb_object_keys(h) k where k not in ('version','score','sleepMinutes','intervalMinutes','goalMinutes','referenceMinutes'))
    or not public.sleep_json_number(h->'score',0,100)
    or not public.sleep_json_number(h->'sleepMinutes',0,1440)
    or not public.sleep_json_number(h->'intervalMinutes',0.000000001,1440)
    or not public.sleep_json_number(h->'goalMinutes',0.000000001,1440)
    or (h->>'sleepMinutes')::double precision>(h->>'intervalMinutes')::double precision
    or abs((h->>'goalMinutes')::double precision-(n#>>'{target,hours}')::double precision*60)>0.000000001 then
    raise exception 'Invalid health score snapshot';
  end if;
  reference_min=(h->>'goalMinutes')::double precision;
  if h->>'version'='health-preview-v2' then
    reference_min=greatest(reference_min,420);
    if not public.sleep_json_number(h->'referenceMinutes',420,1440) or (h->>'referenceMinutes')::double precision<>reference_min then raise exception 'Invalid health score reference'; end if;
  elsif h?'referenceMinutes' then raise exception 'Unsupported health score field'; end if;
  duration_part=least(1,(h->>'sleepMinutes')::double precision/reference_min);
  efficiency_part=least(1,(h->>'sleepMinutes')::double precision/(h->>'intervalMinutes')::double precision/0.85::double precision);
  if (h->>'score')::numeric<>floor(0.5 + 70*duration_part + 30*duration_part*efficiency_part) then raise exception 'Inconsistent health score snapshot'; end if;
  return canonical||jsonb_build_object('healthScore',h);
end $$;
create or replace function public.save_sleep_diary_operation_v1(p_operation uuid,p_date date,p_expected bigint,p_night jsonb,p_expected_owner uuid)
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
    if old_night is not null and (old_night->'source') is distinct from (canonical->'source') then
      raise exception 'An existing night keeps its source';
    end if;
    if old_night is not null and (old_night->'scoreModel') is distinct from (canonical->'scoreModel') then
      raise exception 'An existing night keeps its score model';
    end if;
    if old_night is not null and (old_night->'healthScore') is distinct from (canonical->'healthScore') then
      raise exception 'An existing night keeps its original health score';
    end if;
    if old_night is null and canonical?'healthScore' and
      (abs((canonical#>>'{healthScore,sleepMinutes}')::double precision-(canonical->>'sleepMinutes')::double precision)>0.000000001
       or abs((canonical#>>'{healthScore,intervalMinutes}')::double precision-((canonical->>'wake')::double precision-(canonical->>'bed')::double precision)/60000::double precision)>0.000000001) then
      raise exception 'Initial health score does not match the session';
    end if;
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
COMMIT;
