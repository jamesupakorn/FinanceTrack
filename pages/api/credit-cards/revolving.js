/**
 * API: /api/credit-cards/revolving
 * จัดการยอดใช้จ่ายหมุนเวียนของบัตร (per-card per-month, เก็บแบบ sparse)
 * - GET    : cycle ที่ derive แล้ว กรองด้วย cardId / month ได้
 * - POST   : upsert ยอดใช้จ่ายใหม่ของเดือน (newSpend)
 * - PATCH  : บันทึกการตัดสินใจชำระ ('full' | 'minimum' | null)
 * - DELETE : ลบ cycle ที่เก็บไว้ของเดือนนั้น (เดือนถัด ๆ ไป derive ใหม่เอง)
 *
 * ทุก handler: assertApiToken → assertUserId → store เท่านั้น ไม่มีข้อยกเว้น (BR-CC-001)
 * การค้นหา cardId ทำภายในเอกสารของผู้ใช้คนนั้นเสมอ บัตรของผู้ใช้อื่นจึงได้ 404
 * ห้ามลอกแบบ fallback { userId: { $exists: false } } จาก monthly_expense.js มาใช้ที่นี่
 *
 * ⚠ server เป็นเจ้าของการคำนวณเงินทั้งหมด (BR-CC-013 / ADR-011)
 *   client ส่ง carriedBalance / totalDue / minPaymentDue / interest / closingBalance /
 *   amountDue / paidAmount มาก็ไม่มีผล — โค้ดนี้ไม่เคยอ่านฟิลด์เหล่านั้นเลย
 *   ที่เก็บจริงมีแค่ { id, cardId, month, newSpend, paymentAction, paidAt, paidSource, createdAt, updatedAt }
 */

import crypto from 'crypto';
import { assertApiToken } from '../../../src/shared/utils/backend/apiTokenAuth';
import { assertUserId } from '../../../src/shared/utils/backend/userRequest';
import { getUserCreditData, updateUserCreditData } from '../../../src/shared/utils/backend/creditCardStore';
import {
  buildRevolvingCycles,
  buildRevolvingRowKey,
  summariseRevolving,
  validateRevolvingCycleInput,
  isValidPaymentAction,
  isRevolvingChainTruncated,
  getCurrentMonthKey,
  round2,
  MAX_REVOLVING_CYCLES_PER_CARD
} from '../../../src/shared/utils/creditCardUtils';

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

function generateCycleId() {
  return `rc_${crypto.randomBytes(6).toString('hex')}`;
}

/** จำนวน cycle ที่เก็บจริงของบัตรใบหนึ่ง — ใช้บังคับเพดาน (BR-CC-018) */
function countStoredCycles(cycles, cardId) {
  return cycles.filter(cycle => cycle?.cardId === cardId).length;
}

/** normalise ค่าเดือนเป้าหมาย — ใช้ก่อน buildCardChains() เสมอ (เดิมทำอยู่ใน materialise()) */
function resolveTargetMonth(throughMonth) {
  return MONTH_KEY_RE.test(throughMonth || '') ? throughMonth : getCurrentMonthKey();
}

/**
 * สร้างสายยอดหมุนเวียนของ "ทุกบัตร" ในเอกสาร ณ เดือนเป้าหมายเดียว (ไม่กรอง cardId)
 * เรียก buildRevolvingCycles() ครั้งเดียวต่อบัตร แล้วให้ materialise()/summariseAll() ใช้ร่วมกัน
 * แทนที่จะต่างคนต่างเรียกซ้ำด้วย asOfMonth เดียวกัน
 * @returns {Map<string, array>} cardId → chain
 */
function buildCardChains(data, asOfMonth) {
  const map = new Map();
  data.cards.forEach(card => {
    map.set(card.id, buildRevolvingCycles(card, data.cycles, { throughMonth: asOfMonth }));
  });
  return map;
}

/**
 * materialise สายยอดหมุนเวียนของทุกบัตร (หรือบัตรเดียวเมื่อระบุ cardId)
 * ตกแต่งด้วยชื่อ/สี/คีย์แถวของบัตร เพื่อให้ ExpenseTable ใช้ตกแต่งแถว ccr_ ได้ในคำขอเดียว
 * การตกแต่งทำที่ชั้น API เท่านั้น buildRevolvingCycles() ยังคงเป็น pure function ตามเดิม
 * @param {Map<string, array>} cardChains - จาก buildCardChains(data, asOfMonth)
 * @returns {{cycles: array, truncated: boolean}}
 */
function materialise(data, cardChains, { cardId = '', month = '' } = {}) {
  const cards = cardId ? data.cards.filter(card => card?.id === cardId) : data.cards;

  let truncated = false;
  const cycles = [];
  cards.forEach(card => {
    const chain = cardChains.get(card.id) || [];
    if (isRevolvingChainTruncated(chain)) truncated = true;
    chain.forEach(cycle => {
      if (month && cycle.month !== month) return;
      cycles.push({
        ...cycle,
        key: buildRevolvingRowKey(card.id),
        cardName: card.name,
        cardColor: card.color,
        cardDueDay: card.dueDay
      });
    });
  });

  return { cycles, truncated };
}

