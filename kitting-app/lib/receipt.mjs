// Line xác nhận đã nhận PO (Kit) Kho giao + trạng thái sản xuất PO nội bộ (Unplan / RMA).
// Cả hai đều cần "Leader giao nhận" ký: Mã NV + mật khẩu cấp 2 (quyền đặc biệt lineSign; tài khoản có gán Line chỉ ký cho Line đó).
// Kiểm tra chữ ký nằm ngoài lib (bảng users của PocketBase / bản chạy thử) → truyền vào dạng hàm sign(username, pin2, line):
//   { ok: true, username, name } hoặc { ok: false, message } (sai MK không ném lỗi để lần sai vẫn được ghi, chống dò).
// Nhận PO: quét QR trên phiếu kitting (mã Kit / số PO) → xem BOM với số đã giao + còn nợ → Xác nhận (xanh) hoặc Từ chối (báo Kho).
// Kho kiểm tra, điều chỉnh bằng chức năng sẵn có (giao bù nợ, thu hồi…) rồi bấm "Đã xử lý" → PO về "Chờ nhận", Line quét xác nhận lại.
import { tx, fail, audit, normalizePo } from './db.mjs';
import { modelOf, isCancelled, productionState } from './po-sync.mjs';
import { ensureLotSchema, lotStats, lotKey, lotsOfKit, lotCount, receiveLots, receivePendingLots, resolveLot, rejectedLots, lotsForLine, buList, buDetail, saveBu, LOT_STATUS } from './kit-lot.mjs';

export const RECEIPT_REASONS = { SHORT: 'Thiếu số lượng so với phiếu', OVER: 'Thừa số lượng so với phiếu', WRONG: 'Sai mã / lẫn vật liệu', DAMAGED: 'Vật liệu lỗi / hỏng', NO_REAR: 'Thiếu Rear', OTHER: 'Khác' };
export const RECEIPT_STATUS = { pending: 'Chờ nhận', received: 'Đã nhận', rejected: 'Từ chối' };
export const INT_STATES = { waiting: 'Chờ SX', running: 'Đang SX', done: 'Hoàn thành' };
const r3 = n => Math.round(Number(n) * 1000) / 1000;
const t = v => String(v ?? '').trim();

