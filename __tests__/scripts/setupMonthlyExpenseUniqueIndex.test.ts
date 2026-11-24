/** @jest-environment node */
// loan-installments-td-cleanup, D7 (I7 index-script half). Real single-node replica set
// (mongoReplSet.ts), same convention as savings-carry-forward-mongo.test.ts: env vars in
// beforeAll, jest.resetModules()+fresh require()s, getDbPromise() for direct collection access,
// cleanup in beforeEach. The script's exported step functions are imported directly (same
// technique as migrateCreditExpenseToSpendItems.test.ts), not shelled out to via the CLI.
import { MongoMemoryServer } from '../helpers/mongoReplSet';
import type { Db } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import {
  MONTHLY_EXPENSE_COLLECTION,
  MONTHLY_EXPENSE_UNIQUE_INDEX_NAME
} from '../../src/shared/utils/backend/monthlyExpenseIndex';

declare const jest: typeof import('@jest/globals').jest;

const USER = 'setup-index-user';
const MONTH = '2026-11';

let mongod: MongoMemoryServer;
let db: Db;
let script: typeof import('../../scripts/setupMonthlyExpenseUniqueIndex');

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';

  jest.resetModules();
  script = require('../../scripts/setupMonthlyExpenseUniqueIndex');
  db = await require('../../lib/mongodb').getDbPromise();
}, 60000);

afterAll(async () => {
  if (db?.client) await db.client.close();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  // drop (not just empty) so "collection doesn't exist" cases start from a clean slate too
  const names = (await db.listCollections().toArray()).map(c => c.name);
  if (names.includes(MONTHLY_EXPENSE_COLLECTION)) await db.collection(MONTHLY_EXPENSE_COLLECTION).drop();
});

async function listIndexNames(): Promise<string[]> {
  const names = (await db.listCollections().toArray()).map(c => c.name);
  if (!names.includes(MONTHLY_EXPENSE_COLLECTION)) return [];
  return (await db.collection(MONTHLY_EXPENSE_COLLECTION).listIndexes().toArray()).map(i => i.name as string);
}