/**
 * ยอดรวมของทุกบัตร ณ เดือนหนึ่ง — คำนวณจากสายที่ materialise แล้วเท่านั้น
 * @param {Map<string, array>} cardChains - จาก buildCardChains(data, asOfMonth), ครอบทุกบัตรเสมอ
 *   (ไม่กรอง cardId — summariseAll ต้องรวมทุกบัตรเสมอ แม้ materialise() จะถูกกรองด้วย cardId ก็ตาม)
 */
function summariseAll(data, asOfMonth, cardChains) {
  const totals = data.cards.reduce((acc, card) => {
    const chain = cardChains.get(card.id) || [];
    const summary = summariseRevolving(chain, { asOfMonth });
    acc.outstanding += summary.outstanding;
    acc.due += summary.due;
    acc.minDue += summary.minDue;
    acc.carryForward += summary.carryForward;
    return acc;
  }, { outstanding: 0, due: 0, minDue: 0, carryForward: 0 });

  return {
    outstanding: round2(totals.outstanding),
    due: round2(totals.due),
    minDue: round2(totals.minDue),
    carryForward: round2(totals.carryForward)
  };
}

/**
 * บัตรใบนี้อยู่ในเอกสารของผู้ใช้คนนี้จริงหรือไม่ — ตรวจก่อนเข้า updateUserCreditData
 *
 * updateUserCreditData() bump `updatedAt` ทุกครั้งที่ถูกเรียก แม้ updater จะคืนค่าเดิม
 * การเช็คสิทธิ์ก่อนจึงทำให้ cardId ของผู้ใช้อื่นได้ 404 โดยไม่แตะเอกสารของใครเลย (AC-36)
 * ตัว updater ยังเช็คซ้ำภายใน transaction อยู่ดี ความถูกต้องจึงไม่ได้พึ่งการเช็คนี้เพียงลำพัง
 */
async function ownsCard(userId, cardId) {
  const data = await getUserCreditData(userId);
  return data.cards.some(card => card?.id === cardId);
}

/** สายของบัตรใบเดียวหลังการเขียน — ใช้เป็น response ของ POST/PATCH/DELETE */
async function respondWithCardChain(res, data, cardId, asOfMonth) {
  const targetMonth = resolveTargetMonth(asOfMonth);
  const cardChains = buildCardChains(data, targetMonth);
  const { cycles, truncated } = materialise(data, cardChains, { cardId });
  return res.status(200).json({
    success: true,
    cycles,
    truncated,
    summary: summariseAll(data, targetMonth, cardChains)
  });
}

async function handleGet(req, res, userId) {
  const data = await getUserCreditData(userId);
  const cardId = typeof req.query.cardId === 'string' ? req.query.cardId.trim() : '';
  const month = typeof req.query.month === 'string' ? req.query.month.trim() : '';

  // cardId ที่ไม่ใช่ของผู้ใช้คนนี้ → 404 ไม่ตกไป lookup แบบ global เด็ดขาด (BR-CC-001)
  if (cardId && !data.cards.some(card => card?.id === cardId)) {
    return res.status(404).json({ error: 'card not found' });
  }

  const asOfMonth = MONTH_KEY_RE.test(month) ? month : getCurrentMonthKey();
  const cardChains = buildCardChains(data, asOfMonth);
  const { cycles, truncated } = materialise(data, cardChains, { cardId, month });

  return res.status(200).json({
    cycles,
    truncated,
    summary: summariseAll(data, asOfMonth, cardChains)
  });
}

async function handlePost(req, res, userId) {
  const input = req.body?.cycle;
  if (!input || typeof input !== 'object') {
    return res.status(400).json({ error: 'cycle payload required' });
  }

  // อ่านเฉพาะ cardId / month / newSpend — ฟิลด์การเงินอื่นใน body ถูกละทิ้งทั้งหมด (AC-38)
  const { valid, errors, value } = validateRevolvingCycleInput(input);
  if (!valid) {
    return res.status(400).json({ error: 'ข้อมูลยอดใช้จ่ายหมุนเวียนไม่ถูกต้อง', errors });
  }
  if (!(await ownsCard(userId, value.cardId))) {
    return res.status(404).json({ error: 'card not found' });
  }

  let failure = null;

  const data = await updateUserCreditData(userId, (data) => {
    const card = data.cards.find(item => item?.id === value.cardId);
    if (!card) {
      failure = { status: 404, body: { error: 'card not found' } };
      return data;
    }

    const index = data.cycles.findIndex(
      cycle => cycle?.cardId === value.cardId && cycle?.month === value.month
    );
    const now = new Date().toISOString();

    if (index === -1) {
      if (countStoredCycles(data.cycles, value.cardId) >= MAX_REVOLVING_CYCLES_PER_CARD) {
        failure = {
          status: 409,
          body: { error: `บันทึกยอดหมุนเวียนได้สูงสุด ${MAX_REVOLVING_CYCLES_PER_CARD} เดือนต่อบัตร` }
        };
        return data;
      }
      return {
        ...data,
        cycles: [...data.cycles, {
          id: generateCycleId(),
          cardId: value.cardId,
          month: value.month,
          newSpend: value.newSpend,
          paymentAction: null,
          paidAt: null,
          paidSource: null,
          createdAt: now,
          updatedAt: now
        }]
      };
    }

    const cycles = [...data.cycles];
    cycles[index] = { ...cycles[index], newSpend: value.newSpend, updatedAt: now };
    return { ...data, cycles };
  });

  if (failure) return res.status(failure.status).json(failure.body);
  return respondWithCardChain(res, data, value.cardId, value.month);
}

