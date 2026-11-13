// Giai đoạn 2–3: kitting 2 nhóm (VLN · Rear+VLĐT), giao line, nợ vật liệu, điều chỉnh kit, lịch sử; yêu cầu & cấp vật liệu có kiểm tra quy tắc.
import { tx, fail, getSettings, normalizePo } from './db.mjs';
import { modelOf, productionState, isCancelled, PO_TYPES } from './po-sync.mjs';
import { todayKey, currentShift, shifts, vnDay, kitQueueOrder, pendingOf, assertLoads, dropOrphanLoads } from './planning.mjs';
import { ensureBomSchema, vlnBom } from './bom.mjs';
import { stockOf, stockStatus } from './erp-stock.mjs';
import { createLot, ensureLotSchema, lotStats, lotCount, lotKey, SHORT_REASONS } from './kit-lot.mjs';
export { SHORT_REASONS };

export const REASONS = { PO_CANCEL: 'PO hủy / hoãn', URGENT: 'PO gấp cần vật liệu', DEFECT: 'Vật liệu lỗi', MODEL_CHANGE: 'Đổi Model / BOM', OTHER: 'Khác' };
export const TXN_LABEL = { kit: 'Kitting', deliver: 'Giao line', debt_settle: 'Giao bù nợ', short_confirm: 'Xong còn thiếu', transfer_out: 'Chuyển đi', transfer_in: 'Nhận chuyển', return: 'Trả kho', recall: 'Thu hồi từ line', issue: 'Cấp vật liệu', po_cancel: 'Gỡ PO hủy', round: 'Làm tròn định mức', start: 'Bắt đầu kitting', unstart: 'Về chưa làm' };
const GROUPS = { VLN: ['VLN'], HV: ['REAR', 'VLDT'] };

