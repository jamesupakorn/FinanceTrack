/** @jest-environment node */
/**
 * Stage 4 tests — TD-C02 Increment B1 → B2/B3 wiring:
 *   pages/api/auth/profile-login.js  (ออก session cookie + csrf cookie)
 *   pages/api/auth/logout.js         (ล้างทั้งสองใบ)
 *
 * `lib/userStore` ถูก mock เพื่อไม่ต้องพึ่ง Mongo/JSON store จริง — เป้าหมายของไฟล์นี้คือพิสูจน์
 * พฤติกรรมของ header/response body/สถานะ ไม่ใช่ตรรกะ password store
 */
import { createMocks } from 'node-mocks-http';

const TEST_SECRET = 'test-secret-do-not-use-in-prod';

const mockGetUserById = jest.fn();
const mockCheckUserPassword = jest.fn();

jest.mock('../../lib/userStore', () => ({
  getUserById: (...args) => mockGetUserById(...args),
  checkUserPassword: (...args) => mockCheckUserPassword(...args)
}));

const { verifySession, verifyCsrfToken } = require('../../src/shared/utils/backend/sessionCookie');

/** ดึงค่า cookie ตัวหนึ่งจาก header Set-Cookie (ตอนนี้เป็น array 2 ใบเสมอ) */
function readCookie(res, name) {
  const header = res.getHeader('Set-Cookie');
  const list = Array.isArray(header) ? header : [header];
  const match = list.find(entry => String(entry).startsWith(`${name}=`));
  return match ? String(match) : undefined;
}

const cookieValue = (cookieString, name) => cookieString.split(';')[0].slice(`${name}=`.length);
const loginHandler = require('../../pages/api/auth/profile-login').default;
const logoutHandler = require('../../pages/api/auth/logout').default;

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.SESSION_SECRET = TEST_SECRET;

  mockGetUserById.mockReset();
  mockCheckUserPassword.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...originalEnv };
  jest.restoreAllMocks();
});

// TD-C02 follow-up: ทั้ง login และ logout เป็น public endpoint แล้ว (static Bearer token ถูกถอดออก)
// จึงไม่มี header พิเศษที่ต้องแนบ — ด่านจริงของ login คือรหัสผ่าน
const baseHeaders = {};

function loginMocks(body = { userId: 'u001', password: 'pw' }, headers = baseHeaders) {
  return createMocks({ method: 'POST', headers, body });
}

