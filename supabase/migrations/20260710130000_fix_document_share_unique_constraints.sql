do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'document_shares_document_id_shared_with_key'
      and conrelid = 'public.document_shares'::regclass
  ) then
    alter table public.document_shares
      drop constraint document_shares_document_id_shared_with_key;
  end if;
end $$;

drop index if exists public.document_shares_document_id_shared_with_key;

create unique index if not exists document_shares_active_shared_with_uq
on public.document_shares(document_id, shared_with)
where revoked_at is null and shared_with is not null;

create unique index if not exists document_shares_active_client_uq
on public.document_shares(document_id, client_id)
where revoked_at is null and client_id is not null;

create unique index if not exists document_shares_active_pending_email_uq
on public.document_shares(document_id, lower(pending_email))
where revoked_at is null and pending_email is not null;
