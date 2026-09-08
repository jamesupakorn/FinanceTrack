/**
 * expenseEvents.js
 * สกัดออกจาก ExpenseCalendarModal.js:263-355 (คำต่อคำ) — ตรรกะการ derive "เหตุการณ์ครบกำหนด/วันสรุปยอด"
 * จากข้อมูล monthly_expense เพื่อให้ทั้งปฏิทิน (modal เดิม + DashboardCalendarSection ใหม่) และ
 * รายการ "ครบกำหนด" ของแดชบอร์ดใช้แหล่งเดียวกัน ห้ามมีที่ที่สองที่ derive เหตุการณ์จาก plans/cycles ตรง ๆ
 * (BR-DASH-012 / ADR-012 / BR-CC-019) — cards/plans ในไฟล์นี้ใช้แค่ตกแต่ง (ชื่อ/สี/งวด n/N) และวันสรุปยอด
 *
 * Pure module: ไม่มี fetch, ไม่มี React ทุกยอดเงินผ่าน round2 เสมอ (เหมือน monthlySummary.js)
 */

import { resolveDueDayForMonth } from '../dateUtils';
import {
  getDaysInMonthKey,
  round2,
  isRevolvingRowKey,
  isInstallmentRowKey,
  parseRevolvingRowKey,
  parseInstallmentRowKey
} from '../creditCardUtils';
import { parseToNumber } from './numberUtils';

// ฟิลด์ระบบที่ไม่ใช่แถวค่าใช้จ่าย — ชุดเดียวกับ EXPENSE_IGNORED_FIELDS ของ line_due_notify.js:51-58
export const IGNORED_ROW_KEYS = new Set([
  '_id', 'month', 'userId', 'periodKey', 'accountSummary', 'totalActualPaid', 'bankAccounts'
]);

/**
 * สร้างแผนที่เหตุการณ์ของเดือนหนึ่งจาก monthly_expense + cards (วันสรุปยอด)
 * ย้ายมาจาก ExpenseCalendarModal.js:263-355 แบบคำต่อคำ — cardById/planById ถูกสร้างขึ้นภายในแทนที่จะรับ
 * เป็นพารามิเตอร์ เพราะที่นี่รับ cards/plans ดิบตาม §Interfaces ของ spec-dashboard.md
 * @returns {{eventsByDay: Map<number, object[]>, unscheduledEvents: object[], windowState: string, monthTotals: {total:number, paid:number, remaining:number}}}
 */
export function buildMonthEvents({ monthKey, monthsMap = {}, cards = [], plans = [] } = {}) {
  const cardById = new Map(cards.map(card => [card.id, card]));
  const planById = new Map(plans.map(plan => [plan.id, plan]));

  const daysInMonth = getDaysInMonthKey(monthKey);
  const eventsByDay = new Map();
  const unscheduledEvents = [];
  const pushDay = (day, event) => {
    if (!eventsByDay.has(day)) eventsByDay.set(day, []);
    eventsByDay.get(day).push(event);
  };

  // สถานะเทียบกับหน้าต่างข้อมูล 15 เดือน (KL-1 / BR-CC-019) — ดูตาราง 3 สถานะใน spec §Feature 2
  const monthKeys = Object.keys(monthsMap).sort();
  let windowState = 'in-window';
  if (!Object.prototype.hasOwnProperty.call(monthsMap, monthKey) && monthKeys.length > 0) {
    windowState = monthKey < monthKeys[0] ? 'pruned' : 'future';
  }

  const rows = (monthsMap[monthKey] && typeof monthsMap[monthKey] === 'object') ? monthsMap[monthKey] : {};
  Object.entries(rows).forEach(([key, row]) => {
    if (IGNORED_ROW_KEYS.has(key)) return;
    if (!row || typeof row !== 'object') return;

    const source = isRevolvingRowKey(key) ? 'revolving' : (isInstallmentRowKey(key) ? 'installment' : 'plain');
    let card = null;
    let plan = null;
    let installmentNo = null;

    if (source === 'revolving') {
      const parsed = parseRevolvingRowKey(key);
      card = parsed ? cardById.get(parsed.cardId) || null : null;
    } else if (source === 'installment') {
      const parsed = parseInstallmentRowKey(key);
      if (parsed) {
        plan = planById.get(parsed.planId) || null;
        installmentNo = parsed.installmentNo;
        card = plan ? cardById.get(plan.cardId) || null : null;
      }
    }

    const event = {
      id: `${monthKey}_${key}`,
      type: 'expense',
      source,
      key,
      name: row.name || 'รายการ',
      amount: parseToNumber(row.actual),
      account: row.account || '',
      paid: row.paid === true || row.paid === 'true',
      dueDay: row.dueDay,
      card,
      plan,
      installmentNo
    };

    // dueDay แก้ไม่ได้/แก้ไม่ออก → ไม่ทิ้ง แต่ไปอยู่ถาดด้านล่างแทน (BR-003, edge case 22)
    const day = resolveDueDayForMonth(row.dueDay, daysInMonth);
    if (!day) {
      unscheduledEvents.push(event);
      return;
    }
    pushDay(day, event);
  });

  // วันสรุปยอด — สิ่งเดียวของบัตรที่ไม่มีแถวใน monthly_expense เลย มีทุกเดือนแม้ไม่มีรายจ่าย
  cards.forEach(card => {
    const statementDay = resolveDueDayForMonth(card.statementDay, daysInMonth);
    if (statementDay) {
      pushDay(statementDay, {
        id: `${monthKey}_st_${card.id}`,
        type: 'statement',
        source: 'statement',
        key: `st_${card.id}`,
        card
      });
    }
  });

  let total = 0;
  let paidTotal = 0;
  eventsByDay.forEach(events => {
    events.forEach(event => {
      if (event.type !== 'expense') return;
      total += event.amount;
      if (event.paid) paidTotal += event.amount;
    });
  });

  return {
    eventsByDay,
    unscheduledEvents,
    windowState,
    monthTotals: { total: round2(total), paid: round2(paidTotal), remaining: round2(total - paidTotal) }
  };
}