describe('POST /api/auth/profile-login — session cookie issuance', () => {
  beforeEach(() => {
    mockGetUserById.mockResolvedValue({
      id: 'u001',
      displayName: 'Supakorn',
      avatar: '/a.png',
      passwordHash: 'should-not-leak',
      bankAccounts: ['secret']
    });
    mockCheckUserPassword.mockResolvedValue(true);
  });

  it('ล็อกอินสำเร็จ → ตั้ง Set-Cookie ที่ verify แล้วได้ userId เดิม', async () => {
    const { req, res } = loginMocks();
    await loginHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const cookieString = readCookie(res, 'ft_session');
    expect(cookieString).toBeDefined();
    expect(cookieString).toContain('HttpOnly');
    expect(cookieString).toContain('Path=/');
    expect(cookieString).toContain('Max-Age=3600');
    expect(cookieString).toContain('SameSite=Lax');

    const token = cookieValue(cookieString, 'ft_session');
    expect(verifySession(token)).toMatchObject({ userId: 'u001' });
  });

  it('ล็อกอินสำเร็จ → ออก ft_csrf คู่กัน (ไม่ HttpOnly) และ token ตรงกับ sid ของ session', async () => {
    const { req, res } = loginMocks();
    await loginHandler(req, res);

    const sessionCookie = readCookie(res, 'ft_session');
    const csrfCookie = readCookie(res, 'ft_csrf');
    expect(csrfCookie).toBeDefined();
    expect(csrfCookie).not.toContain('HttpOnly');
    expect(csrfCookie).toContain('SameSite=Lax');
    expect(csrfCookie).toContain('Max-Age=3600');

    const { sid } = verifySession(cookieValue(sessionCookie, 'ft_session'));
    expect(verifyCsrfToken(sid, cookieValue(csrfCookie, 'ft_csrf'))).toBe(true);
  });

  it('login ใหม่ → sid หมุนค่าใหม่ทุกครั้ง', async () => {
    const first = loginMocks();
    await loginHandler(first.req, first.res);
    const second = loginMocks();
    await loginHandler(second.req, second.res);

    const sidOf = res => verifySession(cookieValue(readCookie(res, 'ft_session'), 'ft_session')).sid;
    expect(sidOf(first.res)).not.toBe(sidOf(second.res));
  });

  // TD-H09: `isDemo` was added to `safeUser` so SummaryReport.js's existing `currentUser?.isDemo`
  // read keeps working once the demo profile goes through this same response path. For a
  // non-demo user it's always `false` — the rest of the body shape is unchanged.
  it('response body ไม่เปลี่ยน — { success, user:{id,displayName,avatar,isDemo} } เท่านั้น', async () => {
    const { req, res } = loginMocks();
    await loginHandler(req, res);

    const body = res._getJSONData();
    expect(body).toEqual({
      success: true,
      user: { id: 'u001', displayName: 'Supakorn', avatar: '/a.png', isDemo: false }
    });
    // ไม่มี token/session รั่วออกทาง body (cookie เป็น HttpOnly เท่านั้น)
    expect(Object.keys(body).sort()).toEqual(['success', 'user']);
    expect(JSON.stringify(body)).not.toContain('ft_session');
    expect(JSON.stringify(body)).not.toContain('should-not-leak');
    expect(JSON.stringify(body)).not.toContain(TEST_SECRET);
  });

  it('cookie ผูกกับ user ที่ล็อกอินจริง ไม่ใช่ userId ที่ client ส่งมา (ถ้าต่างกัน)', async () => {
    mockGetUserById.mockResolvedValue({ id: 'u002', displayName: 'B', avatar: null });
    const { req, res } = loginMocks({ userId: 'u001', password: 'pw' });
    await loginHandler(req, res);

    const token = cookieValue(readCookie(res, 'ft_session'), 'ft_session');
    expect(verifySession(token)).toMatchObject({ userId: 'u002' });
  });

  it('รหัสผ่านผิด → 401 และไม่ตั้ง cookie', async () => {
    mockCheckUserPassword.mockResolvedValue(false);
    const { req, res } = loginMocks();
    await loginHandler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(res.getHeader('Set-Cookie')).toBeUndefined();
  });

  it('ไม่พบผู้ใช้ → 401 และไม่ตั้ง cookie', async () => {
    mockGetUserById.mockResolvedValue(null);
    const { req, res } = loginMocks();
    await loginHandler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(res.getHeader('Set-Cookie')).toBeUndefined();
  });

  // TD-C02 follow-up: endpoint นี้ public โดยเจตนา — ไม่มี header ใด ๆ ก็ต้องล็อกอินได้ตามปกติ
  // และ Authorization header มั่ว ๆ ก็ต้องไม่ถูกปฏิเสธ (ไม่มีชั้น token ให้ตรวจแล้ว)
  it('ไม่มี Authorization header เลย → ยังล็อกอินสำเร็จและได้ cookie', async () => {
    const { req, res } = loginMocks(undefined, {});
    await loginHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(readCookie(res, 'ft_session')).toBeDefined();
  });

  it('Authorization header มั่ว ๆ → ถูกเมิน ยังล็อกอินสำเร็จ', async () => {
    const { req, res } = loginMocks(undefined, { authorization: 'Bearer garbage' });
    await loginHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(readCookie(res, 'ft_session')).toBeDefined();
  });

  it('รหัสผ่านผิดแม้ไม่มี header → ยัง 401 (ด่านจริงคือรหัสผ่าน ไม่ใช่ token)', async () => {
    mockCheckUserPassword.mockResolvedValue(false);
    const { req, res } = loginMocks(undefined, {});
    await loginHandler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(res.getHeader('Set-Cookie')).toBeUndefined();
  });

  it('method ไม่ใช่ POST → 405 และไม่ตั้ง cookie', async () => {
    const { req, res } = createMocks({ method: 'GET', headers: baseHeaders });
    await loginHandler(req, res);
    expect(res._getStatusCode()).toBe(405);
    expect(res.getHeader('Set-Cookie')).toBeUndefined();
  });

  it('ไม่ส่ง userId/password → 400 และไม่ตั้ง cookie', async () => {
    const { req, res } = createMocks({ method: 'POST', headers: baseHeaders, body: {} });
    await loginHandler(req, res);
    expect(res._getStatusCode()).toBe(400);
    expect(res.getHeader('Set-Cookie')).toBeUndefined();
  });

  it('ไม่มี SESSION_SECRET → 500 ดัง ๆ ไม่ใช่ 200 พร้อม cookie ที่ใช้ไม่ได้ (deploy blocker จริง)', async () => {
    delete process.env.SESSION_SECRET;
    const { req, res } = loginMocks();
    await loginHandler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(res.getHeader('Set-Cookie')).toBeUndefined();
    expect(res._getJSONData().success).toBeUndefined();
  });

  // TD-H09: demo account passwordless branch — gated strictly on the server-read `user.isDemo`
  // flag, never on anything the client sends.
  describe('demo account (isDemo: true) — passwordless branch', () => {
    it('ล็อกอินสำเร็จโดยไม่ต้องรหัสผ่านถูก — checkUserPassword ไม่ถูกเรียกเลย', async () => {
      mockGetUserById.mockResolvedValue({
        id: 'demo',
        displayName: 'บัญชีสาธิต (Demo)',
        avatar: '',
        isDemo: true,
        passwordHash: null
      });
      mockCheckUserPassword.mockResolvedValue(false); // ต้องไม่ถูกเรียก/ไม่ถูกอ้างอิงเลย

      const { req, res } = createMocks({
        method: 'POST',
        headers: baseHeaders,
        body: { userId: 'demo', password: 'anything-non-empty' }
      });
      await loginHandler(req, res);

      expect(res._getStatusCode()).toBe(200);
      expect(mockCheckUserPassword).not.toHaveBeenCalled();
      expect(res._getJSONData()).toEqual({
        success: true,
        user: { id: 'demo', displayName: 'บัญชีสาธิต (Demo)', avatar: '', isDemo: true }
      });
      expect(readCookie(res, 'ft_session')).toBeDefined();
      expect(readCookie(res, 'ft_csrf')).toBeDefined();
    });

    it('ยังต้องส่ง password (non-empty) ตาม guard เดิม — ค่าจริงไม่ถูกตรวจสอบ', async () => {
      mockGetUserById.mockResolvedValue({ id: 'demo', displayName: 'Demo', avatar: '', isDemo: true });
      const { req, res } = createMocks({
        method: 'POST',
        headers: baseHeaders,
        body: { userId: 'demo', password: '' }
      });
      await loginHandler(req, res);

      expect(res._getStatusCode()).toBe(400);
      expect(mockCheckUserPassword).not.toHaveBeenCalled();
    });

    // Core security regression: a non-demo user cannot bypass the password gate by any means —
    // the branch is keyed off the server-read `user.isDemo` value, not a client-supplied field.
    it('user ธรรมดา (isDemo falsy) ต้องยังผ่าน checkUserPassword เสมอ แม้ client จะพยายามส่ง isDemo/role มาด้วย', async () => {
      mockGetUserById.mockResolvedValue({
        id: 'u001',
        displayName: 'Supakorn',
        avatar: '/a.png',
        isDemo: undefined
      });
      mockCheckUserPassword.mockResolvedValue(false);

      const { req, res } = createMocks({
        method: 'POST',
        headers: baseHeaders,
        // ผู้ใช้ (หรือ client ที่ถูกดัดแปลง) ลองอ้าง isDemo/role ผ่าน request body — ต้องไม่มีผลใด ๆ
        // เพราะ handler อ่านค่า isDemo จาก user record ฝั่งเซิร์ฟเวอร์เท่านั้น ไม่เคยอ่านจาก req.body
        body: { userId: 'u001', password: 'wrong-password', isDemo: true, role: 'demo' }
      });
      await loginHandler(req, res);

      expect(mockCheckUserPassword).toHaveBeenCalledWith('u001', 'wrong-password');
      expect(res._getStatusCode()).toBe(401);
      expect(res.getHeader('Set-Cookie')).toBeUndefined();
    });
  });

  it('login ซ้ำ → cookie ใหม่ทุกครั้ง และยัง verify ผ่าน', async () => {
    const first = loginMocks();
    await loginHandler(first.req, first.res);
    const tokenA = cookieValue(readCookie(first.res, 'ft_session'), 'ft_session');

    await new Promise(resolve => setTimeout(resolve, 5));

    const second = loginMocks();
    await loginHandler(second.req, second.res);
    const tokenB = cookieValue(readCookie(second.res, 'ft_session'), 'ft_session');

    expect(tokenA).not.toBe(tokenB);
    expect(verifySession(tokenB)).toMatchObject({ userId: 'u001' });
  });
});

