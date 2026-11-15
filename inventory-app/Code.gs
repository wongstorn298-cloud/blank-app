/**
 * Google Apps Script — ระบบคลังน้ำยาและบำรุงรักษาเครื่องมือ
 * กลุ่มงานตรวจชีววิทยาและดีเอ็นเอ ศูนย์พิสูจน์หลักฐาน 3
 * =====================================================
 * This one script does two jobs:
 *   1. Opening the Web App URL with no parameters serves the app itself
 *      (the HTML file named "index" in this project). Pages served this way
 *      talk to the sheet through google.script.run → apiCall(), so phones
 *      need no URL or key setup.
 *   2. The same URL is also a JSON API (below) for a copy of index.html
 *      hosted somewhere else.
 *
 * Three sheets, three roles:
 *
 *   Equipment_Master  one row per item (the only sheet whose rows are edited)
 *   Transactions      append-only stock movements: never edited, never deleted
 *   Maintenance_Log   one row per repair ticket (only Status / Updated_At change)
 *
 * Balances are never stored. Opening / In / Out / Closing are computed from
 * Transactions for whatever date range is asked, so old rows never need to be
 * deleted to keep the numbers right.
 *
 * JSON API (deploy as Web App, see MANUAL-TH.md):
 *   GET  (no action)             the app page
 *   GET  ?action=sync&txFrom=N   master + repairs + Transactions rows after the first N
 *   GET  ?action=report&start=YYYY-MM-DD&end=YYYY-MM-DD   per-item balances, computed here
 *   GET  ?action=ping
 *   POST {action, key, data}     addEquipment | updateEquipment | addTx | addRepair | updateRepair
 *
 * POST bodies are sent as text/plain JSON so the browser skips the CORS preflight.
 */

// รหัสลับสำหรับเรียก JSON API จากที่อื่น (เช่น index.html ที่ฝากไว้บนเว็บอื่น)
// ไม่มีผลกับแอปที่เปิดจากลิงก์ Web App โดยตรง  เว้นว่าง '' เพื่อปิดการตรวจ
const API_KEY = '';
const APP_TITLE = 'ระบบคลังน้ำยาและบำรุงรักษาเครื่องมือ';
const WRITE_ACTIONS = ['addEquipment', 'updateEquipment', 'addTx', 'addRepair', 'updateRepair'];

const SHEETS = {
  master: {
    name: 'Equipment_Master',
    cols: ['Equipment_ID', 'Material_Name', 'Category', 'Unit', 'Min_Stock_Alert', 'Expiration_Date', 'Next_Maintenance_Date', 'Updated_At'],
    numeric: ['Min_Stock_Alert'],
  },
  tx: {
    name: 'Transactions',
    cols: ['Transaction_ID', 'Timestamp', 'Equipment_ID', 'Type', 'Quantity', 'Requester', 'Notes'],
    numeric: ['Quantity'],
  },
  repair: {
    name: 'Maintenance_Log',
    cols: ['Repair_ID', 'Timestamp', 'Equipment_ID', 'Issue_Description', 'Reporter', 'Status', 'Updated_At'],
    numeric: [],
  },
};

