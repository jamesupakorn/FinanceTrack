/** @jest-environment node */
// Integration test against a real (ephemeral, in-process) MongoDB instance for every test case
// except the isolated getUserCreditData()-throw -> 500 case at the bottom of this file (see that
// describe block for why jest.mock('.../creditCardStore') is the one sanctioned exception here,
// per .pipeline/spec-td-c01-api-coverage-11.md and CODING_STANDARD.md's "mock a collaborator, not
// the DB" carve-out — same pattern slices #9/#10 already used).
//
// The DELETE implicit-row-reappearance case and the PATCH create-on-mark-paid case are regression
// properties that only a real document round-trip proves — a mocked store would trivially return
// whatever a stub was told to, proving nothing about whether updateUserCreditData's real
// { ...data, cycles } replace-and-persist cycle genuinely reflects the mutated cycles array back
// out through a subsequent GET's own re-derivation via buildRevolvingCycles().
//
// Every buildRevolvingCycles()/summariseRevolving() literal hard-coded below was independently
// re-verified against the real functions via a throwaway jest test (__tests__/_scratch_verify_
// revolving.test.js, deleted after verification) importing creditCardUtils.js directly and
// console.logging its output for each of this file's own seed shapes (the 3-month carry-forward
// chain, the truncation literal, the implicit gap-fill / skip-not-break literals, and — most
// importantly — the DELETE implicit-row-reappearance post-delete literal) — every value below
// matches that live output digit-for-digit. See .pipeline/changes-td-c01-api-coverage-11.md for
// the verification transcript.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMocks } from 'node-mocks-http';
import {
  MAX_REVOLVING_CYCLES_PER_CARD,
  getCurrentMonthKey,
  addMonths,
  round2,
  buildRevolvingCycles,
  summariseRevolving
} from '../../../src/shared/utils/creditCardUtils';

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

  handler = require('../../../pages/api/credit-cards/revolving').default;
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

/** Identical shape to slices #9/#10's own helper — same collaborator (sessionCookie), same gate
 * (assertUserId), reused verbatim rather than re-invented. */
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
 * validation entirely, mirroring slices #9/#10's own "seed the shared collaborator directly"
 * pattern. */
