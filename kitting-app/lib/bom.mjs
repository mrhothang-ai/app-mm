// BOM theo Model Code + nhóm kitting (VLN / VLĐT / Rear) và bảng Model Code -> Model.
import { tx, fail, audit } from './db.mjs';
import { notCancelledSql } from './po-sync.mjs';

const key = v => String(v ?? '').replace(/[đĐ]/g, 'd').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const plain = v => (v && typeof v === 'object' && !(v instanceof Date)) ? ('result' in v ? v.result : Array.isArray(v.richText) ? v.richText.map(p => p.text).join('') : 'text' in v ? v.text : null) : v;
const text = v => String(plain(v) ?? '').trim();
export const GROUP_LABEL = { VLN: 'VLN', VLDT: 'VLĐT', REAR: 'Rear' };

export function normalizeGroup(value) {
  const k = key(value);
  if (!k) return null;
  if (k === 'vln' || k.includes('vatlieunho')) return 'VLN';
  if (k === 'vldt' || k.includes('dattien')) return 'VLDT';
  if (k === 'rear') return 'REAR';
  throw fail(`Nhóm kitting "${value}" không hợp lệ. Dùng VLN, VLĐT hoặc Rear.`);
}

// Rear = vỏ chính của Model Code (ASSY CASE METAL-FRONT / -REAR, ASSY CASE-REAR, ASSY METAL FRT…), trừ các nam châm ASSY CASE-MAGNET.
export const isRearDesc = d => /^\s*ASSY\s+(CASE|METAL\s+FRT)/i.test(d || '') && !/MAGNET/i.test(d || '');
// Gợi ý nhóm cho các dòng chưa có nhóm (file không ghi Nhóm kitting):
//  Rear theo mô tả; mã có ở mọi Model Code của Model (cùng Point) -> VLN; mã chỉ chạy riêng một số Model Code (đuôi A/B/C… theo màu) -> VLĐT;
//  Model chỉ có 1 Model Code thì không so sánh được -> tạm VLN, Planner sửa tay.
export function suggestGroups(db, onlyCodes) {
  const only = onlyCodes ? new Set(onlyCodes) : null;
  const rows = db.prepare(`SELECT b.id, b.model_code, b.material, b.description, b.point, COALESCE(m.model, b.model_code) AS model
    FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code WHERE b.kit_group IS NULL OR b.group_source = 'auto'`).all().filter(r => !only || only.has(r.model_code));
  if (!rows.length) return 0;
  const all = db.prepare('SELECT b.model_code, b.material, b.point, COALESCE(m.model, b.model_code) AS model FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code').all();
  const codesByModel = new Map(), byMaterial = new Map();
  for (const r of all) {
    if (!codesByModel.has(r.model)) codesByModel.set(r.model, new Set());
    codesByModel.get(r.model).add(r.model_code);
    const k = `${r.model}\u001f${r.material}`;
    if (!byMaterial.has(k)) byMaterial.set(k, []);
    byMaterial.get(k).push(r);
  }
  const update = db.prepare("UPDATE bom SET kit_group = ?, group_source = 'auto' WHERE id = ?");
  for (const r of rows) {
    let group;
    if (isRearDesc(r.description)) group = 'REAR';
    else {
      const codes = codesByModel.get(r.model), same = byMaterial.get(`${r.model}\u001f${r.material}`) || [];
      const everywhere = same.length === codes.size && new Set(same.map(x => x.point)).size === 1;
      group = codes.size === 1 || everywhere ? 'VLN' : 'VLDT';
    }
    update.run(group, r.id);
  }
  return rows.length;
}

