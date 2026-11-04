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
test('สิทธิ์', 'ติดตั้งใหม่: ยังไม่ตั้ง ADMIN_EMAIL และไม่มีการตั้งค่าใด ๆ (ไม่มี CASES_SHEET_ID เดิม)', 'ปฏิเสธทุกคน พร้อมบอกให้ตั้ง ADMIN_EMAIL', () => {
  const g = load({ sheets, email: ALLOWED, props: { CASES_SHEET_ID: null, LAB_SHEET_ID: null } }); assert.ok(g.doGet().getContent().includes('ADMIN_EMAIL'));
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
test('อ่านข้อมูล', 'getSources (โหมดเดิม ก่อนย้ายระบบ)', 'คืน 2 แหล่ง + อีเมลผู้ใช้ · ไม่ใช่ผู้ดูแล', () => {
  const g = load({ sheets, email: ALLOWED }); const r = g.__call('getSources');
  assert.deepStrictEqual(r.sources.map(s => s.id), ['cases', 'lab']); assert.strictEqual(r.email, ALLOWED); assert.strictEqual(r.isAdmin, false);
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
  const chunks = +g.__state.caches.get(ALLOWED).get('book3:cases:0:n'); return 'เปิดชีต ' + n + ' ครั้ง, แคช ' + chunks + ' ชิ้น';
});

test('อ่านข้อมูล', 'checkSetup() (เจ้าของรันใน editor)', 'บอกจำนวนแถวของทุกแท็บ + ผลตรวจชีตหลักของบอต ไม่มีค่าข้อมูลคดี · ผู้ใช้ทั่วไป/คนนอกรายชื่อรันไม่ได้ (SR-3)', () => {
  const out = load({ sheets, email: 'owner@example.com', props: { ADMIN_EMAIL: 'owner@example.com' } }).checkSetup();
  assert.ok(out.includes('ข้อมูลคดี 731 แถว') && out.includes('ข้อมูล Lot')); assert.ok(!out.includes('/2565'));
  assert.ok(out.includes('LINE bot และสรุปอัตโนมัติอ่านได้'), out);
  assert.ok(throwsMsg(() => load({ sheets, email: ALLOWED }).checkSetup()).includes('ผู้ดูแล'));
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

// ---------- 4) LINE bot (LineBot.gs + Intent.gs) — UrlFetchApp เป็น mock ไม่มีการเรียก LINE/Gemini จริง ----------
const TOKEN = 'mock-webhook-token-0123456789abcdef0123';
const GROUP = 'Cmockgroup0000000000000000000000001';
const OWNER = 'owner@example.com';
const BOTP = { LINE_CHANNEL_TOKEN: 'mock-line-channel-token', WEBHOOK_TOKEN: TOKEN, ALLOWED_GROUP_ID: GROUP,
  GEMINI_API_KEY: 'mock-gemini-key', ADMIN_EMAIL: OWNER, DASHBOARD_URL: 'https://script.google.com/macros/s/MOCK-DEPLOYMENT/exec' };
const LINE_HOST = 'https://api.line.me/', GEM_HOST = 'https://generativelanguage.googleapis.com/';
const okGem = intent => () => ({ code: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(intent) }] } }] } });
// บอตทำงานในรายการ Deploy "Execute as: Me" → effective user = เจ้าของ, active user = ว่าง (LINE ไม่มีบัญชี Google)
function bot(o = {}) {
  return load({ sheets: o.sheets || sheets, email: o.email || '', effectiveEmail: OWNER, props: Object.assign({}, BOTP, o.props || {}),
    fetch: (url, p) => {
      if (url.startsWith(LINE_HOST)) return { code: o.lineCode ? o.lineCode(url) : 200, body: {} };
      if (url.startsWith(GEM_HOST)) return o.gemini ? o.gemini(url, p) : { code: 500, body: {} };
      throw new Error('mock: ไม่อนุญาตให้เรียก ' + url);
    } });
}
let evSeq = 0;
function mkEvent(text, o = {}) {
  evSeq++;
  return Object.assign({ type: 'message', mode: 'active', timestamp: Date.now(), webhookEventId: 'mock-ev-' + evSeq,
    deliveryContext: { isRedelivery: false }, source: { type: 'group', groupId: GROUP, userId: 'Umockuser0001' },
    replyToken: 'mock-reply-token-' + evSeq,
    message: Object.assign({ type: 'text', id: String(evSeq), quoteToken: 'q', text }, o.mention ? { mention: o.mention } : {}) }, o.ev || {});
}
function post(g, events, o = {}) {
  const before = g.__state.fetches.length;
  const e = { parameter: o.token === null ? {} : { token: o.token === undefined ? TOKEN : o.token }, contentLength: 1,
    postData: { contents: JSON.stringify({ destination: 'Umockbotuserid', events: Array.isArray(events) ? events : [events] }), type: 'application/json' } };
  const out = g.doPost(e);
  const f = g.__state.fetches.slice(before);
  const replies = f.filter(x => x.url === LINE_HOST + 'v2/bot/message/reply').map(x => JSON.parse(x.params.payload));
  return { out: out.getContent(), fetches: f, replies, texts: replies.map(r => r.messages[0].text), gem: f.filter(x => x.url.startsWith(GEM_HOST)) };
}
const say = (g, text, o) => post(g, mkEvent(text, o), o);
const th = s => s.replace(/\d/g, d => String.fromCharCode(0x0E50 + +d));
const LK = EXP.lookup;
const thaiD = ymd => { const M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']; const p = ymd.split('-'); return `${+p[2]} ${M[+p[1] - 1]} ${+p[0] + 543}`; };
const OFFICER_NAMES = ['เจ้าหน้าที่ ก', 'เจ้าหน้าที่ ข', 'เจ้าหน้าที่ ค', 'เจ้าหน้าที่ ง', 'เจ้าหน้าที่ จ'];
const caseRow = sheets.cases['ข้อมูลคดี'].find(r => r[0] === LK.bk);
const caseHead = sheets.cases['ข้อมูลคดี'][0];

test('LINE bot', `เลข บก. ${LK.bk} จากกลุ่มที่อนุญาต`, 'ตอบ 1 ครั้ง: สถานะ ประเภท ของกลาง วันที่รับ/เสร็จ/มารับผล · ไม่มีชื่อผู้ตรวจ สภ. เลขรายงาน · ไม่เรียก Gemini', () => {
  const g = bot(); const r = say(g, LK.bk);
  assert.strictEqual(r.out, 'OK'); assert.strictEqual(r.replies.length, 1); assert.strictEqual(r.gem.length, 0);
  const t = r.texts[0];
  assert.ok(t.includes('คดี ' + LK.bk) && t.includes('สถานะ: ' + LK.status) && t.includes('วันที่รับ: ' + thaiD(LK.recvYmd)), t);
  assert.ok(t.includes('ประเภทคดี:') && t.includes('ของกลาง:') && t.includes('ตรวจเสร็จ:') && t.includes('มารับผล:'));
  for (const bad of [...OFFICER_NAMES, 'สภ.', caseRow[caseHead.indexOf('เลขรายงาน')], caseRow[caseHead.indexOf('จังหวัด')]]) assert.ok(!t.includes(bad), 'มี ' + bad);
  assert.strictEqual(r.replies[0].replyToken.startsWith('mock-reply-token-'), true);
  assert.strictEqual(r.fetches[0].params.headers.Authorization, 'Bearer mock-line-channel-token');
  return t.replace(/\n/g, ' / ');
});
test('LINE bot', 'เลข บก. แบบเลขไทย "คดี ' + th(LK.bk) + ' ถึงไหนแล้ว"', 'ตอบเหมือนเลขอารบิก', () => {
  const a = say(bot(), LK.bk).texts[0], b = say(bot(), 'คดี ' + th(LK.bk) + ' ถึงไหนแล้ว').texts[0];
  assert.strictEqual(b, a);
});
test('LINE bot', 'เลข บก. ที่ไม่มีในข้อมูล (9999/2569)', 'ตอบ "ไม่พบคดี 9999/2569"', () => {
  const r = say(bot(), '9999/2569'); assert.strictEqual(r.replies.length, 1); assert.ok(r.texts[0].startsWith('ไม่พบคดี 9999/2569')); assert.strictEqual(r.gem.length, 0);
  return r.texts[0].replace(/\n/g, ' / ');
});
test('LINE bot', 'หลายเลขในข้อความเดียว "บอต 1/2565, 2/2565"', 'ตอบทั้ง 2 คดีในข้อความเดียว', () => {
  const t = say(bot(), 'บอต 1/2565, 2/2565').texts[0]; assert.ok(t.includes('คดี 1/2565') && t.includes('คดี 2/2565'));
});
let pendingSample = '';
test('LINE bot', 'คำสั่ง "คดีค้าง"', `แยก กำลังดำเนินการ ${EXP.pending.byStatus['กำลังดำเนินการ']} / เสร็จแล้ว รอรับผล ${EXP.pending.byStatus['เสร็จแล้ว รอรับผล']} + 3 คดีค้างนานสุดต่อกลุ่ม (Python)`, () => {
  const g = bot(); const r = say(g, 'คดีค้าง'); assert.strictEqual(r.replies.length, 1); assert.strictEqual(r.gem.length, 0);
  const t = r.texts[0]; pendingSample = t;
  const off = g.Stats.ymdToDays(g.Stats.todayYmd(new Date())) - g.Stats.ymdToDays(EXP.pending.today);   // วันนี้จริง vs วันอ้างอิงของ Python
  assert.ok(t.includes('คดีค้าง (ยังไม่รับผล) ' + EXP.pending.total + ' คดี'));
  assert.ok(t.includes('1) กำลังดำเนินการ: ' + EXP.pending.byStatus['กำลังดำเนินการ'] + ' คดี'));
  assert.ok(t.includes('2) เสร็จแล้ว รอรับผล: ' + EXP.pending.byStatus['เสร็จแล้ว รอรับผล'] + ' คดี'));
  const fmt = arr => arr.map(([bk, d]) => `${bk} (${(d + off).toLocaleString('en-US')} วัน)`).join(', ');
  assert.ok(t.includes(fmt(EXP.pending.top3Progress)), 'top3 กำลังดำเนินการ'); assert.ok(t.includes(fmt(EXP.pending.top3Waiting)), 'top3 รอรับผล');
  for (const n of OFFICER_NAMES) assert.ok(!t.includes(n));
  return t.length + ' ตัวอักษร ตรงกับ Python ทุกค่า';
});
test('LINE bot', 'คำสั่งคดีค้างแบบอื่น ("มีคดีค้างกี่คดี", "บอต งานที่ยังไม่รับผล", "/ค้าง")', 'ตอบสรุปคดีค้าง ไม่เรียก Gemini', () => {
  for (const q of ['มีคดีค้างกี่คดี', 'บอต งานที่ยังไม่รับผล', '/ค้าง', 'สรุปคดีค้าง?']) { const r = say(bot(), q); assert.ok(r.texts[0] && r.texts[0].startsWith('คดีค้าง'), q); assert.strictEqual(r.gem.length, 0, q); }
});
test('LINE bot', 'mention บอต (@DNA Bot คดีค้าง)', 'ถือว่าเรียกบอต ตอบสรุปคดีค้าง', () => {
  const r = say(bot(), '@DNA Bot ขอดูคดีค้าง', { mention: { mentionees: [{ index: 0, length: 8, type: 'user', userId: 'Umockbotuserid', isSelf: true }] } });
  assert.ok(r.texts[0].startsWith('คดีค้าง'));
});
const CHAT = ['สวัสดีครับ', 'บอทนี่ใช้ดีนะ', 'ส่งของกลางคดี 123/2568 ไปแล้วนะ', 'พรุ่งนี้ประชุม 9 โมง', 'งานค้างเยอะจัง', 'ใครเห็นคดี 45/2569 บ้าง', 'โอเค', 'บอตตอง', '5555'];
test('LINE bot', 'แชตปกติที่ไม่ได้เรียกบอต (' + CHAT.length + ' ข้อความ รวมที่มีเลขคดีปนในประโยค)', 'เงียบ: ไม่ reply ไม่เรียก Gemini ไม่มีคำขอออกไปเลย', () => {
  const g = bot();
  for (const q of CHAT) { const r = say(g, q); assert.strictEqual(r.fetches.length, 0, q); assert.strictEqual(r.out, 'OK'); }
  const r = say(g, '@สมชาย ช่วยดู 12/2568 หน่อย', { mention: { mentionees: [{ index: 0, length: 6, type: 'user', userId: 'Uother', isSelf: false }] } });
  assert.strictEqual(r.fetches.length, 0, 'mention คนอื่น');
  const s = say(g, 'ส่งรูปมา', { ev: { message: { type: 'image', id: 'x' } } }); assert.strictEqual(s.fetches.length, 0, 'รูปภาพ');
  return CHAT.join(' | ') + ' | mention คนอื่น | รูปภาพ → ไม่มีคำขอ';
});
test('LINE bot', 'กลุ่มอื่น / แชตส่วนตัว / ห้องแชต', 'เงียบ ไม่ตอบ', () => {
  const g = bot();
  for (const source of [{ type: 'group', groupId: 'Cothergroup', userId: 'U1' }, { type: 'user', userId: 'U1' }, { type: 'room', roomId: 'R1', userId: 'U1' }]) {
    const r = say(g, LK.bk, { ev: { source } }); assert.strictEqual(r.fetches.length, 0, source.type);
  }
});
test('LINE bot', 'ยังไม่ตั้ง ALLOWED_GROUP_ID', 'เงียบทุกกลุ่ม (fail closed)', () => {
  const r = say(bot({ props: { ALLOWED_GROUP_ID: null } }), LK.bk); assert.strictEqual(r.fetches.length, 0);
});
test('LINE bot', 'token ใน URL ผิด / ไม่มี / ยังไม่ตั้ง WEBHOOK_TOKEN / token สั้นเกิน', 'ทิ้งคำขอ ไม่ตอบ ไม่อ่านชีต คำตอบ HTTP "OK" เหมือนกรณีปกติ', () => {
  const cases = [[{ token: 'wrong' }, {}], [{ token: TOKEN.slice(0, -1) }, {}], [{ token: null }, {}], [{}, { WEBHOOK_TOKEN: null }], [{ token: 'short' }, { WEBHOOK_TOKEN: 'short' }]];
  for (const [o, props] of cases) {
    const g = bot({ props }); const opens = g.__state.opens; const r = say(g, LK.bk, o);
    assert.strictEqual(r.fetches.length, 0); assert.strictEqual(r.out, 'OK'); assert.strictEqual(g.__state.opens, opens);
  }
});
test('LINE bot', 'ปุ่ม Verify ของ LINE (events ว่าง) / body ไม่ใช่ JSON', 'ตอบ "OK" ไม่มีคำขอออก', () => {
  const g = bot(); assert.strictEqual(post(g, []).fetches.length, 0);
  const out = g.doPost({ parameter: { token: TOKEN }, postData: { contents: 'not json' } }); assert.strictEqual(out.getContent(), 'OK');
  assert.strictEqual(g.__state.fetches.length, 0);
});
test('LINE bot', 'event ซ้ำ (webhookEventId เดิม) / redelivery / event เก่า 10 นาที', 'ตอบครั้งเดียว · ไม่ตอบ redelivery และ event เก่า', () => {
  const g = bot(); const ev = mkEvent(LK.bk);
  assert.strictEqual(post(g, ev).replies.length, 1); assert.strictEqual(post(g, ev).replies.length, 0);
  assert.strictEqual(say(g, LK.bk, { ev: { deliveryContext: { isRedelivery: true } } }).replies.length, 0);
  assert.strictEqual(say(g, LK.bk, { ev: { timestamp: Date.now() - 600000 } }).replies.length, 0);
});
test('LINE bot', '"บอต" เฉย ๆ / "บอต วิธีใช้"', 'ตอบวิธีใช้ ไม่เรียก Gemini', () => {
  for (const q of ['บอต', 'บอต วิธีใช้', 'bot help']) { const r = say(bot(), q); assert.ok(r.texts[0].startsWith('วิธีใช้บอต'), q); assert.strictEqual(r.gem.length, 0); }
});
const AIQ = 'บอต ช่วยดูหน่อยว่าตอนนี้มีอะไรติดอยู่บ้าง นายสมชาย ใจดี โทร 081-234-5678 อีเมล somchai@example.org เลขรายงาน 03-68-00012 สภ.ตัวอย่าง3 เรื่องเลข 12/68 https://example.org/x';
let aiPayload = '';
test('LINE bot', 'เรียกบอตแต่กฎไม่เข้าใจ → Gemini (mock)', 'ส่งเฉพาะข้อความที่ตัดตัวเลข/ชื่อ/อีเมล/URL/สภ. แล้ว ไม่มีข้อมูลจาก Sheet · ได้ intent แล้วตอบด้วยโค้ด', () => {
  const g = bot({ gemini: okGem({ intent: 'pending_summary', caseNo: '999/2568' }) }); const r = say(g, AIQ);
  assert.strictEqual(r.gem.length, 1); const req = r.gem[0];
  assert.ok(req.url.endsWith('/models/gemini-3.5-flash-lite:generateContent')); assert.strictEqual(req.params.headers['x-goog-api-key'], 'mock-gemini-key');
  assert.ok(!req.url.includes('mock-gemini-key'));
  const body = req.params.payload, sent = JSON.parse(body).contents[0].parts[0].text; aiPayload = sent;
  const sys = JSON.parse(body).systemInstruction.parts[0].text;
  assert.ok(!/[0-9๐-๙]/.test(sent) && !/[0-9๐-๙]/.test(sys), 'มีตัวเลขในข้อความ');
  for (const bad of ['สมชาย', 'ใจดี', 'somchai', '@', 'example.org', 'สภ.', 'ตัวอย่าง3', GROUP, 'Umockuser0001', 'mock-reply', 'https']) assert.ok(!body.includes(bad), 'มี ' + bad);
  const sheetVals = new Set(); for (const row of sheets.cases['ข้อมูลคดี'].slice(1)) for (const v of row) if (typeof v === 'string' && v.length >= 3) sheetVals.add(v);
  for (const v of sheetVals) assert.ok(!body.includes(v), 'มีค่าจาก Sheet: ' + v);
  assert.ok(r.texts[0].startsWith('คดีค้าง')); assert.ok(!r.texts[0].includes('999/2568'), 'ใช้ caseNo จาก Gemini');
  return 'ข้อความที่ส่ง: "' + sent + '"';
});
test('LINE bot', 'Gemini ตอบ case_status พร้อม caseNo ' + LK.bk, 'ไม่ใช้เลขจาก Gemini → ขอให้พิมพ์เลข บก. (ไม่ค้นชีต)', () => {
  const g = bot({ gemini: okGem({ intent: 'case_status', caseNo: LK.bk }) }); const opens = g.__state.opens;
  const r = say(g, 'บอต อยากรู้ว่าเรื่องของฉันถึงไหน'); assert.ok(r.texts[0].startsWith('พิมพ์เลข บก.')); assert.strictEqual(g.__state.opens, opens);
});
test('LINE bot', 'Gemini ล่ม: HTTP 429 / 500 / timeout (exception) / JSON เสีย / intent แปลก', 'ตอบวิธีใช้สั้น ๆ ทุกกรณี', () => {
  const fails = [() => ({ code: 429, body: { error: { status: 'RESOURCE_EXHAUSTED' } } }), () => ({ code: 500, body: {} }), () => new Error('Timeout: request timed out'),
    () => ({ code: 200, body: { candidates: [{ content: { parts: [{ text: '{oops' }] } }] } }), okGem({ intent: 'delete_everything' })];
  for (const f of fails) { const r = say(bot({ gemini: f }), 'บอต ขอข้อมูลหน่อย'); assert.strictEqual(r.gem.length, 1); assert.ok(r.texts[0].startsWith('วิธีใช้บอต'), r.texts[0]); }
});
test('LINE bot', 'ไม่มี GEMINI_API_KEY / เกินโควตาที่ตั้ง (GEMINI_MAX_PER_HOUR=1) / GEMINI_MODEL แปลก', 'ไม่เรียก Gemini ตอบวิธีใช้', () => {
  assert.strictEqual(say(bot({ props: { GEMINI_API_KEY: null } }), 'บอต ขอข้อมูลหน่อย').gem.length, 0);
  const g = bot({ props: { GEMINI_MAX_PER_HOUR: '1' }, gemini: okGem({ intent: 'help' }) });
  assert.strictEqual(say(g, 'บอต ขอข้อมูลหน่อย').gem.length, 1); const r2 = say(g, 'บอต ขอข้อมูลอีกที'); assert.strictEqual(r2.gem.length, 0); assert.ok(r2.texts[0].startsWith('วิธีใช้'));
  assert.strictEqual(say(bot({ props: { GEMINI_MODEL: '../../evil?x=' }, gemini: okGem({ intent: 'help' }) }), 'บอต ขอข้อมูลหน่อย').gem.length, 0);
});
test('LINE bot', 'โหมดตั้งค่า: เชิญบอตเข้ากลุ่มใหม่', 'บันทึก groupId ใน Script Properties ไม่ตอบในแชต · allowSeenGroup ตั้ง ALLOWED_GROUP_ID แล้วปิดโหมด', () => {
  const g = bot({ email: OWNER, props: { ALLOWED_GROUP_ID: null } });
  g.startSetupMode();
  const r = post(g, { type: 'join', timestamp: Date.now(), webhookEventId: 'j1', source: { type: 'group', groupId: 'Cnewgroup123' }, replyToken: 'rt' });
  assert.strictEqual(r.fetches.length, 0);
  assert.strictEqual(say(g, 'ทดสอบ', { ev: { source: { type: 'group', groupId: 'Cnewgroup123', userId: 'U1' } } }).fetches.length, 0);
  assert.ok(g.showSetupGroups().includes('Cnewgroup123'));
  g.allowSeenGroup(); assert.strictEqual(g.__state.props.ALLOWED_GROUP_ID, 'Cnewgroup123'); assert.ok(!('SETUP_UNTIL' in g.__state.props));
  assert.strictEqual(say(g, LK.bk, { ev: { source: { type: 'group', groupId: 'Cnewgroup123', userId: 'U1' } } }).replies.length, 1);
});
test('LINE bot', 'โหมดตั้งค่าหมดเวลา / ไม่ได้เปิด', 'ไม่บันทึก groupId', () => {
  const g = bot({ email: OWNER, props: { ALLOWED_GROUP_ID: null, SETUP_UNTIL: String(Date.now() - 1000) } });
  post(g, { type: 'join', timestamp: Date.now(), webhookEventId: 'j2', source: { type: 'group', groupId: 'Cx' } });
  assert.ok(!('SETUP_SEEN_GROUPS' in g.__state.props));
});
test('LINE bot', 'ฟังก์ชันผู้ดูแลเรียกโดยผู้ใช้ Dashboard ที่ไม่ใช่ ADMIN_EMAIL', 'โยน Error ทุกฟังก์ชัน', () => {
  const g = load({ sheets, email: ALLOWED, props: BOTP, fetch: () => { throw new Error('no'); } });
  for (const f of ['startSetupMode', 'showSetupGroups', 'allowSeenGroup', 'makeWebhookToken', 'installTriggers', 'removeTriggers', 'previewSummary', 'previewYearSummary'])
    assert.ok(throwsMsg(() => g[f]()).includes('ADMIN_EMAIL'), f);
  const g2 = load({ sheets, email: OWNER, props: Object.assign({}, BOTP, { ADMIN_EMAIL: null }) }); assert.ok(throwsMsg(() => g2.installTriggers()).includes('ADMIN_EMAIL'));
});
test('LINE bot', 'makeWebhookToken', 'สร้าง token สุ่ม 64 ตัว ไม่พิมพ์ค่าใน log · รันซ้ำไม่เปลี่ยน', () => {
  const g = load({ sheets, email: OWNER, props: Object.assign({}, BOTP, { WEBHOOK_TOKEN: null }) });
  assert.strictEqual(g.makeWebhookToken(), 'created'); const t = g.__state.props.WEBHOOK_TOKEN; assert.strictEqual(t.length, 64);
  assert.ok(!g.__state.logs.join('\n').includes(t)); assert.strictEqual(g.makeWebhookToken(), 'exists'); assert.strictEqual(g.__state.props.WEBHOOK_TOKEN, t);
});

// ---------- 5) รายการ Deploy ของบอต (Execute as Me) ต้องไม่รั่วข้อมูล Dashboard ----------
test('Deploy บอต', 'เปิดลิงก์บอตแบบไม่ล็อกอิน (Execute as Me, active user ว่าง)', 'doGet = หน้าไม่มีสิทธิ์ · getBook/getSources/checkSetup โยน Error', () => {
  const g = load({ sheets, email: '', effectiveEmail: OWNER }); assert.ok(g.doGet().getContent().includes('ไม่มีสิทธิ์เข้าถึง'));
  for (const f of [() => g.getBook('cases'), () => g.getBook('lab'), () => g.getSources(), () => g.checkSetup()]) assert.ok(throwsMsg(f).includes('ไม่มีสิทธิ์'));
});
test('Deploy บอต', 'ผู้ใช้ในรายชื่อ ผู้ใช้ เปิดลิงก์บอต (Workspace โดเมนเดียวกัน: Google ส่งอีเมลมา แต่สคริปต์ทำงานในนามเจ้าของ)', 'ปฏิเสธ (effective ≠ active) ไม่อ่านชีตข้อมูล', () => {
  const g = load({ sheets, email: ALLOWED, effectiveEmail: OWNER }); const h = g.doGet().getContent();
  assert.ok(h.includes('ไม่ใช่ลิงก์ Dashboard')); assert.ok(throwsMsg(() => g.getBook('cases')).includes('ไม่มีสิทธิ์')); assert.strictEqual(g.__state.opens, 0);
});
test('Deploy บอต', 'doPost ตอบเฉพาะ "OK" ไม่มีข้อมูลคดีในคำตอบ HTTP', 'เนื้อหาคำตอบ = "OK" ทุกกรณี', () => {
  const g = bot(); for (const q of [LK.bk, 'คดีค้าง', 'สวัสดี']) assert.strictEqual(say(g, q).out, 'OK');
});
test('อ่านข้อมูล', 'ชีตจริงที่ยังไม่ลบคอลัมน์ User ID (LINE)', 'getBook และคำตอบบอตไม่มีคอลัมน์/ค่านี้ (ระบบไม่พึ่งคอลัมน์นี้)', () => {
  const s2 = JSON.parse(JSON.stringify(sheets)); const t = s2.cases['ข้อมูลคดี'];
  t.forEach((r, i) => r.splice(5, 0, i === 0 ? 'User ID (LINE)' : 'U-mock-' + String(i % 25).padStart(3, '0')));
  const b = load({ sheets: s2, email: ALLOWED }).__call('getBook', 'cases'); const js = JSON.stringify(b);
  assert.ok(!js.includes('User ID') && !js.includes('U-mock-'));
  const r = say(bot({ sheets: s2 }), LK.bk); assert.ok(!r.texts[0].includes('U-mock-'));
  assert.ok(!sheets.cases['ข้อมูลคดี'][0].includes('User ID (LINE)'), 'ข้อมูลจำลองต้องไม่มีคอลัมน์นี้แล้ว');
});

// ---------- 6) สถานะว่าง: นับเหมือน Dashboard ----------
test('Stats', 'แถวที่ช่องสถานะว่าง / สะกดอื่น', 'นับเป็น "กำลังดำเนินการ" เหมือน Dashboard (statusOf) และบอกจำนวนสถานะว่าง', () => {
  const recs = plain(records); recs[0].status = ''; recs[1].status = 'รอรับผล'; recs[2].status = 'ส่งต่อ';
  const base = S.pendingByStatus(records, {}), p = S.pendingByStatus(recs, {});
  const g0s = [records[0], records[1], records[2]].map(c => S.statusGroup(c.status));
  const dp = g0s.filter(x => x === 'กำลังดำเนินการ').length, dw = g0s.filter(x => x === 'เสร็จแล้ว รอรับผล').length;
  assert.strictEqual(p.inProgress.count, base.inProgress.count - dp + 2); assert.strictEqual(p.waiting.count, base.waiting.count - dw + 1);
  assert.strictEqual(p.inProgress.blankStatus, 1);
  assert.deepStrictEqual(['รับผลไปแล้ว', 'เสร็จแล้ว รอรับผล', 'เสร็จแล้ว  รอรับผล ', '', 'กำลังดำเนินการ', 'อื่น ๆ'].map(S.statusGroup),
    ['รับผลไปแล้ว', 'เสร็จแล้ว รอรับผล', 'เสร็จแล้ว รอรับผล', 'กำลังดำเนินการ', 'กำลังดำเนินการ', 'กำลังดำเนินการ']);
});

// ---------- 7) สรุปอัตโนมัติ (Summary.gs) ----------
/** แปลงข้อความสรุปกลับเป็นตัวเลข เพื่อเทียบกับ Python */
function parseSummary(t) {
  const L = t.split('\n'); const num = s => +s.replace(/,/g, '');
  const out = { cases: num((t.match(/คดีทั้งหมด ([\d,]+) คดี/) || [])[1] || '0'), evidence: num((t.match(/ของกลางรวม ([\d,]+) ชิ้น/) || [])[1] || '0'), byType: {}, byOfficer: {} };
  let sec = '';
  for (const l of L) {
    if (l === 'แยกตามประเภทคดี') { sec = 't'; continue; } if (l.startsWith('แยกตามผู้ตรวจ')) { sec = 'o'; continue; } if (!l.startsWith('- ')) { if (!l) sec = sec && ''; continue; }
    if (sec === 't') { const m = l.match(/^- (.+) ([\d,]+)$/); out.byType[m[1]] = num(m[2]); }
    if (sec === 'o') { const m = l.match(/^- (.+?) ([\d,]+): (.+)$/); const name = m[1] === 'ไม่ระบุผู้ตรวจ' ? 'ไม่ระบุ' : m[1];
      out.byOfficer[name] = { cases: num(m[2]), types: Object.fromEntries(m[3].split(', ').map(x => { const k = x.match(/^(.+) (\d+)$/); return [k[1], +k[2]]; })) }; }
  }
  return out;
}
const sumBot = (o = {}) => bot(Object.assign({ email: OWNER }, o));
const SUMMARY_SAMPLES = {};
for (const [k, label, call] of [['2026-10', 'เดือน ต.ค. 2569', g => g.previewSummary(2569, 10)], ['2025', 'ปี 2568', g => g.previewYearSummary(2568)]]) {
  test('สรุปอัตโนมัติ', 'ข้อความสรุป ' + label + ' (previewSummary/previewYearSummary)', `ตัวเลขทุกค่าตรงกับ Python และ Stats.summarize ที่หน้า Dashboard ใช้ · ไม่ส่งจริง`, () => {
    const g = sumBot(); const t = call(g); SUMMARY_SAMPLES[k] = t;
    assert.strictEqual(g.__state.fetches.length, 0, 'preview ต้องไม่ส่ง');
    const p = parseSummary(t), e = EXP.ranges[k];
    assert.deepStrictEqual({ cases: p.cases, evidence: p.evidence, byType: p.byType, byOfficer: p.byOfficer }, { cases: e.cases, evidence: e.evidence, byType: e.byType, byOfficer: e.byOfficer });
    assert.strictEqual(p.cases, statsOf[k].cases); assert.strictEqual(p.evidence, statsOf[k].evidence);
    assert.ok(t.includes(BOTP.DASHBOARD_URL)); assert.ok(!/\d+\/25\d\d/.test(t), 'มีเลขคดี'); assert.ok(!t.includes('สภ.'));
    return `คดี ${p.cases}, ของกลาง ${p.evidence}, ${Object.keys(p.byType).length} ประเภท, ${Object.keys(p.byOfficer).length} ผู้ตรวจ · ${t.length} ตัวอักษร`;
  });
}
test('สรุปอัตโนมัติ', 'installTriggers() รัน 3 ครั้ง', 'มี trigger รายวัน 1 ตัว (08:00 Asia/Bangkok) ไม่สร้างซ้ำ', () => {
  const g = sumBot(); g.installTriggers(); g.installTriggers(); g.installTriggers();
  assert.strictEqual(g.__state.triggers.length, 1); const s = g.__state.triggers[0].spec;
  assert.deepStrictEqual([s.fn, s.everyDays, s.atHour, s.tz], ['dailySummaryJob', 1, 8, 'Asia/Bangkok']);
  g.removeTriggers(); assert.strictEqual(g.__state.triggers.length, 0);
});
function trigBot(o = {}) { const g = sumBot(Object.assign({ props: { PUSH_ENABLED: 'yes' } }, o)); g.installTriggers(); g.__ev = { triggerUid: g.__state.triggers[0].getUniqueId() }; return g; }
const pushesOf = (g, from = 0) => g.__state.fetches.slice(from).filter(x => x.url === LINE_HOST + 'v2/bot/message/push');
test('สรุปอัตโนมัติ', 'เรียก dailySummaryJob โดยไม่ผ่าน trigger (เช่นผู้ใช้ Dashboard เรียกผ่าน google.script.run)', 'ปฏิเสธ ไม่ส่ง', () => {
  const g = trigBot(); assert.strictEqual(g.dailySummaryJob(undefined, bkk('2026-11-01T08:10:00')), 'refused-not-trigger');
  assert.strictEqual(g.dailySummaryJob({ triggerUid: 'fake' }, bkk('2026-11-01T08:10:00')), 'refused-not-trigger'); assert.strictEqual(pushesOf(g).length, 0);
});
test('สรุปอัตโนมัติ', '1 พ.ย. 2569 08:10 (เวลาไทย)', 'push 1 ครั้ง 1 ข้อความ = สรุป ต.ค. 2569 ไปยัง ALLOWED_GROUP_ID พร้อม X-Line-Retry-Key', () => {
  const g = trigBot(); const r = g.dailySummaryJob(g.__ev, bkk('2026-11-01T08:10:00')); const p = pushesOf(g);
  assert.strictEqual(r, 'sent:2026-10'); assert.strictEqual(p.length, 1); const body = JSON.parse(p[0].params.payload);
  assert.strictEqual(body.to, GROUP); assert.strictEqual(body.messages.length, 1); assert.strictEqual(body.messages[0].text, SUMMARY_SAMPLES['2026-10']);
  assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/.test(p[0].params.headers['X-Line-Retry-Key']));
  assert.strictEqual(g.__state.props.SUMMARY_SENT_MONTH, '2026-10'); return r;
});
test('สรุปอัตโนมัติ', 'กันส่งซ้ำ: trigger ทำงานซ้ำวันเดียวกัน / วันที่ 2–3 / วันที่ 15', 'ไม่ส่งซ้ำ (nothing-due)', () => {
  const g = trigBot(); g.dailySummaryJob(g.__ev, bkk('2026-11-01T08:10:00'));
  for (const t of ['2026-11-01T08:40:00', '2026-11-02T08:10:00', '2026-11-03T08:10:00', '2026-11-15T08:10:00']) assert.strictEqual(g.dailySummaryJob(g.__ev, bkk(t)), 'nothing-due', t);
  assert.strictEqual(pushesOf(g).length, 1);
});
test('สรุปอัตโนมัติ', 'ยังไม่ตั้ง PUSH_ENABLED=yes (ก่อนเจ้าของอนุมัติ)', 'ไม่ส่ง แค่ log ตัวอย่าง และไม่บันทึกว่าส่งแล้ว', () => {
  const g = trigBot({ props: {} }); const r = g.dailySummaryJob(g.__ev, bkk('2026-11-01T08:10:00'));
  assert.strictEqual(r, 'preview-only:2026-10'); assert.strictEqual(g.__state.fetches.length, 0); assert.ok(!('SUMMARY_SENT_MONTH' in g.__state.props));
});
let janSample = null;
test('สรุปอัตโนมัติ', '1 ม.ค. 2569 (2026-01-01) 08:10', 'push คำขอเดียว 2 ข้อความ: สรุป ธ.ค. 2568 + สรุปปี 2568 (ตรงกับ Python) · โควตานับ 1 รอบ', () => {
  const g = trigBot(); const r = g.dailySummaryJob(g.__ev, bkk('2026-01-01T08:10:00')); const p = pushesOf(g);
  assert.strictEqual(r, 'sent:2025-12+2025'); assert.strictEqual(p.length, 1); const m = JSON.parse(p[0].params.payload).messages;
  assert.strictEqual(m.length, 2); assert.ok(m[0].text.startsWith('สรุปคดีส่งตรวจ DNA เดือน ธ.ค. 2568')); assert.ok(m[1].text.startsWith('สรุปคดีส่งตรวจ DNA ปี 2568'));
  assert.strictEqual(m[1].text, SUMMARY_SAMPLES['2025']);
  const y = parseSummary(m[1].text); assert.strictEqual(y.cases, EXP.ranges['2025'].cases); assert.strictEqual(y.evidence, EXP.ranges['2025'].evidence);
  assert.strictEqual(g.__state.props.SUMMARY_SENT_MONTH, '2025-12'); assert.strictEqual(g.__state.props.SUMMARY_SENT_YEAR, '2025');
  assert.strictEqual(g.dailySummaryJob(g.__ev, bkk('2026-01-01T09:00:00')), 'nothing-due'); janSample = m; return r;
});
test('สรุปอัตโนมัติ', 'LINE ล่ม (HTTP 500) วันที่ 1 → วันที่ 2 ส่งได้ / LINE ตอบ 409 (เคยรับ retry key นี้แล้ว)', 'วันที่ 1 ไม่บันทึก · วันที่ 2 ส่งงวดเดิม (retry key เดิม) · 409 ถือว่าส่งแล้ว ไม่ส่งซ้ำ', () => {
  let code = 500; const g = trigBot({ lineCode: () => code });
  assert.strictEqual(g.dailySummaryJob(g.__ev, bkk('2026-11-01T08:10:00')), 'push-failed:500'); assert.ok(!('SUMMARY_SENT_MONTH' in g.__state.props));
  code = 200; assert.strictEqual(g.dailySummaryJob(g.__ev, bkk('2026-11-02T08:10:00')), 'sent:2026-10');
  const k = pushesOf(g).map(x => x.params.headers['X-Line-Retry-Key']); assert.strictEqual(k[0], k[1]);
  code = 409; const g2 = trigBot({ lineCode: () => code }); assert.ok(g2.dailySummaryJob(g2.__ev, bkk('2026-11-01T08:10:00')).startsWith('sent:2026-10'));
  assert.strictEqual(g2.__state.props.SUMMARY_SENT_MONTH, '2026-10');
  const g3 = trigBot({ lineCode: () => 500 }); for (const d of ['01', '02', '03']) g3.dailySummaryJob(g3.__ev, bkk('2026-11-' + d + 'T08:10:00'));
  assert.strictEqual(g3.dailySummaryJob(g3.__ev, bkk('2026-11-04T08:10:00')), 'nothing-due', 'เลยวันที่ 3 ไม่ส่งย้อนหลัง');
});
test('สรุปอัตโนมัติ', 'ขนาดข้อความ (เพดาน LINE: text ≤ 5,000 ตัวอักษร, ≤ 5 ข้อความต่อคำขอ)', 'ทุกข้อความ < 2,000 ตัวอักษร รวมกรณีจำลองผู้ตรวจ 5 คน × 6 ประเภท ทุกคู่', () => {
  const g = sumBot(); const lens = [];
  for (const t of [SUMMARY_SAMPLES['2026-10'], SUMMARY_SAMPLES['2025'], ...janSample.map(x => x.text), pendingSample]) { assert.ok(t.length < 2000); lens.push(t.length); }
  // กรณีหนักสุดที่คาด: ผู้ตรวจ 5 คน + ไม่ระบุ × 6 ประเภท + ไม่ระบุ ครบทุกคู่ (ชื่อยาวสมมติ)
  const types = ['ทรัพย์', 'เพศ', 'ชีวิตและร่างกาย', 'พรบ.อาวุธปืน', 'ยาเสพติด', 'อื่น ๆ', 'ไม่ระบุ'];
  const offs = ['นางสาวตัวอย่าง นามสกุลยาวมากสำหรับทดสอบ 1', 'นางสาวตัวอย่าง นามสกุลยาวมากสำหรับทดสอบ 2', 'นางสาวตัวอย่าง นามสกุลยาวมากสำหรับทดสอบ 3', 'นางสาวตัวอย่าง นามสกุลยาวมากสำหรับทดสอบ 4', 'นางสาวตัวอย่าง นามสกุลยาวมากสำหรับทดสอบ 5', 'ไม่ระบุ'];
  const recs = []; let i = 0;
  for (const o of offs) for (const t of types) for (let k = 0; k < 120; k++) recs.push({ bk: 'x', recvYmd: '2025-0' + (1 + (i++ % 9)) + '-15', status: 'รับผลไปแล้ว', type: t === 'ไม่ระบุ' ? '' : t, officer: o === 'ไม่ระบุ' ? '' : o, items: 9999, counted: true });
  const big = g.formatSummary_(g.Stats.summarize(recs, g.Stats.yearRange(2025)), BOTP.DASHBOARD_URL); assert.ok(big.length < 2000, big.length);
  return 'จริง: ' + lens.join(', ') + ' ตัวอักษร · กรณีหนักสุด (6×7 คู่, ตัวเลข 5 หลัก) ' + big.length + ' ตัวอักษร';
});
test('สรุปอัตโนมัติ', 'ข้อความยาวเกิน 5,000 (ป้องกันไว้)', 'ถูกตัดให้ ≤ 5,000 พร้อมหมายเหตุ', () => {
  const g = sumBot(); const t = g.clip_('ก'.repeat(6000)); assert.ok(t.length <= 5000 && t.endsWith('ดูต่อใน Dashboard)'));
});

