// API quản lý BOM (BOM gốc theo Model Code · BOM VLN theo Model · Rear + VLĐT) — dùng chung cho server LAN và bản chạy trên Claude.
import * as b from './bom.mjs';
import { tx, audit, fail } from './db.mjs';
import { assertBomEditable } from './erp-stock.mjs';
// BOM theo ERP (đã đồng bộ, đang bật): không sửa dòng / chép BOM trong MM — nhóm kitting, Point VLN tay, tên Model vẫn sửa được.
const PLAN = ['planner', 'admin'];
const trim = v => String(v ?? '').trim();
export function bomRoutes(db) {
  return [
    { method: 'GET', path: '/api/bom', handler: () => {
      const last = db.prepare("SELECT * FROM import_log WHERE kind = 'BOM' ORDER BY id DESC LIMIT 1").get();
      return { models: b.bomCatalog(db), missing: b.bomCoverage(db), lastImport: last ? { ...last, summary: JSON.parse(last.summary || '{}') } : null };
    } },
    { method: 'GET', path: '/api/bom/model', handler: ({ query }) => b.bomModelDetail(db, trim(query.get('model'))) },
    { method: 'POST', path: '/api/bom/row', roles: PLAN, handler: ({ body, user }) => { assertBomEditable(db); return b.saveBomRow(db, body || {}, user.username); } },
    { method: 'POST', path: '/api/bom/row/delete', roles: PLAN, handler: ({ body, user }) => { assertBomEditable(db); return b.deleteBomRow(db, body || {}, user.username); } },
    { method: 'POST', path: '/api/bom/code', roles: PLAN, handler: ({ body, user }) => { if (body?.copyFrom) assertBomEditable(db); return b.saveModelCode(db, body || {}, user.username); } },
    { method: 'POST', path: '/api/bom/code/delete', roles: PLAN, handler: ({ body, user }) => { assertBomEditable(db); return b.deleteModelCode(db, body || {}, user.username); } },
    { method: 'POST', path: '/api/bom/vln', roles: PLAN, handler: ({ body, user }) => b.saveVlnPoint(db, body || {}, user.username) },
    { method: 'POST', path: '/api/bom/group', roles: PLAN, handler: ({ body, user }) => tx(db, () => ({ ok: true, changed: b.setGroup(db, body || {}, user.username) })) },
    { method: 'POST', path: '/api/bom/model-map', roles: PLAN, handler: ({ body, user }) => {
      const code = trim(body?.modelCode), model = trim(body?.model);
      if (!code || !model) throw fail('Nhập Model Code và Model.');
      return b.saveModelCode(db, { modelCode: code, model }, user.username);
    } },
    { method: 'POST', path: '/api/bom/resuggest', roles: PLAN, handler: () => ({ ok: true, changed: tx(db, () => { const n = b.suggestGroups(db); b.rebuildVln(db); return n; }) }) }
  ];
}
