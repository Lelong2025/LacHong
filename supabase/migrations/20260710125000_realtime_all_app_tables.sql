do $$
declare
  table_name text;
  tables text[] := array[
    'profiles',
    'documents',
    'document_shares',
    'document_files',
    'document_versions',
    'review_actions',
    'issuances',
    'plans',
    'notifications',
    'audit_logs'
  ];
begin
  foreach table_name in array tables loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I replica identity full', table_name);

      begin
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      exception
        when duplicate_object then null;
        when undefined_object then null;
      end;
    end if;
  end loop;
end $$;
