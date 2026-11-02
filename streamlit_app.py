"""ZipForge AI — บริษัท AI ที่เปลี่ยนไฟล์ ZIP (หรือคำอธิบาย) ให้เป็นเว็บไซต์จริง พร้อมกำหนดสิทธิ์การเข้าถึง"""

from __future__ import annotations

import base64
import hashlib
import io
import os
import time
import zipfile
from datetime import datetime

import streamlit as st

from zipforge import hosting
from zipforge.analyze import analyze
from zipforge.builders import build_auto, package_site
from zipforge.extract import ZipError, load_zip

st.set_page_config(page_title="ZipForge AI", page_icon="🏭", layout="wide")

TEAM = [
    ("🕵️", "Analyst", "แตกไฟล์ ZIP และวิเคราะห์ชนิดโปรเจกต์"),
    ("📐", "Architect", "วางแผนโครงสร้างเว็บแอปที่เหมาะสม"),
    ("👩‍💻", "Developer", "เขียน/ประกอบโค้ดเว็บแอป"),
    ("✅", "QA", "ตรวจสอบผลลัพธ์และเตรียมไฟล์พร้อมใช้งาน"),
    ("🚀", "DevOps", "นำเว็บขึ้นออนไลน์และดูแลสิทธิ์การเข้าถึง"),
]

state = st.session_state
state.setdefault("owner_keys", {})   # slug -> owner key, for sites this browser session manages
state.setdefault("unlocked", set())  # slugs unlocked by password in this session


# ============================================================================= helpers

def secret(name: str) -> str:
    try:
        value = st.secrets.get(name, "")
    except Exception:  # noqa: BLE001 - no secrets.toml configured
        value = ""
    return value or os.environ.get(name, "")


def login_configured() -> bool:
    try:
        return "auth" in st.secrets
    except Exception:  # noqa: BLE001
        return False


def current_email() -> str | None:
    if not login_configured():
        return None
    try:
        return st.user.email if st.user.is_logged_in else None
    except Exception:  # noqa: BLE001
        return None


def base_url() -> str:
    url = secret("ZIPFORGE_PUBLIC_URL")
    if not url:
        try:
            url = st.context.url or ""
        except Exception:  # noqa: BLE001
            url = ""
    return url.split("?", 1)[0].rstrip("/") or "http://localhost:8501"


def site_url(slug: str) -> str:
    return f"{base_url()}/?site={slug}"


def show_html(html: str, height: int = 760) -> None:
    """Render untrusted HTML in an isolated iframe (data: URL = opaque origin, no access to this app)."""
    encoded = base64.b64encode(html.encode()).decode()
    st.iframe(f"data:text/html;charset=utf-8;base64,{encoded}", height=height)


def sample_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("my-shop/sales.csv",
                    "month,product,units,revenue\n"
                    "Jan,กาแฟ,120,6000\nJan,ชาเขียว,80,3200\nFeb,กาแฟ,150,7500\nFeb,ชาเขียว,95,3800\n"
                    "Mar,กาแฟ,170,8500\nMar,ชาเขียว,110,4400\nApr,กาแฟ,160,8000\nApr,ชาเขียว,130,5200\n")
        zf.writestr("my-shop/README.md", "# ร้านกาแฟของฉัน\n\nยอดขายรายเดือนของร้าน\n")
    return buf.getvalue()