// ---------- 8) แหล่งข้อมูล / ผู้ใช้ / ผู้ดูแล ที่จัดการในหน้าเว็บ (Admin.gs) ----------
const TPLS = JSON.parse(fs.readFileSync(path.join(OUT, 'templates.json'), 'utf8'));
const ADMIN2 = 'admin2@example.org', ADMIN3 = 'admin3@example.org', USER2 = 'staff.new@example.org', STRANGER = 'stranger@example.org';
const XID = {   // Sheet ID จำลองเพิ่มเติม (ยาวแบบของจริง)
  cases2: 'mockCases2SheetId0000000000000003', lot: 'mockLotOnlySheetId000000000000004', wrong: 'mockWrongTypeSheetId00000000005',
  broken: 'mockCasesMissingHeaders00000006', labBad: 'mockLabBudgetBadHeads00000000007', secret: 'mockOwnerOnlySheet0000000000008',
  tCasesE: 'tplCasesEmpty0000000000000000009', tCasesF: 'tplCasesFilled000000000000000010', tLabE: 'tplLabEmpty00000000000000000011',
  tLabF: 'tplLabFilled0000000000000000012', tLotE: 'tplLotEmpty00000000000000000013', tLotF: 'tplLotFilled0000000000000000014' };
const casesGrid = sheets.cases['ข้อมูลคดี'];
const CASES2_ROWS = 120;   // ชีตคดีชุดที่ 2 = 120 แถวแรก → ตัวเลขบอตต้องเปลี่ยนเมื่อสลับชีตหลัก
const XB = {
  [XID.cases2]: { 'ข้อมูลคดี': casesGrid.slice(0, CASES2_ROWS + 1) },
  [XID.lot]: { 'คำอธิบาย': [['คำอธิบาย (ไม่มีข้อมูล)']], 'ข้อมูล Lot': sheets.lab['ข้อมูล Lot'], 'หมายเหตุ': sheets.lab['หมายเหตุ'] },
  [XID.wrong]: { 'Sheet1': [['ชื่อ', 'คะแนน'], ['ค่าลับในเซลล์ XYZ', 99]] },
  [XID.broken]: { 'ข้อมูลคดี': casesGrid.map((r, i) => r.map((v, j) => (i === 0 && v === 'วันที่รับ' ? 'วันรับ' : v))) },
  [XID.labBad]: { 'ข้อมูลงบ': [['ปี', 'รายการ'], [2568, 'x']], 'ข้อมูล Lot': sheets.lab['ข้อมูล Lot'] },
  [XID.secret]: { 'ข้อมูลคดี': casesGrid },
  [XID.tCasesE]: TPLS.cases && TPLS.cases.empty, [XID.tCasesF]: TPLS.cases && TPLS.cases.filled,
  [XID.tLabE]: TPLS.lab && TPLS.lab.empty, [XID.tLabF]: TPLS.lab && TPLS.lab.filled,
  [XID.tLotE]: TPLS.lot && TPLS.lot.empty, [XID.tLotF]: TPLS.lot && TPLS.lot.filled };
