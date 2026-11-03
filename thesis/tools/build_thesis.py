#!/usr/bin/env python3
"""สร้างเล่มโครงงานรูปแบบ มทส. จากร่าง Markdown

    python3 thesis/tools/build_thesis.py

อ่าน   thesis/drafts/*.md   และ   thesis/template/*.docx
เขียน  thesis/build/เล่มโครงงาน.docx, thesis/build/เล่มโครงงาน.pdf,
       thesis/build/build-log.txt (ผลตรวจอัตโนมัติ), thesis/build/figures/*.png (ภาพ Mermaid)

ไม่แก้ไขไฟล์ใน thesis/drafts/ (การจัดเลขอ้างอิงใหม่ทำเฉพาะในไฟล์ผลลัพธ์)
ดูรายละเอียดใน thesis/tools/README.md
"""
from __future__ import annotations

import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import zipfile
from pathlib import Path

import docx
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ROW_HEIGHT_RULE
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_COLOR_INDEX, WD_TAB_ALIGNMENT, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, Twips, Emu, RGBColor

# ---------------------------------------------------------------------------
# ตำแหน่งไฟล์
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parents[2]
TPL = ROOT / "thesis" / "template"
DRAFTS = ROOT / "thesis" / "drafts"
BUILD = ROOT / "thesis" / "build"
TOOLS = ROOT / "thesis" / "tools"
FIG_DIR = BUILD / "figures"
OUT_DOCX = BUILD / "เล่มโครงงาน.docx"
OUT_PDF = BUILD / "เล่มโครงงาน.pdf"
OUT_LOG = BUILD / "build-log.txt"

BASE_TEMPLATE = TPL / "05-บทที่1-บทนำ.docx"   # ใช้ styles/settings/ขนาดหน้าของไฟล์นี้เป็นฐาน
COVER_TEMPLATE = TPL / "01-ปก.docx"           # ใช้ตรามหาวิทยาลัยและระยะขอบปก

# ---------------------------------------------------------------------------
# ข้อมูลโครงงาน (จาก CLAUDE.md)  ค่า None = ยังไม่ทราบ -> [รอใส่]
# ---------------------------------------------------------------------------
META = {
    "title_th": "ระบบแดชบอร์ดและแชตบอตปัญญาประดิษฐ์เพื่อติดตามและสรุปสถานะคดีส่งตรวจพิสูจน์ DNA",
    "title_en": "Dashboard System and AI Chatbot for Monitoring and Summarizing DNA Forensic Case Submissions",
    "author_th": "นายวงศธร อินคง",
    "author_en": "[รอใส่: ชื่อ-นามสกุลภาษาอังกฤษ]",
    "student_id": "B6621834",
    "advisor_th": "[รอใส่: ชื่ออาจารย์ที่ปรึกษา]",
    "advisor_en": "[รอใส่: Advisor name]",
    "course": "[รอใส่: รหัสและชื่อวิชา]",
    "semester": "[รอใส่: ภาคการศึกษา]",
    "year": "[รอใส่: ปีการศึกษา]",
    "school": "สำนักวิชาวิทยาศาสตร์ สาขาวิชาวิทยาศาสตร์การแพทย์",
    "university": "มหาวิทยาลัยเทคโนโลยีสุรนารี",
}

# ---------------------------------------------------------------------------
# ค่ารูปแบบที่อ่านมาจาก template (หน่วย twip = 1/20 pt; 1440 = 1 นิ้ว)
#   02–11: <w:pgSz w="11906" h="16838"/> <w:pgMar left="2160" right="1440" top="1440" bottom="1440" footer="706"/>
#   01-ปก: <w:pgMar left="1440" right="1440" top="2880" bottom="1134"/>
#   footer: PAGE field ชิดขวา (jc=end) szCs=32
#   ย่อหน้า: <w:ind firstLine="1080"/> jc=start ; หัวบท 18pt (sz=36) ตัวหนา กึ่งกลาง ; เนื้อหา 16pt (sz=32)
#   ปก: 20pt (sz=40) กึ่งกลาง ไม่หนา ; อ้างอิง: numbering "[%1]" ind start=720 hanging=720
#   ตาราง: "ตารางที่ x.y" หนา + ชื่อปกติ ชิดซ้าย อยู่เหนือตาราง ; รูป: "รูปที่ x.y" หนา + ชื่อปกติ กึ่งกลาง ใต้รูป
#   defaultTabStop = 1080 ; ข้อมูลหน้าบทคัดย่อ: ป้ายตัวหนา + tab ไปที่ 2160
# ---------------------------------------------------------------------------
FONT = "TH SarabunPSK"
MONO = "Courier New"
PAGE_W, PAGE_H = 11906, 16838
MARGIN = dict(left=2160, right=1440, top=1440, bottom=1440, header=706, footer=706)
COVER_MARGIN = dict(left=1440, right=1440, top=2880, bottom=1134, header=0, footer=0)
TEXT_W = PAGE_W - MARGIN["left"] - MARGIN["right"]          # 8306 twip = 14.65 ซม.
FIRST_LINE = 1080
SZ_BODY, SZ_CHAPTER, SZ_COVER = 16, 18, 20
INFO_TAB = 2160

LOG: list[str] = []


def log(kind: str, msg: str):
    LOG.append(f"[{kind}] {msg}")


# ===========================================================================
# 1) อ่านและแยกโครงสร้าง Markdown
# ===========================================================================
RE_FIG = re.compile(r"^\[รูปที่\s*([\d.]+)\s*[:：]\s*(.*)\]\s*$")
RE_LI = re.compile(r"^(\s*)((?:\d+\.)*\d+\)|[-*+]|\d+\.)\s+(.*)$")
RE_HEAD = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
RE_REFHEAD = re.compile(r"^(เอกสารอ้างอิง|แหล่งอ้างอิง|บรรณานุกรม|References)")


class Chapter:
    def __init__(self, path: Path):
        self.path = path
        self.num = None
        self.title = ""
        self.blocks: list[dict] = []
        self.refs_numbered: list[tuple[int, str]] = []
        self.refs_bullets: list[str] = []
        self.dropped: list[str] = []


def parse_markdown(path: Path) -> Chapter:
    ch = Chapter(path)
    lines = path.read_text(encoding="utf-8").split("\n")
    n = len(lines)
    i = 0
    blocks = ch.blocks
    in_list = False
    while i < n:
        line = lines[i].rstrip()
        s = line.strip()
        lineno = i + 1
        if not s:
            i += 1
            continue
        # code fence
        if s.startswith("```"):
            lang = s[3:].strip().lower()
            j = i + 1
            body = []
            while j < n and not lines[j].strip().startswith("```"):
                body.append(lines[j].rstrip("\n"))
                j += 1
            blocks.append(dict(t="code", lang=lang, text="\n".join(body), line=lineno))
            i = j + 1
            in_list = False
            continue
        # display equation
        if s.startswith("$$"):
            buf = s[2:]
            j = i
            while "$$" not in buf and j + 1 < n:
                j += 1
                buf += " " + lines[j].strip()
            buf = buf.split("$$")[0].strip()
            tag = None
            m = re.search(r"\\tag\{([^}]*)\}", buf)
            if m:
                tag = m.group(1)
                buf = (buf[:m.start()] + buf[m.end():]).strip()
            blocks.append(dict(t="eq", tex=buf, tag=tag, line=lineno))
            i = j + 1
            continue
        # heading
        m = RE_HEAD.match(s)
        if m:
            level = len(m.group(1))
            text = m.group(2).strip()
            in_list = False
            if level == 1:
                mm = re.match(r"บทที่\s*(\d+)\s*(.*)", text)
                if mm:
                    ch.num = int(mm.group(1))
                    ch.title = mm.group(2).strip()
                else:
                    ch.title = text
                i += 1
                continue
            if RE_REFHEAD.match(text):
                # ส่วนรายการอ้างอิงท้ายบท: เก็บไว้รวมเล่ม ไม่แสดงในเนื้อบท
                j = i + 1
                while j < n:
                    t = lines[j].strip()
                    mr = re.match(r"^\[(\d+)\]\s+(.*)$", t)
                    if mr:
                        ch.refs_numbered.append((int(mr.group(1)), mr.group(2).strip()))
                    elif re.match(r"^[-*+]\s+", t):
                        ch.refs_bullets.append(re.sub(r"^[-*+]\s+", "", t))
                    elif t and not t.startswith(">"):
                        ch.dropped.append(f"บรรทัด {j + 1} (ส่วนอ้างอิง): {t}")
                    j += 1
                i = n
                continue
            blocks.append(dict(t="h", level=level, text=text, line=lineno))
            i += 1
            continue
        # blockquote = หมายเหตุของผู้เขียนถึงบรรณาธิการ ไม่ใส่ในเล่ม
        if s.startswith(">"):
            ch.dropped.append(f"บรรทัด {lineno} (blockquote): {s.lstrip('> ').strip()}")
            i += 1
            continue
        if re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", s):
            i += 1
            continue
        # table
        if s.startswith("|"):
            rows = []
            j = i
            while j < n and lines[j].strip().startswith("|"):
                rows.append(lines[j].strip())
                j += 1
            caption = None
            if blocks and blocks[-1]["t"] == "p" and re.match(r"^ตารางที่\s*\d", blocks[-1]["text"]):
                caption = blocks.pop()["text"]
            blocks.append(dict(t="table", caption=caption, rows=parse_table(rows), line=lineno))
            i = j
            in_list = False
            continue
        # figure placeholder
        m = RE_FIG.match(s)
        if m:
            blocks.append(dict(t="fig", num=m.group(1).rstrip("."), desc=m.group(2).strip(), line=lineno))
            i += 1
            in_list = False
            continue
        # list item
        m = RE_LI.match(line)
        if m:
            indent = len(m.group(1).replace("\t", "    "))
            marker = m.group(2)
            kind = "bullet" if marker in "-*+" else "num"
            level = 1 if (indent >= 2 or re.match(r"^\d+\.\d+", marker)) else 0
            blocks.append(dict(t="li", kind=kind, level=level, marker=marker, text=m.group(3).strip(), line=lineno))
            in_list = True
            i += 1
            continue
        # indented continuation of a list item
        if in_list and line.startswith(("  ", "\t")):
            blocks.append(dict(t="licont", text=s, line=lineno))
            i += 1
            continue
        # paragraph (join soft-wrapped lines)
        buf = [s]
        j = i + 1
        while j < n:
            t = lines[j].strip()
            if (not t or t.startswith(("#", "|", ">", "```", "$$", "[รูปที่")) or RE_LI.match(lines[j])
                    or re.fullmatch(r"(-{3,}|\*{3,})", t)):
                break
            buf.append(t)
            j += 1
        blocks.append(dict(t="p", text=" ".join(buf), line=lineno))
        in_list = False
        i = j
    return ch


