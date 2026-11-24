/** @jest-environment node */
// loan-installments-td-cleanup D8 / I6 — E-28: a rate revision (POST /api/credit-cards/rate-revisions) and a
// per-row paid toggle (PATCH /api/monthly_expense, cci_ key) on the same loan plan. Both write the user's single
// credit_cards doc through updateUserCreditData, so two overlapping Mongo transactions conflict on it.
// AC-TDC-32/33; spec §I6.1/§I6.2, E-TDC-16/17, R-TDC-7.
//
// Cases 1/2 (sequential) run in JSON and Mongo mode. Cases 3/4 (forced overlap) run in Mongo mode only.
//
// Harness (Opus-tier re-review R1-R3):
// - R2: every request runs inside its own AsyncLocalStorage context ('PATCH' | 'POST'). A pass-through
//   wrapper around the REAL updateUserCreditData counts calls per request tag. A call outside any context
//   throws, so a context leak fails loudly instead of being miscounted.
// - R1: the request that must go first has its FIRST call held AFTER its write has landed in its still-open
//   transaction ("parked"). The other request is only started once the first one is parked, so its write
//   deterministically hits a WriteConflict. The hold is released as soon as the wrapper sees the other tag's
//   call reject with a transient-labelled error. Both waits have a safety timeout; a fired timeout fails the case.
// - R3: one fresh module registry, both routes required from it, so both resolve to the mocked store and share
//   one Mongo client.
// Baseline (Opus review): each attempt of either request makes exactly 1 updateUserCreditData call, so a
// count > 1 for a request means its transaction really retried. Cases 1/2 assert {PATCH:1, POST:1}.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createMocks } from 'node-mocks-http';
import type { NextApiHandler } from 'next';
import type { Db } from 'mongodb';
import { MongoMemoryServer } from '../../helpers/mongoReplSet';
import { buildInstallmentRowKey, buildSchedule } from '../../../src/shared/utils/creditCardUtils';
import { reviseEffectiveScheduleTail } from '../../../src/shared/utils/creditCardAmortization';

type Mode = 'json' | 'mongo';
type Tag = 'PATCH' | 'POST';
type Row = Record<string, any>;
type StoreModule = typeof import('../../../src/shared/utils/backend/creditCardStore');
type ErrorsModule = typeof import('../../../src/shared/utils/backend/mongoTransactionErrors');
type Response = { status: number; body: any };

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'e28-user-a';
const JSON_FILENAME = 'credit_cards.json';
const AUDIT_JOURNAL = 'audit_journal.json';
const SOURCE_REVISION = 'credit_card_rate_revisions';
const SOURCE_EXPENSE = 'monthly_expense';
const STORE_PATH = '../../../src/shared/utils/backend/creditCardStore';
const ERRORS_PATH = '../../../src/shared/utils/backend/mongoTransactionErrors';

const LOAN_ID = 'cc_10a010a010a0';
const PLAN_ID = 'ip_aaaaaaaaaaaa';
const PAID_AT = '2027-01-10T03:00:00.000Z';
const PAID_COUNT = 2;
const K = PAID_COUNT + 1; // first unpaid row
const NEW_RATE = 7;
const LOAN_INPUT = {
  totalPrice: 120000,
  months: 12,
  startMonth: '2026-12',
  interestMode: 'calculated',
  annualRate: 6,
  calcMethod: 'effective'
};

const SAFETY_TIMEOUT_MS = 5000;
const RACE_TEST_TIMEOUT_MS = 30000;
// Pre-created so implicit collection creation inside concurrent transactions can't add its own conflict.
const COLLECTIONS = [
  'credit_cards', 'audit_logs', 'users', 'monthly_expense', 'monthly_income', 'salary', 'investment',
  'savingsLoans', 'savingsWithdrawals', 'savingsGoals', 'savingsLedgerGuards'
];

const loanCard = (): Row => ({
  id: LOAN_ID,
  name: 'บ้านหลังแรก',
  creditLimit: 0,
  annualRate: 16,
  minPaymentPercent: 10,
  statementDay: 'EOM',
  dueDay: 5,
  color: '#5d5bff',
  bankName: '',
  last4: '',
  cardType: 'home_loan'
});

