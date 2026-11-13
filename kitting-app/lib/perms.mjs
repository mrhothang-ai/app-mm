// Phân quyền chi tiết: mỗi tài khoản có mức quyền theo từng màn hình (0 ẩn · 1 xem · 2 thao tác) + quyền đặc biệt.
// Vai trò chỉ là mẫu quyền mặc định; Quản trị (hoặc Trưởng bộ phận trong phạm vi bộ phận mình) chỉnh từng ô.
// Server kiểm tra mọi API theo ROUTE_PERM (không chỉ ẩn trên giao diện). Quản lý tài khoản cần mật khẩu cấp 2 (hiệu lực 5 phút).
import { fail } from './db.mjs';

export const SCREENS = [['board', 'Kế hoạch kitting'], ['kho', 'Kho'], ['kitpad', 'Kitting'], ['prod', 'Sản xuất'], ['supply', 'Cấp vật liệu'],
  ['report', 'Báo cáo'], ['lines', 'Line & tham số'], ['po', 'Dữ liệu PO'], ['bom', 'BOM & Model']];
export const SPECIALS = [['deliver', 'Giao Line'], ['approve', 'Duyệt ngoại lệ'], ['bomImport', 'Nhập BOM (theo Model Code trong file)'], ['prodUpdate', 'Cập nhật sản xuất'], ['internalPo', 'Tạo / sửa / hủy PO nội bộ (Unplan / RMA)'], ['bomChange', 'Change code BOM (ECN)'],
  ['lineSign', 'Leader giao nhận (ký nhận PO, trạng thái PO nội bộ — cần MK cấp 2)']];
const SCREEN_KEYS = SCREENS.map(s => s[0]), SPECIAL_KEYS = SPECIALS.map(s => s[0]);

const P = (screens, specials = []) => ({ screens: Object.fromEntries(SCREEN_KEYS.map(k => [k, screens[k] || 0])), specials: Object.fromEntries(SPECIAL_KEYS.map(k => [k, specials.includes(k)])) });
export const ROLE_DEFAULTS = {
  admin: P(Object.fromEntries(SCREEN_KEYS.map(k => [k, 2])), SPECIAL_KEYS),
  planner: P({ board: 2, kho: 1, prod: 1, supply: 1, report: 1, lines: 2, po: 2, bom: 2 }, ['bomImport', 'internalPo']),
  kho: P({ board: 1, kho: 2, kitpad: 2, prod: 1, supply: 2, report: 1, lines: 1, po: 1, bom: 1 }, ['deliver']),
  opkho: P({ kitpad: 2 }),
  line: P({ board: 1, prod: 2, supply: 2, report: 1, lines: 1, po: 1, bom: 1 }),
  approver: P({ board: 1, kho: 1, prod: 1, supply: 2, report: 1, lines: 1, po: 1, bom: 1 }, ['approve'])
};

// Quyền lưu trong tài khoản (JSON) → chuẩn hóa; trống thì theo vai trò. Quản trị luôn đủ quyền.
export function normalizePerms(raw) {
  let p = raw;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = null; } }
  if (!p || typeof p !== 'object' || !p.screens) return null;
  return { screens: Object.fromEntries(SCREEN_KEYS.map(k => [k, [0, 1, 2].includes(Number(p.screens[k])) ? Number(p.screens[k]) : 0])),
    specials: Object.fromEntries(SPECIAL_KEYS.map(k => [k, !!p.specials?.[k]])) };
}
export function effectivePerms(role, raw) {
  if (role === 'admin') return ROLE_DEFAULTS.admin;
  return normalizePerms(raw) || ROLE_DEFAULTS[role] || P({});
}

