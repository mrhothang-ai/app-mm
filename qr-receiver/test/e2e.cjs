// Kiểm thử trên Chromium thật (headless) qua http://localhost (ngữ cảnh an toàn → có camera + crypto.subtle):
//   testvector.html · Ca A (1 ảnh cả lưới) · xuất Excel/JSON · Ca B (nhiều ảnh, HS cuối) · Ca D (delta) · delta lệch gốc · Ca C (camera giả chiếu tuần tự).
// Chạy trong image có chromium + puppeteer-core (xem README): node test/e2e.cjs
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const puppeteer = require('puppeteer-core'), XLSX = require('../lib/xlsx.full.min.js');
const { makeRows, send, grid, photo, png, canvas, drawQr } = require('./sender-sim.cjs');
const qrgen = require('qrcode-generator');

const ROOT = path.join(__dirname, '..'), TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qre2e-')), DL = path.join(TMP, 'dl');
fs.mkdirSync(DL);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };
const server = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});

// ---- dữ liệu + ảnh mẫu ----
const rows = makeRows(208), full = send(rows, { fileId: 0x5eed1234, packets: 8, epoch: 3 });
const save = (name, cv) => { const p = path.join(TMP, name); fs.writeFileSync(p, png(cv)); return p; };
const imgA = save('A_luoi_8QR.png', photo(grid(full.texts, 4, 5).cv));
const imgB = [[3, 5], [1, 7, 2], [6, 4], [0]].map((ix, k) => save(`B${k + 1}.png`, photo(grid(ix.map(i => full.texts[i]), ix.length, 5).cv, 21 + k)));
const edited = rows.map(r => [...r]);
[5, 50, 150].forEach(i => { edited[i][3] = (edited[i][3] || 0) + 7; edited[i][4] = edited[i][2] - edited[i][3]; edited[i][5] = 'Đang SX'; });
const del = rows[100][0], delta = send([5, 50, 150].map(i => edited[i]), { fileId: 0x0de17a01, packets: 2, epoch: 4, mode: 'delta', d: [del], b: 3 });
const imgD = save('D_delta.png', grid(delta.texts, 2, 5).cv);
// video camera giả (y4m, 10 fps): chiếu tuần tự từng QR, mỗi mã 4 khung — như nút "Chiếu tuần tự" bên gửi
function y4m(texts, file) {
  const W = 640, H = 480, frames = [];
  for (const t of texts) {
    const q = qrgen(0, 'M'); q.addData(t, 'Alphanumeric'); q.make();
    const px = Math.floor(440 / (q.getModuleCount() + 8)), side = (q.getModuleCount() + 8) * px, cv = canvas(W, H);
    drawQr(cv, t, Math.floor((W - side) / 2) + 4 * px, Math.floor((H - side) / 2) + 4 * px, px);
    const Y = Buffer.alloc(W * H); for (let i = 0; i < W * H; i++) Y[i] = cv.data[i * 4];
    const yuv = Buffer.concat([Y, Buffer.alloc(W * H / 2, 128)]);
    for (let k = 0; k < 4; k++) frames.push(yuv);
  }
  const fd = fs.openSync(file, 'w'); fs.writeSync(fd, `YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`);
  for (const f of frames) { fs.writeSync(fd, 'FRAME\n'); fs.writeSync(fd, f); }
  fs.closeSync(fd); return file;
}
const cam = y4m([...full.texts.slice(1), full.texts[0]], path.join(TMP, 'cam.y4m'));   // gói HS chiếu cuối

const results = [];
const ok = (id, name, pass, detail = '') => { results.push(!!pass); console.log(`${pass ? 'ĐẠT      ' : 'KHÔNG ĐẠT'} ${id}  ${name}${detail ? '  · ' + detail : ''}`); };
// chờ file tải về xong (có tên đúng đuôi, kích thước > 0 và không đổi giữa 2 lần đo)
const waitFile = async (ext, before) => {
  let last = -1;
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 150));
    const f = fs.readdirSync(DL).filter(x => x.endsWith(ext) && !before.includes(x));
    if (!f.length) continue;
    const p = path.join(DL, f[0]); let size = -1; try { size = fs.statSync(p).size; } catch {}
    if (size > 0 && size === last) return p;
    last = size;
  }
  return null;
};
const readXlsx = f => XLSX.read(fs.readFileSync(f), { type: 'buffer', cellNF: true, cellText: true });

