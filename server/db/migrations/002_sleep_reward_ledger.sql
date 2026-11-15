-- 05.02 dependency only. Not exposed to mobile clients: a trusted sync handler
-- must authenticate the owner and validate the full night/reward-v1 first.
begin;
create table public.sleep_reward_owners (
  user_id uuid primary key references overman.users(id) on delete cascade,
  garden boolean not null default false
);
create table public.sleep_reward_dates (
  user_id uuid not null references public.sleep_reward_owners(user_id) on delete cascade,
  wake_date date not null,
  revision bigint not null check (revision > 0),
  present boolean not null,
  successful boolean not null,
  earned boolean not null,
  primary key (user_id, wake_date),
  check (present or not successful)
);
create table public.sleep_reward_receipts (
  user_id uuid not null references public.sleep_reward_owners(user_id) on delete cascade,
  operation_id uuid not null,
  wake_date date not null,
  expected_revision bigint not null,
  present boolean not null,
  successful boolean not null,
  primary key (user_id, operation_id)
);
alter table public.sleep_reward_owners enable row level security;
alter table public.sleep_reward_dates enable row level security;
alter table public.sleep_reward_receipts enable row level security;
revoke all on public.sleep_reward_owners, public.sleep_reward_dates,
  public.sleep_reward_receipts from public, overman_anonymous, overman_client;

-- Return the current authoritative ledger even when retrying an old operation.
-- No note, sleep time, token, or private diary payload is stored here.
create function public.apply_verified_sleep_reward(
  p_user uuid, p_operation uuid, p_date date, p_expected bigint,
  p_present boolean, p_successful boolean
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  old_receipt public.sleep_reward_receipts%rowtype;
  current_revision bigint;
  answer jsonb;
begin
  if p_user is null or p_operation is null or p_date is null or p_expected is null
     or p_expected < 0 or p_present is null or p_successful is null
     or (not p_present and p_successful)
     or p_date < date '1970-01-01' or p_date > (now() at time zone 'UTC')::date + 1 then
    raise exception 'Invalid verified reward operation';
  end if;
  insert into public.sleep_reward_owners(user_id) values(p_user) on conflict do nothing;
  perform 1 from public.sleep_reward_owners where user_id=p_user for update;
  select * into old_receipt from public.sleep_reward_receipts
    where user_id=p_user and operation_id=p_operation;
  if found then
    if old_receipt.wake_date <> p_date or old_receipt.expected_revision <> p_expected
       or old_receipt.present <> p_present or old_receipt.successful <> p_successful then
      raise exception 'Operation identifier reused with different content';
    end if;
  else
    select revision into current_revision from public.sleep_reward_dates
      where user_id=p_user and wake_date=p_date;
    if coalesce(current_revision,0) <> p_expected then
      raise exception 'Reward date revision conflict';
    end if;
    insert into public.sleep_reward_dates values
      (p_user,p_date,p_expected+1,p_present,p_successful,p_successful)
    on conflict(user_id,wake_date) do update set
      revision=excluded.revision, present=excluded.present,
      successful=excluded.successful,
      earned=sleep_reward_dates.earned or excluded.earned;
    insert into public.sleep_reward_receipts values
      (p_user,p_operation,p_date,p_expected,p_present,p_successful);
    update public.sleep_reward_owners set garden = garden or exists (
      select 1 from (
        select wake_date - (row_number() over(order by wake_date))::integer as run
        from public.sleep_reward_dates where user_id=p_user and present and successful
      ) runs group by run having count(*) >= 7
    ) where user_id=p_user;
  end if;
  select jsonb_build_object(
    'garden',o.garden,
    'credits',coalesce((select jsonb_agg(wake_date order by wake_date)
      from public.sleep_reward_dates where user_id=p_user and earned),'[]'::jsonb),
    'deletedCredits',coalesce((select jsonb_agg(wake_date order by wake_date)
      from public.sleep_reward_dates where user_id=p_user and earned and not present),'[]'::jsonb),
    'dates',coalesce((select jsonb_agg(jsonb_build_object('date',wake_date,
      'revision',revision,'present',present,'successful',successful) order by wake_date)
      from public.sleep_reward_dates where user_id=p_user),'[]'::jsonb)
  ) into answer from public.sleep_reward_owners o where o.user_id=p_user;
  return answer;
end $$;
revoke all on function public.apply_verified_sleep_reward(uuid,uuid,date,bigint,boolean,boolean)
  from public, overman_anonymous, overman_client;
-- Our own database roles; no hosted authentication or external database service.
do $$ begin
  if exists(select 1 from pg_roles where rolname='overman_service') then
    grant execute on function public.apply_verified_sleep_reward(uuid,uuid,date,bigint,boolean,boolean) to overman_service;
  end if;
end $$;
commit;
