#!/usr/bin/env node
// ทดสอบจากการตรวจความปลอดภัย (docs/test-results/04-security-review.md)
//
// หมายเหตุสำคัญ: ไฟล์นี้ "ไม่ได้" อยู่ใน run.js โดยตั้งใจ
//   ส่วน A = ตาราง ฟังก์ชันสาธารณะ × ผู้เรียก (ต้องผ่านทั้งหมด)
//   ส่วน B = กรณีที่พบปัญหา (KNOWN-ISSUE) ยืนยันพฤติกรรมที่ "ควรเป็น" จึงไม่ผ่านจนกว่าจะแก้โค้ด
//   เมื่อแก้แล้วให้ย้ายกรณีในส่วน B ไปไว้ใน run.js
//
// รัน: node apps-script/test/run.js --unit   (สร้าง .out/sheets.json ก่อน)
//      node apps-script/test/security_review.js
// exit code: 0 = ส่วน A ผ่านทั้งหมด (ส่วน B แสดงผลอย่างเดียว ไม่ทำให้ exit ไม่เป็น 0)
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { load, IDS } = require('./gas_mock');

const sheets = JSON.parse(fs.readFileSync(path.join(__dirname, '.out', 'sheets.json'), 'utf8'));
const OWNER = 'owner@example.com', ADMIN2 = 'admin2@example.org', USER = 'staff1@example.com', STRANGER = 'stranger@example.org';
const link = id => 'https://docs.google.com/spreadsheets/d/' + id + '/edit';

function env(o = {}) {
  const opts = { sheets, email: o.email || OWNER,
    props: Object.assign({ CASES_SHEET_ID: null, LAB_SHEET_ID: null, ADMIN_EMAIL: OWNER, WEBHOOK_TOKEN: 'mock-webhook-token-0123456789abcdef0123' }, o.props || {}),
    fetch: () => ({ code: 200, body: {} }) };
  if ('effectiveEmail' in o) opts.effectiveEmail = o.effectiveEmail;
  return load(opts);
}
const as = (g, e) => { g.__state.email = e; return g; };
function seeded(o) {
  const g = env(o);
  as(g, OWNER).adminSaveSource({ link: link(IDS.cases), name: 'คดีส่งตรวจ DNA (ทดสอบ)' });
  g.adminSaveSource({ link: link(IDS.lab), name: 'งานตรวจ DNA' });
  g.adminSaveUser({ email: USER, name: 'เจ้าหน้าที่ ก', note: '' });
  g.adminSaveUser({ email: ADMIN2, name: 'ผู้ดูแล ข', note: '', admin: true });
  return g;
}
const outcome = (g, who, fn, args) => {
  const before = JSON.stringify(g.__state.props), fetches = g.__state.fetches.length;
  as(g, who); let r;
  try { const v = g[fn](...args); r = typeof v === 'string' && fn === 'dailySummaryJob' ? 'คืน "' + v + '"' : v && v.getContent ? (fn === 'doPost' ? 'คืน "' + v.getContent() + '"' : /id="view"/.test(v.getContent()) ? 'หน้า Dashboard' : 'หน้าไม่มีสิทธิ์') : 'คืนค่า'; }
  catch (e) { r = 'ปฏิเสธ'; }
  if (JSON.stringify(g.__state.props) !== before) r += ' +แก้ props';
  if (g.__state.fetches.length !== fetches) r += ' +เรียกเครือข่าย';
  return r;
};

const results = [];
const test = (part, name, fn) => { try { const a = fn(); results.push({ part, name, pass: true, actual: a == null ? 'ตรงตามคาด' : String(a) }); }
  catch (e) { results.push({ part, name, pass: false, actual: e.message }); } };

// ---------------- ส่วน A: ตารางฟังก์ชันสาธารณะ × ผู้เรียก ----------------
const sid = (g, k) => { const e = g.__state.email, eff = g.__opts.effectiveEmail; delete g.__opts.effectiveEmail;
  const s = as(g, OWNER).getSources().sources; as(g, e); if (eff !== undefined) g.__opts.effectiveEmail = eff;
  return (k === 'lab' ? s.find(x => x.kind === 'lab') : s.find(x => x.main)).id; };