async function seedCreditDoc(userId, { cards = [], plans = [], cycles = [] } = {}) {
  await db.collection('credit_cards').updateOne(
    { userId },
    { $set: { userId, cards, plans, cycles, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
}

/** Minimal valid card shape. */
function makeCard(overrides = {}) {
  return {
    id: 'cc_a',
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

// --- buildRevolvingCycles() literals, independently re-verified against the live function ------
// (see file-header comment; every value below was confirmed digit-for-digit against a real
// buildRevolvingCycles() call before being hard-coded here — verification transcript in
// .pipeline/changes-td-c01-api-coverage-11.md).

// Card cc_a used by the 3-month carry-forward chain and the DELETE implicit-row-reappearance case.
// annualRate: 12 => monthlyRate = 12/100/12 = 0.01 exactly.
const CARD_A = { annualRate: 12, minPaymentPercent: 10 };

// Row 1 (2099-01): newSpend 1000, paymentAction null (undecided).
const ROW1 = {
  cardId: 'cc_a', month: '2099-01', newSpend: 1000, carriedBalance: 0, totalDue: 1000,
  minPaymentDue: 100, paymentAction: null, amountDue: 1000, paidAmount: 0, interest: 0,
  closingBalance: 1000,
  minimumPreview: { remaining: 900, interest: 9, closingBalance: 909 },
  stored: true, isImplicit: false
};

// Row 2 (2099-02): newSpend 500, paymentAction 'minimum'.
const ROW2 = {
  cardId: 'cc_a', month: '2099-02', newSpend: 500, carriedBalance: 1000, totalDue: 1500,
  minPaymentDue: 150, paymentAction: 'minimum', amountDue: 150, paidAmount: 150, interest: 13.5,
  closingBalance: 1363.5,
  minimumPreview: { remaining: 1350, interest: 13.5, closingBalance: 1363.5 },
  stored: true, isImplicit: false
};

// Row 3 (2099-03): newSpend 0, paymentAction 'full'.
const ROW3 = {
  cardId: 'cc_a', month: '2099-03', newSpend: 0, carriedBalance: 1363.5, totalDue: 1363.5,
  minPaymentDue: 136.35, paymentAction: 'full', amountDue: 1363.5, paidAmount: 1363.5, interest: 0,
  closingBalance: 0,
  minimumPreview: { remaining: 1227.15, interest: 12.27, closingBalance: 1239.42 },
  stored: true, isImplicit: false
};

const THREE_MONTH_CYCLES = [
  { cardId: 'cc_a', month: '2099-01', newSpend: 1000, paymentAction: null },
  { cardId: 'cc_a', month: '2099-02', newSpend: 500, paymentAction: 'minimum' },
  { cardId: 'cc_a', month: '2099-03', newSpend: 0, paymentAction: 'full' }
];

// Post-DELETE-of-2099-02 literal (Design section's corrected derivation, re-verified against live
// source): deleting the middle month loses both its newSpend (500 -> 0, implicit) AND its
// paymentAction (implicit rows are always undecided) — this recomputes row 2's own closingBalance
// from 1363.5 down to 1000, which is what row 3 inherits as its own carriedBalance.
const ROW2_AFTER_DELETE = {
  cardId: 'cc_a', month: '2099-02', newSpend: 0, carriedBalance: 1000, totalDue: 1000,
  minPaymentDue: 100, paymentAction: null, amountDue: 1000, paidAmount: 0, interest: 0,
  closingBalance: 1000,
  minimumPreview: { remaining: 900, interest: 9, closingBalance: 909 },
  stored: false, isImplicit: true
};
const ROW3_AFTER_DELETE = {
  cardId: 'cc_a', month: '2099-03', newSpend: 0, carriedBalance: 1000, totalDue: 1000,
  minPaymentDue: 100, paymentAction: 'full', amountDue: 1000, paidAmount: 1000, interest: 0,
  closingBalance: 0,
  minimumPreview: { remaining: 900, interest: 9, closingBalance: 909 },
  stored: true, isImplicit: false
};

/** Asserts every field of a derived cycle row (not a partial subset) — AC-4/AC-5. */
function expectRow(actual, expected) {
  expect(actual.cardId).toBe(expected.cardId);
  expect(actual.month).toBe(expected.month);
  expect(actual.newSpend).toBe(expected.newSpend);
  expect(actual.carriedBalance).toBe(expected.carriedBalance);
  expect(actual.totalDue).toBe(expected.totalDue);
  expect(actual.minPaymentDue).toBe(expected.minPaymentDue);
  expect(actual.paymentAction).toBe(expected.paymentAction);
  expect(actual.amountDue).toBe(expected.amountDue);
  expect(actual.paidAmount).toBe(expected.paidAmount);
  expect(actual.interest).toBe(expected.interest);
  expect(actual.closingBalance).toBe(expected.closingBalance);
  expect(actual.minimumPreview).toEqual(expected.minimumPreview);
  expect(actual.stored).toBe(expected.stored);
  expect(actual.isImplicit).toBe(expected.isImplicit);
}

describe('/api/credit-cards/revolving (Mongo mode, real DB)', () => {
  // --- GET ---------------------------------------------------------------------------------

  it('1. GET with zero cycles returns 200 with empty cycles/zero summary', async () => {
    await seedCreditDoc(USER_A, { cards: [makeCard()] });
    const { req, res } = makeReqRes();

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({
      cycles: [],
      truncated: false,
      summary: { outstanding: 0, due: 0, minDue: 0, carryForward: 0 }
    });
  });

  it('2. GET with a cardId not owned by the caller returns 404', async () => {
    await seedCreditDoc(USER_A, { cards: [makeCard({ id: 'cc_a' })] });
    const { req, res } = makeReqRes({ query: { cardId: 'cc_missing' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData())).toEqual({ error: 'card not found' });
  });

  it('3. GET un-filtered returns the full 3-month carry-forward chain with every field per row', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ id: 'cc_a', ...CARD_A })],
      cycles: THREE_MONTH_CYCLES
    });
    const { req, res } = makeReqRes();

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.cycles).toHaveLength(3);
    expectRow(body.cycles[0], ROW1);
    expectRow(body.cycles[1], ROW2);
    expectRow(body.cycles[2], ROW3);
    // materialise() decoration — key/cardName/cardColor/cardDueDay from the owning card.
    body.cycles.forEach(cycle => {
      expect(cycle.key).toBe('ccr_a');
      expect(cycle.cardName).toBe('บัตร A');
      expect(cycle.cardColor).toBe('#5d5bff');
      expect(cycle.cardDueDay).toBe(20);
    });
    expect(body.truncated).toBe(false);
  });

  it('4. GET with ?month= narrows the response to a single row but truncated still reflects the full chain', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ id: 'cc_a', ...CARD_A })],
      cycles: THREE_MONTH_CYCLES
    });
    const { req, res } = makeReqRes({ query: { month: '2099-02' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.cycles).toHaveLength(1);
    expectRow(body.cycles[0], ROW2);
    expect(body.truncated).toBe(false);
  });

  it('5. GET truncation: two stored cycles >59 months apart sets truncated=true and excludes the far one', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ id: 'cc_a' })],
      cycles: [
        { cardId: 'cc_a', month: '2090-01', newSpend: 5000, paymentAction: 'full' },
        { cardId: 'cc_a', month: '2099-01', newSpend: 200, paymentAction: null }
      ]
    });
    const { req, res } = makeReqRes({ query: { cardId: 'cc_a', month: '2099-01' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.truncated).toBe(true);
    expect(body.cycles).toHaveLength(1);
    expect(body.cycles[0].month).toBe('2099-01');
    expect(body.cycles[0].carriedBalance).toBe(0);
  });

  it('6. GET implicit-row gap-fill: a non-stored month with carried !== 0 appears as an implicit row', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ id: 'cc_b', annualRate: 0 })],
      cycles: [
        { cardId: 'cc_b', month: '2099-01', newSpend: 300, paymentAction: null },
        { cardId: 'cc_b', month: '2099-03', newSpend: 100, paymentAction: null }
      ]
    });
    const { req, res } = makeReqRes();

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.cycles).toHaveLength(3);
    expect(body.cycles.map(c => c.month)).toEqual(['2099-01', '2099-02', '2099-03']);
    const implicitRow = body.cycles[1];
    expect(implicitRow.stored).toBe(false);
    expect(implicitRow.isImplicit).toBe(true);
    expect(implicitRow.newSpend).toBe(0);
    expect(implicitRow.carriedBalance).toBe(300);
  });

  it('7. GET skip-not-break: a gap month with carried === 0 is skipped but a later stored month still appears', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ id: 'cc_b', annualRate: 0 })],
      cycles: [
        { cardId: 'cc_b', month: '2099-05', newSpend: 200, paymentAction: 'full' },
        { cardId: 'cc_b', month: '2099-07', newSpend: 50, paymentAction: null }
      ]
    });
    const { req, res } = makeReqRes();

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.cycles).toHaveLength(2);
    expect(body.cycles.map(c => c.month)).toEqual(['2099-05', '2099-07']);
    const row2099_07 = body.cycles[1];
    expect(row2099_07.carriedBalance).toBe(0);
  });

  it('8. GET summary sums due across every card in the document', async () => {
    // Deliberately anchored to the real current month (not 2099) — this is the one test in this
    // file allowed to depend on getCurrentMonthKey(), per the spec's own Design section, since it
    // asserts only internal self-consistency (route's summary === sum of the two cards' own
    // already-computed `due`, both derived via the same production functions the route itself
    // calls) rather than a hard-coded literal tied to a specific calendar month.
    const now = getCurrentMonthKey();
    const m1 = addMonths(now, -2);
    const m2 = addMonths(now, -1);
    const m3 = now;

    const cardA = makeCard({ id: 'cc_a', ...CARD_A });
    const cardB = makeCard({ id: 'cc_b', annualRate: 0 });
    const cyclesA = [
      { cardId: 'cc_a', month: m1, newSpend: 1000, paymentAction: null },
      { cardId: 'cc_a', month: m2, newSpend: 500, paymentAction: 'minimum' },
      { cardId: 'cc_a', month: m3, newSpend: 0, paymentAction: 'full' }
    ];
    const cyclesB = [
      { cardId: 'cc_b', month: m3, newSpend: 250, paymentAction: null }
    ];
    await seedCreditDoc(USER_A, { cards: [cardA, cardB], cycles: [...cyclesA, ...cyclesB] });

    // Independent re-derivation via the real production functions (not the route, not by hand) —
    // proves the route's own summariseAll() wiring sums both cards correctly, without introducing
    // a second hand-arithmetic error source.
    const chainA = buildRevolvingCycles(cardA, cyclesA, { throughMonth: m3 });
    const chainB = buildRevolvingCycles(cardB, cyclesB, { throughMonth: m3 });
    const summaryA = summariseRevolving(chainA, { asOfMonth: m3 });
    const summaryB = summariseRevolving(chainB, { asOfMonth: m3 });
    const expectedDue = round2(summaryA.due + summaryB.due);

    const { req, res } = makeReqRes();
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.summary.due).toBe(expectedDue);
  });

  it('9. GET cross-user isolation — a cardId belonging to USER_A is not found under USER_B', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ id: 'cc_a' })],
      cycles: [{ cardId: 'cc_a', month: '2099-01', newSpend: 100, paymentAction: null }]
    });

    const { req, res } = makeReqRes({ userId: USER_B, query: { cardId: 'cc_a' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData())).toEqual({ error: 'card not found' });
  });

  // --- POST ---------------------------------------------------------------------------------

  it('10. POST with a missing CSRF token returns 403 and does not write', async () => {
    await seedCreditDoc(USER_A, { cards: [makeCard({ id: 'cc_a' })] });
    const { req, res } = makeReqRes({
      method: 'POST',
      omitCsrf: true,
      body: { cycle: { cardId: 'cc_a', month: '2099-01', newSpend: 100 } }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(403);
    const doc = await db.collection('credit_cards').findOne({ userId: USER_A });
    expect(doc.cycles).toEqual([]);
  });

  it('11. POST with a missing/non-object cycle returns 400', async () => {
    const { req, res } = makeReqRes({ method: 'POST', body: {} });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'cycle payload required' });
  });

  it('12. POST with validateRevolvingCycleInput failure returns 400 with all three errors keys', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { cycle: { cardId: '', month: 'not-a-month', newSpend: -5 } }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({
      error: 'ข้อมูลยอดใช้จ่ายหมุนเวียนไม่ถูกต้อง',
      errors: {
        cardId: 'กรุณาเลือกบัตร',
        month: 'เดือนต้องอยู่ในรูปแบบ YYYY-MM',
        newSpend: 'ยอดใช้จ่ายต้องเป็นตัวเลขไม่ติดลบ'
      }
    });
  });

  it('13. POST with a nonexistent cardId returns 404 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { cycle: { cardId: 'cc_missing', month: '2099-01', newSpend: 100 } }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData())).toEqual({ error: 'card not found' });
    const doc = await db.collection('credit_cards').findOne({ userId: USER_A });
    expect(doc?.cycles ?? []).toEqual([]);
  });

  it('14. MAX_REVOLVING_CYCLES_PER_CARD cap on a genuinely new month returns 409, plan document untouched', async () => {
    const cycles = Array.from({ length: MAX_REVOLVING_CYCLES_PER_CARD }, (_, i) => ({
      cardId: 'cc_a',
      month: `${2001 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
      newSpend: 10,
      paymentAction: null
    }));
    await seedCreditDoc(USER_A, { cards: [makeCard({ id: 'cc_a' })], cycles });

    const { req, res } = makeReqRes({
      method: 'POST',
      body: { cycle: { cardId: 'cc_a', month: '2006-01', newSpend: 50 } }
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(409);
    expect(JSON.parse(res._getData())).toEqual({
      error: `บันทึกยอดหมุนเวียนได้สูงสุด ${MAX_REVOLVING_CYCLES_PER_CARD} เดือนต่อบัตร`
    });

    const doc = await db.collection('credit_cards').findOne({ userId: USER_A });
    expect(doc.cycles).toHaveLength(MAX_REVOLVING_CYCLES_PER_CARD);

    const { req: getReq, res: getRes } = makeReqRes({ query: { cardId: 'cc_a', month: '2001-01' } });
    await handler(getReq, getRes);
    expect(getRes._getStatusCode()).toBe(200);
  });

  it('15. POST create-success persists only cardId/month/newSpend — every other body field is discarded', async () => {
    await seedCreditDoc(USER_A, { cards: [makeCard({ id: 'cc_a' })] });
    const { req, res } = makeReqRes({
      method: 'POST',
      body: {
        cycle: {
          cardId: 'cc_a',
          month: '2099-01',
          newSpend: 1000,
          paymentAction: 'full',
          totalDue: 999999
        }
      }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.success).toBe(true);
    expect(body.truncated).toBe(false);
    expect(body.summary).toBeTruthy();

    const doc = await db.collection('credit_cards').findOne({ userId: USER_A });
    expect(doc.cycles).toHaveLength(1);
    const stored = doc.cycles[0];
    expect(Object.keys(stored).sort()).toEqual(
      ['id', 'cardId', 'month', 'newSpend', 'paymentAction', 'paidAt', 'paidSource', 'createdAt', 'updatedAt'].sort()
    );
    expect(stored.cardId).toBe('cc_a');
    expect(stored.month).toBe('2099-01');
    expect(stored.newSpend).toBe(1000);
    expect(stored.paymentAction).toBeNull();
    expect(stored.paidAt).toBeNull();
    expect(stored.paidSource).toBeNull();
  });

  it('16. POST update-success replaces newSpend via upsert, not a duplicate insert', async () => {
    await seedCreditDoc(USER_A, { cards: [makeCard({ id: 'cc_a' })] });
    const { req: req1, res: res1 } = makeReqRes({
      method: 'POST',
      body: { cycle: { cardId: 'cc_a', month: '2099-01', newSpend: 1000, paymentAction: 'full' } }
    });
    await handler(req1, res1);
    expect(res1._getStatusCode()).toBe(200);
    const firstDoc = await db.collection('credit_cards').findOne({ userId: USER_A });
    const firstId = firstDoc.cycles[0].id;
    const firstUpdatedAt = firstDoc.cycles[0].updatedAt;

    // Ensure a distinguishable updatedAt tick.
    await new Promise(resolve => setTimeout(resolve, 5));

    const { req: req2, res: res2 } = makeReqRes({
      method: 'POST',
      body: { cycle: { cardId: 'cc_a', month: '2099-01', newSpend: 750 } }
    });
    await handler(req2, res2);

    expect(res2._getStatusCode()).toBe(200);
    const doc = await db.collection('credit_cards').findOne({ userId: USER_A });
    expect(doc.cycles).toHaveLength(1);
    expect(doc.cycles[0].id).toBe(firstId);
    expect(doc.cycles[0].newSpend).toBe(750);
    expect(doc.cycles[0].updatedAt).not.toBe(firstUpdatedAt);
  });

  // --- PATCH ---------------------------------------------------------------------------------

  it('17. PATCH with missing/malformed cardId or month returns 400', async () => {
    const { req, res } = makeReqRes({ method: 'PATCH', body: { cardId: '', month: 'bad' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'cardId and month required' });
  });

  it('18. PATCH with an invalid paymentAction returns 400', async () => {
    await seedCreditDoc(USER_A, { cards: [makeCard({ id: 'cc_a' })] });
    const { req, res } = makeReqRes({
      method: 'PATCH',
      body: { cardId: 'cc_a', month: '2099-01', paymentAction: 'partial' }
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'paymentAction ต้องเป็น full, minimum หรือ null' });
  });

  it('19. PATCH with a nonexistent cardId returns 404', async () => {
    const { req, res } = makeReqRes({
      method: 'PATCH',
      body: { cardId: 'cc_missing', month: '2099-01', paymentAction: 'full' }
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData())).toEqual({ error: 'card not found' });
  });

  it('20. PATCH create-on-patch: marking a never-recorded month paid auto-fills newSpend: 0', async () => {
    await seedCreditDoc(USER_A, { cards: [makeCard({ id: 'cc_a' })] });
    const { req, res } = makeReqRes({
      method: 'PATCH',
      body: { cardId: 'cc_a', month: '2099-01', paymentAction: 'minimum' }
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const doc = await db.collection('credit_cards').findOne({ userId: USER_A });
    expect(doc.cycles).toHaveLength(1);
    const stored = doc.cycles[0];
    expect(stored.newSpend).toBe(0);
    expect(stored.paymentAction).toBe('minimum');
    expect(typeof stored.paidAt).toBe('string');
    expect(stored.paidAt).not.toBeNull();
    expect(stored.paidSource).toBe('credit_card');
  });

  it('21. PATCH toggles an existing month\'s paymentAction from null to minimum', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ id: 'cc_a' })],
      cycles: [{ cardId: 'cc_a', month: '2099-01', newSpend: 1000, paymentAction: null, paidAt: null, paidSource: null }]
    });
    const { req, res } = makeReqRes({
      method: 'PATCH',
      body: { cardId: 'cc_a', month: '2099-01', paymentAction: 'minimum' }
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const doc = await db.collection('credit_cards').findOne({ userId: USER_A });
    const stored = doc.cycles[0];
    expect(stored.paymentAction).toBe('minimum');
    expect(typeof stored.paidAt).toBe('string');
    expect(stored.paidAt).not.toBeNull();
    expect(stored.paidSource).toBe('credit_card');
  });

  it('22. PATCH toggles minimum back to null, clearing paidAt/paidSource', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ id: 'cc_a' })],
      cycles: [{
        cardId: 'cc_a', month: '2099-01', newSpend: 1000, paymentAction: 'minimum',
        paidAt: new Date().toISOString(), paidSource: 'credit_card'
      }]
    });
    const { req, res } = makeReqRes({
      method: 'PATCH',
      body: { cardId: 'cc_a', month: '2099-01', paymentAction: null }
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const doc = await db.collection('credit_cards').findOne({ userId: USER_A });
    const stored = doc.cycles[0];
    expect(stored.paymentAction).toBeNull();
    expect(stored.paidAt).toBeNull();
    expect(stored.paidSource).toBeNull();
  });

  it('23. PATCH create-on-patch also enforces the cap on a brand-new month', async () => {
    const cycles = Array.from({ length: MAX_REVOLVING_CYCLES_PER_CARD }, (_, i) => ({
      cardId: 'cc_b',
      month: `${2001 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
      newSpend: 10,
      paymentAction: null
    }));
    await seedCreditDoc(USER_A, { cards: [makeCard({ id: 'cc_b' })], cycles });

    const { req, res } = makeReqRes({
      method: 'PATCH',
      body: { cardId: 'cc_b', month: '2006-01', paymentAction: 'full' }
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(409);
    expect(JSON.parse(res._getData())).toEqual({
      error: `บันทึกยอดหมุนเวียนได้สูงสุด ${MAX_REVOLVING_CYCLES_PER_CARD} เดือนต่อบัตร`
    });
    const doc = await db.collection('credit_cards').findOne({ userId: USER_A });
    expect(doc.cycles).toHaveLength(MAX_REVOLVING_CYCLES_PER_CARD);
  });

  // --- DELETE -------------------------------------------------------------------------------

  it('24. DELETE with missing/malformed cardId or month returns 400', async () => {
    const { req, res } = makeReqRes({ method: 'DELETE', body: { cardId: '', month: 'bad' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'cardId and month required' });
  });

  it('25. DELETE with a nonexistent cardId returns 404', async () => {
    const { req, res } = makeReqRes({ method: 'DELETE', body: { cardId: 'cc_missing', month: '2099-01' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData())).toEqual({ error: 'card not found' });
  });

  it('26. DELETE the only stored month for a card empties the chain entirely', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ id: 'cc_a' })],
      cycles: [{ cardId: 'cc_a', month: '2099-01', newSpend: 100, paymentAction: null }]
    });
    const { req, res } = makeReqRes({ method: 'DELETE', body: { cardId: 'cc_a', month: '2099-01' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.success).toBe(true);
    expect(body.cycles).toEqual([]);
    expect(body.truncated).toBe(false);

    const { req: getReq, res: getRes } = makeReqRes();
    await handler(getReq, getRes);
    expect(JSON.parse(getRes._getData()).cycles).toEqual([]);
  });

  it('27. DELETE of a well-formed but never-stored {cardId, month} pair is a no-op success', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ id: 'cc_a' })],
      cycles: [{ cardId: 'cc_a', month: '2099-01', newSpend: 100, paymentAction: null }]
    });
    const { req, res } = makeReqRes({ method: 'DELETE', body: { cardId: 'cc_a', month: '2050-06' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.success).toBe(true);
    const doc = await db.collection('credit_cards').findOne({ userId: USER_A });
    expect(doc.cycles).toHaveLength(1);
  });

  it('28. DELETE the middle month of a 3-month chain: it reappears as an implicit row and the following month recomputes', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ id: 'cc_a', ...CARD_A })],
      cycles: THREE_MONTH_CYCLES
    });
    const { req, res } = makeReqRes({ method: 'DELETE', body: { cardId: 'cc_a', month: '2099-02' } });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);

    const { req: getReq, res: getRes } = makeReqRes();
    await handler(getReq, getRes);
    expect(getRes._getStatusCode()).toBe(200);
    const body = JSON.parse(getRes._getData());
    expect(body.cycles).toHaveLength(3);
    expectRow(body.cycles[0], ROW1);
    // Post-delete recomputed values (per the spec's Design section's corrected derivation) — NOT
    // the original pre-delete chain's values (carriedBalance 1363.5). AC-5.
    expectRow(body.cycles[1], ROW2_AFTER_DELETE);
    expectRow(body.cycles[2], ROW3_AFTER_DELETE);
  });

  // --- unsupported method / catch -------------------------------------------------------------

  it('29. Unsupported method (PUT) returns 405 with a JSON body and the 4-method Allow header', async () => {
    const { req, res } = makeReqRes({ method: 'PUT' });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Method not allowed' });
    // node-mocks-http lower-cases header names, same convention every prior slice's own test uses.
    // This route has no PUT (unlike plans.js's 5-method list) — must not copy that array verbatim.
    expect(res._getHeaders().allow).toEqual(['GET', 'POST', 'PATCH', 'DELETE']);
  });
});

