/* ILSQ v1 — giao thức + bộ nhận (state machine). Dùng chung cho trình duyệt (window.ILSQ) và Node (require).
   Đặc tả: HUONG_DAN_TAO_TRINH_NHAN_QR.md mục 3, 4, 7. Không trim / đổi hoa-thường chuỗi QR: dấu cách là dữ liệu Base45. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ILSQ = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- 3.3 CRC32 (IEEE 802.3) ----
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

  // ---- 3.4 Base45 (RFC 9285) ----
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
  // Chỉ dùng cho kiểm thử (tạo gói giả) — bên nhận không cần mã hoá.
  function b45encode(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 2) {
      if (i + 1 < u8.length) { let x = (u8[i] << 8) | u8[i + 1]; s += B45[x % 45]; x = Math.floor(x / 45); s += B45[x % 45] + B45[Math.floor(x / 45)]; }
      else { const x = u8[i]; s += B45[x % 45] + B45[Math.floor(x / 45)]; }
    }
    return s;
  }

  // ---- 3.2 Gói nhị phân (big-endian) ----
  const MAGIC = [0x49, 0x4C, 0x53, 0x51];
  function parsePacket(u8) {
    if (!u8 || u8.length < 20) return null;
    for (let i = 0; i < 4; i++) if (u8[i] !== MAGIC[i]) return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (dv.getUint8(4) !== 1) return null;
    const len = dv.getUint16(14);
    if (20 + len > u8.length) return null;
    if (crc32(u8.subarray(0, 16 + len)) !== dv.getUint32(16 + len)) return null;
    return { type: dv.getUint8(5), fileId: dv.getUint32(6), idx: dv.getUint16(10), total: dv.getUint16(12), len, payload: u8.slice(16, 16 + len) };
  }
  function decodeText(text) { try { return parsePacket(b45decode(text)); } catch { return null; } }
  // Sắp xếp chuỗi quét được trong 1 ảnh: gói bắt tay trước (mục 6.1 bước 6).
  function handshakeFirst(texts) {
    const t = s => { const p = decodeText(s); return p ? p.type : 9; };
    return [...texts].sort((a, b) => t(a) - t(b));
  }
  const hex8 = n => (n >>> 0).toString(16).padStart(8, '0');
  const utf8 = u8 => new TextDecoder('utf-8').decode(u8);

  // SHA-256: crypto.subtle (HTTPS / localhost); trang mở qua HTTP thường (VD trong app MM nội bộ) → bản JS thuần (FIPS 180-4) để vẫn kiểm được.
  const K256 = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d,
    0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256js(u8) {
    const n = u8.length, total = Math.ceil((n + 9) / 64) * 64, m = new Uint8Array(total);
    m.set(u8); m[n] = 0x80;
    const dv = new DataView(m.buffer); dv.setUint32(total - 8, Math.floor(n / 0x20000000)); dv.setUint32(total - 4, (n * 8) >>> 0);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), w = new Uint32Array(64);
    const ror = (x, r) => (x >>> r) | (x << (32 - r));
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
        const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    return [...H].map(x => x.toString(16).padStart(8, '0')).join('');
  }
  async function sha256Hex(u8) {
    const subtle = (typeof crypto !== 'undefined' && crypto.subtle) || null;
    if (!subtle) return sha256js(u8);
    const h = new Uint8Array(await subtle.digest('SHA-256', u8));
    return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ---- 4. Bộ nhận ----
  // opts.inflateRaw(u8) → Uint8Array (pako.inflateRaw); opts.onEvent(type, info) để UI cập nhật.
  function createReceiver(opts) {
    const inflateRaw = opts.inflateRaw, emit = opts.onEvent || (() => {});
    const S = {};
    function reset(silent) {
      Object.assign(S, { fileId: null, total: null, hs: null, parts: new Map(), pending: [], seen: new Set(), done: false, result: null, finishing: null,
        stats: { scanned: 0, valid: 0, dup: 0, bad: 0, foreign: 0, t0: null, t1: null } });
      if (!silent) emit('reset', {});
    }
    reset(true);   // lần đầu không phát sự kiện: lúc này bên gọi chưa nhận được đối tượng receiver

    function addPart(p) {
      if (p.fileId !== S.fileId) { S.stats.foreign++; return 'foreign'; }
      if (p.total !== S.total || p.idx < 1 || p.idx >= S.total) { S.stats.bad++; return 'bad'; }
      if (S.parts.has(p.idx)) { S.stats.dup++; return 'dup'; }
      S.parts.set(p.idx, p.payload); S.stats.valid++;
      return 'new';
    }

    // Trả về { status, idx } — status: new | handshake | pending | dup | bad | foreign | ignored
    function handleQrText(text) {
      S.stats.scanned++;
      if (S.done) { if (S.seen.has(text)) S.stats.dup++; return { status: 'ignored' }; }
      if (S.seen.has(text)) { S.stats.dup++; return { status: 'dup' }; }
      S.seen.add(text);
      const p = decodeText(text);
      if (!p || (p.type !== 0 && p.type !== 1)) { S.stats.bad++; emit('update', {}); return { status: 'bad' }; }
      if (S.stats.t0 === null) S.stats.t0 = Date.now();
      let res;
      if (p.type === 0) {
        let hs;
        try { hs = JSON.parse(utf8(p.payload)); } catch { hs = null; }
        if (!hs || hs.total !== p.total || p.idx !== 0 || p.total < 1) { S.stats.bad++; emit('update', {}); return { status: 'bad' }; }
        if (S.fileId !== null && S.fileId === p.fileId && S.hs) { S.stats.dup++; return { status: 'dup' }; }
        if (S.fileId !== null && S.fileId !== p.fileId) {
          emit('newSession', { from: hex8(S.fileId), to: hex8(p.fileId) });
          S.parts = new Map();
        }
        S.hs = hs; S.fileId = p.fileId; S.total = p.total; S.stats.valid++;
        const keep = S.pending; S.pending = [];
        for (const q of keep) addPart(q);   // phát lại gói đến trước bắt tay; khác phiên → foreign
        res = { status: 'handshake', idx: 0 };
      } else if (S.fileId === null) {
        S.pending.push(p);
        res = { status: 'pending', idx: p.idx };
      } else {
        res = { status: addPart(p), idx: p.idx };
      }
      emit('update', res);
      if (S.fileId !== null && S.parts.size === S.total - 1) finish();
      return res;
    }

    // 4.3: ghép → inflateRaw → SHA-256 → JSON → bảng. Kết quả lưu ở S.result và phát sự kiện 'done'.
    function finish() {
      S.done = true; S.stats.t1 = Date.now();
      const r = { ok: false, error: '', fileId: hex8(S.fileId), hs: S.hs, total: S.total, stats: { ...S.stats }, shaOk: null, sha: '', rows: [], obj: null, zipBytes: 0, rawBytes: 0 };
      const chunks = []; for (let i = 1; i < S.total; i++) chunks.push(S.parts.get(i));
      const merged = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
      let o = 0; for (const c of chunks) { merged.set(c, o); o += c.length; }
      r.zipBytes = merged.length;
      const p = (async () => {
        let raw;
        try { raw = inflateRaw(merged); } catch (e) { r.error = 'Lỗi giải nén: ' + (e.message || e); return r; }
        if (!raw || !raw.length) { r.error = 'Lỗi giải nén: dữ liệu rỗng'; return r; }
        r.rawBytes = raw.length;
        try { r.sha = await sha256Hex(raw); } catch { r.sha = null; }
        r.shaOk = r.sha ? r.sha === String(S.hs.sha || '').toLowerCase() : null;
        let obj;
        try { obj = JSON.parse(utf8(raw)); } catch (e) { r.error = 'JSON lỗi: ' + e.message; return r; }
        if (!Array.isArray(obj.s) || !Array.isArray(obj.c) || obj.c.length !== obj.s.length) { r.error = 'Sai cấu trúc: số cột không khớp schema'; return r; }
        const n = obj.c.length ? obj.c[0].length : 0;
        if (obj.c.some(col => !Array.isArray(col) || col.length !== n)) { r.error = 'Sai cấu trúc: các cột không cùng độ dài'; return r; }
        if (typeof S.hs.n === 'number' && n !== S.hs.n) { r.error = `Số dòng ${n} ≠ ${S.hs.n} trong gói bắt tay`; return r; }
        r.obj = obj; r.rawText = utf8(raw);
        r.rows = obj.c.length ? obj.c[0].map((_, i) => obj.s.map((_, j) => obj.c[j][i])) : [];
        r.ok = true;
        return r;
      })().then(res => { S.result = res; emit('done', res); return res; });
      S.finishing = p;
      return p;
    }

    // Tiến độ cho UI: ô nào đã có / đang giữ.
    function progress() {
      const pendIdx = new Set(S.pending.map(p => p.idx));
      return { fileId: S.fileId === null ? '' : hex8(S.fileId), total: S.total, hs: S.hs, have: [...S.parts.keys()], pending: [...pendIdx], pendingCount: S.pending.length, done: S.done, stats: { ...S.stats } };
    }
    return { handleQrText, reset, progress, state: S };
  }

  // ---- 7. Delta: ghép vào bản gốc. base = { epoch, schema, map, order } ; trả bản gốc mới (không sửa base) ----
  function mergeDelta(base, obj, rows, epoch) {
    if (!base || base.epoch !== obj.b) return { ok: false, error: `Bản gốc trên máy (#${base ? base.epoch : '–'}) không khớp bản delta dựa vào (#${obj.b}). Hãy yêu cầu bên gửi tạo bản FULL (bỏ tích 'Chỉ gửi dòng thay đổi').` };
    const map = { ...base.map }, order = [...(base.order || Object.keys(base.map))], added = [], changed = [], removed = [];
    for (const row of rows) {
      const k = String(row[0]);
      if (!(k in map)) { added.push(k); order.push(k); } else if (JSON.stringify(map[k]) !== JSON.stringify(row)) changed.push(k);
      map[k] = row;
    }
    for (const po of obj.d || []) { const k = String(po); if (k in map) { delete map[k]; removed.push(k); } }
    const gone = new Set(removed);
    return { ok: true, base: { epoch, schema: obj.s, map, order: order.filter(k => !gone.has(k) && k in map), savedAt: new Date().toISOString() }, added, changed, removed };
  }
  function baseFromFull(obj, rows, epoch) {
    const map = {}, order = [];
    for (const row of rows) { const k = String(row[0]); if (!(k in map)) order.push(k); map[k] = row; }
    return { epoch, schema: obj.s, map, order, savedAt: new Date().toISOString() };
  }
  const baseRows = base => base.order.map(k => base.map[k]);

  // ---- 6.1 Quét ảnh nhiều QR theo ô chồng lấn ----
  // getImageData(x, y, w, h) → { data } RGBA; jsQR = hàm jsQR. opts: onFound(text) nhận mã ngay khi đọc được; done() = true → dừng sớm;
  // yield() nhường UI giữa các hàng ô; erase(x, y, w, h) tô trắng vùng QR vừa đọc rồi quét lại chính ô đó (jsQR mỗi lần chỉ trả 1 mã).
  // Các lượt:
  //  1. Đặc tả 6.1: ô W/div × H/div (div 1–4), bước 50%.
  //  2. Chưa đọc được mã nào: ô vuông min(W,H)/d (d 1–4), bước 1/3 (ảnh dẹt: ô lượt 1 thấp hơn 1 QR).
  //  3. Ô thích nghi: QR bên gửi cùng cỡ → biết cỡ q từ mã đã đọc, quét ô 1,3q bước 0,15q: mỗi QR lọt trọn 1 ô, ít dính mã bên cạnh
  //     (lưới QR kín ảnh thì ô chia đều luôn cắt ngang hoặc gồm nửa QR kế bên → jsQR không đọc được). Lặp tới khi không thêm mã mới.
  async function tileScan(W, H, getImageData, jsQR, opts) {
    opts = opts || {};
    const found = new Set(), stop = () => !!(opts.done && opts.done());
    let qsize = 0;
    async function pass(tw, th, sx, sy) {
      if (tw < 60 || th < 60) return;
      tw = Math.min(tw, W); th = Math.min(th, H);
      for (let y = 0; ; y += sy) {
        const oy = Math.min(y, H - th);
        for (let x = 0; ; x += sx) {
          const ox = Math.min(x, W - tw);
          for (let k = 0; k < 64; k++) {
            let code = null;
            try { code = jsQR(getImageData(ox, oy, tw, th).data, tw, th, { inversionAttempts: 'attemptBoth' }); } catch { code = null; }
            if (!code || typeof code.data !== 'string' || !code.data.length) break;
            if (!found.has(code.data)) { found.add(code.data); if (opts.onFound) opts.onFound(code.data); }
            if (!code.location) break;
            const L = code.location, xs = [L.topLeftCorner.x, L.topRightCorner.x, L.bottomLeftCorner.x, L.bottomRightCorner.x], ys = [L.topLeftCorner.y, L.topRightCorner.y, L.bottomLeftCorner.y, L.bottomRightCorner.y];
            const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), side = Math.max(x1 - x0, y1 - y0);
            qsize = Math.max(qsize, side);
            if (!opts.erase) break;
            const m = side * 0.06 + 2, ex = Math.max(0, Math.floor(ox + x0 - m)), ey = Math.max(0, Math.floor(oy + y0 - m));
            opts.erase(ex, ey, Math.min(W, Math.ceil(ox + x1 + m)) - ex, Math.min(H, Math.ceil(oy + y1 + m)) - ey);
          }
          if (stop()) return;
          if (ox >= W - tw) break;
        }
        if (opts.yield) await opts.yield();
        if (stop() || oy >= H - th) return;
      }
    }
    async function adaptive() {
      if (!qsize || stop()) return;
      const t = Math.ceil(qsize * 1.3), st = Math.max(4, Math.floor(qsize * 0.15));
      await pass(t, t, st, st);
    }
    const rect = async divs => { for (const div of divs) { if (stop()) return; await pass(Math.floor(W / div), Math.floor(H / div), Math.max(1, Math.floor(W / div / 2)), Math.max(1, Math.floor(H / div / 2))); } };
    await rect([1, 2, 3, 4]);
    if (!qsize) {
      const S0 = Math.min(W, H);
      for (const d of [1, 1.5, 2, 2.5, 3, 4]) { if (stop() || qsize) break; const q = Math.floor(S0 / d); await pass(q, q, Math.max(1, Math.floor(q / 3)), Math.max(1, Math.floor(q / 3))); }
    }
    // Lặp: mỗi vòng xoá thêm mã đã đọc → mã còn lại "sạch" hơn (khi chỉ còn 1 mã, ô cả ảnh đọc được). Dừng khi vòng không thêm mã mới.
    for (let round = 0; round < 8 && qsize && !stop(); round++) {
      const before = found.size;
      await adaptive();
      if (opts.erase) await rect([1, 2]);
      if (found.size === before) break;
    }
    return found;
  }

  return { crc32, b45decode, b45encode, parsePacket, decodeText, handshakeFirst, sha256Hex, sha256js, createReceiver, mergeDelta, baseFromFull, baseRows, tileScan, hex8 };
});
