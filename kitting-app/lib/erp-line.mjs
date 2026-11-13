// Kế hoạch Line theo ngày / ca lấy từ Next ERP (doctype "Line Production Plan", màn Line Production Calendar) — CHỈ ĐỌC ERP.
// Khi đã đồng bộ thành công: kế hoạch Line trong MM chỉ xem, sửa trên ERP. Tham số rải chuyền / pending / UPH vẫn nhập trong MM.
// Quy tắc: lấy các tuần Released / Locked còn hiệu lực; mỗi ngày (từ hôm nay) thuộc tuần đó được ghi lại đúng như ERP —
// ca nào ERP không có thì Line không chạy ca đó. Ngày đã qua và ngày chưa có kế hoạch ERP giữ nguyên.
// Ghép: Line theo tên; Model bỏ đuôi " AUTO" rồi so tên (không phân biệt hoa thường / dấu cách), có bảng ghép tay erp_model_map;
// Ca: tên có "đêm" → ca Đêm, "ngày" → ca Ngày. Dòng không ghép được báo trong kết quả, không ghi.
import { tx, fail, audit } from './db.mjs';
import { todayKey, addDays, shifts, modelList } from './planning.mjs';

export const ERP_LINE_DOCTYPE = 'Line Production Plan';
const OK_STATUS = ['Released', 'Locked'];
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

