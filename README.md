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
