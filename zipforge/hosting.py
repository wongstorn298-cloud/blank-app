"""Publish generated HTML as real web pages served by this app, with per-site access control."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

DATA_DIR = Path(os.environ.get("ZIPFORGE_DATA_DIR", Path(__file__).resolve().parent.parent / "data" / "sites"))
SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$")
MAX_SITE_BYTES = 15 * 1024 * 1024

ACCESS_LEVELS = {
    "public": "🌍 สาธารณะ — ทุกคนที่มีลิงก์",
    "password": "🔑 ต้องใส่รหัสผ่าน",
    "emails": "📧 เฉพาะอีเมลที่กำหนด (ต้องล็อกอิน)",
    "private": "🔒 ส่วนตัว — เฉพาะเจ้าของ",
}


class HostingError(Exception):
    pass


@dataclass
class Site:
    slug: str
    title: str
    access: str
    owner_key_hash: str
    created: float
    updated: float
    password_hash: str = ""
    emails: list[str] = field(default_factory=list)
    views: int = 0


# ----------------------------------------------------------------------------- hashing

def _hash(secret: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", secret.encode(), salt, 200_000)
    return f"{salt.hex()}${digest.hex()}"


def _verify(secret: str, stored: str) -> bool:
    if not stored or "$" not in stored:
        return False
    salt_hex, _ = stored.split("$", 1)
    return hmac.compare_digest(_hash(secret, bytes.fromhex(salt_hex)), stored)


# ----------------------------------------------------------------------------- storage

def _dir(slug: str) -> Path:
    if not SLUG_RE.match(slug):
        raise HostingError("ชื่อเว็บไม่ถูกต้อง")
    return DATA_DIR / slug


def _write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def _save(site: Site) -> None:
    _write_json(_dir(site.slug) / "site.json", asdict(site))


def normalize_slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9-]+", "-", text.lower()).strip("-")
    return re.sub(r"-{2,}", "-", slug)[:40].strip("-")


def parse_emails(text: str) -> list[str]:
    emails = sorted({e.strip().lower() for e in re.split(r"[,\s;]+", text) if e.strip()})
    bad = [e for e in emails if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", e)]
    if bad:
        raise HostingError(f"อีเมลไม่ถูกต้อง: {', '.join(bad)}")
    return emails


def _validate_access(access: str, password: str, emails: list[str], had_password: bool = False) -> None:
    if access not in ACCESS_LEVELS:
        raise HostingError("ระดับการเข้าถึงไม่ถูกต้อง")
    if access == "password" and len(password) < 4 and not had_password:
        raise HostingError("รหัสผ่านต้องยาวอย่างน้อย 4 ตัวอักษร")
    if access == "emails" and not emails:
        raise HostingError("กรุณาใส่อีเมลอย่างน้อย 1 รายการ")


def publish(html: str, title: str, slug: str, access: str,
            password: str = "", emails: list[str] | None = None) -> tuple[Site, str]:
    """Create a new site. Returns (site, owner_key) — the key is shown to the owner once."""
    emails = emails or []
    slug = normalize_slug(slug or title) or "site"
    if not SLUG_RE.match(slug):
        slug = f"site-{secrets.token_hex(3)}"
    if (DATA_DIR / slug).exists():
        slug = f"{slug[:33]}-{secrets.token_hex(3)}"
    if len(html.encode()) > MAX_SITE_BYTES:
        raise HostingError("ไฟล์ HTML ใหญ่เกิน 15 MB")
    _validate_access(access, password, emails)

    owner_key = secrets.token_urlsafe(18)
    now = time.time()
    site = Site(slug=slug, title=title.strip() or slug, access=access, owner_key_hash=_hash(owner_key),
                created=now, updated=now, emails=emails,
                password_hash=_hash(password) if access == "password" else "")
    _dir(slug).mkdir(parents=True, exist_ok=False)
    (_dir(slug) / "index.html").write_text(html, encoding="utf-8")
    _save(site)
    return site, owner_key


def get(slug: str) -> Site | None:
    try:
        path = _dir(slug) / "site.json"
    except HostingError:
        return None
    if not path.exists():
        return None
    return Site(**json.loads(path.read_text(encoding="utf-8")))


def read_html(site: Site) -> str:
    return (_dir(site.slug) / "index.html").read_text(encoding="utf-8")


def list_sites() -> list[Site]:
    if not DATA_DIR.exists():
        return []
    sites = [get(p.name) for p in DATA_DIR.iterdir() if p.is_dir()]
    return sorted((s for s in sites if s), key=lambda s: s.updated, reverse=True)


def is_owner(site: Site, owner_key: str) -> bool:
    return _verify(owner_key, site.owner_key_hash)


def check_password(site: Site, password: str) -> bool:
    return site.access == "password" and _verify(password, site.password_hash)


def email_allowed(site: Site, email: str | None) -> bool:
    return bool(email) and email.lower() in site.emails


def update_access(site: Site, access: str, password: str = "", emails: list[str] | None = None) -> Site:
    emails = emails or []
    _validate_access(access, password, emails, had_password=bool(site.password_hash))
    site.access = access
    site.emails = emails
    if access == "password" and password:
        site.password_hash = _hash(password)
    elif access != "password":
        site.password_hash = ""
    site.updated = time.time()
    _save(site)
    return site


def update_html(site: Site, html: str) -> None:
    if len(html.encode()) > MAX_SITE_BYTES:
        raise HostingError("ไฟล์ HTML ใหญ่เกิน 15 MB")
    (_dir(site.slug) / "index.html").write_text(html, encoding="utf-8")
    site.updated = time.time()
    _save(site)


def record_view(site: Site) -> None:
    site.views += 1
    _save(site)


def delete(site: Site) -> None:
    shutil.rmtree(_dir(site.slug), ignore_errors=True)
