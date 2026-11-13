/// <reference path="../pb_data/types.d.ts" />
// Giao 1 phần + giao bù theo đợt: kit_lot (đợt <Kit>-B2, B3… Line ký nhận), kit_lot_item (mã trong đợt), kit_bu (OP kho đã soạn bù, chưa giao).
// Lần giao bù cũ (kit_txn debt_settle) → mỗi lần 1 đợt; Line đã xác nhận nhận PO sau lần bù đó thì coi như đã nhận (giống backfillLots trong kit-lot.mjs).
migrate((app) => {
  const q = sql => app.db().newQuery(sql).execute();
  q(`CREATE TABLE IF NOT EXISTS kit_lot (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kit_id INTEGER NOT NULL, kit_code TEXT NOT NULL, line TEXT, seq INTEGER NOT NULL, lot_no TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), src_txn INTEGER,
    signer TEXT, signer_name TEXT, signed_at TEXT, signed_by TEXT, reason TEXT, note TEXT, kho_note TEXT, kho_by TEXT, kho_at TEXT)`);
  q(`CREATE TABLE IF NOT EXISTS kit_lot_item (
    lot_id INTEGER NOT NULL, grp TEXT NOT NULL, kit_group TEXT, model_code TEXT NOT NULL DEFAULT '', material TEXT NOT NULL, description TEXT, qty REAL NOT NULL,
    PRIMARY KEY (lot_id, grp, model_code, material))`);
  q(`CREATE TABLE IF NOT EXISTS kit_bu (
    kit_id INTEGER NOT NULL, grp TEXT NOT NULL, model_code TEXT NOT NULL DEFAULT '', material TEXT NOT NULL, qty REAL NOT NULL,
    username TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (kit_id, grp, model_code, material))`);
  q('CREATE INDEX IF NOT EXISTS kit_lot_kit ON kit_lot(kit_id)');
  q('CREATE INDEX IF NOT EXISTS kit_lot_status ON kit_lot(status)');
  try {
    q(`INSERT INTO kit_lot(kit_id, kit_code, line, seq, lot_no, status, created_by, created_at, src_txn)
      SELECT k.id, t.kit_code, COALESCE(t.line, k.line), 1 + ROW_NUMBER() OVER (PARTITION BY t.kit_code ORDER BY t.id), t.kit_code || '-B' || (1 + ROW_NUMBER() OVER (PARTITION BY t.kit_code ORDER BY t.id)),
        'pending', t.username, t.created_at, t.id
      FROM kit_txn t JOIN kit_order k ON k.code = t.kit_code WHERE t.type = 'debt_settle' AND NOT EXISTS (SELECT 1 FROM kit_lot l WHERE l.src_txn = t.id)`);
    q(`INSERT OR IGNORE INTO kit_lot_item(lot_id, grp, kit_group, model_code, material, description, qty)
      SELECT l.id, t.grp, t.kit_group, COALESCE(t.ref_code, ''), t.material, (SELECT i.description FROM kit_item i WHERE i.kit_id = l.kit_id AND i.material = t.material LIMIT 1), t.qty
      FROM kit_lot l JOIN kit_txn t ON t.id = l.src_txn WHERE NOT EXISTS (SELECT 1 FROM kit_lot_item x WHERE x.lot_id = l.id)`);
  } catch (_) { }   // cài mới: chưa có kit_txn / kit_order
  try {
    q(`UPDATE kit_lot SET status = 'received', signer = (SELECT r.signer FROM kit_receipt r WHERE r.kit_id = kit_lot.kit_id), signer_name = (SELECT r.signer_name FROM kit_receipt r WHERE r.kit_id = kit_lot.kit_id),
        signed_at = (SELECT r.at FROM kit_receipt r WHERE r.kit_id = kit_lot.kit_id), signed_by = 'nhận PO'
      WHERE status = 'pending' AND EXISTS (SELECT 1 FROM kit_receipt r WHERE r.kit_id = kit_lot.kit_id AND r.status = 'received' AND r.at >= kit_lot.created_at)`);
  } catch (_) { }
}, (app) => { });
