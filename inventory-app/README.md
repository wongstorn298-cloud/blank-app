# ระบบคลังน้ำยาและบำรุงรักษาเครื่องมือ

กลุ่มงานตรวจชีววิทยาและดีเอ็นเอ ศูนย์พิสูจน์หลักฐาน 3

เว็บแอปบันทึกรับ-เบิกน้ำยา วัสดุ และงานซ่อม/บำรุงรักษาเครื่องมือ ใช้บนมือถือเป็นหลัก เก็บข้อมูลใน Google Sheets และทำงานบน Google Apps Script

**วิธีติดตั้งและวิธีใช้งานบนมือถือแบบละเอียด: [MANUAL-TH.md](MANUAL-TH.md)**

| ไฟล์ | หน้าที่ |
| --- | --- |
| `starter-sheet.xlsx` | ชีตตั้งต้น 3 แท็บ มีทะเบียนอุปกรณ์จริง 30 รายการ ยอดเป็น 0 |
| `Code.gs` | Google Apps Script: เปิดหน้าแอป และอ่าน/เขียนชีต |
| `index.html` | ตัวแอปทั้งหมด (Tailwind CSS, Chart.js, SheetJS) ฝังตราศูนย์ฯ ไว้แล้ว ใส่ใน Apps Script เป็นไฟล์ HTML ชื่อ `index` |
| `MANUAL-TH.md` | คู่มือติดตั้งและใช้งาน |
| `dev/make_starter_sheet.py` | สร้าง `starter-sheet.xlsx` ใหม่ (แก้รายการใน `ITEMS`) |
| `dev/gas-fake-server.js` | รัน `Code.gs` บนเครื่องด้วย Node โดยจำลอง Google Sheets ไว้ทดสอบ |

## โครงสร้างข้อมูล

| ชีต | เก็บอะไร | การแก้ไข |
| --- | --- | --- |
| `Equipment_Master` | ทะเบียน 1 แถวต่อรายการ: `Equipment_ID` (EQ-001…), `Material_Name`, `Category` (สิ้นเปลือง / ทรัพย์สินถาวร), `Unit`, `Min_Stock_Alert`, `Expiration_Date`, `Next_Maintenance_Date`, `Updated_At` | แก้ได้ |
| `Transactions` | รับ-เบิกทุกครั้ง: `Transaction_ID`, `Timestamp`, `Equipment_ID`, `Type` (IN/OUT), `Quantity`, `Requester`, `Notes` | **เพิ่มแถวอย่างเดียว** |
| `Maintenance_Log` | ใบแจ้งซ่อม: `Repair_ID`, `Timestamp`, `Equipment_ID`, `Issue_Description`, `Reporter`, `Status`, `Updated_At` | แก้ได้เฉพาะ `Status` |

ไม่เก็บยอดคงเหลือไว้ที่ใด ทุกตัวเลขคำนวณจาก `Transactions`:
ยอดยกมา = IN − OUT ก่อนวันเริ่มต้น, คงเหลือ = ยอดยกมา + IN ในช่วง − OUT ในช่วง

การแจ้งเตือนอ่านจากทะเบียน ไม่ขึ้นกับช่วงวันที่: หมดอายุภายใน 30 วัน, ถึงกำหนดบำรุงรักษาภายใน 30 วัน, และคงเหลือ ≤ `Min_Stock_Alert`

## วิธีที่แอปคุยกับชีต

- **เปิดจากลิงก์ Web App (วิธีหลัก):** `doGet` ที่ไม่มีพารามิเตอร์จะส่งหน้า `index` ออกไป หน้าแอปตรวจพบ `google.script.run` แล้วเรียก `apiCall()` โดยตรง ไม่ต้องตั้ง URL หรือรหัสลับ และไม่แสดงข้อมูลตัวอย่าง
- **ฝาก `index.html` บนเว็บอื่น (ทางเลือก):** แอปเรียก JSON API ผ่าน `fetch` ต้องใส่ URL `/exec` และรหัสลับ (`API_KEY` ใน `Code.gs`) ในหน้าตั้งค่าของแต่ละเครื่อง
  - `GET ?action=sync&txFrom=N&key=…` ทะเบียน + ใบแจ้งซ่อม + แถว Transactions ที่ต่อจาก N
  - `GET ?action=report&start=YYYY-MM-DD&end=YYYY-MM-DD&key=…` ยอดยกมา/รับ/เบิก/คงเหลือ คำนวณฝั่งเซิร์ฟเวอร์
  - `POST {action, key, data}` สำหรับ `addEquipment`, `updateEquipment`, `addTx`, `addRepair`, `updateRepair` (ส่งเป็น `text/plain` เพื่อเลี่ยง CORS preflight)
- ถ้าเปิด `index.html` จากไฟล์ตรง ๆ โดยไม่เชื่อมชีต จะเห็นข้อมูลตัวอย่างย้อนหลัง 3 ปี ไว้ฝึกใช้งาน

การซิงก์: รหัส EQ ออกโดยเซิร์ฟเวอร์, ดึงเฉพาะแถว Transactions ใหม่, บันทึกตอนออฟไลน์ได้ (อุปกรณ์ใหม่ได้รหัส `TMP-…` ชั่วคราวแล้วเปลี่ยนเป็น EQ จริงตอนส่ง), เซิร์ฟเวอร์ไม่ยอมให้เบิกเกินยอด และไม่สร้างแถวซ้ำเมื่อส่งซ้ำ

## ทดสอบบนเครื่อง

```bash
node inventory-app/dev/gas-fake-server.js inventory-app/Code.gs 8787
```

เปิด `http://localhost:8787/exec` จะได้แอปในโหมดเดียวกับที่ Apps Script เปิดให้ (ชีตจำลองเริ่มว่าง เพิ่มรายการที่แท็บทะเบียน)

สร้างชีตตั้งต้นใหม่หลังแก้รายการ:

```bash
python3 inventory-app/dev/make_starter_sheet.py inventory-app/starter-sheet.xlsx
```