def access_inputs(key: str, current: hosting.Site | None = None) -> tuple[str, str, list[str]]:
    """Widgets for choosing who can open a site. Returns (access, password, emails)."""
    levels = list(hosting.ACCESS_LEVELS)
    access = st.radio("ใครเข้าถึงเว็บนี้ได้บ้าง?", levels,
                      index=levels.index(current.access) if current else 0,
                      format_func=hosting.ACCESS_LEVELS.get, key=f"{key}-access")
    password, emails = "", []
    if access == "password":
        hint = " (เว้นว่าง = ใช้รหัสเดิม)" if current and current.password_hash else ""
        password = st.text_input("ตั้งรหัสผ่าน" + hint, type="password", key=f"{key}-pw")
    elif access == "emails":
        raw = st.text_area("อีเมลที่อนุญาต (คั่นด้วยบรรทัดใหม่หรือจุลภาค)",
                           value="\n".join(current.emails) if current else "",
                           placeholder="friend@gmail.com\nteam@company.com", key=f"{key}-emails")
        try:
            emails = hosting.parse_emails(raw)
        except hosting.HostingError as exc:
            st.error(str(exc))
        if not login_configured():
            st.warning("ยังไม่ได้ตั้งค่าระบบล็อกอิน — ผู้เข้าชมจะยังเปิดเว็บนี้ไม่ได้จนกว่าจะตั้งค่า `[auth]` "
                       "ใน Secrets (ดู README)")
    elif access == "private":
        st.caption("เปิดได้เฉพาะผู้ที่มี **คีย์เจ้าของ** เท่านั้น")
    return access, password, emails


def publish_panel(html: str, default_title: str, key: str) -> None:
    """'Put it online' form shown under every generated result."""
    with st.container(border=True):
        st.markdown("### 🚀 เผยแพร่เป็นเว็บไซต์จริง")
        c1, c2 = st.columns(2)
        title = c1.text_input("ชื่อเว็บไซต์", value=default_title, key=f"{key}-title")
        slug = c2.text_input("ชื่อลิงก์ (a-z, 0-9, -)", value=hosting.normalize_slug(default_title),
                             key=f"{key}-slug", help=f"ลิงก์จะเป็น {base_url()}/?site=ชื่อลิงก์")
        access, password, emails = access_inputs(key)
        if st.button("🌐 เผยแพร่ตอนนี้", type="primary", key=f"{key}-go", width="stretch"):
            try:
                site, owner_key = hosting.publish(html, title, slug, access, password, emails)
            except hosting.HostingError as exc:
                st.error(str(exc))
                return
            state.owner_keys[site.slug] = owner_key
            st.success(f"✅ เว็บไซต์ออนไลน์แล้ว: {site_url(site.slug)}")
            st.code(site_url(site.slug), language=None)
            st.markdown("**🔐 คีย์เจ้าของ** (ใช้แก้ไข/เปลี่ยนสิทธิ์/ลบเว็บ — เก็บไว้ให้ดี จะแสดงครั้งเดียว):")
            st.code(owner_key, language=None)
            st.link_button("เปิดเว็บไซต์ ↗", site_url(site.slug))


def show_result(html: str, name: str, key: str, project=None, with_sources: bool = False) -> None:
    st.subheader("🎉 เว็บของคุณพร้อมแล้ว")
    d1, d2 = st.columns(2)
    d1.download_button("⬇️ ดาวน์โหลด index.html", html, f"{name}.html", "text/html", width="stretch",
                       key=f"{key}-dl-html")
    if project is not None:
        d2.download_button("📦 ดาวน์โหลดชุดพร้อมขึ้นโฮสต์ (.zip)", package_site(project, html, with_sources),
                           f"{name}-webapp.zip", "application/zip", width="stretch", key=f"{key}-dl-zip")
    tab_preview, tab_code = st.tabs(["👀 ตัวอย่างสด", "🧾 โค้ด HTML"])
    with tab_preview:
        show_html(html)
    with tab_code:
        st.code(html[:200_000], language="html")
    publish_panel(html, name, key)


# ============================================================================= public site viewer

