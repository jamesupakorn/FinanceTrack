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

/** ยอดรับ/เงินเดือน — รูปร่างหลวมตาม Record<string, unknown> เพื่อให้ตรงกับ summaryUtils.ts's
 *  SummaryDataInput ที่เป็น caller .ts เพียงรายเดียว (task-context §summaryUtils.ts's real call site) —
 *  ต้อง narrow ด้วยมือ (typeof/Number ไม่ใช่ parseFloat ตรง ๆ) ก่อนใช้ เพราะ property เป็น unknown ทั้งหมด */
type IncomeDataLike = Record<string, unknown>;
type SalaryDataLike = Record<string, unknown>;

/** แถวรายจ่ายหนึ่งแถว — รูปร่างเดียวกับ ExpenseItem (domain.ts) แต่ปล่อยให้เป็น optional/loose เพราะ
 *  ถูกกรอง SUMMARY_IGNORED_KEYS/typeof/Array.isArray ก่อนอ่านเสมอ ไม่ประกาศใหม่ซ้ำ ExpenseItem ตรง ๆ
 *  เพราะ ExpenseItem.actual/paid ไม่ optional แต่ค่าที่รอดผ่านตัวกรองในไฟล์นี้อาจขาด actual/paid ได้จริง
 *  (แถวที่ยังไม่กรอก) */
interface ExpenseRowLike {
  actual?: number | string;
  paid?: boolean | string;
  [key: string]: unknown;
}
type ExpenseDataLike = Record<string, unknown>; // ยังไม่ narrow เป็น ExpenseRowLike จนกว่าจะผ่าน
                                                  // SUMMARY_IGNORED_KEYS + typeof/Array.isArray guard

interface SavingsDataLike {
  'รวมเงินเก็บ'?: number | string;
  [key: string]: unknown;
}
interface DailyExpenseDataLike {
  totalMonthly?: number | string;
  [key: string]: unknown;
}
interface TaxDataLike {
  [year: string]: { accumulated_tax?: number | string; [key: string]: unknown } | undefined;
}

interface BudgetThresholds {
  generalExpense: number;
  dailyExpense: number;
  creditCard: number;
  savings: number;
}

interface BudgetRowDef {
  id: keyof BudgetThresholds;
  label: string;
  kind: 'max' | 'min';
}

interface ExpenseSplitTotals {
  generalExpense: number;
  generalUnpaid: number;
  creditCard: number;
  creditCardInstallment: number;
  creditCardRevolving: number;
  creditCardUnpaid: number;
  rowCount: number;
  generalRowCount: number;
}

interface MonthlySummaryModel {
  month: string | undefined;
  year: string;
  totalIncome: number;
  generalExpense: number;
  dailyExpense: number;
  savings: number;
  creditCard: number;
  creditCardInstallment: number;
  creditCardRevolving: number;
  totalOutflow: number;
  netCashFlow: number;
  transferableSavings: number;
  unpaid: { general: number; creditCard: number; total: number };
  taxAccumulated: number;
  hasIncome: boolean;
  ratios: Record<
    'generalExpense' | 'dailyExpense' | 'savings' | 'creditCard' | 'netCashFlow' | 'transferableSavings',
    number
  > | null;
}

interface BudgetHealthRow {
  id: keyof BudgetThresholds;
  label: string;
  kind: 'max' | 'min';
  amount: number;
  ratio: number;
  threshold: number;
  usage: number;
  status: 'ok' | 'near' | 'over' | 'critical' | 'on-target' | 'below-target';
  statusLabel: string;
  barPercent: number;
}

interface BudgetHealthResult {
  available: boolean;
  rows: BudgetHealthRow[];
  attentionCount: number;
  rollupMessage: string;
}

/** ฟิลด์ metadata ที่ไม่ใช่แถวรายจ่ายจริง — ใช้กรองก่อนวนลูป expenseData */
export const SUMMARY_IGNORED_KEYS: Set<string> = new Set([
  'totalActualPaid', 'accountSummary', 'bankAccounts',
  'month', '_id', 'id', 'userId', 'periodKey', '__removeKeys'
]);

