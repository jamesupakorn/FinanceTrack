/** @jest-environment node */
// savings-loan-withdrawal S1, dispatch 3: the dual-mode ledger store (spec §4.3, DATA_MODEL.md §Savings loans &
// withdrawals). Every read/write/delete case runs in JSON mode (real JSON store in a temp AUDIT_DATA_DIR) and
// Mongo mode (in-process replica set). The concurrency block proves the write-skew guard (D-SLW-16, AC-SLW-08)
// with real withAudit transactions: a store-level handler stands in for the routes, which land in dispatches 4-5.
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import { ObjectId, type Db } from 'mongodb';
import { MongoMemoryServer } from '../../../helpers/mongoReplSet';
import type { SavingsLoan, SavingsLoanSource, SavingsWithdrawal } from '../../../../src/shared/utils/savingsLedger';

type Mode = 'json' | 'mongo';
type Row = Record<string, unknown>;
type Handler = (req: NextApiRequest, res: NextApiResponse) => unknown;

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'slw-store-user-a';
const USER_B = 'slw-store-user-b';
const NOW = '2026-11-15T03:00:00.000Z';
const POOL: SavingsLoanSource = { type: 'pool' };
const LOAN_1 = 'a1a1a1a1a1a1a1a1a1a1a1a1';
const LOAN_2 = 'a2a2a2a2a2a2a2a2a2a2a2a2';
const WD_1 = 'b1b1b1b1b1b1b1b1b1b1b1b1';
const WD_2 = 'b2b2b2b2b2b2b2b2b2b2b2b2';
const GOAL_ID = 'c0c0c0c0c0c0c0c0c0c0c0c0';
const ABANDONED_GOAL_ID = 'c1c1c1c1c1c1c1c1c1c1c1c1';
const LEDGER_COLLECTIONS = ['savingsLoans', 'savingsWithdrawals', 'savingsLedgerGuards', 'savings', 'savingsGoals', 'audit_logs'];

const newId = () => crypto.randomBytes(12).toString('hex');

