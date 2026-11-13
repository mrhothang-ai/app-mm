// Tự động xếp PO (Planner): xem trước → bỏ chọn dòng không muốn → áp dụng (1 transaction, hoàn tác được).
// Chỉ đụng tới PO / Kit ở cột "Chưa lập KH"; Kit đã xếp ngày chỉ được dùng làm Kit nhận ghép PO Unplan / RMA (khi Kho chưa kitting).
//  - PO thường SL ≥ minQty, Plan Start đến hết ngày `to` → 1 Kit riêng, ngày kitting = ngày Plan Start − lead (quá hạn → hôm nay).
//  - PO nhỏ (< minQty) để lại cho Planner cân nhắc.
//  - Ghép Unplan / RMA vào Kit cùng Model gần Plan Start nhất, tổng SL ≤ giới hạn gộp, không lệch Line ấn định.
//  - Tối đa maxPerDay Kit / ngày (tính cả Kit đã có), đầy thì dồn sang ngày sau.
import { fail, audit, getSettings, normalizePo } from './db.mjs';
import { todayKey, addDays, merge, printedCodes } from './planning.mjs';
import { modelOf, isCancelled, notCancelledSql } from './po-sync.mjs';

const pending = k => k.vln_status === 'pending' && k.hv_status === 'pending';
const dayOf = s => String(s || '').slice(0, 10);
const intIn = (v, def, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : def; };

export function autoOptions(db, o = {}) {
  const today = todayKey(), s = getSettings(db);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(o.to)) ? o.to : addDays(today, 2);
  return { to, today, models: Array.isArray(o.models) ? o.models.map(String).filter(Boolean) : [],
    minQty: intIn(o.minQty, 1000, 0, 1e6), lead: intIn(o.lead, 0, 0, 14),
    maxPerDay: intIn(o.maxPerDay ?? s.auto_max_kits_day, 0, 0, 999), attach: o.attach !== false,
    order: o.order === 'append' ? 'append' : 'start', exclude: new Set(Array.isArray(o.exclude) ? o.exclude.map(String) : []),
    mergeMax: Number(s.merge_max_qty) || 2500 };
}

