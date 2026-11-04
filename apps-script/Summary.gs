/**
 * Summary.gs — สรุปอัตโนมัติเข้ากลุ่ม LINE (time-driven trigger รายวัน เวลาไทย)
 *
 * - วันที่ 1 ของเดือน: สรุปเดือนปฏิทินก่อนหน้า
 * - วันที่ 1 มกราคม: ส่งสรุปเดือนธันวาคม + สรุปปีปฏิทินก่อนหน้า ใน push คำขอเดียว (2 ข้อความ)
 *   LINE นับโควตาตามจำนวนผู้รับต่อคำขอ ไม่ใช่ตามจำนวนข้อความในคำขอ → ม.ค. ก็ยังนับ ≈ จำนวนสมาชิกกลุ่ม
 * - ถ้าวันที่ 1 ส่งไม่สำเร็จ (เช่น LINE ล่ม) trigger วันที่ 2–3 จะลองส่งงวดเดิมอีก (ไม่ส่งซ้ำงวดที่ส่งแล้ว)
 * - ตัวเลขทั้งหมดมาจาก Stats.summarize() ชุดเดียวกับ Dashboard (ไม่มีตัวคำนวณซ้ำในไฟล์นี้)
 * - ข้อมูลอ่านจาก "ชีตหลัก" (ตั้งในหน้า แหล่งข้อมูล ของ Dashboard) · ยังไม่ตั้ง/เปิดไม่ได้ = ไม่ส่ง และลองใหม่วันถัดไป (ถึงวันที่ 3)
 * - เนื้อหา: จำนวนคดี, ของกลาง, คดีแยกประเภท, ผู้ตรวจแต่ละคนแยกประเภท ("ไม่ระบุ" เมื่อว่าง), ลิงก์ Dashboard
 *   ไม่มีเลขคดี สภ. หรือรายละเอียดรายคดี
 *
 * กันส่งซ้ำ: LockService + Script Properties SUMMARY_SENT_MONTH ('2026-10') / SUMMARY_SENT_YEAR ('2026')
 *            + X-Line-Retry-Key ที่คงที่ต่องวด (LINE ตอบ 409 ถ้าเคยรับงวดนี้แล้วภายใน 24 ชม.)
 * ส่งจริงเฉพาะเมื่อ Script Property PUSH_ENABLED = yes (เจ้าของอนุมัติการส่งครั้งแรก) ไม่งั้นแค่ log
 *
 * Script Properties: DASHBOARD_URL, PUSH_ENABLED, (จาก LineBot.gs) LINE_CHANNEL_TOKEN, ALLOWED_GROUP_ID, ADMIN_EMAIL
 * ข้อความเป็น text ธรรมดา (ไม่ใช้ Flex): อ่านบนมือถือได้ดี แสดงในการแจ้งเตือน คัดลอกต่อได้ และยาวไม่ถึง 1,000 ตัวอักษร
 * สำหรับผู้ตรวจ 5 คน × 6 ประเภท (เพดาน LINE 5,000)
 */

var SUMMARY = {
  HANDLER: 'dailySummaryJob',
  HOUR: 8,                // ส่งช่วง 08:00–09:00 เวลาไทย (trigger รายวันของ Apps Script ระบุได้แค่ช่วงชั่วโมง)
  CATCH_UP_DAYS: 3        // วันที่ 1–3 ของเดือนยังส่งงวดที่ค้างได้
};

