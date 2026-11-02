"""ZipForge AI — บริษัท AI ที่เปลี่ยนไฟล์ ZIP ของคุณให้เป็นเว็บแอป"""

from __future__ import annotations

import base64
import hashlib
import io
import os
import time
import zipfile

import streamlit as st

from zipforge.analyze import analyze
from zipforge.builders import build_auto, package_site
from zipforge.extract import ZipError, load_zip

st.set_page_config(page_title="ZipForge AI", page_icon="🏭", layout="wide")

TEAM = [
    ("🕵️", "Analyst", "แตกไฟล์ ZIP และวิเคราะห์ชนิดโปรเจกต์"),
    ("📐", "Architect", "วางแผนโครงสร้างเว็บแอปที่เหมาะสม"),
    ("👩‍💻", "Developer", "เขียน/ประกอบโค้ดเว็บแอป"),
    ("✅", "QA", "ตรวจสอบผลลัพธ์และเตรียมไฟล์พร้อมใช้งาน"),
]


def get_api_key() -> str:
    try:
        key = st.secrets.get("ANTHROPIC_API_KEY", "")
    except Exception:  # noqa: BLE001 - no secrets.toml configured
        key = ""
    return key or os.environ.get("ANTHROPIC_API_KEY", "")


def sample_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("my-shop/sales.csv",
                    "month,product,units,revenue\n"
                    "Jan,กาแฟ,120,6000\nJan,ชาเขียว,80,3200\nFeb,กาแฟ,150,7500\nFeb,ชาเขียว,95,3800\n"
                    "Mar,กาแฟ,170,8500\nMar,ชาเขียว,110,4400\nApr,กาแฟ,160,8000\nApr,ชาเขียว,130,5200\n")
        zf.writestr("my-shop/README.md", "# ร้านกาแฟของฉัน\n\nยอดขายรายเดือนของร้าน\n")
    return buf.getvalue()


# ----------------------------------------------------------------------------- sidebar
with st.sidebar:
    st.markdown("## 🏭 ZipForge AI")
    st.caption("บริษัท AI ที่เปลี่ยนไฟล์ ZIP ให้เป็นเว็บแอป")
    st.markdown("### 👥 ทีมงาน AI ของเรา")
    for icon, role, desc in TEAM:
        st.markdown(f"{icon} **{role}** — {desc}")

    st.divider()
    st.markdown("### 🔑 AI Engine (Claude)")
    key = get_api_key()
    if key:
        st.success("เชื่อมต่อ API key แล้ว")
    else:
        key = st.text_input("Anthropic API key", type="password",
                            help="ใช้สำหรับโหมด AI เท่านั้น — โหมดอัตโนมัติใช้ได้ฟรีโดยไม่ต้องมี key")
    effort = st.select_slider("ความละเอียดของ AI", options=["low", "medium", "high", "xhigh"], value="high",
                              help="สูง = คุณภาพดีขึ้นแต่ใช้เวลาและค่าใช้จ่ายมากขึ้น")
    st.divider()
    st.download_button("📦 ดาวน์โหลด ZIP ตัวอย่าง", sample_zip(), "sample-shop.zip", "application/zip",
                       width="stretch")

# ----------------------------------------------------------------------------- hero
st.title("🏭 ZipForge AI")
st.markdown("#### อัปโหลดไฟล์ ZIP ของคุณ แล้วทีม AI ของเราจะสร้างเป็น **เว็บแอปพร้อมใช้งาน** ให้ทันที")

c1, c2, c3 = st.columns(3)
c1.info("**1. อัปโหลด** 📤\n\nเว็บไซต์, ข้อมูล CSV/Excel, เอกสาร, รูปภาพ หรือซอร์สโค้ด")
c2.info("**2. AI สร้างให้** 🤖\n\nวิเคราะห์และสร้างเว็บแอปไฟล์เดียวที่ทำงานได้จริง")
c3.info("**3. ใช้งาน/เผยแพร่** 🚀\n\nดูตัวอย่างสด ดาวน์โหลด แล้วขึ้นโฮสต์ได้ทันที")

uploaded = st.file_uploader("📤 อัปโหลดไฟล์ ZIP", type=["zip"])
if not uploaded:
    st.stop()

raw = uploaded.getvalue()
digest = hashlib.sha256(raw).hexdigest()[:16]

try:
    project = load_zip(raw, uploaded.name)
except ZipError as exc:
    st.error(f"❌ {exc}")
    st.stop()

analysis = analyze(project)

