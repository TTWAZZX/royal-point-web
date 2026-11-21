begin;

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
set search_path = pg_catalog, public, pg_temp
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

  select u.id into v_user_id
  from public.users u
  where u.uid = trim(coalesce(p_uid, ''))
  limit 1;
  if v_user_id is null then raise exception 'USER_NOT_FOUND'; end if;

  -- Serialize retries by request ID before checking stock or deducting points.
  perform pg_advisory_xact_lock(hashtextextended('reward-spend:' || p_request_id, 0));

  select r.* into v_existing
  from public.redemptions r
  where r.request_id = p_request_id;
  if found then
    if v_existing.user_id is distinct from v_user_id or v_existing.reward_id is distinct from p_reward_id then
      raise exception 'REQUEST_ID_CONFLICT';
    end if;
    select rw.* into v_reward from public.rewards rw where rw.id = v_existing.reward_id;
    return query select v_existing.id, v_reward.name, v_reward.img_url,
      v_existing.cost, coalesce(v_existing.balance_after, 0), v_existing.status,
      v_existing.created_at, true;
    return;
  end if;

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

revoke all on function public.spend_reward_atomic(text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.spend_reward_atomic(text,uuid,uuid) to service_role;

commit;
