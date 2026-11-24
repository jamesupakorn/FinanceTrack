/** @jest-environment node */
// loan-installments-td-cleanup D6 / I7 — concurrent upserts into one {userId, month} under the
// uniq_userId_month index (AC-TDC-28, AC-TDC-29, AC-TDC-37). Harness conventions follow
// monthly_expense_repayment_mongo.test.ts: in-process replica set, module-fresh require(), only Date faked,
// collections pre-created.
//
// Overlap is forced by holding the FIRST upsert (after its write, inside its still-open transaction) until
// the pass-through upsertMonthlyExpenseDoc wrapper sees a transient-labelled rejection — i.e. until the
// other request has definitively hit the race. The audit hook can't be used here: it only fires after a
// successful handler run, which the loser never reaches (Opus-tier architecture re-review).
import { createMocks } from 'node-mocks-http';
import type { Collection, Db } from 'mongodb';
import type { NextApiHandler } from 'next';
import { MongoMemoryServer } from '../helpers/mongoReplSet';
import {
  MONTHLY_EXPENSE_UNIQUE_INDEX_KEY,
  MONTHLY_EXPENSE_UNIQUE_INDEX_NAME,
  MONTHLY_EXPENSE_UNIQUE_INDEX_OPTIONS
} from '../../src/shared/utils/backend/monthlyExpenseIndex';

type Row = Record<string, any>;
type IndexModule = typeof import('../../src/shared/utils/backend/monthlyExpenseIndex');
type ErrorsModule = typeof import('../../src/shared/utils/backend/mongoTransactionErrors');

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'upsert-race-mongo-user-a';
const LOAN_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const CREATED_AT = '2026-10-01T03:00:00.000Z';
// Asia/Bangkok 2026-11-15 12:00 → current month 2026-11 in any server timezone.
const NOW = '2026-11-15T05:00:00.000Z';
// A month with no document at the start of every case.
const MONTH = '2026-10';
const SLR_KEY_RE = /^slr_[0-9a-f]{24}$/;
const HOLD_SAFETY_TIMEOUT_MS = 5000;
const RACE_TEST_TIMEOUT_MS = 30000;
// Pre-created so implicit collection creation inside concurrent transactions can't add its own conflict.
const COLLECTIONS = [
  'monthly_expense', 'monthly_income', 'salary', 'investment',
  'savingsLoans', 'savingsWithdrawals', 'savingsGoals', 'savingsLedgerGuards', 'audit_logs', 'users'
];

const FAKE_DATE_ONLY = {
  doNotFake: [
    'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
    'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval',
    'clearInterval', 'setTimeout', 'clearTimeout'
  ]
} as const;

const ordinaryRow = (name: string): Row => ({ name, actual: 50, account: 'กรุงศรี', paid: false, dueDay: 'EOM' });
const loan = (): Row => ({
  _id: LOAN_ID,
  userId: USER_A,
  source: { type: 'pool' },
  principalAmount: 3000,
  outstandingAmount: 3000,
  status: 'open',
  note: null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  closedAt: null,
  repayments: []
});

/**
 * Shared state of the pass-through upsertMonthlyExpenseDoc wrapper. Reset before every case.
 * `holdFirst` is armed only by race cases; the first call then waits (with its write staged) until
 * `releaseHold` fires on the first transient rejection, or the safety timeout elapses.
 */
const upsertProbe: {
  calls: number;
  transientRejections: number;
  holdFirst: boolean;
  safetyTimeoutFired: boolean;
  releaseHold: () => void;
  released: Promise<void>;
} = {
  calls: 0,
  transientRejections: 0,
  holdFirst: false,
  safetyTimeoutFired: false,
  releaseHold: () => {},
  released: Promise.resolve()
};

function resetUpsertProbe() {
  upsertProbe.calls = 0;
  upsertProbe.transientRejections = 0;
  upsertProbe.holdFirst = false;
  upsertProbe.safetyTimeoutFired = false;
  upsertProbe.released = new Promise<void>(resolve => { upsertProbe.releaseHold = resolve; });
}

async function holdUntilLoserHitsTheRace() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const safety = new Promise<void>(resolve => {
    timer = setTimeout(() => {
      // Not a success path: the R1 assertions below fail if the release never came from a real race.
      upsertProbe.safetyTimeoutFired = true;
      resolve();
    }, HOLD_SAFETY_TIMEOUT_MS);
  });
  await Promise.race([upsertProbe.released, safety]);
  clearTimeout(timer);
}

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';
  process.env.SESSION_SECRET = TEST_SECRET;
  delete process.env.AUDIT_DATA_DIR;
}, 60000);

