// Bản chạy thử trên Claude = ĐÚNG giao diện mm/web + nghiệp vụ lib/ của gói PocketBase, máy chủ giả lập trong trình duyệt.
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
const P = u => fileURLToPath(new URL(u, import.meta.url));
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const APP = P('../../kitting-app'), WEB = P('../web'), SH = P('../../shims');
const shim = { 'node:sqlite': 'node-sqlite.js', 'node:fs': 'node-fs.js', 'node:fs/promises': 'node-fs-promises.js', 'node:path': 'node-path.js', exceljs: 'exceljs.js' };
const plugins = [{ name: 'shims', setup(b) { b.onResolve({ filter: /^(node:(sqlite|fs|fs\/promises|path)|exceljs)$/ }, a => ({ path: path.join(SH, shim[a.path]) })); } }];
const bundle = async (entry, extra = {}) => (await esbuild.build({ entryPoints: [entry], bundle: true, format: 'iife', platform: 'browser', target: 'es2020', write: false, plugins, nodePaths: [P('../../node_modules')], ...extra })).outputFiles[0].text;
const server = await bundle(P('./demo-server.js'));
const readers = await bundle(P('../src/web-readers.mjs'), { globalName: 'MMReaders', minify: true });
const read = p => readFileSync(p, 'utf8'), js = t => t.replace(/<\/script/gi, '<\\/script');
const demo = {};
for (const f of ['Production Plan by Order_DEMO.xlsx', 'BOM_kitting_DEMO.xlsx']) demo[f] = readFileSync(path.join(APP, 'demo-data', f)).toString('base64');
let html = read(path.join(WEB, 'index.html'));
const icon = 'data:image/svg+xml;base64,' + Buffer.from(read(path.join(WEB, 'icon.svg'))).toString('base64');
const V = (html.match(/app\.css\?v=(\w+)/) || [])[1];
html = html.replace('<!doctype html>', '<!DOCTYPE html>')
  .replace('<link rel="icon" href="icon.svg" type="image/svg+xml">', `<link rel="icon" href="${icon}" type="image/svg+xml">`)
  .replace(`<link rel="stylesheet" href="app.css?v=${V}">`, () => `<style>\n${read(path.join(WEB, 'app.css'))}\n</style>`)
  .replace('<title>Quản lý Kitting vật liệu</title>', '<title>Kitting vật liệu — bản chạy thử</title>');
const scripts = [
  read(path.join(WEB, 'vendor/Sortable.min.js')),
  read(path.join(WEB, 'vendor/exceljs.min.js')),
  read(path.join(WEB, 'vendor/xlsx.full.min.js')),
  read(path.join(WEB, 'vendor/qrcode.min.js')),
  read(path.join(WEB, 'vendor/jsQR.min.js')),   // đọc QR phiếu kitting (nhận PO tại Line)
  readers,
  read(P('../../node_modules/sql.js/dist/sql-asm.js')),
  `globalThis.__DEMO_FILES__=${JSON.stringify(demo)};`,
  server,
  read(path.join(WEB, 'app.js')), read(path.join(WEB, 'kho.js')), read(path.join(WEB, 'report.js')), read(path.join(WEB, 'prod.js')), read(path.join(WEB, 'kitpad.js'))
].map(s => `<script>\n${js(s)}\n</script>`).join('\n');
const tags = `  <script src="vendor/Sortable.min.js"></script>\n  <script src="vendor/qrcode.min.js"></script>\n  <script src="app.js?v=${V}"></script>\n  <script src="kho.js?v=${V}"></script>\n  <script src="report.js?v=${V}"></script>\n  <script src="prod.js?v=${V}"></script>\n  <script src="kitpad.js?v=${V}"></script>`;
if (!html.includes(tags)) throw new Error('Không tìm thấy thẻ script trong index.html');
if (html.includes('href="app.css')) throw new Error('CSS chưa nhúng');
html = html.replace(tags, () => scripts);
writeFileSync(P('./Kitting_MM_ChayThu.html'), html);
console.log('OK', (html.length / 1e6).toFixed(2), 'MB');
