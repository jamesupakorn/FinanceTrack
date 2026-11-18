/**
 * Savings ledger core — pure, isomorphic helpers (no I/O, no Node or backend imports).
 *
 * Loans (ยืมเงินออม) and withdrawals (ถอนเงินออม) taken from the savings pool or one goal
 * (spec-savings-loan-withdrawal §3/§4.1, BUSINESS_RULE.md R-SLW-1…14). The routes, the ledger
 * store and, later, the repayment sync and the UI dialogs all take their rules from here, so the
 * JSON and Mongo branches can't drift apart. Layering follows creditCardBasics.ts → store → route.
 */

// ---------------------------------------------------------------------------
// Constants (D-SLW-13, D-SLW-18…20)
// ---------------------------------------------------------------------------

export const MAX_LEDGER_NOTE_LENGTH = 120;
export const MAX_OPEN_LOANS_PER_USER = 50;
export const MAX_REPAYMENTS_PER_LOAN = 360;
export const MAX_LEDGER_AMOUNT = 999_999_999.99;
export const REPAYMENT_ROW_PREFIX = 'slr_';
export const REPAYMENT_ROW_KEY_RE = /^slr_[0-9a-f]{24}$/;

// Thailand has no DST, so a fixed +07:00 offset is Asia/Bangkok at every instant.
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types (DATA_MODEL.md §Savings loans & withdrawals)
// ---------------------------------------------------------------------------

export type SavingsLoanSourceType = 'pool' | 'goal';

/** `goalId` is present iff `type === 'goal'`; a pool source is stored as exactly `{ type: 'pool' }`. */
export interface SavingsLoanSource {
  type: SavingsLoanSourceType;
  goalId?: string;
}

export interface SavingsLoanRepayment {
  _id: string;
  amount: number;
  expenseMonth: string;
  expenseRowKey: string;
  createdAt: string;
}

export type SavingsLoanStatus = 'open' | 'closed';

export interface SavingsLoan {
  _id: string;
  userId: string;
  source: SavingsLoanSource;
  principalAmount: number;
  /** Stored, not derived (D-SLW-10); only ever written together with a repayment. */
  outstandingAmount: number;
  status: SavingsLoanStatus;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  /** Append-only (D-SLW-7). */
  repayments: SavingsLoanRepayment[];
}

export interface SavingsWithdrawal {
  _id: string;
  userId: string;
  source: SavingsLoanSource;
  amount: number;
  note?: string | null;
  createdAt: string;
}

/** GET-response shape: `balanceAfter` is derived on read and never stored (D-SLW-24). */
export interface SavingsLoanRepaymentWithBalance extends SavingsLoanRepayment {
  balanceAfter: number;
}

export interface SavingsLoanWithBalance extends Omit<SavingsLoan, 'repayments'> {
  repayments: SavingsLoanRepaymentWithBalance[];
}

export interface LedgerSourceTotals {
  outstanding: number;
  withdrawn: number;
}

export interface LedgerSummary {
  pool: LedgerSourceTotals;
  byGoal: Map<string, LedgerSourceTotals>;
  totalOutstanding: number;
  openLoanCount: number;
}

export interface PoolBalance {
  poolSavingsTotal: number;
  poolOutstanding: number;
  poolWithdrawn: number;
  poolBalance: number;
  /** Carry-forward of already-pruned months included in `poolSavingsTotal` (S2c); 0 when none. */
  poolCarriedForward: number;
}

export type NormalizeLedgerNoteResult =
  | { ok: true; note: string | null }
  | { ok: false; error: 'invalid_note' | 'note_too_long' };

export type ParseLedgerSourceResult =
  | { ok: true; source: SavingsLoanSource }
  | { ok: false; error: 'invalid_source' | 'goal_id_required' };

export type PlanRepaymentResult =
  | { ok: true; applied: number; nextLoan: SavingsLoan; repayment: SavingsLoanRepayment }
  | { ok: false; status: 409; error: 'loan_closed' | 'repayment_limit' };

// ---------------------------------------------------------------------------
// Input parsing (D-SLW-18, D-SLW-19)
// ---------------------------------------------------------------------------

/** 2dp rounding; float dust that rounds to -0 is returned as +0 so it never displays as "-0.00". */
function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Positive amount rounded to 2dp, or null. Accepts numbers and numeric strings with commas
 * ("1,500.50"); rejects booleans, arrays, non-finite values, anything ≤ 0 after rounding
 * (so "0.004" fails) and anything above MAX_LEDGER_AMOUNT.
 */
