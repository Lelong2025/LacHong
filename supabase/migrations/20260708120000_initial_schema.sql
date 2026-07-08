create extension if not exists pgcrypto;

create type public.app_role as enum ('admin','client');
create type public.document_status as enum ('draft','submitted','approved','rejected','pending_issue','issued','archived');
create type public.audit_action as enum ('CREATE','UPDATE','SOFT_DELETE','LOGIN');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role public.app_role not null default 'client',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
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
create index documents_owner_status_idx on public.documents(created_by,status) where deleted_at is null;

create table public.document_versions (
  id uuid primary key default gen_random_uuid(), document_id uuid not null references public.documents(id), version integer not null,
  snapshot jsonb not null, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  unique(document_id,version)
);
create table public.document_shares (
  id uuid primary key default gen_random_uuid(), document_id uuid not null references public.documents(id),
  client_id uuid not null references public.profiles(id), assigned_by uuid not null references public.profiles(id),
  assigned_at timestamptz not null default now(), revoked_at timestamptz
);
create unique index document_shares_active_uq on public.document_shares(document_id,client_id) where revoked_at is null;
create index document_shares_client_idx on public.document_shares(client_id) where revoked_at is null;

create table public.document_files (
 id uuid primary key default gen_random_uuid(), document_id uuid not null references public.documents(id), name text not null,
 object_path text not null unique, mime_type text not null, size_bytes integer not null check(size_bytes between 1 and 5242880),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), deleted_at timestamptz, deleted_by uuid references public.profiles(id)
);
create table public.review_actions (
 id uuid primary key default gen_random_uuid(), document_id uuid not null references public.documents(id), actor_id uuid not null references public.profiles(id),
 action text not null check(action in ('submit','approve','reject','request_changes')), comment text, created_at timestamptz not null default now()
);
create table public.issuances (
 id uuid primary key default gen_random_uuid(), document_id uuid not null unique references public.documents(id), number integer not null,
 year integer not null, code text not null, issued_by uuid not null references public.profiles(id), issued_at timestamptz not null default now(),
 unique(year,number)
);
create table public.plans (
 id uuid primary key default gen_random_uuid(), title text not null, owner_id uuid not null references public.profiles(id), progress integer not null default 0 check(progress between 0 and 100),
 due_date date, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz, deleted_by uuid references public.profiles(id)
);
create table public.notifications (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 type text not null, title text not null, message text not null, data jsonb not null default '{}', created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id,created_at desc);
create table public.audit_logs (
 id uuid primary key default gen_random_uuid(), occurred_at timestamptz not null default now(), actor_id uuid not null,
 actor_email text not null, actor_role public.app_role not null, table_name text not null, record_id text not null,
 object_name text not null, action public.audit_action not null, summary jsonb not null default '{}', ip_address inet, user_agent text
);
create index audit_date_idx on public.audit_logs(occurred_at desc);
create index audit_actor_idx on public.audit_logs(actor_id,occurred_at desc);