describe('POST /api/auth/logout — session cookie clearing', () => {
  it('ล้างทั้ง ft_session และ ft_csrf ด้วย Max-Age=0 และตอบ 200', async () => {
    const { req, res } = createMocks({ method: 'POST', headers: baseHeaders });
    await logoutHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({ success: true });
    const sessionCookie = readCookie(res, 'ft_session');
    expect(sessionCookie).toContain('ft_session=;');
    expect(sessionCookie).toContain('Max-Age=0');
    expect(sessionCookie).toContain('Path=/');
    expect(sessionCookie).toContain('HttpOnly');

    const csrfCookie = readCookie(res, 'ft_csrf');
    expect(csrfCookie).toContain('ft_csrf=;');
    expect(csrfCookie).toContain('Max-Age=0');
    expect(csrfCookie).not.toContain('HttpOnly');
  });

  it('สำเร็จแม้ไม่มี session cookie อยู่เลย (idempotent)', async () => {
    const { req, res } = createMocks({ method: 'POST', headers: baseHeaders, cookies: {} });
    await logoutHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
  });

  it('สำเร็จแม้ cookie ที่ส่งมาหมดอายุ/ปลอม (ไม่บังคับ session ที่ valid)', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      headers: baseHeaders,
      cookies: { ft_session: 'garbage.garbage' }
    });
    await logoutHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
    expect(String(res.getHeader('Set-Cookie'))).toContain('Max-Age=0');
  });

  it('สำเร็จแม้ไม่มี SESSION_SECRET (logout ต้องไม่พังเพราะ misconfig)', async () => {
    delete process.env.SESSION_SECRET;
    const { req, res } = createMocks({ method: 'POST', headers: baseHeaders });
    await logoutHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
    expect(String(res.getHeader('Set-Cookie'))).toContain('Max-Age=0');
  });

  // TD-C02 follow-up: logout ต้องสำเร็จได้เสมอ รวมถึงตอนไม่มี header ใด ๆ — ผลของมันคือล้าง cookie
  // เท่านั้น ไม่มีผลต่อ confidentiality/integrity ของข้อมูล
  it('ไม่มี Authorization header เลย → ยัง 200 และล้าง cookie ตามปกติ', async () => {
    const { req, res } = createMocks({ method: 'POST', headers: {} });
    await logoutHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
    expect(String(res.getHeader('Set-Cookie'))).toContain('Max-Age=0');
  });

  it('GET → 405 พร้อม Allow: POST', async () => {
    const { req, res } = createMocks({ method: 'GET', headers: baseHeaders });
    await logoutHandler(req, res);
    expect(res._getStatusCode()).toBe(405);
    expect(res.getHeader('Allow')).toEqual(['POST']);
    expect(res.getHeader('Set-Cookie')).toBeUndefined();
  });

  it('login แล้ว logout → token เดิมยังถูกต้องทางคริปโต (stateless, ไม่มี server-side revocation)', async () => {
    mockGetUserById.mockResolvedValue({ id: 'u001', displayName: 'A', avatar: null });
    mockCheckUserPassword.mockResolvedValue(true);
    const login = loginMocks();
    await loginHandler(login.req, login.res);
    const token = cookieValue(readCookie(login.res, 'ft_session'), 'ft_session');

    const logout = createMocks({ method: 'POST', headers: baseHeaders });
    await logoutHandler(logout.req, logout.res);

    // เอกสารพฤติกรรมจริง: logout ล้างเฉพาะฝั่ง browser — token ที่ถูกก๊อปไว้ยังใช้ได้จนหมดอายุ
    expect(verifySession(token)).toMatchObject({ userId: 'u001' });
  });
});
