/** @jest-environment node */
// Integration test against a real (ephemeral, in-process) MongoDB instance — Rationale: mongodb-memory-server (not mocks) was chosen: this
// route's `{ _id: goalId, userId }`-filter isolation shape, `computeCurrentAmounts`'s cross-collection
// (`savingsGoals` + `savings`) read-side aggregation, and the PUT dual-shape `bulkWrite` dispatch are
// all real multi-document Mongo behaviors that a mocked collection could never prove.
//
// `lib/dataMode.config.js` reads process.env.DATA_MODE / process.env.MONGODB_URI once, at
// first-import time (module-level `const`). This test therefore sets those env vars first, then
// `jest.resetModules()` + `require(...)` the handler and db module fresh inside `beforeAll`, so they
// pick up the test env instead of whatever was cached from an earlier test file/process.
import { MongoMemoryServer } from '../helpers/mongoReplSet';
import { createMocks } from 'node-mocks-http';
import type { RequestMethod } from 'node-mocks-http';
import type { Db, Document } from 'mongodb';
import type { NextApiHandler } from 'next';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

declare const jest: typeof import('@jest/globals').jest;

type RequestOptions = {
  method?: RequestMethod;
  userId?: string | null;
  query?: Record<string, string | string[]>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  omitCsrf?: boolean;
};

type GoalResponse = {
  _id: string;
  goalName: string;
  targetAmount: number;
  currentAmount: number;
  allocationPercent: number | null;
  priority: string;
  category: string;
  status: string;
  metadata: { progressPercentage: number; remainingAmount: number };
};

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'test-user-a';
const USER_B = 'test-user-b';

