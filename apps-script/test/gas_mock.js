// mock ของบริการ Apps Script ที่ Code.gs / Stats.gs ใช้ ป้อนข้อมูลจาก fixtures (ข้อมูลจำลองเท่านั้น)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GAS_DIR = path.resolve(__dirname, '..');
const IDS = { cases: 'mock-cases-sheet-id-0000000001', lab: 'mock-lab-sheet-id-00000000000002' };   // ยาวแบบ Sheet ID จริง (≥ 25 ตัว)

function reviveGrid(grid) {
  const w = Math.max(0, ...grid.map(r => r.length));
  return grid.map(r => Array.from({ length: w }, (_, i) => {
    const v = r[i];
    if (v && typeof v === 'object' && v.$date) return new Date(v.$date + '+07:00'); // ชีตตั้งโซนเวลา Asia/Bangkok
    return v === undefined || v === null ? '' : v;
  }));
}

function htmlOutput(content) {
  const o = { content, title: '', metas: {}, xfo: null,
    setTitle(t) { o.title = t; return o; }, getTitle() { return o.title; },
    addMetaTag(n, c) { o.metas[n] = c; return o; }, getContent() { return o.content; },
    setXFrameOptionsMode(m) { o.xfo = m; return o; } };
  return o;
}

const GS_FILES = ['Stats.gs', 'Code.gs', 'Admin.gs', 'Intent.gs', 'LineBot.gs', 'Summary.gs'];
const utf8Len = s => Buffer.byteLength(String(s), 'utf8');

/**
 * สร้างสภาพแวดล้อม Apps Script จำลอง แล้วโหลดไฟล์ .gs ทั้งหมด
 * opts: { sheets, email, effectiveEmail, props, noAccess:Set<id>, dropTabs:{cases:[...]},
 *         books:{ id: { ชื่อแท็บ: grid } }   ชีตเพิ่มเติม (เช่น ชีต Lot อย่างเดียว)
 *         acl:{ id: [อีเมล] }   ถ้ามี: เปิดชีต id ได้เฉพาะบัญชีที่ทำงานอยู่ (effective user) ในรายการ
 *         fetch:(url, params) => {code, body}   ตัวตอบของ UrlFetchApp (ไม่มีเครือข่ายจริง) }
 * Script Properties จำลองเพดานจริง: ค่าละ ≤ 9 KB, รวม ≤ 500 KB (โยน Error เหมือน Apps Script)
 * state.fetches = รายการคำขอ UrlFetchApp ที่ถูกเรียก · state.logs = Logger/console
 */
