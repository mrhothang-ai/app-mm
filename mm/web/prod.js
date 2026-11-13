'use strict';
/* =================== SẢN XUẤT: Line nhận PO & sản xuất thế nào, Kho sẵn sàng tới đâu =================== */
let prodLine = '', prodData = null;
const PLEVEL = { ok: 'Đủ việc', warn: 'Cần PO', bad: 'Nguy cơ hết việc', idle: 'Không chạy' };
const PSTAGE = { ready: 'Sẵn sàng giao', blocked: 'Chưa giao được', progress: 'Đang kitting', pending: 'Chưa kitting' };
const pHrs = h => h === null || h === undefined ? '–' : h >= 10 ? Math.round(h).toString() : String(h).replace('.', ',');
const pAt = t => t ? `${t.slice(11, 16)}${t.slice(0, 10) !== (prodData?.now || '').slice(0, 10) ? ` ${dmy(t).slice(0, 5)}` : ''}` : '';
// PO đang chạy: số đã SX thực là số chính, % chỉ để tham khảo
const pRun = r => `<span>${r.count} PO · <b>${fmt(r.produced || 0)}</b><small class="muted">/${fmt(r.qty || 0)} · ${r.progress}%</small></span>`;
const pBar = (p, cls = '') => `<span class="pbar ${cls}"><span data-w="${Math.max(0, Math.min(100, p))}%"></span></span>`;

// Mặc định ẩn Line không có kế hoạch (không chạy ca này lẫn ca sau); nhớ lựa chọn trên máy.
let prodShowIdle = false;
try { prodShowIdle = localStorage.getItem('mm_prod_idle') === '1'; } catch {}
async function loadProd() {
  if (!prodLine && me?.line) prodLine = me.line;
  const d = await api(`/api/prod?line=${encodeURIComponent(prodLine)}`);
  prodData = d; prodLine = d.line;
  $('#prodShiftInfo').innerHTML = `Ca <b>${esc(d.shift)}</b>${d.shiftStart ? ` từ ${esc(d.shiftStart)}` : ''}${d.next ? ` <span class="muted">· ca ${esc(d.next.shift)} ${esc(d.next.start)}</span>` : ''}`;
  renderOverview();
  renderProd();
  loadLinePos().catch(err => toast(err.message, 'error'));
  if (!$('#prodDebt').hidden) loadPDebts().catch(err => toast(err.message, 'error'));
}
// Bảng tổng quan toàn bộ Line: nhìn 1 lần biết Line nào sắp hết việc, Kho chuẩn bị tới đâu.
function renderOverview() {
  const d = prodData, all = d.lines, run = all.filter(l => l.model);
  const idle = all.filter(l => !l.model && !l.nextModel && l.line !== d.line);
  const L = prodShowIdle ? all : all.filter(l => !idle.includes(l));
  const cnt = lv => run.filter(l => l.level === lv).length;
  const rearDebt = run.reduce((s, l) => s + (l.debt?.rear || 0), 0), openReq = L.reduce((s, l) => s + (l.openReq || 0), 0);
  const kpi = `<div class="po-kpi">
    <div class="pk"><span>Line đang chạy</span><b>${run.length}<small>/${all.length}</small></b></div>
    <div class="pk ${cnt('bad') ? 'bad' : ''}"><span>Nguy cơ hết việc</span><b>${cnt('bad')}</b><small>cần PO, Kho chưa có sẵn</small></div>
    <div class="pk ${cnt('warn') ? 'warn' : ''}"><span>Cần PO</span><b>${cnt('warn')}</b><small>Kho có PO sẵn để giao</small></div>
    <div class="pk link ${rearDebt ? 'bad' : ''}" data-debt=""><span>Nợ Rear · YC chờ ›</span><b>${rearDebt}<small> · ${openReq}</small></b><small>bấm để xem bảng nợ</small></div></div>`;
  const row = l => {
    const s = l.supply, r = l.running || { count: 0, progress: 0 }, k = l.kho;
    const nextCell = `<td class="nextm ${l.nextModel !== l.model ? 'chg' : ''}">${l.nextModel ? esc(short(l.nextModel)) : '<span class="muted">–</span>'}</td>`;
    if (!l.model) return `<tr class="lv-idle ${l.line === d.line ? 'sel' : ''}" data-line="${esc(l.line)}"><th>${esc(l.line)}</th><td class="muted">Không chạy</td>${d.next ? nextCell : ''}<td colspan="8"></td></tr>`;
    const need = l.needPoIn === null ? '<span class="muted">–</span>' : s.pass ? '<b class="bad-text">Ngay</b>' : `${pHrs(l.needPoIn)}h <small class="muted">${esc(pAt(l.needPoAt))}</small>`;
    return `<tr class="lv-${l.level} ${l.line === d.line ? 'sel' : ''}" data-line="${esc(l.line)}">
      <th><span class="dot"></span>${esc(l.line)}${l.line === me.line ? ' <i class="pill info">Tôi</i>' : ''}</th>
      <td><b>${esc(short(l.model))}</b></td>${d.next ? nextCell : ''}
      <td class="run">${r.count ? `${pRun(r)}${pBar(r.progress, 'ok')}` : '<span class="muted">Chưa có</span>'}</td>
      <td class="num ${s.pass ? 'warn-text' : ''}"><b>${fmt(Math.round(s.available))}</b><small class="muted"> / ${fmt(s.threshold)}</small></td>
      <td class="num">${l.hoursLeft !== null ? `<b>${pHrs(l.hoursLeft)}h</b> <small class="muted">${esc(pAt(l.endAt))}</small>` : '<span class="muted" title="Chưa khai UPH">–</span>'}</td>
      <td class="num">${need}</td>
      <td class="kho rdy-link" data-ready="${esc(l.line)}" title="Bấm xem PO chờ giao">${k ? `<span class="kb ok" title="Sẵn sàng giao">${l.readyCount}</span><span class="kb pr" title="Đang kitting">${k.progress}</span><span class="kb pe" title="Chưa kitting">${k.pending}</span>` : ''}</td>
      <td class="num ${l.debt?.items ? 'link' : ''}" ${l.debt?.items ? `data-debt="${esc(l.line)}"` : ''}>${l.debt?.items ? `<span class="${l.debt.rear ? 'bad-text' : 'warn-text'}"><b>${l.debt.items}</b>${l.debt.rear ? ` · Rear ${l.debt.rear}` : ''}</span>` : '<span class="muted">0</span>'}${l.lotPending ? `<small class="sub-cell warn-text">${l.lotPending} đợt bù chờ ký</small>` : ''}</td>
      <td class="num">${l.openReq ? `<b>${l.openReq}</b>` : '<span class="muted">0</span>'}</td>
      <td><span class="lvl lvl-${l.level}">${PLEVEL[l.level]}</span></td></tr>`;
  };
  // Điện thoại: mỗi Line 1 thẻ gọn thay cho bảng ngang.
  const mrow = l => {
    const s = l.supply, r = l.running || { count: 0, progress: 0 }, k = l.kho;
    if (!l.model) return `<div class="pm lv-idle ${l.line === d.line ? 'sel' : ''}" data-line="${esc(l.line)}"><div class="pm-h"><b>${esc(l.line)}</b><span class="muted">Không chạy${l.nextModel ? ` · ca ${esc(d.next.shift)}: ${esc(short(l.nextModel))}` : ''}</span></div></div>`;
    return `<div class="pm lv-${l.level} ${l.line === d.line ? 'sel' : ''}" data-line="${esc(l.line)}">
      <div class="pm-h"><b>${esc(l.line)}</b>${l.line === me.line ? '<i class="pill info">Tôi</i>' : ''}<span class="pm-model">${esc(short(l.model))}${d.next && l.nextModel !== l.model ? ` <i class="chg">→ ${l.nextModel ? esc(short(l.nextModel)) : 'nghỉ'} ${esc(d.next.start)}</i>` : ''}</span><span class="lvl lvl-${l.level}">${PLEVEL[l.level]}</span></div>
      <div class="pm-run">${r.count ? `${pRun(r)}${pBar(r.progress, 'ok')}` : '<span class="muted">Chưa có PO đang chạy</span>'}</div>
      <div class="pm-k"><span>Còn lại<b class="${s.pass ? 'warn-text' : ''}">${fmt(Math.round(s.available))}<small>/${fmt(s.threshold)}</small></b></span>
        <span>Còn việc<b>${l.hoursLeft !== null ? `${pHrs(l.hoursLeft)}h` : '–'}</b></span>
        <span>Cần PO<b>${l.needPoIn === null ? '–' : s.pass ? '<i class="bad-text">Ngay</i>' : `${pHrs(l.needPoIn)}h`}</b></span>
        <span class="rdy-link" data-ready="${esc(l.line)}">Kho<b>${k ? `<i class="kb ok">${l.readyCount}</i><i class="kb pr">${k.progress}</i><i class="kb pe">${k.pending}</i>` : ''}</b></span></div>
      ${l.debt?.items || l.openReq ? `<div class="pm-f">${l.debt?.items ? `<span class="link ${l.debt.rear ? 'bad-text' : 'warn-text'}" data-debt="${esc(l.line)}">Kho nợ ${l.debt.items} mã${l.debt.rear ? ` · Rear ${l.debt.rear}` : ''}</span>` : ''}${l.openReq ? `<span>${l.openReq} yêu cầu chờ</span>` : ''}</div>` : ''}</div>`;
  };
  $('#prodLines').innerHTML = kpi + `<div class="card po-card"><div class="card-head"><h2>Tổng quan Line</h2><span class="muted">Ca ${esc(d.shift)} · bấm 1 dòng để xem chi tiết</span>${idle.length ? `<button type="button" class="secondary small" id="prodIdle">${prodShowIdle ? 'Ẩn' : 'Hiện'} ${idle.length} Line không có KH</button>` : ''}</div>
    <div class="table-wrap po-wrap"><table class="po-table"><thead><tr><th>Line</th><th>Ca ${esc(d.shift)}</th>${d.next ? `<th>Ca ${esc(d.next.shift)} <small>${esc(d.next.start)}</small></th>` : ''}<th>Đang chạy</th><th class="num">Còn lại / ngưỡng</th><th class="num">Còn việc</th><th class="num">Cần PO</th><th>Kho: Sẵn · Đang · Chưa</th><th class="num">Nợ</th><th class="num">YC chờ</th><th>Trạng thái</th></tr></thead>
    <tbody>${L.map(row).join('')}</tbody></table></div>
    <div class="po-mlist">${L.map(mrow).join('')}</div></div>`;
  paintBars($('#prodLines'));
}
// Bấm 1 Line ở bảng tổng quan → PO đang ở Line đó + tình trạng sản xuất; PO đã xong chỉ hiện khi chọn khoảng ngày (tối đa 7 ngày).
let lpData = null, lpDone = { open: false, from: '', to: '' };
const lpSel = new Set();   // PO nội bộ đang chọn để đổi trạng thái

