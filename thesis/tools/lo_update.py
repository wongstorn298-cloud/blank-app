#!/usr/bin/env python3
"""ใช้ LibreOffice (UNO) เปิดไฟล์ .docx ปรับปรุงสารบัญ/สารบัญตาราง/สารบัญรูป แล้วคืนรายการพร้อมเลขหน้า

ใช้: python3 lo_update.py <in.docx> [--pdf out.pdf]
พิมพ์ JSON: [{"name": ..., "lines": ["ข้อความ\\tเลขหน้า", ...]}, ...] ตามลำดับสารบัญในเอกสาร
ไม่แก้ไฟล์ .docx ต้นฉบับ (ปิดโดยไม่บันทึก)
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

import uno  # noqa: E402  (มากับ LibreOffice)
from com.sun.star.beans import PropertyValue  # noqa: E402


def _prop(name, value):
    p = PropertyValue()
    p.Name = name
    p.Value = value
    return p


def run(docx_path, pdf_path=None):
    profile = tempfile.mkdtemp(prefix="lo-thesis-")
    pipe = "thesis_build_%d" % os.getpid()
    proc = subprocess.Popen(
        ["soffice", "--headless", "--invisible", "--nologo", "--norestore", "--nodefault",
         "-env:UserInstallation=" + uno.systemPathToFileUrl(profile),
         "--accept=pipe,name=%s;urp;StarOffice.ComponentContext" % pipe],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext(
            "com.sun.star.bridge.UnoUrlResolver", local)
        ctx = None
        for _ in range(120):
            try:
                ctx = resolver.resolve("uno:pipe,name=%s;urp;StarOffice.ComponentContext" % pipe)
                break
            except Exception:
                time.sleep(0.5)
        if ctx is None:
            raise RuntimeError("เชื่อมต่อ LibreOffice ไม่ได้")
        desktop = ctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
        url = uno.systemPathToFileUrl(os.path.abspath(docx_path))
        doc = desktop.loadComponentFromURL(url, "_blank", 0, (_prop("Hidden", True),))
        idxs = doc.getDocumentIndexes()
        # ปรับปรุง 2 รอบ เพราะความยาวสารบัญมีผลต่อเลขหน้าส่วนหน้า
        for _ in range(2):
            for i in range(idxs.getCount()):
                idxs.getByIndex(i).update()
        result = []
        for i in range(idxs.getCount()):
            ix = idxs.getByIndex(i)
            text = ix.getAnchor().getString()
            lines = [ln for ln in text.replace("\r", "\n").split("\n") if ln.strip()]
            result.append({"name": ix.getName(), "lines": lines})
        if pdf_path:
            doc.storeToURL(uno.systemPathToFileUrl(os.path.abspath(pdf_path)),
                           (_prop("FilterName", "writer_pdf_Export"),))
        doc.close(True)
        try:
            desktop.terminate()
        except Exception:
            pass
        return result
    finally:
        try:
            proc.wait(timeout=30)
        except Exception:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    args = sys.argv[1:]
    pdf = None
    if "--pdf" in args:
        k = args.index("--pdf")
        pdf = args[k + 1]
        del args[k:k + 2]
    print(json.dumps(run(args[0], pdf), ensure_ascii=False))
