// incomeUtils.js
// ฟังก์ชันสำหรับ IncomeTable

export function formatIncomeForSave(editIncome, parseToNumber) {
  const numericIncome = {};
  Object.keys(editIncome).forEach(key => {
    numericIncome[key] = parseToNumber(editIncome[key]);
  });
  return numericIncome;
}
