// Planner chia / gộp PO trên Excel rồi nhập lên MM (file "Kế hoạch ngày dd.mm"). Mỗi sheet có dòng tiêu đề nhận dạng được là 1 cách gộp:
//  - Kiểu cũ (cột LINE · MODEL · MODEL CODE · PO): mọi PO cùng Line + cùng Model = 1 Kit (Line khác hoặc Model khác thì không gộp).
//  - Kiểu "Kitting theo PO" (cột BOM Number · PO · Line): mỗi BOM Number = 1 Kit — thường 1 PO gốc, gộp khi Planner ghi chung 1 số.
// Quy tắc đã chốt với anh Hồ (12/11/2026):
//  - PO nội bộ trong file bỏ qua (PO nội bộ lập trong MM). PO "xxx-1" (dòng tách) → lấy cả PO gốc, báo SL file khác SL PO.
//  - Gộp đúng như file, KHÔNG áp giới hạn merge_max_qty (chỉ cảnh báo). Khác Model trong 1 nhóm → bỏ nhóm, báo lỗi.
//  - Cột Line có dữ liệu = Line dự kiến (kit_order.plan_line): hiện cho Kho / phiếu in, giao Line khác chỉ cảnh báo.
//  - Ngày kitting do Planner chọn khi nhập; thứ tự Kit trong ngày theo thứ tự trong file (Kit nhập trước, Kit khác của ngày đó xếp sau).
//  - PO đã nằm trong Kit Kho đã bắt đầu kitting / đã giao: giữ nguyên (chỉ cập nhật Line dự kiến nếu chưa giao).
import { fail, audit, normalizePo, getSettings } from './db.mjs';
import { modelOf, isCancelled } from './po-sync.mjs';
import { nextMergedCode, printedCodes, dropOrphanLoads } from './planning.mjs';

