// line_notify.js
// API สำหรับส่งข้อความไปยัง LINE Messaging API

import { sendLineMessage } from '../../src/shared/utils/sendLineMessage';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { userId, message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'message จำเป็นต้องระบุ' });
  }
  try {
    const result = await sendLineMessage(message, userId);
    return res.status(200).json({ success: true, result });
  } catch (error) {
    return res.status(500).json({ error: 'เกิดข้อผิดพลาด', details: error.message });
  }
}
