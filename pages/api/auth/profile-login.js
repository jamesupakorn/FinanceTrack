import { buildSessionCookie, buildCsrfCookie, createSessionId } from '../../../src/shared/utils/backend/sessionCookie';
import { getUserById, checkUserPassword } from '../../../lib/userStore';

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

    const isValid = await checkUserPassword(userId, password);
    if (!isValid) {
      return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
    }

    const safeUser = {
      id: user.id,
      displayName: user.displayName,
      avatar: user.avatar
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
