/**
 * Intent.gs — แยกเจตนาของข้อความในกลุ่ม LINE แบบผสม (กฎก่อน แล้วค่อย Gemini)
 *
 * บอตถูก "เรียก" (addressed) เมื่อข้อความเข้าข้อใดข้อหนึ่ง:
 *   1) mention บอต (@ชื่อบอต) — LINE ส่ง mention.mentionees[].isSelf = true มาให้
 *   2) ขึ้นต้นด้วยคำเรียกแล้วเว้นวรรค (หรือ , :): "บอต", "บอท", "bot", "@bot" หรือขึ้นต้นด้วย "/" เช่น "บอต คดีค้าง", "/ค้าง", "บอท 123/2568"
 *   3) คำสั่งสั้นแบบไม่ต้องเรียก — ทั้งข้อความต้องเป็นคำสั่งเท่านั้น (ไม่มีคำอื่นปน):
 *        - เลข บก. 1–3 เลข เช่น "123/2568", "คดี ๑๒๓/๒๕๖๘", "เลข บก. 123/2568 ถึงไหนแล้ว"
 *        - คำว่า "คดีค้าง", "งานค้าง", "สรุปคดีค้าง", "มีคดีค้างกี่คดี" (ทั้งข้อความ)
 * ข้อความอื่นทั้งหมดในกลุ่ม = แชตปกติ → เงียบ ไม่ตอบ และไม่เรียก Gemini
 *
 * ลำดับเมื่อบอตถูกเรียก:
 *   กฎ (regex/คำสำคัญ) → ถ้าไม่เข้าใจ ค่อยส่ง "ข้อความที่ตัดข้อมูลระบุตัวตนแล้ว" ให้ Gemini
 *   Gemini ตอบได้แค่ {"intent": ...} — เลขคดีดึงจากข้อความเดิมด้วยโค้ดเท่านั้น ไม่เชื่อค่าจาก Gemini
 *   ห้ามส่งข้อมูลจาก Sheet ไป Gemini (ไฟล์นี้ไม่เรียก SpreadsheetApp เลย)
 *
 * Script Properties: GEMINI_API_KEY (ไม่ใส่ = ไม่ใช้ AI ตอบวิธีใช้แทน), GEMINI_MODEL (ไม่ใส่ = INTENT.DEFAULT_MODEL),
 *                    GEMINI_MAX_PER_HOUR (ไม่ใส่ = 30 ครั้ง/ชั่วโมง)
 */

var INTENT = {
  CASE_STATUS: 'case_status',
  PENDING: 'pending_summary',
  HELP: 'help',
  UNKNOWN: 'unknown',
  // รุ่นที่ Google ระบุว่า Stable และเร็ว/ถูกที่สุดของรุ่น 3.5 (ตรวจจาก https://ai.google.dev/gemini-api/docs/models เมื่อ 3 พ.ย. 2569)
  DEFAULT_MODEL: 'gemini-3.5-flash-lite',
  API_BASE: 'https://generativelanguage.googleapis.com/v1beta/models/',
  MAX_CASES: 3,          // ตอบเลขคดีได้สูงสุดกี่เลขต่อข้อความ
  MAX_AI_CHARS: 200,     // ความยาวข้อความสูงสุดที่ส่งให้ Gemini (หลังตัดข้อมูลแล้ว)
  MAX_TEXT: 1000,        // ข้อความยาวกว่านี้ไม่ประมวลผล (กันข้อความขยะ)
  DEFAULT_MAX_PER_HOUR: 30
};

var THAI_DIGITS_RE_ = /[๐-๙]/g;
function thaiToArabic_(s) {
  return String(s == null ? '' : s).replace(THAI_DIGITS_RE_, function (d) { return String(d.charCodeAt(0) - 0x0E50); });
}

