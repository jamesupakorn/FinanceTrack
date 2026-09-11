/** @jest-environment node */
// TD-C02 Increment B2 — trust-model cutover.
// ไฟล์นี้ถูกเขียนใหม่ทั้งหมด: เดิมยืนยันพฤติกรรม "เชื่อ userId ที่ client ส่งมา" (query > body > header)
// ซึ่งเป็นช่องโหว่ที่ B2 ปิดไปแล้ว ตอนนี้ userId มาจาก session cookie ที่เซิร์ฟเวอร์เซ็นเองเท่านั้น
//
// Pure-function tests — ไม่มี DB, ไม่มี mongodb-memory-server; ใช้ signSession/createSessionId/
// signCsrfToken ตัวจริงจาก sessionCookie.js (ไม่ประกอบ token ด้วยมือ) ตาม spec §7
import {
  getUserIdFromRequest,
  assertUserId,
  assertScopedUserId
} from '../../../../src/shared/utils/backend/userRequest';
import {
  signSession,
  createSessionId,
  signCsrfToken,
  verifySession,
  SESSION_COOKIE_NAME,
  SESSION_TIMEOUT_MS
} from '../../../../src/shared/utils/backend/sessionCookie';

// TD-C02 follow-up: static Bearer "API token" ถูกถอดออกแล้ว assertUserId() จึงเหลือ session cookie
// เป็นด่านแรก (แล้วตามด้วย CSRF) — ไม่มี Authorization header ในเทสต์ชุดนี้อีกต่อไป
const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_ID = 'u001';

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.end = jest.fn(() => res);
  res.setHeader = jest.fn(() => res);
  return res;
}

function makeReq({ method = 'GET', query, body, headers, cookies } = {}) {
  return {
    method,
    query: query || {},
    body: body || {},
    cookies: cookies || {},
    headers: { ...(headers || {}) }
  };
}

/** เซ็น token เสมือนออกเมื่อ `offsetMs` มิลลิวินาทีที่แล้ว (ลบ = อดีต) เพื่อคุม exp ที่เหลือ */
function signSessionIssuedAt(userId, sid, offsetMs = 0) {
  const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + offsetMs);
  try {
    return signSession(userId, sid);
  } finally {
    spy.mockRestore();
  }
}

/** req ที่มี session ใช้งานได้ + (ถ้าขอ) CSRF header ที่ถูกต้อง */
function makeSessionReq({ method = 'GET', withCsrf = false, issuedOffsetMs = 0, sid, ...rest } = {}) {
  const sessionId = sid || createSessionId();
  const token = signSessionIssuedAt(USER_ID, sessionId, issuedOffsetMs);
  const req = makeReq({
    method,
    cookies: { [SESSION_COOKIE_NAME]: token },
    headers: withCsrf ? { 'x-csrf-token': signCsrfToken(sessionId) } : undefined,
    ...rest
  });
  return { req, sid: sessionId, token };
}

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.SESSION_SECRET = TEST_SECRET;
});

afterEach(() => {
  process.env = { ...originalEnv };
  jest.restoreAllMocks();
});

describe('getUserIdFromRequest() — session cookie เป็นแหล่งเดียว', () => {
  it('session cookie ที่ถูกต้อง → คืน userId ใน payload', () => {
    const { req } = makeSessionReq();
    expect(getUserIdFromRequest(req)).toBe(USER_ID);
  });

  it('ไม่มี cookie → null', () => {
    expect(getUserIdFromRequest(makeReq())).toBeNull();
  });

  it('cookie ปลอม/ผิดรูป → null', () => {
    ['garbage', 'a.b', 'a.b.c', ''].forEach(value => {
      const req = makeReq({ cookies: { [SESSION_COOKIE_NAME]: value } });
      expect(getUserIdFromRequest(req)).toBeNull();
    });
  });

  it('cookie หมดอายุ → null', () => {
    const { req } = makeSessionReq({ issuedOffsetMs: -(SESSION_TIMEOUT_MS + 1000) });
    expect(getUserIdFromRequest(req)).toBeNull();
  });

  it('query.userId / body.userId / x-user-id ล้วน ๆ (ไม่มี cookie) → null (fallback ถูกถอดออกแล้ว)', () => {
    const req = makeReq({
      query: { userId: 'from-query' },
      body: { userId: 'from-body' },
      headers: { 'x-user-id': 'from-header' }
    });
    expect(getUserIdFromRequest(req)).toBeNull();
  });

  it('มี cookie และมี userId ปลอมจาก client ด้วย → ยึด cookie เสมอ', () => {
    const { req } = makeSessionReq({
      query: { userId: 'u999' },
      body: { userId: 'u999' },
      headers: { 'x-user-id': 'u999' }
    });
    expect(getUserIdFromRequest(req)).toBe(USER_ID);
  });

  it('req เป็น null/undefined → null ไม่ throw', () => {
    expect(getUserIdFromRequest(null)).toBeNull();
    expect(getUserIdFromRequest(undefined)).toBeNull();
  });
});

