# 🏭 ZipForge AI

บริษัท AI ที่เปลี่ยน **ไฟล์ ZIP หรือคำอธิบายของคุณให้เป็นเว็บไซต์จริง** — สร้าง HTML, ดูตัวอย่างสด, กดเผยแพร่ได้ลิงก์ทันที และ **กำหนดได้ว่าใครเข้าถึงได้บ้าง**

## ทำอะไรได้บ้าง

| สิ่งที่อยู่ใน ZIP | เว็บแอปที่ได้ (โหมดอัตโนมัติ — ฟรี ไม่ต้องใช้ API key) |
|---|---|
| เว็บไซต์ HTML/CSS/JS | รวมทุกอย่าง (CSS, JS, รูปภาพ) เป็นไฟล์ `index.html` ไฟล์เดียว |
| CSV / Excel / JSON | แดชบอร์ดข้อมูล: ตารางค้นหา/เรียงได้ สถิติ และกราฟ |
| Markdown / ข้อความ | เว็บไซต์เอกสาร พร้อมเมนูนำทางและค้นหา |
| รูปภาพ | เว็บแกลเลอรี พร้อมดูภาพขนาดใหญ่ |
| ซอร์สโค้ดอื่น ๆ | เว็บเบราว์เซอร์ซอร์สโค้ด |

**โหมด AI (Claude):** ทีม AI อ่านไฟล์ทั้งหมดในโปรเจกต์แล้วเขียนเว็บแอปใหม่ที่ทำงานได้จริงในเบราว์เซอร์
— เช่น แปลงแอป Python/Streamlit/React source เป็นเว็บแอปไฟล์เดียว และรับคำสั่งเพิ่มเติมได้ ("ทำธีมสีเขียว มีปุ่มส่งออก CSV")

**✨ สร้าง HTML ด้วย AI:** ไม่มีไฟล์ก็ได้ — พิมพ์บอกว่าอยากได้เว็บแบบไหน AI จะเขียน HTML ทั้งหน้าให้

## 🌐 เผยแพร่เป็นเว็บไซต์จริง + กำหนดสิทธิ์

หลังสร้างเว็บเสร็จ กด **🌐 เผยแพร่ตอนนี้** จะได้ลิงก์ `https://<แอปของคุณ>/?site=<ชื่อลิงก์>` และ **คีย์เจ้าของ**
(ใช้จัดการเว็บในแท็บ "🌐 เว็บไซต์ของฉัน" — เก็บไว้ให้ดี แสดงครั้งเดียว)

| ระดับการเข้าถึง | ใครเปิดได้ |
|---|---|
| 🌍 สาธารณะ | ทุกคนที่มีลิงก์ |
| 🔑 รหัสผ่าน | ผู้ที่รู้รหัสผ่าน (เก็บแบบแฮช PBKDF2) |
| 📧 เฉพาะอีเมล | ผู้ที่ล็อกอินด้วยอีเมลที่อยู่ในรายชื่อ (ต้องตั้งค่า `[auth]` ด้านล่าง) |
| 🔒 ส่วนตัว | เฉพาะผู้ที่มีคีย์เจ้าของ |

เปลี่ยนสิทธิ์ อัปเดตเนื้อหา ดูจำนวนผู้เข้าชม หรือลบเว็บได้ตลอดในแท็บ "🌐 เว็บไซต์ของฉัน"
HTML ของเว็บจะถูกส่งให้ผู้ชมหลังผ่านการตรวจสิทธิ์แล้วเท่านั้น

## 🚀 นำบริษัทขึ้นออนไลน์ (Streamlit Community Cloud — ฟรี)

