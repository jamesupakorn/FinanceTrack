/** @jest-environment node */
// ADR-029 mutation-inventory coverage (Mongo mode, real replica set): credit-card routes,
// change_password redaction, line_webhook system actor, and the unaudited delivery-bookkeeping paths.
import { MongoMemoryServer } from '../helpers/mongoReplSet';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { createMocks } from 'node-mocks-http';
import type { Db } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

declare const jest: typeof import('@jest/globals').jest;

type Handler = (req: never, res: never) => Promise<unknown>;

const USER_A = 'inv-user-a';
const OLD_PASSWORD = 'old-secret-pass';
const NEW_PASSWORD = 'brand-new-secret-pass';
const LINE_SECRET = 'line-test-secret';
const LINK_USER = 'u9001';
const LINE_USER_ID = 'Uline-secret-id-123';

let mongod: MongoMemoryServer;
let db: Db;
let sessionCookie: typeof import('../../src/shared/utils/backend/sessionCookie');
let cards: Handler;
let plans: Handler;
let revolving: Handler;
let changePassword: Handler;
let lineWebhook: Handler;
let audit: Handler;
let userStore: typeof import('../../lib/userStore');

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';
  process.env.SESSION_SECRET = 'test-secret';
  process.env.LINE_CHANNEL_SECRET = LINE_SECRET;
  jest.resetModules();
  cards = require('../../pages/api/credit-cards/index').default;
  plans = require('../../pages/api/credit-cards/plans').default;
  revolving = require('../../pages/api/credit-cards/revolving').default;
  changePassword = require('../../pages/api/change_password').default;
  lineWebhook = require('../../pages/api/line_webhook').default;
  audit = require('../../pages/api/audit-logs').default;
  userStore = require('../../lib/userStore');
  sessionCookie = require('../../src/shared/utils/backend/sessionCookie');
  db = await require('../../lib/mongodb').getDbPromise();
}, 60000);

afterAll(async () => {
  if (db?.client) await db.client.close();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  for (const c of ['users', 'audit_logs', 'credit_cards']) await db.collection(c).deleteMany({});
  const passwordHash = await bcrypt.hash(OLD_PASSWORD, 10);
  await db.collection('users').insertOne({ id: USER_A, displayName: 'A', passwordHash });
});

function call(handler: Handler, { method = 'GET', userId = USER_A as string | null, query = {}, body }: { method?: string; userId?: string | null; query?: Record<string, string>; body?: unknown } = {}) {
  const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
  const sid = createSessionId();
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const { req, res } = createMocks({
    method: method as never,
    query,
    body: body as never,
    cookies: userId ? { [SESSION_COOKIE_NAME]: signSession(userId, sid) } : {},
    headers: mutating ? { 'x-csrf-token': signCsrfToken(sid) } : {}
  });
  return handler(req as never, res as never).then(() => ({ status: res._getStatusCode(), data: res._getData() ? JSON.parse(res._getData()) : undefined }));
}

async function events(userId = USER_A) {
  return (await call(audit, { userId })).data.items as Array<Record<string, unknown>>;
}

async function sendWebhook(text: string, lineUserId: string) {
  const bodyString = JSON.stringify({ events: [{ type: 'message', source: { userId: lineUserId }, message: { type: 'text', text } }] });
  const signature = crypto.createHmac('sha256', LINE_SECRET).update(bodyString).digest('base64');
  const { req, res } = createMocks({ method: 'POST', headers: { 'x-line-signature': signature } });
  const pending = lineWebhook(req as never, res as never);
  for (let i = 0; i < 500 && req.listenerCount('end') === 0; i++) await new Promise(r => setTimeout(r, 5));
  req.send(bodyString);
  await pending;
  return res._getStatusCode();
}

const CARD = { name: 'บัตรทดสอบ', creditLimit: 50000, annualRate: 0, minPaymentPercent: 10, statementDay: 5, dueDay: 20, color: '#5d5bff' };

