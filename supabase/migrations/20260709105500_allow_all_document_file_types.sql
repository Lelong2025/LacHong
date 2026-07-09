update storage.buckets
set allowed_mime_types=null,
    file_size_limit=5242880,
    public=false
where id='documents';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('documents','documents',false,5242880,null)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=null;