afterAll(async () => {
  if (mongod) await mongod.stop();
});

describe('monthly_expense upserts under uniq_userId_month (mongo mode)', () => {
  const state: {
    handler?: NextApiHandler;
    sessionCookie?: any;
    db?: Db;
    CollectionClass?: typeof Collection;
  } = {};

  beforeAll(async () => {
    jest.resetModules();
    // R1: pass-through wrapper around the REAL upsertMonthlyExpenseDoc. Both monthly_expense.ts and
    // savingsLoanSync.ts import this module, so every upsert path is observed.
    jest.doMock('../../src/shared/utils/backend/monthlyExpenseIndex', () => {
      const actual: IndexModule = jest.requireActual('../../src/shared/utils/backend/monthlyExpenseIndex');
      const errors: ErrorsModule = jest.requireActual('../../src/shared/utils/backend/mongoTransactionErrors');
      return {
        ...actual,
        upsertMonthlyExpenseDoc: async (...args: Parameters<IndexModule['upsertMonthlyExpenseDoc']>) => {
          upsertProbe.calls += 1;
          const isFirst = upsertProbe.calls === 1;
          try {
            await actual.upsertMonthlyExpenseDoc(...args);
          } catch (error) {
            if (errors.isTransientTransactionError(error)) {
              upsertProbe.transientRejections += 1;
              upsertProbe.releaseHold();
            }
            throw error;
          }
          // R2: keep the winner's transaction open, write staged, until the loser has hit the race.
          if (isFirst && upsertProbe.holdFirst) await holdUntilLoserHitsTheRace();
        }
      };
    });
    state.handler = require('../../pages/api/monthly_expense').default;
    state.sessionCookie = require('../../src/shared/utils/backend/sessionCookie');
    state.db = await require('../../lib/mongodb').getDbPromise();
    // R3: the driver copy loaded by this fresh registry — the one the route's collections use.
    state.CollectionClass = require('mongodb').Collection;
    const existing = new Set((await state.db!.listCollections().toArray()).map(c => c.name));
    for (const name of COLLECTIONS) {
      if (!existing.has(name)) await state.db!.createCollection(name);
    }
    // E-TDC-13: this file is the only suite that creates the index, from the shared definition.
    await state.db!.collection('monthly_expense').createIndex(
      { ...MONTHLY_EXPENSE_UNIQUE_INDEX_KEY },
      {
        ...MONTHLY_EXPENSE_UNIQUE_INDEX_OPTIONS,
        partialFilterExpression: { ...MONTHLY_EXPENSE_UNIQUE_INDEX_OPTIONS.partialFilterExpression }
      }
    );
  }, 60000);

  afterAll(async () => {
    jest.dontMock('../../src/shared/utils/backend/monthlyExpenseIndex');
    if (state.db?.client) await state.db.client.close();
  });

  beforeEach(async () => {
    resetUpsertProbe();
    for (const name of COLLECTIONS) await state.db!.collection(name).deleteMany({});
    jest.useFakeTimers({ ...FAKE_DATE_ONLY, now: new Date(NOW) } as any);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const db = () => state.db!;

  async function call(method: 'POST' | 'PATCH', body: unknown) {
    const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = state.sessionCookie;
    const sid = createSessionId();
    const { req, res } = createMocks({
      method,
      body: body as any,
      cookies: { [SESSION_COOKIE_NAME]: signSession(USER_A, sid) },
      headers: { 'x-csrf-token': signCsrfToken(sid) }
    } as any);
    await state.handler!(req as any, res as any);
    const raw = res._getData();
    return { status: res._getStatusCode(), json: raw ? JSON.parse(raw) : null };
  }

  const ordinaryPost = (key: string) => call('POST', { month: MONTH, expense_data: { [key]: ordinaryRow(key) } });
  const initPatch = (key: string) => call('PATCH', {
    month: MONTH,
    key,
    paid: true,
    row: { name: key, actual: 75, account: 'กรุงศรี', dueDay: 'EOM' }
  });
  const repaymentPost = () => call('POST', { month: MONTH, repayment: { loanId: LOAN_ID, amount: 100 } });

  const monthDocs = () => db().collection('monthly_expense').find({ userId: USER_A, month: MONTH }).toArray();

  /** R1: a real retry happened — the winner, the loser's failed attempt and the loser's successful retry. */
  function expectRealRetry() {
    expect(upsertProbe.safetyTimeoutFired).toBe(false);
    expect(upsertProbe.transientRejections).toBeGreaterThanOrEqual(1);
    expect(upsertProbe.calls).toBeGreaterThanOrEqual(3);
  }

  it('the index under test exists with the shared definition', async () => {
    const indexes = await db().collection('monthly_expense').listIndexes().toArray();
    const index = indexes.find(i => i.name === MONTHLY_EXPENSE_UNIQUE_INDEX_NAME);
    expect(index).toMatchObject({
      key: MONTHLY_EXPENSE_UNIQUE_INDEX_KEY,
      unique: true,
      partialFilterExpression: MONTHLY_EXPENSE_UNIQUE_INDEX_OPTIONS.partialFilterExpression
    });
  });

  it('AC-TDC-28: two concurrent ordinary POSTs into a new month → both 200, one doc with both keys', async () => {
    upsertProbe.holdFirst = true;

    const results = await Promise.all([ordinaryPost('coffee'), ordinaryPost('tea')]);

    expect(results).toEqual([
      { status: 200, json: { success: true } },
      { status: 200, json: { success: true } }
    ]);
    expectRealRetry();
    const docs = await monthDocs();
    expect(docs).toHaveLength(1);
    expect(docs[0].coffee).toEqual(ordinaryRow('coffee'));
    expect(docs[0].tea).toEqual(ordinaryRow('tea'));
  }, RACE_TEST_TIMEOUT_MS);

  it('AC-TDC-29: POST vs PATCH-init race → both 200, one doc with both rows', async () => {
    upsertProbe.holdFirst = true;

    const [postResult, patchResult] = await Promise.all([ordinaryPost('coffee'), initPatch('snack')]);

    expect(postResult).toEqual({ status: 200, json: { success: true } });
    expect(patchResult).toEqual({ status: 200, json: { success: true, paid: true, initialized: true } });
    expectRealRetry();
    const docs = await monthDocs();
    expect(docs).toHaveLength(1);
    expect(docs[0].coffee).toEqual(ordinaryRow('coffee'));
    expect(docs[0].snack).toEqual({ name: 'snack', actual: 75, account: 'กรุงศรี', dueDay: 'EOM', paid: true });
  }, RACE_TEST_TIMEOUT_MS);

  it('AC-TDC-29: repayment POST vs ordinary POST race → 201 + 200, one doc with the slr_ row and the ordinary key', async () => {
    await db().collection('savingsLoans').insertOne(loan() as any);
    upsertProbe.holdFirst = true;

    const [repayResult, postResult] = await Promise.all([repaymentPost(), ordinaryPost('coffee')]);

    expect(repayResult.status).toBe(201);
    expect(repayResult.json.rowKey).toMatch(SLR_KEY_RE);
    expect(postResult).toEqual({ status: 200, json: { success: true } });
    expectRealRetry();
    const docs = await monthDocs();
    expect(docs).toHaveLength(1);
    expect(docs[0].coffee).toEqual(ordinaryRow('coffee'));
    expect(docs[0][repayResult.json.rowKey]).toMatchObject({ actual: 100, paid: true });
    expect(Object.keys(docs[0]).filter(key => SLR_KEY_RE.test(key))).toEqual([repayResult.json.rowKey]);
  }, RACE_TEST_TIMEOUT_MS);

  it('AC-TDC-37: a non-transient upsert failure → 500 with the route body, no retry, nothing written', async () => {
    // For an ordinary POST without cci_/ccr_ keys, applyCreditCardPaidFromExpensePayload returns before any
    // write and the audit snapshot uses find(), so the upsert is the first updateOne of the request.
    const spy = jest.spyOn(state.CollectionClass!.prototype, 'updateOne').mockRejectedValueOnce(new Error('boom'));

    const result = await ordinaryPost('coffee');

    expect(result).toEqual({ status: 500, json: { error: 'Failed to write monthly expense data' } });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(upsertProbe.calls).toBe(1);
    expect(upsertProbe.transientRejections).toBe(0);
    expect(await db().collection('monthly_expense').find({}).toArray()).toEqual([]);
    expect(await db().collection('audit_logs').find({}).toArray()).toEqual([]);
  });
});
