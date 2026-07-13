create or replace function public.notify_admins(p_type text,p_title text,p_message text,p_data jsonb default '{}')
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.notifications(user_id,type,title,message,data)
  select id,p_type,p_title,p_message,p_data
  from public.profiles
  where role='admin' and is_active;
end $$;

create or replace function public.notify_document_watchers(p_document uuid,p_type text,p_title text,p_message text)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.notifications(user_id,type,title,message,data)
  select distinct user_id,p_type,p_title,p_message,jsonb_build_object('documentId',p_document)
  from (
    select created_by as user_id from public.documents where id=p_document
    union
    select client_id as user_id from public.document_shares where document_id=p_document and revoked_at is null
  ) recipients
  join public.profiles p on p.id=recipients.user_id and p.is_active;
end $$;

create or replace function public.notify_document_status_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op <> 'UPDATE' or new.status is not distinct from old.status then
    return new;
  end if;

  if new.status='submitted' then
    perform public.notify_admins(
      'document_submitted',
      'Hồ sơ chờ duyệt',
      new.title,
      jsonb_build_object('documentId',new.id,'type',new.type)
    );
  elsif new.status='approved' then
    perform public.notify_document_watchers(new.id,'document_approved','Hồ sơ đã được duyệt',new.title);
  elsif new.status='rejected' then
    perform public.notify_document_watchers(new.id,'document_rejected','Hồ sơ bị từ chối',new.title);
  elsif new.status='pending_issue' then
    perform public.notify_document_watchers(new.id,'document_pending_issue','Hồ sơ chờ Ban Hành',new.title);
  elsif new.status='issued' then
    perform public.notify_document_watchers(new.id,'document_issued','Hồ sơ đã được cấp số',coalesce(new.code,new.title));
  elsif new.status='archived' then
    perform public.notify_document_watchers(new.id,'document_archived','Hồ sơ đã lưu trữ',new.title);
  end if;

  return new;
end $$;

drop trigger if exists notify_document_status on public.documents;
create trigger notify_document_status
after update of status on public.documents
for each row execute function public.notify_document_status_change();

create or replace function public.issue_document(p_document uuid) returns public.issuances language plpgsql security definer set search_path=public as $$
declare n integer; y integer:=extract(year from now()); result public.issuances;
begin
  if not public.is_admin() then raise exception 'Forbidden'; end if;
  perform pg_advisory_xact_lock(y);
  select coalesce(max(number),0)+1 into n from public.issuances where year=y;
  insert into public.issuances(document_id,number,year,code,issued_by)
  values(p_document,n,y,lpad(n::text,3,'0')||'/LHU-'||y,auth.uid())
  returning * into result;
  update public.documents set status='issued',code=result.code,updated_at=now()
  where id=p_document and status='pending_issue';
  if not found then raise exception 'Document is not pending issue'; end if;
  return result;
end $$;
