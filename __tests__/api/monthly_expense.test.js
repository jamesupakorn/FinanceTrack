/** @jest-environment node */
// Integration test against a real (ephemeral, in-process) MongoDB instance — see
// .pipeline/spec-td-c01-api-coverage-13.md for why mongodb-memory-server (not mocks) was chosen: the
// cross-collection write (an expense POST writing into a *different* collection, `credit_cards`, via
// creditCardSync.js's applyCreditCardPaidFromExpensePayload), the strip-on-write invariant (no
// cci_*/ccr_* key ever reaching monthly_expense), and the accountSummary-leak fact are all real,
// two-collection document-shape behaviors a mocked collection would trivially fake without proving
// the actual cross-collection round trip. This is the final route of TD-C01's original 13-route
// list. This route has real, reachable 500 branches, but per the spec's own scope decision this
// slice follows the top-level __tests__/api/ family's no-jest.mock() convention (not the
// credit-cards/ subdirectory family's carve-out) — no jest.mock() appears anywhere in this file.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMocks } from 'node-mocks-http';
import {
  buildInstallmentRowKey,
  buildRevolvingRowKey,
  isCreditCardRowKey,
  getCurrentMonthKey
} from '../../src/shared/utils/creditCardUtils';

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'test-user-a';
const USER_B = 'test-user-b';

// getAccountSummary's own default `bankAccounts` param (commonUtils.ts) — the route calls
// getAccountSummary(flat, flat.bankAccounts) and JS default params DO apply when the explicit
// argument is `undefined` (no doc.bankAccounts stored), so every account-summary response in this
// file includes these 4 keys pre-seeded at 0 unless a real doc.bankAccounts array overrides them.
// Confirmed against the real DEFAULT_BANK_ACCOUNTS = Object.keys(ACCOUNT_MAPPING) export.
function defaultAccountSummary(overrides = {}) {
  return { กรุงศรี: 0, ttb: 0, กสิกร: 0, UOB: 0, ...overrides };
}

let mongod;
let handler;
let getDbPromise;
let db;
let sessionCookie; // { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME }

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();

  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';
  process.env.SESSION_SECRET = TEST_SECRET;

  jest.resetModules();

  handler = require('../../pages/api/monthly_expense').default;
  sessionCookie = require('../../src/shared/utils/backend/sessionCookie');
  ({ getDbPromise } = require('../../lib/mongodb'));
  db = await getDbPromise();
}, 60000);

afterAll(async () => {
  if (db?.client) {
    await db.client.close();
  }
  if (mongod) {
    await mongod.stop();
  }
});

beforeEach(async () => {
  if (db) {
    // All three collections this slice's tests touch, per the spec's own Design section (AC-12) —
    // `users` is only needed by test 17, `credit_cards` by most credit-card-sync tests, plus the 4
    // sharedMonthWindow.js collections for the one shared-window test.
    await db.collection('monthly_expense').deleteMany({});
    await db.collection('credit_cards').deleteMany({});
    await db.collection('users').deleteMany({});
    await db.collection('salary').deleteMany({});
    await db.collection('investment').deleteMany({});
    await db.collection('monthly_income').deleteMany({});
  }
});

/** Identical shape to every prior slice's own helper — same collaborator (sessionCookie), same
 * gate (assertUserId), reused verbatim rather than re-invented. */
function makeReqRes({ method = 'GET', userId = USER_A, query = {}, body, headers = {}, omitCsrf = false } = {}) {
  const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
  const sid = createSessionId();
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  return createMocks({
    method,
    query,
    body,
    cookies: userId ? { [SESSION_COOKIE_NAME]: signSession(userId, sid) } : {},
    headers: {
      ...(mutating && !omitCsrf ? { 'x-csrf-token': signCsrfToken(sid) } : {}),
      ...headers
    }
  });
}

/** Reused verbatim from credit-cards/index.test.js's/plans.test.js's/revolving.test.js's own
 * seedCreditDoc helper (see spec's Design section). */