def view_site(slug: str) -> None:
    site = hosting.get(slug)
    if site is None:
        st.error("ไม่พบเว็บไซต์นี้ หรือถูกลบไปแล้ว")
        st.link_button("🏭 ไปหน้าแรก ZipForge AI", base_url())
        return

    owner = slug in state.owner_keys and hosting.is_owner(site, state.owner_keys[slug])
    allowed = owner or site.access == "public"
    email = current_email()

    if not allowed and site.access == "password":
        allowed = slug in state.unlocked
        if not allowed:
            st.markdown(f"## 🔑 {site.title}")
            with st.form("pw"):
                pw = st.text_input("เว็บนี้ป้องกันด้วยรหัสผ่าน", type="password")
                if st.form_submit_button("เข้าสู่เว็บไซต์", type="primary"):
                    if hosting.check_password(site, pw):
                        state.unlocked.add(slug)
                        st.rerun()
                    st.error("รหัสผ่านไม่ถูกต้อง")
    elif not allowed and site.access == "emails":
        allowed = hosting.email_allowed(site, email)
        if not allowed:
            st.markdown(f"## 📧 {site.title}")
            st.info("เว็บนี้เปิดให้เฉพาะอีเมลที่เจ้าของอนุญาต")
            if not login_configured():
                st.warning("ระบบล็อกอินยังไม่ได้ตั้งค่า กรุณาติดต่อเจ้าของเว็บไซต์")
            elif email:
                st.error(f"บัญชี {email} ไม่มีสิทธิ์เข้าถึงเว็บนี้")
                st.button("ออกจากระบบ", on_click=st.logout)
            else:
                st.button("🔐 ล็อกอินเพื่อเข้าชม", type="primary", on_click=st.login)
    elif not allowed:  # private
        st.markdown(f"## 🔒 {site.title}")
        with st.form("owner"):
            k = st.text_input("เว็บนี้เป็นแบบส่วนตัว — ใส่คีย์เจ้าของเพื่อเปิด", type="password")
            if st.form_submit_button("เปิด", type="primary"):
                if hosting.is_owner(site, k):
                    state.owner_keys[slug] = k
                    st.rerun()
                st.error("คีย์ไม่ถูกต้อง")

    if not allowed:
        return

    if f"viewed-{slug}" not in state:
        state[f"viewed-{slug}"] = True
        hosting.record_view(site)
    # full-screen: hide Streamlit chrome and stretch the iframe to the window
    st.markdown("""<style>
      header, [data-testid="stSidebar"], [data-testid="stToolbar"], footer { display:none !important; }
      .block-container, [data-testid="stMainBlockContainer"] { padding:0 !important; max-width:100% !important; }
      iframe { height:100vh !important; border:0; display:block; }
    </style>""", unsafe_allow_html=True)
    show_html(hosting.read_html(site), height=900)


site_param = st.query_params.get("site")
if site_param:
    view_site(site_param)
    st.stop()


# ============================================================================= sidebar
with st.sidebar:
    st.markdown("## 🏭 ZipForge AI")
    st.caption("บริษัท AI ที่เปลี่ยนไฟล์ของคุณให้เป็นเว็บไซต์จริง")
    st.markdown("### 👥 ทีมงาน AI ของเรา")
    for icon, role, desc in TEAM:
        st.markdown(f"{icon} **{role}** — {desc}")

    st.divider()
    st.markdown("### 🔑 AI Engine (Claude)")
    api_key = secret("ANTHROPIC_API_KEY")
    if api_key:
        st.success("เชื่อมต่อ API key แล้ว")
    else:
        api_key = st.text_input("Anthropic API key", type="password",
                                help="ใช้สำหรับโหมด AI เท่านั้น — โหมดอัตโนมัติใช้ได้ฟรีโดยไม่ต้องมี key")
    effort = st.select_slider("ความละเอียดของ AI", options=["low", "medium", "high", "xhigh"], value="high",
                              help="สูง = คุณภาพดีขึ้นแต่ใช้เวลาและค่าใช้จ่ายมากขึ้น")
    st.divider()
    st.download_button("📦 ดาวน์โหลด ZIP ตัวอย่าง", sample_zip(), "sample-shop.zip", "application/zip",
                       width="stretch")


