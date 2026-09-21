/** @jest-environment node */
// Integration test against a real (ephemeral, in-process) MongoDB instance — see
// .pipeline/spec-test-suite-foundation.md §3 for why mongodb-memory-server was chosen over mocks.
//
// `lib/dataMode.config.js` / `lib/userStore.js` read process.env.DATA_MODE / process.env.MONGODB_URI
// once, at first-import time (module-level `const`). This test therefore sets those env vars first,
// then `jest.resetModules()` + `require(...)` the handler and db module fresh inside `beforeAll`, so
// they pick up the test env instead of whatever was cached from an earlier test file/process.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMocks } from 'node-mocks-http';

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const TEST_USER_ID = 'test-user-1';

const DEFAULT_THRESHOLDS = {
  generalExpense: 50,
  dailyExpense: 15,
  creditCard: 15,
  savings: 20
};

let mongod;
let handler;
let getDbPromise;
let db;
let sessionCookie; // { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME }

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();

  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';
  // TD-C02 B2: userId มาจาก session cookie เท่านั้น — ทุก request ในไฟล์นี้จึงต้องแนบ ft_session
  process.env.SESSION_SECRET = TEST_SECRET;

  jest.resetModules();

  // Fresh `require` (not a top-of-file static `import`) so dataMode.config.js/userStore.js/the
  // handler re-read the env vars set above, rather than whatever was resolved at first import.
  handler = require('../../pages/api/user-bank-accounts').default;
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
    await db.collection('users').deleteMany({});
  }
});

/**
 * request ที่ผ่านด่าน auth ครบ: session cookie ของ `userId`
 * (+ X-CSRF-Token ที่ผูกกับ sid เดียวกัน เมื่อเป็น method ที่เปลี่ยนข้อมูล)
 * TD-C02 follow-up: ไม่มี Authorization/Bearer อีกแล้ว — static API token ถูกถอดออกทั้งระบบ
 */
function makeReqRes({ method = 'GET', userId = TEST_USER_ID, query = {}, body, headers = {} } = {}) {
  const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
  const sid = createSessionId();
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  return createMocks({
    method,
    query,
    body,
    cookies: userId ? { [SESSION_COOKIE_NAME]: signSession(userId, sid) } : {},
    headers: {
      ...(mutating ? { 'x-csrf-token': signCsrfToken(sid) } : {}),
      ...headers
    }
  });
}

describe('/api/user-bank-accounts (Mongo mode)', () => {
  it('GET without a session cookie returns 401', async () => {
    const { req, res } = createMocks({ method: 'GET', query: { userId: TEST_USER_ID } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
  });

  // TD-C02 B2 regression: a client-supplied userId with no session cookie must never authenticate.
  // TD-C02 follow-up: an Authorization header is now meaningless here — it must not open any door.
  it('GET with an arbitrary Bearer header and query userId but no session cookie returns 401', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { userId: TEST_USER_ID },
      headers: { authorization: 'Bearer anything-at-all' }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
  });

  it('POST with a valid session but no X-CSRF-Token returns 403 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { bankAccounts: [{ name: 'ไม่ควรถูกบันทึก', balance: 1 }] },
      headers: { 'x-csrf-token': '' }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(403);
    expect(await db.collection('users').findOne({ id: TEST_USER_ID })).toBeNull();
  });

  it('the session cookie wins over a spoofed query userId (data is scoped to the cookie user)', async () => {
    await db.collection('users').insertOne({ id: TEST_USER_ID, displayName: 'Test User', bankAccounts: [] });
    const accounts = [{ name: 'กรุงไทย', balance: 5 }];
    const { req, res } = makeReqRes({
      method: 'POST',
      userId: TEST_USER_ID,
      query: { userId: 'someone-else' },
      body: { bankAccounts: accounts }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const victim = await db.collection('users').findOne({ id: 'someone-else' });
    expect(victim).toBeNull();
    const owner = await db.collection('users').findOne({ id: TEST_USER_ID });
    expect(owner.bankAccounts).toEqual(accounts);
  });

  it('GET for a user with no document yet returns 200 with documented defaults', async () => {
    const { req, res } = makeReqRes({ userId: 'user-with-no-document' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data).toEqual({
      bankAccounts: [],
      budgetThresholds: DEFAULT_THRESHOLDS,
      monthlySummaryEnabled: true
    });
  });

  it('POST with a valid bankAccounts array persists, and a following GET proves the round trip', async () => {
    await db.collection('users').insertOne({
      id: TEST_USER_ID,
      displayName: 'Test User',
      bankAccounts: []
    });

    const newAccounts = [{ name: 'กสิกรไทย', balance: 1000 }];
    const { req: postReq, res: postRes } = makeReqRes({
      method: 'POST',
      body: { bankAccounts: newAccounts }
    });

    await handler(postReq, postRes);

    expect(postRes._getStatusCode()).toBe(200);
    const postData = JSON.parse(postRes._getData());
    expect(postData).toEqual({ success: true, bankAccounts: newAccounts });

    // Real read-after-write against the actual in-memory Mongo instance — not a stubbed value.
    const { req: getReq, res: getRes } = makeReqRes();
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    const getData = JSON.parse(getRes._getData());
    expect(getData.bankAccounts).toEqual(newAccounts);
  });

  it('POST with an out-of-range budgetThresholds value returns 400 and does not write to the DB', async () => {
    await db.collection('users').insertOne({
      id: TEST_USER_ID,
      displayName: 'Test User',
      budgetThresholds: DEFAULT_THRESHOLDS
    });

    const invalidThresholds = { ...DEFAULT_THRESHOLDS, generalExpense: -1 };
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { budgetThresholds: invalidThresholds }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);

    const userDoc = await db.collection('users').findOne({ id: TEST_USER_ID });
    expect(userDoc.budgetThresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('DELETE (unsupported method) returns 405 with an Allow header', async () => {
    const { req, res } = makeReqRes({ method: 'DELETE' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    const headers = res._getHeaders();
    const allowHeader = headers.allow || headers.Allow;
    expect(allowHeader).toEqual(['GET', 'POST']);
  });
});
