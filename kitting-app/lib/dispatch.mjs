// Màn Điều phối của Kho: việc cần xử lý ngay, bảng theo Model, 15 việc tiếp theo, toàn bộ việc còn lại theo ngày.
import { getSettings } from './db.mjs';
import { modelOf, notCancelledSql } from './po-sync.mjs';
import { todayKey, currentShift, addDays, shifts, nowVN, kitQueueOrder } from './planning.mjs';
import { kitHeader, deliverable, debts as debtList } from './kitting.mjs';
import { lineSummary, readyByModel, addHours } from './prod.mjs';

const pct = (a, b) => b > 0 ? Math.min(100, Math.round(a / b * 100)) : 0;
const SEV = { now: 0, warn: 1, ok: 2, idle: 3 };

export function dispatchView(db, { day, shift } = {}) {
  (() => { const c = currentShift(db); day = day || c.day; shift = shift || (day === c.day ? c.shift : shifts(db)[0]); })();
  const today = todayKey(), tomorrow = addDays(today, 1), now = nowVN(), soon = addHours(now, 48);
  const s = getSettings(db), minPer = Number(s.vln_min_per_line) || 0, maxPer = Number(s.vln_max_per_line) || 0;
  const assign = new Map(db.prepare('SELECT line, model FROM line_assign WHERE work_date = ? AND shift = ?').all(day, shift).map(r => [r.line, r.model]));
  const ready = readyByModel(db);
  const lines = db.prepare('SELECT name FROM lines WHERE active = 1 ORDER BY sort_order, name').all().map(r => r.name)
    .map(l => lineSummary(db, l, assign.get(l) || '', ready, now)).filter(l => l.model);
  const order = kitQueueOrder(db);

  // Mọi kit chưa giao line đã lập KH: tiến độ VLN / Rear+VLĐT.
  const kits = db.prepare("SELECT * FROM kit_order WHERE plan_day IS NOT NULL AND vln_status <> 'delivered'").all().map(k => {
    const h = kitHeader(db, k, order.get(k.id));
    const sum = grp => db.prepare('SELECT COALESCE(SUM(kitted),0) a, COALESCE(SUM(required),0) b, COUNT(*) n FROM kit_item WHERE kit_id = ? AND grp = ?').get(k.id, grp);
    const v = sum('VLN'), r = sum('HV'), chk = deliverable(db, k);
    const done = k.vln_status === 'done' && k.hv_status === 'done';
    const start = db.prepare('SELECT MIN(p.plan_start) s FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = ?').get(k.id).s || '';
    return { id: k.id, code: k.code, kind: k.kind, model: h.model, codes: h.codes, qty: h.qty, planDay: k.plan_day, planStart: start,
      rank: h.rank, mrank: h.mrank, round: h.round, shortModel: h.shortModel, behind: h.behind,
      vln: k.vln_status, hv: k.hv_status, vlnPct: v.n ? pct(v.a, v.b) : 0, hvPct: r.n ? pct(r.a, r.b) : 0,
      stage: done ? (chk.ok ? 'ready' : 'blocked') : (k.vln_status !== 'pending' || k.hv_status !== 'pending') ? 'progress' : 'pending',
      why: done && !chk.ok ? chk.why : '', rearZero: chk.rearZero || [],
      noBom: !v.n && h.codes.some(c => !db.prepare('SELECT 1 FROM bom WHERE model_code = ? LIMIT 1').get(c)) };
  }).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const work = kits.filter(k => k.stage !== 'ready');

  // PO chưa lập KH, Plan Start trong 48 giờ, theo Model.
  const unplanned = new Map();
  for (const p of db.prepare(`SELECT model_code, basic_model FROM po p WHERE in_source = 1 AND remain_qty > 0 AND ${notCancelledSql('p.')} AND plan_start <> '' AND plan_start < ?
      AND NOT EXISTS (SELECT 1 FROM kit_order_po x WHERE x.po_key = p.po_key)`).all(soon)) {
    const m = modelOf(db, p.model_code, p.basic_model); unplanned.set(m, (unplanned.get(m) || 0) + 1);
  }

  // Bảng theo Model.
  const modelNames = [...new Set([...lines.map(l => l.model), ...kits.map(k => k.model)])];
  const models = modelNames.map(model => {
    const ls = lines.filter(l => l.model === model), mk = kits.filter(k => k.model === model);
    const readyN = mk.filter(k => k.stage === 'ready').length, min = ls.length * minPer, max = ls.length * maxPer;
    const hoursMin = ls.map(l => l.hoursLeft).filter(h => h !== null).sort((a, b) => a - b)[0] ?? null;
    const needPo = ls.some(l => l.supply.pass);
    const status = !ls.length ? 'idle' : readyN < min && (needPo || (hoursMin !== null && hoursMin < 2)) ? 'now' : readyN < min ? 'warn' : 'ok';
    return { model, lines: ls.map(l => ({ line: l.line, hoursLeft: l.hoursLeft, pass: l.supply.pass })), ready: readyN, min, max,
      vlnProg: mk.filter(k => k.vln === 'progress').length, hvProg: mk.filter(k => k.vln !== 'pending' && k.hv === 'progress').length,
      blocked: mk.filter(k => k.stage === 'blocked').length,
      todo: mk.filter(k => k.stage === 'pending' && k.planDay <= today).length, todoTomorrow: mk.filter(k => k.stage === 'pending' && k.planDay === tomorrow).length,
      unplanned: unplanned.get(model) || 0, hoursMin, status };
  }).sort((a, b) => SEV[a.status] - SEV[b.status] || (a.hoursMin ?? 1e9) - (b.hoursMin ?? 1e9) || a.model.localeCompare(b.model));

  // Việc cần xử lý ngay.
  const risk = lines.filter(l => !l.readyCount && (l.supply.pass || (l.hoursLeft !== null && l.hoursLeft < 2)))
    .map(l => ({ line: l.line, model: l.model, hoursLeft: l.hoursLeft }));
  const round1 = work.filter(k => k.planDay <= today && k.round === 1);
  const d = debtList(db);
  const days = [...new Set(work.map(k => k.planDay))].sort().map(dd => {
    const list = work.filter(k => k.planDay === dd);
    return { day: dd, count: list.length, qty: list.reduce((a, k) => a + k.qty, 0), late: dd < today };
  });
  return {
    day, shift, shifts: shifts(db), now, today,
    kpi: { risk, round1: { count: round1.length, qty: round1.reduce((a, k) => a + k.qty, 0) },
      ready: kits.filter(k => k.stage === 'ready').length, debt: { kits: d.kpi.kits, items: d.kpi.items, rear: d.kpi.rear } },
    models, next: work.slice(0, 15), work, days
  };
}
