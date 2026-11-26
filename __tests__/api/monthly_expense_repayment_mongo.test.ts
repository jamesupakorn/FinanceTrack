/** @jest-environment node */
// savings-loan-withdrawal S3 / d6 — POST /api/monthly_expense { month, repayment } in Mongo mode.
// Mirrors monthly_expense_repayment_json.test.ts (d5) against an in-process replica set, so withAudit runs a
// real session.withTransaction (ADR-029). spec §4.9/§4.10, AC-SLW-16…19; architecture-review C-S3-1, C-S3-4,
// C-S3-5, C-S3-6, C-S3-12…C-S3-15. Only Date is faked (timers stay real, so the driver is unaffected).
//
// Block 1 is a plain route integration test (no mocks). Block 2 wraps two store collaborators
// (loadLedgerContext / replaceLoan) with pass-through spies — never the DB (CODING_STANDARD:116-119) — to
// count transaction attempts and to inject a concurrent loan deletion / a failure at the exact step.
import { createMocks } from 'node-mocks-http';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { NextApiHandler } from 'next';
import { MongoMemoryServer } from '../helpers/mongoReplSet';

type Row = Record<string, any>;

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'slr-repay-mongo-user-a';
const USER_B = 'slr-repay-mongo-user-b';
const LOAN_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const GOAL_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const CREATED_AT = '2026-10-01T03:00:00.000Z';
// Asia/Bangkok 2026-11-15 12:00 → current month 2026-11, day 15 in any server timezone.
const NOW = '2026-11-15T05:00:00.000Z';
const SLR_KEY_RE = /^slr_[0-9a-f]{24}$/;
const LEGACY_ERROR = 'Legacy expense document cannot be updated per row';
// Pre-created so implicit collection creation inside concurrent transactions can't add its own conflict.
const COLLECTIONS = [
  'monthly_expense', 'monthly_income', 'salary', 'investment',
  'savingsLoans', 'savingsWithdrawals', 'savingsGoals', 'savingsLedgerGuards', 'audit_logs', 'users'
];
const SNAPSHOT_COLLECTIONS = ['monthly_expense', 'savingsLoans', 'audit_logs'];

const FAKE_DATE_ONLY = {
  doNotFake: [
    'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
    'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval',
    'clearInterval', 'setTimeout', 'clearTimeout'
  ]
} as const;

const loan = (extra: Row = {}): Row => ({
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
  repayments: [],
  ...extra
});
const ordinaryRow = (extra: Row = {}): Row => ({ name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false, dueDay: 'EOM', ...extra });
const repay = (month: string, repayment: Row) => ({ month, repayment: { loanId: LOAN_ID, ...repayment } });
const slrKeysOf = (doc: Row | null | undefined) => Object.keys(doc ?? {}).filter(key => SLR_KEY_RE.test(key));

