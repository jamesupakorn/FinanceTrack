import fs from 'fs';
import path from 'path';
/**
 * อัพเดตข้อมูลภาษีรายเดือนในปีและเดือนที่ระบุ
 * @param {string} year - ปี พ.ศ. เช่น "2568"
 * @param {string} month - เดือน เช่น "09"
 * @param {string|number} value - ยอดภาษีใหม่
 */
export function updateMonthlyTax(year, month, value) {
  const dataThai = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!dataThai.ภาษีรายปี) dataThai.ภาษีรายปี = {};
  if (!dataThai.ภาษีรายปี[year]) {
    dataThai.ภาษีรายปี[year] = { ภาษีสะสม: 0, ภาษีรายเดือน: {} };
  }
  if (!dataThai.ภาษีรายปี[year].ภาษีรายเดือน) {
    dataThai.ภาษีรายปี[year].ภาษีรายเดือน = {};
  }
  dataThai.ภาษีรายปี[year].ภาษีรายเดือน[month] = value.toString();  
  fs.writeFileSync(filePath, JSON.stringify(dataThai, null, 2));

  const dataEng = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!dataEng.tax_by_year) dataEng.tax_by_year = {};
  if (!dataEng.tax_by_year[year]) {
    dataEng.tax_by_year[year] = { accumulated_tax: 0, monthly_tax: {} };
  }
  if (!dataEng.tax_by_year[year].monthly_tax) {
    dataEng.tax_by_year[year].monthly_tax = {};
  }
  dataEng.tax_by_year[year].monthly_tax[month] = value.toString();
  fs.writeFileSync(filePath, JSON.stringify(dataEng, null, 2));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

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
        if (ภาษีรายเดือน !== undefined) {
          if (!data.ภาษีรายปี[year].ภาษีรายเดือน) {
            data.ภาษีรายปี[year].ภาษีรายเดือน = {};
          }
          // merge ข้อมูลเดิมกับใหม่
          Object.assign(data.ภาษีรายปี[year].ภาษีรายเดือน, ภาษีรายเดือน);
          // คำนวณภาษีสะสมใหม่จากข้อมูลภาษีรายเดือน
          const sum = Object.values(data.ภาษีรายปี[year].ภาษีรายเดือน)
            .map(v => parseFloat(v) || 0)
            .reduce((a, b) => a + b, 0);
          data.ภาษีรายปี[year].ภาษีสะสม = sum;
        } else if (ภาษีสะสม !== undefined) {
          // ถ้าอัพเดตเฉพาะภาษีสะสม
          data.ภาษีรายปี[year].ภาษีสะสม = parseFloat(ภาษีสะสม) || 0;
        }
      }
    }
    
    // ลบข้อมูลปีเก่าเกิน 3 ปี (ปิดชั่วคราวเพื่อทดสอบ)
    // data = cleanOldYearData(data);
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    res.status(201).json({ success: true });
  } else if (req.method === 'DELETE') {
    if (year) {
      // Always recalculate accumulated_tax from monthly_tax
      if (!data.tax_by_year[year]) {
        data.tax_by_year[year] = { accumulated_tax: 0, monthly_tax: {} };
      }
      if (monthly_tax !== undefined) {
        if (!data.tax_by_year[year].monthly_tax) {
          data.tax_by_year[year].monthly_tax = {};
        }
        Object.assign(data.tax_by_year[year].monthly_tax, monthly_tax);
      }
      // Recalculate accumulated_tax from monthly_tax
      const sum = Object.values(data.tax_by_year[year].monthly_tax)
        .map(v => parseFloat(v.toString().replace(/,/g, '')) || 0)
        .reduce((a, b) => a + b, 0);
      data.tax_by_year[year].accumulated_tax = sum;
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