function load(opts) {
  const state = { email: opts.email || '', opens: 0, caches: new Map(), fetches: [], logs: [], triggers: [], scriptCache: new Map() };
  const props = Object.assign({ CASES_SHEET_ID: IDS.cases, LAB_SHEET_ID: IDS.lab }, opts.props || {});
  for (const k of Object.keys(props)) if (props[k] == null) delete props[k];
  state.props = props;
  const books = {};
  for (const key of Object.keys(IDS)) {
    const tabs = {};
    for (const [name, grid] of Object.entries(opts.sheets[key])) {
      if (opts.dropTabs && (opts.dropTabs[key] || []).includes(name)) continue;
      tabs[name] = grid;
    }
    books[IDS[key]] = tabs;
  }
  for (const [id, tabs] of Object.entries(opts.books || {})) books[id] = tabs;
  const effective = () => ('effectiveEmail' in opts ? opts.effectiveEmail : state.email);
  state.locks = 0;
  const SpreadsheetApp = {
    openById(id) {
      state.opens++;
      if (!books[id] || (opts.noAccess && opts.noAccess.has(id)) || (opts.acl && opts.acl[id] && !opts.acl[id].includes(effective())))
        throw new Error('Exception: You do not have permission to access the requested document. (' + id + ')');
      const sheetOf = n => {
        const grid = () => reviveGrid(books[id][n]);
        const lastRow = () => { const g = grid(); let r = g.length; while (r > 0 && g[r - 1].every(v => v === '')) r--; return r; };
        return {
          getName: () => n,
          getDataRange: () => ({ getValues: grid }),
          getLastRow: lastRow,
          getLastColumn: () => Math.max(0, ...grid().map(r => { let c = r.length; while (c > 0 && r[c - 1] === '') c--; return c; })),
          getRange(r, c, nr, nc) {
            if (!(r >= 1 && c >= 1 && nr >= 1 && nc >= 1)) throw new Error('Exception: The coordinates of the range are outside the dimensions of the sheet.');
            return { getValues: () => { const g = grid(); return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((g[r - 1 + i] || [])[c - 1 + j] ?? ''))); } };
          }
        };
      };
      return {
        getSpreadsheetTimeZone: () => 'Asia/Bangkok',
        getSheets: () => Object.keys(books[id]).map(sheetOf),
        getSheetByName(n) { return n in books[id] ? sheetOf(n) : null; }
      };
    }
  };
  const cacheFor = who => {
    if (!state.caches.has(who)) state.caches.set(who, new Map());
    const m = state.caches.get(who);
    return {
      get: k => (m.has(k) ? m.get(k) : null),
      put: (k, v) => { if (String(v).length > 100000) throw new Error('value too large'); m.set(k, String(v)); },
      getAll: ks => Object.fromEntries(ks.filter(k => m.has(k)).map(k => [k, m.get(k)])),
      putAll: o => { for (const [k, v] of Object.entries(o)) { if (Buffer.byteLength(String(v)) > 100 * 1024) throw new Error('value too large'); m.set(k, String(v)); } }
    };
  };
  const log = (...a) => { state.logs.push(a.map(String).join(' ')); };
  let trigSeq = 0;
  const ctx = {
    console: { log, warn: log, error: log, info: log },
    Logger: { log },
    SpreadsheetApp,
    Session: {
      getActiveUser: () => ({ getEmail: () => state.email }),
      getEffectiveUser: () => ({ getEmail: () => ('effectiveEmail' in opts ? opts.effectiveEmail : state.email) })
    },
    PropertiesService: { getScriptProperties: () => {
      const check = next => {
        for (const [k, v] of Object.entries(next)) if (utf8Len(k) + utf8Len(v) > 9 * 1024) throw new Error('Exception: Argument too large: value (' + k + ')');
        const total = Object.entries(next).reduce((a, [k, v]) => a + utf8Len(k) + utf8Len(v), 0);
        if (total > 500 * 1024) throw new Error('Exception: You have exceeded the property storage quota.');
      };
      const store = {
        getProperty: k => (Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null),
        getProperties: () => Object.assign({}, props),
        setProperty: (k, v) => { const n = Object.assign({}, props, { [k]: String(v) }); check(n); props[k] = String(v); return store; },
        setProperties: o => { const n = Object.assign({}, props); for (const [k, v] of Object.entries(o)) n[k] = String(v); check(n); Object.assign(props, n); return store; },
        deleteProperty: k => { delete props[k]; return store; }
      };
      return store;
    } },
    CacheService: {
      getUserCache: () => cacheFor(state.email),
      getScriptCache: () => ({ get: k => (state.scriptCache.has(k) ? state.scriptCache.get(k) : null), put: (k, v) => { state.scriptCache.set(k, String(v)); } })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => { state.locks++; return !opts.lockBusy; }, waitLock: () => { state.locks++; if (opts.lockBusy) throw new Error('Exception: Lock timeout'); }, releaseLock: () => {} }) },
    ContentService: {
      MimeType: { TEXT: 'TEXT', JSON: 'JSON' },
      createTextOutput: t => { const o = { text: t, mime: null, setMimeType(m) { o.mime = m; return o; }, getContent: () => o.text }; return o; }
    },
    UrlFetchApp: {
      fetch(url, params) {
        state.fetches.push({ url, params: JSON.parse(JSON.stringify(params || {})) });
        if (!opts.fetch) throw new Error('mock UrlFetchApp: ไม่ได้ตั้งตัวตอบ (ห้ามใช้เครือข่ายจริง)');
        const r = opts.fetch(url, params);
        if (r instanceof Error) throw r;
        return { getResponseCode: () => r.code, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body || {})) };
      }
    },
    ScriptApp: {
      getProjectTriggers: () => state.triggers.slice(),
      deleteTrigger: t => { state.triggers = state.triggers.filter(x => x !== t); },
      newTrigger(fn) {
        const spec = { fn };
        const b = { timeBased: () => b, everyDays: n => { spec.everyDays = n; return b; }, atHour: h => { spec.atHour = h; return b; },
          inTimezone: z => { spec.tz = z; return b; },
          create: () => { const id = 'trig-' + (++trigSeq); const t = { spec, getUniqueId: () => id, getHandlerFunction: () => fn }; state.triggers.push(t); return t; } };
        return b;
      }
    },
    HtmlService: {
      createHtmlOutputFromFile: name => htmlOutput(fs.readFileSync(path.join(GAS_DIR, name + '.html'), 'utf8')),
      createHtmlOutput: html => htmlOutput(html)
    },
    Utilities: {
      getUuid: () => require('crypto').randomUUID(),
      DigestAlgorithm: { MD5: 'md5' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(require('crypto').createHash(alg).update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      formatDate(d, tz, fmt) {
        if (fmt !== 'yyyy-MM-dd-HH-mm-ss') throw new Error('mock formatDate: unsupported ' + fmt);
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
        return `${p.year}-${p.month}-${p.day}-${p.hour}-${p.minute}-${p.second}`;
      }
    }
  };
  vm.createContext(ctx);
  for (const f of GS_FILES) vm.runInContext(fs.readFileSync(path.join(GAS_DIR, f), 'utf8'), ctx, { filename: f });
  ctx.__state = state;
  ctx.__opts = opts;   // ทดสอบเปลี่ยน acl / noAccess ระหว่างทางได้
  // จำลอง google.script.run: ส่งผ่าน JSON (Date ส่งไม่ได้ ต้องไม่มีในผลลัพธ์)
  ctx.__call = (fn, ...args) => JSON.parse(JSON.stringify(ctx[fn](...args)));
  return ctx;
}

module.exports = { load, IDS, GAS_DIR, GS_FILES };
