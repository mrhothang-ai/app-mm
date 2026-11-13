/// <reference path="../pb_data/types.d.ts" />
// Tồn vị trí (Bin), kho / vị trí, mã vật liệu và BOM mặc định lấy từ Next ERP (chỉ đọc; erp-stock.mjs). Chạy lại nhiều lần an toàn.
migrate((app) => {
  const q = sql => app.db().newQuery(sql).execute();
  q("CREATE TABLE IF NOT EXISTS erp_stock (material TEXT NOT NULL, warehouse TEXT NOT NULL, qty REAL NOT NULL DEFAULT 0, reserved REAL NOT NULL DEFAULT 0, uom TEXT, PRIMARY KEY (material, warehouse))");
  q("CREATE TABLE IF NOT EXISTS erp_wh (name TEXT PRIMARY KEY, label TEXT NOT NULL, parent TEXT, is_group INTEGER NOT NULL DEFAULT 0, wh_type TEXT, in_kho INTEGER NOT NULL DEFAULT 1)");
  q("CREATE TABLE IF NOT EXISTS erp_item (material TEXT PRIMARY KEY, name TEXT, item_group TEXT, default_loc TEXT, uom TEXT)");
  q("CREATE TABLE IF NOT EXISTS erp_bom (item TEXT PRIMARY KEY, name TEXT NOT NULL, modified TEXT, lines INTEGER NOT NULL DEFAULT 0, synced_at TEXT NOT NULL DEFAULT (datetime('now')))");
}, (app) => { });