export function ensureReceiptSchema(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS kit_receipt (
    kit_id INTEGER PRIMARY KEY, kit_code TEXT NOT NULL, line TEXT, status TEXT NOT NULL DEFAULT 'pending',
    signer TEXT, signer_name TEXT, at TEXT, reason TEXT, note TEXT, snapshot TEXT,
    kho_note TEXT, kho_by TEXT, kho_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS kit_receipt_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kit_id INTEGER NOT NULL, kit_code TEXT NOT NULL, line TEXT, action TEXT NOT NULL,
    signer TEXT, username TEXT, reason TEXT, note TEXT, snapshot TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE INDEX IF NOT EXISTS kit_receipt_log_kit ON kit_receipt_log(kit_id);
  CREATE INDEX IF NOT EXISTS kit_receipt_status ON kit_receipt(status);`);
  if (!db.prepare("SELECT name FROM pragma_table_info('po')").all().some(c => c.name === 'int_status')) db.exec('ALTER TABLE po ADD COLUMN int_status TEXT');
  ensureLotSchema(db);
}

const kitPos = (db, kitId) => db.prepare('SELECT p.* FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = ? ORDER BY p.po_no').all(kitId);
// Kit còn ở Line cần xác nhận nhận = đã giao Line và còn ít nhất 1 PO chưa xong / chưa hủy.
const kitOpen = pos => pos.some(p => !['done', 'cancel'].includes(productionState(p)));
function loadDelivered(db, kitId) {
  const kit = db.prepare('SELECT * FROM kit_order WHERE id = ?').get(Number(kitId));
  if (!kit) throw fail('Không tìm thấy PO / Kit.', 404);
  if (kit.vln_status !== 'delivered') throw fail(`${kit.code} chưa được Kho giao cho Line.`);
  return kit;
}
// Trạng thái nhận của 1 Kit đã giao: không có dòng = Chờ nhận.
export function receiptOf(db, kitId) {   // gọi ensureReceiptSchema trước (1 lần mỗi yêu cầu)
  const r = db.prepare('SELECT * FROM kit_receipt WHERE kit_id = ?').get(Number(kitId));
  return r ? { status: r.status, signer: r.signer || '', signerName: r.signer_name || '', at: r.at || '', reason: r.reason || '', reasonText: RECEIPT_REASONS[r.reason] || '', note: r.note || '', khoNote: r.kho_note || '', khoBy: r.kho_by || '', khoAt: r.kho_at || '' }
    : { status: 'pending', signer: '', signerName: '', at: '', reason: '', reasonText: '', note: '', khoNote: '', khoBy: '', khoAt: '' };
}
// QR trên phiếu kitting = mã Kit (Kit 1 PO thì chính là số PO). Nhận thêm số PO gốc trong Kit; bỏ khoảng trắng, hoa thường, số 0 đứng đầu.
const scanKey = v => normalizePo(v).replace(/^0+(?=\d)/, '');
export function scanMatches(kit, pos, scanned) {
  const s = scanKey(scanned);
  return !!s && [kit.code, ...pos.map(p => p.po_no)].some(c => scanKey(c) === s);
}
function itemsOf(db, kitId) {
  return db.prepare(`SELECT grp, kit_group, model_code, material, description, required, delivered FROM kit_item WHERE kit_id = ?
    ORDER BY CASE kit_group WHEN 'REAR' THEN 0 WHEN 'VLDT' THEN 1 ELSE 2 END, model_code, material`).all(kitId)
    .map(i => ({ grp: i.grp, group: i.kit_group, code: i.model_code, material: i.material, description: i.description || '', required: r3(i.required), delivered: r3(i.delivered), debt: r3(Math.max(0, i.required - i.delivered)) }));
}
const snapOf = list => JSON.stringify(list.map(i => [i.group, i.code, i.material, i.required, i.delivered, i.debt]));

// Màn quét / xác nhận nhận PO: BOM với số đã giao thực tế (gồm giao bù, trừ thu hồi) và số còn nợ.
export function receiptView(db, kitId) {
  const kit = loadDelivered(db, kitId), pos = kitPos(db, kit.id);
  ensureReceiptSchema(db);
  // Giao đầu = số đang ở Line trừ phần giao bù (đã tính thu hồi nếu có); Giao bù = tổng các đợt bù + số đợt.
  const st = lotStats(db, kit.id), list = itemsOf(db, kit.id).map(i => { const s = st.get(lotKey(i.grp, i.code, i.material)); const bu = s?.bu || 0; return { ...i, initial: r3(Math.max(0, i.delivered - bu)), bu, buN: s?.n || 0 }; });
  const lots = lotsOfKit(db, kit.id);
  const log = db.prepare('SELECT * FROM kit_receipt_log WHERE kit_id = ? ORDER BY id DESC LIMIT 20').all(kit.id)
    .map(l => ({ action: l.action, signer: l.signer || '', by: l.username || '', reason: RECEIPT_REASONS[l.reason] || '', note: l.note || '', at: l.created_at }));
  return {
    kit: { id: kit.id, code: kit.code, kind: kit.kind, line: kit.line, deliveredAt: kit.delivered_at, deliveredBy: kit.delivered_by || '', model: modelOf(db, kit.model_code, pos[0]?.basic_model),
      pos: pos.map(p => ({ po: p.po_no, modelCode: p.model_code, qty: p.plan_qty, type: p.po_type || 'SAP' })), qty: pos.reduce((s, p) => s + p.plan_qty, 0),
      loadTp: pos.filter(p => p.po_type === 'LOAD' && !isCancelled(p)).map(p => ({ po: p.po_no, modelCode: p.model_code, qty: -p.plan_qty, ref: p.ref_doc || '' })) },
    receipt: receiptOf(db, kit.id), open: kitOpen(pos), items: list, lots, lotStatus: LOT_STATUS,
    totals: { bu: r3(list.reduce((s, i) => s + i.bu, 0)), lotsPending: lots.filter(l => l.status === 'pending').length, lotsRejected: lots.filter(l => l.status === 'rejected').length, items: list.length, required: r3(list.reduce((s, i) => s + i.required, 0)), delivered: r3(list.reduce((s, i) => s + i.delivered, 0)), debtItems: list.filter(i => i.debt > 0).length, debt: r3(list.reduce((s, i) => s + i.debt, 0)), rearDebt: list.filter(i => i.group === 'REAR' && i.debt > 0).length },
    reasons: RECEIPT_REASONS, log };
}

// Kiểm tra trước khi hỏi chữ ký (không tốn lượt nhập MK cấp 2 khi dữ liệu sai).
function checkReceive(db, { kitId, scanned }, action) {
  const kit = loadDelivered(db, kitId), pos = kitPos(db, kit.id);
  if (!scanMatches(kit, pos, scanned)) throw fail(t(scanned) ? `Sai PO: quét được "${t(scanned)}", PO đang nhận là ${kit.code}.` : 'Quét QR trên phiếu kitting trước khi xác nhận.');
  const cur = receiptOf(db, kit.id);
  if (cur.status === 'received') throw fail(`${kit.code} đã được ${cur.signerName || cur.signer} xác nhận nhận lúc ${cur.at}.`);
  if (action === 'receive' && cur.status === 'rejected') throw fail(`${kit.code} đang chờ Kho xử lý lần từ chối — Kho bấm "Đã xử lý" rồi mới xác nhận lại.`);
  if (action === 'reject' && cur.status === 'rejected') throw fail(`${kit.code} đã từ chối, đang chờ Kho xử lý.`);
  return kit;
}
function writeReceipt(db, kit, { status, signer, reason = null, note = null }, username) {
  const list = itemsOf(db, kit.id), snap = snapOf(list);
  db.prepare(`INSERT INTO kit_receipt(kit_id, kit_code, line, status, signer, signer_name, at, reason, note, snapshot, kho_note, kho_by, kho_at, updated_at)
      VALUES (?,?,?,?,?,?,datetime('now'),?,?,?,NULL,NULL,NULL,datetime('now'))
    ON CONFLICT(kit_id) DO UPDATE SET kit_code = excluded.kit_code, line = excluded.line, status = excluded.status, signer = excluded.signer, signer_name = excluded.signer_name,
      at = excluded.at, reason = excluded.reason, note = excluded.note, snapshot = excluded.snapshot, updated_at = excluded.updated_at`)
    .run(kit.id, kit.code, kit.line, status, signer.username, signer.name || signer.username, reason, note, snap);
  db.prepare('INSERT INTO kit_receipt_log(kit_id, kit_code, line, action, signer, username, reason, note, snapshot) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(kit.id, kit.code, kit.line, status === 'received' ? 'receive' : 'reject', signer.username, username, reason, note, snap);
  audit(db, username, status === 'received' ? 'receipt.receive' : 'receipt.reject', { kit: kit.code, line: kit.line, signer: signer.username, reason, note });
  return list;
}
export function receiveKit(db, body, user, sign) {
  ensureReceiptSchema(db);
  const kit = checkReceive(db, body, 'receive');
  const s = sign(body.signer, body.pin2, kit.line); if (!s.ok) return s;
  return tx(db, () => {
    const list = writeReceipt(db, kit, { status: 'received', signer: s }, user);
    receivePendingLots(db, kit.id, s, user);
    const debt = list.filter(i => i.debt > 0).length;
    return { ok: true, message: `${kit.code}: ${s.name || s.username} đã xác nhận nhận${debt ? ` · Kho còn nợ ${debt} mã` : ''}.` };
  });
}
export function rejectKit(db, body, user, sign) {
  ensureReceiptSchema(db);
  const reason = t(body.reason), note = t(body.note).slice(0, 300);
  if (!RECEIPT_REASONS[reason]) throw fail('Chọn lý do từ chối.');
  if (reason === 'OTHER' && !note) throw fail('Lý do "Khác" cần ghi chú.');
  const kit = checkReceive(db, body, 'reject');
  const s = sign(body.signer, body.pin2, kit.line); if (!s.ok) return s;
  return tx(db, () => {
    writeReceipt(db, kit, { status: 'rejected', signer: s, reason, note }, user);
    return { ok: true, message: `${kit.code}: đã từ chối nhận (${RECEIPT_REASONS[reason]}) — đã báo Kho kiểm tra.` };
  });
}
// Kho đã kiểm tra / điều chỉnh xong lần từ chối → PO về "Chờ nhận" để Line quét xác nhận lại.
export function resolveReject(db, { kitId, note }, user) {
  ensureReceiptSchema(db);
  const kit = loadDelivered(db, kitId), cur = receiptOf(db, kit.id), n = t(note).slice(0, 300);
  if (cur.status !== 'rejected') throw fail(`${kit.code} không ở trạng thái Line từ chối.`);
  if (!n) throw fail('Ghi chú Kho đã xử lý gì (VD: giao bù 20 ea mã …).');
  return tx(db, () => {
    db.prepare("UPDATE kit_receipt SET status = 'pending', kho_note = ?, kho_by = ?, kho_at = datetime('now'), updated_at = datetime('now') WHERE kit_id = ?").run(n, user, kit.id);
    db.prepare('INSERT INTO kit_receipt_log(kit_id, kit_code, line, action, username, note, snapshot) VALUES (?,?,?,?,?,?,?)').run(kit.id, kit.code, kit.line, 'resolve', user, n, snapOf(itemsOf(db, kit.id)));
    audit(db, user, 'receipt.resolve', { kit: kit.code, line: kit.line, note: n });
    return { ok: true, message: `${kit.code}: đã báo Line ${kit.line} quét xác nhận lại.` };
  });
}
// Danh sách cho Kho: PO Line từ chối (chờ Kho xử lý) + số PO đang chờ Line nhận.
export function khoReceipts(db) {
  ensureReceiptSchema(db);
  const rows = db.prepare(`SELECT r.*, k.delivered_at, k.model_code FROM kit_receipt r JOIN kit_order k ON k.id = r.kit_id WHERE r.status = 'rejected' AND k.vln_status = 'delivered' ORDER BY r.at`).all()
    .map(r => {
      const pos = kitPos(db, r.kit_id), list = itemsOf(db, r.kit_id);
      return { kitId: r.kit_id, code: r.kit_code, line: r.line, model: modelOf(db, r.model_code, pos[0]?.basic_model), pos: pos.map(p => p.po_no), at: r.at, signer: r.signer, signerName: r.signer_name,
        reason: r.reason, reasonText: RECEIPT_REASONS[r.reason] || r.reason, note: r.note || '', deliveredAt: r.delivered_at, debtItems: list.filter(i => i.debt > 0).length, debt: r3(list.reduce((s, i) => s + i.debt, 0)) };
    });
  return { rows, pending: pendingCount(db), lots: rejectedLots(db), lotsPending: db.prepare("SELECT COUNT(*) n FROM kit_lot l JOIN kit_order k ON k.id = l.kit_id WHERE l.status = 'pending' AND k.vln_status = 'delivered'").get().n };
}
function pendingCount(db) {
  return db.prepare(`SELECT k.id FROM kit_order k LEFT JOIN kit_receipt r ON r.kit_id = k.id WHERE k.vln_status = 'delivered' AND COALESCE(r.status, 'pending') = 'pending'`).all()
    .filter(k => kitOpen(kitPos(db, k.id))).length;
}
export function receiptBadges(db) {
  ensureReceiptSchema(db);
  return { rejected: db.prepare("SELECT COUNT(*) n FROM kit_receipt r JOIN kit_order k ON k.id = r.kit_id WHERE r.status = 'rejected' AND k.vln_status = 'delivered'").get().n
    + db.prepare("SELECT COUNT(*) n FROM kit_lot l JOIN kit_order k ON k.id = l.kit_id WHERE l.status = 'rejected' AND k.vln_status = 'delivered'").get().n };
}

/* ---------- trạng thái sản xuất PO nội bộ (Unplan / RMA): chuyển tay, chọn nhiều PO, Leader giao nhận ký ---------- */
// Chờ SX → Production 0; Đang SX → giữ số đã có (< Plan), Remain = Plan − Production; Hoàn thành → Production = Plan, Remain 0
// (PO không còn treo trong Σ Remain của Line). Lùi trạng thái được (bấm nhầm). Ghi po_history kind prod (_by = người ký) + audit.
export function setInternalStatus(db, body, user, sign) {
  ensureReceiptSchema(db);
  const status = t(body.status), line = t(body.line);
  if (!INT_STATES[status]) throw fail('Chọn trạng thái: Chờ SX, Đang SX hoặc Hoàn thành.');
  const list = [...new Set((Array.isArray(body.pos) ? body.pos : []).map(t).filter(Boolean))];
  if (!list.length) throw fail('Chọn ít nhất 1 PO nội bộ.');
  if (list.length > 100) throw fail('Tối đa 100 PO mỗi lần.');
  if (!line) throw fail('Chọn Line.');
  const rows = list.map(no => {
    const p = db.prepare(`SELECT p.*, k.line AS kit_line, k.vln_status FROM po p LEFT JOIN kit_order_po x ON x.po_key = p.po_key LEFT JOIN kit_order k ON k.id = x.kit_id WHERE p.po_key = ?`).get(normalizePo(no));
    if (!p) throw fail(`Không có PO ${no}.`);
    if (!p.po_type || p.po_type === 'SAP') throw fail(`${p.po_no} là PO SAP — tình trạng sản xuất cập nhật từ hệ thống, không chuyển tay.`);
    if (p.po_type === 'LOAD') throw fail(`${p.po_no} là PO Load thành phẩm — tự Hoàn thành khi PO thật cùng Kit xong.`);
    if (isCancelled(p)) throw fail(`${p.po_no} đã hủy.`);
    if (p.vln_status !== 'delivered' || p.kit_line !== line) throw fail(`${p.po_no} chưa được Kho giao cho ${line}.`);
    return p;
  });
  const s = sign(body.signer, body.pin2, line); if (!s.ok) return s;
  return tx(db, () => {
    const hist = db.prepare("INSERT INTO po_history(po_key, kind, changes) VALUES (?, 'prod', ?)");
    const upd = db.prepare("UPDATE po SET int_status = ?, production_qty = ?, remain_qty = ?, synced_at = datetime('now') WHERE po_key = ?");
    let n = 0;
    for (const p of rows) {
      const plan = Number(p.plan_qty) || 0, prod0 = Number(p.production_qty) || 0;
      const prod = status === 'done' ? plan : status === 'running' ? (prod0 < plan ? prod0 : 0) : 0, remain = Math.max(0, plan - prod);
      const was = p.int_status || productionState(p);
      if (was === status && prod === prod0 && remain === Number(p.remain_qty)) continue;
      const diff = { int_status: [was, status] };
      if (prod !== prod0) diff.production_qty = [prod0, prod];
      if (remain !== Number(p.remain_qty)) diff.remain_qty = [Number(p.remain_qty), remain];
      upd.run(status, prod, remain, p.po_key);
      hist.run(p.po_key, JSON.stringify({ ...diff, _by: `${s.username} (ký) · ${user}` }));
      n++;
    }
    audit(db, user, 'po.internal.status', { line, status, pos: rows.map(p => p.po_no), signer: s.username, changed: n });
    return { ok: true, updated: n, message: n ? `${s.name || s.username} xác nhận ${n} PO nội bộ → ${INT_STATES[status]}.` : `Các PO đã ở trạng thái ${INT_STATES[status]}.` };
  });
}

export function receiptRoutes(db, sign) {
  const signer = sign || (() => ({ ok: false, message: 'Chưa cấu hình xác nhận Leader.' }));
  return [
    { method: 'GET', path: '/api/prod/receipt', handler: ({ query }) => receiptView(db, query.get('kitId')) },
    { method: 'POST', path: '/api/prod/receipt/receive', handler: ({ body, user }) => receiveKit(db, body || {}, user.username, signer) },
    { method: 'POST', path: '/api/prod/receipt/reject', handler: ({ body, user }) => rejectKit(db, body || {}, user.username, signer) },
    { method: 'POST', path: '/api/prod/internal-status', handler: ({ body, user }) => setInternalStatus(db, body || {}, user.username, signer) },
    { method: 'GET', path: '/api/kho/receipts', handler: () => khoReceipts(db) },
    { method: 'POST', path: '/api/kho/receipt/resolve', handler: ({ body, user }) => resolveReject(db, body || {}, user.username) },
    // Giao bù theo đợt: Line ký nhận / từ chối; Kho xử lý lần từ chối; OP kho soạn bù
    { method: 'GET', path: '/api/prod/lots', handler: ({ query }) => lotsForLine(db, query.get('line') || '') },
    { method: 'POST', path: '/api/prod/lots/receive', handler: ({ body, user }) => receiveLots(db, body || {}, user.username, signer, RECEIPT_REASONS) },
    { method: 'POST', path: '/api/kho/lot/resolve', handler: ({ body, user }) => resolveLot(db, body || {}, user.username) },
    { method: 'GET', path: '/api/kho/bu', handler: () => buList(db) },
    { method: 'GET', path: '/api/kho/bu/kit', handler: ({ query }) => buDetail(db, query.get('id')) },
    { method: 'POST', path: '/api/kho/bu', handler: ({ body, user }) => saveBu(db, body || {}, user.username) }
  ];
}