// เลข บก. = ลำดับ 1–5 หลัก / ปี พ.ศ. 4 หลักขึ้นต้น 25 (ใช้หลังแปลงเลขไทยเป็นอารบิกแล้ว)
var CASE_NO_RE_ = /(^|[^\d\/])0*(\d{1,5})\s*\/\s*(25\d{2})(?!\d)/g;
var CALL_PREFIX_RE_ = /^\s*(?:@?(?:บอต|บอท|bot)(?=$|[\s,:：!?？])|\/(?!\d))\s*[,:：]?\s*/i;
var BARE_CASE_RE_ = /^\s*(?:คดี|เลข\s*บก\.?|บก\.?)?\s*\d{1,5}\s*\/\s*25\d{2}(?:\s*[, ]\s*\d{1,5}\s*\/\s*25\d{2}){0,2}\s*(?:ถึงไหน(?:แล้ว)?|สถานะ(?:อะไร)?|ยัง\s*ไง)?\s*(?:ครับ|คะ|ค่ะ|จ้า)?\s*[?？]*\s*$/;
var BARE_PENDING_RE_ = /^\s*(?:สรุป)?(?:คดี|งาน)ค้าง(?:ทั้งหมด)?(?:กี่(?:คดี|เรื่อง|งาน))?\s*(?:ครับ|คะ|ค่ะ)?\s*[?？]*\s*$|^\s*มี(?:คดี|งาน)ค้าง(?:กี่(?:คดี|เรื่อง|งาน))?\s*(?:ครับ|คะ|ค่ะ)?\s*[?？]*\s*$/;
var PENDING_WORDS_RE_ = /ค้าง|pending|ยังไม่(?:เสร็จ|รับผล|ได้รับผล|ได้ผล)|รอรับผล|กำลังดำเนินการ|คงค้าง/i;
var HELP_RE_ = /^\s*(?:วิธีใช้|ใช้ยังไง|ช่วยด้วย|ช่วยเหลือ|help|คำสั่ง|เมนู|\?|？)?\s*[?？]*\s*$/i;

/** ดึงเลข บก. จากข้อความ (รองรับเลขไทย ช่องว่าง 0 นำหน้า) → ['123/2568', ...] ไม่ซ้ำ ไม่เกิน INTENT.MAX_CASES */
function extractCaseNos_(text) {
  var t = thaiToArabic_(text), out = [], m;
  CASE_NO_RE_.lastIndex = 0;
  while ((m = CASE_NO_RE_.exec(t)) !== null) {
    var no = (+m[2]) + '/' + m[3];
    if (+m[2] > 0 && out.indexOf(no) < 0) out.push(no);
    if (out.length >= INTENT.MAX_CASES) break;
  }
  return out;
}

/** ตัดส่วน mention ออกจากข้อความ (ตาม index/length ที่ LINE ส่งมา) — ชื่อที่ mention อาจเป็นชื่อคน */
function stripMentions_(text, mention) {
  var t = String(text || '');
  var list = (mention && mention.mentionees) || [];
  list = list.filter(function (x) { return typeof x.index === 'number' && typeof x.length === 'number'; })
    .sort(function (a, b) { return b.index - a.index; });
  list.forEach(function (x) { t = t.slice(0, x.index) + ' ' + t.slice(x.index + x.length); });
  return t;
}

/**
 * แยกเจตนาด้วยกฎ (ไม่เรียกบริการภายนอก)
 * @param {string} text ข้อความจาก LINE
 * @param {object} mention message.mention จาก LINE (ถ้ามี)
 * @return {{addressed:boolean, intent:string|null, caseNos:string[], body:string, via:string}}
 *   addressed=false → แชตปกติ ต้องเงียบ · intent=null และ addressed=true → ต้องถาม Gemini
 */
