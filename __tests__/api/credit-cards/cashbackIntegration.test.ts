/** @jest-environment node */
// Stage 4 tester additions for credit-card-cashback (cross-module integration).
// Covers spec cases that no other test exercises: edge 18 / N-3 (card delete gate reads the
// floored revolvingOutstanding), edge 29 (PATCH cashbackAmount 0 clears a stored value), the
// card API surfacing revolvingCredit without inflating availableCredit (BR-CC-031), the
// stored-'full' -> credit -> back-to-debt round trip (N-2 / R-5), and the ExpenseTable/LINE row
// builder (creditCardSync) seeing only the net, non-negative amountDue.
import { MongoMemoryServer } from '../../helpers/mongoReplSet';
import { createMocks } from 'node-mocks-http';
import { getCurrentMonthKey, addMonths } from '../../../src/shared/utils/creditCardUtils';
import { buildRevolvingExpenseRows, getCreditCardMonths } from '../../../src/shared/utils/backend/creditCardSync';
import type { Db, Document } from 'mongodb';
import type { NextApiHandler } from 'next';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

declare const jest: typeof import('@jest/globals').jest;

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  userId?: string;
  query?: Record<string, string | string[]>;
  body?: Record<string, unknown>;
};

type CreditDocumentData = {
  cards?: Record<string, unknown>[];
  plans?: Record<string, unknown>[];
  cycles?: Record<string, unknown>[];
};

interface StoredCreditDocument extends Document {
  userId: string;
  cards: Record<string, unknown>[];
  plans: Record<string, unknown>[];
  cycles: Record<string, unknown>[];
}

type IntegrationCycle = {
  cardId?: string;
  month: string;
  totalDue?: number;
  paidAmount?: number;
  amountDue?: number;
  carriedBalance?: number;
  closingBalance?: number;
  creditBalance?: number;
};

type CreditCardData = NonNullable<Parameters<typeof buildRevolvingExpenseRows>[0]>;

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'test-user-a';

let mongod: MongoMemoryServer;
let cardsHandler: NextApiHandler;
let revolvingHandler: NextApiHandler;
let spendItemsHandler: NextApiHandler;
let getDbPromise: typeof import('../../../lib/mongodb').getDbPromise;
let db: Db;
let sessionCookie: typeof import('../../../src/shared/utils/backend/sessionCookie');

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';
  process.env.SESSION_SECRET = TEST_SECRET;
  jest.resetModules();
  cardsHandler = require('../../../pages/api/credit-cards/index').default;
  revolvingHandler = require('../../../pages/api/credit-cards/revolving').default;
  spendItemsHandler = require('../../../pages/api/credit-cards/spend-items').default;
  sessionCookie = require('../../../src/shared/utils/backend/sessionCookie');
  ({ getDbPromise } = require('../../../lib/mongodb'));
  db = await getDbPromise();
}, 60000);

afterAll(async () => {
  if (db?.client) await db.client.close();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  if (db) await db.collection('credit_cards').deleteMany({});
});

function makeReqRes({ method = 'GET', userId = USER_A, query = {}, body }: RequestOptions = {}) {
  const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
  const sid = createSessionId();
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  return createMocks({
    method,
    query,
    body,
    cookies: { [SESSION_COOKIE_NAME]: signSession(userId, sid) },
    headers: mutating ? { 'x-csrf-token': signCsrfToken(sid) } : {}
  });
}

async function call(handler: NextApiHandler, options: RequestOptions = {}) {
  const { req, res } = makeReqRes(options);
  await handler(req, res);
  return { status: res._getStatusCode(), body: JSON.parse(res._getData() || 'null') };
}