function setNow(iso: string) {
  jest.useFakeTimers({ ...FAKE_DATE_ONLY, now: new Date(iso) } as any);
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

/**
 * Loads the route in a fresh module registry (its own Mongo client) and exposes seed/read helpers over a
 * plain, session-less handle — reads here see committed data only.
 */
function useMongoRoute(beforeLoad: () => void = () => {}) {
  const state: { handler?: NextApiHandler; sessionCookie?: any; audited?: any; db?: Db } = {};

  beforeAll(async () => {
    jest.resetModules();
    beforeLoad();
    state.handler = require('../../pages/api/monthly_expense').default;
    state.sessionCookie = require('../../src/shared/utils/backend/sessionCookie');
    state.audited = require('../../lib/auditedMutation');
    state.db = await require('../../lib/mongodb').getDbPromise();
    const existing = new Set((await state.db!.listCollections().toArray()).map(c => c.name));
    for (const name of COLLECTIONS) {
      if (!existing.has(name)) await state.db!.createCollection(name);
    }
  });

  afterAll(async () => {
    if (state.db?.client) await state.db.client.close();
  });

  beforeEach(async () => {
    state.audited.auditTestHooks.beforeAuditWrite = undefined;
    for (const name of COLLECTIONS) await state.db!.collection(name).deleteMany({});
    setNow(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const db = () => state.db!;

  async function post(body: unknown, userId = USER_A) {
    const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = state.sessionCookie;
    const sid = createSessionId();
    const { req, res } = createMocks({
      method: 'POST',
      body: body as any,
      cookies: { [SESSION_COOKIE_NAME]: signSession(userId, sid) },
      headers: { 'x-csrf-token': signCsrfToken(sid) }
    } as any);
    await state.handler!(req as any, res as any);
    const raw = res._getData();
    return { status: res._getStatusCode(), json: raw ? JSON.parse(raw) : null };
  }

  return {
    db,
    post,
    holdCommitsUntilBothArrive(timeoutMs = 300) {
      // Hold each committing transaction (after its writes, before commit) so two requests are forced to
      // overlap — same technique as savingsLoansRouteSuite's AC-SLW-08 concurrency case.
      let arrived = 0;
      let release!: () => void;
      const both = new Promise<void>(resolve => { release = resolve; });
      state.audited.auditTestHooks.beforeAuditWrite = async () => {
        arrived += 1;
        if (arrived >= 2) release();
        await Promise.race([both, new Promise(resolve => setTimeout(resolve, timeoutMs))]);
      };
    },
    seedLoans: async (loans: Row[]) => { if (loans.length) await db().collection('savingsLoans').insertMany(loans as any); },
    seedGoals: async (goals: Row[]) => {
      // Production Mongo goals carry ObjectId ids; the store stringifies them.
      await db().collection('savingsGoals').insertMany(goals.map(g => ({ ...g, userId: USER_A, _id: new ObjectId(String(g._id)) })));
    },
    seedExpenseMonths: async (months: Record<string, Row>, userId = USER_A) => {
      const docs = Object.entries(months).map(([month, doc]) => ({ ...doc, month, userId }));
      if (docs.length) await db().collection('monthly_expense').insertMany(docs);
    },
    readLoan: async (): Promise<Row | null> => db().collection('savingsLoans').findOne({ _id: LOAN_ID as any, userId: USER_A }),
    readMonth: async (month: string): Promise<Row | null> => db().collection('monthly_expense').findOne({ month, userId: USER_A }),
    expenseMonths: async (): Promise<string[]> =>
      (await db().collection('monthly_expense').find({ userId: USER_A }).toArray()).map(d => d.month).sort(),
    auditEvents: async (): Promise<Row[]> => db().collection('audit_logs').find({}).toArray(),
    /** Every persisted document the repayment could touch, for "nothing was written" assertions. */
    async snapshot() {
      const result: Record<string, unknown> = {};
      for (const name of SNAPSHOT_COLLECTIONS) {
        result[name] = await db().collection(name).find({}).sort({ _id: 1 }).toArray();
      }
      return result;
    }
  };
}

// ---------------------------------------------------------------------------
// Block 1 — plain route integration (no mocks)
// ---------------------------------------------------------------------------

describe('POST /api/monthly_expense repayment (mongo mode)', () => {
  const route = useMongoRoute();
  const { post } = route;

  it('AC-SLW-16: writes the slr_ row and appends the repayment in one transaction (pool loan, current month)', async () => {
    await route.seedLoans([loan()]);
    await route.seedExpenseMonths({ '2026-11': { coffee: ordinaryRow() } });

    const result = await post(repay('2026-11', { amount: '1,200.50', account: '  กรุงศรี  ' }));

    expect(result.status).toBe(201);
    const { rowKey, repayment } = result.json;
    expect(rowKey).toMatch(SLR_KEY_RE);
    expect(result.json).toEqual({
      success: true,
      repayment: { _id: rowKey.slice(4), amount: 1200.5, expenseMonth: '2026-11', expenseRowKey: rowKey, createdAt: NOW },
      appliedAmount: 1200.5,
      outstandingAmount: 1799.5,
      status: 'open',
      rowKey
    });

    // D-SLW-13/23: exactly the 5 standard fields, written into the existing document.
    const month = await route.readMonth('2026-11');
    expect(month?.[rowKey]).toEqual({ name: 'คืนเงินกู้ · ยอดกลาง', actual: 1200.5, account: 'กรุงศรี', paid: true, dueDay: 15 });
    expect(month?.coffee).toEqual(ordinaryRow());
    expect(await route.expenseMonths()).toEqual(['2026-11']);

    expect(await route.readLoan()).toEqual(loan({ outstandingAmount: 1799.5, updatedAt: NOW, repayments: [repayment] }));

    // Both writes committed together under one audited transaction.
    const resources = (await route.auditEvents()).map(e => `${e.source}:${e.resource}:${e.action}`).sort();
    expect(resources).toEqual(['monthly_expense:monthly_expense:updated', 'monthly_expense:savingsLoans:updated']);
  });

  it('upserts the month document when it does not exist yet', async () => {
    await route.seedLoans([loan()]);

    const result = await post(repay('2026-10', { amount: 100, account: 'ttb' }));

    expect(result.status).toBe(201);
    const month = await route.readMonth('2026-10');
    // The route's driver lives in another module registry, so its ObjectId class differs from ours.
    expect(String(month?._id)).toMatch(/^[0-9a-f]{24}$/);
    expect(month).toEqual({
      _id: expect.anything(),
      month: '2026-10',
      userId: USER_A,
      [result.json.rowKey]: { name: 'คืนเงินกู้ · ยอดกลาง', actual: 100, account: 'ttb', paid: true, dueDay: 'EOM' }
    });
  });

  it('AC-SLW-18: clamps to outstanding, closes the loan, labels a goal loan and defaults the account', async () => {
    const longName = 'ท'.repeat(130);
    await route.seedGoals([{ _id: GOAL_ID, goalName: longName, targetAmount: 10000, status: 'active' }]);
    const earlier = { _id: 'c'.repeat(24), amount: 2500, expenseMonth: '2026-10', expenseRowKey: `slr_${'c'.repeat(24)}`, createdAt: CREATED_AT };
    await route.seedLoans([loan({ source: { type: 'goal', goalId: GOAL_ID }, outstandingAmount: 500, repayments: [earlier] })]);

    const result = await post(repay('2026-09', { amount: 9999 }));

    expect(result.status).toBe(201);
    expect(result.json).toMatchObject({ appliedAmount: 500, outstandingAmount: 0, status: 'closed' });
    const row = (await route.readMonth('2026-09'))?.[result.json.rowKey];
    expect(row).toEqual({ name: `คืนเงินกู้ · เป้าหมาย ${'ท'.repeat(100)}`, actual: 500, account: 'ไม่ระบุบัญชี', paid: true, dueDay: 'EOM' });

    const stored = await route.readLoan();
    expect(stored).toMatchObject({ outstandingAmount: 0, status: 'closed', closedAt: NOW, updatedAt: NOW });
    expect(stored?.repayments).toEqual([earlier, result.json.repayment]);
    expect(result.json.repayment.amount).toBe(row.actual);
  });

  it('uses the bare goal label when the goal is abandoned (E-SLW-16)', async () => {
    await route.seedGoals([{ _id: GOAL_ID, goalName: 'ทริป', targetAmount: 1, status: 'abandoned' }]);
    await route.seedLoans([loan({ source: { type: 'goal', goalId: GOAL_ID } })]);

    const result = await post(repay('2026-11', { amount: 10 }));

    expect(result.status).toBe(201);
    expect((await route.readMonth('2026-11'))?.[result.json.rowKey].name).toBe('คืนเงินกู้ · เป้าหมาย');
  });

  it('409 loan_closed writes nothing', async () => {
    await route.seedLoans([loan({ outstandingAmount: 0, status: 'closed', closedAt: CREATED_AT })]);
    await route.seedExpenseMonths({ '2026-11': { coffee: ordinaryRow() } });
    const before = await route.snapshot();

    expect(await post(repay('2026-11', { amount: 10 }))).toEqual({ status: 409, json: { error: 'loan_closed' } });
    expect(await route.snapshot()).toEqual(before);
  });

  it('409 repayment_limit (361st) writes nothing', async () => {
    const repayments = Array.from({ length: 360 }, (_, i) => {
      const id = i.toString(16).padStart(24, '0');
      return { _id: id, amount: 1, expenseMonth: '2026-10', expenseRowKey: `slr_${id}`, createdAt: CREATED_AT };
    });
    await route.seedLoans([loan({ outstandingAmount: 100, repayments })]);
    const before = await route.snapshot();

    expect(await post(repay('2026-11', { amount: 10 }))).toEqual({ status: 409, json: { error: 'repayment_limit' } });
    expect(await route.snapshot()).toEqual(before);
  });

  it('404 loan_not_found for another user\'s loan and for an unknown id, writing nothing', async () => {
    await route.seedLoans([loan({ userId: USER_B })]);
    const before = await route.snapshot();

    const crossUser = await post(repay('2026-11', { amount: 10 }));
    const unknown = await post({ month: '2026-11', repayment: { loanId: 'd'.repeat(24), amount: 10 } });

    expect(crossUser).toEqual({ status: 404, json: { error: 'loan_not_found' } });
    expect(unknown).toEqual({ status: 404, json: { error: 'loan_not_found' } });
    expect(await route.snapshot()).toEqual(before);
  });

  it('C-S3-15: a legacy month document returns the existing 409 string and writes nothing', async () => {
    await route.seedLoans([loan()]);
    await route.seedExpenseMonths({ '2026-11': { actual: { rent: 5000 } } });
    const before = await route.snapshot();

    expect(await post(repay('2026-11', { amount: 10 }))).toEqual({ status: 409, json: { error: LEGACY_ERROR } });
    expect(await route.snapshot()).toEqual(before);
  });

  it('the legacy check reads only the caller\'s month document', async () => {
    await route.seedLoans([loan()]);
    await route.seedExpenseMonths({ '2026-11': { actual: { rent: 5000 } } }, USER_B);

    const result = await post(repay('2026-11', { amount: 10 }));

    expect(result.status).toBe(201);
    expect(slrKeysOf(await route.readMonth('2026-11'))).toEqual([result.json.rowKey]);
  });

  it.each([
    ['month too old', repay('2025-08', { amount: 10 }), { error: 'month_out_of_range' }],
    ['future month', repay('2026-12', { amount: 10 }), { error: 'month_out_of_range' }],
    ['amount 0', repay('2026-11', { amount: 0 }), { error: 'invalid_amount' }],
    ['amount 0.004', repay('2026-11', { amount: '0.004' }), { error: 'invalid_amount' }]
  ])('400 for %s, writing nothing (was a 500 before d6)', async (_label, body, expected) => {
    await route.seedLoans([loan()]);
    const before = await route.snapshot();

    expect(await post(body)).toEqual({ status: 400, json: expected });
    expect(await route.snapshot()).toEqual(before);
  });

  it.each([
    ['an operator object as loanId', { month: '2026-11', repayment: { loanId: { $ne: null }, amount: 10 } }],
    ['expense_data next to repayment', { month: '2026-11', repayment: { loanId: LOAN_ID, amount: 10 }, expense_data: {} }]
  ])('400 Zod validation for %s (E-SLW-18)', async (_label, body) => {
    await route.seedLoans([loan()]);
    const before = await route.snapshot();

    const result = await post(body);

    expect(result.status).toBe(400);
    expect(result.json.error).toBe('Validation failed');
    expect(await route.snapshot()).toEqual(before);
  });

  it('C-S3-14: a repayment whose month is pruned by the same request still succeeds', async () => {
    await route.seedLoans([loan()]);
    // 2025-10 … 2026-12 = 15 real months (2026-12 is current+1, never skipped); the repayment month 2025-09 is the 16th.
    const months: Record<string, Row> = {};
    for (let i = 0; i < 15; i += 1) {
      const key = new Date(Date.UTC(2025, 9 + i, 1)).toISOString().slice(0, 7);
      months[key] = { coffee: ordinaryRow() };
    }
    await route.seedExpenseMonths(months);

    const result = await post(repay('2025-09', { amount: 400 }));

    expect(result.status).toBe(201);
    expect(result.json).toMatchObject({ appliedAmount: 400, outstandingAmount: 2600 });
    // The loan keeps the repayment; only the visual row went with its month (E-SLW-23 / KL-3).
    expect(await route.readLoan()).toMatchObject({ outstandingAmount: 2600, repayments: [result.json.repayment] });
    expect(await route.readMonth('2025-09')).toBeNull();
    expect(await route.expenseMonths()).toEqual(Object.keys(months).sort());
  });

  describe('C-S3-13 Asia/Bangkok boundary', () => {
    // 2026-12-01 00:30 in Bangkok is still 2026-11-30 in UTC.
    const BOUNDARY = '2026-12-01T00:30:00+07:00';

    it('accepts the Bangkok current month and uses its day as dueDay', async () => {
      setNow(BOUNDARY);
      await route.seedLoans([loan()]);

      const result = await post(repay('2026-12', { amount: 10 }));

      expect(result.status).toBe(201);
      expect((await route.readMonth('2026-12'))?.[result.json.rowKey].dueDay).toBe(1);
      expect(result.json.repayment.createdAt).toBe(new Date(BOUNDARY).toISOString());
    });

    it('treats the UTC month as a past month (dueDay EOM) and the next Bangkok month as future', async () => {
      setNow(BOUNDARY);
      await route.seedLoans([loan()]);

      const previous = await post(repay('2026-11', { amount: 10 }));
      const future = await post(repay('2027-01', { amount: 10 }));

      expect(previous.status).toBe(201);
      expect((await route.readMonth('2026-11'))?.[previous.json.rowKey].dueDay).toBe('EOM');
      expect(future).toEqual({ status: 400, json: { error: 'month_out_of_range' } });
    });

    it('lower bound follows the Bangkok month too (current − 14)', async () => {
      setNow(BOUNDARY);
      await route.seedLoans([loan()]);

      expect((await post(repay('2025-10', { amount: 10 }))).status).toBe(201);
      expect(await post(repay('2025-09', { amount: 10 }))).toEqual({ status: 400, json: { error: 'month_out_of_range' } });
    });
  });

  it('a body without `repayment` still takes the normal save path (AC-SLW-20)', async () => {
    await route.seedLoans([loan()]);

    const result = await post({ month: '2026-11', expense_data: { coffee: ordinaryRow() } });

    expect(result).toEqual({ status: 200, json: { success: true } });
    expect((await route.readMonth('2026-11'))?.coffee).toEqual(ordinaryRow());
    expect(await route.readLoan()).toEqual(loan());
  });
});

// ---------------------------------------------------------------------------
// Block 2 — instrumented store collaborators (pass-through by default)
// ---------------------------------------------------------------------------

type StoreModule = typeof import('../../src/shared/utils/backend/savingsLedgerStore');

const mockStore: {
  loadCalls: number;
  replaceCalls: number;
  /** Runs inside the request's transaction, just before the real replaceLoan; may replace its result. */
  beforeReplace?: (userId: string, attempt: number) => Promise<'false' | 'throw' | void>;
} = { loadCalls: 0, replaceCalls: 0 };

describe('POST /api/monthly_expense repayment (mongo mode) — rollback and concurrency', () => {
  const route = useMongoRoute(() => {
    jest.doMock('../../src/shared/utils/backend/savingsLedgerStore', () => {
      const actual: StoreModule = jest.requireActual('../../src/shared/utils/backend/savingsLedgerStore');
      return {
        ...actual,
        loadLedgerContext: async (...args: Parameters<StoreModule['loadLedgerContext']>) => {
          mockStore.loadCalls += 1;
          return actual.loadLedgerContext(...args);
        },
        replaceLoan: async (...args: Parameters<StoreModule['replaceLoan']>) => {
          mockStore.replaceCalls += 1;
          const outcome = await mockStore.beforeReplace?.(String(args[0]), mockStore.replaceCalls);
          if (outcome === 'throw') throw new Error('simulated replaceLoan failure');
          if (outcome === 'false') return false;
          return actual.replaceLoan(...args);
        }
      };
    });
  });
  const { post } = route;

  afterAll(() => {
    jest.dontMock('../../src/shared/utils/backend/savingsLedgerStore');
  });

  beforeEach(() => {
    mockStore.loadCalls = 0;
    mockStore.replaceCalls = 0;
    mockStore.beforeReplace = undefined;
  });

  /**
   * Proves the row write already happened inside the transaction when replaceLoan runs (C-S3-5 order), and
   * that it is not visible outside it (uncommitted). Uses the session-bound handle the route itself uses.
   */
  async function stagedVsCommittedRowKeys(userId: string, month: string) {
    const { getMongoCollection } = require('../../lib/dataSource');
    const inTxn = await (await getMongoCollection('monthly_expense')).findOne({ month, userId });
    const committed = await route.db().collection('monthly_expense').findOne({ month, userId });
    return { staged: slrKeysOf(inTxn), committed: slrKeysOf(committed) };
  }

  it.each([
    ['returns false', 'false' as const, { status: 404, json: { error: 'loan_not_found' } }],
    ['throws (AC-SLW-17)', 'throw' as const, { status: 500, json: { error: 'Internal server error' } }]
  ])('C-S3-4: replaceLoan %s → the already-written row is rolled back with the transaction', async (_label, outcome, expected) => {
    await route.seedLoans([loan()]);
    await route.seedExpenseMonths({ '2026-11': { coffee: ordinaryRow() } });
    const before = await route.snapshot();
    const observed: Array<{ staged: string[]; committed: string[] }> = [];
    mockStore.beforeReplace = async userId => {
      observed.push(await stagedVsCommittedRowKeys(userId, '2026-11'));
      return outcome;
    };
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await post(repay('2026-11', { amount: 10 }));
    errorSpy.mockRestore();

    expect(result).toEqual(expected);
    // The row was really written in the transaction (not merely skipped) …
    expect(observed).toHaveLength(1);
    expect(observed[0].staged).toHaveLength(1);
    expect(observed[0].committed).toEqual([]);
    // … and did not survive: month doc, loan and audit log are byte-identical, no slr_ row anywhere.
    expect(await route.snapshot()).toEqual(before);
    expect(slrKeysOf(await route.readMonth('2026-11'))).toEqual([]);
  });

  it('C-S3-4 real race: the loan is deleted by another writer mid-transaction → WriteConflict, retry, 404, row rolled back', async () => {
    await route.seedLoans([loan()]);
    await route.seedExpenseMonths({ '2026-11': { coffee: ordinaryRow() } });
    const observed: Array<{ staged: string[]; committed: string[] }> = [];
    mockStore.beforeReplace = async (userId, attempt) => {
      if (attempt !== 1) return;
      observed.push(await stagedVsCommittedRowKeys(userId, '2026-11'));
      // A concurrent, already-committed delete (session-less handle = its own implicit transaction),
      // landing after this transaction's snapshot and before its loan write.
      const deleted = await route.db().collection('savingsLoans').deleteOne({ _id: LOAN_ID as any, userId });
      expect(deleted.deletedCount).toBe(1);
    };
    const monthBefore = await route.readMonth('2026-11');

    const result = await post(repay('2026-11', { amount: 10 }));

    // Never a silent 500: the WriteConflict reached withTransaction, which re-ran the whole handler.
    expect(result).toEqual({ status: 404, json: { error: 'loan_not_found' } });
    expect(mockStore.loadCalls).toBe(2);
    expect(mockStore.replaceCalls).toBe(1);
    expect(observed[0].staged).toHaveLength(1);
    // The first attempt's row write did not survive.
    expect(await route.readMonth('2026-11')).toEqual(monthBefore);
    expect(await route.readLoan()).toBeNull();
    expect(await route.auditEvents()).toEqual([]);
  });

  it('C-S3-12: two concurrent repayments on one loan → 201 + clamped 201, both rows kept, outstanding correct', async () => {
    await route.seedLoans([loan({ principalAmount: 1000, outstandingAmount: 1000 })]);
    await route.seedExpenseMonths({ '2026-11': { coffee: ordinaryRow() } });
    route.holdCommitsUntilBothArrive();

    const results = await Promise.all([
      post(repay('2026-11', { amount: 700 })),
      post(repay('2026-11', { amount: 700 }))
    ]);

    expect(results.map(r => r.status)).toEqual([201, 201]);
    expect(results.map(r => r.json.appliedAmount).sort((a, b) => a - b)).toEqual([300, 700]);
    expect(results.map(r => r.json.outstandingAmount).sort((a, b) => a - b)).toEqual([0, 300]);
    // The loser saw the conflict and was re-run against the winner's committed loan (not serialized by luck).
    expect(mockStore.loadCalls).toBeGreaterThan(2);

    const stored = await route.readLoan();
    expect(stored).toMatchObject({ outstandingAmount: 0, status: 'closed', closedAt: NOW });
    expect(stored?.repayments).toHaveLength(2);
    expect(new Set(stored?.repayments.map((r: Row) => r._id))).toEqual(new Set(results.map(r => r.json.repayment._id)));

    // Every committed repayment has exactly one row whose actual equals its amount; no orphan rows from retries.
    const month = await route.readMonth('2026-11');
    expect(slrKeysOf(month).sort()).toEqual(results.map(r => r.json.rowKey).sort());
    stored?.repayments.forEach((r: Row) => expect(month?.[r.expenseRowKey].actual).toBe(r.amount));
    expect(await route.expenseMonths()).toEqual(['2026-11']);
  });

  it('C-S3-12: three concurrent repayments into a month with no document → 201, 201 (clamped), 409 loan_closed, one month doc', async () => {
    await route.seedLoans([loan({ principalAmount: 1000, outstandingAmount: 1000 })]);
    route.holdCommitsUntilBothArrive();

    const results = await Promise.all([1, 2, 3].map(() => post(repay('2026-10', { amount: 700 }))));

    expect(results.map(r => r.status).sort()).toEqual([201, 201, 409]);
    expect(results.find(r => r.status === 409)?.json).toEqual({ error: 'loan_closed' });
    const ok = results.filter(r => r.status === 201);
    expect(ok.map(r => r.json.appliedAmount).sort((a, b) => a - b)).toEqual([300, 700]);

    const stored = await route.readLoan();
    expect(stored).toMatchObject({ outstandingAmount: 0, status: 'closed' });
    expect(stored?.repayments).toHaveLength(2);
    // Concurrent upserts never produced a second document for the month.
    const docs = await route.db().collection('monthly_expense').find({ userId: USER_A, month: '2026-10' }).toArray();
    expect(docs).toHaveLength(1);
    expect(slrKeysOf(docs[0]).sort()).toEqual(ok.map(r => r.json.rowKey).sort());
  });
});
