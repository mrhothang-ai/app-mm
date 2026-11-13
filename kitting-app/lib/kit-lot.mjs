// Giao 1 phần + giao bù theo đợt (kiểu giao hàng còn nợ / backorder):
//  - Lần giao Line đầu = đợt 1 (Line nhận bằng quét QR phiếu kitting, receipt.mjs). Mã thiếu thành nợ.
//  - OP kho soạn bù trong tab Kitting (bảng kit_bu = số đã soạn, chưa giao). Kho bấm Giao bù → 1 đợt mới (kit_lot, số <Kit>-B2, B3…)
//    gồm nhiều mã (kit_lot_item), cộng vào kit_item.delivered, trừ số đã soạn.
//  - Leader giao nhận ký nhận từng đợt (chọn nhiều đợt, ký 1 lần: Mã NV + MK cấp 2) hoặc từ chối có lý do → Kho xử lý → đợt về Chờ nhận.
//  - Line xác nhận nhận PO (đợt 1) sau khi đã có đợt bù: các đợt đang chờ nhận được nhận luôn (số Đã giao trên màn nhận đã gồm giao bù).
import { tx, fail, audit } from './db.mjs';
import { stockOf, stockStatus } from './erp-stock.mjs';

export const SHORT_REASONS = { STOCK: 'Hết tồn / tồn không đủ', WAIT: 'Chờ hàng về', URGENT: 'Line cần gấp, giao trước', QUALITY: 'Vật liệu lỗi, chờ đổi', OTHER: 'Khác' };
export const LOT_STATUS = { pending: 'Chờ Line nhận', received: 'Đã nhận', rejected: 'Line từ chối' };
const r3 = n => Math.round(Number(n) * 1000) / 1000;
const t = v => String(v ?? '').trim();
const isWhole = n => Math.abs(Number(n) - Math.round(Number(n))) < 1e-9;
const capOf = debt => isWhole(debt) ? Number(debt) : Math.ceil(debt);   // giao bù tối đa = nợ làm tròn lên (mã định lượng lẻ)
const ikey = (grp, code, material) => `${grp}\u001f${code || ''}\u001f${material}`;

export function ensureLotSchema(db) {
  const had = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'kit_lot'").get();
  db.exec(`
  CREATE TABLE IF NOT EXISTS kit_lot (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kit_id INTEGER NOT NULL, kit_code TEXT NOT NULL, line TEXT, seq INTEGER NOT NULL, lot_no TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), src_txn INTEGER,
    signer TEXT, signer_name TEXT, signed_at TEXT, signed_by TEXT, reason TEXT, note TEXT, kho_note TEXT, kho_by TEXT, kho_at TEXT);
  CREATE TABLE IF NOT EXISTS kit_lot_item (
    lot_id INTEGER NOT NULL, grp TEXT NOT NULL, kit_group TEXT, model_code TEXT NOT NULL DEFAULT '', material TEXT NOT NULL, description TEXT, qty REAL NOT NULL,
    PRIMARY KEY (lot_id, grp, model_code, material));
  CREATE TABLE IF NOT EXISTS kit_bu (
    kit_id INTEGER NOT NULL, grp TEXT NOT NULL, model_code TEXT NOT NULL DEFAULT '', material TEXT NOT NULL, qty REAL NOT NULL,
    username TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (kit_id, grp, model_code, material));
  CREATE INDEX IF NOT EXISTS kit_lot_kit ON kit_lot(kit_id);
  CREATE INDEX IF NOT EXISTS kit_lot_status ON kit_lot(status);`);
  if (!had) backfillLots(db);
}
// Lần giao bù có từ trước (kit_txn debt_settle) → mỗi lần 1 đợt; Line đã xác nhận nhận PO sau lần bù đó thì coi như đã nhận.
// Cùng câu lệnh với migration 1794700000_mm_kit_lot.js.
export function backfillLots(db) {
  db.exec(`
  INSERT INTO kit_lot(kit_id, kit_code, line, seq, lot_no, status, created_by, created_at, src_txn)
    SELECT k.id, t.kit_code, COALESCE(t.line, k.line), 1 + ROW_NUMBER() OVER (PARTITION BY t.kit_code ORDER BY t.id), t.kit_code || '-B' || (1 + ROW_NUMBER() OVER (PARTITION BY t.kit_code ORDER BY t.id)),
      'pending', t.username, t.created_at, t.id
    FROM kit_txn t JOIN kit_order k ON k.code = t.kit_code WHERE t.type = 'debt_settle' AND NOT EXISTS (SELECT 1 FROM kit_lot l WHERE l.src_txn = t.id);
  INSERT OR IGNORE INTO kit_lot_item(lot_id, grp, kit_group, model_code, material, description, qty)
    SELECT l.id, t.grp, t.kit_group, COALESCE(t.ref_code, ''), t.material, (SELECT i.description FROM kit_item i WHERE i.kit_id = l.kit_id AND i.material = t.material LIMIT 1), t.qty
    FROM kit_lot l JOIN kit_txn t ON t.id = l.src_txn WHERE NOT EXISTS (SELECT 1 FROM kit_lot_item x WHERE x.lot_id = l.id);`);
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'kit_receipt'").get())
    db.exec(`UPDATE kit_lot SET status = 'received', signer = (SELECT r.signer FROM kit_receipt r WHERE r.kit_id = kit_lot.kit_id), signer_name = (SELECT r.signer_name FROM kit_receipt r WHERE r.kit_id = kit_lot.kit_id),
      signed_at = (SELECT r.at FROM kit_receipt r WHERE r.kit_id = kit_lot.kit_id), signed_by = 'nhận PO'
      WHERE status = 'pending' AND EXISTS (SELECT 1 FROM kit_receipt r WHERE r.kit_id = kit_lot.kit_id AND r.status = 'received' AND r.at >= kit_lot.created_at)`);
}

