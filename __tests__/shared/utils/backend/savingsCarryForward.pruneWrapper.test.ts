/** @jest-environment node */
// savings-loan-withdrawal S2c, dispatch 4: unit tests for the Mongo prune wrapper
// `pruneSavingsMonthsWithCarryForward` (architecture-review-s2c C-S2c-1 "Required test", C-S2c-11).
// Collaborator stubs only (CODING_STANDARD: mocking a collaborator module to unit-test a helper, not
// a route test with a mocked DB). The real-Mongo behaviour is covered by
// __tests__/api/savings-carry-forward-mongo*.test.ts.
import type { Collection, Document } from 'mongodb';
import { beforeEach, describe, expect, it } from '@jest/globals';

declare const jest: typeof import('@jest/globals').jest;

type Row = Record<string, unknown>;

const USER = 'slw-cf-wrapper-user';
const GOAL_ID = 'c0c0c0c0c0c0c0c0c0c0c0c0';

/** Ordered log of every collaborator call, so tests can assert sequencing. */
let calls: string[] = [];
let goalsDocs: Row[] = [];
let carryForwardDoc: Row | null = null;
let carryForwardWrites: Array<{ filter: Row; update: Row; options: Row }> = [];

jest.mock('../../../../lib/dataSource', () => ({
  isJsonMode: () => false,
  getMongoCollection: async (name: string) => {
    if (name === 'savingsGoals') {
      return {
        find: (filter: Row, options: Row) => {
          calls.push(`goals.find ${JSON.stringify(filter)} ${JSON.stringify(options)}`);
          return { toArray: async () => goalsDocs };
        },
      };
    }
    if (name === 'savingsCarryForward') {
      return {
        findOne: async (filter: Row) => {
          calls.push(`cf.findOne ${JSON.stringify(filter)}`);
          return carryForwardDoc;
        },
        updateOne: async (filter: Row, update: Row, options: Row) => {
          calls.push('cf.updateOne');
          carryForwardWrites.push({ filter, update, options });
          return { upsertedCount: 1, modifiedCount: 0 };
        },
      };
    }
    throw new Error(`unexpected collection ${name}`);
  },
}));

// Required after the mock is registered.
const { pruneSavingsMonthsWithCarryForward } =
  require('../../../../src/shared/utils/backend/savingsCarryForward') as typeof import('../../../../src/shared/utils/backend/savingsCarryForward');

