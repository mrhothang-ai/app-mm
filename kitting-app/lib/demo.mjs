// Nạp bộ dữ liệu demo để chạy thử: tài khoản 5 vai trò, 6 Line, BOM có nhóm kitting, PO, Line ↔ Model, một ít kế hoạch mẫu.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { tx, DEFAULT_SETTINGS } from './db.mjs';
import { readPoWorkbook } from './sources/excel-source.mjs';
import { syncPoRows, modelOf, ensurePoSchema } from './po-sync.mjs';
import { importBom, saveVlnPoint } from './bom.mjs';
import { readBomWorkbook } from './bom-read.mjs';
import { todayKey, addDays, merge, saveAssign, saveParams } from './planning.mjs';
import { ensurePlanExtraSchema, weekStart, batchMove } from './plan-extra.mjs';
import { ensureKittingSchema, kitDetail, saveKitting, deliver, adjust, adjustOptions, settleDebt, createRequest, decideRequest, issueRequest, requestForm } from './kitting.mjs';
import { ensureReceiptSchema } from './receipt.mjs';

export const DEMO_PASSWORD = 'Demo@2026';
export const DEMO_USERS = [
  ['admin', 'Quản trị hệ thống', 'admin'],
  ['planner', 'Planner (Kế hoạch)', 'planner'],
  ['kho', 'Kho vật liệu', 'kho'],
  ['line1', 'Leader Line 1', 'line'],
  ['duyet', 'Trưởng bộ phận (duyệt)', 'approver']
];

// readDemo(name) trả về nội dung file trong demo-data (mặc định đọc từ ổ đĩa; bản chạy trên trình duyệt truyền hàm khác).
export async function resetDemo(db, appRoot, readDemo = name => readFile(path.join(appRoot, 'demo-data', name))) {
  const poRows = await readPoWorkbook(await readDemo('Production Plan by Order_DEMO.xlsx'), 'Production Plan by Order_DEMO.xlsx');
  const bom = await readBomWorkbook(await readDemo('BOM_kitting_DEMO.xlsx'), 'BOM_kitting_DEMO.xlsx');
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  ensureKittingSchema(db); ensurePlanExtraSchema(db); ensurePoSchema(db); ensureReceiptSchema(db);
  tx(db, () => {
    for (const t of ['kit_receipt', 'kit_receipt_log', 'plan_undo', 'bom_vln', 'material_request', 'kit_txn', 'kit_item', 'kit_order_po', 'kit_order', 'line_params', 'line_assign', 'bom', 'model_map', 'po_history', 'po', 'lines', 'users', 'import_log', 'audit_log', 'settings']) db.exec(`DELETE FROM ${t}`);
    const st = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) st.run(k, v);
    const u = db.prepare('INSERT INTO users(username, display_name, role, password_hash) VALUES (?,?,?,?)');
    for (const [username, name, role] of DEMO_USERS) u.run(username, name, role, hash);
    const l = db.prepare('INSERT INTO lines(name, sort_order) VALUES (?, ?)');
    for (let i = 1; i <= 6; i++) l.run(`Line ${i}`, i);
  });
  importBom(db, bom, { source: 'BOM_kitting_DEMO.xlsx (demo)', username: 'demo' });
  syncPoRows(db, poRows, { source: 'Production Plan by Order_DEMO.xlsx (demo)', username: 'demo' });

  seedAfterImport(db);
  db.prepare("DELETE FROM audit_log WHERE username = 'demo'").run();
  return { users: DEMO_USERS.length, po: poRows.length, bom: bom.rows.length };
}

