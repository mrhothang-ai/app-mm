import { ensureLotSchema } from './kit-lot.mjs';
// Sổ nợ Kho → Line: mã nợ phát sinh khi giao PO thiếu, giao bù dần tới khi đủ. Mặc định 24 giờ, chọn được từ ngày đến ngày.
const r3 = n => Math.round(Number(n) * 1000) / 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// kit_txn.created_at là giờ UTC ('YYYY-MM-DD HH:MM:SS'); hiển thị theo giờ VN.
const utc = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const vnDayStart = d => Date.parse(`${d}T00:00:00Z`) - 7 * 3600000;
export const toVN = t => t ? new Date(Date.parse(`${t.replace(' ', 'T')}Z`) + 7 * 3600000).toISOString().slice(0, 16) : '';

export function debtLedger(db, { from, to, line } = {}) {
  ensureLotSchema(db);
  let a, b, mode = '24h';
  if (DAY.test(from || '') && DAY.test(to || '')) {
    if (to < from) [from, to] = [to, from];
    a = utc(vnDayStart(from)); b = utc(vnDayStart(to) + 86400000); mode = 'range';
  } else { b = utc(Date.now() + 60000); a = utc(Date.now() - 86400000); from = to = ''; }
  line = String(line || '');
  const lineSql = line ? ' AND t.line = ?' : '', lp = line ? [line] : [];
  const opens = db.prepare(`SELECT t.* FROM kit_txn t WHERE t.type = 'debt_open'${lineSql} ORDER BY t.id`).all(...lp);
  const settles = db.prepare(`SELECT t.* FROM kit_txn t WHERE t.type = 'debt_settle'${lineSql} ORDER BY t.id`).all(...lp);
  const key = t => `${t.kit_code}|${t.grp}|${t.ref_code || ''}|${t.material}`;
  const bySettle = new Map();
  for (const t of settles) { const k = key(t); if (!bySettle.has(k)) bySettle.set(k, []); bySettle.get(k).push(t); }
  const item = db.prepare('SELECT i.*, k.line FROM kit_item i JOIN kit_order k ON k.id = i.kit_id WHERE k.code = ? AND i.grp = ? AND i.model_code = ? AND i.material = ?');
  const inRange = t => t.created_at >= a && t.created_at < b;
  const lotOf = t => { const l = db.prepare('SELECT lot_no, status, signer_name, signer FROM kit_lot WHERE src_txn = ? OR (kit_code = ? AND lot_no = ?) LIMIT 1').get(t.id, t.kit_code, t.note || ''); return l ? { lot: l.lot_no, lotStatus: l.status, signer: l.signer_name || l.signer || '' } : {}; };
  const rows = [], seen = new Set();
  for (const o of opens) {
    const k = key(o); if (seen.has(k)) continue; seen.add(k);
    const it = item.get(o.kit_code, o.grp, o.ref_code || '', o.material);
    const pays = bySettle.get(k) || [];
    const paid = r3(pays.reduce((s, t) => s + t.qty, 0));
    const remain = it ? Math.max(0, r3(it.required - it.delivered)) : Math.max(0, r3(o.qty - paid));
    const status = remain <= 0 ? 'paid' : paid > 0 ? 'partial' : 'open';
    if (status === 'paid' && !inRange(o) && !pays.some(inRange)) continue;   // đã trả đủ ngoài kỳ → bỏ
    const last = pays.at(-1);
    rows.push({ line: o.line || it?.line || '', kit: o.kit_code, code: o.ref_code || '', material: o.material, description: it?.description || '',
      group: o.kit_group || '', grp: o.grp, debt: r3(o.qty), paid, remain, status,
      openedAt: toVN(o.created_at), openedBy: o.username || '', lastPaidAt: last ? toVN(last.created_at) : '', lastPaidBy: last?.username || '',
      hours: Math.round((Date.now() - Date.parse(`${o.created_at.replace(' ', 'T')}Z`)) / 3600000) });
  }
  // Đợt giao bù của từng mã: số đợt, đợt Line chưa ký nhận (chờ nhận / từ chối).
  const lotQ = db.prepare(`SELECT l.lot_no, l.status, l.created_at, l.signer_name, l.signer, l.signed_at, i.qty FROM kit_lot_item i JOIN kit_lot l ON l.id = i.lot_id
    WHERE l.kit_code = ? AND i.grp = ? AND i.model_code = ? AND i.material = ? ORDER BY l.seq`);
  for (const r of rows) {
    const ls = lotQ.all(r.kit, r.grp, r.code, r.material);
    r.lots = ls.map(l => ({ lotNo: l.lot_no, status: l.status, qty: r3(l.qty), at: toVN(l.created_at), signer: l.signer_name || l.signer || '', signedAt: toVN(l.signed_at) }));
    r.unsigned = ls.filter(l => l.status !== 'received').length;
  }
  const ORD = { open: 0, partial: 1, paid: 2 };
  rows.sort((x, y) => ORD[x.status] - ORD[y.status] || (y.group === 'REAR') - (x.group === 'REAR') || x.openedAt.localeCompare(y.openedAt));
  const events = [...opens, ...settles].filter(inRange).sort((x, y) => y.id - x.id).map(t => ({
    at: toVN(t.created_at), type: t.type === 'debt_open' ? 'open' : 'settle', line: t.line || '', kit: t.kit_code, code: t.ref_code || '', material: t.material, group: t.kit_group || '', qty: r3(t.qty), by: t.username || '',
    ...(t.type === 'debt_settle' ? lotOf(t) : {}) }));
  const open = rows.filter(r => r.status !== 'paid');
  return { mode, from, to, line, rows, events,
    kpi: { open: open.length, rear: open.filter(r => r.group === 'REAR').length, remain: r3(open.reduce((s, r) => s + r.remain, 0)),
      opened: events.filter(e => e.type === 'open').length, settled: events.filter(e => e.type === 'settle').length } };
}
