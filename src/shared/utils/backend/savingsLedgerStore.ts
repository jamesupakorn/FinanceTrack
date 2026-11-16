/**
 * savingsLedgerStore.ts  (server-only)
 * The only place in the savings-ledger feature that branches on JSON / MongoDB mode
 * (spec-savings-loan-withdrawal §4.3, DATA_MODEL.md §Savings loans & withdrawals).
 * Layering follows creditCardBasics.ts → creditCardStore.ts → route: every rule lives in the pure
 * savingsLedger.ts; this file only reads, writes and composes those rules.
 *
 * Containers:
 *   json : savings-loans.json       → { "<userId>": { loans: SavingsLoan[] } }
 *          savings-withdrawals.json → { "<userId>": { withdrawals: SavingsWithdrawal[] } }
 *   mongo: savingsLoans / savingsWithdrawals (one document per record, string `_id`)
 *          savingsLedgerGuards       (Mongo only: { _id: userId, touchedAt }, NO `userId` field)
 *
 * ⚠ None of these containers has a top-level `month`, so no month-window pruner may touch them
 *   (same reasoning as BR-CC-002).
 * ⚠ userId is always the first, mandatory argument and every Mongo filter includes it.
 *   There is no unscoped read or write.
 */

import { isJsonMode, getMongoCollection } from '../../../../lib/dataSource';
import { getUserData, updateUserData } from '../../../backend/data/userUtils';
import { assertScopedUserId } from './userRequest';
import { calculateTotalSavings } from './apiUtils';
import { computeCurrentAmounts, type SavingsDocument, type SavingsGoal } from './savingsGoalBalances';
import {
  computePoolBalance,
  readLoans,
  readWithdrawals,
  sumLifetimeSavings,
  summarizeLedger,
  type PoolBalance,
  type SavingsLoan,
  type SavingsLoanSource,
  type SavingsWithdrawal,
} from '../savingsLedger';

export const LOANS_JSON_FILE = 'savings-loans.json';
export const WITHDRAWALS_JSON_FILE = 'savings-withdrawals.json';
const SAVINGS_JSON_FILE = 'savings.json';
const GOALS_JSON_FILE = 'savings-goals.json';

export const LOANS_COLLECTION = 'savingsLoans';
export const WITHDRAWALS_COLLECTION = 'savingsWithdrawals';
export const LEDGER_GUARDS_COLLECTION = 'savingsLedgerGuards';
const SAVINGS_COLLECTION = 'savings';
const GOALS_COLLECTION = 'savingsGoals';

type LoanDoc = SavingsLoan & { [key: string]: unknown };
type WithdrawalDoc = SavingsWithdrawal & { [key: string]: unknown };
interface LedgerGuardDoc {
  _id: string;
  touchedAt: Date;
}
type GoalDoc = { _id: unknown; [key: string]: unknown };

export interface LedgerContext {
  loans: SavingsLoan[];
  withdrawals: SavingsWithdrawal[];
  /** Present iff `includeSavings` was set. */
  savingsDocs?: SavingsDocument[];
  /** Non-abandoned goals with a string `_id`; present iff `includeGoals` was set. */
  goals?: SavingsGoal[];
}

export interface LedgerSummaryTotals extends PoolBalance {
  totalOutstanding: number;
  openLoanCount: number;
}

function assertUserScope(userId: unknown): string {
  return assertScopedUserId(userId, 'savingsLedgerStore');
}

/** Ids reach Mongo filters, so anything but a non-empty string is refused (operator-injection guard). */
function isRecordId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function bucketArray(bucket: unknown, field: 'loans' | 'withdrawals'): unknown[] {
  const raw = bucket && typeof bucket === 'object' ? (bucket as Record<string, unknown>)[field] : undefined;
  return Array.isArray(raw) ? raw : [];
}

function hasId(entry: unknown, id: string): boolean {
  return !!entry && typeof entry === 'object' && (entry as { _id?: unknown })._id === id;
}