const lotView = (db, l) => ({ id: l.id, lotNo: l.lot_no, seq: l.seq, kitId: l.kit_id, kit: l.kit_code, line: l.line || '', status: l.status, createdBy: l.created_by || '', createdAt: l.created_at,
  signer: l.signer || '', signerName: l.signer_name || '', signedAt: l.signed_at || '', signedBy: l.signed_by || '', reason: l.reason || '', note: l.note || '', khoNote: l.kho_note || '', khoBy: l.kho_by || '', khoAt: l.kho_at || '',
  items: db.prepare('SELECT * FROM kit_lot_item WHERE lot_id = ? ORDER BY CASE kit_group WHEN \'REAR\' THEN 0 WHEN \'VLDT\' THEN 1 ELSE 2 END, model_code, material').all(l.id)
    .map(i => ({ grp: i.grp, group: i.kit_group || '', code: i.model_code, material: i.material, description: i.description || '', qty: r3(i.qty) })) });
export function lotsOfKit(db, kitId) {
  ensureLotSchema(db);
  return db.prepare('SELECT * FROM kit_lot WHERE kit_id = ? ORDER BY seq').all(Number(kitId)).map(l => lotView(db, l));
}
// Tổng giao bù + số đợt theo từng mã của kit (key grp|code|material).
export function lotStats(db, kitId) {
  ensureLotSchema(db);
  const m = new Map();
  for (const r of db.prepare(`SELECT i.grp, i.model_code, i.material, SUM(i.qty) q, COUNT(*) n, SUM(l.status <> 'received') open FROM kit_lot_item i JOIN kit_lot l ON l.id = i.lot_id WHERE l.kit_id = ? GROUP BY i.grp, i.model_code, i.material`).all(Number(kitId)))
    m.set(ikey(r.grp, r.model_code, r.material), { bu: r3(r.q), n: r.n, open: r.open });
  return m;
}
export const lotKey = ikey;
// Số đợt bù chờ nhận / bị từ chối của kit.
export function lotCount(db, kitId) {
  ensureLotSchema(db);
  const r = db.prepare("SELECT SUM(status = 'pending') p, SUM(status = 'rejected') x, COUNT(*) n FROM kit_lot WHERE kit_id = ?").get(Number(kitId));
  return { pending: r.p || 0, rejected: r.x || 0, total: r.n || 0 };
}

