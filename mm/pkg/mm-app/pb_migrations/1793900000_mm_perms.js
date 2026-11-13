/// <reference path="../pb_data/types.d.ts" />
// Phân quyền chi tiết: bộ phận (dept), Trưởng bộ phận (is_head), bảng quyền theo màn hình (perms, trống = theo vai trò),
// mật khẩu cấp 2 (pin2, ẩn) + phiên xác nhận 5 phút (pin2_session) + đếm lần sai (pin2_fail).
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("dept")) users.fields.add(new TextField({ name: "dept", max: 40 }));
  if (!users.fields.getByName("is_head")) users.fields.add(new BoolField({ name: "is_head" }));
  if (!users.fields.getByName("perms")) users.fields.add(new JSONField({ name: "perms", maxSize: 20000 }));
  if (!users.fields.getByName("pin2")) users.fields.add(new TextField({ name: "pin2", max: 200, hidden: true }));
  app.save(users);
  app.db().newQuery("CREATE TABLE IF NOT EXISTS pin2_session (user_id TEXT PRIMARY KEY, until TEXT NOT NULL)").execute();
  app.db().newQuery("CREATE TABLE IF NOT EXISTS pin2_fail (user_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))").execute();
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  for (const f of ["dept", "is_head", "perms", "pin2"]) users.fields.removeByName(f);
  app.save(users);
  app.db().newQuery("DROP TABLE IF EXISTS pin2_session").execute();
  app.db().newQuery("DROP TABLE IF EXISTS pin2_fail").execute();
});
