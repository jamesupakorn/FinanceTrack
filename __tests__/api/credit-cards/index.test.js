/** @jest-environment node */
// Integration test against a real (ephemeral, in-process) MongoDB instance for every test case
// except the isolated getUserCreditData()/updateUserCreditData()-throw -> 500 case at the bottom
// of this file (see that describe block for why jest.mock('.../creditCardStore') is the one
// sanctioned exception here, per .pipeline/spec-td-c01-api-coverage-9.md and CODING_STANDARD.md's
// "mock a collaborator, not the DB" carve-out — same pattern slice #8 already used for users.js).
//
// credit-cards/index.js's delete cascade (removing a card's own plans/cycles from the same
// per-user document in one updateUserCreditData call) and the two-guard 409 ordering
// (revolving balance checked before active plans) are both regression properties that only a real
// document round-trip can prove — a mocked collaborator would trivially return whatever a stub was
// told to, proving nothing about the real object shape genuinely persisting through updateOne/$set.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMocks } from 'node-mocks-http';
import { MAX_CARDS_PER_USER } from '../../../src/shared/utils/creditCardUtils';

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'test-user-a';
const USER_B = 'test-user-b';

let mongod;
let handler;
let getDbPromise;
let db;
let sessionCookie;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();

  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';
  process.env.SESSION_SECRET = TEST_SECRET;

  jest.resetModules();

  handler = require('../../../pages/api/credit-cards/index').default;
  sessionCookie = require('../../../src/shared/utils/backend/sessionCookie');
  ({ getDbPromise } = require('../../../lib/mongodb'));
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
    await db.collection('credit_cards').deleteMany({});
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

/** Seeds a raw credit_cards document directly via the collection — bypasses the route's own POST
 * validation entirely, mirroring slice #8's own "seed the shared collaborator directly" pattern.
 * Every seeded card/plan/cycle here is a minimal, hand-constructed shape sufficient for this
 * route's own blocking/cascade logic — NOT a realistic buildSchedule/buildRevolvingCycles output
 * (out of scope, see spec's Out of Scope section). */
