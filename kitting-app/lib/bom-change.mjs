// Change code BOM theo ECN: mỗi ECN đổi 1 mã vật liệu (code trước → code sau) trong 1 hoặc nhiều Model Code của 1 Model.
// Quyền: Quản trị, Trưởng bộ phận Kho, hoặc tài khoản được cấp quyền đặc biệt "bomChange" — không duyệt, lưu log + cảnh báo công khai.
// Ngày áp dụng ≤ hôm nay → đổi ngay; sau hôm nay → "Chờ áp dụng", cron 15 phút tự đổi đúng ngày (hủy được trước đó).
// Kit đã lập KH (chưa giao Line): updatePlanned = đổi mã cũ chưa soạn trong kit sang mã mới (định mức theo Point mới), kit đã soạn mã cũ giữ nguyên
// và báo lại; không chọn = chốt BOM cũ cho các kit đó trước khi đổi, chỉ PO lập KH sau dùng mã mới.
import { tx, fail, audit } from './db.mjs';
import { todayKey } from './planning.mjs';
import { rebuildVln } from './bom.mjs';
import { ensureItems } from './kitting.mjs';
import { assertBomEditable } from './erp-stock.mjs';

export const CHANGE_REASONS = { ECN: 'Thay đổi kỹ thuật (ECN)', VENDOR: 'Thay nhà cung cấp', EOL: 'Hết hàng / ngừng mã cũ', QUALITY: 'Chất lượng', OTHER: 'Khác' };
const r3 = n => Math.round(Number(n) * 1000) / 1000;
const t = v => String(v ?? '').trim();
const MODEL = 'COALESCE(m.model, b.model_code)';

