create extension if not exists pg_cron with schema extensions;
select cron.schedule('purge-audit-logs-12-months','15 3 * * *',$$delete from public.audit_logs where occurred_at < now()-interval '12 months'$$)
where not exists(select 1 from cron.job where jobname='purge-audit-logs-12-months');