const FNS = g => [['doGet', []], ['getSources', []], ['getBook', [sid(g)]], ['checkSetup', []],
  ['adminInspectSource', [link(IDS.cases)]], ['adminSaveSource', [{ id: sid(g, 'lab'), name: 'เปลี่ยนชื่อ' }]], ['adminRemoveSource', [sid(g, 'lab')]], ['adminSetMain', [sid(g)]],
  ['adminGetPeople', []], ['adminSaveUser', [{ email: 'evil@example.org', admin: true }]], ['adminSetAdmin', [USER, true]], ['adminRemoveUser', [USER]],
  ['doPost', [{ parameter: { token: 'guess' }, postData: { contents: '{"events":[{}]}' } }]],
  ['startSetupMode', []], ['showSetupGroups', []], ['allowSeenGroup', []], ['makeWebhookToken', []],
  ['dailySummaryJob', [{ triggerUid: 'trig-1' }]], ['previewSummary', [2569, 1]], ['previewYearSummary', [2568]], ['installTriggers', []], ['removeTriggers', []]];

const matrix = {};
test('A', 'ทุกฟังก์ชันสาธารณะ: คนนอก/ผู้ใช้ทั่วไปเรียกบน Dashboard และทุกคนยกเว้นเจ้าของบนลิงก์บอต → ไม่ได้ข้อมูล ไม่แก้ props ไม่เรียกเครือข่าย', () => {
  const callers = [
    ['ก) คนนอก (Dashboard)', () => seeded(), STRANGER],
    ['ข) ผู้ใช้ (Dashboard)', () => seeded(), USER],
    ['ค) ผู้ดูแล (Dashboard)', () => seeded(), ADMIN2],
    ['บอต: ไม่ล็อกอิน', () => { const g = seeded(); g.__opts.effectiveEmail = OWNER; return g; }, ''],
    ['บอต: Workspace โดเมนเดียว', () => { const g = seeded(); g.__opts.effectiveEmail = OWNER; return g; }, ADMIN2]
  ];
  // public functions found by scanning the .gs files (non-_ top-level functions)
  const src = fs.readdirSync(path.join(__dirname, '..')).filter(f => f.endsWith('.gs')).map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
  const pub = [...src.matchAll(/^function\s+([A-Za-z0-9]+)\s*\(/gm)].map(m => m[1]).filter(n => !n.endsWith('_'));
  const listed = FNS(seeded()).map(x => x[0]);
  assert.deepStrictEqual(pub.slice().sort(), listed.slice().sort(), 'รายชื่อฟังก์ชันสาธารณะไม่ตรงกับที่ทดสอบ');
  for (const [label, mk, who] of callers) {
    for (let idx = 0; idx < listed.length; idx++) {
      const g = mk(); const [fn, args] = FNS(g)[idx]; const r = outcome(g, who, fn, args);
      (matrix[fn] = matrix[fn] || {})[label] = r;
    }
  }
  const bad = [];
  for (const [fn, row] of Object.entries(matrix)) for (const [label, r] of Object.entries(row)) {
    const isAdmin = label.startsWith('ค)'), isUser = label.startsWith('ข)');
    if (/^คืน "/.test(r) && !/^คืน "(OK|refused-not-trigger)"$/.test(r)) bad.push(fn + '/' + label + ': ' + r);
    if (/แก้ props|เรียกเครือข่าย/.test(r) && !(isAdmin && fn.startsWith('admin'))) bad.push(fn + '/' + label + ': ' + r);
    if (!isAdmin && !isUser && (r.startsWith('คืนค่า') || r === 'หน้า Dashboard') && !['doPost', 'dailySummaryJob'].includes(fn)) bad.push(fn + '/' + label + ': ' + r);
    if (isUser && r.startsWith('คืนค่า') && !['getSources', 'getBook', 'checkSetup'].includes(fn)) bad.push(fn + '/' + label + ': ' + r);
  }
  assert.deepStrictEqual(bad, []);
  return pub.length + ' ฟังก์ชัน × ' + callers.length + ' ผู้เรียก';
});

test('A', 'doGet บนลิงก์บอต (ไม่ล็อกอิน/โดเมนเดียว) → หน้าไม่มีสิทธิ์ ไม่ใช่ Dashboard', () => {
  for (const who of ['', ADMIN2]) { const g = seeded(); g.__opts.effectiveEmail = OWNER; const h = as(g, who).doGet().getContent();
    assert.ok(!h.includes('id="view"') && h.includes('ไม่มีสิทธิ์'), who); }
});

test('A', 'ผลตรวจลิงก์ไม่มีค่าในเซลล์ (ชีตที่ไม่ตรงแม่แบบมีค่าลับ)', () => {
  const g = load({ sheets, email: OWNER, props: { CASES_SHEET_ID: null, LAB_SHEET_ID: null, ADMIN_EMAIL: OWNER },
    books: { mockWrongSheetIdForReview000001: { 'Sheet1': [['หัวลับ-H1', 'หัว2'], ['ค่าลับ-V1', 'ค่าลับ-V2']] },
      mockCasesSecretValues000000000002: { 'ข้อมูลคดี': sheets.cases['ข้อมูลคดี'].map((r, i) => i === 0 ? r : r.map(v => typeof v === 'string' ? 'ค่าลับ-' + v : v)) } } });
  for (const id of ['mockWrongSheetIdForReview000001', 'mockCasesSecretValues000000000002', IDS.cases, IDS.lab]) {
    const js = JSON.stringify(g.__call('adminInspectSource', link(id)));
    assert.ok(!js.includes('ค่าลับ') && !js.includes('หัวลับ') && !js.includes(id), id + ': ' + js.slice(0, 200));
    if (id === IDS.cases) for (const row of sheets.cases['ข้อมูลคดี'].slice(1, 50)) assert.ok(!js.includes(String(row[0])) || String(row[0]).length < 3, 'เลข บก. หลุด ' + row[0]);
  }
});

test('A', 'ผู้ใช้ทั่วไปไม่ได้ Sheet ID / ลิงก์ / อีเมลผู้เพิ่ม / รายชื่อผู้ใช้ จาก getSources และ getBook', () => {
  const g = seeded(); const s = JSON.stringify(as(g, USER).getSources()); const b = JSON.stringify(g.getBook(g.getSources().sources[0].id));
  for (const x of [IDS.cases, IDS.lab, 'docs.google.com', OWNER, ADMIN2]) { assert.ok(!s.includes(x), 'getSources มี ' + x); assert.ok(!b.includes(x), 'getBook มี ' + x); }
});

test('A', 'ผู้ดูแลยกระดับไม่ได้: ลบ/ลดเจ้าของ (ตัวพิมพ์ใหญ่/ช่องว่าง), เพิ่มเจ้าของเป็นผู้ใช้, ชีตที่ตัวเองเปิดไม่ได้', () => {
  const g = seeded(); as(g, ADMIN2);
  for (const e of [OWNER, ' OWNER@EXAMPLE.COM ']) {
    assert.throws(() => g.adminRemoveUser(e)); assert.throws(() => g.adminSetAdmin(e, false)); assert.throws(() => g.adminSaveUser({ email: e, admin: false }));
  }
  g.__opts.acl = { [IDS.cases]: [OWNER] };
  const before = JSON.stringify(g.__state.props);
  assert.throws(() => g.adminSaveSource({ link: link(IDS.cases), name: 'x' }));
  assert.strictEqual(JSON.stringify(g.__state.props), before);
});

test('A', 'ชิ้นการตั้งค่าเสียหาย / JSON ผิดรูปแต่ลายเซ็นตรง → ปฏิเสธทุกคน (fail closed) และบอตไม่อ่านชีต', () => {
  const g = seeded(); const p = g.__state.props;
  const json = '{"v":1,"people":[{"email":"' + STRANGER + '"';   // ไม่ครบ
  for (const k of Object.keys(p)) if (k.startsWith('DASH_CFG_')) delete p[k];
  p.DASH_CFG_0 = json; p.DASH_CFG_N = '1:' + g.hash_(json);
  for (const who of [OWNER, USER, STRANGER]) assert.ok(!as(g, who).doGet().getContent().includes('id="view"'), who);
  assert.throws(() => g.mainSource_());
});

// ---------------- ส่วน B: KNOWN-ISSUE (ไม่ผ่านจนกว่าจะแก้) ----------------
test('B', '[SR-1] แบ่งชิ้นการตั้งค่าไม่ผ่ากลางอีโมจิ (surrogate pair) · ถ้า Script Properties แทนครึ่งอีโมจิด้วย U+FFFD เจ้าของยังเข้าได้', () => {
  const lone = s => /[\uD800-\uDBFF]$/.test(s) || /^[\uDC00-\uDFFF]/.test(s);
  let g, p, split = -1;
  // ผู้ดูแลเลือกความยาวหมายเหตุของคนแรกให้ขอบชิ้นที่ 2,900 ตกกลางอีโมจิ (ลองไม่กี่ค่าก็เจอ)
  for (let pad = 0; pad <= 160 && split < 0; pad++) {
    g = seeded(); as(g, ADMIN2); p = g.__state.props;
    g.adminSaveUser({ email: 'pad@example.org', name: 'p'.repeat(Math.max(0, pad - 100)), note: 'x'.repeat(Math.min(pad, 100)) });
    for (let i = 0; i < 24; i++) g.adminSaveUser({ email: `emoji${i}@example.org`, name: '\u{1F600}'.repeat(30), note: '' });
    const n = +p.DASH_CFG_N.split(':')[0];
    for (let k = 0; k < n && split < 0; k++) if (lone(p['DASH_CFG_' + k])) split = k;
  }
  if (split >= 0) {
    // จำลองที่เก็บที่แปลงเป็น UTF-8 (อักขระครึ่งคู่ → U+FFFD) — ยังไม่ได้ยืนยันกับ Apps Script จริง
    for (const k of Object.keys(p)) if (/^DASH_CFG_\d+$/.test(k)) p[k] = p[k].replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');
    const ownerOk = as(g, OWNER).doGet().getContent().includes('id="view"');
    assert.fail(`ชิ้น DASH_CFG_${split} ลงท้าย/ขึ้นต้นด้วยครึ่งอีโมจิ · หลังจำลอง U+FFFD เจ้าของ${ownerOk ? 'ยังเข้าได้' : 'เข้าไม่ได้ (ทั้งระบบถูกปฏิเสธ + บอตหยุด)'}`);
  }
  return 'ไม่พบการผ่ากลางอีโมจิ';
});

test('B', '[SR-2] กู้ระบบโดยลบ DASH_CFG_* ขณะ CASES_SHEET_ID ยังอยู่ → ไม่ควรกลับไปใช้แท็บ ผู้ใช้ เดิม', () => {
  const g = load({ sheets, email: OWNER, props: { ADMIN_EMAIL: OWNER } });   // โหมดเดิม: มี CASES_SHEET_ID + แท็บ ผู้ใช้
  g.__call('getSources');                                                  // เจ้าของเปิด → ย้ายระบบ
  as(g, OWNER).adminRemoveUser(USER);                                      // ผู้ดูแลถอดสิทธิ์ staff1
  assert.ok(as(g, USER).doGet().getContent().includes('ไม่มีสิทธิ์'));
  for (const k of Object.keys(g.__state.props)) if (k.startsWith('DASH_CFG_')) delete g.__state.props[k];   // เช่น กู้จากการตั้งค่าเสียหายตาม README
  g.__state.caches.clear();
  const back = as(g, USER).doGet().getContent().includes('id="view"');
  assert.ok(!back, 'staff1 ที่ถูกถอดสิทธิ์แล้ว กลับเข้า Dashboard ได้อีก (อ่านแท็บ ผู้ใช้ เดิม)');
});

test('B', '[SR-3] checkSetup เป็นเครื่องมือผู้ดูแล ไม่ควรตอบผู้ใช้ทั่วไปผ่าน google.script.run', () => {
  const g = seeded(); let out = null;
  try { out = as(g, USER).checkSetup(); } catch (e) { return 'ปฏิเสธ'; }
  assert.fail('ผู้ใช้ทั่วไปได้: ' + out.split('\n').slice(0, 2).join(' | '));
});

const A = results.filter(r => r.part === 'A'), B = results.filter(r => r.part === 'B');
for (const r of results) console.log(`${r.pass ? 'PASS' : (r.part === 'B' ? 'KNOWN-ISSUE' : 'FAIL')}  [${r.part}] ${r.name} — ${r.actual}`);
console.log('\nตาราง ฟังก์ชัน × ผู้เรียก:');
const cols = Object.keys(Object.values(matrix)[0] || {});
console.log(['ฟังก์ชัน'].concat(cols).join(' | '));
for (const [fn, row] of Object.entries(matrix)) console.log([fn].concat(cols.map(c => row[c])).join(' | '));
console.log(`\nส่วน A: ${A.filter(r => r.pass).length}/${A.length} ผ่าน · ส่วน B (ปัญหาที่พบ): ${B.filter(r => !r.pass).length}/${B.length} ยังไม่แก้`);
process.exit(A.every(r => r.pass) ? 0 : 1);
