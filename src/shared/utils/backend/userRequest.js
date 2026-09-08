import { assertApiToken } from './apiTokenAuth';

/**
 * แปลงค่า userId แบบ scalar (string/number) เท่านั้นให้เป็น string มาตรฐาน
 * ค่าอื่น ๆ (object, boolean, null, undefined ฯลฯ) ถูกปฏิเสธ → null
 * ใช้ร่วมกันทั้ง scalar branch และ array branch ของ normalizeUserId() ด้านล่าง
 * เพื่อไม่ให้ array branch มี logic แยกชุดที่หลุด type-check (F-01/F-08)
 * @param {*} value - ค่าที่อาจเป็น userId
 * @returns {string|null} userId แบบ string ที่ trim แล้ว หรือ null ถ้าไม่ใช่ scalar ที่ถูกต้อง
 */
function normalizeScalarUserId(value) {
  if (typeof value === 'string') {
    return value.trim() || null;
  }
  if (typeof value === 'number') {
    return value.toString();
  }
  return null;
}

/**
 * แปลงค่า userId ให้อยู่ในรูปแบบ string มาตรฐาน
 * รองรับค่าแบบ array, string และ number
 * array branch ใช้ scalar เฉพาะตัวแรกเท่านั้น (`?userId=a&userId=b` → 'a', พฤติกรรมเดิม)
 * แต่ต้องผ่านกฎ scalar เดียวกับ non-array branch — object/nested-array ที่ปนมาใน value[0]
 * (เช่น `{ "userId": [{ "$ne": null }] }` ที่ NoSQL injection craft มา) ต้องถูกปฏิเสธเป็น null
 * ไม่ใช่หลุดผ่านไปเป็น Mongo query operator ใน userFilter = { userId } (F-01, Critical)
 * @param {string|number|array|null} value - ค่า userId ที่รับเข้ามา
 * @returns {string|null} userId แบบ string หรือ null
 */
function normalizeUserId(value) {
  if (Array.isArray(value)) {
    return normalizeScalarUserId(value[0]);
  }
  return normalizeScalarUserId(value);
}

/**
 * ดึง userId จาก request ตามลำดับความสำคัญ
 * 1) query.userId
 * 2) body.userId
 * 3) header x-user-id
 * @param {object} req - Express request
 * @returns {string|null} userId ที่พบ หรือ null
 */
export function getUserIdFromRequest(req) {
  if (!req) return null;
  const queryUser = normalizeUserId(req.query?.userId);
  if (queryUser) return queryUser;
  const bodyUser = normalizeUserId(req.body?.userId);
  if (bodyUser) return bodyUser;
  const headerUser = normalizeUserId(req.headers?.['x-user-id']);
  return headerUser;
}

/**
 * ตรวจสอบว่ามี userId ใน request หรือไม่
 * ถ้าไม่มีจะตอบกลับ 400 ทันที
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @returns {string|null} userId หรือ null
 */
export function assertUserId(req, res) {
  if (!assertApiToken(req, res)) {
    return null;
  }
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    res.status(400).json({ error: 'userId required' });
    return null;
  }
  return userId;
}

/**
 * ปฏิเสธ userId ที่ไม่ใช่ string/ว่างเปล่า ก่อนถูกนำไปสร้าง Mongo filter หรือใช้ค้นหาใน JSON
 * แก้ช่องโหว่ cross-user write: normalizeUserId() (ด้านบน) เดิมมี branch array ที่คืนค่าดิบโดยไม่เช็ค
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
