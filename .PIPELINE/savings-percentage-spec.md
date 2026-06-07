# Feature Spec: Savings Percentage Calculator for Allocation Planner

**Feature Title:** Allow setting a savings percentage to calculate monthly savings target

**Ticket:** Task — ทำให้กำหนดเปอร์เซ็นการออมเงิน

**Date:** 2026-06-03

**Status:** DRAFT (awaiting stakeholder clarification on open questions)

---

## OPEN QUESTIONS (REQUIRED BEFORE IMPLEMENTATION)

These questions must be resolved with the product owner before proceeding to implementation:

### Q1. Scope of Percentage — Global or Per-Goal?

**Question:**
Should the savings percentage be:
- **(A) Global default:** A single percentage stored in user settings that applies to all months and flows into the planner calculation automatically?
- **(B) Per-goal:** Individual savings rate targets for each goal (e.g., "Emergency Fund: save 10% per month" vs "Vacation: save 5%")?

**Implications:**
- **(A)** Simpler UX, less data to manage. Used to calculate the default allocatable amount in the planner.
- **(B)** More flexible but requires UI changes to the goal form and planner display logic.

**Current heuristic:** The planner already calculates `allocatable = ยอดคงเหลือ − ค่าใช้จ่ายเพิ่มเติม`. A global percentage would provide an *alternative* or *complementary* way to set the allocatable amount.

---

### Q2. Storage Location — Where to Persist the Percentage?

**Question:**
Where should the savings percentage be stored?
- **(A) User settings object:** A new field like `userSettings.defaultSavingsRate` (persisted per user, same for all months)?
- **(B) Per-month plan:** A field like `monthlyPlan[month].savingsPercentage` (separate from goals, month-specific)?
- **(C) Goal metadata:** Stored inside `goal.metadata.savingsPercentage` or similar (tied to each goal)?

**Implications:**
- **(A)** Global setting: one API call to fetch/update user settings; simplest.
- **(B)** Per-month: allows different rates per month; more flexible but requires a new data structure.
- **(C)** Goal-level: ties rate to individual targets; requires changes to goal schema and API.

**Current heuristic:** User settings (**(A)**) is the simplest; a dedicated monthly plan (**(B)**) offers the most flexibility for user workflow.

---

### Q3. Interaction with Manual "ค่าใช้จ่ายเพิ่มเติม" Field

**Question:**
How should the savings percentage interact with the existing manual "additional expenses" field?
- **(A) Percentage is primary:** If percentage is set, ignore the manual field; recalculate dynamically.
- **(B) Manual is primary:** If manual field has a value, ignore the percentage.
- **(C) Either/or toggle:** Show a toggle switch; user picks "Percentage mode" or "Manual expense mode" for the planner.
- **(D) Both active:** Both fields work together; total allocatable = (`income − ยอดเงินคงเหลือ`) − manual, then apply percentage to result.
- **(E) Percentage sets the default:** If no manual value is entered, use percentage; allow manual override.

**Implications:**
- **(A)** Simplest but removes manual control.
- **(B)** Adds user confusion (two ways to set the same thing).
- **(C)** Clearest for users but adds UI complexity.
- **(D)** Complex calculation; unclear which takes precedence.
- **(E)** Intuitive: user can quickly set a rate or fine-tune manually each month.

**Current heuristic:** Option **(E)** feels most natural: percentage is a smart default, user can override per-month.

---

### Q4. Calculation Base — What is the Percentage Applied To?

**Question:**
If percentage is set to (e.g.) 20%, what should it calculate?
- **(A) 20% of total income:**  `allocatable = totalIncome × 0.20`
- **(B) 20% of remaining balance:**  `allocatable = (totalIncome − expensesPaid) × 0.20`
- **(C) 20% of allocatable balance:**  `allocatable = (ยอดคงเหลือ − additionalExpenses) × 0.20`
- **(D) Target allocation:** User enters desired allocation amount directly (not a %), e.g., "I want to save 50,000 this month"

**Implications:**
- **(A)** Most user-intuitive: "I save 20% of what I earn."
- **(B)** Focuses on post-expense income: "I save 20% of what's left after bills."
- **(C)** Most conservative: percentage applied to remaining discretionary funds.
- **(D)** Different mental model: fixed amount rather than rate.

**Current heuristic:** **(A)** is most common financial advice pattern ("save X% of gross income").

---

### Q5. Where Should the Percentage Field Live in the UI?

