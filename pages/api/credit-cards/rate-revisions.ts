/**
 * API: /api/credit-cards/rate-revisions
 * ปรับอัตราดอกเบี้ยสินเชื่อตั้งแต่งวดที่ระบุเป็นต้นไป (BR-CC-039/040, ADR-034, spec loan-installments §I-4)
 * - POST : { planId, effectiveMonth: 'YYYY-MM', annualRate } → คำนวณงวดที่ยังไม่ชำระใหม่ทั้งหมดฝั่ง server
 *
 * ลำดับการตรวจ: assertUserId → validateApiRequest → shape (400) → ภายใน updateUserCreditData:
 * plan (404) → ประเภทสินเชื่อ (400) → ongoing (409) → k จาก effectiveMonth (400) → ส่วนท้ายยังไม่ชำระ (409)
 * → ไม่ย้อนหลังกว่าครั้งล่าสุด (409) → อัตรา 0–100 และต่างจากเดิม (400) → เพดานจำนวนครั้ง (409)
 * → calculated/effective (409) → reviseEffectiveScheduleTail → เขียน
 *
 * ห้ามเชื่อเงินจาก client: อ่านจาก body เฉพาะ planId / effectiveMonth / annualRate เท่านั้น
 * schedule / monthlyPayment / totals ที่ส่งมาถูกทิ้งทั้งหมด (AC-LN-23)
 * ทุกการตรวจทำภายใน updateUserCreditData เพื่อให้การติ๊กชำระที่เข้ามาก่อนทำให้คำขอนี้ได้ 409 แทนการเขียนทับ (E-28)
 */

import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { assertUserId } from '../../../src/shared/utils/backend/userRequest';
import { validateApiRequest } from '../../../src/shared/utils/backend/apiRequestValidation';
import { updateUserCreditData, type CreditPlan } from '../../../src/shared/utils/backend/creditCardStore';
import {
  summarisePlan,
  isLoanCardType,
  round2,
  toAmount,
  MAX_RATE_REVISIONS_PER_PLAN,
  PLAN_STATUS
} from '../../../src/shared/utils/creditCardUtils';
// k จากเดือนที่เลือก: helper ตัวเดียวกับ preview ใน LoanRateRevisionDialog (N-4)
import { findRevisionInstallmentNo, reviseEffectiveScheduleTail } from '../../../src/shared/utils/creditCardAmortization';
import { withAudit } from '../../../lib/auditedMutation';

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

type Failure = { status: number; body: Record<string, unknown> };

type RevisableRow = {
  no: number;
  dueMonth: string;
  payment: number;
  principal: number;
  interest: number;
  paid?: boolean;
};

type RateRevision = {
  id: string;
  effectiveMonth: string;
  fromInstallmentNo: number;
  previousRate: number;
  newRate: number;
  revisedAt: string;
};

function generateRevisionId() {
  return `rr_${crypto.randomBytes(6).toString('hex')}`;
}

function readRevisions(plan: CreditPlan): RateRevision[] {
  return Array.isArray(plan.rateRevisions) ? (plan.rateRevisions as RateRevision[]) : [];
}

/** ตารางที่เก็บไว้ต้องเป็นตัวเลขครบทุกแถว — ใช้ตรงตามเดิมโดยไม่แปลงค่า เพื่อให้งวดก่อน k คงค่าเดิมทุก byte */
function isRevisableSchedule(rows: unknown[]): rows is RevisableRow[] {
  return rows.every(row => {
    const r = row as Partial<RevisableRow> | null;
    return !!r
      && Number.isInteger(r.no)
      && typeof r.dueMonth === 'string'
      && [r.payment, r.principal, r.interest].every(v => typeof v === 'number' && Number.isFinite(v));
  });
}

function parseBody(body: unknown): { ok: true; planId: string; effectiveMonth: string; rate: number } | { ok: false; failure: Failure } {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const planId = typeof input.planId === 'string' ? input.planId.trim() : '';
  const effectiveMonth = typeof input.effectiveMonth === 'string' ? input.effectiveMonth.trim() : '';
  const rawRate = input.annualRate;
  const rate = typeof rawRate === 'number' || typeof rawRate === 'string' ? toAmount(rawRate) : NaN;

  const errors: Record<string, string> = {};
  if (!planId) errors.planId = 'planId required';
  if (!MONTH_KEY_RE.test(effectiveMonth)) errors.effectiveMonth = 'effectiveMonth must be YYYY-MM';
  if (!Number.isFinite(rate)) errors.annualRate = 'annualRate must be a number';
  if (Object.keys(errors).length) {
    return { ok: false, failure: { status: 400, body: { error: 'invalid rate revision payload', errors } } };
  }
  return { ok: true, planId, effectiveMonth, rate };
}

