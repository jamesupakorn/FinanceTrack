import React, { useState, useEffect } from 'react';
import { getNextMonth } from '../../shared/utils/frontend/numberUtils';
import { getMonthData, getPrevMonth, formatMonthLabelTH } from '../../shared/utils/frontend/monthUtils';
import styles from '../styles/MonthManager.module.css';


const MonthManager = ({ selectedMonth, onMonthSelected, onDataRefresh }) => {
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

  // ดึงและรวมเดือนจากทุกแหล่งข้อมูล
  useEffect(() => {
    let isMounted = true;
    const fetchMonths = async () => {
      const { expenseAPI, incomeAPI, salaryAPI } = await import('../../shared/utils/frontend/apiUtils');
      const [expenseData, incomeData, salaryData] = await Promise.all([
        expenseAPI.getAll(),
        incomeAPI.getAll(),
        salaryAPI.getAll()
      ]);
      // รวมเดือนจากทุกแหล่ง
      const getMonths = data => (data?.months ? Object.keys(data.months) : []);
      const allMonthsSet = new Set([
        ...getMonths(expenseData),
        ...getMonths(incomeData),
        ...getMonths(salaryData)
      ]);
      const validMonthRegex = /^\d{4}-\d{2}$/;
      const allMonths = Array.from(allMonthsSet)
        .filter(month => validMonthRegex.test(month))
        .sort((a, b) => b.localeCompare(a));
      const options = allMonths.map(month => ({
        value: month,
        label: formatMonthLabelTH(month)
      }));
      if (isMounted) setMonthOptions(options);
    };
    fetchMonths();
    return () => { isMounted = false; };
  }, [showAddForm, onDataRefresh]);

  // สร้างเดือนใหม่ (ข้อมูลเปล่า)
  const handleAddNewMonth = async () => {
    const nextMonth = getNextMonth(selectedMonth);
    const { expenseAPI, incomeAPI, salaryAPI, savingsAPI, investmentAPI } = await import('../../shared/utils/frontend/apiUtils');
    // Save new month data
    await Promise.all([
      expenseAPI.save(nextMonth, {}),
      incomeAPI.save(nextMonth, {}),
      salaryAPI.save(nextMonth, {}, {}, ''),
      savingsAPI.saveList ? savingsAPI.saveList(nextMonth, []) : Promise.resolve(),
      investmentAPI.saveList ? investmentAPI.saveList(nextMonth, []) : Promise.resolve()
    ]);

    // Fetch all months after adding new month
    const [expenseData, incomeData, salaryData] = await Promise.all([
      expenseAPI.getAll(),
      incomeAPI.getAll(),
      salaryAPI.getAll()
    ]);
    const getMonths = data => (data?.months ? Object.keys(data.months) : []);
    const allMonthsSet = new Set([
      ...getMonths(expenseData),
      ...getMonths(incomeData),
      ...getMonths(salaryData)
    ]);
    const validMonthRegex = /^\d{4}-\d{2}$/;
    const allMonths = Array.from(allMonthsSet)
      .filter(month => validMonthRegex.test(month))
      .sort((a, b) => b.localeCompare(a)); // new -> old

    // If more than 15 months, delete the oldest
    if (allMonths.length > 15) {
      const oldestMonth = allMonths[allMonths.length - 1];
      await Promise.all([
        expenseAPI.delete ? expenseAPI.delete(oldestMonth) : Promise.resolve(),
        incomeAPI.delete ? incomeAPI.delete(oldestMonth) : Promise.resolve(),
        salaryAPI.delete ? salaryAPI.delete(oldestMonth) : Promise.resolve(),
        savingsAPI.delete ? savingsAPI.delete(oldestMonth) : Promise.resolve(),
        investmentAPI.delete ? investmentAPI.delete(oldestMonth) : Promise.resolve()
      ]);
    }

    onMonthSelected(nextMonth);
    onDataRefresh();
    setShowAddForm(false);
    setNewMonthName('');
  };

  // คัดลอกข้อมูลจากเดือนก่อนหน้า
  const handleCopyPrevMonth = async () => {
    if (!selectedMonth || !/^\d{4}-\d{2}$/.test(selectedMonth)) {
      alert('กรุณาเลือกเดือนที่ต้องการก่อน (YYYY-MM)');
      return;
    }
    const prevMonth = getPrevMonth(selectedMonth);
    const { expenseAPI, incomeAPI, salaryAPI, savingsAPI, investmentAPI } = await import('../../shared/utils/frontend/apiUtils');
    const [expenseAll, incomeAll, salaryAll, savingsAll, investmentAll] = await Promise.all([
      expenseAPI.getAll(),
      incomeAPI.getAll(),
      salaryAPI.getAll(),
      savingsAPI.getAll ? savingsAPI.getAll() : Promise.resolve({}),
      investmentAPI.getAll ? investmentAPI.getAll() : Promise.resolve({})
    ]);
    // ดึงข้อมูลเดือนก่อนหน้า
    const expensePrev = getMonthData(expenseAll, prevMonth);
    const incomePrev = getMonthData(incomeAll, prevMonth);
    const salaryPrev = getMonthData(salaryAll, prevMonth);
    let savingsPrev = [];
    if (savingsAll && savingsAll.savings_list && savingsAll.savings_list[prevMonth]) {
      savingsPrev = JSON.parse(JSON.stringify(savingsAll.savings_list[prevMonth]));
    }
    let investmentPrev = [];
    if (investmentAll && investmentAll[prevMonth]) {
      investmentPrev = JSON.parse(JSON.stringify(investmentAll[prevMonth]));
    }
    await Promise.all([
      expenseAPI.save(selectedMonth, expensePrev),
      incomeAPI.save(selectedMonth, incomePrev),
      salaryAPI.save(selectedMonth, salaryPrev.income || {}, salaryPrev.deduct || {}, salaryPrev.note || ''),
      savingsAPI.saveList ? savingsAPI.saveList(selectedMonth, savingsPrev) : Promise.resolve(),
      investmentAPI.saveList ? investmentAPI.saveList(selectedMonth, investmentPrev) : Promise.resolve()
    ]);
    onMonthSelected(selectedMonth);
    onDataRefresh();
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

      <div className={styles.monthActions}>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className={styles.addMonthBtn}
          aria-label="เพิ่มเดือนใหม่"
          tabIndex={0}
        >
          + เพิ่มเดือนใหม่
        </button>
        <button
          onClick={handleCopyPrevMonth}
          className={`${styles.addMonthBtn} ${styles.addMonthBtnMargin}`}
          aria-label="คัดลอกข้อมูลจากเดือนก่อนหน้า"
          tabIndex={0}
        >
          ดึงข้อมูลจากเดือนก่อนหน้า
        </button>
      </div>

      {showAddForm && (
        <div className={styles.addMonthForm} tabIndex={-1} aria-modal="true" role="dialog">
          <div className={styles.formContent}>
            <button
              className={styles.closeModalBtn}
              aria-label="ปิดหน้าต่าง"
              onClick={() => setShowAddForm(false)}
              tabIndex={0}
            >
              ×
            </button>
            <h4>เพิ่มเดือนใหม่</h4>
            <button
              onClick={handleAddNewMonth}
              className={styles.quickAddBtn}
              aria-label={`เพิ่มเดือนถัดไป (${getNextMonth(selectedMonth)})`}
              tabIndex={0}
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
                aria-label="กรอกเดือนใหม่ (YYYY-MM)"
                tabIndex={0}
              />
              <button
                onClick={handleCustomMonth}
                className={styles.customAddBtn}
                aria-label="เพิ่มเดือนที่กรอกเอง"
                tabIndex={0}
              >
                เพิ่ม
              </button>
            </div>
            <button
              onClick={() => setShowAddForm(false)}
              className={styles.cancelBtn}
              aria-label="ยกเลิก"
              tabIndex={0}
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