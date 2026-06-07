# Spec: Consolidate "ควรเก็บต่อเดือน" to Use Savings Goals Total

**Date:** 2026-06-03  
**Status:** PLANNING  
**Type:** Requirement Clarification / Implementation Spec

---

## 1. Problem Statement

The Summary Report currently displays two separate rows that represent savings targets:

1. **"ควรเก็บต่อเดือน"** (Should save this month)  
   - Calculated from: allocatable = post-expense balance × (savings percentage / 100)
   - **Source:** SavingsGoalTracker planner state via `onAllocatableChange` callback
   - **Note:** Depends on user's ephemeral planner input; resets on month change

2. **"รวมเป้าหมายเงินออม"** (Sum of active savings goal targets)  
   - Calculated from: sum of all active goal `targetAmount` fields  
   - **Source:** Database (savings goals collection)
   - **Note:** Persistent per-user data; updated when goals change

**Problem:**  
These two values can diverge significantly, creating ambiguity about which target the user should follow. The requirement is to consolidate them by making "ควรเก็บต่อเดือน" use the savings goals total instead of the allocatable calculation.

**Business Rationale:**  
The goals total (explicit user targets) is more reliable than the allocatable calculation (which depends on ephemeral percentage input). Using goals as the "should save" value provides a single source of truth.

---

## 2. Current Implementation Analysis

### Current Data Flow

```
SavingsGoalTracker.js
├─ Planner state: savingsPercentage, plannerNetIncome
├─ Calculates: allocatable = plannerNetIncome × (percentage / 100)
├─ Fires: onAllocatableChange(allocatable)
│
edit.js (pages/edit.js)
├─ State: const [allocatableAmount, setAllocatableAmount]
├─ Wiring: onAllocatableChange={setAllocatableAmount}
│
└─> SummaryReport.js
    ├─ Prop: allocatableAmount
    ├─ useEffect([allocatableAmount]): updates summaryData.ควรเก็บต่อเดือน
    ├─ Renders "ควรเก็บต่อเดือน" row from allocatableAmount
    └─ Renders "รวมเป้าหมายเงินออม" row from getSummaryData()
```

### Current State in SummaryReport

```js
summaryData = {
  ยอดรวมรายรับรายเดือน: totalIncome,
  ยอดรวมค่าใช้จ่ายรายเดือน_จ่ายจริง: totalExpenseActual,
  ยอดรวมค่าใช้จ่ายรายเดือน_ยังไม่ชำระ: totalExpenseUnpaid,
  ยอดรวมเงินเก็บรายเดือน: totalSavings,
  ภาษีสะสมตั้งแต่เดือนแรก: taxAccumulated,
  ยอดเงินคงเหลือ: remaining,
  ควรเก็บต่อเดือน: allocatableAmount,           // ← From allocatable prop (line 91)
  รวมเป้าหมายเงินออม: totalSavingsGoalTarget   // ← From summaryUtils (line 30)
}
```

### Current UI Rows (SummaryReport.js rendering)

- Line 303–307: "ควรเก็บต่อเดือน" displays `summaryData.ควรเก็บต่อเดือน` (allocatable)
- Line 308–315: "รวมเป้าหมายเงินออม" displays `summaryData.รวมเป้าหมายเงินออม` (goals total)

---

## 3. Requirement Clarification & Decisions

### Q1: Should we remove the separate "รวมเป้าหมายเงินออม" row?
**Decision: YES.** 

When "ควรเก็บต่อเดือน" becomes identical to goals total, the "รวมเป้าหมายเงินออม" row becomes redundant. Removing it reduces visual clutter and eliminates confusion.

**Acceptance:** Remove entire row div (SummaryReport.js lines 308–315).

---

### Q2: Should we remove the allocatable wiring entirely?
**Decision: YES.**

The allocatable calculation (from planner percentage) is no longer needed for the summary. The entire chain can be removed:
- ❌ Remove `onAllocatableChange` callback from SavingsGoalTracker
- ❌ Remove `allocatableAmount` state from edit.js
- ❌ Remove `allocatableAmount` prop from SummaryReport
- ❌ Remove `useEffect([allocatableAmount])` from SummaryReport