/** ข้อความสรุปของช่วงหนึ่ง (range จาก Stats.monthRange / Stats.yearRange) */
function formatSummary_(s, dashboardUrl) {
  var r = s.range, isYear = r.kind === 'year';
  var title = isYear ? 'สรุปคดีส่งตรวจ DNA ' + r.label + ' (ม.ค.-ธ.ค.)' : 'สรุปคดีส่งตรวจ DNA เดือน ' + r.label;
  var lines = [title, '(นับตามวันที่รับ ' + thaiDate_(r.start) + ' - ' + thaiDate_(r.end) + ')', ''];
  if (!s.cases) {
    lines.push('ไม่มีคดีรับในช่วงนี้');
  } else {
    lines.push('คดีทั้งหมด ' + fmtNum_(s.cases) + ' คดี', 'ของกลางรวม ' + fmtNum_(s.evidence) + ' ชิ้น', '', 'แยกตามประเภทคดี');
    s.byType.forEach(function (t) { lines.push('- ' + t.name + ' ' + fmtNum_(t.cases)); });
    lines.push('', 'แยกตามผู้ตรวจ (จำนวนคดี)');
    s.byOfficer.forEach(function (o) {
      var name = o.name === Stats.UNSPECIFIED ? 'ไม่ระบุผู้ตรวจ' : o.name;
      lines.push('- ' + name + ' ' + fmtNum_(o.cases) + ': ' + o.byType.map(function (t) { return t.name + ' ' + t.cases; }).join(', '));
    });
  }
  if (s.notCounted) lines.push('', '(ไม่รวมแถวที่ตั้งไม่นับในสถิติ ' + fmtNum_(s.notCounted) + ' แถว)');
  lines.push('', dashboardUrl ? 'ดูรายละเอียด: ' + dashboardUrl + '\n(เปิดได้เฉพาะผู้มีสิทธิ์)' : 'ดูรายละเอียดใน Dashboard');
  return lines.join('\n');
}

/**
 * งวดที่ต้องส่ง ณ เวลา now (เวลาไทย) — ไม่อ่าน Sheet ไม่ส่งอะไร
 * @return {{month:object|null, year:object|null}} range ของงวดที่ยังไม่ได้ส่ง
 */
function duePeriods_(now, props) {
  var d = Stats.todayYmd(now).split('-').map(Number);   // [y, m, d] เวลาไทย
  if (d[2] < 1 || d[2] > SUMMARY.CATCH_UP_DAYS) return { month: null, year: null };
  var m = Stats.previousMonthRange(now), mk = m.start.slice(0, 7);
  var out = { month: props.getProperty('SUMMARY_SENT_MONTH') === mk ? null : m, year: null };
  if (d[1] === 1) {
    var y = Stats.previousYearRange(now), yk = y.start.slice(0, 4);
    if (props.getProperty('SUMMARY_SENT_YEAR') !== yk) out.year = y;
  }
  return out;
}

/**
 * ตัวที่ trigger รายวันเรียก · ส่งเฉพาะเมื่อมาจาก trigger ของโปรเจกต์นี้จริง
 * (กันผู้ใช้ Dashboard เรียกผ่าน google.script.run) — ทดสอบส่งด้วยมือให้ใช้ preview* แทน
 * @param {object} e event ของ time-driven trigger (มี triggerUid)
 * @param {Date=} nowForTest ใช้ในชุดทดสอบเท่านั้น
 * @return {string} สิ่งที่ทำ
 */
function dailySummaryJob(e, nowForTest) {
  if (!isOwnTrigger_(e)) return 'refused-not-trigger';
  var now = nowForTest && typeof nowForTest.getTime === 'function' ? new Date(nowForTest.getTime()) : new Date();
  var props = PropertiesService.getScriptProperties();
  if (!duePeriods_(now, props).month && !duePeriods_(now, props).year) return 'nothing-due';

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 'locked';
  try {
    var due = duePeriods_(now, props);          // อ่านใหม่หลังได้ lock (อีกงานอาจส่งไปแล้ว)
    if (!due.month && !due.year) return 'nothing-due';
    var cases;
    try { cases = loadCaseRecords_(); }
    catch (x) { console.warn('สรุปอัตโนมัติ: ' + (x && x.message)); return 'no-main-source'; }
    var url = props.getProperty('DASHBOARD_URL') || '';
    var periods = [due.month, due.year].filter(Boolean);
    var texts = periods.map(function (r) { return formatSummary_(Stats.summarize(cases, r), url); });
    var keys = periods.map(function (r) { return r.kind === 'year' ? r.start.slice(0, 4) : r.start.slice(0, 7); });

    if (String(props.getProperty('PUSH_ENABLED') || '').toLowerCase() !== 'yes') {
      console.log('PUSH_ENABLED ยังไม่เป็น yes → ไม่ส่ง (แสดงตัวอย่าง)\n\n' + texts.join('\n\n-----\n\n'));
      return 'preview-only:' + keys.join('+');
    }
    var code = pushTexts_(texts, retryKeyFor_('summary:' + keys.join('+')));
    if (code !== 200 && code !== 409) { console.warn('LINE push HTTP ' + code); return 'push-failed:' + code; }
    if (due.month) props.setProperty('SUMMARY_SENT_MONTH', due.month.start.slice(0, 7));
    if (due.year) props.setProperty('SUMMARY_SENT_YEAR', due.year.start.slice(0, 4));
    return 'sent:' + keys.join('+') + (code === 409 ? ' (LINE: เคยรับแล้ว)' : '');
  } finally { lock.releaseLock(); }
}

