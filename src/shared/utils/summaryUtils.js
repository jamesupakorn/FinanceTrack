// summaryUtils.js
// รวมฟังก์ชันคำนวณ summary และ chart สำหรับ SummaryReport

export function getSummaryData({ incomeData, expenseData, savingsData, taxData, salaryData, currentMonth, currentYear }) {
  const totalIncome = parseFloat(incomeData.รวม || 0);
  const totalExpenseAll = parseFloat(expenseData.totalEstimate || 0);
  const totalExpenseActual = parseFloat(expenseData.totalActualPaid || 0);
  const totalSavings = parseFloat(savingsData.รวมเงินเก็บ || 0);
  const taxAccumulated = parseFloat(taxData[currentYear]?.accumulated_tax || 0);
  const remainingRough = totalIncome - totalExpenseAll;
  const remainingActual = totalIncome - totalExpenseActual;
  return {
    ยอดรวมรายรับรายเดือน: totalIncome,
    ยอดรวมค่าใช้จ่ายรายเดือน_ทั้งหมด: totalExpenseAll,
    ยอดรวมค่าใช้จ่ายรายเดือน_จ่ายจริง: totalExpenseActual,
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
