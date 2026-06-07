# changes.md — Context Refresh

**Date:** 2026-06-07
**Branch:** develop
**Type:** refresh-context

---

## Refreshed Pipeline Artifacts

| File | Action | What / Why |
|------|--------|------------|
| `.PIPELINE/README.md` | UPDATED | Refreshed project overview to match current app version `2.2.10`, current API surface, per-user bank accounts, savings goals, and current scripts |
| `.PIPELINE/config` | UPDATED | Corrected entrypoint description for `pages/index.js`, documented current route/auth pattern variants, and added current savings-goals/bank-accounts data facts |
| `.PIPELINE/bug-log.md` | UPDATED | Marked previously logged SummaryReport/allocatable bugs as resolved in current code and separated current-state note from historical findings |
| `.PIPELINE/test-results.md` | UPDATED | Added 2026-06-07 static refresh verification for current code paths and clarified that legacy 2026-06-03 results remain historical |

## Current Code Facts Confirmed During Refresh

| Area | Evidence |
|------|----------|
| Entry route | `pages/index.js` re-exports `./edit` instead of redirect logic |
| Savings goals API | `pages/api/savings-goals.js` exists and supports JSON/Mongo dual mode |
| Summary goal rows | `SummaryReport.js` contains `allocatableAmount`, `totalGoalsTarget`, and fire-and-forget `savingsGoalsAPI.getAll()` |
| Month-reset fix | `pages/edit.js` resets `allocatableAmount` on `selectedMonth` change |
| Bank accounts | `pages/api/user-bank-accounts.js` and `SessionContext.js` wire per-user bank account loading |

## Historical Entry Preserved Below

# changes.md — Restore Missing SummaryReport Rows

**Date:** 2026-06-03
**Branch:** develop
**Spec:** `.PIPELINE/spec.md`

---

## Files Modified / Created

| File | Action | What / Why |
|------|--------|------------|
| `src/backend/data/savings-goals.json` | CREATED | Empty per-user JSON store `{}` for goals API |
| `pages/api/savings-goals.js` | CREATED | GET/POST/PUT/DELETE per-user goals API. GET computes `currentAmount` + `metadata` by joining with `savings.json` entries matching `goalName` (case-insensitive). Follows `savings-allocation.js` dual JSON/MongoDB pattern. PUT/DELETE identify goals by `goalId` field (linter normalised `id` → `goalId` post-write). |
| `src/shared/utils/frontend/apiUtils.js` | MODIFIED | Added `savingsGoalsAPI` export (`getAll`/`create`/`update`/`delete`) before `savingsAllocationAPI` (line 216). `update` and `delete` send `goalId` in body to match the linter-revised API. |
| `src/frontend/components/SavingsGoalTracker.js` | MODIFIED | Added `onAllocatableChange` to function signature. Added `useEffect` that calls `onAllocatableChange(currentAllocatable)` whenever `currentAllocatable` changes — fires `0` when planner closes. |
| `pages/edit.js` | MODIFIED | (1) Added `import SavingsGoalTracker` after `SavingsTable` import. (2) Added `allocatableAmount` state (`useState(0)`) after `triggerSave`. (3) Passed `allocatableAmount` prop to `<SummaryReport>`. (4) Mounted `<SavingsGoalTracker onAllocatableChange={setAllocatableAmount}>` inside savings tab after `</SavingsTable>`. |
| `src/frontend/components/SummaryReport.js` | MODIFIED | (1) Added `savingsGoalsAPI` to import. (2) Added `allocatableAmount` to component signature. (3) Added `totalGoalsTarget` state. (4) Non-blocking goals fetch inside `loadSummaryData` (try/catch after `setSummaryData`, before `setChartData`). (5) Inserted "ควรเก็บต่อเดือน" and "รวมเป้าหมายเงินออม" rows between "ยอดรวมเงินเก็บรายเดือน" and "ยอดเงินคงเหลือ". |

---

## Tester Focus — Highest-Risk Lines

| Risk | File : approx line | What to Verify |
|------|-------------------|----------------|
| **HIGH** | `pages/api/savings-goals.js` — `computeCurrentAmounts` | Reads `savings.json` via `getUserData`. If user has no savings, `savingsDocs` is `[]` and every goal gets `currentAmount: 0` — verify no crash and no `NaN` in `progressPercentage` |
| **HIGH** | `SummaryReport.js:131–138` | Goals fetch is non-blocking (silent `catch`). Verify: if `/api/savings-goals` errors or returns 404, `totalGoalsTarget` stays `0` and SummaryReport still renders all other rows |
| **HIGH** | `SavingsGoalTracker.js` — `onAllocatableChange` useEffect | When planner `<details>` closes, `currentAllocatable` becomes `0` (plannerOpen = false). Callback must fire and set `allocatableAmount = 0` in edit.js. Verify AC-7: navigating to new month via floating bar → planner closes → "ควรเก็บต่อเดือน" resets to 0 ฿ |
| **HIGH** | `apiUtils.js` — `savingsGoalsAPI.update` / `.delete` | Sends `goalId` (not `id`) to match linter-revised API. Verify create/edit/delete round-trips work end-to-end in JSON mode |
| **MEDIUM** | `pages/api/savings-goals.js` PUT — `goalId` field | Linter changed the body field from `id` to `goalId`. `apiUtils.js` was updated to match. Confirm no residual `id` references cause 400 errors in the handler |
| **MEDIUM** | `edit.js` — `SavingsGoalTracker` mount | Component is always mounted when savings tab is active (no `key` churn). Verify it does not emit extra network requests compared to `SavingsTable` (it fetches on `loadGoals` callback, which fires on mount + `refreshTrigger`) |
| **LOW** | `SummaryReport.module.css:311–314` — `.goalTarget` | Uses `var(--warning-color)`. Verify amber renders in both light and dark themes without clipping text |
| **LOW** | `ควรเก็บต่อเดือน` value guard | Uses `allocatableAmount ?? 0` — when prop is `undefined` on first render, `formatCurrency(0)` is called. Verify no `NaN ฿` shown |

---

## Not Done / Skipped

| Item | Reason |
|------|--------|
| `summaryUtils.js` — `goalsData` param | Spec section 3 mentions it as optional but all 5 SummaryReport changes (spec §3.5) show the goals fetch living inside `loadSummaryData`, not in `summaryUtils`. Existing `getSummaryData` signature is unchanged. |
| MongoDB `savingsGoals` collection index on `userId` | Out of scope for this restoration; add manually if query performance is needed. |
| `SavingsGoalTracker.module.css` | No CSS changes required by spec. |
| `SummaryReport.module.css` | No CSS changes required — `.goalTarget` and `.income` already exist at lines 311–314 and 289–295 respectively (spec §2 confirms). |
