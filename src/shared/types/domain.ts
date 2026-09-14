/**
 * MonthKey — the app-wide month identifier format, "YYYY-MM" (e.g. "2025-02").
 * Kept as a plain `string` alias, not a branded/nominal type: the codebase already has a
 * runtime validator (`MONTH_KEY_RE` in frontend/monthUtils.ts) and introducing a branded type
 * here would force `as MonthKey` casts at every one of the 87 files that currently pass plain
 * strings into these functions — out of scope for an incremental first slice. Revisit branding
 * only if a future slice finds real typo bugs this plain alias would have caught.
 */
export type MonthKey = string;

/**
 * DueDay — the canonical, stored representation of an expense item's due date, as written by
 * `formatExpenseForSave` (expenseUtils.ts) and read by `isEndOfMonthDueDay`/
 * `resolveDueDayForMonth` (dateUtils.ts):
 *   - a clamped integer 1-31 (a specific day of the month)
 *   - the literal string "EOM" (end-of-month, see END_OF_MONTH_DUE_DAY)
 *   - "" (empty string) when the raw input failed to parse
 * This is distinct from the *raw/unvalidated* input to `normalizeDueDayValue`, which is
 * `number | string` (see that function's own parameter type — not aliased here since it's a
 * transient input shape, not a stored one).
 */
export type DueDay = number | 'EOM' | '';

/**
 * ExpenseItem — the canonical per-item shape used across the app's three cross-cutting
 * "expense row" whitelists (see ARCHITECTURE.md:199-205: `mapDocToFlatItemObjectWithTotals`,
 * `formatExpenseData`, `formatExpenseForSave`). `actual` and `paid` keep the loose union types
 * their real call sites actually produce (raw form state is stringly-typed before
 * `parseToNumber`/`isPaidFlag` normalize it) rather than over-tightening to a shape no live
 * code path actually satisfies pre-normalization.
 */
export interface ExpenseItem {
  name: string;
  actual: number | string;
  account: string;
  paid: boolean | string;
  dueDay: DueDay;
}
