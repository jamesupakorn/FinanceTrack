/** @jest-environment node */
// Regression coverage for the F-01/F-08 hardening in
// .pipeline/spec-findings-codebase-review-fix.md (Group A, AC-1…AC-6).
// Pure-function tests only — no DB, no mongodb-memory-server. `normalizeUserId()` and the new
// shared store-layer guard both run before any data access, so nothing here needs a fixture.
import { getUserIdFromRequest, assertUserId, assertScopedUserId } from '../../../../src/shared/utils/backend/userRequest';

// assertUserId() calls assertApiToken() first — give it a deterministic token so these tests
// exercise the userId-resolution logic, not the auth layer (already covered elsewhere).
const TEST_TOKEN = 'test-token-userRequest-spec';

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.end = jest.fn(() => res);
  return res;
}

function makeReq({ query, body, headers } = {}) {
  return {
    query: query || {},
    body: body || {},
    headers: { authorization: `Bearer ${TEST_TOKEN}`, ...(headers || {}) },
  };
}

describe('userRequest.js — normalizeUserId() hardening (F-01)', () => {
  const originalToken = process.env.API_ACCESS_TOKEN;

  beforeAll(() => {
    process.env.API_ACCESS_TOKEN = TEST_TOKEN;
  });

  afterAll(() => {
    process.env.API_ACCESS_TOKEN = originalToken;
  });

  // AC-1's input/output table, exercised via getUserIdFromRequest() (query path) since
  // normalizeUserId() itself is not exported — this is the same public seam assertUserId() uses.
  it.each([
    ['u001', 'u001'],
    ['  u001  ', 'u001'],
    [123, '123'],
    [['u001'], 'u001'],
    [['  u001  '], 'u001'],
    [[123], '123'],
    [[{ $ne: null }], null],
    [[['u001']], null],
    [[null], null],
    [[], null],
    [[undefined], null],
    [{ $ne: null }, null],
  ])('normalizes query.userId = %p to %p', (input, expected) => {
    const req = makeReq({ query: { userId: input } });
    expect(getUserIdFromRequest(req)).toBe(expected);
  });

  it('preserves the duplicate-query-param path (?userId=a&userId=b takes the first)', () => {
    const req = makeReq({ query: { userId: ['a', 'b'] } });
    expect(getUserIdFromRequest(req)).toBe('a');
  });

  it('resolves userId from body when query is absent', () => {
    const req = makeReq({ body: { userId: 'u002' } });
    expect(getUserIdFromRequest(req)).toBe('u002');
  });

  it('resolves userId from x-user-id header when query and body are absent', () => {
    const req = makeReq({ headers: { 'x-user-id': 'u003' } });
    expect(getUserIdFromRequest(req)).toBe('u003');
  });

  it('honours query > body > header precedence', () => {
    const req = makeReq({
      query: { userId: 'from-query' },
      body: { userId: 'from-body' },
      headers: { 'x-user-id': 'from-header' },
    });
    expect(getUserIdFromRequest(req)).toBe('from-query');
  });
});

describe('assertUserId() — request-boundary guard (AC-2, AC-6)', () => {
  const originalToken = process.env.API_ACCESS_TOKEN;

  beforeAll(() => {
    process.env.API_ACCESS_TOKEN = TEST_TOKEN;
  });

  afterAll(() => {
    process.env.API_ACCESS_TOKEN = originalToken;
  });

  it('returns the userId for a legitimate body userId', () => {
    const req = makeReq({ body: { userId: 'u001' } });
    const res = makeRes();
    expect(assertUserId(req, res)).toBe('u001');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns the userId for a legitimate query userId', () => {
    const req = makeReq({ query: { userId: 'u001' } });
    const res = makeRes();
    expect(assertUserId(req, res)).toBe('u001');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns the userId for a legitimate x-user-id header', () => {
    const req = makeReq({ headers: { 'x-user-id': 'u001' } });
    const res = makeRes();
    expect(assertUserId(req, res)).toBe('u001');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects an injection payload with 400, not 500 (AC-2)', () => {
    const req = makeReq({ body: { userId: [{ $ne: null }] } });
    const res = makeRes();
    expect(assertUserId(req, res)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'userId required' });
  });

  it('rejects a missing userId with 400', () => {
    const req = makeReq({});
    const res = makeRes();
    expect(assertUserId(req, res)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'userId required' });
  });
});

describe('assertScopedUserId() — shared throwing store-layer guard (AC-3)', () => {
  it.each(['userStore', 'creditCardStore'])(
    "throws '%s: userId is required' for an empty string",
    (label) => {
      expect(() => assertScopedUserId('', label)).toThrow(`${label}: userId is required`);
    }
  );

  it.each(['userStore', 'creditCardStore'])(
    "throws '%s: userId is required' for an injection object",
    (label) => {
      expect(() => assertScopedUserId({ $ne: null }, label)).toThrow(`${label}: userId is required`);
    }
  );

  it.each(['userStore', 'creditCardStore'])(
    "throws '%s: userId is required' for undefined",
    (label) => {
      expect(() => assertScopedUserId(undefined, label)).toThrow(`${label}: userId is required`);
    }
  );

  it('returns the trimmed userId for a legitimate string', () => {
    expect(assertScopedUserId('  u001  ', 'userStore')).toBe('u001');
  });
});
