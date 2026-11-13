/// <reference path="../pb_data/types.d.ts" />
// App Kitting vật liệu (MM). API nghiệp vụ /api/mm/* — mã nghiệp vụ trong mm_lib.js (tự sinh khi đóng gói, không sửa tay).
// Lưu ý PocketBase: mỗi handler chạy độc lập nên phải require() bên trong handler.

routerAdd("GET", "/api/mm/{path...}", (e) => require(`${__hooks}/mm_lib.js`).serve(e, "GET"));
routerAdd("POST", "/api/mm/{path...}", (e) => require(`${__hooks}/mm_lib.js`).serve(e, "POST"));

// PO đẩy tự động từ công cụ truyền dữ liệu: header X-MM-Key = MM_API_KEY trong .env (để trống = tắt).
routerAdd("POST", "/api/mmx/po", (e) => require(`${__hooks}/mm_lib.js`).servePoApi(e));
// Tình trạng sản xuất từ công cụ đọc QR (cùng khóa X-MM-Key): { source, rows: [{ po, productionQty, remainQty?, status? }] }.
routerAdd("POST", "/api/mmx/production", (e) => require(`${__hooks}/mm_lib.js`).serveProdApi(e));
// MES đẩy kế hoạch + số sản xuất từng PO (cùng khóa X-MM-Key): { schema: "MES.ProductionPlan.v1", data: {…} | [{…}] }; ?dry=1 = không ghi.
// Kế hoạch Line theo ngày / ca từ Next ERP (Line Production Plan), 15 phút một lần — chỉ chạy khi đã bật trong Quản trị.
cronAdd("mm_erp_line", "*/15 * * * *", () => require(`${__hooks}/mm_lib.js`).cronErpLines());
routerAdd("POST", "/api/mmx/po-plan", (e) => require(`${__hooks}/mm_lib.js`).serveMesPlanApi(e));

// Chống dò mật khẩu: sai 5 lần trong 15 phút thì khóa đăng nhập Mã NV đó 15 phút.
onRecordAuthWithPasswordRequest((e) => {
  const id = String(e.identity || "").trim().toUpperCase();
  // Mã NV gõ chữ thường vẫn đăng nhập được.
  if (!e.record && id) { try { e.record = $app.findFirstRecordByData("users", "username", id); } catch (_) { } }
  const row = new DynamicModel({ n: 0 });
  $app.db().newQuery("SELECT COUNT(*) AS n FROM auth_fail WHERE identity = {:id} AND created_at > datetime('now', '-15 minutes')").bind({ id: id }).one(row);
  if (row.n >= 5) throw new BadRequestError("Sai mật khẩu quá 5 lần. Thử lại sau 15 phút.");
  try {
    e.next();
  } catch (x) {
    $app.db().newQuery("INSERT INTO auth_fail(identity, ip) VALUES ({:id}, {:ip})").bind({ id: id, ip: e.realIP() }).execute();
    throw x;
  }
  $app.db().newQuery("DELETE FROM auth_fail WHERE identity = {:id} OR created_at < datetime('now', '-1 day')").bind({ id: id }).execute();
}, "users");
