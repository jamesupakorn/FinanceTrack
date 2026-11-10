/**
 * expenseDueText.ts
 * ตัวช่วยข้อความ "ครบกำหนด" ของแถวค่าใช้จ่าย — ย้ายมาจาก ExpenseTable.tsx โดยไม่เปลี่ยนพฤติกรรม
 * ใช้ร่วมกันระหว่างตารางค่าใช้จ่าย ตารางบัญชีธนาคาร และ panel แจกแจงยอด (ไม่มี formatter ซ้ำ)
 */

import type { MonthKey } from '../../types/domain';
import { isEndOfMonthDueDay } from '../dateUtils';
import { formatIsoDateTH, isValidPurchaseDate } from '../creditCardUtils';

export type DueRowLike = { dueDay?: unknown; resolvedDueDate?: unknown };

export const formatDueDayText = (dueDayValue: unknown): string => {
  if (isEndOfMonthDueDay(dueDayValue)) return 'วันสิ้นเดือน';
  return dueDayValue ? `วันที่ ${String(dueDayValue)}` : '';
};

/** resolvedDueDate ('YYYY-MM-DD') ของแถวบัตรจาก GET monthly_expense — ไม่ถูกต้อง/ไม่มี => null */
// validator เดียวกับ expenseEvents.buildMonthEvents (isValidPurchaseDate) — ตัดวันที่เป็นไปไม่ได้ เช่น 2026-02-30
export const getValidResolvedDueDate = (value: unknown): string | null => (isValidPurchaseDate(value) ? value : null);

/** ข้อความช่องครบกำหนด — ข้ามเดือน => วันที่เต็ม (เช่น "10 พ.ย. 2569") ไม่เช่นนั้นเหมือนเดิม */
export const formatRowDueText = (row: DueRowLike, monthKey: MonthKey | null | undefined): string => {
  const resolved = getValidResolvedDueDate(row.resolvedDueDate);
  if (resolved && resolved.slice(0, 7) !== monthKey) return formatIsoDateTH(resolved);
  return formatDueDayText(row.dueDay);
};
