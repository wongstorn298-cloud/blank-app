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

from zipforge import agents, hosting
from zipforge.analyze import analyze
from zipforge.builders import build_auto, package_site
from zipforge.extract import ZipError, load_zip
from zipforge.office import render as render_office

st.set_page_config(page_title="ZipForge AI", page_icon=":material/factory:", layout="wide")

ACCESS_ICONS = {"public": ":material/public:", "password": ":material/password:",
                "emails": ":material/alternate_email:", "private": ":material/lock:"}
ACCESS_HELP = {"public": "ทุกคนที่มีลิงก์เปิดได้", "password": "ต้องใส่รหัสผ่านก่อนเข้า",
               "emails": "เฉพาะอีเมลที่อนุญาต (ต้องล็อกอิน)", "private": "เฉพาะผู้ที่มีคีย์เจ้าของ"}
KIND_ICONS = {"static": ":material/language:", "data": ":material/table_chart:", "docs": ":material/menu_book:",
              "gallery": ":material/photo_library:", "code": ":material/code:"}
AGENT_ICONS = {"secretary": ":material/assignment:", "analyst": ":material/query_stats:",
               "architect": ":material/architecture:", "developer": ":material/code:",
               "qa": ":material/verified:", "devops": ":material/rocket_launch:"}
STATUS_BADGE = {"new": "blue", "working": "primary", "review": "orange", "idle": "gray"}


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


def access_label(level: str) -> str:
    return f"{ACCESS_ICONS[level]} {hosting.ACCESS_LEVELS[level]}"


def access_inputs(key: str, current: hosting.Site | None = None) -> tuple[str, str, list[str]]:
    """Widgets for choosing who can open a site. Returns (access, password, emails)."""
    access = st.segmented_control("ใครเข้าถึงเว็บนี้ได้บ้าง", list(hosting.ACCESS_LEVELS),
                                  default=current.access if current else "public", required=True,
                                  format_func=access_label, key=f"{key}-access")
    st.caption(ACCESS_HELP[access])
    password, emails = "", []
    if access == "password":
        hint = " (เว้นว่างเพื่อใช้รหัสเดิม)" if current and current.password_hash else ""
        password = st.text_input("ตั้งรหัสผ่าน" + hint, type="password", key=f"{key}-pw")
    elif access == "emails":
        raw = st.text_area("อีเมลที่อนุญาต (คั่นด้วยบรรทัดใหม่หรือจุลภาค)",
                           value="\n".join(current.emails) if current else "",
                           placeholder="friend@gmail.com\nteam@company.com", key=f"{key}-emails")
        try:
            emails = hosting.parse_emails(raw)
        except hosting.HostingError as exc:
            st.error(str(exc), icon=":material/error:")
        if not login_configured():
            st.warning("ผู้เข้าชมจะยังเปิดเว็บนี้ไม่ได้จนกว่าจะตั้งค่า `[auth]` ใน Secrets (ดู README)",
                       icon=":material/warning:", title="ยังไม่ได้ตั้งค่าระบบล็อกอิน")
    return access, password, emails


def publish_panel(html: str, default_title: str, key: str) -> None:
    """'Put it online' form shown under every generated result."""
    with st.container(border=True):
        st.subheader("เผยแพร่เป็นเว็บไซต์จริง", icon=":material/rocket_launch:")
        c1, c2 = st.columns(2)
        title = c1.text_input("ชื่อเว็บไซต์", value=default_title, key=f"{key}-title")
        slug = c2.text_input("ชื่อลิงก์ (a-z, 0-9, -)", value=hosting.normalize_slug(default_title),
                             key=f"{key}-slug", help=f"ลิงก์จะเป็น {base_url()}/?site=ชื่อลิงก์")
        access, password, emails = access_inputs(key)
        if st.button("เผยแพร่ตอนนี้", icon=":material/public:", type="primary", key=f"{key}-go", width="stretch"):
            try:
                site, owner_key = hosting.publish(html, title, slug, access, password, emails)
            except hosting.HostingError as exc:
                st.error(str(exc), icon=":material/error:")
                return
            state.owner_keys[site.slug] = owner_key
            agents.resolve_by_title(default_title)
            agents.log_done("devops", f"เผยแพร่ {site.slug} ({hosting.ACCESS_LEVELS[access]})")
            st.success(site_url(site.slug), icon=":material/check_circle:", title="เว็บไซต์ออนไลน์แล้ว")
            st.code(site_url(site.slug), language=None)
            st.markdown(":material/key: **คีย์เจ้าของ** ใช้แก้ไข เปลี่ยนสิทธิ์ หรือลบเว็บ "
                        "จะแสดงครั้งเดียว เก็บไว้ให้ดี")
            st.code(owner_key, language=None)
            st.link_button("เปิดเว็บไซต์", site_url(site.slug), icon=":material/open_in_new:")