// Nhập BOM chỉ đụng các Model Code có trong file (không bao giờ xóa cả bảng): code mới → thêm; code đã có → thay BOM của riêng code đó.
// Tên Model của code đã có giữ nguyên (đổi tên phải sửa đồng bộ cả phân công Line), sheet Bom code / BOM VLN của code ngoài file bị bỏ qua.
// Mỗi lần chỉ thay tối đa MAX_CHANGED_CODES code đã có để tránh sửa hàng loạt; dry = chỉ trả về kết quả xem trước.
export const MAX_CHANGED_CODES = 20;
function planBom(db, parsed) {
  const byCode = new Map();
  for (const r of parsed.rows) { if (!byCode.has(r.modelCode)) byCode.set(r.modelCode, []); byCode.get(r.modelCode).push(r); }
  const names = new Map();
  for (const r of db.prepare('SELECT DISTINCT model FROM model_map').all()) names.set(r.model.replace(/\s+/g, ' ').toUpperCase(), r.model);
  const plan = { newCodes: [], changed: [], unchanged: 0, renameIgnored: [], newModels: [], noModel: [], write: [] };
  for (const [code, rows] of byCode) {
    const cur = db.prepare('SELECT model FROM model_map WHERE model_code = ?').get(code)?.model, inFile = parsed.modelMap.get(code);
    const old = db.prepare('SELECT * FROM bom WHERE model_code = ?').all(code), oldBy = new Map(old.map(o => [o.material, o]));
    let model = cur;
    if (cur) { if (inFile && inFile.toUpperCase() !== cur.toUpperCase()) plan.renameIgnored.push({ code, inFile, kept: cur }); }
    else if (!inFile) { plan.noModel.push(code); continue; }
    else {
      const k = inFile.replace(/\s+/g, ' ').toUpperCase();
      model = names.get(k) || inFile;
      if (!names.has(k)) { names.set(k, model); plan.newModels.push(model); }
    }
    // Dòng để trống Nhóm kitting: giữ nhóm cũ của mã đó trong code này; mã mới để app tự xếp.
    const merged = rows.map(r => { const o = oldBy.get(r.material); return { ...r, group: r.group || o?.kit_group || null, source: r.group ? 'file' : o ? o.group_source : 'auto' }; });
    const wanted = new Set(rows.map(r => r.material));
    const added = rows.filter(r => !oldBy.has(r.material)).length, removed = old.filter(o => !wanted.has(o.material)).length;
    const diffPoint = merged.filter(r => oldBy.has(r.material) && Number(oldBy.get(r.material).point) !== Number(r.point)).length;
    const diffGroup = merged.filter(r => oldBy.has(r.material) && oldBy.get(r.material).kit_group !== r.group).length;
    const diffText = merged.filter(r => { const o = oldBy.get(r.material); return o && (r.description && o.description !== r.description || r.process && String(o.process ?? '') !== r.process); }).length;
    if (!old.length) plan.newCodes.push({ code, model, rows: rows.length });
    else if (added || removed || diffPoint || diffGroup || diffText) plan.changed.push({ code, model, oldRows: old.length, newRows: rows.length, added, removed, diffPoint, diffGroup, diffText });
    else { plan.unchanged++; continue; }
    plan.write.push({ code, model, cur, rows: merged });
  }
  return plan;
}
export function importBom(db, parsed, { source, username, dry = false, maxChanged = MAX_CHANGED_CODES }) {
  const plan = planBom(db, parsed), { write, ...view } = plan;
  const base = { ...view, rows: parsed.rows.length, models: new Set(write.map(w => w.model)).size, dup: parsed.dup || 0, maxChanged };
  if (plan.noModel.length) throw fail(`Model Code mới chưa ghi Model: ${plan.noModel.slice(0, 10).join(', ')}${plan.noModel.length > 10 ? '…' : ''}. Điền cột Model trong file.`);
  if (plan.changed.length > maxChanged) throw fail(`File đang thay BOM của ${plan.changed.length} Model Code đã có (tối đa ${maxChanged} mỗi lần). Chỉ đưa vào file các code thật sự cần cập nhật.`);
  if (dry) return base;
  return tx(db, () => {
    const firstLoad = !db.prepare('SELECT 1 FROM bom LIMIT 1').get();
    const addMap = db.prepare('INSERT INTO model_map(model_code, model) VALUES (?, ?) ON CONFLICT(model_code) DO NOTHING');
    if (firstLoad) for (const [code, model] of parsed.modelMap) addMap.run(code, model);   // Nạp lần đầu: nhận cả sheet Bom code.
    const del = db.prepare('DELETE FROM bom WHERE model_code = ?');
    const ins = db.prepare('INSERT INTO bom(model_code, material, description, point, process, kit_group, group_source) VALUES (?,?,?,?,?,?,?)');
    for (const w of write) {
      if (!w.cur) addMap.run(w.code, w.model);
      del.run(w.code);
      for (const r of w.rows) ins.run(w.code, r.material, r.description, r.point, r.process, r.group, r.source);
    }
    const suggested = suggestGroups(db, write.map(w => w.code));
    rebuildVln(db, [...new Set(write.map(w => w.model))]);
    if (firstLoad) {   // Nạp lần đầu (BOM trống) mới nhận Point VLN chỉnh tay từ sheet BOM VLN.
      const setP = db.prepare("UPDATE bom_vln SET point = ?, source = 'manual' WHERE model = ? AND material = ? AND point <> ?");
      for (const v of parsed.vln || []) setP.run(v.point, v.model, v.material, v.point);
    }
    const count = g => db.prepare('SELECT COUNT(*) n FROM bom WHERE kit_group = ?').get(g).n;
    const codes = write.map(w => w.code), noRear = codes.filter(c => !db.prepare("SELECT 1 FROM bom WHERE model_code = ? AND kit_group = 'REAR' LIMIT 1").get(c)).sort();
    const touched = new Set(write.map(w => w.model));
    const single = db.prepare(`SELECT ${MODEL} model FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code GROUP BY 1 HAVING COUNT(DISTINCT b.model_code) = 1 ORDER BY 1`).all().map(r => r.model).filter(m => touched.has(m));
    const summary = { ...base, suggested, groups: { REAR: count('REAR'), VLDT: count('VLDT'), VLN: count('VLN') }, noRear, single };
    db.prepare('INSERT INTO import_log(kind, source, summary, created_by) VALUES (?,?,?,?)').run('BOM', source || '', JSON.stringify(summary), username || '');
    audit(db, username, 'bom.import', { source, newCodes: plan.newCodes.map(x => x.code), changed: plan.changed.map(x => x.code), unchanged: plan.unchanged, renameIgnored: plan.renameIgnored.length });
    return summary;
  });
}

