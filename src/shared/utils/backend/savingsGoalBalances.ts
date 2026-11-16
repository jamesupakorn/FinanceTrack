/**
 * savingsGoalBalances.ts  (server-only)
 * ที่เดียวที่คำนวณ currentAmount ของ savings goal (R-SLW-3, D-SLW-17)
 * ย้ายมาจาก pages/api/savings-goals.ts แบบไม่เปลี่ยนพฤติกรรม (AC-SLW-02)
 */

import { readAdjustments, sumAdjustments } from '../savingsGoalAdjustments';

export interface SavingsGoal {
  _id: string;
  goalName: string;
  targetAmount: number;
  status: string;
  allocationPercent?: number | null;
  metadata?: Record<string, unknown>;
  adjustments?: unknown;
  [key: string]: unknown;
}

export interface SavingsEntry {
  savings_type?: string;
  รายการ?: string;
  savings_amount?: number | string;
  จำนวนเงิน?: number | string;
}

export interface SavingsDocument {
  savings_list?: SavingsEntry[];
  [key: string]: unknown;
}

/**
 * คำนวณ currentAmount ของแต่ละ goal:
 * currentAmount = ผลรวม savings ที่ตรงกับ goalName (case-insensitive trim match)
 *               + sumAdjustments(adjustments) (ปัดทศนิยม 2 ตำแหน่ง, ไม่ clamp ที่ 0)
 * adjustmentsTotal คำนวณใหม่ทุกครั้ง ไม่เคยบันทึกลง DB
 * @param {Array} goals - goals array
 * @param {Array} savingsDocs - savings docs array (all months for this user)
 */
export function computeCurrentAmounts(goals: SavingsGoal[], savingsDocs: SavingsDocument[]) {
  return goals.map(goal => {
    const goalName = (goal.goalName || '').trim().toLowerCase();
    let currentAmount = 0;

    savingsDocs.forEach(doc => {
      if (!doc || !doc.savings_list || !Array.isArray(doc.savings_list)) return;
      doc.savings_list.forEach(item => {
        const itemType = (item?.savings_type || item?.รายการ || '').trim().toLowerCase();
        if (itemType === goalName) {
          const raw = item.savings_amount ?? item.จำนวนเงิน ?? 0;
          const amt = typeof raw === 'number'
            ? raw
            : Number(String(raw).replace(/,/g, '')) || 0;
          currentAmount += amt;
        }
      });
    });

    const adjustments = readAdjustments(goal);
    const adjustmentsTotal = sumAdjustments(adjustments);
    currentAmount += adjustmentsTotal;

    const targetAmount = Number(goal.targetAmount) || 0;
    const progressPercentage = targetAmount > 0
      ? Math.min(100, Math.round((currentAmount / targetAmount) * 10000) / 100)
      : 0;
    const remainingAmount = Math.max(0, targetAmount - currentAmount);

    return {
      ...goal,
      currentAmount,
      adjustments,
      metadata: {
        ...(goal.metadata || {}),
        progressPercentage,
        remainingAmount,
        adjustmentsTotal,
      }
    };
  });
}