function makeLoan(id: string, overrides: Partial<SavingsLoan> = {}): SavingsLoan {
  return {
    _id: id,
    userId: USER_A,
    source: POOL,
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
  return { _id: id, userId: USER_A, source: POOL, amount: 500, note: null, createdAt: NOW, ...overrides };
}

const REPAYMENT = {
  _id: 'd1d1d1d1d1d1d1d1d1d1d1d1',
  amount: 1000,
  expenseMonth: '2026-11',
  expenseRowKey: 'slr_d1d1d1d1d1d1d1d1d1d1d1d1',
  createdAt: NOW
};

/** savings_list docs for one user, one per month (AC-SLW-04 uses 10,000 across 3 months). */
function savingsMonths(entries: Array<[string, Array<{ savings_type: string; savings_amount: number | string }>]>) {
  return entries.map(([month, savings_list]) => ({ month, savings_list }));
}

describe.each<Mode>(['json', 'mongo'])('savingsLedgerStore — %s mode', (mode) => {
  let store: typeof import('../../../../src/shared/utils/backend/savingsLedgerStore');
  let auditedMod: typeof import('../../../../lib/auditedMutation');
  let sessionCookie: typeof import('../../../../src/shared/utils/backend/sessionCookie');
  let dir = '';
  let mongod: MongoMemoryServer | null = null;
  let db: Db | null = null;

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    if (mode === 'json') {
      process.env.DATA_MODE = 'json';
      delete process.env.MONGODB_URI;
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slw-store-json-'));
      process.env.AUDIT_DATA_DIR = dir;
    } else {
      mongod = await MongoMemoryServer.create();
      process.env.MONGODB_URI = mongod.getUri();
      process.env.DATA_MODE = 'mongo';
      delete process.env.AUDIT_DATA_DIR;
    }

    jest.resetModules();
    store = require('../../../../src/shared/utils/backend/savingsLedgerStore');
    auditedMod = require('../../../../lib/auditedMutation');
    sessionCookie = require('../../../../src/shared/utils/backend/sessionCookie');
    if (mode === 'mongo') {
      db = await require('../../../../lib/mongodb').getDbPromise();
      // Pre-create the collections (release check C-7): implicit creation inside two concurrent
      // transactions would itself conflict and blur what the concurrency tests measure.
      const existing = new Set((await db!.listCollections().toArray()).map(c => c.name));
      for (const name of LEDGER_COLLECTIONS) {
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
      for (const name of LEDGER_COLLECTIONS) await db!.collection(name).deleteMany({});
    }
  });

  // ---- fixtures ----

  function readJsonFile(name: string): Record<string, Row> {
    const file = path.join(dir, name);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  }

  function writeJsonFile(name: string, data: unknown) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
  }

  async function seedLoans(userId: string, loans: object[]) {
    if (mode === 'json') {
      const data = readJsonFile('savings-loans.json');
      writeJsonFile('savings-loans.json', { ...data, [userId]: { loans } });
      return;
    }
    if (loans.length) await db!.collection('savingsLoans').insertMany(loans.map(l => ({ ...l, userId })) as never);
  }

  async function seedWithdrawals(userId: string, withdrawals: object[]) {
    if (mode === 'json') {
      const data = readJsonFile('savings-withdrawals.json');
      writeJsonFile('savings-withdrawals.json', { ...data, [userId]: { withdrawals } });
      return;
    }
    if (withdrawals.length) {
      await db!.collection('savingsWithdrawals').insertMany(withdrawals.map(w => ({ ...w, userId })) as never);
    }
  }

  async function seedSavings(userId: string, docs: Array<{ month: string; savings_list: unknown[] }>) {
    if (mode === 'json') {
      const data = readJsonFile('savings.json');
      writeJsonFile('savings.json', { ...data, [userId]: Object.fromEntries(docs.map(d => [d.month, d])) });
      return;
    }
    await db!.collection('savings').insertMany(docs.map(d => ({ ...d, userId })));
  }

  async function seedGoals(userId: string, goals: Row[]) {
    if (mode === 'json') {
      const data = readJsonFile('savings-goals.json');
      writeJsonFile('savings-goals.json', { ...data, [userId]: { goals } });
      return;
    }
    // Mongo goals carry ObjectId ids in production; the store must stringify them.
    await db!.collection('savingsGoals').insertMany(goals.map(g => ({ ...g, userId, _id: new ObjectId(String(g._id)) })));
  }

  /** Raw stored records for a user, in insertion order. */
  async function rawLoans(userId = USER_A): Promise<Row[]> {
    if (mode === 'json') return (readJsonFile('savings-loans.json')[userId]?.loans as Row[]) ?? [];
    return db!.collection('savingsLoans').find({ userId }).toArray() as unknown as Row[];
  }

  async function rawWithdrawals(userId = USER_A): Promise<Row[]> {
    if (mode === 'json') return (readJsonFile('savings-withdrawals.json')[userId]?.withdrawals as Row[]) ?? [];
    return db!.collection('savingsWithdrawals').find({ userId }).toArray() as unknown as Row[];
  }

  async function auditEvents(): Promise<Row[]> {
    if (mode === 'json') return (readJsonFile('audit_journal.json').events as unknown as Row[]) ?? [];
    return db!.collection('audit_logs').find({}).toArray() as unknown as Row[];
  }

  // ---- reads ----

  describe('loadLedgerContext', () => {
    it('reads an absent store as empty and only adds savings/goals when asked', async () => {
      expect(await store.loadLedgerContext(USER_A)).toEqual({ loans: [], withdrawals: [] });
      expect(await store.loadLedgerContext(USER_A, { includeGoals: true, includeSavings: true }))
        .toEqual({ loans: [], withdrawals: [], savingsDocs: [], goals: [] });
    });

    it('normalizes stored records through readLoans/readWithdrawals and keeps order', async () => {
      await seedLoans(USER_A, [
        makeLoan(LOAN_1),
        { _id: LOAN_2, source: { type: 'nope' }, principalAmount: 1, outstandingAmount: 1 }, // invalid source → skipped
        makeLoan('a3a3a3a3a3a3a3a3a3a3a3a3', { repayments: [REPAYMENT], outstandingAmount: 0, status: 'closed' })
      ]);
      await seedWithdrawals(USER_A, [makeWithdrawal(WD_1), { _id: WD_2, source: POOL, amount: 'x' }]);
      const ctx = await store.loadLedgerContext(USER_A);
      expect(ctx.loans.map(l => l._id)).toEqual([LOAN_1, 'a3a3a3a3a3a3a3a3a3a3a3a3']);
      expect(ctx.loans[0]).toEqual(makeLoan(LOAN_1));
      expect(ctx.loans[1].repayments).toEqual([REPAYMENT]);
      expect(ctx.withdrawals).toEqual([makeWithdrawal(WD_1)]);
    });

    it('is scoped to one user', async () => {
      await seedLoans(USER_B, [makeLoan(LOAN_1, { userId: USER_B })]);
      await seedWithdrawals(USER_B, [makeWithdrawal(WD_1, { userId: USER_B })]);
      await seedSavings(USER_B, savingsMonths([['2026-01', [{ savings_type: 'x', savings_amount: 1 }]]]));
      await seedGoals(USER_B, [{ _id: GOAL_ID, goalName: 'B', targetAmount: 1, status: 'active' }]);
      expect(await store.loadLedgerContext(USER_A, { includeGoals: true, includeSavings: true }))
        .toEqual({ loans: [], withdrawals: [], savingsDocs: [], goals: [] });
    });

    it('drops abandoned goals and returns string goal ids', async () => {
      await seedGoals(USER_A, [
        { _id: GOAL_ID, goalName: 'เที่ยว', targetAmount: 10000, status: 'active' },
        { _id: ABANDONED_GOAL_ID, goalName: 'เลิก', targetAmount: 1, status: 'abandoned' }
      ]);
      const { goals } = await store.loadLedgerContext(USER_A, { includeGoals: true });
      expect(goals!.map(g => g._id)).toEqual([GOAL_ID]);
      expect(typeof goals![0]._id).toBe('string');
    });

    it('rejects a missing or non-string userId', async () => {
      await expect(store.loadLedgerContext('')).rejects.toThrow('savingsLedgerStore: userId is required');
      await expect(store.loadLedgerContext({ $ne: null })).rejects.toThrow('savingsLedgerStore: userId is required');
    });
  });

  // ---- loan writes ----

  describe('insertLoan / replaceLoan / deleteLoan', () => {
    it('inserts the exact record and forces the stored userId to the scoped caller', async () => {
      const returned = await store.insertLoan(USER_A, makeLoan(LOAN_1, { userId: USER_B, note: 'ค่าซ่อมรถ' }));
      expect(returned).toEqual(makeLoan(LOAN_1, { note: 'ค่าซ่อมรถ' }));
      expect(await rawLoans()).toEqual([makeLoan(LOAN_1, { note: 'ค่าซ่อมรถ' })]);
      expect(await rawLoans(USER_B)).toEqual([]);
      expect((await store.loadLedgerContext(USER_A)).loans).toEqual([makeLoan(LOAN_1, { note: 'ค่าซ่อมรถ' })]);
    });

    it('appends without touching the user\'s other loans', async () => {
      await store.insertLoan(USER_A, makeLoan(LOAN_1));
      await store.insertLoan(USER_A, makeLoan(LOAN_2, { source: { type: 'goal', goalId: GOAL_ID } }));
      expect((await rawLoans()).map(l => l._id)).toEqual([LOAN_1, LOAN_2]);
    });

    it('replaces a loan by id within the user', async () => {
      await seedLoans(USER_A, [makeLoan(LOAN_1), makeLoan(LOAN_2)]);
      const next = makeLoan(LOAN_1, { outstandingAmount: 0, status: 'closed', closedAt: NOW, repayments: [REPAYMENT] });
      expect(await store.replaceLoan(USER_A, next)).toBe(true);
      expect(await rawLoans()).toEqual([next, makeLoan(LOAN_2)]);
    });

    it('replace refuses an unknown id, another user\'s loan and a non-string id, writing nothing', async () => {
      await seedLoans(USER_A, [makeLoan(LOAN_1)]);
      const before = await rawLoans();
      expect(await store.replaceLoan(USER_A, makeLoan(LOAN_2))).toBe(false);
      expect(await store.replaceLoan(USER_B, makeLoan(LOAN_1, { outstandingAmount: 1 }))).toBe(false);
      expect(await store.replaceLoan(USER_A, { ...makeLoan(LOAN_1), _id: { $ne: null } } as never)).toBe(false);
      expect(await rawLoans()).toEqual(before);
      expect(await rawLoans(USER_B)).toEqual([]);
      if (mode === 'json') expect(Object.keys(readJsonFile('savings-loans.json'))).toEqual([USER_A]);
    });

    it('deletes a loan with zero repayments', async () => {
      await seedLoans(USER_A, [makeLoan(LOAN_1), makeLoan(LOAN_2)]);
      expect(await store.deleteLoan(USER_A, LOAN_1)).toBe(true);
      expect((await rawLoans()).map(l => l._id)).toEqual([LOAN_2]);
    });

    it('never deletes a loan that has a repayment (invariant 8)', async () => {
      const repaid = makeLoan(LOAN_1, { outstandingAmount: 0, status: 'closed', repayments: [REPAYMENT] });
      await seedLoans(USER_A, [repaid]);
      expect(await store.deleteLoan(USER_A, LOAN_1)).toBe(false);
      expect(await rawLoans()).toEqual([repaid]);
    });

    it('delete refuses an unknown id, a cross-user id and an operator object', async () => {
      await seedLoans(USER_A, [makeLoan(LOAN_1)]);
      await seedLoans(USER_B, [makeLoan(LOAN_2, { userId: USER_B })]);
      expect(await store.deleteLoan(USER_A, 'ffffffffffffffffffffffff')).toBe(false);
      expect(await store.deleteLoan(USER_A, LOAN_2)).toBe(false);
      expect(await store.deleteLoan(USER_A, { $ne: null })).toBe(false);
      expect(await store.deleteLoan(USER_A, undefined)).toBe(false);
      expect((await rawLoans()).map(l => l._id)).toEqual([LOAN_1]);
      expect((await rawLoans(USER_B)).map(l => l._id)).toEqual([LOAN_2]);
    });
  });

  // ---- withdrawal writes ----

  describe('insertWithdrawal / deleteWithdrawal', () => {
    it('inserts the exact record with the scoped userId', async () => {
      const returned = await store.insertWithdrawal(USER_A, makeWithdrawal(WD_1, { userId: USER_B, note: 'ค่าเทอม' }));
      expect(returned).toEqual(makeWithdrawal(WD_1, { note: 'ค่าเทอม' }));
      expect(await rawWithdrawals()).toEqual([makeWithdrawal(WD_1, { note: 'ค่าเทอม' })]);
      expect((await store.loadLedgerContext(USER_A)).withdrawals).toEqual([makeWithdrawal(WD_1, { note: 'ค่าเทอม' })]);
    });

    it('deletes any withdrawal of the user and nothing else', async () => {
      await seedWithdrawals(USER_A, [makeWithdrawal(WD_1), makeWithdrawal(WD_2)]);
      await seedWithdrawals(USER_B, [makeWithdrawal('b3b3b3b3b3b3b3b3b3b3b3b3', { userId: USER_B })]);
      expect(await store.deleteWithdrawal(USER_A, WD_1)).toBe(true);
      expect(await store.deleteWithdrawal(USER_A, WD_1)).toBe(false);
      expect(await store.deleteWithdrawal(USER_A, 'b3b3b3b3b3b3b3b3b3b3b3b3')).toBe(false);
      expect(await store.deleteWithdrawal(USER_A, { $ne: null })).toBe(false);
      expect((await rawWithdrawals()).map(w => w._id)).toEqual([WD_2]);
      expect(await rawWithdrawals(USER_B)).toHaveLength(1);
    });
  });

  // ---- guard ----

  describe('acquireLedgerGuard', () => {
    it(mode === 'json' ? 'is a no-op in JSON mode' : 'upserts one { _id, touchedAt } doc without userId', async () => {
      await store.acquireLedgerGuard(USER_A);
      await store.acquireLedgerGuard(USER_A);
      if (mode === 'json') {
        expect(fs.readdirSync(dir)).toEqual([]);
        return;
      }
      const guards = await db!.collection('savingsLedgerGuards').find({}).toArray();
      expect(guards).toHaveLength(1);
      expect(Object.keys(guards[0]).sort()).toEqual(['_id', 'touchedAt']);
      expect(guards[0]._id).toBe(USER_A);
      expect(guards[0].touchedAt).toBeInstanceOf(Date);
    });

    it('rejects a missing userId', async () => {
      await expect(store.acquireLedgerGuard(undefined)).rejects.toThrow('savingsLedgerStore: userId is required');
    });
  });

  // ---- balances ----

  describe('computeLedgerSummary / computeAvailableBalance', () => {
    async function seedAcSlw04() {
      await seedSavings(USER_A, savingsMonths([
        ['2026-09', [{ savings_type: 'ทั่วไป', savings_amount: 3000 }]],
        ['2026-10', [{ savings_type: 'เที่ยว', savings_amount: '4,000' }]],
        ['2026-11', [{ savings_type: 'ทั่วไป', savings_amount: 3000 }]]
      ]));
      await seedGoals(USER_A, [{ _id: GOAL_ID, goalName: 'เที่ยว', targetAmount: 10000, status: 'active' }]);
      await seedLoans(USER_A, [
        makeLoan(LOAN_1, { principalAmount: 3000, outstandingAmount: 2000, repayments: [REPAYMENT] }),
        makeLoan(LOAN_2, { source: { type: 'goal', goalId: GOAL_ID }, principalAmount: 1000, outstandingAmount: 1000 })
      ]);
      await seedWithdrawals(USER_A, [
        makeWithdrawal(WD_1, { amount: 500 }),
        makeWithdrawal(WD_2, { source: { type: 'goal', goalId: GOAL_ID }, amount: 500 })
      ]);
    }

    it('AC-SLW-04: pool = lifetime savings − pool outstanding − pool withdrawn', async () => {
      await seedAcSlw04();
      const ctx = await store.loadLedgerContext(USER_A, { includeGoals: true, includeSavings: true });
      expect(store.computeLedgerSummary(ctx)).toEqual({
        poolSavingsTotal: 10000,
        poolOutstanding: 2000,
        poolWithdrawn: 500,
        poolBalance: 7500,
        totalOutstanding: 3000,
        openLoanCount: 2
      });
      expect(store.computeAvailableBalance(ctx, POOL)).toBe(7500);
    });

    it('a goal source is its matched savings net of its own loans and withdrawals', async () => {
      await seedAcSlw04();
      const ctx = await store.loadLedgerContext(USER_A, { includeGoals: true, includeSavings: true });
      expect(store.computeAvailableBalance(ctx, { type: 'goal', goalId: GOAL_ID })).toBe(2500);
    });

    it('a goal without ledger activity equals computeCurrentAmounts rounded to 2 decimals (R-1)', async () => {
      await seedSavings(USER_A, savingsMonths([['2026-10', [{ savings_type: 'เที่ยว', savings_amount: 0.1 }, { savings_type: 'เที่ยว', savings_amount: 0.2 }]]]));
      await seedGoals(USER_A, [{ _id: GOAL_ID, goalName: 'เที่ยว', targetAmount: 10, status: 'active' }]);
      const ctx = await store.loadLedgerContext(USER_A, { includeGoals: true, includeSavings: true });
      // computeCurrentAmounts gives 0.30000000000000004; available must be the money value, not float dust.
      expect(store.computeAvailableBalance(ctx, { type: 'goal', goalId: GOAL_ID })).toBe(0.3);
    });

    it('is not clamped: a pool can go negative', async () => {
      await seedLoans(USER_A, [makeLoan(LOAN_1, { principalAmount: 800, outstandingAmount: 800 })]);
      const ctx = await store.loadLedgerContext(USER_A, { includeGoals: true, includeSavings: true });
      expect(store.computeAvailableBalance(ctx, POOL)).toBe(-800);
    });

    it('returns null for an unknown, abandoned or other user\'s goal', async () => {
      await seedGoals(USER_A, [{ _id: ABANDONED_GOAL_ID, goalName: 'x', targetAmount: 1, status: 'abandoned' }]);
      await seedGoals(USER_B, [{ _id: GOAL_ID, goalName: 'x', targetAmount: 1, status: 'active' }]);
      const ctx = await store.loadLedgerContext(USER_A, { includeGoals: true, includeSavings: true });
      expect(store.computeAvailableBalance(ctx, { type: 'goal', goalId: GOAL_ID })).toBeNull();
      expect(store.computeAvailableBalance(ctx, { type: 'goal', goalId: ABANDONED_GOAL_ID })).toBeNull();
    });

    it('throws when the context was loaded without the data the formula needs', async () => {
      const bare = await store.loadLedgerContext(USER_A);
      expect(() => store.computeAvailableBalance(bare, POOL)).toThrow('includeSavings');
      const noGoals = await store.loadLedgerContext(USER_A, { includeSavings: true });
      expect(() => store.computeAvailableBalance(noGoals, { type: 'goal', goalId: GOAL_ID })).toThrow('includeGoals');
    });
  });

  // ---- concurrency (D-SLW-16, AC-SLW-08, E-SLW-3/4) ----

  describe('concurrent creates against one source', () => {
    /** Each arrival waits until `parties` have arrived or `timeoutMs` passes, to force overlapping transactions. */
    function rendezvous(parties = 2, timeoutMs = 300) {
      let arrived = 0;
      let release!: () => void;
      const all = new Promise<void>(resolve => { release = resolve; });
      return async () => {
        arrived += 1;
        if (arrived >= parties) release();
        await Promise.race([all, new Promise(resolve => setTimeout(resolve, timeoutMs))]);
      };
    }

    /** Stand-in for the dispatch-4/5 POST handlers: guard → fresh read → check → insert, under withAudit. */
    function createHandler(kind: 'loan' | 'withdrawal', { guard, wait }: { guard: boolean; wait: () => Promise<void> }): Handler {
      const handler: Handler = async (req, res) => {
        const amount = (req.body as { amount: number }).amount;
        if (guard) await store.acquireLedgerGuard(USER_A);
        const ctx = await store.loadLedgerContext(USER_A, { includeGoals: true, includeSavings: true });
        await wait();
        const available = store.computeAvailableBalance(ctx, POOL)!;
        if (amount > available) return res.status(409).json({ error: 'insufficient_balance', available });
        if (kind === 'loan') {
          await store.insertLoan(USER_A, makeLoan(newId(), { principalAmount: amount, outstandingAmount: amount }));
        } else {
          await store.insertWithdrawal(USER_A, makeWithdrawal(newId(), { amount }));
        }
        return res.status(201).json({ success: true });
      };
      return auditedMod.withAudit(handler, { source: kind === 'loan' ? 'savings_loans' : 'savings_withdrawals' });
    }

    async function call(handler: Handler, amount: number) {
      const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
      const sid = createSessionId();
      const { req, res } = createMocks({
        method: 'POST',
        body: { amount },
        cookies: { [SESSION_COOKIE_NAME]: signSession(USER_A, sid) },
        headers: { 'x-csrf-token': signCsrfToken(sid) }
      });
      await handler(req as never, res as never);
      const raw = res._getData();
      return { status: res._getStatusCode(), body: raw ? JSON.parse(raw) : null };
    }

    const seedPool1000 = () => seedSavings(USER_A, savingsMonths([['2026-11', [{ savings_type: 'ทั่วไป', savings_amount: 1000 }]]]));

    it.each([
      ['no guard document yet', false],
      ['an existing guard document', true]
    ])('AC-SLW-08: two 700 loans against a pool of 1,000 → one 201, one 409 (%s)', async (_label, preexisting) => {
      await seedPool1000();
      if (preexisting && mode === 'mongo') {
        await db!.collection<{ _id: string; touchedAt: Date }>('savingsLedgerGuards').insertOne({ _id: USER_A, touchedAt: new Date(0) });
      }
      const wait = rendezvous();
      const handler = createHandler('loan', { guard: true, wait });

      const results = await Promise.all([call(handler, 700), call(handler, 700)]);

      expect(results.map(r => r.status).sort()).toEqual([201, 409]);
      expect(results.find(r => r.status === 409)!.body).toEqual({ error: 'insufficient_balance', available: 300 });
      expect(await rawLoans()).toHaveLength(1);
      const events = await auditEvents();
      expect(events).toHaveLength(1);
      // JSON diffs the per-user bucket, where `loans` is an array field, so it reports `updated`.
      expect(events[0]).toMatchObject(mode === 'json'
        ? { source: 'savings_loans', action: 'updated', resource: 'savings-loans', changedFields: ['loans'], subjectUserId: USER_A }
        : { source: 'savings_loans', action: 'created', resource: 'savingsLoans', subjectUserId: USER_A });
      expect(events.some(e => String(e.resource).toLowerCase().includes('guard'))).toBe(false);
    });

    it('a loan and a withdrawal racing on the same pool cannot jointly overdraw it', async () => {
      await seedPool1000();
      const wait = rendezvous();
      const results = await Promise.all([
        call(createHandler('loan', { guard: true, wait }), 700),
        call(createHandler('withdrawal', { guard: true, wait }), 700)
      ]);
      expect(results.map(r => r.status).sort()).toEqual([201, 409]);
      expect((await rawLoans()).length + (await rawWithdrawals()).length).toBe(1);
    });

    if (mode === 'mongo') {
      it('control: without the guard the same race overdraws (write skew is real)', async () => {
        await seedPool1000();
        const wait = rendezvous();
        const handler = createHandler('loan', { guard: false, wait });
        const results = await Promise.all([call(handler, 700), call(handler, 700)]);
        expect(results.map(r => r.status)).toEqual([201, 201]);
        expect(await rawLoans()).toHaveLength(2);
      });
    }
  });
});
