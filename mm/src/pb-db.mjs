// Bộ chuyển đổi: cho các module lib/*.mjs (viết theo node:sqlite: prepare().all/get/run) chạy trên PocketBase (dbx).
// Tên cột của mỗi câu SELECT được lấy 1 lần qua TEMP VIEW + pragma_table_info rồi ghi nhớ; dòng trả về đọc qua json_object.
const colCache = new Map();
let viewSeq = 0;
function bindSql(sql, params) {
  const bound = {}; let i = 0;
  const text = sql.replace(/\?/g, () => { const k = `p${i}`; const v = params[i++]; bound[k] = v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v; return `{:${k}}`; });
  if (i !== params.length && params.length) throw new Error(`SQL cần ${i} tham số, nhận ${params.length}`);
  return [text, bound];
}
export function makeDb(app) {
  const q = sql => app.db().newQuery(sql);
  function columns(sql) {
    let c = colCache.get(sql);
    if (c) return c;
    const v = `mm_v${++viewSeq}_${Date.now().toString(36)}`;
    q(`CREATE TEMP VIEW ${v} AS ${sql.replace(/\?/g, 'NULL')}`).execute();
    try {
      const rows = arrayOf(new DynamicModel({ name: '' }));
      q(`SELECT name FROM pragma_table_info('${v}')`).all(rows);
      c = rows.map(r => r.name);
    } finally { q(`DROP VIEW IF EXISTS ${v}`).execute(); }
    if (new Set(c).size !== c.length) throw new Error(`Câu SQL có cột trùng tên: ${sql.slice(0, 80)}`);
    colCache.set(sql, c);
    return c;
  }
  function all(sql, params) {
    const c = columns(sql);
    const obj = `json_object(${c.map(x => `'${x.replace(/'/g, "''")}', "${x.replace(/"/g, '""')}"`).join(', ')})`;
    const [text, bound] = bindSql(`SELECT ${obj} AS j FROM (${sql})`, params);
    const rows = arrayOf(new DynamicModel({ j: '' }));
    q(text).bind(bound).all(rows);
    return rows.map(r => JSON.parse(r.j));
  }
  function run(sql, params) {
    const [text, bound] = bindSql(sql, params);
    const r = q(text).bind(bound).execute();
    return { changes: r.rowsAffected(), lastInsertRowid: r.lastInsertId() };
  }
  return {
    txBase: 1,
    prepare: sql => ({ all: (...p) => all(sql, p), get: (...p) => all(sql, p)[0], run: (...p) => run(sql, p) }),
    exec: sql => { for (const s of sql.replace(/--[^\n]*/g, '').split(';').map(x => x.trim()).filter(Boolean)) q(s).execute(); }
  };
}
