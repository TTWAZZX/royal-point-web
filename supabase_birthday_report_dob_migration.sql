begin;

alter table public.line_notification_outbox
  add column if not exists line_acceptance_recovered boolean;

create or replace function public.admin_birthday_members(p_run_date date, p_offset integer)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public, pg_temp
set timezone = 'Asia/Bangkok'
as $$
  with awarded as (
    select a.user_id, a.run_date, n.status as line_status,
      n.id as notification_id, n.sent_at as line_confirmed_at,
      n.line_request_id, n.line_acceptance_recovered,
      n.last_error as line_last_error,
      n.created_at as line_queued_at
    from public.birthday_reward_awards a
    left join public.line_notification_outbox n on n.id = a.notification_id
    where a.reward_year = extract(year from p_run_date)::integer
  ), eligible as (
    select u.id, u.name, u.room,
      case when a.run_date = p_run_date then to_jsonb(a) - 'user_id' - 'run_date' end as delivery,
      case when isfinite(b.dob) then to_char(b.dob, 'YYYY-MM-DD') end as dob,
      case when a.run_date = p_run_date then 'awarded'
        when a.run_date < p_run_date or exists (
          select 1 from public.point_transactions t where t.user_id = u.id
            and t.type = 'BIRTHDAY_REWARD'
            and t.created_at >= date_trunc('year', p_run_date::timestamptz)
            and t.created_at < (p_run_date + 1)::timestamptz
        ) then 'previously_awarded'
        else 'not_awarded'
      end as state
    from public.users u
    left join awarded a on a.user_id = u.id
    cross join lateral (select public.admin_parse_member_birthday(u.dob::text) as dob) b
    where a.run_date = p_run_date
       or (extract(month from b.dob) = extract(month from p_run_date)
          and extract(day from b.dob) = extract(day from p_run_date))
  ), page as (
    select id, name, room, dob, delivery, state from eligible
    order by name nulls last, id limit 25 offset greatest(p_offset, 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from eligible),
    'awarded', (select count(*) from eligible where state = 'awarded'),
    'previouslyAwarded', (select count(*) from eligible where state = 'previously_awarded'),
    'notAwarded', (select count(*) from eligible where state = 'not_awarded'),
    'lineSent', (select count(*) from eligible where delivery->>'line_status' = 'sent'),
    'items', coalesce((select jsonb_agg(to_jsonb(page) - 'id' order by name nulls last, id) from page), '[]'::jsonb)
  );
$$;

create or replace function public.admin_birthday_upcoming(p_start date, p_days integer)
returns table (run_date date, scheduled_members bigint)
language sql stable security definer
set search_path = pg_catalog, public, pg_temp
set timezone = 'Asia/Bangkok'
as $$
  with calendar as (
    select p_start + day as day
    from generate_series(0, least(greatest(p_days, 0), 30) - 1) day
  ), members as materialized (
    select id, extract(month from dob) as month, extract(day from dob) as day
    from (
      select id, public.admin_parse_member_birthday(dob::text) as dob from public.users
    ) u
    where isfinite(dob)
  ), annual_awards as (
    select user_id, reward_year from public.birthday_reward_awards
    union
    select user_id, extract(year from created_at)::integer
    from public.point_transactions
    where type = 'BIRTHDAY_REWARD' and created_at >= date_trunc('year', p_start::timestamptz)
  )
  select c.day, count(m.id) filter (where a.user_id is null)
  from calendar c
  left join members m on m.month = extract(month from c.day) and m.day = extract(day from c.day)
  left join annual_awards a on a.user_id = m.id and a.reward_year = extract(year from c.day)::integer
  group by c.day order by c.day;
$$;

revoke all on function public.admin_birthday_members(date,integer) from public, anon, authenticated;
grant execute on function public.admin_birthday_members(date,integer) to service_role;
revoke all on function public.admin_birthday_upcoming(date,integer) from public, anon, authenticated;
grant execute on function public.admin_birthday_upcoming(date,integer) to service_role;

commit;
