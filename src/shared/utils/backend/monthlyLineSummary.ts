import type { Document } from 'mongodb';
import { getMongoCollection, isJsonMode } from '../../../../lib/dataSource';
import { getUserData } from '../../../backend/data/userUtils';
import { getMonthlySummaryModel } from '../frontend/monthlySummary';
import { getUserCreditData } from './creditCardStore';
import type { CreditData } from './creditCardStore';
import { buildCardTotalExpenseRows } from './creditCardSync';
import { formatIsoDateTH } from '../creditCardBasics';
import {
  computeDelta,
  computeGoalProgress,
  formatDeltaLabel,
  buildUpcomingDues,
  getPrevMonthKey,
  getNextMonthKey
} from './monthlySummaryContent';
import { LINE_THEME, textComponent, valueRow as sharedValueRow } from './lineFlexTheme';
import type { MetricDelta, UpcomingDues } from './monthlySummaryContent';

type MonthlyModel = ReturnType<typeof getMonthlySummaryModel>;
type MonthlyModelInput = NonNullable<Parameters<typeof getMonthlySummaryModel>[0]>;
type SummaryGoal = {
  name: string;
  current: number;
  target: number;
  remaining: number;
  progress?: number;
};
type SummaryComparison = { income?: MetricDelta; expense?: MetricDelta; savings?: MetricDelta };
type SummaryPayload = {
  model: Pick<MonthlyModel, 'netCashFlow' | 'totalIncome' | 'generalExpense' | 'dailyExpense' | 'savings' | 'creditCard'>;
  taxAccumulated: number;
  goals: SummaryGoal[];
  comparison?: SummaryComparison;
  upcoming?: UpcomingDues | null;
};
type StoredGoal = Document & { goalName?: string; targetAmount?: number | string; status?: string };
type TaxDocument = Document & { year?: string; accumulated_tax?: number | string };
type SavingsDocument = {
  savings_list?: Array<{
    savings_type?: string;
    รายการ?: string;
    savings_amount?: number | string;
    จำนวนเงิน?: number | string;
  }>;
  [key: string]: unknown;
};
type MonthlyData = {
  income: Record<string, unknown>;
  expense: Record<string, unknown>;
  savings: SavingsDocument;
  salary: Record<string, unknown>;
  dailyExpense: NonNullable<MonthlyModelInput['dailyExpenseData']>;
  tax: { year?: string; accumulated_tax?: number | string };
  goals: StoredGoal[];
  savingsDocs: SavingsDocument[];
};

