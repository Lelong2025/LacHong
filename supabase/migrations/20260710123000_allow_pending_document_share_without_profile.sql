alter table public.document_shares alter column client_id drop not null;
alter table public.document_shares alter column shared_with drop not null;
alter table public.document_shares alter column shared_by drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'document_shares_client_or_pending_chk'
  ) then
    alter table public.document_shares
      add constraint document_shares_client_or_pending_chk
      check (client_id is not null or nullif(btrim(pending_email), '') is not null)
      not valid;
  end if;
end $$;
