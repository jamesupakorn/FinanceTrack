// summaryUtils.js
// รวมฟังก์ชันคำนวณ summary และ chart สำหรับ SummaryReport

import { isPaidFlag } from '../commonUtils';
import { computeTotalIncome } from './monthlySummary';

const META_FIELDS = new Set(['totalActualPaid', 'accountSummary', 'month', '_id', '__removeKeys']);

const getUnpaidTotal = (expenseData = {}) => {
  let total = 0;
  Object.entries(expenseData || {}).forEach(([key, value]) => {
    if (META_FIELDS.has(key)) return;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (!isPaidFlag(value.paid)) {
      total += parseFloat(value.actual || 0);
    }
  });
  return total;
};

export function getSummaryData({ incomeData, expenseData, savingsData, taxData, salaryData, currentMonth, currentYear }) {
  // รายรับรวม: ย้ายไปเป็น computeTotalIncome ใน monthlySummary.js (P1 · shell-navigation) —
  // ตรรกะเดิมทุกประการ ผลลัพธ์จึง byte-identical (AC-SH-6)
  const totalIncome = computeTotalIncome({ incomeData, salaryData });
  const totalExpenseActual = parseFloat(expenseData.totalActualPaid || 0);
  const totalExpenseUnpaid = getUnpaidTotal(expenseData);
  const totalSavings = parseFloat(savingsData.รวมเงินเก็บ || 0);
  const taxAccumulated = parseFloat(taxData[currentYear]?.accumulated_tax || 0);
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

export function getChartData({ totalIncome, totalExpenseActual }) {
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
