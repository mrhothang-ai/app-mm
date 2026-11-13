/// <reference path="../pb_data/types.d.ts" />
// App Kitting vật liệu (MM) — bảng nghiệp vụ (SQLite thuần trong data.db, quản lý bằng API /api/mm/*),
// bảng users (đăng nhập Mã NV + mật khẩu, vai trò), bảng mm_events (đẩy cập nhật realtime). Chạy lại nhiều lần an toàn.
const DDL = [
 "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS lines (\n  name TEXT PRIMARY KEY, sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1\n)",
 "CREATE TABLE IF NOT EXISTS model_map (model_code TEXT PRIMARY KEY, model TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS po (\n  po_key TEXT PRIMARY KEY,\n  po_no TEXT NOT NULL,\n  plan_date TEXT,\n  master_line TEXT,\n  basic_model TEXT,\n  model_code TEXT NOT NULL,\n  plan_qty REAL NOT NULL DEFAULT 0,\n  production_qty REAL NOT NULL DEFAULT 0,\n  remain_qty REAL NOT NULL DEFAULT 0,\n  plan_status TEXT,\n  plan_start TEXT,\n  plan_end TEXT,\n  span_time TEXT,\n  po_change TEXT,\n  pending_type TEXT,\n  po_type TEXT NOT NULL DEFAULT 'SAP',   -- SAP | UNPLAN | RMA (PO nội bộ do Planner tạo)\n  fixed_line TEXT,                    -- PO nội bộ: Line ấn định, Kho chỉ giao đúng Line này\n  ref_doc TEXT, note TEXT, created_by TEXT,\n  in_source INTEGER NOT NULL DEFAULT 1,\n  first_seen TEXT NOT NULL DEFAULT (datetime('now')),\n  synced_at TEXT NOT NULL DEFAULT (datetime('now'))\n)",
 "CREATE TABLE IF NOT EXISTS kit_order (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  code TEXT NOT NULL UNIQUE,\n  kind TEXT NOT NULL CHECK (kind IN ('single','merged')),\n  model_code TEXT NOT NULL,\n  plan_day TEXT,                 -- ngày kitting; NULL = Kit PO gộp nhưng chưa xếp ngày\n  seq INTEGER NOT NULL DEFAULT 0,  -- thứ tự ưu tiên trong ngày\n  vln_status TEXT NOT NULL DEFAULT 'pending',\n  hv_status TEXT NOT NULL DEFAULT 'pending',   -- Rear + VLĐT\n  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),\n  updated_at TEXT NOT NULL DEFAULT (datetime('now'))\n, line TEXT, delivered_at TEXT, delivered_by TEXT)",
 "CREATE TABLE IF NOT EXISTS kit_order_po (\n  kit_id INTEGER NOT NULL REFERENCES kit_order(id) ON DELETE CASCADE,\n  po_key TEXT NOT NULL UNIQUE REFERENCES po(po_key),\n  PRIMARY KEY (kit_id, po_key)\n)",
 "CREATE TABLE IF NOT EXISTS bom (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  model_code TEXT NOT NULL,\n  material TEXT NOT NULL,\n  description TEXT,\n  point REAL NOT NULL,\n  process TEXT,\n  kit_group TEXT CHECK (kit_group IN ('VLN','VLDT','REAR')),\n  group_source TEXT NOT NULL DEFAULT 'file',   -- file | auto | manual\n  UNIQUE (model_code, material)\n)",
 "CREATE TABLE IF NOT EXISTS line_assign (\n  work_date TEXT NOT NULL, shift TEXT NOT NULL, line TEXT NOT NULL, model TEXT NOT NULL,\n  updated_by TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')),\n  PRIMARY KEY (work_date, shift, line)\n)",
 "CREATE TABLE IF NOT EXISTS line_params (\n  line TEXT NOT NULL, model TEXT NOT NULL,\n  spread_qty REAL NOT NULL DEFAULT 0, pending_qty REAL NOT NULL DEFAULT 0,\n  uph REAL,                                    -- sản lượng / giờ (Planner nhập theo Line + Model)\n  note TEXT, updated_by TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')),\n  PRIMARY KEY (line, model)\n)",
 "CREATE TABLE IF NOT EXISTS import_log (\n  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, source TEXT, fingerprint TEXT,\n  summary TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))\n)",
 "CREATE TABLE IF NOT EXISTS audit_log (\n  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, action TEXT NOT NULL, detail TEXT,\n  created_at TEXT NOT NULL DEFAULT (datetime('now'))\n)",
 "CREATE TABLE IF NOT EXISTS kit_item (\n    kit_id INTEGER NOT NULL REFERENCES kit_order(id) ON DELETE CASCADE,\n    grp TEXT NOT NULL CHECK (grp IN ('VLN','HV')),\n    kit_group TEXT NOT NULL,\n    model_code TEXT NOT NULL DEFAULT '',   -- '' với VLN; Rear/VLĐT ghi Model Code (Kit gộp nhiều code)\n    material TEXT NOT NULL,\n    description TEXT,\n    required REAL NOT NULL,\n    kitted REAL NOT NULL DEFAULT 0,\n    delivered REAL NOT NULL DEFAULT 0,\n    PRIMARY KEY (kit_id, grp, model_code, material)\n  )",
 "CREATE TABLE IF NOT EXISTS kit_txn (\n    id INTEGER PRIMARY KEY AUTOINCREMENT, kit_code TEXT, type TEXT NOT NULL, grp TEXT, kit_group TEXT, material TEXT,\n    qty REAL NOT NULL DEFAULT 0, ref_code TEXT, line TEXT, reason_code TEXT, note TEXT, username TEXT,\n    created_at TEXT NOT NULL DEFAULT (datetime('now'))\n  )",
 "CREATE TABLE IF NOT EXISTS material_request (\n    id INTEGER PRIMARY KEY AUTOINCREMENT, line TEXT NOT NULL, model TEXT, material TEXT, description TEXT, qty REAL NOT NULL,\n    note TEXT, status TEXT NOT NULL, remain_sum REAL, spread REAL, pending REAL, available REAL, threshold REAL, pass INTEGER,\n    requested_by TEXT, approved_by TEXT, approve_note TEXT, approved_at TEXT, issued_qty REAL, issued_by TEXT, issued_at TEXT,\n    created_at TEXT NOT NULL DEFAULT (datetime('now'))\n  , kind TEXT NOT NULL DEFAULT 'material', kit_id INTEGER, kit_code TEXT)",
 "CREATE TABLE IF NOT EXISTS bom_vln (\n    model TEXT NOT NULL, material TEXT NOT NULL, description TEXT, point REAL NOT NULL,\n    source TEXT NOT NULL DEFAULT 'auto', updated_by TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')),\n    PRIMARY KEY (model, material))",
 "CREATE TABLE IF NOT EXISTS plan_undo (\n    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, label TEXT NOT NULL, data TEXT NOT NULL,\n    created_at TEXT NOT NULL DEFAULT (datetime('now')))",
 "CREATE TABLE IF NOT EXISTS po_history (\n    id INTEGER PRIMARY KEY AUTOINCREMENT, po_key TEXT NOT NULL, import_id INTEGER, kind TEXT NOT NULL, changes TEXT,\n    created_at TEXT NOT NULL DEFAULT (datetime('now'))\n  )",
 "CREATE TABLE IF NOT EXISTS pin2_session (user_id TEXT PRIMARY KEY, until TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS pin2_fail (user_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
 "CREATE INDEX IF NOT EXISTS po_model_code ON po(model_code)",
 "CREATE INDEX IF NOT EXISTS po_history_key ON po_history(po_key, id)",
 "CREATE INDEX IF NOT EXISTS kit_order_plan ON kit_order(plan_day, seq)",
 "CREATE INDEX IF NOT EXISTS kit_order_line ON kit_order(line, vln_status)",
 "CREATE INDEX IF NOT EXISTS kit_order_status ON kit_order(vln_status, hv_status)",
 "CREATE INDEX IF NOT EXISTS kit_txn_time ON kit_txn(created_at)",
 "CREATE INDEX IF NOT EXISTS kit_txn_code ON kit_txn(kit_code)",
 "CREATE INDEX IF NOT EXISTS material_request_status ON material_request(status)",
 "CREATE INDEX IF NOT EXISTS material_request_line ON material_request(line, kind, status)",
 "CREATE INDEX IF NOT EXISTS audit_time ON audit_log(created_at)"
];
const TABLES = ["settings","lines","model_map","po","kit_order","kit_order_po","bom","line_assign","line_params","import_log","audit_log","kit_item","kit_txn","material_request","bom_vln","plan_undo","po_history","pin2_session","pin2_fail"];
const SETTINGS = {"supply_threshold":"200","vln_min_per_line":"1","vln_max_per_line":"3","merge_max_qty":"2500","shifts":"Ngày,Đêm","shift_starts":"08:00,20:00"};
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
