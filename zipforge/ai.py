"""AI builder: Claude reads the project and writes a single-file web app."""

from __future__ import annotations

import re
from typing import Callable

import anthropic

from .analyze import IMAGE_EXT, Analysis, ext
from .extract import Project

MODEL = "claude-opus-5-5"
CONTEXT_CHAR_BUDGET = 400_000
PER_FILE_CHAR_LIMIT = 60_000

SYSTEM_PROMPT = """You are the senior engineering team of ZipForge AI, a company that turns a customer's \
uploaded project files into a polished, working web app.

You receive the full file listing and the contents of the customer's ZIP. Produce ONE self-contained \
HTML file that delivers the project as a working web app in the browser:
- If it is already a website, reproduce and improve it as a single page that keeps all features.
- If it is source code for another stack (Python, Streamlit, Flask, React source, etc.), re-implement \
its user-facing behavior in HTML/CSS/JavaScript that runs entirely in the browser.
- If it is data, build an interactive app (search, filter, charts) with the data embedded as JSON.
- If it is documents or images, build a navigable site around them.

Rules:
- Output only the HTML file in one ```html fenced block. No explanations before or after it.
- Inline all CSS and JS. External libraries are allowed only from https://cdn.jsdelivr.net or \
https://cdnjs.cloudflare.com with exact pinned versions.
- Embed the customer's real data and text; never invent placeholder content when real content exists.
- Binary images are not included in the context; reference them by their relative path from the ZIP \
(the host keeps the original files next to index.html under source/), e.g. "source/img/logo.png".
- Responsive design that works on phones, with a clean modern look and light/dark support.
- Match the language of the customer's content in the UI (Thai content -> Thai UI)."""


def build_context(project: Project, analysis: Analysis) -> str:
    lines = [
        f"Project name: {project.name}",
        f"Detected type: {analysis.kind}" + (f" / framework: {analysis.framework}" if analysis.framework else ""),
        "",
        "## File listing",
    ]
    lines += [f"- {p} ({len(d):,} bytes)" for p, d in sorted(project.files.items())]
    lines.append("\n## File contents")

    budget = CONTEXT_CHAR_BUDGET
    skipped = []
    # small files first so the most files fit
    for path, data in sorted(project.files.items(), key=lambda kv: len(kv[1])):
        if ext(path) in IMAGE_EXT and ext(path) != ".svg":
            continue
        text = project.text(path)
        if text is None:
            skipped.append(path)
            continue
        if len(text) > PER_FILE_CHAR_LIMIT:
            text = text[:PER_FILE_CHAR_LIMIT] + "\n... [file truncated by ZipForge: too long] ..."
        if len(text) > budget:
            skipped.append(path)
            continue
        budget -= len(text)
        lines.append(f"\n### {path}\n```\n{text}\n```")
    if skipped:
        lines.append("\n## Files not included (binary or over budget)\n" + "\n".join(f"- {p}" for p in skipped))
    return "\n".join(lines)


def extract_html(text: str) -> str | None:
    m = re.search(r"```html\s*\n(.*?)```", text, re.S | re.I)
    if m:
        return m.group(1).strip()
    m = re.search(r"(<!doctype html.*?</html>)", text, re.S | re.I)
    return m.group(1).strip() if m else None


PROMPT_SYSTEM = """You are the senior web team of ZipForge AI. The customer describes a website or web \
app in their own words; you build it as ONE complete, self-contained HTML file.

Rules:
- Output only the HTML file in one ```html fenced block. No explanations before or after it.
- Inline all CSS and JS. External libraries are allowed only from https://cdn.jsdelivr.net or \
https://cdnjs.cloudflare.com with exact pinned versions.
- Make it fully working, not a mockup: real interactions, sensible sample content where the customer \
gave none, and no broken links or placeholder buttons.
- Responsive design that works on phones, with a clean modern look and light/dark support.
- Write the UI in the language the customer wrote in (Thai request -> Thai UI)."""


def _run(api_key: str, system: str, user: str, effort: str,
         on_progress: Callable[[int], None] | None) -> str:
    client = anthropic.Anthropic(api_key=api_key)
    with client.beta.messages.stream(
        model=MODEL,
        max_tokens=64000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": effort},
        system=system,
        messages=[{"role": "user", "content": user}],
    ) as stream:
        chars = 0
        for chunk in stream.text_stream:
            chars += len(chunk)
            if on_progress:
                on_progress(chars)
        message = stream.get_final_message()

    if message.stop_reason == "refusal":
        raise RuntimeError("AI ปฏิเสธคำขอนี้ — ลองปรับคำสั่งหรือเนื้อหาในไฟล์")
    text = "".join(b.text for b in message.content if b.type == "text")
    html = extract_html(text)
    if not html:
        if message.stop_reason == "max_tokens":
            raise RuntimeError("ผลลัพธ์ยาวเกินขีดจำกัด — ลองลดขนาดโปรเจกต์หรือขอให้ AI ทำแอปให้กระชับขึ้น")
        raise RuntimeError("AI ไม่ได้ส่งไฟล์ HTML กลับมา กรุณาลองใหม่")
    return html


def generate_app(
    api_key: str,
    project: Project,
    analysis: Analysis,
    instructions: str = "",
    effort: str = "high",
    on_progress: Callable[[int], None] | None = None,
) -> str:
    """Build a web app from the files of an uploaded ZIP."""
    user = build_context(project, analysis)
    user += "\n\n## Customer request\n" + (instructions.strip() or "Build the best possible web app from these files.")
    return _run(api_key, SYSTEM_PROMPT, user, effort, on_progress)


def generate_from_prompt(
    api_key: str,
    description: str,
    effort: str = "high",
    on_progress: Callable[[int], None] | None = None,
) -> str:
    """Build a website from a plain-language description."""
    return _run(api_key, PROMPT_SYSTEM, description.strip(), effort, on_progress)
