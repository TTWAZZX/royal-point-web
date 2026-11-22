begin;

grant select on public.birthday_reward_runs to service_role;

create or replace function public.admin_update_member_profile(
  p_uid text, p_admin_uid text, p_patch jsonb, p_expected jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  member public.users%rowtype;
  updated public.users%rowtype;
  previous jsonb;
  fields text[];
  field text;
begin
  if jsonb_typeof(p_patch) is distinct from 'object'
    or jsonb_typeof(p_expected) is distinct from 'object' then
    raise exception 'INVALID_PROFILE';
  end if;

  select * into member from public.users where uid = p_uid for update;
  if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
  previous := to_jsonb(member);
  select array_agg(key order by key) into fields
  from jsonb_object_keys(p_patch) keys(key)
  where p_patch->key is distinct from previous->key;

  for field in select jsonb_object_keys(p_patch) loop
    if field not in ('name', 'room', 'dob', 'tel', 'passport')
      or not p_expected ? field
      or jsonb_typeof(p_patch->field) not in ('string', 'null') then
      raise exception 'INVALID_PROFILE';
    end if;
  end loop;
  if fields is null then return jsonb_build_object('changed', false); end if;

  foreach field in array fields loop
    if previous->field is distinct from p_expected->field then
      raise exception 'PROFILE_CONFLICT';
    end if;
  end loop;

  updated := jsonb_populate_record(member, p_patch);
  if nullif(btrim(updated.name), '') is null then raise exception 'INVALID_PROFILE'; end if;
  update public.users
  set name = updated.name, room = updated.room, dob = updated.dob,
      tel = updated.tel, passport = updated.passport
  where id = member.id;

  insert into public.audit_logs(event_type, actor_uid, target_uid, entity_type, entity_id, status, detail)
  values ('member_profile_updated', p_admin_uid, member.uid, 'user', member.id::text, 'success',
    jsonb_build_object('fields', fields));
  return jsonb_build_object('changed', true);
end;
$$;

create or replace function public.admin_member_activity(
  p_uid text, p_category text, p_before timestamptz, p_offset integer
) returns table (
  category text, activity text, happened_at timestamptz, points numeric,
  label text, state text, fields jsonb
) language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with member as (
    select u.id, u.uid from public.users u where u.uid = p_uid
  ), events as (
    select 'points'::text as category, t.type::text as activity, t.created_at as happened_at,
      t.amount::numeric as points, null::text as label, null::text as state, null::jsonb as fields, t.id::text as ref
    from member m join public.point_transactions t on t.user_id = m.id
    where p_category in ('all', 'points')
    union all
    select 'rewards', 'reward_redemption', r.created_at,
      null, w.name::text, r.status::text, null, r.id::text
    from member m join public.redemptions r on r.user_id = m.id
    left join public.rewards w on w.id = r.reward_id
    where p_category in ('all', 'rewards')
    union all
    select 'coupons', c.activity, c.happened_at, null, null, null, null, c.ref
    from member m join lateral (
      select 'coupon_assigned'::text as activity, assigned_at as happened_at, code::text as ref
      from public.coupons where assigned_uid = m.uid and assigned_at is not null
      union all
      select 'coupon_redeemed', used_at, code::text
      from public.coupons where claimer = m.uid and used_at is not null
      union all
      select 'coupon_cancelled', cancelled_at, code::text
      from public.coupons where assigned_uid = m.uid and cancelled_at is not null
    ) c on true
    where p_category in ('all', 'coupons')
    union all
    select 'safety', 'safety_checkin', c.created_at,
      null, null, c.risk_status, null, c.id::text
    from member m join public.daily_checkins c on c.user_id = m.id
    where p_category in ('all', 'safety')
    union all
    select 'audit', a.event_type, a.created_at, null, null, a.status,
      case when a.event_type = 'member_profile_updated' then a.detail->'fields' end, a.id::text
    from member m join public.audit_logs a on a.target_uid = m.uid or a.actor_uid = m.uid
    where p_category in ('all', 'audit')
  )
  select e.category, e.activity, e.happened_at, e.points, e.label, e.state, e.fields
  from events e
  where e.happened_at <= p_before
  order by e.happened_at desc, e.category, e.activity, e.ref
  limit 26 offset greatest(p_offset, 0);
$$;

create or replace function public.admin_parse_member_birthday(p_dob text)
returns date language plpgsql stable
set datestyle = 'ISO, MDY'
as $$
begin
  return p_dob::date;
exception when invalid_datetime_format or datetime_field_overflow then
  return null;
end;
$$;

create or replace function public.admin_birthday_members(p_run_date date, p_offset integer)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public, pg_temp
set timezone = 'Asia/Bangkok'
as $$
  with awarded as (
    select a.user_id, a.run_date, n.status as line_status
    from public.birthday_reward_awards a
    left join public.line_notification_outbox n on n.id = a.notification_id
    where a.reward_year = extract(year from p_run_date)::integer
  ), eligible as (
    select u.id, u.name, u.room, a.line_status,
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
    select id, name, room, line_status, state from eligible
    order by name nulls last, id limit 25 offset greatest(p_offset, 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from eligible),
    'awarded', (select count(*) from eligible where state = 'awarded'),
    'previouslyAwarded', (select count(*) from eligible where state = 'previously_awarded'),
    'notAwarded', (select count(*) from eligible where state = 'not_awarded'),
    'lineSent', (select count(*) from eligible where state = 'awarded' and line_status = 'sent'),
    'items', coalesce((select jsonb_agg(to_jsonb(page) - 'id' order by name nulls last, id) from page), '[]'::jsonb)
  );
$$;

create index if not exists audit_logs_target_uid_created_idx on public.audit_logs (target_uid, created_at desc);
create index if not exists coupons_claimer_used_idx on public.coupons (claimer, used_at desc) where claimer is not null;

revoke all on function public.admin_update_member_profile(text,text,jsonb,jsonb),
  public.admin_member_activity(text,text,timestamptz,integer),
  public.admin_parse_member_birthday(text), public.admin_birthday_members(date,integer)
  from public, anon, authenticated;
grant execute on function public.admin_update_member_profile(text,text,jsonb,jsonb),
  public.admin_member_activity(text,text,timestamptz,integer), public.admin_birthday_members(date,integer)
  to service_role;

commit;
