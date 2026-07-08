# Hệ thống quản lý hồ sơ Lạc Hồng

React/Vite SPA chạy trên GitHub Pages, sử dụng Supabase Auth, PostgreSQL, Storage và Realtime.

## Chạy local

1. Điền `VITE_SUPABASE_URL` và `VITE_SUPABASE_PUBLISHABLE_KEY` trong `.env`.
2. Chạy `npm install` và `npm run dev`.
3. Liên kết Supabase CLI rồi chạy `supabase db push`.
4. Đăng ký, xác minh `phuonglong@lhu.edu.vn`, sau đó cấp quyền một lần:

```sql
update public.profiles set role='admin' where email='phuonglong@lhu.edu.vn';
```

Không lưu mật khẩu admin trong source hoặc migration.

## Production

- Thêm GitHub secrets `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Cấu hình Supabase Auth Site URL, email confirmation và Brevo Custom SMTP.
- Deploy Edge Function `send-business-email`; đặt `BREVO_API_KEY`, `MAIL_FROM`, `WEBHOOK_SECRET`.
- Cấu hình Database Webhook gọi Edge Function cho các email nghiệp vụ.
- Migrations tạo bucket private `documents`, RLS, Realtime và cron dọn audit.

## Kiểm tra

```bash
npm run lint
npm run build
```
