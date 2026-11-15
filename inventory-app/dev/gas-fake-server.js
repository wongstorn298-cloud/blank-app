// Local test server: runs Code.gs unmodified against an in-memory Google Sheets fake.
//
//   node gas-fake-server.js path/to/Code.gs [port=8787] [api_key]
//
//   GET  /exec                → the app page (doGet with no action), with a
//                               google.script.run shim so it behaves like the
//                               page Apps Script serves
//   GET  /exec?action=…       → JSON API (doGet)
//   POST /exec                → JSON API (doPost)
//   POST /apiCall             → apiCall(), what google.script.run calls
//   GET  /__dump              → raw sheet contents, for tests
const fs = require('fs'), vm = require('vm'), http = require('http'), path = require('path');
const [codePath, port = 8787, apiKey = ''] = process.argv.slice(2);
const appDir = path.dirname(path.resolve(codePath));
const sheets = {};

class Sheet {
  constructor(name) { this.name = name; this.rows = []; }
  getLastRow() { return this.rows.length; }
  getMaxRows() { return 1000; }
  setFrozenRows() {}
  appendRow(a) { this.rows.push(a.map(v => typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v)); }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
}
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sh.rows[this.r - 1 + i] || [];
      out.push(Array.from({ length: this.nc }, (_, j) => row[this.c - 1 + j] ?? ''));
    }
    return out;
  }
  setValues(v) { v.forEach((row, i) => { const t = this.sh.rows[this.r - 1 + i] ||= []; row.forEach((x, j) => { t[this.c - 1 + j] = x; }); }); return this; }
  setValue(x) { const t = this.sh.rows[this.r - 1] ||= []; t[this.c - 1] = typeof x === 'string' && x.startsWith("'") ? x.slice(1) : x; return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setNumberFormat() { return this; }
  createTextFinder(text) {
    const self = this;
    return {
      matchEntireCell() { return this; },
      findNext() {
        for (let i = 0; i < self.nr; i++) {
          const row = self.sh.rows[self.r - 1 + i];
          if (row && String(row[self.c - 1]) === text) return { getRow: () => self.r + i };
        }
        return null;
      },
    };
  }
}

// What google.script.run looks like to the page, forwarded to /apiCall.
const SHIM = `<script>window.google = { script: { run: (function () {
  function runner(ok, fail) {
    return new Proxy({}, { get(_, name) {
      if (name === 'withSuccessHandler') return f => runner(f, fail);
      if (name === 'withFailureHandler') return f => runner(ok, f);
      return arg => fetch('/apiCall', { method: 'POST', body: JSON.stringify({ fn: name, arg }) })
        .then(r => r.json()).then(v => ok && ok(v)).catch(e => fail && fail(e));
    } });
  }
  return runner();
})() } };</script>`;

const ctx = vm.createContext({
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n)) }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType() { return this; }, getContent: () => s }) },
  HtmlService: {
    createHtmlOutputFromFile: name => {
      const html = fs.readFileSync(path.join(appDir, name + '.html'), 'utf8');
      return { setTitle() { return this; }, addMetaTag() { return this; }, getContent: () => html, isHtml: true };
    },
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  Logger: { log: m => console.log('[Logger]', m) },
  Utilities: { getUuid: () => 'uuid-' + Math.random(), formatDate: d => d.toISOString() },
  Date, JSON, String, Number, Math, Object,
});
vm.runInContext(fs.readFileSync(codePath, 'utf8').replace(/^const API_KEY = '';/m, `const API_KEY = '${apiKey}';`), ctx);

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const reply = (body, type = 'application/json') => { res.writeHead(200, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' }); res.end(body); };
  if (u.pathname === '/__dump') return reply(JSON.stringify(Object.fromEntries(Object.entries(sheets).map(([k, s]) => [k, s.rows]))));
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    if (u.pathname === '/apiCall') {
      const { fn, arg } = JSON.parse(body);
      return reply(JSON.stringify(ctx[fn](arg)));
    }
    if (req.method === 'GET') {
      const out = ctx.doGet({ parameter: Object.fromEntries(u.searchParams) });
      return out.isHtml ? reply(out.getContent().replace('<head>', '<head>' + SHIM), 'text/html; charset=utf-8') : reply(out.getContent());
    }
    reply(ctx.doPost({ postData: { contents: body } }).getContent());
  });
}).listen(+port, () => console.log('Apps Script fake: http://localhost:' + port + '/exec'));