/* ---------- Kho giao bù (1 đợt nhiều mã) ---------- */
// items: [{ grp, code, material, qty }]. Số lẻ được (mã định lượng gam / mét), tối đa = nợ làm tròn lên;
// giao ≥ nợ thì định mức kit = số thực đã cấp (hết nợ) và ghi kit_txn 'round'.
export function createLot(db, kit, input, user, logTxn) {
  ensureLotSchema(db);
  const list = (Array.isArray(input) ? input : []).filter(i => Number(i.qty) > 0);
  if (!list.length) throw fail('Nhập số giao bù cho ít nhất 1 mã.');
  const seq = (db.prepare('SELECT MAX(seq) s FROM kit_lot WHERE kit_id = ?').get(kit.id).s || 1) + 1, lotNo = `${kit.code}-B${seq}`;
  const lotId = Number(db.prepare('INSERT INTO kit_lot(kit_id, kit_code, line, seq, lot_no, created_by) VALUES (?,?,?,?,?,?)').run(kit.id, kit.code, kit.line, seq, lotNo, user).lastInsertRowid
    ?? db.prepare('SELECT id FROM kit_lot WHERE kit_id = ? AND seq = ?').get(kit.id, seq).id);
  const out = [], seen = new Set();
  for (const x of list) {
    const grp = t(x.grp), code = t(x.code), material = t(x.material), k = ikey(grp, code, material);
    if (seen.has(k)) throw fail(`${material} nhập 2 lần.`); seen.add(k);
    const it = db.prepare('SELECT * FROM kit_item WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?').get(kit.id, grp, code, material);
    if (!it) throw fail(`Không tìm thấy mã nợ ${material}.`);
    const q = r3(x.qty), debt = r3(it.required - it.delivered), cap = capOf(debt);
    if (debt <= 0) throw fail(`${material} đã hết nợ.`);
    if (!Number.isFinite(q) || q <= 0 || q > cap + 1e-9) throw fail(`${material}: số giao bù phải lớn hơn 0 và không quá ${cap}.`);
    const clear = q >= debt - 1e-9;
    db.prepare(`UPDATE kit_item SET kitted = kitted + ?, delivered = delivered + ?${clear ? ', required = delivered + ?' : ''} WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?`)
      .run(...(clear ? [q, q, q] : [q, q]), kit.id, grp, code, material);
    logTxn(db, { kitCode: kit.code, type: 'debt_settle', grp, kitGroup: it.kit_group, material, qty: q, ref: code, line: kit.line, note: lotNo, user });
    if (clear && q > debt + 1e-9) logTxn(db, { kitCode: kit.code, type: 'round', grp, kitGroup: it.kit_group, material, qty: r3(q - debt), ref: code, line: kit.line, note: `Định mức ${r3(it.required)} → cấp ${r3(it.delivered + q)}`, user });
    db.prepare('INSERT INTO kit_lot_item(lot_id, grp, kit_group, model_code, material, description, qty) VALUES (?,?,?,?,?,?,?)').run(lotId, grp, it.kit_group, code, material, it.description || '', q);
    // trừ số OP kho đã soạn bù
    const bu = db.prepare('SELECT qty FROM kit_bu WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?').get(kit.id, grp, code, material);
    if (bu) { const left = r3(bu.qty - q); if (left > 0 && !clear) db.prepare('UPDATE kit_bu SET qty = ? WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?').run(left, kit.id, grp, code, material); else db.prepare('DELETE FROM kit_bu WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?').run(kit.id, grp, code, material); }
    out.push({ material, q, left: clear ? 0 : r3(debt - q) });
  }
  audit(db, user, 'kit.lot', { kit: kit.code, lot: lotNo, line: kit.line, items: out.map(o => [o.material, o.q]) });
  return { lotNo, lotId, items: out };
}

