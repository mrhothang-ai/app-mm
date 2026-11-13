# HƯỚNG DẪN XÂY DỰNG TRÌNH NHẬN DỮ LIỆU QR (ILSQ v1)

> **Tài liệu dành cho AI lập trình trong VS Code (Copilot / Claude / Cursor…).**
> Hãy đọc **toàn bộ** tài liệu trước khi viết code. Mọi chi tiết giao thức ở mục 3 là **bắt buộc chính xác từng byte**, vì trình nhận phải đọc được QR do trang gửi có sẵn `GuiDuLieu_QR.html` tạo ra. Không tự ý đổi định dạng.
>
> Dự án: IL-Sung Tech · Truyền "tình trạng PO" từ máy trong mạng kín sang điện thoại qua QR · Phiên bản giao thức: **ILSQ v1**

---

## 1. Mục tiêu

Xây dựng **trình nhận** chạy trên trình duyệt điện thoại (Android Chrome, iPhone Safari), có các chức năng:

1. Quét QR bằng **camera trực tiếp** (liên tục, nhiều khung hình).
2. Quét QR từ **ảnh chụp** — một ảnh có thể chứa **nhiều QR** (chụp cả lưới trên màn hình máy gửi), cho phép chọn nhiều ảnh cùng lúc.
3. Kiểm tra từng gói (CRC32), loại gói trùng, bỏ gói của phiên khác, giữ lại gói đến trước gói bắt tay.
4. Khi đủ gói: ghép → giải nén (raw deflate) → kiểm SHA-256 → dựng lại bảng.
5. Hiển thị bảng, xuất **Excel (.xlsx)**, **JSON**, và **copy dạng TSV** để dán cho AI.
6. (Giai đoạn 2 — tùy chọn) Hỗ trợ **delta**: ghép dữ liệu thay đổi vào bản gốc lưu trên máy.

Không cần máy chủ. Toàn bộ chạy phía trình duyệt.

---

## 2. Sản phẩm cần tạo

### 2.1 Cấu trúc thư mục

```
qr-receiver/
├── index.html          ← giao diện + toàn bộ logic (hoặc tách app.js nếu muốn)
├── lib/
│   ├── jsQR.js         ← giải mã QR từ ảnh/khung hình
│   ├── pako.min.js     ← giải nén raw deflate
│   └── xlsx.full.min.js← xuất Excel (SheetJS)
├── test/
│   └── testvector.html ← trang tự kiểm thử với test vector ở mục 11
└── README.md
```

### 2.2 Thư viện (bản đã kiểm thử tương thích)

| Thư viện | Phiên bản | Lấy từ npm | Tệp dùng |
|---|---|---|---|
| jsQR | 1.4.x | `npm i jsqr@1` | `node_modules/jsqr/dist/jsQR.js` |
| pako | 2.x | `npm i pako@2` | `node_modules/pako/dist/pako.min.js` |
| SheetJS | 0.18.5 | `npm i xlsx@0.18.5` | `node_modules/xlsx/dist/xlsx.full.min.js` |

- **Bắt buộc dùng tệp cục bộ** trong `lib/` (copy từ `node_modules`), **không dùng CDN** — trang phải chạy được khi không có Internet sau lần tải đầu.
- Có thể gộp tất cả vào **một file HTML duy nhất** (nhúng nội dung thư viện vào thẻ `<script>`). Khi nhúng, thay mọi chuỗi `</script` trong nội dung thư viện bằng `<\/script`.

### 2.3 Yêu cầu môi trường

- **Camera chỉ hoạt động trên HTTPS** (hoặc `http://localhost`). Mở file trực tiếp (`file://`, `content://`) trên điện thoại thì **không bật được camera**, chỉ dùng được chức năng chọn ảnh.
- Triển khai lên **GitHub Pages** (xem mục 12) để dùng camera.
- `crypto.subtle` (tính SHA-256) cũng chỉ có trong ngữ cảnh an toàn (HTTPS/localhost). Nếu không có → hiển thị cảnh báo "không kiểm được SHA-256" nhưng vẫn cho xem dữ liệu.

---

## 3. GIAO THỨC ILSQ v1 (bắt buộc chính xác)

### 3.1 Chuỗi xử lý tổng thể

```
BÊN GỬI:  JSON (UTF-8) ──deflateRaw(level 9)──► nén ──chia gói──► mỗi gói nhị phân ──Base45──► chuỗi ──► QR (chế độ Alphanumeric)
BÊN NHẬN: QR ──► chuỗi Base45 ──b45decode──► gói nhị phân ──kiểm CRC32──► payload ──ghép theo idx──► inflateRaw ──► JSON
```