// Tính kế hoạch (không ghi). Trả về rows (dòng xếp/ghép) + danh sách để lại.
export function autoPlan(db, input) {
  const o = autoOptions(db, input);
  const okModel = m => !o.models.length || o.models.includes(m);
  const hasBom = code => !!db.prepare('SELECT 1 FROM bom WHERE model_code = ? LIMIT 1').get(code);
  const poRow = p => ({ key: p.po_key, po: p.po_no, code: p.model_code, model: modelOf(db, p.model_code, p.basic_model), qty: p.plan_qty,
    start: p.plan_start || '', type: p.po_type || 'SAP', line: p.fixed_line || '' });
  const pool = db.prepare(`SELECT p.* FROM po p WHERE p.in_source = 1 AND p.remain_qty > 0 AND ${notCancelledSql('p.')}
    AND NOT EXISTS (SELECT 1 FROM kit_order_po k WHERE k.po_key = p.po_key)`).all().map(poRow);
  const kitPos = id => db.prepare('SELECT p.* FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = ?').all(id);
  const kitInfo = k => { const ps = kitPos(k.id), r = ps.map(poRow);
    return { id: k.id, code: k.code, day: k.plan_day, seq: k.seq, model: r[0]?.model || k.model_code, codes: [...new Set(r.map(x => x.code))],
      qty: r.reduce((a, x) => a + x.qty, 0), start: r.map(x => x.start).filter(Boolean).sort()[0] || '', lines: [...new Set(r.map(x => x.line).filter(Boolean))],
      pos: r, cancelled: ps.some(isCancelled) }; };
  const poolKits = db.prepare('SELECT * FROM kit_order WHERE plan_day IS NULL ORDER BY id').all().filter(pending).map(kitInfo);

  // 1) Ứng viên xếp ngày: PO thường đủ lớn + Kit gộp sẵn ở cột chưa lập
  const left = { small: [], later: [], noStart: [], excluded: [], noHost: [] };
  const cand = [];
  for (const p of pool.filter(p => p.type === 'SAP' && okModel(p.model))) {
    const key = `po:${p.key}`;
    if (!p.start) left.noStart.push(p.po);
    else if (dayOf(p.start) > o.to) left.later.push(p.po);
    else if (p.qty < o.minQty) left.small.push({ po: p.po, model: p.model, qty: p.qty });
    else if (o.exclude.has(key)) left.excluded.push(p.po);
    else cand.push({ key, kind: 'po', ref: p.key, codeLabel: p.po, model: p.model, codes: [p.code], qty: p.qty, start: p.start, lines: [], pos: [p] });
  }
  for (const k of poolKits.filter(k => okModel(k.model) && !k.cancelled)) {
    const key = `kit:${k.id}`;
    if (!k.start) left.noStart.push(k.code);
    else if (dayOf(k.start) > o.to) left.later.push(k.code);
    else if (k.qty < o.minQty) left.small.push({ po: k.code, model: k.model, qty: k.qty });
    else if (o.exclude.has(key)) left.excluded.push(k.code);
    else cand.push({ key, kind: 'kit', ref: k.id, codeLabel: k.code, model: k.model, codes: k.codes, qty: k.qty, start: k.start, lines: k.lines, pos: k.pos });
  }
  cand.sort((a, b) => a.start.localeCompare(b.start) || a.codeLabel.localeCompare(b.codeLabel));

  // 2) Ngày kitting + năng lực Kho
  const used = new Map(), countDay = d => { if (!used.has(d)) used.set(d, db.prepare('SELECT COUNT(*) n FROM kit_order WHERE plan_day = ?').get(d).n); return used.get(d); };
  const rows = [];
  for (const c of cand) {
    let want = addDays(dayOf(c.start), -o.lead), late = false;
    if (want < o.today) { want = o.today; late = true; }
    let day = want;
    if (o.maxPerDay) for (let i = 0; countDay(day) >= o.maxPerDay && i < 366; i++) day = addDays(day, 1);
    used.set(day, countDay(day) + 1);
    const noBom = c.codes.filter(x => !hasBom(x));
    rows.push({ key: c.key, action: 'place', kind: c.kind, ref: c.ref, code: c.codeLabel, model: c.model, codes: c.codes, qty: c.qty, start: c.start,
      day, want, late, shifted: day !== want, noBom, attached: [], lines: c.lines, pos: c.pos.map(p => p.po) });
  }

  // 3) Ghép Unplan / RMA vào Kit cùng Model (Kit vừa xếp ở bước 2 hoặc Kit đã có mà Kho chưa kitting)
  if (o.attach) {
    const printed = printedCodes(db);   // Kit Kho đã in phiếu: không ghép thêm
    const hosts = [...rows.map(r => ({ row: r, model: r.model, qty: r.qty, start: r.start, lines: [...r.lines], code: r.code, day: r.day })),
      ...db.prepare('SELECT * FROM kit_order WHERE plan_day IS NOT NULL').all().filter(k => pending(k) && !printed.has(k.code)).map(kitInfo).filter(k => !k.cancelled)
        .map(k => ({ kit: k, model: k.model, qty: k.qty, start: k.start, lines: [...k.lines], code: k.code, day: k.plan_day }))];
    const internals = pool.filter(p => p.type !== 'SAP' && okModel(p.model)).sort((a, b) => a.start.localeCompare(b.start) || a.po.localeCompare(b.po));
    const ts = s => s ? Date.parse(`${s.slice(0, 10)}T${s.slice(11, 16) || '00:00'}:00Z`) : 0;
    for (const p of internals) {
      const key = `po:${p.key}`;
      if (o.exclude.has(key)) { left.excluded.push(p.po); continue; }
      const fit = hosts.filter(h => h.model === p.model && h.qty + p.qty <= o.mergeMax && (!p.line || h.lines.every(l => l === p.line)));
      if (!fit.length) { left.noHost.push({ po: p.po, model: p.model, qty: p.qty, type: p.type }); continue; }
      const t = ts(p.start) || Date.now();
      const h = fit.sort((a, b) => Math.abs(ts(a.start) - t) - Math.abs(ts(b.start) - t) || a.code.localeCompare(b.code))[0];
      h.qty += p.qty; if (p.line && !h.lines.includes(p.line)) h.lines.push(p.line);
      const att = { po: p.po, key: p.key, type: p.type, qty: p.qty, code: p.code, line: p.line };
      if (h.row) { h.row.attached.push(att); if (!h.row.codes.includes(p.code)) h.row.codes.push(p.code); if (!hasBom(p.code)) h.row.noBom.push(p.code); continue; }
      let r = rows.find(x => x.action === 'attach' && x.ref === h.kit.id);
      if (!r) rows.push(r = { key: `host:${h.kit.id}`, action: 'attach', kind: 'kit', ref: h.kit.id, code: h.kit.code, model: h.model, codes: [...h.kit.codes], qty: h.kit.qty,
        start: h.kit.start, day: h.kit.day, noBom: [], attached: [], pos: h.kit.pos.map(x => x.po) });
      r.attached.push(att); if (!r.codes.includes(p.code)) r.codes.push(p.code); if (!hasBom(p.code)) r.noBom.push(p.code);
    }
  }
  rows.forEach(r => { r.total = r.qty + r.attached.reduce((a, x) => a + x.qty, 0); });
  rows.sort((a, b) => a.day.localeCompare(b.day) || (a.action === 'attach') - (b.action === 'attach') || a.start.localeCompare(b.start));
  const opts = { ...o, exclude: [...o.exclude] };
  return { opts, rows, left, summary: { place: rows.filter(r => r.action === 'place').length, attach: rows.reduce((a, r) => a + r.attached.length, 0), days: [...new Set(rows.map(r => r.day))].sort() } };
}