function detectIntentByRules_(text, mention) {
  var raw = String(text || '');
  var none = { addressed: false, intent: null, caseNos: [], body: '', via: 'none' };
  if (!raw.trim() || raw.length > INTENT.MAX_TEXT) return none;
  var mentionsBot = !!(mention && (mention.mentionees || []).some(function (x) { return x.isSelf === true; }));
  var body = thaiToArabic_(stripMentions_(raw, mention)).replace(/\s+/g, ' ').trim();
  var prefixed = CALL_PREFIX_RE_.test(body);
  if (prefixed) body = body.replace(CALL_PREFIX_RE_, '').trim();

  if (!mentionsBot && !prefixed) {
    // คำสั่งสั้นแบบไม่ต้องเรียก: ทั้งข้อความต้องเป็นคำสั่งเท่านั้น
    if (BARE_CASE_RE_.test(body)) return { addressed: true, intent: INTENT.CASE_STATUS, caseNos: extractCaseNos_(body), body: body, via: 'rule' };
    if (BARE_PENDING_RE_.test(body)) return { addressed: true, intent: INTENT.PENDING, caseNos: [], body: body, via: 'rule' };
    return none;
  }
  var caseNos = extractCaseNos_(body);
  if (caseNos.length) return { addressed: true, intent: INTENT.CASE_STATUS, caseNos: caseNos, body: body, via: 'rule' };
  if (PENDING_WORDS_RE_.test(body)) return { addressed: true, intent: INTENT.PENDING, caseNos: [], body: body, via: 'rule' };
  if (HELP_RE_.test(body)) return { addressed: true, intent: INTENT.HELP, caseNos: [], body: body, via: 'rule' };
  return { addressed: true, intent: null, caseNos: [], body: body, via: 'rule' };
}

/**
 * ตัดข้อมูลที่อาจระบุตัวบุคคล/คดีออกก่อนส่งให้ Gemini (ข้อกำหนดแบบฟรี: Google อาจให้คนอ่านข้อมูลได้)
 * ตัด: mention, URL, อีเมล, เลข บก., เลขรายงาน, ตัวเลขทุกชนิด (เบอร์โทร เลขบัตร ฯลฯ),
 *      คำนำหน้า/ยศ/ตำแหน่ง/ชื่อหน่วย + 2 คำที่ตามมา (ชื่อ นามสกุล), ข้อความภาษาอังกฤษที่ขึ้นต้นตัวใหญ่ (มักเป็นชื่อ)
 */
