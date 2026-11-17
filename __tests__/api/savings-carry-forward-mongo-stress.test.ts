/** @jest-environment node */
// savings-loan-withdrawal S2c, Stage 4 (tester): concurrency stress on the Mongo carry-forward path.
// Checks money conservation (no loss, no double credit) when many pruning saves, double-submits and
// balance GETs run together. Real single-node replica set and real withAudit; nothing is mocked.
import { MongoMemoryServer } from '../helpers/mongoReplSet';
import { createMocks } from 'node-mocks-http';
import type { Db, Document } from 'mongodb';
import type { NextApiHandler } from 'next';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

declare const jest: typeof import('@jest/globals').jest;

type Item = { savings_type: string; savings_amount: number; transferKey?: string };

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'slw-cf-stress-user-a';
const USER_B = 'slw-cf-stress-user-b';
const GOAL_ID = 'd0d0d0d0d0d0d0d0d0d0d0d0';
const CLEARED = ['savings', 'savingsGoals', 'savingsCarryForward', 'savingsLoans', 'savingsWithdrawals', 'audit_logs'];

let mongod: MongoMemoryServer;
let db: Db;
let savingsHandler: NextApiHandler;
let loansHandler: NextApiHandler;
let goalsHandler: NextApiHandler;
let sessionCookie: typeof import('../../src/shared/utils/backend/sessionCookie');

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';
  process.env.SESSION_SECRET = TEST_SECRET;

  jest.resetModules();
  savingsHandler = require('../../pages/api/savings').default;
  loansHandler = require('../../pages/api/savings-loans').default;
  goalsHandler = require('../../pages/api/savings-goals').default;
  sessionCookie = require('../../src/shared/utils/backend/sessionCookie');
  db = await require('../../lib/mongodb').getDbPromise();
}, 60000);

afterAll(async () => {
  if (db?.client) await db.client.close();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  for (const name of CLEARED) await db.collection(name).deleteMany({});
});

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