### 3.2 Cấu trúc một gói nhị phân

Tất cả số nguyên nhiều byte là **big-endian**.

| Offset | Độ dài | Trường | Giá trị / ý nghĩa |
|---|---|---|---|
| 0 | 4 | `magic` | `0x49 0x4C 0x53 0x51` (ASCII `ILSQ`) |
| 4 | 1 | `ver` | `1` |
| 5 | 1 | `type` | `0` = gói bắt tay (handshake), `1` = gói dữ liệu |
| 6 | 4 | `fileId` | uint32 — mã phiên truyền, giống nhau cho mọi gói của một lần gửi |
| 10 | 2 | `idx` | uint16 — số thứ tự gói. Bắt tay = `0`; dữ liệu = `1 … total-1` |
| 12 | 2 | `total` | uint16 — **tổng số gói, tính cả gói bắt tay** |
| 14 | 2 | `len` | uint16 — số byte payload |
| 16 | `len` | `payload` | dữ liệu |
| 16+len | 4 | `crc32` | uint32 — CRC32 của **toàn bộ byte [0 … 16+len)** (header 16 byte + payload) |

→ Độ dài gói = `20 + len`.

**Kiểm tra hợp lệ** (bỏ qua gói nếu sai bất kỳ điều nào):
- Độ dài ≥ 20.
- 4 byte đầu đúng `ILSQ`.
- `ver === 1`.
- `20 + len` ≤ độ dài gói.
- `crc32(bytes[0 … 16+len))` === giá trị đọc ở offset `16+len`.

### 3.3 CRC32

CRC-32 chuẩn (IEEE 802.3, đa thức đảo `0xEDB88320`, khởi tạo `0xFFFFFFFF`, XOR cuối `0xFFFFFFFF`). Dùng đúng đoạn sau:

```js
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
```

### 3.4 Base45 (RFC 9285)

Bảng ký tự (45 ký tự, **có dấu cách** ở vị trí 36):

```
0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:
```

Giải mã: cứ 3 ký tự `c0 c1 c2` → `x = v(c0) + v(c1)*45 + v(c2)*2025` → 2 byte `[x >> 8, x & 0xFF]`. Nếu cuối chuỗi còn 2 ký tự `c0 c1` → `x = v(c0) + v(c1)*45` → 1 byte `x`.

```js
const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
function b45decode(s) {
  if (s.length % 3 === 1) throw new Error('Base45 sai độ dài');
  const out = [];
  for (let i = 0; i < s.length; i += 3) {
    const a = B45.indexOf(s[i]), b = B45.indexOf(s[i + 1]);
    if (a < 0 || b < 0) throw new Error('Ký tự Base45 không hợp lệ');
    if (i + 2 < s.length) {
      const c = B45.indexOf(s[i + 2]); if (c < 0) throw new Error('Ký tự Base45 không hợp lệ');
      const x = a + b * 45 + c * 2025;
      if (x > 0xFFFF) throw new Error('Base45 tràn');
      out.push(x >> 8, x & 0xFF);
    } else {
      const x = a + b * 45;
      if (x > 0xFF) throw new Error('Base45 tràn');
      out.push(x);
    }
  }
  return new Uint8Array(out);
}
```

> ⚠️ **TUYỆT ĐỐI KHÔNG `trim()` chuỗi đọc được từ QR** — dấu cách là ký tự hợp lệ của Base45, có thể nằm ở đầu/cuối chuỗi. Cũng không đổi chữ hoa/thường.

### 3.5 Payload gói bắt tay (`type = 0`, `idx = 0`)

Payload là chuỗi **JSON UTF-8**:

```json
{
  "total": 8,
  "sha": "c205a6bd…(64 ký tự hex thường)",
  "n": 208,
  "epoch": 1,
  "schema": ["PO","Model","PlanQ","ProdQ","Remain","Status"]
}
```

| Trường | Ý nghĩa |
|---|---|
| `total` | Tổng số gói (giống trường `total` trong header) |
| `sha` | SHA-256 (hex chữ thường) của **chuỗi byte JSON gốc chưa nén** (xem 3.7) |
| `n` | Số dòng dữ liệu trong lần gửi này |
| `epoch` | Số thứ tự bản gửi (tăng dần mỗi lần bấm "Tạo QR" bên gửi) |
| `schema` | Tên cột theo thứ tự |

