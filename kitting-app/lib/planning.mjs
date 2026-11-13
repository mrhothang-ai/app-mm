// Kế hoạch kitting: bảng kéo thả, thứ tự ưu tiên, gộp/tách PO, Line ↔ Model, rải chuyền/pending, tồn chờ cấp VLN.
import { tx, fail, audit, getSettings, normalizePo } from './db.mjs';
import { modelOf, productionState, isCancelled, notCancelledSql } from './po-sync.mjs';

// Giờ Việt Nam = UTC+7, không có giờ mùa hè → tính trực tiếp (chạy được cả nơi không có Intl như PocketBase).
export const vnDay = ms => new Date(ms + 7 * 3600000).toISOString().slice(0, 10);
export function todayKey() { return vnDay(Date.now()); }
export const nowVN = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 16);   // 'YYYY-MM-DDTHH:MM' giờ VN
const fmtN = n => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
// PO Load thành phẩm (số âm) chỉ nằm trong Kit có PO thật cùng Model Code, và thành phẩm < tổng PO thật của code đó.
export function assertLoads(pos) {
  const live = pos.filter(p => !isCancelled(p)), loads = live.filter(p => p.po_type === 'LOAD');
  for (const code of new Set(loads.map(p => p.model_code))) {
    const same = live.filter(p => p.model_code === code), real = same.filter(p => p.po_type !== 'LOAD').reduce((a, p) => a + p.plan_qty, 0);
    const tp = -same.filter(p => p.po_type === 'LOAD').reduce((a, p) => a + p.plan_qty, 0);
    if (real <= 0) throw fail(`PO Load thành phẩm ${code} phải gộp với PO thật cùng Model Code ${code}.`);
    if (tp >= real) throw fail(`Thành phẩm ${code} (${fmtN(tp)} ea) phải nhỏ hơn tổng PO thật cùng code (${fmtN(real)} ea).`);
  }
}
// Kit mất PO thật cùng code (gỡ / hủy / tách / nhập KH) → PO Load của code đó trả về cột Chưa lập KH. Gọi khi Kit chưa kitting.
export function dropOrphanLoads(db, kitId) {
  const pos = db.prepare('SELECT p.* FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = ?').all(kitId), out = [];
  for (const code of new Set(pos.filter(p => p.po_type === 'LOAD').map(p => p.model_code))) {
    try { assertLoads(pos.filter(p => p.model_code === code)); }
    catch { for (const l of pos.filter(p => p.po_type === 'LOAD' && p.model_code === code)) { db.prepare('DELETE FROM kit_order_po WHERE kit_id = ? AND po_key = ?').run(kitId, l.po_key); out.push(l.po_no); } }
  }
  if (out.length) {
    db.prepare('DELETE FROM kit_item WHERE kit_id = ?').run(kitId);
    if (!db.prepare('SELECT 1 FROM kit_order_po WHERE kit_id = ?').get(kitId)) db.prepare('DELETE FROM kit_order WHERE id = ?').run(kitId);
  }
  return out;
}
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
const validDay = day => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw fail('Ngày không hợp lệ.'); return day; };

function poView(db, p) {
  return { poKey: p.po_key, po: p.po_no, planDate: p.plan_date, masterLine: p.master_line, basicModel: p.basic_model,
    modelCode: p.model_code, model: modelOf(db, p.model_code, p.basic_model), planQty: p.plan_qty, productionQty: p.production_qty,
    remainQty: p.remain_qty, planStatus: p.plan_status, planStart: p.plan_start || '', planEnd: p.plan_end || '', span: p.span_time || '', state: productionState(p), inSource: !!p.in_source,
    poType: p.po_type || 'SAP', fixedLine: p.fixed_line || '', note: p.note || '' };
}
function aggregateState(pos) {
  const live = pos.filter(p => p.state !== 'cancel'), states = new Set((live.length ? live : pos).map(p => p.state));
  if (states.size === 1) return [...states][0];
  return states.has('running') || states.has('done') ? 'running' : 'waiting';
}

