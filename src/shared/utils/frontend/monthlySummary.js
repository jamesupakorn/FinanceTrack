/**
 * monthlySummary.js
 * โมเดลสรุปยอดรายเดือนแบบรวมศูนย์ — ใช้แทนการคำนวณซ้ำในแต่ละหน้า (BR-DASH-005)
 * แยกยอดบัตรเครดิต (งวดผ่อนชำระ + ยอดหมุนเวียน) ออกจากรายจ่ายทั่วไปให้ถูกต้อง แก้บั๊กนับซ้ำเดิม (ADR-013)
 *
 * Pure module: ไม่มี fetch, ไม่มี React ทุกยอดเงินผ่าน round2 เสมอ
 * การจำแนกแถวบัตรเครดิตใช้ isCreditCardRowKey/isInstallmentRowKey จาก creditCardUtils.js เท่านั้น —
 * ห้ามประกาศ prefix ของคีย์แถวบัตรเครดิตเป็น literal ซ้ำที่ไฟล์นี้ (AC-SH-7); จุดที่มีอยู่แล้วคือ
 * numberUtils.js (private copy ป้องกันการ derive แถวว่างผิดพลาดของ formatExpenseData)
 */

import { isCreditCardRowKey, isInstallmentRowKey, round2 } from '../creditCardUtils';
import { isPaidFlag } from '../commonUtils';

/** ฟิลด์ metadata ที่ไม่ใช่แถวรายจ่ายจริง — ใช้กรองก่อนวนลูป expenseData */
export const SUMMARY_IGNORED_KEYS = new Set([
  'totalActualPaid', 'accountSummary', 'bankAccounts',
  'month', '_id', 'id', 'userId', 'periodKey', '__removeKeys'
]);

/** เพดานงบประมาณเริ่มต้น (% ของรายรับ) — ผู้ใช้ปรับต่อคนได้ใน P4 (persist เป็น budgetThresholds บน user document) */
export const DEFAULT_BUDGET_THRESHOLDS = Object.freeze({
  generalExpense: 50,   // เพดานสูงสุด % ของรายรับ
  dailyExpense: 15,     // เพดานสูงสุด
  creditCard: 15,       // เพดานสูงสุด
  savings: 20           // เป้าหมายขั้นต่ำ
});

/**
 * รายชื่อ 4 คีย์ของ budgetThresholds — single source (derive จาก DEFAULT_BUDGET_THRESHOLDS แทนการพิมพ์
 * ซ้ำ) ใช้เป็น whitelist ที่จุดเขียนข้อมูล (pages/api/user-bank-accounts.js) และ pick-list ที่ฟอร์ม
 * (BudgetThresholdForm.js) — ห้ามประกาศ array นี้ซ้ำที่ไฟล์อื่น (AC-RS-14/M-3)
 */
export const BUDGET_THRESHOLD_KEYS = Object.keys(DEFAULT_BUDGET_THRESHOLDS);

/**
 * รับค่า threshold ดิบ (ตัวเลข, numeric string, undefined/null, หรือค่าแปลกอื่น ๆ) หนึ่งคีย์
 * คืนค่าที่ปลอดภัยเสมอ — ไม่คืน NaN, ไม่ throw ไม่ว่า input จะเป็นอะไร
 */
function coerceThresholdValue(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean' || Array.isArray(value) || typeof value === 'object') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(100, Math.max(0, numeric));
}

/**
 * Read-path defaulting/coercion ของ budgetThresholds เท่านั้น (BR-DASH-009) — เติมคีย์ที่ขาดจาก
 * DEFAULT_BUDGET_THRESHOLDS, แปลง numeric string เป็นตัวเลข, clamp 0..100 ไม่ throw/reject เด็ดขาด
 * เพราะข้อมูลที่มาถึงฟังก์ชันนี้ผ่านการ validate ตอนเขียนมาแล้ว (หรือไม่มีข้อมูลเลย — E1/E2/E3)
 * ⚠ ห้ามเรียกฟังก์ชันนี้ก่อน validate ที่จุดเขียนข้อมูล — clamp ก่อน validate จะทำให้ -1/101 ผ่านไปเป็น
 * 0/100 เงียบ ๆ แทนที่จะถูกปฏิเสธ 400 (M-2) ฟังก์ชันนี้จึงใช้เฉพาะฝั่งอ่านเท่านั้น
 */
export function normaliseBudgetThresholds(raw) {
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const result = {};
  BUDGET_THRESHOLD_KEYS.forEach((key) => {
    result[key] = coerceThresholdValue(source[key], DEFAULT_BUDGET_THRESHOLDS[key]);
  });
  return result;
}

