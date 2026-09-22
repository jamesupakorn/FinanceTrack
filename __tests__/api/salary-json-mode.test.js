/** @jest-environment node */
// เคส OT ชุดเดียวกับ salary.test.js (Mongo) รันซ้ำใน `DATA_MODE=json` — AC-OT-21
// สองโหมดต้องคืนค่า income / deduct / overtime / overtimeLegacy / summary ตรงกันสำหรับเอกสารเดียวกัน
// (`_id` มีเฉพาะฝั่ง JSON และ userId ถูกตัดทิ้งฝั่ง Mongo จึงไม่นับรวมในการเทียบ — A-8)
//
// เส้นทาง JSON อ่าน/เขียนผ่าน getUserData/updateUserData เท่านั้น จึง mock ชั้นนั้นด้วย store ในหน่วยความจำ
// แทนการแตะ src/backend/data/*.json จริง — enforceSharedMonthWindowJson ก็ใช้โมดูลเดียวกัน จึงถูกครอบไปด้วย
import { createMocks } from 'node-mocks-http';
import { SALARY_OT_PARITY_SCENARIOS, pickParityFields } from './salaryOvertimeParity.fixtures';

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'test-user-a';
const JSON_FILENAME = 'salary.json';

jest.mock('../../src/backend/data/userUtils.js', () => {
  const store = {};
  const bucketOf = (filename, userId) => {
    if (!store[filename]) store[filename] = {};
    if (!store[filename][userId]) store[filename][userId] = {};
    return store[filename][userId];
  };
  return {
    __store: store,
    __reset: () => Object.keys(store).forEach((key) => delete store[key]),
    getUserData: (filename, userId) => bucketOf(filename, userId),
    setUserData: (filename, userId, payload) => {
      bucketOf(filename, userId);
      store[filename][userId] = payload;
      return payload;
    },
    updateUserData: (filename, userId, updater) => {
      const bucket = bucketOf(filename, userId);
      const next = typeof updater === 'function' ? updater({ ...bucket }) : updater;
      store[filename][userId] = next;
      return next;
    }
  };
});

let handler;
let sessionCookie;
let userUtils;

beforeAll(() => {
  process.env.DATA_MODE = 'json';
  delete process.env.MONGODB_URI;
  process.env.SESSION_SECRET = TEST_SECRET;

  jest.resetModules();

  // require สด (ไม่ใช่ static import) เพื่อให้ lib/dataMode.config.js อ่าน DATA_MODE ที่ตั้งไว้ข้างบน
  // แทนค่าที่อาจถูก cache ไว้จากไฟล์เทสต์อื่นในโปรเซสเดียวกัน
  handler = require('../../pages/api/salary').default;
  sessionCookie = require('../../src/shared/utils/backend/sessionCookie');
  userUtils = require('../../src/backend/data/userUtils.js');
});

beforeEach(() => {
  userUtils.__reset();
});

function makeReqRes({ method = 'GET', userId = USER_A, query = {}, body } = {}) {
  const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
  const sid = createSessionId();
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  return createMocks({
    method,
    query,
    body,
    cookies: { [SESSION_COOKIE_NAME]: signSession(userId, sid) },
    headers: mutating ? { 'x-csrf-token': signCsrfToken(sid) } : {}
  });
}

const storedDoc = (month) => userUtils.__store[JSON_FILENAME]?.[USER_A]?.[month];

describe('/api/salary — overtime (JSON mode)', () => {
  it('runs in JSON mode', () => {
    // กันเคสที่ DATA_MODE ไม่ถูกหยิบไปใช้จริง แล้วเทสต์ทั้งไฟล์กลายเป็นการรัน Mongo path ซ้ำโดยไม่รู้ตัว
    expect(require('../../lib/dataSource').isJsonMode()).toBe(true);
  });

  SALARY_OT_PARITY_SCENARIOS.forEach((scenario) => {
    it(scenario.name, async () => {
      (scenario.seeds || []).forEach((seed) => {
        userUtils.updateUserData(JSON_FILENAME, USER_A, (bucket) => ({
          ...bucket,
          [seed.month]: { ...seed }
        }));
      });

      for (const body of scenario.posts || []) {
        const { req, res } = makeReqRes({ method: 'POST', body });
        await handler(req, res);
        expect(res._getStatusCode()).toBe(201);
      }

      if (scenario.getAll) {
        const { req, res } = makeReqRes({ query: {} });
        await handler(req, res);
        expect(res._getStatusCode()).toBe(200);
        const data = JSON.parse(res._getData());
        Object.entries(scenario.expectedAll).forEach(([month, expected]) => {
          expect(pickParityFields(data[month])).toEqual(expected);
        });
      } else {
        const { req, res } = makeReqRes({ query: { month: scenario.get } });
        await handler(req, res);
        expect(res._getStatusCode()).toBe(200);
        expect(pickParityFields(JSON.parse(res._getData()))).toEqual(scenario.expected);
      }

      // เทียบกับข้อมูลที่ถูกเขียนลง store จริง ไม่ใช่ response
      Object.entries(scenario.stored || {}).forEach(([month, expected]) => {
        const doc = storedDoc(month);
        Object.entries(expected).forEach(([field, value]) => {
          expect(doc[field]).toEqual(value);
        });
      });
    });
  });

  it('never persists overtimeLegacy, even when a client sends it (DATA_MODEL inv. 4, edge 25)', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: {
        month: '2026-09',
        income: { salary: 30000, overtime_1_5x: 3200 },
        deduct: {},
        overtime: [],
        overtimeLegacy: [{ id: 'legacy_overtime_1_5x', key: 'overtime_1_5x', label: 'x', amount: 999 }]
      }
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(201);

    const doc = storedDoc('2026-09');
    expect(doc.overtimeLegacy).toBeUndefined();
    expect(doc.summary.total_income).toBe(33200);
  });

  it('GET for a month with no document and no prior month returns the default structure with overtime: []', async () => {
    const { req, res } = makeReqRes({ query: { month: '2026-01' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.income).toEqual({ salary: 0, bonus: 0, other_income: 0 });
    expect(data.overtime).toEqual([]);
    expect(data.overtimeLegacy).toEqual([]);
    expect(data.summary).toEqual({ total_income: 0, total_deduct: 0, net_income: 0 });
  });
});
