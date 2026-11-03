/**
 * LineBot.gs — LINE bot ของกลุ่มเจ้าหน้าที่ (webhook = doPost)
 *
 * ตอบ 2 คำสั่ง: (1) สถานะคดีจากเลข บก. (2) สรุปคดีค้าง แยก "กำลังดำเนินการ" / "เสร็จแล้ว รอรับผล"
 * วิธีเรียกบอต: ดูหัวไฟล์ Intent.gs · ข้อความอื่น = เงียบ
 *
 * ต้อง Deploy แยกอีก 1 รายการ: Web app, Execute as = Me, Who has access = Anyone (LINE ไม่มีบัญชี Google)
 * รายการ Deploy ของ Dashboard (User accessing) คงเดิม · doGet/getBook ในรายการ Deploy ของบอตปฏิเสธเสมอ (Code.gs)
 *
 * มาตรการแทนการตรวจลายเซ็น (doPost ของ Apps Script อ่าน header x-line-signature ไม่ได้):
 *   1) Webhook URL ต้องมี ?token=<WEBHOOK_TOKEN> ที่สุ่มยาว เทียบแบบเวลาคงที่ ผิด/ไม่มี = ทิ้งทั้งคำขอ
 *   2) ตอบเฉพาะ source.groupId === ALLOWED_GROUP_ID (นอกนั้นเงียบ) ไม่ตอบแชตส่วนตัว/กลุ่มอื่น
 *   3) ตอบด้วย reply API + replyToken เท่านั้น ผู้ปลอมคำขอไม่มี replyToken จริงจึงสั่งให้บอตส่งข้อความไปที่อื่นไม่ได้
 *      (LINE ปฏิเสธ replyToken ปลอม) — ข้อมูลไม่เคยถูกส่งกลับในคำตอบ HTTP ของ doPost
 *   4) คำตอบ HTTP เป็น "OK" เหมือนกันทุกกรณี (ไม่บอกว่า token ถูกหรือผิด ไม่มีข้อความ error)
 *   5) จำกัดขนาด body, จำนวน event ต่อคำขอ, ความยาวข้อความ, ทิ้ง event ซ้ำ (webhookEventId) และ event เก่า
 *   6) จำกัดจำนวนครั้งที่เรียก Gemini ต่อชั่วโมง (Intent.gs)
 *
 * Script Properties: LINE_CHANNEL_TOKEN, WEBHOOK_TOKEN, ALLOWED_GROUP_ID, (ไม่บังคับ) ADMIN_EMAIL,
 *                    SETUP_UNTIL (ตั้งโดย startSetupMode), SETUP_SEEN_GROUPS (บันทึกโดยโหมดตั้งค่า)
 */

var LINE = {
  REPLY_URL: 'https://api.line.me/v2/bot/message/reply',
  PUSH_URL: 'https://api.line.me/v2/bot/message/push',
  TEXT_MAX: 5000,             // ข้อความ text ของ LINE ยาวได้ไม่เกิน 5,000 ตัวอักษร
  MAX_BODY: 100000,           // body ของ webhook ใหญ่กว่านี้ทิ้ง (ปกติไม่กี่ KB)
  MAX_EVENTS: 20,             // event ต่อคำขอที่ประมวลผล
  MAX_EVENT_AGE_MS: 5 * 60 * 1000,
  SETUP_MINUTES: 60,
  TOP_PENDING: 3              // เลข บก. ที่ค้างนานสุดที่แสดงต่อกลุ่ม
};

// ---------------------------------------------------------------- webhook

function doPost(e) {
  try { handleWebhook_(e); } catch (err) { console.error('doPost: ' + (err && err.name) + ' ' + (err && err.message)); }
  // ตอบเหมือนกันทุกกรณี (LINE ต้องการสถานะ 200 · ไม่เปิดเผยว่าผ่านการตรวจหรือไม่)
  return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
}

/** @return {string} ผลการประมวลผล (ไว้ทดสอบ/ดู log) */
function handleWebhook_(e) {
  var props = PropertiesService.getScriptProperties();
  var expected = props.getProperty('WEBHOOK_TOKEN');
  var given = e && e.parameter ? e.parameter.token : null;
  if (!expected || expected.length < 24 || !safeEqual_(String(given || ''), expected)) return 'bad-token';
  var body = e.postData && e.postData.contents;
  if (!body || body.length > LINE.MAX_BODY) return 'bad-body';
  var data;
  try { data = JSON.parse(body); } catch (x) { return 'bad-json'; }
  var events = Array.isArray(data.events) ? data.events.slice(0, LINE.MAX_EVENTS) : [];
  if (!events.length) return 'no-events';   // ปุ่ม Verify ของ LINE ส่ง events ว่าง

  var allowed = String(props.getProperty('ALLOWED_GROUP_ID') || '').trim();
  var setup = setupModeOn_(props);
  var results = events.map(function (ev) { return handleEvent_(ev, allowed, setup, props); });
  return results.join(',');
}

