/**
 * numberUtils.js
 * ฟังก์ชันช่วยจัดการตัวเลขและการเงินฝั่ง frontend
 * - จัดรูปแบบตัวเลข/สกุลเงิน
 * - แปลงข้อมูลรายรับ/รายจ่ายจาก API
 * - คำนวณสรุปเงินเดือน/ภาษี/เงินออม
 * - จัดการ input/blur ของช่องตัวเลข
 * - จัดการเดือน/ปี และทำความสะอาดข้อมูลเก่า
 */

import { END_OF_MONTH_DUE_DAY, isEndOfMonthDueDay } from '../dateUtils';

/**
 * คำนวณสรุปยอดตามบัญชีจากข้อมูลค่าใช้จ่าย
 * รวมเฉพาะรายการที่ยังไม่ได้ชำระ
 * @param {object} editExpense - ข้อมูลค่าใช้จ่าย
 * @returns {object} สรุปยอด {ชื่อบัญชี: ยอดรวม}
 */
export const getAccountSummary = (editExpense) => {
  const mapping = {
    "กรุงศรี": ["credit_kungsri"],
    "ttb": ["house", "credit_ttb"],
    "กสิกร": ["credit_kbank", "shopee", "netflix", "youtube", "youtube_membership"],
    "UOB": ["credit_uob"]
  };
  const summary = {};
  Object.entries(mapping).forEach(([account, items]) => {
    let sum = 0;
    items.forEach(item => {
      // รวมเฉพาะยอดที่ยังไม่จ่าย
      const paid = editExpense[item]?.['paid'];
      if (paid !== true && paid !== 'true') {
        sum += parseToNumber(editExpense[item]?.['estimate'] || 0);
      }
    });
    summary[account] = sum;
  });
  return summary;
};
// รายการค่าใช้จ่ายมาตรฐานที่ใช้สำหรับสร้างฟอร์ม (15 รายการ)
export const DEFAULT_EXPENSE_ITEMS = [
  { key: 'house', label: 'ค่าบ้าน' },
  { key: 'water', label: 'ค่าน้ำ' },
  { key: 'internet', label: 'ค่าเน็ต' },
  { key: 'electricity', label: 'ค่าไฟ' },
  { key: 'mobile', label: 'โทรศัพท์มือถือ' }
];

const DEFAULT_EXPENSE_KEYS = DEFAULT_EXPENSE_ITEMS.map(item => item.key);
const CUSTOM_EXPENSE_KEY_PREFIX = 'custom_';
const DEFAULT_CUSTOM_EXPENSE_NAME = 'รายการใหม่'; // Default new item placeholder name
const EXPENSE_IGNORED_FIELDS = new Set([
  // Metadata fields to exclude from expense item processing
  'totalEstimate',
  'totalActualPaid',
  'accountSummary',
  'month',
  '_id',
  'id'
]);

/**
 * Parse string or number to numeric format for expense amounts
 * Removes comma currency formatting and converts to float
 * Returns 0 for invalid/empty values
 * @param {number|string} value - value to parse (can be formatted with commas)
 * @returns {number} parsed numeric value or 0 if invalid
 */
