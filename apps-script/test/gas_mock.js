// mock ของบริการ Apps Script ที่ Code.gs / Stats.gs ใช้ ป้อนข้อมูลจาก fixtures (ข้อมูลจำลองเท่านั้น)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GAS_DIR = path.resolve(__dirname, '..');
const IDS = { cases: 'mock-cases-sheet-id', lab: 'mock-lab-sheet-id' };

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

/**
 * สร้างสภาพแวดล้อม Apps Script จำลอง แล้วโหลด Stats.gs + Code.gs
 * opts: { sheets, email, props, noAccess:Set<id>, dropTabs:{cases:[...]} }
 */
function load(opts) {
  const state = { email: opts.email || '', opens: 0, caches: new Map() };
  const props = Object.assign({ CASES_SHEET_ID: IDS.cases, LAB_SHEET_ID: IDS.lab }, opts.props || {});
  const books = {};
  for (const key of Object.keys(IDS)) {
    const tabs = {};
    for (const [name, grid] of Object.entries(opts.sheets[key])) {
      if (opts.dropTabs && (opts.dropTabs[key] || []).includes(name)) continue;
      tabs[name] = grid;
    }
    books[IDS[key]] = tabs;
  }
  const SpreadsheetApp = {
    openById(id) {
      state.opens++;
      if (!books[id] || (opts.noAccess && opts.noAccess.has(id))) throw new Error('Exception: You do not have permission to access the requested document.');
      return {
        getSpreadsheetTimeZone: () => 'Asia/Bangkok',
        getSheetByName(n) {
          if (!(n in books[id])) return null;
          return { getDataRange: () => ({ getValues: () => reviveGrid(books[id][n]) }) };
        }
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
  const ctx = {
    console,
    Logger: { log: () => {} },
    SpreadsheetApp,
    Session: { getActiveUser: () => ({ getEmail: () => state.email }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) }) },
    CacheService: { getUserCache: () => cacheFor(state.email) },
    HtmlService: {
      createHtmlOutputFromFile: name => htmlOutput(fs.readFileSync(path.join(GAS_DIR, name + '.html'), 'utf8')),
      createHtmlOutput: html => htmlOutput(html)
    },
    Utilities: {
      formatDate(d, tz, fmt) {
        if (fmt !== 'yyyy-MM-dd-HH-mm-ss') throw new Error('mock formatDate: unsupported ' + fmt);
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
        return `${p.year}-${p.month}-${p.day}-${p.hour}-${p.minute}-${p.second}`;
      }
    }
  };
  vm.createContext(ctx);
  for (const f of ['Stats.gs', 'Code.gs']) vm.runInContext(fs.readFileSync(path.join(GAS_DIR, f), 'utf8'), ctx, { filename: f });
  ctx.__state = state;
  // จำลอง google.script.run: ส่งผ่าน JSON (Date ส่งไม่ได้ ต้องไม่มีในผลลัพธ์)
  ctx.__call = (fn, ...args) => JSON.parse(JSON.stringify(ctx[fn](...args)));
  return ctx;
}

module.exports = { load, IDS, GAS_DIR };
