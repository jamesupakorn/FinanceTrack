# CLAUDE.md

เอกสารนี้สรุปงานทั้งหมดที่ทำในโปรเจกต์ FinanceTrack ชุดล่าสุด เพื่อใช้อ้างอิงต่อในการพัฒนา/ดีบั๊ก

## 1) เป้าหมายหลักที่ทำสำเร็จ

- ปรับระบบบัญชีธนาคารให้เป็นแบบแยกตามผู้ใช้ (per-user) และคงที่ข้ามเดือน
- ปรับหน้า Expense ให้ใช้งานจริงง่ายขึ้น (ลดความโล่ง + มีเทียบเดือนก่อน)
- เปิดให้ทุก user ใช้ส่วนจัดการบัญชีธนาคารได้
- แก้ logic วันครบกำหนดแบบสิ้นเดือน (EOM) ให้ตรงกันทั้ง UI และ LINE notify
- ลดความสับสนเรื่องการบันทึก โดยเปลี่ยนเป็นปุ่ม Save All เดียวด้านล่าง
- เพิ่ม Floating Action Bar ติดด้านล่างหน้าจอตลอดเวลา (นำทางเดือน + บันทึก)
- ปรับ feedback จาก alert() เป็น toast เพื่อ UX ที่ไม่ขวางการทำงาน
- แก้บั๊ก mobile/tablet, เพิ่มบัญชีไม่ได้, พิมพ์แล้วหลุดโฟกัส
- ปรับเวอร์ชันและ tag release เป็น 2.2.0 ให้ตรงกัน

## 2) การเปลี่ยนแปลงเชิงสถาปัตยกรรม

### 2.1 Per-user Bank Accounts

- เพิ่ม API ใหม่: `/api/user-bank-accounts` (GET/POST)
- เพิ่ม utility ฝั่ง backend สำหรับอ่าน/เขียน bankAccounts ของผู้ใช้
- เชื่อม SessionContext และ ExpenseTable ให้โหลด/บันทึก bank accounts ตาม `userId` จริง
- ปิดพฤติกรรม fallback ที่เคยฉีดบัญชี default อัตโนมัติ ทำให้ user ใหม่เห็นเป็น "ยังไม่มีข้อมูล" ตาม requirement

ผลลัพธ์:
- ข้อมูลบัญชีไม่ไหลข้าม user
- user ที่ไม่มีบัญชีจะเริ่มจากค่าว่างจริง

### 2.2 Save Flow ใหม่ (Save All)

- ยกเลิกปุ่มบันทึกแยกย่อยในหลายคอมโพเนนต์
- เพิ่ม trigger save จากหน้า `edit` ไปยังแต่ละ section ผ่าน prop (`triggerSave`)
- มีปุ่มหลักเดียว: "บันทึกข้อมูลทั้งหมด"

ผลลัพธ์:
- UX ง่ายขึ้น ชัดเจนขึ้น
- ลดการกดบันทึกหลายจุดซ้ำซ้อน

### 2.3 Floating Action Bar

- ลบปุ่ม "บันทึกข้อมูลทั้งหมด" ด้านล่างสุดของหน้า `edit.js` ออก
- เพิ่ม floating bar fixed ด้านล่างหน้าจอ ประกอบด้วย:
  - ปุ่ม ◀ ▶ นำทางระหว่างเดือน (อิงจาก `months` array ใน state)
  - label แสดงชื่อเดือนปัจจุบัน
  - ปุ่ม "บันทึก" เรียก `handleSaveAll()` เดิม (triggerSave pattern ยังเหมือนเดิม)
- ลูกศร disabled อัตโนมัติเมื่ออยู่เดือนแรกหรือเดือนสุดท้าย

ไฟล์ที่แก้:
- `pages/edit.js`
- `src/frontend/styles/Home.module.css` (เพิ่ม `.floatingBar` และ responsive)

ผลลัพธ์:
- ไม่ต้อง scroll ลงล่างเพื่อบันทึก
- สลับเดือนได้ 1 คลิกโดยไม่ต้องเปิด dropdown

### 2.4 Global Toast Feedback

- เพิ่มระบบ toast กลาง
- เปลี่ยนหลายจุดจาก `alert()` เป็น toast success/error

ผลลัพธ์:
- ผู้ใช้ยังทำงานต่อได้ ไม่โดน modal ขัด flow
- สถานะสำเร็จ/ล้มเหลวสื่อสารชัดเจนขึ้น

## 3) การแก้บั๊กสำคัญ

### 3.1 EOM และ LINE Notification

ปัญหาเดิม:
- UI บางกรณีตีความ due day ไม่ตรงกับ EOM
- API LINE notify ไม่รองรับค่า `EOM` ครบทุกทาง

