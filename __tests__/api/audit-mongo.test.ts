/** @jest-environment node */
import { MongoMemoryServer } from '../helpers/mongoReplSet';
import { createMocks } from 'node-mocks-http';
import type { Db } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

declare const jest: typeof import('@jest/globals').jest;

const USER_A = 'audit-user-a';
const USER_B = 'audit-user-b';

let mongod: MongoMemoryServer;
let db: Db;
let sessionCookie: typeof import('../../src/shared/utils/backend/sessionCookie');
let salary: (req: never, res: never) => Promise<unknown>;
let goals: (req: never, res: never) => Promise<unknown>;
let bank: (req: never, res: never) => Promise<unknown>;
let profile: (req: never, res: never) => Promise<unknown>;
let audit: (req: never, res: never) => Promise<unknown>;
let auditedMod: typeof import('../../lib/auditedMutation');

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';
  process.env.SESSION_SECRET = 'test-secret';
  jest.resetModules();
  salary = require('../../pages/api/salary').default;
  goals = require('../../pages/api/savings-goals').default;
  bank = require('../../pages/api/user-bank-accounts').default;
  profile = require('../../pages/api/user-profile-settings').default;
  audit = require('../../pages/api/audit-logs').default;
  auditedMod = require('../../lib/auditedMutation');
  sessionCookie = require('../../src/shared/utils/backend/sessionCookie');
  db = await require('../../lib/mongodb').getDbPromise();
}, 60000);

afterAll(async () => {
  if (db?.client) await db.client.close();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  auditedMod.auditTestHooks.beforeAuditWrite = undefined;
  for (const c of ['salary', 'savingsGoals', 'users', 'audit_logs', 'monthly_income', 'monthly_expense', 'investment', 'savings']) {
    await db.collection(c).deleteMany({});
  }
});

