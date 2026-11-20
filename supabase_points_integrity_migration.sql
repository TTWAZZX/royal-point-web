-- Atomic and idempotent point workflows for Royal Point Web.
-- Run after supabase_coupon_assignment_migration.sql and
-- supabase_transaction_notifications_migration.sql, before deploying the matching APIs.
-- Safe to run repeatedly. Existing users, UIDs, balances, coupons and history are preserved.

create extension if not exists pgcrypto;

create table if not exists public.admin_giveaways (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  admin_uid text not null,
  amount integer not null check (amount > 0 and amount <= 1000000),
  reason text not null,
  credited_users integer not null default 0,
  credited_points bigint not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists admin_giveaways_created_idx
  on public.admin_giveaways (created_at desc);

alter table public.admin_giveaways enable row level security;
revoke all on table public.admin_giveaways from anon, authenticated;
grant select, insert, update on table public.admin_giveaways to service_role;

create or replace function public.admin_giveaway_to_all_v2(
  p_amount integer,
  p_reason text,
  p_admin_uid text,
  p_request_id uuid
)
returns table (
  giveaway_id uuid,
  credited_users integer,
  credited_points bigint,
  created_at timestamptz,
  was_duplicate boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_giveaway_id uuid;
  v_credited_users integer := 0;
  v_credited_points bigint := 0;
  v_created_at timestamptz;
  v_user_id uuid;
  v_existing_amount integer;
  v_existing_reason text;
  v_existing_admin_uid text;
  v_reason text := left(trim(coalesce(p_reason, '')), 300);
begin
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  if coalesce(p_amount, 0) <= 0 or p_amount > 1000000 then
    raise exception 'INVALID_GIVEAWAY_AMOUNT';
  end if;
  if length(v_reason) < 3 then raise exception 'GIVEAWAY_REASON_REQUIRED'; end if;
  if length(trim(coalesce(p_admin_uid, ''))) = 0 then raise exception 'ADMIN_UID_REQUIRED'; end if;

  select g.id, g.credited_users, g.credited_points, g.created_at, g.amount, g.reason, g.admin_uid
    into v_giveaway_id, v_credited_users, v_credited_points, v_created_at,
      v_existing_amount, v_existing_reason, v_existing_admin_uid
  from public.admin_giveaways g
  where g.request_id = p_request_id;

  if found then
    if v_existing_amount <> p_amount or v_existing_reason <> v_reason or v_existing_admin_uid <> trim(p_admin_uid) then
      raise exception 'REQUEST_ID_CONFLICT';
    end if;
    return query select v_giveaway_id, v_credited_users, v_credited_points, v_created_at, true;
    return;
  end if;

  insert into public.admin_giveaways (request_id, admin_uid, amount, reason)
  values (p_request_id, trim(p_admin_uid), p_amount, v_reason)
  on conflict (request_id) do nothing
  returning id, admin_giveaways.created_at into v_giveaway_id, v_created_at;

  -- A concurrent retry waits for the first transaction, then returns its result.
  if v_giveaway_id is null then
    select g.id, g.credited_users, g.credited_points, g.created_at, g.amount, g.reason, g.admin_uid
      into v_giveaway_id, v_credited_users, v_credited_points, v_created_at,
        v_existing_amount, v_existing_reason, v_existing_admin_uid
    from public.admin_giveaways g
    where g.request_id = p_request_id;
    if v_existing_amount <> p_amount or v_existing_reason <> v_reason or v_existing_admin_uid <> trim(p_admin_uid) then
      raise exception 'REQUEST_ID_CONFLICT';
    end if;
    return query select v_giveaway_id, v_credited_users, v_credited_points, v_created_at, true;
    return;
  end if;

  for v_user_id in
    select u.id from public.users u order by u.id
  loop
    perform public.apply_points(
      v_user_id,
      p_amount,
      concat('GIVEAWAY:', v_giveaway_id::text, ':', v_user_id::text),
      'ADMIN_GIVE',
      trim(p_admin_uid)
    );
    v_credited_users := v_credited_users + 1;
  end loop;

  v_credited_points := v_credited_users::bigint * p_amount::bigint;

  update public.admin_giveaways g
  set credited_users = v_credited_users,
      credited_points = v_credited_points,
      completed_at = now()
  where g.id = v_giveaway_id;

  return query select v_giveaway_id, v_credited_users, v_credited_points, v_created_at, false;
end;
$$;

create or replace function public.redeem_coupon_atomic(
  p_uid text,
  p_code text,
  p_ticket_hash text
)
returns table (
  coupon_code text,
  added_points integer,
  coupon_type text,
  assigned_uid text,
  assignment_reason text,
  assigned_at timestamptz,
  used_at timestamptz,
  balance integer,
  was_duplicate boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_coupon public.coupons%rowtype;
  v_balance integer;
  v_uid text := trim(coalesce(p_uid, ''));
  v_code text := trim(coalesce(p_code, ''));
  v_ticket_hash text := trim(coalesce(p_ticket_hash, ''));
  v_is_personal boolean;
begin
  if v_uid = '' then raise exception 'USER_NOT_FOUND'; end if;
  if (v_code = '' and v_ticket_hash = '') or (v_code <> '' and v_ticket_hash <> '') then
    raise exception 'COUPON_IDENTIFIER_INVALID';
  end if;

  select u.id into v_user_id
  from public.users u
  where u.uid = v_uid
  limit 1;
  if v_user_id is null then raise exception 'USER_NOT_FOUND'; end if;

  if v_ticket_hash <> '' then
    select c.* into v_coupon
    from public.coupons c
    where c.assignment_token_hash = v_ticket_hash
    for update;
  else
    select c.* into v_coupon
    from public.coupons c
    where c.code = v_code
    for update;
  end if;
  if not found then raise exception 'INVALID_CODE'; end if;

  v_is_personal := lower(coalesce(v_coupon.coupon_type, 'general')) = 'personal';
  if v_is_personal and coalesce(v_coupon.assignment_state, 'active') <> 'active' then
    raise exception 'COUPON_CANCELLED';
  end if;
  if v_is_personal and coalesce(v_coupon.assigned_uid, '') <> v_uid then
    raise exception 'COUPON_NOT_OWNER';
  end if;

  -- A retry by the same owner returns the original successful result.
  if lower(coalesce(v_coupon.status, '')) = 'used' and coalesce(v_coupon.claimer, '') = v_uid then
    select coalesce(up.balance, 0) into v_balance
    from public.user_points up where up.user_id = v_user_id;
    return query select v_coupon.code::text, coalesce(v_coupon.point, 0)::integer,
      coalesce(v_coupon.coupon_type, 'general')::text, v_coupon.assigned_uid::text,
      v_coupon.assignment_reason::text, v_coupon.assigned_at, v_coupon.used_at,
      coalesce(v_balance, 0), true;
    return;
  end if;

  if lower(coalesce(v_coupon.status, '')) <> 'unused' then raise exception 'ALREADY_USED'; end if;
  if coalesce(v_coupon.point, 0) <= 0 then raise exception 'INVALID_COUPON_POINTS'; end if;

  update public.coupons c
  set status = 'used', claimer = v_uid, used_at = now()
  where c.code = v_coupon.code
  returning c.* into v_coupon;

  -- Any failure below rolls the coupon update back in the same database transaction.
  perform public.apply_points(
    v_user_id,
    coalesce(v_coupon.point, 0)::integer,
    v_coupon.code,
    'COUPON_REDEEM',
    v_uid
  );

  select coalesce(up.balance, 0) into v_balance
  from public.user_points up where up.user_id = v_user_id;

  return query select v_coupon.code::text, coalesce(v_coupon.point, 0)::integer,
    coalesce(v_coupon.coupon_type, 'general')::text, v_coupon.assigned_uid::text,
    v_coupon.assignment_reason::text, v_coupon.assigned_at, v_coupon.used_at,
    coalesce(v_balance, 0), false;
end;
$$;

revoke all on function public.admin_giveaway_to_all_v2(integer,text,text,uuid) from public, anon, authenticated;
revoke all on function public.redeem_coupon_atomic(text,text,text) from public, anon, authenticated;
grant execute on function public.admin_giveaway_to_all_v2(integer,text,text,uuid) to service_role;
grant execute on function public.redeem_coupon_atomic(text,text,text) to service_role;

comment on table public.admin_giveaways is
  'One row per idempotent all-user point giveaway. request_id prevents duplicate awards on retries.';
comment on function public.redeem_coupon_atomic(text,text,text) is
  'Claims a coupon and applies points in one transaction; same-user retries return the completed result.';

-- Rollback plan (only if the matching application code has already been rolled back):
-- drop function if exists public.redeem_coupon_atomic(text,text,text);
-- drop function if exists public.admin_giveaway_to_all_v2(integer,text,text,uuid);
-- drop table if exists public.admin_giveaways;
