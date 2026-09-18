import { loadUsers } from '../../lib/userStore';

/**
 * รายชื่อโปรไฟล์สำหรับหน้าเลือกผู้ใช้ (pages/profiles.js)
 * ตั้งใจเปิดสาธารณะ: ต้องเรียกได้ "ก่อน" ล็อกอิน จึงบังคับ session cookie ไม่ได้
 * payload มีแค่ id / displayName / avatar — ไม่มีรหัสผ่านหรือข้อมูลการเงิน
 * (TD-C02 follow-up: static Bearer token ที่เคยกั้นไว้ถูกถอดออก เพราะมันถูก bake ลง client bundle
 *  ผ่าน NEXT_PUBLIC_* อยู่แล้ว จึงกัน scraping ไม่ได้จริง)
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    const allUsers = await loadUsers();
    const users = allUsers.map(user => ({
      id: user.id,
      displayName: user.displayName,
      avatar: user.avatar
    }));
    return res.status(200).json({ users });
  } catch (error) {
    console.error('โหลดข้อมูลผู้ใช้ไม่สำเร็จ', error);
    return res.status(500).json({ error: 'ไม่สามารถโหลดรายชื่อผู้ใช้ได้' });
  }
}
