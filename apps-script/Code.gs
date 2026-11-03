/**
 * Dashboard งานตรวจ DNA — เวอร์ชัน Google Apps Script (ฝั่งเซิร์ฟเวอร์)
 *
 * - doGet() แสดงหน้า Dashboard (Index.html) เฉพาะอีเมลที่อยู่ในแท็บ "ผู้ใช้" ของชีตคดี
 * - หน้าเว็บขอข้อมูลผ่าน google.script.run → getSources() / getBook(key)
 *   ทุกครั้งที่ขอข้อมูลจะตรวจสิทธิ์ซ้ำ (ไม่ได้ตรวจแค่ตอนเปิดหน้า)
 * - Sheet ID อ่านจาก Script Properties: CASES_SHEET_ID, LAB_SHEET_ID (ไม่ใส่ในโค้ด)
 *   ADMIN_CONTACT (ไม่บังคับ) = ข้อความบอกผู้ไม่มีสิทธิ์ว่าให้ติดต่อใคร
 * - อ่านเฉพาะแท็บ/คอลัมน์ที่ Dashboard ใช้ ไม่ส่งคอลัมน์ User ID (LINE) ไปหน้าเว็บ
 *
 * วิธีติดตั้ง: ดู apps-script/README.md
 *
 * หมายเหตุสำคัญเรื่องการ Deploy: ตั้ง "Execute as: User accessing the web app"
 * เพราะถ้าตั้ง "Me" ผู้ใช้ Gmail ทั่วไป (หรือคนละโดเมนกับเจ้าของ) Google จะไม่บอกอีเมลผู้เปิด
 * (Session.getActiveUser().getEmail() เป็นค่าว่าง) ระบบจะปฏิเสธทุกคนยกเว้นเจ้าของ
 * อ้างอิง: https://developers.google.com/apps-script/reference/base/session#getActiveUser()
 */

// --- ตั้งค่า ---
var CONFIG = {
  PROP_CASES: 'CASES_SHEET_ID',
  PROP_LAB: 'LAB_SHEET_ID',
  PROP_CONTACT: 'ADMIN_CONTACT',
  TITLE: 'Dashboard งานตรวจ DNA',
  USERS_TAB: 'ผู้ใช้',
  USERS_EMAIL_HEAD: 'อีเมล',
  CASES_TAB: 'ข้อมูลคดี',
  // คอลัมน์ของแท็บข้อมูลคดีที่ส่งให้หน้าเว็บ (จับคู่หัวคอลัมน์แบบ "ขึ้นต้นด้วย") — "เลข บก." ต้องอยู่ลำดับแรก
  CASES_COLUMNS: ['เลข บก.', 'เลขรายงาน', 'สภ.', 'จังหวัด', 'วันที่รับ', 'วันที่ตรวจเสร็จ', 'วันที่มารับผล', 'สถานะ',
    'ประเภทคดี', 'ผู้ตรวจ', 'ของกลาง', 'นับในสถิติ', 'ข้อสังเกต', 'เกณฑ์ของกลางผิดปกติ'],
  LAB_TABS: ['ข้อมูลเคส', 'ข้อมูลงบ', 'ข้อมูล Lot', 'หมายเหตุ'],
  CACHE_SECONDS: 120,        // เก็บข้อมูลที่อ่านแล้วไว้ 2 นาที ให้เปิดหน้า/สลับเมนูเร็ว
  ACCESS_CACHE_SECONDS: 60,  // ผลตรวจสิทธิ์ (เฉพาะ "มีสิทธิ์") เก็บไว้ 1 นาที — ลบชื่อออกแล้วมีผลภายใน 1 นาที
  CACHE_CHUNK: 30000         // ตัวอักษรต่อชิ้นใน CacheService (ค่าหนึ่งชิ้นได้ไม่เกิน 100KB)
};

var SOURCES = {
  cases: { name: 'คดีส่งตรวจ DNA (รายคดี)', tpl: 'cases', prop: CONFIG.PROP_CASES },
  lab: { name: 'งานตรวจ DNA (Lot / งบประมาณ)', tpl: 'lab', prop: CONFIG.PROP_LAB }
};

