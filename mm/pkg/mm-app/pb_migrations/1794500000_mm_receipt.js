/// <reference path="../pb_data/types.d.ts" />
// Line xác nhận nhận PO (quét QR phiếu kitting, Leader giao nhận ký MK cấp 2) + trạng thái sản xuất PO nội bộ chuyển tay.
migrate((app) => {
  const q = sql => app.db().newQuery(sql).execute();
  q(`CREATE TABLE IF NOT EXISTS kit_receipt (
    kit_id INTEGER PRIMARY KEY, kit_code TEXT NOT NULL, line TEXT, status TEXT NOT NULL DEFAULT 'pending',
    signer TEXT, signer_name TEXT, at TEXT, reason TEXT, note TEXT, snapshot TEXT,
    kho_note TEXT, kho_by TEXT, kho_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  q(`CREATE TABLE IF NOT EXISTS kit_receipt_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kit_id INTEGER NOT NULL, kit_code TEXT NOT NULL, line TEXT, action TEXT NOT NULL,
    signer TEXT, username TEXT, reason TEXT, note TEXT, snapshot TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  q('CREATE INDEX IF NOT EXISTS kit_receipt_log_kit ON kit_receipt_log(kit_id)');
  q('CREATE INDEX IF NOT EXISTS kit_receipt_status ON kit_receipt(status)');
  try { q('ALTER TABLE po ADD COLUMN int_status TEXT'); } catch (_) { }   // cột đã có (cài mới) thì bỏ qua
}, (app) => { });
