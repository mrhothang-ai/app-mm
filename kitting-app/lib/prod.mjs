// Tab Sản xuất: Line đang nhận PO & sản xuất thế nào, còn bao nhiêu giờ việc, Kho chuẩn bị PO tiếp theo tới đâu.
import { getSettings, fail } from './db.mjs';
import { productionState, modelOf, notCancelledSql } from './po-sync.mjs';
import { todayKey, currentShift, shifts, nowVN, vlnOverview } from './planning.mjs';
import { lineSupply, kitHeader, ranks, deliverable, kitTarget } from './kitting.mjs';
import { receiptOf, ensureReceiptSchema, INT_STATES, RECEIPT_STATUS } from './receipt.mjs';
import { lotCount } from './kit-lot.mjs';

const r1 = n => Math.round(n * 10) / 10;
export const addHours = (vnTime, h) => new Date(Date.parse(`${vnTime}:00Z`) + h * 3600000).toISOString().slice(0, 16);
const pct = (a, b) => b > 0 ? Math.min(100, Math.round(a / b * 100)) : 0;

function assignMap(db, day, shift) {
  return new Map(db.prepare('SELECT line, model FROM line_assign WHERE work_date = ? AND shift = ?').all(day, shift).map(r => [r.line, r.model]));
}
function uphOf(db, line, model) {
  return model ? Number(db.prepare('SELECT uph FROM line_params WHERE line = ? AND model = ?').get(line, model)?.uph) || 0 : 0;
}
// PO sẵn sàng giao (xong cả 2 nhóm, giao được) theo Model.
export function readyByModel(db) {
  const m = new Map(), rk = ranks(db);
  for (const k of db.prepare("SELECT * FROM kit_order WHERE vln_status = 'done' AND hv_status = 'done'").all()) {
    if (!deliverable(db, k).ok) continue;
    const h = kitHeader(db, k, rk.get(k.id)), key = h.fixedLine ? `${h.model}\u001f${h.fixedLine}` : h.model;   // kit có PO nội bộ chỉ tính cho Line ấn định
    m.set(key, (m.get(key) || 0) + 1);
  }
  return m;
}
export function lineSummary(db, line, model, ready, now) {
  const s = lineSupply(db, line, model), uph = uphOf(db, line, model), readyCount = model ? (ready.get(model) || 0) + (ready.get(`${model}\u001f${line}`) || 0) : 0;
  const hoursLeft = uph ? r1(s.remainSum / uph) : null;
  const needPoIn = uph ? (s.pass ? 0 : r1((s.available - s.threshold) / uph)) : null;
  const level = !model ? 'idle' : !s.pass ? (needPoIn !== null && needPoIn < 1 && !readyCount ? 'warn' : 'ok') : readyCount ? 'warn' : 'bad';
  return { line, model, supply: s, uph, hoursLeft, endAt: hoursLeft !== null ? addHours(now, hoursLeft) : '', needPoIn, needPoAt: needPoIn !== null ? addHours(now, needPoIn) : '', readyCount, level };
}

