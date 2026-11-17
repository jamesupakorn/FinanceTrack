/** @jest-environment node */
// savings-loan-withdrawal S2c, dispatch 4: Mongo-mode pre-prune carry-forward in POST /api/savings
// (spec §5.4, §5.5, §5.8 A-1/A-2/A-5; architecture-review-s2c C-S2c-1, C-S2c-6, C-S2c-11).
// Real single-node replica set (transactions), real withAudit; nothing is mocked. The cross-check
// rollback test lives in savings-carry-forward-mongo-rollback.test.ts (it needs a module mock).
import { MongoMemoryServer } from '../helpers/mongoReplSet';
import { createMocks } from 'node-mocks-http';
import type { Db, Document } from 'mongodb';
import type { NextApiHandler } from 'next';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

declare const jest: typeof import('@jest/globals').jest;

type Row = Record<string, unknown>;
type Item = { savings_type: string; savings_amount: number; transferKey?: string; source?: string };

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'slw-cf-mongo-user-a';
const USER_B = 'slw-cf-mongo-user-b';
const GOAL_ID = 'c0c0c0c0c0c0c0c0c0c0c0c0';
const ABANDONED_GOAL_ID = 'c1c1c1c1c1c1c1c1c1c1c1c1';
const CLEARED = ['savings', 'savingsGoals', 'savingsCarryForward', 'savingsLoans', 'savingsWithdrawals', 'audit_logs'];

let mongod: MongoMemoryServer;
let db: Db;
let savingsHandler: NextApiHandler;
let loansHandler: NextApiHandler;
let sessionCookie: typeof import('../../src/shared/utils/backend/sessionCookie');
let audited: typeof import('../../lib/auditedMutation');
let auditContext: typeof import('../../lib/auditContext');
let dataSource: typeof import('../../lib/dataSource');
let carryForwardMod: typeof import('../../src/shared/utils/backend/savingsCarryForward');

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';
  process.env.SESSION_SECRET = TEST_SECRET;

  jest.resetModules();
  savingsHandler = require('../../pages/api/savings').default;
  loansHandler = require('../../pages/api/savings-loans').default;
  sessionCookie = require('../../src/shared/utils/backend/sessionCookie');
  audited = require('../../lib/auditedMutation');
  auditContext = require('../../lib/auditContext');
  dataSource = require('../../lib/dataSource');
  carryForwardMod = require('../../src/shared/utils/backend/savingsCarryForward');
  db = await require('../../lib/mongodb').getDbPromise();
}, 60000);

