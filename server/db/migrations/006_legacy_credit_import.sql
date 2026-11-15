-- 05.02: preserve self-declared pre-sync earned dates without fabricating nights.
-- These imports are labelled separately from server-validated successful nights.
begin;
create table public.sleep_legacy_credit_dates(
 user_id uuid not null,wake_date date not null,created_at timestamptz not null default now(),primary key(user_id,wake_date),
 foreign key(user_id,wake_date) references public.sleep_reward_dates(user_id,wake_date) on delete cascade
);
create table public.sleep_legacy_gardens(user_id uuid primary key references public.sleep_reward_owners(user_id) on delete cascade,created_at timestamptz not null default now());
create table public.sleep_legacy_credit_receipts(user_id uuid not null references public.sleep_reward_owners(user_id) on delete cascade,operation_id uuid not null,fingerprint bytea not null,created_at timestamptz not null default now(),primary key(user_id,operation_id));
revoke all on public.sleep_legacy_credit_dates,public.sleep_legacy_gardens,public.sleep_legacy_credit_receipts from public,overman_anonymous,overman_client,overman_service;
alter table public.sleep_legacy_credit_dates enable row level security;
alter table public.sleep_legacy_gardens enable row level security;
alter table public.sleep_legacy_credit_receipts enable row level security;

-- Existing save/cancel/reward functions take the same owner lock. Reject using a
-- legacy-import UUID in another protocol, rolling back its entire transaction.
create function public.guard_sleep_legacy_operation_uuid() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if exists(select 1 from public.sleep_legacy_credit_receipts where user_id=new.user_id and operation_id=new.operation_id) then raise exception 'Operation belongs to another reward protocol';end if;
 return new;
end $$;
revoke all on function public.guard_sleep_legacy_operation_uuid() from public,overman_anonymous,overman_client,overman_service;
create trigger guard_legacy_diary_uuid before insert on public.sleep_diary_receipts for each row execute function public.guard_sleep_legacy_operation_uuid();
create trigger guard_legacy_reward_uuid before insert on public.sleep_reward_receipts for each row execute function public.guard_sleep_legacy_operation_uuid();
create trigger guard_legacy_cancel_uuid before insert on public.sleep_diary_cancellations for each row execute function public.guard_sleep_legacy_operation_uuid();

create or replace function public.sleep_diary_snapshot(p_user uuid)
returns jsonb language sql volatile security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('protocolVersion',1,
  'garden',coalesce((select garden from public.sleep_reward_owners where user_id=p_user),false),
  'credits',coalesce((select jsonb_agg(wake_date order by wake_date) from public.sleep_reward_dates where user_id=p_user and earned),'[]'::jsonb),
  'deletedCredits',coalesce((select jsonb_agg(wake_date order by wake_date) from public.sleep_reward_dates where user_id=p_user and earned and not present),'[]'::jsonb),
  'dates',coalesce((select jsonb_agg(jsonb_build_object('date',r.wake_date,'revision',r.revision,'night',d.night) order by r.wake_date)
   from public.sleep_reward_dates r left join public.sleep_diary_dates d using(user_id,wake_date) where r.user_id=p_user),'[]'::jsonb))
 ||case when exists(select 1 from public.sleep_legacy_credit_dates where user_id=p_user) or exists(select 1 from public.sleep_legacy_gardens where user_id=p_user)
  then jsonb_build_object('legacyCredits',coalesce((select jsonb_agg(wake_date order by wake_date) from public.sleep_legacy_credit_dates where user_id=p_user),'[]'::jsonb),
    'legacyGarden',exists(select 1 from public.sleep_legacy_gardens where user_id=p_user)) else '{}'::jsonb end
$$;