1. push repo นี้ขึ้น GitHub
2. ไปที่ [share.streamlit.io](https://share.streamlit.io) → **Create app** → เลือก repo, branch และไฟล์ `streamlit_app.py`
3. ตั้งค่า **Settings → Secrets**:
   ```toml
   ANTHROPIC_API_KEY = "sk-ant-..."          # สำหรับโหมด AI
   ZIPFORGE_PUBLIC_URL = "https://your-app.streamlit.app"  # ใช้สร้างลิงก์เว็บที่เผยแพร่
   ZIPFORGE_ADMIN_PASSWORD = "..."           # (ไม่บังคับ) ให้ผู้ดูแลบริษัทเห็นเว็บทั้งหมด

   # (ไม่บังคับ) เปิดใช้ "เฉพาะอีเมล" ด้วย Google Login
   [auth]
   redirect_uri = "https://your-app.streamlit.app/oauth2callback"
   cookie_secret = "สุ่มข้อความยาว ๆ"
   client_id = "xxxx.apps.googleusercontent.com"
   client_secret = "xxxx"
   server_metadata_url = "https://accounts.google.com/.well-known/openid-configuration"
   ```
   (สร้าง client id/secret ได้ที่ Google Cloud Console → APIs & Services → Credentials → OAuth client ID แบบ Web application)

> ⚠️ เว็บที่เผยแพร่ถูกเก็บในโฟลเดอร์ `data/sites` (ตั้งที่อยู่ใหม่ได้ด้วย `ZIPFORGE_DATA_DIR`)
> บน Streamlit Community Cloud ดิสก์จะถูกล้างเมื่อแอปรีสตาร์ต — ถ้าต้องการเก็บถาวร ให้รันบนเซิร์ฟเวอร์ที่มีดิสก์ถาวร
> (เช่น VPS, Render/Railway พร้อม volume) และชี้ `ZIPFORGE_DATA_DIR` ไปที่ดิสก์นั้น

## วิธีใช้งาน

```bash
pip install -r requirements.txt
streamlit run streamlit_app.py
```

1. อัปโหลดไฟล์ `.zip` (หรือกด "ดาวน์โหลด ZIP ตัวอย่าง" ที่แถบซ้ายเพื่อทดลอง)
2. ดูรายงานการวิเคราะห์ แล้วเลือกโหมด **อัตโนมัติ** หรือ **AI**
3. กด **🚀 สร้างเว็บแอป** → ดูตัวอย่างสด → ดาวน์โหลด `index.html` หรือชุด `.zip` พร้อมขึ้นโฮสต์
4. เผยแพร่ฟรีด้วย [Netlify Drop](https://app.netlify.com/drop) หรือ GitHub Pages

### ตั้งค่า API key สำหรับโหมด AI

ใส่ในช่องที่แถบซ้าย หรือตั้งค่าแบบถาวร:

- ตัวแปรสภาพแวดล้อม `ANTHROPIC_API_KEY`, หรือ
- `.streamlit/secrets.toml` (บน Streamlit Community Cloud: Settings → Secrets):
  ```toml
  ANTHROPIC_API_KEY = "sk-ant-..."
  ```

## โครงสร้างโค้ด

- `streamlit_app.py` — หน้าเว็บของบริษัท (อัปโหลด, วิเคราะห์, สร้าง, ดูตัวอย่าง, ดาวน์โหลด)
- `zipforge/extract.py` — แตก ZIP อย่างปลอดภัยในหน่วยความจำ (กัน path traversal / zip bomb)
- `zipforge/analyze.py` — ตรวจชนิดโปรเจกต์และเฟรมเวิร์ก
- `zipforge/builders.py` — ตัวสร้างเว็บแอปแบบอัตโนมัติ
- `zipforge/ai.py` — ตัวสร้างเว็บแอป/HTML ด้วย Claude
- `zipforge/hosting.py` — เผยแพร่เว็บไซต์และระบบสิทธิ์การเข้าถึง

ตัวอย่างสดแสดงใน iframe แบบ `data:` URL ซึ่งแยก origin ออกจากแอป โค้ดที่อัปโหลดหรือที่ AI เขียนจึงเข้าถึงแอปหลักไม่ได้
