import {
  verifySession,
  verifyCsrfToken,
  buildSessionCookie,
  buildCsrfCookie,
  SESSION_COOKIE_NAME,
  SESSION_TIMEOUT_MS
} from './sessionCookie';

// TD-C02 Increment B2 — trust-model cutover
// userId มาจาก session cookie ที่เซิร์ฟเวอร์เซ็นเองเท่านั้น ไม่มี fallback ไป query/body/x-user-id
// อีกต่อไป (fallback ใด ๆ = เปิดช่องเดิมที่งานนี้มีไว้ปิด: client ประกาศตัวเป็นใครก็ได้)
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * ดึง userId จาก session cookie ที่ผ่านการตรวจลายเซ็นแล้ว
 * @param {object} req - Next.js API request (ต้องมี req.cookies)
 * @returns {string|null} userId หรือ null เมื่อไม่มี/ไม่ถูกต้อง/หมดอายุ
 */
export function getUserIdFromRequest(req) {
  if (!req) return null;
  const session = verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
  return session ? session.userId : null;
}

/**
 * ตรวจสิทธิ์ระดับ request: session cookie → CSRF (เฉพาะ method ที่เปลี่ยนข้อมูล)
 * static Bearer "API token" ถูกถอดออกแล้ว (TD-C02 follow-up) — มันถูก bake ลง client bundle ผ่าน
 * NEXT_PUBLIC_* ตั้งแต่ build time จึงไม่เคยเป็นความลับจริง เป็นแค่ speed bump กัน bot
 * session cookie ที่เซิร์ฟเวอร์เซ็นเองคือด่านเดียวและเพียงพอ
 * และต่ออายุ session แบบ sliding เมื่อเวลาที่เหลือน้อยกว่าครึ่งหนึ่งของ window
 * - ไม่มี/ไม่ถูกต้อง/หมดอายุ → 401 (เดิมเป็น 400 'userId required')
 * - CSRF ไม่ตรง → 403
 * @param {object} req - Next.js API request
 * @param {object} res - Next.js API response
 * @returns {string|null} userId หรือ null (เมื่อคืน null แปลว่าตอบ response ไปแล้ว)
 */
export function assertUserId(req, res) {
  const session = verifySession(req?.cookies?.[SESSION_COOKIE_NAME]);
  if (!session) {
    res.status(401).json({ error: 'session expired or invalid — please log in again' });
    return null;
  }

  if (MUTATING_METHODS.has(req.method) && !verifyCsrfToken(session.sid, req.headers?.['x-csrf-token'])) {
    res.status(403).json({ error: 'invalid csrf token' });
    return null;
  }

  // Sliding expiry แบบมี threshold (spec Decision A): ต่ออายุเมื่อเหลือ < 50% ของ window เท่านั้น
  // ไม่ใช่ทุก request — Save All ยิงหลาย request ติดกัน การ re-issue ทุกครั้งคือ churn เปล่า ๆ
  // sid เดิมถูกใช้ต่อ เพื่อให้ CSRF token ที่ frontend ถืออยู่ยังใช้ได้
  if (session.exp - Date.now() < SESSION_TIMEOUT_MS / 2) {
    res.setHeader('Set-Cookie', [
      buildSessionCookie(session.userId, { sid: session.sid }),
      buildCsrfCookie(session.sid)
    ]);
  }

  return session.userId;
}

/**
 * ปฏิเสธ userId ที่ไม่ใช่ string/ว่างเปล่า ก่อนถูกนำไปสร้าง Mongo filter หรือใช้ค้นหาใน JSON
 * แก้ช่องโหว่ cross-user write: เดิม normalizeUserId() (ถูกลบไปแล้วใน B2 พร้อม client-supplied userId)
 * มี branch array ที่คืนค่าดิบโดยไม่เช็ค
 * type — { "userId": [{"$ne": null}] } จะหลุดมาถึง findOne({ id: userId })/updateOne({ id: userId }, ...)
 * แบบไม่มีการ์ด ทำให้อ่าน/เขียนทับเอกสารผู้ใช้คนอื่นได้ใน Mongo mode (production)
 * throw แทนการคืน null เพื่อให้ทุก caller (store-layer function) fail ดังชัดเจน แทนที่จะ match ศูนย์
 * เอกสาร (JSON) หรือทุกเอกสาร (Mongo ก่อนแก้)
 * เดิมมี 2 ชุดซ้ำกันเป๊ะใน lib/userStore.js และ src/shared/utils/backend/creditCardStore.js (F-08) —
 * รวมเป็นชุดเดียว รับ label เพื่อให้ error message ของแต่ละ caller คงเดิม (ไม่ทำลาย test ที่ assert
 * ข้อความ literal อยู่)
 * @param {*} userId - ค่า userId ที่จะถูกใช้ทำ scoped read/write
 * @param {string} label - ชื่อ caller ที่จะขึ้นต้น error message เช่น 'userStore', 'creditCardStore'
 * @returns {string} userId แบบ trim แล้ว
 * @throws {Error} `${label}: userId is required` ถ้า userId ไม่ใช่ string ที่ไม่ว่าง
 */
export function assertScopedUserId(userId, label) {
  const normalised = typeof userId === 'string' ? userId.trim() : '';
  if (!normalised) {
    throw new Error(`${label}: userId is required`);
  }
  return normalised;
}