async function loadLinePos() {
  const q = new URLSearchParams({ line: prodLine });
  if (lpDone.open && lpDone.from && lpDone.to) { q.set('from', lpDone.from); q.set('to', lpDone.to); }
  lpData = await api(`/api/prod/line?${q}`); renderProd();
}
// Bảng PO ở Line: Đã SX là số chính (% chỉ tham khảo); giờ cập nhật SX gần nhất ghi nhỏ ngay dưới số PO.
function lpRows(list, done) {
  const upd = p => p.updatedAt ? `<span class="sub-cell lp-upd" title="Cập nhật SX gần nhất ${esc(localTime(p.updatedAt))}">↻ ${esc(pAt(localIso(p.updatedAt)))}</span>` : '';
  return `<div class="table-scroll"><table class="grid lp-table"><thead><tr><th>PO</th><th>Model · Code</th><th class="num">Plan</th><th class="num">Đã SX</th><th class="num">Còn</th><th>Tiến độ</th><th>${done ? 'Xong lúc' : 'Giao Line'}</th></tr></thead><tbody>${list.map(p => `<tr class="${!done ? `rc-${RC_ROW[rcState(p.receipt, p.debts?.n)] || 'pending'}` : ''}">
    <td class="lp-po" data-kit="${p.kitId}">${!done && p.intStatus && can('prod') ? `<input type="checkbox" class="lp-int" value="${esc(p.po)}" ${lpSel.has(p.po) ? 'checked' : ''} aria-label="Chọn PO nội bộ ${esc(p.po)}">` : ''}<b>${esc(p.po)}</b>${p.poType !== 'SAP' ? ` <span class="pill warn">${(IPO_LABEL[p.poType] || p.poType)}</span>` : ''}${p.intStatus ? ` <span class="pill ${RC_INT_TONE[p.intStatus] || 'muted'}">${esc(RC_INT[p.intStatus] || p.intStatus)}</span>` : ''}${upd(p)}${done ? '' : rcPill(p.receipt, p.debts?.n)}${p.merged ? `<span class="sub-cell">${esc(p.kit)}</span>` : ''}${p.debts?.n ? `<span class="sub-cell ${p.debts.rear ? 'bad-text' : 'warn-text'}">Kho nợ ${p.debts.n} mã${p.debts.rear ? ` · Rear ${p.debts.rear}` : ''}</span>` : ''}</td>
    <td>${esc(short(p.model))}<span class="sub-cell">${esc(p.modelCode)}</span></td>
    <td class="num">${fmt(p.planQty)}</td><td class="num big-num">${fmt(p.produced)}</td><td class="num">${fmt(p.remain)}</td>
    <td class="lp-bar">${pBar(p.progress, p.state === 'done' ? '' : 'ok')}<small class="muted">${p.progress}%</small></td>
    <td class="nowrap">${done ? `${esc(p.done.at ? pAt(localIso(p.done.at)) : dmy(p.done.day).slice(0, 5))}${p.done.src !== 'prod' ? `<span class="sub-cell muted">${p.done.src === 'plan' ? 'theo Plan End' : 'theo lúc giao'}</span>` : ''}` : esc(pAt(localIso(p.deliveredAt)))}${!done && p.planEnd ? `<span class="sub-cell muted">End ${esc(pAt(p.planEnd))}</span>` : ''}</td></tr>`).join('') || `<tr><td colspan="7" class="empty">${done ? 'Không có PO xong trong khoảng này' : 'Chưa có PO đang ở Line'}</td></tr>`}</tbody></table></div>`;
}
const localIso = t => t ? new Date(Date.parse(`${String(t).replace(' ', 'T').slice(0, 19)}Z`) + 7 * 3600000).toISOString().slice(0, 16) : '';
function renderProd() {
  const d = prodData, m = d?.me;
  if (!m) { $('#prodBody').innerHTML = ''; return; }
  const L = lpData && lpData.line === d.line ? lpData : null;
  const head = `<div class="card-head"><h2>${esc(d.line)}${m.model ? ` · ${esc(short(m.model))}` : ' <span class="muted">· không chạy ca này</span>'}</h2>
    ${canLine() && m.model ? `<div class="btn-row"><button type="button" class="secondary" data-req="po">Xin PO tiếp theo</button><button type="button" class="secondary" data-req="material">Xin vật liệu</button></div>` : ''}</div>`;
  if (!L) { $('#prodBody').innerHTML = `<div class="card lp-card">${head}<p class="muted">Đang tải…</p></div>`; return; }
  for (const po of [...lpSel]) if (!L.active.some(p => p.po === po && p.intStatus)) lpSel.delete(po);
  const done = lpDone.open ? `<div class="lp-done"><div class="lp-range"><b>PO đã xong</b><input type="date" id="lpFrom" value="${esc(lpDone.from)}" aria-label="Từ ngày"> – <input type="date" id="lpTo" value="${esc(lpDone.to)}" aria-label="Đến ngày"><button type="button" class="primary" id="lpGo">Xem</button><small class="muted">tối đa 7 ngày</small></div>
    ${L.done ? lpRows(L.done, true) : ''}</div>` : '';
  $('#prodBody').innerHTML = `<div class="card lp-card">${head}
    <div class="lp-sub"><b>PO đang ở Line</b> <span class="muted">${L.active.length} PO</span>${L.receiptCount?.pending ? ` <span class="pill warn">${L.receiptCount.pending} chờ nhận</span>` : ''}${L.receiptCount?.rejected ? ` <span class="pill bad">${L.receiptCount.rejected} từ chối · chờ Kho</span>` : ''}${L.lotCount?.pending || L.lotCount?.rejected ? ` <button type="button" class="${L.lotCount.pending ? 'primary' : 'secondary'} small" id="lpLots">Giao bù chờ nhận (${L.lotCount.pending})${L.lotCount.rejected ? ` · ${L.lotCount.rejected} từ chối` : ''}</button>` : ''}
      ${can('prod') && L.active.some(p => p.intStatus) ? `<button type="button" class="secondary" id="lpIntBtn" ${lpSel.size ? '' : 'disabled'}>Trạng thái PO nội bộ${lpSel.size ? ` (${lpSel.size})` : ''}</button>` : ''}<button type="button" class="secondary lp-toggle" id="lpToggle">${lpDone.open ? '✕ Đóng PO đã xong' : `✓ PO đã xong (${L.doneCount})`}</button></div>
    ${lpRows(L.active, false)}${done}</div>`;
  paintBars($('#prodBody'));
}
$('#prodLines').addEventListener('click', e => { if (e.target.closest('#prodIdle')) { prodShowIdle = !prodShowIdle; try { localStorage.setItem('mm_prod_idle', prodShowIdle ? '1' : '0'); } catch {} renderOverview(); return; } const dz = e.target.closest('[data-debt]'); if (dz) { gotoDebt(dz.dataset.debt); return; } const rz = e.target.closest('[data-ready]'); if (rz) { openReadyList(rz.dataset.ready).catch(err => toast(err.message, 'error')); return; } const b = e.target.closest('tr[data-line], .pm[data-line]'); if (!b) return; prodLine = b.dataset.line; lpDone = { open: false, from: '', to: '' }; lpSel.clear(); loadProd().then(() => { if (innerWidth < 900) $('#prodBody').scrollIntoView({ behavior: 'smooth', block: 'start' }); }).catch(err => toast(err.message, 'error')); });
$('#prodReload').addEventListener('click', () => loadProd().catch(err => toast(err.message, 'error')));
$('#prodBody').addEventListener('change', e => {
  const c = e.target.closest('.lp-int'); if (!c) return;
  c.checked ? lpSel.add(c.value) : lpSel.delete(c.value);
  const btn = $('#lpIntBtn'); if (btn) { btn.disabled = !lpSel.size; btn.textContent = `Trạng thái PO nội bộ${lpSel.size ? ` (${lpSel.size})` : ''}`; }
});
$('#prodBody').addEventListener('click', e => {
  if (e.target.closest('.lp-int')) return;
  if (e.target.closest('#lpIntBtn')) return void intStatusDialog().catch(err => toast(err.message, 'error'));
  if (e.target.closest('#lpLots')) return void lotDialog(prodLine).catch(err => toast(err.message, 'error'));
  const po = e.target.closest('.lp-po[data-kit]'); if (po && po.closest('.lp-card') && !po.closest('.lp-done')) return void openReceipt(Number(po.dataset.kit)).catch(err => toast(err.message, 'error'));
  const b = e.target.closest('[data-req]'); if (b) return openRequest(prodLine, b.dataset.req, loadProd).catch(err => toast(err.message, 'error'));
  if (e.target.closest('#lpToggle')) {
    if (lpDone.open) { lpDone = { open: false, from: '', to: '' }; if (lpData) lpData.done = null; return renderProd(); }
    lpDone = { open: true, from: addDaysLocal(today, -2), to: today }; return loadLinePos().catch(err => toast(err.message, 'error'));
  }
  if (e.target.closest('#lpGo')) {
    const from = $('#lpFrom').value, to = $('#lpTo').value;
    if (!from || !to || from > to) return toast('Chọn Từ ngày ≤ Đến ngày', 'error');
    if ((Date.parse(to) - Date.parse(from)) / 864e5 > 6) return toast('Chọn tối đa 7 ngày', 'error');
    lpDone = { open: true, from, to }; withBusy(e.target, loadLinePos);
  }
});

