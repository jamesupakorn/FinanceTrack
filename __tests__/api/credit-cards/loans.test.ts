/** @jest-environment node */
// Loan slice S2 — API coverage for cardType, loan plan validation, the one-plan-per-loan guard,
// the 3-digit installment key end to end, offset 0 for loans, the loan row label, and the
// revolving/spend-item write guards (AC-LN-01…04, 06…10, 13…15, 17).
//
// Every case runs twice: JSON mode (real JSON store in a temp AUDIT_DATA_DIR) and Mongo mode
// (in-process MongoDB). The store passes cards/plans through whole in both modes, so the same
// assertions must hold for each.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMocks } from 'node-mocks-http';
import type { RequestMethod } from 'node-mocks-http';
import type { NextApiHandler } from 'next';
import type { Db } from 'mongodb';
import { MongoMemoryServer } from '../../helpers/mongoReplSet';
import { buildInstallmentRowKey, round2 } from '../../../src/shared/utils/creditCardUtils';

type Mode = 'json' | 'mongo';
type Row = Record<string, unknown>;
type CreditDoc = { cards: Row[]; plans: Row[]; cycles: Row[]; spendItems: Row[] };
type Handlers = {
  cards: NextApiHandler;
  plans: NextApiHandler;
  revolving: NextApiHandler;
  spendItems: NextApiHandler;
  monthlyExpense: NextApiHandler;
};

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'loan-user-a';
const JSON_FILENAME = 'credit_cards.json';

const LOAN_ID = 'cc_10a010a010a0';
const CARD_ID = 'cc_c0ffee000001';

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

function makePlan(cardId: string, id: string, overrides: Row = {}): Row {
  return {
    id,
    cardId,
    itemName: 'ของ',
    totalPrice: 300,
    months: 1,
    startMonth: '2026-12',
    interestMode: 'manual',
    manualFeePerMonth: 0,
    annualRate: 0,
    calcMethod: null,
    monthlyPayment: 300,
    totalInterest: 0,
    totalPayable: 300,
    schedule: [{ no: 1, dueMonth: '2026-12', payment: 300, principal: 300, interest: 0, paid: false, paidAt: null, paidSource: null }],
    status: 'ongoing',
    cancelledAt: null,
    createdAt: 'n',
    updatedAt: 'n',
    ...overrides
  };
}

const LOAN_PLAN_INPUT = {
  cardId: LOAN_ID,
  itemName: 'บ้านหลังแรก',
  totalPrice: 1000000,
  months: 240,
  startMonth: '2026-12',
  purchaseDate: '2026-11-15',
  interestMode: 'calculated',
  annualRate: 6,
  calcMethod: 'effective'
};