**Exception:** If allocatable is useful for display in the **planner panel itself** (e.g., "Based on 20% savings rate, you can allocate X this month"), it can remain as a local display value in SavingsGoalTracker. But it will NOT update the summary.

---

### Q3: Are there other consumers of allocatable?
**Decision:** After codebase search, only these components reference it:
- `edit.js` (state + prop)
- `SavingsTable.js` (pass-through)
- `SavingsGoalTracker.js` (source)
- `SummaryReport.js` (consumer)

All are in the same flow. **No other dependencies found.**

---

## 4. Goal & Acceptance

**Goal:**  
Replace allocatable calculation with savings goals total for "ควรเก็บต่อเดือน" row. Simplify UI and wiring. Establish single source of truth.

**Success Criteria:**
- [ ] "ควรเก็บต่อเดือน" displays sum of active goal targets (from DB)
- [ ] "รวมเป้าหมายเงินออม" row is removed (no visual duplication)
- [ ] allocatable calculation code is removed (no wasted computation)
- [ ] When goals change, "ควรเก็บต่อเดือน" updates automatically
- [ ] No console errors or missing prop warnings
- [ ] Summary loads and displays other rows correctly

---

## 5. Implementation Plan

### 5.1 File Changes Matrix

| File | Change | Priority | Complexity |
|------|--------|----------|------------|
| `src/shared/utils/frontend/summaryUtils.js` | Rename key: `รวมเป้าหมายเงินออม` → `ควรเก็บต่อเดือน` | HIGH | LOW |
| `src/frontend/components/SummaryReport.js` | Remove allocatable prop; remove redundant row; simplify state | HIGH | MEDIUM |
| `pages/edit.js` | Remove allocatableAmount state + prop | MEDIUM | LOW |
| `src/frontend/components/SavingsTable.js` | Remove onAllocatableChange pass-through | MEDIUM | LOW |
| `src/frontend/components/SavingsGoalTracker.js` | Remove onAllocatableChange callback logic | MEDIUM | MEDIUM |

### 5.2 Detailed Changes

---

#### **Change 1: summaryUtils.js**

**File:** `src/shared/utils/frontend/summaryUtils.js`

**Current (lines 20–47):**
```js
export function getSummaryData({ incomeData, expenseData, savingsData, taxData, salaryData, currentMonth, currentYear, goalsData }) {
  // ... calculations ...
  const totalSavingsGoalTarget = goalsList
    .filter(g => g && g.status !== 'completed' && g.status !== 'abandoned')
    .reduce((sum, g) => sum + (parseFloat(g.targetAmount || 0) || 0), 0);
  return {
    ยอดรวมรายรับรายเดือน: totalIncome,
    ยอดรวมค่าใช้จ่ายรายเดือน_จ่ายจริง: totalExpenseActual,
    ยอดรวมค่าใช้จ่ายรายเดือน_ยังไม่ชำระ: totalExpenseUnpaid,
    ยอดรวมเงินเก็บรายเดือน: totalSavings,
    ภาษีสะสมตั้งแต่เดือนแรก: taxAccumulated,
    ยอดเงินคงเหลือ: remaining,
    รวมเป้าหมายเงินออม: totalSavingsGoalTarget  // ← OLD KEY
  };
}
```

**New:**
```js
export function getSummaryData({ incomeData, expenseData, savingsData, taxData, salaryData, currentMonth, currentYear, goalsData }) {
  // ... calculations unchanged ...
  const totalSavingsGoalTarget = goalsList
    .filter(g => g && g.status !== 'completed' && g.status !== 'abandoned')
    .reduce((sum, g) => sum + (parseFloat(g.targetAmount || 0) || 0), 0);
  return {
    ยอดรวมรายรับรายเดือน: totalIncome,
    ยอดรวมค่าใช้จ่ายรายเดือน_จ่ายจริง: totalExpenseActual,
    ยอดรวมค่าใช้จ่ายรายเดือน_ยังไม่ชำระ: totalExpenseUnpaid,
    ยอดรวมเงินเก็บรายเดือน: totalSavings,
    ภาษีสะสมตั้งแต่เดือนแรก: taxAccumulated,
    ยอดเงินคงเหลือ: remaining,
    ควรเก็บต่อเดือน: totalSavingsGoalTarget  // ← NEW KEY (renamed)
  };
}
```

