#!/usr/bin/env python3
"""สร้างข้อมูลจำลอง (ปลอมทั้งหมด) สำหรับ dashboard/samples/cases.xlsx และ lab.xlsx

- seed คงที่ + วันอ้างอิงคงที่ (AS_OF) => รันซ้ำได้ไฟล์เดิมทุกไบต์
- ชื่อ/เลขทุกค่าเป็นของสมมติ: เจ้าหน้าที่ ก..จ, สภ.ตัวอย่าง1..15, หนังสือ ตย.0000/xxx,
  อีเมล staffN@example.com · ไม่มี DNA profile
- ไม่มีคอลัมน์ User ID (LINE) แล้ว (เจ้าของลบคอลัมน์นี้ออกจากชีตจริง ระบบห้ามพึ่งคอลัมน์นี้)
- โครงสร้างแท็บ/คอลัมน์ตาม docs/data-schema.md และตัวอ่านใน dashboard/index.html
  (buildCases / buildLab): หัวคอลัมน์อยู่แถว 1, วันที่เก็บเป็นวันที่ Excel (serial)

ใช้: python3 tools/make_mock_data.py
"""
import io
import random
import re
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font

SEED = 20260101
AS_OF = date(2026, 10, 31)          # "วันนี้" ของข้อมูลจำลอง (คงที่ ไม่ใช้วันที่เครื่อง)
START = date(2022, 1, 1)
THRESHOLD = 40                      # เกณฑ์ของกลางผิดปกติ (ชิ้น)
FIXED_TS = datetime(2026, 1, 1, 0, 0, 0)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dashboard" / "samples"

OFFICERS = [f"เจ้าหน้าที่ {c}" for c in "กขคงจ"]
CASE_TYPES = ["ทรัพย์", "เพศ", "ชีวิตและร่างกาย", "พรบ.อาวุธปืน", "ยาเสพติด", "อื่น ๆ"]
TYPE_W = [38, 18, 20, 10, 9, 5]
# สภ. สมมติ กระจายในจังหวัดจริง (ภาคอีสาน) · น้ำหนัก = ความถี่ในการส่งตรวจ
STATIONS = [(f"สภ.ตัวอย่าง{i}", p, w) for i, (p, w) in enumerate([
    ("นครราชสีมา", 14), ("นครราชสีมา", 11), ("นครราชสีมา", 9), ("นครราชสีมา", 7), ("นครราชสีมา", 5),
    ("บุรีรัมย์", 8), ("บุรีรัมย์", 6), ("บุรีรัมย์", 4),
    ("ชัยภูมิ", 6), ("ชัยภูมิ", 4), ("ชัยภูมิ", 3),
    ("สุรินทร์", 5), ("สุรินทร์", 3),
    ("ขอนแก่น", 3), ("ขอนแก่น", 2)], start=1)]
