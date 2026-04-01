import { assertApiToken } from '../../src/shared/utils/backend/apiTokenAuth';
import { assertUserId } from '../../src/shared/utils/backend/userRequest';
const { getUserBankAccounts, updateUserBankAccounts } = require('../../src/backend/data/userUtils');

/**
 * API: pages/api/user-bank-accounts.js
 * จัดการรายชื่อบัญชีธนาคารของผู้ใช้
 * - GET: คืนรายชื่อบัญชีของผู้ใช้ปัจจุบัน
 * - POST: อัปเดตรายชื่อบัญชีของผู้ใช้ปัจจุบัน
 */
export default function handler(req, res) {
  if (!assertApiToken(req, res)) {
    return;
  }

  const userId = assertUserId(req, res);
  if (!userId) return;

  if (req.method === 'GET') {
    try {
      const bankAccounts = getUserBankAccounts(userId);
      return res.status(200).json({ bankAccounts });
    } catch (error) {
      console.error('Failed to fetch user bank accounts:', error);
      return res.status(500).json({ error: 'Failed to fetch user bank accounts' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { bankAccounts } = req.body;
      if (!Array.isArray(bankAccounts)) {
        return res.status(400).json({ error: 'bankAccounts must be an array' });
      }
      updateUserBankAccounts(userId, bankAccounts);
      return res.status(200).json({ success: true, bankAccounts });
    } catch (error) {
      console.error('Failed to update user bank accounts:', error);
      return res.status(500).json({ error: 'Failed to update user bank accounts' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'Method not allowed' });
}
