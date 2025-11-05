import React, { useState, useEffect } from 'react';
import { getNextMonth } from '../../shared/utils/numberUtils';
import styles from '../styles/MonthManager.module.css';


const MonthManager = ({ selectedMonth, onMonthSelected, onDataRefresh, mode = 'view' }) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMonthName, setNewMonthName] = useState('');
  const [monthOptions, setMonthOptions] = useState([]);

  // ถ้า selectedMonth ไม่มีใน monthOptions ให้เลือกเดือนล่าสุดอัตโนมัติ
  useEffect(() => {
    if (monthOptions.length > 0) {
      const monthValues = monthOptions.map(opt => opt.value);
      if (!selectedMonth || !monthValues.includes(selectedMonth)) {
        // เลือกเดือนล่าสุด (ตัวแรกใน options เพราะเรียงใหม่ -> เก่า)
        onMonthSelected(monthOptions[0].value);
      }
    }
  }, [monthOptions, selectedMonth, onMonthSelected]);

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

    const handleAddNewMonth = async () => {
      const nextMonth = getNextMonth(selectedMonth);
      // สร้างข้อมูลเปล่า (ไม่ copy)
      const importApis = await import('../../shared/utils/apiUtils');
      const { expenseAPI, incomeAPI, salaryAPI, savingsAPI, investmentAPI } = importApis;
      await Promise.all([
        expenseAPI.save(nextMonth, {}),
        incomeAPI.save(nextMonth, {}),
        salaryAPI.save(nextMonth, {}, {}, ''),
        savingsAPI.saveList ? savingsAPI.saveList(nextMonth, []) : Promise.resolve(),
        investmentAPI.saveList ? investmentAPI.saveList(nextMonth, []) : Promise.resolve()
      ]);
      onMonthSelected(nextMonth);
      onDataRefresh();
      setShowAddForm(false);
      setNewMonthName('');
    };

    // ปุ่ม copy ข้อมูลจากเดือนก่อนหน้า
    const handleCopyPrevMonth = async () => {
      if (!newMonthName || !/^\d{4}-\d{2}$/.test(newMonthName)) {
        alert('กรุณากรอกเดือนใหม่ให้ถูกต้องก่อน (YYYY-MM)');
        return;
      }
      // หาเดือนก่อนหน้า
      const prevMonth = (() => {
        const [y, m] = newMonthName.split('-').map(Number);
        let prevY = y, prevM = m - 1;
        if (prevM < 1) { prevY -= 1; prevM = 12; }
        return `${prevY}-${String(prevM).padStart(2, '0')}`;
      })();
      const importApis = await import('../../shared/utils/apiUtils');
      const { expenseAPI, incomeAPI, salaryAPI, savingsAPI, investmentAPI } = importApis;
      // ดึงข้อมูลเดือนก่อนหน้า
      const [expenseAll, incomeAll, salaryAll, savingsAll, investmentAll] = await Promise.all([
        expenseAPI.getAll(),
        incomeAPI.getAll(),
        salaryAPI.getAll(),
        savingsAPI.getAll ? savingsAPI.getAll() : Promise.resolve({}),
        investmentAPI.getAll ? investmentAPI.getAll() : Promise.resolve({})
      ]);
      // Helper: หาเดือนที่ต้องการ
      function getMonthData(obj, month) {
        if (!obj || !obj.months) return {};
        return obj.months[month] ? JSON.parse(JSON.stringify(obj.months[month])) : {};
      }
      // รายจ่าย
      let expensePrev = getMonthData(expenseAll, prevMonth);
      // รายรับ
      let incomePrev = getMonthData(incomeAll, prevMonth);
      // เงินเดือน
      let salaryPrev = getMonthData(salaryAll, prevMonth);
      // เงินออม
      let savingsPrev = [];
      if (savingsAll && savingsAll.savings_list && savingsAll.savings_list[prevMonth]) {
        savingsPrev = JSON.parse(JSON.stringify(savingsAll.savings_list[prevMonth]));
      }
      // การลงทุน
      let investmentPrev = [];
      if (investmentAll && investmentAll[prevMonth]) {
        investmentPrev = JSON.parse(JSON.stringify(investmentAll[prevMonth]));
      }
      // Save ข้อมูล copy ไปเดือนใหม่
      await Promise.all([
        expenseAPI.save(newMonthName, expensePrev),
        incomeAPI.save(newMonthName, incomePrev),
        salaryAPI.save(newMonthName, salaryPrev.income || {}, salaryPrev.deduct || {}, salaryPrev.note || ''),
        savingsAPI.saveList ? savingsAPI.saveList(newMonthName, savingsPrev) : Promise.resolve(),
        investmentAPI.saveList ? investmentAPI.saveList(newMonthName, investmentPrev) : Promise.resolve()
      ]);
      onMonthSelected(newMonthName);
      onDataRefresh();
      setShowAddForm(false);
      setNewMonthName('');
    };

  const handleCustomMonth = () => {
    if (newMonthName.trim()) {
      // สร้างเดือนใหม่จากที่กรอก (format: YYYY-MM)
      if (/^\d{4}-\d{2}$/.test(newMonthName)) {
          onMonthSelected(newMonthName);
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
            value={selectedMonth ?? ''} 
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
                เพิ่ม (ข้อมูลเปล่า)
              </button>
              <button onClick={handleCopyPrevMonth} className={styles.customAddBtn} style={{marginLeft:8}}>
                ดึงข้อมูลจากเดือนก่อนหน้า
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