afterAll(async () => {
  if (db?.client) await db.client.close();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  audited.auditTestHooks.beforeAuditWrite = undefined;
  for (const name of CLEARED) await db.collection(name).deleteMany({});
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

const postSavings = (body: unknown, userId = USER_A) => call(savingsHandler, 'POST', body, userId);

async function poolBalance(userId = USER_A): Promise<number> {
  const res = await call(loansHandler, 'GET', undefined, userId);
  expect(res.status).toBe(200);
  return res.body.summary.poolBalance;
}

/** `count` consecutive months ending at `newest`, oldest first. */
function monthKeys(count: number, newest = '2026-03'): string[] {
  const [y, m] = newest.split('-').map(Number);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

async function seedSavings(userId: string, docs: Array<{ month: string; savings_list: Item[] }>) {
  await db.collection('savings').insertMany(docs.map(d => ({ ...d, userId })));
}

async function seedGoals(userId: string) {
  await db.collection('savingsGoals').insertMany([
    { _id: GOAL_ID, userId, goalName: ' เที่ยว ', targetAmount: 50000, status: 'active' },
    { _id: ABANDONED_GOAL_ID, userId, goalName: 'เที่ยว', targetAmount: 1, status: 'abandoned' }
  ] as unknown as Document[]);
}

const matched = (amount: number): Item => ({ savings_type: 'เที่ยว', savings_amount: amount });
const plain = (amount: number): Item => ({ savings_type: 'ทั่วไป', savings_amount: amount });

/**
 * 15 months 2025-01 … 2026-03. The oldest, 2025-01, holds a goal-matched 1000 and an unmatched
 * 250.5; the others hold 100 of unmatched savings each.
 */
async function seedStandard(userId = USER_A) {
  const keys = monthKeys(15);
  await seedSavings(userId, keys.map((month, i) => ({
    month,
    savings_list: i === 0 ? [matched(1000), plain(250.5)] : [plain(100)]
  })));
  await seedGoals(userId);
  return keys;
}

async function savingsMonths(userId = USER_A): Promise<string[]> {
  const docs = await db.collection('savings').find({ userId }).toArray();
  return docs.map(d => String(d.month)).sort();
}

const carryForward = (userId = USER_A) =>
  db.collection('savingsCarryForward').findOne({ _id: userId as never }) as Promise<Row | null>;

async function snapshotAll() {
  const out: Row = {};
  for (const name of ['savings', 'savingsCarryForward', 'audit_logs']) {
    out[name] = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
  }
  return out;
}

// ---- normal-save branch ----

describe('POST /api/savings (Mongo) — normal save prunes and credits in the same transaction', () => {
  it('credits the pruned month to the pool and the matching active goal (not the abandoned one)', async () => {
    const keys = await seedStandard();

    const res = await postSavings({ month: '2026-04', savings_list: [] });

    expect(res.status).toBe(201);
    expect(await savingsMonths()).toEqual([...keys.slice(1), '2026-04']);
    const cf = await carryForward();
    expect(cf).toMatchObject({
      _id: USER_A,
      userId: USER_A,
      poolAmount: 1250.5,
      goalAmounts: { [GOAL_ID]: 1000 },
      goalAudit: { [GOAL_ID]: { goalNameAtPrune: ' เที่ยว ' } },
      prunedMonths: [keys[0]]
    });
    expect(Object.keys(cf!.goalAmounts as Row)).toEqual([GOAL_ID]);
    expect(typeof cf!.updatedAt).toBe('string');
  });

  it('leaves the pool balance unchanged by the prune (AC-SLW-38, C-S2c-8)', async () => {
    await seedStandard();
    const before = await poolBalance();

    expect((await postSavings({ month: '2026-04', savings_list: [] })).status).toBe(201);

    expect(await poolBalance()).toBeCloseTo(before, 2);
  });

  it('adds to an existing carry-forward instead of replacing it', async () => {
    const keys = await seedStandard();
    await db.collection('savingsCarryForward').insertOne({
      _id: USER_A as never, userId: USER_A, poolAmount: 10.25, goalAmounts: { [GOAL_ID]: 5 },
      goalAudit: {}, prunedMonths: ['2020-01'], updatedAt: '2020-02-01T00:00:00.000Z'
    });

    expect((await postSavings({ month: '2026-04', savings_list: [] })).status).toBe(201);

    expect(await carryForward()).toMatchObject({
      poolAmount: 1260.75,
      goalAmounts: { [GOAL_ID]: 1005 },
      prunedMonths: ['2020-01', keys[0]]
    });
  });

  it('a save that prunes nothing writes no carry-forward document', async () => {
    const keys = await seedStandard();

    expect((await postSavings({ month: keys[3], savings_list: [plain(7)] })).status).toBe(201);

    expect(await carryForward()).toBeNull();
  });

  it('is user-scoped: another user\'s months and carry-forward are untouched', async () => {
    await seedStandard(USER_A);
    await seedSavings(USER_B, [{ month: '2010-01', savings_list: [plain(999)] }]);

    expect((await postSavings({ month: '2026-04', savings_list: [] })).status).toBe(201);

    expect(await savingsMonths(USER_B)).toEqual(['2010-01']);
    expect(await carryForward(USER_B)).toBeNull();
  });

  it('records exactly one savingsCarryForward audit event, source savings, field names only (C-S2c-7)', async () => {
    await seedStandard();

    expect((await postSavings({ month: '2026-04', savings_list: [] })).status).toBe(201);

    const events = await db.collection('audit_logs').find({ resource: 'savingsCarryForward' }).toArray();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ source: 'savings', action: 'created', subjectUserId: USER_A });
    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain('1250.5');
    expect(serialized).not.toContain('เที่ยว');
    expect(serialized).not.toContain(GOAL_ID);
  });
});

// ---- F-6 / C-S2c-11: own-month exclusion vs credit ----

describe('POST /api/savings (Mongo) — own month created vs pre-existing (C-S2c-11)', () => {
  /** 16 months 2024-12 … 2026-03; the oldest (M = 2024-12) holds a goal-matched 300. */
  async function seedSixteen() {
    const keys = monthKeys(16);
    await seedSavings(USER_A, keys.map((month, i) => ({ month, savings_list: i === 0 ? [matched(300)] : [plain(100)] })));
    await seedGoals(USER_A);
    return keys;
  }

  it('normal save that CREATES a month older than the window: pruned, not credited (E-SLW-32)', async () => {
    const keys = await seedStandard();

    expect((await postSavings({ month: '2020-01', savings_list: [matched(50)] })).status).toBe(201);

    expect(await savingsMonths()).toEqual(keys);
    expect(await carryForward()).toBeNull();
  });

  it('normal save that REWRITES a pre-existing pruned month M credits M with its post-write content', async () => {
    const keys = await seedSixteen();
    const before = await poolBalance();

    expect((await postSavings({ month: keys[0], savings_list: [matched(40), plain(2.5)] })).status).toBe(201);

    expect(await savingsMonths()).toEqual(keys.slice(1));
    expect(await carryForward()).toMatchObject({
      poolAmount: 42.5,
      goalAmounts: { [GOAL_ID]: 40 },
      prunedMonths: [keys[0]]
    });
    // −old(M) + new(M): 300 → 42.5
    expect(await poolBalance()).toBeCloseTo(before - 300 + 42.5, 2);
  });

  it('transfer that CREATES a month older than the window: pruned, not credited', async () => {
    const keys = await seedStandard();

    const res = await postSavings({ month: '2020-01', transfer: { amount: 25, key: 'tk-old' } });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, created: true });
    expect(await savingsMonths()).toEqual(keys);
    expect(await carryForward()).toBeNull();
  });

  it('non-idempotent transfer into pre-existing pruned month M credits M including the transfer item', async () => {
    const keys = await seedSixteen();

    const res = await postSavings({ month: keys[0], transfer: { amount: 25, key: 'tk-m' } });

    expect(res.body).toEqual({ success: true, created: true });
    expect(await savingsMonths()).toEqual(keys.slice(1));
    expect(await carryForward()).toMatchObject({
      poolAmount: 325,
      goalAmounts: { [GOAL_ID]: 300 },
      prunedMonths: [keys[0]]
    });
  });

  it('idempotent transfer into pre-existing M still prunes in Mongo and now credits M (F-9)', async () => {
    const keys = monthKeys(16);
    await seedSavings(USER_A, keys.map((month, i) => ({
      month,
      savings_list: i === 0
        ? [matched(300), { savings_type: 'เงินออมจากเงินเหลือ', savings_amount: 25, transferKey: 'tk-dup', source: 'transferable-savings' }]
        : [plain(100)]
    })));
    await seedGoals(USER_A);

    const res = await postSavings({ month: keys[0], transfer: { amount: 25, key: 'tk-dup' } });

    expect(res.body).toEqual({ success: true, created: false });
    expect(await savingsMonths()).toEqual(keys.slice(1));
    expect(await carryForward()).toMatchObject({ poolAmount: 325, prunedMonths: [keys[0]] });
  });

  it('transfer that creates month 16 credits the oldest month', async () => {
    const keys = await seedStandard();

    expect((await postSavings({ month: '2026-04', transfer: { amount: 25, key: 'tk-new' } })).status).toBe(201);

    expect(await savingsMonths()).toEqual([...keys.slice(1), '2026-04']);
    expect(await carryForward()).toMatchObject({ poolAmount: 1250.5, prunedMonths: [keys[0]] });
  });

  it('pre-existing M with two duplicate documents credits both (A-5), month listed once', async () => {
    const keys = await seedSixteen();
    await seedSavings(USER_A, [{ month: keys[0], savings_list: [matched(11)] }]);

    // Rewriting M through the upsert touches one duplicate; both are deleted, so both are credited.
    expect((await postSavings({ month: keys[0], savings_list: [plain(1)] })).status).toBe(201);

    expect(await savingsMonths()).toEqual(keys.slice(1));
    const cf = await carryForward();
    // Exactly one of the two docs was overwritten with [plain(1)]; the other keeps its original list.
    expect([1 + 11, 1 + 300]).toContain(cf!.poolAmount);
    expect(cf!.prunedMonths).toEqual([keys[0]]);
  });
});

