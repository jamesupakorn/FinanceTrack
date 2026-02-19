// line_due_notify.js
// API สำหรับแจ้งเตือนค่าใช้จ่ายที่ถึงกำหนดผ่าน LINE

import { sendLineMessage } from '../../src/shared/utils/sendLineMessage';
import { isJsonMode, getMongoCollection } from '../../lib/dataSource';
import { isPaidFlag } from '../../src/shared/utils/commonUtils.js';

const { loadUsers, getUserData } = require('../../src/backend/data/userUtils');

const JSON_EXPENSE_FILE = 'monthly_expense.json';
const THAI_MONTH_LABELS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function normalizeMonthPart(value) {
  return String(value).padStart(2, '0');
}

function getDaysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function getCurrentDateInfo(dateInput) {
  const date = dateInput ? new Date(dateInput) : new Date();
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const yyyy = date.getFullYear();
  const monthIndex = date.getMonth();
  const mm = normalizeMonthPart(monthIndex + 1);
  const dd = normalizeMonthPart(date.getDate());
  return {
    date,
    year: yyyy,
    monthIndex,
    monthKey: `${yyyy}-${mm}`,
    day: date.getDate(),
    dateKey: `${yyyy}-${mm}-${dd}`,
    daysInMonth: getDaysInMonth(yyyy, monthIndex)
  };
}

function extractExpenseItems(doc = {}) {
  const ignoreKeys = new Set([
    '_id',
    'month',
    'userId',
    'periodKey',
    'accountSummary',
    'totalEstimate',
    'totalActualPaid'
  ]);
  return Object.entries(doc)
    .filter(([key, value]) => !ignoreKeys.has(key) && value && typeof value === 'object')
    .map(([, value]) => value);
}

function getDueStatus(item, target) {
  if (!item || !target) return { status: 'invalid', dueDay: null };
  const dueDay = getDueDayNumber(item);
  if (!dueDay || dueDay < 1 || dueDay > target.daysInMonth) {
    return { status: 'invalid', dueDay: null };
  }
  if (dueDay === target.day) return { status: 'due', dueDay };
  if (dueDay < target.day) return { status: 'overdue', dueDay };
  return { status: 'upcoming', dueDay };
}

function formatAmount(value) {
  const numeric = Number(value || 0);
  if (Number.isNaN(numeric)) return String(value || '0');
  return numeric.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function buildMessage(target, groupedItems, notifyMode) {
  const hasDue = groupedItems.due.length > 0;
  const hasOverdue = groupedItems.overdue.length > 0;
  const headerTitle = notifyMode === 'unpaid'
    ? 'รายการค้างชำระ'
    : hasDue && hasOverdue
      ? 'ครบกำหนดวันนี้ + ค้างชำระ'
      : hasDue
        ? 'ครบกำหนดวันนี้'
        : 'ค้างชำระ';
  const monthLabel = formatMonthKeyTH(target.monthKey);
  const header = [
    '🔔 FinanceTrack แจ้งเตือนค่าใช้จ่าย',
    headerTitle,
    `เดือน ${monthLabel}`,
    `วันที่ ${formatThaiDate(target)}`,
    '━━━━━━━━━━━━'
  ].join('\n');
  const dueSection = groupedItems.due.length
    ? buildSection('✅ ครบกำหนดวันนี้', groupedItems.due, target)
    : null;
  const overdueSection = groupedItems.overdue.length
    ? buildSection('⚠️ ค้างชำระ', groupedItems.overdue, target)
    : null;
  const unpaidSection = notifyMode === 'unpaid' && groupedItems.otherUnpaid.length
    ? buildSection('🗂️ รายการยังไม่ถึงกำหนด', groupedItems.otherUnpaid, target)
    : null;
  const sections = [dueSection, overdueSection, unpaidSection].filter(Boolean);
  const allItems = [...groupedItems.due, ...groupedItems.overdue, ...groupedItems.otherUnpaid];
  const totalAmount = sumItemAmounts(allItems);
  const footer = [
    '━━━━━━━━━━━━',
    `รวมทั้งหมด: ${formatAmount(totalAmount)} บาท (${allItems.length} รายการ)`,
    'อัปเดตสถานะ ➜ https://finance-track-one.vercel.app/ 💼'
  ].join('\n');
  return [header, ...sections, footer].join('\n\n');
}

function buildSection(title, items, target) {
  const lines = items.map((item, index) => formatLineItem(item, index, target));
  return [title, ...lines].join('\n\n');
}

function formatLineItem(item, index, target) {
  const name = item.name || 'รายการไม่มีชื่อ';
  const amount = formatAmount(item.estimate || item.actual || 0);
  const dueDay = getDueDayNumber(item);
  const dueDateText = dueDay ? buildDueDateString(target, dueDay) : formatThaiDate(target);
  const details = [
    `💰 ${amount} บาท`,
    `📅 ครบกำหนด ${dueDateText}`,
    item.account ? `🏦 บัญชี ${item.account}` : null,
    item.category ? `📌 หมวด ${item.category}` : null
  ].filter(Boolean);
  return `${index + 1}. ${name}\n${details.join('\n')}`;
}

function getDueDayNumber(item = {}) {
  const rawDay = normalizeDueDayValue(item.dueDay);
  if (rawDay) return rawDay;
  if (typeof item.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate)) {
    const dayPart = item.dueDate.slice(-2);
    return normalizeDueDayValue(dayPart);
  }
  return null;
}

function normalizeDueDayValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clampDueDay(Math.floor(value));
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return clampDueDay(Math.floor(parsed));
    }
  }
  return null;
}

function clampDueDay(num) {
  if (num >= 1 && num <= 31) {
    return num;
  }
  return null;
}

function formatMonthKeyTH(monthKey = '') {
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11) {
    return monthKey;
  }
  const thaiYear = year + 543;
  const monthLabel = THAI_MONTH_LABELS[monthIndex] || monthStr;
  return `${monthLabel} ${thaiYear}`;
}

function formatThaiDate(target) {
  const day = target.day;
  const monthLabel = THAI_MONTH_LABELS[target.monthIndex] || normalizeMonthPart(target.monthIndex + 1);
  const thaiYear = target.year + 543;
  return `${day} ${monthLabel} ${thaiYear}`;
}

function buildDueDateString(target, dueDay) {
  const actualDay = Math.min(dueDay, target.daysInMonth);
  const monthLabel = THAI_MONTH_LABELS[target.monthIndex] || normalizeMonthPart(target.monthIndex + 1);
  const thaiYear = target.year + 543;
  return `${actualDay} ${monthLabel} ${thaiYear}`;
}

function sumItemAmounts(items = []) {
  return items.reduce((sum, item) => {
    const raw = Number(item.estimate || item.actual || 0);
    if (!Number.isNaN(raw) && Number.isFinite(raw)) {
      return sum + raw;
    }
    return sum;
  }, 0);
}

async function getUsersForNotify(targetUserId) {
  if (isJsonMode()) {
    const users = loadUsers();
    return users.filter(user => user.LineId && (!targetUserId || user.id === targetUserId));
  }
  const collection = await getMongoCollection('users');
  const filter = targetUserId ? { id: targetUserId } : {};
  const docs = await collection.find(filter).toArray();
  return docs.filter(user => user.LineId);
}

async function getExpenseDocForMonth(userId, monthKey) {
  if (isJsonMode()) {
    const bucket = getUserData(JSON_EXPENSE_FILE, userId);
    return bucket?.[monthKey] || null;
  }
  const collection = await getMongoCollection('monthly_expense');
  return collection.findOne({ userId, month: monthKey });
}

export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const authHeader = req.headers.authorization || '';
    const expected = `Bearer ${process.env.CRON_SECRET}`;
    if (authHeader !== expected) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const source = req.method === 'GET' ? (req.query || {}) : (req.body || {});
  const { date, userId, mode } = source;
  const target = getCurrentDateInfo(date);
  if (!target) {
    return res.status(400).json({ error: 'invalid date' });
  }

  const notifyMode = mode === 'unpaid' || mode === 'due' ? mode : 'both';

  const users = await getUsersForNotify(userId);
  const results = [];

  for (const user of users) {
    const expenseDoc = await getExpenseDocForMonth(user.id, target.monthKey);
    if (!expenseDoc) {
      results.push({ userId: user.id, sent: false, reason: 'no expense data' });
      continue;
    }

    const items = extractExpenseItems(expenseDoc);
    const classifiedItems = items.filter(item => {
      if (isPaidFlag(item.paid)) return false;
      const amount = Number(item.estimate || item.actual || 0);
      if (Number.isNaN(amount) || amount <= 0) return false;
      return true;
    }).map(item => {
      const { status } = getDueStatus(item, target);
      return { item, status };
    });

    const groupedItems = {
      due: [],
      overdue: [],
      otherUnpaid: []
    };

    classifiedItems.forEach(({ item, status }) => {
      if (status === 'due') {
        groupedItems.due.push(item);
        return;
      }
      if (status === 'overdue') {
        groupedItems.overdue.push(item);
        return;
      }
      if (notifyMode === 'unpaid') {
        groupedItems.otherUnpaid.push(item);
      }
    });

    if (notifyMode === 'due') {
      groupedItems.overdue = [];
      groupedItems.otherUnpaid = [];
    }

    if (notifyMode === 'both') {
      groupedItems.otherUnpaid = [];
    }

    const totalMatched = groupedItems.due.length + groupedItems.overdue.length + groupedItems.otherUnpaid.length;

    if (!totalMatched) {
      results.push({ userId: user.id, sent: false, reason: 'no due or overdue items' });
      continue;
    }

    try {
      const message = buildMessage(target, groupedItems, notifyMode);
      await sendLineMessage(message, user.LineId);
      results.push({ userId: user.id, sent: true, count: totalMatched, breakdown: {
        due: groupedItems.due.length,
        overdue: groupedItems.overdue.length,
        otherUnpaid: groupedItems.otherUnpaid.length
      } });
    } catch (error) {
      results.push({ userId: user.id, sent: false, reason: error.message });
    }
  }

  return res.status(200).json({ success: true, results });
}
