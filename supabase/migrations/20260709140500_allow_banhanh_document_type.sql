do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.documents'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%type%'
    and pg_get_constraintdef(oid) like '%totrinh%'
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.documents drop constraint %I', constraint_name);
  end if;

  alter table public.documents
    add constraint documents_type_check
    check (type in ('totrinh','quyetdinh','khenthuong','baocao','kehoach','banhanh'));
end $$;
