// BẢN CHẠY THỬ trên Claude: giả lập máy chủ PocketBase ngay trong trình duyệt, dùng ĐÚNG giao diện + nghiệp vụ của gói mm-app.
// - /api/collections/users/auth-with-password: đăng nhập Mã NV + mật khẩu (tài khoản thử).
// - /api/mm/*: cùng bảng route với pb_hooks (core / kế hoạch / kitting / BOM).
// Dữ liệu là SQLite (sql.js) lưu trong IndexedDB của trình duyệt.
import { getSettings, audit, fail, tx } from '../../kitting-app/lib/db.mjs';
import { openDatabase } from '../../kitting-app/lib/db-node.mjs';
import * as planning from '../../kitting-app/lib/planning.mjs';
import { resetDemo } from '../../kitting-app/lib/demo.mjs';
import { ensureKittingSchema } from '../../kitting-app/lib/kitting.mjs';
import { ensurePlanExtraSchema } from '../../kitting-app/lib/plan-extra.mjs';
import { ensurePoSchema } from '../../kitting-app/lib/po-sync.mjs';
import { coreRoutes } from '../../kitting-app/lib/core-routes.mjs';
import { planRoutes } from '../../kitting-app/lib/plan-routes.mjs';
import { kittingRoutes } from '../../kitting-app/lib/kitting-routes.mjs';
import { bomRoutes } from '../../kitting-app/lib/bom-routes.mjs';
import { erpLineRoutes } from '../../kitting-app/lib/erp-line.mjs';
import { erpStockRoutes } from '../../kitting-app/lib/erp-stock.mjs';
import { bomChangeRoutes } from '../../kitting-app/lib/bom-change.mjs';
import { checkPassword } from '../../kitting-app/lib/password.mjs';
import { effectivePerms, normalizePerms, checkAccess, checkUserChange, canSeeUser, checkPin2, pin2Locked, pin2Result, requirePin2, permCatalog, ensurePermSchema, needsPin2, signCheck, ROLE_DEFAULTS } from '../../kitting-app/lib/perms.mjs';
import { receiptRoutes, ensureReceiptSchema } from '../../kitting-app/lib/receipt.mjs';

