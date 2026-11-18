# Đồng bộ phiếu yêu cầu vật tư Next ERP → app MM

Tài liệu bàn giao cho trợ lý AI làm phía app MM. Phía ERP đã làm xong, mới chạy trên site thử `tu.stag`, chưa lên production. Phía MM đã làm trên nhánh `feature/erp-request-sync` (mục 4). Đọc kèm `CLAUDE.md` của repo. Mọi quy ước ở đó vẫn áp dụng: thảo luận phương án với anh Hồ trước khi sửa code, migration chỉ thêm, route mới phải khai quyền trong `perms.mjs` và thêm vào `demo-server.js`.

## 1. Mục tiêu

Kho kitting một đầu mối trên app MM. Phiếu yêu cầu vật tư tạo trên ERP (Material Request) tự lên MM. Kho soạn trên MM, MM báo kết quả về ERP. ERP tạo Stock Entry trừ tồn kệ, chuyển hàng vào kho tạm "Kho chờ cấp line".

- ERP vẫn là nơi tạo và duyệt phiếu, tiếp nhận hàng NG, và để Line xác nhận nhận hàng (pha 2: kho tạm → kho line).
- MM là nơi soạn hàng (kitting). Phiếu MM đã nhận thì ERP khóa nút kitting.

## 2. Phạm vi phiếu (đã chốt 18/11/2026)

| Loại phiếu ERP (`source`) | `kind` gửi sang MM | Nội dung |
|---|---|---|
| Unplan vật liệu rời | `material` | Danh sách mã cụ thể + SL, có Line, Model, lý do |
| Kế hoạch (chọn theo PO) | `plan` | Nhóm PO / Code + danh sách vật liệu ERP đã bung BOM sẵn |

Một phiếu Kế hoạch có thể trộn các loại PO. Mỗi dòng PO có `type`:
- `SS`: PO SAP thật (Sales Order). **Cùng số với PO mà MM tự nhập từ Order List / MES.**
- `UPL`: Code Unplan, tức Rear thành phẩm làm lại. Có `unplan_request` là số phiếu "Unplan Rear thành phẩm" gốc trên ERP. Phiếu gốc này tự cập nhật tiến độ theo phiếu Kế hoạch, MM không cần làm gì thêm.
- `RMA`: Code RMA.
- `ADD`: PO tự lập, chạy trước khi có PO SS. Sau này ERP ghép ADD với PO SS. `links` cho biết ghép với PO nào.

Ngoài phạm vi:
- Phiếu Kế hoạch kiểu cũ chọn theo ngày, không có danh sách PO.
- Phiếu ERP đã kitting một phần hoặc có nháp kitting gộp. ERP làm nốt các phiếu này.
- Phần "thành phẩm có sẵn" của phiếu Unplan thành phẩm, vì đó là chuyển thành phẩm về kho FG chứ không phải soạn vật liệu.

## 3. API phía ERP

Tất cả là **POST**, nhận và trả JSON, xác thực bằng khóa bot sẵn có (`erp_cfg` url / key / secret):

```
POST {url}/api/method/ilsungtech_erp.api.mm_sync.<tên hàm>
Authorization: token {key}:{secret}
Content-Type: application/json
Accept: application/json
```

Kết quả nằm trong `message`. Lỗi nghiệp vụ trả HTTP 417, nội dung lỗi tiếng Việt ở `_server_messages` (chuỗi JSON lồng, có thẻ HTML như `<strong>` hoặc `<br>`). Thiếu quyền trả 403.

**Quyền:** tài khoản bot phải có role **"MM Sync"**. IT gán role này trên ERP production sau khi deploy. Role này chỉ gọi được 3 API dưới đây, không mở thêm quyền đọc doctype nào.

`$http.send` trong `pb-entry.mjs` hiện chỉ có `erpHttp` gọi GET. Cần thêm một hàm POST tương tự, gửi body JSON (`body: JSON.stringify(...)`), timeout khoảng 60 giây vì tạo Stock Entry có thể chậm.

### 3.1 `pending_requests`: lấy phiếu MM phải kitting

Body:

```json
{ "known": ["MAT-MR-2026-00088", "..."], "claim": 1 }
```

- `known`: các phiếu ERP MM đang giữ mà chưa xong. ERP trả trạng thái của những phiếu đã ra khỏi hàng chờ trong `closed`.
- `claim`: `1` thì ERP đánh dấu luôn các phiếu mới là "Kitting ở app MM" và khóa nút kitting trên ERP. `0` chỉ xem trước, không ghi gì.