function handleEvent_(ev, allowed, setup, props) {
  if (!ev || typeof ev !== 'object') return 'skip';
  var src = ev.source || {};
  var groupId = src.type === 'group' ? String(src.groupId || '') : '';
  if (setup && groupId && (ev.type === 'join' || ev.type === 'message')) recordSetupGroup_(props, groupId, ev.type);
  if (!allowed || !groupId || groupId !== allowed) return 'ignored-source';
  if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text' || !ev.replyToken) return 'ignored-type';
  if (ev.deliveryContext && ev.deliveryContext.isRedelivery) return 'ignored-redelivery';
  if (typeof ev.timestamp === 'number' && Date.now() - ev.timestamp > LINE.MAX_EVENT_AGE_MS) return 'ignored-old';
  if (isDuplicateEvent_(ev.webhookEventId)) return 'ignored-duplicate';

  var it = detectIntent_(ev.message.text, ev.message.mention);
  if (!it.addressed) return 'silent';
  var text = buildReply_(it);
  if (!text) return 'silent';
  replyText_(ev.replyToken, text);
  return 'replied:' + it.intent + ':' + it.via;
}

/** สร้างข้อความตอบจากเจตนา (อ่าน Sheet ที่นี่เท่านั้น หลังรู้ว่าต้องตอบ) */
function buildReply_(it) {
  if (it.intent === INTENT.CASE_STATUS) {
    if (!it.caseNos.length) return 'พิมพ์เลข บก. ที่ต้องการดูสถานะ เช่น 123/2568';
    var cases = loadCaseRecords_();
    return it.caseNos.map(function (no) { return formatCaseStatus_(no, Stats.findCase(cases, no)); }).join('\n\n');
  }
  if (it.intent === INTENT.PENDING) {
    var now = new Date();
    return formatPending_(Stats.pendingByStatus(loadCaseRecords_(), { today: Stats.todayYmd(now), top: LINE.TOP_PENDING }));
  }
  return helpText_();
}

// ---------------------------------------------------------------- ข้อความ

var MONTHS_TH_ = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** 'YYYY-MM-DD' (ค.ศ.) → '5 ต.ค. 2569' · null → '-' */
function thaiDate_(ymd) {
  if (!ymd) return '-';
  var p = ymd.split('-');
  return (+p[2]) + ' ' + MONTHS_TH_[+p[1] - 1] + ' ' + (+p[0] + 543);
}

function fmtNum_(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

/**
 * ข้อความสถานะคดี — ข้อมูลเท่าที่จำเป็น: สถานะ, ประเภทคดี, จำนวนของกลาง, วันที่รับ/ตรวจเสร็จ/มารับผล
 * ไม่มีชื่อผู้ตรวจ สภ. จังหวัด เลขรายงาน
 */
function formatCaseStatus_(caseNo, found) {
  if (!found.length) return 'ไม่พบคดี ' + caseNo + '\nตรวจเลข บก. อีกครั้ง (รูปแบบ 123/2568)';
  return found.slice(0, 3).map(function (c, i) {
    var head = 'คดี ' + caseNo + (found.length > 1 ? ' (รายการที่ ' + (i + 1) + '/' + found.length + ')' : '');
    return [head,
      'สถานะ: ' + (c.status || 'ไม่ระบุ'),
      'ประเภทคดี: ' + c.type,
      'ของกลาง: ' + (c.items != null ? fmtNum_(c.items) + ' ชิ้น' : '-'),
      'วันที่รับ: ' + thaiDate_(c.recvYmd),
      'ตรวจเสร็จ: ' + thaiDate_(c.doneYmd),
      'มารับผล: ' + thaiDate_(c.pickYmd)].join('\n');
  }).join('\n\n');
}

function formatPending_(p) {
  var list = function (arr, word) {
    return arr.length ? '\n' + word + ': ' + arr.map(function (x) { return x.bk + ' (' + fmtNum_(x.days) + ' วัน)'; }).join(', ') : '';
  };
  var lines = ['คดีค้าง (ยังไม่รับผล) ' + fmtNum_(p.total) + ' คดี', 'ข้อมูล ณ ' + thaiDate_(p.today), '',
    '1) กำลังดำเนินการ: ' + fmtNum_(p.inProgress.count) + ' คดี' +
      (p.inProgress.blankStatus ? '\n(ในนี้มีช่องสถานะว่าง ' + fmtNum_(p.inProgress.blankStatus) + ' คดี)' : '') +
      list(p.inProgress.oldest, 'ค้างนานสุด (นับจากวันที่รับ)'),
    '',
    '2) เสร็จแล้ว รอรับผล: ' + fmtNum_(p.waiting.count) + ' คดี' + list(p.waiting.oldest, 'รอนานสุด (นับจากวันที่ตรวจเสร็จ)')];
  return lines.join('\n');
}

function helpText_() {
  return ['วิธีใช้บอต',
    '- ดูสถานะคดี: พิมพ์เลข บก. เช่น 123/2568',
    '- ดูคดีค้าง: พิมพ์ คดีค้าง',
    '- หรือขึ้นต้นด้วย "บอต" แล้วถาม เช่น บอต คดีที่ยังไม่รับผลมีกี่คดี'].join('\n');
}

// ---------------------------------------------------------------- LINE API

function lineToken_() {
  var t = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_TOKEN');
  if (!t) throw new Error('ยังไม่ได้ตั้งค่า LINE_CHANNEL_TOKEN ใน Script Properties');
  return t;
}

/** ตอบกลับด้วย reply API (ไม่นับโควตา) · log เฉพาะรหัสสถานะ ไม่ log ข้อความ */
function replyText_(replyToken, text) {
  var res = UrlFetchApp.fetch(LINE.REPLY_URL, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + lineToken_() },
    payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: clip_(text) }] })
  });
  var code = res.getResponseCode();
  if (code !== 200) console.warn('LINE reply HTTP ' + code);
  return code;
}