describe.each<Mode>(['json', 'mongo'])('loan cards — %s mode', (mode) => {
  let handlers: Handlers;
  let sessionCookie: typeof import('../../../src/shared/utils/backend/sessionCookie');
  let dir = '';
  let mongod: MongoMemoryServer | null = null;
  let db: Db | null = null;

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    if (mode === 'json') {
      process.env.DATA_MODE = 'json';
      delete process.env.MONGODB_URI;
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loan-json-'));
      process.env.AUDIT_DATA_DIR = dir;
    } else {
      mongod = await MongoMemoryServer.create();
      process.env.MONGODB_URI = mongod.getUri();
      process.env.DATA_MODE = 'mongo';
      delete process.env.AUDIT_DATA_DIR;
    }

    jest.resetModules();
    handlers = {
      cards: require('../../../pages/api/credit-cards/index').default,
      plans: require('../../../pages/api/credit-cards/plans').default,
      revolving: require('../../../pages/api/credit-cards/revolving').default,
      spendItems: require('../../../pages/api/credit-cards/spend-items').default,
      monthlyExpense: require('../../../pages/api/monthly_expense').default
    };
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
      await db.collection('monthly_expense').deleteMany({});
    }
  });

  async function seed({ cards = [], plans = [], cycles = [], spendItems = [] }: Partial<CreditDoc> = {}) {
    const doc = { cards, plans, cycles, spendItems, updatedAt: '2026-01-01T00:00:00.000Z' };
    if (mode === 'json') {
      fs.writeFileSync(path.join(dir, JSON_FILENAME), JSON.stringify({ [USER_A]: doc }));
    } else {
      await db!.collection('credit_cards').updateOne({ userId: USER_A }, { $set: { userId: USER_A, ...doc } }, { upsert: true });
    }
  }

  async function readDoc(): Promise<CreditDoc & { updatedAt?: string }> {
    if (mode === 'json') {
      const file = path.join(dir, JSON_FILENAME);
      if (!fs.existsSync(file)) return { cards: [], plans: [], cycles: [], spendItems: [] };
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))[USER_A] ?? {};
      return { cards: [], plans: [], cycles: [], spendItems: [], ...parsed };
    }
    const doc = await db!.collection('credit_cards').findOne({ userId: USER_A });
    return { cards: [], plans: [], cycles: [], spendItems: [], ...(doc ?? {}) } as unknown as CreditDoc;
  }

  async function call(handler: NextApiHandler, method: RequestMethod, { body, query = {} }: { body?: Row; query?: Record<string, string> } = {}) {
    const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
    const sid = createSessionId();
    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const { req, res } = createMocks({
      method,
      query,
      body,
      cookies: { [SESSION_COOKIE_NAME]: signSession(USER_A, sid) },
      headers: mutating ? { 'x-csrf-token': signCsrfToken(sid) } : {}
    });
    await handler(req, res);
    const raw = res._getData();
    return { status: res._getStatusCode(), body: raw ? JSON.parse(raw) : null };
  }

  // --- card type ------------------------------------------------------------------------------

  it('AC-LN-01: GET defaults a stored card without cardType to credit_card and leaves the document unchanged', async () => {
    await seed({ cards: [makeCard()] });
    const before = await readDoc();

    const res = await call(handlers.cards, 'GET');

    expect(res.status).toBe(200);
    expect(res.body.cards[0].cardType).toBe('credit_card');
    const after = await readDoc();
    expect(after.cards).toEqual(before.cards);
    expect('cardType' in after.cards[0]).toBe(false);
  });

  it('AC-LN-02: POST create home_loan stores the type and forces creditLimit 0', async () => {
    const res = await call(handlers.cards, 'POST', {
      body: { card: { name: 'บ้าน', cardType: 'home_loan', creditLimit: 90000, statementDay: 'EOM', dueDay: 5 } }
    });

    expect(res.status).toBe(200);
    expect(res.body.card).toMatchObject({ cardType: 'home_loan', creditLimit: 0 });
    const stored = (await readDoc()).cards;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ cardType: 'home_loan', creditLimit: 0 });
  });

  it('E-2: POST create without cardType stores credit_card', async () => {
    const res = await call(handlers.cards, 'POST', { body: { card: { name: 'A', creditLimit: 1000 } } });
    expect(res.status).toBe(200);
    expect((await readDoc()).cards[0]).toMatchObject({ cardType: 'credit_card', creditLimit: 1000 });
  });

  it('AC-LN-03: POST create with an invalid cardType → 400 errors.cardType, nothing written', async () => {
    const res = await call(handlers.cards, 'POST', { body: { card: { name: 'A', cardType: 'car_loan' } } });

    expect(res.status).toBe(400);
    expect(res.body.errors.cardType).toBeTruthy();
    expect((await readDoc()).cards).toEqual([]);
  });

  it('AC-LN-04: edit changing cardType → 409, nothing written; edit without cardType keeps home_loan', async () => {
    await seed({ cards: [makeLoan()] });
    const before = await readDoc();

    const changed = await call(handlers.cards, 'POST', { body: { card: { id: LOAN_ID, name: 'ใหม่', cardType: 'credit_card' } } });
    expect(changed.status).toBe(409);
    expect(changed.body).toEqual({ error: 'cardType cannot change' });
    expect((await readDoc()).cards).toEqual(before.cards);

    const renamed = await call(handlers.cards, 'POST', { body: { card: { id: LOAN_ID, name: 'ใหม่', creditLimit: 50000, statementDay: 'EOM', dueDay: 5 } } });
    expect(renamed.status).toBe(200);
    const stored = (await readDoc()).cards[0];
    expect(stored).toMatchObject({ name: 'ใหม่', cardType: 'home_loan', creditLimit: 0 }); // E-4
  });

  it('edit of a legacy card with cardType credit_card is allowed; with a loan type → 409', async () => {
    await seed({ cards: [makeCard()] });
    expect((await call(handlers.cards, 'POST', { body: { card: { id: CARD_ID, name: 'X', cardType: 'credit_card' } } })).status).toBe(200);
    expect((await call(handlers.cards, 'POST', { body: { card: { id: CARD_ID, name: 'Y', cardType: 'personal_loan' } } })).status).toBe(409);
    expect((await readDoc()).cards[0].name).toBe('X');
  });

  // --- plans ----------------------------------------------------------------------------------

  it('AC-LN-06: loan plan 480 months → 200 with 480 rows; 481 → 400 1–480; credit card 61 → 400 1–60', async () => {
    await seed({ cards: [makeLoan(), makeCard()] });

    const over = await call(handlers.plans, 'POST', { body: { plan: { ...LOAN_PLAN_INPUT, months: 481 } } });
    expect(over.status).toBe(400);
    expect(over.body.errors.months).toBe('จำนวนงวดต้องอยู่ระหว่าง 1–480');

    const ok = await call(handlers.plans, 'POST', { body: { plan: { ...LOAN_PLAN_INPUT, months: 480 } } });
    expect(ok.status).toBe(200);
    expect(ok.body.plan.schedule).toHaveLength(480);
    expect(ok.body.plan.currentRate).toBe(6);
    expect(ok.body.plan.rateRevisionCount).toBe(0);

    const card = await call(handlers.plans, 'POST', { body: { plan: { ...LOAN_PLAN_INPUT, cardId: CARD_ID, months: 61 } } });
    expect(card.status).toBe(400);
    expect(card.body.errors.months).toBe('จำนวนงวดต้องอยู่ระหว่าง 1–60');
    expect((await readDoc()).plans).toHaveLength(1);
  });

  it.each([
    ['manual', { interestMode: 'manual', manualFeePerMonth: 0 }, 'interestMode'],
    ['flat', { calcMethod: 'flat' }, 'calcMethod']
  ])('AC-LN-07: loan plan with %s → 400, nothing written', async (_label, override, field) => {
    await seed({ cards: [makeLoan()] });
    const res = await call(handlers.plans, 'POST', { body: { plan: { ...LOAN_PLAN_INPUT, ...override } } });
    expect(res.status).toBe(400);
    expect(res.body.errors[field]).toBe('สินเชื่อคำนวณแบบลดต้นลดดอกเท่านั้น');
    expect((await readDoc()).plans).toEqual([]);
  });

  it('AC-LN-08: 1,000,000 / 240 / 6% effective → first row 7164.31 = 5000.00 + 2164.31, sums reconcile', async () => {
    await seed({ cards: [makeLoan()] });
    const res = await call(handlers.plans, 'POST', { body: { plan: LOAN_PLAN_INPUT } });

    expect(res.status).toBe(200);
    const { schedule, totalPayable } = res.body.plan;
    expect(schedule[0]).toMatchObject({ payment: 7164.31, interest: 5000, principal: 2164.31 });
    const sumPrincipal = round2(schedule.reduce((sum: number, row: Row) => sum + Number(row.principal), 0));
    const sumPayment = round2(schedule.reduce((sum: number, row: Row) => sum + Number(row.payment), 0));
    expect(sumPrincipal).toBe(1000000);
    expect(sumPayment).toBe(totalPayable);
  });

  it.each(['ongoing', 'completed', 'cancelled_early'])('AC-LN-09: second plan on a loan with a %s plan → 409, nothing written', async (status) => {
    await seed({ cards: [makeLoan()], plans: [makePlan(LOAN_ID, 'ip_10a000000001', { status })] });
    const res = await call(handlers.plans, 'POST', { body: { plan: LOAN_PLAN_INPUT } });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'loan already has a schedule' });
    expect((await readDoc()).plans).toHaveLength(1);
  });

  it('AC-LN-09: after hard-deleting a 0-paid loan plan, a new plan → 200', async () => {
    await seed({ cards: [makeLoan()], plans: [makePlan(LOAN_ID, 'ip_10a000000001')] });
    const del = await call(handlers.plans, 'DELETE', { body: { planId: 'ip_10a000000001', mode: 'delete' } });
    expect(del.status).toBe(200);

    const res = await call(handlers.plans, 'POST', { body: { plan: LOAN_PLAN_INPUT } });
    expect(res.status).toBe(200);
    expect((await readDoc()).plans).toHaveLength(1);
  });

  it('AC-LN-10: a credit card with 5 existing plans still accepts another (no one-plan rule)', async () => {
    const plans = [1, 2, 3, 4, 5].map(n => makePlan(CARD_ID, `ip_c0ffee00000${n}`));
    await seed({ cards: [makeCard()], plans });
    const res = await call(handlers.plans, 'POST', {
      body: { plan: { cardId: CARD_ID, itemName: 'ทีวี', totalPrice: 1200, months: 12, startMonth: '2026-12', purchaseDate: '2026-11-15' } }
    });
    expect(res.status).toBe(200);
    expect((await readDoc()).plans).toHaveLength(6);
  });

  it('PUT moving a credit-card plan onto a loan that already has a schedule → 409 (BR-CC-034)', async () => {
    await seed({
      cards: [makeLoan(), makeCard()],
      plans: [makePlan(LOAN_ID, 'ip_10a000000001'), makePlan(CARD_ID, 'ip_c0ffee000001')]
    });
    const res = await call(handlers.plans, 'PUT', { body: { planId: 'ip_c0ffee000001', patch: { cardId: LOAN_ID, totalPrice: 400 } } });
    expect(res.status).toBe(409);
    expect((await readDoc()).plans[1].cardId).toBe(CARD_ID);
  });

  it('PUT financial edit on a loan plan is validated as a loan (481 → 400, flat → 400, 300 → 200)', async () => {
    await seed({ cards: [makeLoan()] });
    const created = await call(handlers.plans, 'POST', { body: { plan: { ...LOAN_PLAN_INPUT, months: 12 } } });
    const planId = created.body.plan.id;

    expect((await call(handlers.plans, 'PUT', { body: { planId, patch: { months: 481 } } })).status).toBe(400);
    expect((await call(handlers.plans, 'PUT', { body: { planId, patch: { calcMethod: 'flat' } } })).status).toBe(400);
    const ok = await call(handlers.plans, 'PUT', { body: { planId, patch: { months: 300 } } });
    expect(ok.status).toBe(200);
    expect(ok.body.plan.schedule).toHaveLength(300);
  });

  // --- keys / due dates / rows ----------------------------------------------------------------

  it('AC-LN-13: PATCH /api/monthly_expense with a 3-digit cci_ key marks row 150 paid', async () => {
    await seed({ cards: [makeLoan()] });
    const created = await call(handlers.plans, 'POST', { body: { plan: LOAN_PLAN_INPUT } });
    const planId: string = created.body.plan.id;
    const row150 = created.body.plan.schedule[149];
    const key = buildInstallmentRowKey(planId, 150);
    expect(key).toMatch(/_150$/);

    const res = await call(handlers.monthlyExpense, 'PATCH', { body: { month: row150.dueMonth, key, paid: true } });

    expect(res.status).toBe(200);
    const stored = (await readDoc()).plans[0].schedule as Row[];
    expect(stored[149]).toMatchObject({ no: 150, paid: true, paidSource: 'expense_table' });
    expect(stored.filter(row => row.paid === true)).toHaveLength(1);
  });

  it('AC-LN-14: GET /api/credit-cards nextDueDate uses offset 0 for a loan, unchanged for a card', async () => {
    await seed({
      cards: [makeLoan(), makeCard()],
      plans: [makePlan(LOAN_ID, 'ip_10a000000001'), makePlan(CARD_ID, 'ip_c0ffee000001')]
    });
    const res = await call(handlers.cards, 'GET');
    const byId = Object.fromEntries((res.body.cards as Row[]).map(card => [card.id, card]));
    expect(byId[LOAN_ID].nextDueDate).toBe('2026-12-05');
    expect(byId[CARD_ID].nextDueDate).toBe('2027-01-05');
  });

  it('AC-LN-15: GET /api/monthly_expense loan row uses the loan rowPrefix; card row unchanged', async () => {
    await seed({
      cards: [makeLoan(), makeCard({ statementDay: 10, dueDay: 25 })],
      plans: [makePlan(LOAN_ID, 'ip_10a000000001'), makePlan(CARD_ID, 'ip_c0ffee000001')]
    });
    const res = await call(handlers.monthlyExpense, 'GET', { query: { month: '2026-12' } });

    expect(res.status).toBe(200);
    const loanRow = res.body.ccr_10a010a010a0;
    expect(loanRow).toMatchObject({ name: 'ค่างวดสินเชื่อบ้าน บ้านหลังแรก', actual: 300, cardType: 'home_loan' });
    expect(loanRow.breakdown.installments[0].key).toBe(buildInstallmentRowKey('ip_10a000000001', 1));
    expect(res.body.ccr_c0ffee000001).toMatchObject({ name: 'ยอดบัตร บัตร A', cardType: 'credit_card' });
  });

  // --- no revolving on loans ------------------------------------------------------------------

  it('AC-LN-17: POST /revolving is still 400 newSpend_removed for a loan, same as for a card', async () => {
    await seed({ cards: [makeLoan(), makeCard()] });
    const loan = await call(handlers.revolving, 'POST', { body: { cardId: LOAN_ID, month: '2026-12', newSpend: 100 } });
    const card = await call(handlers.revolving, 'POST', { body: { cardId: CARD_ID, month: '2026-12', newSpend: 100 } });
    expect(loan).toEqual(card);
    expect(loan.status).toBe(400);
    expect(loan.body.error).toBe('newSpend_removed');
  });

  it('AC-LN-17: PATCH /revolving on a loan → 409, nothing written; on a card → 200', async () => {
    await seed({ cards: [makeLoan(), makeCard()] });
    const before = await readDoc();

    const loan = await call(handlers.revolving, 'PATCH', { body: { cardId: LOAN_ID, month: '2026-12', paymentAction: 'full' } });
    expect(loan.status).toBe(409);
    expect(loan.body).toEqual({ error: 'loan cards have no revolving balance' });
    const afterLoan = await readDoc();
    expect(afterLoan.cycles).toEqual([]);
    expect(afterLoan.updatedAt).toBe(before.updatedAt);

    const card = await call(handlers.revolving, 'PATCH', { body: { cardId: CARD_ID, month: '2026-12', paymentAction: 'full' } });
    expect(card.status).toBe(200);
    expect((await readDoc()).cycles).toHaveLength(1);
  });

  it('AC-LN-17: POST /spend-items on a loan → 409, nothing written; on a card → 201', async () => {
    await seed({ cards: [makeLoan(), makeCard()] });

    const loan = await call(handlers.spendItems, 'POST', { body: { item: { cardId: LOAN_ID, purchaseDate: '2026-12-01', name: 'x', amount: 10 } } });
    expect(loan.status).toBe(409);
    expect(loan.body).toEqual({ error: 'loan cards have no revolving balance' });
    expect((await readDoc()).spendItems).toEqual([]);

    const card = await call(handlers.spendItems, 'POST', { body: { item: { cardId: CARD_ID, purchaseDate: '2026-12-01', name: 'x', amount: 10 } } });
    expect(card.status).toBe(201);
  });

  it('AC-LN-17: PUT /spend-items on a stray loan item → 409, unchanged; DELETE still allowed', async () => {
    const stray = { id: 'si_10a000000001', cardId: LOAN_ID, month: '2026-12', purchaseDate: '2026-12-01', name: 'x', amount: 10, source: 'user', createdAt: 'n', updatedAt: 'n' };
    await seed({ cards: [makeLoan()], spendItems: [stray] });

    const put = await call(handlers.spendItems, 'PUT', { body: { item: { id: stray.id, amount: 99 } } });
    expect(put.status).toBe(409);
    expect((await readDoc()).spendItems[0]).toMatchObject({ amount: 10 });

    const del = await call(handlers.spendItems, 'DELETE', { body: { id: stray.id } });
    expect(del.status).toBe(200);
    expect((await readDoc()).spendItems).toEqual([]);
  });

  // --- S4 D2: PUT guard for plans with rate revisions (AC-LN-22, N-1) --------------------------

  const REVISION = { effectiveMonth: '2027-01', fromInstallmentNo: 2, previousRate: 6, newRate: 7, revisedAt: '2026-12-15T00:00:00.000Z' };

  function makeRevisedLoanPlan(id: string, { paidFirst = false }: { paidFirst?: boolean } = {}): Row {
    return makePlan(LOAN_ID, id, {
      totalPrice: 600,
      months: 2,
      monthlyPayment: 300,
      totalPayable: 600,
      schedule: [
        { no: 1, dueMonth: '2026-12', payment: 300, principal: 300, interest: 0, paid: paidFirst, paidAt: paidFirst ? '2026-12-05' : null, paidSource: paidFirst ? 'user' : null },
        { no: 2, dueMonth: '2027-01', payment: 300, principal: 300, interest: 0, paid: false, paidAt: null, paidSource: null }
      ],
      rateRevisions: [REVISION]
    });
  }

  it('N-1: plan with a paid row AND a rate revision → financial PUT returns the rate-revision 409, not the paid body', async () => {
    const plan = makeRevisedLoanPlan('ip_10a0000000n1', { paidFirst: true });
    await seed({ cards: [makeLoan()], plans: [plan] });

    const res = await call(handlers.plans, 'PUT', { body: { planId: 'ip_10a0000000n1', patch: { months: 5 } } });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'plan has rate revisions' });
    expect((await readDoc()).plans[0]).toMatchObject({ months: 2, schedule: plan.schedule, rateRevisions: [REVISION] });
  });

  it('AC-LN-22: after a revision, PUT { totalPrice: 900000 } → 409 plan has rate revisions; PUT { itemName } → 200', async () => {
    const plan = makeRevisedLoanPlan('ip_10a000000022');
    await seed({ cards: [makeLoan()], plans: [plan] });

    const blocked = await call(handlers.plans, 'PUT', { body: { planId: 'ip_10a000000022', patch: { totalPrice: 900000 } } });
    expect(blocked.status).toBe(409);
    expect(blocked.body).toEqual({ error: 'plan has rate revisions' });
    expect((await readDoc()).plans[0]).toMatchObject({ totalPrice: 600, schedule: plan.schedule });

    const renamed = await call(handlers.plans, 'PUT', { body: { planId: 'ip_10a000000022', patch: { itemName: 'x' } } });
    expect(renamed.status).toBe(200);
    expect(renamed.body.plan).toMatchObject({ itemName: 'x', rateRevisionCount: 1 });
    const stored = (await readDoc()).plans[0];
    expect(stored).toMatchObject({ itemName: 'x', totalPrice: 600, schedule: plan.schedule, rateRevisions: [REVISION] });
  });

  it('credit-card plan with no rateRevisions field: financial PUT response shape is unchanged (no rateRevisions key added)', async () => {
    await seed({ cards: [makeCard()], plans: [makePlan(CARD_ID, 'ip_c0ffee0000d2')] });

    const res = await call(handlers.plans, 'PUT', { body: { planId: 'ip_c0ffee0000d2', patch: { months: 2 } } });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['success', 'plan']);
    expect(Object.keys(res.body.plan)).toEqual([
      'id', 'cardId', 'itemName', 'totalPrice', 'months', 'startMonth', 'interestMode', 'manualFeePerMonth',
      'annualRate', 'calcMethod', 'monthlyPayment', 'totalInterest', 'totalPayable', 'schedule', 'status',
      'cancelledAt', 'createdAt', 'updatedAt', 'installmentsPaid', 'installmentsRemaining', 'progressPercent',
      'nextUnpaid', 'remainingPayable', 'remainingPrincipal', 'currentRate', 'rateRevisionCount'
    ]);
    expect(res.body.plan).toMatchObject({ months: 2, monthlyPayment: 150, totalPayable: 300, rateRevisionCount: 0 });
    expect('rateRevisions' in (await readDoc()).plans[0]).toBe(false);
  });
});
