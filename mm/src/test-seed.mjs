// CHỈ DÙNG KIỂM THỬ: chạy kịch bản demo + in tóm tắt ngay trong PocketBase (goja) để so với bản Node.
import { makeDb } from './pb-db.mjs';
import { seedAfterImport } from '../../kitting-app/lib/demo.mjs';
import * as k from '../../kitting-app/lib/kitting.mjs';
import * as rp from '../../kitting-app/lib/report.mjs';
import * as b from '../../kitting-app/lib/bom.mjs';
export function seed(app) { const db = makeDb(app); seedAfterImport(db); return { ok: true }; }
export function summary(app) {
  const db = makeDb(app), out = [];
  const lb = k.lineBoard(db);
  for (const l of lb.lines) out.push(`${l.line} ${l.model} ${Math.round(l.supply.available)} ${l.supply.pass} ready ${l.readyCount} req ${JSON.stringify(l.poReq)} run ${l.running.map(x => x.code + ':' + x.remain).join(',')}`);
  out.push(`kpi ${JSON.stringify(lb.kpi)} ready ${lb.ready.map(r => r.code + (r.check.ok ? '' : '(' + r.check.why + ')') + ':' + r.model).join(' | ')}`);
  for (const g of ['VLN', 'HV']) { const q = k.kitQueue(db, g); out.push(`${g} ${JSON.stringify(q.kpi)} ${q.rows.map(r => r.code + ':' + r.status).join(' ')}`); }
  out.push(k.requests(db).rows.map(r => `#${r.id} ${r.kind} ${r.line} ${r.status} pass${r.pass} ${r.material}`).join('\n'));
  out.push('debts ' + JSON.stringify(k.debts(db).kpi));
  const sf = rp.safetyReport(db, {}); out.push('safety ' + JSON.stringify(sf.kpi) + ' ' + sf.lines.map(l => l.line + ':' + l.level).join(' '));
  const cat = b.bomCatalog(db); out.push('models ' + cat.length + ' ' + cat.filter(m => m.warnings).map(m => m.model + ':' + m.warnings).join(', '));
  out.push('kitrep ' + JSON.stringify(rp.kittingReport(db, {}).kpi));
  out.push('exc ' + JSON.stringify(rp.exceptionReport(db, {}).kpi));
  out.push('badges ' + JSON.stringify(rp.badges(db)));
  return { text: out.join('\n') };
}