**Question:**
Where should users set/view the savings percentage?
- **(A) Planner panel header:** Add a new input field in the allocation planner summary row (next to/above "ยอดคงเหลือ").
- **(B) Separate settings page:** New dedicated settings UI outside edit.js.
- **(C) Both:** Quick-set in planner panel + full user settings page.
- **(D) Popup/modal:** A small modal when user clicks a new "⚙ Set savings rate" button in the planner.

**Implications:**
- **(A)** Visible, discoverable, but clutters the planner.
- **(B)** Cleaner planner UI but less discoverable.
- **(C)** Best UX but highest effort.
- **(D)** Modal keeps UI clean; adds one extra click.

**Current heuristic:** **(A)** or **(D)** to keep the percentage setting close to the planner where it's used.

---

### Q6. Auto-Calculation and Persistence

**Question:**
After user sets/changes the percentage, what should happen?
- **(A) Auto-recalculate immediately:** Update the `allocatable` amount and re-run allocation waterfall in real-time.
- **(B) Recalculate on demand:** Show an "Apply" button; user confirms before changes take effect.
- **(C) Month-specific carryover:** Only apply for the current month, or carry forward to future months?
- **(D) Persist on Save All:** Percentage is saved when user clicks "บันทึกข้อมูลทั้งหมด" at the bottom.

**Implications:**
- **(A)** Feels responsive but may recalculate too often if user is typing percentage.
- **(B)** More deliberate but adds interaction.
- **(C)** Month-specific is more flexible (each month can have different rate).
- **(D)** Aligns with existing Save All flow but requires new API endpoint to save user settings.

**Current heuristic:** **(A)** with debounce for typing is smooth; **(C)** for month-specific carries over the monthly planner mindset.

---

## TENTATIVE RECOMMENDATION (Pending Clarification)

Based on existing patterns, here is a **likely implementation scenario**:

- **Q1 → (A):** Global default savings rate, stored in user settings
- **Q2 → (A):** User settings object (`userSettings.defaultSavingsPercentage`)
- **Q3 → (E):** Percentage sets smart default; user can override manual "additional expenses" field per-month
- **Q4 → (A):** Percentage of total income (most intuitive)
- **Q5 → (A):** Add input in planner panel header, next to "ยอดเงินคงเหลือ" or "ยอดเงินที่จัดสรรได้"
- **Q6 → (A):** Auto-recalculate on change (with 300ms debounce); persist with Save All

---

## GOAL

Allow users to quickly set a savings target by specifying a percentage (e.g., "I want to save 20% of my income this month"), which automatically calculates the monthly allocation available for savings goals. This reduces friction compared to manually entering an allocation amount or additional expenses each month.

---

## HIGH-LEVEL USER FLOW

1. User opens the allocation planner panel ("แผนการจัดสรรเงินออม") in the edit page.
2. User sees a new input field: "เป้าหมายการออมรายเดือน (%)" next to or above the "ยอดเงินที่จัดสรรได้" display.
3. User enters a percentage (e.g., 20) or selects from presets (10%, 15%, 20%, 25%).
4. The system calculates: `allocatable = totalIncome × (percentage / 100)`.
5. The planner displays: "ควรออม: [บาท] ต่อเดือน" and re-runs the waterfall allocation to all goals.
6. User can still manually override the "ค่าใช้จ่ายเพิ่มเติม" field if needed.
7. Changes persist when user clicks "Save All" (existing flow).

---

## FILES TO MODIFY (Tentative)

### Frontend

1. **`src/frontend/components/SavingsGoalTracker.js`**
   - Add state: `savingsPercentage` (or fetch from user settings)
   - Add input handler: `handleSavingsPercentageChange` with debounce
   - Update `useMemo` allocation logic (lines 229–276) to incorporate percentage
   - Add UI for percentage input in planner panel header
   - Update planner body styles to accommodate new input

2. **`src/frontend/styles/SavingsGoalTracker.module.css`**
   - Add `.plannerPercentageRow` for the new input container
   - Add `.plannerPercentageInput` for input field styling
   - Add `.plannerPercentageLabel` for label text
   - Add `.plannerSavingsTarget` for display of calculated amount
   - Ensure mobile responsive (breakpoint: 768px)

3. **`pages/edit.js`**
   - Pass `savingsPercentage` from SessionContext to SavingsGoalTracker (if stored globally)
   - Ensure Save All trigger includes new percentage state
   - Wire `triggerSave` to persist percentage changes

4. **`src/frontend/contexts/SessionContext.js`** (if percentage stored in user settings)
   - Add `userSettings.defaultSavingsPercentage` to the context
   - Add setter function: `setDefaultSavingsPercentage`
   - Initialize from API on session load

### Backend

