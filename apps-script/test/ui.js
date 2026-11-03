// ทดสอบหน้าเว็บ Index.html ด้วย Playwright (Chromium) โดยจำลอง google.script.run ด้วยข้อมูลจำลอง
// ไม่ใช้เครือข่าย: ทุกคำขอถูกตอบจากไฟล์ในเครื่อง (ฟอนต์ Google ตอบเป็น CSS ว่าง → ใช้ฟอนต์ไทยของเครื่องแทน)
// ภาพหน้าจอเก็บที่ $SHOT_DIR (ค่าเริ่มต้น apps-script/test/.out/shots) ไม่เก็บใน repo
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const JSZIP = (() => { try { return require.resolve('jszip/dist/jszip.min.js', { paths: [path.dirname(require.resolve('playwright')), '/opt/node-tools/node_modules'] }); } catch (e) { return null; } })();
const BASE = 'https://dash.test/';

async function run({ results, OUT, EXP, statsOf, botSamples }) {
  const SHOTS = process.env.SHOT_DIR || path.join(OUT, 'shots');
  fs.mkdirSync(SHOTS, { recursive: true });
  const books = JSON.parse(fs.readFileSync(path.join(OUT, 'books.json'), 'utf8'));
  const rec = (name, expect, fn) => results.push({ group: 'หน้าเว็บ', name, expect, ...fn });
  const shots = [];

  const browser = await chromium.launch();
  const issues = [];   // console error / pageerror / คำขอที่ไม่ได้ตั้งใจ
  const requested = [];
  async function newPage(opts = {}) {
    const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, deviceScaleFactor: opts.dpr || 1.5, colorScheme: opts.scheme || 'light' });
    await ctx.route('**/*', async route => {
      const u = route.request().url(); requested.push(u);
      if (u === BASE) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(ROOT, 'apps-script', 'Index.html')) });
      if (u === BASE + 'orig/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(ROOT, 'dashboard', 'index.html')) });
      if (u.startsWith(BASE + 'orig/samples/') && u.endsWith('.xlsx')) {
        const f = path.join(ROOT, 'dashboard', 'samples', path.basename(new URL(u).pathname));
        return fs.existsSync(f) ? route.fulfill({ body: fs.readFileSync(f), contentType: 'application/octet-stream' }) : route.fulfill({ status: 404, body: '' });
      }
      if (u === BASE + 'denied') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(OUT, 'denied.html')) });
      if (u.startsWith('https://fonts.googleapis.com/')) return route.fulfill({ contentType: 'text/css', body: '/* offline test */' });
      if (u.includes('/jszip/3.10.1/jszip.min.js') && JSZIP) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(JSZIP) });
      issues.push('unexpected request ' + u); return route.fulfill({ status: 404, body: '' });
    });
    await ctx.addInitScript(b => {   // google.script.run จำลอง: ส่งผลแบบ async ผ่าน JSON เหมือนของจริง
      const srv = { getSources: () => b.sources, getBook: k => { if (!b[k]) throw new Error('ไม่รู้จักแหล่งข้อมูล'); return b[k]; } };
      const mk = (ok, fail) => new Proxy({}, { get: (_, k) => k === 'withSuccessHandler' ? h => mk(h, fail) : k === 'withFailureHandler' ? h => mk(ok, h)
        : (...a) => setTimeout(() => { try { const r = JSON.parse(JSON.stringify(srv[k](...a))); ok && ok(r); } catch (e) { fail && fail(e); } }, 30) });
      window.google = { script: { get run() { return mk(null, null); } } };
    }, books);
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') issues.push('console.error: ' + m.text()); });
    page.on('pageerror', e => issues.push('pageerror: ' + e.message));
    return page;
  }
  const shot = async (page, name, full = true) => { const f = path.join(SHOTS, name + '.png'); await page.screenshot({ path: f, fullPage: full }); shots.push(f); };
  const settle = page => page.waitForTimeout(250);
  const go = async (page, hash) => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForSelector('#view .card'); await settle(page); };
  const num = s => +String(s).replace(/[^\d.-]/g, '');
  const axis = page => page.evaluate(() => [...document.querySelectorAll('.chart svg')].map(svg => {
    const b = [...svg.querySelectorAll(':scope > text[text-anchor="middle"]:not(.vl)')].map(t => t.getBBox());
    let ov = 0; for (let i = 1; i < b.length; i++) if (b[i].x < b[i - 1].x + b[i - 1].width + 2) ov++;
    return { labels: b.length, overlaps: ov };
  }));
  const check = (name, expect, fn) => fn().then(a => rec(name, expect, { actual: a == null ? 'ตรงตามคาด' : String(a), pass: true }),
    e => rec(name, expect, { actual: 'ไม่ผ่าน: ' + e.message, pass: false }));
  const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: ได้ ${a} คาด ${b}`); };

  try {
    // ---------- Apps Script: แหล่งข้อมูลคดี ----------
    const p = await newPage();
    await p.goto(BASE + '#overview'); await p.waitForSelector('[data-flash="c_n"]'); await settle(p);
    await check('เปิดหน้าแรก (stub google.script.run)', 'แสดงชุด "คดีส่งตรวจ DNA" เป็นค่าเริ่มต้น', async () => {
      eq(await p.$eval('#srcSel', s => s.value), 'srv-cases', 'แหล่งข้อมูล'); eq(num(await p.textContent('[data-flash="c_n"]')), EXP.allCounted, 'คดีทั้งหมด');
      return `คดีทั้งหมด ${EXP.allCounted} · สถานะ "${(await p.textContent('#statusTxt')).trim()}"`;
    });
    await check('แกน x เมื่อเลือก "ทั้งหมด" (กว้าง 1440px)', 'ป้ายเดือนไม่ซ้อนกัน', async () => {
      const a = await axis(p); if (a.some(x => x.overlaps)) throw new Error(JSON.stringify(a));
      return a.map(x => `กราฟละ ${x.labels} ป้าย`).join(', ') + ' · ซ้อน 0';
    });
    await shot(p, 'as-cases-overview-all');

    await check('ตัวเลขรายเดือนบน Dashboard = Stats.gs', 'คดีและของกลางในตาราง "สถิติรายเดือน" ตรงกับ Stats.summarize', async () => {
      const rows = await p.$$eval('section.card', cs => { const c = cs.find(x => x.querySelector('h2')?.textContent === 'สถิติรายเดือน');
        return [...c.querySelectorAll('tbody tr')].map(tr => [...tr.cells].map(td => td.textContent.trim())); });
      const map = Object.fromEntries(rows.map(r => [r[0], r]));
      const out = [];
      for (const k of ['2022-12', '2023-01', '2025-09', '2025-10', '2026-10']) {
        const s = statsOf[k], lab = s.range.label, r = map[lab]; if (!r) throw new Error('ไม่พบแถว ' + lab);
        eq(num(r[1]), s.cases, lab + ' คดี'); eq(num(r[2]), s.evidence, lab + ' ของกลาง'); out.push(`${lab} ${s.cases}/${s.evidence}`);
      }
      return out.join(' · ');
    });
    for (const [yk, by] of [['2025', 2568], ['2022', 2565]]) {
      await check(`กรองปี ${by}: KPI = Stats.gs ปีเต็ม`, `คดี ${statsOf[yk].cases}, ของกลาง ${statsOf[yk].evidence}`, async () => {
        await p.click(`.chip[data-y="${by}"]`); await settle(p);
        eq(num(await p.textContent('[data-flash="c_n"]')), statsOf[yk].cases, 'คดี'); eq(num(await p.textContent('[data-flash="c_i"]')), statsOf[yk].evidence, 'ของกลาง');
      });
    }
    await shot(p, 'as-cases-overview-2568');
    await p.click('.chip[data-y="0"]'); await settle(p);

    for (const [v, label] of [['area', 'พื้นที่และประเภทคดี'], ['monthly', 'ประเภท/ผู้ตรวจรายเดือน'], ['time', 'ระยะเวลาและงานค้าง'], ['check', 'ตรวจสอบข้อมูล'], ['sources', 'แหล่งข้อมูล']]) {
      await check(`เมนู ${label}`, 'แสดงได้ ไม่มีข้อความผิดพลาด', async () => {
        await go(p, '#' + v); const err = await p.$('#view .msg.err'); if (err) throw new Error(await err.textContent());
        const n = await p.$$eval('#view .card', c => c.length), ch = await p.$$eval('#view .chart svg', c => c.length);
        const a = await axis(p); if (a.some(x => x.overlaps)) throw new Error('ป้ายแกนซ้อน ' + JSON.stringify(a));
        await shot(p, 'as-cases-' + v); return `${n} การ์ด, ${ch} กราฟ`;
      });
    }
    await check('เมนู แหล่งข้อมูล แสดงอีเมลผู้ใช้ และไม่มีปุ่มเพิ่มลิงก์ชีต', 'มีอีเมล, ไม่มี "เพิ่ม Google Sheet"', async () => {
      const t = await p.textContent('#view'); if (!t.includes(books.sources.email)) throw new Error('ไม่มีอีเมล');
      if (t.includes('เพิ่ม Google Sheet') || t.includes('ทุกคนที่มีลิงก์ดูได้')) throw new Error('ยังมีฟีเจอร์ลิงก์ชีต');
    });

    await check('ผู้ตรวจ × ประเภทคดี เดือน ต.ค. 2569 = Stats.gs', 'ทุกเซลล์ในตาราง "ผู้ตรวจแต่ละคนได้คดีอะไรบ้าง" ตรงกับ byOfficer', async () => {
      await go(p, '#monthly'); await p.selectOption('#cmSel', '202610'); await settle(p);
      const tb = await p.$$eval('section.card', cs => { const c = cs.find(x => (x.querySelector('h2')?.textContent || '').startsWith('ผู้ตรวจแต่ละคนได้คดีอะไรบ้าง'));
        const t = c.querySelector('table'); return { head: [...t.tHead.rows[0].cells].map(x => x.textContent.trim()), rows: [...t.tBodies[0].rows].map(r => [...r.cells].map(x => x.textContent.trim())) }; });
      const s = statsOf['2026-10'], off = Object.fromEntries(s.byOfficer.map(o => [o.name, Object.fromEntries(o.byType.map(t => [t.name, t.cases]))]));
      const tot = Object.fromEntries(s.byOfficer.map(o => [o.name, o.cases]));
      const cols = tb.head.slice(1, -1), shown = cols.filter(c => c !== 'อื่นๆ' && c !== 'ยังไม่ระบุ');
      let cells = 0;
      for (const r of tb.rows) {
        const name = r[0] === 'ยังไม่ระบุผู้ตรวจ' ? 'ไม่ระบุ' : r[0], st = off[name]; if (!st) throw new Error('ไม่พบผู้ตรวจ ' + name);
        cols.forEach((c, i) => {
          const want = c === 'ยังไม่ระบุ' ? (st['ไม่ระบุ'] || 0) : c === 'อื่นๆ' ? Object.entries(st).filter(([k]) => k !== 'ไม่ระบุ' && !shown.includes(k)).reduce((a, [, v]) => a + v, 0) : (st[c] || 0);
          eq(r[i + 1] === '·' ? 0 : num(r[i + 1]), want, `${name}/${c}`); cells++;
        });
        eq(num(r.at(-1)), tot[name], name + ' รวม'); cells++;
      }
      eq(tb.rows.length, s.byOfficer.length, 'จำนวนผู้ตรวจ');
      await shot(p, 'as-cases-monthly-2569-10'); return `${tb.rows.length} ผู้ตรวจ, ${cells} เซลล์ตรงทั้งหมด`;
    });
    await check('คดีที่ยังไม่รับผล (เมนูระยะเวลา) = Stats.pendingCases', `${EXP.pending.total} คดี`, async () => {
      await go(p, '#time'); eq(num(await p.textContent('[data-flash="t_w"]')), EXP.pending.total, 'คดีค้าง');
    });
    await check('คดีค้างแยก 2 กลุ่มบน Dashboard = ข้อความ LINE bot', `กำลังดำเนินการ ${EXP.pending.byStatus['กำลังดำเนินการ']} · รอรับผล ${EXP.pending.byStatus['เสร็จแล้ว รอรับผล']}`, async () => {
      await go(p, '#time');
      const sub = await p.evaluate(() => document.querySelector('[data-flash="t_w"]').parentElement.textContent);
      const m = sub.match(/กำลังดำเนินการ\s*([\d,]+)\s*·\s*รอรับผล\s*([\d,]+)/); if (!m) throw new Error('ไม่พบข้อความแยกกลุ่ม: ' + sub);
      eq(num(m[1]), EXP.pending.byStatus['กำลังดำเนินการ'], 'กำลังดำเนินการ'); eq(num(m[2]), EXP.pending.byStatus['เสร็จแล้ว รอรับผล'], 'รอรับผล');
      const bot = (botSamples && botSamples.pending) || '';
      if (!bot.includes('1) กำลังดำเนินการ: ' + m[1] + ' คดี') || !bot.includes('2) เสร็จแล้ว รอรับผล: ' + m[2] + ' คดี')) throw new Error('ข้อความบอตไม่ตรง Dashboard');
      return `Dashboard ${m[1]} / ${m[2]} = บอต`;
    });

    // ดูไฟล์ Excel ในเครื่อง (JSZip โหลดเมื่อเลือกไฟล์)
    await check('ดูไฟล์ Excel ในเครื่อง (cases.xlsx)', 'อ่านได้ ตัวเลขเท่ากับข้อมูลจากเซิร์ฟเวอร์', async () => {
      if (!JSZIP) throw new Error('ไม่พบ jszip ในเครื่องสำหรับทดสอบ');
      await go(p, '#sources'); await p.setInputFiles('#file', path.join(ROOT, 'dashboard', 'samples', 'cases.xlsx'));
      await p.waitForFunction(() => document.querySelector('#srcSel').value.startsWith('file-')); await go(p, '#overview');
      eq(num(await p.textContent('[data-flash="c_n"]')), EXP.allCounted, 'คดีจากไฟล์'); return `คดี ${EXP.allCounted} ตรงกับเซิร์ฟเวอร์`;
    });

    // ---------- Apps Script: แหล่งข้อมูล lab ----------
    for (const [v, label] of [['overview', 'ภาพรวม'], ['budget', 'งบประมาณ'], ['lot', 'Lot พัสดุ']]) {
      await check(`ชุดงานตรวจ (lab) เมนู ${label}`, 'แสดงได้ ไม่มีข้อความผิดพลาด', async () => {
        if (await p.$eval('#srcSel', s => s.value) !== 'srv-lab') { await p.selectOption('#srcSel', 'srv-lab'); await p.waitForSelector('[data-flash]'); }
        await go(p, '#' + v); const err = await p.$('#view .msg.err'); if (err) throw new Error(await err.textContent());
        const a = await axis(p); if (a.some(x => x.overlaps)) throw new Error('ป้ายแกนซ้อน');
        await shot(p, 'as-lab-' + v); return `${await p.$$eval('#view .card', c => c.length)} การ์ด, ${a.length} กราฟ`;
      });
    }
    await p.selectOption('#srcSel', 'srv-cases'); await p.waitForSelector('[data-flash="c_n"]'); await go(p, '#overview');
    await p.click('#themeBtn'); await settle(p); await shot(p, 'as-cases-overview-dark', false);
    await p.context().close();

    // ---------- มือถือ ----------
    const m = await newPage({ viewport: { width: 390, height: 844 }, dpr: 2 });
    await m.goto(BASE + '#overview'); await m.waitForSelector('[data-flash="c_n"]'); await settle(m);
    await check('มือถือ 390px เลือก "ทั้งหมด"', 'ป้ายแกน x ไม่ซ้อน ไม่มีเลื่อนแนวนอน', async () => {
      const a = await axis(m); if (a.some(x => x.overlaps)) throw new Error(JSON.stringify(a));
      const sw = await m.evaluate(() => document.documentElement.scrollWidth); if (sw > 392) throw new Error('scrollWidth ' + sw);
      return a.map(x => x.labels + ' ป้าย').join(', ');
    });
    await shot(m, 'as-mobile-overview');
    await m.goto(BASE + 'denied'); await settle(m); await shot(m, 'as-denied-mobile', false);
    await m.context().close();
    const d = await newPage({ viewport: { width: 1000, height: 640 } });
    await d.goto(BASE + 'denied'); await settle(d); await shot(d, 'as-denied', false);
    await check('หน้า "ไม่มีสิทธิ์เข้าถึง"', 'แสดงอีเมลและผู้ติดต่อ เป็นภาษาไทย', async () => {
      const t = await d.textContent('body'); if (!t.includes('stranger@example.org') || !t.includes('ไม่มีสิทธิ์เข้าถึง')) throw new Error(t);
    });
    await d.context().close();

    // ---------- ต้นฉบับ dashboard/index.html (แก้ sources.json 404 + แกน x) ----------
    const o = await newPage();
    const before = requested.length;
    await o.goto(BASE + 'orig/#overview'); await o.waitForSelector('[data-flash]'); await settle(o);
    await o.selectOption('#srcSel', 'sample-cases'); await o.waitForSelector('[data-flash="c_n"]'); await settle(o);
    await check('dashboard/index.html: ไม่ขอ sources.json', 'ไม่มีคำขอ sources.json (เดิม 404)', async () => {
      const r = requested.slice(before).filter(u => u.includes('sources.json')); if (r.length) throw new Error(r.join(', '));
    });
    await check('dashboard/index.html: แกน x "ทั้งหมด"', 'ป้ายเดือนไม่ซ้อน, คดีทั้งหมด ' + EXP.allCounted, async () => {
      eq(num(await o.textContent('[data-flash="c_n"]')), EXP.allCounted, 'คดี');
      const a = await axis(o); if (a.some(x => x.overlaps)) throw new Error(JSON.stringify(a)); return a.map(x => x.labels + ' ป้าย').join(', ') + ' · ซ้อน 0';
    });
    await shot(o, 'orig-cases-overview-all');
    await o.context().close();
  } finally {
    await browser.close();
  }
  rec('Console error / pageerror / คำขอออกนอกเครื่อง (ทุกหน้า)', '0 รายการ', issues.length
    ? { actual: 'ไม่ผ่าน: ' + issues.slice(0, 5).join(' | '), pass: false } : { actual: '0 รายการ', pass: true });
  fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify(shots, null, 1));
  console.log('ภาพหน้าจอ:\n  ' + shots.join('\n  '));
}

module.exports = { run };
