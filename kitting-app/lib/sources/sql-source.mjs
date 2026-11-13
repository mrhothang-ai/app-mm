// PoSource SQL — dành cho giai đoạn sau, khi có thông tin kết nối máy chủ SQL.
// Chỉ cần trả về mảng PO có cùng cấu trúc với readPoWorkbook():
//   { po, planDate:'YYYY-MM-DD', masterLine, basicModel, modelCode, planQty, productionQty, remainQty,
//     planStatus, planStart:'YYYY-MM-DDTHH:mm', planEnd, poChange, pendingType }
// Gợi ý: tạo một VIEW trên SQL Server trả đúng các cột trên, cài gói "mssql" vào node_modules,
// rồi đặt PO_SOURCE=sql và chuỗi kết nối trong .env. Phần còn lại của app không phải sửa.
export async function readPoFromSql() {
  throw new Error('Nguồn SQL chưa được cấu hình. Hiện app đọc PO từ file Excel Production Plan by Order.');
}
