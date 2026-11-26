/**
 * savingsCarryForward.ts  (server-only)
 * Carry-forward for savings months pruned by BR-002 (spec-savings-loan-withdrawal §5, slice S2c;
 * DATA_MODEL.md "Entity: Savings Carry-Forward"). Holds the contribution of every pruned month so
 * pool and goal balances stay lifetime sums after a prune.
 *
 * Layering: the fold and the cross-check below are pure (no I/O). Store reads/writes live beside
 * them in this module; routes only call into it. `savingsLedgerStore.ts` imports from this module,
 * never the reverse (architecture-review-savings-loan-withdrawal-s2c.md §1).
 *
 * ⚠ Revision invariant (C-S2c-3 / C-S2c-10): `prunedMonths.length`, as read through
 *   `normalizePrunedMonths`, is the revision token of the carry-forward document. Every write must
 *   strictly increase it. `foldPrunedMonths` guarantees this: `next.prunedMonths` is the normalized
 *   current list followed by `creditedMonths`, and a caller writes only when `creditedMonths` is
 *   non-empty. Any future writer (e.g. a cleanup) must keep this invariant or introduce another
 *   revision mechanism — otherwise the revision-bracketed balance read can pair skewed state.
 */

import type { Collection, Document } from 'mongodb';
import { isJsonMode, getMongoCollection } from '../../../../lib/dataSource';
import { getUserData } from '../../../backend/data/userUtils';
import { assertScopedUserId } from './userRequest';
import { calculateTotalSavings, enforceMonthLimit, selectMonthsBeyondLimit } from './apiUtils';
import { matchedAmountForGoalName } from './savingsGoalBalances';

/** JSON: `savings-carry-forward.json` → { "<userId>": SavingsCarryForwardBucket }. */
export const CARRY_FORWARD_JSON_FILE = 'savings-carry-forward.json';
/** Mongo: one `SavingsCarryForward` document per user, `_id === userId`. */
export const CARRY_FORWARD_COLLECTION = 'savingsCarryForward';
/** BR-002 savings retention window; the same limit `pages/api/savings.ts` always used. */
export const SAVINGS_MONTH_LIMIT = 15;
const GOALS_COLLECTION = 'savingsGoals';

// ---------------------------------------------------------------------------
// Shapes (DATA_MODEL.md "Entity: Savings Carry-Forward")
// ---------------------------------------------------------------------------

export interface GoalAuditEntry {
  goalNameAtPrune: string;
  lastPrunedAt: string;
}

/** JSON bucket in `savings-carry-forward.json`; also the fold's output (no `_id`, no `userId`). */
export interface SavingsCarryForwardBucket {
  /** 2dp. Cumulative pool contribution of every already-pruned month. */
  poolAmount: number;
  /** goalId -> 2dp cumulative matched contribution of pruned months. No entry for a zero match. */
  goalAmounts: Record<string, number>;
  /** Informational trail only; never read by matching or balance logic. */
  goalAudit: Record<string, GoalAuditEntry>;
  /** Append-only, duplicate-free list of month keys already folded in (idempotency + revision). */
  prunedMonths: string[];
  /** ISO timestamp. */
  updatedAt: string;
}

/** Mongo document in collection `savingsCarryForward`, one per user (`_id === userId`). */
export interface SavingsCarryForward extends SavingsCarryForwardBucket {
  _id: string;
  /** Present (unlike savingsLedgerGuards) so the audit diff captures changes like any per-user doc. */
  userId: string;
}

/** A pruned month's content as captured right before deletion (Mongo doc or JSON `{ month: mapKey, ... }`). */
export interface PrunedMonthDoc {
  month?: unknown;
  savings_list?: unknown;
  [key: string]: unknown;
}

/** Minimal goal shape the fold needs. Callers pass the user's non-abandoned goals. */
export interface CarryForwardGoal {
  _id?: unknown;
  goalName?: unknown;
  status?: unknown;
  [key: string]: unknown;
}

export interface FoldOptions {
  /**
   * Month not to credit even if pruned. Set only when this request CREATED its own month and the
   * same request's prune deletes it (D-SLW-28 as amended, C-S2c-11); otherwise `null`. The fold
   * does not know why a month is excluded.
   */
  excludeMonth: string | null;
  nowIso: string;
}

/** What balance readers need from the carry-forward (spec §5.1 `readCarryForward`). */
export interface CarryForwardTotals {
  poolAmount: number;
  /** Own keys with finite values only (C-S2c-4). */
  goalAmounts: Record<string, number>;
  /** Normalized by `normalizePrunedMonths`; its length is the revision token (C-S2c-10). */
  prunedMonths: string[];
}

