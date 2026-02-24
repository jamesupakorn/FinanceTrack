/**
 * ช่วยแนบ Bearer token สำหรับเรียก API ฝั่ง client
 * ใช้ env:
 * - NEXT_PUBLIC_API_ACCESS_TOKEN_B64 / NEXT_PUBLIC_API_TOKEN_B64 (แนะนำ)
 * - NEXT_PUBLIC_API_ACCESS_TOKEN / NEXT_PUBLIC_API_TOKEN (fallback)
 */

function decodeBase64Safe(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
      return window.atob(value).trim();
    }
    return Buffer.from(value, 'base64').toString('utf-8').trim();
  } catch (error) {
    return '';
  }
}

function getClientApiToken() {
  const encoded = process.env.NEXT_PUBLIC_API_ACCESS_TOKEN_B64 || process.env.NEXT_PUBLIC_API_TOKEN_B64 || '';
  const decoded = decodeBase64Safe(encoded);
  if (decoded) return decoded;
  return process.env.NEXT_PUBLIC_API_ACCESS_TOKEN || process.env.NEXT_PUBLIC_API_TOKEN || '';
}

export function withApiTokenHeaders(headers = {}) {
  const token = getClientApiToken();
  if (!token) return { ...headers };
  return {
    ...headers,
    Authorization: `Bearer ${token}`
  };
}