export function ensureBomChangeSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS bom_change (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ecn TEXT NOT NULL UNIQUE, model TEXT NOT NULL, codes TEXT NOT NULL,
    old_material TEXT NOT NULL, new_material TEXT NOT NULL, new_description TEXT, old_point REAL, new_point REAL,
    reason TEXT NOT NULL, note TEXT, effective_date TEXT NOT NULL, update_planned INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'scheduled', result TEXT,
    created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    applied_by TEXT, applied_at TEXT, cancelled_by TEXT, cancelled_at TEXT, cancel_reason TEXT)`);
}
// Quản trị · Trưởng BP Kho · quyền đặc biệt bomChange (Planner, OP kho không có).
export const canChangeBom = u => !!u && (u.role === 'admin' || (u.isHead && (u.role === 'kho' || /kho/i.test(u.dept || ''))) || !!u.perms?.specials?.bomChange);

function rowsOf(db, codes, material) {
  return db.prepare(`SELECT * FROM bom WHERE material = ? AND model_code IN (${codes.map(() => '?').join(',')})`).all(material, ...codes);
}
// Số ECN tự sinh: ECN-YYMMDD-NNN (ngày tạo giờ VN, thứ tự trong ngày) — không nhập tay.
export function nextEcn(db) {
  const prefix = `ECN-${todayKey().replace(/-/g, '').slice(2)}-`;
  const last = db.prepare('SELECT ecn FROM bom_change WHERE ecn LIKE ? ORDER BY ecn DESC LIMIT 1').get(`${prefix}%`)?.ecn;
  return `${prefix}${String((last ? Number(last.slice(prefix.length)) || 0 : 0) + 1).padStart(3, '0')}`;
}
function check(db, b) {
  const ecn = nextEcn(db), model = t(b.model), oldM = t(b.oldMaterial), newM = t(b.newMaterial), reason = t(b.reason);
  if (!model) throw fail('Chọn Model.');
  const all = db.prepare(`SELECT DISTINCT b.model_code c FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code WHERE ${MODEL} = ?`).all(model).map(r => r.c);
  if (!all.length) throw fail(`Model ${model} chưa có BOM.`);
  // "Tất cả" = mọi Model Code của Model đang có code trước.
  const codes = b.allCodes ? all.filter(c => db.prepare('SELECT 1 FROM bom WHERE model_code = ? AND material = ?').get(c, oldM)) : [...new Set((Array.isArray(b.codes) ? b.codes : []).map(t).filter(Boolean))];
  if (!codes.length) throw fail('Chọn ít nhất 1 Model Code.');
  const bad = codes.filter(c => !all.includes(c)); if (bad.length) throw fail(`Model Code không thuộc ${model}: ${bad.join(', ')}.`);
  if (!oldM || !newM) throw fail('Nhập code trước và code sau.');
  if (oldM.toUpperCase() === newM.toUpperCase()) throw fail('Code sau phải khác code trước.');
  const olds = rowsOf(db, codes, oldM), missing = codes.filter(c => !olds.some(r => r.model_code === c));
  if (missing.length) throw fail(`${oldM} không có trong BOM của: ${missing.join(', ')}.`);
  const dup = rowsOf(db, codes, newM).map(r => r.model_code); if (dup.length) throw fail(`${newM} đã có trong BOM của: ${dup.join(', ')}.`);
  const pending = db.prepare("SELECT ecn FROM bom_change WHERE status = 'scheduled' AND model = ? AND old_material = ?").get(model, oldM);
  if (pending) throw fail(`${oldM} đã có ECN ${pending.ecn} chờ áp dụng — hủy ECN đó trước.`);
  if (!CHANGE_REASONS[reason]) throw fail('Chọn lý do.');
  const day = t(b.effectiveDate) || todayKey(); if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw fail('Ngày áp dụng không hợp lệ.');
  const points = [...new Set(olds.map(r => r.point))];
  const np = b.newPoint === '' || b.newPoint === undefined || b.newPoint === null ? null : Number(b.newPoint);
  if (np !== null && !(np > 0)) throw fail('Point mới phải > 0.');
  return { ecn, model, codes, oldM, newM, reason, day, olds, oldPoint: points.length === 1 ? points[0] : null, newPoint: np,
    newDesc: t(b.newDescription).slice(0, 200), note: t(b.note).slice(0, 300), updatePlanned: !!b.updatePlanned };
}

// Kit đã lập KH, chưa giao Line, có PO thuộc các Model Code đổi.
function plannedKits(db, codes) {
  return db.prepare(`SELECT DISTINCT k.* FROM kit_order k JOIN kit_order_po x ON x.kit_id = k.id JOIN po p ON p.po_key = x.po_key
    WHERE k.plan_day IS NOT NULL AND k.vln_status <> 'delivered' AND p.model_code IN (${codes.map(() => '?').join(',')}) ORDER BY k.plan_day, k.seq`).all(...codes);
}
// Kit bị ảnh hưởng: mã cũ trong kit (đã soạn / chưa soạn) — dùng cho xem trước và kết quả.
function kitImpact(db, c) {
  return plannedKits(db, c.codes).map(k => {
    const its = db.prepare('SELECT * FROM kit_item WHERE kit_id = ? AND material = ?').all(k.id, c.oldM);
    return { id: k.id, code: k.code, day: k.plan_day, opened: !!db.prepare('SELECT 1 FROM kit_item WHERE kit_id = ? LIMIT 1').get(k.id), kitted: its.some(i => i.kitted > 0), hasOld: its.length > 0 };
  });
}

export function previewChange(db, body) {
  ensureBomChangeSchema(db);
  const c = check(db, body);
  const kits = kitImpact(db, c);
  return { ok: true, ecn: c.ecn, model: c.model, codes: c.codes, oldMaterial: c.oldM, newMaterial: c.newM, oldPoint: c.oldPoint, newPoint: c.newPoint ?? c.oldPoint,
    rows: c.olds.map(r => ({ code: r.model_code, point: r.point, group: r.kit_group, description: r.description })), effectiveDate: c.day, now: c.day <= todayKey(),
    kits: { total: kits.length, kitted: kits.filter(k => k.kitted).map(k => k.code), update: kits.filter(k => !k.kitted).length } };
}

function apply(db, ch, username) {
  const codes = JSON.parse(ch.codes), c = { codes, oldM: ch.old_material };
  const kitsUpdated = [], kitsKept = [], kitsFrozen = [];
  // Không cập nhật kit đã lập KH: chốt BOM cũ cho kit chưa mở trước khi đổi BOM gốc.
  if (!ch.update_planned) for (const k of plannedKits(db, codes)) for (const grp of ['VLN', 'HV']) {
    if (db.prepare('SELECT 1 FROM kit_item WHERE kit_id = ? AND grp = ? LIMIT 1').get(k.id, grp)) continue;
    try { ensureItems(db, k, grp); if (!kitsFrozen.includes(k.code)) kitsFrozen.push(k.code); } catch { /* chưa đủ BOM thì để nguyên */ }
  }
  const olds = rowsOf(db, codes, ch.old_material);
  if (!olds.length) throw fail(`${ch.old_material} không còn trong BOM của ${codes.join(', ')} — ECN ${ch.ecn} không áp dụng được.`);
  const up = db.prepare('UPDATE bom SET material = ?, description = ?, point = ? WHERE id = ?');
  for (const r of olds) up.run(ch.new_material, ch.new_description || r.description, ch.new_point ?? r.point, r.id);
  rebuildVln(db, [ch.model]);
  if (ch.update_planned) for (const k of plannedKits(db, codes)) {
    const its = db.prepare('SELECT * FROM kit_item WHERE kit_id = ? AND material = ?').all(k.id, ch.old_material);
    if (!its.length) continue;
    if (its.some(i => i.kitted > 0)) { kitsKept.push(k.code); continue; }
    for (const i of its) {
      if (i.grp === 'HV' && !codes.includes(i.model_code)) continue;
      const base = olds.find(o => o.model_code === (i.model_code || codes[0]))?.point || ch.old_point;
      const req = ch.new_point && base ? r3(i.required / base * ch.new_point) : i.required;
      db.prepare('UPDATE kit_item SET material = ?, description = ?, required = ? WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?')
        .run(ch.new_material, ch.new_description || i.description, req, k.id, i.grp, i.model_code, ch.old_material);
    }
    kitsUpdated.push(k.code);
  }
  const result = { bomRows: olds.length, kitsUpdated, kitsKept, kitsFrozen };
  db.prepare("UPDATE bom_change SET status = 'applied', applied_by = ?, applied_at = datetime('now'), result = ? WHERE id = ?").run(username, JSON.stringify(result), ch.id);
  audit(db, username, 'bom.change.apply', { ecn: ch.ecn, model: ch.model, from: ch.old_material, to: ch.new_material, ...result });
  return result;
}

export function createChange(db, body, user) {
  if (!canChangeBom(user)) throw fail('Chỉ Quản trị / Trưởng bộ phận Kho được change code BOM.', 403);
  ensureBomChangeSchema(db);
  return tx(db, () => {
    const c = check(db, body);
    const id = Number(db.prepare(`INSERT INTO bom_change(ecn, model, codes, old_material, new_material, new_description, old_point, new_point, reason, note, effective_date, update_planned, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(c.ecn, c.model, JSON.stringify(c.codes), c.oldM, c.newM, c.newDesc, c.oldPoint, c.newPoint, c.reason, c.note, c.day, c.updatePlanned ? 1 : 0, user.username).lastInsertRowid);
    audit(db, user.username, 'bom.change', { ecn: c.ecn, model: c.model, codes: c.codes, from: c.oldM, to: c.newM, day: c.day, updatePlanned: c.updatePlanned });
    if (c.day > todayKey()) return { ok: true, id, status: 'scheduled', message: `ECN ${c.ecn}: ${c.oldM} → ${c.newM} chờ áp dụng ${c.day.split('-').reverse().join('/')}` };
    const r = apply(db, db.prepare('SELECT * FROM bom_change WHERE id = ?').get(id), user.username);
    return { ok: true, id, status: 'applied', ...r, message: `ECN ${c.ecn}: đã đổi ${c.oldM} → ${c.newM} ở ${r.bomRows} Model Code${r.kitsUpdated.length ? ` · cập nhật ${r.kitsUpdated.length} kit` : ''}${r.kitsKept.length ? ` · ${r.kitsKept.length} kit đã soạn mã cũ giữ nguyên` : ''}` };
  });
}

