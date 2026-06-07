# Feature Spec: Savings Allocation System (สัดส่วนการออม)

**Feature Title:** Savings Allocation — กำหนดสัดส่วนการแบ่งเงินออมเป็น % ต่อถัง

**Date:** 2026-06-03

**Branch:** develop

**Status:** SPECIFICATION READY — Ready for implementation

**Replaces:** `SavingsGoalTracker` component (wrong feature — see section below)

---

## 1. GOAL

ให้ผู้ใช้สามารถสร้าง "ถังออม" (allocation buckets) พร้อมกำหนดสัดส่วน % ได้
เช่น Wedding 60%, Emergency Fund 40%

ทุกเดือนระบบจะคำนวณโดยอัตโนมัติว่าจากเงินที่ออมได้ (`ยอดรวมเงินเก็บรายเดือน` ใน SavingsTable)
แต่ละถังได้รับเงินเท่าไหร่ เช่น:

> ออม 10,000 บาท → Wedding ได้ 6,000 บาท, Emergency Fund ได้ 4,000 บาท

ไม่มี target amount, ไม่มี progress bar ไม่มี priority tier ไม่ใช่ goal tracker

---

## 2. WHAT IS CURRENTLY IMPLEMENTED (WRONG — MUST DELETE)

### ระบบปัจจุบัน: SavingsGoalTracker — Savings Goal Tracker

ไฟล์ที่สร้างขึ้นผิดความต้องการ:

| ไฟล์ | สิ่งที่ทำ |
|------|-----------|
| `src/frontend/components/SavingsGoalTracker.js` | Goal tracker ที่มี: ชื่อเป้าหมาย, target amount, progress bar %, priority (high/medium/low), category badge, waterfall allocation planner |
| `src/frontend/styles/SavingsGoalTracker.module.css` | CSS ของ goal tracker ข้างต้น |
| `pages/api/savings-goals.js` | API CRUD สำหรับ goal documents: `goalName`, `targetAmount`, `category`, `priority`, `status`, `endDate` |
| `src/backend/data/savings-goals.json` | ข้อมูล goals ต่อ userId (ปัจจุบัน `{}` ว่างเปล่า) |
| `scripts/setupSavingsGoalsCollection.js` | Script สร้าง MongoDB collection สำหรับ savingsGoals |

**Dependency ที่ตามมา (ต้องทำความสะอาดด้วย):**

- `src/frontend/components/SavingsTable.js:11` — import `savingsGoalsAPI`
- `src/frontend/components/SavingsTable.js:15` — import `SavingsGoalTracker`
- `src/frontend/components/SavingsTable.js:29–37` — `loadGoalNames()` ดึงชื่อ goals สำหรับ dropdown ใน savings row
- `src/frontend/components/SavingsTable.js:350` — render `<SavingsGoalTracker ...>`
- `src/frontend/components/SavingsTable.js:21` — prop `onAllocatableChange`
- `src/shared/utils/frontend/apiUtils.js:216–236` — `savingsGoalsAPI` object (getAll, create, update, delete)
- `src/frontend/components/SummaryReport.js:10` — import `savingsGoalsAPI`
- `src/frontend/components/SummaryReport.js:110` — call `savingsGoalsAPI.getAll()`
- `src/shared/utils/frontend/summaryUtils.js:34–37` — `totalSavingsGoalTarget` จาก goals
- `src/shared/utils/frontend/summaryUtils.js:46` — `รวมเป้าหมายเงินออม` field
- `src/frontend/components/SummaryReport.js:310–314` — row "รวมเป้าหมายเงินออม (เป้าหมายที่ยังดำเนินอยู่)"
- `pages/edit.js:226` — state `allocatableAmount`
- `pages/edit.js` — `<SavingsTable onAllocatableChange={setAllocatableAmount} ...>`
- `pages/edit.js` — `<SummaryReport allocatableAmount={allocatableAmount} ...>`

---

## 3. WHAT THE USER ACTUALLY WANTS (CORRECT)

