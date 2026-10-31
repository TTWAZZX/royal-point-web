-- Personal coupon assignment. Existing coupons remain general coupons and
-- continue to work with their current code-based redemption flow.

create extension if not exists pgcrypto;

alter table public.coupons
  add column if not exists coupon_type text not null default 'general',
  add column if not exists assigned_uid text,
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by text,
  add column if not exists assignment_reason text,
  add column if not exists assignment_request_id uuid,
  add column if not exists assignment_token_hash text,
  add column if not exists assignment_state text not null default 'active',
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text,
  add column if not exists cancel_reason text;

update public.coupons
set coupon_type = 'general'
where coupon_type is null;

update public.coupons
set assignment_state = 'active'
where assignment_state is null;

create unique index if not exists coupons_assignment_token_hash_uidx
  on public.coupons (assignment_token_hash)
  where assignment_token_hash is not null;

create unique index if not exists coupons_assignment_request_id_uidx
  on public.coupons (assignment_request_id)
  where assignment_request_id is not null;

create index if not exists coupons_assigned_uid_idx
  on public.coupons (assigned_uid, status, created_at desc)
  where assigned_uid is not null;

create index if not exists coupons_assignment_state_idx
  on public.coupons (assignment_state, created_at desc);

comment on column public.coupons.coupon_type is
  'general keeps the legacy bearer-code flow; personal restricts redemption to assigned_uid.';
comment on column public.coupons.assignment_token_hash is
  'SHA-256 hash of the unguessable LIFF coupon ticket. The raw ticket is never stored.';
comment on column public.coupons.assignment_request_id is
  'Admin-generated idempotency key. Retrying an ambiguous request cannot create a second coupon.';
comment on column public.coupons.assignment_state is
  'Separate lifecycle for personal assignment so the legacy unused/used status contract stays unchanged.';

grant select, insert, update, delete on table public.coupons to service_role;
