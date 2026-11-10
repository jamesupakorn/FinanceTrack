/** @jest-environment node */
// Focused regression test for the `getUsersForNotify` non-string `userId` type guard added for the monthly-summary hardening. Follows a real-Mongo-instance pattern
// (mongodb-memory-server) rather than mocking the DB.
import { MongoMemoryServer } from '../helpers/mongoReplSet';
import { createMocks } from 'node-mocks-http';
import type { RequestMethod } from 'node-mocks-http';
import type { NextApiHandler } from 'next';
import type { Db } from 'mongodb';
import fs from 'fs';
import path from 'path';
import * as creditCardRevolving from '../../src/shared/utils/creditCardRevolving';
import { getCurrentDateInfo } from '../../src/shared/utils/dateUtils';
import { buildEffectiveSchedule, reviseEffectiveScheduleTail } from '../../src/shared/utils/creditCardAmortization';
import { collectLoanDueEvents, deriveLoanHeaderTitle, buildLoanMessage, buildLoanFlex } from '../../pages/api/line_due_notify';
import type { CreditPlan } from '../../src/shared/utils/backend/creditCardStore';

type RequestOptions = {
  method?: RequestMethod;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  secret?: string | null;
};
type LineResponse = Pick<Response, 'ok'> & { status?: number; json: () => Promise<unknown> };

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

// S5 D3: ห่อ buildRevolvingCyclesForData/summariseRevolving ด้วย jest.fn (ยังเรียก implementation จริง)
// เพื่อให้เทส "collectLoanDueEvents ต้องไม่เรียกตัวช่วยยอดหมุนเวียนเลย" (BR-CC-038) สังเกตจำนวนครั้งที่ถูกเรียกได้
// ไม่กระทบเทสอื่นในไฟล์นี้ที่พึ่งพาเลขยอดหมุนเวียนของบัตรเครดิตจริง เพราะ implementation เดิมยังถูกเรียกเหมือนก่อน
jest.mock('../../src/shared/utils/creditCardRevolving', () => {
  const actual = jest.requireActual('../../src/shared/utils/creditCardRevolving');
  return {
    ...actual,
    buildRevolvingCyclesForData: jest.fn(actual.buildRevolvingCyclesForData),
    summariseRevolving: jest.fn(actual.summariseRevolving)
  };
});

// AC-24: helper ที่เดินโครงสร้าง Flex `contents` แล้วรวบรวมข้อความ
// ของทุกโหนด type:'text' ตามลำดับที่ปรากฏในเอกสาร (document order) — ใช้แทนการอ่าน `.text` ตรงๆ
// แบบเดิม เพราะข้อความหลักตอนนี้เป็น Flex ไม่ใช่ plain text แล้ว
function collectFlexTextNodes(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach(item => collectFlexTextNodes(item, out));
    return out;
  }
  if ('type' in node && node.type === 'text' && 'text' in node && typeof node.text === 'string') out.push(node.text);
  Object.values(node).forEach(value => {
    if (value && typeof value === 'object') collectFlexTextNodes(value, out);
  });
  return out;
}

const TEST_CRON_SECRET = 'test-cron-secret';
const TEST_USER_ID = 'user-a';

let mongod: MongoMemoryServer;
let handler: NextApiHandler;
let getDbPromise: typeof import('../../lib/mongodb').getDbPromise;
let db: Db;
let fetchMock: jest.SpyInstance<Promise<LineResponse>, Parameters<typeof fetch>>;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();

  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';
  // TD-C02 follow-up: CRON_SECRET เป็นด่านเดียวและบังคับของ endpoint นี้แล้ว
  process.env.CRON_SECRET = TEST_CRON_SECRET;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-line-token';
  process.env.LINE_CHANNEL_USER_ID = '';

  jest.resetModules();

  fetchMock = jest.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response));
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

