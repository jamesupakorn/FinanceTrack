/**
 * API: /api/credit-cards/plans
 * จัดการแผนผ่อนชำระ (per-user, ไม่ผูกกับเดือน)
 * - GET    : รายการแผน กรองด้วย cardId / month / status ได้ (รวมกันได้)
 * - POST   : สร้างแผน + สร้างตารางผ่อนฝั่ง server
 * - PUT    : แก้ไขแผน (ตัวเลขแก้ได้เมื่อยังไม่มีงวดที่ชำระแล้วเท่านั้น)
 * - PATCH  : ติ๊กสถานะชำระของงวด
 * - DELETE : ยกเลิกแผน (cancel) หรือลบถาวร (delete)
 *
 * ทุก handler: assertUserId → store (BR-CC-001)
 * cardId ของแผนต้องเป็นบัตรในเอกสารของผู้ใช้คนเดียวกัน มิฉะนั้น 404 — ห้าม fallback ไป lookup แบบ global
 * ห้ามเชื่อการคำนวณเงินจาก client: schedule / monthlyPayment / totalInterest / totalPayable
 * ที่ client ส่งมาถูกทิ้งทั้งหมด แล้วคำนวณใหม่ด้วย buildSchedule() เสมอ
 */

import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { assertUserId } from '../../../src/shared/utils/backend/userRequest';
import { validateApiRequest } from '../../../src/shared/utils/backend/apiRequestValidation';
import { getUserCreditData, updateUserCreditData, type CreditData, type CreditPlan } from '../../../src/shared/utils/backend/creditCardStore';
import {
  validatePlanInput,
  buildSchedule,
  summarisePlan,
  resolvePlanStatus,
  buildInstallmentRowKey,
  MAX_ACTIVE_PLANS_PER_USER,
  PLAN_STATUS
} from '../../../src/shared/utils/creditCardUtils';
import { withAudit } from '../../../lib/auditedMutation';

const FINANCIAL_PATCH_FIELDS = [
  'totalPrice',
  'months',
  'startMonth',
  'purchaseDate',
  'interestMode',
  'manualFeePerMonth',
  'annualRate',
  'calcMethod'
];

function generatePlanId() {
  return `ip_${crypto.randomBytes(6).toString('hex')}`;
}

function countPaidInstallments(plan: CreditPlan) {
  const schedule = Array.isArray(plan?.schedule) ? plan.schedule : [];
  return schedule.filter(row => row?.paid === true).length;
}

function countActivePlans(plans: CreditData['plans']) {
  return plans.filter(plan => plan?.status !== PLAN_STATUS.COMPLETED).length;
}

/** สร้างเอกสารแผนจากค่าที่ผ่าน validation แล้ว — ตารางผ่อนคำนวณที่ server เท่านั้น */
function composePlan(base: CreditPlan | null, value: ReturnType<typeof validatePlanInput>['value']): CreditPlan {
  const computed = buildSchedule({ ...value, calcMethod: value.calcMethod ?? undefined });
  const now = new Date().toISOString();
  return {
    id: base?.id || generatePlanId(),
    cardId: value.cardId,
    itemName: value.itemName,
    totalPrice: value.totalPrice,
    months: value.months,
    startMonth: value.startMonth,
    // purchaseDate ไม่บังคับย้อนหลังกับแผนเก่า — ใส่ key นี้เฉพาะตอนมีค่าจริง (ห้ามเขียน '' ทับ, F-5/AC-PD-23)
    ...(value.purchaseDate ? { purchaseDate: value.purchaseDate } : {}),
    interestMode: value.interestMode,
    manualFeePerMonth: value.manualFeePerMonth,
    annualRate: value.annualRate,
    calcMethod: value.calcMethod,
    monthlyPayment: computed.monthlyPayment,
    totalInterest: computed.totalInterest,
    totalPayable: computed.totalPayable,
    schedule: computed.schedule,
    status: PLAN_STATUS.ONGOING,
    cancelledAt: null,
    createdAt: base?.createdAt || now,
    updatedAt: now
  };
}

/** metadata ที่ ExpenseTable ใช้ตกแต่งแถว cci_ ของเดือนนั้น */
function buildMonthInstallmentItems(data: CreditData, month: string) {
  const cardById = new Map(data.cards.map(card => [card?.id, card]));
  const items: Array<Record<string, unknown>> = [];
  data.plans.forEach(plan => {
    const card = cardById.get(plan?.cardId);
    if (!card) return;
    (Array.isArray(plan.schedule) ? plan.schedule : []).forEach(row => {
      if (row?.dueMonth !== month) return;
      // แผนที่ยกเลิกแล้วเหลือเฉพาะงวดที่ชำระไปแล้ว (BR-CC-010)
      if (plan.status === PLAN_STATUS.CANCELLED && row.paid !== true) return;
      items.push({
        key: buildInstallmentRowKey(plan.id ?? '', row.no as number),
        planId: plan.id,
        cardId: card.id,
        cardName: card.name,
        cardColor: card.color,
        itemName: plan.itemName,
        no: row.no,
        months: plan.months,
        payment: row.payment,
        paid: row.paid === true
      });
    });
  });
  return items;
}

