'use strict';
/* =================== KHO (GĐ2) & CẤP VẬT LIỆU (GĐ3) =================== */
const canKho = () => can('kho');
const canLine = () => can('supply') || can('prod');
const canApprove = () => sp('approve');
const KSTATUS = { pending: 'Chưa làm', progress: 'Đang làm', done: 'Xong', delivered: 'Đã giao' };
const GRP_LABEL = { VLN: 'VLN', VLDT: 'VLĐT', REAR: 'Rear' };
let khoTab = 'dispatch', khoData = null, supplyData = null, supplyFilter = '';

$('#khoTabs').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; khoTab = b.dataset.k; $$('#khoTabs button').forEach(x => x.classList.toggle('active', x === b)); loadKho().catch(err => toast(err.message, 'error')); });

let khoSearchTab = '';
async function loadKho() {
  ecnAlerts(); khoRcAlerts();
  if (khoSearchTab !== khoTab) { $('#khoSearch').value = ''; khoSearchTab = khoTab; }
  $$('#khoTabs button').forEach(x => x.classList.toggle('active', x.dataset.k === khoTab));
  $('#khoSearch').closest('.list-tools').hidden = khoTab === 'dispatch';
  if (khoTab === 'dispatch') return loadDispatch();
  if (khoTab === 'VLN' || khoTab === 'HV') return loadQueue(khoTab);
  if (khoTab === 'lines') return loadLineBoard();
  if (khoTab === 'debts') return loadDebts();
  if (khoTab === 'materials') return loadMatSum();
  if (khoTab === 'stock') return loadStock();
  return loadHistory();
}

/* ---------- hàng chờ kitting ---------- */
const miniBar = (a, b) => `<span class="mini-bar"><span data-w="${b ? Math.min(100, a / b * 100) : 0}%"></span></span>`;
const statusPill = s => `<span class="kst kst-${s}">${KSTATUS[s] || s}</span>`;
async function loadQueue(grp) {
  const [q, vln] = await Promise.all([api(`/api/kho/queue?grp=${grp}`), grp === 'VLN' ? api(`/api/vln-overview?day=${today}&shift=${encodeURIComponent((settings.shifts || 'Ngày').split(',')[0])}`) : null]);
  khoData = q;
  $('#khoKpis').innerHTML = kpi('Chưa làm', fmt(q.kpi.pending)) + kpi('Đang làm', fmt(q.kpi.progress), { tone: q.kpi.progress ? 'warn' : '' }) +
    kpi(grp === 'VLN' ? 'Xong · chờ cấp' : 'Xong', fmt(q.kpi.done), { tone: 'ok' }) + kpi('Xong còn thiếu', fmt(q.kpi.short), { tone: q.kpi.short ? 'bad' : '' });
  const bars = vln && vln.rows.length ? `<div class="card"><div class="card-head"><h2>Tồn chờ cấp VLN</h2><span class="legend"><i class="sw sw-wait"></i>Chờ cấp <i class="sw sw-plan"></i>Đã lập KH <i class="tick"></i>Min</span></div><div class="vln-bars big">${vln.rows.map(r => vlnBarHtml(r, false)).join('')}</div></div>` : '';
  let lastGroup = '';
  const rows = q.rows.map(r => {
    const p = r.progress, g = r.rank ? `${r.planDay}|${r.round}` : '';
    const head = g && g !== lastGroup ? `<div class="qgroup">${esc(weekday(r.planDay))} ${esc(dmy(r.planDay).slice(0, 5))} · Lượt ${r.round}</div>` : '';
    lastGroup = g;
    return `${head}<div class="qrow" data-id="${r.id}">
      <span class="rank mrank ${r.shortModel ? 'short' : ''} ${r.behind ? 'behind' : ''}" title="${r.behind ? 'XẾP MUỘN so với Plan Start · ' : ''}Kho làm thứ ${r.rank || '–'}${r.shortModel ? ' · Model đang thiếu tồn VLN' : ''}">${esc(short(r.model))}·${r.mrank || ''}</span>
      <div class="kmain"><div class="code">${esc(r.code)}${r.kind === 'merged' ? ` <span class="pill merged">${r.pos.length} PO</span>` : ''}${(r.cancelled || []).length ? ` <span class="pill bad" title="Cancel: ${esc(r.cancelled.join(', '))}">PO hủy</span>` : ''}${(r.loadTp || []).length ? ` <span class="pill load" title="Line nhận thêm hàng thành phẩm từ Kho">🏷 +${fmt(r.loadTp.reduce((a, l) => a + l.qty, 0))} TP</span>` : ''}${r.fixedLine ? ` <span class="pill warn" title="PO nội bộ ${esc((r.internal || []).map(i => i.po).join(', '))} — chỉ giao ${esc(r.fixedLine)}">→ ${esc(r.fixedLine)}</span>` : ''}${r.planLine && !r.fixedLine ? ` <span class="pill info" title="Line dự kiến theo file kế hoạch của Planner">→ ${esc(r.planLine)}</span>` : ''}${notePill(r.notes)}</div><div class="ksub">${esc(short(r.model))} · ${(r.codes || []).length > 1 ? `${r.codes.length} code` : esc(codeTail(r.modelCode))} · ${fmt(r.qty)} ea</div>${poLine(r.pos)}</div>
      <div class="qprog">${p ? `<b>${p.full}</b>/${p.total} mã ${miniBar(p.full, p.total)}` : '<span class="muted">–</span>'}${r.rearZero ? '<span class="warn-text">Chưa có Rear</span>' : (r.rearZeroCodes || []).length ? `<span class="warn-text">${r.rearZeroCodes.map(codeTail).join(', ')} chưa có Rear</span>` : ''}${r.noBom ? '<span class="bad-text">Chưa có BOM</span>' : ''}</div>
      ${qStatus(r)}${typeof startBtn === 'function' ? startBtn(r, grp) : ''}
      ${canKho() && r.status !== 'pending' ? '<button type="button" class="more adj" aria-label="Điều chỉnh kit">⋮</button>' : ''}
    </div>`;
  }).join('');
  $('#khoBody').innerHTML = bars + `<div class="card list-card" id="khoList">${rows || '<p class="empty">Chưa có PO nào</p>'}</div>`;
  paintBars($('#khoBody'));
}
$('#khoBody').addEventListener('click', e => {
  const adj = e.target.closest('.adj, .adj-kit'); if (adj) { e.stopPropagation(); return openAdjust(adj.closest('[data-id]').dataset.id); }
  const sb = e.target.closest('.kit-start'); if (sb) { e.stopPropagation(); return kitStart(sb, loadKho); }
  const row = e.target.closest('.qrow'); if (row && (khoTab === 'VLN' || khoTab === 'HV')) return openKitting(row.dataset.id, khoTab);
  const give = e.target.closest('.give'); if (give) return openDeliver(give.dataset.line, give.dataset.model);
  const settle = e.target.closest('.settle-kit'); if (settle) return openSettleKit(settle.dataset.kit).catch(err => toast(err.message, 'error'));
});

async function openKitting(id, grp) {
  let d;
  try { d = await api(`/api/kho/kit?id=${id}&grp=${grp}`); } catch (e) { return toast(e.message, 'error'); }
  const ro = !canKho() || d.kit.status === 'delivered' ? 'disabled' : '';
  const codes = d.kit.codes || [d.kit.modelCode], multi = grp === 'HV' && codes.length > 1;
  const qtyOf = c => d.kit.pos.filter(p => p.modelCode === c).reduce((s, p) => s + p.qty, 0);
  const body = `<div class="sheet-head"><b>${esc(d.kit.code)}</b><span>${esc(short(d.kit.model))} · ${codes.length > 1 ? `${codes.length} Model Code` : esc(codeTail(d.kit.modelCode))}</span><span class="q">${fmt(d.kit.qty)} ea</span></div>
    ${poList(d.kit)}${noteBox(d.kit.notes)}${loadBox(d.kit)}${unplanBox(d.kit, grp)}
    ${ro ? '' : '<div class="btn-row"><button type="button" class="secondary" data-fill-all>Đủ tất cả</button><button type="button" class="secondary" data-clear-all>Xóa hết</button></div>'}
    <div class="table-scroll sheet"><table class="grid kit-items"><thead><tr><th></th><th>Mã</th><th class="num">Cần</th><th class="num">Đã kitting</th></tr></thead><tbody>
    ${d.items.map((it, i) => `${multi && (i === 0 || d.items[i - 1].code !== it.code) ? `<tr class="code-block"><td colspan="4">${esc(it.code)} · ${fmt(qtyOf(it.code))} ea</td></tr>` : ''}<tr class="${it.kitted >= kqTarget(it.required) ? 'full' : it.kitted > 0 ? 'part' : ''}"><td><input type="checkbox" class="tick-full" data-i="${i}" ${it.kitted >= kqTarget(it.required) ? 'checked' : ''} ${ro}></td>
      <td>${grp === 'HV' ? `<span class="pill group-${it.kitGroup}">${GRP_LABEL[it.kitGroup]}</span> ` : ''}<b>${esc(it.material)}</b><span class="sub-cell">${esc(it.description || '')}</span>${d.stockAt ? `<span class="sub-cell loc-line">${locText(it)}</span>` : ''}</td>
      <td class="num">${fmt(it.required)}${isWhole(it.required) ? '' : `<span class="sub-cell">cấp ${kqTarget(it.required)}–${kqCap(it.required)}</span>`}</td><td class="num"><input class="num kq calc" name="k${i}" data-req="${it.required}" type="text" inputmode="decimal" autocomplete="off" value="${it.kitted}" ${ro}></td></tr>`).join('')}
    </tbody></table></div>${ro ? '' : '<div class="btn-row end"><button type="button" class="secondary" data-act="save">Lưu tạm</button></div>'}`;
  const r = await confirmDialog(`Kitting ${grp === 'VLN' ? 'VLN' : 'Rear + VLĐT'}`, body, ro ? null : `Xong ${grp === 'VLN' ? 'VLN' : 'Rear + VLĐT'}`, 'wide');
  if (!r || ro) return;
  const vals = d.items.map((it, i) => calcEval(r[`k${i}`]));
  const bad = d.items.findIndex((it, i) => Number.isNaN(vals[i])); if (bad >= 0) return toast(`${d.items[bad].material}: phép tính không hợp lệ`, 'error');
  const items = d.items.map((it, i) => ({ code: it.code, material: it.material, kitted: isWhole(it.required) ? vals[i] : Math.round(vals[i]) }));
  const confirm = r.act !== 'save', nShort = d.items.filter((it, i) => items[i].kitted < kqTarget(it.required)).length;
  let why = {};
  if (confirm && nShort) { why = await askShortReason(nShort, d.kit.code); if (!why) return; }
  await withBusy(null, async () => { const x = await api('/api/kho/kit', { json: { kitId: d.kit.id, grp, items, confirm, ...why } }); toast(x.message, 'success'); await loadKho(); });
}
document.addEventListener('change', e => {
  if (e.target.matches('.tick-full')) { const tr = e.target.closest('tr'), inp = tr.querySelector('.kq'); inp.value = e.target.checked ? kqFill(Number(inp.dataset.req)) : 0; markRow(tr); }
  if (e.target.matches('.kq')) markRow(e.target.closest('tr'));
});
document.addEventListener('input', e => { if (e.target.matches('.kq')) markRow(e.target.closest('tr')); });
function markRow(tr) { const inp = tr.querySelector('.kq'), v = calcEval(inp.value) || 0, req = kqTarget(Number(inp.dataset.req)); tr.className = v >= req ? 'full' : v > 0 ? 'part' : ''; const cb = tr.querySelector('.tick-full'); if (cb) cb.checked = v >= req; }
document.addEventListener('click', e => {
  if (e.target.closest('[data-fill-all]')) $$('#dialogBody .kq').forEach(i => { i.value = kqFill(Number(i.dataset.req)); markRow(i.closest('tr')); });
  if (e.target.closest('[data-clear-all]')) $$('#dialogBody .kq').forEach(i => { i.value = 0; markRow(i.closest('tr')); });
  if (e.target.closest('[data-fill-max]')) $$('#dialogBody .aq').forEach(i => { i.value = i.max; });
});

