/** @jest-environment node */
// Integration test against a real (ephemeral, in-process) MongoDB instance — see
// .pipeline/spec-td-c01-api-coverage-2.md for why mongodb-memory-server (not mocks) was chosen: this
// route's `enforceMonthLimit` retention/deletion behavior is a real Mongo find/sort/deleteMany round
// trip, so mocking the collection would never prove the cross-user deletion-scope guarantee holds.
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
  handler = require('../../pages/api/daily_expenses').default;
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
    await db.collection('daily_expenses').deleteMany({});
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

describe('/api/daily_expenses (Mongo mode)', () => {
  it('GET with no session cookie returns 401', async () => {
    const { req, res } = makeReqRes({ userId: null, query: { month: '2026-01' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
  });

  it('PUT with a valid session but missing X-CSRF-Token returns 403 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'PUT',
      omitCsrf: true,
      body: { month: '2026-01', items: [] }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(403);
    expect(await db.collection('daily_expenses').findOne({ userId: USER_A, month: '2026-01' })).toBeNull();
  });

  it('DELETE (unsupported method) returns 405 with an empty body', async () => {
    const { req, res } = makeReqRes({ method: 'DELETE' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    // Route calls res.status(405).end() — no Allow header, no JSON body — asserting the actual
    // shape rather than a shape the handler never sends.
    expect(res._getData()).toBe('');
  });

  it('GET without a month query param returns 400', async () => {
    const { req, res } = makeReqRes({ query: {} });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'month is required' });
  });

  it('GET for a month with no document and no previous month returns 200 with an empty/zeroed response', async () => {
    const { req, res } = makeReqRes({ query: { month: '2026-01' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({
      month: '2026-01',
      items: [],
      fixedMonthly: 0,
      miscMonthly: 0,
      totalMonthly: 0
    });
  });

  it('GET carry-forward: previous month\'s fixed items appear, misc items do not', async () => {
    await db.collection('daily_expenses').insertOne({
      month: '2026-01',
      userId: USER_A,
      items: [
        { name: 'ค่าเช่า', category: 'fixed', frequency: 'daily', amount: 100 },
        { name: 'ของกิน', category: 'misc', amount: 500 }
      ]
    });

    const { req, res } = makeReqRes({ query: { month: '2026-02' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.items).toHaveLength(1);
    expect(data.items[0].name).toBe('ค่าเช่า');
    expect(data.fixedMonthly).toBe(3000); // 100 * 30
    expect(data.miscMonthly).toBe(0);
    expect(data.totalMonthly).toBe(3000);
  });

  it('raw=1 skips the carry-forward and returns the true "nothing saved yet" state', async () => {
    await db.collection('daily_expenses').insertOne({
      month: '2026-01',
      userId: USER_A,
      items: [
        { name: 'ค่าเช่า', category: 'fixed', frequency: 'daily', amount: 100 },
        { name: 'ของกิน', category: 'misc', amount: 500 }
      ]
    });

    const { req, res } = makeReqRes({ query: { month: '2026-02', raw: '1' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({
      month: '2026-02',
      items: [],
      fixedMonthly: 0,
      miscMonthly: 0,
      totalMonthly: 0
    });
  });

  it('January carries forward from the prior December (year rollover)', async () => {
    await db.collection('daily_expenses').insertOne({
      month: '2025-12',
      userId: USER_A,
      items: [
        { name: 'ค่าน้ำ', category: 'fixed', frequency: 'weekly', amount: 700 }
      ]
    });

    const { req, res } = makeReqRes({ query: { month: '2026-01' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.items).toHaveLength(1);
    expect(data.items[0].name).toBe('ค่าน้ำ');
    expect(data.fixedMonthly).toBe(3031); // Math.round(700 * 4.33 * 100) / 100
  });

  it('PUT validation: items not an array returns 400 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'PUT',
      body: { month: '2026-01', items: 'not-an-array' }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'items must be an array' });
    expect(await db.collection('daily_expenses').findOne({ userId: USER_A, month: '2026-01' })).toBeNull();
  });

  it('PUT validation: item missing name returns 400 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'PUT',
      body: { month: '2026-01', items: [{ category: 'misc', amount: 100 }] }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'item name is required' });
    expect(await db.collection('daily_expenses').findOne({ userId: USER_A, month: '2026-01' })).toBeNull();
  });

  it('PUT validation: negative amount returns 400 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'PUT',
      body: { month: '2026-01', items: [{ name: 'x', category: 'misc', amount: -1 }] }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'item amount must be >= 0' });
    expect(await db.collection('daily_expenses').findOne({ userId: USER_A, month: '2026-01' })).toBeNull();
  });

  it('PUT validation: fixed item with an invalid frequency returns 400 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'PUT',
      body: { month: '2026-01', items: [{ name: 'x', category: 'fixed', frequency: 'monthly', amount: 100 }] }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'fixed items must have frequency: daily or weekly' });
    expect(await db.collection('daily_expenses').findOne({ userId: USER_A, month: '2026-01' })).toBeNull();
  });

  it('PUT validation: misc item with a non-null frequency returns 400 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'PUT',
      body: { month: '2026-01', items: [{ name: 'x', category: 'misc', frequency: 'daily', amount: 100 }] }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'misc items must have frequency: null' });
    expect(await db.collection('daily_expenses').findOne({ userId: USER_A, month: '2026-01' })).toBeNull();
  });

  it('PUT success: mixed fixed(daily)+fixed(weekly)+misc items returns 200 with correct totals, and a following GET proves the round trip', async () => {
    const items = [
      { name: 'a', category: 'fixed', frequency: 'daily', amount: 50 },
      { name: 'b', category: 'fixed', frequency: 'weekly', amount: 200 },
      { name: 'c', category: 'misc', amount: 300 }
    ];
    const { req: putReq, res: putRes } = makeReqRes({
      method: 'PUT',
      body: { month: '2026-04', items }
    });

    await handler(putReq, putRes);

    expect(putRes._getStatusCode()).toBe(200);
    const putData = JSON.parse(putRes._getData());
    expect(putData.fixedMonthly).toBe(2366); // Math.round((50*30 + 200*4.33) * 100) / 100
    expect(putData.miscMonthly).toBe(300);
    expect(putData.totalMonthly).toBe(2666);

    // Real read-after-write against the actual in-memory Mongo instance — not a stubbed value.
    const { req: getReq, res: getRes } = makeReqRes({ query: { month: '2026-04' } });
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    const getData = JSON.parse(getRes._getData());
    expect(getData.items).toEqual(items);
    expect(getData.fixedMonthly).toBe(2366);
    expect(getData.miscMonthly).toBe(300);
    expect(getData.totalMonthly).toBe(2666);
  });

  it('cross-user isolation: PUT for User A does not create or alter a document for User B', async () => {
    const { req: putReq, res: putRes } = makeReqRes({
      method: 'PUT',
      userId: USER_A,
      body: { month: '2026-03', items: [{ name: 'a', category: 'misc', amount: 100 }] }
    });
    await handler(putReq, putRes);
    expect(putRes._getStatusCode()).toBe(200);

    const { req: getReq, res: getRes } = makeReqRes({ userId: USER_B, query: { month: '2026-03' } });
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    expect(JSON.parse(getRes._getData())).toEqual({
      month: '2026-03',
      items: [],
      fixedMonthly: 0,
      miscMonthly: 0,
      totalMonthly: 0
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

    // Seed the first 15 directly; PUT the 16th through the real handler to exercise
    // enforceMonthLimit's read/delete path (the property under test).
    const seedMonths = months.slice(0, 15);
    const lastMonth = months[15];

    await db.collection('daily_expenses').insertMany(
      seedMonths.map(month => ({ month, userId: USER_A, items: [] }))
    );

    // A different user's document, at a month outside the 16-month range under test.
    await db.collection('daily_expenses').insertOne({ month: '2025-05', userId: USER_B, items: [] });

    const { req, res } = makeReqRes({
      method: 'PUT',
      userId: USER_A,
      body: { month: lastMonth, items: [] }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);

    const userACount = await db.collection('daily_expenses').countDocuments({ userId: USER_A });
    expect(userACount).toBe(15);

    // Oldest month (2024-01) was evicted; newest (2025-04) survives.
    expect(await db.collection('daily_expenses').findOne({ userId: USER_A, month: '2024-01' })).toBeNull();
    expect(await db.collection('daily_expenses').findOne({ userId: USER_A, month: '2025-04' })).not.toBeNull();

    // User B's document, outside the range, survives untouched — proves the deleteMany filter is
    // userFilter-scoped, not just month-scoped.
    const userBDoc = await db.collection('daily_expenses').findOne({ userId: USER_B, month: '2025-05' });
    expect(userBDoc).not.toBeNull();
  });
});
