// Bổ sung cho Planner: chuyển kitting hàng loạt, hoàn tác (khi kho chưa kitting), Line theo tuần, thêm/sửa/xóa line.
import { tx, fail, audit, normalizePo } from './db.mjs';
import { todayKey, addDays, shifts, modelList } from './planning.mjs';
import { isCancelled } from './po-sync.mjs';

export function ensurePlanExtraSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS plan_undo (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, label TEXT NOT NULL, data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  try { db.exec('ALTER TABLE line_params ADD COLUMN pending_day TEXT'); } catch { /* đã có */ }
  try { db.exec('ALTER TABLE kit_order ADD COLUMN plan_line TEXT'); } catch { /* đã có */ }   // Line dự kiến (nhập kế hoạch từ Excel)
}
const pending = k => k.vln_status === 'pending' && k.hv_status === 'pending';
const placeholders = n => Array(n).fill('?').join(',');

/* ---------- hoàn tác ---------- */
// Phạm vi của một thao tác: các PO bị đụng tới + mọi kit trong các ngày bị đụng tới.
export function scopeOf(db, items = [], days = []) {
  const pos = new Set(), d = new Set(days.filter(Boolean));
  for (const it of items) {
    if (it.type === 'po') pos.add(normalizePo(it.id));
    else {
      const k = db.prepare('SELECT plan_day FROM kit_order WHERE id = ?').get(Number(it.id));
      if (k?.plan_day) d.add(k.plan_day);
      db.prepare('SELECT po_key FROM kit_order_po WHERE kit_id = ?').all(Number(it.id)).forEach(r => pos.add(r.po_key));
    }
  }
  return { pos: [...pos], core: [...pos], days: [...d] };
}
function capture(db, scope) {
  const ids = new Set();
  if (scope.pos.length) db.prepare(`SELECT DISTINCT kit_id FROM kit_order_po WHERE po_key IN (${placeholders(scope.pos.length)})`).all(...scope.pos).forEach(r => ids.add(r.kit_id));
  if (scope.days.length) db.prepare(`SELECT id FROM kit_order WHERE plan_day IN (${placeholders(scope.days.length)})`).all(...scope.days).forEach(r => ids.add(r.id));
  const kits = [...ids].map(id => ({ ...db.prepare('SELECT * FROM kit_order WHERE id = ?').get(id), pos: db.prepare('SELECT po_key FROM kit_order_po WHERE kit_id = ?').all(id).map(r => r.po_key) }));
  const pos = new Set(scope.pos); kits.forEach(k => k.pos.forEach(p => pos.add(p)));
  return { pos: [...pos], core: scope.core || scope.pos, kits: kits.filter(k => pending(k)) };
}
export function withUndo(db, username, label, scope, fn) {
  const snap = capture(db, scope);
  const result = fn();
  db.prepare('INSERT INTO plan_undo(username, label, data) VALUES (?,?,?)').run(username, label, JSON.stringify(snap));
  db.prepare('DELETE FROM plan_undo WHERE username = ? AND id NOT IN (SELECT id FROM plan_undo WHERE username = ? ORDER BY id DESC LIMIT 20)').run(username, username);
  return { ...result, undo: label };
}
export function lastUndo(db, username) {
  const r = db.prepare('SELECT label, created_at FROM plan_undo WHERE username = ? ORDER BY id DESC LIMIT 1').get(username || '');
  return r ? { label: r.label, at: r.created_at } : null;
}
export function undo(db, username) {
  return tx(db, () => {
    const r = db.prepare('SELECT * FROM plan_undo WHERE username = ? ORDER BY id DESC LIMIT 1').get(username);
    if (!r) throw fail('Không còn thao tác nào để hoàn tác.');
    const snap = JSON.parse(r.data);
    const cur = snap.pos.length ? db.prepare(`SELECT DISTINCT k.* FROM kit_order k JOIN kit_order_po x ON x.kit_id = k.id WHERE x.po_key IN (${placeholders(snap.pos.length)})`).all(...snap.pos) : [];
    // Chỉ chặn khi chính các PO của thao tác đã được kho kitting; kit khác cùng ngày đã kitting thì giữ nguyên.
    const core = new Set(snap.core || snap.pos);
    const started = cur.filter(k => !pending(k) && db.prepare('SELECT po_key FROM kit_order_po WHERE kit_id = ?').all(k.id).some(r => core.has(r.po_key)));
    if (started.length) throw fail(`Kho đã bắt đầu kitting ${started.map(k => k.code).join(', ')} — không hoàn tác được.`);
    for (const k of cur.filter(pending)) { db.prepare('DELETE FROM kit_item WHERE kit_id = ?').run(k.id); db.prepare('DELETE FROM kit_order_po WHERE kit_id = ?').run(k.id); db.prepare('DELETE FROM kit_order WHERE id = ?').run(k.id); }
    const ins = db.prepare("INSERT INTO kit_order(id, code, kind, model_code, plan_day, seq, plan_line, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)");
    for (const k of snap.kits) {
      if (db.prepare('SELECT 1 FROM kit_order WHERE id = ? OR code = ?').get(k.id, k.code)) continue;
      ins.run(k.id, k.code, k.kind, k.model_code, k.plan_day, k.seq, k.plan_line ?? null, k.created_by, k.created_at);
      for (const p of k.pos) if (!db.prepare('SELECT 1 FROM kit_order_po WHERE po_key = ?').get(p)) db.prepare('INSERT INTO kit_order_po(kit_id, po_key) VALUES (?, ?)').run(k.id, p);
    }
    db.prepare('DELETE FROM plan_undo WHERE id = ?').run(r.id);
    audit(db, username, 'plan.undo', r.label);
    return { ok: true, message: `Đã hoàn tác: ${r.label}` };
  });
}

