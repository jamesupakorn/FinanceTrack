# TEST RESULTS — Refresh Verification

**Date:** 2026-06-07
**Branch:** develop
**Method:** Static verification against current code (no test framework configured)
**Scope:** Pipeline drift check for SummaryReport, SavingsGoalTracker, edit wiring, savings-goals API, and per-user bank accounts

---

## Summary

| Check | Result |
|-------|--------|
| `allocatableAmount` reset on month change | PASS |
| SummaryReport chart update stays non-blocking | PASS |
| Savings goals API present in current tree | PASS |
| SavingsGoalTracker callback wiring present | PASS |
| Per-user bank accounts API/session wiring present | PASS |

## Evidence Snapshot

- `pages/edit.js` has `const [allocatableAmount, setAllocatableAmount] = useState(0);` and a `React.useEffect(..., [selectedMonth])` reset
- `src/frontend/components/SummaryReport.js` has `allocatableAmount`, `totalGoalsTarget`, `setChartData(computedChartData)` before `savingsGoalsAPI.getAll()`
- `src/frontend/components/SavingsGoalTracker.js` accepts `onAllocatableChange`, clears `plannerNetIncome` before refetch, and emits current allocatable via `useEffect`
- `pages/api/savings-goals.js` exists and documents GET/POST/PUT/DELETE dual-mode handling
- `pages/api/user-bank-accounts.js` and `src/frontend/contexts/SessionContext.js` confirm bank accounts are loaded per user

## Limitations

- No automated tests or lint/typecheck script in `package.json`
- Verification here is source inspection, not browser or API runtime execution

---

# TEST RESULTS — Restore Missing SummaryReport Rows

**Spec:** `.PIPELINE/spec.md` (Restore Missing SummaryReport Rows & Wiring)
**Test Date:** 2026-06-03
**Branch:** develop
**Test Method:** Static code analysis (no test framework configured — `package.json` has no test script and no test dependencies)
**Files Analysed:**
- `src/backend/data/savings-goals.json`
- `pages/api/savings-goals.js`
- `src/shared/utils/frontend/apiUtils.js`
- `src/frontend/components/SavingsGoalTracker.js`
- `pages/edit.js`
- `src/frontend/components/SummaryReport.js`

---

## Test Framework Status

No test framework present. `package.json` scripts: `{ "dev", "build", "start" }` only. No jest, vitest, mocha, cypress, or playwright dependencies. Static analysis performed via full file read + data flow tracing.

---

## Summary

| Metric | Count |
|--------|-------|
| Acceptance criteria evaluated | 10 |
| PASS | 9 |
| FAIL | 1 |
| New bugs found | 1 |
| **Gate** | **FAIL — stop at Stage 4** |

---

## Acceptance Criteria Verification

### AC-1: "ควรเก็บต่อเดือน" row visible — PASS

Row exists at `SummaryReport.js:289–296`. Position is between "ยอดรวมเงินเก็บรายเดือน" (line 282) and "ยอดเงินคงเหลือ" (line 305). Label, value expression (`allocatableAmount ?? 0`), CSS classes (`styles.itemValue`, `styles.income`), `tabIndex={0}`, and `aria-label` are all present.

---

### AC-2: "ควรเก็บต่อเดือน" value correct — PASS

**Planner closed:** `plannerOpen = false` → `currentAllocatable = 0` → `onAllocatableChange(0)` → `allocatableAmount = 0` in `edit.js` → `formatCurrency(0)` = `"0 ฿"`. ✓

**Planner open with 20%, balance = 50,000:** `postExpenseBalance = 50,000`, `savingsPercentage = 20` → `currentAllocatable = 50,000 × 0.20 = 10,000`. Callback fires via `useEffect([currentAllocatable, onAllocatableChange])` at `SavingsGoalTracker.js:166–170`. `allocatableAmount` in `edit.js` becomes `10,000`. Prop passed to `<SummaryReport allocatableAmount={allocatableAmount}>` at `edit.js:643`. Row displays `"10,000 ฿"`. ✓

**`?? 0` guard:** `allocatableAmount` is initialised to `0` via `useState(0)` at `edit.js:218`. The guard is redundant but harmless. No `NaN ฿` on first render. ✓

---

### AC-3: "รวมเป้าหมายเงินออม" row visible — PASS

Row exists at `SummaryReport.js:297–304`. Positioned immediately after "ควรเก็บต่อเดือน" (line 296), before "ยอดเงินคงเหลือ" (line 305). Uses `${styles.itemValue} ${styles.goalTarget}`. CSS class `.itemValue.goalTarget` confirmed at `SummaryReport.module.css:311–314`.

---

### AC-4: "รวมเป้าหมายเงินออม" value correct — PASS

