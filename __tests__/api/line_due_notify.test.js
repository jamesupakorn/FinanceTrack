/** @jest-environment node */
// Focused regression test for the `getUsersForNotify` non-string `userId` type guard added in
// .pipeline/spec-line-monthly-summary-hardening.md. Follows a real-Mongo-instance pattern
// (mongodb-memory-server) rather than mocking the DB.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMocks } from 'node-mocks-http';

// ห่อ getMongoCollection ด้วย jest.fn เพื่อบังคับให้การดึงข้อมูลของผู้ใช้บางคนพังได้ในเทสต์ isolation
// (ค่าเริ่มต้นเรียกของจริงเสมอ — ทุกเทสต์อื่นยังคุยกับ Mongo จริงเหมือนเดิม)
jest.mock('../../lib/dataSource', () => {
  const actual = jest.requireActual('../../lib/dataSource');
  return { ...actual, getMongoCollection: jest.fn(actual.getMongoCollection) };
});

// เหมือนด้านบน: ให้ getUserCreditData คืนข้อมูลที่ทำให้ collectCardDueEvents พังได้เป็นรายผู้ใช้
jest.mock('../../src/shared/utils/backend/creditCardStore', () => {
  const actual = jest.requireActual('../../src/shared/utils/backend/creditCardStore');
  return { ...actual, getUserCreditData: jest.fn(actual.getUserCreditData) };
});

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

describe('/api/line_due_notify — per-user isolation', () => {
  const seedDueUsers = async () => {
    // beforeEach ล้าง implementation ของ fetchMock — เทสต์กลุ่มนี้ส่งข้อความจริงจึงต้องตั้งคำตอบ LINE เอง
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const users = ['user-1', 'user-2', 'user-3'];
    await db.collection('users').insertMany(users.map(id => ({ id, LineId: `line-${id}` })));
    await db.collection('monthly_expense').insertMany(users.map(id => ({
      userId: id,
      month: '2024-01',
      rent: { name: 'ค่าเช่า', actual: 1000, dueDay: 15 }
    })));
    return users;
  };

  afterEach(() => {
    require('../../lib/dataSource').getMongoCollection.mockImplementation(
      jest.requireActual('../../lib/dataSource').getMongoCollection
    );
  });

  it('ผู้ใช้คนแรกดึงข้อมูลพัง → คนที่ 2 และ 3 ยังได้รับแจ้งเตือน และ response ยังเป็น 200', async () => {
    await seedDueUsers();
    const actual = jest.requireActual('../../lib/dataSource');
    let failed = false;
    require('../../lib/dataSource').getMongoCollection.mockImplementation(async (name) => {
      // การอ่าน monthly_expense ครั้งแรกเป็นของ user-1 (ลำดับตาม insert) — ทำให้พังครั้งเดียว
      if (name === 'monthly_expense' && !failed) {
        failed = true;
        throw new Error('boom');
      }
      return actual.getMongoCollection(name);
    });

    const { req, res } = makeReqRes({ body: { date: '2024-01-15' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const { results } = JSON.parse(res._getData());
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ userId: 'user-1', sent: false, reason: 'user processing failed' });
    expect(results.slice(1).map(r => [r.userId, r.sent])).toEqual([['user-2', true], ['user-3', true]]);
    // เหตุผลภายในของ error ต้องไม่รั่วออกไปใน response
    expect(JSON.stringify(results)).not.toContain('boom');
    // ส่งข้อความจริงเฉพาะ 2 คนที่ไม่พัง (ไม่มีบัตรเครดิต จึงไม่มีข้อความที่สอง)
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ทุกคนปกติ → ส่งครบทุกคนเหมือนเดิม (พฤติกรรมเดิมไม่เปลี่ยน)', async () => {
    await seedDueUsers();
    const { req, res } = makeReqRes({ body: { date: '2024-01-15' } });
    await handler(req, res);

    const { results } = JSON.parse(res._getData());
    expect(results.map(r => r.sent)).toEqual([true, true, true]);
    expect(results[0]).toMatchObject({ count: 1, breakdown: { due: 1, dueSoon: 0, overdue: 0, otherUnpaid: 0 } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('บัตรเครดิต: สร้างข้อความของผู้ใช้คนแรกพัง → ผู้ใช้คนถัดไปยังถูกประมวลผล และ response ยังเป็น 200', async () => {
    await seedDueUsers();
    const store = require('../../src/shared/utils/backend/creditCardStore');
    const actual = jest.requireActual('../../src/shared/utils/backend/creditCardStore');
    // getter โยน error เมื่อ collectCardDueEvents อ่าน .cards — อยู่ในส่วนที่เคยไม่ได้ครอบ try
    store.getUserCreditData.mockImplementation(async (userId) => (
      userId === 'user-1' ? { get cards() { throw new Error('bad card data'); } } : actual.getUserCreditData(userId)
    ));
    try {
      const { req, res } = makeReqRes({ body: { date: '2024-01-15' } });
      await handler(req, res);

      expect(res._getStatusCode()).toBe(200);
      const { creditCardResults } = JSON.parse(res._getData());
      expect(creditCardResults).toHaveLength(3);
      expect(creditCardResults[0]).toMatchObject({ userId: 'user-1', sent: false });
      expect(creditCardResults[1]).toEqual({ userId: 'user-2', sent: false, reason: 'no credit card due items' });
    } finally {
      store.getUserCreditData.mockImplementation(actual.getUserCreditData);
    }
  });
});
