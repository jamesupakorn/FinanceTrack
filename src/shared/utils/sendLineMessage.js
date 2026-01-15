// sendLineMessage.js
// Utility สำหรับส่งข้อความผ่าน LINE Messaging API

import fetch from 'node-fetch';
import { getLineToken, getLineUserId } from './lineConfig';

export async function sendLineMessage(message, userId = null) {
  const token = getLineToken();
  const to = userId || getLineUserId();
  if (!token || !to || !message) {
    console.error('ข้อมูลไม่ครบถ้วน', { token, to, message });
    throw new Error('ข้อมูลไม่ครบถ้วน');
  }
  const payload = {
    to,
    messages: [{ type: 'text', text: message }]
  };
  console.log('LINE API payload:', payload);
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  console.log('LINE API response:', { status: response.status, ok: response.ok, result });
  if (!response.ok) {
    console.error('LINE API error:', result);
    throw new Error(result.message || 'ส่งข้อความไม่สำเร็จ');
  }
  return result;
}
