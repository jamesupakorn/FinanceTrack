/** @jest-environment node */
// ADR-028 — PATCH /api/monthly_expense (strict per-row paid toggle), Mongo mode against an in-process MongoDB.
import { MongoMemoryServer } from '../helpers/mongoReplSet';
import { createMocks } from 'node-mocks-http';
import { buildInstallmentRowKey } from '../../src/shared/utils/creditCardUtils';

const USER_A = 'patch-user-a';
const USER_B = 'patch-user-b';
const MONTH = '2026-08';

let mongod: any;
let handler: any;
let db: any;
let sessionCookie: any;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';
  process.env.SESSION_SECRET = 'test-secret-do-not-use-in-prod';
  jest.resetModules();
  handler = require('../../pages/api/monthly_expense').default;
  sessionCookie = require('../../src/shared/utils/backend/sessionCookie');
  db = await require('../../lib/mongodb').getDbPromise();
}, 60000);

afterAll(async () => {
  if (db?.client) await db.client.close();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await db.collection('monthly_expense').deleteMany({});
  await db.collection('credit_cards').deleteMany({});
  await db.collection('users').deleteMany({});
});

async function patch(body: unknown, { userId = USER_A, omitCsrf = false } = {}) {
  const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
  const sid = createSessionId();
  const { req, res } = createMocks({
    method: 'PATCH',
    body: body as any,
    cookies: userId ? { [SESSION_COOKIE_NAME]: signSession(userId, sid) } : {},
    headers: omitCsrf ? {} : { 'x-csrf-token': signCsrfToken(sid) }
  } as any);
  await handler(req, res);
  return { status: res._getStatusCode(), json: res._getData() ? JSON.parse(res._getData()) : null };
}

const row = (extra = {}) => ({ name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false, dueDay: 'EOM', ...extra });
const getDoc = (userId = USER_A, month = MONTH) => db.collection('monthly_expense').findOne({ userId, month });

describe('PATCH /api/monthly_expense — ordinary rows', () => {
  it('changes only paid on an existing row and leaves other rows/users/months untouched', async () => {
    await db.collection('monthly_expense').insertMany([
      { userId: USER_A, month: MONTH, coffee: row(), tea: row({ name: 'ชา', actual: 20 }) },
      { userId: USER_B, month: MONTH, coffee: row() },
      { userId: USER_A, month: '2026-07', coffee: row() }
    ]);
    const result = await patch({ month: MONTH, key: 'coffee', paid: true });
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ success: true, paid: true, initialized: false });
    const doc = await getDoc();
    expect(doc.coffee).toEqual(row({ paid: true }));
    expect(doc.tea).toEqual(row({ name: 'ชา', actual: 20 }));
    expect((await getDoc(USER_B)).coffee.paid).toBe(false);
    expect((await getDoc(USER_A, '2026-07')).coffee.paid).toBe(false);
  });

  it('is idempotent when state already equals the request', async () => {
    await db.collection('monthly_expense').insertOne({ userId: USER_A, month: MONTH, coffee: row({ paid: true }) });
    const result = await patch({ month: MONTH, key: 'coffee', paid: true });
    expect(result.status).toBe(200);
    expect((await getDoc()).coffee.paid).toBe(true);
  });

  it('initializes only the toggled custom row when a row payload is supplied', async () => {
    const result = await patch({ month: MONTH, key: 'custom1', paid: true, row: { name: 'ค่าเช่า', actual: '1,200', account: 'ttb', dueDay: 5 } });
    expect(result.status).toBe(200);
    expect(result.json.initialized).toBe(true);
    const doc = await getDoc();
    expect(doc.custom1).toMatchObject({ name: 'ค่าเช่า', actual: 1200, account: 'ttb', paid: true });
    expect(Object.keys(doc).filter(k => !['_id', 'userId', 'month'].includes(k))).toEqual(['custom1']);
  });

  it('seeds canonical defaults on first built-in default toggle so other defaults survive', async () => {
    const result = await patch({ month: MONTH, key: 'house', paid: true });
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ initialized: true, seeded: true });
    const doc = await getDoc();
    expect(doc.house.paid).toBe(true);
    expect(doc.water.paid).toBe(false);
    expect(doc.internet).toBeTruthy();
  });

  it('seeds default rows with account names when the user document stores id-bearing accounts', async () => {
    await db.collection('users').insertOne({
      id: USER_A,
      bankAccounts: [{ id: 'ba_aaaaaaaaaaaa', name: 'ttb' }]
    });

    const result = await patch({ month: MONTH, key: 'house', paid: true });

    expect(result.status).toBe(200);
    const doc = await getDoc();
    const rows = Object.entries(doc)
      .filter(([key, value]) => !['_id', 'userId', 'month'].includes(key) && value && typeof value === 'object')
      .map(([, value]) => value as { account?: unknown });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(item => typeof item.account === 'string')).toBe(true);
    expect(rows.every(item => item.account !== '[object Object]')).toBe(true);
    expect(doc.house.account).toBe('ttb');
  });

  it('returns 404 for a missing key with paid=true and no row, writing nothing', async () => {
    const result = await patch({ month: MONTH, key: 'ghost', paid: true });
    expect(result.status).toBe(404);
    expect(await getDoc()).toBeNull();
  });
});

