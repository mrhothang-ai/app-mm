// Phiếu yêu cầu vật tư từ Next ERP → Kho kitting trên MM, kết quả soạn báo ngược về ERP (2026-11-18).
// Đặc tả API phía ERP + các quyết định: docs/ERP_DONG_BO_PHIEU.md. Bật / tắt ở Quản trị → Kết nối Next ERP (`req_sync`).
//
// 1. Đồng bộ (cron 15 phút cùng kế hoạch Line + nút ⟳): gọi ERP `pending_requests` (ERP đánh dấu phiếu "Kitting ở app MM",
//    khóa kitting bên ERP) → applyErpRequests:
//    - phiếu "material" (Unplan vật liệu rời): mỗi dòng ERP = 1 yêu cầu ĐÃ DUYỆT ở tab Cấp vật liệu (material_request.erp_req / erp_key).
//    - phiếu "plan" (Kế hoạch theo PO: PO SS / UPL / RMA / ADD): 1 Kit mã = số phiếu ERP, gắn PO (PO SS ghép PO SAP MM đã nhập theo
//      số PO; Code UPL / RMA / ADD tạo PO nội bộ đúng số ERP). Vật liệu của Kit = danh sách ERP đã bung BOM (`lines`), KHÔNG bung
//      BOM MM; nhóm VLN / Rear + VLĐT tra theo nhóm kitting của mã trong BOM MM (không có = VLN). Kit ERP: Planner không gộp /
//      tách / gỡ được (luôn theo phiếu ERP), Kho kitting / giao Line như Kit thường.
//    - phiếu ERP hủy / dừng / trả về: gỡ yêu cầu / Kit chưa soạn; đã soạn thì chỉ cảnh báo (Kho thu hồi / trả kho).
// 2. Báo kết quả: queueReports đối chiếu SL MM đã soạn (Kit: Σ kit_item.kitted; Cấp vật liệu: Σ issued_qty) với SL đã báo
//    (`erp_sent`) → phần tăng thêm thành 1 dòng hàng chờ `erp_report` (report_id duy nhất). Cron 2 phút gửi hàng chờ lên ERP
//    `report_kitting` NGOÀI transaction (ERP tạo Stock Entry có thể vài giây). ERP từ chối → trạng thái lỗi, Kho bấm Gửi lại / Bỏ qua.
//    SL giảm sau khi đã báo (thu hồi / trả kho trên MM) không tự đảo trên ERP → cảnh báo để Kho xử lý trên ERP.
import { tx, fail, audit, normalizePo } from './db.mjs';
import { erpCfg, cfgSet, ensureErpSchema } from './erp-line.mjs';
import { todayKey } from './planning.mjs';

export const ERP_REQ_METHOD = 'ilsungtech_erp.api.mm_sync';
const EPS = 1e-6;
const r3 = n => Math.round(Number(n) * 1000) / 1000;
// Loại dòng PO của phiếu Kế hoạch ERP → po.po_type của MM.
const PO_TYPE = { SS: 'SAP', UPL: 'UNPLAN', RMA: 'RMA', ADD: 'ADD' };
const OPEN_STATES = ['open', 'hold'];
const STATE_LABEL = { open: 'Đang kitting', hold: 'ERP tạm giữ', done: 'ERP đã đủ', cancelled: 'ERP đã hủy', deleted: 'ERP đã xóa', stopped: 'ERP đã dừng', released: 'Trả về ERP', reverted: 'ERP lùi bước' };