### 3.6 Gói dữ liệu (`type = 1`, `idx = 1 … total-1`)

Payload là **một đoạn liên tiếp** của luồng nén. Nối payload theo `idx` tăng dần (1, 2, …, total-1) → được luồng **raw deflate** (không có header zlib, không có header gzip).

Giải nén: `pako.inflateRaw(merged)` → `Uint8Array` (= chuỗi JSON UTF-8).

> Trường hợp đặc biệt: nếu `total === 1` thì không có gói dữ liệu (không xảy ra với bên gửi hiện tại, nhưng code không được lỗi).

### 3.7 JSON dữ liệu sau giải nén

Dữ liệu được lưu **theo cột** (columnar) để nén tốt hơn:

```json
{
  "s": ["PO","Model","PlanQ","ProdQ","Remain","Status"],
  "c": [
    [11075090139, 11075088812],
    ["GH96-16355A", "GH96-15937D"],
    [1, 960],
    [1, 960],
    [0, 0],
    ["Completed", "Completed"]
  ],
  "m": "full",
  "d": [],
  "b": 0
}
```

| Trường | Ý nghĩa |
|---|---|
| `s` | Tên cột (schema) |
| `c` | Mảng các cột; `c[i][r]` = giá trị cột `i` của dòng `r`. Mọi cột có cùng độ dài |
| `m` | `"full"` = gửi toàn bộ; `"delta"` = chỉ các dòng mới/thay đổi |
| `d` | Danh sách PO bị xoá so với bản gốc (chỉ có ý nghĩa khi `m = "delta"`) |
| `b` | Epoch của bản gốc mà delta dựa vào (`0` khi full) |

Dựng lại bảng theo dòng:

```js
const rows = obj.c.length ? obj.c[0].map((_, r) => obj.s.map((_, i) => obj.c[i][r])) : [];
```

**Kiểu giá trị có thể gặp:** số nguyên/thập phân, chuỗi (có tiếng Việt có dấu), `null` (ô trống), chuỗi ngày dạng `"YYYY-MM-DDTHH:mm"`.

- **PO là số 11 chữ số** (vd `11075090139`) — nằm trong giới hạn an toàn của số JS (< 2^53), giữ nguyên kiểu số. Khi xuất Excel phải đảm bảo không bị hiển thị dạng khoa học (vd `1.1E+10`) — đặt định dạng ô `0` cho cột PO.
- **Khoá dòng = cột `PO`** (cột đầu tiên). Không trùng trong một lần gửi.

**SHA-256** tính trên **đúng chuỗi byte trả về từ `inflateRaw`** — không được `JSON.parse` rồi `JSON.stringify` lại để băm.

---

## 4. LOGIC NHẬN (state machine)

### 4.1 Trạng thái phiên

```js
const S = {
  fileId: null,     // uint32 của phiên đang nhận
  total: null,      // tổng số gói
  hs: null,         // object JSON gói bắt tay
  parts: new Map(), // idx -> Uint8Array payload (idx 1..total-1)
  pending: [],      // gói dữ liệu đến TRƯỚC gói bắt tay (đã kiểm CRC)
  seen: new Set(),  // chuỗi QR đã xử lý (chống xử lý lặp tốn CPU)
  done: false,
  stats: { scanned: 0, valid: 0, dup: 0, bad: 0, foreign: 0, t0: null }
};
```

### 4.2 Hàm `handleQrText(text)` — xử lý một chuỗi QR đọc được

```
1. Nếu S.done → bỏ qua.
2. Nếu text đã có trong S.seen → stats.dup++, bỏ qua. Ngược lại thêm vào S.seen.
3. Thử b45decode(text) → u8. Lỗi → stats.bad++, bỏ qua.
4. Kiểm tra gói (mục 3.2). Sai → stats.bad++, bỏ qua.
5. Nếu stats.t0 chưa có → ghi thời điểm bắt đầu.
6. Nếu type === 0 (bắt tay):
     a. Nếu S.fileId !== null và fileId khác S.fileId:
          → đây là PHIÊN MỚI. Hỏi người dùng (hoặc tự động) bỏ phiên cũ và bắt đầu phiên mới.
            Mặc định: tự chuyển sang phiên mới, xoá parts/pending cũ, hiện thông báo.
     b. Parse payload JSON → S.hs; S.fileId = fileId; S.total = total.
     c. Kiểm tra hs.total === total header; nếu không → coi là gói hỏng.
     d. Khởi tạo lưới ô tiến độ (total ô).
     e. PHÁT LẠI S.pending: với mỗi gói pending cùng fileId → đưa vào parts; khác fileId → bỏ.
        Xoá S.pending.
7. Nếu type === 1 (dữ liệu):
     a. Nếu S.fileId === null (chưa có bắt tay) → đẩy {fileId, idx, total, payload} vào S.pending. Cập nhật UI "đã giữ N gói, chờ gói bắt tay". DỪNG.
     b. Nếu fileId !== S.fileId → stats.foreign++, bỏ (gói của lần gửi khác).
     c. Nếu idx < 1 hoặc idx >= S.total → stats.bad++, bỏ.
     d. Nếu S.parts đã có idx → stats.dup++, bỏ.
     e. S.parts.set(idx, payload); stats.valid++.
8. Cập nhật UI tiến độ.
9. Nếu S.fileId !== null và S.parts.size === S.total - 1 → gọi finish().
```

