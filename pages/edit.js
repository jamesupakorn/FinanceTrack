
import React, { useState } from 'react';
import IncomeTable from '../src/frontend/components/IncomeTable';
import ExpenseTable from '../src/frontend/components/ExpenseTable';
import SavingsTable from '../src/frontend/components/SavingsTable';
import TaxTable from '../src/frontend/components/TaxTable';
import SummaryReport from '../src/frontend/components/SummaryReport';
import SalaryCalculator from '../src/frontend/components/SalaryCalculator';
import MonthManager from '../src/frontend/components/MonthManager';
import ThemeToggle from '../src/frontend/components/ThemeToggle';
import { Icons } from '../src/frontend/components/Icons';
import { useTheme } from '../src/frontend/contexts/ThemeContext';
import { incomeAPI, expenseAPI, savingsAPI, salaryAPI } from '../src/shared/utils/apiUtils';
import styles from '../src/frontend/styles/Home.module.css';

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function EditPage() {
  const { theme } = useTheme();
  const [mode] = useState('edit');
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [activeTab, setActiveTab] = useState('income');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [salaryUpdateTrigger, setSalaryUpdateTrigger] = useState(0);
  const [months, setMonths] = useState([]);

  // ดึงเดือนทั้งหมดจาก expense, income, salary แล้วรวม key
  const fetchMonths = async () => {
    try {
      const [expenseRes, savingsRes, salaryRes] = await Promise.all([
        expenseAPI.getAll(),
        savingsAPI.getAll(),
        salaryAPI.getAll()
      ]);
      const expenseMonths = expenseRes ? Object.keys(expenseRes) : [];
      const savingsMonths = savingsRes ? Object.keys(savingsRes) : [];
      const salaryMonths = salaryRes ? Object.keys(salaryRes) : [];
      const allMonths = Array.from(new Set([...expenseMonths, ...savingsMonths, ...salaryMonths])).sort().reverse();
      setMonths(allMonths);
      const currentMonth = getCurrentMonth();
      if (allMonths.includes(currentMonth)) {
        setSelectedMonth(currentMonth);
      } else if (allMonths.length && !allMonths.includes(selectedMonth)) {
        setSelectedMonth(allMonths[0]);
      }
    } catch (err) {
      setMonths([]);
    }
  };


  React.useEffect(() => {
    fetchMonths();
  }, [refreshTrigger]);

  // เซต selectedMonth เป็นเดือนปัจจุบันทันทีเมื่อ mount ถ้ายังไม่ได้เซต
  React.useEffect(() => {
    if (!selectedMonth && months.length > 0) {
      const currentMonth = getCurrentMonth();
      if (months.includes(currentMonth)) {
        setSelectedMonth(currentMonth);
      } else {
        setSelectedMonth(months[0]);
      }
    }
  }, [months, selectedMonth]);


  const handleDataRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  // Callback สำหรับ SalaryCalculator เมื่อบันทึกเงินเดือน
  const handleSalaryUpdate = () => {
    setSalaryUpdateTrigger(prev => prev + 1);
  };

  const handleMonthSelected = (month) => {
    setSelectedMonth(month);
  };

  return (
    <div className={styles.homeContainer}>
      <div className={styles.mainContent}>
        <header className={styles.pageHeader}>
          <div className={styles.themeToggleContainer}>
            <ThemeToggle mode={mode} />
          </div>
          <h1 className={styles.pageTitle}>
            <Icons.Wallet size={40} color="white" />
            โหมดแก้ไขข้อมูล
          </h1>
        </header>

      <MonthManager 
        selectedMonth={selectedMonth}
        onMonthSelected={handleMonthSelected}
        onDataRefresh={handleDataRefresh}
        months={months}
        mode={mode}
      />


      <div className={styles.sectionCard}>
        <SalaryCalculator 
          selectedMonth={selectedMonth}
          onSalaryUpdate={handleSalaryUpdate}
          key={refreshTrigger}
          mode={mode}
        />
      </div>

      <div className={styles.sectionCard}>
        <SummaryReport 
          selectedMonth={selectedMonth}
          key={`summary-${refreshTrigger}`}
          mode={mode}
        />
      </div>

      <div className={styles.tabNavigation}>
        {[{ id: 'income', label: 'รายรับ', icon: <Icons.TrendingUp size={20} /> },
          { id: 'expense', label: 'รายจ่าย', icon: <Icons.CreditCard size={20} /> },
          { id: 'savings', label: 'เงินออม', icon: <Icons.PiggyBank size={20} /> },
          { id: 'tax', label: 'ภาษี', icon: <Icons.BarChart size={20} /> }
        ].map(tab => (
          <button 
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`${styles.tabButton} ${activeTab === tab.id ? styles.active : ''}`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      <div className={styles.tabContent}>
        {activeTab === 'income' && (
          <div>
            <div className={styles.tabHeader}>
              <h3 className={styles.tabTitle}>
                <Icons.TrendingUp size={24} color="var(--color-primary)" />
                รายรับรายเดือน
              </h3>
            </div>
            <IncomeTable 
              selectedMonth={selectedMonth}
              salaryUpdateTrigger={salaryUpdateTrigger}
              key={`income-${refreshTrigger}`}
              mode={mode}
            />
          </div>
        )}
        {activeTab === 'expense' && (
          <div>
            <div className={styles.tabHeader}>
              <h3 className={styles.tabTitle}>
                <Icons.CreditCard size={24} color="var(--color-danger)" />
                รายจ่ายรายเดือน
              </h3>
            </div>
            <ExpenseTable 
              selectedMonth={selectedMonth}
              key={`expense-${refreshTrigger}`}
              mode={mode}
            />
          </div>
        )}
        {activeTab === 'savings' && (
          <div>
            <div className={styles.tabHeader}>
              <h3 className={styles.tabTitle}>
                <Icons.PiggyBank size={24} color="var(--color-secondary)" />
                เงินออมรายเดือน
              </h3>
            </div>
            <SavingsTable 
              selectedMonth={selectedMonth}
              key={`savings-${refreshTrigger}`}
              mode={mode}
            />
          </div>
        )}
        {activeTab === 'tax' && (
          <div>
            <div className={styles.tabHeader}>
              <h3 className={styles.tabTitle}>
                <Icons.BarChart size={24} color="var(--color-warning)" />
                ภาษีรายเดือน
              </h3>
            </div>
            <TaxTable 
              selectedMonth={selectedMonth}
              key={`tax-${refreshTrigger}`}
              mode={mode}
            />
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