for (const k of Object.keys(XB)) if (!XB[k]) delete XB[k];
const link = id => 'https://docs.google.com/spreadsheets/d/' + id + '/edit#gid=0';
/** สภาพแวดล้อมโหมดใหม่ (ไม่มี CASES_SHEET_ID เดิม) · ผู้ใช้เปลี่ยนได้ด้วย as(g, email) */
function env(o = {}) {
  const opts = { sheets, email: o.email || OWNER, props: Object.assign({ CASES_SHEET_ID: null, LAB_SHEET_ID: null, ADMIN_EMAIL: OWNER }, o.props || {}),
    books: XB, acl: o.acl, noAccess: o.noAccess, lockBusy: o.lockBusy,
    fetch: o.fetch || ((url) => (url.startsWith(LINE_HOST) ? { code: 200, body: {} } : { code: 500, body: {} })) };
  if ('effectiveEmail' in o) opts.effectiveEmail = o.effectiveEmail;
  return load(opts);
}
const as = (g, email) => { g.__state.email = email; return g; };
const call = (g, email, fn, ...a) => as(g, email).__call(fn, ...a);
const cfgOf = g => { const p = g.__state.props, n = +String(p.DASH_CFG_N || '0').split(':')[0]; let j = ''; for (let i = 0; i < n; i++) j += p['DASH_CFG_' + i]; return n ? JSON.parse(j) : null; };
/** ชุดเริ่มต้น: เจ้าของเพิ่มชีตคดี (หลัก) + ชีตงานตรวจ + ชีต Lot + ผู้ใช้ 1 คน */
function seeded(o = {}) {
  const g = env(o);
  const a = call(g, OWNER, 'adminSaveSource', { link: link(IDS.cases), name: 'คดีส่งตรวจ DNA (ทดสอบ)' });
  const b = call(g, OWNER, 'adminSaveSource', { link: IDS.lab, name: 'งานตรวจ DNA' });
  const c = call(g, OWNER, 'adminSaveSource', { link: link(XID.lot), name: '' });
  call(g, OWNER, 'adminSaveUser', { email: ALLOWED, name: 'เจ้าหน้าที่ทดสอบ', note: '' });
  g.__ids = Object.fromEntries(c.state.sources.map(s => [s.id === a.state.sources[0].id ? 'cases' : s.kind === 'cases' ? 'cases?' : s.kindLabel === 'Lot พัสดุ' ? 'lot' : 'lab', s.id]));
  return g;
}
const snap = g => JSON.stringify(g.__state.props);
const ADMIN_FNS = [['adminInspectSource', link(IDS.cases)], ['adminSaveSource', { link: link(XID.cases2) }], ['adminRemoveSource', 'x'], ['adminSetMain', 'x'],
  ['adminGetPeople'], ['adminSaveUser', { email: 'evil@example.org', admin: true }], ['adminSetAdmin', ALLOWED, true], ['adminRemoveUser', OWNER]];