5. **`pages/api/user-settings.js`** (new file)
   - GET: return user's current settings including `defaultSavingsPercentage`
   - PUT: update user's `defaultSavingsPercentage` field
   - Validate percentage is 0–100 (inclusive)
   - Assert API token and user ownership

6. **`src/backend/data/userUtils.js`** (extended)
   - Add `getDefaultSavingsPercentage(userId)` helper
   - Add `setDefaultSavingsPercentage(userId, percentage)` helper
   - Use existing user data read/write pattern

### Data

7. **`src/backend/data/users.json`** (schema extension)
   - Add `userSettings.defaultSavingsPercentage` field (type: number, 0–100, default: null or 0)

---

## FILES TO CREATE (Tentative)

- **`pages/api/user-settings.js`** — Manage user preferences including default savings percentage
- *(Optional)* **`src/frontend/utils/savingsPercentageUtils.js`** — Helper functions for percentage-based allocation calculations

---

## INTERFACES & SIGNATURES (Tentative)

### API Endpoint: GET/PUT /api/user-settings

**GET /api/user-settings?userId=u001**
```json
{
  "success": true,
  "settings": {
    "userId": "u001",
    "defaultSavingsPercentage": 20,
    "defaultCurrency": "THB",
    "createdAt": "2025-01-10T...",
    "updatedAt": "2026-06-03T..."
  }
}
```

**PUT /api/user-settings**
```json
{
  "userId": "u001",
  "settings": {
    "defaultSavingsPercentage": 25
  }
}
```

Response:
```json
{
  "success": true,
  "settings": { ... }
}
```

---

### Component: SavingsGoalTracker Props (Tentative)

```jsx
<SavingsGoalTracker
  refreshTrigger={refreshTrigger}
  selectedMonth={selectedMonth}
  savingsPercentage={savingsPercentage}           // New prop
  onSavingsPercentageChange={handleChange}       // New prop
  triggerSave={triggerSave}                       // Existing
/>
```

---

### State Hook: useSavingsPercentageCalculation (Optional)

```js
function useSavingsPercentageCalculation(
  plannerNetIncome,
  savingsPercentage,
  monthlyLiving,
  mode = 'percentage' // or 'manual'
) {
  return useMemo(() => {
    const livingAmt = parseFloat(String(monthlyLiving).replace(/,/g, '')) || 0;
    const income = plannerNetIncome ?? 0;
    
    if (mode === 'percentage' && savingsPercentage) {
      const percentAlloc = income * ((savingsPercentage ?? 0) / 100);
      return Math.max(0, percentAlloc);
    }
    
    // Manual mode (existing logic)
    const manualAlloc = Math.max(0, income - livingAmt);
    return manualAlloc;
  }, [plannerNetIncome, savingsPercentage, monthlyLiving, mode]);
}
```

---

## EXISTING PATTERNS TO FOLLOW

1. **Monthly state management:** Already established in `edit.js` with `months` array and month navigation (see CLAUDE.md section 2.3). Savings percentage should integrate cleanly with existing month switching.

2. **Allocatable calculation:** Existing logic in `SavingsGoalTracker.js` lines 231–233:
   ```js
   const livingAmt = parseFloat(String(monthlyLiving).replace(/,/g, '')) || 0;
   const net = plannerNetIncome ?? 0;
   const allocatable = Math.max(0, net - livingAmt);
   ```
   Percentage logic should *complement* or *replace* this calculation based on Q3 answer.

3. **Toast feedback:** Use existing `showToast()` util (imported from `src/shared/utils/frontend/toast.js`) for validation errors and success messages. Never use `alert()` or `confirm()` (per bug-log.md AC-14).

4. **CSS variables:** Follow project standard (Midnight Glass theme):
   - Use `var(--secondary-color)` for accents
   - Use `var(--text-primary)`, `var(--text-secondary)`, `var(--text-light)` for text
   - Use `var(--border-color)`, `var(--border-light)` for borders
   - **CRITICAL:** Bug log (BUG-2) flags hardcoded `#22c55e` — all new CSS must use variables from `globals.css` only.

5. **Form debouncing:** Wrap percentage input handler in `useCallback` with custom debounce (300–500ms) to avoid excessive recalculation during typing. See `edit.js` for similar patterns.

6. **API token auth:** Follow the pattern in `pages/api/savings-goals.js`:
   - Call `assertApiToken(req, res)` at the start of handler
   - Extract `userId` from query/body/headers
   - Validate user owns the settings being updated
   - Return proper error status codes (400, 401, 404, 500)