describe('setupMonthlyExpenseUniqueIndex (AC-TDC-23..26)', () => {
  it('AC-TDC-23: duplicate pair -> dry-run exits 2, prints _ids, creates no index; --apply also exits 2', async () => {
    await db.collection(MONTHLY_EXPENSE_COLLECTION).insertMany([
      { userId: USER, month: MONTH, rent: { actual: 100 } },
      { userId: USER, month: MONTH, rent: { actual: 200 } }
    ]);

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const dryRunCode = await script.run([]);
      expect(dryRunCode).toBe(2);
      const printed = logSpy.mock.calls.map(call => call.join(' ')).join('\n');
      expect(printed).toContain(USER);
      expect(printed).toContain(MONTH);

      const { groups } = await script.findDuplicates(db);
      expect(groups).toHaveLength(1);
      expect(groups[0].ids).toHaveLength(2);

      expect(await listIndexNames()).not.toContain(MONTHLY_EXPENSE_UNIQUE_INDEX_NAME);

      const applyCode = await script.run(['--apply']);
      expect(applyCode).toBe(2);
      expect(await listIndexNames()).not.toContain(MONTHLY_EXPENSE_UNIQUE_INDEX_NAME);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('AC-TDC-24: no duplicates (+ legacy docs) -> dry-run exits 0 creates nothing; --apply exits 0 and creates the index; rerun is idempotent', async () => {
    await db.collection(MONTHLY_EXPENSE_COLLECTION).insertMany([
      { userId: USER, month: MONTH, rent: { actual: 100 } },
      { userId: USER, legacyNoMonthField: true }, // no month at all
      { userId: USER, month: null, legacyNullMonth: true } // month: null
    ]);

    const dryRunCode = await script.run([]);
    expect(dryRunCode).toBe(0);
    expect(await listIndexNames()).not.toContain(MONTHLY_EXPENSE_UNIQUE_INDEX_NAME);

    const applyCode = await script.run(['--apply']);
    expect(applyCode).toBe(0);

    const indexes = await db.collection(MONTHLY_EXPENSE_COLLECTION).listIndexes().toArray();
    const created = indexes.find(i => i.name === MONTHLY_EXPENSE_UNIQUE_INDEX_NAME);
    expect(created).toBeDefined();
    expect(created!.unique).toBe(true);
    expect(created!.partialFilterExpression).toEqual({ userId: { $type: 'string' }, month: { $type: 'string' } });

    // second --apply is idempotent
    const rerunCode = await script.run(['--apply']);
    expect(rerunCode).toBe(0);
    const indexesAfterRerun = await db.collection(MONTHLY_EXPENSE_COLLECTION).listIndexes().toArray();
    expect(indexesAfterRerun.filter(i => i.name === MONTHLY_EXPENSE_UNIQUE_INDEX_NAME)).toHaveLength(1);
  });

  it('AC-TDC-25: a pre-existing non-unique {userId:1, month:1} index -> exit 3, index list unchanged', async () => {
    await db.collection(MONTHLY_EXPENSE_COLLECTION).insertOne({ userId: USER, month: MONTH, rent: { actual: 100 } });
    await db.collection(MONTHLY_EXPENSE_COLLECTION).createIndex(
      { userId: 1, month: 1 },
      { name: 'legacy_userId_month_non_unique' }
    );

    const before = await listIndexNames();

    const code = await script.run([]);
    expect(code).toBe(3);

    const after = await listIndexNames();
    expect(after.sort()).toEqual(before.sort());
    expect(after).not.toContain(MONTHLY_EXPENSE_UNIQUE_INDEX_NAME);

    const applyCode = await script.run(['--apply']);
    expect(applyCode).toBe(3);
    expect((await listIndexNames()).sort()).toEqual(before.sort());
  });

  it('AC-TDC-26: an unknown flag exits 1 before any DB connection; the script file is .ts; MIGRATIONS.md gained the entry and lost no lines', async () => {
    // Prove no DB connection is attempted: pull the URI out from under the script. If `run`
    // tried to connect, getDbPromise() would throw ("Please add your Mongo URI"); instead it
    // must short-circuit on the usage error and never reach the connection at all.
    const savedUri = process.env.MONGODB_URI;
    delete process.env.MONGODB_URI;

    let code: number;
    try {
      code = await script.run(['--bogus']);
    } finally {
      process.env.MONGODB_URI = savedUri;
    }
    expect(code).toBe(1);

    const fs = require('fs');
    const path = require('path');
    const scriptPath = path.join(__dirname, '../../scripts/setupMonthlyExpenseUniqueIndex.ts');
    expect(fs.existsSync(scriptPath)).toBe(true);
    expect(scriptPath.endsWith('.ts')).toBe(true);

    const migrationsPath = path.join(__dirname, '../../scripts/MIGRATIONS.md');
    const migrationsContent: string = fs.readFileSync(migrationsPath, 'utf8');
    expect(migrationsContent).toContain('setupMonthlyExpenseUniqueIndex.ts');
    expect(migrationsContent).toContain('Run-state: not run');

    // the five pre-existing bullets in "Repeatable setup/seed scripts" must still be present
    expect(migrationsContent).toContain('setupLoginAttemptsCollection.ts');
    expect(migrationsContent).toContain('setupSavingsGoalsCollection.ts');
    expect(migrationsContent).toContain('seedUsers.ts');
    expect(migrationsContent).toContain('createUser.mts');
    expect(migrationsContent).toContain('printMongoCollections.ts');
  });

  it('parseCliArgs rejects unknown flags and accepts no-args / --apply', () => {
    expect(script.parseCliArgs([])).toEqual({ apply: false });
    expect(script.parseCliArgs(['--apply'])).toEqual({ apply: true });
    expect(() => script.parseCliArgs(['--bogus'])).toThrow(script.UsageError);
  });

  it('indexKeysEqual is order-sensitive', () => {
    expect(script.indexKeysEqual({ userId: 1, month: 1 }, { userId: 1, month: 1 })).toBe(true);
    expect(script.indexKeysEqual({ userId: 1, month: 1 }, { month: 1, userId: 1 })).toBe(false);
  });

  it('exits 0 when the monthly_expense collection does not exist yet', async () => {
    expect((await db.listCollections({ name: MONTHLY_EXPENSE_COLLECTION }).toArray())).toHaveLength(0);
    const code = await script.run([]);
    expect(code).toBe(0);
  });
});