# ============================================================================= hero
st.title("🏭 ZipForge AI")
st.markdown("#### อัปโหลดไฟล์ ZIP หรือเล่าว่าอยากได้เว็บแบบไหน — ทีม AI ของเราจะสร้าง HTML "
            "และ **นำขึ้นเว็บไซต์จริง** พร้อมกำหนดได้ว่าใครเข้าถึงได้บ้าง")

c1, c2, c3, c4 = st.columns(4)
c1.info("**1. ส่งไฟล์/ไอเดีย** 📤\n\nZIP เว็บไซต์ ข้อมูล เอกสาร รูปภาพ โค้ด หรือแค่คำอธิบาย")
c2.info("**2. AI สร้าง HTML** 🤖\n\nได้เว็บไฟล์เดียวที่ทำงานได้จริง")
c3.info("**3. เผยแพร่** 🌐\n\nได้ลิงก์เว็บไซต์จริงทันที")
c4.info("**4. ควบคุมสิทธิ์** 🔐\n\nสาธารณะ / รหัสผ่าน / เฉพาะอีเมล / ส่วนตัว")

tab_zip, tab_prompt, tab_sites = st.tabs(["📦 ZIP → เว็บแอป", "✨ สร้าง HTML ด้วย AI", "🌐 เว็บไซต์ของฉัน"])


# ============================================================================= tab: zip
def run_build(use_ai: bool, project, analysis, instructions: str) -> str:
    st.write(f"{TEAM[0][0]} **Analyst**: วิเคราะห์ {len(project.files)} ไฟล์ — {analysis.label}")
    st.write(f"{TEAM[1][0]} **Architect**: วางแผน{'ให้ AI เขียนแอปใหม่' if use_ai else 'ใช้เทมเพลตที่เหมาะกับประเภทไฟล์'}")
    st.write(f"{TEAM[2][0]} **Developer**: กำลังสร้างเว็บแอป...")
    started = time.time()
    if use_ai:
        from zipforge.ai import generate_app

        progress = st.empty()
        html = generate_app(api_key, project, analysis, instructions, effort,
                            on_progress=lambda n: progress.caption(f"✍️ เขียนโค้ดแล้ว {n:,} ตัวอักษร..."))
    else:
        html = build_auto(project, analysis)
    st.write(f"{TEAM[3][0]} **QA**: ตรวจสอบแล้ว ({len(html) / 1024:,.1f} KB, {time.time() - started:.1f} วินาที)")
    return html


with tab_zip:
    uploaded = st.file_uploader("📤 อัปโหลดไฟล์ ZIP", type=["zip"])
    project = analysis = None
    if uploaded:
        raw = uploaded.getvalue()
        digest = hashlib.sha256(raw).hexdigest()[:16]
        try:
            project = load_zip(raw, uploaded.name)
        except ZipError as exc:
            st.error(f"❌ {exc}")

    if project:
        analysis = analyze(project)
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

        st.subheader("⚙️ เลือกวิธีสร้างเว็บแอป")
        mode = st.radio(
            "โหมด",
            ["⚡ อัตโนมัติ (ฟรี เร็ว ไม่ต้องใช้ API key)", "🤖 AI สร้างให้ (Claude เขียนเว็บแอปใหม่จากไฟล์ของคุณ)"],
            index=1 if (analysis.kind == "code" and api_key) else 0,
            label_visibility="collapsed",
        )
        use_ai = mode.startswith("🤖")
        instructions = ""
        if use_ai:
            instructions = st.text_area(
                "บอกสิ่งที่คุณต้องการ (ไม่บังคับ)",
                placeholder="เช่น: ทำเป็นแดชบอร์ดยอดขาย มีกราฟรายเดือน ธีมสีเขียว และปุ่มส่งออก CSV",
            )
            if not api_key:
                st.warning("ต้องใส่ Anthropic API key ที่แถบด้านซ้ายเพื่อใช้โหมด AI")

        if st.button("🚀 สร้างเว็บแอป", type="primary", width="stretch", disabled=use_ai and not api_key):
            with st.status("ทีม AI กำลังทำงาน...", expanded=True) as status:
                try:
                    html = run_build(use_ai, project, analysis, instructions)
                    state["zip_result"] = {"digest": digest, "html": html, "ai": use_ai}
                    status.update(label="✅ สร้างเว็บแอปสำเร็จ!", state="complete", expanded=False)
                except Exception as exc:  # noqa: BLE001 - show any failure to the user
                    status.update(label="❌ เกิดข้อผิดพลาด", state="error")
                    st.error(f"{type(exc).__name__}: {exc}")

        result = state.get("zip_result")
        if result and result["digest"] == digest:
            show_result(result["html"], project.name, "zip", project, with_sources=result["ai"])