// --- หน้าเว็บ ---
function doGet() {
  var email = viewerEmail_();
  var access = checkAccess_(email);
  if (!access.ok) return messagePage_(access);
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(CONFIG.TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  // XFrameOptions: ใช้ค่าเริ่มต้น (DEFAULT) = เว็บไซต์อื่นฝังหน้านี้ใน iframe ไม่ได้ ไม่ต้องตั้ง ALLOWALL
}

// --- ฟังก์ชันที่หน้าเว็บเรียก (ต้องไม่ลงท้ายด้วย _) ---

/** รายชื่อแหล่งข้อมูลที่ตั้งค่าไว้ + อีเมลผู้ใช้ */
function getSources() {
  var email = requireAccess_();
  var props = PropertiesService.getScriptProperties();
  var list = Object.keys(SOURCES).filter(function (k) { return !!props.getProperty(SOURCES[k].prop); })
    .map(function (k) { return { key: k, name: SOURCES[k].name, tpl: SOURCES[k].tpl }; });
  return { email: email, sources: list, refreshSeconds: CONFIG.CACHE_SECONDS };
}

/**
 * ข้อมูลของแหล่งข้อมูลหนึ่ง ในรูปที่ตัวอ่านของหน้าเว็บใช้อยู่แล้ว:
 * { names: [ชื่อแท็บ], tabs: { ชื่อแท็บ: [[หัวคอลัมน์...], [ค่า...], ...] }, sig, at }
 * วันที่ถูกแปลงเป็นเลข serial แบบ Sheets/Excel (google.script.run ส่ง Date ตรง ๆ ไม่ได้)
 */
function getBook(key) {
  requireAccess_();
  if (!Object.prototype.hasOwnProperty.call(SOURCES, key)) throw new Error('ไม่รู้จักแหล่งข้อมูล "' + key + '"');
  var cacheKey = 'book2:' + key;
  var hit = cacheGet_(cacheKey);
  if (hit) return JSON.parse(hit);
  var ss = openSource_(key);
  var tabs = key === 'cases' ? readCasesTabs_(ss) : readLabTabs_(ss);
  var json = JSON.stringify(tabs);
  var book = { names: Object.keys(tabs), tabs: tabs, sig: hash_(json), at: new Date().toISOString() };
  cachePut_(cacheKey, JSON.stringify(book));
  return book;
}

/**
 * ตรวจการตั้งค่า: เลือกฟังก์ชันนี้ใน editor แล้วกด Run ดูผลที่ Execution log
 * (บอกแค่จำนวนแถว ไม่แสดงข้อมูลคดี) — คนที่รันต้องมีชื่อในแท็บ ผู้ใช้
 */
function checkSetup() {
  var email = requireAccess_();
  var msg = ['อีเมลของคุณ: ' + email + ' (อยู่ในแท็บ ผู้ใช้ แล้ว)'];
  Object.keys(SOURCES).forEach(function (k) {
    try {
      var tabs = k === 'cases' ? readCasesTabs_(openSource_(k)) : readLabTabs_(openSource_(k));
      msg.push(SOURCES[k].name + ': ' + Object.keys(tabs).map(function (t) { return t + ' ' + (tabs[t].length - 1) + ' แถว'; }).join(', '));
    } catch (e) { msg.push(SOURCES[k].name + ': ' + e.message); }
  });
  Logger.log(msg.join('\n'));
  return msg.join('\n');
}

// --- สำหรับ LINE bot / สรุปอัตโนมัติ (ฝั่งเซิร์ฟเวอร์เท่านั้น) ---

/** รายการคดีทั้งหมดในรูปของ Stats.parseCases() — ไม่ตรวจสิทธิ์ผู้ใช้ (ผู้เรียกต้องกรองเอง เช่น groupId) */
function loadCaseRecords_() {
  var tabs = readCasesTabs_(openSource_('cases'));
  return Stats.parseCases(tabs[CONFIG.CASES_TAB]);
}

// --- สิทธิ์การเข้าถึง ---

function viewerEmail_() {
  try { return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase(); } catch (e) { return ''; }
}

/**
 * ตรวจว่าอีเมลอยู่ในแท็บ "ผู้ใช้" หรือไม่
 * @return {{ok:boolean, email:string, reason:string}} reason: no-email | no-config | no-sheet-access | no-users-tab | not-listed
 */
function checkAccess_(email) {
  if (!email) return { ok: false, email: '', reason: 'no-email' };
  var cache = userCache_(), ck = 'acl:' + email;
  if (cache && cache.get(ck) === '1') return { ok: true, email: email, reason: '' };
  var id = PropertiesService.getScriptProperties().getProperty(CONFIG.PROP_CASES);
  if (!id) return { ok: false, email: email, reason: 'no-config' };
  var sheet;
  try { sheet = SpreadsheetApp.openById(id).getSheetByName(CONFIG.USERS_TAB); }
  catch (e) { return { ok: false, email: email, reason: 'no-sheet-access' }; }
  if (!sheet) return { ok: false, email: email, reason: 'no-users-tab' };
  var values = sheet.getDataRange().getValues();
  var col = (values[0] || []).map(function (h) { return String(h).trim(); }).indexOf(CONFIG.USERS_EMAIL_HEAD);
  if (col < 0) return { ok: false, email: email, reason: 'no-users-tab' };
  var listed = values.slice(1).some(function (r) { return String(r[col] || '').trim().toLowerCase() === email; });
  if (!listed) return { ok: false, email: email, reason: 'not-listed' };
  if (cache) cache.put(ck, '1', CONFIG.ACCESS_CACHE_SECONDS);
  return { ok: true, email: email, reason: '' };
}

/** ใช้ในทุกฟังก์ชันที่ส่งข้อมูล: ไม่มีสิทธิ์ = โยน Error (หน้าเว็บแสดงข้อความนี้) */
function requireAccess_() {
  var a = checkAccess_(viewerEmail_());
  if (!a.ok) throw new Error('ไม่มีสิทธิ์เข้าถึงข้อมูล (' + (a.email || 'ไม่ทราบอีเมล') + ') · โปรดติดต่อ ' + contact_());
  return a.email;
}

function contact_() {
  return PropertiesService.getScriptProperties().getProperty(CONFIG.PROP_CONTACT) || 'ผู้ดูแล Dashboard ของกลุ่มงาน';
}

function messagePage_(access) {
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var who = access.email
    ? 'บัญชีที่คุณใช้อยู่: <b>' + esc(access.email) + '</b>'
    : 'ระบบไม่ทราบอีเมลของคุณ (Google ไม่ได้ส่งอีเมลมาให้) · ลองออกจากระบบแล้วเข้าสู่ระบบด้วยบัญชี Google ที่ได้รับสิทธิ์ หรือแจ้งผู้ดูแลให้ตรวจการตั้งค่า Deploy';
  var why = {
    'no-email': '',
    'no-config': 'ผู้ดูแลยังไม่ได้ตั้งค่า CASES_SHEET_ID ใน Script Properties',
    'no-sheet-access': 'บัญชีนี้ยังไม่ได้รับสิทธิ์ "ผู้มีสิทธิ์อ่าน" ใน Google Sheet ข้อมูลคดี',
    'no-users-tab': 'ไม่พบแท็บ "' + CONFIG.USERS_TAB + '" หรือคอลัมน์ "' + CONFIG.USERS_EMAIL_HEAD + '" ในชีตข้อมูลคดี',
    'not-listed': 'อีเมลนี้ยังไม่อยู่ในรายชื่อผู้ใช้ที่ได้รับอนุญาต'
  }[access.reason] || '';
  var html = '<!doctype html><html lang="th"><head><meta charset="utf-8">' +
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600&display=swap">' +
    '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6f8;color:#16202a;' +
    'font:15px/1.6 "IBM Plex Sans Thai",system-ui,sans-serif;padding:16px;box-sizing:border-box}' +
    '.c{max-width:520px;background:#fff;border:1px solid #dde3ea;border-radius:16px;padding:28px 26px}' +
    'h1{font-size:22px;margin:0 0 8px}p{margin:8px 0;color:#3b4652}b{color:#16202a;overflow-wrap:anywhere}' +
    '@media (prefers-color-scheme:dark){body{background:#0f1419;color:#e6edf3}.c{background:#161c23;border-color:#2a333d}p{color:#b3bfcc}b{color:#e6edf3}}</style>' +
    '</head><body><main class="c"><h1>ไม่มีสิทธิ์เข้าถึง</h1>' +
    '<p>ขออภัย Dashboard นี้เปิดได้เฉพาะเจ้าหน้าที่ที่ได้รับอนุญาต</p>' +
    '<p>' + who + '</p>' + (why ? '<p>' + esc(why) + '</p>' : '') +
    '<p>หากต้องการสิทธิ์ โปรดติดต่อ <b>' + esc(contact_()) + '</b> พร้อมแจ้งอีเมลข้างต้น</p></main></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('ไม่มีสิทธิ์เข้าถึง · ' + CONFIG.TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// --- อ่านข้อมูลจาก Google Sheet ---

function openSource_(key) {
  var id = PropertiesService.getScriptProperties().getProperty(SOURCES[key].prop);
  if (!id) throw new Error('ยังไม่ได้ตั้งค่า ' + SOURCES[key].prop + ' ใน Script Properties');
  try { return SpreadsheetApp.openById(id); }
  catch (e) { throw new Error('เปิด Google Sheet "' + SOURCES[key].name + '" ไม่ได้ · ตรวจ Sheet ID และสิทธิ์การแชร์'); }
}

/** แท็บข้อมูลคดี: ส่งเฉพาะคอลัมน์ใน CONFIG.CASES_COLUMNS (ไม่ส่ง User ID LINE / เลขหนังสือ ฯลฯ) */
function readCasesTabs_(ss) {
  var sh = ss.getSheetByName(CONFIG.CASES_TAB);
  if (!sh) throw new Error('ไม่พบแท็บ "' + CONFIG.CASES_TAB + '" ในชีตข้อมูลคดี');
  var tz = ss.getSpreadsheetTimeZone();
  var values = sh.getDataRange().getValues();
  var head = (values[0] || []).map(function (h) { return String(h).trim(); });
  var cols = [];
  CONFIG.CASES_COLUMNS.forEach(function (p) {
    for (var i = 0; i < head.length; i++) if (head[i].indexOf(p) === 0) { if (cols.indexOf(i) < 0) cols.push(i); return; }
  });
  var out = {};
  out[CONFIG.CASES_TAB] = tableOf_(values, cols, tz);
  return out;
}

/** แท็บข้อมูลห้องปฏิบัติการ (ไม่มีข้อมูลส่วนบุคคล) — แท็บ "หมายเหตุ" ไม่มีก็ได้ */
function readLabTabs_(ss) {
  var tz = ss.getSpreadsheetTimeZone(), out = {};
  CONFIG.LAB_TABS.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var values = sh.getDataRange().getValues();
    var cols = []; for (var i = 0; i < (values[0] || []).length; i++) cols.push(i);
    out[name] = tableOf_(values, cols, tz);
  });
  return out;
}