Gọi lại nhiều lần đều an toàn. Phiếu MM đã nhận vẫn có trong `requests` cho tới khi xong, ERP trả SL còn thiếu mới nhất mỗi lần.

Kết quả (rút gọn, dữ liệu thật trên tu.stag):

```json
{
  "requests": [
    {
      "name": "MAT-MR-2026-00173",
      "kind": "plan",
      "source": "Kế hoạch",
      "stage": "accepted",
      "line": "Line 1B",
      "model": "...",
      "shift": "...",
      "plan_date": "2026-11-05",
      "schedule_date": "2026-11-05",
      "requested_by": "user@...",
      "line_leader": "...",
      "reason": "",
      "blocked": "",
      "modified": "2026-11-05 10:12:00",
      "claimed_now": 1,
      "codes": [
        { "code": "011076194449", "type": "SS", "item_code": "GH96-23668A", "qty": 880, "line": "Line 1B", "bom_no": "BOM-...", "unplan_request": "", "links": [] },
        { "code": "UPL261105002", "type": "UPL", "item_code": "GH96-23668A", "qty": 12, "line": "Line 1B", "bom_no": "...", "unplan_request": "MAT-MR-2026-00172", "links": [] }
      ],
      "lines": [
        { "key": "GH02-16135A", "item_code": "GH02-16135A", "item_name": "...", "uom": "Nos", "qty": 12, "done": 0, "remaining": 12 }
      ]
    }
  ],
  "closed": [ { "name": "MAT-MR-2026-00041", "state": "done" } ],
  "server_time": "2026-11-18 15:40:00"
}
```

Ý nghĩa các trường:
- `lines`: danh sách vật liệu phải soạn, **ERP đã tính sẵn**. Phiếu `material` lấy theo dòng phiếu. Phiếu `plan` lấy theo BOM × SL của các PO / Code, gộp theo mã, `key` = mã vật liệu.
  - `qty` = cần, `done` = ERP đã ghi nhận cấp, `remaining` = còn thiếu.
  - Đây là con số ERP sẽ kiểm khi MM báo kết quả, nên MM nên **soạn theo `lines`** thay vì tự bung BOM. Nếu tự bung BOM mà lệch, ERP sẽ từ chối mã không có trên phiếu.
- `blocked`: khác rỗng nghĩa là KHSX đang tạm dừng sửa kế hoạch, hoặc có thay đổi chờ Kho xem. MM hiện cảnh báo và chưa cho soạn. ERP cũng từ chối báo kết quả trong lúc này.
- `links` (chỉ ở dòng ADD / SS): `[{ "po": "...", "kind": "ss" | "add", "item_code": "...", "qty": 0, "same_code": 1 }]`. Với dòng ADD, `kind = "ss"` là PO SS đã thay mã ADD này. Với dòng SS, `kind = "add"` là mã ADD mà PO SS này đã thay.
- `closed[].state`:

| state | Nghĩa | MM nên làm |
|---|---|---|
| `done` | Đã cấp đủ hoặc PLD duyệt đóng | Đánh dấu xong |
| `cancelled` / `deleted` | Phiếu bị hủy hoặc xóa trên ERP | Gỡ khỏi hàng chờ. Đã soạn thì cảnh báo Kho thu hồi / trả kho |
| `stopped` | Phiếu bị dừng | Như hủy |
| `released` | Admin trả phiếu về ERP kitting | Gỡ khỏi hàng chờ |
| `reverted` | Admin lùi phiếu về bước trước kitting | Gỡ, chờ phiếu quay lại |
| `hold` | Vẫn của MM nhưng tạm ngoài hàng chờ | Giữ nguyên, chưa cho soạn |

### 3.2 `report_kitting`: báo kết quả soạn

Body:

```json
{
  "request": "MAT-MR-2026-00088",
  "report_id": "MM-<id duy nhất>",
  "rows": [ { "item_code": "GH02-16135A", "qty": 7 } ],
  "staff": "KH01",
  "note": "Kit K-..."
}
```

