"""Build the unbranded try-out page (demo data only) from index.html.

Usage: python3 build_preview.py <output.html>

The preview drops the agency emblem and names, says on screen that it is a
try-out with sample data kept on the viewer's own phone, hides the Google
Sheets connection form, and disables Excel export (the preview host blocks
downloads). The output has no <html>/<head>/<body> wrapper: the host adds it.
"""
import re
import sys

SRC = __file__.rsplit('/dev/', 1)[0] + '/index.html'
s = open(SRC, encoding='utf-8').read()


def sub(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, (n, old[:70])
    s = s.replace(old, new)


# --- neutral icon instead of the emblem
ICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E"
        "%3Ccircle cx='32' cy='32' r='32' fill='%236e1219'/%3E"
        "%3Cpath d='M22 12c0 11 20 13 20 20s-20 9-20 20M42 12c0 11-20 13-20 20s20 9 20 20M24 20h16M24 44h16' "
        "fill='none' stroke='white' stroke-width='3.5' stroke-linecap='round'/%3E%3C/svg%3E")
logos = re.findall(r'data:image/jpeg;base64,[A-Za-z0-9+/=]+', s)
assert len(logos) == 1
s = s.replace(logos[0], ICON)
sub('alt="ตราศูนย์พิสูจน์หลักฐาน 3"', 'alt=""', 2)
sub('class="h-24 w-24 rounded-full bg-white object-contain p-0.5 ring-2 ring-white/60"', 'class="h-16 w-16 rounded-full"')
sub('class="h-11 w-11 shrink-0 rounded-full bg-white object-contain ring-1 ring-line lg:hidden"', 'class="h-11 w-11 shrink-0 rounded-full lg:hidden"')

# --- no agency names
sub('<p class="mt-4 text-lg font-bold leading-snug">ศูนย์พิสูจน์หลักฐาน 3</p>', '<p class="mt-4 text-lg font-bold leading-snug">ฉบับทดลองใช้</p>')
sub('<p class="text-xs opacity-80">Police Forensic Science Center 3</p>', '<p class="text-xs opacity-80">ข้อมูลตัวอย่าง ยังไม่เชื่อม Google Sheets</p>')
sub('กลุ่มงานตรวจชีววิทยาและดีเอ็นเอ<br>ศูนย์พิสูจน์หลักฐาน 3', 'เห็นปัญหาหรืออยากให้แก้อะไร<br>แคปหน้าจอส่งในกลุ่ม LINE')
sub('<p class="text-xs text-muted lg:hidden">ศูนย์พิสูจน์หลักฐาน 3</p>', '<p class="text-xs text-muted lg:hidden">ฉบับทดลองใช้</p>')
sub('<p class="hidden text-sm text-muted lg:block">กลุ่มงานตรวจชีววิทยาและดีเอ็นเอ · ศูนย์พิสูจน์หลักฐาน 3</p>',
    '<p class="hidden text-sm text-muted lg:block">ฉบับทดลองใช้ · ข้อมูลตัวอย่าง</p>')
sub("    ['หน่วยงาน', 'กลุ่มงานตรวจชีววิทยาและดีเอ็นเอ ศูนย์พิสูจน์หลักฐาน 3'],\n", '')
s = s.replace('the PFSC3 emblem, as on the agency dashboard', 'the app icon')

# --- tell testers what this is
sub('<main class="gutter max-w-6xl mx-auto pt-4">', '''<main class="gutter max-w-6xl mx-auto pt-4">
    <p class="mb-4 rounded-xl border border-line bg-soft px-3 py-2 text-sm text-ink">
      <b>ฉบับทดลองใช้</b> ตัวเลขทั้งหมดเป็นข้อมูลสมมติ สิ่งที่คุณบันทึกเก็บไว้ในเครื่องนี้เท่านั้น คนอื่นไม่เห็น
      ลองบันทึกได้เต็มที่ เห็นปัญหาหรืออยากให้แก้อะไร แคปหน้าจอส่งในกลุ่ม LINE
    </p>''')

# --- preview host: no Google connection, no downloads
sub("  $('#url-block').hidden = GAS;", "  $('#url-block').hidden = true;")
sub("  if (GAS) $('#conn-help').textContent =", "  $('#conn-help').textContent = 'ฉบับทดลองใช้ยังไม่เชื่อม Google Sheets ข้อมูลอยู่ในเครื่องนี้เท่านั้น';\n  if (GAS) $('#conn-help').textContent =")
sub("  if (!window.XLSX) return toast(", "  return toast('ฉบับทดลองใช้ส่งออก Excel ไม่ได้ ฉบับจริงจะดาวน์โหลดไฟล์ได้', 'warn');\n  if (!window.XLSX) return toast(")

# --- the host supplies the document wrapper
for t in ['<!doctype html>\n', '<html lang="th">\n', '<head>\n', '</head>\n', '<body>\n', '</body>\n', '</html>\n',
          '<meta charset="utf-8">\n', '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n']:
    sub(t, '')

left = re.findall(r'ศูนย์พิสูจน์|Police Forensic|ศพฐ|PFSC|กลุ่มงานตรวจชีววิทยา', s)
assert not left, left
open(sys.argv[1], 'w', encoding='utf-8').write(s)
print('wrote', sys.argv[1], len(s))
