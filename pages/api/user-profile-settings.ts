import type { NextApiRequest, NextApiResponse } from 'next';
// TD-L05: canonical renamed location of the old /api/user-bank-accounts endpoint —
// serves both bankAccounts and budgetThresholds, so the old name was misleading.
import { assertUserId } from '../../src/shared/utils/backend/userRequest';
import { validateApiRequest } from '../../src/shared/utils/backend/apiRequestValidation';
import {
  getUserBankAccounts,
  updateUserBankAccounts,
  getUserBudgetThresholds,
  updateUserBudgetThresholds,
  getUserMonthlySummaryEnabled,
  updateUserMonthlySummaryEnabled
} from '../../lib/userStore';
import {
  BUDGET_THRESHOLD_KEYS,
  normaliseBudgetThresholds
} from '../../src/shared/utils/frontend/monthlySummary';
import { withAudit } from '../../lib/auditedMutation';

/**
 * ตรวจสอบค่า budgetThresholds ดิบจาก request body ก่อน normalise/clamp ใด ๆ (M-2 — validate ก่อน
 * เขียนเสมอ, ห้าม clamp ก่อน validate เพราะ -1/101 จะถูกกลืนเงียบ ๆ กลายเป็น 0/100 แทนที่จะโดน 400)
 * รับเฉพาะ number จำกัดหรือ numeric string ที่ Number.isFinite ยอมรับ — ปฏิเสธ boolean/array/object
 * อย่างชัดเจน เพราะ Number() coerce ค่าพวกนี้ได้โดยไม่ error (Number(true)===1, Number([])===0) (M-6)
 * @returns {string|null} ข้อความ error หรือ null ถ้าผ่านทั้ง 5 คีย์
 */
type BudgetThresholds = ReturnType<typeof normaliseBudgetThresholds>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateBudgetThresholdsRaw(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'budgetThresholds must be an object';
  }
  const values = payload as Record<string, unknown>;
  for (const key of BUDGET_THRESHOLD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      return `budgetThresholds.${key} is required`;
    }
    const value = values[key];
    if (typeof value === 'boolean' || Array.isArray(value) || (value !== null && typeof value === 'object')) {
      return `budgetThresholds.${key} must be a number`;
    }
    const numeric = Number(value);
    if (value === null || value === '' || !Number.isFinite(numeric)) {
      return `budgetThresholds.${key} must be a number`;
    }
    if (numeric < 0 || numeric > 100) {
      return `budgetThresholds.${key} must be between 0 and 100`;
    }
  }
  return null;
}

/** whitelist: เอาเฉพาะ 5 คีย์ BUDGET_THRESHOLD_KEYS ออกมาเก็บ — คีย์แปลกปลอมอื่นถูกทิ้งเสมอ (AC-RS-28) */
function pickBudgetThresholds(payload: Record<string, unknown>): BudgetThresholds {
  const picked: BudgetThresholds = {
    generalExpense: 0,
    dailyExpense: 0,
    creditCard: 0,
    savings: 0
  };
  BUDGET_THRESHOLD_KEYS.forEach((key) => {
    picked[key] = Number(payload[key]);
  });
  return picked;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = assertUserId(req, res);
  if (!userId) return;
  if (!validateApiRequest(req, res, 'user-profile-settings')) return;

  if (req.method === 'GET') {
    try {
      const [bankAccounts, budgetThresholds, monthlySummaryEnabled] = await Promise.all([
        getUserBankAccounts(userId),
        getUserBudgetThresholds(userId),
        getUserMonthlySummaryEnabled(userId)
      ]);
      return res.status(200).json({ bankAccounts, budgetThresholds, monthlySummaryEnabled });
    } catch (error) {
      if (isRecord(error) && error.message === 'User not found') {
        return res.status(200).json({
          bankAccounts: [],
          budgetThresholds: normaliseBudgetThresholds(undefined),
          monthlySummaryEnabled: true
        });
      }
      console.error('Failed to fetch user bank accounts:', error);
      return res.status(500).json({ error: 'Failed to fetch user bank accounts' });
    }
  }

  if (req.method === 'POST') {
    try {
      // req.body อาจเป็น undefined ถ้าไม่มี content-type/body มาเลย (M-5) — กัน TypeError ตอน destructure
      const body = req.body || {};
      const { bankAccounts, budgetThresholds, monthlySummaryEnabled } = body;

      if (bankAccounts === undefined && budgetThresholds === undefined && monthlySummaryEnabled === undefined) {
        return res.status(400).json({ error: 'nothing to update' });
      }

      if (bankAccounts !== undefined && !Array.isArray(bankAccounts)) {
        return res.status(400).json({ error: 'bankAccounts must be an array' });
      }

      let pickedThresholds: BudgetThresholds | undefined;
      if (budgetThresholds !== undefined) {
        const validationError = validateBudgetThresholdsRaw(budgetThresholds);
        if (validationError) {
          return res.status(400).json({ error: validationError });
        }
        if (!isRecord(budgetThresholds)) {
          return res.status(400).json({ error: 'budgetThresholds must be an object' });
        }
        pickedThresholds = pickBudgetThresholds(budgetThresholds);
      }
      if (monthlySummaryEnabled !== undefined && typeof monthlySummaryEnabled !== 'boolean') {
        return res.status(400).json({ error: 'monthlySummaryEnabled must be boolean' });
      }

      // เขียนเฉพาะคีย์ระดับบนที่ส่งมาจริง ๆ เท่านั้น (AC-RS-2/3) — bankAccounts-only body ต้อง
      // byte-identical กับพฤติกรรมเดิมก่อนเฟสนี้ทุกประการ ทั้ง request ที่ยอมรับและ response ที่ตอบกลับ
      const responsePayload: {
        success: true;
        bankAccounts?: unknown[];
        budgetThresholds?: BudgetThresholds;
        monthlySummaryEnabled?: boolean;
      } = { success: true };

      if (bankAccounts !== undefined) {
        await updateUserBankAccounts(userId, bankAccounts);
        responsePayload.bankAccounts = bankAccounts;
      }

      if (pickedThresholds !== undefined) {
        await updateUserBudgetThresholds(userId, pickedThresholds);
        responsePayload.budgetThresholds = pickedThresholds;
      }

      if (monthlySummaryEnabled !== undefined) {
        await updateUserMonthlySummaryEnabled(userId, monthlySummaryEnabled);
        responsePayload.monthlySummaryEnabled = monthlySummaryEnabled;
      }

      return res.status(200).json(responsePayload);
    } catch (error) {
      if (isRecord(error) && error.message === 'User not found') {
        return res.status(404).json({ error: 'user not found' });
      }
      console.error('Failed to update user bank accounts:', error);
      return res.status(500).json({ error: 'Failed to update user bank accounts' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAudit(handler, { source: 'user_profile_settings' });
