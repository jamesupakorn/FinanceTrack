// expenseUtils.js
// ฟังก์ชันสำหรับ ExpenseTable

export function formatExpenseForSave(editExpense, parseToNumber) {
  const numericExpense = {};
  Object.keys(editExpense).forEach(item => {
    numericExpense[item] = {};
    Object.keys(editExpense[item]).forEach(field => {
      if (field === 'paid') {
        numericExpense[item][field] = !!editExpense[item][field];
      } else if (field === 'name') {
        numericExpense[item][field] = (editExpense[item][field] || '').trim();
      } else {
        numericExpense[item][field] = parseToNumber(editExpense[item][field]);
      }
    });
  });
  return numericExpense;
}

export function calculateExpenseTotal(editExpense, field, parseToNumber) {
  const values = Object.values(editExpense).map(item => parseToNumber(item?.[field]));
  return values.reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
}
