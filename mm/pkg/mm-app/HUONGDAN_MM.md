# App Kitting vật liệu (MM) trên PocketBase — hướng dẫn triển khai

App riêng (chế độ A): thư mục `app_mm`, container `pb_mm_app`, cổng **8097**, database và superuser riêng. App không đụng tới ORG, EQM, MGT.

| | |
|---|---|
| Server | `192.168.1.221`, thư mục `/home/ils_server/pocketbase/app_mm/` |
| Trong mạng LAN | `http://192.168.1.221:8097/` |
| Ra ngoài | hostname riêng, ví dụ `mm.il-sungtech.com` (bước 6) |
| Đăng nhập | Mã nhân viên + mật khẩu (từ 8 ký tự, có chữ và số) |
| Dữ liệu | bắt đầu trống, nhập BOM + PO thật từ file Excel |

## 1. Cài đặt lần đầu: nháy đúp `setup.bat`

Giải nén gói ra một thư mục trên máy Windows trong mạng LAN nhà máy, rồi nháy đúp **`setup.bat`**. Script làm 5 bước, bước nào lỗi thì dừng và in rõ lý do:

| Bước | Việc |
|---|---|
| 1/5 | Kiểm tra WinSCP trên máy. Chưa có thì tự cài bằng `winget`. |
| 2/5 | Kiểm tra máy kết nối được server `192.168.1.221`. |
| 3/5 | Hỏi thông tin: email + mật khẩu **superuser** PocketBase (≥ 10 ký tự), **Mã NV + mật khẩu** của tài khoản Quản trị app đầu tiên. Mật khẩu nhập ẩn. |
| 4/5 | Vào server: **kiểm tra sẵn sàng** (docker, docker compose, file `pocketbase` 0.40.4 ở `app_org`, cổng 8097 còn trống, ổ đĩa ≥ 1 GB, curl). Không đạt thì dừng, **chưa cài gì**. Đạt thì đẩy file, dựng container `pb_mm_app`, tạo khóa API, tạo superuser và tài khoản Quản trị app. |
| 5/5 | Gọi thử app từ chính máy này, rồi mở trình duyệt vào `http://192.168.1.221:8097/`. |

Lưu ý:
- WinSCP hỏi mật khẩu SSH của `ils_server` thì nhập vào.
- Mật khẩu superuser không dùng các ký tự `' " $ \ % ! & | < > ^`.
- **Khóa API** in ở dòng `Khoa API day PO (X-MM-Key): ...`. Ghi lại để dùng cho công cụ đẩy PO tự động (mục 5).
- Thông tin tài khoản được ghi tạm vào file `mm_init.env`, đẩy lên server, đọc xong **xóa ngay** ở cả hai đầu.
- Chạy lại `setup.bat` nhiều lần vẫn an toàn: dữ liệu giữ nguyên, tài khoản app đã có thì không đổi mật khẩu.
- Nhật ký chi tiết nằm ở file `setup.log` cạnh `setup.bat`.

Cuối màn hình cần thấy:
```
=== KIEM TRA DAT ===
=== Trang thai container: healthy ===
  [OK]   Superuser PocketBase: ...
  [OK]   Tai khoan Quan tri app: Ma NV ...
  [INFO] Khoa API day PO (X-MM-Key): ...
  [OK] PocketBase tra loi ...
  [OK] App Kitting da nap ...
```

Nếu bước kiểm tra báo `[LOI]`:

| Lỗi | Cách sửa |
|---|---|
| User không chạy được `docker ps` | Trên server: `sudo usermod -aG docker ils_server`, đăng xuất SSH rồi chạy lại |
| Cổng 8097 đang bị dùng | Sửa `MM_PORT` trong `env.default` (ví dụ 8098) rồi chạy lại |
| Không thấy file `pocketbase` | Kiểm tra `/home/ils_server/pocketbase/app_org/pocketbase` còn không |
| Container chưa healthy | Xem lỗi: `docker logs pb_mm_app --tail 60` |

