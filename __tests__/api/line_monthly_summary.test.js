/** @jest-environment node */
// Integration test against a real (ephemeral, in-process) MongoDB instance — follows the same
// pattern as __tests__/api/user-bank-accounts.test.js (see .pipeline/spec-test-suite-foundation.md).
//
// Only the actual outbound LINE HTTP call (global `fetch`, used inside sendLineMessage.ts) is mocked.
// Everything else — auth, Mongo reads/writes, month-end gating, dedup marker — runs against real
// modules, per this project's DB-mocking objection (mock the third-party network call, not the DB).
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMocks } from 'node-mocks-http';

const TEST_CRON_SECRET = 'test-cron-secret';
const TEST_USER_ID = 'user-a';
const OTHER_USER_ID = 'user-b';

let mongod;
let handler;
let getDbPromise;
let db;
let fetchMock;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();

  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';
  process.env.CRON_SECRET = TEST_CRON_SECRET;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-line-token';
  process.env.LINE_CHANNEL_USER_ID = '';

  jest.resetModules();

  fetchMock = jest.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }));
  handler = require('../../pages/api/line_monthly_summary').default;
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
    // Insert minimal per-user financial docs so buildMonthlySummaryPayload has something to read.
    await db.collection('monthly_income').deleteMany({});
    await db.collection('monthly_expense').deleteMany({});
    await db.collection('savings').deleteMany({});
    await db.collection('salary').deleteMany({});
    await db.collection('daily_expenses').deleteMany({});
    await db.collection('tax_accumulated').deleteMany({});
    await db.collection('savingsGoals').deleteMany({});
    await db.collection('credit_cards').deleteMany({});
  }
});

function makeReqRes({ method = 'POST', query = {}, body, headers = {}, token = TEST_CRON_SECRET } = {}) {
  return createMocks({
    method,
    query,
    body,
    headers: { authorization: `Bearer ${token}`, ...headers }
  });
}

function mockLineSuccess() {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({})
  });
}

