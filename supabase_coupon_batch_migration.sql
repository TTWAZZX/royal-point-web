begin;

create table if not exists public.coupon_generation_batches (
  request_id uuid primary key,
  admin_uid text not null,
  points integer not null check (points > 0),
  coupon_count integer not null check (coupon_count between 1 and 500),
  prefix text not null,
  codes text[] not null check (cardinality(codes) = coupon_count),
  created_at timestamptz not null default now()
);

create index if not exists coupon_generation_batches_admin_created_idx
  on public.coupon_generation_batches(admin_uid, created_at desc);

alter table public.coupon_generation_batches enable row level security;
revoke all on public.coupon_generation_batches from public, anon, authenticated;
grant select on public.coupon_generation_batches to service_role;

create or replace function public.generate_coupon_batch_once(
  p_request_id uuid, p_admin_uid text, p_points integer, p_count integer, p_prefix text, p_codes text[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  batch public.coupon_generation_batches%rowtype;
begin
  if p_request_id is null or nullif(btrim(p_admin_uid), '') is null or p_points is null or p_points < 1
    or p_count is null or p_count not between 1 and 500 or p_prefix is null then
    raise exception 'COUPON_BATCH_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('coupon-batch:' || p_request_id, 0));

  select * into batch from public.coupon_generation_batches where request_id = p_request_id;
  if found then
    if batch.admin_uid is distinct from p_admin_uid or batch.points is distinct from p_points
      or batch.coupon_count is distinct from p_count or batch.prefix is distinct from p_prefix then
      raise exception 'COUPON_BATCH_CONFLICT';
    end if;
    return to_jsonb(batch) - 'admin_uid' || jsonb_build_object('repeated', true);
  end if;

  if cardinality(p_codes) is distinct from p_count or exists (
    select 1 from unnest(p_codes) as candidate(code)
    where code is null or left(code, length(p_prefix)) <> p_prefix
      or substring(code from length(p_prefix) + 1) !~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{6}$'
  ) then
    raise exception 'COUPON_BATCH_INVALID';
  end if;

  insert into public.coupons(code, point, status, claimer, used_at, created_at, coupon_type)
  select code, p_points, 'unused', null, null, now(), 'general' from unnest(p_codes) as candidate(code);

  insert into public.coupon_generation_batches(request_id, admin_uid, points, coupon_count, prefix, codes)
  values (p_request_id, p_admin_uid, p_points, p_count, p_prefix, p_codes)
  returning * into batch;

  insert into public.audit_logs(event_type, actor_uid, entity_type, entity_id, status, detail)
  values ('coupon_batch_generated', p_admin_uid, 'coupon_generation_batch', p_request_id::text, 'success',
    jsonb_build_object('requestId', p_request_id, 'points', p_points, 'count', p_count));

  return to_jsonb(batch) - 'admin_uid' || jsonb_build_object('repeated', false);
end;
$$;

revoke all on function public.generate_coupon_batch_once(uuid,text,integer,integer,text,text[]) from public, anon, authenticated;
grant execute on function public.generate_coupon_batch_once(uuid,text,integer,integer,text,text[]) to service_role;

commit;
