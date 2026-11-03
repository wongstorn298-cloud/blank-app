/**
 * Stats.gs — ฟังก์ชันคำนวณสถิติคดี (ชุดเดียวที่ทั้ง Dashboard และ LINE bot ใช้)
 *
 * กติกาเหมือน Dashboard ทุกข้อ:
 *   - เดือน/ปีของคดีนับจากคอลัมน์ "วันที่รับ"
 *   - แถวที่ไม่มีวันที่รับ ไม่นับ
 *   - แถวที่คอลัมน์ "นับในสถิติ" = 0 ไม่นับ (ช่องว่างหรือไม่มีคอลัมน์ = นับ)
 *   - ของกลางรวมเฉพาะช่องที่เป็นตัวเลข
 *   - ประเภทคดี/ผู้ตรวจที่ว่าง แสดงเป็น "ไม่ระบุ"
 *   - สถานะ: 'รับผลไปแล้ว' = เสร็จ, มีคำว่า 'รอรับผล' = รอรับผล, ค่าอื่น (รวมช่องว่าง) = กำลังดำเนินการ
 *
 * ไฟล์นี้เป็น "ฟังก์ชันล้วน" ไม่เรียก SpreadsheetApp หรือบริการอื่นของ Google
 * จึงรันทดสอบใน Node ได้ (apps-script/test/run.js)
 * ทุกอย่างอยู่ในอ็อบเจกต์ Stats (ไม่ใช่ฟังก์ชันระดับบนสุด) หน้าเว็บจึงเรียกผ่าน google.script.run ไม่ได้
 *
 * รูปแบบวันที่:
 *   - serial  = วันที่แบบ Excel/Sheets (จำนวนวันนับจาก 30 ธ.ค. 1899) ตามที่ Code.gs ส่งมา
 *   - ymd     = ข้อความ 'YYYY-MM-DD' (ค.ศ.) ใช้กำหนดช่วงวันที่ เช่น { start: '2026-10-01', end: '2026-10-31' } (รวมวันสุดท้าย)
 *
 * วิธีใช้ (ฝั่งเซิร์ฟเวอร์ เช่น LINE bot):
 *   const cases = loadCaseRecords_();                       // อยู่ใน Code.gs
 *   const r = Stats.previousMonthRange(new Date());         // เดือนปฏิทินก่อนหน้า (เวลาไทย)
 *   const s = Stats.summarize(cases, r);                    // { cases, evidence, byType, byOfficer, ... }
 *   const p = Stats.pendingByStatus(cases, { today: Stats.todayYmd(new Date()) }); // แยก 2 กลุ่ม
 *   const f = Stats.findCase(cases, '123/2568');            // [] ถ้าไม่พบ
 */