# ============================================================================= tab: prompt
with tab_prompt:
    st.markdown("เล่าว่าอยากได้เว็บแบบไหน แล้ว AI จะเขียน **HTML ทั้งหน้า** ให้ทันที — ไม่ต้องมีไฟล์")
    examples = {
        "—": "",
        "ร้านกาแฟ": "เว็บไซต์ร้านกาแฟชื่อ 'บ้านกาแฟ' มีเมนูพร้อมราคา รูปบรรยากาศ เวลาเปิดปิด แผนที่ และปุ่มสั่งผ่าน LINE",
        "พอร์ตโฟลิโอ": "เว็บพอร์ตโฟลิโอส่วนตัวของนักออกแบบกราฟิก มีผลงาน 6 ชิ้น ประวัติ ทักษะ และฟอร์มติดต่อ",
        "แอปรายรับรายจ่าย": "แอปบันทึกรายรับรายจ่าย เพิ่ม/ลบรายการ สรุปยอดรายเดือนเป็นกราฟ และบันทึกข้อมูลไว้ในเบราว์เซอร์",
    }
    pick = st.selectbox("ตัวอย่างไอเดีย", list(examples))
    description = st.text_area("คำอธิบายเว็บไซต์", value=examples[pick], height=140,
                               placeholder="เช่น: เว็บแนะนำบริษัท มีหน้าบริการ ราคา รีวิวลูกค้า และฟอร์มติดต่อ ธีมสีน้ำเงิน")
    site_name = st.text_input("ชื่อโปรเจกต์", value="my-website")
    if not api_key:
        st.warning("ต้องใส่ Anthropic API key ที่แถบด้านซ้ายเพื่อใช้ฟีเจอร์นี้")
    if st.button("✨ สร้าง HTML", type="primary", width="stretch",
                 disabled=not (api_key and description.strip())):
        with st.status("ทีม AI กำลังเขียนเว็บไซต์...", expanded=True) as status:
            try:
                from zipforge.ai import generate_from_prompt

                progress = st.empty()
                html = generate_from_prompt(
                    api_key, description, effort,
                    on_progress=lambda n: progress.caption(f"✍️ เขียนโค้ดแล้ว {n:,} ตัวอักษร..."))
                state["prompt_result"] = {"html": html, "name": site_name}
                status.update(label="✅ สร้าง HTML สำเร็จ!", state="complete", expanded=False)
            except Exception as exc:  # noqa: BLE001
                status.update(label="❌ เกิดข้อผิดพลาด", state="error")
                st.error(f"{type(exc).__name__}: {exc}")
    if state.get("prompt_result"):
        res = state["prompt_result"]
        show_result(res["html"], hosting.normalize_slug(res["name"]) or "my-website", "prompt")


