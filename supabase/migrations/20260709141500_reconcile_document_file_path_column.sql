alter table public.document_files add column if not exists object_path text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'document_files'
      and column_name = 'file_path'
  ) then
    update public.document_files
    set object_path = coalesce(object_path, file_path)
    where object_path is null;

    update public.document_files
    set file_path = coalesce(file_path, object_path)
    where file_path is null;

    alter table public.document_files alter column file_path drop not null;
  end if;
end $$;

update public.document_files
set object_path = coalesce(object_path, id::text)
where object_path is null;

alter table public.document_files alter column object_path set not null;
