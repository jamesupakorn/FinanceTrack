/** @jest-environment node */
// Focused regression test for the `getUsersForNotify` non-string `userId` type guard added in
// .pipeline/spec-line-monthly-summary-hardening.md (twin fix to getRecipients() in
// pages/api/line_monthly_summary.js — see __tests__/api/line_monthly_summary.test.js for the
// sibling test and rationale). Follows the same real-Mongo-instance pattern as that file rather
// than mocking the DB.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMocks } from 'node-mocks-http';

const TEST_TOKEN = 'test-token';
const TEST_CRON_SECRET = 'test-cron-secret';
const TEST_USER_ID = 'user-a';

jest.mock('node-fetch', () => jest.fn());

let mongod;
let handler;
let getDbPromise;
let db;
let fetchMock;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();

  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';
  process.env.API_ACCESS_TOKEN = TEST_TOKEN;
  process.env.CRON_SECRET = TEST_CRON_SECRET;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-line-token';
  process.env.LINE_CHANNEL_USER_ID = '';
  delete process.env.API_ACCESS_TOKEN_ENCRYPTED;
  delete process.env.API_ACCESS_TOKEN_ENCRYPTION_KEY;
  delete process.env.API_ACCESS_TOKEN_B64;
  delete process.env.API_TOKEN_B64;
  delete process.env.API_TOKEN;

  jest.resetModules();

  fetchMock = require('node-fetch');
  handler = require('../../pages/api/line_due_notify').default;
  ({ getDbPromise } = require('../../lib/mongodb'));
  db = await getDbPromise();
}, 60000);

afterAll(async () => {
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

function makeReqRes({ method = 'POST', query = {}, body, headers = {}, token = TEST_TOKEN } = {}) {
  return createMocks({
    method,
    query,
    body,
    headers: { authorization: `Bearer ${token}`, ...headers }
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
