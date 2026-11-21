\set ON_ERROR_STOP on

do $$ begin
  if current_database() <> 'royal_birthday_test' or to_regclass('public.users') is not null then
    raise exception 'Run this fixture only on an empty disposable royal_birthday_test database';
  end if;
end $$;

create role anon;
create role authenticated;
create role service_role;

create table public.users (
  id uuid primary key,
  uid text unique not null,
  balance integer not null default 0
);
insert into public.users(id, uid) values ('00000000-0000-0000-0000-000000000001', 'TEST_UID');

create table public.line_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text unique not null,
  recipient_uid text not null,
  message_kind text not null,
  payload jsonb not null,
  status text not null default 'pending'
);

-- This fixture always awards points when called so the wrapper has to prevent repeats.
create function public.process_birthday_rewards(p_amount integer, p_year integer)
returns table (uid text, name text)
language sql as $$
  update public.users u set balance = balance + p_amount
  returning u.uid, 'สมาชิกทดสอบ'::text;
$$;

\ir ../supabase_birthday_rewards_migration.sql

do $$
declare
  message jsonb := '{"contents":{"body":{"contents":[{}, {"text":"สมาชิก"}]}}}';
  first_run jsonb;
  retry_run jsonb;
  today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if has_function_privilege('anon', 'public.process_birthday_rewards(integer,integer)', 'execute') or
     has_function_privilege('authenticated', 'public.process_birthday_rewards_once(integer,jsonb)', 'execute') or
     not has_function_privilege('service_role', 'public.process_birthday_rewards(integer,integer)', 'execute') or
     not has_function_privilege('service_role', 'public.process_birthday_rewards_once(integer,jsonb)', 'execute') then
    raise exception 'unexpected birthday function access';
  end if;

  first_run := public.process_birthday_rewards_once(100, message);
  retry_run := public.process_birthday_rewards_once(100, message);
  if (first_run->>'reward_count')::integer <> 1 or (first_run->>'repeated')::boolean or
     not (retry_run->>'repeated')::boolean or first_run->'notifications' <> retry_run->'notifications' or
     (select balance from public.users) <> 100 then
    raise exception 'same-day retry changed the award or notification';
  end if;
  if (select payload #>> '{contents,body,contents,1,text}' from public.line_notification_outbox)
     is distinct from 'สุขสันต์วันเกิดคุณ สมาชิกทดสอบ' then
    raise exception 'incorrect personalized LINE payload';
  end if;

  update public.line_notification_outbox set status = 'sent';
  retry_run := public.process_birthday_rewards_once(100, message);
  if jsonb_array_length(retry_run->'notifications') <> 0 then
    raise exception 'delivered notifications should not be returned for retry';
  end if;

  -- Move the committed award to another run day while preserving its award year.
  insert into public.birthday_reward_runs(run_date, reward_count) values (today - 1, 1);
  update public.birthday_reward_awards set run_date = today - 1;
  update public.line_notification_outbox set dedupe_key = 'previous-key';
  delete from public.birthday_reward_runs where run_date = today;
  begin
    perform public.process_birthday_rewards_once(100, message);
    raise exception 'expected duplicate annual award to be rejected';
  exception when unique_violation then
    null;
  end;
  if (select balance from public.users) <> 100 or
     (select count(*) from public.line_notification_outbox) <> 1 or
     exists (select 1 from public.birthday_reward_runs where run_date = today) then
    raise exception 'unsuccessful second run left partial writes';
  end if;
end $$;
