#!/usr/bin/env python3
"""สร้าง apps-script/Index.html จาก dashboard/index.html (ต้นฉบับของเจ้าของ)

ทำไมต้องมีสคริปต์: ให้หน้าตา/กราฟ/ตัวอ่านข้อมูลของ Apps Script ตรงกับต้นฉบับเสมอ
ถ้าแก้ dashboard/index.html แล้ว ให้รัน `python3 apps-script/test/build_index.py` ใหม่
สคริปต์จะหยุดพร้อมข้อความ ถ้าข้อความที่ต้องแทนที่ในต้นฉบับเปลี่ยนไป

สิ่งที่เปลี่ยน:
  - ตัด gviz (fetch Google Sheet สาธารณะ), ฟอร์มเพิ่มลิงก์ชีต, โหมดไฟล์ตัวอย่าง samples/*.xlsx, ?sheet=
  - เพิ่มตัวเชื่อม google.script.run (serverBook) ที่คืนข้อมูลรูปเดียวกับตัวอ่านเดิม
  - ดูไฟล์ Excel ในเครื่องได้เหมือนเดิม (โหลด JSZip เมื่อเลือกไฟล์เท่านั้น) แต่ตัด "เชื่อมไฟล์ในเครื่อง"
    (showOpenFilePicker ใช้ใน iframe ของ Apps Script ไม่ได้)
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "dashboard" / "index.html"
OUT = ROOT / "apps-script" / "Index.html"


def cut(s, start, end, new, keep_end=True):
    """แทนข้อความตั้งแต่ start ถึงก่อน end (start/end ต้องพบครั้งเดียว)"""
    for m in (start, end):
        if s.count(m) != 1:
            sys.exit(f"build_index: พบ {s.count(m)} ครั้ง (ต้อง 1): {m[:70]!r}")
    i, j = s.index(start), s.index(end)
    assert i < j, start
    return s[:i] + new + (s[j:] if keep_end else s[j + len(end):])


def rep(s, old, new):
    if s.count(old) != 1:
        sys.exit(f"build_index: พบ {s.count(old)} ครั้ง (ต้อง 1): {old[:70]!r}")
    return s.replace(old, new)


s = SRC.read_text(encoding="utf-8")

# 0) บรรทัดแรกของต้นฉบับเป็นเปลือก HTML ซ้อน (มาจากตัวแสดงผลอื่น) และเมตาที่ไม่ใช้
s = s[s.index("<!doctype html>\n<html lang=\"th\">"):]
s = rep(s, '<meta name="claude:viewport-fit-sides" content="cover">\n', "")

# 1) สคริปต์ภายนอก: JSZip โหลดเมื่อเลือกไฟล์เท่านั้น, ไม่มี sourcesConfig
s = rep(s, '<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>\n', "")
s = re.sub(r'<!-- ชีตเริ่มต้น.*?-->\n<script type="application/json" id="sourcesConfig">.*?</script>\n', "", s, count=1)
s = cut(s, "const EMBED = null;", "const MONTHS = ", "")
s = rep(s, '<select class="sel" id="srcSel" aria-label="เลือกแหล่งข้อมูล Google Sheet">',
        '<select class="sel" id="srcSel" aria-label="เลือกแหล่งข้อมูล">')

# 2) ตัวอ่าน: แทน gviz ด้วย google.script.run
s = rep(s, "   1) ตัวอ่านข้อมูล: ไฟล์ .xlsx  และ  Google Sheet (gviz)",
        "   1) ตัวอ่านข้อมูล: ไฟล์ .xlsx  และ  Google Sheet ผ่านเซิร์ฟเวอร์ Apps Script")
s = rep(s, "async function readXlsx(buf){\n  const zip = await JSZip.loadAsync(buf);",
        """const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
function needZip(){ if (window.JSZip) return Promise.resolve(); return needZip.p ||= new Promise((res, rej) => {
  const el = document.createElement('script'); el.src = JSZIP_URL; el.onload = res;
  el.onerror = () => { needZip.p = null; rej(new Error('โหลดตัวอ่านไฟล์ Excel ไม่ได้ · ตรวจอินเทอร์เน็ตแล้วลองใหม่')); };
  document.head.appendChild(el); }); }
