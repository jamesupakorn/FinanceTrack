#!/usr/bin/env node
/**
 * MongoDB Setup Script: unique {userId, month} index on `monthly_expense` (TD-L08, I7)
 * File: scripts/setupMonthlyExpenseUniqueIndex.ts
 *
 * Concurrent upserts into `monthly_expense` can otherwise create two docs for the same
 * {userId, month} pair (TD-L08). This script creates a unique index that prevents that,
 * once it has proven no such duplicates already exist.
 *
 * Dry-run by default (follows the `scripts/` convention — MIGRATIONS.md). Pass `--apply`
 * to actually create the index. Never drops or alters an existing index: a conflicting
 * index is reported and the run stops (exit 3), the same way an existing duplicate stops
 * it (exit 2). The index key/options come from monthlyExpenseIndex.ts, never redefined
 * here, so the script, the app (`upsertMonthlyExpenseDoc`, added by D6) and the tests
 * can't drift apart.
 *
 * Usage: npx tsx scripts/setupMonthlyExpenseUniqueIndex.ts [--apply]
 *
 * Exit codes:
 *   0 — nothing to do (collection absent, index already present, or dry-run clean)
 *   1 — unexpected error, or an unknown CLI flag (usage line printed before any DB connection)
 *   2 — duplicate {userId, month} groups found (either at the dry-run check, or a race that
 *       slipped a duplicate in between the check and the index build)
 *   3 — a conflicting index already exists on {userId, month} (or under the target name with
 *       different options); nothing was changed
 */

import { getDbPromise } from '../lib/mongodb';
import {
  MONTHLY_EXPENSE_COLLECTION,
  MONTHLY_EXPENSE_UNIQUE_INDEX_NAME,
  MONTHLY_EXPENSE_UNIQUE_INDEX_KEY,
  MONTHLY_EXPENSE_UNIQUE_INDEX_OPTIONS
} from '../src/shared/utils/backend/monthlyExpenseIndex';
import type { Db, Document, Filter } from 'mongodb';

export const USAGE = 'Usage: npx tsx scripts/setupMonthlyExpenseUniqueIndex.ts [--apply]';

export class UsageError extends Error {}

type IndexKey = Record<string, 1 | -1>;

/** Parses CLI args. Only no-args or `--apply` are accepted; anything else throws UsageError. */
export function parseCliArgs(argv: string[]): { apply: boolean } {
  const unknown = argv.filter(arg => arg !== '--apply');
  if (unknown.length > 0) {
    throw new UsageError(`Unknown argument(s): ${unknown.join(', ')}`);
  }
  return { apply: argv.includes('--apply') };
}

/** Order-sensitive compound-key equality. Mongo treats {userId:1,month:1} and {month:1,userId:1}
 *  as distinct indexes, so a plain "same keys" check (ignoring order) would under-compare. */
export function indexKeysEqual(a: IndexKey, b: IndexKey): boolean {
  const aEntries = Object.entries(a);
  const bEntries = Object.entries(b);
  if (aEntries.length !== bEntries.length) return false;
  return aEntries.every(([key, value], i) => bEntries[i][0] === key && bEntries[i][1] === value);
}

export type ExistingIndexCheck =
  | { status: 'absent' }
  | { status: 'ready' }
  | { status: 'conflict'; index: Document };

/** Inspects the collection's existing indexes against the target unique index. Never drops or
 *  alters anything — read-only. */
export async function checkExistingIndex(db: Db): Promise<ExistingIndexCheck> {
  const collection = db.collection(MONTHLY_EXPENSE_COLLECTION);
  const existing = await collection.listIndexes().toArray();
  console.log(
    'Existing indexes:',
    existing.map(index => ({ name: index.name, key: index.key, unique: index.unique }))
  );

  const sameNameIndex = existing.find(index => index.name === MONTHLY_EXPENSE_UNIQUE_INDEX_NAME);
  if (sameNameIndex) {
    const matches =
      indexKeysEqual(sameNameIndex.key as IndexKey, MONTHLY_EXPENSE_UNIQUE_INDEX_KEY) &&
      sameNameIndex.unique === true &&
      JSON.stringify(sameNameIndex.partialFilterExpression ?? null) ===
        JSON.stringify(MONTHLY_EXPENSE_UNIQUE_INDEX_OPTIONS.partialFilterExpression);
    return matches ? { status: 'ready' } : { status: 'conflict', index: sameNameIndex };
  }

  const sameKeyIndex = existing.find(index => indexKeysEqual(index.key as IndexKey, MONTHLY_EXPENSE_UNIQUE_INDEX_KEY));
  if (sameKeyIndex) return { status: 'conflict', index: sameKeyIndex };

  return { status: 'absent' };
}

