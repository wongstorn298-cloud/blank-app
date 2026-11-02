"""Safe, in-memory ZIP extraction."""

from __future__ import annotations

import io
import posixpath
import zipfile
from dataclasses import dataclass, field

MAX_TOTAL_BYTES = 200 * 1024 * 1024  # uncompressed limit (zip-bomb guard)
MAX_FILES = 2000
IGNORED_PARTS = {"__MACOSX", ".git", "node_modules", "__pycache__", ".venv", "venv", ".DS_Store"}


class ZipError(Exception):
    pass


@dataclass
class Project:
    name: str
    files: dict[str, bytes] = field(default_factory=dict)

    def text(self, path: str) -> str | None:
        data = self.files.get(path)
        if data is None:
            return None
        try:
            return data.decode("utf-8")
        except UnicodeDecodeError:
            return None


def _clean_path(raw: str) -> str | None:
    path = raw.replace("\\", "/")
    if path.endswith("/"):
        return None
    norm = posixpath.normpath(path).lstrip("/")
    if norm.startswith("..") or norm in ("", "."):
        return None
    parts = norm.split("/")
    if any(p in IGNORED_PARTS for p in parts):
        return None
    return norm


def _strip_common_root(files: dict[str, bytes]) -> dict[str, bytes]:
    """If every file lives under one top folder (common when zipping a folder), drop it."""
    tops = {p.split("/", 1)[0] for p in files}
    if len(tops) == 1 and all("/" in p for p in files):
        return {p.split("/", 1)[1]: d for p, d in files.items()}
    return files


def load_zip(data: bytes, name: str = "project.zip") -> Project:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ZipError("ไฟล์นี้ไม่ใช่ ZIP ที่ถูกต้อง") from exc

    infos = [i for i in zf.infolist() if not i.is_dir()]
    if len(infos) > MAX_FILES:
        raise ZipError(f"ZIP มีไฟล์มากเกินไป ({len(infos)} > {MAX_FILES})")
    if sum(i.file_size for i in infos) > MAX_TOTAL_BYTES:
        raise ZipError("ขนาดไฟล์หลังแตก ZIP ใหญ่เกิน 200 MB")

    files: dict[str, bytes] = {}
    for info in infos:
        path = _clean_path(info.filename)
        if path:
            files[path] = zf.read(info)
    if not files:
        raise ZipError("ไม่พบไฟล์ที่ใช้งานได้ใน ZIP")

    base = name.rsplit("/", 1)[-1]
    if base.lower().endswith(".zip"):
        base = base[:-4]
    return Project(name=base or "project", files=_strip_common_root(files))