/** เลือกคอลัมน์ + แปลงค่า + ตัดแถวว่างทั้งแถว (แถวแรก = หัวคอลัมน์เก็บไว้เสมอ) */
function tableOf_(values, cols, tz) {
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var row = cols.map(function (c) { return cellOut_(values[r][c], tz); });
    if (r === 0 || row.some(function (v) { return v !== null; })) out.push(row);
  }
  return out;
}

/** ค่าในเซลล์ → ค่าที่ส่งผ่าน google.script.run ได้: วันที่ → serial (ตามโซนเวลาของชีต), '' → null */
function cellOut_(v, tz) {
  if (v === '' || v == null) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return null;
    var p = Utilities.formatDate(v, tz, 'yyyy-MM-dd-HH-mm-ss').split('-').map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5]) / 86400000 + 25569;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v);
}

// --- แคช (แบ่งเป็นชิ้น เพราะ CacheService รับค่าได้ชิ้นละไม่เกิน 100KB) ---

function userCache_() {
  try { return CacheService.getUserCache(); } catch (e) { return null; }
}

function cacheGet_(key) {
  var c = userCache_(); if (!c) return null;
  try {
    var n = +c.get(key + ':n'); if (!n) return null;
    var keys = []; for (var i = 0; i < n; i++) keys.push(key + ':' + i);
    var got = c.getAll(keys), parts = [];
    for (var j = 0; j < n; j++) { if (got[keys[j]] == null) return null; parts.push(got[keys[j]]); }
    return parts.join('');
  } catch (e) { return null; }
}

function cachePut_(key, str) {
  var c = userCache_(); if (!c) return;
  try {
    var obj = {}, n = 0;
    for (var i = 0; i < str.length; i += CONFIG.CACHE_CHUNK) obj[key + ':' + (n++)] = str.slice(i, i + CONFIG.CACHE_CHUNK);
    obj[key + ':n'] = String(n);
    c.putAll(obj, CONFIG.CACHE_SECONDS);
  } catch (e) { /* แคชเต็มหรือใหญ่เกิน: ข้ามไป อ่านจากชีตทุกครั้งแทน */ }
}

/** ลายเซ็นข้อมูล (หน้าเว็บใช้ดูว่าข้อมูลเปลี่ยนหรือยัง) */
function hash_(s) {
  var h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + s.length;
}
