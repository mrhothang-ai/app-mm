// API kế hoạch có hoàn tác + Line theo tuần — dùng chung cho server LAN và bản chạy trên Claude.
import * as planning from './planning.mjs';
import * as x from './plan-extra.mjs';
import { autoPlan, autoApply, autoScopeItems } from './plan-auto.mjs';
import { planImport, importScope } from './plan-import.mjs';
import { tx } from './db.mjs';
import { assertLineEditable } from './erp-line.mjs';
const PLAN = ['planner', 'admin'];
export function planRoutes(db) {
  const undoable = (label, scope, fn, user) => tx(db, () => x.withUndo(db, user.username, label, scope, fn));
  return [
    { method: 'GET', path: '/api/board', handler: ({ query, user }) => ({ ...planning.board(db, { from: query.get('from'), days: query.get('days') }), undo: x.lastUndo(db, user.username) }) },
    { method: 'POST', path: '/api/board/apply', roles: PLAN, handler: ({ body, user }) => {
      const cols = body?.columns || [];
      const scope = x.scopeOf(db, cols.flatMap(c => c.items || []), cols.map(c => c.day));
      return undoable('Kéo thả kế hoạch', scope, () => planning.applyColumns(db, cols, user.username), user);
    } },
    { method: 'POST', path: '/api/board/batch', roles: PLAN, handler: ({ body, user }) => {
      const day = body?.day ?? null, scope = x.scopeOf(db, body?.items || [], [day]);
      return undoable(day ? `Chuyển ${body.items.length} thẻ sang ${day.slice(8, 10)}/${day.slice(5, 7)}` : `Bỏ kế hoạch ${body.items.length} thẻ`, scope, () => x.batchMove(db, { items: body.items, day, position: body.position }, user.username), user);
    } },
    { method: 'POST', path: '/api/board/merge', roles: PLAN, handler: ({ body, user }) => {
      const scope = x.scopeOf(db, body?.items || []);
      return undoable('Gộp PO', scope, () => planning.merge(db, body?.items, user.username), user);
    } },
    { method: 'POST', path: '/api/board/split', roles: PLAN, handler: ({ body, user }) => {
      const scope = x.scopeOf(db, [{ type: 'kit', id: body?.id }]);
      return undoable('Tách Kit PO', scope, () => planning.split(db, body?.id, user.username), user);
    } },
    { method: 'POST', path: '/api/board/auto', roles: PLAN, handler: ({ body, user }) => {
      if (body?.dry) return autoPlan(db, body.opts || {});
      const sc = autoScopeItems(autoPlan(db, body?.opts || {})), scope = x.scopeOf(db, sc.items, sc.days);
      return undoable('Tự động xếp PO', scope, () => autoApply(db, body?.opts || {}, user.username), user);
    } },
    // Nhập kế hoạch kitting từ Excel của Planner (gộp theo Line + Model hoặc theo BOM Number); dry = xem trước
    { method: 'POST', path: '/api/board/import', roles: PLAN, handler: ({ body, user }) => {
      if (body?.dry) return planImport(db, body, user.username, false);
      const pv = planImport(db, body, user.username, false);
      return undoable(`Nhập KH ${pv.fileName || 'Excel'}`.slice(0, 80), importScope(db, pv), () => planImport(db, body, user.username, true), user);
    } },
    { method: 'POST', path: '/api/board/undo', roles: PLAN, handler: ({ user }) => x.undo(db, user.username) },
    { method: 'GET', path: '/api/lines/week', handler: ({ query }) => x.getWeek(db, query.get('start'), query.get('shift')) },
    { method: 'POST', path: '/api/lines/week', roles: PLAN, handler: ({ body, user }) => { assertLineEditable(db); return x.saveWeek(db, body || {}, user.username); } },
    { method: 'POST', path: '/api/lines/week/copy', roles: PLAN, handler: ({ body, user }) => { assertLineEditable(db); return x.copyWeek(db, body || {}, user.username); } },
    { method: 'POST', path: '/api/lines/manage', roles: PLAN, handler: ({ body, user }) => x.manageLine(db, body || {}, user.username) }
  ];
}
