/**
 * numberUtils.js
 * Frontend utility functions for number formatting, currency conversion, and financial calculations
 * 
 * This module provides:
 * - Currency formatting and number parsing
 * - Expense/Income data transformation from API
 * - Financial calculations (salary totals, tax, savings)
 * - Form input/blur event handlers for numbers
 * - Month/Year filtering and data cleanup
 */

/**
 * Calculate account summary from expense data
 * Groups expenses by account (Kungsri, TTB, Kbank, UOB) and sums unpaid amounts
 * Only includes items marked as unpaid in the summary
 * @param {object} editExpense - expense data object
 * @returns {object} account summary {accountName: totalUnpaidAmount}
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
// Default preset list of expense categories used for form generation
// These 15 items form the baseline expense tracking structure
export const DEFAULT_EXPENSE_ITEMS = [
  { key: 'house', label: 'ค่าบ้าน' },
  { key: 'water', label: 'ค่าน้ำ' },
  { key: 'internet', label: 'ค่าเน็ต' },
  { key: 'electricity', label: 'ค่าไฟ' },
  { key: 'mobile', label: 'โทรศัพท์มือถือ' },
  { key: 'credit_kbank', label: 'บัตรเครดิต KBank' },
  { key: 'credit_kungsri', label: 'บัตรเครดิต Kungsri' },
  { key: 'credit_uob', label: 'บัตรเครดิต UOB' },
  { key: 'credit_ttb', label: 'บัตรเครดิต TTB' },
  { key: 'shopee', label: 'Shopee' },
  { key: 'netflix', label: 'Netflix' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'youtube_membership', label: 'YouTube Membership' },
  { key: 'motorcycle', label: 'ค่ารถจักรยานยนต์' },
  { key: 'miscellaneous', label: 'ค่าใช้จ่ายเบ็ดเตล็ด' }
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
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
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
  if (!String(key || '').startsWith(CUSTOM_EXPENSE_KEY_PREFIX)) return false;
  if (!source || typeof source !== 'object') return true;
  const name = typeof source.name === 'string' ? source.name.trim() : '';
  const estimate = parseExpenseNumeric(source.estimate);
  const actual = parseExpenseNumeric(source.actual);
  const dueDay = source.dueDay == null ? '' : String(source.dueDay).trim();
  const paid = source.paid === true || source.paid === 'true';
  const isDefaultName = !name || name === DEFAULT_CUSTOM_EXPENSE_NAME;
  return isDefaultName && estimate === 0 && actual === 0 && dueDay === '' && !paid;
}
// Utility functions สำหรับจัดการตัวเลขและเงิน

/**
 * Format number to display format with 2 decimal places and thousand separators
 * Handles input with commas (e.g., "40,560.00" → "40,560.00")
 * @param {number|string} value - numeric value to format
 * @returns {string} formatted number with commas and .00 decimals
 */
