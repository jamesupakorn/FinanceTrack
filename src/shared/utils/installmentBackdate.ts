import { addMonths, buildInstallmentRowKey, INSTALLMENT_KEY_RE } from './creditCardUtils';

const MONTH_KEY_PATTERN = /^\d{4}-\d{2}$/;

export interface TickableInstallment {
  no: number;
  dueMonth: string;
  payment: number;
}

export interface SequentialPaidResult {
  succeededNos: number[];
  failedNos: number[];
}

/**
 * Rows already due (current month and earlier) that the user may confirm as paid when creating a plan; future rows excluded.
 * `row.dueMonth` is the billing-cycle month; cards whose due day falls in the next month (getCardDueMonthOffset = 1)
 * are paid one month later, so the cash month is addMonths(dueMonth, dueMonthOffset).
 */
export function findTickableInstallments(
  schedule: ReadonlyArray<{ no: number; dueMonth: string; payment: number }>,
  currentMonthKey: string,
  dueMonthOffset: 0 | 1 = 0
): TickableInstallment[] {
  if (!MONTH_KEY_PATTERN.test(currentMonthKey)) return [];
  return schedule
    .filter(row => MONTH_KEY_PATTERN.test(row.dueMonth) && addMonths(row.dueMonth, dueMonthOffset) <= currentMonthKey)
    .map(({ no, dueMonth, payment }) => ({ no, dueMonth, payment }))
    .sort((a, b) => a.no - b.no);
}

export async function applyPaidSequentially(
  planId: string,
  rows: ReadonlyArray<{ no: number; dueMonth: string }>,
  setPaid: (month: string, key: string, paid: true) => Promise<unknown>,
  onProgress?: (done: number, total: number) => void
): Promise<SequentialPaidResult> {
  const firstRowByNo = new Map<number, { no: number; dueMonth: string }>();
  rows.forEach(row => {
    if (!firstRowByNo.has(row.no)) firstRowByNo.set(row.no, row);
  });

  const total = firstRowByNo.size;
  const succeededNos: number[] = [];
  const failedNos: number[] = [];
  let done = 0;
  for (const row of [...firstRowByNo.values()].sort((a, b) => a.no - b.no)) {
    const key = buildInstallmentRowKey(planId, row.no);
    if (!INSTALLMENT_KEY_RE.test(key) || !MONTH_KEY_PATTERN.test(row.dueMonth)) {
      failedNos.push(row.no);
      done += 1;
      onProgress?.(done, total);
      continue;
    }
    try {
      const response = await setPaid(row.dueMonth, key, true);
      if (response !== null && typeof response === 'object' && 'paid' in response && response.paid === false) {
        failedNos.push(row.no);
      } else {
        succeededNos.push(row.no);
      }
    } catch {
      failedNos.push(row.no);
    } finally {
      done += 1;
      onProgress?.(done, total);
    }
  }
  return { succeededNos, failedNos };
}