def show_result(html: str, name: str, key: str, project=None, with_sources: bool = False) -> None:
    st.subheader("เว็บของคุณพร้อมแล้ว", icon=":material/celebration:")
    with st.container(horizontal=True):
        st.download_button("ดาวน์โหลด index.html", html, f"{name}.html", "text/html",
                           icon=":material/download:", key=f"{key}-dl-html")
        if project is not None:
            st.download_button("ดาวน์โหลดชุดพร้อมขึ้นโฮสต์ (.zip)", package_site(project, html, with_sources),
                               f"{name}-webapp.zip", "application/zip", icon=":material/folder_zip:",
                               key=f"{key}-dl-zip")
    tab_preview, tab_code = st.tabs([":material/visibility: ตัวอย่างสด", ":material/code: โค้ด HTML"])
    with tab_preview:
        show_html(html)
    with tab_code:
        st.code(html[:200_000], language="html")
    publish_panel(html, name, key)


# ============================================================================= public site viewer

def view_site(slug: str) -> None:
    site = hosting.get(slug)
    if site is None:
        st.error("ลิงก์อาจพิมพ์ผิด หรือเจ้าของลบเว็บไปแล้ว", icon=":material/link_off:", title="ไม่พบเว็บไซต์นี้")
        st.link_button("ไปหน้าแรก ZipForge AI", base_url(), icon=":material/home:")
        return

    owner = slug in state.owner_keys and hosting.is_owner(site, state.owner_keys[slug])
    allowed = owner or site.access == "public"
    email = current_email()

    if not allowed and site.access == "password":
        allowed = slug in state.unlocked
        if not allowed:
            st.title(site.title, icon=":material/password:")
            with st.form("pw"):
                pw = st.text_input("เว็บนี้ป้องกันด้วยรหัสผ่าน", type="password")
                if st.form_submit_button("เข้าสู่เว็บไซต์", type="primary", icon=":material/login:"):
                    if hosting.check_password(site, pw):
                        state.unlocked.add(slug)
                        st.rerun()
                    st.error("รหัสผ่านไม่ถูกต้อง ลองอีกครั้ง", icon=":material/error:")
    elif not allowed and site.access == "emails":
        allowed = hosting.email_allowed(site, email)
        if not allowed:
            st.title(site.title, icon=":material/alternate_email:")
            st.caption("เว็บนี้เปิดให้เฉพาะอีเมลที่เจ้าของอนุญาต")
            if not login_configured():
                st.warning("กรุณาติดต่อเจ้าของเว็บไซต์", icon=":material/warning:", title="ระบบล็อกอินยังไม่พร้อม")
            elif email:
                st.error(f"บัญชี {email} ไม่มีสิทธิ์เข้าถึงเว็บนี้", icon=":material/block:")
                st.button("ออกจากระบบ", on_click=st.logout, icon=":material/logout:")
            else:
                st.button("ล็อกอินเพื่อเข้าชม", type="primary", on_click=st.login, icon=":material/login:")
    elif not allowed:  # private
        st.title(site.title, icon=":material/lock:")
        with st.form("owner"):
            k = st.text_input("เว็บนี้เป็นแบบส่วนตัว ใส่คีย์เจ้าของเพื่อเปิด", type="password")
            if st.form_submit_button("เปิดเว็บไซต์", type="primary", icon=":material/key:"):
                if hosting.is_owner(site, k):
                    state.owner_keys[slug] = k
                    st.rerun()
                st.error("คีย์ไม่ถูกต้อง", icon=":material/error:")

    if not allowed:
        return

    if f"viewed-{slug}" not in state:
        state[f"viewed-{slug}"] = True
        hosting.record_view(site)
    # Full-screen viewer: the published site replaces the app chrome entirely.
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
    st.header("ZipForge AI", icon=":material/factory:")
    st.caption("บริษัท AI ที่เปลี่ยนไฟล์ของคุณให้เป็นเว็บไซต์จริง")

    st.subheader("ทีมงาน", icon=":material/groups:")
    for a in agents.AGENTS:
        st.markdown(f"{AGENT_ICONS[a['id']]} **{a['name']}** · {a['role']}  \n"
                    f":gray[{a['desc']}]")

    st.subheader("AI engine", icon=":material/key:")
    api_key = secret("ANTHROPIC_API_KEY")
    if api_key:
        st.badge("เชื่อมต่อ Claude แล้ว", icon=":material/check:", color="green")
    else:
        api_key = st.text_input("Anthropic API key", type="password",
                                help="ใช้สำหรับโหมด AI เท่านั้น โหมดอัตโนมัติใช้ได้ฟรีโดยไม่ต้องมี key")
    effort = st.select_slider("ความละเอียดของ AI", options=["low", "medium", "high", "xhigh"], value="high",
                              help="สูงขึ้นได้งานละเอียดขึ้น แต่ใช้เวลาและค่าใช้จ่ายมากขึ้น")
    st.space("small")
    st.download_button("ดาวน์โหลด ZIP ตัวอย่าง", sample_zip(), "sample-shop.zip", "application/zip",
                       icon=":material/download:", width="stretch")


