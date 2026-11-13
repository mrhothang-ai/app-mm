'use strict';
/* =================== KITTING TRÊN TABLET + IN PHIẾU GIẤY =================== */
// Danh sách PO cần kitting (thẻ lớn, chạm được) → chạm vào mở BOM toàn màn hình, lưu tự động.
// Nhân viên soạn bằng giấy: In phiếu (A5) có cột Vị trí (tồn ERP), ô SL kitting rộng và 4 ô ký.
let kpGrp = 'VLN', kpData = null, kpSel = new Set(), kp = null, kpTimer = null, kpSaving = null;
const canKit = () => can('kitpad') || can('kho');
const KP_GROUP = { VLN: 'VLN', HV: 'Rear + VLĐT' };
const KP_ST = { pending: 'Chưa làm', progress: 'Đang làm', done: 'Xong', delivered: 'Đã giao' };
const GORD = { REAR: 0, VLDT: 1, VLN: 2 };
const kpNum = n => { const v = Math.round(Number(n) * 1000) / 1000; return String(v).replace('.', ','); };
const kpAt = t => t ? `${t.slice(11, 16)} ${dmy(t).slice(0, 5)}` : '';
const kpLocalIso = s => { const d = new Date(s); return isNaN(d) ? '' : new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 16); };

// Chuyển nhanh VLN Chưa làm → Đang làm (để bên Rear + VLĐT có PO kitting ngay); Đang làm mà chưa soạn mã nào thì trả về được.
function startBtn(r, grp) {
  if (grp !== 'VLN' || !canKit()) return '';
  if (r.status === 'pending') return '<button type="button" class="kit-start" title="Chuyển sang Đang làm để Rear + VLĐT kitting được">▶ Bắt đầu</button>';
  if (r.status === 'progress' && !(r.progress?.kittedQty > 0)) return '<button type="button" class="kit-start back" data-back="1" title="Chưa soạn mã nào: trả về Chưa làm">↺ Chưa làm</button>';
  return '';
}
async function kitStart(btn, reload) {
  await withBusy(btn, async () => { const r = await api('/api/kho/kit/start', { json: { kitId: Number(btn.closest('[data-id]').dataset.id), back: !!btn.dataset.back } }); toast(r.message, 'success'); await reload(); });
}
async function loadKitpad() {
  ecnAlerts();
  $$('#kpGrp button').forEach(b => b.classList.toggle('active', b.dataset.g === kpGrp));
  if (kpGrp === 'BU') { kpData = await api('/api/kho/bu'); kpBuBadge(kpData.rows.length); return renderBuList(); }
  kpData = await api(`/api/kho/queue?grp=${kpGrp}`);
  renderKitpad();
  api('/api/kho/bu').then(d => kpBuBadge(d.rows.length)).catch(() => {});
}
function kpBuBadge(n) { const b = $('#kpBuN'); if (b) { b.textContent = n || ''; b.hidden = !n; } }
function renderKitpad() {
  const q = ($('#kpSearch').value || '').trim().toLowerCase(), hide = $('#kpHideDone').checked;
  kpRangeUi();
  if (kpGrp === 'BU') return renderBuList();
  // Ẩn PO đã xong chỉ ẩn PO xong đủ; PO Kho xác nhận xong khi còn thiếu vẫn hiện (cam) để soạn tiếp.
  const rows = kpData.rows.filter(r => kpInRange(r.planDay) && (!hide || r.status !== 'done' || r.progress?.short) && (!q || [r.code, r.model, ...(r.codes || [])].join(' ').toLowerCase().includes(q)));
  let last = '';
  $('#kpList').innerHTML = rows.map(r => {
    const p = r.progress, g = r.rank ? `${r.planDay}|${r.round}` : '';
    const head = g && g !== last ? `<div class="qgroup">${esc(weekday(r.planDay))} ${esc(dmy(r.planDay).slice(0, 5))} · Lượt ${r.round}</div>` : '';
    last = g;
    const pct = p && p.total ? Math.round(p.full / p.total * 100) : 0;
    return `${head}<div class="kp-card st-${r.status}" data-id="${r.id}">
      <label class="kp-pick" title="Chọn để in nhiều phiếu"><input type="checkbox" ${kpSel.has(String(r.id)) ? 'checked' : ''}></label>
      <span class="krank ${r.behind ? 'behind' : ''}">Kho #${r.mrank || '–'}</span>
      <div class="kp-main"><div class="kp-h"><b>${esc(r.code)}</b>${r.kind === 'merged' ? ` <span class="pill merged">${(r.codes || []).length > 1 ? `${r.codes.length} code` : 'gộp'}</span>` : ''}${(r.loadTp || []).length ? ` <span class="pill load" title="Line nhận thêm hàng thành phẩm từ Kho">🏷 +${fmt(r.loadTp.reduce((a, l) => a + l.qty, 0))} TP</span>` : ''}${r.planLine && !r.fixedLine ? ` <span class="pill info" title="Line dự kiến theo file kế hoạch của Planner">→ ${esc(r.planLine)}</span>` : ''}${notePill(r.notes)}</div>
        <span>${esc(short(r.model))} · ${esc((r.codes || [r.modelCode]).map(codeTail).join(', '))} · <b>${fmt(r.qty)}</b> ea${r.planStart ? ` · Start ${esc(kpAt(r.planStart))}` : ''}</span>${poLine(r.pos)}</div>
      <div class="kp-prog">${p ? `<span><b>${p.full}</b>/${p.total} mã</span><span class="pbar ${pct >= 100 ? 'ok' : 'warn'}"><span data-w="${pct}%"></span></span>` : '<span class="muted">Chưa mở</span>'}</div>
      <span class="kst-wrap">${qStatus(r)}${startBtn(r, kpGrp)}</span>
      <button type="button" class="secondary kp-print" aria-label="In phiếu">🖨</button>
    </div>`;
  }).join('') || `<div class="card"><p class="empty">Không có PO ${KP_GROUP[kpGrp]} cần kitting${$('#kpFrom').value || $('#kpTo').value ? ' trong khoảng ngày đã chọn' : ''}${hide ? ' (đang ẩn PO đã xong)' : ''}</p></div>`;
  paintBars($('#kpList'));
  $('#kpPrintSel').hidden = !kpSel.size; $('#kpPrintSel').textContent = `🖨 In ${kpSel.size} phiếu đã chọn`;
}
$('#kpGrp').addEventListener('click', e => { const b = e.target.closest('[data-g]'); if (!b) return; kpGrp = b.dataset.g; kpSel.clear(); loadKitpad().catch(err => toast(err.message, 'error')); });
$('#kpReload').addEventListener('click', () => loadKitpad().catch(err => toast(err.message, 'error')));
$('#kpSearch').addEventListener('input', () => kpData && renderKitpad());
// Lọc Từ ngày – Đến ngày: VLN / Rear + VLĐT theo ngày kitting, Nợ · soạn bù theo ngày giao Line. Nhớ trên máy (localStorage).
const KP_RANGE_KEY = 'mm_kp_range';
const kpInRange = d => { const f = $('#kpFrom').value, t = $('#kpTo').value; return (!f || (d && d >= f)) && (!t || (d && d <= t)); };
function kpRangeUi() { $('#kpRangeLbl').textContent = kpGrp === 'BU' ? 'Ngày giao Line' : 'Ngày kitting'; $('#kpRangeClear').hidden = !$('#kpFrom').value && !$('#kpTo').value; }
function kpRangeSave() { try { localStorage.setItem(KP_RANGE_KEY, JSON.stringify({ from: $('#kpFrom').value, to: $('#kpTo').value })); } catch {} }
try { const s = JSON.parse(localStorage.getItem(KP_RANGE_KEY) || '{}'); $('#kpFrom').value = s.from || ''; $('#kpTo').value = s.to || ''; } catch {}
['#kpFrom', '#kpTo'].forEach(id => $(id).addEventListener('change', () => {
  if ($('#kpFrom').value && $('#kpTo').value && $('#kpFrom').value > $('#kpTo').value) { const f = $('#kpFrom').value; $('#kpFrom').value = $('#kpTo').value; $('#kpTo').value = f; }
  kpRangeSave(); if (kpData) renderKitpad();
}));
$('#kpToday').addEventListener('click', () => { $('#kpFrom').value = today; $('#kpTo').value = today; kpRangeSave(); if (kpData) renderKitpad(); });
$('#kpRangeClear').addEventListener('click', () => { $('#kpFrom').value = ''; $('#kpTo').value = ''; kpRangeSave(); if (kpData) renderKitpad(); });
$('#kpHideDone').addEventListener('change', () => kpData && renderKitpad());
$('#kpPrintSel').addEventListener('click', () => printKits([...kpSel], kpGrp).catch(err => toast(err.message, 'error')));
$('#kpList').addEventListener('click', e => {
  const bc = e.target.closest('.bu-card');
  if (bc) { if (e.target.closest('.bu-print')) return printBu([bc.dataset.bu]).catch(err => toast(err.message, 'error')); return openBu(bc.dataset.bu).catch(err => toast(err.message, 'error')); }
  const card = e.target.closest('.kp-card'); if (!card) return;
  const pick = e.target.closest('.kp-pick');
  if (pick) { if (e.target.matches('input')) { e.target.checked ? kpSel.add(card.dataset.id) : kpSel.delete(card.dataset.id); renderKitpad(); } return; }
  if (e.target.closest('.kp-print')) return printKits([card.dataset.id], kpGrp).catch(err => toast(err.message, 'error'));
  const sb = e.target.closest('.kit-start'); if (sb) return kitStart(sb, loadKitpad);
  openKitpad(card.dataset.id, kpGrp).catch(err => toast(err.message, 'error'));
});

