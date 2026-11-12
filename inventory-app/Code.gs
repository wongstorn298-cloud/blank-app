/**
 * Google Apps Script backend for "คลังน้ำยาแล็บ DNA"
 * ---------------------------------------------------
 * - doGet  ?action=list&key=...  → returns every stock transaction and repair as JSON
 * - doPost {action, key, data}   → addTx | addRepair | updateRepair
 *
 * Two sheets are created automatically (run setup() once):
 *   "รายการสต็อก"  one row per stock in/out
 *   "แจ้งซ่อม"     one row per repair / maintenance request
 *
 * Download as Excel any time: File → Download → Microsoft Excel (.xlsx)
 */

// รหัสลับ (ไม่บังคับแต่แนะนำ) ต้องตรงกับช่อง "รหัสลับ" ในหน้าตั้งค่าของแอป
// เว้นว่าง '' เพื่อปิดการตรวจรหัส
const API_KEY = '';

const TX_SHEET = {
  name: 'รายการสต็อก',
  cols: [
    ['id', 'รหัสรายการ'],
    ['timestamp', 'บันทึกเมื่อ'],
    ['date', 'วันที่ทำรายการ'],
    ['material', 'ชื่อวัสดุ'],
    ['type', 'ประเภทรายการ'],
    ['qty', 'จำนวน'],
    ['person', 'ผู้แจ้งเบิก/ผู้บันทึก'],
    ['expiry', 'วันหมดอายุ'],
    ['maintenance', 'วันครบกำหนดบำรุงรักษา'],
    ['note', 'หมายเหตุ'],
  ],
};

const REPAIR_SHEET = {
  name: 'แจ้งซ่อม',
  cols: [
    ['id', 'รหัสรายการ'],
    ['timestamp', 'บันทึกเมื่อ'],
    ['date', 'วันที่แจ้งซ่อม'],
    ['equipment', 'ชื่อวัสดุ/อุปกรณ์'],
    ['issue', 'อาการเสีย/สาเหตุ'],
    ['reporter', 'ผู้แจ้งซ่อม'],
    ['status', 'สถานะการซ่อม'],
    ['updatedAt', 'อัปเดตล่าสุด'],
  ],
};

const TYPE_TO_TH = { IN: 'รับเข้า', OUT: 'เบิกออก' };
const STATUSES = ['รอดำเนินการ', 'กำลังซ่อม', 'ซ่อมเสร็จแล้ว'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Run once from the editor: creates both sheets with Thai headers. */
function setup() {
  getSheet_(TX_SHEET);
  getSheet_(REPAIR_SHEET);
}

/* ------------------------------------------------------------------ */

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    checkKey_(p.key);
    const action = p.action || 'list';
    if (action === 'ping') return json_({ ok: true });
    if (action !== 'list') throw new Error('ไม่รู้จักคำสั่ง: ' + action);

    const tx = readRows_(TX_SHEET).map(function (r) {
      r.type = r.type === 'เบิกออก' || r.type === 'OUT' ? 'OUT' : 'IN';
      r.qty = Number(r.qty) || 0;
      return r;
    });
    const repairs = readRows_(REPAIR_SHEET);
    return json_({ ok: true, tx: tx, repairs: repairs });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    checkKey_(body.key);
    lock.waitLock(20000);
    const d = body.data || {};

    switch (body.action) {
      case 'addTx': {
        const row = validateTx_(d);
        const sh = getSheet_(TX_SHEET);
        if (findRow_(sh, row.id)) return json_({ ok: true, duplicate: true });
        appendObj_(sh, TX_SHEET, row);
        return json_({ ok: true });
      }
      case 'addRepair': {
        const row = validateRepair_(d);
        const sh = getSheet_(REPAIR_SHEET);
        if (findRow_(sh, row.id)) return json_({ ok: true, duplicate: true });
        appendObj_(sh, REPAIR_SHEET, row);
        return json_({ ok: true });
      }
      case 'updateRepair': {
        const status = String(d.status || '');
        if (STATUSES.indexOf(status) < 0) throw new Error('สถานะไม่ถูกต้อง');
        const sh = getSheet_(REPAIR_SHEET);
        const r = findRow_(sh, String(d.id || ''));
        if (!r) throw new Error('ไม่พบรายการแจ้งซ่อม id: ' + d.id);
        const colOf = function (k) { return REPAIR_SHEET.cols.map(function (c) { return c[0]; }).indexOf(k) + 1; };
        sh.getRange(r, colOf('status')).setValue(status);
        sh.getRange(r, colOf('updatedAt')).setValue(new Date().toISOString());
        return json_({ ok: true });
      }
      default:
        throw new Error('ไม่รู้จักคำสั่ง: ' + body.action);
    }
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) { /* lock was never taken */ }
  }
}

