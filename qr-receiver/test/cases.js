/* Ca kiểm thử T1–T8 (mục 11.2) + kiểm delta (mục 7). Dùng chung: test/run.cjs (Node) và test/testvector.html (trình duyệt).
   runIlsqTests(ILSQ, inflateRaw) → Promise<[{ id, name, pass, detail }]> */
(function (root) {
  const VEC = [
    ':B9:NAV50*D32S7000500N30MPFHWE3WE7UD6G73Q5OQEQCCWF7EOCB461DCXJCJ-CWZC:A6:/6EM6FA7L-CXICJ*6KA7OF66:66UC-Q62:6L*6WG60:6G%6RW6% C5UCF46:A6Y CSW63R65:6IE4*F4WE4 Q6UF4S9ENPCWE4X96:F4NPC0$CQCC:G79F480A3Q5NZ96VC7UD3Q5N7ACECPBA3Q5T7AV3EPBA3Q5XIAB$DZEDIE4CF43WENWE:OE% B/3Q.XE',
    ':B9:NAW50*D32S7100500F10B$B+L9JPO O1$6N 83R69A3CV6M/18KN2C/66G9M1RN:1:3NI EB8U2X15G260EO-JMQQVNH2UFEA1HA4TENS04$HC+ 0LSB',
    ':B9:NAW50*D32S7200500F10M413S7T%L9POKNRW$Q1*3ZON$TQ0ZI$BBEDADUNRCH.TIQBGDUV9R1SRDWSUFQDMKDXCJSRBD71TCGW%QO*B2WB %0R%ATEK',
    ':B9:NAW50*D32S7300500F10Y0BL*C39W/A93IMC+V4RM:7D4I8LAHCJ2.DKM41 UJPB0DB1ATA5:GG2K- DXS4.XEJ4WL93Q7H+KFXUSZFVFLGP4S35G3FK',
    ':B9:NAW50*D32S7400500E00/KO-:NS31+/SY94NKU4LUP1G:*Q'
  ];
  const HEX1 = '494c535101011a2b3c4d00010005003c5d8f4b0ac2500c45b7221947485a5f7daf333fa013f137114a07d5d60fbcb6a27524eec10db812a76ec49d98d2528aa37bef09b92177b8821fc0620e067c5c04';
  const SHA = 'c205a6bdf4e31d713b90f6b76d952178d841746f2f726451efd7091deb524877';
  const JSON_TXT = '{"s":["PO","Model","PlanQ","ProdQ","Remain","Status"],"c":[[11075090139,11075088812,11075091001,11075091002],["GH96-16355A","GH96-15937D","GH96-16012B","GH96-16012B"],[1,960,1200,800],[1,960,450,null],[0,0,750,800],["Completed","Completed","Đang SX","Chờ"]],"m":"full","d":[],"b":0}';
  const ROWS = [[11075090139, 'GH96-16355A', 1, 1, 0, 'Completed'], [11075088812, 'GH96-15937D', 960, 960, 0, 'Completed'],
    [11075091001, 'GH96-16012B', 1200, 450, 750, 'Đang SX'], [11075091002, 'GH96-16012B', 800, null, 800, 'Chờ']];

  async function runIlsqTests(ILSQ, inflateRaw) {
    const out = [], add = (id, name, pass, detail = '') => out.push({ id, name, pass: !!pass, detail });
    const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');
    async function feed(list, rx) {
      rx = rx || ILSQ.createReceiver({ inflateRaw });
      for (const s of list) rx.handleQrText(s);
      const res = rx.state.finishing ? await rx.state.finishing : null;
      return { rx, res, st: rx.state.stats, pg: rx.progress() };
    }
    const good = res => res && res.ok && res.shaOk === true && res.sha === SHA && res.rawText === JSON_TXT && JSON.stringify(res.rows) === JSON.stringify(ROWS)
      && res.fileId === '1a2b3c4d' && res.total === 5 && res.hs.epoch === 1 && res.hs.n === 4;
    const why = r => r.res ? `ok=${r.res.ok} sha=${r.res.shaOk} ${r.res.error || ''}` : `chưa hoàn tất (${r.pg.have.length + (r.pg.hs ? 1 : 0)}/${r.pg.total || '?'})`;

    // V0: bộ giải mã Base45 + header
    const u1 = ILSQ.b45decode(VEC[1]), p1 = ILSQ.parsePacket(u1), p0 = ILSQ.decodeText(VEC[0]);
    add('V0', 'Giải mã gói idx=1 đúng hex + header; gói bắt tay đúng', hex(u1) === HEX1 && p1 && p1.idx === 1 && p1.total === 5 && p1.len === 60 && p1.fileId === 0x1a2b3c4d && p1.type === 1 && p0 && p0.type === 0,
      p1 ? `len=${p1.len}` : 'parse lỗi');

    let r = await feed(VEC);
    add('T1', 'Đúng thứ tự → hoàn tất, SHA khớp, bảng đúng', good(r.res), why(r));
    r = await feed([...VEC].reverse());
    add('T2', 'Ngược thứ tự (bắt tay cuối) → như T1', good(r.res), why(r));
    let seed = 12345, okN = 0;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let k = 0; k < 20; k++) {
      const a = [...VEC]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      if (good((await feed(a)).res)) okN++;
    }
    add('T3', 'Xáo trộn ngẫu nhiên 20 lần', okN === 20, `${okN}/20`);
    r = await feed(VEC.flatMap(s => [s, s, s]));
    add('T4', 'Lặp mỗi chuỗi 3 lần → như T1, dup = 10', good(r.res) && r.st.dup === 10, `dup=${r.st.dup}`);

    const s2 = VEC[2], pos = 20, ch = s2[pos] === 'A' ? 'B' : 'A', bad2 = s2.slice(0, pos) + ch + s2.slice(pos + 1);
    r = await feed(VEC.map((s, i) => i === 2 ? bad2 : s));
    const t5a = !r.res && r.st.bad === 1 && !r.pg.have.includes(2);
    r.rx.handleQrText(s2); const t5b = await r.rx.state.finishing;
    add('T5', 'Sai 1 ký tự gói 2 → loại, chưa xong; đưa lại chuỗi đúng → xong', t5a && good(t5b), `bad=${r.st.bad} sau sửa: ${t5b ? t5b.ok : 'chưa xong'}`);

    const nosp = s2.replace(/ /g, '');
    r = await feed(VEC.map((s, i) => i === 2 ? nosp : s));
    add('T6', 'Xoá dấu cách trong gói 2 → bị loại (dấu cách là dữ liệu)', s2.includes(' ') && !r.res && r.st.bad === 1, `bad=${r.st.bad}`);

    const f = ILSQ.b45decode(VEC[1]); const dv = new DataView(f.buffer); dv.setUint32(6, 0xdeadbeef); dv.setUint32(16 + 60, ILSQ.crc32(f.subarray(0, 76)));
    const foreign = ILSQ.b45encode(f);
    r = await feed([VEC[0], foreign, ...VEC.slice(1)]);
    const r7b = await feed([foreign, ...VEC]);   // gói lạ đến trước bắt tay → bị loại khi phát lại pending
    add('T7', 'Trộn 1 gói phiên khác → foreign +1, kết quả đúng', ILSQ.b45decode(foreign).length === f.length && r.st.foreign === 1 && good(r.res) && r7b.st.foreign === 1 && good(r7b.res), `foreign=${r.st.foreign}/${r7b.st.foreign}`);

    r = await feed(VEC.filter((_, i) => i !== 3));
    add('T8', 'Thiếu gói 3 → không hoàn tất, ô 3 còn trống', !r.res && !r.pg.done && !r.pg.have.includes(3) && r.pg.have.length === 3, `have=${r.pg.have.sort().join(',')}`);

    // Delta (mục 7): bản gốc từ T1 → áp delta
    const full = (await feed(VEC)).res, base = ILSQ.baseFromFull(full.obj, full.rows, 1);
    const dObj = { s: full.obj.s, m: 'delta', b: 1, d: [11075088812] }, dRows = [[11075091002, 'GH96-16012B', 800, 100, 700, 'Đang SX'], [11075099999, 'GH96-1X', 5, null, 5, 'Chờ']];
    const m = ILSQ.mergeDelta(base, dObj, dRows, 2), after = m.ok ? ILSQ.baseRows(m.base) : [];
    add('D1', 'Delta: sửa 1, thêm 1, xoá 1 — giữ thứ tự', m.ok && after.length === 4 && after[0][0] === 11075090139 && after[2][3] === 100 && after[3][0] === 11075099999 && m.changed.length === 1 && m.added.length === 1 && m.removed.length === 1 && m.base.epoch === 2,
      JSON.stringify(after.map(x => x[0])));
    const mBad = ILSQ.mergeDelta(base, { ...dObj, b: 7 }, dRows, 8);
    add('D2', 'Delta lệch epoch → từ chối, không ghi đè', !mBad.ok && /#1/.test(mBad.error) && /#7/.test(mBad.error) && Object.keys(base.map).length === 4, mBad.error || '');
    // SHA-256 JS thuần (trang mở qua HTTP thường, VD trong app MM) phải trùng crypto.subtle / test vector
    const enc = t => new TextEncoder().encode(t), big = new Uint8Array(200000).map((_, i) => (i * 31 + 7) & 255);
    const shaCases = [[enc(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'], [enc('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'], [enc(JSON_TXT), SHA]];
    const subtleBig = (typeof crypto !== 'undefined' && crypto.subtle) ? await ILSQ.sha256Hex(big) : null;
    add('S1', 'SHA-256 JS thuần đúng (rỗng, "abc", JSON test vector, 200 KB)', shaCases.every(([u, h]) => ILSQ.sha256js(u) === h) && (!subtleBig || ILSQ.sha256js(big) === subtleBig), subtleBig ? 'so với crypto.subtle' : '');
    return out;
  }
  if (typeof module === 'object' && module.exports) module.exports = { runIlsqTests };
  else root.runIlsqTests = runIlsqTests;
})(typeof self !== 'undefined' ? self : this);