/** 12-row effective loan, rows 1…2 paid, rows 3…12 unpaid (≥ 3 unpaid). Built by the real builder. */
function loanPlan(): Row {
  const computed = buildSchedule(LOAN_INPUT);
  const schedule = computed.schedule.map(row => (row.no <= PAID_COUNT
    ? { ...row, paid: true, paidAt: PAID_AT, paidSource: 'credit_card' }
    : { ...row, paid: false, paidAt: null, paidSource: null }));
  return {
    id: PLAN_ID,
    cardId: LOAN_ID,
    itemName: 'บ้านหลังแรก',
    ...LOAN_INPUT,
    purchaseDate: '2026-11-15',
    manualFeePerMonth: 0,
    monthlyPayment: computed.monthlyPayment,
    totalInterest: computed.totalInterest,
    totalPayable: computed.totalPayable,
    schedule,
    status: 'ongoing',
    cancelledAt: null,
    createdAt: '2026-11-15T00:00:00.000Z',
    updatedAt: '2026-11-15T00:00:00.000Z'
  };
}

const PRE = loanPlan();
const ROW_K_MONTH: string = PRE.schedule[K - 1].dueMonth;
const TOGGLE_KEY = buildInstallmentRowKey(PLAN_ID, K);

function markRowKPaid(plan: Row): Row {
  const schedule = plan.schedule.map((row: Row) => (row.no === K
    ? { ...row, paid: true, paidAt: 'volatile', paidSource: 'expense_table' }
    : row));
  return { ...plan, schedule };
}

/** Case 1 outcome: row k paid by the toggle, no revision, every other row unchanged. */
function expectedToggleFirst(): Row {
  return markRowKPaid(PRE);
}

/** Case 2 outcome: tail k…N from reviseEffectiveScheduleTail of the pre-state, then row k paid. */
function expectedRevisionFirst(): Row {
  const revised = reviseEffectiveScheduleTail(
    { totalPrice: PRE.totalPrice, schedule: PRE.schedule },
    { fromInstallmentNo: K, annualRate: NEW_RATE }
  );
  if (!revised.ok) throw new Error(`fixture cannot be revised: ${revised.reason}`);
  return markRowKPaid({
    ...PRE,
    annualRate: NEW_RATE,
    schedule: revised.schedule,
    monthlyPayment: revised.monthlyPayment,
    totalInterest: revised.totalInterest,
    totalPayable: revised.totalPayable,
    rateRevisions: [{
      id: 'volatile',
      effectiveMonth: ROW_K_MONTH,
      fromInstallmentNo: K,
      previousRate: LOAN_INPUT.annualRate,
      newRate: NEW_RATE,
      revisedAt: 'volatile'
    }]
  });
}

/** Ignore updatedAt / paidAt / revisedAt / revision id values (invariant (a)); keep whether they are set. */
function normalise(plan: Row): Row {
  const { updatedAt: _updatedAt, ...rest } = plan;
  const out: Row = {
    ...rest,
    schedule: rest.schedule.map((row: Row) => (row.paidAt ? { ...row, paidAt: 'volatile' } : row))
  };
  if (Array.isArray(rest.rateRevisions)) {
    out.rateRevisions = rest.rateRevisions.map((r: Row) => ({ ...r, id: 'volatile', revisedAt: 'volatile' }));
  }
  return out;
}

// --- per-request probe (R1/R2) -------------------------------------------------------------------

const als = new AsyncLocalStorage<Tag>();
const asRequest = <T>(tag: Tag, fn: () => Promise<T>): Promise<T> => als.run(tag, fn);

const probe: {
  callsByTag: Record<Tag, number>;
  transientRejectionsByTag: Record<Tag, number>;
  contextLeak: boolean;
  holdTag: Tag | null;
  safetyTimeoutFired: { parked: boolean; release: boolean };
  /** tag seen by the audit hook on each attempt that reached the audit write (ALS across withTransaction) */
  auditWriteTags: Array<Tag | undefined>;
  markParked: () => void;
  parked: Promise<void>;
  releaseHold: () => void;
  released: Promise<void>;
} = {
  callsByTag: { PATCH: 0, POST: 0 },
  transientRejectionsByTag: { PATCH: 0, POST: 0 },
  contextLeak: false,
  holdTag: null,
  safetyTimeoutFired: { parked: false, release: false },
  auditWriteTags: [],
  markParked: () => {},
  parked: Promise.resolve(),
  releaseHold: () => {},
  released: Promise.resolve()
};

function resetProbe() {
  probe.callsByTag = { PATCH: 0, POST: 0 };
  probe.transientRejectionsByTag = { PATCH: 0, POST: 0 };
  probe.contextLeak = false;
  probe.holdTag = null;
  probe.safetyTimeoutFired = { parked: false, release: false };
  probe.auditWriteTags = [];
  probe.parked = new Promise<void>(resolve => { probe.markParked = resolve; });
  probe.released = new Promise<void>(resolve => { probe.releaseHold = resolve; });
}