/* ---------- giao line ---------- */
async function loadLineBoard() {
  const d = await api('/api/kho/lines'); khoData = d;
  $('#khoKpis').innerHTML = kpi('Line đang chạy', fmt(d.kpi.running)) + kpi('PO sẵn sàng giao', fmt(d.kpi.ready), { tone: d.kpi.ready ? 'ok' : 'warn' }) +
    kpi('Line cần cấp PO', fmt(d.kpi.needSupply), { tone: d.kpi.needSupply ? 'warn' : 'ok' }) + kpi('PO còn nợ', fmt(d.kpi.debt), { tone: d.kpi.debt ? 'bad' : '', act: d.kpi.debt ? 'kho:debts' : '' });
  $('#khoBody').innerHTML = `<div class="line-grid" id="khoList">${d.lines.map(l => {
    const s = l.supply, tone = !l.model ? '' : !s.pass ? 'ok' : l.readyCount ? 'warn' : 'bad';
    const tag = !l.model ? '' : l.poReq ? `<span class="rst rst-${l.poReq.status}">YC#${l.poReq.id} ${l.poReq.status === 'approved' ? 'đã duyệt' : 'chờ duyệt'}</span>` : s.pass ? '<span class="rst rst-approved">Được cấp PO</span>' : '<span class="rst rst-issued">Đủ việc</span>';
    return `<div class="line-card ${l.model ? '' : 'idle'}">
      <div class="lc-head"><b>${esc(l.line)}</b><span>${l.model ? esc(short(l.model)) : 'Không chạy'}</span></div>
      <div class="lc-num ${tone}" title="Σ Remain PO đã giao − rải chuyền − pending; nhỏ hơn ngưỡng thì được cấp PO">${fmt(Math.round(s.available))}<small>${s.pass ? '&lt;' : '≥'} ${fmt(s.threshold)}</small></div>
      <div class="lc-tag">${tag}</div>
      <div class="lc-sub">Remain ${fmt(s.remainSum)} · rải ${fmt(s.spread)} · pending ${fmt(s.pending)}</div>
      <div class="lc-pos">${l.running.map(k => `<div data-id="${k.id}"><span><i class="dot ${k.state}"></i>${esc(k.code)}</span><span>${fmt(k.remain)}<button type="button" class="link adj-kit" aria-label="Điều chỉnh">⋮</button></span></div>`).join('') || '<span class="muted">Chưa có PO</span>'}${l.finished ? `<span class="muted">+${l.finished} PO đã xong</span>` : ''}</div>
      <div class="lc-foot"><span class="${l.readyCount ? 'ok-text' : 'muted'}">Sẵn sàng ${l.readyCount} PO</span>${sp('deliver') ? `<button type="button" class="secondary give" data-line="${esc(l.line)}" data-model="${esc(l.model)}">Giao</button>` : ''}</div>
    </div>`;
  }).join('')}</div>`;
}
$('#khoKpis').addEventListener('click', e => { const b = e.target.closest('[data-act^="kho:"]'); if (b) { khoTab = b.dataset.act.slice(4); loadKho(); } });

async function openDeliver(line, model) {
  // Kit Planner dự kiến cho Line này lên đầu, rồi cùng Model.
  const ready = khoData.ready.slice().sort((a, b) => (b.planLine === line) - (a.planLine === line) || (b.model === model) - (a.model === model) || (a.rank || 999) - (b.rank || 999));
  if (!ready.length) return toast('Chưa có PO nào xong cả 2 nhóm', 'error');
  // Kit có PO nội bộ ấn định Line khác: không chọn được.
  const why = k => !k.check.ok ? k.check.why : k.fixedLine && k.fixedLine !== line ? `ấn định ${k.fixedLine}` : '';
  const opts = ready.map(k => `<option value="${k.id}" ${why(k) ? 'disabled' : ''}>${k.mrank ? `${esc(short(k.model))}·${k.mrank} · ` : ''}${esc(k.code)} · ${fmt(k.qty)} ea${k.fixedLine === line ? ` · ${(k.internal || []).map(i => (IPO_LABEL[i.type] || i.type)).join('+')}` : ''}${k.planLine ? (k.planLine === line ? ' · ★ dự kiến Line này' : ` · dự kiến ${esc(k.planLine)}`) : ''}${k.model !== model ? ' (khác Model)' : ''}${why(k) ? ` — ${esc(why(k))}` : ''}</option>`).join('');
  const pick = await confirmDialog(`Giao cho ${line}`, `<label>PO<select name="kit">${opts}</select></label>`, 'Tiếp');
  if (!pick) return;
  let p; try { p = await api(`/api/kho/deliver-preview?id=${pick.kit}&line=${encodeURIComponent(line)}`); } catch (e) { return toast(e.message, 'error'); }
  if (p.fixedBlock) return toast(`${p.fixedBlock}, không giao cho ${line} được.`, 'error');
  const rearShort = p.rear.filter(i => i.kitted < i.required), matShort = p.material.filter(i => i.kitted < i.required), ru = p.rule;
  const ruleBox = `<div class="rule-box ${ru.pass ? 'ok' : ru.approved ? 'ok' : 'bad'}"><div class="rb-num">${fmt(Math.round(ru.available))}<small> ${ru.pass ? '&lt;' : '≥'} ${fmt(ru.threshold)}</small></div>
    <div class="rb-txt"><b>${ru.pass ? 'Được cấp PO' : ru.approved ? `Ngoại lệ đã duyệt · YC#${ru.approved}` : ru.waiting ? `Đang chờ duyệt · YC#${ru.waiting}` : 'Line còn đủ việc · cần duyệt'}</b><span class="muted">Remain ${fmt(ru.remainSum)} − rải ${fmt(ru.spread)} − pending ${fmt(ru.pending)}</span></div></div>`;
  if (!ru.canDeliver) {
    if (ru.waiting) return confirmDialog(`${p.kit.code} → ${line}`, ruleBox, null);
    const v = await confirmDialog(`${p.kit.code} → ${line}`, ruleBox + '<label>Lý do xin giao sớm<input name="note" maxlength="200" required></label>', 'Gửi duyệt');
    if (!v) return;
    return withBusy(null, async () => { const x = await api('/api/supply', { json: { kind: 'po', line, kitId: Number(pick.kit), note: v.note } }); toast(x.message, x.pass ? 'success' : 'info'); await loadKho(); });
  }
  const body = `${poList(p.kit)}${noteBox(p.kit.notes)}${loadBox(p.kit)}${ruleBox}${p.warnModel ? `<div class="alert-box">${esc(p.warnModel)}</div>` : ''}${p.warnPlanLine ? `<div class="alert-box">${esc(p.warnPlanLine)} — vẫn giao cho ${esc(line)} được</div>` : ''}
    <div class="step-grid"><div class="step ${rearShort.length ? 'warn' : 'ok'}"><b>1 · Rear</b><span>${p.rear.length - rearShort.length}/${p.rear.length} mã đủ</span></div>
    <div class="step ${matShort.length ? 'warn' : 'ok'}"><b>2 · Vật liệu</b><span>${p.material.length - matShort.length}/${p.material.length} mã đủ</span></div></div>
    ${[...rearShort, ...matShort].length ? `<p class="small-note">Ghi nợ:</p><div class="debt-list">${[...rearShort.map(i => ({ ...i, group: 'REAR' })), ...matShort].map(i => `<div><span><span class="pill group-${i.group}">${GRP_LABEL[i.group]}</span> ${esc(i.material)}${i.code ? ` <span class="muted">${esc(codeTail(i.code))}</span>` : ''}</span><b>${fmt(i.required - i.kitted)}</b></div>`).join('')}</div>` : ''}
    ${(p.check.rearZero || []).length ? `<div class="alert-box">${p.check.rearZero.map(codeTail).join(', ')} chưa có Rear — vẫn giao, ghi nợ Rear</div>` : ''}`;
  const ok = await confirmDialog(`${p.kit.code} → ${line}`, body, 'Xác nhận giao');
  if (!ok) return;
  await withBusy(null, async () => { const x = await api('/api/kho/deliver', { json: { kitId: Number(pick.kit), line } }); toast(x.message, 'success'); await loadKho(); });
}

/* ---------- nợ vật liệu ---------- */
async function loadDebts() {
  const d = await api('/api/kho/debts'); khoData = d;
  const lotsPend = d.rows.reduce((s, k) => s + (k.lots?.pending || 0), 0), lotsRej = d.rows.reduce((s, k) => s + (k.lots?.rejected || 0), 0);
  $('#khoKpis').innerHTML = kpi('PO giao 1 phần', fmt(d.kpi.kits), { tone: d.kpi.kits ? 'bad' : 'ok' }) + kpi('Mã nợ', fmt(d.kpi.items)) + kpi('Tổng nợ', `${fmt(d.kpi.ea)}<small> ea</small>`) + kpi('Nợ Rear', fmt(d.kpi.rear), { tone: d.kpi.rear ? 'bad' : '' }) +
    kpi('Đợt bù chờ Line ký', fmt(lotsPend), { tone: lotsRej ? 'bad' : lotsPend ? 'warn' : '', sub: lotsRej ? `${lotsRej} bị từ chối` : '' });
  const cards = d.rows.map(k => {
    const prep = k.items.filter(i => i.prepared > 0).length, L = k.lots || {};
    return `<div class="card debt-card" data-id="${k.kitId}"><div class="card-head"><h2>${esc(k.code)} <span class="muted">→ ${esc(k.line)}</span></h2>
      <span class="dk-st"><span class="pill warn">Giao 1 phần · nợ ${k.items.length} mã</span>${L.total ? ` <span class="pill ${L.rejected ? 'bad' : L.pending ? 'warn' : 'ok'}">${L.total} đợt bù${L.pending ? ` · ${L.pending} chờ ký` : ''}${L.rejected ? ` · ${L.rejected} từ chối` : ''}</span>` : ''}${prep ? ` <span class="pill info">OP đã soạn ${prep}/${k.items.length}</span>` : ''}</span>
      <span class="muted">${esc(localTime(k.deliveredAt))}</span>${canKho() ? `<button type="button" class="primary settle-kit" data-kit="${k.kitId}">Giao bù</button>` : ''}</div>
    ${k.items.map(i => `<div class="debt-row"><span><span class="pill group-${i.kitGroup}">${GRP_LABEL[i.kitGroup]}</span> <b>${esc(i.material)}</b>${i.code ? ` <span class="muted">${esc(codeTail(i.code))}</span>` : ''}<span class="sub-cell">${esc(i.description || '')}</span>
      <span class="sub-cell">Cần ${fmt(i.required)} · đã giao ${fmt(i.delivered)}${i.bu ? ` <b>(bù ${fmt(i.bu)} × ${i.buN} đợt)</b>` : ''}${i.prepared ? ` · <span class="ok-text">OP soạn ${fmt(i.prepared)}</span>` : ''}</span></span><span class="big-num">${fmt(i.debt)}</span></div>`).join('')}</div>`;
  }).join('');
  $('#khoBody').innerHTML = cards ? `<div id="khoList">${cards}</div>` : '<div class="card"><p class="empty">Không còn nợ vật liệu</p></div>';
}
// Giao bù 1 đợt (nhiều mã) cho 1 PO: lấy sẵn số OP kho đã soạn; số lẻ được (mã định lượng gam / mét), tối đa = nợ làm tròn lên.
async function openSettleKit(kitId) {
  const k = (khoData?.rows || []).find(x => x.kitId === Number(kitId)); if (!k) return;
  const anyPrep = k.items.some(i => i.prepared > 0);
  let msg = '', vals = k.items.map(i => anyPrep ? (i.prepared || '') : '');
  for (;;) {
    const body = `${msg ? `<p class="message error">${esc(msg)}</p>` : ''}<p class="muted">${esc(k.line)} · tạo đợt <b>${esc(k.code)}-B${(k.lots?.total || 0) + 2}</b> · Line ký nhận ở tab Sản xuất</p>
      <div class="btn-row">${anyPrep ? '<button type="button" class="secondary" data-fill-prep>Theo OP soạn</button>' : ''}<button type="button" class="secondary" data-fill-debt>Đủ tất cả</button><button type="button" class="secondary" data-clear-sq>Xóa hết</button></div>
      <div class="table-scroll sheet"><table class="grid"><thead><tr><th>Mã</th><th class="num">Nợ</th><th class="num">OP soạn</th><th class="num">Giao bù</th></tr></thead><tbody>
      ${k.items.map((i, n) => `<tr><td><span class="pill group-${i.kitGroup}">${GRP_LABEL[i.kitGroup]}</span> <b>${esc(i.material)}</b>${i.code ? ` <span class="muted">${esc(codeTail(i.code))}</span>` : ''}</td><td class="num">${fmt(i.debt)}</td>
        <td class="num">${i.prepared ? fmt(i.prepared) : '<span class="muted">–</span>'}</td><td class="num"><input class="num sq" name="q${n}" type="number" min="0" max="${i.cap}" step="any" inputmode="decimal" data-debt="${i.debt}" data-prep="${i.prepared || 0}" value="${vals[n]}"></td></tr>`).join('')}
      </tbody></table></div>`;
    const r = await confirmDialog(`Giao bù ${k.code}`, body, 'Giao bù', 'wide');
    if (!r) return;
    vals = k.items.map((i, n) => r[`q${n}`]);
    const items = k.items.map((i, n) => ({ grp: i.grp, code: i.code || '', material: i.material, cap: i.cap, qty: Number(String(r[`q${n}`] || '').replace(',', '.')) || 0 })).filter(x => x.qty > 0);
    if (!items.length) { msg = 'Nhập số giao bù cho ít nhất 1 mã.'; continue; }
    const over = items.find(x => x.qty > x.cap + 1e-9);
    if (over) { msg = `${over.material}: không quá ${fmt(over.cap)} (nợ làm tròn lên).`; continue; }
    try { const x = await api('/api/kho/debts/settle', { json: { kitId: k.kitId, items: items.map(({ cap, ...x }) => x) } }); toast(x.message, 'success'); return loadKho(); } catch (e) { msg = e.message; }
  }
}
document.addEventListener('click', e => {
  if (e.target.closest('[data-fill-debt]')) $$('#dialogBody .sq').forEach(i => { i.value = i.dataset.debt; });
  if (e.target.closest('[data-fill-prep]')) $$('#dialogBody .sq').forEach(i => { i.value = Number(i.dataset.prep) ? i.dataset.prep : ''; });
  if (e.target.closest('[data-clear-sq]')) $$('#dialogBody .sq').forEach(i => { i.value = ''; });
});
/* ---------- xác nhận xong khi còn thiếu: bắt chọn lý do (dùng chung tab Kho và tab Kitting) ---------- */
const SHORT_RS = { STOCK: 'Hết tồn / tồn không đủ', WAIT: 'Chờ hàng về', URGENT: 'Line cần gấp, giao trước', QUALITY: 'Vật liệu lỗi, chờ đổi', OTHER: 'Khác' };
async function askShortReason(n, code) {
  for (let msg = '', last = {}; ;) {
    const v = await confirmDialog(`${code}: xong khi còn thiếu ${n} mã?`, `${msg ? `<p class="message error">${esc(msg)}</p>` : ''}<p>Mã thiếu thành <b>nợ</b> khi giao Line, giao bù sau theo đợt.</p>
      <fieldset class="rc-int-st"><legend>Lý do</legend>${Object.entries(SHORT_RS).map(([k, t]) => `<label class="check"><input type="radio" name="reason" value="${k}" ${last.reason === k ? 'checked' : ''} required> ${t}</label>`).join('')}</fieldset>
      <label>Ghi chú<input name="note" maxlength="200" value="${esc(last.note || '')}" placeholder="Mã nào, khi nào có hàng…"></label>`, 'Xác nhận xong còn thiếu');
    if (!v) return null;
    last = v;
    if (v.reason === 'OTHER' && !String(v.note || '').trim()) { msg = 'Lý do "Khác" cần ghi chú.'; continue; }
    return { shortReason: v.reason, shortNote: String(v.note || '').trim() };
  }
}
const qStatus = r => r.status === 'done' && r.progress?.short ? `<span class="kst kst-short" title="Kho xác nhận xong khi còn thiếu — mã thiếu thành nợ khi giao Line">Xong · thiếu ${r.progress.short}</span>` : statusPill(r.status);

/* ---------- điều chỉnh kit ---------- */
async function openAdjust(id) {
  let o; try { o = await api(`/api/kho/adjust?id=${id}`); } catch (e) { return toast(e.message, 'error'); }
  const avail = i => o.delivered ? i.delivered : i.free;
  const rows = o.items.filter(i => avail(i) > 0);
  if (!rows.length) return toast('Kit này chưa có vật liệu để lấy lại', 'error');
  const types = o.delivered ? '<option value="recall">Thu hồi từ line</option>' : '<option value="transfer">Chuyển sang PO khác</option><option value="return">Trả về kho</option>';
  const body = `<div class="sheet-head"><b>${esc(o.kit.code)}</b><span>${esc(short(o.kit.model))} · ${esc(codeTail(o.kit.modelCode))}</span>${o.delivered ? `<span class="pill info">${esc(o.kit.line)}</span>` : ''}</div>
    <div class="form-grid"><label>Kiểu<select name="type" id="adjType">${types}</select></label>
    ${o.delivered ? '' : `<label id="adjTargetWrap">PO nhận<select name="targetId">${o.targets.map(t => `<option value="${t.id}">${t.mrank ? `·${t.mrank} ` : ''}${esc(t.code)} · ${(t.codes || [t.modelCode]).map(codeTail).join('+')}${t.sameCode ? '' : ' (chỉ nhận VLN)'}</option>`).join('') || '<option value="">Không có PO cùng Model</option>'}</select></label>`}
    <label>Lý do<select name="reasonCode">${Object.entries(o.reasons).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
    <label>Ghi chú<input name="note" maxlength="200"></label></div>
    <div class="btn-row"><button type="button" class="secondary" data-fill-max>Toàn bộ</button></div>
    <div class="table-scroll sheet"><table class="grid"><thead><tr><th>Mã</th><th class="num">${o.delivered ? 'Đã giao' : 'Đang giữ'}</th><th class="num">Lấy</th></tr></thead><tbody>
    ${rows.map((i, n) => `<tr><td><span class="pill group-${i.kitGroup}">${GRP_LABEL[i.kitGroup]}</span> <b>${esc(i.material)}</b>${i.code ? ` <span class="muted">${esc(codeTail(i.code))}</span>` : ''}</td><td class="num">${fmt(avail(i))}</td><td class="num"><input class="num aq" name="a${n}" type="number" min="0" max="${avail(i)}" step="1" value="0"></td></tr>`).join('')}
    </tbody></table></div>`;
  const r = await confirmDialog('Điều chỉnh kit', body, 'Xác nhận', 'wide');
  if (!r) return;
  const items = rows.map((i, n) => ({ grp: i.grp, code: i.code || '', material: i.material, qty: Number(r[`a${n}`]) || 0 }));
  await withBusy(null, async () => {
    const x = await api('/api/kho/adjust', { json: { kitId: o.kit.id, type: r.type, targetId: Number(r.targetId) || null, reasonCode: r.reasonCode, note: r.note, items } });
    toast(x.message, 'success'); await loadKho();
  });
}
document.addEventListener('change', e => { if (e.target.id === 'adjType') { const w = $('#adjTargetWrap'); if (w) w.hidden = e.target.value !== 'transfer'; } });

/* ---------- lịch sử & báo cáo ---------- */
let histType = '';
async function loadHistory() {
  const d = await api(`/api/kho/history?days=7&type=${histType}`);
  $('#khoKpis').innerHTML = kpi('PO đã kitting', fmt(d.kpi.kitted), { sub: '7 ngày' }) + kpi('PO đã giao', fmt(d.kpi.delivered), { sub: '7 ngày' }) +
    kpi('Lần điều chỉnh', fmt(d.kpi.adjust), { tone: d.kpi.adjust ? 'warn' : '' }) + kpi('EA điều chỉnh', fmt(d.kpi.adjustEa));
  const maxR = Math.max(1, ...d.byReason.map(r => r.ea)), maxT = Math.max(1, ...d.byType.map(r => r.ea));
  const barList = (list, max, label) => list.map(r => `<div class="hbar"><span>${esc(r[label])}</span><span class="hb-track"><span data-w="${r.ea / max * 100}%"></span></span><b>${fmt(r.ea)}</b></div>`).join('') || '<p class="empty">Chưa có</p>';
  const types = { '': 'Tất cả', kit: 'Kitting', deliver: 'Giao line', transfer_out: 'Chuyển đi', return: 'Trả kho', recall: 'Thu hồi', debt_settle: 'Giao bù', issue: 'Cấp vật liệu' };
  $('#khoBody').innerHTML = `<div class="two-col"><div class="card"><h2>Điều chỉnh theo lý do (ea)</h2>${barList(d.byReason, maxR, 'label')}</div><div class="card"><h2>Điều chỉnh theo kiểu (ea)</h2>${barList(d.byType, maxT, 'label')}</div></div>
    <div class="card"><div class="card-head"><h2>Nhật ký</h2><select id="histType">${Object.entries(types).map(([k, v]) => `<option value="${k}" ${k === histType ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="table-scroll tall"><table class="grid small" id="khoList"><thead><tr><th>Thời gian</th><th>Loại</th><th>PO</th><th>Mã</th><th class="num">SL</th><th>Liên quan</th><th>Lý do</th><th>Người</th></tr></thead><tbody>
    ${d.rows.map(r => `<tr><td>${esc(localTime(r.created_at))}</td><td><span class="tx tx-${r.type}">${esc(r.typeLabel)}</span></td><td>${esc(r.kit_code)}</td><td>${esc(r.material || '')}</td><td class="num ${r.qty < 0 ? 'neg' : ''}">${fmt(r.qty)}</td><td>${esc(r.ref_code || r.line || '')}</td><td>${esc(r.reason)}${r.note ? `<span class="sub-cell">${esc(r.note)}</span>` : ''}</td><td>${esc(r.username)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Không có</td></tr>'}
    </tbody></table></div></div>`;
  paintBars($('#khoBody'));
  $('#histType').onchange = e => { histType = e.target.value; loadHistory().catch(err => toast(err.message, 'error')); };
}

/* ---------- tổng hợp vật liệu cần kitting (theo BOM / theo Model Code) → Excel để Kho tính thiếu ---------- */
const MS = { to: '', unpl: false, grp: '', model: '', po: '', view: 'bom', data: null };
const msAdd = (a, b) => Math.round((a + b) * 1000) / 1000;
const msPos = kit => MS.data?.kitPo?.[kit] || [kit];   // PO gốc của Kit (Kit gộp có nhiều PO)
const msPoHit = (r, po) => !po || r.kit === po || msPos(r.kit).includes(po);
function msRows() { return (MS.data?.rows || []).filter(r => (!MS.grp || r.grp === MS.grp) && (!MS.model || r.model === MS.model) && msPoHit(r, MS.po)); }
// Theo PO: chỉ mã còn thiếu, gộp theo Kit + mã (VLN của Kit nhiều code cộng lại), xếp theo ngày kitting → Thứ tự Kho
const msKitOrd = (a, b) => (a.day || '9999').localeCompare(b.day || '9999') || (a.mrank ?? 1e9) - (b.mrank ?? 1e9) || a.kit.localeCompare(b.kit);
const msByPo = rows => msGroup(rows.filter(r => r.remain > 0), r => `${r.kit}\u001f${r.material}\u001f${r.grp}`).map(g => ({ ...g, codes: [...g.codeSet].sort() }))
  .sort((a, b) => msKitOrd(a, b) || (GORD[a.grp] ?? 9) - (GORD[b.grp] ?? 9) || b.remain - a.remain || a.material.localeCompare(b.material));
// ô chọn PO: Kit đơn = số PO; Kit gộp = mã Kit + từng PO gốc (chọn PO gốc hiện cả Kit vì Kho soạn theo Kit)
function msPoOptions(all) {
  const kits = msGroup(all.filter(r => !MS.model || r.model === MS.model), r => r.kit).sort(msKitOrd), out = [];
  for (const k of kits) {
    const pos = msPos(k.kit);
    if (pos.length === 1 && pos[0] === k.kit) out.push([k.kit, k.kit]);
    else { out.push([k.kit, `${k.kit} (${pos.length} PO)`]); for (const p of pos) if (p !== k.kit) out.push([p, `${p} · ${k.kit}`]); }
  }
  return out;
}
// gộp theo khóa: Cần / Đã soạn / Còn lại cộng dồn, đếm PO/Kit và Model
function msGroup(rows, keyOf) {
  const m = new Map();
  for (const r of rows) {
    const k = keyOf(r); let g = m.get(k);
    if (!g) m.set(k, g = { ...r, required: 0, kitted: 0, remain: 0, kits: new Set(), models: new Set(), codeSet: new Set() });
    g.required = msAdd(g.required, r.required); g.kitted = msAdd(g.kitted, r.kitted); g.remain = msAdd(g.remain, r.remain); g.kits.add(r.kit); g.models.add(r.model); g.codeSet.add(r.code);
  }
  return [...m.values()];
}
const msByBom = rows => msGroup(rows, r => `${r.material}\u001f${r.grp}`).sort((a, b) => b.remain - a.remain || a.material.localeCompare(b.material));
const msByCode = rows => msGroup(rows, r => `${r.code}\u001f${r.material}\u001f${r.grp}`).sort((a, b) => a.code.localeCompare(b.code) || (GORD[a.grp] ?? 9) - (GORD[b.grp] ?? 9) || a.material.localeCompare(b.material));
async function loadMatSum() {
  if (!MS.to) { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 3); MS.to = d.toISOString().slice(0, 10); }
  MS.data = await api(`/api/kho/material-summary?to=${MS.to}${MS.unpl ? '&unplanned=1' : ''}`);
  renderMatSum();
}
function renderMatSum() {
  const all = MS.data.rows, rows = msRows(), models = [...new Set(all.map(r => r.model))].sort();
  if (MS.model && !models.includes(MS.model)) MS.model = '';
  const poOpts = msPoOptions(all);
  if (MS.po && !poOpts.some(([v]) => v === MS.po)) { MS.po = ''; return renderMatSum(); }
  const bom = msByBom(rows), sum = k => rows.reduce((s, r) => msAdd(s, r[k]), 0);
  $('#khoKpis').innerHTML = kpi('PO / Kit', fmt(new Set(rows.map(r => r.kit)).size), { sub: `đến ${dmy(MS.to).slice(0, 5)}${MS.unpl ? ' + chưa lập KH' : ''}` }) + kpi('Mã vật liệu', fmt(bom.length), { sub: `${fmt(bom.filter(b => b.remain > 0).length)} mã còn phải kitting` }) +
    kpi('Cần (ea)', fmt(sum('required')), { sub: `đã soạn ${fmt(sum('kitted'))}` }) + kpi('Còn phải kitting', fmt(sum('remain')), { tone: sum('remain') ? 'warn' : '' });
  const grpOpt = [['', 'Mọi nhóm'], ['VLN', 'VLN'], ['REAR', 'Rear'], ['VLDT', 'VLĐT']].map(([v, t]) => `<option value="${v}" ${v === MS.grp ? 'selected' : ''}>${t}</option>`).join('');
  const num = (v, cls = '') => `<td class="num ${cls}">${v ? fmt(v) : '<span class="muted">–</span>'}</td>`;
  let body;
  if (MS.view === 'bom') {
    body = `<thead><tr><th>Mã vật liệu</th><th>Nhóm</th><th class="num">Cần</th><th class="num">Đã soạn</th><th class="num">Còn lại</th><th class="num">PO</th><th>Model</th></tr></thead><tbody>
      ${bom.map(b => `<tr><td><b>${esc(b.material)}</b><span class="sub-cell">${esc(b.description)}</span></td><td>${GRP_LABEL[b.grp] || b.grp}</td>${num(b.required)}${num(b.kitted)}${num(b.remain, 'big-num')}<td class="num">${b.kits.size}</td><td>${esc([...b.models].map(short).join(', '))}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Không có</td></tr>'}</tbody>`;
  } else if (MS.view === 'po') {
    const list = msByPo(rows); let last = null;
    const kitTot = new Map(); for (const b of list) { const t = kitTot.get(b.kit) || { remain: 0, n: 0 }; t.remain = msAdd(t.remain, b.remain); t.n++; kitTot.set(b.kit, t); }
    body = `<thead><tr><th>Mã vật liệu</th><th>Nhóm</th><th class="num">Cần</th><th class="num">Đã soạn</th><th class="num">Còn thiếu</th><th>Code</th></tr></thead><tbody>
      ${list.map(b => { const t = kitTot.get(b.kit), pos = msPos(b.kit), key = esc([b.kit, ...pos].join(' '));
        const head = b.kit !== last ? `<tr class="group-head code-block"><td colspan="6">${b.day ? esc(dmy(b.day).slice(0, 5)) : 'Chưa lập KH'}${b.mrank ? ` · Kho #${b.mrank}` : ''} · ${esc(b.kit)} · ${esc(short(b.model))} · thiếu ${t.n} mã · còn ${fmt(t.remain)} ea${pos.length > 1 || pos[0] !== b.kit ? `<span class="sub-cell">PO: ${esc(pos.join(' · '))}</span>` : ''}</td></tr>` : ''; last = b.kit;
        return `${head}<tr><td><b>${esc(b.material)}</b><span class="sub-cell">${esc(b.description)}</span><span hidden>${key}</span></td><td>${GRP_LABEL[b.grp] || b.grp}</td>${num(b.required)}${num(b.kitted)}${num(b.remain, 'big-num')}<td class="muted">${esc(b.codes.map(codeTail).join(', '))}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">Không còn mã thiếu</td></tr>'}</tbody>`;
  } else {
    const list = msByCode(rows); let last = null;
    const codeTot = new Map(); for (const g of msGroup(rows, r => r.code)) codeTot.set(g.code, g);
    body = `<thead><tr><th>Mã vật liệu</th><th>Nhóm</th><th class="num">Cần</th><th class="num">Đã soạn</th><th class="num">Còn lại</th><th class="num">PO</th></tr></thead><tbody>
      ${list.map(b => { const t = codeTot.get(b.code), head = b.code !== last ? `<tr class="code-block"><td colspan="6">${esc(b.code)} · ${esc(short(b.model))} · ${t.kits.size} PO/Kit · còn ${fmt(t.remain)} ea</td></tr>` : ''; last = b.code;
        return `${head}<tr><td><b>${esc(b.material)}</b><span class="sub-cell">${esc(b.description)}</span></td><td>${GRP_LABEL[b.grp] || b.grp}</td>${num(b.required)}${num(b.kitted)}${num(b.remain, 'big-num')}<td class="num">${b.kits.size}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">Không có</td></tr>'}</tbody>`;
  }
  $('#khoBody').innerHTML = `<div class="card"><div class="ms-tools">
      <label>Đến ngày kitting<input type="date" id="msTo" value="${esc(MS.to)}"></label>
      <label class="chk"><input type="checkbox" id="msUnpl" ${MS.unpl ? 'checked' : ''}>Gồm PO chưa lập KH</label>
      <select id="msGrp" aria-label="Nhóm">${grpOpt}</select>
      <select id="msModel" aria-label="Model"><option value="">Mọi Model</option>${models.map(m => `<option ${m === MS.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
      <select id="msPo" data-ta aria-label="Mọi PO"><option value="">Mọi PO</option>${poOpts.map(([v, t]) => `<option value="${esc(v)}" ${v === MS.po ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
      <div class="seg" id="msView">${[['bom', 'Theo BOM'], ['code', 'Theo Code'], ['po', 'Theo PO']].map(([v, t]) => `<button type="button" data-v="${v}" class="${MS.view === v ? 'active' : ''}">${t}</button>`).join('')}</div>
      <button type="button" class="primary" id="msXlsx">⬇ Tải Excel</button></div>
    ${msNoBomHtml()}
    <div class="table-scroll tall"><table class="grid small ms-table" id="khoList">${body}</table></div></div>`;
  const qs = $('#khoSearch').value; if (qs) $('#khoSearch').dispatchEvent(new Event('input'));
}
// PO chưa có BOM → không tính được vật liệu: gom theo Model (VLN) / Model Code (Rear + VLĐT), bấm để xem PO
function msNoBom() {
  const nb = MS.data?.noBom || [], vln = new Set(), hv = new Set();
  nb.forEach(n => n.missing.forEach(m => (n.grp === 'VLN' ? vln : hv).add(m)));
  return { pos: [...new Set(nb.map(n => n.code))], vln: [...vln].sort(), hv: [...hv].sort() };
}
function msNoBomHtml() {
  const n = msNoBom(); if (!n.pos.length) return '';
  return `<details class="ms-nobom"><summary><b>⚠ ${n.pos.length} PO chưa có BOM</b> — chưa tính vào tổng hợp</summary>
    ${n.vln.length ? `<p><b>Thiếu BOM VLN</b> (Model / Model Code): ${n.vln.map(esc).join(', ')}</p>` : ''}${n.hv.length ? `<p><b>Thiếu BOM Rear + VLĐT</b> (Model Code): ${n.hv.map(esc).join(', ')}</p>` : ''}
    <p class="muted">PO: ${n.pos.map(esc).join(', ')}</p></details>`;
}
$('#khoBody').addEventListener('change', e => {
  if (khoTab !== 'materials') return;
  const t = e.target;
  if (t.id === 'msTo' && t.value) { MS.to = t.value; loadMatSum().catch(err => toast(err.message, 'error')); }
  else if (t.id === 'msUnpl') { MS.unpl = t.checked; loadMatSum().catch(err => toast(err.message, 'error')); }
  else if (t.id === 'msGrp') { MS.grp = t.value; renderMatSum(); }
  else if (t.id === 'msModel') { MS.model = t.value; renderMatSum(); }
  else if (t.id === 'msPo') { MS.po = t.value; renderMatSum(); }
});
$('#khoBody').addEventListener('click', e => {
  if (khoTab !== 'materials') return;
  const v = e.target.closest('#msView [data-v]'); if (v) { MS.view = v.dataset.v; return renderMatSum(); }
  if (e.target.closest('#msXlsx')) withBusy(e.target.closest('#msXlsx'), msExcel);
});
// Excel 3 sheet: Theo vật liệu (cột Tồn kho để Kho điền, Thiếu = công thức) · Theo Model Code · Chi tiết PO × vật liệu
async function msExcel() {
  await needExcel();
  const rows = msRows(), wb = new ExcelJS.Workbook(), g = r => GRP_LABEL[r.grp] || r.grp;
  const sheet = (name, cols, data) => {
    const ws = wb.addWorksheet(name); ws.columns = cols.map(([header, key, width]) => ({ header, key, width }));
    data.forEach(d => ws.addRow(d)); ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6ECF5' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    cols.forEach(([, key, , fmtS]) => { if (fmtS) ws.getColumn(key).numFmt = fmtS; });
    return ws;
  };
  const N = '#,##0.###';
  const ws1 = sheet('Theo vat lieu', [['Mã vật liệu', 'material', 16], ['Mô tả', 'description', 40], ['Nhóm', 'grp', 7], ['Cần', 'required', 11, N], ['Đã soạn', 'kitted', 11, N], ['Còn phải kitting', 'remain', 15, N], ['Tồn kho', 'stock', 11, N], ['Thiếu', 'short', 11, N], ['Số PO', 'kits', 7], ['Model', 'models', 24]],
    msByBom(rows).map(b => ({ ...b, grp: g(b), kits: b.kits.size, models: [...b.models].join(', '), stock: null })));
  for (let i = 2; i <= ws1.rowCount; i++) { ws1.getCell(`H${i}`).value = { formula: `IF(G${i}="","",MAX(0,F${i}-G${i}))` }; ws1.getCell(`G${i}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7D6' } }; }
  sheet('Theo Model Code', [['Model Code', 'code', 14], ['Model', 'model', 14], ['Mã vật liệu', 'material', 16], ['Mô tả', 'description', 40], ['Nhóm', 'grp', 7], ['Cần', 'required', 11, N], ['Đã soạn', 'kitted', 11, N], ['Còn phải kitting', 'remain', 15, N], ['Số PO', 'kits', 7]],
    msByCode(rows).map(b => ({ ...b, grp: g(b), kits: b.kits.size })));
  sheet('Chi tiet', [['Ngày kitting', 'day', 12], ['Thứ tự Kho', 'mrank', 10], ['PO / Kit', 'kit', 16], ['Model', 'model', 14], ['Model Code', 'code', 14], ['Mã vật liệu', 'material', 16], ['Mô tả', 'description', 36], ['Nhóm', 'grp', 7], ['Cần', 'required', 11, N], ['Đã soạn', 'kitted', 11, N], ['Còn phải kitting', 'remain', 15, N]],
    [...rows].sort((a, b) => (a.day || '9999').localeCompare(b.day || '9999') || (a.mrank ?? 1e9) - (b.mrank ?? 1e9) || a.kit.localeCompare(b.kit) || a.code.localeCompare(b.code))
      .map(r => ({ ...r, day: r.day ? dmy(r.day) : 'Chưa lập KH', grp: g(r) }))).getColumn('kit').numFmt = '@';
  sheet('Thieu theo PO', [['Ngày kitting', 'day', 12], ['Thứ tự Kho', 'mrank', 10], ['PO / Kit', 'kit', 16], ['PO gốc', 'pos', 22], ['Model', 'model', 14], ['Model Code', 'codes', 16], ['Mã vật liệu', 'material', 16], ['Mô tả', 'description', 36], ['Nhóm', 'grp', 7], ['Cần', 'required', 11, N], ['Đã soạn', 'kitted', 11, N], ['Còn thiếu', 'remain', 12, N]],
    msByPo(rows).map(b => ({ ...b, day: b.day ? dmy(b.day) : 'Chưa lập KH', pos: msPos(b.kit).join(', '), codes: b.codes.join(', '), grp: g(b) }))).getColumn('kit').numFmt = '@';
  const nb = msNoBom();
  if (nb.pos.length) sheet('Chua co BOM', [['Loại', 'k', 22], ['Model / Model Code / PO', 'v', 60]],
    [...nb.vln.map(v => ({ k: 'Thiếu BOM VLN (Model / Code)', v })), ...nb.hv.map(v => ({ k: 'Thiếu BOM Rear + VLĐT (Code)', v })), ...(MS.data.noBom || []).map(x => ({ k: `PO chưa tính (${x.grp === 'VLN' ? 'VLN' : 'Rear + VLĐT'})`, v: x.code }))]);
  const name = `TongHop_VatLieu_den_${MS.to}${MS.unpl ? '_gomChuaLapKH' : ''}.xlsx`;
  if (await saveBlob(name, new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))) toast('Đã tải ' + name, 'success');
}

/* ---------- Line từ chối nhận PO → Kho kiểm tra, điều chỉnh (giao bù nợ / thu hồi…) rồi bấm Đã xử lý → Line quét xác nhận lại ---------- */
async function khoRcAlerts() {
  const el = $('#khoRcAlert'); if (!el) return;
  const d = await api('/api/kho/receipts').catch(() => null); if (!d) return;
  const lots = d.lots || [];
  el.hidden = !d.rows.length && !lots.length;
  el.innerHTML = (lots.length ? lotAlertHtml(lots) : '') + (!d.rows.length ? '' : `<b>✕ Line từ chối nhận ${d.rows.length} PO</b> <span class="muted">· ${d.pending} PO đang chờ Line nhận</span>${d.rows.map(r => `<div class="rc-al-it"><span><b>${esc(r.line)}</b> · <b>${esc(r.code)}</b> · ${esc(short(r.model))} — ${esc(r.reasonText)}${r.note ? `: ${esc(r.note)}` : ''} <small class="muted">${esc(r.signerName || r.signer)} · ${esc(localTime(r.at))}${r.debtItems ? ` · đang nợ ${r.debtItems} mã` : ''}</small></span><button type="button" class="secondary small" data-rcres="${r.kitId}">${can('kho') ? 'Xem · Đã xử lý' : 'Xem'}</button></div>`).join('')}`);
}
$('#khoRcAlert').addEventListener('click', e => { const l = e.target.closest('[data-lotres]'); if (l) return void khoLotResolve(Number(l.dataset.lotres)).catch(err => toast(err.message, 'error')); });
$('#khoRcAlert').addEventListener('click', e => { const b = e.target.closest('[data-rcres]'); if (b) khoResolve(Number(b.dataset.rcres)).catch(err => toast(err.message, 'error')); });
// Line từ chối đợt giao bù → Kho kiểm tra, ghi đã xử lý gì → đợt về Chờ nhận để Leader ký lại.
const lotItemsText = l => l.items.map(i => `${i.material} ${fmt(i.qty)}`).join(' · ');
function lotAlertHtml(lots) {
  return `<b>✕ Line từ chối ${lots.length} đợt giao bù</b>${lots.map(l => `<div class="rc-al-it"><span><b>${esc(l.line)}</b> · <b>${esc(l.lotNo)}</b> — ${esc(RECEIPT_RS[l.reason] || l.reason)}${l.note ? `: ${esc(l.note)}` : ''} <small class="muted">${esc(l.signerName || l.signer)} · ${esc(localTime(l.signedAt))} · ${esc(lotItemsText(l))}</small></span>${can('kho') ? `<button type="button" class="secondary small" data-lotres="${l.id}">Đã xử lý</button>` : ''}</div>`).join('')}`;
}
const RECEIPT_RS = { SHORT: 'Thiếu số lượng so với phiếu', OVER: 'Thừa số lượng so với phiếu', WRONG: 'Sai mã / lẫn vật liệu', DAMAGED: 'Vật liệu lỗi / hỏng', NO_REAR: 'Thiếu Rear', OTHER: 'Khác' };
async function khoLotResolve(id) {
  const v = await confirmDialog('Đợt giao bù bị từ chối', '<p class="hint">Kho kiểm tra, điều chỉnh (giao bù thêm / thu hồi…) rồi ghi đã xử lý gì — đợt quay về Chờ nhận để Leader ký lại.</p><label>Kho đã xử lý gì<input name="note" maxlength="300" required></label>', 'Đã xử lý · báo Line ký lại');
  if (!v) return;
  await withBusy(null, async () => { const x = await api('/api/kho/lot/resolve', { json: { id, note: v.note } }); toast(x.message, 'success'); await loadKho(); });
}
async function khoResolve(kitId) {
  const d = await api(`/api/prod/receipt?kitId=${kitId}`), r = d.receipt, T = d.totals;
  const rows = d.items.map(i => `<tr class="${i.debt > 0 ? 'rc-debt' : ''}"><td><b>${esc(i.material)}</b>${i.code ? ` <small class="muted">${esc(codeTail(i.code))}</small>` : ''}</td><td>${GRP_LABEL[i.group] || esc(i.group)}</td><td class="num">${fmt(i.required)}</td><td class="num">${fmt(i.delivered)}</td><td class="num">${i.debt > 0 ? `<b class="bad-text">${fmt(i.debt)}</b>` : '<span class="muted">0</span>'}</td></tr>`).join('');
  const body = `<p><b>${esc(d.kit.line)}</b> từ chối: <b>${esc(r.reasonText)}</b>${r.note ? ` — ${esc(r.note)}` : ''}<br><small class="muted">${esc(r.signerName || r.signer)} · ${esc(localTime(r.at))} · ${esc(short(d.kit.model))} · ${fmt(d.kit.qty)} ea${T.debtItems ? ` · đang nợ ${T.debtItems} mã / ${fmt(T.debt)} ea` : ''}</small></p>
    <div class="table-scroll rc-table-wrap"><table class="grid small rc-items"><thead><tr><th>Mã</th><th>Nhóm</th><th class="num">Cần</th><th class="num">Đã giao</th><th class="num">Còn nợ</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${can('kho') ? `<p class="hint">Điều chỉnh trước bằng tab Nợ (giao bù) hoặc ⋮ Điều chỉnh kit (thu hồi / chuyển…), rồi ghi Kho đã xử lý gì — PO quay về "Chờ nhận" để Line quét xác nhận lại.</p>
    <label>Kho đã xử lý gì<input name="note" maxlength="300" required placeholder="VD: giao bù 20 ea GH02-…"></label>` : ''}`;
  const v = await confirmDialog(`${d.kit.code} · Line từ chối nhận`, body, can('kho') ? 'Đã xử lý · báo Line nhận lại' : null, 'wide');
  if (!v || !can('kho')) return;
  await withBusy(null, async () => { const x = await api('/api/kho/receipt/resolve', { json: { kitId, note: v.note } }); toast(x.message, 'success'); await loadKho(); });
}

/* =================== CẤP VẬT LIỆU =================== */
const RSTATUS = { pending_approval: 'Chờ duyệt', approved: 'Chờ cấp', issued: 'Đã cấp', rejected: 'Từ chối' };
async function loadSupply() {
  supplyData = await api('/api/supply');
  const k = supplyData.kpi, on = f => supplyFilter === f ? 'active' : '';
  $('#supplyKpis').innerHTML = kpi('Chờ cấp', fmt(k.approved), { act: 'approved', tone: on('approved') || (k.approved ? 'warn' : '') }) + kpi('Chờ duyệt', fmt(k.pending), { act: 'pending_approval', tone: on('pending_approval') || (k.pending ? 'bad' : '') }) +
    kpi('Đã cấp hôm nay', fmt(k.issuedToday), { act: 'issued', tone: on('issued') || 'ok' }) + kpi('Ngoại lệ đã duyệt', fmt(k.exceptions));
  $('#newRequest').hidden = !canLine();
  const rows = supplyData.rows.filter(r => !supplyFilter || r.status === supplyFilter);
  $('#supplyList').innerHTML = rows.map(r => `<div class="req-card st-${r.status}" data-id="${r.id}">
    <div class="rq-top"><span><b>${esc(r.line)}</b> · ${esc(short(r.model))}</span><span class="rst rst-${r.status}">${RSTATUS[r.status]}</span></div>
    <div class="rq-mid"><span>${r.kind === 'po' ? '<span class="pill info">PO</span> ' : ''}<b>${esc(r.kind === 'po' ? (r.kit_code || r.material) : r.material)}</b><span class="sub-cell">${esc(r.kind === 'po' ? (r.status === 'issued' ? `Đã giao ${r.kit_code || ''}` : 'Xin cấp PO tiếp theo') : r.description || '')}</span></span><span class="big-num">${fmt(r.issued_qty ?? r.qty)}${r.kind === 'po' ? '<small> ea</small>' : ''}</span></div>
    <div class="rq-rule ${r.pass ? 'ok' : 'bad'}"><b>${fmt(Math.round(r.available))}</b> ${r.pass ? '&lt;' : '≥'} ${fmt(r.threshold)} <span class="muted">· ${r.pass ? 'Đạt' : 'Ngoại lệ'} · Remain ${fmt(r.remain_sum)} − rải ${fmt(r.spread)} − pending ${fmt(r.pending)}</span></div>
    <div class="rq-foot"><span class="muted">#${r.id} · ${esc(r.requested_by)} · ${esc(localTime(r.created_at))}${r.approved_by && r.approved_by !== 'Tự động' ? ` · duyệt: ${esc(r.approved_by)}` : ''}${r.approve_note ? ` · ${esc(r.approve_note)}` : ''}${r.note ? ` · ${esc(r.note)}` : ''}</span>
      <span class="btn-row">${r.status === 'pending_approval' && canApprove() ? '<button type="button" class="secondary rq-reject">Từ chối</button><button type="button" class="primary rq-approve">Duyệt</button>' : ''}${r.status === 'approved' && canKho() ? `<button type="button" class="primary rq-issue">${r.kind === 'po' ? 'Giao PO' : 'Cấp'}</button>` : ''}</span></div>
  </div>`).join('') || '<div class="card"><p class="empty">Không có yêu cầu</p></div>';
}
$('#supplyKpis').addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (!b) return; supplyFilter = supplyFilter === b.dataset.act ? '' : b.dataset.act; loadSupply().catch(err => toast(err.message, 'error')); });
$('#supplyList').addEventListener('click', async e => {
  const card = e.target.closest('.req-card'); if (!card) return;
  const r = supplyData.rows.find(x => x.id === Number(card.dataset.id));
  if (e.target.closest('.rq-approve') || e.target.closest('.rq-reject')) {
    const approve = !!e.target.closest('.rq-approve');
    const v = await confirmDialog(approve ? `Duyệt yêu cầu #${r.id}` : `Từ chối yêu cầu #${r.id}`, `<p><b>${esc(r.line)}</b> · ${r.kind === 'po' ? `xin PO ${esc(r.kit_code || '')}` : `${esc(r.material)} · ${fmt(r.qty)} ea`} · còn ${fmt(Math.round(r.available))} ≥ ngưỡng ${fmt(r.threshold)}</p><label>Ghi chú${approve ? '' : ' (bắt buộc)'}<input name="note" maxlength="200" ${approve ? '' : 'required'}></label>`, approve ? 'Duyệt' : 'Từ chối');
    if (!v) return;
    await withBusy(null, async () => { const x = await api('/api/supply/decide', { json: { id: r.id, approve, note: v.note } }); toast(x.message, 'success'); await loadSupply(); });
  }
  if (e.target.closest('.rq-issue') && r.kind === 'po') {
    khoTab = 'lines'; await showTab('kho');
    return openDeliver(r.line, r.model);
  }
  if (e.target.closest('.rq-issue')) {
    const v = await confirmDialog(`Cấp cho ${r.line}`, `<p>${esc(r.material)}</p><label>Số lượng cấp<input name="qty" type="number" min="1" step="1" value="${r.qty}" required></label>`, 'Cấp');
    if (!v) return;
    await withBusy(null, async () => { const x = await api('/api/supply/issue', { json: { id: r.id, qty: Number(v.qty) } }); toast(x.message, 'success'); await loadSupply(); });
  }
});
$('#newRequest').addEventListener('click', () => openRequest().catch(e => toast(e.message, 'error')));
// Mở hộp thoại yêu cầu cấp (dùng ở tab Cấp vật liệu và tab Sản xuất).
async function openRequest(line = '', kind = 'po', after = null) {
  const lines = (await api('/api/lines/assign?day=' + today)).rows;
  const first = line || me.line || lines.find(l => l.model)?.line || lines[0]?.line;
  const body = `<label>Line<select name="line" id="reqLine" data-ta>${lines.map(l => `<option value="${esc(l.line)}" ${l.line === first ? 'selected' : ''}>${esc(l.line)}${l.model ? ` · ${esc(short(l.model))}` : ''}</option>`).join('')}</select></label>
    <div id="reqCheck" class="req-check"></div>
    <div class="seg req-kind"><label><input type="radio" name="kind" value="po" ${kind === 'po' ? 'checked' : ''}> PO tiếp theo</label><label><input type="radio" name="kind" value="material" ${kind === 'material' ? 'checked' : ''}> Vật liệu lẻ</label></div>
    <div id="reqMatWrap" ${kind === 'material' ? '' : 'hidden'}><label>Mã vật liệu<select name="material" id="reqMat" data-ta></select></label>
    <label>Số lượng<input name="qty" id="reqQty" type="number" min="1" step="1"></label></div>
    <label>Ghi chú<input name="note" maxlength="200"></label>`;
  const p = confirmDialog('Yêu cầu cấp', body, 'Gửi yêu cầu');
  await refreshReqForm(first);
  const v = await p; if (!v) return;
  if (v.kind === 'material' && !(Number(v.qty) > 0)) return toast('Nhập số lượng', 'error');
  await withBusy(null, async () => { const x = await api('/api/supply', { json: v }); toast(x.message, x.pass ? 'success' : 'error'); supplyFilter = ''; await (after ? after() : loadSupply()); });
}
async function refreshReqForm(line) {
  const f = await api(`/api/supply/form?line=${encodeURIComponent(line)}`), s = f.supply;
  $('#reqCheck').innerHTML = s.model ? `<div class="rc-num ${s.pass ? 'ok' : 'bad'}">${fmt(Math.round(s.available))}<small> ${s.pass ? '&lt;' : '≥'} ${fmt(s.threshold)}</small></div><div class="rc-txt">${s.pass ? 'Được cấp · Kho cấp ngay' : 'Line còn đủ việc · cần duyệt'}<span class="muted">Remain ${fmt(s.remainSum)} − rải ${fmt(s.spread)} − pending ${fmt(s.pending)}</span></div>` : '<div class="rc-txt bad-text">Line chưa khai báo Model hôm nay</div>';
  $('#reqMat').innerHTML = f.materials.map(m => `<option value="${esc(m.material)}">${GRP_LABEL[m.kit_group] || ''} · ${esc(m.material)} — ${esc((m.description || '').slice(0, 28))}</option>`).join('');
}
document.addEventListener('change', e => { if (e.target.name === 'kind' && e.target.closest('.req-kind')) $('#reqMatWrap').hidden = e.target.value !== 'material'; });
document.addEventListener('change', e => { if (e.target.id === 'reqLine') refreshReqForm(e.target.value).catch(err => toast(err.message, 'error')); });

/* ---------- ĐIỀU PHỐI: cái nhìn nhanh cho quản lý Kho ---------- */
let dispData = null, dispAll = false, dispModel = '', dispOpen = '';
const DSTATUS = { now: ['Làm ngay', 'bad'], warn: ['Thiếu tồn', 'warn'], ok: ['Đủ', 'ok'], idle: ['Không chạy line', 'idle'] };
const DSTAGE = { pending: 'Chưa làm', progress: 'Đang làm', blocked: 'Chưa giao được', ready: 'Sẵn sàng' };
const hh = h => h === null || h === undefined ? '–' : `${String(h).replace('.', ',')}h`;
async function loadDispatch() {
  const d = await api('/api/kho/dispatch'); dispData = d; const k = d.kpi;
  $('#khoKpis').innerHTML =
    kpi('Line sắp hết việc · chưa có PO', fmt(k.risk.length), { tone: k.risk.length ? 'bad' : 'ok', sub: k.risk.map(r => `${esc(r.line)} ${esc(short(r.model))}${r.hoursLeft !== null ? ` ${hh(r.hoursLeft)}` : ''}`).join(' · ') }) +
    kpi('Lượt 1 chưa xong', fmt(k.round1.count), { tone: k.round1.count ? 'warn' : 'ok', sub: `${fmt(k.round1.qty)} ea` }) +
    kpi('Sẵn sàng giao', fmt(k.ready), { tone: k.ready ? 'ok' : '', act: 'kho:lines' }) +
    kpi('Nợ vật liệu', fmt(k.debt.kits), { tone: k.debt.kits ? 'bad' : 'ok', sub: k.debt.kits ? `${k.debt.items} mã${k.debt.rear ? ` · ${k.debt.rear} Rear` : ''}` : '', act: k.debt.kits ? 'kho:debts' : '' });
  renderDispatch();
}
function workRow(w) {
  return `<div class="wrow st-${w.stage}">
    <span class="rank mrank ${w.shortModel ? 'short' : ''} ${w.behind ? 'behind' : ''}" title="${w.behind ? 'XẾP MUỘN so với Plan Start · ' : ''}Kho làm thứ ${w.rank} · lượt ${w.round}">${esc(short(w.model))}·${w.mrank}</span>
    <div class="w-main"><b>${esc(w.code)}</b>${w.codes.length > 1 ? ` <span class="pill merged">${w.codes.length} code</span>` : ''}<span class="sub-cell">${fmt(w.qty)} ea · ${esc(weekday(w.planDay))} ${esc(dmy(w.planDay).slice(0, 5))} · L${w.round}${w.planStart ? ` · Start ${esc(w.planStart.slice(11, 16))} ${esc(dmy(w.planStart).slice(0, 5))}` : ''}</span>
      ${w.noBom ? '<span class="bad-text small">Chưa có BOM</span>' : ''}${w.why ? `<span class="bad-text small">${esc(w.why)}</span>` : ''}${w.rearZero.length && !w.why ? `<span class="warn-text small">${w.rearZero.map(codeTail).join(', ')} chưa có Rear</span>` : ''}</div>
    <div class="w-bars"><span>VLN</span>${miniBar(w.vlnPct, 100)}<b>${w.vlnPct}%</b><span>R+VLĐT</span>${miniBar(w.hvPct, 100)}<b>${w.hvPct}%</b></div>
    <span class="kst kst-${w.stage === 'pending' ? 'pending' : w.stage === 'progress' ? 'progress' : w.stage === 'blocked' ? 'blocked' : 'done'}">${DSTAGE[w.stage]}</span>
    ${canKho() ? `<span class="w-act"><button type="button" class="secondary small-btn" data-kit="${w.id}" data-grp="VLN">VLN</button><button type="button" class="secondary small-btn" data-kit="${w.id}" data-grp="HV" ${w.vln === 'pending' ? 'disabled' : ''}>R+VLĐT</button></span>` : ''}
  </div>`;
}
function renderDispatch() {
  const d = dispData;
  const rows = d.models.map(m => {
    const [label, tone] = DSTATUS[m.status], open = dispOpen === m.model;
    const list = d.work.filter(w => w.model === m.model);
    return `<tr class="dm-row ${open ? 'open' : ''}" data-model="${esc(m.model)}"><td><b>${esc(short(m.model))}</b></td>
      <td>${m.lines.map(l => `<span class="ln ${l.pass ? 'need' : ''}">${esc(l.line.replace('Line ', 'L'))} ${hh(l.hoursLeft)}</span>`).join(' ') || '<span class="muted">–</span>'}</td>
      <td class="num"><b class="${m.ready < m.min ? 'bad-text' : m.ready > m.max && m.max ? 'warn-text' : 'ok-text'}">${m.ready}</b> <span class="muted">(${m.min}–${m.max})</span></td>
      <td class="num">${m.vlnProg} / ${m.hvProg}${m.blocked ? ` <span class="bad-text" title="Xong nhưng chưa giao được">+${m.blocked}!</span>` : ''}</td>
      <td class="num">${m.todo} · <span class="muted">${m.todoTomorrow}</span></td>
      <td class="num ${m.unplanned ? 'warn-text' : 'muted'}">${m.unplanned}</td>
      <td><span class="dst dst-${tone}">${label}</span></td></tr>
      ${open ? `<tr class="dm-detail"><td colspan="7">${list.map(workRow).join('') || '<p class="empty">Không còn việc kitting cho Model này</p>'}</td></tr>` : ''}`;
  }).join('');
  const models = [...new Set(d.work.map(w => w.model))].sort();
  const all = !dispAll ? '' : d.days.map(day => {
    const list = d.work.filter(w => w.planDay === day.day && (!dispModel || w.model === dispModel));
    if (!list.length) return '';
    return `<details class="dday" ${day.day <= d.today ? 'open' : ''}><summary><b>${esc(weekday(day.day))} ${esc(dmy(day.day).slice(0, 5))}</b>${day.late ? ' <span class="dst dst-bad">Còn sót</span>' : ''}<span class="muted">${list.length} PO · ${fmt(list.reduce((a, w) => a + w.qty, 0))} ea</span></summary>${list.map(workRow).join('')}</details>`;
  }).join('');
  $('#khoBody').innerHTML = `<div class="card"><div class="card-head"><h2>Theo Model</h2><span class="muted">bấm 1 dòng để xem PO</span></div>
    <div class="table-scroll"><table class="grid disp-table"><thead><tr><th>Model</th><th>Line · còn việc</th><th class="num">Sẵn sàng (min–max)</th><th class="num">Đang làm VLN / R+VLĐT</th><th class="num">Chưa làm hôm nay · mai</th><th class="num">Chưa lập KH 48h</th><th>Trạng thái</th></tr></thead><tbody>${rows}</tbody></table></div></div>
    <div class="card"><div class="card-head"><h2>${dispAll ? 'Tất cả việc kitting còn lại' : '15 việc tiếp theo'}</h2>
      <span class="btn-row">${dispAll ? `<select id="dispModel" data-ta aria-label="Model"><option value="">Tất cả Model</option>${models.map(m => `<option value="${esc(m)}" ${m === dispModel ? 'selected' : ''}>${esc(short(m))}</option>`).join('')}</select>` : ''}<button type="button" class="secondary" id="dispAll">${dispAll ? 'Thu gọn 15 việc' : `Xem tất cả (${d.work.length})`}</button></span></div>
      ${dispAll ? all || '<p class="empty">Không có việc</p>' : d.next.map(workRow).join('') || '<p class="empty">Đã kitting xong hết</p>'}</div>`;
  paintBars($('#khoBody'));
}
$('#khoBody').addEventListener('click', e => {
  if (khoTab !== 'dispatch') return;
  const b = e.target.closest('[data-kit]'); if (b) return openKitting(b.dataset.kit, b.dataset.grp);
  if (e.target.closest('#dispAll')) { dispAll = !dispAll; return renderDispatch(); }
  const r = e.target.closest('.dm-row'); if (r) { dispOpen = dispOpen === r.dataset.model ? '' : r.dataset.model; renderDispatch(); }
});
$('#khoBody').addEventListener('change', e => { if (e.target.id === 'dispModel') { dispModel = e.target.value; renderDispatch(); } });


/* ---------- tồn kho theo vị trí (Next ERP, chỉ đọc) ---------- */
// Vị trí có hàng của 1 mã (tối đa 3, nhiều nhất trước) — dùng ở hộp kitting, màn soạn và phiếu in; không có tồn thì ghi vị trí mặc định.
function locText(it, max = 3) {
  const locs = (it.locs || []).filter(l => l.qty > 0).slice(0, max);
  if (!locs.length) return `<span class="loc none">📍 ${it.defaultLoc ? `${esc(it.defaultLoc)} (mặc định) · ERP không có tồn` : 'ERP chưa có vị trí'}</span>`;
  return `📍 ${locs.map(l => `<span class="loc"><b>${esc(l.loc)}</b> ${fmt(l.qty)}</span>`).join(' ')}${(it.locs || []).length > max ? ` +${it.locs.length - max}` : ''}`;
}
const STK = { view: 'mat', model: '', all: false, flag: '', data: null };
const STK_FLAG = { neg: ['bad', 'Tồn âm'], short: ['bad', 'Thiếu cho kit'], none: ['warn', 'Không có tồn'], multi: ['info', 'Nhiều vị trí'], mismatch: ['warn', 'Khác vị trí mặc định'], erpOnly: ['muted', 'Ngoài BOM'] };
async function loadStock() {
  STK.data = await api(`/api/kho/stock?all=${STK.all && STK.view !== 'model' ? 1 : 0}${STK.view === 'model' && STK.model ? `&model=${encodeURIComponent(STK.model)}` : ''}`);
  if (STK.view === 'model' && !STK.model && STK.data.models.length) { STK.model = STK.data.models[0]; return loadStock(); }
  renderStock();
}
const stkLocs = (locs, dft) => locs.length ? locs.map(l => `<span class="loc ${l.qty < 0 ? 'neg' : ''}"><b>${esc(l.loc)}</b> ${fmt(l.qty)}</span>`).join(' ') : `<span class="muted">–${dft ? ` · mặc định ${esc(dft)}` : ''}</span>`;
const stkFlags = f => f.map(x => STK_FLAG[x] ? `<span class="sflag ${STK_FLAG[x][0]}">${STK_FLAG[x][1]}</span>` : '').join('');
function renderStock() {
  const d = STK.data, k = d.kpi, model = STK.view === 'model';
  const rows = d.rows.filter(r => !STK.flag || r.flags.includes(STK.flag));
  $('#khoKpis').innerHTML = kpi('Mã BOM có tồn', `${fmt(k.withStock)}<small>/${fmt(k.bomMats)}</small>`, { sub: `${fmt(k.locs)} vị trí có hàng` }) +
    kpi('Không có tồn', fmt(k.none), { tone: k.none ? 'warn' : 'ok', act: 'stk:none' }) + kpi('Tồn âm', fmt(k.neg), { tone: k.neg ? 'bad' : 'ok', act: 'stk:neg' }) +
    (model ? kpi('Thiếu cho kit đang mở', fmt(k.short), { tone: k.short ? 'bad' : 'ok', act: 'stk:short' }) : kpi('Đang giữ trong kit', fmt(k.held), { sub: 'đã kitting chưa giao Line' }));
  const L = d.last, when = d.okAt ? localTime(d.okAt) : '';
  const info = !d.configured ? '<span class="warn-text">Chưa cấu hình kết nối Next ERP (Quản trị)</span>' : !d.stockSync ? '<span class="warn-text">Đang tắt đồng bộ tồn ERP (Quản trị)</span>'
    : L && !L.ok ? `<span class="bad-text">${esc(L.error)}</span>` : when ? `Tồn ERP lúc <b>${esc(when)}</b>${L ? ` · ${fmt(L.bins)} dòng · ${fmt(L.negBins)} bin âm` : ''}` : 'Chưa đồng bộ lần nào';
  const num = (v, cls = '') => `<td class="num ${cls}">${v ? fmt(v) : '<span class="muted">0</span>'}</td>`;
  let body;
  if (STK.view === 'loc') {
    const by = new Map();
    for (const r of rows) for (const l of r.locs) { if (!by.has(l.loc)) by.set(l.loc, []); by.get(l.loc).push({ ...r, qty: l.qty }); }
    const locs = [...by.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    body = `<thead><tr><th>Vị trí · mã vật liệu</th><th>Nhóm</th><th class="num">Tồn ERP</th><th class="num">Giữ trong kit</th><th class="num">Khả dụng</th><th>Cờ</th></tr></thead><tbody>
      ${locs.map(loc => { const list = by.get(loc); return `<tr class="code-block"><td colspan="6">📍 ${esc(loc)} · ${list.length} mã · ${fmt(list.reduce((s, r) => s + r.qty, 0))} ea</td></tr>` +
        list.map(r => `<tr><td><b>${esc(r.material)}</b><span class="sub-cell">${esc(r.description)}</span><span hidden>${esc(loc)}</span></td><td>${r.groups.map(g => GRP_LABEL[g] || g).join(', ')}</td>${num(r.qty, r.qty < 0 ? 'neg' : '')}${num(r.held)}${num(r.avail, 'big-num')}<td>${stkFlags(r.flags)}</td></tr>`).join(''); }).join('') || '<tr><td colspan="6" class="empty">Không có</td></tr>'}</tbody>`;
  } else {
    body = `<thead><tr><th>Mã vật liệu</th><th>Nhóm</th><th>Vị trí · tồn</th><th class="num">Tồn ERP</th><th class="num">Giữ trong kit</th><th class="num">Khả dụng</th>${model ? '<th class="num">Cần cho kit</th>' : ''}<th>Cờ</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="${r.flags.includes('neg') || r.flags.includes('short') ? 'has-warn' : ''}"><td><b>${esc(r.material)}</b><span class="sub-cell">${esc(r.description)}</span></td><td>${r.groups.map(g => GRP_LABEL[g] || g).join(', ')}${r.inBom ? '' : '<span class="sub-cell">ngoài BOM</span>'}</td><td class="loc-cell">${stkLocs(r.locs, r.defaultLoc)}</td>${num(r.total, r.total < 0 ? 'neg' : '')}${num(r.held)}${num(r.avail, 'big-num')}${model ? num(r.need) : ''}<td>${stkFlags(r.flags)}</td></tr>`).join('') || `<tr><td colspan="${model ? 8 : 7}" class="empty">Không có</td></tr>`}</tbody>`;
  }
  $('#khoBody').innerHTML = `<div class="card"><div class="ms-tools">
      <div class="seg" id="stkView">${[['mat', 'Theo vật liệu'], ['loc', 'Theo vị trí'], ['model', 'Theo Model']].map(([v, t]) => `<button type="button" data-v="${v}" class="${STK.view === v ? 'active' : ''}">${t}</button>`).join('')}</div>
      ${model ? `<select id="stkModel" data-ta aria-label="Model">${d.models.map(m => `<option ${m === STK.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>` : `<label class="chk"><input type="checkbox" id="stkAll" ${STK.all ? 'checked' : ''}>Cả mã ngoài BOM</label>`}
      <select id="stkFlag" aria-label="Lọc cờ"><option value="">Mọi mã</option>${Object.entries(STK_FLAG).filter(([k]) => model ? k !== 'erpOnly' : k !== 'short').map(([k, [, t]]) => `<option value="${k}" ${k === STK.flag ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <span class="erp-info">${info}</span>${canKho() && d.configured && d.stockSync ? '<button type="button" class="secondary" id="stkSync">⟳ Đồng bộ ERP</button>' : ''}</div>
    <p class="hint">Vị trí = kho con trên ERP (bỏ Line / khu vực sản xuất). Khả dụng = tồn ERP − đã kitting chưa giao Line. ERP chưa trừ tồn khi kitting — số này để Kho đối chiếu trước khi quyết định bước trừ tồn.</p>
    <div class="table-scroll tall"><table class="grid small stk-table" id="khoList">${body}</table></div></div>`;
  const qs = $('#khoSearch').value; if (qs) $('#khoSearch').dispatchEvent(new Event('input'));
}
$('#khoKpis').addEventListener('click', e => { const b = e.target.closest('[data-act^="stk:"]'); if (!b) return; const f = b.dataset.act.slice(4); STK.flag = STK.flag === f ? '' : f; renderStock(); });
$('#khoBody').addEventListener('change', e => {
  if (khoTab !== 'stock') return;
  const t = e.target;
  if (t.id === 'stkAll') { STK.all = t.checked; loadStock().catch(err => toast(err.message, 'error')); }
  else if (t.id === 'stkModel') { STK.model = t.value; loadStock().catch(err => toast(err.message, 'error')); }
  else if (t.id === 'stkFlag') { STK.flag = t.value; renderStock(); }
});
$('#khoBody').addEventListener('click', e => {
  if (khoTab !== 'stock') return;
  const v = e.target.closest('#stkView [data-v]'); if (v) { STK.view = v.dataset.v; STK.flag = ''; return loadStock().catch(err => toast(err.message, 'error')); }
  const b = e.target.closest('#stkSync'); if (b) withBusy(b, async () => { try { const r = await api('/api/kho/stock/sync', { json: {} }); r.ok ? toast(`Tồn ERP: ${fmt(r.bins)} dòng · ${fmt(r.bomMatsWithStock)}/${fmt(r.bomMats)} mã BOM có tồn`, 'success') : toast(r.error, 'error'); } finally { await loadStock(); } });
});