async function readXlsx(buf){
  await needZip(); const zip = await JSZip.loadAsync(buf);""")
s = cut(s, "class GsError extends Error", "// ดึงแท็บ + ตรวจหัวคอลัมน์", """/* ---- ตัวเชื่อมเซิร์ฟเวอร์: google.script.run → Promise ---- */
const RUN = (fn, ...args) => new Promise((res, rej) => {
  if (!(window.google && google.script && google.script.run)) return rej(new Error('หน้านี้ต้องเปิดผ่านลิงก์ Web app ของ Apps Script'));
  google.script.run.withSuccessHandler(res).withFailureHandler(e => rej(new Error(String((e && e.message) || e).replace(/^(Exception|Error):\\s*/, ''))))[fn](...args); });
// ได้ "สมุด" รูปเดียวกับ readXlsx: { names, rows(tab), sig() } วันที่เป็นเลข serial เหมือนไฟล์ Excel
function serverBook(key){
  let p = null; const load = () => p ||= RUN('getBook', key);
  return { names: null, async rows(tab){ const b = await load(); this.names = b.names; return b.tabs[tab] || null; },
    async sig(){ return 's' + (await load()).sig; } };
}
""")
s = rep(s, "// ดึงแท็บ + ตรวจหัวคอลัมน์ (Google ส่งแท็บแรกกลับมาเงียบ ๆ เมื่อชื่อแท็บไม่มี)", "// ดึงแท็บ + ตรวจหัวคอลัมน์")

# 3) แหล่งข้อมูล: เขียนส่วนที่ 6 ใหม่
SEC6 = r"""   6) แหล่งข้อมูล: Google Sheet (อ่านฝั่งเซิร์ฟเวอร์) และไฟล์ Excel ในเครื่อง
   ========================================================= */
const S = { sources: [], active: null, M: null, tpl: null, fy: null, yr: 0, view: 'overview', lotQ: '', lotLimit: 25, pendF: 'all', pendLimit: 25, cm: 0, hideUn: false, drill: null,
  sig: '', prevKpi: {}, busy: false, gen: 0, error: '', email: '', refreshSec: 120 };
const cur = () => S.sources.find(s => s.id === S.active);
const uid = () => 's' + Math.random().toString(36).slice(2, 8);
function persist(){ try { if (S.active && !S.active.startsWith('file-')) localStorage.setItem('dna-src-as', S.active); } catch (e) {} }
async function seedSources(){
  const info = await RUN('getSources');
  S.email = info.email || ''; S.refreshSec = Math.max(30, +info.refreshSeconds || 120);
  S.sources = (info.sources || []).map(x => ({ id: 'srv-' + x.key, type: 'server', key: x.key, name: x.name, tpl: x.tpl }));
  let saved = null; try { saved = localStorage.getItem('dna-src-as'); } catch (e) {}
  const def = S.sources.find(x => x.key === 'cases') || S.sources[0];
  S.active = S.sources.some(x => x.id === saved) ? saved : def ? def.id : null;
}
async function loadSource(src){
  let book, sig;
  if (src.type === 'server') book = serverBook(src.key);
  else { const b = src.bytes; if (!b) throw new Error('ไม่มีข้อมูลไฟล์ · เลือกไฟล์อีกครั้ง'); sig = 'x' + hash(new Uint8Array(b)); book = await readXlsx(b); }
  const tpl = src.tpl && src.tpl !== 'auto' ? src.tpl : await detectTpl(book, src);
  const tabs = tabsOf(src, tpl), M = tpl === 'lab' ? await buildLab(book, tabs) : await buildCases(book, tabs);
  if (src.type === 'server') sig = await book.sig();
  return { tpl, M, sig };
}

