import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync('ddl.json', 'utf8'));
const ts = 1793600000;
const schema = `/// <reference path="../pb_data/types.d.ts" />
// App Kitting vật liệu (MM) — bảng nghiệp vụ (SQLite thuần trong data.db, quản lý bằng API /api/mm/*),
// bảng users (đăng nhập Mã NV + mật khẩu, vai trò), bảng mm_events (đẩy cập nhật realtime). Chạy lại nhiều lần an toàn.
const DDL = ${JSON.stringify(d.ddl.concat([
  'CREATE INDEX IF NOT EXISTS kit_order_plan ON kit_order(plan_day, seq)',
  'CREATE INDEX IF NOT EXISTS kit_order_line ON kit_order(line, vln_status)',
  'CREATE INDEX IF NOT EXISTS kit_order_status ON kit_order(vln_status, hv_status)',
  'CREATE INDEX IF NOT EXISTS kit_txn_time ON kit_txn(created_at)',
  'CREATE INDEX IF NOT EXISTS kit_txn_code ON kit_txn(kit_code)',
  'CREATE INDEX IF NOT EXISTS material_request_status ON material_request(status)',
  'CREATE INDEX IF NOT EXISTS material_request_line ON material_request(line, kind, status)',
  'CREATE INDEX IF NOT EXISTS audit_time ON audit_log(created_at)'
]), null, 1)};
const TABLES = ${JSON.stringify(d.tables)};
const SETTINGS = ${JSON.stringify(d.settings)};
const ROLES = ["admin", "planner", "kho", "opkho", "line", "approver"];

migrate((app) => {
  for (const sql of DDL) app.db().newQuery(sql).execute();
  app.db().newQuery("CREATE TABLE IF NOT EXISTS auth_fail (identity TEXT NOT NULL, ip TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))").execute();
  app.db().newQuery("CREATE INDEX IF NOT EXISTS idx_auth_fail ON auth_fail (identity, created_at)").execute();
  for (const k of Object.keys(SETTINGS)) app.db().newQuery("INSERT OR IGNORE INTO settings(key, value) VALUES ({:k}, {:v})").bind({ k: k, v: SETTINGS[k] }).execute();

  // users: Mã NV (username) + PIN 4–8 số; vai trò; khóa tài khoản. Chỉ quản trị app tạo tài khoản (qua API có kiểm soát).
  const users = app.findCollectionByNameOrId("users");
  const email = users.fields.getByName("email"); if (email) email.required = false;
  const pw = users.fields.getByName("password"); if (pw) { pw.min = 8; pw.max = 64; pw.pattern = ""; }
  if (!users.fields.getByName("username")) users.fields.add(new TextField({ name: "username", required: true, min: 2, max: 30, pattern: "^[A-Z0-9._-]+$" }));
  const roleF = users.fields.getByName("role");
  if (!roleF) users.fields.add(new SelectField({ name: "role", required: true, maxSelect: 1, values: ROLES })); else roleF.values = ROLES;
  if (!users.fields.getByName("active")) users.fields.add(new BoolField({ name: "active" }));
  if (!users.fields.getByName("line")) users.fields.add(new TextField({ name: "line", max: 40 }));   // Line phụ trách (Leader Line)
  if (!users.fields.getByName("must_change")) users.fields.add(new BoolField({ name: "must_change" }));   // bắt đổi mật khẩu ở lần đăng nhập tới
  users.addIndex("idx_users_username", true, "username", "");
  users.passwordAuth.enabled = true;
  users.passwordAuth.identityFields = ["username"];
  users.authRule = "active = true";
  users.listRule = "id = @request.auth.id"; users.viewRule = "id = @request.auth.id";
  users.createRule = null; users.updateRule = null; users.deleteRule = null;
  users.oauth2.enabled = false; users.otp.enabled = false; users.mfa.enabled = false;
  app.save(users);

  let ev;
  try { ev = app.findCollectionByNameOrId("mm_events"); } catch (_) { ev = null; }
  if (!ev) {
    ev = new Collection({ type: "base", name: "mm_events",
      listRule: "@request.auth.collectionName = 'users'", viewRule: "@request.auth.collectionName = 'users'",
      createRule: null, updateRule: null, deleteRule: null,
      fields: [{ type: "text", name: "topic", max: 40 }, { type: "number", name: "n" }, { type: "autodate", name: "updated", onCreate: true, onUpdate: true }] });
    app.save(ev);
  }
  if (app.countRecords("mm_events") === 0) { const r = new Record(ev); r.set("id", "kittingevents01"); r.set("topic", "all"); r.set("n", 0); app.save(r); }

  // Giới hạn tần suất (chống dò PIN; khóa theo Mã NV nằm trong hook) — bật bộ giới hạn có sẵn của PocketBase.
  // 60 lần/phút/IP vì cả xưởng có thể đi chung 1 IP; khi chạy sau Cloudflare nên khai IP proxy header (CF-Connecting-IP).
  const s = app.settings();
  s.rateLimits.enabled = true;
  if (!s.rateLimits.rules.some((x) => x.label === "*:authWithPassword")) s.rateLimits.rules.push({ label: "*:authWithPassword", maxRequests: 60, duration: 60, audience: "" });
  if (!s.meta.appName || s.meta.appName === "Acme") s.meta.appName = "Kitting vật liệu";
  app.save(s);
}, (app) => {
  for (const t of TABLES.concat(["auth_fail"]).reverse()) app.db().newQuery("DROP TABLE IF EXISTS " + t).execute();
  try { app.delete(app.findCollectionByNameOrId("mm_events")); } catch (_) {}
});
`;
fs.mkdirSync('pkg/mm-app/pb_migrations', { recursive: true });
for (const f of fs.readdirSync('pkg/mm-app/pb_migrations')) fs.unlinkSync('pkg/mm-app/pb_migrations/' + f);
fs.writeFileSync(`pkg/mm-app/pb_migrations/${ts}_mm_schema.js`, schema);
// Bản cập nhật 02/11: đăng nhập bằng mật khẩu thay PIN. Server đã cài sẵn chạy file này; tài khoản đang có phải đổi mật khẩu ở lần đăng nhập tới.
fs.writeFileSync('pkg/mm-app/pb_migrations/1793700000_mm_password.js', `/// <reference path="../pb_data/types.d.ts" />
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
`);
// Bản cập nhật 02/11: lịch sử thay đổi PO qua các lần nhập (server đã cài chạy file này; cài mới thì bảng có sẵn trong file schema).
fs.writeFileSync('pkg/mm-app/pb_migrations/1793800000_mm_po_history.js', `/// <reference path="../pb_data/types.d.ts" />
// Lịch sử thay đổi PO qua các lần nhập (mới / đổi số lượng / Cancel / không còn trong file nguồn).
migrate((app) => {
  app.db().newQuery("CREATE TABLE IF NOT EXISTS po_history (id INTEGER PRIMARY KEY AUTOINCREMENT, po_key TEXT NOT NULL, import_id INTEGER, kind TEXT NOT NULL, changes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))").execute();
  app.db().newQuery("CREATE INDEX IF NOT EXISTS po_history_key ON po_history(po_key, id)").execute();
}, (app) => {
  app.db().newQuery("DROP TABLE IF EXISTS po_history").execute();
});
`);
// Bản cập nhật 03/11: phân quyền chi tiết theo tài khoản + Trưởng bộ phận + mật khẩu cấp 2 (trường pin2 ẩn, API không trả về).
fs.writeFileSync('pkg/mm-app/pb_migrations/1793900000_mm_perms.js', `/// <reference path="../pb_data/types.d.ts" />
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
`);
// Bản cập nhật 03/11: PO nội bộ (Unplan / RMA) do Planner tạo, ấn định Line.
fs.writeFileSync('pkg/mm-app/pb_migrations/1794000000_mm_internal_po.js', `/// <reference path="../pb_data/types.d.ts" />
// PO nội bộ: loại PO (SAP / UNPLAN / RMA), Line ấn định, chứng từ tham chiếu, ghi chú, người tạo. Cột đã có (cài mới) thì bỏ qua.
migrate((app) => {
  const cols = [["po_type", "TEXT NOT NULL DEFAULT 'SAP'"], ["fixed_line", "TEXT"], ["ref_doc", "TEXT"], ["note", "TEXT"], ["created_by", "TEXT"]];
  for (const c of cols) { try { app.db().newQuery("ALTER TABLE po ADD COLUMN " + c[0] + " " + c[1]).execute(); } catch (_) { } }
}, (app) => { });
`);
fs.writeFileSync('pkg/mm-app/pb_migrations/1794100000_mm_mes_sync.js', `/// <reference path="../pb_data/types.d.ts" />
// Thời điểm MES gửi gần nhất của từng PO: bỏ qua bản tin đến muộn. Cột đã có thì bỏ qua.
migrate((app) => {
  try { app.db().newQuery("ALTER TABLE po ADD COLUMN mes_synced_at TEXT").execute(); } catch (_) { }
}, (app) => { });
`);
fs.writeFileSync('pkg/mm-app/pb_migrations/1794200000_mm_erp.js', `/// <reference path="../pb_data/types.d.ts" />
// Kết nối Next ERP (url / key / secret của tài khoản bot, cờ đồng bộ kế hoạch Line, bảng ghép tên Model). Chỉ server đọc.
migrate((app) => {
  app.db().newQuery("CREATE TABLE IF NOT EXISTS erp_cfg (key TEXT PRIMARY KEY, value TEXT)").execute();
}, (app) => { });
`);
fs.writeFileSync('pkg/mm-app/pb_migrations/1794300000_mm_pending_day.js', `/// <reference path="../pb_data/types.d.ts" />
// Pending của Line chỉ tính trong ngày làm việc khai báo (pending_day). Pending đang có tính cho hôm nay (giờ VN).
migrate((app) => {
  try { app.db().newQuery("ALTER TABLE line_params ADD COLUMN pending_day TEXT").execute(); } catch (_) { }
  app.db().newQuery("UPDATE line_params SET pending_day = date('now', '+7 hours') WHERE pending_qty > 0 AND pending_day IS NULL").execute();
}, (app) => { });
`);
fs.writeFileSync('pkg/mm-app/pb_migrations/1794400000_mm_bom_change.js', "/// <reference path=\"../pb_data/types.d.ts\" />\n// Change code BOM theo ECN: log đầy đủ (người tạo / áp dụng / hủy, ngày áp dụng, kết quả).\nmigrate((app) => {\n  app.db().newQuery(`CREATE TABLE IF NOT EXISTS bom_change (\n    id INTEGER PRIMARY KEY AUTOINCREMENT, ecn TEXT NOT NULL UNIQUE, model TEXT NOT NULL, codes TEXT NOT NULL,\n    old_material TEXT NOT NULL, new_material TEXT NOT NULL, new_description TEXT, old_point REAL, new_point REAL,\n    reason TEXT NOT NULL, note TEXT, effective_date TEXT NOT NULL, update_planned INTEGER NOT NULL DEFAULT 0,\n    status TEXT NOT NULL DEFAULT 'scheduled', result TEXT,\n    created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),\n    applied_by TEXT, applied_at TEXT, cancelled_by TEXT, cancelled_at TEXT, cancel_reason TEXT)`).execute();\n}, (app) => { });\n");
console.log('ok');
