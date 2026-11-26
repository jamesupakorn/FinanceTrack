/** @jest-environment node */
// savings-loan-withdrawal S3 — Stage 4 (tester-reviewer): AC-SLW-24, end to end, both modes.
// A repayment through POST /api/monthly_expense must be reflected downstream, through the S1/S2 balance
// computations and not only in the stored loan document:
//   - GET /api/savings-loans `summary` (computeLedgerSummary): poolBalance up, outstanding totals down;
//   - GET /api/savings-goals `currentAmount` + `metadata.outstandingLoansTotal` (computeCurrentAmounts);
//   - POST /api/savings-loans no-overdraw check (computeAvailableBalance) sees the raised balance.
// Summary assertions use toMatchObject so the test holds with or without S2c's poolCarriedForward field.
// Real routes, real stores (temp JSON dir / in-process replica set), no collaborator mocks. Only Date is faked.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMocks } from 'node-mocks-http';
import type { RequestMethod } from 'node-mocks-http';
import type { NextApiHandler } from 'next';
import { ObjectId, type Db } from 'mongodb';
import { MongoMemoryServer } from '../helpers/mongoReplSet';

type Row = Record<string, any>;
type Mode = 'json' | 'mongo';

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'slr-balances-user-a';
const POOL_LOAN = 'a1a1a1a1a1a1a1a1a1a1a1a1';
const GOAL_LOAN = 'a2a2a2a2a2a2a2a2a2a2a2a2';
const GOAL_ID = 'c0c0c0c0c0c0c0c0c0c0c0c0';
const CREATED_AT = '2026-10-01T03:00:00.000Z';
const NOW = '2026-11-15T05:00:00.000Z';
const COLLECTIONS = [
  'monthly_expense', 'monthly_income', 'salary', 'investment',
  'savings', 'savingsLoans', 'savingsWithdrawals', 'savingsGoals', 'savingsLedgerGuards', 'audit_logs', 'users'
];

const FAKE_DATE_ONLY = {
  doNotFake: [
    'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
    'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval',
    'clearInterval', 'setTimeout', 'clearTimeout'
  ]
} as const;