test('ผู้ดูแล', 'ฟังก์ชันผู้ดูแลทั้ง ' + ADMIN_FNS.length + ' ตัว เรียกโดยผู้ใช้ทั่วไป / คนนอก / ไม่ทราบอีเมล / ผ่านลิงก์บอต (Execute as Me)', 'โยน Error ทุกกรณี · Script Properties ไม่เปลี่ยน · ไม่เปิดชีตใด ๆ', () => {
  const g = seeded(); let n = 0;
  for (const who of [ALLOWED, STRANGER, '']) for (const [fn, ...args] of ADMIN_FNS) {
    const before = snap(g), opens = g.__state.opens; as(g, who);
    const m = throwsMsg(() => g[fn](...args)); assert.ok(/ผู้ดูแล|ไม่มีสิทธิ์/.test(m), fn + ': ' + m);
    assert.strictEqual(snap(g), before, fn + ' เปลี่ยน props'); assert.strictEqual(g.__state.opens, opens, fn + ' เปิดชีต'); n++;
  }
  const b = env({ email: ADMIN2, effectiveEmail: OWNER });   // ลิงก์บอต: สคริปต์ทำงานในนามเจ้าของ
  for (const [fn, ...args] of ADMIN_FNS) { assert.ok(throwsMsg(() => b[fn](...args)).includes('ไม่มีสิทธิ์'), fn); n++; }
  const o = env({ email: OWNER, effectiveEmail: OWNER }); assert.ok(o.adminGetPeople());   // เจ้าของเปิดเองได้
  return n + ' กรณีถูกปฏิเสธ';
});
test('ผู้ดูแล', 'ติดตั้งใหม่: เจ้าของ (ADMIN_EMAIL) เปิด Dashboard ครั้งแรก', 'เข้าได้ เป็นผู้ดูแล ยังไม่มีแหล่งข้อมูล · คนอื่นถูกปฏิเสธ "ไม่อยู่ในรายชื่อ"', () => {
  const g = env(); assert.ok(g.doGet().getContent().includes('id="view"'));
  const r = g.__call('getSources'); assert.strictEqual(r.isAdmin, true); assert.strictEqual(r.isOwner, true); assert.strictEqual(r.sources.length, 0); assert.strictEqual(r.mainId, null);
  assert.ok(as(g, STRANGER).doGet().getContent().includes('ยังไม่อยู่ในรายชื่อ'));
});
test('ตรวจลิงก์', 'ชีตคดีที่ถูกต้อง', 'ok · ชีตคดี · แท็บ ข้อมูลคดี 731 แถว · ไม่มีค่าในเซลล์และไม่มี Sheet ID ในผลตรวจ', () => {
  const g = env(); const r = g.__call('adminInspectSource', link(IDS.cases));
  assert.strictEqual(r.ok, true); assert.strictEqual(r.kind, 'cases'); assert.strictEqual(r.tabs[0].rows, 731); assert.strictEqual(r.tabs[0].status, 'ok');
  const js = JSON.stringify(r); assert.ok(!js.includes(IDS.cases));
  for (const row of casesGrid.slice(1)) for (const v of row) if (typeof v === 'string' && v.length >= 4 && !['ไม่ระบุ'].includes(v)) assert.ok(!js.includes(v), 'มีค่าในเซลล์: ' + v);
  for (const h of ['เลขหนังสือนำส่ง', 'ลงวันที่']) assert.ok(!js.includes(h), 'มีหัวคอลัมน์จริงที่ไม่จำเป็น ' + h);
  return `แท็บอื่น: ${r.otherTabs.join(', ')}`;
});
test('ตรวจลิงก์', 'ชีตงานตรวจครบ 4 แท็บ (วาง Sheet ID เปล่า)', 'ok · lab · เมนู ภาพรวม/งบประมาณ/Lot พัสดุ', () => {
  const r = env().__call('adminInspectSource', IDS.lab); assert.strictEqual(r.ok, true); assert.strictEqual(r.kind, 'lab');
  assert.deepStrictEqual(r.menus, ['ภาพรวม', 'งบประมาณ', 'Lot พัสดุ']); return r.tabs.map(t => t.name + ' ' + t.rows).join(', ');
});
test('ตรวจลิงก์', 'ชีต Lot พัสดุอย่างเดียว (คำอธิบาย + ข้อมูล Lot + หมายเหตุ)', 'ok · ป้าย "Lot พัสดุ" · เมนู Lot พัสดุอย่างเดียว · แจ้งแท็บที่ไม่มีเป็นภาษาไทย · ไม่สนแท็บ คำอธิบาย', () => {
  const r = env().__call('adminInspectSource', link(XID.lot));
  assert.strictEqual(r.ok, true); assert.strictEqual(r.kindLabel, 'Lot พัสดุ'); assert.deepStrictEqual(r.menus, ['Lot พัสดุ']);
  assert.ok(r.notes.some(n => n.includes('ไม่มีแท็บ "ข้อมูลเคส"')) && r.notes.some(n => n.includes('ไม่มีแท็บ "ข้อมูลงบ"'))); assert.deepStrictEqual(r.otherTabs, ['คำอธิบาย']);
  return r.notes.join(' / ');
});
test('ตรวจลิงก์', 'ชีตที่ไม่ตรงแม่แบบใดเลย', 'ok=false (no-match) บอกแท็บที่พบ ไม่มีค่าในเซลล์ · บันทึกไม่ได้', () => {
  const g = env(); const r = g.__call('adminInspectSource', link(XID.wrong));
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'no-match'); assert.ok(r.problems[0].includes('Sheet1'));
  assert.ok(!JSON.stringify(r).includes('ค่าลับในเซลล์') && !JSON.stringify(r).includes('คะแนน'));
  const before = snap(g); assert.ok(throwsMsg(() => g.adminSaveSource({ link: link(XID.wrong) })).includes('ไม่ตรงแม่แบบ')); assert.strictEqual(snap(g), before);
  return r.problems[0];
});
test('ตรวจลิงก์', 'ชีตคดีที่หัวคอลัมน์ "วันที่รับ" ถูกเปลี่ยนชื่อ / ชีตงานตรวจที่แท็บ ข้อมูลงบ หัวผิดแต่ ข้อมูล Lot ถูก', 'คดี: incomplete บอกคอลัมน์ที่ขาด · งานตรวจ: ใช้ได้ เฉพาะเมนู Lot พร้อมเตือน', () => {
  const g = env(); const r = g.__call('adminInspectSource', link(XID.broken));
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'incomplete'); assert.ok(r.tabs[0].missing.includes('วันที่รับ'));
  const l = g.__call('adminInspectSource', link(XID.labBad)); assert.strictEqual(l.ok, true); assert.deepStrictEqual(l.menus, ['Lot พัสดุ']);
  assert.ok(l.problems[0].includes('ข้อมูลงบ') && l.problems[0].includes('หมวด (คอลัมน์ C)'));
  return r.problems[0] + ' | ' + l.problems[0];
});
test('ตรวจลิงก์', 'ผู้ดูแลไม่มีสิทธิ์เปิดชีตนั้น (Execute as user)', 'ok=false (no-access) ข้อความไทย · บันทึกไม่ได้ (เพิ่มได้เฉพาะชีตที่ตัวเองเปิดได้)', () => {
  const g = env({ acl: { [XID.secret]: ['someone.else@example.org'] } }); const r = g.__call('adminInspectSource', link(XID.secret));
  assert.strictEqual(r.reason, 'no-access'); assert.ok(r.problems[0].includes('ผู้มีสิทธิ์อ่าน'));
  assert.ok(throwsMsg(() => g.adminSaveSource({ link: link(XID.secret) })).includes('เปิดชีตนี้ไม่ได้'));
});
test('ตรวจลิงก์', 'รูปแบบลิงก์', 'รับ: ลิงก์ /edit#gid, /u/1/, ?usp=sharing, Sheet ID, drive open?id · ปฏิเสธ: ว่าง, ข้อความ, /d/e/ เผยแพร่, ID สั้น, javascript:, โดเมนอื่น', () => {
  const g = env(); const P = s => g.parseSheetId_(s), id = IDS.cases;
  for (const ok of [link(id), 'https://docs.google.com/spreadsheets/u/1/d/' + id + '/edit', 'https://docs.google.com/spreadsheets/d/' + id + '/edit?usp=sharing', ' ' + id + ' ', 'https://drive.google.com/open?id=' + id, 'https://docs.google.com/spreadsheets/d/' + id])
    assert.strictEqual(P(ok), id, ok);
  for (const bad of ['', 'สวัสดี', 'https://docs.google.com/spreadsheets/d/e/2PACX-1vAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/pubhtml', 'abc123', 'javascript:alert(1)//' + id, 'https://evil.example/spreadsheets/d/' + id + '/edit', 'https://docs.google.com.evil.example/spreadsheets/d/' + id])
    throwsMsg(() => P(bad));
});
test('แหล่งข้อมูล', 'เพิ่มชีตคดี → งานตรวจ → Lot พัสดุ', 'ชีตคดีแรกถูกตั้งเป็นชีตหลักอัตโนมัติ · ชนิดถูกต้อง · ชื่อว่างใช้ชื่อตามชนิด', () => {
  const g = seeded(); const r = g.__call('getSources');
  assert.deepStrictEqual(r.sources.map(s => [s.kind, s.kindLabel, s.main]), [['cases', 'คดีส่งตรวจ DNA (รายคดี)', true], ['lab', 'งานตรวจ · Lot · งบประมาณ', false], ['lab', 'Lot พัสดุ', false]]);
  assert.strictEqual(r.sources[2].name, 'Lot พัสดุ'); assert.deepStrictEqual(r.sources[2].menus, ['Lot พัสดุ']); assert.ok(r.sources.every(s => /^s[0-9a-f]{10}$/.test(s.id)));
  return r.sources.map(s => s.name + (s.main ? ' [หลัก]' : '')).join(', ');
});
test('แหล่งข้อมูล', 'ชีตซ้ำ / ชื่อมีอักขระควบคุมและยาวเกิน / ชื่อมี <script>', 'ชีตซ้ำถูกปฏิเสธ · ชื่อถูกตัดเหลือ 60 ตัว ไม่มีอักขระควบคุม · <script> เก็บเป็นข้อความ (หน้าเว็บ escape)', () => {
  const g = seeded();
  assert.ok(throwsMsg(() => g.adminSaveSource({ link: IDS.cases })).includes('มีอยู่แล้ว'));
  const r = g.__call('adminSaveSource', { link: link(XID.cases2), name: 'ก\u0000ข\n\t' + 'ค'.repeat(100) }).state.sources.find(s => s.name.startsWith('ก'));
  assert.strictEqual(r.name.length, 60); assert.ok(!/[\u0000-\u001f]/.test(r.name));
  const x = g.__call('adminSaveSource', { id: r.id, name: '<script>alert(1)</script>' }).state.sources.find(s => s.id === r.id); assert.strictEqual(x.name, '<script>alert(1)</script>');
});
test('แหล่งข้อมูล', 'ผู้ใช้ทั่วไปเรียก getSources', 'ไม่มี Sheet ID / ลิงก์ / อีเมลผู้เพิ่ม · ผู้ดูแลได้ลิงก์', () => {
  const g = seeded(); const u = call(g, ALLOWED, 'getSources'), js = JSON.stringify(u);
  for (const id of [IDS.cases, IDS.lab, XID.lot]) assert.ok(!js.includes(id), 'รั่ว ' + id);
  assert.ok(!js.includes('docs.google.com') && !js.includes(OWNER)); assert.strictEqual(u.isAdmin, false); assert.ok(u.sources.every(s => !('url' in s) && !('by' in s)));
  const a = call(g, OWNER, 'getSources'); assert.ok(a.sources[0].url.includes(IDS.cases));
  return 'ผู้ใช้ได้: ' + Object.keys(u.sources[0]).join(', ');
});
test('แหล่งข้อมูล', 'ผู้ใช้เปิดแหล่งข้อมูลทุกชนิด (getBook ด้วยรหัสแหล่ง)', 'คดี 731 แถว · งานตรวจ 4 แท็บ · Lot พัสดุได้เฉพาะ ข้อมูล Lot + หมายเหตุ · รหัสแปลก ("__proto__", Sheet ID ตรง ๆ) ถูกปฏิเสธ', () => {
  const g = seeded(); const ids = call(g, ALLOWED, 'getSources').sources.map(s => s.id);
  const [c, l, t] = ids.map(id => call(g, ALLOWED, 'getBook', id));
  assert.strictEqual(c.tabs['ข้อมูลคดี'].length, 732); assert.strictEqual(l.names.length, 4); assert.deepStrictEqual(t.names, ['ข้อมูล Lot', 'หมายเหตุ']);
  for (const bad of ['__proto__', IDS.cases, 'cases', '', null]) throwsMsg(() => as(g, ALLOWED).getBook(bad));
});
test('แหล่งข้อมูล', 'ผู้ใช้ที่ยังไม่ได้รับแชร์ชีตบางแหล่ง', 'แหล่งนั้นได้ข้อความไทยที่บอกชื่อชีต + วิธีแก้ (ไม่มี Sheet ID) · แหล่งอื่นยังใช้ได้', () => {
  const g = seeded({ acl: { [IDS.lab]: [OWNER] } }); const ids = call(g, ALLOWED, 'getSources').sources.map(s => s.id);
  const m = throwsMsg(() => as(g, ALLOWED).getBook(ids[1])); assert.ok(m.includes('งานตรวจ DNA') && m.includes('ผู้มีสิทธิ์อ่าน') && !m.includes(IDS.lab), m);
  assert.ok(call(g, ALLOWED, 'getBook', ids[0]).names.length); return m;
});
test('แหล่งข้อมูล', 'ตั้งชีตหลัก / ลบ / แก้ลิงก์', 'ตั้งชีตงานตรวจเป็นหลักไม่ได้ · ลบชีตหลักไม่ได้ · เปลี่ยนลิงก์ชีตหลักเป็นชีต Lot ไม่ได้ · ลบชีตอื่นได้', () => {
  const g = seeded(); const s = g.__call('getSources').sources; const [c, l, t] = s.map(x => x.id);
  assert.ok(throwsMsg(() => g.adminSetMain(l)).includes('ชีตคดี'));
  assert.ok(throwsMsg(() => g.adminRemoveSource(c)).includes('ลบชีตหลักไม่ได้'));
  assert.ok(throwsMsg(() => g.adminSaveSource({ id: c, link: link(XID.labBad) })).includes('ชีตหลักต้องเป็นชีตคดี'));
  const r = g.__call('adminRemoveSource', t); assert.strictEqual(r.state.sources.length, 2); assert.ok(r.message.includes('ไม่ถูกลบ'));
  throwsMsg(() => g.adminRemoveSource(t));
});

// --- บอต + สรุปอ่านชีตหลัก ---
function botEnv(o = {}) {   // รายการ Deploy ของบอต: active user ว่าง, effective = เจ้าของ, props ของบอต
  const g = seeded(o); g.__state.email = ''; Object.assign(g.__state.props, BOTP, o.props || {});
  return g;
}
const sayEnv = (g, text) => { const before = g.__state.fetches.length; const e = mkEvent(text);
  g.doPost({ parameter: { token: TOKEN }, postData: { contents: JSON.stringify({ events: [e] }) } });
  return g.__state.fetches.slice(before).filter(x => x.url.endsWith('/reply')).map(x => JSON.parse(x.params.payload).messages[0].text); };