export function toLedgerAmount(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = typeof value === 'string' ? Number(value.replace(/,/g, '')) : value;
  if (!Number.isFinite(parsed)) return null;
  const rounded = round2(parsed);
  if (!Number.isFinite(rounded) || rounded <= 0 || rounded > MAX_LEDGER_AMOUNT) return null;
  return rounded;
}

/** Missing, null or blank → null; otherwise trimmed and 1-120 characters. */
export function normalizeLedgerNote(value: unknown): NormalizeLedgerNoteResult {
  if (value === undefined || value === null) return { ok: true, note: null };
  if (typeof value !== 'string') return { ok: false, error: 'invalid_note' };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, note: null };
  if (trimmed.length > MAX_LEDGER_NOTE_LENGTH) return { ok: false, error: 'note_too_long' };
  return { ok: true, note: trimmed };
}

/**
 * `type` must be exactly 'pool' or 'goal'. A goal source needs a non-blank string `goalId`
 * (non-strings are rejected here too, so an operator object can't slip through). Any `goalId`
 * on a pool source is dropped (E-SLW-20).
 */
export function parseLedgerSource(value: unknown): ParseLedgerSourceResult {
  if (!isPlainObject(value)) return { ok: false, error: 'invalid_source' };
  if (value.type === 'pool') return { ok: true, source: { type: 'pool' } };
  if (value.type !== 'goal') return { ok: false, error: 'invalid_source' };
  const { goalId } = value;
  if (typeof goalId !== 'string' || goalId.trim().length === 0) {
    return { ok: false, error: 'goal_id_required' };
  }
  return { ok: true, source: { type: 'goal', goalId } };
}