// Kit Kho đã in phiếu kitting (kit_txn type print theo mã Kit): Planner không gộp / tách nữa.
export const printedCodes = db => new Set(db.prepare("SELECT DISTINCT kit_code FROM kit_txn WHERE type = 'print'").all().map(r => r.kit_code));
function kitView(db, kit, ro, printed) {
  const rank = ro?.rank ?? null;
  const pos = db.prepare('SELECT p.* FROM kit_order_po k JOIN po p ON p.po_key = k.po_key WHERE k.kit_id = ? ORDER BY p.plan_date, p.plan_start, p.po_no').all(kit.id).map(p => poView(db, p));
  const first = pos[0] || {};
  return { type: 'kit', id: kit.id, code: kit.code, kind: kit.kind, modelCode: kit.model_code, model: first.model || kit.model_code,
    basicModel: first.basicModel || '', planDay: kit.plan_day, seq: kit.seq, rank, mrank: ro?.mrank ?? null, round: ro?.round ?? null, behind: !!ro?.behind, line: kit.line || '', vlnStatus: kit.vln_status, hvStatus: kit.hv_status,
    planQty: pos.reduce((s, p) => s + p.planQty, 0), remainQty: pos.reduce((s, p) => s + p.remainQty, 0),
    productionQty: pos.reduce((s, p) => s + p.productionQty, 0), planDate: pos.map(p => p.planDate).filter(Boolean).sort()[0] || '',
    planStart: pos.map(p => p.planStart).filter(Boolean).sort()[0] || '', codes: [...new Set(pos.map(p => p.modelCode))].sort(),
    masterLine: [...new Set(pos.map(p => p.masterLine).filter(Boolean))].join(', '), state: aggregateState(pos), pos,
    cancelled: pos.filter(p => p.state === 'cancel').map(p => p.po),
    fixedLine: pos.map(p => p.fixedLine).find(Boolean) || '', planLine: kit.plan_line || '', internal: pos.filter(p => p.poType !== 'SAP').map(p => ({ po: p.po, type: p.poType })),
    notes: pos.filter(p => p.note).map(p => ({ po: p.po, note: p.note })),
    loadTp: pos.filter(p => p.poType === 'LOAD').map(p => ({ po: p.po, modelCode: p.modelCode, qty: -p.planQty })),
    locked: kit.vln_status !== 'pending' || kit.hv_status !== 'pending', printed: !!printed?.has(kit.code) };
}

// Thứ tự ưu tiên kitting (PO chưa giao line):
//  - mrank: số ưu tiên RIÊNG trong từng Model (theo ngày kitting rồi thứ tự Planner xếp trong ngày).
//  - rank: thứ tự Kho làm = xen kẽ các Model theo từng lượt. Ngày cũ còn sót làm trước ngày sau;
//    mỗi lượt lấy PO kế tiếp của mỗi Model, Model chạy N line lấy N PO; Model đang thiếu tồn VLN (dưới min) lên trước;
//    Model không chạy line nào hôm nay xếp sau cùng trong ngày.
export function kitQueueOrder(db) {
  const kits = db.prepare(`SELECT k.id, k.plan_day, k.seq, k.vln_status, k.hv_status, k.model_code,
      (SELECT p.basic_model FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = k.id LIMIT 1) AS basic,
      (SELECT MIN(p.plan_start) FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = k.id AND p.plan_start <> '') AS start
    FROM kit_order k WHERE k.plan_day IS NOT NULL AND k.vln_status <> 'delivered' ORDER BY k.plan_day, k.seq, k.id`).all();
  const s = getSettings(db), minPer = Number(s.vln_min_per_line) || 0;
  const linesOf = new Map();
  // Số Line chạy mỗi Model: tính ca đang chạy + ca kế tiếp (Line chạy cả 2 ca chỉ đếm 1).
  const cs = currentShift(db), lm = new Map();
  for (const c of [cs, cs.next].filter(Boolean)) for (const a of db.prepare("SELECT line, model FROM line_assign WHERE work_date = ? AND shift = ? AND model <> ''").all(c.day, c.shift)) {
    if (!lm.has(a.model)) lm.set(a.model, new Set()); lm.get(a.model).add(a.line); }
  for (const [m, set] of lm) linesOf.set(m, set.size);
  const waiting = new Map(), mcount = new Map(), out = new Map();
  for (const k of kits) { k.model = modelOf(db, k.model_code, k.basic); if (k.vln_status === 'done') waiting.set(k.model, (waiting.get(k.model) || 0) + 1); }
  for (const k of kits) { const n = (mcount.get(k.model) || 0) + 1; mcount.set(k.model, n); k.mrank = n; }
  const need = m => (linesOf.get(m) || 0) * minPer - (waiting.get(m) || 0);
  const models = [...new Set(kits.map(k => k.model))].sort((a, b) =>
    ((linesOf.get(b) ? 1 : 0) - (linesOf.get(a) ? 1 : 0)) || ((need(b) > 0) - (need(a) > 0)) || (need(b) - need(a)) || a.localeCompare(b));
  let rank = 0;
  for (const day of [...new Set(kits.map(k => k.plan_day))]) {
    // Model đang chạy line xen kẽ theo lượt trước; Model không chạy line nào hôm nay xếp sau cùng.
    let round = 0;
    for (const group of [models.filter(m => linesOf.get(m)), models.filter(m => !linesOf.get(m))]) {
      const queues = new Map(group.map(m => [m, kits.filter(k => k.plan_day === day && k.model === m)]));
      while ([...queues.values()].some(q => q.length)) {
        round++;
        for (const m of group) {
          const q = queues.get(m), take = Math.max(1, linesOf.get(m) || 0);
          for (const k of q.splice(0, take)) out.set(k.id, { rank: ++rank, mrank: k.mrank, round, day, model: m, short: need(m) > 0, idle: !linesOf.get(m) });
        }
      }
    }
  }
  // Xếp muộn: Plan Start sớm hơn PO đứng trước cùng Model trong hàng chờ Kho, và đã quá giờ / trong 24 giờ tới.
  const soon = new Date(Date.parse(`${nowVN()}:00Z`) + 24 * 3600000).toISOString().slice(0, 16), maxStart = new Map();
  for (const k of [...kits].sort((a, b) => out.get(a.id).rank - out.get(b.id).rank)) {
    const o = out.get(k.id), mx = maxStart.get(k.model) || '';
    o.start = k.start || '';
    o.behind = !!(!(k.vln_status === 'done' && k.hv_status === 'done') && k.start && mx && k.start < mx && k.start < soon);
    if (k.start && k.start > mx) maxStart.set(k.model, k.start);
  }
  return out;
}