// Phần dữ liệu tình huống sau khi đã có BOM + PO + 6 Line (dùng chung cho bản Claude và kiểm thử trên PocketBase).
export function seedAfterImport(db) {
  // Line ↔ Model cả tuần (kể cả Chủ nhật để test ngày nào cũng có số liệu). Line 6 nghỉ hôm nay, chạy X946 từ ngày mai.
  const today = todayKey(), ws = weekStart(today);
  const base = [['Line 1', 'BSM-F731'], ['Line 2', 'BSM-F731'], ['Line 3', 'BSM-S947'], ['Line 4', 'BSM-F766 Main'], ['Line 5', 'BSM-X406'], ['Line 6', '']];
  for (let i = 0; i < 7; i++) {
    const day = addDays(ws, i);
    for (const shift of ['Ngày', 'Đêm']) saveAssign(db, { day, shift, rows: base.map(([line, model]) => ({ line,
      model: line === 'Line 6' ? (day > today ? 'BSM-X946' : '') : shift === 'Đêm' && line === 'Line 2' ? 'BSM-S947 B3' : model })) }, 'demo');
  }
  // Rải chuyền / pending theo Line + Model. Line 5 + X406 cố ý chưa khai báo (thấy cảnh báo thiếu tham số).
  saveParams(db, [
    { line: 'Line 1', model: 'BSM-F731', spreadQty: 400, pendingQty: 50, uph: 180, note: 'Ví dụ 595 − 400 − 50 = 145 < 200' },
    { line: 'Line 2', model: 'BSM-F731', spreadQty: 300, pendingQty: 0, uph: 200 },
    { line: 'Line 2', model: 'BSM-S947 B3', spreadQty: 200, pendingQty: 0, uph: 150 },
    { line: 'Line 3', model: 'BSM-S947', spreadQty: 250, pendingQty: 120, uph: 160, note: 'Hàng chờ sửa camera' },
    { line: 'Line 4', model: 'BSM-F766 Main', spreadQty: 400, pendingQty: 80, uph: 150 },
    { line: 'Line 6', model: 'BSM-X946', spreadQty: 300, pendingQty: 0, uph: 170 }
  ], 'demo');
  seedHistory(db);
  seedScenario(db, today);
}

/* Kịch bản hôm nay — đủ các tình huống để thao tác thử:
   Line 1 F731   : còn 595 − 400 − 50 = 145 < 200 → được cấp PO, có PO sẵn sàng (vàng). Có YC vật liệu chờ cấp.
   Line 2 F731   : còn ~865 ≥ 200 → đủ việc. Kho đã gửi duyệt giao sớm (YC PO chờ duyệt) + YC vật liệu chờ duyệt.
   Line 3 S947   : còn ~470 ≥ 200 → đủ việc, nhưng YC PO ngoại lệ ĐÃ DUYỆT → Kho giao được PO S947 đang sẵn sàng.
   Line 4 F766   : còn < 200, không có PO F766 sẵn sàng → đỏ (nguy cơ hết việc); PO đã giao còn nợ Rear + VLN.
   Line 5 X406   : chưa khai báo rải chuyền; YC PO tự đạt chờ giao nhưng PO X406 duy nhất xong lại thiếu Rear (=0) → bị chặn.
   Line 6        : nghỉ hôm nay.
   Kho: PO chưa làm / đang làm / xong / xong còn thiếu / Kit PO gộp / PO chưa có BOM / PO bị thu hồi khỏi line / điều chỉnh. */
