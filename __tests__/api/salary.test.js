/** @jest-environment node */
// Integration test against a real (ephemeral, in-process) MongoDB instance — see
// .pipeline/spec-td-c01-api-coverage-4.md for why mongodb-memory-server (not mocks) was chosen: this
// route's `hasMeaningfulSalaryData` backward-scan carry-forward and, especially,
// `enforceSharedMonthWindowMongo`'s cross-collection (`salary` + `investment`, here) union/prune
// round trip are both real multi-document Mongo query behaviors, so mocking the collection would
// never prove either property actually holds.
//
// `lib/dataMode.config.js` reads process.env.DATA_MODE / process.env.MONGODB_URI once, at
// first-import time (module-level `const`). This test therefore sets those env vars first, then
// `jest.resetModules()` + `require(...)` the handler and db module fresh inside `beforeAll`, so they
// pick up the test env instead of whatever was cached from an earlier test file/process.
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

  // Fresh `require` (not a top-of-file static `import`) so dataMode.config.js/the handler re-read
  // the env vars set above, rather than whatever was resolved at first import.
  handler = require('../../pages/api/salary').default;
  sessionCookie = require('../../src/shared/utils/backend/sessionCookie');
  ({ getDbPromise } = require('../../lib/mongodb'));
  db = await getDbPromise();
}, 60000);

afterAll(async () => {
  // Close the driver's connection before tearing down the ephemeral mongod, otherwise the open
  // socket keeps the Jest worker alive ("worker process failed to exit gracefully").
  if (db?.client) {
    await db.client.close();
  }
  if (mongod) {
    await mongod.stop();
  }
});

beforeEach(async () => {
  if (db) {
    await db.collection('salary').deleteMany({});
    await db.collection('investment').deleteMany({}); // only used by test 17
  }
});

/**
 * request ที่ผ่านด่าน auth ครบ: session cookie ของ `userId`
 * (+ X-CSRF-Token ที่ผูกกับ sid เดียวกัน เมื่อเป็น method ที่เปลี่ยนข้อมูล)
 */
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

const ZERO_INCOME = {
  salary: 0,
  overtime_1x: 0,
  overtime_1_5x: 0,
  overtime_2x: 0,
  overtime_3x: 0,
  overtime_other: 0,
  bonus: 0,
  other_income: 0
};

const ZERO_DEDUCT = {
  provident_fund: 0,
  social_security: 0,
  tax: 0
};

