// Giai đoạn 4: báo cáo tình hình kitting, an toàn vật liệu theo line, ngoại lệ; số đếm việc cần làm cho các tab.
import { getSettings } from './db.mjs';
import { modelOf, productionState } from './po-sync.mjs';
import { todayKey, currentShift, addDays, shifts, vlnOverview } from './planning.mjs';
import { lineSupply, lineBoard, REASONS } from './kitting.mjs';
import { receiptBadges } from './receipt.mjs';

const r1 = n => Math.round(n * 10) / 10;
const utcStart = day => new Date(`${day}T00:00:00+07:00`).toISOString().replace('T', ' ').slice(0, 19);
const hoursBetween = (a, b) => (new Date(b.replace(' ', 'T') + 'Z') - new Date(a.replace(' ', 'T') + 'Z')) / 3600000;
function stage(k) {
  if (k.vln_status === 'delivered') return 'delivered';
  if (k.vln_status === 'done' && k.hv_status === 'done') return 'ready';
  if (k.vln_status !== 'pending' || k.hv_status !== 'pending') return 'progress';
  return 'pending';
}
function kitInfo(db, k) {
  const pos = db.prepare('SELECT p.* FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = ?').all(k.id);
  return { pos, model: modelOf(db, k.model_code, pos[0]?.basic_model), qty: pos.reduce((s, p) => s + p.plan_qty, 0), remain: pos.reduce((s, p) => s + p.remain_qty, 0) };
}
function debtOf(db, kitId) {
  const r = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(required - delivered), 0) ea FROM kit_item WHERE kit_id = ? AND delivered < required').get(kitId);
  return { items: r.n, ea: r.ea };
}

export function kittingReport(db, { from, to }) {
  to = to || todayKey(); from = from || addDays(to, -6);
  const today = todayKey();
  const kits = db.prepare('SELECT * FROM kit_order WHERE plan_day BETWEEN ? AND ? ORDER BY plan_day, seq').all(from, to).map(k => ({ ...k, ...kitInfo(db, k), stage: stage(k) }));
  const days = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const byDay = days.map(day => {
    const list = kits.filter(k => k.plan_day === day), c = s => list.filter(k => k.stage === s).length;
    return { day, total: list.length, qty: list.reduce((s, k) => s + k.qty, 0), pending: c('pending'), progress: c('progress'), ready: c('ready'), delivered: c('delivered') };
  });
  const models = new Map();
  for (const k of kits) {
    const m = models.get(k.model) || { model: k.model, planned: 0, qty: 0, vlnDone: 0, hvDone: 0, ready: 0, delivered: 0, debtItems: 0 };
    m.planned++; m.qty += k.qty;
    if (['done', 'delivered'].includes(k.vln_status)) m.vlnDone++;
    if (['done', 'delivered'].includes(k.hv_status)) m.hvDone++;
    if (k.stage === 'ready') m.ready++;
    if (k.stage === 'delivered') { m.delivered++; m.debtItems += debtOf(db, k.id).items; }
    models.set(k.model, m);
  }
  const due = kits.filter(k => k.plan_day <= today), dueDone = due.filter(k => ['ready', 'delivered'].includes(k.stage));
  const delivered = kits.filter(k => k.delivered_at);
  const lead = delivered.map(k => hoursBetween(k.created_at, k.delivered_at)).filter(h => h >= 0);
  const merged = kits.filter(k => k.kind === 'merged');
  const debtKits = delivered.map(k => ({ k, d: debtOf(db, k.id) })).filter(x => x.d.items);
  return {
    from, to, byDay, byModel: [...models.values()].sort((a, b) => b.planned - a.planned),
    kpi: {
      planned: kits.length, plannedQty: kits.reduce((s, k) => s + k.qty, 0),
      kitted: kits.filter(k => ['ready', 'delivered'].includes(k.stage)).length,
      delivered: delivered.length, due: due.length, onPlan: due.length ? Math.round(dueDone.length / due.length * 100) : null,
      leadHours: lead.length ? r1(lead.reduce((a, b) => a + b, 0) / lead.length) : null,
      merged: merged.length, bomSaved: merged.reduce((s, k) => s + k.pos.length - 1, 0),
      debtKits: debtKits.length, debtEa: debtKits.reduce((s, x) => s + x.d.ea, 0)
    },
    rows: kits.map(k => ({ day: k.plan_day, code: k.code, kind: k.kind, pos: k.pos.length, model: k.model, modelCode: k.model_code, qty: k.qty, remain: k.remain,
      vln: k.vln_status, hv: k.hv_status, stage: k.stage, line: k.line || '', deliveredAt: k.delivered_at || '', debt: k.stage === 'delivered' ? debtOf(db, k.id).items : 0,
      state: k.pos.length ? (k.pos.every(p => productionState(p) === 'done') ? 'done' : k.pos.some(p => productionState(p) !== 'waiting') ? 'running' : 'waiting') : 'waiting' }))
  };
}

