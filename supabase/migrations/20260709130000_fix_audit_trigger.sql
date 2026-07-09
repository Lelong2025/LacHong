-- Fix audit_row_change: bỏ điều kiện return sớm khi không tìm được profile
-- Thay vào đó vẫn ghi log với thông tin actor từ row_data nếu cần

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  row_data   jsonb;
  old_data   jsonb;
  audit_action public.audit_action;
  label      text;
  changed    text[] := '{}';
  actor_uuid uuid;
  actor_email_val text;
  actor_role_val  public.app_role;
begin
  row_data := to_jsonb(coalesce(new, old));
  old_data := to_jsonb(old);

  actor_uuid := auth.uid();
  if actor_uuid is null then
    actor_uuid := nullif(coalesce(
      row_data->>'created_by',
      row_data->>'actor_id',
      row_data->>'assigned_by',
      row_data->>'issued_by',
      row_data->>'owner_id',
      row_data->>'deleted_by'
    ), '')::uuid;
  end if;

  -- Lấy email/role từ profiles nếu có
  if actor_uuid is not null then
    select p.email, p.role
      into actor_email_val, actor_role_val
    from public.profiles p
    where p.id = actor_uuid;
  end if;

  -- Nếu vẫn không có actor → bỏ qua (system trigger, không phải user action)
  if actor_uuid is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    audit_action := 'CREATE';
  elsif (row_data->>'deleted_at') is not null
    and coalesce(old_data->>'deleted_at', '') = '' then
    audit_action := 'SOFT_DELETE';
  else
    audit_action := 'UPDATE';
    select array_agg(key order by key) into changed
    from jsonb_object_keys(row_data) as key
    where row_data->key is distinct from old_data->key
      and key not in ('updated_at');
  end if;

  label := coalesce(
    row_data->>'title',
    row_data->>'name',
    row_data->>'code',
    row_data->>'email',
    row_data->>'object_path',
    row_data->>'id',
    tg_table_name
  );

  insert into public.audit_logs(
    actor_id, actor_email, actor_role,
    table_name, record_id, object_name,
    action, summary
  ) values (
    actor_uuid,
    actor_email_val,
    actor_role_val,
    tg_table_name,
    coalesce(row_data->>'id', ''),
    label,
    audit_action,
    jsonb_build_object(
      'objectName',    label,
      'changedFields', coalesce(to_jsonb(changed), '[]'::jsonb),
      'description',
        case audit_action
          when 'CREATE'      then 'Tạo mới'
          when 'UPDATE'      then 'Sửa'
          when 'SOFT_DELETE' then 'Xóa'
          else 'Thao tác'
        end
    )
  );

  return coalesce(new, old);
end $$;
