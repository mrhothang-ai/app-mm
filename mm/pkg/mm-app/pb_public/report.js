'use strict';
/* =================== BÁO CÁO (GĐ4) · badge tab · tự làm mới =================== */
let repTab = 'kitting', repData = {};
const STAGE = { pending: 'Chưa làm', progress: 'Đang làm', ready: 'Chờ giao', delivered: 'Đã giao' };
function repRange() {
  if (!$('#repTo').value) { $('#repTo').value = today; $('#repFrom').value = addDaysLocal(today, -6); }
  return { from: $('#repFrom').value, to: $('#repTo').value };
}
$('#repTabs').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (!b) return; repTab = b.dataset.r; loadReport4().catch(err => toast(err.message, 'error')); });
['#repFrom', '#repTo'].forEach(s => $(s).addEventListener('change', () => loadReport4().catch(err => toast(err.message, 'error'))));
$('#repExport').addEventListener('click', e => withBusy(e.currentTarget, exportReport));

async function loadReport4() {
  $$('#repTabs button').forEach(x => x.classList.toggle('active', x.dataset.r === repTab));
  const { from, to } = repRange();
  $('#repRange').hidden = repTab === 'safety';
  if (repTab === 'kitting') { repData.kitting = await api(`/api/report/kitting?from=${from}&to=${to}`); return renderKittingReport(repData.kitting); }
  if (repTab === 'safety') { repData.safety = await api(`/api/report/safety?day=${today}&shift=${encodeURIComponent($('#repShift')?.value || (settings.shifts || 'Ngày').split(',')[0])}`); return renderSafety(repData.safety); }
  repData.exceptions = await api(`/api/report/exceptions?from=${from}&to=${to}`); return renderExceptions(repData.exceptions);
}

