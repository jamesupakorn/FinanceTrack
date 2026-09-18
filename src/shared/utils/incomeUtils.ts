// incomeUtils.ts
// ฟังก์ชันสำหรับ IncomeTable

export function formatIncomeForSave(
  editIncome: Record<string, number | string>,
  parseToNumber: (value: number | string) => number
): Record<string, number> {
  const numericIncome: Record<string, number> = {};
  Object.keys(editIncome).forEach(key => {
    numericIncome[key] = parseToNumber(editIncome[key]);
  });
  return numericIncome;
}