/**
 * นิยามแถวของ evaluateBudgetHealth — label ภาษาไทย + ประเภทเกณฑ์
 * export ไว้เป็นแหล่งเดียว (TD-M07) — BudgetThresholdForm.js (`/settings`) เดิมมี label ชุดของตัวเอง
 * (`FIELD_DEFS`) ที่ดริฟต์ไปจากชุดนี้ 3 ใน 4 คีย์ ตอนนี้ import จากที่นี่แทน
 */
export const BUDGET_ROW_DEFS = [
  { id: 'generalExpense', label: 'บิลและรายจ่าย', kind: 'max' },
  { id: 'dailyExpense', label: 'ค่าใช้จ่ายรายวัน', kind: 'max' },
  { id: 'creditCard', label: 'บัตรเครดิต', kind: 'max' },
  { id: 'savings', label: 'เงินออม', kind: 'min' }
];

/** แปลงค่าที่อาจมี comma (string) หรือเป็น number อยู่แล้ว → number เสมอ, ไม่ได้คืน 0 (ไม่ throw) */
function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseYearFromMonth(monthKey) {
  if (typeof monthKey !== 'string' || !/^\d{4}-\d{2}$/.test(monthKey)) {
    return String(new Date().getFullYear());
  }
  return monthKey.split('-')[0];
}

/**
 * รายรับรวม — เหมือนกับ branch เดิมใน getSummaryData (summaryUtils.js:21-26) ทุกประการ
 * เงินเดือนสุทธิ (net_income) ชนะเสมอถ้ามีค่า > 0 ไม่งั้น fallback ไปใช้ income.salary (E9)
 */
export function computeTotalIncome({ incomeData, salaryData } = {}) {
  const incomeTotalRaw = parseFloat(incomeData?.รวม || 0);
  const incomeSalaryRaw = parseFloat(incomeData?.salary || 0);
  const salaryNetIncome = parseFloat(
    salaryData?.summary?.net_income || salaryData?.สรุป?.เงินได้สุทธิ || 0
  );
  const nonSalaryIncome = incomeTotalRaw - (Number.isFinite(incomeSalaryRaw) ? incomeSalaryRaw : 0);
  const totalIncome = (Number.isFinite(salaryNetIncome) && salaryNetIncome > 0 ? salaryNetIncome : (incomeSalaryRaw || 0))
    + (Number.isFinite(nonSalaryIncome) ? nonSalaryIncome : 0);
  return Number.isFinite(totalIncome) ? totalIncome : 0;
}

/**
 * แยกยอดรายจ่ายทั่วไปออกจากยอดบัตรเครดิต (BR-DASH-001/002/003/006)
 * แถวบัตรเครดิตทุกแถวถูก inject เข้ามาตอน GET แล้ว (Feature 1) — ห้าม derive เอง ให้เชื่อ
 * isCreditCardRowKey เท่านั้น (ไม่มี key อื่นนอกเหนือจาก installment/revolving ที่ทำให้ค่านี้เป็นจริง)
 */
export function splitExpenseTotals(expenseData = {}) {
  let generalExpense = 0;
  let generalUnpaid = 0;
  let creditCard = 0;
  let creditCardInstallment = 0;
  let creditCardRevolving = 0;
  let creditCardUnpaid = 0;
  let rowCount = 0;
  let generalRowCount = 0;

  Object.entries(expenseData || {}).forEach(([key, value]) => {
    if (SUMMARY_IGNORED_KEYS.has(key)) return;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;

    const amount = toNumber(value.actual);
    rowCount += 1;

    if (isCreditCardRowKey(key)) {
      creditCard += amount;
      if (isInstallmentRowKey(key)) {
        creditCardInstallment += amount;
      } else {
        // isCreditCardRowKey ที่ไม่ใช่ installment คือยอดหมุนเวียนเสมอ (นิยามของ isCreditCardRowKey เอง)
        creditCardRevolving += amount;
      }
      if (!isPaidFlag(value.paid)) creditCardUnpaid += amount;
    } else {
      generalExpense += amount;
      generalRowCount += 1;
      if (!isPaidFlag(value.paid)) generalUnpaid += amount;
    }
  });

  return {
    generalExpense: round2(generalExpense),
    generalUnpaid: round2(generalUnpaid),
    creditCard: round2(creditCard),
    creditCardInstallment: round2(creditCardInstallment),
    creditCardRevolving: round2(creditCardRevolving),
    creditCardUnpaid: round2(creditCardUnpaid),
    rowCount,
    generalRowCount
  };
}

/**
 * โมเดลสรุปยอดรายเดือนตัวเดียว — ทุกที่ที่ต้องแสดงยอดเงินรายเดือนควรอ่านจากที่นี่ (BR-DASH-005)
 * ไม่ throw แม้ payload จะว่างเปล่าหรือ request ล้มเหลว (E5/E6) — คืนค่า 0/null แทนเสมอ
 */
