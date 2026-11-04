/**
 * Admin.gs — การตั้งค่าที่ผู้ดูแลจัดการในหน้าเว็บ: แหล่งข้อมูล, ชีตหลัก, ผู้ใช้, ผู้ดูแล
 *
 * ที่เก็บ: Script Properties (คีย์ DASH_CFG_N + DASH_CFG_0, DASH_CFG_1, …) เป็น JSON ก้อนเดียวแบ่งชิ้น
 *   - Script Properties "ผู้ใช้ทุกคนของสคริปต์เข้าถึงได้" (รวมเว็บแอปที่ทำงานในนามผู้เปิด) จึงอ่าน/เขียนได้จาก
 *     Deploy แบบ "Execute as: User accessing the web app" โดยไม่ต้องแชร์อะไรเพิ่ม และผู้ใช้ไม่เห็นค่าโดยตรง
 *     (เห็นได้เฉพาะผ่านฟังก์ชันในโค้ดนี้) — https://developers.google.com/apps-script/reference/properties/properties-service
 *   - เพดาน: ค่าละ 9 KB, รวม 500 KB ต่อสคริปต์ — https://developers.google.com/apps-script/guides/services/quotas
 *     → แบ่งชิ้นละ ≤ 2,900 ตัวอักษร (≤ 8.7 KB แม้เป็นภาษาไทยทั้งหมด) และจำกัดการตั้งค่ารวม ≤ 120 KB
 *   - เขียนทุกชิ้นในคำสั่งเดียว (setProperties) ภายใต้ LockService.getScriptLock() กันผู้ดูแล 2 คนบันทึกทับกัน
 *   - ชิ้นสุดท้าย DASH_CFG_N = "จำนวนชิ้น:ลายเซ็น" ถ้าอ่านแล้วลายเซ็นไม่ตรง (อ่านระหว่างเขียน) จะอ่านใหม่ 1 ครั้ง
 *   - แบ่งชิ้นไม่ผ่ากลางอีโมจิ (chunks_ ใน Code.gs) และตัดความยาวชื่อ/หมายเหตุตามจุดรหัส (SR-1)
 *   - DASH_SETUP_DONE (ชื่อไม่ขึ้นต้นด้วย DASH_CFG_) = เคยบันทึกการตั้งค่าแล้ว · ถ้า DASH_CFG_* หายทีหลัง
 *     loadConfig_ โยน Error (reason config-missing) → ปฏิเสธทุกคน ไม่ย้อนไปโหมดเดิม/แท็บ ผู้ใช้ (SR-2)
 *   ห้ามแก้ DASH_CFG_* เองในหน้า Project Settings
 *
 * ความปลอดภัย:
 *   - ทุกฟังก์ชัน admin* ตรวจซ้ำฝั่งเซิร์ฟเวอร์ด้วย Session.getActiveUser() ว่าเป็นผู้ดูแล (requireAdminCtx_ ใน Code.gs)
 *     การซ่อนปุ่มในหน้าเว็บเป็นแค่ความสะดวก ไม่ใช่การป้องกัน
 *   - ตรวจลิงก์ชีตด้วยสิทธิ์ของผู้ดูแลที่กด (Execute as user) → เพิ่มได้เฉพาะชีตที่ผู้ดูแลคนนั้นเปิดได้เอง
 *   - ผลตรวจลิงก์มีเฉพาะชื่อแท็บ จำนวนแถว และชื่อหัวคอลัมน์ที่ขาด (จากแม่แบบ) ไม่มีค่าในเซลล์
 *   - เจ้าของ (ADMIN_EMAIL) เป็นผู้ดูแลเสมอ ลบ/ลดสิทธิ์จากหน้าเว็บไม่ได้ · ห้ามลบผู้ดูแลคนสุดท้าย
 *   - เฉพาะเจ้าของตั้ง/ถอด/ลบ/แก้ไขผู้ดูแลได้ (Q44) · ผู้ดูแลอื่นจัดการได้แค่แหล่งข้อมูล ชีตหลัก และผู้ใช้ทั่วไป
 *   - ผู้ดูแลเปลี่ยนชีตหลักได้ → บันทึก mainBy/mainAt ให้เจ้าของเห็นในหน้า แหล่งข้อมูล และใน log ของบอต (SR-5)
 *
 * ย้ายจากระบบเดิม (ครั้งเดียว): การตั้งค่ายังว่าง + มี CASES_SHEET_ID → เมื่อเจ้าของเปิด Dashboard (getSources)
 *   หรือผู้ดูแลบันทึกครั้งแรก ระบบสร้างการตั้งค่าจาก CASES_SHEET_ID / LAB_SHEET_ID และแท็บ "ผู้ใช้" ของชีตคดี
 *   หลังจากนั้นไม่อ่านค่าเดิมอีกเลย (ลบผู้ใช้ทุกคนในหน้าเว็บก็ไม่ย้อนกลับไปใช้แท็บ ผู้ใช้)
 */

