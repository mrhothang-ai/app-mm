// PoSource: đọc file PO của Planner — "Order List" (SAP, .xls/.xlsx) hoặc "Production Plan by Order" (Plan Master). Trả về danh sách PO đã chuẩn hóa.
// Đọc theo bảng (mảng dòng × ô): .xlsx qua ExcelJS, .xls qua SheetJS (trình duyệt) — cùng một logic tìm cột.
// Muốn đổi sang SQL chỉ cần một nguồn khác trả về cùng cấu trúc (xem sql-source.mjs).
import ExcelJS from 'exceljs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const key = v => String(v ?? '').replace(/[đĐ]/g, 'd').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Order List: Prod. Order No. = PO, Prod. Material = Model Code, Scheduled Start = Plan Date, Work Center = Master Line,
// Top Start / Finish Date + Time = Plan Start / End.
const COLUMNS = {
  planDate: ['plandate', 'scheduledstart'], masterLine: ['masterline', 'workcenter'], basicModel: ['basicmodel'], modelCode: ['modelcode', 'prodmaterial'],
  po: ['po', 'pono', 'prodorderno'], planQty: ['planqty', 'plan'], productionQty: ['productionqty', 'production'],
  remainQty: ['remainqty', 'remain'], planStatus: ['planstatus', 'status'], planStart: ['planstarttime'],
  planEnd: ['planendtime'], span: ['estprodspantime', 'spantime'], poChange: ['pochange'], pendingType: ['pendingtype'],
  startDate: ['topstartdate'], startTime: ['topstarttime'], endDate: ['topfinishdate'], endTime: ['topfinishtime']
};
const REQUIRED = ['po', 'modelCode', 'planQty'];
// File cập nhật sản xuất (tab Quản trị): PO + Production lũy kế; Remain, Status tùy chọn. Order List có cột Confirm Qty cũng dùng được.
const PROD_COLUMNS = { po: ['po', 'pono', 'prodorderno'], productionQty: ['productionqty', 'production', 'confirmqty', 'sanluong', 'prodq'], remainQty: ['remainqty', 'remain'], status: ['status', 'planstatus', 'trangthai'] };

function plain(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if ('result' in value) return plain(value.result);
    if (Array.isArray(value.richText)) return value.richText.map(p => p.text).join('');
    if ('text' in value) return value.text;
    return null;
  }
  return value;
}
const pad = n => String(n).padStart(2, '0');
function toDate(value) {
  const v = plain(value);
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === 'number') { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000); return toDate(d); }
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/); if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return '';
}
function toDateTime(value) {
  const v = plain(value);
  if (v instanceof Date) return `${toDate(v)}T${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
  if (typeof v === 'number') return toDateTime(new Date(Math.round((v - 25569) * 1440) * 60000));
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{4}-\d{1,2}-\d{1,2})[T\s]+(\d{1,2}):(\d{2})/);
  return m ? `${toDate(m[1])}T${pad(m[2])}:${m[3]}` : '';
}
// Ô giờ riêng (Top Start Time 08:47:06 / số thập phân của ngày / Date) → "HH:MM".
function toTime(value) {
  const v = plain(value);
  if (v instanceof Date) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
  if (typeof v === 'number') { const m = Math.round((v % 1) * 1440); return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`; }
  const m = String(v ?? '').match(/(\d{1,2}):(\d{2})/);
  return m ? `${pad(m[1])}:${m[2]}` : '';
}
const joinDateTime = (d, t) => { const day = toDate(d), hm = toTime(t); return day && hm ? `${day}T${hm}` : ''; };
// Est. Prod. Span Time: ô giờ (03:12:00) → "03:12".
function toSpan(value) {
  const v = plain(value);
  if (v instanceof Date) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
  if (typeof v === 'number') { const m = Math.round(v * 1440); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; }
  const s = String(v ?? '').trim(), m = s.match(/(\d{1,3}):(\d{2})/);
  return m ? `${pad(m[1])}:${m[2]}` : '';
}
function num(value, label, rowNumber) {
  const v = plain(value);
  if (v === null || v === '') return 0;
  const n = Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new Error(`Dòng ${rowNumber}: cột ${label} không phải số.`);
  return n;
}

// Sheet ExcelJS → bảng (mảng dòng, mỗi dòng mảng ô; ô đã bỏ công thức / rich text).
export function sheetTable(sheet) {
  const out = [];
  for (let r = 1; r <= sheet.rowCount; r++) { const row = []; sheet.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => { row[c - 1] = plain(cell.value); }); out.push(row); }
  return out;
}
async function workbookTable(buffer, fileName) {
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer); }
  catch (error) { throw new Error(`Không đọc được ${fileName}: ${error.message}`); }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error(`${fileName} không có sheet nào.`);
  return sheetTable(sheet);
}
// Tìm dòng tiêu đề trong 6 dòng đầu (Plan Master: dòng 2, Order List: dòng 3).
function findHeader(table, columns, required) {
  for (let r = 0; r < Math.min(6, table.length); r++) {
    const found = {};
    (table[r] || []).forEach((v, c) => { const k = key(v); for (const [name, aliases] of Object.entries(columns)) if (aliases.includes(k) && !(name in found)) found[name] = c; });
    if (required.every(name => name in found)) return { headerRow: r, cols: found };
  }
  return null;
}