/* ---------- NHẬN PO TẠI LINE: bấm PO → quét QR phiếu kitting → BOM đã giao / còn nợ → Leader giao nhận ký (Mã NV + MK cấp 2) ---------- */
// Giao nhận theo Kit: Chờ nhận / Từ chối (đợt đầu) → Nhận 1 phần (còn nợ) / Chờ nhận bù (có đợt bù chưa ký) / Từ chối bù / Đã nhận đủ.
const RC_ST = { pending: ['Chờ nhận', 'warn'], received: ['✓ Đã nhận đủ', 'ok'], rejected: ['✕ Từ chối', 'bad'], partial: ['Nhận 1 phần', 'info'], lotPending: ['Chờ nhận bù', 'warn'], lotRejected: ['✕ Từ chối bù', 'bad'] };
const RC_ROW = { pending: 'pending', received: 'received', rejected: 'rejected', partial: 'partial', lotPending: 'pending', lotRejected: 'rejected' };
const rcState = (r, debtN) => !r ? 'pending' : r.status !== 'received' ? r.status : r.lotsRejected ? 'lotRejected' : r.lotsPending ? 'lotPending' : debtN ? 'partial' : 'received';
const RC_INT = { waiting: 'Chờ SX', running: 'Đang SX', done: 'Hoàn thành' }, RC_INT_TONE = { waiting: 'muted', running: 'info', done: 'ok' };
const RC_GRP = { REAR: 'Rear', VLDT: 'VLĐT', VLN: 'VLN' };
const rcPill = (r, debtN) => { if (!r) return ''; const st = rcState(r, debtN), tip = st === 'pending' ? 'Bấm để quét QR phiếu kitting và xác nhận nhận' : st === 'rejected' ? `${r.reason}${r.note ? ` · ${r.note}` : ''} — chờ Kho xử lý` : st === 'lotPending' ? `${r.lotsPending} đợt giao bù chờ Leader ký nhận` : st === 'lotRejected' ? 'Đợt giao bù bị từ chối — chờ Kho xử lý' : st === 'partial' ? `Đã nhận phần Kho giao · Kho còn nợ ${debtN} mã` : `${r.by} · ${localTime(r.at)}`;
  return `<span class="sub-cell"><span class="pill ${RC_ST[st][1]} rc-pill" title="${esc(tip)}">${RC_ST[st][0]}${st === 'lotPending' ? ` (${r.lotsPending})` : ''}</span></span>`; };
