# Facebook Sheet Autoposter

โปรแกรม Windows สำหรับอ่าน Google Sheet `facebook_autopost` ทุก 20 นาที และเผยแพร่ได้สูงสุดหนึ่งแถวต่อรอบไปยัง Facebook Group ตามข้อมูลในชีต

## ข้อจำกัดที่ต้องรู้

Meta ยกเลิก Groups API และสิทธิ์ `publish_to_groups` สำหรับทุกเวอร์ชันตั้งแต่ 22 เมษายน 2024 ดังนั้นการโพสต์เข้ากลุ่มตามรูปแบบชีตนี้ใช้ Chrome ที่ล็อกอินไว้ ไม่ใช่ Graph API โปรแกรมไม่ข้าม security check, checkpoint, restriction หรือกฎกลุ่ม และจะหยุดพร้อมบันทึก `Failed` เพื่อให้ตรวจด้วยคน

Facebook อาจเปลี่ยนหน้าเว็บได้ทุกเวลา ตัวเลือกหน้าเว็บจึงอาจต้องปรับในอนาคต ควรเริ่มด้วยกลุ่มทดสอบและตรวจเงื่อนไขการใช้งานของ Meta สำหรับบัญชีของคุณ

## พฤติกรรมสำคัญ

- อ่านเฉพาะแท็บ `facebook_autopost` และเลือก Scheduled Time ที่เก่าที่สุดเพียงหนึ่งแถว
- `Approval Status = Approved` เป็นคำสั่งเผยแพร่โดยไม่ถามยืนยันจาก Codex
- ไม่ใช้ Add groups, ไม่ cross-post และไม่รวมหลายแถว
- ป้องกันซ้ำด้วย Post ID, Posting Status และ Posted URL
- ใช้ Caption ตรงตัว และใช้ Local Media Path ก่อนดาวน์โหลดใหม่
- หยุด retry เมื่อ Error / Notes ยังเป็น security, restriction, warning, unusual activity, login, manual review หรือ group-rule problem
- ถ้ากดส่งแล้วแต่ผลลัพธ์ไม่ชัด จะใส่ marker ใน Posted URL และตั้ง `Submitted for review` เพื่อห้ามโพสต์ซ้ำ
- ใช้ lock file ป้องกันรอบ 20 นาทีซ้อนกัน

## 1. ติดตั้ง

ต้องมี Node.js 20 ขึ้นไปและ Google Chrome

```powershell
cd C:\Users\0125024\Documents\Codex\facebook-sheet-autoposter
npm install
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
