/** @jest-environment node */
// Integration test against a real (ephemeral, in-process) MongoDB instance for every test case
// except the isolated getUserCreditData()/updateUserCreditData()-throw -> 500 case at the bottom
// of this file (see that describe block for why jest.mock('.../creditCardStore') is the one
// sanctioned exception here, per .pipeline/spec-td-c01-api-coverage-10.md and CODING_STANDARD.md's
// "mock a collaborator, not the DB" carve-out — same pattern slice #9 already used for
// credit-cards/index.js).
//
// The PUT financial-edit guard (paid-installments block re-validation) and the PATCH
// status-transition (resolvePlanStatus) are regression properties that only a real document
// round-trip proves — a mocked store would trivially return whatever a stub was told to, proving
// nothing about whether updateUserCreditData's real { ...data, plans } replace-and-persist cycle
// genuinely reflects the mutated schedule array back out through a subsequent GET.
//
// buildSchedule() literals below were independently re-verified against the real function via a
// throwaway jest test (deleted after verification) importing creditCardUtils.js directly and
// console.logging its output for each of the four inputs this file hard-codes assertions for
// (manual/flat/effective create cases, plus the PUT-financial-edit-recompute case) — every value
// below matches that live output digit-for-digit. See .pipeline/changes-td-c01-api-coverage-10.md
// for the verification transcript.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMocks } from 'node-mocks-http';
import { MAX_ACTIVE_PLANS_PER_USER } from '../../../src/shared/utils/creditCardUtils';

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

  handler = require('../../../pages/api/credit-cards/plans').default;
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

/** Identical shape to slice #9's own helper — same collaborator (sessionCookie), same gate
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
 * validation entirely, mirroring slice #9's own "seed the shared collaborator directly" pattern.
 * Every seeded card/plan here is a minimal, hand-constructed shape sufficient for this route's
 * own blocking logic — NOT necessarily a realistic buildSchedule() output (except where a test
 * explicitly seeds one of this file's own re-verified schedule literals). */
