-- Keep deleted documents in trash for 30 days, then permanently purge their rows.
-- Storage objects are still cleaned by the backend when users delete manually.

create or replace function public.purge_expired_deleted_documents()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  purged_count integer;
begin
  if to_regclass('storage.objects') is not null then
    delete from storage.objects o
    using public.documents d
    where d.deleted_at is not null
      and d.deleted_at < now() - interval '30 days'
      and o.bucket_id = 'documents'
      and o.name like d.id::text || '/%';
  end if;

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
