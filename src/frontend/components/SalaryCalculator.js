import React, { useState, useEffect } from 'react';
import { formatCurrency, parseAndFormat } from '../../shared/utils/numberUtils';
import { salaryAPI, incomeAPI } from '../../shared/utils/apiUtils';
import styles from '../styles/SalaryCalculator.module.css';

// ฟังก์ชันสำหรับแปลงเดือนเป็นชื่อภาษาไทย
const getThaiMonthName = (monthStr) => {
  if (!monthStr) return '';
  const [year, month] = monthStr.split('-');
  const monthNames = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];
  return `${monthNames[parseInt(month) - 1]} ${year}`;
};

const SalaryCalculator = ({ selectedMonth, onSalaryUpdate }) => {
  const [salaryData, setSalaryData] = useState({
    // รายได้
    เงินเดือน: '',
    ค่าล่วงเวลา_1เท่า: '',
    ค่าล่วงเวลา_1_5เท่า: '',
    ค่าล่วงเวลา_2เท่า: '',
    ค่าล่วงเวลา_3เท่า: '',
    ค่าล่วงเวลาอื่นๆ: '',
    โบนัส: '',
    เงินได้อื่นๆ: '',
    
    // หัก
    หักกองทุนสำรองเลี้ยงชีพ: '',
    หักสมทบประกันสังคม: '',
    หักภาษี: ''
  });

  const [calculatedResults, setCalculatedResults] = useState({
    รวมรายได้: 0,
    รวมหัก: 0,
    เงินได้สุทธิ: 0
  });

  // คำนวณยอดรวมเมื่อข้อมูลเปลี่ยน
  useEffect(() => {
    calculateTotals();
  }, [salaryData]);

  // โหลดข้อมูลเมื่อเปลี่ยนเดือน
  useEffect(() => {
    if (selectedMonth) {
      loadSalaryData();
    }
  }, [selectedMonth]);

  const loadSalaryData = async () => {
    try {
      const data = await salaryAPI.getByMonth(selectedMonth);
      if (data && data.รายได้ && data.หัก) {
        setSalaryData({
          ...data.รายได้,
          ...data.หัก
        });
      }
    } catch (error) {
      console.error('Error loading salary data:', error);
    }
  };

  const calculateTotals = () => {
    // คำนวณรวมรายได้
    const totalIncome = [
      'เงินเดือน', 'ค่าล่วงเวลา_1เท่า', 'ค่าล่วงเวลา_1_5เท่า', 
      'ค่าล่วงเวลา_2เท่า', 'ค่าล่วงเวลา_3เท่า', 'ค่าล่วงเวลาอื่นๆ', 
      'โบนัส', 'เงินได้อื่นๆ'
    ].reduce((sum, key) => sum + (parseFloat(salaryData[key]) || 0), 0);

    // คำนวณรวมหัก
    const totalDeduction = [
      'หักกองทุนสำรองเลี้ยงชีพ', 'หักสมทบประกันสังคม', 'หักภาษี'
    ].reduce((sum, key) => sum + (parseFloat(salaryData[key]) || 0), 0);

    // คำนวณเงินได้สุทธิ
    const netIncome = totalIncome - totalDeduction;

    setCalculatedResults({
      รวมรายได้: totalIncome,
      รวมหัก: totalDeduction,
      เงินได้สุทธิ: netIncome
    });
  };

  const handleInputChange = (field, value) => {
    // เก็บค่าแบบ raw ไว้ระหว่างการพิมพ์
    setSalaryData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleInputBlur = (field, value) => {
    // Format เฉพาะเมื่อออกจาก input
    const formattedValue = parseAndFormat(value);
    setSalaryData(prev => ({
      ...prev,
      [field]: formattedValue
    }));
  };

  const saveSalaryData = async () => {
    try {
      // แยกข้อมูลรายได้และหัก
      const รายได้ = {
        เงินเดือน: parseFloat(salaryData.เงินเดือน) || 0,
        ค่าล่วงเวลา_1เท่า: parseFloat(salaryData.ค่าล่วงเวลา_1เท่า) || 0,
        ค่าล่วงเวลา_1_5เท่า: parseFloat(salaryData.ค่าล่วงเวลา_1_5เท่า) || 0,
        ค่าล่วงเวลา_2เท่า: parseFloat(salaryData.ค่าล่วงเวลา_2เท่า) || 0,
        ค่าล่วงเวลา_3เท่า: parseFloat(salaryData.ค่าล่วงเวลา_3เท่า) || 0,
        ค่าล่วงเวลาอื่นๆ: parseFloat(salaryData.ค่าล่วงเวลาอื่นๆ) || 0,
        โบนัส: parseFloat(salaryData.โบนัส) || 0,
        เงินได้อื่นๆ: parseFloat(salaryData.เงินได้อื่นๆ) || 0
      };

      const หัก = {
        หักกองทุนสำรองเลี้ยงชีพ: parseFloat(salaryData.หักกองทุนสำรองเลี้ยงชีพ) || 0,
        หักสมทบประกันสังคม: parseFloat(salaryData.หักสมทบประกันสังคม) || 0,
        หักภาษี: parseFloat(salaryData.หักภาษี) || 0
      };

      // บันทึกข้อมูลเงินเดือนเฉพาะ salary.json
      const result = await salaryAPI.save(selectedMonth, รายได้, หัก);
      
      if (result.success) {
        // เรียก callback เพื่อให้ parent component อัพเดต
        if (onSalaryUpdate) {
          onSalaryUpdate();
        }
        
        alert('บันทึกข้อมูลเงินเดือนเรียบร้อย');
      } else {
        alert('เกิดข้อผิดพลาด: ' + (result.error || 'ไม่สามารถบันทึกได้'));
      }
    } catch (error) {
      console.error('Error saving salary data:', error);
      alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    }
  };

  const clearAll = () => {
    setSalaryData({
      เงินเดือน: '',
      ค่าล่วงเวลา_1เท่า: '',
      ค่าล่วงเวลา_1_5เท่า: '',
      ค่าล่วงเวลา_2เท่า: '',
      ค่าล่วงเวลา_3เท่า: '',
      ค่าล่วงเวลาอื่นๆ: '',
      โบนัส: '',
      เงินได้อื่นๆ: '',
      หักกองทุนสำรองเลี้ยงชีพ: '',
      หักสมทบประกันสังคม: '',
      หักภาษี: ''
    });
  };

  return (
    <div className={styles.salaryCalculator}>
      <h2 className={styles.title}>คำนวณเงินเดือน - {selectedMonth ? getThaiMonthName(selectedMonth) : 'กรุณาเลือกเดือน'}</h2>
      
      <div className={styles.salaryContent}>
        {/* ส่วนรายได้ */}
        <div className={styles.incomeSection}>
          <h3 className={`${styles.sectionTitle} ${styles.incomeTitle}`}>รายได้</h3>
          
          <div className={styles.inputGrid}>
            <div className={styles.inputGroup}>
              <label>เงินเดือน</label>
              <input
                type="text"
                value={salaryData.เงินเดือน}
                onChange={(e) => handleInputChange('เงินเดือน', e.target.value)}
                onBlur={(e) => handleInputBlur('เงินเดือน', e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className={styles.inputGroup}>
              <label>ค่าล่วงเวลา 1 เท่า</label>
              <input
                type="text"
                value={salaryData.ค่าล่วงเวลา_1เท่า}
                onChange={(e) => handleInputChange('ค่าล่วงเวลา_1เท่า', e.target.value)}
                onBlur={(e) => handleInputBlur('ค่าล่วงเวลา_1เท่า', e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className={styles.inputGroup}>
              <label>ค่าล่วงเวลา 1.5 เท่า</label>
              <input
                type="text"
                value={salaryData.ค่าล่วงเวลา_1_5เท่า}
                onChange={(e) => handleInputChange('ค่าล่วงเวลา_1_5เท่า', e.target.value)}
                onBlur={(e) => handleInputBlur('ค่าล่วงเวลา_1_5เท่า', e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className={styles.inputGroup}>
              <label>ค่าล่วงเวลา 2 เท่า</label>
              <input
                type="text"
                value={salaryData.ค่าล่วงเวลา_2เท่า}
                onChange={(e) => handleInputChange('ค่าล่วงเวลา_2เท่า', e.target.value)}
                onBlur={(e) => handleInputBlur('ค่าล่วงเวลา_2เท่า', e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className={styles.inputGroup}>
              <label>ค่าล่วงเวลา 3 เท่า</label>
              <input
                type="text"
                value={salaryData.ค่าล่วงเวลา_3เท่า}
                onChange={(e) => handleInputChange('ค่าล่วงเวลา_3เท่า', e.target.value)}
                onBlur={(e) => handleInputBlur('ค่าล่วงเวลา_3เท่า', e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className={styles.inputGroup}>
              <label>ค่าล่วงเวลาอื่นๆ</label>
              <input
                type="text"
                value={salaryData.ค่าล่วงเวลาอื่นๆ}
                onChange={(e) => handleInputChange('ค่าล่วงเวลาอื่นๆ', e.target.value)}
                onBlur={(e) => handleInputBlur('ค่าล่วงเวลาอื่นๆ', e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className={styles.inputGroup}>
              <label>โบนัส</label>
              <input
                type="text"
                value={salaryData.โบนัส}
                onChange={(e) => handleInputChange('โบนัส', e.target.value)}
                onBlur={(e) => handleInputBlur('โบนัส', e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className={styles.inputGroup}>
              <label>เงินได้อื่นๆ</label>
              <input
                type="text"
                value={salaryData.เงินได้อื่นๆ}
                onChange={(e) => handleInputChange('เงินได้อื่นๆ', e.target.value)}
                onBlur={(e) => handleInputBlur('เงินได้อื่นๆ', e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className={`${styles.subtotal} ${styles.incomeSubtotal}`}>
            <span>รวมรายได้: </span>
            <span className={styles.amount}>{formatCurrency(calculatedResults.รวมรายได้)}</span>
          </div>
        </div>

        {/* ส่วนหัก */}
        <div className={styles.deductionSection}>
          <h3 className={`${styles.sectionTitle} ${styles.deductionTitle}`}>หัก</h3>
          
          <div className={styles.inputGrid}>
            <div className={styles.inputGroup}>
              <label>หักกองทุนสำรองเลี้ยงชีพ</label>
              <input
                type="text"
                value={salaryData.หักกองทุนสำรองเลี้ยงชีพ}
                onChange={(e) => handleInputChange('หักกองทุนสำรองเลี้ยงชีพ', e.target.value)}
                onBlur={(e) => handleInputBlur('หักกองทุนสำรองเลี้ยงชีพ', e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className={styles.inputGroup}>
              <label>หักสมทบประกันสังคม</label>
              <input
                type="text"
                value={salaryData.หักสมทบประกันสังคม}
                onChange={(e) => handleInputChange('หักสมทบประกันสังคม', e.target.value)}
                onBlur={(e) => handleInputBlur('หักสมทบประกันสังคม', e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className={styles.inputGroup}>
              <label>หักภาษี</label>
              <input
                type="text"
                value={salaryData.หักภาษี}
                onChange={(e) => handleInputChange('หักภาษี', e.target.value)}
                onBlur={(e) => handleInputBlur('หักภาษี', e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className={`${styles.subtotal} ${styles.deductionSubtotal}`}>
            <span>รวมหัก: </span>
            <span className={styles.amount}>{formatCurrency(calculatedResults.รวมหัก)}</span>
          </div>
        </div>
      </div>

      {/* ผลลัพธ์สุทธิ */}
      <div className={styles.netResult}>
        <h3>เงินได้สุทธิ: <span className={styles.netAmount}>{formatCurrency(calculatedResults.เงินได้สุทธิ)}</span></h3>
      </div>

      {/* ปุ่มจัดการ */}
      <div className={styles.actionButtons}>
        <button onClick={saveSalaryData} className={styles.saveBtn}>
          บันทึกเงินเดือน
        </button>
        <button onClick={clearAll} className={styles.clearBtn}>
          ล้างข้อมูล
        </button>
      </div>
    </div>
  );
};

export default SalaryCalculator;