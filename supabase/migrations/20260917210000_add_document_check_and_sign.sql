-- Migration: Add check and sign tracking columns to documents
alter table public.documents add column if not exists is_checked boolean not null default false;
alter table public.documents add column if not exists checked_by text;
alter table public.documents add column if not exists checked_at timestamptz;

alter table public.documents add column if not exists is_signed boolean not null default false;
alter table public.documents add column if not exists signed_by text;
alter table public.documents add column if not exists signed_at timestamptz;

create index if not exists documents_is_checked_idx on public.documents(is_checked) where deleted_at is null;
create index if not exists documents_is_signed_idx on public.documents(is_signed) where deleted_at is null;