/* ---------- chuyển kitting hàng loạt ---------- */
export function batchMove(db, { items, day, position = 'end' }, username) {
  if (!Array.isArray(items) || !items.length) throw fail('Chưa chọn PO.');
  if (day !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw fail('Chọn ngày kitting.');
  // Xếp vào ngày kitting theo Plan Start sớm nhất trước (PO gấp lên trước), không theo thứ tự tích chọn.
  const startOf = it => it.type === 'po'
    ? db.prepare('SELECT plan_start s FROM po WHERE po_key = ?').get(normalizePo(it.id))?.s
    : db.prepare('SELECT MIN(p.plan_start) s FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = ?').get(Number(it.id))?.s;
  items = items.map(it => ({ it, s: startOf(it) || '9999' })).sort((a, b) => a.s.localeCompare(b.s)).map(x => x.it);
  return tx(db, () => {
    const moved = [];
    for (const it of items) {
      if (it.type === 'po') {
        const key = normalizePo(it.id);
        const p = db.prepare('SELECT * FROM po WHERE po_key = ?').get(key);
        if (!p) throw fail('Có PO không còn trong dữ liệu. Tải lại.', 409);
        if (day !== null && isCancelled(p)) throw fail(`PO ${p.po_no} đã hủy (Cancel), không lập kế hoạch được.`);
        if (day !== null && p.po_type === 'LOAD') throw fail(`${p.po_no} là PO Load thành phẩm: không kitting riêng, chọn cùng PO / Kit thật cùng Model Code rồi bấm Gộp.`);
        if (db.prepare('SELECT 1 FROM kit_order_po WHERE po_key = ?').get(key)) throw fail(`PO ${p.po_no} đã được lập kế hoạch. Tải lại.`, 409);
        if (day === null) continue;
        const res = db.prepare("INSERT INTO kit_order(code, kind, model_code, plan_day, seq, created_by) VALUES (?, 'single', ?, ?, 0, ?)").run(p.po_no, p.model_code, day, username);
        db.prepare('INSERT INTO kit_order_po(kit_id, po_key) VALUES (?, ?)').run(res.lastInsertRowid, key);
        moved.push(Number(res.lastInsertRowid));
        continue;
      }
      const k = db.prepare('SELECT * FROM kit_order WHERE id = ?').get(Number(it.id));
      if (!k) throw fail('Kit PO không còn tồn tại. Tải lại.', 409);
      if (!pending(k)) throw fail(`${k.code} kho đã bắt đầu kitting, không chuyển được.`);
      if (day === null) {
        if (k.kind === 'single') { db.prepare('DELETE FROM kit_item WHERE kit_id = ?').run(k.id); db.prepare('DELETE FROM kit_order WHERE id = ?').run(k.id); }
        else db.prepare('UPDATE kit_order SET plan_day = NULL, seq = 0 WHERE id = ?').run(k.id);
        continue;
      }
      db.prepare("UPDATE kit_order SET plan_day = ?, updated_at = datetime('now') WHERE id = ?").run(day, k.id);
      moved.push(k.id);
    }
    if (day) {
      const others = db.prepare('SELECT id FROM kit_order WHERE plan_day = ? ORDER BY seq, id').all(day).map(r => r.id).filter(id => !moved.includes(id));
      const order = position === 'start' ? [...moved, ...others] : [...others, ...moved];
      order.forEach((id, i) => db.prepare('UPDATE kit_order SET seq = ? WHERE id = ?').run(i, id));
    }
    audit(db, username, 'plan.batch', { day, n: items.length });
    return { ok: true, count: items.length, message: day ? `Đã chuyển ${items.length} thẻ sang kitting ${day.slice(8, 10)}/${day.slice(5, 7)}` : `Đã bỏ kế hoạch ${items.length} thẻ` };
  });
}

/* ---------- Line theo tuần ---------- */
export function weekStart(day) {
  const [y, m, d] = String(day || todayKey()).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d)), dow = (dt.getUTCDay() + 6) % 7;
  return addDays(dt.toISOString().slice(0, 10), -dow);
}
const shiftList = (db, shift) => shift === 'all' ? shifts(db) : [shift];
export function getWeek(db, start, shift) {
  start = weekStart(start);
  const sh = shiftList(db, shift || shifts(db)[0]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const lines = db.prepare('SELECT name, active FROM lines ORDER BY active DESC, sort_order, name').all();
  const rows = db.prepare(`SELECT work_date, shift, line, model FROM line_assign WHERE work_date BETWEEN ? AND ? AND shift IN (${placeholders(sh.length)})`).all(days[0], days[6], ...sh);
  const cells = {};
  for (const r of rows) {
    const c = ((cells[r.line] ||= {})[r.work_date] ||= { models: {} });
    c.models[r.shift] = r.model;
  }
  for (const line of Object.keys(cells)) for (const day of Object.keys(cells[line])) {
    const c = cells[line][day], vals = sh.map(s => c.models[s] || '');
    c.model = vals[0]; c.mixed = new Set(vals).size > 1;
  }
  return { start, days, shift: shift || sh[0], shifts: shifts(db), lines, cells, models: modelList(db), today: todayKey() };
}
export function saveWeek(db, { shift, cells }, username) {
  if (!Array.isArray(cells) || !cells.length) throw fail('Không có thay đổi.');
  const sh = shiftList(db, shift), lines = new Set(db.prepare('SELECT name FROM lines').all().map(r => r.name));
  return tx(db, () => {
    const del = db.prepare('DELETE FROM line_assign WHERE work_date = ? AND shift = ? AND line = ?');
    const ins = db.prepare('INSERT INTO line_assign(work_date, shift, line, model, updated_by) VALUES (?,?,?,?,?)');
    for (const c of cells) {
      if (!lines.has(c.line)) throw fail(`Line ${c.line} không hợp lệ.`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.day)) throw fail('Ngày không hợp lệ.');
      for (const s of sh) { del.run(c.day, s, c.line); if (String(c.model || '').trim()) ins.run(c.day, s, c.line, c.model, username); }
    }
    audit(db, username, 'line.week', { shift, n: cells.length });
    return { ok: true, count: cells.length };
  });
}
export function copyWeek(db, { start, shift }, username) {
  start = weekStart(start);
  const sh = shiftList(db, shift), from = addDays(start, -7);
  const rows = db.prepare(`SELECT work_date, shift, line, model FROM line_assign WHERE work_date BETWEEN ? AND ? AND shift IN (${placeholders(sh.length)})`).all(from, addDays(from, 6), ...sh);
  if (!rows.length) throw fail('Tuần trước chưa có kế hoạch Line.');
  return tx(db, () => {
    db.prepare(`DELETE FROM line_assign WHERE work_date BETWEEN ? AND ? AND shift IN (${placeholders(sh.length)})`).run(start, addDays(start, 6), ...sh);
    const ins = db.prepare('INSERT INTO line_assign(work_date, shift, line, model, updated_by) VALUES (?,?,?,?,?)');
    for (const r of rows) ins.run(addDays(r.work_date, 7), r.shift, r.line, r.model, username);
    audit(db, username, 'line.week.copy', { start, shift });
    return { ok: true, count: rows.length };
  });
}

