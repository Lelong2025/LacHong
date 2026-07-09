alter table public.document_files add column if not exists name text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'document_files'
      and column_name = 'file_name'
  ) then
    update public.document_files
    set name = coalesce(name, file_name)
    where name is null;

    update public.document_files
    set file_name = coalesce(file_name, name)
    where file_name is null;

    alter table public.document_files alter column file_name drop not null;
  end if;
end $$;

update public.document_files
set name = coalesce(name, object_path)
where name is null;

alter table public.document_files alter column name set not null;
