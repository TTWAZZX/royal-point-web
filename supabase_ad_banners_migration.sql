-- Dynamic advertisement banners. Existing users, points and history are untouched.
create extension if not exists pgcrypto;

create table if not exists public.ad_banners (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'การ์ดประชาสัมพันธ์',
  alt_text text not null default 'การ์ดประชาสัมพันธ์',
  image_source text not null default 'url'
    check (image_source in ('url', 'upload')),
  image_url text not null,
  storage_path text,
  link_url text,
  sort_index integer not null default 0,
  active boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists ad_banners_active_sort_idx
  on public.ad_banners (active, sort_index, created_at);
create index if not exists ad_banners_deleted_idx
  on public.ad_banners (deleted_at);

alter table public.ad_banners enable row level security;
revoke all on table public.ad_banners from anon, authenticated;
grant select, insert, update on table public.ad_banners to service_role;

comment on table public.ad_banners is
  'Admin-managed homepage carousel with legacy fallback preserved in index.html.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ad-banners',
  'ad-banners',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Seed the three banners that were previously hard-coded. They remain until an admin changes them.
insert into public.ad_banners
  (id, title, alt_text, image_source, image_url, link_url, sort_index, active)
values
  ('10000000-0000-4000-8000-000000000001', 'การ์ดประชาสัมพันธ์ 1', 'การ์ดประชาสัมพันธ์ 1', 'url', 'https://lh3.googleusercontent.com/d/1GIuuH1EKJM_voSB3PqODqMfHhIyvojCv', 'https://example.com/ad1', 10, true),
  ('10000000-0000-4000-8000-000000000002', 'การ์ดประชาสัมพันธ์ 2', 'การ์ดประชาสัมพันธ์ 2', 'url', 'https://lh3.googleusercontent.com/d/1MLTZG-32BqdyT4EpFBcSw1fUcdMNX2jJ', 'https://example.com/ad2', 20, true),
  ('10000000-0000-4000-8000-000000000003', 'การ์ดประชาสัมพันธ์ 3', 'การ์ดประชาสัมพันธ์ 3', 'url', 'https://lh3.googleusercontent.com/d/1hXJjpdG3gM-Aa25Sn4Rs3bM9j7Ugq51J', 'https://example.com/ad3', 30, true)
on conflict (id) do nothing;
