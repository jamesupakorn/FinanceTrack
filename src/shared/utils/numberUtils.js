// Mask number for view mode: 2,345 → xx,345 | 1,234 → x,234 | 123 → 123 | 45 → 45 | 7 → 7
export function maskNumberFormat(num) {
  const original = num;
  if (typeof num !== 'number') {
    num = Number(num);
  }
  if (isNaN(num) || num === null || num === undefined || num === '') {
  //
    return '';
  }
  const absNum = Math.abs(num);
  if (absNum === 0) {
  //
    return '0';
  }
  if (absNum < 1000) {
    const resultBelow = num.toLocaleString();
  //
    return resultBelow;
  }
  // ถ้าเลข >= 1000 ให้แสดง xxx,xxx (x คงที่ 3 ตัว)
  const last3 = (Math.floor(absNum) % 1000).toString().padStart(3, '0');
  const resultMask = (num < 0 ? '-' : '') + 'xxx,' + last3;
  //
  return resultMask;
  const result = num.toLocaleString();
  //
  return result;
}
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
      sum += parseToNumber(editExpense[item]?.['estimate'] || 0);
    });
    summary[account] = sum;
  });
  return summary;
};
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

// จัดรูปแบบข้อมูลที่โหลดจาก API สำหรับรายรับ
export const formatIncomeData = (data, month) => {
  const formattedData = {};
  const monthData = data.months[month] || {};
  Object.keys(monthData).forEach(key => {
    formattedData[key] = parseAndFormat(monthData[key]);
  });
  return formattedData;
};

// จัดรูปแบบข้อมูลที่โหลดจาก API สำหรับรายจ่าย
export const formatExpenseData = (data, month) => {
  const formattedData = {};
  const monthData = data.months[month] || {};
  Object.keys(monthData).forEach(item => {
    formattedData[item] = {};
    Object.keys(monthData[item] || {}).forEach(field => {
      if (field === 'paid') {
        // Preserve boolean for 'paid' field
        const val = monthData[item][field];
        if (typeof val === 'boolean') {
          formattedData[item][field] = val;
        } else if (typeof val === 'string') {
          formattedData[item][field] = val === 'true' || val === '1';
        } else if (typeof val === 'number') {
          formattedData[item][field] = val === 1;
        } else {
          formattedData[item][field] = false;
        }
      } else {
        formattedData[item][field] = parseAndFormat(monthData[item][field]);
      }
    });
  });
  return formattedData;
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