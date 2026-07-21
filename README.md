# Hệ thống quản lý hồ sơ Lạc Hồng

React/Vite SPA chạy trên GitHub Pages, sử dụng Supabase Auth, PostgreSQL và Realtime. File hồ sơ mới được lưu riêng tư trên Cloudinary.
Backend riêng trong `backend/` dùng cho tác vụ cần secret như invite user và gửi email thông báo.

## Chạy local

1. Điền `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_BACKEND_URL` trong `.env`.
2. Chạy `npm install` và `npm run dev`.
3. Liên kết Supabase CLI rồi chạy `supabase db push`.
4. Đăng ký, xác minh `phuonglong@lhu.edu.vn`, sau đó cấp quyền một lần:

```sql
update public.profiles set role='admin' where email='phuonglong@lhu.edu.vn';
```

Không lưu mật khẩu admin trong source hoặc migration.

## Production

- Thêm GitHub secrets `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_BACKEND_URL`.
- Cấu hình Supabase Auth Site URL, redirect URL, email confirmation và Custom SMTP trong Supabase Dashboard nếu cần gửi email xác minh/quên mật khẩu.
- Deploy backend trong `backend/` lên Render; đặt `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `FRONTEND_ORIGIN`, `PUBLIC_SITE_URL` và các biến SMTP trong Render Environment.
- Backend gửi email khi mời user hoặc khi user đã có tài khoản được thêm vào hồ sơ; hệ thống vẫn hiển thị thông báo qua bảng `notifications` và Supabase Realtime.
- Bucket Supabase private `documents` chỉ còn được dùng để đọc và xóa các file cũ. File upload mới dùng loại `authenticated` của Cloudinary và chỉ được tải qua backend sau khi kiểm tra quyền.

## Kiểm tra

```bash
npm run lint
npm run build
```
