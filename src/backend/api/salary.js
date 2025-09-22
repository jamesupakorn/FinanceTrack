import fs from 'fs';
import path from 'path';

const dataPath = path.join(process.cwd(), 'src', 'backend', 'data', 'salary.json');

function cleanOldMonthData(data) {
  const sortedKeys = Object.keys(data).sort((a, b) => new Date(a) - new Date(b));
  if (sortedKeys.length > 15) {
    const keysToRemove = sortedKeys.slice(0, sortedKeys.length - 15);
    keysToRemove.forEach(key => delete data[key]);
  }
  return data;
}

// อ่านข้อมูลจากไฟล์
function readSalaryData() {
  try {
    if (!fs.existsSync(dataPath)) {
      // สร้างไฟล์เริ่มต้นถ้าไม่มี
      const initialData = {};
      fs.writeFileSync(dataPath, JSON.stringify(initialData, null, 2));
      return initialData;
    }
    const data = fs.readFileSync(dataPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading salary data:', error);
    return {};
  }
}

// เขียนข้อมูลลงไฟล์
function writeSalaryData(data) {
  try {
    // ลบข้อมูลเดือนเก่าเกิน 12 เดือน
    data = cleanOldMonthData(data);
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing salary data:', error);
    return false;
  }
}

// สร้างโครงสร้างข้อมูลเริ่มต้นสำหรับเดือนใหม่
function createDefaultSalaryStructure() {
  return {
    รายได้: {
      เงินเดือน: 0,
      ค่าล่วงเวลา_1เท่า: 0,
      ค่าล่วงเวลา_1_5เท่า: 0,
      ค่าล่วงเวลา_2เท่า: 0,
      ค่าล่วงเวลา_3เท่า: 0,
      ค่าล่วงเวลาอื่นๆ: 0,
      โบนัส: 0,
      เงินได้อื่นๆ: 0
    },
    หัก: {
      หักกองทุนสำรองเลี้ยงชีพ: 0,
      หักสมทบประกันสังคม: 0,
      หักภาษี: 0
    },
    สรุป: {
      รวมรายได้: 0,
      รวมหัก: 0,
      เงินได้สุทธิ: 0
    },
    วันที่บันทึก: new Date().toISOString(),
    หมายเหตุ: ""
  };
}

// คำนวณยอดสรุป
function calculateSummary(salaryData) {
  const รวมรายได้ = Object.values(salaryData.รายได้ || {}).reduce(
    (sum, val) => sum + (parseFloat(val) || 0), 0
  );
  
  const รวมหัก = Object.values(salaryData.หัก || {}).reduce(
    (sum, val) => sum + (parseFloat(val) || 0), 0
  );
  
  const เงินได้สุทธิ = รวมรายได้ - รวมหัก;
  
  return {
    รวมรายได้,
    รวมหัก,
    เงินได้สุทธิ
  };
}

export default function handler(req, res) {
  try {
    const allData = readSalaryData();
    
    if (req.method === 'GET') {
      const { month } = req.query;
      
      if (month) {
        // ดึงข้อมูลเดือนที่ระบุ
        const monthData = allData[month];
        if (!monthData) {
          // สร้างข้อมูลเริ่มต้นถ้าไม่มี
          const defaultData = createDefaultSalaryStructure();
          allData[month] = defaultData;
          writeSalaryData(allData);
          return res.json(defaultData);
        }
        return res.json(monthData);
      } else {
        // ดึงข้อมูลทั้งหมด
        return res.json(allData);
      }
      
    } else if (req.method === 'POST') {
      const { month, รายได้, หัก, หมายเหตุ } = req.body;
      
      if (!month) {
        return res.status(400).json({ error: 'กรุณาระบุเดือน' });
      }
      
      // เตรียมข้อมูลสำหรับบันทึก
      const salaryData = {
        รายได้: รายได้ || {},
        หัก: หัก || {},
        หมายเหตุ: หมายเหตุ || "",
        วันที่บันทึก: new Date().toISOString()
      };
      
      // คำนวณยอดสรุป
      salaryData.สรุป = calculateSummary(salaryData);
      
      // บันทึกข้อมูล
      allData[month] = salaryData;
      
      if (writeSalaryData(allData)) {
        return res.json({ 
          success: true, 
          message: 'บันทึกข้อมูลเงินเดือนเรียบร้อย',
          data: salaryData 
        });
      } else {
        return res.status(500).json({ error: 'ไม่สามารถบันทึกข้อมูลได้' });
      }
      
    } else if (req.method === 'DELETE') {
      const { month } = req.query;
      
      if (!month) {
        return res.status(400).json({ error: 'กรุณาระบุเดือนที่ต้องการลบ' });
      }
      
      if (allData[month]) {
        delete allData[month];
        
        if (writeSalaryData(allData)) {
          return res.json({ 
            success: true, 
            message: 'ลบข้อมูลเงินเดือนเรียบร้อย' 
          });
        } else {
          return res.status(500).json({ error: 'ไม่สามารถลบข้อมูลได้' });
        }
      } else {
        return res.status(404).json({ error: 'ไม่พบข้อมูลเดือนที่ระบุ' });
      }
      
    } else {
      res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
      return res.status(405).json({ error: 'Method not allowed' });
    }
    
  } catch (error) {
    console.error('Salary API Error:', error);
    return res.status(500).json({ 
      error: 'เกิดข้อผิดพลาดในระบบ',
      details: error.message 
    });
  }
}