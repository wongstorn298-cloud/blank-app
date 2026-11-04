#!/usr/bin/env python3
"""สร้าง apps-script/Index.html จาก dashboard/index.html (ต้นฉบับของเจ้าของ)

ทำไมต้องมีสคริปต์: ให้หน้าตา/กราฟ/ตัวอ่านข้อมูลของ Apps Script ตรงกับต้นฉบับเสมอ
ถ้าแก้ dashboard/index.html แล้ว ให้รัน `python3 apps-script/test/build_index.py` ใหม่
สคริปต์จะหยุดพร้อมข้อความ ถ้าข้อความที่ต้องแทนที่ในต้นฉบับเปลี่ยนไป

สิ่งที่เปลี่ยน:
  - ตัด gviz (fetch Google Sheet สาธารณะ), โหมดไฟล์ตัวอย่าง samples/*.xlsx, ?sheet=
  - เพิ่มตัวเชื่อม google.script.run (serverBook) ที่คืนข้อมูลรูปเดียวกับตัวอ่านเดิม
  - หน้า "แหล่งข้อมูล" คงแบบเดิม (รายการ + dropdown มุมขวาบน + ฟอร์มเพิ่ม/เปลี่ยนชีตในหน้า) แต่ปรับเป็น:
    ผู้ดูแลเพิ่ม/แก้/ลบ/ตั้งชีตหลักผ่านเซิร์ฟเวอร์ (adminInspectSource → adminSaveSource ...) ผู้ใช้ทั่วไปเลือกได้อย่างเดียว
  - เพิ่มหน้า "ผู้ใช้" (ผู้ดูแลเท่านั้น): เพิ่ม/ลบผู้ใช้ · ตั้ง/เลิก/แก้/ลบผู้ดูแลเฉพาะเจ้าของระบบ (Q44)
  - ผู้ดูแลที่ไม่ใช่เจ้าของ: เตือนให้แชร์ชีตให้เจ้าของก่อนตั้งชีตหลักและในฟอร์มเพิ่มชีต (Q45)
    เจ้าของเห็นแถบ "ชีตหลักถูกเปลี่ยนโดย …" เมื่อผู้ดูแลคนอื่นเปลี่ยนชีตหลัก (SR-5)
  - แม่แบบ lab: ชีตที่มีบางแท็บ (เช่น ชีต Lot พัสดุที่มีแค่ "ข้อมูล Lot") แสดงเฉพาะเมนูที่มีข้อมูล + ข้อความแจ้งแท็บที่ไม่มี
  - แท่งซ้อน (Lot / งบประมาณ) แสดงยอดรวมเหนือแท่ง
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

# 2b) แม่แบบ lab: ชีตที่มีบางแท็บ (เช่น ชีต Lot พัสดุที่มีแค่ "ข้อมูล Lot") แสดงเฉพาะเมนูที่มีข้อมูล
s = rep(s, "  if (await getRows(book, l.cases, 'ปีงบประมาณ')) return 'lab';",
        "  if (await getRows(book, l.cases, 'ปีงบประมาณ') || await getRows(book, l.budget, 'ปีงบประมาณ') || await getRows(book, l.lot, 'ลำดับ')) return 'lab';")
s = rep(s, "หรือตั้งชื่อแท็บเองในส่วนขั้นสูง');", "หรือ \"ข้อมูล Lot\" อย่างเดียว (ชีต Lot พัสดุ)');")
s = rep(s, """  if (!rc) throw new Error('ไม่พบแท็บ "' + tabs.cases + '" หรือหัวคอลัมน์ไม่ตรงแม่แบบ');
  if (!rb) throw new Error('ไม่พบแท็บ "' + tabs.budget + '" หรือหัวคอลัมน์ไม่ตรงแม่แบบ');
  if (!rl) throw new Error('ไม่พบแท็บ "' + tabs.lot + '" หรือหัวคอลัมน์ไม่ตรงแม่แบบ');
""", """  if (!rc && !rb && !rl) throw new Error('ไม่พบแท็บ "' + tabs.cases + '", "' + tabs.budget + '" หรือ "' + tabs.lot + '" ที่หัวคอลัมน์ตรงแม่แบบ');
""")
s = rep(s, "  for (const r of rc.slice(1)) {", "  for (const r of (rc || []).slice(1)) {")
s = rep(s, "  for (const r of rb.slice(1)) {", "  for (const r of (rb || []).slice(1)) {")
s = rep(s, "  const h = rl[0], col = p =>", "  const h = rl ? rl[0] : [], col = p =>")
i = s.index("  if ([cD, cN, cS].some(x => x < 0)) throw new Error("); j = s.index("\n", i)
s = s[:i] + """  const lotOk = !!rl && ![cD, cN, cS].some(x => x < 0);
  if (!rc && !rb && !lotOk) throw new Error('หัวคอลัมน์ในแท็บ "' + tabs.lot + '" ไม่ตรงแม่แบบ (ต้องมี วันที่ใช้คำนวณ / Lot No. / จำนวนตัวอย่าง)');""" + s[j:]
s = rep(s, "  for (const r of rl.slice(1)) {", "  for (const r of lotOk ? rl.slice(1) : []) {")
s = rep(s, "  return { kind: 'lab', cases, budget, brows, lots, years: [...years].sort((a, b) => a - b), notes };",
        """  const has = { cases: !!rc, budget: !!rb, lot: lotOk };
  const missing = [['cases', tabs.cases, 'ภาพรวม'], ['budget', tabs.budget, 'งบประมาณ'], ['lot', tabs.lot, 'Lot พัสดุ']].filter(x => !has[x[0]]).map(x => ({ tab: x[1], menu: x[2] }));
  return { kind: 'lab', cases, budget, brows, lots, years: [...years].sort((a, b) => a - b), notes, has, missing };""")

# 2b2) แท่งซ้อน (Lot พัสดุ / งบประมาณ) แสดงยอดรวมเหนือแท่ง ให้อ่านตัวเลขได้เมื่อพิมพ์เป็นภาพ
s = rep(s, "s += last ? `<path d=\"${topRound(x0, y1, bw, h, 4)}\" style=\"fill:${fill}${stroke}\"/>` : `<rect x=\"${x0}\" y=\"${y1}\" width=\"${bw}\" height=\"${h}\" style=\"fill:${fill}${stroke}\"/>`; acc += o.v; }",
        "s += last ? `<path d=\"${topRound(x0, y1, bw, h, 4)}\" style=\"fill:${fill}${stroke}\"/>` : `<rect x=\"${x0}\" y=\"${y1}\" width=\"${bw}\" height=\"${h}\" style=\"fill:${fill}${stroke}\"/>`; acc += o.v;\n        if (last) s += `<text class=\"vl\" x=\"${x0 + bw/2}\" y=\"${f.y(acc) - 5}\" text-anchor=\"middle\">${(c.vfmt || compact)(acc)}</text>`; }")

# 2c) ไอคอน + CSS ของหน้าผู้ใช้/ผลตรวจลิงก์ (ใช้ตัวแปรสีเดิม รองรับโหมดมืด)
s = rep(s, "  db: '<ellipse", """  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.7 3.3-6 6.5-6s5.9 2.3 6.5 6" stroke-linecap="round"/><path d="M15.5 4.7a3.5 3.5 0 010 6.6M17.5 14.4c2 .8 3.4 2.8 3.9 5.6" stroke-linecap="round"/>',
  db: '<ellipse""")
