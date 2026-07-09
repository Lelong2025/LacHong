create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typnamespace='public'::regnamespace and typname='app_role') then
    create type public.app_role as enum ('admin','client');
  end if;
  if not exists (select 1 from pg_type where typnamespace='public'::regnamespace and typname='document_status') then
    create type public.document_status as enum ('draft','submitted','approved','rejected','pending_issue','issued','archived');
  end if;
  if not exists (select 1 from pg_type where typnamespace='public'::regnamespace and typname='audit_action') then
    create type public.audit_action as enum ('CREATE','UPDATE','SOFT_DELETE','LOGIN');
  end if;
end $$;

do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname='public'
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade
);
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists role public.app_role not null default 'client';
alter table public.profiles alter column role drop default;
alter table public.profiles alter column role type public.app_role using (
  case when role::text='admin' then 'admin' else 'client' end
)::public.app_role;
alter table public.profiles alter column role set default 'client';
alter table public.profiles add column if not exists is_active boolean not null default true;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
create unique index if not exists profiles_email_uq on public.profiles(email);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  type text not null check(type in ('totrinh','quyetdinh','khenthuong','baocao','kehoach')),
  code text,
  title text not null check(char_length(title) between 3 and 250),
  description text,
  status public.document_status not null default 'draft',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id)
);
alter table public.documents add column if not exists type text;
alter table public.documents add column if not exists code text;
alter table public.documents add column if not exists title text;
alter table public.documents add column if not exists description text;
alter table public.documents add column if not exists assignee_name text;
alter table public.documents add column if not exists assignee_id uuid references public.profiles(id);
alter table public.documents add column if not exists document_year integer;
alter table public.documents add column if not exists status public.document_status not null default 'draft';
alter table public.documents add column if not exists created_by uuid references public.profiles(id);
alter table public.documents add column if not exists created_at timestamptz not null default now();
alter table public.documents add column if not exists updated_at timestamptz not null default now();
alter table public.documents add column if not exists deleted_at timestamptz;
alter table public.documents add column if not exists deleted_by uuid references public.profiles(id);
create index if not exists documents_owner_status_idx on public.documents(created_by,status) where deleted_at is null;

create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id),
  version integer not null,
  snapshot jsonb not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(document_id,version)
);
alter table public.document_versions add column if not exists document_id uuid references public.documents(id);
alter table public.document_versions add column if not exists version integer;
alter table public.document_versions add column if not exists snapshot jsonb;
alter table public.document_versions add column if not exists created_by uuid references public.profiles(id);
alter table public.document_versions add column if not exists created_at timestamptz not null default now();

create table if not exists public.document_shares (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id),
  client_id uuid not null references public.profiles(id),
  assigned_by uuid not null references public.profiles(id),
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.document_shares add column if not exists document_id uuid references public.documents(id);
alter table public.document_shares add column if not exists client_id uuid references public.profiles(id);
alter table public.document_shares add column if not exists assigned_by uuid references public.profiles(id);
alter table public.document_shares add column if not exists assigned_at timestamptz not null default now();
alter table public.document_shares add column if not exists revoked_at timestamptz;
create unique index if not exists document_shares_active_uq on public.document_shares(document_id,client_id) where revoked_at is null;
create index if not exists document_shares_client_idx on public.document_shares(client_id) where revoked_at is null;

create table if not exists public.document_files (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id),
  name text not null,
  object_path text not null unique,
  mime_type text not null,
  size_bytes integer not null check(size_bytes between 1 and 5242880),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id)
);
alter table public.document_files add column if not exists document_id uuid references public.documents(id);
alter table public.document_files add column if not exists name text;
alter table public.document_files add column if not exists object_path text;
alter table public.document_files add column if not exists mime_type text;
alter table public.document_files add column if not exists size_bytes integer;
alter table public.document_files add column if not exists file_kind text not null default 'attachment';
alter table public.document_files add column if not exists created_by uuid references public.profiles(id);
alter table public.document_files add column if not exists created_at timestamptz not null default now();
alter table public.document_files add column if not exists deleted_at timestamptz;
alter table public.document_files add column if not exists deleted_by uuid references public.profiles(id);

