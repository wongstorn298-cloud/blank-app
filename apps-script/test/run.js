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

fs.writeFileSync(path.join(OUT, 'stats_by_month.json'), JSON.stringify(statsOf, null, 1));
fs.writeFileSync(path.join(OUT, 'books.json'), JSON.stringify({ cases: caseBook, lab: labBook, sources: g0.__call('getSources') }));
// หน้าปฏิเสธ (ไว้ถ่ายภาพหน้าจอ)
fs.writeFileSync(path.join(OUT, 'denied.html'), load({ sheets, email: 'stranger@example.org', props: { ADMIN_CONTACT: 'ผู้ดูแลระบบ (ตัวอย่าง)' } }).doGet().getContent());

// ---------- 8) หน้าเว็บ (Playwright) ----------
(async () => {
  if (!process.argv.includes('--unit')) {
    let ui = null;
    try { ui = require('./ui'); } catch (e) { console.log('ข้ามทดสอบหน้าเว็บ: ' + e.message); }
    if (ui) await ui.run({ results, OUT, EXP, statsOf, botSamples: { pending: pendingSample } });
  }
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.group}] ${r.name} — ${r.actual}`);
  console.log(`\n${pass}/${results.length} ผ่าน`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  fs.writeFileSync(path.join(OUT, 'bot_samples.json'), JSON.stringify({ pending: pendingSample, summary: SUMMARY_SAMPLES, aiPayload, january: janSample }, null, 1));
  process.exit(pass === results.length ? 0 : 1);
})();
