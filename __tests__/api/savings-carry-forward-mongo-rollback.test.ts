/** @jest-environment node */
// savings-loan-withdrawal S2c, dispatch 4: the C-S2c-1 fail-closed cross-check, end to end on a real
// replica set. Proves that when the real prune and the carry-forward preview disagree, the throw
// rolls back the WHOLE withAudit transaction: the savings write, the prune's delete and the
// carry-forward write (plus the audit events).
//
// Fault injection: `enforceMonthLimit` is wrapped (jest.doMock + requireActual) so it runs the REAL
// delete, records the in-flight state through the request's session, and then (only when armed)
// reports a `prunedMonths` set that differs from what it deleted. Everything else is real. Separate
// file so the main Mongo suite stays mock-free (same split as the JSON cross-check test).
import { MongoMemoryServer } from '../helpers/mongoReplSet';
import { createMocks } from 'node-mocks-http';
import type { Db, Document } from 'mongodb';
import type { NextApiHandler } from 'next';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

declare const jest: typeof import('@jest/globals').jest;

type Row = Record<string, unknown>;
type ApiUtils = typeof import('../../src/shared/utils/backend/apiUtils');

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'slw-cf-mongo-rollback-user';
const GOAL_ID = 'c0c0c0c0c0c0c0c0c0c0c0c0';

/** How the armed fault rewrites the real result. `null` = pass the real result through. */
let tamper: ((realPruned: string[]) => string[]) | null = null;
/** In-flight state captured inside the transaction, right after the real delete. */
let inFlight: { months: string[]; carryForward: Row | null } | null = null;

let mongod: MongoMemoryServer;
let db: Db;
let savingsHandler: NextApiHandler;
let sessionCookie: typeof import('../../src/shared/utils/backend/sessionCookie');

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';
  process.env.SESSION_SECRET = TEST_SECRET;

  jest.resetModules();
  jest.doMock('../../src/shared/utils/backend/apiUtils', () => {
    const actual = jest.requireActual<ApiUtils>('../../src/shared/utils/backend/apiUtils');
    return {
      ...actual,
      enforceMonthLimit: async (...args: Parameters<ApiUtils['enforceMonthLimit']>) => {
        const real = await actual.enforceMonthLimit(...args);
        // Read through the same session-wrapped handles the request uses (in-transaction view).
        const { getMongoCollection } = require('../../lib/dataSource') as typeof import('../../lib/dataSource');
        const savings = await getMongoCollection('savings');
        const cf = await getMongoCollection('savingsCarryForward');
        inFlight = {
          months: (await savings.find({ userId: USER_A }).toArray()).map(d => String(d.month)).sort(),
          carryForward: await cf.findOne({ _id: USER_A as never }) as Row | null
        };
        return tamper ? { ...real, prunedMonths: tamper(real.prunedMonths) } : real;
      }
    };
  });
  savingsHandler = require('../../pages/api/savings').default;
  sessionCookie = require('../../src/shared/utils/backend/sessionCookie');
  db = await require('../../lib/mongodb').getDbPromise();
}, 60000);

afterAll(async () => {
  jest.dontMock('../../src/shared/utils/backend/apiUtils');
  if (db?.client) await db.client.close();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  tamper = null;
  inFlight = null;
  for (const name of ['savings', 'savingsGoals', 'savingsCarryForward', 'audit_logs']) {
    await db.collection(name).deleteMany({});
  }
});

async function postSavings(body: unknown) {
  const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
  const sid = createSessionId();
  const { req, res } = createMocks({
    method: 'POST',
    body: body as never,
    cookies: { [SESSION_COOKIE_NAME]: signSession(USER_A, sid) },
    headers: { 'x-csrf-token': signCsrfToken(sid) }
  });
  await savingsHandler(req as never, res as never);
  return { status: res._getStatusCode(), body: JSON.parse(res._getData() || 'null') };
}

