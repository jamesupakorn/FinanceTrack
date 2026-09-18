// sendLineMessage.js
// Utility สำหรับส่งข้อความผ่าน LINE Messaging API

import { getLineToken, getLineUserId } from './lineConfig';

// pushLineApiCall: primitive ที่รวม logic การส่ง LINE push message ทั้งหมด
// (token/recipient resolution, guard, fetch, response parsing, error handling)
// ใช้โดย sendLineMessage()
// หมายเหตุ: log เฉพาะ boolean/count/status เท่านั้น ห้าม log recipient id, เนื้อหาข้อความ, หรือ raw response body
async function pushLineApiCall(
  messages: Array<{ type: string; text: string }>,
  userId: string | null = null
): Promise<Record<string, unknown>> {
  const token = getLineToken();
  const to = userId || getLineUserId();
  if (!token || !to || !Array.isArray(messages) || !messages.length) {
    console.error('ข้อมูลไม่ครบถ้วน', {
      hasToken: Boolean(token),
      hasRecipient: Boolean(to),
      messageCount: Array.isArray(messages) ? messages.length : 0
    });
    throw new Error('ข้อมูลไม่ครบถ้วน');
  }
  const payload = {
    to,
    messages
  };
  console.log('LINE API payload: messageCount=', payload.messages.length);
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  console.log('LINE API response:', { status: response.status, ok: response.ok });
  if (!response.ok) {
    console.error('LINE API error: status=', response.status);
    throw new Error(result.message || 'ส่งข้อความไม่สำเร็จ');
  }
  return result;
}

export async function sendLineMessage(
  message: string,
  userId: string | null = null
): Promise<Record<string, unknown>> {
  if (!message) {
    console.error('ข้อมูลไม่ครบถ้วน', {
      hasToken: Boolean(getLineToken()),
      hasRecipient: Boolean(userId || getLineUserId()),
      messageCount: 0
    });
    throw new Error('ข้อมูลไม่ครบถ้วน');
  }
  return pushLineApiCall([{ type: 'text', text: message }], userId);
}
