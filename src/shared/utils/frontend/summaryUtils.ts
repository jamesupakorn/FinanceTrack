// summaryUtils.ts
// รวมฟังก์ชันคำนวณ summary และ chart สำหรับ SummaryReport

import { isPaidFlag } from '../commonUtils';
import { computeTotalIncome } from './monthlySummary';

interface ExpenseRowLike {
  paid?: unknown;
  actual?: unknown;
}

interface SummaryDataInput {
  incomeData?: Record<string, unknown>;
  expenseData: Record<string, unknown>;
  savingsData: Record<string, unknown>;
  taxData: Record<string, Record<string, unknown>>;
  salaryData?: Record<string, unknown>;
  currentMonth?: string;
  currentYear: string;
}

interface SummaryData {
  ยอดรวมรายรับรายเดือน: number;
  ยอดรวมค่าใช้จ่ายรายเดือน_ทั้งหมด: number;
  ยอดรวมค่าใช้จ่ายรายเดือน_จ่ายจริง: number;
  ยอดรวมค่าใช้จ่ายรายเดือน_ยังไม่ชำระ: number;
  ยอดรวมเงินเก็บรายเดือน: number;
  ภาษีสะสมตั้งแต่เดือนแรก: number;
  ยอดเงินคงเหลือ: number;
}

interface ChartDataInput {
  totalIncome: number;
  totalExpenseActual: number;
}

interface ChartData {
  จ่ายจริง: {
    รับ: number;
    จ่าย: number;
    เปอร์เซ็นต์รับ: number;
    เปอร์เซ็นต์จ่าย: number;
  };
}

const META_FIELDS = new Set(['totalActualPaid', 'accountSummary', 'month', '_id', '__removeKeys']);

const getUnpaidTotal = (expenseData: Record<string, unknown> = {}): number => {
  let total = 0;
  Object.entries(expenseData || {}).forEach(([key, value]) => {
    if (META_FIELDS.has(key)) return;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const row = value as ExpenseRowLike;
    if (!isPaidFlag(row.paid)) {
      total += parseFloat(String(row.actual || 0));
    }
  });
  return total;
};

export function getSummaryData(input: SummaryDataInput): SummaryData {
  const { incomeData, expenseData, savingsData, taxData, salaryData, currentMonth, currentYear } = input;
  // รายรับรวม: ย้ายไปเป็น computeTotalIncome ใน monthlySummary.js (P1 · shell-navigation) —
  // ตรรกะเดิมทุกประการ ผลลัพธ์จึง byte-identical (AC-SH-6)
  const totalIncome = computeTotalIncome({ incomeData, salaryData });
  const totalExpenseActual = parseFloat(String(expenseData.totalActualPaid || 0));
  const totalExpenseUnpaid = getUnpaidTotal(expenseData);
  const totalSavings = parseFloat(String(savingsData['รวมเงินเก็บ'] || 0));
  const taxAccumulated = parseFloat(String(taxData[currentYear]?.accumulated_tax || 0));
  const remaining = totalIncome - totalExpenseActual;
  return {
    ยอดรวมรายรับรายเดือน: totalIncome,
    ยอดรวมค่าใช้จ่ายรายเดือน_ทั้งหมด: totalExpenseActual,
    ยอดรวมค่าใช้จ่ายรายเดือน_จ่ายจริง: totalExpenseActual,
    ยอดรวมค่าใช้จ่ายรายเดือน_ยังไม่ชำระ: totalExpenseUnpaid,
    ยอดรวมเงินเก็บรายเดือน: totalSavings,
    ภาษีสะสมตั้งแต่เดือนแรก: taxAccumulated,
    ยอดเงินคงเหลือ: remaining
  };
}

export function getChartData({ totalIncome, totalExpenseActual }: ChartDataInput): ChartData {
  const totalActual = totalIncome + totalExpenseActual;
  return {
    จ่ายจริง: {
      รับ: totalIncome,
      จ่าย: totalExpenseActual,
      เปอร์เซ็นต์รับ: totalActual > 0 ? Math.round((totalIncome / totalActual) * 100) : 0,
      เปอร์เซ็นต์จ่าย: totalActual > 0 ? Math.round((totalExpenseActual / totalActual) * 100) : 0
    }
  };
}
