/**
 * ดึง IP ของ client จาก request — ใช้เป็นส่วนหนึ่งของ composite key ใน login rate limiter
 * (TD-H10, src/shared/utils/backend/loginRateLimit.js)
 *
 * ความน่าเชื่อถือของ x-forwarded-for:
 * แอปนี้รันบน Vercel ซึ่ง edge network ของ Vercel เองเป็นผู้ตั้งค่า header นี้ (ไม่ใช่ reverse proxy
 * ที่ควบคุมไม่ได้) โดย IP ตัวซ้ายสุดคือ client จริงที่หลุดผ่าน edge เข้ามา — Vercel เขียนทับค่าที่ client
 * ส่งมาเองเสมอ ไม่ได้ต่อท้ายแบบ trust-all-hops ตามธรรมเนียม X-Forwarded-For ทั่วไป
 * อย่างไรก็ตาม repo นี้ไม่มีหลักฐานยืนยัน 100% ว่า deployment ปัจจุบันเป็น Vercel edge ทุก path
 * (เช่น รันผ่าน reverse proxy อื่นที่ไม่ได้ตั้งค่า strip header) จึงยังถือเป็นสมมติฐานที่ควร
 * ทวนซ้ำหาก deployment target เปลี่ยนไป — ไม่ได้ยืนยันว่า "ปลอดภัยแบบไม่มีเงื่อนไข"
 */
export function getClientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    // ตัวซ้ายสุด = client ต้นทางจริงตามที่ Vercel edge เติมให้
    return forwarded.split(',')[0].trim();
  }
  // dev/local: ไม่มี edge proxy คั่นกลาง ใช้ socket address ตรง ๆ
  return req.socket?.remoteAddress || 'unknown';
}
