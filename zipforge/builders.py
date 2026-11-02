"""Rule-based builders: no API key needed. Each returns a single self-contained HTML page."""

from __future__ import annotations

import base64
import html
import io
import json
import mimetypes
import posixpath
import re
import zipfile

import pandas as pd

from .analyze import DATA_EXT, DOC_EXT, IMAGE_EXT, Analysis, ext
from .extract import Project

MAX_INLINE_ASSET = 8 * 1024 * 1024
MAX_ROWS = 5000

mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("font/woff2", ".woff2")


# --------------------------------------------------------------------------- helpers

def data_uri(path: str, data: bytes) -> str:
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


def _resolve(base_file: str, ref: str) -> str | None:
    ref = ref.strip().split("#", 1)[0].split("?", 1)[0]
    if not ref or re.match(r"^([a-z]+:|//|data:)", ref, re.I):
        return None
    if ref.startswith("/"):
        return posixpath.normpath(ref.lstrip("/"))
    return posixpath.normpath(posixpath.join(posixpath.dirname(base_file), ref))


def _inline_css_urls(css: str, css_path: str, project: Project) -> str:
    def repl(m: re.Match) -> str:
        target = _resolve(css_path, m.group(2))
        data = project.files.get(target) if target else None
        if data is None or len(data) > MAX_INLINE_ASSET:
            return m.group(0)
        return f"url({data_uri(target, data)})"

    return re.sub(r"url\(\s*(['\"]?)([^'\")]+)\1\s*\)", repl, css)


def page(title: str, body: str, head: str = "", script: str = "") -> str:
    """Shared, responsive page shell used by all generated apps."""
    return f"""<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<style>
:root {{ --bg:#f7f7fb; --card:#fff; --text:#1d1d2b; --muted:#6b6b80; --accent:#6c4cf1; --border:#e4e4ee; }}
@media (prefers-color-scheme: dark) {{
  :root {{ --bg:#12121a; --card:#1c1c28; --text:#ececf4; --muted:#9a9ab0; --accent:#9c86ff; --border:#2c2c3c; }}
}}
* {{ box-sizing:border-box; }}
body {{ margin:0; font-family: system-ui, -apple-system, "Segoe UI", "Noto Sans Thai", sans-serif;
       background:var(--bg); color:var(--text); line-height:1.6; }}
header.top {{ padding:20px 24px; background:linear-gradient(120deg,var(--accent),#22b8cf); color:#fff; }}
header.top h1 {{ margin:0; font-size:1.5rem; }}
header.top p {{ margin:4px 0 0; opacity:.9; }}
main {{ padding:20px 24px; max-width:1200px; margin:0 auto; }}
.card {{ background:var(--card); border:1px solid var(--border); border-radius:12px; padding:16px; margin-bottom:16px; }}
input[type=search], select {{ width:100%; padding:10px 12px; border-radius:8px; border:1px solid var(--border);
       background:var(--card); color:var(--text); font-size:1rem; }}
table {{ border-collapse:collapse; width:100%; font-size:.9rem; }}
th, td {{ border-bottom:1px solid var(--border); padding:6px 10px; text-align:left; white-space:nowrap; }}
th {{ position:sticky; top:0; background:var(--card); cursor:pointer; }}
.scroll {{ overflow:auto; max-height:480px; }}
.muted {{ color:var(--muted); font-size:.9rem; }}
a {{ color:var(--accent); }}
</style>
{head}
</head>
<body>
{body}
<script>{script}</script>
</body>
</html>"""


# --------------------------------------------------------------------------- static site