create table if not exists public.review_actions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id),
  actor_id uuid not null references public.profiles(id),
  action text not null check(action in ('submit','approve','reject','request_changes')),
  comment text,
  created_at timestamptz not null default now()
);
alter table public.review_actions add column if not exists document_id uuid references public.documents(id);
alter table public.review_actions add column if not exists actor_id uuid references public.profiles(id);
alter table public.review_actions add column if not exists action text;
alter table public.review_actions add column if not exists comment text;
alter table public.review_actions add column if not exists created_at timestamptz not null default now();

create table if not exists public.issuances (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique references public.documents(id),
  number integer not null,
  year integer not null,
  code text not null,
  issued_by uuid not null references public.profiles(id),
  issued_at timestamptz not null default now(),
  unique(year,number)
);
alter table public.issuances add column if not exists document_id uuid references public.documents(id);
alter table public.issuances add column if not exists number integer;
alter table public.issuances add column if not exists year integer;
alter table public.issuances add column if not exists code text;
alter table public.issuances add column if not exists issued_by uuid references public.profiles(id);
alter table public.issuances add column if not exists issued_at timestamptz not null default now();

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  owner_id uuid not null references public.profiles(id),
  progress integer not null default 0 check(progress between 0 and 100),
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id)
);
alter table public.plans add column if not exists title text;
alter table public.plans add column if not exists owner_id uuid references public.profiles(id);
alter table public.plans add column if not exists progress integer not null default 0;
alter table public.plans add column if not exists due_date date;
alter table public.plans add column if not exists created_at timestamptz not null default now();
alter table public.plans add column if not exists updated_at timestamptz not null default now();
alter table public.plans add column if not exists deleted_at timestamptz;
alter table public.plans add column if not exists deleted_by uuid references public.profiles(id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.notifications add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.notifications add column if not exists type text;
alter table public.notifications add column if not exists title text;
alter table public.notifications add column if not exists message text;
alter table public.notifications add column if not exists data jsonb not null default '{}';
alter table public.notifications add column if not exists created_at timestamptz not null default now();
create index if not exists notifications_user_idx on public.notifications(user_id,created_at desc);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid not null,
  actor_email text not null,
  actor_role public.app_role not null,
  table_name text not null,
  record_id text not null,
  object_name text not null,
  action public.audit_action not null,
  summary jsonb not null default '{}',
  ip_address inet,
  user_agent text
);
alter table public.audit_logs add column if not exists occurred_at timestamptz not null default now();
alter table public.audit_logs add column if not exists actor_id uuid;
alter table public.audit_logs add column if not exists actor_email text;
alter table public.audit_logs add column if not exists actor_role public.app_role;
alter table public.audit_logs add column if not exists table_name text;
alter table public.audit_logs add column if not exists record_id text;
alter table public.audit_logs add column if not exists object_name text;
alter table public.audit_logs add column if not exists action public.audit_action;
alter table public.audit_logs add column if not exists summary jsonb not null default '{}';
alter table public.audit_logs add column if not exists ip_address inet;
alter table public.audit_logs add column if not exists user_agent text;
create index if not exists audit_date_idx on public.audit_logs(occurred_at desc);
create index if not exists audit_actor_idx on public.audit_logs(actor_id,occurred_at desc);

create or replace function public.current_role() returns public.app_role language sql stable security definer set search_path=public as $$
  select coalesce((select role from public.profiles where id=auth.uid()),'client'::public.app_role)
$$;

create or replace function public.is_active_user() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and is_active)
$$;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select public.current_role()='admin' and public.is_active_user()
$$;

create or replace function public.can_view_document(doc_id uuid) returns boolean language sql stable security definer set search_path=public as $$
  select public.is_active_user() and (
    public.is_admin()
    or exists(
      select 1 from public.documents d
      where d.id=doc_id and d.deleted_at is null and (
        d.created_by=auth.uid()
        or d.assignee_id=auth.uid()
        or exists(select 1 from public.document_shares s where s.document_id=d.id and s.client_id=auth.uid() and s.revoked_at is null)
      )
    )
  )