describe('/api/credit-cards/revolving (isolated mocked-collaborator test — the one sanctioned exception)', () => {
  // This is the only test in this file that mocks a collaborator module. It is scoped to its own
  // describe block via jest.isolateModules so the mock never leaks into the real-DB tests above.
  // The top-level catch -> 500 branch cannot be exercised by seeding/withholding real documents —
  // it requires the collaborator to actually throw, which is the class of case
  // CODING_STANDARD.md's "mock a collaborator, not the DB" carve-out exists for (same pattern
  // slices #9/#10 used for their own 500 tests).
  it('30. getUserCreditData() throwing returns 500 with the exact Thai error body', async () => {
    let isolatedHandler;

    jest.isolateModules(() => {
      jest.doMock('../../../src/shared/utils/backend/creditCardStore', () => ({
        getUserCreditData: jest.fn().mockRejectedValue(new Error('boom')),
        updateUserCreditData: jest.fn().mockRejectedValue(new Error('boom'))
      }));
      isolatedHandler = require('../../../pages/api/credit-cards/revolving').default;
    });

    const { req, res } = makeReqRes();
    await isolatedHandler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(JSON.parse(res._getData())).toEqual({ error: 'ไม่สามารถจัดการยอดใช้จ่ายหมุนเวียนได้' });

    // Ensure the mock does not leak into any other test in this file (or process).
    jest.dontMock('../../../src/shared/utils/backend/creditCardStore');
  });
});