export function cancelChange(db, { id, reason }, user) {
  if (!canChangeBom(user)) throw fail('Chỉ Quản trị / Trưởng bộ phận Kho được hủy change code.', 403);
  ensureBomChangeSchema(db);
  return tx(db, () => {
    const ch = db.prepare('SELECT * FROM bom_change WHERE id = ?').get(Number(id));
    if (!ch) throw fail('Không tìm thấy ECN.', 404);
    if (ch.status !== 'scheduled') throw fail(`ECN ${ch.ecn} đã ${ch.status === 'applied' ? 'áp dụng' : 'hủy'}, không hủy được.`);
    if (!t(reason)) throw fail('Nhập lý do hủy.');
    db.prepare("UPDATE bom_change SET status = 'cancelled', cancelled_by = ?, cancelled_at = datetime('now'), cancel_reason = ? WHERE id = ?").run(user.username, t(reason).slice(0, 200), ch.id);
    audit(db, user.username, 'bom.change.cancel', { ecn: ch.ecn, reason: t(reason) });
    return { ok: true, message: `Đã hủy ECN ${ch.ecn}.` };
  });
}

// Cron: áp dụng các ECN đến ngày. Lỗi 1 ECN (mã cũ đã bị sửa tay…) ghi vào result, không chặn ECN khác.
export function applyDueChanges(db) {
  ensureBomChangeSchema(db);
  let n = 0;
  for (const ch of db.prepare("SELECT * FROM bom_change WHERE status = 'scheduled' AND effective_date <= ? ORDER BY effective_date, id").all(todayKey())) {
    try { tx(db, () => apply(db, ch, 'system')); n++; }
    catch (e) { db.prepare("UPDATE bom_change SET status = 'failed', result = ? WHERE id = ?").run(JSON.stringify({ error: e.message }), ch.id); }
  }
  return n;
}

