import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
const SH = fileURLToPath(new URL('../shims', import.meta.url)), TMP = `${os.tmpdir()}/pbhooks`;
import fs from 'node:fs';
fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP);
for (const f of fs.readdirSync('pkg/mm-app/pb_hooks')) fs.copyFileSync(`pkg/mm-app/pb_hooks/${f}`, `${TMP}/${f}`);
await build({ entryPoints: ['src/test-seed.mjs'], bundle: true, format: 'cjs', platform: 'neutral', target: 'es2017', outfile: `${TMP}/mm_test.js`,
  alias: { exceljs: `${SH}/exceljs.js`, 'node:fs/promises': `${SH}/node-fs-promises.js`, 'node:path': `${SH}/node-path.js`, bcryptjs: `${SH}/exceljs.js` } });
fs.writeFileSync(`${TMP}/zz_test.pb.js`, `routerAdd("POST", "/api/mmtest/{op}", (e) => {
  const t = require(__hooks + "/mm_test.js"); const op = e.request.pathValue("op"); let out, err;
  try { $app.runInTransaction((tx) => { try { out = op === "seed" ? t.seed(tx) : t.summary(tx); } catch (x) { err = x; throw x; } }); } catch (x) { err = err || x; }
  return err ? e.json(500, { error: String(err && err.stack || err) }) : e.json(200, out);
});`);
console.log('test hooks ok ->', TMP);
