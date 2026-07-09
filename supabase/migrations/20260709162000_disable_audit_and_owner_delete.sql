drop policy if exists documents_update on public.documents;

create policy documents_update on public.documents
for update
using (
  public.is_active_user()
  and (
    public.is_admin()
    or created_by = auth.uid()
    or deleted_by = auth.uid()
  )
)
with check (
  public.is_active_user()
  and (
    public.is_admin()
    or created_by = auth.uid()
    or deleted_by = auth.uid()
  )
);

drop trigger if exists audit_documents on public.documents;
drop trigger if exists audit_shares on public.document_shares;
drop trigger if exists audit_files on public.document_files;
drop trigger if exists audit_reviews on public.review_actions;
drop trigger if exists audit_issuances on public.issuances;
drop trigger if exists audit_plans on public.plans;
drop trigger if exists audit_profiles on public.profiles;

drop function if exists public.audit_row_change();
drop function if exists public.log_login();
drop function if exists public.purge_expired_audit_logs();

do $$
begin
  if exists (
    select 1
    from pg_namespace n
    join pg_class c on c.relnamespace = n.oid
    where n.nspname = 'cron'
      and c.relname = 'job'
  ) then
    execute $cron$
      select cron.unschedule(jobid)
      from cron.job
      where jobname = 'purge-audit-logs-12-months'
    $cron$;
  end if;
exception
  when undefined_function then
    null;
end $$;