(async () => {
  await new Promise(r => server.listen(8765, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser', headless: true,
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${cam}`] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const cdp = await page.target().createCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
  const BASE = 'http://localhost:8765/';

  await page.goto(BASE + 'test/testvector.html');
  await page.waitForFunction(() => !/Đang chạy/.test(document.querySelector('#sum').textContent), { timeout: 30000 });
  const tv = await page.$eval('#sum', e => e.textContent);
  ok('TV', 'test/testvector.html trên trình duyệt (T1–T8 + delta)', /^ĐẠT/.test(tv), tv);

  await page.goto(BASE);
  const has = await page.evaluate(() => ({ bd: 'BarcodeDetector' in window, secure: isSecureContext, subtle: !!(crypto && crypto.subtle) }));
  console.log(`  trình duyệt: BarcodeDetector=${has.bd} · secure=${has.secure} · crypto.subtle=${has.subtle}`);
  const waitDone = (ms = 60000) => page.waitForFunction(() => !document.querySelector('#resCard').hidden, { timeout: ms }).catch(async e => {
    console.log('  [hết giờ] ', await page.evaluate(() => ['#msg', '#cnt', '#info', '#state'].map(s => document.querySelector(s).textContent).join(' | '))); throw e; });
  const state = () => page.evaluate(() => ({ sha: document.querySelector('#shaTag').textContent, n: document.querySelector('#nTag').textContent, mode: document.querySelector('#modeTag').textContent,
    trs: document.querySelectorAll('#tbl tbody tr').length, first: document.querySelector('#tbl tbody tr td:nth-child(2)')?.textContent, delta: document.querySelector('#deltaInfo').textContent,
    msg: document.querySelector('#msg').textContent, base: document.querySelector('#baseInfo').textContent, rep: [...document.querySelectorAll('#rep tr')].map(t => t.textContent).join(' | ') }));

  // Ca A
  let t = Date.now();
  await (await page.$('#fileImg')).uploadFile(imgA); await waitDone();
  let s = await state();
  ok('A', 'Ca A: 1 ảnh chụp cả lưới 8 QR → 8/8, SHA khớp, 208 dòng', /khớp/.test(s.sha) && !/KHÔNG/.test(s.sha) && s.n === '208 PO' && s.trs === 208 && s.first === String(rows[0][0]), `${Date.now() - t} ms · ${s.sha} · ${s.n} · ${s.msg}`);
  await page.screenshot({ path: path.join(TMP, 'shot_A.png'), fullPage: true });
  ok('R', 'Báo cáo phiên + bản gốc lưu trên máy', /Số gói8/.test(s.rep) && /Tỷ lệ nhận thành công100\.0%/.test(s.rep) && /#3 · 208 PO/.test(s.base), s.rep.slice(0, 120));

  // Xuất Excel / JSON
  let before = fs.readdirSync(DL); await page.click('#btnXlsx'); const fx = await waitFile('.xlsx', before);
  const wb = fx && readXlsx(fx), ws = wb && wb.Sheets['PO status'], aoa = ws ? XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) : [];
  const same = JSON.stringify(aoa) === JSON.stringify([['PO', 'Model', 'PlanQ', 'ProdQ', 'Remain', 'Status'], ...rows]);
  ok('X', 'Tải Excel: sheet "PO status", trùng 100% dữ liệu, cột PO định dạng 0', fx && /PO_status_epoch3_\d{8}_\d{4}\.xlsx$/.test(fx) && same && ws.A2.z === '0' && ws.A2.t === 'n' && ws.A2.w === String(rows[0][0]), fx ? `${path.basename(fx)} · A2: z=${ws && ws.A2.z} hiển thị "${ws && ws.A2.w}"` : 'không có file');
  before = fs.readdirSync(DL); await page.click('#btnJson'); const fj = await waitFile('.json', before);
  const js = fj && JSON.parse(fs.readFileSync(fj, 'utf8'));
  ok('J', 'Tải JSON: { schema, rows, mode, epoch, fileId, sha256, receivedAt }', js && JSON.stringify(js.rows) === JSON.stringify(rows) && js.mode === 'full' && js.epoch === 3 && js.fileId === '5eed1234' && /^[0-9a-f]{64}$/.test(js.sha256) && js.receivedAt, fj ? path.basename(fj) : 'không có file');

  // Ca B
  await page.click('#btnReset'); t = Date.now();
  await (await page.$('#fileImg')).uploadFile(...imgB); await waitDone();
  s = await state();
  ok('B', 'Ca B: chọn cùng lúc 4 ảnh (1–3 QR/ảnh, HS ở ảnh cuối) → 8/8', /khớp/.test(s.sha) && s.n === '208 PO' && s.trs === 208, `${Date.now() - t} ms · ${s.msg}`);

  // Ca D
  await page.click('#btnReset');
  await (await page.$('#fileImg')).uploadFile(imgD); await waitDone();
  s = await state();
  const marks = await page.evaluate(() => ({ chg: document.querySelectorAll('#tbl tr.chg').length, add: document.querySelectorAll('#tbl tr.add').length }));
  ok('D', 'Ca D: delta (3 sửa + 1 xoá) ghép vào bản gốc #3 → #4', /Đã ghép delta/.test(s.delta) && s.n === '207 PO' && s.trs === 207 && marks.chg === 3 && /#4 · 207 PO/.test(s.base), `${s.mode} · ${s.delta.slice(0, 90)}`);
  before = fs.readdirSync(DL); await page.click('#btnXlsx'); const fd = await waitFile('.xlsx', before);
  const aoaD = XLSX.utils.sheet_to_json(readXlsx(fd).Sheets['PO status'], { header: 1, defval: null });
  ok('DX', 'Excel sau ghép delta trùng bản đã sửa (giữ thứ tự)', JSON.stringify(aoaD.slice(1)) === JSON.stringify(edited.filter(r => r[0] !== del)), path.basename(fd));

  // delta lệch gốc: nhận lại delta b=3 khi bản gốc đã là #4
  await page.click('#btnReset');
  await (await page.$('#fileImg')).uploadFile(imgD); await waitDone();
  s = await state();
  ok('D2', 'Delta lệch bản gốc → cảnh báo, chỉ hiện dòng delta, không ghi đè', /không khớp/.test(s.delta) && s.trs === 3 && /#4 · 207 PO/.test(s.base), s.delta.slice(0, 80));
  await page.screenshot({ path: path.join(TMP, 'shot_D2.png'), fullPage: true });

  // Ca C — camera giả
  await page.click('#btnReset'); t = Date.now();
  await page.click('#btnCam');
  await waitDone(30000).catch(() => {});
  s = await state(); const sec = (Date.now() - t) / 1000, camOff = await page.$eval('#videoBox', e => e.hidden);
  ok('C', 'Ca C: camera, bên gửi chiếu tuần tự (HS cuối) → 8/8 < 15 giây, tự tắt camera', /khớp/.test(s.sha) && s.n === '208 PO' && sec < 15 && camOff, `${sec.toFixed(1)} s`);

  ok('E', 'Không lỗi JavaScript trên trang', !errs.length, errs.slice(0, 3).join(' | '));
  await browser.close(); server.close();
  for (const f of ['shot_A.png', 'shot_D2.png']) fs.copyFileSync(path.join(TMP, f), path.join(process.env.SHOT_DIR || TMP, f));
  const bad = results.filter(x => !x).length;
  console.log(bad ? `\n${bad}/${results.length} ca KHÔNG ĐẠT` : `\nĐẠT ${results.length}/${results.length}`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
