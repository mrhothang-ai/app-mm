// Mô phỏng bên gửi → ảnh QR tổng hợp → quét ô chồng lấn (mục 6.1) → bộ nhận. Kiểm Ca A, B, D bằng Node: node test/sim.cjs
const ILSQ = require('../ilsq.js'), pako = require('../lib/pako.min.js'), jsQR = require('../lib/jsQR.js');
const { makeRows, send, grid, photo, crop, erase } = require('./sender-sim.cjs');

async function scanImages(rx, images) {
  for (const cv of images) {
    const work = { W: cv.W, H: cv.H, data: new Uint8ClampedArray(cv.data) };   // mỗi ảnh 1 bản làm việc riêng (giống canvas riêng)
    await ILSQ.tileScan(work.W, work.H, crop(work), jsQR, { erase: erase(work), onFound: t => rx.handleQrText(t), done: () => rx.state.done });
  }
  return rx.state.finishing ? rx.state.finishing : null;
}

(async () => {
  const results = [], add = (id, name, pass, detail) => { results.push(pass); console.log(`${pass ? 'ĐẠT      ' : 'KHÔNG ĐẠT'} ${id}  ${name}  · ${detail}`); };
  const rows = makeRows(208), { texts, json } = send(rows);
  const sizes = texts.map(t => t.length);
  console.log(`  bên gửi: 208 PO · JSON ${json.length} B → ${texts.length} QR, mỗi QR ${Math.min(...sizes)}–${Math.max(...sizes)} ký tự`);
  const same = res => res && res.ok && res.shaOk === true && JSON.stringify(res.rows) === JSON.stringify(rows) && res.rows.length === 208;
  const mk = () => ILSQ.createReceiver({ inflateRaw: u => pako.inflateRaw(u) });

  let t = Date.now(), g = grid(texts, 4, 3), rx = mk(), res = await scanImages(rx, [g.cv]);
  add('A1', 'Ca A: 1 ảnh cả lưới 8 QR (ảnh sắc nét)', same(res), `${g.cv.W}×${g.cv.H}px · ${rx.progress().have.length + 1}/8 · ${Date.now() - t} ms`);
  t = Date.now(); g = grid(texts, 4, 5); rx = mk(); res = await scanImages(rx, [photo(g.cv)]);
  add('A2', 'Ca A: 1 ảnh "chụp" (mờ + nhiễu + giảm tương phản)', same(res), `${rx.progress().have.length + (rx.progress().hs ? 1 : 0)}/8 · ${Date.now() - t} ms`);

  const order = [[3, 5], [1, 7, 2], [6, 4], [0]];   // gói HS (0) ở ảnh cuối
  t = Date.now(); rx = mk(); res = await scanImages(rx, order.map((ix, k) => photo(grid(ix.map(i => texts[i]), ix.length, 5).cv, 11 + k)));
  add('B1', 'Ca B: 4 ảnh 1–3 QR, lộn xộn, HS ở ảnh cuối', same(res), `pending trước HS rồi phát lại · ${Date.now() - t} ms · dup=${rx.state.stats.dup}`);

  rx = mk(); await scanImages(rx, [grid([texts[2], texts[5]], 2, 4).cv]);
  const mid = rx.progress();
  res = await scanImages(rx, [grid([texts[0], texts[1], texts[3]], 3, 4).cv, grid([texts[4], texts[6], texts[7], texts[2]], 4, 4).cv]);
  add('B2', 'Gián đoạn: chọn ảnh nhiều lần, có ảnh trùng gói', mid.pendingCount === 2 && same(res), `lần 1 giữ ${mid.pendingCount} gói chờ HS · dup=${rx.state.stats.dup}`);

  // delta (Ca D): sửa 3 dòng, xoá 1 → bên nhận ghép vào bản gốc
  const base = ILSQ.baseFromFull(res.obj, res.rows, 3), edited = rows.map(r => [...r]);
  [5, 50, 150].forEach(i => { edited[i][3] = (edited[i][3] || 0) + 1; edited[i][4] = edited[i][2] - edited[i][3]; edited[i][5] = 'Đang SX'; });
  const del = rows[100][0], dRows = [5, 50, 150].map(i => edited[i]);
  const dSend = send(dRows, { fileId: 0x0de17a01, packets: 2, epoch: 4, mode: 'delta', d: [del], b: 3 });
  rx = mk(); res = await scanImages(rx, [grid(dSend.texts, 2, 4).cv]);
  const m = ILSQ.mergeDelta(base, res.obj, res.rows, res.hs.epoch), after = ILSQ.baseRows(m.base);
  const expect = edited.filter(r => r[0] !== del);
  add('D', 'Ca D: delta 3 dòng sửa + 1 xoá ghép vào bản gốc', m.ok && JSON.stringify(after) === JSON.stringify(expect), `${after.length} dòng sau ghép · sửa ${m.changed.length} · xoá ${m.removed.length}`);

  const bad = results.filter(x => !x).length;
  console.log(bad ? `\n${bad}/${results.length} ca KHÔNG ĐẠT` : `\nĐẠT ${results.length}/${results.length}`);
  process.exit(bad ? 1 : 0);
})();
