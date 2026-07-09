create or replace function public.can_view_document(doc_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select public.is_active_user()
    and (
      public.is_admin()
      or exists (
        select 1
        from public.documents d
        where d.id = doc_id
          and d.deleted_at is null
          and (
            d.created_by = auth.uid()
            or d.assignee_id = auth.uid()
            or exists (
              select 1
              from public.document_shares s
              where s.document_id = d.id
                and s.client_id = auth.uid()
                and s.revoked_at is null
            )
          )
      )
    )
$$;

create or replace function public.delete_document_permanently(p_document uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  if not exists (
    select 1
    from public.documents d
    where d.id = p_document
      and d.deleted_at is not null
      and (
        public.is_admin()
        or d.deleted_by = auth.uid()
        or d.created_by = auth.uid()
      )
  ) then
    raise exception 'Forbidden';
  end if;

  delete from storage.objects
  where bucket_id = 'documents'
    and (storage.foldername(name))[1] = p_document::text;

  delete from public.document_files where document_id = p_document;
  delete from public.document_versions where document_id = p_document;
  delete from public.review_actions where document_id = p_document;
  delete from public.issuances where document_id = p_document;
  delete from public.document_shares where document_id = p_document;
  delete from public.documents where id = p_document;

  return true;
end $$;

drop policy if exists documents_select on public.documents;
create policy documents_select
on public.documents
for select
using (
  public.can_view_document(id)
  or (
    public.is_active_user()
    and deleted_at is not null
    and (
      public.is_admin()
      or deleted_by = auth.uid()
      or created_by = auth.uid()
    )
  )
);