def build_static(project: Project, entry: str) -> str:
    """Inline stylesheets, scripts and media referenced by `entry` into one HTML file."""
    doc = project.text(entry) or ""

    def link_repl(m: re.Match) -> str:
        tag = m.group(0)
        if not re.search(r"rel\s*=\s*['\"]?stylesheet", tag, re.I):
            return tag
        href = re.search(r"href\s*=\s*['\"]([^'\"]+)['\"]", tag, re.I)
        target = _resolve(entry, href.group(1)) if href else None
        css = project.text(target) if target else None
        if css is None:
            return tag
        return f"<style>/* {target} */\n{_inline_css_urls(css, target, project)}\n</style>"

    def script_repl(m: re.Match) -> str:
        attrs = m.group(1)
        src = re.search(r"src\s*=\s*['\"]([^'\"]+)['\"]", attrs, re.I)
        target = _resolve(entry, src.group(1)) if src else None
        js = project.text(target) if target else None
        if js is None:
            return m.group(0)
        attrs = re.sub(r"\s*src\s*=\s*['\"][^'\"]+['\"]", "", attrs, flags=re.I)
        js = js.replace("</script", "<\\/script")
        return f"<script{attrs}>/* {target} */\n{js}\n</script>"

    def media_repl(m: re.Match) -> str:
        target = _resolve(entry, m.group(3))
        data = project.files.get(target) if target else None
        if data is None or len(data) > MAX_INLINE_ASSET or ext(target) in (".html", ".htm"):
            return m.group(0)
        return f"{m.group(1)}={m.group(2)}{data_uri(target, data)}{m.group(2)}"

    doc = re.sub(r"<link\b[^>]*>", link_repl, doc, flags=re.I)
    doc = re.sub(r"<script\b([^>]*)>\s*</script>", script_repl, doc, flags=re.I)
    doc = re.sub(r"\b(src|poster|href)=(['\"])([^'\"]+)\2", media_repl, doc, flags=re.I)
    doc = re.sub(r"(<style[^>]*>)(.*?)(</style>)",
                 lambda m: m.group(1) + _inline_css_urls(m.group(2), entry, project) + m.group(3),
                 doc, flags=re.I | re.S)
    return doc


# --------------------------------------------------------------------------- data dashboard

def _read_table(path: str, data: bytes) -> pd.DataFrame | None:
    e = ext(path)
    try:
        if e == ".csv":
            return pd.read_csv(io.BytesIO(data), encoding_errors="replace")
        if e == ".tsv":
            return pd.read_csv(io.BytesIO(data), sep="\t", encoding_errors="replace")
        if e in (".xlsx", ".xls"):
            return pd.read_excel(io.BytesIO(data))
        if e == ".json":
            obj = json.loads(data.decode("utf-8"))
            if isinstance(obj, dict):
                lists = [v for v in obj.values() if isinstance(v, list)]
                obj = lists[0] if lists else [obj]
            return pd.json_normalize(obj) if isinstance(obj, list) else None
    except Exception:  # noqa: BLE001 - any unreadable file is just skipped
        return None
    return None


def load_tables(project: Project) -> dict[str, pd.DataFrame]:
    tables = {}
    for path, data in sorted(project.files.items()):
        if ext(path) in DATA_EXT:
            df = _read_table(path, data)
            if df is not None and not df.empty:
                tables[path] = df
    return tables


