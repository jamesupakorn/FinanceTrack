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

const TEST_TOKEN = 'test-token';
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

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();

  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';
  process.env.API_ACCESS_TOKEN = TEST_TOKEN;
  // Make sure no higher-precedence token source (encrypted/base64) from a real .env.local leaks in
  // and overrides the plain test token above (see apiTokenAuth.js's precedence order).
  delete process.env.API_ACCESS_TOKEN_ENCRYPTED;
  delete process.env.API_ACCESS_TOKEN_ENCRYPTION_KEY;
  delete process.env.API_ACCESS_TOKEN_B64;
  delete process.env.API_TOKEN_B64;
  delete process.env.API_TOKEN;

  jest.resetModules();

  // Fresh `require` (not a top-of-file static `import`) so dataMode.config.js/userStore.js/the
  // handler re-read the env vars set above, rather than whatever was resolved at first import.
  handler = require('../../pages/api/user-bank-accounts').default;
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

function makeReqRes({ method = 'GET', query = {}, body, headers = {} } = {}) {
  return createMocks({
    method,
    query,
    body,
    headers: { authorization: `Bearer ${TEST_TOKEN}`, ...headers }
  });
}

describe('/api/user-bank-accounts (Mongo mode)', () => {
  it('GET without an Authorization header returns 401', async () => {
    const { req, res } = createMocks({ method: 'GET', query: { userId: TEST_USER_ID } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
  });

  it('GET for a user with no document yet returns 200 with documented defaults', async () => {
    const { req, res } = makeReqRes({ query: { userId: 'user-with-no-document' } });

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
      query: { userId: TEST_USER_ID },
      body: { bankAccounts: newAccounts }
    });

    await handler(postReq, postRes);

    expect(postRes._getStatusCode()).toBe(200);
    const postData = JSON.parse(postRes._getData());
    expect(postData).toEqual({ success: true, bankAccounts: newAccounts });

    // Real read-after-write against the actual in-memory Mongo instance — not a stubbed value.
    const { req: getReq, res: getRes } = makeReqRes({ query: { userId: TEST_USER_ID } });
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
      query: { userId: TEST_USER_ID },
      body: { budgetThresholds: invalidThresholds }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);

    const userDoc = await db.collection('users').findOne({ id: TEST_USER_ID });
    expect(userDoc.budgetThresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('DELETE (unsupported method) returns 405 with an Allow header', async () => {
    const { req, res } = makeReqRes({ method: 'DELETE', query: { userId: TEST_USER_ID } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    const headers = res._getHeaders();
    const allowHeader = headers.allow || headers.Allow;
    expect(allowHeader).toEqual(['GET', 'POST']);
  });
});