const CATEGORIES = ['สิ้นเปลือง', 'ทรัพย์สินถาวร'];
const STATUSES = ['รอดำเนินการ', 'กำลังซ่อม', 'ซ่อมเสร็จแล้ว'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$/;
const EDITABLE_MASTER = ['Material_Name', 'Category', 'Unit', 'Min_Stock_Alert', 'Expiration_Date', 'Next_Maintenance_Date'];

/**
 * Run once from the editor after importing the starter spreadsheet (or on an
 * empty one): creates any missing sheet, checks the headers, and formats the
 * id/date/timestamp columns as plain text.
 */
function setup() {
  Object.keys(SHEETS).forEach(function (k) {
    const def = SHEETS[k], sh = sheet_(k);
    const head = sh.getRange(1, 1, 1, def.cols.length).getValues()[0].map(String);
    if (head.join('|') !== def.cols.join('|')) throw new Error('หัวตารางของชีต ' + def.name + ' ไม่ตรง ต้องเป็น: ' + def.cols.join(', '));
    textFormat_(sh, def);
  });
  Logger.log('พร้อมใช้งาน: ' + Object.keys(SHEETS).map(function (k) { return SHEETS[k].name + ' ' + dataRows_(k) + ' แถว'; }).join(', '));
}

/* ================================================================== */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!p.action) {
    return HtmlService.createHtmlOutputFromFile('index')
      .setTitle(APP_TITLE)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  }
  try {
    checkKey_(p.key);
    if (WRITE_ACTIONS.indexOf(p.action) >= 0) throw new Error('คำสั่งเขียนข้อมูลต้องส่งแบบ POST');
    return json_(route_(p.action, p, {}));
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    checkKey_(body.key);
    return json_(route_(body.action, body, body.data || {}));
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

/**
 * Called by the app page through google.script.run. Whoever can open the
 * Web App URL can already use the app, so no key is checked here.
 */
function apiCall(req) {
  try {
    req = req || {};
    return route_(req.action, req, req.data || {});
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/** One router for doGet, doPost and apiCall. Writes run under a script lock. */
function route_(action, p, d) {
  if (WRITE_ACTIONS.indexOf(action) < 0) {
    switch (action) {
      case 'ping': return { ok: true };
      case 'sync': return sync_(Math.max(0, parseInt(p.txFrom, 10) || 0));
      case 'report': return report_(p.start, p.end);
      default: throw new Error('ไม่รู้จักคำสั่ง: ' + action);
    }
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    switch (action) {
      case 'addEquipment': return addEquipment_(d);
      case 'updateEquipment': return updateEquipment_(d);
      case 'addTx': return addTx_(d);
      case 'addRepair': return addRepair_(d);
      default: return updateRepair_(d);
    }
  } finally {
    lock.releaseLock();
  }
}

/* ============================ reads =============================== */

/**
 * Incremental sync. Transactions is append-only, so a client that already
 * holds the first N rows only needs the rows after N. If the sheet now has
 * fewer rows than the client thinks (someone deleted rows by hand), the full
 * log is sent and reset=true tells the client to replace its copy.
 */
function sync_(txFrom) {
  const total = dataRows_('tx');
  let reset = false;
  if (txFrom > total) { txFrom = 0; reset = true; }
  return {
    ok: true,
    master: readRows_('master', 0),
    repairs: readRows_('repair', 0),
    tx: readRows_('tx', txFrom),
    txFrom: txFrom,
    txTotal: total,
    reset: reset,
    serverTime: new Date().toISOString(),
  };
}

/** Server-side balances for a date range (for other tools, or very large logs). */
function report_(start, end) {
  if (!DATE_RE.test(String(start || '')) || !DATE_RE.test(String(end || ''))) throw new Error('start และ end ต้องอยู่ในรูปแบบ YYYY-MM-DD');
  if (start > end) { const t = start; start = end; end = t; }
  const rows = {};
  readRows_('master', 0).forEach(function (m) {
    rows[m.Equipment_ID] = { Equipment_ID: m.Equipment_ID, Material_Name: m.Material_Name, Unit: m.Unit, Min_Stock_Alert: m.Min_Stock_Alert, Opening: 0, In: 0, Out: 0, Closing: 0 };
  });
  readRows_('tx', 0).forEach(function (t) {
    const r = rows[t.Equipment_ID];
    if (!r) return;
    const day = String(t.Timestamp).slice(0, 10), q = Number(t.Quantity) || 0, sign = t.Type === 'OUT' ? -1 : 1;
    if (day < start) r.Opening += sign * q;
    else if (day <= end) { if (t.Type === 'OUT') r.Out += q; else r.In += q; }
  });
  const list = Object.keys(rows).map(function (k) { const r = rows[k]; r.Closing = r.Opening + r.In - r.Out; return r; });
  return { ok: true, start: start, end: end, rows: list };
}

/* ============================ writes ============================== */

function addEquipment_(d) {
  const name = text_(d.Material_Name, 200);
  if (!name) throw new Error('กรุณาระบุชื่อวัสดุ/อุปกรณ์');
  const master = readRows_('master', 0);
  const same = master.filter(function (m) { return norm_(m.Material_Name) === norm_(name); })[0];
  if (same) return { ok: true, id: same.Equipment_ID, duplicate: true };

  const row = {
    Equipment_ID: nextEquipmentId_(master),
    Material_Name: name,
    Category: category_(d.Category),
    Unit: text_(d.Unit, 30) || 'ชิ้น',
    Min_Stock_Alert: wholeNumber_(d.Min_Stock_Alert, 'จุดเตือนสต็อกขั้นต่ำ'),
    Expiration_Date: optDate_(d.Expiration_Date, 'วันหมดอายุ'),
    Next_Maintenance_Date: optDate_(d.Next_Maintenance_Date, 'วันครบกำหนดบำรุงรักษา'),
    Updated_At: new Date().toISOString(),
  };
  append_('master', row);
  return { ok: true, id: row.Equipment_ID };
}

function updateEquipment_(d) {
  const id = String(d.Equipment_ID || '');
  const sh = sheet_('master');
  const r = findRow_(sh, id);
  if (!r) throw new Error('ไม่พบอุปกรณ์รหัส ' + id);
  const cols = SHEETS.master.cols;
  const clean = {
    Material_Name: function (v) { const s = text_(v, 200); if (!s) throw new Error('ชื่อวัสดุห้ามว่าง'); return s; },
    Category: category_,
    Unit: function (v) { return text_(v, 30) || 'ชิ้น'; },
    Min_Stock_Alert: function (v) { return wholeNumber_(v, 'จุดเตือนสต็อกขั้นต่ำ'); },
    Expiration_Date: function (v) { return optDate_(v, 'วันหมดอายุ'); },
    Next_Maintenance_Date: function (v) { return optDate_(v, 'วันครบกำหนดบำรุงรักษา'); },
  };
  EDITABLE_MASTER.forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(d, k)) sh.getRange(r, cols.indexOf(k) + 1).setValue(clean[k](d[k]));
  });
  sh.getRange(r, cols.indexOf('Updated_At') + 1).setValue(new Date().toISOString());
  return { ok: true };
}