### ระบบใหม่: Savings Allocation — แบ่งสัดส่วนการออม

**Mental model:**
ผู้ใช้ตั้งชื่อถังออมและกำหนด % ว่าเงินที่ออมได้แต่ละเดือนจะแบ่งยังไง

```
ถัง 1: Wedding         60%
ถัง 2: Emergency Fund  40%
                      ----
                      100%
```

**Calculation per month:**
```
เดือนนี้ออมได้ = sum(savings_list[].savings_amount)   [มาจาก SavingsTable]

Wedding         = เดือนนี้ออมได้ × 0.60
Emergency Fund  = เดือนนี้ออมได้ × 0.40
```

**ไม่มี:**
- Target amount (ไม่ track ว่าต้องออมเท่าไหร่รวม)
- Progress bar (ไม่มียอดสะสมเทียบ target)
- Priority tier (ไม่มี high/medium/low)
- Waterfall algorithm
- Completion status (completed/abandoned)
- Category badge

**มี:**
- ชื่อถัง (bucket name) — input text สั้นๆ
- สัดส่วน % — number input 0–100
- แสดงยอดเงินที่ถังนั้นได้รับเดือนนี้ (คำนวณ read-only)
- ผลรวม % ของถังทั้งหมด (แสดง warning ถ้า ≠ 100%)

---

## 4. WHERE THIS FEATURE LIVES IN THE UI

**ตำแหน่ง:** ใน `SavingsTable` component — ต่อจากส่วน "สรุปเงินออม" ก่อน InvestmentTable

```
SavingsTable
  ├── รายการเงินออม (existing — ไม่เปลี่ยน)
  ├── สรุปเงินออม (existing — ไม่เปลี่ยน)
  ├── [NEW] สัดส่วนการออม  <-- ตรงนี้
  └── การลงทุน (InvestmentTable — existing, เลื่อนลงไป)
  [REMOVE] SavingsGoalTracker (ลบออก)
```

**เหตุผล:** Allocation คำนวณจาก `ยอดรวมเงินเก็บ` ที่อยู่ใน SavingsTable อยู่แล้ว
การวางไว้ในไฟล์เดียวกันทำให้ส่งข้อมูลได้ตรงโดยไม่ต้อง prop drill ข้าม component

---

## 5. FILES TO MODIFY / CREATE / DELETE

### 5.1 ไฟล์ที่ต้อง DELETE ทั้งหมด

| ไฟล์ | เหตุผล |
|------|--------|
| `src/frontend/components/SavingsGoalTracker.js` | Wrong feature — goal tracker |
| `src/frontend/styles/SavingsGoalTracker.module.css` | CSS ของ wrong feature |
| `pages/api/savings-goals.js` | API ของ wrong feature |
| `src/backend/data/savings-goals.json` | Data file ของ wrong feature (ว่างอยู่แล้ว) |
| `scripts/setupSavingsGoalsCollection.js` | Setup script ของ wrong feature |

### 5.2 ไฟล์ที่ต้อง CREATE ใหม่

| ไฟล์ | สิ่งที่ทำ |
|------|-----------|
| `src/frontend/components/SavingsAllocation.js` | Component แสดง + จัดการ allocation buckets |
| `src/frontend/styles/SavingsAllocation.module.css` | CSS สำหรับ component ใหม่ |
| `pages/api/savings-allocation.js` | API GET/PUT สำหรับ allocation config ต่อ userId |
| `src/backend/data/savings-allocation.json` | JSON data store สำหรับ allocation config |

### 5.3 ไฟล์ที่ต้อง MODIFY

| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `src/frontend/components/SavingsTable.js` | ลบ import/render SavingsGoalTracker + savingsGoalsAPI, ลบ `goalNames` state + `loadGoalNames`, เปลี่ยน savings_type input เป็น plain text input (ไม่ใช้ goal dropdown อีกต่อไป), เพิ่ม import + render `<SavingsAllocation>` |
| `src/shared/utils/frontend/apiUtils.js` | ลบ `savingsGoalsAPI` object, เพิ่ม `savingsAllocationAPI` object |
| `src/frontend/components/SummaryReport.js` | ลบ import + call `savingsGoalsAPI`, ลบ row "รวมเป้าหมายเงินออม", ลบ prop `allocatableAmount`, ลบ `ควรเก็บต่อเดือน` row |
| `src/shared/utils/frontend/summaryUtils.js` | ลบ `totalSavingsGoalTarget` calculation และ `รวมเป้าหมายเงินออม` field |
| `pages/edit.js` | ลบ state `allocatableAmount`, ลบ prop `onAllocatableChange` จาก SavingsTable, ลบ prop `allocatableAmount` จาก SummaryReport |

---

## 6. DATA MODEL

### 6.1 Allocation Config (JSON mode)

ไฟล์: `src/backend/data/savings-allocation.json`

```json
{
  "u001": {
    "buckets": [
      {
        "id": "a1b2c3d4e5f6",
        "name": "Wedding",
        "percentage": 60
      },
      {
        "id": "7890abcdef12",
        "name": "Emergency Fund",
        "percentage": 40
      }
    ],
    "updatedAt": "2026-06-03T10:00:00.000Z"
  },
  "u002": {
    "buckets": [],
    "updatedAt": "2026-06-03T10:00:00.000Z"
  }
}
```

### 6.2 Bucket Object Schema

```ts
interface AllocationBucket {
  id: string;           // crypto.randomBytes(6).toString('hex') — 12 hex chars
  name: string;         // ชื่อถัง เช่น "Wedding", "กองทุนฉุกเฉิน"
  percentage: number;   // 0–100 ทศนิยมได้ เช่น 33.33
}
```

### 6.3 User Container Schema (per userId)

```ts
interface UserAllocationConfig {
  buckets: AllocationBucket[];
  updatedAt: string;   // ISO 8601
}
```

**Constraints:**
- Buckets ต่อ userId สูงสุด 20 ถัง (UI ก็ enforce แต่ API ก็ต้อง validate)
- `name` ต้องไม่ว่าง, trim แล้วต้องมีความยาว ≥ 1
- `percentage` ต้องเป็น number, 0 ≤ value ≤ 100
- ผลรวม % ไม่จำเป็นต้อง = 100% เสมอ (ระบบแสดง warning แต่ไม่ block save)

---

## 7. API SPECIFICATION

### 7.1 Endpoint: `/api/savings-allocation`

**Pattern ตาม:** `pages/api/savings-goals.js` (assertAuth + getUserId + isJsonMode() + handleJsonMode)

```js
// pages/api/savings-allocation.js

GET  /api/savings-allocation?userId=u001
  Response: { buckets: AllocationBucket[] }

PUT  /api/savings-allocation
  Body: { userId, buckets: AllocationBucket[] }
  Response: { success: true, buckets: AllocationBucket[] }
```

**Handler structure (follow savings-goals.js pattern):**

```js
import { assertApiToken } from '../../src/shared/utils/backend/apiTokenAuth';
import { isJsonMode, getMongoCollection } from '../../lib/dataSource';
import crypto from 'crypto';
const { getUserData, updateUserData } = require('../../src/backend/data/userUtils');

const ALLOCATION_JSON_FILE = 'savings-allocation.json';

function assertAuth(req, res) { return assertApiToken(req, res); }
function getUserId(req) { /* same pattern as savings-goals.js line 26–31 */ }

// JSON mode:
//   GET  → getUserData(ALLOCATION_JSON_FILE, userId) → return { buckets: [] } default
//   PUT  → validate buckets → updateUserData(ALLOCATION_JSON_FILE, userId, () => ({ buckets, updatedAt }))
//
// MongoDB mode:
//   Collection: 'savingsAllocations'
//   Document: { userId, buckets: [...], updatedAt }
//   Upsert on PUT (findOneAndUpdate with upsert: true)
```

