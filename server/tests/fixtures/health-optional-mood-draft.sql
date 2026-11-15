-- TEST FIXTURE ONLY: not an installed migration.
-- Preserve the score formula per night; legacy records remain diary-v1.
BEGIN;
create or replace function public.validate_sleep_night(n jsonb, expected_date date)
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
     'rested','target','success','scoreModel','rewardRule','source','sessionId','latencyMinutes','awakeMinutes','noiseDbfs','note')) then
    raise exception 'Unsupported sleep night field';
  end if;
  if jsonb_typeof(n->'date') is distinct from 'string' or n->>'date' is distinct from expected_date::text
    or not public.sleep_json_number(n->'bed',0,extract(epoch from now())*1000)
    or not public.sleep_json_number(n->'wake',0,extract(epoch from now())*1000+60000)
    or not public.sleep_json_number(n->'bedOffset',-840,840)
    or not public.sleep_json_number(n->'wakeOffset',-840,840)
    or (n->>'bedOffset')::numeric <> trunc((n->>'bedOffset')::numeric)
    or (n->>'wakeOffset')::numeric <> trunc((n->>'wakeOffset')::numeric)
    or (n?'rested' and (not public.sleep_json_number(n->'rested',1,5)
      or (n->>'rested')::numeric <> trunc((n->>'rested')::numeric)))
    or (not n?'rested' and (n->>'source' is distinct from 'health-connect' or n->>'scoreModel' is distinct from 'diary-v2')) then
    raise exception 'Invalid sleep date, time, offset or mood';
  end if;
  bed_ms=(n->>'bed')::numeric; wake_ms=(n->>'wake')::numeric;
  if n->>'source' in ('manual','health-connect') and wake_ms>extract(epoch from now())*1000 then
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
    or (n?'source' and (jsonb_typeof(n->'source')<>'string' or n->>'source' not in ('manual','timer','health-connect')))
    or (n?'sessionId' and (jsonb_typeof(n->'sessionId')<>'string' or n->>'sessionId' !~ '^[A-Za-z0-9-]{1,80}$'))
    or (n?'scoreModel' and n->'scoreModel'<>'"diary-v2"'::jsonb)
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
COMMIT;
