import type { NextApiRequest, NextApiResponse } from 'next';
import { buildClearedSessionCookie, buildClearedCsrfCookie } from '../../../src/shared/utils/backend/sessionCookie';
import { validateApiRequest } from '../../../src/shared/utils/backend/apiRequestValidation';

/**
 * ล้าง session cookie (TD-C02 Increment B1)
 * cookie เป็น HttpOnly จึงลบจากฝั่ง client ไม่ได้ ต้องผ่าน endpoint นี้
 * ตั้งใจไม่บังคับให้มี session ที่ยัง valid — logout ตอน session หมดอายุแล้วต้องสำเร็จเช่นกัน
 * (TD-C02 follow-up: static Bearer token ที่เคยกั้นไว้ถูกถอดออก ผลของ endpoint นี้คือล้าง cookie
 *  เท่านั้น ไม่มีผลต่อ confidentiality/integrity ของข้อมูล)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!validateApiRequest(req, res, 'auth/logout')) return;

  try {
    res.setHeader('Set-Cookie', [buildClearedSessionCookie(), buildClearedCsrfCookie()]);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('ล้าง session ไม่สำเร็จ', error);
    return res.status(500).json({ error: 'ไม่สามารถออกจากระบบได้' });
  }
}
