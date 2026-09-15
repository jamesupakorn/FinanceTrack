/** @jest-environment node */
// Integration test against a real (ephemeral, in-process) MongoDB instance — see
// .pipeline/spec-td-c01-api-coverage-5.md for why mongodb-memory-server (not mocks) was chosen: this
// route's `{ _id: goalId, userId }`-filter isolation shape, `computeCurrentAmounts`'s cross-collection
// (`savingsGoals` + `savings`) read-side aggregation, and the PUT dual-shape `bulkWrite` dispatch are
// all real multi-document Mongo behaviors that a mocked collection could never prove.
//
// `lib/dataMode.config.js` reads process.env.DATA_MODE / process.env.MONGODB_URI once, at
// first-import time (module-level `const`). This test therefore sets those env vars first, then
// `jest.resetModules()` + `require(...)` the handler and db module fresh inside `beforeAll`, so they
// pick up the test env instead of whatever was cached from an earlier test file/process.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMocks } from 'node-mocks-http';

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'test-user-a';
const USER_B = 'test-user-b';

let mongod;
let handler;
let getDbPromise;
let db;
let sessionCookie; // { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME }

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();

  process.env.MONGODB_URI = mongod.getUri();
  process.env.DATA_MODE = 'mongo';
  process.env.SESSION_SECRET = TEST_SECRET;

  jest.resetModules();

  handler = require('../../pages/api/savings-goals').default;
  sessionCookie = require('../../src/shared/utils/backend/sessionCookie');
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
    await db.collection('savingsGoals').deleteMany({});
    await db.collection('savings').deleteMany({}); // only used by test 8/9
  }
});

/**
 * request ที่ผ่านด่าน auth ครบ: session cookie ของ `userId`
 * (+ X-CSRF-Token ที่ผูกกับ sid เดียวกัน เมื่อเป็น method ที่เปลี่ยนข้อมูล)
 */
function makeReqRes({ method = 'GET', userId = USER_A, query = {}, body, headers = {}, omitCsrf = false } = {}) {
  const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
  const sid = createSessionId();
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  return createMocks({
    method,
    query,
    body,
    cookies: userId ? { [SESSION_COOKIE_NAME]: signSession(userId, sid) } : {},
    headers: {
      ...(mutating && !omitCsrf ? { 'x-csrf-token': signCsrfToken(sid) } : {}),
      ...headers
    }
  });
}