// PO cùng Model đã lập KH chưa giao Line: Sẵn sàng giao → Chưa giao được → Đang kitting → Chưa kitting (12 PO đầu + PO xếp muộn).
export function upcomingKits(db, model, rk = ranks(db), now = nowVN()) {
  if (!model) return [];
  return db.prepare("SELECT * FROM kit_order WHERE plan_day IS NOT NULL AND vln_status <> 'delivered' ORDER BY plan_day, seq, id").all()
    .map(k => ({ k, h: kitHeader(db, k, rk.get(k.id)) })).filter(x => x.h.model === model).map(({ k, h }) => {
      const sum = grp => db.prepare('SELECT COALESCE(SUM(kitted),0) a, COALESCE(SUM(required),0) b, COUNT(*) n FROM kit_item WHERE kit_id = ? AND grp = ?').get(k.id, grp);
      const v = sum('VLN'), r = sum('HV');
      const start = db.prepare('SELECT MIN(p.plan_start) s FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = ?').get(k.id).s || '';
      const chk = deliverable(db, k);
      const stage = k.vln_status === 'done' && k.hv_status === 'done' ? (chk.ok ? 'ready' : 'blocked') : (k.vln_status !== 'pending' || k.hv_status !== 'pending') ? 'progress' : 'pending';
      return { id: k.id, code: k.code, kind: k.kind, codes: h.codes, pos: h.pos.map(p => p.po), notes: h.notes, qty: h.qty, rank: h.rank, mrank: h.mrank, behind: h.behind, late: !!start && start < now, planDay: k.plan_day, planStart: start, stage, why: stage === 'blocked' ? chk.why : '',
        vln: v.n ? pct(v.a, v.b) : 0, hv: r.n ? pct(r.a, r.b) : 0, vlnStatus: k.vln_status, hvStatus: k.hv_status, rearZero: chk.rearZero || [], planLine: k.plan_line || '',
        short: db.prepare('SELECT required, kitted FROM kit_item WHERE kit_id = ?').all(k.id).filter(i => i.kitted < kitTarget(i.required) - 1e-9).length };
    }).sort((a, b) => ({ ready: 0, blocked: 1, progress: 2, pending: 3 }[a.stage] - { ready: 0, blocked: 1, progress: 2, pending: 3 }[b.stage]) || (a.rank || 1e9) - (b.rank || 1e9)).filter((u, i) => i < 12 || u.behind);
}
// Bấm "PO sẵn giao" ở Tổng quan Line: Kit cùng Model của Line (ca hiện tại) Kho đã / đang chuẩn bị; Kit ấn định Line khác bỏ ra.
export function readyForLine(db, line) {
  if (!line) throw fail('Chọn Line.');
  const c = currentShift(db), model = assignMap(db, c.day, c.shift).get(line) || '';
  const rk = ranks(db), rows = upcomingKits(db, model, rk).filter(u => { const k = db.prepare('SELECT * FROM kit_order WHERE id = ?').get(u.id), h = kitHeader(db, k, rk.get(k.id)); u.fixedLine = h.fixedLine || ''; return !h.fixedLine || h.fixedLine === line; }).sort((a, b) => ({ ready: 0, blocked: 1, progress: 2, pending: 3 }[a.stage] - { ready: 0, blocked: 1, progress: 2, pending: 3 }[b.stage]) || (b.planLine === line) - (a.planLine === line));
  return { line, model, rows, count: { ready: rows.filter(r => r.stage === 'ready').length, blocked: rows.filter(r => r.stage === 'blocked').length, progress: rows.filter(r => r.stage === 'progress').length, pending: rows.filter(r => r.stage === 'pending').length } };
}