## 2. Nếu cần làm tay

- Tạo lại superuser: `docker exec pb_mm_app /pb/pocketbase superuser upsert EMAIL MATKHAU`
- Tạo tài khoản Quản trị app: trang Admin `http://192.168.1.221:8097/_/` → Collections → **users** → New record: `username` = Mã NV IN HOA, `password` = mật khẩu từ 8 ký tự có chữ và số, `role` = `admin`, bật `active`, để trống `email`.
- Chỉ đẩy file và dựng lại container (không hỏi tài khoản): chạy `deploy.bat`.

## 3. Các vai trò trong app

| Vai trò | Dùng để |
|---|---|
| Quản trị | Mọi chức năng, tài khoản, thông số, Line |
| Planner | Kế hoạch kitting, PO, BOM, Line & tham số |
| Kho | Hàng chờ, điều phối, kitting, giao Line, nợ, cấp vật liệu |
| OP kitting kho | Chỉ màn **Kitting** (tablet) và in phiếu |
| Line | Tab Sản xuất, xin PO / vật liệu |
| Cấp duyệt | Duyệt yêu cầu ngoại lệ |

Các tài khoản sau tạo ngay trong app: tab **Quản trị → Tài khoản**.

## 3b. Mật khẩu (bản cập nhật 02/11 — thay PIN)

- Đăng nhập bằng **Mã NV + mật khẩu**: 8–64 ký tự, có cả chữ và số. Ô mật khẩu có nút 👁 để xem lại.
- Tài khoản tạo trước bản cập nhật (đang dùng PIN): vẫn đăng nhập bằng PIN cũ **một lần**, app bắt đặt mật khẩu mới rồi mới cho vào.
- Quản trị tạo tài khoản hoặc bấm **Đặt mật khẩu** cho người khác → đó là mật khẩu tạm, người dùng phải đổi ở lần đăng nhập tới.
- Ai cũng tự đổi được: bấm vào **tên mình** ở góc trên bên phải.
- Cập nhật server đang chạy: chép gói mới lên (VS Code hoặc `deploy.bat`) rồi `docker restart pb_mm_app`. Migration `1793700000_mm_password.js` tự chạy, dữ liệu giữ nguyên.

## 4. Đưa vào dùng

1. Mở `http://192.168.1.221:8097/` và đăng nhập bằng tài khoản vừa tạo.
2. **Quản trị**: thêm Line; kiểm tra ngưỡng cấp (200), Min/Max PO VLN chờ cấp (1/3); tạo tài khoản theo vai trò.
3. **BOM & Model → Nhập file BOM**: file có sheet `BOM` gồm các cột Model, Model code, Material, Description, Point, Công đoạn, Nhóm kitting. Sheet `Bom code` và `BOM VLN` có thì app đọc thêm.
4. **Dữ liệu PO → Nhập file**: file Production Plan by Order (Plan Master). File được đọc ngay trên máy hoặc điện thoại rồi gửi lên server.
5. **Line & tham số**: khai Line chạy Model nào theo tuần, rải chuyền, pending, **UPH** (sản lượng/giờ) theo Line + Model để tab Sản xuất tính số giờ còn việc.
6. Tài khoản Leader Line: chọn **Line phụ trách** để mở app là vào đúng Line của mình ở tab Sản xuất.

## 5. Đẩy PO tự động (công cụ truyền dữ liệu)

```
POST http://192.168.1.221:8097/api/mmx/po      (hoặc https://mm.il-sungtech.com/api/mmx/po)
Header: X-MM-Key: <MM_API_KEY trong file .env trên server>
Content-Type: application/json
{
  "source": "Plan Master 01/11 ca ngày",
  "fullSnapshot": true,
  "rows": [
    { "po": "11075193960", "planDate": "2026-11-03", "masterLine": "ILS_BLOCK3C 01", "basicModel": "BSM-F731B/256",
      "modelCode": "GH96-15938A", "planQty": 960, "productionQty": 0, "remainQty": 960,
      "planStatus": "Planned", "planStart": "2026-11-03T08:00", "planEnd": "", "poChange": "", "pendingType": "" }
  ]
}
```

