# Mã nguồn App Kitting vật liệu (MM)

## Mở trong VS Code (lần đầu)
1. Giải nén `mm-source.zip` ra một thư mục, ví dụ `D:\mm-source`.
2. Cài **Node.js 22 LTS** (https://nodejs.org) nếu máy chưa có. Kiểm tra: mở Terminal gõ `node -v` (phải từ 22.13 trở lên).
3. VS Code → **File → Open Folder** → chọn thư mục `mm-source`.
4. VS Code hỏi cài extension đề xuất → bấm **Install** (Claude Code). Hoặc vào Extensions tìm "Claude Code" của Anthropic → Install → đăng nhập tài khoản Claude.
5. Mở Terminal trong VS Code (Ctrl + `) và chạy:
   ```
   npm install
   npm run all
   ```
   Thấy `built ... bytes lib` và `OK 3.xx MB` là được.

## Làm việc với Claude Code
- Mở khung Claude Code (biểu tượng Claude trên thanh bên). Claude **tự đọc file `CLAUDE.md`** nên đã biết dự án, quy tắc nghiệp vụ, cách build và deploy.
- Câu mở đầu gợi ý:
  > Đọc CLAUDE.md, tóm tắt lại cho tôi cấu trúc dự án và cách deploy, chưa sửa gì.
- Khi yêu cầu sửa, cứ nói như khi trao đổi trên Claude: "Thêm cột X vào bảng Y ở tab Sản xuất". Claude sẽ đề xuất trước, anh OK mới sửa.
- Copilot / Codex cũng đọc được bối cảnh qua `.github/copilot-instructions.md` và `AGENTS.md` (cùng nội dung với CLAUDE.md).

## Xem thử thay đổi
- `npm run demo` → mở file `mm/demo/Kitting_MM_ChayThu.html` bằng Chrome/Edge (tài khoản thử, mật khẩu `Kitting2026`).

## Đưa lên server
- Gói cài nằm ở `mm/pkg/mm-app` (đã build sẵn).
- Lần đầu: `mm/pkg/mm-app/setup.bat`. Các lần sau: `mm/pkg/mm-app/deploy.bat`, hoặc chép thư mục `mm/pkg/mm-app` lên `/home/ils_server/pocketbase/app_mm` rồi chạy `docker restart pb_mm_app`.
- Chi tiết: `mm/pkg/mm-app/HUONGDAN_MM.md`.

## Nếu VS Code đang kết nối thẳng server (Remote-SSH)
Server cần có Node.js 22 mới build được ngay trên server. Cách đơn giản hơn: build trên máy Windows rồi chép `mm/pkg/mm-app` lên server.
