begin;

create table if not exists public.birthday_reward_runs (
  run_date date primary key,
  reward_count integer not null default 0
);

create table if not exists public.birthday_reward_awards (
  user_id uuid not null references public.users(id) on delete cascade,
  reward_year integer not null,
  run_date date not null references public.birthday_reward_runs(run_date),
  notification_id uuid not null references public.line_notification_outbox(id),
  primary key (user_id, reward_year)
);

create index if not exists birthday_reward_awards_run_date_idx
  on public.birthday_reward_awards(run_date);

alter table public.birthday_reward_runs enable row level security;
alter table public.birthday_reward_awards enable row level security;
revoke all on table public.birthday_reward_runs, public.birthday_reward_awards from public, anon, authenticated;

-- Keep the deployed birthday eligibility rules and wrap their writes in the same
-- transaction as the run, annual award record, and LINE notification.
create or replace function public.process_birthday_rewards_once(p_amount integer, p_message jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set timezone = 'Asia/Bangkok'
as $$
declare
  run_day date := (now() at time zone 'Asia/Bangkok')::date;
  award_year integer := extract(year from run_day)::integer;
  claimed_day date;
  recipient record;
  member_id uuid;
  outbox_id uuid;
  awarded integer := 0;
begin
  if p_amount is null or p_amount <= 0 or p_message #>> '{contents,body,contents,1,text}' is null then
    raise exception 'INVALID_BIRTHDAY_REWARD';
  end if;

  insert into public.birthday_reward_runs(run_date) values (run_day)
  on conflict (run_date) do nothing
  returning run_date into claimed_day;

  if claimed_day is not null then
    for recipient in select * from public.process_birthday_rewards(p_amount => p_amount, p_year => award_year)
    loop
      select u.id into strict member_id from public.users u where u.uid = recipient.uid;

      insert into public.line_notification_outbox(dedupe_key, recipient_uid, message_kind, payload)
      values (
        'birthday-reward:' || award_year || ':' || member_id,
        recipient.uid,
        'birthday_reward',
        jsonb_set(p_message, '{contents,body,contents,1,text}', to_jsonb(
          'สุขสันต์วันเกิดคุณ ' || coalesce(nullif(left(btrim(recipient.name::text), 80), ''), 'สมาชิก')
        ))
      ) returning id into outbox_id;

      -- A collision rolls back the legacy function too, including its point changes.
      insert into public.birthday_reward_awards(user_id, reward_year, run_date, notification_id)
      values (member_id, award_year, run_day, outbox_id);
      awarded := awarded + 1;
    end loop;

    update public.birthday_reward_runs set reward_count = awarded where run_date = run_day;
  end if;

  return jsonb_build_object(
    'run_date', run_day,
    'repeated', claimed_day is null,
    'reward_count', (select reward_count from public.birthday_reward_runs where run_date = run_day),
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'uid', n.recipient_uid))
      from public.birthday_reward_awards a
      join public.line_notification_outbox n on n.id = a.notification_id
      where a.run_date = run_day and n.status <> 'sent'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.process_birthday_rewards_once(integer,jsonb) from public, anon, authenticated;
grant execute on function public.process_birthday_rewards_once(integer,jsonb) to service_role;

do $$
declare
  routine regprocedure;
begin
  if not exists (select 1 from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'process_birthday_rewards' and prokind = 'f') then
    raise exception 'BIRTHDAY_REWARD_FUNCTION_MISSING';
  end if;
  for routine in select oid::regprocedure from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'process_birthday_rewards' and prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', routine);
    execute format('grant execute on function %s to service_role', routine);
  end loop;
end;
$$;

commit;
