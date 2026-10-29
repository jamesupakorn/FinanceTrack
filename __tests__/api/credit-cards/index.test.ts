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
import { MongoMemoryServer } from '../../helpers/mongoReplSet';
import { createMocks } from 'node-mocks-http';
import { MAX_CARDS_PER_USER } from '../../../src/shared/utils/creditCardUtils';
import type { Db, Document } from 'mongodb';
import type { NextApiHandler } from 'next';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

declare const jest: typeof import('@jest/globals').jest;

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  userId?: string | null;
  query?: Record<string, string | string[]>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  omitCsrf?: boolean;
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

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'test-user-a';
const USER_B = 'test-user-b';

let mongod: MongoMemoryServer;
let handler: NextApiHandler;
let getDbPromise: typeof import('../../../lib/mongodb').getDbPromise;
let db: Db;
let sessionCookie: typeof import('../../../src/shared/utils/backend/sessionCookie');

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
function makeReqRes({ method = 'GET', userId = USER_A, query = {}, body, headers = {}, omitCsrf = false }: RequestOptions = {}) {
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
async function seedCreditDoc(userId: string, { cards = [], plans = [], cycles = [] }: CreditDocumentData = {}) {
  await db.collection('credit_cards').updateOne(
    { userId },
    { $set: { userId, cards, plans, cycles, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
}

async function readCreditDoc(userId: string) {
  const doc = await db.collection<StoredCreditDocument>('credit_cards').findOne({ userId });
  if (!doc) {
    throw new Error(`Expected credit_cards document for ${userId}`);
  }
  return doc;
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
    const body = JSON.parse(res._getData()) as {
      cards: { id: string; remainingPayable: number; remainingPrincipal: number }[];
      totals: {
        cardCount: number;
        ongoingPlanCount: number;
        remainingPayable: number;
        remainingPrincipal: number;
      };
    };
    expect(body.totals.cardCount).toBe(2);
    expect(body.totals.ongoingPlanCount).toBe(1);

    const cardA = body.cards.find(c => c.id === 'cc_a');
    const cardB = body.cards.find(c => c.id === 'cc_b');
    // Re-derived from the same response body's own per-card values, not independently
    // hand-computed (per the spec's "no hand-computed values" standing instruction).
    if (!cardA || !cardB) {
      throw new Error('Expected both seeded cards in the response');
    }
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

  it('AC-BA-21: card account links can be explicitly cleared on edit', async () => {
    const { req: createReq, res: createRes } = makeReqRes({
      method: 'POST',
      body: { card: { name: 'บัตรผูกบัญชี', bankAccountId: 'ba_0123456789ab' } }
    });
    await handler(createReq, createRes);
    expect(createRes._getStatusCode()).toBe(200);
    const cardId = JSON.parse(createRes._getData()).card.id as string;

    const { req: editReq, res: editRes } = makeReqRes({
      method: 'POST',
      body: { card: { id: cardId, name: 'บัตรผูกบัญชี', bankAccountId: '' } }
    });
    await handler(editReq, editRes);

    expect(editRes._getStatusCode()).toBe(200);
    expect(JSON.parse(editRes._getData()).card.bankAccountId).toBe('');
    expect((await readCreditDoc(USER_A)).cards[0].bankAccountId).toBe('');
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
    // ADR-029: the failed (404) request is rolled back atomically, so the upsert may not persist.
    const raw = await db.collection('credit_cards').findOne({ userId: USER_A });
    expect(raw?.cards ?? []).toEqual([]);
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

  // --- bankIssuer round-trip (feature: credit-card-bank-issuer-logo, AC-BI-11..13) ----------

  it('AC-BI-11. POST create with bankIssuer stores it verbatim, and GET returns it', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { card: { name: 'บัตร SCB', bankIssuer: 'scb' } }
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.card.bankIssuer).toBe('scb');

    const doc = await readCreditDoc(USER_A);
    expect(doc.cards[0].bankIssuer).toBe('scb');

    const { req: getReq, res: getRes } = makeReqRes();
    await handler(getReq, getRes);
    const getBody = JSON.parse(getRes._getData());
    expect(getBody.cards[0].bankIssuer).toBe('scb');
  });

  it('AC-BI-12. POST create with no bankIssuer stores no bankIssuer property (no silent coercion to "other")', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { card: { name: 'บัตรไม่มีผู้ออก' } }
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);

    // Checked by reading the stored doc directly, not the response (AC-BI-12's own instruction).
    const doc = await readCreditDoc(USER_A);
    expect('bankIssuer' in doc.cards[0]).toBe(false);
  });

  it('AC-BI-13. POST edit with only name changed on a card seeded with bankIssuer keeps it stored', async () => {
    await seedCreditDoc(USER_A, {
      cards: [{
        id: 'cc_bi_edit',
        name: 'เดิม',
        creditLimit: 1000,
        annualRate: 0,
        minPaymentPercent: 10,
        statementDay: 5,
        dueDay: 20,
        color: '#5d5bff',
        bankName: '',
        last4: '',
        bankIssuer: 'scb'
      }]
    });

    const { req, res } = makeReqRes({
      method: 'POST',
      body: { card: { id: 'cc_bi_edit', name: 'ใหม่' } }
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.card.name).toBe('ใหม่');
    expect(body.card.bankIssuer).toBe('scb');

    const doc = await readCreditDoc(USER_A);
    expect(doc.cards[0].bankIssuer).toBe('scb');
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
    const doc = await readCreditDoc(USER_A);
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
    let isolatedHandler: NextApiHandler | undefined;

    jest.isolateModules(() => {
      jest.doMock('../../../src/shared/utils/backend/creditCardStore', () => ({
        getUserCreditData: jest.fn<() => Promise<unknown>>().mockRejectedValue(new Error('boom')),
        updateUserCreditData: jest.fn<() => Promise<unknown>>().mockRejectedValue(new Error('boom'))
      }));
      isolatedHandler = require('../../../pages/api/credit-cards/index').default;
    });

    const { req, res } = makeReqRes();
    if (!isolatedHandler) {
      throw new Error('Expected credit-cards handler to be loaded');
    }
    await isolatedHandler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(JSON.parse(res._getData())).toEqual({ error: 'ไม่สามารถจัดการข้อมูลบัตรเครดิตได้' });

    // Ensure the mock does not leak into any other test in this file (or process).
    jest.dontMock('../../../src/shared/utils/backend/creditCardStore');
  });
});

describe('/api/credit-cards tile fields (spec-credit-card-tiles, mocked store, in-memory only)', () => {
  // Same sanctioned mocked-collaborator pattern as test 22: creditCardStore is replaced by an
  // in-memory document so the fixture can use the server's current month (D2) and the saved
  // document can be inspected for persisted tile fields (AC-T5).
  const utils = require('../../../src/shared/utils/creditCardUtils');
  const { buildCardTotalExpenseRows } = require('../../../src/shared/utils/backend/creditCardSync');
  const TILE_KEYS = ['dueMonth', 'installmentDueThisMonth', 'revolvingDueThisMonth', 'totalDueThisMonth'];
  const A = { id: 'cc_aaaaaaaaaaaa', name: 'A', bankIssuer: 'kbank', annualRate: 0, minPaymentPercent: 10, dueDay: 20, creditLimit: 50000 };
  const B = { id: 'cc_bbbbbbbbbbbb', name: 'B', bankIssuer: 'scb', annualRate: 0, minPaymentPercent: 10, dueDay: 5, creditLimit: 10000 };
  type Fixture = {
    cards: Array<Record<string, unknown>>;
    plans: Array<Record<string, unknown>>;
    cycles: Array<Record<string, unknown>>;
    spendItems: Array<Record<string, unknown>>;
    updatedAt: null;
  };

  function fixture(actionA: 'full' | 'minimum' | null = null): Fixture {
    const month = utils.getCurrentMonthKey();
    const prev = utils.addMonths(month, -1);
    return {
      cards: [A, B],
      plans: [
        { id: 'ip_000000000001', cardId: A.id, itemName: 'TV', months: 2, status: 'ongoing', principal: 600,
          schedule: [{ no: 1, dueMonth: prev, payment: 300, paid: true }, { no: 2, dueMonth: month, payment: 300, paid: true }] },
        { id: 'ip_000000000002', cardId: A.id, itemName: 'Phone', months: 1, status: 'ongoing', principal: 250,
          schedule: [{ no: 1, dueMonth: month, payment: 250, paid: false }] }
      ],
      cycles: [
        { cardId: A.id, month: prev, newSpend: 1000, paymentAction: null },
        { cardId: A.id, month, newSpend: 0, cashbackAmount: 40, paymentAction: actionA },
        { cardId: B.id, month, newSpend: 100, cashbackAmount: 600, paymentAction: null }
      ],
      spendItems: [{ id: 'si_000000000001', cardId: A.id, month, name: 'food', amount: 400, source: 'user' }],
      updatedAt: null
    };
  }

  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

  function loadWithStore(initial: Fixture) {
    const store = { doc: clone(initial) };
    let isolated: NextApiHandler | undefined;
    jest.isolateModules(() => {
      jest.doMock('../../../src/shared/utils/backend/creditCardStore', () => ({
        getUserCreditData: jest.fn(async () => clone(store.doc)),
        updateUserCreditData: jest.fn(async (_userId: unknown, updater: (data: Fixture) => Fixture) => {
          store.doc = clone(updater(clone(store.doc)));
          return clone(store.doc);
        })
      }));
      isolated = require('../../../pages/api/credit-cards/index').default;
    });
    jest.dontMock('../../../src/shared/utils/backend/creditCardStore');
    if (!isolated) throw new Error('Expected credit-cards handler to be loaded');
    return { handler: isolated, store };
  }

  const rowOf = (data: Fixture, cardId: string) =>
    buildCardTotalExpenseRows(data, utils.getCurrentMonthKey())[utils.buildRevolvingRowKey(cardId)];

  it('AC-T1/T3/T4: GET tile total == ccr_ row actual; dueMonth = current month; old fields unchanged', async () => {
    const data = fixture();
    const { handler: h } = loadWithStore(data);
    const { req, res } = makeReqRes();
    await h(req, res);
    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    const rowA = rowOf(data, A.id);
    const rowB = rowOf(data, B.id);
    const cardA = body.cards.find((c: { id: string }) => c.id === A.id);
    const cardB = body.cards.find((c: { id: string }) => c.id === B.id);

    expect(cardA.dueMonth).toBe(utils.getCurrentMonthKey());
    expect(rowA.breakdown.revolving.carriedBalance).toBeGreaterThan(0);
    expect(cardA.totalDueThisMonth).toBe(rowA.actual);
    expect(cardA.installmentDueThisMonth).toBe(550); // includes the PAID installment
    expect(cardA.revolvingDueThisMonth).toBe(Math.max(0, rowA.breakdown.revolving.totalDue));
    // negative totalDue (credit balance) -> 0, total == row.actual
    expect(rowB.breakdown.revolving.totalDue).toBeLessThan(0);
    expect(cardB.revolvingDueThisMonth).toBe(0);
    expect(cardB.totalDueThisMonth).toBe(rowB.actual);

    // backward compat: every pre-existing field equals the plain summariseCard output
    const plain = data.cards.map(card => utils.summariseCard(card, data.plans, data.cycles, { spendItems: data.spendItems }));
    plain.forEach((p: Record<string, unknown>, i: number) => {
      const extra = Object.fromEntries(TILE_KEYS.map(k => [k, body.cards[i][k]]));
      expect(body.cards[i]).toEqual({ ...clone(p), ...extra });
      expect(p).toHaveProperty('revolvingTotalDue');
      expect(p).toHaveProperty('nextDueDate');
    });
    // REV-3: summariseTotals ignores the new fields
    expect(body.totals).toEqual(utils.summariseTotals(plain));
  });

  it('AC-T6: full amount reported when minimum payment is chosen', async () => {
    const { handler: h } = loadWithStore(fixture('minimum'));
    const { req, res } = makeReqRes();
    await h(req, res);
    const cardA = JSON.parse(res._getData()).cards.find((c: { id: string }) => c.id === A.id);
    const rowA = rowOf(fixture('minimum'), A.id);
    expect(cardA.totalDueThisMonth).toBe(rowA.actual);
    expect(cardA.totalDueThisMonth).toBeGreaterThan(rowA.breakdown.revolving.minPaymentDue);
  });

  it('AC-T4/T5 + REV-4: POST edit returns tile fields from post-save data; nothing persisted or read from body', async () => {
    const { handler: h, store } = loadWithStore(fixture());
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { card: { ...A, name: 'A2', totalDueThisMonth: 999999, installmentDueThisMonth: 1, dueMonth: '1999-01' } }
    });
    await h(req, res);
    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.card.name).toBe('A2');
    expect(body.card.totalDueThisMonth).toBe(rowOf(store.doc, A.id).actual);
    expect(body.card.dueMonth).toBe(utils.getCurrentMonthKey());
    expect(body.card).toHaveProperty('revolvingTotalDue');
    expect(body.card).toHaveProperty('nextDueDate');
    store.doc.cards.forEach(card => TILE_KEYS.forEach(key => expect(card).not.toHaveProperty(key)));
  });

  it('POST create also returns tile fields (zeros for a fresh card) and persists none', async () => {
    const { handler: h, store } = loadWithStore(fixture());
    const input: Record<string, unknown> = { ...B, name: 'New' };
    delete input.id;
    const { req, res } = makeReqRes({ method: 'POST', body: { card: input } });
    await h(req, res);
    expect(res._getStatusCode()).toBe(200);
    const card = JSON.parse(res._getData()).card;
    expect(card).toMatchObject({ dueMonth: utils.getCurrentMonthKey(), installmentDueThisMonth: 0, revolvingDueThisMonth: 0, totalDueThisMonth: 0 });
    expect(store.doc.cards).toHaveLength(3);
    store.doc.cards.forEach(saved => TILE_KEYS.forEach(key => expect(saved).not.toHaveProperty(key)));
  });

  it('T4b: DELETE 409 guard unchanged and success body has no tile fields', async () => {
    const { handler: h, store } = loadWithStore(fixture());
    const blocked = makeReqRes({ method: 'DELETE', body: { cardId: A.id } });
    await h(blocked.req, blocked.res);
    expect(blocked.res._getStatusCode()).toBe(409);
    const blockedBody = JSON.parse(blocked.res._getData());
    expect(blockedBody.error).toBe('card has an outstanding revolving balance');
    TILE_KEYS.forEach(key => expect(blockedBody).not.toHaveProperty(key));

    // B holds only a credit balance and no plans -> deletable
    const ok = makeReqRes({ method: 'DELETE', body: { cardId: B.id } });
    await h(ok.req, ok.res);
    expect(ok.res._getStatusCode()).toBe(200);
    expect(JSON.parse(ok.res._getData())).toEqual({ success: true });
    expect(store.doc.cards.map(card => card.id)).toEqual([A.id]);
  });
});