// ---------------------------------------------------------------------------
// Stored-data normalization
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readNote(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readRepayments(raw: unknown): SavingsLoanRepayment[] {
  if (!Array.isArray(raw)) return [];
  const result: SavingsLoanRepayment[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    if (typeof entry._id !== 'string' || entry._id.length === 0 || !isFiniteNumber(entry.amount)) continue;
    result.push({
      _id: entry._id,
      amount: entry.amount,
      expenseMonth: asString(entry.expenseMonth),
      expenseRowKey: asString(entry.expenseRowKey),
      createdAt: asString(entry.createdAt),
    });
  }
  return result;
}

/** Non-array → []. Entries without a string `_id`, a valid source or finite amounts are skipped; order is kept. */
export function readLoans(raw: unknown): SavingsLoan[] {
  if (!Array.isArray(raw)) return [];
  const result: SavingsLoan[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    if (typeof entry._id !== 'string' || entry._id.length === 0) continue;
    const source = parseLedgerSource(entry.source);
    if (!source.ok) continue;
    if (!isFiniteNumber(entry.principalAmount) || !isFiniteNumber(entry.outstandingAmount)) continue;
    const status: SavingsLoanStatus = entry.status === 'open' || entry.status === 'closed'
      ? entry.status
      : (entry.outstandingAmount > 0 ? 'open' : 'closed');
    result.push({
      _id: entry._id,
      userId: asString(entry.userId),
      source: source.source,
      principalAmount: entry.principalAmount,
      outstandingAmount: entry.outstandingAmount,
      status,
      note: readNote(entry.note),
      createdAt: asString(entry.createdAt),
      updatedAt: asString(entry.updatedAt),
      closedAt: typeof entry.closedAt === 'string' ? entry.closedAt : null,
      repayments: readRepayments(entry.repayments),
    });
  }
  return result;
}

/** Same contract as readLoans. */
export function readWithdrawals(raw: unknown): SavingsWithdrawal[] {
  if (!Array.isArray(raw)) return [];
  const result: SavingsWithdrawal[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    if (typeof entry._id !== 'string' || entry._id.length === 0) continue;
    const source = parseLedgerSource(entry.source);
    if (!source.ok) continue;
    if (!isFiniteNumber(entry.amount)) continue;
    result.push({
      _id: entry._id,
      userId: asString(entry.userId),
      source: source.source,
      amount: entry.amount,
      note: readNote(entry.note),
      createdAt: asString(entry.createdAt),
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Sources and balances (R-SLW-2, R-SLW-3)
// ---------------------------------------------------------------------------

/** 'pool' or `goal:<goalId>`. */
export function sourceKey(source: SavingsLoanSource): string {
  return source.type === 'pool' ? 'pool' : `goal:${source.goalId ?? ''}`;
}

export function isSameSource(a: SavingsLoanSource, b: SavingsLoanSource): boolean {
  return sourceKey(a) === sourceKey(b);
}

function goalTotals(byGoal: Map<string, LedgerSourceTotals>, goalId: string): LedgerSourceTotals {
  let totals = byGoal.get(goalId);
  if (!totals) {
    totals = { outstanding: 0, withdrawn: 0 };
    byGoal.set(goalId, totals);
  }
  return totals;
}

/**
 * Sums `outstandingAmount` over ALL loans of each source (a closed loan holds 0, so a status bug
 * can never hide money) and `amount` over all withdrawals. Every sum is rounded to 2dp.
 */
export function summarizeLedger(
  loans: readonly SavingsLoan[],
  withdrawals: readonly SavingsWithdrawal[]
): LedgerSummary {
  const pool: LedgerSourceTotals = { outstanding: 0, withdrawn: 0 };
  const byGoal = new Map<string, LedgerSourceTotals>();
  let totalOutstanding = 0;
  let openLoanCount = 0;

  for (const loan of loans) {
    const target = loan.source.type === 'pool' ? pool : goalTotals(byGoal, loan.source.goalId ?? '');
    target.outstanding += loan.outstandingAmount;
    totalOutstanding += loan.outstandingAmount;
    if (loan.status === 'open') openLoanCount += 1;
  }
  for (const withdrawal of withdrawals) {
    const target = withdrawal.source.type === 'pool' ? pool : goalTotals(byGoal, withdrawal.source.goalId ?? '');
    target.withdrawn += withdrawal.amount;
  }

  pool.outstanding = round2(pool.outstanding);
  pool.withdrawn = round2(pool.withdrawn);
  byGoal.forEach((totals) => {
    totals.outstanding = round2(totals.outstanding);
    totals.withdrawn = round2(totals.withdrawn);
  });

  return { pool, byGoal, totalOutstanding: round2(totalOutstanding), openLoanCount };
}

/**
 * Σ calculateTotalSavings(doc.savings_list) over every doc with a string `month`, rounded to 2dp.
 * The summing function is injected so this module never imports the backend apiUtils.
 */
export function sumLifetimeSavings(
  savingsDocs: readonly unknown[],
  calculateTotalSavings: (savingsList: unknown) => number
): number {
  let total = 0;
  for (const doc of savingsDocs) {
    if (!isPlainObject(doc) || typeof doc.month !== 'string') continue;
    total += calculateTotalSavings(doc.savings_list);
  }
  return round2(total);
}

/**
 * Not clamped: the pool can go negative after savings rows are lowered (E-SLW-12).
 * `carriedPool` is the carry-forward of already-pruned months (S2c, spec §5.6); with the default 0
 * every result is identical to S1's.
 */
export function computePoolBalance(
  lifetimeSavings: number,
  summary: LedgerSummary,
  carriedPool: number = 0
): PoolBalance {
  const poolSavingsTotal = round2(carriedPool + lifetimeSavings);
  const poolOutstanding = summary.pool.outstanding;
  const poolWithdrawn = summary.pool.withdrawn;
  return {
    poolSavingsTotal,
    poolOutstanding,
    poolWithdrawn,
    poolBalance: round2(poolSavingsTotal - poolOutstanding - poolWithdrawn),
    poolCarriedForward: round2(carriedPool),
  };
}

// ---------------------------------------------------------------------------
// Repayments (D-SLW-10, D-SLW-13, D-SLW-20)
// ---------------------------------------------------------------------------

export function buildRepaymentRowKey(repaymentId: string): string {
  return `${REPAYMENT_ROW_PREFIX}${repaymentId}`;
}

export function isSavingsLoanRepaymentRowKey(key: unknown): boolean {
  return typeof key === 'string' && REPAYMENT_ROW_KEY_RE.test(key);
}

/**
 * Pure: never mutates `loan`. `requestedAmount` is expected to have passed toLedgerAmount already.
 * The applied amount is clamped to the outstanding balance; the loan closes when it reaches 0.
 */
export function planRepayment(
  loan: SavingsLoan,
  requestedAmount: number,
  now: string,
  repaymentId: string,
  expenseMonth: string
): PlanRepaymentResult {
  if (loan.status === 'closed' || loan.outstandingAmount <= 0) {
    return { ok: false, status: 409, error: 'loan_closed' };
  }
  if (loan.repayments.length >= MAX_REPAYMENTS_PER_LOAN) {
    return { ok: false, status: 409, error: 'repayment_limit' };
  }

  const applied = round2(Math.min(requestedAmount, loan.outstandingAmount));
  const outstandingAmount = Math.max(0, round2(loan.outstandingAmount - applied));
  const repayment: SavingsLoanRepayment = {
    _id: repaymentId,
    amount: applied,
    expenseMonth,
    expenseRowKey: buildRepaymentRowKey(repaymentId),
    createdAt: now,
  };
  const nextLoan: SavingsLoan = {
    ...loan,
    source: { ...loan.source },
    outstandingAmount,
    updatedAt: now,
    repayments: [...loan.repayments.map(entry => ({ ...entry })), repayment],
  };
  if (outstandingAmount === 0) {
    nextLoan.status = 'closed';
    nextLoan.closedAt = now;
  }
  return { ok: true, applied, nextLoan, repayment };
}

/** Copy of `loan` with a running `balanceAfter` (principal − cumulative repaid) on each repayment. */
export function withBalanceAfter(loan: SavingsLoan): SavingsLoanWithBalance {
  let repaid = 0;
  const repayments = loan.repayments.map((entry) => {
    repaid += entry.amount;
    return { ...entry, balanceAfter: round2(loan.principalAmount - repaid) };
  });
  return { ...loan, source: { ...loan.source }, repayments };
}

// ---------------------------------------------------------------------------
// Display helpers (UX_SPEC §6.2, §6.3)
// ---------------------------------------------------------------------------

interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number;
}

function toBangkokCalendarDate(input: string | number | Date): CalendarDate | null {
  const time = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (!Number.isFinite(time)) return null;
  const shifted = new Date(time + BANGKOK_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/**
 * Asia/Bangkok "current month" and day of month for one instant (C-S3-13). A repayment computes
 * it once per request and uses it for both the D-SLW-22 month range and the D-SLW-23 `dueDay`.
 * Unparseable input → null; callers must not fall back to server-local time.
 */
export function toBangkokMonthDay(now: string | number | Date): { monthKey: string; day: number } | null {
  const date = toBangkokCalendarDate(now);
  if (!date) return null;
  return { monthKey: `${date.year}-${String(date.month).padStart(2, '0')}`, day: date.day };
}

/**
 * Elapsed age of an open loan by Asia/Bangkok calendar dates (UX_SPEC §6.3). It is plain
 * information, never a deadline. Unparseable dates → ''. A `createdAt` after `now` reads as today.
 */
export function formatLoanAge(createdAtIso: string, now: string | number | Date): string {
  if (typeof createdAtIso !== 'string' || createdAtIso.length === 0) return '';
  const start = toBangkokCalendarDate(createdAtIso);
  const end = toBangkokCalendarDate(now);
  if (!start || !end) return '';

  const days = Math.round(
    (Date.UTC(end.year, end.month - 1, end.day) - Date.UTC(start.year, start.month - 1, start.day)) / MS_PER_DAY
  );
  if (days <= 0) return 'เปิดวันนี้';

  const fullMonths = (end.year - start.year) * 12 + (end.month - start.month) - (end.day < start.day ? 1 : 0);
  if (fullMonths < 1) return `เปิดมา ${days} วัน`;
  if (fullMonths < 12) return `เปิดมา ${fullMonths} เดือน`;

  const years = Math.floor(fullMonths / 12);
  const months = fullMonths % 12;
  return months === 0 ? `เปิดมา ${years} ปี` : `เปิดมา ${years} ปี ${months} เดือน`;
}

/** 'ยอดกลาง' / 'เป้าหมาย: <name>' / 'เป้าหมายที่ลบแล้ว' when the goal no longer exists. */
export function formatSourceLabel(source: SavingsLoanSource, goalNameById: ReadonlyMap<string, string>): string {
  if (source.type === 'pool') return 'ยอดกลาง';
  const name = source.goalId !== undefined ? goalNameById.get(source.goalId) : undefined;
  return name !== undefined ? `เป้าหมาย: ${name}` : 'เป้าหมายที่ลบแล้ว';
}