// API → quyền cần (chỉ cần 1 trong danh sách). 'board:1' = xem màn Kế hoạch, 'board:2' = thao tác; tên quyền đặc biệt;
// '@any' = mọi tài khoản đã đăng nhập; '@admin' = Quản trị; '@manager' = Quản trị hoặc Trưởng bộ phận. API không có ở đây → chỉ Quản trị.
const R = {
  '@any': ['GET /api/bom/changes/alerts', 'POST /api/bom/change/preview', 'POST /api/bom/change', 'POST /api/bom/change/cancel', 'GET /api/me', 'GET /api/badges', 'GET /api/lines/assign', 'GET /api/lines/params', 'GET /api/lines/week', 'GET /api/vln-overview',
    'POST /api/me/password', 'POST /api/me/pin2', 'POST /api/me/pin2/verify'],
  'board:1': ['GET /api/board'],
  'board:2': ['POST /api/board/apply', 'POST /api/board/batch', 'POST /api/board/merge', 'POST /api/board/split', 'POST /api/board/undo', 'POST /api/board/auto', 'POST /api/board/import'],
  'lines:2': ['POST /api/lines/assign', 'POST /api/lines/assign/copy', 'POST /api/lines/params', 'POST /api/lines/params/delete', 'POST /api/lines/week', 'POST /api/lines/week/copy', 'POST /api/lines/manage', 'POST /api/lines/erp/sync'],
  'lines:1': ['GET /api/lines/erp'],
  'po:1|prodUpdate': ['GET /api/po', 'GET /api/po/history'],
  'po:2': ['POST /api/po/import', 'POST /api/po/note'],
  'po:2|kho:2': ['POST /api/po/drop-cancelled'],
  'prodUpdate': ['POST /api/po/production', 'GET /api/po/production/log'],
  'bomImport': ['POST /api/bom/import', 'POST /api/bom/erp/sync'],
  'internalPo': ['GET /api/po/internal/options', 'POST /api/po/internal', 'POST /api/po/internal/edit', 'POST /api/po/internal/cancel'],
  'bom:1|kho:1': ['GET /api/bom/changes', 'GET /api/bom/erp'],
  'bom:1|board:1': ['GET /api/bom', 'GET /api/bom/model'],
  'bom:2': ['POST /api/bom/row', 'POST /api/bom/row/delete', 'POST /api/bom/code', 'POST /api/bom/code/delete', 'POST /api/bom/vln', 'POST /api/bom/group', 'POST /api/bom/model-map', 'POST /api/bom/resuggest'],
  '@admin': ['GET /api/admin/settings', 'POST /api/admin/settings', 'GET /api/admin/erp', 'POST /api/admin/erp', 'POST /api/admin/lines', 'POST /api/demo/reset', 'POST /api/demo/clear'],
  '@manager': ['GET /api/admin/users', 'POST /api/admin/users', 'POST /api/admin/users/update', 'POST /api/admin/users/delete'],
  // Soạn bù nợ (/api/kho/bu): OP kho (tab Kitting) + Kho; bấm Giao bù (tạo đợt, POST /api/kho/debts/settle) chỉ Kho
  'kho:1|kitpad:1': ['GET /api/kho/queue', 'GET /api/kho/kit', 'GET /api/kho/bu', 'GET /api/kho/bu/kit'],
  'kho:2|kitpad:2': ['POST /api/kho/print', 'POST /api/kho/kit', 'POST /api/kho/kit/start', 'POST /api/kho/bu'],
  'kho:1': ['GET /api/kho/stock', 'GET /api/kho/lines', 'GET /api/kho/deliver-preview', 'GET /api/kho/debts', 'GET /api/kho/adjust', 'GET /api/kho/history', 'GET /api/kho/dispatch', 'GET /api/kho/material-summary'],
  'deliver': ['POST /api/kho/deliver'],
  'kho:2': ['POST /api/kho/stock/sync', 'POST /api/kho/debts/settle', 'POST /api/kho/adjust', 'POST /api/supply/issue', 'POST /api/kho/receipt/resolve', 'POST /api/kho/lot/resolve'],
  'supply:1|prod:1': ['GET /api/supply/form', 'GET /api/supply'],
  'supply:2|prod:2': ['POST /api/supply'],
  'approve': ['POST /api/supply/decide'],
  'report:1': ['GET /api/report/kitting', 'GET /api/report/safety', 'GET /api/report/exceptions'],
  'prod:1': ['GET /api/prod', 'GET /api/prod/debts', 'GET /api/prod/line', 'GET /api/prod/ready'],
  // Nhận PO / trạng thái PO nội bộ: máy của Line (prod:2) thao tác, Leader giao nhận ký bằng Mã NV + MK cấp 2 (kiểm trong handler).
  'prod:1|kho:1': ['GET /api/prod/receipt', 'GET /api/prod/lots'],
  'prod:2': ['POST /api/prod/receipt/receive', 'POST /api/prod/receipt/reject', 'POST /api/prod/internal-status', 'POST /api/prod/lots/receive'],
  'kho:1|supply:1': ['GET /api/kho/receipts']
};
const ROUTE_PERM = new Map(Object.entries(R).flatMap(([need, list]) => list.map(r => [r, need.split('|')])));
// Thao tác cần mật khẩu cấp 2 (đã xác nhận trong 5 phút).
export const PIN2_ROUTES = new Set(['POST /api/admin/users', 'POST /api/admin/users/update', 'POST /api/admin/users/delete']);
export const PIN2_MINUTES = 5;

