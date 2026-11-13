// E2E nối app Kitting MM: trình nhận phục vụ tại <MM>/qr/ qua HTTP thường (không phải ngữ cảnh an toàn, như http://192.168.1.221:8097/qr/).
// Cần instance MM thử (mm/fresh.sh) đang chạy, chung mạng; Chromium map tên mmtest.lan → 127.0.0.1 để trang là HTTP "không an toàn".
//   1. Chưa đăng nhập → nút gửi báo cần đăng nhập · 2. Camera ẩn, SHA-256 kiểm bằng JS thuần
//   3. Ảnh lưới QR → "Cập nhật vào app MM" → PO trong MM cập nhật đúng, PO lạ / dòng chưa có ProdQ báo đúng, không gửi lặp
//   4. Cổng Cập nhật sản xuất của MM nhận file JSON xuất từ trình nhận.
const fs = require('fs'), path = require('path'), os = require('os');
const puppeteer = require('puppeteer-core');
const { send, grid, photo, png } = require('./sender-sim.cjs');

const API = process.env.MM_API || 'http://127.0.0.1:8197', WEB = process.env.MM_WEB || 'http://mmtest.lan:8197';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qrmm-'));
const results = [];
const ok = (id, name, pass, detail = '') => { results.push(!!pass); console.log(`${pass ? 'ĐẠT      ' : 'KHÔNG ĐẠT'} ${id}  ${name}${detail ? '  · ' + detail : ''}`); };
async function call(p, { token, json } = {}) {
  const r = await fetch(API + p, { method: json ? 'POST' : 'GET', headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: token } : {}) }, body: json ? JSON.stringify(json) : undefined });
  return { status: r.status, d: await r.json().catch(() => ({})) };
}

