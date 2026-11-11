/**
 * Dashboard งานตรวจ DNA — เวอร์ชัน Google Apps Script (ฝั่งเซิร์ฟเวอร์)
 *
 * - doGet() แสดงหน้า Dashboard (Index.html) เฉพาะผู้ที่อยู่ในรายชื่อ "ผู้ใช้" (จัดการในหน้า ผู้ใช้ ของ Dashboard)
 *   เจ้าของสคริปต์ (Script Property ADMIN_EMAIL) เป็นผู้ดูแลเสมอ และเป็นคนเดียวที่ตั้ง/ถอดผู้ดูแลได้ · ผู้ดูแลทุกคนเปิด Dashboard ได้
 * - แหล่งข้อมูล (Google Sheet) ผู้ดูแลเพิ่มด้วยลิงก์ในหน้า "แหล่งข้อมูล" และเลือก "ชีตหลัก" 1 ชีต (ชีตคดี)
 *   ที่ LINE bot และสรุปรายเดือน/รายปีใช้ · การตั้งค่าทั้งหมดเก็บใน Script Properties (ดู Admin.gs)
 * - หน้าเว็บขอข้อมูลผ่าน google.script.run → getSources() / getBook(id)
 *   ทุกครั้งที่ขอข้อมูลจะตรวจสิทธิ์ซ้ำ (ไม่ได้ตรวจแค่ตอนเปิดหน้า) · ผู้ใช้ทั่วไปได้แค่รหัสแหล่งข้อมูล ไม่เห็น Sheet ID
 * - อ่านเฉพาะแท็บ/คอลัมน์ที่ Dashboard ใช้ (ไม่พึ่งคอลัมน์ User ID (LINE) ซึ่งเจ้าของลบออกแล้ว ถ้ายังมีก็ไม่ส่ง)
 * - โปรเจกต์เดียวกันมี LINE bot (LineBot.gs) ที่ต้อง Deploy แยกแบบ "Execute as: Me" — ในรายการ Deploy นั้น
 *   doGet / getSources / getBook / ฟังก์ชันผู้ดูแล ต้องปฏิเสธเสมอ: ถ้าสคริปต์ทำงานในนามบัญชีอื่นที่ไม่ใช่คนที่เปิด
 *   (effective user ≠ active user) หรือไม่ทราบอีเมลผู้เปิด จะไม่ส่งข้อมูล (ดู checkAccess_)
 *
 * ย้ายจากระบบเดิม (ครั้งเดียว): ถ้ายังไม่เคยบันทึกการตั้งค่าในหน้าเว็บ และมี Script Properties เดิม
 *   CASES_SHEET_ID / LAB_SHEET_ID ระบบใช้ค่าเหล่านั้น + แท็บ "ผู้ใช้" ของชีตคดีไปก่อน (โหมดเดิม)
 *   เมื่อเจ้าของเปิด Dashboard ครั้งแรก ระบบคัดลอกเข้าการตั้งค่าใหม่ให้ แล้วเลิกอ่านค่าเดิมทั้งหมด (ดู Admin.gs)
 *   หลังบันทึกการตั้งค่าครั้งแรก ระบบตั้ง Script Property DASH_SETUP_DONE ไว้ ถ้า DASH_CFG_* หายไปภายหลัง
 *   ระบบปฏิเสธทุกคน (fail closed) ไม่ย้อนกลับไปโหมดเดิม (ดู loadConfig_ ใน Admin.gs และ README หัวข้อ แก้ปัญหา)
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
  PROP_OWNER: 'ADMIN_EMAIL',          // อีเมลเจ้าของสคริปต์ = ผู้ดูแลถาวร
  PROP_CONTACT: 'ADMIN_CONTACT',      // (ไม่บังคับ) ข้อความบอกผู้ไม่มีสิทธิ์ว่าให้ติดต่อใคร
  LEGACY_CASES: 'CASES_SHEET_ID',     // ค่าเดิม ใช้เฉพาะตอนย้ายระบบครั้งแรก
  LEGACY_LAB: 'LAB_SHEET_ID',
  TITLE: 'Dashboard งานตรวจ DNA',
  USERS_TAB: 'ผู้ใช้',                  // แท็บเดิม (อ่านเฉพาะตอนย้ายระบบ)
  USERS_EMAIL_HEAD: 'อีเมล',
  CASES_TAB: 'ข้อมูลคดี',
  // คอลัมน์ของแท็บข้อมูลคดีที่ส่งให้หน้าเว็บ (จับคู่หัวคอลัมน์แบบ "ขึ้นต้นด้วย") — "เลข บก." ต้องอยู่ลำดับแรก
  CASES_COLUMNS: ['เลข บก.', 'เลขรายงาน', 'สภ.', 'จังหวัด', 'วันที่รับ', 'วันที่ตรวจเสร็จ', 'วันที่มารับผล', 'สถานะ',
    'ประเภทคดี', 'ผู้ตรวจ', 'ของกลาง', 'นับในสถิติ', 'ข้อสังเกต', 'เกณฑ์ของกลางผิดปกติ'],
  LAB_TABS: ['ข้อมูลเคส', 'ข้อมูลงบ', 'ข้อมูล Lot', 'หมายเหตุ'],
  CACHE_SECONDS: 60,         // เก็บข้อมูลที่อ่านแล้วไว้ 1 นาที (แคชของผู้ใช้แต่ละคน) ให้เปิดหน้า/สลับเมนูเร็ว
                             //   = ถ้าเลิกแชร์ชีตใน Drive อย่างเดียว ผู้ใช้ยังเห็นข้อมูลที่แคชไว้ได้อีกไม่เกิน 60 วินาที (SR-7)
                             //   ถอดสิทธิ์ทันที = ลบในหน้า ผู้ใช้ (ตรวจรายชื่อทุกครั้งก่อนอ่านแคช)
  REFRESH_SECONDS: 120,      // หน้าเว็บดึงข้อมูลใหม่ทุก 2 นาที (แยกจากอายุแคช)
  ACCESS_CACHE_SECONDS: 60,  // (โหมดเดิมเท่านั้น) ผลตรวจแท็บ ผู้ใช้ เก็บไว้ 1 นาที
  CACHE_CHUNK: 30000         // ตัวอักษรต่อชิ้นใน CacheService (ค่าหนึ่งชิ้นได้ไม่เกิน 100KB)
};

/**
 * แม่แบบชีตที่รองรับ (ตรงกับ docs/data-schema.md) ใช้ทั้งตรวจลิงก์ตอนเพิ่ม (Admin.gs) และอ่านข้อมูล
 * cols: [ลำดับคอลัมน์ (0 = A), หัวคอลัมน์ขึ้นต้นด้วย] สำหรับแท็บที่หน้าเว็บอ่านตามตำแหน่ง
 * need: หัวคอลัมน์ที่ต้องมี (ตำแหน่งใดก็ได้) · opt: ควรมี (ไม่มีก็ใช้ได้ แต่บางส่วนจะแสดง "ไม่ระบุ")
 */