export function ensureKittingSchema(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS kit_item (
    kit_id INTEGER NOT NULL REFERENCES kit_order(id) ON DELETE CASCADE,
    grp TEXT NOT NULL CHECK (grp IN ('VLN','HV')),
    kit_group TEXT NOT NULL,
    model_code TEXT NOT NULL DEFAULT '',   -- '' với VLN; Rear/VLĐT ghi Model Code (Kit gộp nhiều code)
    material TEXT NOT NULL,
    description TEXT,
    required REAL NOT NULL,
    kitted REAL NOT NULL DEFAULT 0,
    delivered REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (kit_id, grp, model_code, material)
  );
  CREATE TABLE IF NOT EXISTS kit_txn (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kit_code TEXT, type TEXT NOT NULL, grp TEXT, kit_group TEXT, material TEXT,
    qty REAL NOT NULL DEFAULT 0, ref_code TEXT, line TEXT, reason_code TEXT, note TEXT, username TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS material_request (
    id INTEGER PRIMARY KEY AUTOINCREMENT, line TEXT NOT NULL, model TEXT, material TEXT, description TEXT, qty REAL NOT NULL,
    note TEXT, status TEXT NOT NULL, remain_sum REAL, spread REAL, pending REAL, available REAL, threshold REAL, pass INTEGER,
    requested_by TEXT, approved_by TEXT, approve_note TEXT, approved_at TEXT, issued_qty REAL, issued_by TEXT, issued_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  const cols = new Set(db.prepare('PRAGMA table_info(kit_order)').all().map(c => c.name));
  for (const [c, t] of [['line', 'TEXT'], ['delivered_at', 'TEXT'], ['delivered_by', 'TEXT']]) if (!cols.has(c)) db.exec(`ALTER TABLE kit_order ADD COLUMN ${c} ${t}`);
  if (!db.prepare('PRAGMA table_info(po)').all().some(c => c.name === 'span_time')) db.exec('ALTER TABLE po ADD COLUMN span_time TEXT');
  if (!db.prepare('PRAGMA table_info(line_params)').all().some(c => c.name === 'uph')) db.exec('ALTER TABLE line_params ADD COLUMN uph REAL');
  const rc = new Set(db.prepare('PRAGMA table_info(material_request)').all().map(c => c.name));
  for (const [c, t] of [['kind', "TEXT NOT NULL DEFAULT 'material'"], ['kit_id', 'INTEGER'], ['kit_code', 'TEXT']]) if (!rc.has(c)) db.exec(`ALTER TABLE material_request ADD COLUMN ${c} ${t}`);
  ensureBomSchema(db);
}

const r3 = n => Math.round(Number(n) * 1000) / 1000;
function loadKit(db, id) {
  const kit = db.prepare('SELECT * FROM kit_order WHERE id = ?').get(Number(id));
  if (!kit) throw fail('PO / Kit PO không còn tồn tại. Hãy tải lại.', 409);
  return kit;
}
function kitPos(db, kitId) {
  return db.prepare('SELECT p.* FROM kit_order_po k JOIN po p ON p.po_key = k.po_key WHERE k.kit_id = ? ORDER BY p.po_no').all(kitId);
}
// Line ấn định của kit = Line của PO nội bộ trong kit (gộp chỉ cho 1 Line) — '' nếu kit toàn PO thường.
export const isUnplan = p => p.po_type === 'UNPLAN';
export const fixedLineOf = pos => [...new Set(pos.map(p => p.fixed_line).filter(Boolean))][0] || '';
const internalOf = pos => pos.filter(p => p.po_type && p.po_type !== 'SAP').map(p => ({ po: p.po_no, type: p.po_type }));
export function kitHeader(db, kit, ro) {
  const pos = kitPos(db, kit.id), rank = ro?.rank ?? null;
  const live = pos.filter(p => !isCancelled(p)), states = new Set((live.length ? live : pos).map(productionState));
  return {
    id: kit.id, code: kit.code, kind: kit.kind, modelCode: kit.model_code, model: modelOf(db, kit.model_code, pos[0]?.basic_model),
    codes: [...new Set(pos.map(p => p.model_code))].sort(),
    planDay: kit.plan_day, rank, mrank: ro?.mrank ?? null, round: ro?.round ?? null, behind: !!ro?.behind, planStart: ro?.start || '', shortModel: !!ro?.short, line: kit.line || '', deliveredAt: kit.delivered_at || '', vln: kit.vln_status, hv: kit.hv_status,
    qty: pos.reduce((s, p) => s + p.plan_qty, 0), remain: pos.reduce((s, p) => s + p.remain_qty, 0),
    state: states.size === 1 ? [...states][0] : (states.has('running') || states.has('done') ? 'running' : 'waiting'),
    pos: pos.map(p => ({ po: p.po_no, modelCode: p.model_code, qty: p.plan_qty, remain: p.remain_qty, state: productionState(p) })),
    cancelled: pos.filter(isCancelled).map(p => p.po_no),
    fixedLine: fixedLineOf(pos), planLine: kit.plan_line || '', internal: internalOf(pos),
    notes: pos.filter(p => p.note).map(p => ({ po: p.po_no, note: p.note })),
    unplanRear: pos.filter(isUnplan).map(p => ({ po: p.po_no, modelCode: p.model_code, qty: p.plan_qty })),
    // PO Load thành phẩm: Line nhận thêm hàng thành phẩm từ Kho (số dương để hiển thị)
    loadTp: pos.filter(p => p.po_type === 'LOAD' && !isCancelled(p)).map(p => ({ po: p.po_no, modelCode: p.model_code, qty: -p.plan_qty, ref: p.ref_doc || '' }))
  };
}
export function ranks(db) { return kitQueueOrder(db); }

// Tạo danh sách mã cần kitting (chụp BOM tại thời điểm bắt đầu).
// Dòng BOM cần kitting của 1 nhóm cho danh sách PO (chưa ghi DB). VLN: BOM VLN theo Model × tổng SL (model_code '');
// Rear + VLĐT: mỗi Model Code = BOM gốc của code × SL các PO thuộc code. Thiếu BOM → throw (hoặc trả { missing } khi soft).
function bomLines(db, pos, modelCode, grp, soft = false) {
  const qty = pos.reduce((s, p) => s + p.plan_qty, 0);
  if (grp === 'VLN') {
    const model = modelOf(db, modelCode, pos[0]?.basic_model);
    let rows = vlnBom(db, model);
    if (!rows.length) rows = db.prepare("SELECT material, description, point, kit_group FROM bom WHERE model_code = ? AND kit_group = 'VLN' ORDER BY material").all(modelCode);
    if (!rows.length) { if (soft) return { missing: [model || modelCode], lines: [] }; throw fail(`Model ${model} chưa có BOM VLN.`); }
    return { missing: [], lines: rows.map(r => ({ kit_group: 'VLN', model_code: '', material: r.material, description: r.description, point: r.point, required: r3(qty * r.point) })) };
  }
  const hvRows = code => db.prepare(`SELECT material, description, point, kit_group FROM bom WHERE model_code = ? AND kit_group IN ('REAR','VLDT') ORDER BY kit_group DESC, material`).all(code);
  // PO Unplan: Rear đã cấp khi Kho xác nhận Unplan → Rear chỉ tính SL các PO không phải Unplan (VLĐT tính đủ).
  const byCode = new Map(), rearQty = new Map();
  for (const p of pos) {
    byCode.set(p.model_code, (byCode.get(p.model_code) || 0) + p.plan_qty);
    rearQty.set(p.model_code, (rearQty.get(p.model_code) || 0) + (isUnplan(p) ? 0 : p.plan_qty));
  }
  const missing = [...byCode.keys()].filter(c => !hvRows(c).length);
  if (missing.length && !soft) throw fail(`Model Code ${missing.join(', ')} chưa có BOM Rear + VLĐT.`);
  const lines = [];
  for (const [code, q] of byCode) for (const r of hvRows(code)) {
    const n = r.kit_group === 'REAR' ? rearQty.get(code) : q;
    if (n > 0) lines.push({ kit_group: r.kit_group, model_code: code, material: r.material, description: r.description, point: r.point, required: r3(n * r.point) });
  }
  return { missing, lines };
}
export function ensureItems(db, kit, grp) {
  const pos = kitPos(db, kit.id), ins = db.prepare('INSERT INTO kit_item(kit_id, grp, kit_group, model_code, material, description, required) VALUES (?,?,?,?,?,?,?)');
  const exist = items(db, kit.id, grp);
  if (exist.length) {
    // Kit có PO Unplan tạo trước quy định "Unplan không kitting Rear": chưa soạn mã nào thì dựng lại theo BOM mới.
    if (!(grp === 'HV' && pos.some(isUnplan) && exist.every(i => i.kitted <= 0))) return;
    const want = bomLines(db, pos, kit.model_code, grp, true).lines, sig = l => l.map(i => `${i.model_code}|${i.material}|${r3(i.required)}`).sort().join(';');
    if (!want.length || sig(want) === sig(exist)) return;
    db.prepare('DELETE FROM kit_item WHERE kit_id = ? AND grp = ?').run(kit.id, grp);
    for (const r of want) ins.run(kit.id, grp, r.kit_group, r.model_code, r.material, r.description, r.required);
    return;
  }
  for (const r of bomLines(db, pos, kit.model_code, grp).lines) ins.run(kit.id, grp, r.kit_group, r.model_code, r.material, r.description, r.required);
}

/* ---------- tổng hợp vật liệu cần kitting (Kho tải về tính thiếu) ----------
   Các Kit đã lập KH chưa giao Line, ngày kitting ≤ to (+ tùy chọn PO / Kit chưa lập KH). Kit đã mở kitting dùng kit_item
   (Cần / Đã soạn); kit chưa mở tính từ BOM × SL. VLN của kit nhiều Model Code chia theo SL từng code. Còn lại = Cần − Đã soạn. */
export function materialSummary(db, { to, unplanned = false } = {}) {
  to = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : todayKey();
  const rk = ranks(db), rows = [], noBom = [], kitPo = {};
  const add = (src, pos, modelCode, grp, status) => {
    if (status === 'delivered' || !pos.length) return;
    const live = pos.filter(p => !isCancelled(p));
    if (!live.length) return;
    kitPo[src.code] = live.map(p => p.po_no);   // PO gốc của Kit (lọc / tìm theo PO kể cả Kit gộp)
    const qtyOf = new Map(); for (const p of live) qtyOf.set(p.model_code, (qtyOf.get(p.model_code) || 0) + p.plan_qty);
    const total = [...qtyOf.values()].reduce((a, b) => a + b, 0);
    let list = src.kitId ? items(db, src.kitId, grp).map(i => ({ ...i })) : [];
    if (grp === 'HV' && live.some(isUnplan) && list.every(i => i.kitted <= 0)) list = [];   // dựng theo quy định Unplan không Rear
    if (!list.length) {
      const b = bomLines(db, live, modelCode, grp, true);
      if (b.missing.length) noBom.push({ code: src.code, grp, missing: b.missing });
      list = b.lines.map(l => ({ ...l, kitted: 0 }));
    }
    for (const i of list) {
      // VLN (model_code '') chia theo SL từng Model Code của kit
      const parts = i.model_code ? [[i.model_code, 1]] : [...qtyOf].map(([c, q]) => [c, total ? q / total : 0]);
      for (const [code, f] of parts) rows.push({ day: src.day, mrank: src.mrank, kit: src.code, model: src.model, code, grp: i.kit_group, material: i.material, description: i.description || '', required: r3(i.required * f), kitted: r3(i.kitted * f) });
    }
  };
  const kits = db.prepare(`SELECT * FROM kit_order WHERE ${unplanned ? '(plan_day IS NULL OR plan_day <= ?)' : 'plan_day IS NOT NULL AND plan_day <= ?'} AND NOT (vln_status = 'delivered' AND hv_status = 'delivered') ORDER BY plan_day, seq, id`).all(to);
  for (const k of kits) {
    const pos = kitPos(db, k.id), src = { kitId: k.id, day: k.plan_day || '', mrank: rk.get(k.id)?.mrank ?? null, code: k.code, model: modelOf(db, k.model_code, pos[0]?.basic_model) };
    add(src, pos, k.model_code, 'VLN', k.vln_status);
    add(src, pos, k.model_code, 'HV', k.hv_status);
  }
  if (unplanned) {
    const free = db.prepare(`SELECT p.* FROM po p WHERE p.in_source = 1 AND p.remain_qty > 0 AND NOT EXISTS (SELECT 1 FROM kit_order_po k WHERE k.po_key = p.po_key) ORDER BY p.plan_start, p.po_no`).all().filter(p => !isCancelled(p));
    for (const p of free) {
      const src = { kitId: null, day: '', mrank: null, code: p.po_no, model: modelOf(db, p.model_code, p.basic_model) };
      add(src, [p], p.model_code, 'VLN', 'pending'); add(src, [p], p.model_code, 'HV', 'pending');
    }
  }
  for (const r of rows) r.remain = r3(Math.max(0, r.required - r.kitted));
  return { to, unplanned: !!unplanned, today: todayKey(), kits: new Set(rows.map(r => r.kit)).size, rows, noBom, kitPo };
}
function items(db, kitId, grp) {
  return db.prepare(`SELECT * FROM kit_item WHERE kit_id = ? ${grp ? 'AND grp = ?' : ''} ORDER BY grp DESC, model_code, CASE kit_group WHEN 'REAR' THEN 0 WHEN 'VLDT' THEN 1 ELSE 2 END, material`).all(...(grp ? [kitId, grp] : [kitId]));
}
// Định mức lẻ (BOM × SL không ra số nguyên, VD 884,16): Kho cấp số nguyên. Nhập tối đa = làm tròn lên; cấp ≥ phần nguyên (tối thiểu 1) là đủ;
// khi xác nhận xong / giao Line, định mức của kit đổi thành đúng số thực cấp để không phát sinh nợ lẻ.
export const isWhole = n => Math.abs(Number(n) - Math.round(Number(n))) < 1e-9;
export const kitCap = req => isWhole(req) ? Number(req) : Math.ceil(req);
export const kitTarget = req => isWhole(req) ? Number(req) : Math.max(1, Math.floor(req));
export const enough = i => i.kitted >= kitTarget(i.required) - 1e-9;
function roundItems(db, kit, grp, user) {
  const up = db.prepare('UPDATE kit_item SET required = ? WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?');
  for (const i of items(db, kit.id, grp)) if (!isWhole(i.required) && enough(i) && i.kitted <= kitCap(i.required)) {
    up.run(i.kitted, kit.id, grp, i.model_code, i.material);
    logTxn(db, { kitCode: kit.code, type: 'round', grp, kitGroup: i.kit_group, material: i.material, qty: r3(i.kitted - i.required), ref: i.model_code, note: `Định mức ${r3(i.required)} → cấp ${i.kitted}`, user });
  }
}
function progress(list) {
  const total = list.length, full = list.filter(enough).length, short = total - full;
  return { total, full, short, kittedQty: r3(list.reduce((s, i) => s + i.kitted, 0)), requiredQty: r3(list.reduce((s, i) => s + i.required, 0)) };
}
// Các Model Code trong kit có Rear đã kitting = 0.
function rearZeroCodes(list) {
  const m = new Map();
  for (const i of list.filter(i => i.kit_group === 'REAR')) m.set(i.model_code, (m.get(i.model_code) || 0) + i.kitted);
  return [...m].filter(([, v]) => v <= 0).map(([c]) => c);
}
const ikey = (code, material) => `${code || ''}\u001f${material}`;
const statusCol = grp => grp === 'VLN' ? 'vln_status' : 'hv_status';
function setStatus(db, kitId, grp, status) { db.prepare(`UPDATE kit_order SET ${statusCol(grp)} = ?, updated_at = datetime('now') WHERE id = ?`).run(status, kitId); }
// Sau khi lấy bớt vật liệu: còn thiếu thì quay về "đang làm" để kho kitting bù; hết sạch thì về "chưa làm".
function recompute(db, kit, grp) {
  const cur = loadKit(db, kit.id)[statusCol(grp)];
  if (cur === 'delivered') return;
  const list = items(db, kit.id, grp);
  if (!list.length || list.every(i => i.kitted <= 0)) return setStatus(db, kit.id, grp, 'pending');
  if (list.some(i => !enough(i))) return setStatus(db, kit.id, grp, cur === 'pending' ? 'progress' : (cur === 'done' ? 'progress' : cur));
}
function logTxn(db, t) {
  db.prepare('INSERT INTO kit_txn(kit_code, type, grp, kit_group, material, qty, ref_code, line, reason_code, note, username) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(t.kitCode || '', t.type, t.grp || null, t.kitGroup || null, t.material || null, r3(t.qty || 0), t.ref || null, t.line || null, t.reason || null, t.note || null, t.user || '');
}

/* ---------- danh sách kitting theo nhóm ---------- */
export function kitQueue(db, grp) {
  const rk = ranks(db);
  const where = grp === 'VLN'
    ? "plan_day IS NOT NULL AND vln_status <> 'delivered'"
    : "plan_day IS NOT NULL AND hv_status <> 'delivered' AND vln_status IN ('progress','done')";
  const kits = db.prepare(`SELECT * FROM kit_order WHERE ${where} ORDER BY plan_day, seq, id`).all();
  const rows = kits.map(k => {
    const h = kitHeader(db, k, rk.get(k.id));
    if (grp === 'HV' && h.unplanRear.length && items(db, k.id, grp).length) tx(db, () => ensureItems(db, k, grp));   // kit Unplan cũ: bỏ Rear nếu chưa soạn
    const list = items(db, k.id, grp);
    const rz = rearZeroCodes(list);
    return { ...h, status: k[statusCol(grp)], progress: list.length ? progress(list) : null,
      rearZero: grp === 'HV' && list.length > 0 && rz.length === new Set(list.filter(i => i.kit_group === 'REAR').map(i => i.model_code)).size && rz.length > 0,
      rearZeroCodes: grp === 'HV' ? rz : [],
      noBom: !list.length && h.codes.some(c => !db.prepare('SELECT 1 FROM bom WHERE model_code = ? LIMIT 1').get(c)) };
  });
  rows.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const c = s => rows.filter(r => r.status === s).length;
  return { grp, rows, kpi: { pending: c('pending'), progress: c('progress'), done: c('done'), short: rows.filter(r => r.status === 'done' && r.progress?.short).length } };
}

export function kitDetail(db, kitId, grp) {
  const kit = loadKit(db, kitId);
  if (grp === 'HV' && kit.vln_status === 'pending') throw fail('PO chưa bắt đầu kitting VLN.');
  tx(db, () => ensureItems(db, kit, grp));
  const list = items(db, kit.id, grp);
  const printCount = db.prepare("SELECT COUNT(*) n FROM kit_txn WHERE type = 'print' AND kit_code = ? AND grp = ?").get(kit.code, grp).n;
  const start = db.prepare("SELECT MIN(p.plan_start) s FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = ? AND p.plan_start <> ''").get(kit.id).s || '';
  // Vị trí / tồn ERP của từng mã (chỉ vị trí tính là Kho) để OP biết lấy ở đâu — hiện ở hộp kitting, màn soạn và phiếu in.
  const st = stockOf(db, list.map(i => i.material)), stockAt = stockStatus(db).okAt || '';
  return { kit: { ...kitHeader(db, kit, ranks(db).get(kit.id)), status: kit[statusCol(grp)], vlnStatus: kit.vln_status, planStart: start, printCount }, grp, stockAt,
    items: list.map(i => { const s = st.get(i.material); return { code: i.model_code, material: i.material, description: i.description, kitGroup: i.kit_group, required: i.required, kitted: i.kitted, delivered: i.delivered, locs: s ? s.locs : [], stock: s ? s.total : 0, defaultLoc: s ? s.defaultLoc : '' }; }) };
}

// Ghi lại mỗi lần in phiếu kitting giấy (lần 2 trở đi in chữ "BẢN IN LẠI").
export function logPrint(db, { kitId, grp }, user) {
  if (!GROUPS[grp]) throw fail('Nhóm không hợp lệ.');
  return tx(db, () => {
    const kit = loadKit(db, kitId);
    logTxn(db, { kitCode: kit.code, type: 'print', grp, user });
    return { ok: true, count: db.prepare("SELECT COUNT(*) n FROM kit_txn WHERE type = 'print' AND kit_code = ? AND grp = ?").get(kit.code, grp).n };
  });
}
// Chuyển nhanh PO VLN từ Chưa làm → Đang làm (chưa cần soạn mã nào) để bên Rear + VLĐT có PO kitting ngay; back = trả về Chưa làm khi chưa soạn gì.
export function startKit(db, { kitId, back }, user) {
  return tx(db, () => {
    const kit = loadKit(db, kitId);
    if (back) {
      if (kit.vln_status !== 'progress') throw fail(`${kit.code} không ở trạng thái Đang làm.`);
      if (kit.hv_status !== 'pending' || items(db, kit.id).some(i => i.kitted > 0)) throw fail(`${kit.code} đã soạn vật liệu, không trả về Chưa làm được.`);
      setStatus(db, kit.id, 'VLN', 'pending'); logTxn(db, { kitCode: kit.code, type: 'unstart', grp: 'VLN', user });
      return { ok: true, message: `${kit.code}: về Chưa làm` };
    }
    if (kit.vln_status !== 'pending') throw fail(`${kit.code} đã ở trạng thái ${kit.vln_status === 'progress' ? 'Đang làm' : 'khác Chưa làm'}.`);
    setStatus(db, kit.id, 'VLN', 'progress'); logTxn(db, { kitCode: kit.code, type: 'start', grp: 'VLN', user });
    return { ok: true, message: `${kit.code}: Đang làm · Rear + VLĐT kitting được` };
  });
}
export function saveKitting(db, { kitId, grp, items: input, confirm, shortReason, shortNote }, user) {
  if (!GROUPS[grp]) throw fail('Nhóm không hợp lệ.');
  return tx(db, () => {
    const kit = loadKit(db, kitId);
    if (kit[statusCol(grp)] === 'delivered') throw fail('PO đã giao line, không sửa kitting được. Dùng Điều chỉnh kit.');
    if (grp === 'HV' && kit.vln_status === 'pending') throw fail('PO chưa bắt đầu kitting VLN.');
    ensureItems(db, kit, grp);
    const cur = new Map(items(db, kit.id, grp).map(i => [ikey(i.model_code, i.material), i]));
    const upd = db.prepare('UPDATE kit_item SET kitted = ? WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?');
    for (const it of Array.isArray(input) ? input : []) {
      const row = cur.get(ikey(it.code, it.material)); if (!row) throw fail(`Mã ${it.material} không thuộc kit này.`);
      const v = Number(it.kitted);
      if (!Number.isFinite(v) || v < 0) throw fail(`Số kitting của ${row.material} không hợp lệ.`);
      if (!isWhole(row.required) && !Number.isInteger(v)) throw fail(`${row.material}: định mức lẻ ${r3(row.required)}, nhập số nguyên (tối đa ${kitCap(row.required)}).`);
      if (v > kitCap(row.required)) throw fail(`${row.material}: không kitting quá số cần (${kitCap(row.required)}).`);
      if (r3(v) !== r3(row.kitted)) { upd.run(r3(v), kit.id, grp, row.model_code, row.material); logTxn(db, { kitCode: kit.code, type: 'kit', grp, kitGroup: row.kit_group, material: row.material, qty: r3(v - row.kitted), user }); }
    }
    const list = items(db, kit.id, grp), any = list.some(i => i.kitted > 0);
    const was = kit[statusCol(grp)];
    if (confirm) {
      if (!any && list.length) throw fail('Chưa kitting mã nào.');
      roundItems(db, kit, grp, user);
      // Xác nhận xong khi còn thiếu: bắt chọn lý do (mã thiếu sẽ thành nợ khi giao Line).
      const sh = items(db, kit.id, grp).filter(i => !enough(i));
      if (sh.length) {
        const rc = String(shortReason || ''), nt = String(shortNote || '').trim().slice(0, 200);
        if (!SHORT_REASONS[rc]) throw fail(`Còn thiếu ${sh.length} mã: chọn lý do xác nhận xong khi còn thiếu.`);
        if (rc === 'OTHER' && !nt) throw fail('Lý do "Khác" cần ghi chú.');
        logTxn(db, { kitCode: kit.code, type: 'short_confirm', grp, qty: sh.length, reason: rc, note: `${SHORT_REASONS[rc]}${nt ? `: ${nt}` : ''} · thiếu ${sh.length} mã`, user });
      }
      setStatus(db, kit.id, grp, 'done');
    } else setStatus(db, kit.id, grp, any || was === 'progress' ? 'progress' : 'pending');   // đã bấm "Bắt đầu" thì giữ Đang làm
    const p = progress(items(db, kit.id, grp));
    return { ok: true, status: confirm ? 'done' : (any || was === 'progress' ? 'progress' : 'pending'), message: confirm ? `${kit.code}: xong ${grp === 'VLN' ? 'VLN' : 'Rear + VLĐT'}${p.short ? ` · thiếu ${p.short} mã` : ''}` : `${kit.code}: đã lưu ${p.full}/${p.total} mã đủ` };
  });
}

/* ---------- line, giao line, kiểm tra cấp ---------- */
function assignMap(db, day, shift) {
  return new Map(db.prepare('SELECT line, model FROM line_assign WHERE work_date = ? AND shift = ?').all(day, shift).map(r => [r.line, r.model]));
}
export function lineSupply(db, line, model) {
  const s = getSettings(db), threshold = Number(s.supply_threshold);
  const kits = db.prepare("SELECT * FROM kit_order WHERE line = ? AND vln_status = 'delivered'").all(line);
  // Theo Kit: PO Load thành phẩm (số âm) trừ vào Remain của PO thật cùng Kit khi PO thật còn việc; PO thật xong thì không trừ nữa.
  const remainSum = kits.reduce((sum, k) => {
    const ps = kitPos(db, k.id).filter(p => p.in_source && !isCancelled(p));
    const real = ps.filter(p => p.po_type !== 'LOAD').reduce((a, p) => a + Math.max(p.remain_qty, 0), 0);
    const tp = real > 0 ? ps.filter(p => p.po_type === 'LOAD' && p.int_status !== 'done').reduce((a, p) => a + Math.min(p.remain_qty, 0), 0) : 0;
    return sum + Math.max(real + tp, 0);
  }, 0);
  const prm = model ? db.prepare('SELECT spread_qty, pending_qty, pending_day FROM line_params WHERE line = ? AND model = ?').get(line, model) : null;
  const spread = prm?.spread_qty || 0, pending = pendingOf(db, prm), available = remainSum - spread - pending;
  return { line, model: model || '', remainSum, spread, pending, available, threshold, pass: available < threshold, hasParams: !!prm };
}
// Quy tắc cấp: (Σ Remain PO đã giao − rải chuyền − pending) < ngưỡng thì Line được cấp tiếp PO / vật liệu.
export const ruleText = s => s.pass ? `còn ${Math.round(s.available)} < ${s.threshold}` : `còn ${Math.round(s.available)} ≥ ${s.threshold}`;
const lineModel = (db, line) => { const c = currentShift(db); return assignMap(db, c.day, c.shift).get(line) || ''; };
function poApproval(db, line) {
  return db.prepare("SELECT * FROM material_request WHERE kind = 'po' AND line = ? AND status IN ('approved','pending_approval') ORDER BY CASE status WHEN 'approved' THEN 0 ELSE 1 END, id LIMIT 1").get(line) || null;
}
export function deliverable(db, kit) {
  const cancelled = kitPos(db, kit.id).filter(isCancelled).map(p => p.po_no);
  if (cancelled.length) return { ok: false, why: `PO hủy ${cancelled.join(', ')}` };
  if (kit.vln_status !== 'done' || kit.hv_status !== 'done') return { ok: false, why: 'Chưa xong cả 2 nhóm' };
  // Giao được khi có ít nhất 1 Model Code có Rear; code chưa có Rear thì ghi nợ.
  const rear = db.prepare("SELECT model_code, SUM(kitted) s FROM kit_item WHERE kit_id = ? AND kit_group = 'REAR' GROUP BY model_code").all(kit.id);
  if (rear.length && rear.every(r => r.s <= 0)) return { ok: false, why: 'Không có Rear' };
  const zero = rear.filter(r => r.s <= 0).map(r => r.model_code);
  return { ok: true, rearZero: zero };
}
export function lineBoard(db, day, shift) {
  (() => { const c = currentShift(db); day = day || c.day; shift = shift || (day === c.day ? c.shift : shifts(db)[0]); })();
  const rk = ranks(db), assign = assignMap(db, day, shift);
  const lines = db.prepare('SELECT name FROM lines WHERE active = 1 ORDER BY sort_order, name').all().map(r => r.name);
  const ready = db.prepare("SELECT * FROM kit_order WHERE vln_status = 'done' AND hv_status = 'done' ORDER BY plan_day, seq, id").all()
    .map(k => ({ ...kitHeader(db, k, rk.get(k.id)), check: deliverable(db, k) })).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const out = lines.map(line => {
    const model = assign.get(line) || '';
    const delivered = db.prepare("SELECT * FROM kit_order WHERE line = ? AND vln_status = 'delivered' ORDER BY delivered_at DESC").all(line).map(k => kitHeader(db, k, rk.get(k.id)));
    const req = poApproval(db, line);
    return { line, model, supply: lineSupply(db, line, model), running: delivered.filter(k => k.remain > 0), finished: delivered.filter(k => k.remain <= 0).length,
      readyCount: ready.filter(k => k.model === model && k.check.ok && (!k.fixedLine || k.fixedLine === line)).length, poReq: req ? { id: req.id, status: req.status } : null };
  });
  const debtCount = db.prepare("SELECT COUNT(DISTINCT kit_id) n FROM kit_item i JOIN kit_order k ON k.id = i.kit_id WHERE k.vln_status = 'delivered' AND i.delivered < i.required").get().n;
  return { day, shift, shifts: shifts(db), lines: out, ready, kpi: { running: out.filter(l => l.model).length, ready: ready.filter(k => k.check.ok).length, needSupply: out.filter(l => l.model && (l.supply.pass || l.poReq?.status === 'approved')).length, waitApprove: out.filter(l => l.poReq?.status === 'pending_approval').length, debt: debtCount } };
}
export function deliveryPreview(db, kitId, line) {
  const kit = loadKit(db, kitId), list = items(db, kit.id);
  const model = modelOf(db, kit.model_code, kitPos(db, kit.id)[0]?.basic_model);
  const lm = lineModel(db, line), sup = lineSupply(db, line, lm), req = poApproval(db, line);
  const head = kitHeader(db, kit, ranks(db).get(kit.id));
  return { kit: head, check: deliverable(db, kit), warnModel: lm && lm !== model ? `${line} đang chạy ${lm}, PO là ${model}` : '',
    fixedBlock: head.fixedLine && head.fixedLine !== line ? `${kit.code} có PO nội bộ ấn định ${head.fixedLine}` : '',
    warnPlanLine: head.planLine && head.planLine !== line && !head.fixedLine ? `Planner dự kiến ${kit.code} cho ${head.planLine}` : '',
    rule: { ...sup, approved: req?.status === 'approved' ? req.id : null, waiting: req?.status === 'pending_approval' ? req.id : null, canDeliver: sup.pass || req?.status === 'approved' },
    rear: list.filter(i => i.kit_group === 'REAR').map(i => ({ code: i.model_code, material: i.material, required: i.required, kitted: i.kitted })),
    material: list.filter(i => i.kit_group !== 'REAR').map(i => ({ code: i.model_code, material: i.material, group: i.kit_group, required: i.required, kitted: i.kitted })) };
}
export function deliver(db, { kitId, line }, user) {
  return tx(db, () => {
    const kit = loadKit(db, kitId);
    if (!db.prepare('SELECT 1 FROM lines WHERE name = ? AND active = 1').get(line)) throw fail('Line không hợp lệ.');
    if (kit.vln_status === 'delivered') throw fail(`${kit.code} đã giao cho ${kit.line}.`);
    const fixed = fixedLineOf(kitPos(db, kit.id));
    if (fixed && fixed !== line) throw fail(`${kit.code} có PO nội bộ ấn định ${fixed}, không giao cho ${line} được.`);
    const chk = deliverable(db, kit); if (!chk.ok) throw fail(`${kit.code}: ${chk.why}.`);
    const sup = lineSupply(db, line, lineModel(db, line)), req = poApproval(db, line);
    if (!sup.pass && req?.status !== 'approved') throw fail(`${line} ${ruleText(sup)}: chưa đến lúc cấp PO, cần duyệt ngoại lệ.`);
    roundItems(db, kit, 'VLN', user); roundItems(db, kit, 'HV', user);   // kit xác nhận xong trước khi có quy tắc làm tròn
    const list = items(db, kit.id);
    const upd = db.prepare('UPDATE kit_item SET delivered = kitted WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?');
    for (const i of list) { upd.run(kit.id, i.grp, i.model_code, i.material); if (i.kitted > 0) logTxn(db, { kitCode: kit.code, type: 'deliver', grp: i.grp, kitGroup: i.kit_group, material: i.material, qty: i.kitted, line, user });
      if (i.kitted < i.required) logTxn(db, { kitCode: kit.code, type: 'debt_open', grp: i.grp, kitGroup: i.kit_group, material: i.material, qty: i.required - i.kitted, ref: i.model_code, line, user }); }
    db.prepare("UPDATE kit_order SET line = ?, delivered_at = datetime('now'), delivered_by = ?, vln_status = 'delivered', hv_status = 'delivered', updated_at = datetime('now') WHERE id = ?").run(line, user, kit.id);
    if (req?.status === 'approved') db.prepare("UPDATE material_request SET status = 'issued', kit_id = ?, kit_code = ?, issued_qty = ?, issued_by = ?, issued_at = datetime('now') WHERE id = ?")
      .run(kit.id, kit.code, kitPos(db, kit.id).reduce((s, p) => s + p.plan_qty, 0), user, req.id);
    const debt = list.filter(i => i.kitted < i.required).length;
    return { ok: true, message: `Đã giao ${kit.code} → ${line}${debt ? ` · ghi nợ ${debt} mã` : ''}${chk.rearZero.length ? ` · nợ Rear ${chk.rearZero.join(', ')}` : ''}${req?.status === 'approved' ? ` · đóng YC#${req.id}` : ''}` };
  });
}

/* ---------- nợ vật liệu ---------- */
export function debts(db) {
  const rows = db.prepare(`SELECT k.id, k.code, k.line, k.delivered_at, k.model_code, i.grp, i.kit_group, i.model_code AS item_code, i.material, i.description, i.required, i.delivered
    FROM kit_item i JOIN kit_order k ON k.id = i.kit_id WHERE k.vln_status = 'delivered' AND i.delivered < i.required ORDER BY k.delivered_at, k.code, i.material`).all();
  const byKit = new Map();
  for (const r of rows) {
    if (!byKit.has(r.id)) byKit.set(r.id, { kitId: r.id, code: r.code, line: r.line, deliveredAt: r.delivered_at, modelCode: r.model_code, items: [] });
    byKit.get(r.id).items.push({ grp: r.grp, kitGroup: r.kit_group, code: r.item_code, material: r.material, description: r.description, debt: r3(r.required - r.delivered), required: r.required, delivered: r3(r.delivered) });
  }
  const list = [...byKit.values()];
  ensureLotSchema(db);
  for (const k of list) {
    const st = lotStats(db, k.kitId), prep = new Map(db.prepare('SELECT * FROM kit_bu WHERE kit_id = ?').all(k.kitId).map(b => [lotKey(b.grp, b.model_code, b.material), b]));
    for (const i of k.items) {
      const key = lotKey(i.grp, i.code, i.material), s = st.get(key), b = prep.get(key);
      Object.assign(i, { cap: isWhole(i.debt) ? i.debt : Math.ceil(i.debt), bu: s?.bu || 0, buN: s?.n || 0, prepared: b ? r3(b.qty) : 0, preparedBy: b?.username || '' });
    }
    k.lots = lotCount(db, k.kitId);
  }
  return { rows: list, kpi: { kits: list.length, items: rows.length, ea: r3(rows.reduce((s, r) => s + r.required - r.delivered, 0)), rear: rows.filter(r => r.kit_group === 'REAR').length } };
}
// Giao bù nợ = 1 đợt (kit_lot) gồm 1 hoặc nhiều mã: { kitId, items: [{ grp, code, material, qty }] } hoặc 1 mã { kitId, grp, code, material, qty }.
export function settleDebt(db, { kitId, material, grp, code = '', qty, items: list }, user) {
  ensureLotSchema(db);
  return tx(db, () => {
    const kit = loadKit(db, kitId);
    if (kit.vln_status !== 'delivered') throw fail(`${kit.code} chưa giao Line.`);
    const input = Array.isArray(list) ? list : [{ grp, code, material, qty }];
    const r = createLot(db, kit, input, user, logTxn);
    const left = items(db, kit.id).filter(i => i.delivered < i.required - 1e-9).length;
    const one = r.items.length === 1 ? r.items[0] : null;
    return { ok: true, lotNo: r.lotNo, lotId: r.lotId, left,
      message: `${r.lotNo}: giao bù ${one ? `${one.material} ${one.q}` : `${r.items.length} mã`}${left ? ` · ${kit.code} còn nợ ${left} mã` : ' · hết nợ'} · chờ ${kit.line} ký nhận` };
  });
}

/* ---------- điều chỉnh kit: chuyển PO khác / trả kho / thu hồi từ line ---------- */
export function adjustOptions(db, kitId) {
  const kit = loadKit(db, kitId), model = modelOf(db, kit.model_code, kitPos(db, kit.id)[0]?.basic_model);
  const rk = ranks(db), myCodes = [...new Set(kitPos(db, kit.id).map(p => p.model_code))];
  const targets = db.prepare("SELECT * FROM kit_order WHERE id <> ? AND plan_day IS NOT NULL AND vln_status <> 'delivered' ORDER BY plan_day, seq, id").all(kit.id)
    .map(k => kitHeader(db, k, rk.get(k.id))).filter(k => k.model === model)
    .map(k => ({ id: k.id, code: k.code, modelCode: k.modelCode, codes: k.codes, rank: k.rank, mrank: k.mrank, sameCode: k.codes.some(c => myCodes.includes(c)) }));
  return { kit: kitHeader(db, kit, rk.get(kit.id)), delivered: kit.vln_status === 'delivered', reasons: REASONS, targets,
    items: items(db, kit.id).map(i => ({ grp: i.grp, kitGroup: i.kit_group, code: i.model_code, material: i.material, required: i.required, kitted: i.kitted, delivered: i.delivered, free: r3(i.kitted - i.delivered) })) };
}
export function adjust(db, { kitId, type, targetId, reasonCode, note, items: input }, user) {
  if (!['transfer', 'return', 'recall'].includes(type)) throw fail('Chọn kiểu điều chỉnh.');
  if (!REASONS[reasonCode]) throw fail('Chọn lý do.');
  if (reasonCode === 'OTHER' && !String(note || '').trim()) throw fail('Lý do "Khác" cần ghi chú.');
  const lines = (Array.isArray(input) ? input : []).filter(i => Number(i.qty) > 0);
  if (!lines.length) throw fail('Nhập số lượng cho ít nhất 1 mã.');
  return tx(db, () => {
    const kit = loadKit(db, kitId), isDelivered = kit.vln_status === 'delivered';
    if (type === 'recall' && !isDelivered) throw fail('Chỉ thu hồi được PO đã giao line.');
    if (type !== 'recall' && isDelivered) throw fail('PO đã giao line: thu hồi từ line trước rồi mới chuyển / trả kho.');
    let target = null;
    if (type === 'transfer') {
      target = loadKit(db, targetId);
      if (target.vln_status === 'delivered') throw fail('PO nhận đã giao line.');
      const m1 = modelOf(db, kit.model_code, kitPos(db, kit.id)[0]?.basic_model), m2 = modelOf(db, target.model_code, kitPos(db, target.id)[0]?.basic_model);
      if (m1 !== m2) throw fail('Chỉ chuyển giữa các PO cùng Model.');
    }
    const touched = new Set(), tTouched = new Set();
    for (const it of lines) {
      const row = db.prepare('SELECT * FROM kit_item WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?').get(kit.id, it.grp, String(it.code || ''), it.material);
      if (!row) throw fail(`Mã ${it.material} không thuộc kit.`);
      const q = r3(Number(it.qty));
      if (type === 'recall') {
        if (q > row.delivered) throw fail(`${row.material}: chỉ thu hồi tối đa ${row.delivered}.`);
        db.prepare('UPDATE kit_item SET delivered = delivered - ? WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?').run(q, kit.id, row.grp, row.model_code, row.material);
        logTxn(db, { kitCode: kit.code, type: 'recall', grp: row.grp, kitGroup: row.kit_group, material: row.material, qty: q, line: kit.line, reason: reasonCode, note, user });
        continue;
      }
      const free = r3(row.kitted - row.delivered);
      if (q > free) throw fail(`${row.material}: chỉ còn ${free} có thể lấy.`);
      if (type === 'transfer') {
        if (row.grp === 'HV' && !kitPos(db, target.id).some(p => p.model_code === row.model_code)) throw fail(`${row.material} (Rear/VLĐT) chỉ chuyển cho PO có Model Code ${row.model_code}.`);
        ensureItems(db, target, row.grp);
        const trow = db.prepare('SELECT * FROM kit_item WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?').get(target.id, row.grp, row.model_code, row.material);
        if (!trow) throw fail(`${target.code} không dùng mã ${row.material}.`);
        if (trow.kitted + q > trow.required) throw fail(`${target.code} chỉ cần thêm ${r3(trow.required - trow.kitted)} ${row.material}.`);
        db.prepare('UPDATE kit_item SET kitted = kitted + ? WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?').run(q, target.id, row.grp, row.model_code, row.material);
        logTxn(db, { kitCode: target.code, type: 'transfer_in', grp: row.grp, kitGroup: row.kit_group, material: row.material, qty: q, ref: kit.code, reason: reasonCode, note, user });
        tTouched.add(row.grp);
      }
      db.prepare('UPDATE kit_item SET kitted = kitted - ? WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?').run(q, kit.id, row.grp, row.model_code, row.material);
      logTxn(db, { kitCode: kit.code, type: type === 'transfer' ? 'transfer_out' : 'return', grp: row.grp, kitGroup: row.kit_group, material: row.material, qty: q, ref: target?.code, reason: reasonCode, note, user });
      touched.add(row.grp);
    }
    let extra = '';
    if (type === 'recall' && items(db, kit.id).every(i => i.delivered <= 0)) {
      // Thu hồi toàn bộ: gỡ PO khỏi line, vật liệu vẫn thuộc kit để giao lại line khác.
      db.prepare("UPDATE kit_order SET line = NULL, delivered_at = NULL, delivered_by = NULL, vln_status = 'done', hv_status = 'done', updated_at = datetime('now') WHERE id = ?").run(kit.id);
      for (const g of ['VLN', 'HV']) if (items(db, kit.id, g).every(i => i.kitted <= 0)) setStatus(db, kit.id, g, 'pending');
      extra = ` · gỡ khỏi ${kit.line}`;
    }
    for (const g of touched) recompute(db, kit, g);
    if (target) for (const g of tTouched) { const t = loadKit(db, target.id); if (t[statusCol(g)] === 'pending') setStatus(db, t.id, g, 'progress'); if (g === 'HV' && t.vln_status === 'pending') setStatus(db, t.id, 'VLN', 'progress'); }
    const label = { transfer: `chuyển sang ${target?.code}`, return: 'trả kho', recall: 'thu hồi từ line' }[type];
    return { ok: true, message: `${kit.code}: ${label} ${lines.length} mã${extra}` };
  });
}

/* ---------- lịch sử & báo cáo ---------- */
export function history(db, { days = 7, type = '' } = {}) {
  const since = new Date(Date.now() - Number(days) * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const rows = db.prepare(`SELECT * FROM kit_txn WHERE created_at >= ? ${type ? 'AND type = ?' : ''} ORDER BY id DESC LIMIT 400`).all(...(type ? [since, type] : [since]));
  const all = db.prepare('SELECT type, reason_code, qty, kit_code FROM kit_txn WHERE created_at >= ?').all(since);
  const adj = all.filter(r => ['transfer_out', 'return', 'recall'].includes(r.type));
  const byReason = Object.entries(REASONS).map(([code, label]) => {
    const list = adj.filter(r => r.reason_code === code);
    return { code, label, times: new Set(list.map(r => r.kit_code + r.type)).size, lines: list.length, ea: r3(list.reduce((s, r) => s + r.qty, 0)) };
  }).filter(r => r.lines);
  const byType = ['transfer_out', 'return', 'recall'].map(t => ({ type: t, label: TXN_LABEL[t], lines: adj.filter(r => r.type === t).length, ea: r3(adj.filter(r => r.type === t).reduce((s, r) => s + r.qty, 0)) }));
  return { rows: rows.map(r => ({ ...r, typeLabel: TXN_LABEL[r.type] || r.type, reason: REASONS[r.reason_code] || '' })), byReason, byType,
    kpi: { kitted: new Set(all.filter(r => r.type === 'kit').map(r => r.kit_code)).size, delivered: new Set(all.filter(r => r.type === 'deliver').map(r => r.kit_code)).size,
      adjust: new Set(adj.map(r => r.kit_code + r.type + r.reason_code)).size, adjustEa: r3(adj.reduce((s, r) => s + r.qty, 0)) } };
}

/* ---------- GĐ3: yêu cầu & cấp vật liệu ---------- */
export function requestForm(db, line) {
  const model = lineModel(db, line);
  const materials = model ? db.prepare(`SELECT DISTINCT b.material, b.description, b.kit_group FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code
    WHERE COALESCE(m.model, b.model_code) = ? ORDER BY CASE b.kit_group WHEN 'REAR' THEN 0 WHEN 'VLDT' THEN 1 ELSE 2 END, b.material`).all(model) : [];
  return { supply: lineSupply(db, line, model), materials };
}
// kind = 'po' (xin cấp PO tiếp theo, Kho giao ở tab Giao line) | 'material' (vật liệu lẻ, Kho cấp ở tab này).
export function createRequest(db, { line, material, qty, note, kind = 'material', kitId }, user) {
  if (!db.prepare('SELECT 1 FROM lines WHERE name = ? AND active = 1').get(line)) throw fail('Chọn Line.');
  const isPo = kind === 'po';
  const f = requestForm(db, line), s = f.supply;
  if (!s.model) throw fail(`${line} chưa khai báo Model đang chạy hôm nay.`);
  let mat = null, q = Number(qty), kit = null;
  if (isPo) {
    const open = poApproval(db, line);
    if (open) throw fail(`${line} đã có YC#${open.id} xin PO đang ${open.status === 'approved' ? 'chờ Kho giao' : 'chờ duyệt'}.`);
    if (kitId) kit = loadKit(db, kitId);
    q = kit ? kitPos(db, kit.id).reduce((a, p) => a + p.plan_qty, 0) : 1;
  } else {
    if (!Number.isFinite(q) || q <= 0) throw fail('Nhập số lượng yêu cầu.');
    mat = f.materials.find(m => m.material === material); if (!mat) throw fail('Chọn mã vật liệu thuộc Model đang chạy.');
  }
  const status = s.pass ? 'approved' : 'pending_approval';
  const ins = db.prepare(`INSERT INTO material_request(kind, kit_id, kit_code, line, model, material, description, qty, note, status, remain_sum, spread, pending, available, threshold, pass, requested_by, approved_by, approved_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,${s.pass ? "datetime('now')" : 'NULL'})`)
    .run(isPo ? 'po' : 'material', kit?.id ?? null, kit?.code ?? null, line, s.model, isPo ? (kit ? kit.code : 'PO tiếp theo') : mat.material, isPo ? (kit ? `${kit.model_code}` : s.model) : mat.description,
      q, String(note || '').slice(0, 200), status, s.remainSum, s.spread, s.pending, s.available, s.threshold, s.pass ? 1 : 0, user, s.pass ? 'Tự động' : null);
  const what = isPo ? 'xin PO' : 'yêu cầu';
  return { ok: true, id: Number(ins.lastInsertRowid), pass: s.pass, message: s.pass ? `Đạt (${ruleText(s)}) · ${what} chờ Kho ${isPo ? 'giao' : 'cấp'}` : `Chưa đến lúc cấp (${ruleText(s)}) · ${what} chờ duyệt` };
}
export function requests(db) {
  const rows = db.prepare('SELECT * FROM material_request ORDER BY CASE status WHEN \'pending_approval\' THEN 0 WHEN \'approved\' THEN 1 ELSE 2 END, id DESC LIMIT 300').all();
  const today = todayKey();
  const isToday = r => r.issued_at && vnDay(Date.parse(r.issued_at.replace(' ', 'T') + 'Z')) === today;
  return { rows, kpi: { approved: rows.filter(r => r.status === 'approved').length, pending: rows.filter(r => r.status === 'pending_approval').length,
    issuedToday: rows.filter(isToday).length, exceptions: rows.filter(r => !r.pass && ['approved', 'issued'].includes(r.status)).length } };
}
export function decideRequest(db, { id, approve, note }, user) {
  const r = db.prepare('SELECT * FROM material_request WHERE id = ?').get(Number(id));
  if (!r) throw fail('Không tìm thấy yêu cầu.', 404);
  if (r.status !== 'pending_approval') throw fail('Yêu cầu không ở trạng thái chờ duyệt.');
  if (!approve && !String(note || '').trim()) throw fail('Từ chối cần ghi lý do.');
  db.prepare("UPDATE material_request SET status = ?, approved_by = ?, approve_note = ?, approved_at = datetime('now') WHERE id = ?").run(approve ? 'approved' : 'rejected', user, String(note || '').slice(0, 200), r.id);
  return { ok: true, message: approve ? `Đã duyệt yêu cầu #${r.id}` : `Đã từ chối yêu cầu #${r.id}` };
}
export function issueRequest(db, { id, qty }, user) {
  const r = db.prepare('SELECT * FROM material_request WHERE id = ?').get(Number(id));
  if (!r) throw fail('Không tìm thấy yêu cầu.', 404);
  if (r.status !== 'approved') throw fail('Yêu cầu chưa được duyệt.');
  if (r.kind === 'po') throw fail('Yêu cầu PO: giao ở tab Kho → Giao line.');
  const q = Number(qty ?? r.qty); if (!Number.isFinite(q) || q <= 0) throw fail('Số cấp phải > 0.');
  db.prepare("UPDATE material_request SET status = 'issued', issued_qty = ?, issued_by = ?, issued_at = datetime('now') WHERE id = ?").run(q, user, r.id);
  logTxn(db, { kitCode: `YC#${r.id}`, type: 'issue', material: r.material, qty: q, line: r.line, note: r.pass ? '' : 'Ngoại lệ đã duyệt', user });
  return { ok: true, message: `Đã cấp ${q} ${r.material} cho ${r.line}` };
}

/* ---------- PO hủy (Plan Status = Cancel) hoặc không còn trong file nguồn ---------- */
// Kit chưa xong sản xuất có PO hủy / mất khỏi nguồn → cảnh báo Planner + Kho (thu hồi, trả kho, gỡ khỏi kế hoạch).
export function cancelAlerts(db) {
  const kits = db.prepare(`SELECT DISTINCT k.* FROM kit_order k JOIN kit_order_po x ON x.kit_id = k.id JOIN po p ON p.po_key = x.po_key
    WHERE lower(trim(coalesce(p.plan_status, ''))) LIKE 'cancel%' OR (p.in_source = 0 AND p.remain_qty > 0) ORDER BY k.plan_day, k.seq, k.id`).all();
  return kits.map(k => {
    const pos = kitPos(db, k.id), list = items(db, k.id);
    const bad = pos.filter(p => isCancelled(p) || (!p.in_source && p.remain_qty > 0)).map(p => ({ po: p.po_no, why: isCancelled(p) ? 'cancel' : 'gone' }));
    const kitted = list.reduce((s, i) => s + i.kitted, 0), delivered = list.reduce((s, i) => s + i.delivered, 0);
    const step = k.vln_status === 'delivered' ? (delivered > 0 ? 'recall' : 'return') : kitted > 0 ? 'return' : bad.some(b => b.why === 'cancel') ? 'drop' : 'check';
    return { kitId: k.id, code: k.code, kind: k.kind, line: k.line || '', planDay: k.plan_day || '', vln: k.vln_status, hv: k.hv_status, total: pos.length, pos: bad, step };
  }).sort((a, b) => ({ recall: 0, return: 1, drop: 2, check: 3 })[a.step] - ({ recall: 0, return: 1, drop: 2, check: 3 })[b.step]);
}
// Gỡ PO hủy khỏi kế hoạch: chỉ khi kit chưa giao Line và không còn vật liệu đã kitting (đã trả kho / chuyển hết).
// Kit còn PO khác thì giữ kit, tính lại số cần ở lần mở kitting tới.
export function dropCancelled(db, { kitId }, user) {
  return tx(db, () => {
    const kit = loadKit(db, kitId), pos = kitPos(db, kit.id), gone = pos.filter(isCancelled);
    if (!gone.length) throw fail(`${kit.code} không có PO hủy.`);
    if (kit.vln_status === 'delivered') throw fail(`${kit.code} đã giao ${kit.line}: thu hồi từ line trước (Điều chỉnh kit → Thu hồi).`);
    const left = items(db, kit.id).filter(i => i.kitted > 0);
    if (left.length) throw fail(`${kit.code} còn ${left.length} mã đã kitting: trả kho hoặc chuyển PO khác trước (Điều chỉnh kit, lý do PO hủy / hoãn).`);
    for (const p of gone) db.prepare('DELETE FROM kit_order_po WHERE kit_id = ? AND po_key = ?').run(kit.id, p.po_key);
    const freed = dropOrphanLoads(db, kit.id);
    const rest = pos.length - gone.length - freed.length;
    db.prepare('DELETE FROM kit_item WHERE kit_id = ?').run(kit.id);
    if (!rest) db.prepare('DELETE FROM kit_order WHERE id = ?').run(kit.id);
    else {
      const first = kitPos(db, kit.id)[0];
      db.prepare("UPDATE kit_order SET model_code = ?, kind = CASE WHEN ? > 1 THEN kind ELSE 'single' END, vln_status = 'pending', hv_status = 'pending', updated_at = datetime('now') WHERE id = ?").run(first.model_code, rest, kit.id);
    }
    logTxn(db, { kitCode: kit.code, type: 'po_cancel', note: gone.map(p => p.po_no).join(', '), user });
    return { ok: true, message: rest ? `${kit.code}: đã gỡ ${gone.length} PO hủy, còn ${rest} PO` : `Đã gỡ ${kit.code} khỏi kế hoạch` };
  });
}

/* ---------- Sửa / hủy PO nội bộ (quyền internalPo: Planner, Admin) (Unplan / RMA) tạo sai ----------
   Kit chứa PO đã soạn mã nào (hoặc đã sang trạng thái khác "chưa làm") → chỉ sửa Số biên bản / Ghi chú; muốn đổi SL / Line / Model Code
   thì Kho thu hồi / trả kho trước. Kit chưa soạn: sửa xong xóa kit_item để định mức tính lại theo BOM. */
function internalPo(db, po) {
  const p = db.prepare('SELECT * FROM po WHERE po_key = ?').get(normalizePo(po));
  if (!p) throw fail('Không tìm thấy PO.', 404);
  if (!PO_TYPES[p.po_type]) throw fail(`${p.po_no} không phải PO nội bộ (Unplan / RMA).`);
  if (isCancelled(p)) throw fail(`${p.po_no} đã hủy.`);
  const kit = db.prepare('SELECT k.* FROM kit_order_po x JOIN kit_order k ON k.id = x.kit_id WHERE x.po_key = ?').get(p.po_key) || null;
  const locked = !!kit && (kit.vln_status !== 'pending' || kit.hv_status !== 'pending' || !!db.prepare('SELECT 1 FROM kit_item WHERE kit_id = ? AND kitted > 0 LIMIT 1').get(kit.id));
  return { p, kit, locked };
}
function poHist(db, key, kind, changes, username, action, detail) {
  db.prepare('INSERT INTO po_history(po_key, import_id, kind, changes) VALUES (?,?,?,?)').run(key, null, kind, JSON.stringify({ ...changes, _by: username || '' }));
  db.prepare('INSERT INTO audit_log(username, action, detail) VALUES (?, ?, ?)').run(username || '', action, JSON.stringify(detail));
}
export function editInternalPo(db, body, username) {
  return tx(db, () => {
    const { p, kit, locked } = internalPo(db, body?.po);
    if (p.po_type === 'LOAD') return editLoadPo(db, p, kit, locked, body, username);
    const modelCode = String(body?.modelCode ?? p.model_code).trim(), line = String(body?.line ?? p.fixed_line).trim(), qty = Number(body?.qty ?? p.plan_qty);
    const planDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.planDate || '')) ? body.planDate : p.plan_date;
    const time = body?.planTime === undefined ? String(p.plan_start || '').slice(11, 16) : /^\d{2}:\d{2}$/.test(String(body.planTime)) ? body.planTime : '';
    const planStart = time ? `${planDate}T${time}` : '';
    const refDoc = String(body?.refDoc ?? p.ref_doc ?? '').trim().slice(0, 60), note = String(body?.note ?? p.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!refDoc) throw fail(p.po_type === 'RMA' ? 'Nhập số RMA / chứng từ tham chiếu.' : 'Nhập số biên bản xác nhận lỗi.');
    const next = { model_code: modelCode, fixed_line: line, plan_qty: qty, plan_date: planDate, plan_start: planStart, ref_doc: refDoc, note: note || null };
    const changes = {};
    const nz = v => v === '' || v === undefined ? null : v;
    for (const [f, v] of Object.entries(next)) if (nz(p[f]) !== nz(v)) changes[f] = [nz(p[f]), nz(v)];
    if (!Object.keys(changes).length) return { ok: true, po: p.po_no, message: 'Không có gì thay đổi.' };
    const core = ['model_code', 'fixed_line', 'plan_qty', 'plan_date', 'plan_start'].filter(f => changes[f]);
    if (core.length && locked) throw fail(`${kit.code} đã bắt đầu kitting: chỉ sửa được Số biên bản / Ghi chú. Muốn đổi SL, Line, Model Code, ngày thì Kho thu hồi / trả kho trước.`);
    if (changes.model_code && !db.prepare('SELECT 1 FROM bom WHERE model_code = ? LIMIT 1').get(modelCode)) throw fail(`Model Code "${modelCode}" chưa có BOM.`);
    if (changes.fixed_line && !db.prepare('SELECT 1 FROM lines WHERE name = ? AND active = 1').get(line)) throw fail('Chọn Line sản xuất có trong danh sách.');
    if (!Number.isInteger(qty) || qty < 1 || qty > 100000) throw fail('Số lượng là số nguyên 1–100.000.');
    if (qty < (p.production_qty || 0)) throw fail(`Số lượng không được nhỏ hơn số đã sản xuất (${p.production_qty}).`);
    if (kit) {
      const others = kitPos(db, kit.id).filter(o => o.po_key !== p.po_key);
      if (others.length) {
        const model = modelOf(db, modelCode, ''), om = new Set(others.map(o => modelOf(db, o.model_code, o.basic_model)));
        if (changes.model_code && (om.size > 1 || !om.has(model))) throw fail(`${kit.code} là Kit gộp Model ${[...om].join(', ')}: Model Code mới phải cùng Model.`);
        const maxQty = Number(getSettings(db).merge_max_qty) || 2500, total = others.reduce((a, o) => a + o.plan_qty, 0) + qty;
        if (changes.plan_qty && total > maxQty) throw fail(`${kit.code}: tổng SL ${total} vượt giới hạn gộp ${maxQty} ea.`);
        const fx = others.map(o => o.fixed_line).filter(Boolean).find(l => l !== line);
        if (changes.fixed_line && fx) throw fail(`${kit.code} có PO nội bộ khác ấn định ${fx}: không đổi sang ${line} được (tách kit trước).`);
      }
    }
    if (changes.plan_qty) changes.remain_qty = [p.remain_qty, qty - (p.production_qty || 0)];
    db.prepare('UPDATE po SET model_code = ?, fixed_line = ?, plan_qty = ?, remain_qty = ?, plan_date = ?, plan_start = ?, ref_doc = ?, note = ? WHERE po_key = ?')
      .run(modelCode, line, qty, qty - (p.production_qty || 0), planDate, planStart, refDoc, note || null, p.po_key);
    if (kit && core.length) {
      const first = kitPos(db, kit.id)[0];
      db.prepare("UPDATE kit_order SET model_code = ?, updated_at = datetime('now') WHERE id = ?").run(first.model_code, kit.id);
      db.prepare('DELETE FROM kit_item WHERE kit_id = ?').run(kit.id);   // chưa soạn mã nào → định mức tính lại khi mở
    }
    poHist(db, p.po_key, 'edit', changes, username, 'po.internal.edit', { po: p.po_no, changes });
    return { ok: true, po: p.po_no, message: `Đã sửa ${p.po_no}${kit && core.length ? ` · ${kit.code} tính lại định mức` : ''}` };
  });
}
// Sửa PO Load thành phẩm: SL nhập số dương (lưu âm), số phiếu xuất kho, ghi chú; đổi Model Code chỉ khi chưa nằm trong Kit.
function editLoadPo(db, p, kit, locked, body, username) {
  const qty = Number(body?.qty ?? -p.plan_qty), modelCode = String(body?.modelCode ?? p.model_code).trim();
  const refDoc = String(body?.refDoc ?? p.ref_doc ?? '').trim().slice(0, 60), note = String(body?.note ?? p.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!refDoc) throw fail('Nhập số phiếu xuất kho thành phẩm.');
  if (!Number.isInteger(qty) || qty < 1 || qty > 100000) throw fail('Số lượng là số nguyên 1–100.000.');
  const nz = v => v === '' || v === undefined ? null : v, next = { model_code: modelCode, plan_qty: -qty, ref_doc: refDoc, note: note || null }, changes = {};
  for (const [f, v] of Object.entries(next)) if (nz(p[f]) !== nz(v)) changes[f] = [nz(p[f]), nz(v)];
  if (!Object.keys(changes).length) return { ok: true, po: p.po_no, message: 'Không có gì thay đổi.' };
  if ((changes.plan_qty || changes.model_code) && locked) throw fail(`${kit.code} đã bắt đầu kitting: chỉ sửa được số phiếu / ghi chú.`);
  if (changes.model_code && kit) throw fail(`${p.po_no} đang ở ${kit.code}: muốn đổi Model Code thì tách Kit trước.`);
  if (changes.model_code && !db.prepare('SELECT 1 FROM bom WHERE model_code = ? LIMIT 1').get(modelCode)) throw fail(`Model Code "${modelCode}" chưa có BOM.`);
  if (kit && changes.plan_qty) assertLoads(kitPos(db, kit.id).map(o => o.po_key === p.po_key ? { ...o, plan_qty: -qty } : o));
  if (changes.plan_qty) changes.remain_qty = [p.remain_qty, -qty];
  db.prepare('UPDATE po SET model_code = ?, plan_qty = ?, remain_qty = ?, ref_doc = ?, note = ? WHERE po_key = ?').run(modelCode, -qty, -qty, refDoc, note || null, p.po_key);
  if (kit && changes.plan_qty) db.prepare('DELETE FROM kit_item WHERE kit_id = ?').run(kit.id);
  poHist(db, p.po_key, 'edit', changes, username, 'po.internal.edit', { po: p.po_no, changes });
  return { ok: true, po: p.po_no, message: `Đã sửa ${p.po_no}${kit && changes.plan_qty ? ` · ${kit.code} tính lại định mức` : ''}` };
}
export function cancelInternalPo(db, body, username) {
  return tx(db, () => {
    const { p, kit, locked } = internalPo(db, body?.po), reason = String(body?.reason || '').trim().slice(0, 200);
    if (!reason) throw fail('Nhập lý do hủy.');
    if (locked) throw fail(`${kit.code} đã bắt đầu kitting / giao Line: Kho thu hồi / trả kho trước rồi mới hủy được.`);
    if (kit) {
      db.prepare('DELETE FROM kit_order_po WHERE kit_id = ? AND po_key = ?').run(kit.id, p.po_key);
      db.prepare('DELETE FROM kit_item WHERE kit_id = ?').run(kit.id);
      dropOrphanLoads(db, kit.id);
      const rest = kitPos(db, kit.id);
      if (!rest.length) db.prepare('DELETE FROM kit_order WHERE id = ?').run(kit.id);
      else db.prepare("UPDATE kit_order SET model_code = ?, kind = CASE WHEN ? > 1 THEN kind ELSE 'single' END, updated_at = datetime('now') WHERE id = ?").run(rest[0].model_code, rest.length, kit.id);
    }
    db.prepare("UPDATE po SET plan_status = 'Cancel' WHERE po_key = ?").run(p.po_key);
    poHist(db, p.po_key, 'cancel', { plan_status: [p.plan_status || null, 'Cancel'], reason: [null, reason] }, username, 'po.internal.cancel', { po: p.po_no, reason, kit: kit?.code || null });
    return { ok: true, po: p.po_no, message: `Đã hủy ${p.po_no}${kit ? ` · gỡ khỏi ${kit.code}` : ''}` };
  });
}
