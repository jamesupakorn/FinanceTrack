/**
 * Savings goal adjustments — pure, isomorphic helpers (no I/O, no Node imports).
 *
 * A goal's tracked amount is the savings-matched sum plus the rounded sum of its embedded
 * `adjustments[]` entries (spec-savings-goal-adjustments §3/§4.1). Used by
 * `pages/api/savings-goals.ts` on the server and, later, by the adjust dialog on the client.
 */

export const MAX_ADJUSTMENTS_PER_GOAL = 120;
export const MAX_ADJUSTMENT_NOTE_LENGTH = 120;
/** Absolute cap per entry — same value as MAX_SPEND_ITEM_AMOUNT (creditCardBasics.ts:90), user-confirmed. */
export const MAX_ADJUSTMENT_AMOUNT = 9_999_999.99;

export interface SavingsGoalAdjustment {
  _id: string;
  amount: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export type AdjustmentAction = 'addAdjustment' | 'editAdjustment' | 'deleteAdjustment';

const ADJUSTMENT_ACTIONS: readonly AdjustmentAction[] = ['addAdjustment', 'editAdjustment', 'deleteAdjustment'];

export function isAdjustmentAction(value: unknown): value is AdjustmentAction {
  return typeof value === 'string' && (ADJUSTMENT_ACTIONS as readonly string[]).includes(value);
}

export type AdjustmentRequest =
  | { action: 'addAdjustment'; amount: number; note: string }
  | { action: 'editAdjustment'; adjustmentId: string; amount: number; note: string }
  | { action: 'deleteAdjustment'; adjustmentId: string };

export type ApplyAdjustmentResult =
  | { ok: true; adjustments: SavingsGoalAdjustment[]; adjustment?: SavingsGoalAdjustment }
  | { ok: false; status: 404 | 409; error: string };

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isValidEntry(entry: unknown): entry is SavingsGoalAdjustment {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const e = entry as Record<string, unknown>;
  return typeof e._id === 'string' && e._id.length > 0
    && typeof e.amount === 'number' && Number.isFinite(e.amount) && e.amount !== 0
    && typeof e.note === 'string';
}

/** Missing/non-array → []; invalid entries are skipped; stored order is kept. */
export function readAdjustments(goal: { adjustments?: unknown } | null | undefined): SavingsGoalAdjustment[] {
  const raw = goal?.adjustments;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidEntry).map(e => ({
    _id: e._id,
    amount: e.amount,
    note: e.note,
    createdAt: typeof e.createdAt === 'string' ? e.createdAt : '',
    updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : '',
  }));
}

/** Rounded to 2dp; an empty list returns exactly +0 so legacy goals stay bit-identical. */
export function sumAdjustments(list: readonly SavingsGoalAdjustment[]): number {
  if (list.length === 0) return 0;
  return round2(list.reduce((sum, entry) => sum + entry.amount, 0));
}

/**
 * Signed amount rounded to 2dp, or null when not a number/numeric string, non-finite
 * (checked again after rounding, so 1e307 can't overflow to Infinity), or rounds to 0.
 * The MAX_ADJUSTMENT_AMOUNT cap is a separate check so callers can report it distinctly.
 */
export function toAdjustmentAmount(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = typeof value === 'string' ? Number(String(value).replace(/,/g, '')) : value;
  if (!Number.isFinite(parsed)) return null;
  const rounded = round2(parsed);
  if (!Number.isFinite(rounded) || rounded === 0) return null;
  return rounded;
}

export function isAdjustmentAmountWithinCap(amount: number): boolean {
  return Math.abs(amount) <= MAX_ADJUSTMENT_AMOUNT;
}

/** Trimmed note, or null when not a string, blank, or longer than MAX_ADJUSTMENT_NOTE_LENGTH. */
export function normalizeAdjustmentNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ADJUSTMENT_NOTE_LENGTH) return null;
  return trimmed;
}

/** Pure: never mutates `current`. Input validation (400s) happens before this is called. */
export function applyAdjustmentAction(
  current: readonly SavingsGoalAdjustment[],
  request: AdjustmentRequest,
  now: string,
  newId: string
): ApplyAdjustmentResult {
  if (request.action === 'addAdjustment') {
    if (current.length >= MAX_ADJUSTMENTS_PER_GOAL) {
      return { ok: false, status: 409, error: `adjustment limit reached (${MAX_ADJUSTMENTS_PER_GOAL})` };
    }
    const adjustment: SavingsGoalAdjustment = {
      _id: newId,
      amount: request.amount,
      note: request.note,
      createdAt: now,
      updatedAt: now,
    };
    return { ok: true, adjustments: [...current, adjustment], adjustment };
  }

  const idx = current.findIndex(entry => entry._id === request.adjustmentId);
  if (idx === -1) return { ok: false, status: 404, error: 'Adjustment not found' };

  if (request.action === 'editAdjustment') {
    const adjustment: SavingsGoalAdjustment = {
      ...current[idx],
      amount: request.amount,
      note: request.note,
      updatedAt: now,
    };
    const adjustments = current.map((entry, i) => (i === idx ? adjustment : entry));
    return { ok: true, adjustments, adjustment };
  }

  return { ok: true, adjustments: current.filter((_, i) => i !== idx) };
}