การแก้:
- ปรับการ map/dropdown due day ให้ EOM ชัดเจน
- ปรับ `getDueDayNumber` ให้รองรับ EOM ผ่าน helper เดียวกัน
- ตั้ง default ที่เกี่ยวข้องให้สอดคล้อง requirement ล่าสุด

### 3.2 Shared Data ข้ามผู้ใช้

ปัญหาเดิม:
- บาง request ไป API โดยไม่ได้แนบ `userId` ทำให้ดูเหมือนแชร์ข้อมูล

การแก้:
- เพิ่ม `userId` ในจุด fetch ที่ขาด
- ตรวจการ assert user ใน API ให้ครบ

### 3.3 Mobile/Tablet ไม่เห็น Bank Account Table

ปัญหาเดิม:
- media query ซ่อน selector กว้างเกิน ทำให้ตารางหายทั้งก้อน

การแก้:
- scope selector ให้ซ่อนเฉพาะ element ที่ควรซ่อน (`hideOnMobile`)

### 3.4 เพิ่มบัญชีไม่ได้ / พิมพ์แล้วเด้ง

ปัญหาเดิม:
- เพิ่มแถวด้วยค่าว่างแล้วโดน filter ทิ้ง
- key ของ row ไม่เสถียร ทำให้ remount และ input หลุดโฟกัส

การแก้:
- ใช้ placeholder ไม่ว่าง (`บัญชีใหม่`) ตอน add
- เปลี่ยนเป็น key ที่เสถียร
- ลด normalization ระหว่างพิมพ์ให้ไม่รีเซ็ตค่าทันที

## 4) ไฟล์สำคัญที่ถูกเพิ่ม/แก้

ไฟล์เพิ่ม:
- `pages/api/user-bank-accounts.js`
- `scripts/migrateBankAccounts.js`
- `src/shared/utils/frontend/toast.js`
- `src/frontend/components/Toast.js`
- `src/frontend/styles/Toast.module.css`

ไฟล์แก้หลัก:
- `src/backend/data/userUtils.js`
- `src/backend/data/users.json`
- `src/frontend/contexts/SessionContext.js`
- `src/frontend/components/ExpenseTable.js`
- `src/frontend/components/BankAccountTable.js`
- `src/shared/utils/frontend/numberUtils.js`
- `pages/api/line_due_notify.js`
- `src/frontend/styles/ExpenseTable.module.css`
- `pages/edit.js`
- `src/frontend/components/IncomeTable.js`
- `src/frontend/components/SavingsTable.js`
- `src/frontend/components/InvestmentTable.js`
- `src/frontend/components/SalaryCalculator.js`
- `src/frontend/components/TaxTable.js`
- `src/frontend/components/MonthManager.js`
- `pages/_app.js`
- `package.json`
- `package-lock.json`

## 5) สถานะ release ล่าสุด

- branch ที่ใช้ปล่อยล่าสุด: `production`
- commit สุดท้ายที่จัดเวอร์ชันให้ตรง: `a464442`
- `package.json` และ `package-lock.json` เป็น `2.2.0`
- git tag `2.2.0` ชี้ไป commit เดียวกันเรียบร้อย

## 6) สิ่งที่ควรรู้ก่อนพัฒนาต่อ

- Save All ปัจจุบันเป็นแบบกระตุ้นแต่ละ section ให้ save; หากต้องการให้แข็งแรงขึ้นอีก ควรเพิ่มสรุปผลรวม (section ไหน fail/success) หลังการกดครั้งเดียว
- Floating Bar ใช้ `months` array จาก state ของ `edit.js` — ถ้าแก้ logic การดึงเดือนให้ระวัง index prev/next ที่ bar นี้อาศัยอยู่
- ควรทดสอบ flow ข้ามผู้ใช้ (u001/u002/ผู้ใช้ใหม่) ซ้ำทุกครั้งเมื่อแตะโค้ดที่เกี่ยวกับ bankAccounts หรือ session
- ถ้าจะแก้ responsive อีก ให้ระวัง selector กลุ่ม table/container ไม่ให้โดนซ่อนทั้งก้อนโดยไม่ตั้งใจ

## 7) บทสรุป

งานรอบนี้เปลี่ยนจากการแก้ UI รายจุดไปสู่การปรับระบบใช้งานจริงทั้ง data correctness + UX flow:
- ข้อมูลบัญชีธนาคารถูกต้องตามผู้ใช้
- due day EOM และ LINE notify ทำงานตรงกัน
- การบันทึกและ feedback ใช้ง่ายขึ้น
- ปัญหาใช้งานจริงบน mobile/tablet และ input behavior ถูกแก้เรียบร้อย
- release ถูกล็อกที่ `2.2.0` ตามที่ต้องการ
