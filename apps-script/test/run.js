#!/usr/bin/env node
// ทดสอบ Apps Script ด้วยข้อมูลจำลอง (ไม่ใช้เครือข่าย ไม่ต้อง npm install)
//   node apps-script/test/run.js          ทดสอบเซิร์ฟเวอร์ + หน้าเว็บ (หน้าเว็บต้องมี playwright ในเครื่อง ถ้าไม่มีจะข้าม)
//   node apps-script/test/run.js --unit   ทดสอบเฉพาะเซิร์ฟเวอร์
// ต้องมี python3 + openpyxl สำหรับแปลงไฟล์ตัวอย่าง (dashboard/samples/*.xlsx)
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const assert = require('assert');
const { load, IDS } = require('./gas_mock');

const OUT = path.join(__dirname, '.out');
execFileSync('python3', [path.join(__dirname, 'make_fixtures.py'), OUT], { stdio: 'inherit' });
const sheets = JSON.parse(fs.readFileSync(path.join(OUT, 'sheets.json'), 'utf8'));
const EXP = JSON.parse(fs.readFileSync(path.join(OUT, 'expected.json'), 'utf8'));
const ALLOWED = EXP.users[0];

const results = [];
function test(group, name, expect, fn) {
  try { const actual = fn(); results.push({ group, name, expect, actual: actual == null ? 'ตรงตามคาด' : String(actual), pass: true }); }
  catch (e) { results.push({ group, name, expect, actual: 'ไม่ผ่าน: ' + (e && e.message), pass: false }); }
}
const throwsMsg = fn => { try { fn(); } catch (e) { return e.message; } throw new Error('ไม่ได้โยน Error'); };

// ---------- 1) สิทธิ์การเข้าถึง ----------
test('สิทธิ์', 'อีเมลในแท็บ ผู้ใช้ เปิด Dashboard ได้', 'ได้หน้า Index พร้อม title และ viewport', () => {
  const g = load({ sheets, email: ALLOWED }); const o = g.doGet();
  assert.ok(o.getContent().includes('id="view"')); assert.strictEqual(o.getTitle(), 'Dashboard งานตรวจ DNA'); assert.ok(o.metas.viewport);
  return 'title "' + o.getTitle() + '", มี viewport, xfo = ค่าเริ่มต้น';
});
test('สิทธิ์', 'อีเมลตัวพิมพ์ใหญ่/มีช่องว่าง (" ' + ALLOWED.toUpperCase() + ' ")', 'เปิดได้ (ไม่สนตัวพิมพ์)', () => {
  const g = load({ sheets, email: ' ' + ALLOWED.toUpperCase() + ' ' }); assert.ok(g.doGet().getContent().includes('id="view"'));
});
test('สิทธิ์', 'อีเมลที่ไม่อยู่ในรายชื่อ', 'หน้า "ไม่มีสิทธิ์เข้าถึง" แสดงอีเมลและผู้ที่ต้องติดต่อ', () => {
  const g = load({ sheets, email: 'stranger@example.org', props: { ADMIN_CONTACT: 'ผู้ดูแลทดสอบ' } }); const h = g.doGet().getContent();
  assert.ok(h.includes('ไม่มีสิทธิ์เข้าถึง') && h.includes('stranger@example.org') && h.includes('ผู้ดูแลทดสอบ')); assert.ok(!h.includes('id="view"'));
  return 'แสดงอีเมล + "ผู้ดูแลทดสอบ" ไม่มีเนื้อหา Dashboard';
});
test('สิทธิ์', 'อีเมลว่าง (Google ไม่ส่งอีเมลมา)', 'ปฏิเสธ และบอกว่าไม่ทราบอีเมล', () => {
  const g = load({ sheets, email: '' }); const h = g.doGet().getContent();
  assert.ok(h.includes('ไม่มีสิทธิ์เข้าถึง') && h.includes('ระบบไม่ทราบอีเมลของคุณ'));
});
test('สิทธิ์', 'อีเมลที่มี <script> (กันแทรกโค้ด)', 'ถูก escape', () => {
  const g = load({ sheets, email: '<script>x</script>@example.org' }); const h = g.doGet().getContent();
  assert.ok(!h.includes('<script>x') && h.includes('&lt;script&gt;'));
});
test('สิทธิ์', 'บัญชีที่ไม่มีสิทธิ์อ่านชีต (Execute as user)', 'ปฏิเสธ พร้อมเหตุผล', () => {
  const g = load({ sheets, email: ALLOWED, noAccess: new Set([IDS.cases]) }); const h = g.doGet().getContent();
  assert.ok(h.includes('ยังไม่ได้รับสิทธิ์')); return 'ปฏิเสธ: "ยังไม่ได้รับสิทธิ์ ผู้มีสิทธิ์อ่าน"';
});
test('สิทธิ์', 'ไม่มีแท็บ ผู้ใช้', 'ปฏิเสธทุกคน (fail closed)', () => {
  const g = load({ sheets, email: ALLOWED, dropTabs: { cases: ['ผู้ใช้'] } }); assert.ok(g.doGet().getContent().includes('ไม่พบแท็บ'));
});
test('สิทธิ์', 'ยังไม่ตั้ง CASES_SHEET_ID', 'ปฏิเสธ พร้อมบอกให้ตั้งค่า', () => {
  const g = load({ sheets, email: ALLOWED, props: { CASES_SHEET_ID: null } }); assert.ok(g.doGet().getContent().includes('CASES_SHEET_ID'));
});
test('สิทธิ์', 'เรียก getBook / getSources โดยไม่มีสิทธิ์ (ข้าม doGet)', 'โยน Error "ไม่มีสิทธิ์" ทุกฟังก์ชันข้อมูล', () => {
  for (const email of ['', 'stranger@example.org']) {
    const g = load({ sheets, email });
    for (const f of [() => g.getBook('cases'), () => g.getBook('lab'), () => g.getSources()]) assert.ok(throwsMsg(f).includes('ไม่มีสิทธิ์'));
  }
});
test('สิทธิ์', 'ลบอีเมลออกจากแท็บ ผู้ใช้ ระหว่างใช้งาน', 'ขอข้อมูลครั้งถัดไป (หลังแคชสิทธิ์ 60 วินาทีหมด) ถูกปฏิเสธ', () => {
  const s2 = JSON.parse(JSON.stringify(sheets)); const g = load({ sheets: s2, email: ALLOWED });
  g.getBook('cases');
  const u = s2.cases['ผู้ใช้']; u.splice(u.findIndex(r => r[0] === ALLOWED), 1);
  g.__state.caches.clear();   // จำลองแคชหมดอายุ
  assert.ok(throwsMsg(() => g.getBook('cases')).includes('ไม่มีสิทธิ์'));
});
test('สิทธิ์', 'getBook ด้วย key แปลก ("__proto__", "x")', 'โยน Error', () => {
  const g = load({ sheets, email: ALLOWED }); throwsMsg(() => g.getBook('__proto__')); throwsMsg(() => g.getBook('x'));
});