// ---- idempotency ----

describe('POST /api/savings (Mongo) — idempotency (A-1, no $inc)', () => {
  it('repeated non-pruning saves after a prune leave the carry-forward identical', async () => {
    const keys = await seedStandard();
    expect((await postSavings({ month: '2026-04', savings_list: [] })).status).toBe(201);
    const first = await carryForward();

    expect((await postSavings({ month: '2026-04', savings_list: [plain(5)] })).status).toBe(201);
    expect((await postSavings({ month: keys[5], savings_list: [plain(6)] })).status).toBe(201);

    expect(await carryForward()).toEqual(first);
  });

  it('a month already in prunedMonths that reappears and is pruned again is not re-credited', async () => {
    const keys = await seedStandard();
    expect((await postSavings({ month: '2026-04', savings_list: [] })).status).toBe(201);
    const first = await carryForward();

    // Legacy/concurrent reappearance of the already-credited month alongside the 15 retained ones.
    await seedSavings(USER_A, [{ month: keys[0], savings_list: [plain(777)] }]);
    expect((await postSavings({ month: '2026-04', savings_list: [] })).status).toBe(201);

    expect(await savingsMonths()).not.toContain(keys[0]);
    const cf = await carryForward();
    expect(cf!.poolAmount).toBe(first!.poolAmount);
    expect(cf!.prunedMonths).toEqual([keys[0]]);
  });

  it('successive prunes each credit only their own month', async () => {
    const keys = await seedStandard();

    expect((await postSavings({ month: '2026-04', savings_list: [] })).status).toBe(201);
    expect((await postSavings({ month: '2026-05', savings_list: [] })).status).toBe(201);

    expect(await carryForward()).toMatchObject({ poolAmount: 1350.5, prunedMonths: [keys[0], keys[1]] });
  });

  it('two concurrent pruning POSTs credit each pruned month exactly once (E-SLW-37)', async () => {
    const keys = await seedStandard();

    const results = await Promise.all([
      postSavings({ month: '2026-04', savings_list: [] }),
      postSavings({ month: '2026-05', savings_list: [] })
    ]);

    expect(results.map(r => r.status)).toEqual([201, 201]);
    expect(await savingsMonths()).toEqual([...keys.slice(2), '2026-04', '2026-05']);
    const cf = await carryForward();
    expect([...(cf!.prunedMonths as string[])].sort()).toEqual([keys[0], keys[1]]);
    expect(cf!.poolAmount).toBe(1350.5);
  });
});

