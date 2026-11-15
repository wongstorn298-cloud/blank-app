"""Build the starter spreadsheet (starter-sheet.xlsx) for Google Sheets import.

Usage: python3 make_starter_sheet.py <output.xlsx>

Sheet names and headers must match SHEETS in Code.gs exactly.
Equipment_Master holds the 30 real items (stock starts at 0: no transactions).
"""
import sys
from datetime import datetime
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

CONSUMABLE, FIXED = 'สิ้นเปลือง', 'ทรัพย์สินถาวร'
ITEMS = [  # (name, unit, category) — units are a best guess: check them before use
    ('3500 Genetic Analyzer 8-Capillary Array, 36 cm', 'ชุด', CONSUMABLE),
    ('3500xL Genetic Analyzer 24-Capillary Array, 36 cm', 'ชุด', CONSUMABLE),
    ('MicroAmp 96-Well Tray Retainer Set', 'ชุด', CONSUMABLE),
    ('Anode Buffer Container (ABC) 3500 Series, 4 Pack', 'แพ็ก', CONSUMABLE),
    ('Cathode Buffer Container (CBC) 3500 Series, 4 Pack', 'แพ็ก', CONSUMABLE),
    ('POP-4 Polymer for 3500 Genetic Analyzer, 384 samples', 'ขวด', CONSUMABLE),
    ('POP-4 Polymer for 3500 Genetic Analyzer, 960 samples', 'ขวด', CONSUMABLE),
    ('Conditioning Reagent, 3500 Series', 'ชิ้น', CONSUMABLE),
    ('Hi-Di Formamide, 25 ml', 'ขวด', CONSUMABLE),
    ('Hi-Di Formamide, 250 ml', 'ขวด', CONSUMABLE),
    ('GeneScan 600 LIZ Size Standard v2.0, 800 rxn', 'หลอด', CONSUMABLE),
    ('GeneScan 500 LIZ Size Standard v2.0', 'หลอด', CONSUMABLE),
    ('AmpFLSTR Identifiler Plus Kit', 'ชุด', CONSUMABLE),
    ('AmpFLSTR Yfiler Plus PCR Amplification Kit, 100 rxn', 'ชุด', CONSUMABLE),
    ('VeriFiler Plus PCR Amplification Kit, 200 rxn', 'ชุด', CONSUMABLE),
    ('GlobalFiler IQC PCR Amplification Kit, 200 rxn', 'ชุด', CONSUMABLE),
    ('Quantifiler HP DNA Quantification Kit, 400 rxn', 'ชุด', CONSUMABLE),
    ('7500 Pure Dye Calibration + FPPM', 'ชุด', CONSUMABLE),
    ('Primer', 'หลอด', CONSUMABLE),
    ('PrepFiler Automated Forensic DNA Extraction Kit', 'ชุด', CONSUMABLE),
    ('DNA IQ Resin, 50 ml', 'ขวด', CONSUMABLE),
    ('KingFisher 96 Deep-well Plate, V-bottom, 50 pk', 'แพ็ก', CONSUMABLE),
    ('MicroAmp Optical Adhesive Film, 100 covers', 'กล่อง', CONSUMABLE),
    ('1.5 mL Non-Stick RNase-free Microfuge Tubes', 'แพ็ก', CONSUMABLE),
    ('1000 µL Conductive Filter Tips (3,840 tips/case)', 'กล่อง', CONSUMABLE),
    ('300 µL Conductive Filter Tips (5,760 tips/case)', 'กล่อง', CONSUMABLE),
    ('ค่าเบ็ดเตล็ด (เสื้อ + ปักโลโก้ + ปักชื่อ)', 'ชุด', CONSUMABLE),
    ('เครื่องตรวจดีเอ็นเอ 8 เส้น รุ่น 3500 Genetic Analyzer', 'เครื่อง', FIXED),
    ('เครื่องเพิ่มปริมาณดีเอ็นเอ รุ่น ProFlex 96 PCR System', 'เครื่อง', FIXED),
    ('เครื่องวัดปริมาณสารพันธุกรรมแบบเรียลไทม์ รุ่น 7500', 'เครื่อง', FIXED),
]

