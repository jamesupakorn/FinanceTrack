/** @jest-environment node */
// Loan slice S4 / D3 — POST /api/credit-cards/rate-revisions (spec loan-installments §I-4, BR-CC-039/040,
// ADR-034). Covers AC-LN-18…21, 23, 24, E-13…E-18, N-2, the MAX_RATE_REVISIONS_PER_PLAN cap, 405 on
// every other method, and per-user isolation.
//
// Every case runs twice: JSON mode (real JSON store + audit journal in a temp AUDIT_DATA_DIR) and Mongo
// mode (in-process replica set, so withAudit runs in a real transaction). Every failure case asserts that
// the credit document is unchanged and that no audit event was written (ADR-029).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMocks } from 'node-mocks-http';
import type { RequestMethod } from 'node-mocks-http';
import type { NextApiHandler } from 'next';
import type { Db } from 'mongodb';
import { MongoMemoryServer } from '../../helpers/mongoReplSet';
import {
  buildEffectiveSchedule,
  buildSchedule,
  round2,
  MAX_RATE_REVISIONS_PER_PLAN
} from '../../../src/shared/utils/creditCardUtils';
import { reviseEffectiveScheduleTail } from '../../../src/shared/utils/creditCardAmortization';
import { summarisePlan } from '../../../src/shared/utils/creditCardRevolving';
import { computeLoanRateRevisionPreview } from '../../../src/frontend/components/LoanRateRevisionDialog';
import { buildRevisionFixturePlan, REVISION_FIXTURE_INPUTS } from '../../helpers/loanRateRevisionFixture';

type Mode = 'json' | 'mongo';
type Row = Record<string, unknown>;
type ScheduleRow = { no: number; dueMonth: string; payment: number; principal: number; interest: number; paid?: boolean; paidAt?: string | null; paidSource?: string | null };
type CreditDoc = { cards: Row[]; plans: Row[]; cycles: Row[]; spendItems: Row[]; updatedAt?: string };

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'rr-user-a';
const USER_B = 'rr-user-b';
const JSON_FILENAME = 'credit_cards.json';
const AUDIT_JOURNAL = 'audit_journal.json';
const SOURCE = 'credit_card_rate_revisions';

const LOAN_ID = 'cc_10a010a010a0';
const CARD_ID = 'cc_c0ffee000001';
const LOAN_PLAN_ID = 'ip_aaaaaaaaaaaa';
const CARD_PLAN_ID = 'ip_bbbbbbbbbbbb';
const PAID_AT = '2027-01-10T03:00:00.000Z';

const LOAN_INPUT = {
  totalPrice: 1000000,
  months: 240,
  startMonth: '2026-12',
  interestMode: 'calculated',
  annualRate: 6,
  calcMethod: 'effective'
};

function makeCard(overrides: Row = {}): Row {
  return {
    id: CARD_ID,
    name: 'บัตร A',
    creditLimit: 50000,
    annualRate: 16,
    minPaymentPercent: 10,
    statementDay: 'EOM',
    dueDay: 5,
    color: '#5d5bff',
    bankName: '',
    last4: '',
    ...overrides
  };
}

function makeLoan(overrides: Row = {}): Row {
  return makeCard({ id: LOAN_ID, name: 'บ้านหลังแรก', creditLimit: 0, cardType: 'home_loan', ...overrides });
}

/** AC-LN-08 loan (1,000,000 / 240 / 6% effective), rows 1…paidCount paid. Schedule built by the real builder. */
function makeLoanPlan({ paidCount = 0, overrides = {} }: { paidCount?: number; overrides?: Row } = {}): Row {
  const computed = buildSchedule(LOAN_INPUT);
  const schedule = computed.schedule.map(row => (row.no <= paidCount
    ? { ...row, paid: true, paidAt: PAID_AT, paidSource: 'credit_card' }
    : { ...row, paid: false, paidAt: null, paidSource: null }));
  return {
    id: LOAN_PLAN_ID,
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
    updatedAt: '2026-11-15T00:00:00.000Z',
    ...overrides
  };
}

