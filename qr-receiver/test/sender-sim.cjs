// Bên gửi giả lập đúng giao thức ILSQ v1 (mục 3) + dựng ảnh QR tổng hợp. Dùng cho test/sim.cjs và test/e2e.cjs.
const crypto = require('crypto');
const ILSQ = require('../ilsq.js'), pako = require('../lib/pako.min.js'), qrgen = require('qrcode-generator');

// ---- bên gửi giả lập ----
function makeRows(n) {
  const st = ['Completed', 'Đang SX', 'Chờ', 'Cancel'], rows = [];
  for (let i = 0; i < n; i++) {
    const plan = 50 + (i * 37) % 1500, prod = i % 4 === 2 ? null : Math.min(plan, (i * 53) % 1600);
    rows.push([11075090000 + i * 7, `GH96-${16000 + (i * 13) % 900}${'ABCD'[i % 4]}`, plan, prod, prod === null ? plan : plan - prod, st[i % 4]]);
  }
  return rows;
}
function send(rows, { fileId = 0x5eed1234, packets = 8, epoch = 3, mode = 'full', d = [], b = 0 } = {}) {
  const s = ['PO', 'Model', 'PlanQ', 'ProdQ', 'Remain', 'Status'];
  const json = Buffer.from(JSON.stringify({ s, c: s.map((_, i) => rows.map(r => r[i])), m: mode, d, b }), 'utf8');
  const z = pako.deflateRaw(json, { level: 9 }), nData = packets - 1, size = Math.ceil(z.length / nData);
  const pkt = (type, idx, payload) => {
    const u = new Uint8Array(20 + payload.length), dv = new DataView(u.buffer);
    u.set([0x49, 0x4C, 0x53, 0x51]); dv.setUint8(4, 1); dv.setUint8(5, type); dv.setUint32(6, fileId); dv.setUint16(10, idx); dv.setUint16(12, packets); dv.setUint16(14, payload.length);
    u.set(payload, 16); dv.setUint32(16 + payload.length, ILSQ.crc32(u.subarray(0, 16 + payload.length)));
    return ILSQ.b45encode(u);
  };
  const hs = Buffer.from(JSON.stringify({ total: packets, sha: crypto.createHash('sha256').update(json).digest('hex'), n: rows.length, epoch, schema: s }), 'utf8');
  const out = [pkt(0, 0, hs)];
  for (let i = 0; i < nData; i++) out.push(pkt(1, i + 1, z.subarray(i * size, (i + 1) * size)));
  return { texts: out, json };
}

// ---- dựng ảnh RGBA: lưới QR trên nền trắng (giống chụp màn hình bên gửi) ----
function canvas(W, H) { const data = new Uint8ClampedArray(W * H * 4).fill(255); return { W, H, data }; }
function drawQr(cv, text, x0, y0, px) {
  const q = qrgen(0, 'M'); q.addData(text, 'Alphanumeric'); q.make();
  const n = q.getModuleCount();
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c))
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) { const i = ((y0 + r * px + y) * cv.W + x0 + c * px + x) * 4; cv.data[i] = cv.data[i + 1] = cv.data[i + 2] = 0; }
  return (n + 8) * px;
}
function grid(texts, cols, px) {
  const n0 = (() => { const q = qrgen(0, 'M'); q.addData(texts[0], 'Alphanumeric'); q.make(); return q.getModuleCount(); })();
  const cell = (Math.max(...texts.map(t => { const q = qrgen(0, 'M'); q.addData(t, 'Alphanumeric'); q.make(); return q.getModuleCount(); })) + 8) * px;
  const rows = Math.ceil(texts.length / cols), cv = canvas(cols * cell + 40, rows * cell + 40);
  texts.forEach((t, i) => drawQr(cv, t, 20 + (i % cols) * cell + 4 * px, 20 + Math.floor(i / cols) * cell + 4 * px, px));
  return { cv, n0 };
}
// "chụp": nhiễu cảm biến → làm mờ 3×3 (ống kính / nén ảnh) → giảm tương phản + lệch sáng (giả lập ảnh điện thoại chụp màn hình)
function photo(cv, seed = 7) {
  const { W, H, data } = cv, noisy = new Float32Array(W * H), out = new Uint8ClampedArray(data.length);
  let s = seed; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < W * H; i++) noisy[i] = data[i * 4] + (rnd() - 0.5) * 40;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let sum = 0, k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < H && xx >= 0 && xx < W) { sum += noisy[yy * W + xx]; k++; } }
    const v = 45 + (sum / k) * 0.65 + 15 * x / W, i = (y * W + x) * 4;   // tương phản 65%, sáng lệch dần sang phải
    out[i] = out[i + 1] = out[i + 2] = v; out[i + 3] = 255;
  }
  return { W, H, data: out };
}
const erase = cv => (x, y, w, h) => { for (let r = y; r < y + h; r++) cv.data.fill(255, (r * cv.W + x) * 4, (r * cv.W + x + w) * 4); };
const crop = cv => (x, y, w, h) => { const d = new Uint8ClampedArray(w * h * 4); for (let r = 0; r < h; r++) d.set(cv.data.subarray(((y + r) * cv.W + x) * 4, ((y + r) * cv.W + x + w) * 4), r * w * 4); return { data: d }; };


// PNG RGBA tối giản (zlib của Node) — để tải ảnh lên trình duyệt trong e2e
function png(cv) {
  const zlib = require('zlib'), raw = Buffer.alloc((cv.W * 4 + 1) * cv.H);
  for (let y = 0; y < cv.H; y++) { raw[y * (cv.W * 4 + 1)] = 0; Buffer.from(cv.data.buffer, cv.data.byteOffset + y * cv.W * 4, cv.W * 4).copy(raw, y * (cv.W * 4 + 1) + 1); }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(cv.W, 0); ih.writeUInt32BE(cv.H, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = { makeRows, send, grid, photo, crop, erase, png, canvas, drawQr };