**Validation rules (both modes):**
```
- buckets must be Array
- buckets.length <= 20
- each bucket: { id: string, name: string (non-empty after trim), percentage: number 0–100 }
- reject if any bucket fails validation → 400 with descriptive error
- auto-generate id if missing (crypto.randomBytes(6).toString('hex'))
```

### 7.2 Frontend API Client

เพิ่มใน `src/shared/utils/frontend/apiUtils.js`:

```js
export const savingsAllocationAPI = {
  get: async () => jsonFetch(buildUrl('/api/savings-allocation')),
  save: async (buckets) => jsonFetch('/api/savings-allocation', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: withUserPayload({ buckets })
  })
};
```

---

## 8. COMPONENT SPECIFICATION: SavingsAllocation

### 8.1 Props

```jsx
<SavingsAllocation
  monthlySavingsTotal={number}  // ยอดรวมเงินออมเดือนนี้ จาก SavingsTable
  triggerSave={number}          // trigger save pattern เหมือน components อื่นใน project
/>
```

### 8.2 State

```js
const [buckets, setBuckets] = useState([]);   // AllocationBucket[]
const [loading, setLoading] = useState(false);
```

### 8.3 Render Layout (wireframe)

```
┌─────────────────────────────────────────────┐
│  ⚙  สัดส่วนการออม          [+ เพิ่มถัง]    │
├─────────────────────────────────────────────┤
│  ยอดออมเดือนนี้: ฿10,000                    │
│  ผลรวม %: 100%  ✓  (หรือ ⚠ XX% ถ้าไม่ = 100)│
├─────────────────────────────────────────────┤
│  ชื่อถัง          %      ยอดที่ได้  [ลบ]    │
│  Wedding        [ 60]   ฿6,000      [✕]    │
│  Emergency Fund [ 40]   ฿4,000      [✕]    │
└─────────────────────────────────────────────┘
```

**Desktop:** table layout (เหมือน SavingsTable table เดิม)
**Mobile (< 768px):** card layout (เหมือน `.savingsCard` ใน SavingsTable.module.css)

### 8.4 Computed Values (read-only, ไม่ store)

```js
// คำนวณตอน render ไม่ต้อง API
const totalPercent = buckets.reduce((s, b) => s + (Number(b.percentage) || 0), 0);
const isBalanced = Math.abs(totalPercent - 100) < 0.01;

// ยอดที่แต่ละถังได้
const computed = buckets.map(b => ({
  ...b,
  amount: monthlySavingsTotal * (Number(b.percentage) / 100)
}));
```

### 8.5 Save Behavior

- Load on mount via `savingsAllocationAPI.get()`
- Save triggered by `triggerSave` prop (ใช้ pattern เดิมของโปรเจกต์)
- ไม่ต้องมีปุ่ม save แยก (ใช้ Save All ของ edit.js เช่นเดียวกับ component อื่น)

```js
// pattern เดียวกับ SavingsTable.js line 187–191
useEffect(() => {
  if (triggerSave) {
    handleSave();
  }
}, [triggerSave]);

async function handleSave() {
  try {
    await savingsAllocationAPI.save(buckets);
    showToast('บันทึกสัดส่วนการออมสำเร็จ');
  } catch (err) {
    showToast('บันทึกไม่สำเร็จ', 'error');
  }
}
```

---

## 9. CHANGES TO SavingsTable.js

### 9.1 ลบออก

```js
// ลบ imports
import { savingsGoalsAPI } from '../../shared/utils/frontend/apiUtils';
import SavingsGoalTracker from './SavingsGoalTracker';

// ลบ state
const [goalNames, setGoalNames] = useState([]);
const [goalRefreshTrigger, setGoalRefreshTrigger] = useState(0);

// ลบ function
const loadGoalNames = useCallback(async () => { ... }, []);
useEffect(() => { loadGoalNames(); }, [loadGoalNames]);

// ลบ prop
onAllocatableChange  // ใน function signature

// ลบ render (line 350)
<SavingsGoalTracker refreshTrigger={goalRefreshTrigger} selectedMonth={selectedMonth} onAllocatableChange={onAllocatableChange} />

// ลบใน handleSavingsSave (line 179)
setGoalRefreshTrigger(t => t + 1);
```