// spec-credit-card-cross-month-due.md AC-14 / RR-2: two derived GET response fields, never persisted
describe('/api/credit-cards payableRevolvingDue / payableRevolvingMonth (AC-14)', () => {
  const utils = require('../../../src/shared/utils/creditCardUtils');
  const SHOPEE = { id: 'cc_5e5e5e5e5e5e', name: 'Shopee', creditLimit: 20000, annualRate: 0, minPaymentPercent: 10, statementDay: 'EOM', dueDay: 10, color: '#ee4d2d', bankName: '', last4: '' };
  const SAME = { id: 'cc_777777777777', name: 'Same', creditLimit: 20000, annualRate: 0, minPaymentPercent: 10, statementDay: 5, dueDay: 25, color: '#5d5bff', bankName: '', last4: '' };

  it('GET returns the payable (previous) cycle for a cross-month card and the current cycle for a same-month card', async () => {
    const month = utils.getCurrentMonthKey();
    const prev = utils.addMonths(month, -1);
    await seedCreditDoc(USER_A, {
      cards: [SHOPEE, SAME],
      cycles: [
        { cardId: SHOPEE.id, month: prev, newSpend: 1200, paymentAction: null },
        { cardId: SHOPEE.id, month, newSpend: 300, paymentAction: null },
        { cardId: SAME.id, month, newSpend: 640, paymentAction: null }
      ]
    });
    const { req, res } = makeReqRes();
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    const shopee = body.cards.find((c: { id: string }) => c.id === SHOPEE.id);
    const same = body.cards.find((c: { id: string }) => c.id === SAME.id);
    expect(shopee).toMatchObject({ payableRevolvingMonth: prev, payableRevolvingDue: 1200, revolvingDueMonth: month, revolvingDue: 1500 });
    expect(same.payableRevolvingMonth).toBe(same.revolvingDueMonth);
    expect(same.payableRevolvingDue).toBe(same.revolvingDue);
    // XM-9: totals unchanged by the payable fields
    expect(body.totals.revolvingDue).toBe(1500 + 640);

    const stored = await readCreditDoc(USER_A);
    stored.cards.forEach(card => {
      expect(card).not.toHaveProperty('payableRevolvingDue');
      expect(card).not.toHaveProperty('payableRevolvingMonth');
    });
  });

  it('POST edit with echoed payable fields in the body does not persist them', async () => {
    await seedCreditDoc(USER_A, { cards: [SHOPEE] });
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { card: { ...SHOPEE, name: 'Shopee 2', payableRevolvingDue: 999999, payableRevolvingMonth: '1999-01' } }
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.card.name).toBe('Shopee 2');
    expect(body.card.payableRevolvingDue).toBe(0);
    expect(body.card.payableRevolvingMonth).toBeNull();
    const stored = await readCreditDoc(USER_A);
    expect(stored.cards[0]).not.toHaveProperty('payableRevolvingDue');
    expect(stored.cards[0]).not.toHaveProperty('payableRevolvingMonth');
  });

  it('POST create with payable fields in the body does not persist them', async () => {
    const input: Record<string, unknown> = { ...SAME, payableRevolvingDue: 5, payableRevolvingMonth: '2026-01' };
    delete input.id;
    const { req, res } = makeReqRes({ method: 'POST', body: { card: input } });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const stored = await readCreditDoc(USER_A);
    expect(stored.cards).toHaveLength(1);
    expect(stored.cards[0]).not.toHaveProperty('payableRevolvingDue');
    expect(stored.cards[0]).not.toHaveProperty('payableRevolvingMonth');
  });
});
