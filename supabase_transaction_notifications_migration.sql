-- Royal Point transaction notifications and redemption handoff workflow.
-- Safe to run repeatedly. Existing redemption rows and identifiers are preserved.

alter table public.redemptions
  add column if not exists request_id uuid,
  add column if not exists balance_after integer,
  add column if not exists received_at timestamptz,
  add column if not exists received_by text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text,
  add column if not exists cancel_reason text,
  add column if not exists refunded_transaction_id uuid,
  add column if not exists refund_balance integer;

alter table public.redemptions
  drop constraint if exists redemptions_status_check;
alter table public.redemptions
  add constraint redemptions_status_check
  check (status in ('legacy', 'approved', 'received', 'cancelled_refunded')) not valid;

-- Rows created before this workflow have no request_id. Keep the history intact,
-- leave every new workflow field NULL, and prevent old rows from appearing as
-- awaiting pickup or being received/cancelled through the new admin actions.
update public.redemptions
set status = 'legacy',
    balance_after = null,
    received_at = null,
    received_by = null,
    cancelled_at = null,
    cancelled_by = null,
    cancel_reason = null,
    refunded_transaction_id = null,
    refund_balance = null
where request_id is null
  and status = 'approved';

create unique index if not exists redemptions_request_id_uidx
  on public.redemptions (request_id)
  where request_id is not null;

create index if not exists redemptions_status_created_idx
  on public.redemptions (status, created_at desc);

create table if not exists public.admin_point_adjustments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  user_id uuid not null references public.users(id) on delete restrict,
  target_uid text not null,
  admin_uid text not null,
  mode text not null check (mode in ('add', 'deduct', 'reset')),
  amount integer not null,
  delta integer not null,
  balance_before integer not null,
  balance_after integer not null,
  reason text not null,
  point_transaction_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists admin_point_adjustments_user_idx
  on public.admin_point_adjustments (target_uid, created_at desc);

alter table public.admin_point_adjustments enable row level security;
revoke all on table public.admin_point_adjustments from anon, authenticated;
grant select, insert, update on table public.admin_point_adjustments to service_role;

