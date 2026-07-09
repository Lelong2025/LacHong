alter table public.notifications
add column if not exists is_read boolean not null default false;

create index if not exists notifications_unread_user_idx
on public.notifications(user_id, created_at desc)
where is_read = false;

drop policy if exists notifications_own_update on public.notifications;
create policy notifications_own_update
on public.notifications
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function public.consume_notification(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  update public.notifications
  set is_read = true
  where id = p_id
    and user_id = auth.uid()
    and is_read = false;

  return found;
end $$;

create or replace function public.consume_all_notifications()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  n integer;
begin
  update public.notifications
  set is_read = true
  where user_id = auth.uid()
    and is_read = false;

  get diagnostics n = row_count;
  return n;
end $$;