async function handleGet(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const data = await getUserCreditData(userId);
  const cardId = typeof req.query.cardId === 'string' ? req.query.cardId.trim() : '';
  const month = typeof req.query.month === 'string' ? req.query.month.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';

  let plans = data.plans;
  if (cardId) plans = plans.filter(plan => plan?.cardId === cardId);
  if (status) plans = plans.filter(plan => plan?.status === status);

  let summarised = plans.map(summarisePlan);

  if (month) {
    summarised = summarised
      .map(plan => {
        const row = (Array.isArray(plan.schedule) ? plan.schedule : [])
          .find(entry => entry?.dueMonth === month);
        if (!row) return null;
        return {
          ...plan,
          dueInstallment: {
            no: row.no,
            dueMonth: row.dueMonth,
            payment: row.payment,
            paid: row.paid === true
          }
        };
      })
      .filter((plan): plan is NonNullable<typeof plan> => plan !== null);

    // shape เดียวกับ creditCardAPI.getMonthInstallments() ที่ ExpenseTable ใช้
    return res.status(200).json({
      plans: summarised,
      items: buildMonthInstallmentItems(data, month)
    });
  }

  return res.status(200).json({ plans: summarised });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const input = req.body?.plan;
  if (!input || typeof input !== 'object') {
    return res.status(400).json({ error: 'plan payload required' });
  }

  // แผนใหม่ต้องมีวันที่ซื้อเสมอ (BR-CC-024) — แผนเก่าที่ไม่มีค่านี้แก้ไขได้โดยไม่บังคับ (ดู handlePut)
  const { valid, errors, value } = validatePlanInput(input, { requirePurchaseDate: true });
  if (!valid) {
    return res.status(400).json({ error: 'ข้อมูลแผนผ่อนไม่ถูกต้อง', errors });
  }

  let savedPlan: CreditPlan | null = null;
  let failure: { status: number; body: Record<string, unknown> } | null = null;

  await updateUserCreditData(userId, (data) => {
    const card = data.cards.find(item => item?.id === value.cardId);
    if (!card) {
      failure = { status: 404, body: { error: 'card not found' } };
      return data;
    }
    if (countActivePlans(data.plans) >= MAX_ACTIVE_PLANS_PER_USER) {
      failure = {
        status: 409,
        body: { error: `เพิ่มแผนผ่อนที่ยังไม่จบได้สูงสุด ${MAX_ACTIVE_PLANS_PER_USER} แผน` }
      };
      return data;
    }

    savedPlan = composePlan(null, value);
    return { ...data, plans: [...data.plans, savedPlan] };
  });

  const failureResponse = failure as { status: number; body: Record<string, unknown> } | null;
  if (failureResponse) return res.status(failureResponse.status).json(failureResponse.body);
  if (!savedPlan) throw new Error('Plan update completed without a saved plan');
  return res.status(200).json({ success: true, plan: summarisePlan(savedPlan) });
}

