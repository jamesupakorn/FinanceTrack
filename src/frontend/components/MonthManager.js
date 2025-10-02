import React, { useState, useEffect } from 'react';
import { getNextMonth } from '../../shared/utils/numberUtils';
import styles from '../styles/MonthManager.module.css';


const MonthManager = ({ selectedMonth, onMonthSelected, onDataRefresh, mode = 'view' }) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMonthName, setNewMonthName] = useState('');
  const [monthOptions, setMonthOptions] = useState([]);

  // Fetch all months from expense, income, salary and aggregate unique months
  useEffect(() => {
    let isMounted = true;
    import('../../shared/utils/apiUtils').then(({ expenseAPI, incomeAPI, salaryAPI }) => {
      Promise.all([
        expenseAPI.getAll(),
        incomeAPI.getAll(),
        salaryAPI.getAll()
      ]).then(([expenseData, incomeData, salaryData]) => {
        // Extract months from each data source
        const expenseMonths = expenseData?.months ? Object.keys(expenseData.months) : [];
        const incomeMonths = incomeData?.months ? Object.keys(incomeData.months) : [];
        const salaryMonths = salaryData?.months ? Object.keys(salaryData.months) : [];
        // Union all months
        const allMonthsSet = new Set([...expenseMonths, ...incomeMonths, ...salaryMonths]);
        // กรองเฉพาะ key ที่ตรง format YYYY-MM
        const validMonthRegex = /^\d{4}-\d{2}$/;
        const allMonths = Array.from(allMonthsSet)
          .filter(month => validMonthRegex.test(month))
          .sort((a, b) => b.localeCompare(a));
        // Format for dropdown
        const options = allMonths.map(month => {
          const [year, m] = month.split('-');
          const date = new Date(Number(year), Number(m) - 1, 1);
          const label = date.toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });
          return { value: month, label };
        });
        if (isMounted) setMonthOptions(options);
      });
    });
    return () => { isMounted = false; };
  }, [showAddForm, onDataRefresh]);

  const handleAddNewMonth = () => {
    const nextMonth = getNextMonth(selectedMonth);
    // สร้าง values เริ่มต้นสำหรับทุก item รายจ่าย
    const defaultExpenseItems = [
      "house", "water", "internet", "electricity", "mobile",
      "credit_kbank", "credit_kungsri", "credit_uob", "credit_ttb",
      "shopee", "netflix", "youtube", "youtube_membership",
      "motorcycle", "miscellaneous"
    ];
    const defaultExpenseValues = {};
    defaultExpenseItems.forEach(item => {
      defaultExpenseValues[item] = {
        actual: 0,
        paid: false
      };
    });

    // สร้าง values เริ่มต้นสำหรับรายรับ
    const defaultIncomeItems = ["salary", "income2", "other"];
    const defaultIncomeValues = {};
    defaultIncomeItems.forEach(item => {
      defaultIncomeValues[item] = 0;
    });

    // สร้าง values เริ่มต้นสำหรับ salary
    const defaultSalary = {
      income: {
        salary: 0,
        overtime_1x: 0,
        overtime_1_5x: 0,
        overtime_2x: 0,
        overtime_3x: 0,
        overtime_other: 0,
        bonus: 0,
        other_income: 0
      },
      deduct: {
        provident_fund: 0,
        social_security: 0,
        tax: 0
      },
      note: ""
    };

    // เพิ่มข้อมูลเดือนใหม่ลง backend ทั้ง 3 json
    import('../../shared/utils/apiUtils').then(({ expenseAPI, incomeAPI, salaryAPI }) => {
      Promise.all([
        expenseAPI.save(nextMonth, defaultExpenseValues),
        incomeAPI.save(nextMonth, defaultIncomeValues),
        salaryAPI.save(nextMonth, defaultSalary)
      ]).then(() => {
        onMonthSelected(nextMonth);
        onDataRefresh();
        setShowAddForm(false);
        setNewMonthName('');
      });
    });
  };

  const handleCustomMonth = () => {
    if (newMonthName.trim()) {
      // สร้างเดือนใหม่จากที่กรอก (format: YYYY-MM)
      if (/^\d{4}-\d{2}$/.test(newMonthName)) {
        onMonthChange(newMonthName);
        setShowAddForm(false);
        setNewMonthName('');
      } else {
        alert('กรุณากรอกรูปแบบ YYYY-MM (เช่น 2025-10)');
      }
    }
  };

  // Debug log
  console.log('[MonthManager] selectedMonth prop:', selectedMonth);
  return (
    <div className={styles.monthManager}>
      {/* แสดงเดือนปัจจุบันและ dropdown เลือกเดือน */}
      <div className={styles.currentMonthDisplay}>
        <div className={styles.monthSelectionRow}>
          <label className={styles.monthLabel}>เดือนปัจจุบัน: </label>
          <select 
            value={selectedMonth} 
            onChange={(e) => onMonthSelected(e.target.value)}
            className={styles.monthSelect}
          >
            {monthOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {mode === 'edit' && (
        <div className={styles.monthActions}>
          <button 
            onClick={() => setShowAddForm(!showAddForm)}
            className={styles.addMonthBtn}
          >
            + เพิ่มเดือนใหม่
          </button>
        </div>
      )}

      {showAddForm && mode === 'edit' && (
        <div className={styles.addMonthForm}>
          <div className={styles.formContent}>
            <h4>เพิ่มเดือนใหม่</h4>
            <button 
              onClick={handleAddNewMonth}
              className={styles.quickAddBtn}
            >
              เดือนถัดไป ({getNextMonth(selectedMonth)})
            </button>
            <div className={styles.customMonth}>
              <input
                type="text"
                placeholder="YYYY-MM (เช่น 2025-10)"
                value={newMonthName}
                onChange={(e) => setNewMonthName(e.target.value)}
                className={styles.monthInput}
              />
              <button onClick={handleCustomMonth} className={styles.customAddBtn}>
                เพิ่ม
              </button>
            </div>
            <button 
              onClick={() => setShowAddForm(false)}
              className={styles.cancelBtn}
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

export default MonthManager;