"""Figure out what kind of project a ZIP contains."""

from __future__ import annotations

import json
import posixpath
from collections import Counter
from dataclasses import dataclass

from .extract import Project

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"}
DATA_EXT = {".csv", ".tsv", ".xlsx", ".xls", ".json"}
DOC_EXT = {".md", ".markdown", ".txt", ".rst"}
CODE_EXT = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".html", ".htm", ".css", ".scss", ".vue",
    ".svelte", ".java", ".go", ".rs", ".rb", ".php", ".c", ".cpp", ".h", ".cs",
    ".kt", ".swift", ".sql", ".sh", ".yml", ".yaml", ".toml",
}

KINDS = {
    "static": "🌐 เว็บไซต์ HTML/CSS/JS",
    "data": "📊 ไฟล์ข้อมูล (CSV / Excel / JSON)",
    "docs": "📚 เอกสาร Markdown / ข้อความ",
    "gallery": "🖼️ รูปภาพ",
    "code": "💻 ซอร์สโค้ด (ต้องให้ AI แปลงเป็นเว็บ)",
}


@dataclass
class Analysis:
    kind: str
    entry: str | None
    framework: str | None
    ext_counts: Counter
    total_bytes: int
    notes: list[str]

    @property
    def label(self) -> str:
        return KINDS[self.kind]


def ext(path: str) -> str:
    return posixpath.splitext(path)[1].lower()


def find_index_html(paths: list[str]) -> str | None:
    candidates = [p for p in paths if posixpath.basename(p).lower() in ("index.html", "index.htm")]
    if not candidates:
        return None
    # prefer built output folders, then the shallowest path
    preferred = ("dist/", "build/", "public/", "out/", "docs/", "site/")
    candidates.sort(key=lambda p: (not p.startswith(preferred), p.count("/"), p))
    return candidates[0]


def detect_framework(project: Project) -> str | None:
    pkg = project.text("package.json")
    if pkg:
        try:
            deps = json.loads(pkg)
            deps = {**deps.get("dependencies", {}), **deps.get("devDependencies", {})}
        except (json.JSONDecodeError, AttributeError):
            deps = {}
        for key, name in (("next", "Next.js"), ("react", "React"), ("vue", "Vue"),
                          ("svelte", "Svelte"), ("@angular/core", "Angular"), ("vite", "Vite")):
            if key in deps:
                return name
        return "Node.js"
    reqs = (project.text("requirements.txt") or "").lower()
    for key, name in (("streamlit", "Streamlit"), ("flask", "Flask"),
                      ("django", "Django"), ("fastapi", "FastAPI")):
        if key in reqs:
            return name
    if any(ext(p) == ".py" for p in project.files):
        return "Python"
    return None


def analyze(project: Project) -> Analysis:
    paths = list(project.files)
    counts = Counter(ext(p) or "(no ext)" for p in paths)
    total = sum(len(d) for d in project.files.values())
    framework = detect_framework(project)
    notes: list[str] = []

    n_img = sum(counts[e] for e in IMAGE_EXT)
    n_data = sum(counts[e] for e in DATA_EXT if e != ".json")
    n_json = counts[".json"]
    n_doc = sum(counts[e] for e in DOC_EXT)
    n_code = sum(counts[e] for e in CODE_EXT)

    index = find_index_html(paths)
    is_source_framework = framework in {"React", "Vue", "Svelte", "Angular", "Next.js", "Vite"}

    if index and not (is_source_framework and not index.startswith(("dist/", "build/", "out/"))):
        kind, entry = "static", index
        notes.append(f"พบหน้าหลัก `{index}` — จะรวม CSS/JS/รูปภาพเป็นไฟล์เดียว")
    elif n_data + n_json and n_code == 0 and (n_data + n_json) >= max(n_doc, n_img, 1):
        kind, entry = "data", None
        notes.append("พบไฟล์ข้อมูล — จะสร้างแดชบอร์ดพร้อมตารางค้นหาและกราฟ")
    elif n_doc and n_code == 0 and n_doc >= n_img:
        kind, entry = "docs", None
        notes.append("พบไฟล์เอกสาร — จะสร้างเว็บไซต์เอกสารพร้อมเมนูนำทาง")
    elif n_img and n_code == 0:
        kind, entry = "gallery", None
        notes.append("พบรูปภาพ — จะสร้างเว็บแกลเลอรีพร้อมการดูภาพขนาดใหญ่")
    else:
        kind, entry = "code", None
        notes.append("เป็นซอร์สโค้ด — โหมด AI จะเขียนเว็บแอปไฟล์เดียวที่ทำงานได้จริงจากโค้ดนี้")
        notes.append("โหมดอัตโนมัติ (ไม่ใช้ AI) จะสร้างเว็บสำหรับเปิดดูซอร์สโค้ด")

    if framework:
        notes.append(f"เฟรมเวิร์กที่ตรวจพบ: **{framework}**")
    return Analysis(kind, entry, framework, counts, total, notes)