/* ---------- OP kho soạn bù (tab Kitting) ---------- */
function debtKits(db, kitId) {
  return db.prepare(`SELECT DISTINCT k.* FROM kit_order k JOIN kit_item i ON i.kit_id = k.id WHERE k.vln_status = 'delivered' AND i.delivered < i.required - 1e-9 ${kitId ? 'AND k.id = ?' : ''} ORDER BY k.delivered_at`).all(...(kitId ? [Number(kitId)] : []));
}
function buItems(db, kit) {
  const prep = new Map(db.prepare('SELECT * FROM kit_bu WHERE kit_id = ?').all(kit.id).map(b => [ikey(b.grp, b.model_code, b.material), b]));
  const st = lotStats(db, kit.id);
  return db.prepare(`SELECT * FROM kit_item WHERE kit_id = ? AND delivered < required - 1e-9 ORDER BY CASE kit_group WHEN 'REAR' THEN 0 WHEN 'VLDT' THEN 1 ELSE 2 END, model_code, material`).all(kit.id).map(i => {
    const k = ikey(i.grp, i.model_code, i.material), b = prep.get(k), s = st.get(k);
    return { grp: i.grp, group: i.kit_group, code: i.model_code, material: i.material, description: i.description || '', required: r3(i.required), delivered: r3(i.delivered),
      debt: r3(i.required - i.delivered), cap: capOf(r3(i.required - i.delivered)), prepared: b ? r3(b.qty) : 0, preparedBy: b?.username || '', preparedAt: b?.updated_at || '', bu: s?.bu || 0, buN: s?.n || 0 };
  });
}
export function buList(db) {
  ensureLotSchema(db);
  const rows = debtKits(db).map(k => {
    const items = buItems(db, k), lc = lotCount(db, k.id);
    return { kitId: k.id, code: k.code, line: k.line, modelCode: k.model_code, deliveredAt: k.delivered_at, items: items.length, rear: items.filter(i => i.group === 'REAR').length,
      debt: r3(items.reduce((s, i) => s + i.debt, 0)), prepared: items.filter(i => i.prepared > 0).length, full: items.filter(i => i.prepared >= i.debt - 1e-9).length, lots: lc };
  });
  return { rows, kpi: { kits: rows.length, items: rows.reduce((s, r) => s + r.items, 0), prepared: rows.reduce((s, r) => s + r.prepared, 0) } };
}
export function buDetail(db, kitId) {
  ensureLotSchema(db);
  const kit = db.prepare('SELECT * FROM kit_order WHERE id = ?').get(Number(kitId));
  if (!kit) throw fail('Không tìm thấy PO / Kit.', 404);
  if (kit.vln_status !== 'delivered') throw fail(`${kit.code} chưa giao Line.`);
  const items = buItems(db, kit), st = stockOf(db, items.map(i => i.material));
  return { kit: { id: kit.id, code: kit.code, line: kit.line, modelCode: kit.model_code, deliveredAt: kit.delivered_at, deliveredBy: kit.delivered_by || '' }, stockAt: stockStatus(db).okAt || '',
    items: items.map(i => { const s = st.get(i.material); return { ...i, locs: s ? s.locs.slice(0, 4) : [], stock: s ? s.total : null, defaultLoc: s?.defaultLoc || '' }; }),
    lots: lotsOfKit(db, kit.id) };
}
// Lưu số đã soạn bù (chưa giao). 0 = xóa. Tối đa = nợ làm tròn lên.
export function saveBu(db, { kitId, items: input }, user) {
  ensureLotSchema(db);
  return tx(db, () => {
    const kit = db.prepare('SELECT * FROM kit_order WHERE id = ?').get(Number(kitId));
    if (!kit || kit.vln_status !== 'delivered') throw fail('PO chưa giao Line, không có nợ để soạn bù.');
    let n = 0;
    for (const x of Array.isArray(input) ? input : []) {
      const grp = t(x.grp), code = t(x.code), material = t(x.material), q = r3(x.qty);
      const it = db.prepare('SELECT * FROM kit_item WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?').get(kit.id, grp, code, material);
      if (!it) throw fail(`Mã ${material} không thuộc kit này.`);
      const debt = r3(it.required - it.delivered);
      if (!Number.isFinite(q) || q < 0) throw fail(`${material}: số soạn bù không hợp lệ.`);
      if (q > capOf(debt) + 1e-9) throw fail(`${material}: soạn bù tối đa ${capOf(debt)} (đang nợ ${debt}).`);
      const cur = db.prepare('SELECT qty FROM kit_bu WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?').get(kit.id, grp, code, material);
      if (r3(cur?.qty || 0) === q) continue;
      if (q > 0) db.prepare(`INSERT INTO kit_bu(kit_id, grp, model_code, material, qty, username, updated_at) VALUES (?,?,?,?,?,?,datetime('now'))
        ON CONFLICT(kit_id, grp, model_code, material) DO UPDATE SET qty = excluded.qty, username = excluded.username, updated_at = excluded.updated_at`).run(kit.id, grp, code, material, q, user);
      else db.prepare('DELETE FROM kit_bu WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?').run(kit.id, grp, code, material);
      n++;
    }
    const items = buItems(db, kit);
    return { ok: true, changed: n, message: `${kit.code}: đã soạn bù ${items.filter(i => i.prepared > 0).length}/${items.length} mã` };
  });
}

