# Trình nhận dữ liệu QR — ILSQ v1

Trang web chạy trên điện thoại để nhận "tình trạng PO" từ máy trong mạng kín (trang gửi `GuiDuLieu_QR.html`) qua QR. Toàn bộ xử lý nằm trên trình duyệt: không có máy chủ, không gửi dữ liệu đi đâu, không có analytics. Đặc tả nằm ở `../HUONG_DAN_TAO_TRINH_NHAN_QR.md`.

## Cấu trúc

```
qr-receiver/
├── index.html            giao diện: quét ảnh / camera, tiến độ, kết quả, xuất, báo cáo phiên, bản gốc delta
├── ilsq.js               giao thức (CRC32, Base45, gói), bộ nhận (state machine), quét ảnh theo ô, ghép delta
├── lib/                  jsQR 1.4.0 · pako 2.2.0 · SheetJS 0.18.5 (tệp cục bộ, không dùng CDN)
└── test/
    ├── testvector.html   tự kiểm T1–T8 (mục 11.2) + delta, chạy ngay trên trình duyệt
    ├── cases.js          bộ ca kiểm thử dùng chung (trình duyệt + Node)
    ├── run.cjs           chạy cases.js bằng Node
    ├── sender-sim.cjs    bên gửi giả lập đúng giao thức + dựng ảnh QR, PNG, video camera giả
    ├── sim.cjs           Ca A/B/D bằng Node (ảnh tổng hợp → quét ô → bộ nhận)
    └── e2e.cjs           Chromium headless: testvector, Ca A, B, C (camera giả), D, xuất Excel/JSON
```

## Sử dụng

1. Mở trang qua **HTTPS**, ví dụ GitHub Pages. Camera và phép kiểm SHA-256 chỉ chạy trong ngữ cảnh an toàn. Nếu mở bằng `file://`, chỉ dùng được nút **Chọn ảnh QR**.
2. Chọn một trong hai cách nhận:
   - **Bật camera:** bên gửi bấm "Chiếu tuần tự".
   - **Chọn ảnh QR:** có thể chọn nhiều ảnh cùng lúc; một ảnh có thể chứa nhiều QR.
3. Thứ tự gói không quan trọng. Gói đến trước gói bắt tay (ô màu vàng) được giữ lại và tự ghép khi có HS. Gói trùng, gói hỏng, gói của phiên khác đều bị loại và được đếm vào báo cáo.
4. Khi đủ gói, trang tự ghép, giải nén và kiểm SHA-256, rồi hiện bảng. Có các nút **Tải Excel** (sheet `PO status`, cột PO định dạng `0`), **Tải JSON**, **Copy cho AI** (TSV) và **Chia sẻ**.
5. Bản **full** có SHA khớp được lưu làm bản gốc trên máy (`localStorage["ilsq_base"]`). Bản **delta** được ghép vào bản gốc nếu epoch khớp; nếu lệch, trang cảnh báo và không ghi đè bản gốc.

### Nối vào app Kitting MM

`mm/build.mjs` chép trình nhận vào gói app MM. Trên app thật, trang nằm ở `http://192.168.1.221:8097/qr/`; trong app có link **📱 Trình nhận QR** ở thẻ Cập nhật sản xuất, tab Quản trị.

- **Đăng nhập:** trang dùng chung phiên đăng nhập của app MM (`localStorage["mm_token"]`, cùng origin). Khi đủ gói và SHA khớp, bấm **⬆ Cập nhật vào app MM** để gửi `POST /api/mm/po/production`.
  - Tài khoản cần quyền **Cập nhật sản xuất** (`prodUpdate`).
  - Dữ liệu gửi đi lấy từ các cột `PO`, `ProdQ`, `Remain`, `Status`. Dòng chưa có ProdQ bị bỏ qua.
  - Sau khi gửi, trang báo số PO đã cập nhật, PO lạ, PO bị Cancel.
  - Nhật ký và lịch sử PO ghi nguồn dạng `QR #epoch · file xxxxxxxx`.
- **Giới hạn của HTTP:** app MM chạy HTTP nội bộ, nên **camera không dùng được** (nút bị ẩn). Cách dùng là chụp ảnh màn hình máy gửi hoặc chọn ảnh có sẵn. SHA-256 vẫn được kiểm, bằng bản JS thuần `sha256js`.
- **Bản trên GitHub Pages:** bấm Tải Excel hoặc Tải JSON, rồi đưa file vào **Cập nhật sản xuất → Nhập file** trong app MM. Ô nhập file nhận `.xlsx` (có cột `ProdQ`) và `.json`; file có SHA sai bị từ chối.

### Quét ảnh nhiều QR (mục 6.1, có bổ sung)

`ILSQ.tileScan` chạy các bước sau:

1. Quét ô chồng lấn đúng đặc tả: ô `W/div × H/div` với div = 1–4, bước nhảy 50%.
2. Nếu chưa đọc được mã nào, quét ô vuông `min(W,H)/d`.
3. Quét **ô thích nghi** theo cỡ QR đã đọc được: ô = 1,3 × cỡ QR, bước nhảy = 0,15 × cỡ QR.
4. Sau mỗi mã đọc được, **tô trắng mã đó** rồi quét lại, lặp đến khi không đọc thêm được mã mới.

Phần bổ sung (bước 2–4) là cần thiết vì khi ảnh chụp cả lưới QR kín khung, mọi ô chia đều đều cắt ngang QR hoặc dính nửa QR bên cạnh, và jsQR trả về `null`. Thử nghiệm với lưới 4×2 chỉ dùng thuật toán gốc đọc được 6/8 mã. Quá trình quét dừng ngay khi bộ nhận đã đủ gói.

## Kiểm thử

```bash
npm i                 # devDependencies: jsqr, pako, xlsx, qrcode-generator (npm run lib = chép lại vào lib/)
npm test              # T1–T8 + delta (Node), rồi Ca A/B/D trên ảnh tổng hợp
node test/e2e.cjs     # cần chromium + puppeteer-core (CHROME_BIN, NODE_PATH): 11 ca trên trình duyệt thật
node test/e2e-mm.cjs  # cần instance MM thử (mm/fresh.sh) chung mạng: /qr/ qua HTTP → gửi vào MM, cổng SX nhận JSON (9 ca)
```

Mở `test/testvector.html` qua HTTPS hoặc localhost để tự kiểm ngay trên điện thoại.

> Ca A, B, C, D hiện được kiểm bằng **bên gửi giả lập** (`test/sender-sim.cjs`), viết đúng giao thức mục 3. Vẫn cần chạy mục 11.3 với `GuiDuLieu_QR.html` thật và điện thoại thật.

## Triển khai GitHub Pages (mục 12)

1. Tạo repo `qr-receiver` và đưa nội dung thư mục này lên nhánh `main`. `node_modules/` đã có trong `.gitignore`.
2. Vào Settings → Pages → chọn Deploy from a branch → `main` / `(root)`.
3. Trên điện thoại, mở `https://<tài-khoản>.github.io/qr-receiver/` và cho phép trang dùng camera.