let mongod: MongoMemoryServer;
let handler: NextApiHandler;
let getDbPromise: typeof import('../../lib/mongodb').getDbPromise;
let db: Db;
let sessionCookie: typeof import('../../src/shared/utils/backend/sessionCookie');

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
function makeReqRes({ method = 'GET', userId = USER_A, query = {}, body, headers = {}, omitCsrf = false }: RequestOptions = {}) {
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

    await db.collection<{ _id: string } & Document>('savingsGoals').insertOne({
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
    const goal = data.goals.find((entry: GoalResponse) => entry.goalName === 'ทองคำ');
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
    const goal = data.goals.find((entry: GoalResponse) => entry.goalName === 'เที่ยวญี่ปุ่น');
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
    const goal = data.goals.find((entry: GoalResponse) => entry._id === goalId);
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
    const goal = data.goals.find((entry: GoalResponse) => entry._id === goalId);
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
    const goalA = data.goals.find((entry: GoalResponse) => entry._id === goalAId);
    const goalB = data.goals.find((entry: GoalResponse) => entry._id === goalBId);
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

// ---- savings-goal-adjustments S1 (spec §4.2, AC-SGA-01…16, architecture-review H-1…H-8) ----

type StoredGoal = Record<string, unknown> & { _id: string };
type AdjustmentErrorCase = [label: string, body: Record<string, unknown>, status: number, error: string];

const ADJ_GOAL_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ADJ_ID = 'adj000000000000000000001';
const SEEDED_AT = '2026-10-01T00:00:00.000Z';
const ADJUSTMENT_KEYS = ['_id', 'amount', 'createdAt', 'note', 'updatedAt'];

// Same table as __tests__/api/savings-goals-adjustments-json.test.ts (mode parity).
const ADJUSTMENT_ERROR_CASES: AdjustmentErrorCase[] = [
  ['unknown action', { action: 'foo', goalId: ADJ_GOAL_ID }, 400, 'unknown action'],
  ['null action', { action: null, goalId: ADJ_GOAL_ID }, 400, 'unknown action'],
  ['missing goalId', { action: 'addAdjustment', amount: 10, note: 'x' }, 400, 'goalId required'],
  ['empty goalId', { action: 'addAdjustment', goalId: '', amount: 10, note: 'x' }, 400, 'goalId required'],
  ['object goalId', { action: 'addAdjustment', goalId: { $ne: null }, amount: 10, note: 'x' }, 400, 'goalId required'],
  ['id alias not accepted', { action: 'addAdjustment', id: ADJ_GOAL_ID, amount: 10, note: 'x' }, 400, 'goalId required'],
  ['edit missing adjustmentId', { action: 'editAdjustment', goalId: ADJ_GOAL_ID, amount: 10, note: 'x' }, 400, 'adjustmentId required'],
  ['delete object adjustmentId', { action: 'deleteAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: { $ne: null } }, 400, 'adjustmentId required'],
  ['zero amount', { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 0, note: 'x' }, 400, 'amount must be a non-zero number'],
  ['dust amount', { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: '0.001', note: 'x' }, 400, 'amount must be a non-zero number'],
  ['non-numeric amount', { action: 'editAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: ADJ_ID, amount: 'abc', note: 'x' }, 400, 'amount must be a non-zero number'],
  ['boolean amount', { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: true, note: 'x' }, 400, 'amount must be a non-zero number'],
  ['overflowing amount (H-4)', { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 1e307, note: 'x' }, 400, 'amount must be a non-zero number'],
  ['amount above cap', { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: -10000000, note: 'x' }, 400, 'amount too large'],
  // tester supplement (Stage 4): cap + H-4 on edit, check order, trimmed length on edit
  ['edit amount above cap', { action: 'editAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: ADJ_ID, amount: '10,000,000', note: 'x' }, 400, 'amount too large'],
  ['edit overflowing amount string (H-4)', { action: 'editAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: ADJ_ID, amount: '1e307', note: 'x' }, 400, 'amount must be a non-zero number'],
  ['huge finite amount hits cap, not overflow', { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 1.7e306, note: 'x' }, 400, 'amount too large'],
  ['cap checked before note', { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 10000000, note: '' }, 400, 'amount too large'],
  ['edit note too long', { action: 'editAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: ADJ_ID, amount: 10, note: '  ' + 'x'.repeat(121) + '  ' }, 400, 'note too long'],
  ['400 before 404: bad amount on unknown goal', { action: 'addAdjustment', goalId: 'bbbbbbbbbbbbbbbbbbbbbbbb', amount: 'abc', note: 'x' }, 400, 'amount must be a non-zero number'],
  ['blank note', { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 10, note: '   ' }, 400, 'note required'],
  ['missing note', { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 10 }, 400, 'note required'],
  ['note too long', { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 10, note: 'x'.repeat(121) }, 400, 'note too long'],
  ['unknown goal', { action: 'addAdjustment', goalId: 'bbbbbbbbbbbbbbbbbbbbbbbb', amount: 10, note: 'x' }, 404, 'Goal not found'],
  ['edit unknown adjustment', { action: 'editAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: 'nope', amount: 10, note: 'x' }, 404, 'Adjustment not found'],
  ['delete unknown adjustment', { action: 'deleteAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: 'nope' }, 404, 'Adjustment not found'],
];

describe('/api/savings-goals adjustments (Mongo mode)', () => {
  beforeEach(async () => {
    await db.collection('audit_logs').deleteMany({});
  });

  function seededAdjustment(overrides: Record<string, unknown> = {}) {
    return { _id: ADJ_ID, amount: 500, note: 'ยอดตกหล่น', createdAt: SEEDED_AT, updatedAt: SEEDED_AT, ...overrides };
  }

  /** Same shape Mongo POST writes (stored currentAmount: 0 included), plus optional overrides. */
  async function seedGoal(overrides: Record<string, unknown> = {}, userId = USER_A) {
    await db.collection<StoredGoal>('savingsGoals').insertOne({
      _id: ADJ_GOAL_ID,
      userId,
      goalName: 'ทองคำ',
      targetAmount: 10000,
      currentAmount: 0,
      currency: 'THB',
      category: 'other',
      priority: 'medium',
      status: 'active',
      allocationPercent: null,
      createdAt: new Date(SEEDED_AT),
      updatedAt: new Date(SEEDED_AT),
      metadata: { progressPercentage: 0, remainingAmount: 10000, monthlyContribution: null, estimatedCompletionDate: null },
      ...overrides,
    });
  }

  const readGoal = () => db.collection<StoredGoal>('savingsGoals').findOne({ _id: ADJ_GOAL_ID });

  async function call(body: Record<string, unknown>, userId = USER_A) {
    const { req, res } = makeReqRes({ method: 'PUT', userId, body });
    await handler(req, res);
    const raw = res._getData();
    return { status: res._getStatusCode(), body: raw ? JSON.parse(raw) : null };
  }

  async function getGoal() {
    const { req, res } = makeReqRes({});
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    return JSON.parse(res._getData()).goals.find((g: StoredGoal) => g._id === ADJ_GOAL_ID);
  }

  // --- GET formula ---

  it('AC-SGA-01/04: currentAmount = savings sum + rounded adjustments total; GET returns adjustments + adjustmentsTotal', async () => {
    await seedGoal({ adjustments: [seededAdjustment({ amount: 0.1 }), seededAdjustment({ _id: 'adj2', amount: 0.2 })] });
    await db.collection('savings').insertOne({ month: '2026-01', userId: USER_A, savings_list: [{ savings_type: 'ทองคำ', savings_amount: 3000 }] });

    const goal = await getGoal();
    expect(goal.currentAmount).toBe(3000.3);
    expect(goal.metadata.adjustmentsTotal).toBe(0.3);
    expect(goal.adjustments).toHaveLength(2);
    expect(goal.metadata.progressPercentage).toBe(30);
    expect(goal.metadata.remainingAmount).toBe(10000 - 3000.3);
  });

  it('AC-SGA-03/E-SGA-1: legacy goal (no adjustments) keeps every numeric output and gets [] / 0', async () => {
    await seedGoal();
    await db.collection('savings').insertOne({ month: '2026-01', userId: USER_A, savings_list: [{ savings_type: 'ทองคำ', savings_amount: '2,000.50' }] });

    const goal = await getGoal();
    expect(goal.adjustments).toEqual([]);
    expect(Object.is(goal.metadata.adjustmentsTotal, 0)).toBe(true);
    expect(goal.currentAmount).toBe(2000.5);
    expect(goal.metadata.progressPercentage).toBe(20.01);
    expect(goal.metadata.remainingAmount).toBe(7999.5);
  });

  it('AC-SGA-05: negative currentAmount is not clamped; remaining > target; progress negative', async () => {
    await seedGoal({ adjustments: [seededAdjustment({ amount: -2000 })] });

    const goal = await getGoal();
    expect(goal.currentAmount).toBe(-2000);
    expect(goal.metadata.remainingAmount).toBe(12000);
    expect(goal.metadata.progressPercentage).toBe(-20);
  });

  it('AC-SGA-06 + H-2: junk stored adjustments/metadata.adjustmentsTotal never leak into the response', async () => {
    await seedGoal({
      adjustments: [seededAdjustment({ amount: 100 }), null, 'junk', { _id: '', amount: 5, note: 'x' }, { _id: 'z', amount: 0, note: 'x' }],
      metadata: { adjustmentsTotal: 999, progressPercentage: 0, remainingAmount: 10000 },
    });

    const goal = await getGoal();
    expect(goal.adjustments).toEqual([seededAdjustment({ amount: 100 })]);
    expect(goal.metadata.adjustmentsTotal).toBe(100);
    expect(goal.currentAmount).toBe(100);
  });

  it.each([[null], [{ a: 1 }], ['abc']])('E-SGA-2: non-array stored adjustments %p reads as [] and the next add writes [entry]', async (stored) => {
    await seedGoal({ adjustments: stored });
    expect((await getGoal()).adjustments).toEqual([]);

    const res = await call({ action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 10, note: 'x' });
    expect(res.status).toBe(200);
    expect((await readGoal())?.adjustments).toEqual([res.body.adjustment]);
  });

  // --- actions ---

  it('AC-SGA-07: addAdjustment appends an ISO-stamped entry; GET reflects it', async () => {
    await seedGoal();

    const res = await call({ action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: '1,500.50', note: '  ยอดตกหล่น  ' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const adjustment = res.body.adjustment;
    expect(Object.keys(adjustment).sort()).toEqual(ADJUSTMENT_KEYS);
    expect(adjustment).toMatchObject({ amount: 1500.5, note: 'ยอดตกหล่น' });
    expect(adjustment._id).toMatch(/^[0-9a-f]{24}$/);
    expect(adjustment.createdAt).toBe(adjustment.updatedAt);
    expect(new Date(adjustment.createdAt).toISOString()).toBe(adjustment.createdAt);

    const stored = await readGoal();
    expect(stored?.adjustments).toEqual([adjustment]);
    expect(stored?.updatedAt).toBeInstanceOf(Date);

    const goal = await getGoal();
    expect(goal.currentAmount).toBe(1500.5);
    expect(goal.metadata.adjustmentsTotal).toBe(1500.5);
  });

  it('AC-SGA-08: editAdjustment replaces amount/note only, bumps updatedAt, keeps _id/createdAt/position', async () => {
    const first = seededAdjustment({ _id: 'first' });
    const last = seededAdjustment({ _id: 'last' });
    await seedGoal({ adjustments: [first, seededAdjustment(), last] });

    const res = await call({ action: 'editAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: ADJ_ID, amount: -42.5, note: 'แก้' });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.adjustment).sort()).toEqual(ADJUSTMENT_KEYS);
    expect(res.body.adjustment).toMatchObject({ _id: ADJ_ID, amount: -42.5, note: 'แก้', createdAt: SEEDED_AT });
    expect(res.body.adjustment.updatedAt).not.toBe(SEEDED_AT);
    expect((await readGoal())?.adjustments).toEqual([first, res.body.adjustment, last]);
  });

  it('AC-SGA-09: deleteAdjustment removes exactly that entry and returns { success: true }', async () => {
    const keep = seededAdjustment({ _id: 'keep' });
    await seedGoal({ adjustments: [seededAdjustment(), keep] });

    const res = await call({ action: 'deleteAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: ADJ_ID });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect((await readGoal())?.adjustments).toEqual([keep]);
  });

  it.each(ADJUSTMENT_ERROR_CASES)('AC-SGA-10/13: %s → exact error, document unchanged, no audit event', async (_label, body, status, error) => {
    await seedGoal({ adjustments: [seededAdjustment()] });
    const before = await readGoal();

    const res = await call(body);

    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error });
    expect(await readGoal()).toEqual(before);
    expect(await db.collection('audit_logs').countDocuments({})).toBe(0);
  });

  it('AC-SGA-11: cross-user access → 404 and the owner document is unchanged', async () => {
    await seedGoal({ adjustments: [seededAdjustment()] });
    const before = await readGoal();

    for (const body of [
      { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 10, note: 'x' },
      { action: 'editAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: ADJ_ID, amount: 10, note: 'x' },
      { action: 'deleteAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: ADJ_ID },
    ]) {
      const res = await call(body, USER_B);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Goal not found' });
    }
    expect(await readGoal()).toEqual(before);
  });

  it('AC-SGA-12 + H-1: client extra fields are ignored; only adjustments + updatedAt are written', async () => {
    await seedGoal();
    const before = await readGoal();

    const res = await call({
      action: 'addAdjustment',
      goalId: ADJ_GOAL_ID,
      amount: 100,
      note: 'x',
      currentAmount: 999999,
      _id: 'evil',
      createdAt: '2000-01-01T00:00:00.000Z',
      goalName: 'renamed',
      targetAmount: 1,
      allocations: [{ goalId: ADJ_GOAL_ID, allocationPercent: 50 }],
      adjustmentsTotal: 5,
      metadata: { adjustmentsTotal: 5 },
    });

    expect(res.status).toBe(200);
    expect(res.body.adjustment._id).not.toBe('evil');
    const stored = await readGoal();
    const { adjustments, updatedAt, ...rest } = stored as StoredGoal;
    const { updatedAt: _beforeUpdatedAt, ...beforeRest } = before as StoredGoal;
    expect(rest).toEqual(beforeRest);
    expect(adjustments).toEqual([res.body.adjustment]);
    expect(updatedAt).not.toEqual(_beforeUpdatedAt);
    expect(stored).not.toHaveProperty('adjustmentsTotal');
    expect(stored?.metadata).not.toHaveProperty('adjustmentsTotal');
    expect(stored?.currentAmount).toBe(0);
  });

  it('AC-SGA-14/E-SGA-12: 121st add → 409; edit and delete still work at the cap', async () => {
    const full = Array.from({ length: 120 }, (_, i) => seededAdjustment({ _id: `adj${i}` }));
    await seedGoal({ adjustments: full });
    const before = await readGoal();

    const add = await call({ action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 1, note: 'x' });
    expect(add.status).toBe(409);
    expect(add.body).toEqual({ error: 'adjustment limit reached (120)' });
    expect(await readGoal()).toEqual(before);

    const edit = await call({ action: 'editAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: 'adj7', amount: 2, note: 'y' });
    expect(edit.status).toBe(200);
    const del = await call({ action: 'deleteAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: 'adj7' });
    expect(del.status).toBe(200);
    expect(((await readGoal())?.adjustments as unknown[])).toHaveLength(119);
  });

  it('AC-SGA-15: each successful action writes exactly one savings_goals audit event naming adjustments; failures write none', async () => {
    await seedGoal();
    const events = () => db.collection('audit_logs').find({}).toArray();

    const add = await call({ action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 10, note: 'x' });
    expect(add.status).toBe(200);
    expect(await events()).toHaveLength(1);

    const edit = await call({ action: 'editAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: add.body.adjustment._id, amount: 20, note: 'y' });
    expect(edit.status).toBe(200);
    expect(await events()).toHaveLength(2);

    const failed = await call({ action: 'deleteAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: 'nope' });
    expect(failed.status).toBe(404);
    expect(await events()).toHaveLength(2);

    const del = await call({ action: 'deleteAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: add.body.adjustment._id });
    expect(del.status).toBe(200);

    const all = await events();
    expect(all).toHaveLength(3);
    for (const event of all) {
      expect(event.source).toBe('savings_goals');
      expect(event.changedFields).toContain('adjustments');
    }
    expect(JSON.stringify(all)).not.toContain('"y"');
  });

  it('AC-SGA-16: existing single-goal PUT (no action) behaves as before and leaves adjustments alone', async () => {
    await seedGoal({ adjustments: [seededAdjustment()] });

    const res = await call({ goalId: ADJ_GOAL_ID, goalName: 'ทองคำแท่ง', adjustments: [] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    const stored = await readGoal();
    expect(stored?.goalName).toBe('ทองคำแท่ง');
    expect(stored?.adjustments).toEqual([seededAdjustment()]);
  });

  it('AC-SGA-16: existing allocations bulk PUT (no action) behaves as before', async () => {
    await seedGoal({ adjustments: [seededAdjustment()] });

    const res = await call({ allocations: [{ goalId: ADJ_GOAL_ID, allocationPercent: 40 }] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, matchedCount: 1, modifiedCount: 1 });
    const stored = await readGoal();
    expect(stored?.allocationPercent).toBe(40);
    expect(stored?.adjustments).toEqual([seededAdjustment()]);
  });

  it('E-SGA-14: action + allocations → action runs, allocations ignored', async () => {
    await seedGoal();

    const res = await call({ action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 10, note: 'x', allocations: [{ goalId: ADJ_GOAL_ID, allocationPercent: 40 }] });

    expect(res.status).toBe(200);
    expect(res.body.adjustment.amount).toBe(10);
    expect((await readGoal())?.allocationPercent).toBeNull();
  });

  it('works on a non-active goal (D-SGA-16: no server status check)', async () => {
    await seedGoal({ status: 'completed' });

    const res = await call({ action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 10, note: 'x' });

    expect(res.status).toBe(200);
  });

  // ---- tester supplement (Stage 4) ----

  it('cap boundary: ±9,999,999.99 accepted on add and edit (both signs, comma string)', async () => {
    await seedGoal();

    const add = await call({ action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: '9,999,999.99', note: 'max' });
    expect(add.status).toBe(200);
    expect(add.body.adjustment.amount).toBe(9999999.99);

    const edit = await call({ action: 'editAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: add.body.adjustment._id, amount: -9999999.99, note: 'min' });
    expect(edit.status).toBe(200);
    expect(edit.body.adjustment.amount).toBe(-9999999.99);
    expect((await readGoal())?.adjustments).toEqual([edit.body.adjustment]);
  });

  it('cross-user access writes no audit event', async () => {
    await seedGoal();
    for (const body of [
      { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 10, note: 'x' },
      { action: 'editAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: 'whatever', amount: 10, note: 'x' },
      { action: 'deleteAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: 'whatever' },
    ]) {
      expect((await call(body, USER_B)).status).toBe(404);
    }
    expect(await db.collection('audit_logs').countDocuments({})).toBe(0);
  });
});

// ---- savings-loan-withdrawal S2, dispatch 5 — Mongo-mode coverage for the DELETE
// /api/savings-goals open-loan guard (spec §4.7 step "S2, DELETE", C-S2-4). Mirrors
// __tests__/api/savings-goals-delete-ledger-json.test.ts's 6 cases. Per C-S2-6, this describe
// owns its own beforeEach for the ledger collections (savingsLoans / savingsWithdrawals /
// savingsLedgerGuards) instead of touching the shared top-level beforeEach at :75-80, which only
// clears savingsGoals / savings.
describe('DELETE /api/savings-goals — Mongo mode open-loan guard (S2, C-S2-3/C-S2-4)', () => {
  const DEL_GOAL_ID = 'dddddddddddddddddddddddd';
  const GHOST_GOAL_ID = 'd9d9d9d9d9d9d9d9d9d9d9d9';
  const LOAN_1 = 'e1e1e1e1e1e1e1e1e1e1e1e1';
  const WD_1 = 'f1f1f1f1f1f1f1f1f1f1f1f1';
  const SEEDED_AT = '2026-11-16T00:00:00.000Z';

  beforeEach(async () => {
    await db.collection('savingsLoans').deleteMany({});
    await db.collection('savingsWithdrawals').deleteMany({});
    await db.collection('savingsLedgerGuards').deleteMany({});
  });

  async function seedGoal(id = DEL_GOAL_ID, overrides: Record<string, unknown> = {}) {
    await db.collection<StoredGoal>('savingsGoals').insertOne({
      _id: id,
      userId: USER_A,
      goalName: 'เที่ยว',
      targetAmount: 20000,
      currentAmount: 0,
      currency: 'THB',
      category: 'other',
      priority: 'medium',
      status: 'active',
      allocationPercent: null,
      createdAt: new Date(SEEDED_AT),
      updatedAt: new Date(SEEDED_AT),
      metadata: { progressPercentage: 0, remainingAmount: 20000, monthlyContribution: null, estimatedCompletionDate: null },
      ...overrides,
    });
  }

  async function seedLoan(id: string, overrides: Record<string, unknown> = {}) {
    // `as never`: matches __tests__/helpers/savingsLoansRouteSuite.ts's pattern for inserting a
    // string `_id` into an untyped collection (its default generic requires an ObjectId `_id`).
    await db.collection('savingsLoans').insertOne({
      _id: id,
      userId: USER_A,
      source: { type: 'goal', goalId: DEL_GOAL_ID },
      principalAmount: 1000,
      outstandingAmount: 1000,
      status: 'open',
      note: null,
      createdAt: new Date(SEEDED_AT),
      updatedAt: new Date(SEEDED_AT),
      closedAt: null,
      repayments: [],
      ...overrides,
    } as never);
  }

  async function seedWithdrawal(id: string, overrides: Record<string, unknown> = {}) {
    await db.collection('savingsWithdrawals').insertOne({
      _id: id,
      userId: USER_A,
      source: { type: 'goal', goalId: DEL_GOAL_ID },
      amount: 500,
      note: null,
      createdAt: new Date(SEEDED_AT),
      ...overrides,
    } as never);
  }

  async function del(goalId: string, userId = USER_A) {
    const { req, res } = makeReqRes({ method: 'DELETE', userId, body: { goalId } });
    await handler(req, res);
    const raw = res._getData();
    return { status: res._getStatusCode(), body: raw ? JSON.parse(raw) : null };
  }

  it('a goal with an open loan against it → 409 goal_has_open_loans, goal NOT deleted', async () => {
    await seedGoal();
    await seedLoan(LOAN_1, { outstandingAmount: 750 });

    const r = await del(DEL_GOAL_ID);
    expect(r).toEqual({ status: 409, body: { error: 'goal_has_open_loans', outstanding: 750 } });
    expect(await db.collection<StoredGoal>('savingsGoals').findOne({ _id: DEL_GOAL_ID })).not.toBeNull();
  });

  it('a goal with only a closed loan and a withdrawal (no open loan) → succeeds as before', async () => {
    await seedGoal();
    await seedLoan(LOAN_1, { status: 'closed', outstandingAmount: 0, closedAt: new Date(SEEDED_AT) });
    await seedWithdrawal(WD_1);

    const r = await del(DEL_GOAL_ID);
    expect(r).toEqual({ status: 200, body: { success: true } });
    expect(await db.collection<StoredGoal>('savingsGoals').findOne({ _id: DEL_GOAL_ID })).toBeNull();
  });

  it('S2-F-3 regression: deleting an already-nonexistent goal id returns 404, not 409, even with a stray open loan referencing it', async () => {
    await seedGoal(); // GHOST_GOAL_ID is not a real goal
    await seedLoan(LOAN_1, { source: { type: 'goal', goalId: GHOST_GOAL_ID }, outstandingAmount: 400 });

    const r = await del(GHOST_GOAL_ID);
    expect(r).toEqual({ status: 404, body: { error: 'Goal not found' } });
  });

  it('a goal with no ledger activity at all → succeeds exactly as before (regression guard)', async () => {
    await seedGoal();

    const r = await del(DEL_GOAL_ID);
    expect(r).toEqual({ status: 200, body: { success: true } });
    expect(await db.collection<StoredGoal>('savingsGoals').findOne({ _id: DEL_GOAL_ID })).toBeNull();
  });

  it('a loan sourced from the pool never blocks a goal delete', async () => {
    await seedGoal();
    await seedLoan(LOAN_1, { source: { type: 'pool' } });

    const r = await del(DEL_GOAL_ID);
    expect(r).toEqual({ status: 200, body: { success: true } });
  });

  it('an open loan against a different goal never blocks this goal\'s delete', async () => {
    const OTHER_GOAL_ID = 'c3c3c3c3c3c3c3c3c3c3c3c3';
    await seedGoal(DEL_GOAL_ID);
    await seedGoal(OTHER_GOAL_ID, { goalName: 'อื่น' });
    await seedLoan(LOAN_1, { source: { type: 'goal', goalId: OTHER_GOAL_ID } });

    const r = await del(DEL_GOAL_ID);
    expect(r).toEqual({ status: 200, body: { success: true } });
    expect(await db.collection<StoredGoal>('savingsGoals').findOne({ _id: DEL_GOAL_ID })).toBeNull();
    expect(await db.collection<StoredGoal>('savingsGoals').findOne({ _id: OTHER_GOAL_ID })).not.toBeNull();
  });

  it('an abandoned goal with an open loan still returns 409 (status filter does not bypass the guard)', async () => {
    await seedGoal(DEL_GOAL_ID, { status: 'abandoned' });
    await seedLoan(LOAN_1, { outstandingAmount: 300 });

    const r = await del(DEL_GOAL_ID);
    expect(r).toEqual({ status: 409, body: { error: 'goal_has_open_loans', outstanding: 300 } });
  });

  it('acquireLedgerGuard writes the guard doc as the first write (D-SLW-16)', async () => {
    await seedGoal();

    await del(DEL_GOAL_ID);

    expect(await db.collection('savingsLedgerGuards').findOne({ _id: USER_A as never })).toEqual({
      _id: USER_A,
      touchedAt: expect.any(Date),
    });
  });
});

// S2 dispatch 6: E-SLW-5 — a goal DELETE racing a loan-create against the same goal (Mongo). Both routes
// now take `acquireLedgerGuard` as their first write (dispatch 4/5 made DELETE the third call site), so the
// shared guard document is what serializes them. Pattern mirrors
// __tests__/helpers/savingsWithdrawalsRouteSuite.ts's `holdCommitsUntilBothArrive` (AC-SLW-08): hold each
// transaction right before its audit-event commit until both requests have arrived there, so a real Mongo
// write-write conflict on the guard document is forced rather than left to incidental timing.
describe('DELETE /api/savings-goals racing POST /api/savings-loans — Mongo mode (S2, E-SLW-5)', () => {
  const RACE_GOAL_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const SEEDED_AT = '2026-11-17T00:00:00.000Z';

  let loansHandler: NextApiHandler;
  let auditedMod: typeof import('../../lib/auditedMutation');

  beforeAll(() => {
    // No jest.resetModules()/env changes here: the outer beforeAll already set DATA_MODE=mongo and
    // reset the module registry once, before `handler` was required. Requiring the loans handler and
    // auditedMutation now reuses that same registry, so both routes share the same `getDbPromise()`
    // connection and the same `auditTestHooks` object `handler` already runs against.
    loansHandler = require('../../pages/api/savings-loans').default;
    auditedMod = require('../../lib/auditedMutation');
  });

  beforeEach(async () => {
    auditedMod.auditTestHooks.beforeAuditWrite = undefined;
    await db.collection('savingsLoans').deleteMany({});
    await db.collection('savingsWithdrawals').deleteMany({});
    await db.collection('savingsLedgerGuards').deleteMany({});
  });

  afterEach(() => {
    auditedMod.auditTestHooks.beforeAuditWrite = undefined;
  });

  async function seedGoal() {
    await db.collection<Document>('savingsGoals').insertOne({
      _id: RACE_GOAL_ID,
      userId: USER_A,
      goalName: 'เที่ยว',
      targetAmount: 20000,
      currentAmount: 0,
      currency: 'THB',
      category: 'other',
      priority: 'medium',
      status: 'active',
      allocationPercent: null,
      createdAt: new Date(SEEDED_AT),
      updatedAt: new Date(SEEDED_AT),
      metadata: { progressPercentage: 0, remainingAmount: 20000, monthlyContribution: null, estimatedCompletionDate: null },
    } as never);
    // Enough matched savings for the goal's available balance to clear the 1,000 loan below.
    await db.collection('savings').insertOne({
      month: '2026-11', userId: USER_A, savings_list: [{ savings_type: 'เที่ยว', savings_amount: 5000 }],
    } as never);
  }

  async function postLoan(amount: number) {
    const { req, res } = makeReqRes({ method: 'POST', body: { source: { type: 'goal', goalId: RACE_GOAL_ID }, amount } });
    await loansHandler(req, res);
    const raw = res._getData();
    return { status: res._getStatusCode(), body: raw ? JSON.parse(raw) : null };
  }

  async function deleteGoal() {
    const { req, res } = makeReqRes({ method: 'DELETE', body: { goalId: RACE_GOAL_ID } });
    await handler(req, res);
    const raw = res._getData();
    return { status: res._getStatusCode(), body: raw ? JSON.parse(raw) : null };
  }

  /** See savingsWithdrawalsRouteSuite.ts's identically named helper for the full rationale. */
  function holdCommitsUntilBothArrive(timeoutMs = 300) {
    let arrived = 0;
    let release!: () => void;
    const both = new Promise<void>(resolve => { release = resolve; });
    auditedMod.auditTestHooks.beforeAuditWrite = async () => {
      arrived += 1;
      if (arrived >= 2) release();
      await Promise.race([both, new Promise(resolve => setTimeout(resolve, timeoutMs))]);
    };
  }

  it('resolves to exactly one clean outcome: either the delete wins (loan sees 404 goal_not_found) or the loan wins (delete sees 409 goal_has_open_loans) — never a loan left open against a deleted goal, or a delete that removed a goal with a just-created open loan', async () => {
    await seedGoal();
    holdCommitsUntilBothArrive();

    const [delResult, loanResult] = await Promise.all([deleteGoal(), postLoan(1000)]);

    const goalAfter = await db.collection<StoredGoal>('savingsGoals').findOne({ _id: RACE_GOAL_ID });
    const loansAfter = await db.collection('savingsLoans').find({ userId: USER_A }).toArray();

    // Exactly one side must have won; the API must never answer 2xx/2xx or 4xx/4xx for this race.
    expect([delResult.status, loanResult.status].sort()).toEqual(
      delResult.status === 200 ? [200, 404] : [201, 409]
    );

    if (delResult.status === 200) {
      // Delete won: the goal is gone, the loan POST must have been refused against it, and no loan
      // was ever persisted — no open loan can be left pointing at a goal that no longer exists.
      expect(delResult.body).toEqual({ success: true });
      expect(loanResult).toEqual({ status: 404, body: { error: 'goal_not_found' } });
      expect(goalAfter).toBeNull();
      expect(loansAfter).toHaveLength(0);
    } else {
      // Loan-create won: the goal must still exist with its new open loan, and the delete must have
      // been refused with the matching open-loan error — no delete can have removed a goal whose
      // loan-create committed concurrently.
      expect(delResult).toEqual({ status: 409, body: { error: 'goal_has_open_loans', outstanding: 1000 } });
      expect(loanResult.status).toBe(201);
      expect(loanResult.body).toMatchObject({ success: true });
      expect(goalAfter).not.toBeNull();
      expect(loansAfter).toHaveLength(1);
      expect(loansAfter[0]).toMatchObject({ status: 'open', outstandingAmount: 1000, source: { type: 'goal', goalId: RACE_GOAL_ID } });
    }

    // Whichever side won, the shared guard document proves both requests actually took the guard
    // (D-SLW-16 / C-1): this is the third named call site (loans, withdrawals, goal DELETE).
    expect(await db.collection('savingsLedgerGuards').findOne({ _id: USER_A as never })).toEqual({
      _id: USER_A,
      touchedAt: expect.any(Date),
    });
  });
});

// ---- Stage 4 (tester) additions — Mongo mode: cross-user isolation on the new 409, transaction
// rollback of the guard write on 4xx, and GET-level AC-SLW-11 / C-S2-5 checks. Own beforeEach for the
// ledger collections per C-S2-6 (the top-level hook is not edited).
describe('/api/savings-goals — Mongo mode, tester additions (S2)', () => {
  const T_GOAL_ID = 'abababababababababababab';
  const T_OTHER_ID = 'cdcdcdcdcdcdcdcdcdcdcdcd';
  const T_LOAN_ID = 'efefefefefefefefefefefef';
  const T_AT = '2026-11-17T00:00:00.000Z';

  beforeEach(async () => {
    await db.collection('savingsLoans').deleteMany({});
    await db.collection('savingsWithdrawals').deleteMany({});
    await db.collection('savingsLedgerGuards').deleteMany({});
  });

  async function seedGoalFor(userId: string, id: string, overrides: Record<string, unknown> = {}) {
    await db.collection('savingsGoals').insertOne({
      _id: id, userId, goalName: 'เที่ยว', targetAmount: 1, status: 'active',
      createdAt: new Date(T_AT), updatedAt: new Date(T_AT), ...overrides,
    } as never);
  }

  async function seedOpenLoan(userId: string, goalId: string, outstandingAmount = 100) {
    await db.collection('savingsLoans').insertOne({
      _id: T_LOAN_ID, userId, source: { type: 'goal', goalId }, principalAmount: outstandingAmount,
      outstandingAmount, status: 'open', note: null, createdAt: new Date(T_AT), updatedAt: new Date(T_AT),
      closedAt: null, repayments: [],
    } as never);
  }

  async function run(method: RequestMethod, userId: string, body?: Record<string, unknown>) {
    const { req, res } = makeReqRes({ method, userId, body });
    await handler(req, res);
    const raw = res._getData();
    return { status: res._getStatusCode(), body: raw ? JSON.parse(raw) : null };
  }

  it('cross-user: user B deleting user A\'s goal that has open loans gets 404, never 409 (no probing)', async () => {
    await seedGoalFor(USER_A, T_GOAL_ID);
    await seedOpenLoan(USER_A, T_GOAL_ID);

    expect(await run('DELETE', USER_B, { goalId: T_GOAL_ID })).toEqual({ status: 404, body: { error: 'Goal not found' } });
    expect(await db.collection('savingsGoals').findOne({ _id: T_GOAL_ID as never })).not.toBeNull();
  });

  it('cross-user: user A\'s open loan naming user B\'s goal id never blocks user B\'s delete', async () => {
    await seedGoalFor(USER_B, T_GOAL_ID);
    await seedOpenLoan(USER_A, T_GOAL_ID);

    expect(await run('DELETE', USER_B, { goalId: T_GOAL_ID })).toEqual({ status: 200, body: { success: true } });
  });

  it('a 409 aborts the transaction: goal kept, guard upsert rolled back', async () => {
    await seedGoalFor(USER_A, T_GOAL_ID);
    await seedOpenLoan(USER_A, T_GOAL_ID, 12.34);

    expect(await run('DELETE', USER_A, { goalId: T_GOAL_ID }))
      .toEqual({ status: 409, body: { error: 'goal_has_open_loans', outstanding: 12.34 } });
    expect(await db.collection('savingsLedgerGuards').countDocuments({})).toBe(0);
  });

  it('a 404 also aborts: no guard document is left behind for a nonexistent goal', async () => {
    expect(await run('DELETE', USER_A, { goalId: T_GOAL_ID })).toEqual({ status: 404, body: { error: 'Goal not found' } });
    expect(await db.collection('savingsLedgerGuards').countDocuments({})).toBe(0);
  });

  it('operator-injection goalId is refused with 400 before any ledger work', async () => {
    expect(await run('DELETE', USER_A, { goalId: { $ne: null } })).toEqual({ status: 400, body: { error: 'goalId required' } });
  });

  it('GET AC-SLW-11 / S2-F-5: zero-ledger float-dust goal stays unrounded; ledger goal is net and rounded', async () => {
    await db.collection('savings').insertOne({
      month: '2026-10', userId: USER_A,
      savings_list: [
        { savings_type: 'เที่ยว', savings_amount: 0.1 }, { savings_type: 'เที่ยว', savings_amount: 0.2 },
        { savings_type: 'อื่น', savings_amount: 0.7 }, { savings_type: 'อื่น', savings_amount: 0.1 },
      ],
    } as never);
    await seedGoalFor(USER_A, T_GOAL_ID);
    await seedGoalFor(USER_A, T_OTHER_ID, { goalName: 'อื่น' });
    await seedOpenLoan(USER_A, T_OTHER_ID, 0.3);

    const r = await run('GET', USER_A);
    expect(r.status).toBe(200);
    const dust = r.body.goals.find((g: GoalResponse) => g._id === T_GOAL_ID);
    expect(dust.currentAmount).toBe(0.1 + 0.2);
    expect(dust.metadata).toMatchObject({ outstandingLoansTotal: 0, withdrawalsTotal: 0 });
    const other = r.body.goals.find((g: GoalResponse) => g._id === T_OTHER_ID);
    expect(other.currentAmount).toBe(0.5);
    expect(other.metadata).toMatchObject({ outstandingLoansTotal: 0.3, withdrawalsTotal: 0 });
  });

  it('GET C-S2-5: stored junk metadata.outstandingLoansTotal never leaks', async () => {
    await seedGoalFor(USER_A, T_GOAL_ID, { metadata: { outstandingLoansTotal: 999999, withdrawalsTotal: 'junk' } });

    const r = await run('GET', USER_A);
    expect(r.body.goals[0].metadata).toMatchObject({ outstandingLoansTotal: 0, withdrawalsTotal: 0 });
  });

  it('GET cross-user: user B\'s loan naming user A\'s goal id does not reduce user A\'s goal', async () => {
    await seedGoalFor(USER_A, T_GOAL_ID);
    await seedOpenLoan(USER_B, T_GOAL_ID, 50);

    const r = await run('GET', USER_A);
    expect(r.body.goals[0].currentAmount).toBe(0);
    expect(r.body.goals[0].metadata.outstandingLoansTotal).toBe(0);
  });
});
