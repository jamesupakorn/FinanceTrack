/**
 * Session cookie (TD-C02 Increment B1 → B2/B3)
 *
 * ออก/ตรวจสอบ session token แบบ HMAC-SHA256 ด้วย `crypto` ของ Node (ไม่พึ่ง dependency ใหม่)
 * รูปแบบ token: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, SESSION_SECRET))
 *
 * B2/B3 เพิ่ม:
 * - payload มี `sid` (session id สุ่ม) ออกครั้งเดียวตอน login และคงเดิมตลอด sliding renewal
 * - CSRF token แบบ signed double-submit cookie ผูกกับ `sid` (ft_csrf, อ่านได้จาก JS)
 * - charset gate ของ base64url ก่อน decode เพื่อปิด malleability ของ decoder ที่ยอมรับอักขระเกิน
 */

import crypto from 'crypto';

export const SESSION_COOKIE_NAME = 'ft_session';
export const CSRF_COOKIE_NAME = 'ft_csrf';
export const SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 60 นาที ให้ตรงกับ SessionContext ฝั่ง client

const SIGNATURE_SEPARATOR = '.';
const DEFAULT_SAME_SITE = 'Lax'; // Lax + CSRF token (defense-in-depth) ตามที่ผู้ใช้เลือกไว้
// Node's base64url decoder ยอมรับอักขระนอกชุดแล้วข้ามทิ้งเงียบ ๆ ทำให้ token หลายหน้าตาถูก decode
// เป็นค่าเดียวกัน (malleability) — gate ด้วย charset ก่อน decode ทุกครั้ง
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const CSRF_DOMAIN_PREFIX = 'csrf:'; // domain separation: secret เดียวกันแต่คนละวัตถุประสงค์

function isBase64Url(value) {
  return typeof value === 'string' && BASE64URL_PATTERN.test(value);
}

/**
 * อ่าน SESSION_SECRET แบบ fail-closed
 * ถ้าไม่ตั้งค่าไว้ จะ throw เพื่อให้ handler ตอบ 500 แทนการ fallback ไปใช้ค่า default ที่ไม่ปลอดภัย
 */
function getSessionSecret() {
  const secret = typeof process.env.SESSION_SECRET === 'string'
    ? process.env.SESSION_SECRET.trim()
    : '';
  if (!secret) {
    throw new Error('SESSION_SECRET is not configured');
  }
  return secret;
}

function signPayload(encodedPayload, secret) {
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest();
}

function safeEqual(a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b) || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * สร้าง session id ใหม่ (ออกครั้งเดียวตอน login, คงเดิมตลอดการต่ออายุแบบ sliding)
 * ใช้เป็นตัวผูก CSRF token เข้ากับ session หนึ่ง ๆ
 * @returns {string} random id แบบ base64url (16 ไบต์)
 */
export function createSessionId() {
  return crypto.randomBytes(16).toString('base64url');
}

/**
 * สร้าง session token ที่เซ็นแล้วสำหรับผู้ใช้หนึ่งคน
 * @param {string} userId
 * @param {string} sid - session id จาก createSessionId() (login) หรือ sid เดิม (renewal)
 * @returns {string} ค่าที่จะใส่ใน cookie
 * @throws {Error} เมื่อ userId/sid ไม่ถูกต้อง หรือไม่ได้ตั้ง SESSION_SECRET
 */
export function signSession(userId, sid) {
  if (typeof userId !== 'string' || !userId.trim()) {
    throw new Error('signSession requires a non-empty userId');
  }
  if (!isBase64Url(sid)) {
    throw new Error('signSession requires a valid sid');
  }

  const secret = getSessionSecret();
  const issuedAt = Date.now();
  const payload = {
    userId: userId.trim(),
    sid,
    iat: issuedAt,
    exp: issuedAt + SESSION_TIMEOUT_MS
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const signature = signPayload(encodedPayload, secret).toString('base64url');
  return `${encodedPayload}${SIGNATURE_SEPARATOR}${signature}`;
}

/**
 * ตรวจสอบ session token แล้วคืนข้อมูล session
 * ไม่ throw สำหรับข้อมูลที่ผู้โจมตีควบคุมได้ (คืน null แทน) แต่ยัง throw เมื่อระบบตั้งค่าผิด
 * (ไม่มี SESSION_SECRET) เพื่อให้ misconfiguration ไม่ถูกกลืนเป็น "session หมดอายุ"
 * @param {string} cookieValue
 * @returns {{ userId: string, sid: string, exp: number }|null} null เมื่อ token ไม่ถูกต้อง/หมดอายุ
 */
export function verifySession(cookieValue) {
  if (typeof cookieValue !== 'string' || !cookieValue) return null;

  const secret = getSessionSecret();
  const parts = cookieValue.split(SIGNATURE_SEPARATOR);
  if (parts.length !== 2) return null;

  const [encodedPayload, encodedSignature] = parts;
  // charset gate ทั้งสองส่วนก่อน decode — ปิด malleability (ดูคอมเมนต์ BASE64URL_PATTERN)
  if (!isBase64Url(encodedPayload) || !isBase64Url(encodedSignature)) return null;

  const expectedSignature = signPayload(encodedPayload, secret);
  const providedSignature = Buffer.from(encodedSignature, 'base64url');
  if (!safeEqual(expectedSignature, providedSignature)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf-8'));
  } catch (error) {
    return null;
  }

  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.userId !== 'string' || !payload.userId) return null;
  // sid ต้องมีเสมอ — token รุ่น B1 (ไม่มี sid) ถูกปฏิเสธโดยตั้งใจ ผู้ใช้ต้อง login ใหม่หนึ่งครั้ง
  // (rollout constraint ใน spec) ไม่งั้น CSRF check จะได้ sid = undefined
  if (!isBase64Url(payload.sid)) return null;
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
  if (payload.exp <= Date.now()) return null;

  return { userId: payload.userId, sid: payload.sid, exp: payload.exp };
}

