/**
 * creditCardSync.js  (server-only)
 * เชื่อมแผนผ่อนชำระ + ยอดใช้จ่ายหมุนเวียน เข้ากับ ExpenseTable
 * แบบ derive-on-read / strip-on-write (ADR-009 · ADR-011 · BR-CC-007 · BR-CC-016)
 *
 * ค่าคงที่ของดีไซน์นี้:
 *   เอกสารใน monthly_expense ต้องไม่มีคีย์ที่ขึ้นต้นด้วย /^cci_/ หรือ /^ccr_/ เด็ดขาด
 *   - GET : inject แถวที่ derive ได้ ก่อน getAccountSummary / getExpenseTotals
 *   - POST: อ่านเฉพาะ paid กลับเข้าแผน/cycle แล้วลบคีย์ทิ้งก่อนเขียนลง storage
 *
 * ไม่มี write ทิศทาง card → expense จึงไม่มี loop ให้ต้องกัน และแถวซ้ำเป็นไปไม่ได้
 * เพราะคีย์เป็น pure function ของ (planId, installmentNo) และของ cardId
 */

import crypto from 'crypto';
import {
  INSTALLMENT_KEY_RE,
  INSTALLMENT_KEY_PREFIX,
  REVOLVING_KEY_PREFIX,
  buildInstallmentRowKey,
  parseInstallmentRowKey,
  buildRevolvingRowKey,
  parseRevolvingRowKey,
  buildRevolvingCycles,
  resolvePlanStatus,
  getCurrentMonthKey,
  isCreditCardRowKey,
  MAX_REVOLVING_CYCLES_PER_CARD,
  PLAN_STATUS
} from '../creditCardUtils';
import { getUserCreditData, updateUserCreditData } from './creditCardStore';

export { INSTALLMENT_KEY_RE, INSTALLMENT_KEY_PREFIX, REVOLVING_KEY_PREFIX };

/**
 * เลือกชื่อบัญชีสำหรับแถวผ่อนชำระ
 *
 * ⚠ ห้าม inject ค่าว่าง (Stage 4 MAJOR-3):
 *   server getAccountSummary() แปลงค่าว่างเป็น 'ไม่ระบุบัญชี'
 *   แต่ client formatExpenseData() แปลงเป็น storedBankAccounts[0] คือบัญชีแรกของผู้ใช้
 *   ตัวเลขบนหน้าจอเดียวกันจะไม่ตรงกัน และแสดงบัญชีผิดความจริง
 *
 * จึงใช้ bankName ของบัตรเมื่อตรงกับบัญชีของผู้ใช้พอดี มิฉะนั้นใช้ชื่อบัตร (ไม่ว่างเสมอ)
 * @returns {string}
 */
function resolveRowAccount(card, bankAccounts = []) {
  const bankName = String(card?.bankName || '').trim();
  const accounts = Array.isArray(bankAccounts)
    ? bankAccounts.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  if (bankName && accounts.includes(bankName)) return bankName;
  const cardName = String(card?.name || '').trim();
  return cardName || bankName || 'บัตรเครดิต';
}

/**
 * แผนนี้ให้แถวของงวดนี้หรือไม่
 * แผนที่ถูกยกเลิกยังคงงวดที่ "ชำระแล้ว" ไว้เป็นประวัติ แต่ไม่ให้งวดอนาคตที่ยังไม่ชำระ (BR-CC-010)
 */
function shouldIncludeRow(plan, row) {
  if (!row) return false;
  if (plan?.status === PLAN_STATUS.CANCELLED) return row.paid === true;
  return true;
}

/**
 * สร้างแถวค่าใช้จ่ายที่ derive จากแผนผ่อนของเดือนที่ระบุ
 * @param {object} creditData - { cards, plans }
 * @param {string} month - YYYY-MM
 * @param {array} bankAccounts - บัญชีธนาคารของผู้ใช้ (ใช้จับคู่ชื่อบัญชี)
 * @returns {object} map ของ { 'cci_xxx_NN': {name, actual, account, paid, dueDay} } — อาจว่าง
 */
