// Đóng gói app Kitting cho PocketBase: mm_lib.js (nghiệp vụ), readers.js (đọc Excel trên trình duyệt), pb_public.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const OUT = 'pkg/mm-app';
await build({ entryPoints: ['src/pb-entry.mjs'], bundle: true, format: 'cjs', platform: 'neutral', target: 'es2017', outfile: `${OUT}/pb_hooks/mm_lib.js`,
  banner: { js: '// TỰ SINH từ mã nguồn (build.mjs) — không sửa tay.' }, legalComments: 'none', mainFields: ['module', 'main'] });
const shims = fileURLToPath(new URL('../shims', import.meta.url));
await build({ entryPoints: ['src/web-readers.mjs'], bundle: true, format: 'iife', globalName: 'MMReaders', platform: 'browser', target: 'es2019', outfile: `${OUT}/pb_public/readers.js`, minify: true,
  alias: { exceljs: `${shims}/exceljs.js`, 'node:fs/promises': `${shims}/node-fs-promises.js`, 'node:path': `${shims}/node-path.js`, 'node:fs': `${shims}/node-fs.js` } });
for (const f of fs.readdirSync('web')) if (fs.statSync(`web/${f}`).isFile()) fs.copyFileSync(`web/${f}`, `${OUT}/pb_public/${f}`);
fs.mkdirSync(`${OUT}/pb_public/vendor`, { recursive: true });
for (const f of fs.readdirSync('web/vendor')) fs.copyFileSync(`web/vendor/${f}`, `${OUT}/pb_public/vendor/${f}`);
// Trình nhận QR (../qr-receiver, ILSQ v1) phục vụ tại /qr/ — dùng chung đăng nhập app để gửi thẳng vào Cập nhật sản xuất.
const QR = '../qr-receiver', QR_OUT = `${OUT}/pb_public/qr`;
fs.rmSync(QR_OUT, { recursive: true, force: true }); fs.mkdirSync(`${QR_OUT}/lib`, { recursive: true });
for (const f of ['index.html', 'ilsq.js']) fs.copyFileSync(`${QR}/${f}`, `${QR_OUT}/${f}`);
for (const f of ['jsQR.js', 'pako.min.js', 'xlsx.full.min.js']) fs.copyFileSync(`${QR}/lib/${f}`, `${QR_OUT}/lib/${f}`);
console.log('built', fs.statSync(`${OUT}/pb_hooks/mm_lib.js`).size, 'bytes lib');