/* ---------- thêm / sửa / xóa line ---------- */
export function manageLine(db, { action, name, newName }, username) {
  name = String(name || '').trim(); newName = String(newName || '').trim();
  return tx(db, () => {
    if (action === 'add') {
      if (!name || name.length > 40) throw fail('Nhập tên Line.');
      const ex = db.prepare('SELECT * FROM lines WHERE name = ?').get(name);
      if (ex?.active) throw fail(`${name} đã có.`);
      if (ex) db.prepare('UPDATE lines SET active = 1 WHERE name = ?').run(name);
      else db.prepare('INSERT INTO lines(name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM lines))').run(name);
      audit(db, username, 'line.add', name);
      return { ok: true, message: `Đã thêm ${name}` };
    }
    if (!db.prepare('SELECT 1 FROM lines WHERE name = ?').get(name)) throw fail('Không tìm thấy Line.', 404);
    if (action === 'rename') {
      if (!newName || newName.length > 40) throw fail('Nhập tên mới.');
      if (db.prepare('SELECT 1 FROM lines WHERE name = ?').get(newName)) throw fail(`${newName} đã tồn tại.`);
      for (const [t, c] of [['po', 'fixed_line'], ['users', 'line'], ['lines', 'name'], ['line_assign', 'line'], ['line_params', 'line'], ['kit_order', 'line'], ['material_request', 'line'], ['kit_txn', 'line']]) {
        try { db.prepare(`UPDATE ${t} SET ${c} = ? WHERE ${c} = ?`).run(newName, name); } catch { /* bảng chưa có */ }
      }
      audit(db, username, 'line.rename', { name, newName });
      return { ok: true, message: `Đã đổi ${name} → ${newName}` };
    }
    if (action === 'delete') {
      const busy = db.prepare("SELECT COUNT(*) n FROM kit_order WHERE line = ? AND vln_status = 'delivered'").get(name).n;
      db.prepare('DELETE FROM line_assign WHERE line = ? AND work_date >= ?').run(name, todayKey());
      const used = busy || db.prepare('SELECT COUNT(*) n FROM line_assign WHERE line = ?').get(name).n || db.prepare("SELECT COUNT(*) n FROM kit_txn WHERE line = ?").get(name).n;
      if (used) db.prepare('UPDATE lines SET active = 0 WHERE name = ?').run(name);
      else { db.prepare('DELETE FROM line_params WHERE line = ?').run(name); db.prepare('DELETE FROM lines WHERE name = ?').run(name); }
      audit(db, username, 'line.delete', name);
      return { ok: true, message: used ? `${name} đã ngừng (giữ lịch sử${busy ? `, còn ${busy} PO trên line` : ''})` : `Đã xóa ${name}` };
    }
    throw fail('Thao tác không hợp lệ.');
  });
}
