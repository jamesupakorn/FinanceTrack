/** @jest-environment node */
// Integration test against a real (ephemeral, in-process) MongoDB instance — see
// .pipeline/spec-td-c01-api-coverage-7.md for why mongodb-memory-server (not mocks) was chosen:
// the partial-field-update guard on POST and `mutateTaxYear`'s read-mutate-write cycle are both
// real Mongo document-round-trip behaviors that a mocked collection could never meaningfully prove.
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
let taxHelpers;
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
  taxHelpers = require('../../pages/api/tax_accumulated');
  handler = taxHelpers.default;
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
    await db.collection('tax_accumulated').deleteMany({});
  }
});

/**
 * request ที่ผ่านด่าน auth ครบ: session cookie ของ `userId`
 * (+ X-CSRF-Token ที่ผูกกับ sid เดียวกัน เมื่อเป็น method ที่เปลี่ยนข้อมูล)
 * Identical shape to salary.test.js's own helper — same collaborator (`sessionCookie`), same gate
 * (`assertUserId`), reused verbatim rather than re-invented.
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

describe('/api/tax_accumulated (Mongo mode)', () => {
  // --- HTTP handler tests ---

  it('1. GET with no session cookie returns 401', async () => {
    const { req, res } = makeReqRes({ userId: null, query: { year: '2026' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
  });

  it('2. POST with a valid session but missing X-CSRF-Token returns 403 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      omitCsrf: true,
      body: { year: '2026', accumulated_tax: 100 }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(403);
    expect(await db.collection('tax_accumulated').countDocuments({})).toBe(0);
  });

  it('3. unsupported method (PUT) returns 405 with an empty body', async () => {
    const { req, res } = makeReqRes({ method: 'PUT' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(res._getData()).toBe('');
  });

  it('4. GET for a year with no document returns 200 with the exact Mongo-mode default literal', async () => {
    const { req, res } = makeReqRes({ query: { year: '2026' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({
      '2026': { accumulated_tax: 0, monthly_tax: {}, monthly_income: {}, monthly_provident: {} }
    });
  });

  it('5. GET for a year missing monthly_provident entirely gets it defaulted to {} (additive fill)', async () => {
    await db.collection('tax_accumulated').insertOne({
      year: '2027',
      userId: USER_A,
      accumulated_tax: 500,
      monthly_tax: { '01': '10' },
      monthly_income: { '01': '30000' }
    });

    const { req, res } = makeReqRes({ query: { year: '2027' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body['2027'].monthly_provident).toEqual({});
    expect(body['2027'].accumulated_tax).toBe(500);
    expect(body['2027'].monthly_tax).toEqual({ '01': '10' });
    expect(body['2027']).not.toHaveProperty('_id');
    expect(body['2027']).not.toHaveProperty('userId');
  });

  it('6. GET for a year with an already-populated monthly_provident is passed through unchanged', async () => {
    await db.collection('tax_accumulated').insertOne({
      year: '2027',
      userId: USER_A,
      accumulated_tax: 500,
      monthly_tax: {},
      monthly_income: {},
      monthly_provident: { '03': '200' }
    });

    const { req, res } = makeReqRes({ query: { year: '2027' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body['2027'].monthly_provident).toEqual({ '03': '200' });
  });

  it('7. GET with no year query returns tax_by_year keyed by year, each sanitized', async () => {
    await db.collection('tax_accumulated').insertOne({
      year: '2026',
      userId: USER_A,
      accumulated_tax: 111,
      monthly_tax: {},
      monthly_income: {},
      monthly_provident: {}
    });
    await db.collection('tax_accumulated').insertOne({
      year: '2027',
      userId: USER_A,
      accumulated_tax: 222,
      monthly_tax: {},
      monthly_income: {},
      monthly_provident: {}
    });

    const { req, res } = makeReqRes({ query: {} });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(Object.keys(body.tax_by_year).sort()).toEqual(['2026', '2027']);
    Object.values(body.tax_by_year).forEach((entry) => {
      expect(entry).not.toHaveProperty('_id');
      expect(entry).not.toHaveProperty('userId');
    });
  });

  it('8. POST validation: missing year returns 400 and does not write', async () => {
    const { req, res } = makeReqRes({ method: 'POST', body: { accumulated_tax: 100 } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'year required' });
    expect(await db.collection('tax_accumulated').countDocuments({})).toBe(0);
  });

  it('9. POST success creates a new document with all four provided fields, verified by a following GET', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: {
        year: '2028',
        accumulated_tax: 1234,
        monthly_tax: { '01': '50' },
        monthly_income: { '01': '30000' },
        monthly_provident: { '01': '1500' }
      }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(201);
    expect(JSON.parse(res._getData())).toEqual({ success: true });

    const { req: getReq, res: getRes } = makeReqRes({ query: { year: '2028' } });
    await handler(getReq, getRes);
    const body = JSON.parse(getRes._getData());
    expect(body['2028']).toEqual({
      year: '2028',
      accumulated_tax: 1234,
      monthly_tax: { '01': '50' },
      monthly_income: { '01': '30000' },
      monthly_provident: { '01': '1500' }
    });
  });

  it('10. POST partial-field-update guard: supplying only accumulated_tax leaves monthly_tax untouched', async () => {
    const { req: firstReq, res: firstRes } = makeReqRes({
      method: 'POST',
      body: { year: '2029', accumulated_tax: 100, monthly_tax: { '01': '20' } }
    });
    await handler(firstReq, firstRes);
    expect(firstRes._getStatusCode()).toBe(201);

    const { req: secondReq, res: secondRes } = makeReqRes({
      method: 'POST',
      body: { year: '2029', accumulated_tax: 200 }
    });
    await handler(secondReq, secondRes);
    expect(secondRes._getStatusCode()).toBe(201);

    const { req: getReq, res: getRes } = makeReqRes({ query: { year: '2029' } });
    await handler(getReq, getRes);
    const body = JSON.parse(getRes._getData());
    expect(body['2029'].accumulated_tax).toBe(200);
    expect(body['2029'].monthly_tax).toEqual({ '01': '20' });
  });

  it('11. DELETE without year in the body returns 400', async () => {
    const { req, res } = makeReqRes({ method: 'DELETE', body: {} });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ success: false, message: 'กรุณาระบุปีที่ต้องการลบ' });
  });

  it('12. DELETE for a year with no document returns 404', async () => {
    const { req, res } = makeReqRes({ method: 'DELETE', body: { year: '2030' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData())).toEqual({ success: false, message: 'ไม่พบข้อมูลภาษีปี 2030' });
  });

  it('13. DELETE for a year with an existing document returns 200 and actually removes it', async () => {
    await db.collection('tax_accumulated').insertOne({
      year: '2031',
      userId: USER_A,
      accumulated_tax: 0,
      monthly_tax: {},
      monthly_income: {},
      monthly_provident: {}
    });

    const { req, res } = makeReqRes({ method: 'DELETE', body: { year: '2031' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ success: true, message: 'ลบข้อมูลภาษีปี 2031 เรียบร้อยแล้ว' });
    expect(await db.collection('tax_accumulated').findOne({ userId: USER_A, year: '2031' })).toBeNull();
  });

  it('14. cross-user isolation: a POST for User A is invisible to User B for the same year', async () => {
    const { req: postReq, res: postRes } = makeReqRes({
      method: 'POST',
      userId: USER_A,
      body: { year: '2032', accumulated_tax: 999 }
    });
    await handler(postReq, postRes);
    expect(postRes._getStatusCode()).toBe(201);

    const { req: getReq, res: getRes } = makeReqRes({ userId: USER_B, query: { year: '2032' } });
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    expect(JSON.parse(getRes._getData())).toEqual({
      '2032': { accumulated_tax: 0, monthly_tax: {}, monthly_income: {}, monthly_provident: {} }
    });
  });

  // --- Direct (non-HTTP) function-call tests ---

  it('15. updateMonthlyTax on a year with no existing document creates one via the internal default', async () => {
    await taxHelpers.updateMonthlyTax(USER_A, '2033', '05', 999);

    const doc = await db.collection('tax_accumulated').findOne({ userId: USER_A, year: '2033' });
    expect(doc.monthly_tax).toEqual({ '05': '999' });
    expect(doc.accumulated_tax).toBe(0);
    expect(doc.monthly_income).toEqual({});
    expect(doc.monthly_provident).toEqual({});
  });

  it('16. updateMonthlyIncome on a year with existing sibling fields merges without clobbering them', async () => {
    await db.collection('tax_accumulated').insertOne({
      year: '2034',
      userId: USER_A,
      accumulated_tax: 50,
      monthly_tax: { '01': '10' },
      monthly_income: { '01': '25000' },
      monthly_provident: {}
    });

    await taxHelpers.updateMonthlyIncome(USER_A, '2034', '02', 26000);

    const doc = await db.collection('tax_accumulated').findOne({ userId: USER_A, year: '2034' });
    expect(doc.monthly_income).toEqual({ '01': '25000', '02': '26000' });
    expect(doc.monthly_tax).toEqual({ '01': '10' });
    expect(doc.accumulated_tax).toBe(50);
  });

  it('17. updateMonthlyProvident coerces a decimal number value to its exact toString() output', async () => {
    // Independently verified: (1500.5).toString() === '1500.5' (run via `node -e`), per the spec's
    // standing instruction not to trust a hand-transcribed literal without re-derivation.
    expect((1500.5).toString()).toBe('1500.5');

    await taxHelpers.updateMonthlyProvident(USER_A, '2035', '12', 1500.5);

    const doc = await db.collection('tax_accumulated').findOne({ userId: USER_A, year: '2035' });
    expect(doc.monthly_provident['12']).toBe('1500.5');
  });

  it('18. cross-user isolation for direct function calls: a different user, same year, does not clobber', async () => {
    // `beforeEach` deletes the whole collection before every test (the sole isolation boundary in
    // this file), so test 15's document does not survive into this test — re-seed the same
    // 2033/USER_A state independently here rather than relying on cross-test ordering.
    await taxHelpers.updateMonthlyTax(USER_A, '2033', '05', 999);

    await taxHelpers.updateMonthlyTax(USER_B, '2033', '05', 1);

    const docA = await db.collection('tax_accumulated').findOne({ userId: USER_A, year: '2033' });
    expect(docA.monthly_tax).toEqual({ '05': '999' });

    const docB = await db.collection('tax_accumulated').findOne({ userId: USER_B, year: '2033' });
    expect(docB.monthly_tax).toEqual({ '05': '1' });
  });
});
