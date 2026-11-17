// savings-loan-withdrawal S1, dispatch 4: route-level suite for /api/savings-loans (spec §4.4, AC-SLW-03…10).
// Shared by __tests__/api/savings-loans.test.ts (Mongo, in-process replica set so withAudit runs a real
// transaction) and __tests__/api/savings-loans-json.test.ts (real JSON store + audit journal in a temp
// AUDIT_DATA_DIR), so both modes run the same cases (C-6). Every failure case re-reads the stores and the
// audit log to prove nothing was written (AC-SLW-05, AC-SLW-10).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMocks } from 'node-mocks-http';
import type { RequestMethod } from 'node-mocks-http';
import type { NextApiHandler } from 'next';
import { ObjectId, type Db } from 'mongodb';
import { MongoMemoryServer } from './mongoReplSet';
import type { SavingsLoan, SavingsWithdrawal } from '../../src/shared/utils/savingsLedger';

export type SavingsLedgerMode = 'json' | 'mongo';
type Row = Record<string, unknown>;

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'slw-loans-user-a';
const USER_B = 'slw-loans-user-b';
const SOURCE = 'savings_loans';
const NOW = '2026-11-15T03:00:00.000Z';
const ID_RE = /^[0-9a-f]{24}$/;
const LOAN_1 = 'a1a1a1a1a1a1a1a1a1a1a1a1';
const LOAN_2 = 'a2a2a2a2a2a2a2a2a2a2a2a2';
const LOAN_3 = 'a3a3a3a3a3a3a3a3a3a3a3a3';
const WD_1 = 'b1b1b1b1b1b1b1b1b1b1b1b1';
const GOAL_ID = 'c0c0c0c0c0c0c0c0c0c0c0c0';
const OTHER_GOAL_ID = 'c2c2c2c2c2c2c2c2c2c2c2c2';
const ABANDONED_GOAL_ID = 'c1c1c1c1c1c1c1c1c1c1c1c1';
const COLLECTIONS = ['savingsLoans', 'savingsWithdrawals', 'savingsLedgerGuards', 'savings', 'savingsGoals', 'audit_logs'];
const JSON_FILES = ['savings-loans.json', 'savings-withdrawals.json', 'savings.json', 'savings-goals.json', 'audit_journal.json'];

const REPAYMENT = {
  _id: 'd1d1d1d1d1d1d1d1d1d1d1d1',
  amount: 1000,
  expenseMonth: '2026-11',
  expenseRowKey: 'slr_d1d1d1d1d1d1d1d1d1d1d1d1',
  createdAt: NOW
};

function makeLoan(id: string, overrides: Partial<SavingsLoan> = {}): SavingsLoan {
  return {
    _id: id,
    userId: USER_A,
    source: { type: 'pool' },
    principalAmount: 1000,
    outstandingAmount: 1000,
    status: 'open',
    note: null,
    createdAt: NOW,
    updatedAt: NOW,
    closedAt: null,
    repayments: [],
    ...overrides
  };
}

function makeWithdrawal(id: string, overrides: Partial<SavingsWithdrawal> = {}): SavingsWithdrawal {
  return { _id: id, userId: USER_A, source: { type: 'pool' }, amount: 500, note: null, createdAt: NOW, ...overrides };
}

function month(m: string, entries: Array<[string, number | string]>) {
  return { month: m, savings_list: entries.map(([savings_type, savings_amount]) => ({ savings_type, savings_amount })) };
}

