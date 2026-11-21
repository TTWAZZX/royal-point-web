\set ON_ERROR_STOP on

do $$ begin
  if current_database() <> 'royal_coupon_batch_test' or to_regclass('public.coupons') is not null then
    raise exception 'Run only on an empty disposable royal_coupon_batch_test database';
  end if;
end $$;

create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.coupons (
  code text primary key, point integer not null, status text not null, claimer text,
  used_at timestamptz, created_at timestamptz, coupon_type text not null default 'general'
);
create table public.audit_logs (
  event_type text, actor_uid text, entity_type text, entity_id text, status text, detail jsonb
);
insert into public.coupons(code,point,status) values ('OLD234',25,'used');

\ir ../supabase_coupon_batch_migration.sql

do $$
declare
  request uuid := '10000000-0000-4000-8000-000000000001';
  duplicate_request uuid := '10000000-0000-4000-8000-000000000002';
  first_batch jsonb;
  replay jsonb;
begin
  if has_function_privilege('anon', 'public.generate_coupon_batch_once(uuid,text,integer,integer,text,text[])', 'execute') or
     has_table_privilege('authenticated', 'public.coupon_generation_batches', 'select') or
     not has_table_privilege('service_role', 'public.coupon_generation_batches', 'select') then
    raise exception 'unexpected coupon batch permissions';
  end if;

  first_batch := public.generate_coupon_batch_once(request, 'ADMIN_A', 50, 2, 'A-', array['A-BCDEFG','A-HJKLMN']);
  replay := public.generate_coupon_batch_once(request, 'ADMIN_A', 50, 2, 'A-', array['A-abcdef','A-ghjkmn']);
  if (first_batch->>'repeated')::boolean or not (replay->>'repeated')::boolean or first_batch->'codes' <> replay->'codes' or
     (select count(*) from public.coupons) <> 3 or (select count(*) from public.audit_logs) <> 1 then
    raise exception 'replay created another batch or changed its result';
  end if;

  begin
    perform public.generate_coupon_batch_once(request, 'ADMIN_B', 50, 2, 'A-', null);
    raise exception 'different admin accepted';
  exception when raise_exception then
    if sqlerrm <> 'COUPON_BATCH_CONFLICT' then raise; end if;
  end;

  begin
    perform public.generate_coupon_batch_once(request, 'ADMIN_A', 90, 2, 'A-', null);
    raise exception 'different points accepted';
  exception when raise_exception then
    if sqlerrm <> 'COUPON_BATCH_CONFLICT' then raise; end if;
  end;

  begin
    perform public.generate_coupon_batch_once(duplicate_request, 'ADMIN_A', 50, 2, 'A-', array['A-BCDEFG','A-efghjk']);
    raise exception 'existing code accepted';
  exception when unique_violation then null;
  end;
  if exists (select 1 from public.coupon_generation_batches where request_id = duplicate_request) or
     exists (select 1 from public.coupons where code = 'A-efghjk') then
    raise exception 'failed batch left partial data';
  end if;

  delete from public.coupons where code = 'A-BCDEFG';
  replay := public.generate_coupon_batch_once(request, 'ADMIN_A', 50, 2, 'A-', null);
  if replay->'codes' <> first_batch->'codes' or exists (select 1 from public.coupons where code = 'A-BCDEFG') or
     not exists (select 1 from public.coupons where code = 'OLD234' and status = 'used' and point = 25) then
    raise exception 'replay changed deleted or legacy coupons';
  end if;
end $$;
