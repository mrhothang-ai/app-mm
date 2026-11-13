// TỰ SINH từ mã nguồn (build.mjs) — không sửa tay.
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key2, value) => key2 in obj ? __defProp(obj, key2, { enumerable: true, configurable: true, writable: true, value }) : obj[key2] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __objRest = (source, exclude) => {
  var target = {};
  for (var prop in source)
    if (__hasOwnProp.call(source, prop) && exclude.indexOf(prop) < 0)
      target[prop] = source[prop];
  if (source != null && __getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(source)) {
      if (exclude.indexOf(prop) < 0 && __propIsEnum.call(source, prop))
        target[prop] = source[prop];
    }
  return target;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/pb-entry.mjs
var pb_entry_exports = {};
__export(pb_entry_exports, {
  ROLE_LABEL: () => ROLE_LABEL,
  cronErpLines: () => cronErpLines,
  externalMesPlan: () => externalMesPlan,
  externalPo: () => externalPo,
  externalProduction: () => externalProduction,
  handle: () => handle,
  hasUsers: () => hasUsers,
  publicUser: () => publicUser,
  serve: () => serve,
  serveMesPlanApi: () => serveMesPlanApi,
  servePoApi: () => servePoApi,
  serveProdApi: () => serveProdApi
});
module.exports = __toCommonJS(pb_entry_exports);

// src/pb-db.mjs
var colCache = /* @__PURE__ */ new Map();
var viewSeq = 0;
function bindSql(sql, params) {
  const bound = {};
  let i = 0;
  const text = sql.replace(/\?/g, () => {
    const k = `p${i}`;
    const v = params[i++];
    bound[k] = v === void 0 ? null : typeof v === "boolean" ? v ? 1 : 0 : v;
    return `{:${k}}`;
  });
  if (i !== params.length && params.length) throw new Error(`SQL c\u1EA7n ${i} tham s\u1ED1, nh\u1EADn ${params.length}`);
  return [text, bound];
}
function makeDb(app) {
  const q = (sql) => app.db().newQuery(sql);
  function columns(sql) {
    let c = colCache.get(sql);
    if (c) return c;
    const v = `mm_v${++viewSeq}_${Date.now().toString(36)}`;
    q(`CREATE TEMP VIEW ${v} AS ${sql.replace(/\?/g, "NULL")}`).execute();
    try {
      const rows = arrayOf(new DynamicModel({ name: "" }));
      q(`SELECT name FROM pragma_table_info('${v}')`).all(rows);
      c = rows.map((r) => r.name);
    } finally {
      q(`DROP VIEW IF EXISTS ${v}`).execute();
    }
    if (new Set(c).size !== c.length) throw new Error(`C\xE2u SQL c\xF3 c\u1ED9t tr\xF9ng t\xEAn: ${sql.slice(0, 80)}`);
    colCache.set(sql, c);
    return c;
  }
  function all(sql, params) {
    const c = columns(sql);
    const obj = `json_object(${c.map((x) => `'${x.replace(/'/g, "''")}', "${x.replace(/"/g, '""')}"`).join(", ")})`;
    const [text, bound] = bindSql(`SELECT ${obj} AS j FROM (${sql})`, params);
    const rows = arrayOf(new DynamicModel({ j: "" }));
    q(text).bind(bound).all(rows);
    return rows.map((r) => JSON.parse(r.j));
  }
  function run(sql, params) {
    const [text, bound] = bindSql(sql, params);
    const r = q(text).bind(bound).execute();
    return { changes: r.rowsAffected(), lastInsertRowid: r.lastInsertId() };
  }
  return {
    txBase: 1,
    prepare: (sql) => ({ all: (...p) => all(sql, p), get: (...p) => all(sql, p)[0], run: (...p) => run(sql, p) }),
    exec: (sql) => {
      for (const s of sql.replace(/--[^\n]*/g, "").split(";").map((x) => x.trim()).filter(Boolean)) q(s).execute();
    }
  };
}

// ../kitting-app/lib/db.mjs
var DEFAULT_SETTINGS = {
  supply_threshold: "200",
  // ngưỡng cấp vật liệu (ea)
  vln_min_per_line: "1",
  // PO VLN chờ cấp tối thiểu / line
  vln_max_per_line: "3",
  // PO VLN chờ cấp tối đa / line
  merge_max_qty: "2500",
  // tổng SL tối đa của 1 Kit PO gộp
  auto_max_kits_day: "0",
  // Tự động xếp: tối đa Kit / ngày kitting (0 = không giới hạn)
  shifts: "Ng\xE0y,\u0110\xEAm",
  shift_starts: "08:00,20:00"
  // giờ bắt đầu từng ca, cùng thứ tự với shifts
};
var txDepth = /* @__PURE__ */ new WeakMap();
function tx(db, fn) {
  const depth = txDepth.get(db) || db.txBase || 0, sp = `sp${depth}`;
  db.exec(depth ? `SAVEPOINT ${sp}` : "BEGIN IMMEDIATE");
  txDepth.set(db, depth + 1);
  try {
    const result = fn();
    db.exec(depth ? `RELEASE ${sp}` : "COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec(depth ? `ROLLBACK TO ${sp}; RELEASE ${sp}` : "ROLLBACK");
    } catch (e) {
    }
    throw error;
  } finally {
    txDepth.set(db, depth);
  }
}
function getSettings(db) {
  const out = __spreadValues({}, DEFAULT_SETTINGS);
  for (const row of db.prepare("SELECT key, value FROM settings").all()) out[row.key] = row.value;
  return out;
}
function audit(db, username, action, detail) {
  db.prepare("INSERT INTO audit_log(username, action, detail) VALUES (?, ?, ?)").run(username || "", action, typeof detail === "string" ? detail : JSON.stringify(detail));
}
var normalizePo = (value) => String(value != null ? value : "").trim().replace(/\s+/g, "").toLocaleLowerCase();
var fail = (message, status = 400) => Object.assign(new Error(message), { status });

// ../kitting-app/lib/po-sync.mjs
function modelOf(db, modelCode, basicModel) {
  const row = db.prepare("SELECT model FROM model_map WHERE model_code = ?").get(modelCode);
  return row ? row.model : String(basicModel || "").slice(0, 8);
}
var isCancelled = (p) => {
  var _a, _b;
  return /^cancel/i.test(String((_b = (_a = p == null ? void 0 : p.plan_status) != null ? _a : p == null ? void 0 : p.planStatus) != null ? _b : "").trim());
};
var notCancelledSql = (a = "") => `lower(trim(coalesce(${a}plan_status, ''))) NOT LIKE 'cancel%'`;
var TRACK = { model_code: "modelCode", plan_date: "planDate", plan_qty: "planQty", production_qty: "productionQty", remain_qty: "remainQty", plan_status: "planStatus", plan_start: "planStart" };
function syncPoRows(db, rows, { source, username, fullSnapshot = false }) {
  if (!Array.isArray(rows) || !rows.length) throw fail("Ngu\u1ED3n kh\xF4ng c\xF3 PO.");
  const seen = /* @__PURE__ */ new Set();
  for (const row of rows) {
    const k = normalizePo(row.po);
    if (seen.has(k)) throw fail(`PO ${row.po} b\u1ECB l\u1EB7p trong file ngu\u1ED3n.`);
    seen.add(k);
  }
  return tx(db, () => {
    const existing = new Map(db.prepare("SELECT * FROM po").all().map((r) => [r.po_key, r]));
    const importId = Number(db.prepare("INSERT INTO import_log(kind, source, summary, created_by) VALUES (?,?,?,?)").run("PO", source || "", "{}", username || "").lastInsertRowid);
    const hist = db.prepare("INSERT INTO po_history(po_key, import_id, kind, changes) VALUES (?,?,?,?)");
    const ins = db.prepare(`INSERT INTO po (po_key, po_no, plan_date, master_line, basic_model, model_code, plan_qty, production_qty,
        remain_qty, plan_status, plan_start, plan_end, span_time, po_change, pending_type, in_source, synced_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,datetime('now'))`);
    const upd = db.prepare(`UPDATE po SET po_no = ?, plan_date = ?, master_line = ?, basic_model = ?, model_code = ?, plan_qty = ?, remain_qty = ?,
        plan_status = ?, plan_start = ?, plan_end = ?, span_time = ?, po_change = ?, pending_type = ?, in_source = 1, synced_at = datetime('now') WHERE po_key = ?`);
    const keep = (v, old) => v === void 0 || v === null || v === "" ? old : v;
    let inserted = 0, updated = 0, changed = 0;
    const changedModel = [], cancelled = [];
    for (const r of rows) {
      const k = normalizePo(r.po), old = existing.get(k), planQty = Number(r.planQty) || 0;
      if (!old) {
        const prod = Number(r.productionQty) || 0, now2 = { plan_qty: planQty, remain_qty: Math.max(planQty - prod, 0), plan_status: r.planStatus || "" };
        ins.run(
          k,
          String(r.po),
          r.planDate || null,
          r.masterLine || "",
          r.basicModel || "",
          r.modelCode,
          planQty,
          prod,
          now2.remain_qty,
          now2.plan_status,
          r.planStart || "",
          r.planEnd || "",
          r.span || "",
          r.poChange || "",
          r.pendingType || ""
        );
        inserted++;
        hist.run(k, importId, isCancelled(now2) ? "cancel" : "new", JSON.stringify({ plan_qty: [null, planQty], remain_qty: [null, now2.remain_qty], plan_status: [null, now2.plan_status] }));
        if (isCancelled(now2)) cancelled.push(String(r.po));
        continue;
      }
      updated++;
      const now = {
        model_code: r.modelCode,
        plan_date: keep(r.planDate, old.plan_date),
        plan_qty: planQty,
        production_qty: old.production_qty,
        remain_qty: planQty !== old.plan_qty ? Math.max(planQty - old.production_qty, 0) : old.remain_qty,
        plan_status: keep(r.planStatus, old.plan_status),
        plan_start: keep(r.planStart, old.plan_start)
      };
      if (old.model_code !== r.modelCode) changedModel.push(r.po);
      upd.run(
        String(r.po),
        now.plan_date,
        keep(r.masterLine, old.master_line),
        keep(r.basicModel, old.basic_model),
        now.model_code,
        now.plan_qty,
        now.remain_qty,
        now.plan_status,
        now.plan_start,
        keep(r.planEnd, old.plan_end),
        keep(r.span, old.span_time),
        keep(r.poChange, old.po_change),
        keep(r.pendingType, old.pending_type),
        k
      );
      const diff = diffPo(old, now);
      if (!old.in_source) diff.in_source = [0, 1];
      if (!Object.keys(diff).length) continue;
      changed++;
      const nowCancel = isCancelled(now) && !isCancelled(old);
      if (nowCancel) cancelled.push(String(r.po));
      hist.run(k, importId, nowCancel ? "cancel" : !old.in_source ? "back" : "change", JSON.stringify(diff));
    }
    let missing = 0;
    if (fullSnapshot) {
      const mark = db.prepare("UPDATE po SET in_source = 0 WHERE po_key = ?");
      for (const [k, old] of existing) if (!seen.has(k)) {
        mark.run(k);
        missing++;
        if (old.in_source) hist.run(k, importId, "gone", JSON.stringify({ in_source: [1, 0] }));
      }
    }
    const summary = { total: rows.length, inserted, updated, changed, missing, changedModel, cancelled };
    db.prepare("UPDATE import_log SET summary = ? WHERE id = ?").run(JSON.stringify(summary), importId);
    settleLoads(db);
    return summary;
  });
}
function diffPo(old, now) {
  var _a, _b, _c;
  const diff = {};
  for (const c of Object.keys(TRACK)) if (c in now && String((_a = old[c]) != null ? _a : "") !== String((_b = now[c]) != null ? _b : "")) diff[c] = [(_c = old[c]) != null ? _c : null, now[c]];
  return diff;
}
var MES_SCHEMA = "MES.ProductionPlan.v1";
var MES_MAX = 5e3;
var mesText = (v, n) => String(v != null ? v : "").trim().slice(0, n);
var mesTime = (v) => {
  const m = String(v != null ? v : "").trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  return m ? `${m[1]}T${m[2]}` : "";
};
var mesNum = (v) => {
  const s = String(v != null ? v : "").replace(/,/g, "").trim();
  if (s === "") return null;
  const x = Number(s);
  return Number.isFinite(x) && x >= 0 ? x : NaN;
};
var mesStamp = (v) => {
  const m = String(v != null ? v : "").trim().match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z?$/);
  return m ? `${m[1]}T${m[2]}.${(m[3] || "").padEnd(7, "0").slice(0, 7)}Z` : "";
};
function mesRow(d) {
  const po = mesText(d == null ? void 0 : d.PoNo, 60), modelCode = mesText(d == null ? void 0 : d.ModelCode, 60), planQty = mesNum(d == null ? void 0 : d.PlanQty), productionQty = mesNum(d == null ? void 0 : d.ProductionQty), remainQty = mesNum(d == null ? void 0 : d.RemainQty);
  if (!po) throw fail("Thi\u1EBFu PoNo.");
  if (!modelCode) throw fail("Thi\u1EBFu ModelCode.");
  if (planQty === null || Number.isNaN(planQty)) throw fail("PlanQty ph\u1EA3i l\xE0 s\u1ED1 \u2265 0.");
  if (Number.isNaN(productionQty)) throw fail("ProductionQty ph\u1EA3i l\xE0 s\u1ED1 \u2265 0.");
  if (Number.isNaN(remainQty)) throw fail("RemainQty ph\u1EA3i l\xE0 s\u1ED1 \u2265 0.");
  const day = mesText(d == null ? void 0 : d.PlanDate, 10);
  return {
    po,
    modelCode,
    planQty,
    productionQty,
    remainQty,
    planDate: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "",
    masterLine: mesText(d == null ? void 0 : d.MasterLine, 60),
    planStatus: mesText(d == null ? void 0 : d.PoStatus, 30),
    planStart: mesTime(d == null ? void 0 : d.PlanStartAt),
    planEnd: mesTime(d == null ? void 0 : d.PlanEndAt),
    synced: mesStamp(d == null ? void 0 : d.SyncedAtUtc)
  };
}
function syncMesPlan(db, body, { dry = false } = {}) {
  var _a, _b;
  if ((body == null ? void 0 : body.schema) !== MES_SCHEMA) throw fail(`schema ph\u1EA3i l\xE0 ${MES_SCHEMA}.`);
  const list = Array.isArray(body == null ? void 0 : body.data) ? body.data : (body == null ? void 0 : body.data) && typeof body.data === "object" ? [body.data] : [];
  if (!list.length) throw fail("Thi\u1EBFu data.");
  if (list.length > MES_MAX) throw fail(`Qu\xE1 ${MES_MAX} PO trong m\u1ED9t l\u1EA7n g\u1EEDi.`);
  const rejected = [], latest = /* @__PURE__ */ new Map();
  for (const d of list) {
    try {
      const r = mesRow(d), k = normalizePo(r.po), cur = latest.get(k);
      if (!cur || r.synced >= cur.synced) latest.set(k, r);
    } catch (e) {
      if (!e.status) throw e;
      rejected.push({ po: mesText(d == null ? void 0 : d.PoNo, 60), error: e.message });
    }
  }
  if (!latest.size) throw fail(rejected[0].error);
  const same = (a, b) => String(a != null ? a : "") === String(b != null ? b : ""), planRows = [], prodRows = [], stamps = [], newNoBom = /* @__PURE__ */ new Set();
  let unchanged = 0, stale = 0, inserted = 0, updated = 0;
  for (const [k, r] of latest) {
    const old = db.prepare("SELECT * FROM po WHERE po_key = ?").get(k);
    if (old && (old.po_type || "SAP") !== "SAP") {
      rejected.push({ po: r.po, error: "PO n\u1ED9i b\u1ED9 trong app, MES kh\xF4ng ghi \u0111\xE8." });
      continue;
    }
    if (old && r.synced && old.mes_synced_at && r.synced < old.mes_synced_at) {
      stale++;
      continue;
    }
    if (r.synced) stamps.push([r.synced, k]);
    const prod = (_a = r.productionQty) != null ? _a : old ? old.production_qty : 0, remain = (_b = r.remainQty) != null ? _b : Math.max(r.planQty - prod, 0);
    if (!old) {
      inserted++;
      planRows.push(__spreadProps(__spreadValues({}, r), { productionQty: prod }));
      if (remain !== Math.max(r.planQty - prod, 0)) prodRows.push({ po: r.po, productionQty: prod, remainQty: remain, status: r.planStatus });
      if (!db.prepare("SELECT 1 FROM bom WHERE model_code = ? LIMIT 1").get(r.modelCode)) newNoBom.add(r.modelCode);
      continue;
    }
    const planDiff = !old.in_source || !same(old.model_code, r.modelCode) || Number(old.plan_qty) !== r.planQty || [["plan_date", r.planDate], ["master_line", r.masterLine], ["plan_status", r.planStatus], ["plan_start", r.planStart], ["plan_end", r.planEnd]].some(([c, v]) => v && !same(old[c], v));
    const prodDiff = Number(old.production_qty) !== prod || Number(old.remain_qty) !== remain;
    if (!planDiff && !prodDiff) {
      unchanged++;
      continue;
    }
    updated++;
    if (planDiff) planRows.push(__spreadProps(__spreadValues({}, r), { productionQty: prod }));
    if (prodDiff || planDiff) prodRows.push({ po: r.po, productionQty: prod, remainQty: remain, status: r.planStatus });
  }
  const res = { ok: true, dry, received: list.length, inserted, updated, unchanged, stale, rejected, newCodesNoBom: [...newNoBom], cancelled: [] };
  if (dry) return res;
  return tx(db, () => {
    if (planRows.length) res.cancelled.push(...syncPoRows(db, planRows, { source: "API: MES", username: "api" }).cancelled);
    if (prodRows.length) res.cancelled.push(...updateProduction(db, prodRows, { source: "API: MES", username: "api" }).cancelled);
    const st = db.prepare("UPDATE po SET mes_synced_at = ? WHERE po_key = ?");
    for (const [s, k] of stamps) st.run(s, k);
    res.cancelled = [...new Set(res.cancelled)];
    settleLoads(db);
    return res;
  });
}
function updateProduction(db, rows, { source, username }) {
  if (!Array.isArray(rows) || !rows.length) throw fail("Kh\xF4ng c\xF3 d\xF2ng c\u1EADp nh\u1EADt n\xE0o.");
  const seen = /* @__PURE__ */ new Set();
  for (const r of rows) {
    const k = normalizePo(r.po);
    if (seen.has(k)) throw fail(`PO ${r.po} b\u1ECB l\u1EB7p trong d\u1EEF li\u1EC7u c\u1EADp nh\u1EADt.`);
    seen.add(k);
  }
  return tx(db, () => {
    const importId = Number(db.prepare("INSERT INTO import_log(kind, source, summary, created_by) VALUES (?,?,?,?)").run("PROD", source || "", "{}", username || "").lastInsertRowid);
    const hist = db.prepare("INSERT INTO po_history(po_key, import_id, kind, changes) VALUES (?,?,?,?)");
    const upd = db.prepare("UPDATE po SET production_qty = ?, remain_qty = ?, plan_status = ?, synced_at = datetime('now') WHERE po_key = ?");
    const unknown = [], cancelled = [], decreased = [];
    let updated = 0;
    for (const r of rows) {
      const k = normalizePo(r.po), old = db.prepare("SELECT * FROM po WHERE po_key = ?").get(k);
      if (!old) {
        unknown.push(String(r.po));
        continue;
      }
      const prod = Number(r.productionQty) || 0;
      const now = {
        production_qty: prod,
        remain_qty: r.remainQty === null || r.remainQty === void 0 ? Math.max(old.plan_qty - prod, 0) : Number(r.remainQty),
        plan_status: r.status ? r.status : old.plan_status
      };
      const diff = diffPo(old, now);
      if (!Object.keys(diff).length) continue;
      if (prod < old.production_qty) decreased.push(String(r.po));
      upd.run(now.production_qty, now.remain_qty, now.plan_status, k);
      const nowCancel = isCancelled(now) && !isCancelled(old);
      if (nowCancel) cancelled.push(String(r.po));
      hist.run(k, importId, nowCancel ? "cancel" : "prod", JSON.stringify(diff));
      updated++;
    }
    const summary = { total: rows.length, updated, unchanged: rows.length - updated - unknown.length, unknown, cancelled, decreased };
    db.prepare("UPDATE import_log SET summary = ? WHERE id = ?").run(JSON.stringify(__spreadProps(__spreadValues({}, summary), { unknown: unknown.slice(0, 200) })), importId);
    settleLoads(db);
    return summary;
  });
}
var PO_TYPES = { UNPLAN: { prefix: "UP", label: "Unplan" }, RMA: { prefix: "RM", label: "RMA" }, LOAD: { prefix: "TP", label: "Load th\xE0nh ph\u1EA9m" } };
function internalPoOptions(db) {
  return {
    types: Object.entries(PO_TYPES).map(([k, v]) => ({ key: k, label: v.label })),
    lines: db.prepare("SELECT name FROM lines WHERE active = 1 ORDER BY sort_order, name").all().map((r) => r.name),
    codes: db.prepare("SELECT b.model_code code, COALESCE(m.model, '') model FROM (SELECT DISTINCT model_code FROM bom) b LEFT JOIN model_map m ON m.model_code = b.model_code ORDER BY 2, 1").all()
  };
}
function createInternalPo(db, body, username) {
  const t4 = String((body == null ? void 0 : body.type) || "").toUpperCase(), type = PO_TYPES[t4];
  if (!type) throw fail("Ch\u1ECDn lo\u1EA1i PO: Unplan, RMA ho\u1EB7c Load th\xE0nh ph\u1EA9m.");
  const load = t4 === "LOAD";
  const modelCode = String((body == null ? void 0 : body.modelCode) || "").trim(), line = load ? "" : String((body == null ? void 0 : body.line) || "").trim(), qty = Number(body == null ? void 0 : body.qty);
  if (!db.prepare("SELECT 1 FROM bom WHERE model_code = ? LIMIT 1").get(modelCode)) throw fail(`Model Code "${modelCode}" ch\u01B0a c\xF3 BOM.`);
  if (!load && !db.prepare("SELECT 1 FROM lines WHERE name = ? AND active = 1").get(line)) throw fail("Ch\u1ECDn Line s\u1EA3n xu\u1EA5t c\xF3 trong danh s\xE1ch.");
  if (!Number.isInteger(qty) || qty < 1 || qty > 1e5) throw fail("S\u1ED1 l\u01B0\u1EE3ng l\xE0 s\u1ED1 nguy\xEAn 1\u2013100.000.");
  const now = new Date(Date.now() + 7 * 36e5).toISOString(), today = now.slice(0, 10);
  const planDate = /^\d{4}-\d{2}-\d{2}$/.test(String((body == null ? void 0 : body.planDate) || "")) ? body.planDate : today;
  const time = /^\d{2}:\d{2}$/.test(String((body == null ? void 0 : body.planTime) || "")) ? body.planTime : "";
  const refDoc = String((body == null ? void 0 : body.refDoc) || "").trim().slice(0, 60), note = String((body == null ? void 0 : body.note) || "").trim().slice(0, 200);
  if (!refDoc) throw fail(t4 === "RMA" ? "Nh\u1EADp s\u1ED1 RMA / ch\u1EE9ng t\u1EEB tham chi\u1EBFu." : load ? "Nh\u1EADp s\u1ED1 phi\u1EBFu xu\u1EA5t kho th\xE0nh ph\u1EA9m." : "Nh\u1EADp s\u1ED1 bi\xEAn b\u1EA3n x\xE1c nh\u1EADn l\u1ED7i.");
  const planQty = load ? -qty : qty;
  return tx(db, () => {
    const head = type.prefix + today.slice(2).replace(/-/g, "");
    const last = db.prepare("SELECT MAX(po_no) n FROM po WHERE po_no LIKE ?").get(`${head}%`).n;
    const seq = (last ? Number(String(last).slice(head.length)) : 0) + 1;
    if (seq > 9999) throw fail("Qu\xE1 9.999 PO n\u1ED9i b\u1ED9 c\xF9ng lo\u1EA1i trong ng\xE0y.");
    const po = head + String(seq).padStart(4, "0"), k = normalizePo(po);
    db.prepare(`INSERT INTO po (po_key, po_no, plan_date, master_line, basic_model, model_code, plan_qty, production_qty, remain_qty, plan_status,
        plan_start, plan_end, span_time, po_change, pending_type, po_type, fixed_line, ref_doc, note, created_by, in_source, synced_at)
      VALUES (?,?,?,'','',?,?,0,?,'',?,'','','','',?,?,?,?,?,1,datetime('now'))`).run(k, po, planDate, modelCode, planQty, planQty, time ? `${planDate}T${time}` : "", t4, line, refDoc, note, username || "");
    db.prepare("INSERT INTO po_history(po_key, import_id, kind, changes) VALUES (?,?,?,?)").run(
      k,
      null,
      "new",
      JSON.stringify({ po_type: [null, type.label], fixed_line: [null, line || null], plan_qty: [null, planQty], ref_doc: [null, refDoc], created_by: [null, username || ""] })
    );
    db.prepare("INSERT INTO audit_log(username, action, detail) VALUES (?, ?, ?)").run(username || "", "po.internal", JSON.stringify({ po, type: t4, modelCode, qty, line, refDoc }));
    return { ok: true, po, message: load ? `\u0110\xE3 t\u1EA1o PO Load th\xE0nh ph\u1EA9m ${po} \xB7 ${modelCode} \xB7 Kho c\u1EA5p ${qty} ea (PO \u2212${qty}) \u2014 g\u1ED9p v\xE0o Kit c\xF3 PO th\u1EADt c\xF9ng Model Code` : `\u0110\xE3 t\u1EA1o PO ${type.label} ${po} \xB7 ${modelCode} \xB7 ${qty} ea \xB7 ${line}` };
  });
}
function productionLog(db, limit = 20) {
  return db.prepare("SELECT id, source, summary, created_by, created_at FROM import_log WHERE kind = 'PROD' ORDER BY id DESC LIMIT ?").all(limit).map((r) => __spreadProps(__spreadValues({}, r), { summary: JSON.parse(r.summary || "{}") }));
}
function poHistory(db, po) {
  const key2 = normalizePo(po);
  const p = db.prepare("SELECT * FROM po WHERE po_key = ?").get(key2);
  if (!p) throw fail("Kh\xF4ng t\xECm th\u1EA5y PO.", 404);
  const rows = db.prepare(`SELECT h.id, h.kind, h.changes, h.created_at, l.source, l.created_by FROM po_history h
    LEFT JOIN import_log l ON l.id = h.import_id WHERE h.po_key = ? ORDER BY h.id DESC LIMIT 200`).all(key2);
  const kit = PO_TYPES[p.po_type] ? db.prepare(`SELECT k.code, (k.vln_status <> 'pending' OR k.hv_status <> 'pending' OR EXISTS (SELECT 1 FROM kit_item i WHERE i.kit_id = k.id AND i.kitted > 0)) locked
    FROM kit_order_po x JOIN kit_order k ON k.id = x.kit_id WHERE x.po_key = ?`).get(key2) : null;
  const internal = PO_TYPES[p.po_type] ? {
    type: p.po_type,
    label: PO_TYPES[p.po_type].label,
    modelCode: p.model_code,
    line: p.fixed_line || "",
    qty: p.po_type === "LOAD" ? -p.plan_qty : p.plan_qty,
    production: p.production_qty || 0,
    planDate: p.plan_date || "",
    planTime: String(p.plan_start || "").slice(11, 16),
    refDoc: p.ref_doc || "",
    note: p.note || "",
    cancelled: isCancelled(p),
    kit: (kit == null ? void 0 : kit.code) || "",
    locked: !!(kit == null ? void 0 : kit.locked)
  } : null;
  return { po: p.po_no, note: p.note || "", internal, rows: rows.map((r) => {
    const _a = JSON.parse(r.changes || "{}"), { _by } = _a, changes = __objRest(_a, ["_by"]);
    return { kind: r.kind, at: r.created_at, source: r.source || (_by ? r.kind === "edit" || r.kind === "cancel" ? _by : `Planner \xB7 ${_by}` : ""), by: r.created_by || _by || "", changes };
  }) };
}
function setPoNote(db, body, username) {
  var _a;
  const key2 = normalizePo(body == null ? void 0 : body.po), note = String((_a = body == null ? void 0 : body.note) != null ? _a : "").replace(/\s+/g, " ").trim().slice(0, 200);
  const p = db.prepare("SELECT po_no, note FROM po WHERE po_key = ?").get(key2);
  if (!p) throw fail("Kh\xF4ng t\xECm th\u1EA5y PO.", 404);
  const old = p.note || "";
  if (old === note) return { ok: true, po: p.po_no, note, message: "Ghi ch\xFA kh\xF4ng \u0111\u1ED5i." };
  return tx(db, () => {
    db.prepare("UPDATE po SET note = ? WHERE po_key = ?").run(note || null, key2);
    db.prepare("INSERT INTO po_history(po_key, import_id, kind, changes) VALUES (?,?,?,?)").run(key2, null, "note", JSON.stringify({ note: [old || null, note || null], _by: username || "" }));
    db.prepare("INSERT INTO audit_log(username, action, detail) VALUES (?, ?, ?)").run(username || "", "po.note", JSON.stringify({ po: p.po_no, note }));
    return { ok: true, po: p.po_no, note, message: note ? `\u0110\xE3 l\u01B0u ghi ch\xFA PO ${p.po_no}` : `\u0110\xE3 x\xF3a ghi ch\xFA PO ${p.po_no}` };
  });
}
function productionState(po) {
  if (isCancelled(po)) return "cancel";
  if (po.po_type === "LOAD") return po.int_status === "done" ? "done" : "waiting";
  if (Number(po.remain_qty) <= 0 && Number(po.production_qty) > 0) return "done";
  if (Number(po.production_qty) > 0) return "running";
  if (po.int_status === "running" && po.po_type && po.po_type !== "SAP") return "running";
  return "waiting";
}
function settleLoads(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'kit_order_po'").get()) return 0;
  const rows = db.prepare(`SELECT p.*, x.kit_id FROM po p JOIN kit_order_po x ON x.po_key = p.po_key JOIN kit_order k ON k.id = x.kit_id
    WHERE p.po_type = 'LOAD' AND COALESCE(p.int_status, '') <> 'done' AND k.vln_status = 'delivered'`).all();
  let n = 0;
  for (const p of rows) {
    if (isCancelled(p)) continue;
    const reals = db.prepare(`SELECT q.* FROM kit_order_po x JOIN po q ON q.po_key = x.po_key WHERE x.kit_id = ? AND COALESCE(q.po_type, 'SAP') <> 'LOAD'`).all(p.kit_id).filter((r) => !isCancelled(r));
    if (reals.some((r) => Number(r.remain_qty) > 0)) continue;
    db.prepare("UPDATE po SET production_qty = plan_qty, remain_qty = 0, int_status = 'done', synced_at = datetime('now') WHERE po_key = ?").run(p.po_key);
    db.prepare("INSERT INTO po_history(po_key, kind, changes) VALUES (?, 'prod', ?)").run(p.po_key, JSON.stringify({ int_status: [p.int_status || "waiting", "done"], remain_qty: [p.remain_qty, 0], _by: "T\u1EF1 \u0111\u1ED9ng: PO th\u1EADt c\xF9ng Kit \u0111\xE3 xong" }));
    n++;
  }
  return n;
}

// ../kitting-app/lib/planning.mjs
var vnDay = (ms) => new Date(ms + 7 * 36e5).toISOString().slice(0, 10);
function todayKey() {
  return vnDay(Date.now());
}
var nowVN = () => new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 16);
var fmtN = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
function assertLoads(pos) {
  const live = pos.filter((p) => !isCancelled(p)), loads = live.filter((p) => p.po_type === "LOAD");
  for (const code of new Set(loads.map((p) => p.model_code))) {
    const same = live.filter((p) => p.model_code === code), real = same.filter((p) => p.po_type !== "LOAD").reduce((a, p) => a + p.plan_qty, 0);
    const tp = -same.filter((p) => p.po_type === "LOAD").reduce((a, p) => a + p.plan_qty, 0);
    if (real <= 0) throw fail(`PO Load th\xE0nh ph\u1EA9m ${code} ph\u1EA3i g\u1ED9p v\u1EDBi PO th\u1EADt c\xF9ng Model Code ${code}.`);
    if (tp >= real) throw fail(`Th\xE0nh ph\u1EA9m ${code} (${fmtN(tp)} ea) ph\u1EA3i nh\u1ECF h\u01A1n t\u1ED5ng PO th\u1EADt c\xF9ng code (${fmtN(real)} ea).`);
  }
}
function dropOrphanLoads(db, kitId) {
  const pos = db.prepare("SELECT p.* FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = ?").all(kitId), out = [];
  for (const code of new Set(pos.filter((p) => p.po_type === "LOAD").map((p) => p.model_code))) {
    try {
      assertLoads(pos.filter((p) => p.model_code === code));
    } catch (e) {
      for (const l of pos.filter((p) => p.po_type === "LOAD" && p.model_code === code)) {
        db.prepare("DELETE FROM kit_order_po WHERE kit_id = ? AND po_key = ?").run(kitId, l.po_key);
        out.push(l.po_no);
      }
    }
  }
  if (out.length) {
    db.prepare("DELETE FROM kit_item WHERE kit_id = ?").run(kitId);
    if (!db.prepare("SELECT 1 FROM kit_order_po WHERE kit_id = ?").get(kitId)) db.prepare("DELETE FROM kit_order WHERE id = ?").run(kitId);
  }
  return out;
}
function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  const t4 = new Date(Date.UTC(y, m - 1, d + n));
  return t4.toISOString().slice(0, 10);
}
var validDay = (day) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw fail("Ng\xE0y kh\xF4ng h\u1EE3p l\u1EC7.");
  return day;
};
function poView(db, p) {
  return {
    poKey: p.po_key,
    po: p.po_no,
    planDate: p.plan_date,
    masterLine: p.master_line,
    basicModel: p.basic_model,
    modelCode: p.model_code,
    model: modelOf(db, p.model_code, p.basic_model),
    planQty: p.plan_qty,
    productionQty: p.production_qty,
    remainQty: p.remain_qty,
    planStatus: p.plan_status,
    planStart: p.plan_start || "",
    planEnd: p.plan_end || "",
    span: p.span_time || "",
    state: productionState(p),
    inSource: !!p.in_source,
    poType: p.po_type || "SAP",
    fixedLine: p.fixed_line || "",
    note: p.note || ""
  };
}
function aggregateState(pos) {
  const live = pos.filter((p) => p.state !== "cancel"), states = new Set((live.length ? live : pos).map((p) => p.state));
  if (states.size === 1) return [...states][0];
  return states.has("running") || states.has("done") ? "running" : "waiting";
}
var printedCodes = (db) => new Set(db.prepare("SELECT DISTINCT kit_code FROM kit_txn WHERE type = 'print'").all().map((r) => r.kit_code));
function kitView(db, kit, ro, printed) {
  var _a, _b, _c;
  const rank = (_a = ro == null ? void 0 : ro.rank) != null ? _a : null;
  const pos = db.prepare("SELECT p.* FROM kit_order_po k JOIN po p ON p.po_key = k.po_key WHERE k.kit_id = ? ORDER BY p.plan_date, p.plan_start, p.po_no").all(kit.id).map((p) => poView(db, p));
  const first = pos[0] || {};
  return {
    type: "kit",
    id: kit.id,
    code: kit.code,
    kind: kit.kind,
    modelCode: kit.model_code,
    model: first.model || kit.model_code,
    basicModel: first.basicModel || "",
    planDay: kit.plan_day,
    seq: kit.seq,
    rank,
    mrank: (_b = ro == null ? void 0 : ro.mrank) != null ? _b : null,
    round: (_c = ro == null ? void 0 : ro.round) != null ? _c : null,
    behind: !!(ro == null ? void 0 : ro.behind),
    line: kit.line || "",
    vlnStatus: kit.vln_status,
    hvStatus: kit.hv_status,
    planQty: pos.reduce((s, p) => s + p.planQty, 0),
    remainQty: pos.reduce((s, p) => s + p.remainQty, 0),
    productionQty: pos.reduce((s, p) => s + p.productionQty, 0),
    planDate: pos.map((p) => p.planDate).filter(Boolean).sort()[0] || "",
    planStart: pos.map((p) => p.planStart).filter(Boolean).sort()[0] || "",
    codes: [...new Set(pos.map((p) => p.modelCode))].sort(),
    masterLine: [...new Set(pos.map((p) => p.masterLine).filter(Boolean))].join(", "),
    state: aggregateState(pos),
    pos,
    cancelled: pos.filter((p) => p.state === "cancel").map((p) => p.po),
    fixedLine: pos.map((p) => p.fixedLine).find(Boolean) || "",
    planLine: kit.plan_line || "",
    internal: pos.filter((p) => p.poType !== "SAP").map((p) => ({ po: p.po, type: p.poType })),
    notes: pos.filter((p) => p.note).map((p) => ({ po: p.po, note: p.note })),
    loadTp: pos.filter((p) => p.poType === "LOAD").map((p) => ({ po: p.po, modelCode: p.modelCode, qty: -p.planQty })),
    locked: kit.vln_status !== "pending" || kit.hv_status !== "pending",
    printed: !!(printed == null ? void 0 : printed.has(kit.code))
  };
}
function kitQueueOrder(db) {
  const kits = db.prepare(`SELECT k.id, k.plan_day, k.seq, k.vln_status, k.hv_status, k.model_code,
      (SELECT p.basic_model FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = k.id LIMIT 1) AS basic,
      (SELECT MIN(p.plan_start) FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = k.id AND p.plan_start <> '') AS start
    FROM kit_order k WHERE k.plan_day IS NOT NULL AND k.vln_status <> 'delivered' ORDER BY k.plan_day, k.seq, k.id`).all();
  const s = getSettings(db), minPer = Number(s.vln_min_per_line) || 0;
  const linesOf = /* @__PURE__ */ new Map();
  const cs = currentShift(db), lm = /* @__PURE__ */ new Map();
  for (const c of [cs, cs.next].filter(Boolean)) for (const a of db.prepare("SELECT line, model FROM line_assign WHERE work_date = ? AND shift = ? AND model <> ''").all(c.day, c.shift)) {
    if (!lm.has(a.model)) lm.set(a.model, /* @__PURE__ */ new Set());
    lm.get(a.model).add(a.line);
  }
  for (const [m, set] of lm) linesOf.set(m, set.size);
  const waiting = /* @__PURE__ */ new Map(), mcount = /* @__PURE__ */ new Map(), out = /* @__PURE__ */ new Map();
  for (const k of kits) {
    k.model = modelOf(db, k.model_code, k.basic);
    if (k.vln_status === "done") waiting.set(k.model, (waiting.get(k.model) || 0) + 1);
  }
  for (const k of kits) {
    const n = (mcount.get(k.model) || 0) + 1;
    mcount.set(k.model, n);
    k.mrank = n;
  }
  const need = (m) => (linesOf.get(m) || 0) * minPer - (waiting.get(m) || 0);
  const models = [...new Set(kits.map((k) => k.model))].sort((a, b) => (linesOf.get(b) ? 1 : 0) - (linesOf.get(a) ? 1 : 0) || (need(b) > 0) - (need(a) > 0) || need(b) - need(a) || a.localeCompare(b));
  let rank = 0;
  for (const day of [...new Set(kits.map((k) => k.plan_day))]) {
    let round = 0;
    for (const group of [models.filter((m) => linesOf.get(m)), models.filter((m) => !linesOf.get(m))]) {
      const queues = new Map(group.map((m) => [m, kits.filter((k) => k.plan_day === day && k.model === m)]));
      while ([...queues.values()].some((q) => q.length)) {
        round++;
        for (const m of group) {
          const q = queues.get(m), take = Math.max(1, linesOf.get(m) || 0);
          for (const k of q.splice(0, take)) out.set(k.id, { rank: ++rank, mrank: k.mrank, round, day, model: m, short: need(m) > 0, idle: !linesOf.get(m) });
        }
      }
    }
  }
  const soon = new Date(Date.parse(`${nowVN()}:00Z`) + 24 * 36e5).toISOString().slice(0, 16), maxStart = /* @__PURE__ */ new Map();
  for (const k of [...kits].sort((a, b) => out.get(a.id).rank - out.get(b.id).rank)) {
    const o = out.get(k.id), mx = maxStart.get(k.model) || "";
    o.start = k.start || "";
    o.behind = !!(!(k.vln_status === "done" && k.hv_status === "done") && k.start && mx && k.start < mx && k.start < soon);
    if (k.start && k.start > mx) maxStart.set(k.model, k.start);
  }
  return out;
}
function board(db, { from, days = 4 }) {
  from = validDay(from || todayKey());
  days = Math.min(Math.max(Number(days) || 4, 1), 10);
  const ranks2 = kitQueueOrder(db);
  const dayList = Array.from({ length: days }, (_, i) => addDays(from, i));
  const printed = printedCodes(db);
  const columns = dayList.map((day) => ({ day, items: db.prepare("SELECT * FROM kit_order WHERE plan_day = ? ORDER BY seq, id").all(day).map((k) => kitView(db, k, ranks2.get(k.id), printed)) }));
  const poolPos = db.prepare(`SELECT p.* FROM po p WHERE p.in_source = 1 AND (p.remain_qty > 0 OR (p.po_type = 'LOAD' AND COALESCE(p.int_status, '') <> 'done')) AND ${notCancelledSql("p.")}
    AND NOT EXISTS (SELECT 1 FROM kit_order_po k WHERE k.po_key = p.po_key)
    ORDER BY CASE WHEN p.plan_start IS NULL OR p.plan_start = '' THEN 1 ELSE 0 END, p.plan_start, p.plan_date, p.po_no`).all().map((p) => __spreadValues({ type: "po", id: p.po_key, code: p.po_no }, poView(db, p)));
  const poolKits = db.prepare("SELECT * FROM kit_order WHERE plan_day IS NULL ORDER BY id").all().map((k) => kitView(db, k, null, printed));
  const byStart = (a, b) => (a.planStart ? 0 : 1) - (b.planStart ? 0 : 1) || String(a.planStart).localeCompare(String(b.planStart)) || String(a.code).localeCompare(String(b.code));
  const pool = [...poolKits, ...poolPos].sort(byStart);
  const last = dayList.at(-1);
  const outside = {
    before: db.prepare("SELECT COUNT(*) n FROM kit_order WHERE plan_day < ?").get(from).n,
    after: db.prepare("SELECT COUNT(*) n FROM kit_order WHERE plan_day > ?").get(last).n,
    firstBefore: db.prepare("SELECT MIN(plan_day) d FROM kit_order WHERE plan_day < ?").get(from).d
  };
  const models = [...new Set(pool.map((i) => i.model))].sort();
  return { from, days, today: todayKey(), now: nowVN(), columns, pool, models, outside, mergeMax: Number(getSettings(db).merge_max_qty) || 2500, autoMaxDay: Number(getSettings(db).auto_max_kits_day) || 0 };
}
function loadKit(db, id) {
  const kit = db.prepare("SELECT * FROM kit_order WHERE id = ?").get(Number(id));
  if (!kit) throw fail("Kit PO kh\xF4ng c\xF2n t\u1ED3n t\u1EA1i. H\xE3y t\u1EA3i l\u1EA1i b\u1EA3ng.", 409);
  return kit;
}
var kitLocked = (kit) => kit.vln_status !== "pending" || kit.hv_status !== "pending";
var kitPrinted = (db, kit) => !!db.prepare("SELECT 1 FROM kit_txn WHERE type = 'print' AND kit_code = ? LIMIT 1").get(kit.code);
function assertKitFree(db, kit, act) {
  if (kitLocked(kit)) throw fail(`${kit.code} Kho \u0111\xE3 b\u1EAFt \u0111\u1EA7u kitting, kh\xF4ng ${act} \u0111\u01B0\u1EE3c.`);
  if (kitPrinted(db, kit)) throw fail(`${kit.code} Kho \u0111\xE3 in phi\u1EBFu kitting, kh\xF4ng ${act} \u0111\u01B0\u1EE3c.`);
}
function createSingleKit(db, poKey, day, seq, username) {
  const p = db.prepare("SELECT * FROM po WHERE po_key = ?").get(poKey);
  if (!p) throw fail("PO kh\xF4ng c\xF2n trong d\u1EEF li\u1EC7u. H\xE3y t\u1EA3i l\u1EA1i b\u1EA3ng.", 409);
  if (isCancelled(p)) throw fail(`PO ${p.po_no} \u0111\xE3 h\u1EE7y (Cancel), kh\xF4ng l\u1EADp k\u1EBF ho\u1EA1ch \u0111\u01B0\u1EE3c.`);
  if (p.po_type === "LOAD") throw fail(`${p.po_no} l\xE0 PO Load th\xE0nh ph\u1EA9m: kh\xF4ng kitting ri\xEAng, ch\u1ECDn c\xF9ng PO / Kit th\u1EADt c\xF9ng Model Code r\u1ED3i b\u1EA5m G\u1ED9p.`);
  if (db.prepare("SELECT 1 FROM kit_order_po WHERE po_key = ?").get(poKey)) throw fail(`PO ${p.po_no} \u0111\xE3 \u0111\u01B0\u1EE3c l\u1EADp k\u1EBF ho\u1EA1ch \u1EDF n\u01A1i kh\xE1c. H\xE3y t\u1EA3i l\u1EA1i b\u1EA3ng.`, 409);
  const res = db.prepare("INSERT INTO kit_order(code, kind, model_code, plan_day, seq, created_by) VALUES (?, 'single', ?, ?, ?, ?)").run(p.po_no, p.model_code, day, seq, username);
  db.prepare("INSERT INTO kit_order_po(kit_id, po_key) VALUES (?, ?)").run(res.lastInsertRowid, poKey);
  return Number(res.lastInsertRowid);
}
function applyColumns(db, columns, username) {
  if (!Array.isArray(columns) || !columns.length) throw fail("Kh\xF4ng c\xF3 thay \u0111\u1ED5i.");
  return tx(db, () => {
    let moved = 0;
    for (const col of columns) {
      const day = col.day === null ? null : validDay(col.day);
      const items2 = Array.isArray(col.items) ? col.items : [];
      items2.forEach((item, index) => {
        if (item.type === "po") {
          if (day) {
            createSingleKit(db, String(item.id), day, index, username);
            moved++;
          }
          return;
        }
        const kit = loadKit(db, item.id);
        if (day === null) {
          if (kitLocked(kit)) throw fail(`${kit.code} \u0111\xE3 b\u1EAFt \u0111\u1EA7u kitting, kh\xF4ng \u0111\u01B0a v\u1EC1 PO ch\u01B0a l\u1EADp \u0111\u01B0\u1EE3c.`);
          if (kit.kind === "single") {
            db.prepare("DELETE FROM kit_order WHERE id = ?").run(kit.id);
            moved++;
            return;
          }
          db.prepare("UPDATE kit_order SET plan_day = NULL, seq = ?, updated_at = datetime('now') WHERE id = ?").run(index, kit.id);
          return;
        }
        if (kit.plan_day !== day) moved++;
        db.prepare("UPDATE kit_order SET plan_day = ?, seq = ?, updated_at = datetime('now') WHERE id = ?").run(day, index, kit.id);
      });
    }
    audit(db, username, "plan.move", { columns: columns.map((c) => ({ day: c.day, n: (c.items || []).length })) });
    return { ok: true, moved };
  });
}
function nextMergedCode(db) {
  const d = todayKey().replace(/-/g, "").slice(2);
  const prefix = `K-${d}-`;
  const last = db.prepare("SELECT code FROM kit_order WHERE code LIKE ? ORDER BY code DESC LIMIT 1").get(`${prefix}%`);
  const n = last ? Number(last.code.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(2, "0")}`;
}
function merge(db, items2, username) {
  if (!Array.isArray(items2) || items2.length < 2) throw fail("Ch\u1ECDn \xEDt nh\u1EA5t 2 PO \u0111\u1EC3 g\u1ED9p.");
  return tx(db, () => {
    const poKeys = [], oldKits = [];
    let place = { day: null, seq: 0 };
    items2.forEach((item) => {
      if (item.type === "po") {
        const key2 = normalizePo(item.id);
        if (db.prepare("SELECT 1 FROM kit_order_po WHERE po_key = ?").get(key2)) throw fail("C\xF3 PO \u0111\xE3 \u0111\u01B0\u1EE3c l\u1EADp k\u1EBF ho\u1EA1ch \u1EDF n\u01A1i kh\xE1c. H\xE3y t\u1EA3i l\u1EA1i b\u1EA3ng.", 409);
        poKeys.push(key2);
      } else {
        const kit = loadKit(db, item.id);
        assertKitFree(db, kit, "g\u1ED9p");
        oldKits.push(kit);
        if (!place.day && kit.plan_day) place = { day: kit.plan_day, seq: kit.seq };
        db.prepare("SELECT po_key FROM kit_order_po WHERE kit_id = ?").all(kit.id).forEach((r) => poKeys.push(r.po_key));
      }
    });
    if (new Set(poKeys).size !== poKeys.length) throw fail("Danh s\xE1ch g\u1ED9p c\xF3 PO b\u1ECB l\u1EB7p.");
    if (poKeys.length < 2) throw fail("C\u1EA7n \xEDt nh\u1EA5t 2 PO g\u1ED1c \u0111\u1EC3 g\u1ED9p.");
    const pos = poKeys.map((k) => db.prepare("SELECT * FROM po WHERE po_key = ?").get(k));
    if (pos.some((p) => !p)) throw fail("C\xF3 PO kh\xF4ng c\xF2n trong d\u1EEF li\u1EC7u. H\xE3y t\u1EA3i l\u1EA1i b\u1EA3ng.", 409);
    const fixed = [...new Set(pos.map((p) => p.fixed_line).filter(Boolean))];
    if (fixed.length > 1) throw fail(`Kh\xF4ng g\u1ED9p PO n\u1ED9i b\u1ED9 \u1EA5n \u0111\u1ECBnh kh\xE1c Line: ${fixed.join(", ")}.`);
    const cx = pos.filter(isCancelled).map((p) => p.po_no);
    if (cx.length) throw fail(`PO \u0111\xE3 h\u1EE7y (Cancel), kh\xF4ng g\u1ED9p \u0111\u01B0\u1EE3c: ${cx.join(", ")}.`);
    const models = new Set(pos.map((p) => modelOf(db, p.model_code, p.basic_model)));
    if (models.size > 1) throw fail(`Ch\u1EC9 g\u1ED9p \u0111\u01B0\u1EE3c c\xE1c PO c\xF9ng Model. \u0110ang ch\u1ECDn: ${[...models].join(", ")}.`);
    assertLoads(pos);
    const maxQty = Number(getSettings(db).merge_max_qty) || 2500, total = pos.reduce((s, p) => s + p.plan_qty, 0);
    pos.sort((a, b) => String(a.plan_start || "").localeCompare(String(b.plan_start || "")) || String(a.po_no).localeCompare(String(b.po_no)));
    const host = oldKits.find((k) => k.kind === "merged");
    for (const kit of oldKits) if (kit !== host) db.prepare("DELETE FROM kit_order WHERE id = ?").run(kit.id);
    let id, code;
    if (host) {
      id = host.id;
      code = host.code;
      const have = new Set(db.prepare("SELECT po_key FROM kit_order_po WHERE kit_id = ?").all(id).map((r) => r.po_key));
      for (const k of poKeys) if (!have.has(k)) db.prepare("INSERT INTO kit_order_po(kit_id, po_key) VALUES (?, ?)").run(id, k);
      db.prepare("DELETE FROM kit_item WHERE kit_id = ?").run(id);
      if (!host.plan_day && place.day) {
        db.prepare("UPDATE kit_order SET plan_day = ?, seq = ?, updated_at = datetime('now') WHERE id = ?").run(place.day, place.seq, id);
        renumberDay(db, place.day, id, place.seq);
      } else db.prepare("UPDATE kit_order SET updated_at = datetime('now') WHERE id = ?").run(id);
    } else {
      code = nextMergedCode(db);
      const res = db.prepare("INSERT INTO kit_order(code, kind, model_code, plan_day, seq, created_by) VALUES (?, 'merged', ?, ?, ?, ?)").run(code, pos[0].model_code, place.day, place.seq, username);
      id = Number(res.lastInsertRowid);
      for (const k of poKeys) db.prepare("INSERT INTO kit_order_po(kit_id, po_key) VALUES (?, ?)").run(id, k);
      if (place.day) renumberDay(db, place.day, id, place.seq);
    }
    audit(db, username, "plan.merge", { code, into: host ? host.code : null, pos: pos.map((p) => p.po_no), total });
    const nCodes = new Set(pos.map((p) => p.model_code)).size, over = total > maxQty;
    return {
      ok: true,
      code,
      count: pos.length,
      qty: total,
      over,
      message: `${host ? `\u0110\xE3 g\u1ED9p th\xEAm v\xE0o ${code}` : `\u0110\xE3 g\u1ED9p th\xE0nh ${code}`}: ${pos.length} PO (${nCodes > 1 ? `${nCodes} Model Code` : pos[0].model_code}, ${fmtN(total)} ea)${over ? ` \xB7 v\u01B0\u1EE3t gi\u1EDBi h\u1EA1n g\u1ED9p ${fmtN(maxQty)} ea` : ""}.`
    };
  });
}
function renumberDay(db, day, pinnedId, pinnedSeq) {
  const rows = db.prepare("SELECT id FROM kit_order WHERE plan_day = ? AND id <> ? ORDER BY seq, id").all(day, pinnedId).map((r) => r.id);
  rows.splice(Math.min(pinnedSeq, rows.length), 0, pinnedId);
  const upd = db.prepare("UPDATE kit_order SET seq = ? WHERE id = ?");
  rows.forEach((id, i) => upd.run(i, id));
}
function split(db, kitId, username) {
  return tx(db, () => {
    const kit = loadKit(db, kitId);
    if (kit.kind !== "merged") throw fail("Ch\u1EC9 t\xE1ch \u0111\u01B0\u1EE3c Kit PO g\u1ED9p.");
    assertKitFree(db, kit, "t\xE1ch");
    const keys = db.prepare("SELECT po_key FROM kit_order_po WHERE kit_id = ? ORDER BY po_key").all(kit.id).map((r) => r.po_key);
    db.prepare("DELETE FROM kit_order WHERE id = ?").run(kit.id);
    if (kit.plan_day) {
      const others = db.prepare("SELECT id FROM kit_order WHERE plan_day = ? ORDER BY seq, id").all(kit.plan_day).map((r) => r.id);
      const created = keys.filter((k) => {
        var _a;
        return ((_a = db.prepare("SELECT po_type FROM po WHERE po_key = ?").get(k)) == null ? void 0 : _a.po_type) !== "LOAD";
      }).map((k) => createSingleKit(db, k, kit.plan_day, 0, username));
      others.splice(Math.min(kit.seq, others.length), 0, ...created);
      others.forEach((id, i) => db.prepare("UPDATE kit_order SET seq = ? WHERE id = ?").run(i, id));
    }
    audit(db, username, "plan.split", { code: kit.code, pos: keys });
    return { ok: true, message: `\u0110\xE3 t\xE1ch ${kit.code} th\xE0nh ${keys.length} PO${kit.plan_day ? " (gi\u1EEF nguy\xEAn ng\xE0y kitting)" : " v\u1EC1 danh s\xE1ch PO ch\u01B0a l\u1EADp"}.` };
  });
}
function shifts(db) {
  return getSettings(db).shifts.split(",").map((s) => s.trim()).filter(Boolean);
}
function currentShift(db, at = nowVN()) {
  const names = shifts(db), starts = String(getSettings(db).shift_starts || "").split(",").map((s) => s.trim());
  let day = at.slice(0, 10);
  const t4 = at.slice(11, 16);
  if (names.length < 2 || starts.length < names.length || starts.some((s) => !/^\d\d:\d\d$/.test(s))) return { day, shift: names[0], start: "", next: null };
  let i = -1;
  starts.slice(0, names.length).forEach((s, k) => {
    if (s <= t4) i = k;
  });
  if (i < 0) {
    i = names.length - 1;
    day = addDays(day, -1);
  }
  const next = i + 1 < names.length ? { day, shift: names[i + 1], start: starts[i + 1] } : { day: addDays(day, 1), shift: names[0], start: starts[0] };
  return { day, shift: names[i], start: starts[i], next };
}
var validShift = (db, shift) => {
  if (!shifts(db).includes(shift)) throw fail("Ca kh\xF4ng h\u1EE3p l\u1EC7.");
  return shift;
};
function modelList(db) {
  const fromPo = db.prepare("SELECT DISTINCT model_code, basic_model FROM po WHERE in_source = 1").all().map((r) => modelOf(db, r.model_code, r.basic_model));
  const fromMap = db.prepare("SELECT DISTINCT model FROM model_map").all().map((r) => r.model);
  return [.../* @__PURE__ */ new Set([...fromPo, ...fromMap])].sort();
}
function getAssign(db, day, shift) {
  validDay(day);
  validShift(db, shift);
  const lines = db.prepare("SELECT name FROM lines WHERE active = 1 ORDER BY sort_order, name").all().map((r) => r.name);
  const map = new Map(db.prepare("SELECT line, model, updated_by, updated_at FROM line_assign WHERE work_date = ? AND shift = ?").all(day, shift).map((r) => [r.line, r]));
  return { day, shift, shifts: shifts(db), models: modelList(db), rows: lines.map((line) => {
    var _a, _b;
    return { line, model: ((_a = map.get(line)) == null ? void 0 : _a.model) || "", updatedBy: ((_b = map.get(line)) == null ? void 0 : _b.updated_by) || "" };
  }) };
}
function saveAssign(db, { day, shift, rows }, username) {
  validDay(day);
  validShift(db, shift);
  if (!Array.isArray(rows)) throw fail("Kh\xF4ng c\xF3 d\u1EEF li\u1EC7u Line.");
  const lines = new Set(db.prepare("SELECT name FROM lines WHERE active = 1").all().map((r) => r.name));
  return tx(db, () => {
    const del = db.prepare("DELETE FROM line_assign WHERE work_date = ? AND shift = ? AND line = ?");
    const ins = db.prepare("INSERT INTO line_assign(work_date, shift, line, model, updated_by) VALUES (?,?,?,?,?)");
    for (const r of rows) {
      if (!lines.has(r.line)) throw fail(`Line ${r.line} kh\xF4ng h\u1EE3p l\u1EC7.`);
      del.run(day, shift, r.line);
      const model = String(r.model || "").trim();
      if (model) ins.run(day, shift, r.line, model, username);
    }
    audit(db, username, "line.assign", { day, shift, rows });
    return { ok: true };
  });
}
function copyAssign(db, { fromDay, fromShift, toDay: toDay2, toShift }, username) {
  validDay(fromDay);
  validDay(toDay2);
  validShift(db, fromShift);
  validShift(db, toShift);
  const rows = db.prepare("SELECT line, model FROM line_assign WHERE work_date = ? AND shift = ?").all(fromDay, fromShift);
  if (!rows.length) throw fail("Ca ngu\u1ED3n ch\u01B0a khai b\xE1o Line n\xE0o.");
  return tx(db, () => {
    db.prepare("DELETE FROM line_assign WHERE work_date = ? AND shift = ?").run(toDay2, toShift);
    const ins = db.prepare("INSERT INTO line_assign(work_date, shift, line, model, updated_by) VALUES (?,?,?,?,?)");
    for (const r of rows) ins.run(toDay2, toShift, r.line, r.model, username);
    audit(db, username, "line.copy", { fromDay, fromShift, toDay: toDay2, toShift });
    return { ok: true, count: rows.length };
  });
}
var pendingOf = (db, r) => r && r.pending_qty > 0 && r.pending_day === currentShift(db).day ? r.pending_qty : 0;
function clearExpiredPending(db) {
  return Number(db.prepare("UPDATE line_params SET pending_qty = 0, pending_day = NULL WHERE pending_qty > 0 AND (pending_day IS NULL OR pending_day <> ?)").run(currentShift(db).day).changes);
}
function getParams(db) {
  const rows = db.prepare("SELECT * FROM line_params ORDER BY line, model").all();
  const known = new Set(rows.map((r) => `${r.line}${r.model}`));
  const missing = db.prepare("SELECT DISTINCT line, model FROM line_assign WHERE work_date >= ? ORDER BY line, model").all(addDays(todayKey(), -1)).filter((r) => !known.has(`${r.line}${r.model}`));
  return {
    rows: rows.map((r) => {
      var _a;
      return { line: r.line, model: r.model, spreadQty: r.spread_qty, pendingQty: pendingOf(db, r), pendingExpired: r.pending_qty > 0 && !pendingOf(db, r), uph: (_a = r.uph) != null ? _a : null, note: r.note || "", updatedBy: r.updated_by, updatedAt: r.updated_at };
    }),
    missing: missing.map((r) => ({ line: r.line, model: r.model })),
    threshold: Number(getSettings(db).supply_threshold),
    workDay: currentShift(db).day,
    // Gợi ý cho cặp Line + Model chưa khai: số mới nhất của cùng Model ở Line khác.
    suggest: Object.fromEntries(db.prepare("SELECT model, line, spread_qty, uph FROM line_params ORDER BY updated_at").all().map((r) => {
      var _a;
      return [r.model, { line: r.line, spreadQty: r.spread_qty, uph: (_a = r.uph) != null ? _a : null }];
    }))
  };
}
function saveParams(db, rows, username) {
  if (!Array.isArray(rows) || !rows.length) throw fail("Kh\xF4ng c\xF3 d\xF2ng n\xE0o \u0111\u1EC3 l\u01B0u.");
  const lines = new Set(db.prepare("SELECT name FROM lines").all().map((r) => r.name));
  return tx(db, () => {
    var _a;
    const up = db.prepare(`INSERT INTO line_params(line, model, spread_qty, pending_qty, pending_day, uph, note, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(line, model) DO UPDATE SET spread_qty = excluded.spread_qty, pending_qty = excluded.pending_qty, pending_day = excluded.pending_day, uph = excluded.uph, note = excluded.note,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at`);
    const old = db.prepare("SELECT * FROM line_params WHERE line = ? AND model = ?"), day = currentShift(db).day;
    for (const r of rows) {
      const line = String(r.line || "").trim(), model = String(r.model || "").trim();
      if (!lines.has(line)) throw fail(`Line "${line}" kh\xF4ng h\u1EE3p l\u1EC7.`);
      if (!model) throw fail(`D\xF2ng ${line}: ch\u1ECDn Model.`);
      const spread = Number(r.spreadQty), pending3 = Number(r.pendingQty);
      if (!Number.isFinite(spread) || spread < 0 || !Number.isFinite(pending3) || pending3 < 0) throw fail(`${line} / ${model}: s\u1ED1 r\u1EA3i chuy\u1EC1n v\xE0 pending ph\u1EA3i \u2265 0.`);
      const o = old.get(line, model);
      const uph = r.uph === void 0 ? (_a = o == null ? void 0 : o.uph) != null ? _a : null : r.uph === "" || r.uph === null ? null : Number(r.uph);
      if (uph !== null && (!Number.isFinite(uph) || uph < 0)) throw fail(`${line} / ${model}: UPH ph\u1EA3i \u2265 0.`);
      up.run(line, model, spread, pending3, pending3 > 0 ? day : null, uph || null, String(r.note === void 0 ? (o == null ? void 0 : o.note) || "" : r.note || "").slice(0, 200), username);
    }
    audit(db, username, "line.params", rows);
    return { ok: true, count: rows.length };
  });
}
function deleteParam(db, { line, model }, username) {
  const res = db.prepare("DELETE FROM line_params WHERE line = ? AND model = ?").run(line, model);
  audit(db, username, "line.params.delete", { line, model });
  return { ok: res.changes > 0 };
}
function vlnOverview(db, day, shift) {
  validDay(day);
  validShift(db, shift);
  const s = getSettings(db), minPer = Number(s.vln_min_per_line), maxPer = Number(s.vln_max_per_line);
  const assigns = db.prepare("SELECT line, model FROM line_assign WHERE work_date = ? AND shift = ?").all(day, shift);
  const linesByModel = /* @__PURE__ */ new Map();
  for (const a of assigns) {
    if (!linesByModel.has(a.model)) linesByModel.set(a.model, []);
    linesByModel.get(a.model).push(a.line);
  }
  const kits = db.prepare("SELECT k.*, (SELECT p.basic_model FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = k.id LIMIT 1) AS basic FROM kit_order k").all();
  const byModel = /* @__PURE__ */ new Map();
  const bucket = (m) => {
    if (!byModel.has(m)) byModel.set(m, { planned: 0, kitted: 0, delivered: 0 });
    return byModel.get(m);
  };
  for (const k of kits) {
    const model = modelOf(db, k.model_code, k.basic);
    if (k.vln_status === "done") bucket(model).kitted++;
    else if (k.vln_status === "delivered") bucket(model).delivered++;
    else if (k.plan_day) bucket(model).planned++;
  }
  const unplanned = /* @__PURE__ */ new Map();
  for (const r of db.prepare(`SELECT model_code, basic_model FROM po p WHERE in_source = 1 AND remain_qty > 0 AND ${notCancelledSql("p.")} AND NOT EXISTS (SELECT 1 FROM kit_order_po k WHERE k.po_key = p.po_key)`).all()) {
    const m = modelOf(db, r.model_code, r.basic_model);
    unplanned.set(m, (unplanned.get(m) || 0) + 1);
  }
  const models = [.../* @__PURE__ */ new Set([...linesByModel.keys()])].sort();
  return {
    day,
    shift,
    minPer,
    maxPer,
    rows: models.map((model) => {
      const lines = linesByModel.get(model) || [], b = byModel.get(model) || { planned: 0, kitted: 0 };
      const min = lines.length * minPer, max = lines.length * maxPer;
      const status = b.kitted < min ? "short" : b.kitted > max ? "over" : "ok";
      return { model, lines, min, max, waiting: b.kitted, planned: b.planned, unplanned: unplanned.get(model) || 0, status, needMore: Math.max(min - b.kitted, 0) };
    })
  };
}

// ../kitting-app/lib/bom.mjs
var key = (v) => String(v != null ? v : "").replace(/[đĐ]/g, "d").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
function normalizeGroup(value) {
  const k = key(value);
  if (!k) return null;
  if (k === "vln" || k.includes("vatlieunho")) return "VLN";
  if (k === "vldt" || k.includes("dattien")) return "VLDT";
  if (k === "rear") return "REAR";
  throw fail(`Nh\xF3m kitting "${value}" kh\xF4ng h\u1EE3p l\u1EC7. D\xF9ng VLN, VL\u0110T ho\u1EB7c Rear.`);
}
var isRearDesc = (d) => /^\s*ASSY\s+(CASE|METAL\s+FRT)/i.test(d || "") && !/MAGNET/i.test(d || "");
function suggestGroups(db, onlyCodes) {
  const only = onlyCodes ? new Set(onlyCodes) : null;
  const rows = db.prepare(`SELECT b.id, b.model_code, b.material, b.description, b.point, COALESCE(m.model, b.model_code) AS model
    FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code WHERE b.kit_group IS NULL OR b.group_source = 'auto'`).all().filter((r) => !only || only.has(r.model_code));
  if (!rows.length) return 0;
  const all = db.prepare("SELECT b.model_code, b.material, b.point, COALESCE(m.model, b.model_code) AS model FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code").all();
  const codesByModel = /* @__PURE__ */ new Map(), byMaterial = /* @__PURE__ */ new Map();
  for (const r of all) {
    if (!codesByModel.has(r.model)) codesByModel.set(r.model, /* @__PURE__ */ new Set());
    codesByModel.get(r.model).add(r.model_code);
    const k = `${r.model}${r.material}`;
    if (!byMaterial.has(k)) byMaterial.set(k, []);
    byMaterial.get(k).push(r);
  }
  const update = db.prepare("UPDATE bom SET kit_group = ?, group_source = 'auto' WHERE id = ?");
  for (const r of rows) {
    let group;
    if (isRearDesc(r.description)) group = "REAR";
    else {
      const codes = codesByModel.get(r.model), same = byMaterial.get(`${r.model}${r.material}`) || [];
      const everywhere = same.length === codes.size && new Set(same.map((x) => x.point)).size === 1;
      group = codes.size === 1 || everywhere ? "VLN" : "VLDT";
    }
    update.run(group, r.id);
  }
  return rows.length;
}
var MAX_CHANGED_CODES = 20;
function planBom(db, parsed) {
  var _a;
  const byCode = /* @__PURE__ */ new Map();
  for (const r of parsed.rows) {
    if (!byCode.has(r.modelCode)) byCode.set(r.modelCode, []);
    byCode.get(r.modelCode).push(r);
  }
  const names = /* @__PURE__ */ new Map();
  for (const r of db.prepare("SELECT DISTINCT model FROM model_map").all()) names.set(r.model.replace(/\s+/g, " ").toUpperCase(), r.model);
  const plan = { newCodes: [], changed: [], unchanged: 0, renameIgnored: [], newModels: [], noModel: [], write: [] };
  for (const [code, rows] of byCode) {
    const cur = (_a = db.prepare("SELECT model FROM model_map WHERE model_code = ?").get(code)) == null ? void 0 : _a.model, inFile = parsed.modelMap.get(code);
    const old = db.prepare("SELECT * FROM bom WHERE model_code = ?").all(code), oldBy = new Map(old.map((o) => [o.material, o]));
    let model = cur;
    if (cur) {
      if (inFile && inFile.toUpperCase() !== cur.toUpperCase()) plan.renameIgnored.push({ code, inFile, kept: cur });
    } else if (!inFile) {
      plan.noModel.push(code);
      continue;
    } else {
      const k = inFile.replace(/\s+/g, " ").toUpperCase();
      model = names.get(k) || inFile;
      if (!names.has(k)) {
        names.set(k, model);
        plan.newModels.push(model);
      }
    }
    const merged = rows.map((r) => {
      const o = oldBy.get(r.material);
      return __spreadProps(__spreadValues({}, r), { group: r.group || (o == null ? void 0 : o.kit_group) || null, source: r.group ? "file" : o ? o.group_source : "auto" });
    });
    const wanted = new Set(rows.map((r) => r.material));
    const added = rows.filter((r) => !oldBy.has(r.material)).length, removed = old.filter((o) => !wanted.has(o.material)).length;
    const diffPoint = merged.filter((r) => oldBy.has(r.material) && Number(oldBy.get(r.material).point) !== Number(r.point)).length;
    const diffGroup = merged.filter((r) => oldBy.has(r.material) && oldBy.get(r.material).kit_group !== r.group).length;
    const diffText = merged.filter((r) => {
      var _a2;
      const o = oldBy.get(r.material);
      return o && (r.description && o.description !== r.description || r.process && String((_a2 = o.process) != null ? _a2 : "") !== r.process);
    }).length;
    if (!old.length) plan.newCodes.push({ code, model, rows: rows.length });
    else if (added || removed || diffPoint || diffGroup || diffText) plan.changed.push({ code, model, oldRows: old.length, newRows: rows.length, added, removed, diffPoint, diffGroup, diffText });
    else {
      plan.unchanged++;
      continue;
    }
    plan.write.push({ code, model, cur, rows: merged });
  }
  return plan;
}
function importBom(db, parsed, { source, username, dry = false, maxChanged = MAX_CHANGED_CODES }) {
  const plan = planBom(db, parsed), _a = plan, { write } = _a, view2 = __objRest(_a, ["write"]);
  const base = __spreadProps(__spreadValues({}, view2), { rows: parsed.rows.length, models: new Set(write.map((w) => w.model)).size, dup: parsed.dup || 0, maxChanged });
  if (plan.noModel.length) throw fail(`Model Code m\u1EDBi ch\u01B0a ghi Model: ${plan.noModel.slice(0, 10).join(", ")}${plan.noModel.length > 10 ? "\u2026" : ""}. \u0110i\u1EC1n c\u1ED9t Model trong file.`);
  if (plan.changed.length > maxChanged) throw fail(`File \u0111ang thay BOM c\u1EE7a ${plan.changed.length} Model Code \u0111\xE3 c\xF3 (t\u1ED1i \u0111a ${maxChanged} m\u1ED7i l\u1EA7n). Ch\u1EC9 \u0111\u01B0a v\xE0o file c\xE1c code th\u1EADt s\u1EF1 c\u1EA7n c\u1EADp nh\u1EADt.`);
  if (dry) return base;
  return tx(db, () => {
    const firstLoad = !db.prepare("SELECT 1 FROM bom LIMIT 1").get();
    const addMap = db.prepare("INSERT INTO model_map(model_code, model) VALUES (?, ?) ON CONFLICT(model_code) DO NOTHING");
    if (firstLoad) for (const [code, model] of parsed.modelMap) addMap.run(code, model);
    const del = db.prepare("DELETE FROM bom WHERE model_code = ?");
    const ins = db.prepare("INSERT INTO bom(model_code, material, description, point, process, kit_group, group_source) VALUES (?,?,?,?,?,?,?)");
    for (const w of write) {
      if (!w.cur) addMap.run(w.code, w.model);
      del.run(w.code);
      for (const r of w.rows) ins.run(w.code, r.material, r.description, r.point, r.process, r.group, r.source);
    }
    const suggested = suggestGroups(db, write.map((w) => w.code));
    rebuildVln(db, [...new Set(write.map((w) => w.model))]);
    if (firstLoad) {
      const setP = db.prepare("UPDATE bom_vln SET point = ?, source = 'manual' WHERE model = ? AND material = ? AND point <> ?");
      for (const v of parsed.vln || []) setP.run(v.point, v.model, v.material, v.point);
    }
    const count = (g) => db.prepare("SELECT COUNT(*) n FROM bom WHERE kit_group = ?").get(g).n;
    const codes = write.map((w) => w.code), noRear = codes.filter((c) => !db.prepare("SELECT 1 FROM bom WHERE model_code = ? AND kit_group = 'REAR' LIMIT 1").get(c)).sort();
    const touched = new Set(write.map((w) => w.model));
    const single = db.prepare(`SELECT ${MODEL} model FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code GROUP BY 1 HAVING COUNT(DISTINCT b.model_code) = 1 ORDER BY 1`).all().map((r) => r.model).filter((m) => touched.has(m));
    const summary = __spreadProps(__spreadValues({}, base), { suggested, groups: { REAR: count("REAR"), VLDT: count("VLDT"), VLN: count("VLN") }, noRear, single });
    db.prepare("INSERT INTO import_log(kind, source, summary, created_by) VALUES (?,?,?,?)").run("BOM", source || "", JSON.stringify(summary), username || "");
    audit(db, username, "bom.import", { source, newCodes: plan.newCodes.map((x) => x.code), changed: plan.changed.map((x) => x.code), unchanged: plan.unchanged, renameIgnored: plan.renameIgnored.length });
    return summary;
  });
}
function setGroup(db, { model, material, group }, username) {
  const g = normalizeGroup(group);
  if (!g) throw fail("Ch\u1ECDn nh\xF3m kitting.");
  const res = db.prepare(`UPDATE bom SET kit_group = ?, group_source = 'manual' WHERE material = ? AND model_code IN
    (SELECT b.model_code FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code WHERE COALESCE(m.model, b.model_code) = ?)`).run(g, material, model);
  if (!res.changes) throw fail("Kh\xF4ng t\xECm th\u1EA5y m\xE3 v\u1EADt li\u1EC7u trong Model n\xE0y.", 404);
  rebuildVln(db, [model]);
  audit(db, username, "bom.group", { model, material, group: g });
  return res.changes;
}
function bomCoverage(db) {
  return db.prepare(`SELECT p.model_code, COUNT(DISTINCT p.po_key) AS pos FROM po p
    WHERE p.in_source = 1 AND p.remain_qty > 0 AND ${notCancelledSql("p.")} AND NOT EXISTS (SELECT 1 FROM bom b WHERE b.model_code = p.model_code)
    GROUP BY p.model_code ORDER BY p.model_code`).all();
}
var MODEL = "COALESCE(m.model, b.model_code)";
var r3 = (n) => Math.round(Number(n) * 1e3) / 1e3;
var ORDER = { REAR: 0, VLDT: 1, VLN: 2 };
var modelOfCode = (db, code) => {
  var _a;
  return ((_a = db.prepare("SELECT model FROM model_map WHERE model_code = ?").get(code)) == null ? void 0 : _a.model) || code;
};
var codesOf = (db, model) => db.prepare(`SELECT DISTINCT b.model_code c FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code WHERE ${MODEL} = ? ORDER BY 1`).all(model).map((r) => r.c);
var mode = (list) => {
  const t4 = /* @__PURE__ */ new Map();
  for (const v of list) t4.set(v, (t4.get(v) || 0) + 1);
  return [...t4].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
};
function rebuildVln(db, only) {
  const rows = db.prepare(`SELECT ${MODEL} model, b.model_code, b.material, b.description, b.point FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code WHERE b.kit_group = 'VLN'`).all();
  const want = /* @__PURE__ */ new Map();
  for (const r of rows) {
    if (!want.has(r.model)) want.set(r.model, /* @__PURE__ */ new Map());
    const m = want.get(r.model);
    if (!m.has(r.material)) m.set(r.material, { description: r.description, points: [] });
    m.get(r.material).points.push(r.point);
  }
  const models = only ? new Set(only) : /* @__PURE__ */ new Set([...want.keys(), ...db.prepare("SELECT DISTINCT model FROM bom_vln").all().map((r) => r.model)]);
  const del = db.prepare("DELETE FROM bom_vln WHERE model = ? AND material = ?");
  const ins = db.prepare(`INSERT INTO bom_vln(model, material, description, point, source) VALUES (?,?,?,?,'auto')
    ON CONFLICT(model, material) DO UPDATE SET description = excluded.description, point = CASE WHEN bom_vln.source = 'manual' THEN bom_vln.point ELSE excluded.point END`);
  for (const model of models) {
    const w = want.get(model) || /* @__PURE__ */ new Map();
    for (const r of db.prepare("SELECT material FROM bom_vln WHERE model = ?").all(model)) if (!w.has(r.material)) del.run(model, r.material);
    for (const [material, x] of w) ins.run(model, material, x.description, mode(x.points));
  }
}
function vlnBom(db, model) {
  return db.prepare("SELECT material, description, point, 'VLN' AS kit_group FROM bom_vln WHERE model = ? ORDER BY material").all(model);
}
function bomCatalog(db) {
  const map = new Map(db.prepare("SELECT model_code, model FROM model_map").all().map((r) => [r.model_code, r.model]));
  const bomStat = new Map(db.prepare(`SELECT model_code, COUNT(*) n, SUM(kit_group = 'VLN') vln, SUM(kit_group = 'VLDT') vldt, SUM(kit_group = 'REAR') rear,
    SUM(kit_group IS NULL) nog, SUM(group_source = 'auto') auto FROM bom GROUP BY model_code`).all().map((r) => [r.model_code, r]));
  const poStat = new Map(db.prepare(`SELECT model_code, MAX(basic_model) basic, COUNT(*) n, SUM(remain_qty > 0 AND ${notCancelledSql()}) open FROM po WHERE in_source = 1 GROUP BY model_code`).all().map((r) => [r.model_code, r]));
  const vlnStat = new Map(db.prepare("SELECT model, COUNT(*) n, SUM(source = 'manual') manual FROM bom_vln GROUP BY model").all().map((r) => [r.model, r]));
  const models = /* @__PURE__ */ new Map();
  for (const code of /* @__PURE__ */ new Set([...map.keys(), ...bomStat.keys(), ...poStat.keys()])) {
    const b = bomStat.get(code), p = poStat.get(code);
    const model = map.get(code) || (p ? String(p.basic || "").slice(0, 8) : code);
    if (!models.has(model)) models.set(model, { model, codes: [], openPo: 0, missing: 0, rows: 0 });
    const m = models.get(model);
    m.codes.push({ code, mapped: map.has(code), rows: (b == null ? void 0 : b.n) || 0, vln: (b == null ? void 0 : b.vln) || 0, vldt: (b == null ? void 0 : b.vldt) || 0, rear: (b == null ? void 0 : b.rear) || 0, auto: (b == null ? void 0 : b.auto) || 0, openPo: (p == null ? void 0 : p.open) || 0 });
    m.openPo += (p == null ? void 0 : p.open) || 0;
    m.rows += (b == null ? void 0 : b.n) || 0;
    if (!b && (p == null ? void 0 : p.open)) m.missing++;
  }
  const issues = bomIssues(db);
  return [...models.values()].map((m) => {
    m.codes.sort((a, b) => a.code.localeCompare(b.code));
    const v = vlnStat.get(m.model);
    return __spreadProps(__spreadValues({}, m), {
      hasBom: m.rows > 0,
      vln: (v == null ? void 0 : v.n) || 0,
      vlnManual: (v == null ? void 0 : v.manual) || 0,
      hv: Math.max(0, ...m.codes.map((c) => c.vldt + c.rear)),
      auto: m.codes.reduce((s, c) => s + c.auto, 0),
      warnings: (issues.get(m.model) || []).length
    });
  }).sort((a, b) => a.model.localeCompare(b.model));
}
function bomIssues(db, onlyModel) {
  const out = /* @__PURE__ */ new Map(), push = (m, x) => {
    if (!out.has(m)) out.set(m, []);
    out.get(m).push(x);
  };
  const vln = db.prepare(`SELECT * FROM bom_vln ${onlyModel ? "WHERE model = ?" : ""}`).all(...onlyModel ? [onlyModel] : []);
  const rows = db.prepare(`SELECT ${MODEL} model, b.model_code, b.material, b.point, b.kit_group FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code ${onlyModel ? `WHERE ${MODEL} = ?` : ""}`).all(...onlyModel ? [onlyModel] : []);
  const codes = /* @__PURE__ */ new Map(), idx = /* @__PURE__ */ new Map();
  for (const r of rows) {
    if (!codes.has(r.model)) codes.set(r.model, /* @__PURE__ */ new Set());
    codes.get(r.model).add(r.model_code);
    idx.set(`${r.model_code}${r.material}`, r);
  }
  for (const v of vln) for (const code of codes.get(v.model) || []) {
    const r = idx.get(`${code}${v.material}`);
    if (!r) push(v.model, { material: v.material, code, type: "missing", text: `${code} kh\xF4ng c\xF3 m\xE3 n\xE0y` });
    else if (v.source !== "manual" && r3(r.point) !== r3(v.point)) push(v.model, { material: v.material, code, type: "point", text: `${code}: Point g\u1ED1c ${r.point} \u2260 VLN ${v.point}` });
  }
  for (const r of rows) if (!r.kit_group) push(r.model, { material: r.material, code: r.model_code, type: "nogroup", text: `${r.model_code}: ch\u01B0a c\xF3 nh\xF3m` });
  return out;
}
function bomModelDetail(db, model) {
  var _a;
  if (!model) throw fail("Ch\u1ECDn Model.");
  const cat = bomCatalog(db).find((m) => m.model === model);
  if (!cat) throw fail("Kh\xF4ng t\xECm th\u1EA5y Model.", 404);
  const rows = db.prepare(`SELECT b.id, b.model_code, b.material, b.description, b.point, b.process, b.kit_group, b.group_source FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code
    WHERE ${MODEL} = ? ORDER BY b.model_code, CASE b.kit_group WHEN 'REAR' THEN 0 WHEN 'VLDT' THEN 1 WHEN 'VLN' THEN 2 ELSE 3 END, CAST(b.process AS INTEGER), b.material`).all(model);
  const issues = bomIssues(db, model).get(model) || [];
  const byCode = {};
  for (const c of cat.codes) byCode[c.code] = [];
  for (const r of rows) (byCode[_a = r.model_code] || (byCode[_a] = [])).push({ id: r.id, material: r.material, description: r.description, point: r.point, process: r.process, group: r.kit_group, source: r.group_source });
  const pt = new Map(rows.map((r) => [`${r.model_code}${r.material}`, r.point]));
  const codes = cat.codes.map((c) => c.code);
  const vln = vlnBom(db, model).map((v) => {
    const src = db.prepare("SELECT source, updated_by, updated_at FROM bom_vln WHERE model = ? AND material = ?").get(model, v.material);
    return __spreadProps(__spreadValues({}, v), { source: src.source, updatedBy: src.updated_by, perCode: codes.map((c) => {
      var _a2;
      return (_a2 = pt.get(`${c}${v.material}`)) != null ? _a2 : null;
    }), issues: issues.filter((i) => i.material === v.material).map((i) => i.text) });
  });
  const hvMap = /* @__PURE__ */ new Map();
  for (const r of rows.filter((r2) => r2.kit_group === "REAR" || r2.kit_group === "VLDT")) {
    if (!hvMap.has(r.material)) hvMap.set(r.material, { material: r.material, description: r.description, group: r.kit_group, perCode: codes.map(() => null) });
    hvMap.get(r.material).perCode[codes.indexOf(r.model_code)] = r.point;
  }
  const hv = [...hvMap.values()].sort((a, b) => ORDER[a.group] - ORDER[b.group] || a.material.localeCompare(b.material));
  return __spreadProps(__spreadValues({}, cat), { codeList: codes, byCode, vln, hv, issues });
}
function groupOrThrow(v) {
  const g = normalizeGroup(v);
  if (!g) throw fail("Ch\u1ECDn nh\xF3m kitting.");
  return g;
}
function saveBomRow(db, { id, modelCode, material, description, point, process, group, allCodes }, user) {
  const p = Number(point);
  if (!Number.isFinite(p) || p <= 0) throw fail("Point ph\u1EA3i l\u1EDBn h\u01A1n 0.");
  const g = groupOrThrow(group);
  return tx(db, () => {
    var _a;
    if (id) {
      const row = db.prepare("SELECT * FROM bom WHERE id = ?").get(Number(id));
      if (!row) throw fail("D\xF2ng BOM kh\xF4ng c\xF2n.", 404);
      const model2 = modelOfCode(db, row.model_code);
      db.prepare("UPDATE bom SET description = ?, point = ?, process = ?, kit_group = ?, group_source = 'manual' WHERE id = ?").run(String(description != null ? description : row.description), p, String((_a = process != null ? process : row.process) != null ? _a : ""), g, row.id);
      if (allCodes) db.prepare(`UPDATE bom SET point = ?, description = ? WHERE material = ? AND model_code IN (SELECT b.model_code FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code WHERE ${MODEL} = ?)`).run(p, String(description != null ? description : row.description), row.material, model2);
      if (g !== row.kit_group) setGroup(db, { model: model2, material: row.material, group: g }, user);
      else rebuildVln(db, [model2]);
      audit(db, user, "bom.row.edit", { code: row.model_code, material: row.material, point: p, group: g, allCodes: !!allCodes });
      return { ok: true, message: `\u0110\xE3 s\u1EEDa ${row.material}${allCodes ? " (m\u1ECDi Model Code)" : ""}` };
    }
    const code = String(modelCode || "").trim(), mat = String(material || "").trim();
    if (!code || !mat) throw fail("Nh\u1EADp Model Code v\xE0 m\xE3 v\u1EADt li\u1EC7u.");
    const model = modelOfCode(db, code), targets = allCodes ? [.../* @__PURE__ */ new Set([code, ...codesOf(db, model)])] : [code];
    const ins = db.prepare("INSERT INTO bom(model_code, material, description, point, process, kit_group, group_source) VALUES (?,?,?,?,?,?,'manual') ON CONFLICT(model_code, material) DO NOTHING");
    let added = 0;
    for (const c of targets) added += Number(ins.run(c, mat, String(description || ""), p, String(process || ""), g).changes);
    if (!added) throw fail(`${mat} \u0111\xE3 c\xF3 trong BOM.`);
    if (codesOf(db, model).length > 1) setGroup(db, { model, material: mat, group: g }, user);
    else rebuildVln(db, [model]);
    audit(db, user, "bom.row.add", { code, material: mat, point: p, group: g, codes: targets.length });
    return { ok: true, message: `\u0110\xE3 th\xEAm ${mat} v\xE0o ${added} Model Code` };
  });
}
function deleteBomRow(db, { id, allCodes }, user) {
  return tx(db, () => {
    const row = db.prepare("SELECT * FROM bom WHERE id = ?").get(Number(id));
    if (!row) throw fail("D\xF2ng BOM kh\xF4ng c\xF2n.", 404);
    const model = modelOfCode(db, row.model_code);
    const n = allCodes ? db.prepare(`DELETE FROM bom WHERE material = ? AND model_code IN (SELECT b.model_code FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code WHERE ${MODEL} = ?)`).run(row.material, model).changes : db.prepare("DELETE FROM bom WHERE id = ?").run(row.id).changes;
    rebuildVln(db, [model]);
    audit(db, user, "bom.row.delete", { code: row.model_code, material: row.material, allCodes: !!allCodes });
    return { ok: true, message: `\u0110\xE3 x\xF3a ${row.material} kh\u1ECFi ${n} Model Code` };
  });
}
function saveModelCode(db, { modelCode, model, copyFrom }, user) {
  const code = String(modelCode || "").trim(), m = String(model || "").trim();
  if (!code || !m) throw fail("Nh\u1EADp Model Code v\xE0 Model.");
  return tx(db, () => {
    var _a;
    const old = (_a = db.prepare("SELECT model FROM model_map WHERE model_code = ?").get(code)) == null ? void 0 : _a.model;
    db.prepare("INSERT INTO model_map(model_code, model) VALUES (?, ?) ON CONFLICT(model_code) DO UPDATE SET model = excluded.model").run(code, m);
    let copied = 0;
    if (copyFrom && copyFrom !== code) {
      if (db.prepare("SELECT 1 FROM bom WHERE model_code = ? LIMIT 1").get(code)) throw fail(`${code} \u0111\xE3 c\xF3 BOM \u2014 x\xF3a BOM c\u0169 tr\u01B0\u1EDBc khi ch\xE9p.`);
      copied = Number(db.prepare(`INSERT INTO bom(model_code, material, description, point, process, kit_group, group_source)
        SELECT ?, material, description, point, process, kit_group, 'manual' FROM bom WHERE model_code = ?`).run(code, copyFrom).changes);
      if (!copied) throw fail(`${copyFrom} ch\u01B0a c\xF3 BOM \u0111\u1EC3 ch\xE9p.`);
    }
    rebuildVln(db, [...new Set([m, old].filter(Boolean))]);
    let moved = 0;
    if (old && old !== m && !db.prepare("SELECT 1 FROM model_map WHERE model = ? LIMIT 1").get(old)) {
      moved = Number(db.prepare("UPDATE line_assign SET model = ? WHERE model = ?").run(m, old).changes);
      db.prepare("UPDATE OR IGNORE line_params SET model = ? WHERE model = ?").run(m, old);
      db.prepare("DELETE FROM line_params WHERE model = ?").run(old);
    }
    audit(db, user, "bom.code.save", { code, model: m, copyFrom: copyFrom || "", lineAssignMoved: moved });
    return { ok: true, message: copied ? `${code}: ch\xE9p ${copied} d\xF2ng t\u1EEB ${copyFrom}` : `\u0110\xE3 l\u01B0u ${code} \u2192 ${m}` };
  });
}
function deleteModelCode(db, { modelCode }, user) {
  return tx(db, () => {
    const code = String(modelCode || "").trim(), model = modelOfCode(db, code);
    const n = db.prepare("DELETE FROM bom WHERE model_code = ?").run(code).changes;
    const usedByPo = db.prepare("SELECT 1 FROM po WHERE model_code = ? LIMIT 1").get(code);
    if (!usedByPo) db.prepare("DELETE FROM model_map WHERE model_code = ?").run(code);
    rebuildVln(db, [model]);
    audit(db, user, "bom.code.delete", { code, rows: n });
    return { ok: true, message: `\u0110\xE3 x\xF3a BOM ${code} (${n} d\xF2ng)${usedByPo ? " \xB7 gi\u1EEF Model Code v\xEC c\xF2n PO" : ""}` };
  });
}
function saveVlnPoint(db, { model, material, point, reset }, user) {
  return tx(db, () => {
    const row = db.prepare("SELECT * FROM bom_vln WHERE model = ? AND material = ?").get(model, material);
    if (!row) throw fail("M\xE3 kh\xF4ng c\xF3 trong BOM VLN.", 404);
    if (reset) {
      db.prepare("UPDATE bom_vln SET source = 'auto' WHERE model = ? AND material = ?").run(model, material);
      rebuildVln(db, [model]);
      return { ok: true, message: `${material}: l\u1EA5y l\u1EA1i Point t\u1EEB BOM g\u1ED1c` };
    }
    const p = Number(point);
    if (!Number.isFinite(p) || p <= 0) throw fail("Point ph\u1EA3i l\u1EDBn h\u01A1n 0.");
    db.prepare("UPDATE bom_vln SET point = ?, source = 'manual', updated_by = ?, updated_at = datetime('now') WHERE model = ? AND material = ?").run(p, user, model, material);
    audit(db, user, "bom.vln.point", { model, material, point: p });
    return { ok: true, message: `VLN ${material} = ${p}` };
  });
}

// ../kitting-app/lib/erp-line.mjs
var ERP_LINE_DOCTYPE = "Line Production Plan";
var OK_STATUS = ["Released", "Locked"];
var norm = (s) => String(s != null ? s : "").replace(/\s+/g, " ").trim().toUpperCase();
function ensureErpSchema(db) {
  db.exec("CREATE TABLE IF NOT EXISTS erp_cfg (key TEXT PRIMARY KEY, value TEXT)");
}
var cfgGet = (db, k) => {
  var _a, _b;
  return (_b = (_a = db.prepare("SELECT value FROM erp_cfg WHERE key = ?").get(k)) == null ? void 0 : _a.value) != null ? _b : "";
};
var cfgSet = (db, k, v) => db.prepare("INSERT INTO erp_cfg(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, String(v != null ? v : ""));
function erpCfg(db) {
  return {
    url: String(cfgGet(db, "url") || "").replace(/\/+$/, ""),
    key: cfgGet(db, "key"),
    secret: cfgGet(db, "secret"),
    lineSync: cfgGet(db, "line_sync") === "1",
    okAt: cfgGet(db, "line_ok_at"),
    // Tồn vị trí (Bin) và BOM mặc định lấy từ ERP: mặc định bật khi đã có khóa; Quản trị tắt được.
    stockSync: cfgGet(db, "stock_sync") !== "0",
    bomSync: cfgGet(db, "bom_sync") !== "0",
    stockOkAt: cfgGet(db, "stock_ok_at"),
    bomOkAt: cfgGet(db, "bom_ok_at"),
    modelMap: (() => {
      try {
        return JSON.parse(cfgGet(db, "model_map") || "{}");
      } catch (e) {
        return {};
      }
    })()
  };
}
var erpLineLocked = (db) => {
  const c = erpCfg(db);
  return c.lineSync && !!c.okAt;
};
function assertLineEditable(db) {
  if (erpLineLocked(db)) throw fail("K\u1EBF ho\u1EA1ch Line \u0111\u1ED3ng b\u1ED9 t\u1EEB Next ERP (m\xE0n Line Production Calendar) \u2014 s\u1EEDa tr\xEAn ERP, MM ch\u1EC9 xem.");
}
function saveErpCfg(db, body, username) {
  return tx(db, () => {
    var _a, _b, _c;
    const url = String((_a = body == null ? void 0 : body.url) != null ? _a : "").trim();
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw fail("\u0110\u1ECBa ch\u1EC9 ERP ph\u1EA3i b\u1EAFt \u0111\u1EA7u b\u1EB1ng http:// ho\u1EB7c https://");
    if ((body == null ? void 0 : body.url) !== void 0) cfgSet(db, "url", url.replace(/\/+$/, ""));
    if (String((_b = body == null ? void 0 : body.key) != null ? _b : "").trim()) cfgSet(db, "key", String(body.key).trim());
    if (String((_c = body == null ? void 0 : body.secret) != null ? _c : "").trim()) cfgSet(db, "secret", String(body.secret).trim());
    if ((body == null ? void 0 : body.lineSync) !== void 0) cfgSet(db, "line_sync", body.lineSync ? "1" : "0");
    if ((body == null ? void 0 : body.stockSync) !== void 0) cfgSet(db, "stock_sync", body.stockSync ? "1" : "0");
    if ((body == null ? void 0 : body.bomSync) !== void 0) cfgSet(db, "bom_sync", body.bomSync ? "1" : "0");
    if ((body == null ? void 0 : body.modelMap) !== void 0) {
      const m = {};
      for (const [k, v] of Object.entries(body.modelMap || {})) if (String(k).trim() && String(v).trim()) m[String(k).trim()] = String(v).trim();
      cfgSet(db, "model_map", JSON.stringify(m));
    }
    audit(db, username, "erp.cfg", { url: (body == null ? void 0 : body.url) !== void 0, key: !!(body == null ? void 0 : body.key), secret: !!(body == null ? void 0 : body.secret), lineSync: body == null ? void 0 : body.lineSync, stockSync: body == null ? void 0 : body.stockSync, bomSync: body == null ? void 0 : body.bomSync, modelMap: (body == null ? void 0 : body.modelMap) ? Object.keys(body.modelMap).length : void 0 });
    return { ok: true, message: "\u0110\xE3 l\u01B0u k\u1EBFt n\u1ED1i Next ERP." };
  });
}
function erpLineStatus(db) {
  const c = erpCfg(db), last = db.prepare("SELECT summary, created_by, created_at FROM import_log WHERE kind = 'ERP_LINE' ORDER BY id DESC LIMIT 1").get();
  return {
    configured: !!(c.url && c.key && c.secret),
    url: c.url,
    lineSync: c.lineSync,
    stockSync: c.stockSync,
    bomSync: c.bomSync,
    locked: erpLineLocked(db),
    okAt: c.okAt,
    stockOkAt: c.stockOkAt,
    bomOkAt: c.bomOkAt,
    modelMap: c.modelMap,
    last: last ? __spreadProps(__spreadValues({}, JSON.parse(last.summary || "{}")), { by: last.created_by, at: last.created_at }) : null
  };
}
function matcher(db) {
  const lines = new Map(db.prepare("SELECT name FROM lines WHERE active = 1").all().map((r) => [norm(r.name), r.name]));
  const models = new Map(modelList(db).map((m) => [norm(m), m])), manual = new Map(Object.entries(erpCfg(db).modelMap).map(([k, v]) => [norm(k), v]));
  const sh = shifts(db), night = sh.find((s) => /đêm/i.test(s)) || sh[1], day = sh.find((s) => /ngày/i.test(s)) || sh[0];
  return (it) => {
    const line = lines.get(norm(it.routing));
    const raw = String(it.model_snapshot || it.model_name || it.model_template || "").trim();
    const model = manual.get(norm(raw)) || models.get(norm(raw)) || models.get(norm(raw.replace(/\s+AUTO$/i, ""))) || null;
    const sg = `${it.shift_group || ""} ${it.shift_type || ""}`;
    const shift = /đêm|night/i.test(sg) ? night : /ngày|day/i.test(sg) ? day : null;
    return { line, model, shift, raw, routing: String(it.routing || ""), sg: String(it.shift_group || it.shift_type || "") };
  };
}
function applyErpLinePlan(db, plans, { username = "ERP", source = "ERP" } = {}) {
  const today = todayKey(), match = matcher(db);
  const usable = (plans || []).filter((p) => OK_STATUS.includes(p.status) && p.week_end >= today);
  const days = /* @__PURE__ */ new Set(), want = /* @__PURE__ */ new Map(), bad = { line: /* @__PURE__ */ new Map(), model: /* @__PURE__ */ new Map(), shift: /* @__PURE__ */ new Map() }, conflict = [];
  for (const p of usable) {
    for (let d = p.week_start > today ? p.week_start : today; d <= p.week_end; d = addDays(d, 1)) days.add(d);
    for (const it of p.items || []) {
      if (!it.plan_date || it.plan_date < today || it.plan_date > p.week_end) continue;
      const m = match(it), why = !m.line ? ["line", m.routing] : !m.model ? ["model", m.raw] : !m.shift ? ["shift", m.sg] : null;
      if (why) {
        const map = bad[why[0]];
        map.set(why[1], (map.get(why[1]) || 0) + 1);
        continue;
      }
      const k = `${it.plan_date}${m.shift}${m.line}`;
      if (want.has(k) && want.get(k) !== m.model) {
        conflict.push(`${m.line} ${it.plan_date} ca ${m.shift}: ${want.get(k)} / ${m.model}`);
        continue;
      }
      want.set(k, m.model);
    }
  }
  const list = [...days].sort();
  return tx(db, () => {
    let added = 0, changed = 0, removed = 0;
    const cur = /* @__PURE__ */ new Map();
    for (const d of list) for (const r of db.prepare("SELECT work_date, shift, line, model FROM line_assign WHERE work_date = ?").all(d)) cur.set(`${r.work_date}${r.shift}${r.line}`, r.model);
    for (const [k, m] of want) {
      if (!cur.has(k)) added++;
      else if (cur.get(k) !== m) changed++;
    }
    for (const k of cur.keys()) if (!want.has(k)) removed++;
    if (added || changed || removed) {
      const del = db.prepare("DELETE FROM line_assign WHERE work_date = ?"), ins = db.prepare("INSERT INTO line_assign(work_date, shift, line, model, updated_by) VALUES (?,?,?,?,?)");
      for (const d of list) del.run(d);
      for (const [k, m] of want) {
        const [d, s, l] = k.split("");
        ins.run(d, s, l, m, username);
      }
    }
    const summary = {
      ok: true,
      source,
      plans: usable.map((p) => `${p.name} (${p.week_start}\u2026${p.week_end}, ${p.status})`),
      from: list[0] || "",
      to: list.at(-1) || "",
      days: list.length,
      cells: want.size,
      added,
      changed,
      removed,
      unmatched: Object.fromEntries(Object.entries(bad).map(([k, m]) => [k, [...m].map(([n, c]) => ({ name: n, count: c }))])),
      conflict
    };
    db.prepare("INSERT INTO import_log(kind, source, summary, created_by) VALUES (?,?,?,?)").run("ERP_LINE", source, JSON.stringify(summary), username);
    if (usable.length) cfgSet(db, "line_ok_at", (/* @__PURE__ */ new Date()).toISOString());
    if (added || changed || removed) audit(db, username, "line.erp", { added, changed, removed, from: summary.from, to: summary.to });
    return summary;
  });
}
function logError(db, message, source, username) {
  db.prepare("INSERT INTO import_log(kind, source, summary, created_by) VALUES (?,?,?,?)").run("ERP_LINE", source, JSON.stringify({ ok: false, error: message }), username);
}
function pullErpLinePlans(http) {
  const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(typeof v === "string" ? v : JSON.stringify(v))}`).join("&");
  const get = (path) => {
    const r = http(path);
    if (r.status === 401) throw fail("Next ERP t\u1EEB ch\u1ED1i kh\xF3a API (401) \u2014 ki\u1EC3m tra l\u1EA1i API key / secret c\u1EE7a t\xE0i kho\u1EA3n bot.", 502);
    if (r.status === 403) throw fail(`T\xE0i kho\u1EA3n bot ch\u01B0a c\xF3 quy\u1EC1n \u0111\u1ECDc "${ERP_LINE_DOCTYPE}" tr\xEAn Next ERP (403) \u2014 nh\u1EDD IT c\u1EA5p quy\u1EC1n \u0111\u1ECDc (Read) doctype n\xE0y cho bot.`, 502);
    if (r.status < 200 || r.status >= 300) throw fail(`Next ERP tr\u1EA3 l\u1ED7i ${r.status}.`, 502);
    return r.json;
  };
  const head = get(`/api/resource/${encodeURIComponent(ERP_LINE_DOCTYPE)}?${q({ fields: ["name", "week_start", "week_end", "status", "modified"], filters: [["week_end", ">=", todayKey()], ["status", "in", OK_STATUS]], order_by: "week_start asc", limit_page_length: 20 })}`);
  return ((head == null ? void 0 : head.data) || []).map((p) => {
    var _a, _b;
    return __spreadProps(__spreadValues({}, p), { items: (((_b = (_a = get(`/api/resource/${encodeURIComponent(ERP_LINE_DOCTYPE)}/${encodeURIComponent(p.name)}`)) == null ? void 0 : _a.data) == null ? void 0 : _b.items) || []).map((i) => ({ plan_date: i.plan_date, routing: i.routing, model_snapshot: i.model_snapshot, model_template: i.model_template, shift_group: i.shift_group, shift_type: i.shift_type })) });
  });
}
function syncErpLines(db, makeHttp, { username = "ERP", source = "ERP", auto = false } = {}) {
  ensureErpSchema(db);
  const c = erpCfg(db);
  if (auto && !c.lineSync) return { ok: true, skipped: "Ch\u01B0a b\u1EADt \u0111\u1ED3ng b\u1ED9 k\u1EBF ho\u1EA1ch Line" };
  if (!(c.url && c.key && c.secret)) throw fail("Ch\u01B0a c\u1EA5u h\xECnh k\u1EBFt n\u1ED1i Next ERP (Qu\u1EA3n tr\u1ECB \u2192 K\u1EBFt n\u1ED1i Next ERP).");
  if (!makeHttp) throw fail("B\u1EA3n ch\u1EA1y n\xE0y kh\xF4ng g\u1ECDi \u0111\u01B0\u1EE3c Next ERP.");
  let plans;
  try {
    plans = pullErpLinePlans(makeHttp(c));
  } catch (e) {
    if (!e.status) throw e;
    logError(db, e.message, source, username);
    return { ok: false, error: e.message };
  }
  return applyErpLinePlan(db, plans, { username, source });
}
function erpLineRoutes(db, makeHttp) {
  ensureErpSchema(db);
  return [
    { method: "GET", path: "/api/lines/erp", handler: () => erpLineStatus(db) },
    { method: "POST", path: "/api/lines/erp/sync", handler: ({ user }) => syncErpLines(db, makeHttp, { username: user.username, source: `\u0110\u1ED3ng b\u1ED9 tay \xB7 ${user.username}` }) },
    { method: "GET", path: "/api/admin/erp", handler: () => {
      const s = erpLineStatus(db), c = erpCfg(db);
      return __spreadProps(__spreadValues({}, s), { hasKey: !!c.key, hasSecret: !!c.secret });
    } },
    { method: "POST", path: "/api/admin/erp", handler: ({ body, user }) => saveErpCfg(db, body || {}, user.username) }
  ];
}

// ../kitting-app/lib/erp-stock.mjs
var r32 = (n) => Math.round(Number(n) * 1e3) / 1e3;
var STOCK_SKIP_PARENTS = ["Khu v\u1EF1c s\u1EA3n xu\u1EA5t"];
var MAX_BOM_DOCS = 200;
function ensureErpStockSchema(db) {
  ensureErpSchema(db);
  db.exec(`
  CREATE TABLE IF NOT EXISTS erp_stock (material TEXT NOT NULL, warehouse TEXT NOT NULL, qty REAL NOT NULL DEFAULT 0, reserved REAL NOT NULL DEFAULT 0, uom TEXT, PRIMARY KEY (material, warehouse));
  CREATE TABLE IF NOT EXISTS erp_wh (name TEXT PRIMARY KEY, label TEXT NOT NULL, parent TEXT, is_group INTEGER NOT NULL DEFAULT 0, wh_type TEXT, in_kho INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS erp_item (material TEXT PRIMARY KEY, name TEXT, item_group TEXT, default_loc TEXT, uom TEXT);
  CREATE TABLE IF NOT EXISTS erp_bom (item TEXT PRIMARY KEY, name TEXT NOT NULL, modified TEXT, lines INTEGER NOT NULL DEFAULT 0, synced_at TEXT NOT NULL DEFAULT (datetime('now')));`);
}
var whLabel = (n) => String(n || "").replace(/ - [A-Z]{2,6}$/, "").trim();
var norm2 = (s) => String(s || "").replace(/\s+/g, " ").trim().toUpperCase();
function erpGet(http, path, what) {
  const r = http(path);
  if (r.status === 401) throw fail("Next ERP t\u1EEB ch\u1ED1i kh\xF3a API (401) \u2014 ki\u1EC3m tra l\u1EA1i API key / secret c\u1EE7a t\xE0i kho\u1EA3n bot.", 502);
  if (r.status === 403) throw fail(`T\xE0i kho\u1EA3n bot ch\u01B0a c\xF3 quy\u1EC1n \u0111\u1ECDc "${what}" tr\xEAn Next ERP (403) \u2014 nh\u1EDD IT c\u1EA5p quy\u1EC1n \u0111\u1ECDc (Read) doctype n\xE0y cho bot.`, 502);
  if (r.status < 200 || r.status >= 300) throw fail(`Next ERP tr\u1EA3 l\u1ED7i ${r.status || "m\u1EA1ng"} khi \u0111\u1ECDc "${what}".`, 502);
  return r.json;
}
var qs = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(typeof v === "string" || typeof v === "number" ? String(v) : JSON.stringify(v))}`).join("&");
var resPath = (dt, params) => `/api/resource/${encodeURIComponent(dt)}?${qs(params)}`;
function listAll(http, dt, params, pageSize = 5e3) {
  var _a;
  const out = [];
  for (let start = 0; start < 1e5; start += pageSize) {
    const page = ((_a = erpGet(http, resPath(dt, __spreadProps(__spreadValues({}, params), { limit_page_length: pageSize, limit_start: start })), dt)) == null ? void 0 : _a.data) || [];
    for (const row of page) out.push(row);
    if (page.length < pageSize) break;
  }
  return out;
}
var chunks = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};
function pullErpStock(http) {
  const bins = listAll(http, "Bin", { fields: ["item_code", "warehouse", "actual_qty", "reserved_qty", "stock_uom"], filters: [["actual_qty", "!=", 0]] });
  const whs = listAll(http, "Warehouse", { fields: ["name", "warehouse_name", "parent_warehouse", "is_group", "warehouse_type", "disabled"] });
  const items2 = listAll(http, "Item", { fields: ["name", "item_name", "item_group", "custom_default_location", "stock_uom"], filters: [["is_stock_item", "=", 1], ["disabled", "=", 0]] });
  return { bins, whs, items: items2 };
}
var skipParents = (db) => String(cfgGet(db, "stock_skip") || STOCK_SKIP_PARENTS.join(",")).split(",").map((s) => norm2(s)).filter(Boolean);
var inKho = (db, w) => {
  const skip = skipParents(db), p = norm2(whLabel(w.parent_warehouse)), l = norm2(whLabel(w.name));
  return !(skip.some((s) => p.startsWith(s)) || /^LINE\s*\d/.test(l) || w.warehouse_type === "Transit") ? 1 : 0;
};
function applyErpStock(db, { bins, whs, items: items2 }, { username = "ERP", source = "ERP" } = {}) {
  return tx(db, () => {
    const before = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(qty), 0) s, COALESCE(SUM(reserved), 0) r FROM erp_stock").get();
    db.exec("DELETE FROM erp_wh; DELETE FROM erp_item; DELETE FROM erp_stock");
    const insW = db.prepare("INSERT OR REPLACE INTO erp_wh(name, label, parent, is_group, wh_type, in_kho) VALUES (?,?,?,?,?,?)");
    for (const w of whs || []) if (w.name) insW.run(w.name, whLabel(w.warehouse_name || w.name) || w.name, w.parent_warehouse || "", w.is_group ? 1 : 0, w.warehouse_type || "", inKho(db, w));
    const insI = db.prepare("INSERT OR REPLACE INTO erp_item(material, name, item_group, default_loc, uom) VALUES (?,?,?,?,?)");
    for (const i of items2 || []) if (i.name) insI.run(i.name, i.item_name || "", i.item_group || "", whLabel(i.custom_default_location || ""), i.stock_uom || "");
    const insB = db.prepare("INSERT OR REPLACE INTO erp_stock(material, warehouse, qty, reserved, uom) VALUES (?,?,?,?,?)");
    let neg = 0;
    for (const b of bins || []) {
      if (!b.item_code || !b.warehouse) continue;
      insB.run(b.item_code, b.warehouse, r32(b.actual_qty), r32(b.reserved_qty), b.stock_uom || "");
      if (Number(b.actual_qty) < 0) neg++;
    }
    const after = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(qty), 0) s, COALESCE(SUM(reserved), 0) r FROM erp_stock").get();
    const bomMats = db.prepare("SELECT COUNT(DISTINCT material) n FROM bom").get().n;
    const withStock = db.prepare("SELECT COUNT(DISTINCT b.material) n FROM bom b WHERE EXISTS (SELECT 1 FROM erp_stock s JOIN erp_wh w ON w.name = s.warehouse WHERE s.material = b.material AND w.in_kho = 1 AND s.qty > 0)").get().n;
    const changed = before.n !== after.n || r32(before.s) !== r32(after.s) || r32(before.r) !== r32(after.r);
    const summary = { ok: true, source, bins: (bins || []).length, warehouses: (whs || []).length, items: (items2 || []).length, negBins: neg, bomMats, bomMatsWithStock: withStock, changed };
    db.prepare("INSERT INTO import_log(kind, source, summary, created_by) VALUES (?,?,?,?)").run("ERP_STOCK", source, JSON.stringify(summary), username);
    db.prepare("DELETE FROM import_log WHERE kind IN ('ERP_STOCK', 'ERP_BOM') AND created_at < datetime('now', '-30 days')").run();
    cfgSet(db, "stock_ok_at", (/* @__PURE__ */ new Date()).toISOString());
    return summary;
  });
}
function logError2(db, kind, message, source, username) {
  db.prepare("INSERT INTO import_log(kind, source, summary, created_by) VALUES (?,?,?,?)").run(kind, source, JSON.stringify({ ok: false, error: message }), username);
}
function ready(db, makeHttp, flag, auto, label) {
  const c = erpCfg(db);
  if (auto && !c[flag]) return { skip: { ok: true, skipped: `Ch\u01B0a b\u1EADt ${label}` } };
  if (!(c.url && c.key && c.secret)) throw fail("Ch\u01B0a c\u1EA5u h\xECnh k\u1EBFt n\u1ED1i Next ERP (Qu\u1EA3n tr\u1ECB \u2192 K\u1EBFt n\u1ED1i Next ERP).");
  if (!makeHttp) throw fail("B\u1EA3n ch\u1EA1y n\xE0y kh\xF4ng g\u1ECDi \u0111\u01B0\u1EE3c Next ERP.");
  return { c };
}
function syncErpStock(db, makeHttp, { username = "ERP", source = "ERP", auto = false } = {}) {
  ensureErpStockSchema(db);
  const { c, skip } = ready(db, makeHttp, "stockSync", auto, "\u0111\u1ED3ng b\u1ED9 t\u1ED3n kho ERP");
  if (skip) return skip;
  let data;
  try {
    data = pullErpStock(makeHttp(c));
  } catch (e) {
    if (!e.status) throw e;
    logError2(db, "ERP_STOCK", e.message, source, username);
    return { ok: false, error: e.message };
  }
  const r = applyErpStock(db, data, { username, source });
  if (!auto) audit(db, username, "kho.stock.erp", { bins: r.bins, negBins: r.negBins });
  return r;
}
function stockOf(db, materials) {
  const out = /* @__PURE__ */ new Map(), list = [...new Set((materials || []).filter(Boolean))];
  if (!list.length) return out;
  for (const part of chunks(list, 400)) {
    const rows = db.prepare(`SELECT s.material, w.label loc, s.qty FROM erp_stock s JOIN erp_wh w ON w.name = s.warehouse WHERE w.in_kho = 1 AND s.material IN (${part.map(() => "?").join(",")}) ORDER BY s.qty DESC, w.label`).all(...part);
    for (const r of rows) {
      if (!out.has(r.material)) out.set(r.material, { total: 0, locs: [], defaultLoc: "", neg: false });
      const m = out.get(r.material);
      m.total = r32(m.total + r.qty);
      m.locs.push({ loc: r.loc, qty: r.qty });
      if (r.qty < 0) m.neg = true;
    }
    for (const r of db.prepare(`SELECT material, default_loc FROM erp_item WHERE default_loc <> '' AND material IN (${part.map(() => "?").join(",")})`).all(...part)) {
      if (!out.has(r.material)) out.set(r.material, { total: 0, locs: [], defaultLoc: "", neg: false });
      out.get(r.material).defaultLoc = r.default_loc;
    }
  }
  return out;
}
function heldMap(db) {
  return new Map(db.prepare("SELECT material, SUM(kitted - delivered) held FROM kit_item GROUP BY material HAVING held > 0").all().map((r) => [r.material, r32(r.held)]));
}
function stockStatus(db) {
  const c = erpCfg(db), last = db.prepare("SELECT summary, created_by, created_at FROM import_log WHERE kind = 'ERP_STOCK' ORDER BY id DESC LIMIT 1").get();
  return { configured: !!(c.url && c.key && c.secret), stockSync: c.stockSync, okAt: c.stockOkAt, last: last ? __spreadProps(__spreadValues({}, JSON.parse(last.summary || "{}")), { by: last.created_by, at: last.created_at }) : null };
}
function stockView(db, { model = "", all = false } = {}) {
  ensureErpStockSchema(db);
  const status = stockStatus(db), held = heldMap(db);
  const modelSql = "COALESCE(m.model, b.model_code)";
  const bomRows = model ? db.prepare(`SELECT b.material, MAX(b.description) description, GROUP_CONCAT(DISTINCT b.kit_group) groups, COUNT(DISTINCT b.model_code) codes FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code WHERE ${modelSql} = ? GROUP BY b.material ORDER BY b.material`).all(model) : db.prepare("SELECT material, MAX(description) description, GROUP_CONCAT(DISTINCT kit_group) groups, COUNT(DISTINCT model_code) codes FROM bom GROUP BY material ORDER BY material").all();
  const need = /* @__PURE__ */ new Map();
  if (model) for (const r of db.prepare(`SELECT ki.material, SUM(CASE WHEN ki.required > ki.kitted THEN ki.required - ki.kitted ELSE 0 END) need FROM kit_item ki JOIN kit_order k ON k.id = ki.kit_id
      LEFT JOIN model_map m ON m.model_code = k.model_code WHERE COALESCE(m.model, k.model_code) = ? AND k.plan_day IS NOT NULL AND NOT (k.vln_status = 'delivered' AND k.hv_status = 'delivered') GROUP BY ki.material`).all(model)) need.set(r.material, r32(r.need));
  const st = stockOf(db, bomRows.map((r) => r.material));
  const rows = bomRows.map((r) => {
    const s = st.get(r.material) || { total: 0, locs: [], defaultLoc: "", neg: false }, h = held.get(r.material) || 0, avail = r32(s.total - h);
    const flags = [];
    if (s.neg) flags.push("neg");
    if (s.locs.filter((l) => l.qty > 0).length > 1) flags.push("multi");
    if (!s.locs.length) flags.push("none");
    if (s.defaultLoc && s.locs.length && !s.locs.some((l) => l.loc === s.defaultLoc)) flags.push("mismatch");
    const n = need.get(r.material);
    if (n !== void 0 && avail < n) flags.push("short");
    return { material: r.material, description: r.description || "", groups: String(r.groups || "").split(",").filter(Boolean), codes: r.codes, inBom: true, total: s.total, locs: s.locs, defaultLoc: s.defaultLoc, held: h, avail, need: n != null ? n : null, flags };
  });
  if (all && !model) {
    const known = new Set(rows.map((r) => r.material));
    const extra = db.prepare("SELECT s.material, COALESCE(i.name, '') description, i.default_loc, w.label loc, s.qty FROM erp_stock s JOIN erp_wh w ON w.name = s.warehouse LEFT JOIN erp_item i ON i.material = s.material WHERE w.in_kho = 1 ORDER BY s.material, s.qty DESC").all().filter((r) => !known.has(r.material));
    const by = /* @__PURE__ */ new Map();
    for (const r of extra) {
      if (!by.has(r.material)) by.set(r.material, { material: r.material, description: r.description, groups: [], codes: 0, inBom: false, total: 0, locs: [], defaultLoc: r.default_loc || "", held: held.get(r.material) || 0, avail: 0, need: null, flags: ["erpOnly"] });
      const x = by.get(r.material);
      x.total = r32(x.total + r.qty);
      x.locs.push({ loc: r.loc, qty: r.qty });
      if (r.qty < 0 && !x.flags.includes("neg")) x.flags.push("neg");
    }
    for (const x of by.values()) {
      x.avail = r32(x.total - x.held);
      if (x.locs.filter((l) => l.qty > 0).length > 1) x.flags.push("multi");
      rows.push(x);
    }
  }
  const locs = /* @__PURE__ */ new Set();
  for (const r of rows) for (const l of r.locs) locs.add(l.loc);
  const kpi = {
    materials: rows.length,
    bomMats: rows.filter((r) => r.inBom).length,
    withStock: rows.filter((r) => r.inBom && r.total > 0).length,
    none: rows.filter((r) => r.inBom && r.flags.includes("none")).length,
    neg: rows.filter((r) => r.flags.includes("neg")).length,
    multi: rows.filter((r) => r.flags.includes("multi")).length,
    short: rows.filter((r) => r.flags.includes("short")).length,
    locs: locs.size,
    held: r32(rows.reduce((s, r) => s + r.held, 0))
  };
  const models = db.prepare("SELECT DISTINCT model FROM model_map ORDER BY model").all().map((r) => r.model);
  return __spreadProps(__spreadValues({}, status), { model, all: !!all, rows, kpi, models });
}
var bomErpLocked = (db) => {
  const c = erpCfg(db);
  return c.bomSync && !!c.bomOkAt;
};
function assertBomEditable(db) {
  if (bomErpLocked(db)) throw fail("BOM l\u1EA5y t\u1EEB Next ERP (m\xE0n Kh\u1EDFi t\u1EA1o BOM v\u1EADt li\u1EC7u) \u2014 s\u1EEDa tr\xEAn ERP r\u1ED3i b\u1EA5m \u27F3 \u0110\u1ED3ng b\u1ED9; MM ch\u1EC9 \u0111\u1ECDc. Nh\xF3m kitting VLN / VL\u0110T / Rear v\u1EABn s\u1EEDa trong MM.");
}
function bomErpStatus(db) {
  ensureErpStockSchema(db);
  const c = erpCfg(db), last = db.prepare("SELECT summary, created_by, created_at FROM import_log WHERE kind = 'ERP_BOM' ORDER BY id DESC LIMIT 1").get();
  const n = db.prepare("SELECT COUNT(*) n FROM erp_bom").get().n;
  return { configured: !!(c.url && c.key && c.secret), bomSync: c.bomSync, locked: bomErpLocked(db), okAt: c.bomOkAt, codes: n, last: last ? __spreadProps(__spreadValues({}, JSON.parse(last.summary || "{}")), { by: last.created_by, at: last.created_at }) : null };
}
function pullErpBom(http, seen, { max = MAX_BOM_DOCS } = {}) {
  var _a;
  const list = listAll(http, "BOM", { fields: ["name", "item", "modified", "quantity"], filters: [["is_active", "=", 1], ["is_default", "=", 1], ["docstatus", "=", 1]] });
  const changed = list.filter((b) => {
    const s = seen.get(b.item);
    return !s || s.name !== b.name || s.modified !== b.modified;
  });
  const docs = [];
  for (const b of changed.slice(0, max)) {
    const d = ((_a = erpGet(http, `/api/resource/BOM/${encodeURIComponent(b.name)}`, "BOM")) == null ? void 0 : _a.data) || {};
    const q = Number(d.quantity) > 0 ? Number(d.quantity) : 1;
    docs.push({ name: b.name, item: b.item, modified: b.modified, rows: (d.items || []).filter((i) => i.item_code).map((i) => ({ material: String(i.item_code).trim(), description: String(i.description || i.item_name || "").trim().slice(0, 200), point: r32(Number(i.stock_qty || i.qty) / q) })) });
  }
  return { list, docs, pending: Math.max(0, changed.length - docs.length) };
}
function pullItemGroups(http, codes) {
  const out = /* @__PURE__ */ new Map();
  for (const part of chunks(codes, 100)) for (const it of listAll(http, "Item", { fields: ["name", "item_group"], filters: [["name", "in", part]] })) out.set(it.name, String(it.item_group || "").replace(/\s+AUTO$/i, "").trim());
  return out;
}
function applyErpBom(db, { list, docs, pending: pending3 }, groups, { username = "ERP", source = "ERP", dry = false } = {}) {
  return tx(db, () => {
    const hasMap = (code) => !!db.prepare("SELECT 1 FROM model_map WHERE model_code = ?").get(code);
    const rows = [], modelMap = /* @__PURE__ */ new Map(), noModel = [], empty = [];
    for (const d of docs) {
      if (!d.rows.length) {
        empty.push(d.item);
        continue;
      }
      if (!hasMap(d.item)) {
        const g = groups.get(d.item) || "";
        if (!g) {
          noModel.push(d.item);
          continue;
        }
        modelMap.set(d.item, g);
      }
      const proc = new Map(db.prepare("SELECT material, process FROM bom WHERE model_code = ?").all(d.item).map((r) => [r.material, r.process || ""]));
      for (const r of d.rows) if (r.point > 0) rows.push({ modelCode: d.item, material: r.material, description: r.description, point: r.point, process: proc.get(r.material) || "", group: null });
    }
    let imp = null;
    if (rows.length) imp = importBom(db, { rows, modelMap, vln: [], dup: 0 }, { source, username, maxChanged: Infinity, dry });
    if (dry) return { ok: true, dry: true, total: list.length, fetched: docs.length, pending: pending3, noModel, empty, preview: imp };
    const up = db.prepare("INSERT INTO erp_bom(item, name, modified, lines, synced_at) VALUES (?,?,?,?,datetime('now')) ON CONFLICT(item) DO UPDATE SET name = excluded.name, modified = excluded.modified, lines = excluded.lines, synced_at = excluded.synced_at");
    for (const d of docs) if (d.rows.length && !noModel.includes(d.item)) up.run(d.item, d.name, d.modified, d.rows.length);
    const erpItems = new Set(list.map((b) => b.item));
    const missing = db.prepare("SELECT item FROM erp_bom").all().map((r) => r.item).filter((i) => !erpItems.has(i));
    const summary = {
      ok: true,
      source,
      total: list.length,
      fetched: docs.length,
      applied: imp ? imp.newCodes.length + imp.changed.length : 0,
      newCodes: imp ? imp.newCodes.map((x) => x.code) : [],
      changed: imp ? imp.changed.map((x) => x.code) : [],
      unchanged: imp ? imp.unchanged : docs.length,
      pending: pending3,
      noModel,
      empty,
      erpMissing: missing,
      suggested: (imp == null ? void 0 : imp.suggested) || 0
    };
    db.prepare("INSERT INTO import_log(kind, source, summary, created_by) VALUES (?,?,?,?)").run("ERP_BOM", source, JSON.stringify(summary), username);
    cfgSet(db, "bom_ok_at", (/* @__PURE__ */ new Date()).toISOString());
    if (summary.applied) audit(db, username, "bom.erp", { newCodes: summary.newCodes, changed: summary.changed, pending: pending3 });
    return summary;
  });
}
function syncErpBom(db, makeHttp, { username = "ERP", source = "ERP", auto = false, dry = false, max } = {}) {
  ensureErpStockSchema(db);
  const { c, skip } = ready(db, makeHttp, "bomSync", auto, "BOM t\u1EEB ERP");
  if (skip) return skip;
  const seen = new Map(db.prepare("SELECT item, name, modified FROM erp_bom").all().map((r) => [r.item, r]));
  let data, groups = /* @__PURE__ */ new Map();
  try {
    const http = makeHttp(c);
    data = pullErpBom(http, seen, max ? { max } : {});
    const newCodes = data.docs.map((d) => d.item).filter((code) => !db.prepare("SELECT 1 FROM model_map WHERE model_code = ?").get(code));
    if (newCodes.length) groups = pullItemGroups(http, newCodes);
  } catch (e) {
    if (!e.status) throw e;
    logError2(db, "ERP_BOM", e.message, source, username);
    return { ok: false, error: e.message };
  }
  return applyErpBom(db, data, groups, { username, source, dry });
}
function erpStockRoutes(db, makeHttp) {
  ensureErpStockSchema(db);
  return [
    { method: "GET", path: "/api/kho/stock", handler: ({ query }) => stockView(db, { model: String(query.get("model") || "").trim(), all: query.get("all") === "1" }) },
    { method: "POST", path: "/api/kho/stock/sync", handler: ({ user }) => syncErpStock(db, makeHttp, { username: user.username, source: `\u0110\u1ED3ng b\u1ED9 tay \xB7 ${user.username}` }) },
    { method: "GET", path: "/api/bom/erp", handler: () => bomErpStatus(db) },
    { method: "POST", path: "/api/bom/erp/sync", handler: ({ body, user }) => syncErpBom(db, makeHttp, { username: user.username, source: `\u0110\u1ED3ng b\u1ED9 tay \xB7 ${user.username}`, dry: !!(body == null ? void 0 : body.dry) }) }
  ];
}

// ../kitting-app/lib/kit-lot.mjs
var SHORT_REASONS = { STOCK: "H\u1EBFt t\u1ED3n / t\u1ED3n kh\xF4ng \u0111\u1EE7", WAIT: "Ch\u1EDD h\xE0ng v\u1EC1", URGENT: "Line c\u1EA7n g\u1EA5p, giao tr\u01B0\u1EDBc", QUALITY: "V\u1EADt li\u1EC7u l\u1ED7i, ch\u1EDD \u0111\u1ED5i", OTHER: "Kh\xE1c" };
var LOT_STATUS = { pending: "Ch\u1EDD Line nh\u1EADn", received: "\u0110\xE3 nh\u1EADn", rejected: "Line t\u1EEB ch\u1ED1i" };
var r33 = (n) => Math.round(Number(n) * 1e3) / 1e3;
var t = (v) => String(v != null ? v : "").trim();
var isWhole = (n) => Math.abs(Number(n) - Math.round(Number(n))) < 1e-9;
var capOf = (debt) => isWhole(debt) ? Number(debt) : Math.ceil(debt);
var ikey = (grp, code, material) => `${grp}${code || ""}${material}`;
function ensureLotSchema(db) {
  const had = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'kit_lot'").get();
  db.exec(`
  CREATE TABLE IF NOT EXISTS kit_lot (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kit_id INTEGER NOT NULL, kit_code TEXT NOT NULL, line TEXT, seq INTEGER NOT NULL, lot_no TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), src_txn INTEGER,
    signer TEXT, signer_name TEXT, signed_at TEXT, signed_by TEXT, reason TEXT, note TEXT, kho_note TEXT, kho_by TEXT, kho_at TEXT);
  CREATE TABLE IF NOT EXISTS kit_lot_item (
    lot_id INTEGER NOT NULL, grp TEXT NOT NULL, kit_group TEXT, model_code TEXT NOT NULL DEFAULT '', material TEXT NOT NULL, description TEXT, qty REAL NOT NULL,
    PRIMARY KEY (lot_id, grp, model_code, material));
  CREATE TABLE IF NOT EXISTS kit_bu (
    kit_id INTEGER NOT NULL, grp TEXT NOT NULL, model_code TEXT NOT NULL DEFAULT '', material TEXT NOT NULL, qty REAL NOT NULL,
    username TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (kit_id, grp, model_code, material));
  CREATE INDEX IF NOT EXISTS kit_lot_kit ON kit_lot(kit_id);
  CREATE INDEX IF NOT EXISTS kit_lot_status ON kit_lot(status);`);
  if (!had) backfillLots(db);
}
function backfillLots(db) {
  db.exec(`
  INSERT INTO kit_lot(kit_id, kit_code, line, seq, lot_no, status, created_by, created_at, src_txn)
    SELECT k.id, t.kit_code, COALESCE(t.line, k.line), 1 + ROW_NUMBER() OVER (PARTITION BY t.kit_code ORDER BY t.id), t.kit_code || '-B' || (1 + ROW_NUMBER() OVER (PARTITION BY t.kit_code ORDER BY t.id)),
      'pending', t.username, t.created_at, t.id
    FROM kit_txn t JOIN kit_order k ON k.code = t.kit_code WHERE t.type = 'debt_settle' AND NOT EXISTS (SELECT 1 FROM kit_lot l WHERE l.src_txn = t.id);
  INSERT OR IGNORE INTO kit_lot_item(lot_id, grp, kit_group, model_code, material, description, qty)
    SELECT l.id, t.grp, t.kit_group, COALESCE(t.ref_code, ''), t.material, (SELECT i.description FROM kit_item i WHERE i.kit_id = l.kit_id AND i.material = t.material LIMIT 1), t.qty
    FROM kit_lot l JOIN kit_txn t ON t.id = l.src_txn WHERE NOT EXISTS (SELECT 1 FROM kit_lot_item x WHERE x.lot_id = l.id);`);
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'kit_receipt'").get())
    db.exec(`UPDATE kit_lot SET status = 'received', signer = (SELECT r.signer FROM kit_receipt r WHERE r.kit_id = kit_lot.kit_id), signer_name = (SELECT r.signer_name FROM kit_receipt r WHERE r.kit_id = kit_lot.kit_id),
      signed_at = (SELECT r.at FROM kit_receipt r WHERE r.kit_id = kit_lot.kit_id), signed_by = 'nh\u1EADn PO'
      WHERE status = 'pending' AND EXISTS (SELECT 1 FROM kit_receipt r WHERE r.kit_id = kit_lot.kit_id AND r.status = 'received' AND r.at >= kit_lot.created_at)`);
}
var lotView = (db, l) => ({
  id: l.id,
  lotNo: l.lot_no,
  seq: l.seq,
  kitId: l.kit_id,
  kit: l.kit_code,
  line: l.line || "",
  status: l.status,
  createdBy: l.created_by || "",
  createdAt: l.created_at,
  signer: l.signer || "",
  signerName: l.signer_name || "",
  signedAt: l.signed_at || "",
  signedBy: l.signed_by || "",
  reason: l.reason || "",
  note: l.note || "",
  khoNote: l.kho_note || "",
  khoBy: l.kho_by || "",
  khoAt: l.kho_at || "",
  items: db.prepare("SELECT * FROM kit_lot_item WHERE lot_id = ? ORDER BY CASE kit_group WHEN 'REAR' THEN 0 WHEN 'VLDT' THEN 1 ELSE 2 END, model_code, material").all(l.id).map((i) => ({ grp: i.grp, group: i.kit_group || "", code: i.model_code, material: i.material, description: i.description || "", qty: r33(i.qty) }))
});
function lotsOfKit(db, kitId) {
  ensureLotSchema(db);
  return db.prepare("SELECT * FROM kit_lot WHERE kit_id = ? ORDER BY seq").all(Number(kitId)).map((l) => lotView(db, l));
}
function lotStats(db, kitId) {
  ensureLotSchema(db);
  const m = /* @__PURE__ */ new Map();
  for (const r of db.prepare(`SELECT i.grp, i.model_code, i.material, SUM(i.qty) q, COUNT(*) n, SUM(l.status <> 'received') open FROM kit_lot_item i JOIN kit_lot l ON l.id = i.lot_id WHERE l.kit_id = ? GROUP BY i.grp, i.model_code, i.material`).all(Number(kitId)))
    m.set(ikey(r.grp, r.model_code, r.material), { bu: r33(r.q), n: r.n, open: r.open });
  return m;
}
var lotKey = ikey;
function lotCount(db, kitId) {
  ensureLotSchema(db);
  const r = db.prepare("SELECT SUM(status = 'pending') p, SUM(status = 'rejected') x, COUNT(*) n FROM kit_lot WHERE kit_id = ?").get(Number(kitId));
  return { pending: r.p || 0, rejected: r.x || 0, total: r.n || 0 };
}
function createLot(db, kit, input, user, logTxn2) {
  var _a;
  ensureLotSchema(db);
  const list = (Array.isArray(input) ? input : []).filter((i) => Number(i.qty) > 0);
  if (!list.length) throw fail("Nh\u1EADp s\u1ED1 giao b\xF9 cho \xEDt nh\u1EA5t 1 m\xE3.");
  const seq = (db.prepare("SELECT MAX(seq) s FROM kit_lot WHERE kit_id = ?").get(kit.id).s || 1) + 1, lotNo = `${kit.code}-B${seq}`;
  const lotId = Number((_a = db.prepare("INSERT INTO kit_lot(kit_id, kit_code, line, seq, lot_no, created_by) VALUES (?,?,?,?,?,?)").run(kit.id, kit.code, kit.line, seq, lotNo, user).lastInsertRowid) != null ? _a : db.prepare("SELECT id FROM kit_lot WHERE kit_id = ? AND seq = ?").get(kit.id, seq).id);
  const out = [], seen = /* @__PURE__ */ new Set();
  for (const x of list) {
    const grp = t(x.grp), code = t(x.code), material = t(x.material), k = ikey(grp, code, material);
    if (seen.has(k)) throw fail(`${material} nh\u1EADp 2 l\u1EA7n.`);
    seen.add(k);
    const it = db.prepare("SELECT * FROM kit_item WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?").get(kit.id, grp, code, material);
    if (!it) throw fail(`Kh\xF4ng t\xECm th\u1EA5y m\xE3 n\u1EE3 ${material}.`);
    const q = r33(x.qty), debt = r33(it.required - it.delivered), cap = capOf(debt);
    if (debt <= 0) throw fail(`${material} \u0111\xE3 h\u1EBFt n\u1EE3.`);
    if (!Number.isFinite(q) || q <= 0 || q > cap + 1e-9) throw fail(`${material}: s\u1ED1 giao b\xF9 ph\u1EA3i l\u1EDBn h\u01A1n 0 v\xE0 kh\xF4ng qu\xE1 ${cap}.`);
    const clear = q >= debt - 1e-9;
    db.prepare(`UPDATE kit_item SET kitted = kitted + ?, delivered = delivered + ?${clear ? ", required = delivered + ?" : ""} WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?`).run(...clear ? [q, q, q] : [q, q], kit.id, grp, code, material);
    logTxn2(db, { kitCode: kit.code, type: "debt_settle", grp, kitGroup: it.kit_group, material, qty: q, ref: code, line: kit.line, note: lotNo, user });
    if (clear && q > debt + 1e-9) logTxn2(db, { kitCode: kit.code, type: "round", grp, kitGroup: it.kit_group, material, qty: r33(q - debt), ref: code, line: kit.line, note: `\u0110\u1ECBnh m\u1EE9c ${r33(it.required)} \u2192 c\u1EA5p ${r33(it.delivered + q)}`, user });
    db.prepare("INSERT INTO kit_lot_item(lot_id, grp, kit_group, model_code, material, description, qty) VALUES (?,?,?,?,?,?,?)").run(lotId, grp, it.kit_group, code, material, it.description || "", q);
    const bu = db.prepare("SELECT qty FROM kit_bu WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?").get(kit.id, grp, code, material);
    if (bu) {
      const left = r33(bu.qty - q);
      if (left > 0 && !clear) db.prepare("UPDATE kit_bu SET qty = ? WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?").run(left, kit.id, grp, code, material);
      else db.prepare("DELETE FROM kit_bu WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?").run(kit.id, grp, code, material);
    }
    out.push({ material, q, left: clear ? 0 : r33(debt - q) });
  }
  audit(db, user, "kit.lot", { kit: kit.code, lot: lotNo, line: kit.line, items: out.map((o) => [o.material, o.q]) });
  return { lotNo, lotId, items: out };
}
function debtKits(db, kitId) {
  return db.prepare(`SELECT DISTINCT k.* FROM kit_order k JOIN kit_item i ON i.kit_id = k.id WHERE k.vln_status = 'delivered' AND i.delivered < i.required - 1e-9 ${kitId ? "AND k.id = ?" : ""} ORDER BY k.delivered_at`).all(...kitId ? [Number(kitId)] : []);
}
function buItems(db, kit) {
  const prep = new Map(db.prepare("SELECT * FROM kit_bu WHERE kit_id = ?").all(kit.id).map((b) => [ikey(b.grp, b.model_code, b.material), b]));
  const st = lotStats(db, kit.id);
  return db.prepare(`SELECT * FROM kit_item WHERE kit_id = ? AND delivered < required - 1e-9 ORDER BY CASE kit_group WHEN 'REAR' THEN 0 WHEN 'VLDT' THEN 1 ELSE 2 END, model_code, material`).all(kit.id).map((i) => {
    const k = ikey(i.grp, i.model_code, i.material), b = prep.get(k), s = st.get(k);
    return {
      grp: i.grp,
      group: i.kit_group,
      code: i.model_code,
      material: i.material,
      description: i.description || "",
      required: r33(i.required),
      delivered: r33(i.delivered),
      debt: r33(i.required - i.delivered),
      cap: capOf(r33(i.required - i.delivered)),
      prepared: b ? r33(b.qty) : 0,
      preparedBy: (b == null ? void 0 : b.username) || "",
      preparedAt: (b == null ? void 0 : b.updated_at) || "",
      bu: (s == null ? void 0 : s.bu) || 0,
      buN: (s == null ? void 0 : s.n) || 0
    };
  });
}
function buList(db) {
  ensureLotSchema(db);
  const rows = debtKits(db).map((k) => {
    const items2 = buItems(db, k), lc = lotCount(db, k.id);
    return {
      kitId: k.id,
      code: k.code,
      line: k.line,
      modelCode: k.model_code,
      deliveredAt: k.delivered_at,
      items: items2.length,
      rear: items2.filter((i) => i.group === "REAR").length,
      debt: r33(items2.reduce((s, i) => s + i.debt, 0)),
      prepared: items2.filter((i) => i.prepared > 0).length,
      full: items2.filter((i) => i.prepared >= i.debt - 1e-9).length,
      lots: lc
    };
  });
  return { rows, kpi: { kits: rows.length, items: rows.reduce((s, r) => s + r.items, 0), prepared: rows.reduce((s, r) => s + r.prepared, 0) } };
}
function buDetail(db, kitId) {
  ensureLotSchema(db);
  const kit = db.prepare("SELECT * FROM kit_order WHERE id = ?").get(Number(kitId));
  if (!kit) throw fail("Kh\xF4ng t\xECm th\u1EA5y PO / Kit.", 404);
  if (kit.vln_status !== "delivered") throw fail(`${kit.code} ch\u01B0a giao Line.`);
  const items2 = buItems(db, kit), st = stockOf(db, items2.map((i) => i.material));
  return {
    kit: { id: kit.id, code: kit.code, line: kit.line, modelCode: kit.model_code, deliveredAt: kit.delivered_at, deliveredBy: kit.delivered_by || "" },
    stockAt: stockStatus(db).okAt || "",
    items: items2.map((i) => {
      const s = st.get(i.material);
      return __spreadProps(__spreadValues({}, i), { locs: s ? s.locs.slice(0, 4) : [], stock: s ? s.total : null, defaultLoc: (s == null ? void 0 : s.defaultLoc) || "" });
    }),
    lots: lotsOfKit(db, kit.id)
  };
}
function saveBu(db, { kitId, items: input }, user) {
  ensureLotSchema(db);
  return tx(db, () => {
    const kit = db.prepare("SELECT * FROM kit_order WHERE id = ?").get(Number(kitId));
    if (!kit || kit.vln_status !== "delivered") throw fail("PO ch\u01B0a giao Line, kh\xF4ng c\xF3 n\u1EE3 \u0111\u1EC3 so\u1EA1n b\xF9.");
    let n = 0;
    for (const x of Array.isArray(input) ? input : []) {
      const grp = t(x.grp), code = t(x.code), material = t(x.material), q = r33(x.qty);
      const it = db.prepare("SELECT * FROM kit_item WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?").get(kit.id, grp, code, material);
      if (!it) throw fail(`M\xE3 ${material} kh\xF4ng thu\u1ED9c kit n\xE0y.`);
      const debt = r33(it.required - it.delivered);
      if (!Number.isFinite(q) || q < 0) throw fail(`${material}: s\u1ED1 so\u1EA1n b\xF9 kh\xF4ng h\u1EE3p l\u1EC7.`);
      if (q > capOf(debt) + 1e-9) throw fail(`${material}: so\u1EA1n b\xF9 t\u1ED1i \u0111a ${capOf(debt)} (\u0111ang n\u1EE3 ${debt}).`);
      const cur = db.prepare("SELECT qty FROM kit_bu WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?").get(kit.id, grp, code, material);
      if (r33((cur == null ? void 0 : cur.qty) || 0) === q) continue;
      if (q > 0) db.prepare(`INSERT INTO kit_bu(kit_id, grp, model_code, material, qty, username, updated_at) VALUES (?,?,?,?,?,?,datetime('now'))
        ON CONFLICT(kit_id, grp, model_code, material) DO UPDATE SET qty = excluded.qty, username = excluded.username, updated_at = excluded.updated_at`).run(kit.id, grp, code, material, q, user);
      else db.prepare("DELETE FROM kit_bu WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?").run(kit.id, grp, code, material);
      n++;
    }
    const items2 = buItems(db, kit);
    return { ok: true, changed: n, message: `${kit.code}: \u0111\xE3 so\u1EA1n b\xF9 ${items2.filter((i) => i.prepared > 0).length}/${items2.length} m\xE3` };
  });
}
function lotsForLine(db, line) {
  ensureLotSchema(db);
  const rows = db.prepare(`SELECT l.* FROM kit_lot l JOIN kit_order k ON k.id = l.kit_id WHERE k.vln_status = 'delivered' AND (? = '' OR l.line = ?)
    AND (l.status <> 'received' OR l.signed_at >= datetime('now', '-1 day')) ORDER BY CASE l.status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END, l.created_at DESC`).all(t(line), t(line)).map((l) => lotView(db, l));
  return { line: t(line), rows, pending: rows.filter((r) => r.status === "pending").length, rejected: rows.filter((r) => r.status === "rejected").length };
}
function pickLots(db, ids, line) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean))];
  if (!list.length) throw fail("Ch\u1ECDn \xEDt nh\u1EA5t 1 \u0111\u1EE3t giao b\xF9.");
  if (list.length > 50) throw fail("T\u1ED1i \u0111a 50 \u0111\u1EE3t m\u1ED7i l\u1EA7n.");
  const lots = list.map((id) => {
    const l = db.prepare("SELECT * FROM kit_lot WHERE id = ?").get(id);
    if (!l) throw fail("Kh\xF4ng t\xECm th\u1EA5y \u0111\u1EE3t giao b\xF9.", 404);
    return l;
  });
  const lines = [...new Set(lots.map((l) => l.line))];
  if (lines.length > 1) throw fail("Ch\u1EC9 k\xFD c\xE1c \u0111\u1EE3t c\u1EE7a c\xF9ng 1 Line.");
  if (line && lines[0] !== line) throw fail(`\u0110\u1EE3t giao b\xF9 thu\u1ED9c ${lines[0]}, kh\xF4ng ph\u1EA3i ${line}.`);
  for (const l of lots) if (l.status !== "pending") throw fail(`${l.lot_no} ${l.status === "received" ? `\u0111\xE3 \u0111\u01B0\u1EE3c ${l.signer_name || l.signer} nh\u1EADn` : "\u0111ang ch\u1EDD Kho x\u1EED l\xFD l\u1EA7n t\u1EEB ch\u1ED1i"}.`);
  return lots;
}
function receiveLots(db, body, user, sign, RECEIPT_REASONS2) {
  ensureLotSchema(db);
  const reject = !!body.reject, reason = t(body.reason), note = t(body.note).slice(0, 300);
  if (reject && !RECEIPT_REASONS2[reason]) throw fail("Ch\u1ECDn l\xFD do t\u1EEB ch\u1ED1i.");
  if (reject && reason === "OTHER" && !note) throw fail('L\xFD do "Kh\xE1c" c\u1EA7n ghi ch\xFA.');
  const lots = pickLots(db, body.ids, t(body.line));
  const s = sign(body.signer, body.pin2, lots[0].line);
  if (!s.ok) return s;
  return tx(db, () => {
    const up = db.prepare("UPDATE kit_lot SET status = ?, signer = ?, signer_name = ?, signed_at = datetime('now'), signed_by = ?, reason = ?, note = ? WHERE id = ?");
    for (const l of lots) up.run(reject ? "rejected" : "received", s.username, s.name || s.username, user, reject ? reason : null, note || null, l.id);
    audit(db, user, reject ? "lot.reject" : "lot.receive", { lots: lots.map((l) => l.lot_no), line: lots[0].line, signer: s.username, reason: reject ? reason : void 0, note });
    const names = lots.map((l) => l.lot_no).join(", ");
    return { ok: true, message: reject ? `\u0110\xE3 t\u1EEB ch\u1ED1i ${names} (${RECEIPT_REASONS2[reason]}) \u2014 \u0111\xE3 b\xE1o Kho.` : `${s.name || s.username} \u0111\xE3 k\xFD nh\u1EADn ${lots.length} \u0111\u1EE3t giao b\xF9: ${names}.` };
  });
}
function receivePendingLots(db, kitId, signer, user) {
  ensureLotSchema(db);
  db.prepare("UPDATE kit_lot SET status = 'received', signer = ?, signer_name = ?, signed_at = datetime('now'), signed_by = ? WHERE kit_id = ? AND status = 'pending'").run(signer.username, signer.name || signer.username, `${user} \xB7 nh\u1EADn PO`, Number(kitId));
}
function resolveLot(db, { id, note }, user) {
  ensureLotSchema(db);
  const l = db.prepare("SELECT * FROM kit_lot WHERE id = ?").get(Number(id)), n = t(note).slice(0, 300);
  if (!l) throw fail("Kh\xF4ng t\xECm th\u1EA5y \u0111\u1EE3t giao b\xF9.", 404);
  if (l.status !== "rejected") throw fail(`${l.lot_no} kh\xF4ng \u1EDF tr\u1EA1ng th\xE1i Line t\u1EEB ch\u1ED1i.`);
  if (!n) throw fail("Ghi ch\xFA Kho \u0111\xE3 x\u1EED l\xFD g\xEC.");
  return tx(db, () => {
    db.prepare("UPDATE kit_lot SET status = 'pending', kho_note = ?, kho_by = ?, kho_at = datetime('now') WHERE id = ?").run(n, user, l.id);
    audit(db, user, "lot.resolve", { lot: l.lot_no, line: l.line, note: n });
    return { ok: true, message: `${l.lot_no}: \u0111\xE3 b\xE1o ${l.line} k\xFD nh\u1EADn l\u1EA1i.` };
  });
}
function rejectedLots(db) {
  ensureLotSchema(db);
  return db.prepare("SELECT l.* FROM kit_lot l JOIN kit_order k ON k.id = l.kit_id WHERE l.status = 'rejected' AND k.vln_status = 'delivered' ORDER BY l.signed_at").all().map((l) => lotView(db, l));
}

// ../kitting-app/lib/kitting.mjs
var REASONS = { PO_CANCEL: "PO h\u1EE7y / ho\xE3n", URGENT: "PO g\u1EA5p c\u1EA7n v\u1EADt li\u1EC7u", DEFECT: "V\u1EADt li\u1EC7u l\u1ED7i", MODEL_CHANGE: "\u0110\u1ED5i Model / BOM", OTHER: "Kh\xE1c" };
var TXN_LABEL = { kit: "Kitting", deliver: "Giao line", debt_settle: "Giao b\xF9 n\u1EE3", short_confirm: "Xong c\xF2n thi\u1EBFu", transfer_out: "Chuy\u1EC3n \u0111i", transfer_in: "Nh\u1EADn chuy\u1EC3n", return: "Tr\u1EA3 kho", recall: "Thu h\u1ED3i t\u1EEB line", issue: "C\u1EA5p v\u1EADt li\u1EC7u", po_cancel: "G\u1EE1 PO h\u1EE7y", round: "L\xE0m tr\xF2n \u0111\u1ECBnh m\u1EE9c", start: "B\u1EAFt \u0111\u1EA7u kitting", unstart: "V\u1EC1 ch\u01B0a l\xE0m" };
var GROUPS = { VLN: ["VLN"], HV: ["REAR", "VLDT"] };
var r34 = (n) => Math.round(Number(n) * 1e3) / 1e3;
function loadKit2(db, id) {
  const kit = db.prepare("SELECT * FROM kit_order WHERE id = ?").get(Number(id));
  if (!kit) throw fail("PO / Kit PO kh\xF4ng c\xF2n t\u1ED3n t\u1EA1i. H\xE3y t\u1EA3i l\u1EA1i.", 409);
  return kit;
}
function kitPos(db, kitId) {
  return db.prepare("SELECT p.* FROM kit_order_po k JOIN po p ON p.po_key = k.po_key WHERE k.kit_id = ? ORDER BY p.po_no").all(kitId);
}
var isUnplan = (p) => p.po_type === "UNPLAN";
var fixedLineOf = (pos) => [...new Set(pos.map((p) => p.fixed_line).filter(Boolean))][0] || "";
var internalOf = (pos) => pos.filter((p) => p.po_type && p.po_type !== "SAP").map((p) => ({ po: p.po_no, type: p.po_type }));
function kitHeader(db, kit, ro) {
  var _a, _b, _c, _d;
  const pos = kitPos(db, kit.id), rank = (_a = ro == null ? void 0 : ro.rank) != null ? _a : null;
  const live = pos.filter((p) => !isCancelled(p)), states = new Set((live.length ? live : pos).map(productionState));
  return {
    id: kit.id,
    code: kit.code,
    kind: kit.kind,
    modelCode: kit.model_code,
    model: modelOf(db, kit.model_code, (_b = pos[0]) == null ? void 0 : _b.basic_model),
    codes: [...new Set(pos.map((p) => p.model_code))].sort(),
    planDay: kit.plan_day,
    rank,
    mrank: (_c = ro == null ? void 0 : ro.mrank) != null ? _c : null,
    round: (_d = ro == null ? void 0 : ro.round) != null ? _d : null,
    behind: !!(ro == null ? void 0 : ro.behind),
    planStart: (ro == null ? void 0 : ro.start) || "",
    shortModel: !!(ro == null ? void 0 : ro.short),
    line: kit.line || "",
    deliveredAt: kit.delivered_at || "",
    vln: kit.vln_status,
    hv: kit.hv_status,
    qty: pos.reduce((s, p) => s + p.plan_qty, 0),
    remain: pos.reduce((s, p) => s + p.remain_qty, 0),
    state: states.size === 1 ? [...states][0] : states.has("running") || states.has("done") ? "running" : "waiting",
    pos: pos.map((p) => ({ po: p.po_no, modelCode: p.model_code, qty: p.plan_qty, remain: p.remain_qty, state: productionState(p) })),
    cancelled: pos.filter(isCancelled).map((p) => p.po_no),
    fixedLine: fixedLineOf(pos),
    planLine: kit.plan_line || "",
    internal: internalOf(pos),
    notes: pos.filter((p) => p.note).map((p) => ({ po: p.po_no, note: p.note })),
    unplanRear: pos.filter(isUnplan).map((p) => ({ po: p.po_no, modelCode: p.model_code, qty: p.plan_qty })),
    // PO Load thành phẩm: Line nhận thêm hàng thành phẩm từ Kho (số dương để hiển thị)
    loadTp: pos.filter((p) => p.po_type === "LOAD" && !isCancelled(p)).map((p) => ({ po: p.po_no, modelCode: p.model_code, qty: -p.plan_qty, ref: p.ref_doc || "" }))
  };
}
function ranks(db) {
  return kitQueueOrder(db);
}
function bomLines(db, pos, modelCode, grp, soft = false) {
  var _a;
  const qty = pos.reduce((s, p) => s + p.plan_qty, 0);
  if (grp === "VLN") {
    const model = modelOf(db, modelCode, (_a = pos[0]) == null ? void 0 : _a.basic_model);
    let rows = vlnBom(db, model);
    if (!rows.length) rows = db.prepare("SELECT material, description, point, kit_group FROM bom WHERE model_code = ? AND kit_group = 'VLN' ORDER BY material").all(modelCode);
    if (!rows.length) {
      if (soft) return { missing: [model || modelCode], lines: [] };
      throw fail(`Model ${model} ch\u01B0a c\xF3 BOM VLN.`);
    }
    return { missing: [], lines: rows.map((r) => ({ kit_group: "VLN", model_code: "", material: r.material, description: r.description, point: r.point, required: r34(qty * r.point) })) };
  }
  const hvRows = (code) => db.prepare(`SELECT material, description, point, kit_group FROM bom WHERE model_code = ? AND kit_group IN ('REAR','VLDT') ORDER BY kit_group DESC, material`).all(code);
  const byCode = /* @__PURE__ */ new Map(), rearQty = /* @__PURE__ */ new Map();
  for (const p of pos) {
    byCode.set(p.model_code, (byCode.get(p.model_code) || 0) + p.plan_qty);
    rearQty.set(p.model_code, (rearQty.get(p.model_code) || 0) + (isUnplan(p) ? 0 : p.plan_qty));
  }
  const missing = [...byCode.keys()].filter((c) => !hvRows(c).length);
  if (missing.length && !soft) throw fail(`Model Code ${missing.join(", ")} ch\u01B0a c\xF3 BOM Rear + VL\u0110T.`);
  const lines = [];
  for (const [code, q] of byCode) for (const r of hvRows(code)) {
    const n = r.kit_group === "REAR" ? rearQty.get(code) : q;
    if (n > 0) lines.push({ kit_group: r.kit_group, model_code: code, material: r.material, description: r.description, point: r.point, required: r34(n * r.point) });
  }
  return { missing, lines };
}
function ensureItems(db, kit, grp) {
  const pos = kitPos(db, kit.id), ins = db.prepare("INSERT INTO kit_item(kit_id, grp, kit_group, model_code, material, description, required) VALUES (?,?,?,?,?,?,?)");
  const exist = items(db, kit.id, grp);
  if (exist.length) {
    if (!(grp === "HV" && pos.some(isUnplan) && exist.every((i) => i.kitted <= 0))) return;
    const want = bomLines(db, pos, kit.model_code, grp, true).lines, sig = (l) => l.map((i) => `${i.model_code}|${i.material}|${r34(i.required)}`).sort().join(";");
    if (!want.length || sig(want) === sig(exist)) return;
    db.prepare("DELETE FROM kit_item WHERE kit_id = ? AND grp = ?").run(kit.id, grp);
    for (const r of want) ins.run(kit.id, grp, r.kit_group, r.model_code, r.material, r.description, r.required);
    return;
  }
  for (const r of bomLines(db, pos, kit.model_code, grp).lines) ins.run(kit.id, grp, r.kit_group, r.model_code, r.material, r.description, r.required);
}
function materialSummary(db, { to, unplanned = false } = {}) {
  var _a, _b, _c;
  to = /^\d{4}-\d{2}-\d{2}$/.test(to || "") ? to : todayKey();
  const rk = ranks(db), rows = [], noBom = [], kitPo = {};
  const add = (src, pos, modelCode, grp, status) => {
    if (status === "delivered" || !pos.length) return;
    const live = pos.filter((p) => !isCancelled(p));
    if (!live.length) return;
    kitPo[src.code] = live.map((p) => p.po_no);
    const qtyOf = /* @__PURE__ */ new Map();
    for (const p of live) qtyOf.set(p.model_code, (qtyOf.get(p.model_code) || 0) + p.plan_qty);
    const total = [...qtyOf.values()].reduce((a, b) => a + b, 0);
    let list = src.kitId ? items(db, src.kitId, grp).map((i) => __spreadValues({}, i)) : [];
    if (grp === "HV" && live.some(isUnplan) && list.every((i) => i.kitted <= 0)) list = [];
    if (!list.length) {
      const b = bomLines(db, live, modelCode, grp, true);
      if (b.missing.length) noBom.push({ code: src.code, grp, missing: b.missing });
      list = b.lines.map((l) => __spreadProps(__spreadValues({}, l), { kitted: 0 }));
    }
    for (const i of list) {
      const parts = i.model_code ? [[i.model_code, 1]] : [...qtyOf].map(([c, q]) => [c, total ? q / total : 0]);
      for (const [code, f] of parts) rows.push({ day: src.day, mrank: src.mrank, kit: src.code, model: src.model, code, grp: i.kit_group, material: i.material, description: i.description || "", required: r34(i.required * f), kitted: r34(i.kitted * f) });
    }
  };
  const kits = db.prepare(`SELECT * FROM kit_order WHERE ${unplanned ? "(plan_day IS NULL OR plan_day <= ?)" : "plan_day IS NOT NULL AND plan_day <= ?"} AND NOT (vln_status = 'delivered' AND hv_status = 'delivered') ORDER BY plan_day, seq, id`).all(to);
  for (const k of kits) {
    const pos = kitPos(db, k.id), src = { kitId: k.id, day: k.plan_day || "", mrank: (_b = (_a = rk.get(k.id)) == null ? void 0 : _a.mrank) != null ? _b : null, code: k.code, model: modelOf(db, k.model_code, (_c = pos[0]) == null ? void 0 : _c.basic_model) };
    add(src, pos, k.model_code, "VLN", k.vln_status);
    add(src, pos, k.model_code, "HV", k.hv_status);
  }
  if (unplanned) {
    const free = db.prepare(`SELECT p.* FROM po p WHERE p.in_source = 1 AND p.remain_qty > 0 AND NOT EXISTS (SELECT 1 FROM kit_order_po k WHERE k.po_key = p.po_key) ORDER BY p.plan_start, p.po_no`).all().filter((p) => !isCancelled(p));
    for (const p of free) {
      const src = { kitId: null, day: "", mrank: null, code: p.po_no, model: modelOf(db, p.model_code, p.basic_model) };
      add(src, [p], p.model_code, "VLN", "pending");
      add(src, [p], p.model_code, "HV", "pending");
    }
  }
  for (const r of rows) r.remain = r34(Math.max(0, r.required - r.kitted));
  return { to, unplanned: !!unplanned, today: todayKey(), kits: new Set(rows.map((r) => r.kit)).size, rows, noBom, kitPo };
}
function items(db, kitId, grp) {
  return db.prepare(`SELECT * FROM kit_item WHERE kit_id = ? ${grp ? "AND grp = ?" : ""} ORDER BY grp DESC, model_code, CASE kit_group WHEN 'REAR' THEN 0 WHEN 'VLDT' THEN 1 ELSE 2 END, material`).all(...grp ? [kitId, grp] : [kitId]);
}
var isWhole2 = (n) => Math.abs(Number(n) - Math.round(Number(n))) < 1e-9;
var kitCap = (req) => isWhole2(req) ? Number(req) : Math.ceil(req);
var kitTarget = (req) => isWhole2(req) ? Number(req) : Math.max(1, Math.floor(req));
var enough = (i) => i.kitted >= kitTarget(i.required) - 1e-9;
function roundItems(db, kit, grp, user) {
  const up = db.prepare("UPDATE kit_item SET required = ? WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?");
  for (const i of items(db, kit.id, grp)) if (!isWhole2(i.required) && enough(i) && i.kitted <= kitCap(i.required)) {
    up.run(i.kitted, kit.id, grp, i.model_code, i.material);
    logTxn(db, { kitCode: kit.code, type: "round", grp, kitGroup: i.kit_group, material: i.material, qty: r34(i.kitted - i.required), ref: i.model_code, note: `\u0110\u1ECBnh m\u1EE9c ${r34(i.required)} \u2192 c\u1EA5p ${i.kitted}`, user });
  }
}
function progress(list) {
  const total = list.length, full = list.filter(enough).length, short = total - full;
  return { total, full, short, kittedQty: r34(list.reduce((s, i) => s + i.kitted, 0)), requiredQty: r34(list.reduce((s, i) => s + i.required, 0)) };
}
function rearZeroCodes(list) {
  const m = /* @__PURE__ */ new Map();
  for (const i of list.filter((i2) => i2.kit_group === "REAR")) m.set(i.model_code, (m.get(i.model_code) || 0) + i.kitted);
  return [...m].filter(([, v]) => v <= 0).map(([c]) => c);
}
var ikey2 = (code, material) => `${code || ""}${material}`;
var statusCol = (grp) => grp === "VLN" ? "vln_status" : "hv_status";
function setStatus(db, kitId, grp, status) {
  db.prepare(`UPDATE kit_order SET ${statusCol(grp)} = ?, updated_at = datetime('now') WHERE id = ?`).run(status, kitId);
}
function recompute(db, kit, grp) {
  const cur = loadKit2(db, kit.id)[statusCol(grp)];
  if (cur === "delivered") return;
  const list = items(db, kit.id, grp);
  if (!list.length || list.every((i) => i.kitted <= 0)) return setStatus(db, kit.id, grp, "pending");
  if (list.some((i) => !enough(i))) return setStatus(db, kit.id, grp, cur === "pending" ? "progress" : cur === "done" ? "progress" : cur);
}
function logTxn(db, t4) {
  db.prepare("INSERT INTO kit_txn(kit_code, type, grp, kit_group, material, qty, ref_code, line, reason_code, note, username) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(t4.kitCode || "", t4.type, t4.grp || null, t4.kitGroup || null, t4.material || null, r34(t4.qty || 0), t4.ref || null, t4.line || null, t4.reason || null, t4.note || null, t4.user || "");
}
function kitQueue(db, grp) {
  const rk = ranks(db);
  const where = grp === "VLN" ? "plan_day IS NOT NULL AND vln_status <> 'delivered'" : "plan_day IS NOT NULL AND hv_status <> 'delivered' AND vln_status IN ('progress','done')";
  const kits = db.prepare(`SELECT * FROM kit_order WHERE ${where} ORDER BY plan_day, seq, id`).all();
  const rows = kits.map((k) => {
    const h = kitHeader(db, k, rk.get(k.id));
    if (grp === "HV" && h.unplanRear.length && items(db, k.id, grp).length) tx(db, () => ensureItems(db, k, grp));
    const list = items(db, k.id, grp);
    const rz = rearZeroCodes(list);
    return __spreadProps(__spreadValues({}, h), {
      status: k[statusCol(grp)],
      progress: list.length ? progress(list) : null,
      rearZero: grp === "HV" && list.length > 0 && rz.length === new Set(list.filter((i) => i.kit_group === "REAR").map((i) => i.model_code)).size && rz.length > 0,
      rearZeroCodes: grp === "HV" ? rz : [],
      noBom: !list.length && h.codes.some((c2) => !db.prepare("SELECT 1 FROM bom WHERE model_code = ? LIMIT 1").get(c2))
    });
  });
  rows.sort((a, b) => {
    var _a, _b;
    return ((_a = a.rank) != null ? _a : 1e9) - ((_b = b.rank) != null ? _b : 1e9);
  });
  const c = (s) => rows.filter((r) => r.status === s).length;
  return { grp, rows, kpi: { pending: c("pending"), progress: c("progress"), done: c("done"), short: rows.filter((r) => {
    var _a;
    return r.status === "done" && ((_a = r.progress) == null ? void 0 : _a.short);
  }).length } };
}
function kitDetail(db, kitId, grp) {
  const kit = loadKit2(db, kitId);
  if (grp === "HV" && kit.vln_status === "pending") throw fail("PO ch\u01B0a b\u1EAFt \u0111\u1EA7u kitting VLN.");
  tx(db, () => ensureItems(db, kit, grp));
  const list = items(db, kit.id, grp);
  const printCount = db.prepare("SELECT COUNT(*) n FROM kit_txn WHERE type = 'print' AND kit_code = ? AND grp = ?").get(kit.code, grp).n;
  const start = db.prepare("SELECT MIN(p.plan_start) s FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = ? AND p.plan_start <> ''").get(kit.id).s || "";
  const st = stockOf(db, list.map((i) => i.material)), stockAt = stockStatus(db).okAt || "";
  return {
    kit: __spreadProps(__spreadValues({}, kitHeader(db, kit, ranks(db).get(kit.id))), { status: kit[statusCol(grp)], vlnStatus: kit.vln_status, planStart: start, printCount }),
    grp,
    stockAt,
    items: list.map((i) => {
      const s = st.get(i.material);
      return { code: i.model_code, material: i.material, description: i.description, kitGroup: i.kit_group, required: i.required, kitted: i.kitted, delivered: i.delivered, locs: s ? s.locs : [], stock: s ? s.total : 0, defaultLoc: s ? s.defaultLoc : "" };
    })
  };
}
function logPrint(db, { kitId, grp }, user) {
  if (!GROUPS[grp]) throw fail("Nh\xF3m kh\xF4ng h\u1EE3p l\u1EC7.");
  return tx(db, () => {
    const kit = loadKit2(db, kitId);
    logTxn(db, { kitCode: kit.code, type: "print", grp, user });
    return { ok: true, count: db.prepare("SELECT COUNT(*) n FROM kit_txn WHERE type = 'print' AND kit_code = ? AND grp = ?").get(kit.code, grp).n };
  });
}
function startKit(db, { kitId, back }, user) {
  return tx(db, () => {
    const kit = loadKit2(db, kitId);
    if (back) {
      if (kit.vln_status !== "progress") throw fail(`${kit.code} kh\xF4ng \u1EDF tr\u1EA1ng th\xE1i \u0110ang l\xE0m.`);
      if (kit.hv_status !== "pending" || items(db, kit.id).some((i) => i.kitted > 0)) throw fail(`${kit.code} \u0111\xE3 so\u1EA1n v\u1EADt li\u1EC7u, kh\xF4ng tr\u1EA3 v\u1EC1 Ch\u01B0a l\xE0m \u0111\u01B0\u1EE3c.`);
      setStatus(db, kit.id, "VLN", "pending");
      logTxn(db, { kitCode: kit.code, type: "unstart", grp: "VLN", user });
      return { ok: true, message: `${kit.code}: v\u1EC1 Ch\u01B0a l\xE0m` };
    }
    if (kit.vln_status !== "pending") throw fail(`${kit.code} \u0111\xE3 \u1EDF tr\u1EA1ng th\xE1i ${kit.vln_status === "progress" ? "\u0110ang l\xE0m" : "kh\xE1c Ch\u01B0a l\xE0m"}.`);
    setStatus(db, kit.id, "VLN", "progress");
    logTxn(db, { kitCode: kit.code, type: "start", grp: "VLN", user });
    return { ok: true, message: `${kit.code}: \u0110ang l\xE0m \xB7 Rear + VL\u0110T kitting \u0111\u01B0\u1EE3c` };
  });
}
function saveKitting(db, { kitId, grp, items: input, confirm, shortReason, shortNote }, user) {
  if (!GROUPS[grp]) throw fail("Nh\xF3m kh\xF4ng h\u1EE3p l\u1EC7.");
  return tx(db, () => {
    const kit = loadKit2(db, kitId);
    if (kit[statusCol(grp)] === "delivered") throw fail("PO \u0111\xE3 giao line, kh\xF4ng s\u1EEDa kitting \u0111\u01B0\u1EE3c. D\xF9ng \u0110i\u1EC1u ch\u1EC9nh kit.");
    if (grp === "HV" && kit.vln_status === "pending") throw fail("PO ch\u01B0a b\u1EAFt \u0111\u1EA7u kitting VLN.");
    ensureItems(db, kit, grp);
    const cur = new Map(items(db, kit.id, grp).map((i) => [ikey2(i.model_code, i.material), i]));
    const upd = db.prepare("UPDATE kit_item SET kitted = ? WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?");
    for (const it of Array.isArray(input) ? input : []) {
      const row = cur.get(ikey2(it.code, it.material));
      if (!row) throw fail(`M\xE3 ${it.material} kh\xF4ng thu\u1ED9c kit n\xE0y.`);
      const v = Number(it.kitted);
      if (!Number.isFinite(v) || v < 0) throw fail(`S\u1ED1 kitting c\u1EE7a ${row.material} kh\xF4ng h\u1EE3p l\u1EC7.`);
      if (!isWhole2(row.required) && !Number.isInteger(v)) throw fail(`${row.material}: \u0111\u1ECBnh m\u1EE9c l\u1EBB ${r34(row.required)}, nh\u1EADp s\u1ED1 nguy\xEAn (t\u1ED1i \u0111a ${kitCap(row.required)}).`);
      if (v > kitCap(row.required)) throw fail(`${row.material}: kh\xF4ng kitting qu\xE1 s\u1ED1 c\u1EA7n (${kitCap(row.required)}).`);
      if (r34(v) !== r34(row.kitted)) {
        upd.run(r34(v), kit.id, grp, row.model_code, row.material);
        logTxn(db, { kitCode: kit.code, type: "kit", grp, kitGroup: row.kit_group, material: row.material, qty: r34(v - row.kitted), user });
      }
    }
    const list = items(db, kit.id, grp), any = list.some((i) => i.kitted > 0);
    const was = kit[statusCol(grp)];
    if (confirm) {
      if (!any && list.length) throw fail("Ch\u01B0a kitting m\xE3 n\xE0o.");
      roundItems(db, kit, grp, user);
      const sh = items(db, kit.id, grp).filter((i) => !enough(i));
      if (sh.length) {
        const rc = String(shortReason || ""), nt = String(shortNote || "").trim().slice(0, 200);
        if (!SHORT_REASONS[rc]) throw fail(`C\xF2n thi\u1EBFu ${sh.length} m\xE3: ch\u1ECDn l\xFD do x\xE1c nh\u1EADn xong khi c\xF2n thi\u1EBFu.`);
        if (rc === "OTHER" && !nt) throw fail('L\xFD do "Kh\xE1c" c\u1EA7n ghi ch\xFA.');
        logTxn(db, { kitCode: kit.code, type: "short_confirm", grp, qty: sh.length, reason: rc, note: `${SHORT_REASONS[rc]}${nt ? `: ${nt}` : ""} \xB7 thi\u1EBFu ${sh.length} m\xE3`, user });
      }
      setStatus(db, kit.id, grp, "done");
    } else setStatus(db, kit.id, grp, any || was === "progress" ? "progress" : "pending");
    const p = progress(items(db, kit.id, grp));
    return { ok: true, status: confirm ? "done" : any || was === "progress" ? "progress" : "pending", message: confirm ? `${kit.code}: xong ${grp === "VLN" ? "VLN" : "Rear + VL\u0110T"}${p.short ? ` \xB7 thi\u1EBFu ${p.short} m\xE3` : ""}` : `${kit.code}: \u0111\xE3 l\u01B0u ${p.full}/${p.total} m\xE3 \u0111\u1EE7` };
  });
}
function assignMap(db, day, shift) {
  return new Map(db.prepare("SELECT line, model FROM line_assign WHERE work_date = ? AND shift = ?").all(day, shift).map((r) => [r.line, r.model]));
}
function lineSupply(db, line, model) {
  const s = getSettings(db), threshold = Number(s.supply_threshold);
  const kits = db.prepare("SELECT * FROM kit_order WHERE line = ? AND vln_status = 'delivered'").all(line);
  const remainSum = kits.reduce((sum, k) => {
    const ps = kitPos(db, k.id).filter((p) => p.in_source && !isCancelled(p));
    const real = ps.filter((p) => p.po_type !== "LOAD").reduce((a, p) => a + Math.max(p.remain_qty, 0), 0);
    const tp = real > 0 ? ps.filter((p) => p.po_type === "LOAD" && p.int_status !== "done").reduce((a, p) => a + Math.min(p.remain_qty, 0), 0) : 0;
    return sum + Math.max(real + tp, 0);
  }, 0);
  const prm = model ? db.prepare("SELECT spread_qty, pending_qty, pending_day FROM line_params WHERE line = ? AND model = ?").get(line, model) : null;
  const spread = (prm == null ? void 0 : prm.spread_qty) || 0, pending3 = pendingOf(db, prm), available = remainSum - spread - pending3;
  return { line, model: model || "", remainSum, spread, pending: pending3, available, threshold, pass: available < threshold, hasParams: !!prm };
}
var ruleText = (s) => s.pass ? `c\xF2n ${Math.round(s.available)} < ${s.threshold}` : `c\xF2n ${Math.round(s.available)} \u2265 ${s.threshold}`;
var lineModel = (db, line) => {
  const c = currentShift(db);
  return assignMap(db, c.day, c.shift).get(line) || "";
};
function poApproval(db, line) {
  return db.prepare("SELECT * FROM material_request WHERE kind = 'po' AND line = ? AND status IN ('approved','pending_approval') ORDER BY CASE status WHEN 'approved' THEN 0 ELSE 1 END, id LIMIT 1").get(line) || null;
}
function deliverable(db, kit) {
  const cancelled = kitPos(db, kit.id).filter(isCancelled).map((p) => p.po_no);
  if (cancelled.length) return { ok: false, why: `PO h\u1EE7y ${cancelled.join(", ")}` };
  if (kit.vln_status !== "done" || kit.hv_status !== "done") return { ok: false, why: "Ch\u01B0a xong c\u1EA3 2 nh\xF3m" };
  const rear = db.prepare("SELECT model_code, SUM(kitted) s FROM kit_item WHERE kit_id = ? AND kit_group = 'REAR' GROUP BY model_code").all(kit.id);
  if (rear.length && rear.every((r) => r.s <= 0)) return { ok: false, why: "Kh\xF4ng c\xF3 Rear" };
  const zero = rear.filter((r) => r.s <= 0).map((r) => r.model_code);
  return { ok: true, rearZero: zero };
}
function lineBoard(db, day, shift) {
  (() => {
    const c = currentShift(db);
    day = day || c.day;
    shift = shift || (day === c.day ? c.shift : shifts(db)[0]);
  })();
  const rk = ranks(db), assign = assignMap(db, day, shift);
  const lines = db.prepare("SELECT name FROM lines WHERE active = 1 ORDER BY sort_order, name").all().map((r) => r.name);
  const ready2 = db.prepare("SELECT * FROM kit_order WHERE vln_status = 'done' AND hv_status = 'done' ORDER BY plan_day, seq, id").all().map((k) => __spreadProps(__spreadValues({}, kitHeader(db, k, rk.get(k.id))), { check: deliverable(db, k) })).sort((a, b) => {
    var _a, _b;
    return ((_a = a.rank) != null ? _a : 1e9) - ((_b = b.rank) != null ? _b : 1e9);
  });
  const out = lines.map((line) => {
    const model = assign.get(line) || "";
    const delivered = db.prepare("SELECT * FROM kit_order WHERE line = ? AND vln_status = 'delivered' ORDER BY delivered_at DESC").all(line).map((k) => kitHeader(db, k, rk.get(k.id)));
    const req = poApproval(db, line);
    return {
      line,
      model,
      supply: lineSupply(db, line, model),
      running: delivered.filter((k) => k.remain > 0),
      finished: delivered.filter((k) => k.remain <= 0).length,
      readyCount: ready2.filter((k) => k.model === model && k.check.ok && (!k.fixedLine || k.fixedLine === line)).length,
      poReq: req ? { id: req.id, status: req.status } : null
    };
  });
  const debtCount = db.prepare("SELECT COUNT(DISTINCT kit_id) n FROM kit_item i JOIN kit_order k ON k.id = i.kit_id WHERE k.vln_status = 'delivered' AND i.delivered < i.required").get().n;
  return { day, shift, shifts: shifts(db), lines: out, ready: ready2, kpi: { running: out.filter((l) => l.model).length, ready: ready2.filter((k) => k.check.ok).length, needSupply: out.filter((l) => {
    var _a;
    return l.model && (l.supply.pass || ((_a = l.poReq) == null ? void 0 : _a.status) === "approved");
  }).length, waitApprove: out.filter((l) => {
    var _a;
    return ((_a = l.poReq) == null ? void 0 : _a.status) === "pending_approval";
  }).length, debt: debtCount } };
}
function deliveryPreview(db, kitId, line) {
  var _a;
  const kit = loadKit2(db, kitId), list = items(db, kit.id);
  const model = modelOf(db, kit.model_code, (_a = kitPos(db, kit.id)[0]) == null ? void 0 : _a.basic_model);
  const lm = lineModel(db, line), sup = lineSupply(db, line, lm), req = poApproval(db, line);
  const head = kitHeader(db, kit, ranks(db).get(kit.id));
  return {
    kit: head,
    check: deliverable(db, kit),
    warnModel: lm && lm !== model ? `${line} \u0111ang ch\u1EA1y ${lm}, PO l\xE0 ${model}` : "",
    fixedBlock: head.fixedLine && head.fixedLine !== line ? `${kit.code} c\xF3 PO n\u1ED9i b\u1ED9 \u1EA5n \u0111\u1ECBnh ${head.fixedLine}` : "",
    warnPlanLine: head.planLine && head.planLine !== line && !head.fixedLine ? `Planner d\u1EF1 ki\u1EBFn ${kit.code} cho ${head.planLine}` : "",
    rule: __spreadProps(__spreadValues({}, sup), { approved: (req == null ? void 0 : req.status) === "approved" ? req.id : null, waiting: (req == null ? void 0 : req.status) === "pending_approval" ? req.id : null, canDeliver: sup.pass || (req == null ? void 0 : req.status) === "approved" }),
    rear: list.filter((i) => i.kit_group === "REAR").map((i) => ({ code: i.model_code, material: i.material, required: i.required, kitted: i.kitted })),
    material: list.filter((i) => i.kit_group !== "REAR").map((i) => ({ code: i.model_code, material: i.material, group: i.kit_group, required: i.required, kitted: i.kitted }))
  };
}
function deliver(db, { kitId, line }, user) {
  return tx(db, () => {
    const kit = loadKit2(db, kitId);
    if (!db.prepare("SELECT 1 FROM lines WHERE name = ? AND active = 1").get(line)) throw fail("Line kh\xF4ng h\u1EE3p l\u1EC7.");
    if (kit.vln_status === "delivered") throw fail(`${kit.code} \u0111\xE3 giao cho ${kit.line}.`);
    const fixed = fixedLineOf(kitPos(db, kit.id));
    if (fixed && fixed !== line) throw fail(`${kit.code} c\xF3 PO n\u1ED9i b\u1ED9 \u1EA5n \u0111\u1ECBnh ${fixed}, kh\xF4ng giao cho ${line} \u0111\u01B0\u1EE3c.`);
    const chk = deliverable(db, kit);
    if (!chk.ok) throw fail(`${kit.code}: ${chk.why}.`);
    const sup = lineSupply(db, line, lineModel(db, line)), req = poApproval(db, line);
    if (!sup.pass && (req == null ? void 0 : req.status) !== "approved") throw fail(`${line} ${ruleText(sup)}: ch\u01B0a \u0111\u1EBFn l\xFAc c\u1EA5p PO, c\u1EA7n duy\u1EC7t ngo\u1EA1i l\u1EC7.`);
    roundItems(db, kit, "VLN", user);
    roundItems(db, kit, "HV", user);
    const list = items(db, kit.id);
    const upd = db.prepare("UPDATE kit_item SET delivered = kitted WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?");
    for (const i of list) {
      upd.run(kit.id, i.grp, i.model_code, i.material);
      if (i.kitted > 0) logTxn(db, { kitCode: kit.code, type: "deliver", grp: i.grp, kitGroup: i.kit_group, material: i.material, qty: i.kitted, line, user });
      if (i.kitted < i.required) logTxn(db, { kitCode: kit.code, type: "debt_open", grp: i.grp, kitGroup: i.kit_group, material: i.material, qty: i.required - i.kitted, ref: i.model_code, line, user });
    }
    db.prepare("UPDATE kit_order SET line = ?, delivered_at = datetime('now'), delivered_by = ?, vln_status = 'delivered', hv_status = 'delivered', updated_at = datetime('now') WHERE id = ?").run(line, user, kit.id);
    if ((req == null ? void 0 : req.status) === "approved") db.prepare("UPDATE material_request SET status = 'issued', kit_id = ?, kit_code = ?, issued_qty = ?, issued_by = ?, issued_at = datetime('now') WHERE id = ?").run(kit.id, kit.code, kitPos(db, kit.id).reduce((s, p) => s + p.plan_qty, 0), user, req.id);
    const debt = list.filter((i) => i.kitted < i.required).length;
    return { ok: true, message: `\u0110\xE3 giao ${kit.code} \u2192 ${line}${debt ? ` \xB7 ghi n\u1EE3 ${debt} m\xE3` : ""}${chk.rearZero.length ? ` \xB7 n\u1EE3 Rear ${chk.rearZero.join(", ")}` : ""}${(req == null ? void 0 : req.status) === "approved" ? ` \xB7 \u0111\xF3ng YC#${req.id}` : ""}` };
  });
}
function debts(db) {
  const rows = db.prepare(`SELECT k.id, k.code, k.line, k.delivered_at, k.model_code, i.grp, i.kit_group, i.model_code AS item_code, i.material, i.description, i.required, i.delivered
    FROM kit_item i JOIN kit_order k ON k.id = i.kit_id WHERE k.vln_status = 'delivered' AND i.delivered < i.required ORDER BY k.delivered_at, k.code, i.material`).all();
  const byKit = /* @__PURE__ */ new Map();
  for (const r of rows) {
    if (!byKit.has(r.id)) byKit.set(r.id, { kitId: r.id, code: r.code, line: r.line, deliveredAt: r.delivered_at, modelCode: r.model_code, items: [] });
    byKit.get(r.id).items.push({ grp: r.grp, kitGroup: r.kit_group, code: r.item_code, material: r.material, description: r.description, debt: r34(r.required - r.delivered), required: r.required, delivered: r34(r.delivered) });
  }
  const list = [...byKit.values()];
  ensureLotSchema(db);
  for (const k of list) {
    const st = lotStats(db, k.kitId), prep = new Map(db.prepare("SELECT * FROM kit_bu WHERE kit_id = ?").all(k.kitId).map((b) => [lotKey(b.grp, b.model_code, b.material), b]));
    for (const i of k.items) {
      const key2 = lotKey(i.grp, i.code, i.material), s = st.get(key2), b = prep.get(key2);
      Object.assign(i, { cap: isWhole2(i.debt) ? i.debt : Math.ceil(i.debt), bu: (s == null ? void 0 : s.bu) || 0, buN: (s == null ? void 0 : s.n) || 0, prepared: b ? r34(b.qty) : 0, preparedBy: (b == null ? void 0 : b.username) || "" });
    }
    k.lots = lotCount(db, k.kitId);
  }
  return { rows: list, kpi: { kits: list.length, items: rows.length, ea: r34(rows.reduce((s, r) => s + r.required - r.delivered, 0)), rear: rows.filter((r) => r.kit_group === "REAR").length } };
}
function settleDebt(db, { kitId, material, grp, code = "", qty, items: list }, user) {
  ensureLotSchema(db);
  return tx(db, () => {
    const kit = loadKit2(db, kitId);
    if (kit.vln_status !== "delivered") throw fail(`${kit.code} ch\u01B0a giao Line.`);
    const input = Array.isArray(list) ? list : [{ grp, code, material, qty }];
    const r = createLot(db, kit, input, user, logTxn);
    const left = items(db, kit.id).filter((i) => i.delivered < i.required - 1e-9).length;
    const one = r.items.length === 1 ? r.items[0] : null;
    return {
      ok: true,
      lotNo: r.lotNo,
      lotId: r.lotId,
      left,
      message: `${r.lotNo}: giao b\xF9 ${one ? `${one.material} ${one.q}` : `${r.items.length} m\xE3`}${left ? ` \xB7 ${kit.code} c\xF2n n\u1EE3 ${left} m\xE3` : " \xB7 h\u1EBFt n\u1EE3"} \xB7 ch\u1EDD ${kit.line} k\xFD nh\u1EADn`
    };
  });
}
function adjustOptions(db, kitId) {
  var _a;
  const kit = loadKit2(db, kitId), model = modelOf(db, kit.model_code, (_a = kitPos(db, kit.id)[0]) == null ? void 0 : _a.basic_model);
  const rk = ranks(db), myCodes = [...new Set(kitPos(db, kit.id).map((p) => p.model_code))];
  const targets = db.prepare("SELECT * FROM kit_order WHERE id <> ? AND plan_day IS NOT NULL AND vln_status <> 'delivered' ORDER BY plan_day, seq, id").all(kit.id).map((k) => kitHeader(db, k, rk.get(k.id))).filter((k) => k.model === model).map((k) => ({ id: k.id, code: k.code, modelCode: k.modelCode, codes: k.codes, rank: k.rank, mrank: k.mrank, sameCode: k.codes.some((c) => myCodes.includes(c)) }));
  return {
    kit: kitHeader(db, kit, rk.get(kit.id)),
    delivered: kit.vln_status === "delivered",
    reasons: REASONS,
    targets,
    items: items(db, kit.id).map((i) => ({ grp: i.grp, kitGroup: i.kit_group, code: i.model_code, material: i.material, required: i.required, kitted: i.kitted, delivered: i.delivered, free: r34(i.kitted - i.delivered) }))
  };
}
function adjust(db, { kitId, type, targetId, reasonCode, note, items: input }, user) {
  if (!["transfer", "return", "recall"].includes(type)) throw fail("Ch\u1ECDn ki\u1EC3u \u0111i\u1EC1u ch\u1EC9nh.");
  if (!REASONS[reasonCode]) throw fail("Ch\u1ECDn l\xFD do.");
  if (reasonCode === "OTHER" && !String(note || "").trim()) throw fail('L\xFD do "Kh\xE1c" c\u1EA7n ghi ch\xFA.');
  const lines = (Array.isArray(input) ? input : []).filter((i) => Number(i.qty) > 0);
  if (!lines.length) throw fail("Nh\u1EADp s\u1ED1 l\u01B0\u1EE3ng cho \xEDt nh\u1EA5t 1 m\xE3.");
  return tx(db, () => {
    var _a, _b;
    const kit = loadKit2(db, kitId), isDelivered = kit.vln_status === "delivered";
    if (type === "recall" && !isDelivered) throw fail("Ch\u1EC9 thu h\u1ED3i \u0111\u01B0\u1EE3c PO \u0111\xE3 giao line.");
    if (type !== "recall" && isDelivered) throw fail("PO \u0111\xE3 giao line: thu h\u1ED3i t\u1EEB line tr\u01B0\u1EDBc r\u1ED3i m\u1EDBi chuy\u1EC3n / tr\u1EA3 kho.");
    let target = null;
    if (type === "transfer") {
      target = loadKit2(db, targetId);
      if (target.vln_status === "delivered") throw fail("PO nh\u1EADn \u0111\xE3 giao line.");
      const m1 = modelOf(db, kit.model_code, (_a = kitPos(db, kit.id)[0]) == null ? void 0 : _a.basic_model), m2 = modelOf(db, target.model_code, (_b = kitPos(db, target.id)[0]) == null ? void 0 : _b.basic_model);
      if (m1 !== m2) throw fail("Ch\u1EC9 chuy\u1EC3n gi\u1EEFa c\xE1c PO c\xF9ng Model.");
    }
    const touched = /* @__PURE__ */ new Set(), tTouched = /* @__PURE__ */ new Set();
    for (const it of lines) {
      const row = db.prepare("SELECT * FROM kit_item WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?").get(kit.id, it.grp, String(it.code || ""), it.material);
      if (!row) throw fail(`M\xE3 ${it.material} kh\xF4ng thu\u1ED9c kit.`);
      const q = r34(Number(it.qty));
      if (type === "recall") {
        if (q > row.delivered) throw fail(`${row.material}: ch\u1EC9 thu h\u1ED3i t\u1ED1i \u0111a ${row.delivered}.`);
        db.prepare("UPDATE kit_item SET delivered = delivered - ? WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?").run(q, kit.id, row.grp, row.model_code, row.material);
        logTxn(db, { kitCode: kit.code, type: "recall", grp: row.grp, kitGroup: row.kit_group, material: row.material, qty: q, line: kit.line, reason: reasonCode, note, user });
        continue;
      }
      const free = r34(row.kitted - row.delivered);
      if (q > free) throw fail(`${row.material}: ch\u1EC9 c\xF2n ${free} c\xF3 th\u1EC3 l\u1EA5y.`);
      if (type === "transfer") {
        if (row.grp === "HV" && !kitPos(db, target.id).some((p) => p.model_code === row.model_code)) throw fail(`${row.material} (Rear/VL\u0110T) ch\u1EC9 chuy\u1EC3n cho PO c\xF3 Model Code ${row.model_code}.`);
        ensureItems(db, target, row.grp);
        const trow = db.prepare("SELECT * FROM kit_item WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?").get(target.id, row.grp, row.model_code, row.material);
        if (!trow) throw fail(`${target.code} kh\xF4ng d\xF9ng m\xE3 ${row.material}.`);
        if (trow.kitted + q > trow.required) throw fail(`${target.code} ch\u1EC9 c\u1EA7n th\xEAm ${r34(trow.required - trow.kitted)} ${row.material}.`);
        db.prepare("UPDATE kit_item SET kitted = kitted + ? WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?").run(q, target.id, row.grp, row.model_code, row.material);
        logTxn(db, { kitCode: target.code, type: "transfer_in", grp: row.grp, kitGroup: row.kit_group, material: row.material, qty: q, ref: kit.code, reason: reasonCode, note, user });
        tTouched.add(row.grp);
      }
      db.prepare("UPDATE kit_item SET kitted = kitted - ? WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?").run(q, kit.id, row.grp, row.model_code, row.material);
      logTxn(db, { kitCode: kit.code, type: type === "transfer" ? "transfer_out" : "return", grp: row.grp, kitGroup: row.kit_group, material: row.material, qty: q, ref: target == null ? void 0 : target.code, reason: reasonCode, note, user });
      touched.add(row.grp);
    }
    let extra = "";
    if (type === "recall" && items(db, kit.id).every((i) => i.delivered <= 0)) {
      db.prepare("UPDATE kit_order SET line = NULL, delivered_at = NULL, delivered_by = NULL, vln_status = 'done', hv_status = 'done', updated_at = datetime('now') WHERE id = ?").run(kit.id);
      for (const g of ["VLN", "HV"]) if (items(db, kit.id, g).every((i) => i.kitted <= 0)) setStatus(db, kit.id, g, "pending");
      extra = ` \xB7 g\u1EE1 kh\u1ECFi ${kit.line}`;
    }
    for (const g of touched) recompute(db, kit, g);
    if (target) for (const g of tTouched) {
      const t4 = loadKit2(db, target.id);
      if (t4[statusCol(g)] === "pending") setStatus(db, t4.id, g, "progress");
      if (g === "HV" && t4.vln_status === "pending") setStatus(db, t4.id, "VLN", "progress");
    }
    const label = { transfer: `chuy\u1EC3n sang ${target == null ? void 0 : target.code}`, return: "tr\u1EA3 kho", recall: "thu h\u1ED3i t\u1EEB line" }[type];
    return { ok: true, message: `${kit.code}: ${label} ${lines.length} m\xE3${extra}` };
  });
}
function history(db, { days = 7, type = "" } = {}) {
  const since = new Date(Date.now() - Number(days) * 864e5).toISOString().replace("T", " ").slice(0, 19);
  const rows = db.prepare(`SELECT * FROM kit_txn WHERE created_at >= ? ${type ? "AND type = ?" : ""} ORDER BY id DESC LIMIT 400`).all(...type ? [since, type] : [since]);
  const all = db.prepare("SELECT type, reason_code, qty, kit_code FROM kit_txn WHERE created_at >= ?").all(since);
  const adj = all.filter((r) => ["transfer_out", "return", "recall"].includes(r.type));
  const byReason = Object.entries(REASONS).map(([code, label]) => {
    const list = adj.filter((r) => r.reason_code === code);
    return { code, label, times: new Set(list.map((r) => r.kit_code + r.type)).size, lines: list.length, ea: r34(list.reduce((s, r) => s + r.qty, 0)) };
  }).filter((r) => r.lines);
  const byType = ["transfer_out", "return", "recall"].map((t4) => ({ type: t4, label: TXN_LABEL[t4], lines: adj.filter((r) => r.type === t4).length, ea: r34(adj.filter((r) => r.type === t4).reduce((s, r) => s + r.qty, 0)) }));
  return {
    rows: rows.map((r) => __spreadProps(__spreadValues({}, r), { typeLabel: TXN_LABEL[r.type] || r.type, reason: REASONS[r.reason_code] || "" })),
    byReason,
    byType,
    kpi: {
      kitted: new Set(all.filter((r) => r.type === "kit").map((r) => r.kit_code)).size,
      delivered: new Set(all.filter((r) => r.type === "deliver").map((r) => r.kit_code)).size,
      adjust: new Set(adj.map((r) => r.kit_code + r.type + r.reason_code)).size,
      adjustEa: r34(adj.reduce((s, r) => s + r.qty, 0))
    }
  };
}
function requestForm(db, line) {
  const model = lineModel(db, line);
  const materials = model ? db.prepare(`SELECT DISTINCT b.material, b.description, b.kit_group FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code
    WHERE COALESCE(m.model, b.model_code) = ? ORDER BY CASE b.kit_group WHEN 'REAR' THEN 0 WHEN 'VLDT' THEN 1 ELSE 2 END, b.material`).all(model) : [];
  return { supply: lineSupply(db, line, model), materials };
}
function createRequest(db, { line, material, qty, note, kind = "material", kitId }, user) {
  var _a, _b;
  if (!db.prepare("SELECT 1 FROM lines WHERE name = ? AND active = 1").get(line)) throw fail("Ch\u1ECDn Line.");
  const isPo = kind === "po";
  const f = requestForm(db, line), s = f.supply;
  if (!s.model) throw fail(`${line} ch\u01B0a khai b\xE1o Model \u0111ang ch\u1EA1y h\xF4m nay.`);
  let mat = null, q = Number(qty), kit = null;
  if (isPo) {
    const open = poApproval(db, line);
    if (open) throw fail(`${line} \u0111\xE3 c\xF3 YC#${open.id} xin PO \u0111ang ${open.status === "approved" ? "ch\u1EDD Kho giao" : "ch\u1EDD duy\u1EC7t"}.`);
    if (kitId) kit = loadKit2(db, kitId);
    q = kit ? kitPos(db, kit.id).reduce((a, p) => a + p.plan_qty, 0) : 1;
  } else {
    if (!Number.isFinite(q) || q <= 0) throw fail("Nh\u1EADp s\u1ED1 l\u01B0\u1EE3ng y\xEAu c\u1EA7u.");
    mat = f.materials.find((m) => m.material === material);
    if (!mat) throw fail("Ch\u1ECDn m\xE3 v\u1EADt li\u1EC7u thu\u1ED9c Model \u0111ang ch\u1EA1y.");
  }
  const status = s.pass ? "approved" : "pending_approval";
  const ins = db.prepare(`INSERT INTO material_request(kind, kit_id, kit_code, line, model, material, description, qty, note, status, remain_sum, spread, pending, available, threshold, pass, requested_by, approved_by, approved_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,${s.pass ? "datetime('now')" : "NULL"})`).run(
    isPo ? "po" : "material",
    (_a = kit == null ? void 0 : kit.id) != null ? _a : null,
    (_b = kit == null ? void 0 : kit.code) != null ? _b : null,
    line,
    s.model,
    isPo ? kit ? kit.code : "PO ti\u1EBFp theo" : mat.material,
    isPo ? kit ? `${kit.model_code}` : s.model : mat.description,
    q,
    String(note || "").slice(0, 200),
    status,
    s.remainSum,
    s.spread,
    s.pending,
    s.available,
    s.threshold,
    s.pass ? 1 : 0,
    user,
    s.pass ? "T\u1EF1 \u0111\u1ED9ng" : null
  );
  const what = isPo ? "xin PO" : "y\xEAu c\u1EA7u";
  return { ok: true, id: Number(ins.lastInsertRowid), pass: s.pass, message: s.pass ? `\u0110\u1EA1t (${ruleText(s)}) \xB7 ${what} ch\u1EDD Kho ${isPo ? "giao" : "c\u1EA5p"}` : `Ch\u01B0a \u0111\u1EBFn l\xFAc c\u1EA5p (${ruleText(s)}) \xB7 ${what} ch\u1EDD duy\u1EC7t` };
}
function requests(db) {
  const rows = db.prepare("SELECT * FROM material_request ORDER BY CASE status WHEN 'pending_approval' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, id DESC LIMIT 300").all();
  const today = todayKey();
  const isToday = (r) => r.issued_at && vnDay(Date.parse(r.issued_at.replace(" ", "T") + "Z")) === today;
  return { rows, kpi: {
    approved: rows.filter((r) => r.status === "approved").length,
    pending: rows.filter((r) => r.status === "pending_approval").length,
    issuedToday: rows.filter(isToday).length,
    exceptions: rows.filter((r) => !r.pass && ["approved", "issued"].includes(r.status)).length
  } };
}
function decideRequest(db, { id, approve, note }, user) {
  const r = db.prepare("SELECT * FROM material_request WHERE id = ?").get(Number(id));
  if (!r) throw fail("Kh\xF4ng t\xECm th\u1EA5y y\xEAu c\u1EA7u.", 404);
  if (r.status !== "pending_approval") throw fail("Y\xEAu c\u1EA7u kh\xF4ng \u1EDF tr\u1EA1ng th\xE1i ch\u1EDD duy\u1EC7t.");
  if (!approve && !String(note || "").trim()) throw fail("T\u1EEB ch\u1ED1i c\u1EA7n ghi l\xFD do.");
  db.prepare("UPDATE material_request SET status = ?, approved_by = ?, approve_note = ?, approved_at = datetime('now') WHERE id = ?").run(approve ? "approved" : "rejected", user, String(note || "").slice(0, 200), r.id);
  return { ok: true, message: approve ? `\u0110\xE3 duy\u1EC7t y\xEAu c\u1EA7u #${r.id}` : `\u0110\xE3 t\u1EEB ch\u1ED1i y\xEAu c\u1EA7u #${r.id}` };
}
function issueRequest(db, { id, qty }, user) {
  const r = db.prepare("SELECT * FROM material_request WHERE id = ?").get(Number(id));
  if (!r) throw fail("Kh\xF4ng t\xECm th\u1EA5y y\xEAu c\u1EA7u.", 404);
  if (r.status !== "approved") throw fail("Y\xEAu c\u1EA7u ch\u01B0a \u0111\u01B0\u1EE3c duy\u1EC7t.");
  if (r.kind === "po") throw fail("Y\xEAu c\u1EA7u PO: giao \u1EDF tab Kho \u2192 Giao line.");
  const q = Number(qty != null ? qty : r.qty);
  if (!Number.isFinite(q) || q <= 0) throw fail("S\u1ED1 c\u1EA5p ph\u1EA3i > 0.");
  db.prepare("UPDATE material_request SET status = 'issued', issued_qty = ?, issued_by = ?, issued_at = datetime('now') WHERE id = ?").run(q, user, r.id);
  logTxn(db, { kitCode: `YC#${r.id}`, type: "issue", material: r.material, qty: q, line: r.line, note: r.pass ? "" : "Ngo\u1EA1i l\u1EC7 \u0111\xE3 duy\u1EC7t", user });
  return { ok: true, message: `\u0110\xE3 c\u1EA5p ${q} ${r.material} cho ${r.line}` };
}
function cancelAlerts(db) {
  const kits = db.prepare(`SELECT DISTINCT k.* FROM kit_order k JOIN kit_order_po x ON x.kit_id = k.id JOIN po p ON p.po_key = x.po_key
    WHERE lower(trim(coalesce(p.plan_status, ''))) LIKE 'cancel%' OR (p.in_source = 0 AND p.remain_qty > 0) ORDER BY k.plan_day, k.seq, k.id`).all();
  return kits.map((k) => {
    const pos = kitPos(db, k.id), list = items(db, k.id);
    const bad = pos.filter((p) => isCancelled(p) || !p.in_source && p.remain_qty > 0).map((p) => ({ po: p.po_no, why: isCancelled(p) ? "cancel" : "gone" }));
    const kitted = list.reduce((s, i) => s + i.kitted, 0), delivered = list.reduce((s, i) => s + i.delivered, 0);
    const step = k.vln_status === "delivered" ? delivered > 0 ? "recall" : "return" : kitted > 0 ? "return" : bad.some((b) => b.why === "cancel") ? "drop" : "check";
    return { kitId: k.id, code: k.code, kind: k.kind, line: k.line || "", planDay: k.plan_day || "", vln: k.vln_status, hv: k.hv_status, total: pos.length, pos: bad, step };
  }).sort((a, b) => ({ recall: 0, return: 1, drop: 2, check: 3 })[a.step] - { recall: 0, return: 1, drop: 2, check: 3 }[b.step]);
}
function dropCancelled(db, { kitId }, user) {
  return tx(db, () => {
    const kit = loadKit2(db, kitId), pos = kitPos(db, kit.id), gone = pos.filter(isCancelled);
    if (!gone.length) throw fail(`${kit.code} kh\xF4ng c\xF3 PO h\u1EE7y.`);
    if (kit.vln_status === "delivered") throw fail(`${kit.code} \u0111\xE3 giao ${kit.line}: thu h\u1ED3i t\u1EEB line tr\u01B0\u1EDBc (\u0110i\u1EC1u ch\u1EC9nh kit \u2192 Thu h\u1ED3i).`);
    const left = items(db, kit.id).filter((i) => i.kitted > 0);
    if (left.length) throw fail(`${kit.code} c\xF2n ${left.length} m\xE3 \u0111\xE3 kitting: tr\u1EA3 kho ho\u1EB7c chuy\u1EC3n PO kh\xE1c tr\u01B0\u1EDBc (\u0110i\u1EC1u ch\u1EC9nh kit, l\xFD do PO h\u1EE7y / ho\xE3n).`);
    for (const p of gone) db.prepare("DELETE FROM kit_order_po WHERE kit_id = ? AND po_key = ?").run(kit.id, p.po_key);
    const freed = dropOrphanLoads(db, kit.id);
    const rest = pos.length - gone.length - freed.length;
    db.prepare("DELETE FROM kit_item WHERE kit_id = ?").run(kit.id);
    if (!rest) db.prepare("DELETE FROM kit_order WHERE id = ?").run(kit.id);
    else {
      const first = kitPos(db, kit.id)[0];
      db.prepare("UPDATE kit_order SET model_code = ?, kind = CASE WHEN ? > 1 THEN kind ELSE 'single' END, vln_status = 'pending', hv_status = 'pending', updated_at = datetime('now') WHERE id = ?").run(first.model_code, rest, kit.id);
    }
    logTxn(db, { kitCode: kit.code, type: "po_cancel", note: gone.map((p) => p.po_no).join(", "), user });
    return { ok: true, message: rest ? `${kit.code}: \u0111\xE3 g\u1EE1 ${gone.length} PO h\u1EE7y, c\xF2n ${rest} PO` : `\u0110\xE3 g\u1EE1 ${kit.code} kh\u1ECFi k\u1EBF ho\u1EA1ch` };
  });
}
function internalPo(db, po) {
  const p = db.prepare("SELECT * FROM po WHERE po_key = ?").get(normalizePo(po));
  if (!p) throw fail("Kh\xF4ng t\xECm th\u1EA5y PO.", 404);
  if (!PO_TYPES[p.po_type]) throw fail(`${p.po_no} kh\xF4ng ph\u1EA3i PO n\u1ED9i b\u1ED9 (Unplan / RMA).`);
  if (isCancelled(p)) throw fail(`${p.po_no} \u0111\xE3 h\u1EE7y.`);
  const kit = db.prepare("SELECT k.* FROM kit_order_po x JOIN kit_order k ON k.id = x.kit_id WHERE x.po_key = ?").get(p.po_key) || null;
  const locked = !!kit && (kit.vln_status !== "pending" || kit.hv_status !== "pending" || !!db.prepare("SELECT 1 FROM kit_item WHERE kit_id = ? AND kitted > 0 LIMIT 1").get(kit.id));
  return { p, kit, locked };
}
function poHist(db, key2, kind, changes, username, action, detail) {
  db.prepare("INSERT INTO po_history(po_key, import_id, kind, changes) VALUES (?,?,?,?)").run(key2, null, kind, JSON.stringify(__spreadProps(__spreadValues({}, changes), { _by: username || "" })));
  db.prepare("INSERT INTO audit_log(username, action, detail) VALUES (?, ?, ?)").run(username || "", action, JSON.stringify(detail));
}
function editInternalPo(db, body, username) {
  return tx(db, () => {
    var _a, _b, _c, _d, _e, _f, _g;
    const { p, kit, locked } = internalPo(db, body == null ? void 0 : body.po);
    if (p.po_type === "LOAD") return editLoadPo(db, p, kit, locked, body, username);
    const modelCode = String((_a = body == null ? void 0 : body.modelCode) != null ? _a : p.model_code).trim(), line = String((_b = body == null ? void 0 : body.line) != null ? _b : p.fixed_line).trim(), qty = Number((_c = body == null ? void 0 : body.qty) != null ? _c : p.plan_qty);
    const planDate = /^\d{4}-\d{2}-\d{2}$/.test(String((body == null ? void 0 : body.planDate) || "")) ? body.planDate : p.plan_date;
    const time = (body == null ? void 0 : body.planTime) === void 0 ? String(p.plan_start || "").slice(11, 16) : /^\d{2}:\d{2}$/.test(String(body.planTime)) ? body.planTime : "";
    const planStart = time ? `${planDate}T${time}` : "";
    const refDoc = String((_e = (_d = body == null ? void 0 : body.refDoc) != null ? _d : p.ref_doc) != null ? _e : "").trim().slice(0, 60), note = String((_g = (_f = body == null ? void 0 : body.note) != null ? _f : p.note) != null ? _g : "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!refDoc) throw fail(p.po_type === "RMA" ? "Nh\u1EADp s\u1ED1 RMA / ch\u1EE9ng t\u1EEB tham chi\u1EBFu." : "Nh\u1EADp s\u1ED1 bi\xEAn b\u1EA3n x\xE1c nh\u1EADn l\u1ED7i.");
    const next = { model_code: modelCode, fixed_line: line, plan_qty: qty, plan_date: planDate, plan_start: planStart, ref_doc: refDoc, note: note || null };
    const changes = {};
    const nz = (v) => v === "" || v === void 0 ? null : v;
    for (const [f, v] of Object.entries(next)) if (nz(p[f]) !== nz(v)) changes[f] = [nz(p[f]), nz(v)];
    if (!Object.keys(changes).length) return { ok: true, po: p.po_no, message: "Kh\xF4ng c\xF3 g\xEC thay \u0111\u1ED5i." };
    const core = ["model_code", "fixed_line", "plan_qty", "plan_date", "plan_start"].filter((f) => changes[f]);
    if (core.length && locked) throw fail(`${kit.code} \u0111\xE3 b\u1EAFt \u0111\u1EA7u kitting: ch\u1EC9 s\u1EEDa \u0111\u01B0\u1EE3c S\u1ED1 bi\xEAn b\u1EA3n / Ghi ch\xFA. Mu\u1ED1n \u0111\u1ED5i SL, Line, Model Code, ng\xE0y th\xEC Kho thu h\u1ED3i / tr\u1EA3 kho tr\u01B0\u1EDBc.`);
    if (changes.model_code && !db.prepare("SELECT 1 FROM bom WHERE model_code = ? LIMIT 1").get(modelCode)) throw fail(`Model Code "${modelCode}" ch\u01B0a c\xF3 BOM.`);
    if (changes.fixed_line && !db.prepare("SELECT 1 FROM lines WHERE name = ? AND active = 1").get(line)) throw fail("Ch\u1ECDn Line s\u1EA3n xu\u1EA5t c\xF3 trong danh s\xE1ch.");
    if (!Number.isInteger(qty) || qty < 1 || qty > 1e5) throw fail("S\u1ED1 l\u01B0\u1EE3ng l\xE0 s\u1ED1 nguy\xEAn 1\u2013100.000.");
    if (qty < (p.production_qty || 0)) throw fail(`S\u1ED1 l\u01B0\u1EE3ng kh\xF4ng \u0111\u01B0\u1EE3c nh\u1ECF h\u01A1n s\u1ED1 \u0111\xE3 s\u1EA3n xu\u1EA5t (${p.production_qty}).`);
    if (kit) {
      const others = kitPos(db, kit.id).filter((o) => o.po_key !== p.po_key);
      if (others.length) {
        const model = modelOf(db, modelCode, ""), om = new Set(others.map((o) => modelOf(db, o.model_code, o.basic_model)));
        if (changes.model_code && (om.size > 1 || !om.has(model))) throw fail(`${kit.code} l\xE0 Kit g\u1ED9p Model ${[...om].join(", ")}: Model Code m\u1EDBi ph\u1EA3i c\xF9ng Model.`);
        const maxQty = Number(getSettings(db).merge_max_qty) || 2500, total = others.reduce((a, o) => a + o.plan_qty, 0) + qty;
        if (changes.plan_qty && total > maxQty) throw fail(`${kit.code}: t\u1ED5ng SL ${total} v\u01B0\u1EE3t gi\u1EDBi h\u1EA1n g\u1ED9p ${maxQty} ea.`);
        const fx = others.map((o) => o.fixed_line).filter(Boolean).find((l) => l !== line);
        if (changes.fixed_line && fx) throw fail(`${kit.code} c\xF3 PO n\u1ED9i b\u1ED9 kh\xE1c \u1EA5n \u0111\u1ECBnh ${fx}: kh\xF4ng \u0111\u1ED5i sang ${line} \u0111\u01B0\u1EE3c (t\xE1ch kit tr\u01B0\u1EDBc).`);
      }
    }
    if (changes.plan_qty) changes.remain_qty = [p.remain_qty, qty - (p.production_qty || 0)];
    db.prepare("UPDATE po SET model_code = ?, fixed_line = ?, plan_qty = ?, remain_qty = ?, plan_date = ?, plan_start = ?, ref_doc = ?, note = ? WHERE po_key = ?").run(modelCode, line, qty, qty - (p.production_qty || 0), planDate, planStart, refDoc, note || null, p.po_key);
    if (kit && core.length) {
      const first = kitPos(db, kit.id)[0];
      db.prepare("UPDATE kit_order SET model_code = ?, updated_at = datetime('now') WHERE id = ?").run(first.model_code, kit.id);
      db.prepare("DELETE FROM kit_item WHERE kit_id = ?").run(kit.id);
    }
    poHist(db, p.po_key, "edit", changes, username, "po.internal.edit", { po: p.po_no, changes });
    return { ok: true, po: p.po_no, message: `\u0110\xE3 s\u1EEDa ${p.po_no}${kit && core.length ? ` \xB7 ${kit.code} t\xEDnh l\u1EA1i \u0111\u1ECBnh m\u1EE9c` : ""}` };
  });
}
function editLoadPo(db, p, kit, locked, body, username) {
  var _a, _b, _c, _d, _e, _f;
  const qty = Number((_a = body == null ? void 0 : body.qty) != null ? _a : -p.plan_qty), modelCode = String((_b = body == null ? void 0 : body.modelCode) != null ? _b : p.model_code).trim();
  const refDoc = String((_d = (_c = body == null ? void 0 : body.refDoc) != null ? _c : p.ref_doc) != null ? _d : "").trim().slice(0, 60), note = String((_f = (_e = body == null ? void 0 : body.note) != null ? _e : p.note) != null ? _f : "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!refDoc) throw fail("Nh\u1EADp s\u1ED1 phi\u1EBFu xu\u1EA5t kho th\xE0nh ph\u1EA9m.");
  if (!Number.isInteger(qty) || qty < 1 || qty > 1e5) throw fail("S\u1ED1 l\u01B0\u1EE3ng l\xE0 s\u1ED1 nguy\xEAn 1\u2013100.000.");
  const nz = (v) => v === "" || v === void 0 ? null : v, next = { model_code: modelCode, plan_qty: -qty, ref_doc: refDoc, note: note || null }, changes = {};
  for (const [f, v] of Object.entries(next)) if (nz(p[f]) !== nz(v)) changes[f] = [nz(p[f]), nz(v)];
  if (!Object.keys(changes).length) return { ok: true, po: p.po_no, message: "Kh\xF4ng c\xF3 g\xEC thay \u0111\u1ED5i." };
  if ((changes.plan_qty || changes.model_code) && locked) throw fail(`${kit.code} \u0111\xE3 b\u1EAFt \u0111\u1EA7u kitting: ch\u1EC9 s\u1EEDa \u0111\u01B0\u1EE3c s\u1ED1 phi\u1EBFu / ghi ch\xFA.`);
  if (changes.model_code && kit) throw fail(`${p.po_no} \u0111ang \u1EDF ${kit.code}: mu\u1ED1n \u0111\u1ED5i Model Code th\xEC t\xE1ch Kit tr\u01B0\u1EDBc.`);
  if (changes.model_code && !db.prepare("SELECT 1 FROM bom WHERE model_code = ? LIMIT 1").get(modelCode)) throw fail(`Model Code "${modelCode}" ch\u01B0a c\xF3 BOM.`);
  if (kit && changes.plan_qty) assertLoads(kitPos(db, kit.id).map((o) => o.po_key === p.po_key ? __spreadProps(__spreadValues({}, o), { plan_qty: -qty }) : o));
  if (changes.plan_qty) changes.remain_qty = [p.remain_qty, -qty];
  db.prepare("UPDATE po SET model_code = ?, plan_qty = ?, remain_qty = ?, ref_doc = ?, note = ? WHERE po_key = ?").run(modelCode, -qty, -qty, refDoc, note || null, p.po_key);
  if (kit && changes.plan_qty) db.prepare("DELETE FROM kit_item WHERE kit_id = ?").run(kit.id);
  poHist(db, p.po_key, "edit", changes, username, "po.internal.edit", { po: p.po_no, changes });
  return { ok: true, po: p.po_no, message: `\u0110\xE3 s\u1EEDa ${p.po_no}${kit && changes.plan_qty ? ` \xB7 ${kit.code} t\xEDnh l\u1EA1i \u0111\u1ECBnh m\u1EE9c` : ""}` };
}
function cancelInternalPo(db, body, username) {
  return tx(db, () => {
    const { p, kit, locked } = internalPo(db, body == null ? void 0 : body.po), reason = String((body == null ? void 0 : body.reason) || "").trim().slice(0, 200);
    if (!reason) throw fail("Nh\u1EADp l\xFD do h\u1EE7y.");
    if (locked) throw fail(`${kit.code} \u0111\xE3 b\u1EAFt \u0111\u1EA7u kitting / giao Line: Kho thu h\u1ED3i / tr\u1EA3 kho tr\u01B0\u1EDBc r\u1ED3i m\u1EDBi h\u1EE7y \u0111\u01B0\u1EE3c.`);
    if (kit) {
      db.prepare("DELETE FROM kit_order_po WHERE kit_id = ? AND po_key = ?").run(kit.id, p.po_key);
      db.prepare("DELETE FROM kit_item WHERE kit_id = ?").run(kit.id);
      dropOrphanLoads(db, kit.id);
      const rest = kitPos(db, kit.id);
      if (!rest.length) db.prepare("DELETE FROM kit_order WHERE id = ?").run(kit.id);
      else db.prepare("UPDATE kit_order SET model_code = ?, kind = CASE WHEN ? > 1 THEN kind ELSE 'single' END, updated_at = datetime('now') WHERE id = ?").run(rest[0].model_code, rest.length, kit.id);
    }
    db.prepare("UPDATE po SET plan_status = 'Cancel' WHERE po_key = ?").run(p.po_key);
    poHist(db, p.po_key, "cancel", { plan_status: [p.plan_status || null, "Cancel"], reason: [null, reason] }, username, "po.internal.cancel", { po: p.po_no, reason, kit: (kit == null ? void 0 : kit.code) || null });
    return { ok: true, po: p.po_no, message: `\u0110\xE3 h\u1EE7y ${p.po_no}${kit ? ` \xB7 g\u1EE1 kh\u1ECFi ${kit.code}` : ""}` };
  });
}

// ../kitting-app/lib/core-routes.mjs
var PLAN = ["planner", "admin"];
var ADMIN = ["admin"];
var trim = (v) => String(v != null ? v : "").trim();
var MAX_ROWS = 2e4;
function poLatest(p, hist) {
  const mes = p.mes_synced_at ? p.mes_synced_at.slice(0, 19).replace("T", " ") : "", at = [p.synced_at || "", mes].sort().at(-1);
  const src = (hist == null ? void 0 : hist.source) || "";
  const lastSource = mes && (!hist || mes > hist.created_at || src === "API: MES") ? "MES" : /^QR\b|^API: QR/i.test(src) ? "QR" : /^API/i.test(src) ? "API" : src ? "File" : (p.po_type || "SAP") !== "SAP" ? "N\u1ED9i b\u1ED9" : "File";
  return { lastAt: at, lastSource, lastSourceFull: mes && lastSource === "MES" ? "API: MES" : src };
}
function cleanPoRows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw fail("Kh\xF4ng c\xF3 d\xF2ng PO n\xE0o.");
  if (rows.length > MAX_ROWS) throw fail(`Qu\xE1 ${MAX_ROWS} d\xF2ng PO.`);
  const n = (v, label, i) => {
    const x = Number(v != null ? v : 0);
    if (!Number.isFinite(x)) throw fail(`D\xF2ng ${i + 1}: ${label} kh\xF4ng ph\u1EA3i s\u1ED1.`);
    return x;
  };
  const day = (v) => {
    const s = trim(v);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
  };
  return rows.map((r, i) => {
    const po = trim(r.po), modelCode = trim(r.modelCode);
    if (!po || !modelCode) throw fail(`D\xF2ng ${i + 1}: thi\u1EBFu PO ho\u1EB7c Model Code.`);
    return {
      po,
      modelCode,
      planDate: day(r.planDate),
      masterLine: trim(r.masterLine).slice(0, 60),
      basicModel: trim(r.basicModel).slice(0, 60),
      planQty: n(r.planQty, "Plan", i),
      productionQty: n(r.productionQty, "Production", i),
      remainQty: n(r.remainQty, "Remain", i),
      planStatus: trim(r.planStatus).slice(0, 30),
      planStart: trim(r.planStart).slice(0, 20),
      planEnd: trim(r.planEnd).slice(0, 20),
      span: trim(r.span).slice(0, 10),
      poChange: trim(r.poChange).slice(0, 60),
      pendingType: trim(r.pendingType).slice(0, 60)
    };
  });
}
function cleanProdRows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw fail("Kh\xF4ng c\xF3 d\xF2ng c\u1EADp nh\u1EADt n\xE0o.");
  if (rows.length > MAX_ROWS) throw fail(`Qu\xE1 ${MAX_ROWS} d\xF2ng.`);
  const n = (v, label, i) => {
    const x = Number(String(v).replace(/,/g, ""));
    if (!Number.isFinite(x) || x < 0) throw fail(`D\xF2ng ${i + 1}: ${label} ph\u1EA3i l\xE0 s\u1ED1 \u2265 0.`);
    return x;
  };
  return rows.map((r, i) => {
    const po = trim(r == null ? void 0 : r.po);
    if (!po) throw fail(`D\xF2ng ${i + 1}: thi\u1EBFu PO.`);
    if (r.productionQty === void 0 || r.productionQty === null || trim(r.productionQty) === "") throw fail(`D\xF2ng ${i + 1}: thi\u1EBFu Production Q'ty (PO ${po}).`);
    const remain = r.remainQty === void 0 || r.remainQty === null || trim(r.remainQty) === "" ? null : n(r.remainQty, "Remain", i);
    return { po, productionQty: n(r.productionQty, "Production", i), remainQty: remain, status: trim(r.status).slice(0, 30) };
  });
}
function cleanBom(parsed) {
  const rows = Array.isArray(parsed == null ? void 0 : parsed.rows) ? parsed.rows : [];
  if (!rows.length) throw fail("File BOM ch\u01B0a c\xF3 d\xF2ng v\u1EADt t\u01B0.");
  if (rows.length > 1e5) throw fail("BOM qu\xE1 l\u1EDBn.");
  if (rows.some((r) => /^MAU-/i.test(trim(r.modelCode)))) throw fail("File c\xF2n d\xF2ng m\u1EABu (Model code MAU-\u2026). X\xF3a c\xE1c d\xF2ng m\u1EABu r\u1ED3i nh\u1EADp l\u1EA1i.");
  const map = Array.isArray(parsed.modelMap) ? parsed.modelMap : [];
  return {
    rows: rows.map((r, i) => {
      const point = Number(r.point);
      if (!trim(r.modelCode) || !trim(r.material) || !(point > 0)) throw fail(`BOM d\xF2ng ${i + 1} kh\xF4ng h\u1EE3p l\u1EC7.`);
      return { modelCode: trim(r.modelCode), material: trim(r.material), description: trim(r.description).slice(0, 200), point, process: trim(r.process).slice(0, 20), group: ["VLN", "VLDT", "REAR"].includes(r.group) ? r.group : null };
    }),
    modelMap: new Map(map.filter((x) => Array.isArray(x) && trim(x[0]) && trim(x[1])).map((x) => [trim(x[0]), trim(x[1])])),
    vln: (Array.isArray(parsed.vln) ? parsed.vln : []).filter((v) => trim(v.model) && trim(v.material) && Number(v.point) > 0),
    dup: Math.max(0, Number(parsed.dup) || 0)
  };
}
function coreRoutes(db) {
  const today = () => currentShift(db).day, shift0 = () => currentShift(db).shift;
  return [
    { method: "GET", path: "/api/lines/assign", handler: ({ query }) => getAssign(db, query.get("day") || today(), query.get("shift") || shift0()) },
    { method: "POST", path: "/api/lines/assign", roles: PLAN, handler: ({ body, user }) => {
      assertLineEditable(db);
      return saveAssign(db, body || {}, user.username);
    } },
    { method: "POST", path: "/api/lines/assign/copy", roles: PLAN, handler: ({ body, user }) => {
      assertLineEditable(db);
      return copyAssign(db, body || {}, user.username);
    } },
    { method: "GET", path: "/api/lines/params", handler: () => __spreadProps(__spreadValues({}, getParams(db)), { models: modelList(db), lines: db.prepare("SELECT name FROM lines WHERE active = 1 ORDER BY sort_order, name").all().map((r) => r.name) }) },
    { method: "POST", path: "/api/lines/params", roles: PLAN, handler: ({ body, user }) => saveParams(db, body == null ? void 0 : body.rows, user.username) },
    { method: "POST", path: "/api/lines/params/delete", roles: PLAN, handler: ({ body, user }) => deleteParam(db, body || {}, user.username) },
    { method: "GET", path: "/api/vln-overview", handler: ({ query }) => vlnOverview(db, query.get("day") || today(), query.get("shift") || shift0()) },
    { method: "GET", path: "/api/po", handler: () => {
      const rows = db.prepare(`SELECT p.*, k.code AS kit_code, k.plan_day, k.kind, m.model AS mapped_model,
          (SELECT h.id FROM po_history h WHERE h.po_key = p.po_key ORDER BY h.id DESC LIMIT 1) AS last_hist FROM po p
        LEFT JOIN kit_order_po x ON x.po_key = p.po_key LEFT JOIN kit_order k ON k.id = x.kit_id LEFT JOIN model_map m ON m.model_code = p.model_code
        ORDER BY p.plan_date, p.plan_start, p.po_no`).all();
      const histOf = db.prepare("SELECT h.created_at, l.source FROM po_history h LEFT JOIN import_log l ON l.id = h.import_id WHERE h.id = ?");
      const out = rows.map((p) => __spreadProps(__spreadValues({}, poLatest(p, p.last_hist ? histOf.get(p.last_hist) : null)), {
        planEnd: p.plan_end || "",
        po: p.po_no,
        planDate: p.plan_date,
        masterLine: p.master_line,
        basicModel: p.basic_model,
        modelCode: p.model_code,
        model: p.mapped_model || String(p.basic_model || "").slice(0, 8),
        planQty: p.plan_qty,
        productionQty: p.production_qty,
        remainQty: p.remain_qty,
        planStatus: p.plan_status,
        planStart: p.plan_start || "",
        state: productionState(p),
        inSource: !!p.in_source,
        poType: p.po_type || "SAP",
        fixedLine: p.fixed_line || "",
        refDoc: p.ref_doc || "",
        note: p.note || "",
        createdBy: p.created_by || "",
        kitCode: p.kit_code || "",
        kitDay: p.plan_day || "",
        kitKind: p.kind || ""
      }));
      const last = db.prepare("SELECT * FROM import_log WHERE kind = 'PO' ORDER BY id DESC LIMIT 1").get();
      return { rows: out, total: rows.length, lastImport: last ? __spreadProps(__spreadValues({}, last), { summary: JSON.parse(last.summary || "{}") }) : null, source: "excel", alerts: cancelAlerts(db) };
    } },
    { method: "GET", path: "/api/po/history", handler: ({ query }) => poHistory(db, query.get("po")) },
    { method: "POST", path: "/api/po/note", roles: PLAN, handler: ({ body, user }) => setPoNote(db, body || {}, user.username) },
    { method: "GET", path: "/api/po/internal/options", handler: () => internalPoOptions(db) },
    { method: "POST", path: "/api/po/internal", handler: ({ body, user }) => createInternalPo(db, body || {}, user.username) },
    { method: "POST", path: "/api/po/production", roles: ADMIN, handler: ({ body, user }) => __spreadValues({ ok: true, file: trim(body == null ? void 0 : body.source) || "Excel" }, updateProduction(db, cleanProdRows(body == null ? void 0 : body.rows), { source: trim(body == null ? void 0 : body.source) || "Excel", username: user.username })) },
    { method: "GET", path: "/api/po/production/log", roles: ADMIN, handler: () => ({ rows: productionLog(db) }) },
    { method: "POST", path: "/api/po/drop-cancelled", roles: ["planner", "kho", "admin"], handler: ({ body, user }) => dropCancelled(db, body || {}, user.username) },
    { method: "POST", path: "/api/po/import", roles: PLAN, handler: ({ body, user }) => __spreadValues({ ok: true, file: trim(body == null ? void 0 : body.source) || "Excel" }, syncPoRows(db, cleanPoRows(body == null ? void 0 : body.rows), { source: trim(body == null ? void 0 : body.source) || "Excel", username: user.username })) },
    { method: "POST", path: "/api/bom/import", roles: PLAN, handler: ({ body, user }) => {
      assertBomEditable(db);
      return __spreadValues({ ok: true, file: trim(body == null ? void 0 : body.source) }, importBom(db, cleanBom(body), { source: trim(body == null ? void 0 : body.source) || "Excel", username: user.username, dry: !!(body == null ? void 0 : body.dry) }));
    } },
    { method: "GET", path: "/api/admin/settings", roles: ADMIN, handler: () => ({
      settings: getSettings(db),
      lines: db.prepare("SELECT * FROM lines ORDER BY sort_order, name").all(),
      audit: db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 50").all()
    }) },
    { method: "POST", path: "/api/admin/settings", roles: ADMIN, handler: ({ body, user }) => {
      var _a, _b;
      const threshold = Number(body == null ? void 0 : body.supply_threshold), min = Number(body == null ? void 0 : body.vln_min_per_line), max = Number(body == null ? void 0 : body.vln_max_per_line), mergeMax = Number((_a = body == null ? void 0 : body.merge_max_qty) != null ? _a : 2500);
      if (!Number.isInteger(mergeMax) || mergeMax < 1) throw fail("Gi\u1EDBi h\u1EA1n SL g\u1ED9p ph\u1EA3i l\xE0 s\u1ED1 nguy\xEAn d\u01B0\u01A1ng.");
      const autoMax = Number((_b = body == null ? void 0 : body.auto_max_kits_day) != null ? _b : getSettings(db).auto_max_kits_day);
      if (!Number.isInteger(autoMax) || autoMax < 0) throw fail("S\u1ED1 Kit t\u1ED1i \u0111a / ng\xE0y ph\u1EA3i l\xE0 s\u1ED1 nguy\xEAn \u2265 0 (0 = kh\xF4ng gi\u1EDBi h\u1EA1n).");
      if (!Number.isFinite(threshold) || threshold < 0) throw fail("Ng\u01B0\u1EE1ng c\u1EA5p v\u1EADt li\u1EC7u ph\u1EA3i \u2265 0.");
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) throw fail("Min/Max PO VLN ch\u1EDD c\u1EA5p ph\u1EA3i l\xE0 s\u1ED1 nguy\xEAn, 0 \u2264 min \u2264 max.");
      const st = (body == null ? void 0 : body.shift_starts) !== void 0 ? String(body.shift_starts).split(",").map((x) => x.trim()).filter(Boolean) : null;
      if (st && (st.length !== shifts(db).length || st.some((x) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(x)) || st.some((x, i) => i && x <= st[i - 1]))) throw fail("Gi\u1EDD b\u1EAFt \u0111\u1EA7u ca: m\u1ED7i ca 1 gi\u1EDD HH:MM, t\u0103ng d\u1EA7n, v\xED d\u1EE5 08:00,20:00.");
      const up = db.prepare("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
      up.run("supply_threshold", String(threshold));
      up.run("vln_min_per_line", String(min));
      up.run("vln_max_per_line", String(max));
      up.run("merge_max_qty", String(mergeMax));
      up.run("auto_max_kits_day", String(autoMax));
      if (st) up.run("shift_starts", st.join(","));
      audit(db, user.username, "settings", { threshold, min, max, mergeMax, autoMax });
      return { ok: true };
    } },
    { method: "POST", path: "/api/admin/lines", roles: ADMIN, handler: ({ body, user }) => {
      const name = trim(body == null ? void 0 : body.name);
      if (!name || name.length > 40) throw fail("Nh\u1EADp t\xEAn Line.");
      if ("active" in (body || {}) && db.prepare("SELECT 1 FROM lines WHERE name = ?").get(name)) db.prepare("UPDATE lines SET active = ? WHERE name = ?").run(body.active ? 1 : 0, name);
      else db.prepare("INSERT INTO lines(name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM lines)) ON CONFLICT(name) DO NOTHING").run(name);
      audit(db, user.username, "line.manage", body);
      return { ok: true };
    } }
  ];
}

// ../kitting-app/lib/plan-extra.mjs
var pending = (k) => k.vln_status === "pending" && k.hv_status === "pending";
var placeholders = (n) => Array(n).fill("?").join(",");
function scopeOf(db, items2 = [], days = []) {
  const pos = /* @__PURE__ */ new Set(), d = new Set(days.filter(Boolean));
  for (const it of items2) {
    if (it.type === "po") pos.add(normalizePo(it.id));
    else {
      const k = db.prepare("SELECT plan_day FROM kit_order WHERE id = ?").get(Number(it.id));
      if (k == null ? void 0 : k.plan_day) d.add(k.plan_day);
      db.prepare("SELECT po_key FROM kit_order_po WHERE kit_id = ?").all(Number(it.id)).forEach((r) => pos.add(r.po_key));
    }
  }
  return { pos: [...pos], core: [...pos], days: [...d] };
}
function capture(db, scope) {
  const ids = /* @__PURE__ */ new Set();
  if (scope.pos.length) db.prepare(`SELECT DISTINCT kit_id FROM kit_order_po WHERE po_key IN (${placeholders(scope.pos.length)})`).all(...scope.pos).forEach((r) => ids.add(r.kit_id));
  if (scope.days.length) db.prepare(`SELECT id FROM kit_order WHERE plan_day IN (${placeholders(scope.days.length)})`).all(...scope.days).forEach((r) => ids.add(r.id));
  const kits = [...ids].map((id) => __spreadProps(__spreadValues({}, db.prepare("SELECT * FROM kit_order WHERE id = ?").get(id)), { pos: db.prepare("SELECT po_key FROM kit_order_po WHERE kit_id = ?").all(id).map((r) => r.po_key) }));
  const pos = new Set(scope.pos);
  kits.forEach((k) => k.pos.forEach((p) => pos.add(p)));
  return { pos: [...pos], core: scope.core || scope.pos, kits: kits.filter((k) => pending(k)) };
}
function withUndo(db, username, label, scope, fn) {
  const snap = capture(db, scope);
  const result = fn();
  db.prepare("INSERT INTO plan_undo(username, label, data) VALUES (?,?,?)").run(username, label, JSON.stringify(snap));
  db.prepare("DELETE FROM plan_undo WHERE username = ? AND id NOT IN (SELECT id FROM plan_undo WHERE username = ? ORDER BY id DESC LIMIT 20)").run(username, username);
  return __spreadProps(__spreadValues({}, result), { undo: label });
}
function lastUndo(db, username) {
  const r = db.prepare("SELECT label, created_at FROM plan_undo WHERE username = ? ORDER BY id DESC LIMIT 1").get(username || "");
  return r ? { label: r.label, at: r.created_at } : null;
}
function undo(db, username) {
  return tx(db, () => {
    var _a;
    const r = db.prepare("SELECT * FROM plan_undo WHERE username = ? ORDER BY id DESC LIMIT 1").get(username);
    if (!r) throw fail("Kh\xF4ng c\xF2n thao t\xE1c n\xE0o \u0111\u1EC3 ho\xE0n t\xE1c.");
    const snap = JSON.parse(r.data);
    const cur = snap.pos.length ? db.prepare(`SELECT DISTINCT k.* FROM kit_order k JOIN kit_order_po x ON x.kit_id = k.id WHERE x.po_key IN (${placeholders(snap.pos.length)})`).all(...snap.pos) : [];
    const core = new Set(snap.core || snap.pos);
    const started = cur.filter((k) => !pending(k) && db.prepare("SELECT po_key FROM kit_order_po WHERE kit_id = ?").all(k.id).some((r2) => core.has(r2.po_key)));
    if (started.length) throw fail(`Kho \u0111\xE3 b\u1EAFt \u0111\u1EA7u kitting ${started.map((k) => k.code).join(", ")} \u2014 kh\xF4ng ho\xE0n t\xE1c \u0111\u01B0\u1EE3c.`);
    for (const k of cur.filter(pending)) {
      db.prepare("DELETE FROM kit_item WHERE kit_id = ?").run(k.id);
      db.prepare("DELETE FROM kit_order_po WHERE kit_id = ?").run(k.id);
      db.prepare("DELETE FROM kit_order WHERE id = ?").run(k.id);
    }
    const ins = db.prepare("INSERT INTO kit_order(id, code, kind, model_code, plan_day, seq, plan_line, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)");
    for (const k of snap.kits) {
      if (db.prepare("SELECT 1 FROM kit_order WHERE id = ? OR code = ?").get(k.id, k.code)) continue;
      ins.run(k.id, k.code, k.kind, k.model_code, k.plan_day, k.seq, (_a = k.plan_line) != null ? _a : null, k.created_by, k.created_at);
      for (const p of k.pos) if (!db.prepare("SELECT 1 FROM kit_order_po WHERE po_key = ?").get(p)) db.prepare("INSERT INTO kit_order_po(kit_id, po_key) VALUES (?, ?)").run(k.id, p);
    }
    db.prepare("DELETE FROM plan_undo WHERE id = ?").run(r.id);
    audit(db, username, "plan.undo", r.label);
    return { ok: true, message: `\u0110\xE3 ho\xE0n t\xE1c: ${r.label}` };
  });
}
function batchMove(db, { items: items2, day, position = "end" }, username) {
  if (!Array.isArray(items2) || !items2.length) throw fail("Ch\u01B0a ch\u1ECDn PO.");
  if (day !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw fail("Ch\u1ECDn ng\xE0y kitting.");
  const startOf = (it) => {
    var _a, _b;
    return it.type === "po" ? (_a = db.prepare("SELECT plan_start s FROM po WHERE po_key = ?").get(normalizePo(it.id))) == null ? void 0 : _a.s : (_b = db.prepare("SELECT MIN(p.plan_start) s FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = ?").get(Number(it.id))) == null ? void 0 : _b.s;
  };
  items2 = items2.map((it) => ({ it, s: startOf(it) || "9999" })).sort((a, b) => a.s.localeCompare(b.s)).map((x) => x.it);
  return tx(db, () => {
    const moved = [];
    for (const it of items2) {
      if (it.type === "po") {
        const key2 = normalizePo(it.id);
        const p = db.prepare("SELECT * FROM po WHERE po_key = ?").get(key2);
        if (!p) throw fail("C\xF3 PO kh\xF4ng c\xF2n trong d\u1EEF li\u1EC7u. T\u1EA3i l\u1EA1i.", 409);
        if (day !== null && isCancelled(p)) throw fail(`PO ${p.po_no} \u0111\xE3 h\u1EE7y (Cancel), kh\xF4ng l\u1EADp k\u1EBF ho\u1EA1ch \u0111\u01B0\u1EE3c.`);
        if (day !== null && p.po_type === "LOAD") throw fail(`${p.po_no} l\xE0 PO Load th\xE0nh ph\u1EA9m: kh\xF4ng kitting ri\xEAng, ch\u1ECDn c\xF9ng PO / Kit th\u1EADt c\xF9ng Model Code r\u1ED3i b\u1EA5m G\u1ED9p.`);
        if (db.prepare("SELECT 1 FROM kit_order_po WHERE po_key = ?").get(key2)) throw fail(`PO ${p.po_no} \u0111\xE3 \u0111\u01B0\u1EE3c l\u1EADp k\u1EBF ho\u1EA1ch. T\u1EA3i l\u1EA1i.`, 409);
        if (day === null) continue;
        const res = db.prepare("INSERT INTO kit_order(code, kind, model_code, plan_day, seq, created_by) VALUES (?, 'single', ?, ?, 0, ?)").run(p.po_no, p.model_code, day, username);
        db.prepare("INSERT INTO kit_order_po(kit_id, po_key) VALUES (?, ?)").run(res.lastInsertRowid, key2);
        moved.push(Number(res.lastInsertRowid));
        continue;
      }
      const k = db.prepare("SELECT * FROM kit_order WHERE id = ?").get(Number(it.id));
      if (!k) throw fail("Kit PO kh\xF4ng c\xF2n t\u1ED3n t\u1EA1i. T\u1EA3i l\u1EA1i.", 409);
      if (!pending(k)) throw fail(`${k.code} kho \u0111\xE3 b\u1EAFt \u0111\u1EA7u kitting, kh\xF4ng chuy\u1EC3n \u0111\u01B0\u1EE3c.`);
      if (day === null) {
        if (k.kind === "single") {
          db.prepare("DELETE FROM kit_item WHERE kit_id = ?").run(k.id);
          db.prepare("DELETE FROM kit_order WHERE id = ?").run(k.id);
        } else db.prepare("UPDATE kit_order SET plan_day = NULL, seq = 0 WHERE id = ?").run(k.id);
        continue;
      }
      db.prepare("UPDATE kit_order SET plan_day = ?, updated_at = datetime('now') WHERE id = ?").run(day, k.id);
      moved.push(k.id);
    }
    if (day) {
      const others = db.prepare("SELECT id FROM kit_order WHERE plan_day = ? ORDER BY seq, id").all(day).map((r) => r.id).filter((id) => !moved.includes(id));
      const order = position === "start" ? [...moved, ...others] : [...others, ...moved];
      order.forEach((id, i) => db.prepare("UPDATE kit_order SET seq = ? WHERE id = ?").run(i, id));
    }
    audit(db, username, "plan.batch", { day, n: items2.length });
    return { ok: true, count: items2.length, message: day ? `\u0110\xE3 chuy\u1EC3n ${items2.length} th\u1EBB sang kitting ${day.slice(8, 10)}/${day.slice(5, 7)}` : `\u0110\xE3 b\u1ECF k\u1EBF ho\u1EA1ch ${items2.length} th\u1EBB` };
  });
}
function weekStart(day) {
  const [y, m, d] = String(day || todayKey()).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d)), dow = (dt.getUTCDay() + 6) % 7;
  return addDays(dt.toISOString().slice(0, 10), -dow);
}
var shiftList = (db, shift) => shift === "all" ? shifts(db) : [shift];
function getWeek(db, start, shift) {
  var _a, _b, _c;
  start = weekStart(start);
  const sh = shiftList(db, shift || shifts(db)[0]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const lines = db.prepare("SELECT name, active FROM lines ORDER BY active DESC, sort_order, name").all();
  const rows = db.prepare(`SELECT work_date, shift, line, model FROM line_assign WHERE work_date BETWEEN ? AND ? AND shift IN (${placeholders(sh.length)})`).all(days[0], days[6], ...sh);
  const cells = {};
  for (const r of rows) {
    const c = (_b = cells[_a = r.line] || (cells[_a] = {}))[_c = r.work_date] || (_b[_c] = { models: {} });
    c.models[r.shift] = r.model;
  }
  for (const line of Object.keys(cells)) for (const day of Object.keys(cells[line])) {
    const c = cells[line][day], vals = sh.map((s) => c.models[s] || "");
    c.model = vals[0];
    c.mixed = new Set(vals).size > 1;
  }
  return { start, days, shift: shift || sh[0], shifts: shifts(db), lines, cells, models: modelList(db), today: todayKey() };
}
function saveWeek(db, { shift, cells }, username) {
  if (!Array.isArray(cells) || !cells.length) throw fail("Kh\xF4ng c\xF3 thay \u0111\u1ED5i.");
  const sh = shiftList(db, shift), lines = new Set(db.prepare("SELECT name FROM lines").all().map((r) => r.name));
  return tx(db, () => {
    const del = db.prepare("DELETE FROM line_assign WHERE work_date = ? AND shift = ? AND line = ?");
    const ins = db.prepare("INSERT INTO line_assign(work_date, shift, line, model, updated_by) VALUES (?,?,?,?,?)");
    for (const c of cells) {
      if (!lines.has(c.line)) throw fail(`Line ${c.line} kh\xF4ng h\u1EE3p l\u1EC7.`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.day)) throw fail("Ng\xE0y kh\xF4ng h\u1EE3p l\u1EC7.");
      for (const s of sh) {
        del.run(c.day, s, c.line);
        if (String(c.model || "").trim()) ins.run(c.day, s, c.line, c.model, username);
      }
    }
    audit(db, username, "line.week", { shift, n: cells.length });
    return { ok: true, count: cells.length };
  });
}
function copyWeek(db, { start, shift }, username) {
  start = weekStart(start);
  const sh = shiftList(db, shift), from = addDays(start, -7);
  const rows = db.prepare(`SELECT work_date, shift, line, model FROM line_assign WHERE work_date BETWEEN ? AND ? AND shift IN (${placeholders(sh.length)})`).all(from, addDays(from, 6), ...sh);
  if (!rows.length) throw fail("Tu\u1EA7n tr\u01B0\u1EDBc ch\u01B0a c\xF3 k\u1EBF ho\u1EA1ch Line.");
  return tx(db, () => {
    db.prepare(`DELETE FROM line_assign WHERE work_date BETWEEN ? AND ? AND shift IN (${placeholders(sh.length)})`).run(start, addDays(start, 6), ...sh);
    const ins = db.prepare("INSERT INTO line_assign(work_date, shift, line, model, updated_by) VALUES (?,?,?,?,?)");
    for (const r of rows) ins.run(addDays(r.work_date, 7), r.shift, r.line, r.model, username);
    audit(db, username, "line.week.copy", { start, shift });
    return { ok: true, count: rows.length };
  });
}
function manageLine(db, { action, name, newName }, username) {
  name = String(name || "").trim();
  newName = String(newName || "").trim();
  return tx(db, () => {
    if (action === "add") {
      if (!name || name.length > 40) throw fail("Nh\u1EADp t\xEAn Line.");
      const ex = db.prepare("SELECT * FROM lines WHERE name = ?").get(name);
      if (ex == null ? void 0 : ex.active) throw fail(`${name} \u0111\xE3 c\xF3.`);
      if (ex) db.prepare("UPDATE lines SET active = 1 WHERE name = ?").run(name);
      else db.prepare("INSERT INTO lines(name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM lines))").run(name);
      audit(db, username, "line.add", name);
      return { ok: true, message: `\u0110\xE3 th\xEAm ${name}` };
    }
    if (!db.prepare("SELECT 1 FROM lines WHERE name = ?").get(name)) throw fail("Kh\xF4ng t\xECm th\u1EA5y Line.", 404);
    if (action === "rename") {
      if (!newName || newName.length > 40) throw fail("Nh\u1EADp t\xEAn m\u1EDBi.");
      if (db.prepare("SELECT 1 FROM lines WHERE name = ?").get(newName)) throw fail(`${newName} \u0111\xE3 t\u1ED3n t\u1EA1i.`);
      for (const [t4, c] of [["po", "fixed_line"], ["users", "line"], ["lines", "name"], ["line_assign", "line"], ["line_params", "line"], ["kit_order", "line"], ["material_request", "line"], ["kit_txn", "line"]]) {
        try {
          db.prepare(`UPDATE ${t4} SET ${c} = ? WHERE ${c} = ?`).run(newName, name);
        } catch (e) {
        }
      }
      audit(db, username, "line.rename", { name, newName });
      return { ok: true, message: `\u0110\xE3 \u0111\u1ED5i ${name} \u2192 ${newName}` };
    }
    if (action === "delete") {
      const busy = db.prepare("SELECT COUNT(*) n FROM kit_order WHERE line = ? AND vln_status = 'delivered'").get(name).n;
      db.prepare("DELETE FROM line_assign WHERE line = ? AND work_date >= ?").run(name, todayKey());
      const used = busy || db.prepare("SELECT COUNT(*) n FROM line_assign WHERE line = ?").get(name).n || db.prepare("SELECT COUNT(*) n FROM kit_txn WHERE line = ?").get(name).n;
      if (used) db.prepare("UPDATE lines SET active = 0 WHERE name = ?").run(name);
      else {
        db.prepare("DELETE FROM line_params WHERE line = ?").run(name);
        db.prepare("DELETE FROM lines WHERE name = ?").run(name);
      }
      audit(db, username, "line.delete", name);
      return { ok: true, message: used ? `${name} \u0111\xE3 ng\u1EEBng (gi\u1EEF l\u1ECBch s\u1EED${busy ? `, c\xF2n ${busy} PO tr\xEAn line` : ""})` : `\u0110\xE3 x\xF3a ${name}` };
    }
    throw fail("Thao t\xE1c kh\xF4ng h\u1EE3p l\u1EC7.");
  });
}

// ../kitting-app/lib/plan-auto.mjs
var pending2 = (k) => k.vln_status === "pending" && k.hv_status === "pending";
var dayOf = (s) => String(s || "").slice(0, 10);
var intIn = (v, def, min, max) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
};
function autoOptions(db, o = {}) {
  var _a;
  const today = todayKey(), s = getSettings(db);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(o.to)) ? o.to : addDays(today, 2);
  return {
    to,
    today,
    models: Array.isArray(o.models) ? o.models.map(String).filter(Boolean) : [],
    minQty: intIn(o.minQty, 1e3, 0, 1e6),
    lead: intIn(o.lead, 0, 0, 14),
    maxPerDay: intIn((_a = o.maxPerDay) != null ? _a : s.auto_max_kits_day, 0, 0, 999),
    attach: o.attach !== false,
    order: o.order === "append" ? "append" : "start",
    exclude: new Set(Array.isArray(o.exclude) ? o.exclude.map(String) : []),
    mergeMax: Number(s.merge_max_qty) || 2500
  };
}
function autoPlan(db, input) {
  const o = autoOptions(db, input);
  const okModel = (m) => !o.models.length || o.models.includes(m);
  const hasBom = (code) => !!db.prepare("SELECT 1 FROM bom WHERE model_code = ? LIMIT 1").get(code);
  const poRow = (p) => ({
    key: p.po_key,
    po: p.po_no,
    code: p.model_code,
    model: modelOf(db, p.model_code, p.basic_model),
    qty: p.plan_qty,
    start: p.plan_start || "",
    type: p.po_type || "SAP",
    line: p.fixed_line || ""
  });
  const pool = db.prepare(`SELECT p.* FROM po p WHERE p.in_source = 1 AND p.remain_qty > 0 AND ${notCancelledSql("p.")}
    AND NOT EXISTS (SELECT 1 FROM kit_order_po k WHERE k.po_key = p.po_key)`).all().map(poRow);
  const kitPos3 = (id) => db.prepare("SELECT p.* FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = ?").all(id);
  const kitInfo2 = (k) => {
    var _a;
    const ps = kitPos3(k.id), r = ps.map(poRow);
    return {
      id: k.id,
      code: k.code,
      day: k.plan_day,
      seq: k.seq,
      model: ((_a = r[0]) == null ? void 0 : _a.model) || k.model_code,
      codes: [...new Set(r.map((x) => x.code))],
      qty: r.reduce((a, x) => a + x.qty, 0),
      start: r.map((x) => x.start).filter(Boolean).sort()[0] || "",
      lines: [...new Set(r.map((x) => x.line).filter(Boolean))],
      pos: r,
      cancelled: ps.some(isCancelled)
    };
  };
  const poolKits = db.prepare("SELECT * FROM kit_order WHERE plan_day IS NULL ORDER BY id").all().filter(pending2).map(kitInfo2);
  const left = { small: [], later: [], noStart: [], excluded: [], noHost: [] };
  const cand = [];
  for (const p of pool.filter((p2) => p2.type === "SAP" && okModel(p2.model))) {
    const key2 = `po:${p.key}`;
    if (!p.start) left.noStart.push(p.po);
    else if (dayOf(p.start) > o.to) left.later.push(p.po);
    else if (p.qty < o.minQty) left.small.push({ po: p.po, model: p.model, qty: p.qty });
    else if (o.exclude.has(key2)) left.excluded.push(p.po);
    else cand.push({ key: key2, kind: "po", ref: p.key, codeLabel: p.po, model: p.model, codes: [p.code], qty: p.qty, start: p.start, lines: [], pos: [p] });
  }
  for (const k of poolKits.filter((k2) => okModel(k2.model) && !k2.cancelled)) {
    const key2 = `kit:${k.id}`;
    if (!k.start) left.noStart.push(k.code);
    else if (dayOf(k.start) > o.to) left.later.push(k.code);
    else if (k.qty < o.minQty) left.small.push({ po: k.code, model: k.model, qty: k.qty });
    else if (o.exclude.has(key2)) left.excluded.push(k.code);
    else cand.push({ key: key2, kind: "kit", ref: k.id, codeLabel: k.code, model: k.model, codes: k.codes, qty: k.qty, start: k.start, lines: k.lines, pos: k.pos });
  }
  cand.sort((a, b) => a.start.localeCompare(b.start) || a.codeLabel.localeCompare(b.codeLabel));
  const used = /* @__PURE__ */ new Map(), countDay = (d) => {
    if (!used.has(d)) used.set(d, db.prepare("SELECT COUNT(*) n FROM kit_order WHERE plan_day = ?").get(d).n);
    return used.get(d);
  };
  const rows = [];
  for (const c of cand) {
    let want = addDays(dayOf(c.start), -o.lead), late = false;
    if (want < o.today) {
      want = o.today;
      late = true;
    }
    let day = want;
    if (o.maxPerDay) for (let i = 0; countDay(day) >= o.maxPerDay && i < 366; i++) day = addDays(day, 1);
    used.set(day, countDay(day) + 1);
    const noBom = c.codes.filter((x) => !hasBom(x));
    rows.push({
      key: c.key,
      action: "place",
      kind: c.kind,
      ref: c.ref,
      code: c.codeLabel,
      model: c.model,
      codes: c.codes,
      qty: c.qty,
      start: c.start,
      day,
      want,
      late,
      shifted: day !== want,
      noBom,
      attached: [],
      lines: c.lines,
      pos: c.pos.map((p) => p.po)
    });
  }
  if (o.attach) {
    const printed = printedCodes(db);
    const hosts = [
      ...rows.map((r) => ({ row: r, model: r.model, qty: r.qty, start: r.start, lines: [...r.lines], code: r.code, day: r.day })),
      ...db.prepare("SELECT * FROM kit_order WHERE plan_day IS NOT NULL").all().filter((k) => pending2(k) && !printed.has(k.code)).map(kitInfo2).filter((k) => !k.cancelled).map((k) => ({ kit: k, model: k.model, qty: k.qty, start: k.start, lines: [...k.lines], code: k.code, day: k.plan_day }))
    ];
    const internals = pool.filter((p) => p.type !== "SAP" && okModel(p.model)).sort((a, b) => a.start.localeCompare(b.start) || a.po.localeCompare(b.po));
    const ts = (s) => s ? Date.parse(`${s.slice(0, 10)}T${s.slice(11, 16) || "00:00"}:00Z`) : 0;
    for (const p of internals) {
      const key2 = `po:${p.key}`;
      if (o.exclude.has(key2)) {
        left.excluded.push(p.po);
        continue;
      }
      const fit = hosts.filter((h2) => h2.model === p.model && h2.qty + p.qty <= o.mergeMax && (!p.line || h2.lines.every((l) => l === p.line)));
      if (!fit.length) {
        left.noHost.push({ po: p.po, model: p.model, qty: p.qty, type: p.type });
        continue;
      }
      const t4 = ts(p.start) || Date.now();
      const h = fit.sort((a, b) => Math.abs(ts(a.start) - t4) - Math.abs(ts(b.start) - t4) || a.code.localeCompare(b.code))[0];
      h.qty += p.qty;
      if (p.line && !h.lines.includes(p.line)) h.lines.push(p.line);
      const att = { po: p.po, key: p.key, type: p.type, qty: p.qty, code: p.code, line: p.line };
      if (h.row) {
        h.row.attached.push(att);
        if (!h.row.codes.includes(p.code)) h.row.codes.push(p.code);
        if (!hasBom(p.code)) h.row.noBom.push(p.code);
        continue;
      }
      let r = rows.find((x) => x.action === "attach" && x.ref === h.kit.id);
      if (!r) rows.push(r = {
        key: `host:${h.kit.id}`,
        action: "attach",
        kind: "kit",
        ref: h.kit.id,
        code: h.kit.code,
        model: h.model,
        codes: [...h.kit.codes],
        qty: h.kit.qty,
        start: h.kit.start,
        day: h.kit.day,
        noBom: [],
        attached: [],
        pos: h.kit.pos.map((x) => x.po)
      });
      r.attached.push(att);
      if (!r.codes.includes(p.code)) r.codes.push(p.code);
      if (!hasBom(p.code)) r.noBom.push(p.code);
    }
  }
  rows.forEach((r) => {
    r.total = r.qty + r.attached.reduce((a, x) => a + x.qty, 0);
  });
  rows.sort((a, b) => a.day.localeCompare(b.day) || (a.action === "attach") - (b.action === "attach") || a.start.localeCompare(b.start));
  const opts = __spreadProps(__spreadValues({}, o), { exclude: [...o.exclude] });
  return { opts, rows, left, summary: { place: rows.filter((r) => r.action === "place").length, attach: rows.reduce((a, r) => a + r.attached.length, 0), days: [...new Set(rows.map((r) => r.day))].sort() } };
}
function autoScopeItems(plan) {
  return {
    items: [...plan.rows.map((r) => ({ type: r.kind, id: r.ref })), ...plan.rows.flatMap((r) => r.attached.map((a) => ({ type: "po", id: a.key })))],
    days: [...new Set(plan.rows.map((r) => r.day))]
  };
}
function autoApply(db, input, username) {
  const plan = autoPlan(db, input);
  if (!plan.rows.length) throw fail("Kh\xF4ng c\xF3 PO n\xE0o \u0111\u1EC3 x\u1EBFp theo c\xE1c t\xEDch ch\u1ECDn hi\u1EC7n t\u1EA1i.");
  const newKit = /* @__PURE__ */ new Map();
  for (const r of plan.rows.filter((x) => x.action === "place")) {
    if (r.kind === "po") {
      const p = db.prepare("SELECT * FROM po WHERE po_key = ?").get(r.ref);
      if (!p || db.prepare("SELECT 1 FROM kit_order_po WHERE po_key = ?").get(r.ref)) throw fail(`PO ${r.code} v\u1EEBa thay \u0111\u1ED5i. H\xE3y t\u1EA3i l\u1EA1i.`, 409);
      const res = db.prepare("INSERT INTO kit_order(code, kind, model_code, plan_day, seq, created_by) VALUES (?, 'single', ?, ?, 0, ?)").run(p.po_no, p.model_code, r.day, username);
      db.prepare("INSERT INTO kit_order_po(kit_id, po_key) VALUES (?, ?)").run(res.lastInsertRowid, r.ref);
      newKit.set(r.key, Number(res.lastInsertRowid));
    } else {
      const k = db.prepare("SELECT * FROM kit_order WHERE id = ?").get(r.ref);
      if (!k || k.plan_day || !pending2(k)) throw fail(`${r.code} v\u1EEBa thay \u0111\u1ED5i. H\xE3y t\u1EA3i l\u1EA1i.`, 409);
      db.prepare("UPDATE kit_order SET plan_day = ?, seq = 0, updated_at = datetime('now') WHERE id = ?").run(r.day, r.ref);
      newKit.set(r.key, r.ref);
    }
  }
  const startOf = (id) => {
    var _a;
    return ((_a = db.prepare("SELECT MIN(p.plan_start) s FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = ? AND p.plan_start <> ''").get(id)) == null ? void 0 : _a.s) || "9999";
  };
  const added = new Set(newKit.values());
  for (const day of plan.summary.days) {
    const all = db.prepare("SELECT id FROM kit_order WHERE plan_day = ? ORDER BY seq, id").all(day).map((x) => x.id);
    const order = all.filter((id) => !added.has(id));
    const mine = all.filter((id) => added.has(id)).sort((a, b) => startOf(a).localeCompare(startOf(b)));
    for (const id of mine) {
      if (plan.opts.order === "append") {
        order.push(id);
        continue;
      }
      const s = startOf(id), at = order.findIndex((x) => startOf(x) > s);
      order.splice(at < 0 ? order.length : at, 0, id);
    }
    order.forEach((id, i) => db.prepare("UPDATE kit_order SET seq = ? WHERE id = ?").run(i, id));
  }
  let attached = 0;
  for (const r of plan.rows.filter((x) => x.attached.length)) {
    const kitId = r.action === "place" ? newKit.get(r.key) : r.ref;
    if (r.action === "attach") {
      const k = db.prepare("SELECT * FROM kit_order WHERE id = ?").get(kitId);
      if (!k || !pending2(k)) throw fail(`${r.code} Kho v\u1EEBa b\u1EAFt \u0111\u1EA7u kitting. H\xE3y t\u1EA3i l\u1EA1i.`, 409);
    }
    merge(db, [{ type: "kit", id: kitId }, ...r.attached.map((a) => ({ type: "po", id: a.key }))], username);
    attached += r.attached.length;
  }
  const placed = plan.summary.place;
  audit(db, username, "plan.auto", { opts: __spreadProps(__spreadValues({}, plan.opts), { exclude: plan.opts.exclude.length }), placed, attached });
  return {
    ok: true,
    placed,
    attached,
    days: plan.summary.days,
    message: `T\u1EF1 \u0111\u1ED9ng x\u1EBFp: ${placed} Kit v\xE0o ${plan.summary.days.length} ng\xE0y${attached ? `, gh\xE9p ${attached} PO Unplan / RMA` : ""}.`
  };
}

// ../kitting-app/lib/plan-import.mjs
var MAX_ROWS2 = 3e3;
var MAX_SHEETS = 12;
var hk = (v) => String(v != null ? v : "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, " ").trim();
var cell = (v) => {
  var _a, _b, _c, _d;
  return v && typeof v === "object" && !(v instanceof Date) ? (_d = (_c = (_a = v.result) != null ? _a : v.text) != null ? _c : (_b = v.richText) == null ? void 0 : _b.map((t4) => t4.text).join("")) != null ? _d : "" : v;
};
var str = (v) => {
  const x = cell(v);
  return x instanceof Date ? x.toISOString().slice(0, 10) : String(x != null ? x : "").trim();
};
var num = (v) => {
  const s = str(v).replace(/,/g, "").trim();
  if (!s || s === "-") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
var fmtN2 = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
var FORMATS = {
  line: { label: "G\u1ED9p theo Line + Model", need: ["line", "model", "model code", "po"], cols: { line: ["line"], model: ["model"], code: ["model code"], po: ["po"], qty: ["master qty", "kitting qty", "so luong"], planDate: ["plan date"] } },
  bom: { label: "Kitting theo PO (BOM Number)", need: ["bom number", "po"], cols: { group: ["bom number"], line: ["line"], model: ["model"], code: ["code", "model code"], po: ["po"], qty: ["so luong", "qty", "master qty"], ils: ["po il-sung"] } }
};
function detect(rows) {
  for (let r = 0; r < Math.min(6, rows.length); r++) {
    const keys = (rows[r] || []).map(hk);
    for (const kind of ["bom", "line"]) {
      const f = FORMATS[kind];
      if (!f.need.every((n) => keys.includes(n))) continue;
      if (kind === "line" && keys.includes("bom number")) continue;
      const cols = {};
      for (const [name, aliases] of Object.entries(f.cols)) {
        const i = aliases.map((a) => keys.indexOf(a)).find((i2) => i2 >= 0);
        if (i !== void 0) cols[name] = i;
      }
      return { kind, headerRow: r, cols };
    }
  }
  return null;
}
function sapPo(raw) {
  let s = typeof cell(raw) === "number" ? String(Math.round(cell(raw))) : str(raw).replace(/\s+/g, "");
  if (/^\d{11}(-\d+)?$/.test(s)) s = "0" + s;
  const m = s.match(/^(0\d{11})(-\d+)?$/);
  return m ? { po: m[1], split: !!m[2], raw: s } : null;
}
function normLine(v) {
  const s = str(v);
  if (!s || s === "0" || s === "-") return "";
  const m = s.match(/^line\s*0*(\d+)\s*([a-z]?)$/i);
  return m ? `Line ${m[1]}${m[2].toUpperCase()}` : s;
}
function suggestDay(sheets, fileName, year) {
  var _a;
  const c = /* @__PURE__ */ new Map();
  for (const s of sheets) for (const v of s.planDates || []) c.set(v, (c.get(v) || 0) + 1);
  const best = (_a = [...c].sort((a, b) => b[1] - a[1])[0]) == null ? void 0 : _a[0];
  if (best) return best;
  const m = String(fileName || "").match(/(\d{1,2})[.\-_/](\d{1,2})(?:[.\-_/](\d{4}))?/);
  return m ? `${m[3] || year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
}
function toDay(v) {
  const x = cell(v);
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  if (typeof x === "number" && x > 3e4 && x < 8e4) return new Date(Date.UTC(1899, 11, 30) + x * 864e5).toISOString().slice(0, 10);
  const s = String(x != null ? x : "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return "";
}
function parsePlanSheets(input) {
  const sheets = (Array.isArray(input) ? input : []).slice(0, MAX_SHEETS);
  if (!sheets.length) throw fail("File kh\xF4ng c\xF3 sheet n\xE0o.");
  const out = [];
  for (const sh of sheets) {
    const rows = (Array.isArray(sh.rows) ? sh.rows : []).slice(0, MAX_ROWS2), d = detect(rows);
    if (!d) {
      out.push({ name: String(sh.name || ""), kind: null, groups: [], skipped: [] });
      continue;
    }
    const c = d.cols, groups = /* @__PURE__ */ new Map(), skipped = [], planDates = [];
    for (let r = d.headerRow + 1; r < rows.length; r++) {
      const row = rows[r] || [], poRaw = str(row[c.po]);
      if (!poRaw) continue;
      const sp = sapPo(row[c.po]);
      if (!sp) {
        skipped.push({ row: r + 1, po: poRaw, why: "PO n\u1ED9i b\u1ED9 / kh\xF4ng ph\u1EA3i PO SAP" });
        continue;
      }
      const model = str(row[c.model]), line = normLine(row[c.line]);
      const key2 = d.kind === "line" ? `${line || "(tr\u1ED1ng)"} \xB7 ${model}` : str(row[c.group]);
      if (!key2) {
        skipped.push({ row: r + 1, po: poRaw, why: "Thi\u1EBFu BOM Number" });
        continue;
      }
      if (c.planDate !== void 0) {
        const pd = toDay(row[c.planDate]);
        if (pd) planDates.push(pd);
      }
      if (!groups.has(key2)) groups.set(key2, { key: key2, line: "", model, rows: [] });
      const g = groups.get(key2);
      if (!g.line && line) g.line = line;
      g.rows.push({ row: r + 1, po: sp.po, raw: sp.raw, split: sp.split, code: str(row[c.code]), qty: num(row[c.qty]), line });
    }
    out.push({ name: String(sh.name || ""), kind: d.kind, label: FORMATS[d.kind].label, groups: [...groups.values()], skipped, planDates });
  }
  return out;
}
function planImport(db, body, username, apply2 = false) {
  const parsed = parsePlanSheets(body == null ? void 0 : body.sheets);
  const year = new Date(Date.now() + 7 * 36e5).getUTCFullYear();
  const suggested = suggestDay(parsed, body == null ? void 0 : body.fileName, year);
  const day = String((body == null ? void 0 : body.day) || suggested || "");
  if (apply2 && !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw fail("Ch\u1ECDn ng\xE0y kitting.");
  const exclude = new Set(Array.isArray(body == null ? void 0 : body.exclude) ? body.exclude : []);
  const hasPo = (sh) => sh.groups.some((g) => g.rows.some((r) => db.prepare("SELECT 1 FROM po WHERE po_key = ?").get(normalizePo(r.po))));
  const autoOff = new Set(Array.isArray(body == null ? void 0 : body.skipSheets) ? [] : parsed.filter((sh) => sh.kind && !hasPo(sh)).map((sh) => sh.name));
  const skipSheets = new Set(Array.isArray(body == null ? void 0 : body.skipSheets) ? body.skipSheets : [...autoOff]);
  const maxQty = Number(getSettings(db).merge_max_qty) || 2500;
  const lines = new Set(db.prepare("SELECT name FROM lines WHERE active = 1").all().map((r) => r.name));
  const poOf = db.prepare("SELECT * FROM po WHERE po_key = ?"), kitOf = db.prepare("SELECT k.* FROM kit_order_po x JOIN kit_order k ON k.id = x.kit_id WHERE x.po_key = ?");
  const kitPoKeys = (id) => db.prepare("SELECT po_key FROM kit_order_po WHERE kit_id = ?").all(id).map((r) => r.po_key);
  const printed = printedCodes(db), locked = (k) => k.vln_status !== "pending" || k.hv_status !== "pending" || printed.has(k.code);
  const seen = /* @__PURE__ */ new Map();
  const plan = [];
  for (const sh of parsed) {
    const sheetOn = !!sh.kind && !skipSheets.has(sh.name);
    for (const g of sh.groups) {
      const gid = `${sh.name}${g.key}`, on = sheetOn && !exclude.has(gid);
      const items2 = [], warn = [];
      for (const r of g.rows) {
        const key2 = normalizePo(r.po), p = poOf.get(key2), k = p ? kitOf.get(key2) : null;
        const it = { row: r.row, po: r.po, raw: r.raw, split: r.split, code: r.code, qty: r.qty, key: key2, status: "ok", note: "" };
        if (!p) {
          it.status = "missing";
          it.note = "Kh\xF4ng c\xF3 trong MM";
        } else {
          it.planQty = p.plan_qty;
          it.mmCode = p.model_code;
          it.model = modelOf(db, p.model_code, p.basic_model);
          it.kit = k ? { id: k.id, code: k.code, day: k.plan_day, kind: k.kind } : null;
          if (isCancelled(p)) {
            it.status = "cancel";
            it.note = "PO \u0111\xE3 h\u1EE7y";
          } else if (k && locked(k)) {
            it.status = "locked";
            it.note = k.vln_status === "delivered" ? `\u0110\xE3 giao ${k.line || ""}`.trim() : k.vln_status === "pending" && k.hv_status === "pending" ? `${k.code} Kho \u0111\xE3 in phi\u1EBFu` : `${k.code} Kho \u0111\xE3 b\u1EAFt \u0111\u1EA7u kitting`;
            it.kit.delivered = k.vln_status === "delivered";
          } else if (seen.has(key2) && seen.get(key2) !== gid) {
            it.status = "dup";
            it.note = "PO \u0111\xE3 c\xF3 \u1EDF nh\xF3m tr\u01B0\u1EDBc";
          }
          if (r.code && r.code !== p.model_code) warn.push(`${r.po}: Code file ${r.code} \u2260 MM ${p.model_code}`);
          if (r.qty && Math.abs(r.qty - p.plan_qty) > 1e-6) it.note = [it.note, `SL file ${fmtN2(r.qty)} \u2260 PO ${fmtN2(p.plan_qty)}${r.split ? " (d\xF2ng t\xE1ch, l\u1EA5y c\u1EA3 PO)" : ""}`].filter(Boolean).join(" \xB7 ");
        }
        if (on && it.status === "ok") seen.set(key2, gid);
        items2.push(it);
      }
      const ok = items2.filter((i) => i.status === "ok"), models = [...new Set(ok.map((i) => i.model))];
      const total = ok.reduce((s, i) => s + i.planQty, 0);
      let action = !on ? "off" : !ok.length ? "none" : models.length > 1 ? "error" : ok.length === 1 ? "single" : "merge";
      if (models.length > 1) warn.push(`Kh\xE1c Model trong 1 nh\xF3m: ${models.join(", ")} \u2014 b\u1ECF nh\xF3m`);
      if (action === "single" || action === "merge") {
        const kits = [...new Set(ok.map((i) => {
          var _a;
          return (_a = i.kit) == null ? void 0 : _a.id;
        }).filter(Boolean))];
        if (kits.length === 1 && ok.every((i) => i.kit) && kitPoKeys(kits[0]).sort().join() === ok.map((i) => i.key).sort().join()) action = "keep";
      }
      if (ok.length > 1 && total > maxQty) warn.push(`T\u1ED5ng ${fmtN2(total)} ea v\u01B0\u1EE3t gi\u1EDBi h\u1EA1n g\u1ED9p ${fmtN2(maxQty)} \u2014 v\u1EABn g\u1ED9p theo file`);
      if (g.line && !lines.has(g.line)) warn.push(`${g.line} kh\xF4ng c\xF3 trong danh s\xE1ch Line \u2014 b\u1ECF Line d\u1EF1 ki\u1EBFn`);
      plan.push({ id: gid, sheet: sh.name, kind: sh.kind, key: g.key, model: models[0] || g.model, line: g.line && lines.has(g.line) ? g.line : "", fileLine: g.line, items: items2, total, action, warn, on });
    }
  }
  const sum = {
    groups: plan.filter((p) => p.on).length,
    kits: plan.filter((p) => ["single", "merge", "keep"].includes(p.action)).length,
    merge: plan.filter((p) => p.action === "merge").length,
    single: plan.filter((p) => p.action === "single").length,
    keep: plan.filter((p) => p.action === "keep").length,
    pos: plan.filter((p) => p.on).reduce((s, p) => s + p.items.filter((i) => i.status === "ok").length, 0),
    locked: plan.filter((p) => p.on).reduce((s, p) => s + p.items.filter((i) => i.status === "locked").length, 0),
    missing: plan.filter((p) => p.on).reduce((s, p) => s + p.items.filter((i) => i.status === "missing").length, 0),
    errors: plan.filter((p) => p.action === "error").length,
    internal: parsed.reduce((s, x) => s + x.skipped.length, 0)
  };
  const preview = {
    ok: true,
    fileName: (body == null ? void 0 : body.fileName) || "",
    day,
    suggestedDay: suggested,
    maxQty,
    sheets: parsed.map((s) => ({ name: s.name, kind: s.kind, label: s.label || "", groups: s.groups.length, skipped: s.skipped, on: !!s.kind && !skipSheets.has(s.name), autoOff: autoOff.has(s.name) })),
    skipSheets: [...skipSheets],
    groups: plan,
    sum
  };
  if (!apply2) return preview;
  const todo = plan.filter((p) => ["single", "merge", "keep"].includes(p.action));
  if (!todo.length && !plan.some((p) => p.on && p.line && p.items.some((i) => {
    var _a;
    return i.status === "locked" && !((_a = i.kit) == null ? void 0 : _a.delivered);
  }))) throw fail("Kh\xF4ng c\xF3 nh\xF3m n\xE0o \u0111\u1EC3 nh\u1EADp.");
  const touched = /* @__PURE__ */ new Set(), placed = [];
  const delKit = (id) => {
    db.prepare("DELETE FROM kit_item WHERE kit_id = ?").run(id);
    db.prepare("DELETE FROM kit_order_po WHERE kit_id = ?").run(id);
    db.prepare("DELETE FROM kit_order WHERE id = ?").run(id);
  };
  for (const g of todo) {
    const ok = g.items.filter((i) => i.status === "ok");
    if (g.action === "keep") {
      const id2 = ok[0].kit.id;
      db.prepare("UPDATE kit_order SET plan_day = ?, plan_line = ?, updated_at = datetime('now') WHERE id = ?").run(day, g.line || null, id2);
      placed.push(id2);
      continue;
    }
    for (const i of ok) if (i.kit) {
      db.prepare("DELETE FROM kit_order_po WHERE kit_id = ? AND po_key = ?").run(i.kit.id, i.key);
      db.prepare("DELETE FROM kit_item WHERE kit_id = ?").run(i.kit.id);
      touched.add(i.kit.id);
    }
    const pos = ok.map((i) => poOf.get(i.key)).sort((a, b) => String(a.plan_start || "").localeCompare(String(b.plan_start || "")) || String(a.po_no).localeCompare(String(b.po_no)));
    for (const p of pos) {
      const old = db.prepare("SELECT id FROM kit_order WHERE code = ?").get(p.po_no);
      if (old && !kitPoKeys(old.id).length) {
        delKit(old.id);
        touched.delete(old.id);
      }
    }
    const merged = pos.length > 1, code = merged ? nextMergedCode(db) : pos[0].po_no;
    if (!merged && db.prepare("SELECT 1 FROM kit_order WHERE code = ?").get(code)) throw fail(`M\xE3 Kit ${code} \u0111ang \u0111\u01B0\u1EE3c d\xF9ng, kh\xF4ng t\u1EA1o \u0111\u01B0\u1EE3c.`);
    const res = db.prepare(`INSERT INTO kit_order(code, kind, model_code, plan_day, seq, plan_line, created_by) VALUES (?, ?, ?, ?, 0, ?, ?)`).run(code, merged ? "merged" : "single", pos[0].model_code, day, g.line || null, username);
    const id = Number(res.lastInsertRowid);
    for (const p of pos) db.prepare("INSERT INTO kit_order_po(kit_id, po_key) VALUES (?, ?)").run(id, p.po_key);
    placed.push(id);
    g.newCode = code;
  }
  for (const id of touched) {
    let k = db.prepare("SELECT * FROM kit_order WHERE id = ?").get(id);
    if (!k) continue;
    dropOrphanLoads(db, id);
    k = db.prepare("SELECT * FROM kit_order WHERE id = ?").get(id);
    if (!k) continue;
    const keys = kitPoKeys(id);
    if (!keys.length) {
      delKit(id);
      continue;
    }
    if (keys.length === 1 && k.kind === "merged") {
      const p = poOf.get(keys[0]);
      delKit(id);
      if (!db.prepare("SELECT 1 FROM kit_order WHERE code = ?").get(p.po_no)) {
        const r = db.prepare("INSERT INTO kit_order(code, kind, model_code, plan_day, seq, plan_line, created_by) VALUES (?, 'single', ?, ?, ?, ?, ?)").run(p.po_no, p.model_code, k.plan_day, k.seq, k.plan_line, username);
        db.prepare("INSERT INTO kit_order_po(kit_id, po_key) VALUES (?, ?)").run(r.lastInsertRowid, p.po_key);
      }
    }
  }
  let lineOnly = 0;
  for (const g of plan.filter((p) => p.on && p.line)) for (const i of g.items.filter((i2) => {
    var _a;
    return i2.status === "locked" && !((_a = i2.kit) == null ? void 0 : _a.delivered);
  })) {
    db.prepare("UPDATE kit_order SET plan_line = ?, updated_at = datetime('now') WHERE id = ? AND vln_status <> 'delivered'").run(g.line, i.kit.id);
    lineOnly++;
  }
  const rest = db.prepare("SELECT id FROM kit_order WHERE plan_day = ? ORDER BY seq, id").all(day).map((r) => r.id).filter((id) => !placed.includes(id));
  [...new Set(placed), ...rest].forEach((id, i) => db.prepare("UPDATE kit_order SET seq = ? WHERE id = ?").run(i, id));
  audit(db, username, "plan.import", { file: (body == null ? void 0 : body.fileName) || "", day, kits: placed.length, merge: sum.merge, single: sum.single, keep: sum.keep, lineOnly, pos: sum.pos });
  return {
    ok: true,
    day,
    kits: placed.length,
    lineOnly,
    message: `\u0110\xE3 nh\u1EADp k\u1EBF ho\u1EA1ch ${day.slice(8, 10)}/${day.slice(5, 7)}: ${placed.length} Kit (${sum.merge} g\u1ED9p \xB7 ${sum.single} PO \u0111\u01A1n \xB7 ${sum.keep} gi\u1EEF nguy\xEAn)${lineOnly ? ` \xB7 ghi Line d\u1EF1 ki\u1EBFn cho ${lineOnly} PO \u0111\xE3 kitting` : ""}${sum.locked ? ` \xB7 ${sum.locked} PO \u0111\xE3 kitting gi\u1EEF nguy\xEAn` : ""}`
  };
}
function importScope(db, preview) {
  const keys = /* @__PURE__ */ new Set(), days = /* @__PURE__ */ new Set([preview.day]);
  for (const g of preview.groups) for (const i of g.items) if (i.status === "ok") {
    keys.add(i.key);
    if (i.kit) {
      if (i.kit.day) days.add(i.kit.day);
      db.prepare("SELECT po_key FROM kit_order_po WHERE kit_id = ?").all(i.kit.id).forEach((r) => keys.add(r.po_key));
    }
  }
  return { pos: [...keys], core: [...keys], days: [...days].filter(Boolean) };
}

// ../kitting-app/lib/plan-routes.mjs
var PLAN2 = ["planner", "admin"];
function planRoutes(db) {
  const undoable = (label, scope, fn, user) => tx(db, () => withUndo(db, user.username, label, scope, fn));
  return [
    { method: "GET", path: "/api/board", handler: ({ query, user }) => __spreadProps(__spreadValues({}, board(db, { from: query.get("from"), days: query.get("days") })), { undo: lastUndo(db, user.username) }) },
    { method: "POST", path: "/api/board/apply", roles: PLAN2, handler: ({ body, user }) => {
      const cols = (body == null ? void 0 : body.columns) || [];
      const scope = scopeOf(db, cols.flatMap((c) => c.items || []), cols.map((c) => c.day));
      return undoable("K\xE9o th\u1EA3 k\u1EBF ho\u1EA1ch", scope, () => applyColumns(db, cols, user.username), user);
    } },
    { method: "POST", path: "/api/board/batch", roles: PLAN2, handler: ({ body, user }) => {
      var _a;
      const day = (_a = body == null ? void 0 : body.day) != null ? _a : null, scope = scopeOf(db, (body == null ? void 0 : body.items) || [], [day]);
      return undoable(day ? `Chuy\u1EC3n ${body.items.length} th\u1EBB sang ${day.slice(8, 10)}/${day.slice(5, 7)}` : `B\u1ECF k\u1EBF ho\u1EA1ch ${body.items.length} th\u1EBB`, scope, () => batchMove(db, { items: body.items, day, position: body.position }, user.username), user);
    } },
    { method: "POST", path: "/api/board/merge", roles: PLAN2, handler: ({ body, user }) => {
      const scope = scopeOf(db, (body == null ? void 0 : body.items) || []);
      return undoable("G\u1ED9p PO", scope, () => merge(db, body == null ? void 0 : body.items, user.username), user);
    } },
    { method: "POST", path: "/api/board/split", roles: PLAN2, handler: ({ body, user }) => {
      const scope = scopeOf(db, [{ type: "kit", id: body == null ? void 0 : body.id }]);
      return undoable("T\xE1ch Kit PO", scope, () => split(db, body == null ? void 0 : body.id, user.username), user);
    } },
    { method: "POST", path: "/api/board/auto", roles: PLAN2, handler: ({ body, user }) => {
      if (body == null ? void 0 : body.dry) return autoPlan(db, body.opts || {});
      const sc = autoScopeItems(autoPlan(db, (body == null ? void 0 : body.opts) || {})), scope = scopeOf(db, sc.items, sc.days);
      return undoable("T\u1EF1 \u0111\u1ED9ng x\u1EBFp PO", scope, () => autoApply(db, (body == null ? void 0 : body.opts) || {}, user.username), user);
    } },
    // Nhập kế hoạch kitting từ Excel của Planner (gộp theo Line + Model hoặc theo BOM Number); dry = xem trước
    { method: "POST", path: "/api/board/import", roles: PLAN2, handler: ({ body, user }) => {
      if (body == null ? void 0 : body.dry) return planImport(db, body, user.username, false);
      const pv = planImport(db, body, user.username, false);
      return undoable(`Nh\u1EADp KH ${pv.fileName || "Excel"}`.slice(0, 80), importScope(db, pv), () => planImport(db, body, user.username, true), user);
    } },
    { method: "POST", path: "/api/board/undo", roles: PLAN2, handler: ({ user }) => undo(db, user.username) },
    { method: "GET", path: "/api/lines/week", handler: ({ query }) => getWeek(db, query.get("start"), query.get("shift")) },
    { method: "POST", path: "/api/lines/week", roles: PLAN2, handler: ({ body, user }) => {
      assertLineEditable(db);
      return saveWeek(db, body || {}, user.username);
    } },
    { method: "POST", path: "/api/lines/week/copy", roles: PLAN2, handler: ({ body, user }) => {
      assertLineEditable(db);
      return copyWeek(db, body || {}, user.username);
    } },
    { method: "POST", path: "/api/lines/manage", roles: PLAN2, handler: ({ body, user }) => manageLine(db, body || {}, user.username) }
  ];
}

// ../kitting-app/lib/receipt.mjs
var RECEIPT_REASONS = { SHORT: "Thi\u1EBFu s\u1ED1 l\u01B0\u1EE3ng so v\u1EDBi phi\u1EBFu", OVER: "Th\u1EEBa s\u1ED1 l\u01B0\u1EE3ng so v\u1EDBi phi\u1EBFu", WRONG: "Sai m\xE3 / l\u1EABn v\u1EADt li\u1EC7u", DAMAGED: "V\u1EADt li\u1EC7u l\u1ED7i / h\u1ECFng", NO_REAR: "Thi\u1EBFu Rear", OTHER: "Kh\xE1c" };
var RECEIPT_STATUS = { pending: "Ch\u1EDD nh\u1EADn", received: "\u0110\xE3 nh\u1EADn", rejected: "T\u1EEB ch\u1ED1i" };
var INT_STATES = { waiting: "Ch\u1EDD SX", running: "\u0110ang SX", done: "Ho\xE0n th\xE0nh" };
var r35 = (n) => Math.round(Number(n) * 1e3) / 1e3;
var t2 = (v) => String(v != null ? v : "").trim();
function ensureReceiptSchema(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS kit_receipt (
    kit_id INTEGER PRIMARY KEY, kit_code TEXT NOT NULL, line TEXT, status TEXT NOT NULL DEFAULT 'pending',
    signer TEXT, signer_name TEXT, at TEXT, reason TEXT, note TEXT, snapshot TEXT,
    kho_note TEXT, kho_by TEXT, kho_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS kit_receipt_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kit_id INTEGER NOT NULL, kit_code TEXT NOT NULL, line TEXT, action TEXT NOT NULL,
    signer TEXT, username TEXT, reason TEXT, note TEXT, snapshot TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE INDEX IF NOT EXISTS kit_receipt_log_kit ON kit_receipt_log(kit_id);
  CREATE INDEX IF NOT EXISTS kit_receipt_status ON kit_receipt(status);`);
  if (!db.prepare("SELECT name FROM pragma_table_info('po')").all().some((c) => c.name === "int_status")) db.exec("ALTER TABLE po ADD COLUMN int_status TEXT");
  ensureLotSchema(db);
}
var kitPos2 = (db, kitId) => db.prepare("SELECT p.* FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = ? ORDER BY p.po_no").all(kitId);
var kitOpen = (pos) => pos.some((p) => !["done", "cancel"].includes(productionState(p)));
function loadDelivered(db, kitId) {
  const kit = db.prepare("SELECT * FROM kit_order WHERE id = ?").get(Number(kitId));
  if (!kit) throw fail("Kh\xF4ng t\xECm th\u1EA5y PO / Kit.", 404);
  if (kit.vln_status !== "delivered") throw fail(`${kit.code} ch\u01B0a \u0111\u01B0\u1EE3c Kho giao cho Line.`);
  return kit;
}
function receiptOf(db, kitId) {
  const r = db.prepare("SELECT * FROM kit_receipt WHERE kit_id = ?").get(Number(kitId));
  return r ? { status: r.status, signer: r.signer || "", signerName: r.signer_name || "", at: r.at || "", reason: r.reason || "", reasonText: RECEIPT_REASONS[r.reason] || "", note: r.note || "", khoNote: r.kho_note || "", khoBy: r.kho_by || "", khoAt: r.kho_at || "" } : { status: "pending", signer: "", signerName: "", at: "", reason: "", reasonText: "", note: "", khoNote: "", khoBy: "", khoAt: "" };
}
var scanKey = (v) => normalizePo(v).replace(/^0+(?=\d)/, "");
function scanMatches(kit, pos, scanned) {
  const s = scanKey(scanned);
  return !!s && [kit.code, ...pos.map((p) => p.po_no)].some((c) => scanKey(c) === s);
}
function itemsOf(db, kitId) {
  return db.prepare(`SELECT grp, kit_group, model_code, material, description, required, delivered FROM kit_item WHERE kit_id = ?
    ORDER BY CASE kit_group WHEN 'REAR' THEN 0 WHEN 'VLDT' THEN 1 ELSE 2 END, model_code, material`).all(kitId).map((i) => ({ grp: i.grp, group: i.kit_group, code: i.model_code, material: i.material, description: i.description || "", required: r35(i.required), delivered: r35(i.delivered), debt: r35(Math.max(0, i.required - i.delivered)) }));
}
var snapOf = (list) => JSON.stringify(list.map((i) => [i.group, i.code, i.material, i.required, i.delivered, i.debt]));
function receiptView(db, kitId) {
  var _a;
  const kit = loadDelivered(db, kitId), pos = kitPos2(db, kit.id);
  ensureReceiptSchema(db);
  const st = lotStats(db, kit.id), list = itemsOf(db, kit.id).map((i) => {
    const s = st.get(lotKey(i.grp, i.code, i.material));
    const bu = (s == null ? void 0 : s.bu) || 0;
    return __spreadProps(__spreadValues({}, i), { initial: r35(Math.max(0, i.delivered - bu)), bu, buN: (s == null ? void 0 : s.n) || 0 });
  });
  const lots = lotsOfKit(db, kit.id);
  const log = db.prepare("SELECT * FROM kit_receipt_log WHERE kit_id = ? ORDER BY id DESC LIMIT 20").all(kit.id).map((l) => ({ action: l.action, signer: l.signer || "", by: l.username || "", reason: RECEIPT_REASONS[l.reason] || "", note: l.note || "", at: l.created_at }));
  return {
    kit: {
      id: kit.id,
      code: kit.code,
      kind: kit.kind,
      line: kit.line,
      deliveredAt: kit.delivered_at,
      deliveredBy: kit.delivered_by || "",
      model: modelOf(db, kit.model_code, (_a = pos[0]) == null ? void 0 : _a.basic_model),
      pos: pos.map((p) => ({ po: p.po_no, modelCode: p.model_code, qty: p.plan_qty, type: p.po_type || "SAP" })),
      qty: pos.reduce((s, p) => s + p.plan_qty, 0),
      loadTp: pos.filter((p) => p.po_type === "LOAD" && !isCancelled(p)).map((p) => ({ po: p.po_no, modelCode: p.model_code, qty: -p.plan_qty, ref: p.ref_doc || "" }))
    },
    receipt: receiptOf(db, kit.id),
    open: kitOpen(pos),
    items: list,
    lots,
    lotStatus: LOT_STATUS,
    totals: { bu: r35(list.reduce((s, i) => s + i.bu, 0)), lotsPending: lots.filter((l) => l.status === "pending").length, lotsRejected: lots.filter((l) => l.status === "rejected").length, items: list.length, required: r35(list.reduce((s, i) => s + i.required, 0)), delivered: r35(list.reduce((s, i) => s + i.delivered, 0)), debtItems: list.filter((i) => i.debt > 0).length, debt: r35(list.reduce((s, i) => s + i.debt, 0)), rearDebt: list.filter((i) => i.group === "REAR" && i.debt > 0).length },
    reasons: RECEIPT_REASONS,
    log
  };
}
function checkReceive(db, { kitId, scanned }, action) {
  const kit = loadDelivered(db, kitId), pos = kitPos2(db, kit.id);
  if (!scanMatches(kit, pos, scanned)) throw fail(t2(scanned) ? `Sai PO: qu\xE9t \u0111\u01B0\u1EE3c "${t2(scanned)}", PO \u0111ang nh\u1EADn l\xE0 ${kit.code}.` : "Qu\xE9t QR tr\xEAn phi\u1EBFu kitting tr\u01B0\u1EDBc khi x\xE1c nh\u1EADn.");
  const cur = receiptOf(db, kit.id);
  if (cur.status === "received") throw fail(`${kit.code} \u0111\xE3 \u0111\u01B0\u1EE3c ${cur.signerName || cur.signer} x\xE1c nh\u1EADn nh\u1EADn l\xFAc ${cur.at}.`);
  if (action === "receive" && cur.status === "rejected") throw fail(`${kit.code} \u0111ang ch\u1EDD Kho x\u1EED l\xFD l\u1EA7n t\u1EEB ch\u1ED1i \u2014 Kho b\u1EA5m "\u0110\xE3 x\u1EED l\xFD" r\u1ED3i m\u1EDBi x\xE1c nh\u1EADn l\u1EA1i.`);
  if (action === "reject" && cur.status === "rejected") throw fail(`${kit.code} \u0111\xE3 t\u1EEB ch\u1ED1i, \u0111ang ch\u1EDD Kho x\u1EED l\xFD.`);
  return kit;
}
function writeReceipt(db, kit, { status, signer, reason = null, note = null }, username) {
  const list = itemsOf(db, kit.id), snap = snapOf(list);
  db.prepare(`INSERT INTO kit_receipt(kit_id, kit_code, line, status, signer, signer_name, at, reason, note, snapshot, kho_note, kho_by, kho_at, updated_at)
      VALUES (?,?,?,?,?,?,datetime('now'),?,?,?,NULL,NULL,NULL,datetime('now'))
    ON CONFLICT(kit_id) DO UPDATE SET kit_code = excluded.kit_code, line = excluded.line, status = excluded.status, signer = excluded.signer, signer_name = excluded.signer_name,
      at = excluded.at, reason = excluded.reason, note = excluded.note, snapshot = excluded.snapshot, updated_at = excluded.updated_at`).run(kit.id, kit.code, kit.line, status, signer.username, signer.name || signer.username, reason, note, snap);
  db.prepare("INSERT INTO kit_receipt_log(kit_id, kit_code, line, action, signer, username, reason, note, snapshot) VALUES (?,?,?,?,?,?,?,?,?)").run(kit.id, kit.code, kit.line, status === "received" ? "receive" : "reject", signer.username, username, reason, note, snap);
  audit(db, username, status === "received" ? "receipt.receive" : "receipt.reject", { kit: kit.code, line: kit.line, signer: signer.username, reason, note });
  return list;
}
function receiveKit(db, body, user, sign) {
  ensureReceiptSchema(db);
  const kit = checkReceive(db, body, "receive");
  const s = sign(body.signer, body.pin2, kit.line);
  if (!s.ok) return s;
  return tx(db, () => {
    const list = writeReceipt(db, kit, { status: "received", signer: s }, user);
    receivePendingLots(db, kit.id, s, user);
    const debt = list.filter((i) => i.debt > 0).length;
    return { ok: true, message: `${kit.code}: ${s.name || s.username} \u0111\xE3 x\xE1c nh\u1EADn nh\u1EADn${debt ? ` \xB7 Kho c\xF2n n\u1EE3 ${debt} m\xE3` : ""}.` };
  });
}
function rejectKit(db, body, user, sign) {
  ensureReceiptSchema(db);
  const reason = t2(body.reason), note = t2(body.note).slice(0, 300);
  if (!RECEIPT_REASONS[reason]) throw fail("Ch\u1ECDn l\xFD do t\u1EEB ch\u1ED1i.");
  if (reason === "OTHER" && !note) throw fail('L\xFD do "Kh\xE1c" c\u1EA7n ghi ch\xFA.');
  const kit = checkReceive(db, body, "reject");
  const s = sign(body.signer, body.pin2, kit.line);
  if (!s.ok) return s;
  return tx(db, () => {
    writeReceipt(db, kit, { status: "rejected", signer: s, reason, note }, user);
    return { ok: true, message: `${kit.code}: \u0111\xE3 t\u1EEB ch\u1ED1i nh\u1EADn (${RECEIPT_REASONS[reason]}) \u2014 \u0111\xE3 b\xE1o Kho ki\u1EC3m tra.` };
  });
}
function resolveReject(db, { kitId, note }, user) {
  ensureReceiptSchema(db);
  const kit = loadDelivered(db, kitId), cur = receiptOf(db, kit.id), n = t2(note).slice(0, 300);
  if (cur.status !== "rejected") throw fail(`${kit.code} kh\xF4ng \u1EDF tr\u1EA1ng th\xE1i Line t\u1EEB ch\u1ED1i.`);
  if (!n) throw fail("Ghi ch\xFA Kho \u0111\xE3 x\u1EED l\xFD g\xEC (VD: giao b\xF9 20 ea m\xE3 \u2026).");
  return tx(db, () => {
    db.prepare("UPDATE kit_receipt SET status = 'pending', kho_note = ?, kho_by = ?, kho_at = datetime('now'), updated_at = datetime('now') WHERE kit_id = ?").run(n, user, kit.id);
    db.prepare("INSERT INTO kit_receipt_log(kit_id, kit_code, line, action, username, note, snapshot) VALUES (?,?,?,?,?,?,?)").run(kit.id, kit.code, kit.line, "resolve", user, n, snapOf(itemsOf(db, kit.id)));
    audit(db, user, "receipt.resolve", { kit: kit.code, line: kit.line, note: n });
    return { ok: true, message: `${kit.code}: \u0111\xE3 b\xE1o Line ${kit.line} qu\xE9t x\xE1c nh\u1EADn l\u1EA1i.` };
  });
}
function khoReceipts(db) {
  ensureReceiptSchema(db);
  const rows = db.prepare(`SELECT r.*, k.delivered_at, k.model_code FROM kit_receipt r JOIN kit_order k ON k.id = r.kit_id WHERE r.status = 'rejected' AND k.vln_status = 'delivered' ORDER BY r.at`).all().map((r) => {
    var _a;
    const pos = kitPos2(db, r.kit_id), list = itemsOf(db, r.kit_id);
    return {
      kitId: r.kit_id,
      code: r.kit_code,
      line: r.line,
      model: modelOf(db, r.model_code, (_a = pos[0]) == null ? void 0 : _a.basic_model),
      pos: pos.map((p) => p.po_no),
      at: r.at,
      signer: r.signer,
      signerName: r.signer_name,
      reason: r.reason,
      reasonText: RECEIPT_REASONS[r.reason] || r.reason,
      note: r.note || "",
      deliveredAt: r.delivered_at,
      debtItems: list.filter((i) => i.debt > 0).length,
      debt: r35(list.reduce((s, i) => s + i.debt, 0))
    };
  });
  return { rows, pending: pendingCount(db), lots: rejectedLots(db), lotsPending: db.prepare("SELECT COUNT(*) n FROM kit_lot l JOIN kit_order k ON k.id = l.kit_id WHERE l.status = 'pending' AND k.vln_status = 'delivered'").get().n };
}
function pendingCount(db) {
  return db.prepare(`SELECT k.id FROM kit_order k LEFT JOIN kit_receipt r ON r.kit_id = k.id WHERE k.vln_status = 'delivered' AND COALESCE(r.status, 'pending') = 'pending'`).all().filter((k) => kitOpen(kitPos2(db, k.id))).length;
}
function receiptBadges(db) {
  ensureReceiptSchema(db);
  return { rejected: db.prepare("SELECT COUNT(*) n FROM kit_receipt r JOIN kit_order k ON k.id = r.kit_id WHERE r.status = 'rejected' AND k.vln_status = 'delivered'").get().n + db.prepare("SELECT COUNT(*) n FROM kit_lot l JOIN kit_order k ON k.id = l.kit_id WHERE l.status = 'rejected' AND k.vln_status = 'delivered'").get().n };
}
function setInternalStatus(db, body, user, sign) {
  ensureReceiptSchema(db);
  const status = t2(body.status), line = t2(body.line);
  if (!INT_STATES[status]) throw fail("Ch\u1ECDn tr\u1EA1ng th\xE1i: Ch\u1EDD SX, \u0110ang SX ho\u1EB7c Ho\xE0n th\xE0nh.");
  const list = [...new Set((Array.isArray(body.pos) ? body.pos : []).map(t2).filter(Boolean))];
  if (!list.length) throw fail("Ch\u1ECDn \xEDt nh\u1EA5t 1 PO n\u1ED9i b\u1ED9.");
  if (list.length > 100) throw fail("T\u1ED1i \u0111a 100 PO m\u1ED7i l\u1EA7n.");
  if (!line) throw fail("Ch\u1ECDn Line.");
  const rows = list.map((no) => {
    const p = db.prepare(`SELECT p.*, k.line AS kit_line, k.vln_status FROM po p LEFT JOIN kit_order_po x ON x.po_key = p.po_key LEFT JOIN kit_order k ON k.id = x.kit_id WHERE p.po_key = ?`).get(normalizePo(no));
    if (!p) throw fail(`Kh\xF4ng c\xF3 PO ${no}.`);
    if (!p.po_type || p.po_type === "SAP") throw fail(`${p.po_no} l\xE0 PO SAP \u2014 t\xECnh tr\u1EA1ng s\u1EA3n xu\u1EA5t c\u1EADp nh\u1EADt t\u1EEB h\u1EC7 th\u1ED1ng, kh\xF4ng chuy\u1EC3n tay.`);
    if (p.po_type === "LOAD") throw fail(`${p.po_no} l\xE0 PO Load th\xE0nh ph\u1EA9m \u2014 t\u1EF1 Ho\xE0n th\xE0nh khi PO th\u1EADt c\xF9ng Kit xong.`);
    if (isCancelled(p)) throw fail(`${p.po_no} \u0111\xE3 h\u1EE7y.`);
    if (p.vln_status !== "delivered" || p.kit_line !== line) throw fail(`${p.po_no} ch\u01B0a \u0111\u01B0\u1EE3c Kho giao cho ${line}.`);
    return p;
  });
  const s = sign(body.signer, body.pin2, line);
  if (!s.ok) return s;
  return tx(db, () => {
    const hist = db.prepare("INSERT INTO po_history(po_key, kind, changes) VALUES (?, 'prod', ?)");
    const upd = db.prepare("UPDATE po SET int_status = ?, production_qty = ?, remain_qty = ?, synced_at = datetime('now') WHERE po_key = ?");
    let n = 0;
    for (const p of rows) {
      const plan = Number(p.plan_qty) || 0, prod0 = Number(p.production_qty) || 0;
      const prod = status === "done" ? plan : status === "running" ? prod0 < plan ? prod0 : 0 : 0, remain = Math.max(0, plan - prod);
      const was = p.int_status || productionState(p);
      if (was === status && prod === prod0 && remain === Number(p.remain_qty)) continue;
      const diff = { int_status: [was, status] };
      if (prod !== prod0) diff.production_qty = [prod0, prod];
      if (remain !== Number(p.remain_qty)) diff.remain_qty = [Number(p.remain_qty), remain];
      upd.run(status, prod, remain, p.po_key);
      hist.run(p.po_key, JSON.stringify(__spreadProps(__spreadValues({}, diff), { _by: `${s.username} (k\xFD) \xB7 ${user}` })));
      n++;
    }
    audit(db, user, "po.internal.status", { line, status, pos: rows.map((p) => p.po_no), signer: s.username, changed: n });
    return { ok: true, updated: n, message: n ? `${s.name || s.username} x\xE1c nh\u1EADn ${n} PO n\u1ED9i b\u1ED9 \u2192 ${INT_STATES[status]}.` : `C\xE1c PO \u0111\xE3 \u1EDF tr\u1EA1ng th\xE1i ${INT_STATES[status]}.` };
  });
}
function receiptRoutes(db, sign) {
  const signer = sign || (() => ({ ok: false, message: "Ch\u01B0a c\u1EA5u h\xECnh x\xE1c nh\u1EADn Leader." }));
  return [
    { method: "GET", path: "/api/prod/receipt", handler: ({ query }) => receiptView(db, query.get("kitId")) },
    { method: "POST", path: "/api/prod/receipt/receive", handler: ({ body, user }) => receiveKit(db, body || {}, user.username, signer) },
    { method: "POST", path: "/api/prod/receipt/reject", handler: ({ body, user }) => rejectKit(db, body || {}, user.username, signer) },
    { method: "POST", path: "/api/prod/internal-status", handler: ({ body, user }) => setInternalStatus(db, body || {}, user.username, signer) },
    { method: "GET", path: "/api/kho/receipts", handler: () => khoReceipts(db) },
    { method: "POST", path: "/api/kho/receipt/resolve", handler: ({ body, user }) => resolveReject(db, body || {}, user.username) },
    // Giao bù theo đợt: Line ký nhận / từ chối; Kho xử lý lần từ chối; OP kho soạn bù
    { method: "GET", path: "/api/prod/lots", handler: ({ query }) => lotsForLine(db, query.get("line") || "") },
    { method: "POST", path: "/api/prod/lots/receive", handler: ({ body, user }) => receiveLots(db, body || {}, user.username, signer, RECEIPT_REASONS) },
    { method: "POST", path: "/api/kho/lot/resolve", handler: ({ body, user }) => resolveLot(db, body || {}, user.username) },
    { method: "GET", path: "/api/kho/bu", handler: () => buList(db) },
    { method: "GET", path: "/api/kho/bu/kit", handler: ({ query }) => buDetail(db, query.get("id")) },
    { method: "POST", path: "/api/kho/bu", handler: ({ body, user }) => saveBu(db, body || {}, user.username) }
  ];
}

// ../kitting-app/lib/report.mjs
var r1 = (n) => Math.round(n * 10) / 10;
var utcStart = (day) => (/* @__PURE__ */ new Date(`${day}T00:00:00+07:00`)).toISOString().replace("T", " ").slice(0, 19);
var hoursBetween = (a, b) => (/* @__PURE__ */ new Date(b.replace(" ", "T") + "Z") - /* @__PURE__ */ new Date(a.replace(" ", "T") + "Z")) / 36e5;
function stage(k) {
  if (k.vln_status === "delivered") return "delivered";
  if (k.vln_status === "done" && k.hv_status === "done") return "ready";
  if (k.vln_status !== "pending" || k.hv_status !== "pending") return "progress";
  return "pending";
}
function kitInfo(db, k) {
  var _a;
  const pos = db.prepare("SELECT p.* FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = ?").all(k.id);
  return { pos, model: modelOf(db, k.model_code, (_a = pos[0]) == null ? void 0 : _a.basic_model), qty: pos.reduce((s, p) => s + p.plan_qty, 0), remain: pos.reduce((s, p) => s + p.remain_qty, 0) };
}
function debtOf(db, kitId) {
  const r = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(required - delivered), 0) ea FROM kit_item WHERE kit_id = ? AND delivered < required").get(kitId);
  return { items: r.n, ea: r.ea };
}
function kittingReport(db, { from, to }) {
  to = to || todayKey();
  from = from || addDays(to, -6);
  const today = todayKey();
  const kits = db.prepare("SELECT * FROM kit_order WHERE plan_day BETWEEN ? AND ? ORDER BY plan_day, seq").all(from, to).map((k) => __spreadProps(__spreadValues(__spreadValues({}, k), kitInfo(db, k)), { stage: stage(k) }));
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const byDay = days.map((day) => {
    const list = kits.filter((k) => k.plan_day === day), c = (s) => list.filter((k) => k.stage === s).length;
    return { day, total: list.length, qty: list.reduce((s, k) => s + k.qty, 0), pending: c("pending"), progress: c("progress"), ready: c("ready"), delivered: c("delivered") };
  });
  const models = /* @__PURE__ */ new Map();
  for (const k of kits) {
    const m = models.get(k.model) || { model: k.model, planned: 0, qty: 0, vlnDone: 0, hvDone: 0, ready: 0, delivered: 0, debtItems: 0 };
    m.planned++;
    m.qty += k.qty;
    if (["done", "delivered"].includes(k.vln_status)) m.vlnDone++;
    if (["done", "delivered"].includes(k.hv_status)) m.hvDone++;
    if (k.stage === "ready") m.ready++;
    if (k.stage === "delivered") {
      m.delivered++;
      m.debtItems += debtOf(db, k.id).items;
    }
    models.set(k.model, m);
  }
  const due = kits.filter((k) => k.plan_day <= today), dueDone = due.filter((k) => ["ready", "delivered"].includes(k.stage));
  const delivered = kits.filter((k) => k.delivered_at);
  const lead = delivered.map((k) => hoursBetween(k.created_at, k.delivered_at)).filter((h) => h >= 0);
  const merged = kits.filter((k) => k.kind === "merged");
  const debtKits2 = delivered.map((k) => ({ k, d: debtOf(db, k.id) })).filter((x) => x.d.items);
  return {
    from,
    to,
    byDay,
    byModel: [...models.values()].sort((a, b) => b.planned - a.planned),
    kpi: {
      planned: kits.length,
      plannedQty: kits.reduce((s, k) => s + k.qty, 0),
      kitted: kits.filter((k) => ["ready", "delivered"].includes(k.stage)).length,
      delivered: delivered.length,
      due: due.length,
      onPlan: due.length ? Math.round(dueDone.length / due.length * 100) : null,
      leadHours: lead.length ? r1(lead.reduce((a, b) => a + b, 0) / lead.length) : null,
      merged: merged.length,
      bomSaved: merged.reduce((s, k) => s + k.pos.length - 1, 0),
      debtKits: debtKits2.length,
      debtEa: debtKits2.reduce((s, x) => s + x.d.ea, 0)
    },
    rows: kits.map((k) => ({
      day: k.plan_day,
      code: k.code,
      kind: k.kind,
      pos: k.pos.length,
      model: k.model,
      modelCode: k.model_code,
      qty: k.qty,
      remain: k.remain,
      vln: k.vln_status,
      hv: k.hv_status,
      stage: k.stage,
      line: k.line || "",
      deliveredAt: k.delivered_at || "",
      debt: k.stage === "delivered" ? debtOf(db, k.id).items : 0,
      state: k.pos.length ? k.pos.every((p) => productionState(p) === "done") ? "done" : k.pos.some((p) => productionState(p) !== "waiting") ? "running" : "waiting" : "waiting"
    }))
  };
}
function safetyReport(db, { day, shift }) {
  (() => {
    const c = currentShift(db);
    day = day || c.day;
    shift = shift || (day === c.day ? c.shift : shifts(db)[0]);
  })();
  const assign = new Map(db.prepare("SELECT line, model FROM line_assign WHERE work_date = ? AND shift = ?").all(day, shift).map((r) => [r.line, r.model]));
  const vln = vlnOverview(db, day, shift);
  const vByModel = new Map(vln.rows.map((r) => [r.model, r]));
  const board2 = new Map(lineBoard(db, day, shift).lines.map((l) => [l.line, l]));
  const lines = db.prepare("SELECT name FROM lines WHERE active = 1 ORDER BY sort_order, name").all().map((r) => r.name).map((line) => {
    var _a;
    const model = assign.get(line) || "", s = lineSupply(db, line, model), v = vByModel.get(model);
    const kits = db.prepare("SELECT id FROM kit_order WHERE line = ? AND vln_status = 'delivered'").all(line);
    const debt = kits.reduce((a, k) => a + debtOf(db, k.id).items, 0);
    const ready2 = ((_a = board2.get(line)) == null ? void 0 : _a.readyCount) || 0;
    const level = !model ? "idle" : !s.pass ? "ok" : ready2 ? "warn" : "bad";
    return __spreadProps(__spreadValues({ line, model }, s), { level, readyPo: ready2, waitingPo: v ? v.waiting : 0, minPo: v ? Math.round(v.min / Math.max(v.lines.length, 1)) : 0, maxPo: v ? Math.round(v.max / Math.max(v.lines.length, 1)) : 0, debt, runningPo: kits.length });
  });
  const run = lines.filter((l) => l.model);
  return {
    day,
    shift,
    shifts: shifts(db),
    threshold: Number(getSettings(db).supply_threshold),
    lines,
    models: vln.rows,
    kpi: {
      safe: run.filter((l) => l.level === "ok").length,
      warn: run.filter((l) => l.level === "warn").length,
      bad: run.filter((l) => l.level === "bad").length,
      shortModels: vln.rows.filter((r) => r.waiting < r.min).length,
      debtLines: run.filter((l) => l.debt).length,
      running: run.length
    }
  };
}
function exceptionReport(db, { from, to }) {
  to = to || todayKey();
  from = from || addDays(to, -6);
  const a = utcStart(from), b = utcStart(addDays(to, 1));
  const reqs = db.prepare("SELECT * FROM material_request WHERE created_at >= ? AND created_at < ? ORDER BY id DESC").all(a, b);
  const txn = db.prepare("SELECT * FROM kit_txn WHERE created_at >= ? AND created_at < ? AND type IN ('transfer_out','return','recall')").all(a, b);
  const byReason = Object.entries(REASONS).map(([code, label]) => {
    const l = txn.filter((t4) => t4.reason_code === code);
    return { label, lines: l.length, ea: l.reduce((s, t4) => s + t4.qty, 0) };
  }).filter((r) => r.lines);
  const c = (s) => reqs.filter((r) => r.status === s).length;
  return {
    from,
    to,
    kpi: {
      requests: reqs.length,
      auto: reqs.filter((r) => r.pass).length,
      exceptions: reqs.filter((r) => !r.pass).length,
      approved: reqs.filter((r) => !r.pass && ["approved", "issued"].includes(r.status)).length,
      rejected: c("rejected"),
      pending: c("pending_approval"),
      issuedEa: reqs.filter((r) => r.status === "issued").reduce((s, r) => s + (r.issued_qty || 0), 0),
      adjustments: txn.length
    },
    exceptions: reqs.filter((r) => !r.pass),
    byReason,
    byLine: [...new Set(reqs.map((r) => r.line))].map((line) => {
      const l = reqs.filter((r) => r.line === line);
      return { line, total: l.length, exceptions: l.filter((r) => !r.pass).length, issuedEa: l.filter((r) => r.status === "issued").reduce((s, r) => s + (r.issued_qty || 0), 0) };
    })
  };
}
function badges(db) {
  const n = (sql) => db.prepare(sql).get().n;
  return {
    pendingApproval: n("SELECT COUNT(*) n FROM material_request WHERE status = 'pending_approval'"),
    toIssue: n("SELECT COUNT(*) n FROM material_request WHERE status = 'approved'"),
    ready: n("SELECT COUNT(*) n FROM kit_order WHERE vln_status = 'done' AND hv_status = 'done'"),
    toKit: n("SELECT COUNT(*) n FROM kit_order WHERE plan_day IS NOT NULL AND plan_day <= date('now', '+7 hours') AND vln_status IN ('pending','progress')"),
    debts: n("SELECT COUNT(DISTINCT kit_id) n FROM kit_item i JOIN kit_order k ON k.id = i.kit_id WHERE k.vln_status = 'delivered' AND i.delivered < i.required"),
    receiptRejected: receiptBadges(db).rejected
    // Line từ chối nhận PO, chờ Kho xử lý
  };
}

// ../kitting-app/lib/prod.mjs
var r12 = (n) => Math.round(n * 10) / 10;
var addHours = (vnTime, h) => new Date(Date.parse(`${vnTime}:00Z`) + h * 36e5).toISOString().slice(0, 16);
var pct = (a, b) => b > 0 ? Math.min(100, Math.round(a / b * 100)) : 0;
function assignMap2(db, day, shift) {
  return new Map(db.prepare("SELECT line, model FROM line_assign WHERE work_date = ? AND shift = ?").all(day, shift).map((r) => [r.line, r.model]));
}
function uphOf(db, line, model) {
  var _a;
  return model ? Number((_a = db.prepare("SELECT uph FROM line_params WHERE line = ? AND model = ?").get(line, model)) == null ? void 0 : _a.uph) || 0 : 0;
}
function readyByModel(db) {
  const m = /* @__PURE__ */ new Map(), rk = ranks(db);
  for (const k of db.prepare("SELECT * FROM kit_order WHERE vln_status = 'done' AND hv_status = 'done'").all()) {
    if (!deliverable(db, k).ok) continue;
    const h = kitHeader(db, k, rk.get(k.id)), key2 = h.fixedLine ? `${h.model}${h.fixedLine}` : h.model;
    m.set(key2, (m.get(key2) || 0) + 1);
  }
  return m;
}
function lineSummary(db, line, model, ready2, now) {
  const s = lineSupply(db, line, model), uph = uphOf(db, line, model), readyCount = model ? (ready2.get(model) || 0) + (ready2.get(`${model}${line}`) || 0) : 0;
  const hoursLeft = uph ? r12(s.remainSum / uph) : null;
  const needPoIn = uph ? s.pass ? 0 : r12((s.available - s.threshold) / uph) : null;
  const level = !model ? "idle" : !s.pass ? needPoIn !== null && needPoIn < 1 && !readyCount ? "warn" : "ok" : readyCount ? "warn" : "bad";
  return { line, model, supply: s, uph, hoursLeft, endAt: hoursLeft !== null ? addHours(now, hoursLeft) : "", needPoIn, needPoAt: needPoIn !== null ? addHours(now, needPoIn) : "", readyCount, level };
}
function upcomingKits(db, model, rk = ranks(db), now = nowVN()) {
  if (!model) return [];
  return db.prepare("SELECT * FROM kit_order WHERE plan_day IS NOT NULL AND vln_status <> 'delivered' ORDER BY plan_day, seq, id").all().map((k) => ({ k, h: kitHeader(db, k, rk.get(k.id)) })).filter((x) => x.h.model === model).map(({ k, h }) => {
    const sum = (grp) => db.prepare("SELECT COALESCE(SUM(kitted),0) a, COALESCE(SUM(required),0) b, COUNT(*) n FROM kit_item WHERE kit_id = ? AND grp = ?").get(k.id, grp);
    const v = sum("VLN"), r = sum("HV");
    const start = db.prepare("SELECT MIN(p.plan_start) s FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = ?").get(k.id).s || "";
    const chk = deliverable(db, k);
    const stage2 = k.vln_status === "done" && k.hv_status === "done" ? chk.ok ? "ready" : "blocked" : k.vln_status !== "pending" || k.hv_status !== "pending" ? "progress" : "pending";
    return {
      id: k.id,
      code: k.code,
      kind: k.kind,
      codes: h.codes,
      pos: h.pos.map((p) => p.po),
      notes: h.notes,
      qty: h.qty,
      rank: h.rank,
      mrank: h.mrank,
      behind: h.behind,
      late: !!start && start < now,
      planDay: k.plan_day,
      planStart: start,
      stage: stage2,
      why: stage2 === "blocked" ? chk.why : "",
      vln: v.n ? pct(v.a, v.b) : 0,
      hv: r.n ? pct(r.a, r.b) : 0,
      vlnStatus: k.vln_status,
      hvStatus: k.hv_status,
      rearZero: chk.rearZero || [],
      planLine: k.plan_line || "",
      short: db.prepare("SELECT required, kitted FROM kit_item WHERE kit_id = ?").all(k.id).filter((i) => i.kitted < kitTarget(i.required) - 1e-9).length
    };
  }).sort((a, b) => ({ ready: 0, blocked: 1, progress: 2, pending: 3 })[a.stage] - { ready: 0, blocked: 1, progress: 2, pending: 3 }[b.stage] || (a.rank || 1e9) - (b.rank || 1e9)).filter((u, i) => i < 12 || u.behind);
}
function readyForLine(db, line) {
  if (!line) throw fail("Ch\u1ECDn Line.");
  const c = currentShift(db), model = assignMap2(db, c.day, c.shift).get(line) || "";
  const rk = ranks(db), rows = upcomingKits(db, model, rk).filter((u) => {
    const k = db.prepare("SELECT * FROM kit_order WHERE id = ?").get(u.id), h = kitHeader(db, k, rk.get(k.id));
    u.fixedLine = h.fixedLine || "";
    return !h.fixedLine || h.fixedLine === line;
  }).sort((a, b) => ({ ready: 0, blocked: 1, progress: 2, pending: 3 })[a.stage] - { ready: 0, blocked: 1, progress: 2, pending: 3 }[b.stage] || (b.planLine === line) - (a.planLine === line));
  return { line, model, rows, count: { ready: rows.filter((r) => r.stage === "ready").length, blocked: rows.filter((r) => r.stage === "blocked").length, progress: rows.filter((r) => r.stage === "progress").length, pending: rows.filter((r) => r.stage === "pending").length } };
}
function productionView(db, { line, day, shift } = {}) {
  var _a;
  (() => {
    const c = currentShift(db);
    day = day || c.day;
    shift = shift || (day === c.day ? c.shift : shifts(db)[0]);
  })();
  const now = nowVN(), assign = assignMap2(db, day, shift), ready2 = readyByModel(db), rk = ranks(db);
  const lines = db.prepare("SELECT name FROM lines WHERE active = 1 ORDER BY sort_order, name").all().map((r) => r.name);
  const overview = lines.map((l) => lineSummary(db, l, assign.get(l) || "", ready2, now));
  const kitStage = /* @__PURE__ */ new Map();
  for (const k of db.prepare("SELECT * FROM kit_order WHERE plan_day IS NOT NULL AND vln_status <> 'delivered'").all()) {
    const h = kitHeader(db, k, null), st = k.vln_status === "done" && k.hv_status === "done" ? "done" : k.vln_status !== "pending" || k.hv_status !== "pending" ? "progress" : "pending";
    const m = kitStage.get(h.model) || { done: 0, progress: 0, pending: 0 };
    m[st]++;
    kitStage.set(h.model, m);
  }
  for (const o of overview) {
    const run = db.prepare(`SELECT COALESCE(SUM(p.plan_qty),0) q, COALESCE(SUM(p.production_qty),0) d, COALESCE(SUM(CASE WHEN p.remain_qty > 0 THEN p.remain_qty ELSE 0 END),0) r, COUNT(DISTINCT k.id) n
      FROM kit_order k JOIN kit_order_po x ON x.kit_id = k.id JOIN po p ON p.po_key = x.po_key WHERE k.line = ? AND k.vln_status = 'delivered' AND p.remain_qty > 0 AND ${notCancelledSql("p.")}`).get(o.line);
    const debt = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(i.kit_group = 'REAR'),0) rear FROM kit_item i JOIN kit_order k ON k.id = i.kit_id WHERE k.line = ? AND k.vln_status = 'delivered' AND i.delivered < i.required").get(o.line);
    o.running = { count: run.n, qty: run.q, produced: run.d, progress: run.q ? Math.round(run.d / run.q * 100) : 0 };
    o.debt = { items: debt.n, rear: debt.rear };
    o.lotPending = db.prepare("SELECT COUNT(*) n FROM kit_lot l JOIN kit_order k ON k.id = l.kit_id WHERE l.line = ? AND l.status = 'pending' AND k.vln_status = 'delivered'").get(o.line).n;
    o.openReq = db.prepare("SELECT COUNT(*) n FROM material_request WHERE line = ? AND status IN ('pending_approval','approved')").get(o.line).n;
    o.kho = o.model ? kitStage.get(o.model) || { done: 0, progress: 0, pending: 0 } : null;
  }
  const cs = currentShift(db), nx = cs.next, nextAssign = nx ? assignMap2(db, nx.day, nx.shift) : /* @__PURE__ */ new Map();
  for (const o of overview) o.nextModel = nextAssign.get(o.line) || "";
  if (!line || !lines.includes(line)) line = ((_a = overview.find((o) => o.model)) == null ? void 0 : _a.line) || lines[0] || "";
  const me = overview.find((o) => o.line === line) || null;
  const model = (me == null ? void 0 : me.model) || "";
  const threshold = Number(getSettings(db).supply_threshold);
  const running = db.prepare("SELECT * FROM kit_order WHERE line = ? AND vln_status = 'delivered' ORDER BY delivered_at").all(line).map((k) => {
    const h = kitHeader(db, k, rk.get(k.id));
    const pos = db.prepare("SELECT p.* FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = ?").all(k.id);
    const produced = pos.reduce((s, p) => s + (p.production_qty || 0), 0);
    const debts2 = db.prepare("SELECT kit_group, model_code, material, required - delivered AS debt FROM kit_item WHERE kit_id = ? AND delivered < required ORDER BY kit_group DESC, material").all(k.id);
    return {
      id: k.id,
      code: k.code,
      kind: k.kind,
      codes: h.codes,
      pos: h.pos.map((p) => p.po),
      notes: h.notes,
      qty: h.qty,
      produced,
      remain: h.remain,
      progress: pct(produced, h.qty),
      state: h.state,
      planEnd: pos.map((p) => p.plan_end).filter(Boolean).sort().at(-1) || "",
      deliveredAt: k.delivered_at || "",
      debts: debts2
    };
  });
  const SORD = { running: 0, waiting: 1 };
  const finished = running.filter((k) => k.remain <= 0).sort((a, b) => String(b.deliveredAt).localeCompare(String(a.deliveredAt))).slice(0, 2).reverse().map((k) => __spreadProps(__spreadValues({}, k), { state: "done" }));
  const active = running.filter((k) => k.remain > 0).sort((a, b) => {
    var _a2, _b;
    return ((_a2 = SORD[a.state]) != null ? _a2 : 1) - ((_b = SORD[b.state]) != null ? _b : 1) || String(a.deliveredAt).localeCompare(String(b.deliveredAt));
  });
  running.length = 0;
  running.push(...finished, ...active);
  const upcoming = upcomingKits(db, model, rk, now);
  const soon = addHours(now, 48);
  const unplanned = !model ? [] : db.prepare(`SELECT p.* FROM po p WHERE p.in_source = 1 AND p.remain_qty > 0 AND ${notCancelledSql("p.")} AND p.plan_start <> '' AND p.plan_start < ?
      AND NOT EXISTS (SELECT 1 FROM kit_order_po x WHERE x.po_key = p.po_key) ORDER BY p.plan_start`).all(soon).filter((p) => modelOf(db, p.model_code, p.basic_model) === model).slice(0, 10).map((p) => ({ po: p.po_no, modelCode: p.model_code, qty: p.plan_qty, planStart: p.plan_start, late: p.plan_start < now, state: productionState(p) }));
  const reqs = db.prepare(`SELECT * FROM material_request WHERE line = ? AND (status IN ('pending_approval','approved') OR created_at >= datetime('now', '-1 day')) ORDER BY id DESC LIMIT 10`).all(line);
  const vln = model ? vlnOverview(db, day, shift).rows.find((r) => r.model === model) || null : null;
  const lastImport = db.prepare("SELECT created_at, source FROM import_log WHERE kind = 'PO' ORDER BY id DESC LIMIT 1").get() || null;
  const alerts = [];
  if (me && model) {
    const s = me.supply;
    if (s.pass && !me.readyCount) alerts.push({ level: "bad", text: "Line c\u1EA7n PO ti\u1EBFp nh\u01B0ng Kho ch\u01B0a c\xF3 PO s\u1EB5n s\xE0ng" });
    if (me.hoursLeft !== null && me.hoursLeft < 2 && !me.readyCount) alerts.push({ level: "bad", text: `Ch\u1EC9 c\xF2n \u2248 ${me.hoursLeft} gi\u1EDD vi\u1EC7c` });
    for (const k of running) {
      const rear = k.debts.filter((d) => d.kit_group === "REAR");
      if (rear.length) alerts.push({ level: "bad", text: `${k.code}: Kho c\xF2n n\u1EE3 Rear ${rear.map((d) => d.model_code.replace(/^GH\d\d-/, "")).join(", ")}` });
    }
    const due = upcoming.filter((u) => u.stage !== "ready" && u.planStart && u.planStart < addHours(now, 2));
    if (nx && me.nextModel !== model) alerts.push({ level: "warn", text: me.nextModel ? `Ca ${nx.shift} (${nx.start}) \u0111\u1ED5i sang ${me.nextModel.replace(/^BSM-/, "")}` : `Ca ${nx.shift} (${nx.start}) Line kh\xF4ng ch\u1EA1y` });
    const behind = upcoming.filter((u) => u.behind);
    if (behind.length) alerts.push({ level: "bad", text: `${behind.length} PO x\u1EBFp mu\u1ED9n so v\u1EDBi Plan Start (${behind.slice(0, 3).map((u) => `${u.code} Kho #${u.mrank}`).join(", ")}) \u2014 Planner c\u1EA7n \u0111\u01B0a l\xEAn tr\u01B0\u1EDBc` });
    for (const u of due.slice(0, 3)) alerts.push({ level: "warn", text: u.stage === "blocked" ? `${u.code}: ${u.why} \u2014 ch\u01B0a giao \u0111\u01B0\u1EE3c` : `${u.code} ${u.planStart < now ? "\u0111\xE3 qu\xE1 gi\u1EDD ch\u1EA1y" : "b\u1EAFt \u0111\u1EA7u"} ${u.planStart.slice(11, 16)} ${u.planStart.slice(8, 10)}/${u.planStart.slice(5, 7)}, Kho ch\u01B0a kitting xong` });
    if (due.length > 3) alerts.push({ level: "warn", text: `+${due.length - 3} PO \u0111\u1EBFn gi\u1EDD ch\u1EA1y ch\u01B0a s\u1EB5n s\xE0ng` });
    const late = unplanned.filter((u) => u.planStart < addHours(now, 24)).length;
    if (late) alerts.push({ level: "warn", text: `${late} PO ${model.replace(/^BSM-/, "")} s\u1EAFp ch\u1EA1y trong 24 gi\u1EDD \u2014 Planner ch\u01B0a l\u1EADp KH kitting` });
    if (!s.hasParams) alerts.push({ level: "warn", text: "Ch\u01B0a khai r\u1EA3i chuy\u1EC1n / pending cho Line + Model n\xE0y" });
    if (!me.uph) alerts.push({ level: "info", text: "Ch\u01B0a khai UPH \u2014 ch\u01B0a t\xEDnh \u0111\u01B0\u1EE3c s\u1ED1 gi\u1EDD c\xF2n vi\u1EC7c" });
  }
  return {
    day,
    shift,
    shiftStart: cs.shift === shift ? cs.start : "",
    next: nx,
    shifts: shifts(db),
    now,
    threshold,
    line,
    lines: overview,
    me,
    running,
    upcoming,
    unplanned,
    vln,
    requests: reqs.map((r) => {
      var _a2;
      return { id: r.id, kind: r.kind, material: r.material, kitCode: r.kit_code, qty: (_a2 = r.issued_qty) != null ? _a2 : r.qty, status: r.status, pass: !!r.pass, createdAt: r.created_at };
    }),
    lastImport,
    alerts
  };
}
function linePos(db, { line, from, to }) {
  if (!line) throw fail("Ch\u1ECDn Line.");
  ensureReceiptSchema(db);
  if (from && !to || !from && to) throw fail("Ch\u1ECDn \u0111\u1EE7 T\u1EEB ng\xE0y v\xE0 \u0110\u1EBFn ng\xE0y.");
  if (from) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw fail("Kho\u1EA3ng ng\xE0y kh\xF4ng h\u1EE3p l\u1EC7.");
    if ((Date.parse(to) - Date.parse(from)) / 864e5 > 6) throw fail("Ch\u1ECDn t\u1ED1i \u0111a 7 ng\xE0y.");
  }
  const vnDay2 = (s) => s ? new Date(Date.parse(`${String(s).replace(" ", "T").slice(0, 19)}Z`) + 7 * 36e5).toISOString().slice(0, 10) : "";
  const doneAt = (p) => {
    const h = db.prepare("SELECT created_at FROM po_history WHERE po_key = ? AND json_extract(changes, '$.remain_qty[1]') = 0 ORDER BY id DESC LIMIT 1").get(p.po_key);
    return h ? { at: h.created_at, day: vnDay2(h.created_at), src: "prod" } : p.plan_end ? { at: "", day: p.plan_end.slice(0, 10), src: "plan" } : null;
  };
  const rows = db.prepare(`SELECT p.*, k.id AS kit_id, k.code AS kit_code, k.kind, k.delivered_at FROM kit_order k JOIN kit_order_po x ON x.kit_id = k.id JOIN po p ON p.po_key = x.po_key
    WHERE k.line = ? AND k.vln_status = 'delivered' ORDER BY k.delivered_at, p.plan_start, p.po_no`).all(line);
  const view2 = (p) => ({
    po: p.po_no,
    kit: p.kit_code,
    merged: p.kind === "merged",
    modelCode: p.model_code,
    model: modelOf(db, p.model_code, p.basic_model),
    poType: p.po_type || "SAP",
    planQty: p.plan_qty,
    produced: p.production_qty || 0,
    remain: p.remain_qty,
    progress: pct(p.production_qty || 0, p.plan_qty),
    state: productionState(p),
    planStatus: p.plan_status || "",
    planStart: p.plan_start || "",
    planEnd: p.plan_end || "",
    deliveredAt: p.delivered_at || "",
    // lần cập nhật gần nhất (UTC): mới hơn giữa nhập file / cổng SX (synced_at) và MES (mes_synced_at)
    updatedAt: [p.synced_at || "", p.mes_synced_at ? p.mes_synced_at.slice(0, 19).replace("T", " ") : ""].sort().at(-1),
    debts: db.prepare("SELECT COUNT(*) n, SUM(kit_group = 'REAR') rear FROM kit_item WHERE kit_id = ? AND delivered < required").get(p.kit_id),
    kitId: p.kit_id,
    receipt: rcpt(p.kit_id),
    intStatus: p.po_type && p.po_type !== "SAP" && p.po_type !== "LOAD" ? p.int_status || productionState(p) : "",
    loadTp: p.po_type === "LOAD" ? -p.plan_qty : 0
  });
  const rcMemo = /* @__PURE__ */ new Map();
  function rcpt(kitId) {
    if (!rcMemo.has(kitId)) {
      const r = receiptOf(db, kitId), lc2 = lotCount(db, kitId);
      rcMemo.set(kitId, { status: r.status, by: r.signerName || r.signer, at: r.at, reason: r.reasonText, note: r.note, khoNote: r.khoNote, khoAt: r.khoAt, lotsPending: lc2.pending, lotsRejected: lc2.rejected, lots: lc2.total });
    }
    return rcMemo.get(kitId);
  }
  const active = rows.filter((p) => productionState(p) !== "done" && productionState(p) !== "cancel").map(view2).sort((a, b) => {
    var _a, _b;
    return ((_a = { running: 0, waiting: 1 }[a.state]) != null ? _a : 2) - ((_b = { running: 0, waiting: 1 }[b.state]) != null ? _b : 2) || String(a.planStart).localeCompare(String(b.planStart));
  });
  let done = null;
  if (from) done = rows.filter((p) => productionState(p) === "done").map((p) => __spreadProps(__spreadValues({}, view2(p)), { done: doneAt(p) || { at: p.delivered_at, day: vnDay2(p.delivered_at), src: "deliver" } })).filter((p) => p.done.day >= from && p.done.day <= to).sort((a, b) => String(b.done.at || b.done.day).localeCompare(String(a.done.at || a.done.day)));
  const doneCount = rows.filter((p) => productionState(p) === "done").length;
  const rc = { pending: 0, rejected: 0 };
  for (const id of new Set(active.map((p) => p.kitId))) {
    const s = active.find((p) => p.kitId === id).receipt.status;
    if (rc[s] !== void 0) rc[s]++;
  }
  const lc = db.prepare("SELECT SUM(l.status = 'pending') p, SUM(l.status = 'rejected') x FROM kit_lot l JOIN kit_order k ON k.id = l.kit_id WHERE l.line = ? AND k.vln_status = 'delivered'").get(line);
  const lots = { pending: lc.p || 0, rejected: lc.x || 0 };
  return { line, active, done, doneCount, from: from || "", to: to || "", receiptCount: rc, lotCount: lots, intStates: INT_STATES, receiptStates: RECEIPT_STATUS };
}

// ../kitting-app/lib/dispatch.mjs
var pct2 = (a, b) => b > 0 ? Math.min(100, Math.round(a / b * 100)) : 0;
var SEV = { now: 0, warn: 1, ok: 2, idle: 3 };
function dispatchView(db, { day, shift } = {}) {
  (() => {
    const c = currentShift(db);
    day = day || c.day;
    shift = shift || (day === c.day ? c.shift : shifts(db)[0]);
  })();
  const today = todayKey(), tomorrow = addDays(today, 1), now = nowVN(), soon = addHours(now, 48);
  const s = getSettings(db), minPer = Number(s.vln_min_per_line) || 0, maxPer = Number(s.vln_max_per_line) || 0;
  const assign = new Map(db.prepare("SELECT line, model FROM line_assign WHERE work_date = ? AND shift = ?").all(day, shift).map((r) => [r.line, r.model]));
  const ready2 = readyByModel(db);
  const lines = db.prepare("SELECT name FROM lines WHERE active = 1 ORDER BY sort_order, name").all().map((r) => r.name).map((l) => lineSummary(db, l, assign.get(l) || "", ready2, now)).filter((l) => l.model);
  const order = kitQueueOrder(db);
  const kits = db.prepare("SELECT * FROM kit_order WHERE plan_day IS NOT NULL AND vln_status <> 'delivered'").all().map((k) => {
    const h = kitHeader(db, k, order.get(k.id));
    const sum = (grp) => db.prepare("SELECT COALESCE(SUM(kitted),0) a, COALESCE(SUM(required),0) b, COUNT(*) n FROM kit_item WHERE kit_id = ? AND grp = ?").get(k.id, grp);
    const v = sum("VLN"), r = sum("HV"), chk = deliverable(db, k);
    const done = k.vln_status === "done" && k.hv_status === "done";
    const start = db.prepare("SELECT MIN(p.plan_start) s FROM kit_order_po x JOIN po p ON p.po_key = x.po_key WHERE x.kit_id = ?").get(k.id).s || "";
    return {
      id: k.id,
      code: k.code,
      kind: k.kind,
      model: h.model,
      codes: h.codes,
      qty: h.qty,
      planDay: k.plan_day,
      planStart: start,
      rank: h.rank,
      mrank: h.mrank,
      round: h.round,
      shortModel: h.shortModel,
      behind: h.behind,
      vln: k.vln_status,
      hv: k.hv_status,
      vlnPct: v.n ? pct2(v.a, v.b) : 0,
      hvPct: r.n ? pct2(r.a, r.b) : 0,
      stage: done ? chk.ok ? "ready" : "blocked" : k.vln_status !== "pending" || k.hv_status !== "pending" ? "progress" : "pending",
      why: done && !chk.ok ? chk.why : "",
      rearZero: chk.rearZero || [],
      noBom: !v.n && h.codes.some((c) => !db.prepare("SELECT 1 FROM bom WHERE model_code = ? LIMIT 1").get(c))
    };
  }).sort((a, b) => {
    var _a, _b;
    return ((_a = a.rank) != null ? _a : 1e9) - ((_b = b.rank) != null ? _b : 1e9);
  });
  const work = kits.filter((k) => k.stage !== "ready");
  const unplanned = /* @__PURE__ */ new Map();
  for (const p of db.prepare(`SELECT model_code, basic_model FROM po p WHERE in_source = 1 AND remain_qty > 0 AND ${notCancelledSql("p.")} AND plan_start <> '' AND plan_start < ?
      AND NOT EXISTS (SELECT 1 FROM kit_order_po x WHERE x.po_key = p.po_key)`).all(soon)) {
    const m = modelOf(db, p.model_code, p.basic_model);
    unplanned.set(m, (unplanned.get(m) || 0) + 1);
  }
  const modelNames = [.../* @__PURE__ */ new Set([...lines.map((l) => l.model), ...kits.map((k) => k.model)])];
  const models = modelNames.map((model) => {
    var _a;
    const ls = lines.filter((l) => l.model === model), mk = kits.filter((k) => k.model === model);
    const readyN = mk.filter((k) => k.stage === "ready").length, min = ls.length * minPer, max = ls.length * maxPer;
    const hoursMin = (_a = ls.map((l) => l.hoursLeft).filter((h) => h !== null).sort((a, b) => a - b)[0]) != null ? _a : null;
    const needPo = ls.some((l) => l.supply.pass);
    const status = !ls.length ? "idle" : readyN < min && (needPo || hoursMin !== null && hoursMin < 2) ? "now" : readyN < min ? "warn" : "ok";
    return {
      model,
      lines: ls.map((l) => ({ line: l.line, hoursLeft: l.hoursLeft, pass: l.supply.pass })),
      ready: readyN,
      min,
      max,
      vlnProg: mk.filter((k) => k.vln === "progress").length,
      hvProg: mk.filter((k) => k.vln !== "pending" && k.hv === "progress").length,
      blocked: mk.filter((k) => k.stage === "blocked").length,
      todo: mk.filter((k) => k.stage === "pending" && k.planDay <= today).length,
      todoTomorrow: mk.filter((k) => k.stage === "pending" && k.planDay === tomorrow).length,
      unplanned: unplanned.get(model) || 0,
      hoursMin,
      status
    };
  }).sort((a, b) => {
    var _a, _b;
    return SEV[a.status] - SEV[b.status] || ((_a = a.hoursMin) != null ? _a : 1e9) - ((_b = b.hoursMin) != null ? _b : 1e9) || a.model.localeCompare(b.model);
  });
  const risk = lines.filter((l) => !l.readyCount && (l.supply.pass || l.hoursLeft !== null && l.hoursLeft < 2)).map((l) => ({ line: l.line, model: l.model, hoursLeft: l.hoursLeft }));
  const round1 = work.filter((k) => k.planDay <= today && k.round === 1);
  const d = debts(db);
  const days = [...new Set(work.map((k) => k.planDay))].sort().map((dd) => {
    const list = work.filter((k) => k.planDay === dd);
    return { day: dd, count: list.length, qty: list.reduce((a, k) => a + k.qty, 0), late: dd < today };
  });
  return {
    day,
    shift,
    shifts: shifts(db),
    now,
    today,
    kpi: {
      risk,
      round1: { count: round1.length, qty: round1.reduce((a, k) => a + k.qty, 0) },
      ready: kits.filter((k) => k.stage === "ready").length,
      debt: { kits: d.kpi.kits, items: d.kpi.items, rear: d.kpi.rear }
    },
    models,
    next: work.slice(0, 15),
    work,
    days
  };
}

// ../kitting-app/lib/debt-ledger.mjs
var r36 = (n) => Math.round(Number(n) * 1e3) / 1e3;
var DAY = /^\d{4}-\d{2}-\d{2}$/;
var utc = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
var vnDayStart = (d) => Date.parse(`${d}T00:00:00Z`) - 7 * 36e5;
var toVN = (t4) => t4 ? new Date(Date.parse(`${t4.replace(" ", "T")}Z`) + 7 * 36e5).toISOString().slice(0, 16) : "";
function debtLedger(db, { from, to, line } = {}) {
  ensureLotSchema(db);
  let a, b, mode2 = "24h";
  if (DAY.test(from || "") && DAY.test(to || "")) {
    if (to < from) [from, to] = [to, from];
    a = utc(vnDayStart(from));
    b = utc(vnDayStart(to) + 864e5);
    mode2 = "range";
  } else {
    b = utc(Date.now() + 6e4);
    a = utc(Date.now() - 864e5);
    from = to = "";
  }
  line = String(line || "");
  const lineSql = line ? " AND t.line = ?" : "", lp = line ? [line] : [];
  const opens = db.prepare(`SELECT t.* FROM kit_txn t WHERE t.type = 'debt_open'${lineSql} ORDER BY t.id`).all(...lp);
  const settles = db.prepare(`SELECT t.* FROM kit_txn t WHERE t.type = 'debt_settle'${lineSql} ORDER BY t.id`).all(...lp);
  const key2 = (t4) => `${t4.kit_code}|${t4.grp}|${t4.ref_code || ""}|${t4.material}`;
  const bySettle = /* @__PURE__ */ new Map();
  for (const t4 of settles) {
    const k = key2(t4);
    if (!bySettle.has(k)) bySettle.set(k, []);
    bySettle.get(k).push(t4);
  }
  const item = db.prepare("SELECT i.*, k.line FROM kit_item i JOIN kit_order k ON k.id = i.kit_id WHERE k.code = ? AND i.grp = ? AND i.model_code = ? AND i.material = ?");
  const inRange = (t4) => t4.created_at >= a && t4.created_at < b;
  const lotOf = (t4) => {
    const l = db.prepare("SELECT lot_no, status, signer_name, signer FROM kit_lot WHERE src_txn = ? OR (kit_code = ? AND lot_no = ?) LIMIT 1").get(t4.id, t4.kit_code, t4.note || "");
    return l ? { lot: l.lot_no, lotStatus: l.status, signer: l.signer_name || l.signer || "" } : {};
  };
  const rows = [], seen = /* @__PURE__ */ new Set();
  for (const o of opens) {
    const k = key2(o);
    if (seen.has(k)) continue;
    seen.add(k);
    const it = item.get(o.kit_code, o.grp, o.ref_code || "", o.material);
    const pays = bySettle.get(k) || [];
    const paid = r36(pays.reduce((s, t4) => s + t4.qty, 0));
    const remain = it ? Math.max(0, r36(it.required - it.delivered)) : Math.max(0, r36(o.qty - paid));
    const status = remain <= 0 ? "paid" : paid > 0 ? "partial" : "open";
    if (status === "paid" && !inRange(o) && !pays.some(inRange)) continue;
    const last = pays.at(-1);
    rows.push({
      line: o.line || (it == null ? void 0 : it.line) || "",
      kit: o.kit_code,
      code: o.ref_code || "",
      material: o.material,
      description: (it == null ? void 0 : it.description) || "",
      group: o.kit_group || "",
      grp: o.grp,
      debt: r36(o.qty),
      paid,
      remain,
      status,
      openedAt: toVN(o.created_at),
      openedBy: o.username || "",
      lastPaidAt: last ? toVN(last.created_at) : "",
      lastPaidBy: (last == null ? void 0 : last.username) || "",
      hours: Math.round((Date.now() - Date.parse(`${o.created_at.replace(" ", "T")}Z`)) / 36e5)
    });
  }
  const lotQ = db.prepare(`SELECT l.lot_no, l.status, l.created_at, l.signer_name, l.signer, l.signed_at, i.qty FROM kit_lot_item i JOIN kit_lot l ON l.id = i.lot_id
    WHERE l.kit_code = ? AND i.grp = ? AND i.model_code = ? AND i.material = ? ORDER BY l.seq`);
  for (const r of rows) {
    const ls = lotQ.all(r.kit, r.grp, r.code, r.material);
    r.lots = ls.map((l) => ({ lotNo: l.lot_no, status: l.status, qty: r36(l.qty), at: toVN(l.created_at), signer: l.signer_name || l.signer || "", signedAt: toVN(l.signed_at) }));
    r.unsigned = ls.filter((l) => l.status !== "received").length;
  }
  const ORD = { open: 0, partial: 1, paid: 2 };
  rows.sort((x, y) => ORD[x.status] - ORD[y.status] || (y.group === "REAR") - (x.group === "REAR") || x.openedAt.localeCompare(y.openedAt));
  const events = [...opens, ...settles].filter(inRange).sort((x, y) => y.id - x.id).map((t4) => __spreadValues({
    at: toVN(t4.created_at),
    type: t4.type === "debt_open" ? "open" : "settle",
    line: t4.line || "",
    kit: t4.kit_code,
    code: t4.ref_code || "",
    material: t4.material,
    group: t4.kit_group || "",
    qty: r36(t4.qty),
    by: t4.username || ""
  }, t4.type === "debt_settle" ? lotOf(t4) : {}));
  const open = rows.filter((r) => r.status !== "paid");
  return {
    mode: mode2,
    from,
    to,
    line,
    rows,
    events,
    kpi: {
      open: open.length,
      rear: open.filter((r) => r.group === "REAR").length,
      remain: r36(open.reduce((s, r) => s + r.remain, 0)),
      opened: events.filter((e) => e.type === "open").length,
      settled: events.filter((e) => e.type === "settle").length
    }
  };
}

// ../kitting-app/lib/kitting-routes.mjs
var KHO = ["kho", "admin"];
var KIT = ["kho", "opkho", "admin"];
var LINE = ["line", "kho", "admin"];
var APPROVE = ["approver", "admin"];
function kittingRoutes(db) {
  return [
    { method: "GET", path: "/api/kho/queue", handler: ({ query }) => kitQueue(db, query.get("grp") === "HV" ? "HV" : "VLN") },
    { method: "GET", path: "/api/kho/kit", handler: ({ query }) => kitDetail(db, query.get("id"), query.get("grp") === "HV" ? "HV" : "VLN") },
    { method: "POST", path: "/api/kho/print", roles: KIT, handler: ({ body, user }) => logPrint(db, body || {}, user.username) },
    { method: "POST", path: "/api/kho/kit/start", roles: KIT, handler: ({ body, user }) => startKit(db, body || {}, user.username) },
    { method: "POST", path: "/api/kho/kit", roles: KIT, handler: ({ body, user }) => saveKitting(db, body || {}, user.username) },
    { method: "GET", path: "/api/kho/lines", handler: ({ query }) => lineBoard(db, query.get("day"), query.get("shift")) },
    { method: "GET", path: "/api/kho/deliver-preview", handler: ({ query }) => deliveryPreview(db, query.get("id"), query.get("line")) },
    { method: "POST", path: "/api/kho/deliver", roles: KHO, handler: ({ body, user }) => deliver(db, body || {}, user.username) },
    { method: "GET", path: "/api/kho/debts", handler: () => debts(db) },
    { method: "POST", path: "/api/kho/debts/settle", roles: KHO, handler: ({ body, user }) => settleDebt(db, body || {}, user.username) },
    { method: "GET", path: "/api/kho/adjust", handler: ({ query }) => adjustOptions(db, query.get("id")) },
    { method: "POST", path: "/api/kho/adjust", roles: KHO, handler: ({ body, user }) => adjust(db, body || {}, user.username) },
    { method: "POST", path: "/api/po/internal/edit", handler: ({ body, user }) => editInternalPo(db, body || {}, user.username) },
    { method: "POST", path: "/api/po/internal/cancel", handler: ({ body, user }) => cancelInternalPo(db, body || {}, user.username) },
    { method: "GET", path: "/api/kho/material-summary", handler: ({ query }) => materialSummary(db, { to: query.get("to") || "", unplanned: query.get("unplanned") === "1" }) },
    { method: "GET", path: "/api/kho/history", handler: ({ query }) => history(db, { days: Number(query.get("days")) || 7, type: query.get("type") || "" }) },
    { method: "GET", path: "/api/supply/form", handler: ({ query }) => requestForm(db, query.get("line")) },
    { method: "GET", path: "/api/supply", handler: () => requests(db) },
    { method: "POST", path: "/api/supply", roles: LINE, handler: ({ body, user }) => createRequest(db, body || {}, user.username) },
    { method: "POST", path: "/api/supply/decide", roles: APPROVE, handler: ({ body, user }) => decideRequest(db, body || {}, user.username) },
    { method: "GET", path: "/api/report/kitting", handler: ({ query }) => kittingReport(db, { from: query.get("from"), to: query.get("to") }) },
    { method: "GET", path: "/api/report/safety", handler: ({ query }) => safetyReport(db, { day: query.get("day"), shift: query.get("shift") }) },
    { method: "GET", path: "/api/report/exceptions", handler: ({ query }) => exceptionReport(db, { from: query.get("from"), to: query.get("to") }) },
    { method: "GET", path: "/api/badges", handler: () => badges(db) },
    { method: "GET", path: "/api/kho/dispatch", handler: ({ query }) => dispatchView(db, { day: query.get("day"), shift: query.get("shift") }) },
    { method: "GET", path: "/api/prod", handler: ({ query }) => productionView(db, { line: query.get("line"), day: query.get("day"), shift: query.get("shift") }) },
    { method: "GET", path: "/api/prod/line", handler: ({ query }) => linePos(db, { line: query.get("line"), from: query.get("from") || "", to: query.get("to") || "" }) },
    { method: "GET", path: "/api/prod/ready", handler: ({ query }) => readyForLine(db, query.get("line") || "") },
    { method: "GET", path: "/api/prod/debts", handler: ({ query }) => debtLedger(db, { from: query.get("from"), to: query.get("to"), line: query.get("line") }) },
    { method: "POST", path: "/api/supply/issue", roles: KHO, handler: ({ body, user }) => issueRequest(db, body || {}, user.username) }
  ];
}

// ../kitting-app/lib/bom-routes.mjs
var PLAN3 = ["planner", "admin"];
var trim2 = (v) => String(v != null ? v : "").trim();
function bomRoutes(db) {
  return [
    { method: "GET", path: "/api/bom", handler: () => {
      const last = db.prepare("SELECT * FROM import_log WHERE kind = 'BOM' ORDER BY id DESC LIMIT 1").get();
      return { models: bomCatalog(db), missing: bomCoverage(db), lastImport: last ? __spreadProps(__spreadValues({}, last), { summary: JSON.parse(last.summary || "{}") }) : null };
    } },
    { method: "GET", path: "/api/bom/model", handler: ({ query }) => bomModelDetail(db, trim2(query.get("model"))) },
    { method: "POST", path: "/api/bom/row", roles: PLAN3, handler: ({ body, user }) => {
      assertBomEditable(db);
      return saveBomRow(db, body || {}, user.username);
    } },
    { method: "POST", path: "/api/bom/row/delete", roles: PLAN3, handler: ({ body, user }) => {
      assertBomEditable(db);
      return deleteBomRow(db, body || {}, user.username);
    } },
    { method: "POST", path: "/api/bom/code", roles: PLAN3, handler: ({ body, user }) => {
      if (body == null ? void 0 : body.copyFrom) assertBomEditable(db);
      return saveModelCode(db, body || {}, user.username);
    } },
    { method: "POST", path: "/api/bom/code/delete", roles: PLAN3, handler: ({ body, user }) => {
      assertBomEditable(db);
      return deleteModelCode(db, body || {}, user.username);
    } },
    { method: "POST", path: "/api/bom/vln", roles: PLAN3, handler: ({ body, user }) => saveVlnPoint(db, body || {}, user.username) },
    { method: "POST", path: "/api/bom/group", roles: PLAN3, handler: ({ body, user }) => tx(db, () => ({ ok: true, changed: setGroup(db, body || {}, user.username) })) },
    { method: "POST", path: "/api/bom/model-map", roles: PLAN3, handler: ({ body, user }) => {
      const code = trim2(body == null ? void 0 : body.modelCode), model = trim2(body == null ? void 0 : body.model);
      if (!code || !model) throw fail("Nh\u1EADp Model Code v\xE0 Model.");
      return saveModelCode(db, { modelCode: code, model }, user.username);
    } },
    { method: "POST", path: "/api/bom/resuggest", roles: PLAN3, handler: () => ({ ok: true, changed: tx(db, () => {
      const n = suggestGroups(db);
      rebuildVln(db);
      return n;
    }) }) }
  ];
}

// ../kitting-app/lib/bom-change.mjs
var CHANGE_REASONS = { ECN: "Thay \u0111\u1ED5i k\u1EF9 thu\u1EADt (ECN)", VENDOR: "Thay nh\xE0 cung c\u1EA5p", EOL: "H\u1EBFt h\xE0ng / ng\u1EEBng m\xE3 c\u0169", QUALITY: "Ch\u1EA5t l\u01B0\u1EE3ng", OTHER: "Kh\xE1c" };
var r37 = (n) => Math.round(Number(n) * 1e3) / 1e3;
var t3 = (v) => String(v != null ? v : "").trim();
var MODEL2 = "COALESCE(m.model, b.model_code)";
function ensureBomChangeSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS bom_change (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ecn TEXT NOT NULL UNIQUE, model TEXT NOT NULL, codes TEXT NOT NULL,
    old_material TEXT NOT NULL, new_material TEXT NOT NULL, new_description TEXT, old_point REAL, new_point REAL,
    reason TEXT NOT NULL, note TEXT, effective_date TEXT NOT NULL, update_planned INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'scheduled', result TEXT,
    created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    applied_by TEXT, applied_at TEXT, cancelled_by TEXT, cancelled_at TEXT, cancel_reason TEXT)`);
}
var canChangeBom = (u) => {
  var _a, _b;
  return !!u && (u.role === "admin" || u.isHead && (u.role === "kho" || /kho/i.test(u.dept || "")) || !!((_b = (_a = u.perms) == null ? void 0 : _a.specials) == null ? void 0 : _b.bomChange));
};
function rowsOf(db, codes, material) {
  return db.prepare(`SELECT * FROM bom WHERE material = ? AND model_code IN (${codes.map(() => "?").join(",")})`).all(material, ...codes);
}
function nextEcn(db) {
  var _a;
  const prefix = `ECN-${todayKey().replace(/-/g, "").slice(2)}-`;
  const last = (_a = db.prepare("SELECT ecn FROM bom_change WHERE ecn LIKE ? ORDER BY ecn DESC LIMIT 1").get(`${prefix}%`)) == null ? void 0 : _a.ecn;
  return `${prefix}${String((last ? Number(last.slice(prefix.length)) || 0 : 0) + 1).padStart(3, "0")}`;
}
function check(db, b) {
  const ecn = nextEcn(db), model = t3(b.model), oldM = t3(b.oldMaterial), newM = t3(b.newMaterial), reason = t3(b.reason);
  if (!model) throw fail("Ch\u1ECDn Model.");
  const all = db.prepare(`SELECT DISTINCT b.model_code c FROM bom b LEFT JOIN model_map m ON m.model_code = b.model_code WHERE ${MODEL2} = ?`).all(model).map((r) => r.c);
  if (!all.length) throw fail(`Model ${model} ch\u01B0a c\xF3 BOM.`);
  const codes = b.allCodes ? all.filter((c) => db.prepare("SELECT 1 FROM bom WHERE model_code = ? AND material = ?").get(c, oldM)) : [...new Set((Array.isArray(b.codes) ? b.codes : []).map(t3).filter(Boolean))];
  if (!codes.length) throw fail("Ch\u1ECDn \xEDt nh\u1EA5t 1 Model Code.");
  const bad = codes.filter((c) => !all.includes(c));
  if (bad.length) throw fail(`Model Code kh\xF4ng thu\u1ED9c ${model}: ${bad.join(", ")}.`);
  if (!oldM || !newM) throw fail("Nh\u1EADp code tr\u01B0\u1EDBc v\xE0 code sau.");
  if (oldM.toUpperCase() === newM.toUpperCase()) throw fail("Code sau ph\u1EA3i kh\xE1c code tr\u01B0\u1EDBc.");
  const olds = rowsOf(db, codes, oldM), missing = codes.filter((c) => !olds.some((r) => r.model_code === c));
  if (missing.length) throw fail(`${oldM} kh\xF4ng c\xF3 trong BOM c\u1EE7a: ${missing.join(", ")}.`);
  const dup = rowsOf(db, codes, newM).map((r) => r.model_code);
  if (dup.length) throw fail(`${newM} \u0111\xE3 c\xF3 trong BOM c\u1EE7a: ${dup.join(", ")}.`);
  const pending3 = db.prepare("SELECT ecn FROM bom_change WHERE status = 'scheduled' AND model = ? AND old_material = ?").get(model, oldM);
  if (pending3) throw fail(`${oldM} \u0111\xE3 c\xF3 ECN ${pending3.ecn} ch\u1EDD \xE1p d\u1EE5ng \u2014 h\u1EE7y ECN \u0111\xF3 tr\u01B0\u1EDBc.`);
  if (!CHANGE_REASONS[reason]) throw fail("Ch\u1ECDn l\xFD do.");
  const day = t3(b.effectiveDate) || todayKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw fail("Ng\xE0y \xE1p d\u1EE5ng kh\xF4ng h\u1EE3p l\u1EC7.");
  const points = [...new Set(olds.map((r) => r.point))];
  const np = b.newPoint === "" || b.newPoint === void 0 || b.newPoint === null ? null : Number(b.newPoint);
  if (np !== null && !(np > 0)) throw fail("Point m\u1EDBi ph\u1EA3i > 0.");
  return {
    ecn,
    model,
    codes,
    oldM,
    newM,
    reason,
    day,
    olds,
    oldPoint: points.length === 1 ? points[0] : null,
    newPoint: np,
    newDesc: t3(b.newDescription).slice(0, 200),
    note: t3(b.note).slice(0, 300),
    updatePlanned: !!b.updatePlanned
  };
}
function plannedKits(db, codes) {
  return db.prepare(`SELECT DISTINCT k.* FROM kit_order k JOIN kit_order_po x ON x.kit_id = k.id JOIN po p ON p.po_key = x.po_key
    WHERE k.plan_day IS NOT NULL AND k.vln_status <> 'delivered' AND p.model_code IN (${codes.map(() => "?").join(",")}) ORDER BY k.plan_day, k.seq`).all(...codes);
}
function kitImpact(db, c) {
  return plannedKits(db, c.codes).map((k) => {
    const its = db.prepare("SELECT * FROM kit_item WHERE kit_id = ? AND material = ?").all(k.id, c.oldM);
    return { id: k.id, code: k.code, day: k.plan_day, opened: !!db.prepare("SELECT 1 FROM kit_item WHERE kit_id = ? LIMIT 1").get(k.id), kitted: its.some((i) => i.kitted > 0), hasOld: its.length > 0 };
  });
}
function previewChange(db, body) {
  var _a;
  ensureBomChangeSchema(db);
  const c = check(db, body);
  const kits = kitImpact(db, c);
  return {
    ok: true,
    ecn: c.ecn,
    model: c.model,
    codes: c.codes,
    oldMaterial: c.oldM,
    newMaterial: c.newM,
    oldPoint: c.oldPoint,
    newPoint: (_a = c.newPoint) != null ? _a : c.oldPoint,
    rows: c.olds.map((r) => ({ code: r.model_code, point: r.point, group: r.kit_group, description: r.description })),
    effectiveDate: c.day,
    now: c.day <= todayKey(),
    kits: { total: kits.length, kitted: kits.filter((k) => k.kitted).map((k) => k.code), update: kits.filter((k) => !k.kitted).length }
  };
}
function apply(db, ch, username) {
  var _a, _b;
  const codes = JSON.parse(ch.codes), c = { codes, oldM: ch.old_material };
  const kitsUpdated = [], kitsKept = [], kitsFrozen = [];
  if (!ch.update_planned) for (const k of plannedKits(db, codes)) for (const grp of ["VLN", "HV"]) {
    if (db.prepare("SELECT 1 FROM kit_item WHERE kit_id = ? AND grp = ? LIMIT 1").get(k.id, grp)) continue;
    try {
      ensureItems(db, k, grp);
      if (!kitsFrozen.includes(k.code)) kitsFrozen.push(k.code);
    } catch (e) {
    }
  }
  const olds = rowsOf(db, codes, ch.old_material);
  if (!olds.length) throw fail(`${ch.old_material} kh\xF4ng c\xF2n trong BOM c\u1EE7a ${codes.join(", ")} \u2014 ECN ${ch.ecn} kh\xF4ng \xE1p d\u1EE5ng \u0111\u01B0\u1EE3c.`);
  const up = db.prepare("UPDATE bom SET material = ?, description = ?, point = ? WHERE id = ?");
  for (const r of olds) up.run(ch.new_material, ch.new_description || r.description, (_a = ch.new_point) != null ? _a : r.point, r.id);
  rebuildVln(db, [ch.model]);
  if (ch.update_planned) for (const k of plannedKits(db, codes)) {
    const its = db.prepare("SELECT * FROM kit_item WHERE kit_id = ? AND material = ?").all(k.id, ch.old_material);
    if (!its.length) continue;
    if (its.some((i) => i.kitted > 0)) {
      kitsKept.push(k.code);
      continue;
    }
    for (const i of its) {
      if (i.grp === "HV" && !codes.includes(i.model_code)) continue;
      const base = ((_b = olds.find((o) => o.model_code === (i.model_code || codes[0]))) == null ? void 0 : _b.point) || ch.old_point;
      const req = ch.new_point && base ? r37(i.required / base * ch.new_point) : i.required;
      db.prepare("UPDATE kit_item SET material = ?, description = ?, required = ? WHERE kit_id = ? AND grp = ? AND model_code = ? AND material = ?").run(ch.new_material, ch.new_description || i.description, req, k.id, i.grp, i.model_code, ch.old_material);
    }
    kitsUpdated.push(k.code);
  }
  const result = { bomRows: olds.length, kitsUpdated, kitsKept, kitsFrozen };
  db.prepare("UPDATE bom_change SET status = 'applied', applied_by = ?, applied_at = datetime('now'), result = ? WHERE id = ?").run(username, JSON.stringify(result), ch.id);
  audit(db, username, "bom.change.apply", __spreadValues({ ecn: ch.ecn, model: ch.model, from: ch.old_material, to: ch.new_material }, result));
  return result;
}
function createChange(db, body, user) {
  if (!canChangeBom(user)) throw fail("Ch\u1EC9 Qu\u1EA3n tr\u1ECB / Tr\u01B0\u1EDFng b\u1ED9 ph\u1EADn Kho \u0111\u01B0\u1EE3c change code BOM.", 403);
  ensureBomChangeSchema(db);
  return tx(db, () => {
    const c = check(db, body);
    const id = Number(db.prepare(`INSERT INTO bom_change(ecn, model, codes, old_material, new_material, new_description, old_point, new_point, reason, note, effective_date, update_planned, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(c.ecn, c.model, JSON.stringify(c.codes), c.oldM, c.newM, c.newDesc, c.oldPoint, c.newPoint, c.reason, c.note, c.day, c.updatePlanned ? 1 : 0, user.username).lastInsertRowid);
    audit(db, user.username, "bom.change", { ecn: c.ecn, model: c.model, codes: c.codes, from: c.oldM, to: c.newM, day: c.day, updatePlanned: c.updatePlanned });
    if (c.day > todayKey()) return { ok: true, id, status: "scheduled", message: `ECN ${c.ecn}: ${c.oldM} \u2192 ${c.newM} ch\u1EDD \xE1p d\u1EE5ng ${c.day.split("-").reverse().join("/")}` };
    const r = apply(db, db.prepare("SELECT * FROM bom_change WHERE id = ?").get(id), user.username);
    return __spreadProps(__spreadValues({ ok: true, id, status: "applied" }, r), { message: `ECN ${c.ecn}: \u0111\xE3 \u0111\u1ED5i ${c.oldM} \u2192 ${c.newM} \u1EDF ${r.bomRows} Model Code${r.kitsUpdated.length ? ` \xB7 c\u1EADp nh\u1EADt ${r.kitsUpdated.length} kit` : ""}${r.kitsKept.length ? ` \xB7 ${r.kitsKept.length} kit \u0111\xE3 so\u1EA1n m\xE3 c\u0169 gi\u1EEF nguy\xEAn` : ""}` });
  });
}
function cancelChange(db, { id, reason }, user) {
  if (!canChangeBom(user)) throw fail("Ch\u1EC9 Qu\u1EA3n tr\u1ECB / Tr\u01B0\u1EDFng b\u1ED9 ph\u1EADn Kho \u0111\u01B0\u1EE3c h\u1EE7y change code.", 403);
  ensureBomChangeSchema(db);
  return tx(db, () => {
    const ch = db.prepare("SELECT * FROM bom_change WHERE id = ?").get(Number(id));
    if (!ch) throw fail("Kh\xF4ng t\xECm th\u1EA5y ECN.", 404);
    if (ch.status !== "scheduled") throw fail(`ECN ${ch.ecn} \u0111\xE3 ${ch.status === "applied" ? "\xE1p d\u1EE5ng" : "h\u1EE7y"}, kh\xF4ng h\u1EE7y \u0111\u01B0\u1EE3c.`);
    if (!t3(reason)) throw fail("Nh\u1EADp l\xFD do h\u1EE7y.");
    db.prepare("UPDATE bom_change SET status = 'cancelled', cancelled_by = ?, cancelled_at = datetime('now'), cancel_reason = ? WHERE id = ?").run(user.username, t3(reason).slice(0, 200), ch.id);
    audit(db, user.username, "bom.change.cancel", { ecn: ch.ecn, reason: t3(reason) });
    return { ok: true, message: `\u0110\xE3 h\u1EE7y ECN ${ch.ecn}.` };
  });
}
function applyDueChanges(db) {
  ensureBomChangeSchema(db);
  let n = 0;
  for (const ch of db.prepare("SELECT * FROM bom_change WHERE status = 'scheduled' AND effective_date <= ? ORDER BY effective_date, id").all(todayKey())) {
    try {
      tx(db, () => apply(db, ch, "system"));
      n++;
    } catch (e) {
      db.prepare("UPDATE bom_change SET status = 'failed', result = ? WHERE id = ?").run(JSON.stringify({ error: e.message }), ch.id);
    }
  }
  return n;
}
var view = (r) => ({
  id: r.id,
  ecn: r.ecn,
  model: r.model,
  codes: JSON.parse(r.codes),
  oldMaterial: r.old_material,
  newMaterial: r.new_material,
  newDescription: r.new_description || "",
  oldPoint: r.old_point,
  newPoint: r.new_point,
  reason: r.reason,
  reasonLabel: CHANGE_REASONS[r.reason] || r.reason,
  note: r.note || "",
  effectiveDate: r.effective_date,
  updatePlanned: !!r.update_planned,
  status: r.status,
  result: r.result ? JSON.parse(r.result) : null,
  createdBy: r.created_by,
  createdAt: r.created_at,
  appliedBy: r.applied_by,
  appliedAt: r.applied_at,
  cancelledBy: r.cancelled_by,
  cancelledAt: r.cancelled_at,
  cancelReason: r.cancel_reason || ""
});
function listChanges(db, { q = "", status = "", from = "", to = "" } = {}) {
  ensureBomChangeSchema(db);
  const where = [], args = [];
  if (q) {
    where.push("(ecn LIKE ? OR model LIKE ? OR codes LIKE ? OR old_material LIKE ? OR new_material LIKE ?)");
    for (let i = 0; i < 5; i++) args.push(`%${q}%`);
  }
  if (status) {
    where.push("status = ?");
    args.push(status);
  }
  if (from) {
    where.push("effective_date >= ?");
    args.push(from);
  }
  if (to) {
    where.push("effective_date <= ?");
    args.push(to);
  }
  const rows = db.prepare(`SELECT * FROM bom_change ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY effective_date DESC, id DESC LIMIT 1000`).all(...args).map(view);
  return { rows, reasons: CHANGE_REASONS };
}
function changeAlerts(db) {
  ensureBomChangeSchema(db);
  const since = new Date(Date.parse(`${todayKey()}T00:00:00Z`) - 7 * 864e5).toISOString().slice(0, 10);
  return db.prepare("SELECT * FROM bom_change WHERE status = 'scheduled' OR (status IN ('applied','failed') AND effective_date >= ?) ORDER BY effective_date DESC, id DESC LIMIT 20").all(since).map(view);
}
function bomChangeRoutes(db) {
  return [
    { method: "GET", path: "/api/bom/changes", handler: ({ query }) => listChanges(db, { q: t3(query.get("q")), status: t3(query.get("status")), from: t3(query.get("from")), to: t3(query.get("to")) }) },
    { method: "GET", path: "/api/bom/changes/alerts", handler: () => ({ rows: changeAlerts(db) }) },
    { method: "POST", path: "/api/bom/change/preview", handler: ({ body, user }) => {
      if (!canChangeBom(user)) throw fail("Ch\u1EC9 Qu\u1EA3n tr\u1ECB / Tr\u01B0\u1EDFng b\u1ED9 ph\u1EADn Kho \u0111\u01B0\u1EE3c change code BOM.", 403);
      return previewChange(db, body || {});
    } },
    { method: "POST", path: "/api/bom/change", handler: ({ body, user }) => {
      assertBomEditable(db);
      return createChange(db, body || {}, user);
    } },
    { method: "POST", path: "/api/bom/change/cancel", handler: ({ body, user }) => cancelChange(db, body || {}, user) }
  ];
}

// ../kitting-app/lib/password.mjs
var PASSWORD_RULE = "M\u1EADt kh\u1EA9u t\u1EEB 8 k\xFD t\u1EF1, c\xF3 c\u1EA3 ch\u1EEF v\xE0 s\u1ED1.";
function checkPassword(p) {
  p = String(p != null ? p : "");
  if (p.length < 8 || p.length > 64 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) throw fail(PASSWORD_RULE);
  return p;
}

// ../kitting-app/lib/perms.mjs
var SCREENS = [
  ["board", "K\u1EBF ho\u1EA1ch kitting"],
  ["kho", "Kho"],
  ["kitpad", "Kitting"],
  ["prod", "S\u1EA3n xu\u1EA5t"],
  ["supply", "C\u1EA5p v\u1EADt li\u1EC7u"],
  ["report", "B\xE1o c\xE1o"],
  ["lines", "Line & tham s\u1ED1"],
  ["po", "D\u1EEF li\u1EC7u PO"],
  ["bom", "BOM & Model"]
];
var SPECIALS = [
  ["deliver", "Giao Line"],
  ["approve", "Duy\u1EC7t ngo\u1EA1i l\u1EC7"],
  ["bomImport", "Nh\u1EADp BOM (theo Model Code trong file)"],
  ["prodUpdate", "C\u1EADp nh\u1EADt s\u1EA3n xu\u1EA5t"],
  ["internalPo", "T\u1EA1o / s\u1EEDa / h\u1EE7y PO n\u1ED9i b\u1ED9 (Unplan / RMA)"],
  ["bomChange", "Change code BOM (ECN)"],
  ["lineSign", "Leader giao nh\u1EADn (k\xFD nh\u1EADn PO, tr\u1EA1ng th\xE1i PO n\u1ED9i b\u1ED9 \u2014 c\u1EA7n MK c\u1EA5p 2)"]
];
var SCREEN_KEYS = SCREENS.map((s) => s[0]);
var SPECIAL_KEYS = SPECIALS.map((s) => s[0]);
var P = (screens, specials = []) => ({ screens: Object.fromEntries(SCREEN_KEYS.map((k) => [k, screens[k] || 0])), specials: Object.fromEntries(SPECIAL_KEYS.map((k) => [k, specials.includes(k)])) });
var ROLE_DEFAULTS = {
  admin: P(Object.fromEntries(SCREEN_KEYS.map((k) => [k, 2])), SPECIAL_KEYS),
  planner: P({ board: 2, kho: 1, prod: 1, supply: 1, report: 1, lines: 2, po: 2, bom: 2 }, ["bomImport", "internalPo"]),
  kho: P({ board: 1, kho: 2, kitpad: 2, prod: 1, supply: 2, report: 1, lines: 1, po: 1, bom: 1 }, ["deliver"]),
  opkho: P({ kitpad: 2 }),
  line: P({ board: 1, prod: 2, supply: 2, report: 1, lines: 1, po: 1, bom: 1 }),
  approver: P({ board: 1, kho: 1, prod: 1, supply: 2, report: 1, lines: 1, po: 1, bom: 1 }, ["approve"])
};
function normalizePerms(raw) {
  let p = raw;
  if (typeof p === "string") {
    try {
      p = JSON.parse(p);
    } catch (e) {
      p = null;
    }
  }
  if (!p || typeof p !== "object" || !p.screens) return null;
  return {
    screens: Object.fromEntries(SCREEN_KEYS.map((k) => [k, [0, 1, 2].includes(Number(p.screens[k])) ? Number(p.screens[k]) : 0])),
    specials: Object.fromEntries(SPECIAL_KEYS.map((k) => {
      var _a;
      return [k, !!((_a = p.specials) == null ? void 0 : _a[k])];
    }))
  };
}
function effectivePerms(role, raw) {
  if (role === "admin") return ROLE_DEFAULTS.admin;
  return normalizePerms(raw) || ROLE_DEFAULTS[role] || P({});
}
var R = {
  "@any": [
    "GET /api/bom/changes/alerts",
    "POST /api/bom/change/preview",
    "POST /api/bom/change",
    "POST /api/bom/change/cancel",
    "GET /api/me",
    "GET /api/badges",
    "GET /api/lines/assign",
    "GET /api/lines/params",
    "GET /api/lines/week",
    "GET /api/vln-overview",
    "POST /api/me/password",
    "POST /api/me/pin2",
    "POST /api/me/pin2/verify"
  ],
  "board:1": ["GET /api/board"],
  "board:2": ["POST /api/board/apply", "POST /api/board/batch", "POST /api/board/merge", "POST /api/board/split", "POST /api/board/undo", "POST /api/board/auto", "POST /api/board/import"],
  "lines:2": ["POST /api/lines/assign", "POST /api/lines/assign/copy", "POST /api/lines/params", "POST /api/lines/params/delete", "POST /api/lines/week", "POST /api/lines/week/copy", "POST /api/lines/manage", "POST /api/lines/erp/sync"],
  "lines:1": ["GET /api/lines/erp"],
  "po:1|prodUpdate": ["GET /api/po", "GET /api/po/history"],
  "po:2": ["POST /api/po/import", "POST /api/po/note"],
  "po:2|kho:2": ["POST /api/po/drop-cancelled"],
  "prodUpdate": ["POST /api/po/production", "GET /api/po/production/log"],
  "bomImport": ["POST /api/bom/import", "POST /api/bom/erp/sync"],
  "internalPo": ["GET /api/po/internal/options", "POST /api/po/internal", "POST /api/po/internal/edit", "POST /api/po/internal/cancel"],
  "bom:1|kho:1": ["GET /api/bom/changes", "GET /api/bom/erp"],
  "bom:1|board:1": ["GET /api/bom", "GET /api/bom/model"],
  "bom:2": ["POST /api/bom/row", "POST /api/bom/row/delete", "POST /api/bom/code", "POST /api/bom/code/delete", "POST /api/bom/vln", "POST /api/bom/group", "POST /api/bom/model-map", "POST /api/bom/resuggest"],
  "@admin": ["GET /api/admin/settings", "POST /api/admin/settings", "GET /api/admin/erp", "POST /api/admin/erp", "POST /api/admin/lines", "POST /api/demo/reset", "POST /api/demo/clear"],
  "@manager": ["GET /api/admin/users", "POST /api/admin/users", "POST /api/admin/users/update", "POST /api/admin/users/delete"],
  // Soạn bù nợ (/api/kho/bu): OP kho (tab Kitting) + Kho; bấm Giao bù (tạo đợt, POST /api/kho/debts/settle) chỉ Kho
  "kho:1|kitpad:1": ["GET /api/kho/queue", "GET /api/kho/kit", "GET /api/kho/bu", "GET /api/kho/bu/kit"],
  "kho:2|kitpad:2": ["POST /api/kho/print", "POST /api/kho/kit", "POST /api/kho/kit/start", "POST /api/kho/bu"],
  "kho:1": ["GET /api/kho/stock", "GET /api/kho/lines", "GET /api/kho/deliver-preview", "GET /api/kho/debts", "GET /api/kho/adjust", "GET /api/kho/history", "GET /api/kho/dispatch", "GET /api/kho/material-summary"],
  "deliver": ["POST /api/kho/deliver"],
  "kho:2": ["POST /api/kho/stock/sync", "POST /api/kho/debts/settle", "POST /api/kho/adjust", "POST /api/supply/issue", "POST /api/kho/receipt/resolve", "POST /api/kho/lot/resolve"],
  "supply:1|prod:1": ["GET /api/supply/form", "GET /api/supply"],
  "supply:2|prod:2": ["POST /api/supply"],
  "approve": ["POST /api/supply/decide"],
  "report:1": ["GET /api/report/kitting", "GET /api/report/safety", "GET /api/report/exceptions"],
  "prod:1": ["GET /api/prod", "GET /api/prod/debts", "GET /api/prod/line", "GET /api/prod/ready"],
  // Nhận PO / trạng thái PO nội bộ: máy của Line (prod:2) thao tác, Leader giao nhận ký bằng Mã NV + MK cấp 2 (kiểm trong handler).
  "prod:1|kho:1": ["GET /api/prod/receipt", "GET /api/prod/lots"],
  "prod:2": ["POST /api/prod/receipt/receive", "POST /api/prod/receipt/reject", "POST /api/prod/internal-status", "POST /api/prod/lots/receive"],
  "kho:1|supply:1": ["GET /api/kho/receipts"]
};
var ROUTE_PERM = new Map(Object.entries(R).flatMap(([need, list]) => list.map((r) => [r, need.split("|")])));
var PIN2_ROUTES = /* @__PURE__ */ new Set(["POST /api/admin/users", "POST /api/admin/users/update", "POST /api/admin/users/delete"]);
var PIN2_MINUTES = 5;
var isManager = (user) => user.role === "admin" || !!user.isHead;
function has(user, token) {
  if (token === "@any") return true;
  if (token === "@admin") return user.role === "admin";
  if (token === "@manager") return isManager(user);
  const [screen, level] = token.split(":");
  if (level) return (user.perms.screens[screen] || 0) >= Number(level);
  return !!user.perms.specials[token];
}
function checkAccess(user, method, path) {
  if (user.role === "admin") return;
  const need = ROUTE_PERM.get(`${method} ${path}`) || ["@admin"];
  if (!need.some((t4) => has(user, t4))) throw fail("T\xE0i kho\u1EA3n ch\u01B0a \u0111\u01B0\u1EE3c c\u1EA5p quy\u1EC1n cho ch\u1EE9c n\u0103ng n\xE0y.", 403);
}
function checkUserChange(actor, target, next) {
  if (actor.role === "admin") return;
  if (!actor.isHead) throw fail("Ch\u1EC9 Qu\u1EA3n tr\u1ECB ho\u1EB7c Tr\u01B0\u1EDFng b\u1ED9 ph\u1EADn \u0111\u01B0\u1EE3c qu\u1EA3n l\xFD t\xE0i kho\u1EA3n.", 403);
  if (!actor.dept) throw fail("Tr\u01B0\u1EDFng b\u1ED9 ph\u1EADn ch\u01B0a \u0111\u01B0\u1EE3c g\xE1n b\u1ED9 ph\u1EADn.", 403);
  if (target) {
    if (target.id === actor.id) throw fail("Kh\xF4ng t\u1EF1 s\u1EEDa t\xE0i kho\u1EA3n c\u1EE7a m\xECnh \u1EDF \u0111\xE2y (nh\u1EDD Qu\u1EA3n tr\u1ECB).", 403);
    if (target.role === "admin" || target.isHead || target.dept !== actor.dept) throw fail("T\xE0i kho\u1EA3n n\xE0y kh\xF4ng thu\u1ED9c b\u1ED9 ph\u1EADn b\u1EA1n qu\u1EA3n l\xFD.", 403);
  }
  if (next.role === "admin") throw fail("Tr\u01B0\u1EDFng b\u1ED9 ph\u1EADn kh\xF4ng t\u1EA1o / g\xE1n quy\u1EC1n Qu\u1EA3n tr\u1ECB.", 403);
  if (next.isHead) throw fail("Ch\u1EC9 Qu\u1EA3n tr\u1ECB ch\u1EC9 \u0111\u1ECBnh Tr\u01B0\u1EDFng b\u1ED9 ph\u1EADn.", 403);
  if (next.dept !== void 0 && next.dept !== actor.dept) throw fail(`Ch\u1EC9 t\u1EA1o / s\u1EEDa t\xE0i kho\u1EA3n thu\u1ED9c b\u1ED9 ph\u1EADn ${actor.dept}.`, 403);
  const p = next.perms;
  if (p) {
    for (const k of SCREEN_KEYS) if ((p.screens[k] || 0) > (actor.perms.screens[k] || 0)) throw fail(`Kh\xF4ng c\u1EA5p quy\u1EC1n "${SCREENS.find((s) => s[0] === k)[1]}" cao h\u01A1n quy\u1EC1n c\u1EE7a b\u1EA1n.`, 403);
    for (const k of SPECIAL_KEYS) if (p.specials[k] && !actor.perms.specials[k]) throw fail(`Kh\xF4ng c\u1EA5p quy\u1EC1n "${SPECIALS.find((s) => s[0] === k)[1]}" khi b\u1EA1n kh\xF4ng c\xF3 quy\u1EC1n n\xE0y.`, 403);
  }
}
var canSeeUser = (actor, u) => actor.role === "admin" || u.id === actor.id || actor.isHead && u.dept === actor.dept && u.role !== "admin" && !u.isHead;
function checkPin2(v) {
  const s = String(v != null ? v : "");
  if (s.length < 6 || s.length > 32) throw fail("M\u1EADt kh\u1EA9u c\u1EA5p 2: 6\u201332 k\xFD t\u1EF1.");
  return s;
}
var pin2Elevated = (db, userId) => !!db.prepare("SELECT 1 FROM pin2_session WHERE user_id = ? AND until > datetime('now')").get(String(userId));
var pin2Locked = (db, userId) => db.prepare("SELECT COUNT(*) n FROM pin2_fail WHERE user_id = ? AND created_at > datetime('now', '-15 minutes')").get(String(userId)).n >= 5;
function pin2Result(db, userId, ok) {
  const id = String(userId);
  if (!ok) {
    db.prepare("INSERT INTO pin2_fail(user_id) VALUES (?)").run(id);
    return { ok: false, message: pin2Locked(db, id) ? "Sai m\u1EADt kh\u1EA9u c\u1EA5p 2 qu\xE1 5 l\u1EA7n. Th\u1EED l\u1EA1i sau 15 ph\xFAt." : "M\u1EADt kh\u1EA9u c\u1EA5p 2 kh\xF4ng \u0111\xFAng." };
  }
  db.prepare("DELETE FROM pin2_fail WHERE user_id = ?").run(id);
  db.prepare(`INSERT INTO pin2_session(user_id, until) VALUES (?, datetime('now', '+${PIN2_MINUTES} minutes')) ON CONFLICT(user_id) DO UPDATE SET until = excluded.until`).run(id);
  return { ok: true, minutes: PIN2_MINUTES };
}
function pin2Check(db, userId, ok) {
  const id = String(userId);
  if (!ok) {
    db.prepare("INSERT INTO pin2_fail(user_id) VALUES (?)").run(id);
    return { ok: false, message: pin2Locked(db, id) ? "Sai m\u1EADt kh\u1EA9u c\u1EA5p 2 qu\xE1 5 l\u1EA7n. Th\u1EED l\u1EA1i sau 15 ph\xFAt." : "M\u1EADt kh\u1EA9u c\u1EA5p 2 kh\xF4ng \u0111\xFAng." };
  }
  db.prepare("DELETE FROM pin2_fail WHERE user_id = ?").run(id);
  return { ok: true };
}
var needsPin2 = (user) => {
  var _a, _b;
  return isManager(user) || !!((_b = (_a = user == null ? void 0 : user.perms) == null ? void 0 : _a.specials) == null ? void 0 : _b.lineSign);
};
function signCheck(db, u, line, pinOk) {
  var _a, _b;
  if (!u || !u.active) return { ok: false, message: "Kh\xF4ng c\xF3 t\xE0i kho\u1EA3n Leader n\xE0y (ho\u1EB7c \u0111\xE3 kh\xF3a)." };
  if (!((_b = (_a = u.perms) == null ? void 0 : _a.specials) == null ? void 0 : _b.lineSign)) return { ok: false, message: `${u.username} ch\u01B0a \u0111\u01B0\u1EE3c c\u1EA5p quy\u1EC1n "Leader giao nh\u1EADn".` };
  if (u.line && line && u.line !== line) return { ok: false, message: `${u.username} l\xE0 Leader ${u.line}, kh\xF4ng k\xFD cho ${line}.` };
  if (!u.hasPin2) return { ok: false, message: `${u.username} ch\u01B0a \u0111\u1EB7t m\u1EADt kh\u1EA9u c\u1EA5p 2 (\u0111\u0103ng nh\u1EADp t\xE0i kho\u1EA3n ${u.username}, b\u1EA5m v\xE0o t\xEAn \u1EDF g\xF3c tr\xEAn \u0111\u1EC3 \u0111\u1EB7t).` };
  if (pin2Locked(db, u.id)) return { ok: false, message: "Sai m\u1EADt kh\u1EA9u c\u1EA5p 2 qu\xE1 5 l\u1EA7n. Th\u1EED l\u1EA1i sau 15 ph\xFAt." };
  const r = pin2Check(db, u.id, pinOk());
  return r.ok ? { ok: true, username: u.username, name: u.name || u.username } : r;
}
function requirePin2(db, user, method, path) {
  if (!PIN2_ROUTES.has(`${method} ${path}`)) return;
  if (!user.hasPin2) throw Object.assign(fail("B\u1EA1n ch\u01B0a \u0111\u1EB7t m\u1EADt kh\u1EA9u c\u1EA5p 2 (b\u1EA5m v\xE0o t\xEAn m\xECnh \u1EDF g\xF3c tr\xEAn).", 428), { code: "pin2_unset" });
  if (!pin2Elevated(db, user.id)) throw Object.assign(fail("C\u1EA7n nh\u1EADp m\u1EADt kh\u1EA9u c\u1EA5p 2.", 428), { code: "pin2" });
}
var permCatalog = () => ({ screens: SCREENS, specials: SPECIALS, roleDefaults: ROLE_DEFAULTS, pin2Minutes: PIN2_MINUTES });

// src/pb-entry.mjs
var ROLE_LABEL = { admin: "Qu\u1EA3n tr\u1ECB", planner: "Planner", kho: "Kho", opkho: "OP kitting kho", line: "Line", approver: "C\u1EA5p duy\u1EC7t" };
var trim3 = (v) => String(v != null ? v : "").trim();
var permsOf = (rec) => {
  const t4 = rec.getString("perms");
  return t4 && t4 !== "null" ? normalizePerms(t4) : null;
};
function publicUser(rec) {
  const role = rec.getString("role");
  return {
    id: rec.id,
    username: rec.getString("username"),
    name: rec.getString("name") || rec.getString("username"),
    role,
    roleLabel: ROLE_LABEL[role] || "",
    line: rec.getString("line"),
    mustChange: rec.getBool("must_change"),
    dept: rec.getString("dept"),
    isHead: rec.getBool("is_head"),
    perms: effectivePerms(role, permsOf(rec)),
    customPerms: !!permsOf(rec),
    hasPin2: !!rec.getString("pin2")
  };
}
var PIN2_ROUNDS = 2e4;
function pin2Hash(pin, salt) {
  let h = pin;
  for (let i = 0; i < PIN2_ROUNDS; i++) h = $security.sha256(salt + h);
  return h;
}
var makePin2 = (pin) => {
  const salt = $security.randomString(16);
  return `s2$${salt}$${pin2Hash(pin, salt)}`;
};
function pin2Ok(stored, pin) {
  const [tag, salt, hash] = String(stored || "").split("$");
  return tag === "s2" && !!salt && $security.equal(pin2Hash(String(pin || ""), salt), hash);
}
function routeTable(app, db) {
  const users = () => app.findCollectionByNameOrId("users");
  const findUser = (id) => {
    try {
      return app.findRecordById("users", trim3(id));
    } catch (e) {
      throw fail("Kh\xF4ng t\xECm th\u1EA5y t\xE0i kho\u1EA3n.", 404);
    }
  };
  const lineOk = (l) => !l || db.prepare("SELECT 1 FROM lines WHERE name = ?").get(l);
  const permInput = (body, cur) => ({
    role: body.role !== void 0 ? trim3(body.role) : cur == null ? void 0 : cur.role,
    dept: body.dept !== void 0 ? trim3(body.dept).slice(0, 40) : cur == null ? void 0 : cur.dept,
    isHead: body.isHead !== void 0 ? !!body.isHead : !!(cur == null ? void 0 : cur.isHead),
    perms: body.perms !== void 0 ? body.perms === null ? null : normalizePerms(body.perms) : void 0
  });
  const userRoutes = [
    { method: "GET", path: "/api/me", handler: ({ user }) => ({ user, today: todayKey(), settings: getSettings(db), perm: permCatalog() }) },
    { method: "GET", path: "/api/admin/users", handler: ({ user }) => {
      const list = app.findAllRecords("users").map((r) => __spreadProps(__spreadValues({}, publicUser(r)), { active: r.getBool("active") ? 1 : 0, created_at: String(r.get("created")), rawPerms: permsOf(r) })).filter((u) => canSeeUser(user, u)).sort((a, b) => a.dept.localeCompare(b.dept) || a.role.localeCompare(b.role) || a.username.localeCompare(b.username));
      const depts = [...new Set(app.findAllRecords("users").map((r) => r.getString("dept")).filter(Boolean))].sort();
      return { users: list, depts, lines: db.prepare("SELECT name FROM lines WHERE active = 1 ORDER BY sort_order, name").all().map((r) => r.name), perm: permCatalog(), me: user };
    } },
    { method: "POST", path: "/api/admin/users", handler: ({ body, user }) => {
      const username = trim3(body == null ? void 0 : body.username).toUpperCase(), next = permInput(body || {}), pw = String((body == null ? void 0 : body.password) || "");
      if (!/^[A-Z0-9._-]{2,30}$/.test(username)) throw fail("M\xE3 NV 2\u201330 k\xFD t\u1EF1: ch\u1EEF, s\u1ED1, . _ -");
      if (!ROLE_LABEL[next.role]) throw fail("Ch\u1ECDn vai tr\xF2.");
      if (user.role !== "admin") next.dept = next.dept || user.dept;
      checkUserChange(user, null, __spreadProps(__spreadValues({}, next), { perms: next.perms || void 0 }));
      checkPassword(pw);
      const line = trim3(body == null ? void 0 : body.line).slice(0, 40);
      if (!lineOk(line)) throw fail("Line kh\xF4ng h\u1EE3p l\u1EC7.");
      if (app.findAllRecords("users").some((r) => r.getString("username") === username)) throw fail("M\xE3 NV \u0111\xE3 c\xF3 t\xE0i kho\u1EA3n.", 409);
      const rec = new Record(users());
      rec.set("username", username);
      rec.set("name", trim3(body == null ? void 0 : body.name).slice(0, 80) || username);
      rec.set("role", next.role);
      rec.set("active", true);
      rec.set("line", line);
      rec.set("dept", next.dept || "");
      rec.set("is_head", next.isHead);
      rec.set("perms", next.perms || null);
      rec.set("email", `${username.toLowerCase().replace(/[^a-z0-9]/g, "")}.${Date.now().toString(36)}@mm.local`);
      rec.setPassword(pw);
      rec.set("must_change", true);
      app.save(rec);
      audit(db, user.username, "user.create", { username, role: next.role, dept: next.dept, isHead: next.isHead, perms: next.perms ? "ri\xEAng" : "theo vai tr\xF2" });
      return { ok: true };
    } },
    { method: "POST", path: "/api/admin/users/update", handler: ({ body, user }) => {
      const rec = findUser(body == null ? void 0 : body.id), cur = publicUser(rec), self = rec.id === user.id, next = permInput(body, cur);
      if (body.role !== void 0 && !ROLE_LABEL[next.role]) throw fail("Vai tr\xF2 kh\xF4ng h\u1EE3p l\u1EC7.");
      if (self && user.role === "admin" && next.role !== "admin") throw fail("Kh\xF4ng t\u1EF1 b\u1ECF quy\u1EC1n Qu\u1EA3n tr\u1ECB c\u1EE7a ch\xEDnh m\xECnh.");
      if (!self || user.role !== "admin") checkUserChange(user, cur, __spreadProps(__spreadValues({}, next), { perms: next.perms || void 0 }));
      if ("active" in body) {
        if (self && !body.active) throw fail("Kh\xF4ng th\u1EC3 kh\xF3a t\xE0i kho\u1EA3n \u0111ang d\xF9ng.");
        rec.set("active", !!body.active);
        if (!body.active) rec.refreshTokenKey();
      }
      rec.set("role", next.role);
      rec.set("dept", next.dept || "");
      rec.set("is_head", next.isHead);
      if (body.perms !== void 0) rec.set("perms", next.perms || null);
      if (body.password) {
        rec.setPassword(checkPassword(body.password));
        if (!self) rec.set("must_change", true);
      }
      if (body.resetPin2) {
        if (user.role !== "admin") throw fail("Ch\u1EC9 Qu\u1EA3n tr\u1ECB x\xF3a m\u1EADt kh\u1EA9u c\u1EA5p 2.", 403);
        rec.set("pin2", "");
      }
      if (body.name) rec.set("name", trim3(body.name).slice(0, 80));
      if ("line" in body) {
        const l = trim3(body.line).slice(0, 40);
        if (!lineOk(l)) throw fail("Line kh\xF4ng h\u1EE3p l\u1EC7.");
        rec.set("line", l);
      }
      app.save(rec);
      audit(db, user.username, "user.update", { username: rec.getString("username"), keys: Object.keys(body).filter((k) => !["id", "password"].includes(k)), password: body.password ? "\u0111\u1EB7t l\u1EA1i" : void 0 });
      return { ok: true };
    } },
    { method: "POST", path: "/api/admin/users/delete", handler: ({ body, user }) => {
      const rec = findUser(body == null ? void 0 : body.id), cur = publicUser(rec);
      if (rec.id === user.id) throw fail("Kh\xF4ng th\u1EC3 x\xF3a t\xE0i kho\u1EA3n \u0111ang d\xF9ng.");
      checkUserChange(user, cur, {});
      if (cur.role === "admin" && app.findAllRecords("users").filter((r) => r.getString("role") === "admin" && r.getBool("active")).length <= 1) throw fail("Kh\xF4ng x\xF3a Qu\u1EA3n tr\u1ECB cu\u1ED1i c\xF9ng.");
      app.delete(rec);
      audit(db, user.username, "user.delete", { username: cur.username, role: cur.role, dept: cur.dept });
      return { ok: true, message: `\u0110\xE3 x\xF3a t\xE0i kho\u1EA3n ${cur.username}.` };
    } },
    // Người dùng tự đổi mật khẩu (bắt buộc ở lần đăng nhập đầu khi must_change = true).
    { method: "POST", path: "/api/me/password", handler: ({ body, user }) => {
      const rec = app.findRecordById("users", user.id), cur = String((body == null ? void 0 : body.current) || ""), pw = checkPassword(body == null ? void 0 : body.password);
      if (!rec.validatePassword(cur)) throw fail("M\u1EADt kh\u1EA9u hi\u1EC7n t\u1EA1i kh\xF4ng \u0111\xFAng.");
      if (pw === cur) throw fail("M\u1EADt kh\u1EA9u m\u1EDBi ph\u1EA3i kh\xE1c m\u1EADt kh\u1EA9u hi\u1EC7n t\u1EA1i.");
      rec.setPassword(pw);
      rec.set("must_change", false);
      app.save(rec);
      audit(db, user.username, "user.password", {});
      return { ok: true, message: "\u0110\xE3 \u0111\u1ED5i m\u1EADt kh\u1EA9u." };
    } },
    // Đặt / đổi mật khẩu cấp 2 (Quản trị, Trưởng bộ phận): xác nhận bằng mật khẩu đăng nhập.
    { method: "POST", path: "/api/me/pin2", handler: ({ body, user }) => {
      if (!needsPin2(user)) throw fail("Ch\u1EC9 Qu\u1EA3n tr\u1ECB / Tr\u01B0\u1EDFng b\u1ED9 ph\u1EADn / Leader giao nh\u1EADn c\u1EA7n m\u1EADt kh\u1EA9u c\u1EA5p 2.", 403);
      const rec = app.findRecordById("users", user.id), pin = checkPin2(body == null ? void 0 : body.pin2);
      if (!rec.validatePassword(String((body == null ? void 0 : body.password) || ""))) throw fail("M\u1EADt kh\u1EA9u \u0111\u0103ng nh\u1EADp kh\xF4ng \u0111\xFAng.");
      if (pin === String(body == null ? void 0 : body.password)) throw fail("M\u1EADt kh\u1EA9u c\u1EA5p 2 ph\u1EA3i kh\xE1c m\u1EADt kh\u1EA9u \u0111\u0103ng nh\u1EADp.");
      rec.set("pin2", makePin2(pin));
      app.save(rec);
      audit(db, user.username, "user.pin2", {});
      return { ok: true, message: "\u0110\xE3 \u0111\u1EB7t m\u1EADt kh\u1EA9u c\u1EA5p 2." };
    } },
    // Xác nhận mật khẩu cấp 2 → mở quyền quản lý tài khoản trong 5 phút. Sai không ném lỗi để lần sai vẫn được ghi (chống dò).
    { method: "POST", path: "/api/me/pin2/verify", handler: ({ body, user }) => {
      if (pin2Locked(db, user.id)) return { ok: false, message: "Sai m\u1EADt kh\u1EA9u c\u1EA5p 2 qu\xE1 5 l\u1EA7n. Th\u1EED l\u1EA1i sau 15 ph\xFAt." };
      const rec = app.findRecordById("users", user.id);
      const r = pin2Result(db, user.id, pin2Ok(rec.getString("pin2"), body == null ? void 0 : body.pin2));
      if (!r.ok) audit(db, user.username, "user.pin2.fail", {});
      return r;
    } }
  ];
  const sign = (username, pin, line) => {
    const name = trim3(username).toUpperCase();
    if (!name) return { ok: false, message: "Nh\u1EADp M\xE3 NV c\u1EE7a Leader giao nh\u1EADn." };
    if (!String(pin || "")) return { ok: false, message: "Nh\u1EADp m\u1EADt kh\u1EA9u c\u1EA5p 2 c\u1EE7a Leader." };
    let rec = null;
    try {
      rec = app.findFirstRecordByData("users", "username", name);
    } catch (e) {
      rec = null;
    }
    const u = rec ? __spreadProps(__spreadValues({}, publicUser(rec)), { active: rec.getBool("active") }) : null;
    const r = signCheck(db, u, line, () => pin2Ok(rec.getString("pin2"), pin));
    if (!r.ok && u) audit(db, name, "sign.fail", { line });
    return r;
  };
  return [...userRoutes, ...coreRoutes(db), ...planRoutes(db), ...kittingRoutes(db), ...bomRoutes(db), ...erpLineRoutes(db, erpHttp), ...erpStockRoutes(db, erpHttp), ...bomChangeRoutes(db), ...receiptRoutes(db, sign)];
}
function erpHttp(c) {
  return (path) => {
    try {
      const r = $http.send({ url: c.url + path, method: "GET", timeout: 30, headers: { Authorization: `token ${c.key}:${c.secret}`, Accept: "application/json" } });
      return { status: r.statusCode, json: r.statusCode >= 200 && r.statusCode < 300 ? r.json : null };
    } catch (x) {
      return { status: 0, json: null };
    }
  };
}
function cronErpLines() {
  inTx((tx2) => {
    if (clearExpiredPending(makeDb(tx2))) bumpEvents(tx2, "lines/pending");
  });
  inTx((tx2) => {
    if (applyDueChanges(makeDb(tx2))) bumpEvents(tx2, "bom/change");
  });
  inTx((tx2) => {
    if (settleLoads(makeDb(tx2))) bumpEvents(tx2, "prod/load");
  });
  const { result, err } = inTx((tx2) => {
    const r = syncErpLines(makeDb(tx2), erpHttp, { username: "ERP", source: "ERP t\u1EF1 \u0111\u1ED9ng 15 ph\xFAt", auto: true });
    if (r.added || r.changed || r.removed) bumpEvents(tx2, "lines/erp");
    return r;
  });
  if (err) console.error(`[mm] ERP line sync: ${err.message || err}`);
  const src = { username: "ERP", source: "ERP t\u1EF1 \u0111\u1ED9ng 15 ph\xFAt", auto: true };
  const st = inTx((tx2) => {
    const r = syncErpStock(makeDb(tx2), erpHttp, src);
    if (r.ok && r.changed) bumpEvents(tx2, "kho/stock");
    return r;
  });
  if (st.err) console.error(`[mm] ERP stock sync: ${st.err.message || st.err}`);
  const bm = inTx((tx2) => {
    const r = syncErpBom(makeDb(tx2), erpHttp, src);
    if (r.ok && r.applied) bumpEvents(tx2, "bom/erp");
    return r;
  });
  if (bm.err) console.error(`[mm] ERP BOM sync: ${bm.err.message || bm.err}`);
  return { lines: result, stock: st.result, bom: bm.result };
}
function handle(app, req) {
  const db = makeDb(app);
  const route = routeTable(app, db).find((r) => r.method === req.method && r.path === req.path);
  if (!route) throw fail("Kh\xF4ng t\xECm th\u1EA5y API.", 404);
  checkAccess(req.user, req.method, req.path);
  requirePin2(db, req.user, req.method, req.path);
  return route.handler({ query: req.query, body: req.body || {}, user: req.user });
}
function externalPo(app, body) {
  const db = makeDb(app);
  const source = trim3(body == null ? void 0 : body.source) || "API";
  return __spreadValues({ ok: true }, syncPoRows(db, cleanPoRows(body == null ? void 0 : body.rows), { source: `API: ${source}`.slice(0, 120), username: "api", fullSnapshot: (body == null ? void 0 : body.fullSnapshot) === true }));
}
function externalProduction(app, body) {
  const db = makeDb(app);
  const source = trim3(body == null ? void 0 : body.source) || "QR";
  return __spreadValues({ ok: true }, updateProduction(db, cleanProdRows(body == null ? void 0 : body.rows), { source: `API: ${source}`.slice(0, 120), username: "api" }));
}
var externalMesPlan = (app, body, opts) => syncMesPlan(makeDb(app), body, opts);
function hasUsers(app) {
  return app.countRecords("users") > 0;
}
function bumpEvents(tx2, topic) {
  const ev = tx2.findRecordById("mm_events", "kittingevents01");
  ev.set("n", (ev.getInt("n") + 1) % 1e9);
  ev.set("topic", String(topic).slice(0, 40));
  tx2.save(ev);
}
function readBody(e) {
  try {
    return JSON.parse(JSON.stringify(e.requestInfo().body || {}));
  } catch (_) {
    return {};
  }
}
function inTx(fn) {
  let result, err = null;
  try {
    $app.runInTransaction((tx2) => {
      try {
        result = fn(tx2);
      } catch (x) {
        err = x;
        throw x;
      }
    });
  } catch (x) {
    if (!err) err = x;
  }
  return { result, err };
}
function reply(e, label, { result, err }) {
  if (err) {
    const status = Number(err && err.status) || 500;
    if (status >= 500) console.error(`[mm] ${label}: ${err && err.message || err}`);
    return e.json(status, __spreadValues({ error: status >= 500 ? `L\u1ED7i m\xE1y ch\u1EE7: ${err && err.message || err}` : err.message }, err && err.code ? { code: err.code } : {}));
  }
  return e.json(200, result === void 0 ? { ok: true } : result);
}
function serve(e, method) {
  const path = "/api/" + e.request.pathValue("path");
  if (method === "GET" && path === "/api/status") return e.json(200, { setupRequired: !hasUsers($app), demo: false });
  const a = e.auth;
  if (!a || a.collection().name !== "users") return e.json(401, { error: "Vui l\xF2ng \u0111\u0103ng nh\u1EADp." });
  if (!a.getBool("active")) return e.json(401, { error: "T\xE0i kho\u1EA3n \u0111\xE3 b\u1ECB kh\xF3a." });
  const user = publicUser(a), body = method === "GET" ? {} : readBody(e);
  const values = e.request.url.query();
  const query = { get: (k) => {
    const v = values.get(k);
    return v === "" ? null : v;
  } };
  return reply(e, `${method} ${path}`, inTx((tx2) => {
    const r = handle(tx2, { method, path, query, body, user });
    if (method !== "GET") bumpEvents(tx2, path.slice(5));
    return r;
  }));
}
var apiKeyOk = (e) => {
  const key2 = $os.getenv("MM_API_KEY") || "", given = e.request.header.get("X-MM-Key") || "";
  return key2.length >= 16 && given.length === key2.length && given === key2;
};
function servePoApi(e) {
  if (!apiKeyOk(e)) return e.json(401, { error: "Sai ho\u1EB7c ch\u01B0a c\u1EA5u h\xECnh kh\xF3a API." });
  const body = readBody(e);
  return reply(e, "POST /api/mmx/po", inTx((tx2) => {
    const r = externalPo(tx2, body);
    bumpEvents(tx2, "po/api");
    return r;
  }));
}
function serveMesPlanApi(e) {
  if (!apiKeyOk(e)) return e.json(401, { error: "Sai ho\u1EB7c ch\u01B0a c\u1EA5u h\xECnh kh\xF3a API." });
  const body = readBody(e), dry = e.request.url.query().get("dry") === "1";
  return reply(e, "POST /api/mmx/po-plan", inTx((tx2) => {
    const r = externalMesPlan(tx2, body, { dry });
    if (!dry && (r.inserted || r.updated)) bumpEvents(tx2, "po/api");
    return r;
  }));
}
function serveProdApi(e) {
  if (!apiKeyOk(e)) return e.json(401, { error: "Sai ho\u1EB7c ch\u01B0a c\u1EA5u h\xECnh kh\xF3a API." });
  const body = readBody(e);
  return reply(e, "POST /api/mmx/production", inTx((tx2) => {
    const r = externalProduction(tx2, body);
    bumpEvents(tx2, "po/production");
    return r;
  }));
}