const rcNorm = v => String(v || '').trim().replace(/\s+/g, '').toLowerCase().replace(/^0+(?=\d)/, '');
const rcSigner = () => { try { return localStorage.getItem('mm_rc_signer') || ''; } catch { return ''; } };
const rcRemember = v => { try { localStorage.setItem('mm_rc_signer', v); } catch {} };
let rc = null;   // { data, mode: scan | bom | view, scanned, reject, stream, timer }
function rcModal() {
  let m = $('#rcModal'); if (m) return m;
  m = document.createElement('div'); m.id = 'rcModal'; m.className = 'dialog-backdrop'; m.hidden = true;
  m.innerHTML = '<div class="dialog rc-dialog" role="dialog" aria-modal="true" aria-labelledby="rcTitle"><div id="rcBody"></div></div>';
  document.body.append(m);
  m.addEventListener('click', e => rcClick(e).catch(err => rcMsg(err.message, 'error')));
  m.addEventListener('change', e => { if (e.target.id === 'rcFile' && e.target.files[0]) rcFromFile(e.target.files[0]).catch(err => rcMsg(err.message, 'error')); if (e.target.id === 'rcReason') $('#rcNoteWrap').hidden = false; });
  m.addEventListener('keydown', e => { if (e.key === 'Escape') rcClose(); if (e.key === 'Enter' && e.target.id === 'rcCode') { e.preventDefault(); rcScanned(e.target.value); } });
  return m;
}
async function openReceipt(kitId) {
  const data = await api(`/api/prod/receipt?kitId=${kitId}`);
  const st = data.receipt.status, act = can('prod') && data.open && st === 'pending';
  rc = { data, mode: act ? 'scan' : 'view', scanned: '', reject: false, stream: null, timer: null };
  rcModal().hidden = false; rcRender();
  if (act) setTimeout(() => $('#rcCode')?.focus(), 50);
}
function rcClose() { rcStop(); const m = $('#rcModal'); if (m) m.hidden = true; rc = null; }
function rcMsg(text, tone = 'error') { const el = $('#rcMsg'); if (!el) return toast(text, tone); el.textContent = text; el.className = `rc-msg ${tone}`; el.hidden = !text; if (tone === 'error' && navigator.vibrate) try { navigator.vibrate(200); } catch {} }
function rcRender() {
  const d = rc.data, k = d.kit, r = d.receipt, T = d.totals, st = rcState({ ...r, lotsPending: T.lotsPending, lotsRejected: T.lotsRejected }, T.debtItems);
  const head = `<div class="rc-head"><div><h2 id="rcTitle">${esc(k.code)} <span class="pill ${RC_ST[st][1]}">${RC_ST[st][0]}</span></h2>
      <div class="muted">${esc(short(k.model))} · ${esc(k.line)} · ${fmt(k.qty)} ea · Kho giao ${esc(pAt(localIso(k.deliveredAt)))}${k.deliveredBy ? ` · ${esc(k.deliveredBy)}` : ''}</div>
      ${k.pos.length > 1 ? `<div class="po-line">PO: ${k.pos.map(p => `${esc(p.po)}${p.type !== 'SAP' ? ` (${(IPO_LABEL[p.type] || p.type)})` : ''}`).join(' · ')}</div>` : ''}</div>
    <button type="button" class="secondary icon" data-rc="close" aria-label="Đóng">✕</button></div>`;
  const banner = loadBox(k) + (r.status === 'received' ? `<div class="rc-banner ok">✓ ${esc(r.signerName || r.signer)} xác nhận nhận lúc ${esc(localTime(r.at))}</div>`
    : r.status === 'rejected' ? `<div class="rc-banner bad">✕ Từ chối: <b>${esc(r.reasonText)}</b>${r.note ? ` · ${esc(r.note)}` : ''} <small>(${esc(r.signerName || r.signer)} · ${esc(localTime(r.at))})</small><br>Đang chờ Kho kiểm tra, điều chỉnh.</div>`
    : r.khoNote ? `<div class="rc-banner info">Kho đã xử lý: ${esc(r.khoNote)} <small>(${esc(r.khoBy)} · ${esc(localTime(r.khoAt))})</small> — quét lại để xác nhận.</div>` : '');
  let main = '';
  if (rc.mode === 'scan') {
    const cam = window.isSecureContext && navigator.mediaDevices?.getUserMedia;
    main = `<div class="rc-scan"><p class="rc-step">Quét QR trên <b>phiếu kitting</b> Kho giao kèm PO</p>
      <video id="rcVideo" playsinline muted hidden></video>
      <div class="btn-row">${cam ? '<button type="button" class="primary" data-rc="cam">📷 Mở camera quét</button>' : ''}
        <label class="${cam ? 'secondary' : 'primary'} rc-file">📸 Chụp ảnh QR<input type="file" accept="image/*" capture="environment" id="rcFile" hidden></label></div>
      <label>Hoặc gõ / súng quét mã trên phiếu<span class="rc-code"><input id="rcCode" autocomplete="off" autocapitalize="characters" placeholder="Mã PO / Kit"><button type="button" class="secondary" data-rc="code">OK</button></span></label>
      ${cam ? '' : '<p class="hint">Trang mở qua HTTP nội bộ nên trình duyệt không cho mở camera trực tiếp — bấm Chụp ảnh QR (điện thoại / tablet mở camera chụp).</p>'}</div>`;
  } else {
    // Cần · Giao đầu · Giao bù (tổng × số đợt, bấm xem từng đợt) · Còn nợ
    const lotsOf = i => d.lots.filter(l => l.items.some(x => x.grp === i.grp && x.code === i.code && x.material === i.material));
    const rows = d.items.map((i, n) => `<tr class="${i.debt > 0 ? 'rc-debt' : ''} ${i.buN ? 'rc-hasbu' : ''}" data-rci="${n}"><td><b>${esc(i.material)}</b><span class="sub-cell">${esc(i.description)}</span></td><td>${RC_GRP[i.group] || esc(i.group)}${i.code ? `<span class="sub-cell">${esc(codeTail(i.code))}</span>` : ''}</td>
      <td class="num">${fmt(i.required)}</td><td class="num big-num">${fmt(i.initial)}</td><td class="num rc-bu">${i.bu ? `<b>${fmt(i.bu)}</b><small class="muted"> ×${i.buN} ▾</small>` : '<span class="muted">–</span>'}</td><td class="num">${i.debt > 0 ? `<b class="bad-text">${fmt(i.debt)}</b>` : '<span class="muted">0</span>'}</td></tr>${i.buN && rc.open === n ? `<tr class="rc-lotrow"><td colspan="6">${lotsOf(i).map(l => { const x = l.items.find(y => y.grp === i.grp && y.code === i.code && y.material === i.material); return `<div><span class="pill info">${esc(lotTail(l))}</span> <b>${fmt(x.qty)}</b> · Kho ${esc(l.createdBy)} ${esc(localTime(l.createdAt))} · <span class="${LOT_ST[l.status][1]}-text">${l.status === 'received' ? `✓ ${esc(l.signerName || l.signer)} ${esc(localTime(l.signedAt))}` : LOT_ST[l.status][0]}</span></div>`; }).join('')}</td></tr>` : ''}`).join('');
    const sum = `<div class="rc-sum"><span>${T.items} mã</span><span>Giao <b>${fmt(T.delivered)}</b> / ${fmt(T.required)} ea${T.bu ? ` <small class="muted">(bù ${fmt(T.bu)} · ${d.lots.length} đợt)</small>` : ''}</span>${T.debtItems ? `<span class="bad-text">Kho còn nợ <b>${T.debtItems}</b> mã · ${fmt(T.debt)} ea${T.rearDebt ? ` · Rear ${T.rearDebt}` : ''}</span>` : '<span class="ok-text">Không nợ mã nào</span>'}</div>`;
    const act = rc.mode === 'bom' ? `<div class="rc-act">${rc.scanned ? `<p class="rc-step ok-text">✓ Đúng PO — quét được <b>${esc(rc.scanned)}</b></p>` : ''}
        ${rc.reject ? `<div class="rc-reject"><label>Lý do từ chối<select id="rcReason" required><option value="">Chọn lý do</option>${Object.entries(d.reasons).map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select></label>
          <label id="rcNoteWrap">Ghi chú cho Kho (mã nào, thiếu / sai bao nhiêu)<input id="rcNote" maxlength="300"></label></div>` : ''}
        <div class="rc-sign"><label>Mã NV Leader giao nhận<input id="rcSigner" autocomplete="off" autocapitalize="characters" value="${esc(rcSigner() || (sp('lineSign') ? me.username : ''))}"></label>
          <label>Mật khẩu cấp 2<input id="rcPin" type="password" autocomplete="off"></label></div>
        <div class="btn-row end">${rc.reject ? '<button type="button" class="secondary" data-rc="unreject">Quay lại</button><button type="button" class="danger-outline armed" data-rc="send-reject">Gửi từ chối về Kho</button>'
          : '<button type="button" class="danger-outline" data-rc="reject">✕ Từ chối</button><button type="button" class="primary rc-ok" data-rc="ok">✓ Xác nhận đã nhận</button>'}</div></div>` : '';
    const lotBox = d.lots.length ? `<div class="rc-lots"><b>Đợt giao</b> <span class="pill ok">Đợt 1 · giao Line ${esc(pAt(localIso(k.deliveredAt)))}</span>${d.lots.map(l => ` <span class="pill ${LOT_ST[l.status][1]}" title="${esc(l.items.map(i => `${i.material} ${fmt(i.qty)}`).join(' · '))}">${esc(lotTail(l))} · ${l.items.length} mã · ${LOT_ST[l.status][0]}</span>`).join('')}
      ${T.lotsPending && can('prod') && rc.mode === 'view' ? `<button type="button" class="primary small" data-rc="lots">✓ Ký nhận ${T.lotsPending} đợt bù</button>` : ''}</div>` : '';
    main = `${sum}<div class="table-scroll rc-table-wrap"><table class="grid small rc-items"><thead><tr><th>Mã vật liệu</th><th>Nhóm</th><th class="num">Cần</th><th class="num">Giao đầu</th><th class="num">Giao bù</th><th class="num">Còn nợ</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">Không có mã</td></tr>'}</tbody></table></div>${act}${lotBox}`;
  }
  const log = d.log.length ? `<details class="rc-log"><summary>Lịch sử nhận (${d.log.length})</summary>${d.log.map(l => `<div><span class="muted">${esc(localTime(l.at))}</span> <b>${{ receive: 'Nhận', reject: 'Từ chối', resolve: 'Kho xử lý' }[l.action] || esc(l.action)}</b> ${esc(l.signer || l.by)}${l.reason ? ` · ${esc(l.reason)}` : ''}${l.note ? ` · ${esc(l.note)}` : ''}</div>`).join('')}</details>` : '';
  $('#rcBody').innerHTML = `${head}${banner}<p id="rcMsg" class="rc-msg" hidden></p>${main}${log}`;
}
async function rcClick(e) {
  const b = e.target.closest('[data-rc]');
  const tr = !b && e.target.closest('tr.rc-hasbu');
  if (tr) { const n = Number(tr.dataset.rci); rc.open = rc.open === n ? null : n; return rcRender(); }
  if (!b) { if (e.target.id === 'rcModal') rcClose(); return; }
  const a = b.dataset.rc;
  if (a === 'close') return rcClose();
  if (a === 'lots') { const line = rc.data.kit.line, id = rc.data.kit.id; rcClose(); return lotDialog(line, id); }
  if (a === 'cam') return rcCam();
  if (a === 'code') return rcScanned($('#rcCode').value);
  if (a === 'reject' || a === 'unreject') { const sg = $('#rcSigner')?.value; rc.reject = a === 'reject'; rcRender(); if (sg) $('#rcSigner').value = sg; return; }
  if (a === 'ok' || a === 'send-reject') return withBusy(b, () => rcSubmit(a === 'ok'));
}
// So mã quét với PO đang chọn (mã Kit hoặc số PO gốc). Sai → báo "Sai PO", vẫn ở màn quét.
function rcScanned(text) {
  const v = String(text || '').trim(); if (!v || !rc) return;
  const k = rc.data.kit, ok = [k.code, ...k.pos.map(p => p.po)].some(c => rcNorm(c) === rcNorm(v));
  if (!ok) { if ($('#rcCode')) $('#rcCode').value = ''; return rcMsg(`Sai PO: quét được "${v}" — PO đang nhận là ${k.code}.`, 'error'); }
  rcStop(); rc.scanned = v; rc.mode = 'bom'; rcRender();
}
const rcJsQR = () => window.jsQR ? Promise.resolve() : loadScript('vendor/jsQR.min.js?v=1.4.0').catch(() => { throw new Error('Không tải được thư viện đọc QR.'); });
async function rcCam() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return rcMsg('Camera chỉ chạy khi mở app qua HTTPS. Dùng Chụp ảnh QR hoặc súng quét.', 'warn');
  await rcJsQR();
  const v = $('#rcVideo');
  try { rc.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); } catch { return rcMsg('Không mở được camera (chưa cho phép?). Dùng Chụp ảnh QR.', 'warn'); }
  v.srcObject = rc.stream; v.hidden = false; await v.play().catch(() => {});
  const c = document.createElement('canvas'), ctx = c.getContext('2d', { willReadFrequently: true });
  rc.timer = setInterval(() => {
    if (!rc || !v.videoWidth) return;
    const w = Math.min(960, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth); c.width = w; c.height = h; ctx.drawImage(v, 0, 0, w, h);
    const q = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' }); if (q?.data) rcScanned(q.data);
  }, 250);
}
function rcStop() { if (!rc) return; clearInterval(rc.timer); rc.timer = null; rc.stream?.getTracks().forEach(t => t.stop()); rc.stream = null; }
// Ảnh chụp phiếu: thử vài cỡ ảnh (QR nhỏ trên giấy A5 cần độ phân giải cao, ảnh quá lớn thì chậm).
async function rcFromFile(file) {
  rcMsg('Đang đọc ảnh…', 'info'); await rcJsQR();
  const img = await (window.createImageBitmap ? createImageBitmap(file).catch(() => null) : null) || await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('Không đọc được ảnh.')); i.src = URL.createObjectURL(file); });
  const W = img.width, H = img.height, c = document.createElement('canvas'), ctx = c.getContext('2d', { willReadFrequently: true });
  for (const max of [1600, 1000, 2400, 700]) {
    const f = Math.min(1, max / Math.max(W, H)), w = Math.round(W * f), h = Math.round(H * f); c.width = w; c.height = h; ctx.drawImage(img, 0, 0, w, h);
    const q = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
    if (q?.data) { rcMsg('', 'info'); return rcScanned(q.data); }
  }
  rcMsg('Không đọc được QR trong ảnh — chụp gần hơn, rõ nét, đủ sáng.', 'error');
}
async function rcSubmit(receive) {
  const signer = $('#rcSigner').value.trim().toUpperCase(), pin2 = $('#rcPin').value;
  if (!signer || !pin2) return rcMsg('Nhập Mã NV và mật khẩu cấp 2 của Leader giao nhận.', 'error');
  const body = { kitId: rc.data.kit.id, scanned: rc.scanned, signer, pin2 };
  if (!receive) { body.reason = $('#rcReason').value; body.note = $('#rcNote').value.trim(); if (!body.reason) return rcMsg('Chọn lý do từ chối.', 'error'); if (body.reason === 'OTHER' && !body.note) return rcMsg('Lý do "Khác" cần ghi chú.', 'error'); }
  let r; try { r = await api(receive ? '/api/prod/receipt/receive' : '/api/prod/receipt/reject', { json: body }); } catch (e) { $('#rcPin').value = ''; return rcMsg(e.message, 'error'); }
  if (r.ok === false) { $('#rcPin').value = ''; return rcMsg(r.message, 'error'); }
  rcRemember(signer); toast(r.message, receive ? 'success' : 'error'); rcClose();
  await loadLinePos().catch(() => {});
}

