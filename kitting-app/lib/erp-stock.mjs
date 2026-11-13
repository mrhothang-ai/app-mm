// Tồn kho theo vị trí (doctype Bin = mã × vị trí; vị trí = Warehouse con) và BOM mặc định lấy từ Next ERP — CHỈ ĐỌC ERP.
// Tồn: thay toàn bộ bảng erp_stock mỗi lần đồng bộ (chỉ giữ bin ≠ 0); vị trí thuộc "Khu vực sản xuất" / tên "Line …" không tính là tồn Kho.
// BOM: ERP là gốc — chỉ kéo BOM mặc định đang hoạt động (is_default, is_active, đã submit) có thay đổi (modified) về MM qua importBom
// (code mới lấy tên Model = Item Group của mã thành phẩm, bỏ đuôi " AUTO"); nhóm kitting VLN / VLĐT / Rear vẫn là của MM.
// Đã đồng bộ BOM thành công và đang bật → khóa nhập BOM từ file / sửa dòng / ECN trong MM (nhóm kitting, Point VLN tay vẫn sửa được).
import { tx, fail, audit } from './db.mjs';
import { erpCfg, cfgGet, cfgSet, ensureErpSchema } from './erp-line.mjs';
import { importBom } from './bom.mjs';

const r3 = n => Math.round(Number(n) * 1000) / 1000;
export const STOCK_SKIP_PARENTS = ['Khu vực sản xuất'];   // nhóm kho không tính là tồn Kho (vật liệu đã ra Line)
const MAX_BOM_DOCS = 200;   // mỗi lần đồng bộ BOM tối đa chừng này BOM (mỗi BOM 1 lần gọi ERP), còn lại lần sau

export function ensureErpStockSchema(db) {
  ensureErpSchema(db);
  db.exec(`
  CREATE TABLE IF NOT EXISTS erp_stock (material TEXT NOT NULL, warehouse TEXT NOT NULL, qty REAL NOT NULL DEFAULT 0, reserved REAL NOT NULL DEFAULT 0, uom TEXT, PRIMARY KEY (material, warehouse));
  CREATE TABLE IF NOT EXISTS erp_wh (name TEXT PRIMARY KEY, label TEXT NOT NULL, parent TEXT, is_group INTEGER NOT NULL DEFAULT 0, wh_type TEXT, in_kho INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS erp_item (material TEXT PRIMARY KEY, name TEXT, item_group TEXT, default_loc TEXT, uom TEXT);
  CREATE TABLE IF NOT EXISTS erp_bom (item TEXT PRIMARY KEY, name TEXT NOT NULL, modified TEXT, lines INTEGER NOT NULL DEFAULT 0, synced_at TEXT NOT NULL DEFAULT (datetime('now')));`);
}

// Tên kho ERP có đuôi viết tắt công ty ("A-03 - ILS") → nhãn vị trí "A-03".
export const whLabel = n => String(n || '').replace(/ - [A-Z]{2,6}$/, '').trim();
const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();

