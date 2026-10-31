-- Progressive LINE authentication migration.
-- This table does not change users.id, users.uid, points, redemptions, coupons,
-- daily check-ins, or any existing history.

create table if not exists public.user_auth_migrations (
  uid text primary key,
  token_required boolean not null default true,
  migrated_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  recovery_until timestamptz,
  recovery_reason text,
  recovery_by text,
  recovery_case_id bigint
);

alter table public.user_auth_migrations
  add column if not exists recovery_until timestamptz,
  add column if not exists recovery_reason text,
  add column if not exists recovery_by text,
  add column if not exists recovery_case_id bigint;

create index if not exists user_auth_migrations_last_verified_idx
  on public.user_auth_migrations (last_verified_at desc);

alter table public.user_auth_migrations enable row level security;

revoke all on table public.user_auth_migrations from anon, authenticated;
grant select, insert, update on table public.user_auth_migrations to service_role;

comment on table public.user_auth_migrations is
  'Tracks UIDs that have successfully moved from legacy UID trust to verified LINE tokens.';

-- Authentication help center. These tables are intentionally separate from
-- users, points, coupons, redemptions, and all existing history.
create extension if not exists pgcrypto;

create table if not exists public.auth_help_cases (
  id bigint generated always as identity primary key,
  case_no text not null unique,
  target_uid text not null,
  status text not null default 'open'
    check (status in ('open', 'approved', 'resolved', 'expired', 'closed')),
  error_code text not null,
  error_detail text,
  request_count integer not null default 1,
  requested_at timestamptz not null default now(),
  last_requested_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by text,
  recovery_until timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists auth_help_cases_one_active_uid_idx
  on public.auth_help_cases (target_uid)
  where status in ('open', 'approved');

create index if not exists auth_help_cases_status_requested_idx
  on public.auth_help_cases (status, last_requested_at desc);

create table if not exists public.auth_recovery_tickets (
  id uuid primary key default gen_random_uuid(),
  case_id bigint not null references public.auth_help_cases(id) on delete cascade,
  target_uid text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists auth_recovery_tickets_case_idx
  on public.auth_recovery_tickets (case_id, created_at desc);

create table if not exists public.line_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  retry_key uuid not null default gen_random_uuid(),
  case_id bigint references public.auth_help_cases(id) on delete set null,
  recipient_uid text not null,
  message_kind text not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),
  attempt_count integer not null default 0,
  line_request_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists line_notification_outbox_case_idx
  on public.line_notification_outbox (case_id, created_at desc);

create index if not exists line_notification_outbox_status_idx
  on public.line_notification_outbox (status, updated_at asc);

alter table public.auth_help_cases enable row level security;
alter table public.auth_recovery_tickets enable row level security;
alter table public.line_notification_outbox enable row level security;

revoke all on table public.auth_help_cases from anon, authenticated;
revoke all on table public.auth_recovery_tickets from anon, authenticated;
revoke all on table public.line_notification_outbox from anon, authenticated;
grant select, insert, update on table public.auth_help_cases to service_role;
grant select, insert, update on table public.auth_recovery_tickets to service_role;
grant select, insert, update on table public.line_notification_outbox to service_role;
grant usage, select on all sequences in schema public to service_role;

comment on table public.auth_help_cases is
  'Tracks user authentication help requests without changing the user account or its data.';
comment on table public.auth_recovery_tickets is
  'Stores only SHA-256 hashes of short-lived, single-use recovery links.';
comment on table public.line_notification_outbox is
  'Idempotent LINE notification queue and delivery status for authentication help cases.';

create or replace function public.open_auth_recovery_case(
  p_case_id bigint,
  p_target_uid text,
  p_admin_uid text,
  p_reason text,
  p_recovery_until timestamptz,
  p_ticket_hash text,
  p_ticket_expires_at timestamptz
)
returns public.auth_help_cases
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.auth_help_cases;
begin
  update public.user_auth_migrations
  set recovery_until = p_recovery_until,
      recovery_reason = p_reason,
      recovery_by = p_admin_uid,
      recovery_case_id = p_case_id
  where uid = p_target_uid and token_required = true;

  if not found then
    raise exception 'auth_not_migrated';
  end if;

  update public.auth_help_cases
  set status = 'approved',
      approved_at = now(),
      approved_by = p_admin_uid,
      recovery_until = p_recovery_until,
      updated_at = now()
  where id = p_case_id
    and target_uid = p_target_uid
    and status in ('open', 'approved')
  returning * into result;

  if result.id is null then
    raise exception 'help_case_not_found';
  end if;

  update public.auth_recovery_tickets
  set expires_at = now()
  where case_id = p_case_id and consumed_at is null;

  insert into public.auth_recovery_tickets(case_id, target_uid, token_hash, expires_at)
  values (p_case_id, p_target_uid, p_ticket_hash, p_ticket_expires_at);

  return result;
end;
$$;

revoke all on function public.open_auth_recovery_case(bigint,text,text,text,timestamptz,text,timestamptz) from public, anon, authenticated;
grant execute on function public.open_auth_recovery_case(bigint,text,text,text,timestamptz,text,timestamptz) to service_role;
