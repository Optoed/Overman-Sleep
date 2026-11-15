BEGIN;
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