- Bắt buộc có `po` và `modelCode`. Các trường số để trống thì tính là 0.
- `fullSnapshot: true` nghĩa là gửi đủ toàn bộ kế hoạch: PO nào không có trong lần gửi sẽ bị đánh dấu "không còn trong nguồn". Chỉ gửi một phần thì đặt `false`.
- Kết quả trả về: `{ ok, total, inserted, updated, missing, changedModel }`. Sai khóa trả mã 401.
- Muốn đổi khóa: sửa `MM_API_KEY` trong `.env` trên server, rồi chạy `docker compose up -d` trong `app_mm`.

## 6. Mở ra ngoài qua Cloudflare

1. Trên tunnel Cloudflare, thêm **hostname riêng** `mm.il-sungtech.com` → `http://localhost:8097`. Không dùng path-routing chung hostname.
2. Trang Admin → Settings:
   - **Application URL** = `https://mm.il-sungtech.com`;
   - bật **IP proxy headers**, khai `CF-Connecting-IP`. Nếu thiếu bước này, cả xưởng bị tính chung một IP khi giới hạn tần suất đăng nhập.
3. Trang portal `pocketbase.il-sungtech.com` có thể thêm link sang `https://mm.il-sungtech.com/`.

## 7. Kiểm tra sau khi chạy

1. Cuối log có `healthy`.
2. Trang Admin → Collections có `users` (thêm các trường username, role, active) và `mm_events` (1 bản ghi).
3. Mở `http://192.168.1.221:8097/` thấy màn hình đăng nhập "Mã nhân viên / Mật khẩu". Khi chưa có tài khoản, màn hình hiện ghi chú hướng dẫn tạo.
4. Đăng nhập admin → Quản trị → tạo 1 tài khoản Planner → đăng nhập Planner → nhập BOM và PO thử.
5. Mở app trên 2 máy: Kho bấm Cấp / Giao ở máy này thì màn hình máy kia tự cập nhật sau khoảng 1 giây.
6. Sai mật khẩu 5 lần thì Mã NV đó bị khóa đăng nhập 15 phút.
7. Đăng nhập ORG, EQM, MGT như bình thường để chắc các app cũ không bị ảnh hưởng.

## 8. Cập nhật lần sau

Thay file trong gói rồi nháy đúp `deploy.bat` (không hỏi tài khoản, không đụng dữ liệu). Lệnh `synchronize` không xóa file trên server, và `.env` không bao giờ bị ghi đè.

## 9. Sao lưu & khôi phục

- Trang Admin → Settings → **Backups** → Initialize new backup. Bản sao lưu gồm toàn bộ `pb_data`, kể cả bảng nghiệp vụ.
- Bảng nghiệp vụ (PO, kit, BOM, yêu cầu cấp…) là bảng SQLite riêng, quản lý qua app, **không hiện trong Collections**. Đây là chủ ý, để giữ nguyên nghiệp vụ đã test.
- Nếu container không lên sau khi cập nhật, xem lỗi bằng:
  ```
  docker logs pb_mm_app --tail 60
  ```
  Bỏ file lỗi vừa thêm trong `pb_hooks` / `pb_migrations`, rồi chạy `docker restart pb_mm_app`.

## 10. Lưu ý

- WinSCP không tự làm mới danh sách file: bấm Ctrl+R, hoặc ngắt rồi kết nối lại.
- Đừng chạy nhầm `deploy.bat` của gói khác: kiểm tra dòng đầu tiên in ra.
- File `pb_hooks/mm_lib.js` được sinh tự động khi đóng gói, không sửa tay.