def build_dashboard(project: Project) -> str:
    tables = load_tables(project)
    datasets = []
    for path, df in tables.items():
        df = df.head(MAX_ROWS)
        numeric = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
        datasets.append({
            "name": path,
            "columns": [str(c) for c in df.columns],
            "numeric": [str(c) for c in numeric],
            "rows": json.loads(df.astype(object).where(df.notna(), None).to_json(orient="values",
                                                                                   default_handler=str)),
        })
    payload = json.dumps(datasets, ensure_ascii=False).replace("</", "<\\/")
    body = f"""
<header class="top"><h1>📊 {html.escape(project.name)}</h1>
<p>แดชบอร์ดข้อมูล · {len(datasets)} ชุดข้อมูล</p></header>
<main>
  <div class="card"><label>ชุดข้อมูล</label> <select id="ds"></select></div>
  <div class="card" id="stats"></div>
  <div class="card"><div style="display:flex;gap:12px;flex-wrap:wrap">
    <div style="flex:1;min-width:200px"><label>แกน X</label><select id="xcol"></select></div>
    <div style="flex:1;min-width:200px"><label>ค่า (Y)</label><select id="ycol"></select></div>
    <div style="flex:1;min-width:200px"><label>ชนิดกราฟ</label>
      <select id="ctype"><option value="bar">Bar</option><option value="line">Line</option>
      <option value="scatter">Scatter</option></select></div></div>
    <canvas id="chart" height="110"></canvas></div>
  <div class="card"><input type="search" id="q" placeholder="🔍 ค้นหาในตาราง...">
    <p class="muted" id="count"></p><div class="scroll"><table id="tbl"></table></div></div>
</main>"""
    head = '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>'
    script = """
const DATA = %s;
let cur = 0, sortCol = -1, sortAsc = true, chart;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
DATA.forEach((d, i) => $('ds').add(new Option(d.name + ' (' + d.rows.length + ' แถว)', i)));
function opts(sel, cols) { sel.innerHTML=''; cols.forEach(c => sel.add(new Option(c, c))); }
function load() {
  const d = DATA[cur]; sortCol = -1;
  opts($('xcol'), d.columns); opts($('ycol'), d.numeric.length ? d.numeric : d.columns);
  if (d.numeric.length && d.columns[0] === d.numeric[0] && d.columns.length > 1) $('xcol').value = d.columns.find(c => !d.numeric.includes(c)) || d.columns[0];
  const stats = d.numeric.slice(0, 6).map(c => {
    const k = d.columns.indexOf(c), v = d.rows.map(r => r[k]).filter(x => typeof x === 'number');
    const sum = v.reduce((a, b) => a + b, 0);
    return `<div style="flex:1;min-width:150px"><div class="muted">${esc(c)}</div><b>${(sum / (v.length || 1)).toLocaleString(undefined,{maximumFractionDigits:2})}</b> <span class="muted">เฉลี่ย</span><br><span class="muted">รวม ${sum.toLocaleString(undefined,{maximumFractionDigits:2})}</span></div>`;
  }).join('');
  $('stats').innerHTML = `<div style="display:flex;gap:16px;flex-wrap:wrap"><div style="flex:1;min-width:150px"><div class="muted">จำนวนแถว</div><b>${d.rows.length.toLocaleString()}</b></div><div style="flex:1;min-width:150px"><div class="muted">คอลัมน์</div><b>${d.columns.length}</b></div>${stats}</div>`;
  table(); draw();
}
function table() {
  const d = DATA[cur], q = $('q').value.toLowerCase();
  let rows = d.rows.filter(r => !q || r.some(v => String(v ?? '').toLowerCase().includes(q)));
  if (sortCol >= 0) rows = [...rows].sort((a, b) => (a[sortCol] > b[sortCol] ? 1 : a[sortCol] < b[sortCol] ? -1 : 0) * (sortAsc ? 1 : -1));
  $('count').textContent = `แสดง ${Math.min(rows.length, 500)} จาก ${rows.length} แถว`;
  $('tbl').innerHTML = '<thead><tr>' + d.columns.map((c, i) => `<th data-i="${i}">${esc(c)}${i === sortCol ? (sortAsc ? ' ▲' : ' ▼') : ''}</th>`).join('') + '</tr></thead><tbody>' +
    rows.slice(0, 500).map(r => '<tr>' + r.map(v => `<td>${esc(v)}</td>`).join('') + '</tr>').join('') + '</tbody>';
  document.querySelectorAll('#tbl th').forEach(th => th.onclick = () => { const i = +th.dataset.i; sortAsc = sortCol === i ? !sortAsc : true; sortCol = i; table(); });
}
function draw() {
  if (typeof Chart === 'undefined') return;
  const d = DATA[cur], xi = d.columns.indexOf($('xcol').value), yi = d.columns.indexOf($('ycol').value), type = $('ctype').value;
  let labels, values;
  if (type === 'scatter') { values = d.rows.slice(0, 2000).map(r => ({x: +r[xi], y: +r[yi]})); }
  else {
    const agg = new Map(); d.rows.forEach(r => { const k = String(r[xi]); agg.set(k, (agg.get(k) || 0) + (+r[yi] || 0)); });
    let entries = [...agg.entries()]; if (entries.length > 60) entries = entries.slice(0, 60);
    labels = entries.map(e => e[0]); values = entries.map(e => e[1]);
  }
  if (chart) chart.destroy();
  chart = new Chart($('chart'), { type, data: { labels, datasets: [{ label: $('ycol').value, data: values, backgroundColor: '#6c4cf1aa', borderColor: '#6c4cf1' }] },
    options: { plugins: { legend: { display: false } }, scales: type === 'scatter' ? { x: { type: 'linear' } } : {} } });
}
$('ds').onchange = e => { cur = +e.target.value; load(); };
$('q').oninput = table; ['xcol', 'ycol', 'ctype'].forEach(id => $(id).onchange = draw);
if (DATA.length) load(); else $('stats').textContent = 'ไม่พบข้อมูลที่อ่านได้';
""" % payload
    return page(project.name, body, head, script)


# --------------------------------------------------------------------------- docs site