var CFG = {
  PREFIX: 'DASH_CFG_',
  META: 'DASH_CFG_N',
  DONE: 'DASH_SETUP_DONE',   // ห้ามขึ้นต้นด้วย PREFIX: การลบ DASH_CFG_* ทั้งชุดต้องไม่ลบค่านี้ไปด้วย
  CHUNK_CHARS: 2900,
  MAX_BYTES: 120 * 1024,
  MAX_SOURCES: 30,
  MAX_PEOPLE: 300,
  NAME_MAX: 60,
  NOTE_MAX: 100,
  LOCK_MS: 10000
};

// ---------------------------------------------------------------- ที่เก็บการตั้งค่า

function emptyConfig_() { return { v: 1, sources: [], mainId: null, mainBy: '', mainAt: '', people: [], migrated: null }; }

/**
 * อ่านการตั้งค่า · null = ยังไม่เคยบันทึก (และไม่มี DASH_SETUP_DONE)
 * โยน Error ถ้าข้อมูลเสียหาย (reason config-broken) หรือหายไปหลังเคยบันทึกแล้ว (reason config-missing)
 * ผู้เรียกต้องปฏิเสธ ไม่ใช่เปิดให้ทุกคน
 */
function loadConfig_() {
  for (var attempt = 0; attempt < 2; attempt++) {
    var props = PropertiesService.getScriptProperties();
    var all = props.getProperties() || {};
    var meta = all[CFG.META];
    if (!meta) {
      if (all[CFG.DONE]) throw reasonError_('config-missing', 'การตั้งค่า Dashboard (DASH_CFG_*) หายไปหลังจากเคยบันทึกแล้ว · ระบบปฏิเสธทุกคนจนกว่าเจ้าของจะกู้คืน (README: แก้ปัญหา)');
      return null;
    }
    var m = /^(\d+):(\w+)$/.exec(String(meta)), parts = [], okParts = !!m;
    for (var i = 0; okParts && i < +m[1]; i++) {
      var c = all[CFG.PREFIX + i];
      if (c == null) okParts = false; else parts.push(c);
    }
    var json = parts.join('');
    if (okParts && hash_(json) === m[2]) {
      var cfg = normalizeConfig_(JSON.parse(json));
      if (!all[CFG.DONE]) { try { props.setProperty(CFG.DONE, cfg.migrated && cfg.migrated.at || new Date().toISOString()); } catch (e) { /* ครั้งหน้าลองใหม่ */ } }
      return cfg;
    }
    if (attempt === 0) { try { Utilities.sleep(300); } catch (e) { /* ไม่มี sleep ในชุดทดสอบ */ } }
  }
  throw reasonError_('config-broken', 'การตั้งค่า Dashboard เสียหาย (DASH_CFG_*)');
}

/** บันทึกการตั้งค่า (เรียกภายใต้ lock เท่านั้น) */
function saveConfig_(cfg) {
  var json = JSON.stringify(cfg), bytes = utf8Bytes_(json);
  if (bytes > CFG.MAX_BYTES)
    throw new Error('การตั้งค่ายาวเกินที่เก็บได้ (' + Math.ceil(bytes / 1024) + ' KB จากสูงสุด ' + (CFG.MAX_BYTES / 1024) + ' KB) · ลดจำนวนผู้ใช้หรือตัดหมายเหตุให้สั้นลง');
  var props = PropertiesService.getScriptProperties(), obj = {}, n = 0;
  chunks_(json, CFG.CHUNK_CHARS).forEach(function (c) { obj[CFG.PREFIX + (n++)] = c; });   // ไม่ผ่ากลางอีโมจิ (SR-1)
  obj[CFG.META] = n + ':' + hash_(json);
  if (!props.getProperty(CFG.DONE)) obj[CFG.DONE] = new Date().toISOString();                // SR-2
  props.setProperties(obj);
  var all = props.getProperties() || {};
  for (var k = n; all[CFG.PREFIX + k] != null; k++) props.deleteProperty(CFG.PREFIX + k);   // ชิ้นเก่าที่เกิน
  return { chunks: n, bytes: bytes };
}

function utf8Bytes_(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xD800 && c <= 0xDBFF) ? (i++, 4) : 3;
  }
  return n;
}

/** ตัดค่าที่ไม่ถูกต้องทิ้ง (กันข้อมูลแปลกจากการแก้ Script Properties เอง) */
function normalizeConfig_(c) {
  var out = emptyConfig_();
  if (!c || typeof c !== 'object') return out;
  var ids = {};
  (Array.isArray(c.sources) ? c.sources : []).forEach(function (s) {
    if (!s || typeof s.id !== 'string' || ids[s.id] || !/^[A-Za-z0-9_-]{1,40}$/.test(s.id) || !isSheetId_(s.sheetId)) return;
    if (s.kind !== 'cases' && s.kind !== 'lab') return;
    ids[s.id] = 1;
    out.sources.push({ id: s.id, name: cpSlice_(String(s.name || ''), CFG.NAME_MAX) || KIND_LABEL[s.kind], sheetId: s.sheetId, kind: s.kind,
      tabs: Array.isArray(s.tabs) ? s.tabs.map(String).slice(0, 10) : [], v: +s.v || 0, by: String(s.by || ''), at: String(s.at || '') });
  });
  out.mainId = typeof c.mainId === 'string' && ids[c.mainId] ? c.mainId : null;
  out.mainBy = out.mainId ? String(c.mainBy || '').slice(0, 254) : '';
  out.mainAt = out.mainId ? String(c.mainAt || '').slice(0, 40) : '';
  var seen = {};
  (Array.isArray(c.people) ? c.people : []).forEach(function (p) {
    var e = p && normEmail_(p.email);
    if (!e || seen[e] || !isEmail_(e)) return;
    seen[e] = 1;
    out.people.push({ email: e, name: cpSlice_(String(p.name || ''), CFG.NAME_MAX), note: cpSlice_(String(p.note || ''), CFG.NOTE_MAX),
      admin: p.admin === true, by: String(p.by || ''), at: String(p.at || '') });
  });
  out.migrated = c.migrated || null;
  return out;
}

