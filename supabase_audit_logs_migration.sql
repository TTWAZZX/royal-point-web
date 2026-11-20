create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid,
  event_type text not null,
  actor_uid text,
  target_uid text,
  entity_type text,
  entity_id text,
  status text not null default 'info',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_logs
  add column if not exists correlation_id uuid;

create unique index if not exists audit_logs_correlation_id_uidx
  on public.audit_logs (correlation_id)
  where correlation_id is not null;

create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);

create index if not exists audit_logs_event_type_idx
  on public.audit_logs (event_type);

create index if not exists audit_logs_actor_uid_idx
  on public.audit_logs (actor_uid);

create table if not exists public.audit_failure_outbox (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null unique,
  event_payload jsonb not null,
  original_error text not null,
  last_error text,
  status text not null default 'pending' check (status in ('pending', 'recovered')),
  attempts integer not null default 0 check (attempts >= 0),
  recovered_by text,
  recovered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists audit_failure_outbox_pending_idx
  on public.audit_failure_outbox (created_at desc)
  where status = 'pending';

alter table public.audit_logs enable row level security;
alter table public.audit_failure_outbox enable row level security;

drop policy if exists "audit_logs_service_role_all" on public.audit_logs;
create policy "audit_logs_service_role_all"
  on public.audit_logs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "audit_failure_outbox_service_role_all" on public.audit_failure_outbox;
create policy "audit_failure_outbox_service_role_all"
  on public.audit_failure_outbox
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

revoke all on table public.audit_logs from anon, authenticated;
revoke all on table public.audit_failure_outbox from anon, authenticated;
grant all on table public.audit_logs to service_role;
grant all on table public.audit_failure_outbox to service_role;

comment on table public.audit_failure_outbox is
  'รายการ audit ที่บันทึกไม่สำเร็จ แสดงในหน้าแอดมินและ retry ได้ด้วย correlation_id';