const recs2 = S.parseCases(casesGrid.slice(0, CASES2_ROWS + 1).map(r => r.map(v => (v && typeof v === 'object' && v.$date ? null : v))));
test('ชีตหลัก', 'LINE bot อ่านชีตหลัก แล้วผู้ดูแลสลับชีตหลักเป็นชีตคดีชุดที่ 2', `คำตอบ "คดีค้าง" เปลี่ยนตามชีตหลัก (ก่อน ${EXP.pending.total} คดี = Python, หลัง = Stats ของชีตชุด 2)`, () => {
  const g = botEnv({ effectiveEmail: OWNER });
  const before = sayEnv(g, 'คดีค้าง')[0]; assert.ok(before.includes('คดีค้าง (ยังไม่รับผล) ' + EXP.pending.total + ' คดี'), before);
  const id2 = call(g, OWNER, 'adminSaveSource', { link: link(XID.cases2), name: 'คดีชุด 2' }).state.sources.find(s => s.name === 'คดีชุด 2').id;
  call(g, OWNER, 'adminSetMain', id2); g.__state.email = '';
  const exp2 = g.Stats.pendingByStatus(g.loadCaseRecords_(), {}).total;
  assert.notStrictEqual(exp2, EXP.pending.total);
  const after = sayEnv(g, 'คดีค้าง')[0]; assert.ok(after.includes('คดีค้าง (ยังไม่รับผล) ' + exp2 + ' คดี'), after);
  const lk = sayEnv(g, '9999/2569')[0]; assert.ok(lk.startsWith('ไม่พบคดี'));
  return `ก่อน ${EXP.pending.total} → หลัง ${exp2} คดี`;
});
test('ชีตหลัก', 'สรุปรายเดือน (previewSummary) หลังสลับชีตหลัก', 'ตัวเลขมาจากชีตหลักใหม่ = Stats.summarize ของชีตนั้น', () => {
  const g = botEnv({ effectiveEmail: OWNER }); g.__state.email = OWNER;
  const a = g.previewSummary(2569, 10);
  const id2 = g.__call('adminSaveSource', { link: link(XID.cases2), name: 'คดีชุด 2' }).state.sources.find(s => s.name === 'คดีชุด 2').id; g.__call('adminSetMain', id2);
  const b = g.previewSummary(2569, 10), s2 = g.Stats.summarize(g.loadCaseRecords_(), g.Stats.monthRange(2026, 10));
  assert.ok(b.includes('คดีทั้งหมด ' + s2.cases + ' คดี') || (!s2.cases && b.includes('ไม่มีคดี')), b); assert.notStrictEqual(a, b);
  return 'ต.ค. 2569: ' + (a.match(/คดีทั้งหมด \d+/) || ['-'])[0] + ' → ' + (b.match(/คดีทั้งหมด \d+/) || ['ไม่มีคดี'])[0];
});
test('ชีตหลัก', 'ยังไม่มีชีตหลัก / เจ้าของเปิดชีตหลักไม่ได้', 'บอตตอบ "อ่านข้อมูลคดีไม่ได้" (ไม่ crash, ไม่รั่วรายละเอียด) · สรุปอัตโนมัติไม่ส่ง (no-main-source)', () => {
  const g = env({ email: '', effectiveEmail: OWNER, props: BOTP });
  const t = sayEnv(g, 'คดีค้าง')[0]; assert.ok(t.includes('อ่านข้อมูลคดีไม่ได้'), t);
  g.__state.email = OWNER; g.installTriggers(); g.__state.props.PUSH_ENABLED = 'yes'; g.__state.email = '';
  const uidT = g.__state.triggers[0].getUniqueId();
  assert.strictEqual(g.dailySummaryJob({ triggerUid: uidT }, bkk('2026-11-01T08:10:00')), 'no-main-source');
  assert.strictEqual(g.__state.fetches.filter(x => x.url.endsWith('/push')).length, 0);
  const h = botEnv({ effectiveEmail: OWNER }); h.__opts.acl = { [IDS.cases]: [ALLOWED] };   // ผู้ดูแลเพิ่มไว้ แต่ต่อมาเจ้าของถูกนำออกจากการแชร์
  assert.ok(sayEnv(h, 'คดีค้าง')[0].includes('อ่านข้อมูลคดีไม่ได้'));
});

// --- ผู้ใช้ ---
test('ผู้ใช้', 'เพิ่ม / แก้ / ลบผู้ใช้ในหน้าเว็บ', 'เพิ่มแล้วเปิดได้ทันที · ลบแล้วถูกปฏิเสธทันที (ไม่มีแคชสิทธิ์) · ชื่อ/หมายเหตุแก้ได้', () => {
  const g = seeded();
  assert.ok(as(g, USER2).doGet().getContent().includes('ไม่มีสิทธิ์'));
  const r = call(g, OWNER, 'adminSaveUser', { email: ' Staff.New@Example.org ', name: 'คนใหม่', note: 'ทดลอง' }); assert.ok(r.message.includes('แชร์'));
  assert.ok(as(g, USER2).doGet().getContent().includes('id="view"')); call(g, USER2, 'getSources');
  call(g, OWNER, 'adminSaveUser', { email: USER2, name: 'ชื่อใหม่', note: 'ย้ายหน่วย', edit: true });
  assert.strictEqual(cfgOf(g).people.find(p => p.email === USER2).name, 'ชื่อใหม่');
  call(g, OWNER, 'adminRemoveUser', USER2);
  assert.ok(throwsMsg(() => as(g, USER2).getSources()).includes('ไม่มีสิทธิ์')); assert.ok(as(g, USER2).doGet().getContent().includes('ไม่อยู่ในรายชื่อ'));
});
test('ผู้ใช้', 'อีเมลไม่ถูกต้อง / ซ้ำ / เป็นเจ้าของ / แก้คนที่ไม่มี / หมายเหตุยาว', 'ปฏิเสธด้วยข้อความไทย · หมายเหตุถูกตัด 100 ตัว', () => {
  const g = seeded(); const m = [];
  for (const e of ['', 'abc', 'a@b', 'a b@example.com', '<x>@example.com', 'x@example..com', 'x@' + 'a'.repeat(260) + '.example.com']) m.push(throwsMsg(() => g.adminSaveUser({ email: e })));
  assert.ok(m.every(x => x.includes('อีเมลไม่ถูกต้อง')));
  assert.ok(throwsMsg(() => g.adminSaveUser({ email: ALLOWED.toUpperCase() })).includes('อยู่ในรายชื่อแล้ว'));
  assert.ok(throwsMsg(() => g.adminSaveUser({ email: OWNER })).includes('เจ้าของ'));
  assert.ok(throwsMsg(() => g.adminSaveUser({ email: 'nobody@example.org', edit: true })).includes('ไม่พบ'));
  g.adminSaveUser({ email: USER2, note: 'น'.repeat(500) }); assert.strictEqual(cfgOf(g).people.find(p => p.email === USER2).note.length, 100);
});

// --- ผู้ดูแล ---
test('ผู้ดูแล', 'เจ้าของตั้ง admin2 เป็นผู้ดูแล → admin2 จัดการแหล่งข้อมูล/ผู้ใช้ทั่วไปได้ · เจ้าของตั้งและลด admin3', 'admin2 เรียกฟังก์ชันผู้ดูแลได้ เพิ่มผู้ใช้ทั่วไปได้ · เจ้าของตั้ง admin3 แล้วลดกลับเป็นผู้ใช้ (ยังเปิดได้) · ผู้ใช้ทั่วไปยังทำไม่ได้', () => {
  const g = seeded();
  call(g, OWNER, 'adminSaveUser', { email: ADMIN2, name: 'ผู้ดูแล 2', admin: true });
  assert.strictEqual(call(g, ADMIN2, 'getSources').isAdmin, true);
  call(g, ADMIN2, 'adminSaveUser', { email: ADMIN3, name: 'ผู้ดูแล 3' }); call(g, OWNER, 'adminSetAdmin', ADMIN3, true);
  assert.strictEqual(call(g, ADMIN3, 'getSources').isAdmin, true);
  const r = call(g, OWNER, 'adminSetAdmin', ADMIN3, false); assert.ok(r.message.includes('ยังเปิด Dashboard ได้'));
  assert.strictEqual(call(g, ADMIN3, 'getSources').isAdmin, false); throwsMsg(() => as(g, ADMIN3).adminGetPeople());
  assert.ok(call(g, ADMIN2, 'adminInspectSource', link(XID.lot)).ok);
  return 'ผู้ดูแลตอนนี้: ' + call(g, ADMIN2, 'adminGetPeople').people.filter(p => p.admin).map(p => p.email).concat([OWNER + ' (เจ้าของ)']).join(', ');
});
test('ผู้ดูแล', 'ป้องกันเจ้าของ', 'ผู้ดูแลคนอื่นลบ / ลดสิทธิ์ / เพิ่มซ้ำ เจ้าของ (ADMIN_EMAIL) ไม่ได้ · เจ้าของยังเป็นผู้ดูแล', () => {
  const g = seeded(); call(g, OWNER, 'adminSaveUser', { email: ADMIN2, admin: true }); as(g, ADMIN2);
  for (const f of [() => g.adminRemoveUser(OWNER), () => g.adminSetAdmin(OWNER, false), () => g.adminSaveUser({ email: OWNER, admin: false }), () => g.adminRemoveUser(' ' + OWNER.toUpperCase())]) assert.ok(/เจ้าของ/.test(throwsMsg(f)));
  assert.strictEqual(call(g, OWNER, 'getSources').isAdmin, true);
});
test('ผู้ดูแล', 'ไม่มี ADMIN_EMAIL แล้ว (เหลือ admin2 คนเดียว)', 'admin2 ลบ/ลดสิทธิ์ตัวเอง และตั้งผู้ดูแลเพิ่มไม่ได้ (ไม่มีเจ้าของระบบ) · ข้อความบอกให้ตั้ง ADMIN_EMAIL · admin2 ยังเป็นผู้ดูแล', () => {
  const g = seeded(); call(g, OWNER, 'adminSaveUser', { email: ADMIN2, admin: true }); delete g.__state.props.ADMIN_EMAIL; as(g, ADMIN2);
  const before = snap(g);
  for (const f of [() => g.adminSetAdmin(ADMIN2, false), () => g.adminRemoveUser(ADMIN2), () => g.adminSaveUser({ email: ADMIN2, admin: false, edit: true }), () => g.adminSetAdmin(ALLOWED, true)])
    assert.ok(throwsMsg(f).includes('ADMIN_EMAIL'));
  assert.strictEqual(snap(g), before); assert.strictEqual(call(g, ADMIN2, 'getSources').isAdmin, true);
});
test('ผู้ดูแล', 'ผู้ดูแล 2 คนบันทึกพร้อมกัน (lock ไม่ว่าง)', 'ข้อความไทยให้ลองใหม่ ไม่บันทึกทับ', () => {
  const g = seeded(); const before = snap(g); g.__state.locks = 0;
  const h = load({ sheets, email: OWNER, props: g.__state.props, books: XB, lockBusy: true });
  assert.ok(throwsMsg(() => h.adminSaveUser({ email: USER2 })).includes('กำลังบันทึก')); assert.strictEqual(snap(g), before);
  g.adminSaveUser({ email: USER2 }); assert.ok(g.__state.locks >= 1, 'ไม่ได้ใช้ LockService');
});

// --- ย้ายระบบเดิม ---
test('ย้ายระบบ', 'โหมดเดิม (มี CASES_SHEET_ID/LAB_SHEET_ID + แท็บ ผู้ใช้) → เจ้าของเปิด Dashboard', 'สร้างการตั้งค่าใหม่: 2 แหล่ง (ชีตคดี = ชีตหลัก) + ผู้ใช้ ' + EXP.users.length + ' คนจากแท็บ · แจ้งเจ้าของ · ผู้ใช้เดิมเปิดได้ต่อ', () => {
  const g = load({ sheets, email: OWNER, props: { ADMIN_EMAIL: OWNER } });
  assert.strictEqual(cfgOf(g), null);
  const r = g.__call('getSources'); assert.ok(r.notice.includes('ย้ายการตั้งค่าเดิม'), r.notice);
  const c = cfgOf(g); assert.deepStrictEqual(c.sources.map(s => [s.id, s.kind, s.sheetId]), [['cases', 'cases', IDS.cases], ['lab', 'lab', IDS.lab]]); assert.strictEqual(c.mainId, 'cases');
  assert.deepStrictEqual(c.people.map(p => p.email).sort(), EXP.users.slice().sort()); assert.ok(c.people.every(p => !p.admin));
  assert.ok(as(g, ALLOWED).getBook('cases').names.length); assert.strictEqual(call(g, OWNER, 'getSources').notice, '', 'แจ้งครั้งเดียว');
  return r.notice;
});
test('ย้ายระบบ', 'หลังย้ายแล้ว', 'ไม่อ่านแท็บ ผู้ใช้ / CASES_SHEET_ID อีก: เพิ่มชื่อในแท็บไม่มีผล · ลบผู้ใช้ทุกคนในหน้าเว็บแล้วแท็บไม่กลับมาใช้ · เปลี่ยน CASES_SHEET_ID ไม่มีผล', () => {
  const s2 = JSON.parse(JSON.stringify(sheets)); const g = load({ sheets: s2, email: OWNER, props: { ADMIN_EMAIL: OWNER } }); g.__call('getSources');
  s2.cases['ผู้ใช้'].push(['latecomer@example.org', 'มาทีหลัง', '']);
  assert.ok(as(g, 'latecomer@example.org').doGet().getContent().includes('ไม่มีสิทธิ์'));
  for (const e of EXP.users) call(g, OWNER, 'adminRemoveUser', e);
  g.__state.caches.clear();
  assert.ok(as(g, ALLOWED).doGet().getContent().includes('ไม่มีสิทธิ์'));
  g.__state.props.CASES_SHEET_ID = 'mockSomethingElse000000000000000'; assert.strictEqual(cfgOf(g).sources[0].sheetId, IDS.cases);
  as(g, ''); g.__state.props.ADMIN_EMAIL = OWNER; assert.strictEqual(g.mainSource_().sheetId, IDS.cases);
});
test('ย้ายระบบ', 'โหมดเดิมก่อนย้าย: บอตและสรุป', 'อ่าน CASES_SHEET_ID เดิมเป็นชีตหลัก (บอตเดิมทำงานต่อระหว่างอัปเดต)', () => {
  const g = bot(); assert.strictEqual(g.mainSource_().sheetId, IDS.cases); assert.strictEqual(cfgOf(g), null);
});