var Stats = (function () {
  var UNSPECIFIED = 'ไม่ระบุ';
  var ST_PROGRESS = 'กำลังดำเนินการ';
  var ST_WAITING = 'เสร็จแล้ว รอรับผล';
  var ST_DONE = 'รับผลไปแล้ว';
  var PENDING_STATUSES = [ST_PROGRESS, ST_WAITING];
  var TZ_OFFSET_MS = 7 * 3600 * 1000; // Asia/Bangkok = UTC+7 ไม่มีเวลาออมแสง
  var MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  // หัวคอลัมน์ที่ใช้ (จับคู่ด้วย "ขึ้นต้นด้วย" แบบเดียวกับ Dashboard)
  var COLUMNS = {
    bk: 'เลข บก.', report: 'เลขรายงาน', station: 'สภ.', province: 'จังหวัด',
    recv: 'วันที่รับ', done: 'วันที่ตรวจเสร็จ', pick: 'วันที่มารับผล', status: 'สถานะ',
    type: 'ประเภทคดี', officer: 'ผู้ตรวจ', items: 'ของกลาง', counted: 'นับในสถิติ'
  };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function text(v) { return v == null ? '' : String(v).trim(); }

  /** serial (วันแบบ Sheets) → 'YYYY-MM-DD' หรือ null */
  function serialToYmd(s) {
    if (num(s) == null) return null;
    var d = new Date(Math.round((s - 25569) * 86400000));
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  /** 'YYYY-MM-DD' → จำนวนวันนับจาก 1970-01-01 (ใช้หาผลต่างวัน) */
  function ymdToDays(ymd) {
    var p = ymd.split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000;
  }

  function lastDay(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m = 1..12

  /** ช่วงเดือนปฏิทิน (y = ค.ศ., m = 1..12) */
  function monthRange(y, m) {
    return { start: y + '-' + pad2(m) + '-01', end: y + '-' + pad2(m) + '-' + pad2(lastDay(y, m)),
      label: MONTHS_TH[m - 1] + ' ' + (y + 543), kind: 'month' };
  }

  /** ช่วงปีปฏิทิน (y = ค.ศ.) */
  function yearRange(y) {
    return { start: y + '-01-01', end: y + '-12-31', label: 'ปี ' + (y + 543), kind: 'year' };
  }

  /** วันที่ปัจจุบันตามเวลาไทย → { y, m, d } (m = 1..12) */
  function bangkokParts(now) {
    var t = new Date((now instanceof Date ? now.getTime() : +now) + TZ_OFFSET_MS);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }

  /** วันนี้ (เวลาไทย) เป็น 'YYYY-MM-DD' */
  function todayYmd(now) {
    var p = bangkokParts(now);
    return p.y + '-' + pad2(p.m) + '-' + pad2(p.d);
  }

  /** เดือนปฏิทินก่อนหน้า ตามเวลาไทย เช่น now = 1 ม.ค. 2027 → ธ.ค. 2026 */
  function previousMonthRange(now) {
    var p = bangkokParts(now), y = p.y, m = p.m - 1;
    if (m < 1) { m = 12; y--; }
    return monthRange(y, m);
  }

  /** ปีปฏิทินก่อนหน้า ตามเวลาไทย เช่น now = 1 ม.ค. 2027 → ปี 2026 (พ.ศ. 2569) */
  function previousYearRange(now) {
    return yearRange(bangkokParts(now).y - 1);
  }

  /**
   * แปลงตาราง "ข้อมูลคดี" (แถวแรก = หัวคอลัมน์, วันที่เป็น serial) เป็นรายการคดี
   * ไม่อ่านคอลัมน์อื่นนอกจาก COLUMNS
   */
  function parseCases(rows) {
    if (!rows || !rows.length) return [];
    var head = rows[0].map(text), ix = {};
    Object.keys(COLUMNS).forEach(function (k) {
      ix[k] = -1;
      for (var i = 0; i < head.length; i++) if (head[i].indexOf(COLUMNS[k]) === 0) { ix[k] = i; break; }
    });
    var get = function (r, k) { return ix[k] < 0 ? null : r[ix[k]]; };
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i] || [], recv = num(get(r, 'recv'));
      if (recv == null) continue;
      out.push({
        bk: text(get(r, 'bk')), report: text(get(r, 'report')),
        station: text(get(r, 'station')), province: text(get(r, 'province')),
        recvYmd: serialToYmd(recv), doneYmd: serialToYmd(get(r, 'done')), pickYmd: serialToYmd(get(r, 'pick')),
        status: text(get(r, 'status')), type: text(get(r, 'type')), officer: text(get(r, 'officer')),
        items: num(get(r, 'items')), counted: get(r, 'counted') !== 0
      });
    }
    return out;
  }

  function inRange(c, range) { return c.recvYmd >= range.start && c.recvYmd <= range.end; }

  function sortCounts(obj) {
    return Object.keys(obj).map(function (k) { return { name: k, cases: obj[k] }; }).sort(function (a, b) {
      if ((a.name === UNSPECIFIED) !== (b.name === UNSPECIFIED)) return a.name === UNSPECIFIED ? 1 : -1;
      return b.cases - a.cases || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
  }

  /**
   * สรุปช่วงวันที่ (ตามวันที่รับ, เฉพาะแถวที่นับในสถิติ)
   * @return {{range, cases:number, evidence:number, casesWithEvidence:number, notCounted:number,
   *           byType:{name,cases}[], byOfficer:{name,cases,byType:{name,cases}[]}[]}}
   */
  function summarize(cases, range) {
    var n = 0, ev = 0, withEv = 0, skipped = 0, types = {}, officers = {};
    cases.forEach(function (c) {
      if (!inRange(c, range)) return;
      if (!c.counted) { skipped++; return; }
      n++;
      if (c.items != null) { ev += c.items; withEv++; }
      var t = c.type || UNSPECIFIED, o = c.officer || UNSPECIFIED;
      types[t] = (types[t] || 0) + 1;
      var oo = officers[o] || (officers[o] = { total: 0, types: {} });
      oo.total++;
      oo.types[t] = (oo.types[t] || 0) + 1;
    });
    var byOfficer = Object.keys(officers).map(function (k) {
      return { name: k, cases: officers[k].total, byType: sortCounts(officers[k].types) };
    }).sort(function (a, b) {
      if ((a.name === UNSPECIFIED) !== (b.name === UNSPECIFIED)) return a.name === UNSPECIFIED ? 1 : -1;
      return b.cases - a.cases || (a.name < b.name ? -1 : 1);
    });
    return { range: range, cases: n, evidence: ev, casesWithEvidence: withEv, notCounted: skipped,
      byType: sortCounts(types), byOfficer: byOfficer };
  }

  /**
   * สถานะสำหรับนับ ใช้กติกาเดียวกับ Dashboard (dashboard/index.html → statusOf):
   *   'รับผลไปแล้ว' = เสร็จสิ้น · มีคำว่า 'รอรับผล' = เสร็จแล้ว รอรับผล
   *   ค่าอื่นทั้งหมด (รวมช่องสถานะว่าง/สะกดอื่น) = กำลังดำเนินการ (ถือว่ายังค้าง ไม่ซ่อนคดีที่ข้อมูลไม่ครบ)
   */
  function statusGroup(status) {
    var s = text(status);
    if (s === ST_DONE) return ST_DONE;
    if (s.indexOf('รอรับผล') >= 0) return ST_WAITING;
    return ST_PROGRESS;
  }

  /**
   * คดีค้าง = แถวที่นับในสถิติ และสถานะยังไม่ใช่ "รับผลไปแล้ว" (เหมือน Dashboard เมนูระยะเวลาและงานค้าง)
   * แบ่งเป็น "กำลังดำเนินการ" (รวมแถวที่ช่องสถานะว่าง) และ "เสร็จแล้ว รอรับผล"
   * opts.today = 'YYYY-MM-DD' ใช้คำนวณจำนวนวัน (ไม่ใส่ = ไม่คำนวณ)
   * @return {{total, byStatus:{กำลังดำเนินการ:number, 'เสร็จแล้ว รอรับผล':number}, blankStatus:number,
   *           list:{bk,status,group,recvYmd,doneYmd,ageDays,waitDays}[]}}
   *   status = ค่าในชีต, group = กลุ่มที่นับ, ageDays = วันนับจากวันที่รับ,
   *   waitDays = วันนับจากวันที่ตรวจเสร็จ (เฉพาะกลุ่มรอรับผลที่มีวันที่ตรวจเสร็จ) · list เรียงจากรับก่อน
   */
  function pendingCases(cases, opts) {
    opts = opts || {};
    var byStatus = {}, list = [], blank = 0;
    PENDING_STATUSES.forEach(function (s) { byStatus[s] = 0; });
    var days = function (ymd) { return opts.today && ymd ? Math.max(0, ymdToDays(opts.today) - ymdToDays(ymd)) : null; };
    cases.forEach(function (c) {
      if (!c.counted) return;
      var g = statusGroup(c.status);
      if (g === ST_DONE) return;
      byStatus[g]++;
      if (!c.status) blank++;
      list.push({ bk: c.bk, status: c.status, group: g, recvYmd: c.recvYmd, doneYmd: c.doneYmd,
        ageDays: days(c.recvYmd), waitDays: g === ST_WAITING ? days(c.doneYmd) : null });
    });
    list.sort(function (a, b) { return a.recvYmd < b.recvYmd ? -1 : a.recvYmd > b.recvYmd ? 1 : 0; });
    return { total: list.length, byStatus: byStatus, blankStatus: blank, list: list };
  }

  /**
   * คดีค้างแยก 2 กลุ่ม สำหรับข้อความ LINE: จำนวนแต่ละกลุ่ม + เลข บก. ที่ค้างนานสุดกลุ่มละ opts.top คดี (ค่าเริ่มต้น 3)
   * กำลังดำเนินการ เรียงตามวันที่รับ (days = วันนับจากวันที่รับ)
   * เสร็จแล้ว รอรับผล เรียงตามวันที่ตรวจเสร็จ (days = วันนับจากวันที่ตรวจเสร็จ ถ้าไม่มีใช้วันที่รับ)
   * @return {{total, today, inProgress:{count, blankStatus, oldest:{bk,days}[]}, waiting:{count, oldest:{bk,days}[]}}}
   */
  function pendingByStatus(cases, opts) {
    opts = opts || {};
    var top = opts.top == null ? 3 : opts.top;
    var p = pendingCases(cases, { today: opts.today });
    var prog = p.list.filter(function (x) { return x.group === ST_PROGRESS; });
    var wait = p.list.filter(function (x) { return x.group === ST_WAITING; }).sort(function (a, b) {
      var ka = a.doneYmd || a.recvYmd, kb = b.doneYmd || b.recvYmd;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    return {
      total: p.total, today: opts.today || null,
      inProgress: { count: prog.length, blankStatus: p.blankStatus,
        oldest: prog.slice(0, top).map(function (x) { return { bk: x.bk, days: x.ageDays }; }) },
      waiting: { count: wait.length,
        oldest: wait.slice(0, top).map(function (x) { return { bk: x.bk, days: x.waitDays != null ? x.waitDays : x.ageDays }; }) }
    };
  }

  /** ทำเลขคดีให้อยู่รูปเดียวกัน: ตัดช่องว่าง, เลขไทย → อารบิก, ตัด 0 นำหน้าลำดับ */
  function normalizeCaseNo(s) {
    var t = text(s).replace(/[๐-๙]/g, function (d) { return String(d.charCodeAt(0) - 0x0E50); }).replace(/\s+/g, '');
    var m = /^0*(\d+)\/(\d{4})$/.exec(t);
    return m ? m[1] + '/' + m[2] : t;
  }

  /**
   * ค้นคดีจาก "เลข บก." (เช่น '123/2568') รวมแถวที่ไม่นับในสถิติด้วย
   * คืนเฉพาะข้อมูลสถานะ (ไม่มีชื่อผู้ตรวจ)
   * @return {{bk,report,station,province,status,type,items,recvYmd,doneYmd,pickYmd}[]} ว่าง = ไม่พบ
   */
  function findCase(cases, caseNo) {
    var q = normalizeCaseNo(caseNo);
    if (!q) return [];
    return cases.filter(function (c) { return normalizeCaseNo(c.bk) === q; }).map(function (c) {
      return { bk: c.bk, report: c.report, station: c.station, province: c.province, status: c.status,
        type: c.type || UNSPECIFIED, items: c.items, recvYmd: c.recvYmd, doneYmd: c.doneYmd, pickYmd: c.pickYmd };
    });
  }

  return {
    UNSPECIFIED: UNSPECIFIED, PENDING_STATUSES: PENDING_STATUSES, STATUS_DONE: ST_DONE, COLUMNS: COLUMNS,
    parseCases: parseCases, summarize: summarize, pendingCases: pendingCases, pendingByStatus: pendingByStatus,
    statusGroup: statusGroup, findCase: findCase, ymdToDays: ymdToDays,
    normalizeCaseNo: normalizeCaseNo, monthRange: monthRange, yearRange: yearRange,
    previousMonthRange: previousMonthRange, previousYearRange: previousYearRange,
    todayYmd: todayYmd, serialToYmd: serialToYmd
  };
})();
