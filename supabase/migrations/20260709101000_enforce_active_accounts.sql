create or replace function public.current_role()
returns public.app_role language sql stable security definer set search_path=public as $$
  select coalesce((select role from public.profiles where id=auth.uid()),'client'::public.app_role)
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and is_active)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public as $$
  select public.current_role()='admin' and public.is_active_user()
$$;

create or replace function public.can_view_document(doc_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_active_user() and (
    public.is_admin()
    or exists(
      select 1
      from public.documents d
      where d.id=doc_id
        and d.deleted_at is null
        and (
          d.created_by=auth.uid()
          or exists(
            select 1
            from public.document_shares s
            where s.document_id=d.id
              and s.client_id=auth.uid()
              and s.revoked_at is null
          )
        )
    )
  )
$$;

drop policy if exists documents_insert on public.documents;
drop policy if exists documents_update on public.documents;
drop policy if exists shares_select on public.document_shares;
drop policy if exists files_insert on public.document_files;
drop policy if exists versions_insert on public.document_versions;
drop policy if exists plans_owner_admin on public.plans;

create policy documents_insert on public.documents
for insert with check(public.is_active_user() and created_by=auth.uid());

create policy documents_update on public.documents
for update using(public.is_active_user() and (public.is_admin() or (created_by=auth.uid() and status='draft')))
with check(public.is_active_user() and (public.is_admin() or created_by=auth.uid()));

create policy shares_select on public.document_shares
for select using(
  public.is_active_user()
  and (
    public.is_admin()
    or client_id=auth.uid()
    or exists(select 1 from public.documents d where d.id=document_id and d.created_by=auth.uid())
  )
);

create policy files_insert on public.document_files
for insert with check(created_by=auth.uid() and public.can_view_document(document_id));

create policy versions_insert on public.document_versions
for insert with check(created_by=auth.uid() and public.can_view_document(document_id));

create policy plans_owner_admin on public.plans
for all using(public.is_active_user() and (public.is_admin() or owner_id=auth.uid()))
with check(public.is_active_user() and (public.is_admin() or owner_id=auth.uid()));
