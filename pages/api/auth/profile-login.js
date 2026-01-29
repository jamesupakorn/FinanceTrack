const { getUserById, checkUserPassword } = require('../../../src/backend/data/userUtils');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, password } = req.body || {};
  if (!userId || !password) {
    return res.status(400).json({ error: 'กรุณาระบุ userId และ password' });
  }

  const user = getUserById(userId);
  if (!user) {
    return res.status(401).json({ error: 'ไม่พบผู้ใช้' });
  }

  try {
    const isValid = await checkUserPassword(userId, password);
    if (!isValid) {
      return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
    }
    const safeUser = {
      id: user.id,
      displayName: user.displayName,
      avatar: user.avatar
    };
    return res.status(200).json({ success: true, user: safeUser });
  } catch (error) {
    console.error('ตรวจสอบรหัสผ่านไม่สำเร็จ', error);
    return res.status(500).json({ error: 'ไม่สามารถตรวจสอบรหัสผ่านได้' });
  }
}