async function handlePost(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const parsed = parseBody(req.body);
  if (!parsed.ok) return res.status(parsed.failure.status).json(parsed.failure.body);
  const { planId, effectiveMonth, rate } = parsed;

  let savedPlan: CreditPlan | null = null;
  let failure: Failure | null = null;
  const fail = (status: number, error: string) => { failure = { status, body: { error } }; };

  await updateUserCreditData(userId, (data) => {
    // ค้นเฉพาะในเอกสารของผู้ใช้คนนี้ — planId ของคนอื่นจึงได้ 404 เสมอ
    const index = data.plans.findIndex(plan => plan?.id === planId);
    if (index === -1) {
      fail(404, 'plan not found');
      return data;
    }
    const existing = data.plans[index];

    const card = data.cards.find(item => item?.id === existing.cardId);
    if (!card || !isLoanCardType(card.cardType)) {
      fail(400, 'rate revision is only for loans');
      return data;
    }
    if (existing.status !== PLAN_STATUS.ONGOING) {
      fail(409, 'plan is not ongoing');
      return data;
    }

    const rows = Array.isArray(existing.schedule) ? existing.schedule : [];
    const k = findRevisionInstallmentNo(rows, effectiveMonth);
    if (k === null) {
      fail(400, 'effectiveMonth is not an installment month');
      return data;
    }
    if (rows.some((row, i) => i + 1 >= k && row?.paid === true)) {
      fail(409, 'tail has paid installments');
      return data;
    }

    const revisions = readRevisions(existing);
    const latest = revisions[revisions.length - 1];
    // เดือนเดียวกับครั้งล่าสุดได้ (บันทึกการแก้ไข) แต่ย้อนหลังไม่ได้ (BR-CC-040)
    if (latest && effectiveMonth < String(latest.effectiveMonth)) {
      fail(409, 'effectiveMonth is before the latest revision');
      return data;
    }

    if (rate < 0 || rate > 100) {
      fail(400, 'annualRate must be between 0 and 100');
      return data;
    }
    const newRate = round2(rate);
    const previousRate = round2(toAmount(existing.annualRate as number | string));
    if (newRate === previousRate) {
      fail(400, 'annualRate is unchanged');
      return data;
    }

    if (revisions.length >= MAX_RATE_REVISIONS_PER_PLAN) {
      fail(409, `rate revision limit reached (${MAX_RATE_REVISIONS_PER_PLAN})`);
      return data;
    }
    // ADR-034 precondition #2 — แผนสินเชื่อถูกบังคับเป็นแบบนี้ตั้งแต่สร้าง ตรวจซ้ำไว้กันกรณีกติกาอื่นหลวมลง (N-2)
    if (existing.interestMode !== 'calculated' || existing.calcMethod !== 'effective') {
      fail(409, 'rate revision requires an effective-rate loan plan');
      return data;
    }
    if (!isRevisableSchedule(rows)) {
      fail(409, 'plan schedule is malformed');
      return data;
    }

    const revised = reviseEffectiveScheduleTail(
      { totalPrice: existing.totalPrice as number | string, schedule: rows },
      { fromInstallmentNo: k, annualRate: newRate }
    );
    if (!revised.ok) {
      // ตรวจไว้หมดแล้วข้างบน — เหลือเพียงกรณีเงินต้นคงเหลือเป็น 0 (no_balance)
      fail(409, revised.reason === 'no_balance' ? 'plan has no remaining balance' : 'tail has paid installments');
      return data;
    }

    const now = new Date().toISOString();
    const record: RateRevision = {
      id: generateRevisionId(),
      effectiveMonth,
      fromInstallmentNo: k,
      previousRate,
      newRate,
      revisedAt: now
    };
    savedPlan = {
      ...existing,
      annualRate: newRate,
      schedule: revised.schedule,
      monthlyPayment: revised.monthlyPayment,
      totalInterest: revised.totalInterest,
      totalPayable: revised.totalPayable,
      rateRevisions: [...revisions, record],
      updatedAt: now
    };
    const plans = [...data.plans];
    plans[index] = savedPlan;
    return { ...data, plans };
  });

  const failureResponse = failure as Failure | null;
  if (failureResponse) return res.status(failureResponse.status).json(failureResponse.body);
  if (!savedPlan) throw new Error('Rate revision completed without a saved plan');
  return res.status(200).json({ success: true, plan: summarisePlan(savedPlan) });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = assertUserId(req, res);
  if (!userId) return;
  if (!validateApiRequest(req, res, 'credit-cards/rate-revisions')) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    return await handlePost(req, res, userId);
  } catch (error) {
    console.error('Rate revision API error:', error);
    return res.status(500).json({ error: 'ไม่สามารถปรับอัตราดอกเบี้ยได้' });
  }
}

export default withAudit(handler, { source: 'credit_card_rate_revisions' });