globalThis.MM_DEMO = true;
const ROLE_LABEL = { admin: 'Quản trị', planner: 'Planner', kho: 'Kho', opkho: 'OP kitting kho', line: 'Line', approver: 'Cấp duyệt' };
const DEMO_ACCOUNTS = [['AD01', 'Quản trị', 'admin'], ['PL01', 'Planner', 'planner'], ['KH01', 'Kho vật liệu', 'kho'], ['OP01', 'NV kitting kho', 'opkho'], ['LN01', 'Leader Line 1', 'line', 'Line 1'], ['LN04', 'Leader Line 4', 'line', 'Line 4'], ['DY01', 'Trưởng bộ phận (duyệt)', 'approver']];
const DEMO_PIN = 'Kitting2026', DEMO_PIN2 = '246810';
const STORE_DB = 'kitting-mm-demo', STORE_KEY = 'db-v4', TOKEN_PREFIX = 'demo.';
const DEMO_FILES = globalThis.__DEMO_FILES__ || {}; delete globalThis.__DEMO_FILES__;
const trim = v => String(v ?? '').trim();
const b64 = s => { const bin = atob(s), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
const readDemo = async name => { if (!DEMO_FILES[name]) throw new Error(`Thiếu file demo ${name}`); return b64(DEMO_FILES[name]).buffer; };

function idb() {
  return new Promise((resolve, reject) => {
    try { const r = indexedDB.open(STORE_DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }
    catch (e) { reject(e); }
  });
}
async function loadBytes() { try { const d = await idb(); return await new Promise(res => { const q = d.transaction('kv').objectStore('kv').get(STORE_KEY); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); } catch { return undefined; } }
async function saveBytes() {
  try {
    const bytes = globalThis.__DB_INSTANCE.export(), d = await idb();
    await new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(bytes, STORE_KEY); t.oncomplete = res; t.onerror = () => rej(t.error); });
  } catch { /* trình duyệt không cho lưu: dữ liệu mất khi tải lại */ }
}

let db;
function seedAccounts() {
  db.exec('DELETE FROM users');
  if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'line')) db.exec('ALTER TABLE users ADD COLUMN line TEXT');
  ensureMustChange();
  const ins = db.prepare("INSERT INTO users(username, display_name, role, password_hash, line, dept) VALUES (?,?,?,?,?,?)");
  const DEPT = { planner: 'Kế hoạch', kho: 'Kho', opkho: 'Kho', line: 'Sản xuất', approver: 'Sản xuất' };
  for (const [u, n, r, l] of DEMO_ACCOUNTS) ins.run(u, n, r, `pin:${DEMO_PIN}`, l || null, DEPT[r] || '');
  // Bản thử: AD01 và KH01 (Trưởng bộ phận Kho) có sẵn mật khẩu cấp 2 = DEMO_PIN2.
  db.prepare("UPDATE users SET pin2 = ? WHERE username IN ('AD01', 'KH01')").run(`p2:${DEMO_PIN2}`);
  db.prepare("UPDATE users SET is_head = 1 WHERE username = 'KH01'").run();
  // Leader giao nhận: LN01 (Line 1), LN04 (Line 4) có quyền lineSign + MK cấp 2 = DEMO_PIN2 → ký nhận PO / trạng thái PO nội bộ đúng Line mình.
  const lead = JSON.stringify({ ...ROLE_DEFAULTS.line, specials: { ...ROLE_DEFAULTS.line.specials, lineSign: true } });
  db.prepare("UPDATE users SET perms = ?, pin2 = ? WHERE username IN ('LN01', 'LN04')").run(lead, `p2:${DEMO_PIN2}`);
}
function ensureMustChange() {
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  for (const [c, def] of [['must_change', 'INTEGER NOT NULL DEFAULT 0'], ['dept', "TEXT NOT NULL DEFAULT ''"], ['is_head', 'INTEGER NOT NULL DEFAULT 0'], ['perms', 'TEXT'], ['pin2', "TEXT NOT NULL DEFAULT ''"]])
    if (!cols.includes(c)) db.exec(`ALTER TABLE users ADD COLUMN ${c} ${def}`);
  ensurePermSchema(db);
}
async function freshDemo() {
  await resetDemo(db, '', readDemo);
  seedAccounts();
  db.prepare("UPDATE audit_log SET username = CASE username WHEN 'planner' THEN 'PL01' WHEN 'kho' THEN 'KH01' WHEN 'duyet' THEN 'DY01' WHEN 'line1' THEN 'LN01' ELSE username END").run();
}
const ready = (async () => {
  globalThis.__SQL = await globalThis.initSqlJs();
  const saved = await loadBytes();
  if (saved && saved.length) {
    globalThis.__DB_BYTES = saved instanceof Uint8Array ? saved : new Uint8Array(saved);
    try { db = openDatabase('data'); ensureKittingSchema(db); ensurePlanExtraSchema(db); ensurePoSchema(db); ensureMustChange(); ensureReceiptSchema(db); if (db.prepare('SELECT COUNT(*) n FROM users').get().n) return; } catch { /* hỏng thì nạp lại */ }
  }
  globalThis.__DB_BYTES = null;
  db = openDatabase('data'); ensureKittingSchema(db); ensurePlanExtraSchema(db); ensurePoSchema(db); ensureReceiptSchema(db);
  await freshDemo();
  await saveBytes();
})();

const publicUser = u => ({ id: String(u.id), username: u.username, name: u.display_name, role: u.role, roleLabel: ROLE_LABEL[u.role], line: u.line || '', mustChange: !!u.must_change,
  dept: u.dept || '', isHead: !!u.is_head, perms: effectivePerms(u.role, normalizePerms(u.perms)), customPerms: !!normalizePerms(u.perms), hasPin2: !!u.pin2 });