const view = r => ({ id: r.id, ecn: r.ecn, model: r.model, codes: JSON.parse(r.codes), oldMaterial: r.old_material, newMaterial: r.new_material, newDescription: r.new_description || '',
  oldPoint: r.old_point, newPoint: r.new_point, reason: r.reason, reasonLabel: CHANGE_REASONS[r.reason] || r.reason, note: r.note || '', effectiveDate: r.effective_date,
  updatePlanned: !!r.update_planned, status: r.status, result: r.result ? JSON.parse(r.result) : null, createdBy: r.created_by, createdAt: r.created_at,
  appliedBy: r.applied_by, appliedAt: r.applied_at, cancelledBy: r.cancelled_by, cancelledAt: r.cancelled_at, cancelReason: r.cancel_reason || '' });

// Lịch sử: lọc theo chữ (ECN, Model, Model Code, mã trước / sau), trạng thái, khoảng ngày áp dụng.
export function listChanges(db, { q = '', status = '', from = '', to = '' } = {}) {
  ensureBomChangeSchema(db);
  const where = [], args = [];
  if (q) { where.push('(ecn LIKE ? OR model LIKE ? OR codes LIKE ? OR old_material LIKE ? OR new_material LIKE ?)'); for (let i = 0; i < 5; i++) args.push(`%${q}%`); }
  if (status) { where.push('status = ?'); args.push(status); }
  if (from) { where.push('effective_date >= ?'); args.push(from); }
  if (to) { where.push('effective_date <= ?'); args.push(to); }
  const rows = db.prepare(`SELECT * FROM bom_change ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY effective_date DESC, id DESC LIMIT 1000`).all(...args).map(view);
  return { rows, reasons: CHANGE_REASONS };
}
// Cảnh báo công khai: ECN chờ áp dụng + đã áp dụng trong 7 ngày.
export function changeAlerts(db) {
  ensureBomChangeSchema(db);
  const since = new Date(Date.parse(`${todayKey()}T00:00:00Z`) - 7 * 864e5).toISOString().slice(0, 10);
  return db.prepare("SELECT * FROM bom_change WHERE status = 'scheduled' OR (status IN ('applied','failed') AND effective_date >= ?) ORDER BY effective_date DESC, id DESC LIMIT 20").all(since).map(view);
}

export function bomChangeRoutes(db) {
  return [
    { method: 'GET', path: '/api/bom/changes', handler: ({ query }) => listChanges(db, { q: t(query.get('q')), status: t(query.get('status')), from: t(query.get('from')), to: t(query.get('to')) }) },
    { method: 'GET', path: '/api/bom/changes/alerts', handler: () => ({ rows: changeAlerts(db) }) },
    { method: 'POST', path: '/api/bom/change/preview', handler: ({ body, user }) => { if (!canChangeBom(user)) throw fail('Chỉ Quản trị / Trưởng bộ phận Kho được change code BOM.', 403); return previewChange(db, body || {}); } },
    { method: 'POST', path: '/api/bom/change', handler: ({ body, user }) => { assertBomEditable(db); return createChange(db, body || {}, user); } },
    { method: 'POST', path: '/api/bom/change/cancel', handler: ({ body, user }) => cancelChange(db, body || {}, user) }
  ];
}
