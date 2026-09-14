/** @jest-environment node */
// Integration test against a real (ephemeral, in-process) MongoDB instance — mirrors the pattern
// in __tests__/api/user-bank-accounts.test.js (see .pipeline/spec-test-suite-foundation.md §3).
//
// Covers TD-H10 (login rate limiting): composite IP+userId lockout, demo-login exclusion, and
// fail-open behavior on the limiter's own Mongo failure. lib/dataMode.config.js / lib/userStore.js /
// loginRateLimit.js all read process.env.DATA_MODE / process.env.MONGODB_URI once at first-import
// time — env vars are set before `jest.resetModules()` + fresh `require(...)` so every module under
// test picks up the test env instead of whatever was cached from an earlier test file/process.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMocks } from 'node-mocks-http';
import bcrypt from 'bcryptjs';

// Wrap the real lib/mongodb.getDbPromise in a jest.fn so individual tests can override its
// resolved value (simulating a Mongo outage) without touching the underlying connection logic.
// Every module that requires 'lib/mongodb' — including loginRateLimit.js internally — resolves to
// this same mocked module object, so overriding it here is visible everywhere.
jest.mock('../../lib/mongodb', () => {
  const actual = jest.requireActual('../../lib/mongodb');
  return {
    __esModule: true,
    getDbPromise: jest.fn((...args) => actual.getDbPromise(...args))
  };
});

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const REAL_USER_ID = 'u001';
const OTHER_USER_ID = 'u002';
const CORRECT_PIN = '1234';
const WRONG_PIN = '9999';

let mongod;
let handler;
let db;
let loginRateLimit; // { FAILURE_THRESHOLD, WINDOW_MS }

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();

  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';
  process.env.SESSION_SECRET = TEST_SECRET;

  jest.resetModules();

  handler = require('../../pages/api/auth/profile-login').default;
  loginRateLimit = require('../../src/shared/utils/backend/loginRateLimit');
  const { getDbPromise } = require('../../lib/mongodb');
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
    await db.collection('users').deleteMany({});
    await db.collection('loginAttempts').deleteMany({});
  }
});

async function seedUser(id, { isDemo = false } = {}) {
  const passwordHash = await bcrypt.hash(CORRECT_PIN, 10);
  await db.collection('users').insertOne({
    id,
    displayName: id,
    avatar: null,
    passwordHash,
    isDemo
  });
}

function makeLoginReq({ userId, password, ip = '203.0.113.10' } = {}) {
  return createMocks({
    method: 'POST',
    body: { userId, password },
    headers: { 'x-forwarded-for': ip }
  });
}

