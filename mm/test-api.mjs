import { readPoWorkbook, readPoTable, readProdQr, readProdTable } from '../kitting-app/lib/sources/excel-source.mjs';
import XLSX from 'xlsx';
import { readBomWorkbook } from '../kitting-app/lib/bom-read.mjs';
import fs from 'node:fs';
const B = process.env.PB || 'http://127.0.0.1:8197';
let pass = 0, failN = 0;
const r3x = n => Math.round(n * 1000) / 1000;
const ok = (c, m) => { if (c) pass++; else { failN++; console.log('  ✗', m); } };
async function call(path, { token, json, method } = {}) {
  const r = await fetch(B + path, { method: method || (json ? 'POST' : 'GET'), headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: token } : {}) }, body: json ? JSON.stringify(json) : undefined });
  const d = await r.json().catch(() => ({})); return { status: r.status, d };
}
const su = (await call('/api/collections/_superusers/auth-with-password', { json: { identity: 'admin@test.local', password: 'Admin12345678' } })).d.token;
// tài khoản quản trị đầu tiên (như tạo trong trang Admin)
let r = await call('/api/collections/users/records', { token: su, json: { username: 'AD001', name: 'Quản trị', role: 'admin', active: true, password: 'Admin2026', passwordConfirm: 'Admin2026' } });
ok(r.status === 200, 'tạo admin qua superuser ' + JSON.stringify(r.d));
const login = async (u, p) => (await call('/api/collections/users/auth-with-password', { json: { identity: u, password: p } }));
r = await login('ad001', 'Admin2026'); ok(r.status === 200, 'đăng nhập chữ thường ' + JSON.stringify(r.d));
const A = r.d.token;
r = await call('/api/mm/me', { token: A }); ok(r.d.user?.role === 'admin' && r.d.today, 'me ' + JSON.stringify(r.d).slice(0, 120));
// mật khẩu cấp 2: quản lý tài khoản phải xác nhận (5 phút)
r = await call('/api/mm/admin/users', { token: A, json: { username: 'Z1', role: 'planner', password: 'Kitting2468' } }); ok(r.status === 428 && r.d.code === 'pin2_unset', 'chưa đặt MK cấp 2 ' + JSON.stringify(r.d));
r = await call('/api/mm/me/pin2', { token: A, json: { password: 'sai12345', pin2: '135790' } }); ok(r.status === 400, 'đặt MK cấp 2 sai mật khẩu đăng nhập');
r = await call('/api/mm/me/pin2', { token: A, json: { password: 'Admin2026', pin2: '135790' } }); ok(r.d.ok, 'đặt MK cấp 2');
r = await call('/api/mm/admin/users', { token: A, json: { username: 'Z1', role: 'planner', password: 'Kitting2468' } }); ok(r.status === 428 && r.d.code === 'pin2', 'cần xác nhận MK cấp 2');
r = await call('/api/mm/me/pin2/verify', { token: A, json: { pin2: '000000' } }); ok(r.d.ok === false, 'MK cấp 2 sai');
r = await call('/api/mm/me/pin2/verify', { token: A, json: { pin2: '135790' } }); ok(r.d.ok === true && r.d.minutes === 5, 'xác nhận MK cấp 2');
// tạo người dùng
for (const [u, role] of [['PL01', 'planner'], ['KH01', 'kho'], ['LN01', 'line'], ['DY01', 'approver']]) {
  r = await call('/api/mm/admin/users', { token: A, json: { username: u.toLowerCase(), name: u, role, password: 'Kitting2468' } }); ok(r.d.ok, 'tạo ' + u + JSON.stringify(r.d));
}
r = await call('/api/mm/admin/users', { token: A, json: { username: 'PL01', role: 'planner', password: 'Kitting2468' } }); ok(r.status === 409, 'trùng mã NV');
r = await call('/api/mm/admin/users', { token: A, json: { username: 'X1', role: 'planner', password: '12345678' } }); ok(r.status === 400, 'mật khẩu chỉ có số bị chặn');
const T = {}; for (const u of ['PL01', 'KH01', 'LN01', 'DY01']) T[u] = (await login(u, 'Kitting2468')).d.token;
ok(Object.values(T).every(Boolean), 'đăng nhập 4 vai trò');
// mật khẩu tạm do Quản trị đặt → phải đổi; đổi xong token cũ hết hạn, đăng nhập bằng mật khẩu mới
r = await call('/api/mm/me', { token: T.PL01 }); ok(r.d.user.mustChange === true, 'tài khoản mới phải đổi mật khẩu');
r = await call('/api/mm/me/password', { token: T.PL01, json: { current: 'sai12345', password: 'Planner2026' } }); ok(r.status === 400, 'sai mật khẩu hiện tại');
r = await call('/api/mm/me/password', { token: T.PL01, json: { current: 'Kitting2468', password: 'abcdefgh' } }); ok(r.status === 400, 'mật khẩu mới yếu bị chặn');
r = await call('/api/mm/me/password', { token: T.PL01, json: { current: 'Kitting2468', password: 'Planner2026' } }); ok(r.d?.ok, 'đổi mật khẩu ' + JSON.stringify(r.d));
r = await call('/api/mm/me', { token: T.PL01 }); ok(r.status === 401, 'token cũ hết hạn sau đổi mật khẩu ' + r.status);
T.PL01 = (await login('PL01', 'Planner2026')).d?.token; r = await call('/api/mm/me', { token: T.PL01 }); ok(r.d?.user?.mustChange === false, 'đăng nhập mật khẩu mới, hết bắt đổi');
// người dùng không được tự sửa vai trò qua REST
const meRec = (await call('/api/collections/users/auth-refresh', { token: T.LN01, json: {} })).d.record;
r = await call(`/api/collections/users/records/${meRec.id}`, { token: T.LN01, json: { role: 'admin' }, method: 'PATCH' }); ok(r.status >= 400, 'chặn tự nâng quyền ' + r.status);
r = await call('/api/collections/users/records', { json: { username: 'HACK', role: 'admin', active: true, password: 'Hack12345', passwordConfirm: 'Hack12345' } }); ok(r.status >= 400, 'chặn tự đăng ký ' + r.status);
r = await call('/api/mm/admin/users', { token: T.PL01 }); ok(r.status === 403, 'planner không vào quản trị');
ok(!('pin2' in meRec) && !('perms' in meRec && meRec.pin2), 'REST không trả MK cấp 2');
// phân quyền chi tiết: quyền mặc định theo vai trò, chỉnh riêng từng màn hình, server chặn theo quyền
r = await call('/api/mm/me', { token: T.PL01 }); ok(r.d.user.perms.screens.board === 2 && r.d.user.perms.screens.kitpad === 0 && r.d.perm.screens.length === 9, 'quyền mặc định Planner');
r = await call('/api/mm/report/kitting', { token: T.PL01 }); ok(r.status === 200, 'Planner xem báo cáo');
const ids = Object.fromEntries((await call('/api/mm/admin/users', { token: A })).d.users.map(u => [u.username, u.id]));
const custom = (await call('/api/mm/me', { token: T.PL01 })).d.user.perms; custom.screens.report = 0;
r = await call('/api/mm/admin/users/update', { token: A, json: { id: ids.PL01, perms: custom } }); ok(r.d.ok, 'admin chỉnh quyền riêng');
r = await call('/api/mm/report/kitting', { token: T.PL01 }); ok(r.status === 403, 'ẩn màn Báo cáo → API bị chặn');
r = await call('/api/mm/admin/users/update', { token: A, json: { id: ids.PL01, perms: null } }); r = await call('/api/mm/report/kitting', { token: T.PL01 }); ok(r.status === 200, 'trả về quyền theo vai trò');
r = await call('/api/mm/kho/deliver', { token: T.PL01, json: { kitId: 1, line: 'x' } }); ok(r.status === 403, 'Planner không có quyền Giao Line');
// Trưởng bộ phận: chỉ quản lý tài khoản cùng bộ phận, không cấp quá quyền mình, có MK cấp 2 riêng
r = await call('/api/mm/admin/users', { token: A, json: { username: 'TK01', role: 'kho', dept: 'Kho', isHead: true, password: 'Kitting2468' } }); ok(r.d.ok, 'tạo Trưởng BP Kho');
r = await call('/api/mm/admin/users', { token: A, json: { username: 'KH05', role: 'kho', dept: 'Kho', password: 'Kitting2468' } }); ok(r.d.ok, 'tạo NV Kho');
let H = (await login('TK01', 'Kitting2468')).d.token;
await call('/api/mm/me/password', { token: H, json: { current: 'Kitting2468', password: 'TruongKho2026' } }); H = (await login('TK01', 'TruongKho2026')).d.token;
r = await call('/api/mm/admin/users', { token: H }); ok(r.status === 200 && r.d.users.every(u => u.dept === 'Kho' && u.role !== 'admin') && r.d.users.some(u => u.username === 'KH05') && !r.d.users.some(u => u.username === 'PL01'), 'Trưởng BP chỉ thấy bộ phận mình ' + JSON.stringify(r.d.users?.map(u => u.username)));
await call('/api/mm/me/pin2', { token: H, json: { password: 'TruongKho2026', pin2: '864200' } }); r = await call('/api/mm/me/pin2/verify', { token: H, json: { pin2: '864200' } }); ok(r.d.ok, 'Trưởng BP xác nhận MK cấp 2');
r = await call('/api/mm/admin/users', { token: H, json: { username: 'OP05', role: 'opkho', password: 'Kitting2468' } }); ok(r.d.ok, 'Trưởng BP tạo NV trong bộ phận');
r = await call('/api/mm/admin/users', { token: H, json: { username: 'AD09', role: 'admin', password: 'Kitting2468' } }); ok(r.status === 403, 'Trưởng BP không tạo Quản trị');
r = await call('/api/mm/admin/users', { token: H, json: { username: 'PL09', role: 'planner', dept: 'Kế hoạch', password: 'Kitting2468' } }); ok(r.status === 403, 'Trưởng BP không tạo ngoài bộ phận');
const hp = (await call('/api/mm/me', { token: H })).d.user.perms; hp.screens.report = 2;
r = await call('/api/mm/admin/users/update', { token: H, json: { id: ids.KH01, perms: hp } }); ok(r.status === 403, 'Trưởng BP không sửa NV ngoài bộ phận');
const khId = (await call('/api/mm/admin/users', { token: H })).d.users.find(u => u.username === 'KH05').id;
r = await call('/api/mm/admin/users/update', { token: H, json: { id: khId, perms: hp } }); ok(r.status === 403, 'Trưởng BP không cấp quá quyền mình');
r = await call('/api/mm/admin/users/delete', { token: H, json: { id: khId } }); ok(r.d.ok, 'Trưởng BP xóa NV bộ phận');
r = await call('/api/mm/admin/settings', { token: H }); ok(r.status === 403, 'Trưởng BP không vào Thông số');
for (let i = 0; i < 5; i++) await call('/api/mm/me/pin2/verify', { token: H, json: { pin2: 'sai999' } });
r = await call('/api/mm/me/pin2/verify', { token: H, json: { pin2: '864200' } }); ok(r.d.ok === false && /15 phút/.test(r.d.message), 'khóa MK cấp 2 sau 5 lần sai');
// cài đặt + Line
for (let i = 1; i <= 6; i++) await call('/api/mm/admin/lines', { token: A, json: { name: `Line ${i}` } });
r = await call('/api/mm/admin/settings', { token: A }); ok(r.d.lines?.length === 6 && r.d.settings.supply_threshold === '200', 'settings + 6 line');
// BOM + PO
const bom = await readBomWorkbook(fs.readFileSync('../kitting-app/demo-data/BOM_kitting_DEMO.xlsx'), 'BOM');
let t0 = Date.now();
r = await call('/api/mm/bom/import', { token: T.PL01, json: { source: 'BOM_kitting_DEMO.xlsx', rows: bom.rows, modelMap: [...bom.modelMap], vln: bom.vln } });
ok(r.d.rows === bom.rows.length, 'nhập BOM ' + JSON.stringify(r.d)); console.log('  nhập BOM', bom.rows.length, 'dòng:', Date.now() - t0, 'ms');
const po = await readPoWorkbook(fs.readFileSync('../kitting-app/demo-data/Production Plan by Order_DEMO.xlsx'), 'PO');
t0 = Date.now();
r = await call('/api/mm/po/import', { token: T.PL01, json: { source: 'Plan.xlsx', rows: po } }); ok(r.d.inserted === po.length, 'nhập PO ' + JSON.stringify(r.d).slice(0, 100)); console.log('  nhập PO', po.length, ':', Date.now() - t0, 'ms');
r = await call('/api/mm/po/import', { token: T.KH01, json: { rows: po } }); ok(r.status === 403, 'kho không nhập PO');
r = await call('/api/mm/bom', { token: T.PL01 }); ok(r.d.models?.length >= 26, 'catalog BOM ' + r.d.models?.length);
r = await call('/api/mm/bom/model?model=' + encodeURIComponent('BSM-F731'), { token: T.PL01 }); ok(r.d.codeList?.length === 13 && r.d.vln.length > 5, 'chi tiết BOM F731');
// API ngoài
r = await call('/api/mmx/po', { json: { rows: po.slice(0, 5) } }); ok(r.status === 401, 'API thiếu khóa');
r = await fetch(B + '/api/mmx/po', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MM-Key': 'test-key-1234567890abcd' }, body: JSON.stringify({ source: 'QR', rows: po }) }).then(x => x.json());
ok(r.ok && r.updated === po.length, 'API ngoài ' + JSON.stringify(r).slice(0, 100));
// PO hủy (Plan Status = Cancel) + lịch sử thay đổi + gỡ khỏi kế hoạch
const open = po.filter(p => p.remainQty > 0 && !p.productionQty);
const [c1, c2] = [open[0], open[1]];
r = await call('/api/mm/board/batch', { token: T.PL01, json: { items: [{ type: 'po', id: c2.po }], day: '2030-01-02' } }); ok(r.status === 200, 'lập KH PO sẽ hủy ' + JSON.stringify(r.d).slice(0, 120));
const po2 = po.map(p => p.po === c1.po ? { ...p, planStatus: 'Cancel' } : p.po === c2.po ? { ...p, planStatus: 'Cancel', planQty: p.planQty + 1 } : p);
r = await call('/api/mm/po/import', { token: T.PL01, json: { source: 'Plan2.xlsx', rows: po2 } });
ok(r.d.changed === 2 && r.d.cancelled?.length === 2, 'nhập lại: 2 PO Cancel ' + JSON.stringify(r.d).slice(0, 160));
r = await call('/api/mm/po', { token: T.KH01 });
ok(r.d.rows.find(x => x.po === c1.po)?.state === 'cancel', 'PO Cancel có trạng thái cancel');
ok(r.d.alerts?.length === 1 && r.d.alerts[0].step === 'drop' && r.d.alerts[0].pos[0].po === c2.po, 'cảnh báo PO hủy đã lập KH ' + JSON.stringify(r.d.alerts).slice(0, 160));
r = await call('/api/mm/po/history?po=' + c2.po, { token: T.KH01 });
ok(r.d.rows?.[0]?.kind === 'cancel' && r.d.rows[0].changes.plan_qty?.[1] === c2.planQty + 1 && r.d.rows.at(-1).kind === 'new', 'lịch sử PO ' + JSON.stringify(r.d).slice(0, 160));
r = await call('/api/mm/board?from=2030-01-01', { token: T.PL01 });
ok(!r.d.pool.some(i => i.code === c1.po), 'PO Cancel không vào cột chưa lập KH');
r = await call('/api/mm/board/batch', { token: T.PL01, json: { items: [{ type: 'po', id: c1.po }], day: '2030-01-03' } }); ok(r.status === 400, 'không lập KH được PO Cancel');
r = await call('/api/mm/po/drop-cancelled', { token: T.LN01, json: { kitId: 1 } }); ok(r.status === 403, 'Line không gỡ được PO hủy');
const kid = (await call('/api/mm/board?from=2030-01-02&days=1', { token: T.PL01 })).d.columns[0].items.find(i => i.code === c2.po)?.id;
r = await call('/api/mm/po/drop-cancelled', { token: T.KH01, json: { kitId: kid } }); ok(r.d.ok, 'Kho gỡ PO hủy ' + JSON.stringify(r.d));
r = await call('/api/mm/po', { token: T.KH01 }); ok(!r.d.alerts.length, 'hết cảnh báo sau khi gỡ');
r = await call('/api/mm/po/import', { token: T.PL01, json: { source: 'Plan.xlsx', rows: po } }); ok(r.d.changed === 2 && !r.d.cancelled.length, 'nhập lại file gốc');
// Order List (.xls SAP) của Planner + cổng cập nhật sản xuất
const xw = XLSX.read(fs.readFileSync('../kitting-app/demo-data/Order_List_DEMO.xls'));
const ol = readPoTable(XLSX.utils.sheet_to_json(xw.Sheets[xw.SheetNames[0]], { header: 1, raw: true, defval: '' }), 'Order List');
const o1 = ol[0];
ok(ol.length === 58 && o1.po === '011076157113' && o1.modelCode === 'GH96-23256A' && o1.planQty === 920 && o1.planDate === '2026-11-04' && o1.planStart === '2026-11-04T08:47' && o1.planEnd === '2026-11-04T14:33' && o1.masterLine === 'ISMBL302', 'đọc Order List .xls ' + JSON.stringify(o1));
r = await call('/api/mm/po/import', { token: T.PL01, json: { source: 'Order List.xls', rows: ol } }); ok(r.d.inserted === 58 && r.d.missing === 0, 'nhập Order List ' + JSON.stringify(r.d).slice(0, 120));
r = await call('/api/mm/po/production', { token: T.PL01, json: { rows: [{ po: o1.po, productionQty: 100 }] } }); ok(r.status === 403, 'Planner không dùng cổng sản xuất');
r = await call('/api/mm/po/production', { token: A, json: { rows: [{ po: o1.po }] } }); ok(r.status === 400, 'thiếu Production bị chặn');
r = await call('/api/mm/po/production', { token: A, json: { source: 'SX.xlsx', rows: [{ po: o1.po, productionQty: 100 }, { po: '999999', productionQty: 5 }] } });
ok(r.d.updated === 1 && r.d.unknown?.[0] === '999999', 'cập nhật sản xuất + PO lạ ' + JSON.stringify(r.d));
const row1 = async () => (await call('/api/mm/po', { token: A })).d.rows.find(x => x.po === o1.po);
let x = await row1(); ok(x.state === 'running' && x.productionQty === 100 && x.remainQty === 820, 'PO đang SX, remain tự tính ' + JSON.stringify(x));
r = await call('/api/mm/po/import', { token: T.PL01, json: { source: 'Order List.xls', rows: ol.map(o => o.po === o1.po ? { ...o, planQty: 1000 } : o) } });
x = await row1(); ok(r.d.changed === 1 && x.productionQty === 100 && x.remainQty === 900, 'nhập lại file Planner: giữ Production, tính lại Remain ' + JSON.stringify(x));
r = await fetch(B + '/api/mmx/production', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MM-Key': 'test-key-1234567890abcd' }, body: JSON.stringify({ source: 'QR-L4', rows: [{ po: o1.po, productionQty: 1000 }, { po: ol[1].po, productionQty: 0, status: 'Cancel' }] }) }).then(y => y.json());
ok(r.ok && r.updated === 2 && r.cancelled?.[0] === ol[1].po, 'API QR cập nhật sản xuất ' + JSON.stringify(r));
x = await row1(); ok(x.state === 'done' && x.remainQty === 0, 'PO xong sau khi đủ số');
r = await fetch(B + '/api/mmx/production', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: [{ po: o1.po, productionQty: 1 }] }) }); ok(r.status === 401, 'API QR thiếu khóa');
r = await call('/api/mm/po/history?po=' + o1.po, { token: A }); ok(r.d.rows[0].kind === 'prod' && r.d.rows[0].source === 'API: QR-L4', 'lịch sử có cập nhật SX ' + JSON.stringify(r.d.rows[0]));
r = await call('/api/mm/po/production/log', { token: A }); ok(r.d.rows.length === 2 && r.d.rows[0].summary.updated === 2, 'nhật ký cập nhật sản xuất');
// PO nội bộ (Unplan / RMA): Planner tạo, số 12 ký tự, ấn định Line; gộp được với PO thường nhưng kit chỉ giao đúng Line
const base = open[5];
r = await call('/api/mm/po/internal', { token: T.KH01, json: { type: 'UNPLAN', modelCode: base.modelCode, qty: 50, line: 'Line 2', refDoc: 'BB-01' } }); ok(r.status === 403, 'Kho không tạo PO nội bộ');
r = await call('/api/mm/po/internal', { token: T.PL01, json: { type: 'UNPLAN', modelCode: base.modelCode, qty: 50, line: 'Line 99', refDoc: 'BB-01' } }); ok(r.status === 400, 'Line không có bị chặn');
r = await call('/api/mm/po/internal', { token: T.PL01, json: { type: 'UNPLAN', modelCode: base.modelCode, qty: 50, line: 'Line 2' } }); ok(r.status === 400, 'thiếu biên bản bị chặn');
r = await call('/api/mm/po/internal/options', { token: T.PL01 }); ok(r.d.lines.includes('Line 2') && r.d.codes.some(c => c.code === base.modelCode), 'gợi ý Line / Model Code');
const up1 = (await call('/api/mm/po/internal', { token: T.PL01, json: { type: 'UNPLAN', modelCode: base.modelCode, qty: 50, line: 'Line 2', refDoc: 'BB-01' } })).d.po;
const up2 = (await call('/api/mm/po/internal', { token: T.PL01, json: { type: 'UNPLAN', modelCode: base.modelCode, qty: 30, line: 'Line 3', refDoc: 'BB-02' } })).d.po;
const rm1 = (await call('/api/mm/po/internal', { token: T.PL01, json: { type: 'RMA', modelCode: base.modelCode, qty: 20, line: 'Line 2', refDoc: 'RMA-9' } })).d.po;
ok(/^UP\d{10}$/.test(up1) && /^UP\d{10}$/.test(up2) && /^RM\d{10}$/.test(rm1) && up1.length === 12 && Number(up2.slice(-4)) === Number(up1.slice(-4)) + 1, 'số PO nội bộ 12 ký tự ' + [up1, up2, rm1]);
r = await call('/api/mm/po', { token: T.PL01 }); x = r.d.rows.find(y => y.po === up1); ok(x?.poType === 'UNPLAN' && x.fixedLine === 'Line 2' && x.remainQty === 50, 'PO nội bộ trong danh sách');
r = await call('/api/mm/board/merge', { token: T.PL01, json: { items: [{ type: 'po', id: up1 }, { type: 'po', id: up2 }] } }); ok(r.status === 400 && /khác Line/.test(r.d.error), 'không gộp 2 PO nội bộ khác Line ' + JSON.stringify(r.d));
r = await call('/api/mm/board/merge', { token: T.PL01, json: { items: [{ type: 'po', id: up1 }, { type: 'po', id: rm1 }, { type: 'po', id: base.po }] } }); ok(r.d.ok, 'gộp PO nội bộ + PO thường ' + JSON.stringify(r.d).slice(0, 160));
const bd = (await call('/api/mm/board?from=2020-01-01&days=1', { token: T.PL01 })).d;
const mk = [...bd.pool].find(i => i.type === 'kit' && (i.pos || []).some(p => p.po === up1));
ok(mk && mk.fixedLine === 'Line 2' && mk.internal.length === 2, 'kit gộp mang Line ấn định ' + JSON.stringify(mk && { f: mk.fixedLine, i: mk.internal }));
r = await call(`/api/mm/kho/deliver-preview?id=${mk.id}&line=Line%203`, { token: T.KH01 }); ok(/ấn định Line 2/.test(r.d.fixedBlock || ''), 'xem trước giao: chặn Line khác');
r = await call('/api/mm/kho/deliver', { token: T.KH01, json: { kitId: mk.id, line: 'Line 3' } }); ok(r.status === 400 && /ấn định Line 2/.test(r.d.error), 'Kho không giao kit PO nội bộ cho Line khác ' + JSON.stringify(r.d));
// Ghi chú Planner trên PO → hiện ở Kho / Kitting / SX, ghi lịch sử, không bị nhập lại file ghi đè.
r = await call('/api/mm/po/note', { token: T.KH01, json: { po: base.po, note: 'x' } }); ok(r.status === 403, 'Kho không sửa ghi chú PO');
r = await call('/api/mm/po/note', { token: T.PL01, json: { po: 'KHONGCO', note: 'x' } }); ok(r.status === 404, 'ghi chú PO không tồn tại');
r = await call('/api/mm/po/note', { token: T.PL01, json: { po: base.po, note: '  Ưu tiên giao trước 10h  ' } }); ok(r.d.ok && r.d.note === 'Ưu tiên giao trước 10h', 'lưu ghi chú PO');
r = await call('/api/mm/po/history?po=' + base.po, { token: T.PL01 }); ok(r.d.note === 'Ưu tiên giao trước 10h' && r.d.rows[0].kind === 'note' && r.d.rows[0].by === 'PL01' && !('_by' in r.d.rows[0].changes), 'lịch sử ghi chú ' + JSON.stringify(r.d.rows[0]));
r = await call(`/api/mm/kho/deliver-preview?id=${mk.id}&line=Line%202`, { token: T.KH01 });
ok(r.d.kit.notes.length === 1 && r.d.kit.notes[0].po === base.po && r.d.kit.pos.length === 3, 'Kho thấy ghi chú + PO gốc của kit gộp');
r = await call('/api/mm/board?from=2020-01-01&days=1', { token: T.PL01 }); ok([...r.d.pool].find(i => i.id === mk.id)?.notes?.[0]?.note === 'Ưu tiên giao trước 10h', 'Lập KH thấy ghi chú');
r = await call('/api/mm/po/note', { token: T.PL01, json: { po: base.po, note: '' } }); ok(r.d.ok && r.d.note === '', 'xóa ghi chú');
// Tổng hợp vật liệu cần kitting (Kho tải về tính thiếu): kit chưa lập KH chỉ có khi tick "gồm chưa lập KH"
r = await call('/api/mm/kho/material-summary?to=2099-12-31', { token: T.LN01 }); ok(r.status === 403, 'Line không xem tổng hợp vật liệu Kho');
r = await call('/api/mm/kho/material-summary?to=2099-12-31', { token: T.KH01 });
const ms1 = r.d; ok(Array.isArray(ms1.rows) && !ms1.rows.some(x => x.kit === mk.code) && ms1.rows.every(x => x.remain === Math.max(0, Math.round((x.required - x.kitted) * 1000) / 1000) && x.day), 'tổng hợp vật liệu: chỉ kit đã lập KH, Còn = Cần − Đã soạn');
r = await call('/api/mm/kho/material-summary?to=2099-12-31&unplanned=1', { token: T.KH01 });
const mkRows = r.d.rows.filter(x => x.kit === mk.code), mkCodes = new Set(mkRows.map(x => x.code));
ok(r.d.rows.length > ms1.rows.length && mkRows.length && mkRows.every(x => x.day === '' && x.kitted === 0 && x.code) && [...mkCodes].every(c => mk.codes.includes(c)), `gồm PO chưa lập KH (kit gộp ${mkRows.length} dòng, code ${[...mkCodes].join(',')})`);
ok(r.d.kitPo && r.d.rows.every(x => Array.isArray(r.d.kitPo[x.kit]) && r.d.kitPo[x.kit].length) && (r.d.kitPo[mk.code] || []).length >= 2, 'tổng hợp vật liệu: kitPo cho mọi Kit, Kit gộp đủ PO gốc (lọc Theo PO)');
// PO Unplan: Rear đã cấp khi Kho xác nhận Unplan → kitting Rear + VLĐT không tính Rear cho PO Unplan (VLĐT vẫn đủ)
{
  const bx = bom.rows.map(b => ({ model_code: b.modelCode, material: b.material, point: b.point })), kpos = (await call(`/api/mm/kho/deliver-preview?id=${mk.id}&line=Line%202`, { token: T.KH01 })).d.kit.pos;
  const qAll = c => kpos.filter(p => p.modelCode === c).reduce((s, p) => s + p.qty, 0), qRear = c => kpos.filter(p => p.modelCode === c && p.po !== up1).reduce((s, p) => s + p.qty, 0);
  const vd = (await call(`/api/mm/kho/kit?id=${mk.id}&grp=VLN`, { token: T.KH01 })).d;
  await call('/api/mm/kho/kit', { token: T.KH01, json: { kitId: mk.id, grp: 'VLN', items: [{ code: vd.items[0].code, material: vd.items[0].material, kitted: 1 }] } });
  const hd = (await call(`/api/mm/kho/kit?id=${mk.id}&grp=HV`, { token: T.KH01 })).d;
  const pt = (c, m) => bx.find(b => b.model_code === c && b.material === m)?.point;
  const rear = hd.items.filter(i => i.kitGroup === 'REAR'), vldt = hd.items.filter(i => i.kitGroup === 'VLDT');
  const r3 = n => Math.round(n * 1000) / 1000;
  ok(rear.length && rear.every(i => r3(pt(i.code, i.material) * qRear(i.code)) === i.required) && vldt.every(i => r3(pt(i.code, i.material) * qAll(i.code)) === i.required) && hd.kit.unplanRear.length === 1 && hd.kit.unplanRear[0].po === up1,
    `Unplan không kitting Rear (Rear theo ${qRear(mk.modelCode)} ea, VLĐT theo ${qAll(mk.modelCode)} ea)`);
  r = await call('/api/mm/kho/material-summary?to=2099-12-31&unplanned=1', { token: T.KH01 });
  const u2 = r.d.rows.filter(x => x.kit === up2);
  ok(u2.length && !u2.some(x => x.grp === 'REAR') && u2.some(x => x.grp === 'VLN'), 'tổng hợp vật liệu: PO Unplan không có Rear');
}
// Sửa / hủy PO nội bộ tạo sai: quyền internalPo (Planner, Admin); kit đã kitting → chỉ sửa chứng từ / ghi chú; hủy → gỡ khỏi kit + Cancel
r = await call('/api/mm/po/internal/edit', { token: T.LN01, json: { po: up2, qty: 35 } }); ok(r.status === 403, 'Line không sửa PO nội bộ');
r = await call('/api/mm/po/internal/edit', { token: T.PL01, json: { po: up2, note: 'Planner sửa' } }); ok(r.d.ok && (await call('/api/mm/po/history?po=' + up2, { token: A })).d.rows[0].source === 'PL01', 'Planner (quyền PO nội bộ) sửa được PO nội bộ');
r = await call('/api/mm/po/internal/edit', { token: A, json: { po: base.po, qty: 5 } }); ok(r.status === 400 && /không phải PO nội bộ/.test(r.d.error), 'không sửa PO SAP');
r = await call('/api/mm/po/internal/edit', { token: A, json: { po: up2, qty: 35, line: 'Line 2', refDoc: 'BB-02b' } });
x = (await call('/api/mm/po', { token: A })).d.rows.find(y => y.po === up2);
let ih = (await call('/api/mm/po/history?po=' + up2, { token: A })).d;
ok(r.d.ok && x.planQty === 35 && x.remainQty === 35 && x.fixedLine === 'Line 2' && ih.rows[0].kind === 'edit' && ih.rows[0].changes.plan_qty[1] === 35 && ih.internal.refDoc === 'BB-02b', 'Admin sửa PO nội bộ chưa lập KH (SL, Line, chứng từ) + lịch sử');
r = await call('/api/mm/po/internal/edit', { token: A, json: { po: up1, qty: 40 } }); ok(r.status === 400 && /bắt đầu kitting/.test(r.d.error), 'kit đã kitting: không đổi SL');
r = await call('/api/mm/po/internal/edit', { token: A, json: { po: up1, refDoc: 'BB-01-sua' } }); ok(r.d.ok && (await call('/api/mm/po/history?po=' + up1, { token: A })).d.internal.locked === true, 'kit đã kitting: vẫn sửa được chứng từ');
r = await call('/api/mm/po/internal/cancel', { token: A, json: { po: up1, reason: 'nhầm' } }); ok(r.status === 400, 'kit đã kitting: không hủy được');
r = await call('/api/mm/po/internal/cancel', { token: A, json: { po: up2, reason: 'tạo trùng' } });
const bd2 = (await call('/api/mm/board?from=2020-01-01&days=1', { token: A })).d;
ih = (await call('/api/mm/po/history?po=' + up2, { token: A })).d;
ok(r.d.ok && !bd2.pool.some(i => i.code === up2) && ih.internal.cancelled && ih.rows[0].kind === 'cancel', 'Admin hủy PO nội bộ → Cancel, rời danh sách chưa lập KH');
// Tự động xếp PO: xem trước không ghi; chỉ PO SL ≥ mức; giới hạn Kit/ngày; ghép Unplan/RMA; bỏ chọn; áp dụng + hoàn tác
const AO = { to: '2099-12-31', minQty: 500, lead: 0, maxPerDay: 0, attach: true };
const poolN = async () => (await call('/api/mm/board?from=2020-01-01&days=1', { token: T.PL01 })).d.pool.length;
const n0 = await poolN();
r = await call('/api/mm/board/auto', { token: T.LN01, json: { dry: true, opts: AO } }); ok(r.status === 403, 'tự động xếp: Line không có quyền');
r = await call('/api/mm/board/auto', { token: T.PL01, json: { dry: true, opts: AO } });
const ap = r.d, places = ap.rows.filter(x => x.action === 'place');
ok(places.length > 0 && places.every(x => x.qty >= 500) && ap.left.small.every(x => x.qty < 500) && ap.left.small.length > 0 && await poolN() === n0, `tự động xếp xem trước: chỉ PO ≥ 500, PO nhỏ để lại, không ghi (${places.length} xếp, ${ap.left.small.length} nhỏ)`);
r = await call('/api/mm/board/auto', { token: T.PL01, json: { dry: true, opts: { ...AO, maxPerDay: 1 } } });
const perDay = new Map(); r.d.rows.filter(x => x.action === 'place').forEach(x => perDay.set(x.day, (perDay.get(x.day) || 0) + 1));
const exist = async d => (await call(`/api/mm/board?from=${d}&days=1`, { token: T.PL01 })).d.columns[0].items.length;
let capOk = perDay.size > 0; for (const [d, n] of perDay) if (n + await exist(d) > 1) capOk = false;
ok(capOk, 'tự động xếp: tối đa 1 Kit/ngày → dồn sang ngày sau');
const host = places[0];
const upA = (await call('/api/mm/po/internal', { token: T.PL01, json: { type: 'UNPLAN', modelCode: host.codes[0], qty: 10, line: 'Line 4', refDoc: 'BB-AUTO', planDate: host.start.slice(0, 10) } })).d.po;
r = await call('/api/mm/board/auto', { token: T.PL01, json: { dry: true, opts: AO } });
const withUp = r.d.rows.find(x => x.attached.some(a => a.po === upA));
ok(withUp && withUp.model === host.model, 'tự động xếp: ghép PO Unplan vào Kit cùng Model');
r = await call('/api/mm/board/auto', { token: T.PL01, json: { dry: true, opts: { ...AO, attach: false } } });
ok(!r.d.rows.some(x => x.attached.length), 'tự động xếp: bỏ tích ghép Unplan → không ghép');
r = await call('/api/mm/board/auto', { token: T.PL01, json: { dry: true, opts: { ...AO, exclude: [host.key] } } });
ok(!r.d.rows.some(x => x.key === host.key) && r.d.left.excluded.includes(host.code), 'tự động xếp: bỏ chọn dòng');
r = await call('/api/mm/board/auto', { token: T.PL01, json: { opts: { ...AO, exclude: [host.key] } } });
const bdA = (await call('/api/mm/board?from=2020-01-01&days=1', { token: T.PL01 })).d;
const applied = r.d;
ok(applied.ok && applied.placed === places.length - 1 && bdA.pool.some(i => i.code === host.code) && !bdA.pool.some(i => i.code === places[1].code) && applied.undo === 'Tự động xếp PO', 'tự động xếp áp dụng: ' + applied.message);
const upRow = (await call('/api/mm/po', { token: A })).d.rows.find(x => x.po === upA);
ok(!!upRow.kitCode && upRow.kitKind === 'merged', 'tự động xếp: PO Unplan đã nằm trong Kit gộp ' + upRow.kitCode);
r = await call('/api/mm/board/undo', { token: T.PL01, json: {} });
ok(r.d.ok && await poolN() === n0 + 1, 'tự động xếp: hoàn tác trả lại cột Chưa lập KH');
const stA = (await call('/api/mm/admin/settings', { token: A })).d.settings;
await call('/api/mm/admin/settings', { token: A, json: { ...stA, auto_max_kits_day: 6 } });
ok((await call('/api/mm/board', { token: T.PL01 })).d.autoMaxDay === 6, 'cài đặt Kit tối đa / ngày');
await call('/api/mm/admin/settings', { token: A, json: { ...stA, auto_max_kits_day: 0 } });
// Cập nhật BOM từ file: chỉ đụng Model Code trong file, không đổi tên Model, không xóa code khác, giới hạn code thay mỗi lần, không có API xuất toàn bộ
{
  const imp = (rows, modelMap = [], extra = {}) => call('/api/mm/bom/import', { token: T.PL01, json: { source: 'test.xlsx', rows, modelMap, ...extra } });
  const cnt = async () => (await call('/api/mm/bom', { token: T.PL01 })).d.models.reduce((a, m) => a + (m.codes?.length ?? m.codeCount ?? 0), 0);
  r = await call('/api/mm/bom/export', { token: A }); ok(r.status === 404 || r.status === 403, 'không còn API tải toàn bộ BOM: ' + r.status);
  r = await imp([{ modelCode: 'MAU-0001A', material: 'GH02-00000A', point: 1 }], [['MAU-0001A', 'Model mẫu']]); ok(r.status === 400 && /dòng mẫu/.test(r.d.error), 'từ chối file còn dòng mẫu');
  const c0 = bom.rows[0].modelCode, m0 = bom.modelMap.get(c0), r0 = bom.rows.filter(x => x.modelCode === c0), n0b = await cnt();
  const nw = [{ modelCode: 'GH96-NEW01', material: 'GH02-NEW1', description: 'x', point: 2, process: '', group: 'VLN' }];
  r = await imp(nw, [['GH96-NEW01', m0.toUpperCase()]], { dry: true });
  ok(r.d.newCodes?.length === 1 && r.d.newCodes[0].model === m0 && !r.d.newModels.length && await cnt() === n0b, 'BOM xem trước: code mới, gộp tên Model lệch hoa thường, không ghi');
  r = await imp(nw, [['GH96-NEW01', m0]]);
  ok(r.d.ok && r.d.newCodes.length === 1 && await cnt() === n0b + 1, 'BOM thêm code mới, code khác giữ nguyên');
  r = await imp([{ modelCode: 'GH96-NEW02', material: 'GH02-NEW1', point: 1 }]); ok(r.status === 400 && /chưa ghi Model/.test(r.d.error), 'code mới thiếu Model bị từ chối');
  // code đã có: đổi tên qua file bị bỏ qua; dòng trống nhóm giữ nhóm cũ; không đổi gì thì bỏ qua
  const same = r0.map(x => ({ modelCode: x.modelCode, material: x.material, description: x.description, point: x.point, process: x.process }));
  r = await imp(same, [[c0, 'Tên Sai Block 3']], { dry: true });
  ok(r.d.unchanged === 1 && !r.d.changed.length && r.d.renameIgnored[0]?.kept === m0, 'file đổi tên Model code đã có: giữ tên cũ, dòng trống nhóm giữ nhóm cũ ' + JSON.stringify(r.d.changed));
  r = await imp(same.map((x, i) => i ? x : { ...x, point: x.point + 1 }), [[c0, 'Tên Sai Block 3']]);
  const dt = (await call('/api/mm/bom/model?model=' + encodeURIComponent(m0), { token: T.PL01 })).d;
  ok(r.d.ok && r.d.changed[0]?.diffPoint === 1 && dt.codeList.some(c => (c.code ?? c.modelCode ?? c) === c0) && await cnt() === n0b + 1, 'thay BOM riêng 1 code đã có, không đổi tên Model');
  await imp(same);
  const codes = [...new Set(bom.rows.map(x => x.modelCode))].slice(0, 21);
  r = await imp(codes.map(c => ({ modelCode: c, material: 'GH02-BULK', point: 1, group: 'VLN' }))); ok(r.status === 400 && /tối đa 20/.test(r.d.error), 'chặn thay quá 20 code đã có một lần');
  // dòng trống nhóm của code mới: chỉ tự xếp nhóm đúng các dòng của code trong file, không đụng code khác
  r = await imp([{ modelCode: 'GH96-NEW03', material: 'GH02-NEW3', point: 1 }], [['GH96-NEW03', m0]]); ok(r.d.ok && r.d.suggested === 1, 'tự xếp nhóm chỉ trong code của file: ' + r.d.suggested);
  await call('/api/mm/bom/code/delete', { token: T.PL01, json: { modelCode: 'GH96-NEW01' } });
  await call('/api/mm/bom/code/delete', { token: T.PL01, json: { modelCode: 'GH96-NEW03' } });
}
// MES đẩy kế hoạch + sản xuất từng PO: /api/mmx/po-plan (khóa, schema, ánh xạ trường, không đổi thì không ghi, bản tin muộn, PO nội bộ, dry)
{
  const mes = (body, q = '', key = 'test-key-1234567890abcd') => fetch(B + '/api/mmx/po-plan' + q, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'X-MM-Key': key } : {}) }, body: JSON.stringify(body) }).then(async x => ({ status: x.status, d: await x.json() }));
  const code = bom.rows[0].modelCode, D = { FactoryCode: 'C5H2A', PlantCode: 'P520', PoNo: '011076999001', PlanDate: '2026-11-06', ModelCode: code, MasterLine: 'ILS_BLOCK3-3 02', PlanQty: '960', ProductionQty: '100', RemainQty: '860', PoStatus: 'Progress', PoStatusCode: '1', PlanStartAt: '2026-11-06T09:53:06', PlanEndAt: '2026-11-06T16:01:06', SyncedAtUtc: '2026-11-06T05:05:22.0000000Z' };
  const S = 'MES.ProductionPlan.v1', row = async po => (await call('/api/mm/po', { token: A })).d.rows.find(x => x.po === po), hn = async po => (await call('/api/mm/po/history?po=' + po, { token: A })).d.rows.length;
  r = await mes({ schema: S, data: D }, '', ''); ok(r.status === 401, 'MES thiếu khóa → 401');
  r = await mes({ schema: 'X', data: D }); ok(r.status === 400 && /schema/.test(r.d.error), 'MES sai schema → 400');
  r = await mes({ schema: S, data: { ...D, ModelCode: '' } }); ok(r.status === 400 && /ModelCode/.test(r.d.error), 'MES thiếu ModelCode → 400');
  r = await mes({ schema: S, data: { ...D, PlanQty: 'abc' } }); ok(r.status === 400 && /PlanQty/.test(r.d.error), 'MES PlanQty sai → 400');
  r = await mes({ schema: S, data: D }, '?dry=1'); ok(r.d.dry && r.d.inserted === 1 && !await row(D.PoNo), 'MES dry=1: báo kết quả, không ghi');
  r = await mes({ schema: S, data: D }); x = await row(D.PoNo);
  ok(r.d.inserted === 1 && x.planQty === 960 && x.productionQty === 100 && x.remainQty === 860 && x.planStatus === 'Progress' && x.planStart === '2026-11-06T09:53' && (await call('/api/mm/board?from=2020-01-01&days=1', { token: T.PL01 })).d.pool.find(i => i.code === D.PoNo)?.planEnd === '2026-11-06T16:01' && x.masterLine === 'ILS_BLOCK3-3 02' && x.modelCode === code && x.planDate === '2026-11-06', 'MES tạo PO, ánh xạ đủ trường ' + JSON.stringify(r.d).slice(0, 120));
  ok(x.planEnd === '2026-11-06T16:01' && x.lastSource === 'MES' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(x.lastAt), 'bảng PO có giờ kết thúc, thời gian + nguồn dữ liệu mới nhất ' + x.lastAt + ' ' + x.lastSource);
  const h0 = await hn(D.PoNo); r = await mes({ schema: S, data: D }); ok(r.d.unchanged === 1 && await hn(D.PoNo) === h0, 'MES gửi lại y hệt: không ghi lịch sử');
  r = await mes({ schema: S, data: { ...D, ProductionQty: '960', RemainQty: '0', PoStatus: 'Completed', SyncedAtUtc: '2026-11-06T06:00:00.0000000Z' } }); x = await row(D.PoNo);
  ok(r.d.updated === 1 && x.productionQty === 960 && x.remainQty === 0 && x.planStatus === 'Completed' && x.state === 'done', 'MES cập nhật sản xuất + trạng thái');
  r = await mes({ schema: S, data: { ...D, ProductionQty: '200', RemainQty: '760', PoStatus: 'Progress', SyncedAtUtc: '2026-11-06T05:30:00.0000000Z' } }); x = await row(D.PoNo);
  ok(r.d.stale === 1 && x.productionQty === 960 && x.planStatus === 'Completed', 'MES bản tin đến muộn bị bỏ qua');
  r = await mes({ schema: S, data: { ...D, PlanQty: '1000', ProductionQty: '960', RemainQty: '40', PlanStartAt: '', MasterLine: '', SyncedAtUtc: '2026-11-06T07:00:00Z' } }); x = await row(D.PoNo);
  ok(r.d.updated === 1 && x.planQty === 1000 && x.remainQty === 40 && x.planStart === '2026-11-06T09:53' && x.masterLine === 'ILS_BLOCK3-3 02', 'MES đổi Plan Qty, trường trống giữ giá trị cũ');
  r = await mes({ schema: S, data: [{ ...D, PoNo: '011076999002' }, { ...D, PoNo: '', ModelCode: code }, { ...D, PoNo: upA }, { ...D, PoNo: '011076999003', ModelCode: 'GH96-CHUACO' }] });
  x = await row(upA);
  ok(r.status === 200 && r.d.inserted === 2 && r.d.rejected.length === 2 && r.d.newCodesNoBom[0] === 'GH96-CHUACO' && x.poType !== 'SAP' && x.modelCode !== undefined, 'MES gửi mảng: dòng lỗi và PO nội bộ bị từ chối riêng, báo code chưa có BOM');
  r = await mes({ schema: S, data: { ...D, PoNo: '011076999002', PoStatus: 'Cancel', SyncedAtUtc: '2026-11-07T00:00:00Z' } }); x = await row('011076999002');
  ok(r.d.cancelled[0] === '011076999002' && x.state === 'cancel', 'MES hủy PO');
  const bdM = (await call('/api/mm/board?from=2020-01-01&days=1', { token: T.PL01 })).d;
  ok(bdM.pool.some(i => i.code === '011076999003') && !bdM.pool.some(i => i.code === '011076999002'), 'PO từ MES vào cột Chưa lập KH, PO hủy thì không');
}
// Kitting: chuyển nhanh Chưa làm → Đang làm; định mức lẻ cấp số nguyên, xác nhận xong thì định mức kit = số thực cấp
{
  await new Promise(res => setTimeout(res, 10500));   // giới hạn mặc định của PocketBase: 300 yêu cầu / 10 giây mỗi IP
  const fc = 'GH96-FRAC1', m0f = bom.modelMap.get(bom.rows[0].modelCode);
  await call('/api/mm/bom/import', { token: T.PL01, json: { source: 'frac.xlsx', rows: [{ modelCode: fc, material: 'GH82-FRAC', point: 1, group: 'REAR' }, { modelCode: fc, material: 'GH98-FRAC', point: 0.37, group: 'VLDT' }], modelMap: [[fc, m0f]] } });
  const fpo = (await call('/api/mm/po/internal', { token: T.PL01, json: { type: 'RMA', modelCode: fc, qty: 10, line: 'Line 2', refDoc: 'FRAC' } })).d.po;
  await call('/api/mm/board/batch', { token: T.PL01, json: { items: [{ type: 'po', id: fpo }], day: '2030-02-01' } });
  const fk = (await call('/api/mm/board?from=2030-02-01&days=1', { token: T.PL01 })).d.columns[0].items.find(i => i.code === fpo);
  const inHv = async () => (await call('/api/mm/kho/queue?grp=HV', { token: T.KH01 })).d.rows.some(x => x.id === fk.id);
  ok(fk && !await inHv(), 'PO chưa bắt đầu VLN: chưa có trong danh sách Rear + VLĐT');
  r = await call('/api/mm/kho/kit/start', { token: T.LN01, json: { kitId: fk.id } }); ok(r.status === 403, 'Line không chuyển trạng thái kitting được');
  r = await call('/api/mm/kho/kit/start', { token: T.KH01, json: { kitId: fk.id } });
  ok(r.d.ok && await inHv() && (await call('/api/mm/kho/queue?grp=VLN', { token: T.KH01 })).d.rows.find(x => x.id === fk.id).status === 'progress', 'Bắt đầu: VLN Đang làm, Rear + VLĐT kitting được ngay');
  r = await call('/api/mm/kho/kit/start', { token: T.KH01, json: { kitId: fk.id } }); ok(r.status === 400, 'Bắt đầu lần 2 bị từ chối');
  r = await call('/api/mm/kho/kit/start', { token: T.KH01, json: { kitId: fk.id, back: true } }); ok(r.d.ok && !await inHv(), 'chưa soạn mã nào: trả về Chưa làm được');
  await call('/api/mm/kho/kit/start', { token: T.KH01, json: { kitId: fk.id } });
  const hd = (await call(`/api/mm/kho/kit?id=${fk.id}&grp=HV`, { token: T.KH01 })).d, vd = hd.items.find(i => i.material === 'GH98-FRAC'), rd = hd.items.find(i => i.material === 'GH82-FRAC');
  ok(vd && Math.abs(vd.required - 3.7) < 1e-9, 'định mức lẻ 0,37 × 10 = 3,7');
  const save = (v, confirm = false) => call('/api/mm/kho/kit', { token: T.KH01, json: { kitId: fk.id, grp: 'HV', items: [{ code: rd.code, material: rd.material, kitted: 10 }, { code: vd.code, material: vd.material, kitted: v }], confirm } });
  r = await save(3.5); ok(r.status === 400 && /số nguyên/.test(r.d.error), 'định mức lẻ: phải nhập số nguyên');
  r = await save(5); ok(r.status === 400 && /quá số cần \(4\)/.test(r.d.error), 'định mức lẻ: tối đa làm tròn lên (4)');
  r = await save(4); ok(r.d.ok && r.d.status === 'progress', 'định mức lẻ: nhập 4 (làm tròn lên) được');
  r = await save(3, true);
  const hd2 = (await call(`/api/mm/kho/kit?id=${fk.id}&grp=HV`, { token: T.KH01 })).d, v2 = hd2.items.find(i => i.material === 'GH98-FRAC');
  const hq = (await call('/api/mm/kho/queue?grp=HV', { token: T.KH01 })).d.rows.find(x => x.id === fk.id);
  ok(r.d.ok && !/thiếu/.test(r.d.message) && v2.required === 3 && v2.kitted === 3 && hq.progress.short === 0, 'xác nhận xong với 3 (phần nguyên): đủ, định mức kit = 3 ' + r.d.message);
  const hist = (await call('/api/mm/kho/history?days=1', { token: T.KH01 })).d.rows.find(x => x.type === 'round');
  ok(hist && /3,?\.?7 → cấp 3|3\.7 → cấp 3/.test(hist.note), 'ghi lịch sử làm tròn định mức ' + (hist && hist.note));
  // Nợ lẻ: mã định lượng gam không soạn được chút nào trước khi giao Line (nợ 3,7) → giao bù nhận số lẻ, tối đa làm tròn lên, giao ≥ nợ thì hết nợ
  const fpo2 = (await call('/api/mm/po/internal', { token: T.PL01, json: { type: 'RMA', modelCode: fc, qty: 10, line: 'Line 2', refDoc: 'FRAC2' } })).d.po;
  await call('/api/mm/board/batch', { token: T.PL01, json: { items: [{ type: 'po', id: fpo2 }], day: '2030-02-01' } });
  const fk2 = (await call('/api/mm/board?from=2030-02-01&days=1', { token: T.PL01 })).d.columns[0].items.find(i => i.code === fpo2);
  await call('/api/mm/kho/kit/start', { token: T.KH01, json: { kitId: fk2.id } });
  const vk = (await call(`/api/mm/kho/kit?id=${fk2.id}&grp=VLN`, { token: T.KH01 })).d.items;
  const vItems = vk.slice(0, 1).map(i => ({ code: i.code, material: i.material, kitted: Math.ceil(i.required) }));
  r = await call('/api/mm/kho/kit', { token: T.KH01, json: { kitId: fk2.id, grp: 'VLN', items: vItems, confirm: true } }); ok(r.status === 400 && /lý do/.test(r.d.error), 'xác nhận xong khi còn thiếu: bắt chọn lý do ' + JSON.stringify(r.d));
  r = await call('/api/mm/kho/kit', { token: T.KH01, json: { kitId: fk2.id, grp: 'VLN', items: vItems, confirm: true, shortReason: 'OTHER' } }); ok(r.status === 400 && /Khác/.test(r.d.error), 'lý do Khác cần ghi chú');
  r = await call('/api/mm/kho/kit', { token: T.KH01, json: { kitId: fk2.id, grp: 'VLN', items: vItems, confirm: true, shortReason: 'STOCK', shortNote: 'chờ hàng' } }); ok(r.d.ok, 'xong VLN kit thử nợ lẻ (có lý do) ' + (r.d.error || ''));
  const vq = (await call('/api/mm/kho/queue?grp=VLN', { token: T.KH01 })).d.rows.find(x => x.id === fk2.id); ok(vq && vq.status === 'done' && vq.progress.short > 0, 'hàng chờ: Xong nhưng còn thiếu (progress.short) để hiện Xong · thiếu');
  globalThis.FK2 = fk2;
  await call('/api/mm/kho/kit', { token: T.KH01, json: { kitId: fk2.id, grp: 'HV', items: [{ code: rd.code, material: rd.material, kitted: 10 }], confirm: true, shortReason: 'WAIT' } });
  r = await call('/api/mm/kho/deliver', { token: T.KH01, json: { kitId: fk2.id, line: 'Line 2' } }); ok(r.d.ok, 'giao Line với mã lẻ chưa soạn ' + (r.d.error || ''));
  const dbt = () => call('/api/mm/kho/debts', { token: T.KH01 }).then(x => x.d.rows.find(k => k.kitId === fk2.id)?.items.find(i => i.material === 'GH98-FRAC'));
  let fd = await dbt(); ok(fd && fd.debt === 3.7, 'nợ lẻ 3,7 ' + JSON.stringify(fd));
  const settle = qty => call('/api/mm/kho/debts/settle', { token: T.KH01, json: { kitId: fk2.id, grp: 'HV', code: rd.code, material: 'GH98-FRAC', qty } });
  r = await settle(4.5); ok(r.status === 400 && /không quá 4/.test(r.d.error), 'giao bù quá làm tròn lên (4) bị từ chối ' + JSON.stringify(r.d));
  r = await settle(0.45); fd = await dbt(); ok(r.d.ok && r.d.lotNo === `${fk2.code}-B2` && fd && fd.debt === 3.25, 'giao bù số lẻ 0,45 được (đợt B2), còn nợ 3,25 ' + r.d.message);
  r = await settle(4); fd = await dbt(); ok(r.d.ok && r.d.lotNo === `${fk2.code}-B3` && !fd, 'giao bù 4 (≥ nợ 3,25, ≤ làm tròn lên) → hết nợ, định mức = số thực cấp ' + r.d.message);
  ok((await call('/api/mm/kho/history?days=1', { token: T.KH01 })).d.rows.some(x => x.type === 'round' && /3,?\.?7 → cấp 4,?\.?45/.test(x.note || '')), 'ghi lịch sử làm tròn khi giao bù vượt nợ lẻ');
}
// Kế hoạch Line từ Next ERP (ERP giả lập cổng 8199): cấu hình chỉ Quản trị, lỗi quyền báo rõ, ghép Line / Model (bỏ " AUTO") / ca, khóa sửa tay, đổi tên Model kéo theo phân công Line
{
  await new Promise(res => setTimeout(res, 10500));
  const http = await import('node:http');
  const vnToday = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10), plus = n => new Date(Date.parse(vnToday) + n * 864e5).toISOString().slice(0, 10);
  const mE = bom.modelMap.get(bom.rows[0].modelCode);
  const items = [{ plan_date: vnToday, routing: 'Line 2', model_snapshot: `${mE} AUTO`, shift_group: 'Ca ngày (Thấp điểm)' },
    { plan_date: plus(1), routing: 'Line 3', model_snapshot: mE.toLowerCase(), shift_group: 'Ca đêm' },
    { plan_date: vnToday, routing: 'Line 99', model_snapshot: mE, shift_group: 'Ca ngày' },
    { plan_date: vnToday, routing: 'Line 4', model_snapshot: 'XYZ AUTO', shift_group: 'Ca ngày' },
    { plan_date: vnToday, routing: 'Line 5', model_snapshot: mE, shift_group: 'Ca gì' }];
  const plans = [{ name: 'LPP-1', week_start: vnToday, week_end: plus(6), status: 'Released' }, { name: 'LPP-2', week_start: plus(7), week_end: plus(13), status: 'Draft' }];
  // ERP giả lập thêm tồn vị trí (Bin / Warehouse / Item) và BOM mặc định
  const codeA = bom.rows[0].modelCode, rowsA = bom.rows.filter(r => r.modelCode === codeA), matA = rowsA[0].material, matB = rowsA[1].material;
  const erpWhs = [{ name: 'Kho vật liệu rời - ILS', warehouse_name: 'Kho vật liệu rời', is_group: 1 }, { name: 'Khu vực sản xuất - ILS', warehouse_name: 'Khu vực sản xuất', is_group: 1 },
    { name: 'A-01 - ILS', warehouse_name: 'A-01', parent_warehouse: 'Kho vật liệu rời - ILS' }, { name: 'B-10 - ILS', warehouse_name: 'B-10', parent_warehouse: 'Kho vật liệu rời - ILS' }, { name: 'Line 01 - ILS', warehouse_name: 'Line 01', parent_warehouse: 'Khu vực sản xuất - ILS' }];
  const erpBins = [{ item_code: matA, warehouse: 'A-01 - ILS', actual_qty: 500 }, { item_code: matA, warehouse: 'B-10 - ILS', actual_qty: 20 }, { item_code: matA, warehouse: 'Line 01 - ILS', actual_qty: 100 }, { item_code: matB, warehouse: 'A-01 - ILS', actual_qty: -5 }, { item_code: 'ZZ-OTHER', warehouse: 'B-10 - ILS', actual_qty: 7 }];
  const erpItems = [{ name: matA, item_name: 'Mat A', item_group: 'Vật liệu', custom_default_location: 'A-01 - ILS' }, { name: matB, item_name: 'Mat B', custom_default_location: 'C-05 - ILS' }, { name: 'GH96-ERP1', item_group: 'ERP Model AUTO' }, { name: 'GH96-NOMD', item_group: '' }];
  const erpBoms = [{ name: `BOM-${codeA}-001`, item: codeA, modified: '2026-11-11 10:00:00', items: rowsA.map(r => ({ item_code: r.material, qty: r.point, description: r.description })) },
    { name: 'BOM-GH96-ERP1-001', item: 'GH96-ERP1', modified: '2026-11-11 10:00:00', items: [{ item_code: 'GH02-E1', qty: 2, description: 'ERP PART' }, { item_code: 'GH98-E2', qty: 1, description: 'ASSY CASE-REAR ERP' }] },
    { name: 'BOM-GH96-NOMD-001', item: 'GH96-NOMD', modified: '2026-11-11 10:00:00', items: [{ item_code: 'GH02-E1', qty: 1 }] }];
  const srv = http.createServer((q, s) => {
    if (/bad/.test(q.headers.authorization || '')) { s.writeHead(403, { 'Content-Type': 'application/json' }); return s.end('{"exc_type":"PermissionError"}'); }
    s.writeHead(200, { 'Content-Type': 'application/json' });
    if (/Line%20Production%20Plan\/LPP-1/.test(q.url)) return s.end(JSON.stringify({ data: { ...plans[0], items } }));
    if (/Line%20Production%20Plan\?/.test(q.url)) return s.end(JSON.stringify({ data: plans.filter(p => p.status === 'Released') }));
    if (/\/api\/resource\/Bin\?/.test(q.url)) return s.end(JSON.stringify({ data: erpBins }));
    if (/\/api\/resource\/Warehouse\?/.test(q.url)) return s.end(JSON.stringify({ data: erpWhs }));
    if (/\/api\/resource\/Item\?/.test(q.url)) return s.end(JSON.stringify({ data: erpItems }));
    if (/\/api\/resource\/BOM\?/.test(q.url)) return s.end(JSON.stringify({ data: erpBoms.map(b => ({ name: b.name, item: b.item, modified: b.modified, quantity: 1 })) }));
    const bd = q.url.match(/\/api\/resource\/BOM\/([^?]+)/); if (bd) { const b = erpBoms.find(x => x.name === decodeURIComponent(bd[1])); return s.end(JSON.stringify({ data: b ? { name: b.name, item: b.item, quantity: 1, items: b.items } : {} })); }
    s.end('{"data":[]}');
  });
  await new Promise(res => srv.listen(8199, '127.0.0.1', res));
  const asg = async (day, shift) => Object.fromEntries((await call(`/api/mm/lines/assign?day=${day}&shift=${encodeURIComponent(shift)}`, { token: T.PL01 })).d.rows.filter(r => r.model).map(r => [r.line, r.model]));
  // đổi tên Model qua Model Code (code cuối của tên cũ) → phân công Line theo tên mới
  await call('/api/mm/bom/import', { token: T.PL01, json: { source: 'ren.xlsx', rows: [{ modelCode: 'GH96-REN1', material: 'GH02-REN', point: 1, group: 'VLN' }], modelMap: [['GH96-REN1', 'REN Model']] } });
  await call('/api/mm/lines/assign', { token: T.PL01, json: { day: plus(20), shift: 'Ngày', rows: [{ line: 'Line 2', model: 'REN Model' }] } });
  const rn = [await call('/api/mm/lines/assign', { token: T.PL01, json: { day: plus(20), shift: 'Ngày', rows: [{ line: 'Line 2', model: 'REN Model' }] } }), await asg(plus(20), 'Ngày'), await call('/api/mm/bom/code', { token: T.PL01, json: { modelCode: 'GH96-REN1', model: 'REN Model 3' } })];
  ok((await asg(plus(20), 'Ngày'))['Line 2'] === 'REN Model 3', 'đổi tên Model (code cuối) → phân công Line theo tên mới ' + JSON.stringify(rn).slice(0, 300));
  r = await call('/api/mm/lines/erp', { token: T.PL01 }); ok(r.d.configured === false && r.d.locked === false, 'ERP chưa cấu hình');
  r = await call('/api/mm/admin/erp', { token: T.PL01, json: { url: 'http://127.0.0.1:8199', key: 'k', secret: 's' } }); ok(r.status === 403, 'chỉ Quản trị cấu hình kết nối ERP');
  r = await call('/api/mm/admin/erp', { token: A, json: { url: 'http://127.0.0.1:8199', key: 'k1', secret: 'bad', lineSync: true } });
  r = await call('/api/mm/admin/erp', { token: A }); ok(r.d.hasKey && r.d.hasSecret && !('secret' in r.d) && !('key' in r.d), 'không trả khóa ERP về trình duyệt');
  await call('/api/mm/lines/assign', { token: T.PL01, json: { day: vnToday, shift: 'Ngày', rows: [{ line: 'Line 6', model: mE }] } });
  r = await call('/api/mm/lines/erp/sync', { token: T.PL01, json: {} });
  const st1 = (await call('/api/mm/lines/erp', { token: T.PL01 })).d;
  ok(r.d.ok === false && /quyền đọc/.test(r.d.error) && st1.last?.ok === false && !st1.locked, 'bot chưa có quyền: báo rõ, ghi nhật ký, chưa khóa sửa tay ' + r.d.error);
  await call('/api/mm/admin/erp', { token: A, json: { secret: 's1' } });
  r = await call('/api/mm/lines/erp/sync', { token: T.PL01, json: {} });
  const um = r.d.unmatched || {}, d0 = await asg(vnToday, 'Ngày'), n1 = await asg(plus(1), 'Đêm'), d1 = await asg(plus(1), 'Ngày');
  ok(r.d.ok && r.d.cells === 2 && d0['Line 2'] === mE && !d0['Line 6'] && n1['Line 3'] === mE && !Object.keys(d1).length && um.line?.[0]?.name === 'Line 99' && um.model?.[0]?.name === 'XYZ AUTO' && um.shift?.[0]?.name === 'Ca gì',
    'đồng bộ ERP: bỏ " AUTO", không phân biệt hoa thường, ca theo ERP, Line không có trong ERP bị gỡ, báo mục chưa ghép ' + JSON.stringify(r.d).slice(0, 200));
  r = await call('/api/mm/lines/erp', { token: T.PL01 }); ok(r.d.locked && r.d.last.ok && r.d.last.plans.length === 1, 'đồng bộ thành công → khóa sửa tay, bỏ tuần Draft');
  r = await call('/api/mm/lines/week', { token: T.PL01, json: { shift: 'all', cells: [{ line: 'Line 2', day: vnToday, model: '' }] } }); ok(r.status === 400 && /Next ERP/.test(r.d.error), 'đã theo ERP: không sửa tay kế hoạch Line tuần');
  r = await call('/api/mm/lines/assign', { token: T.PL01, json: { day: vnToday, shift: 'Ngày', rows: [] } }); ok(r.status === 400, 'đã theo ERP: không sửa tay kế hoạch Line ngày');
  r = await call('/api/mm/lines/erp/sync', { token: T.PL01, json: {} }); ok(r.d.added === 0 && r.d.changed === 0 && r.d.removed === 0, 'đồng bộ lại không đổi gì');
  await call('/api/mm/admin/erp', { token: A, json: { modelMap: { 'XYZ AUTO': mE } } });
  r = await call('/api/mm/lines/erp/sync', { token: T.PL01, json: {} }); ok(r.d.cells === 3 && (await asg(vnToday, 'Ngày'))['Line 4'] === mE, 'bảng ghép tên Model ERP → MM');
  r = await call('/api/mm/lines/erp/sync', { token: T.LN01, json: {} }); ok(r.status === 403, 'Line không bấm đồng bộ ERP');
  await call('/api/mm/admin/erp', { token: A, json: { lineSync: false } });
  ok(!(await call('/api/mm/lines/erp', { token: T.PL01 })).d.locked, 'tắt đồng bộ → sửa tay lại được');
  // Tồn kho theo vị trí từ ERP (Bin): Kho xem, Kho đồng bộ tay; vị trí Line không tính; tồn âm / nhiều vị trí / khác vị trí mặc định được cờ; khả dụng = tồn − đang giữ trong kit
  r = await call('/api/mm/admin/erp', { token: A }); ok(r.d.stockSync === true && r.d.bomSync === true, 'mặc định bật tồn + BOM từ ERP');
  r = await call('/api/mm/kho/stock', { token: T.KH01 }); ok(r.status === 200 && r.d.rows.length > 0 && !r.d.okAt && r.d.rows.every(x => x.flags.includes('none')), 'Kho xem tồn ERP khi chưa đồng bộ: mọi mã chưa có tồn');
  r = await call('/api/mm/kho/stock/sync', { token: T.LN01, json: {} }); ok(r.status === 403, 'Line không đồng bộ tồn ERP');
  r = await call('/api/mm/kho/stock/sync', { token: T.KH01, json: {} }); ok(r.d.ok && r.d.bins === 5 && r.d.negBins === 1 && r.d.warehouses === 5 && r.d.bomMatsWithStock === 1, 'Kho đồng bộ tồn ERP ' + JSON.stringify(r.d));
  const stk = (await call('/api/mm/kho/stock', { token: T.KH01 })).d, sA = stk.rows.find(x => x.material === matA), sB = stk.rows.find(x => x.material === matB);
  ok(stk.okAt && sA && sA.total === 520 && sA.locs.map(l => l.loc).join(',') === 'A-01,B-10' && sA.flags.includes('multi') && sA.defaultLoc === 'A-01' && sA.avail === 520 - sA.held, 'vị trí bỏ đuôi " - ILS", bỏ kho Line, nhiều vị trí, khả dụng = tồn − giữ trong kit ' + JSON.stringify(sA));
  ok(sB && sB.total === -5 && sB.flags.includes('neg') && sB.flags.includes('mismatch') && stk.kpi.neg === 1 && !stk.rows.some(x => x.material === 'ZZ-OTHER'), 'cờ tồn âm + khác vị trí mặc định; mã ngoài BOM ẩn mặc định ' + JSON.stringify(sB));
  r = await call('/api/mm/kho/stock?all=1', { token: T.KH01 }); ok(r.d.rows.some(x => x.material === 'ZZ-OTHER' && x.flags.includes('erpOnly') && x.total === 7), 'all=1: thêm mã chỉ có trên ERP');
  r = await call(`/api/mm/kho/stock?model=${encodeURIComponent(mE)}`, { token: T.KH01 }); ok(r.d.model === mE && r.d.rows.some(x => x.material === matA && x.total === 520 && 'need' in x), 'theo Model: BOM của Model kèm Cần cho kit đang mở');
  const q1 = (await call('/api/mm/kho/queue?grp=VLN', { token: T.KH01 })).d.rows[0];
  if (q1) { r = await call(`/api/mm/kho/kit?id=${q1.id}&grp=VLN`, { token: T.KH01 }); ok(r.d.stockAt && r.d.items.every(i => Array.isArray(i.locs) && 'stock' in i), 'hộp kitting / phiếu in có vị trí + tồn ERP từng mã'); }
  // BOM mặc định từ ERP: code đã có → thay theo ERP; code mới lấy Model = Item Group (bỏ " AUTO"); thiếu Item Group → báo; khóa nhập file / sửa dòng / ECN; nhóm kitting vẫn sửa
  r = await call('/api/mm/bom/erp/sync', { token: T.KH01, json: {} }); ok(r.status === 403, 'Kho không đồng bộ BOM ERP (cần quyền Nhập BOM)');
  r = await call('/api/mm/bom/erp/sync', { token: T.PL01, json: {} });
  ok(r.d.ok && r.d.total === 3 && r.d.newCodes.includes('GH96-ERP1') && r.d.noModel.includes('GH96-NOMD') && r.d.pending === 0, 'đồng bộ BOM ERP lần đầu ' + JSON.stringify(r.d).slice(0, 300));
  let cat = (await call('/api/mm/bom', { token: T.PL01 })).d.models, mErp = cat.find(m => m.model === 'ERP Model');
  ok(mErp && mErp.codes.some(c => c.code === 'GH96-ERP1' && c.rows === 2 && c.rear === 1 && c.vln === 1), 'code mới: Model = Item Group bỏ " AUTO", app tự xếp nhóm (Rear theo mô tả) ' + JSON.stringify(mErp));
  const bomA = (await call(`/api/mm/bom/model?model=${encodeURIComponent(mE)}`, { token: T.PL01 })).d.byCode[codeA] || [];
  ok(bomA.length === rowsA.length && rowsA.every(x => bomA.some(y => y.material === x.material && y.point === x.point)), 'BOM code đã có đúng như ERP');
  r = await call('/api/mm/bom/erp', { token: T.KH01 }); ok(r.d.locked && r.d.codes === 2 && r.d.last.ok, 'trạng thái BOM ERP: đã khóa, 2 code theo ERP');
  r = await call('/api/mm/bom/erp/sync', { token: T.PL01, json: {} }); ok(r.d.ok && r.d.fetched === 1 && r.d.applied === 0, 'đồng bộ lại: chỉ lấy BOM còn thiếu Model, không đổi gì ' + JSON.stringify(r.d).slice(0, 200));
  erpBoms[0].modified = '2026-11-12 09:00:00'; erpBoms[0].items[0].qty = rowsA[0].point + 1;
  r = await call('/api/mm/bom/erp/sync', { token: T.PL01, json: {} }); ok(r.d.ok && r.d.changed.includes(codeA), 'ERP đổi Point → MM cập nhật code đó ' + JSON.stringify(r.d.changed));
  ok(((await call(`/api/mm/bom/model?model=${encodeURIComponent(mE)}`, { token: T.PL01 })).d.byCode[codeA] || []).some(y => y.material === matA && y.point === rowsA[0].point + 1), 'Point mới theo ERP');
  r = await call('/api/mm/bom/import', { token: T.PL01, json: { source: 'x.xlsx', rows: [{ modelCode: codeA, material: matA, point: 9, group: 'VLN' }], modelMap: [], dry: true } }); ok(r.status === 400 && /Next ERP/.test(r.d.error), 'BOM theo ERP: không nhập BOM từ file');
  r = await call('/api/mm/bom/row', { token: T.PL01, json: { modelCode: codeA, material: 'GH02-NEW9', point: 1, group: 'VLN' } }); ok(r.status === 400 && /Next ERP/.test(r.d.error), 'BOM theo ERP: không thêm / sửa dòng');
  r = await call('/api/mm/bom/change', { token: A, json: { model: mE, codes: [codeA], oldMaterial: matA, newMaterial: 'GH02-ECN9', reason: 'ECN', effectiveDate: vnToday } }); ok(r.status === 400 && /Next ERP/.test(r.d.error), 'BOM theo ERP: không tạo ECN trong MM');
  const gA = bomA.find(y => y.material === matA)?.group || 'VLN';
  r = await call('/api/mm/bom/group', { token: T.PL01, json: { model: mE, material: matA, group: gA } }); ok(r.d.ok, 'nhóm kitting vẫn sửa được khi BOM theo ERP');
  await call('/api/mm/admin/erp', { token: A, json: { bomSync: false } });
  r = await call('/api/mm/bom/erp', { token: T.KH01 }); ok(!r.d.locked, 'tắt BOM ERP → nhập / sửa BOM trong MM lại được');
  r = await call('/api/mm/bom/erp/sync', { token: T.PL01, json: {} }); ok(r.d.ok, 'đồng bộ tay vẫn chạy khi tắt tự động');
  ok((await call('/api/mm/bom/erp', { token: T.KH01 })).d.locked === false, 'tắt tự động thì không khóa dù vừa đồng bộ tay');
  srv.close();
}
// Tham số Line: lưu không gửi UPH thì giữ UPH cũ; Pending chỉ tính trong ngày làm việc khai báo, sang ngày mới tự về 0
{
  const mP = bom.modelMap.get(bom.rows[0].modelCode);
  await call('/api/mm/lines/params', { token: T.PL01, json: { rows: [{ line: 'Line 5', model: mP, spreadQty: 300, pendingQty: 40, uph: 155 }] } });
  r = await call('/api/mm/lines/params', { token: T.PL01, json: { rows: [{ line: 'Line 5', model: mP, spreadQty: 320, pendingQty: 40 }] } });
  let pr = (await call('/api/mm/lines/params', { token: T.PL01 })).d.rows.find(x => x.line === 'Line 5' && x.model === mP);
  ok(r.d.ok && pr.uph === 155 && pr.spreadQty === 320 && pr.pendingQty === 40, 'lưu tham số không gửi UPH → giữ UPH; pending hôm nay còn hiệu lực');
  const { DatabaseSync } = await import('node:sqlite'), { SCHEMA } = await import('../kitting-app/lib/db.mjs'), pl = await import('../kitting-app/lib/planning.mjs');
  const mdb = new DatabaseSync(':memory:'); mdb.exec(SCHEMA);
  const day = pl.currentShift(mdb).day, yest = pl.addDays(day, -1);
  mdb.prepare("INSERT INTO line_params(line, model, spread_qty, pending_qty, pending_day) VALUES ('L1','M',100,50,?),('L2','M',100,60,?),('L3','M',100,70,NULL)").run(day, yest);
  const g = l => mdb.prepare('SELECT * FROM line_params WHERE line = ?').get(l);
  ok(pl.pendingOf(mdb, g('L1')) === 50 && pl.pendingOf(mdb, g('L2')) === 0 && pl.pendingOf(mdb, g('L3')) === 0, 'pending ngày cũ / chưa có ngày → 0');
  ok(pl.clearExpiredPending(mdb) === 2 && g('L1').pending_qty === 50 && g('L2').pending_qty === 0 && g('L2').spread_qty === 100, 'dọn pending hết hạn, giữ rải chuyền');
  const gp = (await call('/api/mm/lines/params', { token: T.PL01 })).d; ok(gp.workDay && gp.suggest && gp.suggest[mP]?.spreadQty >= 0, 'trả ngày làm việc + gợi ý theo Model');
}
// Change code BOM theo ECN: chỉ Quản trị / Trưởng BP Kho; hẹn ngày + hủy; áp dụng ngay (cập nhật / không cập nhật kit đã lập KH); log + cảnh báo
{
  await new Promise(res => setTimeout(res, 10500));
  const ec = 'GH96-ECN1', mEc = bom.modelMap.get(bom.rows[0].modelCode), vnT = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  await call('/api/mm/bom/import', { token: T.PL01, json: { source: 'ecn.xlsx', rows: [{ modelCode: ec, material: 'GH82-ECNR', point: 1, group: 'REAR' }, { modelCode: ec, material: 'GH98-ECNA', point: 2, group: 'VLDT' }, { modelCode: ec, material: 'GH98-ECNB', point: 1, group: 'VLDT' }], modelMap: [[ec, mEc]] } });
  const base = { model: mEc, codes: [ec], reason: 'ECN', effectiveDate: vnT };
  r = await call('/api/mm/bom/change', { token: T.PL01, json: { ...base, ecn: 'E-0', oldMaterial: 'GH98-ECNA', newMaterial: 'GH98-ECNZ' } }); ok(r.status === 403, 'Planner không change code BOM');
  r = await call('/api/mm/bom/change', { token: T.KH01, json: { ...base, ecn: 'E-0', oldMaterial: 'GH98-ECNA', newMaterial: 'GH98-ECNZ' } }); ok(r.status === 403, 'NV Kho thường (không phải Trưởng BP) không change code');
  r = await call('/api/mm/bom/change/preview', { token: H, json: { ...base, ecn: 'E-1', oldMaterial: 'GH98-KHONGCO', newMaterial: 'X' } }); ok(r.status === 400 && /không có trong BOM/.test(r.d.error), 'code trước phải có trong BOM');
  r = await call('/api/mm/bom/change', { token: H, json: { ...base, ecn: 'E-FUT', oldMaterial: 'GH98-ECNB', newMaterial: 'GH98-ECNB2', effectiveDate: '2099-01-01' } });
  const al = (await call('/api/mm/bom/changes/alerts', { token: T.LN01 })).d.rows, eFut = al.find(x => x.oldMaterial === 'GH98-ECNB')?.ecn;
  const ymd = vnT.replace(/-/g, '').slice(2);
  ok(new RegExp(`^ECN-${ymd}-\\d{3}$`).test(eFut || '') && !al.some(x => x.ecn === 'E-FUT'), 'số ECN tự sinh ECN-YYMMDD-NNN, bỏ qua số nhập tay: ' + eFut);
  ok(r.d.status === 'scheduled' && al.some(x => x.ecn === eFut) && (await call('/api/mm/bom/model?model=' + encodeURIComponent(mEc), { token: T.PL01 })).d.byCode[ec].some(i => i.material === 'GH98-ECNB'), 'ECN ngày sau: chờ áp dụng, BOM chưa đổi, cảnh báo công khai (cả Line thấy)');
  r = await call('/api/mm/bom/change', { token: H, json: { ...base, oldMaterial: 'GH98-ECNB', newMaterial: 'GH98-ECNB9' } }); ok(r.status === 400 && /chờ áp dụng/.test(r.d.error), 'mã đang có ECN chờ áp dụng thì không tạo ECN khác');
  r = await call('/api/mm/bom/change/cancel', { token: H, json: { id: al.find(x => x.ecn === eFut).id, reason: 'Nhập nhầm' } }); ok(r.d.ok, 'hủy ECN chờ áp dụng');
  // 2 kit đã lập KH của code này: K1 đã mở Rear+VLĐT, K2 chưa mở
  const mk2 = async () => { const p = (await call('/api/mm/po/internal', { token: T.PL01, json: { type: 'RMA', modelCode: ec, qty: 10, line: 'Line 2', refDoc: 'ECN' } })).d.po; await call('/api/mm/board/batch', { token: T.PL01, json: { items: [{ type: 'po', id: p }], day: '2030-03-01' } }); return (await call('/api/mm/board?from=2030-03-01&days=1', { token: T.PL01 })).d.columns[0].items.find(i => i.code === p); };
  const k1 = await mk2(), k2 = await mk2();
  await call('/api/mm/kho/kit/start', { token: T.KH01, json: { kitId: k1.id } });
  await call(`/api/mm/kho/kit?id=${k1.id}&grp=HV`, { token: T.KH01 });
  r = await call('/api/mm/bom/change', { token: H, json: { ...base, ecn: 'E-NOW', oldMaterial: 'GH98-ECNA', newMaterial: 'GH98-ECNA2', newPoint: 3, newDescription: 'Mã mới', updatePlanned: true } });
  const it1 = (await call(`/api/mm/kho/kit?id=${k1.id}&grp=HV`, { token: T.KH01 })).d.items;
  const bm = (await call('/api/mm/bom/model?model=' + encodeURIComponent(mEc), { token: T.PL01 })).d.byCode[ec];
  ok(r.d.status === 'applied' && r.d.kitsUpdated.includes(k1.code) && it1.some(i => i.material === 'GH98-ECNA2' && i.required === 30) && !it1.some(i => i.material === 'GH98-ECNA') && bm.some(i => i.material === 'GH98-ECNA2' && i.point === 3 && i.group === 'VLDT'),
    'ECN áp dụng ngay + cập nhật kit đã lập KH: BOM đổi mã + Point, kit đổi mã, định mức theo Point mới ' + r.d.message);
  // không cập nhật kit đã lập KH: K2 (chưa mở) giữ mã cũ GH98-ECNB, kit K1 đã soạn mã cũ giữ nguyên
  await call('/api/mm/kho/kit', { token: T.KH01, json: { kitId: k1.id, grp: 'HV', items: [{ code: ec, material: 'GH98-ECNB', kitted: 5 }] } });
  r = await call('/api/mm/bom/change', { token: H, json: { ...base, ecn: 'E-OLD', oldMaterial: 'GH98-ECNB', newMaterial: 'GH98-ECNB3', updatePlanned: false } });
  await call('/api/mm/kho/kit/start', { token: T.KH01, json: { kitId: k2.id } });
  const it2 = (await call(`/api/mm/kho/kit?id=${k2.id}&grp=HV`, { token: T.KH01 })).d.items, it1b = (await call(`/api/mm/kho/kit?id=${k1.id}&grp=HV`, { token: T.KH01 })).d.items;
  ok(r.d.ok && it2.some(i => i.material === 'GH98-ECNB') && !it2.some(i => i.material === 'GH98-ECNB3') && it1b.some(i => i.material === 'GH98-ECNB' && i.kitted === 5), 'ECN chỉ PO mới: kit đã lập KH giữ BOM cũ (kể cả kit chưa mở)');
  const k3 = await mk2(); await call('/api/mm/kho/kit/start', { token: T.KH01, json: { kitId: k3.id } });
  ok((await call(`/api/mm/kho/kit?id=${k3.id}&grp=HV`, { token: T.KH01 })).d.items.some(i => i.material === 'GH98-ECNB3'), 'PO lập KH sau ECN dùng mã mới');
  r = await call('/api/mm/bom/change', { token: H, json: { ...base, ecn: 'E-KEEP', oldMaterial: 'GH98-ECNB3', newMaterial: 'GH98-ECNB4', updatePlanned: true } });
  ok(r.d.ok && r.d.kitsKept.length === 0 && r.d.kitsUpdated.includes(k3.code), 'cập nhật kit đã lập KH chưa soạn mã cũ');
  const hs = (await call('/api/mm/bom/changes?q=GH98-ECNB', { token: T.KH01 })).d.rows;
  ok(hs.length === 3 && hs.every(x => x.createdBy === 'TK01') && hs.find(x => x.ecn === eFut).status === 'cancelled' && hs.find(x => x.ecn === eFut).cancelledBy === 'TK01' && hs.find(x => x.newMaterial === 'GH98-ECNB3').result.kitsFrozen.length >= 1 && new Set(hs.map(x => x.ecn)).size === hs.length,
    'lịch sử truy xuất theo mã: người tạo / hủy, kết quả');
  r = await call('/api/mm/bom/changes', { token: T.LN01 }); ok(r.status === 200 && r.d.rows.length >= 4, 'ai có quyền xem BOM đều tra được lịch sử change code');
}
// Sản xuất: PO đang ở Line + tình trạng SX; PO đã xong theo khoảng ngày (tối đa 7 ngày)
{
  await new Promise(res => setTimeout(res, 10500));
  const vnD = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10), back = n => new Date(Date.parse(vnD) - n * 864e5).toISOString().slice(0, 10);
  // tự tạo 1 PO RMA → lập KH → kitting đủ 2 nhóm → giao Line 2
  const cp = bom.rows[0].modelCode;
  const rp = (await call('/api/mm/po/internal', { token: T.PL01, json: { type: 'RMA', modelCode: cp, qty: 20, line: 'Line 2', refDoc: 'PROD-TEST' } })).d.po;
  await call('/api/mm/board/batch', { token: T.PL01, json: { items: [{ type: 'po', id: rp }], day: vnD } });
  const kp = (await call(`/api/mm/board?from=${vnD}&days=1`, { token: T.PL01 })).d.columns[0].items.find(i => i.code === rp);
  for (const grp of ['VLN', 'HV']) {
    const kd = (await call(`/api/mm/kho/kit?id=${kp.id}&grp=${grp}`, { token: T.KH01 })).d;
    await call('/api/mm/kho/kit', { token: T.KH01, json: { kitId: kp.id, grp, items: kd.items.map(i => ({ code: i.code, material: i.material, kitted: Math.ceil(i.required) })), confirm: true } });
  }
  const dl = await call('/api/mm/kho/deliver', { token: T.KH01, json: { kitId: kp.id, line: 'Line 2' } });
  const pick = (await call('/api/mm/prod/line?line=Line%202', { token: T.LN01 })).d;
  ok(dl.d.ok, 'giao Line cho thử tab Sản xuất ' + (dl.d.error || ''));
  ok(pick && pick.active.every(p => p.state !== 'done' && 'produced' in p && 'progress' in p) && pick.done === null, 'PO đang ở Line kèm tình trạng SX, chưa chọn ngày thì không trả PO đã xong');
  r = await call(`/api/mm/prod/line?line=${encodeURIComponent(pick.line)}&from=${back(7)}&to=${vnD}`, { token: T.LN01 }); ok(r.status === 400 && /7 ngày/.test(r.d.error), 'chọn quá 7 ngày bị từ chối');
  r = await call(`/api/mm/prod/line?line=${encodeURIComponent(pick.line)}&from=${vnD}`, { token: T.LN01 }); ok(r.status === 400, 'thiếu Đến ngày bị từ chối');
  const po1 = pick.active[0];
  await call('/api/mm/po/production', { token: A, json: { source: 'test-done', rows: [{ po: po1.po, productionQty: po1.planQty }] } });
  r = await call(`/api/mm/prod/line?line=${encodeURIComponent(pick.line)}&from=${back(6)}&to=${vnD}`, { token: T.LN01 });
  const dn = r.d.done?.find(p => p.po === po1.po);
  ok(r.d.ok !== false && dn && dn.done.day === vnD && dn.done.src === 'prod' && !r.d.active.some(p => p.po === po1.po), 'PO vừa xong vào danh sách đã xong (7 ngày), rời danh sách đang chạy');

  // ===== Nhận PO tại Line (quét QR phiếu kitting, Leader giao nhận ký MK cấp 2) + trạng thái PO nội bộ =====
  const mkDeliver = async (type, qty) => {
    const po = (await call('/api/mm/po/internal', { token: T.PL01, json: { type, modelCode: cp, qty, line: 'Line 2', refDoc: 'RC-TEST' } })).d.po;
    await call('/api/mm/board/batch', { token: T.PL01, json: { items: [{ type: 'po', id: po }], day: vnD } });
    const kit = (await call(`/api/mm/board?from=${vnD}&days=1`, { token: T.PL01 })).d.columns[0].items.find(i => i.code === po);
    for (const grp of ['VLN', 'HV']) {
      const kd = (await call(`/api/mm/kho/kit?id=${kit.id}&grp=${grp}`, { token: T.KH01 })).d;
      await call('/api/mm/kho/kit', { token: T.KH01, json: { kitId: kit.id, grp, items: kd.items.map(i => ({ code: i.code, material: i.material, kitted: Math.ceil(i.required) })), confirm: true } });
    }
    const d = await call('/api/mm/kho/deliver', { token: T.KH01, json: { kitId: kit.id, line: 'Line 2' } });
    return { po, kitId: kit.id, ok: d.d.ok, err: d.d.error };
  };
  const ra = await mkDeliver('RMA', 15), ub = await mkDeliver('UNPLAN', 5);
  ok(ra.ok && ub.ok, 'giao 2 PO nội bộ cho Line 2 để thử nhận PO ' + (ra.err || ub.err || ''));
  r = await call('/api/mm/me/pin2', { token: T.LN01, json: { password: 'Kitting2468', pin2: '246801' } }); ok(r.status === 403, 'tài khoản Line không có quyền Leader giao nhận thì không đặt MK cấp 2');
  await call('/api/mm/me/pin2/verify', { token: A, json: { pin2: '135790' } });
  const lineP = (await call('/api/mm/me', { token: T.LN01 })).d.user.perms, lead = { ...lineP, specials: { ...lineP.specials, lineSign: true } };
  const LD = {};
  for (const [u, ln, pin] of [['LD02', 'Line 2', '246802'], ['LD03', 'Line 3', '246803'], ['LD04', '', '246804']]) {
    r = await call('/api/mm/admin/users', { token: A, json: { username: u, role: 'line', line: ln, perms: lead, password: 'Kitting2468' } }); ok(r.d.ok, `tạo Leader giao nhận ${u} ${JSON.stringify(r.d)}`);
    let tk = (await login(u, 'Kitting2468')).d.token; await call('/api/mm/me/password', { token: tk, json: { current: 'Kitting2468', password: 'Leader2026' } });
    tk = (await login(u, 'Leader2026')).d.token; LD[u] = tk;
    r = await call('/api/mm/me/pin2', { token: tk, json: { password: 'Leader2026', pin2: pin } }); ok(r.d.ok, `${u} đặt MK cấp 2 ${JSON.stringify(r.d)}`);
  }
  r = await call('/api/mm/me', { token: T.KH01 }); ok(r.d.perm.specials.some(s => s[0] === 'lineSign'), 'quyền đặc biệt Leader giao nhận có trong danh mục phân quyền');
  let lp2 = (await call('/api/mm/prod/line?line=Line%202', { token: T.LN01 })).d, ra2 = lp2.active.find(p => p.po === ra.po);
  ok(ra2 && ra2.receipt.status === 'pending' && ra2.kitId === ra.kitId && ra2.intStatus === 'waiting' && lp2.receiptCount.pending >= 2, 'PO vừa giao hiện Chờ nhận + trạng thái PO nội bộ Chờ SX ' + JSON.stringify(ra2?.receipt));
  r = await call(`/api/mm/prod/receipt?kitId=${ra.kitId}`, { token: T.LN01 });
  ok(r.status === 200 && r.d.items.length && r.d.items.every(i => 'delivered' in i && 'debt' in i) && r.d.open && r.d.receipt.status === 'pending', 'màn nhận PO: BOM với số đã giao + còn nợ');
  const rcv = (extra, tk = T.LN01) => call('/api/mm/prod/receipt/receive', { token: tk, json: { kitId: ra.kitId, scanned: ra.po, signer: 'LD02', pin2: '246802', ...extra } });
  r = await rcv({ scanned: 'XYZ-123' }); ok(r.status === 400 && /Sai PO/.test(r.d.error), 'quét QR sai PO → báo Sai PO ' + JSON.stringify(r.d));
  r = await rcv({ scanned: ub.po }); ok(r.status === 400 && /Sai PO/.test(r.d.error), 'quét phiếu của PO khác → Sai PO');
  r = await rcv({ scanned: '' }); ok(r.status === 400 && /Quét QR/.test(r.d.error), 'chưa quét thì không xác nhận được');
  r = await rcv({ signer: 'LD03', pin2: '246803' }); ok(r.d.ok === false && /Line 3/.test(r.d.message), 'Leader Line khác không ký được ' + JSON.stringify(r.d));
  r = await rcv({ signer: 'LN01', pin2: '246801' }); ok(r.d.ok === false && /Leader giao nhận/.test(r.d.message), 'tài khoản không có quyền Leader không ký được');
  r = await rcv({ pin2: '000000' }); ok(r.d.ok === false && /không đúng/.test(r.d.message), 'sai MK cấp 2 của Leader');
  r = await rcv({}, T.KH01); ok(r.status === 403, 'Kho (chỉ xem Sản xuất) không xác nhận thay Line');
  r = await call('/api/mm/prod/receipt/reject', { token: T.LN01, json: { kitId: ra.kitId, scanned: ra.po, signer: 'LD02', pin2: '246802' } }); ok(r.status === 400 && /lý do/.test(r.d.error), 'từ chối phải chọn lý do');
  r = await call('/api/mm/prod/receipt/reject', { token: T.LN01, json: { kitId: ra.kitId, scanned: ra.po, signer: 'LD02', pin2: '246802', reason: 'SHORT', note: 'thiếu 5 ea' } });
  ok(r.d.ok && /báo Kho/.test(r.d.message), 'Leader từ chối nhận → báo Kho ' + JSON.stringify(r.d));
  r = await call('/api/mm/kho/receipts', { token: T.KH01 }); ok(r.d.rows.some(x => x.kitId === ra.kitId && x.reason === 'SHORT' && x.note === 'thiếu 5 ea' && x.signer === 'LD02'), 'Kho thấy PO bị từ chối + lý do');
  r = await call('/api/mm/badges', { token: T.KH01 }); ok(r.d.receiptRejected >= 1, 'badge Kho: Line từ chối nhận');
  r = await rcv({}); ok(r.status === 400 && /Kho xử lý/.test(r.d.error), 'đang từ chối thì chưa xác nhận lại được');
  r = await call('/api/mm/kho/receipt/resolve', { token: T.LN01, json: { kitId: ra.kitId, note: 'x' } }); ok(r.status === 403, 'Line không tự đóng lần từ chối');
  r = await call('/api/mm/kho/receipt/resolve', { token: T.KH01, json: { kitId: ra.kitId } }); ok(r.status === 400, 'Kho xử lý phải ghi chú');
  r = await call('/api/mm/kho/receipt/resolve', { token: T.KH01, json: { kitId: ra.kitId, note: 'đã giao bù 5 ea' } }); ok(r.d.ok, 'Kho đánh dấu đã xử lý ' + JSON.stringify(r.d));
  r = await call(`/api/mm/prod/receipt?kitId=${ra.kitId}`, { token: T.LN01 }); ok(r.d.receipt.status === 'pending' && r.d.receipt.khoNote === 'đã giao bù 5 ea' && r.d.log.map(l => l.action).join() === 'resolve,reject', 'PO về Chờ nhận kèm ghi chú Kho, có lịch sử');
  r = await rcv({ scanned: ` ${ra.po.toLowerCase()} ` }); ok(r.d.ok, 'quét lại (khoảng trắng / chữ thường vẫn khớp) → xác nhận nhận ' + JSON.stringify(r.d));
  lp2 = (await call('/api/mm/prod/line?line=Line%202', { token: T.LN01 })).d; ra2 = lp2.active.find(p => p.po === ra.po);
  ok(ra2.receipt.status === 'received' && ra2.receipt.by === 'LD02', 'PO chuyển xanh Đã nhận, ghi người ký');
  r = await rcv({}); ok(r.status === 400 && /đã được/.test(r.d.error), 'không xác nhận 2 lần');
  // khóa 15 phút khi sai MK cấp 2 của Leader 5 lần (Leader không gán Line ký được mọi Line)
  for (let i = 0; i < 5; i++) await call('/api/mm/prod/receipt/receive', { token: T.LN01, json: { kitId: ub.kitId, scanned: ub.po, signer: 'LD04', pin2: '999999' } });
  r = await call('/api/mm/prod/receipt/receive', { token: T.LN01, json: { kitId: ub.kitId, scanned: ub.po, signer: 'LD04', pin2: '246804' } }); ok(r.d.ok === false && /15 phút/.test(r.d.message), 'sai 5 lần → khóa Leader 15 phút');
  r = await call('/api/mm/prod/receipt/receive', { token: T.LN01, json: { kitId: ub.kitId, scanned: ub.po, signer: 'ld02', pin2: '246802' } }); ok(r.d.ok, 'Leader khác vẫn ký được (Mã NV chữ thường)');
  // trạng thái PO nội bộ: chọn nhiều PO, Leader ký
  const ist = (status, extra = {}, tk = T.LN01) => call('/api/mm/prod/internal-status', { token: tk, json: { line: 'Line 2', pos: [ra.po, ub.po], status, signer: 'LD02', pin2: '246802', ...extra } });
  r = await ist('running', {}, T.KH01); ok(r.status === 403, 'Kho không đổi trạng thái SX PO nội bộ');
  r = await ist('xx'); ok(r.status === 400, 'trạng thái không hợp lệ');
  r = await ist('running', { line: 'Line 3' }); ok(r.status === 400 && /chưa được Kho giao cho Line 3/.test(r.d.error), 'PO không ở Line đó bị chặn');
  r = await ist('running', { pos: [ra.po, 'NOPE01'] }); ok(r.status === 400 && /Không có PO/.test(r.d.error), 'PO lạ bị chặn');
  r = await ist('running', { pin2: '111111' }); ok(r.d.ok === false, 'sai MK cấp 2 không đổi trạng thái');
  r = await ist('running'); ok(r.d.ok && r.d.updated === 2, 'chuyển 2 PO nội bộ → Đang SX ' + JSON.stringify(r.d));
  lp2 = (await call('/api/mm/prod/line?line=Line%202', { token: T.LN01 })).d;
  ok([ra.po, ub.po].every(no => { const p = lp2.active.find(x => x.po === no); return p && p.intStatus === 'running' && p.state === 'running' && p.produced === 0; }), 'PO nội bộ hiện Đang SX (chưa có số SX)');
  r = await ist('done'); ok(r.d.ok && r.d.updated === 2, 'chuyển → Hoàn thành');
  lp2 = (await call(`/api/mm/prod/line?line=Line%202&from=${vnD}&to=${vnD}`, { token: T.LN01 })).d;
  ok(![ra.po, ub.po].some(no => lp2.active.find(x => x.po === no)) && [ra.po, ub.po].every(no => { const p = lp2.done.find(x => x.po === no); return p && p.remain === 0 && p.produced === p.planQty && p.done.src === 'prod'; }), 'Hoàn thành: Remain 0, PO sang danh sách đã xong');
  r = await call(`/api/mm/po/history?po=${ra.po}`, { token: T.PL01 }); ok(JSON.stringify(r.d).includes('int_status') && JSON.stringify(r.d).includes('LD02'), 'lịch sử PO ghi đổi trạng thái + người ký');
  r = await ist('waiting'); ok(r.d.ok && r.d.updated === 2, 'lùi về Chờ SX (bấm nhầm)');
  lp2 = (await call('/api/mm/prod/line?line=Line%202', { token: T.LN01 })).d;
  ok([ra.po, ub.po].every(no => { const p = lp2.active.find(x => x.po === no); return p && p.intStatus === 'waiting' && p.remain === p.planQty; }), 'Chờ SX: Remain = Plan, quay lại danh sách đang ở Line');
  // ===== Giao 1 phần + giao bù theo đợt: OP kho soạn bù → Kho giao bù (1 đợt nhiều mã) → Leader ký nhận / từ chối → Kho xử lý =====
  await new Promise(res => setTimeout(res, 10500));
  {
    const k2 = globalThis.FK2;
    let b = (await call('/api/mm/kho/bu', { token: T.KH01 })).d, br = b.rows.find(x => x.kitId === k2.id);
    ok(br && br.items > 0 && br.lots.total === 2 && br.lots.pending === 2, 'Nợ · soạn bù: PO giao 1 phần có trong danh sách, 2 đợt bù cũ chờ Line ký ' + JSON.stringify(br));
    r = await call('/api/mm/kho/bu', { token: T.LN01 }); ok(r.status === 403, 'Line không xem danh sách soạn bù');
    const bd = (await call(`/api/mm/kho/bu/kit?id=${k2.id}`, { token: T.KH01 })).d, [i1, i2, i3] = bd.items;
    ok(bd.items.length === br.items && i3 && bd.items.every(i => i.debt > 0 && 'locs' in i) && bd.lots.map(l => l.lotNo).join() === `${k2.code}-B2,${k2.code}-B3`, 'chi tiết soạn bù: mã nợ + vị trí + các đợt đã bù');
    const sb = (items, tk = T.KH01) => call('/api/mm/kho/bu', { token: tk, json: { kitId: k2.id, items } });
    r = await sb([{ grp: i1.grp, code: i1.code, material: i1.material, qty: i1.cap + 1 }]); ok(r.status === 400 && /tối đa/.test(r.d.error), 'soạn bù quá nợ bị chặn');
    r = await sb([{ grp: i1.grp, code: i1.code, material: i1.material, qty: i1.debt }], T.LN01); ok(r.status === 403, 'Line không soạn bù');
    r = await sb([i1, i2].map(i => ({ grp: i.grp, code: i.code, material: i.material, qty: i.debt }))); ok(r.d.ok && /2\//.test(r.d.message), 'OP kho / Kho soạn bù 2 mã ' + JSON.stringify(r.d));
    const dk = (await call('/api/mm/kho/debts', { token: T.KH01 })).d.rows.find(x => x.kitId === k2.id);
    ok(dk && dk.items.filter(i => i.prepared > 0).length === 2 && dk.lots.total === 2, 'tab Nợ của Kho thấy số OP đã soạn + số đợt');
    const settle = (items, tk = T.KH01) => call('/api/mm/kho/debts/settle', { token: tk, json: { kitId: k2.id, items } });
    r = await settle([{ grp: i1.grp, code: i1.code, material: i1.material, qty: 1 }], T.LN01); ok(r.status === 403, 'Line không giao bù');
    r = await settle([{ grp: i1.grp, code: i1.code, material: i1.material, qty: i1.debt }, { grp: i1.grp, code: i1.code, material: i1.material, qty: 1 }]); ok(r.status === 400 && /2 lần/.test(r.d.error), 'trùng mã trong 1 đợt bị chặn');
    const half = Math.max(1, Math.floor(i3.debt / 2));
    r = await settle([...[i1, i2].map(i => ({ grp: i.grp, code: i.code, material: i.material, qty: i.debt })), { grp: i3.grp, code: i3.code, material: i3.material, qty: half }]);
    ok(r.d.ok && r.d.lotNo === `${k2.code}-B4` && /3 mã/.test(r.d.message) && /chờ Line 2 ký nhận/.test(r.d.message), 'Kho giao bù 1 đợt 3 mã → đợt B4 ' + JSON.stringify(r.d));
    ok(!(await call(`/api/mm/kho/bu/kit?id=${k2.id}`, { token: T.KH01 })).d.items.some(i => i.prepared > 0), 'giao bù xong thì trừ số đã soạn');
    let rv = (await call(`/api/mm/prod/receipt?kitId=${k2.id}`, { token: T.LN01 })).d, x3 = rv.items.find(i => i.material === i3.material), xf = rv.items.find(i => i.material === 'GH98-FRAC');
    ok(rv.lots.length === 3 && rv.totals.lotsPending === 3 && x3.bu === half && x3.buN === 1 && x3.initial === r3x(x3.delivered - half) && xf.buN === 2 && xf.debt === 0, 'màn nhận PO: Giao đầu · Giao bù (tổng × số đợt) · Còn nợ ' + JSON.stringify(x3));
    let lp = (await call(`/api/mm/prod/line?line=Line%202&from=${vnD}&to=${vnD}`, { token: T.LN01 })).d, pk = [...lp.active, ...(lp.done || [])].find(p => p.kitId === k2.id);
    ok(pk && pk.receipt.lotsPending === 3 && lp.lotCount.pending >= 3 && pk.debts.n > 0, 'bảng PO ở Line: số đợt bù chờ ký + còn nợ ' + JSON.stringify({ rc: pk?.receipt, d: pk?.debts, lc: lp.lotCount, st: pk?.state }));
    const lots = (await call('/api/mm/prod/lots?line=Line%202', { token: T.LN01 })).d, mine = lots.rows.filter(l => l.kitId === k2.id);
    ok(mine.length === 3 && mine.every(l => l.status === 'pending' && l.items.length), 'Line xem đợt giao bù chờ nhận');
    const id = no => mine.find(l => l.lotNo === `${k2.code}-${no}`).id;
    const sign = (extra, tk = T.LN01) => call('/api/mm/prod/lots/receive', { token: tk, json: { line: 'Line 2', ids: [id('B2'), id('B3')], signer: 'LD02', pin2: '246802', ...extra } });
    r = await sign({}, T.KH01); ok(r.status === 403, 'Kho không ký nhận thay Line');
    r = await sign({ pin2: '000000' }); ok(r.d.ok === false, 'sai MK cấp 2 không ký được');
    r = await sign({ signer: 'LD03', pin2: '246803' }); ok(r.d.ok === false && /Line 3/.test(r.d.message), 'Leader Line khác không ký');
    r = await sign({}); ok(r.d.ok && /2 đợt/.test(r.d.message), 'Leader ký nhận 2 đợt 1 lần ' + JSON.stringify(r.d));
    r = await sign({}); ok(r.status === 400 && /đã được/.test(r.d.error), 'không ký nhận 2 lần');
    const rej = extra => call('/api/mm/prod/lots/receive', { token: T.LN01, json: { line: 'Line 2', ids: [id('B4')], signer: 'LD02', pin2: '246802', reject: true, ...extra } });
    r = await rej({}); ok(r.status === 400 && /lý do/.test(r.d.error), 'từ chối đợt bù phải chọn lý do');
    r = await rej({ reason: 'SHORT', note: 'thiếu 1 cuộn' }); ok(r.d.ok && /báo Kho/.test(r.d.message), 'Leader từ chối đợt B4');
    const kr = (await call('/api/mm/kho/receipts', { token: T.KH01 })).d;
    ok(kr.lots.some(l => l.id === id('B4') && l.note === 'thiếu 1 cuộn'), 'Kho thấy đợt bị từ chối');
    r = await call('/api/mm/kho/lot/resolve', { token: T.LN01, json: { id: id('B4'), note: 'x' } }); ok(r.status === 403, 'Line không tự xử lý từ chối');
    r = await call('/api/mm/kho/lot/resolve', { token: T.KH01, json: { id: id('B4'), note: '' } }); ok(r.status === 400, 'Kho xử lý phải ghi chú');
    r = await call('/api/mm/kho/lot/resolve', { token: T.KH01, json: { id: id('B4'), note: 'đã bổ sung 1 cuộn' } }); ok(r.d.ok, 'Kho xử lý → đợt về Chờ nhận');
    r = await call('/api/mm/prod/receipt/receive', { token: T.LN01, json: { kitId: k2.id, scanned: k2.code, signer: 'LD02', pin2: '246802' } }); ok(r.d.ok, 'Line xác nhận nhận PO (đợt 1) ' + JSON.stringify(r.d));
    rv = (await call(`/api/mm/prod/receipt?kitId=${k2.id}`, { token: T.LN01 })).d;
    ok(rv.lots.every(l => l.status === 'received') && rv.lots.find(l => l.lotNo.endsWith('-B4')).signedBy.includes('nhận PO') && rv.totals.debtItems > 0, 'nhận PO thì nhận luôn đợt bù đang chờ; còn nợ → Nhận 1 phần');
    const led = (await call('/api/mm/prod/debts?line=Line%202', { token: T.LN01 })).d, lr = led.rows.find(x => x.kit === k2.code && x.material === i3.material);
    ok(lr && lr.lots.length === 1 && lr.unsigned === 0 && lr.paid === half && led.events.some(e => e.type === 'settle' && e.lot === `${k2.code}-B4`), 'sổ nợ Line: số đợt bù, đợt chưa ký, mã đợt trong lịch sử');
    r = await call('/api/mm/prod/ready?line=Line%202', { token: T.LN01 }); ok(r.status === 200 && Array.isArray(r.d.rows) && 'ready' in r.d.count, 'bấm PO sẵn giao: danh sách PO chờ giao của Line');
    r = await call('/api/mm/prod/ready?line=Line%202', { token: T.PL01 }); ok(r.status === 200 || r.status === 403, 'PO sẵn giao theo quyền xem Sản xuất');
    const hs = (await call('/api/mm/kho/history?days=1', { token: T.KH01 })).d.rows;
    ok(hs.some(h => h.type === 'short_confirm' && /Hết tồn/.test(h.note || '')), 'lịch sử ghi lý do xác nhận xong còn thiếu');
  }
}
// Nhập kế hoạch kitting từ Excel của Planner: sheet kiểu cũ gộp Line + Model, sheet Kitting theo PO gộp theo BOM Number
await new Promise(res => setTimeout(res, 10500));
{
  const pool = (await call('/api/mm/board?from=2030-03-01&days=1', { token: T.PL01 })).d.pool.filter(i => i.type === 'po' && i.poType === 'SAP' && /^0\d{11}$/.test(i.po));
  const byModel = new Map(); for (const p of pool) { if (!byModel.has(p.model)) byModel.set(p.model, []); byModel.get(p.model).push(p); }
  const [mA, A] = [...byModel].sort((a, b) => b[1].length - a[1].length)[0];
  ok(A.length >= 6, `đủ PO chưa lập KH cùng Model để thử nhập (${mA}: ${A.length})`);
  const H1 = ['LINE', 'CA', 'PLAN DATE', 'LINE GMES', 'MODEL', 'MASTER', 'MODEL CODE', 'PO', 'MASTER QTY', 'KITTING QTY', 'MARKET'];
  const r1 = (line, p, po = p.po, qty = p.planQty) => [line, 'Day', '11/12/26', 'x', mA, '12-Nov', p.modelCode, po, qty, qty, 'SEVT'];
  const sheet1 = { name: 'Plan ngày 12.11', rows: [['', '', '', '', '', '', '', 'Total'], H1, r1('Line 02', A[0]), r1('Line 02', A[1], `${A[1].po}-1`, 5), ['Line 02', 'Day', '11/12/26', 'Line RMA', mA, '', A[0].modelCode, '0R4944AMA1112', 3, 3], r1('Line 03', A[2]), r1('', A[3])] };
  const H2 = ['Master', 'Model', 'PO IL-Sung', 'BOM Number', 'Line', 'PO', 'Code', 'Số lượng', 'SL Line', 'Kitting Qty'];
  const r2 = (g, line, p) => ['11/13/26', mA, `111326ILSUNG000${g}`, String(g), line, p.po, p.modelCode, p.planQty, '', ''];
  const sheet2 = { name: 'Plan B8', rows: [['', 'x'], H2, r2(1, 'Line 3', A[4]), r2(1, '0', A[5]), r2(2, '', A[0]), ['11/12/26', mA, '111226ILSUNG0003', '3', 'Line 3', '11112612UN943', A[4].modelCode, 4]] };
  const other = { name: 'remain PO', rows: [['Line Gmes', 'Model', 'Code', 'PO'], ['', '', '', '']] };
  const imp = (extra, tk = T.PL01) => call('/api/mm/board/import', { token: tk, json: { fileName: 'Kế hoạch Ngày 12.11.2026 final.xlsx', sheets: [sheet1, sheet2, other], ...extra } });
  r = await imp({ dry: true }, T.LN01); ok(r.status === 403, 'Line không nhập kế hoạch');
  r = await imp({ dry: true }, T.KH01); ok(r.status === 403, 'Kho không nhập kế hoạch');
  const pv = (await imp({ dry: true })).d;
  ok(pv.ok && pv.suggestedDay.endsWith('-11-12') && pv.sheets.map(s => s.kind).join() === 'line,bom,', 'nhận dạng 2 kiểu sheet + gợi ý ngày kitting từ PLAN DATE ' + JSON.stringify(pv.sheets.map(s => [s.name, s.kind])));
  const g = k => pv.groups.find(x => x.key === k);
  const gL2 = g(`Line 2 · ${mA}`), gL3 = g(`Line 3 · ${mA}`), gNo = g(`(trống) · ${mA}`), gB1 = g('1'), gB2 = g('2');
  ok(gL2 && gL2.action === 'merge' && gL2.line === 'Line 2' && gL2.items.length === 2 && gL2.items[1].split && /lấy cả PO/.test(gL2.items[1].note), 'kiểu cũ: cùng Line + Model gộp 1 Kit, "Line 02" → Line 2, PO "-1" lấy PO gốc');
  ok(gL3?.action === 'single' && gNo?.action === 'single' && gNo.line === '', 'Line khác thì không gộp; trống Line = không có Line dự kiến');
  ok(pv.sheets[0].skipped.some(s => s.po === '0R4944AMA1112') && pv.sheets[1].skipped.some(s => s.po === '11112612UN943'), 'PO nội bộ trong file bỏ qua');
  ok(gB1?.action === 'merge' && gB1.line === 'Line 3' && gB1.items.length === 2, 'kiểu Kitting theo PO: cùng BOM Number = 1 Kit, Line lấy dòng có dữ liệu');
  ok(gB2?.items[0].status === 'dup', 'PO đã có ở nhóm trước không nhập 2 lần');
  r = await imp({ day: '2030-03-02' }); ok(r.d.ok && /4 Kit/.test(r.d.message) && r.d.undo, 'nhập kế hoạch: tạo Kit, hoàn tác được ' + JSON.stringify(r.d));
  let bd = (await call('/api/mm/board?from=2030-03-02&days=1', { token: T.PL01 })).d.columns[0].items;
  const kOf = p => bd.find(k => k.pos.some(x => x.po === p.po));
  ok(bd.length >= 4 && kOf(A[0]) === kOf(A[1]) && kOf(A[0]).kind === 'merged' && kOf(A[0]).planLine === 'Line 2' && kOf(A[2]).planLine === 'Line 3' && !kOf(A[3]).planLine && kOf(A[4]) === kOf(A[5]), 'Kit đúng nhóm, Line dự kiến trên Kit ' + JSON.stringify(bd.map(k => [k.code, k.planLine, k.pos.length])));
  ok(bd.indexOf(kOf(A[0])) < bd.indexOf(kOf(A[2])) && bd.indexOf(kOf(A[2])) < bd.indexOf(kOf(A[4])), 'thứ tự trong ngày theo thứ tự file');
  r = await imp({ dry: true, day: '2030-03-02' }); ok(r.d.sum.keep === 4 && !r.d.sum.merge, 'nhập lại cùng file: các Kit giữ nguyên');
  r = await call('/api/mm/board/undo', { token: T.PL01, json: {} }); ok(r.d.ok, 'hoàn tác nhập kế hoạch');
  bd = (await call('/api/mm/board?from=2030-03-02&days=1', { token: T.PL01 })).d.columns[0].items; ok(!bd.some(k => k.pos.some(x => [A[0], A[4]].some(p => p.po === x.po))), 'hoàn tác: PO về như trước khi nhập');
  r = await imp({ day: '2030-03-02', exclude: [`Plan B8\u001f1`], skipSheets: ['remain PO'] }); ok(r.d.ok && /3 Kit/.test(r.d.message), 'bỏ chọn 1 nhóm khi nhập');
  // Line dự kiến hiện cho Kho; giao Line khác chỉ cảnh báo
  const k2 = (await call('/api/mm/board?from=2030-03-02&days=1', { token: T.PL01 })).d.columns[0].items.find(k => k.planLine === 'Line 2');
  const q = (await call('/api/mm/kho/queue?grp=VLN', { token: T.KH01 })).d.rows.find(x => x.id === k2.id); ok(q && q.planLine === 'Line 2', 'hàng chờ Kho có Line dự kiến');
  r = await call(`/api/mm/kho/deliver-preview?id=${k2.id}&line=Line%203`, { token: T.KH01 }); ok(r.d.warnPlanLine && /Line 2/.test(r.d.warnPlanLine) && !r.d.fixedBlock, 'giao Line khác Line dự kiến: chỉ cảnh báo, không chặn');
  // PO đã bắt đầu kitting: giữ nguyên Kit
  await call('/api/mm/kho/kit/start', { token: T.KH01, json: { kitId: k2.id } });
  r = await imp({ dry: true, day: '2030-03-04' }); ok(r.d.groups.find(x => x.key === `Line 2 · ${mA}`).items.every(i => i.status === 'locked') && r.d.sum.locked >= 2, 'Kit Kho đã bắt đầu: không đụng, báo giữ nguyên');
  await call('/api/mm/kho/kit/start', { token: T.KH01, json: { kitId: k2.id, back: true } });
}
// Planner gộp thêm PO vào Kit đã gộp / gộp các Kit gộp với nhau — chỉ khi Kho chưa kitting và chưa in phiếu; vượt giới hạn chỉ cảnh báo
await new Promise(res => setTimeout(res, 10500));
{
  const B = async () => (await call('/api/mm/board?from=2030-04-01&days=1', { token: T.PL01 })).d;
  const pool = (await B()).pool.filter(i => i.type === 'po' && i.poType === 'SAP');
  const byModel = new Map(); for (const p of pool) { if (!byModel.has(p.model)) byModel.set(p.model, []); byModel.get(p.model).push(p); }
  const P = [...byModel.values()].sort((a, b) => b.length - a.length)[0];
  ok(P.length >= 6, 'đủ PO cùng Model để thử gộp thêm ' + P.length);
  const po = p => ({ type: 'po', id: p.id }), kitOf = async p => (await B()).pool.concat(...(await B()).columns.map(c => c.items)).find(i => i.type === 'kit' && i.pos.some(x => x.po === p.code));
  const merge = items => call('/api/mm/board/merge', { token: T.PL01, json: { items } });
  r = await merge([po(P[0]), po(P[1])]); const k1 = r.d.code; ok(r.d.ok && /^K-/.test(k1), 'gộp 2 PO thành Kit gộp ' + k1);
  let K1 = await kitOf(P[0]);
  r = await merge([{ type: 'kit', id: K1.id }, po(P[2])]); ok(r.d.ok && r.d.code === k1 && /gộp thêm vào/.test(r.d.message), 'gộp thêm PO vào Kit đã gộp: giữ mã Kit ' + r.d.message);
  K1 = await kitOf(P[0]); ok(K1.code === k1 && K1.pos.length === 3, 'Kit gộp có thêm PO');
  r = await merge([po(P[3]), po(P[4])]); const K2 = await kitOf(P[3]);
  r = await merge([{ type: 'kit', id: K1.id }, { type: 'kit', id: K2.id }]); ok(r.d.ok && r.d.code === k1 && r.d.count === 5, 'gộp 2 Kit đã gộp với nhau → giữ mã Kit chọn trước ' + r.d.message);
  ok(!(await B()).pool.some(i => i.id === K2.id) && (await kitOf(P[4])).code === k1, 'Kit gộp thứ 2 nhập vào, không còn riêng');
  r = await call('/api/mm/board/undo', { token: T.PL01, json: {} }); ok(r.d.ok && (await kitOf(P[0])).pos.length === 3 && (await kitOf(P[3])).code === K2.code, 'hoàn tác gộp thêm: trả 2 Kit như trước');
  // Kit Kho đã in phiếu: không gộp / tách được
  K1 = await kitOf(P[0]);
  await call('/api/mm/board/batch', { token: T.PL01, json: { items: [{ type: 'kit', id: K1.id }], day: '2030-04-01' } });
  r = await call('/api/mm/kho/print', { token: T.KH01, json: { kitId: K1.id, grp: 'VLN' } }); ok(r.d.ok, 'Kho in phiếu Kit');
  const bd = await B(); ok(bd.columns[0].items.find(i => i.id === K1.id)?.printed === true, 'bảng Kế hoạch đánh dấu Kit đã in phiếu');
  r = await merge([{ type: 'kit', id: K1.id }, po(P[5])]); ok(r.status === 400 && /in phiếu/.test(r.d.error), 'Kit đã in phiếu: không gộp thêm ' + JSON.stringify(r.d));
  r = await call('/api/mm/board/split', { token: T.PL01, json: { id: K1.id } }); ok(r.status === 400 && /in phiếu/.test(r.d.error), 'Kit đã in phiếu: không tách');
  r = await call('/api/mm/board/batch', { token: T.PL01, json: { items: [{ type: 'kit', id: K1.id }], day: '2030-04-02' } }); ok(r.d.ok, 'Kit đã in phiếu vẫn đổi ngày kitting được');
}
// PO Load thành phẩm: Planner nhập số dương → PO số âm; chỉ gộp với PO thật cùng Model Code → trừ vật liệu; Σ Remain Line trừ khi PO thật còn việc; tự Hoàn thành
await new Promise(res => setTimeout(res, 10500));
{
  const B = async () => (await call('/api/mm/board?from=2030-05-01&days=1', { token: T.PL01 })).d;
  const pool = (await B()).pool.filter(i => i.type === 'po' && i.poType === 'SAP' && i.planQty >= 300 && !i.productionQty);
  const P = pool[0], Q = pool.find(x => x.model === P.model && x.modelCode !== P.modelCode) || pool.find(x => x.modelCode !== P.modelCode);
  ok(P && Q, 'có PO thật để thử Load thành phẩm');
  const mkLoad = (qty, code = P.modelCode, tk = T.PL01) => call('/api/mm/po/internal', { token: tk, json: { type: 'LOAD', modelCode: code, qty, refDoc: 'PXK-TP-01', note: 'thử' } });
  r = await mkLoad(100, P.modelCode, T.LN01); ok(r.status === 403, 'Line không tạo PO Load thành phẩm');
  r = await call('/api/mm/po/internal', { token: T.PL01, json: { type: 'LOAD', modelCode: P.modelCode, qty: 100 } }); ok(r.status === 400 && /phiếu xuất kho/.test(r.d.error), 'Load TP bắt buộc số phiếu xuất kho');
  r = await mkLoad(100); const L1 = r.d.po; ok(r.d.ok && /^TP\d{10}$/.test(L1) && /−100/.test(r.d.message), 'tạo PO Load TP không cần Line, số PO TP… ' + r.d.message);
  let h = (await call(`/api/mm/po/history?po=${L1}`, { token: T.PL01 })).d; ok(h.internal?.type === 'LOAD' && h.internal.qty === 100, 'sửa PO Load hiện SL dương');
  let pl = (await B()).pool.find(i => i.code === L1); ok(pl && pl.planQty === -100 && pl.poType === 'LOAD', 'PO Load nằm ở cột Chưa lập KH với SL âm');
  r = await call('/api/mm/board/batch', { token: T.PL01, json: { items: [{ type: 'po', id: pl.id }], day: '2030-05-01' } }); ok(r.status === 400 && /không kitting riêng/.test(r.d.error), 'PO Load không xếp kitting riêng');
  r = await call('/api/mm/board/merge', { token: T.PL01, json: { items: [{ type: 'po', id: pl.id }, { type: 'po', id: Q.id }] } }); ok(r.status === 400, 'PO Load khác Model Code không gộp được ' + (r.d.error || ''));
  r = await call('/api/mm/board/merge', { token: T.PL01, json: { items: [{ type: 'po', id: pl.id }, { type: 'po', id: P.id }] } }); ok(r.d.ok, 'gộp PO Load vào PO thật cùng Model Code ' + (r.d.error || r.d.message));
  const kitOf = async () => (await B()).pool.find(i => i.type === 'kit' && i.pos.some(x => x.po === P.code));
  let K = await kitOf(); ok(K && K.planQty === P.planQty - 100 && K.loadTp[0]?.qty === 100, 'Kit SL = PO thật − thành phẩm, có ghi chú Load TP');
  r = await mkLoad(P.planQty); const L2 = (await B()).pool.find(i => i.code === r.d.po);
  r = await call('/api/mm/board/merge', { token: T.PL01, json: { items: [{ type: 'kit', id: K.id }, { type: 'po', id: L2.id }] } }); ok(r.status === 400 && /nhỏ hơn/.test(r.d.error), 'thành phẩm ≥ PO thật cùng code bị chặn');
  r = await call('/api/mm/po/internal/edit', { token: T.PL01, json: { po: L1, qty: 50 } }); ok(r.d.ok && /tính lại/.test(r.d.message), 'sửa SL PO Load (50) → Kit tính lại');
  K = await kitOf(); ok(K.planQty === P.planQty - 50, 'Kit SL theo SL Load mới');
  r = await call('/api/mm/board/split', { token: T.PL01, json: { id: K.id } }); ok(r.d.ok, 'tách Kit có PO Load');
  ok((await B()).pool.some(i => i.code === L1 && i.type === 'po'), 'tách Kit: PO Load về cột Chưa lập KH');
  r = await call('/api/mm/board/merge', { token: T.PL01, json: { items: [{ type: 'po', id: (await B()).pool.find(i => i.code === L1).id }, { type: 'po', id: P.id }] } });
  K = await kitOf(); await call('/api/mm/board/batch', { token: T.PL01, json: { items: [{ type: 'kit', id: K.id }], day: '2030-05-01' } });
  // kitting: định mức theo SL đã trừ thành phẩm (cả Rear)
  const kd = { VLN: (await call(`/api/mm/kho/kit?id=${K.id}&grp=VLN`, { token: T.KH01 })).d };
  ok(kd.VLN.kit.qty === P.planQty - 50 && kd.VLN.kit.loadTp?.[0]?.qty === 50, 'hộp kitting: SL Kit đã trừ + khung Line nhận thêm thành phẩm');
  await call('/api/mm/kho/kit/start', { token: T.KH01, json: { kitId: K.id } });
  kd.HV = (await call(`/api/mm/kho/kit?id=${K.id}&grp=HV`, { token: T.KH01 })).d;
  const vln = kd.VLN.items[0], tot = (await call(`/api/mm/kho/material-summary?to=2030-05-01`, { token: T.KH01 })).d.rows.filter(x => x.kit === K.code);
  ok(kd.HV.items.length && tot.length, 'định mức VLN + Rear/VLĐT dựng theo SL đã trừ thành phẩm');
  for (const grp of ['VLN', 'HV']) {
    const d = (await call(`/api/mm/kho/kit?id=${K.id}&grp=${grp}`, { token: T.KH01 })).d;
    await call('/api/mm/kho/kit', { token: T.KH01, json: { kitId: K.id, grp, items: d.items.map(i => ({ code: i.code, material: i.material, kitted: Math.ceil(i.required) })), confirm: true } });
  }
  const sup = async () => (await call('/api/mm/kho/lines', { token: T.KH01 })).d.lines.find(l => l.line === 'Line 3').supply.remainSum;
  const before = await sup();
  r = await call('/api/mm/kho/deliver', { token: T.KH01, json: { kitId: K.id, line: 'Line 3' } });
  ok(r.d.ok, 'giao Kit có PO Load cho Line ' + (r.d.error || ''));
  const after = await sup(); ok(after - before === P.planQty - 50, `Σ Remain Line tăng = PO thật − thành phẩm (${before} → ${after})`);
  r = await call(`/api/mm/prod/receipt?kitId=${K.id}`, { token: T.LN01 }); ok(r.d.kit?.loadTp?.[0]?.qty === 50, 'màn nhận PO tại Line có ghi chú thành phẩm');
  r = await call('/api/mm/prod/internal-status', { token: T.LN01, json: { line: 'Line 3', pos: [L1], status: 'done', signer: 'LD04', pin2: '246804' } }); ok(r.status === 400 && /tự Hoàn thành/.test(r.d.error), 'PO Load không chuyển trạng thái tay');
  r = await call('/api/mm/po/production', { token: A, json: { source: 'test-load', rows: [{ po: P.code, productionQty: P.planQty }] } }); ok(r.d.ok !== false, 'PO thật sản xuất xong');
  h = (await call(`/api/mm/po/history?po=${L1}`, { token: T.PL01 })).d;
  ok(JSON.stringify(h.rows).includes('PO thật cùng Kit đã xong'), 'PO Load tự Hoàn thành khi PO thật xong');
  ok(await sup() === before, 'PO thật xong: Σ Remain không còn treo số âm');
}
// Dữ liệu từ trình nhận QR (qr/): cột PO / ProdQ / Remain / Status; ProdQ trống → bỏ qua; SHA sai → từ chối
const qrObj = { schema: ['PO', 'Model', 'PlanQ', 'ProdQ', 'Remain', 'Status'], rows: [[11075090139, 'GH96-1', 10, 4, 6, 'Đang SX'], [11075090140, 'GH96-1', 5, null, 5, 'Chờ']], mode: 'full', merged: false, epoch: 7, shaOk: true };
x = readProdQr(qrObj, 'qr.json');
ok(x.rows.length === 1 && x.skipped === 1 && x.rows[0].po === '11075090139' && x.rows[0].productionQty === 4 && x.rows[0].remainQty === 6 && x.rows[0].status === 'Đang SX' && x.epoch === 7 && !x.partial, 'đọc dữ liệu trình nhận QR ' + JSON.stringify(x));
ok((() => { try { readProdQr({ ...qrObj, shaOk: false }); return false; } catch (e) { return /SHA-256/.test(e.message); } })(), 'QR sai SHA-256 bị từ chối');
ok(readProdQr({ ...qrObj, mode: 'delta' }).partial === true, 'delta chưa ghép = cập nhật một phần');
ok(readProdTable([['PO', 'ProdQ'], ['123', 5]]).rows[0].productionQty === 5, 'Excel xuất từ trình nhận QR (cột ProdQ)');
fs.writeFileSync('/tmp/tokens.json', JSON.stringify({ A, ...T }));
console.log(`PASS ${pass} FAIL ${failN}`);