export function board(db, { from, days = 4 }) {
  from = validDay(from || todayKey());
  days = Math.min(Math.max(Number(days) || 4, 1), 10);
  const ranks = kitQueueOrder(db);
  const dayList = Array.from({ length: days }, (_, i) => addDays(from, i));
  const printed = printedCodes(db);
  const columns = dayList.map(day => ({ day, items: db.prepare('SELECT * FROM kit_order WHERE plan_day = ? ORDER BY seq, id').all(day).map(k => kitView(db, k, ranks.get(k.id), printed)) }));
  const poolPos = db.prepare(`SELECT p.* FROM po p WHERE p.in_source = 1 AND (p.remain_qty > 0 OR (p.po_type = 'LOAD' AND COALESCE(p.int_status, '') <> 'done')) AND ${notCancelledSql('p.')}
    AND NOT EXISTS (SELECT 1 FROM kit_order_po k WHERE k.po_key = p.po_key)
    ORDER BY CASE WHEN p.plan_start IS NULL OR p.plan_start = '' THEN 1 ELSE 0 END, p.plan_start, p.plan_date, p.po_no`).all()
    .map(p => ({ type: 'po', id: p.po_key, code: p.po_no, ...poView(db, p) }));
  const poolKits = db.prepare('SELECT * FROM kit_order WHERE plan_day IS NULL ORDER BY id').all().map(k => kitView(db, k, null, printed));
  const byStart = (a, b) => (a.planStart ? 0 : 1) - (b.planStart ? 0 : 1) || String(a.planStart).localeCompare(String(b.planStart)) || String(a.code).localeCompare(String(b.code));
  const pool = [...poolKits, ...poolPos].sort(byStart);
  const last = dayList.at(-1);
  const outside = {
    before: db.prepare('SELECT COUNT(*) n FROM kit_order WHERE plan_day < ?').get(from).n,
    after: db.prepare('SELECT COUNT(*) n FROM kit_order WHERE plan_day > ?').get(last).n,
    firstBefore: db.prepare('SELECT MIN(plan_day) d FROM kit_order WHERE plan_day < ?').get(from).d
  };
  const models = [...new Set(pool.map(i => i.model))].sort();
  return { from, days, today: todayKey(), now: nowVN(), columns, pool, models, outside, mergeMax: Number(getSettings(db).merge_max_qty) || 2500, autoMaxDay: Number(getSettings(db).auto_max_kits_day) || 0 };
}