/* ---- โหลด / รีเฟรช / โพลล์ ---- */
let pollT = null;
async function refresh(first){
  const s = cur(); if (!s || S.busy) return; const gen = S.gen; S.busy = true;
  if (first) { s.state = 'busy'; setStatus(); }
  try {
    const r = await loadSource(s); if (gen !== S.gen) return;
    s.err = ''; s.state = s.type === 'server' ? 'live' : 'static'; s.at = new Date();
    if (!s.tpl || s.tpl === 'auto') s.detected = r.tpl;
    if (first || r.sig !== S.sig) { S.sig = r.sig; S.M = r.M; S.tpl = r.tpl; S.error = ''; if (first) resetView(r.tpl); render(); if (!first) toast('อัปเดตข้อมูลจาก Google Sheet แล้ว', 2200); }
    else setStatus();
  } catch (e) {
    if (gen !== S.gen) return; console.warn(e); s.state = 'lost'; s.err = e.message || String(e);
    if (first) { S.M = null; S.tpl = null; S.error = s.err; S.view = 'overview'; render(); } else setStatus();
  } finally { if (gen === S.gen) S.busy = false; }
}
function schedule(){ clearTimeout(pollT); const s = cur(); if (!s || s.type !== 'server') return;
  pollT = setTimeout(async () => { if (!document.hidden) await refresh(false); schedule(); }, S.refreshSec * 1000); }
document.addEventListener('visibilitychange', () => { const s = cur(); if (!document.hidden && s && s.type === 'server') refresh(false).then(schedule); });
function resetView(tpl){ S.fy = null; S.yr = 0; S.lotQ = ''; S.lotLimit = 25; S.pendLimit = 25; S.pendF = 'all'; S.cm = 0; S.drill = null; S.prevKpi = {}; if (!validViews(tpl).includes(S.view)) S.view = 'overview'; }
async function activate(id){
  clearTimeout(pollT); S.gen++; S.busy = false; S.active = id; S.sig = ''; persist();
  const s = cur(); if (s) { s.state = 'busy'; s.err = ''; } S.M = null; S.tpl = null; S.error = ''; render();
  await refresh(true); schedule();
}
const validViews = tpl => ['sources', ...(tpl ? TPL[tpl].nav.map(n => n[0]) : [])];