**Rationale:**  
- Single rename: `รวมเป้าหมายเงินออม` → `ควรเก็บต่อเดือน`
- Calculation logic unchanged
- This becomes the source of truth for "should save this month"

---

#### **Change 2: SummaryReport.js**

**File:** `src/frontend/components/SummaryReport.js`

**Remove:**
1. **Line 19 (prop):**  
   ```js
   // OLD
   const SummaryReport = ({ selectedMonth, onReportDataReady, allocatableAmount = 0 }) => {
   
   // NEW
   const SummaryReport = ({ selectedMonth, onReportDataReady }) => {
   ```

2. **Lines 88–93 (useEffect):**  
   ```js
   // DELETE THIS ENTIRE BLOCK:
   useEffect(() => {
     setSummaryData(prev => ({
       ...prev,
       ควรเก็บต่อเดือน: allocatableAmount
     }));
   }, [allocatableAmount]);
   ```

3. **Lines 308–315 (redundant row):**  
   ```js
   // DELETE THIS ENTIRE DIV (รวมเป้าหมายเงินออม row):
   <div
     className={styles.summaryItem}
     tabIndex={0}
     aria-label={`รวมเป้าหมายเงินออม (เป้าหมายที่ยังดำเนินอยู่): ${getDisplay(summaryData.รวมเป้าหมายเงินออม)}`}
   >
     <span className={styles.itemLabel}>รวมเป้าหมายเงินออม (เป้าหมายที่ยังดำเนินอยู่)</span>
     <span className={`${styles.itemValue} ${styles.goalTarget}`}>{getDisplay(summaryData.รวมเป้าหมายเงินออม)}</span>
   </div>
   ```

**Update:**
1. **Line 22–31 (initial state):**  
   Remove `ควรเก็บต่อเดือน: 0` from initial state if it was explicitly set there. It will come from `getSummaryData()` via summaryUtils.js.
   
   ```js
   // After loadSummaryData completes:
   // summaryData will have ควรเก็บต่อเดือน from summaryUtils
   ```

2. **Line 141 (state update):**  
   Already correct. The merge includes ควรเก็บต่อเดือน from summary:
   ```js
   setSummaryData(prev => ({ ...prev, ...summary }));
   // Now summary includes: ควรเก็บต่อเดือน: totalSavingsGoalTarget
   ```

3. **Line 303–307 (should save row):**  
   Update label/aria-label if needed. Row now shows goals total (no change to display logic, just source):
   ```js
   // No code change needed; it already displays summaryData.ควรเก็บต่อเดือน
   // The value just now comes from summaryUtils instead of the prop
   ```

---

#### **Change 3: edit.js (pages/edit.js)**

**File:** `pages/edit.js`

**Remove:**
1. **Line 226:**  
   ```js
   // DELETE
   const [allocatableAmount, setAllocatableAmount] = useState(0);
   ```

2. **Line 641 (in SummaryReport JSX):**  
   ```js
   // OLD
   <SummaryReport
     selectedMonth={selectedMonth}
     allocatableAmount={allocatableAmount}  // ← DELETE THIS LINE
     key={`summary-${refreshTrigger}`}
   />
   
   // NEW
   <SummaryReport
     selectedMonth={selectedMonth}
     key={`summary-${refreshTrigger}`}
   />
   ```

3. **Line 710 (in SavingsTable JSX):**  
   ```js
   // OLD
   <SavingsTable
     selectedMonth={selectedMonth}
     triggerSave={triggerSave}
     onAllocatableChange={setAllocatableAmount}  // ← DELETE THIS LINE
     key={`savings-${refreshTrigger}`}
   />
   
   // NEW
   <SavingsTable
     selectedMonth={selectedMonth}
     triggerSave={triggerSave}
     key={`savings-${refreshTrigger}`}
   />
   ```