> **Lỗi đã gặp thực tế (phải tránh):** phiên bản đầu bỏ luôn gói dữ liệu đến trước gói bắt tay → khi chọn nhiều ảnh theo thứ tự ngẫu nhiên bị thiếu gói vĩnh viễn. **Bắt buộc có `pending`.**

### 4.3 Hàm `finish()`

```
1. S.done = true; dừng camera.
2. Ghép payload idx 1..total-1 theo thứ tự → merged (Uint8Array).
3. raw = pako.inflateRaw(merged). Lỗi → báo "Lỗi giải nén", cho phép Làm lại.
4. Nếu có crypto.subtle: shaHex = SHA-256(raw) → so với S.hs.sha (so chuỗi hex chữ thường).
5. obj = JSON.parse(new TextDecoder('utf-8').decode(raw)).
6. Kiểm tra: obj.s là mảng; obj.c là mảng cùng số cột; mọi cột cùng độ dài; số dòng === S.hs.n.
7. Dựng rows (mục 3.7).
8. Nếu obj.m === 'delta' → xử lý theo mục 7, ngược lại lưu làm bản gốc mới (mục 7.1).
9. Hiển thị kết quả + báo cáo (mục 9.3).
```

---

## 5. QUÉT BẰNG CAMERA

```js
stream = await navigator.mediaDevices.getUserMedia({
  video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  audio: false
});
video.setAttribute('playsinline', ''); // bắt buộc cho iPhone
video.srcObject = stream; await video.play();
```

Vòng quét (dùng `requestAnimationFrame`, giới hạn ~10–15 lần/giây để đỡ nóng máy):

```
mỗi khung:
  1. Vẽ khung video vào canvas RIÊNG của camera (không dùng chung với quét ảnh).
  2. Nếu có BarcodeDetector hỗ trợ 'qr_code' → detect(canvas) → mọi rawValue → handleQrText.
  3. Nếu không có BarcodeDetector → jsQR(imageData, w, h, { inversionAttempts: 'dontInvert' }) → handleQrText(code.data).
  4. Khi đọc được mã mới → rung nhẹ (navigator.vibrate?.(30)) và nhấp nháy ô tương ứng.
```

- Khi camera không mở được (không HTTPS, bị từ chối quyền) → thông báo rõ: *"Camera cần mở trang qua HTTPS (GitHub Pages). Bạn vẫn có thể dùng nút Chọn ảnh QR."*
- Có nút **Tắt camera**; tự tắt khi `finish()` hoặc khi trang ẩn (`visibilitychange`).
- Có nút **bật/tắt đèn flash** nếu `track.getCapabilities().torch` tồn tại (tùy chọn).

---

## 6. QUÉT TỪ ẢNH (nhiều QR trong một ảnh)

> **Lỗi đã gặp thực tế:** jsQR chỉ trả về **một** QR mỗi lần gọi, và khi ảnh chứa nhiều QR thì thường **không đọc được mã nào hoặc chỉ một mã**. Người dùng chụp cả lưới 8 QR chỉ nhận được gói bắt tay. Bắt buộc dùng thuật toán quét theo ô chồng lấn dưới đây.

### 6.1 Thuật toán `scanImageFile(file)`

