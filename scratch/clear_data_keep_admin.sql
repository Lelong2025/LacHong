-- Reset app data while keeping admin profiles.
-- Run this manually in Supabase SQL Editor after backing up production data.

begin;

do $$
begin
  -- App activity / notification data
  if to_regclass('public.notifications') is not null then
    delete from public.notifications;
  end if;

  if to_regclass('public.audit_logs') is not null then
    delete from public.audit_logs;
  end if;

  -- Document-related data
  if to_regclass('public.document_files') is not null then
    delete from public.document_files;
  end if;

  if to_regclass('public.document_versions') is not null then
    delete from public.document_versions;
  end if;

  if to_regclass('public.review_actions') is not null then
    delete from public.review_actions;
  end if;

  if to_regclass('public.issuances') is not null then
    delete from public.issuances;
  end if;

  if to_regclass('public.document_shares') is not null then
    delete from public.document_shares;
  end if;

  if to_regclass('public.documents') is not null then
    delete from public.documents;
  end if;

  -- Other app data
  if to_regclass('public.plans') is not null then
    delete from public.plans;
  end if;

  -- Keep only admin profiles in public.profiles.
  if to_regclass('public.profiles') is not null then
    delete from public.profiles
    where role <> 'admin'::public.app_role;
  end if;

  -- Keep only auth users that still have an admin profile.
  if to_regclass('auth.users') is not null then
    delete from auth.users u
    where not exists (
      select 1
      from public.profiles p
      where p.id = u.id
        and p.role = 'admin'::public.app_role
    );
  end if;
end $$;

commit;