SHEETS = {
    'Equipment_Master': (['Equipment_ID', 'Material_Name', 'Category', 'Unit', 'Min_Stock_Alert', 'Expiration_Date', 'Next_Maintenance_Date', 'Updated_At'],
                         [12, 52, 14, 9, 15, 16, 22, 22], {'Min_Stock_Alert'}),
    'Transactions': (['Transaction_ID', 'Timestamp', 'Equipment_ID', 'Type', 'Quantity', 'Requester', 'Notes'],
                     [26, 26, 13, 8, 10, 24, 30], {'Quantity'}),
    'Maintenance_Log': (['Repair_ID', 'Timestamp', 'Equipment_ID', 'Issue_Description', 'Reporter', 'Status', 'Updated_At'],
                        [22, 26, 13, 60, 24, 16, 22], set()),
}
HEAD_FILL = PatternFill('solid', fgColor='F9ECEE')
HEAD_FONT = Font(bold=True, color='5C0F15')


def main(out):
    wb = Workbook()
    wb.remove(wb.active)
    stamp = datetime.now().strftime('%Y-%m-%dT%H:%M:%S')
    for name, (cols, widths, numeric) in SHEETS.items():
        ws = wb.create_sheet(name)
        ws.append(cols)
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[ws.cell(1, i).column_letter].width = w
            c = ws.cell(1, i)
            c.font, c.fill, c.alignment = HEAD_FONT, HEAD_FILL, Alignment(vertical='center')
        ws.freeze_panes = 'A2'
        if name == 'Equipment_Master':
            for n, (item, unit, cat) in enumerate(ITEMS, start=1):
                ws.append([f'EQ-{n:03d}', item, cat, unit, 0, '', '', stamp])
            dv = DataValidation(type='list', formula1=f'"{CONSUMABLE},{FIXED}"', allow_blank=False)
            ws.add_data_validation(dv)
            dv.add('C2:C1000')
        if name == 'Transactions':
            dv = DataValidation(type='list', formula1='"IN,OUT"', allow_blank=False)
            ws.add_data_validation(dv)
            dv.add('D2:D100000')
        if name == 'Maintenance_Log':
            dv = DataValidation(type='list', formula1='"รอดำเนินการ,กำลังซ่อม,ซ่อมเสร็จแล้ว"', allow_blank=False)
            ws.add_data_validation(dv)
            dv.add('F2:F100000')
        # ids, dates and timestamps are text so Sheets does not reformat them
        for row in ws.iter_rows(min_row=2, max_row=max(ws.max_row, 2)):
            for c in row:
                if cols[c.column - 1] not in numeric:
                    c.number_format = '@'

    readme = wb.create_sheet('อ่านก่อน')
    lines = [
        'ชีตนี้เป็นฐานข้อมูลของ ระบบคลังน้ำยาและบำรุงรักษาเครื่องมือ',
        'กลุ่มงานตรวจชีววิทยาและดีเอ็นเอ ศูนย์พิสูจน์หลักฐาน 3',
        '',
        'ห้ามเปลี่ยนชื่อแท็บ Equipment_Master, Transactions, Maintenance_Log และห้ามแก้หัวตารางแถวที่ 1',
        'Equipment_Master: แก้ไขได้ (หน่วยนับ จุดเตือนสต็อก วันหมดอายุ วันบำรุงรักษา) ห้ามเปลี่ยน Equipment_ID ที่มีรายการรับ-เบิกแล้ว',
        'Transactions: ห้ามแก้หรือลบแถว ถ้าบันทึกผิด ให้บันทึกรายการกลับทิศในแอป',
        'Maintenance_Log: เปลี่ยนสถานะผ่านแอปเท่านั้น',
        'วันที่ทุกช่องใช้รูปแบบ YYYY-MM-DD (ค.ศ.) เช่น 2026-12-31',
        'ยอดคงเหลือไม่ได้เก็บในชีต แอปคำนวณจาก Transactions ทุกครั้ง',
        'แท็บนี้ลบทิ้งได้ ไม่มีผลกับแอป',
    ]
    for t in lines:
        readme.append([t])
    readme.column_dimensions['A'].width = 120
    readme['A1'].font = Font(bold=True, size=13, color='5C0F15')
    wb.save(out)
    print('wrote', out, len(ITEMS), 'items')


if __name__ == '__main__':
    main(sys.argv[1])
