/// <reference path="../pb_data/types.d.ts" />
// Change code BOM theo ECN: log đầy đủ (người tạo / áp dụng / hủy, ngày áp dụng, kết quả).
migrate((app) => {
  app.db().newQuery(`CREATE TABLE IF NOT EXISTS bom_change (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ecn TEXT NOT NULL UNIQUE, model TEXT NOT NULL, codes TEXT NOT NULL,
    old_material TEXT NOT NULL, new_material TEXT NOT NULL, new_description TEXT, old_point REAL, new_point REAL,
    reason TEXT NOT NULL, note TEXT, effective_date TEXT NOT NULL, update_planned INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'scheduled', result TEXT,
    created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    applied_by TEXT, applied_at TEXT, cancelled_by TEXT, cancelled_at TEXT, cancel_reason TEXT)`).execute();
}, (app) => { });
