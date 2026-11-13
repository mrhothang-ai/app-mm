// Gói nghiệp vụ Kitting cho PocketBase: pb_hooks/mm.pb.js gọi handle() trong một transaction.
import { makeDb } from './pb-db.mjs';
import { coreRoutes, cleanPoRows, cleanProdRows } from '../../kitting-app/lib/core-routes.mjs';
import { planRoutes } from '../../kitting-app/lib/plan-routes.mjs';
import { kittingRoutes } from '../../kitting-app/lib/kitting-routes.mjs';
import { bomRoutes } from '../../kitting-app/lib/bom-routes.mjs';
import { getSettings, audit, fail } from '../../kitting-app/lib/db.mjs';
import { syncPoRows, updateProduction, syncMesPlan, settleLoads } from '../../kitting-app/lib/po-sync.mjs';
import * as planning from '../../kitting-app/lib/planning.mjs';
import { erpLineRoutes, syncErpLines } from '../../kitting-app/lib/erp-line.mjs';
import { erpStockRoutes, syncErpStock, syncErpBom } from '../../kitting-app/lib/erp-stock.mjs';
import { bomChangeRoutes, applyDueChanges } from '../../kitting-app/lib/bom-change.mjs';
import { checkPassword } from '../../kitting-app/lib/password.mjs';
import { effectivePerms, normalizePerms, checkAccess, checkUserChange, canSeeUser, checkPin2, pin2Locked, pin2Result, requirePin2, permCatalog, needsPin2, signCheck } from '../../kitting-app/lib/perms.mjs';
import { receiptRoutes } from '../../kitting-app/lib/receipt.mjs';

export const ROLE_LABEL = { admin: 'Quản trị', planner: 'Planner', kho: 'Kho', opkho: 'OP kitting kho', line: 'Line', approver: 'Cấp duyệt' };
const trim = v => String(v ?? '').trim();

const permsOf = rec => { const t = rec.getString('perms'); return t && t !== 'null' ? normalizePerms(t) : null; };
export function publicUser(rec) {
  const role = rec.getString('role');
  return { id: rec.id, username: rec.getString('username'), name: rec.getString('name') || rec.getString('username'), role, roleLabel: ROLE_LABEL[role] || '', line: rec.getString('line'), mustChange: rec.getBool('must_change'),
    dept: rec.getString('dept'), isHead: rec.getBool('is_head'), perms: effectivePerms(role, permsOf(rec)), customPerms: !!permsOf(rec), hasPin2: !!rec.getString('pin2') };
}
// Mật khẩu cấp 2 lưu dạng băm: s2$<salt>$<sha256 lặp 20000 lần> (trường pin2 ẩn, API không trả về).
const PIN2_ROUNDS = 20000;
function pin2Hash(pin, salt) { let h = pin; for (let i = 0; i < PIN2_ROUNDS; i++) h = $security.sha256(salt + h); return h; }
const makePin2 = pin => { const salt = $security.randomString(16); return `s2$${salt}$${pin2Hash(pin, salt)}`; };
function pin2Ok(stored, pin) { const [tag, salt, hash] = String(stored || '').split('$'); return tag === 's2' && !!salt && $security.equal(pin2Hash(String(pin || ''), salt), hash); }