function call(handler: (req: never, res: never) => Promise<unknown>, { method = 'GET', userId = USER_A as string | null, query = {}, body }: { method?: string; userId?: string | null; query?: Record<string, string>; body?: unknown } = {}) {
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

const ZERO = { income: {}, deduct: {} };
const postSalary = (month: string, userId = USER_A, extra = {}) =>
  call(salary, { method: 'POST', userId, body: { month, ...ZERO, ...extra } });

const history = (userId = USER_A, query: Record<string, string> = {}) => call(audit, { userId, query });

describe('Mongo atomic data + audit commit', () => {
  it('commits the domain change and one audit event together', async () => {
    expect((await postSalary('2026-03')).status).toBe(201);
    expect(await db.collection('salary').countDocuments({ userId: USER_A })).toBe(1);
    const { data } = await history();
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({ resource: 'salary', action: 'created', resourceKey: '2026-03', actorType: 'user' });
    expect(data.nextCursor).toBeNull();
  });

  it('audit insert failure rolls back the domain change (fail-mutation)', async () => {
    auditedMod.auditTestHooks.beforeAuditWrite = () => { throw new Error('audit down'); };
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await postSalary('2026-03');
    spy.mockRestore();
    expect(r.status).toBe(500);
    expect(r.data).toEqual({ error: 'Internal server error' });
    expect(await db.collection('salary').countDocuments({})).toBe(0);
    expect(await db.collection('audit_logs').countDocuments({})).toBe(0);
  });

  it('a rejected request (400) leaves no domain data and no audit', async () => {
    const r = await call(salary, { method: 'POST', body: { income: {}, deduct: {} } });
    expect(r.status).toBe(400);
    expect(await db.collection('audit_logs').countDocuments({})).toBe(0);
  });

  it('a no-op repeat write produces no second event', async () => {
    await postSalary('2026-03');
    await postSalary('2026-03');
    expect(await db.collection('audit_logs').countDocuments({})).toBe(1);
  });

  it('reads never write audit events', async () => {
    await call(salary, { query: { month: '2026-03' } });
    await call(goals, {});
    expect(await db.collection('audit_logs').countDocuments({})).toBe(0);
  });

  it('events store field names only — no values', async () => {
    await postSalary('2026-04', USER_A, { note: 'TOP-SECRET-NOTE', income: { salary: 987654 } });
    const raw = JSON.stringify(await db.collection('audit_logs').find({}).toArray());
    expect(raw).not.toContain('TOP-SECRET-NOTE');
    expect(raw).not.toContain('987654');
  });

  it('bank-account alias and profile route do not double-log a single change', async () => {
    await db.collection('users').insertOne({ id: USER_A, displayName: 'A', bankAccounts: [] });
    const r = await call(bank, { method: 'POST', body: { bankAccounts: [{ name: 'KTB', balance: 5 }] } });
    expect(r.status).toBe(200);
    const events = await db.collection('audit_logs').find({ subjectUserId: USER_A }).toArray();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ resource: 'user_profile', changedFields: ['bankAccounts'] });
    expect(JSON.stringify(events)).not.toContain('KTB');
    await call(profile, { method: 'POST', body: { bankAccounts: [{ name: 'KTB', balance: 5 }] } });
    expect(await db.collection('audit_logs').countDocuments({})).toBe(1);
  });

  it('shared-month retention deletes happen in the same transaction and are audited as system events', async () => {
    for (let m = 1; m <= 15; m++) await postSalary(`2025-${String(m).padStart(2, '0')}`.replace('-13', '-12'));
    // seed 15 distinct months directly, then add a 16th via the API
    await db.collection('salary').deleteMany({});
    await db.collection('audit_logs').deleteMany({});
    const months: string[] = [];
    for (let i = 0; i < 15; i++) months.push(`${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
    await db.collection('salary').insertMany(months.map(month => ({ userId: USER_A, month, income: {}, deduct: {} })));
    const r = await postSalary('2025-04');
    expect(r.status).toBe(201);
    expect(await db.collection('salary').countDocuments({ userId: USER_A })).toBe(15);
    expect(await db.collection('salary').findOne({ userId: USER_A, month: '2024-01' })).toBeNull();
    const events = await db.collection('audit_logs').find({ subjectUserId: USER_A }).toArray();
    expect(events.find(e => e.action === 'retention_pruned')).toMatchObject({ resource: 'salary', resourceKey: '2024-01', actorType: 'system' });
    expect(events.find(e => e.action === 'created')).toMatchObject({ resourceKey: '2025-04', actorType: 'user' });
  });
});

describe('/api/audit-logs', () => {
  const seed = async (n: number, userId = USER_A, startMs = Date.now() - 1000 * 60 * 60) => {
    await db.collection('audit_logs').insertMany(Array.from({ length: n }, (_, i) => {
      const t = new Date(startMs + i * 1000);
      return {
        eventId: `ev-${userId}-${String(i).padStart(4, '0')}`,
        subjectUserId: userId, actorType: 'user', actorUserId: userId, source: 'salary',
        resource: 'salary', action: 'updated', changedFields: ['income'],
        occurredAt: t.toISOString(), occurredAtDate: t
      };
    }));
  };

  it('requires a session and is GET only', async () => {
    expect((await call(audit, { userId: null })).status).toBe(401);
    expect((await call(audit, { method: 'POST' })).status).toBe(405);
  });

  it('isolates users: each user sees only their own history; query userId is ignored', async () => {
    await seed(3, USER_A);
    await seed(2, USER_B);
    const a = await call(audit, { userId: USER_A, query: { userId: USER_B } });
    expect(a.data.items).toHaveLength(3);
    const b = await history(USER_B);
    expect(b.data.items).toHaveLength(2);
    expect(JSON.stringify(a.data)).not.toContain(USER_B);
  });

  it('defaults to 50, caps at 100, newest first, and cursor pagination covers all rows with no duplicates', async () => {
    await seed(120);
    const first = await history();
    expect(first.data.items).toHaveLength(50);
    expect(first.data.nextCursor).toBeTruthy();
    const times = first.data.items.map((i: { occurredAt: string }) => i.occurredAt);
    expect([...times].sort().reverse()).toEqual(times);
    const big = await history(USER_A, { limit: '500' });
    expect(big.data.items).toHaveLength(100);
    const ids = new Set<string>();
    let cursor: string | null = null;
    do {
      const page: { data: { items: { eventId: string }[]; nextCursor: string | null } } = await history(USER_A, { limit: '30', ...(cursor ? { cursor } : {}) });
      page.data.items.forEach(i => ids.add(i.eventId));
      cursor = page.data.nextCursor;
    } while (cursor);
    expect(ids.size).toBe(120);
  });

  it('rejects invalid pagination parameters', async () => {
    expect((await history(USER_A, { limit: '0' })).status).toBe(400);
    expect((await history(USER_A, { limit: 'abc' })).status).toBe(400);
    expect((await history(USER_A, { cursor: '%%%' })).status).toBe(400);
  });

  it('hides events older than 365 days and never exposes internal fields', async () => {
    await seed(1, USER_A, Date.now() - 366 * 86400000);
    await seed(1, USER_A);
    const { data } = await history();
    expect(data.items).toHaveLength(1);
    expect(Object.keys(data.items[0]).sort()).toEqual(['action', 'actorType', 'changedFields', 'eventId', 'occurredAt', 'resource', 'source']);
  });

  it('declares a 365-day TTL index on the journal', async () => {
    await postSalary('2026-03');
    const idx = await db.collection('audit_logs').indexes();
    expect(idx.some(i => i.expireAfterSeconds === 365 * 86400)).toBe(true);
  });
});
