/**
 * expenseUtils.js
 * ฟังก์ชันช่วยจัดการข้อมูลค่าใช้จ่าย
 * - แปลงค่าตัวเลขและลบ comma
 * - กรองรายการ custom ที่ว่าง
 * - เตรียมข้อมูลก่อนบันทึกลงฐานข้อมูล
 * - คำนวณยอดรวมค่าใช้จ่าย
 */

import { isPaidFlag } from './commonUtils';

/**
 * แปลงค่า string/number ให้เป็นตัวเลข
 * ลบ comma และคืนค่า 0 หากไม่ถูกต้อง
 * @param {number|string} value - ค่าที่ต้องการแปลง
 * @returns {number}
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
 * ตรวจสอบว่าควรข้ามรายการ custom ระหว่างบันทึกหรือไม่
 * เงื่อนไข: ชื่อว่าง/ชื่อเริ่มต้น, ยอดเป็น 0, ไม่มี dueDay, ยังไม่ชำระ
 * @param {string} key - key ของรายการ
 * @param {object} item - ข้อมูลรายการ
 * @returns {boolean}
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
 * เตรียมข้อมูลค่าใช้จ่ายก่อนบันทึกลงฐานข้อมูล
 * - ข้ามรายการ custom ที่ว่าง
 * - แปลงตัวเลข
 * - แปลง paid ให้เป็น boolean
 * - ตัดช่องว่างชื่อรายการ
 * - ตรวจสอบ dueDay ให้อยู่ในช่วง 1-31
 * @param {object} editExpense - ข้อมูลจากฟอร์ม
 * @param {function} parseToNumber - ฟังก์ชันแปลงตัวเลข
 * @returns {object} ข้อมูลที่พร้อมบันทึก
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
 * คำนวณยอดรวมของฟิลด์ที่ระบุ (estimate/actual)
 * @param {object} editExpense - ข้อมูลค่าใช้จ่าย
 * @param {string} field - ชื่อฟิลด์ที่จะรวม
 * @param {function} parseToNumber - ฟังก์ชันแปลงตัวเลข
 * @returns {number} ยอดรวมทั้งหมด
 */
export function calculateExpenseTotal(editExpense, field, parseToNumber) {
  // วษคทุกแต่ละสึ่งที่ชด field ที่รองมา (estimate/actual/etc.)
  const values = Object.values(editExpense).map(item => parseToNumber(item?.[field]));
  // รวมยอดวัน และกรอก NaN ยอด
  return values.reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
}