export const isManager = user => user.role === 'admin' || !!user.isHead;
function has(user, token) {
  if (token === '@any') return true;
  if (token === '@admin') return user.role === 'admin';
  if (token === '@manager') return isManager(user);
  const [screen, level] = token.split(':');
  if (level) return (user.perms.screens[screen] || 0) >= Number(level);
  return !!user.perms.specials[token];
}
// user: { role, isHead, perms (effectivePerms) }
export function checkAccess(user, method, path) {
  if (user.role === 'admin') return;
  const need = ROUTE_PERM.get(`${method} ${path}`) || ['@admin'];
  if (!need.some(t => has(user, t))) throw fail('Tài khoản chưa được cấp quyền cho chức năng này.', 403);
}

// Trưởng bộ phận: chỉ quản lý tài khoản cùng bộ phận (không phải Quản trị / Trưởng bộ phận khác),
// không tạo Quản trị / Trưởng bộ phận, không cấp quá quyền của chính mình.
export function checkUserChange(actor, target, next) {
  if (actor.role === 'admin') return;
  if (!actor.isHead) throw fail('Chỉ Quản trị hoặc Trưởng bộ phận được quản lý tài khoản.', 403);
  if (!actor.dept) throw fail('Trưởng bộ phận chưa được gán bộ phận.', 403);
  if (target) {
    if (target.id === actor.id) throw fail('Không tự sửa tài khoản của mình ở đây (nhờ Quản trị).', 403);
    if (target.role === 'admin' || target.isHead || target.dept !== actor.dept) throw fail('Tài khoản này không thuộc bộ phận bạn quản lý.', 403);
  }
  if (next.role === 'admin') throw fail('Trưởng bộ phận không tạo / gán quyền Quản trị.', 403);
  if (next.isHead) throw fail('Chỉ Quản trị chỉ định Trưởng bộ phận.', 403);
  if (next.dept !== undefined && next.dept !== actor.dept) throw fail(`Chỉ tạo / sửa tài khoản thuộc bộ phận ${actor.dept}.`, 403);
  const p = next.perms;
  if (p) {
    for (const k of SCREEN_KEYS) if ((p.screens[k] || 0) > (actor.perms.screens[k] || 0)) throw fail(`Không cấp quyền "${SCREENS.find(s => s[0] === k)[1]}" cao hơn quyền của bạn.`, 403);
    for (const k of SPECIAL_KEYS) if (p.specials[k] && !actor.perms.specials[k]) throw fail(`Không cấp quyền "${SPECIALS.find(s => s[0] === k)[1]}" khi bạn không có quyền này.`, 403);
  }
}
export const canSeeUser = (actor, u) => actor.role === 'admin' || u.id === actor.id || (actor.isHead && u.dept === actor.dept && u.role !== 'admin' && !u.isHead);

