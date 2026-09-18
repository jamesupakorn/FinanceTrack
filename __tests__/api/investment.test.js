/** @jest-environment node */
// Integration test against a real (ephemeral, in-process) MongoDB instance — see
// .pipeline/spec-td-c01-api-coverage-8.md for why mongodb-memory-server (not mocks) was chosen: this
// route's full-overwrite (no partial-field-update guard) POST semantics and its own call site of
// enforceSharedMonthWindowMongo are both real multi-document Mongo query behaviors, so mocking the
// collection would never prove either property actually holds.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMocks } from 'node-mocks-http';

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'test-user-a';
const USER_B = 'test-user-b';

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

  handler = require('../../pages/api/investment').default;
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
    await db.collection('investment').deleteMany({});
    await db.collection('salary').deleteMany({}); // only used by the shared-window test
  }
});

/** Identical shape to salary.test.js's/tax_accumulated.test.js's own helper — same collaborator
 * (`sessionCookie`), same gate (`assertUserId`), reused verbatim rather than re-invented. */
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

describe('/api/investment (Mongo mode)', () => {
  it('GET with no session cookie returns 401 with the exact assertUserId body', async () => {
    const { req, res } = makeReqRes({ userId: null, query: { month: '2026-01' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(JSON.parse(res._getData())).toEqual({
      error: 'session expired or invalid — please log in again'
    });
  });

  it('POST with a valid session but missing X-CSRF-Token returns 403 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      omitCsrf: true,
      body: { month: '2026-01', investments: [] }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(403);
    expect(await db.collection('investment').countDocuments({})).toBe(0);
  });

  it('unsupported method (DELETE, which this route has no handler for) returns 405 with a JSON body and no Allow header', async () => {
    const { req, res } = makeReqRes({ method: 'DELETE' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Method not allowed' });
    // node-mocks-http lower-cases header names; this route never sets an Allow header on 405.
    expect(res._getHeaders().allow).toBeUndefined();
  });

  it('GET for a month with no document returns 200 with a bare empty array (not an object)', async () => {
    const { req, res } = makeReqRes({ query: { month: '2026-01' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual([]);
  });

  it('GET for a month with an existing document returns the investments array verbatim', async () => {
    await db.collection('investment').insertOne({
      month: '2026-02',
      userId: USER_A,
      investments: [
        { name: 'กองทุน A', amount: 5000 },
        { name: 'หุ้น B', amount: 3000 }
      ]
    });

    const { req, res } = makeReqRes({ query: { month: '2026-02' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual([
      { name: 'กองทุน A', amount: 5000 },
      { name: 'หุ้น B', amount: 3000 }
    ]);
  });

  it('GET with no month query and multiple months present returns an object keyed by month, each an array', async () => {
    await db.collection('investment').insertOne({
      month: '2026-03',
      userId: USER_A,
      investments: [{ name: 'A', amount: 100 }]
    });
    await db.collection('investment').insertOne({
      month: '2026-04',
      userId: USER_A,
      investments: []
    });

    const { req, res } = makeReqRes({ query: {} });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({
      '2026-03': [{ name: 'A', amount: 100 }],
      '2026-04': []
    });
  });

  it('POST validation branch 1: missing month returns 400 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { investments: [] }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'month and investments required' });
    expect(await db.collection('investment').countDocuments({})).toBe(0);
  });

  it('POST validation branch 2: month present but investments is not an array returns 400 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { month: '2026-05', investments: { name: 'A', amount: 100 } }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'month and investments required' });
    expect(await db.collection('investment').countDocuments({})).toBe(0);
  });

  it('POST success creates a new document, verified by a following GET', async () => {
    const { req: postReq, res: postRes } = makeReqRes({
      method: 'POST',
      body: { month: '2026-06', investments: [{ name: 'กองทุน C', amount: 2000 }] }
    });

    await handler(postReq, postRes);

    expect(postRes._getStatusCode()).toBe(200);
    expect(JSON.parse(postRes._getData())).toEqual({ success: true });

    const { req: getReq, res: getRes } = makeReqRes({ query: { month: '2026-06' } });
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    expect(JSON.parse(getRes._getData())).toEqual([{ name: 'กองทุน C', amount: 2000 }]);
  });

  it('POST full-overwrite semantics: a second POST for the same month fully replaces the first (no merge)', async () => {
    const { req: firstReq, res: firstRes } = makeReqRes({
      method: 'POST',
      body: {
        month: '2026-07',
        investments: [
          { name: 'Old', amount: 1 },
          { name: 'Old2', amount: 2 }
        ]
      }
    });
    await handler(firstReq, firstRes);
    expect(firstRes._getStatusCode()).toBe(200);

    const { req: secondReq, res: secondRes } = makeReqRes({
      method: 'POST',
      body: { month: '2026-07', investments: [{ name: 'New', amount: 999 }] }
    });
    await handler(secondReq, secondRes);
    expect(secondRes._getStatusCode()).toBe(200);

    const { req: getReq, res: getRes } = makeReqRes({ query: { month: '2026-07' } });
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    // Not a 3-item merged array, and not the original 2-item array — proves this route has no
    // partial-field-update guard, the opposite property from savings.js/savings-goals.js/
    // tax_accumulated.js's own tested partial-update guards.
    expect(JSON.parse(getRes._getData())).toEqual([{ name: 'New', amount: 999 }]);
  });

  it('cross-user isolation: a POST for User A does not create or alter a document visible to User B for the same month', async () => {
    const { req: postReq, res: postRes } = makeReqRes({
      method: 'POST',
      userId: USER_A,
      body: { month: '2026-08', investments: [{ name: 'A-only', amount: 1 }] }
    });
    await handler(postReq, postRes);
    expect(postRes._getStatusCode()).toBe(200);

    const { req: getReq, res: getRes } = makeReqRes({ userId: USER_B, query: { month: '2026-08' } });
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    expect(JSON.parse(getRes._getData())).toEqual([]);
  });

  it("enforceSharedMonthWindowMongo prunes a shared newest-15 window across investment AND salary for one user, at this route's own POST call site", async () => {
    // 10 months for USER_A in `investment`: 2024-01 .. 2024-10.
    const investmentMonths = [];
    for (let m = 1; m <= 10; m++) {
      investmentMonths.push(`2024-${String(m).padStart(2, '0')}`);
    }
    // 5 months for USER_A in `salary`: 2024-11 .. 2025-03.
    const salaryMonths = ['2024-11', '2024-12', '2025-01', '2025-02', '2025-03'];

    await db.collection('investment').insertMany(
      investmentMonths.map(month => ({ month, userId: USER_A, investments: [] }))
    );
    await db.collection('salary').insertMany(
      salaryMonths.map(month => ({ month, userId: USER_A, income: {}, deduct: {} }))
    );

    // A real POST through this route's own handler for a 16th, newer month.
    const { req, res } = makeReqRes({
      method: 'POST',
      userId: USER_A,
      body: { month: '2025-04', investments: [{ name: 'New', amount: 1 }] }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);

    const investmentCount = await db.collection('investment').countDocuments({ userId: USER_A });
    const salaryCount = await db.collection('salary').countDocuments({ userId: USER_A });
    // 10 investment + 1 new (2025-04) + 5 salary = 16 total before prune; one evicted across the
    // shared window -> 15 remain.
    expect(investmentCount + salaryCount).toBe(15);

    // 2024-01 is the globally oldest month across the two-collection union -> evicted from `investment`.
    expect(await db.collection('investment').findOne({ userId: USER_A, month: '2024-01' })).toBeNull();
  });
});