function seedScenario(db, today) {
  const tomorrow = addDays(today, 1), day2 = addDays(today, 2);
  const used = new Set(db.prepare('SELECT po_key FROM kit_order_po').all().map(r => r.po_key));
  const find = (tail, qty, remain) => {
    const all = db.prepare('SELECT * FROM po WHERE in_source = 1 AND remain_qty > 0 AND model_code = ? ORDER BY plan_date, plan_start, po_no').all(`GH96-${tail}`).filter(p => !used.has(p.po_key));
    const p = all.find(x => x.plan_qty === qty && x.remain_qty === remain) || all.find(x => x.plan_qty === qty) || all[0];
    if (p) used.add(p.po_key);
    return p || null;
  };
  const kitOf = p => p && db.prepare('SELECT k.* FROM kit_order k JOIN kit_order_po x ON x.kit_id = k.id WHERE x.po_key = ?').get(p.po_key);
  const plan = (day, list) => { const items = list.filter(Boolean).map(p => ({ type: 'po', id: p.po_key })); if (items.length) batchMove(db, { items, day }, 'planner'); };
  const safe = (label, fn) => { try { return fn(); } catch (err) { console.warn(`demo ${label}:`, err.message); } };
  const fill = (kit, grp, rule, confirm = true) => {
    if (!kit) return;
    const d = kitDetail(db, kit.id, grp);
    saveKitting(db, { kitId: kit.id, grp, confirm, shortReason: 'STOCK', items: d.items.map((it, i) => ({ code: it.code, material: it.material, kitted: Math.floor(it.required * rule(it, i)) })) }, 'kho');
  };
  const full = () => 1, both = k => { fill(k, 'VLN', full); fill(k, 'HV', full); };
  const give = (k, line) => k && deliver(db, { kitId: k.id, line }, 'kho');

  // --- chọn PO ---
  const F = {
    a: find('15938A', 595, 595), b: find('15938D', 960, 205), c: find('15937D', 960, 960), d: find('15937A', 960, 960),
    e1: find('15937A', 40, 40), e2: find('15937A', 832, 832), f: find('15938D', 240, 134), g: find('15938A', 40, 40),
    h: find('15937C', 583, 583), x1: find('15938D', 465, 465), x2: find('15938B', 704, 704), i1: find('15936A', 264, 264), i2: find('15938C', 500, 487), j: find('15936B', 5, 5)
  };
  const S = { k: find('20914A', 960, 360), l: find('20914A', 480, 480), m: find('20914A', 960, 960), n: find('20914E', 40, 40), o: find('20914A', 320, 320) };
  const M = { p: find('22471C', 960, 636), q: find('22471C', 960, 960), r: find('22576D', 200, 200) };
  const X = { s: find('20644C', 960, 40), t: find('20644A', 960, 385), u: find('20644A', 480, 480), v: find('20644A', 120, 120) };
  const other = { w: find('23114A', 960, 176), x: find('16355B', 100, 100), y: find('21998A', 960, 960), z: find('23255A', 960, 110) };

  // --- lập kế hoạch: hôm nay / ngày mai / ngày kia ---
  plan(today, [F.a, F.b, F.h, F.c, S.k, S.l, M.p, X.s, F.d, S.m, F.f, X.t, S.n, F.g, X.u, other.z, F.j, S.o, X.v, other.w, other.x]);
  plan(tomorrow, [F.i1, F.i2, M.q, other.y]);
  plan(day2, [M.r]);
  safe('gộp', () => { if (F.e1 && F.e2) merge(db, [{ type: 'po', id: F.e1.po_key }, { type: 'po', id: F.e2.po_key }], 'planner'); });
  // Kit gộp 2 Model Code khác nhau cùng Model F731 (465 + 704 = 1.169 ≤ 2.500).
  safe('gộp khác code', () => { if (F.x1 && F.x2) merge(db, [{ type: 'po', id: F.x1.po_key }, { type: 'po', id: F.x2.po_key }], 'planner'); });
  safe('kế hoạch kit gộp khác code', () => { const x = kitOf(F.x1); if (x) batchMove(db, { items: [{ type: 'kit', id: x.id }], day: today, position: 'end' }, 'planner'); });
  const e = kitOf(F.e1);
  safe('kế hoạch kit gộp', () => e && batchMove(db, { items: [{ type: 'kit', id: e.id }], day: today, position: 'end' }, 'planner'));
  const K = {}; for (const [k, p] of Object.entries({ ...F, ...S, ...M, ...X, ...other })) K[k] = kitOf(p);

  // --- giao line (theo đúng quy tắc cấp) ---
  safe('Line 1', () => { both(K.a); give(K.a, 'Line 1'); });
  safe('Line 2', () => { both(K.b); give(K.b, 'Line 2'); both(K.h); give(K.h, 'Line 2'); });
  safe('thu hồi', () => {   // giao nhầm Model Code → thu hồi toàn bộ, PO quay về chờ giao
    const o = adjustOptions(db, K.h.id);
    adjust(db, { kitId: K.h.id, type: 'recall', reasonCode: 'MODEL_CHANGE', note: 'Giao nhầm, line đổi kế hoạch', items: o.items.filter(i => i.delivered > 0).map(i => ({ grp: i.grp, code: i.code, material: i.material, qty: i.delivered })) }, 'kho');
  });
  safe('Line 2 tiếp', () => { both(K.c); give(K.c, 'Line 2'); });
  safe('Line 3', () => { fill(K.k, 'VLN', (it, i) => i === 0 ? 0.8 : 1); fill(K.k, 'HV', full); give(K.k, 'Line 3');
    const it = db.prepare("SELECT * FROM kit_item WHERE kit_id = ? AND delivered < required").get(K.k.id);
    if (it) settleDebt(db, { kitId: K.k.id, grp: it.grp, code: it.model_code, material: it.material, qty: it.required - it.delivered }, 'kho'); both(K.l); give(K.l, 'Line 3'); });
  safe('Line 4', () => { fill(K.p, 'VLN', (it, i) => i === 2 ? 0.5 : 1); fill(K.p, 'HV', it => it.kitGroup === 'REAR' ? 0.5 : 1); give(K.p, 'Line 4'); });
  safe('Line 4 giao bù 1 phần', () => { const it = db.prepare("SELECT * FROM kit_item WHERE kit_id = ? AND kit_group = 'REAR'").get(K.p.id); settleDebt(db, { kitId: K.p.id, grp: 'HV', code: it.model_code, material: it.material, qty: Math.floor((it.required - it.delivered) / 3) }, 'kho'); });
  safe('Line 5', () => { both(K.s); give(K.s, 'Line 5'); });

  // --- trạng thái kho các PO còn lại ---
  safe('d', () => both(K.d));                                                                  // F731 xong đủ → chờ giao
  safe('e', () => { fill(K.e1, 'VLN', full); fill(K.e1, 'HV', (it, i) => it.kitGroup === 'VLDT' ? 0.5 : 1); });   // Kit gộp xong, thiếu VLĐT
  safe('m', () => both(K.m));
  safe('x', () => { fill(K.x1, 'VLN', full); fill(K.x1, 'HV', it => it.kitGroup === 'REAR' && it.code === F.x2.model_code ? 0 : 1); });   // Kit gộp 2 code: code 15938B chưa có Rear                                                                  // S947 xong đủ → giao Line 3 (đã duyệt)
  safe('f', () => { fill(K.f, 'VLN', full); fill(K.f, 'HV', it => it.kitGroup === 'REAR' ? 1 : 0, false); });   // VLN xong, R+VLĐT đang làm
  safe('t', () => { fill(K.t, 'VLN', full); fill(K.t, 'HV', it => it.kitGroup === 'REAR' ? 0 : 1); });          // X406 xong nhưng Rear = 0 → không giao được
  safe('n', () => fill(K.n, 'VLN', full));                                                     // S947 E: VLN xong, R+VLĐT chưa làm
  safe('g', () => fill(K.g, 'VLN', (it, i) => i % 2 ? 0.5 : 1, false));                       // F731 VLN đang làm
  safe('u', () => fill(K.u, 'VLN', full));                                                     // X406: VLN xong rồi trả lỗi → đang làm
  safe('z', () => fill(K.z, 'VLN', (it, i) => i < 4 ? 1 : 0, false));                          // X946 VLN đang làm
  safe('chuyển', () => {   // chuyển VLN từ F731 (f) sang F731 (g) đang thiếu
    const gi = kitDetail(db, K.g.id, 'VLN').items.find(i => i.kitted < i.required);
    const fi = gi && kitDetail(db, K.f.id, 'VLN').items.find(i => i.material === gi.material);
    if (gi && fi) adjust(db, { kitId: K.f.id, type: 'transfer', targetId: K.g.id, reasonCode: 'URGENT', note: 'PO gấp', items: [{ grp: 'VLN', material: gi.material, qty: Math.min(fi.kitted, gi.required - gi.kitted) }] }, 'kho');
  });
  safe('trả kho', () => { const it = kitDetail(db, K.u.id, 'VLN').items.find(i => i.kitted > 0); adjust(db, { kitId: K.u.id, type: 'return', reasonCode: 'DEFECT', note: 'Lỗi ngoại quan', items: [{ grp: 'VLN', material: it.material, qty: Math.min(10, it.kitted) }] }, 'kho'); });

  // --- yêu cầu cấp (PO tiếp theo / vật liệu lẻ) ---
  const mat = line => requestForm(db, line).materials.find(m => m.kit_group === 'VLN')?.material;
  safe('YC1', () => createRequest(db, { line: 'Line 1', material: mat('Line 1'), qty: 100, note: 'Hết băng dính' }, 'line1'));
  safe('YC2', () => { const r = createRequest(db, { line: 'Line 1', material: mat('Line 1'), qty: 50, note: 'Rơi vỡ' }, 'line1'); issueRequest(db, { id: r.id, qty: 50 }, 'kho'); });
  safe('YC3', () => createRequest(db, { line: 'Line 2', material: mat('Line 2'), qty: 80, note: 'Bù hao hụt' }, 'line1'));
  safe('YC4', () => createRequest(db, { kind: 'po', line: 'Line 2', kitId: K.d.id, note: 'Xin giao sớm để chuẩn bị ca đêm' }, 'kho'));
  safe('YC5', () => { const r = createRequest(db, { kind: 'po', line: 'Line 3', kitId: K.m.id, note: 'Khách hàng giục đơn' }, 'kho'); decideRequest(db, { id: r.id, approve: true, note: 'Đơn gấp, cho giao' }, 'duyet'); });
  safe('YC6', () => { const r = createRequest(db, { line: 'Line 3', material: mat('Line 3'), qty: 60 }, 'line1'); decideRequest(db, { id: r.id, approve: false, note: 'Line còn đủ vật liệu' }, 'duyet'); });
  safe('YC7', () => createRequest(db, { kind: 'po', line: 'Line 5', note: 'Sắp hết PO' }, 'line1'));
  safe('YC8', () => createRequest(db, { line: 'Line 4', material: mat('Line 4'), qty: 30, note: 'Thiếu do lỗi' }, 'line1'));

  // BOM VLN chỉnh tay một mã (thấy nhãn "Chỉnh tay").
  safe('VLN tay', () => { const v = db.prepare("SELECT * FROM bom_vln WHERE model = 'BSM-X406' ORDER BY material LIMIT 1").get(); if (v) saveVlnPoint(db, { model: v.model, material: v.material, point: v.point + 1 }, 'planner'); });

  // Mốc thời gian hôm nay: lập KH chiều qua, kitting từ sáng, giao ~10h.
  const stamp = (day, h, m = 0) => new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+07:00`).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('UPDATE kit_order SET created_at = ? WHERE plan_day >= ?').run(stamp(addDays(today, -1), 16), today);
  db.prepare('UPDATE kit_order SET delivered_at = ? WHERE plan_day >= ? AND delivered_at IS NOT NULL').run(stamp(today, 10, 5), today);
}

// Lịch sử 2 ngày trước để báo cáo có số liệu: các PO đã sản xuất xong được kitting và giao line.
function seedHistory(db) {
  const today = todayKey(), lineOf = { 'BSM-F731': ['Line 1', 'Line 2'], 'BSM-S947': ['Line 3'], 'BSM-F766 Main': ['Line 4'], 'BSM-X406': ['Line 5'], 'BSM-X946': ['Line 6'], 'BSM-S741': ['Line 6'] };
  const done = db.prepare(`SELECT po_key, po_no, model_code, basic_model FROM po p WHERE remain_qty <= 0 AND production_qty > 0
    AND NOT EXISTS (SELECT 1 FROM kit_order_po k WHERE k.po_key = p.po_key) ORDER BY plan_date, plan_start`).all()
    .filter(p => lineOf[modelOf(db, p.model_code, p.basic_model)]);
  const stamp = (day, h, m = 0) => new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+07:00`).toISOString().replace('T', ' ').slice(0, 19);
  let i = 0;
  for (const [back, n] of [[3, 5], [2, 6], [1, 7]]) {
    const day = addDays(today, -back), batch = done.slice(i, i + n); i += n;
    if (!batch.length) continue;
    batchMove(db, { items: batch.map(p => ({ type: 'po', id: p.po_key })), day }, 'planner');
    const kits = db.prepare('SELECT * FROM kit_order WHERE plan_day = ? ORDER BY seq').all(day);
    kits.forEach((k, j) => {
      try {
        const model = modelOf(db, k.model_code, batch.find(p => p.po_no === k.code)?.basic_model);
        for (const grp of ['VLN', 'HV']) {
          const d = kitDetail(db, k.id, grp);
          saveKitting(db, { kitId: k.id, grp, confirm: true, shortReason: 'URGENT', items: d.items.map((it, x) => ({ code: it.code, material: it.material, kitted: j === 2 && grp === 'HV' && x === 1 ? Math.floor(it.required / 2) : it.required })) }, 'kho');
        }
        const lines = lineOf[model];
        deliver(db, { kitId: k.id, line: lines[j % lines.length] }, 'kho');
        const created = stamp(addDays(day, -1), 15, 10 + j), delivered = stamp(day, 8 + Math.floor(j / 2), 15 + j * 5);
        db.prepare('UPDATE kit_order SET created_at = ?, delivered_at = ? WHERE id = ?').run(created, delivered, k.id);
        db.prepare("UPDATE kit_txn SET created_at = ? WHERE kit_code = ? AND type = 'kit'").run(stamp(day, 7, 20 + j), k.code);
        db.prepare("UPDATE kit_txn SET created_at = ? WHERE kit_code = ? AND type = 'deliver'").run(delivered, k.code);
      } catch (err) { console.warn('demo history:', err.message); }
    });
  }
  // Yêu cầu các ngày trước: đạt (còn < 200) tự duyệt, ngoại lệ duyệt / từ chối.
  const reqs = [[3, 'Line 4', 'material', 90, 1, 'issued'], [2, 'Line 1', 'material', 120, 1, 'issued'], [2, 'Line 3', 'po', 960, 0, 'issued'], [1, 'Line 2', 'material', 80, 0, 'rejected'], [1, 'Line 5', 'po', 480, 1, 'issued'], [1, 'Line 1', 'material', 40, 0, 'issued']];
  for (const [back, line, kind, qty, pass, status] of reqs) {
    const day = addDays(today, -back), model = db.prepare('SELECT model FROM line_assign WHERE line = ? AND model <> \'\' LIMIT 1').get(line)?.model || '';
    const mat = db.prepare("SELECT b.material, b.description FROM bom b JOIN model_map m ON m.model_code = b.model_code WHERE m.model = ? AND b.kit_group = 'VLN' LIMIT 1").get(model);
    if (!mat) continue;
    const kit = kind === 'po' ? db.prepare("SELECT code FROM kit_order WHERE line = ? AND plan_day = ? LIMIT 1").get(line, day)?.code || '' : '';
    db.prepare(`INSERT INTO material_request(kind, kit_code, line, model, material, description, qty, status, remain_sum, spread, pending, available, threshold, pass, requested_by, approved_by, approve_note, approved_at, issued_qty, issued_by, issued_at, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,200,?,?,?,?,?,?,?,?,?)`).run(kind, kit || null, line, model, kind === 'po' ? (kit || 'PO tiếp theo') : mat.material, kind === 'po' ? model : mat.description, qty, status,
      pass ? 520 : 900, 300, pass ? 40 : 120, pass ? 180 : 480, pass, kind === 'po' ? 'kho' : 'line1', pass ? 'Tự động' : 'duyet', pass ? '' : (status === 'rejected' ? 'Line còn đủ việc' : 'Line cần gấp'),
      stamp(day, 10), status === 'issued' ? qty : null, status === 'issued' ? 'kho' : null, status === 'issued' ? stamp(day, 10, 30) : null, stamp(day, 9, 40));
  }
}
