// API chung (Line ↔ Model, tham số, PO, nhập PO/BOM dạng JSON, cài đặt, Line, nhật ký) — dùng cho PocketBase.
// Đăng nhập / tài khoản do nền tảng xử lý riêng.
import { getSettings, audit, fail } from './db.mjs';
import { syncPoRows, productionState, modelOf, poHistory, updateProduction, productionLog, createInternalPo, internalPoOptions, setPoNote } from './po-sync.mjs';
import { cancelAlerts, dropCancelled } from './kitting.mjs';
import { importBom } from './bom.mjs';
import { assertBomEditable } from './erp-stock.mjs';
import * as planning from './planning.mjs';
import { assertLineEditable } from './erp-line.mjs';
const PLAN = ['planner', 'admin'], ADMIN = ['admin'];
const trim = v => String(v ?? '').trim();
const MAX_ROWS = 20000;

// Kiểm tra dữ liệu PO gửi lên (từ file Excel đọc trên trình duyệt hoặc từ API ngoài).
// Lần lấy dữ liệu mới nhất của PO: giờ (UTC 'YYYY-MM-DD HH:MM:SS') và nguồn. Bản tin MES không đổi số vẫn tính là mới nhất nhờ SyncedAtUtc.
function poLatest(p, hist) {
  const mes = p.mes_synced_at ? p.mes_synced_at.slice(0, 19).replace('T', ' ') : '', at = [p.synced_at || '', mes].sort().at(-1);
  const src = hist?.source || '';
  const lastSource = mes && (!hist || mes > hist.created_at || src === 'API: MES') ? 'MES' : /^QR\b|^API: QR/i.test(src) ? 'QR' : /^API/i.test(src) ? 'API' : src ? 'File' : (p.po_type || 'SAP') !== 'SAP' ? 'Nội bộ' : 'File';
  return { lastAt: at, lastSource, lastSourceFull: mes && lastSource === 'MES' ? 'API: MES' : src };
}
export function cleanPoRows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw fail('Không có dòng PO nào.');
  if (rows.length > MAX_ROWS) throw fail(`Quá ${MAX_ROWS} dòng PO.`);
  const n = (v, label, i) => { const x = Number(v ?? 0); if (!Number.isFinite(x)) throw fail(`Dòng ${i + 1}: ${label} không phải số.`); return x; };
  const day = v => { const s = trim(v); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; };
  return rows.map((r, i) => {
    const po = trim(r.po), modelCode = trim(r.modelCode);
    if (!po || !modelCode) throw fail(`Dòng ${i + 1}: thiếu PO hoặc Model Code.`);
    return { po, modelCode, planDate: day(r.planDate), masterLine: trim(r.masterLine).slice(0, 60), basicModel: trim(r.basicModel).slice(0, 60),
      planQty: n(r.planQty, 'Plan', i), productionQty: n(r.productionQty, 'Production', i), remainQty: n(r.remainQty, 'Remain', i),
      planStatus: trim(r.planStatus).slice(0, 30), planStart: trim(r.planStart).slice(0, 20), planEnd: trim(r.planEnd).slice(0, 20), span: trim(r.span).slice(0, 10),
      poChange: trim(r.poChange).slice(0, 60), pendingType: trim(r.pendingType).slice(0, 60) };
  });
}
// Dòng cập nhật sản xuất (file Excel ở tab Quản trị / JSON công cụ QR): PO + Production lũy kế, Remain và Status tùy chọn.
export function cleanProdRows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw fail('Không có dòng cập nhật nào.');
  if (rows.length > MAX_ROWS) throw fail(`Quá ${MAX_ROWS} dòng.`);
  const n = (v, label, i) => { const x = Number(String(v).replace(/,/g, '')); if (!Number.isFinite(x) || x < 0) throw fail(`Dòng ${i + 1}: ${label} phải là số ≥ 0.`); return x; };
  return rows.map((r, i) => {
    const po = trim(r?.po);
    if (!po) throw fail(`Dòng ${i + 1}: thiếu PO.`);
    if (r.productionQty === undefined || r.productionQty === null || trim(r.productionQty) === '') throw fail(`Dòng ${i + 1}: thiếu Production Q'ty (PO ${po}).`);
    const remain = r.remainQty === undefined || r.remainQty === null || trim(r.remainQty) === '' ? null : n(r.remainQty, 'Remain', i);
    return { po, productionQty: n(r.productionQty, 'Production', i), remainQty: remain, status: trim(r.status).slice(0, 30) };
  });
}
export function cleanBom(parsed) {
  const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
  if (!rows.length) throw fail('File BOM chưa có dòng vật tư.');
  if (rows.length > 100000) throw fail('BOM quá lớn.');
  if (rows.some(r => /^MAU-/i.test(trim(r.modelCode)))) throw fail('File còn dòng mẫu (Model code MAU-…). Xóa các dòng mẫu rồi nhập lại.');
  const map = Array.isArray(parsed.modelMap) ? parsed.modelMap : [];
  return {
    rows: rows.map((r, i) => {
      const point = Number(r.point);
      if (!trim(r.modelCode) || !trim(r.material) || !(point > 0)) throw fail(`BOM dòng ${i + 1} không hợp lệ.`);
      return { modelCode: trim(r.modelCode), material: trim(r.material), description: trim(r.description).slice(0, 200), point, process: trim(r.process).slice(0, 20), group: ['VLN', 'VLDT', 'REAR'].includes(r.group) ? r.group : null };
    }),
    modelMap: new Map(map.filter(x => Array.isArray(x) && trim(x[0]) && trim(x[1])).map(x => [trim(x[0]), trim(x[1])])),
    vln: (Array.isArray(parsed.vln) ? parsed.vln : []).filter(v => trim(v.model) && trim(v.material) && Number(v.point) > 0),
    dup: Math.max(0, Number(parsed.dup) || 0)
  };
}