/* ---------- trạng thái sản xuất PO nội bộ (Unplan / RMA): chọn nhiều PO → chuyển trạng thái → Leader giao nhận ký ---------- */
async function intStatusDialog() {
  const list = (lpData?.active || []).filter(p => lpSel.has(p.po) && p.intStatus);
  if (!list.length) return toast('Chọn PO nội bộ (ô vuông cạnh số PO).', 'error');
  let msg = '', st = '', signer = rcSigner() || (sp('lineSign') ? me.username : '');
  for (;;) {
    const body = `${msg ? `<p class="message error">${esc(msg)}</p>` : ''}
      <div class="rc-int-list">${list.map(p => `<div><b>${esc(p.po)}</b> <span class="pill ${RC_INT_TONE[p.intStatus] || 'muted'}">${esc(RC_INT[p.intStatus] || p.intStatus)}</span> <small class="muted">${(IPO_LABEL[p.poType] || p.poType)} · ${esc(short(p.model))} · ${fmt(p.planQty)} ea</small></div>`).join('')}</div>
      <fieldset class="rc-int-st"><legend>Chuyển sang</legend>${Object.entries(RC_INT).map(([k, v]) => `<label class="check"><input type="radio" name="status" value="${k}" ${k === st ? 'checked' : ''} required> ${v}</label>`).join('')}</fieldset>
      <p class="hint">Hoàn thành = đã sản xuất đủ số lượng, Remain về 0 (PO sang danh sách PO đã xong).</p>
      <label>Mã NV Leader giao nhận<input name="signer" value="${esc(signer)}" required autocomplete="off" autocapitalize="characters"></label>
      <label>Mật khẩu cấp 2<input name="pin2" type="password" required autocomplete="off"></label>`;
    const v = await confirmDialog(`Trạng thái ${list.length} PO nội bộ · ${prodLine}`, body, 'Xác nhận');
    if (!v) return;
    st = v.status; signer = String(v.signer || '').trim().toUpperCase();
    let r; try { r = await api('/api/prod/internal-status', { json: { line: prodLine, pos: list.map(p => p.po), status: v.status, signer, pin2: v.pin2 } }); } catch (e) { msg = e.message; continue; }
    if (r.ok === false) { msg = r.message; continue; }
    rcRemember(signer); lpSel.clear(); toast(r.message, 'success');
    return loadProd();
  }
}