const MONTHS = Array.from({ length: 15 }, (_, i) => {
  const d = new Date(Date.UTC(2025, i, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}); // 2025-01 … 2026-03
const OLDEST = MONTHS[0];
const PRIOR_CF = {
  _id: USER_A, userId: USER_A, poolAmount: 10, goalAmounts: { [GOAL_ID]: 4 }, goalAudit: {},
  prunedMonths: ['2020-01'], updatedAt: '2020-02-01T00:00:00.000Z'
};

/** 15 months (the oldest holds a goal-matched 1000), one active goal, and a prior carry-forward. */
async function seed() {
  await db.collection('savings').insertMany(MONTHS.map((month, i) => ({
    month,
    userId: USER_A,
    savings_list: [{ savings_type: i === 0 ? 'เที่ยว' : 'ทั่วไป', savings_amount: i === 0 ? 1000 : 100 }]
  })));
  await db.collection('savingsGoals').insertOne(
    { _id: GOAL_ID, userId: USER_A, goalName: 'เที่ยว', targetAmount: 5000, status: 'active' } as unknown as Document
  );
  await db.collection('savingsCarryForward').insertOne(PRIOR_CF as unknown as Document);
}

async function snapshotAll() {
  const out: Row = {};
  for (const name of ['savings', 'savingsGoals', 'savingsCarryForward', 'audit_logs']) {
    out[name] = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
  }
  return out;
}

describe('C-S2c-1 cross-check mismatch rolls back the entire transaction (Mongo)', () => {
  it('control: unarmed, the same flow commits the savings write, the prune and the credit', async () => {
    await seed();

    const res = await postSavings({ month: '2026-04', savings_list: [] });

    expect(res.status).toBe(201);
    expect((await db.collection('savings').find({ userId: USER_A }).toArray()).map(d => d.month).sort())
      .toEqual([...MONTHS.slice(1), '2026-04']);
    expect(await db.collection('savingsCarryForward').findOne({ _id: USER_A as never })).toMatchObject({
      poolAmount: 1010, goalAmounts: { [GOAL_ID]: 1004 }, prunedMonths: ['2020-01', OLDEST]
    });
    expect(await db.collection('audit_logs').countDocuments({})).toBeGreaterThan(0);
  });

  it.each([
    ['reports fewer months than it deleted (deleted without credit)', (_real: string[]) => [] as string[]],
    ['reports a month the preview never credited', (real: string[]) => [...real, '1999-01']],
  ])('real delete %s → 500, and savings write + prune + carry-forward write are ALL rolled back', async (_label, fault) => {
    await seed();
    const before = await snapshotAll();
    tamper = fault;

    const res = await postSavings({ month: '2026-04', savings_list: [{ savings_type: 'ทั่วไป', savings_amount: 9 }] });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });

    // Inside the transaction, all three writes really happened before the cross-check threw…
    expect(inFlight).not.toBeNull();
    expect(inFlight!.months).toContain('2026-04'); // the savings write
    expect(inFlight!.months).not.toContain(OLDEST); // the prune's delete
    expect(inFlight!.carryForward).toMatchObject({ poolAmount: 1010, prunedMonths: ['2020-01', OLDEST] }); // the credit

    // …and after the throw, every one of them is undone together (plus no audit events).
    const after = await snapshotAll();
    expect(after).toEqual(before);
    const months = (after.savings as Row[]).map(d => d.month);
    expect(months).toContain(OLDEST);
    expect(months).not.toContain('2026-04');
    expect(after.savingsCarryForward).toEqual([PRIOR_CF]);
    expect(after.audit_logs).toEqual([]);
  });

  it('without a prior carry-forward, the rolled-back credit leaves no document behind', async () => {
    await seed();
    await db.collection('savingsCarryForward').deleteMany({});
    tamper = () => [];

    const res = await postSavings({ month: '2026-04', savings_list: [] });

    expect(res.status).toBe(500);
    expect(inFlight!.carryForward).toMatchObject({ poolAmount: 1000, prunedMonths: [OLDEST] });
    expect(await db.collection('savingsCarryForward').countDocuments({})).toBe(0);
    expect(await db.collection('savings').countDocuments({ userId: USER_A })).toBe(15);
    expect(await db.collection('savings').findOne({ userId: USER_A, month: '2026-04' })).toBeNull();
  });

  it('the transfer branch is covered by the same rollback', async () => {
    await seed();
    const before = await snapshotAll();
    tamper = () => [];

    const res = await postSavings({ month: '2026-04', transfer: { amount: 25, key: 'tk-rollback' } });

    expect(res.status).toBe(500);
    expect(inFlight!.months).toContain('2026-04');
    expect(inFlight!.months).not.toContain(OLDEST);
    expect(await snapshotAll()).toEqual(before);
  });
});
