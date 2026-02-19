// expenseUtils.js
// ฟังก์ชันสำหรับ ExpenseTable

import { isPaidFlag } from './commonUtils';

function parseExpenseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function shouldSkipCustomExpenseItem(key, item = {}) {
  if (!String(key || '').startsWith('custom_')) return false;
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  const estimate = parseExpenseNumber(item.estimate);
  const actual = parseExpenseNumber(item.actual);
  const dueDay = item.dueDay == null ? '' : String(item.dueDay).trim();
  const paid = isPaidFlag(item.paid);
  return (!name || name === 'รายการใหม่') && estimate === 0 && actual === 0 && dueDay === '' && !paid;
}

export function formatExpenseForSave(editExpense, parseToNumber) {
  const numericExpense = {};
  Object.keys(editExpense).forEach(item => {
    if (shouldSkipCustomExpenseItem(item, editExpense[item])) {
      return;
    }
    numericExpense[item] = {};
    Object.keys(editExpense[item]).forEach(field => {
      if (field === 'paid') {
        numericExpense[item][field] = !!editExpense[item][field];
      } else if (field === 'name') {
        numericExpense[item][field] = (editExpense[item][field] || '').trim();
      } else if (field === 'dueDay') {
        const raw = String(editExpense[item][field] ?? '').trim();
        const parsed = parseInt(raw, 10);
        if (Number.isNaN(parsed)) {
          numericExpense[item][field] = '';
        } else {
          numericExpense[item][field] = Math.min(31, Math.max(1, parsed));
        }
      } else if (field === 'dueDate') {
        // เลิกใช้ dueDate แล้ว (ใช้ dueDay แทน)
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
