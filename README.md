# FinanceTrack - ระบบจัดการการเงินส่วนบุคคล

FinanceTrack เป็นเว็บแอปสำหรับติดตามรายรับ รายจ่าย เงินออม ภาษี และการลงทุนแบบรายเดือน รองรับหลายผู้ใช้ และรองรับทั้งการเก็บข้อมูลแบบ JSON และ MongoDB

## โครงสร้างโปรเจกต์ (ปัจจุบัน)

```text
FinanceTrack/
├── pages/
│   ├── index.js                  # redirect ไปหน้าแก้ไขหลัก
│   ├── edit.js                   # หน้าหลักของแอป (tab รายรับ/รายจ่าย/เงินออม/ภาษี/สรุป/เงินเดือน)
│   ├── profiles.js               # เลือกโปรไฟล์และล็อกอิน
│   ├── line_notify.js            # หน้าทดสอบส่งข้อความ LINE
│   └── api/
│       ├── auth/profile-login.js
│       ├── users.js
│       ├── change_password.js
│       ├── monthly_income.js
│       ├── monthly_expense.js
│       ├── savings.js
│       ├── salary.js
│       ├── investment.js
│       ├── tax_accumulated.js
│       ├── line_notify.js
│       ├── line_webhook.js
│       └── line_due_notify.js
│
├── src/
│   ├── frontend/
│   │   ├── components/           # React Components หลักทั้งหมด
│   │   ├── contexts/             # SessionContext / ThemeContext
│   │   ├── styles/               # CSS modules และ global css
│   │   └── config/               # ค่าที่ใช้ฝั่ง frontend (เช่น encoded line config)
│   │
│   ├── backend/
│   │   └── data/                 # JSON data files + userUtils/users.json
│   │
│   └── shared/
│       └── utils/
│           ├── backend/          # utility ฝั่ง API (apiUtils, userRequest)
│           ├── frontend/         # utility ฝั่ง UI/API client
│           ├── commonUtils.js
│           ├── dateUtils.js
│           ├── expenseUtils.js
│           ├── incomeUtils.js
│           ├── investmentUtils.js
│           ├── salaryUtils.js
│           ├── savingsUtils.js
│           ├── taxUtils.js
│           ├── lineConfig.js
│           └── sendLineMessage.js
│
├── lib/
│   ├── dataMode.config.js        # สลับโหมดข้อมูล json/mongo ผ่าน DATA_MODE
│   ├── dataSource.js             # abstraction layer ระหว่าง JSON และ MongoDB
│   └── mongodb.js                # MongoDB connection
│
├── scripts/
│   ├── createUser.js
│   ├── migrateToMultiUser.js
│   ├── migrateMongoUserIds.js
│   ├── importJsonToMongo.js
│   └── printMongoCollections.js
│
├── package.json
└── next.config.js
```

## ฟีเจอร์หลัก

- จัดการรายรับรายเดือน (รองรับรายการ dynamic)
- จัดการรายจ่ายรายเดือน (estimate/actual, paid, due day)
- จัดการเงินออมและรายการเงินออม
- จัดการภาษีรายปี/รายเดือน
- จัดการเงินเดือน (income/deduction/summary)
- จัดการการลงทุนรายเดือน
- สรุปรายงานภาพรวมการเงินรายเดือน
- ระบบโปรไฟล์ผู้ใช้ + PIN login + เปลี่ยนรหัสผ่าน
- แจ้งเตือน LINE (ส่งข้อความ, webhook เชื่อม user, แจ้งเตือนค่าใช้จ่ายถึงกำหนด)
- จำกัดข้อมูลย้อนหลังสูงสุด 15 เดือน (ในตารางรายเดือน)

## เทคโนโลยีที่ใช้

- Frontend: React + Next.js (Pages Router)
- Backend: Next.js API Routes
- Database Mode:
  - JSON files (ค่าเริ่มต้น)
  - MongoDB (เมื่อกำหนด `DATA_MODE=mongo`)
- Language: JavaScript (ES6+)

> เวอร์ชันปัจจุบันอ้างอิงจาก `package.json`: `next ^16.1.6`, `mongodb ^6.20.0`

## การติดตั้งและรัน

```bash
npm install
npm run dev
```

เปิดใช้งานที่ `http://localhost:3000`

## Environment Variables (ที่ใช้จริง)

ตัวอย่างไฟล์ `.env.local`