# ============================================================================= tab: my sites
def manage_site(site: hosting.Site, owner_key: str) -> None:
    with st.expander(f"{hosting.ACCESS_LEVELS[site.access].split(' ', 1)[0]} **{site.title}** — "
                     f"`{site.slug}` · 👁️ {site.views} ครั้ง"):
        st.code(site_url(site.slug), language=None)
        b1, b2 = st.columns(2)
        b1.link_button("เปิดเว็บไซต์ ↗", site_url(site.slug), width="stretch")
        b2.download_button("⬇️ ดาวน์โหลด HTML", hosting.read_html(site), f"{site.slug}.html", "text/html",
                           width="stretch", key=f"dl-{site.slug}")
        st.caption(f"สร้างเมื่อ {datetime.fromtimestamp(site.created):%d/%m/%Y %H:%M} · "
                   f"แก้ไขล่าสุด {datetime.fromtimestamp(site.updated):%d/%m/%Y %H:%M}")

        st.markdown("##### 🔐 สิทธิ์การเข้าถึง")
        access, password, emails = access_inputs(f"m-{site.slug}", site)
        if st.button("💾 บันทึกสิทธิ์", key=f"save-{site.slug}"):
            try:
                hosting.update_access(site, access, password, emails)
                st.success("บันทึกแล้ว")
                st.rerun()
            except hosting.HostingError as exc:
                st.error(str(exc))

        st.markdown("##### ♻️ อัปเดตเนื้อหา")
        new_file = st.file_uploader("อัปโหลดไฟล์ HTML ใหม่แทนของเดิม", type=["html", "htm"], key=f"up-{site.slug}")
        if new_file and st.button("อัปเดตเว็บไซต์", key=f"upd-{site.slug}"):
            hosting.update_html(site, new_file.getvalue().decode("utf-8", errors="replace"))
            st.success("อัปเดตแล้ว")

        st.markdown("##### 🗑️ ลบเว็บไซต์")
        if st.checkbox("ยืนยันว่าต้องการลบถาวร", key=f"cf-{site.slug}") and \
                st.button("ลบเว็บไซต์นี้", type="primary", key=f"del-{site.slug}"):
            hosting.delete(site)
            state.owner_keys.pop(site.slug, None)
            st.rerun()


with tab_sites:
    st.markdown("จัดการเว็บไซต์ที่คุณเผยแพร่: เปลี่ยนสิทธิ์ใครเข้าได้ อัปเดตเนื้อหา หรือลบ")

    with st.form("claim"):
        st.markdown("**🔑 เปิดจัดการเว็บด้วยคีย์เจ้าของ**")
        f1, f2 = st.columns(2)
        claim_slug = f1.text_input("ชื่อลิงก์ของเว็บ")
        claim_key = f2.text_input("คีย์เจ้าของ", type="password")
        if st.form_submit_button("เปิดจัดการ"):
            site = hosting.get(hosting.normalize_slug(claim_slug))
            if site and hosting.is_owner(site, claim_key):
                state.owner_keys[site.slug] = claim_key
                st.success(f"เพิ่ม {site.title} แล้ว")
            else:
                st.error("ชื่อลิงก์หรือคีย์ไม่ถูกต้อง")

    mine = [(hosting.get(s), k) for s, k in state.owner_keys.items()]
    mine = [(s, k) for s, k in mine if s and hosting.is_owner(s, k)]
    if mine:
        for site, key in mine:
            manage_site(site, key)
    else:
        st.info("ยังไม่มีเว็บไซต์ในเซสชันนี้ — สร้างเว็บจากแท็บแรกแล้วกด 🌐 เผยแพร่ หรือใช้คีย์เจ้าของด้านบน")

    admin_pw = secret("ZIPFORGE_ADMIN_PASSWORD")
    if admin_pw:
        with st.expander("🏢 ผู้ดูแลบริษัท (ดูเว็บไซต์ทั้งหมด)"):
            if st.text_input("รหัสผู้ดูแล", type="password", key="admin") == admin_pw:
                sites = hosting.list_sites()
                st.metric("เว็บไซต์ทั้งหมด", len(sites))
                st.dataframe([{"ชื่อ": s.title, "ลิงก์": site_url(s.slug), "สิทธิ์": hosting.ACCESS_LEVELS[s.access],
                               "เข้าชม": s.views, "อัปเดต": datetime.fromtimestamp(s.updated)} for s in sites],
                             width="stretch")
