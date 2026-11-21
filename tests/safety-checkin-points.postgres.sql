\set ON_ERROR_STOP on

do $$ begin
  if current_database() <> 'royal_safety_test' or to_regclass('public.users') is not null then
    raise exception 'Run this fixture only on an empty disposable royal_safety_test database';
  end if;
end $$;

create role anon;
create role authenticated;
create role service_role;
create schema auth;
create function auth.role() returns text language sql as $$ select current_user::text $$;

create table public.users(id uuid primary key, uid text unique not null, balance integer not null default 0);
create table public.point_transactions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
  code text not null, type text not null, amount integer not null, created_by text not null
);

create function public.apply_points(p_user uuid, p_amount integer, p_code text, p_type text, p_actor text)
returns void language plpgsql as $$
begin
  if current_setting('fixture.fail_type', true) = p_type then raise check_violation; end if;
  update public.users set balance = balance + p_amount where id = p_user;
  insert into public.point_transactions(user_id, code, type, amount, created_by)
  values (p_user, p_code, p_type, p_amount, p_actor);
end $$;

\ir ../supabase_audit_logs_migration.sql
\ir ../supabase_daily_checkins_migration.sql
\ir ../supabase_safety_checkin_points_migration.sql

insert into public.users(id, uid) values ('00000000-0000-0000-0000-000000000001', 'TEST_MEMBER');

do $$
declare
  member_id uuid := '00000000-0000-0000-0000-000000000001';
  today date := (now() at time zone 'Asia/Bangkok')::date;
  monday date := date_trunc('week', today)::date - 7;
  payload jsonb := '{"streak":1,"safety_answer":"minor_risk","risk_flag":true}';
  outcome jsonb;
begin
  if has_function_privilege('anon', 'public.record_safety_checkin_points(text,date,text,jsonb)', 'execute') or
     not has_function_privilege('service_role', 'public.record_safety_checkin_points(text,date,text,jsonb)', 'execute') then
    raise exception 'unexpected safety function access';
  end if;

  perform set_config('fixture.fail_type', 'DAILY_CHECKIN', true);
  begin
    perform public.record_safety_checkin_points('TEST_MEMBER', today, 'TEST_MEMBER', payload);
    raise exception 'expected credit failure';
  exception when check_violation then null;
  end;
  if exists (select 1 from public.daily_checkins) then raise exception 'partial check-in'; end if;

  perform set_config('fixture.fail_type', '', true);
  outcome := public.record_safety_checkin_points('TEST_MEMBER', today, 'TEST_MEMBER', payload);
  if (outcome->>'daily_added')::integer <> 5 or outcome #>> '{checkin,risk_status}' <> 'new' then
    raise exception 'credit or safety answer was not stored';
  end if;
  outcome := public.record_safety_checkin_points('TEST_MEMBER', today, 'TEST_MEMBER', payload);
  if (outcome->>'created')::boolean or (outcome->>'daily_added')::integer <> 0 then
    raise exception 'retry added another check-in or credit';
  end if;

  insert into public.daily_checkins(user_id, uid, checkin_date, points, streak)
  select member_id, 'TEST_MEMBER', monday + offset_days, 5, offset_days + 1
  from generate_series(0, 4) as series(offset_days);
  for offset_days in 0..3 loop
    perform public.apply_points(member_id, 5, 'daily-checkin:' || to_char(monday + offset_days, 'YYYY-MM-DD'),
      'DAILY_CHECKIN', 'TEST_MEMBER');
  end loop;

  perform set_config('fixture.fail_type', 'WEEKLY_SAFETY_MISSION', true);
  begin
    perform public.record_safety_checkin_points('TEST_MEMBER', monday + 4, 'TEST_ADMIN', null);
    raise exception 'expected bonus failure';
  exception when check_violation then null;
  end;
  if (select balance from public.users) <> 25 then raise exception 'partial recovery credit'; end if;

  perform set_config('fixture.fail_type', '', true);
  outcome := public.record_safety_checkin_points('TEST_MEMBER', monday + 4, 'TEST_ADMIN', null);
  if (outcome->>'daily_added')::integer <> 5 or (outcome->>'weekly_added')::integer <> 10 then
    raise exception 'missing existing check-in credit and bonus were not recovered';
  end if;
  outcome := public.record_safety_checkin_points('TEST_MEMBER', monday + 4, 'TEST_ADMIN', null);
  if (outcome->>'daily_added')::integer + (outcome->>'weekly_added')::integer <> 0 or
     (select balance from public.users) <> 40 or
     not exists (select 1 from public.audit_logs where event_type = 'safety_checkin_points_recovered'
       and actor_uid = 'TEST_ADMIN' and (detail->>'weeklyAdded')::integer = 10) then
    raise exception 'recovery is not idempotent or audited';
  end if;
  begin
    perform public.record_safety_checkin_points('TEST_MEMBER', monday - 1, 'TEST_ADMIN', null);
    raise exception 'nonexistent check-in was recovered';
  exception when raise_exception then
    if sqlerrm <> 'SAFETY_CHECKIN_NOT_FOUND' then raise; end if;
  end;
end $$;