- `rows` tính theo đơn vị tồn kho. Cùng mã xuất hiện nhiều lần thì ERP cộng dồn. Chỉ gửi **phần soạn thêm lần này**, không gửi lũy kế.
- `report_id` phải **duy nhất cho mỗi lần báo**. Gửi lại cùng `report_id`, ví dụ do mạng lỗi, ERP trả kết quả cũ (`duplicate: 1`) và không trừ tồn lần 2.
- ERP tự chọn vị trí lấy hàng: vị trí mặc định của mã trước, rồi đến vị trí tồn nhiều nhất. Một dòng phải lấy từ nhiều vị trí thì mỗi vị trí là một Stock Entry riêng.
- Kết quả trả về:

```json
{ "ok": 1, "duplicate": 0, "stock_entries": ["MAT-STE-..."], "lines": [ { "key": "...", "item_code": "...", "done": 7, "remaining": 5 } ] }
```

- ERP từ chối cả lần báo (không ghi gì) khi:
  - mã không có trên phiếu
  - SL vượt phần còn thiếu
  - tồn ERP ở Kho vật liệu rời không đủ
  - phiếu không còn do MM giữ
  - phiếu đang bị chặn (`blocked`)

  Thông báo lỗi liệt kê theo từng mã.

### 3.3 `release_requests`: trả phiếu về ERP

Body: `{ "names": ["MAT-MR-..."], "reason": "..." }`. Cờ đổi sang **"ERP"**: ERP kitting tiếp phần còn thiếu, lượt đồng bộ sau MM nhận `closed: released` rồi đóng phiếu, hủy các yêu cầu chưa cấp, và **không nhận lại** phiếu này. Phần MM đã báo vẫn giữ nguyên.

## 4. Phía MM đã làm (nhánh `feature/erp-request-sync`, 18/11/2026)

Chi tiết quy tắc nằm ở `CLAUDE.md` mục 4, phần "Phiếu yêu cầu vật tư từ Next ERP". Tóm tắt:

| Phần | File | Việc làm |
|---|---|---|
| Nghiệp vụ | `kitting-app/lib/erp-request.mjs` | Nhận phiếu (`applyErpRequests`), xếp hàng chờ báo kết quả (`queueReports`), ghi kết quả (`markReport`), màn trạng thái, Gửi lại / Bỏ qua |
| Gọi ERP | `mm/src/pb-entry.mjs` | `erpPost` (POST JSON). `cronErpRequests` chạy trong cron 15 phút. `cronErpPush` gửi hàng chờ, gọi ERP ngoài transaction |
| Lịch | `mm/pkg/mm-app/pb_hooks/mm.pb.js` | Thêm `mm_erp_push` chạy 2 phút / lần |
| Chặn Planner | `planning.mjs`, `plan-extra.mjs`, `plan-import.mjs`, `plan-auto.mjs` | Kit ERP không gộp / tách / đưa về Chưa lập / hoàn tác / tự xếp |
| Kitting | `kitting.mjs` | Kit ERP không bung BOM MM. Chặn soạn / cấp khi phiếu ERP bị chặn hoặc đã đóng. PO ERP không sửa / hủy trong MM |
| Quyền | `perms.mjs` | `GET /api/erp/req` cho kho:1 hoặc supply:1. sync / retry / drop cho kho:2 |
| Giao diện | `mm/web/kho.js`, `app.js`, `kitpad.js`, `index.html` | Tab Kho → **Phiếu ERP**. Ô bật ở Quản trị. Pill ERP trên Kit. Yêu cầu ERP ở tab Cấp vật liệu. Phiên bản tăng lên `pb34` |
| Dữ liệu | `pb_migrations/1794900000_mm_erp_req.js` | Bảng `erp_req`, `erp_sent`, `erp_report`. Thêm cột `erp_req` / `erp_key` |
| Bản thử | `mm/demo/demo-server.js` | Có route (bản thử không gọi ERP thật) |

**Đã kiểm:**
- 27 tình huống nghiệp vụ chạy bằng Node trên SQLite tạm: nhận phiếu, chạy lại không nhân đôi, chặn Planner, soạn rồi báo phần chênh, ERP từ chối rồi gửi lại, lỗi mạng giữ hàng chờ, MM giảm SL thì cảnh báo, yêu cầu bổ sung phần còn thiếu, phiếu bị chặn, ERP hủy phiếu, xung đột PO, giao Line Kit ERP.
- Quyền theo vai trò.
- Mọi module nạp được.