/** e มาจาก trigger ของบัญชีนี้ที่ชี้มาที่ dailySummaryJob จริงหรือไม่ */
function isOwnTrigger_(e) {
  if (!e || !e.triggerUid) return false;
  try {
    return ScriptApp.getProjectTriggers().some(function (t) {
      return t.getUniqueId() === String(e.triggerUid) && t.getHandlerFunction() === SUMMARY.HANDLER;
    });
  } catch (x) { return false; }
}

/** UUID คงที่ต่องวด (จาก MD5) สำหรับ X-Line-Retry-Key */
function retryKeyFor_(s) {
  var h = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32);
}

// ---------------------------------------------------------------- สำหรับเจ้าของ (รันใน editor)

/** [รันใน editor] ดูข้อความสรุปเดือน (ปี ค.ศ. หรือ พ.ศ., เดือน 1–12) โดยไม่ส่ง เช่น previewSummary(2569, 10) */
function previewSummary(yyyy, mm) {
  requireOwner_();
  var now = Stats.todayYmd(new Date()).split('-').map(Number);
  var y = +yyyy || now[0], m = +mm || now[1];
  if (y > 2400) y -= 543;
  if (!mm && !yyyy) { var p = Stats.previousMonthRange(new Date()); y = +p.start.slice(0, 4); m = +p.start.slice(5, 7); }
  if (!(m >= 1 && m <= 12)) throw new Error('เดือนต้องเป็น 1–12');
  var text = formatSummary_(Stats.summarize(loadCaseRecords_(), Stats.monthRange(y, m)),
    PropertiesService.getScriptProperties().getProperty('DASHBOARD_URL') || '');
  Logger.log(text + '\n\n(' + text.length + ' ตัวอักษร · ยังไม่ได้ส่ง)');
  return text;
}

/** [รันใน editor] ดูข้อความสรุปปี (ค.ศ. หรือ พ.ศ.) โดยไม่ส่ง เช่น previewYearSummary(2568) */
function previewYearSummary(yyyy) {
  requireOwner_();
  var y = +yyyy || (+Stats.todayYmd(new Date()).slice(0, 4) - 1);
  if (y > 2400) y -= 543;
  var text = formatSummary_(Stats.summarize(loadCaseRecords_(), Stats.yearRange(y)),
    PropertiesService.getScriptProperties().getProperty('DASHBOARD_URL') || '');
  Logger.log(text + '\n\n(' + text.length + ' ตัวอักษร · ยังไม่ได้ส่ง)');
  return text;
}

/** [รันใน editor] สร้าง trigger รายวัน 1 ตัว (รันซ้ำได้ ไม่สร้างซ้ำ) */
function installTriggers() {
  requireOwner_();
  var mine = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === SUMMARY.HANDLER; });
  mine.slice(1).forEach(function (t) { ScriptApp.deleteTrigger(t); });   // ถ้าเคยสร้างเกิน ลบส่วนเกิน
  if (mine.length) { Logger.log('มี trigger อยู่แล้ว 1 ตัว (ไม่สร้างเพิ่ม)'); return 'exists'; }
  ScriptApp.newTrigger(SUMMARY.HANDLER).timeBased().everyDays(1).atHour(SUMMARY.HOUR)
    .inTimezone('Asia/Bangkok').create();
  Logger.log('สร้าง trigger รายวัน ' + SUMMARY.HOUR + ':00–' + (SUMMARY.HOUR + 1) + ':00 น. (เวลาไทย) แล้ว');
  return 'created';
}

/** [รันใน editor] ลบ trigger สรุปอัตโนมัติ (หยุดส่ง) */
function removeTriggers() {
  requireOwner_();
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === SUMMARY.HANDLER) { ScriptApp.deleteTrigger(t); n++; } });
  Logger.log('ลบ trigger ' + n + ' ตัว'); return n;
}