describe('assertUserId() — session ที่ถูกต้อง', () => {
  it('GET พร้อม session ที่ใช้ได้ → คืน userId, ไม่ต้องมี CSRF header', () => {
    const { req } = makeSessionReq({ method: 'GET' });
    const res = makeRes();
    expect(assertUserId(req, res)).toBe(USER_ID);
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%s พร้อม session + CSRF header ที่ถูกต้อง → คืน userId',
    (method) => {
      const { req } = makeSessionReq({ method, withCsrf: true });
      const res = makeRes();
      expect(assertUserId(req, res)).toBe(USER_ID);
      expect(res.status).not.toHaveBeenCalled();
    }
  );

  // TD-C02 follow-up regression: static Bearer token ไม่ใช่ด่านอีกต่อไป — ทั้งการ "ไม่มี" และ
  // "มีแบบมั่ว ๆ" ต้องไม่เปลี่ยนผลลัพธ์ ด่านเดียวที่ตัดสินคือ session cookie
  it('session ใช้ได้แต่ไม่มี Authorization header เลย → ยังคืน userId (Bearer token ถูกถอดออกแล้ว)', () => {
    const { req } = makeSessionReq({ method: 'GET' });
    expect(req.headers.authorization).toBeUndefined();
    const res = makeRes();
    expect(assertUserId(req, res)).toBe(USER_ID);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('Authorization header มั่ว ๆ แต่ session ใช้ได้ → ยังคืน userId (header ถูกเมิน)', () => {
    const { req } = makeSessionReq({ method: 'GET', headers: { authorization: 'Bearer garbage' } });
    const res = makeRes();
    expect(assertUserId(req, res)).toBe(USER_ID);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('มี Authorization header แต่ไม่มี session cookie → 401 (token เดี่ยว ๆ ไม่ใช่บัตรผ่าน)', () => {
    const req = makeReq({ headers: { authorization: 'Bearer anything-at-all' } });
    const res = makeRes();
    expect(assertUserId(req, res)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'session expired or invalid — please log in again'
    });
  });
});

describe('assertUserId() — 401 เมื่อไม่มี/ใช้ session ไม่ได้', () => {
  const expect401 = (req) => {
    const res = makeRes();
    expect(assertUserId(req, res)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'session expired or invalid — please log in again'
    });
    expect(res.setHeader).not.toHaveBeenCalled();
    return res;
  };

  it('ไม่มี cookie เลย → 401 (ไม่ใช่ 400 แบบเดิม)', () => {
    expect401(makeReq());
  });

  it('REGRESSION (สำคัญที่สุด): userId จาก query/body/x-user-id ล้วน ๆ → 401 ไม่ใช่ 200', () => {
    expect401(makeReq({ query: { userId: 'u999' } }));
    expect401(makeReq({ method: 'POST', body: { userId: 'u999' } }));
    expect401(makeReq({ headers: { 'x-user-id': 'u999' } }));
    expect401(makeReq({
      method: 'POST',
      query: { userId: 'u999' },
      body: { userId: 'u999' },
      headers: { 'x-user-id': 'u999', 'x-csrf-token': 'whatever' }
    }));
  });

  it('cookie หมดอายุ → 401', () => {
    const { req } = makeSessionReq({ issuedOffsetMs: -(SESSION_TIMEOUT_MS + 1000) });
    expect401(req);
  });

  it('cookie ถูกแก้ (signature ไม่ตรง) → 401', () => {
    const { req, token } = makeSessionReq();
    const [payload, signature] = token.split('.');
    const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    req.cookies[SESSION_COOKIE_NAME] = `${payload}.${flipped}`;
    expect401(req);
  });

  it('cookie ขยะ/ค่าว่าง → 401', () => {
    ['', 'garbage', 'a.b.c', '%%%.%%%'].forEach(value => {
      expect401(makeReq({ cookies: { [SESSION_COOKIE_NAME]: value } }));
    });
  });
});

describe('assertUserId() — CSRF (signed double-submit) บน method ที่เปลี่ยนข้อมูล', () => {
  const expect403 = (req) => {
    const res = makeRes();
    expect(assertUserId(req, res)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid csrf token' });
    expect(res.setHeader).not.toHaveBeenCalled();
  };

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s ที่ไม่มี X-CSRF-Token → 403', (method) => {
    const { req } = makeSessionReq({ method, withCsrf: false });
    expect403(req);
  });

  it('CSRF token ผิด/ขยะ → 403', () => {
    ['wrong-token', '', 'has space', 'AAAA'].forEach(bad => {
      const { req } = makeSessionReq({ method: 'POST' });
      req.headers['x-csrf-token'] = bad;
      expect403(req);
    });
  });

  it('CSRF token ของ session อื่น (sid ไม่ตรง) → 403', () => {
    const { req } = makeSessionReq({ method: 'POST' });
    req.headers['x-csrf-token'] = signCsrfToken(createSessionId());
    expect403(req);
  });

  it('GET/HEAD ไม่ต้องมี CSRF และไม่ถูกปฏิเสธแม้ส่ง token ผิดมา', () => {
    const { req } = makeSessionReq({ method: 'GET' });
    req.headers['x-csrf-token'] = 'garbage';
    const res = makeRes();
    expect(assertUserId(req, res)).toBe(USER_ID);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('session หมดอายุ + CSRF ถูกต้อง → 401 (ตรวจ session ก่อน CSRF เสมอ)', () => {
    const sid = createSessionId();
    const { req } = makeSessionReq({
      method: 'POST',
      sid,
      withCsrf: true,
      issuedOffsetMs: -(SESSION_TIMEOUT_MS + 1000)
    });
    const res = makeRes();
    expect(assertUserId(req, res)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('assertUserId() — sliding renewal ที่ threshold 50%', () => {
  it('เหลือ 25% ของ window → ออก Set-Cookie ใหม่ทั้ง ft_session และ ft_csrf', () => {
    const sid = createSessionId();
    const { req } = makeSessionReq({ sid, issuedOffsetMs: -0.75 * SESSION_TIMEOUT_MS });
    const res = makeRes();

    expect(assertUserId(req, res)).toBe(USER_ID);
    expect(res.setHeader).toHaveBeenCalledTimes(1);
    const [headerName, cookies] = res.setHeader.mock.calls[0];
    expect(headerName).toBe('Set-Cookie');
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain('ft_session=');
    expect(cookies[1]).toContain('ft_csrf=');
  });

  it('cookie ที่ออกใหม่ใช้ sid เดิม (CSRF token ที่ frontend ถืออยู่ยังใช้ได้) แต่ exp ยืดออก', () => {
    const sid = createSessionId();
    const { req, token } = makeSessionReq({ sid, issuedOffsetMs: -0.75 * SESSION_TIMEOUT_MS });
    const res = makeRes();
    assertUserId(req, res);

    const [, cookies] = res.setHeader.mock.calls[0];
    const renewedToken = cookies[0].split(';')[0].slice('ft_session='.length);
    const renewed = verifySession(renewedToken);
    const previous = verifySession(token);

    expect(renewed.sid).toBe(sid);
    expect(renewed.userId).toBe(USER_ID);
    expect(renewed.exp).toBeGreaterThan(previous.exp);
    // csrf cookie ต้องเป็น token ของ sid เดิม ไม่ใช่ค่าใหม่ที่ frontend ยังไม่รู้จัก
    expect(cookies[1]).toContain(`ft_csrf=${signCsrfToken(sid)}`);
  });

  it('เหลือ 75% ของ window → ไม่ต่ออายุ (ไม่มี Set-Cookie churn)', () => {
    const { req } = makeSessionReq({ issuedOffsetMs: -0.25 * SESSION_TIMEOUT_MS });
    const res = makeRes();
    expect(assertUserId(req, res)).toBe(USER_ID);
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('session ที่เพิ่งออก (เหลือ ~100%) → ไม่ต่ออายุ', () => {
    const { req } = makeSessionReq();
    const res = makeRes();
    expect(assertUserId(req, res)).toBe(USER_ID);
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('POST ที่ต่ออายุได้ ต้องผ่าน CSRF ก่อน — CSRF ผิดแล้วไม่ต่ออายุให้', () => {
    const sid = createSessionId();
    const { req } = makeSessionReq({ method: 'POST', sid, issuedOffsetMs: -0.75 * SESSION_TIMEOUT_MS });
    const res = makeRes();
    expect(assertUserId(req, res)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});

describe('assertScopedUserId() — shared throwing store-layer guard (AC-3, ไม่เกี่ยวกับ cutover)', () => {
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