/**
 * push เข้ากลุ่มที่อนุญาต (นับโควตา = จำนวนสมาชิกกลุ่ม ต่อ 1 คำขอ ไม่ว่าจะมีกี่ข้อความในคำขอ สูงสุด 5)
 * retryKey: UUID เดิมสำหรับงานเดิม → ถ้าส่งซ้ำภายใน 24 ชม. LINE ตอบ 409 และไม่ส่งซ้ำ
 * @return {number} HTTP status (200 = ส่งแล้ว, 409 = เคยส่งด้วย retryKey นี้แล้ว)
 */
function pushTexts_(texts, retryKey) {
  var to = String(PropertiesService.getScriptProperties().getProperty('ALLOWED_GROUP_ID') || '').trim();
  if (!to) throw new Error('ยังไม่ได้ตั้งค่า ALLOWED_GROUP_ID');
  var res = UrlFetchApp.fetch(LINE.PUSH_URL, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + lineToken_(), 'X-Line-Retry-Key': retryKey },
    payload: JSON.stringify({ to: to, messages: texts.slice(0, 5).map(function (t) { return { type: 'text', text: clip_(t) }; }) })
  });
  return res.getResponseCode();
}

function clip_(t) {
  t = String(t);
  return t.length <= LINE.TEXT_MAX ? t : t.slice(0, LINE.TEXT_MAX - 40) + '\n…(ตัดข้อความ ดูต่อใน Dashboard)';
}

// ---------------------------------------------------------------- ความปลอดภัย

/** เทียบข้อความแบบใช้เวลาเท่ากัน (กันเดา token ทีละตัวจากเวลาตอบ) */
function safeEqual_(a, b) {
  var diff = a.length ^ b.length;
  for (var i = 0; i < b.length; i++) diff |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ b.charCodeAt(i);
  return diff === 0;
}

/** webhookEventId ที่เคยเห็นใน 10 นาที = ซ้ำ */
function isDuplicateEvent_(id) {
  if (!id) return false;
  try {
    var c = CacheService.getScriptCache(), k = 'ev:' + String(id).slice(0, 80);
    if (c.get(k)) return true;
    c.put(k, '1', 600);
  } catch (e) { /* แคชใช้ไม่ได้: ประมวลผลต่อ */ }
  return false;
}

// ---------------------------------------------------------------- โหมดตั้งค่า (หา groupId ครั้งแรก)
//
// ทำไมไม่ให้บอตพิมพ์ groupId ลงแชต: ระหว่างตั้งค่ายังไม่มี allow-list บอตจะต้องตอบทุกกลุ่มที่เชิญมัน
// และรหัสกลุ่มจะค้างอยู่ในแชต — บันทึกลง Script Properties + Execution log ซึ่งเจ้าของเห็นคนเดียวปลอดภัยกว่า
// โหมดนี้ไม่ตอบอะไรในแชตเลย และหมดอายุเองใน 60 นาที

function setupModeOn_(props) {
  var until = +props.getProperty('SETUP_UNTIL');
  return !!until && Date.now() < until;
}