/** การตั้งค่าเริ่มต้น: จากค่าเดิม (CASES_SHEET_ID / LAB_SHEET_ID + แท็บ ผู้ใช้) ถ้ามี ไม่งั้นว่าง */
function initialConfig_(byEmail) {
  var cfg = emptyConfig_();
  if (!hasLegacy_()) return cfg;
  var now = new Date().toISOString(), users = 0;
  sourcesOf_(null).forEach(function (s) {
    if (!isSheetId_(s.sheetId)) return;
    s.by = byEmail; s.at = now; s.v = 1;
    cfg.sources.push(s);
  });
  if (findSource_(cfg, 'cases')) { cfg.mainId = 'cases'; cfg.mainBy = byEmail; cfg.mainAt = now; }
  try {   // แท็บ ผู้ใช้ เดิม (อ่านด้วยสิทธิ์ของคนที่ทำการย้าย = เจ้าของ)
    var src = findSource_(cfg, 'cases');
    var sh = src && SpreadsheetApp.openById(src.sheetId).getSheetByName(CONFIG.USERS_TAB);
    var values = sh ? sh.getDataRange().getValues() : [];
    var head = (values[0] || []).map(function (h) { return String(h).trim(); });
    var ce = head.indexOf(CONFIG.USERS_EMAIL_HEAD), cn = head.indexOf('ชื่อ'), cm = head.indexOf('หมายเหตุ'), owner = ownerEmail_();
    if (ce >= 0) values.slice(1).forEach(function (r) {
      var e = normEmail_(r[ce]);
      if (!isEmail_(e) || e === owner || findPerson_(cfg, e) || cfg.people.length >= CFG.MAX_PEOPLE) return;
      cfg.people.push({ email: e, name: cleanText_(cn >= 0 ? r[cn] : '', CFG.NAME_MAX), note: cleanText_(cm >= 0 ? r[cm] : '', CFG.NOTE_MAX),
        admin: false, by: byEmail, at: now });
      users++;
    });
  } catch (e) { /* อ่านแท็บ ผู้ใช้ ไม่ได้: เริ่มด้วยรายชื่อว่าง เพิ่มในหน้าเว็บได้ */ }
  cfg.migrated = { at: now, by: byEmail, sources: cfg.sources.length, users: users };
  return cfg;
}

/** อ่าน-แก้-บันทึก ภายใต้ lock (ผู้ดูแลหลายคนกดพร้อมกันไม่ทับกัน) */
function withConfig_(email, fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CFG.LOCK_MS)) throw new Error('มีผู้ดูแลอีกคนกำลังบันทึกการตั้งค่า · รอสักครู่แล้วลองใหม่');
  try {
    var cfg = loadConfig_() || initialConfig_(email);
    var out = fn(cfg);
    saveConfig_(cfg);
    return out;
  } finally { lock.releaseLock(); }
}

/** ย้ายระบบเดิม (เรียกจาก getSources เมื่อเจ้าของเปิด Dashboard) · คืนข้อความแจ้งเจ้าของ */
function migrateLegacy_(email) {
  var info = withConfig_(email, function (cfg) { return cfg.migrated; });
  if (!info) return '';
  return 'ย้ายการตั้งค่าเดิมเข้าระบบใหม่แล้ว: แหล่งข้อมูล ' + info.sources + ' รายการ (จาก CASES_SHEET_ID / LAB_SHEET_ID) และผู้ใช้ ' + info.users +
    ' คน (จากแท็บ ผู้ใช้) · ต่อจากนี้จัดการในหน้า แหล่งข้อมูล และ ผู้ใช้ ได้เลย และลบ Script Properties 2 ค่านั้นกับแท็บ ผู้ใช้ ได้';
}

// ---------------------------------------------------------------- ตรวจข้อมูลที่ผู้ดูแลกรอก

function isSheetId_(s) { return typeof s === 'string' && /^[A-Za-z0-9_-]{25,100}$/.test(s); }

