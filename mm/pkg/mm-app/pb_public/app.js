'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = v => Number(v || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const dmy = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '';
const hm = d => d && d.length > 10 ? `${dmy(d)} ${d.slice(11, 16)}` : dmy(d);
const localTime = s => { if (!s) return ''; const d = new Date(String(s).replace(' ', 'T') + 'Z'); return isNaN(d) ? String(s) : d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }); };
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const weekday = d => { const [y, m, dd] = d.split('-').map(Number); return WD[new Date(y, m - 1, dd).getDay()]; };
const STATE = { waiting: 'Chưa SX', running: 'Đang SX', done: 'Đã xong', cancel: 'Đã hủy' };
const GROUP = { VLN: 'VLN', VLDT: 'VLĐT', REAR: 'Rear' };
let me = null, today = '', settings = {}, boardData = null, selected = new Map(), sortables = [], vlnFocus = '', activeCol = 'pool';
const isNarrow = () => window.matchMedia('(max-width: 900px)').matches;

/* ---------- tiện ích ---------- */
let toastTimer = 0;
function toast(text, kind = '', action = null) {
  const t = $('#toast'); t.className = `toast ${kind}`; t.hidden = false; t.textContent = text;
  if (action) { const b = document.createElement('button'); b.type = 'button'; b.className = 'toast-btn'; b.textContent = action.label; b.onclick = () => { t.hidden = true; action.run(); }; t.append(b); }
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'error' ? 9000 : action ? 9000 : 5000);
}
// Đăng nhập PocketBase: token lưu trên máy (localStorage), gửi kèm mọi yêu cầu. API nghiệp vụ nằm ở /api/mm/*.
const TOKEN_KEY = 'mm_token';
let lastWriteAt = 0;
const auth = {
  get() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return auth.mem || ''; } },
  set(t) { auth.mem = t; try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { } }
};
async function api(url, options = {}) {
  const full = url.startsWith('/api/collections/') ? url : url.replace(/^\/api\//, '/api/mm/');
  const opts = { ...options, headers: { ...(options.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(auth.get() ? { Authorization: auth.get() } : {}), ...(options.headers || {}) } };
  if (options.json !== undefined) { opts.method = opts.method || 'POST'; opts.body = JSON.stringify(options.json); }
  let res;
  try { res = await fetch(full, opts); } catch { throw new Error('Không kết nối được máy chủ. Kiểm tra mạng.'); }
  const data = await res.json().catch(() => ({}));
  const msg = data.error || data.message;
  if (res.status === 401 && !full.includes('auth-with-password') && !full.endsWith('/status')) { auth.set(''); me = null; showLogin(); throw new Error(msg || 'Phiên đăng nhập đã hết.'); }
  if (res.status === 428 && !options._pin2) { if (await askPin2(data.code)) return api(url, { ...options, _pin2: true }); throw new Error('Chưa xác nhận mật khẩu cấp 2.'); }
  if (!res.ok) throw new Error(msg || `Lỗi máy chủ (${res.status}).`);
  if (opts.method && opts.method !== 'GET' && me) { lastWriteAt = Date.now(); if (typeof refreshBadges === 'function') setTimeout(refreshBadges, 200); }
  return data;
}
// Quyền theo tài khoản (server gửi trong me.perms): màn hình 0 ẩn · 1 xem · 2 thao tác + quyền đặc biệt.
const lvl = s => me?.perms?.screens?.[s] || 0, can = s => lvl(s) >= 2, sp = k => !!me?.perms?.specials?.[k];
const isMgr = () => !!me && (me.role === 'admin' || me.isHead);
// data-perm="bom:2" / "bomImport" / "@admin" / "@manager" (nhiều lựa chọn cách nhau bằng |)
const canTok = t => String(t).split('|').some(x => { const [a, b] = x.split(':'); return a === '@admin' ? me.role === 'admin' : a === '@manager' ? isMgr() : b ? lvl(a) >= Number(b) : sp(a); });
const canPlan = () => can('board');
function confirmDialog(title, bodyHtml, okText = 'Đồng ý', size = '') {
  return new Promise(resolve => {
    $('#dialogTitle').textContent = title; $('#dialogBody').innerHTML = bodyHtml; $('#dialogOk').textContent = okText || ''; $('#dialog').hidden = false;
    $('#dialogForm').classList.toggle('wide', size === 'wide'); $('#dialogCancel').textContent = okText === null ? 'Đóng' : 'Hủy';
    const done = v => { $('#dialog').hidden = true; $('#dialogForm').onsubmit = null; $('#dialogCancel').onclick = null; resolve(v); };
    $('#dialogForm').onsubmit = e => { e.preventDefault(); done(Object.fromEntries(new FormData($('#dialogForm')))); };
    $('#dialogCancel').onclick = () => done(null);
    $('#dialogBody').onclick = e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) done({ ...Object.fromEntries(new FormData($('#dialogForm'))), act: b.dataset.act }); };
    $('#dialogOk').hidden = okText === null;
    $('#dialogForm').querySelector('input,select,button.primary')?.focus();
  });
}
// Tìm nhanh: <input class="qs" data-qs="#khung"> lọc dòng bảng / thẻ theo chữ (không phân biệt dấu); tự áp lại sau mỗi lần vẽ lại.
const fold = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
function applyQs(input) {
  const box = document.querySelector(input.dataset.qs); if (!box) return;
  const q = fold(input.value).trim().replace(/\s+/g, ' '), words = q ? [q] : [];   // tìm theo cụm (VD "line 4")
  const items = box.tagName === 'TABLE' ? [...box.tBodies].flatMap(b => [...b.rows]) : [...box.children];
  let head = null, any = false, shown = 0;
  const closeHead = () => { if (head) head.hidden = words.length > 0 && !any; };
  for (const el of items) {
    if (el.classList.contains('group-head')) { closeHead(); head = el; any = false; continue; }
    if (el.querySelector?.('.empty') || el.classList.contains('empty')) continue;
    el.hidden = words.length > 0 && !fold(el.textContent).replace(/\s+/g, ' ').includes(q);
    if (!el.hidden) { any = true; shown++; }
  }
  closeHead();
  input.classList.toggle('no-hit', words.length > 0 && !shown);
}
document.addEventListener('input', e => { if (e.target.matches('.qs')) applyQs(e.target); });
let qsTick = 0;
new MutationObserver(() => { if (qsTick) return; qsTick = requestAnimationFrame(() => { qsTick = 0; $$('.qs').forEach(i => { if (i.value) applyQs(i); }); }); }).observe(document.body, { childList: true, subtree: true });
async function withBusy(button, fn) { if (button) button.disabled = true; try { return await fn(); } catch (e) { toast(e.message, 'error'); } finally { if (button) button.disabled = false; } }
// Thư viện Excel (~1 MB) chỉ tải khi cần nhập / xuất Excel.
const scriptOnce = new Map();
function loadScript(src) {
  if (!scriptOnce.has(src)) scriptOnce.set(src, new Promise((ok, bad) => { const el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = () => { scriptOnce.delete(src); bad(new Error('Không tải được thư viện Excel.')); }; document.head.append(el); }));
  return scriptOnce.get(src);
}
async function needExcel() { if (window.ExcelJS && window.MMReaders) return; await loadScript('vendor/exceljs.min.js?v=4.4'); await loadScript(`readers.js?v=${APP_V}`); }
// File .xls (Excel 97-2003, VD Order List xuất từ SAP) cần thêm SheetJS.
async function readExcelFile(file, kind) {
  await needExcel();
  const buf = await file.arrayBuffer();
  if (MMReaders.isXls(buf) && !window.XLSX) await loadScript('vendor/xlsx.full.min.js?v=0.20.3');
  return kind === 'prod' ? MMReaders.readProdFile(buf, file.name) : MMReaders.readPoFile(buf, file.name);
}
const APP_V = 'pb33';

/* ---------- ô nhập số kitting: định mức lẻ + máy tính + − × ÷ ---------- */
// Định mức lẻ (VD 884,16): cấp số nguyên; tối đa làm tròn lên, đủ khi ≥ phần nguyên (tối thiểu 1), nút Đủ = làm tròn gần nhất.
const isWhole = n => Math.abs(Number(n) - Math.round(Number(n))) < 1e-9;
const kqCap = req => isWhole(req) ? Number(req) : Math.ceil(req);
const kqTarget = req => isWhole(req) ? Number(req) : Math.max(1, Math.floor(req));
const kqFill = req => isWhole(req) ? Number(req) : Math.min(kqCap(req), Math.max(kqTarget(req), Math.round(req)));
// Tính biểu thức số trong ô nhập (VD 12*24+5, 960/4): chỉ chữ số, . , + − × ÷ ( ); sai cú pháp → NaN. Không dùng eval.
function calcEval(text) {
  const s = String(text ?? '').replace(/\s+/g, '').replace(/[×xX]/g, '*').replace(/[÷:]/g, '/').replace(/[−–]/g, '-').replace(/,/g, '.');
  if (!s) return 0;
  if (!/^[0-9.+\-*/()]+$/.test(s)) return NaN;
  let i = 0;
  const num = () => { const m = /^\d*\.?\d+|^\d+\./.exec(s.slice(i)); if (!m) throw 0; i += m[0].length; return Number(m[0]); };
  const atom = () => { if (s[i] === '-') { i++; return -atom(); } if (s[i] === '+') { i++; return atom(); } if (s[i] === '(') { i++; const v = sum(); if (s[i] !== ')') throw 0; i++; return v; } return num(); };
  const prod = () => { let v = atom(); while (s[i] === '*' || s[i] === '/') { const op = s[i++], b = atom(); v = op === '*' ? v * b : v / b; } return v; };
  const sum = () => { let v = prod(); while (s[i] === '+' || s[i] === '-') { const op = s[i++], b = prod(); v = op === '+' ? v + b : v - b; } return v; };
  try { const v = sum(); return i === s.length && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : NaN; } catch { return NaN; }
}
// Bàn phím điện thoại kiểu số không có + − × ÷ → thanh phím phép tính nổi ngay trên bàn phím khi chạm vào ô nhập .calc.
const calcBar = document.createElement('div');
calcBar.className = 'calc-bar'; calcBar.hidden = true;
calcBar.innerHTML = ['+', '−', '×', '÷', '(', ')', '⌫', '='].map(k => `<button type="button" data-k="${k}" class="${k === '=' ? 'eq' : ''}">${k}</button>`).join('');
document.body.append(calcBar);
let calcInput = null;
const calcPlace = () => { const vv = window.visualViewport; calcBar.style.bottom = vv ? `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px` : '0px'; };
window.visualViewport?.addEventListener('resize', calcPlace); window.visualViewport?.addEventListener('scroll', calcPlace);
function calcApply(inp) {
  const v = calcEval(inp.value);
  if (Number.isNaN(v)) { toast(`Phép tính không hợp lệ: ${inp.value}`, 'error'); return false; }
  if (String(v) !== inp.value) { inp.value = String(v); inp.dispatchEvent(new Event('change', { bubbles: true })); }
  return true;
}
document.addEventListener('focusin', e => { if (e.target.matches('input.calc')) { calcInput = e.target; calcBar.hidden = false; document.body.classList.add('calc-on'); calcPlace(); } });
document.addEventListener('focusout', e => { if (e.target === calcInput) setTimeout(() => { if (document.activeElement !== calcInput) { calcBar.hidden = true; calcInput = null; document.body.classList.remove('calc-on'); } }, 150); });
calcBar.addEventListener('pointerdown', e => e.preventDefault());   // giữ con trỏ trong ô nhập, bàn phím không đóng
calcBar.addEventListener('click', e => {
  const b = e.target.closest('[data-k]'); if (!b || !calcInput) return;
  const k = b.dataset.k, inp = calcInput;
  if (k === '=') { calcApply(inp); return inp.focus(); }
  const a = inp.selectionStart ?? inp.value.length, z = inp.selectionEnd ?? a;
  if (k === '⌫') { const from = a === z ? Math.max(0, a - 1) : a; inp.value = inp.value.slice(0, from) + inp.value.slice(z); inp.setSelectionRange(from, from); }
  else { const ch = { '−': '-', '×': '*', '÷': '/' }[k] || k; inp.value = inp.value.slice(0, a) + ch + inp.value.slice(z); inp.setSelectionRange(a + 1, a + 1); }
  inp.focus();
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input.calc')) { e.preventDefault(); calcApply(e.target); } });
// Có phép tính thì tính trước khi ô nhập báo change (gõ xong rời ô).
document.addEventListener('change', e => { if (e.target.matches('input.calc') && /[^0-9.,]/.test(e.target.value)) { e.stopImmediatePropagation(); calcApply(e.target); } }, true);   // calcApply tự báo change với kết quả

/* ---------- ô chọn có gõ lọc ---------- */
// <select data-ta> (Line, Model, Model Code…) → thêm ô gõ có gợi ý (datalist), lọc ngay tại chỗ; gõ / chọn đúng tên thì đặt giá trị cho select gốc
// (select gốc ẩn đi nhưng vẫn giữ name / sự kiện change như cũ). Tự áp cho select mới vẽ (MutationObserver).
let taSeq = 0;
function taEnhance(sel) {
  if (sel._ta) return; sel._ta = true;
  const id = `ta${++taSeq}`, inp = document.createElement('input'), dl = document.createElement('datalist'), text = o => o.textContent.trim();
  inp.type = 'search'; inp.className = 'ta-input'; inp.setAttribute('list', id); inp.autocomplete = 'off'; dl.id = id;
  inp.placeholder = sel.getAttribute('aria-label') || 'Gõ để lọc'; inp.setAttribute('aria-label', inp.placeholder);
  const fill = () => { dl.innerHTML = [...sel.options].filter(o => !o.disabled && o.value).map(o => `<option value="${esc(text(o))}">`).join(''); };
  const show = () => { const o = sel.selectedOptions[0]; if (document.activeElement !== inp) inp.value = o && o.value ? text(o) : ''; inp.disabled = sel.disabled; };
  const pick = final => {
    const v = inp.value.trim().toLowerCase(), o = v ? [...sel.options].find(x => text(x).toLowerCase() === v && !x.disabled) : [...sel.options].find(x => x.value === '');
    if (o && sel.value !== o.value) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    if (final) { inp.blur(); show(); }
  };
  inp.addEventListener('focus', () => { fill(); inp.select(); });
  inp.addEventListener('input', () => pick(false));
  inp.addEventListener('change', () => pick(true));
  inp.addEventListener('blur', show);
  sel.addEventListener('change', show);
  new MutationObserver(show).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  sel.hidden = true; sel.after(inp, dl); show();
}
new MutationObserver(() => document.querySelectorAll('select[data-ta]').forEach(taEnhance)).observe(document.body, { childList: true, subtree: true });
document.querySelectorAll('select[data-ta]').forEach(taEnhance);

/* ---------- đăng nhập: Mã NV + mật khẩu ---------- */
async function showLogin() {
  $('#appView').hidden = true; $('#loginView').hidden = false;
  try {
    const st = await api('/api/status');
    $('#setupNote').hidden = !st.setupRequired;
    const dl = $('#demoLogin');
    if (dl && st.demoUsers) {   // chỉ bản chạy thử: bấm 1 tài khoản để đăng nhập nhanh
      dl.hidden = false;
      dl.querySelector('.demo-users').innerHTML = st.demoUsers.map(u => `<button type="button" data-u="${esc(u.username)}" data-p="${esc(u.pin)}"><span><b>${esc(u.username)}</b> · ${esc(u.name)}</span><span class="pill info">${esc(u.roleLabel)}</span></button>`).join('');
      dl.onclick = e => { const b = e.target.closest('[data-u]'); if (!b) return; $('#loginForm').username.value = b.dataset.u; $('#loginForm').password.value = b.dataset.p; $('#loginForm').requestSubmit(); };
    }
  } catch (e) { $('#loginMessage').textContent = e.message; $('#loginMessage').className = 'message error'; }
  $('#loginForm').username.focus();
}
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault(); const form = e.currentTarget, f = new FormData(form), btn = e.submitter;
  if (btn) btn.disabled = true;
  try {
    const r = await api('/api/collections/users/auth-with-password', { json: { identity: String(f.get('username')).trim().toUpperCase(), password: String(f.get('password')) } });
    auth.set(r.token); $('#loginMessage').textContent = ''; form.password.value = ''; await start();
  } catch (err) {
    $('#loginMessage').textContent = /Failed to authenticate|authenticate/i.test(err.message) ? 'Sai Mã NV hoặc mật khẩu, hoặc tài khoản đã bị khóa.' : err.message;
    $('#loginMessage').className = 'message error';
  } finally { if (btn) btn.disabled = false; }
});
$('#logoutBtn').addEventListener('click', () => { auth.set(''); location.reload(); });
$('#loginForm').addEventListener('click', e => { const b = e.target.closest('.pw-eye'); if (!b) return; const i = b.previousElementSibling; i.type = i.type === 'password' ? 'text' : 'password'; });
// Đổi mật khẩu: bấm tên mình ở góc trên; bắt buộc ở lần đăng nhập đầu (mật khẩu tạm / PIN cũ).
const pwOk = p => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
async function changePassword(forced = false) {
  let msg = '';
  for (;;) {
    const r = await confirmDialog(forced ? 'Đặt mật khẩu mới để tiếp tục' : 'Đổi mật khẩu', `${forced ? '<p class="hint">Tài khoản đang dùng mật khẩu tạm hoặc PIN cũ. Hãy đặt mật khẩu riêng.</p>' : ''}
      ${msg ? `<p class="message error">${esc(msg)}</p>` : ''}
      <label>Mật khẩu hiện tại${forced ? ' (PIN / mật khẩu vừa dùng)' : ''}<input name="current" type="password" required autocomplete="current-password"></label>
      <label>Mật khẩu mới<input name="password" type="password" minlength="8" maxlength="64" required autocomplete="new-password"></label>
      <label>Nhập lại mật khẩu mới<input name="again" type="password" required autocomplete="new-password"></label>
      <p class="hint">Từ 8 ký tự, có cả chữ và số.</p>`, 'Lưu mật khẩu');
    if (!r) return false;
    if (!pwOk(r.password)) { msg = 'Mật khẩu từ 8 ký tự, có cả chữ và số.'; continue; }
    if (r.password !== r.again) { msg = 'Hai lần nhập mật khẩu mới chưa giống nhau.'; continue; }
    try {
      await api('/api/me/password', { json: { current: r.current, password: r.password } });
      const x = await api('/api/collections/users/auth-with-password', { json: { identity: me.username, password: r.password } });   // đổi mật khẩu làm token cũ hết hạn
      auth.set(x.token); me.mustChange = false; toast('Đã đổi mật khẩu.', 'success'); return true;
    } catch (e) { msg = e.message; }
  }
}
// Mật khẩu cấp 2 (Quản trị / Trưởng bộ phận): bắt buộc khi thêm / sửa / xóa tài khoản, nhập 1 lần dùng 5 phút.
async function setPin2() {
  let msg = '';
  for (;;) {
    const r = await confirmDialog(me.hasPin2 ? 'Đổi mật khẩu cấp 2' : 'Đặt mật khẩu cấp 2', `${msg ? `<p class="message error">${esc(msg)}</p>` : ''}
      <label>Mật khẩu đăng nhập<input name="password" type="password" required autocomplete="current-password"></label>
      <label>Mật khẩu cấp 2 mới (6–32 ký tự, khác mật khẩu đăng nhập)<input name="pin2" type="password" minlength="6" maxlength="32" required autocomplete="new-password"></label>
      <label>Nhập lại<input name="again" type="password" required autocomplete="new-password"></label>`, 'Lưu');
    if (!r) return false;
    if (r.pin2 !== r.again) { msg = 'Hai lần nhập chưa giống nhau.'; continue; }
    try { await api('/api/me/pin2', { json: { password: r.password, pin2: r.pin2 } }); me.hasPin2 = true; toast('Đã đặt mật khẩu cấp 2.', 'success'); return true; } catch (e) { msg = e.message; }
  }
}
async function askPin2(code) {
  if (code === 'pin2_unset' && !(await setPin2())) return false;
  let msg = '';
  for (;;) {
    const r = await confirmDialog('Mật khẩu cấp 2', `${msg ? `<p class="message error">${esc(msg)}</p>` : ''}<label>Nhập mật khẩu cấp 2 để xác nhận<input name="pin2" type="password" required autocomplete="off"></label><p class="hint">Có hiệu lực ${me?.pin2Minutes || 5} phút.</p>`, 'Xác nhận');
    if (!r) return false;
    const v = await api('/api/me/pin2/verify', { json: { pin2: r.pin2 } }).catch(e => ({ ok: false, message: e.message }));
    if (v.ok) return true;
    msg = v.message;
  }
}
$('#whoami').addEventListener('click', async () => {
  try {
    if (!isMgr() && !sp('lineSign')) return void await changePassword(false);   // MK cấp 2: Quản trị, Trưởng BP, Leader giao nhận
    const r = await confirmDialog(me.name, '<div class="btn-row"><button type="button" class="secondary" data-act="pw">Đổi mật khẩu đăng nhập</button><button type="button" class="secondary" data-act="pin2">' + (me.hasPin2 ? 'Đổi' : 'Đặt') + ' mật khẩu cấp 2</button></div>', null);
    if (r?.act === 'pw') await changePassword(false); else if (r?.act === 'pin2') await setPin2();
  } catch (e) { toast(e.message, 'error'); }
});

