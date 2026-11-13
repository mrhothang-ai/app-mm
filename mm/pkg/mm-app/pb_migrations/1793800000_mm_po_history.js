/// <reference path="../pb_data/types.d.ts" />
// Lịch sử thay đổi PO qua các lần nhập (mới / đổi số lượng / Cancel / không còn trong file nguồn).
migrate((app) => {
  app.db().newQuery("CREATE TABLE IF NOT EXISTS po_history (id INTEGER PRIMARY KEY AUTOINCREMENT, po_key TEXT NOT NULL, import_id INTEGER, kind TEXT NOT NULL, changes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))").execute();
  app.db().newQuery("CREATE INDEX IF NOT EXISTS po_history_key ON po_history(po_key, id)").execute();
}, (app) => {
  app.db().newQuery("DROP TABLE IF EXISTS po_history").execute();
});
