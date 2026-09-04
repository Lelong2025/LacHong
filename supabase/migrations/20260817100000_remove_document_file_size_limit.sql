do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.document_files'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%size_bytes%'
  loop
    execute format('alter table public.document_files drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.document_files
  add constraint document_files_size_bytes_positive check (size_bytes > 0);

-- New files are stored in Google Drive, but keep the legacy bucket unrestricted
-- so older deployments do not retain the former 5 MiB setting.
update storage.buckets
set file_size_limit = null
where id = 'documents';
