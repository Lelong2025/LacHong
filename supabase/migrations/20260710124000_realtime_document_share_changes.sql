alter table public.documents replica identity full;
alter table public.document_shares replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.documents;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.document_shares;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