// --- ขนาดการตั้งค่า ---
test('ขนาดการตั้งค่า', 'ผู้ใช้ 250 คน ชื่อ/หมายเหตุภาษาไทยยาวสุด', 'แบ่งเก็บหลายคีย์ (ค่าละ ≤ 9 KB ตามเพดานจริง) อ่านกลับได้ครบ · ลดจำนวนแล้วลบคีย์เก่า', () => {
  const g = seeded();
  for (let i = 0; i < 250; i++) g.adminSaveUser({ email: `user${i}@example.org`, name: 'ชื่อทดสอบภาษาไทยยาวมาก'.repeat(3), note: 'หมายเหตุ' });
  const p = g.__state.props, n = +p.DASH_CFG_N.split(':')[0];
  assert.ok(n > 3, 'ควรแบ่งหลายชิ้น ได้ ' + n);
  for (let i = 0; i < n; i++) assert.ok(Buffer.byteLength('DASH_CFG_' + i + p['DASH_CFG_' + i]) <= 9 * 1024);
  assert.strictEqual(g.adminGetPeople().people.length, 251);
  const bytes = Object.keys(p).filter(k => k.startsWith('DASH_CFG_')).reduce((a, k) => a + Buffer.byteLength(p[k]), 0);
  for (let i = 0; i < 250; i++) g.adminRemoveUser(`user${i}@example.org`);
  const m = +p.DASH_CFG_N.split(':')[0]; assert.ok(m < n); assert.ok(!(('DASH_CFG_' + m) in p), 'คีย์เก่าไม่ถูกลบ');
  return `${n} ชิ้น (${Math.round(bytes / 1024)} KB) → ลดเหลือ ${m} ชิ้น`;
});
test('ขนาดการตั้งค่า', 'เกินเพดานที่ตั้ง (120 KB) / ชิ้นการตั้งค่าเสียหาย', 'บันทึกไม่ได้ ข้อความไทย ค่าเดิมไม่เปลี่ยน · ชิ้นเสียหาย = ปฏิเสธทุกคน (fail closed) ไม่เปิดให้ทุกคน', () => {
  const g = seeded(); let msg = '';
  try { for (let i = 0; i < 300; i++) g.adminSaveUser({ email: `big${i}@example.org`, name: 'ช'.repeat(60), note: 'ห'.repeat(100) }); } catch (e) { msg = e.message; }
  assert.ok(msg.includes('ยาวเกินที่เก็บได้'), msg); const ok = g.adminGetPeople().people.length; assert.ok(ok > 100 && ok < 301);
  g.__state.props.DASH_CFG_0 = g.__state.props.DASH_CFG_0.slice(0, -5);
  assert.ok(as(g, ALLOWED).doGet().getContent().includes('อ่านไม่ได้ชั่วคราว')); assert.ok(as(g, OWNER).doGet().getContent().includes('ไม่มีสิทธิ์'));
  return msg;
});
test('ขอบเขตสิทธิ์', 'appsscript.json', 'ยังเป็น spreadsheets.readonly (ไม่มีสิทธิ์เขียนชีต/Drive) · Deploy Dashboard = USER_ACCESSING', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'appsscript.json'), 'utf8'));
  assert.ok(m.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets.readonly'));
  assert.ok(!m.oauthScopes.some(s => /\/spreadsheets$|\/drive/.test(s))); assert.strictEqual(m.webapp.executeAs, 'USER_ACCESSING');
  return m.oauthScopes.map(s => s.split('/').pop()).join(', ');
});

// ---------- 9) ความปลอดภัย (ย้ายจาก security_review.js ทั้งหมด + Q44/Q45 + SR-1..SR-7) ----------
// docs/test-results/04-security-review.md หัวข้อ "การแก้ไข" อ้างชื่อกลุ่ม/ชื่อทดสอบในส่วนนี้
/** ชุดตรวจสิทธิ์: seeded + ชีตคดีชุด 2 (ให้ adminSetMain มีผลจริง) + admin2 เป็นผู้ดูแล */
function seededSec(o = {}) {
  const g = seeded(o);
  const r = call(g, OWNER, 'adminSaveSource', { link: link(XID.cases2), name: 'คดีชุด 2' });
  g.__ids.cases2 = r.state.sources.find(s => s.name === 'คดีชุด 2').id;
  call(g, OWNER, 'adminSaveUser', { email: ADMIN2, name: 'ผู้ดูแล ข', note: '', admin: true });
  return g;
}
const SEC_FNS = g => [['doGet', []], ['getSources', []], ['getBook', [g.__ids.cases]], ['checkSetup', []], ['checkMainSheetAccess', []],
  ['adminInspectSource', [link(IDS.cases)]], ['adminSaveSource', [{ id: g.__ids.lab, name: 'เปลี่ยนชื่อ' }]], ['adminRemoveSource', [g.__ids.lab]], ['adminSetMain', [g.__ids.cases2]],
  ['adminGetPeople', []], ['adminSaveUser', [{ email: 'evil@example.org', admin: true }]], ['adminSetAdmin', [ALLOWED, true]], ['adminRemoveUser', [ALLOWED]],
  ['doPost', [{ parameter: { token: 'guess' }, postData: { contents: '{"events":[{}]}' } }]],
  ['startSetupMode', []], ['showSetupGroups', []], ['allowSeenGroup', []], ['makeWebhookToken', []],
  ['dailySummaryJob', [{ triggerUid: 'trig-1' }]], ['previewSummary', [2569, 1]], ['previewYearSummary', [2568]], ['installTriggers', []], ['removeTriggers', []]];
