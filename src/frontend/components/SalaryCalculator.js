import React, { useState, useEffect } from 'react';
import { formatCurrency, parseAndFormat, handleNumberInput, handleNumberBlur, parseToNumber, maskNumberFormat, calculateSalaryTotals } from '../../shared/utils/numberUtils';
import { formatSalaryData, splitSalaryData } from '../../shared/utils/salaryUtils';
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

// Mapping English salary keys to Thai labels
const salaryKeyThaiMapping = {
  salary: 'เงินเดือน',
  overtime_1x: 'ค่าล่วงเวลา 1 เท่า',
  overtime_1_5x: 'ค่าล่วงเวลา 1.5 เท่า',
  overtime_2x: 'ค่าล่วงเวลา 2 เท่า',
  overtime_3x: 'ค่าล่วงเวลา 3 เท่า',
  overtime_other: 'ค่าล่วงเวลาอื่นๆ',
  bonus: 'โบนัส',
  other_income: 'เงินได้อื่นๆ',
  provident_fund: 'หักกองทุนสำรองเลี้ยงชีพ',
  social_security: 'หักสมทบประกันสังคม',
  tax: 'หักภาษี'
};

const SalaryCalculator = ({ selectedMonth, onSalaryUpdate, mode = 'view' }) => {

  const [salaryData, setSalaryData] = useState({
    // รายได้
    salary: '',
    overtime_1x: '',
    overtime_1_5x: '',
    overtime_2x: '',
    overtime_3x: '',
    overtime_other: '',
    bonus: '',
    other_income: '',

    // หัก
    provident_fund: '',
    social_security: '750',
    tax: ''
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
      if (data && data.income && data.deduct) {
        // รวมข้อมูลและ format ด้วยฟังก์ชันกลาง
        const rawData = { ...data.income, ...data.deduct };
        setSalaryData(formatSalaryData(rawData, parseAndFormat));
      }
    } catch (error) {
      console.error('Error loading salary data:', error);
    }
  };

  const calculateTotals = () => {
    // ใช้ summary จาก backend ถ้ามี
    if (salaryData && salaryData.summary) {
      setCalculatedResults({
        รวมรายได้: salaryData.summary.total_income || 0,
        รวมหัก: salaryData.summary.total_deduct || 0,
        เงินได้สุทธิ: salaryData.summary.net_income || 0
      });
    } else {
      setCalculatedResults(calculateSalaryTotals(salaryData));
    }
  };

  const handleInputChange = (field, value) => {
    // เก็บค่าแบบ raw ไว้ระหว่างการพิมพ์
    handleNumberInput(value, setSalaryData, field);
  };

  const handleInputBlur = (field, value) => {
    // Format เฉพาะเมื่อออกจาก input
    handleNumberInput(value, setSalaryData, field);
  };

  const saveSalaryData = async () => {
    try {
      // แยกข้อมูลรายได้และหักด้วยฟังก์ชันกลาง
      const { income, deduction } = splitSalaryData(salaryData, parseToNumber);

      // บันทึกข้อมูลเงินเดือนเฉพาะ salary.json
      const result = await salaryAPI.save(selectedMonth, income, deduction);

      if (result.success) {
        // อัพเดตข้อมูลภาษีรายเดือนใน tax_accumulated
        try {
          // แปลง selectedMonth เป็นปี พ.ศ. และเลขเดือน
          const [yearStr, monthStr] = selectedMonth.split('-');
          const year = (parseInt(yearStr) + 543).toString();
          const month = monthStr.padStart(2, '0');
          const taxValue = deduction.tax || 0;
          await fetch('/api/tax_accumulated', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              year,
              ภาษีรายเดือน: { [month]: taxValue }
            })
          });
        } catch (e) {
          // ไม่ต้องแจ้ง error ให้ user
        }
        // อัพเดต monthly_income.json ด้วยเงินได้สุทธิ
        try {
          await fetch('/api/monthly_income', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              month: selectedMonth,
              values: {
                salary: calculatedResults.เงินได้สุทธิ,
                income2: 0,
                other: 0
              }
            })
          });
        } catch (e) {
          // ไม่ต้องแจ้ง error ให้ user
        }
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
      salary: '',
      overtime_1x: '',
      overtime_1_5x: '',
      overtime_2x: '',
      overtime_3x: '',
      overtime_other: '',
      bonus: '',
      other_income: '',
      provident_fund: '',
      social_security: '750',
      tax: ''
    });
  };

  // Helper: format value for display
  const getDisplayValue = (value) => {
    const num = parseToNumber(value);
    return num === 0 ? '0' : maskNumberFormat(num);
  };

  return (
    <div className={styles.salaryCalculator}>
      <h2 className={styles.title}>คำนวณเงินเดือน - {selectedMonth ? getThaiMonthName(selectedMonth) : 'กรุณาเลือกเดือน'}</h2>

      <div className={styles.salaryContent}>
        {/* ส่วนรายได้ */}
        <div className={styles.incomeSection}>
          <h3 className={`${styles.sectionTitle} ${styles.incomeTitle}`}>รายได้</h3>
          <div className={styles.inputGrid}>
            {['salary', 'overtime_1x', 'overtime_1_5x', 'overtime_2x', 'overtime_3x', 'overtime_other', 'bonus', 'other_income'].map((key) => (
              <div className={styles.inputGroup} key={key}>
                <label>{salaryKeyThaiMapping[key]}</label>
                {mode === 'edit' ? (
                  <input
                    type="text"
                    value={salaryData[key]}
                    onChange={e => handleNumberInput(e.target.value, setSalaryData, key)}
                    onBlur={e => handleNumberBlur(e.target.value, setSalaryData, key)}
                    placeholder="0.00"
                  />
                ) : (
                  <span>{getDisplayValue(salaryData[key])}</span>
                )}
              </div>
            ))}
          </div>
          <div className={`${styles.subtotal} ${styles.incomeSubtotal}`}>
            <span>รวมรายได้: </span>
            <span className={styles.amount}>{mode === 'edit' ? formatCurrency(calculatedResults.รวมรายได้) : getDisplayValue(calculatedResults.รวมรายได้)}</span>
          </div>
        </div>

        {/* ส่วนหัก */}
        <div className={styles.deductionSection}>
          <h3 className={`${styles.sectionTitle} ${styles.deductionTitle}`}>หัก</h3>
          <div className={styles.inputGrid}>
            {['provident_fund', 'social_security', 'tax'].map((key) => (
              <div className={styles.inputGroup} key={key}>
                <label>{salaryKeyThaiMapping[key]}</label>
                {mode === 'edit' ? (
                  <input
                    type="text"
                    value={salaryData[key]}
                    onChange={e => handleNumberInput(e.target.value, setSalaryData, key)}
                    onBlur={e => handleNumberBlur(e.target.value, setSalaryData, key)}
                    placeholder="0.00"
                  />
                ) : (
                  <span>{getDisplayValue(salaryData[key])}</span>
                )}
              </div>
            ))}
          </div>
          <div className={`${styles.subtotal} ${styles.deductionSubtotal}`}>
            <span>รวมหัก: </span>
            <span className={styles.amount}>{mode === 'edit' ? formatCurrency(calculatedResults.รวมหัก) : getDisplayValue(calculatedResults.รวมหัก)}</span>
          </div>
        </div>
      </div>

      {/* ผลลัพธ์สุทธิ */}
      <div className={styles.netResult}>
  <h3>เงินได้สุทธิ: <span className={styles.netAmount}>{mode === 'edit' ? formatCurrency(calculatedResults.เงินได้สุทธิ) : getDisplayValue(calculatedResults.เงินได้สุทธิ)}</span></h3>
      </div>

      {/* ปุ่มจัดการ */}
      {mode === 'edit' && (
        <div className={styles.actionButtons}>
          <button onClick={saveSalaryData} className={styles.saveBtn}>
            บันทึกเงินเดือน
          </button>
          <button onClick={clearAll} className={styles.clearBtn}>
            ล้างข้อมูล
          </button>
        </div>
      )}
    </div>
  );
};

export default SalaryCalculator;