# Spec: Restore Missing SummaryReport Rows & Wiring

**Date:** 2026-06-03
**Branch:** develop
**Type:** Restoration (SummaryReport.js reverted to earlier version)
**Scope:** Add back 2 rows + prop wiring that were lost in the revert

---

## 1. Goal

SummaryReport.js was reverted and lost 4 things. Restore them exactly:

| # | What | Where |
|---|------|-------|
| 1 | `allocatableAmount` prop in component signature | `SummaryReport.js` |
| 2 | `savingsGoalsAPI` import | `SummaryReport.js` |
| 3 | "ควรเก็บต่อเดือน" row in summaryGrid | `SummaryReport.js` |
| 4 | "รวมเป้าหมายเงินออม" row in summaryGrid | `SummaryReport.js` |

These four require completing the data chain through 4 additional files.

---

## 2. What Already Exists Correctly

These do NOT need to be created or changed — they exist and work:

| Asset | File | Note |
|-------|------|------|
| `.itemValue.goalTarget` CSS class | `SummaryReport.module.css:311–314` | Use for "รวมเป้าหมายเงินออม" value |
| `.itemValue.income` CSS class | `SummaryReport.module.css:289–295` | Use for "ควรเก็บต่อเดือน" value (green gradient) |
| `setSummaryData(prev => ({ ...prev, ...summary }))` spread pattern | `SummaryReport.js:127` | Already correct — BUG-5 from bug-log is already fixed |
| `savingsAllocationAPI` export | `apiUtils.js:216–223` | Separate feature; leave untouched |
| `SavingsGoalTracker.js` component | Working tree (untracked) | Exists, but missing `onAllocatableChange` prop |
| `currentAllocatable` computed variable | `SavingsGoalTracker.js:155–164` | Computed correctly; just not passed to parent |
| `pages/api/savings-allocation.js` | API endpoint | Unrelated; leave untouched |

---

## 3. What Is Missing (by file)

### 3.1 MISSING — `pages/api/savings-goals.js`

**Status:** File does not exist. Never committed. Blocking dependency for `savingsGoalsAPI`.

**Must create.** Minimal required interface:
- `GET /api/savings-goals?userId=X` → `{ goals: [...] }`
- `POST /api/savings-goals` (body: `{ userId, goalName, targetAmount, category, priority, ... }`) → `{ success: true, goal: {...} }`
- `PUT /api/savings-goals` (body: `{ userId, id, ...fields }`) → `{ success: true, goal: {...} }`
- `DELETE /api/savings-goals` (body: `{ userId, id }`) → `{ success: true }`

Each `goal` object shape (minimum):
```
{ _id: string, userId: string, goalName: string, targetAmount: number,
  currentAmount: number, status: 'active'|'completed'|'abandoned',
  priority: 'high'|'medium'|'low', category: string,
  metadata: { progressPercentage: number, remainingAmount: number } }
```

Follow the same JSON/MongoDB dual-mode pattern as `pages/api/savings-allocation.js`.
JSON file: `src/backend/data/savings-goals.json`
Collection name: `savingsGoals`

---

### 3.2 MISSING — `savingsGoalsAPI` export in `apiUtils.js`

**Current:** `apiUtils.js` has no `savingsGoalsAPI`. `SavingsGoalTracker.js` imports it at line 7 but it isn't there.

**Add after `salaryAPI` block (after line 204 in current file):**

```js
export const savingsGoalsAPI = {
  getAll: async () => jsonFetch(buildUrl('/api/savings-goals')),
  create: async (payload) => jsonFetch('/api/savings-goals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: withUserPayload(payload)
  }),
  update: async (id, payload) => jsonFetch('/api/savings-goals', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: withUserPayload({ id, ...payload })
  }),
  delete: async (id) => jsonFetch('/api/savings-goals', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: withUserPayload({ id })
  })
};
```

Insert before `savingsAllocationAPI` (before the line `export const savingsAllocationAPI = {`).

---

### 3.3 MISSING — `onAllocatableChange` wiring in `SavingsGoalTracker.js`

`currentAllocatable` is computed at lines 155–164 but never passed to the parent.

**Change 1 — function signature (line 83):**
```js
// Before:
export default function SavingsGoalTracker({ refreshTrigger, selectedMonth }) {

// After:
export default function SavingsGoalTracker({ refreshTrigger, selectedMonth, onAllocatableChange }) {
```

