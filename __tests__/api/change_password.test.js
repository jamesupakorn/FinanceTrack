/** @jest-environment node */
// Integration test against a real (ephemeral, in-process) MongoDB instance — see
// .pipeline/spec-td-c01-api-coverage.md for why mongodb-memory-server (not mocks) was chosen: this
// route's entire value is the real bcrypt-compare-then-bcrypt-hash round trip, so mocking
// lib/userStore.js would test nothing meaningful.
//
// `lib/dataMode.config.js` / `lib/userStore.js` read process.env.DATA_MODE / process.env.MONGODB_URI
// once, at first-import time (module-level `const`). This test therefore sets those env vars first,
// then `jest.resetModules()` + `require(...)` the handler and db module fresh inside `beforeAll`, so
// they pick up the test env instead of whatever was cached from an earlier test file/process.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMocks } from 'node-mocks-http';
import bcrypt from 'bcryptjs';

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'test-user-a';
const USER_B = 'test-user-b';
const ORIGINAL_PASSWORD = 'correct-horse-battery-staple';
const WRONG_PASSWORD_ERROR = 'รหัสผ่านปัจจุบันไม่ถูกต้อง';

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

  // Fresh `require` (not a top-of-file static `import`) so dataMode.config.js/userStore.js/the
  // handler re-read the env vars set above, rather than whatever was resolved at first import.
  handler = require('../../pages/api/change_password').default;
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
  // Distinct passwordHash values (bcrypt salts per call) even though both users share the same
  // plaintext ORIGINAL_PASSWORD — needed for the cross-user-isolation test's "untouched" check.
  const passwordHash = await bcrypt.hash(ORIGINAL_PASSWORD, 10);
  await db.collection('users').insertOne({ id: USER_A, displayName: 'User A', passwordHash });
  await db.collection('users').insertOne({ id: USER_B, displayName: 'User B', passwordHash });
});

/**
 * request ที่ผ่านด่าน auth ครบ: session cookie ของ `userId` + X-CSRF-Token ที่ผูกกับ sid เดียวกัน
 * (route นี้เป็น POST-only จึงแนบ CSRF token เสมอ เว้นแต่ omitCsrf)
 */
function makeReqRes({ userId = USER_A, body, headers = {}, method = 'POST', omitCsrf = false } = {}) {
  const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
  const sid = createSessionId();
  return createMocks({
    method,
    body,
    cookies: userId ? { [SESSION_COOKIE_NAME]: signSession(userId, sid) } : {},
    headers: {
      ...(!omitCsrf ? { 'x-csrf-token': signCsrfToken(sid) } : {}),
      ...headers
    }
  });
}

async function expectUserAHashUnchanged() {
  const userA = await db.collection('users').findOne({ id: USER_A });
  expect(await bcrypt.compare(ORIGINAL_PASSWORD, userA.passwordHash)).toBe(true);
}

describe('/api/change_password (Mongo mode)', () => {
  it('no session cookie returns 401 and does not change the password', async () => {
    const { req, res } = makeReqRes({
      userId: null,
      body: { currentPassword: ORIGINAL_PASSWORD, newPassword: 'new-pass' }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
    await expectUserAHashUnchanged();
  });

  it('valid session but missing X-CSRF-Token returns 403 and does not change the password', async () => {
    const { req, res } = makeReqRes({
      omitCsrf: true,
      body: { currentPassword: ORIGINAL_PASSWORD, newPassword: 'new-pass' }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(403);
    await expectUserAHashUnchanged();
  });

  it('GET (unsupported method) returns 405', async () => {
    const { req, res } = makeReqRes({ method: 'GET' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Method not allowed' });
  });

  it('missing newPassword returns 400 and does not change the password', async () => {
    const { req, res } = makeReqRes({ body: { currentPassword: ORIGINAL_PASSWORD } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Missing required fields' });
    await expectUserAHashUnchanged();
  });

  it('missing currentPassword returns 400 and does not change the password', async () => {
    const { req, res } = makeReqRes({ body: { newPassword: 'new-pass' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Missing required fields' });
    await expectUserAHashUnchanged();
  });

  it('wrong currentPassword returns 401 with the generic message and does not change the password', async () => {
    const { req, res } = makeReqRes({
      body: { currentPassword: 'totally-wrong', newPassword: 'new-pass' }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(JSON.parse(res._getData())).toEqual({ error: WRONG_PASSWORD_ERROR });
    await expectUserAHashUnchanged();
  });

  it('a session for a userId with no user document gets the identical 401 message (no account-existence oracle)', async () => {
    const { req, res } = makeReqRes({
      userId: 'ghost-user',
      body: { currentPassword: ORIGINAL_PASSWORD, newPassword: 'new-pass' }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(JSON.parse(res._getData())).toEqual({ error: WRONG_PASSWORD_ERROR });
  });

  it('correct currentPassword changes the password (real round trip) and leaves User B untouched', async () => {
    const { req, res } = makeReqRes({
      body: { currentPassword: ORIGINAL_PASSWORD, newPassword: 'brand-new-password-123' }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ success: true });

    // Real read-after-write against the actual in-memory Mongo instance — not a stubbed value.
    const userA = await db.collection('users').findOne({ id: USER_A });
    expect(await bcrypt.compare('brand-new-password-123', userA.passwordHash)).toBe(true);
    expect(await bcrypt.compare(ORIGINAL_PASSWORD, userA.passwordHash)).toBe(false);

    // A second handler call using the *old* password now fails — proves the change took effect at
    // the level a real client would observe it, not only at the storage layer.
    const { req: secondReq, res: secondRes } = makeReqRes({
      body: { currentPassword: ORIGINAL_PASSWORD, newPassword: 'another-new-password' }
    });
    await handler(secondReq, secondRes);
    expect(secondRes._getStatusCode()).toBe(401);

    // User B's hash (unrelated to this request) is untouched — the session-cookie-scoped write
    // never touched a document it wasn't authorized for.
    const userB = await db.collection('users').findOne({ id: USER_B });
    expect(await bcrypt.compare(ORIGINAL_PASSWORD, userB.passwordHash)).toBe(true);
  });

  it('the success response body never contains a raw passwordHash field', async () => {
    const { req, res } = makeReqRes({
      body: { currentPassword: ORIGINAL_PASSWORD, newPassword: 'brand-new-password-123' }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data).not.toHaveProperty('passwordHash');
  });
});