s = rep(s, ".badge.bad{background:var(--bad-bg);color:var(--bad)}\n", """.badge.bad{background:var(--bad-bg);color:var(--bad)}
.badge.main{background:var(--brand);color:var(--on-brand)}
""")
s = rep(s, ".f2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}\n", """.f2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.f3{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr);gap:12px}
.f input[readonly]{color:var(--muted);cursor:default}
.ck{display:flex;gap:8px;align-items:center;font-size:13px;margin-top:12px}.ck input{width:18px;height:18px;accent-color:var(--brand)}
.acts-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
.btn[disabled]:not([aria-busy="true"]){cursor:not-allowed}
.src p a,.steps a{color:var(--brand);font-weight:600;text-underline-offset:3px}
.src p.err{color:var(--bad)}
.chk{margin-top:12px}.chk td{vertical-align:top}
.chk-notes{margin:12px 0 0;padding-left:18px;font-size:12.5px;color:var(--ink-2);display:flex;flex-direction:column;gap:4px}
.muted{color:var(--muted)}
.gap{margin-bottom:14px}
.card-h .btn{white-space:nowrap;flex-shrink:0}
@media (max-width:760px){.f3{grid-template-columns:1fr}}
""")

# 3) แหล่งข้อมูล: เขียนส่วนที่ 6 ใหม่ (ผู้ดูแลเพิ่ม/แก้/ลบ/ตั้งชีตหลัก + หน้า ผู้ใช้)
SEC6 = r"""   6) แหล่งข้อมูล: Google Sheet (อ่านฝั่งเซิร์ฟเวอร์) · ผู้ดูแลเพิ่ม/แก้/ลบ/ตั้งชีตหลัก · ผู้ใช้ · ไฟล์ Excel ในเครื่อง
      การซ่อนปุ่มของผู้ดูแลเป็นแค่ความสะดวก เซิร์ฟเวอร์ตรวจสิทธิ์ทุกฟังก์ชันซ้ำเอง (Admin.gs)
   ========================================================= */
const S = { sources: [], active: null, M: null, tpl: null, fy: null, yr: 0, view: 'overview', lotQ: '', lotLimit: 25, pendF: 'all', pendLimit: 25, cm: 0, hideUn: false, drill: null,
  sig: '', prevKpi: {}, busy: false, gen: 0, error: '', email: '', refreshSec: 120,
  admin: false, isOwner: false, owner: '', mainChange: null, confirmMain: null, notice: '', form: null, people: null, perr: '', pform: null, pq: '' };
const cur = () => S.sources.find(s => s.id === S.active);
const uid = () => 's' + Math.random().toString(36).slice(2, 8);
const editing = () => (S.form && S.view === 'sources') || (S.pform && S.view === 'users');
const fmtAt = iso => { const d = new Date(iso); return iso && !isNaN(d) ? d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : ''; };
const fmtAtT = iso => { const d = new Date(iso); return iso && !isNaN(d) ? d.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' น.' : ''; };
/* Q45: ผู้ดูแลที่ไม่ใช่เจ้าของต้องแชร์ชีตให้เจ้าของระบบ (บอตอ่านชีตหลักในนามเจ้าของ) */
const ownerShareMsg = () => `ต้องแชร์ชีตนี้ให้บัญชีเจ้าของระบบ${S.owner ? ` (<b>${esc(S.owner)}</b>)` : ''} ไม่เช่นนั้นบอตจะอ่านไม่ได้`;
const withWarn = out => out.warning ? out.message + ' · ' + out.warning : out.message;
function persist(){ try { if (S.active && !S.active.startsWith('file-')) localStorage.setItem('dna-src-as', S.active); } catch (e) {} }
function applyInfo(info){
  S.email = info.email || ''; S.admin = !!info.isAdmin; S.isOwner = !!info.isOwner; S.owner = info.owner || ''; S.mainChange = info.mainChange || null; S.refreshSec = Math.max(30, +info.refreshSeconds || 120);
  if (info.notice) S.notice = info.notice;
  const old = new Map(S.sources.map(s => [s.id, s])), files = S.sources.filter(s => s.type === 'file');
  S.sources = (info.sources || []).map(x => { const id = 'srv-' + x.id, o = old.get(id), keep = o && o.rev === x.rev ? { state: o.state, err: o.err, at: o.at } : {};
    return { ...keep, id, type: 'server', key: x.id, name: x.name, tpl: x.kind, kindLabel: x.kindLabel || '', main: !!x.main, menus: x.menus || [],
      url: x.url || '', by: x.by || '', added: x.at || '', rev: x.rev }; }).concat(files);
  if (!S.admin) { S.form = null; S.pform = null; S.people = null; }
}
async function seedSources(){
  applyInfo(await RUN('getSources'));
  let saved = null; try { saved = localStorage.getItem('dna-src-as'); } catch (e) {}
  const def = S.sources.find(x => x.main) || S.sources[0];
  S.active = S.sources.some(x => x.id === saved) ? saved : def ? def.id : null;
}
/** หลังผู้ดูแลแก้รายการ: ใช้รายการใหม่ · แหล่งที่แสดงอยู่ถูกลบหรือเปลี่ยนลิงก์ = โหลดใหม่ */
function afterChange(state, msg){
  const before = cur(), rev = before && before.rev;
  applyInfo(state); fillSel(); if (msg) toast(msg, msg.includes('ต้องแชร์') ? 9000 : 4500);
  const now = cur();
  if (!now) { const d = S.sources.find(x => x.main) || S.sources[0]; if (d) return activate(d.id); S.active = null; S.M = null; S.tpl = null; return render(); }
  if (now.type === 'server' && now.rev !== rev) return activate(now.id);
  render();
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
    if (first || r.sig !== S.sig) { S.sig = r.sig; S.M = r.M; S.tpl = r.tpl; S.error = ''; if (first) resetView(r.tpl);
      if (!first && editing()) setStatus(); else { render(); if (!first) toast('อัปเดตข้อมูลจาก Google Sheet แล้ว', 2200); } }
    else setStatus();
  } catch (e) {
    if (gen !== S.gen) return; console.warn(e); s.state = 'lost'; s.err = e.message || String(e);
    if (first) { S.M = null; S.tpl = null; S.error = s.err; if (S.view !== 'sources' && S.view !== 'users') S.view = 'overview'; render(); } else setStatus();
  } finally { if (gen === S.gen) S.busy = false; }
}
function schedule(){ clearTimeout(pollT); const s = cur(); if (!s || s.type !== 'server') return;
  pollT = setTimeout(async () => { if (!document.hidden) await refresh(false); schedule(); }, S.refreshSec * 1000); }
document.addEventListener('visibilitychange', () => { const s = cur(); if (!document.hidden && s && s.type === 'server') refresh(false).then(schedule); });
/* เมนูของแม่แบบ lab ขึ้นกับแท็บที่มีจริง (ชีต Lot พัสดุ = เมนู Lot อย่างเดียว) */
const navOf = tpl => !tpl ? [] : TPL[tpl].nav.map(n => n[0]).filter(v => tpl !== 'lab' || !S.M || !S.M.has || S.M.has[v === 'overview' ? 'cases' : v]);
const homeView = () => navOf(S.tpl)[0] || 'sources';
function resetView(tpl){ S.fy = null; S.yr = 0; S.lotQ = ''; S.lotLimit = 25; S.pendLimit = 25; S.pendF = 'all'; S.cm = 0; S.drill = null; S.prevKpi = {}; if (!validViews(tpl).includes(S.view)) S.view = homeView(); }
async function activate(id){
  clearTimeout(pollT); S.gen++; S.busy = false; S.active = id; S.sig = ''; persist();
  const s = cur(); if (s) { s.state = 'busy'; s.err = ''; } S.M = null; S.tpl = null; S.error = ''; render();
  await refresh(true); schedule();
}
const validViews = tpl => ['sources', ...(S.admin ? ['users'] : []), ...navOf(tpl)];
function labGap(M){
  return `<div class="msg warn gap" role="note"><b>ชีตนี้มีข้อมูลไม่ครบทุกแท็บ</b> · ${M.missing.map(m => `ไม่มีแท็บ "${esc(m.tab)}" จึงไม่แสดงเมนู ${esc(m.menu)}`).join(' · ')}${S.admin ? ' · เพิ่มแท็บตามแม่แบบแล้วกด "แก้ไข" &gt; "ตรวจชีต" ในหน้าแหล่งข้อมูล' : ''}</div>`;
}

/* ---- หน้า แหล่งข้อมูล ---- */
function srcMeta(x){
  if (x.type === 'file') return 'ไฟล์ที่เลือกเอง (อยู่ในเครื่องนี้เท่านั้น ไม่ถูกส่งขึ้นเซิร์ฟเวอร์) · ' + esc(x.fileName || '');
  const menus = x.tpl === 'lab' && x.menus.length ? ' · เมนู: ' + x.menus.map(esc).join(' · ') : '';
  if (!S.admin) return 'Google Sheet (ส่วนตัว) อ่านผ่านเซิร์ฟเวอร์ Apps Script' + menus;
  const mc = x.main && S.mainChange ? ' · ตั้งเป็นชีตหลักโดย ' + esc(S.mainChange.by) + (S.mainChange.at ? ' ' + esc(fmtAtT(S.mainChange.at)) : '') : '';
  return `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">เปิดชีต</a>${menus}${x.by ? ' · แก้ล่าสุดโดย ' + esc(x.by) + (x.added ? ' ' + esc(fmtAt(x.added)) : '') : ''}${mc}`;
}
function viewSources(){
  const rows = S.sources.map(x => { const on = x.id === S.active, t = x.tpl && x.tpl !== 'auto' ? x.tpl : x.detected;
    const kl = x.kindLabel || (t ? TPL[t].short : '');
    const st = x.state === 'live' ? `<span class="badge ok">เชื่อมสด</span>` : x.state === 'lost' ? `<span class="badge bad">เชื่อมต่อไม่ได้</span>` : x.state === 'busy' ? '<span class="badge ok">กำลังโหลด…</span>' : '';
    const acts = [on ? '' : `<button class="btn sm" data-act="use" data-id="${esc(x.id)}">แสดง</button>`];
    if (S.admin && x.type === 'server') {
      if (x.tpl === 'cases' && !x.main && S.confirmMain !== x.id) acts.push(`<button class="btn sm ghost" data-act="${S.isOwner ? 'main' : 'main-ask'}" data-id="${esc(x.id)}">ตั้งเป็นชีตหลัก</button>`);
      acts.push(`<button class="btn sm ghost" data-act="edit" data-id="${esc(x.id)}">แก้ไข</button>`);
      if (!x.main) acts.push(`<button class="btn sm ghost danger" data-act="del" data-id="${esc(x.id)}">ลบ</button>`);
    }
    if (x.type === 'file') acts.push(`<button class="btn sm ghost danger" data-act="del" data-id="${esc(x.id)}">ลบ</button>`);
    return `<li class="src${on ? ' on' : ''}"><div><h3>${esc(x.name)} ${on ? '<span class="badge">กำลังแสดง</span>' : ''}${x.main ? '<span class="badge main" title="LINE bot และสรุปอัตโนมัติอ่านจากชีตนี้">ชีตหลัก</span>' : ''} ${kl ? `<span class="badge ok">${esc(kl)}</span>` : ''} ${st}</h3>
      <p>${srcMeta(x)}</p>${x.err ? `<p class="err">${esc(x.err)}</p>` : ''}${S.confirmMain === x.id ? mainAsk(x) : ''}</div><div class="acts">${acts.join('')}</div></li>`; }).join('');
  const empty = S.admin ? '<li class="src"><div><h3>ยังไม่มีแหล่งข้อมูล</h3><p>กด "เพิ่ม Google Sheet" แล้ววางลิงก์ชีตคดี ชีตคดีชีตแรกจะถูกตั้งเป็นชีตหลักให้อัตโนมัติ</p></div></li>'
    : '<li class="src"><div><h3>ยังไม่มีแหล่งข้อมูล</h3><p>โปรดแจ้งผู้ดูแล Dashboard ให้เพิ่ม Google Sheet</p></div></li>';
  const add = S.admin ? `<button class="btn" data-act="add"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 2v10M2 7h10"/></svg>เพิ่ม Google Sheet</button>` : '';
  const info = S.M && S.tpl === 'lab' && S.M.notes.length ? `<section class="card span-12"><div class="card-h"><div><h2>หมายเหตุ สมมติฐาน และข้อมูลที่ควรตรวจสอบ</h2><p>อ่านจากแท็บ "หมายเหตุ" ของแหล่งข้อมูลที่แสดงอยู่</p></div></div><ul class="notes">${S.M.notes.map(([a, b]) => b == null ? `<li class="h">${esc(a)}</li>` : `<li><b>${esc(a)}</b><span>${esc(b)}</span></li>`).join('')}</ul></section>` : '';
  const notice = (S.notice ? `<div class="msg ok span-12" role="status">${esc(S.notice)} <button class="btn sm ghost" data-act="notice-ok" style="margin-left:6px">รับทราบ</button></div>` : '') + mainChangedBanner();
  const steps = S.admin ? `
      <li><b>เพิ่มชีต</b> เปิด Google Sheet แล้วคัดลอกลิงก์จากแถบที่อยู่ของเบราว์เซอร์ กด "เพิ่ม Google Sheet" วางลิงก์ แล้วกด "ตรวจชีต" ระบบเปิดชีตด้วยบัญชีของคุณ ตรวจแท็บและหัวคอลัมน์ตามแม่แบบ ก่อนให้บันทึก</li>
      <li><b>ชีตหลัก</b> คือชีตคดีที่ LINE bot และสรุปรายเดือน/รายปีใช้ บอตอ่านชีตในนามเจ้าของระบบ${S.owner ? ` (<b>${esc(S.owner)}</b>)` : ''} เจ้าของจึงต้องเปิดชีตหลักได้</li>
      <li><b>แชร์ทุกชีตให้เจ้าของระบบ</b> ด้วย (อย่างน้อย "ผู้มีสิทธิ์อ่าน") ${S.isOwner ? 'ระบบตรวจแทนคุณไม่ได้เมื่อผู้ดูแลคนอื่นเพิ่มชีต · ตรวจได้โดยรัน <code>checkMainSheetAccess</code> ใน editor' : 'ระบบตรวจสิทธิ์ของเจ้าของแทนไม่ได้ ถ้าลืมแชร์ บอตจะตอบว่าอ่านข้อมูลไม่ได้'}</li>
      <li><b>แชร์ชีตทุกแหล่ง</b> ให้ผู้ใช้ทุกคนแบบ "ผู้มีสิทธิ์อ่าน" (ห้ามตั้ง "ทุกคนที่มีลิงก์") คนที่ไม่ได้รับแชร์จะเห็นข้อความแจ้งเฉพาะชีตนั้น รายชื่อผู้ใช้อยู่ในเมนู <a href="#users">ผู้ใช้</a></li>`
    : `<li><b>Google Sheet เป็นแบบส่วนตัว</b> เซิร์ฟเวอร์อ่านข้อมูลด้วยบัญชีของคุณ ต้องอยู่ในรายชื่อผู้ใช้และได้รับแชร์ชีตแบบ "ผู้มีสิทธิ์อ่าน"</li>
      <li><b>ต้องการชีตเพิ่ม หรือเปิดชีตไหนไม่ได้</b> แจ้งผู้ดูแล Dashboard พร้อมอีเมลของคุณ</li>`;
  return `<div class="grid">${notice}${S.form ? formCard() : ''}
    <section class="card span-12"><div class="card-h"><div><h2>แหล่งข้อมูล</h2><p>${S.admin ? 'เพิ่ม Google Sheet ด้วยลิงก์ · เลือกชุดข้อมูลที่จะแสดงได้ที่มุมขวาบน' : 'เลือกชุดข้อมูลที่จะแสดงได้ที่มุมขวาบน หรือกด "แสดง" · ผู้ดูแลเป็นผู้เพิ่มหรือเปลี่ยนแหล่งข้อมูล'}${S.email ? ` · เข้าสู่ระบบเป็น <b>${esc(S.email)}</b>${S.admin ? ' (ผู้ดูแล)' : ''}` : ''}</p></div>${add}</div><ul class="srcs">${rows || empty}</ul></section>
    <section class="card span-7"><div class="card-h"><div><h2>ข้อมูลมาจากไหน</h2></div></div><ol class="steps">${steps}
      <li>แก้ข้อมูลในชีตตามปกติ หน้านี้จะดึงข้อมูลใหม่ทุก ${Math.round(S.refreshSec / 60)} นาที และเมื่อกลับมาเปิดแท็บนี้</li>
      <li>หน้าเว็บได้รับเฉพาะคอลัมน์ที่ใช้แสดงผล และไม่แสดง DNA profile</li></ol></section>
    <section class="card span-5"><div class="card-h"><div><h2>แม่แบบที่รองรับ</h2><p>ตรวจจากชื่อแท็บและหัวคอลัมน์ (แท็บอื่น เช่น คำอธิบาย ระบบไม่อ่าน)</p></div></div><div class="two" style="grid-template-columns:1fr">
      <div><h4>${TPL.cases.short}</h4>แท็บ <code>ข้อมูลคดี</code> · หัวคอลัมน์: เลข บก. (คอลัมน์ A) · สภ. (ท้องที่) · จังหวัด · วันที่รับ · สถานะ · ของกลาง (ชิ้น) · และควรมี เลขรายงาน · วันที่ตรวจเสร็จ · วันที่มารับผล · ประเภทคดี (เลือก) · ผู้ตรวจ (เลือก) · นับในสถิติ</div>
      <div><h4>${TPL.lab.short}</h4>แท็บ <code>ข้อมูลเคส</code> · <code>ข้อมูลงบ</code> · <code>ข้อมูล Lot</code> (และ <code>หมายเหตุ</code> ถ้ามี) มีไม่ครบก็ได้ ระบบแสดงเฉพาะเมนูของแท็บที่มี</div>
      <div><h4>Lot พัสดุ (ชีตแยก)</h4>แท็บ <code>ข้อมูล Lot</code> อย่างเดียว (และ <code>หมายเหตุ</code> ถ้ามี) แสดงเมนู Lot พัสดุ</div></div></section>
    <section class="card span-12"><div class="card-h"><div><h2>ดูจากไฟล์ Excel ในเครื่อง</h2><p>เลือกไฟล์ .xlsx หรือลากมาวางบนหน้านี้ เพื่อดูข้อมูลชั่วคราว ไฟล์ถูกอ่านในเบราว์เซอร์นี้เท่านั้น ไม่ถูกอัปโหลด</p></div></div><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn ghost" data-act="file">เลือกไฟล์ .xlsx</button></div></section>${info}</div>`;
}

/* ชีตหลักถูกเปลี่ยนโดยผู้ดูแลคนอื่น: แจ้งเจ้าของจนกว่าจะกดรับทราบ (จำในเบราว์เซอร์นี้ ต่อการเปลี่ยนแต่ละครั้ง) */
function mainChangedBanner(){
  const c = S.mainChange; if (!S.isOwner || !c || !c.by || c.by === S.email) return '';
  let ack = ''; try { ack = localStorage.getItem('dna-main-ack') || ''; } catch (e) {}
  if (ack === c.by + '|' + c.at) return '';
  return `<div class="msg warn span-12" role="status"><b>ชีตหลักถูกเปลี่ยนโดย ${esc(c.by)} เมื่อ ${esc(fmtAtT(c.at))}</b> · ตรวจว่าเป็นชีตที่ถูกต้อง และบัญชีของคุณเปิดชีตนี้ได้ (LINE bot อ่านในนามบัญชีคุณ) โดยรัน <code>checkMainSheetAccess</code> ใน editor <button class="btn sm ghost" data-act="main-ack" style="margin-left:6px">รับทราบ</button></div>`;
}
/* ผู้ดูแลที่ไม่ใช่เจ้าของกด "ตั้งเป็นชีตหลัก": เตือนเรื่องแชร์ให้เจ้าของก่อนยืนยัน */
function mainAsk(x){
  return `<div class="msg warn" role="alert" style="margin-top:10px"><b>${ownerShareMsg()}</b><br>ระบบตรวจสิทธิ์ของเจ้าของแทนคุณไม่ได้ ตรวจในปุ่ม แชร์ ของชีตว่ามีอีเมลนี้แล้ว
    <div class="acts-row" style="margin-top:10px"><button class="btn sm" data-act="main" data-id="${esc(x.id)}">แชร์แล้ว ตั้งเป็นชีตหลัก</button><button class="btn sm ghost" data-act="main-cancel">ยกเลิก</button></div></div>`;
}

/* ---- ฟอร์มเพิ่ม/แก้แหล่งข้อมูล (ผู้ดูแล): แสดงในหน้า ไม่ใช้หน้าต่างป๊อปอัป · ตรวจชีตก่อนบันทึกเสมอ ---- */
function openForm(src){
  if (!S.admin) return;
  S.form = { src: src || null, link: '', name: src ? src.name : '', result: null, checked: '' };
  if (S.view !== 'sources') location.hash = '#sources'; else render();
  setTimeout(() => { const u = $('#mUrl'); if (u) { u.focus(); u.scrollIntoView({ block: 'center' }); } }, 60);
}
const canSave = f => (f.src && !f.link) || !!(f.result && f.result.ok && f.checked === f.link);
function inspectHtml(r){
  const head = r.ok ? `<b>ใช้ได้</b> · พบชีตแบบ "${esc(r.kindLabel)}"${r.menus.length ? ' · เมนูที่จะแสดง: ' + r.menus.map(esc).join(' · ') : ''}`
    : r.reason === 'no-access' ? '<b>เปิดชีตนี้ไม่ได้</b>' : r.reason === 'incomplete' ? `<b>ยังใช้ไม่ได้</b> · หัวคอลัมน์ไม่ครบตามแม่แบบ "${esc(r.kindLabel)}"` : '<b>ใช้ไม่ได้</b> · ไม่ตรงแม่แบบที่รองรับ';
  const ST = { ok: '<span class="badge ok">ครบ</span>', 'missing-headers': '<span class="badge bad">ขาดคอลัมน์</span>', 'missing-tab': '<span class="badge">ไม่มีแท็บ</span>' };
  const tbl = r.tabs.length ? `<div class="scroll"><table class="chk"><thead><tr><th class="l">แท็บ</th><th>แถวข้อมูล</th><th class="l">ผลตรวจ</th></tr></thead><tbody>${r.tabs.map(t =>
    `<tr><td class="l">${esc(t.name)}</td><td>${t.status === 'missing-tab' ? '—' : n0(t.rows)}</td><td class="l w">${ST[t.status] || ''}${t.missing.length ? ' ' + t.missing.map(esc).join(', ') : ''}${t.optional && t.optional.length ? ` <span class="muted">ไม่มี (ไม่บังคับ): ${t.optional.map(esc).join(', ')}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '';
  const list = [...(r.problems || []), ...(r.notes || [])];
  return `<div class="msg ${r.ok ? 'ok' : 'err'}" style="margin-top:14px">${head}</div>${tbl}${list.length ? `<ul class="chk-notes">${list.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
}
function formCard(){
  const f = S.form, src = f.src, edit = !!src;
  return `<section class="card span-12" id="formCard" aria-labelledby="mTitle"><div class="card-h"><div><h2 id="mTitle">${edit ? 'แก้ไข "' + esc(src.name) + '"' : 'เพิ่ม Google Sheet'}</h2><p>${edit ? 'เปลี่ยนชื่อที่แสดง หรือวางลิงก์ชีตใหม่เพื่อใช้แทนชีตเดิม (เว้นลิงก์ว่าง = ใช้ชีตเดิม)' : 'วางลิงก์ แล้วกด "ตรวจชีต" ระบบเปิดชีตด้วยบัญชีของคุณ ตรวจแท็บและหัวคอลัมน์ตามแม่แบบ ผลตรวจแสดงเฉพาะชื่อแท็บ จำนวนแถว และคอลัมน์ที่ขาด'}</p></div></div>
    <div class="f2"><div class="f"><label for="mUrl">ลิงก์ Google Sheet${edit ? ' (ใหม่)' : ''}</label><input id="mUrl" inputmode="url" autocomplete="off" spellcheck="false" value="${esc(f.link)}" placeholder="https://docs.google.com/spreadsheets/d/…/edit"><small>${edit ? `ชีตปัจจุบัน: <a href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">เปิดชีต</a>` : 'คัดลอกจากแถบที่อยู่ของเบราว์เซอร์ขณะเปิดชีต · ไม่ต้องตั้ง "ทุกคนที่มีลิงก์"'}</small></div>
    <div class="f"><label for="mName">ชื่อที่แสดง</label><input id="mName" maxlength="60" autocomplete="off" value="${esc(f.name)}" placeholder="เช่น คดีส่งตรวจ DNA ปี 2569"><small>เว้นว่าง = ตั้งชื่อตามชนิดชีต</small></div></div>
    ${S.isOwner ? '' : `<div class="msg warn" role="note" style="margin-top:14px">${ownerShareMsg()} · ทุกชีตในระบบต้องแชร์ให้เจ้าของ (อย่างน้อย "ผู้มีสิทธิ์อ่าน")</div>`}
    <div id="mRes" aria-live="polite">${f.result ? inspectHtml(f.result) : ''}</div>
    <div id="mMsg" class="msg err" role="alert" style="margin-top:14px" hidden></div>
    <div class="acts-row"><button class="btn ghost" id="mCheck">ตรวจชีต</button><button class="btn" id="mSave"${canSave(f) ? '' : ' disabled'}>บันทึก</button><button class="btn ghost" id="mCancel">ยกเลิก</button></div></section>`;
}
function busyBtn(b, on, label){ if (!b) return; if (on) { b.dataset.t = b.textContent; b.textContent = label; b.disabled = true; b.setAttribute('aria-busy', 'true'); } else { b.textContent = b.dataset.t || b.textContent; b.disabled = false; b.removeAttribute('aria-busy'); } }
function bindForm(){
  const f = S.form, url = $('#mUrl'), name = $('#mName'), save = $('#mSave'), chk = $('#mCheck'), msg = $('#mMsg');
  const sync = () => { f.link = url.value.trim(); f.name = name.value; save.disabled = !canSave(f); };
  const err = t => { msg.textContent = t; msg.hidden = false; };
  url.oninput = sync; name.oninput = sync;
  url.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); chk.click(); } };
  const close = () => { S.form = null; render(); };
  $('#mCancel').onclick = close; $('#formCard').onkeydown = e => { if (e.key === 'Escape') close(); };
  chk.onclick = async () => {
    sync(); msg.hidden = true; if (!f.link) { err('กรุณาวางลิงก์ Google Sheet'); url.focus(); return; }
    busyBtn(chk, true, 'กำลังตรวจชีต…'); $('#mRes').innerHTML = '';
    try { const r = await RUN('adminInspectSource', f.link); f.result = r; f.checked = f.link; $('#mRes').innerHTML = inspectHtml(r); }
    catch (e) { f.result = null; err(e.message); }
    finally { busyBtn(chk, false); sync(); }
  };
  save.onclick = async () => {
    sync(); if (!canSave(f)) return; msg.hidden = true; busyBtn(save, true, 'กำลังบันทึก…');
    try { const out = await RUN('adminSaveSource', { id: f.src ? f.src.key : '', link: f.link, name: f.name.trim() }); S.form = null; afterChange(out.state, withWarn(out)); }
    catch (e) { busyBtn(save, false); err(e.message); sync(); }
  };
}
async function adminAct(fn, arg, btn){
  if (btn) btn.disabled = true;
  try { const out = await RUN(fn, arg); S.confirmMain = null; afterChange(out.state, withWarn(out)); }
  catch (e) { toast(e.message, 6500); if (btn) btn.disabled = false; }
}
function removeSource(id, btn){
  const s = S.sources.find(x => x.id === id); if (!s) return;
  if (s.type === 'server') return adminAct('adminRemoveSource', s.key, btn);
  const wasActive = id === S.active; S.sources.splice(S.sources.indexOf(s), 1);
  if (wasActive && S.sources.length) activate((S.sources.find(x => x.main) || S.sources[0]).id); else render();
}
function fillSel(){
  const sel = $('#srcSel'); sel.innerHTML = S.sources.map(s => `<option value="${esc(s.id)}"${s.id === S.active ? ' selected' : ''}>${esc(s.name)}${s.main ? ' (ชีตหลัก)' : ''}</option>`).join('') + (S.admin ? '<option value="__add">เพิ่ม Google Sheet…</option>' : '');
  sel.hidden = !S.sources.length && !S.admin;
}
$('#srcSel').onchange = e => { const v = e.target.value; if (v === '__add') { fillSel(); openForm(null); } else if (v !== S.active) activate(v); };

/* ---- หน้า ผู้ใช้ (ผู้ดูแลเท่านั้น) ---- */
async function loadPeople(){
  if (loadPeople.p) return; loadPeople.p = true;
  try { S.people = await RUN('adminGetPeople'); S.perr = ''; } catch (e) { S.perr = e.message || String(e); }
  finally { loadPeople.p = false; } if (S.view === 'users') render();
}
/* Q44: ตั้ง/ถอด/แก้/ลบผู้ดูแล เฉพาะเจ้าของระบบ · ผู้ดูแลอื่นไม่เห็นปุ่มเหล่านี้ (เซิร์ฟเวอร์ตรวจซ้ำเสมอ) */
function personRow(p, P){
  const me = p.email === P.me, q = (p.name + ' ' + p.email + ' ' + p.note).toLowerCase(), own = !!P.isOwner;
  const meta = [p.name ? esc(p.email) : '', p.note ? esc(p.note) : '', p.by ? 'แก้ล่าสุดโดย ' + esc(p.by) + ' ' + esc(fmtAt(p.at)) : ''].filter(Boolean).join(' · ');
  return `<li class="src" data-q="${esc(q)}"><div><h3>${esc(p.name || p.email)} ${p.admin ? '<span class="badge ok">ผู้ดูแล</span>' : ''}${me ? '<span class="badge">คุณ</span>' : ''}</h3>${meta ? `<p>${meta}</p>` : ''}</div>
    <div class="acts">${!own && p.admin ? '<span class="muted" style="font-size:13px">จัดการได้เฉพาะเจ้าของระบบ</span>'
      : `${own ? `<button class="btn sm ghost" data-act="${p.admin ? 'unadmin' : 'mkadmin'}" data-id="${esc(p.email)}">${p.admin ? 'เลิกเป็นผู้ดูแล' : 'ตั้งเป็นผู้ดูแล'}</button>` : ''}<button class="btn sm ghost" data-act="pedit" data-id="${esc(p.email)}">แก้ไข</button><button class="btn sm ghost danger" data-act="pdel" data-id="${esc(p.email)}"${me ? ' data-self="1"' : ''}>ลบ</button>`}</div></li>`;
}
function viewUsers(){
  if (!S.people && !S.perr) { loadPeople(); return '<div class="card empty">กำลังโหลดรายชื่อ…</div>'; }
  if (S.perr) return `<div class="card"><div class="msg err"><b>โหลดรายชื่อไม่ได้</b><br>${esc(S.perr)}</div><div class="acts-row"><button class="btn" data-act="people-retry">ลองใหม่</button></div></div>`;
  const P = S.people, nAdm = P.people.filter(p => p.admin).length + (P.owner ? 1 : 0);
  const owner = P.owner ? `<li class="src"><div><h3>${esc(P.owner)} <span class="badge main">เจ้าของ</span><span class="badge ok">ผู้ดูแล</span>${P.owner === P.me ? '<span class="badge">คุณ</span>' : ''}</h3><p>เจ้าของระบบ (ADMIN_EMAIL) เป็นผู้ดูแลเสมอ ลบหรือลดสิทธิ์ในหน้านี้ไม่ได้ และเป็นคนเดียวที่ตั้งหรือถอดผู้ดูแลได้</p></div><div class="acts"></div></li>`
    : '<li class="src"><div><p class="err">ยังไม่ได้ตั้ง ADMIN_EMAIL (อีเมลเจ้าของ) ใน Script Properties</p></div></li>';
  const search = P.people.length > 8 ? `<input class="search" id="pQ" type="search" placeholder="ค้นหาชื่อ / อีเมล" value="${esc(S.pq)}" aria-label="ค้นหาผู้ใช้">` : '';
  const shares = P.sources.length ? P.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a></li>`).join('') : '<li>ยังไม่มีแหล่งข้อมูล</li>';
  return `<div class="grid">${S.pform ? personForm() : ''}
    <section class="card span-12"><div class="card-h"><div><h2>ผู้ใช้และผู้ดูแล</h2><p>${n0(P.people.length + (P.owner ? 1 : 0))} คนเปิด Dashboard ได้ · ผู้ดูแล ${n0(nAdm)} คน (รวมเจ้าของ) จัดการแหล่งข้อมูลและผู้ใช้ทั่วไปได้${P.isOwner ? '' : ' · ตั้งหรือถอดผู้ดูแลได้เฉพาะเจ้าของระบบ'}</p></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">${search}<button class="btn" data-act="padd"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 2v10M2 7h10"/></svg>เพิ่มผู้ใช้</button></div></div>
      <ul class="srcs" id="pList">${owner}${P.people.map(p => personRow(p, P)).join('')}</ul>${P.people.length ? '' : '<p class="muted" style="font-size:13px">ยังไม่มีผู้ใช้อื่น · กด "เพิ่มผู้ใช้" แล้วใส่อีเมลบัญชี Google</p>'}</section>
    <section class="card span-7"><div class="card-h"><div><h2>หลังเพิ่มผู้ใช้ ต้องแชร์ชีตด้วย</h2><p>Google ตรวจสิทธิ์อ่านชีตอีกชั้น คนที่ไม่ได้รับแชร์จะเปิดชีตนั้นไม่ได้</p></div></div><ol class="steps">
      <li>เปิดชีตแต่ละแหล่งจากรายการด้านล่าง กดปุ่ม <b>แชร์</b> มุมขวาบน</li>
      <li>ใส่อีเมลของผู้ใช้ เลือกสิทธิ์ <b>ผู้มีสิทธิ์อ่าน (Viewer)</b> แล้วกดส่ง · ห้ามตั้ง "ทุกคนที่มีลิงก์"</li>
      <li>ส่งลิงก์ Dashboard ให้ และบอกว่าครั้งแรกจะมีหน้าขออนุญาตของ Google ให้กด "ขั้นสูง" แล้ว "ไปที่ … (ไม่ปลอดภัย)"</li>
      <li>เมื่อลบผู้ใช้ ให้นำอีเมลออกจากการแชร์ของทุกชีตด้วย</li></ol><ul class="steps" style="list-style:disc">${shares}</ul></section>
    <section class="card span-5"><div class="card-h"><div><h2>ผู้ดูแลทำอะไรได้</h2></div></div><ul class="hl">
      <li><span>เพิ่ม แก้ไข ลบแหล่งข้อมูล และตั้งชีตหลัก</span><b>ผู้ดูแล</b></li>
      <li><span>เพิ่ม แก้ไข ลบผู้ใช้ทั่วไป</span><b>ผู้ดูแล</b></li>
      <li><span>ตั้ง เลิก แก้ไข ลบผู้ดูแล</span><b>เจ้าของระบบ</b></li>
      <li><span>ดูทุกแหล่งข้อมูลที่ได้รับแชร์</span><b>ทุกคน</b></li>
      <li><span>ต้องมีผู้ดูแลอย่างน้อย 1 คน · เจ้าของลบไม่ได้</span><b>ระบบกันไว้</b></li></ul></section></div>`;
}
function personForm(){
  const f = S.pform, edit = !!f.edit;
  return `<section class="card span-12" id="pCard" aria-labelledby="pTitle"><div class="card-h"><div><h2 id="pTitle">${edit ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้'}</h2><p>ใช้อีเมลบัญชี Google ที่คนนั้นใช้เปิด Dashboard (Gmail หรืออีเมลหน่วยงานที่เป็น Google Workspace)</p></div></div>
    <div class="f3"><div class="f"><label for="pEmail">อีเมล</label><input id="pEmail" type="email" inputmode="email" autocomplete="off" spellcheck="false" maxlength="254" value="${esc(f.email)}"${edit ? ' readonly' : ''} placeholder="name@gmail.com"></div>
    <div class="f"><label for="pName">ชื่อ</label><input id="pName" maxlength="60" autocomplete="off" value="${esc(f.name)}" placeholder="เช่น เจ้าหน้าที่ ก"></div>
    <div class="f"><label for="pNote">หมายเหตุ</label><input id="pNote" maxlength="100" autocomplete="off" value="${esc(f.note)}" placeholder="เช่น ตำแหน่ง / หน่วย"></div></div>
    ${S.people && S.people.isOwner ? `<label class="ck"><input type="checkbox" id="pAdm"${f.admin ? ' checked' : ''}> เป็นผู้ดูแล (จัดการแหล่งข้อมูลและผู้ใช้ทั่วไปได้)</label>` : '<p class="muted" style="font-size:13px;margin:12px 0 0">เพิ่มเป็นผู้ใช้ทั่วไป · ถ้าต้องการให้เป็นผู้ดูแล แจ้งเจ้าของระบบ</p>'}
    <div id="pMsg" class="msg err" role="alert" style="margin-top:14px" hidden></div>
    <div class="acts-row"><button class="btn" id="pSave">บันทึก</button><button class="btn ghost" id="pCancel">ยกเลิก</button></div></section>`;
}
function openPForm(email){
  const p = email && S.people && S.people.people.find(x => x.email === email);
  S.pform = p ? { edit: true, email: p.email, name: p.name, note: p.note, admin: p.admin } : { edit: false, email: '', name: '', note: '', admin: false };
  render(); setTimeout(() => { const i = $(p ? '#pName' : '#pEmail'); if (i) { i.focus(); i.scrollIntoView({ block: 'center' }); } }, 60);
}
function bindPForm(){
  const f = S.pform, msg = $('#pMsg'), save = $('#pSave');
  const adm = $('#pAdm');
  const read = () => { f.email = $('#pEmail').value.trim(); f.name = $('#pName').value; f.note = $('#pNote').value; if (adm) f.admin = adm.checked; };
  ['#pEmail', '#pName', '#pNote'].forEach(k => { $(k).oninput = read; $(k).onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); save.click(); } }; });
  if (adm) adm.onchange = read;
  const close = () => { S.pform = null; render(); };
  $('#pCancel').onclick = close; $('#pCard').onkeydown = e => { if (e.key === 'Escape') close(); };
  save.onclick = async () => {
    read(); msg.hidden = true;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) { msg.textContent = 'อีเมลไม่ถูกต้อง · ตัวอย่าง: name@gmail.com'; msg.hidden = false; $('#pEmail').focus(); return; }
    busyBtn(save, true, 'กำลังบันทึก…');
    const body = { email: f.email, name: f.name, note: f.note, edit: f.edit }; if (adm) body.admin = f.admin;
    try { const out = await RUN('adminSaveUser', body); S.pform = null; peopleDone(out); }
    catch (e) { busyBtn(save, false); msg.textContent = e.message; msg.hidden = false; }
  };
}
async function peopleDone(out){
  toast(out.message, 4500);
  if (out.self) { try { afterChange(await RUN('getSources')); } catch (e) { S.error = e.message; S.sources = []; S.M = null; } location.hash = '#sources'; return; }
  S.people = out.people; render();
}
async function personAct(fn, args, btn){
  if (btn) btn.disabled = true;
  try { peopleDone(await RUN(fn, ...args)); } catch (e) { toast(e.message, 6500); if (btn) btn.disabled = false; }
}
function bindPeople(){
  const q = $('#pQ'); if (!q) return;
  const apply = () => { const t = S.pq.trim().toLowerCase(); document.querySelectorAll('#pList li[data-q]').forEach(li => { li.hidden = !!t && !li.dataset.q.includes(t); }); };
  q.oninput = () => { S.pq = q.value; apply(); }; apply();
}

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

# 4) ส่วนที่ 7: สถานะ, การ์ดข้อผิดพลาด, เมนู, ปุ่ม, boot
s = rep(s, "s.type === 'sample' ? 'ข้อมูลตัวอย่าง (ยังไม่เชื่อม Google Sheet)' : `โหลดจากไฟล์ · ${when}`", "`โหลดจากไฟล์ · ${when}`")
s = rep(s, """${s && s.type === 'gsheet' ? '<button class="btn" data-act="edit" data-id="' + s.id + '">เปลี่ยน Google Sheet</button>' : ''}<button class="btn ghost" data-act="retry">ลองใหม่</button>""",
        """<button class="btn" data-act="retry">ลองใหม่</button>""")
s = rep(s, "  $('#nav').innerHTML = (T ? T.nav.map(", "  $('#nav').innerHTML = (T ? T.nav.filter(n => navOf(S.tpl).includes(n[0])).map(")
s = rep(s, """${ICONS.db}</svg>แหล่งข้อมูล</a>`;""", """${ICONS.db}</svg>แหล่งข้อมูล</a>` +
    (S.admin ? `<a href="#users" data-v="users"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${ICONS.users}</svg>ผู้ใช้</a>` : '');""")
s = rep(s, "const showChips = S.M && S.view !== 'sources',", "const showChips = S.M && S.view !== 'sources' && S.view !== 'users',")
s = rep(s, "  if (S.tpl && !validViews(S.tpl).includes(S.view)) S.view = 'overview';", "  if (S.tpl && !validViews(S.tpl).includes(S.view)) S.view = homeView();")
s = rep(s, "  if (S.view === 'sources') html = viewSources();", "  if (S.view === 'sources') html = viewSources();\n  else if (S.view === 'users' && S.admin) html = viewUsers();")
s = rep(s, "  $('#view').innerHTML = html; mountCharts();", """  if (S.M && S.tpl === 'lab' && S.view !== 'sources' && S.view !== 'users' && S.M.missing && S.M.missing.length) html = labGap(S.M) + html;
  $('#view').innerHTML = html; mountCharts();""")
s = rep(s, "  if (S.form) bindForm();\n", "  if (S.form && S.view === 'sources') bindForm();\n  if (S.view === 'users' && S.admin) { if (S.pform) bindPForm(); bindPeople(); }\n")
s = rep(s, """  if (a === 'add') openForm(null);
  else if (a === 'edit') openForm(S.sources.find(s => s.id === id));
  else if (a === 'use') { activate(id); }
  else if (a === 'retry') activate(S.active);
  else if (a === 'file') $('#file').click();
  else if (a === 'watch') watchFile();