**Change 2 — add useEffect after `currentAllocatable` computation (after line 164):**
```js
// Add after the `const currentAllocatable = ...` block (line 164):
useEffect(() => {
  if (typeof onAllocatableChange === 'function') {
    onAllocatableChange(currentAllocatable);
  }
}, [currentAllocatable, onAllocatableChange]);
```

---

### 3.4 MISSING — wiring in `edit.js`

Three things missing:
1. Import `SavingsGoalTracker`
2. `allocatableAmount` state
3. Mount `<SavingsGoalTracker>` in savings tab with `onAllocatableChange`
4. Pass `allocatableAmount` to `<SummaryReport>`

**Change 1 — add import (near top, with other component imports, around line 8):**
```js
// Add after: import SavingsTable from '../src/frontend/components/SavingsTable';
import SavingsGoalTracker from '../src/frontend/components/SavingsGoalTracker';
```

**Change 2 — add state (in the state block, around line 216):**
```js
// Add after: const [triggerSave, setTriggerSave] = useState(0);
const [allocatableAmount, setAllocatableAmount] = useState(0);
```

**Change 3 — pass prop to SummaryReport (around line 638–643):**
```jsx
// Before:
<SummaryReport
  selectedMonth={selectedMonth}
  key={`summary-${refreshTrigger}`}
/>

// After:
<SummaryReport
  selectedMonth={selectedMonth}
  key={`summary-${refreshTrigger}`}
  allocatableAmount={allocatableAmount}
/>
```

**Change 4 — mount SavingsGoalTracker in savings tab (around line 710, after `</SavingsTable>`):**
```jsx
// Add after </SavingsTable>:
<SavingsGoalTracker
  refreshTrigger={refreshTrigger}
  selectedMonth={selectedMonth}
  onAllocatableChange={setAllocatableAmount}
/>
```

---

### 3.5 MISSING — 4 changes in `SummaryReport.js`

**Change 1 — add `savingsGoalsAPI` to import (line 10):**
```js
// Before:
import { incomeAPI, expenseAPI, savingsAPI, taxAPI, salaryAPI } from '../../shared/utils/frontend/apiUtils';

// After:
import { incomeAPI, expenseAPI, savingsAPI, taxAPI, salaryAPI, savingsGoalsAPI } from '../../shared/utils/frontend/apiUtils';
```

**Change 2 — add `allocatableAmount` to component signature (line 19):**
```js
// Before:
const SummaryReport = ({ selectedMonth, onReportDataReady }) => {

// After:
const SummaryReport = ({ selectedMonth, onReportDataReady, allocatableAmount }) => {
```

**Change 3 — add `totalGoalsTarget` state (in useState block, after line 30):**
```js
// Add after: ยอดเงินคงเหลือ: 0
// }));
const [totalGoalsTarget, setTotalGoalsTarget] = useState(0);
```

**Change 4 — fetch goals in `loadSummaryData` (after line 127, after the setSummaryData call):**

Surrounding context:
```js
      setEffectiveMonth(monthToUse);
      setSummaryData(prev => ({ ...prev, ...summary }));   // line 127
      setChartData(computedChartData);
```

Insert between `setSummaryData` and `setChartData`:
```js
      setSummaryData(prev => ({ ...prev, ...summary }));
      // Fetch active goals total (non-blocking)
      try {
        const goalsRes = await savingsGoalsAPI.getAll();
        const activeGoals = (goalsRes?.goals || [])
          .filter(g => g.status !== 'completed' && g.status !== 'abandoned');
        setTotalGoalsTarget(activeGoals.reduce((sum, g) => sum + (parseFloat(g.targetAmount) || 0), 0));
      } catch {
        // non-blocking; leave previous value
      }
      setChartData(computedChartData);
```

**Change 5 — add two rows to summaryGrid JSX**

Insert after the "ยอดรวมเงินเก็บรายเดือน" row (lines 272–277) and before the "ยอดเงินคงเหลือ" row (lines 278–284).

