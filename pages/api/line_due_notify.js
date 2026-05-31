/**
 * API: pages/api/line_due_notify.js
 * ส่งแจ้งเตือนค่าใช้จ่ายที่ถึงกำหนดผ่าน LINE
 * รองรับทั้ง JSON และ MongoDB
 * - แจ้งเตือนรายการครบกำหนด/ค้างชำระตามวันที่ที่ระบุ
 * - รองรับการกำหนดวันครบกำหนดแบบรายเดือน
 * - รวมผลตามสถานะ (ครบกำหนด/ค้างชำระ/ยังไม่ถึงกำหนด)
 * - ใช้ Bearer token (CRON_SECRET) สำหรับการยืนยัน
 * - เลือกส่งเฉพาะผู้ใช้หรือส่งให้ทุกคนที่มี LINE ID
 *
 * พารามิเตอร์:
 * - date: วันที่เป้าหมายรูปแบบ YYYY-MM-DD (ไม่ระบุจะใช้วันนี้)
 * - userId: เลือกผู้ใช้เฉพาะ (ไม่ระบุจะส่งทุกคน)
 * - mode: รูปแบบแจ้งเตือน 'due' | 'unpaid' | 'both'
 */

import { sendLineMessage } from '../../src/shared/utils/sendLineMessage';
import { isJsonMode, getMongoCollection } from '../../lib/dataSource';
import { isPaidFlag } from '../../src/shared/utils/commonUtils.js';
import { assertApiToken } from '../../src/shared/utils/backend/apiTokenAuth';
import {
  THAI_MONTH_LABELS,
  normalizeMonthPart,
  getDaysInMonth,
  getCurrentDateInfo,
  resolveDueDayForMonth,
  normalizeDueDayValue,
  isEndOfMonthDueDay,
  formatMonthKeyTH,
  formatThaiDate,
  buildDueDateString
} from '../../src/shared/utils/dateUtils.js';

const { loadUsers, getUserData } = require('../../src/backend/data/userUtils');

const JSON_EXPENSE_FILE = 'monthly_expense.json';
const DUE_SOON_DAYS = 3;

/**
 * ดึงรายการค่าใช้จ่ายจากเอกสาร โดยตัด field ระบบออก
 * @param {object} doc - เอกสารค่าใช้จ่ายของเดือน
 * @returns {array} รายการค่าใช้จ่ายที่ใช้งานจริง
 */
function extractExpenseItems(doc = {}) {
  const ignoreKeys = new Set([
    '_id',
    'month',
    'userId',
    'periodKey',
    'accountSummary',
    'totalActualPaid'
  ]);
  return Object.entries(doc)
    .filter(([key, value]) => !ignoreKeys.has(key) && value && typeof value === 'object')
    .map(([, value]) => value);
}

/**
 * หาสถานะรายการเทียบกับวันเป้าหมาย
 * @param {object} item - รายการค่าใช้จ่ายที่มี dueDay หรือ dueDate
 * @param {object} target - ข้อมูลวันเป้าหมาย (day, daysInMonth)
 * @returns {object} {status, dueDay}
 */
function getDueStatus(item, target) {
  if (!item || !target) return { status: 'invalid', dueDay: null };
  const dueDay = getDueDayNumber(item);
  const resolvedDueDay = resolveDueDayForMonth(dueDay, target.daysInMonth);
  if (!resolvedDueDay || resolvedDueDay < 1 || resolvedDueDay > target.daysInMonth) {
    return { status: 'invalid', dueDay: null };
  }
  if (resolvedDueDay === target.day) return { status: 'due', dueDay };
  if (resolvedDueDay < target.day) return { status: 'overdue', dueDay };
  if ((resolvedDueDay - target.day) <= DUE_SOON_DAYS) {
    return { status: 'dueSoon', dueDay };
  }
  return { status: 'upcoming', dueDay };
}