function routeTable(app, db) {
  const users = () => app.findCollectionByNameOrId('users');
  const findUser = id => { try { return app.findRecordById('users', trim(id)); } catch { throw fail('Không tìm thấy tài khoản.', 404); } };
  const lineOk = l => !l || db.prepare('SELECT 1 FROM lines WHERE name = ?').get(l);
  // Thông tin quyền gửi lên từ form: vai trò, bộ phận, Trưởng bộ phận, bảng quyền (null = theo vai trò).
  const permInput = (body, cur) => ({
    role: body.role !== undefined ? trim(body.role) : cur?.role, dept: body.dept !== undefined ? trim(body.dept).slice(0, 40) : cur?.dept,
    isHead: body.isHead !== undefined ? !!body.isHead : !!cur?.isHead,
    perms: body.perms !== undefined ? (body.perms === null ? null : normalizePerms(body.perms)) : undefined
  });
  const userRoutes = [
    { method: 'GET', path: '/api/me', handler: ({ user }) => ({ user, today: planning.todayKey(), settings: getSettings(db), perm: permCatalog() }) },
    { method: 'GET', path: '/api/admin/users', handler: ({ user }) => {
      const list = app.findAllRecords('users').map(r => ({ ...publicUser(r), active: r.getBool('active') ? 1 : 0, created_at: String(r.get('created')), rawPerms: permsOf(r) }))
        .filter(u => canSeeUser(user, u)).sort((a, b) => a.dept.localeCompare(b.dept) || a.role.localeCompare(b.role) || a.username.localeCompare(b.username));
      const depts = [...new Set(app.findAllRecords('users').map(r => r.getString('dept')).filter(Boolean))].sort();
      return { users: list, depts, lines: db.prepare('SELECT name FROM lines WHERE active = 1 ORDER BY sort_order, name').all().map(r => r.name), perm: permCatalog(), me: user };
    } },
    { method: 'POST', path: '/api/admin/users', handler: ({ body, user }) => {
      const username = trim(body?.username).toUpperCase(), next = permInput(body || {}), pw = String(body?.password || '');
      if (!/^[A-Z0-9._-]{2,30}$/.test(username)) throw fail('Mã NV 2–30 ký tự: chữ, số, . _ -');
      if (!ROLE_LABEL[next.role]) throw fail('Chọn vai trò.');
      if (user.role !== 'admin') next.dept = next.dept || user.dept;   // Trưởng bộ phận tạo tài khoản trong bộ phận mình
      checkUserChange(user, null, { ...next, perms: next.perms || undefined });
      checkPassword(pw);
      const line = trim(body?.line).slice(0, 40); if (!lineOk(line)) throw fail('Line không hợp lệ.');
      if (app.findAllRecords('users').some(r => r.getString('username') === username)) throw fail('Mã NV đã có tài khoản.', 409);
      const rec = new Record(users());
      rec.set('username', username); rec.set('name', trim(body?.name).slice(0, 80) || username); rec.set('role', next.role); rec.set('active', true); rec.set('line', line);
      rec.set('dept', next.dept || ''); rec.set('is_head', next.isHead); rec.set('perms', next.perms || null);
      rec.set('email', `${username.toLowerCase().replace(/[^a-z0-9]/g, '')}.${Date.now().toString(36)}@mm.local`);
      rec.setPassword(pw); rec.set('must_change', true);   // mật khẩu tạm do người quản lý đặt → người dùng đổi ở lần đăng nhập đầu
      app.save(rec);
      audit(db, user.username, 'user.create', { username, role: next.role, dept: next.dept, isHead: next.isHead, perms: next.perms ? 'riêng' : 'theo vai trò' });
      return { ok: true };
    } },
    { method: 'POST', path: '/api/admin/users/update', handler: ({ body, user }) => {
      const rec = findUser(body?.id), cur = publicUser(rec), self = rec.id === user.id, next = permInput(body, cur);
      if (body.role !== undefined && !ROLE_LABEL[next.role]) throw fail('Vai trò không hợp lệ.');
      if (self && user.role === 'admin' && next.role !== 'admin') throw fail('Không tự bỏ quyền Quản trị của chính mình.');
      if (!self || user.role !== 'admin') checkUserChange(user, cur, { ...next, perms: next.perms || undefined });
      if ('active' in body) { if (self && !body.active) throw fail('Không thể khóa tài khoản đang dùng.'); rec.set('active', !!body.active); if (!body.active) rec.refreshTokenKey(); }
      rec.set('role', next.role); rec.set('dept', next.dept || ''); rec.set('is_head', next.isHead);
      if (body.perms !== undefined) rec.set('perms', next.perms || null);
      if (body.password) { rec.setPassword(checkPassword(body.password)); if (!self) rec.set('must_change', true); }
      if (body.resetPin2) { if (user.role !== 'admin') throw fail('Chỉ Quản trị xóa mật khẩu cấp 2.', 403); rec.set('pin2', ''); }
      if (body.name) rec.set('name', trim(body.name).slice(0, 80));
      if ('line' in body) { const l = trim(body.line).slice(0, 40); if (!lineOk(l)) throw fail('Line không hợp lệ.'); rec.set('line', l); }
      app.save(rec);
      audit(db, user.username, 'user.update', { username: rec.getString('username'), keys: Object.keys(body).filter(k => !['id', 'password'].includes(k)), password: body.password ? 'đặt lại' : undefined });
      return { ok: true };
    } },
    { method: 'POST', path: '/api/admin/users/delete', handler: ({ body, user }) => {
      const rec = findUser(body?.id), cur = publicUser(rec);
      if (rec.id === user.id) throw fail('Không thể xóa tài khoản đang dùng.');
      checkUserChange(user, cur, {});
      if (cur.role === 'admin' && app.findAllRecords('users').filter(r => r.getString('role') === 'admin' && r.getBool('active')).length <= 1) throw fail('Không xóa Quản trị cuối cùng.');
      app.delete(rec);
      audit(db, user.username, 'user.delete', { username: cur.username, role: cur.role, dept: cur.dept });
      return { ok: true, message: `Đã xóa tài khoản ${cur.username}.` };
    } },
    // Người dùng tự đổi mật khẩu (bắt buộc ở lần đăng nhập đầu khi must_change = true).
    { method: 'POST', path: '/api/me/password', handler: ({ body, user }) => {
      const rec = app.findRecordById('users', user.id), cur = String(body?.current || ''), pw = checkPassword(body?.password);
      if (!rec.validatePassword(cur)) throw fail('Mật khẩu hiện tại không đúng.');
      if (pw === cur) throw fail('Mật khẩu mới phải khác mật khẩu hiện tại.');
      rec.setPassword(pw); rec.set('must_change', false); app.save(rec);
      audit(db, user.username, 'user.password', {});
      return { ok: true, message: 'Đã đổi mật khẩu.' };
    } },
    // Đặt / đổi mật khẩu cấp 2 (Quản trị, Trưởng bộ phận): xác nhận bằng mật khẩu đăng nhập.
    { method: 'POST', path: '/api/me/pin2', handler: ({ body, user }) => {
      if (!needsPin2(user)) throw fail('Chỉ Quản trị / Trưởng bộ phận / Leader giao nhận cần mật khẩu cấp 2.', 403);
      const rec = app.findRecordById('users', user.id), pin = checkPin2(body?.pin2);
      if (!rec.validatePassword(String(body?.password || ''))) throw fail('Mật khẩu đăng nhập không đúng.');
      if (pin === String(body?.password)) throw fail('Mật khẩu cấp 2 phải khác mật khẩu đăng nhập.');
      rec.set('pin2', makePin2(pin)); app.save(rec);
      audit(db, user.username, 'user.pin2', {});
      return { ok: true, message: 'Đã đặt mật khẩu cấp 2.' };
    } },
    // Xác nhận mật khẩu cấp 2 → mở quyền quản lý tài khoản trong 5 phút. Sai không ném lỗi để lần sai vẫn được ghi (chống dò).
    { method: 'POST', path: '/api/me/pin2/verify', handler: ({ body, user }) => {
      if (pin2Locked(db, user.id)) return { ok: false, message: 'Sai mật khẩu cấp 2 quá 5 lần. Thử lại sau 15 phút.' };
      const rec = app.findRecordById('users', user.id);
      const r = pin2Result(db, user.id, pin2Ok(rec.getString('pin2'), body?.pin2));
      if (!r.ok) audit(db, user.username, 'user.pin2.fail', {});
      return r;
    } }
  ];
  // Leader giao nhận ký (nhận PO / trạng thái PO nội bộ): Mã NV + MK cấp 2 của tài khoản Leader, nhập ngay trên máy của Line.
  const sign = (username, pin, line) => {
    const name = trim(username).toUpperCase();
    if (!name) return { ok: false, message: 'Nhập Mã NV của Leader giao nhận.' };
    if (!String(pin || '')) return { ok: false, message: 'Nhập mật khẩu cấp 2 của Leader.' };
    let rec = null; try { rec = app.findFirstRecordByData('users', 'username', name); } catch { rec = null; }
    const u = rec ? { ...publicUser(rec), active: rec.getBool('active') } : null;
    const r = signCheck(db, u, line, () => pin2Ok(rec.getString('pin2'), pin));
    if (!r.ok && u) audit(db, name, 'sign.fail', { line });
    return r;
  };
  return [...userRoutes, ...coreRoutes(db), ...planRoutes(db), ...kittingRoutes(db), ...bomRoutes(db), ...erpLineRoutes(db, erpHttp), ...erpStockRoutes(db, erpHttp), ...bomChangeRoutes(db), ...receiptRoutes(db, sign)];
}