// ---------- 2) การอ่านข้อมูล ----------
let caseBook, labBook;
test('อ่านข้อมูล', 'getSources', 'คืน 2 แหล่ง + อีเมลผู้ใช้', () => {
  const g = load({ sheets, email: ALLOWED }); const r = g.__call('getSources');
  assert.deepStrictEqual(r.sources.map(s => s.key), ['cases', 'lab']); assert.strictEqual(r.email, ALLOWED);
});
test('อ่านข้อมูล', 'getBook("cases") ส่งเฉพาะคอลัมน์ที่ใช้', 'ไม่มี User ID (LINE) / เลขหนังสือนำส่ง / ลงวันที่', () => {
  const g = load({ sheets, email: ALLOWED }); caseBook = g.__call('getBook', 'cases');
  const head = caseBook.tabs['ข้อมูลคดี'][0];
  assert.strictEqual(head[0], 'เลข บก.');
  for (const bad of ['User ID (LINE)', 'เลขหนังสือนำส่ง', 'ลงวันที่', 'ตั้งค่า']) assert.ok(!head.includes(bad), bad);
  assert.ok(!JSON.stringify(caseBook).includes('U-mock-'));
  return head.length + ' คอลัมน์: ' + head.join(', ');
});
test('อ่านข้อมูล', 'แปลงวันที่เป็นเลข serial (ส่งผ่าน google.script.run ได้)', 'วันที่รับแถวแรก = ' + EXP.firstRecvSerial, () => {
  const t = caseBook.tabs['ข้อมูลคดี'], ci = t[0].indexOf('วันที่รับ');
  assert.strictEqual(t[1][ci], EXP.firstRecvSerial); return 'ได้ ' + t[1][ci];
});
test('อ่านข้อมูล', 'แถวข้อมูลคดี', '731 แถว + หัว', () => { assert.strictEqual(caseBook.tabs['ข้อมูลคดี'].length, 732); return '732 แถว (รวมหัว)'; });
test('อ่านข้อมูล', 'getBook("lab")', 'มี 4 แท็บ ข้อมูลเคส/ข้อมูลงบ/ข้อมูล Lot/หมายเหตุ', () => {
  const g = load({ sheets, email: ALLOWED }); labBook = g.__call('getBook', 'lab');
  assert.deepStrictEqual(labBook.names, ['ข้อมูลเคส', 'ข้อมูลงบ', 'ข้อมูล Lot', 'หมายเหตุ']);
});
test('อ่านข้อมูล', 'แคช: เรียก getBook ซ้ำ', 'ครั้งที่ 2 ไม่เปิดชีตข้อมูลอีก, ผลเหมือนเดิม', () => {
  const g = load({ sheets, email: ALLOWED }); const a = g.__call('getBook', 'cases'); const n = g.__state.opens;
  const b = g.__call('getBook', 'cases'); assert.strictEqual(g.__state.opens, n); assert.deepStrictEqual(a, b);
  const chunks = +g.__state.caches.get(ALLOWED).get('book2:cases:n'); return 'เปิดชีต ' + n + ' ครั้ง, แคช ' + chunks + ' ชิ้น';
});