ST_PROG, ST_WAIT, ST_DONE = "กำลังดำเนินการ", "เสร็จแล้ว รอรับผล", "รับผลไปแล้ว"
FY_MONTHS = ["ต.ค.", "พ.ย.", "ธ.ค.", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย."]
DATE_FMT = "dd/mm/yyyy"

CASE_HEAD = ["เลข บก.", "เลขรายงาน", "สภ. (ท้องที่)", "จังหวัด", "เลขหนังสือนำส่ง", "ลงวันที่", "วันที่รับ",
             "วันที่ตรวจเสร็จ", "วันที่มารับผล", "สถานะ", "ประเภทคดี (เลือก)", "ผู้ตรวจ (เลือก)", "ของกลาง (ชิ้น)",
             "เดือนที่รับ", "ปี พ.ศ. (รับ)", "นับในสถิติ", "ข้อสังเกต (ผิดปกติ)", "ปีเลขรายงาน", "ลำดับเลขรายงาน",
             "อันดับ (ช่วยคำนวณ)", "ตั้งค่า", "เกณฑ์ของกลางผิดปกติ (ชิ้น) >"]
DATE_COLS = {"ลงวันที่", "วันที่รับ", "วันที่ตรวจเสร็จ", "วันที่มารับผล"}


def fy_of(d):
    """ปีงบประมาณ พ.ศ. (ต.ค.–ก.ย.) และลำดับเดือนในปีงบ (ต.ค. = 1)"""
    return d.year + 543 + (1 if d.month >= 10 else 0), (d.month + 2) % 12 + 1


def month_iter(a, b):
    y, m = a.year, a.month
    while (y, m) <= (b.year, b.month):
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def days_in_month(y, m):
    return ((date(y + (m == 12), m % 12 + 1, 1)) - date(y, m, 1)).days


# ---------------------------------------------------------------- cases
def gen_cases(rng):
    recv_dates = []
    for y, m in month_iter(START, AS_OF):
        season = {1: .9, 2: .95, 3: 1.05, 4: .85, 5: 1.0, 6: 1.05, 7: 1.1, 8: 1.1, 9: 1.0, 10: 1.0, 11: .95, 12: .9}[m]
        trend = 1 + (y - 2022) * 0.06
        n = max(5, round(rng.gauss(11.0 * season * trend, 2.2)))
        last = min(days_in_month(y, m), AS_OF.day if (y, m) == (AS_OF.year, AS_OF.month) else 31)
        for _ in range(n):
            d = date(y, m, rng.randint(1, last))
            while d.weekday() == 6:  # เลี่ยงวันอาทิตย์
                d = date(y, m, rng.randint(1, last))
            recv_dates.append(d)
    # กรณีขอบ: ข้ามปี (31 ธ.ค. / 1 ม.ค.) และข้ามปีงบ (30 ก.ย. / 1 ต.ค.)
    for y in range(2022, 2027):
        for d in (date(y, 9, 30), date(y, 10, 1), date(y, 12, 31), date(y, 1, 1)):
            if START <= d <= AS_OF:
                recv_dates.append(d)
    recv_dates.sort()

    stations = [(s, p) for s, p, _ in STATIONS]
    st_w = [w for _, _, w in STATIONS]
    seq_bk, seq_rep, rows = {}, {}, []
    letter_no = 100
    for i, recv in enumerate(recv_dates):
        by = recv.year + 543
        seq_bk[by] = seq_bk.get(by, 0) + 1
        seq_rep[by] = seq_rep.get(by, 0) + rng.randint(1, 3)   # เลขรายงานไม่ต่อเนื่อง (หน่วยอื่นใช้เลขด้วย)
        letter_no += rng.randint(1, 4)
        pol, prov = rng.choices(stations, st_w)[0]
        lead = rng.choices([0, 1, 2, 3, 5, 7, 10], [10, 25, 20, 15, 12, 10, 8])[0]
        signed = recv - timedelta(days=lead)
        items = rng.choices(range(1, 13), [14, 16, 14, 11, 9, 8, 7, 6, 5, 4, 3, 3])[0]
        age = (AS_OF - recv).days
        tat = max(3, round(rng.lognormvariate(3.0, 0.45)))     # รับ -> ตรวจเสร็จ (มัธยฐาน ~20 วัน)
        done = recv + timedelta(days=tat)
        stuck = age > 60 and rng.random() < 0.012              # คดีเก่าค้างนาน (น้อยมาก)
        if done > AS_OF or stuck:
            status, done, pick = ST_PROG, None, None
        else:
            gap = round(rng.lognormvariate(2.0, 0.8))         # ตรวจเสร็จ -> มารับผล
            pick = done + timedelta(days=gap)
            if pick > AS_OF or rng.random() < 0.03:
                status, pick = ST_WAIT, None
            else:
                status = ST_DONE
        typ = rng.choices(CASE_TYPES, TYPE_W)[0] if rng.random() < 0.85 else None
        exa = rng.choice(OFFICERS) if rng.random() < 0.85 else None
        rows.append(dict(bk=f"{seq_bk[by]}/{by}", rep=f"03-{by % 100:02d}-{seq_rep[by]:05d}", rep_y=by,
                         rep_n=seq_rep[by], pol=pol, prov=prov, letter=f"ตย.0000/{letter_no}", signed=signed,
                         recv=recv, done=done, pick=pick, status=status, typ=typ, exa=exa, items=items,
                         counted=1, flags=[]))

    # กรณีขอบ: ของกลางผิดปกติ (เกินเกณฑ์) · ไม่ระบุของกลาง · ลงวันที่หลังวันที่รับ · ไม่นับในสถิติ
    picks = rng.sample(range(len(rows)), 12)
    for k, v in zip(picks[:5], [48, 55, 63, 86, 120]):
        rows[k]["items"] = v
    for k in picks[5:7]:
        rows[k]["items"] = None
    for k in picks[7:9]:
        rows[k]["signed"] = rows[k]["recv"] + timedelta(days=rng.randint(2, 6))
    for k in picks[9:12]:
        rows[k]["counted"] = 0
        rows[k]["flags"].append("ยกเลิกการส่งตรวจ (ไม่นับในสถิติ)")
    for r in rows:
        if r["items"] is None:
            r["flags"].append("ไม่ระบุจำนวนของกลาง")
        elif r["items"] > THRESHOLD:
            r["flags"].append(f"ของกลางเกินเกณฑ์ ({THRESHOLD} ชิ้น)")
        if r["signed"] > r["recv"]:
            r["flags"].append("ลงวันที่หลังวันที่รับ")
    # เดิมสุ่ม LINE User ID สมมติตรงนี้ คอลัมน์ถูกลบแล้ว แต่ยังเรียก rng เท่าเดิม
    # เพื่อให้ข้อมูลส่วนอื่น (เช่น lab.xlsx ที่สุ่มต่อจากนี้) เหมือนเดิมทุกค่า
    for _ in rows:
        if rng.random() < 0.3:
            rng.randint(1, 25)
    return rows


def write_cases(rows):
    wb = Workbook()
    ws = wb.active
    ws.title = "Dashboard"
    ws.append(["Dashboard (ข้อมูลจำลอง) — แท็บสรุปนี้เป็นตัวยึดตำแหน่ง Dashboard เว็บไม่ได้อ่านแท็บนี้"])
    for t in ("สภ.และประเภทคดี", "ผู้ตรวจ"):
        wb.create_sheet(t).append([f"{t} (ข้อมูลจำลอง) — แท็บสรุปนี้เป็นตัวยึดตำแหน่ง Dashboard เว็บไม่ได้อ่านแท็บนี้"])

    ws = wb.create_sheet("ข้อมูลคดี")
    ws.append(CASE_HEAD)
    for i, r in enumerate(rows):
        ws.append([r["bk"], r["rep"], r["pol"], r["prov"], r["letter"], r["signed"], r["recv"], r["done"], r["pick"],
                   r["status"], r["typ"], r["exa"], r["items"], date(r["recv"].year, r["recv"].month, 1),
                   r["recv"].year + 543, r["counted"], "; ".join(r["flags"]) or None, r["rep_y"], r["rep_n"],
                   i + 1,
                   "เกณฑ์ของกลางผิดปกติ (ชิ้น)" if i == 0 else None, THRESHOLD if i == 0 else None])
    for j, h in enumerate(CASE_HEAD, start=1):
        fmt = DATE_FMT if h in DATE_COLS else "mmm yyyy" if h == "เดือนที่รับ" else None
        if fmt:
            for (c,) in ws.iter_rows(min_row=2, min_col=j, max_col=j):
                c.number_format = fmt
        ws.cell(1, j).font = Font(bold=True)
    ws.freeze_panes = "A2"

    ws = wb.create_sheet("ผู้ใช้")
    ws.append(["อีเมล", "ชื่อ", "หมายเหตุ"])
    for k, name in enumerate(OFFICERS[:3], start=1):
        ws.append([f"staff{k}@example.com", name, "บัญชีสมมติสำหรับทดสอบ"])
    return wb


# ---------------------------------------------------------------- lab
def gen_lab(rng, case_rows):
    by_month = {}
    for r in case_rows:
        if r["counted"] and r["items"] is not None:
            k = (r["recv"].year, r["recv"].month)
            by_month[k] = by_month.get(k, 0) + r["items"]
    cases = []
    for y, m in month_iter(START, AS_OF):
        fy, idx = fy_of(date(y, m, 1))
        items = by_month.get((y, m), 0)
        samples = round(items * rng.uniform(1.5, 2.1)) + rng.randint(5, 20)   # รวมตัวอย่างอ้างอิง/ควบคุม
        note = None
        if (y, m) == (AS_OF.year, AS_OF.month):
            note = "ข้อมูลถึงสิ้นเดือน (จำลอง)"
        cases.append([fy, idx, FY_MONTHS[idx - 1], y + 543, items, samples, note])
    # กรณีขอบ: เดือนที่มีแต่จำนวนตัวอย่าง ไม่มีของกลาง
    cases[2][4] = None
    cases[2][6] = "ไม่มีข้อมูลของกลางเดือนนี้ (จำลอง)"

    budget = []
    for fy in range(2565, 2571):
        partial = fy == 2570
        base = 1.0 + (fy - 2565) * 0.05
        plan = [("ค่าวัสดุสำนักงานและดำเนินงาน", "งบดำเนินงาน", 180000), ("น้ำยาสกัดและเพิ่มปริมาณ DNA", "วัสดุวิทย์ฯ", 950000),
                ("วัสดุสิ้นเปลืองห้องปฏิบัติการ", "วัสดุวิทย์ฯ", 320000), ("ใช้เงินเหลือจ่ายซื้อวัสดุเพิ่ม", "เหลือจ่าย", 120000),
                ("ซ่อมบำรุงเครื่องมือ", "ซ่อมบำรุง", 150000), ("สอบเทียบเครื่องมือ", "สอบเทียบ", 60000),
                ("รายการพิเศษ (จำลอง)", "อื่นๆ/เหตุพิเศษ", 40000), ("ค่าเก็บขยะติดเชื้อ", "ขยะติดเชื้อ", 24000)]
        if partial:
            plan = plan[:2]
        for item, cat, amt in plan:
            if cat == "อื่นๆ/เหตุพิเศษ" and fy % 2:
                continue
            v = round(amt * base * (0.25 if partial else rng.uniform(0.85, 1.15)), -2)
            budget.append([fy, item, cat, v, "งบตั้งต้นปีงบใหม่ (จำลอง)" if partial else None])

    lots, d, n = [], date(2022, 1, 10), 0
    while d <= AS_OF:
        n += 1
        est = rng.random() < 0.15
        written = None if est else d
        # รอบพัสดุ 26–25: วันที่ 26 ขึ้นไปนับเป็นรอบของเดือนถัดไป
        cy, cm = (d.year, d.month + (1 if d.day >= 26 else 0))
        if cm > 12:
            cy, cm = cy + 1, 1
        cyc_end = date(cy, cm, 25)
        lots.append([n, "Lot ปี " + str(d.year + 543), n + 3, written, d, f"MOCK-{d.year % 100:02d}-{n:03d}",
                     rng.randint(60, 140), "ประมาณการจากลำดับ Lot ก่อน-หลัง" if est else "ระบุในต้นฉบับ",
                     cyc_end, fy_of(cyc_end)[0], 1 if est else 0])
        d += timedelta(days=rng.randint(14, 30))
    # กรณีขอบ: Lot วันที่ 25 / 26 (ขอบรอบพัสดุ) และ 30 ก.ย. (ขอบปีงบ)
    for extra in (date(2024, 9, 25), date(2024, 9, 26), date(2025, 9, 30)):
        n += 1
        cy, cm = extra.year, extra.month + (1 if extra.day >= 26 else 0)
        cyc_end = date(cy + (cm > 12), (cm - 1) % 12 + 1, 25)
        lots.append([n, "Lot ปี " + str(extra.year + 543), n + 3, extra, extra, f"MOCK-{extra.year % 100:02d}-{n:03d}",
                     rng.randint(60, 140), "ระบุในต้นฉบับ", cyc_end, fy_of(cyc_end)[0], 0])
    return cases, budget, lots


def write_lab(cases, budget, lots):
    wb = Workbook()
    ws = wb.active
    ws.title = "Dashboard"
    ws.append(["Dashboard (ข้อมูลจำลอง) — แท็บสรุปนี้เป็นตัวยึดตำแหน่ง Dashboard เว็บไม่ได้อ่านแท็บนี้"])
    for t in ("สรุปรายเดือน", "สรุปรายปี", "งบประมาณ", "Lot 26-25"):
        wb.create_sheet(t).append([f"{t} (ข้อมูลจำลอง) — แท็บสรุปนี้เป็นตัวยึดตำแหน่ง Dashboard เว็บไม่ได้อ่านแท็บนี้"])

    ws = wb.create_sheet("ข้อมูลเคส")
    ws.append(["ปีงบประมาณ (พ.ศ.)", "ลำดับเดือนในปีงบ", "เดือน", "ปีปฏิทิน (พ.ศ.)", "จำนวนของกลาง (ชิ้น)",
               "จำนวนตัวอย่างตรวจ", "หมายเหตุ"])
    for r in cases:
        ws.append(r)

    ws = wb.create_sheet("ข้อมูลงบ")
    ws.append(["ปีงบประมาณ (พ.ศ.)", "รายการ (ตามต้นฉบับ)", "หมวด", "จำนวนเงิน (บาท)", "หมายเหตุ"])
    for r in budget:
        ws.append(r)
    for (c,) in ws.iter_rows(min_row=2, min_col=4, max_col=4):
        c.number_format = "#,##0"

    ws = wb.create_sheet("ข้อมูล Lot")
    ws.append(["ลำดับ", "ชีตต้นฉบับ", "แถวต้นฉบับ", "วันที่ในต้นฉบับ", "วันที่ใช้คำนวณ (แก้ไขได้)", "Lot No.",
               "จำนวนตัวอย่าง", "ที่มาของวันที่", "รอบพัสดุ (26–25) สิ้นสุดเดือน", "ปีงบ (ตามรอบ)",
               "วันที่ประมาณการ (1=ใช่)"])
    for r in lots:
        ws.append(r)
    for col in (4, 5, 9):
        for (c,) in ws.iter_rows(min_row=2, min_col=col, max_col=col):
            c.number_format = DATE_FMT

    ws = wb.create_sheet("หมายเหตุ")
    ws.append(["หัวข้อ", "รายละเอียด"])
    ws.append(["ที่มาของข้อมูล", "ข้อมูลจำลองทั้งหมด สร้างโดย tools/make_mock_data.py ไม่ใช่ข้อมูลจริง"])
    ws.append(["ปีงบประมาณ", "นับ ต.ค. – ก.ย. (ต.ค. = เดือนที่ 1 ของปีงบ)"])
    ws.append(["รอบ Lot พัสดุ", "วันที่ 26 ของเดือนก่อน ถึงวันที่ 25 ของเดือนนี้"])
    ws.append(["วันที่ประมาณการ", "Lot ที่ไม่มีวันที่ในต้นฉบับ ใช้วันที่ประมาณจากลำดับ Lot ก่อน-หลัง"])
    return wb


# ---------------------------------------------------------------- save (ไบต์คงที่)
def save_deterministic(wb, path):
    wb.properties.creator = "make_mock_data.py"
    wb.properties.created = FIXED_TS
    wb.properties.modified = FIXED_TS
    buf = io.BytesIO()
    wb.save(buf)
    src = zipfile.ZipFile(io.BytesIO(buf.getvalue()))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == "docProps/core.xml":   # openpyxl เขียนเวลาบันทึกจริงทับ
                data = re.sub(rb"(<dcterms:modified[^>]*>)[^<]*", rb"\g<1>2026-01-01T00:00:00Z", data)
            zi = zipfile.ZipInfo(info.filename, date_time=(2026, 1, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(zi, data)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(out.getvalue())


def main():
    rng = random.Random(SEED)
    rows = gen_cases(rng)
    save_deterministic(write_cases(rows), OUT / "cases.xlsx")
    cases, budget, lots = gen_lab(rng, rows)
    save_deterministic(write_lab(cases, budget, lots), OUT / "lab.xlsx")
    print(f"cases.xlsx: ข้อมูลคดี {len(rows)} แถว · ผู้ใช้ 3 แถว")
    print(f"lab.xlsx: ข้อมูลเคส {len(cases)} แถว · ข้อมูลงบ {len(budget)} แถว · ข้อมูล Lot {len(lots)} แถว")


if __name__ == "__main__":
    main()