function months(count: number, newest = '2026-03'): string[] {
  const [y, m] = newest.split('-').map(Number);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

function doc(month: string, amount: number, type = 'ทั่วไป'): Row {
  return { month, userId: USER, savings_list: [{ savings_type: type, savings_amount: amount }] };
}

/**
 * A savings-collection stub. `findResults[i]` answers the i-th `find` (0 = the wrapper's preview,
 * 1 = enforceMonthLimit's own read); the last entry repeats.
 */
function savingsStub(findResults: Row[][]) {
  let findCount = 0;
  const deletes: Row[] = [];
  const findArgs: Array<{ filter: Row; options: Row }> = [];
  const collection = {
    find: (filter: Row, options: Row) => {
      const index = Math.min(findCount, findResults.length - 1);
      findCount += 1;
      findArgs.push({ filter, options });
      calls.push(`savings.find#${findCount}`);
      const projection = (options?.projection ?? {}) as Row;
      const rows = findResults[index].map(row => (projection.savings_list ? row : { month: row.month }));
      return { toArray: async () => rows };
    },
    deleteMany: async (filter: Row) => {
      calls.push('savings.deleteMany');
      deletes.push(filter);
      return { deletedCount: 0 };
    },
  };
  return { collection: collection as unknown as Collection<Document>, deletes, findArgs };
}

beforeEach(() => {
  calls = [];
  goalsDocs = [{ _id: GOAL_ID, goalName: 'เที่ยว', status: 'active' }];
  carryForwardDoc = null;
  carryForwardWrites = [];
});

describe('pruneSavingsMonthsWithCarryForward — fail-closed cross-check (C-S2c-1 required test)', () => {
  it('throws when enforceMonthLimit\'s read returns a different month set than the preview', async () => {
    const keys = months(16);
    const previewSet = keys.map(k => doc(k, 100));
    // The second read sees one month fewer (as a session-less preview vs. session-bound delete would).
    const { collection } = savingsStub([previewSet, previewSet.slice(1)]);

    await expect(
      pruneSavingsMonthsWithCarryForward(collection, USER, { ownMonth: keys[15], ownMonthCreated: true })
    ).rejects.toThrow(/prune diverged from preview/);
  });

  it('throws when the real delete removes a month the preview did not credit (preview saw fewer months)', async () => {
    const keys = months(16);
    const all = keys.map(k => doc(k, 100));
    // Preview: 15 months (missing the request's own new month) -> prunes nothing, credits nothing.
    // enforceMonthLimit: 16 months -> deletes the oldest. That is vector 1's silent loss.
    const { collection, deletes } = savingsStub([all.slice(0, 15), all]);

    await expect(
      pruneSavingsMonthsWithCarryForward(collection, USER, { ownMonth: keys[15], ownMonthCreated: true })
    ).rejects.toThrow(`deleted without credit preview: ["${keys[0]}"]`);
    expect(deletes).toHaveLength(1);
    expect(carryForwardWrites).toHaveLength(0);
  });

  it('does not throw and credits when both reads agree', async () => {
    const keys = months(16);
    const all = keys.map((k, i) => (i === 0 ? doc(k, 1000, 'เที่ยว') : doc(k, 100)));
    const { collection } = savingsStub([all]);

    const result = await pruneSavingsMonthsWithCarryForward(collection, USER, { ownMonth: keys[15], ownMonthCreated: true });

    expect(result).toEqual({ prunedMonths: [keys[0]], creditedMonths: [keys[0]] });
  });
});

describe('pruneSavingsMonthsWithCarryForward — sequencing and write shape', () => {
  it('previews, reads goals + carry-forward, $sets, then deletes; all sequential, in this order', async () => {
    const keys = months(16);
    const { collection, findArgs } = savingsStub([keys.map(k => doc(k, 100))]);

    await pruneSavingsMonthsWithCarryForward(collection, USER, { ownMonth: keys[15], ownMonthCreated: true });

    expect(calls).toEqual([
      'savings.find#1',
      `goals.find {"userId":"${USER}","status":{"$ne":"abandoned"}} {"projection":{"_id":1,"goalName":1,"status":1}}`,
      `cf.findOne {"_id":"${USER}"}`,
      'cf.updateOne',
      'savings.find#2',
      'savings.deleteMany',
    ]);
    // Preview uses enforceMonthLimit's exact filter (A-5) and projects the content.
    expect(findArgs[0]).toEqual({
      filter: { userId: USER, month: { $exists: true } },
      options: { projection: { month: 1, savings_list: 1 } },
    });
    expect(findArgs[1].filter).toEqual(findArgs[0].filter);
  });

  it('writes the fold result with a whole-document $set and upsert — never $inc, never _id, no dotted paths', async () => {
    const keys = months(16);
    const all = keys.map((k, i) => (i === 0 ? doc(k, 1000, ' เที่ยว ') : doc(k, 100)));
    carryForwardDoc = { _id: USER, userId: USER, poolAmount: 5, goalAmounts: { [GOAL_ID]: 2 }, goalAudit: {}, prunedMonths: ['2020-01'] };
    const { collection } = savingsStub([all]);

    await pruneSavingsMonthsWithCarryForward(collection, USER, { ownMonth: keys[15], ownMonthCreated: true });

    expect(carryForwardWrites).toHaveLength(1);
    const { filter, update, options } = carryForwardWrites[0];
    expect(filter).toEqual({ _id: USER });
    expect(options).toEqual({ upsert: true });
    expect(Object.keys(update)).toEqual(['$set']);
    const set = update.$set as Row;
    expect(set).not.toHaveProperty('_id');
    expect(Object.keys(set).some(key => key.includes('.'))).toBe(false);
    expect(set).toMatchObject({
      userId: USER,
      poolAmount: 1005,
      goalAmounts: { [GOAL_ID]: 1002 },
      prunedMonths: ['2020-01', keys[0]],
    });
  });

  it('writes nothing when nothing is pruned, and skips the goals/carry-forward reads', async () => {
    const keys = months(15);
    const { collection, deletes } = savingsStub([keys.map(k => doc(k, 100))]);

    const result = await pruneSavingsMonthsWithCarryForward(collection, USER, { ownMonth: keys[14], ownMonthCreated: false });

    expect(result).toEqual({ prunedMonths: [], creditedMonths: [] });
    expect(calls).toEqual(['savings.find#1', 'savings.find#2']);
    expect(deletes).toHaveLength(0);
  });

  it('still deletes but does not write when every pruned month is already in prunedMonths (idempotent)', async () => {
    const keys = months(16);
    carryForwardDoc = { _id: USER, userId: USER, poolAmount: 100, goalAmounts: {}, goalAudit: {}, prunedMonths: [keys[0]] };
    const { collection, deletes } = savingsStub([keys.map(k => doc(k, 100))]);

    const result = await pruneSavingsMonthsWithCarryForward(collection, USER, { ownMonth: keys[15], ownMonthCreated: true });

    expect(result).toEqual({ prunedMonths: [keys[0]], creditedMonths: [] });
    expect(carryForwardWrites).toHaveLength(0);
    expect(deletes).toEqual([{ userId: USER, month: { $in: [keys[0]] } }]);
  });

  it('credits every duplicate doc of a pruned month once in prunedMonths (A-5)', async () => {
    const keys = months(16);
    const all = [...keys.map(k => doc(k, 100)), doc(keys[0], 50)];
    const { collection } = savingsStub([all]);

    await pruneSavingsMonthsWithCarryForward(collection, USER, { ownMonth: keys[15], ownMonthCreated: false });

    const set = carryForwardWrites[0].update.$set as Row;
    expect(set.poolAmount).toBe(150);
    expect(set.prunedMonths).toEqual([keys[0]]);
  });
});

describe('pruneSavingsMonthsWithCarryForward — own-month exclusion (C-S2c-11)', () => {
  // The request's own month is the oldest; it is pruned by its own request.
  const keys = months(16);
  const own = keys[0];
  const all = keys.map(k => doc(k, 100));

  it('ownMonthCreated=true: the own month is pruned but not credited', async () => {
    const { collection } = savingsStub([all]);

    const result = await pruneSavingsMonthsWithCarryForward(collection, USER, { ownMonth: own, ownMonthCreated: true });

    expect(result).toEqual({ prunedMonths: [own], creditedMonths: [] });
    expect(carryForwardWrites).toHaveLength(0);
  });

  it('ownMonthCreated=false: the pre-existing own month is credited', async () => {
    const { collection } = savingsStub([all]);

    const result = await pruneSavingsMonthsWithCarryForward(collection, USER, { ownMonth: own, ownMonthCreated: false });

    expect(result).toEqual({ prunedMonths: [own], creditedMonths: [own] });
    expect((carryForwardWrites[0].update.$set as Row).poolAmount).toBe(100);
  });
});

describe('pruneSavingsMonthsWithCarryForward — user scope', () => {
  it('rejects a missing userId before any read', async () => {
    const { collection } = savingsStub([[]]);

    await expect(
      pruneSavingsMonthsWithCarryForward(collection, '', { ownMonth: '2026-01', ownMonthCreated: true })
    ).rejects.toThrow(/userId is required/);
    expect(calls).toEqual([]);
  });
});
