import { getMongoCollection, isJsonMode } from '../../../../lib/dataSource';
import { getUserData } from '../../../backend/data/userUtils.js';
import { getMonthlySummaryModel } from '../frontend/monthlySummary';
import { getUserCreditData } from './creditCardStore';
import { buildInstallmentExpenseRows, buildRevolvingExpenseRows } from './creditCardSync';

function amount(value) {
  const numeric = Number(value || 0);
  return (Number.isFinite(numeric) ? numeric : 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function getGoalSummary(goals = [], savingsDocs = []) {
  const activeGoals = goals.filter(goal => goal?.status !== 'abandoned' && goal?.status !== 'completed');
  return activeGoals.map(goal => {
    const name = String(goal.goalName || '').trim().toLowerCase();
    const current = savingsDocs.reduce((total, doc) => total + (doc?.savings_list || []).reduce((sum, item) => {
      const itemName = String(item?.savings_type || item?.รายการ || '').trim().toLowerCase();
      if (itemName !== name) return sum;
      return sum + (Number(String(item?.savings_amount ?? item?.จำนวนเงิน ?? 0).replace(/,/g, '')) || 0);
    }, 0), 0);
    const target = Number(goal.targetAmount) || 0;
    return { name: goal.goalName || 'เป้าหมายเงินออม', current, target, remaining: Math.max(0, target - current) };
  });
}

async function readMonthlyData(userId, monthKey) {
  const year = monthKey.slice(0, 4);
  if (isJsonMode()) {
    const income = getUserData('monthly_income.json', userId)?.[monthKey] || {};
    const expense = getUserData('monthly_expense.json', userId)?.[monthKey] || {};
    const savings = getUserData('savings.json', userId)?.[monthKey] || {};
    const salary = getUserData('salary.json', userId)?.[monthKey] || {};
    const dailyExpense = getUserData('daily_expenses.json', userId)?.[monthKey] || {};
    const tax = getUserData('tax_accumulated.json', userId)?.[year] || {};
    const goals = getUserData('savings-goals.json', userId)?.goals || [];
    const savingsDocs = Object.values(getUserData('savings.json', userId) || {});
    return { income, expense, savings, salary, dailyExpense, tax, goals, savingsDocs };
  }

  const [income, expense, savings, salary, dailyExpense, tax, savingsDocs, goals] = await Promise.all([
    getMongoCollection('monthly_income').then(collection => collection.findOne({ userId, month: monthKey })).catch(() => null),
    getMongoCollection('monthly_expense').then(collection => collection.findOne({ userId, month: monthKey })).catch(() => null),
    getMongoCollection('savings').then(collection => collection.findOne({ userId, month: monthKey })).catch(() => null),
    getMongoCollection('salary').then(collection => collection.findOne({ userId, month: monthKey })).catch(() => null),
    getMongoCollection('daily_expenses').then(collection => collection.findOne({ userId, month: monthKey })).catch(() => null),
    getMongoCollection('tax_accumulated').then(collection => collection.findOne({ userId, year })).catch(() => null),
    getMongoCollection('savings').then(collection => collection.find({ userId, month: { $exists: true } }).toArray()).catch(() => []),
    getMongoCollection('savingsGoals').then(collection => collection.find({ userId }).toArray()).catch(() => [])
  ]);
  return { income: income || {}, expense: expense || {}, savings: savings || {}, salary: salary || {}, dailyExpense: dailyExpense || {}, tax: tax || {}, goals, savingsDocs };
}

export async function buildMonthlySummaryPayload(userId, monthKey) {
  const data = await readMonthlyData(userId, monthKey);
  const creditData = await getUserCreditData(userId).catch(() => ({ cards: [], plans: [], cycles: [] }));
  const expenseData = {
    ...data.expense,
    ...buildInstallmentExpenseRows(creditData, monthKey),
    ...buildRevolvingExpenseRows(creditData, monthKey)
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
  return {
    model,
    taxAccumulated: Number(data.tax.accumulated_tax) || 0,
    goals: getGoalSummary(data.goals, data.savingsDocs)
  };
}

function textComponent(text, size = 'sm', color = '#f8fbff', weight = '400') {
  return { type: 'text', text: String(text || ' '), size, color, weight: weight === '700' ? 'bold' : 'regular', flex: 1, wrap: true };
}

function valueRow(icon, label, value, color = '#c7ccd6') {
  return {
    type: 'box', layout: 'horizontal', spacing: 'sm', margin: 'md', alignItems: 'center',
    contents: [textComponent(icon, 'sm', color, '700'), textComponent(label, 'sm', '#b7bdc9'), textComponent(`${amount(value)} บาท`, 'sm', '#f8fbff', '700')]
  };
}

export function buildMonthlySummaryFlex(monthLabel, payload) {
  const { model, taxAccumulated, goals } = payload;
  const netColor = model.netCashFlow >= 0 ? '#35d07f' : '#ff6b72';
  const goalContents = goals.length
    ? goals.slice(0, 4).flatMap(goal => [
      valueRow('🎯', goal.name, goal.current, '#8ac7ff'),
      valueRow(' ', 'คงเหลือ', goal.remaining, '#b7bdc9')
    ])
    : [textComponent('ยังไม่มีเป้าหมายเงินออมที่กำลังดำเนินการ', 'sm', '#8d95a3')];

  return {
    type: 'bubble', size: 'mega', styles: { body: { backgroundColor: '#121214' }, footer: { backgroundColor: '#18181b' } },
    body: {
      type: 'box', layout: 'vertical', paddingAll: 'xl', contents: [
        textComponent('FinanceTrack', 'sm', '#8ac7ff', '700'),
        textComponent('สรุปการเงินประจำเดือน', 'xl', '#f8fbff', '700'),
        textComponent(monthLabel, 'sm', '#9aa2b1'),
        { type: 'box', layout: 'vertical', margin: 'xl', paddingAll: 'lg', backgroundColor: '#1d2b24', cornerRadius: 'md', contents: [
          textComponent('กระแสเงินสดสุทธิ', 'sm', '#b7bdc9'),
          textComponent(`${model.netCashFlow >= 0 ? '+' : '-'}${amount(Math.abs(model.netCashFlow))} บาท`, 'xxl', netColor, '700')
        ] },
        { type: 'separator', margin: 'xl', color: '#2e2e33' },
        valueRow('💰', 'รายรับ', model.totalIncome),
        valueRow('🔴', 'รายจ่ายทั่วไป', model.generalExpense, '#ff858b'),
        valueRow('🟡', 'รายจ่ายประจำวัน', model.dailyExpense, '#ffd166'),
        valueRow('🟢', 'เงินออม', model.savings, '#35d07f'),
        valueRow('💳', 'บัตรเครดิต', model.creditCard, '#8ac7ff'),
        { type: 'separator', margin: 'xl', color: '#2e2e33' },
        textComponent('🧾 ภาษีสะสม', 'md', '#f8fbff', '700'),
        valueRow('', 'ยอดสะสม', taxAccumulated),
        textComponent('🎯 เป้าหมายเงินออม', 'md', '#f8fbff', '700'),
        ...goalContents
      ]
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        { type: 'button', style: 'primary', color: '#3d8bfd', action: { type: 'uri', label: 'เปิด FinanceTrack', uri: 'https://finance-track-one.vercel.app/' } }
      ]
    }
  };
}

export function formatMonthlySummaryText(monthLabel, payload) {
  const { model, taxAccumulated, goals } = payload;
  const goalText = goals.length ? goals.map(goal => `${goal.name}: คงเหลือ ${amount(goal.remaining)} บาท`).join('\n') : 'ยังไม่มีเป้าหมายเงินออม';
  return [
    `📊 สรุปการเงินประจำเดือน ${monthLabel}`,
    `กระแสเงินสดสุทธิ: ${model.netCashFlow >= 0 ? '+' : '-'}${amount(Math.abs(model.netCashFlow))} บาท`,
    `รายรับ: ${amount(model.totalIncome)} บาท`,
    `รายจ่ายทั่วไป: ${amount(model.generalExpense)} บาท`,
    `รายจ่ายประจำวัน: ${amount(model.dailyExpense)} บาท`,
    `เงินออม: ${amount(model.savings)} บาท`,
    `บัตรเครดิต: ${amount(model.creditCard)} บาท`,
    `ภาษีสะสม: ${amount(taxAccumulated)} บาท`,
    `เป้าหมายเงินออม:\n${goalText}`
  ].join('\n');
}