async function start() {
  const info = await api('/api/me');
  me = info.user; today = info.today; settings = info.settings;
  if (me.mustChange && !(await changePassword(true))) { auth.set(''); return showLogin(); }
  $('#loginView').hidden = true; $('#appView').hidden = false;
  $('#whoami').textContent = `${me.name} · ${me.roleLabel}`;
  if ($('#demoBadge')) $('#demoBadge').hidden = !info.demo;
  me.pin2Minutes = info.perm?.pin2Minutes;
  if ($('#demoBox')) $('#demoBox').hidden = !info.demo || me.role !== 'admin';
  // Tab theo quyền xem; Quản trị: Quản trị / Trưởng bộ phận / người được Cập nhật sản xuất. Nút / khung có data-perm.
  $$('.tab').forEach(x => { const t = x.dataset.tab; x.hidden = t === 'guide' ? false : t === 'admin' ? !(isMgr() || sp('prodUpdate')) : lvl(t) < 1; });
  $$('[data-perm]').forEach(x => { x.hidden = !canTok(x.dataset.perm); });
  $('#boardFrom').value = today; $('#assignDay').value = today;
  startRealtime();
  const pref = { kho: 'kho', opkho: 'kitpad', line: 'prod', approver: 'supply' }[me.role], shown = $$('.tab').filter(x => !x.hidden).map(x => x.dataset.tab);
  const home = shown.includes(pref) ? pref : shown.includes('board') ? '' : shown[0];
  if (home) { await showTab(home); return; }
  await loadBoard();
  refreshBadges();
}

/* ---------- tabs ---------- */
$$('.tab').forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
async function showTab(name) {
  const btn = $(`.tab[data-tab="${name}"]`);
  $$('.tab').forEach(x => x.classList.toggle('active', x === btn));
  $$('.panel').forEach(x => x.classList.toggle('active', x.id === `panel-${btn.dataset.tab}`));
  try {
    if (btn.dataset.tab === 'board') await loadBoard();
    if (btn.dataset.tab === 'lines') await loadLinesTab();
    if (btn.dataset.tab === 'po') await loadPo();
    if (btn.dataset.tab === 'bom') await loadBom();
    if (btn.dataset.tab === 'admin') await loadAdmin();
    if (btn.dataset.tab === 'kho') await loadKho();
    if (btn.dataset.tab === 'supply') await loadSupply();
    if (btn.dataset.tab === 'prod') await loadProd();
    if (btn.dataset.tab === 'kitpad') await loadKitpad();
    if (btn.dataset.tab === 'report') await loadReport4();
    refreshBadges();
  } catch (e) { toast(e.message, 'error'); }
}

/* =================== KẾ HOẠCH KITTING =================== */
let vlnData = null;
const short = m => String(m || '').replace(/^BSM-/i, '');
const codeTail = c => String(c || '').replace(/^GH\d\d-/i, '');
// Kit PO gộp: 1 dòng nhỏ liệt kê PO gốc (cắt "…", không làm rộng hàng). Ghi chú Planner: pill 📝 (chạm để xem) + khung đầy đủ.
const poNos = pos => (pos || []).map(p => typeof p === 'string' ? p : p.po);
const poLine = pos => { const n = poNos(pos); return n.length > 1 ? `<div class="po-line" title="${esc(n.join(' · '))}">PO: ${esc(n.join(' · '))}</div>` : ''; };
const noteText = notes => (notes || []).map(n => notes.length > 1 || n.po ? `${n.po}: ${n.note}` : n.note).join('\n');
const notePill = notes => (notes || []).length ? ` <span class="pill note-pill" role="button" tabindex="0" title="${esc(noteText(notes))}" data-note="${esc(noteText(notes))}">📝</span>` : '';
const poList = k => (k.pos || []).length > 1 ? `<div class="po-list">${k.pos.map(p => `<span><b>${esc(p.po)}</b> ${esc(codeTail(p.modelCode))} · ${fmt(p.qty)}</span>`).join('')}</div>` : '';
// PO Unplan: Rear đã cấp khi Kho xác nhận Unplan → nhóm Rear + VLĐT không kitting Rear cho các PO này.
const unplanText = k => `PO Unplan ${(k.unplanRear || []).map(u => `${u.po} (${codeTail(u.modelCode)} · ${fmt(u.qty)})`).join(', ')}: không kitting Rear — Rear đã cấp khi Kho xác nhận Unplan.`;
const IPO_LABEL = { UNPLAN: 'Unplan', RMA: 'RMA', LOAD: 'Load TP' };
// PO Load thành phẩm gộp trong Kit: Line nhận thêm hàng thành phẩm từ Kho → vật liệu kitting đã trừ tương ứng (cả Rear).
const loadTpSum = k => (k?.loadTp || []).reduce((a, l) => a + l.qty, 0);
const loadBox = k => (k?.loadTp || []).length ? `<div class="load-box"><b>🏷 Line nhận thêm ${fmt(loadTpSum(k))} ea thành phẩm từ Kho</b><span>${k.loadTp.map(l => `${esc(l.po)} · ${esc(codeTail(l.modelCode))} · ${fmt(l.qty)} ea${l.ref ? ` · phiếu ${esc(l.ref)}` : ''}`).join(' — ')}</span><small>Vật liệu kitting đã trừ tương ứng (cả Rear).</small></div>` : '';
const unplanBox = (k, grp) => grp === 'HV' && (k.unplanRear || []).length ? `<div class="unplan-box">🔧 ${esc(unplanText(k))}</div>` : '';
const noteBox = notes => (notes || []).length ? `<div class="note-box"><b>📝 Ghi chú Planner</b>${notes.map(n => `<div><span class="muted">${esc(n.po)}</span> ${esc(n.note)}</div>`).join('')}</div>` : '';
document.addEventListener('click', e => { const n = e.target.closest('.note-pill'); if (!n) return; e.stopPropagation(); e.preventDefault(); toast(n.dataset.note, 'info'); }, true);
const kpi = (label, value, { sub = '', tone = '', act = '' } = {}) =>
  `<button type="button" class="kpi ${tone}" ${act ? `data-act="${esc(act)}"` : 'disabled'}><span class="k-label">${label}</span><span class="k-value">${value}</span>${sub ? `<span class="k-sub">${sub}</span>` : ''}</button>`;
const vlnStatus = r => { const cover = r.waiting + r.planned; return cover < r.min ? 'bad' : cover > r.max ? 'warn' : 'ok'; };
// CSP không cho thuộc tính style trong HTML: gán độ dài thanh bằng CSSOM sau khi vẽ.
function paintBars(root) { root.querySelectorAll('[data-w],[data-l],[data-t]').forEach(el => { for (const k of ['w', 'l', 't']) if (el.dataset[k]) el.style.setProperty(`--${k}`, el.dataset[k]); }); }
function vlnBarHtml(r, active) {
  const scale = Math.max(r.max, r.waiting + r.planned, 1), pct = v => `${Math.min(100, v / scale * 100)}%`;
  const st = vlnStatus(r), cover = r.waiting + r.planned;
  return `<button type="button" class="vbar ${active ? 'active' : ''}" data-model="${esc(r.model)}">
    <span class="v-name">${esc(short(r.model))}<small>${r.lines.length}L</small></span>
    <span class="v-track"><span class="v-wait" data-w="${pct(r.waiting)}"></span><span class="v-plan v-${st}" data-l="${pct(r.waiting)}" data-w="${pct(r.planned)}"></span><span class="v-min" data-l="${pct(r.min)}"></span></span>
    <span class="v-num ${st}">${cover}<small>/${r.max}</small></span></button>`;
}

async function loadBoard() {
  const from = $('#boardFrom').value || today, days = $('#boardDays').value;
  const [data, vln] = await Promise.all([api(`/api/board?from=${from}&days=${days}`), api(`/api/vln-overview?day=${today}&shift=${encodeURIComponent((settings.shifts || 'Ngày').split(',')[0])}`)]);
  boardData = data; vlnData = vln;
  $('#boardAuto').hidden = !canPlan(); $('#boardImport').hidden = !canPlan();
  $('#boardUndo').hidden = !(canPlan() && data.undo); if (data.undo) $('#boardUndo').title = `Hoàn tác: ${data.undo.label}`;
  const keep = new Map(); for (const [k, v] of selected) if (findItem(k)) keep.set(k, v); selected = keep;
  renderBoardKpis(); renderVlnBars(); renderBoard();
}
function findItem(key) {
  if (!boardData) return null;
  for (const it of [...boardData.pool, ...boardData.columns.flatMap(c => c.items)]) if (itemKey(it) === key) return it;
  return null;
}
const itemKey = it => `${it.type}:${it.id}`;

function renderBoardKpis() {
  const d = boardData, todayCol = d.columns.find(c => c.day === d.today);
  const all = [...d.pool, ...d.columns.flatMap(c => c.items)];
  const short_ = vlnData.rows.filter(r => vlnStatus(r) === 'bad').length;
  $('#boardKpis').innerHTML =
    kpi('Chưa lập KH', fmt(d.pool.length), { act: 'col:pool', sub: d.pool.some(i => i.kind === 'merged') ? `gồm ${d.pool.filter(i => i.kind === 'merged').length} Kit PO gộp` : '' }) +
    kpi('Lập hôm nay', todayCol ? fmt(todayCol.items.length) : '–', { sub: todayCol ? `${fmt(todayCol.items.reduce((s, i) => s + i.planQty, 0))} ea` : 'ngoài khoảng xem', act: todayCol ? `col:${d.today}` : '' }) +
    kpi('Model thiếu PO', fmt(short_), { tone: short_ ? 'bad' : 'ok', sub: `${vlnData.rows.length} Model đang chạy`, act: short_ ? 'short' : '' }) +
    kpi('Kit PO gộp', fmt(all.filter(i => i.kind === 'merged').length), { sub: `${fmt(all.filter(i => i.kind === 'merged').reduce((s, i) => s + i.pos.length, 0))} PO gốc` });
}
$('#boardKpis').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act.startsWith('col:')) { activeCol = act.slice(4); renderColSwitch(); if (activeCol === 'pool') { $('#poolModel').value = ''; vlnFocus = ''; applyPoolFilter(); } $('#colSwitch').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  if (act === 'short') { const r = vlnData.rows.find(x => vlnStatus(x) === 'bad'); if (r) focusModel(r.model); }
});
function renderVlnBars() {
  const box = $('#vlnBars');
  box.innerHTML = vlnData.rows.length ? vlnData.rows.map(r => vlnBarHtml(r, vlnFocus === r.model)).join('') : '';
  paintBars(box);
}
function focusModel(model) {
  vlnFocus = vlnFocus === model ? '' : model;
  $('#poolModel').value = vlnFocus; activeCol = 'pool'; renderColSwitch(); renderVlnBars(); applyPoolFilter();
}
$('#vlnBars').addEventListener('click', e => { const b = e.target.closest('.vbar'); if (b) focusModel(b.dataset.model); });

function cardHtml(it) {
  const editable = canPlan() && !it.locked;
  const key = itemKey(it), sel = selected.has(key), merged = it.kind === 'merged';
  const codes = it.codes || [it.modelCode];
  const detail = `<div class="kdetail"><span>Remain ${fmt(it.remainQty)}</span><span>Plan ${esc(dmy(it.planDate))}</span>${it.masterLine ? `<span>${esc(it.masterLine)}</span>` : ''}${merged ? it.pos.map(p => `<span class="child"><b>${esc(p.po)}</b> ${esc(codeTail(p.modelCode))} · ${fmt(p.planQty)} <i class="dot ${p.state}"></i></span>`).join('') : ''}</div>`;
  return `<div class="kcard ${merged ? 'merged' : ''} ${sel ? 'selected' : ''} ${canPlan() ? '' : 'readonly'}" data-key="${esc(key)}" data-type="${it.type}" data-id="${esc(it.id)}" data-model="${esc(it.model)}" data-code="${esc(it.modelCode)}" data-qty="${it.planQty}" data-printed="${it.printed ? 1 : ''}" data-stage="${cardStage(it)}" data-codes="${esc(codes.join(' '))}" data-search="${esc(`${it.code} ${codes.join(' ')} ${it.model} ${it.line || ''} ${(it.pos || []).map(p => p.po).join(' ')}`.toLowerCase())}">
    <div class="krow">
      ${editable ? `<label class="pick-box ${it.mrank ? 'has-rank' : ''} ${it.behind ? 'behind' : ''}" title="${it.mrank ? `Kho #${it.mrank}: thứ tự Kho làm trong ${esc(short(it.model))} · thứ ${it.rank} toàn Kho (lượt ${it.round})${it.behind ? ' · XẾP MUỘN so với Plan Start' : ''}` : 'Chọn'}"><input type="checkbox" class="pick" ${sel ? 'checked' : ''} aria-label="Chọn"><span>${it.mrank || ''}</span></label>` : it.mrank ? `<span class="rank" title="${esc(short(it.model))} ưu tiên ${it.mrank} · Kho làm thứ ${it.rank}">${it.mrank}</span>` : ''}
      <div class="kmain"><div class="code"><span class="ctext">${esc(it.code)}</span>${merged ? `<span class="pill merged">${it.pos.length} PO</span>` : ''}${it.printed && !it.locked ? '<span class="pill warn" title="Kho đã in phiếu kitting: không gộp / tách được nữa">🖨 đã in</span>' : ''}</div><div class="ksub">${esc(short(it.model))} · ${codes.length > 1 ? `<b>${codes.length} code</b>` : esc(codeTail(it.modelCode))}${it.vlnStatus && it.vlnStatus !== 'pending' ? ` <span class="ktag kt-${it.vlnStatus}">V</span>` : ''}${it.hvStatus && it.hvStatus !== 'pending' ? `<span class="ktag kt-${it.hvStatus}">R</span>` : ''}</div></div>
      <div class="kqty"><div class="q">${fmt(it.planQty)}</div><div class="st"><i class="dot ${it.state}"></i>${STATE[it.state]}</div></div>
      ${editable ? '<button type="button" class="more" aria-label="Thao tác">⋮</button>' : ''}
    </div>${startLine(it, `${(it.cancelled || []).length ? `<span class="pill bad" title="Cancel: ${esc(it.cancelled.join(', '))}">PO hủy</span>` : ''}${(it.loadTp || []).length ? ` <span class="pill load" title="Line nhận thêm hàng thành phẩm từ Kho">🏷 +${fmt(it.loadTp.reduce((a, l) => a + l.qty, 0))} TP</span>` : ''}${it.type === 'po' && it.poType === 'LOAD' ? ' <span class="pill load" title="PO Load thành phẩm: gộp vào Kit có PO thật cùng Model Code">🏷 Load TP</span>' : ''}${it.planLine && !it.fixedLine ? ` <span class="pill info" title="Line dự kiến theo file kế hoạch của Planner">→ ${esc(it.planLine)}</span>` : ''}${it.fixedLine ? `<span class="pill warn" title="PO nội bộ ${esc((it.internal || []).map(i => i.po).join(', '))} — chỉ giao ${esc(it.fixedLine)}">${(it.internal || []).some(i => i.type === 'RMA') ? 'RMA' : 'Unplan'} → ${esc(it.fixedLine)}</span>` : ''}${notePill(it.type === 'kit' ? it.notes : it.note ? [{ po: it.code, note: it.note }] : [])}`)}${detail}
  </div>`;
}
// Plan Start → End · thời lượng; cam: bắt đầu trong 24 giờ tới, đỏ: đã quá giờ bắt đầu mà chưa lập KH.
// tags: nhãn phụ (PO hủy, Unplan/RMA → Line, 📝) đặt ở dòng này để không chèn lên số lượng.
function startLine(it, tags = '') {
  tags = tags ? `<span class="ktags">${tags}</span>` : '';
  if (!it.planStart) return tags ? `<div class="kstart">${tags}</div>` : '';
  const now = boardData?.now || '', soon = boardData?.soonAt || '';
  const urg = it.planDay ? '' : it.planStart < now ? 'late' : it.planStart < soon ? 'soon' : '';
  const end = it.planEnd ? (it.planEnd.slice(0, 10) === it.planStart.slice(0, 10) ? it.planEnd.slice(11, 16) : hm(it.planEnd.replace('T', ' ')).slice(0, 11)) : '';
  return `<div class="kstart ${urg}"><span>▶ ${esc(dmy(it.planStart).slice(0, 5))} ${esc(it.planStart.slice(11, 16))}${end ? ` → ${esc(end)}` : ''}</span>${it.span ? `<span>${esc(it.span.replace(/^0/, '').replace(':', 'h'))}</span>` : ''}${tags}${urg === 'late' ? '<b>Quá giờ</b>' : urg === 'soon' ? '<b>Gấp</b>' : ''}${it.behind ? '<b class="behind-tag" title="Plan Start sớm hơn PO đứng trước cùng Model trong hàng chờ Kho — nên kéo lên trước">Xếp muộn</b>' : ''}</div>`;
}
const cardStage = it => it.vlnStatus === 'delivered' ? 'delivered' : it.vlnStatus === 'done' && it.hvStatus === 'done' ? 'ready' : (it.vlnStatus && it.vlnStatus !== 'pending') || (it.hvStatus && it.hvStatus !== 'pending') ? 'progress' : 'pending';
const POOL_SORT = {
  start: (a, b) => (a.planStart ? 0 : 1) - (b.planStart ? 0 : 1) || String(a.planStart).localeCompare(String(b.planStart)) || String(a.code).localeCompare(String(b.code)),
  model: (a, b) => String(a.model).localeCompare(String(b.model)) || POOL_SORT.start(a, b),
  po: (a, b) => String(a.code).localeCompare(String(b.code))
};
document.addEventListener('click', e => { const m = e.target.closest('.kcard .kmain'); if (m) m.closest('.kcard').classList.toggle('open'); });

function renderBoard() {
  const d = boardData, cur = $('#poolModel').value;
  $('#poolModel').innerHTML = '<option value="">Tất cả Model</option>' + d.models.map(m => `<option value="${esc(m)}" ${m === cur ? 'selected' : ''}>${esc(short(m))}</option>`).join('');
  d.soonAt = (() => { const t = new Date(Date.parse(`${d.now}:00Z`) + 86400000); return t.toISOString().slice(0, 16); })();
  const pool = d.pool.slice().sort(POOL_SORT[$('#poolSort').value] || POOL_SORT.start);
  $('#poolList').innerHTML = pool.map(cardHtml).join('') || '<div class="drop-hint">Đã lập hết</div>';
  const dayItems = d.columns.flatMap(c => c.items), dm = $('#dfModel').value, dc = $('#dfCode').value;
  $('#dfModel').innerHTML = '<option value="">Tất cả Model</option>' + [...new Set(dayItems.map(i => i.model))].sort().map(m => `<option value="${esc(m)}" ${m === dm ? 'selected' : ''}>${esc(short(m))}</option>`).join('');
  $('#dfCode').innerHTML = '<option value="">Tất cả Code</option>' + [...new Set(dayItems.filter(i => !dm || i.model === dm).flatMap(i => i.codes || [i.modelCode]))].sort().map(c => `<option value="${esc(c)}" ${c === dc ? 'selected' : ''}>${esc(codeTail(c))}</option>`).join('');
  $('#dayColumns').innerHTML = d.columns.map(col => {
    const qty = col.items.reduce((s, i) => s + i.planQty, 0);
    return `<div class="column day-column ${col.day === d.today ? 'today' : ''}" data-col="${col.day}">
      <div class="column-head"><div><strong>${weekday(col.day)} ${dmy(col.day).slice(0, 5)}</strong><span class="head-r">${canPlan() && col.items.some(i => !i.locked) ? `<button type="button" class="sel-all" data-list="day-${col.day}" title="Chọn / bỏ chọn tất cả thẻ chưa kitting">☐</button>` : ''}<span class="count col-count">${col.items.length}</span></span></div><span class="sub col-qty">${fmt(qty)} ea</span></div>
      <div class="card-list" id="day-${col.day}" data-day="${col.day}">${col.items.map(cardHtml).join('') || '<div class="drop-hint">Kéo PO vào đây</div>'}</div></div>`;
  }).join('');
  const o = d.outside, notes = [];
  if (o.before) notes.push(`${o.before} thẻ trước ${dmy(d.from).slice(0, 5)}`);
  if (o.after) notes.push(`${o.after} thẻ sau khoảng xem`);
  $('#boardOutside').textContent = notes.join(' · ');
  renderColSwitch(); applyPoolFilter(); updateSelectionBar(); setupSortable();
}

// Điện thoại: xem từng cột một, chuyển cột bằng thanh chọn.
function renderColSwitch() {
  const d = boardData, cols = ['pool', ...d.columns.map(c => c.day)];
  if (!cols.includes(activeCol)) activeCol = 'pool';
  $('#colSwitch').innerHTML = cols.map(c => {
    const n = c === 'pool' ? d.pool.length : d.columns.find(x => x.day === c).items.length;
    const label = c === 'pool' ? 'Chưa lập' : `${weekday(c)} ${dmy(c).slice(0, 5)}`;
    return `<button type="button" role="tab" class="${c === activeCol ? 'active' : ''} ${c === d.today ? 'is-today' : ''}" data-col="${c}">${label} <b>${n}</b></button>`;
  }).join('');
  $$('#board .column').forEach(c => c.classList.toggle('col-active', c.dataset.col === activeCol));
}
$('#colSwitch').addEventListener('click', e => { const b = e.target.closest('[data-col]'); if (!b) return; activeCol = b.dataset.col; renderColSwitch(); });