function isEmail_(s) {
  return typeof s === 'string' && s.length <= 254 && /^[a-z0-9.!#$%&*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(s);
}

/**
 * ข้อความสั้น: ตัดอักขระควบคุม อักขระที่มองไม่เห็น/ควบคุมทิศทาง (SR-6) ครึ่งอีโมจิที่ไม่มีคู่ และช่องว่างซ้ำ
 * แล้วจำกัดความยาวตามจุดรหัส (อีโมจิ 1 ตัว = 1) ไม่ผ่ากลางอีโมจิ (SR-1)
 *   ควบคุม → ช่องว่าง: C0, DEL, C1, U+2028/2029
 *   ลบทิ้ง: U+00AD, U+061C (ALM), U+180E, U+200B–200F (ZW*, LRM/RLM), U+202A–202E (embed/override),
 *           U+2060–206F (word joiner, LRI/RLI/FSI/PDI, …), U+FEFF (BOM), U+FFF9–FFFB
 */
function cleanText_(s, max) {
  var t = String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/\s+/g, ' ').trim();
  return cpSlice_(t, max).trim();
}

/** ตัดข้อความให้เหลือ max จุดรหัส (ไม่เหลือครึ่งอีโมจิ) */
function cpSlice_(s, max) {
  var a = Array.from(s);
  return a.length <= max ? s : a.slice(0, max).join('');
}

