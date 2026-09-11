/**
 * @jest-environment node
 *
 * Stage 4 tests — TD-C02 session cookie (src/shared/utils/backend/sessionCookie.js)
 * ปรับตาม Increment B2/B3: payload มี `sid`, verifySession คืน { userId, sid, exp } และมี CSRF token
 *
 * เน้นพิสูจน์สิ่งที่เป็น security-critical:
 * 1. HMAC สร้าง/ตรวจถูกต้อง และของปลอมทุกรูปแบบถูกปฏิเสธ
 * 2. verifySession คืน null (ไม่ throw / ไม่ผ่านเงียบ ๆ) สำหรับ input ที่ผู้โจมตีควบคุมได้
 * 3. charset gate ของ base64url ปิด malleability (อักขระนอกชุดต้องถูกปฏิเสธ ไม่ใช่ถูก decoder ข้ามทิ้ง)
 * 4. CSRF token ผูกกับ sid, domain-separated, ปลอมไม่ได้
 * 5. ไม่มี SESSION_SECRET แล้ว fail closed จริง (throw) ไม่ใช่ออก cookie ที่ใช้ไม่ได้
 */

import crypto from 'crypto';
import {
  signSession,
  verifySession,
  createSessionId,
  signCsrfToken,
  verifyCsrfToken,
  buildSessionCookie,
  buildClearedSessionCookie,
  buildCsrfCookie,
  buildClearedCsrfCookie,
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  SESSION_TIMEOUT_MS
} from '../../../../src/shared/utils/backend/sessionCookie';

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const TEST_SID = 'test-sid_0123456789AB';

const b64url = value => Buffer.from(value, 'utf-8').toString('base64url');
const decodePayload = token => JSON.parse(
  Buffer.from(token.split('.')[0], 'base64url').toString('utf-8')
);

/** เซ็น payload เองด้วย secret ที่กำหนด เพื่อจำลองผู้โจมตี/ระบบอื่น */
function forgeToken(payloadObject, secret) {
  const encodedPayload = b64url(JSON.stringify(payloadObject));
  const signature = crypto.createHmac('sha256', secret)
    .update(encodedPayload)
    .digest()
    .toString('base64url');
  return `${encodedPayload}.${signature}`;
}