### 9.2 เปลี่ยน savings_type input

**ก่อน (ปัจจุบัน):** `<select>` ดึง `goalNames` จาก SavingsGoalTracker
**หลัง (ใหม่):** `<input type="text">` plain text เหมือน input อื่น

```jsx
// Desktop table (บรรทัดแถว savings_type)
<td className={styles.tableCell}>
  <input
    type="text"
    value={item.savings_type || ''}
    onChange={(e) => handleSavingsItemChange(index, 'savings_type', e.target.value)}
    placeholder="ชื่อรายการออม"
    className={styles.savingsInput}
  />
</td>
```

```jsx
// Mobile card (เหมือนกัน)
<input
  type="text"
  value={item.savings_type || ''}
  onChange={e => handleSavingsItemChange(index, 'savings_type', e.target.value)}
  placeholder="ชื่อรายการออม"
  className={styles.savingsInput}
/>
```

### 9.3 เพิ่มใหม่

```js
// เพิ่ม import
import SavingsAllocation from './SavingsAllocation';

// เปลี่ยน prop signature
export default function SavingsTable({ selectedMonth, triggerSave }) {
  // ลบ onAllocatableChange

// เพิ่ม render ระหว่าง "สรุปเงินออม" และ InvestmentTable
<SavingsAllocation
  monthlySavingsTotal={รวมเงินเก็บ}
  triggerSave={triggerSave}
/>
```

---

## 10. CHANGES TO SummaryReport.js

### 10.1 ลบออก (cleanup wrong feature)

```js
// ลบ import
import { ..., savingsGoalsAPI } from '../../shared/utils/frontend/apiUtils';

// ลบ prop
allocatableAmount = 0

// ลบ state field
ควรเก็บต่อเดือน: 0

// ลบ useEffect
useEffect(() => {
  setSummaryData(prev => ({ ...prev, ควรเก็บต่อเดือน: allocatableAmount }));
}, [allocatableAmount]);

// ลบ API call ใน loadByMonth
savingsGoalsAPI.getAll().catch(() => null)

// ลบ parameter ใน getSummaryData call
goalsData  // ลบออก

// ลบ render row
<div ... aria-label="รวมเป้าหมายเงินออม...">
  <span>รวมเป้าหมายเงินออม (เป้าหมายที่ยังดำเนินอยู่)</span>
  ...
</div>
<div ... aria-label="ควรเก็บต่อเดือน...">
  <span>ควรเก็บต่อเดือน</span>
  ...
</div>
```

---

## 11. CHANGES TO summaryUtils.js

### 11.1 ลบออก

```js
// ลบ parameter จาก getSummaryData
goalsData  // ลบออกจาก destructuring

// ลบ calculation
const goalsList = Array.isArray(goalsData) ? goalsData : (goalsData?.goals ?? []);
const totalSavingsGoalTarget = goalsList
  .filter(g => g && g.status !== 'completed' && g.status !== 'abandoned')
  .reduce((sum, g) => sum + (parseFloat(g.targetAmount || 0) || 0), 0);

// ลบ field ใน return object
รวมเป้าหมายเงินออม: totalSavingsGoalTarget
```

**Updated function signature:**

```js
export function getSummaryData({ incomeData, expenseData, savingsData, taxData, salaryData, currentMonth, currentYear }) {
  // ไม่มี goalsData อีกต่อไป
```

---

## 12. CHANGES TO apiUtils.js

```js
// ลบทั้งก้อน (lines 216–236)
export const savingsGoalsAPI = { ... };

// เพิ่มแทน
export const savingsAllocationAPI = {
  get: async () => jsonFetch(buildUrl('/api/savings-allocation')),
  save: async (buckets) => jsonFetch('/api/savings-allocation', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: withUserPayload({ buckets })
  })
};
```

---

## 13. CHANGES TO edit.js

