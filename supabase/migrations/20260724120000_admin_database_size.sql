create or replace function public.admin_database_size_bytes()
returns bigint
language sql
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(sum(pg_database_size(datname)), 0)::bigint
  from pg_database
  where not datistemplate;
$$;

revoke all on function public.admin_database_size_bytes() from public;
revoke all on function public.admin_database_size_bytes() from anon;
revoke all on function public.admin_database_size_bytes() from authenticated;
grant execute on function public.admin_database_size_bytes() to service_role;
 