# ============================================================================= hero
st.title("ZipForge AI", icon=":material/factory:")
st.markdown("อัปโหลดไฟล์ ZIP หรือเล่าว่าอยากได้เว็บแบบไหน ทีม AI จะสร้าง HTML "
            "นำขึ้นเว็บไซต์จริง และให้คุณกำหนดได้ว่าใครเข้าถึงได้บ้าง")
with st.container(horizontal=True, gap="small"):
    st.badge("ส่งไฟล์หรือไอเดีย", icon=":material/upload:", color="primary")
    st.badge("AI สร้าง HTML", icon=":material/auto_awesome:", color="primary")
    st.badge("เผยแพร่ได้ลิงก์จริง", icon=":material/public:", color="primary")
    st.badge("กำหนดสิทธิ์ผู้เข้าชม", icon=":material/shield_person:", color="primary")

tab_office, tab_zip, tab_prompt, tab_sites = st.tabs([
    ":material/apartment: ออฟฟิศ AI", ":material/folder_zip: ZIP เป็นเว็บแอป",
    ":material/auto_awesome: สร้าง HTML ด้วย AI", ":material/public: เว็บไซต์ของฉัน"])


# ============================================================================= tab: zip
def say(agent_id: str, text: str) -> None:
    a = agents.AGENT_BY_ID[agent_id]
    st.markdown(f"{AGENT_ICONS[agent_id]} **{a['name']}** · {a['role']}: {text}")


def run_build(use_ai: bool, project, analysis, instructions: str) -> str:
    name = project.name
    say("analyst", f"วิเคราะห์ {len(project.files)} ไฟล์ พบว่าเป็น{analysis.label}")
    agents.log_done("analyst", f"วิเคราะห์ {name}")
    say("architect", "วางแผน" + ("ให้ AI เขียนแอปใหม่" if use_ai else "ใช้เทมเพลตที่เหมาะกับประเภทไฟล์"))
    agents.log_done("architect", f"วางแผนเว็บ {name}")
    say("developer", "กำลังสร้างเว็บแอป")
    dev_task = agents.add_task("developer", f"สร้างเว็บ {name}")
    started = time.time()
    try:
        if use_ai:
            from zipforge.ai import generate_app

            progress = st.empty()
            html = generate_app(api_key, project, analysis, instructions, effort,
                                on_progress=lambda n: progress.caption(f"เขียนโค้ดแล้ว {n:,} ตัวอักษร"))
        else:
            html = build_auto(project, analysis)
    finally:
        agents.set_status(dev_task, "done")
    say("qa", f"ตรวจสอบแล้ว ({len(html) / 1024:,.1f} KB, {time.time() - started:.1f} วินาที)")
    agents.log_done("qa", f"ตรวจสอบ {name}")
    agents.submit_for_approval(name, html)
    say("secretary", "ส่งงานเข้ากล่องอนุมัติแล้ว อนุมัติได้ที่แท็บออฟฟิศ AI หรือเผยแพร่ด้านล่าง")
    return html


