create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typnamespace='public'::regnamespace and typname='audit_action') then
    create type public.audit_action as enum ('CREATE','UPDATE','SOFT_DELETE','LOGIN');
  end if;
end $$;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  actor_role public.app_role,
  table_name text,
  record_id text,
  object_name text,
  action public.audit_action,
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
create index if not exists audit_actor_idx on public.audit_logs(actor_id, occurred_at desc);

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  row_data jsonb;
  old_data jsonb;
  audit_action public.audit_action;
  label text;
  changed text[] := '{}';
  actor_uuid uuid;
  actor_profile public.profiles;
begin
  row_data := to_jsonb(coalesce(new, old));
  old_data := to_jsonb(old);
  actor_uuid := auth.uid();

  if actor_uuid is null then
    actor_uuid := nullif(coalesce(
      row_data->>'created_by',
      row_data->>'actor_id',
      row_data->>'issued_by',
      row_data->>'owner_id',
      row_data->>'deleted_by'
    ), '')::uuid;
  end if;

  select * into actor_profile from public.profiles where id=actor_uuid;
  if actor_profile.id is null then
    return coalesce(new, old);
  end if;

  if tg_op='INSERT' then
    audit_action := 'CREATE';
  elsif (row_data->>'deleted_at') is not null and coalesce(old_data->>'deleted_at', '') = '' then
    audit_action := 'SOFT_DELETE';
  else
    audit_action := 'UPDATE';
    select array_agg(key order by key) into changed
    from jsonb_object_keys(row_data) as key
    where row_data->key is distinct from old_data->key
      and key not in ('updated_at');
  end if;

  label := coalesce(
    row_data->>'title',
    row_data->>'name',
    row_data->>'code',
    row_data->>'email',
    row_data->>'object_path',
    row_data->>'id',
    tg_table_name
  );

  insert into public.audit_logs(actor_id, actor_email, actor_role, table_name, record_id, object_name, action, summary)
  values(
    actor_profile.id,
    actor_profile.email,
    actor_profile.role,
    tg_table_name,
    coalesce(row_data->>'id', ''),
    label,
    audit_action,
    jsonb_build_object(
      'objectName', label,
      'changedFields', coalesce(to_jsonb(changed), '[]'::jsonb),
      'description',
        case audit_action
          when 'CREATE' then 'Tạo mới'
          when 'UPDATE' then 'Sửa'
          when 'SOFT_DELETE' then 'Xóa'
          else 'Đăng nhập'
        end
    )
  );

  return coalesce(new, old);
end $$;

create or replace function public.log_login()
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  p public.profiles;
begin
  select * into p from public.profiles where id=auth.uid();
  if p.id is null then
    return;
  end if;

  insert into public.audit_logs(actor_id, actor_email, actor_role, table_name, record_id, object_name, action, summary)
  values(
    p.id,
    p.email,
    p.role,
    'profiles',
    p.id::text,
    p.email,
    'LOGIN',
    jsonb_build_object('objectName', p.email, 'changedFields', '[]'::jsonb, 'description', 'Đăng nhập thành công')
  );
end $$;

drop trigger if exists audit_documents on public.documents;
create trigger audit_documents after insert or update on public.documents for each row execute function public.audit_row_change();

drop trigger if exists audit_shares on public.document_shares;
create trigger audit_shares after insert or update on public.document_shares for each row execute function public.audit_row_change();

drop trigger if exists audit_files on public.document_files;
create trigger audit_files after insert or update on public.document_files for each row execute function public.audit_row_change();

drop trigger if exists audit_reviews on public.review_actions;
create trigger audit_reviews after insert on public.review_actions for each row execute function public.audit_row_change();

drop trigger if exists audit_issuances on public.issuances;
create trigger audit_issuances after insert or update on public.issuances for each row execute function public.audit_row_change();

drop trigger if exists audit_plans on public.plans;
create trigger audit_plans after insert or update on public.plans for each row execute function public.audit_row_change();

drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles after update on public.profiles for each row execute function public.audit_row_change();

alter table public.audit_logs enable row level security;
drop policy if exists audit_admin_select on public.audit_logs;
create policy audit_admin_select on public.audit_logs for select using(public.is_admin());