`SummaryReport.js:133–135`:
```js
const activeGoals = (goalsRes?.goals || [])
  .filter(g => g.status !== 'completed' && g.status !== 'abandoned');
setTotalGoalsTarget(activeGoals.reduce((sum, g) => sum + (parseFloat(g.targetAmount) || 0), 0));
```
Goals with `status === 'completed'` or `status === 'abandoned'` are excluded. The `parseFloat(g.targetAmount) || 0` guard prevents `NaN` from malformed values. ✓

Server-side GET also excludes `abandoned` goals (`status: { $ne: 'abandoned' }` in MongoDB; `filter(g => g.status !== 'abandoned')` in JSON mode). Completed goals pass through to the client, where they are filtered. ✓

---

### AC-5: "รวมเป้าหมายเงินออม" non-blocking — PASS

Goals fetch at `SummaryReport.js:131–138` is wrapped in its own `try/catch`. The `catch` block is empty (silent). If `/api/savings-goals` returns an error or 404, `setTotalGoalsTarget` is never called and the value stays at its last known state (initially `0`). `setChartData` (line 139) and `onReportDataReady` (lines 140–146) execute regardless. SummaryReport renders all other rows normally. ✓

**Minor concern (non-blocking correctness):** `setChartData` at line 139 is placed AFTER the goals `try/catch` block. If the goals API is slow to respond (but does not throw), `setChartData` is delayed until the goals request completes. The chart will not render until goals API resolves. In a slow network this means "non-blocking" is inaccurate — goals fetch blocks the chart update. Does not crash, but worth noting for performance review.

---

### AC-6: allocatableAmount updates live — PASS

Data flow: `savingsPercentage` / `monthlyLiving` / `plannerNetIncome` change → `currentAllocatable` recomputes (inline at `SavingsGoalTracker.js:155–164`) → `useEffect([currentAllocatable, onAllocatableChange])` at lines 166–170 fires → `onAllocatableChange(currentAllocatable)` = `setAllocatableAmount` in `edit.js` → `allocatableAmount` state updates → `<SummaryReport allocatableAmount={allocatableAmount}>` prop updates → SummaryReport re-renders row. No page reload required. ✓

`setAllocatableAmount` is a React state setter (stable reference across renders). The useEffect dependency on `onAllocatableChange` does not cause infinite loops. ✓

---

### AC-7: Month change resets correctly — FAIL

**Requirement:** Navigate to a new month via floating bar → "ควรเก็บต่อเดือน" resets to 0 ฿ (planner closes); "รวมเป้าหมายเงินออม" refetches.

**"รวมเป้าหมายเงินออม" refetches:** `loadSummaryData` is triggered by `useEffect([selectedMonth, currentUser?.id])` at `SummaryReport.js:83–85`. On month change, `loadSummaryData` re-runs and re-fetches goals. ✓

**"ควรเก็บต่อเดือน" resets to 0:** FAILS. The `<details>` element (`SavingsGoalTracker.js:356`) is an uncontrolled DOM element. Its `open` attribute is driven by the browser, not a React state variable. When `selectedMonth` changes via the floating bar:

1. `SavingsGoalTracker` does NOT unmount (no `key` prop that includes `selectedMonth` at `edit.js:713–717`).
2. `plannerOpen` state remains `true` if the planner was open — no useEffect resets it on `selectedMonth` change.
3. `plannerNetIncome` is NOT cleared before the refetch begins. The refetch effect (`SavingsGoalTracker.js:117–147`) calls `setPlannerLoading(true)` but does NOT call `setPlannerNetIncome(null)` at the start.
4. `savingsPercentage` is reset to `null` via `useEffect([selectedMonth])` at line 151. ✓
5. During the refetch window: `plannerOpen = true`, `plannerNetIncome = <old value>`, `savingsPercentage = null`. With `savingsPercentage = null`, `currentAllocatable = Math.max(0, oldNetIncome - livingAmt)` — which is non-zero if the previous month had income data.
6. `onAllocatableChange` fires with the non-zero value → `allocatableAmount` in `edit.js` is NOT reset to 0.

**Result:** If the planner was open and the previous month had income data, "ควรเก็บต่อเดือน" retains a non-zero stale value during and potentially after month navigation.

**Filed as:** BUG-7 (see bug-log.md).

---

### AC-8: No new `.savings` CSS class — PASS

Grep of `SummaryReport.module.css` for `\.savings` pattern returned no matches. The "ควรเก็บต่อเดือน" row correctly reuses `${styles.income}` (`.itemValue.income`) as specified. BUG-6 duplication is avoided. ✓

---

### AC-9: Existing rows unchanged — PASS

All 6 pre-existing rows confirmed present and unmodified in `SummaryReport.js`:

| Row | Lines | Status |
|-----|-------|--------|
| ยอดรวมรายรับรายเดือน | 257–264 | ✓ |
| ยอดรวมค่าใช้จ่ายรายเดือน | 265–272 | ✓ |
| ยอดค้างชำระ | 273–280 | ✓ |
| ยอดรวมเงินเก็บรายเดือน | 281–288 | ✓ |
| ยอดเงินคงเหลือ | 305–312 | ✓ |
| ภาษีสะสมตั้งแต่เดือนแรก | 313–320 | ✓ |