def build_docs(project: Project) -> str:
    docs = {p: project.text(p) for p in sorted(project.files) if ext(p) in DOC_EXT}
    docs = {p: t for p, t in docs.items() if t is not None}
    readme = next((p for p in docs if posixpath.basename(p).lower().startswith("readme")), None)
    order = ([readme] if readme else []) + [p for p in docs if p != readme]
    images = {p: data_uri(p, d) for p, d in project.files.items()
              if ext(p) in IMAGE_EXT and len(d) <= MAX_INLINE_ASSET}
    payload = json.dumps({"order": order, "docs": docs, "images": images},
                         ensure_ascii=False).replace("</", "<\\/")
    head = """<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
<style>
.layout { display:flex; gap:20px; } nav { width:260px; flex-shrink:0; }
nav a { display:block; padding:6px 10px; border-radius:6px; text-decoration:none; color:var(--text); word-break:break-all; }
nav a.active, nav a:hover { background:var(--accent); color:#fff; }
article img { max-width:100%; } article pre { background:var(--bg); padding:12px; border-radius:8px; overflow:auto; }
@media (max-width: 760px) { .layout { flex-direction:column; } nav { width:100%; } }
</style>"""
    body = f"""<header class="top"><h1>📚 {html.escape(project.name)}</h1>
<p>เว็บไซต์เอกสาร · {len(order)} หน้า</p></header>
<main><div class="layout"><nav class="card"><input type="search" id="q" placeholder="🔍 ค้นหา..."><div id="nav"></div></nav>
<article class="card" id="content" style="flex:1;min-width:0"></article></div></main>"""
    script = """
const D = %s;
const $ = id => document.getElementById(id);
function show(p) {
  const t = D.docs[p];
  let h = (window.marked && !p.endsWith('.txt')) ? marked.parse(t) : '<pre>' + t.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])) + '</pre>';
  $('content').innerHTML = h;
  $('content').querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || ''; const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
    const key = Object.keys(D.images).find(k => k === (dir + src).replace(/^\\.\\//, '') || k.endsWith(src.replace(/^\\.?\\//, '')));
    if (key) img.src = D.images[key];
  });
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.p === p));
  location.hash = encodeURIComponent(p);
}
function nav() {
  const q = $('q').value.toLowerCase();
  $('nav').innerHTML = D.order.filter(p => !q || p.toLowerCase().includes(q) || D.docs[p].toLowerCase().includes(q))
    .map(p => `<a href="#" data-p="${p.replace(/"/g, '&quot;')}">📄 ${p.replace(/[&<>]/g, '')}</a>`).join('');
  document.querySelectorAll('#nav a').forEach(a => a.onclick = e => { e.preventDefault(); show(a.dataset.p); });
}
$('q').oninput = nav; nav();
const start = decodeURIComponent(location.hash.slice(1));
if (D.order.length) show(D.docs[start] !== undefined ? start : D.order[0]);
""" % payload
    return page(project.name, body, head, script)


# --------------------------------------------------------------------------- gallery

def build_gallery(project: Project) -> str:
    imgs = [(p, data_uri(p, d)) for p, d in sorted(project.files.items())
            if ext(p) in IMAGE_EXT and len(d) <= MAX_INLINE_ASSET]
    tiles = "".join(
        f'<figure class="tile" data-name="{html.escape(p.lower())}"><img loading="lazy" src="{u}" alt="{html.escape(p)}">'
        f'<figcaption>{html.escape(posixpath.basename(p))}</figcaption></figure>'
        for p, u in imgs
    )
    head = """<style>
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:14px; }
.tile { margin:0; background:var(--card); border:1px solid var(--border); border-radius:12px; overflow:hidden; cursor:zoom-in; }
.tile img { width:100%; height:180px; object-fit:cover; display:block; transition:transform .25s; }
.tile:hover img { transform:scale(1.05); }
.tile figcaption { padding:8px 10px; font-size:.85rem; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#lb { position:fixed; inset:0; background:#000d; display:none; align-items:center; justify-content:center; z-index:9; cursor:zoom-out; }
#lb img { max-width:92vw; max-height:88vh; border-radius:8px; }
</style>"""
    body = f"""<header class="top"><h1>🖼️ {html.escape(project.name)}</h1><p>แกลเลอรี · {len(imgs)} รูป</p></header>
<main><div class="card"><input type="search" id="q" placeholder="🔍 ค้นหาชื่อรูป..."></div>
<div class="grid">{tiles}</div></main><div id="lb"><img id="lbimg" alt=""></div>"""
    script = """
const lb = document.getElementById('lb'), li = document.getElementById('lbimg');
document.querySelectorAll('.tile').forEach(t => t.onclick = () => { li.src = t.querySelector('img').src; lb.style.display = 'flex'; });
lb.onclick = () => lb.style.display = 'none';
document.addEventListener('keydown', e => { if (e.key === 'Escape') lb.style.display = 'none'; });
document.getElementById('q').oninput = e => { const q = e.target.value.toLowerCase();
  document.querySelectorAll('.tile').forEach(t => t.style.display = t.dataset.name.includes(q) ? '' : 'none'); };
"""
    return page(project.name, body, head, script)