---

#### **Change 4: SavingsTable.js**

**File:** `src/frontend/components/SavingsTable.js`

**Remove:**
1. **Line 21 (destructuring):**  
   ```js
   // OLD
   export default function SavingsTable({ selectedMonth, triggerSave, onAllocatableChange }) {
   
   // NEW
   export default function SavingsTable({ selectedMonth, triggerSave }) {
   ```

2. **Line ~350 (in SavingsGoalTracker JSX):**  
   ```js
   // OLD
   <SavingsGoalTracker 
     refreshTrigger={goalRefreshTrigger} 
     selectedMonth={selectedMonth} 
     onAllocatableChange={onAllocatableChange}  // ← DELETE THIS LINE
   />
   
   // NEW
   <SavingsGoalTracker 
     refreshTrigger={goalRefreshTrigger} 
     selectedMonth={selectedMonth}
   />
   ```

---

#### **Change 5: SavingsGoalTracker.js**

**File:** `src/frontend/components/SavingsGoalTracker.js`

**Remove:**
1. **Line 83 (function signature):**  
   ```js
   // OLD
   export default function SavingsGoalTracker({ refreshTrigger, selectedMonth, onAllocatableChange }) {
   
   // NEW
   export default function SavingsGoalTracker({ refreshTrigger, selectedMonth }) {
   ```

2. **Lines ~165–170 (useEffect that calls callback):**  
   ```js
   // DELETE THIS ENTIRE BLOCK:
   useEffect(() => {
     if (typeof onAllocatableChange === 'function') {
       onAllocatableChange(currentAllocatable);
     }
   }, [currentAllocatable, onAllocatableChange]);
   ```

3. **Line ~315 (in useMemo dependency array):**  
   Remove `onAllocatableChange` from dependencies if present:
   ```js
   // OLD
   }, [plannerOpen, plannerNetIncome, monthlyLiving, activeGoals, savingsPercentage, onAllocatableChange]);
   
   // NEW
   }, [plannerOpen, plannerNetIncome, monthlyLiving, activeGoals, savingsPercentage]);
   ```

4. **Lines ~265–270 (inside useMemo, after allocatable calculation):**  
   Remove the callback invocation:
   ```js
   // DELETE THESE LINES:
   if (typeof onAllocatableChange === 'function') {
     onAllocatableChange(allocatable);  // ← NO LONGER NEEDED
   }
   ```

---

## 6. Acceptance Criteria

### AC1: Consolidation Complete
- [ ] `summaryUtils.js` exports `ควรเก็บต่อเดือน` key (not `รวมเป้าหมายเงินออม`)
- [ ] "ควรเก็บต่อเดือน" row displays the sum of active goal targets
- [ ] "รวมเป้าหมายเงินออม" row is completely removed from the UI

### AC2: Allocatable Wiring Removed
- [ ] `edit.js` has no `allocatableAmount` state
- [ ] `SummaryReport.js` does not accept `allocatableAmount` prop
- [ ] `SavingsTable.js` does not pass `onAllocatableChange`
- [ ] `SavingsGoalTracker.js` does not call `onAllocatableChange`

### AC3: Functionality Preserved
- [ ] Summary Report loads correctly for all months
- [ ] When savings goals change (add/edit/delete), "ควรเก็บต่อเดือน" updates
- [ ] All other summary rows display correct values
- [ ] No console errors or prop warnings

### AC4: User Experience
- [ ] Single "should save" target (no confusing duplication)
- [ ] Goals total is the source of truth
- [ ] UI is less cluttered

---

## 7. Testing Strategy

### Unit Tests

