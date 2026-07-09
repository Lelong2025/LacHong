alter table public.documents add column if not exists assignee_id uuid references public.profiles(id);

create or replace function public.search_assignees(p_query text default '')
returns table(id uuid,email text,full_name text)
language sql stable security definer set search_path=public as $$
  select p.id,p.email,p.full_name
  from public.profiles p
  where p.is_active
    and (p_query='' or p.email ilike '%'||p_query||'%' or coalesce(p.full_name,'') ilike '%'||p_query||'%')
  order by coalesce(p.full_name,p.email)
  limit 8
$$;

create or replace function public.can_view_document(doc_id uuid) returns boolean language sql stable security definer set search_path=public as $$
  select public.is_active_user() and (
    public.is_admin()
    or exists(
      select 1
      from public.documents d
      where d.id=doc_id
        and d.deleted_at is null
        and (
          d.created_by=auth.uid()
          or d.assignee_id=auth.uid()
          or exists(select 1 from public.document_shares s where s.document_id=d.id and s.client_id=auth.uid() and s.revoked_at is null)
        )
    )
  )
$$;

create or replace function public.notify_assignee_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.assignee_id is not null and (tg_op='INSERT' or new.assignee_id is distinct from old.assignee_id) then
    insert into public.notifications(user_id,type,title,message,data)
    values(
      new.assignee_id,
      'document_assigned',
      'Bạn được giao hồ sơ',
      new.title,
      jsonb_build_object('documentId',new.id,'type',new.type)
    );
  end if;
  return new;
end $$;

drop trigger if exists notify_document_assignee on public.documents;
create trigger notify_document_assignee
after insert or update of assignee_id on public.documents
for each row execute function public.notify_assignee_change();
