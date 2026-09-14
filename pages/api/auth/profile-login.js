import { buildSessionCookie, buildCsrfCookie, createSessionId } from '../../../src/shared/utils/backend/sessionCookie';
import { getUserById, checkUserPassword } from '../../../lib/userStore';
import { getClientIp } from '../../../src/shared/utils/backend/clientIp';
import { checkLockStatus, checkAndRecordFailure, resetCounter } from '../../../src/shared/utils/backend/loginRateLimit';

/**
 * endpoint ล็อกอิน — ตั้งใจเปิดสาธารณะโดยนิยาม: ยังไม่มี session ตอนที่ถูกเรียก
 * (TD-C02 follow-up: static Bearer token ที่เคยกั้นไว้ถูกถอดออก มันเป็นแค่ speed bump กัน bot
 *  และถูก bake ลง client bundle อยู่แล้ว ด่านจริงคือรหัสผ่านที่ checkUserPassword ตรวจ)
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, password } = req.body || {};
  if (!userId || !password) {
    return res.status(400).json({ error: 'กรุณาระบุ userId และ password' });
  }

  try {
    const user = await getUserById(userId);
    if (!user) {
      return res.status(401).json({ error: 'ไม่พบผู้ใช้' });
    }

    // TD-H09: demo account, no password gate. Gated strictly on the server-read `user.isDemo`
    // flag (never a client-supplied value) — this branch never runs for u001/u002/any future
    // real user, so every other account's login behavior is byte-for-byte unchanged.
    //
    // TD-H10: rate limiting is scoped entirely inside this same `isDemo !== true` branch. The demo
    // path never calls checkUserPassword, so there is no credential-guessing surface for a limiter
    // to protect — and keying on an IP-inclusive composite would risk false-throttling unrelated
    // legitimate visitors sharing a NAT IP who are just trying the demo, undermining its
    // zero-friction "open access by design" intent (user-confirmed decision).
    if (user.isDemo !== true) {
      const clientIp = getClientIp(req);

      const { locked, lockedUntil } = await checkLockStatus(clientIp, userId);
      if (locked) {
        const retryAfterSeconds = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000));
        res.setHeader('Retry-After', String(retryAfterSeconds));
        // ข้อความไม่บอกว่า userId มีจริงหรือไม่ และไม่บอกจำนวนครั้งที่เหลือ — เลี่ยงเปิดช่อง
        // enumeration/timing side-channel ใหม่ซ้อนทับกับสิ่งที่งานนี้กำลังปิดอยู่
        return res.status(429).json({ error: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณาลองใหม่อีกครั้งภายหลัง' });
      }

      const isValid = await checkUserPassword(userId, password);
      if (!isValid) {
        // นับความล้มเหลว "หลังจาก" ตรวจรหัสผ่านจริงเท่านั้น ไม่นับ request ที่โดน lock อยู่แล้วซ้ำ
        await checkAndRecordFailure(clientIp, userId);
        return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
      }

      // login สำเร็จ — ล้างประวัติความล้มเหลวเก่าของ key นี้ ไม่ให้ค้างมาลงโทษ session ถัดไป
      await resetCounter(clientIp, userId);
    }

    const safeUser = {
      id: user.id,
      displayName: user.displayName,
      avatar: user.avatar,
      isDemo: user.isDemo === true
    };

    // ออก session cookie + CSRF cookie คู่กัน (TD-C02 B2/B3)
    // sid สุ่มใหม่ทุกครั้งที่ login สำเร็จ (rotate) และคงเดิมตลอดการต่ออายุแบบ sliding
    // response body คงเดิม เพื่อให้ frontend ทำงานเหมือนเดิมทุกประการ
    const sid = createSessionId();
    res.setHeader('Set-Cookie', [
      buildSessionCookie(user.id, { sid }),
      buildCsrfCookie(sid)
    ]);

    return res.status(200).json({ success: true, user: safeUser });
  } catch (error) {
    console.error('ตรวจสอบรหัสผ่านไม่สำเร็จ', error);
    return res.status(500).json({ error: 'ไม่สามารถตรวจสอบรหัสผ่านได้' });
  }
}
