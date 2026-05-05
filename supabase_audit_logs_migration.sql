create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  actor_uid text,
  target_uid text,
  entity_type text,
  entity_id text,
  status text not null default 'info',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);

create index if not exists audit_logs_event_type_idx
  on public.audit_logs (event_type);

create index if not exists audit_logs_actor_uid_idx
  on public.audit_logs (actor_uid);

alter table public.audit_logs enable row level security;

drop policy if exists "audit_logs_service_role_all" on public.audit_logs;
create policy "audit_logs_service_role_all"
  on public.audit_logs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