// ---- C-S2c-1: the preview reads through the request's session ----

describe('pruneSavingsMonthsWithCarryForward on real Mongo — session-scoped preview (C-S2c-1, §2.3 vector 1)', () => {
  /** Runs `fn` inside a manual transaction with the same ALS context withAudit builds, then aborts. */
  async function inAbortedTransaction(fn: () => Promise<void>) {
    const session = db.client.startSession();
    try {
      session.startTransaction();
      const ctx = {
        session,
        before: new Map(),
        collections: new Map(),
        subjectUserId: USER_A,
        method: 'POST',
        retention: false,
        retentionMonths: new Map(),
        sessionUserId: USER_A
      };
      await auditContext.mongoAuditStore.run(ctx, fn);
    } finally {
      if (session.inTransaction()) await session.abortTransaction();
      await session.endSession();
    }
  }

  it('the preview sees the request\'s own uncommitted month 16 and credits the month it pushes out', async () => {
    const keys = await seedStandard();
    let result: unknown;

    await inAbortedTransaction(async () => {
      const savings = await dataSource.getMongoCollection('savings');
      await savings.insertOne({ month: '2026-04', userId: USER_A, savings_list: [] });
      // Control: the write is genuinely uncommitted — a plain, session-less handle cannot see it.
      expect(await db.collection('savings').countDocuments({ userId: USER_A })).toBe(15);
      expect(await savings.countDocuments({ userId: USER_A })).toBe(16);

      result = await carryForwardMod.pruneSavingsMonthsWithCarryForward(savings, USER_A, {
        ownMonth: '2026-04',
        ownMonthCreated: true
      });

      // In-flight state, seen through the session: delete and carry-forward write both happened.
      expect(await savings.findOne({ userId: USER_A, month: keys[0] })).toBeNull();
      const cfCol = await dataSource.getMongoCollection('savingsCarryForward');
      expect(await cfCol.findOne({ _id: USER_A as never })).toMatchObject({ poolAmount: 1250.5 });
    });

    expect(result).toEqual({ prunedMonths: [keys[0]], creditedMonths: [keys[0]] });
    // Aborted: nothing leaked out of the transaction.
    expect(await savingsMonths()).toEqual(keys);
    expect(await carryForward()).toBeNull();
  });

  it('a session-less preview (vector 1) is caught by the cross-check instead of silently losing money', async () => {
    await seedStandard();

    await inAbortedTransaction(async () => {
      const sessionBound = await dataSource.getMongoCollection('savings');
      await sessionBound.insertOne({ month: '2026-04', userId: USER_A, savings_list: [] });
      const unwrapped = db.collection('savings');
      // First find (the preview) goes through a plain handle; everything else through the session.
      let finds = 0;
      const hybrid = new Proxy(sessionBound, {
        get(target, prop, receiver) {
          if (prop === 'find') {
            finds += 1;
            return finds === 1 ? unwrapped.find.bind(unwrapped) : target.find.bind(target);
          }
          return Reflect.get(target, prop, receiver);
        }
      });

      await expect(
        carryForwardMod.pruneSavingsMonthsWithCarryForward(hybrid, USER_A, { ownMonth: '2026-04', ownMonthCreated: true })
      ).rejects.toThrow(/deleted without credit preview/);
    });

    expect(await carryForward()).toBeNull();
  });
});

// ---- AC-SLW-40: atomicity through withAudit ----

describe('POST /api/savings (Mongo) — atomicity (AC-SLW-40)', () => {
  it('a failing audit write rolls back the savings write, the prune and the carry-forward write', async () => {
    await seedStandard();
    await db.collection('savingsCarryForward').insertOne({
      _id: USER_A as never, userId: USER_A, poolAmount: 1, goalAmounts: {}, goalAudit: {},
      prunedMonths: ['2020-01'], updatedAt: '2020-02-01T00:00:00.000Z'
    });
    const before = await snapshotAll();
    audited.auditTestHooks.beforeAuditWrite = () => { throw new Error('audit down'); };

    const res = await postSavings({ month: '2026-04', savings_list: [plain(9)] });

    expect(res.status).toBe(500);
    expect(await snapshotAll()).toEqual(before);
  });
});
