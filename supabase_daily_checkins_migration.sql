create table if not exists public.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  uid text not null,
  checkin_date date not null,
  points integer not null default 5 check (points > 0),
  streak integer not null default 1 check (streak > 0),
  created_at timestamptz not null default now(),
  unique (uid, checkin_date)
);

create index if not exists daily_checkins_user_id_date_idx
  on public.daily_checkins (user_id, checkin_date desc);

create index if not exists daily_checkins_uid_date_idx
  on public.daily_checkins (uid, checkin_date desc);

alter table public.daily_checkins enable row level security;

drop policy if exists "daily_checkins_service_role_all" on public.daily_checkins;
create policy "daily_checkins_service_role_all"
  on public.daily_checkins
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
