/** @jest-environment node */
// savings-loan-withdrawal S3 / d3 — PATCH /api/monthly_expense against slr_ (savings-loan repayment) rows.
// spec §4.10, architecture-review C-S3-8 (409 repayment_row_immutable, first check after parsing, both modes),
// C-S3-9 (hasOrdinaryRows ignores slr_ keys so a repayment-only month still seeds defaults) and C-S3-10 (strict
// predicate: a non-matching slr_foo key is an ordinary row).
//
// Every case runs in JSON mode (real JSON store in a temp AUDIT_DATA_DIR) and Mongo mode (in-process replica set).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMocks } from 'node-mocks-http';
import type { NextApiHandler } from 'next';
import type { Db } from 'mongodb';
import { MongoMemoryServer } from '../helpers/mongoReplSet';
import { DEFAULT_EXPENSE_ITEMS } from '../../src/shared/utils/expenseDefaults';

type Mode = 'json' | 'mongo';
type Row = Record<string, unknown>;

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'slr-patch-user-a';
const MONTH = '2026-08';
const JSON_FILENAME = 'monthly_expense.json';
const SLR_KEY = 'slr_0123456789abcdef01234567';
const LEGACY_ERROR = 'Legacy expense document cannot be updated per row';

const repaymentRow = (extra: Row = {}): Row => ({
  name: 'คืนเงินกู้ออม: ทริปญี่ปุ่น',
  actual: 1500,
  account: 'กรุงศรี',
  dueDay: 'EOM',
  paid: true,
  ...extra
});
const ordinaryRow = (extra: Row = {}): Row => ({ name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false, dueDay: 'EOM', ...extra });

describe.each<Mode>(['json', 'mongo'])('PATCH /api/monthly_expense slr_ rows (%s mode)', mode => {
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
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slr-patch-json-'));
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

  async function patch(body: Row) {
    const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
    const sid = createSessionId();
    const { req, res } = createMocks({
      method: 'PATCH',
      body: body as any,
      cookies: { [SESSION_COOKIE_NAME]: signSession(USER_A, sid) },
      headers: { 'x-csrf-token': signCsrfToken(sid) }
    } as any);
    await handler(req as any, res as any);
    const raw = res._getData();
    return { status: res._getStatusCode(), json: raw ? JSON.parse(raw) : null };
  }

  describe('C-S3-8 — 409 repayment_row_immutable', () => {
    it.each([true, false])('refuses to set paid=%s on an existing slr_ row and writes nothing', async paid => {
      await seedMonth({ coffee: ordinaryRow(), [SLR_KEY]: repaymentRow() });
      const before = await readMonth();

      const result = await patch({ month: MONTH, key: SLR_KEY, paid });

      expect(result.status).toBe(409);
      expect(result.json).toEqual({ error: 'repayment_row_immutable' });
      expect(await readMonth()).toEqual(before);
    });

    it('refuses an slr_ key with a row payload (the ExpenseTable needsRow shape) and creates nothing', async () => {
      const result = await patch({
        month: MONTH,
        key: SLR_KEY,
        paid: true,
        row: { name: 'คืนเงินกู้ออม: ทริปญี่ปุ่น', actual: '1,500', account: 'กรุงศรี', dueDay: 'EOM' }
      });

      expect(result.status).toBe(409);
      expect(result.json).toEqual({ error: 'repayment_row_immutable' });
      expect(await readMonth()).toBeNull();
    });

    it('fires before the legacy-document check when the month is legacy-shaped', async () => {
      await seedMonth({ actual: { house: 5000 }, [SLR_KEY]: repaymentRow() });
      const before = await readMonth();

      const result = await patch({ month: MONTH, key: SLR_KEY, paid: false });

      expect(result.status).toBe(409);
      expect(result.json).toEqual({ error: 'repayment_row_immutable' });
      expect(await readMonth()).toEqual(before);
    });

    it('leaves the legacy-document 409 intact for ordinary keys', async () => {
      await seedMonth({ actual: { house: 5000 } });
      const before = await readMonth();

      const result = await patch({ month: MONTH, key: 'coffee', paid: true, row: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', dueDay: 'EOM' } });

      expect(result.status).toBe(409);
      expect(result.json).toEqual({ error: LEGACY_ERROR });
      expect(await readMonth()).toEqual(before);
    });

    it('C-S3-10: a non-matching slr_foo key is an ordinary row and can be toggled', async () => {
      await seedMonth({ slr_foo: ordinaryRow() });

      const result = await patch({ month: MONTH, key: 'slr_foo', paid: true });

      expect(result.status).toBe(200);
      expect(result.json).toMatchObject({ success: true, paid: true, initialized: false });
      expect((await readMonth())?.slr_foo).toEqual(ordinaryRow({ paid: true }));
    });
  });

  describe('C-S3-9 — hasOrdinaryRows ignores slr_ keys', () => {
    it('seeds the default rows when the month holds only repayment rows, keeping the slr_ row intact', async () => {
      await seedMonth({ [SLR_KEY]: repaymentRow() });

      const result = await patch({ month: MONTH, key: 'house', paid: true });

      expect(result.status).toBe(200);
      expect(result.json).toMatchObject({ success: true, paid: true, initialized: true, seeded: true });
      const doc = await readMonth();
      for (const item of DEFAULT_EXPENSE_ITEMS) expect(doc?.[item.key]).toBeTruthy();
      expect((doc?.house as Row).paid).toBe(true);
      expect((doc?.water as Row).paid).toBe(false);
      expect(doc?.[SLR_KEY]).toEqual(repaymentRow());
    });

    it('does not seed defaults when an ordinary row sits beside the repayment row', async () => {
      await seedMonth({ coffee: ordinaryRow(), [SLR_KEY]: repaymentRow() });

      const result = await patch({ month: MONTH, key: 'house', paid: true });

      // Unchanged pre-S3 behaviour: no row payload and the month already has ordinary rows → 404, nothing written.
      expect(result.status).toBe(404);
      const doc = await readMonth();
      expect(doc?.house).toBeUndefined();
      expect(doc?.[SLR_KEY]).toEqual(repaymentRow());
    });

    it('C-S3-10: a non-matching slr_foo row still counts as ordinary, so defaults are not seeded', async () => {
      await seedMonth({ slr_foo: ordinaryRow() });

      const result = await patch({ month: MONTH, key: 'house', paid: true });

      expect(result.status).toBe(404);
      expect((await readMonth())?.house).toBeUndefined();
    });
  });
});