export function ensureErpSchema(db) { db.exec('CREATE TABLE IF NOT EXISTS erp_cfg (key TEXT PRIMARY KEY, value TEXT)'); }
export const cfgGet = (db, k) => db.prepare('SELECT value FROM erp_cfg WHERE key = ?').get(k)?.value ?? '';
export const cfgSet = (db, k, v) => db.prepare('INSERT INTO erp_cfg(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v ?? ''));

export function erpCfg(db) {
  return { url: String(cfgGet(db, 'url') || '').replace(/\/+$/, ''), key: cfgGet(db, 'key'), secret: cfgGet(db, 'secret'),
    lineSync: cfgGet(db, 'line_sync') === '1', okAt: cfgGet(db, 'line_ok_at'),
    // Tồn vị trí (Bin) và BOM mặc định lấy từ ERP: mặc định bật khi đã có khóa; Quản trị tắt được.
    stockSync: cfgGet(db, 'stock_sync') !== '0', bomSync: cfgGet(db, 'bom_sync') !== '0', stockOkAt: cfgGet(db, 'stock_ok_at'), bomOkAt: cfgGet(db, 'bom_ok_at'), modelMap: (() => { try { return JSON.parse(cfgGet(db, 'model_map') || '{}'); } catch { return {}; } })() };
}
// Khóa sửa tay kế hoạch Line: bật đồng bộ và đã có ít nhất 1 lần lấy ERP thành công (bot chưa có quyền thì vẫn sửa tay được).
export const erpLineLocked = db => { const c = erpCfg(db); return c.lineSync && !!c.okAt; };
export function assertLineEditable(db) {
  if (erpLineLocked(db)) throw fail('Kế hoạch Line đồng bộ từ Next ERP (màn Line Production Calendar) — sửa trên ERP, MM chỉ xem.');
}

export function saveErpCfg(db, body, username) {
  return tx(db, () => {
    const url = String(body?.url ?? '').trim();
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw fail('Địa chỉ ERP phải bắt đầu bằng http:// hoặc https://');
    if (body?.url !== undefined) cfgSet(db, 'url', url.replace(/\/+$/, ''));
    if (String(body?.key ?? '').trim()) cfgSet(db, 'key', String(body.key).trim());
    if (String(body?.secret ?? '').trim()) cfgSet(db, 'secret', String(body.secret).trim());
    if (body?.lineSync !== undefined) cfgSet(db, 'line_sync', body.lineSync ? '1' : '0');
    if (body?.stockSync !== undefined) cfgSet(db, 'stock_sync', body.stockSync ? '1' : '0');
    if (body?.bomSync !== undefined) cfgSet(db, 'bom_sync', body.bomSync ? '1' : '0');
    if (body?.modelMap !== undefined) {
      const m = {};
      for (const [k, v] of Object.entries(body.modelMap || {})) if (String(k).trim() && String(v).trim()) m[String(k).trim()] = String(v).trim();
      cfgSet(db, 'model_map', JSON.stringify(m));
    }
    audit(db, username, 'erp.cfg', { url: body?.url !== undefined, key: !!body?.key, secret: !!body?.secret, lineSync: body?.lineSync, stockSync: body?.stockSync, bomSync: body?.bomSync, modelMap: body?.modelMap ? Object.keys(body.modelMap).length : undefined });
    return { ok: true, message: 'Đã lưu kết nối Next ERP.' };
  });
}

export function erpLineStatus(db) {
  const c = erpCfg(db), last = db.prepare("SELECT summary, created_by, created_at FROM import_log WHERE kind = 'ERP_LINE' ORDER BY id DESC LIMIT 1").get();
  return { configured: !!(c.url && c.key && c.secret), url: c.url, lineSync: c.lineSync, stockSync: c.stockSync, bomSync: c.bomSync, locked: erpLineLocked(db), okAt: c.okAt, stockOkAt: c.stockOkAt, bomOkAt: c.bomOkAt, modelMap: c.modelMap,
    last: last ? { ...JSON.parse(last.summary || '{}'), by: last.created_by, at: last.created_at } : null };
}

// Ghép 1 dòng ERP → { day, shift, line, model } hoặc lý do không ghép được.
function matcher(db) {
  const lines = new Map(db.prepare('SELECT name FROM lines WHERE active = 1').all().map(r => [norm(r.name), r.name]));
  const models = new Map(modelList(db).map(m => [norm(m), m])), manual = new Map(Object.entries(erpCfg(db).modelMap).map(([k, v]) => [norm(k), v]));
  const sh = shifts(db), night = sh.find(s => /đêm/i.test(s)) || sh[1], day = sh.find(s => /ngày/i.test(s)) || sh[0];
  return it => {
    const line = lines.get(norm(it.routing));
    const raw = String(it.model_snapshot || it.model_name || it.model_template || '').trim();
    const model = manual.get(norm(raw)) || models.get(norm(raw)) || models.get(norm(raw.replace(/\s+AUTO$/i, ''))) || null;
    const sg = `${it.shift_group || ''} ${it.shift_type || ''}`;
    const shift = /đêm|night/i.test(sg) ? night : /ngày|day/i.test(sg) ? day : null;
    return { line, model, shift, raw, routing: String(it.routing || ''), sg: String(it.shift_group || it.shift_type || '') };
  };
}

// plans: [{ name, week_start, week_end, status, items: [{ plan_date, routing, model_snapshot, shift_group, shift_type }] }]
export function applyErpLinePlan(db, plans, { username = 'ERP', source = 'ERP' } = {}) {
  const today = todayKey(), match = matcher(db);
  const usable = (plans || []).filter(p => OK_STATUS.includes(p.status) && p.week_end >= today);
  const days = new Set(), want = new Map(), bad = { line: new Map(), model: new Map(), shift: new Map() }, conflict = [];
  for (const p of usable) {
    for (let d = p.week_start > today ? p.week_start : today; d <= p.week_end; d = addDays(d, 1)) days.add(d);
    for (const it of p.items || []) {
      if (!it.plan_date || it.plan_date < today || it.plan_date > p.week_end) continue;
      const m = match(it), why = !m.line ? ['line', m.routing] : !m.model ? ['model', m.raw] : !m.shift ? ['shift', m.sg] : null;
      if (why) { const map = bad[why[0]]; map.set(why[1], (map.get(why[1]) || 0) + 1); continue; }
      const k = `${it.plan_date}\u001f${m.shift}\u001f${m.line}`;
      if (want.has(k) && want.get(k) !== m.model) { conflict.push(`${m.line} ${it.plan_date} ca ${m.shift}: ${want.get(k)} / ${m.model}`); continue; }
      want.set(k, m.model);
    }
  }
  const list = [...days].sort();
  return tx(db, () => {
    let added = 0, changed = 0, removed = 0;
    const cur = new Map();
    for (const d of list) for (const r of db.prepare('SELECT work_date, shift, line, model FROM line_assign WHERE work_date = ?').all(d)) cur.set(`${r.work_date}\u001f${r.shift}\u001f${r.line}`, r.model);
    for (const [k, m] of want) { if (!cur.has(k)) added++; else if (cur.get(k) !== m) changed++; }
    for (const k of cur.keys()) if (!want.has(k)) removed++;
    if (added || changed || removed) {
      const del = db.prepare('DELETE FROM line_assign WHERE work_date = ?'), ins = db.prepare('INSERT INTO line_assign(work_date, shift, line, model, updated_by) VALUES (?,?,?,?,?)');
      for (const d of list) del.run(d);
      for (const [k, m] of want) { const [d, s, l] = k.split('\u001f'); ins.run(d, s, l, m, username); }
    }
    const summary = { ok: true, source, plans: usable.map(p => `${p.name} (${p.week_start}…${p.week_end}, ${p.status})`), from: list[0] || '', to: list.at(-1) || '', days: list.length,
      cells: want.size, added, changed, removed, unmatched: Object.fromEntries(Object.entries(bad).map(([k, m]) => [k, [...m].map(([n, c]) => ({ name: n, count: c }))])), conflict };
    db.prepare('INSERT INTO import_log(kind, source, summary, created_by) VALUES (?,?,?,?)').run('ERP_LINE', source, JSON.stringify(summary), username);
    if (usable.length) cfgSet(db, 'line_ok_at', new Date().toISOString());
    if (added || changed || removed) audit(db, username, 'line.erp', { added, changed, removed, from: summary.from, to: summary.to });
    return summary;
  });
}
function logError(db, message, source, username) {
  db.prepare('INSERT INTO import_log(kind, source, summary, created_by) VALUES (?,?,?,?)').run('ERP_LINE', source, JSON.stringify({ ok: false, error: message }), username);
}

// http(path) → { status, json, text }: gọi GET tới ERP (đã gắn Authorization). Lỗi quyền / mạng → báo rõ để Planner chuyển cho IT.
export function pullErpLinePlans(http) {
  const q = o => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(typeof v === 'string' ? v : JSON.stringify(v))}`).join('&');
  const get = path => {
    const r = http(path);
    if (r.status === 401) throw fail('Next ERP từ chối khóa API (401) — kiểm tra lại API key / secret của tài khoản bot.', 502);
    if (r.status === 403) throw fail(`Tài khoản bot chưa có quyền đọc "${ERP_LINE_DOCTYPE}" trên Next ERP (403) — nhờ IT cấp quyền đọc (Read) doctype này cho bot.`, 502);
    if (r.status < 200 || r.status >= 300) throw fail(`Next ERP trả lỗi ${r.status}.`, 502);
    return r.json;
  };
  const head = get(`/api/resource/${encodeURIComponent(ERP_LINE_DOCTYPE)}?${q({ fields: ['name', 'week_start', 'week_end', 'status', 'modified'], filters: [['week_end', '>=', todayKey()], ['status', 'in', OK_STATUS]], order_by: 'week_start asc', limit_page_length: 20 })}`);
  return (head?.data || []).map(p => ({ ...p, items: (get(`/api/resource/${encodeURIComponent(ERP_LINE_DOCTYPE)}/${encodeURIComponent(p.name)}`)?.data?.items || [])
    .map(i => ({ plan_date: i.plan_date, routing: i.routing, model_snapshot: i.model_snapshot, model_template: i.model_template, shift_group: i.shift_group, shift_type: i.shift_type })) }));
}

// makeHttp(cfg) → http(path): do nền tảng cấp (PocketBase $http.send / fetch). Không có thì không đồng bộ được.
export function syncErpLines(db, makeHttp, { username = 'ERP', source = 'ERP', auto = false } = {}) {
  ensureErpSchema(db);
  const c = erpCfg(db);
  if (auto && !c.lineSync) return { ok: true, skipped: 'Chưa bật đồng bộ kế hoạch Line' };
  if (!(c.url && c.key && c.secret)) throw fail('Chưa cấu hình kết nối Next ERP (Quản trị → Kết nối Next ERP).');
  if (!makeHttp) throw fail('Bản chạy này không gọi được Next ERP.');
  // Lỗi ERP (quyền, mạng) trả về ok:false thay vì ném lỗi, để nhật ký lỗi không bị hoàn tác cùng transaction của request.
  let plans;
  try { plans = pullErpLinePlans(makeHttp(c)); } catch (e) { if (!e.status) throw e; logError(db, e.message, source, username); return { ok: false, error: e.message }; }
  return applyErpLinePlan(db, plans, { username, source });
}

export function erpLineRoutes(db, makeHttp) {
  ensureErpSchema(db);
  return [
    { method: 'GET', path: '/api/lines/erp', handler: () => erpLineStatus(db) },
    { method: 'POST', path: '/api/lines/erp/sync', handler: ({ user }) => syncErpLines(db, makeHttp, { username: user.username, source: `Đồng bộ tay · ${user.username}` }) },
    { method: 'GET', path: '/api/admin/erp', handler: () => { const s = erpLineStatus(db), c = erpCfg(db); return { ...s, hasKey: !!c.key, hasSecret: !!c.secret }; } },
    { method: 'POST', path: '/api/admin/erp', handler: ({ body, user }) => saveErpCfg(db, body || {}, user.username) }
  ];
}
