-- 05.02: cancel a pending operation without transmitting its diary payload later.
-- The same owner lock serializes cancellation and save; applied operations are never undone.
begin;
create table public.sleep_diary_cancellations(
  user_id uuid not null references overman.users(id) on delete cascade,
  operation_id uuid not null,fingerprint bytea not null,
  created_at timestamptz not null default now(),primary key(user_id,operation_id)
);
revoke all on public.sleep_diary_cancellations from public,overman_anonymous,overman_client,overman_service;
alter function public.save_sleep_diary_operation(uuid,date,bigint,jsonb,uuid) rename to save_sleep_diary_operation_v1;
revoke all on function public.save_sleep_diary_operation_v1(uuid,date,bigint,jsonb,uuid) from public,overman_anonymous,overman_client,overman_service;

create function public.save_sleep_diary_operation(p_operation uuid,p_date date,p_expected bigint,p_night jsonb,p_expected_owner uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare owner_id uuid=overman.request_owner();fingerprint bytea;prior bytea;
begin
  if owner_id is null then raise exception 'Authentication required';end if;
  if p_expected_owner is distinct from owner_id then raise exception 'Synchronization owner changed';end if;
  if p_operation is null or p_date is null or p_expected is null or p_expected<0 or p_expected>9007199254740990
    or p_date<date '1970-01-01' or p_date>(now() at time zone 'UTC')::date+1
    or (p_night is not null and octet_length(p_night::text)>20000) then raise exception 'Invalid diary operation';end if;
  fingerprint=sha256(convert_to(jsonb_build_object('date',p_date,'expected',p_expected,'night',p_night)::text,'UTF8'));
  insert into public.sleep_reward_owners(user_id) values(owner_id) on conflict do nothing;
  perform 1 from public.sleep_reward_owners where user_id=owner_id for update;
  select c.fingerprint into prior from public.sleep_diary_cancellations c where user_id=owner_id and operation_id=p_operation;
  if found then
    if prior<>fingerprint then raise exception 'Operation identifier reused with different diary content';end if;
    raise exception 'Operation was cancelled';
  end if;
  return public.save_sleep_diary_operation_v1(p_operation,p_date,p_expected,p_night,p_expected_owner);
end $$;
revoke all on function public.save_sleep_diary_operation(uuid,date,bigint,jsonb,uuid) from public,overman_anonymous;
grant execute on function public.save_sleep_diary_operation(uuid,date,bigint,jsonb,uuid) to overman_client;

create function public.cancel_sleep_diary_operation(p_operation uuid,p_date date,p_expected bigint,p_night jsonb,p_expected_owner uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare owner_id uuid=overman.request_owner();fingerprint bytea;prior bytea;cancelled boolean;
begin
  if owner_id is null then raise exception 'Authentication required';end if;
  if p_expected_owner is distinct from owner_id then raise exception 'Synchronization owner changed';end if;
  if p_operation is null or p_date is null or p_expected is null or p_expected<0 or p_expected>9007199254740990
    or p_date<date '1970-01-01' or p_date>(now() at time zone 'UTC')::date+1
    or (p_night is not null and octet_length(p_night::text)>20000) then raise exception 'Invalid diary operation';end if;
  fingerprint=sha256(convert_to(jsonb_build_object('date',p_date,'expected',p_expected,'night',p_night)::text,'UTF8'));
  insert into public.sleep_reward_owners(user_id) values(owner_id) on conflict do nothing;
  perform 1 from public.sleep_reward_owners where user_id=owner_id for update;
  select r.fingerprint into prior from public.sleep_diary_receipts r where user_id=owner_id and operation_id=p_operation;
  if found then
    if prior<>fingerprint then raise exception 'Operation identifier reused with different diary content';end if;
    cancelled=false;
  else
    if exists(select 1 from public.sleep_reward_receipts where user_id=owner_id and operation_id=p_operation) then
      raise exception 'Operation belongs to another reward protocol';end if;
    select c.fingerprint into prior from public.sleep_diary_cancellations c where user_id=owner_id and operation_id=p_operation;
    if found then
      if prior<>fingerprint then raise exception 'Operation identifier reused with different diary content';end if;
    else
      insert into public.sleep_diary_cancellations(user_id,operation_id,fingerprint) values(owner_id,p_operation,fingerprint);
    end if;
    cancelled=true;
  end if;
  return jsonb_build_object('protocolVersion',1,'ownerId',owner_id,'operationId',p_operation,'cancelled',cancelled,'snapshot',public.sleep_diary_snapshot(owner_id));
end $$;
revoke all on function public.cancel_sleep_diary_operation(uuid,date,bigint,jsonb,uuid) from public,overman_anonymous;
grant execute on function public.cancel_sleep_diary_operation(uuid,date,bigint,jsonb,uuid) to overman_client;
commit;