/** `count` consecutive months ending at `newest`, oldest first. */
function monthKeys(count: number, newest: string): string[] {
  const [y, m] = newest.split('-').map(Number);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

const matched = (amount: number): Item => ({ savings_type: 'บ้าน', savings_amount: amount });
const plain = (amount: number): Item => ({ savings_type: 'ทั่วไป', savings_amount: amount });

/** 15 months ending 2026-03; month i holds matched (i+1)*10 and plain 100.25. */
async function seed(userId = USER_A) {
  const keys = monthKeys(15, '2026-03');
  await db.collection('savings').insertMany(keys.map((month, i) => ({
    month, userId, savings_list: [matched((i + 1) * 10), plain(100.25)]
  })));
  await db.collection('savingsGoals').insertOne(
    { _id: GOAL_ID, userId, goalName: 'บ้าน', targetAmount: 999999, status: 'active', createdAt: new Date() } as unknown as Document
  );
  return keys;
}

async function balances(userId = USER_A) {
  const loans = await call(loansHandler, 'GET', undefined, userId);
  const goals = await call(goalsHandler, 'GET', undefined, userId);
  return { loans, goals };
}

async function poolAndGoal(userId = USER_A) {
  const { loans, goals } = await balances(userId);
  expect(loans.status).toBe(200);
  expect(goals.status).toBe(200);
  const goal = goals.body.goals.find((g: { _id: string }) => g._id === GOAL_ID);
  return { pool: loans.body.summary.poolBalance as number, goal: goal.currentAmount as number };
}

describe('Mongo carry-forward under concurrency (tester stress)', () => {
  it('6 concurrent new-month saves: every pruned month credited exactly once, pool and goal conserved', async () => {
    const keys = await seed();
    const before = await poolAndGoal();
    const newMonths = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];

    const results = await Promise.all(newMonths.map((month, i) =>
      call(savingsHandler, 'POST', { month, savings_list: [plain(i + 1), matched(2)] })));
    expect(results.map(r => r.status)).toEqual(newMonths.map(() => 201));

    const cf = await db.collection('savingsCarryForward').findOne({ _id: USER_A as never });
    const pruned = keys.slice(0, 6);
    expect([...(cf!.prunedMonths as string[])].sort()).toEqual(pruned);
    expect(new Set(cf!.prunedMonths as string[]).size).toBe((cf!.prunedMonths as string[]).length);
    // Pruned months 0..5 hold matched (1..6)*10 = 210 and plain 6 * 100.25 = 601.5.
    expect(cf!.poolAmount).toBeCloseTo(811.5, 2);
    expect((cf!.goalAmounts as Record<string, number>)[GOAL_ID]).toBeCloseTo(210, 2);

    const remaining = await db.collection('savings').find({ userId: USER_A }).toArray();
    expect(remaining.map(d => d.month).sort()).toEqual([...keys.slice(6), ...newMonths]);

    // Added: plain 1..6 = 21, matched 2 * 6 = 12. Nothing lost or doubled by the prunes.
    const after = await poolAndGoal();
    expect(after.pool).toBeCloseTo(before.pool + 21 + 12, 2);
    expect(after.goal).toBeCloseTo(before.goal + 12, 2);
  }, 60000);

  it('a double-submitted pruning save (same month, same body, 4 at once) credits the pruned month once', async () => {
    const keys = await seed();
    const before = await poolAndGoal();
    const body = { month: '2026-04', savings_list: [plain(50)] };

    const results = await Promise.all([1, 2, 3, 4].map(() => call(savingsHandler, 'POST', body)));
    expect(results.map(r => r.status)).toEqual([201, 201, 201, 201]);

    const docs = await db.collection('savings').find({ userId: USER_A, month: '2026-04' }).toArray();
    const cf = await db.collection('savingsCarryForward').findOne({ _id: USER_A as never });
    expect(cf!.prunedMonths).toEqual([keys[0]]);
    expect(cf!.poolAmount).toBeCloseTo(110.25, 2);

    const after = await poolAndGoal();
    // Each stored 2026-04 doc counts; with a unique month per user this is 1 doc (+50).
    expect(after.pool).toBeCloseTo(before.pool + 50 * docs.length, 2);
    expect(after.goal).toBeCloseTo(before.goal, 2);
  }, 60000);

  it('pruning saves racing balance GETs: every GET sees a committed state (no skew), never a 500 leak shape', async () => {
    await seed();
    const before = await poolAndGoal();
    const work: Array<Promise<{ status: number; body: unknown }>> = [];
    const saves = ['2026-04', '2026-05', '2026-06'].map(month =>
      call(savingsHandler, 'POST', { month, savings_list: [] }));
    for (let i = 0; i < 24; i += 1) {
      work.push(call(i % 2 ? goalsHandler : loansHandler, 'GET'));
    }
    const [saveResults, getResults] = await Promise.all([Promise.all(saves), Promise.all(work)]);
    expect(saveResults.map(r => r.status)).toEqual([201, 201, 201]);

    getResults.forEach((res, i) => {
      if (res.status === 500) {
        // Bracket exhaustion is allowed only as the generic body.
        expect(res.body).toEqual({ error: 'Internal server error' });
        return;
      }
      expect(res.status).toBe(200);
      const body = res.body as { summary?: { poolBalance: number }; goals?: Array<{ _id: string; currentAmount: number }> };
      if (i % 2) {
        expect(body.goals!.find(g => g._id === GOAL_ID)!.currentAmount).toBeCloseTo(before.goal, 2);
      } else {
        expect(body.summary!.poolBalance).toBeCloseTo(before.pool, 2);
      }
    });
    const after = await poolAndGoal();
    expect(after.pool).toBeCloseTo(before.pool, 2);
    expect(after.goal).toBeCloseTo(before.goal, 2);
  }, 60000);

  it('cross-user isolation under concurrency: B\'s saves never touch A\'s carry-forward', async () => {
    await seed(USER_A);
    await db.collection('savings').insertMany(monthKeys(15, '2026-03').map(month => ({
      month, userId: USER_B, savings_list: [plain(7)]
    })));
    const results = await Promise.all([
      call(savingsHandler, 'POST', { month: '2026-04', savings_list: [] }, USER_A),
      call(savingsHandler, 'POST', { month: '2026-04', savings_list: [] }, USER_B),
      call(savingsHandler, 'POST', { month: '2026-05', savings_list: [] }, USER_B)
    ]);
    expect(results.map(r => r.status)).toEqual([201, 201, 201]);

    const cfA = await db.collection('savingsCarryForward').findOne({ _id: USER_A as never });
    const cfB = await db.collection('savingsCarryForward').findOne({ _id: USER_B as never });
    expect(cfA!.userId).toBe(USER_A);
    expect(cfA!.poolAmount).toBeCloseTo(110.25, 2);
    expect(cfB!.userId).toBe(USER_B);
    expect(cfB!.poolAmount).toBeCloseTo(14, 2);
    expect(cfB!.goalAmounts).toEqual({});
    expect(await db.collection('savingsCarryForward').countDocuments({})).toBe(2);
  }, 60000);
});
