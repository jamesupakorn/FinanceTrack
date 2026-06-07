# Bug Log — Current Refresh Status (2026-06-07)

**Date:** 2026-06-07
**Branch:** develop
**Review type:** Static refresh verification of previously logged SummaryReport / SavingsGoalTracker issues
**Verdict:** No active evidence that BUG-7 or BUG-8 remain in current code

---

## Current Status

| Bug | Prior State | Current Evidence |
|-----|-------------|------------------|
| BUG-7 | Month change could keep stale `allocatableAmount` | `pages/edit.js` now resets `allocatableAmount` in `React.useEffect(() => { setAllocatableAmount(0); }, [selectedMonth])` |
| BUG-8 | `setChartData` blocked by `await savingsGoalsAPI.getAll()` | `SummaryReport.js` now calls `setChartData()` and `onReportDataReady()` before a fire-and-forget `savingsGoalsAPI.getAll().then(...).catch(...)` |

## Notes

- This refresh was a static code check only; no automated test suite exists in the repo yet.
- Historical findings are preserved below for audit context.

---

# Bug Log — Senior Code Review (post-BUG-7-fix, 2026-06-04)

**Date:** 2026-06-04
**Branch:** develop
**Review type:** Senior code review — outside scrutiny, post-BUG-7 fix
**Verdict:** NEEDS FIXES (2 MAJORs, 2 NITs)

---

## BUG-8 — `setChartData` blocked by goals API `await` (chart regression)

**Severity:** MAJOR
**File:** `src/frontend/components/SummaryReport.js`
**Line:** 139

**Code (current):**
```js
setSummaryData(prev => ({ ...prev, ...summary }));
// Fetch active goals total (non-blocking)      ← comment is wrong
try {
  const goalsRes = await savingsGoalsAPI.getAll();  // ← sequential await
  setTotalGoalsTarget(...);
} catch { /* silent */ }
setChartData(computedChartData);   // ← runs only after goals fetch completes
onReportDataReady({ ... });
```

**Consequence:**
`computedChartData` is calculated at line 123 before this block. It does not depend on goals data. Despite the "non-blocking" comment, `setChartData` and `onReportDataReady` are sequentially chained after the `await`. On a normal (non-error) response the pie chart and `onReportDataReady` callback are blocked for the full round-trip latency of the goals API (50–200 ms on MongoDB, <10 ms on JSON). In the error path the catch absorbs the throw and `setChartData` runs immediately — so "non-blocking" is only true for failures.

This is a regression: before this PR, `setChartData` ran immediately after `setSummaryData`. This PR added a sequential `await` that delays it.

**Minimal fix — move the two calls above the goals try/catch:**
```js
setSummaryData(prev => ({ ...prev, ...summary }));
setChartData(computedChartData);          // ← move here
if (typeof onReportDataReady === 'function') {
  onReportDataReady({ summaryData: summary, chartData: computedChartData, reportMonth: monthToUse });
}
// True fire-and-forget goals fetch
savingsGoalsAPI.getAll()
  .then(goalsRes => {
    const activeGoals = (goalsRes?.goals || [])
      .filter(g => g.status !== 'completed' && g.status !== 'abandoned');
    setTotalGoalsTarget(activeGoals.reduce((sum, g) => sum + (parseFloat(g.targetAmount) || 0), 0));
  })
  .catch(() => {});   // non-blocking; leave previous value
```

**Status:** Must fix before ship. Chart delay is user-visible on every summary load.

---

## BUG-9 — BUG-7 residual: `allocatableAmount` stale when month changes from non-savings tab

**Severity:** MAJOR
**Files:** `pages/edit.js` (line 218, 700–721), `src/frontend/components/SavingsGoalTracker.js` (lines 159–163)

**Description:**
The BUG-7 fix adds `key={selectedMonth}` to `<SavingsGoalTracker>` so it remounts on month change. Remount resets `plannerOpen = false`, which triggers `onAllocatableChange(0)`, which resets `allocatableAmount = 0` in `edit.js`. Correct — but only when SavingsGoalTracker is rendered.