def parse_table(rows: list[str]):
    def cells(r):
        r = r.strip()
        if r.startswith("|"):
            r = r[1:]
        if r.endswith("|"):
            r = r[:-1]
        parts = re.split(r"(?<!\\)\|", r)
        return [p.strip().replace("\\|", "|") for p in parts]

    out = [cells(r) for r in rows]
    align = None
    if len(out) >= 2 and all(re.fullmatch(r":?-{2,}:?", c) for c in out[1] if c):
        spec = out[1]
        align = ["center" if c.startswith(":") and c.endswith(":") else "right" if c.endswith(":") else
                 ("left" if c.startswith(":") else None) for c in spec]
        out = [out[0]] + out[2:]
    ncol = max(len(r) for r in out)
    out = [r + [""] * (ncol - len(r)) for r in out]
    return dict(header=out[0], body=out[1:], align=align or [None] * ncol)


# ===========================================================================
# 2) รวมและจัดเลขเอกสารอ้างอิงใหม่ (เฉพาะในเล่มที่สร้าง)
# ===========================================================================
RE_URL = re.compile(r"https?://[^\s)\]>]+")
RE_CITE = re.compile(r"\[(\d+)\]\s*[–-]\s*\[(\d+)\]|\[(\d+)\]|\[อ้างอิง:\s*([^\]]*)\]")


def norm_url(u: str) -> str:
    u = u.strip().rstrip(".,;)")
    u = re.sub(r"^https?://", "", u.lower())
    u = re.sub(r"^www\.", "", u)
    return u.rstrip("/")


def norm_title(t: str) -> str:
    t = unicodedata.normalize("NFC", t).lower()
    return re.sub(r"[\s\"“”'‘’.,:;*_()\[\]–—-]+", "", t)


def ref_key(text: str) -> str:
    urls = RE_URL.findall(text)
    if urls:
        return "url:" + norm_url(urls[0])
    m = re.search(r"[“\"](.+?)[”\"]", text)
    title = m.group(1) if m else text.split(",")[0]
    return "title:" + norm_title(title)


class RefRegistry:
    def __init__(self):
        self.entries: dict[str, dict] = {}      # key -> {text, origin}
        self.numbered: dict[int, str] = {}      # เลขเดิมในร่าง (บทที่ 1–2 ใช้ลำดับร่วมกัน) -> key
        self.order: list[str] = []              # ลำดับที่อ้างครั้งแรก
        self.duplicates: list[str] = []
        self.unresolved: list[str] = []

    def add(self, text: str, origin: str) -> str:
        key = ref_key(text)
        if key in self.entries:
            self.duplicates.append(f"{origin} ซ้ำกับ {self.entries[key]['origin']}: {short(text)}")
        else:
            self.entries[key] = dict(text=text, origin=origin)
        return key

    def cite_key(self, key: str) -> int:
        if key not in self.order:
            self.order.append(key)
        return self.order.index(key) + 1

    def final_list(self):
        uncited = [k for k in self.entries if k not in self.order]
        return [(i + 1, self.entries[k]) for i, k in enumerate(self.order + uncited)], uncited


def short(s: str, n: int = 90) -> str:
    s = re.sub(r"\s+", " ", s)
    return s if len(s) <= n else s[:n] + "…"


def clean_ref_text(text: str) -> str:
    # ตัดหมายเหตุของผู้เขียนออกจากรายการอ้างอิง (ไม่ใช่ส่วนหนึ่งของรูปแบบ IEEE)
    text = re.sub(r"\s*\(อ้างซ้ำ[^)]*\)", "", text)
    text = re.sub(r"\s*\(เปิดแล้วถูกเปลี่ยนเส้นทาง[^)]*\)", "", text)
    if "[Online]" in text and "เข้าถึงเมื่อ" not in text and "[รอใส่" not in text:
        text = text.rstrip() + " (เข้าถึงเมื่อ 3 พ.ย. 2569)"
    return text


def build_references(chapters: list[Chapter]) -> RefRegistry:
    reg = RefRegistry()
    for ch in chapters:
        for num, text in ch.refs_numbered:
            text = clean_ref_text(text)
            key = reg.add(text, f"{ch.path.name} [{num}]")
            if num in reg.numbered and reg.numbered[num] != key:
                log("อ้างอิง", f"เลข [{num}] ถูกใช้กับแหล่งต่างกันใน {ch.path.name}")
            reg.numbered.setdefault(num, key)
        for text in ch.refs_bullets:
            reg.add(clean_ref_text(text), f"{ch.path.name} (รายการไม่มีเลข)")

    # ผ่านเนื้อหาตามลำดับการอ่าน เพื่อหาลำดับที่อ้างครั้งแรก แล้วเขียนเลขใหม่
    def rewrite(text: str, where: str) -> str:
        def one(num: int) -> int | None:
            key = reg.numbered.get(num)
            if key is None:
                reg.unresolved.append(f"{where}: [{num}] ไม่มีในรายการอ้างอิง")
                return None
            return reg.cite_key(key)

        def repl(m):
            if m.group(1):
                a, b = int(m.group(1)), int(m.group(2))
                nums = [one(k) for k in range(a, b + 1)]
                nums = [x for x in nums if x]
                if not nums:
                    return m.group(0)
                nums = sorted(set(nums))
                if nums == list(range(nums[0], nums[-1] + 1)) and len(nums) > 2:
                    return f"[{nums[0]}]–[{nums[-1]}]"
                return ", ".join(f"[{x}]" for x in nums)
            if m.group(3):
                x = one(int(m.group(3)))
                return f"[{x}]" if x else f"[?{m.group(3)}]"
            body = m.group(4).strip()
            if body in ("...", "…", ""):
                return m.group(0)
            key = ref_key(body)
            if key not in reg.entries:
                # ลองจับด้วยชื่อเรื่องถ้าไม่มี URL ตรง
                tkey = "title:" + norm_title((re.search(r"[“\"](.+?)[”\"]", body) or [None, body.split(",")[0]])[1])
                key = tkey if tkey in reg.entries else None
            if key is None:
                key = reg.add(body, f"{where} (ไม่มีในรายการท้ายบท)")
                reg.unresolved.append(f"{where}: [อ้างอิง: {short(body, 60)}] ไม่พบในรายการท้ายบท — ใช้ข้อความในวงเล็บเป็นรายการอ้างอิงแทน")
            return f"[{reg.cite_key(key)}]"

        return RE_CITE.sub(repl, text)

    for ch in chapters:
        for b in ch.blocks:
            where = f"{ch.path.name}:{b.get('line')}"
            if b["t"] in ("p", "li", "licont", "h"):
                b["text"] = rewrite(b["text"], where)
            elif b["t"] == "table":
                if b["caption"]:
                    b["caption"] = rewrite(b["caption"], where)
                tb = b["rows"]
                tb["header"] = [rewrite(c, where) for c in tb["header"]]
                tb["body"] = [[rewrite(c, where) for c in r] for r in tb["body"]]
            elif b["t"] == "fig":
                b["desc"] = rewrite(b["desc"], where)
    return reg


# ===========================================================================
# 3) Mermaid -> PNG
# ===========================================================================
def find_mermaid_js() -> str | None:
    cands = [os.environ.get("MERMAID_JS", ""),
             str(TOOLS / "node_modules" / "mermaid" / "dist" / "mermaid.min.js")]
    for c in cands:
        if c and Path(c).is_file():
            return c
    return None


