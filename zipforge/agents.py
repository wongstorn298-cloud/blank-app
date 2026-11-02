"""The AI team: who they are, what they are working on, and the owner's approval inbox."""

from __future__ import annotations

import json
import os
import secrets
import threading
import time
from pathlib import Path

from . import hosting

AGENTS = [
    {"id": "secretary", "name": "มิว", "role": "เลขา", "emoji": "📋", "color": "#f06292",
     "desc": "สรุปรายงานประจำวันและดูแลกล่องอนุมัติของเจ้าของบริษัท"},
    {"id": "analyst", "name": "ต้น", "role": "Analyst", "emoji": "🕵️", "color": "#42a5f5",
     "desc": "แตกไฟล์ ZIP วิเคราะห์ชนิดโปรเจกต์และเฟรมเวิร์ก"},
    {"id": "architect", "name": "ฝน", "role": "Architect", "emoji": "📐", "color": "#ab47bc",
     "desc": "วางแผนโครงสร้างเว็บแอปที่เหมาะกับงาน"},
    {"id": "developer", "name": "บีม", "role": "Developer", "emoji": "👩‍💻", "color": "#26a69a",
     "desc": "เขียนและประกอบโค้ด HTML/CSS/JS"},
    {"id": "qa", "name": "แพร", "role": "QA", "emoji": "✅", "color": "#ffa726",
     "desc": "ตรวจสอบคุณภาพก่อนส่งมอบ"},
    {"id": "devops", "name": "โอ๊ต", "role": "DevOps", "emoji": "🚀", "color": "#ef5350",
     "desc": "นำเว็บขึ้นออนไลน์และดูแลสิทธิ์การเข้าถึง"},
]
AGENT_BY_ID = {a["id"]: a for a in AGENTS}

STATUS = {
    "new": ("งานใหม่", "#5c6bc0"),
    "working": ("กำลังทำ", "#ec407a"),
    "review": ("รออนุมัติ", "#ffb300"),
    "idle": ("ว่าง", "#9e9e9e"),
}

MAX_TASKS = 300
_lock = threading.Lock()


def _root() -> Path:
    return hosting.DATA_DIR.parent


def _path() -> Path:
    return _root() / "office.json"


def _pending_dir() -> Path:
    return _root() / "pending"


def _load() -> list[dict]:
    try:
        return json.loads(_path().read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _save(tasks: list[dict]) -> None:
    _root().mkdir(parents=True, exist_ok=True)
    tmp = _path().with_suffix(".tmp")
    tmp.write_text(json.dumps(tasks[-MAX_TASKS:], ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, _path())


# ----------------------------------------------------------------------------- tasks

def add_task(agent: str, title: str, status: str = "working") -> str:
    task = {"id": secrets.token_hex(6), "agent": agent, "title": title, "status": status,
            "created": time.time(), "updated": time.time()}
    with _lock:
        tasks = _load()
        tasks.append(task)
        _save(tasks)
    return task["id"]


def set_status(task_id: str, status: str) -> None:
    with _lock:
        tasks = _load()
        for t in tasks:
            if t["id"] == task_id:
                t["status"] = status
                t["updated"] = time.time()
        _save(tasks)


def log_done(agent: str, title: str) -> None:
    add_task(agent, title, "done")


def tasks() -> list[dict]:
    return _load()


def agent_states() -> list[dict]:
    """Each agent with its current status/task, derived from the open tasks."""
    all_tasks = _load()
    out = []
    priority = {"working": 0, "review": 1, "new": 2}
    for agent in AGENTS:
        mine = [t for t in all_tasks if t["agent"] == agent["id"]]
        open_tasks = sorted((t for t in mine if t["status"] in priority),
                            key=lambda t: (priority[t["status"]], -t["updated"]))
        last_done = next((t for t in reversed(mine) if t["status"] == "done"), None)
        if open_tasks:
            status, task = open_tasks[0]["status"], open_tasks[0]["title"]
        else:
            status = "idle"
            task = f"ล่าสุด: {last_done['title']}" if last_done else "รอรับงานใหม่"
        out.append({**agent, "status": status, "task": task,
                    "done": sum(1 for t in mine if t["status"] == "done")})
    return out


# ----------------------------------------------------------------------------- approval inbox

def submit_for_approval(title: str, html: str) -> str:
    """QA hands a finished site to the owner; it waits in the inbox until approved or rejected."""
    task_id = add_task("devops", f"รออนุมัติเผยแพร่: {title}", "review")
    _pending_dir().mkdir(parents=True, exist_ok=True)
    (_pending_dir() / f"{task_id}.html").write_text(html, encoding="utf-8")
    return task_id


def inbox() -> list[dict]:
    return [t for t in _load() if t["status"] == "review"]


def pending_html(task_id: str) -> str | None:
    path = _pending_dir() / f"{task_id}.html"
    return path.read_text(encoding="utf-8") if path.exists() else None


def resolve(task_id: str, approved: bool) -> None:
    set_status(task_id, "done" if approved else "rejected")
    (_pending_dir() / f"{task_id}.html").unlink(missing_ok=True)


def resolve_by_title(title: str) -> None:
    """Publishing straight from the result page also clears that site's inbox item."""
    for t in inbox():
        if t["title"] == f"รออนุมัติเผยแพร่: {title}":
            resolve(t["id"], True)


# ----------------------------------------------------------------------------- secretary report

def daily_report() -> dict:
    start = time.time() - 24 * 3600
    recent = [t for t in _load() if t["updated"] >= start]
    sites = hosting.list_sites()
    return {
        "tasks_today": sum(1 for t in recent if t["status"] == "done"),
        "builds_today": sum(1 for t in recent if t["agent"] == "developer" and t["status"] == "done"),
        "published_today": sum(1 for s in sites if s.created >= start),
        "sites": len(sites),
        "views": sum(s.views for s in sites),
        "waiting": len(inbox()),
    }