/* ---------- gọi ERP ---------- */
function erpGet(http, path, what) {
  const r = http(path);
  if (r.status === 401) throw fail('Next ERP từ chối khóa API (401) — kiểm tra lại API key / secret của tài khoản bot.', 502);
  if (r.status === 403) throw fail(`Tài khoản bot chưa có quyền đọc "${what}" trên Next ERP (403) — nhờ IT cấp quyền đọc (Read) doctype này cho bot.`, 502);
  if (r.status < 200 || r.status >= 300) throw fail(`Next ERP trả lỗi ${r.status || 'mạng'} khi đọc "${what}".`, 502);
  return r.json;
}
const qs = o => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(typeof v === 'string' || typeof v === 'number' ? String(v) : JSON.stringify(v))}`).join('&');
const resPath = (dt, params) => `/api/resource/${encodeURIComponent(dt)}?${qs(params)}`;
// Lấy hết các trang của 1 danh sách (limit_start / limit_page_length).
function listAll(http, dt, params, pageSize = 5000) {
  const out = [];
  for (let start = 0; start < 100000; start += pageSize) {
    const page = erpGet(http, resPath(dt, { ...params, limit_page_length: pageSize, limit_start: start }), dt)?.data || [];
    for (const row of page) out.push(row);
    if (page.length < pageSize) break;
  }
  return out;
}
const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

/* ---------- tồn vị trí ---------- */
export function pullErpStock(http) {
  const bins = listAll(http, 'Bin', { fields: ['item_code', 'warehouse', 'actual_qty', 'reserved_qty', 'stock_uom'], filters: [['actual_qty', '!=', 0]] });
  const whs = listAll(http, 'Warehouse', { fields: ['name', 'warehouse_name', 'parent_warehouse', 'is_group', 'warehouse_type', 'disabled'] });
  const items = listAll(http, 'Item', { fields: ['name', 'item_name', 'item_group', 'custom_default_location', 'stock_uom'], filters: [['is_stock_item', '=', 1], ['disabled', '=', 0]] });
  return { bins, whs, items };
}
const skipParents = db => String(cfgGet(db, 'stock_skip') || STOCK_SKIP_PARENTS.join(',')).split(',').map(s => norm(s)).filter(Boolean);
const inKho = (db, w) => { const skip = skipParents(db), p = norm(whLabel(w.parent_warehouse)), l = norm(whLabel(w.name)); return !(skip.some(s => p.startsWith(s)) || /^LINE\s*\d/.test(l) || w.warehouse_type === 'Transit') ? 1 : 0; };

export function applyErpStock(db, { bins, whs, items }, { username = 'ERP', source = 'ERP' } = {}) {
  return tx(db, () => {
    const before = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(qty), 0) s, COALESCE(SUM(reserved), 0) r FROM erp_stock').get();
    db.exec('DELETE FROM erp_wh; DELETE FROM erp_item; DELETE FROM erp_stock');
    const insW = db.prepare('INSERT OR REPLACE INTO erp_wh(name, label, parent, is_group, wh_type, in_kho) VALUES (?,?,?,?,?,?)');
    for (const w of whs || []) if (w.name) insW.run(w.name, whLabel(w.warehouse_name || w.name) || w.name, w.parent_warehouse || '', w.is_group ? 1 : 0, w.warehouse_type || '', inKho(db, w));
    const insI = db.prepare('INSERT OR REPLACE INTO erp_item(material, name, item_group, default_loc, uom) VALUES (?,?,?,?,?)');
    for (const i of items || []) if (i.name) insI.run(i.name, i.item_name || '', i.item_group || '', whLabel(i.custom_default_location || ''), i.stock_uom || '');
    const insB = db.prepare('INSERT OR REPLACE INTO erp_stock(material, warehouse, qty, reserved, uom) VALUES (?,?,?,?,?)');
    let neg = 0;
    for (const b of bins || []) { if (!b.item_code || !b.warehouse) continue; insB.run(b.item_code, b.warehouse, r3(b.actual_qty), r3(b.reserved_qty), b.stock_uom || ''); if (Number(b.actual_qty) < 0) neg++; }
    const after = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(qty), 0) s, COALESCE(SUM(reserved), 0) r FROM erp_stock').get();
    const bomMats = db.prepare('SELECT COUNT(DISTINCT material) n FROM bom').get().n;
    const withStock = db.prepare('SELECT COUNT(DISTINCT b.material) n FROM bom b WHERE EXISTS (SELECT 1 FROM erp_stock s JOIN erp_wh w ON w.name = s.warehouse WHERE s.material = b.material AND w.in_kho = 1 AND s.qty > 0)').get().n;
    const changed = before.n !== after.n || r3(before.s) !== r3(after.s) || r3(before.r) !== r3(after.r);
    const summary = { ok: true, source, bins: (bins || []).length, warehouses: (whs || []).length, items: (items || []).length, negBins: neg, bomMats, bomMatsWithStock: withStock, changed };
    db.prepare('INSERT INTO import_log(kind, source, summary, created_by) VALUES (?,?,?,?)').run('ERP_STOCK', source, JSON.stringify(summary), username);
    db.prepare("DELETE FROM import_log WHERE kind IN ('ERP_STOCK', 'ERP_BOM') AND created_at < datetime('now', '-30 days')").run();
    cfgSet(db, 'stock_ok_at', new Date().toISOString());
    return summary;
  });
}
function logError(db, kind, message, source, username) {
  db.prepare('INSERT INTO import_log(kind, source, summary, created_by) VALUES (?,?,?,?)').run(kind, source, JSON.stringify({ ok: false, error: message }), username);
}
function ready(db, makeHttp, flag, auto, label) {
  const c = erpCfg(db);
  if (auto && !c[flag]) return { skip: { ok: true, skipped: `Chưa bật ${label}` } };
  if (!(c.url && c.key && c.secret)) throw fail('Chưa cấu hình kết nối Next ERP (Quản trị → Kết nối Next ERP).');
  if (!makeHttp) throw fail('Bản chạy này không gọi được Next ERP.');
  return { c };
}
export function syncErpStock(db, makeHttp, { username = 'ERP', source = 'ERP', auto = false } = {}) {
  ensureErpStockSchema(db);
  const { c, skip } = ready(db, makeHttp, 'stockSync', auto, 'đồng bộ tồn kho ERP');
  if (skip) return skip;
  let data;
  try { data = pullErpStock(makeHttp(c)); } catch (e) { if (!e.status) throw e; logError(db, 'ERP_STOCK', e.message, source, username); return { ok: false, error: e.message }; }
  const r = applyErpStock(db, data, { username, source });
  if (!auto) audit(db, username, 'kho.stock.erp', { bins: r.bins, negBins: r.negBins });
  return r;
}

// Tồn theo vị trí của các mã (chỉ vị trí tính là Kho) → Map material → { total, locs: [{ loc, qty }], defaultLoc, neg }.
export function stockOf(db, materials) {
  const out = new Map(), list = [...new Set((materials || []).filter(Boolean))];
  if (!list.length) return out;
  for (const part of chunks(list, 400)) {
    const rows = db.prepare(`SELECT s.material, w.label loc, s.qty FROM erp_stock s JOIN erp_wh w ON w.name = s.warehouse WHERE w.in_kho = 1 AND s.material IN (${part.map(() => '?').join(',')}) ORDER BY s.qty DESC, w.label`).all(...part);
    for (const r of rows) {
      if (!out.has(r.material)) out.set(r.material, { total: 0, locs: [], defaultLoc: '', neg: false });
      const m = out.get(r.material); m.total = r3(m.total + r.qty); m.locs.push({ loc: r.loc, qty: r.qty }); if (r.qty < 0) m.neg = true;
    }
    for (const r of db.prepare(`SELECT material, default_loc FROM erp_item WHERE default_loc <> '' AND material IN (${part.map(() => '?').join(',')})`).all(...part)) {
      if (!out.has(r.material)) out.set(r.material, { total: 0, locs: [], defaultLoc: '', neg: false });
      out.get(r.material).defaultLoc = r.default_loc;
    }
  }
  return out;
}
// Đang giữ trong kit (đã kitting chưa giao Line) theo mã — trừ vào tồn ERP ra "khả dụng".
function heldMap(db) {
  return new Map(db.prepare('SELECT material, SUM(kitted - delivered) held FROM kit_item GROUP BY material HAVING held > 0').all().map(r => [r.material, r3(r.held)]));
}
export function stockStatus(db) {
  const c = erpCfg(db), last = db.prepare("SELECT summary, created_by, created_at FROM import_log WHERE kind = 'ERP_STOCK' ORDER BY id DESC LIMIT 1").get();
  return { configured: !!(c.url && c.key && c.secret), stockSync: c.stockSync, okAt: c.stockOkAt, last: last ? { ...JSON.parse(last.summary || '{}'), by: last.created_by, at: last.created_at } : null };
}
// Màn Tồn ERP của Kho: mỗi mã trong BOM (hoặc thêm mã chỉ có trên ERP khi all) + vị trí / tồn / đang giữ trong kit / khả dụng / cờ.
// model: chỉ các mã trong BOM của Model đó, kèm Cần cho kit đang mở (chưa giao Line) để thấy thiếu.
export function stockView(db, { model = '', all = false } = {}) {
  ensureErpStockSchema(db);
  const status = stockStatus(db), held = heldMap(db);
  const modelSql = 'COALESCE(m.model, b.model_code)';
  const bomRows = model
    ? db.prepare(`SELECT b.material, MAX(b.description) description, GROUP_CONCAT(DISTINCT b.kit_group) groups, COUNT(DISTINCT b.model_code) codes FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code WHERE ${modelSql} = ? GROUP BY b.material ORDER BY b.material`).all(model)
    : db.prepare('SELECT material, MAX(description) description, GROUP_CONCAT(DISTINCT kit_group) groups, COUNT(DISTINCT model_code) codes FROM bom GROUP BY material ORDER BY material').all();
  const need = new Map();
  if (model) for (const r of db.prepare(`SELECT ki.material, SUM(CASE WHEN ki.required > ki.kitted THEN ki.required - ki.kitted ELSE 0 END) need FROM kit_item ki JOIN kit_order k ON k.id = ki.kit_id
      LEFT JOIN model_map m ON m.model_code = k.model_code WHERE COALESCE(m.model, k.model_code) = ? AND k.plan_day IS NOT NULL AND NOT (k.vln_status = 'delivered' AND k.hv_status = 'delivered') GROUP BY ki.material`).all(model)) need.set(r.material, r3(r.need));
  const st = stockOf(db, bomRows.map(r => r.material));
  const rows = bomRows.map(r => {
    const s = st.get(r.material) || { total: 0, locs: [], defaultLoc: '', neg: false }, h = held.get(r.material) || 0, avail = r3(s.total - h);
    const flags = [];
    if (s.neg) flags.push('neg');
    if (s.locs.filter(l => l.qty > 0).length > 1) flags.push('multi');
    if (!s.locs.length) flags.push('none');
    if (s.defaultLoc && s.locs.length && !s.locs.some(l => l.loc === s.defaultLoc)) flags.push('mismatch');
    const n = need.get(r.material); if (n !== undefined && avail < n) flags.push('short');
    return { material: r.material, description: r.description || '', groups: String(r.groups || '').split(',').filter(Boolean), codes: r.codes, inBom: true, total: s.total, locs: s.locs, defaultLoc: s.defaultLoc, held: h, avail, need: n ?? null, flags };
  });
  if (all && !model) {
    const known = new Set(rows.map(r => r.material));
    const extra = db.prepare('SELECT s.material, COALESCE(i.name, \'\') description, i.default_loc, w.label loc, s.qty FROM erp_stock s JOIN erp_wh w ON w.name = s.warehouse LEFT JOIN erp_item i ON i.material = s.material WHERE w.in_kho = 1 ORDER BY s.material, s.qty DESC').all().filter(r => !known.has(r.material));
    const by = new Map();
    for (const r of extra) {
      if (!by.has(r.material)) by.set(r.material, { material: r.material, description: r.description, groups: [], codes: 0, inBom: false, total: 0, locs: [], defaultLoc: r.default_loc || '', held: held.get(r.material) || 0, avail: 0, need: null, flags: ['erpOnly'] });
      const x = by.get(r.material); x.total = r3(x.total + r.qty); x.locs.push({ loc: r.loc, qty: r.qty }); if (r.qty < 0 && !x.flags.includes('neg')) x.flags.push('neg');
    }
    for (const x of by.values()) { x.avail = r3(x.total - x.held); if (x.locs.filter(l => l.qty > 0).length > 1) x.flags.push('multi'); rows.push(x); }
  }
  const locs = new Set(); for (const r of rows) for (const l of r.locs) locs.add(l.loc);
  const kpi = { materials: rows.length, bomMats: rows.filter(r => r.inBom).length, withStock: rows.filter(r => r.inBom && r.total > 0).length, none: rows.filter(r => r.inBom && r.flags.includes('none')).length,
    neg: rows.filter(r => r.flags.includes('neg')).length, multi: rows.filter(r => r.flags.includes('multi')).length, short: rows.filter(r => r.flags.includes('short')).length, locs: locs.size, held: r3(rows.reduce((s, r) => s + r.held, 0)) };
  const models = db.prepare('SELECT DISTINCT model FROM model_map ORDER BY model').all().map(r => r.model);
  return { ...status, model, all: !!all, rows, kpi, models };
}

/* ---------- BOM mặc định từ ERP ---------- */
export const bomErpLocked = db => { const c = erpCfg(db); return c.bomSync && !!c.bomOkAt; };
export function assertBomEditable(db) {
  if (bomErpLocked(db)) throw fail('BOM lấy từ Next ERP (màn Khởi tạo BOM vật liệu) — sửa trên ERP rồi bấm ⟳ Đồng bộ; MM chỉ đọc. Nhóm kitting VLN / VLĐT / Rear vẫn sửa trong MM.');
}
export function bomErpStatus(db) {
  ensureErpStockSchema(db);
  const c = erpCfg(db), last = db.prepare("SELECT summary, created_by, created_at FROM import_log WHERE kind = 'ERP_BOM' ORDER BY id DESC LIMIT 1").get();
  const n = db.prepare('SELECT COUNT(*) n FROM erp_bom').get().n;
  return { configured: !!(c.url && c.key && c.secret), bomSync: c.bomSync, locked: bomErpLocked(db), okAt: c.bomOkAt, codes: n, last: last ? { ...JSON.parse(last.summary || '{}'), by: last.created_by, at: last.created_at } : null };
}
// Danh sách BOM mặc định trên ERP + tài liệu từng BOM đã đổi (modified) kể từ lần trước.
export function pullErpBom(http, seen, { max = MAX_BOM_DOCS } = {}) {
  const list = listAll(http, 'BOM', { fields: ['name', 'item', 'modified', 'quantity'], filters: [['is_active', '=', 1], ['is_default', '=', 1], ['docstatus', '=', 1]] });
  const changed = list.filter(b => { const s = seen.get(b.item); return !s || s.name !== b.name || s.modified !== b.modified; });
  const docs = [];
  for (const b of changed.slice(0, max)) {
    const d = erpGet(http, `/api/resource/BOM/${encodeURIComponent(b.name)}`, 'BOM')?.data || {};
    const q = Number(d.quantity) > 0 ? Number(d.quantity) : 1;
    docs.push({ name: b.name, item: b.item, modified: b.modified, rows: (d.items || []).filter(i => i.item_code).map(i => ({ material: String(i.item_code).trim(), description: String(i.description || i.item_name || '').trim().slice(0, 200), point: r3(Number(i.stock_qty || i.qty) / q) })) });
  }
  return { list, docs, pending: Math.max(0, changed.length - docs.length) };
}
export function pullItemGroups(http, codes) {
  const out = new Map();
  for (const part of chunks(codes, 100)) for (const it of listAll(http, 'Item', { fields: ['name', 'item_group'], filters: [['name', 'in', part]] })) out.set(it.name, String(it.item_group || '').replace(/\s+AUTO$/i, '').trim());
  return out;
}
// dry: chỉ xem ERP sẽ đổi gì (importBom dry), không ghi gì.
export function applyErpBom(db, { list, docs, pending }, groups, { username = 'ERP', source = 'ERP', dry = false } = {}) {
  return tx(db, () => {
    const hasMap = code => !!db.prepare('SELECT 1 FROM model_map WHERE model_code = ?').get(code);
    const rows = [], modelMap = new Map(), noModel = [], empty = [];
    for (const d of docs) {
      if (!d.rows.length) { empty.push(d.item); continue; }
      if (!hasMap(d.item)) { const g = groups.get(d.item) || ''; if (!g) { noModel.push(d.item); continue; } modelMap.set(d.item, g); }
      // ERP không có cột công đoạn: giữ công đoạn đã khai trong MM cho mã còn trong BOM.
      const proc = new Map(db.prepare('SELECT material, process FROM bom WHERE model_code = ?').all(d.item).map(r => [r.material, r.process || '']));
      for (const r of d.rows) if (r.point > 0) rows.push({ modelCode: d.item, material: r.material, description: r.description, point: r.point, process: proc.get(r.material) || '', group: null });
    }
    let imp = null;
    if (rows.length) imp = importBom(db, { rows, modelMap, vln: [], dup: 0 }, { source, username, maxChanged: Infinity, dry });
    if (dry) return { ok: true, dry: true, total: list.length, fetched: docs.length, pending, noModel, empty, preview: imp };
    const up = db.prepare("INSERT INTO erp_bom(item, name, modified, lines, synced_at) VALUES (?,?,?,?,datetime('now')) ON CONFLICT(item) DO UPDATE SET name = excluded.name, modified = excluded.modified, lines = excluded.lines, synced_at = excluded.synced_at");
    for (const d of docs) if (d.rows.length && !noModel.includes(d.item)) up.run(d.item, d.name, d.modified, d.rows.length);
    const erpItems = new Set(list.map(b => b.item));
    const missing = db.prepare('SELECT item FROM erp_bom').all().map(r => r.item).filter(i => !erpItems.has(i));
    const summary = { ok: true, source, total: list.length, fetched: docs.length, applied: imp ? imp.newCodes.length + imp.changed.length : 0, newCodes: imp ? imp.newCodes.map(x => x.code) : [], changed: imp ? imp.changed.map(x => x.code) : [],
      unchanged: imp ? imp.unchanged : docs.length, pending, noModel, empty, erpMissing: missing, suggested: imp?.suggested || 0 };
    db.prepare('INSERT INTO import_log(kind, source, summary, created_by) VALUES (?,?,?,?)').run('ERP_BOM', source, JSON.stringify(summary), username);
    cfgSet(db, 'bom_ok_at', new Date().toISOString());
    if (summary.applied) audit(db, username, 'bom.erp', { newCodes: summary.newCodes, changed: summary.changed, pending });
    return summary;
  });
}
export function syncErpBom(db, makeHttp, { username = 'ERP', source = 'ERP', auto = false, dry = false, max } = {}) {
  ensureErpStockSchema(db);
  const { c, skip } = ready(db, makeHttp, 'bomSync', auto, 'BOM từ ERP');
  if (skip) return skip;
  const seen = new Map(db.prepare('SELECT item, name, modified FROM erp_bom').all().map(r => [r.item, r]));
  let data, groups = new Map();
  try {
    const http = makeHttp(c);
    data = pullErpBom(http, seen, max ? { max } : {});
    const newCodes = data.docs.map(d => d.item).filter(code => !db.prepare('SELECT 1 FROM model_map WHERE model_code = ?').get(code));
    if (newCodes.length) groups = pullItemGroups(http, newCodes);
  } catch (e) { if (!e.status) throw e; logError(db, 'ERP_BOM', e.message, source, username); return { ok: false, error: e.message }; }
  return applyErpBom(db, data, groups, { username, source, dry });
}

export function erpStockRoutes(db, makeHttp) {
  ensureErpStockSchema(db);
  return [
    { method: 'GET', path: '/api/kho/stock', handler: ({ query }) => stockView(db, { model: String(query.get('model') || '').trim(), all: query.get('all') === '1' }) },
    { method: 'POST', path: '/api/kho/stock/sync', handler: ({ user }) => syncErpStock(db, makeHttp, { username: user.username, source: `Đồng bộ tay · ${user.username}` }) },
    { method: 'GET', path: '/api/bom/erp', handler: () => bomErpStatus(db) },
    { method: 'POST', path: '/api/bom/erp/sync', handler: ({ body, user }) => syncErpBom(db, makeHttp, { username: user.username, source: `Đồng bộ tay · ${user.username}`, dry: !!body?.dry }) }
  ];
}
