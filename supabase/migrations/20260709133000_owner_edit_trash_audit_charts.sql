-- Owners can edit their archived records, each user has their own soft-delete trash,
-- and deleted records are purged after 30 days.

drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents
for update
using (
  public.is_active_user()
  and (
    public.is_admin()
    or created_by = auth.uid()
    or deleted_by = auth.uid()
  )
)
with check (
  public.is_active_user()
  and (
    public.is_admin()
    or created_by = auth.uid()
    or deleted_by = auth.uid()
  )
);

create or replace function public.purge_expired_deleted_documents()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  purged_count integer;
begin
  with expired as (
    select id
    from public.documents
    where deleted_at is not null
      and deleted_at < now() - interval '30 days'
  ),
  deleted_files as (
    delete from public.document_files f
    using expired e
    where f.document_id = e.id
    returning f.id
  ),
  deleted_versions as (
    delete from public.document_versions v
    using expired e
    where v.document_id = e.id
    returning v.id
  ),
  deleted_reviews as (
    delete from public.review_actions r
    using expired e
    where r.document_id = e.id
    returning r.id
  ),
  deleted_issuances as (
    delete from public.issuances i
    using expired e
    where i.document_id = e.id
    returning i.id
  ),
  deleted_shares as (
    delete from public.document_shares s
    using expired e
    where s.document_id = e.id
    returning s.id
  ),
  deleted_docs as (
    delete from public.documents d
    using expired e
    where d.id = e.id
    returning d.id
  )
  select count(*) into purged_count from deleted_docs;

  return purged_count;
end $$;

create extension if not exists pg_cron with schema extensions;
select cron.schedule(
  'purge-deleted-documents-30-days',
  '35 3 * * *',
  $$select public.purge_expired_deleted_documents()$$
)
where not exists (
  select 1 from cron.job where jobname = 'purge-deleted-documents-30-days'
);

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
  actor_email_val text;
  actor_role_val public.app_role;
begin
  row_data := to_jsonb(coalesce(new, old));
  old_data := to_jsonb(old);

  actor_uuid := auth.uid();
  if actor_uuid is null then
    actor_uuid := nullif(coalesce(
      row_data->>'updated_by',
      row_data->>'deleted_by',
      row_data->>'created_by',
      row_data->>'actor_id',
      row_data->>'assigned_by',
      row_data->>'issued_by',
      row_data->>'owner_id'
    ), '')::uuid;
  end if;

  if actor_uuid is not null then
    select p.email, p.role
      into actor_email_val, actor_role_val
    from public.profiles p
    where p.id = actor_uuid;
  end if;

  actor_email_val := coalesce(
    actor_email_val,
    auth.jwt()->>'email',
    row_data->>'email',
    actor_uuid::text,
    'system'
  );
  actor_role_val := coalesce(actor_role_val, 'client'::public.app_role);

  if tg_op = 'INSERT' then
    audit_action := 'CREATE';
  elsif (row_data->>'deleted_at') is not null
    and coalesce(old_data->>'deleted_at', '') = '' then
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

  insert into public.audit_logs(
    actor_id, actor_email, actor_role,
    table_name, record_id, object_name,
    action, summary
  ) values (
    actor_uuid,
    actor_email_val,
    actor_role_val,
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
          else 'Thao tác'
        end
    )
  );

  return coalesce(new, old);
end $$;

drop trigger if exists audit_documents on public.documents;
create trigger audit_documents after insert or update on public.documents for each row execute function public.audit_row_change();

drop trigger if exists audit_shares on public.document_shares;
create trigger audit_shares after insert or update on public.document_shares for each row execute function public.audit_row_change();

drop trigger if exists audit_files on public.document_files;
create trigger audit_files after insert or update on public.document_files for each row execute function public.audit_row_change();
