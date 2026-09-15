/** @jest-environment node */
// Integration test against a real (ephemeral, in-process) MongoDB instance for every test case
// except the isolated loadUsers()-throws -> 500 case below (see that describe block for why a
// jest.mock('../../lib/userStore') is the one sanctioned exception here, per
// .pipeline/spec-td-c01-api-coverage-8.md and CODING_STANDARD.md's "mock a collaborator, not the
// DB" carve-out).
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMocks } from 'node-mocks-http';

let mongod;
let handler;
let getDbPromise;
let db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();

  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';

  jest.resetModules();

  handler = require('../../pages/api/users').default;
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
  if (db) {
    await db.collection('users').deleteMany({});
  }
});

describe('/api/users (Mongo mode, real DB)', () => {
  it('non-GET method (POST) returns 405 with an Allow: [GET] header', async () => {
    const { req, res } = createMocks({ method: 'POST' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    // node-mocks-http lower-cases header names.
    expect(res._getHeaders().allow).toEqual(['GET']);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Method not allowed' });
  });

  it('GET with zero users in the collection returns 200 with { users: [] }', async () => {
    const { req, res } = createMocks({ method: 'GET' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ users: [] });
  });

  it('GET with users present returns 200 with only the id/displayName/avatar allowlist, stripping sensitive fields', async () => {
    await db.collection('users').insertMany([
      {
        id: 'u001',
        displayName: 'สมชาย',
        avatar: '/a1.png',
        passwordHash: 'hash-should-not-leak',
        bankAccounts: ['ธนาคาร A'],
        budgetThresholds: { x: 1 },
        LineId: 'line-secret'
      },
      {
        id: 'u002',
        displayName: 'สมหญิง',
        avatar: '/a2.png',
        passwordHash: 'hash2'
      }
    ]);

    const { req, res } = createMocks({ method: 'GET' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({
      users: [
        { id: 'u001', displayName: 'สมชาย', avatar: '/a1.png' },
        { id: 'u002', displayName: 'สมหญิง', avatar: '/a2.png' }
      ]
    });
  });

  it('GET response sets cache-prevention headers', async () => {
    const { req, res } = createMocks({ method: 'GET' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getHeaders()['cache-control']).toBe('no-store, max-age=0');
    expect(res._getHeaders().pragma).toBe('no-cache');
    expect(res._getHeaders().expires).toBe('0');
  });
});

describe('/api/users (isolated mocked-collaborator test — the one sanctioned exception)', () => {
  // This is the only test in either investment.test.js or users.test.js that mocks a
  // collaborator module. It is scoped to its own describe block via jest.isolateModules so the
  // mock never leaks into the real-DB tests above/below. loadUsers()'s 500 branch cannot be
  // exercised by seeding/withholding real documents — it requires the collaborator to actually
  // throw, which is the class of case CODING_STANDARD.md's "mock a collaborator, not the DB"
  // carve-out exists for.
  it('loadUsers() throwing returns 500 with the exact Thai error body', async () => {
    let isolatedHandler;

    jest.isolateModules(() => {
      jest.doMock('../../lib/userStore', () => ({
        loadUsers: jest.fn().mockRejectedValue(new Error('boom'))
      }));
      isolatedHandler = require('../../pages/api/users').default;
    });

    const { req, res } = createMocks({ method: 'GET' });

    await isolatedHandler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(JSON.parse(res._getData())).toEqual({ error: 'ไม่สามารถโหลดรายชื่อผู้ใช้ได้' });

    // Ensure the mock does not leak into any other test in this file (or process).
    jest.dontMock('../../lib/userStore');
  });
});