export function getMonthlySummaryModel({
  month,
  incomeData,
  expenseData,
  savingsData,
  dailyExpenseData,
  salaryData,
  taxData,
  thresholds = DEFAULT_BUDGET_THRESHOLDS
} = {}) {
  const year = parseYearFromMonth(month);

  // ปัด 5 องค์ประกอบก่อนคำนวณ netCashFlow เสมอ (rounding contract) — ตัวเลขที่แสดงบวกกันแล้วตรงกับยอดสุทธิ
  const totalIncome = round2(computeTotalIncome({ incomeData, salaryData }));
  const split = splitExpenseTotals(expenseData);
  const generalExpense = split.generalExpense;
  const creditCard = split.creditCard;
  const dailyExpense = round2(toNumber(dailyExpenseData?.totalMonthly));
  const savings = round2(toNumber(savingsData?.รวมเงินเก็บ));
  const taxAccumulated = round2(toNumber(taxData?.[year]?.accumulated_tax));

  const totalOutflow = round2(generalExpense + dailyExpense + savings + creditCard);
  const netCashFlow = round2(totalIncome - totalOutflow);
  const transferableSavings = Math.max(0, netCashFlow);

  const hasIncome = totalIncome > 0;
  const ratios = hasIncome
    ? {
      generalExpense: (generalExpense / totalIncome) * 100,
      dailyExpense: (dailyExpense / totalIncome) * 100,
      savings: (savings / totalIncome) * 100,
      creditCard: (creditCard / totalIncome) * 100,
      netCashFlow: (netCashFlow / totalIncome) * 100,
      transferableSavings: (transferableSavings / totalIncome) * 100
    }
    : null;

  return {
    month,
    year,
    totalIncome,
    generalExpense,
    dailyExpense,
    savings,
    creditCard,
    creditCardInstallment: split.creditCardInstallment,
    creditCardRevolving: split.creditCardRevolving,
    totalOutflow,
    netCashFlow,
    transferableSavings,
    unpaid: {
      general: split.generalUnpaid,
      creditCard: split.creditCardUnpaid,
      total: round2(split.generalUnpaid + split.creditCardUnpaid)
    },
    taxAccumulated,
    hasIncome,
    ratios
  };
}

function classifyMaxUsage(usage) {
  if (usage < 0.8) return { status: 'ok', label: 'ปกติ' };
  if (usage < 1.0) return { status: 'near', label: 'ใกล้เกณฑ์' };
  if (usage < 1.2) return { status: 'over', label: 'เกินเกณฑ์' };
  return { status: 'critical', label: 'เกินเกณฑ์มาก' };
}

function classifyMinUsage(usage) {
  return usage >= 1
    ? { status: 'on-target', label: 'ถึงเป้าหมาย' }
    : { status: 'below-target', label: 'ต่ำกว่าเป้าหมาย' };
}

/**
 * ประเมินสุขภาพงบประมาณ 4 แถว — pure, ไม่มี warning เมื่อยังไม่มีรายรับ
 */
export function evaluateBudgetHealth(model, thresholds = DEFAULT_BUDGET_THRESHOLDS) {
  if (!model || !model.hasIncome || !model.ratios) {
    return {
      available: false,
      rows: [],
      attentionCount: 0,
      rollupMessage: 'ยังไม่มีข้อมูลรายรับสำหรับเดือนนี้'
    };
  }

  const amountByRow = {
    generalExpense: model.generalExpense,
    dailyExpense: model.dailyExpense,
    creditCard: model.creditCard,
    savings: model.savings
  };

  const rows = BUDGET_ROW_DEFS.map(({ id, label, kind }) => {
    const amount = amountByRow[id];
    const ratio = model.ratios[id];
    const threshold = thresholds?.[id] ?? DEFAULT_BUDGET_THRESHOLDS[id];
    const usage = threshold > 0 ? ratio / threshold : 0;
    const classification = kind === 'max' ? classifyMaxUsage(usage) : classifyMinUsage(usage);
    return {
      id,
      label,
      kind,
      amount,
      ratio,
      threshold,
      usage,
      status: classification.status,
      statusLabel: classification.label,
      barPercent: Math.min(100, Math.max(0, usage * 100))
    };
  });

  const attentionCount = rows.filter(row => row.status !== 'ok' && row.status !== 'on-target').length;
  const rollupMessage = attentionCount === 0
    ? 'งบประมาณเดือนนี้อยู่ในเกณฑ์ที่ดีทุกด้าน'
    : `มี ${attentionCount} รายการที่ควรให้ความสนใจ`;

  return { available: true, rows, attentionCount, rollupMessage };
}