""", """  if (a === 'add') openForm(null);
  else if (a === 'edit') openForm(S.sources.find(s => s.id === id));
  else if (a === 'main') adminAct('adminSetMain', (S.sources.find(s => s.id === id) || {}).key, b);
  else if (a === 'main-ask') { S.confirmMain = id; render(); const c = document.querySelector('[data-act="main-cancel"]'); if (c) c.closest('.msg').scrollIntoView({ block: 'nearest' }); }
  else if (a === 'main-cancel') { S.confirmMain = null; render(); }
  else if (a === 'main-ack') { const c = S.mainChange; try { if (c) localStorage.setItem('dna-main-ack', c.by + '|' + c.at); } catch (e) {} render(); }
  else if (a === 'use') { activate(id); }
  else if (a === 'retry') { if (S.active) activate(S.active); else boot(); }
  else if (a === 'file') $('#file').click();
  else if (a === 'notice-ok') { S.notice = ''; render(); }
  else if (a === 'padd') openPForm(null);
  else if (a === 'pedit') openPForm(id);
  else if (a === 'mkadmin' || a === 'unadmin') personAct('adminSetAdmin', [id, a === 'mkadmin'], b);
  else if (a === 'people-retry') { S.perr = ''; S.people = null; render(); }
  else if (a === 'pdel') { if (b.dataset.arm) personAct('adminRemoveUser', [id], b); else { b.dataset.arm = '1'; b.textContent = b.dataset.self ? 'ยืนยันลบตัวเอง?' : 'ยืนยันลบ?'; setTimeout(() => { b.textContent = 'ลบ'; delete b.dataset.arm; }, 3000); } }
