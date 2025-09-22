import fs from 'fs';
import path from 'path';

const filePath = path.join(process.cwd(), 'src', 'backend', 'data', 'tax_accumulated.json');

function cleanOldYearData(data) {
  // ทำความสะอาดข้อมูลภาษีเก็บเฉพาะปีปัจจุบันและย้อนหลัง 2 ปี (รวม 3 ปี)
  const currentYear = new Date().getFullYear();
  const years = Object.keys(data.ภาษีรายปี || {}).map(Number);
  
  // เก็บเฉพาะปีปัจจุบันและย้อนหลัง 2 ปี (เช่น 2025, 2024, 2023)
  const validYears = years.filter(year => year >= currentYear - 2);
  
  // สร้างข้อมูลใหม่เก็บเฉพาะปีที่ต้องการ
  const newYearData = {};
  validYears.forEach(year => {
    if (data.ภาษีรายปี && data.ภาษีรายปี[year]) {
      newYearData[year] = data.ภาษีรายปี[year];
    }
  });
  
  data.ภาษีรายปี = newYearData;
  return data;
}

export default function handler(req, res) {
  if (req.method === 'GET') {
    const { year } = req.query;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    if (year) {
      // ส่งข้อมูลปีที่ระบุ
      const yearData = data.ภาษีรายปี?.[year] || { ภาษีสะสม: 0 };
      res.status(200).json({ [year]: yearData });
    } else {
      // ส่งข้อมูลทั้งหมด
      res.status(200).json(data);
    }
  } else if (req.method === 'POST') {
    const { year, ภาษีสะสม, ภาษีรายเดือน } = req.body;
    let data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // ตรวจสอบว่ามี structure ภาษีรายปี หรือไม่
    if (!data.ภาษีรายปี) {
      data.ภาษีรายปี = {};
    }
    
    if (year) {
      // ถ้าเป็นการส่งข้อมูลแบบ object (ภาษีสะสม เป็น object)
      if (typeof ภาษีสะสม === 'object' && ภาษีสะสม !== null) {
        data.ภาษีรายปี[year] = ภาษีสะสม;
      } else {
        // ถ้าเป็นการส่งแบบแยกค่า ให้สร้าง/อัปเดต object
        if (!data.ภาษีรายปี[year]) {
          data.ภาษีรายปี[year] = {};
        }
        if (ภาษีสะสม !== undefined) {
          data.ภาษีรายปี[year].ภาษีสะสม = parseFloat(ภาษีสะสม) || 0;
        }
        if (ภาษีรายเดือน !== undefined) {
          data.ภาษีรายปี[year].ภาษีรายเดือน = ภาษีรายเดือน;
        }
      }
    }
    
    // ลบข้อมูลปีเก่าเกิน 3 ปี (ปิดชั่วคราวเพื่อทดสอบ)
    // data = cleanOldYearData(data);
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    res.status(201).json({ success: true });
  } else if (req.method === 'DELETE') {
    try {
      const { year } = req.body;
      console.log('🗑️ DELETE request received for year:', year);
      
      let data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      // ตรวจสอบว่ามี structure ภาษีรายปี หรือไม่
      if (!data.ภาษีรายปี) {
        console.log('❌ No tax data structure found');
        data.ภาษีรายปี = {};
        res.status(404).json({ success: false, message: 'ไม่พบข้อมูลภาษี' });
        return;
      }
      
      // ตรวจสอบว่ามีปีที่ต้องการลบหรือไม่
      if (!year) {
        console.log('❌ No year specified');
        res.status(400).json({ success: false, message: 'กรุณาระบุปีที่ต้องการลบ' });
        return;
      }
      
      if (!data.ภาษีรายปี[year]) {
        console.log(`❌ Year ${year} not found in data`);
        res.status(404).json({ success: false, message: `ไม่พบข้อมูลภาษีปี ${year}` });
        return;
      }
      
      // สำรองข้อมูลก่อนลบ (ใน log)
      console.log(`🗑️ กำลังลบข้อมูลภาษีปี ${year}:`, data.ภาษีรายปี[year]);
      
      // ลบปีที่ระบุออกจาก object
      delete data.ภาษีรายปี[year];
      
      // ตรวจสอบว่าหลังลบแล้วยังมีข้อมูลเหลืออยู่หรือไม่
      const remainingYears = Object.keys(data.ภาษีรายปี);
      console.log(`📊 ปีที่เหลือหลังลบ: ${remainingYears.join(', ')}`);
      
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log('✅ File written successfully');
      
      res.status(200).json({ 
        success: true, 
        message: `ลบข้อมูลภาษีปี ${year} เรียบร้อยแล้ว`,
        remainingYears: remainingYears
      });
    } catch (error) {
      console.error('❌ Error in DELETE handler:', error);
      res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดของเซิร์ฟเวอร์' });
    }
  } else {
    res.status(405).end();
  }
}