function addTx_(d) {
  const id = text_(d.Transaction_ID, 60);
  if (!id) throw new Error('ไม่มี Transaction_ID');
  const sh = sheet_('tx');
  if (findRow_(sh, id)) return { ok: true, duplicate: true };

  const eqId = String(d.Equipment_ID || '');
  if (!findRow_(sheet_('master'), eqId)) throw new Error('ไม่พบอุปกรณ์รหัส ' + eqId + ' ในทะเบียน');
  const type = d.Type === 'OUT' ? 'OUT' : d.Type === 'IN' ? 'IN' : '';
  if (!type) throw new Error('Type ต้องเป็น IN หรือ OUT');
  const qty = Number(d.Quantity);
  if (!(qty > 0) || Math.floor(qty) !== qty) throw new Error('จำนวนต้องเป็นจำนวนเต็มมากกว่า 0');
  const stamp = String(d.Timestamp || '');
  if (!STAMP_RE.test(stamp)) throw new Error('Timestamp ไม่ถูกต้อง');
  const requester = text_(d.Requester, 100);
  if (!requester) throw new Error('กรุณาระบุผู้เบิก/ผู้บันทึก');
  if (type === 'OUT') {
    const bal = balance_(eqId);
    if (qty > bal) throw new Error('ยอดคงเหลือไม่พอ: ' + eqId + ' คงเหลือ ' + bal);
  }
  append_('tx', { Transaction_ID: id, Timestamp: stamp, Equipment_ID: eqId, Type: type, Quantity: qty, Requester: requester, Notes: text_(d.Notes, 300) });
  return { ok: true };
}

function addRepair_(d) {
  const id = text_(d.Repair_ID, 60);
  if (!id) throw new Error('ไม่มี Repair_ID');
  const sh = sheet_('repair');
  if (findRow_(sh, id)) return { ok: true, duplicate: true };
  const eqId = String(d.Equipment_ID || '');
  if (!findRow_(sheet_('master'), eqId)) throw new Error('ไม่พบอุปกรณ์รหัส ' + eqId + ' ในทะเบียน');
  const stamp = String(d.Timestamp || '');
  if (!STAMP_RE.test(stamp)) throw new Error('Timestamp ไม่ถูกต้อง');
  const issue = text_(d.Issue_Description, 1000);
  if (!issue) throw new Error('กรุณาระบุอาการเสีย');
  const reporter = text_(d.Reporter, 100);
  if (!reporter) throw new Error('กรุณาระบุผู้แจ้งซ่อม');
  append_('repair', {
    Repair_ID: id, Timestamp: stamp, Equipment_ID: eqId, Issue_Description: issue, Reporter: reporter,
    Status: STATUSES.indexOf(d.Status) >= 0 ? d.Status : STATUSES[0], Updated_At: '',
  });
  return { ok: true };
}