function parseExpenseNumeric(value) {
  // หากเป็นตัวเลขให้คืนค่าเดิม ถ้าไม่ใช่ให้คืน 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    // ลบ comma ก่อนแปลงเป็นตัวเลข (40,560.00 → 40560.00)
    const parsed = parseFloat(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0; // คืน 0 หากรูปแบบไม่ถูกต้อง
}

/**
 * Check if a custom expense row is effectively empty/should be hidden
 * Identifies placeholder rows that were created but never filled in:
 * - Name is empty or default "รายการใหม่" label
 * - No estimate amount
 * - No actual amount
 * - No due day set
 * - Not marked as paid
 * @param {string} key - expense item key
 * @param {object} source - expense item object from API/state
 * @returns {boolean} true if row is empty/placeholder
 */
function isEffectivelyEmptyCustomExpenseRow(key, source) {
  // ตรวจสอบว่า key เริ่มด้วย 'custom_'
  if (!String(key || '').startsWith(CUSTOM_EXPENSE_KEY_PREFIX)) return false;
  // ถ้าไม่มีข้อมูลหรือไม่ใช่ object ให้ถือว่าเป็นแถวว่าง
  if (!source || typeof source !== 'object') return true;
  const name = typeof source.name === 'string' ? source.name.trim() : '';
  const estimate = parseExpenseNumeric(source.estimate);
  const actual = parseExpenseNumeric(source.actual);
  const dueDay = source.dueDay == null ? '' : String(source.dueDay).trim();
  const paid = source.paid === true || source.paid === 'true';
  // แถวว่าง: ชื่อเริ่มต้น/ว่าง, ยอดเป็น 0, ไม่มี dueDay, ยังไม่ชำระ
  const isDefaultName = !name || name === DEFAULT_CUSTOM_EXPENSE_NAME;
  return isDefaultName && estimate === 0 && actual === 0 && dueDay === '' && !paid;
}
// Utility functions สำหรับจัดการตัวเลขและเงิน

/**
 * จัดรูปแบบตัวเลขเป็นทศนิยม 2 ตำแหน่ง พร้อมคั่นหลักพัน
 * @param {number|string} value - ค่าที่ต้องการจัดรูปแบบ
 * @returns {string} สตริงตัวเลขที่จัดรูปแบบแล้ว
 */
export const formatNumber = (value) => {
  // รองรับ input ที่มี comma เช่น 40,560.00
  let cleaned = typeof value === 'string' ? value.replace(/,/g, '') : value;
  const numValue = parseFloat(cleaned) || 0;
  // จัดรูปแบบเพิ่ม comma และทศนิยม 2 ตำแหน่ง
  return numValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * แปลงและจัดรูปแบบตัวเลขในขั้นตอนเดียว
 * @param {number|string} value - ค่าที่ต้องการแปลง
 * @returns {string} ผลลัพธ์ที่จัดรูปแบบแล้ว
 */
export const parseAndFormat = (value) => {
  // แปลงและจัดรูปแบบ เช่น 40560.00 → 40,560.00
  return formatNumber(value);
};

/**
 * แปลงตัวเลขสำหรับบันทึกลงฐานข้อมูล (ตัด comma ออก)
 * @param {number|string} value - ค่าที่ต้องการแปลง
 * @returns {number} ตัวเลขแบบ raw
 */
export const parseToNumber = (value) => {
  // ลบ comma และแปลงเป็นตัวเลข
  if (typeof value === 'string') {
    // หากเป็น string ให้ลบ comma ก่อน
    return parseFloat(value.replace(/,/g, '')) || 0;
  }
  return parseFloat(value) || 0; // คืน 0 หากไม่สามารถแปลงได้
};

/**
 * จัดรูปแบบตัวเลขเป็นสกุลเงิน (ทศนิยม 2 ตำแหน่ง)
 * @param {number|string} value - ค่าที่ต้องการจัดรูปแบบ
 * @returns {string} สตริงตัวเลขแบบสกุลเงิน
 */
export const formatCurrency = (value) => {
  // แปลงค่าเป็นเงิน (40560 → 40,560.00)
  const numValue = parseFloat(value) || 0;
  // จัดรูปแบบเป็นสตริงตัวเลขพร้อมทศนิยม 2 ตำแหน่ง
  const num = parseFloat(typeof value === 'string' ? value.replace(/,/g, '') : value) || 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * รวมค่าตัวเลขใน array
 * @param {array} values - รายการตัวเลข/สตริง
 * @returns {number} ผลรวม
 */
export const calculateSum = (values) => {
  return values.reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
};

/**
 * คำนวณสรุปเงินเดือน (รายรับ/รายหัก/สุทธิ)
 * @param {object} salaryData - ข้อมูลเงินเดือนจากฟอร์ม
 * @returns {object} {รวมรายได้, รวมหัก, เงินได้สุทธิ}
 */
export const calculateSalaryTotals = (salaryData) => {
  const totalIncome = [
    'salary', 'overtime_1x', 'overtime_1_5x',
    'overtime_2x', 'overtime_3x', 'overtime_other',
    'bonus', 'other_income'
  ].reduce((sum, key) => sum + parseToNumber(salaryData[key]), 0);

  const totalDeduction = [
    'provident_fund', 'social_security', 'tax'
  ].reduce((sum, key) => sum + parseToNumber(salaryData[key]), 0);

  const netIncome = totalIncome - totalDeduction;
  return {
    รวมรายได้: totalIncome,
    รวมหัก: totalDeduction,
    เงินได้สุทธิ: netIncome
  };
};

/**
 * จัดการการพิมพ์ตัวเลขแบบเรียลไทม์ (ยังไม่ format)
 * @param {string} value - ค่าที่ผู้ใช้พิมพ์
 * @param {function} setState - ฟังก์ชันอัปเดต state
 * @param {string} key - key ของ field (ถ้ามี)
 */
export const handleNumberInput = (value, setState, key = null) => {
  // ไม่ format ทันที ให้เก็บ raw value เพื่อให้พิมพ์ได้หลายหลัก
  if (key) {
    setState(prev => ({ ...prev, [key]: value }));
  } else {
    setState(value);
  }
};

/**
 * จัดรูปแบบตัวเลขเมื่อออกจากช่อง (blur)
 * @param {string} value - ค่าที่ต้องการจัดรูปแบบ
 * @param {function} setState - ฟังก์ชันอัปเดต state
 * @param {string} key - key ของ field (ถ้ามี)
 */
export const handleNumberBlur = (value, setState, key = null) => {
  const formattedValue = parseAndFormat(value);
  if (key) {
    setState(prev => ({ ...prev, [key]: formattedValue }));
  } else {
    setState(formattedValue);
  }
};

// Default preset income categories (3 basic items, expandable with custom rows)
export const DEFAULT_INCOME_ITEMS = [
  { key: 'salary', label: 'เงินเดือน' },
  { key: 'income2', label: 'แหล่งรายรับ 2' },
  { key: 'other', label: 'อื่นๆ' }
];

const DEFAULT_INCOME_KEYS = DEFAULT_INCOME_ITEMS.map(item => item.key);
const INCOME_LABELS_FIELD = '__labels'; // Special field for storing custom labels
const INCOME_IGNORED_FIELDS = new Set([
  // Metadata fields to exclude from income item processing
  'month',
  '_id',
  'รวม',  // Thai for 'Total'
  INCOME_LABELS_FIELD
]);

/**
 * จัดรูปแบบข้อมูลรายรับจาก API ให้พร้อมใช้งานในฟอร์ม
 * รองรับแถว custom และ label แบบกำหนดเอง
 * @param {object} data - ข้อมูลดิบจาก API
 * @param {string} month - เดือนที่เลือก (YYYY-MM)
 * @returns {object} {values, labels, persistedKeys}
 */
export const formatIncomeData = (data, month) => {
  const formattedData = {};
  let monthData = {};
  if (data && typeof data === 'object') {
    if (data.months && typeof data.months === 'object' && data.months[month]) {
      monthData = data.months[month];
    } else {
      monthData = data;
    }
  }

  const storedLabels = (monthData && typeof monthData[INCOME_LABELS_FIELD] === 'object' && !Array.isArray(monthData[INCOME_LABELS_FIELD]))
    ? { ...monthData[INCOME_LABELS_FIELD] }
    : {};

  const persistedValueKeys = Object.keys(monthData || {}).filter(key => {
    if (INCOME_IGNORED_FIELDS.has(key)) return false;
    const value = monthData[key];
    if (typeof value === 'number') return true;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed.length) return false;
      return !Number.isNaN(parseFloat(trimmed));
    }
    return false;
  });

  const hasStoredValues = persistedValueKeys.length > 0;
  const baselineKeys = hasStoredValues ? persistedValueKeys : DEFAULT_INCOME_KEYS;
  const keysToFormat = Array.from(new Set(baselineKeys));

  if (!keysToFormat.length && DEFAULT_INCOME_KEYS.length) {
    keysToFormat.push(...DEFAULT_INCOME_KEYS);
  }

  keysToFormat.forEach(key => {
    formattedData[key] = parseAndFormat(monthData[key] ?? 0);
  });

  const persistedKeys = Array.from(new Set(persistedValueKeys));
  return {
    values: formattedData,
    labels: storedLabels,
    persistedKeys
  };
};

/**
 * จัดรูปแบบข้อมูลค่าใช้จ่ายจาก API ให้พร้อมใช้งานในฟอร์ม
 * รองรับรายการ custom และกรองแถวว่าง
 * @param {object} data - ข้อมูลดิบจาก API
 * @param {string} month - เดือนที่เลือก (YYYY-MM)
 * @returns {object} {values, persistedKeys, emptyKeysToDelete}
 */
export const formatExpenseData = (data, month) => {
  const formattedData = {};
  let monthData = {};
  if (data && typeof data === 'object') {
    if (data.months && typeof data.months === 'object' && data.months[month]) {
      monthData = data.months[month];
    } else {
      monthData = data;
    }
  }

  // เก็บทุกรายการที่ไม่ใช่ metadata ก่อนกรอง
  const allDynamicKeys = Object.keys(monthData || {}).filter(key => {
    if (EXPENSE_IGNORED_FIELDS.has(key)) return false;
    if (typeof monthData[key] !== 'object') return false;
    return true; // เก็บทั้งหมด ก่อนกรอง
  });

  // ระบุรายการว่างเปล่าที่ต้องลบออกจากการแสดงผล
  const emptyCustomKeys = allDynamicKeys.filter(key =>
    isEffectivelyEmptyCustomExpenseRow(key, monthData[key])
  );

  // ระบุรายการที่ใช้งาน (ไม่ใช่ว่าง)
  const dynamicKeys = allDynamicKeys.filter(key =>
    !isEffectivelyEmptyCustomExpenseRow(key, monthData[key])
  );

  // ถ้าเดือนนี้ยังไม่มีข้อมูลจริงเลย ให้แสดงรายการมาตรฐานเป็นค่าเริ่มต้น
  // แต่ถ้ามีข้อมูลที่บันทึกแล้ว ให้แสดงเฉพาะ key ที่มีอยู่จริง (เพื่อให้การลบรายการคงอยู่)
  const hasPersistedRows = dynamicKeys.length > 0;
  const allKeys = hasPersistedRows
    ? Array.from(new Set(dynamicKeys))
    : Array.from(new Set(DEFAULT_EXPENSE_KEYS));

  allKeys.forEach(item => {
    const source = (monthData && monthData[item]) ? monthData[item] : {};
    const defaultLabel = DEFAULT_EXPENSE_ITEMS.find(expense => expense.key === item)?.label;
    formattedData[item] = {
      name: (typeof source.name === 'string' && source.name.trim().length > 0)
        ? source.name
        : (defaultLabel || 'รายการใหม่'),
      estimate: parseAndFormat(source?.estimate ?? 0),
      actual: parseAndFormat(source?.actual ?? 0),
      paid: source?.paid === true || source?.paid === 'true',
      dueDay: (() => {
        if (typeof source?.dueDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.dueDay)) {
          return String(parseInt(source.dueDay.slice(-2), 10));
        }
        if (typeof source?.dueDay === 'number' || typeof source?.dueDay === 'string') {
          const rawDueDay = String(source.dueDay).trim();
          if (isEndOfMonthDueDay(rawDueDay)) {
            return END_OF_MONTH_DUE_DAY;
          }
          return rawDueDay;
        }
        if (typeof source?.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.dueDate)) {
          return String(parseInt(source.dueDate.slice(-2), 10));
        }
        return '';
      })()
    };
  });

  return {
    values: formattedData,
    persistedKeys: allDynamicKeys, // ← ส่งทั้งหมด รวมรายการว่างด้วย เพื่อให้ระบบรู้ว่าอะไรมาจาก API
    emptyKeysToDelete: emptyCustomKeys, // ← ส่งรายการว่างเพื่อลบ
  };
};

