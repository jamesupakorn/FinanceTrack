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
  addMonths,
  getDaysInMonthKey,
  round2,
  isRevolvingRowKey,
  isInstallmentRowKey,
  parseRevolvingRowKey,
  parseInstallmentRowKey,
  isValidPurchaseDate
} from '../creditCardUtils';
import { parseToNumber } from './numberUtils';
import type { CardTotalExpenseRow } from '../backend/creditCardSync';

/** ค่าที่ diffDaysFromBase/buildMonthEvents ต้องการจาก card เท่านั้น (id, name, statementDay, dueDay) */
interface ExpenseEventCard {
  id: string;
  name?: string;
  statementDay?: unknown;
  [key: string]: unknown;
}

/** ค่าที่ buildMonthEvents ต้องการจาก plan เท่านั้น (id, cardId) */
interface ExpenseEventPlan {
  id: string;
  cardId: string;
  [key: string]: unknown;
}

/** แถวดิบหนึ่งแถวใน monthsMap[monthKey] — รูปร่างเดียวกับแถวใน monthly_expense */
interface ExpenseEventRow {
  name?: string;
  actual?: number | string;
  account?: string;
  paid?: boolean | string;
  dueDay?: unknown;
  breakdown?: CardTotalExpenseRow['breakdown'];
  /** วันครบกำหนดจริงของแถวบัตร (ccr_/cci_) จาก GET monthly_expense — derive อ่านอย่างเดียว */
  resolvedDueDate?: unknown;
  [key: string]: unknown;
}

/** เหตุการณ์ที่ derive แล้วหนึ่งรายการ (ทั้ง type: 'expense' และ type: 'statement') */
interface ExpenseEvent {
  id: string;
  type: 'expense' | 'statement';
  source: 'revolving' | 'installment' | 'plain' | 'statement';
  key: string;
  name?: string;
  amount?: number;
  account?: string;
  paid?: boolean;
  dueDay?: unknown;
  card: ExpenseEventCard | null;
  plan?: ExpenseEventPlan | null;
  installmentNo?: number | null;
  /** เดือนต้นทางของแถว (รอบบิล) — action ของยอดหมุนเวียนต้องเขียนลงเดือนนี้ ไม่ใช่เดือนที่กำลังดู */
  cycleMonth?: string;
}

// 'YYYY-MM-DD' → [, 'YYYY-MM', 'DD']
const RESOLVED_DUE_DATE_RE = /^(\d{4}-(?:0[1-9]|1[0-2]))-(0[1-9]|[12]\d|3[01])$/;

// ฟิลด์ระบบที่ไม่ใช่แถวค่าใช้จ่าย — ชุดเดียวกับ EXPENSE_IGNORED_FIELDS ของ line_due_notify.js:51-58
export const IGNORED_ROW_KEYS: Set<string> = new Set([
  '_id', 'month', 'userId', 'periodKey', 'accountSummary', 'totalActualPaid', 'bankAccounts'
]);

/**
 * สร้างแผนที่เหตุการณ์ของเดือนหนึ่งจาก monthly_expense + cards (วันสรุปยอด)
 * ย้ายมาจาก ExpenseCalendarModal.js:263-355 แบบคำต่อคำ — cardById/planById ถูกสร้างขึ้นภายในแทนที่จะรับ
 * เป็นพารามิเตอร์ เพราะที่นี่รับ cards/plans ดิบตาม §Interfaces ของ spec-dashboard.md
 * @returns {{eventsByDay: Map<number, object[]>, unscheduledEvents: object[], windowState: string, monthTotals: {total:number, paid:number, remaining:number}}}
 */
