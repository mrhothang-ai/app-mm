/// <reference path="../pb_data/types.d.ts" />
// Đăng nhập Mã NV + mật khẩu (8–64 ký tự, có chữ và số) thay cho PIN 4–8 số.
// Mật khẩu (PIN) cũ vẫn đăng nhập được, nhưng app bắt đổi sang mật khẩu mới ở lần đăng nhập tới.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const pw = users.fields.getByName("password"); if (pw) { pw.min = 8; pw.max = 64; pw.pattern = ""; }
  if (!users.fields.getByName("must_change")) users.fields.add(new BoolField({ name: "must_change" }));
  app.save(users);
  app.db().newQuery("UPDATE users SET must_change = TRUE").execute();
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  const pw = users.fields.getByName("password"); if (pw) { pw.min = 4; pw.max = 8; pw.pattern = "^[0-9]+$"; }
  app.save(users);
});