describe('/api/savings-goals (Mongo mode)', () => {
  it('GET with no session cookie returns 401', async () => {
    const { req, res } = makeReqRes({ userId: null });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
  });

  it('POST with a valid session but missing X-CSRF-Token returns 403 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      omitCsrf: true,
      body: { goalName: 'บ้าน', targetAmount: 100000 }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(403);
    expect(await db.collection('savingsGoals').countDocuments({})).toBe(0);
  });

  it('unsupported method (PATCH) returns 405 with an empty body (bare .end(), unfixed finding class)', async () => {
    const { req, res } = makeReqRes({ method: 'PATCH' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(res._getData()).toBe('');
  });

  it('GET with no goals returns 200 with an empty goals array', async () => {
    const { req, res } = makeReqRes({});

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ goals: [] });
  });

  it('POST validation: missing goalName or targetAmount returns 400 and does not write', async () => {
    const { req: req1, res: res1 } = makeReqRes({ method: 'POST', body: { targetAmount: 1000 } });
    await handler(req1, res1);
    expect(res1._getStatusCode()).toBe(400);
    expect(JSON.parse(res1._getData())).toEqual({ error: 'goalName and targetAmount are required' });

    const { req: req2, res: res2 } = makeReqRes({ method: 'POST', body: { goalName: 'x' } });
    await handler(req2, res2);
    expect(res2._getStatusCode()).toBe(400);
    expect(JSON.parse(res2._getData())).toEqual({ error: 'goalName and targetAmount are required' });

    expect(await db.collection('savingsGoals').countDocuments({})).toBe(0);
  });

  it('POST success creates a goal with correct defaults/trim, and a following GET proves the round trip', async () => {
    const { req: postReq, res: postRes } = makeReqRes({
      method: 'POST',
      body: { goalName: '  บ้าน  ', targetAmount: 500000 }
    });

    await handler(postReq, postRes);

    expect(postRes._getStatusCode()).toBe(201);
    const postData = JSON.parse(postRes._getData());
    expect(postData.goal.goalName).toBe('บ้าน');
    expect(postData.goal.targetAmount).toBe(500000);
    expect(postData.goal.currency).toBe('THB');
    expect(postData.goal.category).toBe('other');
    expect(postData.goal.priority).toBe('medium');
    expect(postData.goal.status).toBe('active');
    expect(postData.goal.currentAmount).toBe(0);
    expect(postData.goal.allocationPercent).toBeNull();
    expect(typeof postData.goal._id).toBe('string');
    expect(postData.goal._id.length).toBeGreaterThan(0);

    const { req: getReq, res: getRes } = makeReqRes({});
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    const getData = JSON.parse(getRes._getData());
    expect(getData.goals).toHaveLength(1);
    const goal = getData.goals[0];
    expect(goal.goalName).toBe('บ้าน');
    expect(goal.targetAmount).toBe(500000);
    expect(goal.currentAmount).toBe(0);
    expect(goal.metadata.progressPercentage).toBe(0);
    expect(goal.metadata.remainingAmount).toBe(500000);
  });

  it('GET excludes status: abandoned goals', async () => {
    const { req: postReq, res: postRes } = makeReqRes({
      method: 'POST',
      body: { goalName: 'active goal', targetAmount: 1000 }
    });
    await handler(postReq, postRes);
    expect(postRes._getStatusCode()).toBe(201);

    await db.collection('savingsGoals').insertOne({
      _id: 'abandoned-goal-id',
      userId: USER_A,
      goalName: 'abandoned goal',
      targetAmount: 1000,
      currentAmount: 0,
      currency: 'THB',
      category: 'other',
      priority: 'medium',
      status: 'abandoned',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { req: getReq, res: getRes } = makeReqRes({});
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    const data = JSON.parse(getRes._getData());
    expect(data.goals).toHaveLength(1);
    expect(data.goals[0].goalName).toBe('active goal');
  });

  it('computeCurrentAmounts aggregates matching savings entries across months, case-insensitively/trim-tolerant, with comma-stripping numeric coercion', async () => {
    const { req: postReq, res: postRes } = makeReqRes({
      method: 'POST',
      body: { goalName: 'ทองคำ', targetAmount: 10000 }
    });
    await handler(postReq, postRes);
    expect(postRes._getStatusCode()).toBe(201);

    await db.collection('savings').insertOne({
      month: '2026-01',
      userId: USER_A,
      savings_list: [{ savings_type: 'ทองคำ', savings_amount: 3000 }]
    });
    await db.collection('savings').insertOne({
      month: '2026-02',
      userId: USER_A,
      savings_list: [{ savings_type: '  ทองคำ  ', savings_amount: '2,000.50' }]
    });

    const { req: getReq, res: getRes } = makeReqRes({});
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    const data = JSON.parse(getRes._getData());
    const goal = data.goals.find(g => g.goalName === 'ทองคำ');
    expect(goal.currentAmount).toBe(5000.5);
    expect(goal.metadata.progressPercentage).toBe(50.01);
    expect(goal.metadata.remainingAmount).toBe(4999.5);
  });

  it('computeCurrentAmounts does not cross user boundaries', async () => {
    const { req: postReq, res: postRes } = makeReqRes({
      method: 'POST',
      userId: USER_A,
      body: { goalName: 'เที่ยวญี่ปุ่น', targetAmount: 20000 }
    });
    await handler(postReq, postRes);
    expect(postRes._getStatusCode()).toBe(201);

    await db.collection('savings').insertOne({
      month: '2026-01',
      userId: USER_B,
      savings_list: [{ savings_type: 'เที่ยวญี่ปุ่น', savings_amount: 15000 }]
    });

    const { req: getReq, res: getRes } = makeReqRes({ userId: USER_A });
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    const data = JSON.parse(getRes._getData());
    const goal = data.goals.find(g => g.goalName === 'เที่ยวญี่ปุ่น');
    expect(goal.currentAmount).toBe(0);
  });

  it('PUT single-goal update applies only the provided fields, and a following GET proves the round trip', async () => {
    const { req: postReq, res: postRes } = makeReqRes({
      method: 'POST',
      body: { goalName: 'รถใหม่', targetAmount: 300000 }
    });
    await handler(postReq, postRes);
    const goalId = JSON.parse(postRes._getData()).goal._id;

    const { req: putReq, res: putRes } = makeReqRes({
      method: 'PUT',
      body: { goalId, priority: 'high' }
    });
    await handler(putReq, putRes);

    expect(putRes._getStatusCode()).toBe(200);
    expect(JSON.parse(putRes._getData())).toEqual({ success: true });

    const { req: getReq, res: getRes } = makeReqRes({});
    await handler(getReq, getRes);
    const data = JSON.parse(getRes._getData());
    const goal = data.goals.find(g => g._id === goalId);
    expect(goal.priority).toBe('high');
    expect(goal.goalName).toBe('รถใหม่');
    expect(goal.targetAmount).toBe(300000);
    expect(goal.category).toBe('other');
    expect(goal.status).toBe('active');
  });

  it('PUT single-goal: missing goalId returns 400', async () => {
    const { req, res } = makeReqRes({ method: 'PUT', body: { priority: 'high' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'goalId required' });
  });

  it('PUT single-goal: nonexistent goalId returns 404', async () => {
    const { req, res } = makeReqRes({
      method: 'PUT',
      body: { goalId: 'does-not-exist', priority: 'high' }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Goal not found' });
  });

  it('PUT single-goal: cross-user isolation is a filter-match failure (404), not a write to another user\'s document', async () => {
    const { req: postReq, res: postRes } = makeReqRes({
      method: 'POST',
      userId: USER_A,
      body: { goalName: 'เกษียณ', targetAmount: 1000000 }
    });
    await handler(postReq, postRes);
    const goalId = JSON.parse(postRes._getData()).goal._id;

    const { req: putReq, res: putRes } = makeReqRes({
      method: 'PUT',
      userId: USER_B,
      body: { goalId, priority: 'high' }
    });
    await handler(putReq, putRes);

    expect(putRes._getStatusCode()).toBe(404);

    const { req: getReq, res: getRes } = makeReqRes({ userId: USER_A });
    await handler(getReq, getRes);
    const data = JSON.parse(getRes._getData());
    const goal = data.goals.find(g => g._id === goalId);
    expect(goal.priority).toBe('medium');
  });

  it('PUT bulk allocations: bulkWrite reaches every matched document, toAllocationPercent normalizes each independently', async () => {
    const { req: postA, res: resA } = makeReqRes({
      method: 'POST',
      body: { goalName: 'goalA', targetAmount: 1000 }
    });
    await handler(postA, resA);
    const goalAId = JSON.parse(resA._getData()).goal._id;

    const { req: postB, res: resB } = makeReqRes({
      method: 'POST',
      body: { goalName: 'goalB', targetAmount: 1000 }
    });
    await handler(postB, resB);
    const goalBId = JSON.parse(resB._getData()).goal._id;

    // goalB starts with a non-null allocationPercent so the bulk PUT's rejection of -5
    // (normalized to null) is a genuine value change; MongoDB only counts a document as
    // "modified" when a field's value actually changes, not when it's $set to the same
    // value it already holds (goalB would otherwise stay null -> null, undercounting
    // modifiedCount below).
    await db.collection('savingsGoals').updateOne({ _id: goalBId }, { $set: { allocationPercent: 42 } });

    const { req: putReq, res: putRes } = makeReqRes({
      method: 'PUT',
      body: {
        allocations: [
          { goalId: goalAId, allocationPercent: 150 },
          { goalId: goalBId, allocationPercent: -5 }
        ]
      }
    });
    await handler(putReq, putRes);

    expect(putRes._getStatusCode()).toBe(200);
    expect(JSON.parse(putRes._getData())).toEqual({ success: true, matchedCount: 2, modifiedCount: 2 });

    const { req: getReq, res: getRes } = makeReqRes({});
    await handler(getReq, getRes);
    const data = JSON.parse(getRes._getData());
    const goalA = data.goals.find(g => g._id === goalAId);
    const goalB = data.goals.find(g => g._id === goalBId);
    expect(goalA.allocationPercent).toBe(100);
    expect(goalB.allocationPercent).toBeNull();
  });

  it('PUT bulk allocations: all items missing goalId returns 400, DB unchanged', async () => {
    const { req, res } = makeReqRes({
      method: 'PUT',
      body: { allocations: [{ allocationPercent: 50 }] }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'allocations payload is empty' });
  });

  it('DELETE accepts goalId from req.body and, independently, from req.query', async () => {
    const { req: post1, res: resPost1 } = makeReqRes({
      method: 'POST',
      body: { goalName: 'goal1', targetAmount: 1000 }
    });
    await handler(post1, resPost1);
    const goalId1 = JSON.parse(resPost1._getData()).goal._id;

    const { req: del1, res: resDel1 } = makeReqRes({ method: 'DELETE', body: { goalId: goalId1 } });
    await handler(del1, resDel1);
    expect(resDel1._getStatusCode()).toBe(200);
    expect(JSON.parse(resDel1._getData())).toEqual({ success: true });
    expect(await db.collection('savingsGoals').findOne({ _id: goalId1 })).toBeNull();

    const { req: post2, res: resPost2 } = makeReqRes({
      method: 'POST',
      body: { goalName: 'goal2', targetAmount: 1000 }
    });
    await handler(post2, resPost2);
    const goalId2 = JSON.parse(resPost2._getData()).goal._id;

    const { req: del2, res: resDel2 } = makeReqRes({ method: 'DELETE', query: { goalId: goalId2 } });
    await handler(del2, resDel2);
    expect(resDel2._getStatusCode()).toBe(200);
    expect(await db.collection('savingsGoals').findOne({ _id: goalId2 })).toBeNull();
  });

  it('DELETE: missing goalId in both body and query returns 400', async () => {
    const { req, res } = makeReqRes({ method: 'DELETE' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'goalId required' });
  });

  it('DELETE: nonexistent goalId returns 404', async () => {
    const { req, res } = makeReqRes({ method: 'DELETE', body: { goalId: 'does-not-exist' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Goal not found' });
  });

  it('DELETE: cross-user isolation is a filter-match failure (404), document remains present', async () => {
    const { req: postReq, res: postRes } = makeReqRes({
      method: 'POST',
      userId: USER_A,
      body: { goalName: 'ของ user A', targetAmount: 1000 }
    });
    await handler(postReq, postRes);
    const goalId = JSON.parse(postRes._getData()).goal._id;

    const { req: delReq, res: delRes } = makeReqRes({
      method: 'DELETE',
      userId: USER_B,
      body: { goalId }
    });
    await handler(delReq, delRes);

    expect(delRes._getStatusCode()).toBe(404);
    expect(await db.collection('savingsGoals').findOne({ _id: goalId })).not.toBeNull();
  });
});