Surrounding context:
```jsx
                <div
                  className={styles.summaryItem}
                  tabIndex={0}
                  aria-label={`ยอดรวมเงินเก็บรายเดือน: ${getDisplay(summaryData.ยอดรวมเงินเก็บรายเดือน)}`}
                >
                  <span className={styles.itemLabel}>ยอดรวมเงินเก็บรายเดือน</span>
                  <span className={styles.itemValue}>{getDisplay(summaryData.ยอดรวมเงินเก็บรายเดือน)}</span>
                </div>
                {/* INSERT HERE */}
                <div
                  className={styles.summaryItem}
                  tabIndex={0}
                  aria-label={`ยอดเงินคงเหลือ: ${getDisplay(summaryData.ยอดเงินคงเหลือ)}`}
                >
```

Insert block:
```jsx
                <div
                  className={styles.summaryItem}
                  tabIndex={0}
                  aria-label={`ควรเก็บต่อเดือน: ${getDisplay(allocatableAmount ?? 0)}`}
                >
                  <span className={styles.itemLabel}>ควรเก็บต่อเดือน</span>
                  <span className={`${styles.itemValue} ${styles.income}`}>{getDisplay(allocatableAmount ?? 0)}</span>
                </div>
                <div
                  className={styles.summaryItem}
                  tabIndex={0}
                  aria-label={`รวมเป้าหมายเงินออม: ${getDisplay(totalGoalsTarget)}`}
                >
                  <span className={styles.itemLabel}>รวมเป้าหมายเงินออม</span>
                  <span className={`${styles.itemValue} ${styles.goalTarget}`}>{getDisplay(totalGoalsTarget)}</span>
                </div>
```

Note: uses `.income` (green gradient) for "ควรเก็บต่อเดือน". Do NOT add a `.savings` CSS class — it would be a byte-identical copy of `.income` (bug-log BUG-6 documents this duplication). Reuse `.income` instead.

---

## 4. Files to Modify (ordered by dependency)

| Order | File | Action |
|-------|------|--------|
| 1 | `pages/api/savings-goals.js` | CREATE — blocking dependency |
| 2 | `src/backend/data/savings-goals.json` | CREATE — empty JSON store `{}` |
| 3 | `src/shared/utils/frontend/apiUtils.js` | ADD `savingsGoalsAPI` export |
| 4 | `src/frontend/components/SavingsGoalTracker.js` | ADD `onAllocatableChange` prop + useEffect |
| 5 | `pages/edit.js` | ADD import, state, SavingsGoalTracker mount, allocatableAmount prop |
| 6 | `src/frontend/components/SummaryReport.js` | ADD import, prop, state, fetch, 2 rows |

No CSS changes required — both needed classes already exist in `SummaryReport.module.css`.

---

## 5. Acceptance Criteria

| AC | Description | Pass condition |
|----|-------------|----------------|
| AC-1 | "ควรเก็บต่อเดือน" row visible | Row appears in SummaryReport summaryGrid between "ยอดรวมเงินเก็บรายเดือน" and "ยอดเงินคงเหลือ" |
| AC-2 | "ควรเก็บต่อเดือน" value correct | When SavingsGoalTracker planner is closed: shows `0 ฿`. When open with 20% and ยอดคงเหลือ = 50,000: shows `10,000 ฿` |
| AC-3 | "รวมเป้าหมายเงินออม" row visible | Row appears below "ควรเก็บต่อเดือน" |
| AC-4 | "รวมเป้าหมายเงินออม" value correct | Sum of `targetAmount` for goals where status is not 'completed' or 'abandoned'. Completed goals are excluded from sum. |
| AC-5 | "รวมเป้าหมายเงินออม" non-blocking | If `/api/savings-goals` returns 404 or errors, SummaryReport still renders with `0 ฿` for this row; no crash |
| AC-6 | allocatableAmount updates live | Open planner, type percentage → "ควรเก็บต่อเดือน" in SummaryReport updates without page reload |
| AC-7 | Month change resets correctly | Navigate to a new month via floating bar → "ควรเก็บต่อเดือน" resets to 0 (planner closes); "รวมเป้าหมายเงินออม" refetches |
| AC-8 | No new `.savings` CSS class | `SummaryReport.module.css` does not gain a `.savings` rule (avoid BUG-6 duplication) |
| AC-9 | Existing rows unchanged | All 6 existing rows in summaryGrid still render correctly after insertion |
| AC-10 | No `alert()` or `confirm()` | SavingsGoalTracker.js delete flow uses inline `deleteConfirm` state (already implemented at lines 607–627) |