export function safetyReport(db, { day, shift }) {
  (() => { const c = currentShift(db); day = day || c.day; shift = shift || (day === c.day ? c.shift : shifts(db)[0]); })();
  const assign = new Map(db.prepare('SELECT line, model FROM line_assign WHERE work_date = ? AND shift = ?').all(day, shift).map(r => [r.line, r.model]));
  const vln = vlnOverview(db, day, shift);
  const vByModel = new Map(vln.rows.map(r => [r.model, r]));
  const board = new Map(lineBoard(db, day, shift).lines.map(l => [l.line, l]));
  const lines = db.prepare('SELECT name FROM lines WHERE active = 1 ORDER BY sort_order, name').all().map(r => r.name).map(line => {
    const model = assign.get(line) || '', s = lineSupply(db, line, model), v = vByModel.get(model);
    const kits = db.prepare("SELECT id FROM kit_order WHERE line = ? AND vln_status = 'delivered'").all(line);
    const debt = kits.reduce((a, k) => a + debtOf(db, k.id).items, 0);
    // Đủ việc: còn ≥ ngưỡng. Cần cấp: < ngưỡng và có PO sẵn sàng. Nguy cơ hết việc: < ngưỡng mà chưa có PO sẵn sàng.
    const ready = board.get(line)?.readyCount || 0;
    const level = !model ? 'idle' : !s.pass ? 'ok' : ready ? 'warn' : 'bad';
    return { line, model, ...s, level, readyPo: ready, waitingPo: v ? v.waiting : 0, minPo: v ? Math.round(v.min / Math.max(v.lines.length, 1)) : 0, maxPo: v ? Math.round(v.max / Math.max(v.lines.length, 1)) : 0, debt, runningPo: kits.length };
  });
  const run = lines.filter(l => l.model);
  return { day, shift, shifts: shifts(db), threshold: Number(getSettings(db).supply_threshold), lines, models: vln.rows,
    kpi: { safe: run.filter(l => l.level === 'ok').length, warn: run.filter(l => l.level === 'warn').length, bad: run.filter(l => l.level === 'bad').length,
      shortModels: vln.rows.filter(r => r.waiting < r.min).length, debtLines: run.filter(l => l.debt).length, running: run.length } };
}

export function exceptionReport(db, { from, to }) {
  to = to || todayKey(); from = from || addDays(to, -6);
  const a = utcStart(from), b = utcStart(addDays(to, 1));
  const reqs = db.prepare('SELECT * FROM material_request WHERE created_at >= ? AND created_at < ? ORDER BY id DESC').all(a, b);
  const txn = db.prepare("SELECT * FROM kit_txn WHERE created_at >= ? AND created_at < ? AND type IN ('transfer_out','return','recall')").all(a, b);
  const byReason = Object.entries(REASONS).map(([code, label]) => { const l = txn.filter(t => t.reason_code === code); return { label, lines: l.length, ea: l.reduce((s, t) => s + t.qty, 0) }; }).filter(r => r.lines);
  const c = s => reqs.filter(r => r.status === s).length;
  return { from, to, kpi: { requests: reqs.length, auto: reqs.filter(r => r.pass).length, exceptions: reqs.filter(r => !r.pass).length, approved: reqs.filter(r => !r.pass && ['approved', 'issued'].includes(r.status)).length,
      rejected: c('rejected'), pending: c('pending_approval'), issuedEa: reqs.filter(r => r.status === 'issued').reduce((s, r) => s + (r.issued_qty || 0), 0), adjustments: txn.length },
    exceptions: reqs.filter(r => !r.pass), byReason,
    byLine: [...new Set(reqs.map(r => r.line))].map(line => { const l = reqs.filter(r => r.line === line); return { line, total: l.length, exceptions: l.filter(r => !r.pass).length, issuedEa: l.filter(r => r.status === 'issued').reduce((s, r) => s + (r.issued_qty || 0), 0) }; }) };
}

export function badges(db) {
  const n = sql => db.prepare(sql).get().n;
  return {
    pendingApproval: n("SELECT COUNT(*) n FROM material_request WHERE status = 'pending_approval'"),
    toIssue: n("SELECT COUNT(*) n FROM material_request WHERE status = 'approved'"),
    ready: n("SELECT COUNT(*) n FROM kit_order WHERE vln_status = 'done' AND hv_status = 'done'"),
    toKit: n("SELECT COUNT(*) n FROM kit_order WHERE plan_day IS NOT NULL AND plan_day <= date('now', '+7 hours') AND vln_status IN ('pending','progress')"),
    debts: n("SELECT COUNT(DISTINCT kit_id) n FROM kit_item i JOIN kit_order k ON k.id = i.kit_id WHERE k.vln_status = 'delivered' AND i.delivered < i.required"),
    receiptRejected: receiptBadges(db).rejected   // Line từ chối nhận PO, chờ Kho xử lý
  };
}
