import { buildInstallmentRowKey, INSTALLMENT_KEY_RE } from './creditCardUtils';

const MONTH_KEY_PATTERN = /^\d{4}-\d{2}$/;

export interface OverdueInstallment {
  no: number;
  dueMonth: string;
  payment: number;
}

export interface SequentialPaidResult {
  succeededNos: number[];
  failedNos: number[];
}

export function findOverdueInstallments(
  schedule: ReadonlyArray<{ no: number; dueMonth: string; payment: number }>,
  currentMonthKey: string
): OverdueInstallment[] {
  if (!MONTH_KEY_PATTERN.test(currentMonthKey)) return [];
  return schedule
    .filter(row => MONTH_KEY_PATTERN.test(row.dueMonth) && row.dueMonth < currentMonthKey)
    .map(({ no, dueMonth, payment }) => ({ no, dueMonth, payment }))
    .sort((a, b) => a.no - b.no);
}

export async function applyPaidSequentially(
  planId: string,
  rows: ReadonlyArray<{ no: number; dueMonth: string }>,
  setPaid: (month: string, key: string, paid: true) => Promise<unknown>
): Promise<SequentialPaidResult> {
  const firstRowByNo = new Map<number, { no: number; dueMonth: string }>();
  rows.forEach(row => {
    if (!firstRowByNo.has(row.no)) firstRowByNo.set(row.no, row);
  });

  const succeededNos: number[] = [];
  const failedNos: number[] = [];
  for (const row of [...firstRowByNo.values()].sort((a, b) => a.no - b.no)) {
    const key = buildInstallmentRowKey(planId, row.no);
    if (!INSTALLMENT_KEY_RE.test(key) || !MONTH_KEY_PATTERN.test(row.dueMonth)) {
      failedNos.push(row.no);
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
    }
  }
  return { succeededNos, failedNos };
}
