/**
 * ตรวจสอบ Bearer token สำหรับเรียก API ภายในระบบ
 * รองรับ token หลักจาก env:
 * - API_ACCESS_TOKEN_ENCRYPTED + API_ACCESS_TOKEN_ENCRYPTION_KEY (แนะนำ)
 * - API_ACCESS_TOKEN_B64 / API_TOKEN_B64 (แนะนำ)
 * - API_ACCESS_TOKEN / API_TOKEN (fallback)
 */

import crypto from 'crypto';

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

function decryptAesToken(encryptedValue, secret) {
  const normalizedEncrypted = normalizeEnvValue(encryptedValue);
  const normalizedSecret = normalizeEnvValue(secret);
  if (!normalizedEncrypted || !normalizedSecret) return '';
  const [ivHex, encryptedHex] = normalizedEncrypted.split(':');
  if (!ivHex || !encryptedHex) return '';
  try {
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const key = crypto.createHash('sha256').update(normalizedSecret).digest();
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf-8').trim();
  } catch (error) {
    return '';
  }
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
    return Buffer.from(padded, 'base64').toString('utf-8').trim();
  } catch (error) {
    return '';
  }
}

function getExpectedApiToken() {
  const encrypted = normalizeEnvValue(process.env.API_ACCESS_TOKEN_ENCRYPTED) || '';
  const encryptionKey = normalizeEnvValue(process.env.API_ACCESS_TOKEN_ENCRYPTION_KEY) || '';
  const decryptedToken = decryptAesToken(encrypted, encryptionKey);
  if (decryptedToken) return decryptedToken;

  const encoded = normalizeEnvValue(process.env.API_ACCESS_TOKEN_B64)
    || normalizeEnvValue(process.env.API_TOKEN_B64)
    || '';
  const decoded = decodeBase64Safe(encoded);
  if (decoded) return decoded;
  return normalizeEnvValue(process.env.API_ACCESS_TOKEN)
    || normalizeEnvValue(process.env.API_TOKEN)
    || '';
}

function extractBearerToken(req) {
  const authHeader = req?.headers?.authorization;
  if (typeof authHeader !== 'string') return '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

/**
 * บังคับให้ request มี token ที่ถูกต้อง
 * @returns {boolean} true = ผ่าน, false = ไม่ผ่าน (และตอบ response แล้ว)
 */
export function assertApiToken(req, res, options = {}) {
  const {
    allowCronSecret = false,
    skipWhenNoTokenConfigured = false
  } = options;

  const expectedToken = getExpectedApiToken();
  if (!expectedToken) {
    if (skipWhenNoTokenConfigured) return true;
    res.status(500).json({ error: 'API token is not configured' });
    return false;
  }

  const providedToken = extractBearerToken(req);
  if (providedToken && providedToken === expectedToken) {
    return true;
  }

  if (allowCronSecret) {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && providedToken === cronSecret) {
      return true;
    }
  }

  res.status(401).json({ error: 'unauthorized' });
  return false;
}
