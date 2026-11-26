// savings-loan-withdrawal S1, dispatch 5: route-level suite for /api/savings-withdrawals (spec §4.5,
// AC-SLW-03/05/06/08/09/10 for withdrawals). Mirrors savingsLoansRouteSuite.ts: shared by
// __tests__/api/savings-withdrawals.test.ts (Mongo, in-process replica set so withAudit runs a real
// transaction) and __tests__/api/savings-withdrawals-json.test.ts (real JSON store + audit journal in a temp
// AUDIT_DATA_DIR), so both modes run the same cases (C-6). Every failure case re-reads the stores and the
// audit log to prove nothing was written (AC-SLW-05, AC-SLW-10). Also covers the loan-vs-withdrawal race at
// route level (D-SLW-16: both creates take the same per-user guard).
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
const USER_A = 'slw-wd-user-a';
const USER_B = 'slw-wd-user-b';
const SOURCE = 'savings_withdrawals';
const NOW = '2026-11-15T03:00:00.000Z';
const ID_RE = /^[0-9a-f]{24}$/;
const LOAN_1 = 'a1a1a1a1a1a1a1a1a1a1a1a1';
const WD_1 = 'b1b1b1b1b1b1b1b1b1b1b1b1';
const WD_2 = 'b2b2b2b2b2b2b2b2b2b2b2b2';
const WD_3 = 'b3b3b3b3b3b3b3b3b3b3b3b3';
const GOAL_ID = 'c0c0c0c0c0c0c0c0c0c0c0c0';
const OTHER_GOAL_ID = 'c2c2c2c2c2c2c2c2c2c2c2c2';
const ABANDONED_GOAL_ID = 'c1c1c1c1c1c1c1c1c1c1c1c1';
const COLLECTIONS = ['savingsLoans', 'savingsWithdrawals', 'savingsLedgerGuards', 'savings', 'savingsGoals', 'audit_logs'];
const JSON_FILES = ['savings-loans.json', 'savings-withdrawals.json', 'savings.json', 'savings-goals.json', 'audit_journal.json'];

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