export function defineSavingsLoansRouteSuite(mode: SavingsLedgerMode) {
  describe(`/api/savings-loans — ${mode} mode`, () => {
    let loansHandler: NextApiHandler;
    let goalsHandler: NextApiHandler;
    let auditedMod: typeof import('../../lib/auditedMutation');
    let sessionCookie: typeof import('../../src/shared/utils/backend/sessionCookie');
    let dir = '';
    let mongod: MongoMemoryServer | null = null;
    let db: Db | null = null;

    beforeAll(async () => {
      process.env.SESSION_SECRET = TEST_SECRET;
      if (mode === 'json') {
        process.env.DATA_MODE = 'json';
        delete process.env.MONGODB_URI;
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slw-loans-json-'));
        process.env.AUDIT_DATA_DIR = dir;
      } else {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();
        process.env.DATA_MODE = 'mongo';
        delete process.env.AUDIT_DATA_DIR;
      }

      jest.resetModules();
      loansHandler = require('../../pages/api/savings-loans').default;
      goalsHandler = require('../../pages/api/savings-goals').default;
      auditedMod = require('../../lib/auditedMutation');
      sessionCookie = require('../../src/shared/utils/backend/sessionCookie');
      if (mode === 'mongo') {
        db = await require('../../lib/mongodb').getDbPromise();
        // Release check C-7: pre-create the collections so implicit creation inside two concurrent
        // transactions doesn't add its own conflict to what the concurrency case measures.
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
      auditedMod.auditTestHooks.beforeAuditWrite = undefined;
      if (mode === 'json') {
        fs.readdirSync(dir).forEach(name => fs.rmSync(path.join(dir, name), { recursive: true, force: true }));
      } else {
        for (const name of COLLECTIONS) await db!.collection(name).deleteMany({});
      }
    });

    // ---- request helper ----

    async function call(
      handler: NextApiHandler,
      { method = 'GET', body, query = {}, userId = USER_A, csrf = true }:
        { method?: RequestMethod; body?: unknown; query?: Record<string, string>; userId?: string | null; csrf?: boolean } = {}
    ) {
      const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
      const sid = createSessionId();
      const { req, res } = createMocks({
        method,
        body: body as never,
        query,
        cookies: userId ? { [SESSION_COOKIE_NAME]: signSession(userId, sid) } : {},
        headers: csrf ? { 'x-csrf-token': signCsrfToken(sid) } : {}
      });
      await handler(req as never, res as never);
      const raw = res._getData();
      return { status: res._getStatusCode(), body: raw ? JSON.parse(raw) : null };
    }

    const post = (body: unknown, userId = USER_A) => call(loansHandler, { method: 'POST', body, userId });
    const getLoans = (userId = USER_A) => call(loansHandler, { userId });

    // ---- fixtures ----

    function readJsonFile(name: string): Record<string, Row> {
      const file = path.join(dir, name);
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    }

    function writeJsonFile(name: string, data: unknown) {
      fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
    }

    async function seedLoans(userId: string, loans: SavingsLoan[]) {
      if (mode === 'json') {
        writeJsonFile('savings-loans.json', { ...readJsonFile('savings-loans.json'), [userId]: { loans } });
        return;
      }
      if (loans.length) await db!.collection('savingsLoans').insertMany(loans.map(l => ({ ...l, userId })) as never);
    }

    async function seedWithdrawals(userId: string, withdrawals: SavingsWithdrawal[]) {
      if (mode === 'json') {
        writeJsonFile('savings-withdrawals.json', { ...readJsonFile('savings-withdrawals.json'), [userId]: { withdrawals } });
        return;
      }
      if (withdrawals.length) {
        await db!.collection('savingsWithdrawals').insertMany(withdrawals.map(w => ({ ...w, userId })) as never);
      }
    }

    async function seedSavings(userId: string, docs: Array<{ month: string; savings_list: unknown[] }>) {
      if (mode === 'json') {
        writeJsonFile('savings.json', { ...readJsonFile('savings.json'), [userId]: Object.fromEntries(docs.map(d => [d.month, d])) });
        return;
      }
      await db!.collection('savings').insertMany(docs.map(d => ({ ...d, userId })));
    }

    async function seedGoals(userId: string, goals: Row[]) {
      if (mode === 'json') {
        writeJsonFile('savings-goals.json', { ...readJsonFile('savings-goals.json'), [userId]: { goals } });
        return;
      }
      // Production Mongo goals carry ObjectId ids; the store stringifies them.
      await db!.collection('savingsGoals').insertMany(goals.map(g => ({ ...g, userId, _id: new ObjectId(String(g._id)) })));
    }

    async function rawLoans(userId = USER_A): Promise<Row[]> {
      if (mode === 'json') return (readJsonFile('savings-loans.json')[userId]?.loans as Row[]) ?? [];
      const docs = await db!.collection('savingsLoans').find({ userId }).toArray();
      return docs as unknown as Row[];
    }

    async function auditEvents(): Promise<Row[]> {
      if (mode === 'json') return (readJsonFile('audit_journal.json').events as unknown as Row[]) ?? [];
      return db!.collection('audit_logs').find({}).toArray() as unknown as Row[];
    }

    /** Every persisted byte the route could touch, for "nothing was written" assertions. */
    async function snapshot(): Promise<unknown> {
      if (mode === 'json') {
        return JSON_FILES.map(name => (fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name), 'utf8') : null));
      }
      const result: Record<string, unknown> = {};
      for (const name of COLLECTIONS.filter(c => c !== 'savingsLedgerGuards')) {
        result[name] = await db!.collection(name).find({}).sort({ _id: 1 }).toArray();
      }
      return result;
    }

    /** Pool of 10,000 across 3 months (AC-SLW-04), goal "เที่ยว" matching 4,000 of it. */
    async function seedStandardFixture() {
      await seedSavings(USER_A, [
        month('2026-09', [['ทั่วไป', 3000], ['เที่ยว', 1000]]),
        month('2026-10', [['ทั่วไป', '2,000'], ['เที่ยว', 2000]]),
        month('2026-11', [['เที่ยว', 1000], ['ทั่วไป', 1000]])
      ]);
      await seedGoals(USER_A, [
        { _id: GOAL_ID, goalName: 'เที่ยว', targetAmount: 20000, status: 'active', createdAt: NOW },
        { _id: ABANDONED_GOAL_ID, goalName: 'ทั่วไป', targetAmount: 1, status: 'abandoned', createdAt: NOW }
      ]);
    }

    /** The exact audit shape per mode: JSON diffs the per-user bucket (array field → `updated`). */
    function expectedLoanEvent(action: 'created' | 'deleted', userId = USER_A) {
      return mode === 'json'
        ? { source: SOURCE, action: 'updated', resource: 'savings-loans', changedFields: ['loans'], subjectUserId: userId }
        : { source: SOURCE, action, resource: 'savingsLoans', subjectUserId: userId };
    }

    function expectNoGuardEvents(events: Row[]) {
      expect(events.some(e => String(e.resource).toLowerCase().includes('guard'))).toBe(false);
    }

    // ---- auth / method ----

    describe('auth and method', () => {
      it('401 without a session, 403 on POST/DELETE without CSRF, nothing written', async () => {
        await seedStandardFixture();
        const before = await snapshot();
        expect((await call(loansHandler, { userId: null })).status).toBe(401);
        expect((await call(loansHandler, { method: 'POST', userId: null, body: { source: { type: 'pool' }, amount: 1 } })).status).toBe(401);
        expect((await call(loansHandler, { method: 'POST', csrf: false, body: { source: { type: 'pool' }, amount: 1 } })).status).toBe(403);
        expect((await call(loansHandler, { method: 'DELETE', csrf: false, body: { loanId: LOAN_1 } })).status).toBe(403);
        expect(await snapshot()).toEqual(before);
      });

      it.each<RequestMethod>(['PUT', 'PATCH'])('%s → 405, nothing written', async (method) => {
        await seedLoans(USER_A, [makeLoan(LOAN_1)]);
        const before = await snapshot();
        const r = await call(loansHandler, { method, body: { loanId: LOAN_1, outstandingAmount: 0 } });
        expect(r.status).toBe(405);
        expect(await snapshot()).toEqual(before);
      });

      it('400 when the body is not an object (validateApiRequest)', async () => {
        const r = await call(loansHandler, { method: 'POST', body: 'nope' });
        expect(r.status).toBe(400);
        expect(await rawLoans()).toEqual([]);
      });
    });

    // ---- GET ----

    describe('GET', () => {
      it('E-SLW-30: no data → empty list and an all-zero summary', async () => {
        const r = await getLoans();
        expect(r).toEqual({
          status: 200,
          body: {
            loans: [],
            summary: { poolSavingsTotal: 0, poolOutstanding: 0, poolWithdrawn: 0, poolBalance: 0, poolCarriedForward: 0, totalOutstanding: 0, openLoanCount: 0 }
          }
        });
      });

      it('AC-SLW-04: summary from savings, pool loan with a repayment, pool withdrawal and a goal loan', async () => {
        await seedStandardFixture();
        await seedLoans(USER_A, [
          makeLoan(LOAN_1, { principalAmount: 3000, outstandingAmount: 2000, repayments: [REPAYMENT], createdAt: '2026-10-01T00:00:00.000Z' }),
          makeLoan(LOAN_2, { source: { type: 'goal', goalId: GOAL_ID }, principalAmount: 1000, outstandingAmount: 1000, createdAt: '2026-11-01T00:00:00.000Z' })
        ]);
        await seedWithdrawals(USER_A, [makeWithdrawal(WD_1, { amount: 500 })]);

        const r = await getLoans();
        expect(r.status).toBe(200);
        expect(r.body.summary).toEqual({
          poolSavingsTotal: 10000,
          poolOutstanding: 2000,
          poolWithdrawn: 500,
          poolBalance: 7500,
          poolCarriedForward: 0,
          totalOutstanding: 3000,
          openLoanCount: 2
        });
        // Newest createdAt first; balanceAfter is derived on read and never stored.
        expect(r.body.loans.map((l: Row) => l._id)).toEqual([LOAN_2, LOAN_1]);
        expect(r.body.loans[1].repayments).toEqual([{ ...REPAYMENT, balanceAfter: 2000 }]);
        expect((await rawLoans()).find(l => l._id === LOAN_1)!.repayments).toEqual([REPAYMENT]);
      });

      it('is scoped to the session user', async () => {
        await seedLoans(USER_B, [makeLoan(LOAN_1, { userId: USER_B })]);
        await seedSavings(USER_B, [month('2026-11', [['ทั่วไป', 5000]])]);
        const r = await getLoans(USER_A);
        expect(r.body.loans).toEqual([]);
        expect(r.body.summary.poolSavingsTotal).toBe(0);
      });

      it('writes nothing (no guard document, no audit event)', async () => {
        await seedStandardFixture();
        const before = await snapshot();
        await getLoans();
        expect(await snapshot()).toEqual(before);
        if (mode === 'mongo') expect(await db!.collection('savingsLedgerGuards').countDocuments({})).toBe(0);
      });
    });

    // ---- GET /api/savings-goals ledger wiring (S2-F-1 / dispatch 3) ----

    describe('GET /api/savings-goals wires the per-goal ledger term', () => {
      it('a goal with an open loan and a withdrawal gets a net currentAmount and ledger metadata', async () => {
        await seedStandardFixture();
        await seedLoans(USER_A, [makeLoan(LOAN_1, { source: { type: 'goal', goalId: GOAL_ID }, principalAmount: 1000, outstandingAmount: 1000 })]);
        await seedWithdrawals(USER_A, [makeWithdrawal(WD_1, { source: { type: 'goal', goalId: GOAL_ID }, amount: 500 })]);

        const r = await call(goalsHandler, { userId: USER_A });
        expect(r.status).toBe(200);
        const goal = r.body.goals.find((g: Row) => g._id === GOAL_ID);
        // Base currentAmount (no ledger) is 4000, per AC-SLW-07 above.
        expect(goal.currentAmount).toBe(4000 - 1000 - 500);
        expect(goal.metadata.outstandingLoansTotal).toBe(1000);
        expect(goal.metadata.withdrawalsTotal).toBe(500);
      });

      it('AC-SLW-11 regression guard: a goal with no ledger activity is unaffected and defaults the new metadata to 0', async () => {
        // seedGoals replaces the whole per-user bucket in JSON mode, so both goals are seeded in
        // one call (unlike Mongo's additive insertMany) — ledger activity exists, but only for
        // OTHER_GOAL_ID, and must not leak onto GOAL_ID.
        await seedSavings(USER_A, [month('2026-09', [['เที่ยว', 4000]])]);
        await seedGoals(USER_A, [
          { _id: GOAL_ID, goalName: 'เที่ยว', targetAmount: 20000, status: 'active', createdAt: NOW },
          { _id: OTHER_GOAL_ID, goalName: 'อื่น', targetAmount: 1000, status: 'active', createdAt: NOW }
        ]);
        await seedLoans(USER_A, [makeLoan(LOAN_1, { source: { type: 'goal', goalId: OTHER_GOAL_ID }, principalAmount: 200, outstandingAmount: 200 })]);

        const r = await call(goalsHandler, { userId: USER_A });
        expect(r.status).toBe(200);
        const goal = r.body.goals.find((g: Row) => g._id === GOAL_ID);
        expect(goal.currentAmount).toBe(4000);
        expect(goal.metadata.outstandingLoansTotal).toBe(0);
        expect(goal.metadata.withdrawalsTotal).toBe(0);

        const other = r.body.goals.find((g: Row) => g._id === OTHER_GOAL_ID);
        expect(other.currentAmount).toBe(-200);
        expect(other.metadata.outstandingLoansTotal).toBe(200);
      });
    });

    // ---- POST ----

    describe('POST create', () => {
      it('AC-SLW-03: pool loan stores exactly the step-10 shape, returns it, and GET reflects it', async () => {
        await seedStandardFixture();
        const r = await post({ source: { type: 'pool' }, amount: '1,500.50', note: '  ค่ารถ  ' });

        expect(r.status).toBe(201);
        const { loan } = r.body;
        expect(loan).toEqual({
          _id: expect.stringMatching(ID_RE),
          userId: USER_A,
          source: { type: 'pool' },
          principalAmount: 1500.5,
          outstandingAmount: 1500.5,
          status: 'open',
          note: 'ค่ารถ',
          createdAt: expect.any(String),
          updatedAt: loan.createdAt,
          closedAt: null,
          repayments: []
        });
        expect(new Date(loan.createdAt).toISOString()).toBe(loan.createdAt);
        expect(r.body.success).toBe(true);
        expect(await rawLoans()).toEqual([loan]);

        const listed = await getLoans();
        expect(listed.body.loans).toEqual([loan]);
        expect(listed.body.summary).toMatchObject({ poolOutstanding: 1500.5, poolBalance: 8499.5, totalOutstanding: 1500.5, openLoanCount: 1 });
      });

      it('AC-SLW-03: goal loan stores the goal source and leaves the pool summary untouched', async () => {
        await seedStandardFixture();
        const r = await post({ source: { type: 'goal', goalId: GOAL_ID }, amount: 1200 });
        expect(r.status).toBe(201);
        expect(r.body.loan).toMatchObject({ source: { type: 'goal', goalId: GOAL_ID }, principalAmount: 1200, outstandingAmount: 1200, note: null });
        expect(await rawLoans()).toEqual([r.body.loan]);
        expect((await getLoans()).body.summary).toMatchObject({ poolBalance: 10000, poolOutstanding: 0, totalOutstanding: 1200, openLoanCount: 1 });
      });

      it('E-SLW-20: a pool source with a goalId is stored as exactly { type: "pool" }', async () => {
        await seedStandardFixture();
        const r = await post({ source: { type: 'pool', goalId: GOAL_ID }, amount: 10 });
        expect(r.status).toBe(201);
        expect((await rawLoans())[0].source).toEqual({ type: 'pool' });
      });

      it('AC-SLW-06: client-sent money/status/identity fields do not affect the stored loan', async () => {
        await seedStandardFixture();
        const r = await post({
          source: { type: 'pool' },
          amount: 700,
          outstandingAmount: 1,
          principalAmount: 999999,
          status: 'closed',
          repayments: [REPAYMENT],
          available: 99999999,
          userId: USER_B,
          _id: LOAN_3,
          closedAt: NOW,
          createdAt: '2000-01-01T00:00:00.000Z'
        });
        expect(r.status).toBe(201);
        const [stored] = await rawLoans();
        expect(stored).toMatchObject({ userId: USER_A, principalAmount: 700, outstandingAmount: 700, status: 'open', repayments: [], closedAt: null });
        expect(stored._id).not.toBe(LOAN_3);
        expect(stored.createdAt).not.toBe('2000-01-01T00:00:00.000Z');
        expect(await rawLoans(USER_B)).toEqual([]);
      });

      it('E-SLW-1/E-SLW-2: borrowing exactly the available balance is allowed; 0.01 more is 409', async () => {
        await seedStandardFixture();
        const over = await post({ source: { type: 'pool' }, amount: 10000.01 });
        expect(over).toEqual({ status: 409, body: { error: 'insufficient_balance', available: 10000 } });
        const exact = await post({ source: { type: 'pool' }, amount: 10000 });
        expect(exact.status).toBe(201);
        expect((await getLoans()).body.summary.poolBalance).toBe(0);
      });

      it('E-SLW-1 (R-1): fractional goal entries (0.7 + 0.1) allow borrowing exactly the displayed 0.80', async () => {
        await seedSavings(USER_A, [month('2026-10', [['เที่ยว', 0.7]]), month('2026-11', [['เที่ยว', 0.1]])]);
        await seedGoals(USER_A, [{ _id: GOAL_ID, goalName: 'เที่ยว', targetAmount: 100, status: 'active', createdAt: NOW }]);
        // 409 body carries the rounded figure, never float dust like 0.7999999999999999.
        expect(await post({ source: { type: 'goal', goalId: GOAL_ID }, amount: 0.81 }))
          .toEqual({ status: 409, body: { error: 'insufficient_balance', available: 0.8 } });
        const exact = await post({ source: { type: 'goal', goalId: GOAL_ID }, amount: '0.80' });
        expect(exact.status).toBe(201);
        expect(exact.body.loan).toMatchObject({ principalAmount: 0.8, outstandingAmount: 0.8 });
      });

      it('AC-SLW-07: a goal source uses the goal GET currentAmount as available', async () => {
        await seedStandardFixture();
        const goals = await call(goalsHandler);
        const currentAmount = goals.body.goals.find((g: Row) => g._id === GOAL_ID).currentAmount;
        expect(currentAmount).toBe(4000);

        const over = await post({ source: { type: 'goal', goalId: GOAL_ID }, amount: currentAmount + 0.01 });
        expect(over).toEqual({ status: 409, body: { error: 'insufficient_balance', available: currentAmount } });
        expect((await post({ source: { type: 'goal', goalId: GOAL_ID }, amount: currentAmount })).status).toBe(201);
      });

      it('a goal\'s own open loans and withdrawals count against its available balance', async () => {
        await seedStandardFixture();
        await seedWithdrawals(USER_A, [makeWithdrawal(WD_1, { source: { type: 'goal', goalId: GOAL_ID }, amount: 500 })]);
        expect((await post({ source: { type: 'goal', goalId: GOAL_ID }, amount: 3000 })).status).toBe(201);
        expect(await post({ source: { type: 'goal', goalId: GOAL_ID }, amount: 501 }))
          .toEqual({ status: 409, body: { error: 'insufficient_balance', available: 500 } });
        // Pool activity never lowers a goal source (and vice versa).
        expect((await post({ source: { type: 'pool' }, amount: 5000 })).status).toBe(201);
        expect((await post({ source: { type: 'goal', goalId: GOAL_ID }, amount: 500 })).status).toBe(201);
      });

      it('a negative pool refuses any loan with the negative available (E-SLW-12)', async () => {
        await seedLoans(USER_A, [makeLoan(LOAN_1, { principalAmount: 800, outstandingAmount: 800 })]);
        expect(await post({ source: { type: 'pool' }, amount: 1 }))
          .toEqual({ status: 409, body: { error: 'insufficient_balance', available: -800 } });
      });

      it('E-SLW-25: the 51st open loan is refused; closed loans do not count', async () => {
        await seedStandardFixture();
        const open = Array.from({ length: 49 }, (_, i) => makeLoan(`e${String(i).padStart(23, '0')}`, { principalAmount: 1, outstandingAmount: 1 }));
        const closed = Array.from({ length: 5 }, (_, i) => makeLoan(`f${String(i).padStart(23, '0')}`, {
          principalAmount: 1000, outstandingAmount: 0, status: 'closed', closedAt: NOW, repayments: [REPAYMENT]
        }));
        await seedLoans(USER_A, [...open, ...closed]);

        expect((await post({ source: { type: 'pool' }, amount: 1 })).status).toBe(201);
        const before = await snapshot();
        expect(await post({ source: { type: 'pool' }, amount: 1 })).toEqual({ status: 409, body: { error: 'open_loan_limit' } });
        expect(await snapshot()).toEqual(before);
      });

      describe('AC-SLW-05: every failure returns its exact error and writes nothing', () => {
        const cases: Array<[string, unknown, number, Row]> = [
          ['source missing', { amount: 100 }, 400, { error: 'invalid_source' }],
          ['source is a string', { source: 'pool', amount: 100 }, 400, { error: 'invalid_source' }],
          ['source type unknown', { source: { type: 'bank' }, amount: 100 }, 400, { error: 'invalid_source' }],
          ['goal source without goalId', { source: { type: 'goal' }, amount: 100 }, 400, { error: 'goal_id_required' }],
          ['goal source with blank goalId', { source: { type: 'goal', goalId: '  ' }, amount: 100 }, 400, { error: 'goal_id_required' }],
          ['goal source with operator goalId', { source: { type: 'goal', goalId: { $ne: null } }, amount: 100 }, 400, { error: 'goal_id_required' }],
          ['amount missing', { source: { type: 'pool' } }, 400, { error: 'invalid_amount' }],
          ...([0, '0.004', -5, true, [5], 'Infinity', 1e12, 'abc'] as unknown[]).map((amount): [string, unknown, number, Row] =>
            [`amount ${JSON.stringify(amount)}`, { source: { type: 'pool' }, amount }, 400, { error: 'invalid_amount' }]),
          ['note is a number', { source: { type: 'pool' }, amount: 100, note: 5 }, 400, { error: 'invalid_note' }],
          ['note too long', { source: { type: 'pool' }, amount: 100, note: 'x'.repeat(121) }, 400, { error: 'note_too_long' }],
          ['unknown goal', { source: { type: 'goal', goalId: OTHER_GOAL_ID }, amount: 100 }, 404, { error: 'goal_not_found' }],
          ['abandoned goal', { source: { type: 'goal', goalId: ABANDONED_GOAL_ID }, amount: 100 }, 404, { error: 'goal_not_found' }],
          ['over the pool balance', { source: { type: 'pool' }, amount: 10001 }, 409, { error: 'insufficient_balance', available: 10000 }]
        ];

        it.each(cases)('%s', async (_label, body, status, expected) => {
          await seedStandardFixture();
          const before = await snapshot();
          expect(await post(body)).toEqual({ status, body: expected });
          expect(await snapshot()).toEqual(before);
          expect(await auditEvents()).toEqual([]);
        });

        it('E-SLW-17: another user\'s goal → 404 goal_not_found, nothing written', async () => {
          await seedStandardFixture();
          await seedGoals(USER_B, [{ _id: OTHER_GOAL_ID, goalName: 'B', targetAmount: 1, status: 'active' }]);
          await seedSavings(USER_B, [month('2026-11', [['B', 9000]])]);
          const before = await snapshot();
          expect(await post({ source: { type: 'goal', goalId: OTHER_GOAL_ID }, amount: 1 }))
            .toEqual({ status: 404, body: { error: 'goal_not_found' } });
          expect(await snapshot()).toEqual(before);
        });
      });
    });

    // ---- concurrency ----

    describe('AC-SLW-08: concurrent creates cannot jointly overdraw (guard document)', () => {
      /**
       * Mongo: hold each committing transaction (after its writes, before commit) until both requests got there
       * or `timeoutMs` passed, so the two transactions are forced to overlap. JSON transactions are serialized
       * by runJsonTransaction, so there the race resolves without help (E-SLW-4).
       */
      function holdCommitsUntilBothArrive(timeoutMs = 300) {
        let arrived = 0;
        let release!: () => void;
        const both = new Promise<void>(resolve => { release = resolve; });
        auditedMod.auditTestHooks.beforeAuditWrite = async () => {
          arrived += 1;
          if (arrived >= 2) release();
          await Promise.race([both, new Promise(resolve => setTimeout(resolve, timeoutMs))]);
        };
      }

      it.each([
        ['pool', { type: 'pool' }],
        ['goal', { type: 'goal', goalId: GOAL_ID }]
      ])('two 700 loans against a %s of 1,000 → exactly one 201 and one 409', async (_label, source) => {
        await seedSavings(USER_A, [month('2026-11', [['เที่ยว', 1000]])]);
        await seedGoals(USER_A, [{ _id: GOAL_ID, goalName: 'เที่ยว', targetAmount: 5000, status: 'active' }]);
        if (mode === 'mongo') holdCommitsUntilBothArrive();

        // Both handler calls start before either is awaited.
        const results = await Promise.all([post({ source, amount: 700 }), post({ source, amount: 700 })]);

        expect(results.map(r => r.status).sort()).toEqual([201, 409]);
        expect(results.find(r => r.status === 409)!.body).toEqual({ error: 'insufficient_balance', available: 300 });
        expect(await rawLoans()).toHaveLength(1);
        const events = await auditEvents();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject(expectedLoanEvent('created'));
        expectNoGuardEvents(events);
      });
    });

    // ---- DELETE ----

    describe('AC-SLW-09: DELETE (mistake correction, D-SLW-21)', () => {
      it('a loan with zero repayments → 200 and gone; balances rise back (E-SLW-40)', async () => {
        await seedStandardFixture();
        await seedLoans(USER_A, [makeLoan(LOAN_1, { principalAmount: 2500, outstandingAmount: 2500 }), makeLoan(LOAN_2)]);
        const r = await call(loansHandler, { method: 'DELETE', body: { loanId: LOAN_1 } });
        expect(r).toEqual({ status: 200, body: { success: true } });
        expect((await rawLoans()).map(l => l._id)).toEqual([LOAN_2]);
        expect((await getLoans()).body.summary).toMatchObject({ poolBalance: 9000, openLoanCount: 1 });
      });

      it('accepts loanId from the query string', async () => {
        await seedLoans(USER_A, [makeLoan(LOAN_1)]);
        const r = await call(loansHandler, { method: 'DELETE', query: { loanId: LOAN_1 } });
        expect(r.status).toBe(200);
        expect(await rawLoans()).toEqual([]);
      });

      it.each([
        ['an open loan with one repayment', makeLoan(LOAN_1, { outstandingAmount: 0, repayments: [REPAYMENT] })],
        ['a closed loan', makeLoan(LOAN_1, { outstandingAmount: 0, status: 'closed', closedAt: NOW, repayments: [REPAYMENT] })]
      ])('E-SLW-24: %s → 409 loan_has_repayments, nothing written', async (_label, loan) => {
        await seedLoans(USER_A, [loan]);
        const before = await snapshot();
        expect(await call(loansHandler, { method: 'DELETE', body: { loanId: LOAN_1 } }))
          .toEqual({ status: 409, body: { error: 'loan_has_repayments' } });
        expect(await snapshot()).toEqual(before);
        expect(await auditEvents()).toEqual([]);
      });

      it('cross-user id → 404 loan_not_found and the other user\'s loan is unchanged', async () => {
        await seedLoans(USER_B, [makeLoan(LOAN_1, { userId: USER_B })]);
        const before = await snapshot();
        expect(await call(loansHandler, { method: 'DELETE', body: { loanId: LOAN_1 } }))
          .toEqual({ status: 404, body: { error: 'loan_not_found' } });
        expect(await snapshot()).toEqual(before);
        expect(await rawLoans(USER_B)).toHaveLength(1);
      });

      it.each<[string, Row]>([
        ['missing', {}],
        ['an operator object (E-SLW-18)', { loanId: { $ne: null } }],
        ['a number', { loanId: 5 }],
        ['empty', { loanId: '' }]
      ])('loanId %s → 400 loan_id_required, nothing written', async (_label, body) => {
        await seedLoans(USER_A, [makeLoan(LOAN_1)]);
        const before = await snapshot();
        expect(await call(loansHandler, { method: 'DELETE', body }))
          .toEqual({ status: 400, body: { error: 'loan_id_required' } });
        expect(await snapshot()).toEqual(before);
      });

      it('unknown id → 404 loan_not_found', async () => {
        await seedLoans(USER_A, [makeLoan(LOAN_1)]);
        expect(await call(loansHandler, { method: 'DELETE', body: { loanId: LOAN_2 } }))
          .toEqual({ status: 404, body: { error: 'loan_not_found' } });
        expect(await rawLoans()).toHaveLength(1);
      });
    });

    // ---- audit ----

    describe('AC-SLW-10: audit events', () => {
      it('a successful create writes exactly one event for the loan resource and none for the guard', async () => {
        await seedStandardFixture();
        expect((await post({ source: { type: 'pool' }, amount: 100 })).status).toBe(201);
        const events = await auditEvents();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject(expectedLoanEvent('created'));
        expectNoGuardEvents(events);
        if (mode === 'mongo') {
          // The guard document was written in the same transaction, yet is never audited.
          expect(await db!.collection('savingsLedgerGuards').findOne({ _id: USER_A as never })).toEqual({ _id: USER_A, touchedAt: expect.any(Date) });
        }
      });

      it('a successful delete writes exactly one event', async () => {
        await seedLoans(USER_A, [makeLoan(LOAN_1)]);
        expect((await call(loansHandler, { method: 'DELETE', body: { loanId: LOAN_1 } })).status).toBe(200);
        const events = await auditEvents();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject(expectedLoanEvent('deleted'));
      });

      if (mode === 'mongo') {
        it('a failure after the writes rolls back the loan and the guard (500, nothing committed)', async () => {
          await seedStandardFixture();
          auditedMod.auditTestHooks.beforeAuditWrite = () => { throw new Error('audit down'); };
          const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
          const r = await post({ source: { type: 'pool' }, amount: 100 });
          spy.mockRestore();
          expect(r).toEqual({ status: 500, body: { error: 'Internal server error' } });
          expect(await rawLoans()).toEqual([]);
          expect(await db!.collection('savingsLedgerGuards').countDocuments({})).toBe(0);
          expect(await auditEvents()).toEqual([]);
        });
      }
    });
  });
}
