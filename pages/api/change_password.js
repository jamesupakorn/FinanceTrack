import { assertUserId } from '../../src/shared/utils/backend/userRequest';
import { checkUserPassword, updateUserPassword } from '../../src/backend/data/userUtils';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = assertUserId(req, res);
  if (!userId) return;

  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const valid = await checkUserPassword(userId, currentPassword);
    if (!valid) {
      return res.status(401).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
    }
    await updateUserPassword(userId, newPassword);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[change_password] failed', error);
    return res.status(500).json({ error: 'ไม่สามารถเปลี่ยนรหัสได้' });
  }
}