```env
# json | mongo (ถ้าไม่กำหนดจะเป็น json)
DATA_MODE=json

# ใช้เมื่อ DATA_MODE=mongo
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster/<db>
# (optional) บางสคริปต์รองรับ MONGODB_DB

# ป้องกัน endpoint cron แจ้งเตือน LINE
CRON_SECRET=<your-secret>

# =============================
# API Bearer Token Protection
# =============================
# (แนะนำ) ฝั่ง server ใช้ token แบบเข้ารหัส AES
API_ACCESS_TOKEN_ENCRYPTION_KEY=<your-encryption-passphrase>
API_ACCESS_TOKEN_ENCRYPTED=<iv_hex:cipher_hex>

# (fallback) token แบบ base64/plaintext
API_ACCESS_TOKEN_B64=<base64-token>
# API_ACCESS_TOKEN=<plain-token>

# ฝั่ง client (จำเป็นต้องส่ง header เรียก API)
# ควรเป็นค่าเดียวกับ token จริง (base64 ของ token เดียวกัน)
NEXT_PUBLIC_API_ACCESS_TOKEN_B64=<base64-token>
# NEXT_PUBLIC_API_ACCESS_TOKEN=<plain-token>

# ใช้ตรวจสอบลายเซ็น webhook ของ LINE
LINE_CHANNEL_SECRET=<your-line-channel-secret>
```

### ตัวอย่างสร้าง token และเข้ารหัส (AES-256-CBC)

1) สร้าง token และ base64

```bash
TOKEN="your-very-strong-token"
echo -n "$TOKEN" | base64
```

2) สร้างค่า `API_ACCESS_TOKEN_ENCRYPTED`

```bash
TOKEN="your-very-strong-token"
SECRET="your-encryption-passphrase"

node -e "const crypto=require('crypto');const token=process.env.TOKEN;const secret=process.env.SECRET;const key=crypto.createHash('sha256').update(secret).digest();const iv=crypto.randomBytes(16);const cipher=crypto.createCipheriv('aes-256-cbc',key,iv);const enc=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);console.log(iv.toString('hex')+':'+enc.toString('hex'));"
```

3) ตั้งค่าใน Vercel (Project → Settings → Environment Variables)

- `API_ACCESS_TOKEN_ENCRYPTION_KEY`
- `API_ACCESS_TOKEN_ENCRYPTED`
- `NEXT_PUBLIC_API_ACCESS_TOKEN_B64`

แล้ว Redeploy โปรเจกต์ 1 รอบ

## Migration และสคริปต์สำคัญ

### 1) ย้ายข้อมูลให้รองรับหลายผู้ใช้ (JSON)

```bash
node scripts/migrateToMultiUser.js
```

### 2) เติม `userId` ให้ข้อมูลใน MongoDB

```bash
MONGODB_URI="mongodb+srv://<user>:<pass>@cluster" node scripts/migrateMongoUserIds.js u001
```

### 3) สร้างผู้ใช้ใหม่ (พร้อม hash รหัสผ่าน)

```bash
node scripts/createUser.js "ชื่อบนโปรไฟล์" "รหัสผ่าน" [/avatars/u003.jpg] [customUserId]
```

### 4) นำเข้าข้อมูล JSON ไป MongoDB

```bash
node scripts/importJsonToMongo.js
```

## เส้นทางหน้าเว็บหลัก

- `/profiles` เลือกโปรไฟล์และเข้าสู่ระบบ
- `/` redirect ไป `/edit`
- `/edit` หน้าจัดการข้อมูลการเงินหลัก
- `/line_notify` หน้าทดสอบส่ง LINE และคัดลอก webhook URL

## API หลัก

- Auth/User
  - `POST /api/auth/profile-login`
  - `GET /api/users`
  - `POST /api/change_password`
- Financial Data
  - `GET/POST /api/monthly_income`
  - `GET/POST /api/monthly_expense`
  - `GET/POST /api/savings`
  - `GET/POST/DELETE /api/salary`
  - `GET/POST /api/investment`
  - `GET/POST/DELETE /api/tax_accumulated`
- LINE
  - `POST /api/line_notify`
  - `POST /api/line_webhook`
  - `GET/POST /api/line_due_notify`

## หมายเหตุการใช้งาน

- ถ้าใช้โหมด JSON ให้ตรวจสอบไฟล์ใน `src/backend/data/`
- ถ้าใช้โหมด Mongo ให้ตั้ง `DATA_MODE=mongo` และ `MONGODB_URI`
- ระบบหน้า `/edit` ต้องมี session ผู้ใช้ ถ้ายังไม่ล็อกอินจะพาไป `/profiles`