/* ---------- Nợ vật liệu Kho → Line: 24 giờ hoặc từ ngày đến ngày, tải Excel ---------- */
let debtState = { line: '', mode: '24h', from: '', to: '' }, debtData = null;
const PDSTATUS = { open: 'Đang nợ', partial: 'Trả một phần', paid: 'Đã trả đủ' };
const DGROUP = { REAR: 'Rear', VLDT: 'VLĐT', VLN: 'VLN' };
const dAt = t => t ? `${t.slice(11, 16)} ${dmy(t).slice(0, 5)}` : '';
function debtQuery() {
  const q = new URLSearchParams({ line: debtState.line });
  if (debtState.mode === 'range' && debtState.from && debtState.to) { q.set('from', debtState.from); q.set('to', debtState.to); }
  return q.toString();
}
async function loadPDebts() {
  const lines = prodData?.lines || [];
  $('#debtLine').innerHTML = `<option value="">Tất cả Line</option>${lines.map(l => `<option ${l.line === debtState.line ? 'selected' : ''}>${esc(l.line)}</option>`).join('')}`;
  if (!debtState.from) { debtState.to = today; debtState.from = today; $('#debtFrom').value = today; $('#debtTo').value = today; }
  debtData = await api(`/api/prod/debts?${debtQuery()}`);
  renderPDebts();
}
function renderPDebts() {
  const d = debtData, k = d.kpi;
  const period = d.mode === 'range' ? `${dmy(d.from)} – ${dmy(d.to)}` : '24 giờ qua';
  const head = `<div class="debt-kpi">
    <span class="dk ${k.open ? 'bad' : ''}"><b>${k.open}</b> mã đang nợ${k.rear ? ` · <b>${k.rear}</b> Rear` : ''}</span>
    <span class="dk"><b>${fmt(k.remain)}</b> ea còn nợ</span>
    <span class="dk muted">${period}: phát sinh <b>${k.opened}</b> · lượt trả <b>${k.settled}</b></span></div>`;
  const rows = d.rows.map(r => `<tr class="ds-${r.status}">
      <td>${esc(r.line)}</td><td><b>${esc(r.kit)}</b></td><td>${r.code ? esc(codeTail(r.code)) : '<span class="muted">–</span>'}</td>
      <td><b>${esc(r.material)}</b>${r.description ? `<small class="desc">${esc(r.description)}</small>` : ''}</td>
      <td><span class="pill group-${r.group}">${DGROUP[r.group] || esc(r.group)}</span></td>
      <td class="num">${fmt(r.debt)}</td><td class="num">${r.paid ? fmt(r.paid) : '<span class="muted">0</span>'}${r.lots?.length ? `<small class="sub-cell" title="${esc(r.lots.map(l => `${l.lotNo} ${fmt(l.qty)} · ${LOT_ST[l.status][0]}${l.signer ? ` · ${l.signer}` : ''}`).join('\n'))}">${r.lots.length} đợt${r.unsigned ? ` · <b class="warn-text">${r.unsigned} chưa ký</b>` : ''}</small>` : ''}</td><td class="num"><b>${r.remain ? fmt(r.remain) : '0'}</b></td>
      <td>${esc(dAt(r.openedAt))}${r.status !== 'paid' && r.hours >= 1 ? ` <small class="muted">· nợ ${r.hours}h</small>` : ''}</td>
      <td>${r.lastPaidAt ? esc(dAt(r.lastPaidAt)) : '<span class="muted">–</span>'}</td>
      <td><span class="dst dst-${r.status}">${PDSTATUS[r.status]}</span></td></tr>`).join('');
  const ev = d.events.length ? `<details class="debt-ev"><summary>Từng lượt phát sinh / trả trong kỳ (${d.events.length})</summary>
    ${d.events.map(e => `<div class="dev"><span class="muted">${esc(dAt(e.at))}</span><span class="dst ${e.type === 'open' ? 'dst-open' : 'dst-paid'}">${e.type === 'open' ? 'Phát sinh' : `Bù${e.lot ? ` B${esc(e.lot.split('-B').pop())}` : ''}`}</span><b>${esc(e.material)}</b><span>${fmt(e.qty)} ea</span><span class="muted">${esc(e.line)} · ${esc(e.kit)} · ${esc(e.by)}${e.lotStatus ? ` · ${LOT_ST[e.lotStatus][0]}${e.signer ? ` ${esc(e.signer)}` : ''}` : ''}</span></div>`).join('')}</details>` : '';
  const cards = d.rows.map(r => `<div class="dcard ds-${r.status}"><div class="dc-h"><b>${esc(r.material)}</b><span class="pill group-${r.group}">${DGROUP[r.group] || esc(r.group)}</span><span class="dst dst-${r.status}">${PDSTATUS[r.status]}</span></div>
      <div class="dc-m"><span>${esc(r.line)} · ${esc(r.kit)}${r.code ? ` · ${esc(codeTail(r.code))}` : ''}</span><span>Còn <b>${fmt(r.remain)}</b> / ${fmt(r.debt)}${r.lots?.length ? ` · ${r.lots.length} đợt bù${r.unsigned ? ` (${r.unsigned} chưa ký)` : ''}` : ''}</span></div>
      <div class="dc-t muted">Phát sinh ${esc(dAt(r.openedAt))}${r.lastPaidAt ? ` · trả ${esc(dAt(r.lastPaidAt))}` : ''}</div></div>`).join('');
  $('#debtBody').innerHTML = head + (d.rows.length ? `<div class="dcards">${cards}</div><div class="table-wrap po-wrap-any debt-tw"><table class="debt-table"><thead><tr><th>Line</th><th>PO / Kit</th><th>Code</th><th>Mã vật liệu</th><th>Nhóm</th><th class="num">Nợ</th><th class="num">Đã trả</th><th class="num">Còn</th><th>Phát sinh</th><th>Trả gần nhất</th><th>Trạng thái</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty">Không có mã nợ ${debtState.line ? `của ${esc(debtState.line)} ` : ''}trong ${period}</p>`) + ev;
}
function gotoDebt(line) {
  debtState.line = line || ''; $('#prodDebt').hidden = false;
  loadPDebts().then(() => $('#prodDebt').scrollIntoView({ behavior: 'smooth', block: 'start' })).catch(err => toast(err.message, 'error'));
}
async function exportDebts() {
  await needExcel();
  const d = debtData; if (!d) return;
  const wb = new ExcelJS.Workbook(); wb.creator = me.username; wb.created = new Date();
  const sheet = (name, cols, rows) => {
    const ws = wb.addWorksheet(name); ws.columns = cols.map(([header, key, width]) => ({ header, key, width: width || 12 })); ws.addRows(rows);
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF174EA6' } }; ws.views = [{ state: 'frozen', ySplit: 1 }];
  };
  const t = x => x ? `${dmy(x)} ${x.slice(11, 16)}` : '';
  sheet('Nợ vật liệu', [['Line', 'line', 10], ['PO / Kit', 'kit', 16], ['Model Code', 'code', 14], ['Mã vật liệu', 'material', 16], ['Mô tả', 'description', 30], ['Nhóm', 'g', 8], ['Nợ', 'debt', 9], ['Đã trả', 'paid', 9], ['Còn nợ', 'remain', 9], ['Phát sinh', 'o', 17], ['Người giao', 'openedBy', 11], ['Trả gần nhất', 'p', 17], ['Người trả', 'lastPaidBy', 11], ['Trạng thái', 's', 13]],
    d.rows.map(r => ({ ...r, g: DGROUP[r.group] || r.group, o: t(r.openedAt), p: t(r.lastPaidAt), s: PDSTATUS[r.status] })));
  sheet('Lịch sử', [['Thời gian', 'a', 17], ['Loại', 'ty', 10], ['Line', 'line', 10], ['PO / Kit', 'kit', 16], ['Model Code', 'code', 14], ['Mã vật liệu', 'material', 16], ['Nhóm', 'g', 8], ['SL', 'qty', 9], ['Người', 'by', 11]],
    d.events.map(e => ({ ...e, a: t(e.at), ty: e.type === 'open' ? 'Phát sinh' : 'Trả', g: DGROUP[e.group] || e.group })));
  const name = `NoVatLieu_${d.line || 'TatCa'}_${d.mode === 'range' ? `${d.from}_${d.to}` : '24h'}.xlsx`.replace(/\s+/g, '');
  if (await saveBlob(name, new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))) toast('Đã tải file Excel', 'success');
}
$('#debtLine').addEventListener('change', e => { debtState.line = e.target.value; loadPDebts().catch(err => toast(err.message, 'error')); });
$('#debtMode').addEventListener('click', e => {
  const b = e.target.closest('[data-m]'); if (!b) return;
  debtState.mode = b.dataset.m; $$('#debtMode button').forEach(x => x.classList.toggle('active', x === b)); $('#debtRange').hidden = debtState.mode !== 'range';
  if (debtState.mode === '24h') loadPDebts().catch(err => toast(err.message, 'error'));
});
$('#debtGo').addEventListener('click', () => { debtState.from = $('#debtFrom').value; debtState.to = $('#debtTo').value; if (!debtState.from || !debtState.to) return toast('Chọn đủ từ ngày – đến ngày', 'error'); loadPDebts().catch(err => toast(err.message, 'error')); });
$('#debtXlsx').addEventListener('click', () => exportDebts().catch(err => toast(err.message, 'error')));