async function seedCreditDoc(userId, { cards = [], plans = [], cycles = [] } = {}) {
  await db.collection('credit_cards').updateOne(
    { userId },
    { $set: { userId, cards, plans, cycles, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
}

/** Minimal valid card shape — every plans.js handler needs data.cards to contain the plan's own
 * cardId for the "card not found" checks to pass, even though this route never mutates cards. */
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

// --- buildSchedule() literals, independently re-verified against the live function -----------
// (see file-header comment; every value below was confirmed digit-for-digit against a real
// buildSchedule() call before being hard-coded here).

const MANUAL_SCHEDULE = [
  { no: 1, dueMonth: '2026-01', payment: 333.33, principal: 333.33, interest: 0, paid: false, paidAt: null, paidSource: null },
  { no: 2, dueMonth: '2026-02', payment: 333.33, principal: 333.33, interest: 0, paid: false, paidAt: null, paidSource: null },
  { no: 3, dueMonth: '2026-03', payment: 333.34, principal: 333.34, interest: 0, paid: false, paidAt: null, paidSource: null }
];

const FLAT_SCHEDULE = Array.from({ length: 12 }, (_, i) => ({
  no: i + 1,
  dueMonth: `2026-${String(i + 1).padStart(2, '0')}`,
  payment: 112,
  principal: 100,
  interest: 12,
  paid: false,
  paidAt: null,
  paidSource: null
}));

const EFFECTIVE_SCHEDULE = [
  { no: 1, dueMonth: '2026-01', payment: 169, principal: 144, interest: 25, paid: false, paidAt: null, paidSource: null },
  { no: 2, dueMonth: '2026-02', payment: 169, principal: 156, interest: 13, paid: false, paidAt: null, paidSource: null }
];

const PUT_RECOMPUTE_SCHEDULE = [
  { no: 1, dueMonth: '2026-01', payment: 500, principal: 500, interest: 0, paid: false, paidAt: null, paidSource: null },
  { no: 2, dueMonth: '2026-02', payment: 500, principal: 500, interest: 0, paid: false, paidAt: null, paidSource: null }
];

/** Full composePlan()-shaped seed for the manual case — reused as the PUT-recompute starting
 * point (test 20) and the non-financial-edit starting point (test 17 reuses its own shape). */
function manualPlanSeed(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: 'ip_manual',
    cardId: 'cc_a',
    itemName: 'ของใช้',
    totalPrice: 1000,
    months: 3,
    startMonth: '2026-01',
    interestMode: 'manual',
    manualFeePerMonth: 0,
    annualRate: 0,
    calcMethod: null,
    monthlyPayment: 333.33,
    totalInterest: 0,
    totalPayable: 1000,
    schedule: MANUAL_SCHEDULE,
    status: 'ongoing',
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe('/api/credit-cards/plans (Mongo mode, real DB)', () => {
  // --- GET ---------------------------------------------------------------------------------

  it('1. GET with zero plans returns 200 with { plans: [] }', async () => {
    await seedCreditDoc(USER_A, { cards: [makeCard()] });
    const { req, res } = makeReqRes();

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ plans: [] });
  });

  it('2. GET with a cardId filter returns only that card\'s plan(s)', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ id: 'cc_a' }), makeCard({ id: 'cc_b' })],
      plans: [
        { id: 'ip_a', cardId: 'cc_a', itemName: 'A', schedule: [] },
        { id: 'ip_b', cardId: 'cc_b', itemName: 'B', schedule: [] }
      ]
    });

    const { req, res } = makeReqRes({ query: { cardId: 'cc_a' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.plans).toHaveLength(1);
    expect(body.plans[0].id).toBe('ip_a');
  });

  it('3. GET with a status filter returns only plans matching that status', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ id: 'cc_a' })],
      plans: [
        { id: 'ip_ongoing', cardId: 'cc_a', itemName: 'Ongoing', status: 'ongoing', schedule: [] },
        { id: 'ip_completed', cardId: 'cc_a', itemName: 'Completed', status: 'completed', schedule: [] }
      ]
    });

    const { req, res } = makeReqRes({ query: { status: 'ongoing' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.plans).toHaveLength(1);
    expect(body.plans[0].id).toBe('ip_ongoing');
  });

  it('4. GET with cardId + status combined returns only the plan matching both', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ id: 'cc_a' }), makeCard({ id: 'cc_b' })],
      plans: [
        { id: 'ip_1', cardId: 'cc_a', itemName: '1', status: 'ongoing', schedule: [] },
        { id: 'ip_2', cardId: 'cc_a', itemName: '2', status: 'completed', schedule: [] },
        { id: 'ip_3', cardId: 'cc_b', itemName: '3', status: 'ongoing', schedule: [] }
      ]
    });

    const { req, res } = makeReqRes({ query: { cardId: 'cc_a', status: 'ongoing' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.plans).toHaveLength(1);
    expect(body.plans[0].id).toBe('ip_1');
  });

  it('5. GET with a month filter returns the { plans, items } dual shape, exercising all three buildMonthInstallmentItems branches plus the orphan-plan plans-vs-items distinction', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ id: 'cc_m' })],
      plans: [
        {
          id: 'ip_ok',
          cardId: 'cc_m',
          itemName: 'ปกติ',
          status: 'ongoing',
          schedule: [{ no: 1, dueMonth: '2026-03', payment: 100, principal: 100, interest: 0, paid: false, paidAt: null, paidSource: null }]
        },
        {
          id: 'ip_cancelled_unpaid',
          cardId: 'cc_m',
          itemName: 'ยกเลิก-ยังไม่จ่าย',
          status: 'cancelled_early',
          schedule: [{ no: 1, dueMonth: '2026-03', payment: 200, principal: 200, interest: 0, paid: false, paidAt: null, paidSource: null }]
        },
        {
          id: 'ip_cancelled_paid',
          cardId: 'cc_m',
          itemName: 'ยกเลิก-จ่ายแล้ว',
          status: 'cancelled_early',
          schedule: [{ no: 1, dueMonth: '2026-03', payment: 300, principal: 300, interest: 0, paid: true, paidAt: new Date().toISOString(), paidSource: 'credit_card' }]
        },
        {
          id: 'ip_orphan',
          cardId: 'cc_missing',
          itemName: 'บัตรหาย',
          status: 'ongoing',
          schedule: [{ no: 1, dueMonth: '2026-03', payment: 400, principal: 400, interest: 0, paid: false, paidAt: null, paidSource: null }]
        }
      ]
    });

    const { req, res } = makeReqRes({ query: { month: '2026-03' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());

    // items: buildMonthInstallmentItems's own three branches — card-missing row skipped
    // (orphan), cancelled-plan unpaid row skipped (BR-CC-010), cancelled-plan paid row included.
    expect(body.items).toHaveLength(2);
    expect(body.items.map(item => item.planId).sort()).toEqual(['ip_cancelled_paid', 'ip_ok']);

    // plans: handleGet's own mapping is a structurally different code path — it never checks
    // card existence, only whether the plan's own schedule has a row matching `month`. All four
    // seeded plans have such a row, so all four appear here with a dueInstallment attached,
    // including the orphan (present in `plans`, absent from `items` — the branch-interaction
    // this test targets).
    expect(body.plans).toHaveLength(4);
    body.plans.forEach(plan => {
      expect(plan.dueInstallment).toBeTruthy();
      expect(plan.dueInstallment.dueMonth).toBe('2026-03');
    });
    const orphanPlan = body.plans.find(plan => plan.id === 'ip_orphan');
    expect(orphanPlan).toBeTruthy();
    expect(orphanPlan.dueInstallment.payment).toBe(400);
  });

  it('6. GET cross-user isolation — USER_B sees no trace of USER_A plans', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard({ id: 'cc_a' })],
      plans: [{ id: 'ip_a', cardId: 'cc_a', itemName: 'A', schedule: [] }]
    });

    const { req, res } = makeReqRes({ userId: USER_B });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ plans: [] });
  });

  // --- POST ---------------------------------------------------------------------------------

  it('7. POST with a missing CSRF token returns 403 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      omitCsrf: true,
      body: { plan: { itemName: 'x' } }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(403);
    expect(await db.collection('credit_cards').countDocuments({})).toBe(0);
  });

  it('8. POST with a missing/non-object plan returns 400', async () => {
    const { req, res } = makeReqRes({ method: 'POST', body: {} });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'plan payload required' });
  });

  it('9. POST with validatePlanInput failure (empty itemName) returns 400 with errors.itemName', async () => {
    await seedCreditDoc(USER_A, { cards: [makeCard()] });
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { plan: { cardId: 'cc_a', itemName: '', totalPrice: 100, months: 1, startMonth: '2026-01', interestMode: 'manual' } }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({
      error: 'ข้อมูลแผนผ่อนไม่ถูกต้อง',
      errors: { itemName: 'กรุณาระบุชื่อสินค้า' }
    });
  });

  it('10. POST with a nonexistent cardId returns 404 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { plan: { cardId: 'cc_missing', itemName: 'x', totalPrice: 100, months: 1, startMonth: '2026-01', interestMode: 'manual' } }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData())).toEqual({ error: 'card not found' });
    const doc = await db.collection('credit_cards').findOne({ userId: USER_A });
    expect(doc?.plans ?? []).toEqual([]);
  });

  it('11. MAX_ACTIVE_PLANS_PER_USER cap returns 409 and a following GET still shows exactly 50 plans', async () => {
    const plans = Array.from({ length: MAX_ACTIVE_PLANS_PER_USER }, (_, i) => ({
      id: `ip_seed${i}`,
      cardId: 'cc_a',
      itemName: `แผน ${i}`,
      schedule: []
      // no `status` field — counts as active per countActivePlans's `plan?.status !== 'completed'` check
    }));
    await seedCreditDoc(USER_A, { cards: [makeCard()], plans });

    const { req, res } = makeReqRes({
      method: 'POST',
      body: { plan: { cardId: 'cc_a', itemName: 'ที่ 51', totalPrice: 100, months: 1, startMonth: '2026-01', interestMode: 'manual' } }
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(409);
    expect(JSON.parse(res._getData())).toEqual({
      error: `เพิ่มแผนผ่อนที่ยังไม่จบได้สูงสุด ${MAX_ACTIVE_PLANS_PER_USER} แผน`
    });

    const { req: getReq, res: getRes } = makeReqRes();
    await handler(getReq, getRes);
    expect(JSON.parse(getRes._getData()).plans).toHaveLength(MAX_ACTIVE_PLANS_PER_USER);
  });

  it('12. POST create success — manual (flat-fee) mode computes the full schedule via buildSchedule()', async () => {
    await seedCreditDoc(USER_A, { cards: [makeCard()] });
    const { req, res } = makeReqRes({
      method: 'POST',
      body: {
        plan: {
          cardId: 'cc_a',
          itemName: 'ของใช้',
          totalPrice: 1000,
          months: 3,
          startMonth: '2026-01',
          interestMode: 'manual',
          manualFeePerMonth: 0
        }
      }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.plan.id).toMatch(/^ip_[0-9a-f]{12}$/);
    expect(body.plan.status).toBe('ongoing');
    expect(body.plan.cancelledAt).toBeNull();
    expect(body.plan.schedule).toEqual(MANUAL_SCHEDULE);
    expect(body.plan.monthlyPayment).toBe(333.33);
    expect(body.plan.totalInterest).toBe(0);
    expect(body.plan.totalPayable).toBe(1000);

    const { req: getReq, res: getRes } = makeReqRes();
    await handler(getReq, getRes);
    const getBody = JSON.parse(getRes._getData());
    expect(getBody.plans).toHaveLength(1);
    expect(getBody.plans[0].schedule).toEqual(MANUAL_SCHEDULE);
    expect(getBody.plans[0].totalPayable).toBe(1000);
  });

  it('13. POST create success — calculated/flat mode computes the full schedule via buildSchedule()', async () => {
    await seedCreditDoc(USER_A, { cards: [makeCard()] });
    const { req, res } = makeReqRes({
      method: 'POST',
      body: {
        plan: {
          cardId: 'cc_a',
          itemName: 'เครื่องใช้ไฟฟ้า',
          totalPrice: 1200,
          months: 12,
          startMonth: '2026-01',
          interestMode: 'calculated',
          calcMethod: 'flat',
          annualRate: 12
        }
      }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.plan.schedule).toEqual(FLAT_SCHEDULE);
    expect(body.plan.monthlyPayment).toBe(112);
    expect(body.plan.totalInterest).toBe(144);
    expect(body.plan.totalPayable).toBe(1344);
    // schedule[0] and schedule[11] (last row) are identical — the "no remainder to absorb" case.
    expect(body.plan.schedule[0]).toEqual({ ...body.plan.schedule[11], no: body.plan.schedule[0].no, dueMonth: body.plan.schedule[0].dueMonth });

    const { req: getReq, res: getRes } = makeReqRes();
    await handler(getReq, getRes);
    const getBody = JSON.parse(getRes._getData());
    expect(getBody.plans[0].schedule).toEqual(FLAT_SCHEDULE);
  });

  it('14. POST create success — calculated/effective mode computes the full schedule via buildSchedule()', async () => {
    await seedCreditDoc(USER_A, { cards: [makeCard()] });
    const { req, res } = makeReqRes({
      method: 'POST',
      body: {
        plan: {
          cardId: 'cc_a',
          itemName: 'โน้ตบุ๊ก',
          totalPrice: 300,
          months: 2,
          startMonth: '2026-01',
          interestMode: 'calculated',
          calcMethod: 'effective',
          annualRate: 100
        }
      }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.plan.schedule).toEqual(EFFECTIVE_SCHEDULE);
    expect(body.plan.monthlyPayment).toBe(169);
    expect(body.plan.totalInterest).toBe(38);
    expect(body.plan.totalPayable).toBe(338);
    // Independent cross-check: both rows equal, so totalPayable === monthlyPayment × 2 too.
    expect(body.plan.totalPayable).toBe(body.plan.monthlyPayment * 2);

    const { req: getReq, res: getRes } = makeReqRes();
    await handler(getReq, getRes);
    const getBody = JSON.parse(getRes._getData());
    expect(getBody.plans[0].schedule).toEqual(EFFECTIVE_SCHEDULE);
  });

  // --- PUT ---------------------------------------------------------------------------------

  it('15. PUT with missing planId/patch returns 400', async () => {
    const { req, res } = makeReqRes({ method: 'PUT', body: {} });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'planId and patch required' });
  });

  it('16. PUT with a nonexistent planId returns 404', async () => {
    const { req, res } = makeReqRes({ method: 'PUT', body: { planId: 'ip_missing', patch: { itemName: 'x' } } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData())).toEqual({ error: 'plan not found' });
  });

  it('17. PUT non-financial edit (itemName only) succeeds without recomputing the schedule', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard()],
      plans: [manualPlanSeed({ id: 'ip_rename', itemName: 'เดิม' })]
    });

    const { req, res } = makeReqRes({ method: 'PUT', body: { planId: 'ip_rename', patch: { itemName: 'ใหม่' } } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.plan.itemName).toBe('ใหม่');
    // Schedule is byte-for-byte unchanged from the seed — proves this branch never re-calls buildSchedule().
    expect(body.plan.schedule).toEqual(MANUAL_SCHEDULE);
  });

  it('18. PUT non-financial edit with an empty itemName returns 400', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard()],
      plans: [manualPlanSeed({ id: 'ip_rename2' })]
    });

    const { req, res } = makeReqRes({ method: 'PUT', body: { planId: 'ip_rename2', patch: { itemName: '' } } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({
      error: 'กรุณาระบุชื่อสินค้า',
      errors: { itemName: 'กรุณาระบุชื่อสินค้า' }
    });
  });

  it('19. PUT financial edit blocked by a paid installment (BR-CC-006) — fires before merge, schedule unchanged', async () => {
    const paidSchedule = MANUAL_SCHEDULE.map((row, i) => (i === 0 ? { ...row, paid: true, paidAt: new Date().toISOString(), paidSource: 'credit_card' } : row));
    await seedCreditDoc(USER_A, {
      cards: [makeCard()],
      plans: [manualPlanSeed({ id: 'ip_paid', schedule: paidSchedule })]
    });

    const { req, res } = makeReqRes({ method: 'PUT', body: { planId: 'ip_paid', patch: { months: 5 } } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(409);
    expect(JSON.parse(res._getData())).toEqual({ error: 'plan has paid installments', installmentsPaid: 1 });

    const { req: getReq, res: getRes } = makeReqRes();
    await handler(getReq, getRes);
    const getBody = JSON.parse(getRes._getData());
    expect(getBody.plans[0].schedule).toEqual(paidSchedule);
  });

  it('20. PUT financial edit recompute success — buildSchedule() is genuinely called a second time', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard()],
      plans: [manualPlanSeed({ id: 'ip_recompute' })]
    });

    const { req, res } = makeReqRes({ method: 'PUT', body: { planId: 'ip_recompute', patch: { months: 2 } } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.plan.months).toBe(2);
    expect(body.plan.schedule).toEqual(PUT_RECOMPUTE_SCHEDULE);
    expect(body.plan.monthlyPayment).toBe(500);
    expect(body.plan.totalInterest).toBe(0);
    expect(body.plan.totalPayable).toBe(1000);
  });

  it('21. PUT financial edit that moves cardId to a nonexistent card returns 404 (own re-check, independent of POST\'s)', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard()],
      plans: [manualPlanSeed({ id: 'ip_move' })]
    });

    const { req, res } = makeReqRes({
      method: 'PUT',
      body: { planId: 'ip_move', patch: { totalPrice: 500, cardId: 'cc_missing' } }
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData())).toEqual({ error: 'card not found' });
  });

  // --- PATCH ---------------------------------------------------------------------------------

  it('22. PATCH with missing planId/non-finite installmentNo returns 400', async () => {
    const { req, res } = makeReqRes({ method: 'PATCH', body: {} });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'planId and installmentNo required' });
  });

  it('23. PATCH with a nonexistent planId returns 404', async () => {
    const { req, res } = makeReqRes({ method: 'PATCH', body: { planId: 'ip_missing', installmentNo: 1, paid: true } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData())).toEqual({ error: 'plan not found' });
  });

  it('24. PATCH with a nonexistent installmentNo on an existing plan returns 404', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard()],
      plans: [manualPlanSeed({ id: 'ip_row' })]
    });

    const { req, res } = makeReqRes({ method: 'PATCH', body: { planId: 'ip_row', installmentNo: 99, paid: true } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData())).toEqual({ error: 'installment not found' });
  });

  it('25. PATCH on a cancelled plan returns 409', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard()],
      plans: [manualPlanSeed({ id: 'ip_cancelled', status: 'cancelled_early' })]
    });

    const { req, res } = makeReqRes({ method: 'PATCH', body: { planId: 'ip_cancelled', installmentNo: 1, paid: true } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(409);
    expect(JSON.parse(res._getData())).toEqual({ error: 'plan is cancelled' });
  });

  it('26. PATCH marks an unpaid row paid', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard()],
      plans: [manualPlanSeed({ id: 'ip_mark' })]
    });

    const { req, res } = makeReqRes({ method: 'PATCH', body: { planId: 'ip_mark', installmentNo: 1, paid: true } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const row = JSON.parse(res._getData()).plan.schedule.find(r => r.no === 1);
    expect(row.paid).toBe(true);
    expect(typeof row.paidAt).toBe('string');
    expect(row.paidAt).not.toBeNull();
    expect(row.paidSource).toBe('credit_card');
  });

  it('27. PATCH un-marks a paid row', async () => {
    const paidSchedule = MANUAL_SCHEDULE.map((row, i) => (i === 0 ? { ...row, paid: true, paidAt: new Date().toISOString(), paidSource: 'credit_card' } : row));
    await seedCreditDoc(USER_A, {
      cards: [makeCard()],
      plans: [manualPlanSeed({ id: 'ip_unmark', schedule: paidSchedule })]
    });

    const { req, res } = makeReqRes({ method: 'PATCH', body: { planId: 'ip_unmark', installmentNo: 1, paid: false } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const row = JSON.parse(res._getData()).plan.schedule.find(r => r.no === 1);
    expect(row.paid).toBe(false);
    expect(row.paidAt).toBeNull();
    expect(row.paidSource).toBeNull();
  });

  it('28. PATCH drives resolvePlanStatus\'s ongoing <-> completed transition, live-recomputed each call', async () => {
    const twoRowSchedule = [
      { no: 1, dueMonth: '2026-01', payment: 500, principal: 500, interest: 0, paid: true, paidAt: new Date().toISOString(), paidSource: 'credit_card' },
      { no: 2, dueMonth: '2026-02', payment: 500, principal: 500, interest: 0, paid: false, paidAt: null, paidSource: null }
    ];
    await seedCreditDoc(USER_A, {
      cards: [makeCard()],
      plans: [manualPlanSeed({ id: 'ip_transition', months: 2, schedule: twoRowSchedule, status: 'ongoing' })]
    });

    const { req: req1, res: res1 } = makeReqRes({ method: 'PATCH', body: { planId: 'ip_transition', installmentNo: 2, paid: true } });
    await handler(req1, res1);
    expect(res1._getStatusCode()).toBe(200);
    expect(JSON.parse(res1._getData()).plan.status).toBe('completed');

    const { req: req2, res: res2 } = makeReqRes({ method: 'PATCH', body: { planId: 'ip_transition', installmentNo: 2, paid: false } });
    await handler(req2, res2);
    expect(res2._getStatusCode()).toBe(200);
    expect(JSON.parse(res2._getData()).plan.status).toBe('ongoing');
  });

  // --- DELETE -------------------------------------------------------------------------------

  it('29. DELETE with a missing planId returns 400', async () => {
    const { req, res } = makeReqRes({ method: 'DELETE', body: {} });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'planId required' });
  });

  it('30. DELETE with a nonexistent planId returns 404', async () => {
    const { req, res } = makeReqRes({ method: 'DELETE', body: { planId: 'ip_missing' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData())).toEqual({ error: 'plan not found' });
  });

  it('31. DELETE mode:"delete" blocked by a paid installment (BR-CC-010) — plan untouched', async () => {
    const paidSchedule = MANUAL_SCHEDULE.map((row, i) => (i === 0 ? { ...row, paid: true, paidAt: new Date().toISOString(), paidSource: 'credit_card' } : row));
    await seedCreditDoc(USER_A, {
      cards: [makeCard()],
      plans: [manualPlanSeed({ id: 'ip_del_blocked', schedule: paidSchedule })]
    });

    const { req, res } = makeReqRes({ method: 'DELETE', body: { planId: 'ip_del_blocked', mode: 'delete' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(409);
    expect(JSON.parse(res._getData())).toEqual({
      error: 'plan has paid installments — cancel it instead',
      installmentsPaid: 1
    });

    const { req: getReq, res: getRes } = makeReqRes();
    await handler(getReq, getRes);
    const getBody = JSON.parse(getRes._getData());
    expect(getBody.plans).toHaveLength(1);
    expect(getBody.plans[0].schedule).toEqual(paidSchedule);
  });

  it('32. DELETE mode:"delete" success (no paid installments) removes the plan entirely', async () => {
    await seedCreditDoc(USER_A, {
      cards: [makeCard()],
      plans: [manualPlanSeed({ id: 'ip_del_ok' })]
    });

    const { req, res } = makeReqRes({ method: 'DELETE', body: { planId: 'ip_del_ok', mode: 'delete' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ success: true });

    const { req: getReq, res: getRes } = makeReqRes();
    await handler(getReq, getRes);
    expect(JSON.parse(getRes._getData())).toEqual({ plans: [] });
  });

  it('33. DELETE default (cancel) mode succeeds even with a paid installment already present', async () => {
    const paidSchedule = MANUAL_SCHEDULE.map((row, i) => (i === 0 ? { ...row, paid: true, paidAt: new Date().toISOString(), paidSource: 'credit_card' } : row));
    await seedCreditDoc(USER_A, {
      cards: [makeCard()],
      plans: [manualPlanSeed({ id: 'ip_cancel_default', schedule: paidSchedule })]
    });

    const { req, res } = makeReqRes({ method: 'DELETE', body: { planId: 'ip_cancel_default' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ success: true });

    const { req: getReq, res: getRes } = makeReqRes();
    await handler(getReq, getRes);
    const getBody = JSON.parse(getRes._getData());
    expect(getBody.plans).toHaveLength(1);
    const plan = getBody.plans[0];
    expect(plan.status).toBe('cancelled_early');
    expect(typeof plan.cancelledAt).toBe('string');
    expect(plan.cancelledAt).not.toBeNull();
    // Pure status/timestamp update — schedule (including the already-paid row) is byte-for-byte
    // unchanged from the seed, proving cancel mode never mutates the schedule.
    expect(plan.schedule).toEqual(paidSchedule);
  });

  it('34. DELETE mode:"cancel" explicit string behaves identically to the omitted-field default', async () => {
    const paidSchedule = MANUAL_SCHEDULE.map((row, i) => (i === 0 ? { ...row, paid: true, paidAt: new Date().toISOString(), paidSource: 'credit_card' } : row));
    await seedCreditDoc(USER_A, {
      cards: [makeCard()],
      plans: [manualPlanSeed({ id: 'ip_cancel_explicit', schedule: paidSchedule })]
    });

    const { req, res } = makeReqRes({ method: 'DELETE', body: { planId: 'ip_cancel_explicit', mode: 'cancel' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ success: true });

    const { req: getReq, res: getRes } = makeReqRes();
    await handler(getReq, getRes);
    const getBody = JSON.parse(getRes._getData());
    const plan = getBody.plans[0];
    expect(plan.status).toBe('cancelled_early');
    expect(typeof plan.cancelledAt).toBe('string');
    expect(plan.cancelledAt).not.toBeNull();
    expect(plan.schedule).toEqual(paidSchedule);
  });

  // --- unsupported method / catch -------------------------------------------------------------

  it('35. Unsupported method (OPTIONS) returns 405 with a JSON body and an Allow header', async () => {
    const { req, res } = makeReqRes({ method: 'OPTIONS' });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Method not allowed' });
    // node-mocks-http lower-cases header names, same convention every prior slice's own test uses.
    expect(res._getHeaders().allow).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
  });
});

describe('/api/credit-cards/plans (isolated mocked-collaborator test — the one sanctioned exception)', () => {
  // This is the only test in this file that mocks a collaborator module. It is scoped to its own
  // describe block via jest.isolateModules so the mock never leaks into the real-DB tests above.
  // The top-level catch -> 500 branch cannot be exercised by seeding/withholding real documents —
  // it requires the collaborator to actually throw, which is the class of case
  // CODING_STANDARD.md's "mock a collaborator, not the DB" carve-out exists for (same pattern
  // slice #9 used for credit-cards/index.js's own 500 test).
  it('36. getUserCreditData() throwing returns 500 with the exact Thai error body', async () => {
    let isolatedHandler;

    jest.isolateModules(() => {
      jest.doMock('../../../src/shared/utils/backend/creditCardStore', () => ({
        getUserCreditData: jest.fn().mockRejectedValue(new Error('boom')),
        updateUserCreditData: jest.fn().mockRejectedValue(new Error('boom'))
      }));
      isolatedHandler = require('../../../pages/api/credit-cards/plans').default;
    });

    const { req, res } = makeReqRes();
    await isolatedHandler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(JSON.parse(res._getData())).toEqual({ error: 'ไม่สามารถจัดการแผนผ่อนชำระได้' });

    // Ensure the mock does not leak into any other test in this file (or process).
    jest.dontMock('../../../src/shared/utils/backend/creditCardStore');
  });
});