async function seedCreditDoc(userId, { cards = [], plans = [], cycles = [] } = {}) {
  await db.collection('credit_cards').updateOne(
    { userId },
    { $set: { userId, cards, plans, cycles, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
}

/** Minimal valid card shape — same fields as credit-cards/*.test.js's own makeCard(). */
function makeCard(overrides = {}) {
  return {
    id: 'cc_abc123abc123',
    name: 'บัตร A',
    creditLimit: 50000,
    annualRate: 0,
    minPaymentPercent: 10,
    statementDay: 5,
    dueDay: 20,
    color: '#5d5bff',
    bankName: '',
    last4: '',
    ...overrides
  };
}

/** Minimal valid installment plan shape — schedule literals here are hand-picked stored inputs
 * (not buildSchedule() outputs), so no re-derivation risk per the spec's own Standing Instruction:
 * these are seeded directly into the collection, bypassing buildSchedule() entirely. */
function makePlan(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: 'ip_abc123abc123',
    cardId: 'cc_abc123abc123',
    itemName: 'ของใช้',
    totalPrice: 900,
    months: 3,
    startMonth: '2026-08',
    status: 'ongoing',
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    schedule: [
      { no: 1, dueMonth: '2026-08', payment: 300, principal: 300, interest: 0, paid: false, paidAt: null, paidSource: null }
    ],
    ...overrides
  };
}

describe('/api/monthly_expense (Mongo mode)', () => {
  // ---------------------------------------------------------------------
  // GET — single month (7 cases)
  // ---------------------------------------------------------------------

  it('1. GET with no session cookie returns 401 with the exact assertUserId body', async () => {
    const { req, res } = makeReqRes({ userId: null, query: { month: '2026-08' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(JSON.parse(res._getData())).toEqual({
      error: 'session expired or invalid — please log in again'
    });
  });

  it('2. GET for a month with no doc and no credit-card context returns 200 {}', async () => {
    const { req, res } = makeReqRes({ query: { month: '2026-08' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({});
  });

  it('3. GET for a month with no doc but a due installment row returns 200 derived-only shape (AC-31), keyed by the real computed cci_ key', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard()],
      plans: [makePlan()]
    });
    const key = buildInstallmentRowKey('ip_abc123abc123', 1);

    const { req, res } = makeReqRes({ query: { month: '2026-08' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(Object.keys(body).some(k => isCreditCardRowKey(k))).toBe(true);
    expect(body[key]).toEqual({
      name: 'ของใช้ (งวด 1/3)',
      actual: 300,
      account: 'บัตร A', // no bankAccounts match -> falls back to card name
      paid: false,
      dueDay: 20
    });
    expect(typeof body.totalActualPaid).toBe('number');
    expect(body.accountSummary).toBeTruthy();
  });

  it('4. GET for a month with no doc but a due revolving row (amountDue > 0) returns 200 derived-only shape, keyed by the real computed ccr_ key', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ id: 'cc_revA' })],
      cycles: [{ cardId: 'cc_revA', month: '2026-08', newSpend: 1000, paymentAction: null }]
    });
    const key = buildRevolvingRowKey('cc_revA');

    const { req, res } = makeReqRes({ query: { month: '2026-08' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body[key]).toEqual({
      name: 'ยอดใช้จ่ายบัตร บัตร A',
      actual: 1000,
      account: 'บัตร A',
      paid: false, // paymentAction still null -> not yet paid
      dueDay: 20
    });
  });

  it('5. GET for a month with an existing direct doc and no credit-card context returns the doc items plus correct accountSummary/totalActualPaid', async () => {
    await db.collection('monthly_expense').insertOne({
      month: '2026-08',
      userId: USER_A,
      กาแฟ: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false }
    });

    const { req, res } = makeReqRes({ query: { month: '2026-08' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({
      กาแฟ: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false },
      accountSummary: defaultAccountSummary({ กรุงศรี: 50 }),
      totalActualPaid: 50
    });
  });

  it('6. GET merge-after-mapping ordering: a derived row\'s real paid:true survives mapDocToFlatItemObjectWithTotals\'s own paid:false hardcode (AC-4)', async () => {
    // Real source facts confirmed this pass (not assumed from the spec's paraphrase):
    // - apiUtils.js mapDocToFlatItemObjectWithTotals's legacy `doc.actual`-shaped branch hardcodes
    //   `paid: false` unconditionally for every item it maps (line ~97 of apiUtils.js).
    // - monthly_expense.js's own GET handler computes `derived` BEFORE calling
    //   mapDocToFlatItemObjectWithTotals, then does `flat = Object.assign(flat || {}, derived)` —
    //   the derived map is merged in AFTER the mapper runs, so its own `paid` value overwrites
    //   whatever the mapper produced for the same key.
    const key = buildInstallmentRowKey('ip_abc123abc123', 1);

    // A legacy `{actual: {...}}`-shaped stored doc, seeded directly (this shape is never written by
    // this route's own real POST path, only used here to independently prove the hardcode threat
    // per AC-4 — the stored item's own matching key would show paid:false in isolation).
    await db.collection('monthly_expense').insertOne({
      month: '2026-08',
      userId: USER_A,
      actual: { [key]: 999 },
      [key]: { name: 'เก่า (ค่าที่เก็บไว้)', account: 'เก่า' }
    });

    // A real installment plan whose own schedule row for this month is already paid:true.
    await seedCreditDoc(USER_A, {
      cards: [makeCard()],
      plans: [makePlan({
        schedule: [{ no: 1, dueMonth: '2026-08', payment: 300, principal: 300, interest: 0, paid: true, paidAt: new Date().toISOString(), paidSource: 'credit_card' }]
      })]
    });

    const { req, res } = makeReqRes({ query: { month: '2026-08' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    // The derived row's own paid:true survives — NOT the legacy branch's hardcoded paid:false.
    expect(body[key].paid).toBe(true);
    expect(body[key].actual).toBe(300); // derived value, not the stale stored 999
  });

  it('7. GET single month cross-user isolation: doc + credit-card context both exist for USER_A, GET as USER_B returns 200 {}', async () => {
    await db.collection('monthly_expense').insertOne({
      month: '2026-08',
      userId: USER_A,
      กาแฟ: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false }
    });
    await seedCreditDoc(USER_A, { cards: [makeCard()], plans: [makePlan()] });

    const { req, res } = makeReqRes({ userId: USER_B, query: { month: '2026-08' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({});
  });

  // ---------------------------------------------------------------------
  // GET — all months (5 cases)
  // ---------------------------------------------------------------------

  it('8. GET all months with no docs and no credit-card context returns 200 {}', async () => {
    const { req, res } = makeReqRes({ query: {} });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({});
  });

  it('9. GET all months with two direct docs returns an object keyed by month, each with a correctly-computed summary', async () => {
    await db.collection('monthly_expense').insertOne({
      month: '2026-09',
      userId: USER_A,
      กาแฟ: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false }
    });
    await db.collection('monthly_expense').insertOne({
      month: '2026-10',
      userId: USER_A,
      ข้าว: { name: 'ข้าว', actual: 100, account: 'ttb', paid: false }
    });

    const { req, res } = makeReqRes({ query: {} });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body['2026-09']).toEqual({
      กาแฟ: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false },
      accountSummary: defaultAccountSummary({ กรุงศรี: 50 }),
      totalActualPaid: 50
    });
    expect(body['2026-10']).toEqual({
      ข้าว: { name: 'ข้าว', actual: 100, account: 'ttb', paid: false },
      accountSummary: defaultAccountSummary({ ttb: 100 }),
      totalActualPaid: 100
    });
  });

  it('10. GET all months: a credit-card-only month (no document, only a due installment row) appears via mergeCreditCardOnlyMonths (AC-34)', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard()],
      plans: [makePlan({ schedule: [{ no: 1, dueMonth: '2026-11', payment: 300, principal: 300, interest: 0, paid: false, paidAt: null, paidSource: null }] })]
    });
    const key = buildInstallmentRowKey('ip_abc123abc123', 1);

    const { req, res } = makeReqRes({ query: {} });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body['2026-11']).toBeTruthy();
    expect(body['2026-11'][key]).toBeTruthy();
    expect(body['2026-11'][key].actual).toBe(300);
  });

  it('11. GET all months: a month with both a direct doc and a due installment row shows both the doc\'s own items and the derived row together', async () => {
    await db.collection('monthly_expense').insertOne({
      month: '2026-12',
      userId: USER_A,
      กาแฟ: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false }
    });
    await seedCreditDoc(USER_A, {
      cards: [makeCard()],
      plans: [makePlan({ schedule: [{ no: 1, dueMonth: '2026-12', payment: 300, principal: 300, interest: 0, paid: false, paidAt: null, paidSource: null }] })]
    });
    const key = buildInstallmentRowKey('ip_abc123abc123', 1);

    const { req, res } = makeReqRes({ query: {} });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body['2026-12'].กาแฟ).toEqual({ name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false });
    expect(body['2026-12'][key]).toBeTruthy();
    expect(body['2026-12'][key].actual).toBe(300);
    expect(body['2026-12'].totalActualPaid).toBe(350);
  });

  it('12. GET all months cross-user isolation on the credit-card-only-months merge: context exists only for USER_B, GET as USER_A (no month query) omits that month', async () => {
    await seedCreditDoc(USER_B, {
      cards: [makeCard()],
      plans: [makePlan({ schedule: [{ no: 1, dueMonth: '2027-01', payment: 300, principal: 300, interest: 0, paid: false, paidAt: null, paidSource: null }] })]
    });

    const { req, res } = makeReqRes({ userId: USER_A, query: {} });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({});
  });

  // ---------------------------------------------------------------------
  // Credit-card-sync-specific (5 cases)
  // ---------------------------------------------------------------------

  it('13. Installment row shape/key/fields correctness, account falls back to the card\'s own name (no users doc seeded)', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ bankName: 'กรุงศรี' })], // bankName set but no matching user bank account -> fallback
      plans: [makePlan()]
    });
    const key = buildInstallmentRowKey('ip_abc123abc123', 1);

    const { req, res } = makeReqRes({ query: { month: '2026-08' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body[key]).toEqual({
      name: 'ของใช้ (งวด 1/3)',
      actual: 300,
      account: 'บัตร A', // getUserBankAccounts throws (no users doc) -> [] -> falls back to card name
      paid: false,
      dueDay: 20
    });
  });

  it('14. Cancelled plan: an unpaid future row is excluded but its already-paid row still appears (shouldIncludeRow\'s own PLAN_STATUS.CANCELLED carve-out)', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard()],
      plans: [makePlan({
        status: 'cancelled_early',
        schedule: [
          { no: 1, dueMonth: '2026-08', payment: 300, principal: 300, interest: 0, paid: true, paidAt: new Date().toISOString(), paidSource: 'credit_card' },
          { no: 2, dueMonth: '2026-09', payment: 300, principal: 300, interest: 0, paid: false, paidAt: null, paidSource: null }
        ]
      })]
    });
    const paidKey = buildInstallmentRowKey('ip_abc123abc123', 1);
    const unpaidKey = buildInstallmentRowKey('ip_abc123abc123', 2);

    const { req: req1, res: res1 } = makeReqRes({ query: { month: '2026-08' } });
    await handler(req1, res1);
    expect(res1._getStatusCode()).toBe(200);
    const body1 = JSON.parse(res1._getData());
    expect(body1[paidKey]).toBeTruthy();
    expect(body1[paidKey].paid).toBe(true);

    const { req: req2, res: res2 } = makeReqRes({ query: { month: '2026-09' } });
    await handler(req2, res2);
    expect(res2._getStatusCode()).toBe(200);
    const body2 = JSON.parse(res2._getData());
    expect(body2[unpaidKey]).toBeUndefined();
  });

  it('15. Revolving row shape/key/fields correctness, account fallback, paid reflects paymentAction !== null', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ id: 'cc_revB' })],
      cycles: [{ cardId: 'cc_revB', month: '2026-08', newSpend: 500, paymentAction: 'full' }]
    });
    const key = buildRevolvingRowKey('cc_revB');

    const { req, res } = makeReqRes({ query: { month: '2026-08' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body[key]).toEqual({
      name: 'ยอดใช้จ่ายบัตร บัตร A',
      actual: 500,
      account: 'บัตร A',
      paid: true, // paymentAction 'full' !== null
      dueDay: 20
    });
  });

  it('16. A revolving cycle with amountDue of exactly 0 produces no ccr_ row at all', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ id: 'cc_revC' })],
      cycles: [{ cardId: 'cc_revC', month: '2026-08', newSpend: 0, paymentAction: null }]
    });
    const key = buildRevolvingRowKey('cc_revC');

    const { req, res } = makeReqRes({ query: { month: '2026-08' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body[key]).toBeUndefined();
    expect(Object.keys(body).some(k => isCreditCardRowKey(k))).toBe(false);
  });

  it('17. users-collection integration: a seeded users doc whose bankAccounts includes the card\'s own bankName resolves account to the matched bank name, not the card\'s display name', async () => {
    await db.collection('users').insertOne({
      id: USER_A,
      bankAccounts: ['กรุงศรี', 'ttb']
    });
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ bankName: 'กรุงศรี' })],
      plans: [makePlan()]
    });
    const key = buildInstallmentRowKey('ip_abc123abc123', 1);

    const { req, res } = makeReqRes({ query: { month: '2026-08' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body[key].account).toBe('กรุงศรี'); // matched bank name, not the card's own 'บัตร A'
  });

  // ---------------------------------------------------------------------
  // POST (9 cases)
  // ---------------------------------------------------------------------

  it('18. POST with a valid session but missing X-CSRF-Token returns 403 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      omitCsrf: true,
      body: { month: '2026-08', expense_data: { กาแฟ: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false } } }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(403);
    expect(await db.collection('monthly_expense').countDocuments({})).toBe(0);
  });

  it('19. POST validation: missing month returns 400 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { expense_data: { กาแฟ: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false } } }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'month and expense_data required' });
    expect(await db.collection('monthly_expense').countDocuments({})).toBe(0);
  });

  it('20. POST validation: missing expense_data returns 400 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { month: '2026-08' }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'month and expense_data required' });
    expect(await db.collection('monthly_expense').countDocuments({})).toBe(0);
  });

  it('21. POST create-success returns 200 {success:true} (this route\'s own status code, not 201), verified via a follow-up GET round trip', async () => {
    const { req: postReq, res: postRes } = makeReqRes({
      method: 'POST',
      body: { month: '2026-09', expense_data: { กาแฟ: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: true } } }
    });

    await handler(postReq, postRes);

    expect(postRes._getStatusCode()).toBe(200);
    expect(JSON.parse(postRes._getData())).toEqual({ success: true });

    const { req: getReq, res: getRes } = makeReqRes({ query: { month: '2026-09' } });
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    const body = JSON.parse(getRes._getData());
    expect(body.กาแฟ).toEqual({ name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: true });
    expect(body.totalActualPaid).toBe(50);
    // getAccountSummary skips paid:true items entirely (isPaidFlag short-circuit) -> every default
    // account stays at 0.
    expect(body.accountSummary).toEqual(defaultAccountSummary());
  });

  it("22. POST strip-on-write + cross-collection sync-write: a cci_ key with paid:true writes back into credit_cards' own plans[].schedule[], and is stripped from the stored monthly_expense document (AC-5)", async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard()],
      plans: [makePlan()] // schedule[0].paid === false initially
    });
    const key = buildInstallmentRowKey('ip_abc123abc123', 1);

    const { req, res } = makeReqRes({
      method: 'POST',
      body: {
        month: '2026-08',
        expense_data: {
          [key]: { paid: true },
          กาแฟ: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: true }
        }
      }
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ success: true });

    // Half 1: the stored monthly_expense document has NO cci_* key at all — only the ordinary item.
    const expenseDoc = await db.collection('monthly_expense').findOne({ userId: USER_A, month: '2026-08' });
    expect(expenseDoc).not.toBeNull();
    expect(expenseDoc.กาแฟ).toEqual({ name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: true });
    expect(expenseDoc[key]).toBeUndefined();
    expect(Object.keys(expenseDoc).some(k => isCreditCardRowKey(k))).toBe(false);

    // Half 2: the write actually landed in the OTHER collection instead — credit_cards' own plan
    // schedule row is now paid:true with paidSource: 'expense_table'.
    const creditDoc = await db.collection('credit_cards').findOne({ userId: USER_A });
    const scheduleRow = creditDoc.plans[0].schedule.find(row => row.no === 1);
    expect(scheduleRow.paid).toBe(true);
    expect(scheduleRow.paidSource).toBe('expense_table');
  });

  it('23. POST with an unknown planId referenced by a cci_ key is silently no-op\'d by the sync — no throw, no corruption of either collection, expense POST still 200 (AC-9)', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard()],
      plans: [makePlan()]
    });
    const unknownKey = buildInstallmentRowKey('ip_ffffffffffff', 1); // no plan with this id exists

    const { req, res } = makeReqRes({
      method: 'POST',
      body: {
        month: '2026-08',
        expense_data: {
          [unknownKey]: { paid: true },
          กาแฟ: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false }
        }
      }
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ success: true });

    // monthly_expense: only the ordinary item, no stray cci_ key.
    const expenseDoc = await db.collection('monthly_expense').findOne({ userId: USER_A, month: '2026-08' });
    expect(expenseDoc.กาแฟ).toEqual({ name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false });
    expect(Object.keys(expenseDoc).some(k => isCreditCardRowKey(k))).toBe(false);

    // credit_cards: the real (unrelated) plan's own schedule is completely untouched.
    const creditDoc = await db.collection('credit_cards').findOne({ userId: USER_A });
    expect(creditDoc.plans[0].schedule[0].paid).toBe(false);
    expect(creditDoc.plans).toHaveLength(1);
  });

  it('24. Ordinary item + a revolving credit-card-keyed entry in the same payload are both handled correctly in one request', async () => {
    // Card id needs a genuine 12-hex-char suffix here (unlike the GET-only derive tests above) —
    // parseRevolvingRowKey (used by applyCreditCardPaidFromExpensePayload) requires the built key
    // to match REVOLVING_KEY_RE = /^ccr_[0-9a-f]{12}$/ to be recognized as a sync-writeback target.
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ id: 'cc_def456def456' })],
      cycles: [{ cardId: 'cc_def456def456', month: '2026-08', newSpend: 200, paymentAction: null }]
    });
    const key = buildRevolvingRowKey('cc_def456def456');

    const { req, res } = makeReqRes({
      method: 'POST',
      body: {
        month: '2026-08',
        expense_data: {
          [key]: { paid: true },
          ข้าว: { name: 'ข้าว', actual: 100, account: 'ttb', paid: false }
        }
      }
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);

    const expenseDoc = await db.collection('monthly_expense').findOne({ userId: USER_A, month: '2026-08' });
    expect(expenseDoc.ข้าว).toEqual({ name: 'ข้าว', actual: 100, account: 'ttb', paid: false });
    expect(expenseDoc[key]).toBeUndefined();

    const creditDoc = await db.collection('credit_cards').findOne({ userId: USER_A });
    const cycle = creditDoc.cycles.find(c => c.cardId === 'cc_def456def456' && c.month === '2026-08');
    expect(cycle.paymentAction).toBe('full');
    expect(cycle.paidSource).toBe('expense_table');
  });

  it('25. POST __removeKeys removes an ordinary item field, verified via a follow-up GET', async () => {
    const { req: firstReq, res: firstRes } = makeReqRes({
      method: 'POST',
      body: { month: '2026-10a', expense_data: { กาแฟ: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false } } }
    });
    await handler(firstReq, firstRes);
    expect(firstRes._getStatusCode()).toBe(200);

    const { req: removeReq, res: removeRes } = makeReqRes({
      method: 'POST',
      body: { month: '2026-10a', expense_data: { __removeKeys: ['กาแฟ'] } }
    });
    await handler(removeReq, removeRes);
    expect(removeRes._getStatusCode()).toBe(200);

    const { req: getReq, res: getRes } = makeReqRes({ query: { month: '2026-10a' } });
    await handler(getReq, getRes);
    expect(getRes._getStatusCode()).toBe(200);
    const body = JSON.parse(getRes._getData());
    expect(body.กาแฟ).toBeUndefined();
  });

  it('26. POST cross-user isolation: a POST for USER_A does not alter a document/credit-card state visible to USER_B', async () => {
    // USER_B owns its own real credit-card plan (deliberately, to prove the isolation is about
    // USER_A's own written item, not merely "USER_B sees nothing at all" — USER_B's own derived
    // row for this month is expected to still appear on its own GET).
    await seedCreditDoc(USER_B, { cards: [makeCard()], plans: [makePlan()] });

    const { req: postReq, res: postRes } = makeReqRes({
      method: 'POST',
      userId: USER_A,
      body: { month: '2026-08', expense_data: { กาแฟ: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false } } }
    });
    await handler(postReq, postRes);
    expect(postRes._getStatusCode()).toBe(200);

    const { req: getReq, res: getRes } = makeReqRes({ userId: USER_B, query: { month: '2026-08' } });
    await handler(getReq, getRes);
    expect(getRes._getStatusCode()).toBe(200);
    const body = JSON.parse(getRes._getData());
    // USER_A's own ordinary item never appears in USER_B's response.
    expect(body.กาแฟ).toBeUndefined();
    // No monthly_expense document was ever created for USER_B at all (only its own credit-card
    // derived row exists) — proves this is USER_B's own derived-only response, not a leaked doc.
    expect(await db.collection('monthly_expense').findOne({ userId: USER_B, month: '2026-08' })).toBeNull();

    // USER_B's own credit_cards document is untouched by USER_A's POST.
    const creditDocB = await db.collection('credit_cards').findOne({ userId: USER_B });
    expect(creditDocB.plans[0].schedule[0].paid).toBe(false);
  });

  // ---------------------------------------------------------------------
  // stripKnownTotalFields divergence (1 case)
  // ---------------------------------------------------------------------

  it("27. apiUtils.stripKnownTotalFields (used here) does not strip a leaked accountSummary key — it persists verbatim in the stored doc, but a follow-up GET's own accountSummary is freshly recomputed, and totalActualPaid is unaffected (AC-6)", async () => {
    // Real source facts confirmed this pass: monthly_expense.js imports stripKnownTotalFields from
    // apiUtils.js (default fields=['รวม','totalActualPaid']) — NOT the differently-behaved
    // same-named function in commonUtils.ts (fixed list including accountSummary/month/_id/
    // __removeKeys). The apiUtils.js version (now stripKnownTotalFields) called here with no second argument therefore does
    // NOT strip an `accountSummary` key from the POST payload.
    const { req: postReq, res: postRes } = makeReqRes({
      method: 'POST',
      body: {
        month: '2026-08',
        expense_data: {
          กาแฟ: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false },
          // A deliberately-wrong stale accountSummary literal, simulating a naive client
          // round-tripping a prior GET response verbatim back into a POST body.
          accountSummary: { กรุงศรี: 999999 }
        }
      }
    });
    await handler(postReq, postRes);
    expect(postRes._getStatusCode()).toBe(200);

    // Fact 1: the stale accountSummary IS persisted verbatim in the raw stored document.
    const rawDoc = await db.collection('monthly_expense').findOne({ userId: USER_A, month: '2026-08' });
    expect(rawDoc.accountSummary).toEqual({ กรุงศรี: 999999 });

    // Fact 2: a follow-up GET's own accountSummary is freshly recomputed (not the stale 999999),
    // and no spurious accountSummary-keyed "item" appears. Fact 3: totalActualPaid unaffected.
    const { req: getReq, res: getRes } = makeReqRes({ query: { month: '2026-08' } });
    await handler(getReq, getRes);
    expect(getRes._getStatusCode()).toBe(200);
    const body = JSON.parse(getRes._getData());
    expect(body.accountSummary).toEqual(defaultAccountSummary({ กรุงศรี: 50 })); // freshly recomputed from real items
    expect(body.totalActualPaid).toBe(50);
    expect(body.กาแฟ).toEqual({ name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false });
  });

  // ---------------------------------------------------------------------
  // Shared-window integration (1 case)
  // ---------------------------------------------------------------------

  it("28. enforceSharedMonthWindowMongo prunes a shared newest-15 window across monthly_expense AND salary for one user, at this route's own POST call site", async () => {
    // 10 months for USER_A in `monthly_expense`: 2024-01 .. 2024-10.
    const expenseMonths = [];
    for (let m = 1; m <= 10; m++) {
      expenseMonths.push(`2024-${String(m).padStart(2, '0')}`);
    }
    // 5 months for USER_A in `salary`: 2024-11 .. 2025-03.
    const salaryMonths = ['2024-11', '2024-12', '2025-01', '2025-02', '2025-03'];

    await db.collection('monthly_expense').insertMany(
      expenseMonths.map(month => ({ month, userId: USER_A, กาแฟ: { name: 'กาแฟ', actual: 1, account: 'x', paid: false } }))
    );
    await db.collection('salary').insertMany(
      salaryMonths.map(month => ({ month, userId: USER_A, income: {}, deduct: {} }))
    );

    const { req, res } = makeReqRes({
      method: 'POST',
      userId: USER_A,
      body: { month: '2025-04', expense_data: { กาแฟ: { name: 'กาแฟ', actual: 1, account: 'x', paid: false } } }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);

    const expenseCount = await db.collection('monthly_expense').countDocuments({ userId: USER_A, month: { $exists: true } });
    const salaryCount = await db.collection('salary').countDocuments({ userId: USER_A });
    // 10 expense + 1 new (2025-04) + 5 salary = 16 total before prune; one evicted across the
    // shared window -> 15 remain.
    expect(expenseCount + salaryCount).toBe(15);

    // 2024-01 is the globally oldest month across the two-collection union -> evicted.
    expect(await db.collection('monthly_expense').findOne({ userId: USER_A, month: '2024-01' })).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Method/error handling (1 case)
  // ---------------------------------------------------------------------

  it('29. Unsupported method (DELETE) returns 405 with the bare .end() shape — empty body, no Allow header', async () => {
    const { req, res } = makeReqRes({ method: 'DELETE' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(res._getData()).toBe('');
    expect(res._getHeaders().allow).toBeUndefined();
  });

  // ---------------------------------------------------------------------
  // Environment-date-sensitive test: revolving-only "all months" merge, current-month-derived
  // ---------------------------------------------------------------------

  it('30. GET all months: a revolving-only month (materialized through the real getCurrentMonthKey(), not a hard-coded literal) appears via mergeCreditCardOnlyMonths', async () => {
    // safeGetCreditCardMonths materialises revolving cycles through the REAL getCurrentMonthKey()
    // at test-run time (per the spec's Design section) — this test computes its own expected month
    // the same way the source does, rather than hard-coding e.g. '2099-01', so it never silently
    // produces a false-negative-shaped "empty months, test still passes" result.
    const nowMonth = getCurrentMonthKey();
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ id: 'cc_revNow' })],
      cycles: [{ cardId: 'cc_revNow', month: nowMonth, newSpend: 750, paymentAction: null }]
    });
    const key = buildRevolvingRowKey('cc_revNow');

    const { req, res } = makeReqRes({ query: {} });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body[nowMonth]).toBeTruthy();
    expect(body[nowMonth][key]).toBeTruthy();
    expect(body[nowMonth][key].actual).toBe(750);
  });
});
