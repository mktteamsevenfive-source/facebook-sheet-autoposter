# สิ่งที่ต้องทำต่อ

สรุปจากการทดสอบใช้งานจริงเมื่อ 2026-08-20/21 — เก็บไว้ให้ตัวเองหรือคนอื่นสานต่อ

## ต้องทำก่อนใช้งานจริงต่อเนื่อง

- [ ] **เปิด Scheduled Task กลับมา** — ตอนนี้ปิดไว้ (Disabled) ระหว่างทดสอบ ต้อง `Enable-ScheduledTask -TaskName 'FacebookGoogleSheetAutoposter'` ก่อนใช้งานจริง
- [ ] **ปรับ interval กลับเป็น 20 นาที** — ตอนนี้ตั้งไว้ที่ 10 นาทีเพื่อทดสอบ ให้รัน:
  ```powershell
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 20) -RepetitionDuration (New-TimeSpan -Days 3650)
  Set-ScheduledTask -TaskName 'FacebookGoogleSheetAutoposter' -Trigger $trigger
  ```
- [ ] **Row 4 (Post ID 33138) ในชีต facebook_autopost_test** — Posted URL เป็นข้อความอธิบาย ไม่ใช่ลิงก์จริง ถ้าต้องการลิงก์จริงให้เข้า Facebook คัดลอกเอง แล้วแก้ในชีต
- [ ] **accounts.json มีแค่บัญชี "Thep Arthur" ตอนนี้** — เอา "arunee tangkamolsuk" ออกไปก่อนเพราะยังไม่ได้ login ถ้าจะใช้บัญชีนี้ต้อง login ใหม่ (`npm run login:facebook -- "arunee tangkamolsuk"`) แล้วเพิ่มกลับใน accounts.json

## ปรับปรุงเพื่อให้ onboard คนอื่น/เครื่องอื่นง่ายขึ้น

- [ ] **เปลี่ยนไปใช้ `GOOGLE_AUTH_MODE=service_account`** — ตอนนี้ใช้ OAuth ซึ่งทุกเครื่อง/ทุกคนต้องผ่านขั้นตอน Google Cloud Console + OAuth consent screen + เพิ่ม test user เอง (จุดที่ทำให้ติดขัดวันนี้) ถ้าเปลี่ยนเป็น service account:
  1. สร้าง service account ใน Google Cloud project เดิม (ครั้งเดียว)
  2. ดาวน์โหลด key เป็น `secrets\google-service-account.json`
  3. แชร์ Google Sheet (และโฟลเดอร์ Media ใน Drive ถ้ามี) ให้ email ของ service account
  4. เครื่องใหม่แค่ copy ไฟล์ key ไปวาง ไม่ต้องผ่าน OAuth dance เลย
- [ ] เขียนคู่มือ/checklist สั้น ๆ สำหรับขั้นตอน Facebook login ครั้งแรก (manual, ต้องนั่งหน้าเครื่องจริง) ให้คนที่ไม่ใช่สายเทคนิคทำตามได้เอง

## ปรับปรุงความแม่นยำ (ไม่เร่งด่วน)

- [ ] **Posted URL capture ยังไม่แม่นยำ 100%** — Facebook ไม่ render permalink เป็น `<a href>` ธรรมดาในหน้าฟีดปัจจุบันเสมอไป ตอนนี้แก้ให้ปลอดภัยแล้ว (ไม่เดา ถ้าหาไม่เจอจะบันทึกข้อความอธิบายแทน) แต่ยังไม่ได้แก้ให้ "เจอลิงก์จริง" ได้ทุกครั้ง แนวทางที่อาจลองได้ในอนาคต:
  - ลองอ่านจากเมนู "..." ของโพสต์ (มักมีตัวเลือก copy link)
  - ลองดักจับ response จาก GraphQL request ตอนโพสต์สำเร็จ (Facebook ใช้ GraphQL เป็นหลักในหน้าใหม่)
- [ ] Facebook เปลี่ยนหน้าเว็บบ่อย — คาดว่า selector ใน `src/facebook.js` จะพังอีกในอนาคต ให้ใช้ screenshot ใน `data\screenshots\` เป็นจุดเริ่มต้นตรวจสอบ

## บั๊กที่แก้ไปแล้ววันนี้ (อ้างอิง)

ดูรายละเอียดใน commit `08fdf48` และ `3eb141b`, หรือหัวข้อ "การแก้ปัญหาเบื้องต้น" ใน README.md — สรุปสั้น ๆ:
- MEDIA_DIR path ผิด (ชี้ไป user คนอื่น) → EPERM
- ตรวจชื่อบัญชี Facebook ผิดจุด (เจอ "Notifications" heading แทนชื่อโปรไฟล์)
- เช็คปุ่ม Photo/video และปุ่มเปิด composer แบบ instant-check ไม่รอโหลด → fail เป็นระยะ ๆ (flaky)
- dialog selector ของ composer จับ dialog ผิดตัว (มี role="dialog" ซ่อนอยู่เพียบในหน้า Facebook)
- Posted URL หยิบลิงก์ข้ามกลุ่มผิด (ไม่ได้ scope ตาม group ID)
- Sheets API number format type "DURATION" ไม่มีจริง ต้องใช้ "NUMBER" แทน
- Scheduled Time บังคับต้องมีค่า ทำให้แถวที่ Approved แต่ไม่ได้ตั้งเวลาไม่มีวันถูกเลือก (แก้ให้ว่าง = พร้อมทันที)
