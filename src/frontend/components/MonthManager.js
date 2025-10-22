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

    const handleAddNewMonth = async () => {
    const nextMonth = getNextMonth(selectedMonth);
      // ดึงข้อมูลเดือนล่าสุดของแต่ละหมวด
      const importApis = await import('../../shared/utils/apiUtils');
      const { expenseAPI, incomeAPI, salaryAPI, savingsAPI, investmentAPI } = importApis;

      // หาเดือนล่าสุดที่มีข้อมูลในแต่ละหมวด
      const [expenseAll, incomeAll, salaryAll, savingsAll, investmentAll] = await Promise.all([
        expenseAPI.getAll(),
        incomeAPI.getAll(),
        salaryAPI.getAll(),
        savingsAPI.getAll ? savingsAPI.getAll() : Promise.resolve({}),
        investmentAPI.getAll ? investmentAPI.getAll() : Promise.resolve({})
      ]);

      // Helper: หาเดือนล่าสุดที่มีข้อมูล (เรียงจากใหม่ไปเก่า)
      function getLatestMonth(obj) {
        if (!obj || !obj.months) return null;
        const months = Object.keys(obj.months).filter(m => /^\d{4}-\d{2}$/.test(m));
        return months.sort((a, b) => b.localeCompare(a))[0] || null;
      }

      // รายจ่าย
      let expenseLatestMonth = getLatestMonth(expenseAll);
      let expenseLatest = (expenseAll.months && expenseAll.months[expenseLatestMonth]) ? JSON.parse(JSON.stringify(expenseAll.months[expenseLatestMonth])) : {};

      // รายรับ
      let incomeLatestMonth = getLatestMonth(incomeAll);
      let incomeLatest = (incomeAll.months && incomeAll.months[incomeLatestMonth]) ? JSON.parse(JSON.stringify(incomeAll.months[incomeLatestMonth])) : {};

      // เงินเดือน
      let salaryLatestMonth = getLatestMonth(salaryAll);
      let salaryLatest = (salaryAll.months && salaryAll.months[salaryLatestMonth]) ? JSON.parse(JSON.stringify(salaryAll.months[salaryLatestMonth])) : {};

      // เงินออม (optional)
      let savingsLatest = {};
      if (savingsAll && savingsAll.savings_list) {
        const savingsMonths = Object.keys(savingsAll.savings_list).filter(m => /^\d{4}-\d{2}$/.test(m));
        const latestSavingsMonth = savingsMonths.sort((a, b) => b.localeCompare(a))[0];
        savingsLatest = latestSavingsMonth ? JSON.parse(JSON.stringify(savingsAll.savings_list[latestSavingsMonth])) : [];
      }

      // การลงทุน (optional)
      let investmentLatest = [];
      if (investmentAll) {
        const investMonths = Object.keys(investmentAll).filter(m => /^\d{4}-\d{2}$/.test(m));
        const latestInvestMonth = investMonths.sort((a, b) => b.localeCompare(a))[0];
        investmentLatest = latestInvestMonth ? JSON.parse(JSON.stringify(investmentAll[latestInvestMonth])) : [];
      }

      // Save ข้อมูล copy ไปเดือนใหม่
      await Promise.all([
        expenseAPI.save(nextMonth, expenseLatest),
        incomeAPI.save(nextMonth, incomeLatest),
        salaryAPI.save(nextMonth, salaryLatest.income || {}, salaryLatest.deduct || {}, salaryLatest.note || ''),
        savingsAPI.saveList ? savingsAPI.saveList(nextMonth, savingsLatest) : Promise.resolve(),
        investmentAPI.saveList ? investmentAPI.saveList(nextMonth, investmentLatest) : Promise.resolve()
      ]);

      onMonthSelected(nextMonth);
      onDataRefresh();
      setShowAddForm(false);
      setNewMonthName('');
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