// Mật khẩu cấp 2: 6–32 ký tự. Phiên xác nhận 5 phút + khóa 15 phút khi sai 5 lần (bảng SQLite, dùng chung PocketBase / bản chạy thử).
export function checkPin2(v) {
  const s = String(v ?? '');
  if (s.length < 6 || s.length > 32) throw fail('Mật khẩu cấp 2: 6–32 ký tự.');
  return s;
}
export function ensurePermSchema(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS pin2_session (user_id TEXT PRIMARY KEY, until TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS pin2_fail (user_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
}
export const pin2Elevated = (db, userId) => !!db.prepare("SELECT 1 FROM pin2_session WHERE user_id = ? AND until > datetime('now')").get(String(userId));
export const pin2Locked = (db, userId) => db.prepare("SELECT COUNT(*) n FROM pin2_fail WHERE user_id = ? AND created_at > datetime('now', '-15 minutes')").get(String(userId)).n >= 5;
export function pin2Result(db, userId, ok) {
  const id = String(userId);
  if (!ok) { db.prepare('INSERT INTO pin2_fail(user_id) VALUES (?)').run(id); return { ok: false, message: pin2Locked(db, id) ? 'Sai mật khẩu cấp 2 quá 5 lần. Thử lại sau 15 phút.' : 'Mật khẩu cấp 2 không đúng.' }; }
  db.prepare('DELETE FROM pin2_fail WHERE user_id = ?').run(id);
  db.prepare(`INSERT INTO pin2_session(user_id, until) VALUES (?, datetime('now', '+${PIN2_MINUTES} minutes')) ON CONFLICT(user_id) DO UPDATE SET until = excluded.until`).run(id);
  return { ok: true, minutes: PIN2_MINUTES };
}
// Kiểm MK cấp 2 của người ký (Leader giao nhận) — ghi lần sai / khóa 15 phút như pin2Result nhưng KHÔNG mở phiên 5 phút.
export function pin2Check(db, userId, ok) {
  const id = String(userId);
  if (!ok) { db.prepare('INSERT INTO pin2_fail(user_id) VALUES (?)').run(id); return { ok: false, message: pin2Locked(db, id) ? 'Sai mật khẩu cấp 2 quá 5 lần. Thử lại sau 15 phút.' : 'Mật khẩu cấp 2 không đúng.' }; }
  db.prepare('DELETE FROM pin2_fail WHERE user_id = ?').run(id);
  return { ok: true };
}
// Ai cần / được đặt MK cấp 2: Quản trị, Trưởng bộ phận, Leader giao nhận.
export const needsPin2 = user => isManager(user) || !!user?.perms?.specials?.lineSign;
// Leader giao nhận ký: tài khoản đang hoạt động, có quyền lineSign, đúng Line (nếu tài khoản có gán Line), đã đặt MK cấp 2.
// u: { id, username, name, line, perms, active, hasPin2 }; pinOk(): so MK cấp 2 (cách băm tùy nơi chạy).
export function signCheck(db, u, line, pinOk) {
  if (!u || !u.active) return { ok: false, message: 'Không có tài khoản Leader này (hoặc đã khóa).' };
  if (!u.perms?.specials?.lineSign) return { ok: false, message: `${u.username} chưa được cấp quyền "Leader giao nhận".` };
  if (u.line && line && u.line !== line) return { ok: false, message: `${u.username} là Leader ${u.line}, không ký cho ${line}.` };
  if (!u.hasPin2) return { ok: false, message: `${u.username} chưa đặt mật khẩu cấp 2 (đăng nhập tài khoản ${u.username}, bấm vào tên ở góc trên để đặt).` };
  if (pin2Locked(db, u.id)) return { ok: false, message: 'Sai mật khẩu cấp 2 quá 5 lần. Thử lại sau 15 phút.' };
  const r = pin2Check(db, u.id, pinOk());
  return r.ok ? { ok: true, username: u.username, name: u.name || u.username } : r;
}
export function requirePin2(db, user, method, path) {
  if (!PIN2_ROUTES.has(`${method} ${path}`)) return;
  if (!user.hasPin2) throw Object.assign(fail('Bạn chưa đặt mật khẩu cấp 2 (bấm vào tên mình ở góc trên).', 428), { code: 'pin2_unset' });
  if (!pin2Elevated(db, user.id)) throw Object.assign(fail('Cần nhập mật khẩu cấp 2.', 428), { code: 'pin2' });
}
// Dữ liệu cho form phân quyền ở tab Quản trị.
export const permCatalog = () => ({ screens: SCREENS, specials: SPECIALS, roleDefaults: ROLE_DEFAULTS, pin2Minutes: PIN2_MINUTES });