**summaryUtils.js**
```js
describe('getSummaryData', () => {
  it('should return ควรเก็บต่อเดือน key (not รวมเป้าหมายเงินออม)', () => {
    const result = getSummaryData({ 
      incomeData: {}, 
      expenseData: {}, 
      savingsData: {}, 
      taxData: {}, 
      salaryData: {},
      goalsData: [
        { status: 'active', targetAmount: 5000 },
        { status: 'active', targetAmount: 3000 }
      ]
    });
    expect(result).toHaveProperty('ควรเก็บต่อเดือน', 8000);
    expect(result).not.toHaveProperty('รวมเป้าหมายเงินออม');
  });

  it('should exclude completed/abandoned goals', () => {
    const result = getSummaryData({
      // ...other params...
      goalsData: [
        { status: 'active', targetAmount: 5000 },
        { status: 'completed', targetAmount: 3000 },
        { status: 'abandoned', targetAmount: 2000 }
      ]
    });
    expect(result.ควรเก็บต่อเดือน).toBe(5000);
  });
});
```

**SummaryReport.js**
```js
describe('SummaryReport', () => {
  it('should not accept allocatableAmount prop', () => {
    const { container } = render(
      <SummaryReport selectedMonth="2026-06" />
    );
    expect(container).toBeInTheDocument();
  });

  it('should display ควรเก็บต่อเดือน from summaryData', () => {
    // Mock API to return goals = 8000
    const { getByText } = render(
      <SummaryReport selectedMonth="2026-06" />
    );
    // After loading...
    expect(getByText(/ควรเก็บต่อเดือน/)).toBeInTheDocument();
    expect(getByText(/8,000/)).toBeInTheDocument();
  });

  it('should NOT display รวมเป้าหมายเงินออม row', () => {
    const { queryByText } = render(
      <SummaryReport selectedMonth="2026-06" />
    );
    expect(queryByText(/รวมเป้าหมายเงินออม/)).not.toBeInTheDocument();
  });
});
```

### Integration Tests

1. **Navigate to edit page → Savings tab → Summary visible**
   - Create 2 savings goals with targets 5000 + 3000
   - Verify "ควรเก็บต่อเดือน" = 8000 ฿
   - Verify "รวมเป้าหมายเงินออม" row absent

2. **Edit goal targets**
   - Change first goal: 5000 → 7000
   - Verify summary updates to 10000 ฿ (within 1 second)

3. **Complete a goal**
   - Mark a goal complete in the goals panel
   - Verify "ควรเก็บต่อเดือน" updates (excludes completed goal)

4. **No goals exist**
   - Clear all goals
   - Verify "ควรเก็บต่อเดือน" = 0 ฿

5. **Month changes**
   - Switch months in floating bar
   - Summary reloads and recalculates

---

## 8. Risk & Mitigation

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Breaking change if other code uses `getRemainingAfterAllocatable()` | Low | Grep codebase; none found |
| Goals API fails → displays 0 instead of allocatable | Low | This is correct; goals are optional |
| User confuses lack of allocatable with missing feature | Low | Allocatable was internal; no user-facing feature lost |
| Regression: other summary rows stop updating | Medium | Test all summary rows after changes |

---

## 9. Deployment Notes

- **Type:** Refactor (no new features, no API changes)
- **Backward Compatibility:** Frontend-only; safe to deploy
- **Database Migration:** None
- **Config Changes:** None
- **User Notification:** None (internal change)

---

## 10. Success Metrics

**Before:**
- Two separate rows: "ควรเก็บต่อเดือน" (allocatable) + "รวมเป้าหมายเงินออม" (goals)
- User confusion: which one to follow?
- Wiring complexity: planner → edit → summary

**After:**
- One unified row: "ควรเก็บต่อเดือน" (goals total)
- Clear intent: goals are the target
- Simplified wiring: goals API → summaryUtils → summary

---

## 11. Follow-up Tasks

1. **Preserve allocatable for planner display:**  
   If useful, keep allocatable calculation in SavingsGoalTracker for informational display (e.g., "Based on 20% savings, you can allocate X"). But do NOT pass it to summary.

2. **Documentation update:**  
   Update CLAUDE.md section 2 to reflect:
   - Allocatable flow removed
   - Single source of truth: goals total
   - Simplified architecture

3. **Monitor user feedback:**  
   Verify users don't ask for "allocatable" display in future versions

---

**STATUS: READY FOR IMPLEMENTATION**