describe('PATCH /api/monthly_expense — validation and security', () => {
  it.each([
    ['bad month', { month: '2026-13', key: 'a', paid: true }],
    ['non-boolean paid', { month: MONTH, key: 'a', paid: 'yes' }],
    ['unknown field', { month: MONTH, key: 'a', paid: true, extra: 1 }],
    ['dotted key', { month: MONTH, key: 'a.paid', paid: true }],
    ['$ key', { month: MONTH, key: '$set', paid: true }],
    ['reserved key', { month: MONTH, key: 'userId', paid: true }]
  ])('rejects %s with 400 and no side effects', async (_label, body) => {
    const result = await patch(body);
    expect(result.status).toBe(400);
    expect(await db.collection('monthly_expense').countDocuments()).toBe(0);
  });

  it('rejects missing CSRF (403) and missing session (401)', async () => {
    expect((await patch({ month: MONTH, key: 'a', paid: true }, { omitCsrf: true })).status).toBe(403);
    expect((await patch({ month: MONTH, key: 'a', paid: true }, { userId: '' })).status).toBe(401);
  });
});

describe('PATCH /api/monthly_expense — derived cci_/ccr_ keys', () => {
  const card = { id: 'cc_abc123abc123', name: 'A', creditLimit: 50000, annualRate: 0, minPaymentPercent: 10, statementDay: 5, dueDay: 20, color: '#5d5bff', bankName: '', last4: '' };
  const plan = (overrides = {}) => ({
    id: 'ip_abc123abc123', cardId: card.id, itemName: 'x', totalPrice: 900, months: 3, startMonth: MONTH,
    status: 'ongoing', cancelledAt: null, createdAt: 'n', updatedAt: 'n',
    schedule: [{ no: 1, dueMonth: MONTH, payment: 300, principal: 300, interest: 0, paid: false, paidAt: null, paidSource: null }],
    ...overrides
  });
  const seed = (plans: unknown[]) => db.collection('credit_cards').insertOne({ userId: USER_A, cards: [card], plans, cycles: [] });
  const key = buildInstallmentRowKey('ip_abc123abc123', 1);

  it('toggles an installment through credit_cards and never stores it in monthly_expense', async () => {
    await seed([plan()]);
    const result = await patch({ month: MONTH, key, paid: true });
    expect(result.status).toBe(200);
    expect(result.json.paid).toBe(true);
    const saved = await db.collection('credit_cards').findOne({ userId: USER_A });
    expect(saved.plans[0].schedule[0].paid).toBe(true);
    expect(await db.collection('monthly_expense').countDocuments()).toBe(0);
    expect((await patch({ month: MONTH, key, paid: true })).status).toBe(200);
  });

  it('returns 404 for a missing target, wrong month, or another user, and 409 for a cancelled plan', async () => {
    expect((await patch({ month: MONTH, key, paid: true })).status).toBe(404);
    await seed([plan()]);
    expect((await patch({ month: '2026-09', key, paid: true })).status).toBe(404);
    expect((await patch({ month: MONTH, key, paid: true }, { userId: USER_B })).status).toBe(404);
    await db.collection('credit_cards').updateOne({ userId: USER_A }, { $set: { 'plans.0.status': 'cancelled_early', 'plans.0.cancelledAt': '2026-08-01T00:00:00.000Z', 'plans.0.schedule.0.paid': true } });
    expect((await patch({ month: MONTH, key, paid: false })).status).toBe(409);
    const saved = await db.collection('credit_cards').findOne({ userId: USER_A });
    expect(saved.plans[0].schedule[0].paid).toBe(true);
  });

  it('returns 404 for an unknown revolving key', async () => {
    await seed([]);
    expect((await patch({ month: MONTH, key: 'ccr_cc_missing', paid: true })).status).toBe(404);
  });
});

// AC-12: PATCH never persists resolvedDueDate
describe('PATCH /api/monthly_expense — resolvedDueDate is never persisted (AC-12)', () => {
  const card = { id: 'cc_abc123abc123', name: 'Shopee', creditLimit: 50000, annualRate: 0, minPaymentPercent: 10, statementDay: 'EOM', dueDay: 10, color: '#5d5bff', bankName: '', last4: '' };

  it('derived ccr_ toggle with an echoed resolvedDueDate writes only credit_cards paymentAction, nothing in monthly_expense', async () => {
    await db.collection('credit_cards').insertOne({ userId: USER_A, cards: [card], plans: [], cycles: [{ cardId: card.id, month: MONTH, newSpend: 500, paymentAction: null }] });
    const result = await patch({ month: MONTH, key: 'ccr_abc123abc123', paid: true, resolvedDueDate: '2026-09-10' });
    expect([200, 400]).toContain(result.status);
    expect(await db.collection('monthly_expense').countDocuments()).toBe(0);
    const saved = await db.collection('credit_cards').findOne({ userId: USER_A });
    expect(JSON.stringify(saved)).not.toContain('resolvedDueDate');
  });

  it('ordinary row init with resolvedDueDate in the row payload does not store the field', async () => {
    const result = await patch({ month: MONTH, key: 'custom1', paid: true, row: { name: 'ค่าเช่า', actual: '1,200', account: 'ttb', dueDay: 5, resolvedDueDate: '2026-09-05' } });
    expect([200, 400]).toContain(result.status);
    const doc = await getDoc();
    expect(JSON.stringify(doc ?? {})).not.toContain('resolvedDueDate');
  });
});
