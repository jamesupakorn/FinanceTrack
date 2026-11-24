// TD-L08 (loan-installments-td-cleanup, I7): single source of truth for the `monthly_expense`
// unique {userId, month} index definition. Shared by scripts/setupMonthlyExpenseUniqueIndex.ts
// (which creates the index) and, from D6 onward, upsertMonthlyExpenseDoc (the only app upsert
// path into this collection) so the script, the app and the tests can't drift apart.
//
// D7 added the constants; D6 added `upsertMonthlyExpenseDoc` — see
// .pipeline/spec-loan-installments-td-cleanup.md §I7.

import type { Collection, Document } from 'mongodb';
import { relabelDuplicateKeyAsTransient } from './mongoTransactionErrors';

export const MONTHLY_EXPENSE_COLLECTION = 'monthly_expense';
export const MONTHLY_EXPENSE_UNIQUE_INDEX_NAME = 'uniq_userId_month';
export const MONTHLY_EXPENSE_UNIQUE_INDEX_KEY = { userId: 1, month: 1 } as const;
export const MONTHLY_EXPENSE_UNIQUE_INDEX_OPTIONS = {
  name: MONTHLY_EXPENSE_UNIQUE_INDEX_NAME,
  unique: true,
  // D-TDC-4: legacy/metadata docs without a string month (GET skips them, monthly_expense.ts:528) stay out
  partialFilterExpression: { userId: { $type: 'string' }, month: { $type: 'string' } }
} as const;

/**
 * The only upsert path into monthly_expense (Mongo). Relabels a {userId, month} duplicate-key race as
 * transient and rethrows the same object, so withAudit's withTransaction retries the whole handler.
 * Never catches and continues: inside a transaction the server has already aborted (F-TDC-1).
 */
export async function upsertMonthlyExpenseDoc(
  collection: Collection<Document>,
  filter: { month: string; userId: string },
  update: Document
): Promise<void> {
  try {
    await collection.updateOne(filter, update, { upsert: true });
  } catch (error) {
    relabelDuplicateKeyAsTransient(error, MONTHLY_EXPENSE_UNIQUE_INDEX_NAME);
    throw error;
  }
}