/* ---------- GIAO BÙ THEO ĐỢT: Leader giao nhận ký nhận nhiều đợt 1 lần (Mã NV + MK cấp 2) hoặc từ chối có lý do ---------- */
const LOT_ST = { pending: ['Chờ ký nhận', 'warn'], received: ['✓ Đã nhận', 'ok'], rejected: ['✕ Từ chối · chờ Kho', 'bad'] };
const lotTail = l => l.lotNo.slice(l.kit.length + 1);
async function lotDialog(line, kitId) {
  let d = await api(`/api/prod/lots?line=${encodeURIComponent(line)}`);
  let msg = '', signer = rcSigner() || (sp('lineSign') ? me.username : ''), act = 'receive', reason = '', note = '';
  for (;;) {
    const rows = d.rows.filter(l => !kitId || l.kitId === Number(kitId)), pend = rows.filter(l => l.status === 'pending'), canAct = can('prod') && pend.length;
    const body = `${msg ? `<p class="message error">${esc(msg)}</p>` : ''}
      <div class="lot-list">${rows.map(l => `<div class="lot-it lot-${l.status}">
        <div class="lot-h">${l.status === 'pending' && canAct ? `<label class="check lot-ck"><input type="checkbox" name="l${l.id}" checked></label>` : ''}<b>${esc(l.kit)}</b> <span class="pill info">${esc(lotTail(l))}</span> <span class="pill ${LOT_ST[l.status][1]}">${LOT_ST[l.status][0]}</span>
          <small class="muted">Kho ${esc(l.createdBy)} · ${esc(localTime(l.createdAt))}${l.status === 'received' ? ` · ${esc(l.signerName || l.signer)} nhận ${esc(localTime(l.signedAt))}` : ''}${l.status === 'rejected' ? ` · ${esc(RC_REASON[l.reason] || l.reason)}${l.note ? `: ${esc(l.note)}` : ''}` : ''}${l.khoNote ? ` · Kho xử lý: ${esc(l.khoNote)}` : ''}</small></div>
        <div class="lot-items">${l.items.map(i => `<span><b>${esc(i.material)}</b> ${RC_GRP[i.group] || ''} <b class="big-num">${fmt(i.qty)}</b></span>`).join('')}</div></div>`).join('') || '<p class="empty">Không có đợt giao bù</p>'}</div>
      ${canAct ? `<fieldset class="rc-int-st"><legend>Leader giao nhận</legend><label class="check"><input type="radio" name="act" value="receive" ${act === 'receive' ? 'checked' : ''}> ✓ Ký nhận đợt đã chọn</label><label class="check"><input type="radio" name="act" value="reject" ${act === 'reject' ? 'checked' : ''}> ✕ Từ chối, báo Kho</label></fieldset>
        <label>Lý do từ chối (khi từ chối)<select name="reason"><option value="">–</option>${Object.entries(RC_REASON).map(([v, t]) => `<option value="${v}" ${v === reason ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label>Ghi chú<input name="note" maxlength="300" value="${esc(note)}"></label>
        <div class="rc-sign"><label>Mã NV Leader giao nhận<input name="signer" value="${esc(signer)}" required autocomplete="off" autocapitalize="characters"></label><label>Mật khẩu cấp 2<input name="pin2" type="password" required autocomplete="off"></label></div>` : ''}`;
    const v = await confirmDialog(`Giao bù · ${line}${pend.length ? ` · ${pend.length} đợt chờ nhận` : ''}`, body, canAct ? 'Xác nhận' : null, 'wide');
    if (!v || !canAct) return;
    act = v.act || 'receive'; reason = v.reason || ''; note = String(v.note || '').trim(); signer = String(v.signer || '').trim().toUpperCase();
    const ids = pend.filter(l => v[`l${l.id}`]).map(l => l.id);
    if (!ids.length) { msg = 'Chọn ít nhất 1 đợt.'; continue; }
    if (act === 'reject' && !reason) { msg = 'Chọn lý do từ chối.'; continue; }
    if (act === 'reject' && reason === 'OTHER' && !note) { msg = 'Lý do "Khác" cần ghi chú.'; continue; }
    let r; try { r = await api('/api/prod/lots/receive', { json: { line, ids, reject: act === 'reject', reason, note, signer, pin2: v.pin2 } }); } catch (e) { msg = e.message; continue; }
    if (r.ok === false) { msg = r.message; continue; }
    rcRemember(signer); toast(r.message, act === 'reject' ? 'error' : 'success');
    return loadProd();
  }
}
const RC_REASON = { SHORT: 'Thiếu số lượng so với phiếu', OVER: 'Thừa số lượng so với phiếu', WRONG: 'Sai mã / lẫn vật liệu', DAMAGED: 'Vật liệu lỗi / hỏng', NO_REAR: 'Thiếu Rear', OTHER: 'Khác' };

/* ---------- PO SẴN GIAO: bấm ô Kho ở Tổng quan Line → PO cùng Model Kho đã / đang chuẩn bị ---------- */
const RDY_TONE = { ready: 'ok', blocked: 'bad', progress: 'warn', pending: 'muted' };
async function openReadyList(line) {
  const d = await api(`/api/prod/ready?line=${encodeURIComponent(line)}`), c = d.count;
  const rows = d.rows.map(u => `<tr class="rdy-${u.stage}"><td><b>${esc(u.code)}</b>${u.kind === 'merged' ? ` <span class="pill merged">${u.pos.length} PO</span>` : ''}${u.fixedLine ? ` <span class="pill warn">${esc(u.fixedLine)}</span>` : ''}${u.planLine && !u.fixedLine ? ` <span class="pill info">→ ${esc(u.planLine)}</span>` : ''}${u.pos.length > 1 ? `<span class="sub-cell">${esc(u.pos.join(', '))}</span>` : ''}</td>
    <td>${esc((u.codes || []).map(codeTail).join(', '))}<span class="sub-cell">${u.mrank ? `Kho #${u.mrank}` : ''}${u.behind ? ' · <b class="bad-text">xếp muộn</b>' : ''}</span></td><td class="num">${fmt(u.qty)}</td>
    <td><span class="kst kst-${u.stage === 'ready' ? 'done' : u.stage === 'blocked' ? 'blocked' : u.stage}">${PSTAGE[u.stage]}</span>${u.stage === 'blocked' ? `<span class="sub-cell bad-text">${esc(u.why)}</span>` : ''}${u.short && u.stage !== 'pending' ? `<span class="sub-cell warn-text">thiếu ${u.short} mã → giao 1 phần</span>` : ''}</td>
    <td class="num">VLN ${u.vln}%<span class="sub-cell">HV ${u.hv}%</span></td><td>${u.planStart ? `${esc(pAt(u.planStart))}${u.late ? ' <b class="bad-text">trễ</b>' : ''}` : '<span class="muted">–</span>'}</td></tr>`).join('');
  await confirmDialog(`PO chờ giao · ${line}${d.model ? ` · ${short(d.model)}` : ''}`, d.model ? `<p><span class="pill ok">Sẵn giao ${c.ready}</span> <span class="pill bad">Chưa giao được ${c.blocked}</span> <span class="pill warn">Đang kitting ${c.progress}</span> <span class="pill muted">Chưa kitting ${c.pending}</span></p>
    <div class="table-scroll"><table class="grid small"><thead><tr><th>PO / Kit</th><th>Code</th><th class="num">SL</th><th>Kho</th><th class="num">Kitting</th><th>Start</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">Chưa có PO nào lập KH</td></tr>'}</tbody></table></div>` : '<p class="empty">Line không chạy ca này</p>', null, 'wide');
}
