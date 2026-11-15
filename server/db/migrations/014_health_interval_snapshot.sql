-- Capture source time bounds without inferring them for old or corrected diary rows.
BEGIN;
alter function public.validate_sleep_night(jsonb,date) rename to validate_sleep_night_v13;
create function public.validate_sleep_night(n jsonb, expected_date date)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare canonical jsonb; h jsonb;
begin
  canonical=public.validate_sleep_night_v13(n-'healthInterval',expected_date);
  if not n?'healthInterval' then return canonical; end if;
  h=n->'healthInterval';
  if n->>'source' is distinct from 'health-connect' or n->>'scoreModel' is distinct from 'diary-v2' or not n?'healthScore'
    or jsonb_typeof(h) is distinct from 'object' then raise exception 'Invalid health interval source'; end if;
  if not h ?& array['version','start','end','bedOffset','wakeOffset']
    or exists(select 1 from jsonb_object_keys(h) k where k not in ('version','start','end','bedOffset','wakeOffset'))
    or h->>'version' is distinct from 'health-connect-interval-v1'
    or not public.sleep_json_number(h->'start',0,8640000000000000)
    or not public.sleep_json_number(h->'end',0,8640000000000000)
    or not public.sleep_json_number(h->'bedOffset',-840,840)
    or not public.sleep_json_number(h->'wakeOffset',-840,840) then raise exception 'Invalid health interval snapshot'; end if;
  if (h->>'start')::numeric<>trunc((h->>'start')::numeric) or (h->>'end')::numeric<>trunc((h->>'end')::numeric)
    or (h->>'bedOffset')::numeric<>trunc((h->>'bedOffset')::numeric) or (h->>'wakeOffset')::numeric<>trunc((h->>'wakeOffset')::numeric)
    or (h->>'end')::numeric<=(h->>'start')::numeric or (h->>'end')::numeric-(h->>'start')::numeric>86400000
    or (h->>'start')::numeric+(h->>'bedOffset')::numeric*60000>253402300799999
    or (h->>'end')::numeric+(h->>'wakeOffset')::numeric*60000>253402300799999
    or abs(((h->>'end')::double precision-(h->>'start')::double precision)/60000-(n#>>'{healthScore,intervalMinutes}')::double precision)>0.000000001 then
    raise exception 'Invalid health interval snapshot';
  end if;
  return canonical||jsonb_build_object('healthInterval',h);
end $$;
create or replace function public.save_sleep_diary_operation_v1(p_operation uuid,p_date date,p_expected bigint,p_night jsonb,p_expected_owner uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  owner_id uuid=overman.request_owner(); fingerprint bytea; prior bytea; canonical jsonb; old_night jsonb;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if p_expected_owner is distinct from owner_id then raise exception 'Synchronization owner changed'; end if;
  if p_operation is null or p_date is null or p_expected is null or p_expected<0 or p_expected>9007199254740990
    or p_date<date '1970-01-01' or p_date>(now() at time zone 'UTC')::date+1
    or (p_night is not null and octet_length(p_night::text)>20000) then raise exception 'Invalid diary operation'; end if;
  fingerprint=sha256(convert_to(jsonb_build_object('date',p_date,'expected',p_expected,'night',p_night)::text,'UTF8'));
  insert into public.sleep_reward_owners(user_id) values(owner_id) on conflict do nothing;
  perform 1 from public.sleep_reward_owners where user_id=owner_id for update;
  select r.fingerprint into prior from public.sleep_diary_receipts r where user_id=owner_id and operation_id=p_operation;
  if found then
    if prior<>fingerprint then raise exception 'Operation identifier reused with different diary content'; end if;
    return public.sleep_diary_snapshot(owner_id);
  end if;
  if exists(select 1 from public.sleep_reward_receipts where user_id=owner_id and operation_id=p_operation) then raise exception 'Operation belongs to another reward protocol'; end if;
  if not exists(select 1 from public.sleep_reward_dates where user_id=owner_id and wake_date=p_date)
    and (select count(*) from public.sleep_reward_dates where user_id=owner_id)>=2000 then raise exception 'Sleep archive limit reached'; end if;
  if p_night is not null then
    canonical=public.validate_sleep_night(p_night,p_date);
    select night into old_night from public.sleep_diary_dates where user_id=owner_id and wake_date=p_date;
    if old_night is not null and (old_night->'source') is distinct from (canonical->'source') then raise exception 'An existing night keeps its source'; end if;
    if old_night is not null and (old_night->'scoreModel') is distinct from (canonical->'scoreModel') then raise exception 'An existing night keeps its score model'; end if;
    if old_night is not null and (old_night->'healthOrigin') is distinct from (canonical->'healthOrigin') then raise exception 'An existing night keeps its original health origin'; end if;
    if old_night is not null and (old_night->'healthScore') is distinct from (canonical->'healthScore') then raise exception 'An existing night keeps its original health score'; end if;
    if old_night is not null and (old_night->'healthInterval') is distinct from (canonical->'healthInterval') then raise exception 'An existing night keeps its original health interval'; end if;
    if old_night is null and canonical?'healthScore' and
      (abs((canonical#>>'{healthScore,sleepMinutes}')::double precision-(canonical->>'sleepMinutes')::double precision)>0.000000001
       or abs((canonical#>>'{healthScore,intervalMinutes}')::double precision-((canonical->>'wake')::double precision-(canonical->>'bed')::double precision)/60000::double precision)>0.000000001) then raise exception 'Initial health score does not match the session'; end if;
    if old_night is null and canonical?'healthInterval' and
      ((canonical#>'{healthInterval,start}') is distinct from canonical->'bed' or (canonical#>'{healthInterval,end}') is distinct from canonical->'wake'
       or (canonical#>'{healthInterval,bedOffset}') is distinct from canonical->'bedOffset' or (canonical#>'{healthInterval,wakeOffset}') is distinct from canonical->'wakeOffset') then raise exception 'Initial health interval does not match the session'; end if;
    if old_night is not null and old_night->'target'<>canonical->'target' then raise exception 'An existing night keeps its original target'; end if;
  end if;
  perform public.apply_verified_sleep_reward(owner_id,p_operation,p_date,p_expected,p_night is not null,coalesce((canonical->>'success')::boolean,false));
  insert into public.sleep_diary_dates values(owner_id,p_date,canonical) on conflict(user_id,wake_date) do update set night=excluded.night;
  insert into public.sleep_diary_receipts values(owner_id,p_operation,fingerprint);
  return public.sleep_diary_snapshot(owner_id);
end $$;
COMMIT;