create function public.import_legacy_sleep_credits(p_operation uuid,p_dates jsonb,p_garden boolean,p_expected_owner uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare owner_id uuid=overman.request_owner();canonical jsonb;fingerprint bytea;prior bytea;day date;was_earned boolean;
begin
 if owner_id is null then raise exception 'Authentication required';end if;
 if p_expected_owner is distinct from owner_id then raise exception 'Synchronization owner changed';end if;
 if p_operation is null or p_garden is null or p_dates is null or jsonb_typeof(p_dates)<>'array' then raise exception 'Invalid legacy credit import';end if;
 if jsonb_array_length(p_dates)>2000 or (jsonb_array_length(p_dates)=0 and not p_garden)
  or exists(select 1 from jsonb_array_elements(p_dates) v where jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then raise exception 'Invalid legacy credit dates';end if;
 if (select count(distinct v) from jsonb_array_elements(p_dates) v)<>jsonb_array_length(p_dates) then raise exception 'Duplicate legacy credit dates';end if;
 for day in select (v#>>'{}')::date from jsonb_array_elements(p_dates) v loop
  if day<date '1970-01-01' or day>(now() at time zone 'UTC')::date+1 then raise exception 'Invalid legacy credit date';end if;
 end loop;
 select coalesce(jsonb_agg(v order by v),'[]'::jsonb) into canonical from jsonb_array_elements(p_dates) v;
 fingerprint=sha256(convert_to(jsonb_build_object('dates',canonical,'garden',p_garden)::text,'UTF8'));
 insert into public.sleep_reward_owners(user_id) values(owner_id) on conflict do nothing;
 perform 1 from public.sleep_reward_owners where user_id=owner_id for update;
 select r.fingerprint into prior from public.sleep_legacy_credit_receipts r where user_id=owner_id and operation_id=p_operation;
 if found then
  if prior<>fingerprint then raise exception 'Operation identifier reused with different legacy credits';end if;
 else
  if exists(select 1 from public.sleep_diary_receipts where user_id=owner_id and operation_id=p_operation)
   or exists(select 1 from public.sleep_reward_receipts where user_id=owner_id and operation_id=p_operation)
   or exists(select 1 from public.sleep_diary_cancellations where user_id=owner_id and operation_id=p_operation) then raise exception 'Operation belongs to another reward protocol';end if;
  if (select count(*) from (select wake_date from public.sleep_reward_dates where user_id=owner_id union select (v#>>'{}')::date from jsonb_array_elements(canonical) v) days)>2000 then raise exception 'Sleep archive limit reached';end if;
  for day in select (v#>>'{}')::date from jsonb_array_elements(canonical) v loop
   select earned into was_earned from public.sleep_reward_dates where user_id=owner_id and wake_date=day;
   if not coalesce(was_earned,false) then
    -- A missing date is a tombstone, never an invented successful night. Existing
    -- unsuccessful/corrected nights keep their payload and advance the revision.
    if exists(select 1 from public.sleep_reward_dates where user_id=owner_id and wake_date=day and revision>=9007199254740990) then raise exception 'Reward date revision exhausted';end if;
    insert into public.sleep_reward_dates values(owner_id,day,1,false,false,true)
     on conflict(user_id,wake_date) do update set earned=true,revision=sleep_reward_dates.revision+1;
    insert into public.sleep_legacy_credit_dates(user_id,wake_date) values(owner_id,day) on conflict do nothing;
   end if;
  end loop;
  if p_garden and not(select garden from public.sleep_reward_owners where user_id=owner_id) then
   update public.sleep_reward_owners set garden=true where user_id=owner_id;
   insert into public.sleep_legacy_gardens(user_id) values(owner_id) on conflict do nothing;
  end if;
  insert into public.sleep_legacy_credit_receipts(user_id,operation_id,fingerprint) values(owner_id,p_operation,fingerprint);
 end if;
 return jsonb_build_object('protocolVersion',1,'ownerId',owner_id,'operationId',p_operation,'snapshot',public.sleep_diary_snapshot(owner_id));
end $$;
revoke all on function public.import_legacy_sleep_credits(uuid,jsonb,boolean,uuid) from public,overman_anonymous,overman_service;
grant execute on function public.import_legacy_sleep_credits(uuid,jsonb,boolean,uuid) to overman_client;
commit;