import { useState } from 'react';
import IncomeTable from '../components/IncomeTable';
import ExpenseTable from '../components/ExpenseTable';
import SavingsTable from '../components/SavingsTable';
import TaxTable from '../components/TaxTable';
import SummaryReport from '../components/SummaryReport';
import SalaryCalculator from '../components/SalaryCalculator';
import MonthManager from '../components/MonthManager';
import ThemeToggle from '../components/ThemeToggle';
import { Icons } from '../components/Icons';
import { useTheme } from '../contexts/ThemeContext';
import { generateMonthOptions } from '../../shared/utils/numberUtils';

// Utility: get current month in YYYY-MM
function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
import { incomeAPI, expenseAPI, savingsAPI, salaryAPI } from '../../shared/utils/apiUtils';
import styles from '../styles/Home.module.css';


function HomeContent() {
  const [mode, setMode] = useState('view');
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
      setMonths(allMonths);
      const currentMonth = getCurrentMonth();
      // Debug log
      console.log('[fetchMonths] allMonths:', allMonths, 'currentMonth:', currentMonth, 'selectedMonth before:', selectedMonth);
      if (allMonths.includes(currentMonth)) {
        console.log('[fetchMonths] setSelectedMonth:', currentMonth);
        setSelectedMonth(currentMonth);
      } else if (allMonths.length && !allMonths.includes(selectedMonth)) {
        // ถ้าไม่มี currentMonth แต่ selectedMonth ก็ไม่มีใน allMonths ให้ fallback เป็นเดือนล่าสุด
        console.log('[fetchMonths] setSelectedMonth fallback:', allMonths[0]);
        setSelectedMonth(allMonths[0]);
      }
    } catch (err) {
      setMonths([]);
    }
  };

  // โหลดเดือนเมื่อ mount หรือ refresh
  React.useEffect(() => {
    console.log('[useEffect] call fetchMonths, refreshTrigger:', refreshTrigger);
    fetchMonths();
  }, [refreshTrigger]);

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
          <div className={styles.headerAction}>
            <ThemeToggle mode={mode} setMode={setMode} />
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

      {/* คำนวณเงินเดือน */}
      <div className={styles.sectionCard}>
        <SalaryCalculator 
          selectedMonth={selectedMonth}
          onSalaryUpdate={handleDataRefresh}
          key={refreshTrigger}
        />
      </div>

      {/* สรุปงบประมาณ */}
      <div className={styles.sectionCard}>
        <SummaryReport 
          selectedMonth={selectedMonth}
          key={`summary-${refreshTrigger}`}
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

export default HomeContent;