function loadKit(db, id) {
  const kit = db.prepare('SELECT * FROM kit_order WHERE id = ?').get(Number(id));
  if (!kit) throw fail('Kit PO không còn tồn tại. Hãy tải lại bảng.', 409);
  return kit;
}
const kitLocked = kit => kit.vln_status !== 'pending' || kit.hv_status !== 'pending';
const kitPrinted = (db, kit) => !!db.prepare("SELECT 1 FROM kit_txn WHERE type = 'print' AND kit_code = ? LIMIT 1").get(kit.code);
// Planner chỉ gộp / tách Kit khi Kho chưa bắt đầu kitting và chưa in phiếu.
function assertKitFree(db, kit, act) {
  if (kitLocked(kit)) throw fail(`${kit.code} Kho đã bắt đầu kitting, không ${act} được.`);
  if (kitPrinted(db, kit)) throw fail(`${kit.code} Kho đã in phiếu kitting, không ${act} được.`);
}

function createSingleKit(db, poKey, day, seq, username) {
  const p = db.prepare('SELECT * FROM po WHERE po_key = ?').get(poKey);
  if (!p) throw fail('PO không còn trong dữ liệu. Hãy tải lại bảng.', 409);
  if (isCancelled(p)) throw fail(`PO ${p.po_no} đã hủy (Cancel), không lập kế hoạch được.`);
  if (p.po_type === 'LOAD') throw fail(`${p.po_no} là PO Load thành phẩm: không kitting riêng, chọn cùng PO / Kit thật cùng Model Code rồi bấm Gộp.`);
  if (db.prepare('SELECT 1 FROM kit_order_po WHERE po_key = ?').get(poKey)) throw fail(`PO ${p.po_no} đã được lập kế hoạch ở nơi khác. Hãy tải lại bảng.`, 409);
  const res = db.prepare("INSERT INTO kit_order(code, kind, model_code, plan_day, seq, created_by) VALUES (?, 'single', ?, ?, ?, ?)").run(p.po_no, p.model_code, day, seq, username);
  db.prepare('INSERT INTO kit_order_po(kit_id, po_key) VALUES (?, ?)').run(res.lastInsertRowid, poKey);
  return Number(res.lastInsertRowid);
}

// columns: [{ day: 'YYYY-MM-DD' | null (cột PO chưa lập), items: [{type:'po'|'kit', id}] }]
export function applyColumns(db, columns, username) {
  if (!Array.isArray(columns) || !columns.length) throw fail('Không có thay đổi.');
  return tx(db, () => {
    let moved = 0;
    for (const col of columns) {
      const day = col.day === null ? null : validDay(col.day);
      const items = Array.isArray(col.items) ? col.items : [];
      items.forEach((item, index) => {
        if (item.type === 'po') {
          if (day) { createSingleKit(db, String(item.id), day, index, username); moved++; }
          return;
        }
        const kit = loadKit(db, item.id);
        if (day === null) {
          if (kitLocked(kit)) throw fail(`${kit.code} đã bắt đầu kitting, không đưa về PO chưa lập được.`);
          if (kit.kind === 'single') { db.prepare('DELETE FROM kit_order WHERE id = ?').run(kit.id); moved++; return; }
          db.prepare("UPDATE kit_order SET plan_day = NULL, seq = ?, updated_at = datetime('now') WHERE id = ?").run(index, kit.id);
          return;
        }
        if (kit.plan_day !== day) moved++;
        db.prepare("UPDATE kit_order SET plan_day = ?, seq = ?, updated_at = datetime('now') WHERE id = ?").run(day, index, kit.id);
      });
    }
    audit(db, username, 'plan.move', { columns: columns.map(c => ({ day: c.day, n: (c.items || []).length })) });
    return { ok: true, moved };
  });
}

