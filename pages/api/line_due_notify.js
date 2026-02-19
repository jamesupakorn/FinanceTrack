/**
 * API: pages/api/line_due_notify.js
 * 
 * LINE Notification API for Due Expense Reminders
 * 
 * Sends LINE notifications to users about upcoming and overdue expenses
 * Supports both JSON file mode and MongoDB database mode
 * Features:
 * - Notifies users of due expenses matching specific date
 * - Supports monthly recurring due date tracking
 * - Groups notifications by due/overdue/unpaid status
 * - Formats detailed expense information in Thai language
 * - Authenticates via Bearer token (CRON_SECRET environment variable)
 * - Can target specific user or broadcast to all users with LINE ID
 * 
 * Query/Body Parameters:
 * - date: Target date in YYYY-MM-DD format (optional, defaults to today)
 * - userId: Target specific user ID (optional, broadcasts if omitted)
 * - mode: Notification filter - 'due', 'unpaid', or 'both' (default: 'both')
 */

import { sendLineMessage } from '../../src/shared/utils/sendLineMessage';
import { isJsonMode, getMongoCollection } from '../../lib/dataSource';
import { isPaidFlag } from '../../src/shared/utils/commonUtils.js';
import {
  THAI_MONTH_LABELS,
  normalizeMonthPart,
  getDaysInMonth,
  getCurrentDateInfo,
  normalizeDueDayValue,
  clampDueDay,
  formatMonthKeyTH,
  formatThaiDate,
  buildDueDateString
} from '../../src/shared/utils/dateUtils.js';

const { loadUsers, getUserData } = require('../../src/backend/data/userUtils');

const JSON_EXPENSE_FILE = 'monthly_expense.json';

/**
 * Extract individual expense items from document
 * Filters out system/metadata fields and returns only actual expense items
 * @param {object} doc - Expense document object
 * @returns {array} Array of expense items with name, amount, and due information
 */
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

/**
 * Determine due status of an expense item relative to target date
 * Compares item's due day with target date to classify as due/overdue/upcoming
 * Validates due day is within the month's valid range
 * @param {object} item - Expense item with dueDay or dueDate field
 * @param {object} target - Target date object with day, daysInMonth properties
 * @returns {object} Status object with {status: 'invalid'|'due'|'overdue'|'upcoming', dueDay: number|null}
 */
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

/**
 * Build formatted LINE notification message with expense details
 * Groups items by status (due/overdue/unpaid) and formats with emojis
 * Calculates and displays total amount and item count
 * Includes links to update expense status
 * @param {object} target - Target date information with month, day, year, daysInMonth
 * @param {object} groupedItems - Items grouped by status {due, overdue, otherUnpaid}
 * @param {string} notifyMode - Notification type: 'due', 'unpaid', or 'both'
 * @returns {string} Formatted LINE message with expense breakdown and totals
 */
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

/**
 * Extract due day number from expense item
 * Supports both dueDay and dueDate formats
 * Normalizes day values and validates date format
 * @param {object} item - Expense item with dueDay or dueDate property
 * @returns {number|null} Due day of month (1-31) or null if not found/invalid
 */
function getDueDayNumber(item = {}) {
  const rawDay = normalizeDueDayValue(item.dueDay);
  if (rawDay) return rawDay;
  if (typeof item.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate)) {
    const dayPart = item.dueDate.slice(-2);
    return normalizeDueDayValue(dayPart);
  }
  return null;
}

/**
 * Calculate total amount from array of expense items
 * Sums either estimate or actual values (whichever is available)
 * Safely handles non-numeric values by skipping them
 * @param {array} items - Array of expense item objects
 * @returns {number} Total sum of all item amounts
 */
function sumItemAmounts(items = []) {
  return items.reduce((sum, item) => {
    const raw = Number(item.estimate || item.actual || 0);
    if (!Number.isNaN(raw) && Number.isFinite(raw)) {
      return sum + raw;
    }
    return sum;
  }, 0);
}

/**
 * Get list of users eligible for notification
 * Filters users that have a LINE ID configured
 * Optionally targets specific user or broadcasts to all with LINE connection
 * Works in both JSON file mode and MongoDB mode
 * @param {string|null} targetUserId - Specific user ID to notify (null for all users)
 * @returns {array<object>} Array of user objects with LineId property
 */
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

/**
 * Main API handler for LINE expense notifications
 * Processes POST/GET requests to send notification messages via LINE
 * Authenticates requests using CRON_SECRET environment variable
 * 
 * Accepts parameters via query string (GET) or request body (POST):
 * - date: Target date (YYYY-MM-DD format, optional)
 * - userId: Specific user ID to notify (optional, broadcasts to all if omitted)
 * - mode: Filter type - 'due', 'unpaid', or 'both' (default: 'both')
 * 
 * Response includes:
 * - success: Boolean indicating operation completion
 * - results: Array with notification results per user
 *   - userId: User who notification targeted
 *   - sent: Whether message was successfully sent
 *   - count: Number of items in notification
 *   - breakdown: Item counts by status (due, overdue, otherUnpaid)
 *   - reason: Error reason if sent=false
 * 
 * @param {object} req - Express request (POST/GET methods supported)
 * @param {object} res - Express response object
 * @returns {object} JSON with success status and detailed notification results
 */
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
