/** @jest-environment node */
// savings-loan-withdrawal S2c, dispatch 5: GET /api/savings-goals reads savings + carry-forward
// through loadLedgerContext's revision bracket (architecture-review-s2c C-S2c-4, C-S2c-10, F-2).
// Real single-node replica set and real withAudit. The only test double is a pass-through wrapper on
// the `savings` handle from lib/dataSource: when armed, it runs a hook just before each savings
// `find(...).toArray()`, which the bracket tests use to commit a real prune mid-read. Unarmed it does
// nothing, so the surfacing and race tests run against unmodified behaviour.
import { MongoMemoryServer } from '../helpers/mongoReplSet';
import { createMocks } from 'node-mocks-http';
import type { Db, Document } from 'mongodb';
import type { NextApiHandler } from 'next';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

declare const jest: typeof import('@jest/globals').jest;

type Item = { savings_type: string; savings_amount: number };
type DataSource = typeof import('../../lib/dataSource');
type GoalBody = { _id: string; currentAmount: number };

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'slw-goals-cf-mongo-user-a';
const USER_B = 'slw-goals-cf-mongo-user-b';
const GOAL_ID = 'd0d0d0d0d0d0d0d0d0d0d0d0';
const OTHER_GOAL_ID = 'd1d1d1d1d1d1d1d1d1d1d1d1';
const CLEARED = ['savings', 'savingsGoals', 'savingsCarryForward', 'savingsLoans', 'savingsWithdrawals', 'audit_logs'];

/** Armed by the bracket tests; runs before each savings read inside loadLedgerContext. */
let beforeSavingsRead: (() => Promise<void>) | null = null;
let savingsReadCount = 0;

let mongod: MongoMemoryServer;
let db: Db;
let goalsHandler: NextApiHandler;
let loansHandler: NextApiHandler;
let savingsHandler: NextApiHandler;
let sessionCookie: typeof import('../../src/shared/utils/backend/sessionCookie');

