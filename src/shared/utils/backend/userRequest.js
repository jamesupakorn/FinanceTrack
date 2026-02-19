/**
 * แปลงค่า userId ให้อยู่ในรูปแบบ string มาตรฐาน
 * รองรับค่าแบบ array, string และ number
 * @param {string|number|array|null} value - ค่า userId ที่รับเข้ามา
 * @returns {string|null} userId แบบ string หรือ null
 */
function normalizeUserId(value) {
  if (Array.isArray(value)) {
    return value[0];
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return typeof value === 'number' ? value.toString() : null;
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
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    res.status(400).json({ error: 'userId required' });
    return null;
  }
  return userId;
}
