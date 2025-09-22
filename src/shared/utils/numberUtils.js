// Utility functions สำหรับจัดการตัวเลขและเงิน

// จัดรูปแบบตัวเลขเป็นทศนิยม 2 ตำแหน่ง
export const formatNumber = (value) => {
  const numValue = parseFloat(value) || 0;
  return numValue.toFixed(2);
};

// แปลงค่าเป็นตัวเลขและจัดรูปแบบ (สำหรับแสดงผล)
export const parseAndFormat = (value) => {
  return formatNumber(value);
};

// แปลงค่าเป็น number สำหรับบันทึกข้อมูล
export const parseToNumber = (value) => {
  return parseFloat(value) || 0;
};

// จัดรูปแบบการแสดงเงิน (แสดงเป็นตัวเลขธรรมดา เช่น 700.00)
export const formatCurrency = (value) => {
  const numValue = parseFloat(value) || 0;
  return numValue.toFixed(2);
};

// คำนวณผลรวม
export const calculateSum = (values) => {
  return values.reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
};

// ตรวจสอบว่าเป็นตัวเลขที่ถูกต้องหรือไม่
export const isValidNumber = (value) => {
  return !isNaN(parseFloat(value)) && isFinite(value);
};

// จัดการ input change event สำหรับตัวเลข
export const handleNumberInput = (value, setState, key = null) => {
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
      formattedData[item][field] = parseAndFormat(monthData[item][field]);
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