function applyPoolFilter() {
  const model = $('#poolModel').value, q = $('#poolSearch').value.trim().toLowerCase();
  let shown = 0;
  const mm = mergeMode?.model, fits = c => !mm || (c.dataset.model === mm && c.querySelector('.pick') && !c.dataset.printed);
  $$('#poolList .kcard').forEach(c => { const ok = (!model || c.dataset.model === model) && (!q || c.dataset.search.includes(q)) && fits(c); c.hidden = !ok; if (ok) shown++; });
  const fm = $('#dfModel').value, fc = $('#dfCode').value, fs = $('#dfStage').value, fq = $('#dfSearch').value.trim().toLowerCase();
  const dayOk = c => (!fm || c.dataset.model === fm) && (!fc || c.dataset.codes.split(' ').includes(fc)) && (!fs || c.dataset.stage === fs) && (!fq || c.dataset.search.includes(fq));
  $$('#dayColumns .kcard').forEach(c => { c.hidden = !fits(c) || !dayOk(c); c.classList.toggle('dimmed', !!model && c.dataset.model !== model); });
  const filtering = !!(fm || fc || fs || fq);
  $('#dfClear').hidden = !filtering; $('#dayFilter').classList.toggle('on', filtering);
  $$('#dayColumns .day-column').forEach(col => {
    const all = [...col.querySelectorAll('.kcard')], vis = all.filter(c => !c.hidden), cnt = col.querySelector('.col-count'), qty = col.querySelector('.col-qty');
    if (cnt) cnt.textContent = filtering ? `${vis.length}/${all.length}` : String(all.length);
    if (qty) qty.textContent = `${fmt(vis.reduce((s, c) => s + Number(c.dataset.qty || 0), 0))} ea`;
  });
  const total = boardData ? boardData.pool.length : 0;
  $('#poolCount').textContent = model || q ? `${shown}/${total}` : String(total);
}
$('#poolModel').addEventListener('change', () => { vlnFocus = $('#poolModel').value; renderVlnBars(); applyPoolFilter(); });
$('#poolSearch').addEventListener('input', applyPoolFilter);
['#dfModel', '#dfCode', '#dfStage'].forEach(id => $(id).addEventListener('change', () => { if (id === '#dfModel') { $('#dfCode').value = ''; renderBoard(); } else applyPoolFilter(); syncSelAll(); }));
$('#dfSearch').addEventListener('input', () => { applyPoolFilter(); syncSelAll(); });
$('#dfClear').addEventListener('click', () => { $('#dfModel').value = ''; $('#dfCode').value = ''; $('#dfStage').value = ''; $('#dfSearch').value = ''; renderBoard(); });
$('#poolSort').addEventListener('change', () => boardData && renderBoard());

function setupSortable() {
  sortables.forEach(s => s.destroy()); sortables = [];
  if (!canPlan() || typeof Sortable === 'undefined') return;
  for (const list of $$('.card-list')) {
    sortables.push(Sortable.create(list, {
      group: 'kitting', animation: 140, delay: 220, delayOnTouchOnly: true, touchStartThreshold: 6, filter: 'input,button,.readonly', preventOnFilter: false, ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen',
      onStart: evt => { const n = selected.has(evt.item.dataset.key) ? selected.size : 1; if (n > 1) evt.item.dataset.multi = n; },
      onEnd: evt => {
        const item = evt.item, many = item.dataset.multi; delete item.dataset.multi;
        const lists = new Set([evt.from, evt.to]);
        if (many) {
          // Kéo 1 thẻ đang chọn = kéo cả nhóm thẻ đã chọn: xếp ngay sau thẻ được kéo, giữ thứ tự trên màn hình.
          let after = item;
          for (const c of $$('.kcard.selected').filter(c => c !== item)) { lists.add(c.parentElement); after.after(c); after = c; }
        } else if (evt.from === evt.to && evt.oldIndex === evt.newIndex) return;
        saveColumns([...lists].filter(l => l && l.classList.contains('card-list')));
      }
    }));
  }
}
async function saveColumns(lists) {
  if (selected.size) clearSelection();
  const columns = lists.map(list => ({ day: list.dataset.day || null, items: [...list.querySelectorAll('.kcard')].map(c => ({ type: c.dataset.type, id: c.dataset.id })) }));
  try { const r = await api('/api/board/apply', { json: { columns } }); toast(r.moved ? 'Đã cập nhật kế hoạch' : 'Đã đổi thứ tự', 'success', undoAction()); }
  catch (e) { toast(e.message, 'error'); }
  await loadBoard().catch(e => toast(e.message, 'error'));
}

/* ---------- chọn PO → chọn thao tác (chuyển kitting / gộp / bỏ KH) ---------- */
let mergeMode = null;   // { model, max } — Model của PO chọn đầu tiên; tổng SL không quá giới hạn gộp
const selectedQty = () => [...selected.keys()].reduce((s, k) => s + (findItem(k)?.planQty || 0), 0);
const undoAction = () => canPlan() ? { label: 'Hoàn tác', run: doUndo } : null;
async function doUndo() {
  await withBusy(null, async () => { const r = await api('/api/board/undo', { json: {} }); toast(r.message, 'success'); await loadBoard(); });
}
$('#boardUndo').addEventListener('click', doUndo);

/* ---------- Tự động xếp PO: tích chọn → xem trước → bỏ chọn dòng → áp dụng (hoàn tác được) ---------- */
const AUTO_KEY = 'mm_auto_opts';
function autoSaved() { try { return JSON.parse(localStorage.getItem(AUTO_KEY)) || {}; } catch { return {}; } }
function autoForm(v, plan, msg) {
  const models = (boardData?.models || []).filter(Boolean), tp = { UNPLAN: 'Unplan', RMA: 'RMA' };
  const opt = `<div class="auto-opts">
    <label>Plan Start đến hết ngày<input type="date" name="to" value="${esc(v.to)}" required></label>
    <label>Model<select name="model"><option value="">Tất cả Model</option>${models.map(m => `<option ${m === v.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
    <label>Chỉ xếp PO có SL ≥ (ea)<input type="number" name="minQty" min="0" step="1" value="${esc(v.minQty)}" required></label>
    <label>Kitting trước Plan Start (ngày)<input type="number" name="lead" min="0" max="14" step="1" value="${esc(v.lead)}" required></label>
    <label>Tối đa Kit / ngày <small class="muted">(0 = không giới hạn)</small><input type="number" name="maxPerDay" min="0" step="1" value="${esc(v.maxPerDay)}" required></label>
    <label>Thứ tự trong ngày<select name="order"><option value="start" ${v.order !== 'append' ? 'selected' : ''}>Chèn theo Plan Start</option><option value="append" ${v.order === 'append' ? 'selected' : ''}>Thêm vào cuối ngày</option></select></label>
    <label class="check"><input type="checkbox" name="attach" data-act="preview" ${v.attach ? 'checked' : ''}> Tự ghép PO Unplan / RMA vào Kit cùng Model</label>
    <button type="button" class="secondary" data-act="preview">↻ Xem trước</button></div>
    <p class="hint small-note">PO nhỏ hơn mức SL để lại ở cột Chưa lập KH cho Planner cân nhắc. Kit đã xếp ngày không bị di chuyển; Kho chưa kitting thì vẫn nhận ghép Unplan / RMA.</p>`;
  if (!plan) return opt + (msg ? `<p class="alert-box">${esc(msg)}</p>` : '');
  const ex = new Set(plan.opts.exclude);
  const att = r => r.attached.map(a => `<span class="pill ${a.type === 'RMA' ? 'warn' : 'info'}">${esc(tp[a.type] || a.type)} ${esc(a.po)} · ${fmt(a.qty)}${a.line ? ` · ${esc(a.line)}` : ''}</span>`).join(' ');
  const row = r => `<tr class="${r.action === 'attach' ? 'au-att' : ''}">
    <td>${r.action === 'place' ? `<input type="checkbox" name="inc:${esc(r.key)}" data-act="preview" checked aria-label="Chọn ${esc(r.code)}">` : ''}</td>
    <td><b>${esc(dmy(r.day).slice(0, 5))}</b>${r.late ? ' <span class="pill bad">Trễ</span>' : ''}${r.shifted ? ` <span class="pill warn" title="Ngày ${esc(dmy(r.want))} đã đủ Kit">dồn từ ${esc(dmy(r.want).slice(0, 5))}</span>` : ''}</td>
    <td>${r.action === 'attach' ? `<span class="muted">Ghép vào</span> ` : ''}<b>${esc(r.code)}</b>${r.pos.length > 1 ? ` <small class="muted">${r.pos.length} PO</small>` : ''}</td>
    <td>${esc(r.model)}<small class="muted"> · ${esc(r.codes.join(', '))}</small>${r.noBom.length ? ` <span class="pill bad">Chưa có BOM ${esc(r.noBom.join(', '))}</span>` : ''}</td>
    <td class="num">${fmt(r.total)}</td><td>${esc(String(r.start).replace('T', ' ').slice(5, 16))}</td><td>${att(r)}</td></tr>`;
  const L = plan.left, list = (t, a, f) => a.length ? `<details><summary>${t} <b>${a.length}</b></summary><p class="au-list">${a.map(f).join(', ')}</p></details>` : '';
  const sm = plan.summary;
  const exRows = L.excluded.length ? `<p class="hint">Đã bỏ chọn: ${L.excluded.map(esc).join(', ')} · <button type="button" class="link" data-act="reset-ex">Chọn lại tất cả</button></p>` : '';
  return opt + (msg ? `<p class="alert-box">${esc(msg)}</p>` : '') + `<div class="au-sum"><b>${sm.place}</b> Kit xếp vào <b>${sm.days.length}</b> ngày${sm.attach ? ` · ghép <b>${sm.attach}</b> PO Unplan / RMA` : ''}${ex.size ? ` · bỏ chọn ${ex.size}` : ''}</div>
    ${plan.rows.length ? `<div class="table-wrap au-wrap"><table class="au-table"><thead><tr><th></th><th>Ngày KT</th><th>Kit / PO</th><th>Model · Code</th><th class="num">SL</th><th>Plan Start</th><th>Ghép Unplan / RMA</th></tr></thead><tbody>${plan.rows.map(row).join('')}</tbody></table></div>` : '<p class="empty">Không có PO nào phù hợp các tích chọn.</p>'}
    ${exRows}<div class="au-left"><b>Để lại cho Planner</b>
    ${list(`PO SL < ${fmt(plan.opts.minQty)}`, L.small, x => `${esc(x.po)} <small>(${esc(x.model)} · ${fmt(x.qty)})</small>`)}
    ${list('Unplan / RMA chưa có Kit cùng Model phù hợp', L.noHost, x => `${esc(x.po)} <small>(${esc(x.model)} · ${fmt(x.qty)})</small>`)}
    ${list(`Plan Start sau ${dmy(plan.opts.to).slice(0, 5)}`, L.later, esc)}
    ${list('Thiếu Plan Start', L.noStart, esc)}</div>`;
}
const autoOpts = (r, exclude) => ({ to: r.to, models: r.model ? [r.model] : [], minQty: Number(r.minQty), lead: Number(r.lead), maxPerDay: Number(r.maxPerDay), order: r.order, attach: r.attach === true || r.attach === 'on', exclude });
async function autoDialog() {
  const sv = autoSaved();
  let v = { to: addDaysLocal(today, sv.ahead ?? 2), model: '', minQty: sv.minQty ?? 1000, lead: sv.lead ?? 0, maxPerDay: boardData?.autoMaxDay ?? 0, order: sv.order || 'start', attach: sv.attach ?? true };
  let exclude = [], plan = null, msg = '';
  const run = async () => { try { plan = await api('/api/board/auto', { json: { dry: true, opts: autoOpts(v, exclude) } }); msg = ''; } catch (e) { plan = null; msg = e.message; } };
  await run();
  for (;;) {
    const r = await confirmDialog('⚡ Tự động xếp PO', autoForm(v, plan, msg), plan?.rows.length ? `Áp dụng ${plan.summary.place + (plan.summary.attach ? ' + ghép ' + plan.summary.attach : '')}` : 'Áp dụng', 'wide');
    if (!r) return;
    const changed = ['to', 'model', 'minQty', 'lead', 'maxPerDay', 'order'].some(k => String(r[k]) !== String(v[k])) || (r.attach === 'on') !== !!v.attach;
    v = { ...v, ...r, attach: r.attach === 'on' };
    if (r.act === 'reset-ex' || changed) exclude = [];
    else if (plan) exclude = [...new Set([...exclude, ...plan.rows.filter(x => x.action === 'place' && !r[`inc:${x.key}`]).map(x => x.key)])];
    try { localStorage.setItem(AUTO_KEY, JSON.stringify({ ahead: Math.round((Date.parse(v.to) - Date.parse(today)) / 864e5), minQty: Number(v.minQty), lead: Number(v.lead), order: v.order, attach: v.attach })); } catch {}
    if (r.act || changed || !plan?.rows.length) { await run(); continue; }
    try {
      const x = await api('/api/board/auto', { json: { opts: autoOpts(v, exclude) } });
      toast(x.message, 'success', undoAction()); await loadBoard(); return;
    } catch (e) { msg = e.message; await run(); if (!msg) msg = e.message; }
  }
}
$('#boardAuto').addEventListener('click', e => withBusy(e.currentTarget, autoDialog));
function clearSelection() {
  selected.clear(); mergeMode = null;
  $$('.kcard.selected').forEach(c => { c.classList.remove('selected'); const b = c.querySelector('.pick'); if (b) b.checked = false; });
  applyPoolFilter(); updateSelectionBar();
}
const orderedSelection = () => { const order = $$('.kcard').map(c => c.dataset.key); return [...selected.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([, v]) => ({ type: v.type, id: v.id })); };
const poCountOf = items => items.reduce((s, i) => s + (i.type === 'kit' ? (findItem(`kit:${i.id}`)?.pos.length || 1) : 1), 0);

// Chọn / bỏ chọn 1 thẻ; trả false nếu không chọn được (vượt giới hạn gộp).
function setPick(card, on, quiet = false) {
  const box = card.querySelector('.pick'), key = card.dataset.key; if (!box) return false;
  // Gộp: Kit Kho đã in phiếu thì không chọn được; vượt giới hạn gộp chỉ cảnh báo (Planner quyết).
  if (on && !selected.has(key) && mergeMode && card.dataset.printed) {
    box.checked = false;
    if (!quiet) toast(`${card.dataset.code || 'Kit'}: Kho đã in phiếu kitting, không gộp được`, 'error');
    return false;
  }
  if (on) selected.set(key, { type: card.dataset.type, id: card.dataset.id, code: card.dataset.code, model: card.dataset.model, planned: !!card.closest('#dayColumns') });
  else selected.delete(key);
  box.checked = on; card.classList.toggle('selected', on);
  return true;
}
document.addEventListener('change', e => {
  if (!e.target.classList.contains('pick')) return;
  setPick(e.target.closest('.kcard'), e.target.checked);
  if (mergeMode && !selected.size) mergeMode = null, applyPoolFilter();
  updateSelectionBar();
});
// Chọn / bỏ chọn tất cả thẻ đang hiển thị (sau lọc) trong 1 cột.
document.addEventListener('click', e => {
  const b = e.target.closest('.sel-all'); if (!b) return;
  const cards = $$(`#${CSS.escape(b.dataset.list)} .kcard`).filter(c => !c.hidden && c.querySelector('.pick'));
  if (!cards.length) return;
  const allOn = cards.every(c => selected.has(c.dataset.key));
  let skipped = 0;
  for (const c of cards) if (!setPick(c, !allOn, true)) skipped++;
  if (skipped) toast(`Bỏ qua ${skipped} thẻ Kho đã in phiếu`, 'error');
  if (mergeMode && !selected.size) mergeMode = null, applyPoolFilter();
  updateSelectionBar(); syncSelAll();
});
function syncSelAll() {
  $$('.sel-all').forEach(b => {
    const cards = $$(`#${CSS.escape(b.dataset.list)} .kcard`).filter(c => !c.hidden && c.querySelector('.pick'));
    const on = cards.length && cards.every(c => selected.has(c.dataset.key));
    b.classList.toggle('on', !!on); b.textContent = (on ? '☑' : '☐') + (b.dataset.list === 'poolList' ? ' Tất cả' : '');
  });
}
function updateSelectionBar() {
  syncSelAll();
  const items = [...selected.values()], bar = $('#selectionBar');
  bar.hidden = !items.length && !mergeMode;
  bar.classList.toggle('merge', !!mergeMode);
  const pos = poCountOf(items);
  if (mergeMode) {
    const q = selectedQty(), codes = new Set([...selected.keys()].flatMap(k => findItem(k)?.codes || [findItem(k)?.modelCode]));
    $('#selectionText').innerHTML = `<b>Gộp</b> · ${esc(short(mergeMode.model))} · <b>${pos}</b> PO${codes.size > 1 ? ` · ${codes.size} code` : ''} · <span class="${q > mergeMode.max ? 'bad-text' : ''}">${fmt(q)}/${fmt(mergeMode.max)}</span>`;
    $('#selActions').innerHTML = `<button type="button" class="primary" data-sel="merge-ok" ${pos < 2 ? 'disabled' : ''}>Gộp ${pos} PO</button><button type="button" class="secondary" data-sel="merge-exit">Thoát</button>`;
    return;
  }
  const planned = items.filter(i => i.planned).length;
  $('#selectionText').innerHTML = `<b>${items.length}</b> thẻ · ${pos} PO`;
  $('#selActions').innerHTML = `<button type="button" class="primary" data-sel="move">Chuyển kitting</button><button type="button" class="secondary" data-sel="merge">Gộp</button>${planned ? `<button type="button" class="secondary" data-sel="unplan">Bỏ KH (${planned})</button>` : ''}<button type="button" class="secondary icon" data-sel="clear" aria-label="Bỏ chọn">✕</button>`;
}
$('#selActions').addEventListener('click', async e => {
  const b = e.target.closest('[data-sel]'); if (!b) return;
  const act = b.dataset.sel;
  if (act === 'clear') return clearSelection();
  if (act === 'merge') return enterMerge();
  if (act === 'merge-exit') { mergeMode = null; applyPoolFilter(); return updateSelectionBar(); }
  if (act === 'merge-ok') return confirmMerge(b);
  if (act === 'move') return openBatchMove();
  if (act === 'unplan') {
    const items = orderedSelection().filter(i => selected.get(`${i.type}:${i.id}`)?.planned);
    await withBusy(b, async () => { const r = await api('/api/board/batch', { json: { items, day: null } }); clearSelection(); toast(r.message, 'success', undoAction()); await loadBoard(); });
  }
});
function enterMerge() {
  const first = [...selected.values()][0]; if (!first) return;
  mergeMode = { model: first.model, max: boardData?.mergeMax || 2500 };
  for (const [k, v] of selected) if (v.model !== first.model || findItem(k)?.printed) { selected.delete(k); const c = document.querySelector(`.kcard[data-key="${CSS.escape(k)}"]`); if (c) { c.classList.remove('selected'); c.querySelector('.pick').checked = false; } }
  applyPoolFilter(); updateSelectionBar();
}
async function confirmMerge(btn) {
  const items = orderedSelection(), all = items.map(i => findItem(`${i.type}:${i.id}`)).filter(Boolean);
  const qty = all.reduce((s, i) => s + i.planQty, 0), pos = all.flatMap(i => i.type === 'kit' ? i.pos.map(p => p.po) : [i.code]);
  const rows = all.flatMap(i => i.type === 'kit' ? i.pos.map(p => ({ po: p.po, code: p.modelCode, qty: p.planQty, start: p.planStart })) : [{ po: i.code, code: i.modelCode, qty: i.planQty, start: i.planStart }]);
  const nCodes = new Set(rows.map(r => r.code)).size, host = all.find(i => i.type === 'kit' && i.kind === 'merged');
  const ok = await confirmDialog(host ? `Gộp thêm vào ${host.code}` : 'Gộp thành Kit PO', `${host ? `<p class="small-note">Giữ mã <b>${esc(host.code)}</b>${host.planDay ? ` và vị trí ngày ${esc(dmy(host.planDay).slice(0, 5))}` : ''}; PO / Kit khác nhập vào.</p>` : ''}${qty > mergeMode.max ? `<div class="alert-box">Tổng ${fmt(qty)} ea vượt giới hạn gộp ${fmt(mergeMode.max)} ea — vẫn gộp được, Planner kiểm tra lại.</div>` : ''}<div class="sheet-head"><b>${pos.length} PO</b><span>${esc(short(mergeMode.model))}${nCodes > 1 ? ` · ${nCodes} Model Code` : ''}</span><span class="q">${fmt(qty)} ea</span></div>
    ${nCodes > 1 ? '<p class="small-note">Khác Model Code: VLN gộp chung; Rear + VLĐT chia khối theo từng code.</p>' : ''}
    <div class="debt-list">${rows.map(r => `<div><span><b>${esc(r.po)}</b> · ${esc(codeTail(r.code))}${r.start ? ` · ${esc(dmy(r.start).slice(0, 5))} ${esc(r.start.slice(11, 16))}` : ''}</span><b>${fmt(r.qty)}</b></div>`).join('')}</div>`, host ? 'Gộp thêm' : 'Gộp');
  if (!ok) return;
  await withBusy(btn, async () => { const r = await api('/api/board/merge', { json: { items } }); clearSelection(); toast(r.message, 'success', undoAction()); await loadBoard(); });
}
async function openBatchMove() {
  const items = orderedSelection(), d = boardData;
  const opts = d.columns.map(c => `<option value="${c.day}">${weekday(c.day)} ${dmy(c.day)}${c.day === d.today ? ' · hôm nay' : ''} · ${c.items.length} thẻ</option>`).join('');
  const r = await confirmDialog(`Chuyển ${items.length} thẻ sang kitting`, `<div class="form-grid"><label>Ngày kitting<select name="day">${opts}<option value="other">Ngày khác…</option></select></label><label>Vị trí<select name="position"><option value="end">Cuối (ưu tiên sau)</option><option value="start">Đầu (ưu tiên trước)</option></select></label></div><label id="otherDayWrap" hidden>Chọn ngày<input name="otherDay" type="date" value="${d.today}"></label>`, 'Chuyển');
  if (!r) return;
  const day = r.day === 'other' ? r.otherDay : r.day;
  await withBusy(null, async () => { const x = await api('/api/board/batch', { json: { items, day, position: r.position } }); clearSelection(); toast(x.message, 'success', undoAction()); await loadBoard(); });
}
document.addEventListener('change', e => { if (e.target.name === 'day' && e.target.closest('#dialogBody')) { const w = $('#otherDayWrap'); if (w) w.hidden = e.target.value !== 'other'; } });