const MAX_ROWS = 3000, MAX_SHEETS = 12;
const hk = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
const cell = v => (v && typeof v === 'object' && !(v instanceof Date)) ? (v.result ?? v.text ?? v.richText?.map(t => t.text).join('') ?? '') : v;
const str = v => { const x = cell(v); return x instanceof Date ? x.toISOString().slice(0, 10) : String(x ?? '').trim(); };
const num = v => { const s = str(v).replace(/,/g, '').trim(); if (!s || s === '-') return 0; const n = Number(s); return Number.isFinite(n) ? n : 0; };
const fmtN = n => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');   // goja không có toLocaleString('vi-VN')
const FORMATS = {
  line: { label: 'Gộp theo Line + Model', need: ['line', 'model', 'model code', 'po'], cols: { line: ['line'], model: ['model'], code: ['model code'], po: ['po'], qty: ['master qty', 'kitting qty', 'so luong'], planDate: ['plan date'] } },
  bom: { label: 'Kitting theo PO (BOM Number)', need: ['bom number', 'po'], cols: { group: ['bom number'], line: ['line'], model: ['model'], code: ['code', 'model code'], po: ['po'], qty: ['so luong', 'qty', 'master qty'], ils: ['po il-sung'] } }
};
// Dòng tiêu đề trong 6 dòng đầu; sheet có "BOM Number" là kiểu Kitting theo PO.
function detect(rows) {
  for (let r = 0; r < Math.min(6, rows.length); r++) {
    const keys = (rows[r] || []).map(hk);
    for (const kind of ['bom', 'line']) {
      const f = FORMATS[kind];
      if (!f.need.every(n => keys.includes(n))) continue;
      if (kind === 'line' && keys.includes('bom number')) continue;
      const cols = {};
      for (const [name, aliases] of Object.entries(f.cols)) { const i = aliases.map(a => keys.indexOf(a)).find(i => i >= 0); if (i !== undefined) cols[name] = i; }
      return { kind, headerRow: r, cols };
    }
  }
  return null;
}
// Số PO SAP 12 số (Excel lưu dạng số thì mất số 0 đầu → bù lại); đuôi "-n" = dòng tách → PO gốc.
export function sapPo(raw) {
  let s = typeof cell(raw) === 'number' ? String(Math.round(cell(raw))) : str(raw).replace(/\s+/g, '');
  if (/^\d{11}(-\d+)?$/.test(s)) s = '0' + s;
  const m = s.match(/^(0\d{11})(-\d+)?$/);
  return m ? { po: m[1], split: !!m[2], raw: s } : null;
}
// "Line 05" → "Line 5", "Line 01A" → "Line 1A"; trống / "0" → không có Line.
export function normLine(v) {
  const s = str(v); if (!s || s === '0' || s === '-') return '';
  const m = s.match(/^line\s*0*(\d+)\s*([a-z]?)$/i);
  return m ? `Line ${m[1]}${m[2].toUpperCase()}` : s;
}
// Ngày kitting gợi ý: cột PLAN DATE (kiểu cũ) nhiều nhất, không có thì "dd.mm" trong tên file.
function suggestDay(sheets, fileName, year) {
  const c = new Map();
  for (const s of sheets) for (const v of s.planDates || []) c.set(v, (c.get(v) || 0) + 1);
  const best = [...c].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (best) return best;
  const m = String(fileName || '').match(/(\d{1,2})[.\-_/](\d{1,2})(?:[.\-_/](\d{4}))?/);
  return m ? `${m[3] || year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}
function toDay(v) {
  const x = cell(v);
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  if (typeof x === 'number' && x > 30000 && x < 80000) return new Date(Date.UTC(1899, 11, 30) + x * 864e5).toISOString().slice(0, 10);
  const s = String(x ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);   // M/D/YY (Excel kiểu Mỹ)
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return '';
}

// Đọc các sheet (bảng thô từ trình duyệt) → nhóm Kit theo kiểu của từng sheet.
export function parsePlanSheets(input) {
  const sheets = (Array.isArray(input) ? input : []).slice(0, MAX_SHEETS);
  if (!sheets.length) throw fail('File không có sheet nào.');
  const out = [];
  for (const sh of sheets) {
    const rows = (Array.isArray(sh.rows) ? sh.rows : []).slice(0, MAX_ROWS), d = detect(rows);
    if (!d) { out.push({ name: String(sh.name || ''), kind: null, groups: [], skipped: [] }); continue; }
    const c = d.cols, groups = new Map(), skipped = [], planDates = [];
    for (let r = d.headerRow + 1; r < rows.length; r++) {
      const row = rows[r] || [], poRaw = str(row[c.po]);
      if (!poRaw) continue;
      const sp = sapPo(row[c.po]);
      if (!sp) { skipped.push({ row: r + 1, po: poRaw, why: 'PO nội bộ / không phải PO SAP' }); continue; }
      const model = str(row[c.model]), line = normLine(row[c.line]);
      const key = d.kind === 'line' ? `${line || '(trống)'} · ${model}` : str(row[c.group]);
      if (!key) { skipped.push({ row: r + 1, po: poRaw, why: 'Thiếu BOM Number' }); continue; }
      if (c.planDate !== undefined) { const pd = toDay(row[c.planDate]); if (pd) planDates.push(pd); }
      if (!groups.has(key)) groups.set(key, { key, line: '', model, rows: [] });
      const g = groups.get(key);
      if (!g.line && line) g.line = line;
      g.rows.push({ row: r + 1, po: sp.po, raw: sp.raw, split: sp.split, code: str(row[c.code]), qty: num(row[c.qty]), line });
    }
    out.push({ name: String(sh.name || ''), kind: d.kind, label: FORMATS[d.kind].label, groups: [...groups.values()], skipped, planDates });
  }
  return out;
}

// Xem trước / áp dụng. body: { fileName, day, sheets: [{ name, rows }], skipSheets: [tên], exclude: ['sheet\u001fkey'] }
export function planImport(db, body, username, apply = false) {
  const parsed = parsePlanSheets(body?.sheets);
  const year = new Date(Date.now() + 7 * 3600000).getUTCFullYear();
  const suggested = suggestDay(parsed, body?.fileName, year);
  const day = String(body?.day || suggested || '');
  if (apply && !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw fail('Chọn ngày kitting.');
  const exclude = new Set(Array.isArray(body?.exclude) ? body.exclude : []);
  // Lần xem trước đầu (chưa gửi skipSheets): tự bỏ sheet không có PO nào trong MM (VD sheet "Change" ghi PO cũ) — Planner bật lại được.
  const hasPo = sh => sh.groups.some(g => g.rows.some(r => db.prepare('SELECT 1 FROM po WHERE po_key = ?').get(normalizePo(r.po))));
  const autoOff = new Set(Array.isArray(body?.skipSheets) ? [] : parsed.filter(sh => sh.kind && !hasPo(sh)).map(sh => sh.name));
  const skipSheets = new Set(Array.isArray(body?.skipSheets) ? body.skipSheets : [...autoOff]);
  const maxQty = Number(getSettings(db).merge_max_qty) || 2500;
  const lines = new Set(db.prepare('SELECT name FROM lines WHERE active = 1').all().map(r => r.name));
  const poOf = db.prepare('SELECT * FROM po WHERE po_key = ?'), kitOf = db.prepare('SELECT k.* FROM kit_order_po x JOIN kit_order k ON k.id = x.kit_id WHERE x.po_key = ?');
  const kitPoKeys = id => db.prepare('SELECT po_key FROM kit_order_po WHERE kit_id = ?').all(id).map(r => r.po_key);
  const printed = printedCodes(db), locked = k => k.vln_status !== 'pending' || k.hv_status !== 'pending' || printed.has(k.code);
  const seen = new Map();   // po_key → nhóm đầu tiên (PO lặp ở nhiều nhóm: lấy nhóm đầu)
  const plan = [];
  for (const sh of parsed) {
    const sheetOn = !!sh.kind && !skipSheets.has(sh.name);
    for (const g of sh.groups) {
      const gid = `${sh.name}\u001f${g.key}`, on = sheetOn && !exclude.has(gid);
      const items = [], warn = [];
      for (const r of g.rows) {
        const key = normalizePo(r.po), p = poOf.get(key), k = p ? kitOf.get(key) : null;
        const it = { row: r.row, po: r.po, raw: r.raw, split: r.split, code: r.code, qty: r.qty, key, status: 'ok', note: '' };
        if (!p) { it.status = 'missing'; it.note = 'Không có trong MM'; }
        else {
          it.planQty = p.plan_qty; it.mmCode = p.model_code; it.model = modelOf(db, p.model_code, p.basic_model); it.kit = k ? { id: k.id, code: k.code, day: k.plan_day, kind: k.kind } : null;
          if (isCancelled(p)) { it.status = 'cancel'; it.note = 'PO đã hủy'; }
          else if (k && locked(k)) { it.status = 'locked'; it.note = k.vln_status === 'delivered' ? `Đã giao ${k.line || ''}`.trim() : k.vln_status === 'pending' && k.hv_status === 'pending' ? `${k.code} Kho đã in phiếu` : `${k.code} Kho đã bắt đầu kitting`; it.kit.delivered = k.vln_status === 'delivered'; }
          else if (seen.has(key) && seen.get(key) !== gid) { it.status = 'dup'; it.note = 'PO đã có ở nhóm trước'; }
          if (r.code && r.code !== p.model_code) warn.push(`${r.po}: Code file ${r.code} ≠ MM ${p.model_code}`);
          if (r.qty && Math.abs(r.qty - p.plan_qty) > 1e-6) it.note = [it.note, `SL file ${fmtN(r.qty)} ≠ PO ${fmtN(p.plan_qty)}${r.split ? ' (dòng tách, lấy cả PO)' : ''}`].filter(Boolean).join(' · ');
        }
        if (on && it.status === 'ok') seen.set(key, gid);
        items.push(it);
      }
      const ok = items.filter(i => i.status === 'ok'), models = [...new Set(ok.map(i => i.model))];
      const total = ok.reduce((s, i) => s + i.planQty, 0);
      let action = !on ? 'off' : !ok.length ? 'none' : models.length > 1 ? 'error' : ok.length === 1 ? 'single' : 'merge';
      if (models.length > 1) warn.push(`Khác Model trong 1 nhóm: ${models.join(', ')} — bỏ nhóm`);
      if ((action === 'single' || action === 'merge')) {
        const kits = [...new Set(ok.map(i => i.kit?.id).filter(Boolean))];
        if (kits.length === 1 && ok.every(i => i.kit) && kitPoKeys(kits[0]).sort().join() === ok.map(i => i.key).sort().join()) action = 'keep';
      }
      if (ok.length > 1 && total > maxQty) warn.push(`Tổng ${fmtN(total)} ea vượt giới hạn gộp ${fmtN(maxQty)} — vẫn gộp theo file`);
      if (g.line && !lines.has(g.line)) warn.push(`${g.line} không có trong danh sách Line — bỏ Line dự kiến`);
      plan.push({ id: gid, sheet: sh.name, kind: sh.kind, key: g.key, model: models[0] || g.model, line: g.line && lines.has(g.line) ? g.line : '', fileLine: g.line, items, total, action, warn, on });
    }
  }
  const sum = { groups: plan.filter(p => p.on).length, kits: plan.filter(p => ['single', 'merge', 'keep'].includes(p.action)).length,
    merge: plan.filter(p => p.action === 'merge').length, single: plan.filter(p => p.action === 'single').length, keep: plan.filter(p => p.action === 'keep').length,
    pos: plan.filter(p => p.on).reduce((s, p) => s + p.items.filter(i => i.status === 'ok').length, 0),
    locked: plan.filter(p => p.on).reduce((s, p) => s + p.items.filter(i => i.status === 'locked').length, 0),
    missing: plan.filter(p => p.on).reduce((s, p) => s + p.items.filter(i => i.status === 'missing').length, 0),
    errors: plan.filter(p => p.action === 'error').length,
    internal: parsed.reduce((s, x) => s + x.skipped.length, 0) };
  const preview = { ok: true, fileName: body?.fileName || '', day, suggestedDay: suggested, maxQty,
    sheets: parsed.map(s => ({ name: s.name, kind: s.kind, label: s.label || '', groups: s.groups.length, skipped: s.skipped, on: !!s.kind && !skipSheets.has(s.name), autoOff: autoOff.has(s.name) })),
    skipSheets: [...skipSheets], groups: plan, sum };
  if (!apply) return preview;

  // ---- áp dụng (gọi trong tx + withUndo ở route) ----
  const todo = plan.filter(p => ['single', 'merge', 'keep'].includes(p.action));
  if (!todo.length && !plan.some(p => p.on && p.line && p.items.some(i => i.status === 'locked' && !i.kit?.delivered))) throw fail('Không có nhóm nào để nhập.');
  const touched = new Set(), placed = [];
  const delKit = id => { db.prepare('DELETE FROM kit_item WHERE kit_id = ?').run(id); db.prepare('DELETE FROM kit_order_po WHERE kit_id = ?').run(id); db.prepare('DELETE FROM kit_order WHERE id = ?').run(id); };
  for (const g of todo) {
    const ok = g.items.filter(i => i.status === 'ok');
    if (g.action === 'keep') {
      const id = ok[0].kit.id;
      db.prepare("UPDATE kit_order SET plan_day = ?, plan_line = ?, updated_at = datetime('now') WHERE id = ?").run(day, g.line || null, id);
      placed.push(id); continue;
    }
    // Gỡ PO khỏi Kit cũ (Kit cũ chưa kitting): Kit rỗng thì xóa, còn 1 PO thì thành Kit đơn ở chỗ cũ, còn ≥ 2 PO giữ Kit gộp.
    for (const i of ok) if (i.kit) {
      db.prepare('DELETE FROM kit_order_po WHERE kit_id = ? AND po_key = ?').run(i.kit.id, i.key);
      db.prepare('DELETE FROM kit_item WHERE kit_id = ?').run(i.kit.id);
      touched.add(i.kit.id);
    }
    const pos = ok.map(i => poOf.get(i.key)).sort((a, b) => String(a.plan_start || '').localeCompare(String(b.plan_start || '')) || String(a.po_no).localeCompare(String(b.po_no)));
    for (const p of pos) { const old = db.prepare('SELECT id FROM kit_order WHERE code = ?').get(p.po_no); if (old && !kitPoKeys(old.id).length) { delKit(old.id); touched.delete(old.id); } }
    const merged = pos.length > 1, code = merged ? nextMergedCode(db) : pos[0].po_no;
    if (!merged && db.prepare('SELECT 1 FROM kit_order WHERE code = ?').get(code)) throw fail(`Mã Kit ${code} đang được dùng, không tạo được.`);
    const res = db.prepare(`INSERT INTO kit_order(code, kind, model_code, plan_day, seq, plan_line, created_by) VALUES (?, ?, ?, ?, 0, ?, ?)`).run(code, merged ? 'merged' : 'single', pos[0].model_code, day, g.line || null, username);
    const id = Number(res.lastInsertRowid);
    for (const p of pos) db.prepare('INSERT INTO kit_order_po(kit_id, po_key) VALUES (?, ?)').run(id, p.po_key);
    placed.push(id); g.newCode = code;
  }
  // Kit cũ còn lại sau khi gỡ PO
  for (const id of touched) {
    let k = db.prepare('SELECT * FROM kit_order WHERE id = ?').get(id); if (!k) continue;
    dropOrphanLoads(db, id);   // PO Load thành phẩm mất PO thật cùng code → về cột Chưa lập KH
    k = db.prepare('SELECT * FROM kit_order WHERE id = ?').get(id); if (!k) continue;
    const keys = kitPoKeys(id);
    if (!keys.length) { delKit(id); continue; }
    if (keys.length === 1 && k.kind === 'merged') {
      const p = poOf.get(keys[0]);
      delKit(id);
      if (!db.prepare('SELECT 1 FROM kit_order WHERE code = ?').get(p.po_no)) {
        const r = db.prepare('INSERT INTO kit_order(code, kind, model_code, plan_day, seq, plan_line, created_by) VALUES (?, \'single\', ?, ?, ?, ?, ?)').run(p.po_no, p.model_code, k.plan_day, k.seq, k.plan_line, username);
        db.prepare('INSERT INTO kit_order_po(kit_id, po_key) VALUES (?, ?)').run(r.lastInsertRowid, p.po_key);
      }
    }
  }
  // PO đã kitting / đang làm: chỉ ghi Line dự kiến (chưa giao)
  let lineOnly = 0;
  for (const g of plan.filter(p => p.on && p.line)) for (const i of g.items.filter(i => i.status === 'locked' && !i.kit?.delivered)) {
    db.prepare("UPDATE kit_order SET plan_line = ?, updated_at = datetime('now') WHERE id = ? AND vln_status <> 'delivered'").run(g.line, i.kit.id); lineOnly++;
  }
  // Thứ tự trong ngày: Kit nhập theo thứ tự file, Kit khác của ngày đó xếp sau (giữ thứ tự cũ).
  const rest = db.prepare('SELECT id FROM kit_order WHERE plan_day = ? ORDER BY seq, id').all(day).map(r => r.id).filter(id => !placed.includes(id));
  [...new Set(placed), ...rest].forEach((id, i) => db.prepare('UPDATE kit_order SET seq = ? WHERE id = ?').run(i, id));
  audit(db, username, 'plan.import', { file: body?.fileName || '', day, kits: placed.length, merge: sum.merge, single: sum.single, keep: sum.keep, lineOnly, pos: sum.pos });
  return { ok: true, day, kits: placed.length, lineOnly,
    message: `Đã nhập kế hoạch ${day.slice(8, 10)}/${day.slice(5, 7)}: ${placed.length} Kit (${sum.merge} gộp · ${sum.single} PO đơn · ${sum.keep} giữ nguyên)${lineOnly ? ` · ghi Line dự kiến cho ${lineOnly} PO đã kitting` : ''}${sum.locked ? ` · ${sum.locked} PO đã kitting giữ nguyên` : ''}` };
}
// Phạm vi hoàn tác: PO trong file + ngày kitting chọn + ngày của các Kit cũ bị đụng.
export function importScope(db, preview) {
  const keys = new Set(), days = new Set([preview.day]);
  for (const g of preview.groups) for (const i of g.items) if (i.status === 'ok') {
    keys.add(i.key);
    if (i.kit) { if (i.kit.day) days.add(i.kit.day); db.prepare('SELECT po_key FROM kit_order_po WHERE kit_id = ?').all(i.kit.id).forEach(r => keys.add(r.po_key)); }
  }
  return { pos: [...keys], core: [...keys], days: [...days].filter(Boolean) };
}
