/** @jest-environment node */
// savings-loan-withdrawal S3 / d4 — normal (non-repayment) POST /api/monthly_expense strips slr_ keys.
// spec §4.10 / D-SLW-15 / AC-SLW-21, architecture-review C-S3-7 (strip after applyCreditCardPaid, before
// extractRemovalKeys, both modes) and C-S3-10 (strict predicate: a non-matching slr_foo key is an ordinary row).
//
// The strip applies to CLIENT INPUT only. Stored slr_ rows (written by the repayment flow) must survive every
// normal save untouched — they can't be created, overwritten or removed through this path.
//
// Every route case runs in JSON mode (real JSON store in a temp AUDIT_DATA_DIR) and Mongo mode (in-process replica set).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMocks } from 'node-mocks-http';
import type { NextApiHandler } from 'next';
import type { Db } from 'mongodb';
import { MongoMemoryServer } from '../helpers/mongoReplSet';
import { stripSavingsLoanRepaymentKeys } from '../../src/shared/utils/backend/savingsLoanSync';

type Mode = 'json' | 'mongo';
type Row = Record<string, unknown>;

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'slr-post-user-a';
const MONTH = '2026-08';
const JSON_FILENAME = 'monthly_expense.json';
const SLR_KEY = 'slr_0123456789abcdef01234567';
const OTHER_SLR_KEY = 'slr_fedcba9876543210fedcba98';

const repaymentRow = (extra: Row = {}): Row => ({
  name: 'คืนเงินกู้ออม: ทริปญี่ปุ่น',
  actual: 1500,
  account: 'กรุงศรี',
  dueDay: 'EOM',
  paid: true,
  ...extra
});
const ordinaryRow = (extra: Row = {}): Row => ({ name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false, dueDay: 'EOM', ...extra });

describe('stripSavingsLoanRepaymentKeys (pure)', () => {
  it('removes strict slr_ keys and their __removeKeys entries, keeps everything else', () => {
    const input = {
      coffee: ordinaryRow(),
      [SLR_KEY]: repaymentRow(),
      slr_foo: ordinaryRow(),
      ccr_card1: { paid: true },
      bankAccounts: ['กรุงศรี'],
      __removeKeys: [SLR_KEY, 'tea', 'slr_foo', OTHER_SLR_KEY]
    };

    const result = stripSavingsLoanRepaymentKeys(input);

    expect(result).toEqual({
      coffee: ordinaryRow(),
      slr_foo: ordinaryRow(),
      ccr_card1: { paid: true },
      bankAccounts: ['กรุงศรี'],
      __removeKeys: ['tea', 'slr_foo']
    });
    // The input object is not mutated.
    expect(input[SLR_KEY]).toEqual(repaymentRow());
    expect(input.__removeKeys).toHaveLength(4);
  });

  it('leaves a non-array __removeKeys alone (extractRemovalKeys ignores it anyway)', () => {
    expect(stripSavingsLoanRepaymentKeys({ __removeKeys: SLR_KEY })).toEqual({ __removeKeys: SLR_KEY });
  });

  it('does not treat near-miss keys as repayment keys', () => {
    const nearMisses = {
      slr_0123456789ABCDEF01234567: 1, // uppercase hex
      slr_0123456789abcdef0123456: 2, // 23 hex
      slr_0123456789abcdef012345678: 3, // 25 hex
      xslr_0123456789abcdef01234567: 4
    };
    expect(stripSavingsLoanRepaymentKeys(nearMisses)).toEqual(nearMisses);
  });
});