export function buildInstallmentExpenseRows(creditData, month, bankAccounts = []) {
  const rows = {};
  if (!creditData || typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return rows;

  const cards = Array.isArray(creditData.cards) ? creditData.cards : [];
  const plans = Array.isArray(creditData.plans) ? creditData.plans : [];
  if (!plans.length) return rows;

  const cardById = new Map(cards.map(card => [card?.id, card]));

  plans.forEach(plan => {
    const card = cardById.get(plan?.cardId);
    if (!card) return;
    const schedule = Array.isArray(plan.schedule) ? plan.schedule : [];
    schedule.forEach(row => {
      if (row?.dueMonth !== month) return;
      if (!shouldIncludeRow(plan, row)) return;
      rows[buildInstallmentRowKey(plan.id, row.no)] = {
        name: `${plan.itemName} (งวด ${row.no}/${plan.months})`,
        actual: Number(row.payment) || 0,
        account: resolveRowAccount(card, bankAccounts),
        paid: row.paid === true,
        dueDay: card.dueDay
      };
    });
  });

  return rows;
}

/**
 * สร้างแถวค่าใช้จ่ายที่ derive จากยอดใช้จ่ายหมุนเวียนของเดือนที่ระบุ (BR-CC-016)
 * 1 แถวต่อ 1 บัตร และปล่อยออกเมื่อ amountDue > 0 เท่านั้น
 * @param {object} creditData - { cards, cycles }
 * @param {string} month - YYYY-MM
 * @param {array} bankAccounts
 * @returns {object} map ของ { 'ccr_xxx': {name, actual, account, paid, dueDay} } — อาจว่าง
 */
export function buildRevolvingExpenseRows(creditData, month, bankAccounts = []) {
  const rows = {};
  if (!creditData || typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return rows;

  const cards = Array.isArray(creditData.cards) ? creditData.cards : [];
  const cycles = Array.isArray(creditData.cycles) ? creditData.cycles : [];
  if (!cards.length || !cycles.length) return rows;

  cards.forEach(card => {
    const chain = buildRevolvingCycles(card, cycles, { throughMonth: month });
    const cycle = chain.find(item => item.month === month);
    if (!cycle || !(cycle.amountDue > 0)) return;

    rows[buildRevolvingRowKey(card.id)] = {
      name: `ยอดใช้จ่ายบัตร ${card.name}${cycle.paymentAction === 'minimum' ? ' (ขั้นต่ำ)' : ''}`,
      actual: cycle.amountDue,
      account: resolveRowAccount(card, bankAccounts),
      paid: cycle.paymentAction !== null,
      dueDay: card.dueDay
    };
  });

  return rows;
}

/**
 * รายชื่อเดือนทั้งหมดที่มีแถวผ่อนชำระ
 * ใช้ union เข้ากับ branch "ทุกเดือน" ของ GET เพื่อให้เดือนที่ยังไม่เคยมีเอกสารก็ปรากฏ
 * (Stage 4 MAJOR-1 / AC-34)
 * @param {object} creditData
 * @returns {string[]}
 */
export function getInstallmentMonths(creditData) {
  const months = new Set();
  const cards = Array.isArray(creditData?.cards) ? creditData.cards : [];
  const plans = Array.isArray(creditData?.plans) ? creditData.plans : [];
  if (!plans.length || !cards.length) return [];
  const cardIds = new Set(cards.map(card => card?.id));

  plans.forEach(plan => {
    if (!cardIds.has(plan?.cardId)) return;
    (Array.isArray(plan.schedule) ? plan.schedule : []).forEach(row => {
      if (!shouldIncludeRow(plan, row)) return;
      if (typeof row?.dueMonth === 'string') months.add(row.dueMonth);
    });
  });

  return Array.from(months);
}

/**
 * รายชื่อเดือนทั้งหมดที่มีแถวบัตรเครดิต (งวดผ่อน + ยอดหมุนเวียน)
 * เดือนที่มีเฉพาะแถวหมุนเวียนต้องอยู่ใน list นี้ด้วย มิฉะนั้น branch "ทุกเดือน" จะไม่มีเดือนนั้น
 * @param {object} creditData
 * @returns {string[]}
 */
export function getCreditCardMonths(creditData) {
  const months = new Set(getInstallmentMonths(creditData));

  const cards = Array.isArray(creditData?.cards) ? creditData.cards : [];
  const cycles = Array.isArray(creditData?.cycles) ? creditData.cycles : [];
  if (cards.length && cycles.length) {
    // materialise ถึงเดือนปัจจุบันเสมอ เพื่อให้เดือนที่มีแต่ยอดยกมาก็ปรากฏ
    const throughMonth = getCurrentMonthKey();
    cards.forEach(card => {
      buildRevolvingCycles(card, cycles, { throughMonth }).forEach(cycle => {
        if (cycle.amountDue > 0) months.add(cycle.month);
      });
    });
  }

  return Array.from(months);
}

function generateCycleId() {
  return `rc_${crypto.randomBytes(6).toString('hex')}`;
}

/** อัปเดตตารางผ่อนตาม paid ที่ส่งกลับมา — คืน { plans, applied } */
function applyInstallmentUpdates(data, updates) {
  if (!updates.length) return { plans: data.plans, applied: 0 };

  let applied = 0;
  const plans = data.plans.map(plan => {
    const planUpdates = updates.filter(update => update.planId === plan?.id);
    if (!planUpdates.length) return plan;
    // แผนที่ยกเลิกแล้วเป็นสถานะสุดท้าย ห้ามแก้สถานะการชำระอีก (BR-CC-009)
    if (plan.status === PLAN_STATUS.CANCELLED) return plan;

    const schedule = Array.isArray(plan.schedule) ? [...plan.schedule] : [];
    let changed = false;
    planUpdates.forEach(({ installmentNo, paid }) => {
      const index = schedule.findIndex(row => row?.no === installmentNo);
      if (index === -1) return;
      if (schedule[index].paid === paid) return;
      schedule[index] = {
        ...schedule[index],
        paid,
        paidAt: paid ? new Date().toISOString() : null,
        paidSource: paid ? 'expense_table' : null
      };
      changed = true;
      applied += 1;
    });
    if (!changed) return plan;

    const nextPlan = { ...plan, schedule, updatedAt: new Date().toISOString() };
    return { ...nextPlan, status: resolvePlanStatus(nextPlan) };
  });

  return { plans, applied };
}

/**
 * อัปเดต paymentAction ของ cycle ตาม paid ที่ส่งกลับมา — state transition ล้วน idempotent (BR-CC-016)
 *   paid=true  + action null            → 'full'
 *   paid=true  + action 'full'/'minimum'→ ไม่ทำอะไร (ห้ามอัปเกรดขั้นต่ำเป็นเต็มเงียบ ๆ)
 *   paid=false + action ไม่ null        → null
 *   paid=false + action null            → ไม่ทำอะไร
 * ไม่มี cycle เก็บไว้ + paid=true → สร้างใหม่ด้วย newSpend: 0 มิฉะนั้นปุ่มบนแถวยอดยกมาจะกดไม่ติด
 * @returns {{cycles: array, applied: number}}
 */
function applyRevolvingUpdates(data, updates, month) {
  if (!updates.length || typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
    return { cycles: data.cycles, applied: 0 };
  }

  const cardIds = new Set(data.cards.map(card => card?.id));
  const now = new Date().toISOString();
  let cycles = [...data.cycles];
  let applied = 0;

  updates.forEach(({ cardId, paid }) => {
    // บัตรที่ผู้ใช้ไม่ได้เป็นเจ้าของ หรือบัตรที่ถูกลบไปแล้ว → ข้ามเงียบ ๆ ไม่ใช่ 500
    if (!cardIds.has(cardId)) return;

    const index = cycles.findIndex(cycle => cycle?.cardId === cardId && cycle?.month === month);

    if (index === -1) {
      if (!paid) return;
      if (cycles.filter(cycle => cycle?.cardId === cardId).length >= MAX_REVOLVING_CYCLES_PER_CARD) return;
      cycles = [...cycles, {
        id: generateCycleId(),
        cardId,
        month,
        newSpend: 0,
        paymentAction: 'full',
        paidAt: now,
        paidSource: 'expense_table',
        createdAt: now,
        updatedAt: now
      }];
      applied += 1;
      return;
    }

    const current = cycles[index];
    if (paid) {
      if (current.paymentAction !== null && current.paymentAction !== undefined) return;
      cycles[index] = {
        ...current,
        paymentAction: 'full',
        paidAt: now,
        paidSource: 'expense_table',
        updatedAt: now
      };
    } else {
      if (current.paymentAction === null || current.paymentAction === undefined) return;
      cycles[index] = {
        ...current,
        paymentAction: null,
        paidAt: null,
        paidSource: null,
        updatedAt: now
      };
    }
    applied += 1;
  });

  return { cycles, applied };
}

/**
 * เขียนเฉพาะ `paid` จาก payload ของ ExpenseTable กลับเข้าตารางผ่อนและ cycle หมุนเวียน
 * (BR-CC-008 · BR-CC-016)
 * คีย์ที่รูปแบบไม่ตรง regex ถือเป็นรายการค่าใช้จ่ายปกติ
 * คีย์ที่ตรง regex แต่ไม่พบแผน/บัตร จะถูกข้ามเงียบ ๆ ไม่โยน error
 *
 * @param {string} userId
 * @param {object} expenseData
 * @param {string} month - บังคับสำหรับแถว ccr_ เพราะคีย์ ccr_ ไม่ได้เข้ารหัสเดือนไว้ในตัวเอง
 * @returns {Promise<number>} จำนวนรายการที่ถูกอัปเดต
 */
export async function applyCreditCardPaidFromExpensePayload(userId, expenseData, month) {
  if (!userId || !expenseData || typeof expenseData !== 'object') return 0;

  const installmentUpdates = [];
  const revolvingUpdates = [];
  Object.keys(expenseData).forEach(key => {
    const row = expenseData[key];
    if (!row || typeof row !== 'object') return;
    const paid = row.paid === true || row.paid === 'true';

    const installment = parseInstallmentRowKey(key);
    if (installment) {
      installmentUpdates.push({ ...installment, paid });
      return;
    }
    const revolving = parseRevolvingRowKey(key);
    if (revolving) revolvingUpdates.push({ ...revolving, paid });
  });

  if (!installmentUpdates.length && !revolvingUpdates.length) return 0;

  let appliedCount = 0;
  await updateUserCreditData(userId, (data) => {
    const { plans, applied: plansApplied } = applyInstallmentUpdates(data, installmentUpdates);
    const { cycles, applied: cyclesApplied } = applyRevolvingUpdates(data, revolvingUpdates, month);
    appliedCount = plansApplied + cyclesApplied;
    return { ...data, plans, cycles };
  });

  return appliedCount;
}

/**
 * ลบคีย์บัตรเครดิต (cci_ และ ccr_) ออกจาก payload ก่อนเขียนลง storage
 * รวมถึงลบคีย์เหล่านั้นที่หลุดมาใน __removeKeys — แถวบัตรเครดิตลบได้จากหน้าบัตรเครดิตเท่านั้น
 * (BR-CC-008 · BR-CC-016)
 * @param {object} expenseData
 * @returns {object} payload ชุดใหม่ที่ปลอดคีย์ cci_ / ccr_
 */
export function stripCreditCardKeys(expenseData) {
  if (!expenseData || typeof expenseData !== 'object') return expenseData;

  const cleaned = {};
  Object.keys(expenseData).forEach(key => {
    if (isCreditCardRowKey(key)) return;
    cleaned[key] = expenseData[key];
  });

  if (Array.isArray(cleaned.__removeKeys)) {
    cleaned.__removeKeys = cleaned.__removeKeys.filter(
      key => typeof key === 'string' && !isCreditCardRowKey(key)
    );
  }

  return cleaned;
}

/**
 * โหลดข้อมูลที่จำเป็นสำหรับ inject แถวบัตรเครดิต
 * ความล้มเหลวใด ๆ จะถูก log แล้วคืน null — บัตรเครดิตต้องไม่มีวันทำให้หน้ารายจ่ายพัง (R-2)
 *
 * ⚠ ต้องผ่านเมื่อมี "แผนผ่อน หรือ cycle หมุนเวียน" อย่างใดอย่างหนึ่ง
 *   เงื่อนไขเดิมเช็คแค่ plans.length ทำให้ผู้ใช้ที่ใช้เฉพาะยอดหมุนเวียนไม่ได้แถวเลยสักแถว (AC-59)
 * @param {string} userId
 * @returns {Promise<{creditData: object, bankAccounts: string[]}|null>}
 */
export async function loadCreditCardContext(userId, bankAccounts = []) {
  try {
    const creditData = await getUserCreditData(userId);
    if (!creditData) return null;
    const hasPlans = Array.isArray(creditData.plans) && creditData.plans.length > 0;
    const hasCycles = Array.isArray(creditData.cycles) && creditData.cycles.length > 0;
    if (!hasPlans && !hasCycles) return null;
    return { creditData, bankAccounts };
  } catch (error) {
    console.error('Credit card sync: failed to read credit card store for user', userId, error);
    return null;
  }
}

function mergeAccounts(context, extraBankAccounts) {
  return Array.from(new Set([
    ...(Array.isArray(context.bankAccounts) ? context.bankAccounts : []),
    ...(Array.isArray(extraBankAccounts) ? extraBankAccounts : [])
  ]));
}

/**
 * เรียก buildInstallmentExpenseRows แบบไม่มีทางโยน error ออกมา
 * @returns {object} map แถว (ว่างเมื่อ context เป็น null หรือเกิดข้อผิดพลาด)
 */
export function safeBuildInstallmentRows(context, month, extraBankAccounts = []) {
  if (!context) return {};
  try {
    return buildInstallmentExpenseRows(context.creditData, month, mergeAccounts(context, extraBankAccounts));
  } catch (error) {
    console.error('Credit card sync: failed to derive installment rows for month', month, error);
    return {};
  }
}

/** เรียก buildRevolvingExpenseRows แบบไม่มีทางโยน error ออกมา */
export function safeBuildRevolvingRows(context, month, extraBankAccounts = []) {
  if (!context) return {};
  try {
    return buildRevolvingExpenseRows(context.creditData, month, mergeAccounts(context, extraBankAccounts));
  } catch (error) {
    console.error('Credit card sync: failed to derive revolving rows for month', month, error);
    return {};
  }
}

/**
 * จุดต่อเดียวที่คืนแถวบัตรเครดิตทั้งสองตระกูล
 * monthly_expense.js เรียกตัวนี้ตัวเดียวทุกจุด แทนที่จะเพิ่ม call ที่ 7 ในแต่ละจุด
 * @returns {object} map แถว cci_ + ccr_
 */
export function safeBuildCreditCardRows(context, month, extraBankAccounts = []) {
  return {
    ...safeBuildInstallmentRows(context, month, extraBankAccounts),
    ...safeBuildRevolvingRows(context, month, extraBankAccounts)
  };
}

/** เรียก getCreditCardMonths แบบไม่มีทางโยน error ออกมา */
export function safeGetCreditCardMonths(context) {
  if (!context) return [];
  try {
    return getCreditCardMonths(context.creditData);
  } catch (error) {
    console.error('Credit card sync: failed to collect credit card months', error);
    return [];
  }
}