// Bản chạy thử: mật khẩu cấp 2 lưu dạng chữ (giống mật khẩu đăng nhập của bản thử, chỉ nằm trong trình duyệt).
const permInput = (body, cur) => ({ role: body.role !== undefined ? trim(body.role) : cur?.role, dept: body.dept !== undefined ? trim(body.dept).slice(0, 40) : cur?.dept,
  isHead: body.isHead !== undefined ? !!body.isHead : !!cur?.isHead, perms: body.perms !== undefined ? (body.perms === null ? null : normalizePerms(body.perms)) : undefined });
function localRoutes() {
  return [
    { method: 'GET', path: '/api/status', auth: false, handler: () => ({ setupRequired: false, demo: true, demoUsers: DEMO_ACCOUNTS.map(([u, n, r]) => ({ username: u, name: n, roleLabel: ROLE_LABEL[r], pin: DEMO_PIN })) }) },
    { method: 'GET', path: '/api/me', handler: ({ user }) => ({ user, today: planning.todayKey(), settings: getSettings(db), demo: true, perm: permCatalog() }) },
    { method: 'GET', path: '/api/admin/users', handler: ({ user }) => {
      const all = db.prepare('SELECT * FROM users ORDER BY role, username').all();
      return { users: all.map(u => ({ ...publicUser(u), active: u.active, created_at: u.created_at, rawPerms: normalizePerms(u.perms) })).filter(u => canSeeUser(user, u)),
        depts: [...new Set(all.map(u => u.dept).filter(Boolean))].sort(), lines: db.prepare('SELECT name FROM lines WHERE active = 1 ORDER BY sort_order, name').all().map(r => r.name), perm: permCatalog(), me: user };
    } },
    { method: 'POST', path: '/api/admin/users', handler: ({ body, user }) => {
      const username = trim(body?.username).toUpperCase(), next = permInput(body || {});
      if (!/^[A-Z0-9._-]{2,30}$/.test(username)) throw fail('Mã NV 2–30 ký tự: chữ, số, . _ -');
      if (!ROLE_LABEL[next.role]) throw fail('Chọn vai trò.');
      if (user.role !== 'admin') next.dept = next.dept || user.dept;
      checkUserChange(user, null, { ...next, perms: next.perms || undefined });
      const pin = checkPassword(body?.password);
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw fail('Mã NV đã có tài khoản.', 409);
      db.prepare('INSERT INTO users(username, display_name, role, password_hash, line, must_change, dept, is_head, perms) VALUES (?,?,?,?,?,1,?,?,?)')
        .run(username, trim(body?.name) || username, next.role, `pin:${pin}`, trim(body?.line) || null, next.dept || '', next.isHead ? 1 : 0, next.perms ? JSON.stringify(next.perms) : null);
      audit(db, user.username, 'user.create', { username, role: next.role, dept: next.dept });
      return { ok: true };
    } },
    { method: 'POST', path: '/api/admin/users/update', handler: ({ body, user }) => {
      const id = Number(body?.id), t = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (!t) throw fail('Không tìm thấy tài khoản.', 404);
      const cur = publicUser(t), self = String(id) === user.id, next = permInput(body, cur);
      if (body.role !== undefined && !ROLE_LABEL[next.role]) throw fail('Vai trò không hợp lệ.');
      if (self && user.role === 'admin' && next.role !== 'admin') throw fail('Không tự bỏ quyền Quản trị của chính mình.');
      if (!self || user.role !== 'admin') checkUserChange(user, cur, { ...next, perms: next.perms || undefined });
      if ('active' in body) { if (self && !body.active) throw fail('Không thể khóa tài khoản đang dùng.'); db.prepare('UPDATE users SET active = ? WHERE id = ?').run(body.active ? 1 : 0, id); }
      db.prepare('UPDATE users SET role = ?, dept = ?, is_head = ? WHERE id = ?').run(next.role, next.dept || '', next.isHead ? 1 : 0, id);
      if (body.perms !== undefined) db.prepare('UPDATE users SET perms = ? WHERE id = ?').run(next.perms ? JSON.stringify(next.perms) : null, id);
      if (body.resetPin2) { if (user.role !== 'admin') throw fail('Chỉ Quản trị xóa mật khẩu cấp 2.', 403); db.prepare("UPDATE users SET pin2 = '' WHERE id = ?").run(id); }
      if (body.name) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(trim(body.name), id);
      if ('line' in body) db.prepare('UPDATE users SET line = ? WHERE id = ?').run(trim(body.line) || null, id);
      if (body.password) db.prepare('UPDATE users SET password_hash = ?, must_change = ? WHERE id = ?').run(`pin:${checkPassword(body.password)}`, self ? 0 : 1, id);
      audit(db, user.username, 'user.update', { username: t.username, keys: Object.keys(body).filter(k => !['id', 'password'].includes(k)) });
      return { ok: true };
    } },
    { method: 'POST', path: '/api/admin/users/delete', handler: ({ body, user }) => {
      const id = Number(body?.id), t = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (!t) throw fail('Không tìm thấy tài khoản.', 404);
      if (String(id) === user.id) throw fail('Không thể xóa tài khoản đang dùng.');
      checkUserChange(user, publicUser(t), {});
      if (t.role === 'admin' && db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND active = 1").get().n <= 1) throw fail('Không xóa Quản trị cuối cùng.');
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
      audit(db, user.username, 'user.delete', { username: t.username });
      return { ok: true, message: `Đã xóa tài khoản ${t.username}.` };
    } },
    { method: 'POST', path: '/api/me/password', handler: ({ body, user }) => {
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(user.id)), cur = String(body?.current || ''), pw = checkPassword(body?.password);
      if (u.password_hash !== `pin:${cur}`) throw fail('Mật khẩu hiện tại không đúng.');
      if (pw === cur) throw fail('Mật khẩu mới phải khác mật khẩu hiện tại.');
      db.prepare('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?').run(`pin:${pw}`, u.id);
      audit(db, user.username, 'user.password', {});
      return { ok: true, message: 'Đã đổi mật khẩu.' };
    } },
    { method: 'POST', path: '/api/me/pin2', handler: ({ body, user }) => {
      if (!needsPin2(user)) throw fail('Chỉ Quản trị / Trưởng bộ phận / Leader giao nhận cần mật khẩu cấp 2.', 403);
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(user.id)), pin = checkPin2(body?.pin2);
      if (u.password_hash !== `pin:${String(body?.password || '')}`) throw fail('Mật khẩu đăng nhập không đúng.');
      if (pin === String(body?.password)) throw fail('Mật khẩu cấp 2 phải khác mật khẩu đăng nhập.');
      db.prepare('UPDATE users SET pin2 = ? WHERE id = ?').run(`p2:${pin}`, u.id);
      audit(db, user.username, 'user.pin2', {});
      return { ok: true, message: 'Đã đặt mật khẩu cấp 2.' };
    } },
    { method: 'POST', path: '/api/me/pin2/verify', handler: ({ body, user }) => {
      if (pin2Locked(db, user.id)) return { ok: false, message: 'Sai mật khẩu cấp 2 quá 5 lần. Thử lại sau 15 phút.' };
      const u = db.prepare('SELECT pin2 FROM users WHERE id = ?').get(Number(user.id));
      return pin2Result(db, user.id, !!u.pin2 && u.pin2 === `p2:${String(body?.pin2 || '')}`);
    } },
    { method: 'POST', path: '/api/demo/reset', noTx: true, handler: async () => { await freshDemo(); return { ok: true, message: 'Đã nạp lại dữ liệu mẫu' }; } },
    { method: 'POST', path: '/api/demo/clear', handler: () => tx(db, () => {
      for (const t of ['kit_receipt', 'kit_receipt_log', 'plan_undo', 'bom_vln', 'material_request', 'kit_txn', 'kit_item', 'kit_order_po', 'kit_order', 'line_params', 'line_assign', 'bom', 'model_map', 'po', 'import_log', 'audit_log']) db.exec(`DELETE FROM ${t}`);
      return { ok: true, message: 'Đã xóa trắng — nhập file BOM và Plan Master thật' };
    }) }
  ];
}
let table = null;
// Leader giao nhận ký (bản thử: MK cấp 2 lưu dạng chữ p2:…).
function demoSign(username, pin, line) {
  const name = trim(username).toUpperCase();
  if (!name) return { ok: false, message: 'Nhập Mã NV của Leader giao nhận.' };
  if (!String(pin || '')) return { ok: false, message: 'Nhập mật khẩu cấp 2 của Leader.' };
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(name);
  const u = row ? { ...publicUser(row), active: !!row.active } : null;
  const r = signCheck(db, u, line, () => !!row.pin2 && row.pin2 === `p2:${String(pin)}`);
  if (!r.ok && u) audit(db, name, 'sign.fail', { line });
  return r;
}
const routeTable = () => table || (table = [...localRoutes(), ...coreRoutes(db), ...planRoutes(db), ...kittingRoutes(db), ...bomRoutes(db), ...erpLineRoutes(db, null), ...erpStockRoutes(db, null), ...bomChangeRoutes(db), ...receiptRoutes(db, demoSign)]);

