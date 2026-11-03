#!/usr/bin/env python3
"""แปลง dashboard/samples/*.xlsx (ข้อมูลจำลอง) เป็น JSON ให้ mock ของ SpreadsheetApp ใช้
และคำนวณผลที่คาดไว้ด้วย Python แยกจาก Stats.gs (วิธีอิสระ) เพื่อเทียบกัน

ใช้: python3 apps-script/test/make_fixtures.py <โฟลเดอร์ผลลัพธ์>
ผลลัพธ์: sheets.json (ค่าทุกแท็บ) และ expected.json (ตัวเลขที่ควรได้)
"""
import json
import sys
from datetime import date, datetime
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[2]
SAMPLES = ROOT / "dashboard" / "samples"
UN = "ไม่ระบุ"
PENDING = ("กำลังดำเนินการ", "เสร็จแล้ว รอรับผล")
TODAY = date(2026, 10, 31)   # "วันนี้" ของข้อมูลจำลอง ใช้คำนวณจำนวนวันที่ค้าง


def status_group(st):
    """กติกาเดียวกับ Dashboard: รับผลไปแล้ว = เสร็จ, มี 'รอรับผล' = รอรับผล, อื่น ๆ (รวมว่าง) = กำลังดำเนินการ"""
    if st == "รับผลไปแล้ว":
        return "done"
    return PENDING[1] if "รอรับผล" in st else PENDING[0]


def cell(v):
    if isinstance(v, datetime):
        return {"$date": v.strftime("%Y-%m-%dT%H:%M:%S")}
    if isinstance(v, date):
        return {"$date": v.strftime("%Y-%m-%dT00:00:00")}
    return "" if v is None else v


def dump_book(path):
    wb = load_workbook(path)  # ค่าที่เก็บ (ไม่มีสูตรในไฟล์จำลอง)
    out = {}
    for ws in wb.worksheets:
        grid = [[cell(v) for v in row] for row in ws.iter_rows(values_only=True)]
        out[ws.title] = grid
    return out


def serial(d):
    return (d - datetime(1899, 12, 30)).total_seconds() / 86400


def expected(cases_grid):
    head = cases_grid[0]
    col = {h: i for i, h in enumerate(head)}
    rows = []
    for r in cases_grid[1:]:
        recv = r[col["วันที่รับ"]]
        if not isinstance(recv, dict):
            continue
        d = datetime.strptime(recv["$date"], "%Y-%m-%dT%H:%M:%S").date()
        dn = r[col["วันที่ตรวจเสร็จ"]]
        done = datetime.strptime(dn["$date"], "%Y-%m-%dT%H:%M:%S").date() if isinstance(dn, dict) else None
        items = r[col["ของกลาง (ชิ้น)"]]
        rows.append({
            "bk": str(r[col["เลข บก."]]).strip(), "d": d, "status": str(r[col["สถานะ"]] or "").strip(),
            "type": str(r[col["ประเภทคดี (เลือก)"]] or "").strip() or UN,
            "officer": str(r[col["ผู้ตรวจ (เลือก)"]] or "").strip() or UN,
            "items": items if isinstance(items, (int, float)) and not isinstance(items, bool) else None,
            "counted": r[col["นับในสถิติ"]] != 0, "done": done,
        })

    def summary(start, end):
        sel = [x for x in rows if start <= x["d"] <= end and x["counted"]]
        by_type, by_off = {}, {}
        for x in sel:
            by_type[x["type"]] = by_type.get(x["type"], 0) + 1
            o = by_off.setdefault(x["officer"], {"cases": 0, "types": {}})
            o["cases"] += 1
            o["types"][x["type"]] = o["types"].get(x["type"], 0) + 1
        return {"start": start.isoformat(), "end": end.isoformat(), "cases": len(sel),
                "evidence": sum(x["items"] for x in sel if x["items"] is not None),
                "notCounted": sum(1 for x in rows if start <= x["d"] <= end and not x["counted"]),
                "byType": by_type, "byOfficer": by_off}

    def month(y, m):
        nxt = date(y + (m == 12), m % 12 + 1, 1)
        return summary(date(y, m, 1), date.fromordinal(nxt.toordinal() - 1))

    ranges = {
        "2022-12": month(2022, 12), "2023-01": month(2023, 1),      # ข้ามปี ธ.ค. → ม.ค.
        "2025-09": month(2025, 9), "2025-10": month(2025, 10),      # ข้ามปีงบ ก.ย. → ต.ค.
        "2026-10": month(2026, 10),                                  # เดือนล่าสุดของข้อมูลจำลอง
        "2025": summary(date(2025, 1, 1), date(2025, 12, 31)),      # ปีปฏิทินเต็ม
        "2022": summary(date(2022, 1, 1), date(2022, 12, 31)),
    }
    pend = [x for x in rows if x["counted"] and status_group(x["status"]) != "done"]
    prog = sorted((x for x in pend if status_group(x["status"]) == PENDING[0]), key=lambda x: x["d"])
    wait = sorted((x for x in pend if status_group(x["status"]) == PENDING[1]), key=lambda x: x["done"] or x["d"])
    first = rows[0]
    return {
        "ranges": ranges,
        "pending": {"total": len(pend), "byStatus": {s: sum(1 for x in pend if status_group(x["status"]) == s) for s in PENDING},
                    "oldest": min(pend, key=lambda x: x["d"])["bk"] if pend else None,
                    "today": TODAY.isoformat(),
                    "blankStatus": sum(1 for x in pend if not x["status"]),
                    "top3Progress": [[x["bk"], (TODAY - x["d"]).days] for x in prog[:3]],
                    "top3Waiting": [[x["bk"], (TODAY - (x["done"] or x["d"])).days] for x in wait[:3]]},
        "lookup": {"bk": first["bk"], "recvYmd": first["d"].isoformat(), "status": first["status"],
                   "count": sum(1 for x in rows if x["bk"] == first["bk"])},
        "firstRecvSerial": serial(datetime.combine(first["d"], datetime.min.time())),
        "allCounted": sum(1 for x in rows if x["counted"]),
    }


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent / ".out"
    out.mkdir(parents=True, exist_ok=True)
    sheets = {"cases": dump_book(SAMPLES / "cases.xlsx"), "lab": dump_book(SAMPLES / "lab.xlsx")}
    (out / "sheets.json").write_text(json.dumps(sheets, ensure_ascii=False), encoding="utf-8")
    exp = expected(sheets["cases"]["ข้อมูลคดี"])
    exp["users"] = [r[0] for r in sheets["cases"]["ผู้ใช้"][1:] if r and r[0]]
    (out / "expected.json").write_text(json.dumps(exp, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"fixtures → {out}")


if __name__ == "__main__":
    main()