/**
 * จัดรูปแบบข้อมูลเงินออมให้พร้อมใช้งานในฟอร์ม
 * @param {object} data - ข้อมูลเงินออมดิบ
 * @returns {object} ข้อมูลเงินออมที่จัดรูปแบบแล้ว
 */
export const formatSavingsData = (data) => {
  return {
    ยอดออมสะสม: parseAndFormat(data.ยอดออมสะสม || 0),
    รายการเงินออม: (data.รายการเงินออม || []).map(item => ({
      ...item,
      จำนวนเงิน: parseAndFormat(item.จำนวนเงิน || 0)
    }))
  };
};

/**
 * จัดรูปแบบข้อมูลภาษีให้พร้อมใช้งานในฟอร์ม
 * @param {object} data - ข้อมูลภาษีดิบ
 * @returns {object} ข้อมูลภาษีที่จัดรูปแบบแล้ว
 */
export const formatTaxData = (data) => {
  const formattedภาษีรายเดือน = {};
  Object.keys(data.ภาษีรายเดือน || {}).forEach(month => {
    formattedภาษีรายเดือน[month] = parseAndFormat(data.ภาษีรายเดือน[month]);
  });
  
  return {
    ภาษีสะสม: parseAndFormat(data.ภาษีสะสมตั้งแต่เดือนแรก || 0),
    ภาษีรายเดือน: formattedภาษีรายเดือน
  };
};