```js
// ลบ state
const [allocatableAmount, setAllocatableAmount] = useState(0);

// เปลี่ยน SavingsTable (ลบ prop onAllocatableChange)
// ก่อน:
<SavingsTable selectedMonth={selectedMonth} triggerSave={triggerSave} onAllocatableChange={setAllocatableAmount} />
// หลัง:
<SavingsTable selectedMonth={selectedMonth} triggerSave={triggerSave} />

// เปลี่ยน SummaryReport (ลบ prop allocatableAmount)
// ก่อน:
<SummaryReport selectedMonth={selectedMonth} onReportDataReady={...} allocatableAmount={allocatableAmount} />
// หลัง:
<SummaryReport selectedMonth={selectedMonth} onReportDataReady={...} />
```

---

## 14. EXISTING PATTERNS TO FOLLOW

### 14.1 triggerSave pattern (SavingsTable.js:187–191)

```js
useEffect(() => {
  if (triggerSave) {
    handleSavingsSave();
  }
}, [triggerSave]);
```

ใช้ pattern เดิมทุกประการ — `triggerSave` เป็น counter เพิ่มขึ้นทุกครั้งที่ user กด Save All

### 14.2 showToast pattern (SavingsTable.js:180–184)

```js
import { showToast } from '../../shared/utils/frontend/toast';
showToast('บันทึก...สำเร็จ');
showToast('บันทึกไม่สำเร็จ กรุณาลองใหม่', 'error');
```

ห้ามใช้ `alert()` หรือ `confirm()` — ใช้ `showToast` เท่านั้น (per bug-log.md BUG-1)

### 14.3 assertApiToken pattern (savings-goals.js:22–24)

```js
import { assertApiToken } from '../../src/shared/utils/backend/apiTokenAuth';
function assertAuth(req, res) { return assertApiToken(req, res); }
```

### 14.4 getUserData / updateUserData pattern (savings-goals.js:79–86)

```js
const { getUserData, updateUserData } = require('../../src/backend/data/userUtils');
function getJsonAllocation(userId) {
  const bucket = getUserData(ALLOCATION_JSON_FILE, userId);
  return Array.isArray(bucket?.buckets) ? bucket.buckets : [];
}
function setJsonAllocation(userId, buckets) {
  updateUserData(ALLOCATION_JSON_FILE, userId, () => ({
    buckets,
    updatedAt: new Date().toISOString()
  }));
}
```

### 14.5 CSS variables (ห้ามใช้ hardcode — per bug-log.md BUG-2)

```css
/* ใช้เท่านี้: */
var(--secondary-color)
var(--text-primary), var(--text-secondary), var(--text-light)
var(--border-color), var(--border-light)
var(--bg-surface), var(--bg-surface-alt), var(--bg-primary)
var(--danger-color), var(--warning-color)
var(--shadow-md)
```

### 14.6 Mobile card pattern (SavingsTable.module.css — `.savingsCard`)

Component ใหม่ควรใช้ pattern desktop table + mobile card เหมือน SavingsTable เดิม
Breakpoint: **768px** (project standard ตาม CLAUDE.md section 2.4)

### 14.7 isJsonMode / getMongoCollection (dataSource.js:22–23, 63–66)

```js
import { isJsonMode, getMongoCollection } from '../../lib/dataSource';
if (isJsonMode()) {
  return handleJsonMode(req, res, userId);
}
// MongoDB path
const col = await getMongoCollection('savingsAllocations');
```

---

## 15. EDGE CASES

