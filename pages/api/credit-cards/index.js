/**
 * API: /api/credit-cards
 * จัดการบัตรเครดิตของผู้ใช้ (per-user, ไม่ผูกกับเดือน)
 * - GET    : รายการบัตรพร้อมฟิลด์คำนวณ + ยอดรวมทุกบัตร
 * - POST   : สร้างบัตรใหม่ (ไม่มี card.id) หรือแก้ไขบัตรเดิม (มี card.id)
 * - DELETE : ลบบัตร (บล็อกเมื่อยังมีแผนผ่อนที่ยังไม่จบ)
 *
 * ทุก handler: assertApiToken → assertUserId → store เท่านั้น ไม่มีข้อยกเว้น (BR-CC-001)
 * การค้นหา cardId ทำภายในเอกสารของผู้ใช้คนนั้นเสมอ บัตรของผู้ใช้อื่นจึงได้ 404
 * ห้ามลอกแบบ fallback { userId: { $exists: false } } จาก monthly_expense.js มาใช้ที่นี่
 */

import crypto from 'crypto';
import { assertApiToken } from '../../../src/shared/utils/backend/apiTokenAuth';
import { assertUserId } from '../../../src/shared/utils/backend/userRequest';
import { getUserCreditData, updateUserCreditData } from '../../../src/shared/utils/backend/creditCardStore';
import {
  validateCardInput,
  summariseCard,
  summariseTotals,
  MAX_CARDS_PER_USER,
  PLAN_STATUS
} from '../../../src/shared/utils/creditCardUtils';

function generateCardId() {
  return `cc_${crypto.randomBytes(6).toString('hex')}`;
}

/** แผนที่ยังผ่อนไม่จบและยังมีงวดค้าง — ใช้บล็อกการลบบัตร (BR-CC-010) */
function countBlockingPlans(plans, cardId) {
  return plans.filter(plan => {
    if (plan?.cardId !== cardId) return false;
    if (plan.status !== PLAN_STATUS.ONGOING) return false;
    const schedule = Array.isArray(plan.schedule) ? plan.schedule : [];
    return schedule.some(row => row?.paid !== true);
  }).length;
}

async function handleGet(req, res, userId) {
  const data = await getUserCreditData(userId);
  // ยอดหมุนเวียนถูก derive จาก data.cycles ทุกครั้งที่ GET ไม่มีการเก็บตัวเลขการเงินไว้ (BR-CC-013)
  const cards = data.cards.map(card => summariseCard(card, data.plans, data.cycles));
  return res.status(200).json({ cards, totals: summariseTotals(cards) });
}

async function handlePost(req, res, userId) {
  const input = req.body?.card;
  if (!input || typeof input !== 'object') {
    return res.status(400).json({ error: 'card payload required' });
  }

  const { valid, errors, value } = validateCardInput(input);
  if (!valid) {
    return res.status(400).json({ error: 'ข้อมูลบัตรไม่ถูกต้อง', errors });
  }

  const cardId = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : null;
  const now = new Date().toISOString();
  let savedCard = null;
  let failure = null;

  const data = await updateUserCreditData(userId, (data) => {
    if (cardId) {
      const index = data.cards.findIndex(card => card?.id === cardId);
      if (index === -1) {
        failure = { status: 404, body: { error: 'card not found' } };
        return data;
      }
      savedCard = { ...data.cards[index], ...value, id: cardId, updatedAt: now };
      const cards = [...data.cards];
      cards[index] = savedCard;
      return { ...data, cards };
    }

    if (data.cards.length >= MAX_CARDS_PER_USER) {
      failure = {
        status: 409,
        body: { error: `เพิ่มบัตรได้สูงสุด ${MAX_CARDS_PER_USER} ใบ`, cardCount: data.cards.length }
      };
      return data;
    }

    savedCard = { id: generateCardId(), ...value, createdAt: now, updatedAt: now };
    return { ...data, cards: [...data.cards, savedCard] };
  });

  if (failure) return res.status(failure.status).json(failure.body);

  return res.status(200).json({ success: true, card: summariseCard(savedCard, data.plans, data.cycles) });
}

async function handleDelete(req, res, userId) {
  const cardId = typeof req.body?.cardId === 'string' ? req.body.cardId.trim() : '';
  if (!cardId) {
    return res.status(400).json({ error: 'cardId required' });
  }

  let failure = null;

  await updateUserCreditData(userId, (data) => {
    const card = data.cards.find(item => item?.id === cardId);
    if (!card) {
      failure = { status: 404, body: { error: 'card not found' } };
      return data;
    }

    // บล็อกการลบถ้ายังมียอดหมุนเวียนค้าง (BR-CC-013) — เดียวกับ countBlockingPlans ด้านล่าง แต่สำหรับยอดหมุนเวียน
    const summarised = summariseCard(card, data.plans, data.cycles);
    if (summarised.revolvingOutstanding > 0) {
      failure = {
        status: 409,
        body: { error: 'card has an outstanding revolving balance', revolvingOutstanding: summarised.revolvingOutstanding }
      };
      return data;
    }

    const ongoingPlanCount = countBlockingPlans(data.plans, cardId);
    if (ongoingPlanCount > 0) {
      failure = {
        status: 409,
        body: { error: 'card has active installment plans', ongoingPlanCount }
      };
      return data;
    }

    return {
      ...data,
      cards: data.cards.filter(card => card?.id !== cardId),
      plans: data.plans.filter(plan => plan?.cardId !== cardId),
      // ลบ cycle ของบัตรนี้ด้วย มิฉะนั้นยอดหมุนเวียนจะกลายเป็น orphan ค้างอยู่ในเอกสาร (AC-56)
      cycles: data.cycles.filter(cycle => cycle?.cardId !== cardId)
    };
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
    if (req.method === 'DELETE') return await handleDelete(req, res, userId);
  } catch (error) {
    console.error('Credit card API error:', error);
    return res.status(500).json({ error: 'ไม่สามารถจัดการข้อมูลบัตรเครดิตได้' });
  }

  res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
  return res.status(405).json({ error: 'Method not allowed' });
}
