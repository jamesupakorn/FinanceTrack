/**
 * API: /api/credit-cards/spend-items
 * รายการใช้จ่ายไม่ผ่อนของบัตร ต่อบัตรต่อเดือนรอบบิล (spec-credit-card-spend §4.1 · DATA_MODEL-credit-card-spend)
 * - GET    ?month=YYYY-MM[&cardId=] → { items, totals: { [cardId]: round2(sum) } }
 * - POST   { item: { cardId, purchaseDate, name, amount } } → 201 { item, cycle }
 * - PUT    { item: { id, name?, amount?, purchaseDate? } } → 200 { item, cycle }
 * - DELETE { id }                                     → 200 { deletedId, cycle }
 *
 * ทุก handler: assertUserId → store เท่านั้น (BR-CC-001) — mutation ทั้งหมดผ่าน withAudit
 * client ส่งได้แค่ { cardId, purchaseDate, name, amount } (+ id) — month ที่ client ส่งมาจะถูกละเว้น
 * ฟิลด์อื่นใน body (newSpend, source, totalDue, …) ไม่เคยถูกอ่าน (SPEND-3 / AC-S4) · source เป็น 'user' เสมอ
 * newSpend ของ (card, month) derive จากผลรวมรายการตอนอ่านเท่านั้น ไม่เคยถูกเขียนลง cycle (SPEND-2)
 * `cycle` ใน response = cycle ที่ derive แล้วของบัตร/เดือนนั้นหลังการเขียน (null ถ้าไม่มีแถว)
 */

import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { assertUserId } from '../../../src/shared/utils/backend/userRequest';
import { validateApiRequest } from '../../../src/shared/utils/backend/apiRequestValidation';
import { getUserCreditData, updateUserCreditData, type CreditData } from '../../../src/shared/utils/backend/creditCardStore';
import {
  buildRevolvingCyclesForData,
  validateSpendItemInput,
  type StoredSpendItem
} from '../../../src/shared/utils/creditCardRevolving';
import {
  MAX_SPEND_ITEMS_PER_CYCLE,
  MAX_SPEND_ITEMS_PER_CARD,
  SPEND_MONTH_KEY_RE,
  computeStartMonthFromPurchase,
  round2,
  toAmount
} from '../../../src/shared/utils/creditCardBasics';
import { withAudit } from '../../../lib/auditedMutation';

type Failure = { status: number; body: Record<string, unknown> };

function generateSpendItemId(): string {
  return `si_${crypto.randomBytes(6).toString('hex')}`;
}

/** cycle ที่ derive แล้วของบัตร/เดือนหนึ่ง — ใช้ buildRevolvingCyclesForData (ส่ง spendItems เสมอ) */
function derivedCycleFor(data: CreditData, cardId: string, month: string) {
  const card = data.cards.find(item => item?.id === cardId);
  if (!card) return null;
  const chain = buildRevolvingCyclesForData(card, data, { throughMonth: month });
  return chain.find(cycle => cycle.month === month) || null;
}