(async () => {
  const token = (await call('/api/collections/users/auth-with-password', { json: { identity: 'ad001', password: 'Admin2026' } })).d.token;
  if (!token) throw new Error('Không đăng nhập được instance MM thử (ad001).');
  const pos = (await call('/api/mm/po', { token })).d.rows.filter(r => r.inSource && r.state !== 'cancel' && r.planQty > 10 && /^\d+$/.test(r.po)).slice(0, 30);
  // Dữ liệu "tình trạng PO" như bên gửi: ProdQ lũy kế mới cho 30 PO có thật + 1 PO lạ + 1 dòng chưa có ProdQ
  const want = new Map(pos.map((p, i) => [p.po, Math.min(p.planQty, (p.productionQty || 0) + 3 + i)]));
  const rows = pos.map(p => [Number(p.po), p.modelCode, p.planQty, want.get(p.po), p.planQty - want.get(p.po), 'Đang SX']);
  rows.push([99999999999, 'GH96-XXXXX', 10, 2, 8, 'Đang SX'], [Number(pos[0].po) + 7777777, 'GH96-YYYYY', 10, null, 10, 'Chờ']);
  const sent = send(rows, { fileId: 0x3a3b3c3d, packets: 4, epoch: 12 });
  const img = path.join(TMP, 'luoi.png'); fs.writeFileSync(img, png(photo(grid(sent.texts, 4, 5).cv)));

  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser', headless: true,
    args: ['--no-sandbox', '--host-resolver-rules=MAP mmtest.lan 127.0.0.1'] });
  const page = await browser.newPage(), errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const cdp = await page.target().createCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: TMP });

  // chưa đăng nhập
  await page.goto(WEB + '/qr/');
  const env = await page.evaluate(() => ({ secure: isSecureContext, subtle: !!(window.crypto && crypto.subtle), cam: document.querySelector('#btnCam').hidden }));
  ok('M0', 'Mở qua HTTP trong app MM: không phải ngữ cảnh an toàn, nút camera ẩn', !env.secure && !env.subtle && env.cam, JSON.stringify(env));
  await (await page.$('#fileImg')).uploadFile(img);
  await page.waitForFunction(() => !document.querySelector('#resCard').hidden, { timeout: 60000 });
  let s = await page.evaluate(() => ({ sha: document.querySelector('#shaTag').textContent, mm: !document.querySelector('#mmBox').hidden, info: document.querySelector('#mmInfo').textContent, n: document.querySelector('#nTag').textContent }));
  ok('M1', 'SHA-256 kiểm bằng JS thuần (không có crypto.subtle) → khớp', /✔ SHA-256 khớp/.test(s.sha) && s.n === '32 PO', `${s.sha} · ${s.n}`);
  ok('M2', 'Chưa đăng nhập app MM → nút gửi hướng dẫn đăng nhập', s.mm && /Chưa đăng nhập app MM/.test(s.info), s.info.slice(0, 60));

  // đăng nhập (cùng origin → dùng chung localStorage mm_token), bấm gửi
  await page.evaluate(t => localStorage.setItem('mm_token', t), token);
  await page.click('#btnMm');
  await page.waitForFunction(() => !document.querySelector('#mmDone').hidden || /Lỗi|quyền|hết|thiếu|Không/.test(document.querySelector('#mmInfo').textContent), { timeout: 20000 });
  s = await page.evaluate(() => ({ info: document.querySelector('#mmDone').textContent, back: document.querySelector('#resCard').hidden && /^0 \/ –/.test(document.querySelector('#cnt').textContent) && window.scrollY === 0,
    unk: document.querySelector('#mmDone details .po-ls')?.textContent || '', msg: document.querySelector('#msg').textContent }));
  const after = (await call('/api/mm/po', { token })).d.rows, byPo = new Map(after.map(r => [r.po, r]));
  const allOk = pos.every(p => byPo.get(p.po).productionQty === want.get(p.po) && byPo.get(p.po).remainQty === p.planQty - want.get(p.po));
  ok('M3', 'Cập nhật vào app MM: 30 PO đúng ProdQ/Remain, 1 PO lạ, 1 dòng chưa có ProdQ bỏ qua', allOk && /Cập nhật 30 PO/.test(s.info) && /1 PO chưa có trong app/.test(s.info) && /bỏ qua 1 dòng/.test(s.info), s.info.slice(0, 140));
  ok('M3b', 'Gửi xong → về màn ban đầu (sẵn sàng quét lần mới), kết quả + danh sách PO lạ giữ trong khung xanh', s.back && /Sẵn sàng/.test(s.msg) && s.unk === '99999999999', `PO lạ: ${s.unk}`);
  const log = (await call('/api/mm/po/production/log', { token })).d.rows[0];
  ok('M4', 'Nhật ký cập nhật sản xuất ghi nguồn QR', log && /^QR #12 · file 3a3b3c3d$/.test(log.source) && log.created_by === 'AD001', log && `${log.source} · ${log.created_by}`);
  const hist = (await call('/api/mm/po/history?po=' + pos[1].po, { token })).d.rows[0];
  ok('M5', 'Lịch sử PO ghi lần cập nhật từ QR', hist && hist.kind === 'prod' && /QR #12/.test(hist.source), hist && `${hist.kind} · ${hist.source}`);

  // cổng Cập nhật sản xuất của MM nhận file JSON xuất từ trình nhận
  const want2 = new Map(pos.slice(0, 5).map(p => [p.po, Math.min(p.planQty, want.get(p.po) + 1)]));
  const json = { schema: ['PO', 'Model', 'PlanQ', 'ProdQ', 'Remain', 'Status'], rows: pos.slice(0, 5).map(p => [Number(p.po), p.modelCode, p.planQty, want2.get(p.po), p.planQty - want2.get(p.po), 'Đang SX']),
    mode: 'delta', merged: false, epoch: 13, fileId: '0de17a02', sha256: 'x', shaOk: true, receivedAt: new Date().toISOString() };
  const jf = path.join(TMP, 'PO_status_epoch13_20261103_1200.json'); fs.writeFileSync(jf, JSON.stringify(json, null, 2));
  await page.goto(WEB + '/');
  await page.waitForFunction(() => !!document.querySelector('#prodFile') && !document.querySelector('#app')?.hidden !== false, { timeout: 20000 }).catch(() => {});
  await page.waitForSelector('#prodFile', { timeout: 20000 });
  await new Promise(r => setTimeout(r, 1500));
  await (await page.$('#prodFile')).uploadFile(jf);
  let ok6 = false;
  for (let i = 0; i < 40 && !ok6; i++) { await new Promise(r => setTimeout(r, 250)); const a = (await call('/api/mm/po', { token })).d.rows; ok6 = pos.slice(0, 5).every(p => a.find(x => x.po === p.po).productionQty === want2.get(p.po)); }
  const log2 = (await call('/api/mm/po/production/log', { token })).d.rows[0];
  ok('M6', 'Cổng Cập nhật SX của MM nhận file JSON từ trình nhận (delta chưa ghép → chỉ PO có trong file)', ok6 && /^QR #13 delta · PO_status_epoch13/.test(log2.source), log2 && log2.source);
  const link = await page.$eval('a[href="qr/"]', a => a.textContent).catch(() => '');
  ok('M7', 'Tab Quản trị có link "📱 Trình nhận QR"', /Trình nhận QR/.test(link), link);
  ok('E', 'Không lỗi JavaScript', !errs.length, errs.slice(0, 3).join(' | '));
  await page.goto(WEB + '/qr/'); await page.screenshot({ path: path.join(process.env.SHOT_DIR || TMP, 'shot_mm_qr.png') });
  await browser.close();
  const bad = results.filter(x => !x).length;
  console.log(bad ? `\n${bad}/${results.length} ca KHÔNG ĐẠT` : `\nĐẠT ${results.length}/${results.length}`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