export interface FoldResult {
  /** The full carry-forward state to persist. Equal to the normalized input when nothing is credited. */
  next: SavingsCarryForwardBucket;
  /** Months credited by this fold, in first-seen order. Callers write only when this is non-empty. */
  creditedMonths: string[];
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** 2dp rounding; float dust that rounds to -0 is returned as +0 (same rule as savingsLedger.ts). */
function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Own enumerable entries only, so inherited keys such as `constructor` never leak in (C-S2c-4). */
function ownEntries(value: unknown): Array<[string, unknown]> {
  if (!isPlainObject(value)) return [];
  return Object.keys(value).map(key => [key, value[key]]);
}

/**
 * The single normalizer for `prunedMonths` (C-S2c-3): an array of non-empty strings, otherwise `[]`.
 * Used by the fold and by every reader, so the revision token is computed identically everywhere.
 */
export function normalizePrunedMonths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((month): month is string => typeof month === 'string' && month.length > 0);
}

function normalizeGoalAmounts(raw: unknown): Record<string, number> {
  // Object.fromEntries defines own data properties, so even a `__proto__` key stays inert data.
  return Object.fromEntries(
    ownEntries(raw).filter((entry): entry is [string, number] =>
      typeof entry[1] === 'number' && Number.isFinite(entry[1]))
  );
}

function normalizeGoalAudit(raw: unknown): Record<string, GoalAuditEntry> {
  return Object.fromEntries(
    ownEntries(raw)
      .filter(([, entry]) => isPlainObject(entry))
      .map(([goalId, entry]) => {
        const record = entry as Record<string, unknown>;
        return [goalId, {
          goalNameAtPrune: typeof record.goalNameAtPrune === 'string' ? record.goalNameAtPrune : '',
          lastPrunedAt: typeof record.lastPrunedAt === 'string' ? record.lastPrunedAt : '',
        }];
      })
  );
}

