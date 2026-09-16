/** @jest-environment node */
// Integration test against a real (ephemeral, in-process) MongoDB instance — see
// .pipeline/spec-td-c01-api-coverage-12.md for why mongodb-memory-server (not mocks) was chosen: this
// route's legacy-doc materialization side effect (a write triggered by a GET), its partial-$set/$unset
// POST semantics, and the dotted-path __labels.<key> persistence are all real Mongo document-shape
// behaviors a mocked collection would trivially fake without proving anything about the real
// updateOne/$set/$unset round trip. This route has no top-level try/catch (no 500 branch to isolate),
// so there is no jest.mock() carve-out anywhere in this file (AC-3).
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

  handler = require('../../pages/api/monthly_income').default;
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
    await db.collection('monthly_income').deleteMany({});
    // Shared-window tests (22-24) cross-cut this route's own extra legacy-pruning step plus the
    // shared enforceSharedMonthWindowMongo helper across all 4 sharedMonthWindow.js collections —
    // matching investment.test.js's own precedent of clearing a second collection for its own
    // shared-window test.
    await db.collection('monthly_expense').deleteMany({});
    await db.collection('salary').deleteMany({});
    await db.collection('investment').deleteMany({});
  }
});

/** Identical shape to investment.test.js's/savings.test.js's own helper — same collaborator
 * (`sessionCookie`), same gate (`assertUserId`), reused verbatim rather than re-invented. */
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

