\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create role service_role;

create table public.users(
  id uuid primary key, uid text unique, name text, room text, dob text, tel text, passport text
);
create table public.birthday_reward_runs(run_date date primary key, reward_count integer);
create table public.birthday_reward_awards(user_id uuid, reward_year integer, run_date date, notification_id uuid, primary key(user_id,reward_year));
create table public.line_notification_outbox(
  id uuid primary key, status text, sent_at timestamptz, line_request_id text,
  updated_at timestamptz, last_error text, created_at timestamptz default now()
);
create table public.point_transactions(id uuid primary key default gen_random_uuid(), user_id uuid, type text, amount integer, created_at timestamptz);
create table public.redemptions(id uuid primary key default gen_random_uuid(), user_id uuid, reward_id uuid, status text, created_at timestamptz);
create table public.rewards(id uuid primary key, name text);
create table public.coupons(code text primary key, assigned_uid text, assigned_at timestamptz, claimer text, used_at timestamptz, cancelled_at timestamptz);
create table public.daily_checkins(id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz, risk_status text);
create table public.audit_logs(
  id uuid primary key default gen_random_uuid(), event_type text, actor_uid text, target_uid text,
  entity_type text, entity_id text, status text, detail jsonb, created_at timestamptz default now()
);

\ir ../supabase_admin_member_operations_migration.sql
\ir ../supabase_birthday_report_dob_migration.sql

do $$
declare
  member_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  invalid_id uuid := gen_random_uuid();
  line_id uuid := gen_random_uuid();
  reward_id uuid := gen_random_uuid();
  report jsonb;
  result jsonb;
begin
  insert into public.users values
    (member_id,'U_TEST','Test member','SHE','1990-11-22',null,'private'),
    (other_id,'U_OTHER','Other member',null,'1990-11-22',null,null),
    (invalid_id,'U_INVALID','Invalid day',null,'invalid date',null,null);
  insert into public.birthday_reward_runs values ('2026-11-22',1);
  insert into public.line_notification_outbox(id,status) values (line_id,'failed');
  insert into public.birthday_reward_awards values (member_id,2026,'2026-11-22',line_id);
  insert into public.point_transactions(user_id,type,amount,created_at) values
    (member_id,'BIRTHDAY_REWARD',100,'2026-11-22T01:00Z'),
    (other_id,'PRIVATE_OTHER',20,'2026-11-22T01:00Z');
  insert into public.rewards values(reward_id,'Reward fixture');
  insert into public.redemptions(user_id,reward_id,status,created_at)
    values (member_id,reward_id,'approved','2026-11-22T02:00Z');
  insert into public.coupons values ('PRIVATE_CODE','U_TEST','2026-11-22T02:00Z','U_TEST','2026-11-22T03:00Z',null);
  insert into public.daily_checkins(user_id,created_at,risk_status) values (member_id,'2026-11-22T04:00Z','none');

  result := public.admin_update_member_profile('U_TEST','U_ADMIN','{"name":"New name","dob":"1991-10-01"}','{"name":"Test member","dob":"1990-11-22"}');
  if result->>'changed' is distinct from 'true' then raise exception 'Profile write failed'; end if;
  result := public.admin_update_member_profile('U_TEST','U_ADMIN','{"name":"New name","dob":"1991-10-01"}','{"name":"Test member","dob":"1990-11-22"}');
  if result->>'changed' is distinct from 'false' then raise exception 'Profile retry was not idempotent'; end if;
  begin
    perform public.admin_update_member_profile('U_TEST','U_ADMIN','{"name":"Stale write"}','{"name":"Test member"}');
    raise exception 'Stale profile write accepted';
  exception when raise_exception then if sqlerrm <> 'PROFILE_CONFLICT' then raise; end if;
  end;
  if (select count(*) from public.audit_logs) <> 1
    or not exists (select 1 from public.users where id=member_id and uid='U_TEST' and passport='private' and name='New name')
    or exists (select 1 from public.audit_logs where detail::text like '%New name%') then
    raise exception 'Profile identity or audit invariant not met';
  end if;

  report := public.admin_birthday_members('2026-11-22',0);
  if report->>'total' is distinct from '2' or report->>'awarded' is distinct from '1'
    or report->>'notAwarded' is distinct from '1' or report->>'lineSent' is distinct from '0' then
    raise exception 'Unexpected birthday summary: %', report;
  end if;
  if not exists (
    select 1 from jsonb_array_elements(report->'items') row
    where row->>'name' = 'New name' and row->>'dob' = '1991-10-01' and not row ? 'id'
      and row #>> '{delivery,notification_id}' = line_id::text
  ) or has_function_privilege('authenticated','public.admin_birthday_members(date,integer)','execute') then
    raise exception 'Birthday should come from the current member profile and remain admin-only';
  end if;
  update public.line_notification_outbox set status='sent', line_request_id='accepted-fixture',
    sent_at='2026-11-22T01:06:30Z', line_acceptance_recovered=false where id=line_id;
  report := public.admin_birthday_members('2026-11-22',0);
  if report->>'lineSent' is distinct from '1' or not exists (
    select 1 from jsonb_array_elements(report->'items') row
    where row #>> '{delivery,line_request_id}' = 'accepted-fixture'
      and (row #>> '{delivery,line_confirmed_at}')::timestamptz = '2026-11-22T01:06:30Z'::timestamptz
  ) then raise exception 'Missing LINE proof'; end if;
  if (select scheduled_members from public.admin_birthday_upcoming('2026-10-01',1)) <> 0
    or (select scheduled_members from public.admin_birthday_upcoming('2026-11-22',1)) <> 1
    or (select scheduled_members from public.admin_birthday_upcoming('2027-10-01',1)) <> 1
    or has_function_privilege('authenticated','public.admin_birthday_upcoming(date,integer)','execute') then
    raise exception 'Upcoming count or access is invalid';
  end if;
  if (select count(*) from public.admin_member_activity('U_TEST','all','infinity',0)) <> 6
    or (select count(*) from public.admin_member_activity('U_TEST','rewards','infinity',0)) <> 1
    or exists (select 1 from public.admin_member_activity('U_TEST','all','infinity',0) a
               where to_jsonb(a)::text ~ 'PRIVATE_OTHER|PRIVATE_CODE')
    or has_function_privilege('authenticated','public.admin_member_activity(text,text,timestamptz,integer)','execute')
    or has_function_privilege('anon','public.admin_update_member_profile(text,text,jsonb,jsonb)','execute')
    or not has_function_privilege('service_role','public.admin_birthday_members(date,integer)','execute') then
    raise exception 'Activity visibility or RPC permissions invalid';
  end if;
end;
$$;