""")
s = rep(s, "if (b.dataset.arm) removeSource(id); else", "if (b.dataset.arm) removeSource(id, b); else")
s = rep(s, "if (!validViews(S.tpl).includes(S.view) && S.M) S.view = 'overview';", "if (!validViews(S.tpl).includes(S.view) && S.M) S.view = homeView();")
s = cut(s, "(async function boot(){", "</script>", """async function boot(){
  S.view = (location.hash || '#overview').slice(1) || 'overview'; S.error = '';
  try { await seedSources(); }
  catch (e) { console.warn(e); S.error = e.message || String(e); S.sources = []; render(); return; }
  fillSel();
  if (!S.sources.length) {
    if (S.admin) { if (S.view !== 'users') S.view = 'sources'; render(); if (S.view === 'sources' && !S.notice) openForm(null); return; }
    S.error = 'ยังไม่มีแหล่งข้อมูล · โปรดแจ้งผู้ดูแล Dashboard ให้เพิ่ม Google Sheet'; render(); return;
  }
  await activate(S.active);
}
boot();
""")

# ต้องไม่เหลือร่องรอยของโหมดเดิม
for bad in ("gviz", "sources.json", "samples/", "fetch(", "showOpenFilePicker", "GS_BASE", "EMBED", "'gsheet'", "watchFile"):
    if bad in s:
        sys.exit(f"build_index: ยังเหลือ {bad!r}")

OUT.write_text(s, encoding="utf-8")
print(f"wrote {OUT.relative_to(ROOT)} ({len(s.encode('utf-8')):,} bytes)")
