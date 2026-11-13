// Chạy T1–T8 + delta bằng Node: node test/run.cjs
const ILSQ = require('../ilsq.js'), pako = require('../lib/pako.min.js'), { runIlsqTests } = require('./cases.js');
runIlsqTests(ILSQ, u8 => pako.inflateRaw(u8)).then(rs => {
  for (const r of rs) console.log(`${r.pass ? 'ĐẠT      ' : 'KHÔNG ĐẠT'} ${r.id}  ${r.name}${r.detail ? '  · ' + r.detail : ''}`);
  const bad = rs.filter(r => !r.pass).length;
  console.log(bad ? `\n${bad}/${rs.length} ca KHÔNG ĐẠT` : `\nĐẠT ${rs.length}/${rs.length}`);
  process.exit(bad ? 1 : 0);
});