with tab_zip:
    uploaded = st.file_uploader("อัปโหลดไฟล์ ZIP", type=["zip"],
                                help="เว็บไซต์ ข้อมูล CSV/Excel เอกสาร รูปภาพ หรือซอร์สโค้ด ขนาดไม่เกิน 200 MB")
    project = analysis = None
    if uploaded:
        raw = uploaded.getvalue()
        digest = hashlib.sha256(raw).hexdigest()[:16]
        try:
            project = load_zip(raw, uploaded.name)
        except ZipError as exc:
            st.error(str(exc), icon=":material/error:", title="เปิดไฟล์ ZIP ไม่ได้")
    else:
        st.caption("ยังไม่มีไฟล์? กด **ดาวน์โหลด ZIP ตัวอย่าง** ที่แถบซ้ายแล้วอัปโหลดกลับมาเพื่อทดลองได้เลย")

    if project:
        analysis = analyze(project)
        st.subheader("รายงานการวิเคราะห์", icon=":material/query_stats:")
        with st.container(horizontal=True):
            st.metric("ชื่อโปรเจกต์", project.name, border=True)
            st.metric("จำนวนไฟล์", f"{len(project.files):,}", border=True)
            st.metric("ขนาดรวม", f"{analysis.total_bytes / 1024:,.1f} KB", border=True)
        st.markdown(f"{KIND_ICONS[analysis.kind]} ประเภทที่ตรวจพบ: **{analysis.label}**")
        for note in analysis.notes:
            st.markdown(f"- {note}")
        with st.expander("ดูรายการไฟล์ทั้งหมด", icon=":material/folder_open:"):
            st.code("\n".join(sorted(project.files)), language=None)

        st.subheader("เลือกวิธีสร้างเว็บแอป", icon=":material/tune:")
        mode = st.segmented_control(
            "โหมด", ["auto", "ai"], required=True,
            default="ai" if (analysis.kind == "code" and api_key) else "auto",
            format_func={"auto": ":material/bolt: อัตโนมัติ", "ai": ":material/auto_awesome: AI สร้างให้"}.get,
            label_visibility="collapsed",
        )
        use_ai = mode == "ai"
        st.caption("Claude เขียนเว็บแอปใหม่จากไฟล์ของคุณ ต้องใช้ API key" if use_ai
                   else "ฟรีและเร็ว ไม่ต้องใช้ API key ใช้เทมเพลตตามประเภทไฟล์")
        instructions = ""
        if use_ai:
            instructions = st.text_area(
                "บอกสิ่งที่คุณต้องการ (ไม่บังคับ)",
                placeholder="เช่น ทำเป็นแดชบอร์ดยอดขาย มีกราฟรายเดือน ธีมสีเขียว และปุ่มส่งออก CSV",
            )
            if not api_key:
                st.warning("ใส่ Anthropic API key ที่แถบด้านซ้ายเพื่อใช้โหมด AI", icon=":material/key:")

        if st.button("สร้างเว็บแอป", icon=":material/rocket_launch:", type="primary", width="stretch",
                     disabled=use_ai and not api_key):
            with st.status("ทีม AI กำลังทำงาน", expanded=True) as status:
                try:
                    html = run_build(use_ai, project, analysis, instructions)
                    state["zip_result"] = {"digest": digest, "html": html, "ai": use_ai}
                    status.update(label="สร้างเว็บแอปสำเร็จ", state="complete", expanded=False)
                except Exception as exc:  # noqa: BLE001 - show any failure to the user
                    status.update(label="สร้างไม่สำเร็จ", state="error")
                    st.error(f"{type(exc).__name__}: {exc}", icon=":material/error:")

        result = state.get("zip_result")
        if result and result["digest"] == digest:
            show_result(result["html"], project.name, "zip", project, with_sources=result["ai"])


