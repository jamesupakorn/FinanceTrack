import { useState } from 'react';
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

function HomeContent() {
  const { theme } = useTheme();
  const monthOptions = generateMonthOptions();
  const [selectedMonth, setSelectedMonth] = useState('2025-09');
  const [activeTab, setActiveTab] = useState('income');
  const [refreshTrigger, setRefreshTrigger] = useState(0);

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