$$;

create or replace function public.search_assignees(p_query text default '')
returns table(id uuid,email text,full_name text)
language sql stable security definer set search_path=public as $$
  select p.id,p.email,p.full_name
  from public.profiles p
  where p.is_active
    and (p_query='' or p.email ilike '%'||p_query||'%' or coalesce(p.full_name,'') ilike '%'||p_query||'%')
  order by coalesce(p.full_name,p.email)
  limit 8
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,email,full_name,role,is_active)
  values(new.id,new.email,nullif(trim(coalesce(new.raw_user_meta_data->>'full_name','')), ''),'client',true)
  on conflict (id) do update set
    email=excluded.email,
    full_name=coalesce(excluded.full_name, public.profiles.full_name),
    updated_at=now();
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_shares enable row level security;
alter table public.document_files enable row level security;
alter table public.review_actions enable row level security;
alter table public.issuances enable row level security;
alter table public.plans enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists profiles_self_or_admin_select on public.profiles;
drop policy if exists profiles_admin_update on public.profiles;
drop policy if exists documents_select on public.documents;
drop policy if exists documents_insert on public.documents;
drop policy if exists documents_update on public.documents;
drop policy if exists shares_select on public.document_shares;
drop policy if exists shares_admin_all on public.document_shares;
drop policy if exists files_select on public.document_files;
drop policy if exists files_insert on public.document_files;
drop policy if exists versions_select on public.document_versions;
drop policy if exists versions_insert on public.document_versions;
drop policy if exists reviews_select on public.review_actions;
drop policy if exists reviews_admin_insert on public.review_actions;
drop policy if exists issuances_select on public.issuances;
drop policy if exists plans_owner_admin on public.plans;
drop policy if exists notifications_own_select on public.notifications;
drop policy if exists notifications_own_delete on public.notifications;
drop policy if exists audit_admin_select on public.audit_logs;

create policy profiles_self_or_admin_select on public.profiles for select using(id=auth.uid() or public.is_admin());
create policy profiles_admin_update on public.profiles for update using(public.is_admin()) with check(public.is_admin());
create policy documents_select on public.documents for select using(public.can_view_document(id));
create policy documents_insert on public.documents for insert with check(public.is_active_user() and created_by=auth.uid());
create policy documents_update on public.documents for update using(public.is_active_user() and (public.is_admin() or(created_by=auth.uid() and status='draft'))) with check(public.is_active_user() and (public.is_admin() or created_by=auth.uid()));
create policy shares_select on public.document_shares for select using(public.is_active_user() and (public.is_admin() or client_id=auth.uid() or exists(select 1 from public.documents d where d.id=document_id and d.created_by=auth.uid())));
create policy shares_admin_all on public.document_shares for all using(public.is_admin()) with check(public.is_admin());
create policy files_select on public.document_files for select using(public.can_view_document(document_id));
create policy files_insert on public.document_files for insert with check(created_by=auth.uid() and public.can_view_document(document_id));
create policy versions_select on public.document_versions for select using(public.can_view_document(document_id));
create policy versions_insert on public.document_versions for insert with check(created_by=auth.uid() and public.can_view_document(document_id));
create policy reviews_select on public.review_actions for select using(public.can_view_document(document_id));
create policy reviews_admin_insert on public.review_actions for insert with check(public.is_admin());
create policy issuances_select on public.issuances for select using(public.can_view_document(document_id));
create policy plans_owner_admin on public.plans for all using(public.is_active_user() and (public.is_admin() or owner_id=auth.uid())) with check(public.is_active_user() and (public.is_admin() or owner_id=auth.uid()));
create policy notifications_own_select on public.notifications for select using(user_id=auth.uid());
create policy notifications_own_delete on public.notifications for delete using(user_id=auth.uid());
create policy audit_admin_select on public.audit_logs for select using(public.is_admin());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('documents','documents',false,5242880,null)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=null;