function hasRepayments(entry: unknown): boolean {
  const repayments = (entry as { repayments?: unknown }).repayments;
  return Array.isArray(repayments) && repayments.length > 0;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Loads the user's ledger (and optionally savings months and goals), normalized through
 * readLoans/readWithdrawals. Inside withAudit every Mongo read joins the request's transaction, so
 * a caller that has acquired the guard first sees state no concurrent ledger write can invalidate.
 */
export async function loadLedgerContext(
  userId: unknown,
  opts: { includeGoals?: boolean; includeSavings?: boolean } = {}
): Promise<LedgerContext> {
  const scopedUserId = assertUserScope(userId);

  if (isJsonMode()) {
    const ctx: LedgerContext = {
      loans: readLoans(getUserData(LOANS_JSON_FILE, scopedUserId).loans),
      withdrawals: readWithdrawals(getUserData(WITHDRAWALS_JSON_FILE, scopedUserId).withdrawals),
    };
    if (opts.includeSavings) {
      ctx.savingsDocs = Object.values(getUserData(SAVINGS_JSON_FILE, scopedUserId) || {}) as SavingsDocument[];
    }
    if (opts.includeGoals) {
      const goals = getUserData(GOALS_JSON_FILE, scopedUserId).goals;
      ctx.goals = (Array.isArray(goals) ? goals as SavingsGoal[] : []).filter(g => g?.status !== 'abandoned');
    }
    return ctx;
  }

  // Sequential on purpose: operations sharing one transaction session must not run concurrently.
  const loansCol = await getMongoCollection<LoanDoc>(LOANS_COLLECTION);
  const loans = readLoans(await loansCol.find({ userId: scopedUserId }).toArray());
  const withdrawalsCol = await getMongoCollection<WithdrawalDoc>(WITHDRAWALS_COLLECTION);
  const withdrawals = readWithdrawals(await withdrawalsCol.find({ userId: scopedUserId }).toArray());
  const ctx: LedgerContext = { loans, withdrawals };

  if (opts.includeSavings) {
    const savingsCol = await getMongoCollection(SAVINGS_COLLECTION);
    // Same query as savings-goals.ts GET, so both read the same months.
    ctx.savingsDocs = await savingsCol
      .find({ userId: scopedUserId, month: { $exists: true } })
      .toArray() as SavingsDocument[];
  }
  if (opts.includeGoals) {
    const goalsCol = await getMongoCollection<GoalDoc>(GOALS_COLLECTION);
    const goals = await goalsCol.find({ userId: scopedUserId, status: { $ne: 'abandoned' } }).toArray();
    ctx.goals = goals.map(g => ({ ...g, _id: String(g._id) }) as SavingsGoal);
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Write-skew guard (D-SLW-16, R-SLW-13)
// ---------------------------------------------------------------------------

/**
 * Mongo: upserts the user's one guard document so concurrent ledger transactions write the same
 * document and conflict; withTransaction retries the loser, which then re-reads fresh state.
 * Must be the FIRST write in the handler (DATA_MODEL invariant 4), before any balance read, and
 * must not be wrapped in a try/catch that swallows the WriteConflict (the retry depends on it).
 * The document has no `userId` field on purpose, so the audit diff never reports it.
 * JSON: no-op — runJsonTransaction already serializes every audited write.
 */
export async function acquireLedgerGuard(userId: unknown): Promise<void> {
  const scopedUserId = assertUserScope(userId);
  if (isJsonMode()) return;

  const guards = await getMongoCollection<LedgerGuardDoc>(LEDGER_GUARDS_COLLECTION);
  await guards.updateOne({ _id: scopedUserId }, { $set: { touchedAt: new Date() } }, { upsert: true });
}

// ---------------------------------------------------------------------------
// Loan writes
// ---------------------------------------------------------------------------

/** The stored `userId` is always the scoped caller, whatever `loan.userId` says. */
export async function insertLoan(userId: unknown, loan: SavingsLoan): Promise<SavingsLoan> {
  const scopedUserId = assertUserScope(userId);
  const doc: SavingsLoan = { ...loan, userId: scopedUserId };

  if (isJsonMode()) {
    updateUserData(LOANS_JSON_FILE, scopedUserId, bucket => ({
      ...bucket,
      loans: [...bucketArray(bucket, 'loans'), doc],
    }));
    return doc;
  }

  const collection = await getMongoCollection<LoanDoc>(LOANS_COLLECTION);
  await collection.insertOne({ ...doc });
  return doc;
}

/** Replaces the loan with the same `_id` owned by this user. Returns false when there is none. */
export async function replaceLoan(userId: unknown, loan: SavingsLoan): Promise<boolean> {
  const scopedUserId = assertUserScope(userId);
  if (!isRecordId(loan?._id)) return false;
  const doc: SavingsLoan = { ...loan, userId: scopedUserId };

  if (isJsonMode()) {
    // Look before writing: a miss must not create an empty bucket or touch the file.
    const current = bucketArray(getUserData(LOANS_JSON_FILE, scopedUserId), 'loans');
    if (!current.some(entry => hasId(entry, doc._id))) return false;
    updateUserData(LOANS_JSON_FILE, scopedUserId, bucket => ({
      ...bucket,
      loans: bucketArray(bucket, 'loans').map(entry => (hasId(entry, doc._id) ? doc : entry)),
    }));
    return true;
  }

  const collection = await getMongoCollection<LoanDoc>(LOANS_COLLECTION);
  const result = await collection.replaceOne({ _id: doc._id, userId: scopedUserId }, { ...doc });
  return result.matchedCount === 1;
}

/**
 * Deletes a loan only if it belongs to this user AND has zero repayments (D-SLW-21, DATA_MODEL
 * invariant 8). The route checks both first to choose 404 vs 409; the filter repeats the rule so
 * the store can never remove a repaid loan. Returns whether a loan was deleted.
 */
export async function deleteLoan(userId: unknown, loanId: unknown): Promise<boolean> {
  const scopedUserId = assertUserScope(userId);
  if (!isRecordId(loanId)) return false;

  if (isJsonMode()) {
    const isDeletable = (entry: unknown) => hasId(entry, loanId) && !hasRepayments(entry);
    const current = bucketArray(getUserData(LOANS_JSON_FILE, scopedUserId), 'loans');
    if (!current.some(isDeletable)) return false;
    updateUserData(LOANS_JSON_FILE, scopedUserId, bucket => ({
      ...bucket,
      loans: bucketArray(bucket, 'loans').filter(entry => !isDeletable(entry)),
    }));
    return true;
  }

  const collection = await getMongoCollection<LoanDoc>(LOANS_COLLECTION);
  const result = await collection.deleteOne({
    _id: loanId,
    userId: scopedUserId,
    'repayments.0': { $exists: false },
  });
  return result.deletedCount === 1;
}

// ---------------------------------------------------------------------------
// Withdrawal writes
// ---------------------------------------------------------------------------

/** The stored `userId` is always the scoped caller, whatever `withdrawal.userId` says. */
export async function insertWithdrawal(userId: unknown, withdrawal: SavingsWithdrawal): Promise<SavingsWithdrawal> {
  const scopedUserId = assertUserScope(userId);
  const doc: SavingsWithdrawal = { ...withdrawal, userId: scopedUserId };

  if (isJsonMode()) {
    updateUserData(WITHDRAWALS_JSON_FILE, scopedUserId, bucket => ({
      ...bucket,
      withdrawals: [...bucketArray(bucket, 'withdrawals'), doc],
    }));
    return doc;
  }

  const collection = await getMongoCollection<WithdrawalDoc>(WITHDRAWALS_COLLECTION);
  await collection.insertOne({ ...doc });
  return doc;
}

/** Any withdrawal of this user may be deleted (D-SLW-21). Returns whether one was deleted. */
export async function deleteWithdrawal(userId: unknown, withdrawalId: unknown): Promise<boolean> {
  const scopedUserId = assertUserScope(userId);
  if (!isRecordId(withdrawalId)) return false;

  if (isJsonMode()) {
    const current = bucketArray(getUserData(WITHDRAWALS_JSON_FILE, scopedUserId), 'withdrawals');
    if (!current.some(entry => hasId(entry, withdrawalId))) return false;
    updateUserData(WITHDRAWALS_JSON_FILE, scopedUserId, bucket => ({
      ...bucket,
      withdrawals: bucketArray(bucket, 'withdrawals').filter(entry => !hasId(entry, withdrawalId)),
    }));
    return true;
  }

  const collection = await getMongoCollection<WithdrawalDoc>(WITHDRAWALS_COLLECTION);
  const result = await collection.deleteOne({ _id: withdrawalId, userId: scopedUserId });
  return result.deletedCount === 1;
}

// ---------------------------------------------------------------------------
// Balances (R-SLW-2, R-SLW-4) — composed from the pure module, never re-derived
// ---------------------------------------------------------------------------

function requireSavingsDocs(ctx: LedgerContext): SavingsDocument[] {
  if (!ctx.savingsDocs) throw new Error('savingsLedgerStore: load the context with includeSavings');
  return ctx.savingsDocs;
}

/** Pool figures plus ledger totals: the loans GET `summary` and the pool no-overdraw check share this. */
export function computeLedgerSummary(ctx: LedgerContext): LedgerSummaryTotals {
  const summary = summarizeLedger(ctx.loans, ctx.withdrawals);
  const pool = computePoolBalance(sumLifetimeSavings(requireSavingsDocs(ctx), calculateTotalSavings), summary);
  return { ...pool, totalOutstanding: summary.totalOutstanding, openLoanCount: summary.openLoanCount };
}

/**
 * Available balance of a source, or null when a goal source is not among the user's
 * non-abandoned goals. Not clamped: it can be negative (E-SLW-12).
 * Needs a context loaded with includeSavings (and includeGoals for a goal source).
 */
export function computeAvailableBalance(ctx: LedgerContext, source: SavingsLoanSource): number | null {
  if (source.type === 'pool') return computeLedgerSummary(ctx).poolBalance;

  if (!ctx.goals) throw new Error('savingsLedgerStore: load the context with includeGoals');
  const goal = ctx.goals.find(g => String(g._id) === source.goalId);
  if (!goal) return null;

  const [withProgress] = computeCurrentAmounts([goal], requireSavingsDocs(ctx));
  // S1 interim: computeCurrentAmounts has no ledger term yet (S2 adds `ledgerByGoal`). The line below
  // is the exact S2 line, so the goal's own loans/withdrawals already count against "available".
  // When S2 lands, pass summarizeLedger(...).byGoal as the third argument and DELETE these lines,
  // otherwise the ledger is subtracted twice.
  const ledger = summarizeLedger(ctx.loans, ctx.withdrawals).byGoal.get(String(goal._id));
  const ledgerTotal = ledger ? ledger.outstanding + ledger.withdrawn : 0;
  const currentAmount = withProgress.currentAmount;
  // Round both branches: currentAmount is an unrounded float sum (0.7 + 0.1 = 0.7999…), which would
  // refuse a borrow of the exact displayed amount (E-SLW-1).
  return Math.round((ledgerTotal !== 0 ? currentAmount - ledgerTotal : currentAmount) * 100) / 100;
}