/** จำนวนวันจากวันฐาน (today) ถึง isoDate — คำนวณเทียบกับ today ที่รับเข้ามา ไม่ใช่ Date.now() ตรง ๆ
 * เพื่อให้ collectUpcomingPayments เป็น pure function ทดสอบได้โดยไม่ต้อง mock นาฬิกาเครื่อง */
function diffDaysFromBase(isoDate, today) {
  const [yearStr, monthStr, dayStr] = isoDate.split('-');
  const target = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
  target.setHours(0, 0, 0, 0);
  const base = new Date(today);
  base.setHours(0, 0, 0, 0);
  return Math.round((target - base) / 86400000);
}

/**
 * รายการ "ครบกำหนด" ที่ยังไม่ชำระ — เกินกำหนดแล้ว หรือครบกำหนดภายใน horizonDays วันข้างหน้า
 * สแกนเดือนที่มี today อยู่ + เดือนถัดไป เพื่อให้ช่วงที่คาบเกี่ยวรอยต่อเดือนถูกครอบคลุม (BR-DASH-011/012)
 * ไม่ derive จาก plans/cycles ตรง ๆ — ใช้ buildMonthEvents() ตัวเดียวกับปฏิทินเสมอ (single source)
 * @returns {{overdue: object[], dueToday: object[], dueSoon: object[], total: number}}
 */
export function collectUpcomingPayments({
  monthsMap = {}, cards = [], plans = [], today = new Date(), horizonDays = 7
} = {}) {
  const baseDate = (today instanceof Date && !Number.isNaN(today.getTime())) ? today : new Date();
  const [yearStr, monthStr] = [baseDate.getFullYear(), String(baseDate.getMonth() + 1).padStart(2, '0')];
  const currentMonthKey = `${yearStr}-${monthStr}`;
  const [ny, nm] = currentMonthKey.split('-').map(Number);
  const nextTotal = ny * 12 + (nm - 1) + 1;
  const nextMonthKey = `${Math.floor(nextTotal / 12)}-${String((nextTotal % 12) + 1).padStart(2, '0')}`;

  const overdue = [];
  const dueToday = [];
  const dueSoon = [];

  [currentMonthKey, nextMonthKey].forEach(monthKey => {
    const { eventsByDay } = buildMonthEvents({ monthKey, monthsMap, cards, plans });
    eventsByDay.forEach((events, day) => {
      events.forEach(event => {
        if (event.type !== 'expense' || event.paid) return; // ชำระแล้ว → ไม่ต้องนับ (AC-DB-15)
        const isoDate = `${monthKey}-${String(day).padStart(2, '0')}`;
        const daysDiff = diffDaysFromBase(isoDate, baseDate);
        const enriched = { ...event, isoDate, daysDiff };
        if (daysDiff < 0) overdue.push(enriched);
        else if (daysDiff === 0) dueToday.push(enriched);
        else if (daysDiff <= horizonDays) dueSoon.push(enriched);
      });
    });
  });

  overdue.sort((a, b) => a.daysDiff - b.daysDiff); // เกินกำหนดนานสุดก่อน (ค่าติดลบมากสุดก่อน)
  dueSoon.sort((a, b) => a.daysDiff - b.daysDiff); // ใกล้ครบกำหนดสุดก่อน

  return { overdue, dueToday, dueSoon, total: overdue.length + dueToday.length + dueSoon.length };
}
