// Ghi danh sách PO từ nguồn vào SQLite. Kế hoạch kitting/gộp PO do app quản lý không bị ghi đè.
import { tx, normalizePo, fail } from './db.mjs';

export function modelOf(db, modelCode, basicModel) {
  const row = db.prepare('SELECT model FROM model_map WHERE model_code = ?').get(modelCode);
  return row ? row.model : String(basicModel || '').slice(0, 8);   // giống công thức LEFT(Basic Model, 8) của Plan Master
}

// PO hủy: Plan Status trong Plan Master = "Cancel" (không phân biệt hoa thường, nhận cả Cancelled).
export const isCancelled = p => /^cancel/i.test(String(p?.plan_status ?? p?.planStatus ?? '').trim());
export const notCancelledSql = (a = '') => `lower(trim(coalesce(${a}plan_status, ''))) NOT LIKE 'cancel%'`;

// Lịch sử thay đổi PO qua các lần nhập: kind new | change | cancel | gone | back; changes = {cột: [cũ, mới]}.
export function ensurePoSchema(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS po_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, po_key TEXT NOT NULL, import_id INTEGER, kind TEXT NOT NULL, changes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS po_history_key ON po_history(po_key, id);
  `);
  // Cột PO nội bộ (bản cũ chưa có): thêm nếu thiếu.
  const cols = db.prepare("SELECT name FROM pragma_table_info('po')").all().map(c => c.name);
  for (const [c, def] of PO_EXTRA_COLS) if (!cols.includes(c)) db.exec(`ALTER TABLE po ADD COLUMN ${c} ${def}`);
}
export const PO_EXTRA_COLS = [['po_type', "TEXT NOT NULL DEFAULT 'SAP'"], ['fixed_line', 'TEXT'], ['ref_doc', 'TEXT'], ['note', 'TEXT'], ['created_by', 'TEXT'], ['mes_synced_at', 'TEXT'], ['int_status', 'TEXT']];
const TRACK = { model_code: 'modelCode', plan_date: 'planDate', plan_qty: 'planQty', production_qty: 'productionQty', remain_qty: 'remainQty', plan_status: 'planStatus', plan_start: 'planStart' };

// Nhập PO của Planner (file Order List / Plan Master) hoặc API /api/mmx/po: tạo PO mới + cập nhật thông tin kế hoạch của PO đã có.
// KHÔNG đổi số sản xuất (Production / Remain) của PO đã có — số này cập nhật qua cổng sản xuất (updateProduction).
// Cột không có trong file (Plan Status, Basic Model…) thì giữ giá trị cũ. fullSnapshot = true: PO không có trong nguồn bị đánh dấu "mất khỏi nguồn".
export function syncPoRows(db, rows, { source, username, fullSnapshot = false }) {
  if (!Array.isArray(rows) || !rows.length) throw fail('Nguồn không có PO.');
  const seen = new Set();
  for (const row of rows) {
    const k = normalizePo(row.po);
    if (seen.has(k)) throw fail(`PO ${row.po} bị lặp trong file nguồn.`);
    seen.add(k);
  }
  return tx(db, () => {
    const existing = new Map(db.prepare('SELECT * FROM po').all().map(r => [r.po_key, r]));
    const importId = Number(db.prepare('INSERT INTO import_log(kind, source, summary, created_by) VALUES (?,?,?,?)').run('PO', source || '', '{}', username || '').lastInsertRowid);
    const hist = db.prepare('INSERT INTO po_history(po_key, import_id, kind, changes) VALUES (?,?,?,?)');
    const ins = db.prepare(`INSERT INTO po (po_key, po_no, plan_date, master_line, basic_model, model_code, plan_qty, production_qty,
        remain_qty, plan_status, plan_start, plan_end, span_time, po_change, pending_type, in_source, synced_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,datetime('now'))`);
    const upd = db.prepare(`UPDATE po SET po_no = ?, plan_date = ?, master_line = ?, basic_model = ?, model_code = ?, plan_qty = ?, remain_qty = ?,
        plan_status = ?, plan_start = ?, plan_end = ?, span_time = ?, po_change = ?, pending_type = ?, in_source = 1, synced_at = datetime('now') WHERE po_key = ?`);
    const keep = (v, old) => (v === undefined || v === null || v === '') ? old : v;
    let inserted = 0, updated = 0, changed = 0;
    const changedModel = [], cancelled = [];
    for (const r of rows) {
      const k = normalizePo(r.po), old = existing.get(k), planQty = Number(r.planQty) || 0;
      if (!old) {
        const prod = Number(r.productionQty) || 0, now = { plan_qty: planQty, remain_qty: Math.max(planQty - prod, 0), plan_status: r.planStatus || '' };
        ins.run(k, String(r.po), r.planDate || null, r.masterLine || '', r.basicModel || '', r.modelCode, planQty, prod, now.remain_qty,
          now.plan_status, r.planStart || '', r.planEnd || '', r.span || '', r.poChange || '', r.pendingType || '');
        inserted++;
        hist.run(k, importId, isCancelled(now) ? 'cancel' : 'new', JSON.stringify({ plan_qty: [null, planQty], remain_qty: [null, now.remain_qty], plan_status: [null, now.plan_status] }));
        if (isCancelled(now)) cancelled.push(String(r.po));
        continue;
      }
      updated++;
      const now = { model_code: r.modelCode, plan_date: keep(r.planDate, old.plan_date), plan_qty: planQty, production_qty: old.production_qty,
        remain_qty: planQty !== old.plan_qty ? Math.max(planQty - old.production_qty, 0) : old.remain_qty,
        plan_status: keep(r.planStatus, old.plan_status), plan_start: keep(r.planStart, old.plan_start) };
      if (old.model_code !== r.modelCode) changedModel.push(r.po);
      upd.run(String(r.po), now.plan_date, keep(r.masterLine, old.master_line), keep(r.basicModel, old.basic_model), now.model_code, now.plan_qty, now.remain_qty,
        now.plan_status, now.plan_start, keep(r.planEnd, old.plan_end), keep(r.span, old.span_time), keep(r.poChange, old.po_change), keep(r.pendingType, old.pending_type), k);
      const diff = diffPo(old, now);
      if (!old.in_source) diff.in_source = [0, 1];
      if (!Object.keys(diff).length) continue;
      changed++;
      const nowCancel = isCancelled(now) && !isCancelled(old);
      if (nowCancel) cancelled.push(String(r.po));
      hist.run(k, importId, nowCancel ? 'cancel' : !old.in_source ? 'back' : 'change', JSON.stringify(diff));
    }
    let missing = 0;
    if (fullSnapshot) {
      const mark = db.prepare('UPDATE po SET in_source = 0 WHERE po_key = ?');
      for (const [k, old] of existing) if (!seen.has(k)) {
        mark.run(k); missing++;
        if (old.in_source) hist.run(k, importId, 'gone', JSON.stringify({ in_source: [1, 0] }));
      }
    }
    const summary = { total: rows.length, inserted, updated, changed, missing, changedModel, cancelled };
    db.prepare('UPDATE import_log SET summary = ? WHERE id = ?').run(JSON.stringify(summary), importId);
    settleLoads(db);
    return summary;
  });
}
function diffPo(old, now) {
  const diff = {};
  for (const c of Object.keys(TRACK)) if (c in now && String(old[c] ?? '') !== String(now[c] ?? '')) diff[c] = [old[c] ?? null, now[c]];
  return diff;
}

/* ---------- MES đẩy thẳng kế hoạch + số sản xuất từng PO: POST /api/mmx/po-plan (schema MES.ProductionPlan.v1) ----------
   data = 1 PO hoặc mảng PO. Upsert theo PoNo, không bao giờ đánh dấu PO khác "mất khỏi nguồn". Không có gì đổi thì không ghi lịch sử.
   SyncedAtUtc cũ hơn bản đã nhận → bỏ qua (bản tin đến muộn). PO nội bộ (Unplan / RMA) không bị MES ghi đè. dry = chỉ phân loại, không ghi. */
export const MES_SCHEMA = 'MES.ProductionPlan.v1', MES_MAX = 5000;
const mesText = (v, n) => String(v ?? '').trim().slice(0, n);
const mesTime = v => { const m = String(v ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/); return m ? `${m[1]}T${m[2]}` : ''; };
const mesNum = v => { const s = String(v ?? '').replace(/,/g, '').trim(); if (s === '') return null; const x = Number(s); return Number.isFinite(x) && x >= 0 ? x : NaN; };
// Chuẩn hóa thời điểm UTC để so sánh chuỗi (không dùng Date.parse vì phần lẻ 7 chữ số).
const mesStamp = v => { const m = String(v ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z?$/); return m ? `${m[1]}T${m[2]}.${(m[3] || '').padEnd(7, '0').slice(0, 7)}Z` : ''; };
function mesRow(d) {
  const po = mesText(d?.PoNo, 60), modelCode = mesText(d?.ModelCode, 60), planQty = mesNum(d?.PlanQty), productionQty = mesNum(d?.ProductionQty), remainQty = mesNum(d?.RemainQty);
  if (!po) throw fail('Thiếu PoNo.');
  if (!modelCode) throw fail('Thiếu ModelCode.');
  if (planQty === null || Number.isNaN(planQty)) throw fail('PlanQty phải là số ≥ 0.');
  if (Number.isNaN(productionQty)) throw fail('ProductionQty phải là số ≥ 0.');
  if (Number.isNaN(remainQty)) throw fail('RemainQty phải là số ≥ 0.');
  const day = mesText(d?.PlanDate, 10);
  return { po, modelCode, planQty, productionQty, remainQty, planDate: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '', masterLine: mesText(d?.MasterLine, 60),
    planStatus: mesText(d?.PoStatus, 30), planStart: mesTime(d?.PlanStartAt), planEnd: mesTime(d?.PlanEndAt), synced: mesStamp(d?.SyncedAtUtc) };
}
export function syncMesPlan(db, body, { dry = false } = {}) {
  if (body?.schema !== MES_SCHEMA) throw fail(`schema phải là ${MES_SCHEMA}.`);
  const list = Array.isArray(body?.data) ? body.data : body?.data && typeof body.data === 'object' ? [body.data] : [];
  if (!list.length) throw fail('Thiếu data.');
  if (list.length > MES_MAX) throw fail(`Quá ${MES_MAX} PO trong một lần gửi.`);
  const rejected = [], latest = new Map();
  for (const d of list) {
    try { const r = mesRow(d), k = normalizePo(r.po), cur = latest.get(k); if (!cur || r.synced >= cur.synced) latest.set(k, r); }
    catch (e) { if (!e.status) throw e; rejected.push({ po: mesText(d?.PoNo, 60), error: e.message }); }
  }
  if (!latest.size) throw fail(rejected[0].error);
  const same = (a, b) => String(a ?? '') === String(b ?? ''), planRows = [], prodRows = [], stamps = [], newNoBom = new Set();
  let unchanged = 0, stale = 0, inserted = 0, updated = 0;
  for (const [k, r] of latest) {
    const old = db.prepare('SELECT * FROM po WHERE po_key = ?').get(k);
    if (old && (old.po_type || 'SAP') !== 'SAP') { rejected.push({ po: r.po, error: 'PO nội bộ trong app, MES không ghi đè.' }); continue; }
    if (old && r.synced && old.mes_synced_at && r.synced < old.mes_synced_at) { stale++; continue; }
    if (r.synced) stamps.push([r.synced, k]);
    const prod = r.productionQty ?? (old ? old.production_qty : 0), remain = r.remainQty ?? Math.max(r.planQty - prod, 0);
    if (!old) {
      inserted++; planRows.push({ ...r, productionQty: prod });
      if (remain !== Math.max(r.planQty - prod, 0)) prodRows.push({ po: r.po, productionQty: prod, remainQty: remain, status: r.planStatus });
      if (!db.prepare('SELECT 1 FROM bom WHERE model_code = ? LIMIT 1').get(r.modelCode)) newNoBom.add(r.modelCode);
      continue;
    }
    // Trường trống giữ giá trị cũ, giống syncPoRows.
    const planDiff = !old.in_source || !same(old.model_code, r.modelCode) || Number(old.plan_qty) !== r.planQty
      || [['plan_date', r.planDate], ['master_line', r.masterLine], ['plan_status', r.planStatus], ['plan_start', r.planStart], ['plan_end', r.planEnd]].some(([c, v]) => v && !same(old[c], v));
    const prodDiff = Number(old.production_qty) !== prod || Number(old.remain_qty) !== remain;
    if (!planDiff && !prodDiff) { unchanged++; continue; }
    updated++;
    if (planDiff) planRows.push({ ...r, productionQty: prod });
    if (prodDiff || planDiff) prodRows.push({ po: r.po, productionQty: prod, remainQty: remain, status: r.planStatus });
  }
  const res = { ok: true, dry, received: list.length, inserted, updated, unchanged, stale, rejected, newCodesNoBom: [...newNoBom], cancelled: [] };
  if (dry) return res;
  return tx(db, () => {
    if (planRows.length) res.cancelled.push(...syncPoRows(db, planRows, { source: 'API: MES', username: 'api' }).cancelled);
    if (prodRows.length) res.cancelled.push(...updateProduction(db, prodRows, { source: 'API: MES', username: 'api' }).cancelled);
    const st = db.prepare('UPDATE po SET mes_synced_at = ? WHERE po_key = ?');
    for (const [s, k] of stamps) st.run(s, k);
    res.cancelled = [...new Set(res.cancelled)];
    settleLoads(db);
    return res;
  });
}

// Cổng cập nhật sản xuất (tab Quản trị: file Excel; công cụ QR: /api/mmx/production).
// rows: [{ po, productionQty (lũy kế), remainQty?, status? }] — chỉ cập nhật PO đã có; PO lạ trả về danh sách unknown.
// Remain không gửi thì = Plan − Production. Status gửi kèm (VD Cancel) thì ghi vào Plan Status.
export function updateProduction(db, rows, { source, username }) {
  if (!Array.isArray(rows) || !rows.length) throw fail('Không có dòng cập nhật nào.');
  const seen = new Set();
  for (const r of rows) {
    const k = normalizePo(r.po);
    if (seen.has(k)) throw fail(`PO ${r.po} bị lặp trong dữ liệu cập nhật.`);
    seen.add(k);
  }
  return tx(db, () => {
    const importId = Number(db.prepare('INSERT INTO import_log(kind, source, summary, created_by) VALUES (?,?,?,?)').run('PROD', source || '', '{}', username || '').lastInsertRowid);
    const hist = db.prepare('INSERT INTO po_history(po_key, import_id, kind, changes) VALUES (?,?,?,?)');
    const upd = db.prepare("UPDATE po SET production_qty = ?, remain_qty = ?, plan_status = ?, synced_at = datetime('now') WHERE po_key = ?");
    const unknown = [], cancelled = [], decreased = [];
    let updated = 0;
    for (const r of rows) {
      const k = normalizePo(r.po), old = db.prepare('SELECT * FROM po WHERE po_key = ?').get(k);
      if (!old) { unknown.push(String(r.po)); continue; }
      const prod = Number(r.productionQty) || 0;
      const now = { production_qty: prod, remain_qty: r.remainQty === null || r.remainQty === undefined ? Math.max(old.plan_qty - prod, 0) : Number(r.remainQty),
        plan_status: r.status ? r.status : old.plan_status };
      const diff = diffPo(old, now);
      if (!Object.keys(diff).length) continue;
      if (prod < old.production_qty) decreased.push(String(r.po));
      upd.run(now.production_qty, now.remain_qty, now.plan_status, k);
      const nowCancel = isCancelled(now) && !isCancelled(old);
      if (nowCancel) cancelled.push(String(r.po));
      hist.run(k, importId, nowCancel ? 'cancel' : 'prod', JSON.stringify(diff));
      updated++;
    }
    const summary = { total: rows.length, updated, unchanged: rows.length - updated - unknown.length, unknown, cancelled, decreased };
    db.prepare('UPDATE import_log SET summary = ? WHERE id = ?').run(JSON.stringify({ ...summary, unknown: unknown.slice(0, 200) }), importId);
    settleLoads(db);
    return summary;
  });
}
// PO nội bộ do Planner tạo: Unplan (cấp bù vật liệu lỗi hỏng đã xác nhận), RMA (sản xuất bù hàng khách trả).
// Kitting theo BOM như PO thường; ấn định Line — gộp được với PO thường, nhưng kit có PO nội bộ chỉ giao đúng Line đó.
// Số PO 12 ký tự như PO SAP: UP/RM + YYMMDD (ngày tạo, giờ VN) + NNNN (thứ tự trong ngày) — có chữ nên không trùng PO SAP.
export const PO_TYPES = { UNPLAN: { prefix: 'UP', label: 'Unplan' }, RMA: { prefix: 'RM', label: 'RMA' }, LOAD: { prefix: 'TP', label: 'Load thành phẩm' } };
// PO Load thành phẩm: Kho cấp hàng đã sản xuất xong cho Line để hoàn thành PO thật. Planner nhập số dương, PO lưu SỐ ÂM
// (plan_qty = remain_qty = −SL) → gộp vào Kit có PO thật cùng Model Code thì BOM × tổng SL tự trừ vật liệu (cả Rear).
export const isLoad = p => p?.po_type === 'LOAD';
export function internalPoOptions(db) {
  return { types: Object.entries(PO_TYPES).map(([k, v]) => ({ key: k, label: v.label })),
    lines: db.prepare('SELECT name FROM lines WHERE active = 1 ORDER BY sort_order, name').all().map(r => r.name),
    codes: db.prepare('SELECT b.model_code code, COALESCE(m.model, \'\') model FROM (SELECT DISTINCT model_code FROM bom) b LEFT JOIN model_map m ON m.model_code = b.model_code ORDER BY 2, 1').all() };
}
export function createInternalPo(db, body, username) {
  const t = String(body?.type || '').toUpperCase(), type = PO_TYPES[t];
  if (!type) throw fail('Chọn loại PO: Unplan, RMA hoặc Load thành phẩm.');
  const load = t === 'LOAD';
  const modelCode = String(body?.modelCode || '').trim(), line = load ? '' : String(body?.line || '').trim(), qty = Number(body?.qty);
  if (!db.prepare('SELECT 1 FROM bom WHERE model_code = ? LIMIT 1').get(modelCode)) throw fail(`Model Code "${modelCode}" chưa có BOM.`);
  if (!load && !db.prepare('SELECT 1 FROM lines WHERE name = ? AND active = 1').get(line)) throw fail('Chọn Line sản xuất có trong danh sách.');
  if (!Number.isInteger(qty) || qty < 1 || qty > 100000) throw fail('Số lượng là số nguyên 1–100.000.');
  const now = new Date(Date.now() + 7 * 3600000).toISOString(), today = now.slice(0, 10);
  const planDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.planDate || '')) ? body.planDate : today;
  const time = /^\d{2}:\d{2}$/.test(String(body?.planTime || '')) ? body.planTime : '';
  const refDoc = String(body?.refDoc || '').trim().slice(0, 60), note = String(body?.note || '').trim().slice(0, 200);
  if (!refDoc) throw fail(t === 'RMA' ? 'Nhập số RMA / chứng từ tham chiếu.' : load ? 'Nhập số phiếu xuất kho thành phẩm.' : 'Nhập số biên bản xác nhận lỗi.');
  const planQty = load ? -qty : qty;
  return tx(db, () => {
    const head = type.prefix + today.slice(2).replace(/-/g, '');
    const last = db.prepare('SELECT MAX(po_no) n FROM po WHERE po_no LIKE ?').get(`${head}%`).n;
    const seq = (last ? Number(String(last).slice(head.length)) : 0) + 1;
    if (seq > 9999) throw fail('Quá 9.999 PO nội bộ cùng loại trong ngày.');
    const po = head + String(seq).padStart(4, '0'), k = normalizePo(po);
    db.prepare(`INSERT INTO po (po_key, po_no, plan_date, master_line, basic_model, model_code, plan_qty, production_qty, remain_qty, plan_status,
        plan_start, plan_end, span_time, po_change, pending_type, po_type, fixed_line, ref_doc, note, created_by, in_source, synced_at)
      VALUES (?,?,?,'','',?,?,0,?,'',?,'','','','',?,?,?,?,?,1,datetime('now'))`)
      .run(k, po, planDate, modelCode, planQty, planQty, time ? `${planDate}T${time}` : '', t, line, refDoc, note, username || '');
    db.prepare('INSERT INTO po_history(po_key, import_id, kind, changes) VALUES (?,?,?,?)').run(k, null, 'new',
      JSON.stringify({ po_type: [null, type.label], fixed_line: [null, line || null], plan_qty: [null, planQty], ref_doc: [null, refDoc], created_by: [null, username || ''] }));
    db.prepare('INSERT INTO audit_log(username, action, detail) VALUES (?, ?, ?)').run(username || '', 'po.internal', JSON.stringify({ po, type: t, modelCode, qty, line, refDoc }));
    return { ok: true, po, message: load ? `Đã tạo PO Load thành phẩm ${po} · ${modelCode} · Kho cấp ${qty} ea (PO −${qty}) — gộp vào Kit có PO thật cùng Model Code` : `Đã tạo PO ${type.label} ${po} · ${modelCode} · ${qty} ea · ${line}` };
  });
}
export function productionLog(db, limit = 20) {
  return db.prepare("SELECT id, source, summary, created_by, created_at FROM import_log WHERE kind = 'PROD' ORDER BY id DESC LIMIT ?").all(limit)
    .map(r => ({ ...r, summary: JSON.parse(r.summary || '{}') }));
}

export function poHistory(db, po) {
  const key = normalizePo(po);
  const p = db.prepare('SELECT * FROM po WHERE po_key = ?').get(key);
  if (!p) throw fail('Không tìm thấy PO.', 404);
  const rows = db.prepare(`SELECT h.id, h.kind, h.changes, h.created_at, l.source, l.created_by FROM po_history h
    LEFT JOIN import_log l ON l.id = h.import_id WHERE h.po_key = ? ORDER BY h.id DESC LIMIT 200`).all(key);
  // PO nội bộ: thông tin để sửa / hủy (quyền internalPo); locked = kit đã bắt đầu kitting (chỉ sửa chứng từ / ghi chú)
  const kit = PO_TYPES[p.po_type] ? db.prepare(`SELECT k.code, (k.vln_status <> 'pending' OR k.hv_status <> 'pending' OR EXISTS (SELECT 1 FROM kit_item i WHERE i.kit_id = k.id AND i.kitted > 0)) locked
    FROM kit_order_po x JOIN kit_order k ON k.id = x.kit_id WHERE x.po_key = ?`).get(key) : null;
  const internal = PO_TYPES[p.po_type] ? { type: p.po_type, label: PO_TYPES[p.po_type].label, modelCode: p.model_code, line: p.fixed_line || '', qty: p.po_type === 'LOAD' ? -p.plan_qty : p.plan_qty, production: p.production_qty || 0,
    planDate: p.plan_date || '', planTime: String(p.plan_start || '').slice(11, 16), refDoc: p.ref_doc || '', note: p.note || '', cancelled: isCancelled(p), kit: kit?.code || '', locked: !!kit?.locked } : null;
  return { po: p.po_no, note: p.note || '', internal, rows: rows.map(r => {
    const { _by, ...changes } = JSON.parse(r.changes || '{}');
    return { kind: r.kind, at: r.created_at, source: r.source || (_by ? (r.kind === 'edit' || r.kind === 'cancel' ? _by : `Planner · ${_by}`) : ''), by: r.created_by || _by || '', changes };
  }) };
}
// Ghi chú của Planner trên 1 PO — hiện cho Kho / Kitting / SX; nhập lại file PO không ghi đè.
export function setPoNote(db, body, username) {
  const key = normalizePo(body?.po), note = String(body?.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const p = db.prepare('SELECT po_no, note FROM po WHERE po_key = ?').get(key);
  if (!p) throw fail('Không tìm thấy PO.', 404);
  const old = p.note || '';
  if (old === note) return { ok: true, po: p.po_no, note, message: 'Ghi chú không đổi.' };
  return tx(db, () => {
    db.prepare('UPDATE po SET note = ? WHERE po_key = ?').run(note || null, key);
    db.prepare('INSERT INTO po_history(po_key, import_id, kind, changes) VALUES (?,?,?,?)').run(key, null, 'note', JSON.stringify({ note: [old || null, note || null], _by: username || '' }));
    db.prepare('INSERT INTO audit_log(username, action, detail) VALUES (?, ?, ?)').run(username || '', 'po.note', JSON.stringify({ po: p.po_no, note }));
    return { ok: true, po: p.po_no, note, message: note ? `Đã lưu ghi chú PO ${p.po_no}` : `Đã xóa ghi chú PO ${p.po_no}` };
  });
}

export function productionState(po) {
  if (isCancelled(po)) return 'cancel';
  if (po.po_type === 'LOAD') return po.int_status === 'done' ? 'done' : 'waiting';   // tự Hoàn thành theo PO thật (settleLoads)
  if (Number(po.remain_qty) <= 0 && Number(po.production_qty) > 0) return 'done';
  if (Number(po.production_qty) > 0) return 'running';
  if (po.int_status === 'running' && po.po_type && po.po_type !== 'SAP') return 'running';   // PO nội bộ: Leader chuyển tay sang Đang SX
  return 'waiting';
}

// PO Load thành phẩm tự Hoàn thành khi Kit đã giao Line và mọi PO thật trong Kit đã xong (Remain ≤ 0) hoặc đã hủy:
// Production = Plan (số âm), Remain 0 → không còn treo trong Σ Remain của Line. Gọi sau mỗi lần cập nhật sản xuất + cron.
export function settleLoads(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'kit_order_po'").get()) return 0;
  const rows = db.prepare(`SELECT p.*, x.kit_id FROM po p JOIN kit_order_po x ON x.po_key = p.po_key JOIN kit_order k ON k.id = x.kit_id
    WHERE p.po_type = 'LOAD' AND COALESCE(p.int_status, '') <> 'done' AND k.vln_status = 'delivered'`).all();
  let n = 0;
  for (const p of rows) {
    if (isCancelled(p)) continue;
    const reals = db.prepare(`SELECT q.* FROM kit_order_po x JOIN po q ON q.po_key = x.po_key WHERE x.kit_id = ? AND COALESCE(q.po_type, 'SAP') <> 'LOAD'`).all(p.kit_id).filter(r => !isCancelled(r));
    if (reals.some(r => Number(r.remain_qty) > 0)) continue;
    db.prepare("UPDATE po SET production_qty = plan_qty, remain_qty = 0, int_status = 'done', synced_at = datetime('now') WHERE po_key = ?").run(p.po_key);
    db.prepare("INSERT INTO po_history(po_key, kind, changes) VALUES (?, 'prod', ?)").run(p.po_key, JSON.stringify({ int_status: [p.int_status || 'waiting', 'done'], remain_qty: [p.remain_qty, 0], _by: 'Tự động: PO thật cùng Kit đã xong' }));
    n++;
  }
  return n;
}