| Case | พฤติกรรมที่ถูกต้อง |
|------|---------------------|
| ไม่มีถังออม (empty state) | แสดง empty state "ยังไม่มีสัดส่วนการออม กดเพิ่มถังเพื่อเริ่มต้น" |
| ผลรวม % ≠ 100 | แสดง warning แบบ inline "ผลรวมสัดส่วนคือ XX% (ควรรวมได้ 100%)" — ไม่ block save |
| ผลรวม % = 0 | แสดง warning เช่นกัน |
| ผลรวม % = 100 | แสดง ✓ ข้างผลรวม |
| ผลรวม % > 100 | แสดง warning สีแดง — ไม่ block save แต่ยอดจะเกินจริง |
| `monthlySavingsTotal` = 0 | แสดงทุกถังเป็น ฿0 (ยังแสดง row อยู่) |
| ชื่อถังว่าง | ไม่อนุญาตให้ save (validate ก่อน handleSave) ด้วย `showToast('กรุณากรอกชื่อถัง', 'error')` |
| percentage ว่างหรือ NaN | ใช้ 0 เป็น default ตอนคำนวณ |
| percentage > 100 | reject inline: "% ต้องอยู่ระหว่าง 0–100" via showToast |
| percentage < 0 | reject inline เช่นกัน |
| ถังซ้ำชื่อ | อนุญาตได้ (user อาจตั้งใจ) — ไม่ต้อง block |
| ถัง > 20 | ปุ่ม "+ เพิ่มถัง" disabled เมื่อถึง limit |
| API save ล้มเหลว | showToast('บันทึกสัดส่วนการออมไม่สำเร็จ', 'error') — ไม่ reset state |
| API load ล้มเหลว | setBuckets([]) gracefully — ไม่ break component |
| User ยังไม่มี allocation ใน DB | API GET return `{ buckets: [] }` — component แสดง empty state |

---

## 16. OUT OF SCOPE

- **ไม่** track ยอดสะสมรวมทุกเดือนต่อถัง (เช่น ถัง Wedding ออมสะสมไปแล้ว X บาท)
- **ไม่** มี target amount ต่อถัง
- **ไม่** มี progress bar หรือ completion percentage
- **ไม่** มี category หรือ priority
- **ไม่** เชื่อมกับ savings_type ใน savings_list (ไม่ auto-sum จากชื่อ)
- **ไม่** export หรือ print allocation report
- **ไม่** แสดงกราฟหรือ chart
- **ไม่** ส่งผลไปยัง LINE notification
- **ไม่** แก้ไข InvestmentTable, TaxTable, IncomeTable, ExpenseTable

---

## 17. ACCEPTANCE CRITERIA

### AC-1: ถังออมแสดงผลและแก้ไขได้

**Given** ผู้ใช้เปิด tab "ออม" ใน edit page,
**When** scroll ถึงส่วน "สัดส่วนการออม",
**Then** เห็น list ของถังออมที่บันทึกไว้ (หรือ empty state ถ้าไม่มี),
**AND** สามารถแก้ชื่อและ % แต่ละถังได้โดยตรงใน input field

### AC-2: เพิ่มถังใหม่

**Given** ผู้ใช้คลิกปุ่ม "เพิ่มถัง",
**When** ถังใหม่ถูกเพิ่ม,
**Then** มีแถวใหม่ที่ชื่อว่างและ % = 0 พร้อมให้กรอก

### AC-3: ลบถัง

**Given** ผู้ใช้คลิกปุ่มลบ [✕] ข้างถัง,
**When** ยืนยันการลบ (inline confirmation — ห้ามใช้ `confirm()`),
**Then** ถังนั้นหายออกจาก list

### AC-4: คำนวณยอดต่อถังอัตโนมัติ

**Given** `monthlySavingsTotal` = 10,000 บาท และมีถัง Wedding 60%, Emergency Fund 40%,
**When** render,
**Then** Wedding แสดง ฿6,000, Emergency Fund แสดง ฿4,000

### AC-5: แสดงผลรวม %

**Given** ถังทั้งหมดรวมกันได้ 100%,
**When** render,
**Then** แสดง "ผลรวม: 100% ✓" ในสีปกติ

**Given** ถังรวมกันได้ไม่ = 100%,
**When** render,
**Then** แสดง "ผลรวม: XX% ⚠ ควรรวมได้ 100%" ในสีเหลือง/warning — ไม่ block การ save

### AC-6: บันทึกผ่าน Save All

