alter table public.document_files add column if not exists created_by uuid references public.profiles(id);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'document_files'
      and column_name = 'uploaded_by'
  ) then
    update public.document_files
    set created_by = coalesce(created_by, uploaded_by)
    where created_by is null;

    update public.document_files
    set uploaded_by = coalesce(uploaded_by, created_by)
    where uploaded_by is null;

    alter table public.document_files alter column uploaded_by drop not null;
  end if;
end $$;