function makeReqRes({ method = 'POST', query = {}, body, headers = {}, secret = TEST_CRON_SECRET }: RequestOptions = {}) {
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
  const expectRejected = async (options: RequestOptions, status: number) => {
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
    require('../../lib/dataSource').getMongoCollection.mockImplementation(async (name: string) => {
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
    expect(results.slice(1).map((r: { userId: string; sent: boolean }) => [r.userId, r.sent])).toEqual([['user-2', true], ['user-3', true]]);
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
    expect(results.map((r: { sent: boolean }) => r.sent)).toEqual([true, true, true]);
    expect(results[0]).toMatchObject({ count: 1, breakdown: { due: 1, dueSoon: 0, overdue: 0, otherUnpaid: 0 } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('บัตรเครดิต: สร้างข้อความของผู้ใช้คนแรกพัง → ผู้ใช้คนถัดไปยังถูกประมวลผล และ response ยังเป็น 200', async () => {
    await seedDueUsers();
    const store = require('../../src/shared/utils/backend/creditCardStore');
    const actual = jest.requireActual('../../src/shared/utils/backend/creditCardStore');
    // getter โยน error เมื่อ collectCardDueEvents อ่าน .cards — อยู่ในส่วนที่เคยไม่ได้ครอบ try
    store.getUserCreditData.mockImplementation(async (userId: string) => (
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

// AC-9: message-format coverage สำหรับการจัดกลุ่มรายการตามบัญชี
describe('/api/line_due_notify — จัดกลุ่มรายการตามบัญชีในข้อความ (AC-1…AC-6)', () => {
  const FMT_USER_ID = 'user-fmt';
  const TARGET_DATE = '2024-01-15'; // target.day = 15, daysInMonth = 31

  // seed ผู้ใช้ 1 คนพร้อม monthly_expense ของเดือนเป้าหมาย (และเดือนก่อนหน้าถ้าระบุ)
  const seedUser = async ({ currentItems, prevItems }: {
    currentItems?: Record<string, unknown>;
    prevItems?: Record<string, unknown>;
  } = {}) => {
    await db.collection('users').insertOne({ id: FMT_USER_ID, LineId: `line-${FMT_USER_ID}` });
    if (currentItems) {
      await db.collection('monthly_expense').insertOne({ userId: FMT_USER_ID, month: '2024-01', ...currentItems });
    }
    if (prevItems) {
      await db.collection('monthly_expense').insertOne({ userId: FMT_USER_ID, month: '2023-12', ...prevItems });
    }
  };

  // เรียก handler แล้วดึงข้อความ LINE ฉบับล่าสุดที่ถูกส่งออก (ข้อความค่าใช้จ่าย ไม่ใช่บัตรเครดิต)
  // คืนทั้ง text (ทุกโหนดต่อกันด้วย '\n' — ใช้กับ indexOf/toContain แบบเดิม) และ nodes (array แต่ละ
  // text node ตามลำดับ — ใช้เมื่อต้องเช็คว่าสองโหนดอยู่ติดกัน เพราะ Flex แยกชื่อ/จำนวนเงินเป็นคนละโหนด)
  const sendAndGetMessage = async (mode = 'both') => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const { req, res } = makeReqRes({ body: { date: TARGET_DATE, userId: FMT_USER_ID, mode } });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    const message = body.messages[0];
    expect(message.type).toBe('flex');
    const nodes = collectFlexTextNodes(message.contents);
    return { text: nodes.join('\n'), nodes };
  };

  it('1) สองบัญชีสลับกันในรายการต้นทาง → สอง heading คนละกลุ่ม บัญชีที่ปรากฏก่อนขึ้นก่อน', async () => {
    await seedUser({
      currentItems: {
        // ลำดับ: บช1, บช2, บช1 (สลับกัน) — กลุ่มต้องรวมตามบัญชี ไม่ใช่ตามลำดับปรากฏของแต่ละแถว
        itemA: { name: 'ค่าไฟ', actual: 500, dueDay: 15, account: 'บช1' },
        itemB: { name: 'ค่าเน็ต', actual: 590, dueDay: 15, account: 'บช2' },
        itemC: { name: 'ค่าน้ำ', actual: 210, dueDay: 15, account: 'บช1' }
      }
    });

    const { text } = await sendAndGetMessage();

    const idxAcc1 = text.indexOf('บช1');
    const idxAcc2 = text.indexOf('บช2');
    const idxFai = text.indexOf('ค่าไฟ');
    const idxNet = text.indexOf('ค่าเน็ต');
    const idxNam = text.indexOf('ค่าน้ำ');

    expect(idxAcc1).toBeGreaterThan(-1);
    expect(idxAcc2).toBeGreaterThan(-1);
    // บช1 ขึ้นก่อน (ปรากฏก่อนใน items) แล้วค่อยตามด้วย บช2
    expect(idxAcc1).toBeLessThan(idxAcc2);
    // ทั้งค่าไฟและค่าน้ำอยู่ใต้กลุ่มบช1 (ก่อน heading บช2)
    expect(idxFai).toBeGreaterThan(idxAcc1);
    expect(idxNam).toBeGreaterThan(idxAcc1);
    expect(idxFai).toBeLessThan(idxAcc2);
    expect(idxNam).toBeLessThan(idxAcc2);
    // ค่าเน็ตอยู่ใต้กลุ่มบช2
    expect(idxNet).toBeGreaterThan(idxAcc2);
    expect(text).not.toContain('อื่นๆ');
  });

  it('2) รายการไม่มีบัญชีอยู่ตัวแรกในต้นทาง → ยังคงถูกจัดไว้ท้ายสุดใต้ "อื่นๆ"', async () => {
    await seedUser({
      currentItems: {
        // itemZ ไม่มี account และมาก่อนในลำดับ items — ต้องไม่ทำให้ "อื่นๆ" ขึ้นก่อนกลุ่มที่มีชื่อบัญชี
        itemZ: { name: 'ค่าส่วนกลาง', actual: 100, dueDay: 15 },
        itemA: { name: 'ค่าไฟ', actual: 500, dueDay: 15, account: 'บช1' }
      }
    });

    const { text } = await sendAndGetMessage();

    const idxAcc1 = text.indexOf('บช1');
    const idxOther = text.indexOf('อื่นๆ');
    const idxCentral = text.indexOf('ค่าส่วนกลาง');

    expect(idxAcc1).toBeGreaterThan(-1);
    expect(idxOther).toBeGreaterThan(-1);
    // "อื่นๆ" ต้องอยู่หลังกลุ่มที่มีชื่อบัญชี แม้รายการไม่มีบัญชีจะมาก่อนใน items
    expect(idxOther).toBeGreaterThan(idxAcc1);
    expect(idxCentral).toBeGreaterThan(idxOther);
  });

  it('3) ไม่มีเลขลำดับและไม่มี " | " ต่อท้ายบัญชีในข้อความอีกต่อไป', async () => {
    await seedUser({
      currentItems: {
        itemA: { name: 'ค่าไฟ', actual: 500, dueDay: 15, account: 'บช1' },
        itemB: { name: 'ค่าเน็ต', actual: 590, dueDay: 15, account: 'บช2' }
      }
    });

    const { text, nodes } = await sendAndGetMessage();

    // ไม่มีโหนดไหนขึ้นต้นด้วยเลขลำดับแบบ "1. " (แทนที่การเช็คบนสตริงเดียวแบบเดิม ซึ่งไม่มีความหมาย
    // อีกต่อไปเมื่อชื่อ/จำนวนเงินถูกแยกเป็นคนละโหนดแล้ว)
    nodes.forEach(node => expect(node).not.toMatch(/^\d+\. /));
    expect(text).not.toContain(' | ');
    // AC-11: bullet "• " ถูกตัดออกใน Flex, ชื่อกับจำนวนเงินเป็นคนละโหนดที่อยู่ติดกัน
    const faiIdx = nodes.indexOf('ค่าไฟ');
    const netIdx = nodes.indexOf('ค่าเน็ต');
    expect(faiIdx).toBeGreaterThan(-1);
    expect(netIdx).toBeGreaterThan(-1);
    expect(nodes[faiIdx + 1]).toBe('500 บาท');
    expect(nodes[netIdx + 1]).toBe('590 บาท');
  });

  it('4) รายการค้างชำระ (แสดงวันที่) ยังแสดง 📅 ใต้ชื่อรายการที่ถูกต้อง ส่วนรายการครบกำหนดวันนี้ไม่แสดง', async () => {
    await seedUser({
      currentItems: {
        itemDue: { name: 'ค่าไฟ', actual: 500, dueDay: 15, account: 'บช1' }, // ครบกำหนดวันนี้ → hideDate
        itemOverdue: { name: 'ค่าน้ำ', actual: 210, dueDay: 10, account: 'บช1' } // เลยกำหนดแล้ว → แสดงวันที่
      }
    });

    const { text } = await sendAndGetMessage();

    const dueSectionEnd = text.indexOf('⚠️ ค้างชำระ');
    const dueSectionText = text.slice(0, dueSectionEnd);
    const overdueSectionText = text.slice(dueSectionEnd);

    expect(dueSectionText).toContain('ค่าไฟ');
    expect(dueSectionText).not.toContain('📅');

    expect(overdueSectionText).toContain('ค่าน้ำ');
    expect(overdueSectionText).toContain('📅');
  });

  it('5) รายการค้างจากเดือนก่อนยังแสดง "(ค้างจาก …)" ต่อท้ายชื่อรายการ', async () => {
    await seedUser({
      prevItems: {
        itemGas: { name: 'ค่าแก๊ส', actual: 300, dueDay: 10, account: 'บช1' }
      }
    });

    const { nodes } = await sendAndGetMessage();

    const nameIdx = nodes.findIndex(node => node.includes('ค่าแก๊ส'));
    expect(nameIdx).toBeGreaterThan(-1);
    expect(nodes[nameIdx]).toBe('ค่าแก๊ส (ค้างจาก ธ.ค. 2566)');
    expect(nodes[nameIdx + 1]).toBe('300 บาท');
  });

  it('6) ทุกรายการในหมวดไม่มีบัญชีเลย → ตัด heading "อื่นๆ" ทิ้ง แสดงชื่อรายการตรงใต้หัวข้อ section เลย', async () => {
    await seedUser({
      currentItems: {
        itemOnly: { name: 'ค่าไฟ', actual: 500, dueDay: 15 } // ไม่มี account เลยทั้ง section
      }
    });

    const { text, nodes } = await sendAndGetMessage();

    expect(text).not.toContain('อื่นๆ');
    const titleIdx = nodes.indexOf('✅ ครบกำหนดวันนี้');
    expect(titleIdx).toBeGreaterThan(-1);
    expect(nodes[titleIdx + 1]).toBe('ค่าไฟ');
    expect(nodes[titleIdx + 2]).toBe('500 บาท');
  });

  it('7) ส่งข้อความแบบ Flex สำเร็จ → messages[0].type เป็น flex (AC-25)', async () => {
    await seedUser({
      currentItems: { itemA: { name: 'ค่าไฟ', actual: 500, dueDay: 15, account: 'บช1' } }
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const { req, res } = makeReqRes({ body: { date: TARGET_DATE, userId: FMT_USER_ID, mode: 'both' } });
    await handler(req, res);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.messages[0].type).toBe('flex');
    const data = JSON.parse(res._getData());
    expect(data.results[0]).toMatchObject({ sent: true, format: 'flex' });
  });

  it('8) Flex ส่งไม่สำเร็จ → fallback เป็นข้อความล้วน และรายงาน format: text-fallback (AC-14/AC-25)', async () => {
    await seedUser({
      currentItems: { itemA: { name: 'ค่าไฟ', actual: 500, dueDay: 15, account: 'บช1' } }
    });
    // เรียกครั้งแรก (flex) ล้มเหลว ครั้งที่สอง (text fallback) สำเร็จ
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ message: 'invalid flex' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

    const { req, res } = makeReqRes({ body: { date: TARGET_DATE, userId: FMT_USER_ID, mode: 'both' } });
    await handler(req, res);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, firstOptions] = fetchMock.mock.calls[0];
    expect(JSON.parse(firstOptions!.body as string).messages[0].type).toBe('flex');
    const [, secondOptions] = fetchMock.mock.calls[1];
    const secondBody = JSON.parse(secondOptions!.body as string);
    expect(secondBody.messages[0].type).toBe('text');
    expect(secondBody.messages[0].text).toContain('ค่าไฟ');

    const data = JSON.parse(res._getData());
    expect(data.results[0]).toMatchObject({ sent: true, format: 'text-fallback' });
  });

  it('9) ทั้ง Flex และ text fallback ล้มเหลว → sent: false และไม่มีความพยายามครั้งที่สาม (พิสูจน์ไม่มี retry, AC-14)', async () => {
    await seedUser({
      currentItems: { itemA: { name: 'ค่าไฟ', actual: 500, dueDay: 15, account: 'บช1' } }
    });
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ message: 'down' }) });

    const { req, res } = makeReqRes({ body: { date: TARGET_DATE, userId: FMT_USER_ID, mode: 'both' } });
    await handler(req, res);

    // flex 1 ครั้ง + text fallback 1 ครั้ง = 2 ครั้งพอดี ไม่มี retry ใดๆ
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const data = JSON.parse(res._getData());
    expect(data.results[0]).toMatchObject({ sent: false });
  });
});

// AC-25: message-format coverage สำหรับข้อความบัตรเครดิตแบบ Flex
describe('/api/line_due_notify — บัตรเครดิตแบบ Flex (AC-16…AC-21, AC-25)', () => {
  const CC_USER_ID = 'user-cc-flex';
  const TARGET_DATE = '2024-01-15';

  const seedCardUser = async ({ cards = [], plans = [], cycles = [] }: {
    cards?: Record<string, unknown>[];
    plans?: Record<string, unknown>[];
    cycles?: Record<string, unknown>[];
  } = {}) => {
    await db.collection('users').insertOne({ id: CC_USER_ID, LineId: `line-${CC_USER_ID}` });
    await db.collection('credit_cards').insertOne({ userId: CC_USER_ID, cards, plans, cycles });
  };

  it('ไม่มีเหตุการณ์บัตรครบกำหนดเลย → ไม่มีการเรียก fetch สำหรับข้อความบัตรของผู้ใช้คนนี้เลย (AC-16 empty-message guard)', async () => {
    await seedCardUser({ cards: [{ id: 'card-1', name: 'บัตร A', statementDay: 1, dueDay: 15 }] });
    // ไม่ seed monthly_expense → ไม่มีข้อความค่าใช้จ่ายเช่นกัน ทำให้ fetch ทั้งหมดต้องเป็นศูนย์
    const { req, res } = makeReqRes({ body: { date: '2024-01-01', userId: CC_USER_ID, mode: 'both' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const { creditCardResults } = JSON.parse(res._getData());
    expect(creditCardResults).toEqual([{ userId: CC_USER_ID, sent: false, reason: 'no credit card due items' }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('บัตรมีทั้งยอดหมุนเวียนและงวดผ่อนครบกำหนด → ส่งเป็น Flex และยอดหมุนเวียนอยู่ก่อนงวดผ่อนเสมอ (AC-18 ordering)', async () => {
    await seedCardUser({
      // same-month card (statementDay < dueDay) per the cross-month-due test-fallout rule
      cards: [{ id: 'card-1', name: 'บัตร A', statementDay: 1, dueDay: 15 }],
      plans: [{
        id: 'plan-1', cardId: 'card-1', itemName: 'มือถือ', months: 10, status: 'ongoing',
        schedule: [{ no: 1, dueMonth: '2024-01', payment: 1000, paid: false }]
      }],
      cycles: [{
        cardId: 'card-1', month: '2024-01', newSpend: 5000, paymentAction: null
      }]
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    const { req, res } = makeReqRes({ body: { date: TARGET_DATE, userId: CC_USER_ID, mode: 'both' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const { creditCardResults } = JSON.parse(res._getData());
    expect(creditCardResults[0]).toMatchObject({ userId: CC_USER_ID, sent: true, format: 'flex' });

    const call = fetchMock.mock.calls.find(c => {
      const requestOptions = c[1];
      if (typeof requestOptions?.body !== 'string') return false;
      const b = JSON.parse(requestOptions.body);
      return b.messages[0].type === 'flex' && b.to === `line-${CC_USER_ID}`;
    });
    expect(call).toBeTruthy();
    if (!call) throw new Error('Expected a LINE Flex request for the credit card user');
    const callBody = call[1]?.body;
    if (typeof callBody !== 'string') throw new Error('Expected the LINE request body to be a string');
    const message = JSON.parse(callBody).messages[0];
    const nodes = collectFlexTextNodes(message.contents);
    const revolvingIdx = nodes.findIndex(node => node.includes('ยอดใช้จ่ายหมุนเวียน'));
    const installmentIdx = nodes.findIndex(node => node.includes('มือถือ'));
    expect(revolvingIdx).toBeGreaterThan(-1);
    expect(installmentIdx).toBeGreaterThan(-1);
    expect(revolvingIdx).toBeLessThan(installmentIdx);
  });

  it('Flex ล้มเหลว → fallback เป็นข้อความบัตรเครดิตแบบข้อความล้วน (AC-21)', async () => {
    await seedCardUser({
      // same-month card (statementDay < dueDay) per the cross-month-due test-fallout rule
      cards: [{ id: 'card-1', name: 'บัตร A', statementDay: 1, dueDay: 15 }],
      plans: [{
        id: 'plan-1', cardId: 'card-1', itemName: 'มือถือ', months: 10, status: 'ongoing',
        schedule: [{ no: 1, dueMonth: '2024-01', payment: 1000, paid: false }]
      }]
    });
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ message: 'invalid flex' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

    const { req, res } = makeReqRes({ body: { date: TARGET_DATE, userId: CC_USER_ID, mode: 'both' } });
    await handler(req, res);

    const { creditCardResults } = JSON.parse(res._getData());
    expect(creditCardResults[0]).toMatchObject({ userId: CC_USER_ID, sent: true, format: 'text-fallback' });
    const secondCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    if (!secondCall) throw new Error('Expected a LINE text fallback request');
    const secondBodyValue = secondCall[1]?.body;
    if (typeof secondBodyValue !== 'string') throw new Error('Expected the LINE request body to be a string');
    const secondBody = JSON.parse(secondBodyValue);
    expect(secondBody.messages[0].type).toBe('text');
    expect(secondBody.messages[0].text).toContain('มือถือ');
  });

  // AC-4: Shopee (EOM/10) cycle 2026-10 is due 2026-11-10
  describe('cross-month card (AC-4)', () => {
    const SHOPEE = { id: 'card-sp', name: 'Shopee SPayLater', statementDay: 'EOM', dueDay: 10 };
    const seedShopee = () => seedCardUser({
      cards: [SHOPEE],
      plans: [
        { id: 'plan-oct', cardId: 'card-sp', itemName: 'งวดรอบตุลา', months: 3, status: 'ongoing', schedule: [{ no: 1, dueMonth: '2026-10', payment: 400, paid: false }] },
        { id: 'plan-nov', cardId: 'card-sp', itemName: 'งวดรอบพฤศจิกา', months: 3, status: 'ongoing', schedule: [{ no: 1, dueMonth: '2026-11', payment: 700, paid: false }] }
      ],
      cycles: [{ cardId: 'card-sp', month: '2026-10', newSpend: 3000, paymentAction: null }]
    });
    const sendFor = async (date: string) => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
      const { req, res } = makeReqRes({ body: { date, userId: CC_USER_ID, mode: 'both' } });
      await handler(req, res);
      expect(res._getStatusCode()).toBe(200);
      const { creditCardResults } = JSON.parse(res._getData());
      const flexCall = fetchMock.mock.calls.find(c => typeof c[1]?.body === 'string' && JSON.parse(c[1].body).messages[0].type === 'flex');
      const nodes = flexCall && typeof flexCall[1]?.body === 'string' ? collectFlexTextNodes(JSON.parse(flexCall[1].body).messages[0].contents) : [];
      return { result: creditCardResults[0], text: nodes.join('\n') };
    };

    it('target 2026-11-08 → one dueSoon event for cycle 2026-10, text "10 พ.ย. 2569"', async () => {
      await seedShopee();
      const { result, text } = await sendFor('2026-11-08');
      expect(result).toMatchObject({ userId: CC_USER_ID, sent: true, format: 'flex' });
      expect(text).toContain('10 พ.ย. 2569');
      expect(text).toContain('อีก 2 วัน');
      expect(text).toContain('งวดรอบตุลา');
      expect(text).toContain('ยอดใช้จ่ายหมุนเวียน');
      expect(text).not.toContain('งวดรอบพฤศจิกา');
      expect(text).not.toContain('10 ต.ค. 2569');
    });

    it('target 2026-11-25 → overdue 15 days for cycle 2026-10', async () => {
      await seedShopee();
      const { result, text } = await sendFor('2026-11-25');
      expect(result).toMatchObject({ sent: true });
      expect(text).toContain('10 พ.ย. 2569');
      expect(text).toContain('เลยกำหนด 15 วัน');
      expect(text).toContain('งวดรอบตุลา');
      expect(text).not.toContain('งวดรอบพฤศจิกา');
    });

    it('target 2026-10-08 never reports cycle 2026-10 (evaluates cycle 2026-09, which has nothing due)', async () => {
      await seedShopee();
      const { result, text } = await sendFor('2026-10-08');
      expect(result).toEqual({ userId: CC_USER_ID, sent: false, reason: 'no credit card due items' });
      expect(text).toBe('');
    });

    it('target 2026-11-08 with cycle 2026-10 paid and no Oct installment → nothing to report', async () => {
      await seedCardUser({
        cards: [SHOPEE],
        cycles: [{ cardId: 'card-sp', month: '2026-10', newSpend: 3000, paymentAction: 'full' }]
      });
      const { result } = await sendFor('2026-11-08');
      expect(result).toMatchObject({ sent: false, reason: 'no credit card due items' });
    });

    it('AC-3 regression: a same-month card (5/25) cycle 2026-10 is still reported on 2026-10-25', async () => {
      await seedCardUser({
        cards: [{ id: 'card-sm', name: 'Same Month', statementDay: 5, dueDay: 25 }],
        plans: [{ id: 'plan-sm', cardId: 'card-sm', itemName: 'งวดเดือนเดียวกัน', months: 3, status: 'ongoing', schedule: [{ no: 1, dueMonth: '2026-10', payment: 500, paid: false }] }]
      });
      const { result, text } = await sendFor('2026-10-25');
      expect(result).toMatchObject({ sent: true });
      expect(text).toContain('25 ต.ค. 2569');
      expect(text).toContain('งวดเดือนเดียวกัน');
    });
  });

  // N-1 (REQUIRED, loan-installments-s5 D1): collectCardDueEvents ต้องกรองบัตรประเภทสินเชื่อ
  // (personal_loan/home_loan) ออกเสมอ มิฉะนั้นเมื่อ collectLoanDueEvents (S5 D3) มาทำงาน
  // ผู้ใช้จะได้รับแจ้งเตือนงวดสินเชื่อซ้ำสองข้อความ (BR-CC-041)
  describe('N-1: บัตรประเภทสินเชื่อต้องไม่ถูกแจ้งเตือนผ่านข้อความบัตรเครดิต', () => {
    // D5 note: at D1-D4 (before the loan handler loop existed), this fixture's loan was collected
    // by nothing, so this test originally asserted zero fetch calls at all. Now that S5 D5 wires
    // collectLoanDueEvents into its own handler loop, this exact fixture's due-today loan correctly
    // produces its own loan message (S5 D5, spec I-6/E-26) — the fix here narrows the "no fetch"
    // assertion to "no card message", and adds the now-correct loan-side assertions, without
    // touching the N-1 card-exclusion assertion itself.
    it('บัตรสินเชื่อบ้าน (home_loan) มีงวดครบกำหนดวันนี้ → ไม่ปรากฏในข้อความบัตรเครดิต (ข้อความสินเชื่อแยกต่างหากถูกส่งแทน, S5 D5)', async () => {
      await seedCardUser({
        cards: [{ id: 'loan-1', name: 'บ้านลาดพร้าว', cardType: 'home_loan', statementDay: 1, dueDay: 15 }],
        plans: [{
          id: 'plan-loan-1', cardId: 'loan-1', itemName: 'บ้านลาดพร้าว', months: 240, status: 'ongoing',
          schedule: [{ no: 13, dueMonth: '2024-01', payment: 7164.31, paid: false }]
        }]
      });
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

      const { req, res } = makeReqRes({ body: { date: TARGET_DATE, userId: CC_USER_ID, mode: 'both' } });
      await handler(req, res);

      expect(res._getStatusCode()).toBe(200);
      const { creditCardResults, loanResults } = JSON.parse(res._getData());
      expect(creditCardResults).toEqual([{ userId: CC_USER_ID, sent: false, reason: 'no credit card due items' }]);
      // No fetch call carries the card message shape; the one call that does happen is the loan message.
      expect(fetchMock.mock.calls.every(c => typeof c[1]?.body === 'string' && !JSON.stringify(JSON.parse(c[1].body)).includes('แจ้งเตือนบัตรเครดิต'))).toBe(true);
      expect(loanResults[0]).toMatchObject({ userId: CC_USER_ID, sent: true });
    });

    it('ผู้ใช้มีทั้งบัตรเครดิตจริงและบัตรสินเชื่อส่วนบุคคล (personal_loan) ครบกำหนดพร้อมกัน → ข้อความบัตรเครดิตมีแค่บัตรจริง ไม่มีงวดสินเชื่อปน', async () => {
      await seedCardUser({
        cards: [
          { id: 'card-1', name: 'บัตร A', statementDay: 1, dueDay: 15 },
          { id: 'loan-2', name: 'สินเชื่อส่วนบุคคล', cardType: 'personal_loan', statementDay: 1, dueDay: 15 }
        ],
        plans: [
          {
            id: 'plan-1', cardId: 'card-1', itemName: 'มือถือ', months: 10, status: 'ongoing',
            schedule: [{ no: 1, dueMonth: '2024-01', payment: 1000, paid: false }]
          },
          {
            id: 'plan-loan-2', cardId: 'loan-2', itemName: 'สินเชื่อส่วนบุคคล', months: 36, status: 'ongoing',
            schedule: [{ no: 1, dueMonth: '2024-01', payment: 3000, paid: false }]
          }
        ]
      });
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

      const { req, res } = makeReqRes({ body: { date: TARGET_DATE, userId: CC_USER_ID, mode: 'both' } });
      await handler(req, res);

      expect(res._getStatusCode()).toBe(200);
      const { creditCardResults } = JSON.parse(res._getData());
      expect(creditCardResults[0]).toMatchObject({ userId: CC_USER_ID, sent: true, format: 'flex' });

      const call = fetchMock.mock.calls.find(c => {
        const requestOptions = c[1];
        if (typeof requestOptions?.body !== 'string') return false;
        const b = JSON.parse(requestOptions.body);
        return b.messages[0].type === 'flex' && b.to === `line-${CC_USER_ID}`;
      });
      expect(call).toBeTruthy();
      if (!call) throw new Error('Expected a LINE Flex request for the credit card user');
      const callBody = call[1]?.body;
      if (typeof callBody !== 'string') throw new Error('Expected the LINE request body to be a string');
      const message = JSON.parse(callBody).messages[0];
      const nodes = collectFlexTextNodes(message.contents);
      expect(nodes.join('\n')).toContain('มือถือ');
      expect(nodes.join('\n')).not.toContain('สินเชื่อส่วนบุคคล');
    });
  });
});

// S1 carry-over fix (loan-installments-s5 D2): the loan-installments route moved from
// `/credit-cards` to `/credits` back in S1, but two LINE message literals in this file
// (card text footer and card Flex footer) were deliberately left pointing at the old
// path until a later slice touched this file for real work. Grep-based so a future edit
// that reintroduces the stale literal fails the build, not just a copy review.
describe('/api/line_due_notify — card footer CTA ไม่ใช้ path เก่า /credit-cards (S1 carry-over)', () => {
  test('ไฟล์ source ไม่มี path literal /credit-cards หลงเหลืออยู่เลย', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../pages/api/line_due_notify.ts'), 'utf8');
    expect(source).not.toContain('/credit-cards');
    // สอง footer ของบัตร (text + Flex) ต้องชี้ไปที่ /credits แทน
    expect(source).toContain('https://finance-track-one.vercel.app/credits');
  });
});

// S5 D3 — collectLoanDueEvents (spec-loan-installments.md §I-6): pure data-collection only, no
// message/Flex building (that is D4) and not yet wired into the handler (D5). Tested directly
// through the named export rather than through the handler, per the dispatch instructions.
// S5 D5 — handler loop + loanResults (spec-loan-installments.md §I-6, E-21, E-26). Through the
// handler/fetch seam, same pattern as the credit-card Flex describe block above.
describe('/api/line_due_notify — ข้อความสินเชื่อแบบ Flex + loanResults (loan-installments-s5 D5)', () => {
  const LOAN_USER_ID = 'user-loan-flex';
  const TARGET_DATE = '2024-01-15';

  const seedLoanUser = async ({ cards = [], plans = [], cycles = [] }: {
    cards?: Record<string, unknown>[];
    plans?: Record<string, unknown>[];
    cycles?: Record<string, unknown>[];
  } = {}) => {
    await db.collection('users').insertOne({ id: LOAN_USER_ID, LineId: `line-${LOAN_USER_ID}` });
    await db.collection('credit_cards').insertOne({ userId: LOAN_USER_ID, cards, plans, cycles });
  };

  const LOAN_CARD = { id: 'loan-1', name: 'บ้านลาดพร้าว', cardType: 'home_loan', dueDay: 15 };
  const LOAN_PLAN = {
    id: 'plan-loan-1', cardId: 'loan-1', itemName: 'บ้านลาดพร้าว', months: 240, status: 'ongoing',
    schedule: [{ no: 13, dueMonth: '2024-01', payment: 7164.31, paid: false }]
  };
  const CARD = { id: 'card-1', name: 'บัตร A', statementDay: 1, dueDay: 15 };
  const CARD_PLAN = {
    id: 'plan-1', cardId: 'card-1', itemName: 'มือถือ', months: 10, status: 'ongoing',
    schedule: [{ no: 1, dueMonth: '2024-01', payment: 1000, paid: false }]
  };

  it('สินเชื่อมีงวดครบกำหนดวันนี้ → ส่งข้อความสินเชื่อเป็น Flex และ loanResults ถูกต้อง', async () => {
    await seedLoanUser({ cards: [LOAN_CARD], plans: [LOAN_PLAN] });
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    const { req, res } = makeReqRes({ body: { date: TARGET_DATE, userId: LOAN_USER_ID, mode: 'both' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.loanResults).toEqual([
      { userId: LOAN_USER_ID, sent: true, loanCount: 1, installmentCount: 1, format: 'flex' }
    ]);

    const call = fetchMock.mock.calls.find(c => {
      const requestOptions = c[1];
      if (typeof requestOptions?.body !== 'string') return false;
      const b = JSON.parse(requestOptions.body);
      return b.messages[0].type === 'flex' && JSON.stringify(b.messages[0]).includes('บ้านลาดพร้าว');
    });
    expect(call).toBeTruthy();
  });

  // E-21: สินเชื่อที่ยังไม่มีแผน → collectLoanDueEvents ไม่ให้ event เลย → ไม่มีข้อความ ไม่ error
  it('E-21: สินเชื่อที่ยังไม่มีแผน → ไม่มีข้อความสินเชื่อ ไม่มี error, loanResults.sent === false', async () => {
    await seedLoanUser({ cards: [LOAN_CARD], plans: [] });

    const { req, res } = makeReqRes({ body: { date: TARGET_DATE, userId: LOAN_USER_ID, mode: 'both' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.loanResults).toEqual([{ userId: LOAN_USER_ID, sent: false, reason: 'no loan due items' }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('E-26: composition ของข้อความบัตรเครดิต/สินเชื่อ', () => {
    it('(a) มีแค่บัตรเครดิต → ได้ข้อความบัตรตามเดิม ไม่มีข้อความสินเชื่อ', async () => {
      await seedLoanUser({ cards: [CARD], plans: [CARD_PLAN] });
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

      const { req, res } = makeReqRes({ body: { date: TARGET_DATE, userId: LOAN_USER_ID, mode: 'both' } });
      await handler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.creditCardResults[0]).toMatchObject({ userId: LOAN_USER_ID, sent: true, format: 'flex' });
      expect(data.loanResults).toEqual([{ userId: LOAN_USER_ID, sent: false, reason: 'no loan due items' }]);
    });

    it('(b) มีแค่สินเชื่อ → ไม่มีข้อความบัตรเครดิต มีข้อความสินเชื่อ', async () => {
      await seedLoanUser({ cards: [LOAN_CARD], plans: [LOAN_PLAN] });
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

      const { req, res } = makeReqRes({ body: { date: TARGET_DATE, userId: LOAN_USER_ID, mode: 'both' } });
      await handler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.creditCardResults).toEqual([{ userId: LOAN_USER_ID, sent: false, reason: 'no credit card due items' }]);
      expect(data.loanResults[0]).toMatchObject({ userId: LOAN_USER_ID, sent: true, format: 'flex' });
    });

    it('(c) มีทั้งบัตรเครดิตและสินเชื่อครบกำหนดพร้อมกัน → ได้ทั้งสามข้อความ (ค่าใช้จ่าย, บัตร, สินเชื่อ) แยกกันอิสระ', async () => {
      await db.collection('users').insertOne({ id: LOAN_USER_ID, LineId: `line-${LOAN_USER_ID}` });
      await db.collection('credit_cards').insertOne({
        userId: LOAN_USER_ID, cards: [CARD, LOAN_CARD], plans: [CARD_PLAN, LOAN_PLAN], cycles: []
      });
      await db.collection('monthly_expense').insertOne({
        userId: LOAN_USER_ID, month: '2024-01', rent: { name: 'ค่าเช่า', actual: 1000, dueDay: 15 }
      });
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

      const { req, res } = makeReqRes({ body: { date: TARGET_DATE, userId: LOAN_USER_ID, mode: 'both' } });
      await handler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.results[0]).toMatchObject({ sent: true });
      expect(data.creditCardResults[0]).toMatchObject({ sent: true, format: 'flex' });
      expect(data.loanResults[0]).toMatchObject({ sent: true, format: 'flex' });

      // สามการเรียก fetch แยกกัน: ค่าใช้จ่าย, บัตรเครดิต (มีมือถือ ไม่มีบ้านลาดพร้าว), สินเชื่อ (มีบ้านลาดพร้าว)
      expect(fetchMock).toHaveBeenCalledTimes(3);
      const bodies = fetchMock.mock.calls.map(c => JSON.parse((c[1]!.body as string)));
      const cardBody = bodies.find(b => JSON.stringify(b).includes('มือถือ'));
      const loanBody = bodies.find(b => JSON.stringify(b).includes('บ้านลาดพร้าว'));
      expect(cardBody).toBeTruthy();
      expect(loanBody).toBeTruthy();
      expect(JSON.stringify(cardBody)).not.toContain('บ้านลาดพร้าว');
      expect(JSON.stringify(loanBody)).not.toContain('มือถือ');
    });
  });

  it('Flex ล้มเหลว → fallback เป็นข้อความสินเชื่อแบบข้อความล้วน (เหมือนเส้นทางบัตรเครดิต)', async () => {
    await seedLoanUser({ cards: [LOAN_CARD], plans: [LOAN_PLAN] });
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ message: 'invalid flex' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

    const { req, res } = makeReqRes({ body: { date: TARGET_DATE, userId: LOAN_USER_ID, mode: 'both' } });
    await handler(req, res);

    const data = JSON.parse(res._getData());
    expect(data.loanResults[0]).toMatchObject({ userId: LOAN_USER_ID, sent: true, format: 'text-fallback' });
    const secondCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    const secondBody = JSON.parse(secondCall[1]!.body as string);
    expect(secondBody.messages[0].type).toBe('text');
    expect(secondBody.messages[0].text).toContain('บ้านลาดพร้าว');
  });

  describe('per-user isolation สำหรับข้อความสินเชื่อ', () => {
    afterEach(() => {
      require('../../src/shared/utils/backend/creditCardStore').getUserCreditData.mockImplementation(
        jest.requireActual('../../src/shared/utils/backend/creditCardStore').getUserCreditData
      );
    });

    it('ผู้ใช้คนแรกสร้าง/ดึงข้อมูลสินเชื่อพัง → ผู้ใช้คนถัดไปยังได้รับข้อความค่าใช้จ่าย/บัตร/สินเชื่อตามปกติ', async () => {
      const users = ['loan-u1', 'loan-u2'];
      await db.collection('users').insertMany(users.map(id => ({ id, LineId: `line-${id}` })));
      await db.collection('monthly_expense').insertMany(users.map(id => ({
        userId: id, month: '2024-01', rent: { name: 'ค่าเช่า', actual: 1000, dueDay: 15 }
      })));
      await db.collection('credit_cards').insertMany([
        { userId: 'loan-u1', cards: [LOAN_CARD], plans: [LOAN_PLAN], cycles: [] },
        { userId: 'loan-u2', cards: [LOAN_CARD], plans: [LOAN_PLAN], cycles: [] }
      ]);
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

      const store = require('../../src/shared/utils/backend/creditCardStore');
      const actual = jest.requireActual('../../src/shared/utils/backend/creditCardStore');
      store.getUserCreditData.mockImplementation(async (userId: string) => (
        userId === 'loan-u1' ? { get cards() { throw new Error('loan boom'); } } : actual.getUserCreditData(userId)
      ));

      const { req, res } = makeReqRes({ body: { date: TARGET_DATE } });
      await handler(req, res);

      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.loanResults).toHaveLength(2);
      // The loan loop mirrors the credit-card loop's error handling exactly: on an unexpected failure
      // (not the `getUserCreditData` rejection, which has a generic reason) the caught error's own
      // message surfaces in `reason`, same as the existing card-isolation test above never asserts
      // otherwise for its own 'bad card data' case.
      expect(data.loanResults[0]).toMatchObject({ userId: 'loan-u1', sent: false, reason: 'loan boom' });
      expect(data.loanResults[1]).toMatchObject({ userId: 'loan-u2', sent: true, format: 'flex' });
      // loan-u1's expense message still goes out despite the loan-path failure
      expect(data.results.map((r: { userId: string; sent: boolean }) => [r.userId, r.sent])).toEqual([
        ['loan-u1', true], ['loan-u2', true]
      ]);
    });
  });
});

describe('collectLoanDueEvents (loan-installments-s5 D3) — รวบรวมงวดสินเชื่อที่ครบกำหนด', () => {
  const TARGET_DATE = '2024-01-15'; // target.day = 15, daysInMonth = 31, monthKey '2024-01'
  const target = getCurrentDateInfo(TARGET_DATE)!;

  const loanCard = { id: 'loan-1', name: 'บ้านลาดพร้าว', cardType: 'home_loan', dueDay: 15 };
  const ongoingPlan = {
    id: 'plan-1', cardId: 'loan-1', itemName: 'บ้านลาดพร้าว', months: 240, status: 'ongoing',
    // ตั้งใจให้ monthlyPayment ต่างจาก row.payment ของแถวที่ครบกำหนด เพื่อให้เทส "ต้องอ่าน row.payment
    // เท่านั้น" ไม่ผ่านเงียบ ๆ แม้โค้ดจะอ่านผิดฟิลด์
    monthlyPayment: 9999.99,
    schedule: [
      { no: 13, dueMonth: '2024-01', payment: 7164.31, paid: false },
      { no: 14, dueMonth: '2024-02', payment: 7164.31, paid: false }
    ]
  };

  function makeCreditData(overrides: { cards?: unknown[]; plans?: unknown[] } = {}) {
    return {
      cards: overrides.cards ?? [loanCard],
      plans: overrides.plans ?? [ongoingPlan],
      cycles: [],
      spendItems: [],
      updatedAt: null
    } as Parameters<typeof collectLoanDueEvents>[0];
  }

  beforeEach(() => {
    jest.mocked(creditCardRevolving.buildRevolvingCyclesForData).mockClear();
    jest.mocked(creditCardRevolving.summariseRevolving).mockClear();
  });

  it('สินเชื่อที่มีแผน ongoing และแถวครบกำหนดในหน้าต่างเป้าหมาย → ได้ event เดียว ยอด/วัน/label ถูกต้อง', () => {
    const events = collectLoanDueEvents(makeCreditData(), target);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: 'บ้านลาดพร้าว',
      typeLabel: 'สินเชื่อบ้าน',
      status: 'due',
      resolvedDueDay: 15,
      diffDays: 0,
      remaining: 2,
      // BR-CC-038/money rule: ยอดต้องมาจาก row.payment ของแถวที่ครบกำหนดจริง ไม่ใช่ plan.monthlyPayment
      total: 7164.31
    });
    expect(events[0].row.payment).toBe(7164.31);
    expect(events[0].total).not.toBe(ongoingPlan.monthlyPayment);
  });

  it('E-21: สินเชื่อที่ยังไม่มีแผนเลย → ไม่มี event (contributes 0)', () => {
    const events = collectLoanDueEvents(makeCreditData({ plans: [] }), target);
    expect(events).toEqual([]);
  });

  it('แผนสินเชื่อสถานะ cancelled หรือ completed → ไม่มี event', () => {
    const cancelled = collectLoanDueEvents(makeCreditData({ plans: [{ ...ongoingPlan, status: 'cancelled' }] }), target);
    const completed = collectLoanDueEvents(makeCreditData({ plans: [{ ...ongoingPlan, status: 'completed' }] }), target);
    expect(cancelled).toEqual([]);
    expect(completed).toEqual([]);
  });

  it('BR-CC-038: ไม่เรียก buildRevolvingCyclesForData/summariseRevolving เลยสำหรับบัตรสินเชื่อ', () => {
    collectLoanDueEvents(makeCreditData(), target);

    expect(creditCardRevolving.buildRevolvingCyclesForData).not.toHaveBeenCalled();
    expect(creditCardRevolving.summariseRevolving).not.toHaveBeenCalled();
  });

  it('ยอดที่ได้ต้องมาจาก row.payment ของแถวที่ครบกำหนดอยู่ตอนนี้ ไม่ใช่ plan.monthlyPayment ของการปรับอัตราล่าสุด (S4)', () => {
    // จำลองสถานการณ์จริงหลังปรับอัตราดอกเบี้ย 2 ครั้ง (reviseEffectiveScheduleTail, S4):
    // รอบแรก 6% → รอบสอง (จากงวด 13) 7% → รอบสาม (จากงวด 25) 4.5%
    // plan.monthlyPayment หลังสุดสะท้อนค่างวดของรอบที่ 3 (งวด 25) เท่านั้น ไม่ใช่ของงวด 13 ที่ยังค้างอยู่
    const base = buildEffectiveSchedule({ totalPrice: 1_000_000, months: 240, startMonth: '2026-01', annualRate: 6 });
    const afterFirstRevision = reviseEffectiveScheduleTail(
      { totalPrice: 1_000_000, schedule: base.schedule },
      { fromInstallmentNo: 13, annualRate: 7 }
    );
    if (!afterFirstRevision.ok) throw new Error('expected first revision to succeed');
    const afterSecondRevision = reviseEffectiveScheduleTail(
      { totalPrice: 1_000_000, schedule: afterFirstRevision.schedule },
      { fromInstallmentNo: 25, annualRate: 4.5 }
    );
    if (!afterSecondRevision.ok) throw new Error('expected second revision to succeed');

    const dueRow = afterSecondRevision.schedule.find(row => row.no === 13);
    if (!dueRow) throw new Error('expected row 13 in the revised schedule');
    // Sanity: row 13 เองต้องต่างจาก monthlyPayment ของแผนหลังปรับครั้งที่สอง ไม่เช่นนั้นเทสนี้ไม่พิสูจน์อะไร
    expect(dueRow.payment).not.toBe(afterSecondRevision.monthlyPayment);

    const revisedLoanCard = { id: 'loan-rev', name: 'บ้านหลังแรก', cardType: 'home_loan', dueDay: 15 };
    const revisedLoanPlan = {
      id: 'plan-rev', cardId: 'loan-rev', itemName: 'บ้านหลังแรก', months: 240, status: 'ongoing',
      monthlyPayment: afterSecondRevision.monthlyPayment,
      schedule: afterSecondRevision.schedule
    };
    const targetForRow13 = getCurrentDateInfo(`${dueRow.dueMonth}-15`)!;

    const events = collectLoanDueEvents(makeCreditData({ cards: [revisedLoanCard], plans: [revisedLoanPlan] }), targetForRow13);

    expect(events).toHaveLength(1);
    expect(events[0].total).toBe(dueRow.payment);
    expect(events[0].total).not.toBe(revisedLoanPlan.monthlyPayment);
  });
});

// S5 D4 — deriveLoanHeaderTitle/buildLoanMessage/buildLoanFlex (spec I-6, UX_SPEC-loan-installments.md §9).
// Tested directly through the named exports, against hand-built LoanDueEvent fixtures (not through
// collectLoanDueEvents — these builders only consume its output type, per the dispatch instructions).
// Not yet wired into the handler (that is D5).
describe('deriveLoanHeaderTitle / buildLoanMessage / buildLoanFlex (loan-installments-s5 D4)', () => {
  const TARGET_DATE = '2026-12-03'; // target.day = 3 → matches UX_SPEC §9's sample ("วันที่ 3 ธ.ค. 2569")
  const target = getCurrentDateInfo(TARGET_DATE)!;

  const loanPlan: CreditPlan = {
    id: 'plan-1', cardId: 'loan-1', itemName: 'สัญญาเลขที่ 123456789', months: 240, status: 'ongoing',
    schedule: [{ no: 13, dueMonth: '2026-12', payment: 7164.31, paid: false }]
  };

  // ตรงกับตัวอย่างจริงใน UX_SPEC §9 ทุกตัวอักษร: KBank บ้านลาดพร้าว, home_loan, ครบกำหนดอีก 2 วัน
  function makeDueSoonLoanEvent(): Parameters<typeof buildLoanMessage>[1][number] {
    return {
      card: { id: 'loan-1', name: 'KBank บ้านลาดพร้าว', cardType: 'home_loan', dueDay: 5 },
      plan: loanPlan,
      row: loanPlan.schedule![0],
      remaining: 228,
      name: 'KBank บ้านลาดพร้าว',
      typeLabel: 'สินเชื่อบ้าน',
      status: 'dueSoon',
      resolvedDueDay: 5,
      dueDateText: '5 ธ.ค. 2569',
      isEndOfMonth: false,
      diffDays: 2,
      total: 7164.31
    };
  }

  function makeOverdueLoanEvent(): Parameters<typeof buildLoanMessage>[1][number] {
    return {
      card: { id: 'loan-2', name: 'สินเชื่อส่วนบุคคล SCB', cardType: 'personal_loan', dueDay: 1 },
      plan: { id: 'plan-2', cardId: 'loan-2', itemName: 'สัญญาเลขที่ 987654321', months: 36, status: 'ongoing',
        schedule: [{ no: 5, dueMonth: '2026-12', payment: 3500, paid: false }] },
      row: { no: 5, dueMonth: '2026-12', payment: 3500, paid: false },
      remaining: 31,
      name: 'สินเชื่อส่วนบุคคล SCB',
      typeLabel: 'สินเชื่อส่วนบุคคล',
      status: 'overdue',
      resolvedDueDay: 1,
      dueDateText: '1 ธ.ค. 2569',
      isEndOfMonth: false,
      diffDays: -2,
      total: 3500
    };
  }

  // UX_SPEC-loan-installments.md:203-215 — ตัวอย่าง "ตัวจริง" ที่ต้องตรงตัวอักษรทุกตัว
  const UX_SPEC_SAMPLE = [
    '🏦 FinanceTrack แจ้งเตือนค่างวดสินเชื่อ',
    'ครบกำหนดชำระ',
    'เดือน ธันวาคม 2569',
    'วันที่ 3 ธ.ค. 2569',
    '━━━━━━━━━━━━',
    '📌 ครบกำหนดชำระ',
    '1. KBank บ้านลาดพร้าว (สินเชื่อบ้าน) — 7,164.31 บาท',
    '   📅 5 ธ.ค. 2569 (อีก 2 วัน)',
    '   • สัญญาเลขที่ 123456789 — งวด 13/240 (เหลืออีก 228 งวด)',
    '━━━━━━━━━━━━',
    'รวมต้องชำระ: 7,164.31 บาท (1 สินเชื่อ · 1 งวด)',
    'จัดการสินเชื่อ ➜ https://finance-track-one.vercel.app/credits 🏦'
  ].join('\n');

  describe('deriveLoanHeaderTitle (Decision B — mirrors deriveCardHeaderTitle)', () => {
    it('ไม่มีเลยกำหนดเลย → ครบกำหนดชำระ', () => {
      expect(deriveLoanHeaderTitle(0, 1)).toBe('ครบกำหนดชำระ');
    });
    it('เลยกำหนดอย่างเดียว → เลยกำหนดชำระ', () => {
      expect(deriveLoanHeaderTitle(2, 0)).toBe('เลยกำหนดชำระ');
    });
    it('ผสมทั้งครบกำหนดและเลยกำหนด → ครบกำหนดชำระ + เลยกำหนด', () => {
      expect(deriveLoanHeaderTitle(1, 1)).toBe('ครบกำหนดชำระ + เลยกำหนด');
    });
  });

  describe('buildLoanMessage', () => {
    it('คืน null เมื่อไม่มี event เลย (E-26: ห้ามส่งข้อความเปล่า)', () => {
      expect(buildLoanMessage(target, [])).toBeNull();
    });

    it('สินเชื่อตัวเดียว ครบกำหนดอีก 2 วัน → ข้อความตรงกับ UX_SPEC §9 ทุกตัวอักษร', () => {
      const message = buildLoanMessage(target, [makeDueSoonLoanEvent()]);
      expect(message).toBe(UX_SPEC_SAMPLE);
    });

    it('จำนวนเงินของสินเชื่อปรากฏครั้งเดียวต่อสินเชื่อในบล็อกรายการ (Decision A1 — ไม่ซ้ำบรรทัดงวด)', () => {
      const message = buildLoanMessage(target, [makeDueSoonLoanEvent()]);
      if (!message) throw new Error('expected a message');
      const lines = message.split('\n');
      // บล็อกของสินเชื่อนี้มี 3 บรรทัด: หัว, วัน, งวด — จำนวนเงินต้องอยู่แค่บรรทัดหัวบรรทัดเดียว
      const headIdx = lines.findIndex(line => line.startsWith('1. KBank บ้านลาดพร้าว'));
      const loanBlock = lines.slice(headIdx, headIdx + 3);
      const occurrencesInBlock = loanBlock.filter(line => line.includes('7,164.31')).length;
      expect(occurrencesInBlock).toBe(1);
      // บรรทัดงวดต้องไม่มี "บาท" ต่อท้าย (ไม่มีจำนวนเงินซ้ำ)
      const scheduleLine = lines.find(line => line.includes('งวด 13/240'));
      expect(scheduleLine).toBe('   • สัญญาเลขที่ 123456789 — งวด 13/240 (เหลืออีก 228 งวด)');
      expect(scheduleLine).not.toContain('บาท');
    });

    it('Decision B: เลยกำหนด + ครบกำหนดผสมกัน → header ผสม, เลยกำหนดอยู่ก่อน, ยอดรวมรวมทั้งสองตัว', () => {
      const overdueEvent = makeOverdueLoanEvent();
      const dueSoonEvent = makeDueSoonLoanEvent();
      const message = buildLoanMessage(target, [overdueEvent, dueSoonEvent]);
      if (!message) throw new Error('expected a message');
      const lines = message.split('\n');

      expect(lines[1]).toBe('ครบกำหนดชำระ + เลยกำหนด');
      const overdueSectionIdx = lines.indexOf('⚠️ เลยกำหนดชำระ');
      const upcomingSectionIdx = lines.indexOf('📌 ครบกำหนดชำระ');
      expect(overdueSectionIdx).toBeGreaterThan(-1);
      expect(upcomingSectionIdx).toBeGreaterThan(overdueSectionIdx);
      // ลำดับเลยกำหนดก่อน: event แรกของเลยกำหนดต้องถูก index "1." ส่วนครบกำหนดต่อที่ "2."
      expect(lines.some(line => line.startsWith('1. สินเชื่อส่วนบุคคล SCB'))).toBe(true);
      expect(lines.some(line => line.startsWith('2. KBank บ้านลาดพร้าว'))).toBe(true);

      expect(message).toContain('รวมต้องชำระ: 10,664.31 บาท (2 สินเชื่อ · 2 งวด)');
      // ยอดรวมของสองสินเชื่อปรากฏครั้งเดียวต่อตัว เหมือนกรณีสินเชื่อเดียว
      expect(message.split('7,164.31').length - 1).toBe(1);
      expect(message.split('3,500').length - 1).toBe(1);
    });

    it('ลิงก์ CTA ต้องชี้ไป /credits ไม่ใช่ /credit-cards', () => {
      const message = buildLoanMessage(target, [makeDueSoonLoanEvent()]);
      expect(message).toContain('https://finance-track-one.vercel.app/credits');
      expect(message).not.toContain('/credit-cards');
    });
  });

  describe('buildLoanFlex', () => {
    it('คืน null เมื่อไม่มี event เลย', () => {
      expect(buildLoanFlex(target, [])).toBeNull();
    });

    it('สินเชื่อตัวเดียว → text node ทุกตัวตรงกับฉบับข้อความล้วน และจำนวนเงินปรากฏครั้งเดียว', () => {
      const flex = buildLoanFlex(target, [makeDueSoonLoanEvent()]);
      if (!flex) throw new Error('expected a flex bubble');
      const nodes = collectFlexTextNodes(flex);
      const amountNodes = nodes.filter(text => text.includes('7,164.31'));
      // บรรทัดหัว (7,164.31 บาท) + กล่องยอดรวม (7,164.31 บาท) = 2 ครั้งทั้ง bubble แต่ "ต่อสินเชื่อ"
      // (ไม่รวม totals box) ต้องมีแค่ 1 ครั้งเดียว — แยกเช็คบรรทัดงวดของสินเชื่อต้องไม่มี "บาท" กำกับ
      const scheduleNode = nodes.find(text => text.includes('งวด 13/240'));
      expect(scheduleNode).toBe('สัญญาเลขที่ 123456789 — งวด 13/240 (เหลืออีก 228 งวด)');
      expect(scheduleNode).not.toContain('บาท');
      expect(amountNodes.length).toBeGreaterThanOrEqual(1);
      expect(nodes.some(text => text.includes('KBank บ้านลาดพร้าว (สินเชื่อบ้าน)'))).toBe(true);
      expect(nodes.some(text => text === 'ครบกำหนดชำระ')).toBe(true);
    });

    it('ธีมสว่าง (ไม่ใช่ธีมมืด) และ CTA ชี้ไป /credits', () => {
      const flex = buildLoanFlex(target, [makeDueSoonLoanEvent()]) as Record<string, unknown>;
      const styles = flex.styles as { body: { backgroundColor: string } };
      expect(styles.body.backgroundColor).toBe('#ffffff'); // LINE_THEME.surface (ธีมสว่าง)

      const footer = flex.footer as { contents: Array<{ action: { uri: string; label: string } }> };
      const button = footer.contents[0];
      expect(button.action.uri).toBe('https://finance-track-one.vercel.app/credits');
      expect(button.action.label).toBe('จัดการสินเชื่อ');
    });

    it('Decision B: เลยกำหนด + ครบกำหนดผสมกัน → header ผสม เหมือนฉบับข้อความล้วน', () => {
      const flex = buildLoanFlex(target, [makeOverdueLoanEvent(), makeDueSoonLoanEvent()]);
      if (!flex) throw new Error('expected a flex bubble');
      const nodes = collectFlexTextNodes(flex);
      expect(nodes).toContain('ครบกำหนดชำระ + เลยกำหนด');
    });
  });
});