7. **Error handling:** Use toast for API errors; gracefully degrade if percentage fetch fails (fallback to null/0, don't break the planner UI).

8. **Locale & labels:** All new labels in Thai, matching existing text:
   - "เป้าหมายการออมรายเดือน (%)" — Monthly savings target (%)
   - "ส่วนแบ่งการออมต้องเป็นบวก" — Savings percentage must be positive
   - "ส่วนแบ่งการออมต้องอยู่ระหว่าง 0–100" — Savings percentage must be 0–100

---

## EDGE CASES

1. **Percentage is 0:** `allocatable = 0`; no allocation to any goal.
2. **Percentage > 100:** Cap at 100% or show a warning toast: "ไม่สามารถออมได้มากกว่า 100%" (Cannot save more than 100%).
3. **Negative percentage:** Reject; show toast "ส่วนแบ่งการออมต้องเป็นบวก" (Percentage must be positive).
4. **Decimal percentage:** Accept (e.g., 12.5); round or truncate as needed for display.
5. **No income:** If `plannerNetIncome` is null/0, disable percentage input with tooltip "กรุณากรอกรายรับก่อน" (Please enter income first).
6. **User switches between months (if per-month):** If percentage is global setting, it applies to all months. If per-month, preserve/load month-specific rates.
7. **Percentage input partially typed:** Debounce to avoid NaN allocations mid-typing.
8. **Fetch user settings fails:** Disable percentage input gracefully; show error toast "ไม่สามารถโหลดการตั้งค่า" (Unable to load settings).
9. **Both manual and percentage set (if Option E):** Percentage is ignored when manual "ค่าใช้จ่ายเพิ่มเติม" > 0.
10. **Percentage persists across page reloads:** If global setting, it should restore. If per-month, clear when user navigates to different month.

---

## OUT OF SCOPE

- Changing the waterfall allocation algorithm (remains priority-based: high → medium → low)
- Modifying goal form fields (goalName, category, priority unchanged)
- Monthly expense breakdown (ExpenseTable unchanged)
- Income or savings tracking updates (SummaryReport unchanged unless adding totals row)
- Tax calculations or TaxTable
- User roles or permissions (assumed single-user or same permissions as existing)
- Mobile-specific percentage input UX beyond existing responsive styles (use standard HTML input[type=number])
- Preset buttons (10%, 15%, 20%, 25%) if adding those requires significant changes; keep it simple with text input first

---

## ACCEPTANCE CRITERIA

### AC-1: Percentage Input Visible in Planner

**Given** the allocation planner is open and user has income for the month,
**When** the user views the planner panel,
**Then** a new input field "เป้าหมายการออมรายเดือน (%)" is visible, accepts numeric values 0–100, and is disabled if income is missing.

### AC-2: Auto-Calculation on Percentage Change

**Given** user enters a percentage (e.g., 20),
**When** the percentage input changes,
**Then** `allocatable` is recalculated as `totalIncome × (percentage / 100)` within 300ms (debounced).

### AC-3: Allocation Updates Reflect Percentage

**Given** a percentage is set and allocatable is recalculated,
**When** the user views the allocation results list,
**Then** each goal's `monthlyAlloc` and `monthsLeft` are updated based on the new allocatable amount, with existing priority-based waterfall logic intact.

### AC-4: Fallback to Manual Mode

**Given** the user clears the percentage field, sets it to 0, or enters an invalid value,
**When** the planner recalculates,
**Then** the "ค่าใช้จ่ายเพิ่มเติม" (manual) field takes precedence if it has a value, or allocatable defaults to 0.

### AC-5: No confirm() or alert() Dialogs

**Given** any user action in the percentage flow (validation, save, error),
**When** the action completes,
**Then** no native `confirm()` or `alert()` dialogs appear. All feedback uses `showToast()` only (AC-14 compliance).

### AC-6: CSS Uses Variables Only

**Given** new CSS rules are added for percentage input styling,
**When** the component renders,
**Then** all colors, borders, shadows use `var(--*)` CSS variables. No hardcoded hex colors like `#22c55e` (AC-15 compliance, per bug-log.md).

### AC-7: Percentage Persists Correctly

**Given** user sets a percentage and clicks "Save All",
**When** the page reloads or user returns later,
**Then** the percentage is restored (if stored in user settings) or behaves as designed (if per-month).

### AC-8: Validation & Feedback

**Given** user enters an invalid value (e.g., -10, 150, "abc"),
**When** the input changes or focus is lost,
**Then** the system shows a toast: "ส่วนแบ่งการออมต้องอยู่ระหว่าง 0–100" or similar, and does not update allocatable with the invalid value.

### AC-9: No Errors When Income Missing

**Given** user opens the planner but hasn't entered income yet,
**When** the planner loads,
**Then** the percentage input is disabled with a tooltip/hint "กรุณากรอกรายรับก่อน" (Please enter income first), and the allocatable amount shows "ไม่พบข้อมูล" (No data found).

### AC-10: Integration with Existing Waterfall

**Given** the percentage feature is active with a valid percentage set,
**When** the allocation planner runs,
**Then** the waterfall allocation (high → medium → low priority) still functions correctly using the new allocatable amount as the distribution pool.

### AC-11: User Settings API

**Given** user sets a default savings percentage,
**When** the user calls `PUT /api/user-settings` with `defaultSavingsPercentage`,
**Then** the API validates it is 0–100, saves it per userId, and returns 200 with updated settings.

### AC-12: Mobile Responsiveness

**Given** the component is viewed on a device < 768px width,
**When** the user interacts with the percentage input,
**Then** the input is touch-friendly (≥ 44px tap target), labels are readable, and layout adapts without overflow.

---

## NOTES FOR IMPLEMENTATION

1. **Debounce:** Wrap the percentage input handler in a debounce hook (300–500ms) to avoid excessive recalculation while user is typing. Example:
   ```js
   const debouncedSetPercentage = useCallback(
     debounce((val) => { /* update state & recalculate */ }, 300),
     []
   );
   ```

2. **Backward compatibility:** If adding `defaultSavingsPercentage` to user settings, ensure existing users without this field default to `null` or `0` (disabled) so they see the manual field as before.

3. **Bug fixes required (from bug-log.md):**
   - **BUG-1 (AC-14):** The existing `handleDelete` uses `confirm()` — must be replaced with inline confirmation panel (as already done in the current code; this is noted but already fixed in component).
   - **BUG-2 (AC-15):** All new CSS must use variables. The existing `#22c55e` in `.plannerGoalFunded` must be replaced with a CSS variable (e.g., `--color-success`).

4. **API error resilience:** If `GET /api/user-settings` fails (network error, 500, etc.), gracefully disable percentage input with a disabled state rather than breaking the entire planner.

5. **Locale:** All new labels and error messages must be in Thai, matching the project's existing language. No English labels.

---

## REFERENCE: EXISTING PLANNER ALLOCATION LOGIC

Current allocation in `SavingsGoalTracker.js` lines 229–276:

```js
const allocationResults = useMemo(() => {
  if (!plannerOpen) return [];
  const livingAmt = parseFloat(String(monthlyLiving).replace(/,/g, '')) || 0;
  const net = plannerNetIncome ?? 0;
  const allocatable = Math.max(0, net - livingAmt);
  
  const remainingOf = (g) =>
    g.metadata?.remainingAmount ?? Math.max(0, (g.targetAmount || 0) - (g.currentAmount || 0));

  const fundableGoals = activeGoals.filter(g => remainingOf(g) > 0);

  const TIER_ORDER = ['high', 'medium', 'low'];
  const resultMap = new Map();
  let pool = allocatable;

  // For each priority tier, distribute pool equally among goals in tier
  // Surplus flows to next tier
  for (const tier of TIER_ORDER) {
    const tierGoals = fundableGoals.filter(g => g.priority === tier);
    if (tierGoals.length === 0) continue;
    if (pool <= 0) {
      tierGoals.forEach(g => resultMap.set(g._id, { monthlyAlloc: 0, monthsLeft: null }));
      continue;
    }
    const slice = pool / tierGoals.length;
    let consumed = 0;
    tierGoals.forEach(g => {
      const rem = remainingOf(g);
      const monthsLeft = slice > 0 ? Math.ceil(rem / slice) : null;
      resultMap.set(g._id, { monthlyAlloc: slice, monthsLeft });
      consumed += Math.min(rem, slice);
    });
    pool = Math.max(0, pool - consumed);
  }
  
  // Return sorted results...
}, [plannerOpen, plannerNetIncome, monthlyLiving, activeGoals]);
```

**Integration point:** Modify the `allocatable` calculation (line 233) to incorporate percentage-based calculation based on answers to Q1–Q6.

---

## NEXT STEPS

1. **Present this spec to stakeholder/PO.**
2. **Await answers to OPEN QUESTIONS (Q1–Q6).**
3. **Update the RECOMMENDATION section once Q&A are resolved.**
4. **Begin implementation once spec is finalized.**

---

## END OF SPEC

Status: **DRAFT** — Awaiting stakeholder clarification

