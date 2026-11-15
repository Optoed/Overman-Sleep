-- Preserve applied015; partial consent updates must not restore another revoked flag.
begin;
create or replace function public.overman_friends(p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,overman,public as $$
declare me uuid=overman.request_owner();peer uuid;fid uuid;f overman.friendships%rowtype;answer jsonb;
begin
 if me is null then raise exception 'Authentication required';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid social operation';end if;
 insert into overman.social_profiles(user_id) values(me) on conflict do nothing;
 if p_action='profile' then
  if p_payload-'name'<>'{}'::jsonb or jsonb_typeof(p_payload->'name') is distinct from 'string'
   or char_length(btrim(p_payload->>'name')) not between 1 and 64 or (p_payload->>'name')~'[[:cntrl:]]' then raise exception 'Invalid profile name';end if;
  update overman.social_profiles set display_name=btrim(p_payload->>'name') where user_id=me;
 elsif p_action='request' then
  if p_payload-'code'<>'{}'::jsonb or jsonb_typeof(p_payload->'code') is distinct from 'string' then raise exception 'Invalid friend code';end if;
  select user_id into peer from overman.social_profiles where friend_code=(p_payload->>'code')::uuid;
  if peer is null or peer=me then raise exception 'Friend code not available';end if;
  perform pg_advisory_xact_lock(hashtextextended(least(me,peer)::text,15));
  perform pg_advisory_xact_lock(hashtextextended(greatest(me,peer)::text,15));
  if (select count(*) from overman.friendships where requester=me or recipient=me)>=100 then raise exception 'Friend limit reached';end if;
  if (select count(*) from overman.friendships where recipient=peer and status='pending')>=100 then raise exception 'Friend requests unavailable';end if;
  insert into overman.friendships(requester,recipient) values(me,peer) on conflict do nothing;
 elsif p_action in ('accept','remove','share') then
  if p_payload-(case when p_action='share' then array['id','sleep','progress'] else array['id'] end)<>'{}'::jsonb
   or jsonb_typeof(p_payload->'id') is distinct from 'string' then raise exception 'Invalid friendship';end if;
  fid=(p_payload->>'id')::uuid;
  select * into f from overman.friendships where id=fid and me in (requester,recipient) for update;
  if not found then raise exception 'Friendship unavailable';end if;
  if p_action='accept' then
   if f.recipient<>me then raise exception 'Only recipient may accept';end if;
   update overman.friendships set status='accepted' where id=fid;
  elsif p_action='remove' then
   delete from overman.friendships where id=fid;
  else
   if f.status<>'accepted' or not(p_payload?'sleep' or p_payload?'progress') or (p_payload?'sleep' and jsonb_typeof(p_payload->'sleep') is distinct from 'boolean') or (p_payload?'progress' and jsonb_typeof(p_payload->'progress') is distinct from 'boolean') then raise exception 'Invalid sharing consent';end if;
   insert into overman.friend_permissions values(fid,me,coalesce((p_payload->>'sleep')::boolean,false),coalesce((p_payload->>'progress')::boolean,false))
    on conflict(friendship_id,owner_id) do update set share_sleep=case when p_payload?'sleep' then excluded.share_sleep else overman.friend_permissions.share_sleep end,share_progress=case when p_payload?'progress' then excluded.share_progress else overman.friend_permissions.share_progress end;
  end if;
 elsif p_action<>'list' or p_payload<>'{}'::jsonb then raise exception 'Invalid social operation';
 end if;
 select jsonb_build_object('ownerId',me,'profile',(select jsonb_build_object('name',display_name,'code',friend_code) from overman.social_profiles where user_id=me),
 'friends',coalesce((select jsonb_agg(jsonb_build_object(
  'id',r.id,'direction',case when r.recipient=me then 'incoming' else 'outgoing' end,'status',r.status,
  'name',p.display_name,'sharing',jsonb_build_object('sleep',coalesce(mine.share_sleep,false),'progress',coalesce(mine.share_progress,false)),
  'sleep',case when r.status='accepted' and theirs.share_sleep then (select jsonb_build_object('date',d.wake_date,'bed',d.night->'bed','wake',d.night->'wake','bedClock',d.night->'bedClock','wakeClock',d.night->'wakeClock','bedOffset',d.night->'bedOffset','wakeOffset',d.night->'wakeOffset') from public.sleep_diary_dates d where d.user_id=p.user_id and d.night is not null order by d.wake_date desc limit 1) else null end,
  'progress',case when r.status='accepted' and theirs.share_progress then jsonb_build_object('successfulNights',(select count(*) from public.sleep_reward_dates where user_id=p.user_id and earned),'floors',(select least(100,count(*)/7) from public.sleep_reward_dates where user_id=p.user_id and earned),'garden',coalesce((select garden from public.sleep_reward_owners where user_id=p.user_id),false)) else null end
 ) order by r.created_at desc) from overman.friendships r join overman.social_profiles p on p.user_id=case when r.requester=me then r.recipient else r.requester end
 left join overman.friend_permissions mine on mine.friendship_id=r.id and mine.owner_id=me
 left join overman.friend_permissions theirs on theirs.friendship_id=r.id and theirs.owner_id=p.user_id
 where me in (r.requester,r.recipient)),'[]'::jsonb)) into answer;
 return answer;
end$$;
commit;