describe.each<Mode>(['json', 'mongo'])('normal POST /api/monthly_expense strips slr_ input (%s mode)', mode => {
  let handler: NextApiHandler;
  let sessionCookie: any;
  let dir = '';
  let mongod: MongoMemoryServer | null = null;
  let db: Db | null = null;

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    if (mode === 'json') {
      process.env.DATA_MODE = 'json';
      delete process.env.MONGODB_URI;
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slr-post-json-'));
      process.env.AUDIT_DATA_DIR = dir;
    } else {
      mongod = await MongoMemoryServer.create();
      process.env.MONGODB_URI = mongod.getUri();
      process.env.DATA_MODE = 'mongo';
      delete process.env.AUDIT_DATA_DIR;
    }
    jest.resetModules();
    handler = require('../../pages/api/monthly_expense').default;
    sessionCookie = require('../../src/shared/utils/backend/sessionCookie');
    if (mode === 'mongo') db = await require('../../lib/mongodb').getDbPromise();
  }, 60000);

  afterAll(async () => {
    if (mode === 'json') {
      delete process.env.AUDIT_DATA_DIR;
      fs.rmSync(dir, { recursive: true, force: true });
    }
    if (db?.client) await (db as any).client.close();
    if (mongod) await mongod.stop();
  });

  beforeEach(async () => {
    if (mode === 'json') {
      fs.readdirSync(dir).forEach(name => fs.rmSync(path.join(dir, name), { recursive: true, force: true }));
    } else if (db) {
      await db.collection('monthly_expense').deleteMany({});
      await db.collection('users').deleteMany({});
      await db.collection('audit_logs').deleteMany({});
    }
  });

  /** Seeds the month directly, simulating rows the repayment flow already wrote. */
  async function seedMonth(doc: Row) {
    if (mode === 'json') {
      fs.writeFileSync(path.join(dir, JSON_FILENAME), JSON.stringify({ [USER_A]: { [MONTH]: { month: MONTH, ...doc } } }));
      return;
    }
    await db!.collection('monthly_expense').insertOne({ userId: USER_A, month: MONTH, ...doc });
  }

  /** The stored month document without storage-specific id fields, or null when absent. */
  async function readMonth(): Promise<Row | null> {
    if (mode === 'json') {
      const file = path.join(dir, JSON_FILENAME);
      if (!fs.existsSync(file)) return null;
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'))[USER_A]?.[MONTH];
      if (!doc) return null;
      const { id: _id, ...rest } = doc;
      return rest;
    }
    const doc = await db!.collection('monthly_expense').findOne({ userId: USER_A, month: MONTH });
    if (!doc) return null;
    const { _id, userId: _userId, ...rest } = doc;
    return rest as Row;
  }

  async function post(expenseData: Row) {
    const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
    const sid = createSessionId();
    const { req, res } = createMocks({
      method: 'POST',
      body: { month: MONTH, expense_data: expenseData } as any,
      cookies: { [SESSION_COOKIE_NAME]: signSession(USER_A, sid) },
      headers: { 'x-csrf-token': signCsrfToken(sid) }
    } as any);
    await handler(req as any, res as any);
    const raw = res._getData();
    return { status: res._getStatusCode(), json: raw ? JSON.parse(raw) : null };
  }

  it('AC-SLW-21: an edited slr_ row that is also listed in __removeKeys leaves the stored row byte-identical', async () => {
    await seedMonth({ coffee: ordinaryRow(), [SLR_KEY]: repaymentRow() });
    const storedBefore = (await readMonth())?.[SLR_KEY];

    const result = await post({
      coffee: ordinaryRow({ actual: 80 }),
      [SLR_KEY]: repaymentRow({ name: 'แก้ชื่อ', actual: 1, paid: false, account: 'ttb' }),
      __removeKeys: [SLR_KEY]
    });

    expect(result.status).toBe(200);
    expect(result.json).toEqual({ success: true });
    const doc = await readMonth();
    expect(JSON.stringify(doc?.[SLR_KEY])).toBe(JSON.stringify(storedBefore));
    // The ordinary part of the same save still applies.
    expect(doc?.coffee).toEqual(ordinaryRow({ actual: 80 }));
  });

  it('cannot create a fake slr_ row in an existing month', async () => {
    await seedMonth({ coffee: ordinaryRow() });

    const result = await post({ coffee: ordinaryRow(), tea: ordinaryRow({ name: 'ชา' }), [SLR_KEY]: repaymentRow() });

    expect(result.status).toBe(200);
    const doc = await readMonth();
    expect(doc?.[SLR_KEY]).toBeUndefined();
    expect(doc?.tea).toEqual(ordinaryRow({ name: 'ชา' }));
  });

  it('cannot create a fake slr_ row in a month that has no document yet (copy-previous-month shape)', async () => {
    const result = await post({ coffee: ordinaryRow(), [SLR_KEY]: repaymentRow() });

    expect(result.status).toBe(200);
    const doc = await readMonth();
    expect(doc).not.toBeNull();
    expect(doc?.coffee).toEqual(ordinaryRow());
    expect(Object.keys(doc ?? {}).filter(key => key.startsWith('slr_'))).toEqual([]);
  });

  it('cannot remove a stored slr_ row through __removeKeys alone, while ordinary removals still apply', async () => {
    await seedMonth({ coffee: ordinaryRow(), tea: ordinaryRow({ name: 'ชา' }), [SLR_KEY]: repaymentRow() });

    const result = await post({ coffee: ordinaryRow(), __removeKeys: [SLR_KEY, 'tea'] });

    expect(result.status).toBe(200);
    const doc = await readMonth();
    expect(doc?.[SLR_KEY]).toEqual(repaymentRow());
    expect(doc?.tea).toBeUndefined();
    expect(doc?.coffee).toEqual(ordinaryRow());
  });

  it('preserves stored slr_ rows during an unrelated save that does not mention them', async () => {
    await seedMonth({ coffee: ordinaryRow(), [SLR_KEY]: repaymentRow(), [OTHER_SLR_KEY]: repaymentRow({ actual: 200 }) });

    const result = await post({ coffee: ordinaryRow({ paid: true }), bankAccounts: ['กรุงศรี'] });

    expect(result.status).toBe(200);
    const doc = await readMonth();
    expect(doc?.[SLR_KEY]).toEqual(repaymentRow());
    expect(doc?.[OTHER_SLR_KEY]).toEqual(repaymentRow({ actual: 200 }));
    expect(doc?.coffee).toEqual(ordinaryRow({ paid: true }));
  });

  it('C-S3-10: a non-matching slr_foo key is an ordinary row — it can be written and later removed', async () => {
    await seedMonth({ [SLR_KEY]: repaymentRow() });

    const write = await post({ slr_foo: ordinaryRow({ name: 'ของ slr_foo' }) });
    expect(write.status).toBe(200);
    expect((await readMonth())?.slr_foo).toEqual(ordinaryRow({ name: 'ของ slr_foo' }));

    const remove = await post({ __removeKeys: ['slr_foo'] });
    expect(remove.status).toBe(200);
    const doc = await readMonth();
    expect(doc?.slr_foo).toBeUndefined();
    expect(doc?.[SLR_KEY]).toEqual(repaymentRow());
  });
});