// Gọi Next ERP (CHỈ GET) bằng khóa bot trong bảng erp_cfg; lỗi mạng → status 0.
function erpHttp(c) {
  return path => {
    try {
      const r = $http.send({ url: c.url + path, method: 'GET', timeout: 30, headers: { Authorization: `token ${c.key}:${c.secret}`, Accept: 'application/json' } });
      return { status: r.statusCode, json: r.statusCode >= 200 && r.statusCode < 300 ? r.json : null };
    } catch (x) { return { status: 0, json: null }; }
  };
}
// Lịch 15 phút (pb_hooks/mm.pb.js): đồng bộ kế hoạch Line, tồn vị trí, BOM mặc định từ ERP; có thay đổi thì báo các màn hình tải lại.
export function cronErpLines() {
  inTx(tx => { if (planning.clearExpiredPending(makeDb(tx))) bumpEvents(tx, 'lines/pending'); });
  inTx(tx => { if (applyDueChanges(makeDb(tx))) bumpEvents(tx, 'bom/change'); });   // ECN đến ngày áp dụng
  inTx(tx => { if (settleLoads(makeDb(tx))) bumpEvents(tx, 'prod/load'); });   // PO Load thành phẩm tự Hoàn thành theo PO thật
  const { result, err } = inTx(tx => { const r = syncErpLines(makeDb(tx), erpHttp, { username: 'ERP', source: 'ERP tự động 15 phút', auto: true }); if (r.added || r.changed || r.removed) bumpEvents(tx, 'lines/erp'); return r; });
  if (err) console.error(`[mm] ERP line sync: ${err.message || err}`);
  const src = { username: 'ERP', source: 'ERP tự động 15 phút', auto: true };
  const st = inTx(tx => { const r = syncErpStock(makeDb(tx), erpHttp, src); if (r.ok && r.changed) bumpEvents(tx, 'kho/stock'); return r; });
  if (st.err) console.error(`[mm] ERP stock sync: ${st.err.message || st.err}`);
  const bm = inTx(tx => { const r = syncErpBom(makeDb(tx), erpHttp, src); if (r.ok && r.applied) bumpEvents(tx, 'bom/erp'); return r; });
  if (bm.err) console.error(`[mm] ERP BOM sync: ${bm.err.message || bm.err}`);
  return { lines: result, stock: st.result, bom: bm.result };
}
// req: { method, path ('/api/...'), query: {get(k)}, body, user }
export function handle(app, req) {
  const db = makeDb(app);
  const route = routeTable(app, db).find(r => r.method === req.method && r.path === req.path);
  if (!route) throw fail('Không tìm thấy API.', 404);
  checkAccess(req.user, req.method, req.path);
  requirePin2(db, req.user, req.method, req.path);
  return route.handler({ query: req.query, body: req.body || {}, user: req.user });
}

