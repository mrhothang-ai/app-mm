/// <reference path="../pb_data/types.d.ts" />
// PO nội bộ: loại PO (SAP / UNPLAN / RMA), Line ấn định, chứng từ tham chiếu, ghi chú, người tạo. Cột đã có (cài mới) thì bỏ qua.
migrate((app) => {
  const cols = [["po_type", "TEXT NOT NULL DEFAULT 'SAP'"], ["fixed_line", "TEXT"], ["ref_doc", "TEXT"], ["note", "TEXT"], ["created_by", "TEXT"]];
  for (const c of cols) { try { app.db().newQuery("ALTER TABLE po ADD COLUMN " + c[0] + " " + c[1]).execute(); } catch (_) { } }
}, (app) => { });