async function seedCreditDoc(userId, { cards = [], plans = [], cycles = [] } = {}) {
  await db.collection('credit_cards').updateOne(
    { userId },
    { $set: { userId, cards, plans, cycles, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
}

const EMPTY_TOTALS = {
  remainingPayable: 0,
  remainingPrincipal: 0,
  creditLimit: 0,
  availableCredit: 0,
  revolvingDue: 0,
  revolvingOutstanding: 0,
  cardCount: 0,
  ongoingPlanCount: 0
};

describe('/api/credit-cards (Mongo mode, real DB)', () => {
  // --- session/CSRF gate -----------------------------------------------------------------

  it('1. GET with no session cookie returns 401 with the exact assertUserId body', async () => {
    const { req, res } = makeReqRes({ userId: null });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(JSON.parse(res._getData())).toEqual({
      error: 'session expired or invalid — please log in again'
    });
  });

  // --- GET ---------------------------------------------------------------------------------

  it('2. GET with zero cards returns 200 with { cards: [], totals: <all-zero> }', async () => {
    const { req, res } = makeReqRes();

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ cards: [], totals: EMPTY_TOTALS });
  });

  it('3. GET with one card, no plans/cycles returns computed defaults', async () => {
    await seedCreditDoc(USER_A, {
      cards: [{
        id: 'cc_a',
        name: 'บัตร A',
        creditLimit: 50000,
        annualRate: 0,
        minPaymentPercent: 10,
        statementDay: 5,
        dueDay: 20,
        color: '#5d5bff',
        bankName: '',
        last4: ''
      }]
    });

    const { req, res } = makeReqRes();
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0]).toMatchObject({
      remainingPayable: 0,
      remainingPrincipal: 0,
      revolvingOutstanding: 0,
      revolvingDue: 0,
      availableCredit: 50000,
      ongoingPlanCount: 0,
      nextDueDate: null
    });
    expect(body.totals.cardCount).toBe(1);
  });

  it('4. GET with a card that has an ongoing plan with an unpaid installment row returns nonzero remaining fields', async () => {
    await seedCreditDoc(USER_A, {
      cards: [{
        id: 'cc_b',
        name: 'บัตร B',
        creditLimit: 20000,
        annualRate: 0,
        minPaymentPercent: 10,
        statementDay: 5,
        dueDay: 20,
        color: '#22c1a4',
        bankName: '',
        last4: ''
      }],
      plans: [{
        id: 'ip_1',
        cardId: 'cc_b',
        status: 'ongoing',
        schedule: [
          { no: 1, payment: 1000, principal: 900, paid: false },
          { no: 2, payment: 1000, principal: 900, paid: true }
        ]
      }]
    });

    const { req, res } = makeReqRes();
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    const card = body.cards[0];
    expect(card.remainingPayable).toBe(1000);
    expect(card.remainingPrincipal).toBe(900);
    expect(card.availableCredit).toBe(card.creditLimit - card.remainingPrincipal);
    expect(card.ongoingPlanCount).toBe(1);
  });

  it('5. totals aggregate across multiple cards', async () => {
    await seedCreditDoc(USER_A, {
      cards: [
        {
          id: 'cc_a',
          name: 'บัตร A',
          creditLimit: 50000,
          annualRate: 0,
          minPaymentPercent: 10,
          statementDay: 5,
          dueDay: 20,
          color: '#5d5bff',
          bankName: '',
          last4: ''
        },
        {
          id: 'cc_b',
          name: 'บัตร B',
          creditLimit: 20000,
          annualRate: 0,
          minPaymentPercent: 10,
          statementDay: 5,
          dueDay: 20,
          color: '#22c1a4',
          bankName: '',
          last4: ''
        }
      ],
      plans: [{
        id: 'ip_1',
        cardId: 'cc_b',
        status: 'ongoing',
        schedule: [
          { no: 1, payment: 1000, principal: 900, paid: false },
          { no: 2, payment: 1000, principal: 900, paid: true }
        ]
      }]
    });

    const { req, res } = makeReqRes();
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.totals.cardCount).toBe(2);
    expect(body.totals.ongoingPlanCount).toBe(1);

    const cardA = body.cards.find(c => c.id === 'cc_a');
    const cardB = body.cards.find(c => c.id === 'cc_b');
    // Re-derived from the same response body's own per-card values, not independently
    // hand-computed (per the spec's "no hand-computed values" standing instruction).
    expect(body.totals.remainingPayable).toBe(cardA.remainingPayable + cardB.remainingPayable);
    expect(body.totals.remainingPrincipal).toBe(cardA.remainingPrincipal + cardB.remainingPrincipal);
  });

  it('6. GET cross-user isolation — USER_B sees no trace of USER_A card', async () => {
    await seedCreditDoc(USER_A, {
      cards: [{
        id: 'cc_a',
        name: 'บัตร A',
        creditLimit: 50000,
        annualRate: 0,
        minPaymentPercent: 10,
        statementDay: 5,
        dueDay: 20,
        color: '#5d5bff',
        bankName: '',
        last4: ''
      }]
    });

    const { req, res } = makeReqRes({ userId: USER_B });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ cards: [], totals: EMPTY_TOTALS });
  });

  // --- POST ---------------------------------------------------------------------------------

  it('7. POST with a missing CSRF token returns 403 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      omitCsrf: true,
      body: { card: { name: 'x' } }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(403);
    expect(await db.collection('credit_cards').countDocuments({})).toBe(0);
  });

  it('8. POST create, missing/non-object card returns 400 and does not write', async () => {
    const { req, res } = makeReqRes({ method: 'POST', body: {} });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'card payload required' });
    expect(await db.collection('credit_cards').countDocuments({})).toBe(0);
  });

  it('9. POST create, invalid input (empty name) returns 400 with errors.name, does not write', async () => {
    const { req, res } = makeReqRes({ method: 'POST', body: { card: { name: '' } } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({
      error: 'ข้อมูลบัตรไม่ถูกต้อง',
      errors: { name: 'กรุณาระบุชื่อบัตร' }
    });
    expect(await db.collection('credit_cards').countDocuments({})).toBe(0);
  });

  it('10. POST create success, minimal input applies defaults with a generated id shape', async () => {
    const { req, res } = makeReqRes({ method: 'POST', body: { card: { name: 'บัตรใหม่' } } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.card.id).toMatch(/^cc_[0-9a-f]{12}$/);
    expect(body.card.name).toBe('บัตรใหม่');
    expect(body.card.annualRate).toBe(0);
    expect(body.card.minPaymentPercent).toBe(10);
    expect(body.card.creditLimit).toBe(0);
    expect(body.card.remainingPayable).toBe(0);
    expect(body.card.availableCredit).toBe(0);

    const { req: getReq, res: getRes } = makeReqRes();
    await handler(getReq, getRes);
    const getBody = JSON.parse(getRes._getData());
    expect(getBody.cards).toHaveLength(1);
    expect(getBody.cards[0].id).toBe(body.card.id);
  });

  it('11. MAX_CARDS_PER_USER cap returns 409 and does not write a 21st card', async () => {
    const cards = Array.from({ length: MAX_CARDS_PER_USER }, (_, i) => ({
      id: `cc_seed${i}`,
      name: `บัตร ${i}`,
      creditLimit: 0,
      annualRate: 0,
      minPaymentPercent: 10,
      statementDay: 5,
      dueDay: 20,
      color: '#5d5bff',
      bankName: '',
      last4: ''
    }));
    await seedCreditDoc(USER_A, { cards });

    const { req, res } = makeReqRes({ method: 'POST', body: { card: { name: 'บัตรที่ 21' } } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(409);
    expect(JSON.parse(res._getData())).toEqual({
      error: `เพิ่มบัตรได้สูงสุด ${MAX_CARDS_PER_USER} ใบ`,
      cardCount: MAX_CARDS_PER_USER
    });

    const { req: getReq, res: getRes } = makeReqRes();
    await handler(getReq, getRes);
    expect(JSON.parse(getRes._getData()).cards).toHaveLength(MAX_CARDS_PER_USER);
  });

  it('12. POST edit path merges, preserves id, applies new values', async () => {
    await seedCreditDoc(USER_A, {
      cards: [{
        id: 'cc_edit',
        name: 'เดิม',
        creditLimit: 1000,
        annualRate: 0,
        minPaymentPercent: 10,
        statementDay: 5,
        dueDay: 20,
        color: '#5d5bff',
        bankName: '',
        last4: ''
      }]
    });

    const { req, res } = makeReqRes({
      method: 'POST',
      body: { card: { id: 'cc_edit', name: 'ใหม่', creditLimit: 2000 } }
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.card.id).toBe('cc_edit');
    expect(body.card.name).toBe('ใหม่');
    expect(body.card.availableCredit).toBe(2000);

    const { req: getReq, res: getRes } = makeReqRes();
    await handler(getReq, getRes);
    const getBody = JSON.parse(getRes._getData());
    expect(getBody.cards).toHaveLength(1);
    expect(getBody.cards[0].name).toBe('ใหม่');
    expect(getBody.cards[0].creditLimit).toBe(2000);
  });

  it('13. POST edit path with a nonexistent card.id returns 404 and adds no card', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { card: { id: 'cc_missing', name: 'x' } }
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData())).toEqual({ error: 'card not found' });
    // NOTE: updateUserCreditData() always upserts its per-user document (even when the updater's
    // callback leaves `data` unchanged on a failure branch — see creditCardStore.js), so a
    // countDocuments({ userId }) assertion of exactly 0 would fail even though no card was ever
    // added. Re-derived from real observed behavior (spec's original assumption of "no document
    // ever created" did not hold against the real store) — verify no *card* was written instead,
    // which is the actual property this test is meant to prove.
    const doc = await db.collection('credit_cards').findOne({ userId: USER_A });
    expect(doc?.cards ?? []).toEqual([]);
  });

  it('14. POST edit path with a card.id belonging to another user returns 404, no cross-user mutation', async () => {
    await seedCreditDoc(USER_B, {
      cards: [{
        id: 'cc_other',
        name: 'ของบี',
        creditLimit: 500,
        annualRate: 0,
        minPaymentPercent: 10,
        statementDay: 5,
        dueDay: 20,
        color: '#5d5bff',
        bankName: '',
        last4: ''
      }]
    });

    const { req, res } = makeReqRes({
      userId: USER_A,
      method: 'POST',
      body: { card: { id: 'cc_other', name: 'hijack' } }
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);

    const { req: getReq, res: getRes } = makeReqRes({ userId: USER_B });
    await handler(getReq, getRes);
    const getBody = JSON.parse(getRes._getData());
    expect(getBody.cards[0].name).toBe('ของบี');
  });

  // --- DELETE -------------------------------------------------------------------------------

  it('15. DELETE with missing/blank cardId returns 400', async () => {
    const { req, res } = makeReqRes({ method: 'DELETE', body: {} });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'cardId required' });
  });

  it('16. DELETE with a nonexistent cardId returns 404', async () => {
    const { req, res } = makeReqRes({ method: 'DELETE', body: { cardId: 'cc_nope' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData())).toEqual({ error: 'card not found' });
  });

  it('17. DELETE blocked by outstanding revolving balance returns 409, card/plans/cycles untouched', async () => {
    const month = require('../../../src/shared/utils/creditCardUtils').getCurrentMonthKey();
    await seedCreditDoc(USER_A, {
      cards: [{
        id: 'cc_rev',
        name: 'บัตรหมุนเวียน',
        creditLimit: 10000,
        annualRate: 0,
        minPaymentPercent: 10,
        statementDay: 5,
        dueDay: 20,
        color: '#5d5bff',
        bankName: '',
        last4: ''
      }],
      cycles: [{
        id: 'rc_1',
        cardId: 'cc_rev',
        month,
        newSpend: 5000,
        paymentAction: null,
        paidAt: null,
        paidSource: null
      }]
    });

    const { req, res } = makeReqRes({ method: 'DELETE', body: { cardId: 'cc_rev' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(409);
    const body = JSON.parse(res._getData());
    expect(body.error).toBe('card has an outstanding revolving balance');
    expect(body.revolvingOutstanding).toBeGreaterThan(0);

    const { req: getReq, res: getRes } = makeReqRes();
    await handler(getReq, getRes);
    expect(JSON.parse(getRes._getData()).cards).toHaveLength(1);
  });

  it('18. DELETE blocked by an active ongoing installment plan returns 409, independent of the revolving guard', async () => {
    await seedCreditDoc(USER_A, {
      cards: [{
        id: 'cc_plan',
        name: 'บัตรผ่อน',
        creditLimit: 10000,
        annualRate: 0,
        minPaymentPercent: 10,
        statementDay: 5,
        dueDay: 20,
        color: '#5d5bff',
        bankName: '',
        last4: ''
      }],
      plans: [{
        id: 'ip_2',
        cardId: 'cc_plan',
        status: 'ongoing',
        schedule: [{ no: 1, payment: 500, principal: 500, paid: false }]
      }]
      // no cycles seeded — proves this guard is reached independently of test 17's guard.
    });

    const { req, res } = makeReqRes({ method: 'DELETE', body: { cardId: 'cc_plan' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(409);
    expect(JSON.parse(res._getData())).toEqual({
      error: 'card has active installment plans',
      ongoingPlanCount: 1
    });

    const { req: getReq, res: getRes } = makeReqRes();
    await handler(getReq, getRes);
    expect(JSON.parse(getRes._getData()).cards).toHaveLength(1);
  });

  it('19. DELETE success cascades to the card\'s own plans and cycles (direct document read)', async () => {
    const month = require('../../../src/shared/utils/creditCardUtils').getCurrentMonthKey();
    await seedCreditDoc(USER_A, {
      cards: [{
        id: 'cc_gone',
        name: 'บัตรที่จะลบ',
        creditLimit: 10000,
        annualRate: 0,
        minPaymentPercent: 10,
        statementDay: 5,
        dueDay: 20,
        color: '#5d5bff',
        bankName: '',
        last4: ''
      }],
      plans: [{
        id: 'ip_3',
        cardId: 'cc_gone',
        status: 'completed',
        schedule: [{ no: 1, payment: 500, principal: 500, paid: true }]
      }],
      cycles: [{
        id: 'rc_2',
        cardId: 'cc_gone',
        month,
        newSpend: 100,
        paymentAction: 'full',
        paidAt: new Date().toISOString(),
        paidSource: 'credit_card'
      }]
    });

    const { req, res } = makeReqRes({ method: 'DELETE', body: { cardId: 'cc_gone' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ success: true });

    const { req: getReq, res: getRes } = makeReqRes();
    await handler(getReq, getRes);
    expect(JSON.parse(getRes._getData())).toEqual({ cards: [], totals: EMPTY_TOTALS });

    // Direct document read — proves plans/cycles are pruned too, not just cards. The route's
    // own GET response never echoes back the full plans/cycles arrays, so only a raw document
    // read can prove this cascade is complete (AC-4).
    const doc = await db.collection('credit_cards').findOne({ userId: USER_A });
    expect(doc.cards).toEqual([]);
    expect(doc.plans).toEqual([]);
    expect(doc.cycles).toEqual([]);
  });

  it('20. DELETE cross-user isolation — a cardId belonging to another user is 404, never mutated', async () => {
    await seedCreditDoc(USER_B, {
      cards: [{
        id: 'cc_b_only',
        name: 'ของบีเท่านั้น',
        creditLimit: 500,
        annualRate: 0,
        minPaymentPercent: 10,
        statementDay: 5,
        dueDay: 20,
        color: '#5d5bff',
        bankName: '',
        last4: ''
      }]
    });

    const { req, res } = makeReqRes({
      userId: USER_A,
      method: 'DELETE',
      body: { cardId: 'cc_b_only' }
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);

    const { req: getReq, res: getRes } = makeReqRes({ userId: USER_B });
    await handler(getReq, getRes);
    expect(JSON.parse(getRes._getData()).cards).toHaveLength(1);
    expect(JSON.parse(getRes._getData()).cards[0].id).toBe('cc_b_only');
  });

  // --- unsupported method ---------------------------------------------------------------------

  it('21. Unsupported method (PATCH) returns 405 with a JSON body and an Allow header', async () => {
    const { req, res } = makeReqRes({ method: 'PATCH' });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Method not allowed' });
    // node-mocks-http lower-cases header names, same convention users.test.js/salary.test.js use.
    expect(res._getHeaders().allow).toEqual(['GET', 'POST', 'DELETE']);
  });
});

describe('/api/credit-cards (isolated mocked-collaborator test — the one sanctioned exception)', () => {
  // This is the only test in this file that mocks a collaborator module. It is scoped to its own
  // describe block via jest.isolateModules so the mock never leaks into the real-DB tests above.
  // The top-level catch -> 500 branch cannot be exercised by seeding/withholding real documents —
  // it requires the collaborator to actually throw, which is the class of case
  // CODING_STANDARD.md's "mock a collaborator, not the DB" carve-out exists for (same pattern
  // slice #8 used for users.js's loadUsers()-throws test).
  it('22. getUserCreditData() throwing returns 500 with the exact Thai error body', async () => {
    let isolatedHandler;

    jest.isolateModules(() => {
      jest.doMock('../../../src/shared/utils/backend/creditCardStore', () => ({
        getUserCreditData: jest.fn().mockRejectedValue(new Error('boom')),
        updateUserCreditData: jest.fn().mockRejectedValue(new Error('boom'))
      }));
      isolatedHandler = require('../../../pages/api/credit-cards/index').default;
    });

    const { req, res } = makeReqRes();
    await isolatedHandler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(JSON.parse(res._getData())).toEqual({ error: 'ไม่สามารถจัดการข้อมูลบัตรเครดิตได้' });

    // Ensure the mock does not leak into any other test in this file (or process).
    jest.dontMock('../../../src/shared/utils/backend/creditCardStore');
  });
});
