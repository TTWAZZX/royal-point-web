create table if not exists public.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  uid text not null,
  checkin_date date not null,
  points integer not null default 5 check (points > 0),
  streak integer not null default 1 check (streak > 0),
  safety_question_id text,
  safety_answer text,
  safety_mood text,
  safety_note text,
  risk_flag boolean not null default false,
  risk_status text not null default 'none',
  risk_admin_note text,
  risk_ack_by text,
  risk_ack_at timestamptz,
  risk_resolved_by text,
  risk_resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (uid, checkin_date)
);

alter table public.daily_checkins
  add column if not exists safety_question_id text,
  add column if not exists safety_answer text,
  add column if not exists safety_mood text,
  add column if not exists safety_note text,
  add column if not exists risk_flag boolean not null default false,
  add column if not exists risk_status text not null default 'none',
  add column if not exists risk_admin_note text,
  add column if not exists risk_ack_by text,
  add column if not exists risk_ack_at timestamptz,
  add column if not exists risk_resolved_by text,
  add column if not exists risk_resolved_at timestamptz;

create table if not exists public.safety_questions (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'general',
  question text not null,
  options jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  source text not null default 'admin',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists safety_questions_active_category_idx
  on public.safety_questions (active, category, created_at desc);

alter table public.safety_questions enable row level security;

drop policy if exists "safety_questions_service_role_all" on public.safety_questions;
create policy "safety_questions_service_role_all"
  on public.safety_questions
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create table if not exists public.safety_settings (
  id text primary key default 'global',
  checkin_time_enabled boolean not null default false,
  checkin_start_time text not null default '06:00',
  checkin_end_time text not null default '18:00',
  streak_reset_date date,
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.safety_settings
  add column if not exists streak_reset_date date;

insert into public.safety_settings (id)
values ('global')
on conflict (id) do nothing;

alter table public.safety_settings enable row level security;

drop policy if exists "safety_settings_service_role_all" on public.safety_settings;
create policy "safety_settings_service_role_all"
  on public.safety_settings
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index if not exists daily_checkins_user_id_date_idx
  on public.daily_checkins (user_id, checkin_date desc);

create index if not exists daily_checkins_uid_date_idx
  on public.daily_checkins (uid, checkin_date desc);

create index if not exists daily_checkins_risk_flag_date_idx
  on public.daily_checkins (risk_flag, checkin_date desc);

create index if not exists daily_checkins_risk_status_date_idx
  on public.daily_checkins (risk_status, checkin_date desc);

alter table public.daily_checkins enable row level security;

drop policy if exists "daily_checkins_service_role_all" on public.daily_checkins;
create policy "daily_checkins_service_role_all"
  on public.daily_checkins
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