/**
 * Races `gate` against a timer. On timeout the named flag is set; `failLoudly` additionally rejects so the
 * caller can't carry on as if the gate had opened. The flags are asserted false in every race case.
 */
async function withSafetyTimeout(gate: Promise<void>, which: 'parked' | 'release', failLoudly: boolean) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const safety = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => {
      probe.safetyTimeoutFired[which] = true;
      if (failLoudly) reject(new Error(`safety timeout: '${which}' never happened`));
      else resolve();
    }, SAFETY_TIMEOUT_MS);
  });
  try {
    await Promise.race([gate, safety]);
  } finally {
    clearTimeout(timer);
  }
}

function countingUpdateUserCreditData(actual: StoreModule, errors: ErrorsModule): StoreModule['updateUserCreditData'] {
  return async (...args) => {
    const tag = als.getStore();
    if (tag === undefined) {
      probe.contextLeak = true;
      throw new Error('updateUserCreditData called outside a tagged request context');
    }
    probe.callsByTag[tag] += 1;
    const holdThisCall = tag === probe.holdTag && probe.callsByTag[tag] === 1;
    let result: Awaited<ReturnType<StoreModule['updateUserCreditData']>>;
    try {
      result = await actual.updateUserCreditData(...args);
    } catch (error) {
      if (errors.isTransientTransactionError(error)) {
        probe.transientRejectionsByTag[tag] += 1;
        // The other request has definitively hit the race against the parked one.
        if (tag !== probe.holdTag) probe.releaseHold();
      }
      throw error;
    }
    if (holdThisCall) {
      // Write landed in this request's open transaction; keep it open until the other one conflicts.
      probe.markParked();
      await withSafetyTimeout(probe.released, 'release', false);
    }
    return result;
  };
}

// --- suites ----------------------------------------------------------------------------------------