var SCHEMA = {
  cases: { tab: 'ข้อมูลคดี', cols: [[0, 'เลข บก.']], need: ['เลข บก.', 'สภ.', 'จังหวัด', 'วันที่รับ', 'สถานะ', 'ของกลาง'],
    opt: ['เลขรายงาน', 'วันที่ตรวจเสร็จ', 'วันที่มารับผล', 'ประเภทคดี', 'ผู้ตรวจ', 'นับในสถิติ'] },
  lab: [
    { key: 'cases', tab: 'ข้อมูลเคส', menu: 'ภาพรวม', cols: [[0, 'ปีงบประมาณ'], [1, 'ลำดับเดือนในปีงบ'], [4, 'จำนวนของกลาง'], [5, 'จำนวนตัวอย่างตรวจ']] },
    { key: 'budget', tab: 'ข้อมูลงบ', menu: 'งบประมาณ', cols: [[0, 'ปีงบประมาณ'], [1, 'รายการ'], [2, 'หมวด'], [3, 'จำนวนเงิน']] },
    { key: 'lot', tab: 'ข้อมูล Lot', menu: 'Lot พัสดุ', cols: [[0, 'ลำดับ']], need: ['วันที่ใช้คำนวณ', 'Lot No', 'จำนวนตัวอย่าง'] }
  ],
  notesTab: 'หมายเหตุ'
};

var KIND_LABEL = { cases: 'คดีส่งตรวจ DNA (รายคดี)', lab: 'งานตรวจ · Lot · งบประมาณ', lot: 'Lot พัสดุ' };