SavingsGoalTracker lives inside `{activeTab === 'savings' && ...}` at `edit.js:700–721`. When the user is on the income, expense, or tax tab, the component is not mounted. `key` changes have no effect on an unmounted component.

**Failing scenario:**
1. Savings tab → open planner → `allocatableAmount = 15 000`
2. Switch to income tab → SavingsGoalTracker unmounts; `allocatableAmount` stays `15 000`
3. Navigate to next month via floating bar (`handleNextMonth` → `setSelectedMonth`)
4. SavingsGoalTracker is still not mounted; `onAllocatableChange` never fires
5. `<SummaryReport allocatableAmount={15000}>` renders for the new month → "ควรเก็บต่อเดือน" shows `15 000 ฿` (stale from previous month)

This violates AC-7 for the majority case where month navigation happens from any non-savings tab.

**Evidence:**
- `setAllocatableAmount` is only called from `onAllocatableChange` prop in SavingsGoalTracker (`edit.js:717`)
- No `useEffect` in `edit.js` resets `allocatableAmount` when `selectedMonth` changes
- `SavingsGoalTracker` is rendered only when `activeTab === 'savings'` (`edit.js:700`)

**Minimal fix — add a reset effect in `edit.js`:**
```js
// after the allocatableAmount useState declaration (line 218)
React.useEffect(() => {
  setAllocatableAmount(0);
}, [selectedMonth]);
```

This resets the row to 0 on every month change regardless of which tab is active, and is immediately overwritten by `onAllocatableChange` once the planner (re)computes for the new month.

**Status:** Must fix — AC-7 fails for the common case of month navigation from any non-savings tab.

---

## BUG-10 — Duplicate `currentAllocatable` / `allocatable` calculation

**Severity:** NIT
**File:** `src/frontend/components/SavingsGoalTracker.js`
**Lines:** 150–157 (`currentAllocatable`) and 356–358 (`allocatable` / `postExpenseBalance`)

**Code:**
```js
// lines 150–157
const currentAllocatable = plannerOpen
  ? (() => {
      const living = parseFloat(String(monthlyLiving).replace(/,/g, '')) || 0;
      const net = plannerNetIncome ?? 0;
      return Math.max(0, net - living);
    })()
  : 0;

// lines 356–358
const livingAmt = parseFloat(String(monthlyLiving).replace(/,/g, '')) || 0;
const postExpenseBalance = Math.max(0, (plannerNetIncome ?? 0) - livingAmt);
const allocatable = postExpenseBalance;
```

`allocatable` (line 358) is used in JSX display; `currentAllocatable` (line 150) is used for the `onAllocatableChange` callback. They compute identically when `plannerOpen = true` (the `plannerOpen` guard on `currentAllocatable` makes it 0 when planner is closed, while `allocatable` is non-zero but used only inside the `plannerOpen` conditional in JSX). No functional difference, but duplication increases maintenance cost.

**Fix:** Use `currentAllocatable` directly in the JSX instead of re-deriving `allocatable`. Remove the three lines at 356–358.

**Status:** Non-blocking. Address in a follow-up cleanup pass.

---

## BUG-11 — `assertAuth` is a redundant one-liner alias

**Severity:** NIT
**File:** `pages/api/savings-goals.js`
**Lines:** 22–24

**Code:**
```js
function assertAuth(req, res) {
  return assertApiToken(req, res);
}
```

Pure forwarding wrapper, no added behaviour. `savings-allocation.js` (the file this was modelled on) calls `assertApiToken` directly. The alias adds a layer of indirection with no benefit.

**Fix:** Delete `assertAuth` and call `assertApiToken(req, res)` at line 183 directly, matching the pattern in `savings-allocation.js`.

**Status:** Non-blocking cosmetic.

---

# Bug Log — Restore Missing SummaryReport Rows (spec.md 2026-06-03)

