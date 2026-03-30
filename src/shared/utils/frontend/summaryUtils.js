// summaryUtils.js
// รวมฟังก์ชันคำนวณ summary และ chart สำหรับ SummaryReport

import { isPaidFlag } from '../commonUtils';

const META_FIELDS = new Set(['totalEstimate', 'totalActualPaid', 'accountSummary', 'month', '_id', '__removeKeys']);

const getUnpaidEstimateTotal = (expenseData = {}) => {
  let total = 0;
  Object.entries(expenseData || {}).forEach(([key, value]) => {
    if (META_FIELDS.has(key)) return;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (!isPaidFlag(value.paid)) {
      total += parseFloat(value.estimate || 0);
    }
  });
  return total;
};

export function getSummaryData({ incomeData, expenseData, savingsData, taxData, salaryData, currentMonth, currentYear }) {
  const incomeTotalRaw = parseFloat(incomeData?.รวม || 0);
  const incomeSalaryRaw = parseFloat(incomeData?.salary || 0);
  const salaryNetIncome = parseFloat(salaryData?.summary?.net_income || salaryData?.สรุป?.เงินได้สุทธิ || 0);
  const nonSalaryIncome = incomeTotalRaw - (Number.isFinite(incomeSalaryRaw) ? incomeSalaryRaw : 0);
  const totalIncome = (Number.isFinite(salaryNetIncome) && salaryNetIncome > 0 ? salaryNetIncome : incomeSalaryRaw || 0)
    + (Number.isFinite(nonSalaryIncome) ? nonSalaryIncome : 0);
  const totalExpenseAll = parseFloat(expenseData.totalEstimate || 0);
  const totalExpenseActual = parseFloat(expenseData.totalActualPaid || 0);
  const totalExpenseUnpaidEstimate = getUnpaidEstimateTotal(expenseData);
  const totalSavings = parseFloat(savingsData.รวมเงินเก็บ || 0);
  const taxAccumulated = parseFloat(taxData[currentYear]?.accumulated_tax || 0);
  const remainingRough = totalIncome - totalExpenseUnpaidEstimate;
  const remainingActual = totalIncome - totalExpenseActual;
  return {
    ยอดรวมรายรับรายเดือน: totalIncome,
    ยอดรวมค่าใช้จ่ายรายเดือน_ทั้งหมด: totalExpenseAll,
    ยอดรวมค่าใช้จ่ายรายเดือน_จ่ายจริง: totalExpenseActual,
    ยอดรวมค่าใช้จ่ายรายเดือน_ยังไม่ชำระ_ประมาณการ: totalExpenseUnpaidEstimate,
    ยอดรวมเงินเก็บรายเดือน: totalSavings,
    ภาษีสะสมตั้งแต่เดือนแรก: taxAccumulated,
    ยอดเงินคงเหลือ_ประมาณการ: remainingRough,
    ยอดเงินคงเหลือ_จริง: remainingActual
  };
}

export function getChartData({ totalIncome, totalExpenseAll, totalExpenseActual }) {
  const totalEstimated = totalIncome + totalExpenseAll;
  const totalActual = totalIncome + totalExpenseActual;
  return {
    ประมาณการ: {
      รับ: totalIncome,
      จ่าย: totalExpenseAll,
      เปอร์เซ็นต์รับ: totalEstimated > 0 ? Math.round((totalIncome / totalEstimated) * 100) : 0,
      เปอร์เซ็นต์จ่าย: totalEstimated > 0 ? Math.round((totalExpenseAll / totalEstimated) * 100) : 0
    },
    จ่ายจริง: {
      รับ: totalIncome,
      จ่าย: totalExpenseActual,
      เปอร์เซ็นต์รับ: totalActual > 0 ? Math.round((totalIncome / totalActual) * 100) : 0,
      เปอร์เซ็นต์จ่าย: totalActual > 0 ? Math.round((totalExpenseActual / totalActual) * 100) : 0
    }
  };
}