# ============================================================================= tab: prompt
with tab_prompt:
    st.markdown("เล่าว่าอยากได้เว็บแบบไหน แล้ว AI จะเขียน **HTML ทั้งหน้า** ให้ทันที ไม่ต้องมีไฟล์")
    examples = {
        "ร้านกาแฟ": "เว็บไซต์ร้านกาแฟชื่อ 'บ้านกาแฟ' มีเมนูพร้อมราคา รูปบรรยากาศ เวลาเปิดปิด แผนที่ และปุ่มสั่งผ่าน LINE",
        "พอร์ตโฟลิโอ": "เว็บพอร์ตโฟลิโอส่วนตัวของนักออกแบบกราฟิก มีผลงาน 6 ชิ้น ประวัติ ทักษะ และฟอร์มติดต่อ",
        "แอปรายรับรายจ่าย": "แอปบันทึกรายรับรายจ่าย เพิ่ม/ลบรายการ สรุปยอดรายเดือนเป็นกราฟ และบันทึกข้อมูลไว้ในเบราว์เซอร์",
    }
    pick = st.pills("เริ่มจากไอเดียตัวอย่าง", list(examples))
    description = st.text_area("คำอธิบายเว็บไซต์", value=examples.get(pick, ""), height=140,
                               placeholder="เช่น เว็บแนะนำบริษัท มีหน้าบริการ ราคา รีวิวลูกค้า และฟอร์มติดต่อ ธีมสีน้ำเงิน")
    site_name = st.text_input("ชื่อโปรเจกต์", value="my-website")
    if not api_key:
        st.warning("ใส่ Anthropic API key ที่แถบด้านซ้ายเพื่อใช้ฟีเจอร์นี้", icon=":material/key:")
    if st.button("สร้าง HTML", icon=":material/auto_awesome:", type="primary", width="stretch",
                 disabled=not (api_key and description.strip())):
        with st.status("ทีม AI กำลังเขียนเว็บไซต์", expanded=True) as status:
            try:
                from zipforge.ai import generate_from_prompt

                progress = st.empty()
                prompt_name = hosting.normalize_slug(site_name) or "my-website"
                say("developer", "กำลังเขียนเว็บไซต์จากคำอธิบาย")
                dev_task = agents.add_task("developer", f"เขียนเว็บ {prompt_name}")
                try:
                    html = generate_from_prompt(
                        api_key, description, effort,
                        on_progress=lambda n: progress.caption(f"เขียนโค้ดแล้ว {n:,} ตัวอักษร"))
                finally:
                    agents.set_status(dev_task, "done")
                agents.log_done("qa", f"ตรวจสอบ {prompt_name}")
                agents.submit_for_approval(prompt_name, html)
                state["prompt_result"] = {"html": html, "name": site_name}
                status.update(label="สร้าง HTML สำเร็จ", state="complete", expanded=False)
            except Exception as exc:  # noqa: BLE001
                status.update(label="สร้างไม่สำเร็จ", state="error")
                st.error(f"{type(exc).__name__}: {exc}", icon=":material/error:")
    if state.get("prompt_result"):
        res = state["prompt_result"]
        show_result(res["html"], hosting.normalize_slug(res["name"]) or "my-website", "prompt")


