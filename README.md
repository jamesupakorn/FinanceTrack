# FinanceTrack - ระบบจัดการการเงินส่วนบุคคล

## 📁 โครงสร้างโปรเจค

```
FinanceTrack/
├── src/
│   ├── frontend/           # 🎨 Frontend (UI Components & Pages)
│   │   ├── components/     # React Components
│   │   │   ├── IncomeTable.js
│   │   │   ├── ExpenseTable.js
│   │   │   ├── SavingsTable.js
│   │   │   └── TaxTable.js
│   │   └── pages/          # Frontend Pages
│   │       └── index.js    # หน้าหลัก
│   │
│   ├── backend/            # 🔧 Backend (API & Data)
│   │   ├── api/            # API Routes
│   │   │   ├── monthly_income.js
│   │   │   ├── monthly_expense.js
│   │   │   ├── savings.js
│   │   │   └── tax_accumulated.js
│   │   └── data/           # JSON Data Storage
│   │       ├── monthly_income.json
│   │       ├── monthly_expense.json
│   │       ├── savings.json
│   │       └── tax_accumulated.json
│   │
│   └── shared/             # 🔄 Shared Utilities
│       ├── numberUtils.js  # ฟังก์ชันจัดการตัวเลข
│       └── apiUtils.js     # ฟังก์ชันเรียก API
│
├── pages/                  # Next.js Pages (Proxy Files)
│   ├── api/                # API Route Proxies
│   └── index.js            # Main Page Proxy
│
├── package.json
├── next.config.js          # Next.js Configuration
└── README.md
```

## 🎯 คุณสมบัติ

- **📊 จัดการรายรับรายเดือน** - ติดตามรายได้จากแหล่งต่างๆ
- **💸 จัดการรายจ่ายรายเดือน** - เปรียบเทียบค่าใช้จ่ายประมาณและจ่ายจริง
- **🏦 จัดการเงินออม** - ติดตามยอดออมสะสมและรายการออม
- **🧾 จัดการภาษี** - คำนวณภาษีสะสมและรายเดือน
- **📅 ข้อมูลย้อนหลัง 12 เดือน** - เก็บประวัติการเงิน 12 เดือน

## 🚀 การติดตั้งและรัน

```bash
# ติดตั้ง dependencies
npm install

# รัน development server
npm run dev

# เปิดเบราว์เซอร์ที่ http://localhost:3000
```

## 🔐 โหมดหลายผู้ใช้ & สคริปต์ Migration

เพื่อให้ข้อมูลแต่ละตารางถูกแยกตามผู้ใช้ จำเป็นต้องย้ายโครงสร้างข้อมูลเก่าให้รองรับ `userId` ก่อนเสมอ

1. **โหมด JSON (ค่าเริ่มต้นในโปรเจค)**
	```bash
	node scripts/migrateToMultiUser.js
	```
	สคริปต์จะรวมข้อมูลเดือนเดิมทั้งหมดเข้า bucket ของผู้ใช้ `u001` แบบอัตโนมัติ

2. **โหมด MongoDB** – ตั้งค่า `MONGODB_URI` แล้วรันคำสั่ง:
	```bash
	MONGODB_URI="mongodb+srv://<user>:<pass>@cluster" node scripts/migrateMongoUserIds.js u001
	```
	- ระบุ `u001` หรือ userId ที่ต้องการเป็นเจ้าของข้อมูล (ถ้าไม่ระบุจะใช้ `u001`)
	- สามารถเปลี่ยนชื่อฐานข้อมูลได้ผ่าน `MONGODB_DB`
	- สคริปต์จะเติม `userId` ให้ทุก document ที่ยังไม่มีฟิลด์นี้ (รวม metadata เช่น `obj: 'months'`)

> หลัง migration แนะนำให้เข้าใช้งานผ่านหน้า `/profiles` แล้วตรวจสอบความถูกต้องของข้อมูลแต่ละผู้ใช้

### การสร้างผู้ใช้ใหม่ (users.json)

ใช้สคริปต์ช่วยสร้างผู้ใช้พร้อม hash รหัสผ่าน:

```bash
node scripts/createUser.js "ชื่อบนโปรไฟล์" "รหัสผ่าน" [/avatars/u003.jpg] [customUserId]
```

- ค่า avatar และ userId เป็นออปชั่น (หากไม่ใส่ avatar = `""` และระบบจะสร้าง id ถัดไปอัตโนมัติ)
- รหัสผ่านจะถูกแปลงเป็น bcrypt hash ก่อนบันทึก
- สคริปต์จะป้องกันชื่อ/รหัสซ้ำให้อัตโนมัติ

## 🏗️ เทคโนโลยีที่ใช้

- **Frontend**: React, Next.js 15.5.2
- **Backend**: Next.js API Routes
- **Database**: JSON File Storage
- **UI**: Vanilla CSS with inline styles
- **Language**: JavaScript (ES6+)

## 🎨 Frontend Structure

### Components:
- `IncomeTable.js` - แสดงและจัดการรายรับ
- `ExpenseTable.js` - แสดงและจัดการรายจ่าย  
- `SavingsTable.js` - แสดงและจัดการเงินออม
- `TaxTable.js` - แสดงและจัดการภาษี

### Pages:
- `index.js` - หน้าหลักรวมทุกตาราง

## 🔧 Backend Structure

### API Routes:
- `/api/monthly_income` - จัดการข้อมูลรายรับ
- `/api/monthly_expense` - จัดการข้อมูลรายจ่าย
- `/api/savings` - จัดการข้อมูลเงินออม
- `/api/tax_accumulated` - จัดการข้อมูลภาษี

### Data Storage:
- JSON files สำหรับเก็บข้อมูลแต่ละประเภท
- ข้อมูลถูกจัดเก็บตามเดือน

## 🔄 Shared Utilities

### numberUtils.js:
- ฟังก์ชันจัดรูปแบบตัวเลข
- คำนวณผลรวม
- จัดการข้อมูลที่โหลดจาก API

### apiUtils.js:
- ฟังก์ชันเรียก API แต่ละประเภท
- Error handling
- Retry mechanism

## 📝 การใช้งาน

1. เลือกเดือนที่ต้องการดูข้อมูล
2. กรอกข้อมูลในตารางต่างๆ
3. กดปุ่มบันทึกเพื่อเซฟข้อมูล
4. ระบบจะแสดงผลรวมและคำนวณต่างๆ อัตโนมัติ

## 🎯 ประโยชน์ของโครงสร้างใหม่

✅ **แยกส่วนชัดเจน** - Frontend, Backend, Shared แยกกันชัดเจน  
✅ **ง่ายต่อการบำรุงรักษา** - แก้ไขส่วนไหนไม่กระทบส่วนอื่น  
✅ **ขยายง่าย** - เพิ่มฟีเจอร์ใหม่ได้สะดวก  
✅ **อ่านง่าย** - โครงสร้างเป็นระเบียบ เข้าใจง่าย  
✅ **ทำงานร่วมกันได้** - หลายคนแก้ไขพร้อมกันได้
