# Kế hoạch hệ thống Lạc Hồng (Phiên bản Tối ưu 100% Miễn Phí)

> [!NOTE]
> Bản kế hoạch này đã được cấu trúc lại để loại bỏ hoàn toàn các dịch vụ yêu cầu trả phí (như Render paid always-on). Hệ thống sẽ chuyển sang mô hình **BaaS (Backend-as-a-Service)**, sử dụng tối đa hệ sinh thái miễn phí của Supabase.

## 1. Kiến trúc (Mới)
*   **Frontend:** React + Vite + TypeScript, giao tiếp trực tiếp với Supabase qua `supabase-js`. Deploy miễn phí trên **GitHub Repo Pages**.
*   **Backend & Cơ sở dữ liệu:** Không dùng NestJS. Sử dụng **Supabase** (PostgreSQL, Auth, Storage, Realtime, Edge Functions).
*   **Bảo mật API:** Dựa hoàn toàn vào **PostgreSQL Row Level Security (RLS)** để thay thế cho NestJS Authorization.
*   **Email:** Brevo được cấu hình Custom SMTP trong Supabase Auth và thông qua Supabase Edge Functions / Database Webhooks.
*   **Hosting Configuration:** GitHub Pages chứa publishable key; không cần server riêng biệt. Dùng HashRouter và Vite base: `"/LacHong/"`.

## 2. Xác thực và phân quyền
*   **Chỉ có hai vai trò:** 
    *   `admin`: toàn quyền người dùng, hồ sơ, duyệt, ban hành, lưu trữ, thống kê và cấu hình.
    *   `client`: tạo và quản lý hồ sơ của chính mình; xem hồ sơ được admin chia sẻ.
*   **Đăng ký & Gán quyền:** Cho phép đăng ký công khai. Mọi tài khoản mới luôn được gán role `client` thông qua **PostgreSQL Database Trigger** ngay khi user được tạo trong Auth, không nhận role từ request.
*   Client phải xác minh email qua Brevo trước khi đăng nhập (Supabase xử lý tự động).
*   **Admin Bootstrap:** Admin có email `phuonglong@lhu.edu.vn`.
    *   Sử dụng Supabase Seed Data hoặc một SQL script chạy thủ công (chạy 1 lần) để cấp quyền admin cho email này. 
    *   Mật khẩu không hardcode, người dùng tự tạo mật khẩu mạnh ngay từ đầu hoặc qua luồng Forgot Password.
*   **Xác thực:** RLS của Supabase kiểm tra trực tiếp JWT token và bảng `profiles` để quyết định quyền truy cập (thay vì NestJS).

## 3. Nghiệp vụ (Giữ nguyên luồng, thay đổi cách gọi)
*   Hiện thực toàn bộ giao diện trong `Design/`.
*   **Luồng hồ sơ:** `draft` → `submitted` → `approved/rejected` → `pending_issue` → `issued` → `archived`.
*   **Client:** Tạo, sửa, xóa nháp. Gửi duyệt. Theo dõi trạng thái. Không sửa khi đang duyệt/đã ban hành.
*   **Admin:** Duyệt, cấp số, ban hành, khóa/mở tài khoản client.
*   **Lưu trữ (Storage):** File PDF, DOCX, v.v. (giới hạn < 5MB để tiết kiệm 1GB Supabase Storage quota). Truy cập bằng signed URL sinh từ client.
*   **Cấp số chống trùng:** Dùng **PostgreSQL Stored Procedure (RPC)** với giao dịch (transaction) để đảm bảo tính nguyên vẹn và cấp số duy nhất.

## 4. Dữ liệu và API (Mới)
*   **Các bảng chính:** `profiles`, `documents`, `document_versions`, `document_files`, `document_shares`, `review_actions`, `issuances`, `plans`, `notifications`, `audit_logs`.
*   `profiles.role` chỉ nhận `admin|client`, mặc định `client`.
*   **REST API:** Bỏ NestJS API. Frontend dùng `supabase-js` để query trực tiếp dữ liệu.
*   **Bảo mật bằng RLS:** Viết các policy nghiêm ngặt trong Postgres. Ví dụ: *Client chỉ được SELECT bảng documents nếu id của họ nằm trong trường created_by*.
*   **Audit log:** Sử dụng Database Trigger (hễ bảng documents có thay đổi thì trigger tự động insert vào bảng audit_logs).

## 5. Realtime và Email (Mới)
*   **Realtime:** Dùng **Supabase Realtime (Postgres Changes)** thay cho Socket.IO.
*   Frontend subscribe trực tiếp vào các bảng `notifications` và `documents`.
*   **Kênh (Rooms):** RLS kết hợp với Realtime sẽ đảm bảo client chỉ nhận được bản tin (payload) của chính họ. Admin nhận được toàn bộ.
*   **Gửi Email Nghiệp Vụ:** 
    *   Khi có sự kiện (ví dụ: hồ sơ chuyển sang `submitted`), một Database Trigger sẽ gọi một **Supabase Edge Function** (hoặc Webhook) để tương tác với API của Brevo và gửi email. Hệ thống Edge Functions miễn phí 500k lần gọi/tháng, không bị tình trạng "ngủ đông" chậm như Render.

## 6. Triển khai và kiểm thử
*   **Deploy:** GitHub Actions chạy lint, type-check, test, build rồi deploy Pages. Database migrations chạy qua Supabase CLI (`supabase db push`).
*   **Test bắt buộc:**
    *   RLS chặn người dùng đọc chéo hồ sơ.
    *   Trigger gán đúng role client khi đăng ký.
    *   RPC cấp số hoạt động chính xác khi có 2 request đồng thời.
    *   Upload file sai loại bị từ chối (bằng Supabase Storage rules).

## 7. Giả định
*   Không còn mô hình bốn vai trò; admin làm tất cả.
*   Client chỉ thấy hồ sơ của mình/được chia sẻ.
*   V1 chưa có SSO LHU, VNeID, Zalo.

---