/**
 * คำนวณ CSRF token ของ session หนึ่ง ๆ — HMAC("csrf:" + sid) ด้วย SESSION_SECRET เดิม
 * (ไม่เพิ่ม env var ใหม่ แต่แยก domain ด้วย prefix เพื่อไม่ให้ secret เดียวเซ็นสองวัตถุประสงค์ปนกัน)
 * @param {string} sid
 * @returns {string} token แบบ base64url
 * @throws {Error} เมื่อ sid ไม่ถูกต้อง หรือไม่ได้ตั้ง SESSION_SECRET
 */
export function signCsrfToken(sid) {
  if (!isBase64Url(sid)) {
    throw new Error('signCsrfToken requires a valid sid');
  }
  const secret = getSessionSecret();
  return crypto.createHmac('sha256', secret)
    .update(`${CSRF_DOMAIN_PREFIX}${sid}`)
    .digest()
    .toString('base64url');
}

/**
 * ตรวจ CSRF token ที่ client ส่งกลับมา (header X-CSRF-Token) เทียบกับค่าที่คำนวณจาก sid ของ session
 * เปรียบเทียบแบบ constant-time และ gate charset ก่อน decode เช่นเดียวกับ verifySession
 * @param {string} sid - sid จาก session ที่ verify ผ่านแล้ว
 * @param {*} providedToken - ค่าที่ผู้เรียกส่งมา (ไม่เชื่อถือ)
 * @returns {boolean}
 */
export function verifyCsrfToken(sid, providedToken) {
  if (!isBase64Url(sid) || !isBase64Url(providedToken)) return false;
  const expected = Buffer.from(signCsrfToken(sid), 'base64url');
  const provided = Buffer.from(providedToken, 'base64url');
  return safeEqual(expected, provided);
}

function serializeCookie(name, value, { maxAgeSeconds, sameSite = DEFAULT_SAME_SITE, httpOnly = true }) {
  const attributes = [
    `${name}=${value}`,
    'Path=/',
    ...(httpOnly ? ['HttpOnly'] : []),
    `SameSite=${sameSite}`,
    `Max-Age=${maxAgeSeconds}`
  ];
  // Secure เฉพาะ production เพราะ dev รันบน http ล้วน browser จะทิ้ง cookie ทิ้งไปเงียบ ๆ
  if (process.env.NODE_ENV === 'production') {
    attributes.push('Secure');
  }
  return attributes.join('; ');
}

/**
 * สร้างค่า Set-Cookie สำหรับออก session ใหม่ (หรือต่ออายุด้วย sid เดิม)
 * @param {string} userId
 * @param {{ sid: string, sameSite?: string }} options - sid จำเป็นเสมอ
 * @returns {string}
 */
export function buildSessionCookie(userId, options = {}) {
  const token = signSession(userId, options.sid);
  return serializeCookie(SESSION_COOKIE_NAME, token, {
    maxAgeSeconds: Math.floor(SESSION_TIMEOUT_MS / 1000),
    sameSite: options.sameSite
  });
}

/**
 * สร้างค่า Set-Cookie ของ CSRF token — ไม่ใช่ HttpOnly โดยตั้งใจ เพราะ frontend ต้องอ่านไปใส่ header
 * ออกคู่กับ session cookie เสมอ (อายุเท่ากัน) เพื่อไม่ให้สองใบหมดอายุไม่พร้อมกัน
 * @param {string} sid
 * @param {{ sameSite?: string }} [options]
 * @returns {string}
 */
export function buildCsrfCookie(sid, options = {}) {
  return serializeCookie(CSRF_COOKIE_NAME, signCsrfToken(sid), {
    maxAgeSeconds: Math.floor(SESSION_TIMEOUT_MS / 1000),
    sameSite: options.sameSite,
    httpOnly: false
  });
}

/**
 * สร้างค่า Set-Cookie สำหรับล้าง CSRF cookie (logout) — attribute ต้องตรงกับตอนออก ไม่งั้นลบไม่ติด
 * @param {{ sameSite?: string }} [options]
 * @returns {string}
 */
export function buildClearedCsrfCookie(options = {}) {
  return serializeCookie(CSRF_COOKIE_NAME, '', {
    maxAgeSeconds: 0,
    sameSite: options.sameSite,
    httpOnly: false
  });
}

/**
 * สร้างค่า Set-Cookie สำหรับล้าง session (logout) — ปลอดภัยแม้ไม่มี cookie อยู่ก่อน
 * @param {{ sameSite?: string }} [options]
 * @returns {string}
 */
export function buildClearedSessionCookie(options = {}) {
  return serializeCookie(SESSION_COOKIE_NAME, '', {
    maxAgeSeconds: 0,
    sameSite: options.sameSite
  });
}
