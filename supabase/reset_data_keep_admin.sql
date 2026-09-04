-- Reset application data while preserving every admin profile and auth user.
-- Run manually in the Supabase SQL Editor after backing up any data you need.

begin;

do $$
begin
  if not exists (
    select 1
    from public.profiles
    where role = 'admin'::public.app_role
  ) then
    raise exception 'Reset cancelled: no admin profile was found';
  end if;
end $$;

-- Remove uploaded objects belonging to the application bucket first.
delete from storage.objects
where bucket_id = 'documents';

-- Remove dependent application data before profiles.
delete from public.notifications;
delete from public.audit_logs;
delete from public.document_files;
delete from public.document_versions;
delete from public.review_actions;
delete from public.issuances;
delete from public.document_shares;
delete from public.documents;
delete from public.plans;

-- Keep all admins; remove clients and any other non-admin profiles.
delete from public.profiles
where role <> 'admin'::public.app_role;

-- Remove auth users that do not have a preserved admin profile.
delete from auth.users as users
where not exists (
  select 1
  from public.profiles
  where profiles.id = users.id
    and profiles.role = 'admin'::public.app_role
);

commit;