function formatAmount(value) {
  const numeric = Number(value || 0);
  if (Number.isNaN(numeric)) return String(value || '0');
  return numeric.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * สร้างข้อความแจ้งเตือนแบบจัดกลุ่มรายการ
 * @param {object} target - ข้อมูลวันเป้าหมาย
 * @param {object} groupedItems - รายการที่จัดกลุ่มตามสถานะ
 * @param {string} notifyMode - โหมดแจ้งเตือน
 * @returns {string} ข้อความสำหรับส่ง LINE
 */
function buildMessage(target, groupedItems, notifyMode) {
  const hasDue = groupedItems.due.length > 0;
  const hasOverdue = groupedItems.overdue.length > 0;
  const hasDueSoon = groupedItems.dueSoon.length > 0;
  const headerTitle = notifyMode === 'unpaid'
    ? 'รายการค้างชำระ'
    : hasDue && hasOverdue
      ? 'ครบกำหนดวันนี้ + ค้างชำระ'
      : hasDueSoon
        ? `กำหนดการใกล้ชำระ (ภายใน ${DUE_SOON_DAYS} วัน)`
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
    ? buildSection('✅ ครบกำหนดวันนี้', groupedItems.due, target, { hideDate: true })
    : null;
  const dueSoonSection = groupedItems.dueSoon.length
    ? buildSection(`⏳ ใกล้ครบกำหนด (อีกไม่เกิน ${DUE_SOON_DAYS} วัน)`, groupedItems.dueSoon, target)
    : null;
  const overdueSection = groupedItems.overdue.length
    ? buildSection('⚠️ ค้างชำระ', groupedItems.overdue, target)
    : null;
  const unpaidSection = notifyMode === 'unpaid' && groupedItems.otherUnpaid.length
    ? buildSection('🗂️ รายการยังไม่ถึงกำหนด', groupedItems.otherUnpaid, target, { hideDate: true })
    : null;
  const sections = [dueSection, dueSoonSection, overdueSection, unpaidSection].filter(Boolean);
  const todayItems = [...groupedItems.due, ...groupedItems.overdue];
  const upcomingItems = [...groupedItems.dueSoon, ...groupedItems.otherUnpaid];
  const todayTotal = sumItemAmounts(todayItems);
  const upcomingTotal = sumItemAmounts(upcomingItems);
  const footerLines = [
    '━━━━━━━━━━━━',
    `ต้องจ่ายวันนี้/ค้างชำระ: ${formatAmount(todayTotal)} บาท (${todayItems.length} รายการ)`,
    upcomingItems.length ? `ใกล้ครบกำหนด: ${formatAmount(upcomingTotal)} บาท (${upcomingItems.length} รายการ)` : null,
    'อัปเดตสถานะ ➜ https://finance-track-one.vercel.app/ 💼'
  ].filter(Boolean);
  const footer = footerLines.join('\n');
  return [header, ...sections, footer].join('\n\n');
}

function buildSection(title, items, target, opts = {}) {
  const lines = items.map((item, index) => formatLineItem(item, index, target, opts));
  return [title, ...lines].join('\n');
}

function formatLineItem(item, index, target, opts = {}) {
  const name = item.name || 'รายการไม่มีชื่อ';
  const amount = formatAmount(item.actual || 0);
  const account = item.account ? ` | ${item.account}` : '';
  const fromMonth = item._fromMonth ? ` (ค้างจาก ${formatMonthKeyTH(item._fromMonth)})` : '';
  const firstLine = `${index + 1}. ${name} — ${amount} บาท${account}${fromMonth}`;
  if (opts.hideDate) return firstLine;
  const dueDay = getDueDayNumber(item);
  const dueDateText = dueDay ? buildDueDateString(target, dueDay) : null;
  return dueDateText ? `${firstLine}\n   📅 ${dueDateText}` : firstLine;
}

/**
 * ดึงเลขวันที่ครบกำหนดจากรายการ
 * รองรับทั้ง dueDay และ dueDate
 * @param {object} item - รายการค่าใช้จ่าย
 * @returns {number|null} วันครบกำหนด (1-31) หรือ null
 */
function getDueDayNumber(item = {}) {
  // รองรับ 'EOM' (วันสิ้นเดือน) โดยคืนค่า raw ให้ resolveDueDayForMonth จัดการต่อ
  if (isEndOfMonthDueDay(item.dueDay)) return item.dueDay;
  const rawDay = normalizeDueDayValue(item.dueDay);
  if (rawDay) return rawDay;
  if (typeof item.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate)) {
    const dayPart = item.dueDate.slice(-2);
    return normalizeDueDayValue(dayPart);
  }
  return null;
}