**Chưa kiểm:**
- `npm run all`: máy dev chưa có `node_modules`, nên file đóng gói `mm_lib.js` / `pb_public` **chưa sinh lại**.
- `npm test` trên PocketBase, và chưa thêm bài test API.
- Bản chạy thử trên trình duyệt.

**Thử nối thật với ERP tu.stag (18/11/2026):** chạy code nghiệp vụ MM bằng Node, gọi HTTP thật qua curl, cùng cách `$http.send` (POST JSON, `Authorization: token key:secret`). Dùng user bot thử có role MM Sync. Thử xong đã dọn.

| Tình huống | Kết quả |
|---|---|
| Sai secret / bot chưa có role / gọi bằng GET | MM hiện đúng câu báo 401 / 403. GET bị từ chối |
| Kéo phiếu thật | 13 phiếu (7 vật liệu, 6 Kế hoạch), JSON khoảng 42KB, khoảng 1 giây. Line khớp tên Routing ERP. Mỗi phiếu Kế hoạch thành 1 Kit đủ số vật tư. PO SS gắn vào, UPL tạo PO nội bộ đúng Line |
| Kho cấp / soạn trên MM rồi báo ERP | ERP tạo Stock Entry đã submit, từ vị trí kệ sang "Kho chờ cấp line". Có gắn `custom_mm_report_id`, % tiến độ phiếu tăng. Áp dụng cho cả phiếu vật liệu lẫn phiếu Kế hoạch |
| Gửi lại cùng `report_id` | ERP trả lại SE cũ (`duplicate: 1`), không trừ tồn lần 2 |
| Thiếu tồn / vượt SL / mã lạ | HTTP 417. MM tách được câu lỗi tiếng Việt theo từng mã và hiện ở màn Phiếu ERP |
| Đồng bộ lần 2 | Không nhân đôi. Dòng cấp 1 phần sinh yêu cầu bù phần còn thiếu (đúng thiết kế) |
| Trả phiếu về ERP | **Lỗi, đã sửa:** trước đây cờ về rỗng nên MM nhận lại ngay. Nay cờ = "ERP", MM đóng phiếu và không nhận lại |

**Lưu ý từ dữ liệu thật:**
- Nhóm VLN / HV của vật tư Kit lấy theo BOM MM (`groupOf`). Mã không có trong BOM MM thì rơi vào VLN. Trên MM thật cần kiểm Rear có vào HV không.
- Có phiếu Kế hoạch trên ERP không có Line (VD 00156). Kit được tạo nhưng chưa có Line.
- Kho cấp trên MM mà ERP từ chối (thiếu tồn ERP) thì MM vẫn tính là đã cấp. Báo cáo nằm ở trạng thái Lỗi để Kho chỉnh tồn ERP rồi bấm Gửi lại, hoặc Bỏ qua.
- Chưa thử: code đóng gói chạy trong PocketBase (`erpPost`, 2 cron). Phần này cần `npm run all`.

**Thứ tự đưa lên:**
1. ERP deploy và chạy migrate, IT gán role "MM Sync" cho bot.
2. MM chạy `npm run all` → `npm test` → deploy.
3. Quản trị bật ô "Phiếu yêu cầu vật tư từ ERP".
4. Thử với 1 phiếu Unplan vật liệu rời trước, rồi mới đến phiếu Kế hoạch.

## 5. Câu hỏi còn mở cho anh Hồ

1. Phiếu Kế hoạch có PO SS: chấp nhận Kit do phiếu ERP quyết (mục 4.5), tức Planner thôi tự lập Kit cho các PO đó?
2. Bước tiếp nhận hàng NG vẫn làm trên ERP, MM chỉ nhận phiếu từ bước Chờ kitting. Như vậy được chưa?
3. Line nhận hàng trên MM (quét QR + Leader ký) có cần báo về ERP không?
4. Mã ADD đã ghép PO SS (`links`): MM tự nối PO nội bộ ADD với PO SAP tương ứng, hay chỉ hiển thị?

## 6. Liên hệ phía ERP

- Code ERP: `ilsungtech_erp/api/mm_sync.py`, patch `add_mm_sync_fields`.
- Field: `Material Request.custom_kitting_by` = "MM" (MM đang kitting) / "ERP" (đã trả về ERP), `Stock Entry.custom_mm_report_id`. Role: "MM Sync".
- Cần đổi dữ liệu trả về hoặc thêm trường thì báo bên ERP. Không tự đoán cấu trúc.