/** เพดานงบประมาณเริ่มต้น (% ของรายรับ) — ผู้ใช้ปรับต่อคนได้ใน P4 (persist เป็น budgetThresholds บน user document) */
export const DEFAULT_BUDGET_THRESHOLDS: BudgetThresholds = Object.freeze({
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
// Object.keys()'s real return type is always string[], never (keyof T)[] — a well-known, standing
// TypeScript limitation. Every consumer of BUDGET_THRESHOLD_KEYS only ever reads it as a plain string
// array, so this cast is a pure type-level widening with zero runtime effect.
export const BUDGET_THRESHOLD_KEYS: (keyof BudgetThresholds)[] =
  Object.keys(DEFAULT_BUDGET_THRESHOLDS) as (keyof BudgetThresholds)[];

/**
 * รับค่า threshold ดิบ (ตัวเลข, numeric string, undefined/null, หรือค่าแปลกอื่น ๆ) หนึ่งคีย์
 * คืนค่าที่ปลอดภัยเสมอ — ไม่คืน NaN, ไม่ throw ไม่ว่า input จะเป็นอะไร
 */
function coerceThresholdValue(value: unknown, fallback: number): number {
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
export function normaliseBudgetThresholds(raw: unknown): BudgetThresholds {
  // 2 additional casts required by tsc, beyond the 2 anticipated in the spec (documented here per
  // AC-3's "if tsc genuinely requires one, document it explicitly" allowance):
  // - `raw as Record<string, unknown>`: the typeof/Array.isArray guard narrows `raw` (unknown) only to
  //   plain `object`, which has no index signature — `source[key]` needs a string-indexable type.
  // - `{} as BudgetThresholds`: `result` is built incrementally, one key at a time inside the
  //   `.forEach` below, so it cannot be inferred as a complete `BudgetThresholds` until after the loop
  //   finishes; the loop itself (`BUDGET_THRESHOLD_KEYS.forEach`) already guarantees every key gets
  //   written before `return result`, so this is a pure type-level widening, zero runtime effect —
  //   same category/justification as the other 2 documented casts.
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
  const result = {} as BudgetThresholds;
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
export const BUDGET_ROW_DEFS: BudgetRowDef[] = [
  { id: 'generalExpense', label: 'บิลและรายจ่าย', kind: 'max' },
  { id: 'dailyExpense', label: 'ค่าใช้จ่ายรายวัน', kind: 'max' },
  { id: 'creditCard', label: 'บัตรเครดิต', kind: 'max' },
  { id: 'savings', label: 'เงินออม', kind: 'min' }
];

/** แปลงค่าที่อาจมี comma (string) หรือเป็น number อยู่แล้ว → number เสมอ, ไม่ได้คืน 0 (ไม่ throw) */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * จำลอง parseFloat(a || b || ... || 0) แบบ unknown-safe — ใช้เฉพาะ computeTotalIncome เพื่อคง
 * semantics เดิมทุกประการ: ข้ามค่า falsy ใด ๆ (ไม่ใช่แค่ null/undefined เหมือน ??), และไม่ตัด NaN
 * ทิ้งก่อนเวลา (ค่า non-numeric string ที่ไม่ว่างต้องคืน NaN ให้ caller's Number.isFinite guard
 * จัดการเอง — ต่างจาก toNumber() ที่คืน 0 ทันที ซึ่งให้ผลลัพธ์ปลายทางต่างกันเมื่อ term อื่นในสูตร valid)
 */
function parseFloatOr(...values: unknown[]): number {
  let selected: unknown = 0;
  for (const value of values) {
    if (value) {
      selected = value;
      break;
    }
  }
  return typeof selected === 'number' ? selected : parseFloat(String(selected));
}

function parseYearFromMonth(monthKey: unknown): string {
  if (typeof monthKey !== 'string' || !/^\d{4}-\d{2}$/.test(monthKey)) {
    return String(new Date().getFullYear());
  }
  return monthKey.split('-')[0];
}

/**
 * รายรับรวม — เหมือนกับ branch เดิมใน getSummaryData (summaryUtils.js:21-26) ทุกประการ
 * เงินเดือนสุทธิ (net_income) ชนะเสมอถ้ามีค่า > 0 ไม่งั้น fallback ไปใช้ income.salary (E9)
 */
export function computeTotalIncome({ incomeData, salaryData }: { incomeData?: IncomeDataLike; salaryData?: SalaryDataLike } = {}): number {
  // เดิมใช้ parseFloat(a || b || 0) ตรง ๆ — เมื่อ field ต่าง ๆ ถูก type เป็น unknown แล้ว parseFloat(unknown)
  // ไม่ type-check ได้อีกต่อไป และ toNumber()/?? ที่เคยใช้แทนนั้น "ไม่เท่ากัน" กับ `|| 0` จริง ๆ:
  // (1) toNumber แปลง non-numeric string เป็น 0 ทันที แต่ต้นฉบับปล่อยให้ parseFloat คืน NaN แล้วให้
  //     Number.isFinite guard ด้านล่างจัดการทีหลัง — ผลลัพธ์กลางทางต่างกัน แม้ guard จะดักท้ายสุดก็ตาม
  //     (เพราะ NaN ที่ term หนึ่งยังคงปล่อยให้ term อื่นที่ valid ทำงานตามปกติ ต่างจาก toNumber ที่คืน 0
  //     ไปตั้งแต่ต้นและถูกใช้คำนวณต่อในสูตรจริง — พิสูจน์แล้วว่าให้ผลต่างกันจริงเมื่อ review รอบนี้)
  // (2) ?? ข้ามเฉพาะ null/undefined แต่ || ข้าม falsy ทุกชนิด (รวม 0/''/NaN) — คนละ semantics กัน
  // parseFloatOr(...) จำลอง parseFloat(a || b || ... || 0) แบบ unknown-safe ให้ตรงเดิมทุกกรณี
  const incomeTotalRaw = parseFloatOr(incomeData?.รวม);
  const incomeSalaryRaw = parseFloatOr(incomeData?.salary);

  // salaryData?.summary?.net_income / salaryData?.สรุป?.เงินได้สุทธิ — narrow ด้วย typeof + 'in' guard
  // (TS 4.9+ unlisted-property narrowing) แทน optional chaining ตรง ๆ บน unknown เพื่อไม่ต้อง cast
  const summary = salaryData?.summary;
  const netIncomeFromSummary = summary && typeof summary === 'object' && 'net_income' in summary
    ? summary.net_income
    : undefined;
  const summaryThai = salaryData?.สรุป;
  const netIncomeFromSummaryThai = summaryThai && typeof summaryThai === 'object' && 'เงินได้สุทธิ' in summaryThai
    ? summaryThai['เงินได้สุทธิ']
    : undefined;
  const salaryNetIncome = parseFloatOr(netIncomeFromSummary, netIncomeFromSummaryThai);

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
export function splitExpenseTotals(expenseData: ExpenseDataLike = {}): ExpenseSplitTotals {
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

    // typeof === 'object' guard narrows unknown -> object เท่านั้น ไม่ใช่ shape เฉพาะ จึงต้อง assert
    // เป็น ExpenseRowLike ตรงนี้ — pattern เดียวกับ summaryUtils.ts:53 ที่ใช้เหตุผลเดียวกันทุกประการ
    const row = value as ExpenseRowLike;

    const amount = toNumber(row.actual);
    rowCount += 1;

    if (isCreditCardRowKey(key)) {
      creditCard += amount;
      if (isInstallmentRowKey(key)) {
        creditCardInstallment += amount;
      } else {
        // isCreditCardRowKey ที่ไม่ใช่ installment คือยอดหมุนเวียนเสมอ (นิยามของ isCreditCardRowKey เอง)
        creditCardRevolving += amount;
      }
      if (!isPaidFlag(row.paid)) creditCardUnpaid += amount;
    } else {
      generalExpense += amount;
      generalRowCount += 1;
      if (!isPaidFlag(row.paid)) generalUnpaid += amount;
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
}: {
  month?: string;
  incomeData?: IncomeDataLike;
  expenseData?: ExpenseDataLike;
  savingsData?: SavingsDataLike;
  dailyExpenseData?: DailyExpenseDataLike;
  salaryData?: SalaryDataLike;
  taxData?: TaxDataLike;
  thresholds?: BudgetThresholds;
} = {}): MonthlySummaryModel {
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

function classifyMaxUsage(usage: number): { status: 'ok' | 'near' | 'over' | 'critical'; label: string } {
  if (usage < 0.8) return { status: 'ok', label: 'ปกติ' };
  if (usage < 1.0) return { status: 'near', label: 'ใกล้เกณฑ์' };
  if (usage < 1.2) return { status: 'over', label: 'เกินเกณฑ์' };
  return { status: 'critical', label: 'เกินเกณฑ์มาก' };
}

function classifyMinUsage(usage: number): { status: 'on-target' | 'below-target'; label: string } {
  return usage >= 1
    ? { status: 'on-target', label: 'ถึงเป้าหมาย' }
    : { status: 'below-target', label: 'ต่ำกว่าเป้าหมาย' };
}

/**
 * ประเมินสุขภาพงบประมาณ 4 แถว — pure, ไม่มี warning เมื่อยังไม่มีรายรับ
 */
export function evaluateBudgetHealth(model: MonthlySummaryModel | null | undefined, thresholds: BudgetThresholds = DEFAULT_BUDGET_THRESHOLDS): BudgetHealthResult {
  if (!model || !model.hasIncome || !model.ratios) {
    return {
      available: false,
      rows: [],
      attentionCount: 0,
      rollupMessage: 'ยังไม่มีข้อมูลรายรับสำหรับเดือนนี้'
    };
  }

  const amountByRow: Record<keyof BudgetThresholds, number> = {
    generalExpense: model.generalExpense,
    dailyExpense: model.dailyExpense,
    creditCard: model.creditCard,
    savings: model.savings
  };

  const rows: BudgetHealthRow[] = BUDGET_ROW_DEFS.map(({ id, label, kind }) => {
    const amount = amountByRow[id];
    // `!` non-null assertion required by tsc: the early-return guard above (`!model.ratios`) narrows
    // `model.ratios` at that point, but TS does not carry that narrowing into this `.map` callback
    // closure — the guard already guarantees `ratios` is non-null for every call reaching this line,
    // so this is a pure type-level assertion, zero runtime effect (same category as the 4 `as` casts
    // documented above).
    const ratio = model.ratios![id];
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
