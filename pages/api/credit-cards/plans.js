/**
 * API: /api/credit-cards/plans
 * จัดการแผนผ่อนชำระ (per-user, ไม่ผูกกับเดือน)
 * - GET    : รายการแผน กรองด้วย cardId / month / status ได้ (รวมกันได้)
 * - POST   : สร้างแผน + สร้างตารางผ่อนฝั่ง server
 * - PUT    : แก้ไขแผน (ตัวเลขแก้ได้เมื่อยังไม่มีงวดที่ชำระแล้วเท่านั้น)
 * - PATCH  : ติ๊กสถานะชำระของงวด
 * - DELETE : ยกเลิกแผน (cancel) หรือลบถาวร (delete)
 *
 * ทุก handler: assertApiToken → assertUserId → store (BR-CC-001)
 * cardId ของแผนต้องเป็นบัตรในเอกสารของผู้ใช้คนเดียวกัน มิฉะนั้น 404 — ห้าม fallback ไป lookup แบบ global
 * ห้ามเชื่อการคำนวณเงินจาก client: schedule / monthlyPayment / totalInterest / totalPayable
 * ที่ client ส่งมาถูกทิ้งทั้งหมด แล้วคำนวณใหม่ด้วย buildSchedule() เสมอ
 */

import crypto from 'crypto';
import { assertApiToken } from '../../../src/shared/utils/backend/apiTokenAuth';
import { assertUserId } from '../../../src/shared/utils/backend/userRequest';
import { getUserCreditData, updateUserCreditData } from '../../../src/shared/utils/backend/creditCardStore';
import {
  validatePlanInput,
  buildSchedule,
  summarisePlan,
  resolvePlanStatus,
  buildInstallmentRowKey,
  MAX_ACTIVE_PLANS_PER_USER,
  PLAN_STATUS
} from '../../../src/shared/utils/creditCardUtils';

const FINANCIAL_PATCH_FIELDS = [
  'totalPrice',
  'months',
  'startMonth',
  'interestMode',
  'manualFeePerMonth',
  'annualRate',
  'calcMethod'
];

function generatePlanId() {
  return `ip_${crypto.randomBytes(6).toString('hex')}`;
}

function countPaidInstallments(plan) {
  const schedule = Array.isArray(plan?.schedule) ? plan.schedule : [];
  return schedule.filter(row => row?.paid === true).length;
}

function countActivePlans(plans) {
  return plans.filter(plan => plan?.status !== PLAN_STATUS.COMPLETED).length;
}

/** สร้างเอกสารแผนจากค่าที่ผ่าน validation แล้ว — ตารางผ่อนคำนวณที่ server เท่านั้น */
function composePlan(base, value) {
  const computed = buildSchedule(value);
  const now = new Date().toISOString();
  return {
    id: base?.id || generatePlanId(),
    cardId: value.cardId,
    itemName: value.itemName,
    totalPrice: value.totalPrice,
    months: value.months,
    startMonth: value.startMonth,
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
function buildMonthInstallmentItems(data, month) {
  const cardById = new Map(data.cards.map(card => [card?.id, card]));
  const items = [];
  data.plans.forEach(plan => {
    const card = cardById.get(plan?.cardId);
    if (!card) return;
    (Array.isArray(plan.schedule) ? plan.schedule : []).forEach(row => {
      if (row?.dueMonth !== month) return;
      // แผนที่ยกเลิกแล้วเหลือเฉพาะงวดที่ชำระไปแล้ว (BR-CC-010)
      if (plan.status === PLAN_STATUS.CANCELLED && row.paid !== true) return;
      items.push({
        key: buildInstallmentRowKey(plan.id, row.no),
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

async function handleGet(req, res, userId) {
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
      .filter(Boolean);

    // shape เดียวกับ creditCardAPI.getMonthInstallments() ที่ ExpenseTable ใช้
    return res.status(200).json({
      plans: summarised,
      items: buildMonthInstallmentItems(data, month)
    });
  }

  return res.status(200).json({ plans: summarised });
}

async function handlePost(req, res, userId) {
  const input = req.body?.plan;
  if (!input || typeof input !== 'object') {
    return res.status(400).json({ error: 'plan payload required' });
  }

  const { valid, errors, value } = validatePlanInput(input);
  if (!valid) {
    return res.status(400).json({ error: 'ข้อมูลแผนผ่อนไม่ถูกต้อง', errors });
  }

  let savedPlan = null;
  let failure = null;

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

  if (failure) return res.status(failure.status).json(failure.body);
  return res.status(200).json({ success: true, plan: summarisePlan(savedPlan) });
}

async function handlePut(req, res, userId) {
  const planId = typeof req.body?.planId === 'string' ? req.body.planId.trim() : '';
  const patch = req.body?.patch;
  if (!planId || !patch || typeof patch !== 'object') {
    return res.status(400).json({ error: 'planId and patch required' });
  }

  const touchesFinancials = FINANCIAL_PATCH_FIELDS.some(field => patch[field] !== undefined);
  let savedPlan = null;
  let failure = null;

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
    const { valid, errors, value } = validatePlanInput(merged);
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

  if (failure) return res.status(failure.status).json(failure.body);
  return res.status(200).json({ success: true, plan: summarisePlan(savedPlan) });
}

async function handlePatch(req, res, userId) {
  const planId = typeof req.body?.planId === 'string' ? req.body.planId.trim() : '';
  const installmentNo = Number(req.body?.installmentNo);
  const paid = req.body?.paid === true || req.body?.paid === 'true';
  if (!planId || !Number.isFinite(installmentNo)) {
    return res.status(400).json({ error: 'planId and installmentNo required' });
  }

  let savedPlan = null;
  let failure = null;

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

  if (failure) return res.status(failure.status).json(failure.body);
  return res.status(200).json({ success: true, plan: summarisePlan(savedPlan) });
}

async function handleDelete(req, res, userId) {
  const planId = typeof req.body?.planId === 'string' ? req.body.planId.trim() : '';
  const mode = req.body?.mode === 'delete' ? 'delete' : 'cancel';
  if (!planId) {
    return res.status(400).json({ error: 'planId required' });
  }

  let failure = null;

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

  if (failure) return res.status(failure.status).json(failure.body);
  return res.status(200).json({ success: true });
}

export default async function handler(req, res) {
  if (!assertApiToken(req, res)) return;

  const userId = assertUserId(req, res);
  if (!userId) return;

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
