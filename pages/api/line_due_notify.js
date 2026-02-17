// line_due_notify.js
// API สำหรับแจ้งเตือนค่าใช้จ่ายที่ถึงกำหนดผ่าน LINE

import { sendLineMessage } from '../../src/shared/utils/sendLineMessage';
import { isJsonMode, getMongoCollection } from '../../lib/dataSource';

const { loadUsers, getUserData } = require('../../src/backend/data/userUtils');

const JSON_EXPENSE_FILE = 'monthly_expense.json';

function getCurrentDateInfo(dateInput) {
  const date = dateInput ? new Date(dateInput) : new Date();
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return {
    date,
    monthKey: `${yyyy}-${mm}`,
    day: date.getDate(),
    dateKey: `${yyyy}-${mm}-${dd}`
  };
}

function isPaidFlag(paid) {
  return paid === true || paid === 'true';
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

function isDueToday(item, target) {
  if (!item || !target) return false;
  if (typeof item.dueDay === 'number') {
    return item.dueDay === target.day;
  }
  if (typeof item.dueDay === 'string' && item.dueDay.trim() !== '') {
    return Number(item.dueDay) === target.day;
  }
  return false;
}

function formatAmount(value) {
  const numeric = Number(value || 0);
  if (Number.isNaN(numeric)) return String(value || '0');
  return numeric.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function buildMessage(monthKey, items, target) {
  const header = `แจ้งเตือนค่าใช้จ่าย (${monthKey})\nวันที่ ${target.dateKey}`;
  const lines = items.map(item => {
    const name = item.name || 'รายการไม่มีชื่อ';
    const amount = formatAmount(item.estimate || item.actual || 0);
    return `- ${name}: ${amount} บาท`;
  });
  return [header, ...lines].join('\n');
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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { date, userId, mode } = req.body || {};
  const target = getCurrentDateInfo(date);
  if (!target) {
    return res.status(400).json({ error: 'invalid date' });
  }

  const notifyMode = mode === 'unpaid' ? 'unpaid' : 'due';

  const users = await getUsersForNotify(userId);
  const results = [];

  for (const user of users) {
    const expenseDoc = await getExpenseDocForMonth(user.id, target.monthKey);
    if (!expenseDoc) {
      results.push({ userId: user.id, sent: false, reason: 'no expense data' });
      continue;
    }

    const items = extractExpenseItems(expenseDoc);
    const dueItems = items.filter(item => {
      if (isPaidFlag(item.paid)) return false;
      const amount = Number(item.estimate || item.actual || 0);
      if (Number.isNaN(amount) || amount <= 0) return false;
      if (notifyMode === 'unpaid') return true;
      return isDueToday(item, target);
    });

    if (!dueItems.length) {
      results.push({ userId: user.id, sent: false, reason: 'no due items' });
      continue;
    }

    try {
      const message = buildMessage(target.monthKey, dueItems, target);
      await sendLineMessage(message, user.LineId);
      results.push({ userId: user.id, sent: true, count: dueItems.length });
    } catch (error) {
      results.push({ userId: user.id, sent: false, reason: error.message });
    }
  }

  return res.status(200).json({ success: true, results });
}