// --- หน้าเว็บ ---
function doGet() {
  var access = checkAccess_(viewerEmail_());
  if (!access.ok) return messagePage_(access);
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(CONFIG.TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  // XFrameOptions: ใช้ค่าเริ่มต้น (DEFAULT) = เว็บไซต์อื่นฝังหน้านี้ใน iframe ไม่ได้ ไม่ต้องตั้ง ALLOWALL
}

// --- ฟังก์ชันที่หน้าเว็บเรียก (ต้องไม่ลงท้ายด้วย _) ---

/**
 * รายชื่อแหล่งข้อมูล + อีเมลผู้ใช้ + สิทธิ์ผู้ดูแล
 * ผู้ใช้ทั่วไปได้เฉพาะ id (รหัสสุ่ม) ชื่อ และชนิด · ผู้ดูแลได้ลิงก์ชีตเพิ่ม
 * ถ้าเจ้าของเปิดขณะยังเป็นโหมดเดิม (มี CASES_SHEET_ID แต่ยังไม่มีการตั้งค่าใหม่) จะย้ายการตั้งค่าให้ครั้งเดียว
 */
function getSources() {
  var ctx = requireAccess_(), notice = '';
  if (!ctx.cfg && ctx.isOwner && hasLegacy_()) { notice = migrateLegacy_(ctx.email); ctx = requireAccess_(); }
  return sourcesPayload_(ctx, notice);
}

/**
 * ข้อมูลของแหล่งข้อมูลหนึ่ง ในรูปที่ตัวอ่านของหน้าเว็บใช้อยู่แล้ว:
 * { names: [ชื่อแท็บ], tabs: { ชื่อแท็บ: [[หัวคอลัมน์...], [ค่า...], ...] }, sig, at }
 * วันที่ถูกแปลงเป็นเลข serial แบบ Sheets/Excel (google.script.run ส่ง Date ตรง ๆ ไม่ได้)
 * เปิดชีตด้วยสิทธิ์ของผู้ใช้ที่เปิด Dashboard (ต้องได้รับแชร์ชีตแบบผู้มีสิทธิ์อ่าน)
 */
function getBook(id) {
  var ctx = requireAccess_();
  var src = findSource_(ctx.cfg, id);
  if (!src) throw new Error('ไม่พบแหล่งข้อมูลนี้ (ผู้ดูแลอาจลบหรือเปลี่ยนไปแล้ว) · โหลดหน้าใหม่อีกครั้ง');
  var cacheKey = 'book3:' + src.id + ':' + (src.v || 0);
  var hit = cacheGet_(cacheKey);
  if (hit) return JSON.parse(hit);
  var ss = openForViewer_(src, ctx.email);
  var tabs = src.kind === 'cases' ? readCasesTabs_(ss) : readLabTabs_(ss);
  var json = JSON.stringify(tabs);
  var book = { names: Object.keys(tabs), tabs: tabs, sig: hash_(json), at: new Date().toISOString() };
  cachePut_(cacheKey, JSON.stringify(book));
  return book;
}

/**
 * ตรวจการตั้งค่า: เลือกฟังก์ชันนี้ใน editor แล้วกด Run ดูผลที่ Execution log
 * (บอกแค่จำนวนแถว ไม่แสดงข้อมูลคดี) — เฉพาะเจ้าของ (ADMIN_EMAIL) หรือผู้ดูแล · ผู้ใช้ทั่วไปเรียกไม่ได้ (SR-3)
 * เจ้าของ: มีผลตรวจ checkMainSheetAccess (บอตเปิดชีตหลักได้หรือไม่) ต่อท้าย
 */
function checkSetup() {
  var ctx = requireAdminCtx_();
  var msg = ['อีเมลของคุณ: ' + ctx.email + (ctx.isOwner ? ' (เจ้าของสคริปต์)' : ctx.admin ? ' (ผู้ดูแล)' : ' (ผู้ใช้)'),
    ctx.cfg ? 'การตั้งค่า: จัดการในหน้าเว็บ (ผู้ใช้ ' + ctx.cfg.people.length + ' คน)' : 'การตั้งค่า: โหมดเดิม (CASES_SHEET_ID / แท็บ ผู้ใช้) · เปิด Dashboard ด้วยบัญชีเจ้าของ 1 ครั้งเพื่อย้ายระบบ'];
  var main = mainIdOf_(ctx.cfg);
  sourcesOf_(ctx.cfg).forEach(function (s) {
    var head = s.name + (s.id === main ? ' [ชีตหลัก]' : '') + ': ';
    try {
      var ss = SpreadsheetApp.openById(s.sheetId);
      var tabs = s.kind === 'cases' ? readCasesTabs_(ss) : readLabTabs_(ss);
      msg.push(head + Object.keys(tabs).map(function (t) { return t + ' ' + (tabs[t].length - 1) + ' แถว'; }).join(', '));
    } catch (e) { msg.push(head + (e && e.message ? e.message : 'เปิดไม่ได้')); }
  });
  if (!main) msg.push('ยังไม่ได้ตั้งชีตหลัก (LINE bot และสรุปอัตโนมัติจะยังไม่ทำงาน)');
  if (ctx.isOwner) msg.push('', mainSheetReport_());
  else msg.push('(ผลข้างบนตรวจด้วยบัญชีของคุณ · บอตอ่านชีตหลักในนามเจ้าของระบบ ให้เจ้าของรัน checkMainSheetAccess)');
  Logger.log(msg.join('\n'));
  return msg.join('\n');
}

// --- สำหรับ LINE bot / สรุปอัตโนมัติ (ฝั่งเซิร์ฟเวอร์เท่านั้น) ---

/** แหล่งข้อมูลที่ตั้งเป็น "ชีตหลัก" (ชีตคดี) หรือ null */
function mainSource_() {
  var cfg = loadConfig_(), id = mainIdOf_(cfg);
  return id ? findSource_(cfg, id) : null;
}

/** Error ที่มีรหัสเหตุผล (ให้ log ของเจ้าของบอกสาเหตุได้ชัด) */
function reasonError_(reason, message) { var e = new Error(message); e.reason = reason; return e; }

/** ใครเปลี่ยนชีตหลักล่าสุด (ข้อความสั้นสำหรับ log ของเจ้าของ) */
function mainChangeText_(cfg) {
  return cfg && cfg.mainBy ? ' · ชีตหลักตั้งโดย ' + cfg.mainBy + (cfg.mainAt ? ' เมื่อ ' + cfg.mainAt : '') : '';
}

/**
 * รายการคดีทั้งหมดจาก "ชีตหลัก" ในรูปของ Stats.parseCases() — ไม่ตรวจสิทธิ์ผู้ใช้ (ผู้เรียกต้องกรองเอง เช่น groupId)
 * บอต/trigger ทำงานในนามเจ้าของ → เจ้าของต้องเปิดชีตหลักได้
 * ชื่อลงท้าย _ = หน้าเว็บเรียกผ่าน google.script.run ไม่ได้ ใช้ได้เฉพาะโค้ดฝั่งเซิร์ฟเวอร์ (LineBot.gs / Summary.gs)
 * Error มี .reason: config | no-main | no-access | bad-tab (ใช้ใน log ของเจ้าของ ไม่ส่งเข้ากลุ่ม LINE)
 */
function loadCaseRecords_() {
  var cfg, src;
  try { cfg = loadConfig_(); } catch (e) { throw reasonError_('config', 'อ่านการตั้งค่า Dashboard ไม่ได้: ' + (e && e.message)); }
  var id = mainIdOf_(cfg);
  src = id ? findSource_(cfg, id) : null;
  if (!src) throw reasonError_('no-main', 'ยังไม่ได้ตั้งชีตหลัก (หน้า แหล่งข้อมูล ของ Dashboard)');
  var ss;
  try { ss = SpreadsheetApp.openById(src.sheetId); }
  catch (e) {
    throw reasonError_('no-access', 'บัญชีที่บอตทำงานในนาม (' + (effectiveEmail_() || 'ไม่ทราบ') + ') เปิดชีตหลัก "' + src.name + '" ไม่ได้' +
      mainChangeText_(cfg) + ' · แก้: แชร์ชีตนี้ให้บัญชีเจ้าของระบบแบบ "ผู้มีสิทธิ์อ่าน" หรือตั้งชีตหลักใหม่ แล้วรัน checkMainSheetAccess');
  }
  try { return Stats.parseCases(readCasesTabs_(ss)[CONFIG.CASES_TAB]); }
  catch (e) { throw reasonError_('bad-tab', 'อ่านแท็บ "' + CONFIG.CASES_TAB + '" ของชีตหลัก "' + src.name + '" ไม่ได้: ' + (e && e.message)); }
}

/**
 * บันทึกสาเหตุที่บอต/สรุปอัตโนมัติอ่านข้อมูลคดีไม่ได้ ให้เจ้าของเห็นใน Executions log
 * และเก็บครั้งล่าสุดไว้ใน ScriptCache 6 ชม. (checkMainSheetAccess แสดง) · ไม่มีข้อมูลคดี
 */
function noteDataFailure_(where, e) {
  var reason = (e && e.reason) || 'error', text = (e && e.message) || String(e);
  console.warn('[' + where + '] อ่านข้อมูลคดีไม่ได้ (' + reason + '): ' + text);
  try { CacheService.getScriptCache().put('data-fail', JSON.stringify({ at: new Date().toISOString(), where: where, reason: reason, text: text.slice(0, 500) }), 21600); }
  catch (x) { /* แคชใช้ไม่ได้: มีแค่ log */ }
  return reason;
}

/**
 * [รันใน editor · เจ้าของเท่านั้น] ตรวจว่าบัญชีเจ้าของ (ที่บอตและสรุปอัตโนมัติทำงานในนาม) เปิดชีตหลักได้
 * ผลอยู่ใน Execution log: ชื่อชีตหลัก ใครตั้ง จำนวนแถว หรือสาเหตุที่เปิดไม่ได้ (ไม่แสดงข้อมูลคดี ไม่แสดง Sheet ID)
 * ทำไมต้องรันเอง: ผู้ดูแลที่ตั้งชีตหลักทำงานในนามตัวเอง ระบบตรวจแทนเจ้าของไม่ได้ (ถ้าไม่เพิ่มสิทธิ์ Drive)
 */
function checkMainSheetAccess() {
  requireOwner_();
  var text = mainSheetReport_();
  Logger.log(text);
  return text;
}

function mainSheetReport_() {
  var who = effectiveEmail_() || viewerEmail_(), out = [];
  try {
    var recs = loadCaseRecords_(), cfg = loadConfig_(), src = mainSource_();
    out.push('ชีตหลัก: "' + src.name + '"' + mainChangeText_(cfg),
      'ผล: บัญชี ' + who + ' เปิดได้ · แท็บ "' + CONFIG.CASES_TAB + '" ' + recs.length + ' แถว → LINE bot และสรุปอัตโนมัติอ่านได้');
  } catch (e) {
    out.push('ผล: LINE bot และสรุปอัตโนมัติอ่านชีตหลักไม่ได้ (' + ((e && e.reason) || 'error') + ')', (e && e.message) || String(e));
  }
  try {
    var last = JSON.parse(CacheService.getScriptCache().get('data-fail') || 'null');
    if (last) out.push('ครั้งล่าสุดที่อ่านไม่ได้ (ภายใน 6 ชม.): ' + last.at + ' · ' + last.where + ' · ' + last.reason + ' · ' + last.text);
  } catch (x) { /* ไม่มีประวัติ */ }
  return out.join('\n');
}

// --- สิทธิ์การเข้าถึง ---

function viewerEmail_() {
  try { return normEmail_(Session.getActiveUser().getEmail()); } catch (e) { return ''; }
}

/** บัญชีที่สคริปต์ทำงานในนาม (Deploy แบบ Me = เจ้าของ, แบบ User accessing = คนที่เปิด) */
function effectiveEmail_() {
  try { return normEmail_(Session.getEffectiveUser().getEmail()); } catch (e) { return ''; }
}

function normEmail_(s) { return String(s || '').trim().toLowerCase(); }

/** อีเมลเจ้าของสคริปต์ (ADMIN_EMAIL) — ผู้ดูแลถาวร ลบหรือลดสิทธิ์จากหน้าเว็บไม่ได้ */
function ownerEmail_() {
  return normEmail_(PropertiesService.getScriptProperties().getProperty(CONFIG.PROP_OWNER));
}

/** โหมดเดิม (CASES_SHEET_ID) ใช้ได้เฉพาะก่อนบันทึกการตั้งค่าครั้งแรก · หลังมี DASH_SETUP_DONE ไม่ใช้อีกเลย (SR-2) */
function hasLegacy_() {
  var p = PropertiesService.getScriptProperties();
  return !!p.getProperty(CONFIG.LEGACY_CASES) && !p.getProperty(CFG.DONE);
}

/**
 * ตรวจสิทธิ์ของอีเมล
 * @return {{ok:boolean, email:string, reason:string, admin:boolean, isOwner:boolean, cfg:object|null}}
 *   reason: no-email | wrong-deployment | no-config | config-broken | config-missing | not-listed
 *           (โหมดเดิมเท่านั้น) no-sheet-access | no-users-tab
 */
function checkAccess_(email) {
  var deny = function (reason) { return { ok: false, email: email || '', reason: reason, admin: false, isOwner: false, cfg: null }; };
  if (!email) return deny('no-email');
  // Deploy แบบ "Execute as: Me" (รายการ Deploy ของ LINE bot) จะอ่านชีตด้วยสิทธิ์เจ้าของแทนผู้เปิด → ห้ามส่งข้อมูล
  var eff = effectiveEmail_();
  if (eff && eff !== email) return deny('wrong-deployment');
  var owner = ownerEmail_(), isOwner = !!owner && email === owner, cfg;
  try { cfg = loadConfig_(); } catch (e) { return deny(e && e.reason === 'config-missing' ? 'config-missing' : 'config-broken'); }
  if (cfg) {
    var p = findPerson_(cfg, email);
    if (!isOwner && !p) return deny('not-listed');
    return { ok: true, email: email, reason: '', admin: isOwner || !!(p && p.admin), isOwner: isOwner, cfg: cfg };
  }
  // ยังไม่เคยบันทึกการตั้งค่าในหน้าเว็บ
  if (isOwner) return { ok: true, email: email, reason: '', admin: true, isOwner: true, cfg: null };
  if (!hasLegacy_()) return deny(owner ? 'not-listed' : 'no-config');
  var legacy = legacyUserCheck_(email);
  return legacy === 'ok' ? { ok: true, email: email, reason: '', admin: false, isOwner: false, cfg: null } : deny(legacy);
}

/** โหมดเดิม: ตรวจอีเมลกับแท็บ "ผู้ใช้" ในชีต CASES_SHEET_ID ด้วยสิทธิ์ของผู้เปิด (ใช้จนกว่าเจ้าของจะย้ายระบบ) */
function legacyUserCheck_(email) {
  var cache = userCache_(), ck = 'acl:' + email;
  if (cache && cache.get(ck) === '1') return 'ok';
  var id = PropertiesService.getScriptProperties().getProperty(CONFIG.LEGACY_CASES);
  var sheet;
  try { sheet = SpreadsheetApp.openById(id).getSheetByName(CONFIG.USERS_TAB); } catch (e) { return 'no-sheet-access'; }
  if (!sheet) return 'no-users-tab';
  var values = sheet.getDataRange().getValues();
  var col = (values[0] || []).map(function (h) { return String(h).trim(); }).indexOf(CONFIG.USERS_EMAIL_HEAD);
  if (col < 0) return 'no-users-tab';
  var listed = values.slice(1).some(function (r) { return normEmail_(r[col]) === email; });
  if (!listed) return 'not-listed';
  if (cache) cache.put(ck, '1', CONFIG.ACCESS_CACHE_SECONDS);
  return 'ok';
}

/** ใช้ในทุกฟังก์ชันที่ส่งข้อมูล: ไม่มีสิทธิ์ = โยน Error (หน้าเว็บแสดงข้อความนี้) · คืนบริบทสิทธิ์ */
function requireAccess_() {
  var a = checkAccess_(viewerEmail_());
  if (!a.ok) throw new Error('ไม่มีสิทธิ์เข้าถึงข้อมูล (' + (a.email || 'ไม่ทราบอีเมล') + ') · โปรดติดต่อ ' + contact_());
  return a;
}

/** ใช้ในทุกฟังก์ชันผู้ดูแล (หน้าแหล่งข้อมูล / ผู้ใช้) — ตรวจฝั่งเซิร์ฟเวอร์ทุกครั้ง ไม่เชื่อหน้าเว็บ */
function requireAdminCtx_() {
  var a = requireAccess_();
  if (!a.admin) throw new Error('ฟังก์ชันนี้สำหรับผู้ดูแล Dashboard เท่านั้น');
  return a;
}

function contact_() {
  return PropertiesService.getScriptProperties().getProperty(CONFIG.PROP_CONTACT) || 'ผู้ดูแล Dashboard ของกลุ่มงาน';
}

function esc_(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

function messagePage_(access) {
  var who = access.email
    ? 'บัญชีที่คุณใช้อยู่: <b>' + esc_(access.email) + '</b>'
    : 'ระบบไม่ทราบอีเมลของคุณ (Google ไม่ได้ส่งอีเมลมาให้) · ลองออกจากระบบแล้วเข้าสู่ระบบด้วยบัญชี Google ที่ได้รับสิทธิ์ หรือแจ้งผู้ดูแลให้ตรวจการตั้งค่า Deploy';
  var why = {
    'no-email': '',
    'wrong-deployment': 'ลิงก์นี้ไม่ใช่ลิงก์ Dashboard (เป็นลิงก์สำหรับระบบอื่น) · โปรดใช้ลิงก์ Dashboard ที่ผู้ดูแลส่งให้',
    'no-config': 'ผู้ดูแลยังไม่ได้ตั้งค่า ADMIN_EMAIL (อีเมลเจ้าของสคริปต์) ใน Script Properties',
    'config-broken': 'การตั้งค่าของระบบอ่านไม่ได้ชั่วคราว · ลองเปิดใหม่อีกครั้ง ถ้ายังเป็นอยู่ให้แจ้งผู้ดูแล',
    'config-missing': 'การตั้งค่าของระบบ (รายชื่อผู้ใช้และแหล่งข้อมูล) หายไป ระบบจึงปิดการเข้าถึงทุกบัญชีไว้ก่อนเพื่อความปลอดภัย · ' +
      'เจ้าของระบบ: ดูวิธีกู้คืนใน README หัวข้อ "แก้ปัญหา" แถว "การตั้งค่าของระบบหายไป"',
    'no-sheet-access': 'บัญชีนี้ยังไม่ได้รับสิทธิ์ "ผู้มีสิทธิ์อ่าน" ใน Google Sheet ข้อมูลคดี',
    'no-users-tab': 'ไม่พบแท็บ "' + CONFIG.USERS_TAB + '" หรือคอลัมน์ "' + CONFIG.USERS_EMAIL_HEAD + '" ในชีตข้อมูลคดี (ระบบเดิม)',
    'not-listed': 'อีเมลนี้ยังไม่อยู่ในรายชื่อผู้ใช้ที่ได้รับอนุญาต'
  }[access.reason] || '';
  var html = '<!doctype html><html lang="th"><head><meta charset="utf-8">' +
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600&display=swap">' +
    // ธีม Desert Rose ชุดเดียวกับ Dashboard (Index.html): พื้นทราย · การ์ดขาวอุ่น · หัวข้อและแถบบนสี Deep Burgundy
    '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6eee8;color:#2b1822;' +
    'font:15px/1.6 "IBM Plex Sans Thai","Noto Sans Thai",system-ui,sans-serif;padding:16px;box-sizing:border-box}' +
    '.c{max-width:520px;background:#fffdfb;border-radius:16px;padding:0 26px 24px;overflow:hidden;' +
    'box-shadow:0 1px 2px rgba(93,46,70,.07),0 6px 20px rgba(93,46,70,.06)}' +
    '.c:before{content:"";display:block;height:8px;margin:0 -26px 22px;background:#5d2e46}' +
    'h1{font-size:22px;margin:0 0 8px;color:#5d2e46}p{margin:8px 0;color:#5a4350}b{color:#2b1822;overflow-wrap:anywhere}' +
    '@media (prefers-color-scheme:dark){body{background:#1a1116;color:#f7ede9}.c{background:#241a1f;box-shadow:0 1px 2px rgba(0,0,0,.4),0 6px 20px rgba(0,0,0,.25)}' +
    '.c:before{background:#d4a5a5}h1{color:#e8bdbb}p{color:#dcc9c6}b{color:#f7ede9}}</style>' +
    '</head><body><main class="c"><h1>ไม่มีสิทธิ์เข้าถึง</h1>' +
    '<p>ขออภัย Dashboard นี้เปิดได้เฉพาะเจ้าหน้าที่ที่ได้รับอนุญาต</p>' +
    '<p>' + who + '</p>' + (why ? '<p>' + esc_(why) + '</p>' : '') +
    '<p>หากต้องการสิทธิ์ โปรดติดต่อ <b>' + esc_(contact_()) + '</b> พร้อมแจ้งอีเมลข้างต้น</p></main></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('ไม่มีสิทธิ์เข้าถึง · ' + CONFIG.TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// --- แหล่งข้อมูล ---

/**
 * รายการแหล่งข้อมูล: จากการตั้งค่าในหน้าเว็บ หรือ (ยังไม่เคยตั้งค่า) จาก CASES_SHEET_ID / LAB_SHEET_ID เดิม
 * @return {{id,name,sheetId,kind,tabs:string[],v}[]}
 */
function sourcesOf_(cfg) {
  if (cfg) return cfg.sources;
  var props = PropertiesService.getScriptProperties(), out = [];
  var c = props.getProperty(CONFIG.LEGACY_CASES), l = props.getProperty(CONFIG.LEGACY_LAB);
  if (c) out.push({ id: 'cases', name: KIND_LABEL.cases, sheetId: String(c).trim(), kind: 'cases', tabs: [CONFIG.CASES_TAB], v: 0 });
  if (l) out.push({ id: 'lab', name: 'งานตรวจ DNA (Lot / งบประมาณ)', sheetId: String(l).trim(), kind: 'lab', tabs: CONFIG.LAB_TABS.slice(), v: 0 });
  return out;
}

function findSource_(cfg, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) return null;
  var list = sourcesOf_(cfg);
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

/** รหัสชีตหลัก (ต้องเป็นชีตคดีที่ยังอยู่ในรายการ) */
function mainIdOf_(cfg) {
  if (!cfg) return hasLegacy_() ? 'cases' : null;
  var s = findSource_(cfg, cfg.mainId);
  return s && s.kind === 'cases' ? s.id : null;
}

/** ป้ายชนิดของแหล่งข้อมูล: ชีตงานตรวจที่มีเฉพาะแท็บ Lot = "Lot พัสดุ" */
function kindLabelOf_(src) {
  if (src.kind === 'cases') return KIND_LABEL.cases;
  var t = src.tabs || [];
  return t.indexOf('ข้อมูล Lot') >= 0 && t.indexOf('ข้อมูลเคส') < 0 && t.indexOf('ข้อมูลงบ') < 0 ? KIND_LABEL.lot : KIND_LABEL.lab;
}

function sheetUrl_(id) { return 'https://docs.google.com/spreadsheets/d/' + id + '/edit'; }

/** ข้อมูลสำหรับหน้าเว็บ — ผู้ใช้ทั่วไปไม่ได้รับ Sheet ID / ลิงก์ / อีเมลผู้เพิ่ม / ผู้เปลี่ยนชีตหลัก */
function sourcesPayload_(ctx, notice) {
  var main = mainIdOf_(ctx.cfg);
  var sources = sourcesOf_(ctx.cfg).map(function (s) {
    var o = { id: s.id, name: s.name, kind: s.kind, kindLabel: kindLabelOf_(s), main: s.id === main, rev: s.v || 0,
      menus: s.kind === 'cases' ? [] : SCHEMA.lab.filter(function (t) { return (s.tabs || []).indexOf(t.tab) >= 0; }).map(function (t) { return t.menu; }) };
    if (ctx.admin) { o.url = sheetUrl_(s.sheetId); o.by = s.by || ''; o.at = s.at || ''; }
    return o;
  });
  var mainChange = ctx.admin && main && ctx.cfg && ctx.cfg.mainBy ? { by: ctx.cfg.mainBy, at: ctx.cfg.mainAt || '' } : null;
  return { email: ctx.email, isAdmin: !!ctx.admin, isOwner: !!ctx.isOwner, owner: ctx.admin ? ownerEmail_() : '',
    mainId: main, mainChange: mainChange, sources: sources, legacy: !ctx.cfg && hasLegacy_(), notice: notice || '', refreshSeconds: CONFIG.REFRESH_SECONDS };
}

/** เปิดชีตด้วยสิทธิ์ผู้ใช้ · เปิดไม่ได้ = ข้อความภาษาไทยที่ไม่มี Sheet ID */
function openForViewer_(src, email) {
  try { return SpreadsheetApp.openById(src.sheetId); }
  catch (e) {
    throw new Error('บัญชี ' + email + ' ยังเปิด Google Sheet "' + src.name + '" ไม่ได้ · ขอให้ผู้ดูแลแชร์ชีตนี้ให้อีเมลนี้แบบ "ผู้มีสิทธิ์อ่าน" (Viewer) แล้วกดลองใหม่');
  }
}

// --- อ่านข้อมูลจาก Google Sheet ---

/** แท็บข้อมูลคดี: ส่งเฉพาะคอลัมน์ใน CONFIG.CASES_COLUMNS (ไม่ส่งเลขหนังสือ / ลงวันที่ / คอลัมน์อื่นที่ไม่ใช้) */
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

/** แท็บข้อมูลห้องปฏิบัติการ (ไม่มีข้อมูลส่วนบุคคล) — มีบางแท็บก็ได้ (เช่น ชีต Lot พัสดุที่มีแค่ "ข้อมูล Lot") */
function readLabTabs_(ss) {
  var tz = ss.getSpreadsheetTimeZone(), out = {};
  CONFIG.LAB_TABS.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var values = sh.getDataRange().getValues();
    var cols = []; for (var i = 0; i < (values[0] || []).length; i++) cols.push(i);
    out[name] = tableOf_(values, cols, tz);
  });
  if (!out['ข้อมูลเคส'] && !out['ข้อมูลงบ'] && !out['ข้อมูล Lot'])
    throw new Error('ไม่พบแท็บ "ข้อมูลเคส", "ข้อมูลงบ" หรือ "ข้อมูล Lot" ในชีตนี้ (ชื่อแท็บอาจถูกเปลี่ยน)');
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
    chunks_(str, CONFIG.CACHE_CHUNK).forEach(function (c) { obj[key + ':' + (n++)] = c; });
    obj[key + ':n'] = String(n);
    c.putAll(obj, CONFIG.CACHE_SECONDS);
  } catch (e) { /* แคชเต็มหรือใหญ่เกิน: ข้ามไป อ่านจากชีตทุกครั้งแทน */ }
}

/**
 * แบ่งข้อความเป็นชิ้นละไม่เกิน size หน่วย UTF-16 โดยไม่ผ่ากลางอีโมจิ/อักขระนอก BMP (surrogate pair) — SR-1
 * ชิ้นที่ผ่ากลางคู่จะเป็น UTF-16 ที่ไม่ถูกต้อง ที่เก็บที่แปลงเป็น UTF-8 อาจแทนด้วย U+FFFD แล้วลายเซ็นไม่ตรง
 * ได้อย่างน้อย 1 ชิ้นเสมอ (ข้อความว่าง = [''])
 */
function chunks_(s, size) {
  var out = [], i = 0;
  while (i < s.length || !out.length) {
    var end = Math.min(i + size, s.length);
    if (end < s.length && end > i + 1) { var c = s.charCodeAt(end - 1); if (c >= 0xD800 && c <= 0xDBFF) end--; }
    out.push(s.slice(i, end)); i = end;
    if (!s.length) break;
  }
  return out;
}

/** ลายเซ็นข้อมูล (หน้าเว็บใช้ดูว่าข้อมูลเปลี่ยนหรือยัง) */
function hash_(s) {
  var h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + s.length;
}
