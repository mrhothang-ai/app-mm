/// <reference path="../pb_data/types.d.ts" />
// Phiếu yêu cầu vật tư từ Next ERP → Kho kitting trên MM, kết quả soạn báo ngược ERP (erp-request.mjs). Chạy lại nhiều lần an toàn.
migrate((app) => {
  const q = sql => app.db().newQuery(sql).execute();
  q("CREATE TABLE IF NOT EXISTS erp_req (name TEXT PRIMARY KEY, kind TEXT NOT NULL, source TEXT, line TEXT, model TEXT, plan_date TEXT, stage TEXT, blocked TEXT, data TEXT, state TEXT NOT NULL DEFAULT 'open', kit_id INTEGER, conflict TEXT, warn TEXT, first_seen TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT NOT NULL DEFAULT (datetime('now')))");
  q("CREATE TABLE IF NOT EXISTS erp_sent (erp_req TEXT NOT NULL, material TEXT NOT NULL, qty REAL NOT NULL DEFAULT 0, PRIMARY KEY (erp_req, material))");
  q("CREATE TABLE IF NOT EXISTS erp_report (id INTEGER PRIMARY KEY AUTOINCREMENT, report_id TEXT NOT NULL UNIQUE, erp_req TEXT NOT NULL, rows TEXT NOT NULL, staff TEXT, status TEXT NOT NULL DEFAULT 'pending', tries INTEGER NOT NULL DEFAULT 0, error TEXT, result TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), sent_at TEXT)");
  q("CREATE INDEX IF NOT EXISTS erp_report_status ON erp_report(status, id)");
  for (const [t, c] of [['kit_order', 'erp_req'], ['po', 'erp_req'], ['material_request', 'erp_req'], ['material_request', 'erp_key']]) {
    try { q(`ALTER TABLE ${t} ADD COLUMN ${c} TEXT`); } catch (_) { }   // cột đã có thì bỏ qua
  }
}, (app) => { });
