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
import { generateMonthOptions } from '../src/shared/utils/numberUtils';
import { incomeAPI, expenseAPI, savingsAPI, salaryAPI } from '../src/shared/utils/apiUtils';
import styles from '../src/frontend/styles/Home.module.css';


function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function HomeContent() {
  const { theme } = useTheme();
  const [selectedMonth, setSelectedMonth] = useState(null); // null for first load
  const [activeTab, setActiveTab] = useState('income');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
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
      console.log('[DEBUG] expenseMonths:', expenseMonths);
      console.log('[DEBUG] savingsMonths:', savingsMonths);
      console.log('[DEBUG] salaryMonths:', salaryMonths);
      console.log('[DEBUG] allMonths:', allMonths);
      setMonths(allMonths);
      const currentMonth = getCurrentMonth();
      console.log('[DEBUG] currentMonth:', currentMonth);
      if (allMonths.includes(currentMonth)) {
        console.log('[DEBUG] setSelectedMonth:', currentMonth);
        setSelectedMonth(currentMonth);
      } else if (allMonths.length && !allMonths.includes(selectedMonth)) {
        console.log('[DEBUG] setSelectedMonth fallback:', allMonths[0]);
        setSelectedMonth(allMonths[0]);
      }
      console.log('[DEBUG] selectedMonth after set:', selectedMonth);
    } catch (err) {
      setMonths([]);
      console.log('[DEBUG] fetchMonths error:', err);
    }
  };


  // โหลดเดือนเมื่อ mount หรือ refresh
  React.useEffect(() => {
    console.log('[useEffect] call fetchMonths, refreshTrigger:', refreshTrigger);
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

  const handleMonthSelected = (month) => {
    setSelectedMonth(month);
  };

  return (
    <div className={styles.homeContainer}>
      <div className={styles.mainContent}>
        <header className={styles.pageHeader}>
          {/* Theme Toggle */}
          <div className={styles.themeToggleContainer}>
            <ThemeToggle />
          </div>
          
          <h1 className={styles.pageTitle}>
            <Icons.Wallet size={40} color="white" />
            ระบบจัดการการเงิน
          </h1>
        </header>
      
        <MonthManager 
          selectedMonth={selectedMonth}
          onMonthSelected={handleMonthSelected}
          onDataRefresh={handleDataRefresh}
          months={months}
        />

        {/* สรุปงบประมาณ */}
        <div className={styles.sectionCard}>
          <SummaryReport 
            selectedMonth={selectedMonth}
            key={`summary-${refreshTrigger}`}
          />
        </div>

        {/* คำนวณเงินเดือน */}
        <div className={styles.sectionCard}>
          <SalaryCalculator 
            selectedMonth={selectedMonth}
            onSalaryUpdate={handleDataRefresh}
            key={refreshTrigger}
          />
        </div>

        {/* Tab Navigation */}
        <div className={styles.tabNavigation}>
          {[
            { id: 'income', label: 'รายรับ', icon: <Icons.TrendingUp size={20} /> },
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

        {/* Tab Content */}
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
                salaryUpdateTrigger={refreshTrigger}
                key={`income-${refreshTrigger}`}
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
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default HomeContent;