# --------------------------------------------------------------------------- code browser

def build_code_browser(project: Project) -> str:
    files = {}
    for p in sorted(project.files):
        t = project.text(p)
        if t is not None and len(t) < 300_000:
            files[p] = t
    payload = json.dumps(files, ensure_ascii=False).replace("</", "<\\/")
    head = """<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css">
<script src="https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/highlight.min.js"></script>
<style>.layout{display:flex;gap:20px}nav{width:300px;flex-shrink:0;max-height:75vh;overflow:auto}
nav a{display:block;padding:4px 8px;border-radius:6px;text-decoration:none;color:var(--text);font-size:.85rem;word-break:break-all}
nav a.active,nav a:hover{background:var(--accent);color:#fff}pre{margin:0;max-height:75vh;overflow:auto;border-radius:8px}
@media (max-width:760px){.layout{flex-direction:column}nav{width:100%;max-height:240px}}</style>"""
    body = f"""<header class="top"><h1>💻 {html.escape(project.name)}</h1><p>เบราว์เซอร์ซอร์สโค้ด · {len(files)} ไฟล์</p></header>
<main><div class="layout"><nav class="card"><input type="search" id="q" placeholder="🔍 ค้นหาไฟล์..."><div id="nav"></div></nav>
<div class="card" style="flex:1;min-width:0"><h3 id="fname" style="margin-top:0"></h3><pre><code id="code"></code></pre></div></div></main>"""
    script = """
const F = %s, $ = id => document.getElementById(id);
function show(p) { $('fname').textContent = p; const c = $('code'); c.textContent = F[p]; c.removeAttribute('data-highlighted');
  c.className = ''; if (window.hljs) hljs.highlightElement(c);
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.p === p)); }
function nav() { const q = $('q').value.toLowerCase();
  $('nav').innerHTML = Object.keys(F).filter(p => p.toLowerCase().includes(q)).map(p => `<a href="#" data-p="${p.replace(/"/g,'&quot;')}">${p.replace(/[&<>]/g,'')}</a>`).join('');
  document.querySelectorAll('#nav a').forEach(a => a.onclick = e => { e.preventDefault(); show(a.dataset.p); }); }
$('q').oninput = nav; nav(); const k = Object.keys(F); const r = k.find(p => /readme/i.test(p)) || k[0]; if (r) show(r);
""" % payload
    return page(project.name, body, head, script)


# --------------------------------------------------------------------------- dispatch

def build_auto(project: Project, analysis: Analysis) -> str:
    if analysis.kind == "static" and analysis.entry:
        return build_static(project, analysis.entry)
    if analysis.kind == "data":
        return build_dashboard(project)
    if analysis.kind == "docs":
        return build_docs(project)
    if analysis.kind == "gallery":
        return build_gallery(project)
    return build_code_browser(project)


def package_site(project: Project, app_html: str, keep_sources: bool) -> bytes:
    """Zip ready to drop on Netlify / Vercel / GitHub Pages / any static host."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("index.html", app_html)
        if keep_sources:
            for path, data in project.files.items():
                if path != "index.html":
                    zf.writestr(f"source/{path}", data)
        zf.writestr("README.txt",
                    "สร้างโดย ZipForge AI\n\n"
                    "เปิด index.html ในเบราว์เซอร์ได้ทันที หรืออัปโหลดโฟลเดอร์นี้ไปที่\n"
                    "Netlify Drop (app.netlify.com/drop), Vercel, GitHub Pages หรือโฮสต์ static ใดก็ได้\n")
    return buf.getvalue()
