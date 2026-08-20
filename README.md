# Facebook Sheet Autoposter

โปรแกรม Windows สำหรับอ่าน Google Sheet `facebook_autopost` ทุก 20 นาที และเผยแพร่ได้สูงสุดหนึ่งแถวต่อรอบไปยัง Facebook Group ตามข้อมูลในชีต

## ข้อจำกัดที่ต้องรู้

Meta ยกเลิก Groups API และสิทธิ์ `publish_to_groups` สำหรับทุกเวอร์ชันตั้งแต่ 22 เมษายน 2024 ดังนั้นการโพสต์เข้ากลุ่มตามรูปแบบชีตนี้ใช้ Chrome ที่ล็อกอินไว้ ไม่ใช่ Graph API โปรแกรมไม่ข้าม security check, checkpoint, restriction หรือกฎกลุ่ม และจะหยุดพร้อมบันทึก `Failed` เพื่อให้ตรวจด้วยคน

Facebook อาจเปลี่ยนหน้าเว็บได้ทุกเวลา ตัวเลือกหน้าเว็บจึงอาจต้องปรับในอนาคต ควรเริ่มด้วยกลุ่มทดสอบและตรวจเงื่อนไขการใช้งานของ Meta สำหรับบัญชีของคุณ

## พฤติกรรมสำคัญ

- อ่านเฉพาะแท็บที่ตั้งไว้ใน `SHEET_NAME` (`.env`) และเลือก Scheduled Time ที่เก่าที่สุดเพียงหนึ่งแถวต่อการรันหนึ่งครั้ง
- **Scheduled Date ต้องตรงกับวันนี้เสมอ** ห้ามว่าง — ถ้าเป็นวันอื่นหรือว่าง แถวจะไม่ถูกเลือกไม่ว่าจะรอกี่รอบ
- **Scheduled Time ปล่อยว่างได้** — ถ้าว่าง แถวจะพร้อมโพสต์ทันทีที่ `Approval Status = Approved` (ไม่ต้องรอถึงเวลา) ถ้าใส่เวลาไว้ (เช่น `10.40` หรือ `10:40`) แถวจะยังไม่ถูกเลือกจนกว่าจะถึงเวลานั้น
- `Approval Status = Approved` เป็นคำสั่งเผยแพร่โดยไม่ถามยืนยันเพิ่ม
- ไม่ใช้ Add groups, ไม่ cross-post และไม่รวมหลายแถว
- ป้องกันซ้ำด้วย Post ID, Posting Status และ Posted URL
- ใช้ Caption ตรงตัว และใช้ Local Media Path ก่อนดาวน์โหลดใหม่
- หยุด retry เมื่อ Error / Notes ยังเป็น security, restriction, warning, unusual activity, login, manual review หรือ group-rule problem (สูงสุด 2 attempts ต่อแถว)
- ถ้ากดส่งแล้วแต่ผลลัพธ์ไม่ชัด จะใส่ marker ใน Posted URL และตั้ง `Submitted for review` เพื่อห้ามโพสต์ซ้ำ
- **Posted URL อาจไม่ใช่ลิงก์จริงเสมอไป** — Facebook ไม่ได้ render permalink เป็น `<a>` ธรรมดาในหน้าฟีดปัจจุบันเสมอไป ถ้าระบบหาลิงก์ที่ตรงกับกลุ่มเป้าหมายไม่เจอ จะบันทึกข้อความ placeholder แทนการเดา (ปลอดภัยกว่าเดาแล้วได้ลิงก์ผิดกลุ่ม) — โพสต์สำเร็จจริงเสมอเมื่อ Posting Status = Posted ให้เข้าไปคัดลอกลิงก์จาก Facebook เองถ้าต้องการ
- ใช้ lock file (`data\run.lock`) ป้องกันการรันซ้อนกัน — ห้ามรันสองอินสแตนซ์พร้อมกัน (ทั้งเพราะ Chrome profile เดียวกันเปิดซ้อนไม่ได้ และเสี่ยงโดน Facebook มองว่าเป็นบอทถ้าโพสต์หลายกลุ่มพร้อมกันจากบัญชีเดียว)

## 1. ติดตั้ง

ต้องมี Node.js 20 ขึ้นไปและ Google Chrome

```powershell
cd path\to\facebook-sheet-autoposter
npm install
```