```
1. Đọc ảnh: URL.createObjectURL(file) → Image (hoặc createImageBitmap(file, { imageOrientation: 'from-image' }) để xử lý ảnh xoay EXIF).
2. Thu nhỏ nếu cạnh dài > 2600 px (giữ tỉ lệ). Vẽ vào canvas RIÊNG tạo mới cho mỗi ảnh.
3. found = new Set().
4. Nếu có BarcodeDetector → detect(canvas) → thêm mọi rawValue vào found.
5. Quét theo ô chồng lấn (luôn chạy, kể cả khi BarcodeDetector đã tìm được — để bắt mã nó bỏ sót):
     for div in [1, 2, 3, 4]:
        tw = floor(W/div), th = floor(H/div)          // kích thước ô
        sx = floor(tw/2),  sy = floor(th/2)           // bước nhảy = 50% → chồng lấn
        for y = 0; ; y += sy:
           oy = min(y, H - th)
           for x = 0; ; x += sx:
              ox = min(x, W - tw)
              code = jsQR(getImageData(ox, oy, tw, th), tw, th, { inversionAttempts: 'attemptBoth' })
              if code → found.add(code.data)
              if ox >= W - tw → break
           if oy >= H - th → break
     (bỏ qua ô nhỏ hơn 60 px)
6. Sắp xếp các chuỗi tìm được: gói bắt tay (type 0) trước, rồi gói dữ liệu.
7. Gọi handleQrText cho từng chuỗi.
8. Báo cho người dùng: "Ảnh này đọc được K mã (M mã mới)". Nếu K = 0 → gợi ý chụp gần/rõ hơn.
9. Giải phóng URL.revokeObjectURL. Bọc toàn bộ trong try/catch — một ảnh lỗi KHÔNG được làm dừng các ảnh sau.
```

### 6.2 Chọn nhiều ảnh

```js
input.addEventListener('change', async (e) => {
  for (const f of [...e.target.files]) { await scanImageFile(f); } // TUẦN TỰ, có await
  e.target.value = ''; // cho phép chọn lại cùng ảnh
});
```

> **Lỗi đã gặp thực tế:** chạy song song nhiều `scanImageFile` dùng chung một canvas → ảnh đè nhau, mất gói ngẫu nhiên. **Phải xử lý tuần tự và mỗi ảnh một canvas riêng.**

- Hiện tiến trình khi xử lý nhiều ảnh: "Đang đọc ảnh 2/5…".
- Quét ảnh có thể mất 0,5–2 giây/ảnh trên điện thoại → dùng `await new Promise(r => setTimeout(r))` giữa các ô lớn để UI không bị treo (hoặc chạy trong Web Worker — tùy chọn).

---

## 7. DELTA (giai đoạn 2 — tùy chọn nhưng nên làm)

### 7.1 Lưu bản gốc trên điện thoại

Sau mỗi lần nhận **full** thành công (SHA khớp): lưu vào `localStorage` (hoặc IndexedDB nếu lớn):

```json
key: "ilsq_base"
value: { "epoch": 1, "schema": [...], "map": { "11075090139": [row...], ... }, "savedAt": "ISO" }
```

### 7.2 Ghép delta

Khi nhận `m === "delta"`:

```
1. base = đọc ilsq_base. Nếu không có hoặc base.epoch !== obj.b:
     → báo "Bản gốc trên máy (#X) không khớp bản delta dựa vào (#obj.b). Hãy yêu cầu bên gửi tạo bản FULL (bỏ tích 'Chỉ gửi dòng thay đổi')."
     → vẫn hiển thị các dòng delta nhận được, KHÔNG ghi đè bản gốc.
2. Nếu khớp:
     a. Với mỗi dòng trong rows: base.map[String(row[0])] = row   (thêm mới hoặc ghi đè)
     b. Với mỗi PO trong obj.d: delete base.map[String(po)]
     c. base.epoch = S.hs.epoch; lưu lại.
     d. Hiển thị bảng đầy đủ sau ghép; đánh dấu màu các dòng mới/sửa; liệt kê PO đã xoá.
```

- Có nút **"Xoá bản gốc trên máy"** và hiển thị "Bản gốc hiện tại: #epoch · N PO · lưu lúc …".
- Lưu ý: khoá dòng luôn dùng `String(PO)` để tránh lệch kiểu số/chuỗi.

---

## 8. XUẤT DỮ LIỆU

| Nút | Hành vi |
|---|---|
| **Tải Excel** | SheetJS: `aoa = [schema, ...rows]` → `aoa_to_sheet` → sheet tên `PO status`; cột PO định dạng `'0'`; tên file `PO_status_epoch{N}_{yyyyMMdd_HHmm}.xlsx` |
| **Tải JSON** | `{ schema, rows, mode, epoch, fileId, sha256, receivedAt }` — thụt lề 2 |
| **Copy cho AI** | Dòng đầu là tiêu đề, các dòng sau là dữ liệu, ngăn cách bằng TAB (TSV), `null` → chuỗi rỗng. Dùng `navigator.clipboard.writeText`; nếu lỗi (không HTTPS) → fallback `textarea` + `document.execCommand('copy')` |
| **Chia sẻ** (tùy chọn) | `navigator.share({ files: [xlsxFile] })` nếu có — tiện gửi qua Zalo/Mail trên điện thoại |