function login(body) {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(trim(body?.identity).toUpperCase());
  if (!u || !u.active || u.password_hash !== `pin:${String(body?.password || '')}`) throw Object.assign(new Error('Failed to authenticate.'), { status: 400 });
  return { token: TOKEN_PREFIX + u.id, record: { id: String(u.id), username: u.username, role: u.role } };
}

let queue = Promise.resolve();
async function handle(method, url, options) {
  await ready;
  const u = new URL(url, 'https://app.local/');
  let body = null; if (options.body) { try { body = JSON.parse(options.body); } catch { body = null; } }
  if (u.pathname === '/api/collections/users/auth-with-password') return login(body);
  if (!u.pathname.startsWith('/api/mm/')) throw fail('Không tìm thấy API.', 404);
  const path = '/api/' + u.pathname.slice('/api/mm/'.length);
  const route = routeTable().find(r => r.method === method && r.path === path);
  if (!route) throw fail('Không tìm thấy API.', 404);
  let user = null;
  if (route.auth !== false) {
    const h = options.headers || {}, tok = String(h.Authorization || h.authorization || '');
    const row = tok.startsWith(TOKEN_PREFIX) ? db.prepare('SELECT * FROM users WHERE id = ?').get(Number(tok.slice(TOKEN_PREFIX.length))) : null;
    if (!row || !row.active) throw fail('Vui lòng đăng nhập.', 401);
    user = publicUser(row);
    checkAccess(user, method, path);
    requirePin2(db, user, method, path);
  }
  const req = { query: u.searchParams, body: body || {}, user };
  if (method === 'GET') return route.handler(req);
  // Ghi lần lượt, mỗi lần trong 1 transaction (giống PocketBase), rồi lưu vào trình duyệt.
  const task = queue.then(async () => { const out = route.noTx ? await route.handler(req) : tx(db, () => route.handler(req)); await saveBytes(); return out; });
  queue = task.catch(() => { });
  return task;
}

const nativeFetch = globalThis.fetch?.bind(globalThis);
globalThis.fetch = async (input, options = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api/')) return nativeFetch(input, options);
  try {
    const out = await handle((options.method || 'GET').toUpperCase(), url, options);
    return new Response(JSON.stringify(out ?? {}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    const status = Number(e.status) || 500;
    if (status >= 500) console.error(e);
    return new Response(JSON.stringify({ error: status >= 500 ? `Lỗi xử lý: ${e.message}` : e.message, ...(e.code ? { code: e.code } : {}) }), { status, headers: { 'Content-Type': 'application/json' } });
  }
};
