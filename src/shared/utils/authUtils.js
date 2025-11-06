// authUtils.js
// ฟังก์ชันเกี่ยวกับการจัดการรหัสผ่านและการเข้ารหัส

/**
 * decode base64 string (รองรับทั้ง browser และ Node.js)
 * @param {string} encoded
 * @returns {string}
 */
export function decodePassword(encoded) {
  if (typeof window !== 'undefined' && window.atob) {
    return window.atob(encoded);
  }
  // fallback for Node.js (SSR)
  return Buffer.from(encoded, 'base64').toString('utf-8');
}