describe.each<Mode>(['json', 'mongo'])('E-28 rate revision vs paid toggle — %s mode', (mode) => {
  const state: {
    revisionHandler?: NextApiHandler;
    expenseHandler?: NextApiHandler;
    sessionCookie?: any;
    audited?: any;
    db?: Db;
    mongod?: MongoMemoryServer;
    dir: string;
  } = { dir: '' };

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    if (mode === 'json') {
      process.env.DATA_MODE = 'json';
      delete process.env.MONGODB_URI;
      state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rate-rev-e28-json-'));
      process.env.AUDIT_DATA_DIR = state.dir;
    } else {
      state.mongod = await MongoMemoryServer.create();
      process.env.MONGODB_URI = state.mongod.getUri();
      process.env.DATA_MODE = 'mongo';
      delete process.env.AUDIT_DATA_DIR;
    }

    // R3: one fresh registry; both routes resolve to this mocked store and share one Mongo client.
    jest.resetModules();
    jest.doMock(STORE_PATH, () => {
      const actual: StoreModule = jest.requireActual(STORE_PATH);
      const errors: ErrorsModule = jest.requireActual(ERRORS_PATH);
      return { ...actual, updateUserCreditData: countingUpdateUserCreditData(actual, errors) };
    });
    state.revisionHandler = require('../../../pages/api/credit-cards/rate-revisions').default;
    state.expenseHandler = require('../../../pages/api/monthly_expense').default;
    state.sessionCookie = require('../../../src/shared/utils/backend/sessionCookie');
    state.audited = require('../../../lib/auditedMutation');
    if (mode === 'mongo') {
      state.db = await require('../../../lib/mongodb').getDbPromise();
      const existing = new Set((await state.db!.listCollections().toArray()).map(c => c.name));
      for (const name of COLLECTIONS) {
        if (!existing.has(name)) await state.db!.createCollection(name);
      }
    }
  }, 60000);

  afterAll(async () => {
    jest.dontMock(STORE_PATH);
    if (state.audited) state.audited.auditTestHooks.beforeAuditWrite = undefined;
    if (mode === 'json') {
      delete process.env.AUDIT_DATA_DIR;
      fs.rmSync(state.dir, { recursive: true, force: true });
    }
    if (state.db?.client) await state.db.client.close();
    if (state.mongod) await state.mongod.stop();
  });

  beforeEach(async () => {
    resetProbe();
    state.audited.auditTestHooks.beforeAuditWrite = () => { probe.auditWriteTags.push(als.getStore()); };
    if (mode === 'json') {
      fs.readdirSync(state.dir).forEach(name => fs.rmSync(path.join(state.dir, name), { recursive: true, force: true }));
    } else {
      for (const name of COLLECTIONS) await state.db!.collection(name).deleteMany({});
    }
    await seed();
  });

  async function seed() {
    const doc = { cards: [loanCard()], plans: [PRE], cycles: [], spendItems: [], updatedAt: '2026-01-01T00:00:00.000Z' };
    if (mode === 'json') {
      fs.writeFileSync(path.join(state.dir, JSON_FILENAME), JSON.stringify({ [USER_A]: doc }));
      return;
    }
    await state.db!.collection('credit_cards').insertOne({ userId: USER_A, ...doc });
  }

  async function storedPlan(): Promise<Row> {
    if (mode === 'json') {
      return JSON.parse(fs.readFileSync(path.join(state.dir, JSON_FILENAME), 'utf8'))[USER_A].plans[0];
    }
    const doc = await state.db!.collection('credit_cards').findOne({ userId: USER_A });
    return (doc as Row).plans[0];
  }

  async function auditSources(): Promise<string[]> {
    let events: Row[];
    if (mode === 'json') {
      const file = path.join(state.dir, AUDIT_JOURNAL);
      events = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')).events ?? []) : [];
    } else {
      events = (await state.db!.collection('audit_logs').find({}).toArray()) as Row[];
    }
    return events.map(e => String(e.source)).sort();
  }

  async function call(handler: NextApiHandler, method: 'POST' | 'PATCH', body: Row): Promise<Response> {
    const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = state.sessionCookie;
    const sid = createSessionId();
    const { req, res } = createMocks({
      method,
      body,
      cookies: { [SESSION_COOKIE_NAME]: signSession(USER_A, sid) },
      headers: { 'x-csrf-token': signCsrfToken(sid) }
    } as any);
    await handler(req as any, res as any);
    const raw = res._getData();
    return { status: res._getStatusCode(), body: raw ? JSON.parse(raw) : null };
  }

  const togglePatch = () => asRequest('PATCH', () =>
    call(state.expenseHandler!, 'PATCH', { month: ROW_K_MONTH, key: TOGGLE_KEY, paid: true }));
  const revisionPost = () => asRequest('POST', () =>
    call(state.revisionHandler!, 'POST', { planId: PLAN_ID, effectiveMonth: ROW_K_MONTH, annualRate: NEW_RATE }));

  const TOGGLE_OK = { status: 200, body: { success: true, paid: true, initialized: false } };
  const REVISION_CONFLICT = { status: 409, body: { error: 'tail has paid installments' } };

  function expectNoProbeFailures() {
    expect(probe.contextLeak).toBe(false);
    expect(probe.safetyTimeoutFired).toEqual({ parked: false, release: false });
  }

  /** Invariant (b): no lost update for whichever request answered 200. */
  async function expectNoLostUpdate(patchRes: Response, postRes: Response) {
    const stored = await storedPlan();
    if (patchRes.status === 200) {
      expect(stored.schedule[K - 1]).toMatchObject({ paid: true, paidSource: 'expense_table' });
      expect(typeof stored.schedule[K - 1].paidAt).toBe('string');
    }
    if (postRes.status === 200) {
      expect(stored.rateRevisions).toEqual([expect.objectContaining({ fromInstallmentNo: K, newRate: NEW_RATE })]);
    }
  }

  // --- sequential (JSON + Mongo) ---------------------------------------------------------------------

  it('case 1 — toggle first: PATCH 200, then POST 409; row k paid, rateRevisions unchanged, other rows unchanged', async () => {
    const patchRes = await togglePatch();
    const postRes = await revisionPost();

    expect(patchRes).toEqual(TOGGLE_OK);
    expect(postRes).toEqual(REVISION_CONFLICT);
    // Baseline proof: exactly one store call per request attempt, no retries when nothing overlaps.
    expect(probe.callsByTag).toEqual({ PATCH: 1, POST: 1 });
    expect(probe.transientRejectionsByTag).toEqual({ PATCH: 0, POST: 0 });
    expect(probe.contextLeak).toBe(false);

    const stored = await storedPlan();
    expect(stored.rateRevisions).toBeUndefined();
    expect(stored.schedule.filter((_: Row, i: number) => i !== K - 1)).toEqual(PRE.schedule.filter((_: Row, i: number) => i !== K - 1));
    expect(normalise(stored)).toEqual(normalise(expectedToggleFirst()));
    await expectNoLostUpdate(patchRes, postRes);
    expect(await auditSources()).toEqual([SOURCE_EXPENSE]);
  });

  it('case 2 — revision first: POST 200, then PATCH 200; tail k…N revised, row k paid with paidAt', async () => {
    const postRes = await revisionPost();
    const patchRes = await togglePatch();

    expect(postRes.status).toBe(200);
    expect(postRes.body.success).toBe(true);
    expect(patchRes).toEqual(TOGGLE_OK);
    expect(probe.callsByTag).toEqual({ PATCH: 1, POST: 1 });
    expect(probe.transientRejectionsByTag).toEqual({ PATCH: 0, POST: 0 });
    expect(probe.contextLeak).toBe(false);

    const stored = await storedPlan();
    expect(stored.rateRevisions).toHaveLength(1);
    expect(stored.schedule.slice(0, K - 1)).toEqual(PRE.schedule.slice(0, K - 1));
    const expected = expectedRevisionFirst();
    expect(stored.schedule.slice(K)).toEqual(expected.schedule.slice(K));
    expect(stored.schedule[K - 1]).toMatchObject({ paid: true, paidSource: 'expense_table' });
    expect(typeof stored.schedule[K - 1].paidAt).toBe('string');
    expect(normalise(stored)).toEqual(normalise(expected));
    await expectNoLostUpdate(patchRes, postRes);
    expect(await auditSources()).toEqual([SOURCE_REVISION, SOURCE_EXPENSE].sort());
  });

  // --- forced overlap (Mongo only) -------------------------------------------------------------------

  if (mode === 'mongo') {
    it('case 3 — overlap, toggle holds first: PATCH 200, POST retries and gets 409 (never 500)', async () => {
      probe.holdTag = 'PATCH';
      const patchP = togglePatch();
      await withSafetyTimeout(probe.parked, 'parked', true);
      const postP = revisionPost();
      const [patchRes, postRes] = await Promise.all([patchP, postP]);

      expectNoProbeFailures();
      expect(patchRes).toEqual(TOGGLE_OK);
      expect(postRes).toEqual(REVISION_CONFLICT);
      // Winner never retried; loser conflicted at least once and re-ran (E-TDC-17: possibly more than once).
      expect(probe.callsByTag.PATCH).toBe(1);
      expect(probe.callsByTag.POST).toBeGreaterThanOrEqual(2);
      expect(probe.transientRejectionsByTag.POST).toBeGreaterThanOrEqual(1);
      expect(probe.transientRejectionsByTag.PATCH).toBe(0);
      // Only the winner reached the audit write, under its own context.
      expect(probe.auditWriteTags).toEqual(['PATCH']);

      expect(normalise(await storedPlan())).toEqual(normalise(expectedToggleFirst())); // (a)
      await expectNoLostUpdate(patchRes, postRes); // (b)
      expect(await auditSources()).toEqual([SOURCE_EXPENSE]); // (c)
    }, RACE_TEST_TIMEOUT_MS);

    it('case 4 — overlap, revision holds first: POST 200, PATCH retries and gets 200 (never 500)', async () => {
      probe.holdTag = 'POST';
      const postP = revisionPost();
      await withSafetyTimeout(probe.parked, 'parked', true);
      const patchP = togglePatch();
      const [postRes, patchRes] = await Promise.all([postP, patchP]);

      expectNoProbeFailures();
      expect(postRes.status).toBe(200);
      expect(postRes.body.success).toBe(true);
      expect(patchRes).toEqual(TOGGLE_OK);
      expect(probe.callsByTag.POST).toBe(1);
      expect(probe.callsByTag.PATCH).toBeGreaterThanOrEqual(2);
      expect(probe.transientRejectionsByTag.PATCH).toBeGreaterThanOrEqual(1);
      expect(probe.transientRejectionsByTag.POST).toBe(0);
      // ALS sanity: the loser's successful RETRY attempt (a later withTransaction callback run) still carries
      // its own tag, and commits after the winner.
      expect(probe.auditWriteTags).toEqual(['POST', 'PATCH']);

      expect(normalise(await storedPlan())).toEqual(normalise(expectedRevisionFirst())); // (a)
      await expectNoLostUpdate(patchRes, postRes); // (b)
      expect(await auditSources()).toEqual([SOURCE_REVISION, SOURCE_EXPENSE].sort()); // (c)
    }, RACE_TEST_TIMEOUT_MS);
  }
});