export function coreRoutes(db) {
  const today = () => planning.currentShift(db).day, shift0 = () => planning.currentShift(db).shift;
  return [
    { method: 'GET', path: '/api/lines/assign', handler: ({ query }) => planning.getAssign(db, query.get('day') || today(), query.get('shift') || shift0()) },
    { method: 'POST', path: '/api/lines/assign', roles: PLAN, handler: ({ body, user }) => { assertLineEditable(db); return planning.saveAssign(db, body || {}, user.username); } },
    { method: 'POST', path: '/api/lines/assign/copy', roles: PLAN, handler: ({ body, user }) => { assertLineEditable(db); return planning.copyAssign(db, body || {}, user.username); } },
    { method: 'GET', path: '/api/lines/params', handler: () => ({ ...planning.getParams(db), models: planning.modelList(db), lines: db.prepare('SELECT name FROM lines WHERE active = 1 ORDER BY sort_order, name').all().map(r => r.name) }) },
    { method: 'POST', path: '/api/lines/params', roles: PLAN, handler: ({ body, user }) => planning.saveParams(db, body?.rows, user.username) },
    { method: 'POST', path: '/api/lines/params/delete', roles: PLAN, handler: ({ body, user }) => planning.deleteParam(db, body || {}, user.username) },
    { method: 'GET', path: '/api/vln-overview', handler: ({ query }) => planning.vlnOverview(db, query.get('day') || today(), query.get('shift') || shift0()) },
    { method: 'GET', path: '/api/po', handler: () => {
      const rows = db.prepare(`SELECT p.*, k.code AS kit_code, k.plan_day, k.kind, m.model AS mapped_model,
          (SELECT h.id FROM po_history h WHERE h.po_key = p.po_key ORDER BY h.id DESC LIMIT 1) AS last_hist FROM po p
        LEFT JOIN kit_order_po x ON x.po_key = p.po_key LEFT JOIN kit_order k ON k.id = x.kit_id LEFT JOIN model_map m ON m.model_code = p.model_code
        ORDER BY p.plan_date, p.plan_start, p.po_no`).all();
      const histOf = db.prepare('SELECT h.created_at, l.source FROM po_history h LEFT JOIN import_log l ON l.id = h.import_id WHERE h.id = ?');
      const out = rows.map(p => ({ ...poLatest(p, p.last_hist ? histOf.get(p.last_hist) : null), planEnd: p.plan_end || '', po: p.po_no, planDate: p.plan_date, masterLine: p.master_line, basicModel: p.basic_model, modelCode: p.model_code,
        model: p.mapped_model || String(p.basic_model || '').slice(0, 8), planQty: p.plan_qty, productionQty: p.production_qty, remainQty: p.remain_qty,
        planStatus: p.plan_status, planStart: p.plan_start || '', state: productionState(p), inSource: !!p.in_source,
        poType: p.po_type || 'SAP', fixedLine: p.fixed_line || '', refDoc: p.ref_doc || '', note: p.note || '', createdBy: p.created_by || '', kitCode: p.kit_code || '', kitDay: p.plan_day || '', kitKind: p.kind || '' }));
      const last = db.prepare("SELECT * FROM import_log WHERE kind = 'PO' ORDER BY id DESC LIMIT 1").get();
      return { rows: out, total: rows.length, lastImport: last ? { ...last, summary: JSON.parse(last.summary || '{}') } : null, source: 'excel', alerts: cancelAlerts(db) };
    } },
    { method: 'GET', path: '/api/po/history', handler: ({ query }) => poHistory(db, query.get('po')) },
    { method: 'POST', path: '/api/po/note', roles: PLAN, handler: ({ body, user }) => setPoNote(db, body || {}, user.username) },
    { method: 'GET', path: '/api/po/internal/options', handler: () => internalPoOptions(db) },
    { method: 'POST', path: '/api/po/internal', handler: ({ body, user }) => createInternalPo(db, body || {}, user.username) },
    { method: 'POST', path: '/api/po/production', roles: ADMIN, handler: ({ body, user }) => ({ ok: true, file: trim(body?.source) || 'Excel', ...updateProduction(db, cleanProdRows(body?.rows), { source: trim(body?.source) || 'Excel', username: user.username }) }) },
    { method: 'GET', path: '/api/po/production/log', roles: ADMIN, handler: () => ({ rows: productionLog(db) }) },
    { method: 'POST', path: '/api/po/drop-cancelled', roles: ['planner', 'kho', 'admin'], handler: ({ body, user }) => dropCancelled(db, body || {}, user.username) },
    { method: 'POST', path: '/api/po/import', roles: PLAN, handler: ({ body, user }) => ({ ok: true, file: trim(body?.source) || 'Excel', ...syncPoRows(db, cleanPoRows(body?.rows), { source: trim(body?.source) || 'Excel', username: user.username }) }) },
    { method: 'POST', path: '/api/bom/import', roles: PLAN, handler: ({ body, user }) => { assertBomEditable(db); return { ok: true, file: trim(body?.source), ...importBom(db, cleanBom(body), { source: trim(body?.source) || 'Excel', username: user.username, dry: !!body?.dry }) }; } },
    { method: 'GET', path: '/api/admin/settings', roles: ADMIN, handler: () => ({ settings: getSettings(db), lines: db.prepare('SELECT * FROM lines ORDER BY sort_order, name').all(),
      audit: db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 50').all() }) },
    { method: 'POST', path: '/api/admin/settings', roles: ADMIN, handler: ({ body, user }) => {
      const threshold = Number(body?.supply_threshold), min = Number(body?.vln_min_per_line), max = Number(body?.vln_max_per_line), mergeMax = Number(body?.merge_max_qty ?? 2500);
      if (!Number.isInteger(mergeMax) || mergeMax < 1) throw fail('Giới hạn SL gộp phải là số nguyên dương.');
      const autoMax = Number(body?.auto_max_kits_day ?? getSettings(db).auto_max_kits_day);
      if (!Number.isInteger(autoMax) || autoMax < 0) throw fail('Số Kit tối đa / ngày phải là số nguyên ≥ 0 (0 = không giới hạn).');
      if (!Number.isFinite(threshold) || threshold < 0) throw fail('Ngưỡng cấp vật liệu phải ≥ 0.');
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) throw fail('Min/Max PO VLN chờ cấp phải là số nguyên, 0 ≤ min ≤ max.');
      const st = body?.shift_starts !== undefined ? String(body.shift_starts).split(',').map(x => x.trim()).filter(Boolean) : null;
      if (st && (st.length !== planning.shifts(db).length || st.some(x => !/^([01]\d|2[0-3]):[0-5]\d$/.test(x)) || st.some((x, i) => i && x <= st[i - 1]))) throw fail('Giờ bắt đầu ca: mỗi ca 1 giờ HH:MM, tăng dần, ví dụ 08:00,20:00.');
      const up = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
      up.run('supply_threshold', String(threshold)); up.run('vln_min_per_line', String(min)); up.run('vln_max_per_line', String(max)); up.run('merge_max_qty', String(mergeMax)); up.run('auto_max_kits_day', String(autoMax));
      if (st) up.run('shift_starts', st.join(','));
      audit(db, user.username, 'settings', { threshold, min, max, mergeMax, autoMax });
      return { ok: true };
    } },
    { method: 'POST', path: '/api/admin/lines', roles: ADMIN, handler: ({ body, user }) => {
      const name = trim(body?.name);
      if (!name || name.length > 40) throw fail('Nhập tên Line.');
      if ('active' in (body || {}) && db.prepare('SELECT 1 FROM lines WHERE name = ?').get(name)) db.prepare('UPDATE lines SET active = ? WHERE name = ?').run(body.active ? 1 : 0, name);
      else db.prepare('INSERT INTO lines(name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM lines)) ON CONFLICT(name) DO NOTHING').run(name);
      audit(db, user.username, 'line.manage', body);
      return { ok: true };
    } }
  ];
}
