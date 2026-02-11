const { loadUsers } = require('../../src/backend/data/userUtils');

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    const users = loadUsers().map(user => ({
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
