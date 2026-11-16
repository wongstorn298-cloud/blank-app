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

async function run({ results, OUT, EXP, statsOf, botSamples, live, summ }) {
  const SHOTS = process.env.SHOT_DIR || path.join(OUT, 'shots');
  fs.mkdirSync(SHOTS, { recursive: true });
  const books = JSON.parse(fs.readFileSync(path.join(OUT, 'books.json'), 'utf8'));
  const rec = (name, expect, fn) => results.push({ group: 'หน้าเว็บ', name, expect, ...fn });
  const shots = [];

  const browser = await chromium.launch();
  const issues = [];   // console error / pageerror / คำขอที่ไม่ได้ตั้งใจ
  const requested = [];
  async function newPage(opts = {}) {
    const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, deviceScaleFactor: opts.dpr || 1.5, colorScheme: opts.scheme || 'light', timezoneId: opts.tz });
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
    if (opts.live) {   // ต่อกับโค้ดเซิร์ฟเวอร์จริง (.gs ใน mock ของ Node) แทนข้อมูลคงที่
      const { g, email } = opts.live;
      await ctx.exposeFunction('__gas', (fn, args) => {
        if (typeof fn !== 'string' || fn.endsWith('_') || typeof g[fn] !== 'function') return { err: 'Script function not found: ' + fn };
        g.__state.email = email;
        try { return { ok: JSON.parse(JSON.stringify(g[fn](...args) ?? null)) }; } catch (e) { return { err: e.message }; }
      });
      await ctx.addInitScript(() => {
        const mk = (ok, fail) => new Proxy({}, { get: (_, k) => k === 'withSuccessHandler' ? h => mk(h, fail) : k === 'withFailureHandler' ? h => mk(ok, h)
          : (...a) => { window.__gas(k, a).then(r => setTimeout(() => (r.err != null ? fail && fail(new Error(r.err)) : ok && ok(r.ok)), 20)); } });
        window.google = { script: { get run() { return mk(null, null); } } };
      });
    } else await ctx.addInitScript(b => {   // google.script.run จำลอง: ส่งผลแบบ async ผ่าน JSON เหมือนของจริง
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
      const cols = tb.head.slice(1, -1), shown = cols.filter(c => c !== 'อื่นๆ' && c !== 'ไม่ระบุ');
      let cells = 0;
      for (const r of tb.rows) {
        const name = r[0] === 'ไม่ระบุผู้ตรวจ' ? 'ไม่ระบุ' : r[0], st = off[name]; if (!st) throw new Error('ไม่พบผู้ตรวจ ' + name);
        cols.forEach((c, i) => {
          const want = c === 'ไม่ระบุ' ? (st['ไม่ระบุ'] || 0) : c === 'อื่นๆ' ? Object.entries(st).filter(([k]) => k !== 'ไม่ระบุ' && !shown.includes(k)).reduce((a, [, v]) => a + v, 0) : (st[c] || 0);
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

    // ---------- ช่วงเวลาที่เลือกเอง (ชีตคดี: ช่วงวันที่รับ · ชีตงานตรวจ: ช่วงเดือน) ----------
    {
      const RSHOT = process.env.RANGE_SHOT_DIR || SHOTS; fs.mkdirSync(RSHOT, { recursive: true });
      const rshot = async (page, name, full = true) => { const f = path.join(RSHOT, name + '.png'); await page.screenshot({ path: f, fullPage: full }); shots.push(f); };
      const TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
      const thD = ymd => { const [y, m, d] = ymd.split('-').map(Number); return `${d} ${TH[m - 1]} ${y + 543}`; };
      const rl = (s, e) => s === e ? thD(s) : thD(s) + ' – ' + thD(e);
      // วันที่รับต่ำสุด/สูงสุดของแถวที่นับในสถิติ (ใช้ตรวจการตัดช่วง)
      const ct = books.cases.tabs['ข้อมูลคดี'], ch = ct[0], ci = ch.findIndex(x => String(x).startsWith('วันที่รับ')), cc = ch.findIndex(x => String(x).startsWith('นับในสถิติ'));
      const ser = ct.slice(1).filter(r => typeof r[ci] === 'number' && r[cc] !== 0).map(r => r[ci]);
      const ymdS = x => new Date(Math.round((x - 25569) * 864e5)).toISOString().slice(0, 10), DMIN = ymdS(Math.min(...ser)), DMAX = ymdS(Math.max(...ser));
      const openPanel = async page => { if (!(await page.$('#rngPanel:not([hidden])'))) { await page.click('#rngBtn'); await page.waitForSelector('#rngPanel:not([hidden])'); } };
      const fillRange = async (page, s, e) => { await openPanel(page);
        for (const [id, v] of [['rs', s], ['re', e]]) { const [y, m, d] = v.split('-').map(Number);
          await page.selectOption(`#${id}Y`, String(y)); await page.selectOption(`#${id}M`, String(m)); await page.selectOption(`#${id}D`, String(d)); } };
      const setRange = async (page, s, e) => { await fillRange(page, s, e); await page.click('#rngPanel [data-rng="apply"]'); await page.waitForSelector('#rngPanel', { state: 'hidden' }); await settle(page); };
      const hb = (page, title) => page.$$eval('section.card', (cs, t) => { const c = cs.find(x => x.querySelector('h2')?.textContent === t);
        return c ? [...c.querySelectorAll('.hb li')].map(li => [li.querySelector('.hb-l').getAttribute('title'), +li.querySelector('b').textContent.replace(/[^\d]/g, '')]) : null; }, title);
      const sub = (page, title) => page.$$eval('section.card', (cs, t) => { const c = cs.find(x => (x.querySelector('h2')?.textContent || '').startsWith(t)); return c ? c.querySelector('.card-h p')?.textContent || '' : null; }, title);
      const pressed = page => page.$$eval('#chips .chip[aria-pressed="true"]', b => b.map(x => x.textContent));

      const r = await newPage({ tz: 'Asia/Bangkok' });
      await r.clock.setFixedTime(new Date('2026-11-16T10:00:00+07:00'));
      await r.goto(BASE + '#overview'); await r.waitForSelector('[data-flash="c_n"]'); await settle(r);
      await openPanel(r); await rshot(r, 'range-control-open', false);

      for (const [s, e, what] of [['2024-11-15', '2025-02-10', 'ข้ามปีปฏิทิน (88 วัน → รายเดือน)'], ['2025-03-05', '2025-03-14', '10 วัน (รายวัน)'], ['2023-04-01', '2023-09-30', '6 เดือนเต็ม (ข้ามปีงบ)']]) {
        const st = summ(s, e);
        await check(`ช่วงที่กำหนดเอง ${s} ถึง ${e}: ${what} = Stats.summarize`, `คดี ${st.cases}, ของกลาง ${st.evidence}, ประเภท ${st.byType.length}, ผู้ตรวจ ${st.byOfficer.length} ตรงกัน · หัวการ์ดบอกช่วง`, async () => {
          await go(r, '#overview'); await setRange(r, s, e);
          eq(num(await r.textContent('[data-flash="c_n"]')), st.cases, 'คดี'); eq(num(await r.textContent('[data-flash="c_i"]')), st.evidence, 'ของกลาง');
          const L = rl(s, e); if ((await r.textContent('#rngBtn')).trim() !== L) throw new Error('ปุ่มช่วง: ' + (await r.textContent('#rngBtn')));
          for (const t of ['ไฮไลต์', '10 คดีที่มีของกลางมากที่สุด']) { const p = await sub(r, t); if (!p || !p.includes(L)) throw new Error(`หัวการ์ด ${t}: ${p}`); }
          const unit = e === '2025-03-14' ? 'วัน' : 'เดือน', tb = await r.$$eval('section.card', (cs, u) => { const c = cs.find(x => x.querySelector('h2')?.textContent === 'สถิติราย' + u);
            return c ? [...c.querySelectorAll('tbody tr')].map(tr => +tr.cells[1].textContent.replace(/[^\d]/g, '') || 0) : null; }, unit);
          if (!tb) throw new Error('ไม่พบตาราง สถิติราย' + unit); eq(tb.reduce((a, b) => a + b, 0), st.cases, 'ผลรวมตารางราย' + unit);
          if (unit === 'วัน') eq(tb.length, 10, 'จำนวนวันในกราฟ');
          const a = await axis(r); if (a.some(x => x.overlaps)) throw new Error('ป้ายแกนซ้อน ' + JSON.stringify(a));
          await go(r, '#area');
          const ty = Object.fromEntries(await hb(r, 'ประเภทคดี')), of = Object.fromEntries(await hb(r, 'ผู้ตรวจ'));
          for (const x of st.byType) eq(ty[x.name], x.cases, 'ประเภทคดี ' + x.name); eq(Object.keys(ty).length, st.byType.length, 'จำนวนประเภท');
          for (const o of st.byOfficer) eq(of[o.name], o.cases, 'ผู้ตรวจ ' + o.name); eq(Object.keys(of).length, st.byOfficer.length, 'จำนวนผู้ตรวจ');
          if (!(await sub(r, 'ประเภทคดี')).includes(L)) throw new Error('หัวการ์ดประเภทคดีไม่บอกช่วง');
          await go(r, '#monthly');
          const ex = await r.$$eval('section.card', cs => { const c = cs.find(x => (x.querySelector('h2')?.textContent || '').startsWith('ผู้ตรวจแต่ละคนได้คดีอะไรบ้าง'));
            return [...c.querySelectorAll('tbody tr')].map(tr => [tr.cells[0].textContent.trim(), +tr.cells[tr.cells.length - 1].textContent.replace(/[^\d]/g, '')]); });
          const want = Object.fromEntries(st.byOfficer.map(o => [o.name, o.cases]));
          for (const [n, v] of ex) eq(v, want[n === 'ไม่ระบุผู้ตรวจ' ? 'ไม่ระบุ' : n], 'ผู้ตรวจ×ประเภท ' + n);
          if (!(await sub(r, 'ประเภทคดีรายเดือน')).includes(L)) throw new Error('หัวกราฟประเภทคดีรายเดือนไม่บอกช่วง');
          await go(r, '#time'); const pend = await r.$$eval('section.card', cs => cs.find(x => x.querySelector('h2')?.textContent === 'คดีที่ยังไม่รับผล').querySelector('.card-h p').textContent);
          if (!pend.includes(L)) throw new Error('งานค้างไม่บอกช่วง');
          await go(r, '#check'); if (!(await r.textContent('[data-flash="k_f"]').then(() => r.textContent('#view'))).includes(L)) throw new Error('หน้าตรวจสอบข้อมูลไม่บอกช่วง');
          await go(r, '#overview');
          return `คดี ${st.cases} · ของกลาง ${st.evidence} · ${st.byType.length} ประเภท · ${st.byOfficer.length} ผู้ตรวจ · ตาราง${unit} ${tb.length} แถว`;
        });
      }
      await setRange(r, '2025-01-01', '2025-03-31'); await rshot(r, 'range-overview');
      await check('KPI เทียบช่วงก่อนหน้าที่ยาวเท่ากัน', 'ช่วง ม.ค.–มี.ค. 2568 (เดือนเต็ม) เทียบ ต.ค.–ธ.ค. 2567 · ช่วง 10 วันเทียบ 10 วันก่อนหน้า', async () => {
        const p1 = summ('2024-10-01', '2024-12-31').cases, t1 = await r.evaluate(() => document.querySelector('[data-flash="c_l"]').closest('.kpi').textContent);
        eq(num(await r.textContent('[data-flash="c_l"]')), p1, 'ช่วงก่อนหน้า (3 เดือน)'); if (!t1.includes('1 ต.ค. 2567 – 31 ธ.ค. 2567') || !t1.includes('3 เดือน')) throw new Error(t1);
        await setRange(r, '2025-03-05', '2025-03-14'); const p2 = summ('2025-02-23', '2025-03-04').cases, t2 = await r.evaluate(() => document.querySelector('[data-flash="c_l"]').closest('.kpi').textContent);
        eq(num(await r.textContent('[data-flash="c_l"]')), p2, 'ช่วงก่อนหน้า (10 วัน)'); if (!t2.includes('23 ก.พ. 2568 – 4 มี.ค. 2568') || !t2.includes('10 วัน')) throw new Error(t2);
        return `3 เดือน: ก่อนหน้า ${p1} คดี · 10 วัน: ก่อนหน้า ${p2} คดี`;
      });
      await setRange(r, '2025-01-15', '2025-06-20'); await go(r, '#monthly'); await rshot(r, 'range-monthly');
      await check('หน้ารายเดือนกับช่วงที่ไม่ใช่เดือนเต็ม', 'เดือนในตัวเลือกมีเฉพาะ ม.ค.–มิ.ย. 2568 · หัวกราฟบอกช่วงและบอกว่าเดือนแรก/สุดท้ายนับเฉพาะวันในช่วง', async () => {
        const o = await r.$$eval('#cmSel option', x => x.map(y => y.textContent)); const m = o.slice(1).map(t => t.replace(/\s*\(.*$/, ''));
        eq(m.join(','), 'ม.ค. 2568,ก.พ. 2568,มี.ค. 2568,เม.ย. 2568,พ.ค. 2568,มิ.ย. 2568', 'เดือน'); eq(num(o[0]), summ('2025-01-15', '2025-06-20').cases, 'รวมทั้งช่วง');
        const p = await sub(r, 'ประเภทคดีรายเดือน'); if (!p.includes('เฉพาะวันในช่วง')) throw new Error(p); return o[0];
      });
      await check('ช่วงที่ไม่ถูกต้อง (วันเริ่มหลังวันสิ้นสุด)', 'ข้อความไทยบอกปัญหาและวิธีแก้ · ไม่เปลี่ยนช่วงเดิม · แผงยังเปิดอยู่', async () => {
        await go(r, '#overview'); const before = (await r.textContent('#rngBtn')).trim();
        await fillRange(r, '2025-03-14', '2025-03-05'); await r.click('#rngPanel [data-rng="apply"]'); await r.waitForSelector('#rngMsg:not([hidden])');
        const t = await r.textContent('#rngMsg'); if (!t.includes('วันเริ่มต้นอยู่หลังวันสิ้นสุด') || !t.includes('14 มี.ค. 2568 – 5 มี.ค. 2568')) throw new Error(t);
        eq((await r.textContent('#rngBtn')).trim(), before, 'ช่วงเดิม'); if (await r.$('#rngPanel[hidden]')) throw new Error('แผงปิด');
        await rshot(r, 'range-invalid', false); await r.click('#rngPanel [data-rng="close"]'); return t.trim();
      });
      await check('ตัดช่วงให้อยู่ในช่วงที่มีข้อมูล', `ตัวเลือกปีมีเฉพาะปีที่มีข้อมูลถึงปีปัจจุบัน · เลือก 1 ม.ค. 2565 – 31 ธ.ค. 2569 → ${rl(DMIN, DMAX)} = ทั้งหมด พร้อมแจ้ง`, async () => {
        const ys = await (await openPanel(r), r.$$eval('#rsY option', o => o.map(x => x.textContent))); eq(ys.join(), '2565,2566,2567,2568,2569', 'ปีในตัวเลือก');
        await setRange(r, '2022-01-01', '2026-12-31'); eq((await r.textContent('#rngBtn')).trim(), rl(DMIN, DMAX), 'ช่วงหลังตัด'); eq(num(await r.textContent('[data-flash="c_n"]')), EXP.allCounted, 'คดี');
        return (await r.textContent('#toast')).trim();
      });
      await check('ชิปปีกับช่วงที่กำหนดเองล้างกันและกัน', 'เลือกช่วง → ไม่มีชิปถูกเลือก · กดชิป 2568 → ช่วงถูกล้าง · เลือกช่วงอีก → ชิปถูกล้าง · ปุ่ม × กลับไป "ทั้งหมด"', async () => {
        await setRange(r, '2025-03-05', '2025-03-14'); eq((await pressed(r)).length, 0, 'ชิปที่ถูกเลือกขณะใช้ช่วง'); eq(await r.getAttribute('#rngBtn', 'aria-pressed'), 'true', 'ปุ่มช่วง');
        await r.click('.chip[data-y="2568"]'); await settle(r); eq((await pressed(r)).join(), '2568', 'ชิป'); eq(await r.getAttribute('#rngBtn', 'aria-pressed'), 'false', 'ปุ่มช่วงหลังกดชิป');
        eq((await r.textContent('#rngBtn')).trim(), 'กำหนดช่วงเอง', 'ข้อความปุ่ม'); eq(num(await r.textContent('[data-flash="c_n"]')), statsOf['2025'].cases, 'คดีปี 2568');
        await setRange(r, '2025-03-05', '2025-03-14'); eq((await pressed(r)).length, 0, 'ชิปหลังเลือกช่วงอีกครั้ง');
        await r.click('[data-rng="clear"]'); await settle(r); eq((await pressed(r)).join(), 'ทั้งหมด', 'หลังล้างช่วง'); eq(num(await r.textContent('[data-flash="c_n"]')), EXP.allCounted, 'คดีทั้งหมด');
      });
      await check('จำช่วงที่เลือกไว้ (localStorage) หลังเปิดหน้าใหม่', 'เปิดหน้าใหม่แล้วยังเป็นช่วงเดิม ตัวเลขเท่าเดิม', async () => {
        await setRange(r, '2024-11-15', '2025-02-10'); await r.reload(); await r.waitForSelector('[data-flash="c_n"]'); await settle(r);
        eq((await r.textContent('#rngBtn')).trim(), rl('2024-11-15', '2025-02-10'), 'ช่วงหลังเปิดใหม่'); eq(num(await r.textContent('[data-flash="c_n"]')), summ('2024-11-15', '2025-02-10').cases, 'คดี');
      });
      await check('ช่วงที่ไม่มีคดี ("เดือนนี้" วันที่ 16 พ.ย. 2569 ข้อมูลจำลองถึง ' + thD(DMAX) + ')', 'ข้อความไทยบอกช่วงและช่วงที่มีข้อมูล มีปุ่ม "เลือกช่วงใหม่" / "ดูทั้งหมด" ไม่ error', async () => {
        await openPanel(r); await r.click('#rngPanel [data-pre="month"]'); await settle(r);
        const t = await r.textContent('#view .msg.warn'); if (!t.includes('ไม่มีคดี') || !t.includes('1 พ.ย. 2569 – 16 พ.ย. 2569') || !t.includes(thD(DMAX))) throw new Error(t);
        if (!(await r.$('#view [data-rng="open"]')) || !(await r.$('#view [data-rng="clear"]'))) throw new Error('ไม่มีปุ่ม'); await rshot(r, 'range-empty', false);
        await r.click('#view [data-rng="clear"]'); await settle(r); return t.replace(/\s+/g, ' ').trim();
      });
      await r.context().close();

      // ช่วงสำเร็จรูป: ตรึง "วันนี้" ไว้ 2 วัน
      for (const [today, want] of [['2026-02-10', { month: ['2026-02-01', '2026-02-10'], prev: ['2026-01-01', '2026-01-31'], m3: ['2025-12-01', '2026-02-10'], m6: ['2025-09-01', '2026-02-10'], year: ['2026-01-01', '2026-12-31'], fy: ['2025-10-01', '2026-09-30'] }],
                                    ['2026-01-05', { month: ['2026-01-01', '2026-01-05'], prev: ['2025-12-01', '2025-12-31'], m3: ['2025-11-01', '2026-01-05'], m6: ['2025-08-01', '2026-01-05'], year: ['2026-01-01', '2026-12-31'], fy: ['2025-10-01', '2026-09-30'] }]]) {
        await check(`ช่วงสำเร็จรูป (ตรึงวันนี้ = ${thD(today)})`, Object.entries(want).map(([k, v]) => `${k} ${v[0]}…${v[1]}`).join(' · '), async () => {
          const q = await newPage({ tz: 'Asia/Bangkok' }); await q.clock.setFixedTime(new Date(today + 'T23:30:00+07:00'));
          await q.goto(BASE + '#overview'); await q.waitForSelector('[data-flash="c_n"]'); await openPanel(q);
          const got = Object.fromEntries(await q.$$eval('#rngPanel [data-pre]', b => b.map(x => [x.dataset.pre, [x.dataset.s, x.dataset.e]])));
          eq(JSON.stringify(got), JSON.stringify(want), 'ช่วงสำเร็จรูป');
          await q.click('#rngPanel [data-pre="fy"]'); await settle(q); const e = DMAX < want.fy[1] ? DMAX : want.fy[1];
          eq((await q.textContent('#rngBtn')).trim(), rl(want.fy[0], e), 'ปีงบนี้ (ตัดถึงวันสุดท้ายที่มีข้อมูล)'); eq(num(await q.textContent('[data-flash="c_n"]')), summ(want.fy[0], e).cases, 'คดีปีงบนี้');
          await openPanel(q); await q.click('#rngPanel [data-pre="prev"]'); await settle(q); eq(num(await q.textContent('[data-flash="c_n"]')), summ(...want.prev).cases, 'คดีเดือนที่แล้ว');
          await q.context().close(); return `ปีงบนี้ → ${rl(want.fy[0], e)} · เดือนที่แล้ว ${summ(...want.prev).cases} คดี`;
        });
      }

      // ไม่มี localStorage (เบราว์เซอร์บล็อก) ก็ยังใช้ได้
      await check('localStorage ใช้ไม่ได้', 'ไม่มี error · เลือกช่วงได้ตามปกติ', async () => {
        const q = await newPage(); await q.context().addInitScript(() => { const no = () => { throw new Error('blocked'); }; Storage.prototype.getItem = no; Storage.prototype.setItem = no; });
        await q.goto(BASE + '#overview'); await q.waitForSelector('[data-flash="c_n"]'); await setRange(q, '2025-03-05', '2025-03-14');
        eq(num(await q.textContent('[data-flash="c_n"]')), summ('2025-03-05', '2025-03-14').cases, 'คดี'); await q.context().close();
      });

      // มือถือ 400px + โหมดมืด
      const mq = await newPage({ viewport: { width: 400, height: 860 }, dpr: 2, tz: 'Asia/Bangkok' }); await mq.clock.setFixedTime(new Date('2026-11-16T10:00:00+07:00'));
      await mq.goto(BASE + '#overview'); await mq.waitForSelector('[data-flash="c_n"]'); await settle(mq);
      await check('มือถือ 400px: แผงเลือกช่วง', 'แผงเปิดและหลังเลือกช่วงไม่เลื่อนแนวนอน · ป้ายแกนไม่ซ้อน', async () => {
        await openPanel(mq); let sw = await mq.evaluate(() => document.documentElement.scrollWidth); if (sw > 402) throw new Error('scrollWidth ' + sw);
        await rshot(mq, 'range-mobile-panel', false);
        await setRange(mq, '2025-01-01', '2025-03-31'); sw = await mq.evaluate(() => document.documentElement.scrollWidth); if (sw > 402) throw new Error('scrollWidth ' + sw);
        const a = await axis(mq); if (a.some(x => x.overlaps)) throw new Error(JSON.stringify(a)); await rshot(mq, 'range-mobile');
      });
      await mq.context().close();
      const dk = await newPage({ scheme: 'dark' }); await dk.goto(BASE + '#overview'); await dk.waitForSelector('[data-flash="c_n"]');
      await setRange(dk, '2025-03-05', '2025-03-14'); await openPanel(dk); await rshot(dk, 'range-dark'); await dk.context().close();

      // ชีตงานตรวจ: ช่วงเดือน
      const lb = await newPage(); await lb.goto(BASE + '#overview'); await lb.waitForSelector('[data-flash="c_n"]');
      await lb.selectOption('#srcSel', 'srv-lab'); await lb.waitForSelector('[data-flash="samples"]'); await settle(lb);
      const lt = books.lab.tabs['ข้อมูลเคส'], lv = new Map(lt.slice(1).filter(x => typeof x[0] === 'number' && typeof x[1] === 'number').map(x => [x[0] * 12 + x[1] - 1, x]));
      const lsum = (a, b, col) => { let s = 0; for (let k = a; k <= b; k++) { const x = lv.get(k); if (x && typeof x[col] === 'number') s += x[col]; } return s; };
      const A = 2568 * 12 + 10, B = 2569 * 12 + 1;   // ส.ค. 2568 (ปีงบ 2568) ถึง พ.ย. 2568 (ปีงบ 2569)
      await check('ชีตงานตรวจ: ช่วงเดือน ส.ค. 2568 – พ.ย. 2568 (ข้ามปีงบ)', `ตัวอย่าง ${lsum(A, B, 5)} / ของกลาง ${lsum(A, B, 4)} = ผลรวมแท็บ ข้อมูลเคส · ปีก่อน ${lsum(A - 12, B - 12, 5)} · ชิปปีงบไม่ถูกเลือก`, async () => {
        await openPanel(lb); await lb.selectOption('#lsM', String(A)); await lb.selectOption('#leM', String(B)); await lb.click('#rngPanel [data-rng="apply"]'); await settle(lb);
        eq(num(await lb.textContent('[data-flash="samples"]')), lsum(A, B, 5), 'ตัวอย่าง'); eq(num(await lb.textContent('[data-flash="items"]')), lsum(A, B, 4), 'ของกลาง');
        const k = await lb.evaluate(() => document.querySelector('[data-flash="samples"]').closest('.kpi').textContent); if (!k.includes(String(lsum(A - 12, B - 12, 5)).replace(/\B(?=(\d{3})+(?!\d))/g, ','))) throw new Error('ปีก่อน: ' + k);
        eq((await pressed(lb)).length, 0, 'ชิปปีงบ'); eq((await lb.textContent('#rngBtn')).trim(), 'ส.ค. 2568 – พ.ย. 2568', 'ปุ่มช่วง');
        const cats = await lb.$$eval('.chart svg', s => s[0].querySelectorAll(':scope > text[text-anchor="middle"]:not(.vl)').length); eq(cats, 4, 'เดือนในกราฟ');
        await rshot(lb, 'range-lab-overview');
        await go(lb, '#budget'); const w = await lb.textContent('#view .msg.warn'); if (!w.includes('รายปีงบประมาณ') || !w.includes('ปีงบ 2569') || !w.includes('2568–2569')) throw new Error(w);
        await go(lb, '#lot'); const lp = await sub(lb, 'ตัวอย่างรายรอบ Lot'); if (!lp.includes('ส.ค. 2568 – พ.ย. 2568')) throw new Error(lp);
        return `ตัวอย่าง ${lsum(A, B, 5)} · ${w.replace(/\s+/g, ' ').slice(0, 90)}…`;
      });
      await check('ชีตงานตรวจ: ช่วงเดือนไม่ถูกต้อง / ชิปปีงบล้างช่วง', 'ข้อความ "เดือนเริ่มต้นอยู่หลังเดือนสิ้นสุด" · กดชิปปีงบแล้วช่วงถูกล้าง', async () => {
        await go(lb, '#overview'); await openPanel(lb); await lb.selectOption('#lsM', String(B)); await lb.selectOption('#leM', String(A)); await lb.click('#rngPanel [data-rng="apply"]');
        await lb.waitForSelector('#rngMsg:not([hidden])'); const t = await lb.textContent('#rngMsg'); if (!t.includes('เดือนเริ่มต้นอยู่หลังเดือนสิ้นสุด')) throw new Error(t);
        await lb.click('#rngPanel [data-rng="close"]'); await lb.click('.chip[data-y="2568"]'); await settle(lb);
        eq(await lb.getAttribute('#rngBtn', 'aria-pressed'), 'false', 'ปุ่มช่วง'); eq((await pressed(lb)).join(), '2568', 'ชิป'); return t.trim();
      });
      await lb.context().close();
    }

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

    // ---------- แหล่งข้อมูล / ผู้ใช้ ที่ผู้ดูแลจัดการ (หน้าเว็บ ↔ โค้ดเซิร์ฟเวอร์จริงใน mock) ----------
    if (live) {
      const g = live.make();
      const SRC = process.env.SRC_SHOT_DIR || SHOTS;
      const sshot = async (page, name, el) => { const f = path.join(SRC, name + '.png'); if (el) await (await page.$(el)).screenshot({ path: f }); else await page.screenshot({ path: f, fullPage: true }); shots.push(f); };
      const waitIdle = page => page.waitForFunction(() => !document.querySelector('[aria-busy="true"]')).then(() => settle(page));
      const a = await newPage({ live: { g, email: live.OWNER } });
      await a.goto(BASE + '#sources'); await a.waitForSelector('.srcs li .badge.main'); await settle(a);
      await check('ผู้ดูแล: หน้าแหล่งข้อมูล', 'มีปุ่มเพิ่ม/แก้ไข/ลบ/ตั้งชีตหลัก · ชีตหลักติดป้าย · ลบชีตหลักไม่ได้ · มีเมนู ผู้ใช้', async () => {
        const t = await a.textContent('#view'); for (const w of ['เพิ่ม Google Sheet', 'ชีตหลัก', 'แก้ไข', 'Lot พัสดุ', 'เปิดชีต']) if (!t.includes(w)) throw new Error('ไม่มี ' + w);
        const mainRow = await a.$eval('.srcs li:has(.badge.main)', li => [...li.querySelectorAll('[data-act]')].map(b => b.dataset.act));
        if (mainRow.includes('del') || mainRow.includes('main')) throw new Error('แถวชีตหลักมีปุ่ม ' + mainRow);
        if (!(await a.$('#nav a[href="#users"]'))) throw new Error('ไม่มีเมนู ผู้ใช้');
        return (await a.$$eval('.srcs li h3', h => h.map(x => x.textContent.replace(/\s+/g, ' ').trim()))).join(' | ');
      });
      await sshot(a, 'src-admin-sources');
      await check('ผู้ดูแล: เพิ่มลิงก์ชีตที่ไม่ตรงแม่แบบ', 'ผลตรวจ "ใช้ไม่ได้" ภาษาไทย · ปุ่มบันทึกยังกดไม่ได้', async () => {
        await a.click('[data-act="add"]'); await a.waitForSelector('#formCard');
        await a.fill('#mUrl', live.link(live.XID.wrong)); await a.click('#mCheck'); await a.waitForSelector('#mRes .msg'); await waitIdle(a);
        const t = await a.textContent('#mRes'); if (!t.includes('ไม่ตรงแม่แบบ')) throw new Error(t);
        if (!(await a.$eval('#mSave', b => b.disabled))) throw new Error('บันทึกได้ทั้งที่ชีตใช้ไม่ได้'); return t.slice(0, 120);
      });
      await check('ผู้ดูแล: เพิ่มแม่แบบชีต Lot พัสดุ (มีข้อมูลจำลอง)', 'ผลตรวจแสดงแท็บ/จำนวนแถว/แท็บที่ไม่มี → บันทึก → อยู่ในรายการ', async () => {
        await a.fill('#mUrl', live.link(live.XID.tLotF)); await a.fill('#mName', 'Lot พัสดุ (แม่แบบ)'); await a.click('#mCheck');
        await a.waitForSelector('#mRes .msg.ok'); await waitIdle(a);
        const rows = await a.$$eval('#mRes tbody tr', tr => tr.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
        await sshot(a, 'src-add-dialog', '#formCard');
        await a.click('#mSave'); await a.waitForFunction(() => !document.querySelector('#formCard') && document.body.textContent.includes('Lot พัสดุ (แม่แบบ)'));
        return rows.join(' | ');
      });
      await check('ผู้ดูแล: หน้าผู้ใช้ เพิ่มผู้ใช้ใหม่', 'เจ้าของปักหมุด ลบไม่ได้ · เพิ่มแล้วขึ้นในรายการทันที', async () => {
        await go(a, '#users'); await a.waitForSelector('#pList');
        await a.click('[data-act="padd"]'); await a.waitForSelector('#pCard'); await a.fill('#pEmail', 'Newcomer@Example.org'); await a.fill('#pName', 'เจ้าหน้าที่ จ'); await a.fill('#pNote', 'ทดลองงาน');
        await a.click('#pSave'); await a.waitForFunction(() => !document.querySelector('#pCard') && document.querySelector('#pList').textContent.includes('newcomer@example.org'));
        const ownerActs = await a.$eval('#pList li:first-child', li => li.querySelectorAll('[data-act]').length); if (ownerActs) throw new Error('แถวเจ้าของมีปุ่ม');
        await settle(a); return (await a.$$eval('#pList li h3', h => h.map(x => x.textContent.replace(/\s+/g, ' ').trim()))).join(' | ');
      });
      await a.waitForSelector('#toast', { state: 'hidden', timeout: 8000 }).catch(() => {}); await sshot(a, 'src-users-admins');
      await check('ผู้ดูแล: ลบเจ้าของ (เรียกเซิร์ฟเวอร์ตรง ๆ แม้ไม่มีปุ่ม)', 'เซิร์ฟเวอร์ปฏิเสธ', async () => {
        const r = await a.evaluate(o => new Promise(res => google.script.run.withSuccessHandler(() => res('ok')).withFailureHandler(e => res(e.message)).adminRemoveUser(o)), live.OWNER);
        if (r === 'ok') throw new Error('ลบได้'); return r;
      });
      await a.click('#themeBtn'); await settle(a); await sshot(a, 'src-users-dark'); await a.click('#themeBtn');
      await a.context().close();

      const u = await newPage({ live: { g, email: live.ALLOWED } });
      await u.goto(BASE + '#sources'); await u.waitForSelector('.srcs li'); await settle(u);
      await check('ผู้ใช้ทั่วไป: หน้าแหล่งข้อมูล', 'ไม่มีปุ่มผู้ดูแล ไม่มีเมนู ผู้ใช้ ไม่มีลิงก์/Sheet ID ในหน้า · เปิด #users แล้วไม่เห็นรายชื่อ', async () => {
        if (await u.$('[data-act="add"],[data-act="edit"],[data-act="main"],#nav a[href="#users"]')) throw new Error('มีปุ่ม/เมนูผู้ดูแล');
        const html = await u.evaluate(() => { const d = document.body.cloneNode(true); d.querySelectorAll('script').forEach(x => x.remove()); return d.innerHTML; }); for (const bad of ['docs.google.com', ...Object.values(live.XID), 'mock-cases-sheet-id']) if (html.includes(bad)) throw new Error('รั่ว ' + bad);
        await sshot(u, 'src-nonadmin-sources');
        await u.evaluate(() => { location.hash = '#users'; }); await settle(u); await settle(u);
        if (await u.$('#pList')) throw new Error('เห็นรายชื่อผู้ใช้');
      });
      await check('ผู้ใช้ทั่วไป: ชีตที่ยังไม่ได้รับแชร์', 'การ์ดข้อความไทยบอกชื่อชีตและให้ขอสิทธิ์ ไม่ crash', async () => {
        const opt = await u.$$eval('#srcSel option', o => o.map(x => [x.value, x.textContent])); const lab = opt.find(o => o[1] === 'งานตรวจ DNA');
        await u.evaluate(() => { location.hash = '#overview'; }); await settle(u); await u.selectOption('#srcSel', lab[0]); await u.waitForSelector('#view .msg.err'); const t = await u.textContent('#view .msg.err');
        if (!t.includes('ผู้มีสิทธิ์อ่าน') || !t.includes('งานตรวจ DNA')) throw new Error(t); return t.replace(/\s+/g, ' ').slice(0, 140);
      });
      await check('ผู้ใช้ทั่วไป: ชีต Lot พัสดุอย่างเดียว', 'เมนูมีเฉพาะ Lot พัสดุ + แหล่งข้อมูล · แจ้งแท็บที่ไม่มีเป็นภาษาไทย · กราฟมีตัวเลขกำกับ', async () => {
        const opt = await u.$$eval('#srcSel option', o => o.map(x => [x.value, x.textContent])); const lot = opt.find(o => o[1] === 'Lot พัสดุ (แม่แบบ)');
        await u.selectOption('#srcSel', lot[0]); await u.waitForSelector('#nav a[data-v="lot"]'); await u.evaluate(() => { location.hash = '#lot'; }); await u.waitForSelector('[data-flash="l_n"]'); await settle(u);
        const nav = await u.$$eval('#nav a', x => x.map(a => a.dataset.v)); if (nav.join() !== 'lot,sources') throw new Error('เมนู ' + nav);
        const w = await u.textContent('#view .msg.warn'); if (!w.includes('ไม่มีแท็บ "ข้อมูลเคส"')) throw new Error(w);
        const vl = await u.$$eval('.chart svg text.vl', t => t.length); if (!vl) throw new Error('กราฟไม่มีตัวเลขกำกับ');
        await sshot(u, 'src-lot-only'); return `เมนู ${nav.join(', ')} · ตัวเลขบนกราฟ ${vl} ป้าย`;
      });
      await u.context().close();

      const mm = await newPage({ live: { g, email: live.ADMIN2 }, viewport: { width: 390, height: 844 }, dpr: 2 });
      await mm.goto(BASE + '#sources'); await mm.waitForSelector('.srcs li .badge.main'); await settle(mm);
      await check('ผู้ดูแลคนที่ 2 บนมือถือ 390px', 'หน้าแหล่งข้อมูลและผู้ใช้ไม่เลื่อนแนวนอน · ผู้ดูแลที่ไม่ใช่เจ้าของจัดการได้', async () => {
        for (const h of ['#sources', '#users']) { await go(mm, h); if (h === '#users') await mm.waitForSelector('#pList');
          const sw = await mm.evaluate(() => document.documentElement.scrollWidth); if (sw > 392) throw new Error(h + ' scrollWidth ' + sw); }
        await mm.click('[data-act="padd"]'); await mm.waitForSelector('#pCard'); await sshot(mm, 'src-mobile-users');
      });
      await check('Q44: ผู้ดูแลที่ไม่ใช่เจ้าของ หน้าผู้ใช้', 'ไม่มีปุ่มตั้ง/เลิกผู้ดูแล · แถวผู้ดูแลไม่มีปุ่มแก้ไข/ลบ (ขึ้น "จัดการได้เฉพาะเจ้าของระบบ") · ฟอร์มไม่มีช่องติ๊กผู้ดูแล · เรียกเซิร์ฟเวอร์ตรง ๆ ก็ถูกปฏิเสธ', async () => {
        if (await mm.$('#pAdm')) throw new Error('มีช่องติ๊กผู้ดูแล');
        if (await mm.$('[data-act="mkadmin"],[data-act="unadmin"]')) throw new Error('มีปุ่มตั้ง/เลิกผู้ดูแล');
        const adminRow = await mm.$eval('#pList li:has(.badge.ok):not(:first-child)', li => [li.querySelectorAll('[data-act]').length, li.textContent]);
        if (adminRow[0] || !adminRow[1].includes('จัดการได้เฉพาะเจ้าของระบบ')) throw new Error('แถวผู้ดูแล: ' + adminRow);
        const r = await mm.evaluate(e => new Promise(res => google.script.run.withSuccessHandler(() => res('ok')).withFailureHandler(x => res(x.message)).adminSetAdmin(e, true)), live.ALLOWED);
        if (!r.includes('เฉพาะเจ้าของระบบ')) throw new Error(r); return r;
      });
      await check('Q45: ผู้ดูแลที่ไม่ใช่เจ้าของ ตั้งชีตหลัก / เพิ่มชีต', 'กด "ตั้งเป็นชีตหลัก" แล้วขึ้นคำเตือน "ต้องแชร์ชีตนี้ให้บัญชีเจ้าของระบบ … บอตจะอ่านไม่ได้" ก่อนยืนยัน · ฟอร์มเพิ่มชีตมีคำเตือนเดียวกัน · ไม่เลื่อนแนวนอน', async () => {
        await go(mm, '#sources'); await mm.click('.srcs li:has-text("คดีชุด 2") [data-act="main-ask"]'); await mm.waitForSelector('[data-act="main-cancel"]'); await settle(mm);
        const w = await mm.$eval('[data-act="main-cancel"]', b => b.closest('.msg').textContent);
        if (!w.includes('ต้องแชร์ชีตนี้ให้บัญชีเจ้าของระบบ') || !w.includes(live.OWNER) || !w.includes('บอตจะอ่านไม่ได้')) throw new Error(w);
        const sw = await mm.evaluate(() => document.documentElement.scrollWidth); if (sw > 392) throw new Error('scrollWidth ' + sw);
        await (await mm.$('[data-act="main-cancel"]')).scrollIntoViewIfNeeded(); await sshot(mm, 'src-mobile-main-warning');
        await mm.click('.srcs li:has-text("คดีชุด 2") [data-act="main"]');
        await mm.waitForFunction(() => document.querySelector('.srcs li:has(.badge.main)') && document.querySelector('.srcs li:has(.badge.main)').textContent.includes('คดีชุด 2'));
        const t = await mm.textContent('#toast'); if (!t.includes('ต้องแชร์')) throw new Error('toast: ' + t);
        await mm.click('[data-act="add"]'); await mm.waitForSelector('#formCard'); const f = await mm.textContent('#formCard');
        if (!f.includes('ต้องแชร์ชีตนี้ให้บัญชีเจ้าของระบบ')) throw new Error('ฟอร์มไม่มีคำเตือน');
        return w.replace(/\s+/g, ' ').trim().slice(0, 140);
      });
      await mm.context().close();

      const o2 = await newPage({ live: { g, email: live.OWNER } });
      await o2.goto(BASE + '#sources'); await o2.waitForSelector('.srcs li .badge.main'); await settle(o2);
      await check('SR-5: เจ้าของเห็นว่าใครเปลี่ยนชีตหลัก', 'แถบ "ชีตหลักถูกเปลี่ยนโดย admin2 เมื่อ …" + บรรทัดในแถวชีตหลัก · กดรับทราบแล้วแถบหาย (บรรทัดในแถวยังอยู่) · หน้าผู้ใช้ของเจ้าของมีปุ่มตั้ง/เลิกผู้ดูแล', async () => {
        const b = await o2.textContent('#view'); if (!b.includes('ชีตหลักถูกเปลี่ยนโดย ' + live.ADMIN2 + ' เมื่อ')) throw new Error('ไม่มีแถบแจ้ง');
        await sshot(o2, 'src-owner-main-changed');
        await o2.click('[data-act="main-ack"]'); await settle(o2);
        const b2 = await o2.textContent('#view'); if (b2.includes('ชีตหลักถูกเปลี่ยนโดย')) throw new Error('กดรับทราบแล้วยังอยู่');
        if (!b2.includes('ตั้งเป็นชีตหลักโดย ' + live.ADMIN2)) throw new Error('ไม่มีบรรทัดในแถวชีตหลัก');
        await go(o2, '#users'); await o2.waitForSelector('#pList'); if (!(await o2.$('[data-act="unadmin"]')) || !(await o2.$('[data-act="mkadmin"]'))) throw new Error('เจ้าของไม่มีปุ่มจัดการผู้ดูแล');
        await o2.click('[data-act="padd"]'); await o2.waitForSelector('#pAdm');
        return b.match(/ชีตหลักถูกเปลี่ยนโดย[^·]+/)[0].trim();
      });
      await o2.context().close();
    }
  } finally {
    await browser.close();
  }
  rec('Console error / pageerror / คำขอออกนอกเครื่อง (ทุกหน้า)', '0 รายการ', issues.length
    ? { actual: 'ไม่ผ่าน: ' + issues.slice(0, 5).join(' | '), pass: false } : { actual: '0 รายการ', pass: true });
  fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify(shots, null, 1));
  console.log('ภาพหน้าจอ:\n  ' + shots.join('\n  '));
}

module.exports = { run };