describe('sessionCookie', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SESSION_SECRET = TEST_SECRET;
    delete process.env.NODE_ENV_OVERRIDE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  describe('createSessionId', () => {
    it('คืน base64url 16 ไบต์ และสุ่มไม่ซ้ำกัน', () => {
      const a = createSessionId();
      const b = createSessionId();
      expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(Buffer.from(a, 'base64url')).toHaveLength(16);
      expect(a).not.toBe(b);
    });
  });

  describe('signSession — happy path', () => {
    it('ออก token รูปแบบ payload.signature และ round-trip กลับเป็น userId/sid เดิม', () => {
      const token = signSession('u001', TEST_SID);
      expect(token.split('.')).toHaveLength(2);
      expect(verifySession(token)).toMatchObject({ userId: 'u001', sid: TEST_SID });
    });

    it('payload มี userId/sid/iat/exp และ exp = iat + SESSION_TIMEOUT_MS', () => {
      const before = Date.now();
      const payload = decodePayload(signSession('u001', TEST_SID));
      const after = Date.now();

      expect(payload.userId).toBe('u001');
      expect(payload.sid).toBe(TEST_SID);
      expect(payload.iat).toBeGreaterThanOrEqual(before);
      expect(payload.iat).toBeLessThanOrEqual(after);
      expect(payload.exp - payload.iat).toBe(SESSION_TIMEOUT_MS);
      expect(SESSION_TIMEOUT_MS).toBe(60 * 60 * 1000);
    });

    it('verifySession คืน exp ตรงกับ payload (ใช้คำนวณ sliding renewal ฝั่ง userRequest)', () => {
      const token = signSession('u001', TEST_SID);
      expect(verifySession(token).exp).toBe(decodePayload(token).exp);
    });

    it('signature ตรงกับ HMAC-SHA256(encodedPayload, SESSION_SECRET) ที่คำนวณอิสระ', () => {
      const token = signSession('u001', TEST_SID);
      const [encodedPayload, signature] = token.split('.');
      const expected = crypto.createHmac('sha256', TEST_SECRET)
        .update(encodedPayload)
        .digest()
        .toString('base64url');
      expect(signature).toBe(expected);
      // 32 ไบต์ = SHA-256 เต็มความยาว ไม่ได้ถูกตัดทอน
      expect(Buffer.from(signature, 'base64url')).toHaveLength(32);
    });

    it('trim userId และปฏิเสธ userId ว่าง/ผิดชนิด', () => {
      expect(decodePayload(signSession('  u002  ', TEST_SID)).userId).toBe('u002');
      expect(() => signSession('', TEST_SID)).toThrow(/non-empty userId/);
      expect(() => signSession('   ', TEST_SID)).toThrow(/non-empty userId/);
      expect(() => signSession(null, TEST_SID)).toThrow(/non-empty userId/);
      expect(() => signSession(123, TEST_SID)).toThrow(/non-empty userId/);
      expect(() => signSession(undefined, TEST_SID)).toThrow(/non-empty userId/);
    });

    it('ปฏิเสธ sid ที่ขาด/ผิดชนิด/มีอักขระนอก base64url', () => {
      expect(() => signSession('u001')).toThrow(/valid sid/);
      expect(() => signSession('u001', '')).toThrow(/valid sid/);
      expect(() => signSession('u001', null)).toThrow(/valid sid/);
      expect(() => signSession('u001', 123)).toThrow(/valid sid/);
      expect(() => signSession('u001', 'has space')).toThrow(/valid sid/);
      expect(() => signSession('u001', 'semi;colon')).toThrow(/valid sid/);
    });

    it('token คนละ user ตรวจแล้วได้ userId ของตัวเอง ไม่ปนกัน', () => {
      expect(verifySession(signSession('u001', TEST_SID)).userId).toBe('u001');
      expect(verifySession(signSession('u002', TEST_SID)).userId).toBe('u002');
    });
  });

  describe('verifySession — ปฏิเสธของปลอม (คืน null ไม่ throw)', () => {
    it('payload ถูกแก้ (สลับ userId) → null', () => {
      const token = signSession('u001', TEST_SID);
      const signature = token.split('.')[1];
      const tamperedPayload = b64url(JSON.stringify({
        userId: 'u002',
        sid: TEST_SID,
        iat: Date.now(),
        exp: Date.now() + SESSION_TIMEOUT_MS
      }));
      expect(verifySession(`${tamperedPayload}.${signature}`)).toBeNull();
    });

    it('signature ถูกแก้ 1 ตัวอักษร → null', () => {
      const [encodedPayload, signature] = signSession('u001', TEST_SID).split('.');
      const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
      expect(verifySession(`${encodedPayload}.${flipped}`)).toBeNull();
    });

    it('เซ็นด้วย secret ผิด → null', () => {
      const forged = forgeToken(
        { userId: 'u001', sid: TEST_SID, iat: Date.now(), exp: Date.now() + SESSION_TIMEOUT_MS },
        'attacker-secret'
      );
      expect(verifySession(forged)).toBeNull();
    });

    it('secret ของเซิร์ฟเวอร์เปลี่ยน → token เก่าใช้ไม่ได้', () => {
      const token = signSession('u001', TEST_SID);
      process.env.SESSION_SECRET = 'rotated-secret';
      expect(verifySession(token)).toBeNull();
    });

    it('signature ที่ยาว/สั้นผิดปกติ → null (length guard ไม่ทำให้ timingSafeEqual โยน error)', () => {
      const [encodedPayload, signature] = signSession('u001', TEST_SID).split('.');
      expect(verifySession(`${encodedPayload}.`)).toBeNull();
      expect(verifySession(`${encodedPayload}.AA`)).toBeNull();
      expect(verifySession(`${encodedPayload}.${signature}${signature}`)).toBeNull();
      expect(verifySession(`${encodedPayload}.${signature.slice(0, 10)}`)).toBeNull();
    });

    it('alg=none style / payload อย่างเดียวไม่มี signature → null', () => {
      const encodedPayload = b64url(JSON.stringify({
        userId: 'u001',
        sid: TEST_SID,
        iat: Date.now(),
        exp: Date.now() + SESSION_TIMEOUT_MS
      }));
      expect(verifySession(encodedPayload)).toBeNull();
      expect(verifySession(`${encodedPayload}.`)).toBeNull();
      expect(verifySession(`.${encodedPayload}`)).toBeNull();
    });

    it('จำนวน part ผิด (0, 1, 3 จุด) → null', () => {
      const token = signSession('u001', TEST_SID);
      expect(verifySession('nodot')).toBeNull();
      expect(verifySession(`${token}.extra`)).toBeNull();
      expect(verifySession('a.b.c')).toBeNull();
    });

    it('base64url malleability: อักขระนอกชุด (=, +, /, ช่องว่าง, ขึ้นบรรทัดใหม่) → null', () => {
      const token = signSession('u001', TEST_SID);
      const [encodedPayload, signature] = token.split('.');
      // Node decoder เดิมจะข้ามอักขระเหล่านี้ทิ้ง ทำให้ token หลายหน้าตาผ่านเป็นอันเดียวกัน
      ['=', '+', '/', ' ', '\n', '*', '%'].forEach(junk => {
        expect(verifySession(`${encodedPayload}.${signature}${junk}`)).toBeNull();
        expect(verifySession(`${encodedPayload}${junk}.${signature}`)).toBeNull();
      });
      // sanity: ตัว token จริงยังผ่าน
      expect(verifySession(token).userId).toBe('u001');
    });

    it('payload ที่ไม่มี sid (token รุ่น B1) → null เพื่อบังคับ login ใหม่หนึ่งครั้ง', () => {
      const now = Date.now();
      const legacy = forgeToken({ userId: 'u001', iat: now, exp: now + SESSION_TIMEOUT_MS }, TEST_SECRET);
      expect(verifySession(legacy)).toBeNull();
    });

    it('sid ผิดชนิด/ว่าง/มีอักขระนอก base64url แม้เซ็นถูก → null', () => {
      const now = Date.now();
      [null, '', 123, { sid: 'x' }, ['abc'], 'has space', 'semi;colon'].forEach(sid => {
        const token = forgeToken({ userId: 'u001', sid, iat: now, exp: now + SESSION_TIMEOUT_MS }, TEST_SECRET);
        expect(verifySession(token)).toBeNull();
      });
    });
  });

  describe('verifySession — payload ผิดรูป / หมดอายุ', () => {
    it('หมดอายุแล้ว (exp อยู่ในอดีต) แม้ signature ถูกต้อง → null', () => {
      const now = Date.now();
      const expired = forgeToken(
        { userId: 'u001', sid: TEST_SID, iat: now - SESSION_TIMEOUT_MS * 2, exp: now - 1000 },
        TEST_SECRET
      );
      expect(verifySession(expired)).toBeNull();
    });

    it('exp = เวลาปัจจุบันพอดี → null (boundary, ไม่ให้ผ่าน)', () => {
      const now = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);
      const token = forgeToken({ userId: 'u001', sid: TEST_SID, iat: now - 1000, exp: now }, TEST_SECRET);
      expect(verifySession(token)).toBeNull();
    });

    it('exp อีก 1ms → ยังผ่าน (boundary อีกฝั่ง)', () => {
      const now = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);
      const token = forgeToken({ userId: 'u001', sid: TEST_SID, iat: now - 1000, exp: now + 1 }, TEST_SECRET);
      expect(verifySession(token).userId).toBe('u001');
    });

    it('payload ไม่ใช่ JSON แม้เซ็นถูก → null (ไม่ throw)', () => {
      const encodedPayload = b64url('this-is-not-json{{{');
      const signature = crypto.createHmac('sha256', TEST_SECRET)
        .update(encodedPayload).digest().toString('base64url');
      expect(verifySession(`${encodedPayload}.${signature}`)).toBeNull();
    });

    it('payload เป็น JSON แต่ไม่ใช่ object (null/array/number/string) → null', () => {
      ['null', '[]', '42', '"u001"', 'true'].forEach(raw => {
        const encodedPayload = b64url(raw);
        const signature = crypto.createHmac('sha256', TEST_SECRET)
          .update(encodedPayload).digest().toString('base64url');
        const result = verifySession(`${encodedPayload}.${signature}`);
        expect(result).toBeNull();
      });
    });

    it('ไม่มี userId / userId ว่าง / userId ผิดชนิด → null', () => {
      const now = Date.now();
      const cases = [
        { sid: TEST_SID, iat: now, exp: now + 1000 },
        { userId: '', sid: TEST_SID, iat: now, exp: now + 1000 },
        { userId: null, sid: TEST_SID, iat: now, exp: now + 1000 },
        { userId: 123, sid: TEST_SID, iat: now, exp: now + 1000 },
        { userId: { id: 'u001' }, sid: TEST_SID, iat: now, exp: now + 1000 },
        { userId: ['u001'], sid: TEST_SID, iat: now, exp: now + 1000 }
      ];
      cases.forEach(payload => {
        expect(verifySession(forgeToken(payload, TEST_SECRET))).toBeNull();
      });
    });

    it('exp หาย / ไม่ใช่ number / NaN / Infinity / string → null', () => {
      const now = Date.now();
      const cases = [
        { userId: 'u001', sid: TEST_SID, iat: now },
        { userId: 'u001', sid: TEST_SID, iat: now, exp: null },
        { userId: 'u001', sid: TEST_SID, iat: now, exp: `${now + 100000}` },
        { userId: 'u001', sid: TEST_SID, iat: now, exp: Number.POSITIVE_INFINITY },
        { userId: 'u001', sid: TEST_SID, iat: now, exp: true }
      ];
      cases.forEach(payload => {
        expect(verifySession(forgeToken(payload, TEST_SECRET))).toBeNull();
      });
      // NaN ผ่าน JSON.stringify กลายเป็น null → ครอบคลุมโดยเคส exp: null ข้างบน
    });

    it('input ผิดชนิด/ว่าง → null ไม่ throw', () => {
      [undefined, null, '', 0, false, 123, {}, [], () => {}, Symbol('x')].forEach(input => {
        expect(() => verifySession(input)).not.toThrow();
        expect(verifySession(input)).toBeNull();
      });
    });

    it('สตริงขยะ/อักขระพิเศษ/ยาวมาก → null ไม่ throw', () => {
      const junk = [
        '....',
        '%%%.%%%',
        `${'A'.repeat(10000)}.${'B'.repeat(10000)}`,
        ' . ',
        'ft_session=abc; Path=/',
        '../../etc/passwd.sig'
      ];
      junk.forEach(input => {
        expect(() => verifySession(input)).not.toThrow();
        expect(verifySession(input)).toBeNull();
      });
    });
  });

  describe('CSRF token — signCsrfToken / verifyCsrfToken', () => {
    it('deterministic ต่อ sid หนึ่ง ๆ และต่างกันเมื่อ sid ต่าง', () => {
      const other = createSessionId();
      expect(signCsrfToken(TEST_SID)).toBe(signCsrfToken(TEST_SID));
      expect(signCsrfToken(TEST_SID)).not.toBe(signCsrfToken(other));
    });

    it('domain separation: ไม่เท่ากับ HMAC ของ sid เปล่า ๆ (secret เดียวแต่คนละวัตถุประสงค์)', () => {
      const withoutPrefix = crypto.createHmac('sha256', TEST_SECRET)
        .update(TEST_SID).digest().toString('base64url');
      const expected = crypto.createHmac('sha256', TEST_SECRET)
        .update(`csrf:${TEST_SID}`).digest().toString('base64url');
      expect(signCsrfToken(TEST_SID)).toBe(expected);
      expect(signCsrfToken(TEST_SID)).not.toBe(withoutPrefix);
    });

    it('token ที่ถูกต้อง → true', () => {
      expect(verifyCsrfToken(TEST_SID, signCsrfToken(TEST_SID))).toBe(true);
    });

    it('token ของ sid อื่น → false (ผูก session ต่อ session จริง)', () => {
      const other = createSessionId();
      expect(verifyCsrfToken(TEST_SID, signCsrfToken(other))).toBe(false);
    });

    it('token ผิด/ว่าง/ผิดชนิด/มีอักขระนอก base64url → false ไม่ throw', () => {
      [undefined, null, '', 0, false, 123, {}, [], 'not-a-token=', 'aa bb', signCsrfToken(TEST_SID).slice(0, 10)]
        .forEach(bad => {
          expect(() => verifyCsrfToken(TEST_SID, bad)).not.toThrow();
          expect(verifyCsrfToken(TEST_SID, bad)).toBe(false);
        });
    });

    it('sid ผิดรูป → false ไม่ throw (ไม่หลุดไปคำนวณ HMAC)', () => {
      [undefined, null, '', 'has space', 123].forEach(badSid => {
        expect(() => verifyCsrfToken(badSid, signCsrfToken(TEST_SID))).not.toThrow();
        expect(verifyCsrfToken(badSid, signCsrfToken(TEST_SID))).toBe(false);
      });
    });

    it('เซ็นด้วย secret อื่น (ผู้โจมตีเดา sid ได้แต่ไม่มี secret) → false', () => {
      const forged = crypto.createHmac('sha256', 'attacker-secret')
        .update(`csrf:${TEST_SID}`).digest().toString('base64url');
      expect(verifyCsrfToken(TEST_SID, forged)).toBe(false);
    });

    it('signCsrfToken ปฏิเสธ sid ผิดรูป และ throw เมื่อไม่มี SESSION_SECRET', () => {
      expect(() => signCsrfToken('bad sid')).toThrow(/valid sid/);
      delete process.env.SESSION_SECRET;
      expect(() => signCsrfToken(TEST_SID)).toThrow(/SESSION_SECRET is not configured/);
    });
  });

  describe('fail-closed เมื่อไม่มี SESSION_SECRET', () => {
    it('signSession throw (ไม่คืน token ที่ใช้ไม่ได้)', () => {
      delete process.env.SESSION_SECRET;
      expect(() => signSession('u001', TEST_SID)).toThrow(/SESSION_SECRET is not configured/);
    });

    it('SESSION_SECRET เป็นสตริงว่าง/ช่องว่างล้วน ก็ throw เช่นกัน', () => {
      process.env.SESSION_SECRET = '';
      expect(() => signSession('u001', TEST_SID)).toThrow(/SESSION_SECRET is not configured/);
      process.env.SESSION_SECRET = '    ';
      expect(() => signSession('u001', TEST_SID)).toThrow(/SESSION_SECRET is not configured/);
    });

    it('buildSessionCookie/buildCsrfCookie throw ด้วย → login จะพังดัง ๆ (500) ไม่ใช่ set cookie เปล่า', () => {
      delete process.env.SESSION_SECRET;
      expect(() => buildSessionCookie('u001', { sid: TEST_SID })).toThrow(/SESSION_SECRET is not configured/);
      expect(() => buildCsrfCookie(TEST_SID)).toThrow(/SESSION_SECRET is not configured/);
    });

    it('verifySession throw เมื่อ misconfigure (ไม่กลืนเป็น "session หมดอายุ")', () => {
      const token = signSession('u001', TEST_SID);
      delete process.env.SESSION_SECRET;
      expect(() => verifySession(token)).toThrow(/SESSION_SECRET is not configured/);
    });

    it('buildClearedSessionCookie/buildClearedCsrfCookie ยังทำงานได้แม้ไม่มี secret → logout ไม่พัง', () => {
      delete process.env.SESSION_SECRET;
      expect(() => buildClearedSessionCookie()).not.toThrow();
      expect(buildClearedSessionCookie()).toContain(`${SESSION_COOKIE_NAME}=;`);
      expect(() => buildClearedCsrfCookie()).not.toThrow();
      expect(buildClearedCsrfCookie()).toContain(`${CSRF_COOKIE_NAME}=;`);
    });
  });

  describe('buildSessionCookie — Set-Cookie attributes', () => {
    it('มี Path=/, HttpOnly, SameSite=Lax, Max-Age=3600 และชื่อ ft_session', () => {
      const cookie = buildSessionCookie('u001', { sid: TEST_SID });
      expect(SESSION_COOKIE_NAME).toBe('ft_session');
      expect(cookie.startsWith('ft_session=')).toBe(true);
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Max-Age=3600');
    });

    it('ค่า token ใน cookie ไม่มีอักขระที่ทำให้ header แตก (; , space, CR/LF)', () => {
      const value = buildSessionCookie('u001', { sid: TEST_SID }).split(';')[0].slice('ft_session='.length);
      expect(value).toMatch(/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/);
      expect(verifySession(value)).toMatchObject({ userId: 'u001', sid: TEST_SID });
    });

    it('ไม่มี Secure ใน dev/test (ไม่งั้น browser บน http จะทิ้ง cookie)', () => {
      expect(buildSessionCookie('u001', { sid: TEST_SID })).not.toContain('Secure');
      expect(buildCsrfCookie(TEST_SID)).not.toContain('Secure');
    });

    it('มี Secure เมื่อ NODE_ENV=production', () => {
      const descriptor = Object.getOwnPropertyDescriptor(process.env, 'NODE_ENV');
      Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true });
      try {
        expect(buildSessionCookie('u001', { sid: TEST_SID })).toContain('Secure');
        expect(buildClearedSessionCookie()).toContain('Secure');
        expect(buildCsrfCookie(TEST_SID)).toContain('Secure');
        expect(buildClearedCsrfCookie()).toContain('Secure');
      } finally {
        if (descriptor) Object.defineProperty(process.env, 'NODE_ENV', descriptor);
      }
    });

    it('override sameSite ได้ผ่าน options', () => {
      expect(buildSessionCookie('u001', { sid: TEST_SID, sameSite: 'Strict' })).toContain('SameSite=Strict');
      expect(buildCsrfCookie(TEST_SID, { sameSite: 'Strict' })).toContain('SameSite=Strict');
    });

    it('ไม่มี sid → throw (ไม่ออก cookie ที่ CSRF ตรวจไม่ได้)', () => {
      expect(() => buildSessionCookie('u001')).toThrow(/valid sid/);
    });
  });

  describe('buildCsrfCookie — Set-Cookie attributes', () => {
    it('ชื่อ ft_csrf, ไม่มี HttpOnly (JS ต้องอ่านได้), Path=/, SameSite=Lax, Max-Age เท่ากับ session', () => {
      const cookie = buildCsrfCookie(TEST_SID);
      expect(CSRF_COOKIE_NAME).toBe('ft_csrf');
      expect(cookie.startsWith('ft_csrf=')).toBe(true);
      expect(cookie).not.toContain('HttpOnly');
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Max-Age=3600');
    });

    it('ค่าใน cookie คือ token ที่ verify ผ่านกับ sid เดียวกัน และไม่มีอักขระที่ทำให้ header แตก', () => {
      const value = buildCsrfCookie(TEST_SID).split(';')[0].slice('ft_csrf='.length);
      expect(value).toMatch(/^[A-Za-z0-9\-_]+$/);
      expect(verifyCsrfToken(TEST_SID, value)).toBe(true);
    });
  });

  describe('buildClearedSessionCookie / buildClearedCsrfCookie', () => {
    it('ล้าง cookie ด้วยค่าว่าง + Max-Age=0 และ Path=/ ตรงกับตอนออก', () => {
      const cleared = buildClearedSessionCookie();
      expect(cleared).toContain('ft_session=;');
      expect(cleared).toContain('Max-Age=0');
      expect(cleared).toContain('Path=/');
      expect(cleared).toContain('HttpOnly');
    });

    it('Path/HttpOnly/SameSite ตรงกับ cookie ที่ออกตอน login (ไม่งั้นลบไม่ติด)', () => {
      const attrsOf = cookie => cookie.split('; ').slice(1)
        .filter(a => !a.startsWith('Max-Age='))
        .sort();
      expect(attrsOf(buildClearedSessionCookie())).toEqual(attrsOf(buildSessionCookie('u001', { sid: TEST_SID })));
      expect(attrsOf(buildClearedCsrfCookie())).toEqual(attrsOf(buildCsrfCookie(TEST_SID)));
    });

    it('cleared csrf cookie ไม่มี HttpOnly เช่นเดียวกับตอนออก', () => {
      expect(buildClearedCsrfCookie()).not.toContain('HttpOnly');
      expect(buildClearedCsrfCookie()).toContain('Max-Age=0');
    });
  });
});