function recordSetupGroup_(props, groupId, evType) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var seen = [];
    try { seen = JSON.parse(props.getProperty('SETUP_SEEN_GROUPS') || '[]'); } catch (e) { seen = []; }
    if (!seen.some(function (x) { return x.groupId === groupId; })) {
      seen.push({ groupId: groupId, event: evType, at: new Date().toISOString() });
      props.setProperty('SETUP_SEEN_GROUPS', JSON.stringify(seen.slice(-5)));
      console.log('โหมดตั้งค่า: พบกลุ่ม ' + groupId + ' (' + evType + ')');
    }
  } finally { lock.releaseLock(); }
}

/** [รันใน editor] เปิดโหมดตั้งค่า 60 นาที: เชิญบอตเข้ากลุ่มหรือพิมพ์อะไรก็ได้ในกลุ่ม แล้วรัน showSetupGroups */
function startSetupMode() {
  requireAdmin_();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SETUP_UNTIL', String(Date.now() + LINE.SETUP_MINUTES * 60000));
  props.deleteProperty('SETUP_SEEN_GROUPS');
  var msg = 'เปิดโหมดตั้งค่าแล้ว ' + LINE.SETUP_MINUTES + ' นาที · เชิญบอตเข้ากลุ่ม หรือพิมพ์ข้อความในกลุ่ม 1 ครั้ง แล้วรัน showSetupGroups';
  Logger.log(msg); return msg;
}

/** [รันใน editor] แสดงกลุ่มที่บอตเห็นระหว่างโหมดตั้งค่า */
function showSetupGroups() {
  requireAdmin_();
  var seen = JSON.parse(PropertiesService.getScriptProperties().getProperty('SETUP_SEEN_GROUPS') || '[]');
  var msg = seen.length
    ? 'กลุ่มที่พบ:\n' + seen.map(function (x, i) { return (i + 1) + ') ' + x.groupId + ' · ' + x.event + ' · ' + x.at; }).join('\n') +
      '\nถ้ามีกลุ่มเดียว รัน allowSeenGroup เพื่อตั้งเป็น ALLOWED_GROUP_ID'
    : 'ยังไม่พบกลุ่ม · ตรวจว่าโหมดตั้งค่ายังไม่หมดเวลา และ Webhook URL มี ?token= ถูกต้อง';
  Logger.log(msg); return msg;
}

/** [รันใน editor] ตั้ง ALLOWED_GROUP_ID จากกลุ่มที่พบ (ต้องพบกลุ่มเดียว) แล้วปิดโหมดตั้งค่า */
function allowSeenGroup() {
  requireAdmin_();
  var props = PropertiesService.getScriptProperties();
  var seen = JSON.parse(props.getProperty('SETUP_SEEN_GROUPS') || '[]');
  if (seen.length !== 1) throw new Error('พบ ' + seen.length + ' กลุ่ม ต้องพบกลุ่มเดียว · ตั้ง ALLOWED_GROUP_ID เองใน Script Properties');
  props.setProperty('ALLOWED_GROUP_ID', seen[0].groupId);
  props.deleteProperty('SETUP_UNTIL');
  props.deleteProperty('SETUP_SEEN_GROUPS');
  var msg = 'ตั้ง ALLOWED_GROUP_ID แล้ว และปิดโหมดตั้งค่า'; Logger.log(msg); return msg;
}

/** [รันใน editor] สร้าง WEBHOOK_TOKEN แบบสุ่ม (ถ้ายังไม่มี) — ดูค่าได้ที่ Project Settings > Script Properties */
function makeWebhookToken() {
  requireAdmin_();
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('WEBHOOK_TOKEN')) { Logger.log('มี WEBHOOK_TOKEN อยู่แล้ว (ไม่เปลี่ยน)'); return 'exists'; }
  var t = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  props.setProperty('WEBHOOK_TOKEN', t);
  Logger.log('สร้าง WEBHOOK_TOKEN แล้ว (' + t.length + ' ตัวอักษร) · คัดลอกจาก Project Settings > Script Properties ไปต่อท้าย Webhook URL เป็น ?token=…');
  return 'created';
}

/**
 * ฟังก์ชันผู้ดูแล (รันใน editor) ต้องเป็นบัญชีใน ADMIN_EMAIL
 * เหตุผล: ฟังก์ชันระดับบนสุดทุกตัวถูกเรียกจากหน้า Dashboard ผ่าน google.script.run ได้
 * (Deploy แบบ User accessing) จึงต้องกันไม่ให้ผู้ใช้ Dashboard เปิดโหมดตั้งค่า/สร้าง trigger เอง
 */
function requireAdmin_() {
  var admin = String(PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL') || '').trim().toLowerCase();
  var me = viewerEmail_();
  if (!admin) throw new Error('ตั้ง ADMIN_EMAIL (อีเมลบัญชีเจ้าของสคริปต์) ใน Script Properties ก่อน');
  if (me !== admin) throw new Error('ฟังก์ชันนี้สำหรับผู้ดูแล (ADMIN_EMAIL) เท่านั้น');
}
