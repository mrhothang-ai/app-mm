// Đọc file Excel PO / BOM / cập nhật sản xuất ngay trên trình duyệt rồi gửi dữ liệu đã chuẩn hóa lên server.
// .xlsx đọc bằng ExcelJS; .xls (Excel 97-2003, VD Order List xuất từ SAP) đọc bằng SheetJS (window.XLSX, nạp khi cần).
import ExcelJS from 'exceljs';
import { readPoWorkbook, readPoTable, readProdWorkbook, readProdTable, readProdQr, sheetTable } from '../../kitting-app/lib/sources/excel-source.mjs';
export { readBomWorkbook } from '../../kitting-app/lib/bom-read.mjs';
export { readPoWorkbook };

// File .xls cũ bắt đầu bằng chữ ký OLE D0 CF 11 E0.
export const isXls = buffer => { const b = new Uint8Array(buffer.slice(0, 4)); return b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0; };
function xlsTable(buffer) {
  const X = globalThis.XLSX;
  if (!X) throw new Error('Chưa nạp thư viện đọc file .xls.');
  const wb = X.read(buffer, { type: 'array' }), ws = wb.Sheets[wb.SheetNames[0]];
  return X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
}
export async function readPoFile(buffer, fileName) { return isXls(buffer) ? readPoTable(xlsTable(buffer), fileName) : readPoWorkbook(buffer, fileName); }
export function readProdJson(text, fileName) { let o; try { o = JSON.parse(text); } catch { throw new Error(`${fileName} không phải file JSON hợp lệ.`); } return readProdQr(o, fileName); }
export async function readProdFile(buffer, fileName) { return isXls(buffer) ? readProdTable(xlsTable(buffer), fileName) : readProdWorkbook(buffer, fileName); }

// File kế hoạch kitting của Planner: gửi bảng thô của mọi sheet (tối đa 12 sheet × 3.000 dòng × 30 cột), server tự nhận dạng kiểu sheet.
const trimTable = t => t.slice(0, 3000).map(r => (r || []).slice(0, 30).map(v => v instanceof Date ? v.toISOString() : v ?? ''));
export async function readPlanFile(buffer, fileName) {
  if (isXls(buffer)) {
    const X = globalThis.XLSX; if (!X) throw new Error('Chưa nạp thư viện đọc file .xls.');
    const wb = X.read(buffer, { type: 'array', cellDates: true });
    return { fileName, sheets: wb.SheetNames.slice(0, 12).map(name => ({ name, rows: trimTable(X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' })) })) };
  }
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch (e) { throw new Error(`Không đọc được ${fileName}: ${e.message}`); }
  return { fileName, sheets: wb.worksheets.slice(0, 12).map(ws => ({ name: ws.name, rows: trimTable(sheetTable(ws)) })) };
}
