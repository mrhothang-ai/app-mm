// Bảng API giai đoạn 2–3 dùng chung cho server LAN và bản chạy trên Claude.
import * as k from './kitting.mjs';
import * as rp from './report.mjs';
import { productionView, linePos, readyForLine } from './prod.mjs';
import { dispatchView } from './dispatch.mjs';
import { debtLedger } from './debt-ledger.mjs';
const KHO = ['kho', 'admin'], KIT = ['kho', 'opkho', 'admin'], LINE = ['line', 'kho', 'admin'], APPROVE = ['approver', 'admin'];
export function kittingRoutes(db) {
  return [
    { method: 'GET', path: '/api/kho/queue', handler: ({ query }) => k.kitQueue(db, query.get('grp') === 'HV' ? 'HV' : 'VLN') },
    { method: 'GET', path: '/api/kho/kit', handler: ({ query }) => k.kitDetail(db, query.get('id'), query.get('grp') === 'HV' ? 'HV' : 'VLN') },
    { method: 'POST', path: '/api/kho/print', roles: KIT, handler: ({ body, user }) => k.logPrint(db, body || {}, user.username) },
    { method: 'POST', path: '/api/kho/kit/start', roles: KIT, handler: ({ body, user }) => k.startKit(db, body || {}, user.username) },
    { method: 'POST', path: '/api/kho/kit', roles: KIT, handler: ({ body, user }) => k.saveKitting(db, body || {}, user.username) },
    { method: 'GET', path: '/api/kho/lines', handler: ({ query }) => k.lineBoard(db, query.get('day'), query.get('shift')) },
    { method: 'GET', path: '/api/kho/deliver-preview', handler: ({ query }) => k.deliveryPreview(db, query.get('id'), query.get('line')) },
    { method: 'POST', path: '/api/kho/deliver', roles: KHO, handler: ({ body, user }) => k.deliver(db, body || {}, user.username) },
    { method: 'GET', path: '/api/kho/debts', handler: () => k.debts(db) },
    { method: 'POST', path: '/api/kho/debts/settle', roles: KHO, handler: ({ body, user }) => k.settleDebt(db, body || {}, user.username) },
    { method: 'GET', path: '/api/kho/adjust', handler: ({ query }) => k.adjustOptions(db, query.get('id')) },
    { method: 'POST', path: '/api/kho/adjust', roles: KHO, handler: ({ body, user }) => k.adjust(db, body || {}, user.username) },
    { method: 'POST', path: '/api/po/internal/edit', handler: ({ body, user }) => k.editInternalPo(db, body || {}, user.username) },
    { method: 'POST', path: '/api/po/internal/cancel', handler: ({ body, user }) => k.cancelInternalPo(db, body || {}, user.username) },
    { method: 'GET', path: '/api/kho/material-summary', handler: ({ query }) => k.materialSummary(db, { to: query.get('to') || '', unplanned: query.get('unplanned') === '1' }) },
    { method: 'GET', path: '/api/kho/history', handler: ({ query }) => k.history(db, { days: Number(query.get('days')) || 7, type: query.get('type') || '' }) },
    { method: 'GET', path: '/api/supply/form', handler: ({ query }) => k.requestForm(db, query.get('line')) },
    { method: 'GET', path: '/api/supply', handler: () => k.requests(db) },
    { method: 'POST', path: '/api/supply', roles: LINE, handler: ({ body, user }) => k.createRequest(db, body || {}, user.username) },
    { method: 'POST', path: '/api/supply/decide', roles: APPROVE, handler: ({ body, user }) => k.decideRequest(db, body || {}, user.username) },
    { method: 'GET', path: '/api/report/kitting', handler: ({ query }) => rp.kittingReport(db, { from: query.get('from'), to: query.get('to') }) },
    { method: 'GET', path: '/api/report/safety', handler: ({ query }) => rp.safetyReport(db, { day: query.get('day'), shift: query.get('shift') }) },
    { method: 'GET', path: '/api/report/exceptions', handler: ({ query }) => rp.exceptionReport(db, { from: query.get('from'), to: query.get('to') }) },
    { method: 'GET', path: '/api/badges', handler: () => rp.badges(db) },
    { method: 'GET', path: '/api/kho/dispatch', handler: ({ query }) => dispatchView(db, { day: query.get('day'), shift: query.get('shift') }) },
    { method: 'GET', path: '/api/prod', handler: ({ query }) => productionView(db, { line: query.get('line'), day: query.get('day'), shift: query.get('shift') }) },
    { method: 'GET', path: '/api/prod/line', handler: ({ query }) => linePos(db, { line: query.get('line'), from: query.get('from') || '', to: query.get('to') || '' }) },
    { method: 'GET', path: '/api/prod/ready', handler: ({ query }) => readyForLine(db, query.get('line') || '') },
    { method: 'GET', path: '/api/prod/debts', handler: ({ query }) => debtLedger(db, { from: query.get('from'), to: query.get('to'), line: query.get('line') }) },
    { method: 'POST', path: '/api/supply/issue', roles: KHO, handler: ({ body, user }) => k.issueRequest(db, body || {}, user.username) }
  ];
}