/* ------------------------------------------------------------------ */

function checkKey_(key) {
  if (API_KEY && key !== API_KEY) throw new Error('รหัสลับไม่ถูกต้อง');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet_(def) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(def.name);
  if (!sh) sh = ss.insertSheet(def.name);
  if (sh.getLastRow() === 0) {
    const n = def.cols.length;
    sh.getRange(1, 1, 1, n).setValues([def.cols.map(function (c) { return c[1]; })]).setFontWeight('bold').setBackground('#e1f0ef');
    sh.setFrozenRows(1);
    // keep dates and ids as plain text so they are not reformatted by the sheet locale
    def.cols.forEach(function (c, i) {
      if (c[0] !== 'qty') sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    });
    sh.autoResizeColumns(1, n);
  }
  return sh;
}

function readRows_(def) {
  const sh = getSheet_(def);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const tz = Session.getScriptTimeZone();
  const values = sh.getRange(2, 1, last - 1, def.cols.length).getValues();
  return values
    .filter(function (row) { return row[0] !== '' && row[0] !== null; })
    .map(function (row) {
      const o = {};
      def.cols.forEach(function (c, i) {
        let v = row[i];
        if (v instanceof Date) v = Utilities.formatDate(v, tz, c[0] === 'timestamp' || c[0] === 'updatedAt' ? "yyyy-MM-dd'T'HH:mm:ss" : 'yyyy-MM-dd');
        o[c[0]] = v === null || v === undefined ? '' : (c[0] === 'qty' ? v : String(v));
      });
      return o;
    });
}

function appendObj_(sh, def, obj) {
  sh.appendRow(def.cols.map(function (c) { return obj[c[0]] === undefined ? '' : obj[c[0]]; }));
}

/** Returns the 1-based row number whose column A equals id, or 0. */
function findRow_(sh, id) {
  if (!id || sh.getLastRow() < 2) return 0;
  const hit = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

/** Plain text only: a leading = + - @ would otherwise be run as a formula. */
function text_(v, max) {
  let s = String(v === undefined || v === null ? '' : v).trim().slice(0, max || 300);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function optDate_(v, label) {
  const s = String(v || '');
  if (s && !DATE_RE.test(s)) throw new Error(label + ' ต้องอยู่ในรูปแบบ YYYY-MM-DD');
  return s;
}

function validateTx_(d) {
  const type = d.type === 'OUT' ? 'OUT' : d.type === 'IN' ? 'IN' : '';
  if (!type) throw new Error('ประเภทรายการต้องเป็น IN หรือ OUT');
  const qty = Number(d.qty);
  if (!(qty >= 0) || Math.floor(qty) !== qty) throw new Error('จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป');
  const material = text_(d.material, 200);
  if (!material) throw new Error('กรุณาระบุชื่อวัสดุ');
  if (!DATE_RE.test(String(d.date || ''))) throw new Error('วันที่ทำรายการไม่ถูกต้อง');
  const person = text_(d.person, 100);
  if (!person) throw new Error('กรุณาระบุผู้แจ้งเบิก/ผู้บันทึก');
  return {
    id: text_(d.id, 60) || Utilities.getUuid(),
    timestamp: text_(d.timestamp, 40) || new Date().toISOString(),
    date: d.date,
    material: material,
    type: TYPE_TO_TH[type],
    qty: qty,
    person: person,
    expiry: optDate_(d.expiry, 'วันหมดอายุ'),
    maintenance: optDate_(d.maintenance, 'วันครบกำหนดบำรุงรักษา'),
    note: text_(d.note, 300),
  };
}

function validateRepair_(d) {
  const equipment = text_(d.equipment, 200);
  if (!equipment) throw new Error('กรุณาระบุชื่อวัสดุ/อุปกรณ์');
  if (!DATE_RE.test(String(d.date || ''))) throw new Error('วันที่แจ้งซ่อมไม่ถูกต้อง');
  const issue = text_(d.issue, 1000);
  if (!issue) throw new Error('กรุณาระบุอาการเสีย/สาเหตุ');
  const reporter = text_(d.reporter, 100);
  if (!reporter) throw new Error('กรุณาระบุผู้แจ้งซ่อม');
  const status = STATUSES.indexOf(d.status) >= 0 ? d.status : 'รอดำเนินการ';
  return {
    id: text_(d.id, 60) || Utilities.getUuid(),
    timestamp: text_(d.timestamp, 40) || new Date().toISOString(),
    date: d.date,
    equipment: equipment,
    issue: issue,
    reporter: reporter,
    status: status,
    updatedAt: '',
  };
}