/** ลิงก์ Google Sheet หรือ Sheet ID → Sheet ID (โยน Error ภาษาไทยถ้าไม่ใช่) */
function parseSheetId_(input) {
  var s = String(input == null ? '' : input).trim();
  if (!s) throw new Error('กรุณาวางลิงก์ Google Sheet');
  if (s.length > 2000) throw new Error('ลิงก์ยาวผิดปกติ');
  if (/\/spreadsheets\/d\/e\//.test(s)) throw new Error('ลิงก์ "เผยแพร่ทางเว็บ" (…/d/e/…) ใช้ไม่ได้ · ให้คัดลอกลิงก์จากแถบที่อยู่ของเบราว์เซอร์ขณะเปิดชีต');
  var m = /^https:\/\/docs\.google\.com\/spreadsheets(?:\/u\/\d+)?\/d\/([A-Za-z0-9_-]{25,100})(?:[\/?#]|$)/.exec(s);
  if (m) return m[1];
  m = /^https:\/\/drive\.google\.com\/(?:open|file\/d\/)(?:\?id=)?([A-Za-z0-9_-]{25,100})(?:[\/?&#]|$)/.exec(s);
  if (m) return m[1];
  if (isSheetId_(s)) return s;
  throw new Error('ลิงก์ไม่ถูกต้อง · ควรขึ้นต้นด้วย https://docs.google.com/spreadsheets/d/…');
}

/**
 * ตรวจชีต (เปิดด้วยสิทธิ์ของผู้เรียก) ว่าตรงแม่แบบไหน
 * ไม่คืนค่าในเซลล์ใด ๆ: คืนเฉพาะชื่อแท็บ จำนวนแถวข้อมูล และชื่อหัวคอลัมน์ที่ขาด (ชื่อจากแม่แบบ ไม่ใช่จากชีต)
 * @return {{ok, reason, kind, kindLabel, tabs:{name,rows,role,status,missing[],optional[]}[], menus[], problems[], notes[], otherTabs[]}}
 *   reason: ok | no-access | no-match | incomplete
 */
function inspectSheet_(sheetId) {
  var res = { ok: false, reason: 'no-match', kind: null, kindLabel: '', tabs: [], menus: [], problems: [], notes: [], otherTabs: [] };
  var ss;
  try { ss = SpreadsheetApp.openById(sheetId); }
  catch (e) {
    res.reason = 'no-access';
    res.problems.push('เปิดชีตนี้ไม่ได้ · ตรวจว่าลิงก์ถูกต้อง เป็นไฟล์ Google Sheets (ไม่ใช่ไฟล์ .xlsx ที่ยังไม่ได้แปลง) และบัญชีของคุณมีสิทธิ์อย่างน้อย "ผู้มีสิทธิ์อ่าน"');
    return res;
  }
  var names = ss.getSheets().map(function (sh) { return sh.getName(); });
  var known = [SCHEMA.cases.tab, SCHEMA.notesTab].concat(SCHEMA.lab.map(function (t) { return t.tab; }));
  res.otherTabs = names.filter(function (n) { return known.indexOf(n) < 0; }).slice(0, 20);

  var check = function (spec, role) {
    var sh = ss.getSheetByName(spec.tab);
    if (!sh) return { name: spec.tab, rows: 0, role: role, status: 'missing-tab', missing: [], optional: [] };
    var lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
    var head = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h == null ? '' : h).trim(); }) : [];
    var has = function (p) { return head.some(function (h) { return h.indexOf(p) === 0; }); };
    var missing = [];
    (spec.cols || []).forEach(function (c) { if (String(head[c[0]] || '').indexOf(c[1]) !== 0) missing.push(c[1] + ' (คอลัมน์ ' + String.fromCharCode(65 + c[0]) + ')'); });
    (spec.need || []).forEach(function (p) { if (!has(p) && missing.every(function (x) { return x.indexOf(p) !== 0; })) missing.push(p); });
    var optional = (spec.opt || []).filter(function (p) { return !has(p); });
    return { name: spec.tab, rows: dataRows_(sh, lastRow), role: role, status: missing.length ? 'missing-headers' : 'ok', missing: missing, optional: optional };
  };

  if (names.indexOf(SCHEMA.cases.tab) >= 0) {
    var t = check(SCHEMA.cases, 'cases');
    res.tabs.push(t); res.kind = 'cases'; res.kindLabel = KIND_LABEL.cases;
    if (t.status !== 'ok') { res.reason = 'incomplete'; res.problems.push('แท็บ "' + t.name + '" ขาดหัวคอลัมน์: ' + t.missing.join(', ')); return res; }
    if (t.optional.length) res.notes.push('ไม่มีคอลัมน์ ' + t.optional.join(', ') + ' · ใช้ได้ แต่ส่วนที่เกี่ยวข้องจะแสดงเป็น "ไม่ระบุ" หรือว่าง');
    if (!t.rows) res.notes.push('แท็บ "' + t.name + '" ยังไม่มีแถวข้อมูล');
    if (SCHEMA.lab.some(function (x) { return names.indexOf(x.tab) >= 0; })) res.notes.push('ชีตนี้มีแท็บงานตรวจด้วย ระบบใช้เป็นชีตคดี ถ้าต้องการดูข้อมูลงานตรวจ ให้แยกเป็นอีกไฟล์');
    res.ok = true; res.reason = 'ok';
    return res;
  }
  var good = [];
  SCHEMA.lab.forEach(function (spec) {
    var t = check(spec, spec.key);
    res.tabs.push(t);
    if (t.status === 'ok') { good.push(spec); res.menus.push(spec.menu); }
    else if (t.status === 'missing-headers') res.problems.push('แท็บ "' + t.name + '" ขาดหัวคอลัมน์: ' + t.missing.join(', ') + ' · จะไม่แสดงเมนู ' + spec.menu);
  });
  if (names.indexOf(SCHEMA.notesTab) >= 0) { var sn = ss.getSheetByName(SCHEMA.notesTab); res.tabs.push({ name: SCHEMA.notesTab, rows: dataRows_(sn, sn.getLastRow()), role: 'notes', status: 'ok', missing: [], optional: [] }); }
  if (!good.length) {
    if (res.tabs.some(function (x) { return x.status === 'missing-headers'; })) { res.kind = 'lab'; res.kindLabel = KIND_LABEL.lab; res.reason = 'incomplete'; return res; }
    res.tabs = [];
    res.problems.push('ชีตนี้ไม่ตรงแม่แบบใดเลย · ต้องมีแท็บ "ข้อมูลคดี" (ชีตคดี) หรืออย่างน้อยหนึ่งแท็บจาก "ข้อมูลเคส", "ข้อมูลงบ", "ข้อมูล Lot" (ชีตงานตรวจ / ชีต Lot พัสดุ)' +
      (names.length ? ' · แท็บที่พบ: ' + names.slice(0, 20).join(', ') : ''));
    return res;
  }
  res.kind = 'lab';
  res.kindLabel = kindLabelOf_({ kind: 'lab', tabs: good.map(function (g) { return g.tab; }) });
  SCHEMA.lab.forEach(function (spec) {
    if (good.indexOf(spec) < 0 && names.indexOf(spec.tab) < 0) res.notes.push('ไม่มีแท็บ "' + spec.tab + '" · จะไม่แสดงเมนู ' + spec.menu);
  });
  res.ok = true; res.reason = 'ok';
  return res;
}

/**
 * จำนวนแถวข้อมูล = แถวที่คอลัมน์ A มีค่า (แม่แบบใส่สูตรไว้ล่วงหน้าหลายพันแถว getLastRow จึงนับเกิน)
 * อ่านคอลัมน์ A เพื่อนับเท่านั้น ไม่ส่งค่าออกไป
 */
function dataRows_(sh, lastRow) {
  if (!lastRow || lastRow < 2) return 0;
  return sh.getRange(2, 1, lastRow - 1, 1).getValues().filter(function (r) { return r[0] !== '' && r[0] != null; }).length;
}

// ---------------------------------------------------------------- ฟังก์ชันที่หน้าเว็บเรียก (ผู้ดูแลเท่านั้น)

/** ตรวจลิงก์ก่อนบันทึก (ไม่บันทึกอะไร) */
function adminInspectSource(link) {
  requireAdminCtx_();
  return inspectSheet_(parseSheetId_(link));
}

/**
 * เพิ่ม / แก้ไขแหล่งข้อมูล
 * @param {{id?:string, link?:string, name?:string}} input  id ว่าง = เพิ่มใหม่ · แก้ไขโดยไม่ใส่ link = เปลี่ยนชื่ออย่างเดียว
 */
function adminSaveSource(input) {
  var ctx = requireAdminCtx_();
  input = input && typeof input === 'object' ? input : {};
  var id = input.id == null || input.id === '' ? null : String(input.id);
  var name = cleanText_(input.name, CFG.NAME_MAX);
  var link = String(input.link == null ? '' : input.link).trim();
  var sheetId = null, insp = null;
  if (!id || link) {
    sheetId = parseSheetId_(link);
    insp = inspectSheet_(sheetId);   // ตรวจซ้ำฝั่งเซิร์ฟเวอร์เสมอ ไม่เชื่อผลตรวจที่หน้าเว็บส่งมา
    if (!insp.ok) throw new Error(insp.problems.join(' · ') || 'ชีตนี้ใช้ไม่ได้');
  }
  var now = new Date().toISOString(), msg = '', kind = null, isMain = false;
  withConfig_(ctx.email, function (cfg) {
    var src = id ? findSource_(cfg, id) : null;
    if (id && !src) throw new Error('ไม่พบแหล่งข้อมูลนี้ (อาจถูกลบไปแล้ว) · โหลดหน้าใหม่');
    if (sheetId) {
      var dup = cfg.sources.filter(function (s) { return s.sheetId === sheetId && s !== src; })[0];
      if (dup) throw new Error('ชีตนี้มีอยู่แล้วในชื่อ "' + dup.name + '"');
    }
    if (!src) {
      if (cfg.sources.length >= CFG.MAX_SOURCES) throw new Error('เพิ่มได้สูงสุด ' + CFG.MAX_SOURCES + ' แหล่งข้อมูล');
      src = { id: newId_(cfg), name: '', sheetId: sheetId, kind: insp.kind, tabs: [], v: 0, by: ctx.email, at: now };
      cfg.sources.push(src);
      msg = 'เพิ่ม "' + (name || insp.kindLabel) + '" แล้ว';
    } else msg = 'บันทึก "' + (name || src.name) + '" แล้ว';
    if (sheetId) {
      if (cfg.mainId === src.id && insp.kind !== 'cases') throw new Error('ชีตหลักต้องเป็นชีตคดี (มีแท็บ ข้อมูลคดี) · ตั้งชีตหลักเป็นชีตอื่นก่อน แล้วค่อยเปลี่ยนลิงก์นี้');
      src.sheetId = sheetId; src.kind = insp.kind;
      src.tabs = insp.tabs.filter(function (t) { return t.status === 'ok'; }).map(function (t) { return t.name; });
    }
    src.name = name || src.name || (insp ? insp.kindLabel : KIND_LABEL[src.kind]);
    src.v = (src.v || 0) + 1; src.by = ctx.email; src.at = now;
    if (!mainIdOf_(cfg) && src.kind === 'cases') { cfg.mainId = src.id; msg += ' และตั้งเป็นชีตหลัก (LINE bot ใช้ชีตนี้)'; }
    if (cfg.mainId === src.id && (sheetId || !cfg.mainBy)) { cfg.mainBy = ctx.email; cfg.mainAt = now; }   // ชีตหลักเปลี่ยนไฟล์ = เปลี่ยนชีตหลัก
    kind = src.kind; isMain = cfg.mainId === src.id;
  });
  return { message: msg, warning: ownerShareWarning_(ctx, sheetId ? kind : null, isMain), state: sourcesPayload_(requireAccess_(), '') };
}

/**
 * Q45: บอต/สรุปอัตโนมัติอ่านชีตหลักในนามเจ้าของ แต่ผู้ดูแลที่เพิ่ม/ตั้งชีตทำงานในนามตัวเอง ระบบตรวจสิทธิ์ของเจ้าของแทนไม่ได้
 * (ต้องใช้สิทธิ์ Drive ซึ่งไม่ขอเพิ่ม) → เตือนผู้ดูแลที่ไม่ใช่เจ้าของทุกครั้ง · เจ้าของตรวจเองด้วย checkMainSheetAccess
 * @param {?string} kind ชนิดของชีตที่เพิ่ม/เปลี่ยนลิงก์ (null = ไม่ได้เปลี่ยนไฟล์)
 */
function ownerShareWarning_(ctx, kind, isMain) {
  if (ctx.isOwner || (!kind && !isMain)) return '';
  var who = 'บัญชีเจ้าของระบบ' + (ownerEmail_() ? ' (' + ownerEmail_() + ')' : '');
  return isMain ? 'ต้องแชร์ชีตนี้ให้' + who + ' ไม่เช่นนั้นบอตจะอ่านไม่ได้'
    : 'ต้องแชร์ชีตนี้ให้' + who + ' ด้วย (กติกาของระบบ: ทุกชีตต้องแชร์ให้เจ้าของ ถ้าภายหลังตั้งเป็นชีตหลัก บอตจะได้อ่านได้)';
}

/** ลบแหล่งข้อมูล (ลบชีตหลักไม่ได้ ต้องตั้งชีตหลักอื่นก่อน) */
function adminRemoveSource(id) {
  var ctx = requireAdminCtx_(), name = '';
  withConfig_(ctx.email, function (cfg) {
    var src = findSource_(cfg, String(id));
    if (!src) throw new Error('ไม่พบแหล่งข้อมูลนี้ (อาจถูกลบไปแล้ว)');
    if (mainIdOf_(cfg) === src.id) throw new Error('ลบชีตหลักไม่ได้ · ตั้งชีตคดีอื่นเป็นชีตหลักก่อน หรือกด "แก้ไข" เพื่อเปลี่ยนลิงก์ของชีตนี้แทน');
    name = src.name;
    cfg.sources = cfg.sources.filter(function (s) { return s !== src; });
  });
  return { message: 'ลบ "' + name + '" ออกจากรายการแล้ว (ตัวไฟล์ Google Sheet ไม่ถูกลบ)', state: sourcesPayload_(requireAccess_(), '') };
}

/** ตั้งชีตหลัก (ต้องเป็นชีตคดี) — LINE bot และสรุปรายเดือน/รายปีอ่านจากชีตนี้ */
function adminSetMain(id) {
  var ctx = requireAdminCtx_(), name = '';
  withConfig_(ctx.email, function (cfg) {
    var src = findSource_(cfg, String(id));
    if (!src) throw new Error('ไม่พบแหล่งข้อมูลนี้ (อาจถูกลบไปแล้ว)');
    if (src.kind !== 'cases') throw new Error('ชีตหลักต้องเป็นชีตคดี (มีแท็บ ข้อมูลคดี)');
    if (cfg.mainId !== src.id) { cfg.mainId = src.id; cfg.mainBy = ctx.email; cfg.mainAt = new Date().toISOString(); }
    name = src.name;
  });
  return { message: 'ตั้ง "' + name + '" เป็นชีตหลักแล้ว · LINE bot และสรุปอัตโนมัติจะอ่านจากชีตนี้', warning: ownerShareWarning_(ctx, 'cases', true),
    state: sourcesPayload_(requireAccess_(), '') };
}

/** รายชื่อผู้ใช้/ผู้ดูแล + ลิงก์ชีตทุกแหล่ง (สำหรับเตือนให้แชร์) */
function adminGetPeople() {
  return peoplePayload_(requireAdminCtx_());
}

/**
 * เพิ่ม / แก้ไขผู้ใช้
 * ผู้ดูแลที่ไม่ใช่เจ้าของ: เพิ่ม/แก้ได้เฉพาะผู้ใช้ทั่วไป · ส่ง admin:true หรือแตะรายการของผู้ดูแล = ปฏิเสธ (Q44)
 * @param {{email:string, name?:string, note?:string, admin?:boolean, edit?:boolean}} input
 */
function adminSaveUser(input) {
  var ctx = requireAdminCtx_();
  input = input && typeof input === 'object' ? input : {};
  var email = normEmail_(input.email);
  if (!isEmail_(email)) throw new Error('อีเมลไม่ถูกต้อง · ตัวอย่าง: name@gmail.com');
  if (email === ownerEmail_()) throw new Error('อีเมลนี้เป็นเจ้าของสคริปต์ ซึ่งเป็นผู้ดูแลอยู่แล้วเสมอ');
  var name = cleanText_(input.name, CFG.NAME_MAX), note = cleanText_(input.note, CFG.NOTE_MAX), msg = '';
  withConfig_(ctx.email, function (cfg) {
    var p = findPerson_(cfg, email);
    if (p && !input.edit) throw new Error('อีเมลนี้อยู่ในรายชื่อแล้ว (' + (p.name || p.email) + ')');
    if (!p && input.edit) throw new Error('ไม่พบอีเมลนี้ในรายชื่อ (อาจถูกลบไปแล้ว)');
    if (p && p.admin) requireOwnerFor_(ctx, 'แก้ไขข้อมูลของผู้ดูแลได้');
    if (input.admin === true && !(p && p.admin)) requireOwnerFor_(ctx, 'ตั้งผู้ดูแลได้');
    if (!p) {
      if (cfg.people.length >= CFG.MAX_PEOPLE) throw new Error('เพิ่มได้สูงสุด ' + CFG.MAX_PEOPLE + ' คน');
      p = { email: email, admin: false };
      cfg.people.push(p);
      msg = 'เพิ่ม ' + email + ' แล้ว · อย่าลืมแชร์ชีตทุกแหล่งให้อีเมลนี้แบบ ผู้มีสิทธิ์อ่าน';
    } else msg = 'บันทึก ' + email + ' แล้ว';
    p.name = name; p.note = note; p.by = ctx.email; p.at = new Date().toISOString();
    if (typeof input.admin === 'boolean' && input.admin !== p.admin) {
      if (!input.admin) guardLastAdmin_(cfg, p);
      p.admin = input.admin;
    }
  });
  var self = email === ctx.email && input.admin === false;
  return { message: msg, self: self, people: self ? null : peoplePayload_(requireAdminCtx_()) };
}

/** ตั้ง / เลิกเป็นผู้ดูแล (ผู้ที่เลิกเป็นผู้ดูแลยังอยู่ในรายชื่อผู้ใช้) · เจ้าของระบบเท่านั้น (Q44) */
function adminSetAdmin(email, admin) {
  var ctx = requireAdminCtx_(), e = normEmail_(email), on = admin === true;
  if (e && e === ownerEmail_()) throw new Error('เจ้าของสคริปต์เป็นผู้ดูแลเสมอ เปลี่ยนในหน้านี้ไม่ได้');
  requireOwnerFor_(ctx, on ? 'ตั้งผู้ดูแลได้' : 'ถอดผู้ดูแลได้');
  withConfig_(ctx.email, function (cfg) {
    var p = findPerson_(cfg, e);
    if (!p) throw new Error('ไม่พบอีเมลนี้ในรายชื่อ');
    if (!on && p.admin) guardLastAdmin_(cfg, p);
    p.admin = on; p.by = ctx.email; p.at = new Date().toISOString();
  });
  var self = e === ctx.email && !on;
  return { message: (on ? 'ตั้ง ' + e + ' เป็นผู้ดูแลแล้ว' : e + ' เลิกเป็นผู้ดูแลแล้ว (ยังเปิด Dashboard ได้)'), self: self,
    people: self ? null : peoplePayload_(requireAdminCtx_()) };
}

/** ลบผู้ใช้ออกจากรายชื่อ (เปิด Dashboard ไม่ได้อีก) · ลบผู้ดูแลได้เฉพาะเจ้าของระบบ (Q44) */
function adminRemoveUser(email) {
  var ctx = requireAdminCtx_(), e = normEmail_(email);
  if (e && e === ownerEmail_()) throw new Error('ลบเจ้าของสคริปต์ไม่ได้');
  withConfig_(ctx.email, function (cfg) {
    var p = findPerson_(cfg, e);
    if (!p) throw new Error('ไม่พบอีเมลนี้ในรายชื่อ (อาจถูกลบไปแล้ว)');
    if (p.admin) { requireOwnerFor_(ctx, 'ลบผู้ดูแลได้'); guardLastAdmin_(cfg, p); }
    cfg.people = cfg.people.filter(function (x) { return x !== p; });
  });
  var self = e === ctx.email;
  return { message: 'ลบ ' + e + ' แล้ว · ควรนำอีเมลนี้ออกจากการแชร์ของทุกชีตด้วย', self: self, people: self ? null : peoplePayload_(requireAdminCtx_()) };
}

// ---------------------------------------------------------------- ช่วย

function findPerson_(cfg, email) {
  if (!cfg) return null;
  for (var i = 0; i < cfg.people.length; i++) if (cfg.people[i].email === email) return cfg.people[i];
  return null;
}

/**
 * Q44: การจัดการผู้ดูแล (ตั้ง/ถอด/ลบ/แก้ไขผู้ดูแล) เฉพาะเจ้าของระบบ (ADMIN_EMAIL)
 * ตรวจฝั่งเซิร์ฟเวอร์ภายใน withConfig_ (หลังอ่านการตั้งค่าล่าสุด) · การซ่อนปุ่มในหน้าเว็บเป็นแค่ความสะดวก
 */
function requireOwnerFor_(ctx, what) {
  if (ctx.isOwner) return;
  if (!ownerEmail_()) throw new Error('ยังไม่ได้ตั้ง ADMIN_EMAIL ใน Script Properties · เฉพาะเจ้าของระบบ' + what);
  throw new Error('เฉพาะเจ้าของระบบ (' + ownerEmail_() + ') ' + what + ' · ผู้ดูแลคนอื่นจัดการได้เฉพาะแหล่งข้อมูลและผู้ใช้ทั่วไป');
}

/** ต้องเหลือผู้ดูแลอย่างน้อย 1 คน (นับเจ้าของ ADMIN_EMAIL ด้วย) · หลัง Q44 เป็นการกันซ้ำ เพราะเจ้าของนับเสมอ */
function guardLastAdmin_(cfg, leaving) {
  var others = cfg.people.filter(function (p) { return p.admin && p !== leaving; }).length + (ownerEmail_() ? 1 : 0);
  if (!others) throw new Error('ต้องมีผู้ดูแลอย่างน้อย 1 คน · ตั้งคนอื่นเป็นผู้ดูแลก่อน (หรือตั้ง ADMIN_EMAIL ใน Script Properties)');
}

function newId_(cfg) {
  for (;;) {
    var id = 's' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    if (!findSource_(cfg, id)) return id;
  }
}

function peoplePayload_(ctx) {
  var cfg = ctx.cfg || loadConfig_();
  var people = cfg ? cfg.people : [];
  return {
    me: ctx.email, owner: ownerEmail_(), isOwner: !!ctx.isOwner, legacy: !cfg && hasLegacy_(),
    people: people.map(function (p) { return { email: p.email, name: p.name, note: p.note, admin: p.admin, by: p.by, at: p.at }; })
      .sort(function (a, b) { return (b.admin - a.admin) || (a.name || a.email).localeCompare(b.name || b.email, 'th'); }),
    sources: sourcesOf_(cfg).map(function (s) { return { name: s.name, url: sheetUrl_(s.sheetId) }; }),
    limits: { people: CFG.MAX_PEOPLE, name: CFG.NAME_MAX, note: CFG.NOTE_MAX }
  };
}