Khi tải về trên điện thoại: tạo `Blob` → `URL.createObjectURL` → thẻ `<a download>` → `click()`.

---

## 9. GIAO DIỆN

Phong cách: gọn, **trực quan bằng con số**, ít chữ giải thích (giống giao diện ERP). Tiếng Việt. Thiết kế cho điện thoại trước (màn hình ~380px), dùng được trên máy tính.

### 9.1 Bố cục từ trên xuống

1. **Thanh tiêu đề**: logo "QR" + "Nhận dữ liệu QR" + dòng phụ "Tình trạng PO · IL-Sung Tech".
2. **Khối Quét**: nút `📷 Bật camera` (to, màu chính) · nút `🖼️ Chọn ảnh QR` (cho chọn nhiều) · nút `Làm lại`. Vùng video (ẩn khi tắt), có khung ngắm.
3. **Khối Tiến độ**:
   - Số to: `5 / 8 gói` · nhãn trạng thái (`Chờ bắt tay` / `Đã bắt tay · bản #3` / `Hoàn tất`).
   - Thanh tiến độ.
   - Lưới ô vuông nhỏ, mỗi ô = 1 gói: ô `HS` (bắt tay) + `1…N`; xám = chưa có, xanh lá = đã nhận, vàng = đang giữ trong pending.
   - Dòng phụ: `File 1a2b3c4d · 208 PO · 7 gói dữ liệu`.
   - Khi chưa có bắt tay mà đã giữ gói: `Đã giữ 3 gói — cần quét gói HS`.
4. **Khối Kết quả** (hiện khi xong): nhãn `✔ SHA-256 khớp` (xanh) hoặc `✖ SHA-256 KHÔNG khớp` (đỏ) · số PO · full/delta · các nút xuất · bảng dữ liệu cuộn được (dòng tiêu đề dính trên).
5. **Báo cáo phiên** (mục 9.3).

### 9.2 Màu (CSS variables)

```css
--bg:#f4f6f8; --card:#fff; --ink:#1f2733; --sub:#6b7a8d; --line:#e3e8ef;
--brand:#1b5e9c; --brand2:#2d7dd2; --ok:#1a8f4c; --warn:#c4461f; --pending:#d99a00; --accent:#eef4fb;
```

Bo góc 12–14px, thẻ nền trắng có viền mảnh, nút cao ≥ 44px (dễ bấm trên điện thoại).

### 9.3 Báo cáo phiên (theo tiêu chí nghiệm thu)

Hiển thị sau khi hoàn tất:

| Chỉ số | Cách tính |
|---|---|
| Số gói | `total` (gồm bắt tay) |
| Gói hợp lệ | số gói CRC đúng đã dùng |
| Gói trùng bỏ qua | `stats.dup` |
| Gói lỗi | `stats.bad` |
| Gói khác phiên | `stats.foreign` |
| Tỷ lệ nhận thành công | `valid / (valid + bad)` |
| Thời gian truyền | từ gói hợp lệ đầu tiên tới `finish()` (giây, 1 số lẻ) |
| Dung lượng | nén (byte) → giải nén (byte) |

---

## 10. CÁC BẪY CẦN TRÁNH (checklist)

- [ ] Không `trim()`, không `toUpperCase()` chuỗi QR (Base45 có dấu cách).
- [ ] Đọc số nguyên **big-endian** bằng `DataView` với `byteOffset` đúng (`new DataView(u8.buffer, u8.byteOffset, u8.byteLength)`).
- [ ] CRC tính trên **header + payload**, KHÔNG gồm 4 byte CRC ở cuối.
- [ ] Giải nén bằng **`inflateRaw`** (không phải `inflate` hay `ungzip`).
- [ ] SHA-256 trên byte **sau giải nén**, chưa parse lại.
- [ ] Có hàng đợi **pending** cho gói đến trước bắt tay.
- [ ] Quét ảnh **tuần tự**, **mỗi ảnh một canvas**, bọc try/catch.
- [ ] Ảnh nhiều QR → **quét theo ô chồng lấn** (mục 6.1), không chỉ gọi jsQR một lần.
- [ ] Gói khác `fileId` không được trộn vào phiên hiện tại.
- [ ] `total` header phải khớp `hs.total`.
- [ ] Camera: `playsinline`, `facingMode: environment`, xử lý lỗi quyền/HTTPS.
- [ ] Cột PO xuất Excel không bị thành dạng khoa học.
- [ ] Tiếng Việt có dấu hiển thị và xuất đúng (UTF-8 xuyên suốt, `<meta charset="utf-8">`).