# ============================================================================= tab: my sites
def manage_site(site: hosting.Site, owner_key: str) -> None:
    with st.expander(f"**{site.title}** · `{site.slug}` · {hosting.ACCESS_LEVELS[site.access]} · "
                     f"เข้าชม {site.views:,} ครั้ง", icon=ACCESS_ICONS[site.access]):
        st.code(site_url(site.slug), language=None)
        with st.container(horizontal=True):
            st.link_button("เปิดเว็บไซต์", site_url(site.slug), icon=":material/open_in_new:")
            st.download_button("ดาวน์โหลด HTML", hosting.read_html(site), f"{site.slug}.html", "text/html",
                               icon=":material/download:", key=f"dl-{site.slug}")
        st.caption(f"สร้างเมื่อ {datetime.fromtimestamp(site.created):%d/%m/%Y %H:%M} · "
                   f"แก้ไขล่าสุด {datetime.fromtimestamp(site.updated):%d/%m/%Y %H:%M}")

        st.markdown("**สิทธิ์การเข้าถึง**")
        access, password, emails = access_inputs(f"m-{site.slug}", site)
        if st.button("บันทึกสิทธิ์", icon=":material/save:", key=f"save-{site.slug}"):
            try:
                hosting.update_access(site, access, password, emails)
                st.toast("บันทึกสิทธิ์แล้ว", icon=":material/check_circle:")
                st.rerun()
            except hosting.HostingError as exc:
                st.error(str(exc), icon=":material/error:")

        st.markdown("**อัปเดตเนื้อหา**")
        new_file = st.file_uploader("อัปโหลดไฟล์ HTML ใหม่แทนของเดิม", type=["html", "htm"], key=f"up-{site.slug}")
        if new_file and st.button("อัปเดตเว็บไซต์", icon=":material/sync:", key=f"upd-{site.slug}"):
            hosting.update_html(site, new_file.getvalue().decode("utf-8", errors="replace"))
            st.toast("อัปเดตเว็บไซต์แล้ว", icon=":material/check_circle:")

        st.markdown("**ลบเว็บไซต์**")
        confirm = st.checkbox("ยืนยันว่าต้องการลบถาวร", key=f"cf-{site.slug}")
        if st.button("ลบเว็บไซต์นี้", icon=":material/delete:", key=f"del-{site.slug}", disabled=not confirm):
            hosting.delete(site)
            state.owner_keys.pop(site.slug, None)
            st.rerun()


with tab_sites:
    st.markdown("จัดการเว็บไซต์ที่คุณเผยแพร่ เปลี่ยนสิทธิ์ผู้เข้าชม อัปเดตเนื้อหา หรือลบ")

    mine = [(hosting.get(s), k) for s, k in state.owner_keys.items()]
    mine = [(s, k) for s, k in mine if s and hosting.is_owner(s, k)]
    if mine:
        for site, key in mine:
            manage_site(site, key)
    else:
        st.caption("ยังไม่มีเว็บไซต์ในเซสชันนี้ สร้างเว็บแล้วกด **เผยแพร่ตอนนี้** "
                   "หรือเปิดเว็บเดิมด้วยคีย์เจ้าของด้านล่าง")

    with st.form("claim"):
        st.markdown(":material/key: **เปิดจัดการเว็บด้วยคีย์เจ้าของ**")
        with st.container(horizontal=True, vertical_alignment="bottom"):
            claim_slug = st.text_input("ชื่อลิงก์ของเว็บ")
            claim_key = st.text_input("คีย์เจ้าของ", type="password")
            submitted = st.form_submit_button("เปิดจัดการ", icon=":material/login:")
        if submitted:
            site = hosting.get(hosting.normalize_slug(claim_slug))
            if site and hosting.is_owner(site, claim_key):
                state.owner_keys[site.slug] = claim_key
                st.rerun()
            else:
                st.error("ชื่อลิงก์หรือคีย์ไม่ถูกต้อง", icon=":material/error:")

    admin_pw = secret("ZIPFORGE_ADMIN_PASSWORD")
    if admin_pw:
        with st.expander("ผู้ดูแลบริษัท: ดูเว็บไซต์ทั้งหมด", icon=":material/admin_panel_settings:"):
            if st.text_input("รหัสผู้ดูแล", type="password", key="admin") == admin_pw:
                sites = hosting.list_sites()
                st.metric("เว็บไซต์ทั้งหมด", len(sites))
                st.dataframe([{"ชื่อ": s.title, "ลิงก์": site_url(s.slug), "สิทธิ์": hosting.ACCESS_LEVELS[s.access],
                               "เข้าชม": s.views, "อัปเดต": datetime.fromtimestamp(s.updated)} for s in sites],
                             column_config={"ลิงก์": st.column_config.LinkColumn()}, width="stretch")