document.addEventListener('click', async e => {
  const btn = e.target.closest('.kcard .split'); if (!btn) return;
  const card = btn.closest('.kcard'), it = findItem(card.dataset.key);
  const ok = await confirmDialog('Tách Kit PO', `<p>Tách <b>${esc(it.code)}</b> thành ${it.pos.length} PO gốc?</p>`, 'Tách');
  if (!ok) return;
  await withBusy(btn, async () => { const r = await api('/api/board/split', { json: { id: it.id } }); selected.delete(card.dataset.key); toast(r.message, 'success', undoAction()); await loadBoard(); });
});
$('#boardReload').addEventListener('click', () => loadBoard().catch(e => toast(e.message, 'error')));
$('#boardToday').addEventListener('click', () => { $('#boardFrom').value = today; loadBoard().catch(e => toast(e.message, 'error')); });
$('#boardFrom').addEventListener('change', () => loadBoard().catch(e => toast(e.message, 'error')));
$('#boardDays').addEventListener('change', () => loadBoard().catch(e => toast(e.message, 'error')));


/* ---------- menu thao tác trên thẻ (dùng tốt trên điện thoại) ---------- */
function columnOf(it) {
  if (boardData.pool.some(x => itemKey(x) === itemKey(it))) return { day: null, items: boardData.pool };
  const col = boardData.columns.find(c => c.items.some(x => itemKey(x) === itemKey(it)));
  return col ? { day: col.day, items: col.items } : null;
}
const ref = x => ({ type: x.type, id: x.id });
async function moveItem(it, targetDay, position) {
  const src = columnOf(it); if (!src) return;
  const srcList = src.items.filter(x => itemKey(x) !== itemKey(it));
  let payload;
  if (position === 'up' || position === 'down') {
    const list = [...src.items], i = list.findIndex(x => itemKey(x) === itemKey(it)), j = position === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    payload = [{ day: src.day, items: list.map(ref) }];
  } else if ((targetDay || null) === src.day) {
    const list = position === 'start' ? [it, ...srcList] : [...srcList, it];
    payload = [{ day: src.day, items: list.map(ref) }];
  } else {
    const target = targetDay ? boardData.columns.find(c => c.day === targetDay).items : [];
    const list = position === 'start' ? [it, ...target] : [...target, it];
    payload = [{ day: src.day, items: srcList.map(ref) }, { day: targetDay || null, items: list.map(ref) }];
  }
  try { const r = await api('/api/board/apply', { json: { columns: payload } }); toast(r.moved ? 'Đã cập nhật kế hoạch' : 'Đã đổi thứ tự', 'success', undoAction()); }
  catch (e) { toast(e.message, 'error'); }
  await loadBoard().catch(e => toast(e.message, 'error'));
}
document.addEventListener('click', async e => {
  const btn = e.target.closest('.kcard .more'); if (!btn) return;
  const it = findItem(btn.closest('.kcard').dataset.key); if (!it) return;
  const src = columnOf(it), planned = !!src.day;
  const idx = planned ? src.items.findIndex(x => itemKey(x) === itemKey(it)) : -1;
  const options = [`<option value="">— Chưa lập kế hoạch —</option>`, ...boardData.columns.map(c => `<option value="${c.day}" ${c.day === src.day ? 'selected' : ''}>${weekday(c.day)} ${dmy(c.day)}${c.day === boardData.today ? ' (hôm nay)' : ''} · ${c.items.length} thẻ</option>`)];
  const body = `<p><b>${esc(it.code)}</b> · ${esc(it.model)} · ${esc(it.modelCode)} · Plan ${fmt(it.planQty)}</p>
    ${planned ? `<div class="btn-row"><button type="button" class="secondary" data-act="up" ${idx <= 0 ? 'disabled' : ''}>▲ Lên 1 bậc</button><button type="button" class="secondary" data-act="down" ${idx >= src.items.length - 1 ? 'disabled' : ''}>▼ Xuống 1 bậc</button><span class="hint">Ưu tiên ${esc(short(it.model))} #${it.mrank} · Kho làm thứ ${it.rank}</span></div>` : ''}
    <label>Chuyển đến<select name="day">${options.join('')}</select></label>
    <label>Vị trí trong ngày<select name="pos"><option value="end">Cuối danh sách (ưu tiên sau)</option><option value="start">Đầu danh sách (ưu tiên trước)</option></select></label>
    <p class="hint">Ngày khác khoảng đang xem: đổi “Từ ngày” trên thanh công cụ.</p>
    ${it.kind === 'merged' && !it.printed ? '<button type="button" class="secondary" data-act="split">Tách Kit PO thành PO gốc</button>' : ''}`;
  const r = await confirmDialog('Thao tác kế hoạch', body, 'Chuyển');
  if (!r) return;
  if (r.act === 'up' || r.act === 'down') return moveItem(it, undefined, r.act);
  if (r.act === 'split') { await withBusy(null, async () => { const x = await api('/api/board/split', { json: { id: it.id } }); toast(x.message, 'success', undoAction()); await loadBoard(); }); return; }
  await moveItem(it, r.day || null, r.pos);
});

/* =================== LINE & THAM SỐ =================== */
let paramState = null;
async function loadLinesTab() {
  const shiftSel = $('#assignShift');
  if (!shiftSel.options.length) shiftSel.innerHTML = '<option value="all">Cả 2 ca</option>' + (settings.shifts || 'Ngày,Đêm').split(',').map(s => `<option value="${esc(s.trim())}">Ca ${esc(s.trim())}</option>`).join('');
  await Promise.all([loadAssign(), loadParams()]);
}
let lastAssign = null, lastVln = null, weekData = null, weekDirty = new Map();
function renderLineKpis() {
  if (!lastAssign || !lastVln || !paramState) return;
  const running = lastAssign.rows.filter(r => r.model);
  const known = new Set(paramState.rows.filter(r => !r.isNew).map(r => `${r.line}\u001f${r.model}`));
  const noParam = running.filter(r => !known.has(`${r.line}\u001f${r.model}`)).length;
  const bad = lastVln.rows.filter(r => vlnStatus(r) === 'bad').length;
  $('#lineKpis').innerHTML =
    kpi('Line chạy hôm đó', `${running.length}<small>/${lastAssign.rows.length}</small>`) +
    kpi('Model đang chạy', fmt(lastVln.rows.length)) +
    kpi('Model thiếu PO', fmt(bad), { tone: bad ? 'bad' : 'ok' }) +
    kpi('Thiếu tham số', fmt(noParam), { tone: noParam ? 'warn' : 'ok' });
}
async function loadAssign() {
  const day = $('#assignDay').value || today, sel = $('#assignShift').value || 'all';
  const shift = sel === 'all' ? (settings.shifts || 'Ngày').split(',')[0] : sel;
  const [a, v, w] = await Promise.all([api(`/api/lines/assign?day=${day}&shift=${encodeURIComponent(shift)}`), api(`/api/vln-overview?day=${day}&shift=${encodeURIComponent(shift)}`), api(`/api/lines/week?start=${day}&shift=${encodeURIComponent(sel)}`)]);
  lastAssign = a; lastVln = v; weekData = w; weekDirty = new Map();
  erpLine = await api('/api/lines/erp').catch(() => null);
  renderErpBar(); renderWeek();
  $('#vlnTable').innerHTML = v.rows.length ? v.rows.map(r => vlnBarHtml(r, false)).join('') : '<p class="empty">Chưa có Line chạy</p>';
  paintBars($('#vlnTable'));
  renderLineKpis();
}
// Kế hoạch Line từ Next ERP: thanh trạng thái + nút đồng bộ; đã đồng bộ thành công thì bảng tuần chỉ xem (sửa trên ERP).
let erpLine = null;
const erpLocked = () => !!erpLine?.locked;
function renderErpBar() {
  const s = erpLine, bar = $('#erpBar');
  bar.hidden = !(s && (s.configured || s.lineSync));
  if (bar.hidden) return;
  const L = s.last, um = L?.unmatched || {}, miss = [...(um.line || []).map(x => `Line ${x.name}`), ...(um.model || []).map(x => `Model ${x.name}`), ...(um.shift || []).map(x => `Ca ${x.name}`)];
  const info = !L ? '<span class="muted">Chưa đồng bộ lần nào</span>'
    : L.ok ? `<b>Next ERP</b> · ${esc(localTime(L.at))} · ${fmt(L.cells)} ô ${L.from ? `${esc(dmy(L.from).slice(0, 5))}–${esc(dmy(L.to).slice(0, 5))}` : ''}${L.added || L.changed || L.removed ? ` <span class="muted">(+${L.added} ~${L.changed} −${L.removed})</span>` : ''}`
      : `<span class="bad-text">Lỗi đồng bộ ${esc(localTime(L.at))}: ${esc(L.error)}</span>`;
  bar.innerHTML = `<span class="erp-tag ${s.locked ? 'on' : ''}">${s.locked ? '🔒 Theo ERP · chỉ xem' : 'ERP'}</span><span class="erp-info">${info}</span>
    ${can('lines') ? '<button type="button" class="secondary" id="erpSync">⟳ Đồng bộ ERP</button>' : ''}
    ${miss.length ? `<details class="erp-miss"><summary class="warn-text">${miss.length} mục ERP chưa ghép được</summary>${miss.map(esc).join(' · ')}</details>` : ''}${(L?.conflict || []).length ? `<details class="erp-miss"><summary class="warn-text">${L.conflict.length} ô trùng Model</summary>${L.conflict.map(esc).join('<br>')}</details>` : ''}`;
}
$('#erpBar').addEventListener('click', e => {
  const b = e.target.closest('#erpSync'); if (!b) return;
  withBusy(b, async () => { try { const r = await api('/api/lines/erp/sync', { json: {} }); r.ok ? toast(`Đồng bộ ERP: ${fmt(r.cells)} ô (+${r.added} ~${r.changed} −${r.removed})`, 'success') : toast(r.error, 'error'); } finally { await loadAssign(); } });
});
// Rải chuyền / Pending / UPH của Line với Model chạy ngày đang chọn — sửa ngay trên bảng tuần, tự lưu. Cặp chưa khai: gợi ý số mới nhất của cùng Model.
function dayModel(line, day) { const ms = weekData.cells[line]?.[day]?.models || {}; return ms[(settings.shifts || 'Ngày').split(',')[0].trim()] || Object.values(ms).find(Boolean) || ''; }
function paramCells(line, day) {
  const m = dayModel(line, day);
  if (!m || !paramState) return '<td class="wp-m idle"><span class="muted">–</span></td><td class="wp"></td><td class="wp"></td><td class="wp"></td><td class="wp wp-end"></td>';
  const r = paramState.rows.find(x => x.line === line && x.model === m), sg = paramState.suggest?.[m], dis = can('lines') ? '' : 'disabled';
  const inp = (f, v, ph) => `<input class="wp-in" data-f="${f}" type="text" inputmode="numeric" autocomplete="off" value="${v ?? ''}" placeholder="${ph ?? ''}" ${dis}>`;
  const need = r ? (Number(r.spreadQty) || 0) + (Number(r.pendingQty) || 0) + paramState.threshold : null;
  return `<td class="wp-m ${r ? '' : 'miss'}" data-line="${esc(line)}" data-model="${esc(m)}" title="${r ? `${esc(r.updatedBy || '')} ${esc(localTime(r.updatedAt))}` : `Chưa khai tham số${sg ? ` · gợi ý theo ${esc(sg.line)}` : ''}`}"><b>${esc(short(m))}</b></td>
    <td class="wp">${inp('spreadQty', r?.spreadQty, sg?.spreadQty)}</td><td class="wp">${inp('pendingQty', r?.pendingQty || '', r?.pendingExpired ? 'hết hạn' : '0')}</td>
    <td class="wp">${inp('uph', r?.uph, sg?.uph)}</td><td class="wp wp-end num">${need === null ? '<span class="warn-text">chưa khai</span>' : `<b>${fmt(need)}</b>`}</td>`;
}
$('#weekTable').addEventListener('change', e => {
  const inp = e.target.closest('.wp-in'); if (!inp) return;
  e.stopPropagation();
  const tr = inp.closest('tr'), mc = tr.querySelector('.wp-m[data-model]'); if (!mc) return;
  const v = f => tr.querySelector(`.wp-in[data-f="${f}"]`).value.trim(), n = s => s === '' ? 0 : Number(s);
  if ([v('spreadQty'), v('pendingQty'), v('uph')].some(s => s !== '' && !(Number(s) >= 0))) return toast('Nhập số ≥ 0', 'error');
  const row = { line: mc.dataset.line, model: mc.dataset.model, spreadQty: n(v('spreadQty')), pendingQty: n(v('pendingQty')), uph: v('uph') === '' ? null : Number(v('uph')) };
  withBusy(null, async () => { await api('/api/lines/params', { json: { rows: [row] } }); toast(`Đã lưu ${row.line} · ${short(row.model)}`, 'success'); await loadParams(); });
}, true);
function cellModel(line, day) { const k = `${line}\u001f${day}`; return weekDirty.has(k) ? weekDirty.get(k) : (weekData.cells[line]?.[day]?.model || ''); }
function renderWeek() {
  const w = weekData, ro = erpLocked() || !can('lines'), dis = ro ? 'disabled' : '', sel = $('#assignDay').value || today;
  ['#weekSave', '#weekCopy'].forEach(s => { $(s).hidden = erpLocked(); });
  $('#weekTitle').textContent = `Line tuần ${dmy(w.days[0]).slice(0, 5)} – ${dmy(w.days[6]).slice(0, 5)}`;
  const head = w.days.map(d => `<th class="${d === w.today ? 'is-today' : ''} ${d === sel ? 'is-sel' : ''}" data-day="${d}">${weekday(d)}<small>${dmy(d).slice(0, 5)}</small></th>`).join('');
  const active = w.lines.filter(l => l.active);
  const body = active.map(l => `<tr><th class="wk-line">${can('lines') ? `<button type="button" class="link wk-name" data-line="${esc(l.name)}">${esc(l.name)}</button>` : esc(l.name)}${!ro ? `<button type="button" class="link wk-fill" data-line="${esc(l.name)}" title="Áp dụng Model ngày đầu cho cả tuần (trừ CN)">⇥</button>` : ''}</th>${paramCells(l.name, sel)}${w.days.map(d => {
    const m = cellModel(l.name, d), mixed = !weekDirty.has(`${l.name}\u001f${d}`) && w.cells[l.name]?.[d]?.mixed;
    if (erpLocked()) {
      const ms = w.cells[l.name]?.[d]?.models || {}, on = Object.entries(ms).filter(([, v]) => v), mm = on[0]?.[1] || '';
      const sub = on.length === 1 && w.shifts.length > 1 ? `<small class="muted">ca ${esc(on[0][0])}</small>` : new Set(on.map(x => x[1])).size > 1 ? `<small class="warn-text">${on.map(([k, v]) => `${esc(k)}: ${esc(short(v))}`).join(' · ')}</small>` : '';
      return `<td class="wk-ro ${d === w.today ? 'is-today' : ''} ${mm ? '' : 'idle'}">${mm ? `<b>${esc(short(mm))}</b>${sub ? `<br>${sub}` : ''}` : '<span class="muted">–</span>'}</td>`;
    }
    return `<td class="${d === w.today ? 'is-today' : ''} ${weekDirty.has(`${l.name}\u001f${d}`) ? 'dirty' : ''}"><select data-ta data-line="${esc(l.name)}" data-day="${d}" class="${m ? '' : 'idle'} ${mixed ? 'mixed' : ''}" ${dis} title="${mixed ? 'Ca Ngày và Đêm khác nhau' : ''}"><option value="">–</option>${w.models.map(x => `<option value="${esc(x)}" ${x === m ? 'selected' : ''}>${esc(short(x))}</option>`).join('')}</select></td>`;
  }).join('')}</tr>`).join('');
  const pd = dmy(sel).slice(0, 5), thr = paramState?.threshold ?? 0;
  const pHead = `<th class="wp-h">Model ${esc(pd)}</th><th class="wp-h num" title="Rải chuyền">Rải</th><th class="wp-h num" title="Pending — chỉ tính trong ngày làm việc khai báo, sang ngày mới tự về 0">Pend.</th><th class="wp-h num" title="Sản lượng / giờ">UPH</th><th class="wp-h num wp-end" title="Σ Remain PO đã giao nhỏ hơn số này thì Line được cấp tiếp PO (Rải + Pending + ngưỡng ${fmt(thr)})">Cấp &lt;</th>`;
  $('#weekTable').innerHTML = `<thead><tr><th class="wk-line">Line</th>${pHead}${head}</tr></thead><tbody>${body || `<tr><td colspan="13" class="empty">Chưa có Line</td></tr>`}</tbody>`;
  $('#weekSave').textContent = weekDirty.size ? `Lưu (${weekDirty.size})` : 'Lưu';
  $('#weekSave').disabled = !weekDirty.size;
}
$('#weekTable').addEventListener('change', e => {
  const s = e.target.closest('select[data-day]'); if (!s) return;
  const k = `${s.dataset.line}\u001f${s.dataset.day}`, orig = weekData.cells[s.dataset.line]?.[s.dataset.day]?.model || '';
  if (s.value === orig && !weekData.cells[s.dataset.line]?.[s.dataset.day]?.mixed) weekDirty.delete(k); else weekDirty.set(k, s.value);
  renderWeek();
});
$('#weekTable').addEventListener('click', async e => {
  const th = e.target.closest('th[data-day]'); if (th) { $('#assignDay').value = th.dataset.day; return loadAssign().catch(err => toast(err.message, 'error')); }
  const fill = e.target.closest('.wk-fill');
  if (fill) {
    const line = fill.dataset.line, src = weekData.days.map(d => cellModel(line, d)).find(Boolean);
    if (!src) return toast('Chọn Model cho ít nhất 1 ngày trước', 'error');
    weekData.days.slice(0, 6).forEach(d => { if (cellModel(line, d) !== src) weekDirty.set(`${line}\u001f${d}`, src); });
    return renderWeek();
  }
  const nm = e.target.closest('.wk-name'); if (!nm) return;
  const r = await confirmDialog(nm.dataset.line, `<label>Đổi tên<input name="newName" value="${esc(nm.dataset.line)}" maxlength="40"></label><div class="btn-row"><button type="button" class="danger-outline" data-act="delete">Xóa line</button></div>`, 'Lưu tên');
  if (!r) return;
  await withBusy(null, async () => {
    const x = r.act === 'delete' ? await api('/api/lines/manage', { json: { action: 'delete', name: nm.dataset.line } })
      : r.newName.trim() === nm.dataset.line ? null : await api('/api/lines/manage', { json: { action: 'rename', name: nm.dataset.line, newName: r.newName } });
    if (x) { toast(x.message, 'success'); await Promise.all([loadAssign(), loadParams()]); }
  });
});
$('#weekSave').addEventListener('click', e => withBusy(e.currentTarget, async () => {
  const cells = [...weekDirty].map(([k, model]) => { const [line, day] = k.split('\u001f'); return { line, day, model }; });
  const r = await api('/api/lines/week', { json: { shift: $('#assignShift').value, cells } });
  toast(`Đã lưu ${r.count} ô`, 'success'); await Promise.all([loadAssign(), loadParams()]);
}));
$('#weekCopy').addEventListener('click', e => withBusy(e.currentTarget, async () => {
  if (weekDirty.size && !await confirmDialog('Chép tuần trước', '<p>Bỏ các thay đổi chưa lưu?</p>', 'Chép')) return;
  const r = await api('/api/lines/week/copy', { json: { start: weekData.start, shift: $('#assignShift').value } });
  toast(`Đã chép ${r.count} ô từ tuần trước`, 'success'); await loadAssign();
}));
$('#weekPrev').addEventListener('click', () => { $('#assignDay').value = addDaysLocal(weekData.start, -7); loadAssign().catch(e => toast(e.message, 'error')); });
$('#weekNext').addEventListener('click', () => { $('#assignDay').value = addDaysLocal(weekData.start, 7); loadAssign().catch(e => toast(e.message, 'error')); });
$('#lineAdd').addEventListener('click', async () => {
  const r = await confirmDialog('Thêm Line', '<label>Tên Line<input name="name" required maxlength="40" placeholder="Line 7"></label>', 'Thêm');
  if (!r) return;
  await withBusy(null, async () => { const x = await api('/api/lines/manage', { json: { action: 'add', name: r.name } }); toast(x.message, 'success'); await loadAssign(); });
});
function addDaysLocal(day, n) { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
$('#assignDay').addEventListener('change', () => loadAssign().catch(e => toast(e.message, 'error')));
$('#assignShift').addEventListener('change', () => loadAssign().catch(e => toast(e.message, 'error')));

async function loadParams() {
  paramState = await api('/api/lines/params');
  renderParams(); renderLineKpis(); if (weekData) renderWeek();
}
function renderParams() {
  const p = paramState, dis = can('lines') ? '' : 'disabled';
  const lineOpts = v => p.lines.map(l => `<option ${l === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const modelOpts = v => '<option value="">Model</option>' + p.models.map(m => `<option value="${esc(m)}" ${m === v ? 'selected' : ''}>${esc(short(m))}</option>`).join('');
  const need = r => (Number(r.spreadQty) || 0) + (Number(r.pendingQty) || 0) + p.threshold;
  $('#paramTable').innerHTML = `<thead><tr><th>Line</th><th>Model</th><th class="num">Rải chuyền</th><th class="num">Pending</th><th class="num" title="Sản lượng / giờ của Line với Model này — dùng tính số giờ còn việc">UPH</th><th class="num" title="Σ Remain PO đã giao nhỏ hơn số này thì Line được cấp tiếp PO (Rải chuyền + Pending + ngưỡng ${fmt(p.threshold)})">Cấp khi Remain &lt;</th><th>Ghi chú</th><th></th></tr></thead><tbody>` + (p.rows.length ? p.rows.map((r, i) => `<tr data-i="${i}" title="${r.updatedBy ? `${esc(r.updatedBy)} · ${esc(localTime(r.updatedAt))}` : ''}">
    <td>${r.isNew ? `<select data-ta data-f="line" ${dis}>${lineOpts(r.line)}</select>` : `<b>${esc(r.line)}</b>`}</td>
    <td>${r.isNew ? `<select data-ta data-f="model" ${dis}>${modelOpts(r.model)}</select>` : esc(short(r.model))}</td>
    <td><input class="num" data-f="spreadQty" type="number" min="0" step="1" value="${r.spreadQty}" ${dis}></td>
    <td><input class="num" data-f="pendingQty" type="number" min="0" step="1" value="${r.pendingQty}" ${dis}></td>
    <td><input class="num" data-f="uph" type="number" min="0" step="1" value="${r.uph ?? ''}" placeholder="–" ${dis}></td>
    <td class="num big-num need">${fmt(need(r))}</td>
    <td><input data-f="note" value="${esc(r.note)}" maxlength="200" ${dis}></td>
    <td>${can('lines') ? `<button type="button" class="link del-param" aria-label="Xóa">✕</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="8" class="empty">Chưa có tham số</td></tr>') + '</tbody>';
  $('#paramMissing').innerHTML = p.missing.length && can('lines') ? p.missing.map((m, i) => `<button type="button" class="chip-add add-missing" data-i="${i}">+ ${esc(m.line)} · ${esc(short(m.model))}</button>`).join('') : '';
}
$('#paramTable').addEventListener('input', e => {
  const tr = e.target.closest('tr[data-i]'); if (!tr || !e.target.matches('[data-f="spreadQty"],[data-f="pendingQty"]')) return;
  const v = f => Number(tr.querySelector(`[data-f="${f}"]`).value) || 0;
  tr.querySelector('.need').textContent = fmt(v('spreadQty') + v('pendingQty') + paramState.threshold);
});
function readParamInputs() {
  $$('#paramTable tbody tr[data-i]').forEach(tr => {
    const r = paramState.rows[Number(tr.dataset.i)];
    tr.querySelectorAll('[data-f]').forEach(inp => { r[inp.dataset.f] = inp.type === 'number' ? (inp.value === '' ? null : Number(inp.value)) : inp.value; });
  });
}
$('#addParam').addEventListener('click', () => { readParamInputs(); paramState.rows.push({ line: paramState.lines[0], model: '', spreadQty: 0, pendingQty: 0, note: '', isNew: true }); renderParams(); });
$('#paramMissing').addEventListener('click', e => { const b = e.target.closest('.add-missing'); if (!b) return; readParamInputs(); const m = paramState.missing.splice(Number(b.dataset.i), 1)[0]; paramState.rows.push({ ...m, spreadQty: 0, pendingQty: 0, note: '', isNew: true }); renderParams(); });
$('#paramTable').addEventListener('click', async e => {
  const b = e.target.closest('.del-param'); if (!b) return;
  readParamInputs();
  const i = Number(b.closest('tr').dataset.i), r = paramState.rows[i];
  if (r.isNew) { paramState.rows.splice(i, 1); renderParams(); return; }
  if (!await confirmDialog('Xóa tham số', `<p>Xóa rải chuyền / pending của <b>${esc(r.line)} / ${esc(r.model)}</b>?</p>`, 'Xóa')) return;
  await withBusy(b, async () => { await api('/api/lines/params/delete', { json: { line: r.line, model: r.model } }); toast('Đã xóa.', 'success'); await loadParams(); });
});
$('#saveParams').addEventListener('click', e => withBusy(e.currentTarget, async () => {
  readParamInputs();
  const rows = paramState.rows.map(r => ({ line: r.line, model: r.model, spreadQty: r.spreadQty, pendingQty: r.pendingQty, uph: r.uph, note: r.note }));
  if (!rows.length) throw new Error('Chưa có dòng nào.');
  const r = await api('/api/lines/params', { json: { rows } });
  toast(`Đã lưu ${r.count} dòng`, 'success'); await loadParams();
}));

/* =================== DỮ LIỆU PO =================== */
let poTimer = 0;
let poAll = null;
async function loadPo() {
  const d = await api('/api/po');
  poAll = d;
  const li = d.lastImport;
  $('#poImportInfo').textContent = li ? `${li.source} · ${localTime(li.created_at)} · +${li.summary.inserted} mới, ${li.summary.changed ?? li.summary.updated} thay đổi${li.summary.cancelled?.length ? `, ${li.summary.cancelled.length} Cancel` : ''}${li.summary.missing ? `, ${li.summary.missing} không còn trong nguồn` : ''}` : '';
  if (!$('#poFrom').value && !$('#poTo').value && $('#poQuick .active')) setPoRange($('#poQuick .active').dataset.q);
  renderPoAlerts(d.alerts || []);
  renderPo();
}
// Lọc theo Plan Date: mặc định tuần này (T2–CN); PO chưa có Plan Date luôn hiện.
function poQuickRange(q) {
  const t = today || new Date().toISOString().slice(0, 10), [y, m, dd] = t.split('-').map(Number), D = (yy, mm, d) => new Date(Date.UTC(yy, mm - 1, d)).toISOString().slice(0, 10);
  const wd = (new Date(Date.UTC(y, m - 1, dd)).getUTCDay() + 6) % 7;
  return { today: [t, t], week: [D(y, m, dd - wd), D(y, m, dd - wd + 6)], month: [D(y, m, 1), D(y, m + 1, 0)], all: ['', ''] }[q];
}
function setPoRange(q) {
  const [f, t] = poQuickRange(q); $('#poFrom').value = f; $('#poTo').value = t;
  $$('#poQuick button').forEach(b => b.classList.toggle('active', b.dataset.q === q));
}
const PO_STEP = { recall: ['bad', 'Thu hồi từ line'], return: ['warn', 'Trả kho vật liệu'], drop: ['info', 'Gỡ khỏi kế hoạch'], check: ['muted', 'Kiểm tra file nguồn'] };
function renderPoAlerts(list) {
  const can = canTok('po:2|kho:2');
  $('#poAlerts').innerHTML = list.length ? `<div class="card alert po-alerts"><b class="bad-text">PO hủy / mất khỏi nguồn trong kế hoạch: ${list.length}</b>${list.map(a => `<div class="po-alert">
    <b>${esc(a.code)}</b>${a.line ? `<span class="pill info">${esc(a.line)}</span>` : a.planDay ? `<span class="muted">KH ${esc(dmy(a.planDay).slice(0, 5))}</span>` : ''}
    <span>${a.pos.map(p => `${esc(p.po)} <span class="pill ${p.why === 'cancel' ? 'bad' : 'muted'}">${p.why === 'cancel' ? 'Cancel' : 'Mất nguồn'}</span>`).join(' ')}${a.total > a.pos.length ? ` <span class="muted">/ ${a.total} PO</span>` : ''}</span>
    <span class="pill ${PO_STEP[a.step][0]}">${PO_STEP[a.step][1]}</span>${a.step === 'drop' && can ? `<button type="button" class="secondary po-drop" data-id="${a.kitId}" data-code="${esc(a.code)}">Gỡ PO hủy</button>` : ''}</div>`).join('')}</div>` : '';
}
function renderPo() {
  const d = poAll, q = $('#poSearch').value.trim().toLowerCase(), state = $('#poState').value, planned = $('#poPlanned').value;
  const from = $('#poFrom').value, to = $('#poTo').value;
  const inRange = r => !r.planDate || ((!from || r.planDate >= from) && (!to || r.planDate <= to));
  const dated = d.rows.filter(inRange), live = dated.filter(r => r.inSource);
  const unplanned = live.filter(r => r.remainQty > 0 && !r.kitCode && r.state !== 'cancel').length;
  const n = s => live.filter(r => r.state === s).length;
  const on = (s, p) => (state === s && planned === p) ? 'active' : '';
  $('#poKpis').innerHTML =
    kpi('Chưa lập KH', fmt(unplanned), { tone: on('', 'no') || (unplanned ? 'warn' : ''), act: 'planned:no' }) +
    kpi('Chưa SX', fmt(n('waiting')), { act: 'state:waiting', tone: on('waiting', '') }) +
    kpi('Đang SX', fmt(n('running')), { act: 'state:running', tone: on('running', '') }) +
    kpi('Đã xong', fmt(n('done')), { act: 'state:done', tone: on('done', '') || 'ok' }) +
    kpi('Đã hủy', fmt(n('cancel')), { act: 'state:cancel', tone: on('cancel', '') || (n('cancel') ? 'bad' : '') });
  const rows = dated.filter(r => (!q || [r.po, r.modelCode, r.model, r.masterLine, r.planStatus].some(v => String(v || '').toLowerCase().includes(q)))
    && (!state || r.state === state) && (!planned || (planned === 'yes' ? r.kitCode : !r.kitCode && r.remainQty > 0 && r.state !== 'cancel')));
  const shown = rows.slice(0, 800);
  $('#poCount').textContent = `${fmt(rows.length)} PO`;
  const statusPill = r => { const st = r.planStatus || STATE[r.state]; return `<i class="dot ${r.state}" title="${STATE[r.state]}"></i> <span class="pill ${r.state === 'cancel' ? 'bad' : r.state === 'done' ? 'ok' : r.state === 'running' ? 'info' : 'muted'}">${esc(st)}</span>`; };
  const hm = t => t ? `${esc(dmy(t).slice(0, 5))} ${esc(String(t).slice(11, 16))}` : '';
  $('#poTable').innerHTML = '<thead><tr><th>Plan</th><th>PO</th><th>Model · Code</th><th>Master Line</th><th>Bắt đầu → Kết thúc</th><th class="num">Plan Q\'ty</th><th class="num">Đã SX</th><th class="num">Remain</th><th>Trạng thái sau cùng</th><th>Dữ liệu mới nhất</th><th>Kitting</th></tr></thead><tbody>' + (shown.length ? shown.map(r => `<tr class="po-row${r.inSource ? '' : ' gone'}${r.state === 'cancel' ? ' cancel' : ''}" data-po="${esc(r.po)}"${r.inSource ? '' : ' title="Không còn trong file nguồn"'}><td>${esc(dmy(r.planDate).slice(0, 5))}</td><td><b>${esc(r.po)}</b>${notePill(r.note ? [{ po: r.po, note: r.note }] : [])}${r.poType !== 'SAP' ? `<span class="sub-cell"><span class="pill warn">${(IPO_LABEL[r.poType] || r.poType)}</span>${r.fixedLine ? ` → ${esc(r.fixedLine)}` : ''}</span>` : ''}</td><td>${esc(short(r.model))}<span class="sub-cell">${esc(r.modelCode)}</span></td><td>${esc(r.masterLine) || '<span class="muted">–</span>'}</td><td class="nowrap">${r.planStart ? `${hm(r.planStart)}${r.planEnd ? `<span class="sub-cell">→ ${hm(r.planEnd)}</span>` : ''}` : '<span class="muted">–</span>'}</td><td class="num">${fmt(r.planQty)}</td><td class="num">${fmt(r.productionQty)}</td><td class="num big-num">${fmt(r.remainQty)}</td><td class="nowrap">${statusPill(r)}</td><td class="nowrap" title="${esc(r.lastSourceFull)}">${esc(localTime(r.lastAt))}<span class="sub-cell">${esc(r.lastSource)}</span></td><td>${r.kitCode ? (r.kitKind === 'merged' ? `<span class="pill merged">${esc(r.kitCode)}</span>` : '') + (r.kitDay ? ` ${esc(dmy(r.kitDay).slice(0, 5))}` : '') : '<span class="muted">–</span>'}</td></tr>`).join('') : '<tr><td colspan="11" class="empty">Không có PO</td></tr>') + '</tbody>';
}
$('#poKpis').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const [k, v] = b.dataset.act.split(':');
  const sel = k === 'state' ? $('#poState') : $('#poPlanned'), other = k === 'state' ? $('#poPlanned') : $('#poState');
  sel.value = sel.value === v ? '' : v; other.value = ''; renderPo();
});
['#poState', '#poPlanned'].forEach(s => $(s).addEventListener('change', () => poAll && renderPo()));
$('#poSearch').addEventListener('input', () => { clearTimeout(poTimer); poTimer = setTimeout(() => poAll && renderPo(), 150); });
// PO nội bộ (Unplan / RMA): Planner tạo, kitting theo BOM, ấn định Line. Model Code / Line gõ để lọc.
// Form PO nội bộ dùng chung: tạo mới / Admin sửa (edit = { po, label, locked }: không đổi loại; kit đã kitting → chỉ sửa chứng từ / ghi chú)
const ipoForm = (o, v, msg, edit) => { const ro = edit?.locked ? 'readonly' : ''; return `${msg ? `<p class="message error">${esc(msg)}</p>` : ''}${edit?.locked ? `<p class="alert-box">${esc(edit.kit)} đã bắt đầu kitting: chỉ sửa được Số biên bản / Ghi chú. Muốn đổi SL, Line, Model Code thì Kho thu hồi / trả kho trước.</p>` : ''}<div class="form-grid">
      ${edit ? `<label>Loại PO<input value="${esc(edit.label)}" readonly></label>` : `<label>Loại PO<select name="type">${o.types.map(t => `<option value="${t.key}" ${t.key === v.type ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>`}
      <label>Số lượng (ea)<input name="qty" type="number" min="1" step="1" required value="${esc(v.qty || '')}" ${ro}></label>
      <label>Model Code<input name="modelCode" list="ipoCodes" required autocomplete="off" placeholder="Gõ để lọc" value="${esc(v.modelCode || '')}" ${ro}></label>
      <label>Line sản xuất <small class="muted">(Load TP: bỏ trống)</small><input name="line" list="ipoLines" autocomplete="off" placeholder="Gõ để lọc" value="${esc(v.line || '')}" ${ro}></label>
      <label>Ngày cần<input name="planDate" type="date" value="${esc(v.planDate || '')}" ${ro}></label>
      <label>Giờ bắt đầu<input name="planTime" type="time" value="${esc(v.planTime || '')}" ${ro}></label>
      <label>Số biên bản / RMA / phiếu xuất TP<input name="refDoc" maxlength="60" required value="${esc(v.refDoc || '')}"></label>
      <label>Ghi chú<input name="note" maxlength="200" value="${esc(v.note || '')}"></label></div>
      <p class="hint small-note"><b>Load thành phẩm:</b> nhập số dương = SL thành phẩm Kho cấp; PO sinh ra số âm, gộp vào Kit có PO thật cùng Model Code để trừ vật liệu (cả Rear). Tự Hoàn thành khi PO thật xong.</p>
      <datalist id="ipoCodes">${o.codes.map(c => `<option value="${esc(c.code)}">${esc(c.model)}</option>`).join('')}</datalist>
      <datalist id="ipoLines">${o.lines.map(l => `<option value="${esc(l)}">`).join('')}</datalist>`; };
async function ipoDialog(title, v, edit) {
  const o = await api('/api/po/internal/options'); let msg = '';
  for (;;) {
    const r = await confirmDialog(title, ipoForm(o, v, msg, edit), edit ? 'Lưu' : 'Tạo PO', 'wide');
    if (!r) return;
    v = { ...v, ...r };
    if (!edit?.locked && (r.type || v.type) !== 'LOAD' && !o.lines.includes(String(r.line || '').trim())) { msg = `Line "${r.line || ''}" không có trong danh sách.`; continue; }
    if (!edit?.locked && !o.codes.some(c => c.code === r.modelCode.trim())) { msg = `Model Code "${r.modelCode}" chưa có BOM.`; continue; }
    try {
      const x = edit ? await api('/api/po/internal/edit', { json: { ...r, po: edit.po, qty: Number(r.qty) } }) : await api('/api/po/internal', { json: { ...r, qty: Number(r.qty) } });
      toast(x.message, 'success'); await loadPo(); return;
    } catch (err) { msg = err.message; }
  }
}
$('#poInternal').addEventListener('click', e => withBusy(e.currentTarget, () => ipoDialog('Tạo PO nội bộ', { type: 'UNPLAN', planDate: today })));
$('#poQuick').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; setPoRange(b.dataset.q); poAll && renderPo(); });
['#poFrom', '#poTo'].forEach(s => $(s).addEventListener('change', () => { $$('#poQuick button').forEach(b => b.classList.remove('active')); poAll && renderPo(); }));
$('#poAlerts').addEventListener('click', e => {
  const b = e.target.closest('.po-drop'); if (!b) return;
  withBusy(b, async () => {
    if (!await confirmDialog('Gỡ PO hủy', `Gỡ PO hủy khỏi kế hoạch <b>${esc(b.dataset.code)}</b>?`, 'Gỡ')) return;
    const r = await api('/api/po/drop-cancelled', { json: { kitId: Number(b.dataset.id) } }); toast(r.message, 'success'); await loadPo();
  });
});
// Lịch sử 1 PO qua các lần nhập file / API.
const PO_HK = { edit: 'Sửa PO nội bộ', note: 'Ghi chú', new: 'Mới', change: 'Thay đổi', prod: 'Cập nhật SX', cancel: 'Cancel', gone: 'Mất khỏi nguồn', back: 'Có lại trong nguồn' };
const PO_HF = { reason: 'Lý do', note: 'Ghi chú', po_type: 'Loại PO', fixed_line: 'Line ấn định', ref_doc: 'Chứng từ', created_by: 'Người tạo', plan_qty: "Plan Q'ty", production_qty: 'Production', remain_qty: 'Remain', plan_status: 'Status', model_code: 'Model Code', plan_date: 'Plan Date', plan_start: 'Plan Start', in_source: 'Trong nguồn' };
const poHv = (f, v) => v === null || v === '' ? '–' : f.endsWith('_qty') ? fmt(v) : f === 'plan_date' ? dmy(v) : f === 'plan_start' ? hm(String(v)) : f === 'in_source' ? (v ? 'Có' : 'Không') : esc(v);
$('#poTable').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-po]'); if (!tr) return;
  withBusy(null, async () => {
    const h = await api('/api/po/history?po=' + encodeURIComponent(tr.dataset.po)), edit = canTok('po:2');
    const noteF = edit ? `<label>Ghi chú cho Kho / Kitting / SX <small class="muted">(tối đa 200 ký tự, để trống = xóa)</small><textarea name="note" maxlength="200" rows="2">${esc(h.note)}</textarea></label>`
      : h.note ? `<div class="note-box"><b>📝 Ghi chú Planner</b><div>${esc(h.note)}</div></div>` : '';
    const ip = h.internal, adm = sp('internalPo') && ip && !ip.cancelled;
    const ipoBar = adm ? `<div class="btn-row"><button type="button" class="secondary" data-act="ipo-edit">✏ Sửa PO nội bộ</button><button type="button" class="secondary danger-text" data-act="ipo-cancel" ${ip.locked ? 'disabled title="Kit đã bắt đầu kitting"' : ''}>Hủy PO nội bộ</button>${ip.kit ? `<span class="muted">Trong ${esc(ip.kit)}${ip.locked ? ' · đã kitting' : ''}</span>` : ''}</div>` : '';
    const v = await confirmDialog(`PO ${h.po}`, ipoBar + noteF + (h.rows.length ? `<div class="table-scroll"><table class="grid po-hist"><thead><tr><th>Lúc</th><th></th><th>Thay đổi</th></tr></thead><tbody>${h.rows.map(x => `<tr><td>${esc(localTime(x.at))}<span class="sub-cell">${esc(x.source)}</span></td><td><span class="pill ${x.kind === 'cancel' ? 'bad' : x.kind === 'gone' ? 'muted' : x.kind === 'new' ? 'ok' : 'info'}">${PO_HK[x.kind] || esc(x.kind)}</span></td><td>${Object.entries(x.changes).map(([f, [a, b]]) => `<div>${PO_HF[f] || esc(f)}: ${x.kind === 'new' ? '' : `${poHv(f, a)} → `}<b>${poHv(f, b)}</b></div>`).join('')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Chưa có lịch sử (PO nhập trước bản cập nhật).</p>'), edit ? 'Lưu ghi chú' : null, 'wide');
    if (v?.act === 'ipo-edit') return ipoDialog(`Sửa PO ${ip.label} ${h.po}`, ip, { po: h.po, label: ip.label, locked: ip.locked, kit: ip.kit });
    if (v?.act === 'ipo-cancel') {
      const c = await confirmDialog(`Hủy PO ${h.po}`, `<p>Hủy PO ${esc(ip.label)} <b>${esc(h.po)}</b>${ip.kit ? ` và gỡ khỏi <b>${esc(ip.kit)}</b>` : ''}? PO chuyển sang Cancel, không lập KH / kitting được nữa.</p><label>Lý do hủy<input name="reason" maxlength="200" required placeholder="VD: tạo nhầm loại / trùng"></label>`, 'Hủy PO');
      if (!c) return;
      const r = await api('/api/po/internal/cancel', { json: { po: h.po, reason: c.reason } }); toast(r.message, 'success'); return loadPo();
    }
    if (!v || !edit || v.act || String(v.note || '').trim() === h.note) return;
    const r = await api('/api/po/note', { json: { po: h.po, note: v.note } }); toast(r.message, 'success'); await loadPo();
  });
});
$('#poFile').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  await withBusy(null, async () => {
    toast(`Đang đọc ${file.name}…`);
    const rows = await readExcelFile(file, 'po');
    const r = await api('/api/po/import', { json: { source: file.name, rows } });
    toast(`${r.total} PO · +${r.inserted} mới · ${r.changed} thay đổi${r.cancelled.length ? ` · ${r.cancelled.length} Cancel` : ''}${r.missing ? ` · ${r.missing} không còn trong nguồn` : ''}${r.changedModel.length ? ` · ${r.changedModel.length} PO đổi Model Code` : ''}`, 'success');
    await loadPo();
  });
});
/* =================== BOM & MODEL =================== */
// BOM gốc theo Model Code → tách BOM VLN theo Model (dùng chung) + BOM Rear / VLĐT theo Model Code.
let bomCat = null, bomModel = '', bomView = 'raw', bomCode = '', bomDetail = null, bomErp = null;
// BOM theo Next ERP (đã đồng bộ, đang bật): MM chỉ đọc BOM — ẩn nhập file / sửa dòng / ECN; nhóm kitting và Point VLN tay vẫn sửa.
const bomLocked = () => !!bomErp?.locked;
function renderBomErp() {
  const s = bomErp, bar = $('#bomErpBar');
  bar.hidden = !s || !s.configured;
  if (bar.hidden) return;
  const L = s.last, info = !s.bomSync ? 'Tắt — BOM nhập trong MM' : L ? (L.ok ? `${esc(localTime(L.at))} · ${fmt(s.codes)} Model Code theo ERP${L.applied ? ` · +${L.newCodes.length} mới, ${L.changed.length} đổi` : ''}${L.pending ? ` · còn ${L.pending} BOM lấy lần sau` : ''}${L.noModel?.length ? ` · <span class="warn-text">${L.noModel.length} code thiếu Item Group (chưa biết Model): ${esc(L.noModel.slice(0, 5).join(', '))}</span>` : ''}${L.erpMissing?.length ? ` · <span class="warn-text">${L.erpMissing.length} code không còn BOM mặc định trên ERP</span>` : ''}` : `<span class="bad-text">${esc(L.error)}</span>`) : 'Chưa đồng bộ';
  bar.innerHTML = `<span class="erp-tag ${s.locked ? 'on' : ''}">${s.locked ? '🔒 BOM theo ERP · chỉ đọc' : 'ERP'}</span><span class="erp-info">${info}</span>${sp('bomImport') && s.bomSync ? '<button type="button" class="secondary" id="bomErpSync">⟳ Đồng bộ BOM ERP</button>' : ''}`;
  $('#bomTemplate').hidden = s.locked; $('#bomFile').closest('label').hidden = s.locked || !sp('bomImport');
}
$('#bomErpBar').addEventListener('click', e => {
  const b = e.target.closest('#bomErpSync'); if (!b) return;
  withBusy(b, async () => { try { const r = await api('/api/bom/erp/sync', { json: {} }); r.ok ? toast(`BOM ERP: ${fmt(r.total)} BOM · +${r.newCodes.length} mới · ${r.changed.length} đổi${r.pending ? ` · còn ${r.pending} lấy tiếp` : ''}`, 'success') : toast(r.error, 'error'); } finally { await loadBom(); } });
});
const GROUP_ORDER = ['REAR', 'VLDT', 'VLN'];
/* ---------- Change code BOM theo ECN (Quản trị · Trưởng BP Kho · quyền bomChange) ---------- */
const canEcn = () => !!me && (me.role === 'admin' || (me.isHead && (me.role === 'kho' || /kho/i.test(me.dept || ''))) || sp('bomChange'));
const ECN_ST = { scheduled: ['Chờ áp dụng', 'warn'], applied: ['Đã áp dụng', 'ok'], cancelled: ['Đã hủy', 'muted'], failed: ['Lỗi', 'bad'] };
const ecnPill = s => `<span class="pill ${ECN_ST[s]?.[1] || ''}">${ECN_ST[s]?.[0] || esc(s)}</span>`;
// Cảnh báo công khai ở tab BOM / Kho / Kitting: ECN chờ áp dụng + đã áp dụng trong 7 ngày.
async function ecnAlerts() {
  const d = await api('/api/bom/changes/alerts').catch(() => null); if (!d) return;
  const html = d.rows.length ? `<b>⇄ Change code BOM</b>${d.rows.map(x => `<span class="ecn-it ${x.status}">${ecnPill(x.status)} <b>${esc(x.oldMaterial)} → ${esc(x.newMaterial)}</b> · ${esc(short(x.model))} · ${x.codes.length > 2 ? `${x.codes.length} code` : esc(x.codes.map(codeTail).join(', '))} · từ ${esc(dmy(x.effectiveDate).slice(0, 5))} · ECN ${esc(x.ecn)}</span>`).join('')}` : '';
  $$('[data-ecn]').forEach(el => { el.innerHTML = html; el.hidden = !html; });
}
async function ecnDialog() {
  const cat = await api('/api/bom'), models = cat.models.map(m => m.model);
  const r1 = await confirmDialog('⇄ Change code BOM', `<label>Model<select name="model" data-ta required><option value="">Chọn Model</option>${models.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}</select></label>`, 'Tiếp');
  if (!r1?.model) return;
  const dt = await api(`/api/bom/model?model=${encodeURIComponent(r1.model)}`), codes = dt.codeList;
  const mats = new Map(); for (const c of codes) for (const it of dt.byCode[c] || []) { if (!mats.has(it.material)) mats.set(it.material, { ...it, codes: [] }); mats.get(it.material).codes.push(c); }
  let v = { codes: [...codes], old: '', newM: '', desc: '', point: '', reason: 'ECN', note: '', day: today, upd: false }, msg = '';
  for (;;) {
    const body = `${msg ? `<p class="alert-box">${esc(msg)}</p>` : ''}<p><b>${esc(r1.model)}</b></p>
      <fieldset class="ecn-codes"><legend>Model Code</legend><label class="check"><input type="checkbox" name="allCodes" ${v.codes.length === codes.length ? 'checked' : ''}> Tất cả code có mã này</label>${codes.map(c => `<label class="check"><input type="checkbox" name="c:${esc(c)}" ${v.codes.includes(c) ? 'checked' : ''}> ${esc(c)}</label>`).join('')}</fieldset>
      <label>Code trước<select name="old" data-ta required><option value="">Chọn mã trong BOM</option>${[...mats.values()].map(m => `<option value="${esc(m.material)}" ${m.material === v.old ? 'selected' : ''}>${esc(m.material)} · ${GRP_LABEL[m.group] || m.group || ''} · P ${fmt(m.point)} · ${esc((m.description || '').slice(0, 30))} (${m.codes.length}/${codes.length} code)</option>`).join('')}</select></label>
      <div class="two"><label>Code sau<input name="newM" value="${esc(v.newM)}" required maxlength="40" autocomplete="off"></label><label>Point mới <small class="muted">(trống = giữ)</small><input name="point" value="${esc(v.point)}" inputmode="decimal" autocomplete="off"></label></div>
      <label>Mô tả mã mới <small class="muted">(trống = giữ mô tả cũ)</small><input name="desc" value="${esc(v.desc)}" maxlength="200"></label>
      <div class="two"><label>Lý do<select name="reason">${Object.entries(cat.ecnReasons || { ECN: 'Thay đổi kỹ thuật (ECN)', VENDOR: 'Thay nhà cung cấp', EOL: 'Hết hàng / ngừng mã cũ', QUALITY: 'Chất lượng', OTHER: 'Khác' }).map(([k, l]) => `<option value="${k}" ${k === v.reason ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label><label>Ngày áp dụng<input type="date" name="day" value="${esc(v.day)}" required></label></div>
      <label>Ghi chú<input name="note" value="${esc(v.note)}" maxlength="300"></label>
      <label class="check"><input type="checkbox" name="upd" ${v.upd ? 'checked' : ''}> Cập nhật BOM cho PO đã lập kế hoạch <small class="muted">(không chọn: chỉ PO lập KH sau)</small></label>`;
    const r = await confirmDialog('⇄ Change code BOM', body, 'Xem trước', 'wide');
    if (!r) return;
    const sel = r.allCodes ? [...codes] : codes.filter(c => r[`c:${c}`]);
    v = { codes: sel, old: r.old, newM: r.newM.trim(), desc: r.desc.trim(), point: r.point.trim(), reason: r.reason, note: r.note.trim(), day: r.day, upd: !!r.upd };
    const req = { model: r1.model, codes: sel, allCodes: !!r.allCodes, oldMaterial: v.old, newMaterial: v.newM, newDescription: v.desc, newPoint: v.point === '' ? null : Number(v.point.replace(',', '.')), reason: v.reason, note: v.note, effectiveDate: v.day, updatePlanned: v.upd };
    let pv; try { pv = await api('/api/bom/change/preview', { json: req }); } catch (e) { msg = e.message; continue; }
    const pb = `<p>Số ECN tự sinh: <b>${esc(pv.ecn)}</b> · ${esc(pv.model)}</p><p class="ecn-big"><b>${esc(pv.oldMaterial)}</b> → <b>${esc(pv.newMaterial)}</b>${pv.newPoint !== pv.oldPoint ? ` · Point ${fmt(pv.oldPoint)} → <b>${fmt(pv.newPoint)}</b>` : ''}</p>
      <p>${pv.rows.length} Model Code: ${esc(pv.rows.map(x => x.code).join(', '))}</p>
      <p>${pv.now ? '<b>Áp dụng ngay</b>' : `Chờ áp dụng từ <b>${esc(dmy(pv.effectiveDate))}</b>`}</p>
      <p>Kit đã lập KH liên quan: <b>${pv.kits.total}</b> — ${v.upd ? `đổi sang mã mới <b>${pv.kits.update}</b>${pv.kits.kitted.length ? `, <span class="warn-text">đã soạn mã cũ giữ nguyên ${pv.kits.kitted.length}: ${esc(pv.kits.kitted.join(', '))}</span>` : ''}` : 'giữ BOM cũ (chỉ PO lập KH sau dùng mã mới)'}</p>`;
    const ok = await confirmDialog('Xác nhận change code', pb, pv.now ? 'Đổi ngay' : 'Lưu, chờ áp dụng', 'wide');
    if (!ok) continue;
    try { const x = await api('/api/bom/change', { json: req }); toast(x.message, 'success'); await Promise.all([loadBom(), loadEcn()]); return; } catch (e) { msg = e.message; }
  }
}
$('#bomChange').addEventListener('click', e => withBusy(e.currentTarget, ecnDialog));
let ecnRows = [];
async function loadEcn() {
  const q = new URLSearchParams({ q: $('#ecnQ').value.trim(), status: $('#ecnStatus').value, from: $('#ecnFrom').value, to: $('#ecnTo').value });
  ecnRows = (await api(`/api/bom/changes?${q}`)).rows;
  const res = x => x.status === 'applied' && x.result ? `${x.result.bomRows} code${x.result.kitsUpdated?.length ? ` · ${x.result.kitsUpdated.length} kit đổi` : ''}${x.result.kitsKept?.length ? ` · <span class="warn-text">${x.result.kitsKept.length} kit đã soạn giữ</span>` : ''}` : x.status === 'failed' ? `<span class="bad-text">${esc(x.result?.error || '')}</span>` : x.status === 'cancelled' ? esc(x.cancelReason) : '';
  $('#ecnTable').innerHTML = '<thead><tr><th>Ngày áp dụng</th><th>ECN</th><th>Model · Code</th><th>Code trước → sau</th><th>Lý do</th><th>Trạng thái</th><th>Người cập nhật</th><th></th></tr></thead><tbody>' + (ecnRows.length ? ecnRows.map(x => `<tr>
    <td>${esc(dmy(x.effectiveDate))}</td><td><b>${esc(x.ecn)}</b></td><td>${esc(short(x.model))}<span class="sub-cell">${esc(x.codes.join(', '))}</span></td>
    <td><b>${esc(x.oldMaterial)}</b> → <b>${esc(x.newMaterial)}</b>${x.newPoint !== null && x.newPoint !== x.oldPoint ? `<span class="sub-cell">Point ${fmt(x.oldPoint)} → ${fmt(x.newPoint)}</span>` : ''}${x.newDescription ? `<span class="sub-cell">${esc(x.newDescription)}</span>` : ''}</td>
    <td>${esc(x.reasonLabel)}${x.note ? `<span class="sub-cell">${esc(x.note)}</span>` : ''}<span class="sub-cell">${x.updatePlanned ? 'Cập nhật PO đã lập KH' : 'Chỉ PO mới'}</span></td>
    <td>${ecnPill(x.status)}<span class="sub-cell">${res(x)}</span></td>
    <td>${esc(x.createdBy)} <span class="sub-cell">${esc(localTime(x.createdAt))}</span>${x.appliedAt ? `<span class="sub-cell">Áp dụng ${esc(x.appliedBy)} ${esc(localTime(x.appliedAt))}</span>` : ''}${x.cancelledAt ? `<span class="sub-cell">Hủy ${esc(x.cancelledBy)} ${esc(localTime(x.cancelledAt))}</span>` : ''}</td>
    <td>${x.status === 'scheduled' && canEcn() ? `<button type="button" class="link bad-text ecn-cancel" data-id="${x.id}" data-ecn="${esc(x.ecn)}">Hủy</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="8" class="empty">Chưa có change code</td></tr>') + '</tbody>';
}
['#ecnStatus', '#ecnFrom', '#ecnTo'].forEach(s => $(s).addEventListener('change', () => loadEcn().catch(e => toast(e.message, 'error'))));
let ecnT = null; $('#ecnQ').addEventListener('input', () => { clearTimeout(ecnT); ecnT = setTimeout(() => loadEcn().catch(e => toast(e.message, 'error')), 300); });
$('#ecnTable').addEventListener('click', async e => {
  const b = e.target.closest('.ecn-cancel'); if (!b) return;
  const r = await confirmDialog(`Hủy ECN ${b.dataset.ecn}`, '<label>Lý do hủy<input name="reason" required maxlength="200"></label>', 'Hủy ECN');
  if (!r) return;
  await withBusy(b, async () => { const x = await api('/api/bom/change/cancel', { json: { id: Number(b.dataset.id), reason: r.reason } }); toast(x.message, 'success'); await loadEcn(); ecnAlerts(); });
});
$('#ecnXlsx').addEventListener('click', e => withBusy(e.currentTarget, async () => {
  await needExcel();
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Change code');
  ws.columns = [['Ngày áp dụng', 12], ['ECN', 16], ['Model', 18], ['Model Code', 30], ['Code trước', 15], ['Code sau', 15], ['Point cũ', 9], ['Point mới', 9], ['Mô tả mã mới', 30], ['Lý do', 22], ['Ghi chú', 30], ['Phạm vi', 20], ['Trạng thái', 13], ['Kết quả', 40], ['Người tạo', 11], ['Lúc tạo', 17], ['Người áp dụng / hủy', 14], ['Lúc áp dụng / hủy', 17]].map(([header, width]) => ({ header, width }));
  for (const x of ecnRows) ws.addRow([x.effectiveDate, x.ecn, x.model, x.codes.join(', '), x.oldMaterial, x.newMaterial, x.oldPoint, x.newPoint ?? x.oldPoint, x.newDescription, x.reasonLabel, x.note, x.updatePlanned ? 'Cập nhật PO đã lập KH' : 'Chỉ PO mới', ECN_ST[x.status]?.[0] || x.status,
    x.status === 'failed' ? x.result?.error : x.status === 'cancelled' ? x.cancelReason : x.result ? `${x.result.bomRows} code; kit đổi: ${(x.result.kitsUpdated || []).join(' ')}; đã soạn giữ: ${(x.result.kitsKept || []).join(' ')}` : '',
    x.createdBy, localTime(x.createdAt), x.appliedBy || x.cancelledBy || '', localTime(x.appliedAt || x.cancelledAt || '')]);
  ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (await saveBlob(`ChangeCode_BOM_${today}.xlsx`, new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))) toast('Đã tải lịch sử change code', 'success');
}));
async function loadBom() {
  ecnAlerts(); loadEcn().catch(err => toast(err.message, 'error'));
  [bomCat, bomErp] = await Promise.all([api('/api/bom'), api('/api/bom/erp').catch(() => null)]);
  renderBomErp(); $('#bomChange').hidden = !canEcn() || bomLocked();
  const ms = bomCat.models, codes = ms.reduce((s, m) => s + m.codes.length, 0), noBom = ms.reduce((s, m) => s + m.codes.filter(c => !c.rows).length, 0);
  const warn = ms.reduce((s, m) => s + m.warnings, 0), auto = ms.reduce((s, m) => s + m.auto, 0);
  $('#bomKpis').innerHTML =
    kpi('Model', `${ms.filter(m => m.hasBom).length}<small>/${ms.length}</small>`, { sub: 'có BOM / đã biết' }) +
    kpi('Model Code', `${codes - noBom}<small>/${codes}</small>`, { sub: bomCat.missing.length ? `${bomCat.missing.length} code có PO thiếu BOM` : 'có BOM / đã biết', tone: bomCat.missing.length ? 'bad' : '', act: bomCat.missing.length ? 'missing' : '' }) +
    kpi('Cần xem lại', fmt(warn), { tone: warn ? 'bad' : 'ok', act: warn ? 'warn' : '' }) +
    kpi('Nhóm app gợi ý', fmt(auto), { tone: auto ? 'warn' : '', act: auto ? 'auto' : '' });
  $('#bomMissing').innerHTML = bomCat.missing.length ? `<div class="card alert"><b class="bad-text">Có PO nhưng chưa có BOM:</b> ${bomCat.missing.map(m => `<button type="button" class="link miss-code" data-code="${esc(m.model_code)}">${esc(m.model_code)}</button> (${m.pos} PO)`).join(', ')}</div>` : '';
  if (!ms.some(m => m.model === bomModel)) bomModel = (ms.find(m => m.hasBom) || ms[0])?.model || '';
  renderBomModels();
  await openBomModel(bomModel);
}
function renderBomModels() {
  $('#bomModels').innerHTML = bomCat.models.map(m => `<button type="button" class="bom-model ${m.model === bomModel ? 'active' : ''} ${m.hasBom ? '' : 'nobom'}" data-model="${esc(m.model)}">
    <span class="t"><span>${esc(short(m.model))}</span><span>${m.warnings ? `<i class="badge bad" title="Cần xem lại">${m.warnings}</i>` : ''}${m.codes.some(c => !c.rows && c.openPo) ? '<i class="badge bad" title="Code có PO thiếu BOM">!</i>' : ''}${m.openPo ? `<i class="badge info" title="PO đang mở">${m.openPo}</i>` : ''}</span></span>
    <span class="qs-extra" hidden>${m.codes.map(c => esc(c.code)).join(' ')}</span><span class="mini">${m.hasBom ? `<span><b>${m.vln}</b>VLN</span><span><b>${m.hv}</b>Rear+VLĐT</span>` : '<span class="muted">Chưa có BOM</span>'}<span><b>${m.codes.filter(c => c.rows).length}/${m.codes.length}</b>code</span></span></button>`).join('') || '<p class="empty">Chưa có Model</p>';
}
async function openBomModel(model) {
  bomModel = model;
  $$('.bom-model').forEach(x => x.classList.toggle('active', x.dataset.model === model));
  if (!model) { $('#bomDetail').innerHTML = '<p class="empty">Chọn Model</p>'; return; }
  bomDetail = await api(`/api/bom/model?model=${encodeURIComponent(model)}`);
  if (!bomDetail.codeList.includes(bomCode)) bomCode = (bomDetail.codes.find(c => c.rows) || bomDetail.codes[0])?.code || '';
  renderBomDetail();
}
$('#bomModels').addEventListener('click', e => { const b = e.target.closest('.bom-model'); if (b) openBomModel(b.dataset.model).catch(err => toast(err.message, 'error')); });
$('#bomKpis').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const m = bomCat.models.find(x => b.dataset.act === 'warn' ? x.warnings : b.dataset.act === 'auto' ? x.auto : x.codes.some(c => !c.rows && c.openPo));
  if (m) { bomView = b.dataset.act === 'warn' ? 'vln' : 'raw'; if (b.dataset.act === 'missing') bomCode = m.codes.find(c => !c.rows && c.openPo).code; openBomModel(m.model).then(() => $('#bomDetail').scrollIntoView({ behavior: 'smooth', block: 'start' })); }
});
$('#bomMissing').addEventListener('click', e => {
  const b = e.target.closest('.miss-code'); if (!b) return;
  const m = bomCat.models.find(x => x.codes.some(c => c.code === b.dataset.code));
  if (m) { bomView = 'raw'; bomCode = b.dataset.code; openBomModel(m.model).catch(err => toast(err.message, 'error')); }
});
const ptCell = v => v == null ? '<span class="na">–</span>' : fmt(v);
function renderBomDetail() {
  const d = bomDetail, plan = can('bom'), edit = plan && !bomLocked(), withBom = d.codes.filter(c => c.rows);
  const seg = [['raw', 'BOM gốc', d.codes.length + ' code'], ['vln', 'BOM VLN', d.vln.length + ' mã'], ['hv', 'Rear + VLĐT', d.hv.length + ' mã']]
    .map(([k, l, n]) => `<button type="button" data-v="${k}" class="${bomView === k ? 'active' : ''}">${l}<small>${n}</small></button>`).join('');
  let body = '';
  if (bomView === 'raw') {
    const chips = d.codes.map(c => `<button type="button" class="code-chip ${c.code === bomCode ? 'active' : ''} ${c.rows ? '' : 'empty'}" data-code="${esc(c.code)}"><b>${esc(codeTail(c.code))}</b><span>${c.rows ? `${c.rows} dòng` : 'Chưa có BOM'}${c.openPo ? ` · ${c.openPo} PO` : ''}</span></button>`).join('');
    const rows = d.byCode[bomCode] || [], cur = d.codes.find(c => c.code === bomCode);
    const table = rows.length ? GROUP_ORDER.concat([null]).map(g => {
      const list = rows.filter(r => r.group === g); if (!list.length) return '';
      return `<tr class="group-head"><td colspan="5"><span class="pill group-${g || 'none'}">${g ? GROUP[g] : 'Chưa có nhóm'}</span> ${list.length} mã</td></tr>` + list.map(r => `<tr data-id="${r.id}">
        <td class="num muted">${esc(r.process || '')}</td><td><b>${esc(r.material)}</b><span class="sub-cell">${esc(r.description || '')}</span></td><td class="num big-num">${fmt(r.point)}</td>
        <td>${r.source === 'auto' ? '<i class="badge warn dotonly" title="App gợi ý nhóm"></i>' : ''}${plan ? `<select class="group-sel group-${r.group}" data-material="${esc(r.material)}">${r.group ? '' : '<option value="">?</option>'}${GROUP_ORDER.map(k => `<option value="${k}" ${k === r.group ? 'selected' : ''}>${GROUP[k]}</option>`).join('')}</select>` : `<span class="pill group-${r.group}">${GROUP[r.group] || '?'}</span>`}</td>
        <td>${edit ? '<button type="button" class="more row-menu" aria-label="Sửa / xóa">⋮</button>' : ''}</td></tr>`).join('');
    }).join('') : `<tr><td colspan="5" class="empty">${esc(bomCode)} chưa có BOM${edit && withBom.length ? ` · <button type="button" class="link" data-copy-into="${esc(bomCode)}">Chép từ code khác</button>` : ''}</td></tr>`;
    body = `<div class="code-chips">${chips}</div>
      <div class="bom-tools">${edit ? `<button type="button" class="secondary" id="bomAddRow" ${bomCode ? '' : 'disabled'}>+ Dòng</button><button type="button" class="secondary" id="bomCopyCode">Chép sang code mới</button>${cur?.rows ? '<button type="button" class="link danger-text" id="bomDelCode">Xóa BOM code</button>' : ''}` : ''}<input type="search" class="qs" data-qs="#bomRaw" placeholder="Tìm mã, mô tả"></div>
      <div class="table-scroll tall"><table id="bomRaw" class="grid bom-raw"><thead><tr><th class="num">#</th><th>Material · ${esc(bomCode)}</th><th class="num">Point</th><th>Nhóm</th><th></th></tr></thead><tbody>${table}</tbody></table></div>`;
  } else if (bomView === 'vln') {
    const head = d.codeList.map(c => `<th class="num code-col" title="${esc(c)}">${esc(codeTail(c))}</th>`).join('');
    body = `<div class="bom-note"><span class="pill group-VLN">VLN</span> Dùng chung cho mọi PO của <b>${esc(short(d.model))}</b> (${d.codeList.length} Model Code). Point VLN = Point phổ biến nhất trong BOM gốc; chạm Point để chỉnh tay.</div>
      <div class="bom-tools">${d.issues.filter(i => i.type !== 'nogroup').length ? `<span class="bad-text"><b>${d.issues.filter(i => i.type !== 'nogroup').length}</b> điểm lệch với BOM gốc</span>` : '<span class="ok-text">Khớp BOM gốc</span>'}<input type="search" class="qs" data-qs="#bomVln" placeholder="Tìm mã, mô tả"></div>
      <div class="table-scroll tall"><table id="bomVln" class="grid matrix"><thead><tr><th class="sticky">Material</th><th class="num">Point VLN</th>${head}</tr></thead><tbody>
      ${d.vln.map(v => `<tr class="${v.issues.length ? 'has-warn' : ''}" data-material="${esc(v.material)}"><td class="sticky"><b>${esc(v.material)}</b><span class="sub-cell">${esc(v.description || '')}</span>${v.issues.map(t => `<span class="warn-text">${esc(t)}</span>`).join('')}</td>
        <td class="num"><button type="button" class="pt-btn ${v.source === 'manual' ? 'manual' : ''}" ${plan ? '' : 'disabled'} title="${v.source === 'manual' ? `Chỉnh tay${v.updatedBy ? ` · ${esc(v.updatedBy)}` : ''}` : 'Theo BOM gốc'}">${fmt(v.point)}</button></td>
        ${v.perCode.map(p => `<td class="num ${p == null ? 'miss' : p !== v.point ? 'diff' : ''}">${ptCell(p)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${d.codeList.length + 2}" class="empty">Chưa có mã VLN — đặt nhóm VLN trong BOM gốc</td></tr>`}
      </tbody></table></div>`;
  } else {
    const head = d.codeList.map(c => `<th class="num code-col" title="${esc(c)}">${esc(codeTail(c))}</th>`).join('');
    body = `<div class="bom-note"><span class="pill group-REAR">Rear</span> <span class="pill group-VLDT">VLĐT</span> Theo từng Model Code — PO chỉ nhận đúng BOM của Model Code của nó.</div>
      <div class="bom-tools"><input type="search" class="qs" data-qs="#bomHv" placeholder="Tìm mã, mô tả"></div>
      <div class="table-scroll tall"><table id="bomHv" class="grid matrix"><thead><tr><th class="sticky">Material</th><th>Nhóm</th>${head}</tr></thead><tbody>
      ${d.hv.map(v => `<tr><td class="sticky"><b>${esc(v.material)}</b><span class="sub-cell">${esc(v.description || '')}</span></td><td><span class="pill group-${v.group}">${GROUP[v.group]}</span></td>${v.perCode.map(p => `<td class="num ${p == null ? 'miss' : 'has'}">${ptCell(p)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${d.codeList.length + 2}" class="empty">Chưa có mã Rear / VLĐT</td></tr>`}
      </tbody></table></div>`;
  }
  $('#bomDetail').innerHTML = `<div class="card-head"><h2>${esc(d.model)}</h2><span class="muted">${d.codeList.length} Model Code${d.openPo ? ` · ${d.openPo} PO mở` : ''}</span></div>
    <div class="seg bom-seg">${seg}</div>${body}`;
}
$('#bomDetail').addEventListener('click', async e => {
  const d = bomDetail;
  const sg = e.target.closest('.bom-seg [data-v]'); if (sg) { bomView = sg.dataset.v; return renderBomDetail(); }
  const chip = e.target.closest('.code-chip'); if (chip) { bomCode = chip.dataset.code; return renderBomDetail(); }
  if (e.target.closest('#bomAddRow')) return editBomRow(null);
  if (e.target.closest('#bomCopyCode') || e.target.closest('[data-copy-into]')) return newModelCode({ model: d.model, code: e.target.closest('[data-copy-into]')?.dataset.copyInto || '', from: (d.byCode[bomCode] || []).length ? bomCode : (d.codes.find(c => c.rows)?.code || '') });
  if (e.target.closest('#bomDelCode')) {
    const ok = await confirmDialog(`Xóa BOM ${bomCode}`, `<p>Xóa toàn bộ <b>${(d.byCode[bomCode] || []).length}</b> dòng BOM gốc của <b>${esc(bomCode)}</b>? PO đã bắt đầu kitting không bị ảnh hưởng.</p>`, 'Xóa');
    if (ok) await withBusy(null, async () => { const x = await api('/api/bom/code/delete', { json: { modelCode: bomCode } }); toast(x.message, 'success'); await loadBom(); });
    return;
  }
  const menu = e.target.closest('.row-menu'); if (menu) return rowMenu(Number(menu.closest('tr').dataset.id));
  const pt = e.target.closest('.pt-btn'); if (pt && !pt.disabled) return editVlnPoint(pt.closest('tr').dataset.material);
});
$('#bomDetail').addEventListener('change', async e => {
  const s = e.target.closest('.group-sel'); if (!s || !s.value) return;
  await withBusy(s, async () => { const r = await api('/api/bom/group', { json: { model: bomModel, material: s.dataset.material, group: s.value } }); toast(`${s.dataset.material} → ${GROUP[s.value]} (${r.changed} code)`, 'success'); await reloadBomKeep(); });
});
async function reloadBomKeep() { const st = [bomModel, bomView, bomCode]; await loadBom(); [bomModel, bomView, bomCode] = st; await openBomModel(bomModel); }
const groupOpts = sel => GROUP_ORDER.map(k => `<option value="${k}" ${k === sel ? 'selected' : ''}>${GROUP[k]}</option>`).join('');
async function editBomRow(id) {
  const r = id ? (bomDetail.byCode[bomCode] || []).find(x => x.id === id) : null, many = bomDetail.codeList.filter(c => bomDetail.byCode[c]?.length).length > 1;
  const v = await confirmDialog(r ? `Sửa ${r.material}` : `Thêm dòng · ${bomCode}`, `<div class="form-grid">
    <label>Material<input name="material" value="${esc(r?.material || '')}" ${r ? 'readonly' : 'required'} autocomplete="off"></label>
    <label>Point<input name="point" type="number" min="0.001" step="any" value="${r ? r.point : 1}" required></label>
    <label class="span2">Mô tả<input name="description" value="${esc(r?.description || '')}"></label>
    <label>Công đoạn<input name="process" value="${esc(r?.process || '')}"></label>
    <label>Nhóm<select name="group">${groupOpts(r?.group || 'VLN')}</select></label></div>
    ${many ? `<label class="check"><input type="checkbox" name="allCodes" ${r ? '' : 'checked'}> ${r ? 'Áp Point / mô tả cho' : 'Thêm vào'} mọi Model Code của ${esc(short(bomModel))}</label>` : ''}`, r ? 'Lưu' : 'Thêm');
  if (!v) return;
  await withBusy(null, async () => { const x = await api('/api/bom/row', { json: { id: r?.id, modelCode: bomCode, material: v.material, description: v.description, point: Number(v.point), process: v.process, group: v.group, allCodes: !!v.allCodes } }); toast(x.message, 'success'); await reloadBomKeep(); });
}
async function rowMenu(id) {
  const r = (bomDetail.byCode[bomCode] || []).find(x => x.id === id); if (!r) return;
  const many = bomDetail.codeList.filter(c => bomDetail.byCode[c]?.length).length > 1;
  const v = await confirmDialog(r.material, `<p class="muted">${esc(r.description || '')}</p><div class="btn-col"><button type="button" class="secondary" data-act="edit">Sửa</button><button type="button" class="secondary danger-text" data-act="del">Xóa khỏi ${esc(bomCode)}</button>${many ? `<button type="button" class="secondary danger-text" data-act="delall">Xóa khỏi mọi Model Code</button>` : ''}</div>`, null);
  if (!v) return;
  if (v.act === 'edit') return editBomRow(id);
  const ok = await confirmDialog('Xóa dòng BOM', `<p>Xóa <b>${esc(r.material)}</b> khỏi ${v.act === 'delall' ? `mọi Model Code của ${esc(short(bomModel))}` : esc(bomCode)}?</p>`, 'Xóa');
  if (ok) await withBusy(null, async () => { const x = await api('/api/bom/row/delete', { json: { id, allCodes: v.act === 'delall' } }); toast(x.message, 'success'); await reloadBomKeep(); });
}
async function editVlnPoint(material) {
  const it = bomDetail.vln.find(x => x.material === material); if (!it) return;
  const v = await confirmDialog(`Point VLN · ${material}`, `<p class="muted">${esc(it.description || '')}</p>
    <div class="vln-pts">${bomDetail.codeList.map((c, i) => `<span><small>${esc(codeTail(c))}</small><b>${ptCell(it.perCode[i])}</b></span>`).join('')}</div>
    <label>Point VLN (${esc(short(bomModel))})<input name="point" type="number" min="0.001" step="any" value="${it.point}" required></label>
    ${it.source === 'manual' ? '<button type="button" class="link" data-act="reset">Lấy lại theo BOM gốc</button>' : ''}`, 'Lưu');
  if (!v) return;
  await withBusy(null, async () => { const x = await api('/api/bom/vln', { json: { model: bomModel, material, point: Number(v.point), reset: v.act === 'reset' } }); toast(x.message, 'success'); await reloadBomKeep(); });
}
async function newModelCode({ model = '', code = '', from = '' } = {}) {
  const models = bomCat.models.map(m => m.model), all = bomCat.models.flatMap(m => m.codes.filter(c => c.rows).map(c => ({ code: c.code, model: m.model })));
  const v = await confirmDialog('Model Code', `<div class="form-grid">
    <label>Model Code<input name="modelCode" value="${esc(code)}" placeholder="GH96-xxxxxA" required autocomplete="off"></label>
    <label>Model<input name="model" list="bomModelList" value="${esc(model)}" required autocomplete="off"><datalist id="bomModelList">${models.map(m => `<option value="${esc(m)}">`).join('')}</datalist></label>
    <label class="span2">Chép BOM từ<select name="copyFrom" data-ta><option value="">— Không chép (BOM trống) —</option>${all.map(c => `<option value="${esc(c.code)}" ${c.code === from ? 'selected' : ''}>${esc(c.code)} · ${esc(short(c.model))}</option>`).join('')}</select></label></div>`, 'Lưu');
  if (!v) return;
  await withBusy(null, async () => { const x = await api('/api/bom/code', { json: v }); toast(x.message, 'success'); bomModel = v.model; bomCode = v.modelCode; bomView = 'raw'; await loadBom(); });
}
$('#bomNewCode').addEventListener('click', () => newModelCode({ model: bomModel }));
// File mẫu BOM: chỉ sheet BOM + vài dòng mẫu. Không có chức năng tải toàn bộ BOM để tránh sửa hàng loạt rồi nhập đè.
async function bomTemplateBlob() {
  await needExcel();
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('BOM');
  ws.columns = [['Model', 18], ['Model code', 15], ['Material', 16], ['Description', 40], ['Point', 8], ['Công đoạn', 10], ['Nhóm kitting', 13]].map(([header, width]) => ({ header, width }));
  [['Model mẫu', 'MAU-0001A', 'GH82-00000A', 'Rear mẫu', 1, 10, 'Rear'], ['Model mẫu', 'MAU-0001A', 'GH98-00000A', 'Vật liệu điện tử mẫu', 1, 20, 'VLĐT'], ['Model mẫu', 'MAU-0001A', 'GH02-00000A', 'Vật liệu nhỏ mẫu', 2, 30, 'VLN']].forEach(r => ws.addRow(r));
  ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }];
  return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
$('#bomTemplate').addEventListener('click', e => withBusy(e.currentTarget, async () => { if (await saveBlob('BOM_mau.xlsx', await bomTemplateBlob())) toast('Đã tải file mẫu. Xóa các dòng mẫu trước khi nhập.', 'success'); }));
function bomPreviewHtml(file, r) {
  const li = (a, f) => a.slice(0, 30).map(f).join('') + (a.length > 30 ? `<li class="muted">… và ${a.length - 30} code nữa</li>` : '');
  const diff = c => [c.added && `thêm ${c.added} mã`, c.removed && `bỏ ${c.removed} mã`, c.diffPoint && `đổi Point ${c.diffPoint}`, c.diffGroup && `đổi nhóm ${c.diffGroup}`, c.diffText && `đổi mô tả / công đoạn ${c.diffText}`].filter(Boolean).join(', ');
  return `<p><b>${esc(file)}</b>: chỉ các Model Code bên dưới bị tác động, BOM còn lại giữ nguyên.</p>
    ${r.newCodes.length ? `<p class="ok-text"><b>Thêm mới ${r.newCodes.length} Model Code</b></p><ul class="bom-prev">${li(r.newCodes, c => `<li><b>${esc(c.code)}</b> · ${esc(c.model)} · ${c.rows} dòng</li>`)}</ul>` : ''}
    ${r.changed.length ? `<p class="warn-text"><b>Thay BOM ${r.changed.length} Model Code đã có</b>: thay toàn bộ theo file, mã không có trong file sẽ bị bỏ khỏi code đó.</p><ul class="bom-prev">${li(r.changed, c => `<li><b>${esc(c.code)}</b> · ${esc(c.model)} · ${c.oldRows} → ${c.newRows} dòng · ${esc(diff(c))}</li>`)}</ul>` : ''}
    ${r.unchanged ? `<p class="muted">${r.unchanged} Model Code không có gì thay đổi, bỏ qua.</p>` : ''}
    ${r.newModels.length ? `<p class="alert-box">Tên Model mới, kiểm tra có gõ đúng không: ${r.newModels.map(esc).join(', ')}</p>` : ''}
    ${r.renameIgnored.length ? `<p class="alert-box">Giữ nguyên tên Model cho ${r.renameIgnored.length} code đã có, tên trong file bị bỏ qua: ${r.renameIgnored.slice(0, 8).map(x => `${esc(x.code)} (${esc(x.inFile)} → giữ ${esc(x.kept)})`).join(', ')}${r.renameIgnored.length > 8 ? '…' : ''}</p>` : ''}
    ${r.dup ? `<p class="muted">Bỏ qua ${r.dup} dòng lặp y hệt.</p>` : ''}`;
}
$('#bomFile').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  await withBusy(null, async () => {
    await needExcel();
    const p = await MMReaders.readBomWorkbook(await file.arrayBuffer(), file.name);
    const body = { source: file.name, rows: p.rows, modelMap: [...p.modelMap], vln: p.vln || [], dup: p.dup || 0 };
    const pv = await api('/api/bom/import', { json: { ...body, dry: true } });
    if (!pv.newCodes.length && !pv.changed.length) { await confirmDialog('Nhập BOM', `${bomPreviewHtml(file.name, pv)}<p>Không có gì để cập nhật.</p>`, null, 'wide'); return; }
    if (!await confirmDialog('Xem trước khi nhập BOM', bomPreviewHtml(file.name, pv), 'Cập nhật BOM', 'wide')) return;
    const r = await api('/api/bom/import', { json: body });
    toast(`Thêm ${r.newCodes.length} · thay ${r.changed.length} Model Code${r.suggested ? ` · ${fmt(r.suggested)} dòng app tự xếp nhóm` : ''}`, 'success');
    await loadBom();
    if (r.noRear.length || r.single.length) await confirmDialog('Kiểm tra sau khi nhập BOM', `${r.noRear.length ? `<p class="bad-text"><b>${r.noRear.length}</b> Model Code chưa có Rear:</p><p>${r.noRear.map(esc).join(', ')}</p>` : ''}${r.single.length ? `<p><b>${r.single.length}</b> Model chỉ có 1 Model Code (đã tạm xếp VLN, cần kiểm tra VLĐT):</p><p>${r.single.map(esc).join(', ')}</p>` : ''}`, null);
  });
});


/* =================== QUẢN TRỊ =================== */
const ROLE = { admin: 'Quản trị', planner: 'Planner', kho: 'Kho', opkho: 'OP kitting kho', line: 'Line', approver: 'Cấp duyệt' };
let userData = null;
async function loadAdmin() {
  const [st, u, plog] = await Promise.all([me.role === 'admin' ? api('/api/admin/settings') : null, isMgr() ? api('/api/admin/users') : null, sp('prodUpdate') ? api('/api/po/production/log') : null]);
  if (plog) renderProdLog(plog.rows);
  if (st) {
    settings = st.settings;
    const f = $('#settingsForm'); for (const k of ['supply_threshold', 'vln_min_per_line', 'vln_max_per_line', 'merge_max_qty', 'auto_max_kits_day', 'shift_starts']) f[k].value = st.settings[k] ?? '';
    $('#lineList').innerHTML = st.lines.map(l => `<span class="chip ${l.active ? '' : 'off'}">${esc(l.name)}<button type="button" data-line="${esc(l.name)}" data-active="${l.active ? 0 : 1}">${l.active ? 'Tắt' : 'Bật'}</button></span>`).join('');
    $('#auditTable').innerHTML = '<thead><tr><th>Thời gian</th><th>Tài khoản</th><th>Thao tác</th><th>Chi tiết</th></tr></thead><tbody>' + (st.audit.length ? st.audit.map(x => `<tr><td>${esc(localTime(x.created_at))}</td><td>${esc(x.username)}</td><td>${esc(x.action)}</td><td class="hint">${esc(String(x.detail).slice(0, 160))}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">Chưa có.</td></tr>') + '</tbody>';
  }
  if (u) { userData = u; renderUsers(); }
  if (me.role === 'admin') loadErpCfg().catch(err => toast(err.message, 'error'));
}
// Tài khoản: Quản trị thấy tất cả; Trưởng bộ phận chỉ thấy tài khoản trong bộ phận mình.
function renderUsers() {
  const u = userData, adm = me.role === 'admin';
  $('#userScope').textContent = adm ? '' : `Bộ phận ${me.dept || '–'}`;
  $('#userLine').innerHTML = '<option value="">Line phụ trách (nếu là Leader)</option>' + u.lines.map(l => `<option>${esc(l)}</option>`).join('');
  $('#deptList').innerHTML = u.depts.map(d => `<option value="${esc(d)}">`).join('');
  const dept = $('#userDept'); dept.readOnly = !adm; if (!adm) dept.value = me.dept || '';
  $('#userForm').role.querySelector('option[value="admin"]').hidden = !adm;
  const roleSel = x => `<select data-role="${x.id}" ${x.id === me.id ? 'disabled' : ''}>${Object.entries(ROLE).filter(([k]) => adm || k !== 'admin').map(([k, v]) => `<option value="${k}" ${k === x.role ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
  $('#userTable').innerHTML = '<thead><tr><th>Mã NV</th><th>Bộ phận</th><th>Vai trò</th><th>Quyền</th><th>Line phụ trách</th><th>Trạng thái</th><th></th></tr></thead><tbody>' + u.users.map(x => `<tr>
    <td><b>${esc(x.username)}</b><span class="sub-cell">${esc(x.name)}</span></td>
    <td>${esc(x.dept || '–')}${x.isHead ? ' <span class="pill info">Trưởng BP</span>' : ''}</td>
    <td>${roleSel(x)}</td>
    <td><button type="button" class="link" data-perms="${x.id}" ${x.role === 'admin' || x.id === me.id ? 'disabled' : ''}>${x.role === 'admin' ? 'Toàn quyền' : x.customPerms ? 'Riêng' : 'Theo vai trò'}</button></td>
    <td><select data-ta data-uline="${x.id}"><option value="">–</option>${u.lines.map(l => `<option ${l === x.line ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></td>
    <td>${x.active ? '<span class="pill ok">Đang dùng</span>' : '<span class="pill muted">Đã khóa</span>'}</td>
    <td><div class="btn-row">${x.id === me.id ? '' : `<button type="button" class="link" data-toggle="${x.id}" data-active="${x.active ? 0 : 1}">${x.active ? 'Khóa' : 'Mở khóa'}</button><button type="button" class="link" data-pw="${x.id}" data-name="${esc(x.username)}">Đặt mật khẩu</button>${adm && x.hasPin2 ? `<button type="button" class="link" data-pin2="${x.id}" data-name="${esc(x.username)}">Xóa MK cấp 2</button>` : ''}<button type="button" class="link bad-text" data-del="${x.id}" data-name="${esc(x.username)}">Xóa</button>`}</div></td></tr>`).join('') + '</tbody>';
}
// Hộp thoại phân quyền: mỗi màn hình Ẩn / Xem / Thao tác + quyền đặc biệt; Trưởng bộ phận không cấp quá quyền của mình.
async function editPerms(x) {
  const cat = userData.perm, adm = me.role === 'admin', cur = x.perms, max = s => adm ? 2 : lvl(s);
  const grid = cat.screens.map(([k, label]) => `<tr><th>${esc(label)}</th>${[0, 1, 2].map(v => `<td><input type="radio" name="s_${k}" value="${v}" ${cur.screens[k] === v ? 'checked' : ''} ${v > max(k) ? 'disabled' : ''} aria-label="${esc(label)} ${['Ẩn', 'Xem', 'Thao tác'][v]}"></td>`).join('')}</tr>`).join('');
  const spc = cat.specials.map(([k, label]) => `<label class="chk"><input type="checkbox" name="x_${k}" ${cur.specials[k] ? 'checked' : ''} ${!adm && !sp(k) ? 'disabled' : ''}> ${esc(label)}</label>`).join('');
  const body = `<p><b>${esc(x.username)}</b> · ${esc(x.name)} · ${esc(ROLE[x.role])}</p>
    ${adm ? `<div class="perm-head"><label>Bộ phận<input name="dept" value="${esc(x.dept)}" list="deptList" maxlength="40"></label><label class="chk"><input type="checkbox" name="isHead" ${x.isHead ? 'checked' : ''}> Trưởng bộ phận</label></div>` : ''}
    <label class="chk"><input type="checkbox" name="useRole" ${x.customPerms ? '' : 'checked'}> Theo vai trò ${esc(ROLE[x.role])}</label>
    <div class="table-scroll"><table class="grid perm-grid"><thead><tr><th>Màn hình</th><th>Ẩn</th><th>Xem</th><th>Thao tác</th></tr></thead><tbody>${grid}</tbody></table></div>
    <div class="perm-sp">${spc}</div>`;
  // Tick "Theo vai trò" → điền lại mặc định của vai trò; sửa ô bất kỳ → bỏ tick.
  $('#dialogBody').onchange = e => {
    const f = $('#dialogForm'), def = cat.roleDefaults[x.role];
    if (e.target.name === 'useRole' && e.target.checked && def) {
      for (const [k] of cat.screens) { const r = f.querySelector(`input[name="s_${k}"][value="${def.screens[k]}"]`); if (r) r.checked = true; }
      for (const [k] of cat.specials) f[`x_${k}`].checked = !!def.specials[k];
    } else if (/^[sx]_/.test(e.target.name)) f.useRole.checked = false;
  };
  const r = await confirmDialog('Phân quyền', body, 'Lưu', 'wide');
  $('#dialogBody').onchange = null;
  if (!r) return;
  const perms = r.useRole ? null : { screens: Object.fromEntries(cat.screens.map(([k]) => [k, Number(r[`s_${k}`] || 0)])), specials: Object.fromEntries(cat.specials.map(([k]) => [k, !!r[`x_${k}`]])) };
  await api('/api/admin/users/update', { json: { id: x.id, perms, ...(adm ? { dept: r.dept || '', isHead: !!r.isHead } : {}) } });
  toast('Đã lưu phân quyền.', 'success'); await loadAdmin();
}
/* ---------- Cổng cập nhật sản xuất: file Excel (đây) hoặc công cụ QR (/api/mmx/production) ---------- */
function renderProdLog(rows) {
  $('#prodLog').innerHTML = '<thead><tr><th>Lúc</th><th>Nguồn</th><th class="num">Cập nhật</th><th class="num">Không đổi</th><th>PO lạ</th></tr></thead><tbody>' + (rows.length ? rows.map(r => `<tr><td>${esc(localTime(r.created_at))}<span class="sub-cell">${esc(r.created_by)}</span></td><td>${esc(r.source)}</td><td class="num"><b>${fmt(r.summary.updated)}</b>${r.summary.cancelled?.length ? ` <span class="pill bad">${r.summary.cancelled.length} Cancel</span>` : ''}</td><td class="num">${fmt(r.summary.unchanged)}</td><td>${r.summary.unknown?.length ? `<span class="bad-text" title="${esc(r.summary.unknown.join(', '))}">${r.summary.unknown.length}</span>` : '<span class="muted">–</span>'}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">Chưa có lần cập nhật nào</td></tr>') + '</tbody>';
}
$('#prodFile').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  await withBusy(null, async () => {
    toast(`Đang đọc ${file.name}…`);
    const json = /\.json$/i.test(file.name);   // file JSON xuất từ trình nhận QR (qr/)
    const p = json ? (await needExcel(), MMReaders.readProdJson(await file.text(), file.name)) : await readExcelFile(file, 'prod');
    const r = await api('/api/po/production', { json: { source: json ? `QR${p.epoch !== null ? ` #${p.epoch}` : ''}${p.partial ? ' delta' : ''} · ${file.name}` : file.name, rows: p.rows } });
    toast(`${fmt(r.updated)} PO cập nhật · ${fmt(r.unchanged)} không đổi${r.cancelled.length ? ` · ${r.cancelled.length} Cancel` : ''}${p.skipped ? ` · bỏ qua ${p.skipped} dòng trống` : ''}`, 'success');
    if (r.unknown.length || r.decreased.length) await confirmDialog('Kiểm tra cập nhật sản xuất', `${r.unknown.length ? `<p class="bad-text"><b>${r.unknown.length}</b> PO chưa có trong app (Planner chưa nhập):</p><p>${r.unknown.map(esc).join(', ')}</p>` : ''}${r.decreased.length ? `<p><b>${r.decreased.length}</b> PO có Production giảm so với trước:</p><p>${r.decreased.map(esc).join(', ')}</p>` : ''}`, null);
    await loadAdmin();
  });
});
// File mẫu = các PO đang mở với Production hiện tại; Remain để trống thì app tự tính = Plan − Production.
$('#prodTemplate').addEventListener('click', e => withBusy(e.currentTarget, async () => {
  await needExcel();
  const d = await api('/api/po'), wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('San xuat');
  ws.columns = [['PO', 'po', 16], ['Model Code', 'modelCode', 16], ['Plan Date', 'planDate', 12], ["Plan Q'ty", 'planQty', 10], ["Production Q'ty", 'productionQty', 15], ["Remain Q'ty", 'remain', 12], ['Status', 'status', 12]].map(([header, key, width]) => ({ header, key, width }));
  d.rows.filter(r => r.inSource && r.state !== 'cancel' && r.state !== 'done').forEach(r => ws.addRow({ ...r, remain: null, status: '' }));
  ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.getColumn('po').numFmt = '@';
  if (await saveBlob(`CapNhat_SanXuat_${today}.xlsx`, new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))) toast('Đã tải file mẫu', 'success');
}));
async function loadErpCfg() {
  const c = await api('/api/admin/erp'), f = $('#erpForm');
  f.url.value = c.url || ''; f.key.value = ''; f.secret.value = ''; f.lineSync.checked = !!c.lineSync; f.stockSync.checked = !!c.stockSync; f.bomSync.checked = !!c.bomSync;
  f.modelMap.value = Object.entries(c.modelMap || {}).map(([k, v]) => `${k} = ${v}`).join('\n');
  const L = c.last;
  $('#erpInfo').innerHTML = `${c.hasKey && c.hasSecret ? 'Đã lưu khóa API' : '<span class="warn-text">Chưa có khóa API</span>'}${L ? ` · Line ${esc(localTime(L.at))}: ${L.ok ? `${fmt(L.cells)} ô` : `<span class="bad-text">${esc(L.error)}</span>`}` : ''}${c.stockOkAt ? ` · Tồn ${esc(localTime(c.stockOkAt))}` : ''}${c.bomOkAt ? ` · BOM ${esc(localTime(c.bomOkAt))}` : ''}`;
}
$('#erpForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.currentTarget;
  const modelMap = Object.fromEntries(f.modelMap.value.split('\n').map(l => l.split('=').map(x => x.trim())).filter(x => x.length === 2 && x[0] && x[1]));
  await withBusy(e.submitter, async () => { const r = await api('/api/admin/erp', { json: { url: f.url.value, key: f.key.value, secret: f.secret.value, lineSync: f.lineSync.checked, stockSync: f.stockSync.checked, bomSync: f.bomSync.checked, modelMap } }); toast(r.message, 'success'); await loadErpCfg(); });
});
$('#erpTest').addEventListener('click', e => withBusy(e.currentTarget, async () => {
  try { const r = await api('/api/lines/erp/sync', { json: {} }); r.ok ? toast(`Đồng bộ ERP: ${fmt(r.cells)} ô (+${r.added} ~${r.changed} −${r.removed})`, 'success') : toast(r.error, 'error'); } finally { await loadErpCfg(); }
}));
$('#settingsForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget));
  await withBusy(e.submitter, async () => { await api('/api/admin/settings', { json: f }); toast('Đã lưu thông số.', 'success'); await loadAdmin(); });
});
$('#lineForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget));
  await withBusy(e.submitter, async () => { await api('/api/admin/lines', { json: f }); e.target.reset(); toast('Đã thêm Line.', 'success'); await loadAdmin(); });
});
$('#lineList').addEventListener('click', async e => { const b = e.target.closest('[data-line]'); if (!b) return; await withBusy(b, async () => { await api('/api/admin/lines', { json: { name: b.dataset.line, active: b.dataset.active === '1' } }); await loadAdmin(); }); });
$('#userForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget));
  await withBusy(e.submitter, async () => { await api('/api/admin/users', { json: { ...f, isHead: !!f.isHead } }); e.target.reset(); toast('Đã tạo tài khoản.', 'success'); await loadAdmin(); });
});
$('#userTable').addEventListener('change', async e => {
  const l = e.target.closest('[data-uline]');
  if (l) return withBusy(l, async () => { await api('/api/admin/users/update', { json: { id: l.dataset.uline, line: l.value } }); toast('Đã đổi Line phụ trách.', 'success'); });
  const s = e.target.closest('[data-role]'); if (!s) return;
  await withBusy(s, async () => { await api('/api/admin/users/update', { json: { id: s.dataset.role, role: s.value } }); toast('Đã đổi vai trò.', 'success'); }).finally(loadAdmin);
});
$('#userTable').addEventListener('click', async e => {
  const t = e.target.closest('[data-toggle]'), p = e.target.closest('[data-pw]'), d = e.target.closest('[data-del]'), q = e.target.closest('[data-perms]'), z = e.target.closest('[data-pin2]');
  if (q) return withBusy(q, () => editPerms(userData.users.find(x => x.id === q.dataset.perms)));
  if (t) return withBusy(t, async () => { await api('/api/admin/users/update', { json: { id: t.dataset.toggle, active: t.dataset.active === '1' } }); await loadAdmin(); });
  if (d) {
    if (!(await confirmDialog('Xóa tài khoản', `<p>Xóa hẳn tài khoản <b>${esc(d.dataset.name)}</b>? Lịch sử thao tác vẫn giữ tên Mã NV.</p>`, 'Xóa'))) return;
    return withBusy(d, async () => { const r = await api('/api/admin/users/delete', { json: { id: d.dataset.del } }); toast(r.message, 'success'); await loadAdmin(); });
  }
  if (z) {
    if (!(await confirmDialog('Xóa mật khẩu cấp 2', `<p>Xóa mật khẩu cấp 2 của <b>${esc(z.dataset.name)}</b>? Người này phải đặt lại trước khi quản lý tài khoản.</p>`, 'Xóa'))) return;
    return withBusy(z, async () => { await api('/api/admin/users/update', { json: { id: z.dataset.pin2, resetPin2: true } }); toast('Đã xóa mật khẩu cấp 2.', 'success'); await loadAdmin(); });
  }
  if (p) {
    const r = await confirmDialog('Đặt mật khẩu mới', `<p>Mã NV <b>${esc(p.dataset.name)}</b></p><label>Mật khẩu tạm (≥ 8 ký tự, có chữ và số)<input name="password" type="text" minlength="8" maxlength="64" required autocomplete="off"></label><p class="hint">Người dùng phải đổi sang mật khẩu riêng ở lần đăng nhập tới.</p>`, 'Lưu');
    if (r) await withBusy(p, async () => { await api('/api/admin/users/update', { json: { id: p.dataset.pw, password: r.password } }); toast('Đã đặt mật khẩu tạm.', 'success'); });
  }
});
// Chỉ bản chạy thử: nạp lại dữ liệu mẫu / xóa trắng để nạp file thật.
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-demo]'); if (!b) return;
  const reset = b.dataset.demo === 'reset';
  const ok = await confirmDialog(reset ? 'Nạp lại dữ liệu mẫu' : 'Xóa trắng dữ liệu', `<p>${reset ? 'Xóa toàn bộ và nạp lại bộ tình huống mẫu.' : 'Xóa PO, BOM, kế hoạch, kitting, yêu cầu cấp. Giữ tài khoản, Line và thông số — sau đó nhập file Plan Master + BOM thật.'}</p>`, reset ? 'Nạp lại' : 'Xóa trắng');
  if (!ok) return;
  await withBusy(b, async () => { const r = await api(`/api/demo/${b.dataset.demo}`, { json: {} }); toast(r.message, 'success'); setTimeout(() => location.reload(), 900); });
});

/* ---------- khởi động ---------- */
(async () => { if (!auth.get()) return showLogin(); try { await start(); } catch { showLogin(); } })();

/* ---------- Nhập kế hoạch kitting từ Excel của Planner: sheet gộp theo Line + Model / sheet Kitting theo PO (BOM Number) ---------- */
const PI_ACT = { merge: ['Gộp', 'info'], single: ['PO đơn', 'muted'], keep: ['Giữ nguyên', 'ok'], none: ['Không có PO nhập được', 'muted'], error: ['Lỗi · bỏ nhóm', 'bad'], off: ['Bỏ chọn', 'muted'] };
const PI_ST = { locked: 'warn', missing: 'bad', cancel: 'bad', dup: 'muted' };
function piForm(b, pv, msg) {
  const head = `<div class="auto-opts"><label>Ngày kitting<input type="date" name="day" value="${esc(b.day)}" required></label><button type="button" class="secondary" data-act="preview">↻ Xem trước</button></div>
    <p class="hint small-note">Gộp đúng như file (không áp giới hạn gộp). PO nội bộ trong file bỏ qua. Line trong file = Line dự kiến, Kho giao Line khác chỉ cảnh báo. PO Kho đã kitting giữ nguyên. Nhập xong hoàn tác được.</p>`;
  if (!pv) return head + (msg ? `<p class="alert-box">${esc(msg)}</p>` : '');
  const sheets = `<div class="pi-sheets">${pv.sheets.map(s => s.kind ? `<label class="check"><input type="checkbox" name="sh:${esc(s.name)}" ${s.on ? 'checked' : ''} data-act="preview"> <b>${esc(s.name)}</b> <span class="muted">· ${esc(s.label)} · ${s.groups} nhóm${s.skipped.length ? ` · bỏ ${s.skipped.length} PO nội bộ` : ''}${s.autoOff ? ' · <i>không có PO nào trong MM, tự bỏ chọn</i>' : ''}</span></label>` : `<span class="muted">${esc(s.name)}: không phải sheet kế hoạch, bỏ qua</span>`).join('')}</div>`;
  const S = pv.sum;
  const sum = `<div class="au-sum"><b>${S.kits}</b> Kit vào ngày <b>${esc(pv.day ? dmy(pv.day) : '–')}</b>: ${S.merge} gộp · ${S.single} PO đơn · ${S.keep} giữ nguyên${S.locked ? ` · <span class="warn-text">${S.locked} PO Kho đã kitting, giữ nguyên</span>` : ''}${S.missing ? ` · <span class="bad-text">${S.missing} PO không có trong MM</span>` : ''}${S.errors ? ` · <span class="bad-text">${S.errors} nhóm lỗi</span>` : ''}</div>`;
  const shown = pv.groups.map((g, i) => ({ g, i })).filter(({ g }) => pv.sheets.find(s => s.name === g.sheet)?.on);
  const rows = shown.map(({ g, i }) => `<tr class="pi-${g.action}"><td><input type="checkbox" name="g:${i}" ${g.on ? 'checked' : ''} data-act="preview" aria-label="Chọn nhóm ${esc(g.key)}"></td>
    <td><b>${esc(g.kind === 'bom' ? `Kit ${g.key}` : g.key)}</b><small class="sub-cell muted">${esc(g.sheet)}</small></td><td>${g.line ? `<b>${esc(g.line)}</b>` : '<span class="muted">–</span>'}</td><td>${esc(short(g.model || ''))}</td>
    <td class="pi-pos">${g.items.map(x => `<span class="pill ${PI_ST[x.status] || (x.note ? 'info' : '')}" title="${esc([x.code, x.note].filter(Boolean).join(' · '))}">${esc(x.raw)}${x.status !== 'ok' ? ` · ${esc(x.note)}` : x.note ? ' ⚠' : ''}</span>`).join(' ')}</td>
    <td class="num">${fmt(g.total)}</td><td><span class="pill ${PI_ACT[g.action][1]}">${PI_ACT[g.action][0]}</span>${g.warn.map(w => `<small class="sub-cell warn-text">${esc(w)}</small>`).join('')}</td></tr>`).join('');
  return head + (msg ? `<p class="alert-box">${esc(msg)}</p>` : '') + sheets + sum + (rows ? `<div class="table-wrap au-wrap"><table class="au-table pi-table"><thead><tr><th></th><th>Nhóm</th><th>Line dự kiến</th><th>Model</th><th>PO</th><th class="num">SL</th><th>Xử lý</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Không có nhóm nào</p>');
}
async function planImportDialog(file) {
  await needExcel();
  const buf = await file.arrayBuffer();
  if (MMReaders.isXls(buf) && !window.XLSX) await loadScript('vendor/xlsx.full.min.js?v=0.20.3');
  const data = await MMReaders.readPlanFile(buf, file.name);
  const body = { fileName: file.name, sheets: data.sheets, day: '', skipSheets: null, exclude: [] };
  let pv = null, msg = '';
  const run = async () => { try { pv = await api('/api/board/import', { json: { ...body, dry: true } }); if (!body.day) body.day = pv.suggestedDay || today; if (!body.skipSheets) body.skipSheets = pv.skipSheets; msg = ''; } catch (e) { pv = null; msg = e.message; } };
  await run();
  if (pv && !pv.sheets.some(s => s.kind)) return toast('File không có sheet kế hoạch nào (cần cột LINE · MODEL · MODEL CODE · PO hoặc BOM Number · PO).', 'error');
  if (pv && pv.day !== body.day) await run();
  for (;;) {
    const r = await confirmDialog(`📥 Nhập kế hoạch · ${file.name}`, piForm(body, pv, msg), pv?.sum.kits ? `Nhập ${pv.sum.kits} Kit` : 'Nhập', 'wide');
    if (!r) return;
    const skip = pv ? pv.sheets.filter(s => s.kind && !r[`sh:${s.name}`]).map(s => s.name) : body.skipSheets;
    const vis = pv ? pv.groups.map((g, i) => ({ g, i })).filter(({ g }) => pv.sheets.find(s => s.name === g.sheet)?.on) : [];
    const ex = pv ? [...new Set([...body.exclude.filter(id => !vis.some(({ g }) => g.id === id)), ...vis.filter(({ i }) => !r[`g:${i}`]).map(({ g }) => g.id)])] : body.exclude;
    const changed = r.day !== body.day || skip.join('\u0001') !== body.skipSheets.join('\u0001') || ex.join('\u0001') !== body.exclude.join('\u0001');
    Object.assign(body, { day: r.day, skipSheets: skip, exclude: ex });
    if (r.act || changed || !pv?.sum.kits) { await run(); continue; }
    try { const x = await api('/api/board/import', { json: body }); toast(x.message, 'success', undoAction()); await loadBoard(); return; }
    catch (e) { msg = e.message; await run(); if (!msg) msg = e.message; }
  }
}
$('#boardImport').addEventListener('click', () => $('#boardImportFile').click());
$('#boardImportFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) withBusy($('#boardImport'), () => planImportDialog(f)).catch(err => toast(err.message, 'error')); });
