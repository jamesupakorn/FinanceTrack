// สรุปยอดรายจ่ายแต่ละบัญชี (mapping)
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
// รายการค่าใช้จ่ายมาตรฐานที่ใช้สำหรับสร้างฟอร์ม
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
const EXPENSE_IGNORED_FIELDS = new Set([
  'totalEstimate',
  'totalActualPaid',
  'accountSummary',
  'month',
  '_id',
  'id'
]);
// Utility functions สำหรับจัดการตัวเลขและเงิน

// จัดรูปแบบตัวเลขเป็นทศนิยม 2 ตำแหน่ง
export const formatNumber = (value) => {
  // รองรับ input ที่มี comma เช่น 40,560.00
  let cleaned = typeof value === 'string' ? value.replace(/,/g, '') : value;
  const numValue = parseFloat(cleaned) || 0;
  // เพิ่ม comma ขั้นหลักพัน
  return numValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// แปลงค่าเป็นตัวเลขและจัดรูปแบบ (สำหรับแสดงผล)
export const parseAndFormat = (value) => {
  return formatNumber(value);
};

// แปลงค่าเป็น number สำหรับบันทึกข้อมูล
export const parseToNumber = (value) => {
  // Remove comma before parsing
  if (typeof value === 'string') {
    return parseFloat(value.replace(/,/g, '')) || 0;
  }
  return parseFloat(value) || 0;
};

// จัดรูปแบบการแสดงเงิน (แสดงเป็นตัวเลขธรรมดา เช่น 700.00)
export const formatCurrency = (value) => {
  const numValue = parseFloat(value) || 0;
    const num = parseFloat(typeof value === 'string' ? value.replace(/,/g, '') : value) || 0;
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// คำนวณผลรวม
export const calculateSum = (values) => {
  return values.reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
};

// คำนวณรวมรายรับ (object of values)
export const calculateTotalFromObject = (obj) => {
  return calculateSum(Object.values(obj));
};

// คำนวณรวมรายรับแบบมีเงินเดือน (object of values, salaryNetIncome)
export const calculateTotalWithSalary = (obj, salaryNetIncome) => {
  // ตัด key ที่เป็นเงินเดือนออกก่อน แล้วรวมกับ salaryNetIncome
  const otherIncomes = Object.entries(obj)
    .filter(([key]) => key !== 'เงินเดือน')
    .map(([, value]) => parseToNumber(value));
  const salaryValue = parseToNumber(salaryNetIncome);
  return calculateSum([...otherIncomes, salaryValue]);
};

// คำนวณรวมรายได้/รวมหัก/เงินได้สุทธิ สำหรับ SalaryCalculator
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

// ตรวจสอบว่าเป็นตัวเลขที่ถูกต้องหรือไม่
export const isValidNumber = (value) => {
  return !isNaN(parseFloat(value)) && isFinite(value);
};

// จัดการ input change event สำหรับตัวเลข
export const handleNumberInput = (value, setState, key = null) => {
  // ไม่ format ทันที ให้เก็บ raw value เพื่อให้พิมพ์ได้หลายหลัก
  if (key) {
    setState(prev => ({ ...prev, [key]: value }));
  } else {
    setState(value);
  }
};

// ใช้สำหรับ onBlur เท่านั้น เพื่อ format เป็นทศนิยม 2 ตำแหน่ง
export const handleNumberBlur = (value, setState, key = null) => {
  const formattedValue = parseAndFormat(value);
  if (key) {
    setState(prev => ({ ...prev, [key]: formattedValue }));
  } else {
    setState(formattedValue);
  }
};

export const DEFAULT_INCOME_ITEMS = [
  { key: 'salary', label: 'เงินเดือน' },
  { key: 'income2', label: 'แหล่งรายรับ 2' },
  { key: 'other', label: 'อื่นๆ' }
];

const DEFAULT_INCOME_KEYS = DEFAULT_INCOME_ITEMS.map(item => item.key);
const INCOME_LABELS_FIELD = '__labels';
const INCOME_IGNORED_FIELDS = new Set(['month', '_id', 'รวม', INCOME_LABELS_FIELD]);

// จัดรูปแบบข้อมูลที่โหลดจาก API สำหรับรายรับ (รองรับ dynamic rows และ label เสริม)
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

// จัดรูปแบบข้อมูลที่โหลดจาก API สำหรับรายจ่าย
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

  const dynamicKeys = Object.keys(monthData || {}).filter(key => {
    if (EXPENSE_IGNORED_FIELDS.has(key)) return false;
    return typeof monthData[key] === 'object';
  });

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
      paid: (typeof source?.paid === 'boolean') ? source.paid : false
    };
  });

  return {
    values: formattedData,
    persistedKeys: dynamicKeys,
  };
};

// จัดรูปแบบข้อมูลเงินออม
export const formatSavingsData = (data) => {
  return {
    ยอดออมสะสม: parseAndFormat(data.ยอดออมสะสม || 0),
    รายการเงินออม: (data.รายการเงินออม || []).map(item => ({
      ...item,
      จำนวนเงิน: parseAndFormat(item.จำนวนเงิน || 0)
    }))
  };
};

// จัดรูปแบบข้อมูลภาษี
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

// สร้าง options สำหรับ dropdown เลือกเดือน (15 เดือนย้อนหลัง)
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

// สร้างเดือนถัดไป
export const getNextMonth = (currentMonth) => {
  const [year, month] = currentMonth.split('-').map(Number);
  const nextDate = new Date(year, month, 1); // month+1 เนื่องจาก Date constructor month เริ่มจาก 0
  return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
};

// จัดการการลบข้อมูลเดือนเก่าสุด (เก็บแค่ 15 เดือน)
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

// สร้าง options สำหรับ dropdown เลือกปี (ปีปัจจุบันและปีก่อนหน้า)
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

// จัดการการลบข้อมูลปีเก่า (เก็บแค่ปีปัจจุบันและปีก่อนหน้า)
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