def render_mermaid_all(chapters: list[Chapter]):
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    todo = []
    for ch in chapters:
        for b in ch.blocks:
            if b["t"] == "code" and b["lang"] == "mermaid":
                h = hashlib.sha1(b["text"].encode("utf-8")).hexdigest()[:12]
                b["png"] = FIG_DIR / f"mermaid-{h}.png"
                if not b["png"].exists():
                    todo.append(b)
    if todo:
        mjs = find_mermaid_js()
        if not mjs and shutil.which("npm"):
            log("mermaid", "ไม่พบ mermaid.min.js — ลอง npm install ใน thesis/tools")
            subprocess.run(["npm", "install", "--no-audit", "--no-fund"], cwd=TOOLS,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            mjs = find_mermaid_js()
        if mjs:
            tmp = Path(tempfile.mkdtemp(prefix="mmd-"))
            files = []
            for b in todo:
                f = tmp / (b["png"].stem + ".mmd")
                f.write_text(b["text"], encoding="utf-8")
                files.append(str(f))
            r = subprocess.run(["node", str(TOOLS / "render_mermaid.js"), mjs, str(FIG_DIR)] + files,
                               capture_output=True, text=True)
            for ln in r.stdout.splitlines():
                if ln.startswith("FAIL"):
                    log("mermaid", ln)
            shutil.rmtree(tmp, ignore_errors=True)
        else:
            log("mermaid", "ไม่มีตัวแปลง Mermaid — ใส่กรอบแทนภาพ")
    for ch in chapters:
        for b in ch.blocks:
            if b["t"] == "code" and b["lang"] == "mermaid" and not b["png"].exists():
                b["png"] = None


# ===========================================================================
# 4) ตัวช่วยสร้าง XML ของ Word
# ===========================================================================
def set_run(run, size=None, bold=None, italic=None, font=None, highlight=False, color=None,
            vert=None, cs_font=None):
    rPr = run._r.get_or_add_rPr()
    if font or cs_font:
        rf = rPr.get_or_add_rFonts()
        f = font or FONT
        rf.set(qn("w:ascii"), f)
        rf.set(qn("w:hAnsi"), f)
        rf.set(qn("w:eastAsia"), f)
        rf.set(qn("w:cs"), cs_font or FONT)
    if bold:
        rPr.get_or_add_b()
        rPr.get_or_add_bCs()
    if italic:
        rPr.get_or_add_i()
        rPr.get_or_add_iCs()
    if color:
        run.font.color.rgb = RGBColor.from_string(color)
    if size:
        sz = rPr.get_or_add_sz()
        sz.set(qn("w:val"), str(int(size * 2)))
        szcs = rPr.find(qn("w:szCs"))
        if szcs is None:
            szcs = OxmlElement("w:szCs")
            sz.addnext(szcs)
        szcs.set(qn("w:val"), str(int(size * 2)))
    if highlight:
        run.font.highlight_color = WD_COLOR_INDEX.YELLOW
    if vert:
        v = rPr.get_or_add_vertAlign()
        v.set(qn("w:val"), vert)
    return run


def pfmt(p, align=None, first=None, left=None, right=None, hanging=None, before=None, after=None,
         keep_next=None, page_break=None, line=None, keep_lines=None):
    f = p.paragraph_format
    if align is not None:
        p.alignment = align
    if left is not None:
        f.left_indent = Twips(left)
    if right is not None:
        f.right_indent = Twips(right)
    if first is not None:
        f.first_line_indent = Twips(first)
    if hanging is not None:
        f.first_line_indent = Twips(-hanging)
    if before is not None:
        f.space_before = Pt(before)
    if after is not None:
        f.space_after = Pt(after)
    if keep_next is not None:
        f.keep_with_next = keep_next
    if keep_lines is not None:
        f.keep_together = keep_lines
    if page_break:
        f.page_break_before = True
    if line is not None:
        f.line_spacing = line
    return p


def add_field(p, instr: str, result: str = "", size=None, bold=None):
    def r_(tag, **attrs):
        r = p.add_run()
        if size or bold:
            set_run(r, size=size, bold=bold)
        el = OxmlElement(tag)
        for k, v in attrs.items():
            el.set(qn(k), v)
        if tag == "w:instrText":
            el.set(qn("xml:space"), "preserve")
            el.text = instr
        r._r.append(el)
        return r
    r_("w:fldChar", **{"w:fldCharType": "begin"})
    r_("w:instrText")
    r_("w:fldChar", **{"w:fldCharType": "separate"})
    rr = p.add_run(result)
    if size or bold:
        set_run(rr, size=size, bold=bold)
    r_("w:fldChar", **{"w:fldCharType": "end"})


def fld_char(p, kind: str):
    r = p.add_run()
    el = OxmlElement("w:fldChar")
    el.set(qn("w:fldCharType"), kind)
    r._r.append(el)


def instr_text(p, instr: str):
    r = p.add_run()
    el = OxmlElement("w:instrText")
    el.set(qn("xml:space"), "preserve")
    el.text = instr
    r._r.append(el)


def cell_borders(cell, style="single", sz=4, color="000000"):
    tcPr = cell._tc.get_or_add_tcPr()
    b = OxmlElement("w:tcBorders")
    for side in ("top", "left", "bottom", "right"):
        e = OxmlElement(f"w:{side}")
        e.set(qn("w:val"), style)
        e.set(qn("w:sz"), str(sz))
        e.set(qn("w:space"), "0")
        e.set(qn("w:color"), color)
        b.append(e)
    tcPr.append(b)


def cell_shading(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    tcPr.append(shd)


TBLPR_ORDER = ["tblStyle", "tblpPr", "tblOverlap", "bidiVisual", "tblStyleRowBandSize", "tblStyleColBandSize",
               "tblW", "jc", "tblCellSpacing", "tblInd", "tblBorders", "shd", "tblLayout", "tblCellMar",
               "tblLook", "tblCaption", "tblDescription"]


def sort_tblpr(table):
    tblPr = table._tbl.tblPr
    kids = list(tblPr)
    kids.sort(key=lambda e: TBLPR_ORDER.index(e.tag.split("}")[1]) if e.tag.split("}")[1] in TBLPR_ORDER else 99)
    for e in kids:
        tblPr.remove(e)
    for e in kids:
        tblPr.append(e)


def table_borders(table, sz=4):
    tblPr = table._tbl.tblPr
    b = OxmlElement("w:tblBorders")
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        e = OxmlElement(f"w:{side}")
        e.set(qn("w:val"), "single")
        e.set(qn("w:sz"), str(sz))
        e.set(qn("w:space"), "0")
        e.set(qn("w:color"), "000000")
        b.append(e)
    tblPr.append(b)


def table_layout_fixed(table, widths):
    tbl = table._tbl
    tblPr = tbl.tblPr
    w = OxmlElement("w:tblW")
    w.set(qn("w:w"), str(sum(widths)))
    w.set(qn("w:type"), "dxa")
    for old in tblPr.findall(qn("w:tblW")):
        tblPr.remove(old)
    tblPr.append(w)
    lay = OxmlElement("w:tblLayout")
    lay.set(qn("w:type"), "fixed")
    tblPr.append(lay)
    grid = tbl.tblGrid
    for gc, wd in zip(grid.findall(qn("w:gridCol")), widths):
        gc.set(qn("w:w"), str(wd))
    for row in table.rows:
        for c, wd in zip(row.cells, widths):
            c.width = Twips(wd)


def cell_margins(table, left=85, right=85):
    tblPr = table._tbl.tblPr
    m = OxmlElement("w:tblCellMar")
    for side, v in (("left", left), ("right", right)):
        e = OxmlElement(f"w:{side}")
        e.set(qn("w:w"), str(v))
        e.set(qn("w:type"), "dxa")
        m.append(e)
    tblPr.append(m)


# ===========================================================================
# 5) ข้อความในบรรทัด (bold/italic/code/math/[รอใส่])
# ===========================================================================
RE_INLINE = re.compile(
    r"(?P<code>`[^`]+`)"
    r"|(?P<bold>\*\*(?:[^*]|\*(?!\*))+?\*\*)"
    r"|(?P<ital>(?<![\w*])\*(?!\s)[^*]+?(?<!\s)\*(?!\*))"
    r"|(?P<math>(?<![\\$])\$(?!\s)[^$]+?\$)"
    r"|(?P<todo>\[รอใส่[^\]]*\])"
)


def add_inline(p, text: str, size=None, bold=False, italic=False):
    pos = 0
    for m in RE_INLINE.finditer(text):
        if m.start() > pos:
            set_run(p.add_run(text[pos:m.start()]), size=size, bold=bold, italic=italic)
        tok = m.group(0)
        if m.lastgroup == "code":
            inner = tok[1:-1]
            if inner.startswith("[รอใส่"):
                set_run(p.add_run(inner), size=size, bold=bold, italic=italic, highlight=True)
            else:
                # monospace: ตัวอักษรละติน Courier New เล็กกว่าเนื้อหาเพื่อให้สูงเท่ากัน ส่วนอักษรไทยยังเป็น TH SarabunPSK
                r = p.add_run(inner)
                set_run(r, size=round((size or SZ_BODY) * 0.75), font=MONO, cs_font=FONT, bold=bold)
                # szCs ต้องเท่าขนาดเนื้อหาเพื่อให้อักษรไทยใน code ไม่เล็กลง
                r._r.rPr.find(qn("w:szCs")).set(qn("w:val"), str(int((size or SZ_BODY) * 2)))
        elif m.lastgroup == "bold":
            add_inline(p, tok[2:-2], size=size, bold=True, italic=italic)
        elif m.lastgroup == "ital":
            add_inline(p, tok[1:-1], size=size, bold=bold, italic=True)
        elif m.lastgroup == "math":
            add_math(p, tok[1:-1], size=size, bold=bold)
        elif m.lastgroup == "todo":
            set_run(p.add_run(tok), size=size, bold=bold, italic=italic, highlight=True)
        pos = m.end()
    if pos < len(text):
        set_run(p.add_run(text[pos:]), size=size, bold=bold, italic=italic)


# ---- LaTeX แบบง่าย -> ข้อความ + ตัวห้อย/ตัวยก ----
TEX_SYMBOLS = {
    r"\times": "×", r"\cdot": "·", r"\le": "≤", r"\leq": "≤", r"\ge": "≥", r"\geq": "≥",
    r"\ne": "≠", r"\neq": "≠", r"\approx": "≈", r"\sum": "Σ", r"\in": "∈", r"\pm": "±",
    r"\lfloor": "⌊", r"\rfloor": "⌋", r"\lceil": "⌈", r"\rceil": "⌉", r"\to": "→",
    r"\rightarrow": "→", r"\Delta": "Δ", r"\alpha": "α", r"\beta": "β", r"\mu": "μ",
    r"\sigma": "σ", r"\min": "min", r"\max": "max", r"\,": " ", r"\;": " ", r"\quad": "  ",
    r"\left": "", r"\right": "", r"\!": "",
}


def _group(s: str, i: int):
    """อ่าน {...} หรืออักขระเดียวที่ตำแหน่ง i คืน (เนื้อหา, ตำแหน่งถัดไป)"""
    while i < len(s) and s[i] == " ":
        i += 1
    if i < len(s) and s[i] == "{":
        depth, j = 0, i
        while j < len(s):
            if s[j] == "{":
                depth += 1
            elif s[j] == "}":
                depth -= 1
                if depth == 0:
                    return s[i + 1:j], j + 1
            j += 1
        return s[i + 1:], len(s)
    if i < len(s) and s[i] == "\\":
        m = re.match(r"\\[A-Za-z]+", s[i:])
        if m:
            return m.group(0), i + len(m.group(0))
    return s[i:i + 1], i + 1


def tex_segments(s: str, vert=None):
    s = s.replace("{,}", ",")
    out = []
    i = 0
    while i < len(s):
        c = s[i]
        if s.startswith(r"\text", i) or s.startswith(r"\mathrm", i) or s.startswith(r"\operatorname", i):
            cmd = re.match(r"\\[A-Za-z]+", s[i:]).group(0)
            g, i = _group(s, i + len(cmd))
            out.append((g, vert))
        elif s.startswith(r"\frac", i):
            a, i = _group(s, i + 5)
            b, i = _group(s, i)
            wrap = lambda x: x if re.fullmatch(r"[\w{}\\ ]*", x) and not re.search(r"[+\-]", x) else None
            if wrap(a) is None:
                out.append(("(", vert)); out += tex_segments(a, vert); out.append((")", vert))
            else:
                out += tex_segments(a, vert)
            out.append((" / ", vert))
            if wrap(b) is None:
                out.append(("(", vert)); out += tex_segments(b, vert); out.append((")", vert))
            else:
                out += tex_segments(b, vert)
        elif c == "\\":
            m = re.match(r"\\([A-Za-z]+|.)", s[i:])
            cmd = m.group(0)
            out.append((TEX_SYMBOLS.get(cmd, cmd.lstrip("\\")), vert))
            i += len(cmd)
        elif c in "_^":
            g, i = _group(s, i + 1)
            out += tex_segments(g, "subscript" if c == "_" else "superscript")
        elif c in "{}":
            i += 1
        else:
            j = i
            while j < len(s) and s[j] not in "\\_^{}":
                j += 1
            out.append((s[i:j], vert))
            i = j
    return out


def add_math(p, tex: str, size=None, bold=False):
    for txt, vert in tex_segments(tex):
        if txt:
            set_run(p.add_run(txt), size=size, bold=bold, vert=vert,
                    italic=bool(re.fullmatch(r"[A-Za-z]", txt.strip())))


# ===========================================================================
# 6) สร้างเอกสาร
# ===========================================================================
# ตำแหน่ง/ขนาดตรามหาวิทยาลัยจาก 01-ปก.docx (EMU): extent 1377950x1854200, posH column 2216785, posV paragraph -1236345
LOGO_CX, LOGO_CY, LOGO_X, LOGO_Y = 1377950, 1854200, 2216785, -1236345


def _inline_to_anchor(run, x, y):
    inline = run._r.find(".//" + qn("wp:inline"))
    drawing = inline.getparent()
    ext = inline.find(qn("wp:extent"))
    docpr = inline.find(qn("wp:docPr"))
    graphic = inline.find(qn("a:graphic"))
    anchor = OxmlElement("wp:anchor")
    for k, v in dict(distT="0", distB="0", distL="114935", distR="114935", simplePos="0", relativeHeight="3",
                     behindDoc="0", locked="0", layoutInCell="1", allowOverlap="1").items():
        anchor.set(k, v)
    sp = OxmlElement("wp:simplePos"); sp.set("x", "0"); sp.set("y", "0"); anchor.append(sp)
    for tag, rel, off in (("wp:positionH", "column", x), ("wp:positionV", "paragraph", y)):
        e = OxmlElement(tag); e.set("relativeFrom", rel)
        o = OxmlElement("wp:posOffset"); o.text = str(off); e.append(o); anchor.append(e)
    anchor.append(ext)
    ee = OxmlElement("wp:effectExtent")
    for k in ("l", "t", "r", "b"):
        ee.set(k, "0")
    anchor.append(ee)
    anchor.append(OxmlElement("wp:wrapNone"))
    anchor.append(docpr)
    anchor.append(OxmlElement("wp:cNvGraphicFramePr"))
    anchor.append(graphic)
    drawing.remove(inline)
    drawing.append(anchor)



class Builder:
    def __init__(self, toc_pages: dict | None = None):
        self.toc_pages = toc_pages or {}
        self.doc = docx.Document(str(BASE_TEMPLATE))
        self.toc_entries = {"toc": [], "tables": [], "figures": []}
        self._prepare_base()

    # ---- ฐานจาก template ----
    def _prepare_base(self):
        d = self.doc
        body = d.element.body
        for el in list(body):
            if el.tag != qn("w:sectPr"):
                body.remove(el)
        sp = body.find(qn("w:sectPr"))
        for el in sp.findall(qn("w:headerReference")) + sp.findall(qn("w:footerReference")):
            sp.remove(el)
        # docDefaults + Normal: ฟอนต์ TH SarabunPSK 16pt ตามที่ template ใส่ไว้ทุก run
        styles = d.styles.element
        rpr_def = styles.find(qn("w:docDefaults")).find(qn("w:rPrDefault")).find(qn("w:rPr"))
        for el in list(rpr_def):
            rpr_def.remove(el)
        for el in list(self._rpr_xml(SZ_BODY)):
            rpr_def.append(el)
        normal = d.styles["Normal"]
        rpr = normal.element.get_or_add_rPr()
        for el in list(rpr):
            rpr.remove(el)
        for el in self._rpr_xml(SZ_BODY):
            rpr.append(el)
        normal.element.set(qn("w:default"), "1")
        normal.paragraph_format.space_before = Pt(0)
        normal.paragraph_format.space_after = Pt(0)
        # ตั้ง compat ให้เป็น Word 2013+ (template เดิมเป็น compatibilityMode 11) และสั่งให้ Word ปรับปรุงฟิลด์เมื่อเปิด
        st = d.settings.element
        for cs in st.iter(qn("w:compatSetting")):
            if cs.get(qn("w:name")) == "compatibilityMode":
                cs.set(qn("w:val"), "15")
        uf = OxmlElement("w:updateFields")
        uf.set(qn("w:val"), "true")
        compat = st.find(qn("w:compat"))
        compat.addprevious(uf)          # ลำดับตาม schema: ... updateFields, compat, ..., themeFontLang
        st.find(qn("w:zoom")).set(qn("w:percent"), "100")
        lang = OxmlElement("w:themeFontLang")
        lang.set(qn("w:val"), "en-US")
        lang.set(qn("w:bidi"), "th-TH")
        compat.addnext(lang)
        self._define_styles()

    @staticmethod
    def _rpr_xml(size):
        rpr = OxmlElement("w:rPr")
        rf = OxmlElement("w:rFonts")
        for a in ("ascii", "hAnsi", "eastAsia", "cs"):
            rf.set(qn(f"w:{a}"), FONT)
        rpr.append(rf)
        for tag in ("w:sz", "w:szCs"):
            e = OxmlElement(tag)
            e.set(qn("w:val"), str(size * 2))
            rpr.append(e)
        lg = OxmlElement("w:lang")
        lg.set(qn("w:val"), "en-US")
        lg.set(qn("w:eastAsia"), "en-US")
        lg.set(qn("w:bidi"), "th-TH")
        rpr.append(lg)
        return rpr

    def _style(self, name, base="Normal", size=SZ_BODY, bold=False, outline=None, align=None,
               left=None, hanging=None, before=0, after=0, keep_next=False, tabs=()):
        from docx.enum.style import WD_STYLE_TYPE
        try:
            s = self.doc.styles[name]
        except KeyError:
            s = self.doc.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
        s.base_style = self.doc.styles[base]
        s.quick_style = True
        if re.match(r"^(heading \d|toc \d|table of figures)$", name):
            s.element.attrib.pop(qn("w:customStyle"), None)
        f = s.font
        f.size = Pt(size)
        f.bold = bold
        rpr = s.element.get_or_add_rPr()
        for tag in ("w:bCs", "w:szCs"):
            for old in rpr.findall(qn(tag)):
                rpr.remove(old)
        if bold:
            rpr.find(qn("w:b")).addnext(OxmlElement("w:bCs"))
        szcs = OxmlElement("w:szCs")
        szcs.set(qn("w:val"), str(size * 2))
        rpr.find(qn("w:sz")).addnext(szcs)
        pf = s.paragraph_format
        pf.space_before = Pt(before)
        pf.space_after = Pt(after)
        pf.keep_with_next = keep_next
        if align is not None:
            pf.alignment = align
        if left is not None:
            pf.left_indent = Twips(left)
        if hanging is not None:
            pf.first_line_indent = Twips(-hanging)
        for pos, al in tabs:
            pf.tab_stops.add_tab_stop(Twips(pos), al)
        if outline is not None:
            ppr = s.element.get_or_add_pPr()
            ol = OxmlElement("w:outlineLvl")
            ol.set(qn("w:val"), str(outline))
            ppr.append(ol)
        return s

    def _define_styles(self):
        C, L = WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT
        R = WD_TAB_ALIGNMENT.RIGHT
        # หัวบท/หัวส่วนหน้าเล่ม: 18pt หนา กึ่งกลาง เว้น 1 บรรทัด (18pt) หลังหัวบท ตาม template
        self._style("Heading 1", size=SZ_CHAPTER, bold=True, outline=0, align=C, after=SZ_CHAPTER, keep_next=True)
        # หัวข้อ x.y: 16pt หนา ชิดซ้าย (template บทที่ 3: "3.1 Hardware")
        self._style("Heading 2", size=SZ_BODY, bold=True, outline=1, align=L, before=12, keep_next=True)
        # หัวข้อ x.y.z: 16pt หนา เยื้อง 504 twip (ตำแหน่ง tab ของเลขหัวข้อใน numbering ของ template)
        self._style("Heading 3", size=SZ_BODY, bold=True, outline=2, align=L, left=504, before=6, keep_next=True)
        self._style("Heading 4", size=SZ_BODY, bold=True, outline=3, align=L, left=1080, before=6, keep_next=True)
        # สารบัญ: บทที่ (หนา) / x.y เยื้อง 1080 ตามตารางใน 04-สารบัญ.docx, เลขหน้าชิดขวา
        self._style("toc 1", size=SZ_BODY, bold=True, left=1080, hanging=1080, before=0,
                    tabs=((1080, WD_TAB_ALIGNMENT.LEFT), (TEXT_W, R)))
        self._style("toc 2", size=SZ_BODY, left=1584, hanging=504, tabs=((TEXT_W, R),))
        self._style("toc 3", size=SZ_BODY, left=2232, hanging=648, tabs=((TEXT_W, R),))
        self._style("table of figures", size=SZ_BODY, left=1440, hanging=1440,
                    tabs=((1440, WD_TAB_ALIGNMENT.LEFT), (TEXT_W, R)))
        for n in ("toc 1", "toc 2", "toc 3", "table of figures"):
            self.doc.styles[n].paragraph_format.right_indent = Twips(500)
        # คำอธิบายตาราง/รูป (ใช้เป็นแหล่งของสารบัญตาราง/สารบัญรูป)
        self._style("Table Caption", size=SZ_BODY, align=L, before=6, after=3, keep_next=True)
        self._style("Figure Caption", size=SZ_BODY, align=C, before=3, after=9)
        self._style("Code Block", size=12, align=L)
        self._style("Table Text", size=14, align=L)

    # ---- section ----
    def _setup_section(self, sec, margins, fmt=None, start=None, footer=True, valign=None, title_pg=False):
        sec.page_width, sec.page_height = Twips(PAGE_W), Twips(PAGE_H)
        sec.left_margin, sec.right_margin = Twips(margins["left"]), Twips(margins["right"])
        sec.top_margin, sec.bottom_margin = Twips(margins["top"]), Twips(margins["bottom"])
        sec.header_distance, sec.footer_distance = Twips(margins["header"]), Twips(margins["footer"])
        sp = sec._sectPr
        for old in sp.findall(qn("w:pgNumType")):
            sp.remove(old)
        if fmt:
            pn = OxmlElement("w:pgNumType")
            pn.set(qn("w:fmt"), fmt)
            if start is not None:
                pn.set(qn("w:start"), str(start))
            sp.find(qn("w:pgMar")).addnext(pn)
        for tag, val in (("w:vAlign", valign), ("w:titlePg", title_pg)):
            for old in sp.findall(qn(tag)):
                sp.remove(old)
        anchor = sp.find(qn("w:formProt"))
        if anchor is None:
            anchor = sp.find(qn("w:pgNumType")) if sp.find(qn("w:pgNumType")) is not None else sp.find(qn("w:pgMar"))
        if title_pg:
            tp = OxmlElement("w:titlePg")
            anchor.addnext(tp)
        if valign:
            va = OxmlElement("w:vAlign")
            va.set(qn("w:val"), valign)
            anchor.addnext(va)
        sec.footer.is_linked_to_previous = False
        sec.header.is_linked_to_previous = False
        ft = sec.footer
        for p in ft.paragraphs[1:]:
            p._p.getparent().remove(p._p)
        p = ft.paragraphs[0]
        for r in list(p.runs):
            r._r.getparent().remove(r._r)
        if footer:
            pfmt(p, align=WD_ALIGN_PARAGRAPH.RIGHT)   # template: footer jc=end, PAGE field
            add_field(p, " PAGE ", "1", size=SZ_BODY)
        if title_pg:
            sec.different_first_page_header_footer = True
            fp = sec.first_page_footer
            fp.is_linked_to_previous = False

    def new_section(self, **kw):
        sec = self.doc.add_section(WD_SECTION.NEW_PAGE)
        self._setup_section(sec, **kw)
        return sec

    # ---- พื้นฐาน ----
    def para(self, text="", style=None, size=None, bold=False, **fmt):
        p = self.doc.add_paragraph(style=style)
        if text:
            add_inline(p, text, size=size, bold=bold)
        if fmt:
            pfmt(p, **fmt)
        return p

    def body_para(self, text):
        return self.para(text, first=FIRST_LINE, align=WD_ALIGN_PARAGRAPH.LEFT)

    def heading1(self, text, toc_text=None, page_break=True, lines=None):
        p = self.doc.add_paragraph(style="Heading 1")
        parts = lines or [text]
        for k, t in enumerate(parts):
            if k:
                p.add_run().add_break(WD_BREAK.LINE)
            add_inline(p, t)
        if page_break:
            pfmt(p, page_break=True)
        self.toc_entries["toc"].append((1, toc_text or text))
        return p

    def heading(self, level, text):
        p = self.doc.add_paragraph(style=f"Heading {min(level, 4)}")
        add_inline(p, text)
        if level <= 2:
            self.toc_entries["toc"].append((level, text))
        return p

    # ---- ปก ----
    def cover(self):
        sec = self.doc.sections[0]
        self._setup_section(sec, COVER_MARGIN, fmt=None, footer=False)
        logo = self._cover_logo()
        C = WD_ALIGN_PARAGRAPH.CENTER
        # ย่อหน้าแรกของปกยึดตรามหาวิทยาลัยแบบลอย (anchor) ตำแหน่งเดียวกับ 01-ปก.docx
        p = self.para(" ", size=SZ_COVER, align=C)
        if logo:
            run = p.add_run()
            run.add_picture(str(logo), width=Emu(LOGO_CX), height=Emu(LOGO_CY))
            _inline_to_anchor(run, LOGO_X, LOGO_Y)
        lines = [
            "", META["title_th"], META["title_en"], "", "โดย",
            f"{META['author_th']}  รหัสนักศึกษา {META['student_id']}", "",
            "อาจารย์ที่ปรึกษา", META["advisor_th"], "",
            f"รายงานเล่มนี้เป็นส่วนหนึ่งของรายวิชา {META['course']}",
            META["school"], META["university"],
            f"ประจำภาคการศึกษาที่ {META['semester']} ปีการศึกษา {META['year']}",
        ]
        for t in lines:
            self.para(t, size=SZ_COVER, align=C)

    def _cover_logo(self) -> Path | None:
        try:
            with zipfile.ZipFile(COVER_TEMPLATE) as z:
                names = [n for n in z.namelist() if n.startswith("word/media/")]
                if not names:
                    return None
                out = Path(tempfile.mkdtemp(prefix="logo-")) / Path(names[0]).name
                out.write_bytes(z.read(names[0]))
                return out
        except Exception as e:  # pragma: no cover
            log("ปก", f"ดึงตราจาก template ไม่ได้: {e}")
            return None

    # ---- ส่วนหน้า ----
    def info_block(self, rows):
        for label, value, cont in rows:
            p = self.doc.add_paragraph()
            pfmt(p, left=INFO_TAB, hanging=INFO_TAB if label else None)
            p.paragraph_format.tab_stops.add_tab_stop(Twips(INFO_TAB))
            if label:
                set_run(p.add_run(label), bold=True)
                p.add_run("\t")
            add_inline(p, value)

    def abstract_th(self, body_paras):
        self.info_block([
            ("ชื่อโครงงาน", META["title_th"], False),
            ("", f"({META['title_en']})", True),
            ("ผู้จัดทำ", f"{META['author_th']}  รหัสนักศึกษา {META['student_id']}", False),
            ("อาจารย์ที่ปรึกษา", META["advisor_th"], False),
            ("ภาคการศึกษา", f"{META['semester']}/{META['year']}", False),
        ])
        self.para()
        self.heading1("บทคัดย่อ", page_break=False)
        for t in body_paras:
            self.body_para(t)

    def abstract_en(self, body_paras):
        self.info_block([
            ("Project Title", META["title_en"], False),
            ("Student", f"{META['author_en']}  Student ID {META['student_id']}", False),
            ("Advisor", META["advisor_en"], False),
            ("Semester", f"{META['semester']}/{META['year']}", False),
        ])
        # ขึ้นหน้าใหม่ที่บรรทัดแรกของ info block
        first = self.doc.paragraphs[-4]
        pfmt(first, page_break=True)
        self.para()
        self.heading1("ABSTRACT", toc_text="Abstract", page_break=False)
        for t in body_paras:
            self.body_para(t)

    def acknowledgement(self, body_paras):
        self.heading1("กิตติกรรมประกาศ")
        for t in body_paras:
            self.body_para(t)
        self.para()
        self.para("ผู้จัดทำ", align=WD_ALIGN_PARAGRAPH.RIGHT)

    def toc_page(self, kind: str):
        title = {"toc": "สารบัญ", "tables": "สารบัญตาราง", "figures": "สารบัญรูป"}[kind]
        col = {"toc": "เนื้อหา", "tables": "ตารางที่", "figures": "รูปที่"}[kind]
        self.heading1(title)
        p = self.para()
        p.paragraph_format.tab_stops.add_tab_stop(Twips(TEXT_W), WD_TAB_ALIGNMENT.RIGHT)
        set_run(p.add_run(col), bold=True)
        p.add_run("\t")
        set_run(p.add_run("หน้า"), bold=True)
        pfmt(p, after=6, keep_next=True)
        instr = {
            "toc": ' TOC \\o "1-2" \\z \\u ',
            "tables": ' TOC \\h \\z \\t "Table Caption,1" ',
            "figures": ' TOC \\h \\z \\t "Figure Caption,1" ',
        }[kind]
        self._toc_field(kind, instr)

    def _toc_field(self, kind, instr):
        # ผลลัพธ์ของฟิลด์ใส่จากรอบก่อน (คำนวณเลขหน้าด้วย LibreOffice) — Word กด F9 ปรับปรุงได้
        entries = self.toc_pages.get(kind)
        style = "toc 1" if kind == "toc" else "table of figures"
        if not entries:
            p = self.doc.add_paragraph(style=style)
            fld_char(p, "begin")
            instr_text(p, instr)
            fld_char(p, "separate")
            set_run(p.add_run("(คลิกขวาแล้วเลือก Update Field เพื่อสร้างสารบัญ)"), highlight=True)
            fld_char(p, "end")
            return
        for k, (level, text, page) in enumerate(entries):
            p = self.doc.add_paragraph(style=f"toc {level}" if kind == "toc" else style)
            if k == 0:
                fld_char(p, "begin")
                instr_text(p, instr)
                fld_char(p, "separate")
            label = text
            if kind == "toc" and level == 1:
                m = re.match(r"^(บทที่\s*\d+)\s+(.*)$", text)
                if m:
                    label = m.group(1) + "\t" + m.group(2)
                else:
                    # หัวข้อส่วนหน้า/ท้ายเล่ม: ไม่มีคอลัมน์ "บทที่" ให้เลขหน้าไปชิดขวาเลย
                    pfmt(p, left=0, first=0)
                    p.paragraph_format.tab_stops.add_tab_stop(Twips(1080), WD_TAB_ALIGNMENT.CLEAR)
            if kind == "tables":
                pfmt(p, left=1800, hanging=1800)
                p.paragraph_format.tab_stops.add_tab_stop(Twips(1440), WD_TAB_ALIGNMENT.CLEAR)
                p.paragraph_format.tab_stops.add_tab_stop(Twips(1800))
            elif kind in ("tables", "figures"):
                m = re.match(r"^((?:ตารางที่|รูปที่)\s*[\d.]+)\s+(.*)$", text)
                if m:
                    label = m.group(1) + "\t" + m.group(2)
            p.add_run(re.sub(r"`", "", label) + "\t" + page)
            if k == len(entries) - 1:
                fld_char(p, "end")

    # ---- บท ----
    def chapter(self, ch: Chapter):
        self.heading1(f"บทที่ {ch.num} {ch.title}", lines=[f"บทที่ {ch.num}", ch.title])
        blocks = ch.blocks
        i = 0
        while i < len(blocks):
            b = blocks[i]
            t = b["t"]
            if t == "h":
                self.heading(b["level"], b["text"])
            elif t == "p":
                self.body_para(b["text"])
            elif t == "li":
                self.list_item(b)
            elif t == "licont":
                prev = next((x for x in reversed(blocks[:i]) if x["t"] == "li"), None)
                lvl = prev["level"] if prev else 0
                self.para(b["text"], left=self._li_text_indent(lvl), first=0)
            elif t == "table":
                self.table(b)
            elif t == "fig":
                self.figure_placeholder(b)
            elif t == "code" and b["lang"] == "mermaid":
                nxt = blocks[i + 1] if i + 1 < len(blocks) else None
                if nxt and nxt["t"] == "fig":
                    self.figure_image(b, nxt)
                    i += 1
                else:
                    log("mermaid", f"{ch.path.name}:{b['line']} แผนภาพ Mermaid ไม่มี [รูปที่ ...] ตามหลัง")
                    self.figure_image(b, None)
            elif t == "code":
                self.code_block(b)
            elif t == "eq":
                self.equation(b)
            i += 1

    LI_MARK = {0: 1080, 1: 1512}
    LI_HANG = {0: 504, 1: 648}

    def _li_text_indent(self, level):
        return self.LI_MARK[level] + self.LI_HANG[level]

    def list_item(self, b):
        lvl = b["level"]
        marker = "-" if b["kind"] == "bullet" else b["marker"]
        hang = self.LI_HANG[lvl]
        p = self.doc.add_paragraph()
        pfmt(p, left=self.LI_MARK[lvl] + hang, hanging=hang, align=WD_ALIGN_PARAGRAPH.LEFT)
        p.paragraph_format.tab_stops.add_tab_stop(Twips(self.LI_MARK[lvl] + hang))
        set_run(p.add_run(marker + "\t"))
        add_inline(p, b["text"])

    def table(self, b):
        tb = b["rows"]
        header, body, align = tb["header"], tb["body"], tb["align"]
        ncol = len(header)
        if b["caption"]:
            m = re.match(r"^(ตารางที่\s*[\d.]+)\s*(.*)$", b["caption"])
            p = self.doc.add_paragraph(style="Table Caption")
            set_run(p.add_run(m.group(1)), bold=True)
            p.add_run(" ")
            add_inline(p, m.group(2))
            self.toc_entries["tables"].append((1, plain(b["caption"])))
        else:
            log("ตาราง", f"บรรทัด {b['line']}: ตารางไม่มีชื่อ 'ตารางที่ x.y ...' อยู่เหนือตาราง")
        size = 14 if ncol <= 5 else 12
        rows = [header] + body
        spanned = [False] * ncol
        for c in range(ncol):
            if header[c].strip() and c + 1 < ncol and not header[c + 1].strip():
                spanned[c] = True
        widths = col_widths(rows, TEXT_W, size, spanned)
        t = self.doc.add_table(rows=len(rows), cols=ncol)
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        table_borders(t)
        cell_margins(t, 70, 70)
        table_layout_fixed(t, widths)
        short_col = [all(len(plain(r[c])) <= 3 for r in body) for c in range(ncol)]
        for ri, row in enumerate(rows):
            tr = t.rows[ri]
            if ri == 0:
                trPr = tr._tr.get_or_add_trPr()
                h = OxmlElement("w:tblHeader")
                trPr.append(h)
            for ci, val in enumerate(row):
                cell = tr.cells[ci]
                p = cell.paragraphs[0]
                p.style = self.doc.styles["Table Text"]
                a = align[ci] if ci < len(align) else None
                if ri == 0 or a == "center" or short_col[ci]:
                    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                elif a == "right":
                    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
                add_inline(p, val, size=size, bold=(ri == 0))
        # หัวตารางที่เว้นว่างต่อจากช่องที่มีข้อความ = ช่องผสาน (เช่น ตารางแผนงาน)
        hdr = t.rows[0]
        ci = 0
        while ci < ncol:
            if header[ci].strip():
                cj = ci + 1
                while cj < ncol and not header[cj].strip():
                    cj += 1
                if cj - ci > 1:
                    merged = hdr.cells[ci].merge(hdr.cells[cj - 1])
                    for extra in merged.paragraphs[1:]:
                        extra._p.getparent().remove(extra._p)
                ci = cj
            else:
                ci += 1
        sp = self.para()
        pfmt(sp, after=0)
        set_run(sp.add_run(""), size=8)

    def figure_placeholder(self, b):
        desc = b["desc"]
        title, note = (desc.split(" — ", 1) + [""])[:2] if " — " in desc else (desc, "")
        t = self.doc.add_table(rows=1, cols=1)
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        table_layout_fixed(t, [int(TEXT_W * 0.8)])
        c = t.rows[0].cells[0]
        cell_borders(c, style="dashed", sz=8, color="808080")
        t.rows[0].height = Twips(2600)
        t.rows[0].height_rule = WD_ROW_HEIGHT_RULE.AT_LEAST
        tcPr = c._tc.get_or_add_tcPr()
        va = OxmlElement("w:vAlign")
        va.set(qn("w:val"), "center")
        tcPr.append(va)
        p = c.paragraphs[0]
        pfmt(p, align=WD_ALIGN_PARAGRAPH.CENTER)
        set_run(p.add_run(f"[รอใส่ภาพ: รูปที่ {b['num']}]"), highlight=True, bold=True)
        p2 = c.add_paragraph()
        pfmt(p2, align=WD_ALIGN_PARAGRAPH.CENTER)
        set_run(p2.add_run(title + (f" ({note})" if note else "")), size=14, color="595959")
        self._fig_caption(b["num"], title)

    def figure_image(self, code_block, fig):
        png = code_block.get("png")
        if fig is None:
            fig = dict(num="?", desc="แผนภาพ Mermaid (ไม่มีชื่อรูป)")
        title = fig["desc"].split(" — ", 1)[0]
        if not png:
            self.figure_placeholder(dict(num=fig["num"], desc=title + " — แผนภาพ Mermaid ยังไม่ได้แปลงเป็นภาพ"))
            return
        from PIL import Image
        with Image.open(png) as im:
            w, h = im.size
        max_w, max_h = TEXT_W * 635, 12000 * 635        # EMU (1 twip = 635 EMU)
        scale = min(max_w / w, max_h / h)
        p = self.doc.add_paragraph()
        pfmt(p, align=WD_ALIGN_PARAGRAPH.CENTER, keep_next=True, before=6)
        p.add_run().add_picture(str(png), width=Emu(int(w * scale)), height=Emu(int(h * scale)))
        if fig["num"] != "?":
            self._fig_caption(fig["num"], title)

    def _fig_caption(self, num, title):
        p = self.doc.add_paragraph(style="Figure Caption")
        set_run(p.add_run(f"รูปที่ {num}"), bold=True)
        p.add_run(" ")
        add_inline(p, title)
        self.toc_entries["figures"].append((1, f"รูปที่ {num} {plain(title)}"))

    def code_block(self, b):
        t = self.doc.add_table(rows=1, cols=1)
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        table_layout_fixed(t, [TEXT_W - 400])
        c = t.rows[0].cells[0]
        cell_borders(c, sz=4, color="A6A6A6")
        cell_shading(c, "F2F2F2")
        lines = b["text"].split("\n")
        for k, ln in enumerate(lines):
            p = c.paragraphs[0] if k == 0 else c.add_paragraph()
            p.style = self.doc.styles["Code Block"]
            r = p.add_run(ln if ln else "")
            set_run(r, size=11, font=MONO, cs_font=FONT)
            r._r.rPr.find(qn("w:szCs")).set(qn("w:val"), "28")
            m = re.search(r"<[^>]*Dashboard[^>]*>|\[รอใส่[^\]]*\]", ln)
            if m:
                pass
        sp = self.para()
        set_run(sp.add_run(""), size=8)

    def equation(self, b):
        p = self.doc.add_paragraph()
        pfmt(p, before=6, after=6)
        ts = p.paragraph_format.tab_stops
        ts.add_tab_stop(Twips(TEXT_W // 2), WD_TAB_ALIGNMENT.CENTER)
        ts.add_tab_stop(Twips(TEXT_W), WD_TAB_ALIGNMENT.RIGHT)
        p.add_run("\t")
        add_math(p, b["tex"])
        if b["tag"]:
            p.add_run(f"\t({b['tag']})")

    # ---- ท้ายเล่ม ----
    def references(self, reg: RefRegistry):
        self.heading1("เอกสารอ้างอิง")
        items, _ = reg.final_list()
        for num, e in items:
            p = self.doc.add_paragraph()
            pfmt(p, left=720, hanging=720, align=WD_ALIGN_PARAGRAPH.LEFT)
            p.paragraph_format.tab_stops.add_tab_stop(Twips(720))
            p.add_run(f"[{num}]\t")
            add_inline(p, e["text"])

    def appendix(self, appendix_ch: Chapter | None):
        # หน้าคั่น "ภาคผนวก" กึ่งกลางหน้า ไม่แสดงเลขหน้า (template 11: titlePg + footer หน้าแรกว่าง)
        # (ไม่ใช้ vAlign=center เพราะ LibreOffice 24.2 ไม่รองรับ จึงเว้นระยะด้านบนแทนเพื่อให้ได้ผลเหมือนกันทั้ง Word และ PDF)
        self.new_section(margins=MARGIN, fmt="decimal", footer=True, title_pg=True)
        p = self.heading1("ภาคผนวก", page_break=False)
        pfmt(p, before=300)
        self.new_section(margins=MARGIN, fmt="decimal", footer=True)
        if appendix_ch and appendix_ch.blocks:
            first = True
            for b in appendix_ch.blocks:
                if b["t"] == "h" and b["level"] == 2:
                    p = self.doc.add_paragraph(style="Heading 1")
                    add_inline(p, b["text"])
                    if not first:
                        pfmt(p, page_break=True)
                    self.toc_entries["toc"].append((2, b["text"]))
                    first = False
                elif b["t"] == "p":
                    self.body_para(b["text"])
            return
        for k, letter in enumerate(("ก", "ข")):
            p = self.doc.add_paragraph(style="Heading 1")
            add_inline(p, f"ภาคผนวก {letter}")
            if k:
                pfmt(p, page_break=True)
            self.toc_entries["toc"].append((2, f"ภาคผนวก {letter}"))
            self.body_para(f"[รอใส่: รายละเอียดภาคผนวก {letter} เช่น คู่มือการติดตั้ง/การใช้งาน โค้ดหลัก "
                           f"หรือผลการทดสอบฉบับเต็ม — ใช้ข้อมูลจำลองเท่านั้น]")


def plain(s: str) -> str:
    s = re.sub(r"`([^`]*)`", r"\1", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
    s = re.sub(r"(?<![\w*])\*([^*]+)\*", r"\1", s)
    return s


def vis_len(s: str) -> int:
    s = plain(s)
    return sum(1 for ch in s if unicodedata.category(ch) not in ("Mn", "Me"))


def col_widths(rows, total, size=14, skip_header=None):
    """ความกว้างคอลัมน์: อย่างน้อยเท่าคำที่ยาวที่สุด (ไม่ให้ตัดคำ) ที่เหลือแบ่งตามความยาวข้อความ"""
    ncol = len(rows[0])
    per_char = 6.2 * size          # twip ต่ออักขระโดยประมาณของ TH SarabunPSK (ไม่นับสระบน/ล่าง)
    pad = 220
    mins, wants = [], []
    for c in range(ncol):
        use = [r[c] for k, r in enumerate(rows) if not (k == 0 and skip_header and skip_header[c])]
        longest_word = max((vis_len(w) for v in use for w in plain(v).split()), default=1)
        longest = max((vis_len(v) for v in use), default=1)
        mins.append(min(longest_word, 14) * size * 10.5 + pad)   # ~0.53 em ต่ออักขระ (วัดจาก PDF)
        wants.append(max(min(longest, 70) * per_char + pad, mins[-1]))
    if sum(mins) > total:
        scale = total / sum(mins)
        widths = [int(m * scale) for m in mins]
    else:
        extra = total - sum(mins)
        grow = [max(w - m, 0) for w, m in zip(wants, mins)]
        g = sum(grow)
        if g == 0:
            widths = [int(m + extra / ncol) for m in mins]
        elif g <= extra:
            # ทุกช่องได้ตามต้องการแล้วยังเหลือ: แบ่งที่เหลือตามสัดส่วนความต้องการ
            left = extra - g
            ws = sum(wants)
            widths = [int(w + left * w / ws) for w in wants]
        else:
            widths = [int(m + extra * gr / g) for m, gr in zip(mins, grow)]
    widths[widths.index(max(widths))] += total - sum(widths)
    return widths


# ===========================================================================
# 7) ตรวจร่าง (รายงานให้ thesis-writer)
# ===========================================================================
TYPOS = {
    # คำที่สะกดผิดบ่อย -> ที่ถูก (ตามพจนานุกรมราชบัณฑิตยสถาน/หลักการทับศัพท์)
    "อนุญาติ": "อนุญาต", "คำนวน": "คำนวณ", "ผลลัพท์": "ผลลัพธ์", "สังเกตุ": "สังเกต", "อัพเดท": "อัปเดต",
    "อัพเดต": "อัปเดต", "อัพโหลด": "อัปโหลด", "เว็ป": "เว็บ", "ฟังก์ชั่น": "ฟังก์ชัน", "อีเมล์": "อีเมล",
    "คลิ๊ก": "คลิก", "เซิฟเวอร์": "เซิร์ฟเวอร์", "ซอฟท์แวร์": "ซอฟต์แวร์", "โควต้า": "โควตา", "แอพ": "แอป",
    "กราฟฟิก": "กราฟิก", "แชทบอท": "แชตบอต", "แชทบอต": "แชตบอต", "เทมเพลท": "เทมเพลต",
    "ไลบรารี่": "ไลบรารี", "อินเตอร์เน็ต": "อินเทอร์เน็ต", "ปฎิบัติ": "ปฏิบัติ", "เกณท์": "เกณฑ์",
    "ทดสอป": "ทดสอบ", "ผู้ใช่": "ผู้ใช้", "รายละเอียต": "รายละเอียด", "ไบท์": "ไบต์", "ซีเคียว": "ซีเคียว(ตรวจ)",
    "พาสเวิร์ด": "รหัสผ่าน", "เปอร์เซนต์": "เปอร์เซ็นต์", "ลิ้งค์": "ลิงก์", "ลิงค์": "ลิงก์", "ดาวน์โหลท": "ดาวน์โหลด",
}
TERM_PAIRS = [
    ("ยังไม่ระบุ", "ไม่ระบุ"), ("Google Sheet ", "Google Sheets"), ("web app", "เว็บแอป"),
    ("Deploy", "deploy"), ("LINE bot", "แชตบอต LINE"), ("ดีเอ็นเอ", "DNA"),
]


def check_drafts(chapters: list[Chapter], reg: RefRegistry) -> list[str]:
    out = []
    all_text = {}
    for ch in chapters:
        raw = ch.path.read_text(encoding="utf-8")
        all_text[ch.path.name] = raw
        lines = raw.split("\n")
        # หัวข้อลึกเกิน 2 จุด
        for b in ch.blocks:
            if b["t"] == "h":
                m = re.match(r"^(\d+(?:\.\d+)*)\s", b["text"])
                num = m.group(1) if m else None
                if b["level"] >= 4 or (num and num.count(".") > 2):
                    out.append(f"หัวข้อลึกเกิน 2 จุด: {ch.path.name}:{b['line']} \"{short(b['text'], 60)}\" — ควรใช้ 1) 1.1) ตาม template")
                if num and not num.startswith(f"{ch.num}."):
                    out.append(f"เลขหัวข้อไม่ตรงบท: {ch.path.name}:{b['line']} {num}")
        # ลำดับเลขหัวข้อ
        seen2, seen3 = [], {}
        for b in ch.blocks:
            if b["t"] != "h":
                continue
            m = re.match(r"^(\d+)\.(\d+)(?:\.(\d+))?\s", b["text"])
            if not m:
                if b["level"] <= 3:
                    out.append(f"หัวข้อไม่มีเลข: {ch.path.name}:{b['line']} \"{short(b['text'], 50)}\"")
                continue
            a, x, y = int(m.group(1)), int(m.group(2)), m.group(3)
            if y is None:
                if seen2 and x != seen2[-1] + 1:
                    out.append(f"เลขหัวข้อข้าม: {ch.path.name}:{b['line']} {a}.{x} (ก่อนหน้า {a}.{seen2[-1]})")
                seen2.append(x)
            else:
                prev = seen3.get(x, 0)
                if int(y) != prev + 1:
                    out.append(f"เลขหัวข้อย่อยข้าม: {ch.path.name}:{b['line']} {a}.{x}.{y}")
                seen3[x] = int(y)
        # ตาราง/รูป: ลำดับต่อเนื่อง และถูกอ้างถึงในเนื้อหา
        for kind, label in (("table", "ตารางที่"), ("fig", "รูปที่")):
            nums = []
            for b in ch.blocks:
                if kind == "table" and b["t"] == "table" and b["caption"]:
                    nums.append(re.match(r"ตารางที่\s*([\d.]+)", b["caption"]).group(1).rstrip("."))
                if kind == "fig" and b["t"] == "fig":
                    nums.append(b["num"])
            for k, nstr in enumerate(nums):
                exp = f"{ch.num}.{k + 1}"
                if nstr != exp:
                    out.append(f"เลข{label}ไม่ต่อเนื่อง: {ch.path.name} พบ {label} {nstr} (ควรเป็น {exp})")
            body_txt = "\n".join(b.get("text", "") for b in ch.blocks if b["t"] in ("p", "li", "licont"))
            for nstr in nums:
                if not re.search(label + r"\s*" + re.escape(nstr) + r"(?!\d)", body_txt):
                    out.append(f"{label} {nstr} ไม่ถูกอ้างถึงในเนื้อหา ({ch.path.name})")
            # อ้างถึงรูป/ตารางที่ไม่มีอยู่จริง
            for mm in re.finditer(label + r"\s*(\d+\.\d+)", body_txt):
                if mm.group(1).startswith(f"{ch.num}.") and mm.group(1) not in nums:
                    out.append(f"อ้างถึง {label} {mm.group(1)} แต่ไม่มีในบท ({ch.path.name})")
        # คำผิด/คำไม่มาตรฐาน (ไม่ตรวจส่วนรายการอ้างอิง เพราะชื่อบทความต้องคงตามต้นฉบับ)
        ref_start = next((k for k, l in enumerate(lines) if re.match(r"^#{2,}\s+(เอกสารอ้างอิง|แหล่งอ้างอิง)", l)), len(lines))
        for ln_no, ln in enumerate(lines[:ref_start], 1):
            for bad, good in TYPOS.items():
                if good and bad in ln:
                    out.append(f"คำที่ควรตรวจ: {ch.path.name}:{ln_no} \"{bad}\" → \"{good}\"")
            if re.search(r"\S  +\S", ln) and not ln.startswith((" ", "|")):
                out.append(f"เว้นวรรคซ้อน: {ch.path.name}:{ln_no}")
            if re.search(r"[ก-๙]ๆ|ๆ[ก-๙]", ln):
                out.append(f"ไม้ยมก (ๆ) ไม่เว้นวรรค: {ch.path.name}:{ln_no}")
            if re.search(r"\s+$", ln):
                out.append(f"มีช่องว่างท้ายบรรทัด: {ch.path.name}:{ln_no}")
    # ความสม่ำเสมอของคำ
    joined = "\n".join(all_text.values())
    for a, b in TERM_PAIRS:
        ca = joined.count(a)
        if a == "ยังไม่ระบุ":
            cb = len(re.findall(r"(?<!ยัง)ไม่ระบุ", joined))
        else:
            cb = joined.count(b) - (joined.count(a) if b in a else 0)
        if ca and cb > 0:
            per = []
            for name, txt in all_text.items():
                if a == "ยังไม่ระบุ":
                    nb = len(re.findall(r"(?<!ยัง)ไม่ระบุ", txt))
                else:
                    nb = txt.count(b) - (txt.count(a) if b in a else 0)
                per.append(f"{name}: \"{a}\"={txt.count(a)} \"{b}\"={nb}")
            out.append(f"ใช้คำไม่สม่ำเสมอ \"{a}\" ({ca}) กับ \"{b}\" ({cb}) — " + "; ".join(per))
    # อ้างอิง
    for d in reg.duplicates:
        out.append(f"อ้างอิงซ้ำ (รวมเป็นรายการเดียวในเล่ม): {d}")
    for u in reg.unresolved:
        out.append(f"อ้างอิงหาไม่พบ: {u}")
    _, uncited = reg.final_list()
    for k in uncited:
        out.append(f"อ้างอิงที่ไม่ถูกอ้างในเนื้อหา (ใส่ไว้ท้ายรายการ): {reg.entries[k]['origin']} {short(reg.entries[k]['text'])}")
    # [รอใส่]
    return out


def collect_todos(chapters, front_texts) -> list[str]:
    out = []
    for ch in chapters:
        for ln_no, ln in enumerate(ch.path.read_text(encoding="utf-8").split("\n"), 1):
            if ln.lstrip().startswith(">"):
                continue
            for m in re.finditer(r"\[รอใส่[^\]]*\]", ln):
                if m.group(0) in ("[รอใส่]", "[รอใส่: ...]") and "เครื่องหมาย" in ln:
                    continue
                out.append(f"{ch.path.name}:{ln_no} {m.group(0)}")
    for where, t in front_texts:
        for m in re.finditer(r"\[รอใส่[^\]]*\]", t):
            out.append(f"{where}: {m.group(0)}")
    return out


# ===========================================================================
# 8) ประกอบเล่ม
# ===========================================================================
def load_inputs():
    chapters = []
    for f in sorted(DRAFTS.glob("[0-9][0-9]-*.md")):
        if any(k in f.name for k in ("บทคัดย่อ", "กิตติกรรม", "ภาคผนวก", "Abstract", "abstract")):
            continue
        ch = parse_markdown(f)
        if ch.num is None:
            log("ร่าง", f"{f.name}: ไม่มีบรรทัด '# บทที่ N ...' — ข้าม")
            continue
        chapters.append(ch)
    chapters.sort(key=lambda c: c.num)
    present = {c.num for c in chapters}
    for k in range(1, 6):
        if k not in present:
            log("ร่าง", f"ยังไม่มีร่างบทที่ {k}")

    def paras_of(globpat):
        fs = sorted(DRAFTS.glob(globpat))
        if not fs:
            return None, None
        ch = parse_markdown(fs[0])
        return [b["text"] for b in ch.blocks if b["t"] == "p"], fs[0]

    abs_th, f1 = paras_of("*บทคัดย่อ*.md")
    abs_en, f2 = paras_of("*[Aa]bstract*.md")
    ack, f3 = paras_of("*กิตติกรรมประกาศ*.md")
    appx = sorted(DRAFTS.glob("*ภาคผนวก*.md"))
    appendix = parse_markdown(appx[0]) if appx else None
    return chapters, abs_th, abs_en, ack, appendix


def build(toc_pages=None):
    global LOG
    LOG = []
    chapters, abs_th, abs_en, ack, appendix = load_inputs()
    render_mermaid_all(chapters)
    reg = build_references(chapters)

    B = Builder(toc_pages)
    B.cover()
    # ส่วนหน้า: เลขหน้า ก ข ค (thaiLetters) เริ่ม ก
    B.new_section(margins=MARGIN, fmt="thaiLetters", start=1)
    B.abstract_th(abs_th or ["[รอใส่: บทคัดย่อภาษาไทย — ยังไม่มีไฟล์ thesis/drafts/00-บทคัดย่อ.md "
                             "ให้ thesis-writer เขียนหลังบทที่ 4–5 เสร็จ (ความยาวไม่เกิน 1 หน้า)]"])
    B.abstract_en(abs_en or ["[รอใส่: English abstract — thesis-editor จะแปลจากบทคัดย่อภาษาไทยเมื่อฉบับไทยเสร็จ]"])
    B.acknowledgement(ack or ["[รอใส่: กิตติกรรมประกาศ — ขอบคุณอาจารย์ที่ปรึกษา หน่วยงาน และผู้ที่ช่วยเหลือ "
                              "(เจ้าของโครงงานเขียนเอง)]"])
    B.toc_page("toc")
    B.toc_page("tables")
    B.toc_page("figures")
    # เนื้อหา: เลขหน้าอารบิก เริ่ม 1 ที่บทที่ 1
    B.new_section(margins=MARGIN, fmt="decimal", start=1)
    for k, ch in enumerate(chapters):
        B.chapter(ch)
        if k == 0:
            # ย่อหน้าแรกของ section ไม่ต้องขึ้นหน้าใหม่ซ้ำ
            pass
    B.references(reg)
    B.appendix(appendix)
    # ไม่ให้หัวบทแรกหลัง section break สร้างหน้าว่าง
    _drop_first_pagebreaks(B.doc)
    for t in B.doc.tables:
        sort_tblpr(t)
    return B, chapters, reg, (abs_th, abs_en, ack)


def _drop_first_pagebreaks(doc):
    body = doc.element.body
    prev_was_sect = True
    for el in body:
        if el.tag == qn("w:p"):
            ppr = el.find(qn("w:pPr"))
            if prev_was_sect and ppr is not None:
                pb = ppr.find(qn("w:pageBreakBefore"))
                if pb is not None:
                    ppr.remove(pb)
            text = "".join(t.text or "" for t in el.iter(qn("w:t")))
            has_sect = ppr is not None and ppr.find(qn("w:sectPr")) is not None
            if has_sect:
                prev_was_sect = True
            elif text.strip() or el.find(".//" + qn("w:drawing")) is not None:
                prev_was_sect = False
        elif el.tag == qn("w:tbl"):
            prev_was_sect = False


def toc_from_lo(B: Builder, lo_result) -> dict:
    """จับคู่รายการสารบัญที่เราสร้างกับเลขหน้าที่ LibreOffice คำนวณ (ตามลำดับ)"""
    pages = {}
    by_kind = {"toc": None, "tables": None, "figures": None}
    for ix in lo_result:
        lines = [ln for ln in ix["lines"] if "\t" in ln]
        joined = " ".join(lines)
        if "ตารางที่" in joined and by_kind["tables"] is None and "บทที่" not in joined:
            by_kind["tables"] = lines
        elif "รูปที่" in joined and by_kind["figures"] is None and "บทที่" not in joined:
            by_kind["figures"] = lines
        elif by_kind["toc"] is None:
            by_kind["toc"] = lines
    for kind, ours in B.toc_entries.items():
        lo = by_kind.get(kind) or []
        if len(lo) != len(ours):
            log("สารบัญ", f"{kind}: LibreOffice ได้ {len(lo)} รายการ แต่เล่มมี {len(ours)} รายการ — จับคู่ตามลำดับเท่าที่ได้")
        res = []
        for k, (level, text) in enumerate(ours):
            page = lo[k].rsplit("\t", 1)[-1].strip() if k < len(lo) else "?"
            if not page:
                page = "?"
                log("สารบัญ", f"{kind}: ไม่ได้เลขหน้าของ '{short(text, 40)}'")
            res.append((level, text, page))
        pages[kind] = res
    return pages


def drafts_version() -> str:
    try:
        head = subprocess.run(["git", "-C", str(ROOT), "log", "-1", "--format=%h %ci", "--", "thesis/drafts"],
                              capture_output=True, text=True).stdout.strip()
        dirty = subprocess.run(["git", "-C", str(ROOT), "status", "--porcelain", "--", "thesis/drafts"],
                               capture_output=True, text=True).stdout.strip()
    except Exception:
        head, dirty = "?", ""
    h = hashlib.sha1()
    for f in sorted(DRAFTS.glob("*.md")):
        h.update(f.name.encode())
        h.update(f.read_bytes())
    s = f"commit ล่าสุดที่แก้ thesis/drafts: {head}; sha1 ของไฟล์ร่างทั้งหมด: {h.hexdigest()[:12]}"
    if dirty:
        s += "; มีไฟล์ร่างที่ยังไม่ commit: " + ", ".join(ln[3:] for ln in dirty.splitlines())
    return s


def font_env(tmpdir: Path) -> str:
    """ถ้าเครื่องไม่มี TH SarabunPSK แต่มี Laksaman (ฟอนต์ TLWG ที่ออกแบบให้ขนาดเท่า TH SarabunPSK)
    ให้ LibreOffice/Chromium ใช้ Laksaman แทนผ่าน fontconfig ชั่วคราว (ไม่แตะการตั้งค่าของเครื่อง)
    ไฟล์ .docx ยังระบุ TH SarabunPSK ตามเดิม"""
    if not shutil.which("fc-list"):
        return "ไม่มี fc-list — ไม่ทราบฟอนต์ในเครื่อง"
    fams = subprocess.run(["fc-list", ":", "family"], capture_output=True, text=True).stdout
    if "TH SarabunPSK" in fams or "TH Sarabun New" in fams:
        return "มี TH SarabunPSK ในเครื่อง"
    if "Laksaman" not in fams:
        log("ฟอนต์", "ไม่มี TH SarabunPSK และ Laksaman — PDF จะใช้ฟอนต์ไทยอื่นแทน ระยะบรรทัด/เลขหน้าอาจต่างจาก Word")
        return "ไม่มี TH SarabunPSK/Laksaman"
    conf = tmpdir / "fonts.conf"
    conf.write_text(
        '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>'
        '<include ignore_missing="yes">/etc/fonts/fonts.conf</include>'
        '<alias binding="same"><family>TH SarabunPSK</family><prefer><family>Laksaman</family></prefer></alias>'
        '</fontconfig>', encoding="utf-8")
    os.environ["FONTCONFIG_FILE"] = str(conf)
    return "ไม่มี TH SarabunPSK ในเครื่อง — PDF ใช้ Laksaman (TLWG, ขนาดเท่ากัน) แทน"


def main():
    BUILD.mkdir(parents=True, exist_ok=True)
    tmpdir = Path(tempfile.mkdtemp(prefix="thesis-"))
    font_note = font_env(tmpdir)
    lo_script = TOOLS / "lo_update.py"
    have_lo = shutil.which("soffice") is not None

    toc_pages = None
    for rnd in range(3):
        B, chapters, reg, front = build(toc_pages)
        tmp = tmpdir / f"round{rnd}.docx"
        B.doc.save(str(tmp))
        if not have_lo:
            log("LibreOffice", "ไม่พบ soffice — สารบัญจะว่าง (เปิดใน Word แล้วกด F9)")
            break
        r = subprocess.run([sys.executable, str(lo_script), str(tmp), "--pdf", str(tmpdir / "out.pdf")],
                           capture_output=True, text=True)
        if r.returncode != 0:
            log("LibreOffice", "ปรับปรุงสารบัญไม่สำเร็จ: " + r.stderr.strip()[-300:])
            break
        new_pages = toc_from_lo(B, json.loads(r.stdout))
        if new_pages == toc_pages:
            break
        toc_pages = new_pages
        if rnd == 2:
            log("สารบัญ", "เลขหน้ายังไม่นิ่งหลัง 3 รอบ")
    # รอบสุดท้าย: สร้างเล่มพร้อมสารบัญที่มีเลขหน้า
    B, chapters, reg, front = build(toc_pages)
    B.doc.save(str(OUT_DOCX))
    if have_lo:
        r = subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(tmpdir), str(OUT_DOCX)],
                           capture_output=True, text=True)
        produced = tmpdir / (OUT_DOCX.stem + ".pdf")
        if produced.exists():
            shutil.copy(produced, OUT_PDF)
        else:
            log("PDF", "แปลง PDF ไม่สำเร็จ: " + r.stderr[-300:])

    # ---- รายงาน ----
    pages = "?"
    if OUT_PDF.exists() and shutil.which("pdfinfo"):
        info = subprocess.run(["pdfinfo", str(OUT_PDF)], capture_output=True, text=True).stdout
        m = re.search(r"Pages:\s+(\d+)", info)
        pages = m.group(1) if m else "?"
    issues = check_drafts(chapters, reg)
    todos = collect_todos(chapters, [("ปก/บทคัดย่อ (META ใน build_thesis.py)", " ".join(str(v) for v in META.values()))])
    items, uncited = reg.final_list()
    rep = [
        f"สร้างเมื่อ: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"ร่างที่ใช้: {drafts_version()}",
        f"บทที่สร้าง: " + ", ".join(f"บทที่ {c.num} ({c.path.name})" for c in chapters),
        f"จำนวนหน้า PDF: {pages}",
        f"ฟอนต์สำหรับ PDF: {font_note}",
        f"เอกสารอ้างอิงในเล่ม: {len(items)} รายการ (ไม่ถูกอ้าง {len(uncited)})",
        "",
        "== ข้อความในร่างที่ไม่ใส่ในเล่ม (หมายเหตุถึงบรรณาธิการ) ==",
    ]
    for ch in chapters:
        rep += [f"{ch.path.name} {d}" for d in ch.dropped]
    rep += ["", "== บันทึกการสร้าง =="] + LOG
    rep += ["", "== ผลตรวจร่างอัตโนมัติ =="] + issues
    rep += ["", "== ตารางเทียบเลขอ้างอิง (ร่าง -> เล่ม) =="]
    for num, e in items:
        rep.append(f"[{num}] <- {e['origin']}: {short(e['text'], 70)}")
    rep += ["", f"== รายการ [รอใส่] ({len(todos)}) =="] + todos
    OUT_LOG.write_text("\n".join(rep) + "\n", encoding="utf-8")
    print("\n".join(rep[:6]))
    print(f"เขียน {OUT_DOCX.relative_to(ROOT)}, {OUT_PDF.relative_to(ROOT)}, {OUT_LOG.relative_to(ROOT)}")
    shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    main()
