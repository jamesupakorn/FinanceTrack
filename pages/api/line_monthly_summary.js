import { assertApiToken } from '../../src/shared/utils/backend/apiTokenAuth';
import { getMongoCollection, isJsonMode } from '../../lib/dataSource';
import { loadUsers } from '../../src/backend/data/userUtils.js';
import {
  getUserMonthlySummaryEnabled,
  getUserLastMonthlySummarySent,
  markUserMonthlySummarySent
} from '../../lib/userStore';
import { sendLineFlexMessage, sendLineMessage } from '../../src/shared/utils/sendLineMessage';
import { getCurrentDateInfo, formatMonthKeyTH } from '../../src/shared/utils/dateUtils.js';
import {
  buildMonthlySummaryPayload,
  buildMonthlySummaryFlex,
  formatMonthlySummaryText
} from '../../src/shared/utils/backend/monthlyLineSummary';

async function getRecipients(targetUserId) {
  if (isJsonMode()) {
    return loadUsers().filter(user => user.LineId && (!targetUserId || user.id === targetUserId));
  }
  const collection = await getMongoCollection('users');
  const filter = targetUserId ? { id: targetUserId } : {};
  return (await collection.find(filter).toArray()).filter(user => user.LineId);
}

export default async function handler(req, res) {
  if (!assertApiToken(req, res, { allowCronSecret: true })) return;
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
        await sendLineFlexMessage(altText, buildMonthlySummaryFlex(monthLabel, payload), user.LineId);
      } catch (flexError) {
        await sendLineMessage(formatMonthlySummaryText(monthLabel, payload), user.LineId);
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