// Phạm vi hoàn tác (đưa vào scopeOf): mọi PO / Kit bị đụng + các ngày bị đụng.
export function autoScopeItems(plan) {
  return { items: [...plan.rows.map(r => ({ type: r.kind, id: r.ref })), ...plan.rows.flatMap(r => r.attached.map(a => ({ type: 'po', id: a.key })))],
    days: [...new Set(plan.rows.map(r => r.day))] };
}

export function autoApply(db, input, username) {
  const plan = autoPlan(db, input);
  if (!plan.rows.length) throw fail('Không có PO nào để xếp theo các tích chọn hiện tại.');
  const newKit = new Map();   // row.key → kit id
  for (const r of plan.rows.filter(x => x.action === 'place')) {
    if (r.kind === 'po') {
      const p = db.prepare('SELECT * FROM po WHERE po_key = ?').get(r.ref);
      if (!p || db.prepare('SELECT 1 FROM kit_order_po WHERE po_key = ?').get(r.ref)) throw fail(`PO ${r.code} vừa thay đổi. Hãy tải lại.`, 409);
      const res = db.prepare("INSERT INTO kit_order(code, kind, model_code, plan_day, seq, created_by) VALUES (?, 'single', ?, ?, 0, ?)").run(p.po_no, p.model_code, r.day, username);
      db.prepare('INSERT INTO kit_order_po(kit_id, po_key) VALUES (?, ?)').run(res.lastInsertRowid, r.ref);
      newKit.set(r.key, Number(res.lastInsertRowid));
    } else {
      const k = db.prepare('SELECT * FROM kit_order WHERE id = ?').get(r.ref);
      if (!k || k.plan_day || !pending(k)) throw fail(`${r.code} vừa thay đổi. Hãy tải lại.`, 409);
      db.prepare("UPDATE kit_order SET plan_day = ?, seq = 0, updated_at = datetime('now') WHERE id = ?").run(r.day, r.ref);
      newKit.set(r.key, r.ref);
    }
  }
  // Thứ tự trong ngày: chèn Kit mới theo Plan Start giữa các Kit đã có, hoặc thêm vào cuối ngày.
  const startOf = id => db.prepare('SELECT MIN(p.plan_start) s FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = ? AND p.plan_start <> \'\'').get(id)?.s || '9999';
  const added = new Set(newKit.values());
  for (const day of plan.summary.days) {
    const all = db.prepare('SELECT id FROM kit_order WHERE plan_day = ? ORDER BY seq, id').all(day).map(x => x.id);
    const order = all.filter(id => !added.has(id));
    const mine = all.filter(id => added.has(id)).sort((a, b) => startOf(a).localeCompare(startOf(b)));
    for (const id of mine) {
      if (plan.opts.order === 'append') { order.push(id); continue; }
      const s = startOf(id), at = order.findIndex(x => startOf(x) > s);
      order.splice(at < 0 ? order.length : at, 0, id);
    }
    order.forEach((id, i) => db.prepare('UPDATE kit_order SET seq = ? WHERE id = ?').run(i, id));
  }
  // Ghép Unplan / RMA: dùng merge() để giữ đúng các ràng buộc gộp và vị trí trong ngày.
  let attached = 0;
  for (const r of plan.rows.filter(x => x.attached.length)) {
    const kitId = r.action === 'place' ? newKit.get(r.key) : r.ref;
    if (r.action === 'attach') { const k = db.prepare('SELECT * FROM kit_order WHERE id = ?').get(kitId); if (!k || !pending(k)) throw fail(`${r.code} Kho vừa bắt đầu kitting. Hãy tải lại.`, 409); }
    merge(db, [{ type: 'kit', id: kitId }, ...r.attached.map(a => ({ type: 'po', id: a.key }))], username);
    attached += r.attached.length;
  }
  const placed = plan.summary.place;
  audit(db, username, 'plan.auto', { opts: { ...plan.opts, exclude: plan.opts.exclude.length }, placed, attached });
  return { ok: true, placed, attached, days: plan.summary.days,
    message: `Tự động xếp: ${placed} Kit vào ${plan.summary.days.length} ngày${attached ? `, ghép ${attached} PO Unplan / RMA` : ''}.` };
}
