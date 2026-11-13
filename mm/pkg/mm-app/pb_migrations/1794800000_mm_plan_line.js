/// <reference path="../pb_data/types.d.ts" />
// Line dự kiến của Kit (Planner nhập kế hoạch kitting từ Excel): chỉ hiện cho Kho / phiếu in, giao Line khác chỉ cảnh báo.
migrate((app) => {
  try { app.db().newQuery('ALTER TABLE kit_order ADD COLUMN plan_line TEXT').execute(); } catch (_) { }   // cột đã có thì bỏ qua
}, (app) => { });
