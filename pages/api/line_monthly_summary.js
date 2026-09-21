import crypto from 'crypto';
import { getMongoCollection, isJsonMode } from '../../lib/dataSource';
import { loadUsers } from '../../src/backend/data/userUtils.js';
import {
  getUserMonthlySummaryEnabled,
  getUserLastMonthlySummarySent,
  markUserMonthlySummarySent
} from '../../lib/userStore';
import { sendLineFlexMessage, sendLineMessage } from '../../src/shared/utils/sendLineMessage';
import { assertScopedUserId } from '../../src/shared/utils/backend/userRequest';
import { withLineRetry } from '../../src/shared/utils/backend/lineRetry';
import { getCurrentDateInfo, formatMonthKeyTH } from '../../src/shared/utils/dateUtils';
import {
  buildMonthlySummaryPayload,
  buildMonthlySummaryFlex,
  formatMonthlySummaryText
} from '../../src/shared/utils/backend/monthlyLineSummary';

async function getRecipients(rawTargetUserId) {
  // undefined/null/'' = ไม่กรอง (ส่งทุกคน) — ค่าอื่นต้องผ่าน assertScopedUserId ที่ใช้ร่วมกัน (arch C-4)
  // ไม่ผ่าน (ไม่ใช่ string เช่น { $ne: null } หรือว่างหลัง trim) = ไม่ตรงกับใครเลย ไม่ปล่อยเข้า Mongo filter
  let targetUserId = null;
  if (rawTargetUserId !== undefined && rawTargetUserId !== null && rawTargetUserId !== '') {
    try {
      targetUserId = assertScopedUserId(rawTargetUserId, 'line_monthly_summary');
    } catch (error) {
      return [];
    }
  }
  if (isJsonMode()) {
    return loadUsers().filter(user => user.LineId && (!targetUserId || user.id === targetUserId));
  }
  const collection = await getMongoCollection('users');
  const filter = targetUserId ? { id: targetUserId } : {};
  return (await collection.find(filter).toArray()).filter(user => user.LineId);
}

/** เทียบสตริงแบบ constant-time เพื่อไม่ให้เวลาตอบกลับบอกใบ้ว่าตรงกันกี่ตัวอักษร */
function secretsMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const providedBuf = Buffer.from(provided, 'utf-8');
  const expectedBuf = Buffer.from(expected, 'utf-8');
  // timingSafeEqual โยน error ถ้าความยาวไม่เท่ากัน — เทียบความยาวก่อนไม่ทำให้ปลอดภัยน้อยลง
  // เพราะความยาวของ secret ไม่ใช่ความลับ
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * ดึงค่า secret ที่ผู้เรียกส่งมา รองรับ 3 ทาง:
 * - Authorization: Bearer <secret> (Vercel Cron ส่งมาทางนี้อัตโนมัติเมื่อตั้ง CRON_SECRET ไว้)
 * - header x-cron-secret
 * - query.cronSecret (GET) / body.cronSecret (POST) สำหรับเรียกเองด้วย curl
 */
function extractCronSecret(req) {
  const authHeader = req?.headers?.authorization;
  if (typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  const headerSecret = req?.headers?.['x-cron-secret'];
  if (typeof headerSecret === 'string' && headerSecret.trim()) return headerSecret.trim();

  const fromQuery = req?.query?.cronSecret;
  if (typeof fromQuery === 'string' && fromQuery.trim()) return fromQuery.trim();

  const fromBody = req?.body?.cronSecret;
  if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim();

  return '';
}

export default async function handler(req, res) {
  // CRON_SECRET เป็นด่านเดียวและบังคับ (fail closed) — เหมือน line_due_notify
  const expectedSecret = typeof process.env.CRON_SECRET === 'string' ? process.env.CRON_SECRET.trim() : '';
  if (!expectedSecret) return res.status(500).json({ error: 'CRON_SECRET is not configured' });
  if (!secretsMatch(extractCronSecret(req), expectedSecret)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const source = req.method === 'GET' ? req.query || {} : req.body || {};
  const target = getCurrentDateInfo(source.date);
  if (!target) return res.status(400).json({ error: 'invalid date' });
  if (target.day !== target.daysInMonth) {
    return res.status(200).json({ success: true, skipped: true, reason: 'not the last day of the month' });
  }

  const users = await getRecipients(source.userId);
  const results = [];
  for (const user of users) {
    let enabled = true;
    try {
      enabled = await getUserMonthlySummaryEnabled(user.id);
    } catch (error) {
      results.push({ userId: user.id, sent: false, reason: 'user settings unavailable' });
      continue;
    }
    if (!enabled) {
      results.push({ userId: user.id, sent: false, reason: 'monthly summary disabled' });
      continue;
    }
    try {
      const lastSent = await getUserLastMonthlySummarySent(user.id);
      if (lastSent === target.monthKey) {
        results.push({ userId: user.id, sent: false, reason: 'monthly summary already sent' });
        continue;
      }
      const payload = await buildMonthlySummaryPayload(user.id, target.monthKey);
      const monthLabel = formatMonthKeyTH(target.monthKey);
      const altText = `สรุปการเงินประจำเดือน ${monthLabel}`;
      let format = 'flex';
      try {
        await withLineRetry(() => sendLineFlexMessage(altText, buildMonthlySummaryFlex(monthLabel, payload), user.LineId));
      } catch (flexError) {
        await withLineRetry(() => sendLineMessage(formatMonthlySummaryText(monthLabel, payload), user.LineId));
        format = 'text-fallback';
      }
      await markUserMonthlySummarySent(user.id, target.monthKey);
      results.push({ userId: user.id, sent: true, month: target.monthKey, format });
    } catch (error) {
      results.push({ userId: user.id, sent: false, reason: error.message });
    }
  }
  return res.status(200).json({ success: true, month: target.monthKey, results });
}