describe('/api/salary (Mongo mode)', () => {
  it('GET with no session cookie returns 401', async () => {
    const { req, res } = makeReqRes({ userId: null, query: { month: '2026-01' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
  });

  it('POST with a valid session but missing X-CSRF-Token returns 403 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      omitCsrf: true,
      body: { month: '2026-01', income: {}, deduct: {} }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(403);
    expect(await db.collection('salary').findOne({ userId: USER_A, month: '2026-01' })).toBeNull();
  });

  it('unsupported method (PATCH) returns 405 with an Allow header and a JSON body', async () => {
    const { req, res } = makeReqRes({ method: 'PATCH' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    // node-mocks-http lower-cases header names.
    expect(res._getHeaders().allow).toEqual(['GET', 'POST', 'DELETE']);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Method not allowed' });
  });

  it('GET for a month with no document and no prior months returns 200 with the default zeroed structure', async () => {
    const { req, res } = makeReqRes({ query: { month: '2026-01' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.income).toEqual(ZERO_INCOME);
    expect(data.deduct).toEqual(ZERO_DEDUCT);
    expect(data.summary).toEqual({ total_income: 0, total_deduct: 0, net_income: 0 });
    expect(data.month).toBe('2026-01');
  });

  it('GET for a month with no document carries income/deduct forward from the immediately-prior meaningful month and recomputes summary', async () => {
    const seededIncome = { ...ZERO_INCOME, salary: 30000 };
    const seededDeduct = { ...ZERO_DEDUCT, tax: 500 };
    await db.collection('salary').insertOne({
      month: '2026-04',
      userId: USER_A,
      income: seededIncome,
      deduct: seededDeduct
    });

    const { req, res } = makeReqRes({ query: { month: '2026-05' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.income).toEqual(seededIncome);
    expect(data.deduct).toEqual(seededDeduct);
    // Freshly computed (30000 - 500 = 29500), not copy-pasted from the seed doc.
    expect(data.summary).toEqual({ total_income: 30000, total_deduct: 500, net_income: 29500 });
  });

  it('GET for a month with no document skips an intermediate blank-record month and carries forward from the earlier meaningful month', async () => {
    const meaningfulIncome = { ...ZERO_INCOME, salary: 30000 };
    await db.collection('salary').insertOne({
      month: '2026-04',
      userId: USER_A,
      income: meaningfulIncome,
      deduct: ZERO_DEDUCT
    });
    // Blank "record exists but empty" month between 2026-04 and the requested 2026-06 — e.g. created
    // by an "add new month" UI action with nothing filled in yet.
    await db.collection('salary').insertOne({
      month: '2026-05',
      userId: USER_A,
      income: {},
      deduct: {}
    });

    const { req, res } = makeReqRes({ query: { month: '2026-06' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    // Carried from 2026-04 (meaningful), not 2026-05 (blank) and not the all-zero default.
    expect(data.income).toEqual(meaningfulIncome);
    expect(data.deduct).toEqual(ZERO_DEDUCT);
  });

  it('GET for a month with an existing document missing income/deduct keys entirely fills defaults for only the missing fields', async () => {
    await db.collection('salary').insertOne({
      month: '2026-07',
      userId: USER_A,
      note: 'มีแค่โน้ต'
    });

    const { req, res } = makeReqRes({ query: { month: '2026-07' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.income).toEqual(ZERO_INCOME);
    expect(data.deduct).toEqual(ZERO_DEDUCT);
    expect(data.note).toBe('มีแค่โน้ต');
    expect(data.summary).toEqual({ total_income: 0, total_deduct: 0, net_income: 0 });
  });

  it('GET for a month with an existing document returns the stored summary verbatim, not recomputed from income/deduct', async () => {
    await db.collection('salary').insertOne({
      month: '2026-08',
      userId: USER_A,
      income: { ...ZERO_INCOME, salary: 1000 },
      deduct: ZERO_DEDUCT,
      // Deliberately-wrong stored summary — the real sum of income is 1000, not 9999.
      summary: { total_income: 9999, total_deduct: 0, net_income: 9999 }
    });

    const { req, res } = makeReqRes({ query: { month: '2026-08' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.summary).toEqual({ total_income: 9999, total_deduct: 0, net_income: 9999 });
  });

  it('GET without a month query param returns 200 with all months, keyed by month', async () => {
    await db.collection('salary').insertOne({
      month: '2026-01',
      userId: USER_A,
      income: { ...ZERO_INCOME, salary: 1000 },
      deduct: ZERO_DEDUCT
    });
    await db.collection('salary').insertOne({
      month: '2026-02',
      userId: USER_A,
      income: { ...ZERO_INCOME, salary: 2000 },
      deduct: ZERO_DEDUCT
    });

    const { req, res } = makeReqRes({ query: {} });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(Object.keys(data).sort()).toEqual(['2026-01', '2026-02']);
    expect(data['2026-01'].income.salary).toBe(1000);
    expect(data['2026-02'].income.salary).toBe(2000);
  });

  it('POST validation: missing month returns 400 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { income: {}, deduct: {} }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'กรุณาระบุเดือน' });
    expect(await db.collection('salary').countDocuments({})).toBe(0);
  });

  it('POST success: computes summary from the submitted income/deduct, upserts, and a following GET proves the round trip', async () => {
    const body = {
      month: '2026-03',
      income: { ...ZERO_INCOME, salary: 25000, bonus: 5000 },
      deduct: { ...ZERO_DEDUCT, provident_fund: 750 },
      note: 'เดือนนี้มีโบนัส'
    };
    const { req: postReq, res: postRes } = makeReqRes({ method: 'POST', body });

    await handler(postReq, postRes);

    expect(postRes._getStatusCode()).toBe(201);
    expect(JSON.parse(postRes._getData())).toEqual({ success: true });

    const { req: getReq, res: getRes } = makeReqRes({ query: { month: '2026-03' } });
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    const data = JSON.parse(getRes._getData());
    expect(data.income).toEqual(body.income);
    expect(data.deduct).toEqual(body.deduct);
    expect(data.note).toBe('เดือนนี้มีโบนัส');
    expect(data.summary).toEqual({ total_income: 30000, total_deduct: 750, net_income: 29250 });
  });

  it('POST omitting income/deduct entirely resets them to empty objects (full-overwrite semantics, no partial-field guard)', async () => {
    await db.collection('salary').insertOne({
      month: '2026-09',
      userId: USER_A,
      income: { ...ZERO_INCOME, salary: 40000 },
      deduct: ZERO_DEDUCT
    });

    const { req: postReq, res: postRes } = makeReqRes({
      method: 'POST',
      body: { month: '2026-09' }
    });
    await handler(postReq, postRes);
    expect(postRes._getStatusCode()).toBe(201);

    const { req: getReq, res: getRes } = makeReqRes({ query: { month: '2026-09' } });
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    const data = JSON.parse(getRes._getData());
    expect(data.income).toEqual({});
    expect(data.deduct).toEqual({});
    expect(data.summary).toEqual({ total_income: 0, total_deduct: 0, net_income: 0 });
  });

  it('DELETE without a month query param returns 400', async () => {
    const { req, res } = makeReqRes({ method: 'DELETE', query: {} });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'กรุณาระบุเดือนที่ต้องการลบ' });
  });

  it('DELETE for a month with no document returns 404', async () => {
    const { req, res } = makeReqRes({ method: 'DELETE', query: { month: '2026-10' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData())).toEqual({ error: 'ไม่พบข้อมูลเดือนที่ระบุ' });
  });

  it('DELETE for a month with an existing document returns 200 and removes the document', async () => {
    await db.collection('salary').insertOne({
      month: '2026-11',
      userId: USER_A,
      income: {},
      deduct: {}
    });

    const { req, res } = makeReqRes({ method: 'DELETE', query: { month: '2026-11' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ success: true, message: 'ลบข้อมูลเงินเดือนเรียบร้อย' });
    expect(await db.collection('salary').findOne({ userId: USER_A, month: '2026-11' })).toBeNull();
  });

  it('cross-user isolation: POST for User A does not create or alter a document for User B', async () => {
    const { req: postReq, res: postRes } = makeReqRes({
      method: 'POST',
      userId: USER_A,
      body: { month: '2026-12', income: { ...ZERO_INCOME, salary: 12345 }, deduct: ZERO_DEDUCT }
    });
    await handler(postReq, postRes);
    expect(postRes._getStatusCode()).toBe(201);

    const { req: getReq, res: getRes } = makeReqRes({ userId: USER_B, query: { month: '2026-12' } });
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    const data = JSON.parse(getRes._getData());
    expect(data.income).toEqual(ZERO_INCOME);
    expect(data.deduct).toEqual(ZERO_DEDUCT);
    expect(data.summary).toEqual({ total_income: 0, total_deduct: 0, net_income: 0 });
  });

  it("enforceSharedMonthWindowMongo prunes a shared newest-15 window across salary AND investment for one user, without touching another user's document", async () => {
    // 10 months for USER_A in `salary`: 2024-01 .. 2024-10.
    const salaryMonths = [];
    for (let m = 1; m <= 10; m++) {
      salaryMonths.push(`2024-${String(m).padStart(2, '0')}`);
    }
    // 5 months for USER_A in `investment`: 2024-11 .. 2025-03.
    const investmentMonths = ['2024-11', '2024-12', '2025-01', '2025-02', '2025-03'];

    await db.collection('salary').insertMany(
      salaryMonths.map(month => ({ month, userId: USER_A, income: {}, deduct: {} }))
    );
    await db.collection('investment').insertMany(
      investmentMonths.map(month => ({ month, userId: USER_A, investments: [] }))
    );

    // Another user's document, far outside the 16-month range under test.
    await db.collection('salary').insertOne({
      month: '2020-01',
      userId: USER_B,
      income: {},
      deduct: {}
    });

    // A real POST through the handler for a 16th, newer month — exercises
    // enforceSharedMonthWindowMongo's cross-collection union/prune at salary.js's own call site.
    const { req, res } = makeReqRes({
      method: 'POST',
      userId: USER_A,
      body: { month: '2025-04', income: { ...ZERO_INCOME, salary: 50000 }, deduct: ZERO_DEDUCT }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(201);

    const salaryCount = await db.collection('salary').countDocuments({ userId: USER_A });
    const investmentCount = await db.collection('investment').countDocuments({ userId: USER_A });
    // 10 salary + 1 new (2025-04) + 5 investment = 16 total before prune; one evicted across the
    // shared window -> 15 remain.
    expect(salaryCount + investmentCount).toBe(15);

    // 2024-01 is the globally oldest month across the two-collection union -> evicted from `salary`.
    expect(await db.collection('salary').findOne({ userId: USER_A, month: '2024-01' })).toBeNull();

    // User B's out-of-range document survives untouched — proves the userFilter-scoped deletion
    // boundary holds across collections too.
    expect(await db.collection('salary').findOne({ userId: USER_B, month: '2020-01' })).not.toBeNull();
  });
});