test('อ่านข้อมูล', 'checkSetup() (ผู้ดูแลรันใน editor)', 'บอกจำนวนแถวของทุกแท็บ ไม่มีค่าข้อมูลคดี; คนนอกรายชื่อรันไม่ได้', () => {
  const out = load({ sheets, email: ALLOWED }).checkSetup();
  assert.ok(out.includes('ข้อมูลคดี 731 แถว') && out.includes('ข้อมูล Lot')); assert.ok(!out.includes('/2565'));
  assert.ok(throwsMsg(() => load({ sheets, email: 'stranger@example.org' }).checkSetup()).includes('ไม่มีสิทธิ์'));
  return out.split('\n').slice(1).join(' | ');
});

// ---------- 3) Stats.gs เทียบกับ Python ----------
const g0 = load({ sheets, email: ALLOWED });
const S = g0.Stats;
const records = S.parseCases(caseBook.tabs['ข้อมูลคดี']);
const plain = o => JSON.parse(JSON.stringify(o));   // วัตถุจาก vm มี prototype คนละชุด
const asObj = arr => Object.fromEntries(arr.map(x => [x.name, x.cases]));
const LABEL = { '2022-12': 'ธ.ค. 2565', '2023-01': 'ม.ค. 2566 (ข้ามปี)', '2025-09': 'ก.ย. 2568', '2025-10': 'ต.ค. 2568 (ข้ามปีงบ)', '2026-10': 'ต.ค. 2569 (เดือนล่าสุด)', '2025': 'ปี 2568 (ม.ค.–ธ.ค.)', '2022': 'ปี 2565 (ม.ค.–ธ.ค.)' };
const statsOf = {};
for (const [k, e] of Object.entries(EXP.ranges)) {
  test('Stats', 'สรุป ' + LABEL[k], `คดี ${e.cases}, ของกลาง ${e.evidence} (Python)`, () => {
    const range = k.length === 4 ? S.yearRange(+k) : S.monthRange(+k.slice(0, 4), +k.slice(5));
    assert.strictEqual(range.start, e.start); assert.strictEqual(range.end, e.end);
    const s = S.summarize(records, range); statsOf[k] = s;
    assert.strictEqual(s.cases, e.cases); assert.strictEqual(s.evidence, e.evidence); assert.strictEqual(s.notCounted, e.notCounted);
    assert.deepStrictEqual(asObj(s.byType), e.byType);
    assert.deepStrictEqual(Object.fromEntries(s.byOfficer.map(o => [o.name, { cases: o.cases, types: asObj(o.byType) }])), e.byOfficer);
    return `คดี ${s.cases}, ของกลาง ${s.evidence}, ${s.byType.length} ประเภท, ${s.byOfficer.length} ผู้ตรวจ (รวม "ไม่ระบุ") ตรงทุกค่า`;
  });
}
test('Stats', 'คดีค้าง (กำลังดำเนินการ + เสร็จแล้ว รอรับผล)', `${EXP.pending.total} คดี (Python)`, () => {
  const p = S.pendingCases(records, { today: '2026-10-31' });
  assert.strictEqual(p.total, EXP.pending.total); assert.deepStrictEqual(plain(p.byStatus), EXP.pending.byStatus); assert.strictEqual(p.list[0].bk, EXP.pending.oldest);
  return `${p.total} คดี (${Object.entries(p.byStatus).map(([k, v]) => k + ' ' + v).join(', ')}) ค้างนานสุด ${p.list[0].ageDays} วัน`;
});
test('Stats', 'ค้นคดี ' + EXP.lookup.bk, 'พบ สถานะ ' + EXP.lookup.status, () => {
  const f = S.findCase(records, EXP.lookup.bk); assert.strictEqual(f.length, EXP.lookup.count);
  assert.strictEqual(f[0].status, EXP.lookup.status); assert.strictEqual(f[0].recvYmd, EXP.lookup.recvYmd);
  assert.ok(!('officer' in f[0])); return `พบ ${f.length} รายการ รับ ${f[0].recvYmd} สถานะ ${f[0].status} (ไม่ส่งชื่อผู้ตรวจ)`;
});
test('Stats', 'ค้นคดีแบบเลขไทย/มี 0 นำหน้า/ช่องว่าง', 'พบคดีเดียวกัน', () => {
  const [n, y] = EXP.lookup.bk.split('/'); const th = s => s.replace(/\d/g, d => String.fromCharCode(0x0E50 + +d));
  for (const q of [th(EXP.lookup.bk), ' 00' + n + ' / ' + y + ' ']) assert.strictEqual(S.findCase(records, q).length, EXP.lookup.count, q);
});
test('Stats', 'ค้นคดีที่ไม่มี (9999/2569, ข้อความว่าง)', 'ไม่พบ (อาร์เรย์ว่าง)', () => {
  assert.strictEqual(S.findCase(records, '9999/2569').length, 0); assert.strictEqual(S.findCase(records, '').length, 0);
});
const bkk = s => new Date(s + '+07:00');
for (const [now, kind, exp] of [
  ['2027-01-01T00:05:00', 'month', ['2026-12-01', '2026-12-31', 'ธ.ค. 2569']],
  ['2027-01-01T00:05:00', 'year', ['2026-01-01', '2026-12-31', 'ปี 2569']],
  ['2026-10-01T08:00:00', 'month', ['2026-09-01', '2026-09-30', 'ก.ย. 2569']],
  ['2026-03-01T06:59:00', 'month', ['2026-02-01', '2026-02-28', 'ก.พ. 2569']],
  ['2024-03-01T01:00:00', 'month', ['2024-02-01', '2024-02-29', 'ก.พ. 2567']]]) {
  test('Stats', `ช่วง${kind === 'month' ? 'เดือน' : 'ปี'}ก่อนหน้า เมื่อเวลาไทย ${now.replace('T', ' ')}`, exp.join(' – '), () => {
    const r = kind === 'month' ? S.previousMonthRange(bkk(now)) : S.previousYearRange(bkk(now));
    assert.deepStrictEqual([r.start, r.end, r.label], exp);
  });
}
test('Stats', 'ฟังก์ชันใน Stats เรียกจากหน้าเว็บไม่ได้', 'ไม่มีฟังก์ชันระดับบนสุดชื่อ summarize/findCase', () => {
  for (const k of ['summarize', 'findCase', 'pendingCases', 'parseCases']) assert.strictEqual(typeof g0[k], 'undefined');
});

fs.writeFileSync(path.join(OUT, 'stats_by_month.json'), JSON.stringify(statsOf, null, 1));
fs.writeFileSync(path.join(OUT, 'books.json'), JSON.stringify({ cases: caseBook, lab: labBook, sources: g0.__call('getSources') }));
// หน้าปฏิเสธ (ไว้ถ่ายภาพหน้าจอ)
fs.writeFileSync(path.join(OUT, 'denied.html'), load({ sheets, email: 'stranger@example.org', props: { ADMIN_CONTACT: 'ผู้ดูแลระบบ (ตัวอย่าง)' } }).doGet().getContent());

// ---------- 4) หน้าเว็บ (Playwright) ----------
(async () => {
  if (!process.argv.includes('--unit')) {
    let ui = null;
    try { ui = require('./ui'); } catch (e) { console.log('ข้ามทดสอบหน้าเว็บ: ' + e.message); }
    if (ui) await ui.run({ results, OUT, EXP, statsOf });
  }
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.group}] ${r.name} — ${r.actual}`);
  console.log(`\n${pass}/${results.length} ผ่าน`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  process.exit(pass === results.length ? 0 : 1);
})();