/** รูปแบบรายการที่ส่งออก — เฉพาะฟิลด์ที่ whitelist ไว้ */
function toPublicItem(item: StoredSpendItem) {
  return {
    id: item.id,
    cardId: item.cardId,
    month: item.month,
    ...(item.purchaseDate ? { purchaseDate: item.purchaseDate } : {}),
    name: item.name,
    amount: round2(Math.max(0, toAmount(item.amount ?? '') || 0)),
    source: item.source === 'migration' ? 'migration' : 'user',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

function billingMonthFor(data: CreditData, cardId: string, purchaseDate: string): string {
  const card = data.cards.find(item => item?.id === cardId);
  return card ? computeStartMonthFromPurchase(purchaseDate, card.statementDay) : '';
}

async function handleGet(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const month = typeof req.query.month === 'string' ? req.query.month.trim() : '';
  const cardId = typeof req.query.cardId === 'string' ? req.query.cardId.trim() : '';
  if (!SPEND_MONTH_KEY_RE.test(month)) {
    return res.status(400).json({ error: 'month ต้องอยู่ในรูปแบบ YYYY-MM', errors: { month: 'เดือนต้องอยู่ในรูปแบบ YYYY-MM' } });
  }

  const data = await getUserCreditData(userId);
  // cardId ที่ไม่ใช่ของผู้ใช้คนนี้ → 404 ไม่ตกไป lookup แบบ global (BR-CC-001)
  if (cardId && !data.cards.some(card => card?.id === cardId)) {
    return res.status(404).json({ error: 'card not found' });
  }

  const cardIds = new Set(
    (cardId ? data.cards.filter(card => card?.id === cardId) : data.cards).map(card => card?.id)
  );
  const items = data.spendItems
    .filter(item => item?.month === month && cardIds.has(item?.cardId))
    .map(toPublicItem);

  const sums: Record<string, number> = {};
  cardIds.forEach(id => { if (id) sums[id] = 0; });
  items.forEach(item => {
    if (item.cardId) sums[item.cardId] = (sums[item.cardId] || 0) + item.amount;
  });
  const totals: Record<string, number> = {};
  Object.keys(sums).forEach(id => { totals[id] = round2(sums[id]); });

  return res.status(200).json({ items, totals });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const input = req.body?.item;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return res.status(400).json({ error: 'item payload required' });
  }
  const { valid, errors, value } = validateSpendItemInput(input, { mode: 'create' });
  if (!valid || value.name === undefined || value.amount === undefined || value.purchaseDate === undefined) {
    return res.status(400).json({ error: 'ข้อมูลรายการไม่ถูกต้อง', errors });
  }
  const purchaseDate = value.purchaseDate;

  const getMonthFailure = (data: CreditData): { month: string } | Failure => {
    if (!data.cards.some(card => card?.id === value.cardId)) return { status: 404, body: { error: 'card not found' } };
    const derivedMonth = billingMonthFor(data, value.cardId, purchaseDate);
    if (!SPEND_MONTH_KEY_RE.test(derivedMonth)) {
      return { status: 400, body: { error: 'ไม่สามารถคำนวณรอบบิลจากวันที่ซื้อและวันสรุปยอดได้' } };
    }
    return { month: derivedMonth };
  };
  const checkFailure = (data: CreditData): Failure | null => {
    const monthResult = getMonthFailure(data);
    if ('status' in monthResult) return monthResult;
    const cardItems = data.spendItems.filter(item => item?.cardId === value.cardId);
    if (cardItems.filter(item => item?.month === monthResult.month).length >= MAX_SPEND_ITEMS_PER_CYCLE) {
      return {
        status: 409,
        body: { error: 'MAX_SPEND_ITEMS_PER_CYCLE', message: `เพิ่มรายการได้สูงสุด ${MAX_SPEND_ITEMS_PER_CYCLE} รายการต่อบัตรต่อเดือน` }
      };
    }
    if (cardItems.length >= MAX_SPEND_ITEMS_PER_CARD) {
      return {
        status: 409,
        body: { error: 'MAX_SPEND_ITEMS_PER_CARD', message: `เพิ่มรายการได้สูงสุด ${MAX_SPEND_ITEMS_PER_CARD} รายการต่อบัตร` }
      };
    }
    return null;
  };

  // ตรวจสิทธิ์/เพดานกับ snapshot ก่อน — ไม่ผ่านจะไม่แตะเอกสาร (ไม่ bump updatedAt) และตรวจซ้ำใน updater
  const pre = checkFailure(await getUserCreditData(userId));
  if (pre) return res.status(pre.status).json(pre.body);

  let failure: Failure | null = null;
  let saved: StoredSpendItem | null = null;
  const data = await updateUserCreditData(userId, (current) => {
    failure = checkFailure(current);
    if (failure) return current;
    const monthResult = getMonthFailure(current);
    if ('status' in monthResult) {
      failure = monthResult;
      return current;
    }
    const now = new Date().toISOString();
    saved = {
      id: generateSpendItemId(),
      cardId: value.cardId,
      month: monthResult.month,
      purchaseDate,
      name: value.name,
      amount: value.amount,
      source: 'user',
      createdAt: now,
      updatedAt: now
    };
    return { ...current, spendItems: [...current.spendItems, saved] };
  });

  const failureResponse = failure as Failure | null;
  if (failureResponse) return res.status(failureResponse.status).json(failureResponse.body);
  const savedItem = saved as StoredSpendItem | null;
  if (!savedItem) throw new Error('Spend item create completed without a saved item');
  return res.status(201).json({
    item: toPublicItem(savedItem),
    cycle: derivedCycleFor(data, value.cardId, savedItem.month ?? '')
  });
}

async function handlePut(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const input = req.body?.item;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return res.status(400).json({ error: 'item payload required' });
  }
  const { valid, errors, value } = validateSpendItemInput(input, { mode: 'update' });
  if (!valid) {
    return res.status(400).json({ error: 'ข้อมูลรายการไม่ถูกต้อง', errors });
  }

  const snapshot = await getUserCreditData(userId);
  const snapshotItem = snapshot.spendItems.find(item => item?.id === value.id);
  if (!snapshotItem) {
    return res.status(404).json({ error: 'spend item not found' });
  }
  const snapshotCard = snapshot.cards.find(card => card?.id === snapshotItem.cardId);
  if (!snapshotCard) return res.status(404).json({ error: 'card not found' });
  const snapshotMonth = value.purchaseDate
    ? billingMonthFor(snapshot, snapshotItem.cardId ?? '', value.purchaseDate)
    : snapshotItem.month ?? '';
  if (!SPEND_MONTH_KEY_RE.test(snapshotMonth)) {
    return res.status(400).json({ error: 'ไม่สามารถคำนวณรอบบิลจากวันที่ซื้อและวันสรุปยอดได้' });
  }
  if (value.purchaseDate) {
    const destinationCount = snapshot.spendItems.filter(item =>
      item?.cardId === snapshotItem.cardId && item?.month === snapshotMonth && item?.id !== value.id
    ).length;
    if (destinationCount >= MAX_SPEND_ITEMS_PER_CYCLE) {
      return res.status(409).json({
        error: 'MAX_SPEND_ITEMS_PER_CYCLE',
        message: `เพิ่มรายการได้สูงสุด ${MAX_SPEND_ITEMS_PER_CYCLE} รายการต่อบัตรต่อเดือน`
      });
    }
  }

  let failure: Failure | null = null;
  let saved: StoredSpendItem | null = null;
  const data = await updateUserCreditData(userId, (current) => {
    const index = current.spendItems.findIndex(item => item?.id === value.id);
    if (index === -1) {
      failure = { status: 404, body: { error: 'spend item not found' } };
      return current;
    }
    const existing = current.spendItems[index];
    const card = current.cards.find(item => item?.id === existing.cardId);
    if (!card) {
      failure = { status: 404, body: { error: 'card not found' } };
      return current;
    }
    const month = value.purchaseDate
      ? computeStartMonthFromPurchase(value.purchaseDate, card.statementDay)
      : existing.month ?? '';
    if (!SPEND_MONTH_KEY_RE.test(month)) {
      failure = { status: 400, body: { error: 'ไม่สามารถคำนวณรอบบิลจากวันที่ซื้อและวันสรุปยอดได้' } };
      return current;
    }
    if (value.purchaseDate && current.spendItems.filter(item =>
      item?.cardId === existing.cardId && item?.month === month && item?.id !== value.id
    ).length >= MAX_SPEND_ITEMS_PER_CYCLE) {
      failure = {
        status: 409,
        body: {
          error: 'MAX_SPEND_ITEMS_PER_CYCLE',
          message: `เพิ่มรายการได้สูงสุด ${MAX_SPEND_ITEMS_PER_CYCLE} รายการต่อบัตรต่อเดือน`
        }
      };
      return current;
    }
    saved = {
      ...existing,
      month,
      ...(value.purchaseDate !== undefined ? { purchaseDate: value.purchaseDate } : {}),
      ...(value.name !== undefined ? { name: value.name } : {}),
      ...(value.amount !== undefined ? { amount: value.amount } : {}),
      updatedAt: new Date().toISOString()
    };
    const spendItems = [...current.spendItems];
    spendItems[index] = saved;
    return { ...current, spendItems };
  });

  const failureResponse = failure as Failure | null;
  if (failureResponse) return res.status(failureResponse.status).json(failureResponse.body);
  const savedItem = saved as StoredSpendItem | null;
  if (!savedItem) throw new Error('Spend item update completed without a saved item');
  return res.status(200).json({
    item: toPublicItem(savedItem),
    cycle: derivedCycleFor(data, String(savedItem.cardId ?? ''), String(savedItem.month ?? ''))
  });
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const id = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
  if (!id) return res.status(400).json({ error: 'id required' });

  const snapshot = await getUserCreditData(userId);
  if (!snapshot.spendItems.some(item => item?.id === id)) {
    return res.status(404).json({ error: 'spend item not found' });
  }

  let removed: StoredSpendItem | null = null;
  const data = await updateUserCreditData(userId, (current) => {
    removed = current.spendItems.find(item => item?.id === id) || null;
    if (!removed) return current;
    return { ...current, spendItems: current.spendItems.filter(item => item?.id !== id) };
  });

  const removedItem = removed as StoredSpendItem | null;
  if (!removedItem) return res.status(404).json({ error: 'spend item not found' });
  return res.status(200).json({
    deletedId: id,
    cycle: derivedCycleFor(data, String(removedItem.cardId ?? ''), String(removedItem.month ?? ''))
  });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = assertUserId(req, res);
  if (!userId) return;
  if (!validateApiRequest(req, res, 'credit-cards/spend-items')) return;

  try {
    if (req.method === 'GET') return await handleGet(req, res, userId);
    if (req.method === 'POST') return await handlePost(req, res, userId);
    if (req.method === 'PUT') return await handlePut(req, res, userId);
    if (req.method === 'DELETE') return await handleDelete(req, res, userId);
  } catch (error) {
    console.error('Credit card spend items API error:', error);
    return res.status(500).json({ error: 'ไม่สามารถจัดการรายการใช้จ่ายบัตรเครดิตได้' });
  }

  res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAudit(handler, { source: 'credit_card_spend_item' });