// Đổi nhóm một mã trong một Model: áp dụng cho mọi Model Code của Model đó để VLN luôn thống nhất.
export function setGroup(db, { model, material, group }, username) {
  const g = normalizeGroup(group);
  if (!g) throw fail('Chọn nhóm kitting.');
  const res = db.prepare(`UPDATE bom SET kit_group = ?, group_source = 'manual' WHERE material = ? AND model_code IN
    (SELECT b.model_code FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code WHERE COALESCE(m.model, b.model_code) = ?)`).run(g, material, model);
  if (!res.changes) throw fail('Không tìm thấy mã vật liệu trong Model này.', 404);
  rebuildVln(db, [model]);
  audit(db, username, 'bom.group', { model, material, group: g });
  return res.changes;
}

export function bomView(db, model) {
  const rows = db.prepare(`SELECT b.model_code, b.material, b.description, b.point, b.process, b.kit_group, b.group_source,
      COALESCE(m.model, b.model_code) AS model FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code
      ${model ? 'WHERE COALESCE(m.model, b.model_code) = ?' : ''} ORDER BY model, b.material, b.model_code`).all(...(model ? [model] : []));
  // Gom theo Model + Material: VLN hiển thị 1 dòng chung; VLĐT/Rear hiển thị theo Model Code.
  const models = new Map();
  for (const r of rows) {
    if (!models.has(r.model)) models.set(r.model, { model: r.model, codes: new Set(), items: new Map() });
    const m = models.get(r.model); m.codes.add(r.model_code);
    const k = r.material;
    if (!m.items.has(k)) m.items.set(k, { material: r.material, description: r.description, group: r.kit_group, source: r.group_source, perCode: [] });
    const it = m.items.get(k);
    it.perCode.push({ modelCode: r.model_code, point: r.point, process: r.process });
    if (r.group_source === 'manual') it.source = 'manual';
    if (it.group !== r.kit_group) it.mixed = true;
  }
  return [...models.values()].map(m => {
    const codes = [...m.codes].sort();
    const items = [...m.items.values()].map(it => {
      const points = new Set(it.perCode.map(p => p.point));
      const warnings = [];
      if (it.group === 'VLN' && points.size > 1) warnings.push('Point khác nhau giữa các Model Code — không dùng chung BOM VLN được.');
      if (it.group === 'VLN' && codes.length > 1 && it.perCode.length < codes.length) warnings.push(`Chỉ có ở ${it.perCode.length}/${codes.length} Model Code.`);
      if (it.mixed) warnings.push('Các Model Code đang để nhóm khác nhau.');
      return { ...it, points: [...points], warnings };
    }).sort((a, b) => ({ VLN: 0, VLDT: 1, REAR: 2 }[a.group] ?? 3) - ({ VLN: 0, VLDT: 1, REAR: 2 }[b.group] ?? 3) || a.material.localeCompare(b.material));
    const count = g => items.filter(i => i.group === g).length;
    return { model: m.model, codes, items, counts: { VLN: count('VLN'), VLDT: count('VLDT'), REAR: count('REAR') },
      warnings: items.reduce((s, i) => s + i.warnings.length, 0), autoCount: items.filter(i => i.source === 'auto').length };
  }).sort((a, b) => a.model.localeCompare(b.model));
}

