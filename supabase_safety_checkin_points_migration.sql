begin;

create index if not exists point_transactions_safety_credit_lookup_idx
  on public.point_transactions(user_id, code)
  where type in ('DAILY_CHECKIN', 'WEEKLY_SAFETY_MISSION') and amount > 0;

create or replace function public.record_safety_checkin_points(
  p_uid text, p_date date, p_actor text, p_checkin jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  today date := (now() at time zone 'Asia/Bangkok')::date;
  member_id uuid;
  checkin public.daily_checkins%rowtype;
  created boolean := false;
  daily_added integer := 0;
  weekly_added integer := 0;
  week_start date := p_date - (extract(isodow from p_date)::integer - 1);
  daily_code text := 'daily-checkin:' || to_char(p_date, 'YYYY-MM-DD');
  weekly_code text := 'weekly-safety:' || to_char(week_start, 'YYYY-MM-DD');
  is_recovery boolean := p_checkin is null;
  weekly_days integer;
begin
  if p_date is null or p_date > today or (not is_recovery and p_date <> today) then
    raise exception 'SAFETY_CHECKIN_DATE_INVALID';
  end if;
  if nullif(btrim(p_actor), '') is null or (not is_recovery and p_actor is distinct from p_uid) then
    raise exception 'SAFETY_CHECKIN_ACTOR_INVALID';
  end if;

  select u.id into member_id from public.users u where u.uid = p_uid;
  if not found then raise exception 'SAFETY_MEMBER_NOT_FOUND'; end if;

  -- User check-ins and administrator recovery use the same lock for this member.
  perform pg_advisory_xact_lock(hashtextextended('safety-checkin:' || member_id, 0));

  select dc.* into checkin from public.daily_checkins dc
  where dc.uid = p_uid and dc.checkin_date = p_date;

  if not found then
    if is_recovery then raise exception 'SAFETY_CHECKIN_NOT_FOUND'; end if;
    insert into public.daily_checkins (
      user_id, uid, checkin_date, points, streak, safety_question_id,
      safety_answer, safety_mood, safety_note, risk_flag, risk_status
    ) values (
      member_id, p_uid, p_date, 5, (p_checkin->>'streak')::integer,
      p_checkin->>'safety_question_id', p_checkin->>'safety_answer',
      p_checkin->>'safety_mood', p_checkin->>'safety_note',
      coalesce((p_checkin->>'risk_flag')::boolean, false),
      case when (p_checkin->>'risk_flag')::boolean then 'new' else 'none' end
    ) returning * into checkin;
    created := true;
  end if;

  if checkin.user_id is distinct from member_id then raise exception 'SAFETY_CHECKIN_OWNER_MISMATCH'; end if;

  if created or is_recovery then
    if not exists (
      select 1 from public.point_transactions pt where pt.user_id = member_id
        and pt.code = daily_code and pt.type = 'DAILY_CHECKIN' and pt.amount > 0
    ) then
      perform public.apply_points(member_id, checkin.points, daily_code, 'DAILY_CHECKIN', p_actor);
      daily_added := checkin.points;
    end if;

    select count(distinct dc.checkin_date) into weekly_days from public.daily_checkins dc
    where dc.user_id = member_id and dc.checkin_date between week_start and least(week_start + 6, today);

    if weekly_days >= 5 and not exists (
      select 1 from public.point_transactions pt where pt.user_id = member_id
        and pt.code = weekly_code and pt.type = 'WEEKLY_SAFETY_MISSION' and pt.amount > 0
    ) then
      perform public.apply_points(member_id, 10, weekly_code, 'WEEKLY_SAFETY_MISSION', p_actor);
      weekly_added := 10;
      insert into public.audit_logs(event_type, actor_uid, target_uid, entity_type, entity_id, status, detail)
      values ('weekly_mission_success', p_actor, p_uid, 'weekly_mission', weekly_code, 'success',
        jsonb_build_object('bonus', weekly_added, 'count', weekly_days, 'target', 5));
    end if;

    insert into public.audit_logs(event_type, actor_uid, target_uid, entity_type, entity_id, status, detail)
    values (case when is_recovery then 'safety_checkin_points_recovered' else 'daily_checkin_success' end,
      p_actor, p_uid, 'daily_checkin', checkin.id::text, 'success',
      jsonb_build_object('today', p_date, 'points', checkin.points, 'streak', checkin.streak,
        'dailyAdded', daily_added, 'weeklyAdded', weekly_added, 'weeklyBonusAwarded', weekly_added > 0,
        'safety', jsonb_build_object('safety_mood', checkin.safety_mood)));
  end if;

  return jsonb_build_object('checkin', to_jsonb(checkin), 'created', created,
    'daily_added', daily_added, 'weekly_added', weekly_added);
end;
$$;

revoke all on function public.record_safety_checkin_points(text,date,text,jsonb) from public, anon, authenticated;
grant execute on function public.record_safety_checkin_points(text,date,text,jsonb) to service_role;

commit;