/**
 * สร้างตัวเลือกเดือนย้อนหลัง 15 เดือนสำหรับ dropdown
 * @returns {array} [{value, label}, ...]
 */
export const generateMonthOptions = () => {
  const months = [];
  const currentDate = new Date();
  
  for (let i = 0; i < 15; i++) {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
    const monthValue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const monthLabel = date.toLocaleDateString('th-TH', { 
      year: 'numeric', 
      month: 'long' 
    });
    
    months.push({
      value: monthValue,
      label: monthLabel
    });
  }
  
  return months;
};

/**
 * คำนวณเดือนถัดไปจากเดือนปัจจุบัน
 * @param {string} currentMonth - เดือนรูปแบบ YYYY-MM
 * @returns {string} เดือนถัดไป (YYYY-MM)
 */
export const getNextMonth = (currentMonth) => {
  const [year, month] = currentMonth.split('-').map(Number);
  const nextDate = new Date(year, month, 1); // month+1 เนื่องจาก Date constructor month เริ่มจาก 0
  return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * ลบข้อมูลเดือนเก่า เก็บไว้เฉพาะ 15 เดือนล่าสุด
 * @param {object} data - ข้อมูลที่มี months
 * @param {string} newMonth - เดือนใหม่ (YYYY-MM)
 * @returns {object} ข้อมูลที่ถูกตัดเหลือ 15 เดือน
 */
export const cleanOldMonthData = (data, newMonth) => {
  const months = Object.keys(data.months || {});
  
  // เพิ่มเดือนใหม่
  months.push(newMonth);
  
  // เรียงลำดับเดือน (ใหม่ไปเก่า)
  months.sort((a, b) => b.localeCompare(a));
  
  // เก็บแค่ 15 เดือน ลบเดือนเก่าสุดออก
  const recentMonths = months.slice(0, 15);
  
  // สร้าง data ใหม่เก็บแค่เดือนที่ต้องการ
  const cleanedData = { ...data };
  cleanedData.months = {};
  
  recentMonths.forEach(month => {
    if (data.months && data.months[month]) {
      cleanedData.months[month] = data.months[month];
    }
  });
  
  return cleanedData;
};

/**
 * สร้างตัวเลือกปีสำหรับ dropdown (ปีนี้และปีก่อนหน้า)
 * @returns {array} [{value, label}, ...]
 */
export const generateYearOptions = () => {
  const years = [];
  const currentYear = new Date().getFullYear();
  
  for (let i = 0; i < 2; i++) {
    const year = currentYear - i;
    years.push({
      value: year.toString(),
      label: `พ.ศ. ${year + 543}`
    });
  }
  
  return years;
};

/**
 * ลบข้อมูลปีเก่า เก็บไว้เฉพาะปีปัจจุบันและปีก่อนหน้า
 * @param {object} data - ข้อมูลที่มี ภาษีรายปี
 * @returns {object} ข้อมูลที่ถูกตัดเหลือ 2 ปี
 */
export const cleanOldYearData = (data) => {
  const currentYear = new Date().getFullYear();
  const years = Object.keys(data.ภาษีรายปี || {}).map(Number);
  
  // เก็บเฉพาะปีปัจจุบันและปีก่อนหน้า
  const validYears = years.filter(year => year >= currentYear - 1);
  
  // สร้างข้อมูลใหม่เก็บเฉพาะปีที่ต้องการ
  const newYearData = {};
  validYears.forEach(year => {
    if (data.ภาษีรายปี && data.ภาษีรายปี[year]) {
      newYearData[year] = data.ภาษีรายปี[year];
    }
  });
  
  return { ...data, ภาษีรายปี: newYearData };
};