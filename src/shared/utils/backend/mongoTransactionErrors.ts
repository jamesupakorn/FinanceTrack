// loan-installments-td-cleanup (I7, D6): the one place that knows about the Mongo driver's
// TransientTransactionError label. Route catch blocks call rethrowIfTransientTransactionError so a
// labelled error reaches withAudit's session.withTransaction, which re-runs the whole handler
// (D-SLW-16). No other file may inline the label string or call hasErrorLabel/addErrorLabel
// (AC-TDC-36) — import from here instead.

export const TRANSIENT_TRANSACTION_ERROR_LABEL = 'TransientTransactionError';

const DUPLICATE_KEY_CODE = 11000;

interface LabelledError {
  hasErrorLabel: (label: string) => boolean;
  addErrorLabel: (label: string) => void;
}

// Duck-typed rather than `instanceof MongoError`: jest can load more than one copy of the driver
// module, and an instanceof check against the wrong copy would silently return false.
function hasMethod<K extends keyof LabelledError>(error: unknown, method: K): error is Pick<LabelledError, K> {
  return typeof error === 'object' && error !== null && typeof (error as Partial<LabelledError>)[method] === 'function';
}

/** true when the error carries the driver's TransientTransactionError label. null/non-objects → false. */
export function isTransientTransactionError(error: unknown): boolean {
  return hasMethod(error, 'hasErrorLabel') && error.hasErrorLabel(TRANSIENT_TRANSACTION_ERROR_LABEL) === true;
}

/**
 * First statement of a route catch block that would otherwise turn every error into a 500.
 * Rethrows the same object when it is transient; returns normally otherwise, so the caller's
 * existing 500 path runs unchanged. A no-op in JSON mode (nothing carries the label there).
 */
export function rethrowIfTransientTransactionError(error: unknown): void {
  if (isTransientTransactionError(error)) throw error;
}

function isExactUserMonthKeyPattern(keyPattern: unknown): boolean {
  if (!keyPattern || typeof keyPattern !== 'object') return false;
  const pattern = keyPattern as Record<string, unknown>;
  return Object.keys(pattern).length === 2 && pattern.userId === 1 && pattern.month === 1;
}

/**
 * A {userId, month} duplicate-key error (code 11000 whose keyPattern is exactly {userId:1, month:1},
 * or whose errmsg names `indexName`) gains the transient label so the losing upsert retries instead
 * of failing. Anything else is left untouched. Never throws.
 */
export function relabelDuplicateKeyAsTransient(error: unknown, indexName: string): void {
  if (!hasMethod(error, 'addErrorLabel')) return;
  const candidate = error as unknown as { code?: unknown; keyPattern?: unknown; errmsg?: unknown };
  if (candidate.code !== DUPLICATE_KEY_CODE) return;
  const namesIndex = typeof candidate.errmsg === 'string' && candidate.errmsg.includes(indexName);
  if (!isExactUserMonthKeyPattern(candidate.keyPattern) && !namesIndex) return;
  try {
    error.addErrorLabel(TRANSIENT_TRANSACTION_ERROR_LABEL);
  } catch {
    // Relabelling is best-effort; the caller rethrows the original error either way.
  }
}
