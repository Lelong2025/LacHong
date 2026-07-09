alter table public.documents add column if not exists assignee_name text;
alter table public.documents add column if not exists document_year integer;

alter table public.document_files add column if not exists file_kind text not null default 'attachment';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname='documents_document_year_check'
      and conrelid='public.documents'::regclass
  ) then
    alter table public.documents
    add constraint documents_document_year_check
    check(document_year is null or document_year between 2000 and 2100);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname='document_files_file_kind_check'
      and conrelid='public.document_files'::regclass
  ) then
    alter table public.document_files
    add constraint document_files_file_kind_check
    check(file_kind in ('attachment','issued_attachment'));
  end if;
end $$;
