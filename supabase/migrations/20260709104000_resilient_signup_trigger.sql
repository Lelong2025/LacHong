create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.profiles
  set email=email || '.orphan.' || replace(id::text,'-','') || '@local',
      updated_at=now()
  where email=new.email and id<>new.id;

  insert into public.profiles(id,email,full_name,role,is_active)
  values(
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name','')), ''),
    'client'::public.app_role,
    true
  )
  on conflict (id) do update set
    email=excluded.email,
    full_name=coalesce(excluded.full_name, public.profiles.full_name),
    role=coalesce(public.profiles.role, 'client'::public.app_role),
    is_active=coalesce(public.profiles.is_active, true),
    updated_at=now();

  return new;
exception when others then
  raise log 'handle_new_user failed for %: %', new.email, sqlerrm;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