function updateRepair_(d) {
  if (STATUSES.indexOf(d.Status) < 0) throw new Error('สถานะไม่ถูกต้อง');
  const sh = sheet_('repair');
  const r = findRow_(sh, String(d.Repair_ID || ''));
  if (!r) throw new Error('ไม่พบใบแจ้งซ่อม ' + d.Repair_ID);
  const cols = SHEETS.repair.cols;
  sh.getRange(r, cols.indexOf('Status') + 1).setValue(d.Status);
  sh.getRange(r, cols.indexOf('Updated_At') + 1).setValue(new Date().toISOString());
  return { ok: true };
}

/* ============================ helpers ============================= */

function checkKey_(key) {
  if (API_KEY && key !== API_KEY) throw new Error('รหัสลับไม่ถูกต้อง');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_(key) {
  const def = SHEETS[key];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(def.name);
  if (!sh) sh = ss.insertSheet(def.name);
  if (sh.getLastRow() === 0) {
    const n = def.cols.length;
    sh.getRange(1, 1, 1, n).setValues([def.cols]).setFontWeight('bold').setBackground('#e1f0ef');
    sh.setFrozenRows(1);
    textFormat_(sh, def);
  }
  return sh;
}

/** ids, dates and timestamps stay plain text so the sheet locale cannot reformat them */
function textFormat_(sh, def) {
  def.cols.forEach(function (c, i) {
    if (def.numeric.indexOf(c) < 0) sh.getRange(2, i + 1, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@');
  });
}

function dataRows_(key) {
  return Math.max(0, sheet_(key).getLastRow() - 1);
}

/** Rows as objects keyed by header, skipping the first `skip` data rows. */
function readRows_(key, skip) {
  const def = SHEETS[key], sh = sheet_(key), total = dataRows_(key);
  if (total <= skip) return [];
  const tz = Session.getScriptTimeZone();
  const values = sh.getRange(2 + skip, 1, total - skip, def.cols.length).getValues();
  const out = [];
  values.forEach(function (row) {
    if (row[0] === '' || row[0] === null) return;
    const o = {};
    def.cols.forEach(function (c, i) {
      let v = row[i];
      if (v instanceof Date) {
        v = /Timestamp|Updated_At/.test(c) ? Utilities.formatDate(v, tz, "yyyy-MM-dd'T'HH:mm:ss") : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
      }
      if (def.numeric.indexOf(c) >= 0) o[c] = Number(v) || 0;
      else o[c] = v === null || v === undefined ? '' : String(v);
    });
    out.push(o);
  });
  return out;
}

function append_(key, obj) {
  sheet_(key).appendRow(SHEETS[key].cols.map(function (c) { return obj[c] === undefined ? '' : obj[c]; }));
}

/** 1-based row whose first column equals id exactly, or 0. */
function findRow_(sh, id) {
  if (!id || sh.getLastRow() < 2) return 0;
  const hit = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

/** Current balance of one item: sum of IN minus OUT over the whole log. */
function balance_(eqId) {
  const n = dataRows_('tx');
  if (!n) return 0;
  const cols = SHEETS.tx.cols, c0 = cols.indexOf('Equipment_ID') + 1;
  const vals = sheet_('tx').getRange(2, c0, n, 3).getValues(); // Equipment_ID, Type, Quantity
  let bal = 0;
  vals.forEach(function (r) { if (String(r[0]) === eqId) bal += (r[1] === 'OUT' ? -1 : 1) * (Number(r[2]) || 0); });
  return bal;
}

function nextEquipmentId_(master) {
  let max = 0;
  master.forEach(function (m) { const k = /^EQ-(\d+)$/.exec(m.Equipment_ID); if (k) max = Math.max(max, parseInt(k[1], 10)); });
  const n = String(max + 1);
  return 'EQ-' + (n.length < 3 ? ('000' + n).slice(-3) : n);
}

function norm_(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

/** Plain text only: a leading = + - @ would otherwise run as a formula. */
function text_(v, max) {
  let s = String(v === undefined || v === null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, max || 300);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function optDate_(v, label) {
  const s = String(v || '');
  if (s && !DATE_RE.test(s)) throw new Error(label + ' ต้องอยู่ในรูปแบบ YYYY-MM-DD');
  return s;
}

function wholeNumber_(v, label) {
  const n = Number(v || 0);
  if (!(n >= 0) || Math.floor(n) !== n) throw new Error(label + ' ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป');
  return n;
}

function category_(v) {
  return CATEGORIES.indexOf(v) >= 0 ? v : CATEGORIES[0];
}
