// Kho dữ liệu SQLite (node:sqlite có sẵn trong Node.js 22.13+ / 24). Một file duy nhất: data/kitting.db

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','planner','kho','opkho','line','approver')),
  password_hash TEXT NOT NULL,
  line TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- Kết nối Next ERP (url / key / secret, chỉ đọc phía server; không trả về trình duyệt)
CREATE TABLE IF NOT EXISTS erp_cfg (key TEXT PRIMARY KEY, value TEXT);
-- Tồn vị trí (Bin), kho / vị trí, mã vật liệu và BOM mặc định lấy từ Next ERP (chỉ đọc; erp-stock.mjs)
CREATE TABLE IF NOT EXISTS erp_stock (material TEXT NOT NULL, warehouse TEXT NOT NULL, qty REAL NOT NULL DEFAULT 0, reserved REAL NOT NULL DEFAULT 0, uom TEXT, PRIMARY KEY (material, warehouse));
CREATE TABLE IF NOT EXISTS erp_wh (name TEXT PRIMARY KEY, label TEXT NOT NULL, parent TEXT, is_group INTEGER NOT NULL DEFAULT 0, wh_type TEXT, in_kho INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS erp_item (material TEXT PRIMARY KEY, name TEXT, item_group TEXT, default_loc TEXT, uom TEXT);
CREATE TABLE IF NOT EXISTS erp_bom (item TEXT PRIMARY KEY, name TEXT NOT NULL, modified TEXT, lines INTEGER NOT NULL DEFAULT 0, synced_at TEXT NOT NULL DEFAULT (datetime('now')));
-- Change code BOM theo ECN (log truy xuất được)
CREATE TABLE IF NOT EXISTS bom_change (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ecn TEXT NOT NULL UNIQUE, model TEXT NOT NULL, codes TEXT NOT NULL,
    old_material TEXT NOT NULL, new_material TEXT NOT NULL, new_description TEXT, old_point REAL, new_point REAL,
    reason TEXT NOT NULL, note TEXT, effective_date TEXT NOT NULL, update_planned INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'scheduled', result TEXT,
    created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    applied_by TEXT, applied_at TEXT, cancelled_by TEXT, cancelled_at TEXT, cancel_reason TEXT);
CREATE TABLE IF NOT EXISTS lines (
  name TEXT PRIMARY KEY, sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
-- Model Code -> Model (nhóm VLN dùng chung BOM theo Model)
CREATE TABLE IF NOT EXISTS model_map (model_code TEXT PRIMARY KEY, model TEXT NOT NULL);
-- PO đồng bộ từ nguồn (Excel bây giờ, SQL sau này). po_key = PO đã chuẩn hóa.
CREATE TABLE IF NOT EXISTS po (
  po_key TEXT PRIMARY KEY,
  po_no TEXT NOT NULL,
  plan_date TEXT,
  master_line TEXT,
  basic_model TEXT,
  model_code TEXT NOT NULL,
  plan_qty REAL NOT NULL DEFAULT 0,
  production_qty REAL NOT NULL DEFAULT 0,
  remain_qty REAL NOT NULL DEFAULT 0,
  plan_status TEXT,
  plan_start TEXT,
  plan_end TEXT,
  span_time TEXT,
  po_change TEXT,
  pending_type TEXT,
  po_type TEXT NOT NULL DEFAULT 'SAP',   -- SAP | UNPLAN | RMA (PO nội bộ do Planner tạo)
  fixed_line TEXT,                    -- PO nội bộ: Line ấn định, Kho chỉ giao đúng Line này
  ref_doc TEXT, note TEXT, created_by TEXT,
  in_source INTEGER NOT NULL DEFAULT 1,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS po_model_code ON po(model_code);
-- Đơn vị kitting: 1 PO (single) hoặc Kit PO gộp (merged). Chưa có dòng = PO chưa lập kế hoạch.
CREATE TABLE IF NOT EXISTS kit_order (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('single','merged')),
  model_code TEXT NOT NULL,
  plan_day TEXT,                 -- ngày kitting; NULL = Kit PO gộp nhưng chưa xếp ngày
  seq INTEGER NOT NULL DEFAULT 0,  -- thứ tự ưu tiên trong ngày
  vln_status TEXT NOT NULL DEFAULT 'pending',
  hv_status TEXT NOT NULL DEFAULT 'pending',   -- Rear + VLĐT
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS kit_order_po (
  kit_id INTEGER NOT NULL REFERENCES kit_order(id) ON DELETE CASCADE,
  po_key TEXT NOT NULL UNIQUE REFERENCES po(po_key),
  PRIMARY KEY (kit_id, po_key)
);
-- BOM theo Model Code, kèm nhóm kitting
CREATE TABLE IF NOT EXISTS bom (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_code TEXT NOT NULL,
  material TEXT NOT NULL,
  description TEXT,
  point REAL NOT NULL,
  process TEXT,
  kit_group TEXT CHECK (kit_group IN ('VLN','VLDT','REAR')),
  group_source TEXT NOT NULL DEFAULT 'file',   -- file | auto | manual
  UNIQUE (model_code, material)
);
-- Line nào chạy Model nào theo ngày/ca (Planner khai báo)
CREATE TABLE IF NOT EXISTS line_assign (
  work_date TEXT NOT NULL, shift TEXT NOT NULL, line TEXT NOT NULL, model TEXT NOT NULL,
  updated_by TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (work_date, shift, line)
);
-- Rải chuyền & pending theo Line + Model (Planner nhập)
CREATE TABLE IF NOT EXISTS line_params (
  line TEXT NOT NULL, model TEXT NOT NULL,
  spread_qty REAL NOT NULL DEFAULT 0, pending_qty REAL NOT NULL DEFAULT 0, pending_day TEXT,   -- pending chỉ tính trong ngày làm việc pending_day
  uph REAL,                                    -- sản lượng / giờ (Planner nhập theo Line + Model)
  note TEXT, updated_by TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (line, model)
);
CREATE TABLE IF NOT EXISTS import_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, source TEXT, fingerprint TEXT,
  summary TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, action TEXT NOT NULL, detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export const DEFAULT_SETTINGS = {
  supply_threshold: '200',     // ngưỡng cấp vật liệu (ea)
  vln_min_per_line: '1',       // PO VLN chờ cấp tối thiểu / line
  vln_max_per_line: '3',       // PO VLN chờ cấp tối đa / line
  merge_max_qty: '2500',       // tổng SL tối đa của 1 Kit PO gộp
  auto_max_kits_day: '0',      // Tự động xếp: tối đa Kit / ngày kitting (0 = không giới hạn)
  shifts: 'Ngày,Đêm',
  shift_starts: '08:00,20:00'  // giờ bắt đầu từng ca, cùng thứ tự với shifts
};

// Chạy fn trong một transaction; lỗi thì rollback toàn bộ. Gọi lồng nhau thì dùng SAVEPOINT.
const txDepth = new WeakMap();
export function tx(db, fn) {
  // db.txBase = 1 khi đã nằm sẵn trong transaction của nền tảng (PocketBase): chỉ dùng SAVEPOINT.
  const depth = txDepth.get(db) || db.txBase || 0, sp = `sp${depth}`;
  db.exec(depth ? `SAVEPOINT ${sp}` : 'BEGIN IMMEDIATE');
  txDepth.set(db, depth + 1);
  try {
    const result = fn();
    db.exec(depth ? `RELEASE ${sp}` : 'COMMIT');
    return result;
  } catch (error) {
    try { db.exec(depth ? `ROLLBACK TO ${sp}; RELEASE ${sp}` : 'ROLLBACK'); } catch { /* đã rollback */ }
    throw error;
  } finally { txDepth.set(db, depth); }
}

export function getSettings(db) {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

export function audit(db, username, action, detail) {
  db.prepare('INSERT INTO audit_log(username, action, detail) VALUES (?, ?, ?)').run(username || '', action, typeof detail === 'string' ? detail : JSON.stringify(detail));
}

export const normalizePo = value => String(value ?? '').trim().replace(/\s+/g, '').toLocaleLowerCase();
export const fail = (message, status = 400) => Object.assign(new Error(message), { status });