describe('/api/monthly_income (Mongo mode)', () => {
  // ---------------------------------------------------------------------
  // GET — single month (6 cases)
  // ---------------------------------------------------------------------

  it('1. GET with no session cookie returns 401 with the exact assertUserId body', async () => {
    const { req, res } = makeReqRes({ userId: null, query: { month: '2026-01' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(JSON.parse(res._getData())).toEqual({
      error: 'session expired or invalid — please log in again'
    });
  });

  it('2. GET for a month with no doc and no legacy entry returns 200 bare { month, รวม: 0 }', async () => {
    const { req, res } = makeReqRes({ query: { month: '2026-01' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ month: '2026-01', รวม: 0 });
  });

  it('3. GET for a month with an existing direct doc returns the doc fields plus a correctly-summed รวม', async () => {
    await db.collection('monthly_income').insertOne({
      month: '2026-02a',
      userId: USER_A,
      เงินเดือน: 30000,
      โบนัส: 5000
    });

    const { req, res } = makeReqRes({ query: { month: '2026-02a' } });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({
      month: '2026-02a',
      เงินเดือน: 30000,
      โบนัส: 5000,
      รวม: 35000
    });
  });

  it('4. GET single-month legacy-only entry materializes a real per-month doc and leaves the source legacy doc unchanged', async () => {
    await db.collection('monthly_income').insertOne({
      obj: 'months',
      userId: USER_A,
      months: {
        '2026-01': { เงินเดือน: 30000, โบนัส: 5000 }
      }
    });

    const { req, res } = makeReqRes({ query: { month: '2026-01' } });
    await handler(req, res);

    // Fact 1: the GET response reflects the materialized data.
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({
      month: '2026-01',
      เงินเดือน: 30000,
      โบนัส: 5000,
      รวม: 35000
    });

    // Fact 2: a new real per-month document was actually written.
    const materialized = await db.collection('monthly_income').findOne({ userId: USER_A, month: '2026-01' });
    expect(materialized).not.toBeNull();
    expect(materialized.เงินเดือน).toBe(30000);
    expect(materialized.โบนัส).toBe(5000);
    expect(materialized.month).toBe('2026-01');
    expect(materialized.userId).toBe(USER_A);

    // Fact 3: the source legacy {obj:'months'} sub-document is left completely unchanged.
    const legacyDoc = await db.collection('monthly_income').findOne({ userId: USER_A, obj: 'months' });
    expect(legacyDoc).not.toBeNull();
    expect(legacyDoc.months['2026-01']).toEqual({ เงินเดือน: 30000, โบนัส: 5000 });
  });

  it('5. GET single-month: legacy doc exists but lacks this month falls through to bare response, no materialization', async () => {
    await db.collection('monthly_income').insertOne({
      obj: 'months',
      userId: USER_A,
      months: {
        '2026-01': { เงินเดือน: 30000 }
      }
    });

    const { req, res } = makeReqRes({ query: { month: '2026-09' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ month: '2026-09', รวม: 0 });

    const materialized = await db.collection('monthly_income').findOne({ userId: USER_A, month: '2026-09' });
    expect(materialized).toBeNull();
  });

  it('6. GET single-month cross-user isolation: doc exists for User A, GET as User B returns bare response', async () => {
    await db.collection('monthly_income').insertOne({
      month: '2026-10',
      userId: USER_A,
      เงินเดือน: 40000
    });

    const { req, res } = makeReqRes({ userId: USER_B, query: { month: '2026-10' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ month: '2026-10', รวม: 0 });
  });

  // ---------------------------------------------------------------------
  // GET — all months (5 cases)
  // ---------------------------------------------------------------------

  it('7. GET all months with no docs and no legacy doc returns 200 {}', async () => {
    const { req, res } = makeReqRes({ query: {} });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({});
  });

  it('8. GET all months with two direct docs returns an object keyed by month, each with a correctly-summed รวม, _id/userId stripped', async () => {
    await db.collection('monthly_income').insertOne({
      month: '2026-11',
      userId: USER_A,
      เงินเดือน: 10000
    });
    await db.collection('monthly_income').insertOne({
      month: '2026-12',
      userId: USER_A,
      เงินเดือน: 20000,
      โบนัส: 1000
    });

    const { req, res } = makeReqRes({ query: {} });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body).toEqual({
      '2026-11': { month: '2026-11', เงินเดือน: 10000, รวม: 10000 },
      '2026-12': { month: '2026-12', เงินเดือน: 20000, โบนัส: 1000, รวม: 21000 }
    });
    expect(body['2026-11']._id).toBeUndefined();
    expect(body['2026-11'].userId).toBeUndefined();
  });

  it('9. GET all months merges a legacy-only month in via sumValues, with the materialization side effect verified', async () => {
    await db.collection('monthly_income').insertOne({
      obj: 'months',
      userId: USER_A,
      months: {
        '2027-01': { เงินเดือน: 15000, โบนัส: 2000 }
      }
    });

    const { req, res } = makeReqRes({ query: {} });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({
      '2027-01': { month: '2027-01', เงินเดือน: 15000, โบนัส: 2000, รวม: 17000 }
    });

    const materialized = await db.collection('monthly_income').findOne({ userId: USER_A, month: '2027-01' });
    expect(materialized).not.toBeNull();
    expect(materialized.เงินเดือน).toBe(15000);
    expect(materialized.โบนัส).toBe(2000);
  });

  it('10. GET all months: a month present in both a direct doc and the legacy sub-doc — direct doc wins, legacy entry ignored', async () => {
    await db.collection('monthly_income').insertOne({
      month: '2027-02',
      userId: USER_A,
      เงินเดือน: 99999 // deliberately distinct from the legacy entry's own values
    });
    await db.collection('monthly_income').insertOne({
      obj: 'months',
      userId: USER_A,
      months: {
        '2027-02': { เงินเดือน: 1, โบนัส: 1 } // distinct legacy values, must NOT appear
      }
    });

    const { req, res } = makeReqRes({ query: {} });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body).toEqual({
      '2027-02': { month: '2027-02', เงินเดือน: 99999, รวม: 99999 }
    });
    expect(body['2027-02'].โบนัส).toBeUndefined();
  });

  it('11. GET all months cross-user isolation: legacy sub-doc exists only for User B, GET as User A returns {}', async () => {
    await db.collection('monthly_income').insertOne({
      obj: 'months',
      userId: USER_B,
      months: {
        '2027-03': { เงินเดือน: 5000 }
      }
    });

    const { req, res } = makeReqRes({ userId: USER_A, query: {} });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({});
  });

  // ---------------------------------------------------------------------
  // getTotalIncome vs. sumValues divergence (1 case)
  // ---------------------------------------------------------------------

  it("12. getTotalIncome (direct-doc GET path) does NOT exclude a numeric รวม field, sumValues(...,['รวม']) (legacy-merge path) DOES exclude it", async () => {
    // Direct-doc path: a document with a genuinely numeric field literally named รวม — getTotalIncome
    // sums every typeof === 'number' value with no key exclusion, so the stale รวม field is
    // double-counted into the fresh total (verified against the real function source, not just the spec).
    await db.collection('monthly_income').insertOne({
      month: '2026-02',
      userId: USER_A,
      เงินเดือน: 100,
      รวม: 999
    });

    const { req: getReq, res: getRes } = makeReqRes({ query: { month: '2026-02' } });
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    expect(JSON.parse(getRes._getData()).รวม).toBe(1099);

    // Legacy-merge path: same field shape, but only present inside a legacy monthsDoc sub-document
    // (no direct doc for this month) — this path uses the imported sumValues(values, ['รวม']), which
    // DOES exclude the รวม key by name from its own sum.
    await db.collection('monthly_income').insertOne({
      obj: 'months',
      userId: USER_A,
      months: {
        '2026-03': { เงินเดือน: 100, รวม: 999 }
      }
    });

    const { req: allReq, res: allRes } = makeReqRes({ query: {} });
    await handler(allReq, allRes);

    expect(allRes._getStatusCode()).toBe(200);
    const allBody = JSON.parse(allRes._getData());
    expect(allBody['2026-03'].รวม).toBe(100);
  });

  // ---------------------------------------------------------------------
  // POST (9 cases)
  // ---------------------------------------------------------------------

  it('13. POST with a valid session but missing X-CSRF-Token returns 403 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      omitCsrf: true,
      body: { month: '2026-04', values: { เงินเดือน: 1000 } }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(403);
    expect(await db.collection('monthly_income').countDocuments({})).toBe(0);
  });

  it('14. POST validation: missing month returns 400 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { values: { เงินเดือน: 1000 } }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'month and values required' });
    expect(await db.collection('monthly_income').countDocuments({})).toBe(0);
  });

  it('15. POST validation: missing values returns 400 and does not write', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { month: '2026-04' }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'month and values required' });
    expect(await db.collection('monthly_income').countDocuments({})).toBe(0);
  });

  it('16. POST success creates a new document, verified by a following GET round trip', async () => {
    const { req: postReq, res: postRes } = makeReqRes({
      method: 'POST',
      body: { month: '2026-04', values: { เงินเดือน: 50000 } }
    });

    await handler(postReq, postRes);

    expect(postRes._getStatusCode()).toBe(201);
    expect(JSON.parse(postRes._getData())).toEqual({ success: true });

    const { req: getReq, res: getRes } = makeReqRes({ query: { month: '2026-04' } });
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    expect(JSON.parse(getRes._getData())).toEqual({
      month: '2026-04',
      เงินเดือน: 50000,
      รวม: 50000
    });
  });

  it('17. POST partial-update semantics: two sequential POSTs with disjoint fields both survive ($set-only, not investment.js-style full-overwrite)', async () => {
    // Cross-reference: opposite of investment.test.js's own "full-overwrite semantics" test — this
    // route uses partial $set/$unset, not a full-document overwrite.
    const { req: firstReq, res: firstRes } = makeReqRes({
      method: 'POST',
      body: { month: '2026-04b', values: { เงินเดือน: 50000 } }
    });
    await handler(firstReq, firstRes);
    expect(firstRes._getStatusCode()).toBe(201);

    let doc = await db.collection('monthly_income').findOne({ userId: USER_A, month: '2026-04b' });
    expect(doc.เงินเดือน).toBe(50000);

    // Second POST with a disjoint field (เงินเดือน absent from this request's values).
    const { req: secondReq, res: secondRes } = makeReqRes({
      method: 'POST',
      body: { month: '2026-04b', values: { โบนัส: 3000 } }
    });
    await handler(secondReq, secondRes);
    expect(secondRes._getStatusCode()).toBe(201);

    doc = await db.collection('monthly_income').findOne({ userId: USER_A, month: '2026-04b' });
    // Both fields must be present together — the old field untouched, the new field added.
    expect(doc.เงินเดือน).toBe(50000);
    expect(doc.โบนัส).toBe(3000);
  });

  it('18. POST __labels set persists a nested __labels.<key> entry, verified via a follow-up GET', async () => {
    const { req: postReq, res: postRes } = makeReqRes({
      method: 'POST',
      body: {
        month: '2026-05',
        values: { เงินเดือน: 1000, __labels: { เงินเดือน: 'Base Salary' } }
      }
    });
    await handler(postReq, postRes);
    expect(postRes._getStatusCode()).toBe(201);

    const { req: getReq, res: getRes } = makeReqRes({ query: { month: '2026-05' } });
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    const body = JSON.parse(getRes._getData());
    expect(body.เงินเดือน).toBe(1000);
    expect(body.__labels).toEqual({ เงินเดือน: 'Base Salary' });
  });

  it('19. POST __removeKeys unsets both the field and its sibling __labels.<key>, verified via a follow-up GET', async () => {
    const { req: firstReq, res: firstRes } = makeReqRes({
      method: 'POST',
      body: {
        month: '2026-05b',
        values: { เงินเดือน: 1000, __labels: { เงินเดือน: 'Base Salary' } }
      }
    });
    await handler(firstReq, firstRes);
    expect(firstRes._getStatusCode()).toBe(201);

    const { req: removeReq, res: removeRes } = makeReqRes({
      method: 'POST',
      body: { month: '2026-05b', values: { __removeKeys: ['เงินเดือน'] } }
    });
    await handler(removeReq, removeRes);
    expect(removeRes._getStatusCode()).toBe(201);

    const { req: getReq, res: getRes } = makeReqRes({ query: { month: '2026-05b' } });
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    const body = JSON.parse(getRes._getData());
    expect(body.เงินเดือน).toBeUndefined();
    // Verified against a throwaway direct read of the real driver behavior: $unset on a nested dotted
    // path leaves the parent object present as an empty shell rather than removing it entirely.
    expect(body.__labels).toEqual({});
  });

  it('20. POST same-request overlap: a key present as a value field, a label target, AND a removal key — removal wins over both', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: {
        month: '2026-06',
        values: {
          เงินเดือน: 1000,
          __labels: { เงินเดือน: 'X' },
          __removeKeys: ['เงินเดือน']
        }
      }
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(201);

    const doc = await db.collection('monthly_income').findOne({ userId: USER_A, month: '2026-06' });
    expect(doc).not.toBeNull();
    // The removed key is absent from both the top-level field and its __labels sibling.
    expect(doc.เงินเดือน).toBeUndefined();
    expect(doc.__labels?.เงินเดือน).toBeUndefined();
  });

  it('21. POST cross-user isolation: a POST for User A does not create or alter a document visible to User B for the same month', async () => {
    const { req: postReq, res: postRes } = makeReqRes({
      method: 'POST',
      userId: USER_A,
      body: { month: '2026-08', values: { เงินเดือน: 1 } }
    });
    await handler(postReq, postRes);
    expect(postRes._getStatusCode()).toBe(201);

    const { req: getReq, res: getRes } = makeReqRes({ userId: USER_B, query: { month: '2026-08' } });
    await handler(getReq, getRes);

    expect(getRes._getStatusCode()).toBe(200);
    expect(JSON.parse(getRes._getData())).toEqual({ month: '2026-08', รวม: 0 });
  });

  // ---------------------------------------------------------------------
  // Shared-window integration (3 cases)
  // ---------------------------------------------------------------------

  it("22. POST prunes the legacy sub-document's own months map down to the shared-window's allowedMonths set", async () => {
    // enforceSharedMonthWindowMongo's own union (per its real source, sharedMonthWindow.js) is built
    // ONLY from actual per-month documents (`{ month: { $exists: true } }`) across the 4 shared
    // collections plus `extraMonth` — a legacy {obj:'months'} sub-document's own `months` map keys are
    // NOT themselves counted into that union (the sub-doc has no top-level `month` field). This route's
    // own extra pruning step then filters the legacy sub-doc's months down to the intersection with
    // whatever `allowedMonths` the shared helper actually returned. Verified directly against
    // sharedMonthWindow.js's real source before writing this test (not assumed from the spec's own
    // narrative, which described a 16th-month-eviction framing that doesn't match this route's actual
    // union computation).
    await db.collection('monthly_income').insertOne({
      obj: 'months',
      userId: USER_A,
      months: {
        '2021-05': { เงินเดือน: 1 }, // matches an existing direct doc's month -> survives the prune
        '2019-01': { เงินเดือน: 1 }  // no matching direct doc anywhere -> never in allowedMonths -> pruned
      }
    });
    // One direct per-month document sharing a month key with the legacy sub-doc.
    await db.collection('monthly_income').insertOne({
      month: '2021-05',
      userId: USER_A,
      เงินเดือน: 100
    });

    const { req, res } = makeReqRes({
      method: 'POST',
      userId: USER_A,
      body: { month: '2022-01', values: { เงินเดือน: 1 } }
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(201);

    const legacyDoc = await db.collection('monthly_income').findOne({ userId: USER_A, obj: 'months' });
    expect(legacyDoc).not.toBeNull();
    // '2021-05' (also a real direct doc, thus in allowedMonths) survives; '2019-01' (no matching direct
    // doc anywhere, never in allowedMonths) is pruned out.
    expect(Object.keys(legacyDoc.months).sort()).toEqual(['2021-05']);
  });

  it('23. POST with no pre-existing legacy sub-doc never creates one', async () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      userId: USER_A,
      body: { month: '2026-07', values: { เงินเดือน: 1 } }
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(201);

    const legacyDoc = await db.collection('monthly_income').findOne({ userId: USER_A, obj: 'months' });
    expect(legacyDoc).toBeNull();
  });

  it("24. enforceSharedMonthWindowMongo prunes a shared newest-15 window across monthly_income AND salary for one user, at this route's own POST call site", async () => {
    // 10 months for USER_A in `monthly_income`: 2024-01 .. 2024-10.
    const incomeMonths = [];
    for (let m = 1; m <= 10; m++) {
      incomeMonths.push(`2024-${String(m).padStart(2, '0')}`);
    }
    // 5 months for USER_A in `salary`: 2024-11 .. 2025-03.
    const salaryMonths = ['2024-11', '2024-12', '2025-01', '2025-02', '2025-03'];

    await db.collection('monthly_income').insertMany(
      incomeMonths.map(month => ({ month, userId: USER_A, เงินเดือน: 1 }))
    );
    await db.collection('salary').insertMany(
      salaryMonths.map(month => ({ month, userId: USER_A, income: {}, deduct: {} }))
    );

    // A real POST through this route's own handler for a 16th, newer month.
    const { req, res } = makeReqRes({
      method: 'POST',
      userId: USER_A,
      body: { month: '2025-04', values: { เงินเดือน: 1 } }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(201);

    const incomeCount = await db.collection('monthly_income').countDocuments({ userId: USER_A, month: { $exists: true } });
    const salaryCount = await db.collection('salary').countDocuments({ userId: USER_A });
    // 10 income + 1 new (2025-04) + 5 salary = 16 total before prune; one evicted across the shared
    // window -> 15 remain.
    expect(incomeCount + salaryCount).toBe(15);

    // 2024-01 is the globally oldest month across the two-collection union -> evicted from monthly_income.
    expect(await db.collection('monthly_income').findOne({ userId: USER_A, month: '2024-01' })).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Method/error handling (1 case)
  // ---------------------------------------------------------------------

  it('25. unsupported method (DELETE) returns 405 with the bare .end() shape — empty body, no Allow header', async () => {
    const { req, res } = makeReqRes({ method: 'DELETE' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    // Route calls res.status(405).end() — no JSON body, no Allow header — matching savings.js's own
    // bare shape, not investment.js's/credit-cards/*.js's own JSON-body 405 shape.
    expect(res._getData()).toBe('');
    expect(res._getHeaders().allow).toBeUndefined();
  });
});