function hookCursor<T extends object>(cursor: T): T {
  return new Proxy(cursor, {
    get(target, prop) {
      if (prop === 'toArray') {
        return async () => {
          savingsReadCount += 1;
          if (beforeSavingsRead) await beforeSavingsRead();
          return (target as unknown as { toArray(): Promise<unknown[]> }).toArray();
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function hookSavingsCollection<T extends object>(collection: T): T {
  return new Proxy(collection, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (prop === 'find' && beforeSavingsRead) {
        return (...args: unknown[]) => hookCursor((value as (...a: unknown[]) => object).apply(target, args));
      }
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';
  process.env.SESSION_SECRET = TEST_SECRET;

  jest.resetModules();
  jest.doMock('../../lib/dataSource', () => {
    const actual = jest.requireActual('../../lib/dataSource') as DataSource;
    return {
      ...actual,
      getMongoCollection: async (name: string) => {
        const collection = await actual.getMongoCollection(name);
        return name === 'savings' ? hookSavingsCollection(collection) : collection;
      }
    };
  });
  goalsHandler = require('../../pages/api/savings-goals').default;
  loansHandler = require('../../pages/api/savings-loans').default;
  savingsHandler = require('../../pages/api/savings').default;
  sessionCookie = require('../../src/shared/utils/backend/sessionCookie');
  db = await require('../../lib/mongodb').getDbPromise();
}, 60000);

afterAll(async () => {
  if (db?.client) await db.client.close();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  beforeSavingsRead = null;
  savingsReadCount = 0;
  for (const name of CLEARED) await db.collection(name).deleteMany({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---- helpers ----

async function call(handler: NextApiHandler, method: 'GET' | 'POST', body?: unknown, userId = USER_A) {
  const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
  const sid = createSessionId();
  const { req, res } = createMocks({
    method,
    body: body as never,
    cookies: { [SESSION_COOKIE_NAME]: signSession(userId, sid) },
    headers: { 'x-csrf-token': signCsrfToken(sid) }
  });
  await handler(req as never, res as never);
  const raw = res._getData();
  return { status: res._getStatusCode(), body: raw ? JSON.parse(raw) : null };
}

async function goalAmount(goalId = GOAL_ID, userId = USER_A): Promise<number> {
  const res = await call(goalsHandler, 'GET', undefined, userId);
  expect(res.status).toBe(200);
  const goal = (res.body.goals as GoalBody[]).find(g => g._id === goalId);
  expect(goal).toBeDefined();
  return goal!.currentAmount;
}

async function poolBalance(userId = USER_A): Promise<number> {
  const res = await call(loansHandler, 'GET', undefined, userId);
  expect(res.status).toBe(200);
  return res.body.summary.poolBalance;
}

/** `count` consecutive months ending at 2026-03, oldest first. */
function monthKeys(count: number, newest = '2026-03'): string[] {
  const [y, m] = newest.split('-').map(Number);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

const matched = (amount: number): Item => ({ savings_type: 'เที่ยว', savings_amount: amount });
const plain = (amount: number): Item => ({ savings_type: 'ทั่วไป', savings_amount: amount });

async function seedSavings(userId: string, docs: Array<{ month: string; savings_list: Item[] }>) {
  await db.collection('savings').insertMany(docs.map(d => ({ ...d, userId })));
}

async function seedGoals(userId: string) {
  await db.collection('savingsGoals').insertMany([
    { _id: GOAL_ID, userId, goalName: 'เที่ยว', targetAmount: 50000, status: 'active', createdAt: new Date('2026-01-01') },
    { _id: OTHER_GOAL_ID, userId, goalName: 'บ้าน', targetAmount: 50000, status: 'active', createdAt: new Date('2026-01-02') }
  ] as unknown as Document[]);
}

/**
 * 15 months 2025-01 … 2026-03. The oldest holds a goal-matched 1000 and an unmatched 250.5; each
 * other month holds 100 matched + 100 unmatched. Goal = 1000 + 14·100 = 2400; pool = 1250.5 + 14·200 = 4050.5.
 */
async function seedStandard(userId = USER_A) {
  const keys = monthKeys(15);
  await seedSavings(userId, keys.map((month, i) => ({
    month,
    savings_list: i === 0 ? [matched(1000), plain(250.5)] : [matched(100), plain(100)]
  })));
  await seedGoals(userId);
  return keys;
}
const STANDARD_GOAL = 2400;
const STANDARD_POOL = 4050.5;

function sumItems(items: Item[], goalOnly: boolean): number {
  return items
    .filter(i => !goalOnly || i.savings_type === 'เที่ยว')
    .reduce((sum, i) => sum + i.savings_amount, 0);
}

/**
 * Stands in for a concurrent pruning POST that commits mid-read: in ONE transaction, deletes the
 * user's oldest retained month and credits it to the carry-forward (pool + goal), appending it to
 * prunedMonths. Uses the raw driver (no request context), like another process would.
 */
async function commitConcurrentPrune(userId = USER_A): Promise<void> {
  const session = db.client.startSession();
  try {
    await session.withTransaction(async () => {
      const savings = db.collection('savings');
      const cfCol = db.collection('savingsCarryForward');
      const docs = await savings.find({ userId, month: { $exists: true } }, { session }).toArray();
      const oldest = docs.map(d => String(d.month)).sort()[0];
      const pruned = docs.filter(d => d.month === oldest);
      const list = pruned.flatMap(d => d.savings_list as Item[]);
      const current = await cfCol.findOne({ _id: userId as never }, { session });
      const goalAmounts = { ...((current?.goalAmounts as Record<string, number>) ?? {}) };
      goalAmounts[GOAL_ID] = (goalAmounts[GOAL_ID] ?? 0) + sumItems(list, true);
      await savings.deleteMany({ userId, month: oldest }, { session });
      await cfCol.updateOne(
        { _id: userId as never },
        {
          $set: {
            userId,
            poolAmount: Math.round(((current?.poolAmount as number ?? 0) + sumItems(list, false)) * 100) / 100,
            goalAmounts,
            goalAudit: {},
            prunedMonths: [...((current?.prunedMonths as string[]) ?? []), oldest],
            updatedAt: new Date().toISOString()
          }
        },
        { upsert: true, session }
      );
    });
  } finally {
    await session.endSession();
  }
}

// ---- carry-forward surfaced by GET ----

describe('GET /api/savings-goals (Mongo) — carry-forward credit enters currentAmount', () => {
  it('adds a stored goalAmounts credit to the matching goal only', async () => {
    await seedStandard();
    await db.collection('savingsCarryForward').insertOne({
      _id: USER_A as never, userId: USER_A, poolAmount: 900, goalAmounts: { [GOAL_ID]: 700.25 },
      goalAudit: {}, prunedMonths: ['2024-12'], updatedAt: '2026-01-01T00:00:00.000Z'
    });

    expect(await goalAmount(GOAL_ID)).toBe(STANDARD_GOAL + 700.25);
    expect(await goalAmount(OTHER_GOAL_ID)).toBe(0);
  });

  it('without a carry-forward document the result is the S2 value', async () => {
    await seedStandard();

    expect(await goalAmount(GOAL_ID)).toBe(STANDARD_GOAL);
  });

  it('is user-scoped: another user\'s carry-forward never reaches this user', async () => {
    await seedStandard();
    await db.collection('savingsCarryForward').insertOne({
      _id: USER_B as never, userId: USER_B, poolAmount: 5, goalAmounts: { [GOAL_ID]: 5 },
      goalAudit: {}, prunedMonths: ['2024-12'], updatedAt: '2026-01-01T00:00:00.000Z'
    });

    expect(await goalAmount(GOAL_ID)).toBe(STANDARD_GOAL);
  });

  it('end to end: a pruning POST leaves the goal currentAmount unchanged (AC-SLW-38, C-S2c-8)', async () => {
    const keys = await seedStandard();
    const before = await goalAmount(GOAL_ID);

    expect((await call(savingsHandler, 'POST', { month: '2026-04', savings_list: [] })).status).toBe(201);

    const remaining = await db.collection('savings').find({ userId: USER_A }).toArray();
    expect(remaining.map(d => d.month)).not.toContain(keys[0]);
    expect(await goalAmount(GOAL_ID)).toBeCloseTo(before, 2);
  });
});

// ---- F-2 / C-S2c-10: the revision bracket protects the GETs ----

describe('GET (Mongo) — revision bracket against a prune committing mid-read (F-2)', () => {
  it('a prune committed between the carry-forward read and the savings read is retried, not mis-paired', async () => {
    await seedStandard();
    let commits = 0;
    beforeSavingsRead = async () => {
      if (commits === 0) {
        commits += 1;
        await commitConcurrentPrune();
      }
    };

    // Unbracketed, attempt 1 would pair "carry-forward without M" with "savings without M": the goal
    // would lose M's 1000. The bracket sees the revision change and re-reads a consistent pair.
    expect(await goalAmount(GOAL_ID)).toBe(STANDARD_GOAL);
    expect(savingsReadCount).toBe(2);
  });

  it('the same protection covers GET /api/savings-loans (pool figures)', async () => {
    await seedStandard();
    let commits = 0;
    beforeSavingsRead = async () => {
      if (commits === 0) {
        commits += 1;
        await commitConcurrentPrune();
      }
    };

    expect(await poolBalance()).toBe(STANDARD_POOL);
    expect(savingsReadCount).toBe(2);
  });

  it('a carry-forward that keeps changing makes GET /api/savings-goals answer 500 after 3 attempts', async () => {
    await seedStandard();
    beforeSavingsRead = () => commitConcurrentPrune();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await call(goalsHandler, 'GET');

    expect(res).toEqual({ status: 500, body: { error: 'Internal server error' } });
    expect(savingsReadCount).toBe(3);
    expect(errorSpy).toHaveBeenCalledWith('savings-goals GET failed', 'carry-forward changed during read');
  });

  it('an undisturbed GET reads savings exactly once', async () => {
    await seedStandard();
    beforeSavingsRead = async () => undefined;

    expect(await goalAmount(GOAL_ID)).toBe(STANDARD_GOAL);
    expect(savingsReadCount).toBe(1);
  });

  it('race: one pruning POST and 20 GETs in flight together all see the pre-POST balances', async () => {
    await seedStandard();
    const goalBefore = await goalAmount(GOAL_ID);
    const poolBefore = await poolBalance();

    const post = call(savingsHandler, 'POST', { month: '2026-04', savings_list: [] });
    const gets = Array.from({ length: 20 }, (_, i) =>
      call(i % 2 === 0 ? goalsHandler : loansHandler, 'GET'));
    const [postRes, ...getRes] = await Promise.all([post, ...gets]);

    expect(postRes.status).toBe(201);
    getRes.forEach((res, i) => {
      expect(res.status).toBe(200);
      if (i % 2 === 0) {
        const goal = (res.body.goals as GoalBody[]).find(g => g._id === GOAL_ID)!;
        expect(goal.currentAmount).toBeCloseTo(goalBefore, 2);
      } else {
        expect(res.body.summary.poolBalance).toBeCloseTo(poolBefore, 2);
      }
    });
  });
});