# ----------------------------------------------------------------------------- analysis
st.subheader("🕵️ รายงานการวิเคราะห์")
m1, m2, m3, m4 = st.columns(4)
m1.metric("ชื่อโปรเจกต์", project.name)
m2.metric("จำนวนไฟล์", f"{len(project.files):,}")
m3.metric("ขนาดรวม", f"{analysis.total_bytes / 1024:,.1f} KB")
m4.metric("ประเภท", analysis.label.split(" ", 1)[0])
st.markdown(f"**ประเภทที่ตรวจพบ:** {analysis.label}")
for note in analysis.notes:
    st.markdown(f"- {note}")

with st.expander("📁 ดูรายการไฟล์ทั้งหมด"):
    st.code("\n".join(sorted(project.files)), language=None)

# ----------------------------------------------------------------------------- build options
st.subheader("⚙️ เลือกวิธีสร้างเว็บแอป")
default_mode = 1 if (analysis.kind == "code" and key) else 0
mode = st.radio(
    "โหมด",
    ["⚡ อัตโนมัติ (ฟรี เร็ว ไม่ต้องใช้ API key)", "🤖 AI สร้างให้ (Claude เขียนเว็บแอปใหม่จากไฟล์ของคุณ)"],
    index=default_mode,
    label_visibility="collapsed",
)
use_ai = mode.startswith("🤖")
instructions = ""
if use_ai:
    instructions = st.text_area(
        "บอกสิ่งที่คุณต้องการ (ไม่บังคับ)",
        placeholder="เช่น: ทำเป็นแดชบอร์ดยอดขาย มีกราฟรายเดือน ธีมสีเขียว และปุ่มส่งออก CSV",
    )
    if not key:
        st.warning("ต้องใส่ Anthropic API key ที่แถบด้านซ้ายเพื่อใช้โหมด AI")

if st.button("🚀 สร้างเว็บแอป", type="primary", width="stretch", disabled=use_ai and not key):
    with st.status("ทีม AI กำลังทำงาน...", expanded=True) as status:
        try:
            st.write(f"{TEAM[0][0]} **Analyst**: วิเคราะห์ {len(project.files)} ไฟล์ — {analysis.label}")
            st.write(f"{TEAM[1][0]} **Architect**: วางแผน{'ให้ AI เขียนแอปใหม่' if use_ai else 'ใช้เทมเพลตที่เหมาะกับประเภทไฟล์'}")
            st.write(f"{TEAM[2][0]} **Developer**: กำลังสร้างเว็บแอป...")
            started = time.time()
            if use_ai:
                from zipforge.ai import generate_app

                progress = st.empty()
                app_html = generate_app(
                    key, project, analysis, instructions, effort,
                    on_progress=lambda n: progress.caption(f"✍️ เขียนโค้ดแล้ว {n:,} ตัวอักษร..."),
                )
            else:
                app_html = build_auto(project, analysis)
            st.write(f"{TEAM[3][0]} **QA**: ตรวจสอบแล้ว ({len(app_html) / 1024:,.1f} KB, "
                     f"{time.time() - started:.1f} วินาที)")
            st.session_state["result"] = {"digest": digest, "html": app_html, "ai": use_ai}
            status.update(label="✅ สร้างเว็บแอปสำเร็จ!", state="complete", expanded=False)
        except Exception as exc:  # noqa: BLE001 - show any failure to the user
            status.update(label="❌ เกิดข้อผิดพลาด", state="error")
            st.error(f"{type(exc).__name__}: {exc}")

# ----------------------------------------------------------------------------- result
result = st.session_state.get("result")
if result and result["digest"] == digest:
    st.subheader("🎉 เว็บแอปของคุณพร้อมแล้ว")
    d1, d2 = st.columns(2)
    d1.download_button("⬇️ ดาวน์โหลด index.html", result["html"], f"{project.name}.html", "text/html",
                       width="stretch")
    d2.download_button("📦 ดาวน์โหลดชุดพร้อมขึ้นโฮสต์ (.zip)",
                       package_site(project, result["html"], keep_sources=result["ai"]),
                       f"{project.name}-webapp.zip", "application/zip", width="stretch")
    st.caption("💡 เผยแพร่ฟรี: ลากไฟล์ .zip ที่แตกแล้วไปวางที่ app.netlify.com/drop หรืออัปโหลดขึ้น GitHub Pages")

    tab_preview, tab_code = st.tabs(["👀 ตัวอย่างสด", "🧾 โค้ด"])
    with tab_preview:
        # data: URL -> opaque origin, so uploaded/AI-written code cannot touch this app
        preview = base64.b64encode(result["html"].encode()).decode()
        st.iframe(f"data:text/html;charset=utf-8;base64,{preview}", height=760)
    with tab_code:
        st.code(result["html"][:200_000], language="html")
