// Local test server: runs Code.gs against an in-memory Google Sheets fake.
// Usage: node gas-fake-server.js path/to/Code.gs [port=8787] [api_key]
const fs = require('fs'), vm = require('vm'), http = require('http');
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
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = this.sh.rows[this.r - 1 + i] || []; out.push(Array.from({ length: this.nc }, (_, j) => row[this.c - 1 + j] ?? '')); } return out; }
  setValues(v) { v.forEach((row, i) => { const t = this.sh.rows[this.r - 1 + i] ||= []; row.forEach((x, j) => t[this.c - 1 + j] = x); }); return this; }
  setValue(x) { const t = this.sh.rows[this.r - 1] ||= []; t[this.c - 1] = typeof x === 'string' && x.startsWith("'") ? x.slice(1) : x; return this; }
  setFontWeight() { return this; } setBackground() { return this; } setNumberFormat() { return this; }
  createTextFinder(text) { const self = this; return { matchEntireCell() { return this; }, findNext() {
    for (let i = 0; i < self.nr; i++) { const row = self.sh.rows[self.r - 1 + i]; if (row && String(row[self.c - 1]) === text) return { getRow: () => self.r + i }; } return null; } }; }
}
const ctx = vm.createContext({
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n)) }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType() { return this; }, getContent: () => s }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  Utilities: { getUuid: () => 'uuid-' + Math.random(), formatDate: d => d.toISOString() },
  Date, JSON, String, Number, Math, Object,
});
vm.runInContext(fs.readFileSync(process.argv[2], 'utf8').replace(/^const API_KEY = '';/m, `const API_KEY = '${process.argv[4] || ''}';`), ctx);
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = out => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(out.getContent()); };
  if (u.pathname === '/__dump') { res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); return res.end(JSON.stringify(Object.fromEntries(Object.entries(sheets).map(([k, s]) => [k, s.rows])))); }
  if (req.method === 'GET') return send(ctx.doGet({ parameter: Object.fromEntries(u.searchParams) }));
  let body = ''; req.on('data', c => body += c); req.on('end', () => send(ctx.doPost({ postData: { contents: body } })));
}).listen(+(process.argv[3] || 8787), () => console.log('Apps Script fake: http://localhost:' + (process.argv[3] || 8787) + '/exec'));