async function handlePatch(req, res, userId) {
  const cardId = typeof req.body?.cardId === 'string' ? req.body.cardId.trim() : '';
  const month = typeof req.body?.month === 'string' ? req.body.month.trim() : '';
  const paymentAction = req.body?.paymentAction ?? null;

  if (!cardId || !MONTH_KEY_RE.test(month)) {
    return res.status(400).json({ error: 'cardId and month required' });
  }
  if (!isValidPaymentAction(paymentAction)) {
    return res.status(400).json({ error: 'paymentAction ต้องเป็น full, minimum หรือ null' });
  }
  if (!(await ownsCard(userId, cardId))) {
    return res.status(404).json({ error: 'card not found' });
  }

  let failure = null;

  const data = await updateUserCreditData(userId, (data) => {
    const card = data.cards.find(item => item?.id === cardId);
    if (!card) {
      failure = { status: 404, body: { error: 'card not found' } };
      return data;
    }

    const now = new Date().toISOString();
    const index = data.cycles.findIndex(cycle => cycle?.cardId === cardId && cycle?.month === month);

    // เดือนที่มีแต่ยอดยกมา (ยังไม่เคยบันทึก) ต้องกดชำระได้ → สร้าง cycle ด้วย newSpend: 0
    if (index === -1) {
      if (countStoredCycles(data.cycles, cardId) >= MAX_REVOLVING_CYCLES_PER_CARD) {
        failure = {
          status: 409,
          body: { error: `บันทึกยอดหมุนเวียนได้สูงสุด ${MAX_REVOLVING_CYCLES_PER_CARD} เดือนต่อบัตร` }
        };
        return data;
      }
      return {
        ...data,
        cycles: [...data.cycles, {
          id: generateCycleId(),
          cardId,
          month,
          newSpend: 0,
          paymentAction,
          paidAt: paymentAction ? now : null,
          paidSource: paymentAction ? 'credit_card' : null,
          createdAt: now,
          updatedAt: now
        }]
      };
    }

    const cycles = [...data.cycles];
    cycles[index] = {
      ...cycles[index],
      paymentAction,
      paidAt: paymentAction ? now : null,
      paidSource: paymentAction ? 'credit_card' : null,
      updatedAt: now
    };
    return { ...data, cycles };
  });

  if (failure) return res.status(failure.status).json(failure.body);
  return respondWithCardChain(res, data, cardId, month);
}

async function handleDelete(req, res, userId) {
  const cardId = typeof req.body?.cardId === 'string' ? req.body.cardId.trim() : '';
  const month = typeof req.body?.month === 'string' ? req.body.month.trim() : '';

  if (!cardId || !MONTH_KEY_RE.test(month)) {
    return res.status(400).json({ error: 'cardId and month required' });
  }
  if (!(await ownsCard(userId, cardId))) {
    return res.status(404).json({ error: 'card not found' });
  }

  let failure = null;

  const data = await updateUserCreditData(userId, (data) => {
    const card = data.cards.find(item => item?.id === cardId);
    if (!card) {
      failure = { status: 404, body: { error: 'card not found' } };
      return data;
    }
    return {
      ...data,
      cycles: data.cycles.filter(cycle => !(cycle?.cardId === cardId && cycle?.month === month))
    };
  });

  if (failure) return res.status(failure.status).json(failure.body);
  return respondWithCardChain(res, data, cardId, month);
}

export default async function handler(req, res) {
  if (!assertApiToken(req, res)) return;

  const userId = assertUserId(req, res);
  if (!userId) return;

  try {
    if (req.method === 'GET') return await handleGet(req, res, userId);
    if (req.method === 'POST') return await handlePost(req, res, userId);
    if (req.method === 'PATCH') return await handlePatch(req, res, userId);
    if (req.method === 'DELETE') return await handleDelete(req, res, userId);
  } catch (error) {
    console.error('Revolving balance API error:', error);
    return res.status(500).json({ error: 'ไม่สามารถจัดการยอดใช้จ่ายหมุนเวียนได้' });
  }

  res.setHeader('Allow', ['GET', 'POST', 'PATCH', 'DELETE']);
  return res.status(405).json({ error: 'Method not allowed' });
}
