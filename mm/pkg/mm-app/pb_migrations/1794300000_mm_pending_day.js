/// <reference path="../pb_data/types.d.ts" />
// Pending của Line chỉ tính trong ngày làm việc khai báo (pending_day). Pending đang có tính cho hôm nay (giờ VN).
migrate((app) => {
  try { app.db().newQuery("ALTER TABLE line_params ADD COLUMN pending_day TEXT").execute(); } catch (_) { }
  app.db().newQuery("UPDATE line_params SET pending_day = date('now', '+7 hours') WHERE pending_qty > 0 AND pending_day IS NULL").execute();
}, (app) => { });