function makeCardPlan(): Row {
  return makeLoanPlan({ overrides: { id: CARD_PLAN_ID, cardId: CARD_ID, itemName: 'มือถือ', months: 240 } });
}

function revisionsAt(count: number, effectiveMonth: string): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `rr_${String(i).padStart(12, '0')}`,
    effectiveMonth,
    fromInstallmentNo: 1,
    previousRate: 6,
    newRate: 6,
    revisedAt: '2026-11-20T00:00:00.000Z'
  }));
}

const scheduleOf = (plan: Row) => plan.schedule as ScheduleRow[];

describe.each<Mode>(['json', 'mongo'])('POST /api/credit-cards/rate-revisions — %s mode', (mode) => {
  let handler: NextApiHandler;
  let sessionCookie: typeof import('../../../src/shared/utils/backend/sessionCookie');
  let dir = '';
  let mongod: MongoMemoryServer | null = null;
  let db: Db | null = null;

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    if (mode === 'json') {
      process.env.DATA_MODE = 'json';
      delete process.env.MONGODB_URI;
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rate-rev-json-'));
      process.env.AUDIT_DATA_DIR = dir;
    } else {
      mongod = await MongoMemoryServer.create();
      process.env.MONGODB_URI = mongod.getUri();
      process.env.DATA_MODE = 'mongo';
      delete process.env.AUDIT_DATA_DIR;
    }

    jest.resetModules();
    handler = require('../../../pages/api/credit-cards/rate-revisions').default;
    sessionCookie = require('../../../src/shared/utils/backend/sessionCookie');
    if (mode === 'mongo') db = await require('../../../lib/mongodb').getDbPromise();
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
    } else if (db) {
      await db.collection('credit_cards').deleteMany({});
      await db.collection('audit_logs').deleteMany({});
    }
  });

  async function seed(docs: Record<string, Partial<CreditDoc>>) {
    const full = Object.fromEntries(Object.entries(docs).map(([userId, doc]) => [userId, {
      cards: [], plans: [], cycles: [], spendItems: [], updatedAt: '2026-01-01T00:00:00.000Z', ...doc
    }]));
    if (mode === 'json') {
      fs.writeFileSync(path.join(dir, JSON_FILENAME), JSON.stringify(full));
      return;
    }
    for (const [userId, doc] of Object.entries(full)) {
      await db!.collection('credit_cards').updateOne({ userId }, { $set: { userId, ...doc } }, { upsert: true });
    }
  }

  const seedA = (doc: Partial<CreditDoc>) => seed({ [USER_A]: doc });

  async function readDoc(userId = USER_A): Promise<CreditDoc> {
    if (mode === 'json') {
      const file = path.join(dir, JSON_FILENAME);
      const parsed = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8'))[userId] ?? {} : {};
      return { cards: [], plans: [], cycles: [], spendItems: [], ...parsed };
    }
    const doc = await db!.collection('credit_cards').findOne({ userId });
    return { cards: [], plans: [], cycles: [], spendItems: [], ...(doc ?? {}) } as unknown as CreditDoc;
  }

  async function auditEvents(): Promise<Row[]> {
    if (mode === 'json') {
      const file = path.join(dir, AUDIT_JOURNAL);
      return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')).events ?? []) : [];
    }
    return (await db!.collection('audit_logs').find({}).toArray()) as unknown as Row[];
  }

  async function call(method: RequestMethod, body?: Row, { userId = USER_A as string | null, csrf = true } = {}) {
    const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
    const sid = createSessionId();
    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const { req, res } = createMocks({
      method,
      body,
      cookies: userId ? { [SESSION_COOKIE_NAME]: signSession(userId, sid) } : {},
      headers: mutating && csrf ? { 'x-csrf-token': signCsrfToken(sid) } : {}
    });
    await handler(req, res);
    const raw = res._getData();
    return { status: res._getStatusCode(), body: raw ? JSON.parse(raw) : null, allow: res.getHeader('Allow') };
  }

  const post = (body: Row) => call('POST', body);

  /** ADR-029 / AC-LN-24: a failed request leaves the document byte-equal and writes no audit event. */
  async function expectNothingWritten(before: CreditDoc, userId = USER_A) {
    expect(await readDoc(userId)).toEqual(before);
    expect(await auditEvents()).toEqual([]);
  }

  async function expectRejected(body: Row, status: number, error: string) {
    const before = await readDoc();
    const res = await post(body);
    expect(res.status).toBe(status);
    expect(res.body.error).toBe(error);
    await expectNothingWritten(before);
  }

  // --- success path -----------------------------------------------------------------------------

  it('AC-LN-18 + AC-LN-24: rows 1–12 unchanged, rows 13–240 recomputed at 7%, one revision record, one audit event', async () => {
    const plan = makeLoanPlan({ paidCount: 12 });
    await seedA({ cards: [makeLoan()], plans: [plan] });
    const original = scheduleOf(plan);
    const row13 = original[12];

    const res = await post({ planId: LOAN_PLAN_ID, effectiveMonth: row13.dueMonth, annualRate: 7 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const stored = (await readDoc()).plans[0];
    const schedule = scheduleOf(stored);
    expect(schedule).toHaveLength(240);
    // rows 1–12 deep-equal their pre-revision values, including paid/paidAt/paidSource
    expect(schedule.slice(0, 12)).toEqual(original.slice(0, 12));

    const paidPrincipal = original.slice(0, 12).reduce((sum, row) => sum + row.principal, 0);
    const B = round2(1e6 - paidPrincipal);
    const expectedTail = buildEffectiveSchedule({ totalPrice: B, months: 228, startMonth: row13.dueMonth, annualRate: 7 })
      .schedule.map(row => ({ ...row, no: row.no + 12 }));
    expect(schedule.slice(12)).toEqual(expectedTail);

    expect(round2(schedule.reduce((sum, row) => sum + row.principal, 0))).toBe(1000000);
    expect(round2(schedule.reduce((sum, row) => sum + row.payment, 0))).toBe(stored.totalPayable);
    expect(round2(schedule.reduce((sum, row) => sum + row.interest, 0))).toBe(stored.totalInterest);
    expect(stored.annualRate).toBe(7);
    expect(stored.monthlyPayment).toBe(schedule[12].payment);

    for (const field of ['months', 'totalPrice', 'startMonth', 'purchaseDate', 'itemName', 'status', 'cardId', 'interestMode', 'calcMethod', 'createdAt']) {
      expect(stored[field]).toEqual(plan[field]);
    }

    const revisions = stored.rateRevisions as Row[];
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toEqual({
      id: expect.stringMatching(/^rr_[0-9a-f]{12}$/),
      effectiveMonth: row13.dueMonth,
      fromInstallmentNo: 13,
      previousRate: 6,
      newRate: 7,
      revisedAt: expect.any(String)
    });
    expect(Number.isNaN(Date.parse(revisions[0].revisedAt as string))).toBe(false);

    // response is summarisePlan(saved)
    expect(res.body.plan).toMatchObject({
      id: LOAN_PLAN_ID,
      annualRate: 7,
      currentRate: 7,
      rateRevisionCount: 1,
      monthlyPayment: stored.monthlyPayment,
      installmentsPaid: 12,
      nextUnpaid: { no: 13, dueMonth: row13.dueMonth, payment: schedule[12].payment }
    });
    expect(res.body.plan.schedule).toEqual(schedule);

    const events = await auditEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ source: SOURCE, subjectUserId: USER_A });
  });

  it('E-18: k = 1 with 0 paid recomputes the whole schedule and records the revision', async () => {
    await seedA({ cards: [makeLoan()], plans: [makeLoanPlan()] });

    const res = await post({ planId: LOAN_PLAN_ID, effectiveMonth: '2026-12', annualRate: '7' });

    expect(res.status).toBe(200);
    const stored = (await readDoc()).plans[0];
    const fresh = buildEffectiveSchedule({ ...LOAN_INPUT, annualRate: 7 });
    expect(stored.schedule).toEqual(fresh.schedule);
    expect(stored.monthlyPayment).toBe(fresh.monthlyPayment);
    expect(stored.totalPayable).toBe(fresh.totalPayable);
    expect(stored.rateRevisions).toEqual([expect.objectContaining({ fromInstallmentNo: 1, previousRate: 6, newRate: 7 })]);
    expect(await auditEvents()).toHaveLength(1);
  });

  it('E-16: rate 0 is allowed and takes the zero branch on the tail', async () => {
    await seedA({ cards: [makeLoan()], plans: [makeLoanPlan({ paidCount: 12 })] });

    const res = await post({ planId: LOAN_PLAN_ID, effectiveMonth: scheduleOf(makeLoanPlan())[12].dueMonth, annualRate: 0 });

    expect(res.status).toBe(200);
    const schedule = scheduleOf((await readDoc()).plans[0]);
    expect(schedule.slice(12).every(row => row.interest === 0)).toBe(true);
    expect(round2(schedule.reduce((sum, row) => sum + row.principal, 0))).toBe(1000000);
  });

  it('E-13: the first unpaid row right after a paid row is accepted', async () => {
    await seedA({ cards: [makeLoan()], plans: [makeLoanPlan({ paidCount: 1 })] });
    const res = await post({ planId: LOAN_PLAN_ID, effectiveMonth: scheduleOf(makeLoanPlan())[1].dueMonth, annualRate: 5.5 });
    expect(res.status).toBe(200);
    expect(res.body.plan.rateRevisions[0]).toMatchObject({ fromInstallmentNo: 2, newRate: 5.5 });
  });

  // --- AC-LN-19 / E-13: paid tail -----------------------------------------------------------------

  it('AC-LN-19: effectiveMonth at a paid row → 409, nothing written', async () => {
    await seedA({ cards: [makeLoan()], plans: [makeLoanPlan({ paidCount: 12 })] });
    await expectRejected(
      { planId: LOAN_PLAN_ID, effectiveMonth: scheduleOf(makeLoanPlan())[11].dueMonth, annualRate: 7 },
      409,
      'tail has paid installments'
    );
  });

  it('E-13: a paid row later in the tail → 409, nothing written', async () => {
    const plan = makeLoanPlan({ paidCount: 12 });
    scheduleOf(plan)[29] = { ...scheduleOf(plan)[29], paid: true, paidAt: PAID_AT, paidSource: 'expense_table' };
    await seedA({ cards: [makeLoan()], plans: [plan] });
    await expectRejected(
      { planId: LOAN_PLAN_ID, effectiveMonth: scheduleOf(plan)[12].dueMonth, annualRate: 7 },
      409,
      'tail has paid installments'
    );
  });

  // --- AC-LN-20 / E-15: monotone history ----------------------------------------------------------

  it('AC-LN-20: earlier than the latest revision → 409; equal month → 200 with two records', async () => {
    await seedA({ cards: [makeLoan()], plans: [makeLoanPlan()] });
    const months = scheduleOf(makeLoanPlan()).map(row => row.dueMonth);

    const first = await post({ planId: LOAN_PLAN_ID, effectiveMonth: months[19], annualRate: 7 });
    expect(first.status).toBe(200);
    expect(await auditEvents()).toHaveLength(1);

    const afterFirst = await readDoc();
    const earlier = await post({ planId: LOAN_PLAN_ID, effectiveMonth: months[14], annualRate: 8 });
    expect(earlier.status).toBe(409);
    expect(earlier.body.error).toBe('effectiveMonth is before the latest revision');
    expect(await readDoc()).toEqual(afterFirst);
    expect(await auditEvents()).toHaveLength(1);

    const equal = await post({ planId: LOAN_PLAN_ID, effectiveMonth: months[19], annualRate: 8 });
    expect(equal.status).toBe(200);
    const stored = (await readDoc()).plans[0];
    expect(stored.rateRevisions).toEqual([
      expect.objectContaining({ effectiveMonth: months[19], fromInstallmentNo: 20, previousRate: 6, newRate: 7 }),
      expect.objectContaining({ effectiveMonth: months[19], fromInstallmentNo: 20, previousRate: 7, newRate: 8 })
    ]);
    expect(stored.annualRate).toBe(8);
    // the first revision's head (rows 1–19) is untouched by the correction
    expect(scheduleOf(stored).slice(0, 19)).toEqual(scheduleOf(afterFirst.plans[0]).slice(0, 19));
    expect(await auditEvents()).toHaveLength(2);
  });

  // --- AC-LN-21 / E-16 / E-17: type, status, rate -------------------------------------------------

  it('AC-LN-21: a credit-card plan → 400, nothing written', async () => {
    await seedA({ cards: [makeCard()], plans: [makeCardPlan()] });
    await expectRejected({ planId: CARD_PLAN_ID, effectiveMonth: '2027-06', annualRate: 7 }, 400, 'rate revision is only for loans');
  });

  it('AC-LN-21 / E-17: a cancelled loan plan → 409, nothing written', async () => {
    await seedA({ cards: [makeLoan()], plans: [makeLoanPlan({ overrides: { status: 'cancelled_early', cancelledAt: PAID_AT } })] });
    await expectRejected({ planId: LOAN_PLAN_ID, effectiveMonth: '2027-06', annualRate: 7 }, 409, 'plan is not ongoing');
  });

  it('E-17: a completed loan plan → 409, nothing written', async () => {
    await seedA({ cards: [makeLoan()], plans: [makeLoanPlan({ paidCount: 240, overrides: { status: 'completed' } })] });
    await expectRejected({ planId: LOAN_PLAN_ID, effectiveMonth: '2027-06', annualRate: 7 }, 409, 'plan is not ongoing');
  });

  it('AC-LN-21 / E-16: the same rate (number or equivalent string) → 400, nothing written', async () => {
    await seedA({ cards: [makeLoan()], plans: [makeLoanPlan()] });
    await expectRejected({ planId: LOAN_PLAN_ID, effectiveMonth: '2027-06', annualRate: 6 }, 400, 'annualRate is unchanged');
    await expectRejected({ planId: LOAN_PLAN_ID, effectiveMonth: '2027-06', annualRate: '6.00' }, 400, 'annualRate is unchanged');
  });

  it('rate outside 0–100 → 400, nothing written', async () => {
    await seedA({ cards: [makeLoan()], plans: [makeLoanPlan()] });
    await expectRejected({ planId: LOAN_PLAN_ID, effectiveMonth: '2027-06', annualRate: 100.01 }, 400, 'annualRate must be between 0 and 100');
    await expectRejected({ planId: LOAN_PLAN_ID, effectiveMonth: '2027-06', annualRate: -1 }, 400, 'annualRate must be between 0 and 100');
  });

  // --- E-14 and shape checks ----------------------------------------------------------------------

  it('E-14: effectiveMonth that is no row\'s dueMonth (after the last row, before the first) → 400', async () => {
    await seedA({ cards: [makeLoan()], plans: [makeLoanPlan()] });
    await expectRejected({ planId: LOAN_PLAN_ID, effectiveMonth: '2046-12', annualRate: 7 }, 400, 'effectiveMonth is not an installment month');
    await expectRejected({ planId: LOAN_PLAN_ID, effectiveMonth: '2026-11', annualRate: 7 }, 400, 'effectiveMonth is not an installment month');
  });

  it('shape: missing planId, malformed month, or non-numeric rate → 400 before any read, nothing written', async () => {
    await seedA({ cards: [makeLoan()], plans: [makeLoanPlan()] });
    const before = await readDoc();

    const res = await post({ effectiveMonth: '2027-13', annualRate: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual({
      planId: expect.any(String),
      effectiveMonth: expect.any(String),
      annualRate: expect.any(String)
    });
    expect((await post({ planId: LOAN_PLAN_ID, effectiveMonth: '2027-06' })).status).toBe(400);
    expect((await post({ planId: LOAN_PLAN_ID, effectiveMonth: '2027-06', annualRate: { v: 7 } })).status).toBe(400);
    await expectNothingWritten(before);
  });

  it('unknown planId → 404, nothing written', async () => {
    await seedA({ cards: [makeLoan()], plans: [makeLoanPlan()] });
    await expectRejected({ planId: 'ip_000000000000', effectiveMonth: '2027-06', annualRate: 7 }, 404, 'plan not found');
  });

  // --- AC-LN-23: client money ignored -------------------------------------------------------------

  it('AC-LN-23: client schedule / money fields / fromInstallmentNo are ignored; stored values equal the server computation', async () => {
    const plan = makeLoanPlan({ paidCount: 12 });
    await seedA({ cards: [makeLoan()], plans: [plan] });
    const effectiveMonth = scheduleOf(plan)[12].dueMonth;

    const res = await post({
      planId: LOAN_PLAN_ID,
      effectiveMonth,
      annualRate: 7,
      schedule: [{ no: 1, dueMonth: '2026-12', payment: 1, principal: 1, interest: 0 }],
      monthlyPayment: 1,
      totalPayable: 1,
      totalInterest: 1,
      remainingPrincipal: 1,
      fromInstallmentNo: 1,
      previousRate: 99,
      rateRevisions: []
    });

    expect(res.status).toBe(200);
    const expected = reviseEffectiveScheduleTail(
      { totalPrice: 1000000, schedule: scheduleOf(plan) },
      { fromInstallmentNo: 13, annualRate: 7 }
    );
    if (!expected.ok) throw new Error('fixture should be revisable');
    const stored = (await readDoc()).plans[0];
    expect(stored.schedule).toEqual(expected.schedule);
    expect(stored.monthlyPayment).toBe(expected.monthlyPayment);
    expect(stored.totalPayable).toBe(expected.totalPayable);
    expect(stored.totalInterest).toBe(expected.totalInterest);
    expect('remainingPrincipal' in stored).toBe(false);
    expect(stored.rateRevisions).toEqual([expect.objectContaining({ fromInstallmentNo: 13, previousRate: 6 })]);
    // the derived echo in the response is recomputed from the stored rows, not the client value
    expect(res.body.plan.remainingPrincipal).toBe(round2(scheduleOf(stored).slice(12).reduce((s, r) => s + r.principal, 0)));
  });

  // --- N-2 ----------------------------------------------------------------------------------------

  it('N-2: a loan plan that is not calculated/effective → 409, nothing written', async () => {
    await seedA({ cards: [makeLoan()], plans: [makeLoanPlan({ overrides: { interestMode: 'manual' } })] });
    await expectRejected({ planId: LOAN_PLAN_ID, effectiveMonth: '2027-06', annualRate: 7 }, 409, 'rate revision requires an effective-rate loan plan');

    await seedA({ cards: [makeLoan()], plans: [makeLoanPlan({ overrides: { calcMethod: 'flat' } })] });
    await expectRejected({ planId: LOAN_PLAN_ID, effectiveMonth: '2027-06', annualRate: 7 }, 409, 'rate revision requires an effective-rate loan plan');
  });

  // --- cap ----------------------------------------------------------------------------------------

  it(`cap: ${MAX_RATE_REVISIONS_PER_PLAN} stored revisions → 409, nothing written; one below the cap → 200`, async () => {
    expect(MAX_RATE_REVISIONS_PER_PLAN).toBe(120);
    await seedA({ cards: [makeLoan()], plans: [makeLoanPlan({ overrides: { rateRevisions: revisionsAt(120, '2026-12') } })] });
    await expectRejected({ planId: LOAN_PLAN_ID, effectiveMonth: '2027-06', annualRate: 7 }, 409, 'rate revision limit reached (120)');

    await seedA({ cards: [makeLoan()], plans: [makeLoanPlan({ overrides: { rateRevisions: revisionsAt(119, '2026-12') } })] });
    const res = await post({ planId: LOAN_PLAN_ID, effectiveMonth: '2027-06', annualRate: 7 });
    expect(res.status).toBe(200);
    expect(res.body.plan.rateRevisionCount).toBe(120);
    // append-only: the 119 earlier records are preserved as-is
    expect(((await readDoc()).plans[0].rateRevisions as Row[]).slice(0, 119)).toEqual(revisionsAt(119, '2026-12'));
  });

  // --- method, auth, isolation --------------------------------------------------------------------

  it.each<RequestMethod>(['GET', 'PUT', 'PATCH', 'DELETE'])('%s → 405 with Allow: POST, nothing written', async (method) => {
    await seedA({ cards: [makeLoan()], plans: [makeLoanPlan()] });
    const before = await readDoc();

    const res = await call(method, { planId: LOAN_PLAN_ID, effectiveMonth: '2027-06', annualRate: 7 });

    expect(res.status).toBe(405);
    expect(res.allow).toEqual(['POST']);
    await expectNothingWritten(before);
  });

  it('no session → 401; missing CSRF token → 403; nothing written', async () => {
    await seedA({ cards: [makeLoan()], plans: [makeLoanPlan()] });
    const before = await readDoc();
    const body = { planId: LOAN_PLAN_ID, effectiveMonth: '2027-06', annualRate: 7 };

    expect((await call('POST', body, { userId: null })).status).toBe(401);
    expect((await call('POST', body, { csrf: false })).status).toBe(403);
    await expectNothingWritten(before);
  });

  it('another user\'s planId does not resolve → 404; neither document changes', async () => {
    await seed({
      [USER_A]: { cards: [makeLoan()], plans: [] },
      [USER_B]: { cards: [makeLoan()], plans: [makeLoanPlan()] }
    });
    const beforeA = await readDoc(USER_A);
    const beforeB = await readDoc(USER_B);

    const res = await post({ planId: LOAN_PLAN_ID, effectiveMonth: '2027-06', annualRate: 7 });

    expect(res.status).toBe(404);
    await expectNothingWritten(beforeA, USER_A);
    expect(await readDoc(USER_B)).toEqual(beforeB);
  });

  // AC-LN-25 (S4/D4): the dialog's preview function and this route share k-derivation and tail math (N-4).
  // Same shared fixture as LoanRateRevisionDialog.test.tsx, so a drift on either side fails here.
  it.each(REVISION_FIXTURE_INPUTS)('AC-LN-25: dialog preview new payment equals the saved monthlyPayment ($effectiveMonth @ $annualRate%)', async (input) => {
    const plan = buildRevisionFixturePlan();
    await seedA({ cards: [makeLoan()], plans: [plan] });

    const preview = computeLoanRateRevisionPreview(summarisePlan(plan) as unknown as Parameters<typeof computeLoanRateRevisionPreview>[0], input.effectiveMonth, input.annualRate);
    const res = await post({ planId: plan.id as string, effectiveMonth: input.effectiveMonth, annualRate: input.annualRate });

    expect(res.status).toBe(200);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const stored = (await readDoc()).plans[0];
    expect(preview.newPayment).toBe(res.body.plan.monthlyPayment);
    expect(preview.newPayment).toBe(stored.monthlyPayment);
    expect(preview.totalInterest).toBe(stored.totalInterest);
    expect(preview.fromInstallmentNo).toBe((stored.rateRevisions as Row[])[0].fromInstallmentNo);
  });
});
