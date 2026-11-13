/// <reference path="../pb_data/types.d.ts" />
// Kết nối Next ERP (url / key / secret của tài khoản bot, cờ đồng bộ kế hoạch Line, bảng ghép tên Model). Chỉ server đọc.
migrate((app) => {
  app.db().newQuery("CREATE TABLE IF NOT EXISTS erp_cfg (key TEXT PRIMARY KEY, value TEXT)").execute();
}, (app) => { });