async function seedCreditDoc({ cards = [], plans = [], cycles = [] }: CreditDocumentData = {}) {
  await db.collection('credit_cards').updateOne(
    { userId: USER_A },
    { $set: { userId: USER_A, cards, plans, cycles, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
}

const readDoc = async () => {
  const doc = await db.collection<StoredCreditDocument>('credit_cards').findOne({ userId: USER_A });
  if (!doc) {
    throw new Error('Expected the seeded credit_cards document');
  }
  return doc;
};

const makeCard = (overrides = {}) => ({
  id: 'cc_cb',
  name: 'บัตรแคชแบค',
  creditLimit: 10000,
  annualRate: 12,
  minPaymentPercent: 10,
  statementDay: 5,
  dueDay: 20,
  color: '#5d5bff',
  bankName: '',
  last4: '',
  ...overrides
});

const MONTH = getCurrentMonthKey();
const PREV = addMonths(MONTH, -1);

describe('N-3 / edge 18: card delete gate with a cashback credit', () => {
  it('a card holding only a credit in the current month can be deleted; its cycles go with it', async () => {
    await seedCreditDoc({
      cards: [makeCard()],
      cycles: [{ id: 'rc_1', cardId: 'cc_cb', month: MONTH, newSpend: 300, cashbackAmount: 500, paymentAction: null, paidAt: null, paidSource: null }]
    });

    const res = await call(cardsHandler, { method: 'DELETE', body: { cardId: 'cc_cb' } });

    expect(res.status).toBe(200);
    const doc = await readDoc();
    expect(doc.cards).toEqual([]);
    expect(doc.cycles).toEqual([]);
  });

  it('a credit carried from last month into an implicit current month is still deletable', async () => {
    await seedCreditDoc({
      cards: [makeCard()],
      cycles: [{ id: 'rc_1', cardId: 'cc_cb', month: PREV, newSpend: 0, cashbackAmount: 400, paymentAction: null, paidAt: null, paidSource: null }]
    });

    const res = await call(cardsHandler, { method: 'DELETE', body: { cardId: 'cc_cb' } });

    expect(res.status).toBe(200);
    expect((await readDoc()).cards).toEqual([]);
  });

  it('a partial cashback still leaves a debt: delete is blocked with the NET outstanding', async () => {
    await seedCreditDoc({
      cards: [makeCard()],
      cycles: [{ id: 'rc_1', cardId: 'cc_cb', month: MONTH, newSpend: 5000, cashbackAmount: 1000, paymentAction: null, paidAt: null, paidSource: null }]
    });

    const res = await call(cardsHandler, { method: 'DELETE', body: { cardId: 'cc_cb' } });

    expect(res.status).toBe(409);
    expect(res.body.revolvingOutstanding).toBe(4000);
    expect((await readDoc()).cards).toHaveLength(1);
  });
});

describe('card API surfaces the credit separately (BR-CC-031, N-1)', () => {
  it('credit month: revolvingCredit 200, debt figures 0, availableCredit capped at creditLimit, totals unchanged in shape', async () => {
    await seedCreditDoc({
      cards: [makeCard(), makeCard({ id: 'cc_debt', name: 'บัตรหนี้', creditLimit: 20000 })],
      cycles: [
        { id: 'rc_1', cardId: 'cc_cb', month: MONTH, newSpend: 300, cashbackAmount: 500, paymentAction: 'full', paidAt: 'x', paidSource: 'credit_card' },
        { id: 'rc_2', cardId: 'cc_debt', month: MONTH, newSpend: 1000, paymentAction: null, paidAt: null, paidSource: null }
      ]
    });

    const res = await call(cardsHandler, { method: 'GET' });

    expect(res.status).toBe(200);
    const credit = res.body.cards.find((card: { id: string }) => card.id === 'cc_cb');
    expect(credit).toMatchObject({
      revolvingCredit: 200,
      revolvingTotalDue: 0,
      revolvingDue: 0,
      revolvingOutstanding: 0,
      revolvingCarryForward: 0,
      availableCredit: 10000
    });
    const debt = res.body.cards.find((card: { id: string }) => card.id === 'cc_debt');
    expect(debt).toMatchObject({ revolvingCredit: 0, revolvingOutstanding: 1000, availableCredit: 19000 });

    expect(Object.keys(res.body.totals).sort()).toEqual([
      'availableCredit', 'cardCount', 'creditLimit', 'ongoingPlanCount',
      'remainingPayable', 'remainingPrincipal', 'revolvingDue', 'revolvingOutstanding'
    ]);
    expect(res.body.totals).toMatchObject({ revolvingOutstanding: 1000, revolvingDue: 1000, availableCredit: 29000, creditLimit: 30000 });
  });
});

describe('PATCH cashback round trips', () => {
  it.each([[0], ['0.00']])('edge 29: cashbackAmount %p clears a stored 100 and leaves the payment fields alone', async (value) => {
    await seedCreditDoc({
      cards: [makeCard()],
      cycles: [{ id: 'rc_1', cardId: 'cc_cb', month: '2099-01', newSpend: 1000, cashbackAmount: 100, paymentAction: 'full', paidAt: 'P', paidSource: 'credit_card' }]
    });

    const res = await call(revolvingHandler, { method: 'PATCH', body: { cardId: 'cc_cb', month: '2099-01', cashbackAmount: value } });

    expect(res.status).toBe(200);
    const stored = (await readDoc()).cycles[0];
    expect(stored).toMatchObject({ cashbackAmount: 0, newSpend: 1000, paymentAction: 'full', paidAt: 'P', paidSource: 'credit_card' });
  });

  it("stored 'full' survives a month flipping into credit and back (N-2 / R-5); the credit is never erased", async () => {
    await seedCreditDoc({
      cards: [makeCard()],
      cycles: [{ id: 'rc_1', cardId: 'cc_cb', month: '2099-01', newSpend: 1000, paymentAction: 'full', paidAt: 'P', paidSource: 'credit_card' }]
    });
    const row = (body: { cycles: IntegrationCycle[] }) => body.cycles.find(cycle => cycle.month === '2099-01');

    // 1) cashback larger than spend -> credit month, stored 'full' kept but inert
    let res = await call(revolvingHandler, { method: 'PATCH', body: { cardId: 'cc_cb', month: '2099-01', cashbackAmount: '1,200' } });
    expect(res.status).toBe(200);
    expect(row(res.body)).toMatchObject({
      paymentAction: 'full', totalDue: -200, paidAmount: 0, interest: 0, amountDue: 0, closingBalance: -200, creditBalance: 200
    });
    expect((await readDoc()).cycles[0]).toMatchObject({ paymentAction: 'full', paidAt: 'P', paidSource: 'credit_card', cashbackAmount: 1200 });

    // 2) next month spend absorbs the carried credit
    expect((await call(spendItemsHandler, { method: 'POST', body: { item: { cardId: 'cc_cb', purchaseDate: '2099-02-01', name: 'รายการใหม่', amount: 500 } } })).status).toBe(201);
    res = await call(revolvingHandler, { query: { cardId: 'cc_cb', month: '2099-02' } });
    expect(res.status).toBe(200);
    expect(res.body.cycles.find((cycle: IntegrationCycle) => cycle.month === '2099-02')).toMatchObject({ carriedBalance: -200, totalDue: 300, amountDue: 300 });

    // 3) cashback lowered back below spend -> 'full' applies to the net amount again
    res = await call(revolvingHandler, { method: 'PATCH', body: { cardId: 'cc_cb', month: '2099-01', cashbackAmount: 100 } });
    expect(row(res.body)).toMatchObject({ paymentAction: 'full', totalDue: 900, paidAmount: 900, closingBalance: 0, creditBalance: 0 });
    expect(res.body.cycles.find((cycle: IntegrationCycle) => cycle.month === '2099-02')).toMatchObject({ carriedBalance: 0, totalDue: 500 });
  });
});

describe('creditCardSync consumers (ExpenseTable ccr_ row, months list, LINE) see only net non-negative amounts', () => {
  const card = makeCard();
  const data = (cycles: CreditCardData['cycles']): CreditCardData => ({ cards: [card], plans: [], cycles });

  it('positive month after cashback: ccr_ row actual is the net amountDue', () => {
    const rows = buildRevolvingExpenseRows(data([{ cardId: 'cc_cb', month: '2099-01', newSpend: 1000, cashbackAmount: 250, paymentAction: null }]), '2099-01');
    expect(Object.values(rows)).toHaveLength(1);
    expect(Object.values(rows)[0].actual).toBe(750);
  });

  it.each([
    ['credit month', { newSpend: 300, cashbackAmount: 500, paymentAction: null }],
    ['credit month with stale full', { newSpend: 300, cashbackAmount: 500, paymentAction: 'full' }],
    ['credit month with stale minimum', { newSpend: 300, cashbackAmount: 500, paymentAction: 'minimum' }],
    ['zero month after cashback', { newSpend: 500, cashbackAmount: 500, paymentAction: null }]
  ])('%s: no ccr_ row at all', (_label, fields) => {
    const rows = buildRevolvingExpenseRows(data([{ cardId: 'cc_cb', month: '2099-01', ...fields }]), '2099-01');
    expect(rows).toEqual({});
  });

  it('legacy revolving-only builder emits no credit row, while the card-total month list includes credit months (R2)', () => {
    const cycles = [{ cardId: 'cc_cb', month: PREV, newSpend: 0, cashbackAmount: 400, paymentAction: null }];
    expect(buildRevolvingExpenseRows(data(cycles), MONTH)).toEqual({});
    const months = getCreditCardMonths(data(cycles));
    expect(months).toContain(PREV);
    expect(months).toContain(MONTH);
  });
});