describe('credit-card routes are audited', () => {
  it('card, plan and spend-item creates each emit one user event; reads emit none', async () => {
    const cardRes = await call(cards, { method: 'POST', body: { card: CARD } });
    expect(cardRes.status).toBe(200);
    const cardId = (cardRes.data.card as { id: string }).id;
    const afterCard = await events();
    expect(afterCard).toHaveLength(1);
    expect(afterCard[0]).toMatchObject({ actorType: 'user', action: 'created' });

    const planRes = await call(plans, {
      method: 'POST',
      body: { plan: { cardId, itemName: 'ของใช้', totalPrice: 1000, months: 3, startMonth: '2026-01', interestMode: 'manual', manualFeePerMonth: 0, purchaseDate: '2026-01-01' } }
    });
    expect(planRes.status).toBe(200);
    expect(await events()).toHaveLength(2);

    const spendItems: Handler = require('../../pages/api/credit-cards/spend-items').default;
    const cycleRes = await call(spendItems, { method: 'POST', body: { item: { cardId, month: '2099-01', name: 'อาหาร', amount: 100 } } });
    expect(cycleRes.status).toBe(201);
    expect(await events()).toHaveLength(3);

    await call(cards, {});
    await call(plans, {});
    await call(revolving, { query: { cardId, month: '2099-01' } });
    expect(await events()).toHaveLength(3);
  });

  it('a rejected credit-card request writes no domain change and no event', async () => {
    expect((await call(cards, { method: 'POST', body: {} })).status).toBe(400);
    expect((await call(plans, { method: 'POST', body: { plan: { cardId: 'missing' } } })).status).toBeGreaterThanOrEqual(400);
    expect(await events()).toHaveLength(0);
    expect(await db.collection('credit_cards').countDocuments({})).toBe(0);
  });

  it('stores no credit-card values, names or amounts in the audit event', async () => {
    await call(cards, { method: 'POST', body: { card: CARD } });
    const serialized = JSON.stringify(await events());
    expect(serialized).not.toContain('บัตรทดสอบ');
    expect(serialized).not.toContain('50000');
  });
});

describe('change_password', () => {
  it('audits the password change without storing any secret or hash', async () => {
    const res = await call(changePassword, { method: 'POST', body: { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD } });
    expect(res.status).toBe(200);
    const items = await events();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ resource: 'account', actorType: 'user' });
    expect(JSON.stringify(items[0].changedFields)).toContain('password');

    const stored = JSON.stringify(await db.collection('audit_logs').find({}).toArray());
    const hash = (await db.collection('users').findOne({ id: USER_A }))?.passwordHash as string;
    for (const secret of [OLD_PASSWORD, NEW_PASSWORD, hash, 'passwordHash']) expect(stored).not.toContain(secret);
  });

  it('a wrong current password changes nothing and emits no event', async () => {
    const res = await call(changePassword, { method: 'POST', body: { currentPassword: 'nope', newPassword: NEW_PASSWORD } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await events()).toHaveLength(0);
  });
});

describe('line_webhook', () => {
  it('audits LINE linking as a system actor and never stores the LINE id', async () => {
    await db.collection('users').insertOne({ id: LINK_USER, displayName: 'L' });
    expect(await sendWebhook(`link ${LINK_USER}`, LINE_USER_ID)).toBe(200);
    expect((await db.collection('users').findOne({ id: LINK_USER }))?.LineId).toBe(LINE_USER_ID);

    const items = await events(LINK_USER);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ actorType: 'system' });
    expect(JSON.stringify(items[0].changedFields)).toContain('lineId');

    const stored = JSON.stringify(await db.collection('audit_logs').find({}).toArray());
    expect(stored).not.toContain(LINE_USER_ID);
  });

  it('an invalid signature changes nothing and emits no event', async () => {
    const { req, res } = createMocks({ method: 'POST', headers: { 'x-line-signature': 'bad' } });
    const pending = lineWebhook(req as never, res as never);
    for (let i = 0; i < 500 && req.listenerCount('end') === 0; i++) await new Promise(r => setTimeout(r, 5));
    req.send(JSON.stringify({ events: [] }));
    await pending;
    expect(res._getStatusCode()).toBe(401);
    expect(await db.collection('audit_logs').countDocuments({})).toBe(0);
  });
});

describe('unaudited delivery bookkeeping', () => {
  it('marking the monthly summary as sent changes the user but emits no event', async () => {
    await userStore.markUserMonthlySummarySent(USER_A, '2026-03');
    expect((await db.collection('users').findOne({ id: USER_A }))?.lastMonthlySummarySent).toBe('2026-03');
    expect(await db.collection('audit_logs').countDocuments({})).toBe(0);
  });

  it('LINE notification cron routes are not wrapped with the audit middleware', () => {
    for (const file of ['line_monthly_summary.ts', 'line_due_notify.ts']) {
      const source = fs.readFileSync(path.join(__dirname, '../../pages/api', file), 'utf8');
      expect(source).not.toMatch(/withAudit/);
    }
  });
});