export function ensureErpReqSchema(db) {
  ensureErpSchema(db);
  db.exec(`
  CREATE TABLE IF NOT EXISTS erp_req (
    name TEXT PRIMARY KEY, kind TEXT NOT NULL, source TEXT, line TEXT, model TEXT, plan_date TEXT, stage TEXT, blocked TEXT,
    data TEXT, state TEXT NOT NULL DEFAULT 'open', kit_id INTEGER, conflict TEXT, warn TEXT,
    first_seen TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS erp_sent (erp_req TEXT NOT NULL, material TEXT NOT NULL, qty REAL NOT NULL DEFAULT 0, PRIMARY KEY (erp_req, material));
  CREATE TABLE IF NOT EXISTS erp_report (
    id INTEGER PRIMARY KEY AUTOINCREMENT, report_id TEXT NOT NULL UNIQUE, erp_req TEXT NOT NULL, rows TEXT NOT NULL, staff TEXT,
    status TEXT NOT NULL DEFAULT 'pending', tries INTEGER NOT NULL DEFAULT 0, error TEXT, result TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), sent_at TEXT);
  CREATE INDEX IF NOT EXISTS erp_report_status ON erp_report(status, id);`);
  for (const [t, c] of [['kit_order', 'erp_req'], ['po', 'erp_req'], ['material_request', 'erp_req'], ['material_request', 'erp_key']]) {
    try { if (!db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} TEXT`); } catch { /* bảng chưa có (bản mới) */ }
  }
}

/* ---------- chặn thao tác trên phiếu ERP ---------- */
const reqRow = (db, name) => name ? db.prepare('SELECT * FROM erp_req WHERE name = ?').get(name) : null;
// Kho soạn / cấp cho phiếu ERP: phiếu phải còn mở và không bị KHSX tạm dừng trên ERP.
export function assertErpOpen(db, name) {
  if (!name) return;
  const r = reqRow(db, name);
  if (!r) return;
  if (!OPEN_STATES.includes(r.state)) throw fail(`Phiếu ERP ${name}: ${STATE_LABEL[r.state] || r.state}, không soạn tiếp được.`);
  if (r.blocked) throw fail(`Phiếu ERP ${name} đang bị chặn trên ERP: ${String(r.blocked).replace(/<[^>]+>/g, '')}`);
}
// Kit / PO thuộc phiếu ERP: Planner không gộp / tách / gỡ / sửa (Kit luôn theo phiếu ERP).
export function assertNotErpKit(kit, act) {
  if (kit?.erp_req) throw fail(`${kit.code} là Kit của phiếu ERP ${kit.erp_req}: không ${act} được (sửa trên ERP).`);
}

/* ---------- 1. đồng bộ phiếu ---------- */
const lineOf = (db, text) => {
  const parts = String(text || '').split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length !== 1) return '';
  const key = parts[0].replace(/\s+/g, '').toLowerCase();
  return db.prepare("SELECT name FROM lines WHERE active = 1 AND lower(replace(name, ' ', '')) = ?").get(key)?.name || '';
};
const kitItems = (db, kitId) => db.prepare('SELECT * FROM kit_item WHERE kit_id = ?').all(kitId);
const kitPosOf = (db, kitId) => db.prepare('SELECT p.* FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = ?').all(kitId);
const untouched = (db, kit) => kit.vln_status !== 'delivered' && !kitItems(db, kit.id).some(i => i.kitted > EPS);

function upsertReq(db, r) {
  const data = JSON.stringify({ codes: r.codes || [], lines: r.lines || [], reason: r.reason || '', requested_by: r.requested_by || '', line_leader: r.line_leader || '', shift: r.shift || '', schedule_date: r.schedule_date || '' });
  db.prepare(`INSERT INTO erp_req(name, kind, source, line, model, plan_date, stage, blocked, data, state, synced_at) VALUES (?,?,?,?,?,?,?,?,?, 'open', datetime('now'))
    ON CONFLICT(name) DO UPDATE SET kind = excluded.kind, source = excluded.source, line = excluded.line, model = excluded.model, plan_date = excluded.plan_date,
      stage = excluded.stage, blocked = excluded.blocked, data = excluded.data, state = 'open', synced_at = excluded.synced_at`)
    .run(r.name, r.kind, r.source || '', r.line || '', r.model || '', r.plan_date || r.schedule_date || '', r.stage || '', r.blocked || '', data);
}

// Phiếu vật liệu rời: mỗi dòng ERP 1 yêu cầu đã duyệt; còn cần = SL ERP − đã cấp trên MM (phiếu chỉ do MM soạn kể từ lúc nhận).
function applyMaterial(db, r) {
  const line = lineOf(db, r.line) || r.line || '—';
  const note = `ERP ${r.name}${r.reason ? ` · ${r.reason}` : ''}`.slice(0, 200);
  const keys = new Set();
  let added = 0;
  for (const l of r.lines || []) {
    keys.add(l.key);
    const issued = db.prepare("SELECT COALESCE(SUM(issued_qty), 0) s FROM material_request WHERE erp_req = ? AND erp_key = ? AND status = 'issued'").get(r.name, l.key).s;
    const need = r3(Number(l.qty) - issued);
    const open = db.prepare("SELECT * FROM material_request WHERE erp_req = ? AND erp_key = ? AND status = 'approved'").get(r.name, l.key);
    if (need > EPS) {
      if (open) { if (r3(open.qty) !== need || open.line !== line) db.prepare('UPDATE material_request SET qty = ?, line = ?, model = ? WHERE id = ?').run(need, line, r.model || '', open.id); }
      else {
        db.prepare(`INSERT INTO material_request(kind, line, model, material, description, qty, note, status, pass, requested_by, approved_by, approved_at, erp_req, erp_key)
          VALUES ('material', ?, ?, ?, ?, ?, ?, 'approved', 1, 'ERP', 'ERP', datetime('now'), ?, ?)`).run(line, r.model || '', l.item_code, l.item_name || '', need, note, r.name, l.key);
        added++;
      }
    } else if (open) db.prepare("UPDATE material_request SET status = 'cancelled', approve_note = 'ERP: đã đủ' WHERE id = ?").run(open.id);
  }
  // Dòng ERP đã bỏ khỏi phiếu: yêu cầu chưa cấp thì hủy.
  for (const o of db.prepare("SELECT id, erp_key FROM material_request WHERE erp_req = ? AND status = 'approved'").all(r.name)) {
    if (!keys.has(o.erp_key)) db.prepare("UPDATE material_request SET status = 'cancelled', approve_note = 'ERP: dòng đã bỏ' WHERE id = ?").run(o.id);
  }
  return added;
}

// Nhóm kitting của mã theo BOM MM (trong các Model Code của Kit): Rear / VLĐT → HV theo code đó, còn lại VLN.
function groupOf(db, material, codes) {
  if (codes.length) {
    const b = db.prepare(`SELECT model_code, kit_group FROM bom WHERE material = ? AND model_code IN (${codes.map(() => '?').join(',')})
      ORDER BY CASE kit_group WHEN 'REAR' THEN 0 WHEN 'VLDT' THEN 1 ELSE 2 END LIMIT 1`).get(material, ...codes);
    if (b && (b.kit_group === 'REAR' || b.kit_group === 'VLDT')) return { grp: 'HV', kitGroup: b.kit_group, code: b.model_code };
  }
  return { grp: 'VLN', kitGroup: 'VLN', code: '' };
}
// Định mức Kit = SL cần trên ERP. Mã mới → thêm; mã ERP bỏ → xóa nếu chưa soạn; nhóm đã giao Line thì không đụng (nợ giữ nguyên).
function syncKitItems(db, kit, r) {
  const codes = [...new Set(kitPosOf(db, kit.id).map(p => p.model_code))];
  const want = new Map();
  for (const l of r.lines || []) {
    const g = groupOf(db, l.item_code, codes), k = `${g.grp}\u001f${g.code}\u001f${l.item_code}`;
    const w = want.get(k) || { ...g, material: l.item_code, description: l.item_name || '', required: 0 };
    w.required = r3(w.required + Number(l.qty || 0));
    want.set(k, w);
  }
  const delivered = kit.vln_status === 'delivered';
  const have = new Map(kitItems(db, kit.id).map(i => [`${i.grp}\u001f${i.model_code}\u001f${i.material}`, i]));
  const warn = [];
  if (!delivered) {
    for (const [k, w] of want) {
      const i = have.get(k);
      if (!i) db.prepare('INSERT INTO kit_item(kit_id, grp, kit_group, model_code, material, description, required) VALUES (?,?,?,?,?,?,?)').run(kit.id, w.grp, w.kitGroup, w.code, w.material, w.description, w.required);
      else if (r3(i.required) !== w.required) db.prepare('UPDATE kit_item SET required = ? WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?').run(w.required, kit.id, i.grp, i.model_code, i.material);
    }
    for (const [k, i] of have) {
      if (want.has(k)) continue;
      if (i.kitted > EPS) warn.push(`${i.material}: ERP bỏ khỏi phiếu nhưng đã soạn ${r3(i.kitted)}`);
      else db.prepare('DELETE FROM kit_item WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?').run(kit.id, i.grp, i.model_code, i.material);
    }
    // Nhóm không có mã nào: coi như xong để Kit giao Line được (VLN trống thì Rear + VLĐT vẫn bắt đầu được).
    for (const grp of ['VLN', 'HV']) {
      const col = grp === 'VLN' ? 'vln_status' : 'hv_status';
      const n = db.prepare('SELECT COUNT(*) n FROM kit_item WHERE kit_id = ? AND grp = ?').get(kit.id, grp).n;
      if (!n && kit[col] === 'pending') db.prepare(`UPDATE kit_order SET ${col} = 'done', updated_at = datetime('now') WHERE id = ?`).run(kit.id);
    }
  }
  return warn;
}
// Phiếu Kế hoạch: 1 Kit mã = số phiếu ERP.
function applyPlan(db, r) {
  const req = reqRow(db, r.name);
  let kit = req?.kit_id ? db.prepare('SELECT * FROM kit_order WHERE id = ?').get(req.kit_id) : null;
  const line = lineOf(db, r.line);
  const codes = r.codes || [];
  const warn = [];
  if (kit) {
    // ERP đổi danh sách PO (KHSX thay thế PO): Kit chưa soạn thì gắn lại theo ERP, đã soạn thì chỉ cảnh báo.
    const now = new Set(kitPosOf(db, kit.id).map(p => p.po_key)), want = new Set(codes.map(c => normalizePo(c.code)));
    const same = now.size === want.size && [...want].every(k => now.has(k));
    if (!same) {
      if (untouched(db, kit)) { dropKit(db, kit, r.name); kit = null; }
      else warn.push('ERP đổi danh sách PO sau khi Kho đã soạn: kiểm tra lại Kit.');
    }
  }
  if (!kit) {
    const conflict = [];
    for (const c of codes) {
      const key = normalizePo(c.code);
      const other = db.prepare('SELECT k.code, k.erp_req FROM kit_order_po x JOIN kit_order k ON k.id = x.kit_id WHERE x.po_key = ?').get(key);
      if (other && other.erp_req !== r.name) conflict.push(`${c.code} đang ở Kit ${other.code}`);
    }
    if (conflict.length) {
      db.prepare('UPDATE erp_req SET conflict = ?, kit_id = NULL WHERE name = ?').run(conflict.join('; '), r.name);
      return { created: 0, conflict };
    }
    for (const c of codes) {
      const key = normalizePo(c.code), type = PO_TYPE[c.type] || 'SAP';
      const p = db.prepare('SELECT * FROM po WHERE po_key = ?').get(key);
      if (p) { db.prepare('UPDATE po SET erp_req = ? WHERE po_key = ?').run(r.name, key); continue; }
      const fixed = type === 'SAP' ? null : (lineOf(db, c.line) || line || null);
      db.prepare(`INSERT INTO po(po_key, po_no, plan_date, basic_model, model_code, plan_qty, remain_qty, po_type, fixed_line, ref_doc, note, created_by, in_source, erp_req)
        VALUES (?,?,?,?,?,?,?,?,?,?,?, 'ERP', 1, ?)`).run(key, c.code, r.plan_date || r.schedule_date || null, r.model || null, c.item_code, Number(c.qty) || 0, Number(c.qty) || 0, type, fixed,
        (c.unplan_request || r.name).slice(0, 60), `ERP ${r.name}`, r.name);
    }
    const first = codes[0];
    if (!first) return { created: 0, conflict: [] };
    let code = r.name;
    if (db.prepare('SELECT 1 FROM kit_order WHERE code = ?').get(code)) code = `${r.name}-${Date.now() % 100000}`;
    const day = r.plan_date || r.schedule_date || todayKey();
    const seq = (db.prepare('SELECT MAX(seq) m FROM kit_order WHERE plan_day = ?').get(day).m ?? -1) + 1;
    const res = db.prepare("INSERT INTO kit_order(code, kind, model_code, plan_day, seq, plan_line, created_by, erp_req) VALUES (?,?,?,?,?,?, 'ERP', ?)")
      .run(code, codes.length > 1 ? 'merged' : 'single', first.item_code, day, seq, line || null, r.name);
    for (const c of codes) db.prepare('INSERT INTO kit_order_po(kit_id, po_key) VALUES (?, ?)').run(res.lastInsertRowid, normalizePo(c.code));
    kit = db.prepare('SELECT * FROM kit_order WHERE id = ?').get(Number(res.lastInsertRowid));
    db.prepare('UPDATE erp_req SET kit_id = ?, conflict = NULL WHERE name = ?').run(kit.id, r.name);
    syncKitItems(db, kit, r);
    return { created: 1, conflict: [] };
  }
  if (line && kit.plan_line !== line) db.prepare('UPDATE kit_order SET plan_line = ? WHERE id = ?').run(line, kit.id);
  warn.push(...syncKitItems(db, kit, r));
  db.prepare('UPDATE erp_req SET conflict = NULL, warn = ? WHERE name = ?').run(warn.length ? warn.join('; ') : null, r.name);
  return { created: 0, conflict: [] };
}
// Gỡ Kit chưa soạn của phiếu ERP: PO nội bộ do ERP tạo → Cancel; PO SAP → trả về cột Chưa lập KH.
function dropKit(db, kit, name) {
  for (const p of kitPosOf(db, kit.id)) {
    if (p.po_type !== 'SAP' && p.created_by === 'ERP') db.prepare("UPDATE po SET plan_status = 'Cancel', erp_req = NULL WHERE po_key = ?").run(p.po_key);
    else db.prepare('UPDATE po SET erp_req = NULL WHERE po_key = ?').run(p.po_key);
  }
  db.prepare('DELETE FROM kit_item WHERE kit_id = ?').run(kit.id);
  db.prepare('DELETE FROM kit_order_po WHERE kit_id = ?').run(kit.id);
  db.prepare('DELETE FROM kit_order WHERE id = ?').run(kit.id);
  db.prepare('UPDATE erp_req SET kit_id = NULL WHERE name = ?').run(name);
}
// Phiếu đã ra khỏi hàng chờ ERP.
function closeReq(db, name, state) {
  const req = reqRow(db, name);
  if (!req) return null;
  db.prepare("UPDATE erp_req SET state = ?, synced_at = datetime('now') WHERE name = ?").run(state, name);
  if (state === 'done' || state === 'hold') return state;
  db.prepare("UPDATE material_request SET status = 'cancelled', approve_note = ? WHERE erp_req = ? AND status = 'approved'").run(`ERP: ${STATE_LABEL[state] || state}`, name);
  const kit = req.kit_id ? db.prepare('SELECT * FROM kit_order WHERE id = ?').get(req.kit_id) : null;
  if (kit) {
    if (untouched(db, kit)) dropKit(db, kit, name);
    else db.prepare('UPDATE erp_req SET warn = ? WHERE name = ?').run(`ERP: ${STATE_LABEL[state] || state} — Kit ${kit.code} đã soạn: Kho thu hồi / trả kho trên MM và xử lý trên ERP.`, name);
  }
  return state;
}

export function applyErpRequests(db, data, { username = 'ERP', source = 'ERP' } = {}) {
  ensureErpReqSchema(db);
  return tx(db, () => {
    const s = { ok: true, source, requests: 0, material: 0, plan: 0, newRows: 0, newKits: 0, conflicts: [], closed: [] };
    for (const r of data?.requests || []) {
      if (!r?.name || !['material', 'plan'].includes(r.kind)) continue;
      upsertReq(db, r);
      s.requests++;
      if (r.kind === 'material') { s.material++; s.newRows += applyMaterial(db, r); }
      else {
        s.plan++;
        const p = applyPlan(db, r);
        s.newKits += p.created;
        if (p.conflict.length) s.conflicts.push({ name: r.name, items: p.conflict });
      }
    }
    for (const c of data?.closed || []) { const st = closeReq(db, c.name, c.state); if (st) s.closed.push({ name: c.name, state: st }); }
    s.changed = !!(s.newRows || s.newKits || s.closed.length);
    db.prepare('INSERT INTO import_log(kind, source, summary, created_by) VALUES (?,?,?,?)').run('ERP_REQ', source, JSON.stringify(s), username);
    db.prepare("DELETE FROM import_log WHERE kind = 'ERP_REQ' AND created_at < datetime('now', '-30 days')").run();
    cfgSet(db, 'req_ok_at', new Date().toISOString());
    return s;
  });
}
// Phiếu MM đang giữ (để ERP báo phiếu nào đã ra khỏi hàng chờ).
export const knownRequests = db => { ensureErpReqSchema(db); return db.prepare(`SELECT name FROM erp_req WHERE state IN ('open','hold')`).all().map(r => r.name); };

/* ---------- 2. báo kết quả soạn ---------- */
function pickedOf(db, req) {
  const rows = req.kind === 'plan'
    ? (req.kit_id ? db.prepare('SELECT material, SUM(kitted) q FROM kit_item WHERE kit_id = ? GROUP BY material').all(req.kit_id) : [])
    : db.prepare("SELECT material, SUM(issued_qty) q FROM material_request WHERE erp_req = ? AND status = 'issued' GROUP BY material").all(req.name);
  return new Map(rows.map(r => [r.material, r3(r.q || 0)]));
}
function staffOf(db, req) {
  if (req.kind === 'plan' && req.kit_id) {
    const k = db.prepare('SELECT code FROM kit_order WHERE id = ?').get(req.kit_id);
    return k ? db.prepare("SELECT username FROM kit_txn WHERE kit_code = ? AND username <> '' ORDER BY id DESC LIMIT 1").get(k.code)?.username || '' : '';
  }
  return db.prepare("SELECT issued_by FROM material_request WHERE erp_req = ? AND status = 'issued' ORDER BY issued_at DESC LIMIT 1").get(req.name)?.issued_by || '';
}
const newReportId = name => `MM-${name}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
// Phần MM soạn thêm so với đã báo → hàng chờ gửi ERP. Gọi trước mỗi lượt gửi.
export function queueReports(db) {
  ensureErpReqSchema(db);
  return tx(db, () => {
    let queued = 0;
    for (const req of db.prepare("SELECT * FROM erp_req WHERE state IN ('open','hold')").all()) {
      const picked = pickedOf(db, req), sent = new Map(db.prepare('SELECT material, qty FROM erp_sent WHERE erp_req = ?').all(req.name).map(r => [r.material, r.qty]));
      const rows = [], minus = [];
      for (const m of new Set([...picked.keys(), ...sent.keys()])) {
        const d = r3((picked.get(m) || 0) - (sent.get(m) || 0));
        if (d > EPS) rows.push({ item_code: m, qty: d });
        else if (d < -EPS) minus.push(`${m} −${r3(-d)}`);
      }
      const warnMinus = minus.length ? `MM đã giảm sau khi báo ERP (thu hồi / trả kho): ${minus.join(', ')} — Kho xử lý trên ERP.` : null;
      if ((req.warn || null) !== warnMinus && (!req.warn || req.warn.startsWith('MM đã giảm'))) db.prepare('UPDATE erp_req SET warn = ? WHERE name = ?').run(warnMinus, req.name);
      if (!rows.length) continue;
      db.prepare('INSERT INTO erp_report(report_id, erp_req, rows, staff) VALUES (?,?,?,?)').run(newReportId(req.name), req.name, JSON.stringify(rows), staffOf(db, req));
      const up = db.prepare('INSERT INTO erp_sent(erp_req, material, qty) VALUES (?,?,?) ON CONFLICT(erp_req, material) DO UPDATE SET qty = qty + excluded.qty');
      for (const r of rows) up.run(req.name, r.item_code, r.qty);
      queued++;
    }
    return { queued };
  });
}
export const pendingReports = (db, limit = 20) => { ensureErpReqSchema(db); return db.prepare("SELECT * FROM erp_report WHERE status = 'pending' ORDER BY id LIMIT ?").all(limit); };
// Payload gửi ERP cho 1 dòng hàng chờ.
export const reportBody = rep => ({ request: rep.erp_req, report_id: rep.report_id, rows: JSON.parse(rep.rows || '[]'), staff: rep.staff || '', note: 'App MM' });
// Kết quả gửi: ok → xong; lỗi mạng (status 0 / 5xx) → giữ chờ, thử lại lượt sau; ERP từ chối (4xx) → lỗi, chờ Kho xử lý.
export function markReport(db, id, { status, json, message }) {
  return tx(db, () => {
    const ok = status >= 200 && status < 300 && json?.message?.ok;
    if (ok) db.prepare("UPDATE erp_report SET status = 'ok', tries = tries + 1, error = NULL, result = ?, sent_at = datetime('now') WHERE id = ?").run(JSON.stringify(json.message.stock_entries || []), id);
    else if (!status || status >= 500) db.prepare("UPDATE erp_report SET tries = tries + 1, error = ? WHERE id = ?").run(message || `ERP không phản hồi (${status || 'mạng'})`, id);
    else db.prepare("UPDATE erp_report SET status = 'error', tries = tries + 1, error = ?, sent_at = datetime('now') WHERE id = ?").run(message || `ERP từ chối (${status})`, id);
    return ok;
  });
}
// Lỗi tiếng Việt ERP trả về (_server_messages là chuỗi JSON lồng, có thẻ HTML).
export function erpMessage(json, status) {
  try {
    const list = JSON.parse(json?._server_messages || '[]').map(m => { try { return JSON.parse(m).message; } catch { return m; } });
    const text = list.join(' · ') || json?.exception || json?.message || '';
    return String(text).replace(/<br\s*\/?>/gi, ' · ').replace(/<[^>]+>/g, '').trim().slice(0, 500) || `ERP trả lỗi ${status}`;
  } catch { return `ERP trả lỗi ${status}`; }
}

/* ---------- gọi ERP ---------- */
function readyCfg(db, makePost, auto) {
  const c = erpCfg(db);
  if (auto && !c.reqSync) return { skip: { ok: true, skipped: 'Chưa bật đồng bộ phiếu ERP' } };
  if (!(c.url && c.key && c.secret)) throw fail('Chưa cấu hình kết nối Next ERP (Quản trị → Kết nối Next ERP).');
  if (!makePost) throw fail('Bản chạy này không gọi được Next ERP.');
  return { c };
}
// Lấy phiếu từ ERP (HTTP); trả { data } | { error } | { skip }. Cron truyền sẵn `cfg` + `known` (db = null) để gọi ERP
// ngoài transaction; nút ⟳ truyền db.
export function pullErpRequests(db, makePost, { auto = false, cfg = null, known = null } = {}) {
  let c = cfg;
  if (!c) { ensureErpReqSchema(db); const x = readyCfg(db, makePost, auto); if (x.skip) return { skip: x.skip }; c = x.c; }
  const r = makePost(c)(`/api/method/${ERP_REQ_METHOD}.pending_requests`, { known: known || knownRequests(db), claim: 1 });
  if (r.status === 401) return { error: 'Next ERP từ chối khóa API (401) — kiểm tra API key / secret của tài khoản bot.' };
  if (r.status === 403) return { error: 'Tài khoản bot chưa có role "MM Sync" trên Next ERP (403) — nhờ IT gán role.' };
  if (r.status < 200 || r.status >= 300) return { error: r.status ? erpMessage(r.json, r.status) : 'Không kết nối được Next ERP (mạng).' };
  return { data: r.json?.message || {} };
}
// Đồng bộ trọn 1 lượt trong cùng transaction (nút ⟳ của Kho): lấy phiếu → áp vào MM → xếp hàng chờ báo kết quả.
export function syncErpRequests(db, makePost, { username = 'ERP', source = 'ERP', auto = false } = {}) {
  const got = pullErpRequests(db, makePost, { auto });
  if (got.skip) return got.skip;
  if (got.error) {
    db.prepare('INSERT INTO import_log(kind, source, summary, created_by) VALUES (?,?,?,?)').run('ERP_REQ', source, JSON.stringify({ ok: false, error: got.error }), username);
    return { ok: false, error: got.error };
  }
  const s = applyErpRequests(db, got.data, { username, source });
  const q = queueReports(db);
  if (!auto) audit(db, username, 'erp.req.sync', { requests: s.requests, newKits: s.newKits, newRows: s.newRows, closed: s.closed.length, queued: q.queued });
  return { ...s, queued: q.queued };
}

/* ---------- màn trạng thái + xử lý lỗi ---------- */
export function erpReqStatus(db) {
  ensureErpReqSchema(db);
  const c = erpCfg(db), last = db.prepare("SELECT summary, created_by, created_at FROM import_log WHERE kind = 'ERP_REQ' ORDER BY id DESC LIMIT 1").get();
  const reqs = db.prepare(`SELECT r.*, k.code kit_code, k.vln_status, k.hv_status, k.line kit_line FROM erp_req r LEFT JOIN kit_order k ON k.id = r.kit_id
    WHERE r.state IN ('open','hold') OR r.warn IS NOT NULL OR r.conflict IS NOT NULL ORDER BY r.first_seen DESC LIMIT 300`).all()
    .map(r => ({ name: r.name, kind: r.kind, source: r.source, line: r.line, model: r.model, planDate: r.plan_date, state: r.state, stateLabel: STATE_LABEL[r.state] || r.state,
      blocked: r.blocked ? String(r.blocked).replace(/<[^>]+>/g, '') : '', conflict: r.conflict || '', warn: r.warn || '', kit: r.kit_code || '', kitStatus: r.kit_code ? { vln: r.vln_status, hv: r.hv_status, line: r.kit_line || '' } : null, syncedAt: r.synced_at }));
  const reports = db.prepare("SELECT * FROM erp_report WHERE status IN ('pending','error') OR sent_at > datetime('now', '-1 day') ORDER BY id DESC LIMIT 200").all()
    .map(r => ({ id: r.id, request: r.erp_req, rows: JSON.parse(r.rows || '[]'), staff: r.staff || '', status: r.status, tries: r.tries, error: r.error || '', stockEntries: JSON.parse(r.result || '[]'), createdAt: r.created_at, sentAt: r.sent_at || '' }));
  const n = s => db.prepare('SELECT COUNT(*) n FROM erp_report WHERE status = ?').get(s).n;
  return { configured: !!(c.url && c.key && c.secret), reqSync: c.reqSync, okAt: c.reqOkAt, last: last ? { ...JSON.parse(last.summary || '{}'), by: last.created_by, at: last.created_at } : null,
    kpi: { open: reqs.filter(r => OPEN_STATES.includes(r.state)).length, pending: n('pending'), error: n('error'), warn: reqs.filter(r => r.warn || r.conflict).length }, requests: reqs, reports };
}
// Gửi lại báo cáo bị ERP từ chối (sau khi Kho đã xử lý trên ERP, VD bổ sung tồn) — giữ nguyên report_id.
export function retryReport(db, { id }, username) {
  return tx(db, () => {
    const r = db.prepare('SELECT * FROM erp_report WHERE id = ?').get(Number(id));
    if (!r) throw fail('Không tìm thấy dòng báo kết quả.', 404);
    if (r.status !== 'error') throw fail('Chỉ gửi lại được dòng bị ERP từ chối.');
    db.prepare("UPDATE erp_report SET status = 'pending', error = NULL WHERE id = ?").run(r.id);
    audit(db, username, 'erp.req.retry', { id: r.id, request: r.erp_req });
    return { ok: true, message: `Sẽ gửi lại ${r.erp_req} trong lượt tới (≤ 2 phút).` };
  });
}
// Bỏ qua dòng bị từ chối: không gửi nữa (ERP xử lý tay); SL vẫn tính là đã báo để không tự gửi lại.
export function dropReport(db, { id, note }, username) {
  const why = String(note || '').trim().slice(0, 200);
  if (!why) throw fail('Ghi lý do bỏ qua (VD: Kho đã xử lý trực tiếp trên ERP).');
  return tx(db, () => {
    const r = db.prepare('SELECT * FROM erp_report WHERE id = ?').get(Number(id));
    if (!r) throw fail('Không tìm thấy dòng báo kết quả.', 404);
    if (r.status !== 'error') throw fail('Chỉ bỏ qua được dòng bị ERP từ chối.');
    db.prepare("UPDATE erp_report SET status = 'dropped', error = ? WHERE id = ?").run(`${r.error || ''} · Bỏ qua: ${why}`.slice(0, 500), r.id);
    audit(db, username, 'erp.req.drop', { id: r.id, request: r.erp_req, note: why });
    return { ok: true, message: `Đã bỏ qua báo cáo ${r.erp_req}.` };
  });
}

export function erpRequestRoutes(db, makePost) {
  ensureErpReqSchema(db);
  return [
    { method: 'GET', path: '/api/erp/req', handler: () => erpReqStatus(db) },
    { method: 'POST', path: '/api/erp/req/sync', handler: ({ user }) => syncErpRequests(db, makePost, { username: user.username, source: `Đồng bộ tay · ${user.username}` }) },
    { method: 'POST', path: '/api/erp/req/retry', handler: ({ body, user }) => retryReport(db, body || {}, user.username) },
    { method: 'POST', path: '/api/erp/req/drop', handler: ({ body, user }) => dropReport(db, body || {}, user.username) }
  ];
}