export function readPoTable(table, fileName = 'file') {
  const h = findHeader(table, COLUMNS, REQUIRED);
  if (!h) throw new Error(`${fileName} không đúng mẫu file PO: cần các cột PO (Prod. Order No.), Model Code (Prod. Material), Plan Q'ty.`);
  const rows = [];
  let lastDate = '';
  for (let r = h.headerRow + 1; r < table.length; r++) {
    const row = table[r] || [], get = name => h.cols[name] !== undefined ? row[h.cols[name]] : null, str = name => String(plain(get(name)) ?? '').trim();
    const dateCell = toDate(get('planDate'));
    if (dateCell) lastDate = dateCell;        // Plan Master chỉ ghi Plan Date ở dòng đầu mỗi nhóm
    const po = str('po'), modelCode = str('modelCode');
    if (!po || !modelCode || po === '0') continue;
    rows.push({
      po, planDate: lastDate, masterLine: str('masterLine'), basicModel: str('basicModel'), modelCode,
      planQty: num(get('planQty'), "Plan Q'ty", r + 1), productionQty: num(get('productionQty'), "Production Q'ty", r + 1),
      remainQty: num(get('remainQty'), "Remain Q'ty", r + 1), planStatus: str('planStatus'),
      planStart: toDateTime(get('planStart')) || joinDateTime(get('startDate'), get('startTime')),
      planEnd: toDateTime(get('planEnd')) || joinDateTime(get('endDate'), get('endTime')), span: toSpan(get('span')),
      poChange: str('poChange'), pendingType: str('pendingType')
    });
  }
  if (!rows.length) throw new Error(`${fileName} không có dòng PO nào.`);
  return rows;
}
export async function readPoWorkbook(buffer, fileName = 'file') { return readPoTable(await workbookTable(buffer, fileName), fileName); }

// File cập nhật sản xuất: dòng thiếu Production thì bỏ qua (VD Order List chưa có Confirm Qty).
export function readProdTable(table, fileName = 'file') {
  const h = findHeader(table, PROD_COLUMNS, ['po', 'productionQty']);
  if (!h) throw new Error(`${fileName} không đúng mẫu cập nhật sản xuất: cần cột PO và Production Q'ty.`);
  const rows = [];
  let skipped = 0;
  for (let r = h.headerRow + 1; r < table.length; r++) {
    const row = table[r] || [], get = name => h.cols[name] !== undefined ? plain(row[h.cols[name]]) : null, str = name => String(get(name) ?? '').trim();
    const po = str('po');
    if (!po) continue;
    if (str('productionQty') === '') { skipped++; continue; }
    rows.push({ po, productionQty: num(get('productionQty'), "Production Q'ty", r + 1), remainQty: str('remainQty') === '' ? null : num(get('remainQty'), "Remain Q'ty", r + 1), status: str('status') });
  }
  if (!rows.length) throw new Error(`${fileName} không có dòng nào có Production Q'ty.`);
  return { rows, skipped };
}
export async function readProdWorkbook(buffer, fileName = 'file') { return readProdTable(await workbookTable(buffer, fileName), fileName); }
// File JSON / dữ liệu của trình nhận QR (qr-receiver, ILSQ v1): { schema: ['PO','Model','PlanQ','ProdQ','Remain','Status'], rows, mode, merged, epoch, shaOk }.
// SHA-256 sai → từ chối. Bản delta chưa ghép bản gốc chỉ có dòng thay đổi → vẫn nhận (chỉ cập nhật PO có trong file).
export function readProdQr(obj, fileName = 'QR') {
  if (!obj || !Array.isArray(obj.schema) || !Array.isArray(obj.rows)) throw new Error(`${fileName} không phải dữ liệu của trình nhận QR (thiếu schema / rows).`);
  if (obj.shaOk === false) throw new Error(`${fileName}: SHA-256 không khớp — dữ liệu QR hỏng, hãy nhận lại.`);
  const r = readProdTable([obj.schema, ...obj.rows], fileName);
  return { ...r, mode: obj.mode || 'full', merged: !!obj.merged, epoch: obj.epoch ?? null, partial: obj.mode === 'delta' && !obj.merged };
}

function patternToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}
// Lấy file mới nhất trong thư mục nguồn (giống app Nhận Rear).
export async function findNewestSource(folder, pattern) {
  let names;
  try { names = await readdir(folder); } catch { throw new Error(`Không mở được thư mục nguồn: ${folder}`); }
  const matcher = patternToRegex(pattern), found = [];
  for (const name of names) {
    if (name.startsWith('~$') || !matcher.test(name)) continue;
    const file = path.join(folder, name);
    try { const info = await stat(file); if (info.isFile()) found.push({ file, name, mtimeMs: info.mtimeMs, size: info.size }); } catch { /* bỏ qua */ }
  }
  if (!found.length) throw new Error(`Không thấy file "${pattern}" trong ${folder}`);
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
}