function amount(value: unknown): string {
  const numeric = Number(value || 0);
  return (Number.isFinite(numeric) ? numeric : 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function getGoalSummary(goals: StoredGoal[] = [], savingsDocs: SavingsDocument[] = []): SummaryGoal[] {
  const activeGoals = goals.filter(goal => goal?.status !== 'abandoned' && goal?.status !== 'completed');
  return activeGoals.map(goal => {
    const name = String(goal.goalName || '').trim().toLowerCase();
    const current = savingsDocs.reduce((total, doc) => total + (doc?.savings_list || []).reduce((sum, item) => {
      const itemName = String(item?.savings_type || item?.รายการ || '').trim().toLowerCase();
      if (itemName !== name) return sum;
      return sum + (Number(String(item?.savings_amount ?? item?.จำนวนเงิน ?? 0).replace(/,/g, '')) || 0);
    }, 0), 0);
    const target = Number(goal.targetAmount) || 0;
    return {
      name: goal.goalName || 'เป้าหมายเงินออม',
      current,
      target,
      remaining: Math.max(0, target - current),
      progress: computeGoalProgress(current, target)
    };
  });
}

async function readMonthlyData(userId: string, monthKey: string): Promise<MonthlyData> {
  const year = monthKey.slice(0, 4);
  if (isJsonMode()) {
    const income = getUserData('monthly_income.json', userId)?.[monthKey] || {};
    const expense = getUserData('monthly_expense.json', userId)?.[monthKey] || {};
    const savings = getUserData('savings.json', userId)?.[monthKey] || {};
    const salary = getUserData('salary.json', userId)?.[monthKey] || {};
    const dailyExpense = getUserData('daily_expenses.json', userId)?.[monthKey] || {};
    const tax = getUserData('tax_accumulated.json', userId)?.[year] || {};
    const goals = getUserData('savings-goals.json', userId)?.goals || [];
    const savingsDocs = Object.values(getUserData('savings.json', userId) || {}) as SavingsDocument[];
    return { income, expense, savings, salary, dailyExpense, tax, goals, savingsDocs };
  }

  const [income, expense, savings, salary, dailyExpense, tax, savingsDocs, goals] = await Promise.all([
    getMongoCollection('monthly_income').then(collection => collection.findOne({ userId, month: monthKey })).catch(() => null),
    getMongoCollection('monthly_expense').then(collection => collection.findOne({ userId, month: monthKey })).catch(() => null),
    getMongoCollection('savings').then(collection => collection.findOne({ userId, month: monthKey })).catch(() => null),
    getMongoCollection('salary').then(collection => collection.findOne({ userId, month: monthKey })).catch(() => null),
    getMongoCollection('daily_expenses').then(collection => collection.findOne({ userId, month: monthKey })).catch(() => null),
    getMongoCollection<TaxDocument>('tax_accumulated').then(collection => collection.findOne({ userId, year })).catch(() => null),
    getMongoCollection('savings').then(collection => collection.find({ userId, month: { $exists: true } }).toArray()).catch(() => []),
    getMongoCollection<StoredGoal>('savingsGoals').then(collection => collection.find({ userId }).toArray()).catch(() => [])
  ]);
  return { income: income || {}, expense: expense || {}, savings: savings || {}, salary: salary || {}, dailyExpense: dailyExpense || {}, tax: (tax || {}) as MonthlyData['tax'], goals, savingsDocs };
}

const hasMonthData = (data: MonthlyData): boolean => (['income', 'expense', 'savings', 'dailyExpense'] as const)
  .some(key => data[key] && Object.keys(data[key]).length > 0);

async function buildMonthModel(userId: string, monthKey: string, creditData: Pick<CreditData, 'cards' | 'plans' | 'cycles' | 'spendItems'>) {
  const data = await readMonthlyData(userId, monthKey);
  const expenseData = {
    ...data.expense,
    // แถวยอดรวมบัตรเท่านั้น (งวดผ่อน + ยอดหมุนเวียน ในแถว ccr_ เดียว) — ห้ามเพิ่มแถวงวดผ่อนแยกอีก
    // มิฉะนั้นงวดผ่อนถูกนับซ้ำในสรุป LINE (spec-credit-card-spend R1 / AC-S18)
    ...buildCardTotalExpenseRows(creditData, monthKey)
  };
  const model = getMonthlySummaryModel({
    month: monthKey,
    incomeData: data.income,
    expenseData,
    savingsData: data.savings,
    dailyExpenseData: data.dailyExpense,
    salaryData: data.salary,
    taxData: { [data.tax.year || monthKey.slice(0, 4)]: data.tax }
  });
  return { data, model, expenseData };
}

// รายจ่ายรวม = รายจ่ายทั่วไป + รายวัน + บัตรเครดิต (ไม่รวมเงินออม ซึ่งเทียบแยกอีกแถว)
const totalExpenseOf = (model: MonthlyModel): number => Math.round((model.generalExpense + model.dailyExpense + model.creditCard) * 100) / 100;

export async function buildMonthlySummaryPayload(userId: string, monthKey: string) {
  const creditData = await getUserCreditData(userId).catch(() => ({ cards: [], plans: [], cycles: [], spendItems: [] }));
  const { data, model } = await buildMonthModel(userId, monthKey, creditData);
  const prev = await buildMonthModel(userId, getPrevMonthKey(monthKey), creditData);
  const hasPrevious = hasMonthData(prev.data);
  const nextKey = getNextMonthKey(monthKey);
  const next = await buildMonthModel(userId, nextKey, creditData);

  return {
    model,
    taxAccumulated: Number(data.tax.accumulated_tax) || 0,
    goals: getGoalSummary(data.goals, data.savingsDocs),
    comparison: {
      income: computeDelta(model.totalIncome, prev.model.totalIncome, hasPrevious),
      expense: computeDelta(totalExpenseOf(model), totalExpenseOf(prev.model), hasPrevious),
      savings: computeDelta(model.savings, prev.model.savings, hasPrevious)
    },
    upcoming: buildUpcomingDues(Object.keys(next.expenseData).length ? next.expenseData : null, nextKey)
  };
}

// textComponent/valueRow มาจากโมดูลกลาง (AC-1) — valueRow รับค่าที่ format เป็น string แล้วเท่านั้น
// (AC-3: ห้าม unify amount() กับ formatAmount() ของ line_due_notify.js) จึงต้องห่อ amount(value) ที่ call site
function valueRow(icon: string, label: string, value: unknown, color = LINE_THEME.textSecondary) {
  return sharedValueRow(icon, label, `${amount(value)} บาท`, color);
}

function deltaRow(delta: MetricDelta | undefined, prefix = '') {
  if (!delta) return [];
  return [textComponent(`${prefix}${formatDeltaLabel(delta)}`, 'xs', LINE_THEME.textSecondary)];
}

function expenseDeltaRow(comparison: SummaryComparison | undefined) {
  if (!comparison?.expense) return [];
  return deltaRow(comparison.expense, `รายจ่ายรวม ${amount(comparison.expense.current)} บาท · `);
}

// ป้ายวันครบกำหนด: อยู่ในเดือน upcoming → "วันที่ N" เหมือนเดิม · แถวบัตรข้ามเดือน → วันที่เต็ม เช่น "10 พ.ย. 2569"
function upcomingDueLabel(item: UpcomingDues['items'][number], monthKey: string): string {
  if (typeof item.dueDate === 'string' && item.dueDate.slice(0, 7) !== monthKey) {
    const full = formatIsoDateTH(item.dueDate);
    if (full) return full;
  }
  return `วันที่ ${item.day}`;
}

function upcomingSection(upcoming: UpcomingDues | null | undefined) {
  if (!upcoming) return [];
  return [
    textComponent('📅 ต้องจ่ายเดือนหน้า', 'md', LINE_THEME.textPrimary, '700'),
    ...upcoming.items.map(item => textComponent(`${item.name} — ${amount(item.amount)} บาท (${upcomingDueLabel(item, upcoming.monthKey)})`, 'sm', LINE_THEME.textSecondary)),
    ...(upcoming.extraCount > 0 ? [textComponent(`และอีก ${upcoming.extraCount} รายการ`, 'xs', LINE_THEME.textSecondary)] : [])
  ];
}

export function buildMonthlySummaryFlex(monthLabel: string, payload: SummaryPayload) {
  const { model, taxAccumulated, goals, comparison, upcoming } = payload;
  const isPositiveNet = model.netCashFlow >= 0;
  const netColor = isPositiveNet ? LINE_THEME.success : LINE_THEME.danger;
  const netTint = isPositiveNet ? LINE_THEME.tintSuccess : LINE_THEME.tintDanger;
  const goalContents = goals.length
    ? goals.slice(0, 4).flatMap(goal => [
      valueRow('🎯', goal.name, goal.current, LINE_THEME.info),
      valueRow(' ', 'คงเหลือ', goal.remaining, LINE_THEME.textSecondary),
      ...(goal.progress === undefined ? [] : [textComponent(`ถึงเป้าแล้ว ${goal.progress}%`, 'xs', LINE_THEME.info)])
    ])
    : [textComponent('ยังไม่มีเป้าหมายเงินออมที่กำลังดำเนินการ', 'sm', LINE_THEME.textSecondary)];

  return {
    type: 'bubble', size: 'mega', styles: { body: { backgroundColor: LINE_THEME.surface }, footer: { backgroundColor: LINE_THEME.surfaceFooter } },
    body: {
      type: 'box', layout: 'vertical', paddingAll: 'xl', contents: [
        textComponent('FinanceTrack', 'sm', LINE_THEME.brand, '700'),
        textComponent('สรุปการเงินประจำเดือน', 'xl', LINE_THEME.textPrimary, '700'),
        textComponent(monthLabel, 'sm', LINE_THEME.textSecondary),
        { type: 'box', layout: 'vertical', margin: 'xl', paddingAll: 'lg', backgroundColor: netTint, cornerRadius: 'md', contents: [
          textComponent('กระแสเงินสดสุทธิ', 'sm', LINE_THEME.textSecondary),
          textComponent(`${isPositiveNet ? '+' : '-'}${amount(Math.abs(model.netCashFlow))} บาท`, 'xxl', netColor, '700')
        ] },
        { type: 'separator', margin: 'xl', color: LINE_THEME.separator },
        valueRow('💰', 'รายรับ', model.totalIncome),
        ...deltaRow(comparison?.income),
        valueRow('🔴', 'รายจ่ายทั่วไป', model.generalExpense, LINE_THEME.danger),
        valueRow('🟡', 'รายจ่ายประจำวัน', model.dailyExpense, LINE_THEME.warning),
        valueRow('🟢', 'เงินออม', model.savings, LINE_THEME.success),
        ...deltaRow(comparison?.savings),
        ...expenseDeltaRow(comparison),
        valueRow('💳', 'บัตรเครดิต', model.creditCard, LINE_THEME.info),
        { type: 'separator', margin: 'xl', color: LINE_THEME.separator },
        textComponent('🧾 ภาษีสะสม', 'md', LINE_THEME.textPrimary, '700'),
        valueRow('', 'ยอดสะสม', taxAccumulated),
        textComponent('🎯 เป้าหมายเงินออม', 'md', LINE_THEME.textPrimary, '700'),
        ...goalContents,
        ...upcomingSection(upcoming)
      ]
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        { type: 'button', style: 'primary', color: LINE_THEME.brand, action: { type: 'uri', label: 'เปิด FinanceTrack', uri: 'https://finance-track-one.vercel.app/' } }
      ]
    }
  };
}

export function formatMonthlySummaryText(monthLabel: string, payload: SummaryPayload): string {
  const { model, taxAccumulated, goals, comparison, upcoming } = payload;
  const goalText = goals.length
    ? goals.map(goal => `${goal.name}: คงเหลือ ${amount(goal.remaining)} บาท${goal.progress === undefined ? '' : ` (ถึงเป้าแล้ว ${goal.progress}%)`}`).join('\n')
    : 'ยังไม่มีเป้าหมายเงินออม';
  const withDelta = (line: string, delta: MetricDelta | undefined) => (delta ? `${line} · ${formatDeltaLabel(delta)}` : line);
  const lines = [
    `📊 สรุปการเงินประจำเดือน ${monthLabel}`,
    `กระแสเงินสดสุทธิ: ${model.netCashFlow >= 0 ? '+' : '-'}${amount(Math.abs(model.netCashFlow))} บาท`,
    withDelta(`รายรับ: ${amount(model.totalIncome)} บาท`, comparison?.income),
    `รายจ่ายทั่วไป: ${amount(model.generalExpense)} บาท`,
    `รายจ่ายประจำวัน: ${amount(model.dailyExpense)} บาท`,
    withDelta(`เงินออม: ${amount(model.savings)} บาท`, comparison?.savings),
    `บัตรเครดิต: ${amount(model.creditCard)} บาท`
  ];
  if (comparison?.expense) {
    lines.push(withDelta(`รายจ่ายรวม: ${amount(comparison.expense.current)} บาท`, comparison.expense));
  }
  lines.push(`ภาษีสะสม: ${amount(taxAccumulated)} บาท`, `เป้าหมายเงินออม:\n${goalText}`);
  if (upcoming) {
    lines.push(
      '📅 ต้องจ่ายเดือนหน้า:',
      ...upcoming.items.map(item => `- ${item.name}: ${amount(item.amount)} บาท (${upcomingDueLabel(item, upcoming.monthKey)})`),
      ...(upcoming.extraCount > 0 ? [`และอีก ${upcoming.extraCount} รายการ`] : [])
    );
  }
  return lines.join('\n');
}