# ============================================================================= tab: office (rendered last so it reflects work done in this run)
with tab_office:
    team = agents.agent_states()
    st.iframe("data:text/html;charset=utf-8;base64," +
              base64.b64encode(render_office(team).encode()).decode(), height=620,
              alt="ออฟฟิศ 3D ของทีม AI แสดงสถานะการทำงานของแต่ละคน")
    st.caption(":material/touch_app: ลากเพื่อหมุน · เลื่อนเพื่อซูม · คลิกที่ตัวละครเพื่อดูว่ากำลังทำอะไร")

    left, right = st.columns([3, 2], gap="large")
    with left:
        st.subheader("รายงานจากเลขา", icon=":material/assignment:", help="สรุปงาน 24 ชั่วโมงล่าสุด")
        rep = agents.daily_report()
        with st.container(horizontal=True):
            st.metric("งานที่เสร็จ", rep["tasks_today"], border=True)
            st.metric("เว็บที่สร้าง", rep["builds_today"], border=True)
            st.metric("เผยแพร่ใหม่", rep["published_today"], border=True)
            st.metric("ผู้เข้าชมรวม", f"{rep['views']:,}", border=True)
        busy = [a for a in team if a["status"] != "idle"]
        summary = f"วันนี้ทีมทำงานเสร็จ {rep['tasks_today']} งาน มีเว็บออนไลน์ทั้งหมด {rep['sites']} เว็บ"
        summary += f" และมี **{rep['waiting']} งานรออนุมัติ** จากคุณ" if rep["waiting"] else " ไม่มีงานค้างอนุมัติ"
        st.info(summary + ("" if busy else " ตอนนี้ทุกคนว่าง พร้อมรับงานใหม่ค่ะ"),
                icon=":material/chat:", title="มิว (เลขา)")

        st.subheader("ทีม", icon=":material/groups:")
        for a in team:
            label, _ = agents.STATUS[a["status"]]
            st.markdown(f"{AGENT_ICONS[a['id']]} **{a['name']}** · {a['role']} "
                        f":{STATUS_BADGE[a['status']]}-badge[{label}]  \n:gray[{a['task']}]")

    with right:
        st.subheader("กล่องอนุมัติ", icon=":material/inbox:")
        items = agents.inbox()
        if not items:
            st.caption(":material/done_all: ไม่มีงานรออนุมัติ")
        for t in reversed(items):
            with st.container(border=True):
                title = t["title"].split(": ", 1)[-1]
                st.markdown(f"**{title}**  \n:gray[ส่งเมื่อ {datetime.fromtimestamp(t['created']):%d/%m %H:%M}]")
                html_doc = agents.pending_html(t["id"])
                with st.container(horizontal=True):
                    if st.button("อนุมัติและเผยแพร่", icon=":material/check:", key=f"ap-{t['id']}", type="primary",
                                 disabled=html_doc is None):
                        site, owner_key = hosting.publish(html_doc, title, title, "public")
                        state.owner_keys[site.slug] = owner_key
                        agents.resolve(t["id"], True)
                        agents.log_done("devops", f"เผยแพร่ {site.slug} (สาธารณะ)")
                        state["approved_msg"] = (site_url(site.slug), owner_key)
                        st.rerun()
                    if st.button("ปฏิเสธ", icon=":material/close:", key=f"rj-{t['id']}"):
                        agents.resolve(t["id"], False)
                        st.rerun()
        if state.get("approved_msg"):
            url, owner_key = state["approved_msg"]
            st.success(url, icon=":material/check_circle:", title="เผยแพร่แล้ว (สาธารณะ)")
            st.markdown(":material/key: คีย์เจ้าของ เปลี่ยนสิทธิ์ได้ที่แท็บเว็บไซต์ของฉัน")
            st.code(owner_key, language=None)
        st.caption("งานที่สร้างเสร็จจะมารอที่นี่ อนุมัติแล้วจะเผยแพร่แบบสาธารณะทันที "
                   "หรือเลือกสิทธิ์อื่นได้จากปุ่มเผยแพร่ใต้ผลงาน")