---

## 11. TEST VECTOR & KIỂM THỬ NGHIỆM THU

### 11.1 Test vector (dữ liệu thật do bên gửi tạo — 4 dòng, 5 gói)

Năm chuỗi QR (đúng nguyên văn, **chú ý có dấu cách bên trong**):

```json
[
  ":B9:NAV50*D32S7000500N30MPFHWE3WE7UD6G73Q5OQEQCCWF7EOCB461DCXJCJ-CWZC:A6:/6EM6FA7L-CXICJ*6KA7OF66:66UC-Q62:6L*6WG60:6G%6RW6% C5UCF46:A6Y CSW63R65:6IE4*F4WE4 Q6UF4S9ENPCWE4X96:F4NPC0$CQCC:G79F480A3Q5NZ96VC7UD3Q5N7ACECPBA3Q5T7AV3EPBA3Q5XIAB$DZEDIE4CF43WENWE:OE% B/3Q.XE",
  ":B9:NAW50*D32S7100500F10B$B+L9JPO O1$6N 83R69A3CV6M/18KN2C/66G9M1RN:1:3NI EB8U2X15G260EO-JMQQVNH2UFEA1HA4TENS04$HC+ 0LSB",
  ":B9:NAW50*D32S7200500F10M413S7T%L9POKNRW$Q1*3ZON$TQ0ZI$BBEDADUNRCH.TIQBGDUV9R1SRDWSUFQDMKDXCJSRBD71TCGW%QO*B2WB %0R%ATEK",
  ":B9:NAW50*D32S7300500F10Y0BL*C39W/A93IMC+V4RM:7D4I8LAHCJ2.DKM41 UJPB0DB1ATA5:GG2K- DXS4.XEJ4WL93Q7H+KFXUSZFVFLGP4S35G3FK",
  ":B9:NAW50*D32S7400500E00/KO-:NS31+/SY94NKU4LUP1G:*Q"
]
```

Kết quả mong đợi:

- `fileId` = `0x1a2b3c4d`, `total` = 5, `epoch` = 1, `n` = 4.
- Gói `idx=1` sau b45decode, dạng hex (để kiểm bộ giải mã Base45 + header):
  `494c535101011a2b3c4d00010005003c5d8f4b0ac2500c45b7221947485a5f7daf333fa013f137114a07d5d60fbcb6a27524eec10db812a76ec49d98d2528aa37bef09b92177b8821fc0620e067c5c04`
  (magic `494c5351`, ver `01`, type `01`, fileId `1a2b3c4d`, idx `0001`, total `0005`, len `003c` = 60)
- SHA-256 = `c205a6bdf4e31d713b90f6b76d952178d841746f2f726451efd7091deb524877`
- JSON sau giải nén (nguyên văn):
  ```
  {"s":["PO","Model","PlanQ","ProdQ","Remain","Status"],"c":[[11075090139,11075088812,11075091001,11075091002],["GH96-16355A","GH96-15937D","GH96-16012B","GH96-16012B"],[1,960,1200,800],[1,960,450,null],[0,0,750,800],["Completed","Completed","Đang SX","Chờ"]],"m":"full","d":[],"b":0}
  ```
- Bảng dựng lại:
  ```
  [[11075090139,"GH96-16355A",1,1,0,"Completed"],
   [11075088812,"GH96-15937D",960,960,0,"Completed"],
   [11075091001,"GH96-16012B",1200,450,750,"Đang SX"],
   [11075091002,"GH96-16012B",800,null,800,"Chờ"]]
  ```

### 11.2 Trang tự kiểm thử `test/testvector.html`

Tạo trang chạy các ca sau, hiển thị ĐẠT/KHÔNG ĐẠT từng ca:

| # | Ca kiểm thử | Mong đợi |
|---|---|---|
| T1 | Đưa 5 chuỗi theo đúng thứ tự | Hoàn tất, SHA khớp, bảng đúng 11.1 |
| T2 | Đưa theo thứ tự ngược (gói bắt tay cuối cùng) | Như T1 (nhờ pending) |
| T3 | Xáo trộn ngẫu nhiên 20 lần | 20/20 như T1 |
| T4 | Lặp mỗi chuỗi 3 lần | Như T1; `dup` = 10 |
| T5 | Sửa 1 ký tự trong chuỗi gói 2 | Gói 2 bị loại (`bad`+1), chưa hoàn tất; đưa lại chuỗi đúng → hoàn tất |
| T6 | Xoá hết dấu cách bên trong chuỗi gói 2 (chuỗi 1–4 đều có dấu cách) | Gói bị loại (`bad`+1) → chứng tỏ dấu cách là dữ liệu; code không được xoá/chuẩn hoá khoảng trắng |
| T7 | Trộn thêm 1 gói của phiên khác (đổi fileId, tính lại CRC) | `foreign` +1, kết quả vẫn đúng |
| T8 | Thiếu gói 3 | Không hoàn tất; UI hiện ô 3 còn xám |

### 11.3 Kiểm thử với bên gửi thật

1. Mở `GuiDuLieu_QR.html` trên máy tính → `Dùng dữ liệu mẫu đã nhúng` → `Tạo QR` (mặc định 8 QR, 208 PO).
2. **Ca A — chụp 1 ảnh cả lưới**: điện thoại chụp màn hình chứa đủ 8 QR → `Chọn ảnh QR` → phải đủ 8/8, SHA khớp, 208 dòng.
3. **Ca B — chụp nhiều ảnh, thứ tự lộn xộn** (mỗi ảnh 2–3 QR, gói HS nằm ở ảnh cuối) → chọn tất cả cùng lúc → đủ 8/8.
4. **Ca C — camera**: mở trang qua GitHub Pages → `Bật camera` → bên gửi bấm `Chiếu tuần tự` → đủ 8/8 trong < 15 giây.
5. **Ca D — delta**: bên gửi sửa vài dòng trong Excel, tích `Chỉ gửi dòng thay đổi` → `Tạo QR` → bên nhận ghép vào bản gốc, số dòng sau ghép vẫn 208, các dòng sửa đúng giá trị mới.
6. **So sánh vào/ra**: Excel xuất từ bên nhận phải trùng 100% với các cột PO / Model Code / Plan Q'ty / Production Q'ty / Remain Q'ty / Plan Status trong sheet `Plan` của file gốc (cùng thứ tự dòng, cùng giá trị, tiếng Việt nguyên dấu).

### 11.4 Tiêu chí nghiệm thu

- Không mất dữ liệu; không đổi thứ tự hàng/cột; không sai giá trị số; giữ tiếng Việt có dấu.
- Phát hiện được gói thiếu / trùng / sai / khác phiên.
- Khôi phục đầy đủ khi quét đủ gói, kể cả khi bị gián đoạn (ảnh chọn nhiều lần).
- Có báo cáo số gói, tỷ lệ nhận thành công, thời gian truyền.

---

## 12. TRIỂN KHAI GITHUB PAGES

1. Tạo repo (vd `qr-receiver`) dưới tài khoản GitHub của bạn, đưa thư mục `qr-receiver/` lên nhánh `main`.
2. Settings → Pages → Source: `Deploy from a branch` → `main` / `(root)` → Save.
3. Mở `https://<tài-khoản>.github.io/qr-receiver/` trên điện thoại → cho phép camera.
4. (Tùy chọn) Thêm `manifest.json` + service worker đơn giản để "Thêm vào màn hình chính" và chạy offline sau lần mở đầu.

> Dữ liệu chỉ xử lý **trên điện thoại**, trang không gửi dữ liệu đi đâu. Không thêm bất kỳ mã theo dõi/analytics nào.

---

## 13. THỨ TỰ LÀM ĐỀ XUẤT CHO AI LẬP TRÌNH

1. Viết module giao thức: `crc32`, `b45decode`, `parsePacket(u8)` → chạy test vector 11.1 (T1–T8) cho tới khi đạt hết.
2. Viết state machine `handleQrText` + `finish` (mục 4) — kiểm lại T1–T8.
3. Làm giao diện + quét ảnh (mục 6) — kiểm Ca A, B.
4. Làm camera (mục 5) — kiểm Ca C trên GitHub Pages.
5. Làm xuất dữ liệu (mục 8) và báo cáo phiên (mục 9.3).
6. Làm delta (mục 7) — kiểm Ca D.
7. Rà checklist mục 10 lần cuối.

**Không chuyển sang bước sau khi bước trước chưa ĐẠT kiểm thử.**
