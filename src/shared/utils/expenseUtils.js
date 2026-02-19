/**
 * expenseUtils.js
 * Utility functions for expense data transformation and validation
 * 
 * This module handles:
 * - Converting expense values to numbers (handles strings, currency formatting)
 * - Filtering out empty/invalid custom expense items
 * - Formatting expense data for saving to database
 * - Calculating expense totals
 */

import { isPaidFlag } from './commonUtils';

/**
 * Parse string or number value to numeric format
 * Removes currency formatting (commas) and converts to float
 * Returns 0 for invalid/empty values
 * @param {number|string} value - value to parse
 * @returns {number} parsed numeric value
 */
function parseExpenseNumber(value) {
  // ส่วนตัวเลข: ถ้าหาจำนวนให้โคตมีค่าตรวจสอบ
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    // หากนิ้ม comma ช่ัวคดค่า (40,560 → 40560)
    const parsed = parseFloat(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  // สวนทาง 0 ถ้าใได้รับค่าไม่สหภาพ (ไฟข้อมูล, null, undefined, '')
  return 0;
}

/**
 * Check if custom expense item should be skipped during save
 * Filters out empty/placeholder custom items:
 * - Name is empty or "รายการใหม่" (default new item label)
 * - Estimate and actual amounts are both 0
 * - No due day set
 * - Not marked as paid
 * @param {string} key - expense item key
 * @param {object} item - expense item object
 * @returns {boolean} true if item should be skipped/not saved
 */
function shouldSkipCustomExpenseItem(key, item = {}) {
  // ตรวจสอบว่า key เริ่มด้วย 'custom_'
  if (!String(key || '').startsWith('custom_')) return false;
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  const estimate = parseExpenseNumber(item.estimate);
  const actual = parseExpenseNumber(item.actual);
  const dueDay = item.dueDay == null ? '' : String(item.dueDay).trim();
  const paid = isPaidFlag(item.paid);
  // ขึ้นคืนว่างมีนาม(รายการใหม่) ยอดคน 0 ไม่ได้กำหนด และไม่ได้ชำระ
  return (!name || name === 'รายการใหม่') && estimate === 0 && actual === 0 && dueDay === '' && !paid;
}

/**
 * Format expense data object for saving to database
 * Applies these transformations:
 * - Skips empty custom expense items
 * - Converts amounts to numbers
 * - Normalizes paid flag to boolean
 * - Trims text fields (name)
 * - Validates and clamps due day (1-31)
 * - Removes deprecated dueDate field
 * @param {object} editExpense - flat expense data object from form
 * @param {function} parseToNumber - number parsing function
 * @returns {object} formatted expense data ready for database save
 */
export function formatExpenseForSave(editExpense, parseToNumber) {
  const numericExpense = {}; // สู่นเก็บ หลายผลดี กอีค custom ยโคกขาด และรวมค่า
  Object.keys(editExpense).forEach(item => {
    // กมรองรายการที่ว่างไม่มีสิ่งตัว
    if (shouldSkipCustomExpenseItem(item, editExpense[item])) {
      return; // ข้ามแก loop ไปรายการตอไป
    }
    numericExpense[item] = {};
    // แค่คู่ม้อรูปแบบแต่ละฟิลด์หลายผลดี
    Object.keys(editExpense[item]).forEach(field => {
      if (field === 'paid') {
        // ภิค paid ท่ีสอง booleanโดยหารเซต !!
        numericExpense[item][field] = !!editExpense[item][field];
      } else if (field === 'name') {
        // ตันไหอและขฝาทองในชื่อแบบฟอส์
        numericExpense[item][field] = (editExpense[item][field] || '').trim();
      } else if (field === 'dueDay') {
        // ตรวจและลดค่าที่ค์คหา เช่น 1-31
        const raw = String(editExpense[item][field] ?? '').trim();
        const parsed = parseInt(raw, 10);
        if (Number.isNaN(parsed)) {
          numericExpense[item][field] = '';
        } else {
          // ลดหรือปีด ฟากช่วงบิดอื่น เช่น เดือน กุมภา 32 → 31
          numericExpense[item][field] = Math.min(31, Math.max(1, parsed));
        }
      } else if (field === 'dueDate') {
        // เลิกใช้ dueDate แล้ว (ใช้ dueDay แทน)
      } else {
        // รื้ field คืนจำนวน (estimate, actual, etc.) แปลงเป็นตัวเลข
        numericExpense[item][field] = parseToNumber(editExpense[item][field]);
      }
    });
  });
  return numericExpense;
}

/**
 * Calculate total sum of a specific field across all expenses
 * Used to get total estimate, total actual paid, etc.
 * Filters out invalid/NaN values
 * @param {object} editExpense - expense data object
 * @param {string} field - field to sum ('estimate', 'actual', etc.)
 * @param {function} parseToNumber - number parsing function
 * @returns {number} sum of field values across all expenses
 */
export function calculateExpenseTotal(editExpense, field, parseToNumber) {
  // วษคทุกแต่ละสึ่งที่ชด field ที่รองมา (estimate/actual/etc.)
  const values = Object.values(editExpense).map(item => parseToNumber(item?.[field]));
  // รวมยอดวัน และกรอก NaN ยอด
  return values.reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
}
