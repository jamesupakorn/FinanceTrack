/** @jest-environment node */
// Focused regression test for the `getUsersForNotify` non-string `userId` type guard added in
// .pipeline/spec-line-monthly-summary-hardening.md. Follows a real-Mongo-instance pattern
// (mongodb-memory-server) rather than mocking the DB.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMocks } from 'node-mocks-http';

const TEST_CRON_SECRET = 'test-cron-secret';
const TEST_USER_ID = 'user-a';

let mongod;
let handler;
let getDbPromise;
let db;
let fetchMock;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();

  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';
  // TD-C02 follow-up: CRON_SECRET เป็นด่านเดียวและบังคับของ endpoint นี้แล้ว
  process.env.CRON_SECRET = TEST_CRON_SECRET;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-line-token';
  process.env.LINE_CHANNEL_USER_ID = '';

  jest.resetModules();

  fetchMock = jest.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }));
  handler = require('../../pages/api/line_due_notify').default;
  ({ getDbPromise } = require('../../lib/mongodb'));
  db = await getDbPromise();
}, 60000);

afterAll(async () => {
  fetchMock.mockRestore();
  if (db?.client) {
    await db.client.close();
  }
  if (mongod) {
    await mongod.stop();
  }
});

beforeEach(async () => {
  fetchMock.mockReset();
  if (db) {
    await db.collection('users').deleteMany({});
    await db.collection('monthly_expense').deleteMany({});
    await db.collection('credit_cards').deleteMany({});
  }
});

function makeReqRes({ method = 'POST', query = {}, body, headers = {}, secret = TEST_CRON_SECRET } = {}) {
  return createMocks({
    method,
    query,
    body,
    // Vercel Cron ส่ง CRON_SECRET มาทาง Authorization: Bearer โดยอัตโนมัติ
    headers: secret === null ? { ...headers } : { authorization: `Bearer ${secret}`, ...headers }
  });
}

describe('/api/line_due_notify — getUsersForNotify type guard', () => {
  it('treats a non-string userId as matching nobody instead of leaking Mongo-filter behavior', async () => {
    await db.collection('users').insertOne({ id: TEST_USER_ID, LineId: 'line-a' });

    // A Mongo-operator-shaped object is exactly the crafted-input risk the guard closes: without
    // it, `filter = { id: { $ne: null } }` would match every user with a LineId.
    const { req, res } = makeReqRes({ body: { date: '2024-01-15', userId: { $ne: null } } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.results).toEqual([]);
    expect(data.creditCardResults).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// TD-C02 follow-up: CRON_SECRET เปลี่ยนจาก "ทางเลือกคู่กับ static Bearer token" เป็นด่านเดียวที่บังคับ
describe('/api/line_due_notify — CRON_SECRET เป็นด่านเดียวและบังคับ', () => {
  const expectRejected = async (options, status) => {
    const { req, res } = makeReqRes(options);
    await handler(req, res);
    expect(res._getStatusCode()).toBe(status);
    expect(fetchMock).not.toHaveBeenCalled();
  };

  it('ไม่มี credential เลย → 401 และไม่ส่ง LINE', async () => {
    await expectRejected({ secret: null, body: { date: '2024-01-15' } }, 401);
  });

  it('secret ผิด → 401', async () => {
    await expectRejected({ secret: 'wrong-secret', body: { date: '2024-01-15' } }, 401);
  });

  it('secret ที่เป็น prefix ของค่าจริง → 401 (ไม่ใช่การเทียบแบบ startsWith)', async () => {
    await expectRejected({ secret: TEST_CRON_SECRET.slice(0, -1), body: { date: '2024-01-15' } }, 401);
  });

  it('ไม่ได้ตั้ง CRON_SECRET ไว้เลย → 500 ปิดตาย ไม่ใช่เปิดให้ทุกคน', async () => {
    const saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      await expectRejected({ secret: null, body: { date: '2024-01-15' } }, 500);
      // ส่ง secret อะไรมาก็ไม่ผ่าน เพราะไม่มีค่าที่ถูกต้องให้เทียบ
      await expectRejected({ secret: '', body: { date: '2024-01-15' } }, 500);
    } finally {
      process.env.CRON_SECRET = saved;
    }
  });

  it('secret ถูกต้องผ่าน Authorization: Bearer → ผ่านด่าน (200)', async () => {
    const { req, res } = makeReqRes({ body: { date: '2024-01-15' } });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
  });

  it('secret ถูกต้องผ่าน header x-cron-secret → ผ่านด่าน (200)', async () => {
    const { req, res } = makeReqRes({
      secret: null,
      headers: { 'x-cron-secret': TEST_CRON_SECRET },
      body: { date: '2024-01-15' }
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
  });

  it('secret ถูกต้องผ่าน query.cronSecret (GET) → ผ่านด่าน (200)', async () => {
    const { req, res } = makeReqRes({
      method: 'GET',
      secret: null,
      query: { cronSecret: TEST_CRON_SECRET, date: '2024-01-15' }
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
  });

  it('secret ถูกต้องผ่าน body.cronSecret (POST) → ผ่านด่าน (200)', async () => {
    const { req, res } = makeReqRes({
      secret: null,
      body: { cronSecret: TEST_CRON_SECRET, date: '2024-01-15' }
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
  });
});
