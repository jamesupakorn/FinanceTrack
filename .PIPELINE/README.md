# FinanceTrack - ระบบจัดการการเงินส่วนบุคคล

FinanceTrack เป็นเว็บแอปติดตามการเงินรายเดือนแบบหลายผู้ใช้สำหรับรายรับ รายจ่าย เงินออม เป้าหมายเงินออม ภาษี เงินเดือน และการลงทุน รองรับทั้ง JSON mode และ MongoDB mode โดยใช้ Next.js Pages Router

## สถานะปัจจุบัน

- App version: `2.2.10`
- Runtime: Node.js `>=20.9.0`
- Frontend/Backend: Next.js `^16.1.6`, React, Next API Routes
- Data modes: JSON default, MongoDB เมื่อกำหนด `DATA_MODE=mongo`
- Test posture: ยังไม่มี test framework ใน `package.json`; validation หลักเป็น build/runtime/manual static verification

## โครงสร้างโปรเจกต์ (รีเฟรช)

```text
FinanceTrack/
├── pages/
│   ├── index.js                  # re-export หน้า edit เป็น entrypoint หลัก
│   ├── edit.js                   # หน้าจัดการข้อมูลหลักแบบ tab
│   ├── profiles.js               # เลือกโปรไฟล์และล็อกอิน
│   ├── line_notify.js            # หน้าทดสอบ LINE notify
│   └── api/
│       ├── auth/profile-login.js
│       ├── users.js
│       ├── change_password.js
│       ├── monthly_income.js
│       ├── monthly_expense.js
│       ├── savings.js
│       ├── savings-allocation.js
│       ├── savings-goals.js
│       ├── salary.js
│       ├── investment.js
│       ├── tax_accumulated.js
│       ├── user-bank-accounts.js
│       ├── line_notify.js
│       ├── line_webhook.js
│       └── line_due_notify.js
├── lib/
│   ├── dataMode.config.js        # อ่าน DATA_MODE
│   ├── dataSource.js             # abstraction ระหว่าง JSON และ MongoDB
│   └── mongodb.js                # MongoDB connection
├── src/
│   ├── backend/data/             # JSON stores + userUtils/users.json
│   ├── frontend/components/      # ตาราง/การ์ดรายเดือน, tracker, modal, toast
│   ├── frontend/contexts/        # SessionContext, ThemeContext
│   ├── frontend/styles/          # CSS modules + globals.css
│   └── shared/utils/
│       ├── backend/              # api token auth, user request helpers
│       ├── frontend/             # apiUtils, sessionClient, toast, number utils
│       └── *.js                  # domain utils เช่น date/expense/income/savings
├── scripts/
│   ├── createUser.js
│   ├── exportMongoToJson.js
│   ├── importJsonToMongo.js
│   ├── migrateBankAccounts.js
│   ├── migrateMongoUserIds.js
│   ├── migrateRemoveEstimateMongo.js
│   ├── migrateToMultiUser.js
│   ├── printMongoCollections.js
│   └── setupSavingsGoalsCollection.js
├── .PIPELINE/
├── package.json
└── next.config.js
```

## ฟีเจอร์หลัก

- รายรับ รายจ่าย เงินออม ภาษี เงินเดือน และการลงทุนรายเดือน
- เป้าหมายเงินออม (`SavingsGoalTracker`) พร้อมคำนวณ `currentAmount` จาก savings จริง
- ระบบผู้ใช้หลายคนพร้อม session ฝั่ง client และบัญชีธนาคารแยกตาม user
- Save All flow จาก `pages/edit.js` พร้อม floating action bar นำทางเดือน
- Mobile UX ที่แตกเป็น card layout และ collapsible sections ที่ breakpoint `768px`
- LINE notify, webhook และ due-date notification ที่รองรับกรณีสิ้นเดือน `EOM`
- Toast feedback กลางแทน `alert()`/`confirm()`

## หน้าและ flow สำคัญ

- `/` ใช้ `pages/index.js` re-export ไปหน้า `/edit`
- `/profiles` เป็นประตูเข้าใช้งานและโหลด session ผู้ใช้
- `/edit` เป็นหน้าทำงานหลัก มี tabs, save trigger, summary report และ goal tracker
- `/line_notify` ใช้ทดสอบการเชื่อม LINE และคัดลอก webhook URL

## API ที่ใช้งานประจำ

- Auth/User
  - `POST /api/auth/profile-login`
  - `GET /api/users`
  - `POST /api/change_password`
  - `GET/POST /api/user-bank-accounts`
- Financial data
  - `GET/POST /api/monthly_income`
  - `GET/POST /api/monthly_expense`
  - `GET/POST /api/savings`
  - `GET/POST/PUT/DELETE /api/savings-goals`
  - `GET/PUT /api/savings-allocation`
  - `GET/POST/DELETE /api/salary`
  - `GET/POST /api/investment`
  - `GET/POST/DELETE /api/tax_accumulated`
- LINE
  - `POST /api/line_notify`
  - `POST /api/line_webhook`
  - `GET/POST /api/line_due_notify`

## Environment Variables ที่ใช้จริง

```env
DATA_MODE=json
MONGODB_URI=mongodb://<user>:<pass>@host:27017/<db>?authSource=admin
CRON_SECRET=<your-secret>
API_ACCESS_TOKEN_ENCRYPTION_KEY=<your-encryption-passphrase>
API_ACCESS_TOKEN_ENCRYPTED=<iv_hex:cipher_hex>
API_ACCESS_TOKEN_B64=<base64-token>
NEXT_PUBLIC_API_ACCESS_TOKEN_B64=<base64-token>
LINE_CHANNEL_SECRET=<your-line-channel-secret>
```

หมายเหตุ:
- production ควรตั้ง API token ให้ครบ; dev เท่านั้นที่ยอมให้บาง endpoint ข้าม token ได้ตาม backend guard ปัจจุบัน
- ถ้าใช้ MongoDB ในเครื่องนี้ให้ใช้ `mongodb://` ตามแนวทางใน pipeline config ไม่ใช่ `mongodb+srv://`

## สคริปต์ใช้งานบ่อย

```bash
npm run dev
node scripts/createUser.js "ชื่อบนโปรไฟล์" "รหัสผ่าน" [/avatars/u003.jpg] [customUserId]
node scripts/importJsonToMongo.js
node scripts/exportMongoToJson.js
node scripts/migrateToMultiUser.js
node scripts/migrateBankAccounts.js
```

## หมายเหตุการพัฒนาต่อ

- component ฝั่ง frontend ควรเรียก API ผ่าน `src/shared/utils/frontend/apiUtils.js` เป็นหลัก
- หน้า `/edit` ผูกกับ session ผู้ใช้ ถ้ายังไม่ล็อกอินจะ redirect ไป `/profiles`
- goal totals ใน summary ใช้ `savingsGoalsAPI.getAll()` แบบ fire-and-forget เพื่อไม่บล็อก chart data
- ข้อมูลบัญชีธนาคารเป็น per-user และโหลดผ่าน `SessionContext` หลังเลือกโปรไฟล์