function normalizePoolAmount(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

/** Defensive pre-read normalization of a stored bucket/document; absent input reads as empty. */
function normalizeCurrent(current: unknown, nowIso: string): SavingsCarryForwardBucket {
  const source = isPlainObject(current) ? current : {};
  return {
    poolAmount: normalizePoolAmount(source.poolAmount),
    goalAmounts: normalizeGoalAmounts(source.goalAmounts),
    goalAudit: normalizeGoalAudit(source.goalAudit),
    prunedMonths: normalizePrunedMonths(source.prunedMonths),
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : nowIso,
  };
}

// ---------------------------------------------------------------------------
// Pure fold (spec §5.8 A-1/A-2/A-5, C-S2c-3, C-S2c-11)
// ---------------------------------------------------------------------------

/**
 * Folds the content of pruned savings months into the running carry-forward.
 *
 * Filters before it sums: months already in `current.prunedMonths` (idempotency) and
 * `excludeMonth` are dropped first. Every doc of each surviving month is summed (duplicate Mongo
 * docs for one month are all deleted, so all are credited — A-5), but the month key is appended to
 * `prunedMonths` once. Pool uses `calculateTotalSavings`; goals use `matchedAmountForGoalName`
 * against each non-abandoned goal at prune time, keyed by `String(goal._id)`. A goal gets an entry
 * only when its matched amount is `!== 0`. Every stored figure is rounded to 2dp. The output never
 * contains `_id` or `userId` (the Mongo `$set` adds `userId` itself).
 *
 * @param current    stored bucket/document (any shape; absent reads as empty)
 * @param prunedDocs content of the months the prune is about to delete, at prune time
 * @param goals      the user's non-abandoned goals (abandoned ones are skipped defensively)
 */
export function foldPrunedMonths(
  current: unknown,
  prunedDocs: readonly PrunedMonthDoc[],
  goals: readonly CarryForwardGoal[],
  { excludeMonth, nowIso }: FoldOptions
): FoldResult {
  const base = normalizeCurrent(current, nowIso);
  const alreadyPruned = new Set(base.prunedMonths);

  const creditedMonths: string[] = [];
  const creditedSet = new Set<string>();
  const creditableDocs: PrunedMonthDoc[] = [];
  (prunedDocs || []).forEach(doc => {
    const month = doc?.month;
    if (typeof month !== 'string' || month.length === 0) return;
    if (alreadyPruned.has(month) || month === excludeMonth) return;
    creditableDocs.push(doc);
    if (!creditedSet.has(month)) {
      creditedSet.add(month);
      creditedMonths.push(month);
    }
  });

  if (creditedMonths.length === 0) return { next: base, creditedMonths };

  const poolDelta = creditableDocs.reduce((sum, doc) => sum + calculateTotalSavings(doc.savings_list), 0);

  const goalAmounts = { ...base.goalAmounts };
  const goalAudit = { ...base.goalAudit };
  (goals || []).forEach(goal => {
    if (!goal || goal.status === 'abandoned') return;
    if (goal._id === undefined || goal._id === null) return;
    const goalId = String(goal._id);
    if (goalId.length === 0) return;

    const goalName = typeof goal.goalName === 'string' ? goal.goalName : '';
    const goalNameLower = goalName.trim().toLowerCase();
    let matched = 0;
    creditableDocs.forEach(doc => {
      matched = matchedAmountForGoalName(doc.savings_list, goalNameLower, matched);
    });
    if (matched === 0) return;

    const previous = Object.hasOwn(goalAmounts, goalId) ? goalAmounts[goalId] : 0;
    goalAmounts[goalId] = round2(previous + matched);
    goalAudit[goalId] = { goalNameAtPrune: goalName, lastPrunedAt: nowIso };
  });

  return {
    next: {
      poolAmount: round2(base.poolAmount + poolDelta),
      goalAmounts: Object.fromEntries(
        Object.entries(goalAmounts).map(([goalId, amount]) => [goalId, round2(amount)])
      ),
      goalAudit,
      prunedMonths: [...base.prunedMonths, ...creditedMonths],
      updatedAt: nowIso,
    },
    creditedMonths,
  };
}

// ---------------------------------------------------------------------------
// Fail-closed cross-check (C-S2c-1, closes parent C-11)
// ---------------------------------------------------------------------------

/**
 * Asserts that the months the Mongo prune actually deleted (`enforceMonthLimit(...).prunedMonths`)
 * equal, as a set, the months the carry-forward preview computed and credited from. Throws on any
 * mismatch. Callers must not catch it: inside `withAudit` the throw rolls back the savings write,
 * the carry-forward write and the delete together, turning a divergence into a 500 instead of a
 * silent money error.
 */
export function assertPrunedMonthsMatchPreview(
  previewPruned: readonly string[],
  actualPruned: readonly string[]
): void {
  const preview = new Set(previewPruned);
  const actual = new Set(actualPruned);
  const missing = Array.from(preview).filter(month => !actual.has(month));
  const unexpected = Array.from(actual).filter(month => !preview.has(month));
  if (missing.length === 0 && unexpected.length === 0) return;

  throw new Error(
    `savings carry-forward: prune diverged from preview (not deleted: ${JSON.stringify(missing)}; `
    + `deleted without credit preview: ${JSON.stringify(unexpected)})`
  );
}

// ---------------------------------------------------------------------------
// Mongo prune with carry-forward (spec §5.4, C-S2c-1, C-S2c-11)
// ---------------------------------------------------------------------------

export interface PruneOwnMonth {
  /** The month the request wrote. */
  ownMonth: string;
  /** True iff the request's own upsert inserted that month (`upsertedCount === 1`, C-S2c-11). */
  ownMonthCreated: boolean;
}

export interface PruneWithCarryForwardResult {
  /** Months deleted by `enforceMonthLimit` (equal, as a set, to the preview's). */
  prunedMonths: string[];
  /** Months folded into the carry-forward by this call. */
  creditedMonths: string[];
}

/**
 * The only Mongo prune path for savings (C-S2c-1). Replaces `enforceMonthLimit(collection, 15,
 * { filter: { userId } })` in `pages/api/savings.ts` and credits the pruned months' content to the
 * carry-forward in the same transaction.
 *
 * `collection` MUST be the request's session-wrapped `savings` handle (from `getMongoCollection`
 * inside the handler). A freshly built or module-cached handle would read without this request's
 * own uncommitted write, so the preview would miss a month that the real delete removes (silent
 * money loss, architecture-review-s2c §2.3 vector 1). The cross-check below turns that, or any
 * other preview/delete divergence, into a thrown error.
 *
 * Steps, strictly sequential on one session (no `Promise.all`, no try/catch: a WriteConflict or
 * the cross-check error must reach `withTransaction` / `withAudit`):
 *   1. preview: same filter as `enforceMonthLimit`, projecting the content (`savings_list`);
 *   2. `selectMonthsBeyondLimit` → the months the delete will remove;
 *   3. if any: read goals + carry-forward in the transaction, fold, `$set` the result
 *      (never `$inc`: re-folding is idempotent only through the pre-read `prunedMonths`, A-1);
 *   4. the real `enforceMonthLimit` delete;
 *   5. assert the deleted set equals the preview set, else throw (rolls back all of the above).
 */
export async function pruneSavingsMonthsWithCarryForward(
  collection: Collection<Document>,
  userId: string,
  { ownMonth, ownMonthCreated }: PruneOwnMonth
): Promise<PruneWithCarryForwardResult> {
  const scopedUserId = assertScopedUserId(userId, 'savingsCarryForward');
  const userFilter = { userId: scopedUserId };

  const previewDocs = await collection
    .find({ ...userFilter, month: { $exists: true } }, { projection: { month: 1, savings_list: 1 } })
    .toArray();
  const { pruned } = selectMonthsBeyondLimit(previewDocs.map(doc => doc.month), SAVINGS_MONTH_LIMIT);

  let creditedMonths: string[] = [];
  if (pruned.length > 0) {
    const prunedSet = new Set(pruned);
    const prunedDocs = previewDocs.filter(doc => typeof doc.month === 'string' && prunedSet.has(doc.month));

    const goalsCol = await getMongoCollection(GOALS_COLLECTION);
    const goals = await goalsCol
      .find({ ...userFilter, status: { $ne: 'abandoned' } }, { projection: { _id: 1, goalName: 1, status: 1 } })
      .toArray();
    const carryForwardCol = await getMongoCollection<SavingsCarryForward>(CARRY_FORWARD_COLLECTION);
    const current = await carryForwardCol.findOne({ _id: scopedUserId });

    const folded = foldPrunedMonths(current, prunedDocs, goals, {
      excludeMonth: ownMonthCreated ? ownMonth : null,
      nowIso: new Date().toISOString(),
    });
    creditedMonths = folded.creditedMonths;
    if (creditedMonths.length > 0) {
      await carryForwardCol.updateOne(
        { _id: scopedUserId },
        { $set: { userId: scopedUserId, ...folded.next } },
        { upsert: true }
      );
    }
  }

  const { prunedMonths } = await enforceMonthLimit(collection, SAVINGS_MONTH_LIMIT, { filter: userFilter });
  assertPrunedMonthsMatchPreview(pruned, prunedMonths);
  return { prunedMonths, creditedMonths };
}

// ---------------------------------------------------------------------------
// Store reads (spec §5.1, C-S2c-4, C-S2c-10)
// ---------------------------------------------------------------------------

/**
 * Defensive read of a stored carry-forward (C-S2c-4, DATA_MODEL invariant 7): absent → zeros,
 * non-finite pool → 0, only own `goalAmounts` keys with finite values, `prunedMonths` through
 * `normalizePrunedMonths` so the revision token matches the fold's.
 */
function toCarryForwardTotals(raw: unknown): CarryForwardTotals {
  const source = isPlainObject(raw) ? raw : {};
  return {
    poolAmount: normalizePoolAmount(source.poolAmount),
    goalAmounts: normalizeGoalAmounts(source.goalAmounts),
    prunedMonths: normalizePrunedMonths(source.prunedMonths),
  };
}

/** The user's carry-forward, both modes; an absent bucket/document reads as all zeros (spec §5.1). */
export async function readCarryForward(userId: unknown): Promise<CarryForwardTotals> {
  const scopedUserId = assertScopedUserId(userId, 'savingsCarryForward');
  if (isJsonMode()) return toCarryForwardTotals(getUserData(CARRY_FORWARD_JSON_FILE, scopedUserId));

  const collection = await getMongoCollection<SavingsCarryForward>(CARRY_FORWARD_COLLECTION);
  return toCarryForwardTotals(await collection.findOne({ _id: scopedUserId }));
}

/**
 * Revision-bracketed read (C-S2c-10, closes F-2): carry-forward, then savings, then carry-forward
 * again, strictly sequentially. A pruning commit changes `savings` and the carry-forward together and
 * always grows `prunedMonths` (revision invariant above), so an unchanged length means no such commit
 * became visible during the savings read and the pair is consistent. Retries a changed bracket; after
 * `maxAttempts` mismatches it throws rather than return a skewed pair (the caller answers 500).
 * Inside a transaction the bracket always matches on the first attempt (one snapshot).
 */
export async function readConsistentWithCarryForward<T>(
  readCarryForwardFn: () => Promise<CarryForwardTotals>,
  readSavings: () => Promise<T>,
  maxAttempts = 3
): Promise<{ value: T; carryForward: CarryForwardTotals }> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const before = await readCarryForwardFn();
    const value = await readSavings();
    const after = await readCarryForwardFn();
    if (after.prunedMonths.length === before.prunedMonths.length) return { value, carryForward: before };
  }
  throw new Error('carry-forward changed during read');
}