**Date:** 2026-06-03
**Branch:** develop
**Related spec:** `.PIPELINE/spec.md` (Restore Missing SummaryReport Rows & Wiring)
**Gate result:** FAIL (AC-7)

---

## BUG-7 — Month navigation does not reset "ควรเก็บต่อเดือน" to 0 (AC-7 violation)

**Severity:** HIGH
**Files:** `src/frontend/components/SavingsGoalTracker.js`, `pages/edit.js`

**Spec requirement (AC-7):**
> Navigate to a new month via floating bar → "ควรเก็บต่อเดือน" resets to 0 ฿ (planner closes); "รวมเป้าหมายเงินออม" refetches.

**Description:**

When the user navigates to a different month using the floating bar while the allocation planner `<details>` is open, the "ควรเก็บต่อเดือน" row in SummaryReport does NOT reset to `0 ฿`. It retains a non-zero value derived from the previous month's net income until the new month's data is fully loaded.

**Root Cause — three compounding issues:**

1. `SavingsGoalTracker` has no `key` prop in `edit.js` (line 713–717) that includes `selectedMonth`. The component is never unmounted on month change, so the `<details>` DOM element keeps its `open` state.

2. No `useEffect` in `SavingsGoalTracker` resets `plannerOpen` (or closes the `<details>`) when `selectedMonth` changes. The `<details>` element is uncontrolled — React does not re-close it on re-render.

3. The `plannerNetIncome` refetch effect (`SavingsGoalTracker.js:117–147`) does NOT call `setPlannerNetIncome(null)` before the async fetch begins. During the loading window, `plannerNetIncome` holds the old month's value.

**Result:** When month changes with planner open:
- `plannerOpen = true` (unchanged)
- `plannerNetIncome = <old value>` (not cleared)
- `savingsPercentage = null` (correctly reset)
- `currentAllocatable = Math.max(0, oldNetIncome - livingAmt)` — non-zero if previous month had income
- `onAllocatableChange(nonZeroValue)` fires → `allocatableAmount` in `edit.js` is NOT 0
- "ควรเก็บต่อเดือน" shows stale value, not `0 ฿`

**Trigger scenario:**
1. Open the savings tab, expand the allocation planner
2. Enter any savings percentage (e.g., 20%)
3. Navigate to a different month via the floating bar arrows
4. Observe "ควรเก็บต่อเดือน" in SummaryReport — it shows the previous month's calculated value, not `0 ฿`

**Fix options (coder to choose):**

**Option A — Controlled `<details>` (recommended):**
Convert `plannerOpen` to a controlled state that resets to `false` when `selectedMonth` changes:
```js
// Add useEffect in SavingsGoalTracker:
useEffect(() => {
  setPlannerOpen(false);
}, [selectedMonth]);
```
And bind the `<details>` `open` attribute:
```jsx
<details
  open={plannerOpen}
  className={styles.plannerSection}
  onToggle={(e) => setPlannerOpen(e.target.open)}
>
```
Also add `setPlannerNetIncome(null)` at the start of the `plannerNetIncome` refetch effect so the stale value is cleared immediately.

**Option B — Key-based remount:**
Add `selectedMonth` to the SavingsGoalTracker key in `edit.js`:
```jsx
<SavingsGoalTracker
  key={`goals-${selectedMonth}`}
  refreshTrigger={refreshTrigger}
  selectedMonth={selectedMonth}
  onAllocatableChange={setAllocatableAmount}
/>
```
This unmounts and remounts the component on every month change, resetting all state including `plannerOpen`. Downside: goals list re-fetches on every month navigation.

**Status:** BLOCKING — must fix before Stage 5 per AC-7.

---

# Bug Log — Savings Allocation Planner Panel

**Date:** 2026-06-03
**Branch:** develop
**Related spec:** spec.md (AC-14, AC-15)
**Gate result:** FAIL (2 criteria)

---

## BUG-1 — confirm() call present in SavingsGoalTracker (AC-14 violation)

**Severity:** Medium
**File:** `src/frontend/components/SavingsGoalTracker.js`
**Line:** 191