export function defineSavingsWithdrawalsRouteSuite(mode: SavingsLedgerMode) {
  describe(`/api/savings-withdrawals — ${mode} mode`, () => {
    let withdrawalsHandler: NextApiHandler;
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
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slw-wd-json-'));
        process.env.AUDIT_DATA_DIR = dir;
      } else {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();
        process.env.DATA_MODE = 'mongo';
        delete process.env.AUDIT_DATA_DIR;
      }

      jest.resetModules();
      withdrawalsHandler = require('../../pages/api/savings-withdrawals').default;
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

    const post = (body: unknown, userId = USER_A) => call(withdrawalsHandler, { method: 'POST', body, userId });
    const del = (body: unknown, userId = USER_A) => call(withdrawalsHandler, { method: 'DELETE', body, userId });
    const getWithdrawals = (userId = USER_A) => call(withdrawalsHandler, { userId });
    const poolSummary = async () => (await call(loansHandler)).body.summary;

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

    async function rawWithdrawals(userId = USER_A): Promise<Row[]> {
      if (mode === 'json') return (readJsonFile('savings-withdrawals.json')[userId]?.withdrawals as Row[]) ?? [];
      const docs = await db!.collection('savingsWithdrawals').find({ userId }).toArray();
      return docs as unknown as Row[];
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
    function expectedWithdrawalEvent(action: 'created' | 'deleted', userId = USER_A) {
      return mode === 'json'
        ? { source: SOURCE, action: 'updated', resource: 'savings-withdrawals', changedFields: ['withdrawals'], subjectUserId: userId }
        : { source: SOURCE, action, resource: 'savingsWithdrawals', subjectUserId: userId };
    }

    function expectedLoanEvent(userId = USER_A) {
      return mode === 'json'
        ? { source: 'savings_loans', action: 'updated', resource: 'savings-loans', changedFields: ['loans'], subjectUserId: userId }
        : { source: 'savings_loans', action: 'created', resource: 'savingsLoans', subjectUserId: userId };
    }

    function expectNoGuardEvents(events: Row[]) {
      expect(events.some(e => String(e.resource).toLowerCase().includes('guard'))).toBe(false);
    }

    // ---- auth / method ----

    describe('auth and method', () => {
      it('401 without a session, 403 on POST/DELETE without CSRF, nothing written', async () => {
        await seedStandardFixture();
        await seedWithdrawals(USER_A, [makeWithdrawal(WD_1)]);
        const before = await snapshot();
        expect((await call(withdrawalsHandler, { userId: null })).status).toBe(401);
        expect((await call(withdrawalsHandler, { method: 'POST', userId: null, body: { source: { type: 'pool' }, amount: 1 } })).status).toBe(401);
        expect((await call(withdrawalsHandler, { method: 'POST', csrf: false, body: { source: { type: 'pool' }, amount: 1 } })).status).toBe(403);
        expect((await call(withdrawalsHandler, { method: 'DELETE', csrf: false, body: { withdrawalId: WD_1 } })).status).toBe(403);
        expect(await snapshot()).toEqual(before);
      });

      it.each<RequestMethod>(['PUT', 'PATCH'])('%s → 405, nothing written (no edit path, D-SLW-21)', async (method) => {
        await seedWithdrawals(USER_A, [makeWithdrawal(WD_1)]);
        const before = await snapshot();
        const r = await call(withdrawalsHandler, { method, body: { withdrawalId: WD_1, amount: 1 } });
        expect(r.status).toBe(405);
        expect(await snapshot()).toEqual(before);
      });

      it('400 when the body is not an object (validateApiRequest)', async () => {
        const r = await call(withdrawalsHandler, { method: 'POST', body: 'nope' });
        expect(r.status).toBe(400);
        expect(await rawWithdrawals()).toEqual([]);
      });
    });

    // ---- GET ----

    describe('GET', () => {
      it('no data → empty list', async () => {
        expect(await getWithdrawals()).toEqual({ status: 200, body: { withdrawals: [] } });
      });

      it('lists the user\'s withdrawals newest first', async () => {
        await seedWithdrawals(USER_A, [
          makeWithdrawal(WD_1, { createdAt: '2026-09-01T00:00:00.000Z' }),
          makeWithdrawal(WD_2, { createdAt: '2026-11-01T00:00:00.000Z', source: { type: 'goal', goalId: GOAL_ID }, note: 'ค่าเทอม' }),
          makeWithdrawal(WD_3, { createdAt: '2026-10-01T00:00:00.000Z' })
        ]);
        const r = await getWithdrawals();
        expect(r.status).toBe(200);
        expect(r.body.withdrawals.map((w: Row) => w._id)).toEqual([WD_2, WD_3, WD_1]);
        expect(r.body.withdrawals[0]).toEqual(makeWithdrawal(WD_2, {
          createdAt: '2026-11-01T00:00:00.000Z', source: { type: 'goal', goalId: GOAL_ID }, note: 'ค่าเทอม'
        }));
      });

      it('is scoped to the session user', async () => {
        await seedWithdrawals(USER_B, [makeWithdrawal(WD_1, { userId: USER_B })]);
        expect((await getWithdrawals(USER_A)).body.withdrawals).toEqual([]);
        expect((await getWithdrawals(USER_B)).body.withdrawals).toHaveLength(1);
      });

      it('writes nothing (no guard document, no audit event)', async () => {
        await seedStandardFixture();
        await seedWithdrawals(USER_A, [makeWithdrawal(WD_1)]);
        const before = await snapshot();
        await getWithdrawals();
        expect(await snapshot()).toEqual(before);
        if (mode === 'mongo') expect(await db!.collection('savingsLedgerGuards').countDocuments({})).toBe(0);
      });
    });

    // ---- POST ----

    describe('POST create', () => {
      it('AC-SLW-03: pool withdrawal stores exactly the §4.5 shape, returns it, and lowers the pool', async () => {
        await seedStandardFixture();
        const r = await post({ source: { type: 'pool' }, amount: '1,500.50', note: '  ซ่อมรถ  ' });

        expect(r.status).toBe(201);
        const { withdrawal } = r.body;
        expect(withdrawal).toEqual({
          _id: expect.stringMatching(ID_RE),
          userId: USER_A,
          source: { type: 'pool' },
          amount: 1500.5,
          note: 'ซ่อมรถ',
          createdAt: expect.any(String)
        });
        expect(new Date(withdrawal.createdAt).toISOString()).toBe(withdrawal.createdAt);
        expect(r.body.success).toBe(true);
        expect(await rawWithdrawals()).toEqual([withdrawal]);

        expect((await getWithdrawals()).body.withdrawals).toEqual([withdrawal]);
        expect(await poolSummary()).toMatchObject({ poolWithdrawn: 1500.5, poolBalance: 8499.5, totalOutstanding: 0, openLoanCount: 0 });
      });

      it('AC-SLW-03: goal withdrawal stores the goal source and leaves the pool untouched', async () => {
        await seedStandardFixture();
        const r = await post({ source: { type: 'goal', goalId: GOAL_ID }, amount: 1200 });
        expect(r.status).toBe(201);
        expect(r.body.withdrawal).toMatchObject({ source: { type: 'goal', goalId: GOAL_ID }, amount: 1200, note: null });
        expect(await rawWithdrawals()).toEqual([r.body.withdrawal]);
        expect(await poolSummary()).toMatchObject({ poolBalance: 10000, poolWithdrawn: 0 });
      });

      it('E-SLW-20: a pool source with a goalId is stored as exactly { type: "pool" }', async () => {
        await seedStandardFixture();
        const r = await post({ source: { type: 'pool', goalId: GOAL_ID }, amount: 10 });
        expect(r.status).toBe(201);
        expect((await rawWithdrawals())[0].source).toEqual({ type: 'pool' });
      });

      it('AC-SLW-06: client-sent money/identity fields do not affect the stored withdrawal', async () => {
        await seedStandardFixture();
        const r = await post({
          source: { type: 'pool' },
          amount: 700,
          available: 99999999,
          userId: USER_B,
          _id: WD_3,
          createdAt: '2000-01-01T00:00:00.000Z',
          outstandingAmount: 1,
          status: 'closed'
        });
        expect(r.status).toBe(201);
        const [stored] = await rawWithdrawals();
        expect(Object.keys(stored).filter(k => k !== '_id').sort()).toEqual(['amount', 'createdAt', 'note', 'source', 'userId']);
        expect(stored).toMatchObject({ userId: USER_A, amount: 700 });
        expect(stored._id).not.toBe(WD_3);
        expect(stored.createdAt).not.toBe('2000-01-01T00:00:00.000Z');
        expect(await rawWithdrawals(USER_B)).toEqual([]);
      });

      it('E-SLW-1/E-SLW-2: withdrawing exactly the available balance is allowed; 0.01 more is 409', async () => {
        await seedStandardFixture();
        expect(await post({ source: { type: 'pool' }, amount: 10000.01 }))
          .toEqual({ status: 409, body: { error: 'insufficient_balance', available: 10000 } });
        expect((await post({ source: { type: 'pool' }, amount: 10000 })).status).toBe(201);
        expect((await poolSummary()).poolBalance).toBe(0);
      });

      it('AC-SLW-07: a goal source uses the goal GET currentAmount as available', async () => {
        await seedStandardFixture();
        const goals = await call(goalsHandler);
        const currentAmount = goals.body.goals.find((g: Row) => g._id === GOAL_ID).currentAmount;
        expect(currentAmount).toBe(4000);

        expect(await post({ source: { type: 'goal', goalId: GOAL_ID }, amount: currentAmount + 0.01 }))
          .toEqual({ status: 409, body: { error: 'insufficient_balance', available: currentAmount } });
        expect((await post({ source: { type: 'goal', goalId: GOAL_ID }, amount: currentAmount })).status).toBe(201);
      });

      it('a source\'s open loans and earlier withdrawals count against its available balance', async () => {
        await seedStandardFixture();
        await seedLoans(USER_A, [makeLoan(LOAN_1, { source: { type: 'goal', goalId: GOAL_ID }, principalAmount: 3000, outstandingAmount: 3000 })]);
        await seedWithdrawals(USER_A, [makeWithdrawal(WD_1, { amount: 2000 })]);
        expect(await post({ source: { type: 'goal', goalId: GOAL_ID }, amount: 1000.01 }))
          .toEqual({ status: 409, body: { error: 'insufficient_balance', available: 1000 } });
        expect(await post({ source: { type: 'pool' }, amount: 8000.01 }))
          .toEqual({ status: 409, body: { error: 'insufficient_balance', available: 8000 } });
        expect((await post({ source: { type: 'goal', goalId: GOAL_ID }, amount: 1000 })).status).toBe(201);
        expect((await post({ source: { type: 'pool' }, amount: 8000 })).status).toBe(201);
      });

      it('a negative pool refuses any withdrawal with the negative available (E-SLW-12)', async () => {
        await seedLoans(USER_A, [makeLoan(LOAN_1, { principalAmount: 800, outstandingAmount: 800 })]);
        expect(await post({ source: { type: 'pool' }, amount: 1 }))
          .toEqual({ status: 409, body: { error: 'insufficient_balance', available: -800 } });
      });

      it('no open-loan cap applies: 50 open loans do not block a withdrawal (D-SLW-20)', async () => {
        await seedStandardFixture();
        const open = Array.from({ length: 50 }, (_, i) => makeLoan(`e${String(i).padStart(23, '0')}`, { principalAmount: 1, outstandingAmount: 1 }));
        await seedLoans(USER_A, open);
        expect((await post({ source: { type: 'pool' }, amount: 1 })).status).toBe(201);
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
          ['over the pool balance', { source: { type: 'pool' }, amount: 10001 }, 409, { error: 'insufficient_balance', available: 10000 }],
          ['over the goal balance', { source: { type: 'goal', goalId: GOAL_ID }, amount: 4001 }, 409, { error: 'insufficient_balance', available: 4000 }]
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

      async function seedRaceFixture() {
        await seedSavings(USER_A, [month('2026-11', [['เที่ยว', 1000]])]);
        await seedGoals(USER_A, [{ _id: GOAL_ID, goalName: 'เที่ยว', targetAmount: 5000, status: 'active' }]);
      }

      const sources: Array<[string, Row]> = [
        ['pool', { type: 'pool' }],
        ['goal', { type: 'goal', goalId: GOAL_ID }]
      ];

      it.each(sources)('two 700 withdrawals against a %s of 1,000 → exactly one 201 and one 409', async (_label, source) => {
        await seedRaceFixture();
        if (mode === 'mongo') holdCommitsUntilBothArrive();

        // Both handler calls start before either is awaited.
        const results = await Promise.all([post({ source, amount: 700 }), post({ source, amount: 700 })]);

        expect(results.map(r => r.status).sort()).toEqual([201, 409]);
        expect(results.find(r => r.status === 409)!.body).toEqual({ error: 'insufficient_balance', available: 300 });
        expect(await rawWithdrawals()).toHaveLength(1);
        const events = await auditEvents();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject(expectedWithdrawalEvent('created'));
        expectNoGuardEvents(events);
      });

      it.each(sources)('a 700 loan and a 700 withdrawal against a %s of 1,000 → exactly one 201 and one 409', async (_label, source) => {
        await seedRaceFixture();
        if (mode === 'mongo') holdCommitsUntilBothArrive();

        // Different routes, different collections: only the shared guard document makes them conflict.
        const [loanResult, withdrawalResult] = await Promise.all([
          call(loansHandler, { method: 'POST', body: { source, amount: 700 } }),
          post({ source, amount: 700 })
        ]);

        expect([loanResult.status, withdrawalResult.status].sort()).toEqual([201, 409]);
        const loser = loanResult.status === 409 ? loanResult : withdrawalResult;
        expect(loser.body).toEqual({ error: 'insufficient_balance', available: 300 });
        const stored = (await rawLoans()).length + (await rawWithdrawals()).length;
        expect(stored).toBe(1);

        const events = await auditEvents();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject(loanResult.status === 201 ? expectedLoanEvent() : expectedWithdrawalEvent('created'));
        expectNoGuardEvents(events);
      });
    });

    // ---- DELETE ----

    describe('AC-SLW-09: DELETE (mistake correction, D-SLW-21)', () => {
      it('any withdrawal → 200 and gone; the source balance rises back (E-SLW-40)', async () => {
        await seedStandardFixture();
        await seedWithdrawals(USER_A, [makeWithdrawal(WD_1, { amount: 2500 }), makeWithdrawal(WD_2, { amount: 1000 })]);
        expect((await poolSummary()).poolBalance).toBe(6500);
        expect(await del({ withdrawalId: WD_1 })).toEqual({ status: 200, body: { success: true } });
        expect((await rawWithdrawals()).map(w => w._id)).toEqual([WD_2]);
        expect(await poolSummary()).toMatchObject({ poolWithdrawn: 1000, poolBalance: 9000 });
      });

      it('a goal-sourced withdrawal (even of an abandoned goal) is deletable', async () => {
        await seedStandardFixture();
        await seedWithdrawals(USER_A, [
          makeWithdrawal(WD_1, { source: { type: 'goal', goalId: GOAL_ID } }),
          makeWithdrawal(WD_2, { source: { type: 'goal', goalId: ABANDONED_GOAL_ID } })
        ]);
        expect((await del({ withdrawalId: WD_1 })).status).toBe(200);
        expect((await del({ withdrawalId: WD_2 })).status).toBe(200);
        expect(await rawWithdrawals()).toEqual([]);
      });

      it('accepts withdrawalId from the query string', async () => {
        await seedWithdrawals(USER_A, [makeWithdrawal(WD_1)]);
        const r = await call(withdrawalsHandler, { method: 'DELETE', query: { withdrawalId: WD_1 } });
        expect(r.status).toBe(200);
        expect(await rawWithdrawals()).toEqual([]);
      });

      it('cross-user id → 404 withdrawal_not_found and the other user\'s withdrawal is unchanged', async () => {
        await seedWithdrawals(USER_B, [makeWithdrawal(WD_1, { userId: USER_B })]);
        const before = await snapshot();
        expect(await del({ withdrawalId: WD_1 })).toEqual({ status: 404, body: { error: 'withdrawal_not_found' } });
        expect(await snapshot()).toEqual(before);
        expect(await rawWithdrawals(USER_B)).toHaveLength(1);
        expect(await auditEvents()).toEqual([]);
      });

      it.each<[string, Row]>([
        ['missing', {}],
        ['an operator object (E-SLW-18)', { withdrawalId: { $ne: null } }],
        ['a number', { withdrawalId: 5 }],
        ['empty', { withdrawalId: '' }]
      ])('withdrawalId %s → 400 withdrawal_id_required, nothing written', async (_label, body) => {
        await seedWithdrawals(USER_A, [makeWithdrawal(WD_1)]);
        const before = await snapshot();
        expect(await del(body)).toEqual({ status: 400, body: { error: 'withdrawal_id_required' } });
        expect(await snapshot()).toEqual(before);
      });

      it('unknown id → 404 withdrawal_not_found, nothing written', async () => {
        await seedWithdrawals(USER_A, [makeWithdrawal(WD_1)]);
        const before = await snapshot();
        expect(await del({ withdrawalId: WD_2 })).toEqual({ status: 404, body: { error: 'withdrawal_not_found' } });
        expect(await snapshot()).toEqual(before);
        expect(await auditEvents()).toEqual([]);
      });

      it('a loan id is not a withdrawal id → 404, the loan is untouched', async () => {
        await seedLoans(USER_A, [makeLoan(LOAN_1)]);
        expect(await del({ withdrawalId: LOAN_1 })).toEqual({ status: 404, body: { error: 'withdrawal_not_found' } });
        expect(await rawLoans()).toHaveLength(1);
      });
    });

    // ---- audit ----

    describe('AC-SLW-10: audit events', () => {
      it('a successful create writes exactly one event for the withdrawal resource and none for the guard', async () => {
        await seedStandardFixture();
        expect((await post({ source: { type: 'pool' }, amount: 100 })).status).toBe(201);
        const events = await auditEvents();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject(expectedWithdrawalEvent('created'));
        expectNoGuardEvents(events);
        if (mode === 'mongo') {
          // The guard document was written in the same transaction, yet is never audited.
          expect(await db!.collection('savingsLedgerGuards').findOne({ _id: USER_A as never })).toEqual({ _id: USER_A, touchedAt: expect.any(Date) });
        }
      });

      it('a successful delete writes exactly one event', async () => {
        await seedWithdrawals(USER_A, [makeWithdrawal(WD_1)]);
        expect((await del({ withdrawalId: WD_1 })).status).toBe(200);
        const events = await auditEvents();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject(expectedWithdrawalEvent('deleted'));
        if (mode === 'mongo') expect(await db!.collection('savingsLedgerGuards').countDocuments({})).toBe(0);
      });

      if (mode === 'mongo') {
        it('a failure after the writes rolls back the withdrawal and the guard (500, nothing committed)', async () => {
          await seedStandardFixture();
          auditedMod.auditTestHooks.beforeAuditWrite = () => { throw new Error('audit down'); };
          const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
          const r = await post({ source: { type: 'pool' }, amount: 100 });
          spy.mockRestore();
          expect(r).toEqual({ status: 500, body: { error: 'Internal server error' } });
          expect(await rawWithdrawals()).toEqual([]);
          expect(await db!.collection('savingsLedgerGuards').countDocuments({})).toBe(0);
          expect(await auditEvents()).toEqual([]);
        });
      }
    });
  });
}
