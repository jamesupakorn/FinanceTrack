// ตรรกะเนื้อหาเพิ่มเติมของ LINE Monthly Summary (AC-7/8/9) — pure functions ไม่แตะ DB
// ตัวเลขการเงินทั้งหมดมาจาก getMonthlySummaryModel (BR-DASH-005); ที่นี่ทำแค่เทียบและจัดรูป

import { isEndOfMonthDueDay, normalizeDueDayValue, resolveDueDayForMonth, getDaysInMonth } from '../dateUtils';
import { isPaidFlag } from '../commonUtils';

export const MAX_UPCOMING_DUES = 5;

export type DeltaState = 'noPrevious' | 'new' | 'flat' | 'change';

export interface MetricDelta {
  current: number;
  previous: number;
  percent: number | null;
  state: DeltaState;
}

export interface UpcomingDue {
  name: string;
  amount: number;
  day: number;
}

export interface UpcomingDues {
  monthKey: string;
  items: UpcomingDue[];
  extraCount: number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function getPrevMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function getNextMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** เทียบค่าเดือนนี้กับเดือนก่อน โดยไม่ปล่อย NaN/Infinity ออกมา (AC-7) */
export function computeDelta(current: number, previous: number, hasPrevious: boolean): MetricDelta {
  const cur = Number.isFinite(current) ? current : 0;
  const prev = Number.isFinite(previous) ? previous : 0;
  if (!hasPrevious) return { current: cur, previous: 0, percent: null, state: 'noPrevious' };
  if (prev === 0) {
    return { current: cur, previous: prev, percent: null, state: cur > 0 ? 'new' : 'flat' };
  }
  const percent = round2(((cur - prev) / Math.abs(prev)) * 100);
  return { current: cur, previous: prev, percent, state: percent === 0 ? 'flat' : 'change' };
}

/** ข้อความสั้นสำหรับต่อท้ายบรรทัด เช่น "เทียบเดือนที่แล้ว +12%" */
export function formatDeltaLabel(delta: MetricDelta): string {
  switch (delta.state) {
    case 'noPrevious': return 'ไม่มีข้อมูลเดือนที่แล้ว';
    case 'new': return 'เทียบเดือนที่แล้ว ใหม่';
    case 'flat': return 'เทียบเดือนที่แล้ว 0%';
    default: {
      const percent = delta.percent as number;
      return `เทียบเดือนที่แล้ว ${percent > 0 ? '+' : ''}${percent}%`;
    }
  }
}

/** % ของเป้าหมายที่ทำได้ — สูตรเดียวกับ pages/api/savings-goals.js (clamp 100, 2 ตำแหน่ง, target<=0 → 0) */
export function computeGoalProgress(current: number, target: number): number {
  if (!(target > 0)) return 0;
  return Math.min(100, Math.round((current / target) * 10000) / 100);
}

const IGNORED_DOC_KEYS = new Set(['_id', 'month', 'userId', 'periodKey', 'accountSummary', 'totalActualPaid']);

/** รายการที่ต้องจ่ายในเดือน monthKey เรียงตามวันครบกำหนด จำกัด MAX_UPCOMING_DUES (AC-9) */
export function buildUpcomingDues(
  expenseDoc: Record<string, any> | null | undefined,
  monthKey: string
): UpcomingDues | null {
  if (!expenseDoc || typeof expenseDoc !== 'object') return null;
  const [year, month] = monthKey.split('-').map(Number);
  const daysInMonth = getDaysInMonth(year, month - 1);

  const dues: UpcomingDue[] = [];
  Object.entries(expenseDoc).forEach(([key, item]) => {
    if (IGNORED_DOC_KEYS.has(key) || !item || typeof item !== 'object') return;
    if (isPaidFlag(item.paid)) return;
    const amount = Number(item.actual || 0);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const rawDay = isEndOfMonthDueDay(item.dueDay) ? item.dueDay : normalizeDueDayValue(item.dueDay);
    const day = resolveDueDayForMonth(rawDay, daysInMonth);
    if (!day) return;
    dues.push({ name: String(item.name || key || 'รายการไม่มีชื่อ'), amount, day });
  });

  if (!dues.length) return null;
  dues.sort((a, b) => a.day - b.day);
  return {
    monthKey,
    items: dues.slice(0, MAX_UPCOMING_DUES),
    extraCount: Math.max(0, dues.length - MAX_UPCOMING_DUES)
  };
}
