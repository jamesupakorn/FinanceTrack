/**
 * คอมโพเนนต์: SavingsSourceSelect — เลือกแหล่งเงิน (ยอดกลาง / เป้าหมาย) ให้ dialog ยืมเงิน/ถอนเงิน
 * (UX_SPEC-savings-loan-withdrawal.md §4.2.1). เป็น native <select> (เหมือน account select ของตาราง
 * รายจ่าย) เพราะใช้ง่ายบนมือถือ.
 *
 * ยอดที่แสดงมาจาก server ตรง ๆ (`poolBalance` / goal.currentAmount) — ไม่มีการคำนวณยอดใหม่ที่นี่
 * (architecture-review-savings-loan-withdrawal-s4.md C-S4-2, ARCHITECTURE constraint 19).
 */

import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import type { SavingsLoanSource } from '../../shared/utils/savingsLedger';

export const SAVINGS_SOURCE_POOL_KEY = 'pool';

export interface SavingsSourceGoalOption {
  _id: string;
  goalName: string;
  currentAmount: number;
}

export interface SavingsSourceOption {
  key: string; // 'pool' or `goal:<goalId>`
  source: SavingsLoanSource;
  label: string;
  available: number;
  disabled: boolean;
}

/** `goalId` ของ goal ที่ถูกลบไปแล้ว จะไม่อยู่ใน `goals` ที่ส่งมา (D-SLW-27: รวมทั้ง active และ completed). */
export function buildSavingsSourceOptions(
  poolBalance: number,
  goals: readonly SavingsSourceGoalOption[]
): SavingsSourceOption[] {
  const poolOption: SavingsSourceOption = {
    key: SAVINGS_SOURCE_POOL_KEY,
    source: { type: 'pool' },
    label: 'ยอดกลาง',
    available: poolBalance,
    disabled: poolBalance <= 0
  };
  const goalOptions: SavingsSourceOption[] = goals.map(goal => ({
    key: `goal:${goal._id}`,
    source: { type: 'goal', goalId: goal._id },
    label: goal.goalName,
    available: goal.currentAmount,
    disabled: goal.currentAmount <= 0
  }));
  return [poolOption, ...goalOptions];
}

function optionText(option: SavingsSourceOption): string {
  // ลบติดลบใช้ U+2212 (ตามแนวทางเดียวกับ SavingsLedgerPanel.tsx การ์ดยอดกลาง) ไม่ใช่ ASCII '-' ที่
  // formatCurrency/toLocaleString คืนมาให้เอง (F-S4-5)
  const availableText = option.available < 0
    ? `−${formatCurrency(Math.abs(option.available))}`
    : formatCurrency(option.available);
  return option.disabled
    ? `${option.label} — ใช้ไม่ได้ (ยอด ${availableText} ฿)`
    : `${option.label} — ใช้ได้ ${availableText} ฿`;
}

export default function SavingsSourceSelect({
  id,
  options,
  value,
  onChange,
  disabled = false,
  className
}: {
  id: string;
  options: readonly SavingsSourceOption[];
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
  className: string;
}) {
  const poolOption = options.find(option => option.key === SAVINGS_SOURCE_POOL_KEY);
  const goalOptions = options.filter(option => option.key !== SAVINGS_SOURCE_POOL_KEY);

  return (
    <select
      id={id}
      className={className}
      value={value}
      onChange={event => onChange(event.target.value)}
      disabled={disabled}
    >
      {poolOption && (
        <option value={poolOption.key} disabled={poolOption.disabled}>
          {optionText(poolOption)}
        </option>
      )}
      {goalOptions.length > 0 && (
        <optgroup label="เป้าหมาย">
          {goalOptions.map(option => (
            <option key={option.key} value={option.key} disabled={option.disabled}>
              {optionText(option)}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
