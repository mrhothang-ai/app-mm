// Đọc file BOM Excel (chạy trên trình duyệt / Node, không chạy trong PocketBase).
import ExcelJS from 'exceljs';
import { fail } from './db.mjs';
import { normalizeGroup } from './bom.mjs';

const key = v => String(v ?? '').replace(/[đĐ]/g, 'd').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const plain = v => (v && typeof v === 'object' && !(v instanceof Date)) ? ('result' in v ? v.result : Array.isArray(v.richText) ? v.richText.map(p => p.text).join('') : 'text' in v ? v.text : null) : v;
const text = v => String(plain(v) ?? '').trim();

export async function readBomWorkbook(buffer, fileName = 'file') {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch (error) { throw fail(`Không đọc được ${fileName}: ${error.message}`); }
  const modelMap = new Map(), modelName = new Map();
  // Tên Model gõ lệch hoa thường / thừa dấu cách (F731 MAIN, F731 Main) → dùng chung tên gặp đầu tiên.
  const canon = m => { const s = m.replace(/\s+/g, ' '), k = s.toUpperCase(); if (!modelName.has(k)) modelName.set(k, s); return modelName.get(k); };
  const mapSheet = wb.worksheets.find(s => ['bomcode', 'modelmap'].includes(key(s.name)));
  if (mapSheet) for (let r = 2; r <= mapSheet.rowCount; r++) {
    const code = text(mapSheet.getRow(r).getCell(1).value), model = canon(text(mapSheet.getRow(r).getCell(2).value));
    if (code && model && !modelMap.has(code)) modelMap.set(code, model);
  }
  const sheet = wb.worksheets.find(s => key(s.name) === 'bom') || wb.worksheets[0];
  let headerRow = 0, cols = {};
  for (let r = 1; r <= Math.min(5, sheet.rowCount) && !headerRow; r++) {
    const found = {};
    sheet.getRow(r).eachCell((cell, c) => {
      const k = key(plain(cell.value));
      if (['model', 'basicmodel'].includes(k)) found.model ??= c;
      if (['modelcode', 'parentcode'].includes(k)) found.modelCode ??= c;   // file nhà máy: Parent Code
      if (['material', 'materialcode'].includes(k)) found.material ??= c;
      if (['description', 'mota'].includes(k)) found.description ??= c;
      if (['point', 'qty'].includes(k)) found.point ??= c;                   // file nhà máy: Qty
      if (['congdoan', 'process'].includes(k)) found.process ??= c;
      if (['nhomkitting', 'nhom', 'kitgroup', 'group'].includes(k)) found.group ??= c;
    });
    if (found.modelCode && found.material && found.point) { headerRow = r; cols = found; }
  }
  if (!headerRow) throw fail(`${fileName}: sheet BOM cần các cột Model code (hoặc Parent Code), Material, Point (hoặc Qty); thêm cột "Nhóm kitting" nếu có.`);
  const rows = [], seen = new Map(), bomModel = new Map();
  let dup = 0;
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r), get = c => c ? row.getCell(c).value : null;
    const modelCode = text(get(cols.modelCode)), material = text(get(cols.material));
    if (!modelCode && !material) continue;
    if (!modelCode || !material) throw fail(`${fileName} dòng ${r}: cần cả Model code và Material.`);
    const point = Number(String(plain(get(cols.point)) ?? '').replace(/,/g, ''));
    if (!Number.isFinite(point) || point <= 0) throw fail(`${fileName} dòng ${r}: Point phải lớn hơn 0.`);
    const k = `${modelCode}\u001f${material}`.toLowerCase();
    if (seen.has(k)) {
      // Dòng lặp y hệt (cùng Point) thì bỏ qua; khác Point thì báo lỗi để sửa file.
      if (seen.get(k) === point) { dup++; continue; }
      throw fail(`${fileName} dòng ${r}: ${material} bị lặp trong Model code ${modelCode} với Point khác (${seen.get(k)} và ${point}).`);
    }
    seen.set(k, point);
    let group;
    try { group = normalizeGroup(text(get(cols.group))); } catch (error) { throw fail(`${fileName} dòng ${r}: ${error.message}`); }
    const model = canon(text(get(cols.model)));
    if (model && !bomModel.has(modelCode)) bomModel.set(modelCode, model);
    rows.push({ modelCode, material, description: text(get(cols.description)), point, process: text(get(cols.process)), group });
  }
  if (!rows.length) throw fail(`${fileName}: sheet BOM chưa có dòng vật tư.`);
  for (const [code, model] of bomModel) if (!modelMap.has(code)) modelMap.set(code, model);
  // Sheet "BOM VLN" (tùy chọn, từ file app xuất ra): Model | Material | Point — giữ Point VLN đã chỉnh tay.
  const vln = [], vs = wb.worksheets.find(s => key(s.name) === 'bomvln');
  if (vs) for (let r = 2; r <= vs.rowCount; r++) {
    const row = vs.getRow(r), model = text(row.getCell(1).value), material = text(row.getCell(2).value), point = Number(plain(row.getCell(4).value) ?? plain(row.getCell(3).value));
    if (model && material && point > 0) vln.push({ model, material, point });
  }
  return { rows, modelMap, vln, dup };
}

