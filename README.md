# Hệ thống quản lý hồ sơ Lạc Hồng

React/Vite SPA chạy trên GitHub Pages, sử dụng Supabase Auth, PostgreSQL và Realtime. File hồ sơ mới được lưu trong Google Drive cá nhân của hệ thống.
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
- Deploy backend trong `backend/` lên Render; đặt `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_DRIVE_ACCOUNT_EMAIL`, `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN`, `FRONTEND_ORIGIN`, `PUBLIC_SITE_URL` và các biến SMTP trong Render Environment.
- Backend gửi email khi mời user hoặc khi user đã có tài khoản được thêm vào hồ sơ; hệ thống vẫn hiển thị thông báo qua bảng `notifications` và Supabase Realtime.
- File mới được upload một lần vào `_Hồ sơ gốc` trên Drive. Mỗi người thực hiện có thư mục `Tên (email)` chứa shortcut đến hồ sơ của họ, vì vậy hồ sơ nhiều người không làm nhân đôi dung lượng.
- `GOOGLE_DRIVE_ROOT_FOLDER_ID` là tùy chọn; nếu đặt, backend chỉ tạo thư mục bên trong thư mục Drive này.
- Bật Google Drive API trong Google Cloud, tạo OAuth Client và cấp offline access cho tài khoản `phuonglong@lhu.edu.vn` với scope `https://www.googleapis.com/auth/drive.file`. Có thể dùng OAuth 2.0 Playground với chính Client ID/Secret để lấy Refresh Token.
- Các biến Cloudinary cũ nên được giữ trong Render cho đến khi di chuyển hết file cũ. Backend vẫn tải/xóa được đường dẫn `cloudinary:` và file Supabase Storage cũ.

## Kiểm tra

```bash
npm run lint
npm run build
```
