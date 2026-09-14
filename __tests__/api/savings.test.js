/** @jest-environment node */
// Integration test against a real (ephemeral, in-process) MongoDB instance — see
// .pipeline/spec-td-c01-api-coverage-3.md for why mongodb-memory-server (not mocks) was chosen: this
// route's `enforceMonthLimit` retention/deletion behavior and the `transfer` sub-flow's `$ne`-guarded
// `$push` idempotency guarantee are both real Mongo round trips, so mocking the collection would never
// prove either property actually holds.
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
  handler = require('../../pages/api/savings').default;
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
    await db.collection('savings').deleteMany({});
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

describe('/api/savings (Mongo mode)', () => {
  it('GET with no session cookie returns 401', async () => {
    const { req, res } = makeReqRes({ userId: null, query: { month: '2026-01' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
  });

  it('POST with a valid session but missing X-CSRF-Token returns 403 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      omitCsrf: true,
      body: { month: '2026-01', savings_list: [] }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(403);
    expect(await db.collection('savings').findOne({ userId: USER_A, month: '2026-01' })).toBeNull();
  });

  it('DELETE (unsupported method) returns 405 with an empty body', async () => {
    const { req, res } = makeReqRes({ method: 'DELETE' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    // Route calls res.status(405).end() — no Allow header, no JSON body — asserting the actual
    // shape rather than a shape the handler never sends.
    expect(res._getData()).toBe('');
  });

  it('GET for a month with no document returns 200 with the default zeroed shape', async () => {
    const { req, res } = makeReqRes({ query: { month: '2026-01' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({
      total_savings: 0,
      savings_list: [],
      รวมเงินเก็บ: 0
    });
  });

  it('GET for a month with a document returns 200 with the stored list and a correctly-summed total (savings_amount/amount fallback)', async () => {
    const savingsList = [
      { savings_type: 'ออมทอง', savings_amount: 200 },
      { savings_type: 'ออมหุ้น', amount: 300 }
    ];
    await db.collection('savings').insertOne({
      month: '2026-01',
      userId: USER_A,
      total_savings: 999,
      savings_list: savingsList
    });

    const { req, res } = makeReqRes({ query: { month: '2026-01' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({
      total_savings: 999,
      savings_list: savingsList,
      รวมเงินเก็บ: 500
    });
  });

  it('calculateTotalSavings strips commas from string amounts', async () => {
    await db.collection('savings').insertOne({
      month: '2026-01',
      userId: USER_A,
      total_savings: 0,
      savings_list: [{ savings_type: 'x', savings_amount: '1,234.5' }]
    });

    const { req, res } = makeReqRes({ query: { month: '2026-01' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData()).รวมเงินเก็บ).toBe(1234.5);
  });

  it('GET without a month query param returns 200 with all months, keyed by month', async () => {
    await db.collection('savings').insertOne({
      month: '2026-01',
      userId: USER_A,
      total_savings: 100,
      savings_list: [{ savings_type: 'a', savings_amount: 100 }]
    });
    await db.collection('savings').insertOne({
      month: '2026-02',
      userId: USER_A,
      total_savings: 200,
      savings_list: [{ savings_type: 'b', savings_amount: 200 }]
    });

    const { req, res } = makeReqRes({ query: {} });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(Object.keys(data).sort()).toEqual(['2026-01', '2026-02']);
    expect(data['2026-01']).toEqual({
      total_savings: 100,
      savings_list: [{ savings_type: 'a', savings_amount: 100 }],
      totalSavings: 100,
      รวมเงินเก็บ: 100
    });
    expect(data['2026-02']).toEqual({
      total_savings: 200,
      savings_list: [{ savings_type: 'b', savings_amount: 200 }],
      totalSavings: 200,
      รวมเงินเก็บ: 200
    });
  });

  it('POST validation: missing month returns 400 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { savings_list: [] }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'month required' });
    expect(await db.collection('savings').countDocuments({})).toBe(0);
  });

  it('POST success: savings_list + total_savings upsert, and a following GET proves the round trip', async () => {
    const body = {
      month: '2026-03',
      total_savings: 1500,
      savings_list: [{ savings_type: 'ออมทอง', savings_amount: 1500 }]
    };
    const { req: postReq, res: postRes } = makeReqRes({ method: 'POST', body });

    await handler(postReq, postRes);

    expect(postRes._getStatusCode()).toBe(201);
    expect(JSON.parse(postRes._getData())).toEqual({ success: true });

    const { req: getReq, res: getRes } = makeReqRes({ query: { month: '2026-03' } });
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    expect(JSON.parse(getRes._getData())).toEqual({
      total_savings: 1500,
      savings_list: [{ savings_type: 'ออมทอง', savings_amount: 1500 }],
      รวมเงินเก็บ: 1500
    });
  });

  it('POST with total_savings omitted does not overwrite a previously-stored total_savings', async () => {
    await db.collection('savings').insertOne({
      month: '2026-04',
      userId: USER_A,
      total_savings: 777,
      savings_list: []
    });

    const { req: postReq, res: postRes } = makeReqRes({
      method: 'POST',
      body: { month: '2026-04', savings_list: [{ savings_type: 'x', savings_amount: 100 }] }
    });
    await handler(postReq, postRes);
    expect(postRes._getStatusCode()).toBe(201);

    const { req: getReq, res: getRes } = makeReqRes({ query: { month: '2026-04' } });
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    const data = JSON.parse(getRes._getData());
    expect(data.total_savings).toBe(777);
    expect(data.savings_list).toEqual([{ savings_type: 'x', savings_amount: 100 }]);
    expect(data.รวมเงินเก็บ).toBe(100);
  });

  it('POST transfer: valid transfer inserts one item, created: true', async () => {
    const body = { month: '2026-05', transfer: { amount: 250, key: 'transfer-key-1' } };
    const { req: postReq, res: postRes } = makeReqRes({ method: 'POST', body });

    await handler(postReq, postRes);

    expect(postRes._getStatusCode()).toBe(201);
    expect(JSON.parse(postRes._getData())).toEqual({ success: true, created: true });

    const { req: getReq, res: getRes } = makeReqRes({ query: { month: '2026-05' } });
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    const data = JSON.parse(getRes._getData());
    expect(data.savings_list).toHaveLength(1);
    expect(data.savings_list[0]).toEqual({
      savings_type: 'เงินออมจากเงินเหลือ',
      savings_amount: 250,
      transferKey: 'transfer-key-1',
      source: 'transferable-savings'
    });
  });

  it('POST transfer idempotency: a repeated POST with the same transfer.key is a no-op', async () => {
    const body = { month: '2026-05', transfer: { amount: 250, key: 'transfer-key-1' } };

    const first = makeReqRes({ method: 'POST', body });
    await handler(first.req, first.res);
    expect(first.res._getStatusCode()).toBe(201);
    expect(JSON.parse(first.res._getData())).toEqual({ success: true, created: true });

    const second = makeReqRes({ method: 'POST', body });
    await handler(second.req, second.res);

    expect(second.res._getStatusCode()).toBe(201);
    expect(JSON.parse(second.res._getData())).toEqual({ success: true, created: false });

    // Proves the $ne-guarded $push genuinely prevented a duplicate insert against real Mongo update
    // semantics — not merely that the second POST returned 200/201.
    const { req: getReq, res: getRes } = makeReqRes({ query: { month: '2026-05' } });
    await handler(getReq, getRes);
    const data = JSON.parse(getRes._getData());
    expect(data.savings_list).toHaveLength(1);
  });

  it('POST transfer validation: non-finite/zero/negative amount returns 400 and does not write', async () => {
    const cases = [
      { month: '2026-06', transfer: { amount: 0, key: 'k' } },
      { month: '2026-07', transfer: { amount: -5, key: 'k' } },
      { month: '2026-08', transfer: { amount: 'not-a-number', key: 'k' } }
    ];

    for (const body of cases) {
      const { req, res } = makeReqRes({ method: 'POST', body });
      await handler(req, res);

      expect(res._getStatusCode()).toBe(400);
      expect(JSON.parse(res._getData())).toEqual({ error: 'valid transfer amount and key required' });
      expect(await db.collection('savings').findOne({ userId: USER_A, month: body.month })).toBeNull();
    }
  });

  it('POST transfer validation: empty/whitespace-only key returns 400 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { month: '2026-09', transfer: { amount: 100, key: '   ' } }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'valid transfer amount and key required' });
    expect(await db.collection('savings').findOne({ userId: USER_A, month: '2026-09' })).toBeNull();
  });

  it('cross-user isolation: POST for User A does not create or alter a document for User B', async () => {
    const { req: postReq, res: postRes } = makeReqRes({
      method: 'POST',
      userId: USER_A,
      body: { month: '2026-10', total_savings: 500, savings_list: [{ savings_type: 'a', savings_amount: 500 }] }
    });
    await handler(postReq, postRes);
    expect(postRes._getStatusCode()).toBe(201);

    const { req: getReq, res: getRes } = makeReqRes({ userId: USER_B, query: { month: '2026-10' } });
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    expect(JSON.parse(getRes._getData())).toEqual({
      total_savings: 0,
      savings_list: [],
      รวมเงินเก็บ: 0
    });
  });

  it('enforceMonthLimit retains only the newest 15 months and never touches another user\'s rows', async () => {
    // 16 distinct months for USER_A: 2024-01 .. 2025-04 (16 months inclusive).
    const months = [];
    for (let y = 2024; y <= 2025; y++) {
      for (let m = 1; m <= 12; m++) {
        if (y === 2025 && m > 4) break;
        months.push(`${y}-${String(m).padStart(2, '0')}`);
      }
    }
    expect(months).toHaveLength(16);

    // Seed the first 15 directly; POST the 16th through the real handler to exercise
    // enforceMonthLimit's read/delete path (the property under test) at this route's own call site.
    const seedMonths = months.slice(0, 15);
    const lastMonth = months[15];

    await db.collection('savings').insertMany(
      seedMonths.map(month => ({ month, userId: USER_A, total_savings: 0, savings_list: [] }))
    );

    // A different user's document, at a month outside the 16-month range under test.
    await db.collection('savings').insertOne({
      month: '2025-05',
      userId: USER_B,
      total_savings: 0,
      savings_list: []
    });

    const { req, res } = makeReqRes({
      method: 'POST',
      userId: USER_A,
      body: { month: lastMonth, savings_list: [] }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(201);

    const userACount = await db.collection('savings').countDocuments({ userId: USER_A });
    expect(userACount).toBe(15);

    // Oldest month (2024-01) was evicted; newest (2025-04) survives.
    expect(await db.collection('savings').findOne({ userId: USER_A, month: '2024-01' })).toBeNull();
    expect(await db.collection('savings').findOne({ userId: USER_A, month: '2025-04' })).not.toBeNull();

    // User B's document, outside the range, survives untouched — proves the deleteMany filter is
    // userFilter-scoped, not just month-scoped.
    const userBDoc = await db.collection('savings').findOne({ userId: USER_B, month: '2025-05' });
    expect(userBDoc).not.toBeNull();
  });
});