**Given** ผู้ใช้แก้ไขถังแล้วกดปุ่ม "บันทึก" (floating bar),
**When** `triggerSave` เพิ่มขึ้น,
**Then** `savingsAllocationAPI.save(buckets)` ถูกเรียก,
**AND** แสดง toast "บันทึกสัดส่วนการออมสำเร็จ",
**AND** ข้อมูลถูก persist ใน `savings-allocation.json` ต่อ userId

### AC-7: โหลดข้อมูลเมื่อ mount

**Given** user เปิดหน้า edit page,
**When** SavingsAllocation mount,
**Then** `savingsAllocationAPI.get()` ถูกเรียก,
**AND** buckets ถูก populate จาก API response

### AC-8: ไม่มี confirm() หรือ alert()

**Given** ทุก action ใน SavingsAllocation,
**When** action เสร็จสิ้น,
**Then** ไม่มี native dialog box ปรากฏ ทุก feedback ใช้ `showToast` เท่านั้น

### AC-9: CSS ใช้ variables เท่านั้น

**Given** ไฟล์ `SavingsAllocation.module.css` ถูก render,
**When** inspect CSS,
**Then** ไม่มี hardcoded hex color ใดๆ ทุก color reference ใช้ `var(--*)` CSS variables

### AC-10: Mobile responsive

**Given** viewport < 768px,
**When** render SavingsAllocation,
**Then** แสดงเป็น card layout (ไม่ใช่ table), tap targets ≥ 44px, input เต็มความกว้าง

### AC-11: SavingsGoalTracker ถูกลบออกสมบูรณ์

**Given** implementation เสร็จสิ้น,
**When** ตรวจ codebase,
**Then** ไม่มี import `SavingsGoalTracker` หรือ `savingsGoalsAPI` ในไฟล์ใดๆ,
**AND** row "รวมเป้าหมายเงินออม" และ "ควรเก็บต่อเดือน" ไม่ปรากฏใน SummaryReport อีกต่อไป

### AC-12: savings_type เป็น plain text input

**Given** ผู้ใช้กรอกรายการออมใน SavingsTable,
**When** กรอกชื่อรายการ,
**Then** ชื่อรายการเป็น `<input type="text">` ธรรมดา (ไม่ใช่ `<select>` dropdown ที่ดึง goal names)

### AC-13: API per-user isolation

**Given** user u001 บันทึก allocation ของตัวเอง,
**When** user u002 เรียก GET /api/savings-allocation,
**Then** u002 ได้รับ buckets ของ u002 เท่านั้น (ไม่ cross-user)

---

## 18. IMPLEMENTATION ORDER (สำหรับ coder)

1. สร้าง `pages/api/savings-allocation.js` + `src/backend/data/savings-allocation.json` (ว่าง `{}`)
2. เพิ่ม `savingsAllocationAPI` ใน `apiUtils.js` + ลบ `savingsGoalsAPI`
3. สร้าง `SavingsAllocation.js` + `SavingsAllocation.module.css`
4. แก้ `SavingsTable.js`: ลบ goal-related code, เพิ่ม `<SavingsAllocation>`, เปลี่ยน select → input
5. แก้ `SummaryReport.js`: ลบ goals-related rows/props/API calls
6. แก้ `summaryUtils.js`: ลบ goals parameter + field
7. แก้ `edit.js`: ลบ `allocatableAmount` state + props
8. ลบไฟล์: `SavingsGoalTracker.js`, `SavingsGoalTracker.module.css`, `savings-goals.js` API, `savings-goals.json`, `setupSavingsGoalsCollection.js`
9. ทดสอบ: เพิ่ม/ลบถัง, save + reload, คำนวณยอดถูกต้อง, mobile layout

---

## END OF SPEC

**Status:** READY FOR IMPLEMENTATION

**Key decision:** Allocation is purely a percentage split configuration, not a goal tracker. No target amounts, no progress bars, no priority tiers. The only computation is: `bucket.amount = monthlySavingsTotal × (bucket.percentage / 100)`.