export function nextMergedCode(db) {
  const d = todayKey().replace(/-/g, '').slice(2);
  const prefix = `K-${d}-`;
  const last = db.prepare("SELECT code FROM kit_order WHERE code LIKE ? ORDER BY code DESC LIMIT 1").get(`${prefix}%`);
  const n = last ? Number(last.code.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(2, '0')}`;
}

export function merge(db, items, username) {
  if (!Array.isArray(items) || items.length < 2) throw fail('Chọn ít nhất 2 PO để gộp.');
  return tx(db, () => {
    const poKeys = [], oldKits = [];
    let place = { day: null, seq: 0 };
    items.forEach(item => {
      if (item.type === 'po') {
        const key = normalizePo(item.id);
        if (db.prepare('SELECT 1 FROM kit_order_po WHERE po_key = ?').get(key)) throw fail('Có PO đã được lập kế hoạch ở nơi khác. Hãy tải lại bảng.', 409);
        poKeys.push(key);
      } else {
        const kit = loadKit(db, item.id);
        assertKitFree(db, kit, 'gộp');
        oldKits.push(kit);
        if (!place.day && kit.plan_day) place = { day: kit.plan_day, seq: kit.seq };  // đặt vào vị trí Kit PO đã xếp ngày đầu tiên
        db.prepare('SELECT po_key FROM kit_order_po WHERE kit_id = ?').all(kit.id).forEach(r => poKeys.push(r.po_key));
      }
    });
    if (new Set(poKeys).size !== poKeys.length) throw fail('Danh sách gộp có PO bị lặp.');
    if (poKeys.length < 2) throw fail('Cần ít nhất 2 PO gốc để gộp.');
    const pos = poKeys.map(k => db.prepare('SELECT * FROM po WHERE po_key = ?').get(k));
    if (pos.some(p => !p)) throw fail('Có PO không còn trong dữ liệu. Hãy tải lại bảng.', 409);
    // PO nội bộ gộp được với PO thường (cả kit theo Line ấn định), nhưng không gộp 2 PO nội bộ khác Line.
    const fixed = [...new Set(pos.map(p => p.fixed_line).filter(Boolean))];
    if (fixed.length > 1) throw fail(`Không gộp PO nội bộ ấn định khác Line: ${fixed.join(', ')}.`);
    const cx = pos.filter(isCancelled).map(p => p.po_no);
    if (cx.length) throw fail(`PO đã hủy (Cancel), không gộp được: ${cx.join(', ')}.`);
    // Gộp được các PO cùng Model (khác Model Code vẫn được: Rear + VLĐT sẽ chia khối theo từng code), tổng SL ≤ giới hạn.
    const models = new Set(pos.map(p => modelOf(db, p.model_code, p.basic_model)));
    if (models.size > 1) throw fail(`Chỉ gộp được các PO cùng Model. Đang chọn: ${[...models].join(', ')}.`);
    assertLoads(pos);
    // Giới hạn gộp chỉ cảnh báo: Planner chịu trách nhiệm (giống nhập kế hoạch từ Excel).
    const maxQty = Number(getSettings(db).merge_max_qty) || 2500, total = pos.reduce((s, p) => s + p.plan_qty, 0);
    pos.sort((a, b) => String(a.plan_start || '').localeCompare(String(b.plan_start || '')) || String(a.po_no).localeCompare(String(b.po_no)));
    // Gộp thêm vào Kit gộp có sẵn (Kit gộp đầu tiên được chọn): giữ mã Kit, ngày và vị trí; Kit / PO khác nhập vào.
    const host = oldKits.find(k => k.kind === 'merged');
    for (const kit of oldKits) if (kit !== host) db.prepare('DELETE FROM kit_order WHERE id = ?').run(kit.id);
    let id, code;
    if (host) {
      id = host.id; code = host.code;
      const have = new Set(db.prepare('SELECT po_key FROM kit_order_po WHERE kit_id = ?').all(id).map(r => r.po_key));
      for (const k of poKeys) if (!have.has(k)) db.prepare('INSERT INTO kit_order_po(kit_id, po_key) VALUES (?, ?)').run(id, k);
      db.prepare('DELETE FROM kit_item WHERE kit_id = ?').run(id);   // chưa kitting: dựng lại danh sách mã theo PO mới
      if (!host.plan_day && place.day) { db.prepare("UPDATE kit_order SET plan_day = ?, seq = ?, updated_at = datetime('now') WHERE id = ?").run(place.day, place.seq, id); renumberDay(db, place.day, id, place.seq); }
      else db.prepare("UPDATE kit_order SET updated_at = datetime('now') WHERE id = ?").run(id);
    } else {
      code = nextMergedCode(db);
      const res = db.prepare("INSERT INTO kit_order(code, kind, model_code, plan_day, seq, created_by) VALUES (?, 'merged', ?, ?, ?, ?)")
        .run(code, pos[0].model_code, place.day, place.seq, username);
      id = Number(res.lastInsertRowid);
      for (const k of poKeys) db.prepare('INSERT INTO kit_order_po(kit_id, po_key) VALUES (?, ?)').run(id, k);
      if (place.day) renumberDay(db, place.day, id, place.seq);
    }
    audit(db, username, 'plan.merge', { code, into: host ? host.code : null, pos: pos.map(p => p.po_no), total });
    const nCodes = new Set(pos.map(p => p.model_code)).size, over = total > maxQty;
    return { ok: true, code, count: pos.length, qty: total, over,
      message: `${host ? `Đã gộp thêm vào ${code}` : `Đã gộp thành ${code}`}: ${pos.length} PO (${nCodes > 1 ? `${nCodes} Model Code` : pos[0].model_code}, ${fmtN(total)} ea)${over ? ` · vượt giới hạn gộp ${fmtN(maxQty)} ea` : ''}.` };
  });
}

function renumberDay(db, day, pinnedId, pinnedSeq) {
  const rows = db.prepare('SELECT id FROM kit_order WHERE plan_day = ? AND id <> ? ORDER BY seq, id').all(day, pinnedId).map(r => r.id);
  rows.splice(Math.min(pinnedSeq, rows.length), 0, pinnedId);
  const upd = db.prepare('UPDATE kit_order SET seq = ? WHERE id = ?');
  rows.forEach((id, i) => upd.run(i, id));
}

export function split(db, kitId, username) {
  return tx(db, () => {
    const kit = loadKit(db, kitId);
    if (kit.kind !== 'merged') throw fail('Chỉ tách được Kit PO gộp.');
    assertKitFree(db, kit, 'tách');
    const keys = db.prepare('SELECT po_key FROM kit_order_po WHERE kit_id = ? ORDER BY po_key').all(kit.id).map(r => r.po_key);
    db.prepare('DELETE FROM kit_order WHERE id = ?').run(kit.id);
    if (kit.plan_day) {
      // Giữ nguyên vị trí trong ngày: các PO gốc trở thành từng dòng kế hoạch riêng.
      const others = db.prepare('SELECT id FROM kit_order WHERE plan_day = ? ORDER BY seq, id').all(kit.plan_day).map(r => r.id);
      // PO Load thành phẩm không đứng riêng: về cột Chưa lập KH
      const created = keys.filter(k => db.prepare('SELECT po_type FROM po WHERE po_key = ?').get(k)?.po_type !== 'LOAD').map(k => createSingleKit(db, k, kit.plan_day, 0, username));
      others.splice(Math.min(kit.seq, others.length), 0, ...created);
      others.forEach((id, i) => db.prepare('UPDATE kit_order SET seq = ? WHERE id = ?').run(i, id));
    }
    audit(db, username, 'plan.split', { code: kit.code, pos: keys });
    return { ok: true, message: `Đã tách ${kit.code} thành ${keys.length} PO${kit.plan_day ? ' (giữ nguyên ngày kitting)' : ' về danh sách PO chưa lập'}.` };
  });
}

/* ---------- Line ↔ Model, rải chuyền/pending, tồn chờ cấp VLN ---------- */
export function shifts(db) { return getSettings(db).shifts.split(',').map(s => s.trim()).filter(Boolean); }
// Ca đang chạy theo giờ VN (ca Đêm sau 0h vẫn thuộc ngày làm việc hôm trước) + ca kế tiếp.
export function currentShift(db, at = nowVN()) {
  const names = shifts(db), starts = String(getSettings(db).shift_starts || '').split(',').map(s => s.trim());
  let day = at.slice(0, 10);
  const t = at.slice(11, 16);
  if (names.length < 2 || starts.length < names.length || starts.some(s => !/^\d\d:\d\d$/.test(s))) return { day, shift: names[0], start: '', next: null };
  let i = -1; starts.slice(0, names.length).forEach((s, k) => { if (s <= t) i = k; });
  if (i < 0) { i = names.length - 1; day = addDays(day, -1); }
  const next = i + 1 < names.length ? { day, shift: names[i + 1], start: starts[i + 1] } : { day: addDays(day, 1), shift: names[0], start: starts[0] };
  return { day, shift: names[i], start: starts[i], next };
}
const validShift = (db, shift) => { if (!shifts(db).includes(shift)) throw fail('Ca không hợp lệ.'); return shift; };

export function modelList(db) {
  const fromPo = db.prepare('SELECT DISTINCT model_code, basic_model FROM po WHERE in_source = 1').all().map(r => modelOf(db, r.model_code, r.basic_model));
  const fromMap = db.prepare('SELECT DISTINCT model FROM model_map').all().map(r => r.model);
  return [...new Set([...fromPo, ...fromMap])].sort();
}

export function getAssign(db, day, shift) {
  validDay(day); validShift(db, shift);
  const lines = db.prepare('SELECT name FROM lines WHERE active = 1 ORDER BY sort_order, name').all().map(r => r.name);
  const map = new Map(db.prepare('SELECT line, model, updated_by, updated_at FROM line_assign WHERE work_date = ? AND shift = ?').all(day, shift).map(r => [r.line, r]));
  return { day, shift, shifts: shifts(db), models: modelList(db), rows: lines.map(line => ({ line, model: map.get(line)?.model || '', updatedBy: map.get(line)?.updated_by || '' })) };
}

export function saveAssign(db, { day, shift, rows }, username) {
  validDay(day); validShift(db, shift);
  if (!Array.isArray(rows)) throw fail('Không có dữ liệu Line.');
  const lines = new Set(db.prepare('SELECT name FROM lines WHERE active = 1').all().map(r => r.name));
  return tx(db, () => {
    const del = db.prepare('DELETE FROM line_assign WHERE work_date = ? AND shift = ? AND line = ?');
    const ins = db.prepare('INSERT INTO line_assign(work_date, shift, line, model, updated_by) VALUES (?,?,?,?,?)');
    for (const r of rows) {
      if (!lines.has(r.line)) throw fail(`Line ${r.line} không hợp lệ.`);
      del.run(day, shift, r.line);
      const model = String(r.model || '').trim();
      if (model) ins.run(day, shift, r.line, model, username);
    }
    audit(db, username, 'line.assign', { day, shift, rows });
    return { ok: true };
  });
}

export function copyAssign(db, { fromDay, fromShift, toDay, toShift }, username) {
  validDay(fromDay); validDay(toDay); validShift(db, fromShift); validShift(db, toShift);
  const rows = db.prepare('SELECT line, model FROM line_assign WHERE work_date = ? AND shift = ?').all(fromDay, fromShift);
  if (!rows.length) throw fail('Ca nguồn chưa khai báo Line nào.');
  return tx(db, () => {
    db.prepare('DELETE FROM line_assign WHERE work_date = ? AND shift = ?').run(toDay, toShift);
    const ins = db.prepare('INSERT INTO line_assign(work_date, shift, line, model, updated_by) VALUES (?,?,?,?,?)');
    for (const r of rows) ins.run(toDay, toShift, r.line, r.model, username);
    audit(db, username, 'line.copy', { fromDay, fromShift, toDay, toShift });
    return { ok: true, count: rows.length };
  });
}

// Pending là số tạm thời của ngày làm việc khai báo (ca Đêm sau 0h vẫn tính ngày trước): sang ngày làm việc mới mà không khai lại → 0.
export const pendingOf = (db, r) => r && r.pending_qty > 0 && r.pending_day === currentShift(db).day ? r.pending_qty : 0;
export function clearExpiredPending(db) {
  return Number(db.prepare("UPDATE line_params SET pending_qty = 0, pending_day = NULL WHERE pending_qty > 0 AND (pending_day IS NULL OR pending_day <> ?)").run(currentShift(db).day).changes);
}
export function getParams(db) {
  const rows = db.prepare('SELECT * FROM line_params ORDER BY line, model').all();
  const known = new Set(rows.map(r => `${r.line}\u001f${r.model}`));
  // Gợi ý các cặp Line + Model đang được khai báo chạy mà chưa có tham số.
  const missing = db.prepare('SELECT DISTINCT line, model FROM line_assign WHERE work_date >= ? ORDER BY line, model').all(addDays(todayKey(), -1))
    .filter(r => !known.has(`${r.line}\u001f${r.model}`));
  return {
    rows: rows.map(r => ({ line: r.line, model: r.model, spreadQty: r.spread_qty, pendingQty: pendingOf(db, r), pendingExpired: r.pending_qty > 0 && !pendingOf(db, r), uph: r.uph ?? null, note: r.note || '', updatedBy: r.updated_by, updatedAt: r.updated_at })),
    missing: missing.map(r => ({ line: r.line, model: r.model })), threshold: Number(getSettings(db).supply_threshold), workDay: currentShift(db).day,
    // Gợi ý cho cặp Line + Model chưa khai: số mới nhất của cùng Model ở Line khác.
    suggest: Object.fromEntries(db.prepare('SELECT model, line, spread_qty, uph FROM line_params ORDER BY updated_at').all().map(r => [r.model, { line: r.line, spreadQty: r.spread_qty, uph: r.uph ?? null }]))
  };
}

export function saveParams(db, rows, username) {
  if (!Array.isArray(rows) || !rows.length) throw fail('Không có dòng nào để lưu.');
  const lines = new Set(db.prepare('SELECT name FROM lines').all().map(r => r.name));
  return tx(db, () => {
    const up = db.prepare(`INSERT INTO line_params(line, model, spread_qty, pending_qty, pending_day, uph, note, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(line, model) DO UPDATE SET spread_qty = excluded.spread_qty, pending_qty = excluded.pending_qty, pending_day = excluded.pending_day, uph = excluded.uph, note = excluded.note,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at`);
    const old = db.prepare('SELECT * FROM line_params WHERE line = ? AND model = ?'), day = currentShift(db).day;
    for (const r of rows) {
      const line = String(r.line || '').trim(), model = String(r.model || '').trim();
      if (!lines.has(line)) throw fail(`Line "${line}" không hợp lệ.`);
      if (!model) throw fail(`Dòng ${line}: chọn Model.`);
      const spread = Number(r.spreadQty), pending = Number(r.pendingQty);
      if (!Number.isFinite(spread) || spread < 0 || !Number.isFinite(pending) || pending < 0) throw fail(`${line} / ${model}: số rải chuyền và pending phải ≥ 0.`);
      const o = old.get(line, model);   // trường không gửi lên (UPH, ghi chú) thì giữ giá trị cũ
      const uph = r.uph === undefined ? (o?.uph ?? null) : r.uph === '' || r.uph === null ? null : Number(r.uph);
      if (uph !== null && (!Number.isFinite(uph) || uph < 0)) throw fail(`${line} / ${model}: UPH phải ≥ 0.`);
      up.run(line, model, spread, pending, pending > 0 ? day : null, uph || null, String(r.note === undefined ? (o?.note || '') : r.note || '').slice(0, 200), username);
    }
    audit(db, username, 'line.params', rows);
    return { ok: true, count: rows.length };
  });
}

export function deleteParam(db, { line, model }, username) {
  const res = db.prepare('DELETE FROM line_params WHERE line = ? AND model = ?').run(line, model);
  audit(db, username, 'line.params.delete', { line, model });
  return { ok: res.changes > 0 };
}

// Tồn chờ cấp VLN theo Model: min = số line × min/line; max = số line × max/line (đếm theo số Kit PO).
export function vlnOverview(db, day, shift) {
  validDay(day); validShift(db, shift);
  const s = getSettings(db), minPer = Number(s.vln_min_per_line), maxPer = Number(s.vln_max_per_line);
  const assigns = db.prepare('SELECT line, model FROM line_assign WHERE work_date = ? AND shift = ?').all(day, shift);
  const linesByModel = new Map();
  for (const a of assigns) { if (!linesByModel.has(a.model)) linesByModel.set(a.model, []); linesByModel.get(a.model).push(a.line); }
  const kits = db.prepare('SELECT k.*, (SELECT p.basic_model FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = k.id LIMIT 1) AS basic FROM kit_order k').all();
  const byModel = new Map();
  const bucket = m => { if (!byModel.has(m)) byModel.set(m, { planned: 0, kitted: 0, delivered: 0 }); return byModel.get(m); };
  for (const k of kits) {
    const model = modelOf(db, k.model_code, k.basic);
    if (k.vln_status === 'done') bucket(model).kitted++;          // đã kitting VLN, chờ cấp
    else if (k.vln_status === 'delivered') bucket(model).delivered++;
    else if (k.plan_day) bucket(model).planned++;               // đã lập KH, chưa xong VLN
  }
  const unplanned = new Map();
  for (const r of db.prepare(`SELECT model_code, basic_model FROM po p WHERE in_source = 1 AND remain_qty > 0 AND ${notCancelledSql('p.')} AND NOT EXISTS (SELECT 1 FROM kit_order_po k WHERE k.po_key = p.po_key)`).all()) {
    const m = modelOf(db, r.model_code, r.basic_model); unplanned.set(m, (unplanned.get(m) || 0) + 1);
  }
  const models = [...new Set([...linesByModel.keys()])].sort();
  return {
    day, shift, minPer, maxPer,
    rows: models.map(model => {
      const lines = linesByModel.get(model) || [], b = byModel.get(model) || { planned: 0, kitted: 0 };
      const min = lines.length * minPer, max = lines.length * maxPer;
      const status = b.kitted < min ? 'short' : b.kitted > max ? 'over' : 'ok';
      return { model, lines, min, max, waiting: b.kitted, planned: b.planned, unplanned: unplanned.get(model) || 0, status, needMore: Math.max(min - b.kitted, 0) };
    })
  };
}
