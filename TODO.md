# สิ่งที่ต้องทำต่อ

สรุปจากการทดสอบใช้งานจริงเมื่อ 2026-08-20/21 — เก็บไว้ให้ตัวเองหรือคนอื่นสานต่อ

## ต้องทำก่อนใช้งานจริงต่อเนื่อง

- [ ] **เปิด Scheduled Task กลับมา** — ตอนนี้ปิดไว้ (Disabled) ระหว่างทดสอบ ต้อง `Enable-ScheduledTask -TaskName 'FacebookGoogleSheetAutoposter'` ก่อนใช้งานจริง
- [ ] **ปรับ interval กลับเป็น 20 นาที** — ตอนนี้ตั้งไว้ที่ 10 นาทีเพื่อทดสอบ ให้รัน:
  ```powershell
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 20) -RepetitionDuration (New-TimeSpan -Days 3650)
  Set-ScheduledTask -TaskName 'FacebookGoogleSheetAutoposter' -Trigger $trigger
  ```
- [ ] **Row เก่าบางแถวใน facebook_autopost_test มี Posted URL เป็นข้อความอธิบาย** ไม่ใช่ลิงก์จริง (เช่น Post ID 33138, 38040) — ถ้าต้องการลิงก์จริงให้เข้า Facebook คัดลอกเอง แล้วแก้ในชีต
- [ ] **Row 5 (Post ID 40491) โพสต์ผิดบัญชี** — โพสต์ไปตอนที่ accounts.json ยัง map "sonthep simmalee" ไปที่ profile Thep Arthur ผิด ๆ (แก้ mapping แล้ว แต่โพสต์เก่ายังอยู่ที่บัญชี Thep Arthur) — ตกลงกันไว้ว่าปล่อยโพสต์เดิมไว้ก่อน ไม่ต้องลบ

## ปรับปรุงเพื่อให้ onboard คนอื่น/เครื่องอื่นง่ายขึ้น

- [x] **เปลี่ยนไปใช้ `GOOGLE_AUTH_MODE=service_account`** — ทำแล้ว (2026-08-21) สร้าง service account `sheet-autoposter@facebook-sheet-autoposter.iam.gserviceaccount.com`, แชร์ชีตให้เป็น Editor แล้ว, `.env` เปลี่ยนเป็น service_account แล้ว, ทดสอบผ่าน เครื่องใหม่ต่อจากนี้แค่ copy `secrets\google-service-account.json` ไปวาง ไม่ต้องผ่าน Google Cloud Console เอง
- [x] **`npm run check:facebook`** — เพิ่มคำสั่งเช็คว่า login ครบทุกบัญชีหรือยังก่อนเริ่มงาน (ทำแล้ว)
- [x] **`scripts\setup.ps1` รองรับ `-ServiceAccountKey <path>`** — copy key ให้อัตโนมัติระหว่างติดตั้ง เครื่องใหม่ตอนนี้เหลือแค่: clone → `setup.ps1 -ServiceAccountKey ...` → แก้ accounts.json → `login:facebook` ทีละบัญชี (ทำมือไม่ได้จริง ๆ เพราะ Facebook ต้องมีคนกด login เอง) → `check:facebook` → เปิดใช้งาน
- [ ] เขียนคู่มือ/checklist สั้น ๆ สำหรับขั้นตอน Facebook login ครั้งแรก (manual, ต้องนั่งหน้าเครื่องจริง) ให้คนที่ไม่ใช่สายเทคนิคทำตามได้เอง
- [ ] พิจารณาลบ `secrets\google-oauth-client.json` และ `secrets\google-token.json` เดิมทิ้ง ถ้าไม่ใช้ OAuth mode แล้ว (ปัจจุบันยังเก็บไว้เผื่อย้อนกลับ)

## ปรับปรุงความแม่นยำ (ไม่เร่งด่วน)

- [ ] **Posted URL capture ยังไม่แม่นยำ 100%** — Facebook ไม่ render permalink เป็น `<a href>` ธรรมดาในหน้าฟีดปัจจุบันเสมอไป (พบว่าบางกลุ่มได้ลิงก์จริง บางกลุ่มไม่ได้ — ขึ้นกับ DOM ของกลุ่มนั้น) ตอนนี้แก้ให้ปลอดภัยแล้ว (ไม่เดา ถ้าหาไม่เจอจะบันทึกข้อความอธิบายแทน) แต่ยังไม่ได้แก้ให้ "เจอลิงก์จริง" ได้ทุกครั้ง แนวทางที่อาจลองได้ในอนาคต:
  - ลองอ่านจากเมนู "..." ของโพสต์ (มักมีตัวเลือก copy link)
  - ลองดักจับ response จาก GraphQL request ตอนโพสต์สำเร็จ (Facebook ใช้ GraphQL เป็นหลักในหน้าใหม่)
- [ ] Facebook เปลี่ยนหน้าเว็บบ่อย — คาดว่า selector ใน `src/facebook.js` จะพังอีกในอนาคต ให้ใช้ screenshot ใน `data\screenshots\` เป็นจุดเริ่มต้นตรวจสอบ

## บั๊กที่แก้ไปแล้ว (อ้างอิง)

ดูรายละเอียดใน git log หรือหัวข้อ "การแก้ปัญหาเบื้องต้น" ใน README.md — สรุปสั้น ๆ:
- MEDIA_DIR path ผิด (ชี้ไป user คนอื่น) → EPERM
- ตรวจชื่อบัญชี Facebook ผิดจุด (เจอ "Notifications" heading แทนชื่อโปรไฟล์)
- เช็คปุ่ม Photo/video และปุ่มเปิด composer แบบ instant-check ไม่รอโหลด → fail เป็นระยะ ๆ (flaky)
- dialog selector ของ composer จับ dialog ผิดตัว (มี role="dialog" ซ่อนอยู่เพียบในหน้า Facebook)
- Posted URL หยิบลิงก์ข้ามกลุ่มผิด (ไม่ได้ scope ตาม group ID)
- Sheets API number format type "DURATION" ไม่มีจริง ต้องใช้ "NUMBER" แทน
- Scheduled Time บังคับต้องมีค่า ทำให้แถวที่ Approved แต่ไม่ได้ตั้งเวลาไม่มีวันถูกเลือก (แก้ให้ว่าง = พร้อมทันที)
- หน้าต่าง Chrome ตอนโพสต์เปิดบังหน้าจอ → ย้ายไปเปิดนอกจอแทน (แต่ตอนแรกทำให้ login มองไม่เห็นไปด้วย ต้องแก้แยก onScreen option)
- accounts.json map "sonthep simmalee" ไปที่ profile ผิด (ไปโพสต์จากบัญชี Thep Arthur แทนบัญชีจริง) → แยก profile ใหม่แล้ว
