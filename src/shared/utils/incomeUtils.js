// incomeUtils.js
// ฟังก์ชันสำหรับ IncomeTable

export function formatIncomeForSave(editIncome, parseToNumber) {
  const numericIncome = {};
  Object.keys(editIncome).forEach(key => {
    numericIncome[key] = parseToNumber(editIncome[key]);
  });
  return numericIncome;
}

export function calculateIncomeTotal(editIncome, salaryNetIncome) {
  let total = 0;
  Object.keys(editIncome).forEach(key => {
    total += parseFloat(editIncome[key]) || 0;
  });
  total += parseFloat(salaryNetIncome) || 0;
  return total;
}
