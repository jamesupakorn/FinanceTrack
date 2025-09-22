import fs from 'fs';
import path from 'path';

const dataPath = path.join(process.cwd(), 'src', 'backend', 'data', 'savings.json');

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
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    
    // คำนวณยอดรวมเงินเก็บจากรายการเงินออม
    const savingsList = data.รายการเงินออม[month] || [];
    const รวมเงินเก็บ = savingsList.reduce((sum, item) => {
      return sum + (parseFloat(item.จำนวนเงิน) || 0);
    }, 0);
    
    const response = {
      ยอดออมสะสม: data.ยอดออมสะสม[month] || 0,
      รายการเงินออม: savingsList,
      รวมเงินเก็บ
    };
    
    res.status(200).json(response);
  } else if (req.method === 'POST') {
    const { month, ยอดออมสะสม, รายการเงินออม } = req.body;
    let data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    
    if (ยอดออมสะสม !== undefined) {
      data.ยอดออมสะสม[month] = ยอดออมสะสม;
    }
    if (รายการเงินออม !== undefined) {
      data.รายการเงินออม[month] = รายการเงินออม;
    }
    
    // ลบข้อมูลเดือนเก่าเกิน 12 เดือน
    data = cleanOldMonthData(data);
    
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
    res.status(201).json({ success: true });
  } else {
    res.status(405).end();
  }
}