function renderKittingReport(d) {
  const k = d.kpi;
  $('#repKpis').innerHTML = kpi('Lập kế hoạch', fmt(k.planned), { sub: `${fmt(k.plannedQty)} ea` }) +
    kpi('Đã giao line', fmt(k.delivered), { sub: `${fmt(k.kitted)} đã kitting xong` }) +
    kpi('Đúng kế hoạch', k.onPlan === null ? '–' : `${k.onPlan}<small>%</small>`, { tone: k.onPlan === null ? '' : k.onPlan >= 90 ? 'ok' : k.onPlan >= 70 ? 'warn' : 'bad', sub: `${k.due} PO đến hạn` }) +
    kpi('Lập KH → giao', k.leadHours === null ? '–' : `${String(k.leadHours).replace('.', ',')}<small> giờ</small>`, { sub: 'trung bình' });
  const max = Math.max(1, ...d.byDay.map(x => x.total));
  const seg = (n, cls) => n ? `<span class="sg ${cls}" data-w="${n / max * 100}%" title="${STAGE[cls]}: ${n}">${n}</span>` : '';
  const days = d.byDay.filter(x => x.total || x.day === today);
  $('#repBody').innerHTML = `
    <div class="chips-row"><span class="chip-stat"><b>${fmt(k.merged)}</b> Kit PO gộp</span><span class="chip-stat"><b>${fmt(k.bomSaved)}</b> bộ BOM tiết kiệm</span><span class="chip-stat ${k.debtKits ? 'bad' : ''}"><b>${fmt(k.debtKits)}</b> PO còn nợ · ${fmt(k.debtEa)} ea</span></div>
    <div class="card"><div class="card-head"><h2>Tiến độ theo ngày kitting</h2><span class="legend"><i class="sw st-pending"></i>Chưa làm <i class="sw st-progress"></i>Đang làm <i class="sw st-ready"></i>Chờ giao <i class="sw st-delivered"></i>Đã giao</span></div>
      ${days.map(x => `<div class="dbar"><span class="d-lbl">${weekday(x.day)} ${dmy(x.day).slice(0, 5)}</span><span class="d-track">${seg(x.delivered, 'delivered')}${seg(x.ready, 'ready')}${seg(x.progress, 'progress')}${seg(x.pending, 'pending')}</span><b>${x.total}</b></div>`).join('') || '<p class="empty">Không có PO trong khoảng này</p>'}</div>
    <div class="card"><h2>Theo Model</h2><div class="table-scroll"><table class="grid"><thead><tr><th>Model</th><th class="num">Lập KH</th><th class="num">VLN xong</th><th class="num">R+VLĐT xong</th><th class="num">Chờ giao</th><th class="num">Đã giao</th><th>Tiến độ</th><th class="num">Mã nợ</th></tr></thead><tbody>
      ${d.byModel.map(m => `<tr><td><b>${esc(short(m.model))}</b><span class="sub-cell">${fmt(m.qty)} ea</span></td><td class="num big-num">${m.planned}</td><td class="num">${m.vlnDone}</td><td class="num">${m.hvDone}</td><td class="num">${m.ready}</td><td class="num">${m.delivered}</td><td>${miniBar(m.delivered + m.ready, m.planned)}</td><td class="num ${m.debtItems ? 'neg' : ''}">${m.debtItems || '–'}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Không có</td></tr>'}
    </tbody></table></div></div>
    <details class="card"><summary><b>Chi tiết ${d.rows.length} PO</b></summary><input type="search" class="qs" data-qs="#repDetail" placeholder="Tìm PO, Model, Line"><div class="table-scroll tall"><table class="grid small" id="repDetail"><thead><tr><th>Ngày</th><th>PO / Kit</th><th>Model</th><th class="num">SL</th><th>VLN</th><th>R+VLĐT</th><th>Line</th><th>SX</th><th class="num">Nợ</th></tr></thead><tbody>
      ${d.rows.map(r => `<tr><td>${esc(dmy(r.day).slice(0, 5))}</td><td><b>${esc(r.code)}</b>${r.kind === 'merged' ? ` <span class="pill merged">${r.pos} PO</span>` : ''}</td><td>${esc(short(r.model))}</td><td class="num">${fmt(r.qty)}</td><td>${statusPill(r.vln)}</td><td>${statusPill(r.hv)}</td><td>${esc(r.line)}</td><td><i class="dot ${r.state}"></i></td><td class="num ${r.debt ? 'neg' : ''}">${r.debt || '–'}</td></tr>`).join('')}
    </tbody></table></div></details>`;
  paintBars($('#repBody'));
}

function renderSafety(d) {
  const k = d.kpi;
  $('#repKpis').innerHTML = kpi('Line đủ việc', `${k.safe}<small>/${k.running}</small>`, { tone: 'ok' }) + kpi('Cần cấp · có PO sẵn', fmt(k.warn), { tone: k.warn ? 'warn' : '' }) +
    kpi('Cần cấp · chưa có PO', fmt(k.bad), { tone: k.bad ? 'bad' : 'ok' }) + kpi('Model thiếu PO chờ cấp', fmt(k.shortModels), { tone: k.shortModels ? 'bad' : 'ok' });
  const LV = { ok: 'Đủ việc', warn: 'Cần cấp', bad: 'Nguy cơ hết việc', idle: '' };
  const span = Math.max(d.threshold * 4, ...d.lines.map(l => Math.abs(l.available)), 1);
  const pos = v => `${50 + Math.max(-50, Math.min(50, v / span * 50))}%`;
  $('#repBody').innerHTML = `<div class="card"><div class="card-head"><h2>An toàn vật liệu theo Line · hôm nay</h2><select id="repShift">${d.shifts.map(s => `<option ${s === d.shift ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
    ${d.lines.map(l => `<div class="srow lv-${l.level}">
      <div class="s-name"><b>${esc(l.line)}</b><span>${l.model ? esc(short(l.model)) : 'Không chạy'}</span>${l.model ? `<span class="s-lv">${LV[l.level]}${l.level !== 'ok' ? ` · ${l.readyPo} PO sẵn` : ''}</span>` : ''}</div>
      <div class="s-gauge" data-t="${pos(d.threshold)}"><span class="g-zero"></span><span class="g-th" data-l="${pos(d.threshold)}"></span><span class="g-val" data-l="${pos(l.available)}"></span></div>
      <div class="s-num">${l.model ? fmt(Math.round(l.available)) : '–'}</div>
      <div class="s-po" title="PO VLN chờ cấp / min–max">${l.model ? `${Array.from({ length: Math.max(l.maxPo, l.waitingPo) }, (_, i) => `<i class="pdot ${i < l.waitingPo ? 'on' : ''} ${i < l.minPo ? 'min' : ''}"></i>`).join('')}` : ''}</div>
      <div class="s-debt">${l.debt ? `<i class="badge bad">${l.debt}</i>` : ''}</div>
    </div>`).join('')}
    <div class="s-legend"><span><i class="g-th-mini"></i>Ngưỡng ${fmt(d.threshold)} · bên trái = được cấp PO</span><span><i class="pdot on"></i>PO chờ cấp</span><span><i class="pdot min"></i>Min</span><span><i class="badge bad">n</i> mã nợ</span></div></div>`;
  paintBars($('#repBody'));
  $('#repShift').onchange = () => loadReport4().catch(err => toast(err.message, 'error'));
}

function renderExceptions(d) {
  const k = d.kpi;
  $('#repKpis').innerHTML = kpi('Yêu cầu cấp', fmt(k.requests), { sub: `${fmt(k.auto)} đạt quy tắc` }) + kpi('Ngoại lệ', fmt(k.exceptions), { tone: k.exceptions ? 'warn' : 'ok', sub: `${k.approved} duyệt · ${k.rejected} từ chối · ${k.pending} chờ` }) +
    kpi('Đã cấp', `${fmt(k.issuedEa)}<small> ea</small>`) + kpi('Điều chỉnh kit', fmt(k.adjustments), { tone: k.adjustments ? 'warn' : '', sub: 'dòng mã' });
  const maxL = Math.max(1, ...d.byLine.map(x => x.total)), maxR = Math.max(1, ...d.byReason.map(x => x.ea));
  $('#repBody').innerHTML = `<div class="two-col"><div class="card"><h2>Yêu cầu theo Line</h2>${d.byLine.map(x => `<div class="hbar"><span>${esc(x.line)}</span><span class="hb-track two"><span class="hb-all" data-w="${x.total / maxL * 100}%"></span><span class="hb-exc" data-w="${x.exceptions / maxL * 100}%"></span></span><b>${x.total}</b></div>`).join('') || '<p class="empty">Chưa có</p>'}<div class="s-legend"><span><i class="sw sw-all"></i>Tổng</span><span><i class="sw sw-exc"></i>Ngoại lệ</span></div></div>
    <div class="card"><h2>Điều chỉnh kit theo lý do (ea)</h2>${d.byReason.map(x => `<div class="hbar"><span>${esc(x.label)}</span><span class="hb-track"><span data-w="${x.ea / maxR * 100}%"></span></span><b>${fmt(x.ea)}</b></div>`).join('') || '<p class="empty">Chưa có</p>'}</div></div>
    <div class="card"><div class="card-head"><h2>Ngoại lệ (không đạt quy tắc)</h2><input type="search" class="qs" data-qs="#repExc" placeholder="Tìm Line, mã"></div><div class="table-scroll"><table class="grid small" id="repExc"><thead><tr><th>Thời gian</th><th>Line</th><th>Mã</th><th class="num">SL</th><th class="num">Còn / ngưỡng</th><th>Kết quả</th><th>Người duyệt</th><th>Ghi chú</th></tr></thead><tbody>
    ${d.exceptions.map(r => `<tr><td>${esc(localTime(r.created_at))}</td><td><b>${esc(r.line)}</b></td><td>${r.kind === 'po' ? `PO ${esc(r.kit_code || '')}` : esc(r.material)}</td><td class="num">${fmt(r.qty)}</td><td class="num neg">${fmt(Math.round(r.available))} ≥ ${fmt(r.threshold)}</td><td><span class="rst rst-${r.status}">${RSTATUS[r.status]}</span></td><td>${esc(r.approved_by || '')}</td><td>${esc(r.approve_note || r.note || '')}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Không có ngoại lệ</td></tr>'}
    </tbody></table></div></div>`;
  paintBars($('#repBody'));
}

/* ---------- xuất Excel ---------- */
async function saveBlob(filename, blob) {
  try {
    const dl = window.claude && typeof window.claude.use === 'function' ? await window.claude.use('downloads') : null;
    if (dl) { try { await dl.save({ filename, data: blob }); return true; } catch (e) { if (e?.code === 'declined') return false; } }
  } catch { /* dùng cách tải thường */ }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}
async function exportReport() {
  await needExcel();
  const { from, to } = repRange();
  const [kt, sf, ex] = await Promise.all([api(`/api/report/kitting?from=${from}&to=${to}`), api(`/api/report/safety?day=${today}`), api(`/api/report/exceptions?from=${from}&to=${to}`)]);
  const wb = new ExcelJS.Workbook(); wb.creator = me.username; wb.created = new Date();
  const sheet = (name, cols, rows) => {
    const ws = wb.addWorksheet(name); ws.columns = cols.map(([header, key, width]) => ({ header, key, width: width || 14 })); ws.addRows(rows);
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF174EA6' } }; ws.views = [{ state: 'frozen', ySplit: 1 }];
  };
  const k = kt.kpi;
  sheet('Tổng quan', [['Chỉ số', 'k', 34], ['Giá trị', 'v', 18]], [
    { k: 'Khoảng thời gian', v: `${dmy(from)} – ${dmy(to)}` }, { k: 'PO lập kế hoạch', v: k.planned }, { k: 'Số lượng (ea)', v: k.plannedQty }, { k: 'Đã kitting xong', v: k.kitted }, { k: 'Đã giao line', v: k.delivered },
    { k: 'Đúng kế hoạch (%)', v: k.onPlan }, { k: 'Lập KH → giao (giờ, TB)', v: k.leadHours }, { k: 'Kit PO gộp', v: k.merged }, { k: 'Bộ BOM tiết kiệm', v: k.bomSaved }, { k: 'PO còn nợ', v: k.debtKits }, { k: 'EA nợ', v: k.debtEa },
    { k: 'Yêu cầu cấp vật liệu', v: ex.kpi.requests }, { k: 'Ngoại lệ', v: ex.kpi.exceptions }, { k: 'EA đã cấp', v: ex.kpi.issuedEa }]);
  sheet('Kitting theo ngày', [['Ngày', 'day', 12], ['Tổng', 'total'], ['Chưa làm', 'pending'], ['Đang làm', 'progress'], ['Chờ giao', 'ready'], ['Đã giao', 'delivered'], ['SL (ea)', 'qty']], kt.byDay.map(x => ({ ...x, day: dmy(x.day) })));
  sheet('Theo Model', [['Model', 'model', 18], ['Lập KH', 'planned'], ['SL (ea)', 'qty'], ['VLN xong', 'vlnDone'], ['R+VLĐT xong', 'hvDone'], ['Chờ giao', 'ready'], ['Đã giao', 'delivered'], ['Mã nợ', 'debtItems']], kt.byModel);
  sheet('Chi tiết PO', [['Ngày', 'day', 12], ['PO / Kit', 'code', 16], ['Số PO', 'pos', 8], ['Model', 'model', 16], ['Model Code', 'modelCode', 14], ['SL', 'qty'], ['VLN', 'vln'], ['R+VLĐT', 'hv'], ['Line', 'line'], ['Mã nợ', 'debt']],
    kt.rows.map(r => ({ ...r, day: dmy(r.day), vln: KSTATUS[r.vln], hv: KSTATUS[r.hv] })));
  sheet('An toàn Line', [['Line', 'line'], ['Model', 'model', 16], ['Σ Remain đã giao', 'remainSum', 16], ['Rải chuyền', 'spread'], ['Pending', 'pending'], ['Còn lại (net)', 'available', 14], ['Ngưỡng', 'threshold'], ['PO chờ cấp', 'waitingPo'], ['Mã nợ', 'debt']], sf.lines);
  sheet('Ngoại lệ', [['Thời gian', 't', 18], ['Line', 'line'], ['Mã', 'material', 16], ['SL', 'qty'], ['Còn lại (net)', 'available', 14], ['Kết quả', 's'], ['Người duyệt', 'approved_by'], ['Ghi chú', 'approve_note', 24]],
    ex.exceptions.map(r => ({ ...r, t: localTime(r.created_at), s: RSTATUS[r.status] })));
  const blob = new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  if (await saveBlob(`BaoCao_Kitting_${from}_${to}.xlsx`, blob)) toast('Đã xuất file Excel', 'success');
}

/* ---------- badge trên tab & tự làm mới ---------- */
async function refreshBadges() {
  if (!me) return;
  let b; try { b = await api('/api/badges'); } catch { return; }
  const set = (tab, n, tone) => { const el = $(`.tab[data-tab="${tab}"]`); let s = el.querySelector('.tab-badge'); if (!n) { s?.remove(); return; } if (!s) { s = document.createElement('i'); s.className = 'tab-badge'; el.append(s); } s.textContent = n; s.dataset.tone = tone; };
  set('kho', can('kho') ? b.toKit + b.ready + (b.receiptRejected || 0) : 0, can('kho') && b.receiptRejected ? 'bad' : 'warn');   // đỏ khi Line từ chối nhận PO
  set('supply', (sp('approve') ? b.pendingApproval : 0) + (can('kho') ? b.toIssue : 0), 'bad');
}
/* ---------- realtime: máy khác thao tác xong thì màn hình tự cập nhật ---------- */
function refreshActive() {
  if (!me || document.hidden || !$('#dialog').hidden) return;
  const tab = $('.tab.active')?.dataset.tab;
  refreshBadges();
  if (tab === 'kho' && !document.querySelector('#khoBody details:not([open])')) loadKho().catch(() => {});
  if (tab === 'supply') loadSupply().catch(() => {});
  if (tab === 'board' && !selected.size && !mergeMode && !document.querySelector('.sortable-chosen')) loadBoard().catch(() => {});
  if (tab === 'report') loadReport4().catch(() => {});
  if (tab === 'prod') loadProd().catch(() => {});
  if (tab === 'kitpad' && !kp) loadKitpad().catch(() => {});
}
let rtSource = null, rtTimer = 0;
function startRealtime() {
  if (rtSource || !auth.get() || typeof EventSource === 'undefined' || window.MM_DEMO) return;
  const es = new EventSource('/api/realtime'); rtSource = es;
  es.addEventListener('PB_CONNECT', async ev => {
    try {
      const { clientId } = JSON.parse(ev.data);
      await fetch('/api/realtime', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth.get() }, body: JSON.stringify({ clientId, subscriptions: ['mm_events'] }) });
    } catch { }
  });
  es.addEventListener('mm_events', () => {
    if (Date.now() - lastWriteAt < 2500) return;            // vừa tự thao tác xong thì bỏ qua lần báo của chính mình
    clearTimeout(rtTimer); rtTimer = setTimeout(refreshActive, 600);
  });
  es.onerror = () => { es.close(); rtSource = null; setTimeout(startRealtime, 10000); };
}
// Dự phòng khi mất kết nối realtime: tự làm mới mỗi 2 phút.
setInterval(() => { if (!rtSource) refreshActive(); else if (me && !document.hidden) refreshBadges(); }, window.MM_DEMO ? 45000 : 120000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshActive(); });
