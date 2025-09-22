import fs from 'fs';
import path from 'path';

const filePath = path.join(process.cwd(), 'src', 'backend', 'data', 'monthly_income.json');

// จัดการการลบข้อมูลเดือนเก่าสุด (เก็บแค่ 15 เดือน)
const cleanOldMonthData = (data, newMonth) => {
  const months = Object.keys(data.months || {});
  
  // เพิ่มเดือนใหม่
  if (!months.includes(newMonth)) {
    months.push(newMonth);
  }
  
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

export default function handler(req, res) {
  if (req.method === 'GET') {
    const { month } = req.query;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const monthData = data.months[month] || {};
    
    // คำนวณยอดรวม
    const รวม = Object.values(monthData).reduce((sum, value) => {
      return sum + (parseFloat(value) || 0);
    }, 0);
    
    const response = {
      ...data,
      months: { [month]: monthData },
      รวม
    };
    
    res.status(200).json(response);
  } else if (req.method === 'POST') {
    const { month, values } = req.body;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // เพิ่มข้อมูลเดือนใหม่
    data.months[month] = values;
    
    // ลบเดือนเก่าสุดถ้ามีมากกว่า 12 เดือน
    const cleanedData = cleanOldMonthData(data, month);
    
    fs.writeFileSync(filePath, JSON.stringify(cleanedData, null, 2));
    res.status(201).json({ success: true });
  } else {
    res.status(405).end();
  }
}