/**
 * คำนวณยอดรวมของรายการค่าใช้จ่าย
 * @param {array} items - รายการค่าใช้จ่าย
 * @returns {number} ยอดรวมทั้งหมด
 */
function sumItemAmounts(items = []) {
  return items.reduce((sum, item) => {
    const raw = Number(item.actual || 0);
    if (!Number.isNaN(raw) && Number.isFinite(raw)) {
      return sum + raw;
    }
    return sum;
  }, 0);
}

/**
 * ดึงรายชื่อผู้ใช้ที่มี LINE ID สำหรับส่งแจ้งเตือน
 * @param {string|null} targetUserId - ส่งเฉพาะผู้ใช้ หากไม่ระบุจะส่งทุกคน
 * @returns {array} รายชื่อผู้ใช้ที่มี LineId
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

function getPrevMonthKey(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
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
 * ตัวจัดการหลักของ API แจ้งเตือนค่าใช้จ่ายผ่าน LINE
 * ตรวจสอบสิทธิ์ด้วย CRON_SECRET และส่งข้อความตามเงื่อนไข
 * @param {object} req - Express request (GET/POST)
 * @param {object} res - Express response
 */
export default async function handler(req, res) {
  if (!assertApiToken(req, res, { allowCronSecret: true })) {
    return;
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
    const prevMonthKey = getPrevMonthKey(target.monthKey);
    const prevExpenseDoc = await getExpenseDocForMonth(user.id, prevMonthKey);

    if (!expenseDoc && !prevExpenseDoc) {
      results.push({ userId: user.id, sent: false, reason: 'no expense data' });
      continue;
    }

    const groupedItems = { due: [], dueSoon: [], overdue: [], otherUnpaid: [] };

    // classify current month items
    if (expenseDoc) {
      const items = extractExpenseItems(expenseDoc);
      items.filter(item => {
        if (isPaidFlag(item.paid)) return false;
        const amount = Number(item.actual || 0);
        return !Number.isNaN(amount) && amount > 0;
      }).forEach(item => {
        const { status } = getDueStatus(item, target);
        if (status === 'due') { groupedItems.due.push(item); return; }
        if (status === 'overdue') { groupedItems.overdue.push(item); return; }
        if (status === 'dueSoon') { groupedItems.dueSoon.push(item); return; }
        // invalid (no dueDay) หรือ upcoming → otherUnpaid
        groupedItems.otherUnpaid.push(item);
      });
    }

    // prev month: unpaid items ทั้งหมดถือว่าเลยกำหนดแล้ว
    if (prevExpenseDoc) {
      const prevItems = extractExpenseItems(prevExpenseDoc);
      prevItems.filter(item => {
        if (isPaidFlag(item.paid)) return false;
        const amount = Number(item.actual || 0);
        return !Number.isNaN(amount) && amount > 0;
      }).forEach(item => {
        groupedItems.overdue.push({ ...item, _fromMonth: prevMonthKey });
      });
    }

    if (notifyMode === 'due') {
      groupedItems.overdue = [];
      groupedItems.otherUnpaid = [];
    }

    if (notifyMode === 'both') {
      groupedItems.otherUnpaid = [];
    }

    const totalMatched = groupedItems.due.length + groupedItems.dueSoon.length + groupedItems.overdue.length + groupedItems.otherUnpaid.length;

    if (!totalMatched) {
      results.push({ userId: user.id, sent: false, reason: 'no due, near-due, or overdue items' });
      continue;
    }

    try {
      const message = buildMessage(target, groupedItems, notifyMode);
      await sendLineMessage(message, user.LineId);
      results.push({ userId: user.id, sent: true, count: totalMatched, breakdown: {
        due: groupedItems.due.length,
        dueSoon: groupedItems.dueSoon.length,
        overdue: groupedItems.overdue.length,
        otherUnpaid: groupedItems.otherUnpaid.length
      } });
    } catch (error) {
      results.push({ userId: user.id, sent: false, reason: error.message });
    }
  }

  return res.status(200).json({ success: true, results });
}