/* ---------- Line ký nhận / từ chối đợt giao bù ---------- */
export function lotsForLine(db, line) {
  ensureLotSchema(db);
  const rows = db.prepare(`SELECT l.* FROM kit_lot l JOIN kit_order k ON k.id = l.kit_id WHERE k.vln_status = 'delivered' AND (? = '' OR l.line = ?)
    AND (l.status <> 'received' OR l.signed_at >= datetime('now', '-1 day')) ORDER BY CASE l.status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END, l.created_at DESC`).all(t(line), t(line))
    .map(l => lotView(db, l));
  return { line: t(line), rows, pending: rows.filter(r => r.status === 'pending').length, rejected: rows.filter(r => r.status === 'rejected').length };
}
function pickLots(db, ids, line) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean))];
  if (!list.length) throw fail('Chọn ít nhất 1 đợt giao bù.');
  if (list.length > 50) throw fail('Tối đa 50 đợt mỗi lần.');
  const lots = list.map(id => { const l = db.prepare('SELECT * FROM kit_lot WHERE id = ?').get(id); if (!l) throw fail('Không tìm thấy đợt giao bù.', 404); return l; });
  const lines = [...new Set(lots.map(l => l.line))];
  if (lines.length > 1) throw fail('Chỉ ký các đợt của cùng 1 Line.');
  if (line && lines[0] !== line) throw fail(`Đợt giao bù thuộc ${lines[0]}, không phải ${line}.`);
  for (const l of lots) if (l.status !== 'pending') throw fail(`${l.lot_no} ${l.status === 'received' ? `đã được ${l.signer_name || l.signer} nhận` : 'đang chờ Kho xử lý lần từ chối'}.`);
  return lots;
}
export function receiveLots(db, body, user, sign, RECEIPT_REASONS) {
  ensureLotSchema(db);
  const reject = !!body.reject, reason = t(body.reason), note = t(body.note).slice(0, 300);
  if (reject && !RECEIPT_REASONS[reason]) throw fail('Chọn lý do từ chối.');
  if (reject && reason === 'OTHER' && !note) throw fail('Lý do "Khác" cần ghi chú.');
  const lots = pickLots(db, body.ids, t(body.line));
  const s = sign(body.signer, body.pin2, lots[0].line); if (!s.ok) return s;
  return tx(db, () => {
    const up = db.prepare("UPDATE kit_lot SET status = ?, signer = ?, signer_name = ?, signed_at = datetime('now'), signed_by = ?, reason = ?, note = ? WHERE id = ?");
    for (const l of lots) up.run(reject ? 'rejected' : 'received', s.username, s.name || s.username, user, reject ? reason : null, note || null, l.id);
    audit(db, user, reject ? 'lot.reject' : 'lot.receive', { lots: lots.map(l => l.lot_no), line: lots[0].line, signer: s.username, reason: reject ? reason : undefined, note });
    const names = lots.map(l => l.lot_no).join(', ');
    return { ok: true, message: reject ? `Đã từ chối ${names} (${RECEIPT_REASONS[reason]}) — đã báo Kho.` : `${s.name || s.username} đã ký nhận ${lots.length} đợt giao bù: ${names}.` };
  });
}
// Line xác nhận nhận PO (đợt 1) → các đợt bù đang chờ nhận được nhận luôn.
export function receivePendingLots(db, kitId, signer, user) {
  ensureLotSchema(db);
  db.prepare("UPDATE kit_lot SET status = 'received', signer = ?, signer_name = ?, signed_at = datetime('now'), signed_by = ? WHERE kit_id = ? AND status = 'pending'")
    .run(signer.username, signer.name || signer.username, `${user} · nhận PO`, Number(kitId));
}
export function resolveLot(db, { id, note }, user) {
  ensureLotSchema(db);
  const l = db.prepare('SELECT * FROM kit_lot WHERE id = ?').get(Number(id)), n = t(note).slice(0, 300);
  if (!l) throw fail('Không tìm thấy đợt giao bù.', 404);
  if (l.status !== 'rejected') throw fail(`${l.lot_no} không ở trạng thái Line từ chối.`);
  if (!n) throw fail('Ghi chú Kho đã xử lý gì.');
  return tx(db, () => {
    db.prepare("UPDATE kit_lot SET status = 'pending', kho_note = ?, kho_by = ?, kho_at = datetime('now') WHERE id = ?").run(n, user, l.id);
    audit(db, user, 'lot.resolve', { lot: l.lot_no, line: l.line, note: n });
    return { ok: true, message: `${l.lot_no}: đã báo ${l.line} ký nhận lại.` };
  });
}
export function rejectedLots(db) {
  ensureLotSchema(db);
  return db.prepare("SELECT l.* FROM kit_lot l JOIN kit_order k ON k.id = l.kit_id WHERE l.status = 'rejected' AND k.vln_status = 'delivered' ORDER BY l.signed_at").all().map(l => lotView(db, l));
}