export function buildMonthEvents({
  monthKey,
  monthsMap = {},
  cards = [],
  plans = []
}: {
  monthKey: string;
  monthsMap?: Record<string, Record<string, ExpenseEventRow> | unknown>;
  cards?: ExpenseEventCard[];
  plans?: ExpenseEventPlan[];
}): {
  eventsByDay: Map<number, ExpenseEvent[]>;
  unscheduledEvents: ExpenseEvent[];
  windowState: 'in-window' | 'pruned' | 'future';
  monthTotals: { total: number; paid: number; remaining: number };
} {
  const cardById = new Map(cards.map(card => [card.id, card]));
  const planById = new Map(plans.map(plan => [plan.id, plan]));

  const daysInMonth = getDaysInMonthKey(monthKey);
  const eventsByDay = new Map<number, ExpenseEvent[]>();
  const unscheduledEvents: ExpenseEvent[] = [];
  const pushDay = (day: number, event: ExpenseEvent) => {
    if (!eventsByDay.has(day)) eventsByDay.set(day, []);
    eventsByDay.get(day)!.push(event);
  };

  // สถานะเทียบกับหน้าต่างข้อมูล 15 เดือน (KL-1 / BR-CC-019) — ดูตาราง 3 สถานะใน spec §Feature 2
  const monthKeys = Object.keys(monthsMap).sort();
  let windowState: 'in-window' | 'pruned' | 'future' = 'in-window';
  if (!Object.prototype.hasOwnProperty.call(monthsMap, monthKey) && monthKeys.length > 0) {
    windowState = monthKey < monthKeys[0] ? 'pruned' : 'future';
  }

  // แหล่งแถว: เดือน M เอง + เดือน M-1 (รอบบิลที่ครบกำหนดข้ามมาเดือนนี้, spec-credit-card-cross-month-due.md)
  // แถวบัตรที่มี resolvedDueDate วางตามวันครบกำหนดจริง — แถวที่ไม่มี (แถวปกติ/payload เก่า) ใช้ทางเดิมเฉพาะแถวของ M
  // ทูเพิล [key, row, cycleMonth] — cycleMonth = เดือนต้นทางของแถว (รอบบิล)
  // Set กันอ่านเดือนเดียวกันซ้ำเมื่อ monthKey ไม่ถูกต้อง (addMonths คืนค่าเดิม)
  const sourceMonths = Array.from(new Set([addMonths(monthKey, -1), monthKey]));
  const eventRows: [string, ExpenseEventRow, string][] = sourceMonths.flatMap(cycleMonth => {
    const rows = (monthsMap[cycleMonth] && typeof monthsMap[cycleMonth] === 'object') ? monthsMap[cycleMonth] : {};
    return Object.entries(rows as Record<string, ExpenseEventRow>)
      .map(([key, row]): [string, ExpenseEventRow, string] => [key, row, cycleMonth]);
  });
  const expandedRows: [string, ExpenseEventRow, string][] = eventRows.flatMap(([key, row, cycleMonth]) => {
    if (!isRevolvingRowKey(key) || !row?.breakdown) return [[key, row, cycleMonth]];
    const breakdown = row.breakdown;
    // บรรทัด cci_ ที่แตกออกมาสืบ resolvedDueDate + cycleMonth จากแถว ccr_ แม่ — ห้ามคำนวณใหม่
    const installments: [string, ExpenseEventRow, string][] = breakdown.installments.map(line => [
      line.key,
      { name: line.name, actual: line.amount, paid: line.paid, dueDay: row.dueDay, account: row.account, resolvedDueDate: row.resolvedDueDate },
      cycleMonth
    ]);
    const revolving: [string, ExpenseEventRow, string][] = (breakdown.revolving.totalDue !== 0 || breakdown.revolving.newSpend !== 0) ? [[key, {
      ...row,
      actual: Math.max(0, breakdown.revolving.totalDue),
      paid: breakdown.revolving.paymentAction !== null || breakdown.revolving.totalDue <= 0
    }, cycleMonth]] : [];
    return [...installments, ...revolving];
  });
  expandedRows.forEach(([key, row, cycleMonth]) => {
    if (IGNORED_ROW_KEYS.has(key)) return;
    if (!row || typeof row !== 'object') return;

    const source = isRevolvingRowKey(key) ? 'revolving' : (isInstallmentRowKey(key) ? 'installment' : 'plain');
    let card: ExpenseEventCard | null = null;
    let plan: ExpenseEventPlan | null = null;
    let installmentNo: number | null = null;

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

    // วันครบกำหนดจริงของแถวบัตร (derive ฝั่งเซิร์ฟเวอร์ ไม่เก็บ) — วางเฉพาะเมื่อตกในเดือน M ที่กำลังดู
    // isValidPurchaseDate ตัดวันที่เป็นไปไม่ได้ (เช่น 2026-02-30) — validator เดียวกับ ExpenseTable.rowDueDate
    const resolvedMatch = source !== 'plain' && isValidPurchaseDate(row.resolvedDueDate)
      ? RESOLVED_DUE_DATE_RE.exec(row.resolvedDueDate)
      : null;
    if (resolvedMatch && resolvedMatch[1] !== monthKey) return;
    if (!resolvedMatch && cycleMonth !== monthKey) return;

    const event: ExpenseEvent = {
      id: `${cycleMonth}_${key}`,
      type: 'expense',
      source,
      key,
      name: row.name || 'รายการ',
      amount: parseToNumber(row.actual ?? 0),
      account: row.account || '',
      paid: row.paid === true || row.paid === 'true',
      dueDay: row.dueDay,
      card,
      plan,
      installmentNo,
      cycleMonth
    };

    // dueDay แก้ไม่ได้/แก้ไม่ออก → ไม่ทิ้ง แต่ไปอยู่ถาดด้านล่างแทน (BR-003, edge case 22)
    const day = resolvedMatch ? Number(resolvedMatch[2]) : resolveDueDayForMonth(row.dueDay, daysInMonth);
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
        card,
        cycleMonth: monthKey
      });
    }
  });

  let total = 0;
  let paidTotal = 0;
  eventsByDay.forEach(events => {
    events.forEach(event => {
      if (event.type !== 'expense') return;
      total += event.amount ?? 0;
      if (event.paid) paidTotal += event.amount ?? 0;
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
function diffDaysFromBase(isoDate: string, today: Date): number {
  const [yearStr, monthStr, dayStr] = isoDate.split('-');
  const target = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
  target.setHours(0, 0, 0, 0);
  const base = new Date(today);
  base.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}

/**
 * รายการ "ครบกำหนด" ที่ยังไม่ชำระ — เกินกำหนดแล้ว หรือครบกำหนดภายใน horizonDays วันข้างหน้า
 * สแกนเดือนที่มี today อยู่ + เดือนถัดไป เพื่อให้ช่วงที่คาบเกี่ยวรอยต่อเดือนถูกครอบคลุม (BR-DASH-011/012)
 * ไม่ derive จาก plans/cycles ตรง ๆ — ใช้ buildMonthEvents() ตัวเดียวกับปฏิทินเสมอ (single source)
 * @returns {{overdue: object[], dueToday: object[], dueSoon: object[], total: number}}
 */
export function collectUpcomingPayments({
  monthsMap = {}, cards = [], plans = [], today = new Date(), horizonDays = 7
}: {
  monthsMap?: Record<string, unknown>;
  cards?: ExpenseEventCard[];
  plans?: ExpenseEventPlan[];
  today?: Date;
  horizonDays?: number;
} = {}): {
  overdue: (ExpenseEvent & { isoDate: string; daysDiff: number })[];
  dueToday: (ExpenseEvent & { isoDate: string; daysDiff: number })[];
  dueSoon: (ExpenseEvent & { isoDate: string; daysDiff: number })[];
  total: number;
} {
  const baseDate = (today instanceof Date && !Number.isNaN(today.getTime())) ? today : new Date();
  const [yearStr, monthStr] = [baseDate.getFullYear(), String(baseDate.getMonth() + 1).padStart(2, '0')];
  const currentMonthKey = `${yearStr}-${monthStr}`;
  const [ny, nm] = currentMonthKey.split('-').map(Number);
  const nextTotal = ny * 12 + (nm - 1) + 1;
  const nextMonthKey = `${Math.floor(nextTotal / 12)}-${String((nextTotal % 12) + 1).padStart(2, '0')}`;

  const overdue: (ExpenseEvent & { isoDate: string; daysDiff: number })[] = [];
  const dueToday: (ExpenseEvent & { isoDate: string; daysDiff: number })[] = [];
  const dueSoon: (ExpenseEvent & { isoDate: string; daysDiff: number })[] = [];

  [currentMonthKey, nextMonthKey].forEach(monthKey => {
    const { eventsByDay } = buildMonthEvents({ monthKey, monthsMap, cards, plans });
    eventsByDay.forEach((events, day) => {
      events.forEach(event => {
        if (event.type !== 'expense' || event.paid) return; // ชำระแล้ว → ไม่ต้องนับ (AC-DB-15)
        if (!(event.amount != null && event.amount > 0)) return; // ยอด 0/ว่าง → ยังไม่นับเกินกำหนด เหมือน line_due_notify.js:462-463
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