export const formatNumber = (value) => {
  // รองรับ input ที่มี comma เช่น 40,560.00
  let cleaned = typeof value === 'string' ? value.replace(/,/g, '') : value;
  const numValue = parseFloat(cleaned) || 0;
  // เพิ่ม comma ขั้นหลักพัน
  return numValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * Parse and format number in one step (parsing + display formatting)
 * Converts input to readable number format
 * @param {number|string} value - value to parse and format
 * @returns {string} formatted number
 */
export const parseAndFormat = (value) => {
  return formatNumber(value);
};

/**
 * Parse number for database storage (removes formatting)
 * Strips commas and converts to plain number
 * Used when saving to database/API
 * @param {number|string} value - formatted or plain number
 * @returns {number} plain numeric value
 */
export const parseToNumber = (value) => {
  // Remove comma before parsing
  if (typeof value === 'string') {
    return parseFloat(value.replace(/,/g, '')) || 0;
  }
  return parseFloat(value) || 0;
};

/**
 * Format number as currency display (Thai format with .00 decimals)
 * Adds thousand separators for readability
 * @param {number|string} value - numeric value
 * @returns {string} formatted currency string
 */
export const formatCurrency = (value) => {
  const numValue = parseFloat(value) || 0;
    const num = parseFloat(typeof value === 'string' ? value.replace(/,/g, '') : value) || 0;
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * Sum array of numeric values
 * Filters out invalid/NaN values
 * @param {array} values - array of numbers/strings to sum
 * @returns {number} total sum
 */
export const calculateSum = (values) => {
  return values.reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
};

/**
 * Calculate salary breakdown totals
 * Sums income (salary + overtime + bonus + other)
 * Sums deductions (provident fund + social security + tax)
 * Calculates net income after deductions
 * @param {object} salaryData - salary form data
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
 * Handle number input change event (real-time input)
 * Stores raw value without formatting to allow multi-digit typing
 * Formatting happens on blur for better UX
 * @param {string} value - input value
 * @param {function} setState - state setter function
 * @param {string} key - optional object key for setState(prev => ({...}))
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
 * Handle number input blur event (on field leave)
 * Formats value to 2 decimal places when user leaves field
 * Improves UX by showing formatting only after input complete
 * @param {string} value - input value to format
 * @param {function} setState - state setter function
 * @param {string} key - optional object key for setState(prev => ({...}))
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
 * Transform income data from API into form-friendly format
 * Handles dynamic custom income rows and custom labels
 * Preserves all persisted keys from API for proper deletion tracking
 * @param {object} data - raw income data from API
 * @param {string} month - selected month (format: YYYY-MM)
 * @returns {object} {values: formatted data, labels: custom labels, persistedKeys: all keys from API}
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
 * Transform expense data from API into form-friendly format
 * Handles:
 * - Dynamic custom expense items (custom_1, custom_2, etc.)
 * - Filtering out empty placeholder rows
 * - Converting amounts to display format
 * - Normalizing due day values
 * - Preserving all persisted keys for deletion tracking
 * @param {object} data - raw expense data from API
 * @param {string} month - selected month (format: YYYY-MM)
 * @returns {object} {values: formatted data, persistedKeys: all keys from API, emptyKeysToDelete: empty rows}
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

  const allKeys = Array.from(new Set([...DEFAULT_EXPENSE_KEYS, ...dynamicKeys]));

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
          return String(source.dueDay);
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
 * Transform savings data into form-friendly format
 * Formats accumulated savings amount and individual savings items
 * @param {object} data - raw savings data
 * @returns {object} formatted savings with ยอดออมสะสม and รายการเงินออม
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
 * Transform tax data into form-friendly format
 * Formats accumulated tax and monthly tax breakdown
 * @param {object} data - raw tax data
 * @returns {object} formatted tax with ภาษีสะสม and ภาษีรายเดือน
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
 * Generate month selection options for 15-month lookback
 * Creates dropdown list from 15 months ago to current month
 * Format: YYYY-MM for value, Thai date string for display
 * @returns {array} [{value: "2025-02", label: "กุมภาพันธ์ 2568"}, ...]
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
 * Calculate next month from current month
 * Takes YYYY-MM format and returns next month in same format
 * Handles year rollover (December → January of next year)
 * @param {string} currentMonth - current month in YYYY-MM format
 * @returns {string} next month in YYYY-MM format
 */
export const getNextMonth = (currentMonth) => {
  const [year, month] = currentMonth.split('-').map(Number);
  const nextDate = new Date(year, month, 1); // month+1 เนื่องจาก Date constructor month เริ่มจาก 0
  return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * Clean up old month data, keeping only 15 recent months
 * Removes data older than 15 months to prevent unlimited data growth
 * Used for data size management
 * @param {object} data - data object with months property
 * @param {string} newMonth - new month to add (YYYY-MM format)
 * @returns {object} cleaned data with 15 months max
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
 * Generate year selection options
 * Creates dropdown list with current and previous year
 * Displays in Thai Buddhist year format (Gregorian + 543)
 * @returns {array} [{value: "2025", label: "พ.ศ. 2568"}, ...]
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
 * Clean up old year data, keeping only current and previous year
 * Prevents unlimited data growth for yearly metrics
 * Removes data from years older than previous year
 * @param {object} data - data object with ภาษีรายปี property
 * @returns {object} cleaned data with 2 years max
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