const secOutcome = (g, who, fn, args) => {
  const before = snap(g), fetches = g.__state.fetches.length; as(g, who); let r;
  try { const v = g[fn](...args); r = typeof v === 'string' && fn === 'dailySummaryJob' ? 'คืน "' + v + '"' : v && v.getContent ? (fn === 'doPost' ? 'คืน "' + v.getContent() + '"' : /id="view"/.test(v.getContent()) ? 'หน้า Dashboard' : 'หน้าไม่มีสิทธิ์') : 'คืนค่า'; }
  catch (e) { r = 'ปฏิเสธ'; }
  if (snap(g) !== before) r += ' +แก้ props';
  if (g.__state.fetches.length !== fetches) r += ' +เรียกเครือข่าย';
  return r;
};
/** ผลที่คาดของแต่ละฟังก์ชัน × ผู้เรียก (ตาราง 04-security-review.md ข้อ 2 หลังแก้) */
function secExpect(fn, cls) {
  if (fn === 'doPost') return 'คืน "OK"';
  if (fn === 'dailySummaryJob') return 'คืน "refused-not-trigger"';
  if (cls === 'user') return fn === 'doGet' ? 'หน้า Dashboard' : ['getSources', 'getBook'].includes(fn) ? 'คืนค่า' : 'ปฏิเสธ';
  if (cls === 'admin') {
    if (fn === 'doGet') return 'หน้า Dashboard';
    if (['getSources', 'getBook', 'checkSetup', 'adminInspectSource', 'adminGetPeople'].includes(fn)) return 'คืนค่า';
    if (['adminSaveSource', 'adminRemoveSource', 'adminSetMain', 'adminRemoveUser'].includes(fn)) return 'คืนค่า +แก้ props';
    return 'ปฏิเสธ';   // adminSaveUser(admin:true), adminSetAdmin (Q44), checkMainSheetAccess และฟังก์ชันเจ้าของ
  }
  return fn === 'doGet' ? 'หน้าไม่มีสิทธิ์' : 'ปฏิเสธ';
}
const SEC_MATRIX = {};
test('ความปลอดภัย', 'ฟังก์ชันสาธารณะทุกตัว × 5 ผู้เรียก (คนนอก / ผู้ใช้ / ผู้ดูแลที่ไม่ใช่เจ้าของ / ลิงก์บอตไม่ล็อกอิน / ลิงก์บอตโดเมนเดียว)', 'ตรงตามตารางที่คาดทุกช่อง · รายชื่อฟังก์ชันสาธารณะจากการสแกน .gs ตรงกับที่ทดสอบ (เพิ่มฟังก์ชันใหม่โดยไม่ทดสอบ = ไม่ผ่าน)', () => {
  const callers = [['ก) คนนอก', 'out', () => seededSec(), STRANGER], ['ข) ผู้ใช้', 'user', () => seededSec(), ALLOWED], ['ค) ผู้ดูแล (ไม่ใช่เจ้าของ)', 'admin', () => seededSec(), ADMIN2],
    ['บอต: ไม่ล็อกอิน', 'out', () => { const g = seededSec(); g.__opts.effectiveEmail = OWNER; return g; }, ''],
    ['บอต: โดเมนเดียว', 'out', () => { const g = seededSec(); g.__opts.effectiveEmail = OWNER; return g; }, ADMIN2]];
  const src = fs.readdirSync(path.join(__dirname, '..')).filter(f => f.endsWith('.gs')).map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
  const pub = [...src.matchAll(/^function\s+([A-Za-z0-9]+)\s*\(/gm)].map(m => m[1]).filter(n => !n.endsWith('_'));
  const listed = SEC_FNS(seededSec()).map(x => x[0]);
  assert.deepStrictEqual(pub.slice().sort(), listed.slice().sort(), 'รายชื่อฟังก์ชันสาธารณะไม่ตรงกับที่ทดสอบ');
  const bad = [];
  for (const [label, cls, mk, who] of callers) for (let i = 0; i < listed.length; i++) {
    const g = mk(); const [fn, args] = SEC_FNS(g)[i]; const r = secOutcome(g, who, fn, args), e = secExpect(fn, cls);
    (SEC_MATRIX[fn] = SEC_MATRIX[fn] || {})[label] = r;
    if (r !== e) bad.push(`${fn} / ${label}: ได้ "${r}" คาด "${e}"`);
  }
  fs.writeFileSync(path.join(OUT, 'security_matrix.json'), JSON.stringify(SEC_MATRIX, null, 1));
  assert.deepStrictEqual(bad, []);
  return pub.length + ' ฟังก์ชัน × ' + callers.length + ' ผู้เรียก = ' + pub.length * callers.length + ' ช่อง ตรงทุกช่อง (ตารางเต็มใน .out/security_matrix.json)';
});
test('ความปลอดภัย', 'doGet บนลิงก์บอต (ไม่ล็อกอิน / Workspace โดเมนเดียว)', 'หน้าไม่มีสิทธิ์ ไม่มีเนื้อหา Dashboard', () => {
  for (const who of ['', ADMIN2]) { const g = seededSec(); g.__opts.effectiveEmail = OWNER; const h = as(g, who).doGet().getContent();
    assert.ok(!h.includes('id="view"') && h.includes('ไม่มีสิทธิ์'), who); }
});
test('ความปลอดภัย', 'ผลตรวจลิงก์ของชีตที่มีค่าลับในเซลล์/หัวคอลัมน์', 'ไม่มีค่าในเซลล์ ไม่มีหัวคอลัมน์ที่ไม่ใช่ของแม่แบบ ไม่มี Sheet ID ไม่มีเลข บก.', () => {
  const g = load({ sheets, email: OWNER, props: { CASES_SHEET_ID: null, LAB_SHEET_ID: null, ADMIN_EMAIL: OWNER },
    books: { mockWrongSheetIdForReview000001: { 'Sheet1': [['หัวลับ-H1', 'หัว2'], ['ค่าลับ-V1', 'ค่าลับ-V2']] },
      mockCasesSecretValues000000000002: { 'ข้อมูลคดี': casesGrid.map((r, i) => i === 0 ? r : r.map(v => typeof v === 'string' ? 'ค่าลับ-' + v : v)) } } });
  for (const id of ['mockWrongSheetIdForReview000001', 'mockCasesSecretValues000000000002', IDS.cases, IDS.lab]) {
    const js = JSON.stringify(g.__call('adminInspectSource', link(id)));
    assert.ok(!js.includes('ค่าลับ') && !js.includes('หัวลับ') && !js.includes(id), id + ': ' + js.slice(0, 200));
    if (id === IDS.cases) for (const row of casesGrid.slice(1, 50)) assert.ok(!js.includes(String(row[0])) || String(row[0]).length < 3, 'เลข บก. หลุด ' + row[0]);
  }
});
test('ความปลอดภัย', 'ผู้ใช้ทั่วไปเรียก getSources / getBook', 'ไม่มี Sheet ID, docs.google.com, อีเมลเจ้าของ/ผู้ดูแล, ผู้เปลี่ยนชีตหลัก', () => {
  const g = seededSec(); call(g, ADMIN2, 'adminSetMain', g.__ids.cases2);
  const s = JSON.stringify(call(g, ALLOWED, 'getSources')), b = JSON.stringify(call(g, ALLOWED, 'getBook', g.__ids.cases));
  for (const x of [IDS.cases, IDS.lab, XID.cases2, 'docs.google.com', OWNER, ADMIN2]) { assert.ok(!s.includes(x), 'getSources มี ' + x); assert.ok(!b.includes(x), 'getBook มี ' + x); }
  assert.strictEqual(JSON.parse(s).mainChange, null);
});
test('ความปลอดภัย', 'การตั้งค่า JSON ไม่ครบแต่ลายเซ็นตรง', 'ปฏิเสธทุกคน (fail closed) รวมเจ้าของ และบอตไม่อ่านชีต', () => {
  const g = seededSec(); const p = g.__state.props;
  const json = '{"v":1,"people":[{"email":"' + STRANGER + '"';
  for (const k of Object.keys(p)) if (/^DASH_CFG_/.test(k)) delete p[k];
  p.DASH_CFG_0 = json; p.DASH_CFG_N = '1:' + g.hash_(json);
  for (const who of [OWNER, ALLOWED, STRANGER]) assert.ok(!as(g, who).doGet().getContent().includes('id="view"'), who);
  assert.throws(() => g.mainSource_());
});

// --- Q44: เฉพาะเจ้าของระบบจัดการผู้ดูแล ---
test('Q44 ผู้ดูแล', 'ผู้ดูแลที่ไม่ใช่เจ้าของ: ทุกทางที่แตะผู้ดูแล (12 ทาง รวมตัวพิมพ์ใหญ่/ช่องว่าง)', 'ปฏิเสธทุกทาง ข้อความ "เฉพาะเจ้าของระบบ" · Script Properties ไม่เปลี่ยน · ผู้ดูแล/ผู้ใช้คงเดิม', () => {
  const g = seededSec(); call(g, OWNER, 'adminSaveUser', { email: ADMIN3, name: 'ผู้ดูแล ค', admin: true }); as(g, ADMIN2);
  const before = snap(g), A3 = ' ' + ADMIN3.toUpperCase() + ' ';
  const paths = [
    ['ตั้งผู้ใช้ทั่วไปเป็นผู้ดูแล (adminSetAdmin)', () => g.adminSetAdmin(ALLOWED, true)],
    ['ถอดผู้ดูแลคนอื่น (adminSetAdmin)', () => g.adminSetAdmin(ADMIN3, false)],
    ['ถอดผู้ดูแลคนอื่น ตัวพิมพ์ใหญ่/ช่องว่าง', () => g.adminSetAdmin(A3, false)],
    ['ถอดตัวเอง (adminSetAdmin)', () => g.adminSetAdmin(ADMIN2, false)],
    ['เพิ่มคนใหม่เป็นผู้ดูแล (adminSaveUser admin:true)', () => g.adminSaveUser({ email: 'newadmin@example.org', admin: true })],
    ['แก้ผู้ใช้ทั่วไปให้เป็นผู้ดูแล (adminSaveUser edit admin:true)', () => g.adminSaveUser({ email: ALLOWED, edit: true, admin: true })],
    ['แก้ชื่อผู้ดูแลคนอื่น (adminSaveUser edit)', () => g.adminSaveUser({ email: ADMIN3, edit: true, name: 'เปลี่ยนชื่อ' })],
    ['ลดผู้ดูแลคนอื่นผ่านฟอร์ม (adminSaveUser edit admin:false)', () => g.adminSaveUser({ email: A3, edit: true, admin: false })],
    ['ลดตัวเองผ่านฟอร์ม', () => g.adminSaveUser({ email: ADMIN2, edit: true, admin: false })],
    ['ลบผู้ดูแลคนอื่น (adminRemoveUser)', () => g.adminRemoveUser(ADMIN3)],
    ['ลบผู้ดูแลคนอื่น ตัวพิมพ์ใหญ่/ช่องว่าง', () => g.adminRemoveUser(A3)],
    ['ลบตัวเอง', () => g.adminRemoveUser(ADMIN2)]];
  for (const [name, f] of paths) { const m = throwsMsg(f); assert.ok(m.includes('เฉพาะเจ้าของระบบ'), name + ': ' + m); assert.strictEqual(snap(g), before, name + ' เปลี่ยน props'); }
  assert.ok(!g.adminGetPeople().people.some(p => p.email === 'newadmin@example.org'));
  assert.deepStrictEqual(call(g, OWNER, 'adminGetPeople').people.filter(p => p.admin).map(p => p.email).sort(), [ADMIN2, ADMIN3].sort());
  return paths.length + ' ทางถูกปฏิเสธ';
});
test('Q44 ผู้ดูแล', 'ผู้ดูแลที่ไม่ใช่เจ้าของ: งานที่ยังทำได้', 'เพิ่ม/แก้/ลบผู้ใช้ทั่วไป (ส่ง admin:false ได้) · เพิ่ม/แก้/ลบแหล่งข้อมูล · ตั้งชีตหลัก', () => {
  const g = seededSec(); as(g, ADMIN2);
  g.adminSaveUser({ email: USER2, name: 'ใหม่', admin: false });
  g.adminSaveUser({ email: USER2, name: 'ชื่อใหม่', edit: true, admin: false });
  g.adminSaveUser({ email: USER2, note: 'ไม่ส่ง admin', edit: true });
  assert.strictEqual(g.adminGetPeople().people.find(p => p.email === USER2).admin, false);
  g.adminRemoveUser(USER2); assert.ok(!g.adminGetPeople().people.some(p => p.email === USER2));
  g.adminSaveSource({ id: g.__ids.lab, name: 'งานตรวจ (ชื่อใหม่)' }); g.adminSetMain(g.__ids.cases2); g.adminRemoveSource(g.__ids.lot);
  const s = call(g, ADMIN2, 'getSources'); assert.strictEqual(s.mainId, g.__ids.cases2); assert.strictEqual(s.isOwner, false);
  assert.strictEqual(call(g, ADMIN2, 'adminGetPeople').isOwner, false); assert.strictEqual(call(g, OWNER, 'adminGetPeople').isOwner, true);
});
test('Q44 ผู้ดูแล', 'เจ้าของระบบ: ทุกทางของการจัดการผู้ดูแล', 'ตั้ง (2 ทาง) / แก้ชื่อ / ถอด (2 ทาง) / ลบผู้ดูแลได้ · ตัวเองยังเป็นผู้ดูแล', () => {
  const g = seededSec(); as(g, OWNER);
  g.adminSetAdmin(ALLOWED, true); assert.ok(g.adminGetPeople().people.find(p => p.email === ALLOWED).admin);
  g.adminSaveUser({ email: ADMIN3, name: 'ผู้ดูแล ค', admin: true }); g.adminSaveUser({ email: ADMIN3, name: 'แก้ชื่อ', edit: true, admin: true });
  g.adminSaveUser({ email: ADMIN3, edit: true, admin: false }); g.adminSetAdmin(ALLOWED, false);
  g.adminRemoveUser(ADMIN2);
  const P = g.adminGetPeople().people; assert.ok(!P.some(p => p.admin)); assert.ok(!P.some(p => p.email === ADMIN2));
  assert.strictEqual(call(g, OWNER, 'getSources').isAdmin, true);
});

// --- Q45: เตือนให้แชร์ชีตให้เจ้าของ / checkMainSheetAccess / log ของบอต / ใครเปลี่ยนชีตหลัก ---
test('Q45 ชีตหลัก', 'ผู้ดูแลที่ไม่ใช่เจ้าของเพิ่มชีต / ตั้งชีตหลัก / เปลี่ยนลิงก์ชีตหลัก', 'ผลมี warning "ต้องแชร์ชีตนี้ให้บัญชีเจ้าของระบบ (อีเมล) ไม่เช่นนั้นบอตจะอ่านไม่ได้" · เปลี่ยนชื่ออย่างเดียวไม่เตือน · เจ้าของไม่มี warning', () => {
  const g = seededSec(); as(g, ADMIN2);
  const m = g.adminSetMain(g.__ids.cases2).warning;
  assert.strictEqual(m, 'ต้องแชร์ชีตนี้ให้บัญชีเจ้าของระบบ (' + OWNER + ') ไม่เช่นนั้นบอตจะอ่านไม่ได้');
  const add = g.adminSaveSource({ link: link(XID.tLabF), name: 'งานตรวจ 2' }).warning; assert.ok(add.includes('ต้องแชร์ชีตนี้ให้บัญชีเจ้าของระบบ') && add.includes(OWNER), add);
  assert.strictEqual(g.adminSaveSource({ id: g.__ids.lab, name: 'ชื่อใหม่' }).warning, '');
  assert.ok(g.adminSaveSource({ id: g.__ids.cases2, link: link(XID.tCasesF) }).warning.includes('บอตจะอ่านไม่ได้'));
  as(g, OWNER); assert.strictEqual(g.adminSetMain(g.__ids.cases).warning, ''); assert.strictEqual(g.adminSaveSource({ link: link(XID.tLotF) }).warning, '');
  return m;
});
test('Q45 ชีตหลัก', 'บันทึกว่าใครเปลี่ยนชีตหลัก (mainChange)', 'ตั้ง/เปลี่ยนลิงก์ชีตหลัก = บันทึกผู้ทำและเวลา · ตั้งชีตเดิมซ้ำไม่เปลี่ยน · ผู้ดูแลเห็น ผู้ใช้ทั่วไปไม่เห็น', () => {
  const g = seededSec();
  assert.strictEqual(call(g, OWNER, 'getSources').mainChange.by, OWNER);
  call(g, ADMIN2, 'adminSetMain', g.__ids.cases2); const c = call(g, OWNER, 'getSources').mainChange;
  assert.strictEqual(c.by, ADMIN2); assert.ok(!isNaN(Date.parse(c.at)));
  call(g, OWNER, 'adminSaveUser', { email: ADMIN3, admin: true }); call(g, ADMIN3, 'adminSetMain', g.__ids.cases2);
  assert.strictEqual(call(g, OWNER, 'getSources').mainChange.by, ADMIN2, 'ตั้งชีตเดิมซ้ำต้องไม่เปลี่ยนผู้ทำ');
  call(g, ADMIN3, 'adminSaveSource', { id: g.__ids.cases2, link: link(XID.tCasesF) });
  assert.strictEqual(call(g, OWNER, 'getSources').mainChange.by, ADMIN3, 'เปลี่ยนลิงก์ชีตหลัก = เปลี่ยนชีตหลัก');
  call(g, ADMIN3, 'adminSaveSource', { id: g.__ids.cases2, name: 'แค่ชื่อ' });
  assert.strictEqual(call(g, ADMIN2, 'getSources').mainChange.by, ADMIN3);
  assert.strictEqual(call(g, ALLOWED, 'getSources').mainChange, null);
});
test('Q45 ชีตหลัก', 'checkMainSheetAccess (เจ้าของรันใน editor)', 'เปิดได้: ชื่อชีต ผู้ตั้ง จำนวนแถว · ผู้ดูแลอื่นตั้งชีตที่เจ้าของเปิดไม่ได้: บอกสาเหตุ no-access + ผู้ตั้ง + วิธีแก้ · ไม่มี Sheet ID/ค่าในเซลล์ · ผู้ดูแลอื่นรันไม่ได้', () => {
  const g = seededSec({ acl: { [XID.secret]: [ADMIN2] } });   // ชีตที่ผู้ดูแลเปิดได้ แต่ไม่ได้แชร์ให้เจ้าของ
  const ok = as(g, OWNER).checkMainSheetAccess();
  assert.ok(ok.includes('คดีส่งตรวจ DNA (ทดสอบ)') && ok.includes('731 แถว') && ok.includes('อ่านได้'), ok);
  assert.ok(throwsMsg(() => as(g, ADMIN2).checkMainSheetAccess()).includes('ADMIN_EMAIL'));
  const idS = call(g, ADMIN2, 'adminSaveSource', { link: link(XID.secret), name: 'ชีตของผู้ดูแล' }).state.sources.find(s => s.name === 'ชีตของผู้ดูแล').id;
  call(g, ADMIN2, 'adminSetMain', idS);
  const bad = as(g, OWNER).checkMainSheetAccess();
  assert.ok(bad.includes('อ่านชีตหลักไม่ได้ (no-access)') && bad.includes('ชีตของผู้ดูแล') && bad.includes('ตั้งโดย ' + ADMIN2) && bad.includes('แชร์ชีตนี้ให้บัญชีเจ้าของระบบ'), bad);
  for (const x of [XID.secret, IDS.cases, String(casesGrid[1][0])]) assert.ok(!bad.includes(x) && !ok.includes(x), x);
  assert.ok(as(g, OWNER).checkSetup().includes('อ่านชีตหลักไม่ได้ (no-access)'), 'checkSetup ของเจ้าของต้องมีผลตรวจนี้');
  assert.ok(as(g, ADMIN2).checkSetup().includes('ให้เจ้าของรัน checkMainSheetAccess'));
  return bad.replace(/\n/g, ' | ');
});
test('Q45 ชีตหลัก', 'บอต "อ่านข้อมูลคดีไม่ได้": log สาเหตุให้เจ้าของ', 'กลุ่มได้ข้อความสั้นเดิม (ไม่มีอีเมล/ชื่อชีต) · log มี [LINE bot] + สาเหตุ (no-main / no-access + ผู้ตั้ง / config-missing) · checkMainSheetAccess แสดงครั้งล่าสุด', () => {
  const e0 = env({ email: '', effectiveEmail: OWNER, props: BOTP });
  const t0 = sayEnv(e0, 'คดีค้าง')[0]; assert.ok(t0.includes('อ่านข้อมูลคดีไม่ได้'));
  assert.ok(e0.__state.logs.some(l => l.includes('[LINE bot] อ่านข้อมูลคดีไม่ได้ (no-main)')), e0.__state.logs.join('\n'));
  const g = botEnv({ acl: { [XID.secret]: [ADMIN2] } }); delete g.__opts.effectiveEmail;   // หน้าเว็บ: ทำงานในนามผู้เปิด
  call(g, OWNER, 'adminSaveUser', { email: ADMIN2, admin: true });
  const idS = call(g, ADMIN2, 'adminSaveSource', { link: link(XID.secret), name: 'ชีตของผู้ดูแล' }).state.sources.find(s => s.name === 'ชีตของผู้ดูแล').id;
  call(g, ADMIN2, 'adminSetMain', idS); g.__state.email = ''; g.__opts.effectiveEmail = OWNER;   // ลิงก์บอต: ทำงานในนามเจ้าของ
  const t = sayEnv(g, 'คดีค้าง')[0];
  assert.ok(t.includes('อ่านข้อมูลคดีไม่ได้') && !t.includes('@') && !t.includes('ชีตของผู้ดูแล'), t);
  const log = g.__state.logs.find(l => l.includes('[LINE bot] อ่านข้อมูลคดีไม่ได้ (no-access)')); assert.ok(log && log.includes('ตั้งโดย ' + ADMIN2) && log.includes(OWNER), String(log));
  assert.ok(!log.includes(XID.secret));
  assert.ok(as(g, OWNER).checkMainSheetAccess().includes('ครั้งล่าสุดที่อ่านไม่ได้'));
  return log;
});

// --- SR-1: แบ่งชิ้นไม่ผ่ากลางอีโมจิ ---
const loneEnd = s => /[\uD800-\uDBFF]$/.test(s) || /^[\uDC00-\uDFFF]/.test(s);
test('SR-1', 'ขอบชิ้นการตั้งค่าตกตรงอีโมจิ (ลองความยาวหมายเหตุ 0–40) + ชื่อภาษาไทยยาวสุดมีสระ/วรรณยุกต์', 'ไม่มีชิ้นไหนขึ้นต้น/ลงท้ายด้วยครึ่งอีโมจิ · ถ้าตัดแบบเดิม (slice) จะผ่ากลางอย่างน้อย 1 กรณี · จำลองที่เก็บแทนครึ่งอีโมจิด้วย U+FFFD แล้วเจ้าของยังเข้าได้ · ชื่อ/หมายเหตุอ่านกลับได้ตรงทุกตัว', () => {
  let naive = 0, checked = 0;
  const thai = 'นางสาวตัวอย่าง ทดสอบศักดิ์ นามสกุลสมมุติยาวมาก'.padEnd(60, 'ๆ');
  for (let pad = 0; pad <= 40; pad++) {
    const g = seededSec(); as(g, ADMIN2); const p = g.__state.props;
    g.adminSaveUser({ email: 'pad@example.org', name: thai, note: 'x'.repeat(pad) });
    for (let i = 0; i < 24; i++) g.adminSaveUser(i >= 16 ? { email: `emoji${i}@example.org`, name: thai, note: thai + thai.slice(0, 40) }
      : { email: `emoji${i}@example.org`, name: '\u{1F600}'.repeat(29) + 'ก', note: '\u{1F9EC}'.repeat(60) });
    const n = +p.DASH_CFG_N.split(':')[0]; let json = '';
    for (let k = 0; k < n; k++) { assert.ok(!loneEnd(p['DASH_CFG_' + k]), `pad ${pad} ชิ้น ${k} มีครึ่งอีโมจิ`); json += p['DASH_CFG_' + k]; checked++;
      assert.ok(Buffer.byteLength('DASH_CFG_' + k + p['DASH_CFG_' + k]) <= 9 * 1024); }
    for (let i = 2900; i < json.length; i += 2900) { const c = json.charCodeAt(i - 1); if (c >= 0xD800 && c <= 0xDBFF) naive++; }
    if (pad % 10 === 0) {
      for (const k of Object.keys(p)) if (/^DASH_CFG_\d+$/.test(k)) p[k] = p[k].replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');
      assert.ok(as(g, OWNER).doGet().getContent().includes('id="view"'), 'เจ้าของเข้าไม่ได้ pad ' + pad);
      const P = call(g, OWNER, 'adminGetPeople').people;
      assert.strictEqual(P.find(x => x.email === 'pad@example.org').name, thai); assert.strictEqual(P.find(x => x.email === 'emoji3@example.org').name, '\u{1F600}'.repeat(29) + 'ก');
    }
  }
  assert.ok(naive > 0, 'ชุดทดสอบไม่ได้สร้างกรณีที่ขอบชิ้นตกกลางอีโมจิ');
  return `${checked} ชิ้น ไม่ผ่ากลางเลย · ถ้าใช้ slice แบบเดิมจะผ่ากลาง ${naive} ครั้ง`;
});
test('SR-1', 'chunks_ (ใช้ทั้งการตั้งค่าและแคช) + ตัดความยาวชื่อตามจุดรหัส', 'ต่อกลับได้ตรง ชิ้น ≤ ขนาด ไม่มีครึ่งอีโมจิ · ชื่อ 59 ตัว+อีโมจิ = เก็บอีโมจิทั้งตัว · 60 ตัว+อีโมจิ = ตัดอีโมจิทิ้งทั้งตัว · ครึ่งอีโมจิที่ส่งมาเดี่ยว ๆ ถูกตัด', () => {
  const g = env(); let n = 0;
  for (let t = 0; t < 300; t++) {
    let s = ''; const L = Math.floor(Math.random() * 200);
    for (let i = 0; i < L; i++) s += ['ก', 'ั', 'x', '\u{1F600}', '\u{1F9EC}', '\u{20000}'][Math.floor(Math.random() * 6)];
    const size = 2 + Math.floor(Math.random() * 9), c = g.chunks_(s, size);
    assert.strictEqual(c.join(''), s); for (const x of c) { assert.ok(x.length <= size); assert.ok(!loneEnd(x)); } n += c.length;
  }
  assert.deepStrictEqual(Array.from(g.chunks_('', 5)), ['']);
  const a = g.cleanText_('ก'.repeat(59) + '\u{1F600}x', 60), b = g.cleanText_('ก'.repeat(60) + '\u{1F600}', 60), c = g.cleanText_('ab\uD83D', 60), d = g.cleanText_('\uDE00ab', 60);
  assert.strictEqual(a, 'ก'.repeat(59) + '\u{1F600}'); assert.strictEqual(b, 'ก'.repeat(60)); assert.strictEqual(c, 'ab'); assert.strictEqual(d, 'ab');
  return n + ' ชิ้นจาก 300 ข้อความสุ่ม';
});

// --- SR-2: หลังเคยบันทึกการตั้งค่า ไม่ย้อนกลับโหมดเดิม ---
test('SR-2', 'ย้ายระบบแล้วถอดสิทธิ์ staff1 → ลบ DASH_CFG_* ทั้งชุด ขณะ CASES_SHEET_ID ยังอยู่', 'ปฏิเสธทุกคนรวมเจ้าของ (config-missing) พร้อมข้อความบอกวิธีกู้ · ไม่ย้ายระบบใหม่ ไม่อ่านแท็บ ผู้ใช้ · บันทึกไม่ได้ · บอตไม่อ่านชีต (log สาเหตุ config)', () => {
  const g = load({ sheets, email: OWNER, effectiveEmail: undefined, props: { ADMIN_EMAIL: OWNER } }); delete g.__opts.effectiveEmail;
  g.__call('getSources'); assert.ok(g.__state.props.DASH_SETUP_DONE, 'ไม่มี DASH_SETUP_DONE หลังย้ายระบบ');
  call(g, OWNER, 'adminRemoveUser', ALLOWED); assert.ok(as(g, ALLOWED).doGet().getContent().includes('ไม่มีสิทธิ์'));
  for (const k of Object.keys(g.__state.props)) if (k.startsWith('DASH_CFG_')) delete g.__state.props[k];
  g.__state.caches.clear(); const before = snap(g), opens = g.__state.opens;
  for (const who of [ALLOWED, OWNER, STRANGER]) { const h = as(g, who).doGet().getContent(); assert.ok(!h.includes('id="view"') && h.includes('หายไป'), who); }
  assert.ok(throwsMsg(() => as(g, OWNER).getSources()).includes('ไม่มีสิทธิ์'));
  throwsMsg(() => as(g, OWNER).adminSaveUser({ email: USER2 }));
  assert.strictEqual(snap(g), before, 'ห้ามสร้างการตั้งค่าใหม่จากค่าเดิม'); assert.strictEqual(g.__state.opens, opens, 'ห้ามเปิดชีต (แท็บ ผู้ใช้)');
  as(g, ''); g.__opts.effectiveEmail = OWNER; Object.assign(g.__state.props, BOTP, { ADMIN_EMAIL: OWNER });
  assert.ok(sayEnv(g, 'คดีค้าง')[0].includes('อ่านข้อมูลคดีไม่ได้')); assert.ok(g.__state.logs.some(l => l.includes('(config)')));
});
test('SR-2', 'กู้คืนตาม README: เจ้าของลบ DASH_SETUP_DONE + CASES_SHEET_ID/LAB_SHEET_ID', 'เริ่มตั้งค่าใหม่ว่าง (ไม่ย้ายแท็บ ผู้ใช้ เดิม) · staff1 ยังถูกปฏิเสธ · ระบบเดิมที่บันทึกก่อนมี DASH_SETUP_DONE ได้ค่านี้อัตโนมัติ', () => {
  const g = load({ sheets, email: OWNER, props: { ADMIN_EMAIL: OWNER } }); g.__call('getSources');
  const p = g.__state.props; for (const k of Object.keys(p)) if (/^DASH_|^CASES_SHEET_ID$|^LAB_SHEET_ID$/.test(k)) delete p[k];
  const r = call(g, OWNER, 'getSources'); assert.strictEqual(r.sources.length, 0); assert.strictEqual(r.notice, '');
  assert.ok(as(g, ALLOWED).doGet().getContent().includes('ไม่มีสิทธิ์'));
  const h = seeded(); delete h.__state.props.DASH_SETUP_DONE; call(h, ALLOWED, 'getSources'); assert.ok(h.__state.props.DASH_SETUP_DONE, 'ไม่ได้ตั้ง DASH_SETUP_DONE ย้อนหลัง');
});

// --- SR-3 ---
test('SR-3', 'checkSetup ผ่าน google.script.run', 'ผู้ใช้ทั่วไป/คนนอก/ลิงก์บอต ปฏิเสธ · ผู้ดูแลได้ (ไม่มีผลตรวจของเจ้าของ) · เจ้าของได้ผลตรวจชีตหลัก', () => {
  const g = seededSec();
  for (const who of [ALLOWED, STRANGER, '']) throwsMsg(() => as(g, who).checkSetup());
  const a = as(g, ADMIN2).checkSetup(), o = as(g, OWNER).checkSetup();
  assert.ok(a.includes('(ผู้ดูแล)') && !a.includes('ผล: ')); assert.ok(o.includes('(เจ้าของสคริปต์)') && o.includes('ผล: บัญชี ' + OWNER + ' เปิดได้'));
});

// --- SR-4 ---
test('SR-4', 'dailySummaryJob: event object + ผู้เรียก', 'triggerUid ถูก แต่ active user เป็นผู้ดูแล (ลิงก์บอตโดเมนเดียว) / รายการ Deploy ของ Dashboard (ทำงานในนามผู้ใช้) / ไม่มี ADMIN_EMAIL / e ไม่ใช่ object → ปฏิเสธ ไม่ส่ง · trigger จริง (active ว่างหรือเจ้าของ) → ส่ง', () => {
  const T = '2026-11-01T08:10:00', mk = () => trigBot();
  let g = mk(); as(g, ADMIN2); assert.strictEqual(g.dailySummaryJob(g.__ev, bkk(T)), 'refused-not-trigger');
  g = mk(); delete g.__opts.effectiveEmail; as(g, ALLOWED); assert.strictEqual(g.dailySummaryJob(g.__ev, bkk(T)), 'refused-not-trigger');
  g = mk(); as(g, ''); delete g.__state.props.ADMIN_EMAIL; assert.strictEqual(g.dailySummaryJob(g.__ev, bkk(T)), 'refused-not-trigger');
  g = mk(); as(g, ''); for (const e of ['trig-1', 42, null, { triggerUid: 'x'.repeat(200) }]) assert.strictEqual(g.dailySummaryJob(e, bkk(T)), 'refused-not-trigger');
  assert.strictEqual(pushesOf(g).length, 0);
  g = mk(); as(g, ''); assert.strictEqual(g.dailySummaryJob(g.__ev, bkk(T)), 'sent:2026-10');
  g = mk(); as(g, OWNER); assert.strictEqual(g.dailySummaryJob(g.__ev, bkk(T)), 'sent:2026-10');
});

// --- SR-6 ---
test('SR-6', 'อักขระควบคุมทิศทาง/มองไม่เห็นในชื่อและหมายเหตุ', 'ตัด U+2066–2069, U+FEFF, U+061C, U+180E, U+200B–200F, U+202A–202E, U+2060, U+00AD, C1 · ภาษาไทยและอีโมจิคงเดิม', () => {
  const g = seededSec(); as(g, ADMIN2);
  const dirty = 'ก⁦ข⁧ค⁨ง⁩จ﻿؜᠎​‎‏‪‮⁠­\u0085ฉ ั้\u{1F9EC}';
  g.adminSaveUser({ email: USER2, name: dirty, note: dirty });
  const p = g.adminGetPeople().people.find(x => x.email === USER2);
  assert.strictEqual(p.name, 'กขคงจ ฉ ั้\u{1F9EC}'); assert.strictEqual(p.note, p.name);
  const s = g.__call('adminSaveSource', { id: g.__ids.lab, name: '‮งานตรวจ⁦' }).state.sources.find(x => x.id === g.__ids.lab); assert.strictEqual(s.name, 'งานตรวจ');
  return JSON.stringify(p.name);
});

// --- SR-7 ---
test('SR-7', 'อายุแคชข้อมูล', 'แคชข้อมูลต่อผู้ใช้ 60 วินาที (เลิกแชร์ชีตอย่างเดียว เห็นข้อมูลเดิมได้ไม่เกิน 60 วินาที) · หน้าเว็บยังดึงใหม่ทุก 120 วินาที · ถอดจากรายชื่อ = ปฏิเสธทันทีแม้มีแคช', () => {
  const g = seededSec(); const ttls = []; const orig = g.CacheService.getUserCache;
  g.CacheService.getUserCache = () => { const c = orig(); return Object.assign({}, c, { putAll: (o, ttl) => { ttls.push(ttl); return c.putAll(o, ttl); } }); };
  call(g, ALLOWED, 'getBook', g.__ids.cases); assert.deepStrictEqual(ttls, [60]);
  assert.strictEqual(call(g, ALLOWED, 'getSources').refreshSeconds, 120);
  call(g, OWNER, 'adminRemoveUser', ALLOWED); assert.ok(throwsMsg(() => as(g, ALLOWED).getBook(g.__ids.cases)).includes('ไม่มีสิทธิ์'));
});

// --- แม่แบบใน templates/ (ไฟล์เปล่าและใส่ข้อมูลจำลอง) ---
if (TPLS.cases) {
  for (const [key, label, kind, kl, menus] of [['tCases', 'ชีตคดี', 'cases', 'คดีส่งตรวจ DNA (รายคดี)', []], ['tLab', 'ชีตงานตรวจ', 'lab', 'งานตรวจ · Lot · งบประมาณ', ['ภาพรวม', 'งบประมาณ', 'Lot พัสดุ']], ['tLot', 'ชีต Lot พัสดุ', 'lab', 'Lot พัสดุ', ['Lot พัสดุ']]]) {
    test('แม่แบบ', `แม่แบบ${label} (เปล่า และใส่ข้อมูลจำลอง)`, `ตรวจลิงก์ผ่าน · ชนิด "${kl}" · แท็บ คำอธิบาย ถูกข้าม · แถวว่างที่มีแต่สูตรไม่ถูกนับ`, () => {
      const g = env(); const out = [];
      for (const v of ['E', 'F']) {
        const r = g.__call('adminInspectSource', link(XID[key + v]));
        assert.strictEqual(r.ok, true, JSON.stringify(r.problems)); assert.strictEqual(r.kind, kind); assert.strictEqual(r.kindLabel, kl); assert.deepStrictEqual(r.menus, menus);
        assert.ok(r.otherTabs.includes('คำอธิบาย'));
        const main = r.tabs.find(t => t.role === (kind === 'cases' ? 'cases' : menus.length === 1 ? 'lot' : 'cases'));
        if (v === 'E') assert.strictEqual(main.rows, 0, 'แม่แบบเปล่าต้องนับ 0 แถว'); else assert.ok(main.rows > 0);
        const id = g.__call('adminSaveSource', { link: link(XID[key + v]), name: label + v }).state.sources.find(s => s.name === label + v).id;
        const b = g.__call('getBook', id); out.push(`${v === 'E' ? 'เปล่า' : 'มีข้อมูล'} ${main.name} ${main.rows} แถว → getBook ${b.names.join('/')}`);
      }
      return out.join(' · ');
    });
  }
  test('แม่แบบ', 'แม่แบบชีตคดีใส่ข้อมูลจำลองครบ ตั้งเป็นชีตหลัก', `บอต "คดีค้าง" = ${EXP.pending.total} คดี และสรุป ต.ค. 2569 = ข้อมูลจำลองเดิม (คอลัมน์คำนวณที่แม่แบบตัดออกไม่มีผล) · เกณฑ์ของกลางส่งให้หน้าเว็บ`, () => {
    const g = env({ effectiveEmail: OWNER, props: BOTP });
    const id = g.__call('adminSaveSource', { link: link(XID.tCasesF) }).state.sources[0].id; g.__call('adminSetMain', id);
    const book = g.__call('getBook', id), h = book.tabs['ข้อมูลคดี'][0];
    assert.ok(h.some(x => String(x).startsWith('เกณฑ์ของกลางผิดปกติ')), 'ไม่มีคอลัมน์เกณฑ์');
    for (const gone of ['เดือนที่รับ', 'ปี พ.ศ. (รับ)', 'ปีเลขรายงาน']) assert.ok(!casesGrid[0].includes(gone) || !h.includes(gone));
    assert.strictEqual(g.previewSummary(2569, 10), SUMMARY_SAMPLES['2026-10']);
    g.__state.email = ''; const t = sayEnv(g, 'คดีค้าง')[0]; assert.ok(t.includes('คดีค้าง (ยังไม่รับผล) ' + EXP.pending.total + ' คดี'), t);
    const ge = env({ effectiveEmail: OWNER, props: BOTP }); const ide = ge.__call('adminSaveSource', { link: link(XID.tCasesE) }).state.sources[0].id;
    const te = (ge.__state.email = '', sayEnv(ge, 'คดีค้าง')[0]); assert.ok(te.includes('คดีค้าง (ยังไม่รับผล) 0 คดี'), te);
    const thr = book.tabs['ข้อมูลคดี'].slice(1).map(r => r[h.findIndex(x => String(x).startsWith('เกณฑ์'))]).find(v => typeof v === 'number');
    ge.__state.email = OWNER; const be = ge.__call('getBook', ide).tabs['ข้อมูลคดี'], he = be[0].findIndex(x => String(x).startsWith('เกณฑ์'));
    assert.strictEqual(be.slice(1).map(r => r[he]).find(v => typeof v === 'number'), 50, 'แม่แบบเปล่าต้องมีเกณฑ์ 50');
    return `หัวคอลัมน์ที่ส่ง ${h.length} คอลัมน์ · เกณฑ์จากข้อมูลจำลอง ${thr} · แม่แบบเปล่า: เกณฑ์ 50, คดีค้าง 0 คดี`;
  });
}

fs.writeFileSync(path.join(OUT, 'stats_by_month.json'), JSON.stringify(statsOf, null, 1));
fs.writeFileSync(path.join(OUT, 'books.json'), JSON.stringify({ cases: caseBook, lab: labBook, sources: g0.__call('getSources') }));
// หน้าปฏิเสธ (ไว้ถ่ายภาพหน้าจอ)
fs.writeFileSync(path.join(OUT, 'denied.html'), load({ sheets, email: 'stranger@example.org', props: { ADMIN_CONTACT: 'ผู้ดูแลระบบ (ตัวอย่าง)' } }).doGet().getContent());

// ---------- 8) หน้าเว็บ (Playwright) ----------
(async () => {
  if (!process.argv.includes('--unit')) {
    let ui = null;
    try { ui = require('./ui'); } catch (e) { console.log('ข้ามทดสอบหน้าเว็บ: ' + e.message); }
    const live = { link, XID, OWNER, ALLOWED, ADMIN2, make: () => {
      const g = seeded({ acl: { [IDS.lab]: [OWNER] } });   // ALLOWED ยังไม่ได้รับแชร์ชีตงานตรวจ
      call(g, OWNER, 'adminSaveUser', { email: ADMIN2, name: 'ผู้ดูแล ข', note: 'หัวหน้างาน', admin: true });
      call(g, OWNER, 'adminSaveSource', { link: link(XID.cases2), name: 'คดีชุด 2' });
      for (const [e, n, t] of [['staff2@example.org', 'เจ้าหน้าที่ ค', 'ห้องปฏิบัติการ'], ['staff3@example.org', 'เจ้าหน้าที่ ง', '']]) call(g, OWNER, 'adminSaveUser', { email: e, name: n, note: t });
      return g; } };
    if (ui) await ui.run({ results, OUT, EXP, statsOf, botSamples: { pending: pendingSample }, live });
  }
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.group}] ${r.name} — ${r.actual}`);
  console.log(`\n${pass}/${results.length} ผ่าน`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  fs.writeFileSync(path.join(OUT, 'bot_samples.json'), JSON.stringify({ pending: pendingSample, summary: SUMMARY_SAMPLES, aiPayload, january: janSample }, null, 1));
  process.exit(pass === results.length ? 0 : 1);
})();