หรือใช้สคริปต์ตั้งค่าเครื่องใหม่ในคำสั่งเดียว (ติดตั้ง dependencies, สร้าง `secrets\`, `data\`, `logs\`, `.env`, `accounts.json` ให้อัตโนมัติ):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

## 2. เชื่อม Google

วิธี OAuth ที่แนะนำ:

1. สร้าง Google Cloud project และเปิด Google Sheets API กับ Google Drive API
2. สร้าง OAuth Client ชนิด Desktop app
3. ดาวน์โหลดไฟล์เป็น `secrets\google-oauth-client.json`
4. รันคำสั่งนี้และล็อกอินบัญชีที่เข้าถึงชีตได้

```powershell
npm run login:google
```

อีกทางคือเปลี่ยน `GOOGLE_AUTH_MODE=service_account` ใน `.env`, วางไฟล์ที่ `secrets\google-service-account.json` และแชร์ทั้งชีตกับไฟล์/โฟลเดอร์ Media ใน Google Drive ให้ email ของ service account เข้าถึงได้

## 3. ล็อกอิน Facebook แยกตามบัญชี

แก้ `accounts.json` ให้ `sheetAccount` ตรงกับคอลัมน์ Facebook Account และ `expectedDisplayName` ตรงกับชื่อที่หน้าโปรไฟล์ Facebook จากนั้นล็อกอินแต่ละบัญชีหนึ่งครั้ง เช่น:

```powershell
npm run login:facebook -- "Thep Arthur"
npm run login:facebook -- "arunee tangkamolsuk"
```

ค่าเริ่มต้นกำหนด `Thep Arthur` และ alias `sonthep simmalee` ให้ใช้ Chrome profile เดียวกัน โปรแกรมจะไม่สลับบัญชีให้อัตโนมัติ จึงล็อกอิน profile ที่ใช้ร่วมกันเพียงครั้งเดียวได้

ก่อนเปิดการตั้งเวลาของโปรแกรม ให้ปิด Automation เดิมใน Codex เพื่อไม่ให้สองระบบเลือกแถวเดียวกันพร้อมกัน

## 4. ทดสอบโดยไม่แก้ชีตและไม่เปิด Facebook

ค่าเริ่มต้นใน `.env` คือ `PUBLISH_ENABLED=false`

```powershell
npm test
npm run dry-run
```

`dry-run` จะอ่านและเลือกแถวเดียว แต่ไม่เตรียมสื่อ ไม่เปิดกลุ่ม ไม่แก้ชีต และไม่โพสต์

## 5. เปิดการเผยแพร่จริง

หลังตรวจผล dry-run และ login ทุกบัญชีแล้ว เปลี่ยนใน `.env` เป็น:

```text
PUBLISH_ENABLED=true
```

ทดสอบหนึ่งรอบด้วย `npm start` ก่อน คำสั่งนี้สามารถเผยแพร่โพสต์จริงได้ทันทีเมื่อพบแถว Approved ที่เข้าเกณฑ์

## 6. ตั้งเวลาทุก 20 นาที

เปิด PowerShell ในบัญชี Windows เดียวกับที่ล็อกอิน Facebook แล้วรัน:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-task.ps1
```

Task Scheduler จะเรียกโปรแกรมทุก 20 นาที และบันทึก log ที่ `logs\scheduled-task.log` เครื่องต้องเปิดอยู่ ผู้ใช้ Windows ต้องล็อกอินอยู่ และ session Facebook ต้องยังใช้งานได้

ถ้าต้องการถอด Task:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\remove-task.ps1
```

ปรับความถี่ได้ด้วย `Set-ScheduledTask` เช่น เปลี่ยนเป็นทุก 10 นาทีเพื่อทดสอบ:

```powershell
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Days 3650)
Set-ScheduledTask -TaskName 'FacebookGoogleSheetAutoposter' -Trigger $trigger
```

## การแก้ปัญหาเบื้องต้น

- **`EPERM: operation not permitted, mkdir ...`** — `MEDIA_DIR` ใน `.env` ชี้ไปโฟลเดอร์ของ user คนละคนหรือ path ที่เครื่องนี้เขียนไม่ได้ ให้เปลี่ยนเป็น path ที่มีจริงบนเครื่องนี้ เช่น `./data/media`
- **`Facebook account mismatch`** — ตรวจว่า `expectedDisplayName` ใน `accounts.json` ตรงกับชื่อโปรไฟล์ Facebook จริง ระบบเช็คจากข้อความทั้งหน้า ไม่ได้เช็คจาก heading เดียวอีกต่อไป (Facebook เปลี่ยน DOM บ่อย)
- **`Facebook media control was not found` / `posting composer is unavailable`** — มักเกิดจาก Facebook โหลดหน้าไม่ทันตอนสคริปต์เช็คปุ่ม ลองรันใหม่อีกครั้ง ถ้ายังไม่หายให้ตรวจ screenshot ที่ `data\screenshots\` เพื่อดูว่าหน้าจริงเป็นอย่างไร
- **Posted URL ผิด/ไม่ตรงกลุ่ม** — ระบบกรองเฉพาะลิงก์ที่อยู่ในกลุ่มเป้าหมายเท่านั้น ถ้าหาไม่เจอจะบันทึกข้อความอธิบายแทนการเดา ไม่ใช่ error
- **Posting Status ค้างที่ `Failed` ทั้งที่โพสต์จริงสำเร็จแล้ว** — ตรวจ `data\screenshots\` และ `logs\scheduled-task.log` ประกอบ ถ้าสาเหตุเป็นบั๊กที่แก้แล้ว ให้ล้างค่า Posting Status, Attempt Count, Error / Notes ในชีตเพื่อให้ลองใหม่ได้
- Facebook เปลี่ยนหน้าเว็บบ่อย ถ้า selector ในโค้ด (`src/facebook.js`) ใช้ไม่ได้อีกต่อไป ให้เปิด screenshot ที่บันทึกไว้เทียบกับโครงสร้างหน้าจริงเพื่อปรับ selector