/* ---- หน้า แหล่งข้อมูล ---- */
function viewSources(){
  const rows = S.sources.map(x => { const on = x.id === S.active, t = x.tpl && x.tpl !== 'auto' ? x.tpl : x.detected;
    const st = x.state === 'live' ? `<span class="badge ok">เชื่อมสด</span>` : x.state === 'lost' ? `<span class="badge bad">เชื่อมต่อไม่ได้</span>` : x.state === 'busy' ? '<span class="badge ok">กำลังโหลด…</span>' : '';
    return `<li class="src${on ? ' on' : ''}"><div><h3>${esc(x.name)} ${on ? '<span class="badge">กำลังแสดง</span>' : ''} ${t ? `<span class="badge ok">${esc(TPL[t].short)}</span>` : ''} ${st}</h3>
      <p>${x.type === 'server' ? 'Google Sheet (ส่วนตัว) อ่านผ่านเซิร์ฟเวอร์ Apps Script · ตรวจข้อมูลใหม่ทุก ' + Math.round(S.refreshSec / 60) + ' นาที' : 'ไฟล์ที่เลือกเอง (อยู่ในเครื่องนี้เท่านั้น ไม่ถูกส่งขึ้นเซิร์ฟเวอร์) · ' + esc(x.fileName || '')}</p>${x.err ? `<p style="color:var(--bad)">${esc(x.err)}</p>` : ''}</div>
      <div class="acts">${on ? '' : `<button class="btn sm" data-act="use" data-id="${x.id}">แสดง</button>`}${x.type === 'file' ? `<button class="btn sm ghost danger" data-act="del" data-id="${x.id}">ลบ</button>` : ''}</div></li>`; }).join('');
  const info = S.M && S.tpl === 'lab' && S.M.notes.length ? `<section class="card span-12"><div class="card-h"><div><h2>หมายเหตุ สมมติฐาน และข้อมูลที่ควรตรวจสอบ</h2><p>อ่านจากแท็บ "หมายเหตุ" ของแหล่งข้อมูลที่แสดงอยู่</p></div></div><ul class="notes">${S.M.notes.map(([a, b]) => b == null ? `<li class="h">${esc(a)}</li>` : `<li><b>${esc(a)}</b><span>${esc(b)}</span></li>`).join('')}</ul></section>` : '';
  return `<div class="grid">
    <section class="card span-12"><div class="card-h"><div><h2>แหล่งข้อมูล</h2><p>เลือกชุดข้อมูลที่จะแสดงได้ที่มุมขวาบน หรือกด "แสดง"${S.email ? ` · เข้าสู่ระบบเป็น <b>${esc(S.email)}</b>` : ''}</p></div></div><ul class="srcs">${rows || '<li class="src"><div><p>ยังไม่มีแหล่งข้อมูล</p></div></li>'}</ul></section>
    <section class="card span-7"><div class="card-h"><div><h2>ข้อมูลมาจากไหน</h2></div></div><ol class="steps">
      <li><b>Google Sheet เป็นแบบส่วนตัว</b> ไม่ต้องแชร์ "ทุกคนที่มีลิงก์" เซิร์ฟเวอร์ Apps Script อ่านข้อมูลให้เฉพาะผู้ที่มีชื่อในแท็บ <code>ผู้ใช้</code></li>
      <li><b>เปลี่ยนชีต</b> ผู้ดูแลแก้ค่า <code>CASES_SHEET_ID</code> / <code>LAB_SHEET_ID</code> ใน Script Properties (ดูคู่มือ apps-script/README.md)</li>
      <li>แก้ข้อมูลในชีตตามปกติ หน้านี้จะดึงข้อมูลใหม่ทุก ${Math.round(S.refreshSec / 60)} นาที และเมื่อกลับมาเปิดแท็บนี้</li>
      <li>หน้าเว็บได้รับเฉพาะคอลัมน์ที่ใช้แสดงผล และไม่แสดง DNA profile</li></ol></section>
    <section class="card span-5"><div class="card-h"><div><h2>แม่แบบที่รองรับ</h2><p>ตรวจอัตโนมัติจากชื่อแท็บ</p></div></div><div class="two" style="grid-template-columns:1fr">
      <div><h4>${TPL.cases.short}</h4>แท็บ <code>ข้อมูลคดี</code> · หัวคอลัมน์: เลข บก. · เลขรายงาน · สภ. (ท้องที่) · จังหวัด · วันที่รับ · วันที่ตรวจเสร็จ · วันที่มารับผล · สถานะ · ประเภทคดี (เลือก) · ผู้ตรวจ (เลือก) · ของกลาง (ชิ้น) · นับในสถิติ · ข้อสังเกต (ผิดปกติ)</div>
      <div><h4>${TPL.lab.short}</h4>แท็บ <code>ข้อมูลเคส</code> · <code>ข้อมูลงบ</code> · <code>ข้อมูล Lot</code> (และ <code>หมายเหตุ</code> ถ้ามี)</div></div></section>
    <section class="card span-12"><div class="card-h"><div><h2>ดูจากไฟล์ Excel ในเครื่อง</h2><p>เลือกไฟล์ .xlsx หรือลากมาวางบนหน้านี้ เพื่อดูข้อมูลชั่วคราว ไฟล์ถูกอ่านในเบราว์เซอร์นี้เท่านั้น ไม่ถูกอัปโหลด</p></div></div><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn ghost" data-act="file">เลือกไฟล์ .xlsx</button></div></section>${info}</div>`;
}
function removeSource(id){
  const i = S.sources.findIndex(s => s.id === id); if (i < 0) return; const wasActive = id === S.active;
  S.sources.splice(i, 1); if (wasActive && S.sources.length) activate(S.sources[0].id); else render();
}
function fillSel(){
  const sel = $('#srcSel'); sel.innerHTML = S.sources.map(s => `<option value="${s.id}"${s.id === S.active ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  sel.hidden = !S.sources.length;
}
$('#srcSel').onchange = e => { const v = e.target.value; if (v !== S.active) activate(v); };

/* ---- ไฟล์ Excel (ทางเลือก) ---- */
function useFile(name, bytes){
  let s = S.sources.find(x => x.type === 'file');
  if (!s) { s = { id: 'file-' + uid(), type: 'file', tpl: 'auto' }; S.sources.push(s); }
  s.name = 'ไฟล์ · ' + name; s.fileName = name; s.bytes = bytes; S.active = s.id; return s;
}
async function fromFile(f){ if (!f) return; const s = useFile(f.name, await f.arrayBuffer()); clearTimeout(pollT); S.gen++; S.busy = false; S.sig = ''; await refresh(true); fillSel(); if (cur() === s && s.state !== 'lost') toast('โหลดไฟล์ ' + f.name + ' แล้ว'); }
$('#file').onchange = e => { fromFile(e.target.files[0]); e.target.value = ''; };
let dragN = 0;
addEventListener('dragenter', e => { e.preventDefault(); dragN++; $('#drop').hidden = false; });
addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; $('#drop').hidden = true; } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('#drop').hidden = true; const f = e.dataTransfer.files[0]; if (f && /\.xlsx$/i.test(f.name)) fromFile(f); else toast('รองรับเฉพาะไฟล์ .xlsx'); });

/* =========================================================
"""
s = cut(s, "   6) แหล่งข้อมูล: รายการ / เพิ่ม / เปลี่ยนชีต / ลบ", "   7) แสดงผลทั้งหน้า", SEC6)

# 4) ส่วนที่ 7: สถานะ, การ์ดข้อผิดพลาด, ปุ่ม, boot
s = rep(s, "s.type === 'sample' ? 'ข้อมูลตัวอย่าง (ยังไม่เชื่อม Google Sheet)' : `โหลดจากไฟล์ · ${when}`", "`โหลดจากไฟล์ · ${when}`")
s = rep(s, """${s && s.type === 'gsheet' ? '<button class="btn" data-act="edit" data-id="' + s.id + '">เปลี่ยน Google Sheet</button>' : ''}<button class="btn ghost" data-act="retry">ลองใหม่</button>""",
        """<button class="btn" data-act="retry">ลองใหม่</button>""")
s = rep(s, "  if (S.form) bindForm();\n", "")
s = rep(s, """  if (a === 'add') openForm(null);
  else if (a === 'edit') openForm(S.sources.find(s => s.id === id));
  else if (a === 'use') { activate(id); }
  else if (a === 'retry') activate(S.active);
  else if (a === 'file') $('#file').click();
  else if (a === 'watch') watchFile();
""", """  if (a === 'use') { activate(id); }
  else if (a === 'retry') { if (S.active) activate(S.active); else boot(); }
  else if (a === 'file') $('#file').click();
""")
s = cut(s, "(async function boot(){", "</script>", """async function boot(){
  S.view = (location.hash || '#overview').slice(1) || 'overview'; S.error = '';
  try { await seedSources(); }
  catch (e) { console.warn(e); S.error = e.message || String(e); render(); return; }
  if (!S.sources.length) { S.error = 'ผู้ดูแลยังไม่ได้ตั้งค่า Sheet ID (CASES_SHEET_ID / LAB_SHEET_ID) ใน Script Properties'; render(); return; }
  fillSel(); await activate(S.active);
}
boot();
""")

# ต้องไม่เหลือร่องรอยของโหมดเดิม
for bad in ("gviz", "sources.json", "samples/", "fetch(", "showOpenFilePicker", "openForm", "GS_BASE", "EMBED", "'gsheet'"):
    if bad in s:
        sys.exit(f"build_index: ยังเหลือ {bad!r}")

OUT.write_text(s, encoding="utf-8")
print(f"wrote {OUT.relative_to(ROOT)} ({len(s.encode('utf-8')):,} bytes)")
