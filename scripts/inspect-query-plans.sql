-- Read-only estimates. Use a disposable representative fixture for EXPLAIN ANALYZE.
begin read only;
set local statement_timeout = '5s';
set local lock_timeout = '1s';

select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('daily_checkins', 'point_transactions', 'redemptions', 'rewards', 'safety_question_assignments')
order by tablename, indexname;

-- api/score-history.js: points and latest redemptions for one member.
explain
select id, amount, code, type, created_at
from public.point_transactions
where user_id = '00000000-0000-4000-8000-000000000001'::uuid
order by created_at desc, id desc
limit 50;

explain
select rd.id, rd.created_at, rd.cost, rd.status, rw.name, rw.img_url
from public.redemptions rd
left join public.rewards rw on rw.id = rd.reward_id
where rd.user_id = '00000000-0000-4000-8000-000000000001'::uuid
order by rd.created_at desc
limit 50;

-- api/score-history.js: pickup tracker, distinct from the full history.
explain
select rd.id, rd.created_at, rd.cost, rd.status, rw.name, rw.img_url
from public.redemptions rd
left join public.rewards rw on rw.id = rd.reward_id
where rd.user_id = '00000000-0000-4000-8000-000000000001'::uuid
  and rd.status = 'approved'
order by rd.created_at desc
limit 3;

-- api/daily-checkin.js: current assignment, rotation history, weekly credit.
explain
select id, question_id, selection_mode
from public.safety_question_assignments
where uid = 'U_PERFORMANCE_FIXTURE' and assignment_date = date '2026-11-28';

explain
select safety_question_id, checkin_date, created_at
from public.daily_checkins
where uid = 'U_PERFORMANCE_FIXTURE' and safety_question_id is not null
order by checkin_date desc
limit 1000;

explain
select created_at
from public.point_transactions
where user_id = '00000000-0000-4000-8000-000000000001'::uuid
  and code = 'weekly-safety:2026-11-23'
  and type = 'WEEKLY_SAFETY_MISSION'
  and amount > 0
limit 1;

-- api/rewards.js: public catalog and current stock.
explain
select id, name, cost, img_url, active, updated_at, stock, stock_max, sort_index
from public.rewards
where active = true
order by sort_index asc, updated_at desc;

rollback;