const makeLoan = (id: string, extra: Row = {}): Row => ({
  _id: id,
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

const savingsMonth = (m: string, entries: Array<[string, number]>) => ({
  month: m,
  savings_list: entries.map(([savings_type, savings_amount]) => ({ savings_type, savings_amount }))
});

// Lifetime savings 10,000; goal "เที่ยว" matches 4,000 of it (same fixture as AC-SLW-04 / AC-SLW-07).
const SAVINGS = [
  savingsMonth('2026-09', [['ทั่วไป', 3000], ['เที่ยว', 1000]]),
  savingsMonth('2026-10', [['ทั่วไป', 2000], ['เที่ยว', 2000]]),
  savingsMonth('2026-11', [['เที่ยว', 1000], ['ทั่วไป', 1000]])
];
const GOAL = { _id: GOAL_ID, goalName: 'เที่ยว', targetAmount: 20000, status: 'active', createdAt: CREATED_AT };

function defineSuite(mode: Mode) {
  describe(`AC-SLW-24: repayment is reflected in downstream balances — ${mode} mode`, () => {
    let expenseHandler: NextApiHandler;
    let loansHandler: NextApiHandler;
    let goalsHandler: NextApiHandler;
    let sessionCookie: any;
    let dir = '';
    let mongod: MongoMemoryServer | null = null;
    let db: Db | null = null;

    beforeAll(async () => {
      process.env.SESSION_SECRET = TEST_SECRET;
      if (mode === 'json') {
        process.env.DATA_MODE = 'json';
        delete process.env.MONGODB_URI;
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slr-balances-json-'));
        process.env.AUDIT_DATA_DIR = dir;
      } else {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();
        process.env.DATA_MODE = 'mongo';
        delete process.env.AUDIT_DATA_DIR;
      }
      jest.resetModules();
      expenseHandler = require('../../pages/api/monthly_expense').default;
      loansHandler = require('../../pages/api/savings-loans').default;
      goalsHandler = require('../../pages/api/savings-goals').default;
      sessionCookie = require('../../src/shared/utils/backend/sessionCookie');
      if (mode === 'mongo') {
        db = await require('../../lib/mongodb').getDbPromise();
        const existing = new Set((await db!.listCollections().toArray()).map(c => c.name));
        for (const name of COLLECTIONS) {
          if (!existing.has(name)) await db!.createCollection(name);
        }
      }
    }, 60000);

    afterAll(async () => {
      if (mode === 'json') {
        delete process.env.AUDIT_DATA_DIR;
        fs.rmSync(dir, { recursive: true, force: true });
      }
      if (db?.client) await db.client.close();
      if (mongod) await mongod.stop();
    });

    beforeEach(async () => {
      if (mode === 'json') {
        fs.readdirSync(dir).forEach(name => fs.rmSync(path.join(dir, name), { recursive: true, force: true }));
      } else {
        for (const name of COLLECTIONS) await db!.collection(name).deleteMany({});
      }
      jest.useFakeTimers({ ...FAKE_DATE_ONLY, now: new Date(NOW) } as any);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    // ---- helpers ----

    async function call(handler: NextApiHandler, method: RequestMethod, body?: unknown) {
      const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
      const sid = createSessionId();
      const { req, res } = createMocks({
        method,
        body: body as never,
        cookies: { [SESSION_COOKIE_NAME]: signSession(USER_A, sid) },
        headers: { 'x-csrf-token': signCsrfToken(sid) }
      });
      await handler(req as never, res as never);
      const raw = res._getData();
      return { status: res._getStatusCode(), body: raw ? JSON.parse(raw) : null };
    }

    const repay = (loanId: string, amount: number | string, month = '2026-11') =>
      call(expenseHandler, 'POST', { month, repayment: { loanId, amount } });
    const loansSummary = async () => {
      const r = await call(loansHandler, 'GET');
      expect(r.status).toBe(200);
      return r.body.summary as Row;
    };
    const goal = async () => {
      const r = await call(goalsHandler, 'GET');
      expect(r.status).toBe(200);
      return r.body.goals.find((g: Row) => g._id === GOAL_ID) as Row;
    };

    function writeJson(name: string, value: unknown) {
      fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
    }

    async function seed(loans: Row[]) {
      if (mode === 'json') {
        writeJson('savings.json', { [USER_A]: Object.fromEntries(SAVINGS.map(d => [d.month, d])) });
        writeJson('savings-goals.json', { [USER_A]: { goals: [GOAL] } });
        writeJson('savings-loans.json', { [USER_A]: { loans } });
        return;
      }
      await db!.collection('savings').insertMany(SAVINGS.map(d => ({ ...d, userId: USER_A })));
      await db!.collection('savingsGoals').insertOne({ ...GOAL, userId: USER_A, _id: new ObjectId(GOAL_ID) } as never);
      if (loans.length) await db!.collection('savingsLoans').insertMany(loans as never);
    }

    // ---- tests ----

    it('pool loan: loans GET summary moves by exactly appliedAmount; the goal is unaffected', async () => {
      await seed([makeLoan(POOL_LOAN)]);
      expect(await loansSummary()).toMatchObject({
        poolSavingsTotal: 10000, poolOutstanding: 3000, poolWithdrawn: 0, poolBalance: 7000, totalOutstanding: 3000, openLoanCount: 1
      });
      const goalBefore = await goal();

      const r = await repay(POOL_LOAN, '1,200.50');
      expect(r.status).toBe(201);
      expect(r.body.appliedAmount).toBe(1200.5);

      expect(await loansSummary()).toMatchObject({
        poolSavingsTotal: 10000, poolOutstanding: 1799.5, poolWithdrawn: 0, poolBalance: 8200.5, totalOutstanding: 1799.5, openLoanCount: 1
      });
      // GET loans also exposes the running balance derived from the new repayment.
      const loans = (await call(loansHandler, 'GET')).body.loans as Row[];
      expect(loans[0].repayments).toEqual([{ ...r.body.repayment, balanceAfter: 1799.5 }]);
      // A pool repayment never touches a goal's figures.
      expect(await goal()).toEqual(goalBefore);
    });

    it('goal loan: goals GET currentAmount rises and outstandingLoansTotal falls; closing restores the base', async () => {
      await seed([makeLoan(GOAL_LOAN, { source: { type: 'goal', goalId: GOAL_ID }, principalAmount: 1000, outstandingAmount: 1000 })]);
      const before = await goal();
      expect(before.currentAmount).toBe(3000); // 4000 base − 1000 outstanding
      expect(before.metadata.outstandingLoansTotal).toBe(1000);
      const poolBefore = await loansSummary();
      expect(poolBefore).toMatchObject({ poolBalance: 10000, poolOutstanding: 0, totalOutstanding: 1000, openLoanCount: 1 });

      const first = await repay(GOAL_LOAN, 400);
      expect(first.status).toBe(201);
      const afterFirst = await goal();
      expect(afterFirst.currentAmount).toBe(3400);
      expect(afterFirst.metadata.outstandingLoansTotal).toBe(600);
      // A goal repayment moves totalOutstanding but never the pool balance.
      expect(await loansSummary()).toEqual({ ...poolBefore, totalOutstanding: 600 });

      // Over-repayment is clamped server-side to 600 and closes the loan.
      const second = await repay(GOAL_LOAN, 9999);
      expect(second.status).toBe(201);
      expect(second.body).toMatchObject({ appliedAmount: 600, outstandingAmount: 0, status: 'closed' });
      const afterClose = await goal();
      expect(afterClose.currentAmount).toBe(4000);
      expect(afterClose.metadata.outstandingLoansTotal).toBe(0);
      expect(await loansSummary()).toEqual({ ...poolBefore, totalOutstanding: 0, openLoanCount: 0 });
    });

    it('computeAvailableBalance (loan POST no-overdraw) sees the balance the repayment raised', async () => {
      await seed([makeLoan(POOL_LOAN, { principalAmount: 9000, outstandingAmount: 9000 })]);
      // Pool balance 1000: borrowing 1500 is refused with the server-computed available.
      expect(await call(loansHandler, 'POST', { source: { type: 'pool' }, amount: 1500 }))
        .toEqual({ status: 409, body: { error: 'insufficient_balance', available: 1000 } });

      expect((await repay(POOL_LOAN, 500)).status).toBe(201);

      // Now 1500 exactly fits; 1500.01 would not.
      expect(await call(loansHandler, 'POST', { source: { type: 'pool' }, amount: 1500.01 }))
        .toEqual({ status: 409, body: { error: 'insufficient_balance', available: 1500 } });
      const borrow = await call(loansHandler, 'POST', { source: { type: 'pool' }, amount: 1500 });
      expect(borrow.status).toBe(201);
      expect(await loansSummary()).toMatchObject({ poolBalance: 0, poolOutstanding: 10000, openLoanCount: 2 });
    });

    it('rejected repayments (404 unknown / cross-loan, 409 closed, 400 range) leave every downstream figure unchanged', async () => {
      await seed([
        makeLoan(POOL_LOAN),
        makeLoan(GOAL_LOAN, { source: { type: 'goal', goalId: GOAL_ID }, principalAmount: 1000, outstandingAmount: 0, status: 'closed', closedAt: CREATED_AT })
      ]);
      const summaryBefore = await loansSummary();
      const goalBefore = await goal();

      expect((await repay('d'.repeat(24), 100)).status).toBe(404);
      expect(await repay(GOAL_LOAN, 100)).toEqual({ status: 409, body: { error: 'loan_closed' } });
      expect(await repay(POOL_LOAN, 100, '2026-12')).toEqual({ status: 400, body: { error: 'month_out_of_range' } });

      expect(await loansSummary()).toEqual(summaryBefore);
      expect(await goal()).toEqual(goalBefore);
    });
  });
}

defineSuite('json');
defineSuite('mongo');
