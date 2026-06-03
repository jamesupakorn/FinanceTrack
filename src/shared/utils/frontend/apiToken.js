/**
 * ช่วยแนบ Bearer token สำหรับเรียก API ฝั่ง client
 * ใช้ env:
 * - NEXT_PUBLIC_API_ACCESS_TOKEN_B64 / NEXT_PUBLIC_API_TOKEN_B64 (แนะนำ)
 * - NEXT_PUBLIC_API_ACCESS_TOKEN / NEXT_PUBLIC_API_TOKEN (fallback)
 */

function normalizeEnvValue(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const singleQuoted = trimmed.startsWith("'") && trimmed.endsWith("'");
  const doubleQuoted = trimmed.startsWith('"') && trimmed.endsWith('"');
  if ((singleQuoted || doubleQuoted) && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function decodeBase64Safe(value) {
  const normalizedValue = normalizeEnvValue(value);
  if (!normalizedValue) return '';
  const base64 = normalizedValue
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const paddingLength = (4 - (base64.length % 4)) % 4;
  const padded = `${base64}${'='.repeat(paddingLength)}`;
  try {
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
      return window.atob(padded).trim();
    }
    return Buffer.from(padded, 'base64').toString('utf-8').trim();
  } catch (error) {
    return '';
  }
}

function getClientApiToken() {
  const encoded = normalizeEnvValue(process.env.NEXT_PUBLIC_API_ACCESS_TOKEN_B64)
    || normalizeEnvValue(process.env.NEXT_PUBLIC_API_TOKEN_B64)
    || '';
  const decoded = decodeBase64Safe(encoded);
  if (decoded) return decoded;
  return normalizeEnvValue(process.env.NEXT_PUBLIC_API_ACCESS_TOKEN)
    || normalizeEnvValue(process.env.NEXT_PUBLIC_API_TOKEN)
    || '';
}

export function withApiTokenHeaders(headers = {}) {
  const token = getClientApiToken();
  if (!token) return { ...headers };
  return {
    ...headers,
    Authorization: `Bearer ${token}`
  };
}
