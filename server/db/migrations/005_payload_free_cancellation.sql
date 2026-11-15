-- A cancellation transmits only the opaque operation UUID, never a sleep note/payload.
begin;
alter table public.sleep_diary_cancellations alter column fingerprint drop not null;
create function public.cancel_sleep_diary_operation(p_operation uuid,p_expected_owner uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare owner_id uuid=overman.request_owner();cancelled boolean;
begin
  if owner_id is null then raise exception 'Authentication required';end if;
  if p_expected_owner is distinct from owner_id then raise exception 'Synchronization owner changed';end if;
  if p_operation is null then raise exception 'Invalid diary operation';end if;
  insert into public.sleep_reward_owners(user_id) values(owner_id) on conflict do nothing;
  perform 1 from public.sleep_reward_owners where user_id=owner_id for update;
  if exists(select 1 from public.sleep_diary_receipts where user_id=owner_id and operation_id=p_operation) then
    cancelled=false;
  else
    if exists(select 1 from public.sleep_reward_receipts where user_id=owner_id and operation_id=p_operation) then
      raise exception 'Operation belongs to another reward protocol';end if;
    insert into public.sleep_diary_cancellations(user_id,operation_id,fingerprint) values(owner_id,p_operation,null) on conflict do nothing;
    cancelled=true;
  end if;
  return jsonb_build_object('protocolVersion',1,'ownerId',owner_id,'operationId',p_operation,'cancelled',cancelled,'snapshot',public.sleep_diary_snapshot(owner_id));
end $$;
revoke all on function public.cancel_sleep_diary_operation(uuid,uuid) from public,overman_anonymous;
grant execute on function public.cancel_sleep_diary_operation(uuid,uuid) to overman_client;
-- Existing applied migrations remain immutable; retire the payload-taking prototype.
revoke all on function public.cancel_sleep_diary_operation(uuid,date,bigint,jsonb,uuid) from public,overman_anonymous,overman_client,overman_service;
commit;