alter table public.document_shares add column if not exists pending_email text;
alter table public.document_shares add column if not exists shared_with uuid references public.profiles(id);
alter table public.document_shares add column if not exists shared_by uuid references public.profiles(id);
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

drop index if exists public.document_shares_active_uq;

create unique index if not exists document_shares_active_client_uq
on public.document_shares(document_id, client_id)
where revoked_at is null and client_id is not null;

create unique index if not exists document_shares_active_pending_email_uq
on public.document_shares(document_id, lower(pending_email))
where revoked_at is null and pending_email is not null;

create index if not exists document_shares_pending_email_idx
on public.document_shares(lower(pending_email))
where revoked_at is null and pending_email is not null;

create or replace function public.refresh_document_assignee_names_for_profile(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_email text;
  v_full_name text;
  v_label text;
begin
  select email, full_name
  into v_email, v_full_name
  from public.profiles
  where id = p_profile_id;

  if v_email is null or nullif(btrim(v_email), '') is null then
    return;
  end if;

  v_label := case
    when nullif(btrim(coalesce(v_full_name, '')), '') is null then v_email
    else btrim(v_full_name) || ' (' || v_email || ')'
  end;

  update public.documents d
  set assignee_name = rebuilt.assignee_name,
      updated_at = coalesce(d.updated_at, now())
  from (
    select
      d2.id,
      string_agg(
        case
          when lower(coalesce(substring(token.value from '\(([^()]+@[^()]+)\)\s*$'), token.value)) = lower(v_email)
            then v_label
          else token.value
        end,
        ', '
        order by parts.ordinality
      ) as assignee_name
    from public.documents d2
    cross join lateral unnest(string_to_array(coalesce(d2.assignee_name, ''), ',')) with ordinality as parts(raw_value, ordinality)
    cross join lateral (select btrim(parts.raw_value) as value) as token
    where d2.assignee_name is not null
    group by d2.id
  ) as rebuilt
  where d.id = rebuilt.id
    and exists (
      select 1
      from unnest(string_to_array(coalesce(d.assignee_name, ''), ',')) as raw(raw_value)
      cross join lateral (select btrim(raw.raw_value) as value) as token
      where lower(coalesce(substring(token.value from '\(([^()]+@[^()]+)\)\s*$'), token.value)) = lower(v_email)
    );
end $$;

create or replace function public.claim_pending_document_shares_for_profile(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_email text;
begin
  select email
  into v_email
  from public.profiles
  where id = p_profile_id
    and is_active;

  if v_email is null or nullif(btrim(v_email), '') is null then
    return;
  end if;

  update public.document_shares pending
  set revoked_at = now()
  from public.document_shares active
  where pending.client_id is null
    and pending.revoked_at is null
    and pending.pending_email is not null
    and lower(pending.pending_email) = lower(v_email)
    and active.document_id = pending.document_id
    and active.client_id = p_profile_id
    and active.revoked_at is null;

  update public.document_shares
  set client_id = p_profile_id,
      shared_with = coalesce(shared_with, p_profile_id),
      pending_email = null
  where client_id is null
    and revoked_at is null
    and pending_email is not null
    and lower(pending_email) = lower(v_email);

  perform public.refresh_document_assignee_names_for_profile(p_profile_id);
end $$;

create or replace function public.ensure_current_profile()
returns public.profiles
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles;
  v_email text;
  v_full_name text;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized';
  end if;

  v_email := lower(nullif(btrim(coalesce(auth.jwt()->>'email', '')), ''));
  v_full_name := nullif(btrim(coalesce(auth.jwt()->'user_metadata'->>'full_name', '')), '');

  if v_email is null then
    raise exception 'Missing email';
  end if;

  update public.profiles
  set email = email || '.orphan.' || replace(id::text, '-', '') || '@local',
      updated_at = now()
  where email = v_email
    and id <> auth.uid();

  insert into public.profiles(id, email, full_name, role, is_active)
  values(auth.uid(), v_email, v_full_name, 'client'::public.app_role, true)
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    role = coalesce(public.profiles.role, 'client'::public.app_role),
    is_active = coalesce(public.profiles.is_active, true),
    updated_at = now()
  returning * into v_profile;

  perform public.claim_pending_document_shares_for_profile(v_profile.id);

  return v_profile;
end $$;

grant execute on function public.ensure_current_profile() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  update public.profiles
  set email = email || '.orphan.' || replace(id::text, '-', '') || '@local',
      updated_at = now()
  where email = new.email
    and id <> new.id;

  insert into public.profiles(id, email, full_name, role, is_active)
  values(
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''),
    'client'::public.app_role,
    true
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    role = coalesce(public.profiles.role, 'client'::public.app_role),
    is_active = coalesce(public.profiles.is_active, true),
    updated_at = now();

  perform public.claim_pending_document_shares_for_profile(new.id);

  return new;
exception when others then
  raise log 'handle_new_user failed for %: %', new.email, sqlerrm;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.claim_pending_document_shares_on_profile_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.claim_pending_document_shares_for_profile(new.id);
    return new;
  end if;

  if new.email is distinct from old.email
    or new.full_name is distinct from old.full_name
    or new.is_active is distinct from old.is_active then
    perform public.claim_pending_document_shares_for_profile(new.id);
  end if;

  return new;
end $$;

drop trigger if exists claim_pending_document_shares_on_profile_change on public.profiles;
create trigger claim_pending_document_shares_on_profile_change
after insert or update of email, full_name, is_active on public.profiles
for each row execute function public.claim_pending_document_shares_on_profile_change();

create or replace function public.can_view_document(doc_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select public.is_active_user()
    and (
      public.is_admin()
      or exists (
        select 1
        from public.documents d
        where d.id = doc_id
          and d.deleted_at is null
          and (
            d.created_by = auth.uid()
            or d.assignee_id = auth.uid()
            or exists (
              select 1
              from public.document_shares s
              where s.document_id = d.id
                and s.revoked_at is null
                and (
                  s.client_id = auth.uid()
                  or lower(s.pending_email) = lower((select p.email from public.profiles p where p.id = auth.uid()))
                )
            )
          )
      )
    )
$$;

drop policy if exists shares_select on public.document_shares;
create policy shares_select
on public.document_shares
for select
using (
  public.is_active_user()
  and (
    public.is_admin()
    or client_id = auth.uid()
    or lower(pending_email) = lower((select p.email from public.profiles p where p.id = auth.uid()))
    or exists(select 1 from public.documents d where d.id = document_id and d.created_by = auth.uid())
  )
);

drop policy if exists documents_select on public.documents;
create policy documents_select
on public.documents
for select
using (
  public.can_view_document(id)
  or (
    public.is_active_user()
    and deleted_at is not null
    and (
      public.is_admin()
      or deleted_by = auth.uid()
      or created_by = auth.uid()
    )
  )
);