describe('/api/auth/profile-login rate limiting (TD-H10)', () => {
  it('allows the first several wrong-PIN attempts unchanged (401, no Retry-After) below threshold', async () => {
    await seedUser(REAL_USER_ID);

    for (let i = 0; i < loginRateLimit.FAILURE_THRESHOLD - 1; i++) {
      const { req, res } = makeLoginReq({ userId: REAL_USER_ID, password: WRONG_PIN });
      await handler(req, res);
      expect(res._getStatusCode()).toBe(401);
      expect(res._getJSONData()).toEqual({ error: 'รหัสผ่านไม่ถูกต้อง' });
      expect(res._getHeaders()['retry-after']).toBeUndefined();
    }
  });

  it('locks out a real account after N failed attempts within the window, with a 429 + Retry-After', async () => {
    await seedUser(REAL_USER_ID);

    // Per spec §2: the attempt that crosses the threshold still returns 401 (unchanged body) —
    // failCount is incremented and lockedUntil is set as a side effect of that same request, but
    // the *response* for that request is not retroactively changed to 429. Only the *next* request
    // (which now sees an already-locked key via checkLockStatus, before touching checkUserPassword
    // at all) gets the 429.
    for (let i = 0; i < loginRateLimit.FAILURE_THRESHOLD; i++) {
      const { req, res } = makeLoginReq({ userId: REAL_USER_ID, password: WRONG_PIN });
      await handler(req, res);
      expect(res._getStatusCode()).toBe(401);
    }

    // subsequent attempt — even with the CORRECT pin — must stay locked out (checkUserPassword
    // must not even be consulted while locked)
    const { req, res } = makeLoginReq({ userId: REAL_USER_ID, password: CORRECT_PIN });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(429);
    expect(res._getJSONData()).toEqual({
      error: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณาลองใหม่อีกครั้งภายหลัง'
    });
    expect(Number(res._getHeaders()['retry-after'])).toBeGreaterThan(0);
  });

  it('a correct login resets the counter so the account is not left artificially locked', async () => {
    await seedUser(REAL_USER_ID);

    // fail a few times, but stay below threshold
    for (let i = 0; i < loginRateLimit.FAILURE_THRESHOLD - 1; i++) {
      const { req, res } = makeLoginReq({ userId: REAL_USER_ID, password: WRONG_PIN });
      await handler(req, res);
      expect(res._getStatusCode()).toBe(401);
    }

    // correct login clears the counter
    const { req, res } = makeLoginReq({ userId: REAL_USER_ID, password: CORRECT_PIN });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);

    // fresh window: the next failureThreshold - 1 wrong attempts stay below lockout again
    for (let i = 0; i < loginRateLimit.FAILURE_THRESHOLD - 1; i++) {
      const { req: req2, res: res2 } = makeLoginReq({ userId: REAL_USER_ID, password: WRONG_PIN });
      await handler(req2, res2);
      expect(res2._getStatusCode()).toBe(401);
    }
  });

  it('lockout is scoped to the IP+userId composite — a different IP is unaffected', async () => {
    await seedUser(REAL_USER_ID);

    for (let i = 0; i < loginRateLimit.FAILURE_THRESHOLD; i++) {
      const { req, res } = makeLoginReq({ userId: REAL_USER_ID, password: WRONG_PIN, ip: '203.0.113.10' });
      await handler(req, res);
    }

    // same userId, different IP: not locked
    const { req, res } = makeLoginReq({ userId: REAL_USER_ID, password: CORRECT_PIN, ip: '198.51.100.20' });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
  });

  it('lockout is scoped to the IP+userId composite — a different userId from the same IP is unaffected', async () => {
    await seedUser(REAL_USER_ID);
    await seedUser(OTHER_USER_ID);

    for (let i = 0; i < loginRateLimit.FAILURE_THRESHOLD; i++) {
      const { req, res } = makeLoginReq({ userId: REAL_USER_ID, password: WRONG_PIN, ip: '203.0.113.10' });
      await handler(req, res);
    }

    // same IP, different userId: not locked
    const { req, res } = makeLoginReq({ userId: OTHER_USER_ID, password: CORRECT_PIN, ip: '203.0.113.10' });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
  });

  it('demo login is never rate-limited, even after many rapid attempts from one IP', async () => {
    await seedUser('demo', { isDemo: true });

    // Far more than FAILURE_THRESHOLD — must never see a 429, since checkUserPassword/rate-limit
    // logic is skipped entirely for isDemo === true.
    const attempts = loginRateLimit.FAILURE_THRESHOLD + 20;
    for (let i = 0; i < attempts; i++) {
      const { req, res } = makeLoginReq({ userId: 'demo', password: 'anything-ignored', ip: '203.0.113.10' });
      await handler(req, res);
      expect(res._getStatusCode()).toBe(200);
    }
  });

  it('fails open when the limiter\'s own Mongo read/write fails — login still proceeds normally', async () => {
    await seedUser(REAL_USER_ID);

    // Simulate a Mongo outage by making the db handle throw when the limiter touches loginAttempts.
    // checkUserPassword/getUserById still go through the real (working) db, so this isolates the
    // failure to the rate-limiter's own storage, matching the "limiter outage, not a real Mongo
    // outage" scenario the fail-open design is meant to cover.
    const brokenDb = {
      collection: (name) => {
        if (name === 'loginAttempts') {
          return {
            findOne: () => { throw new Error('simulated Mongo outage'); },
            findOneAndUpdate: () => { throw new Error('simulated Mongo outage'); },
            updateOne: () => { throw new Error('simulated Mongo outage'); },
            deleteOne: () => { throw new Error('simulated Mongo outage'); }
          };
        }
        return db.collection(name);
      }
    };
    // brokenDb forwards every collection *other* than loginAttempts straight through to the real
    // db, so getUserById/checkUserPassword (both go through the `users` collection) keep working
    // normally — only the limiter's own reads/writes are broken, matching "the limiter's own
    // infrastructure failure" rather than a full Mongo outage that would also break login itself.
    const { getDbPromise } = require('../../lib/mongodb');
    getDbPromise.mockResolvedValue(brokenDb);

    try {
      // wrong PIN still returns 401 (password check itself is unaffected by the limiter outage)
      const { req: reqWrong, res: resWrong } = makeLoginReq({ userId: REAL_USER_ID, password: WRONG_PIN });
      await handler(reqWrong, resWrong);
      expect(resWrong._getStatusCode()).toBe(401);

      // correct PIN still logs in successfully — limiter outage must not block login (fail-open)
      const { req: reqOk, res: resOk } = makeLoginReq({ userId: REAL_USER_ID, password: CORRECT_PIN });
      await handler(reqOk, resOk);
      expect(resOk._getStatusCode()).toBe(200);
    } finally {
      getDbPromise.mockRestore ? getDbPromise.mockRestore() : getDbPromise.mockReset();
    }
  });
});
