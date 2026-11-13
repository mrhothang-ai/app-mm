/// <reference path="../pb_data/types.d.ts" />
// Thời điểm MES gửi gần nhất của từng PO: bỏ qua bản tin đến muộn. Cột đã có thì bỏ qua.
migrate((app) => {
  try { app.db().newQuery("ALTER TABLE po ADD COLUMN mes_synced_at TEXT").execute(); } catch (_) { }
}, (app) => { });