**Code:**
```js
if (!confirm(`ลบเป้าหมาย "${goalName}" ใช่หรือไม่?`)) return;
```

**Spec requirement (AC-14):**
> No `alert()` or `confirm()` calls are introduced; error conditions use `showToast` or an inline panel message.

**Description:**
`handleDelete` uses a native browser `confirm()` dialog. This blocks the main thread, breaks the non-blocking UX pattern established in `.pipeline`, and violates AC-14. The `.pipeline` explicitly states: "alert()/confirm() → showToast()". This may be pre-existing code not introduced by the current PR, but it exists in the file as audited and the spec criterion covers the whole file.

**Fix direction (for coder):**
Replace `confirm(...)` with an inline confirmation pattern (e.g., a local state flag that renders a confirmation prompt inline, or a toast-based pattern). Do NOT modify planner code — this is in `handleDelete`, a separate function.

**Ambiguity note:** If `confirm()` can be proven pre-existing (via git blame) and AC-14 is scoped only to new additions in this PR, this bug may be downgraded or waived. Coder should verify with git blame on line 191.

---

## BUG-2 — Hardcoded hex colour in new planner CSS rule (AC-15 violation)

**Severity:** Low
**File:** `src/frontend/styles/SavingsGoalTracker.module.css`
**Line:** 537

**Code:**
```css
.plannerGoalFunded {
  color: #22c55e;   /* <-- hardcoded */
  font-weight: 600;
  font-size: 0.80rem;
}
```

**Spec requirement (AC-15):**
> All new CSS uses only vars listed in `.pipeline`. No hardcoded colour values.

**Description:**
`.plannerGoalFunded` is a new class added by this PR (part of the planner panel). It uses `#22c55e` directly instead of a CSS variable. The `.pipeline` documents `#22c55e` as the "complete" green used in progress bars, but does not define a `--` CSS variable for it. The `changes.md` author acknowledges this deviation. The spec grants no such exception.

**Fix direction (for coder):**
Either:
1. Define a new CSS var `--color-success: #22c55e` in `src/frontend/styles/globals.css` and use `color: var(--color-success)` in `.plannerGoalFunded`, OR
2. Reuse the `.pipeline`-documented pattern by referencing the value through an existing var if one is added to `globals.css`.

Do NOT change the `#22c55e` values in pre-existing rules (lines 279, 330, 379) as those are out of scope for this PR.

---

## BUG-3 — Race Condition: Debounce Callback Applies to Wrong Month (AC-12 violation)

**Severity:** MAJOR  
**File:** `src/frontend/components/SavingsGoalTracker.js`  
**Lines:** 150–167 (interaction between useEffect and useCallback)  
**Spec requirement (AC-12):**
> Per-month scope: percentage resets to null on month change; no persistence. Each month starts with percentage = null. This is expected MVP behavior.

**Description:**

When a user navigates to a different month while a debounce timeout from percentage input is still pending (within 300ms of starting to type), the old timeout fires AFTER the month has changed, applying the old month's percentage value to the new month. This violates AC-12's per-month scope guarantee.

**Trigger scenario:**
1. User opens allocation planner on month "2026-06"
2. User starts typing a percentage (e.g., types "20")
3. User quickly navigates to month "2026-07" via floating bar (all within 300ms)
4. At T+300ms, the debounce timeout from step 2 fires
5. Result: new month "2026-07" has percentage=20 (incorrect; should start with null)

**Root cause:**

- Line 150–152: `useEffect` resets `savingsPercentage` to null when month changes, but does NOT cancel any pending debounce timeout
- Lines 42–48: debounce creates a `timeout` closure that persists across component renders
- Line 158: `useCallback([])` with empty dependency array means the debounce handler is created once at mount, not per month
- Result: A single debounce timer can outlive a month change and fire its callback in the wrong month context

**Why tester missed it:**