describe('/api/line_monthly_summary (Mongo mode)', () => {
  describe('AC-3: auth (CRON_SECRET only, fail closed)', () => {
    it('rejects a request with no Authorization header', async () => {
      const { req, res } = createMocks({ method: 'POST', body: { date: '2024-01-31' } });
      await handler(req, res);
      expect(res._getStatusCode()).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('accepts the CRON_SECRET as a Bearer token', async () => {
      const { req, res } = makeReqRes({ body: { date: '2024-01-15' }, token: TEST_CRON_SECRET });
      await handler(req, res);
      expect(res._getStatusCode()).toBe(200);
    });

    it('rejects a wrong secret with 401', async () => {
      const { req, res } = makeReqRes({ body: { date: '2024-01-15' }, token: 'wrong' });
      await handler(req, res);
      expect(res._getStatusCode()).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails closed with 500 when CRON_SECRET is not configured', async () => {
      const saved = process.env.CRON_SECRET;
      process.env.CRON_SECRET = '';
      try {
        const { req, res } = makeReqRes({ body: { date: '2024-01-15' } });
        await handler(req, res);
        expect(res._getStatusCode()).toBe(500);
      } finally {
        process.env.CRON_SECRET = saved;
      }
    });

    it('rejects an unsupported HTTP method', async () => {
      const { req, res } = makeReqRes({ method: 'DELETE', body: {} });
      await handler(req, res);
      expect(res._getStatusCode()).toBe(405);
    });
  });

  describe('AC-1: per-user isolation', () => {
    it('keeps sending to the remaining users when one user throws', async () => {
      // user แรกมี id ว่าง → assertUserScope โยน error ในรอบของตัวเอง (ข้อมูลพังจริง ไม่ใช่ mock)
      await db.collection('users').insertMany([
        { id: ' ', LineId: 'line-1', monthlySummaryEnabled: true },
        { id: 'user-2', LineId: 'line-2', monthlySummaryEnabled: true },
        { id: 'user-3', LineId: 'line-3', monthlySummaryEnabled: true }
      ]);
      mockLineSuccess();

      const { req, res } = makeReqRes({ body: { date: '2024-01-31' } });
      await handler(req, res);

      expect(res._getStatusCode()).toBe(200);
      const { results } = JSON.parse(res._getData());
      expect(results).toHaveLength(3);
      expect(results[0]).toMatchObject({ userId: ' ', sent: false });
      expect(results.filter(r => r.sent).map(r => r.userId)).toEqual(['user-2', 'user-3']);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('AC-2: outbound retry', () => {
    const seed = () => db.collection('users').insertOne({ id: TEST_USER_ID, LineId: 'line-a', monthlySummaryEnabled: true });
    const run = async () => {
      const { req, res } = makeReqRes({ body: { date: '2024-01-31', userId: TEST_USER_ID } });
      await handler(req, res);
      return JSON.parse(res._getData()).results[0];
    };

    it('retries once on 5xx and succeeds', async () => {
      await seed();
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
      expect(await run()).toMatchObject({ sent: true, format: 'flex' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry on 4xx for the same message', async () => {
      await seed();
      fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
      await run();
      // flex (1 attempt) + text fallback (1 attempt), no retries
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('retries once after a network error', async () => {
      await seed();
      fetchMock
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
      expect(await run()).toMatchObject({ sent: true, format: 'flex' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('gives up after the second 5xx and does not mark sent', async () => {
      await seed();
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
      expect(await run()).toMatchObject({ sent: false });
      // flex: 2 attempts, text fallback: 2 attempts
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect((await db.collection('users').findOne({ id: TEST_USER_ID })).lastMonthlySummarySent).toBeUndefined();
    });
  });

  describe('AC-1: non-last-day-of-month gating', () => {
    it('returns skipped and never calls LINE when the date is not the last day of the month', async () => {
      await db.collection('users').insertOne({ id: TEST_USER_ID, LineId: 'line-a', monthlySummaryEnabled: true });

      const { req, res } = makeReqRes({ body: { date: '2024-01-15' } });
      await handler(req, res);

      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data).toEqual({ success: true, skipped: true, reason: 'not the last day of the month' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('proceeds (does not skip) when the date is the last day of the month', async () => {
      await db.collection('users').insertOne({ id: TEST_USER_ID, LineId: 'line-a', monthlySummaryEnabled: true });
      mockLineSuccess();

      // 2024-01-31 is the last day of January.
      const { req, res } = makeReqRes({ body: { date: '2024-01-31', userId: TEST_USER_ID } });
      await handler(req, res);

      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.skipped).toBeUndefined();
      expect(data.month).toBe('2024-01');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('force sends one targeted user outside month-end without changing that month\'s dedup marker', async () => {
      await db.collection('users').insertOne({
        id: TEST_USER_ID,
        LineId: 'line-a',
        monthlySummaryEnabled: true,
        lastMonthlySummarySent: '2024-01'
      });
      mockLineSuccess();

      const { req, res } = makeReqRes({ body: { date: '2024-01-15', userId: TEST_USER_ID, force: true } });
      await handler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.results).toEqual([expect.objectContaining({ userId: TEST_USER_ID, sent: true, forced: true })]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((await db.collection('users').findOne({ id: TEST_USER_ID })).lastMonthlySummarySent).toBe('2024-01');
    });

    it('rejects force mode without an explicit userId', async () => {
      const { req, res } = makeReqRes({ body: { date: '2024-01-15', force: true } });
      await handler(req, res);

      expect(res._getStatusCode()).toBe(400);
      expect(JSON.parse(res._getData())).toEqual({ error: 'force requires a userId' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('AC-3: preference off / no LINE ID', () => {
    it('does not send to a user with monthlySummaryEnabled: false', async () => {
      await db.collection('users').insertOne({ id: TEST_USER_ID, LineId: 'line-a', monthlySummaryEnabled: false });

      const { req, res } = makeReqRes({ body: { date: '2024-01-31', userId: TEST_USER_ID } });
      await handler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.results).toEqual([{ userId: TEST_USER_ID, sent: false, reason: 'monthly summary disabled' }]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('excludes a user with no LineId from recipients entirely (no result entry, no LINE call)', async () => {
      await db.collection('users').insertOne({ id: TEST_USER_ID, monthlySummaryEnabled: true });

      const { req, res } = makeReqRes({ body: { date: '2024-01-31', userId: TEST_USER_ID } });
      await handler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.results).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('uses the stored LineId as the push recipient (not a global default)', async () => {
      await db.collection('users').insertOne({ id: TEST_USER_ID, LineId: 'stored-line-id', monthlySummaryEnabled: true });
      mockLineSuccess();

      const { req, res } = makeReqRes({ body: { date: '2024-01-31', userId: TEST_USER_ID } });
      await handler(req, res);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, options] = fetchMock.mock.calls[0];
      const sentBody = JSON.parse(options.body);
      expect(sentBody.to).toBe('stored-line-id');
    });
  });

  describe('AC-4: dedup marker', () => {
    it('does not resend to a user already marked sent for that month', async () => {
      await db.collection('users').insertOne({
        id: TEST_USER_ID,
        LineId: 'line-a',
        monthlySummaryEnabled: true,
        lastMonthlySummarySent: '2024-01'
      });

      const { req, res } = makeReqRes({ body: { date: '2024-01-31', userId: TEST_USER_ID } });
      await handler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.results).toEqual([{ userId: TEST_USER_ID, sent: false, reason: 'monthly summary already sent' }]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('marks the user sent only after a successful LINE push, and only for that month', async () => {
      await db.collection('users').insertOne({ id: TEST_USER_ID, LineId: 'line-a', monthlySummaryEnabled: true });
      mockLineSuccess();

      const { req, res } = makeReqRes({ body: { date: '2024-01-31', userId: TEST_USER_ID } });
      await handler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.results[0]).toMatchObject({ userId: TEST_USER_ID, sent: true, month: '2024-01' });

      const userDoc = await db.collection('users').findOne({ id: TEST_USER_ID });
      expect(userDoc.lastMonthlySummarySent).toBe('2024-01');
    });
  });

  describe('AC-5: Flex payload with text fallback', () => {
    it('sends a flex message on success and reports format: flex', async () => {
      await db.collection('users').insertOne({ id: TEST_USER_ID, LineId: 'line-a', monthlySummaryEnabled: true });
      mockLineSuccess();

      const { req, res } = makeReqRes({ body: { date: '2024-01-31', userId: TEST_USER_ID } });
      await handler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.results[0]).toMatchObject({ sent: true, format: 'flex' });

      const [, options] = fetchMock.mock.calls[0];
      const sentBody = JSON.parse(options.body);
      expect(sentBody.messages[0].type).toBe('flex');
    });

    it('falls back to a plain-text push when the Flex send fails, and still marks sent', async () => {
      await db.collection('users').insertOne({ id: TEST_USER_ID, LineId: 'line-a', monthlySummaryEnabled: true });

      // First call (flex) fails, second call (text fallback) succeeds.
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ message: 'invalid flex' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      const { req, res } = makeReqRes({ body: { date: '2024-01-31', userId: TEST_USER_ID } });
      await handler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.results[0]).toMatchObject({ sent: true, format: 'text-fallback' });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const [, firstOptions] = fetchMock.mock.calls[0];
      expect(JSON.parse(firstOptions.body).messages[0].type).toBe('flex');
      const [, secondOptions] = fetchMock.mock.calls[1];
      expect(JSON.parse(secondOptions.body).messages[0].type).toBe('text');

      const userDoc = await db.collection('users').findOne({ id: TEST_USER_ID });
      expect(userDoc.lastMonthlySummarySent).toBe('2024-01');
    });

    it('does not mark sent when both flex and text fallback fail', async () => {
      await db.collection('users').insertOne({ id: TEST_USER_ID, LineId: 'line-a', monthlySummaryEnabled: true });
      fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'down' }) });

      const { req, res } = makeReqRes({ body: { date: '2024-01-31', userId: TEST_USER_ID } });
      await handler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.results[0]).toMatchObject({ sent: false });

      const userDoc = await db.collection('users').findOne({ id: TEST_USER_ID });
      expect(userDoc.lastMonthlySummarySent).toBeUndefined();
    });
  });

  describe('AC-2 / user isolation: only the targeted user is processed and read', () => {
    it('only sends to the requested userId, leaving other eligible users untouched', async () => {
      await db.collection('users').insertMany([
        { id: TEST_USER_ID, LineId: 'line-a', monthlySummaryEnabled: true },
        { id: OTHER_USER_ID, LineId: 'line-b', monthlySummaryEnabled: true }
      ]);
      mockLineSuccess();

      const { req, res } = makeReqRes({ body: { date: '2024-01-31', userId: TEST_USER_ID } });
      await handler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.results).toHaveLength(1);
      expect(data.results[0].userId).toBe(TEST_USER_ID);

      const otherUserDoc = await db.collection('users').findOne({ id: OTHER_USER_ID });
      expect(otherUserDoc.lastMonthlySummarySent).toBeUndefined();
    });

    it('processes all eligible users when no userId is specified', async () => {
      await db.collection('users').insertMany([
        { id: TEST_USER_ID, LineId: 'line-a', monthlySummaryEnabled: true },
        { id: OTHER_USER_ID, LineId: 'line-b', monthlySummaryEnabled: true }
      ]);
      mockLineSuccess();

      const { req, res } = makeReqRes({ body: { date: '2024-01-31' } });
      await handler(req, res);

      const data = JSON.parse(res._getData());
      expect(data.results.map(r => r.userId).sort()).toEqual([TEST_USER_ID, OTHER_USER_ID].sort());
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('getRecipients type guard (hardening: .pipeline/spec-line-monthly-summary-hardening.md)', () => {
    it('treats a blank (whitespace-only) userId as matching nobody, via the shared assertScopedUserId guard (C-4)', async () => {
      await db.collection('users').insertOne({ id: TEST_USER_ID, LineId: 'line-a', monthlySummaryEnabled: true });
      const { req, res } = makeReqRes({ body: { date: '2024-01-31', userId: '   ' } });
      await handler(req, res);
      expect(JSON.parse(res._getData()).results).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('treats a non-string userId as matching nobody instead of leaking Mongo-filter behavior', async () => {
      await db.collection('users').insertMany([
        { id: TEST_USER_ID, LineId: 'line-a', monthlySummaryEnabled: true },
        { id: OTHER_USER_ID, LineId: 'line-b', monthlySummaryEnabled: true }
      ]);

      // A Mongo-operator-shaped object is exactly the crafted-input risk the guard closes:
      // without it, `filter = { id: { $ne: null } }` would match every user with a LineId.
      const { req, res } = makeReqRes({ body: { date: '2024-01-31', userId: { $ne: null } } });
      await handler(req, res);

      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.results).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