create or replace function public.current_role() returns public.app_role language sql stable security definer set search_path=public as $$
 select coalesce((select role from public.profiles where id=auth.uid()),'client'::public.app_role)
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$ select public.current_role()='admin' $$;
create or replace function public.can_view_document(doc_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select public.is_admin() or exists(select 1 from public.documents d where d.id=doc_id and d.deleted_at is null and (d.created_by=auth.uid() or exists(select 1 from public.document_shares s where s.document_id=d.id and s.client_id=auth.uid() and s.revoked_at is null)))
$$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.profiles(id,email,full_name,role) values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',''),'client'); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.audit_row_change() returns trigger language plpgsql security definer set search_path=public as $$
declare row_data jsonb; a public.audit_action; label text; changed text[] := '{}'; p public.profiles;
begin
 row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 select * into p from public.profiles where id=auth.uid();
 if p.id is null then
   if tg_op='DELETE' then return old; else return new; end if;
 end if;
 if tg_op='INSERT' then a:='CREATE'; elsif (to_jsonb(new)->>'deleted_at') is not null and (to_jsonb(old)->>'deleted_at') is null then a:='SOFT_DELETE'; else a:='UPDATE';
   select coalesce(array_agg(k),'{}') into changed from jsonb_each(to_jsonb(new)) n(k,v) join jsonb_each(to_jsonb(old)) o using(k) where n.v is distinct from o.v and k not in('updated_at'); end if;
 label:=coalesce(row_data->>'title',row_data->>'name',row_data->>'email',row_data->>'code',row_data->>'id');
 insert into public.audit_logs(actor_id,actor_email,actor_role,table_name,record_id,object_name,action,summary)
 values(p.id,p.email,p.role,tg_table_name,row_data->>'id',label,a,jsonb_build_object('objectName',label,'changedFields',changed,'description',case a when 'CREATE' then 'Thêm mới' when 'UPDATE' then 'Cập nhật' else 'Xóa mềm' end));
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger audit_documents after insert or update on public.documents for each row execute function public.audit_row_change();
create trigger audit_shares after insert or update on public.document_shares for each row execute function public.audit_row_change();
create trigger audit_files after insert or update on public.document_files for each row execute function public.audit_row_change();
create trigger audit_reviews after insert on public.review_actions for each row execute function public.audit_row_change();
create trigger audit_issuances after insert or update on public.issuances for each row execute function public.audit_row_change();
create trigger audit_plans after insert or update on public.plans for each row execute function public.audit_row_change();
create trigger audit_profiles after update on public.profiles for each row execute function public.audit_row_change();

create or replace function public.log_login() returns void language plpgsql security definer set search_path=public as $$
declare p public.profiles; begin select * into p from public.profiles where id=auth.uid(); if p.id is null then raise exception 'Unauthorized'; end if;
insert into public.audit_logs(actor_id,actor_email,actor_role,table_name,record_id,object_name,action,summary) values(p.id,p.email,p.role,'profiles',p.id,p.email,'LOGIN',jsonb_build_object('objectName',p.email,'changedFields','[]'::jsonb,'description','Đăng nhập thành công')); end $$;

create or replace function public.assign_document(p_document uuid,p_client uuid) returns public.document_shares language plpgsql security definer set search_path=public as $$
declare result public.document_shares; begin if not public.is_admin() then raise exception 'Forbidden'; end if;
if not exists(select 1 from public.profiles where id=p_client and role='client' and is_active) then raise exception 'Invalid client'; end if;
update public.document_shares set revoked_at=now() where document_id=p_document and client_id=p_client and revoked_at is null;
insert into public.document_shares(document_id,client_id,assigned_by) values(p_document,p_client,auth.uid()) returning * into result;
insert into public.notifications(user_id,type,title,message,data) select p_client,'document_assigned','Hồ sơ được chia sẻ',title,jsonb_build_object('documentId',id) from public.documents where id=p_document;
return result; end $$;
create or replace function public.revoke_document_share(p_document uuid,p_client uuid) returns void language plpgsql security definer set search_path=public as $$ begin if not public.is_admin() then raise exception 'Forbidden'; end if; update public.document_shares set revoked_at=now() where document_id=p_document and client_id=p_client and revoked_at is null; end $$;
create or replace function public.issue_document(p_document uuid) returns public.issuances language plpgsql security definer set search_path=public as $$
declare n integer; y integer:=extract(year from now()); result public.issuances; begin if not public.is_admin() then raise exception 'Forbidden'; end if;
perform pg_advisory_xact_lock(y); select coalesce(max(number),0)+1 into n from public.issuances where year=y;
insert into public.issuances(document_id,number,year,code,issued_by) values(p_document,n,y,lpad(n::text,3,'0')||'/LHU-'||y,auth.uid()) returning * into result;
update public.documents set status='issued',code=result.code,updated_at=now() where id=p_document and status='approved'; if not found then raise exception 'Document is not approved'; end if; return result; end $$;
create or replace function public.consume_notification(p_id uuid) returns boolean language plpgsql security definer set search_path=public as $$ begin delete from public.notifications where id=p_id and user_id=auth.uid(); return found; end $$;
create or replace function public.consume_all_notifications() returns integer language plpgsql security definer set search_path=public as $$ declare n integer; begin delete from public.notifications where user_id=auth.uid(); get diagnostics n=row_count; return n; end $$;
create or replace function public.purge_expired_audit_logs() returns integer language plpgsql security definer set search_path=public as $$ declare n integer; begin if not public.is_admin() then raise exception 'Forbidden'; end if; delete from public.audit_logs where occurred_at < now()-interval '12 months'; get diagnostics n=row_count; return n; end $$;

alter table public.profiles enable row level security; alter table public.documents enable row level security; alter table public.document_versions enable row level security;
alter table public.document_shares enable row level security; alter table public.document_files enable row level security; alter table public.review_actions enable row level security;
alter table public.issuances enable row level security; alter table public.plans enable row level security; alter table public.notifications enable row level security; alter table public.audit_logs enable row level security;
create policy profiles_self_or_admin_select on public.profiles for select using(id=auth.uid() or public.is_admin());
create policy profiles_admin_update on public.profiles for update using(public.is_admin()) with check(public.is_admin());
create policy documents_select on public.documents for select using(public.can_view_document(id));
create policy documents_insert on public.documents for insert with check(created_by=auth.uid());
create policy documents_update on public.documents for update using(public.is_admin() or(created_by=auth.uid() and status='draft')) with check(public.is_admin() or created_by=auth.uid());
create policy shares_select on public.document_shares for select using(public.is_admin() or client_id=auth.uid() or exists(select 1 from public.documents d where d.id=document_id and d.created_by=auth.uid()));
create policy shares_admin_all on public.document_shares for all using(public.is_admin()) with check(public.is_admin());
create policy files_select on public.document_files for select using(public.can_view_document(document_id));
create policy files_insert on public.document_files for insert with check(created_by=auth.uid() and public.can_view_document(document_id));
create policy versions_select on public.document_versions for select using(public.can_view_document(document_id));
create policy versions_insert on public.document_versions for insert with check(created_by=auth.uid() and public.can_view_document(document_id));
create policy reviews_select on public.review_actions for select using(public.can_view_document(document_id)); create policy reviews_admin_insert on public.review_actions for insert with check(public.is_admin());
create policy issuances_select on public.issuances for select using(public.can_view_document(document_id)); create policy plans_owner_admin on public.plans for all using(public.is_admin() or owner_id=auth.uid()) with check(public.is_admin() or owner_id=auth.uid());
create policy notifications_own_select on public.notifications for select using(user_id=auth.uid()); create policy notifications_own_delete on public.notifications for delete using(user_id=auth.uid());
create policy audit_admin_select on public.audit_logs for select using(public.is_admin());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('documents','documents',false,5242880,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','image/png','image/jpeg']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy storage_read_authorized on storage.objects for select using(bucket_id='documents' and public.can_view_document(((storage.foldername(name))[1])::uuid));
create policy storage_insert_authorized on storage.objects for insert with check(bucket_id='documents' and public.can_view_document(((storage.foldername(name))[1])::uuid));
create policy storage_delete_authorized on storage.objects for delete using(bucket_id='documents' and (public.is_admin() or exists(select 1 from public.documents d where d.id=((storage.foldername(name))[1])::uuid and d.created_by=auth.uid() and d.status='draft')));

alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.documents;
alter publication supabase_realtime add table public.document_shares;

-- Run once after the admin has registered and verified email:
-- update public.profiles set role='admin' where email='phuonglong@lhu.edu.vn';