Static code analysis (tester's method) does not explore race conditions involving asynchronous operations. The code path looks correct in isolation, but the bug requires:
- Timing: month navigation within 300ms debounce window
- Async interaction: setTimeout callback firing after state reset
- Static analysis does not simulate async races

**Evidence:**

```
useEffect: month changes
  ↓
setSavingsPercentage(null)  [resets for new month]
  ↓
[300ms setTimeout still pending from old month]
  ↓
setTimeout fires: setSavingsPercentage(20)  [WRONG: applies to new month]
```

**Probability:** Low (user must navigate within 300ms of typing), but **reproducible** and **violates spec**.

**Minimal fixes:**

**Option A:** Guard inside callback (simplest):
```js
const monthRef = useRef(selectedMonth);
useEffect(() => {
  monthRef.current = selectedMonth;
  setSavingsPercentage(null);
}, [selectedMonth]);

const handleSavingsPercentageChange = useCallback(
  debounce((value) => {
    let numVal = parseFloat(String(value).replace(/,/g, ''));
    if (isNaN(numVal) || numVal < 0 || numVal > 100) {
      setSavingsPercentage(null);
      return;
    }
    // GUARD: only apply if month hasn't changed since input started
    if (monthRef.current === selectedMonth) {
      setSavingsPercentage(numVal);
    }
  }, 300),
  [selectedMonth]  // IMPORTANT: now includes selectedMonth dependency
);
```

**Option B:** Expose cancel method on debounce:
```js
const debounce = (func, wait) => {
  let timeout;
  const fn = (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
  fn.cancel = () => clearTimeout(timeout);
  return fn;
};

// In component:
useEffect(() => {
  handleSavingsPercentageChange.cancel?.();
  setSavingsPercentage(null);
}, [selectedMonth]);
```

**Recommendation:** Use Option A (guard inside callback) as it's simpler and doesn't modify the debounce utility. Update `useCallback` deps to include `[selectedMonth]` to ensure the guard works correctly across month changes.

**Status:** BLOCKING — must fix before merge per spec AC-12

---

# Bug Log — SummaryReport Enhancements (spec 2026-06-03)

**Date:** 2026-06-03
**Branch:** develop
**Review type:** Senior code review (outside scrutiny)
**Verdict:** NEEDS FIXES (2 MAJORs, 1 NIT)

---

## BUG-4 — Side effect inside useMemo (React violation)

**Severity:** MAJOR
**File:** `src/frontend/components/SavingsGoalTracker.js`
**Lines:** 270–271 (inside `allocationResults` useMemo)

**Code:**
```js
// inside useMemo — side effect
if (typeof onAllocatableChange === 'function') {
  onAllocatableChange(allocatable);  // ← side effect in memo
}
```

**Description:**
`onAllocatableChange(allocatable)` is called inside the `allocationResults` useMemo body. React's contract for useMemo requires the computing function to be a pure function with no side effects. In React 18 Strict Mode, React intentionally runs useMemo twice per render to detect impurity. This causes `setAllocatableAmount` (the callback) to be called twice per debounce cycle in development. Under concurrent rendering (startTransition, Suspense), a memo may be computed and thrown away multiple times — each time firing the callback and triggering upstream state updates.

Additionally, `onAllocatableChange` is listed as a dependency of the memo (line 315), which is semantically incorrect — the allocatable value does not depend on what the parent does with the result.

**Fix:**
Split calculation (useMemo) from the side-effect (useEffect):

```js
// Pure memo — calculation only
const plannerAllocatable = useMemo(() => {
  if (!plannerOpen) return 0;
  const livingAmt = parseFloat(String(monthlyLiving).replace(/,/g, '')) || 0;
  const net = plannerNetIncome ?? 0;
  if (savingsPercentage && savingsPercentage > 0) {
    return Math.max(0, (net - livingAmt) * (savingsPercentage / 100));
  }
  return Math.max(0, net - livingAmt);
}, [plannerOpen, plannerNetIncome, monthlyLiving, savingsPercentage]);

// Side effect separated into useEffect
useEffect(() => {
  if (typeof onAllocatableChange === 'function') {
    onAllocatableChange(plannerOpen ? plannerAllocatable : 0);
  }
}, [plannerOpen, plannerAllocatable, onAllocatableChange]);
```

Remove `onAllocatableChange` from the `allocationResults` useMemo dependency array.

**Status:** Must fix — React rule violation with observable consequences in Strict Mode and concurrent rendering.

---

## BUG-5 — `setSummaryData(summary)` silently drops `ควรเก็บต่อเดือน` on every data reload

**Severity:** MAJOR
**File:** `src/frontend/components/SummaryReport.js`
**Line:** 141

**Code:**
```js
setSummaryData(summary);  // full replacement — wipes ควรเก็บต่อเดือน
```

**Description:**
`loadSummaryData` (triggered by `[selectedMonth, currentUser?.id]` at line 83–85) calls `setSummaryData(summary)` with the return value of `getSummaryData`. Reading `summaryUtils.js:38–47` confirms `getSummaryData` does NOT include `ควรเก็บต่อเดือน` in its return object. After the full replacement, `summaryData.ควรเก็บต่อเดือน` becomes `undefined`.

The recovery mechanism — `useEffect([allocatableAmount])` at lines 88–93 — only fires when the `allocatableAmount` prop changes. If the user: (1) opened the planner and set a percentage (allocatableAmount = X in edit.js), then (2) closed the planner and changed months (SavingsTable may be unmounted, no callback fires, allocatableAmount stays X), then (3) `loadSummaryData` replaces summaryData — `ควรเก็บต่อเดือน` drops to `undefined`. Since allocatableAmount is still X (unchanged), the useEffect does not re-fire. The row permanently shows `0 ฿` or `formatCurrency(undefined)` until the user re-opens the planner.

changes.md (line 80) describes this as "showing '0 ฿' temporarily" — this is inaccurate. It is permanent, not temporary.

**Reproducible scenario:**
1. Navigate to savings tab, open planner, type 20% → `allocatableAmount = 20000`.
2. Close planner.
3. Change month via floating bar (savings tab still active OR switch tab first to unmount SavingsTable).
4. `loadSummaryData` fires → `setSummaryData(summary)` → `ควรเก็บต่อเดือน = undefined`.
5. `allocatableAmount` in edit.js is still `20000` (unchanged) → `useEffect` does not re-fire.
6. "ควรเก็บต่อเดือน" row shows wrong value permanently.

**Minimal fix — `SummaryReport.js:141`:**
```js
// Before:
setSummaryData(summary);

// After — preserves client-only fields across server reloads:
setSummaryData(prev => ({ ...prev, ...summary }));
```

If the intent is to reset to 0 on month change (cleaner semantics), do it explicitly:
```js
setSummaryData(prev => ({
  ...prev,
  ...summary,
  ควรเก็บต่อเดือน: 0  // intentional reset — planner must be re-engaged for new month
}));
```

Either variant is correct. The silent drop is not.

**Status:** Must fix — the feature's primary deliverable (new row) goes dark after every month navigation with no user-visible explanation and no auto-recovery.

---

## BUG-6 — `.itemValue.savings` is byte-identical to `.itemValue.income` (duplication)

**Severity:** NIT
**File:** `src/frontend/styles/SummaryReport.module.css`
**Lines:** 316–323 vs 289–295

**Description:**
The new `.itemValue.savings` class added by this PR has the same `background`, `background-clip`, `-webkit-background-clip`, `-webkit-text-fill-color` as the pre-existing `.itemValue.income`. The base `.itemValue` already sets `font-weight: 700`, so the `font-weight: 700` in `.savings` adds nothing visible.

No functional impact. Duplication increases future maintenance cost (change the gradient in one place; must also change the other).

**Fix direction:**
Extract a shared modifier class (e.g., `.greenGradient`) used by both `.income` and `.savings`, or compose them. Alternatively, in JSX apply both class names (`styles.income styles.savings` is redundant — just use `styles.income` for the same visual).

**Status:** Non-blocking. Address in a follow-up cleanup.
