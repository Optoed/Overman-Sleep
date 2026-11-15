begin;
create table overman.sleep_circles(id uuid primary key default gen_random_uuid(),host uuid not null references overman.users(id),zone text not null,fingerprint text not null,unique(host,fingerprint));
create table overman.sleep_circle_members(circle_id uuid not null references overman.sleep_circles(id) on delete cascade,user_id uuid not null references overman.users(id),primary key(circle_id,user_id));
create table overman.sleep_outings(id uuid primary key default gen_random_uuid(),circle_id uuid not null references overman.sleep_circles(id) on delete cascade,wake_date date not null,created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '30 minutes',unique(circle_id,wake_date));
create table overman.sleep_outing_replies(outing_id uuid not null references overman.sleep_outings(id) on delete cascade,user_id uuid not null references overman.users(id),status text not null check(status in ('invited','joined','declined')),primary key(outing_id,user_id));
alter table overman.sleep_circles enable row level security;
alter table overman.sleep_circle_members enable row level security;
alter table overman.sleep_outings enable row level security;
alter table overman.sleep_outing_replies enable row level security;
revoke all on overman.sleep_circles,overman.sleep_circle_members,overman.sleep_outings,overman.sleep_outing_replies from public,overman_anonymous,overman_client,overman_service,overman_authenticator;
create function public.overman_social(p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,overman,public as $$
declare me uuid=overman.request_owner();answer jsonb;fid uuid;cid uuid;oid uuid;peer uuid;ids uuid[];members uuid[];wake date;zone text;today date;item record;dayrow record;run int;previous_date date;circles jsonb='[]';verified_dates date[];
begin
 if me is null then raise exception 'Authentication required';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid social operation';end if;
 if p_action in ('invite-sleep','join-sleep','decline-sleep') then
  perform pg_advisory_xact_lock(hashtextextended(me::text,17));
  if p_action='invite-sleep' then
   if p_payload-array['friends','wakeDate','zone']<>'{}'::jsonb or jsonb_typeof(p_payload->'friends') is distinct from 'array' or jsonb_array_length(p_payload->'friends') not between 1 and 19 or jsonb_typeof(p_payload->'wakeDate') is distinct from 'string' or jsonb_typeof(p_payload->'zone') is distinct from 'string' then raise exception 'Invalid invitation';end if;
   zone=p_payload->>'zone';if not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'Invalid time zone';end if;
   today=(now() at time zone zone)::date;wake=(p_payload->>'wakeDate')::date;if wake<today or wake>today+2 then raise exception 'Choose the upcoming wake date';end if;
   select array_agg(value::uuid) into ids from jsonb_array_elements_text(p_payload->'friends');
   if (select count(distinct x) from unnest(ids) x)<>cardinality(ids) then raise exception 'Duplicate friends';end if;
   members=array[me];
   foreach fid in array ids loop
    select case when requester=me then recipient else requester end into peer from overman.friendships where id=fid and status='accepted' and me in(requester,recipient) for share;
    if peer is null then raise exception 'Accepted friendship required';end if;members=array_append(members,peer);
   end loop;
   select array_agg(x order by x) into members from unnest(members) x;
   if (select count(*) from overman.sleep_outings o join overman.sleep_circles c on c.id=o.circle_id where c.host=me and o.created_at>now()-interval '24 hours')>=10 then raise exception 'Daily invitation limit';end if;
   insert into overman.sleep_circles(host,zone,fingerprint) values(me,zone,md5(array_to_string(members,',')||zone)) on conflict(host,fingerprint) do update set host=excluded.host returning id into cid;
   insert into overman.sleep_circle_members select cid,x from unnest(members) x on conflict do nothing;
   insert into overman.sleep_outings(circle_id,wake_date) values(cid,wake) on conflict(circle_id,wake_date) do nothing returning id into oid;
   if oid is not null then insert into overman.sleep_outing_replies select oid,x,case when x=me then 'joined' else 'invited' end from unnest(members) x;end if;
  else
   if p_payload-'id'<>'{}'::jsonb or jsonb_typeof(p_payload->'id') is distinct from 'string' then raise exception 'Invalid invitation';end if;oid=(p_payload->>'id')::uuid;
   select o.circle_id,c.host into cid,peer from overman.sleep_outings o join overman.sleep_circles c on c.id=o.circle_id join overman.sleep_outing_replies r on r.outing_id=o.id and r.user_id=me where o.id=oid and o.expires_at>now() for update of o;
   if not found or peer=me or not exists(select 1 from overman.friendships where status='accepted' and ((requester=me and recipient=peer) or (requester=peer and recipient=me))) then raise exception 'Invitation unavailable';end if;
   update overman.sleep_outing_replies set status=case when p_action='join-sleep' then 'joined' else 'declined' end where outing_id=oid and user_id=me;
  end if;
  answer=public.overman_friends('list','{}');
 else answer=public.overman_friends(p_action,p_payload);end if;
 for item in
  select c.id,c.host,c.zone,p.display_name,o.id outing_id,o.wake_date,o.expires_at,r.status from overman.sleep_circles c join overman.social_profiles p on p.user_id=c.host
  join lateral(select * from overman.sleep_outings where circle_id=c.id order by wake_date desc limit 1)o on true
  join overman.sleep_outing_replies r on r.outing_id=o.id and r.user_id=me
  where (c.host=me or exists(select 1 from overman.friendships where status='accepted' and ((requester=me and recipient=c.host) or(requester=c.host and recipient=me))))
  and not exists(select 1 from overman.sleep_circle_members m where m.circle_id=c.id and m.user_id<>c.host and not exists(select 1 from overman.friendships f where f.status='accepted' and ((f.requester=c.host and f.recipient=m.user_id)or(f.recipient=c.host and f.requester=m.user_id))))
  order by o.created_at desc limit 40
 loop
  verified_dates=array[]::date[];run=0;previous_date=null;today=(now() at time zone item.zone)::date;
  for dayrow in select o.wake_date from overman.sleep_outings o where o.circle_id=item.id and o.wake_date<=today
   and not exists(select 1 from overman.sleep_outing_replies r left join public.sleep_diary_dates d on d.user_id=r.user_id and d.wake_date=o.wake_date where r.outing_id=o.id and (r.status<>'joined' or coalesce((d.night->>'success')::boolean,false)=false)) order by o.wake_date desc
  loop
   verified_dates=array_append(verified_dates,dayrow.wake_date);
   if previous_date is null then if dayrow.wake_date<today-1 then exit;end if;
   elsif previous_date-dayrow.wake_date<>1 then exit;end if;
   run=run+1;previous_date=dayrow.wake_date;
  end loop;
  circles=circles||jsonb_build_array(jsonb_build_object('id',item.id,'invitationId',item.outing_id,'host',item.display_name,'isHost',item.host=me,'wakeDate',item.wake_date,'expiresAt',extract(epoch from item.expires_at)*1000,'reply',item.status,'joined',(select count(*) from overman.sleep_outing_replies where outing_id=item.outing_id and status='joined'),'members',(select count(*) from overman.sleep_outing_replies where outing_id=item.outing_id),'streak',run));
 end loop;
 return answer||jsonb_build_object('circles',circles);
end$$;
revoke all on function public.overman_social(text,jsonb) from public,overman_anonymous,overman_service,overman_authenticator;
grant execute on function public.overman_social(text,jsonb) to overman_client;
commit;