// PO đẩy từ công cụ truyền dữ liệu (khóa API).
export function externalPo(app, body) {
  const db = makeDb(app);
  const source = trim(body?.source) || 'API';
  return { ok: true, ...syncPoRows(db, cleanPoRows(body?.rows), { source: `API: ${source}`.slice(0, 120), username: 'api', fullSnapshot: body?.fullSnapshot === true }) };
}
// Tình trạng sản xuất đẩy từ công cụ đọc QR (khóa API): { source, rows: [{ po, productionQty, remainQty?, status? }] }.
export function externalProduction(app, body) {
  const db = makeDb(app);
  const source = trim(body?.source) || 'QR';
  return { ok: true, ...updateProduction(db, cleanProdRows(body?.rows), { source: `API: ${source}`.slice(0, 120), username: 'api' }) };
}
export const externalMesPlan = (app, body, opts) => syncMesPlan(makeDb(app), body, opts);
export function hasUsers(app) { return app.countRecords('users') > 0; }

/* ---------- xử lý HTTP (gọi từ pb_hooks/mm.pb.js) ---------- */
function bumpEvents(tx, topic) {
  const ev = tx.findRecordById('mm_events', 'kittingevents01');
  ev.set('n', (ev.getInt('n') + 1) % 1000000000); ev.set('topic', String(topic).slice(0, 40)); tx.save(ev);
}
function readBody(e) { try { return JSON.parse(JSON.stringify(e.requestInfo().body || {})); } catch (_) { return {}; } }
// Chạy fn trong transaction; trả { result } hoặc { err } (giữ nguyên mã lỗi nghiệp vụ).
function inTx(fn) {
  let result, err = null;
  try { $app.runInTransaction(tx => { try { result = fn(tx); } catch (x) { err = x; throw x; } }); } catch (x) { if (!err) err = x; }
  return { result, err };
}
function reply(e, label, { result, err }) {
  if (err) {
    const status = Number(err && err.status) || 500;
    if (status >= 500) console.error(`[mm] ${label}: ${err && err.message || err}`);
    return e.json(status, { error: status >= 500 ? `Lỗi máy chủ: ${(err && err.message) || err}` : err.message, ...(err && err.code ? { code: err.code } : {}) });
  }
  return e.json(200, result === undefined ? { ok: true } : result);
}
export function serve(e, method) {
  const path = '/api/' + e.request.pathValue('path');
  if (method === 'GET' && path === '/api/status') return e.json(200, { setupRequired: !hasUsers($app), demo: false });
  const a = e.auth;
  if (!a || a.collection().name !== 'users') return e.json(401, { error: 'Vui lòng đăng nhập.' });
  if (!a.getBool('active')) return e.json(401, { error: 'Tài khoản đã bị khóa.' });
  const user = publicUser(a), body = method === 'GET' ? {} : readBody(e);
  const values = e.request.url.query();
  const query = { get: k => { const v = values.get(k); return v === '' ? null : v; } };
  return reply(e, `${method} ${path}`, inTx(tx => {
    const r = handle(tx, { method, path, query, body, user });
    if (method !== 'GET') bumpEvents(tx, path.slice(5));
    return r;
  }));
}
const apiKeyOk = e => { const key = $os.getenv('MM_API_KEY') || '', given = e.request.header.get('X-MM-Key') || ''; return key.length >= 16 && given.length === key.length && given === key; };
export function servePoApi(e) {
  if (!apiKeyOk(e)) return e.json(401, { error: 'Sai hoặc chưa cấu hình khóa API.' });
  const body = readBody(e);
  return reply(e, 'POST /api/mmx/po', inTx(tx => { const r = externalPo(tx, body); bumpEvents(tx, 'po/api'); return r; }));
}
// MES đẩy kế hoạch + số sản xuất từng PO (cùng khóa X-MM-Key). ?dry=1: kiểm tra kết nối / dữ liệu, không ghi. Chỉ báo các màn hình tải lại khi có thay đổi.
export function serveMesPlanApi(e) {
  if (!apiKeyOk(e)) return e.json(401, { error: 'Sai hoặc chưa cấu hình khóa API.' });
  const body = readBody(e), dry = e.request.url.query().get('dry') === '1';
  return reply(e, 'POST /api/mmx/po-plan', inTx(tx => { const r = externalMesPlan(tx, body, { dry }); if (!dry && (r.inserted || r.updated)) bumpEvents(tx, 'po/api'); return r; }));
}
export function serveProdApi(e) {
  if (!apiKeyOk(e)) return e.json(401, { error: 'Sai hoặc chưa cấu hình khóa API.' });
  const body = readBody(e);
  return reply(e, 'POST /api/mmx/production', inTx(tx => { const r = externalProduction(tx, body); bumpEvents(tx, 'po/production'); return r; }));
}