export function productionView(db, { line, day, shift } = {}) {
  (() => { const c = currentShift(db); day = day || c.day; shift = shift || (day === c.day ? c.shift : shifts(db)[0]); })();
  const now = nowVN(), assign = assignMap(db, day, shift), ready = readyByModel(db), rk = ranks(db);
  const lines = db.prepare('SELECT name FROM lines WHERE active = 1 ORDER BY sort_order, name').all().map(r => r.name);
  const overview = lines.map(l => lineSummary(db, l, assign.get(l) || '', ready, now));
  // Bảng tổng quan: thêm PO đang chạy, tiến độ, nợ, yêu cầu chờ, Kho chuẩn bị theo Model.
  const kitStage = new Map();
  for (const k of db.prepare("SELECT * FROM kit_order WHERE plan_day IS NOT NULL AND vln_status <> 'delivered'").all()) {
    const h = kitHeader(db, k, null), st = k.vln_status === 'done' && k.hv_status === 'done' ? 'done' : (k.vln_status !== 'pending' || k.hv_status !== 'pending') ? 'progress' : 'pending';
    const m = kitStage.get(h.model) || { done: 0, progress: 0, pending: 0 }; m[st]++; kitStage.set(h.model, m);
  }
  for (const o of overview) {
    const run = db.prepare(`SELECT COALESCE(SUM(p.plan_qty),0) q, COALESCE(SUM(p.production_qty),0) d, COALESCE(SUM(CASE WHEN p.remain_qty > 0 THEN p.remain_qty ELSE 0 END),0) r, COUNT(DISTINCT k.id) n
      FROM kit_order k JOIN kit_order_po x ON x.kit_id = k.id JOIN po p ON p.po_key = x.po_key WHERE k.line = ? AND k.vln_status = 'delivered' AND p.remain_qty > 0 AND ${notCancelledSql('p.')}`).get(o.line);
    const debt = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(i.kit_group = 'REAR'),0) rear FROM kit_item i JOIN kit_order k ON k.id = i.kit_id WHERE k.line = ? AND k.vln_status = 'delivered' AND i.delivered < i.required").get(o.line);
    o.running = { count: run.n, qty: run.q, produced: run.d, progress: run.q ? Math.round(run.d / run.q * 100) : 0 };
    o.debt = { items: debt.n, rear: debt.rear };
    o.lotPending = db.prepare("SELECT COUNT(*) n FROM kit_lot l JOIN kit_order k ON k.id = l.kit_id WHERE l.line = ? AND l.status = 'pending' AND k.vln_status = 'delivered'").get(o.line).n;
    o.openReq = db.prepare("SELECT COUNT(*) n FROM material_request WHERE line = ? AND status IN ('pending_approval','approved')").get(o.line).n;
    o.kho = o.model ? (kitStage.get(o.model) || { done: 0, progress: 0, pending: 0 }) : null;
  }
  const cs = currentShift(db), nx = cs.next, nextAssign = nx ? assignMap(db, nx.day, nx.shift) : new Map();
  for (const o of overview) o.nextModel = nextAssign.get(o.line) || '';
  if (!line || !lines.includes(line)) line = overview.find(o => o.model)?.line || lines[0] || '';
  const me = overview.find(o => o.line === line) || null;
  const model = me?.model || '';
  const threshold = Number(getSettings(db).supply_threshold);

  // PO đang chạy trên Line (đã giao, còn remain) + mã Kho còn nợ.
  const running = db.prepare("SELECT * FROM kit_order WHERE line = ? AND vln_status = 'delivered' ORDER BY delivered_at").all(line).map(k => {
    const h = kitHeader(db, k, rk.get(k.id));
    const pos = db.prepare('SELECT p.* FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = ?').all(k.id);
    const produced = pos.reduce((s, p) => s + (p.production_qty || 0), 0);
    const debts = db.prepare('SELECT kit_group, model_code, material, required - delivered AS debt FROM kit_item WHERE kit_id = ? AND delivered < required ORDER BY kit_group DESC, material').all(k.id);
    return { id: k.id, code: k.code, kind: k.kind, codes: h.codes, pos: h.pos.map(p => p.po), notes: h.notes, qty: h.qty, produced, remain: h.remain, progress: pct(produced, h.qty), state: h.state,
      planEnd: pos.map(p => p.plan_end).filter(Boolean).sort().at(-1) || '', deliveredAt: k.delivered_at || '', debts };
  });
  const SORD = { running: 0, waiting: 1 };
  const finished = running.filter(k => k.remain <= 0).sort((a, b) => String(b.deliveredAt).localeCompare(String(a.deliveredAt))).slice(0, 2).reverse().map(k => ({ ...k, state: 'done' }));
  const active = running.filter(k => k.remain > 0).sort((a, b) => (SORD[a.state] ?? 1) - (SORD[b.state] ?? 1) || String(a.deliveredAt).localeCompare(String(b.deliveredAt)));
  running.length = 0; running.push(...finished, ...active);

  // PO tiếp theo cùng Model: Kho chuẩn bị tới đâu.
  const upcoming = upcomingKits(db, model, rk, now);

  // PO cùng Model chưa lập kế hoạch kitting mà Plan Start đã gần (48 giờ).
  const soon = addHours(now, 48);
  const unplanned = !model ? [] : db.prepare(`SELECT p.* FROM po p WHERE p.in_source = 1 AND p.remain_qty > 0 AND ${notCancelledSql('p.')} AND p.plan_start <> '' AND p.plan_start < ?
      AND NOT EXISTS (SELECT 1 FROM kit_order_po x WHERE x.po_key = p.po_key) ORDER BY p.plan_start`).all(soon)
    .filter(p => modelOf(db, p.model_code, p.basic_model) === model).slice(0, 10)
    .map(p => ({ po: p.po_no, modelCode: p.model_code, qty: p.plan_qty, planStart: p.plan_start, late: p.plan_start < now, state: productionState(p) }));

  const reqs = db.prepare(`SELECT * FROM material_request WHERE line = ? AND (status IN ('pending_approval','approved') OR created_at >= datetime('now', '-1 day')) ORDER BY id DESC LIMIT 10`).all(line);
  const vln = model ? vlnOverview(db, day, shift).rows.find(r => r.model === model) || null : null;
  const lastImport = db.prepare("SELECT created_at, source FROM import_log WHERE kind = 'PO' ORDER BY id DESC LIMIT 1").get() || null;

  const alerts = [];
  if (me && model) {
    const s = me.supply;
    if (s.pass && !me.readyCount) alerts.push({ level: 'bad', text: 'Line cần PO tiếp nhưng Kho chưa có PO sẵn sàng' });
    if (me.hoursLeft !== null && me.hoursLeft < 2 && !me.readyCount) alerts.push({ level: 'bad', text: `Chỉ còn ≈ ${me.hoursLeft} giờ việc` });
    for (const k of running) { const rear = k.debts.filter(d => d.kit_group === 'REAR'); if (rear.length) alerts.push({ level: 'bad', text: `${k.code}: Kho còn nợ Rear ${rear.map(d => d.model_code.replace(/^GH\d\d-/, '')).join(', ')}` }); }
    const due = upcoming.filter(u => u.stage !== 'ready' && u.planStart && u.planStart < addHours(now, 2));
    if (nx && me.nextModel !== model) alerts.push({ level: 'warn', text: me.nextModel ? `Ca ${nx.shift} (${nx.start}) đổi sang ${me.nextModel.replace(/^BSM-/, '')}` : `Ca ${nx.shift} (${nx.start}) Line không chạy` });
    const behind = upcoming.filter(u => u.behind);
    if (behind.length) alerts.push({ level: 'bad', text: `${behind.length} PO xếp muộn so với Plan Start (${behind.slice(0, 3).map(u => `${u.code} Kho #${u.mrank}`).join(', ')}) — Planner cần đưa lên trước` });
    for (const u of due.slice(0, 3)) alerts.push({ level: 'warn', text: u.stage === 'blocked' ? `${u.code}: ${u.why} — chưa giao được` : `${u.code} ${u.planStart < now ? 'đã quá giờ chạy' : 'bắt đầu'} ${u.planStart.slice(11, 16)} ${u.planStart.slice(8, 10)}/${u.planStart.slice(5, 7)}, Kho chưa kitting xong` });
    if (due.length > 3) alerts.push({ level: 'warn', text: `+${due.length - 3} PO đến giờ chạy chưa sẵn sàng` });
    const late = unplanned.filter(u => u.planStart < addHours(now, 24)).length;
    if (late) alerts.push({ level: 'warn', text: `${late} PO ${model.replace(/^BSM-/, '')} sắp chạy trong 24 giờ — Planner chưa lập KH kitting` });
    if (!s.hasParams) alerts.push({ level: 'warn', text: 'Chưa khai rải chuyền / pending cho Line + Model này' });
    if (!me.uph) alerts.push({ level: 'info', text: 'Chưa khai UPH — chưa tính được số giờ còn việc' });
  }
  return { day, shift, shiftStart: cs.shift === shift ? cs.start : '', next: nx, shifts: shifts(db), now, threshold, line, lines: overview, me, running, upcoming, unplanned, vln,
    requests: reqs.map(r => ({ id: r.id, kind: r.kind, material: r.material, kitCode: r.kit_code, qty: r.issued_qty ?? r.qty, status: r.status, pass: !!r.pass, createdAt: r.created_at })),
    lastImport, alerts };
}

// PO đã giao cho Line (theo Kit giao Line) và tình trạng sản xuất từng PO. PO đã xong chỉ trả khi chọn khoảng ngày (tối đa 7 ngày),
// ngày xong = lần cập nhật sản xuất đưa Remain về 0 (po_history), không có thì lấy Plan End / lúc giao Line.
export function linePos(db, { line, from, to }) {
  if (!line) throw fail('Chọn Line.');
  ensureReceiptSchema(db);
  if ((from && !to) || (!from && to)) throw fail('Chọn đủ Từ ngày và Đến ngày.');
  if (from) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw fail('Khoảng ngày không hợp lệ.');
    if ((Date.parse(to) - Date.parse(from)) / 864e5 > 6) throw fail('Chọn tối đa 7 ngày.');
  }
  const vnDay = s => s ? new Date(Date.parse(`${String(s).replace(' ', 'T').slice(0, 19)}Z`) + 7 * 3600000).toISOString().slice(0, 10) : '';
  const doneAt = p => {
    const h = db.prepare("SELECT created_at FROM po_history WHERE po_key = ? AND json_extract(changes, '$.remain_qty[1]') = 0 ORDER BY id DESC LIMIT 1").get(p.po_key);
    return h ? { at: h.created_at, day: vnDay(h.created_at), src: 'prod' } : p.plan_end ? { at: '', day: p.plan_end.slice(0, 10), src: 'plan' } : null;
  };
  const rows = db.prepare(`SELECT p.*, k.id AS kit_id, k.code AS kit_code, k.kind, k.delivered_at FROM kit_order k JOIN kit_order_po x ON x.kit_id = k.id JOIN po p ON p.po_key = x.po_key
    WHERE k.line = ? AND k.vln_status = 'delivered' ORDER BY k.delivered_at, p.plan_start, p.po_no`).all(line);
  const view = p => ({ po: p.po_no, kit: p.kit_code, merged: p.kind === 'merged', modelCode: p.model_code, model: modelOf(db, p.model_code, p.basic_model), poType: p.po_type || 'SAP',
    planQty: p.plan_qty, produced: p.production_qty || 0, remain: p.remain_qty, progress: pct(p.production_qty || 0, p.plan_qty), state: productionState(p), planStatus: p.plan_status || '',
    planStart: p.plan_start || '', planEnd: p.plan_end || '', deliveredAt: p.delivered_at || '',
    // lần cập nhật gần nhất (UTC): mới hơn giữa nhập file / cổng SX (synced_at) và MES (mes_synced_at)
    updatedAt: [p.synced_at || '', p.mes_synced_at ? p.mes_synced_at.slice(0, 19).replace('T', ' ') : ''].sort().at(-1),
    debts: db.prepare('SELECT COUNT(*) n, SUM(kit_group = \'REAR\') rear FROM kit_item WHERE kit_id = ? AND delivered < required').get(p.kit_id),
    kitId: p.kit_id, receipt: rcpt(p.kit_id), intStatus: p.po_type && p.po_type !== 'SAP' && p.po_type !== 'LOAD' ? (p.int_status || productionState(p)) : '', loadTp: p.po_type === 'LOAD' ? -p.plan_qty : 0 });
  // Trạng thái Line nhận PO (theo Kit): Chờ nhận / Đã nhận / Từ chối (chờ Kho xử lý).
  const rcMemo = new Map();
  function rcpt(kitId) {
    if (!rcMemo.has(kitId)) { const r = receiptOf(db, kitId), lc = lotCount(db, kitId); rcMemo.set(kitId, { status: r.status, by: r.signerName || r.signer, at: r.at, reason: r.reasonText, note: r.note, khoNote: r.khoNote, khoAt: r.khoAt, lotsPending: lc.pending, lotsRejected: lc.rejected, lots: lc.total }); }
    return rcMemo.get(kitId);
  }
  const active = rows.filter(p => productionState(p) !== 'done' && productionState(p) !== 'cancel').map(view)
    .sort((a, b) => ({ running: 0, waiting: 1 }[a.state] ?? 2) - ({ running: 0, waiting: 1 }[b.state] ?? 2) || String(a.planStart).localeCompare(String(b.planStart)));
  let done = null;
  if (from) done = rows.filter(p => productionState(p) === 'done').map(p => ({ ...view(p), done: doneAt(p) || { at: p.delivered_at, day: vnDay(p.delivered_at), src: 'deliver' } }))
    .filter(p => p.done.day >= from && p.done.day <= to).sort((a, b) => String(b.done.at || b.done.day).localeCompare(String(a.done.at || a.done.day)));
  const doneCount = rows.filter(p => productionState(p) === 'done').length;
  const rc = { pending: 0, rejected: 0 };
  for (const id of new Set(active.map(p => p.kitId))) { const s = active.find(p => p.kitId === id).receipt.status; if (rc[s] !== undefined) rc[s]++; }
  // Đợt giao bù chưa ký của mọi Kit đã giao Line này (kể cả PO đã sản xuất xong).
  const lc = db.prepare("SELECT SUM(l.status = 'pending') p, SUM(l.status = 'rejected') x FROM kit_lot l JOIN kit_order k ON k.id = l.kit_id WHERE l.line = ? AND k.vln_status = 'delivered'").get(line);
  const lots = { pending: lc.p || 0, rejected: lc.x || 0 };
  return { line, active, done, doneCount, from: from || '', to: to || '', receiptCount: rc, lotCount: lots, intStates: INT_STATES, receiptStates: RECEIPT_STATUS };
}