/* ---------- màn BOM toàn màn hình ---------- */
async function openKitpad(id, grp) {
  const d = await api(`/api/kho/kit?id=${id}&grp=${grp}`);
  const items = d.items.map((it, i) => ({ ...it, i, v: it.kitted })).sort((a, b) => String(a.code).localeCompare(String(b.code)) || (GORD[a.kitGroup] ?? 9) - (GORD[b.kitGroup] ?? 9) || a.material.localeCompare(b.material));
  kp = { id, grp, d, items, ro: !canKit() || d.kit.status === 'delivered', filter: 'all', dirty: false, savedAt: '' };
  $('#kpFull').hidden = false; document.body.classList.add('kp-open');
  try { if (innerWidth <= 1400 && document.documentElement.requestFullscreen && !document.fullscreenElement) await document.documentElement.requestFullscreen(); } catch { /* trình duyệt không cho thì thôi */ }
  renderKp();
}
function kpCounts() { const full = kp.items.filter(x => x.v >= kqTarget(x.required)).length; return { full, short: kp.items.length - full, total: kp.items.length }; }
function renderKp() {
  const { d, grp, ro } = kp, k = d.kit, c = kpCounts(), pct = c.total ? Math.round(c.full / c.total * 100) : 0;
  const codes = k.codes || [k.modelCode], multi = grp === 'HV' && codes.length > 1;
  const qtyOf = code => k.pos.filter(p => p.modelCode === code).reduce((s, p) => s + p.qty, 0);
  const shown = kp.items.filter(x => kp.filter === 'all' || (kp.filter === 'short' ? x.v < kqTarget(x.required) : x.v >= kqTarget(x.required)));
  let lastCode = null;
  const rows = shown.map((x, n) => {
    const blk = multi && x.code !== lastCode ? `<div class="kp-block">Code ${esc(codeTail(x.code))} · ${fmt(qtyOf(x.code))} ea</div>` : '';
    lastCode = x.code;
    const st = x.v >= kqTarget(x.required) ? 'full' : x.v > 0 ? 'part' : '';
    return `${blk}<div class="kp-row ${st}" data-i="${x.i}">
      <span class="kp-no">${n + 1}</span>
      <div class="kp-mat"><b>${esc(x.material)}</b>${grp === 'HV' ? ` <span class="pill group-${x.kitGroup}">${GRP_LABEL[x.kitGroup] || x.kitGroup}</span>` : ''}<small>${esc(x.description || '')}</small>${d.stockAt ? `<small class="kp-loc">${locText(x)}</small>` : ''}</div>
      <div class="kp-req"><small>Cần</small><b>${fmt(x.required)}</b>${isWhole(x.required) ? '' : `<small class="kp-round" title="Định mức lẻ: cấp số nguyên">cấp ${kqTarget(x.required)}–${kqCap(x.required)}</small>`}</div>
      <div class="kp-step">${ro ? '' : '<button type="button" class="kp-minus" aria-label="Bớt">−</button>'}<input type="text" inputmode="decimal" autocomplete="off" class="kp-qty calc" value="${x.v}" ${ro ? 'disabled' : ''} aria-label="Đã lấy">${ro ? '' : '<button type="button" class="kp-plus" aria-label="Thêm">+</button>'}</div>
      ${ro ? '' : `<button type="button" class="kp-full-btn ${st === 'full' ? 'on' : ''}">${st === 'full' ? '✓ Đủ' : 'Đủ'}</button>`}
    </div>`;
  }).join('') || '<p class="empty">Không có mã nào</p>';
  $('#kpFull').innerHTML = `<div class="kp-top">
      <button type="button" class="secondary kp-back">← Danh sách</button>
      <div class="kp-title"><b>${esc(k.code)}</b><span>${esc(KP_GROUP[grp])} · ${esc(short(k.model))} · ${esc(codes.map(codeTail).join(', '))} · ${fmt(k.qty)} ea${k.mrank ? ` · Kho #${k.mrank}` : ''}</span>${poLine(k.pos)}</div>
      <div class="kp-pct"><span><b>${c.full}</b>/${c.total} mã</span><span class="pbar ${pct >= 100 ? 'ok' : 'warn'}"><span data-w="${pct}%"></span></span></div>
      <button type="button" class="secondary kp-printone" aria-label="In phiếu">🖨</button>
    </div>
    ${noteBox(k.notes)}${loadBox(k)}${unplanBox(k, grp)}
    <div class="kp-filter seg"><button type="button" data-f="all" class="${kp.filter === 'all' ? 'active' : ''}">Tất cả ${c.total}</button><button type="button" data-f="short" class="${kp.filter === 'short' ? 'active' : ''}">Còn thiếu ${c.short}</button><button type="button" data-f="full" class="${kp.filter === 'full' ? 'active' : ''}">Đã đủ ${c.full}</button></div>
    <div class="kp-rows">${rows}</div>
    <div class="kp-bottom">
      <span class="kp-save muted">${ro ? (k.status === 'delivered' ? 'PO đã giao Line — chỉ xem' : 'Chỉ xem') : kpSaving ? 'Đang lưu…' : kp.dirty ? 'Chưa lưu' : kp.savedAt ? `Đã lưu ${kp.savedAt}` : 'Lưu tự động khi nhập'}</span>
      ${ro ? '' : `<button type="button" class="secondary kp-allfull">Đủ tất cả</button><button type="button" class="primary kp-done">Xong ${esc(KP_GROUP[grp])}</button>`}
    </div>`;
  paintBars($('#kpFull'));
}
function kpSet(i, v) {
  const x = kp.items.find(y => y.i === i); if (!x) return;
  x.v = Math.max(0, Math.min(kqCap(x.required), Math.round(Number(v) || 0)));
  kp.dirty = true; clearTimeout(kpTimer); kpTimer = setTimeout(() => kpSave(false).catch(err => toast(err.message, 'error')), 1200);
}
async function kpSave(confirm, extra = {}) {
  clearTimeout(kpTimer);
  if (!kp || kp.ro) return null;
  const payload = { kitId: kp.d.kit.id, grp: kp.grp, items: kp.items.map(x => ({ code: x.code, material: x.material, kitted: x.v })), confirm, ...extra };
  kpSaving = true; const s = $('#kpFull .kp-save'); if (s) s.textContent = 'Đang lưu…';
  try { const r = await api('/api/kho/kit', { json: payload }); kp.dirty = false; kp.savedAt = new Date().toTimeString().slice(0, 5); return r; }
  finally { kpSaving = null; const s2 = $('#kpFull .kp-save'); if (s2 && kp) s2.textContent = kp.dirty ? 'Chưa lưu' : `Đã lưu ${kp.savedAt}`; }
}
async function closeKitpad() {
  if (kp?.dirty) { try { await kpSave(false); } catch (e) { toast(e.message, 'error'); return; } }
  kp = null; $('#kpFull').hidden = true; $('#kpFull').innerHTML = ''; document.body.classList.remove('kp-open');
  try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* bỏ qua */ }
  if ($('#panel-kitpad').classList.contains('active')) loadKitpad().catch(() => {});
}
$('#kpFull').addEventListener('click', async e => {
  if (!kp) return;
  if (e.target.closest('.kp-back')) return closeKitpad();
  if (e.target.closest('.kp-printone')) { if (kp.dirty) await kpSave(false).catch(() => {}); return printKits([kp.id], kp.grp).catch(err => toast(err.message, 'error')); }
  const f = e.target.closest('[data-f]'); if (f) { kp.filter = f.dataset.f; return renderKp(); }
  const row = e.target.closest('.kp-row');
  if (row && !kp.ro) {
    const i = Number(row.dataset.i), x = kp.items.find(y => y.i === i);
    if (e.target.closest('.kp-full-btn')) { kpSet(i, x.v >= kqTarget(x.required) ? 0 : kqFill(x.required)); return renderKp(); }
    if (e.target.closest('.kp-plus')) { kpSet(i, x.v + 1); return renderKp(); }
    if (e.target.closest('.kp-minus')) { kpSet(i, x.v - 1); return renderKp(); }
  }
  if (e.target.closest('.kp-allfull')) { kp.items.forEach(x => kpSet(x.i, kqFill(x.required))); return renderKp(); }
  if (e.target.closest('.kp-done')) {
    const c = kpCounts();
    let why = {};
    if (c.short) { why = await askShortReason(c.short, kp.d.kit.code); if (!why) return; }
    await withBusy(e.target.closest('.kp-done'), async () => { const r = await kpSave(true, why); toast(r?.message || 'Đã lưu', 'success'); await closeKitpad(); });
  }
});
$('#kpFull').addEventListener('change', e => { if (kp && e.target.matches('.kp-qty')) { const v = calcEval(e.target.value); if (Number.isNaN(v)) return renderKp(); kpSet(Number(e.target.closest('.kp-row').dataset.i), v); renderKp(); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && kp && $('#dialog').hidden) closeKitpad(); });

/* ---------- in phiếu kitting giấy (A5 dọc) ---------- */
function qrSvg(text) {
  try { const q = qrcode(0, 'M'); q.addData(String(text)); q.make(); return q.createSvgTag({ cellSize: 2, margin: 0, scalable: true }); } catch { return ''; }
}
function sheetHtml(d, count) {
  const k = d.kit, grp = d.grp, codes = k.codes || [k.modelCode], multi = grp === 'HV';
  const qtyOf = code => k.pos.filter(p => p.modelCode === code).reduce((s, p) => s + p.qty, 0);
  const items = [...d.items].sort((a, b) => String(a.code).localeCompare(String(b.code)) || (GORD[a.kitGroup] ?? 9) - (GORD[b.kitGroup] ?? 9) || a.material.localeCompare(b.material));
  let n = 0, last = null;
  const rows = items.map(it => {
    const base = (multi ? qtyOf(it.code) : k.qty) - (it.kitGroup === 'REAR' ? (k.unplanRear || []).filter(u => u.modelCode === it.code).reduce((a, u) => a + u.qty, 0) : 0), blk = multi && it.code !== last ? `<tr class="pr-blk"><td colspan="6">Code ${esc(codeTail(it.code))} · ${fmt(qtyOf(it.code))} ea</td></tr>` : '';
    const locs = (it.locs || []).filter(l => l.qty > 0).slice(0, 2);
    const loc = locs.length ? locs.map(l => `<b>${esc(l.loc)}</b><div class="pr-d">${fmt(l.qty)}</div>`).join('') : it.defaultLoc ? `<span class="pr-d">${esc(it.defaultLoc)}?</span>` : '';
    last = it.code; n++;
    return `${blk}<tr><td class="c">${n}</td><td><b>${esc(it.material)}</b>${multi ? ` <i class="pr-g">${GRP_LABEL[it.kitGroup] || it.kitGroup}</i>` : ''}<div class="pr-d">${esc(it.description || '')}</div></td>
      <td class="c pr-loc">${loc}</td><td class="c">${base ? kpNum(it.required / base) : ''}</td><td class="c pr-q">${fmt(it.required)}${it.kitted > 0 && it.kitted < it.required ? `<div class="pr-d">đã soạn ${fmt(it.kitted)}</div>` : ''}</td><td class="pr-kit"></td></tr>`;
  }).join('');
  const total = items.reduce((s, i) => s + i.required, 0);
  const now = new Date(Date.now() + 7 * 3600000).toISOString();
  return `<section class="pr-sheet">
    <header class="pr-head"><div class="pr-hl">
      <div class="pr-co">IL-SUNG TECH · PHIẾU KITTING · MM-KIT-01${count > 1 ? ' · <b class="pr-copy">BẢN IN LẠI (lần ' + count + ')</b>' : ''}</div>
      <h1 class="pr-po">${esc(k.code)}<span class="pr-grp">${esc(KP_GROUP[grp])}</span></h1>
      <div class="pr-model">${esc(short(k.model))}<small>${esc(codes.map(codeTail).join(' · '))}</small></div>
      <div class="pr-info"><span>SL <b>${fmt(k.qty)}</b> ea</span><span>Start ${esc(kpAt(k.planStart) || '–')}</span><span>Kitting ${esc(k.planDay ? dmy(k.planDay) : '–')}</span>${k.planLine ? `<span>Line dự kiến <b>${esc(k.planLine)}</b></span>` : ''}</div>
      ${k.pos.length > 1 ? `<div class="pr-pos">PO gốc (${k.pos.length}): ${k.pos.map(p => `<b>${esc(p.po)}</b>${codes.length > 1 ? ` <small>${esc(codeTail(p.modelCode))}</small>` : ''} ${fmt(p.qty)}`).join(' · ')}</div>` : ''}${grp === 'HV' && (k.unplanRear || []).length ? `<div class="pr-note"><b>Lưu ý:</b> ${esc(unplanText(k))}</div>` : ''}${(k.loadTp || []).length ? `<div class="pr-note pr-load">🏷 LINE NHẬN THÊM ${fmt(loadTpSum(k))} EA THÀNH PHẨM TỪ KHO: ${k.loadTp.map(l => `${esc(l.po)} (${esc(codeTail(l.modelCode))} · ${fmt(l.qty)}${l.ref ? ` · phiếu ${esc(l.ref)}` : ''})`).join(', ')} — SL cần đã trừ.</div>` : ''}${(k.notes || []).length ? `<div class="pr-note">📝 ${k.notes.map(n => `${k.pos.length > 1 ? `<b>${esc(n.po)}</b>: ` : ''}${esc(n.note)}`).join(' · ')}</div>` : ''}</div>
      ${k.mrank ? `<div class="pr-rank"><small>Thứ tự Kho</small><b>#${k.mrank}</b><small>${esc(short(k.model))}</small></div>` : ''}
      <div class="pr-qr">${qrSvg(k.code)}<small>In ${esc(kpAt(now.slice(0, 16)))}<br>${esc(me.username)}${d.stockAt ? `<br>Tồn ERP ${esc(kpAt(kpLocalIso(d.stockAt)))}` : ''}</small></div></header>
    <table class="pr-table"><colgroup><col style="width:6mm"><col><col style="width:17mm"><col style="width:9mm"><col style="width:15mm"><col style="width:26mm"></colgroup><thead><tr class="pr-rep"><th colspan="6">${esc(k.code)} · ${esc(short(k.model))}${k.mrank ? ` <b>#${k.mrank}</b>` : ''} · ${esc(KP_GROUP[grp])}</th></tr><tr><th class="c">#</th><th>Mã vật liệu · mô tả</th><th class="c">Vị trí</th><th class="c">ĐM</th><th class="c">SL cần</th><th class="c">SL kitting</th></tr></thead>
      <tbody>${rows}<tr class="pr-sum"><td colspan="6">Tổng: ${items.length} dòng · ${fmt(total)} ea &nbsp;·&nbsp; Ghi chú: ...................................................</td></tr></tbody></table>
    <div class="pr-sign">${['Người soạn', 'Người kiểm tra', 'Quản lý Kho duyệt', 'Line nhận'].map((t, i) => `<div class="${i === 2 ? 'mgr' : ''}"><b>${t}</b><span></span><small>Họ tên · giờ</small></div>`).join('')}</div>
  </section>`;
}
async function printKits(ids, grp) {
  const sheets = [];
  for (const id of ids) {
    let d; try { d = await api(`/api/kho/kit?id=${id}&grp=${grp}`); } catch (e) { toast(e.message, 'error'); continue; }
    let count = (d.kit.printCount || 0) + 1;
    try { count = (await api('/api/kho/print', { json: { kitId: d.kit.id, grp } })).count; } catch { /* không có quyền ghi log thì vẫn in */ }
    sheets.push(sheetHtml(d, count));
  }
  if (!sheets.length) return;
  $('#printArea').innerHTML = sheets.join('');
  setTimeout(() => { try { window.print(); } catch { toast('Trình duyệt không cho in từ đây', 'error'); } }, 60);
  kpSel.clear(); if (kpData) renderKitpad();
}

/* ---------- NỢ · SOẠN BÙ: PO đã giao Line 1 phần → OP kho soạn phần nợ, in phiếu giao bù; Kho bấm Giao bù (tab Kho → Nợ) tạo đợt ---------- */
let bu = null, buTimer = null;
function renderBuList() {
  kpRangeUi();
  const q = ($('#kpSearch').value || '').trim().toLowerCase();
  const rows = kpData.rows.filter(r => kpInRange(kpLocalIso(String(r.deliveredAt || '').replace(' ', 'T') + 'Z').slice(0, 10)) && (!q || [r.code, r.line, r.modelCode].join(' ').toLowerCase().includes(q)));
  $('#kpList').innerHTML = rows.map(r => {
    const pct = r.items ? Math.round(r.full / r.items * 100) : 0;
    return `<div class="kp-card bu-card" data-bu="${r.kitId}">
      <span class="krank bu-line">${esc(r.line || '')}</span>
      <div class="kp-main"><div class="kp-h"><b>${esc(r.code)}</b> <span class="pill warn">Giao 1 phần</span>${r.lots.pending ? ` <span class="pill info">${r.lots.pending} đợt chờ Line ký</span>` : ''}${r.lots.rejected ? ` <span class="pill bad">${r.lots.rejected} đợt bị từ chối</span>` : ''}</div>
        <span>${esc(codeTail(r.modelCode || ''))} · nợ <b>${r.items}</b> mã${r.rear ? ` · <b class="bad-text">Rear ${r.rear}</b>` : ''} · ${fmt(r.debt)} ea · giao ${esc(kpAt(kpLocalIso(String(r.deliveredAt).replace(' ', 'T') + 'Z')))}</span></div>
      <div class="kp-prog"><span>Soạn bù <b>${r.full}</b>/${r.items} mã</span><span class="pbar ${pct >= 100 ? 'ok' : 'warn'}"><span data-w="${pct}%"></span></span></div>
      <span class="kst-wrap"><span class="kst ${r.full >= r.items ? 'kst-done' : r.prepared ? 'kst-progress' : 'kst-short'}">${r.full >= r.items ? 'Đã soạn đủ' : r.prepared ? 'Đang soạn' : 'Chưa soạn'}</span></span>
      <button type="button" class="secondary bu-print" aria-label="In phiếu giao bù">🖨</button>
    </div>`;
  }).join('') || `<div class="card"><p class="empty">Không còn PO nợ vật liệu${$('#kpFrom').value || $('#kpTo').value ? ' trong khoảng ngày đã chọn' : ''}</p></div>`;
  paintBars($('#kpList'));
  $('#kpPrintSel').hidden = true;
}
async function openBu(id) {
  const d = await api(`/api/kho/bu/kit?id=${id}`);
  bu = { id, d, items: d.items.map((it, i) => ({ ...it, i, v: it.prepared })), dirty: false, savedAt: '' };
  $('#kpFull').hidden = false; document.body.classList.add('kp-open');
  renderBu();
}
function renderBu() {
  const { d } = bu, k = d.kit, full = bu.items.filter(x => x.v >= x.debt - 1e-9).length, total = bu.items.length, pct = total ? Math.round(full / total * 100) : 0;
  const lots = d.lots.length ? `<div class="bu-lots">${d.lots.map(l => `<span class="pill ${l.status === 'received' ? 'ok' : l.status === 'rejected' ? 'bad' : 'warn'}" title="${esc(lotItemsText(l))}">${esc(l.lotNo.slice(k.code.length + 1))} ${l.status === 'received' ? '✓' : l.status === 'rejected' ? '✕' : 'chờ ký'}</span>`).join(' ')}</div>` : '';
  const rows = bu.items.map((x, n) => `<div class="kp-row ${x.v >= x.debt - 1e-9 ? 'full' : x.v > 0 ? 'part' : ''}" data-i="${x.i}">
      <span class="kp-no">${n + 1}</span>
      <div class="kp-mat"><b>${esc(x.material)}</b> <span class="pill group-${x.group}">${GRP_LABEL[x.group] || x.group}</span><small>${esc(x.description || '')}</small><small>Cần ${fmt(x.required)} · đã giao ${fmt(x.delivered)}${x.bu ? ` (bù ${fmt(x.bu)} × ${x.buN})` : ''}</small>${d.stockAt ? `<small class="kp-loc">${locText(x)}</small>` : ''}</div>
      <div class="kp-req"><small>Nợ</small><b class="bad-text">${fmt(x.debt)}</b></div>
      <div class="kp-step"><button type="button" class="kp-minus" aria-label="Bớt">−</button><input type="text" inputmode="decimal" autocomplete="off" class="kp-qty bu-qty calc" value="${x.v}" aria-label="Đã soạn bù"><button type="button" class="kp-plus" aria-label="Thêm">+</button></div>
      <button type="button" class="kp-full-btn ${x.v >= x.debt - 1e-9 ? 'on' : ''}">${x.v >= x.debt - 1e-9 ? '✓ Đủ' : 'Đủ'}</button>
    </div>`).join('') || '<p class="empty">Hết nợ</p>';
  $('#kpFull').innerHTML = `<div class="kp-top">
      <button type="button" class="secondary bu-back">← Danh sách</button>
      <div class="kp-title"><b>${esc(k.code)}</b><span>Soạn bù nợ · ${esc(k.line)} · ${esc(codeTail(k.modelCode || ''))} · giao ${esc(kpAt(kpLocalIso(String(k.deliveredAt).replace(' ', 'T') + 'Z')))}</span>${lots}</div>
      <div class="kp-pct"><span><b>${full}</b>/${total} mã</span><span class="pbar ${pct >= 100 ? 'ok' : 'warn'}"><span data-w="${pct}%"></span></span></div>
      <button type="button" class="secondary bu-printone" aria-label="In phiếu giao bù">🖨</button>
    </div>
    <div class="kp-rows">${rows}</div>
    <div class="kp-bottom">
      <span class="kp-save muted">${bu.dirty ? 'Chưa lưu' : bu.savedAt ? `Đã lưu ${bu.savedAt}` : 'Lưu tự động khi nhập'} · Kho bấm Giao bù ở tab Kho → Nợ</span>
      <button type="button" class="secondary bu-allfull">Đủ tất cả</button>
    </div>`;
  paintBars($('#kpFull'));
}
function buSet(i, v) {
  const x = bu.items.find(y => y.i === i); if (!x) return;
  x.v = Math.max(0, Math.min(x.cap, Math.round((Number(v) || 0) * 1000) / 1000));
  bu.dirty = true; clearTimeout(buTimer); buTimer = setTimeout(() => buSave().catch(err => toast(err.message, 'error')), 1200);
}
async function buSave() {
  clearTimeout(buTimer);
  if (!bu || !bu.dirty) return;
  const r = await api('/api/kho/bu', { json: { kitId: bu.d.kit.id, items: bu.items.map(x => ({ grp: x.grp, code: x.code, material: x.material, qty: x.v })) } });
  bu.dirty = false; bu.savedAt = new Date().toTimeString().slice(0, 5);
  const s = $('#kpFull .kp-save'); if (s) s.textContent = `Đã lưu ${bu.savedAt} · Kho bấm Giao bù ở tab Kho → Nợ`;
  return r;
}
async function closeBu() {
  if (bu?.dirty) { try { await buSave(); } catch (e) { toast(e.message, 'error'); return; } }
  bu = null; $('#kpFull').hidden = true; $('#kpFull').innerHTML = ''; document.body.classList.remove('kp-open');
  if ($('#panel-kitpad').classList.contains('active')) loadKitpad().catch(() => {});
}
$('#kpFull').addEventListener('click', async e => {
  if (!bu) return;
  if (e.target.closest('.bu-back')) return closeBu();
  if (e.target.closest('.bu-printone')) { await buSave().catch(() => {}); return printBu([bu.id]).catch(err => toast(err.message, 'error')); }
  if (e.target.closest('.bu-allfull')) { bu.items.forEach(x => buSet(x.i, x.debt)); return renderBu(); }
  const row = e.target.closest('.kp-row'); if (!row) return;
  const i = Number(row.dataset.i), x = bu.items.find(y => y.i === i);
  if (e.target.closest('.kp-full-btn')) { buSet(i, x.v >= x.debt - 1e-9 ? 0 : x.debt); return renderBu(); }
  if (e.target.closest('.kp-plus')) { buSet(i, Math.min(x.cap, x.v + 1)); return renderBu(); }
  if (e.target.closest('.kp-minus')) { buSet(i, x.v - 1); return renderBu(); }
});
$('#kpFull').addEventListener('change', e => { if (bu && e.target.matches('.bu-qty')) { const v = calcEval(e.target.value); if (Number.isNaN(v)) return renderBu(); buSet(Number(e.target.closest('.kp-row').dataset.i), v); renderBu(); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && bu && $('#dialog').hidden) closeBu(); });
// Phiếu giao bù (A5): QR = mã Kit; cột Nợ, Đã soạn, ô SL giao bù; ký Người soạn, Kho giao, Leader Line nhận.
function buSheetHtml(d) {
  const k = d.kit, now = new Date(Date.now() + 7 * 3600000).toISOString(), next = `${k.code}-B${(d.lots.reduce((m, l) => Math.max(m, l.seq), 1)) + 1}`;
  const rows = d.items.map((it, n) => {
    const locs = (it.locs || []).filter(l => l.qty > 0).slice(0, 2);
    const loc = locs.length ? locs.map(l => `<b>${esc(l.loc)}</b><div class="pr-d">${fmt(l.qty)}</div>`).join('') : it.defaultLoc ? `<span class="pr-d">${esc(it.defaultLoc)}?</span>` : '';
    return `<tr><td class="c">${n + 1}</td><td><b>${esc(it.material)}</b> <i class="pr-g">${GRP_LABEL[it.group] || it.group}</i><div class="pr-d">${esc(it.description || '')}</div></td>
      <td class="c pr-loc">${loc}</td><td class="c pr-q">${fmt(it.debt)}</td><td class="c">${it.prepared ? fmt(it.prepared) : ''}</td><td class="pr-kit"></td></tr>`;
  }).join('');
  return `<section class="pr-sheet">
    <header class="pr-head"><div class="pr-hl">
      <div class="pr-co">IL-SUNG TECH · PHIẾU GIAO BÙ NỢ · MM-KIT-02</div>
      <h1 class="pr-po">${esc(k.code)}<span class="pr-grp">Giao bù</span></h1>
      <div class="pr-model">${esc(k.line || '')}<small>${esc(codeTail(k.modelCode || ''))} · dự kiến đợt ${esc(next)}</small></div>
      <div class="pr-info"><span>Giao Line ${esc(kpAt(kpLocalIso(String(k.deliveredAt).replace(' ', 'T') + 'Z')))}</span><span>Nợ ${d.items.length} mã</span>${d.lots.length ? `<span>Đã bù ${d.lots.length} đợt</span>` : ''}</div></div>
      <div class="pr-qr">${qrSvg(k.code)}<small>In ${esc(kpAt(now.slice(0, 16)))}<br>${esc(me.username)}${d.stockAt ? `<br>Tồn ERP ${esc(kpAt(kpLocalIso(d.stockAt)))}` : ''}</small></div></header>
    <table class="pr-table"><colgroup><col style="width:6mm"><col><col style="width:17mm"><col style="width:13mm"><col style="width:13mm"><col style="width:24mm"></colgroup><thead><tr class="pr-rep"><th colspan="6">${esc(k.code)} · giao bù · ${esc(k.line || '')}</th></tr><tr><th class="c">#</th><th>Mã vật liệu · mô tả</th><th class="c">Vị trí</th><th class="c">Nợ</th><th class="c">Đã soạn</th><th class="c">SL giao bù</th></tr></thead>
      <tbody>${rows}<tr class="pr-sum"><td colspan="6">Tổng: ${d.items.length} mã nợ &nbsp;·&nbsp; Ghi chú: ...................................................</td></tr></tbody></table>
    <div class="pr-sign">${['Người soạn', 'Kho giao', 'Leader Line nhận'].map(t => `<div><b>${t}</b><span></span><small>Họ tên · giờ</small></div>`).join('')}</div>
  </section>`;
}
async function printBu(ids) {
  const sheets = [];
  for (const id of ids) { try { sheets.push(buSheetHtml(await api(`/api/kho/bu/kit?id=${id}`))); } catch (e) { toast(e.message, 'error'); } }
  if (!sheets.length) return;
  $('#printArea').innerHTML = sheets.join('');
  setTimeout(() => { try { window.print(); } catch { toast('Trình duyệt không cho in từ đây', 'error'); } }, 60);
}