Two new rows inserted between "ยอดรวมเงินเก็บรายเดือน" and "ยอดเงินคงเหลือ". No existing rows removed or altered. ✓

---

### AC-10: No `alert()` or `confirm()` — PASS

`SavingsGoalTracker.js` delete flow uses inline `deleteConfirm` state at lines 613–633 (two buttons: ยืนยัน / ยกเลิก). Previously filed BUG-1 (`confirm()` call) has been remediated. No `alert()` or `confirm()` calls present in the file. ✓

---

## Critical Path Traces

### Path A: GET /api/savings-goals → currentAmount

1. `handleJsonMode` (JSON mode): `getJsonGoals(userId)` reads `data[userId].goals` from `savings-goals.json` via `getUserData`. If `data[userId]` is absent, returns `{}` → `bucket?.goals` is `undefined` → returns `[]`. No crash. ✓
2. `computeCurrentAmountsFromJson`: `getUserData('savings.json', userId)` returns user's savings bucket `{ "YYYY-MM": { savings_list: [...] }, ... }`. `Object.values()` produces array of monthly docs. If empty, each goal gets `currentAmount = 0`. ✓
3. `progressPercentage` guard at `savings-goals.js:60`: `targetAmount > 0 ? Math.min(100, ...) : 0`. No division by zero. No `NaN`. ✓

### Path B: savingsGoalsAPI.getAll() in apiUtils

`savingsGoalsAPI.getAll()` at `apiUtils.js:217`: `jsonFetch(buildUrl('/api/savings-goals'))`. `buildUrl` appends `userId` from `requireActiveUserId()` to query string. `jsonFetch` injects `withApiTokenHeaders` (Bearer token). Server-side: `assertApiToken` checks the token, `getUserId(req)` reads from `req.query.userId`. Per-user isolation confirmed. ✓

### Path C: onAllocatableChange → edit.js → SummaryReport

`SavingsGoalTracker:83` receives `onAllocatableChange` prop → `useEffect([currentAllocatable, onAllocatableChange]):166–170` calls it on every change → `setAllocatableAmount` in `edit.js:218` → `allocatableAmount` prop at `edit.js:643` → `SummaryReport` prop signature at line 19 → "ควรเก็บต่อเดือน" row at line 295. Chain complete. ✓

### Path D: SummaryReport goals fetch → totalGoalsTarget → row renders

`loadSummaryData` → `savingsGoalsAPI.getAll()` → filter active → reduce `targetAmount` → `setTotalGoalsTarget` → "รวมเป้าหมายเงินออม" row at line 303 reads `totalGoalsTarget` from state (initialised `0`). On API error: catch is silent, state keeps previous value. ✓

### Path E: Auth token on all savings-goals requests

All `savingsGoalsAPI` methods (getAll/create/update/delete) go through `jsonFetch`. `jsonFetch` applies `withApiTokenHeaders(options.headers || {})` unconditionally (line 64). `withApiTokenHeaders` merges the existing headers with the `Authorization: Bearer <token>` header. Auth is present on all requests. ✓

### Path F: Per-user isolation in API

`pages/api/savings-goals.js:22–32` — `getUserId(req)` reads from `req.query.userId` (GET) or `req.body.userId` (POST/PUT/DELETE). `withUserPayload(payload)` at `apiUtils.js:43–45` injects `userId: requireActiveUserId()` into every mutating request body. All JSON-mode reads/writes are scoped to `userId`. MongoDB queries include `{ userId }` filter. Isolation is enforced. ✓

---

## Additional Observations (non-blocking)

| Observation | Severity | Details |
|-------------|----------|---------|
| `setChartData` delayed by goals fetch | LOW | Goals fetch is `await`-ed inside `loadSummaryData`; if goals API is slow (not erroring), chart update is delayed. Claim of "non-blocking" applies only to error paths. |
| Duplicate `currentAllocatable`/`allocatable` calculation | LOW | `currentAllocatable` (line 155) and `allocatable` (line 332) in `SavingsGoalTracker` compute the same value with identical logic. Code duplication only. |
| `plannerNetIncome` not cleared before refetch | MEDIUM | Related to BUG-7. The `useEffect` that fetches `plannerNetIncome` does not call `setPlannerNetIncome(null)` at the start, meaning stale values persist during loading. |

---

## Bugs Found

| ID | Severity | AC | File | Description |
|----|----------|----|------|-------------|
| BUG-7 | HIGH | AC-7 FAIL | `SavingsGoalTracker.js` + `edit.js` | Month navigation does not close planner; "ควรเก็บต่อเดือน" retains stale non-zero value |

---

## Gate Decision

**FAIL — Stop at Stage 4.**

AC-7 does not pass. BUG-7 filed. Coder must fix before proceeding to Stage 5.