async function handlePut(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const planId = typeof req.body?.planId === 'string' ? req.body.planId.trim() : '';
  const patch = req.body?.patch;
  if (!planId || !patch || typeof patch !== 'object') {
    return res.status(400).json({ error: 'planId and patch required' });
  }

  const touchesFinancials = FINANCIAL_PATCH_FIELDS.some(field => patch[field] !== undefined);
  let savedPlan: CreditPlan | null = null;
  let failure: { status: number; body: Record<string, unknown> } | null = null;

  await updateUserCreditData(userId, (data) => {
    const index = data.plans.findIndex(plan => plan?.id === planId);
    if (index === -1) {
      failure = { status: 404, body: { error: 'plan not found' } };
      return data;
    }
    const existing = data.plans[index];
    const now = new Date().toISOString();

    if (!touchesFinancials) {
      const itemName = String(patch.itemName ?? '').trim();
      if (!itemName || itemName.length > 60) {
        failure = { status: 400, body: { error: 'กรุณาระบุชื่อสินค้า', errors: { itemName: 'กรุณาระบุชื่อสินค้า' } } };
        return data;
      }
      savedPlan = { ...existing, itemName, updatedAt: now };
      const plans = [...data.plans];
      plans[index] = savedPlan;
      return { ...data, plans };
    }

    // แผนที่มีงวดชำระแล้วถือว่าแก้ตัวเลขไม่ได้ (BR-CC-006)
    const installmentsPaid = countPaidInstallments(existing);
    if (installmentsPaid > 0) {
      failure = { status: 409, body: { error: 'plan has paid installments', installmentsPaid } };
      return data;
    }

    const merged = { ...existing, ...patch };
    // บังคับ purchaseDate เฉพาะแผนที่มีค่านี้อยู่แล้ว — แผนเก่า (legacy, ไม่มี purchaseDate) แก้ไขได้โดยไม่ต้องกรอกย้อนหลัง (D-1, AC-PD-13/23)
    const { valid, errors, value } = validatePlanInput(merged, {
      requirePurchaseDate: Boolean(existing?.purchaseDate)
    });
    if (!valid) {
      failure = { status: 400, body: { error: 'ข้อมูลแผนผ่อนไม่ถูกต้อง', errors } };
      return data;
    }
    const card = data.cards.find(item => item?.id === value.cardId);
    if (!card) {
      failure = { status: 404, body: { error: 'card not found' } };
      return data;
    }

    savedPlan = composePlan(existing, value);
    const plans = [...data.plans];
    plans[index] = savedPlan;
    return { ...data, plans };
  });

  const failureResponse = failure as { status: number; body: Record<string, unknown> } | null;
  if (failureResponse) return res.status(failureResponse.status).json(failureResponse.body);
  if (!savedPlan) throw new Error('Plan update completed without a saved plan');
  return res.status(200).json({ success: true, plan: summarisePlan(savedPlan) });
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const planId = typeof req.body?.planId === 'string' ? req.body.planId.trim() : '';
  const installmentNo = Number(req.body?.installmentNo);
  const paid = req.body?.paid === true || req.body?.paid === 'true';
  if (!planId || !Number.isFinite(installmentNo)) {
    return res.status(400).json({ error: 'planId and installmentNo required' });
  }

  let savedPlan: CreditPlan | null = null;
  let failure: { status: number; body: Record<string, unknown> } | null = null;

  await updateUserCreditData(userId, (data) => {
    const index = data.plans.findIndex(plan => plan?.id === planId);
    if (index === -1) {
      failure = { status: 404, body: { error: 'plan not found' } };
      return data;
    }
    const existing = data.plans[index];
    if (existing.status === PLAN_STATUS.CANCELLED) {
      failure = { status: 409, body: { error: 'plan is cancelled' } };
      return data;
    }

    const schedule = Array.isArray(existing.schedule) ? [...existing.schedule] : [];
    const rowIndex = schedule.findIndex(row => row?.no === installmentNo);
    if (rowIndex === -1) {
      failure = { status: 404, body: { error: 'installment not found' } };
      return data;
    }

    schedule[rowIndex] = {
      ...schedule[rowIndex],
      paid,
      paidAt: paid ? new Date().toISOString() : null,
      paidSource: paid ? 'credit_card' : null
    };
    const nextPlan = { ...existing, schedule, updatedAt: new Date().toISOString() };
    savedPlan = { ...nextPlan, status: resolvePlanStatus(nextPlan) };

    const plans = [...data.plans];
    plans[index] = savedPlan;
    return { ...data, plans };
  });

  const failureResponse = failure as { status: number; body: Record<string, unknown> } | null;
  if (failureResponse) return res.status(failureResponse.status).json(failureResponse.body);
  if (!savedPlan) throw new Error('Plan update completed without a saved plan');
  return res.status(200).json({ success: true, plan: summarisePlan(savedPlan) });
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const planId = typeof req.body?.planId === 'string' ? req.body.planId.trim() : '';
  const mode = req.body?.mode === 'delete' ? 'delete' : 'cancel';
  if (!planId) {
    return res.status(400).json({ error: 'planId required' });
  }

  let failure: { status: number; body: Record<string, unknown> } | null = null;

  await updateUserCreditData(userId, (data) => {
    const index = data.plans.findIndex(plan => plan?.id === planId);
    if (index === -1) {
      failure = { status: 404, body: { error: 'plan not found' } };
      return data;
    }
    const existing = data.plans[index];

    if (mode === 'delete') {
      // ลบถาวรได้เฉพาะแผนที่ยังไม่เคยชำระงวดใดเลย (BR-CC-010)
      if (countPaidInstallments(existing) > 0) {
        failure = {
          status: 409,
          body: { error: 'plan has paid installments — cancel it instead', installmentsPaid: countPaidInstallments(existing) }
        };
        return data;
      }
      return { ...data, plans: data.plans.filter(plan => plan?.id !== planId) };
    }

    const plans = [...data.plans];
    plans[index] = {
      ...existing,
      status: PLAN_STATUS.CANCELLED,
      cancelledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return { ...data, plans };
  });

  const failureResponse = failure as { status: number; body: Record<string, unknown> } | null;
  if (failureResponse) return res.status(failureResponse.status).json(failureResponse.body);
  return res.status(200).json({ success: true });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = assertUserId(req, res);
  if (!userId) return;
  if (!validateApiRequest(req, res, 'credit-cards/plans')) return;

  try {
    if (req.method === 'GET') return await handleGet(req, res, userId);
    if (req.method === 'POST') return await handlePost(req, res, userId);
    if (req.method === 'PUT') return await handlePut(req, res, userId);
    if (req.method === 'PATCH') return await handlePatch(req, res, userId);
    if (req.method === 'DELETE') return await handleDelete(req, res, userId);
  } catch (error) {
    console.error('Installment plan API error:', error);
    return res.status(500).json({ error: 'ไม่สามารถจัดการแผนผ่อนชำระได้' });
  }

  res.setHeader('Allow', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAudit(handler, { source: 'credit_card_plans' });