export function bomCoverage(db) {
  return db.prepare(`SELECT p.model_code, COUNT(DISTINCT p.po_key) AS pos FROM po p
    WHERE p.in_source = 1 AND p.remain_qty > 0 AND ${notCancelledSql('p.')} AND NOT EXISTS (SELECT 1 FROM bom b WHERE b.model_code = p.model_code)
    GROUP BY p.model_code ORDER BY p.model_code`).all();
}

/* =====================================================================
   Quản lý BOM: BOM gốc theo Model Code (bảng bom, mỗi dòng gắn nhóm VLN / VLĐT / Rear)
   → tách ra BOM VLN theo Model (bảng bom_vln, dùng chung mọi Model Code của Model)
   và BOM Rear + VLĐT theo Model Code (chính các dòng Rear / VLĐT của BOM gốc).
   ===================================================================== */
const MODEL = 'COALESCE(m.model, b.model_code)';
const r3 = n => Math.round(Number(n) * 1000) / 1000;
const ORDER = { REAR: 0, VLDT: 1, VLN: 2 };

export function ensureBomSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS bom_vln (
    model TEXT NOT NULL, material TEXT NOT NULL, description TEXT, point REAL NOT NULL,
    source TEXT NOT NULL DEFAULT 'auto', updated_by TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (model, material));`);
  if (!db.prepare('SELECT 1 FROM bom_vln LIMIT 1').get() && db.prepare("SELECT 1 FROM bom WHERE kit_group = 'VLN' LIMIT 1").get()) rebuildVln(db);
}
const modelOfCode = (db, code) => db.prepare('SELECT model FROM model_map WHERE model_code = ?').get(code)?.model || code;
const codesOf = (db, model) => db.prepare(`SELECT DISTINCT b.model_code c FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code WHERE ${MODEL} = ? ORDER BY 1`).all(model).map(r => r.c);
const mode = list => { const t = new Map(); for (const v of list) t.set(v, (t.get(v) || 0) + 1); return [...t].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]; };

// Đồng bộ BOM VLN của Model từ BOM gốc: mã VLN có ở bất kỳ Model Code nào; Point = giá trị phổ biến nhất (dòng chỉnh tay giữ nguyên Point).
export function rebuildVln(db, only) {
  const rows = db.prepare(`SELECT ${MODEL} model, b.model_code, b.material, b.description, b.point FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code WHERE b.kit_group = 'VLN'`).all();
  const want = new Map();
  for (const r of rows) {
    if (!want.has(r.model)) want.set(r.model, new Map());
    const m = want.get(r.model); if (!m.has(r.material)) m.set(r.material, { description: r.description, points: [] });
    m.get(r.material).points.push(r.point);
  }
  const models = only ? new Set(only) : new Set([...want.keys(), ...db.prepare('SELECT DISTINCT model FROM bom_vln').all().map(r => r.model)]);
  const del = db.prepare('DELETE FROM bom_vln WHERE model = ? AND material = ?');
  const ins = db.prepare(`INSERT INTO bom_vln(model, material, description, point, source) VALUES (?,?,?,?,'auto')
    ON CONFLICT(model, material) DO UPDATE SET description = excluded.description, point = CASE WHEN bom_vln.source = 'manual' THEN bom_vln.point ELSE excluded.point END`);
  for (const model of models) {
    const w = want.get(model) || new Map();
    for (const r of db.prepare('SELECT material FROM bom_vln WHERE model = ?').all(model)) if (!w.has(r.material)) del.run(model, r.material);
    for (const [material, x] of w) ins.run(model, material, x.description, mode(x.points));
  }
}

export function vlnBom(db, model) {
  return db.prepare("SELECT material, description, point, 'VLN' AS kit_group FROM bom_vln WHERE model = ? ORDER BY material").all(model);
}

// Danh mục: mọi Model đã biết (bảng Model Code → Model, BOM, PO), sắp theo Model, kèm thống kê từng Model Code.
export function bomCatalog(db) {
  const map = new Map(db.prepare('SELECT model_code, model FROM model_map').all().map(r => [r.model_code, r.model]));
  const bomStat = new Map(db.prepare(`SELECT model_code, COUNT(*) n, SUM(kit_group = 'VLN') vln, SUM(kit_group = 'VLDT') vldt, SUM(kit_group = 'REAR') rear,
    SUM(kit_group IS NULL) nog, SUM(group_source = 'auto') auto FROM bom GROUP BY model_code`).all().map(r => [r.model_code, r]));
  const poStat = new Map(db.prepare(`SELECT model_code, MAX(basic_model) basic, COUNT(*) n, SUM(remain_qty > 0 AND ${notCancelledSql()}) open FROM po WHERE in_source = 1 GROUP BY model_code`).all().map(r => [r.model_code, r]));
  const vlnStat = new Map(db.prepare("SELECT model, COUNT(*) n, SUM(source = 'manual') manual FROM bom_vln GROUP BY model").all().map(r => [r.model, r]));
  const models = new Map();
  for (const code of new Set([...map.keys(), ...bomStat.keys(), ...poStat.keys()])) {
    const b = bomStat.get(code), p = poStat.get(code);
    const model = map.get(code) || (p ? String(p.basic || '').slice(0, 8) : code);
    if (!models.has(model)) models.set(model, { model, codes: [], openPo: 0, missing: 0, rows: 0 });
    const m = models.get(model);
    m.codes.push({ code, mapped: map.has(code), rows: b?.n || 0, vln: b?.vln || 0, vldt: b?.vldt || 0, rear: b?.rear || 0, auto: b?.auto || 0, openPo: p?.open || 0 });
    m.openPo += p?.open || 0; m.rows += b?.n || 0; if (!b && p?.open) m.missing++;
  }
  const issues = bomIssues(db);
  return [...models.values()].map(m => {
    m.codes.sort((a, b) => a.code.localeCompare(b.code));
    const v = vlnStat.get(m.model);
    return { ...m, hasBom: m.rows > 0, vln: v?.n || 0, vlnManual: v?.manual || 0, hv: Math.max(0, ...m.codes.map(c => c.vldt + c.rear)),
      auto: m.codes.reduce((s, c) => s + c.auto, 0), warnings: (issues.get(m.model) || []).length };
  }).sort((a, b) => a.model.localeCompare(b.model));
}

// Đối chiếu BOM VLN với BOM gốc từng Model Code.
function bomIssues(db, onlyModel) {
  const out = new Map(), push = (m, x) => { if (!out.has(m)) out.set(m, []); out.get(m).push(x); };
  const vln = db.prepare(`SELECT * FROM bom_vln ${onlyModel ? 'WHERE model = ?' : ''}`).all(...(onlyModel ? [onlyModel] : []));
  const rows = db.prepare(`SELECT ${MODEL} model, b.model_code, b.material, b.point, b.kit_group FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code ${onlyModel ? `WHERE ${MODEL} = ?` : ''}`).all(...(onlyModel ? [onlyModel] : []));
  const codes = new Map(), idx = new Map();
  for (const r of rows) { if (!codes.has(r.model)) codes.set(r.model, new Set()); codes.get(r.model).add(r.model_code); idx.set(`${r.model_code}\u001f${r.material}`, r); }
  for (const v of vln) for (const code of codes.get(v.model) || []) {
    const r = idx.get(`${code}\u001f${v.material}`);
    if (!r) push(v.model, { material: v.material, code, type: 'missing', text: `${code} không có mã này` });
    else if (v.source !== 'manual' && r3(r.point) !== r3(v.point)) push(v.model, { material: v.material, code, type: 'point', text: `${code}: Point gốc ${r.point} ≠ VLN ${v.point}` });
  }
  for (const r of rows) if (!r.kit_group) push(r.model, { material: r.material, code: r.model_code, type: 'nogroup', text: `${r.model_code}: chưa có nhóm` });
  return out;
}

export function bomModelDetail(db, model) {
  if (!model) throw fail('Chọn Model.');
  const cat = bomCatalog(db).find(m => m.model === model);
  if (!cat) throw fail('Không tìm thấy Model.', 404);
  const rows = db.prepare(`SELECT b.id, b.model_code, b.material, b.description, b.point, b.process, b.kit_group, b.group_source FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code
    WHERE ${MODEL} = ? ORDER BY b.model_code, CASE b.kit_group WHEN 'REAR' THEN 0 WHEN 'VLDT' THEN 1 WHEN 'VLN' THEN 2 ELSE 3 END, CAST(b.process AS INTEGER), b.material`).all(model);
  const issues = bomIssues(db, model).get(model) || [];
  const byCode = {}; for (const c of cat.codes) byCode[c.code] = [];
  for (const r of rows) (byCode[r.model_code] ||= []).push({ id: r.id, material: r.material, description: r.description, point: r.point, process: r.process, group: r.kit_group, source: r.group_source });
  const pt = new Map(rows.map(r => [`${r.model_code}\u001f${r.material}`, r.point]));
  const codes = cat.codes.map(c => c.code);
  const vln = vlnBom(db, model).map(v => {
    const src = db.prepare('SELECT source, updated_by, updated_at FROM bom_vln WHERE model = ? AND material = ?').get(model, v.material);
    return { ...v, source: src.source, updatedBy: src.updated_by, perCode: codes.map(c => pt.get(`${c}\u001f${v.material}`) ?? null), issues: issues.filter(i => i.material === v.material).map(i => i.text) };
  });
  const hvMap = new Map();
  for (const r of rows.filter(r => r.kit_group === 'REAR' || r.kit_group === 'VLDT')) {
    if (!hvMap.has(r.material)) hvMap.set(r.material, { material: r.material, description: r.description, group: r.kit_group, perCode: codes.map(() => null) });
    hvMap.get(r.material).perCode[codes.indexOf(r.model_code)] = r.point;
  }
  const hv = [...hvMap.values()].sort((a, b) => ORDER[a.group] - ORDER[b.group] || a.material.localeCompare(b.material));
  return { ...cat, codeList: codes, byCode, vln, hv, issues };
}

function groupOrThrow(v) { const g = normalizeGroup(v); if (!g) throw fail('Chọn nhóm kitting.'); return g; }
export function saveBomRow(db, { id, modelCode, material, description, point, process, group, allCodes }, user) {
  const p = Number(point); if (!Number.isFinite(p) || p <= 0) throw fail('Point phải lớn hơn 0.');
  const g = groupOrThrow(group);
  return tx(db, () => {
    if (id) {
      const row = db.prepare('SELECT * FROM bom WHERE id = ?').get(Number(id)); if (!row) throw fail('Dòng BOM không còn.', 404);
      const model = modelOfCode(db, row.model_code);
      db.prepare("UPDATE bom SET description = ?, point = ?, process = ?, kit_group = ?, group_source = 'manual' WHERE id = ?").run(String(description ?? row.description), p, String(process ?? row.process ?? ''), g, row.id);
      if (allCodes) db.prepare(`UPDATE bom SET point = ?, description = ? WHERE material = ? AND model_code IN (SELECT b.model_code FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code WHERE ${MODEL} = ?)`).run(p, String(description ?? row.description), row.material, model);
      if (g !== row.kit_group) setGroup(db, { model, material: row.material, group: g }, user); else rebuildVln(db, [model]);
      audit(db, user, 'bom.row.edit', { code: row.model_code, material: row.material, point: p, group: g, allCodes: !!allCodes });
      return { ok: true, message: `Đã sửa ${row.material}${allCodes ? ' (mọi Model Code)' : ''}` };
    }
    const code = String(modelCode || '').trim(), mat = String(material || '').trim();
    if (!code || !mat) throw fail('Nhập Model Code và mã vật liệu.');
    const model = modelOfCode(db, code), targets = allCodes ? [...new Set([code, ...codesOf(db, model)])] : [code];
    const ins = db.prepare("INSERT INTO bom(model_code, material, description, point, process, kit_group, group_source) VALUES (?,?,?,?,?,?,'manual') ON CONFLICT(model_code, material) DO NOTHING");
    let added = 0; for (const c of targets) added += Number(ins.run(c, mat, String(description || ''), p, String(process || ''), g).changes);
    if (!added) throw fail(`${mat} đã có trong BOM.`);
    if (codesOf(db, model).length > 1) setGroup(db, { model, material: mat, group: g }, user); else rebuildVln(db, [model]);
    audit(db, user, 'bom.row.add', { code, material: mat, point: p, group: g, codes: targets.length });
    return { ok: true, message: `Đã thêm ${mat} vào ${added} Model Code` };
  });
}
export function deleteBomRow(db, { id, allCodes }, user) {
  return tx(db, () => {
    const row = db.prepare('SELECT * FROM bom WHERE id = ?').get(Number(id)); if (!row) throw fail('Dòng BOM không còn.', 404);
    const model = modelOfCode(db, row.model_code);
    const n = allCodes ? db.prepare(`DELETE FROM bom WHERE material = ? AND model_code IN (SELECT b.model_code FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code WHERE ${MODEL} = ?)`).run(row.material, model).changes
      : db.prepare('DELETE FROM bom WHERE id = ?').run(row.id).changes;
    rebuildVln(db, [model]);
    audit(db, user, 'bom.row.delete', { code: row.model_code, material: row.material, allCodes: !!allCodes });
    return { ok: true, message: `Đã xóa ${row.material} khỏi ${n} Model Code` };
  });
}
export function saveModelCode(db, { modelCode, model, copyFrom }, user) {
  const code = String(modelCode || '').trim(), m = String(model || '').trim();
  if (!code || !m) throw fail('Nhập Model Code và Model.');
  return tx(db, () => {
    const old = db.prepare('SELECT model FROM model_map WHERE model_code = ?').get(code)?.model;
    db.prepare('INSERT INTO model_map(model_code, model) VALUES (?, ?) ON CONFLICT(model_code) DO UPDATE SET model = excluded.model').run(code, m);
    let copied = 0;
    if (copyFrom && copyFrom !== code) {
      if (db.prepare('SELECT 1 FROM bom WHERE model_code = ? LIMIT 1').get(code)) throw fail(`${code} đã có BOM — xóa BOM cũ trước khi chép.`);
      copied = Number(db.prepare(`INSERT INTO bom(model_code, material, description, point, process, kit_group, group_source)
        SELECT ?, material, description, point, process, kit_group, 'manual' FROM bom WHERE model_code = ?`).run(code, copyFrom).changes);
      if (!copied) throw fail(`${copyFrom} chưa có BOM để chép.`);
    }
    rebuildVln(db, [...new Set([m, old].filter(Boolean))]);
    // Code cuối cùng của tên cũ đã đổi sang tên mới → phân công Line / tham số theo tên mới, tránh Line không khớp Kit.
    let moved = 0;
    if (old && old !== m && !db.prepare('SELECT 1 FROM model_map WHERE model = ? LIMIT 1').get(old)) {
      moved = Number(db.prepare('UPDATE line_assign SET model = ? WHERE model = ?').run(m, old).changes);
      db.prepare('UPDATE OR IGNORE line_params SET model = ? WHERE model = ?').run(m, old); db.prepare('DELETE FROM line_params WHERE model = ?').run(old);
    }
    audit(db, user, 'bom.code.save', { code, model: m, copyFrom: copyFrom || '', lineAssignMoved: moved });
    return { ok: true, message: copied ? `${code}: chép ${copied} dòng từ ${copyFrom}` : `Đã lưu ${code} → ${m}` };
  });
}
export function deleteModelCode(db, { modelCode }, user) {
  return tx(db, () => {
    const code = String(modelCode || '').trim(), model = modelOfCode(db, code);
    const n = db.prepare('DELETE FROM bom WHERE model_code = ?').run(code).changes;
    const usedByPo = db.prepare('SELECT 1 FROM po WHERE model_code = ? LIMIT 1').get(code);
    if (!usedByPo) db.prepare('DELETE FROM model_map WHERE model_code = ?').run(code);
    rebuildVln(db, [model]);
    audit(db, user, 'bom.code.delete', { code, rows: n });
    return { ok: true, message: `Đã xóa BOM ${code} (${n} dòng)${usedByPo ? ' · giữ Model Code vì còn PO' : ''}` };
  });
}
export function saveVlnPoint(db, { model, material, point, reset }, user) {
  return tx(db, () => {
    const row = db.prepare('SELECT * FROM bom_vln WHERE model = ? AND material = ?').get(model, material);
    if (!row) throw fail('Mã không có trong BOM VLN.', 404);
    if (reset) { db.prepare("UPDATE bom_vln SET source = 'auto' WHERE model = ? AND material = ?").run(model, material); rebuildVln(db, [model]); return { ok: true, message: `${material}: lấy lại Point từ BOM gốc` }; }
    const p = Number(point); if (!Number.isFinite(p) || p <= 0) throw fail('Point phải lớn hơn 0.');
    db.prepare("UPDATE bom_vln SET point = ?, source = 'manual', updated_by = ?, updated_at = datetime('now') WHERE model = ? AND material = ?").run(p, user, model, material);
    audit(db, user, 'bom.vln.point', { model, material, point: p });
    return { ok: true, message: `VLN ${material} = ${p}` };
  });
}