function sanitizeForAi_(text, mention) {
  var t = thaiToArabic_(stripMentions_(text, mention));
  t = t.replace(CALL_PREFIX_RE_, ' ')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/[^\s@]+@[^\s@]+/g, ' ')
    .replace(/@\S+/g, ' ')
    .replace(/\d+\s*[\/\-.]\s*\d+(?:\s*[\/\-.]\s*\d+)*/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/(?:นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|คุณ|พี่|น้อง|ดร\.|ผอ\.?|หน\.|หัวหน้า|เจ้าหน้าที่|จนท\.?|ผู้ตรวจ|พงส\.?|พนักงานสอบสวน|ร\.?ต\.?[อทต]\.|พ\.?ต\.?[อทต]\.|ส\.?ต\.?[อทต]\.|ด\.?ต\.|จ\.?ส\.?ต\.|ส\.?ต\.?ท\.|พล\.?ต\.?[อทต]\.|สภ\.?|สน\.?|บก\.?|ภ\.จว\.?|จังหวัด|จ\.)\s*[^\s,.!?？]*(?:\s+[^\s,.!?？]+)?/g, ' ')   // คำนำหน้า + ชื่อ + นามสกุล (ตัดเกินดีกว่าตัดขาด)
    .replace(/\b[A-Z][a-zA-Z]+\b/g, ' ')
    .replace(/[^\S\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.slice(0, INTENT.MAX_AI_CHARS);
}

var GEMINI_SYSTEM_ = [
  'You classify short Thai chat messages sent to a forensic DNA lab case-tracking bot.',
  'Case numbers and names have been removed from the message.',
  'Reply with JSON only: {"intent": "<one of: case_status, pending_summary, help, unknown>"}.',
  'case_status = asks about the status/progress of a specific case.',
  'pending_summary = asks how many cases are pending, in progress, or finished but waiting for results to be collected.',
  'help = asks what the bot can do or how to use it.',
  'unknown = anything else.'
].join('\n');

/**
 * ถาม Gemini ว่าข้อความ (ที่ตัดข้อมูลแล้ว) มีเจตนาอะไร
 * @return {{intent:string, ok:boolean, reason:string}} ok=false → ผู้เรียกควรตอบวิธีใช้
 *   ไม่ throw · ไม่คืนเลขคดี (ถึง Gemini จะส่งมาก็ทิ้ง)
 */
function classifyWithGemini_(cleanText) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('GEMINI_API_KEY');
  if (!key) return { intent: INTENT.UNKNOWN, ok: false, reason: 'no-key' };
  if (!cleanText) return { intent: INTENT.UNKNOWN, ok: false, reason: 'empty' };
  var model = String(props.getProperty('GEMINI_MODEL') || INTENT.DEFAULT_MODEL).trim();
  if (!/^[a-z0-9][a-z0-9.\-]{1,62}$/.test(model)) return { intent: INTENT.UNKNOWN, ok: false, reason: 'bad-model' };
  if (!aiQuotaOk_(props)) return { intent: INTENT.UNKNOWN, ok: false, reason: 'local-rate-limit' };

  var payload = {
    systemInstruction: { parts: [{ text: GEMINI_SYSTEM_ }] },
    contents: [{ role: 'user', parts: [{ text: cleanText }] }],
    generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 256 }
  };
  try {
    var res = UrlFetchApp.fetch(INTENT.API_BASE + encodeURIComponent(model) + ':generateContent', {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(payload),
      headers: { 'x-goog-api-key': key }, muteHttpExceptions: true, followRedirects: false
    });
    var code = res.getResponseCode();
    if (code !== 200) { console.warn('Gemini HTTP ' + code); return { intent: INTENT.UNKNOWN, ok: false, reason: 'http-' + code }; }
    var data = JSON.parse(res.getContentText());
    var parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
    var out = parts.map(function (p) { return p.text || ''; }).join('').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    var intent = String((JSON.parse(out) || {}).intent || '');
    if ([INTENT.CASE_STATUS, INTENT.PENDING, INTENT.HELP, INTENT.UNKNOWN].indexOf(intent) < 0) intent = INTENT.UNKNOWN;
    return { intent: intent, ok: true, reason: '' };
  } catch (e) {
    console.warn('Gemini error: ' + (e && e.name));   // ไม่ log ข้อความผู้ใช้
    return { intent: INTENT.UNKNOWN, ok: false, reason: 'error' };
  }
}

/** จำกัดจำนวนครั้งที่เรียก Gemini ต่อชั่วโมง (กันโควตาหมด/ถูกใช้ผิด) */
function aiQuotaOk_(props) {
  var max = parseInt(props.getProperty('GEMINI_MAX_PER_HOUR'), 10);
  if (!(max >= 0)) max = INTENT.DEFAULT_MAX_PER_HOUR;
  try {
    var cache = CacheService.getScriptCache();
    var k = 'ai:' + Math.floor(Date.now() / 3600000);
    var n = +(cache.get(k) || 0);
    if (n >= max) return false;
    cache.put(k, String(n + 1), 3700);
    return true;
  } catch (e) { return true; }
}

/**
 * แยกเจตนาครบขั้นตอน: กฎ → (ถ้าเรียกบอตแต่ไม่เข้าใจ) Gemini
 * @return {{addressed:boolean, intent:string|null, caseNos:string[], via:string, aiOk?:boolean}}
 */
function detectIntent_(text, mention) {
  var r = detectIntentByRules_(text, mention);
  if (!r.addressed || r.intent) return r;
  var ai = classifyWithGemini_(sanitizeForAi_(text, mention));
  // เลขคดีไม่มาจาก Gemini เด็ดขาด — ถ้ากฎหาไม่เจอ แปลว่าไม่มีเลขคดีในข้อความ
  return { addressed: true, intent: ai.ok ? ai.intent : INTENT.HELP, caseNos: extractCaseNos_(text), via: ai.ok ? 'ai' : 'ai-fallback', aiOk: ai.ok };
}
