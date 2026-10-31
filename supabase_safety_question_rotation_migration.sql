-- Stable, per-user Safety Question assignments.
-- Existing questions, check-ins and user records are not modified.
create table if not exists public.safety_question_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  uid text not null,
  assignment_date date not null,
  question_id text not null,
  selection_mode text not null default 'unseen'
    check (selection_mode in ('unseen', 'least_recently_seen', 'existing_checkin', 'fallback')),
  created_at timestamptz not null default now(),
  unique (uid, assignment_date)
);

create index if not exists safety_question_assignments_user_date_idx
  on public.safety_question_assignments (user_id, assignment_date desc);

create index if not exists safety_question_assignments_question_idx
  on public.safety_question_assignments (question_id, assignment_date desc);

create index if not exists daily_checkins_question_rotation_idx
  on public.daily_checkins (uid, safety_question_id, checkin_date desc)
  where safety_question_id is not null;

alter table public.safety_question_assignments enable row level security;

drop policy if exists "safety_question_assignments_service_role_all"
  on public.safety_question_assignments;
create policy "safety_question_assignments_service_role_all"
  on public.safety_question_assignments
  for all
  to service_role
  using (true)
  with check (true);