export type DuplicateGroup = { userId: string; month: string; count: number; ids: unknown[] };

/** Finds duplicate {userId, month} groups within the partial filter's scope (the groups a unique
 *  index would reject), plus — separately — how many docs the partial filter excludes entirely
 *  (missing/non-string userId or month). The exclusion count is informational only; it never
 *  affects the exit code. */
export async function findDuplicates(db: Db): Promise<{ groups: DuplicateGroup[]; excludedCount: number }> {
  const collection = db.collection(MONTHLY_EXPENSE_COLLECTION);
  const partialFilter = MONTHLY_EXPENSE_UNIQUE_INDEX_OPTIONS.partialFilterExpression as Filter<Document>;

  const rawGroups = await collection
    .aggregate([
      { $match: partialFilter },
      { $group: { _id: { userId: '$userId', month: '$month' }, count: { $sum: 1 }, ids: { $push: '$_id' } } },
      { $match: { count: { $gt: 1 } } },
      { $sort: { '_id.userId': 1, '_id.month': 1 } }
    ])
    .toArray();

  const groups: DuplicateGroup[] = rawGroups.map(group => {
    const id = group._id as { userId: string; month: string };
    return { userId: id.userId, month: id.month, count: group.count as number, ids: group.ids as unknown[] };
  });

  const excludedCount = await collection.countDocuments({ $nor: [partialFilter] });

  return { groups, excludedCount };
}

/** Creates the unique index. Returns true on success. Returns false (doesn't throw) only for a
 *  genuine build-time duplicate-key race (code 11000) — a duplicate that appeared between the
 *  dry-run check and the build. Any other error propagates. */
export async function createUniqueIndex(db: Db): Promise<boolean> {
  const collection = db.collection(MONTHLY_EXPENSE_COLLECTION);
  try {
    await collection.createIndex(MONTHLY_EXPENSE_UNIQUE_INDEX_KEY, MONTHLY_EXPENSE_UNIQUE_INDEX_OPTIONS);
    return true;
  } catch (error) {
    const code = (error as { code?: number } | null)?.code;
    if (code === 11000) return false;
    throw error;
  }
}

/** Runs the full dry-run/--apply flow and returns a process exit code. Deliberately doesn't call
 *  process.exit itself, so tests can invoke it directly and assert on the returned code. */
export async function run(argv: string[]): Promise<number> {
  let args: { apply: boolean };
  try {
    args = parseCliArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      console.error(USAGE);
      return 1;
    }
    throw error;
  }

  const db = await getDbPromise();

  const collections = await db.listCollections({ name: MONTHLY_EXPENSE_COLLECTION }).toArray();
  if (collections.length === 0) {
    console.log(`"${MONTHLY_EXPENSE_COLLECTION}" collection doesn't exist yet — nothing to protect.`);
    return 0;
  }

  const existingCheck = await checkExistingIndex(db);
  if (existingCheck.status === 'ready') {
    console.log(`"${MONTHLY_EXPENSE_UNIQUE_INDEX_NAME}" already present — nothing to do.`);
    return 0;
  }
  if (existingCheck.status === 'conflict') {
    console.log('Conflicting index found — refusing to change anything:', existingCheck.index);
    return 3;
  }

  const { groups, excludedCount } = await findDuplicates(db);
  console.log(`Docs excluded by the partial filter (missing/non-string userId or month): ${excludedCount}`);
  if (groups.length > 0) {
    for (const group of groups) {
      console.log(`Duplicate: userId=${group.userId} month=${group.month} count=${group.count} ids=${JSON.stringify(group.ids)}`);
    }
    console.log(
      `❌ ${groups.length} duplicate {userId, month} groups — resolve them manually before creating the index. Nothing was changed.`
    );
    return 2;
  }

  if (!args.apply) {
    console.log(`✓ No duplicates. Re-run with --apply to create ${MONTHLY_EXPENSE_UNIQUE_INDEX_NAME}.`);
    return 0;
  }

  const created = await createUniqueIndex(db);
  if (!created) {
    console.log('❌ Index build failed: a duplicate appeared between the dry-run check and the build. Nothing was created.');
    return 2;
  }

  console.log(`✓ ${MONTHLY_EXPENSE_UNIQUE_INDEX_NAME} ready.`);
  return 0;
}

if (require.main === module) {
  run(process.argv.slice(2))
    .then(code => process.exit(code))
    .catch(error => {
      console.error('❌ Setup failed:', error);
      process.exit(1);
    });
}
