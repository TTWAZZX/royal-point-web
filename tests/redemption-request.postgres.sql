\set ON_ERROR_STOP on

do $$ begin
  if current_database() <> 'royal_redemption_test' or to_regclass('public.users') is not null then
    raise exception 'Run only on an empty disposable royal_redemption_test database';
  end if;
end $$;

create role anon;
create role authenticated;
create role service_role;
create table public.users(id uuid primary key, uid text unique not null);
create table public.user_points(user_id uuid primary key references public.users, balance integer not null);
create table public.rewards (
  id uuid primary key, name text not null, img_url text, cost integer not null,
  active boolean not null, stock integer not null, updated_at timestamptz
);
create table public.redemptions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users,
  reward_id uuid not null references public.rewards, cost integer not null, status text not null,
  request_id uuid unique, balance_after integer, created_at timestamptz not null default now()
);
create table public.point_transactions(user_id uuid, amount integer);

create function public.apply_points(p_user uuid, p_amount integer, p_code text, p_type text, p_actor text)
returns void language plpgsql as $$
begin
  if current_setting('fixture.fail_spend', true) = 'yes' then raise check_violation; end if;
  update public.user_points set balance = balance + p_amount where user_id = p_user;
  insert into public.point_transactions(user_id, amount) values (p_user, p_amount);
end $$;

insert into public.users(id,uid) values
  ('10000000-0000-4000-8000-000000000001','MEMBER_A'), ('10000000-0000-4000-8000-000000000002','MEMBER_B');
insert into public.user_points(user_id,balance) select id, 100 from public.users;
insert into public.rewards(id,name,cost,active,stock) values
  ('20000000-0000-4000-8000-000000000001','รางวัลเดิม',30,true,1),
  ('20000000-0000-4000-8000-000000000002','รางวัลที่สอง',20,true,1);
insert into public.redemptions(user_id,reward_id,cost,status) values
  ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',30,'legacy');

\ir ../supabase_redemption_request_binding_migration.sql

do $$
declare
  reward_a uuid := '20000000-0000-4000-8000-000000000001';
  reward_b uuid := '20000000-0000-4000-8000-000000000002';
  request uuid := '30000000-0000-4000-8000-000000000001';
  first_run record;
  repeated record;
begin
  if has_function_privilege('anon', 'public.spend_reward_atomic(text,uuid,uuid)', 'execute') or
     not has_function_privilege('service_role', 'public.spend_reward_atomic(text,uuid,uuid)', 'execute') then
    raise exception 'unexpected redemption function access';
  end if;

  select * into first_run from public.spend_reward_atomic('MEMBER_A', reward_a, request);
  select * into repeated from public.spend_reward_atomic('MEMBER_A', reward_a, request);
  if first_run.was_duplicate or not repeated.was_duplicate or repeated.redemption_id <> first_run.redemption_id or
     repeated.balance <> 70 or (select stock from public.rewards where id = reward_a) <> 0 then
    raise exception 'same request should reuse the redemption after the last unit is sold';
  end if;

  update public.redemptions set status = 'cancelled_refunded' where id = first_run.redemption_id;
  select * into repeated from public.spend_reward_atomic('MEMBER_A', reward_a, request);
  if not repeated.was_duplicate or repeated.redemption_status <> 'cancelled_refunded' then
    raise exception 'replay must return current redemption status';
  end if;

  begin
    perform public.spend_reward_atomic('MEMBER_B', reward_a, request);
    raise exception 'owner mismatch accepted';
  exception when raise_exception then
    if sqlerrm <> 'REQUEST_ID_CONFLICT' then raise; end if;
  end;
  begin
    perform public.spend_reward_atomic('MEMBER_A', reward_b, request);
    raise exception 'reward mismatch accepted';
  exception when raise_exception then
    if sqlerrm <> 'REQUEST_ID_CONFLICT' then raise; end if;
  end;

  perform set_config('fixture.fail_spend', 'yes', true);
  begin
    perform public.spend_reward_atomic('MEMBER_A', reward_b, '30000000-0000-4000-8000-000000000002');
    raise exception 'expected points failure';
  exception when check_violation then null;
  end;
  if (select count(*) from public.point_transactions) <> 1 or (select stock from public.rewards where id = reward_b) <> 1 or
     (select count(*) from public.redemptions where status = 'legacy' and request_id is null) <> 1 then
    raise exception 'replay, conflict or failure changed the stock, points or legacy history';
  end if;
end $$;
