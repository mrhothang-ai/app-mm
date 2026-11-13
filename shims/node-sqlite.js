// Giả lập API DatabaseSync của node:sqlite bằng sql.js (SQLite biên dịch sang JavaScript) để dùng chung lib/ với bản LAN.
const norm = params => params.map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
export class DatabaseSync {
  constructor() {
    const SQL = globalThis.__SQL;
    if (!SQL) throw new Error('SQLite chưa sẵn sàng.');
    this.db = globalThis.__DB_BYTES ? new SQL.Database(globalThis.__DB_BYTES) : new SQL.Database();
    globalThis.__DB_INSTANCE = this.db;
  }
  exec(sql) { this.db.exec(sql); }
  prepare(sql) {
    const db = this.db;
    return {
      run(...params) {
        db.run(sql, norm(params));
        const changes = db.getRowsModified();
        const id = db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0][0] ?? 0;
        return { changes, lastInsertRowid: id };
      },
      get(...params) {
        const st = db.prepare(sql);
        try { st.bind(norm(params)); return st.step() ? st.getAsObject() : undefined; } finally { st.free(); }
      },
      all(...params) {
        const st = db.prepare(sql), out = [];
        try { st.bind(norm(params)); while (st.step()) out.push(st.getAsObject()); return out; } finally { st.free(); }
      }
    };
  }
}