create or replace function public.admin_adjust_points_v2(
  p_target_uid text,
  p_mode text,
  p_amount integer,
  p_reason text,
  p_admin_uid text,
  p_request_id uuid
)
returns table (
  adjustment_id uuid,
  transaction_id uuid,
  applied_delta integer,
  balance_before integer,
  balance_after integer,
  was_duplicate boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_before integer;
  v_after integer;
  v_delta integer;
  v_adjustment_id uuid;
  v_transaction_id uuid;
  v_reason text := left(trim(coalesce(p_reason, '')), 300);
  v_mode text := lower(trim(coalesce(p_mode, '')));
begin
  if p_request_id is null then
    raise exception 'REQUEST_ID_REQUIRED';
  end if;
  if length(v_reason) < 3 then
    raise exception 'ADJUSTMENT_REASON_REQUIRED';
  end if;
  if v_mode not in ('add', 'deduct', 'reset') then
    raise exception 'INVALID_ADJUSTMENT_MODE';
  end if;
  if v_mode <> 'reset' and coalesce(p_amount, 0) <= 0 then
    raise exception 'INVALID_ADJUSTMENT_AMOUNT';
  end if;

  select a.id, a.point_transaction_id, a.delta, a.balance_before, a.balance_after
    into v_adjustment_id, v_transaction_id, v_delta, v_before, v_after
  from public.admin_point_adjustments a
  where a.request_id = p_request_id;

  if found then
    return query select v_adjustment_id, v_transaction_id, v_delta, v_before, v_after, true;
    return;
  end if;

  select u.id into v_user_id
  from public.users u
  where u.uid = trim(coalesce(p_target_uid, ''))
  limit 1;
  if v_user_id is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  insert into public.user_points (user_id, balance)
  values (v_user_id, 0)
  on conflict (user_id) do nothing;

  select up.balance into v_before
  from public.user_points up
  where up.user_id = v_user_id
  for update;

  v_before := coalesce(v_before, 0);
  v_delta := case v_mode
    when 'add' then p_amount
    when 'deduct' then -p_amount
    else -v_before
  end;

  if v_before + v_delta < 0 then
    raise exception 'INSUFFICIENT_POINTS';
  end if;

  insert into public.admin_point_adjustments (
    request_id, user_id, target_uid, admin_uid, mode, amount, delta,
    balance_before, balance_after, reason
  ) values (
    p_request_id, v_user_id, trim(p_target_uid), trim(p_admin_uid), v_mode,
    case when v_mode = 'reset' then abs(v_delta) else p_amount end,
    v_delta, v_before, v_before, v_reason
  )
  returning id into v_adjustment_id;

  if v_delta <> 0 then
    perform public.apply_points(
      v_user_id,
      v_delta,
      concat('ADMIN:', v_adjustment_id::text, ':', left(v_reason, 120)),
      case when v_mode = 'add' then 'ADMIN_GIVE'
           when v_mode = 'deduct' then 'ADMIN_DEDUCT'
           else 'ADMIN_RESET' end,
      trim(p_admin_uid)
    );
  end if;

  select up.balance into v_after
  from public.user_points up
  where up.user_id = v_user_id;

  if v_delta <> 0 then
    select pt.id into v_transaction_id
    from public.point_transactions pt
    where pt.user_id = v_user_id
      and pt.code like concat('ADMIN:', v_adjustment_id::text, ':%')
    order by pt.created_at desc
    limit 1;
  end if;

  update public.admin_point_adjustments a
  set balance_after = coalesce(v_after, v_before),
      point_transaction_id = v_transaction_id
  where a.id = v_adjustment_id;

  return query select v_adjustment_id, v_transaction_id, v_delta,
    v_before, coalesce(v_after, v_before), false;
end;
$$;

create or replace function public.spend_reward_atomic(
  p_uid text,
  p_reward_id uuid,
  p_request_id uuid
)
returns table (
  redemption_id uuid,
  reward_name text,
  reward_image text,
  spent integer,
  balance integer,
  redemption_status text,
  created_at timestamptz,
  was_duplicate boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_reward public.rewards%rowtype;
  v_existing public.redemptions%rowtype;
  v_balance integer;
  v_after integer;
  v_redemption_id uuid;
  v_created_at timestamptz;
begin
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED'; end if;

  select r.* into v_existing
  from public.redemptions r
  where r.request_id = p_request_id;
  if found then
    select rw.* into v_reward from public.rewards rw where rw.id = v_existing.reward_id;
    return query select v_existing.id, v_reward.name, v_reward.img_url,
      v_existing.cost, coalesce(v_existing.balance_after, 0), v_existing.status,
      v_existing.created_at, true;
    return;
  end if;

  select u.id into v_user_id
  from public.users u
  where u.uid = trim(coalesce(p_uid, ''))
  limit 1;
  if v_user_id is null then raise exception 'USER_NOT_FOUND'; end if;

  select rw.* into v_reward
  from public.rewards rw
  where rw.id = p_reward_id
  for update;
  if not found then raise exception 'REWARD_NOT_FOUND'; end if;
  if not coalesce(v_reward.active, false) then raise exception 'REWARD_INACTIVE'; end if;
  if coalesce(v_reward.stock, 0) <= 0 then raise exception 'OUT_OF_STOCK'; end if;

  insert into public.user_points (user_id, balance)
  values (v_user_id, 0)
  on conflict (user_id) do nothing;

  select up.balance into v_balance
  from public.user_points up
  where up.user_id = v_user_id
  for update;
  v_balance := coalesce(v_balance, 0);
  if v_balance < coalesce(v_reward.cost, 0) then raise exception 'INSUFFICIENT_POINTS'; end if;

  update public.rewards
  set stock = stock - 1, updated_at = now()
  where id = v_reward.id;

  perform public.apply_points(
    v_user_id, -v_reward.cost, v_reward.name, 'SPEND_REWARD', trim(p_uid)
  );

  select up.balance into v_after
  from public.user_points up
  where up.user_id = v_user_id;

  insert into public.redemptions (
    user_id, reward_id, cost, status, request_id, balance_after
  ) values (
    v_user_id, v_reward.id, v_reward.cost, 'approved', p_request_id, v_after
  )
  returning id, redemptions.created_at into v_redemption_id, v_created_at;

  return query select v_redemption_id, v_reward.name, v_reward.img_url,
    v_reward.cost, v_after, 'approved'::text, v_created_at, false;
end;
$$;

create or replace function public.mark_redemption_received(
  p_redemption_id uuid,
  p_admin_uid text
)
returns table (
  redemption_id uuid,
  user_id uuid,
  reward_id uuid,
  cost integer,
  received_at timestamptz,
  already_done boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.redemptions%rowtype;
begin
  select r.* into v_row from public.redemptions r
  where r.id = p_redemption_id for update;
  if not found then raise exception 'REDEMPTION_NOT_FOUND'; end if;
  if v_row.status = 'received' then
    return query select v_row.id, v_row.user_id, v_row.reward_id, v_row.cost,
      v_row.received_at, true;
    return;
  end if;
  if v_row.status <> 'approved' then raise exception 'REDEMPTION_NOT_RECEIVABLE'; end if;

  update public.redemptions r
  set status = 'received', received_at = now(), received_by = trim(p_admin_uid)
  where r.id = p_redemption_id
  returning r.* into v_row;

  return query select v_row.id, v_row.user_id, v_row.reward_id, v_row.cost,
    v_row.received_at, false;
end;
$$;

create or replace function public.cancel_redemption_with_refund(
  p_redemption_id uuid,
  p_admin_uid text,
  p_reason text
)
returns table (
  redemption_id uuid,
  user_id uuid,
  reward_id uuid,
  refunded_points integer,
  balance integer,
  cancelled_at timestamptz,
  already_done boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.redemptions%rowtype;
  v_reward public.rewards%rowtype;
  v_balance integer;
  v_tx_id uuid;
  v_reason text := left(trim(coalesce(p_reason, '')), 300);
begin
  if length(v_reason) < 3 then raise exception 'CANCEL_REASON_REQUIRED'; end if;

  select r.* into v_row from public.redemptions r
  where r.id = p_redemption_id for update;
  if not found then raise exception 'REDEMPTION_NOT_FOUND'; end if;
  if v_row.status = 'cancelled_refunded' then
    return query select v_row.id, v_row.user_id, v_row.reward_id, v_row.cost,
      coalesce(v_row.refund_balance, 0), v_row.cancelled_at, true;
    return;
  end if;
  if v_row.status <> 'approved' then raise exception 'REDEMPTION_NOT_CANCELLABLE'; end if;

  select rw.* into v_reward from public.rewards rw
  where rw.id = v_row.reward_id for update;

  update public.rewards rw
  set stock = case
      when coalesce(rw.stock_max, 0) > 0 then least(coalesce(rw.stock, 0) + 1, rw.stock_max)
      else coalesce(rw.stock, 0) + 1
    end,
    updated_at = now()
  where rw.id = v_row.reward_id;

  perform public.apply_points(
    v_row.user_id,
    v_row.cost,
    concat('REFUND:', v_row.id::text, ':', left(v_reason, 120)),
    'REDEMPTION_REFUND',
    trim(p_admin_uid)
  );

  select up.balance into v_balance from public.user_points up
  where up.user_id = v_row.user_id;
  select pt.id into v_tx_id from public.point_transactions pt
  where pt.user_id = v_row.user_id
    and pt.code like concat('REFUND:', v_row.id::text, ':%')
  order by pt.created_at desc limit 1;

  update public.redemptions r
  set status = 'cancelled_refunded', cancelled_at = now(),
      cancelled_by = trim(p_admin_uid), cancel_reason = v_reason,
      refunded_transaction_id = v_tx_id, refund_balance = v_balance
  where r.id = p_redemption_id
  returning r.* into v_row;

  return query select v_row.id, v_row.user_id, v_row.reward_id, v_row.cost,
    v_balance, v_row.cancelled_at, false;
end;
$$;

revoke all on function public.admin_adjust_points_v2(text,text,integer,text,text,uuid) from public, anon, authenticated;
revoke all on function public.spend_reward_atomic(text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.mark_redemption_received(uuid,text) from public, anon, authenticated;
revoke all on function public.cancel_redemption_with_refund(uuid,text,text) from public, anon, authenticated;
grant execute on function public.admin_adjust_points_v2(text,text,integer,text,text,uuid) to service_role;
grant execute on function public.spend_reward_atomic(text,uuid,uuid) to service_role;
grant execute on function public.mark_redemption_received(uuid,text) to service_role;
grant execute on function public.cancel_redemption_with_refund(uuid,text,text) to service_role;

comment on column public.redemptions.status is
  'legacy is read-only history from before this workflow; approved means awaiting pickup; received and cancelled_refunded are terminal states.';
comment on table public.admin_point_adjustments is
  'Idempotent administrator point changes with before/after balances and transaction references.';
