let ENCODED_LINE_TOKEN, ENCODED_LINE_USERID;
if (typeof window === 'undefined') {
  // Node.js (backend)
  ({ ENCODED_LINE_TOKEN, ENCODED_LINE_USERID } = require('../../frontend/config/password.enc'));
} else {
  // Frontend (browser)
  // ต้อง import แบบ ES6 เท่านั้น (แต่ปกติใช้แค่ backend)
}

export function decodeBase64(encoded) {
  if (typeof window !== 'undefined' && window.atob) {
    return window.atob(encoded);
  }
  return Buffer.from(encoded, 'base64').toString('utf-8');
}

export function getLineToken() {
  return decodeBase64(ENCODED_LINE_TOKEN);
}

export function getLineUserId() {
  return decodeBase64(ENCODED_LINE_USERID);
}
