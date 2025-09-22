import { useState } from 'react';import { useState } from 'react';

import IncomeTable from '../components/IncomeTable';import IncomeTable from '../components/IncomeTable';

import ExpenseTable from '../components/ExpenseTable';import ExpenseTable from '../components/ExpenseTable';

import SavingsTable from '../components/SavingsTable';import SavingsTable from '../components/SavingsTable';

import TaxTable from '../components/TaxTable';import TaxTable from '../components/TaxTable';

import SummaryReport from '../components/SummaryReport';import SummaryReport from '../components/SummaryReport';

import SalaryCalculator from '../components/SalaryCalculator';import SalaryCalculator from '../components/SalaryCalculator';

import MonthManager from '../components/MonthManager';import MonthManager from '../components/MonthManager';

import ThemeToggle from '../components/ThemeToggle';import ThemeToggle from '../components/ThemeToggle';

import { Icons } from '../components/Icons';import { Icons } from '../components/Icons';

import { useTheme } from '../contexts/ThemeContext';import { useTheme } from '../contexts/ThemeContext';

import { generateMonthOptions } from '../../shared/utils/numberUtils';import { generateMonthOptions } from '../../shared/utils/numberUtils';

import { incomeAPI, expenseAPI, savingsAPI, salaryAPI } from '../../shared/utils/apiUtils';import { incomeAPI, expenseAPI, savingsAPI, salaryAPI } from '../../shared/utils/apiUtils';

import styles from '../styles/Home.module.css';import styles from '../styles/Home.module.css';



function HomeContent() {function HomeContent() {

  const { theme } = useTheme();  const { theme } = useTheme();

  const monthOptions = generateMonthOptions();  const monthOptions = generateMonthOptions();

  const [selectedMonth, setSelectedMonth] = useState('2025-09');  const [selectedMonth, setSelectedMonth] = useState('2025-09');

  const [activeTab, setActiveTab] = useState('income');  const [activeTab, setActiveTab] = useState('income');

  const [refreshTrigger, setRefreshTrigger] = useState(0);  const [refreshTrigger, setRefreshTrigger] = useState(0);



  const handleDataRefresh = () => {  const handleDataRefresh = () => {

    setRefreshTrigger(prev => prev + 1);    setRefreshTrigger(prev => prev + 1);

  };  };



  const handleMonthSelected = (month) => {  const handleMonthSelected = (month) => {

    setSelectedMonth(month);    setSelectedMonth(month);

  };  };



  return (  return (

    <div className={styles.homeContainer}>    <div className={styles.homeContainer}>

      <div className={styles.mainContent}>      <div className={styles.mainContent}>

        <header className={styles.pageHeader}>        <header className={styles.pageHeader}>

          {/* Theme Toggle */}          {/* Theme Toggle */}

          <div className={styles.themeToggleContainer}>          <div className={styles.themeToggleContainer}>

            <ThemeToggle />            <ThemeToggle />

          </div>          </div>

                    

          <h1 className={styles.pageTitle}>          <h1 className={styles.pageTitle}>

            <Icons.Wallet size={40} color="white" />            <Icons.Wallet size={40} color="white" />

            ระบบจัดการการเงิน            ระบบจัดการการเงิน

          </h1>          </h1>

        </header>        </header>

            

      <MonthManager       <MonthManager 

        selectedMonth={selectedMonth}        selectedMonth={selectedMonth}

        onMonthSelected={handleMonthSelected}        onMonthSelected={handleMonthSelected}

        onDataRefresh={handleDataRefresh}        onDataRefresh={handleDataRefresh}

      />      />



      {/* คำนวณเงินเดือน */}      {/* คำนวณเงินเดือน */}

      <div className={styles.sectionCard}>      <div className={styles.sectionCard}>

        <SalaryCalculator         <SalaryCalculator 

          selectedMonth={selectedMonth}          selectedMonth={selectedMonth}

          onSalaryUpdate={handleDataRefresh}          onSalaryUpdate={handleDataRefresh}

          key={refreshTrigger}          key={refreshTrigger}

        />        />

      </div>      </div>



      {/* สรุปงบประมาณ */}      {/* สรุปงบประมาณ */}

      <div className={styles.sectionCard}>      <div className={styles.sectionCard}>

        <SummaryReport         <SummaryReport 

          selectedMonth={selectedMonth}          selectedMonth={selectedMonth}

          key={`summary-${refreshTrigger}`}          key={`summary-${refreshTrigger}`}

        />        />

      </div>      </div>



      {/* Tab Navigation */}      {/* Tab Navigation */}

      <div className={styles.tabNavigation}>      <div className={styles.tabNavigation}>

        {[        {[

          { id: 'income', label: 'รายรับ', icon: <Icons.TrendingUp size={20} /> },          { id: 'income', label: 'รายรับ', icon: <Icons.TrendingUp size={20} /> },

          { id: 'expense', label: 'รายจ่าย', icon: <Icons.CreditCard size={20} /> },          { id: 'expense', label: 'รายจ่าย', icon: <Icons.CreditCard size={20} /> },

          { id: 'savings', label: 'เงินออม', icon: <Icons.PiggyBank size={20} /> },          { id: 'savings', label: 'เงินออม', icon: <Icons.PiggyBank size={20} /> },

          { id: 'tax', label: 'ภาษี', icon: <Icons.BarChart size={20} /> }          { id: 'tax', label: 'ภาษี', icon: <Icons.BarChart size={20} /> }

        ].map(tab => (        ].map(tab => (

          <button           <button 

            key={tab.id}            key={tab.id}

            onClick={() => setActiveTab(tab.id)}            onClick={() => setActiveTab(tab.id)}

            className={`${styles.tabButton} ${activeTab === tab.id ? styles.active : ''}`}            className={`${styles.tabButton} ${activeTab === tab.id ? styles.active : ''}`}

          >          >

            {tab.icon}            {tab.icon}

            {tab.label}            {tab.label}

          </button>          </button>

        ))}        ))}

      </div>      </div>



      {/* Tab Content */}      {/* Tab Content */}

      <div className={styles.tabContent}>      <div className={styles.tabContent}>

        {activeTab === 'income' && (        {activeTab === 'income' && (

          <div>          <div>

            <div className={styles.tabHeader}>            <div className={styles.tabHeader}>

              <h3 className={styles.tabTitle}>              <h3 className={styles.tabTitle}>

                <Icons.TrendingUp size={24} color="var(--color-primary)" />                <Icons.TrendingUp size={24} color="var(--color-primary)" />

                รายรับรายเดือน                รายรับรายเดือน

              </h3>              </h3>

            </div>            </div>

            <IncomeTable             <IncomeTable 

              selectedMonth={selectedMonth}              selectedMonth={selectedMonth}

              salaryUpdateTrigger={refreshTrigger}              salaryUpdateTrigger={refreshTrigger}

              key={`income-${refreshTrigger}`}              key={`income-${refreshTrigger}`}

            />            />

          </div>          </div>

        )}        )}



        {activeTab === 'expense' && (        {activeTab === 'expense' && (

          <div>          <div>

            <div className={styles.tabHeader}>            <div className={styles.tabHeader}>

              <h3 className={styles.tabTitle}>              <h3 className={styles.tabTitle}>

                <Icons.CreditCard size={24} color="var(--color-danger)" />                <Icons.CreditCard size={24} color="var(--color-danger)" />

                รายจ่ายรายเดือน                รายจ่ายรายเดือน

              </h3>              </h3>

            </div>            </div>

            <ExpenseTable             <ExpenseTable 

              selectedMonth={selectedMonth}              selectedMonth={selectedMonth}

              key={`expense-${refreshTrigger}`}              key={`expense-${refreshTrigger}`}

            />            />

          </div>          </div>

        )}        )}



        {activeTab === 'savings' && (        {activeTab === 'savings' && (

          <div>          <div>

            <div className={styles.tabHeader}>            <div className={styles.tabHeader}>

              <h3 className={styles.tabTitle}>              <h3 className={styles.tabTitle}>

                <Icons.PiggyBank size={24} color="var(--color-secondary)" />                <Icons.PiggyBank size={24} color="var(--color-secondary)" />

                เงินออมรายเดือน                เงินออมรายเดือน

              </h3>              </h3>

            </div>            </div>

            <SavingsTable             <SavingsTable 

              selectedMonth={selectedMonth}              selectedMonth={selectedMonth}

              key={`savings-${refreshTrigger}`}              key={`savings-${refreshTrigger}`}

            />            />

          </div>          </div>

        )}        )}



        {activeTab === 'tax' && (        {activeTab === 'tax' && (

          <div>          <div>

            <div className={styles.tabHeader}>            <div className={styles.tabHeader}>

              <h3 className={styles.tabTitle}>              <h3 className={styles.tabTitle}>

                <Icons.BarChart size={24} color="var(--color-warning)" />                <Icons.BarChart size={24} color="var(--color-warning)" />

                ภาษีรายเดือน                ภาษีรายเดือน

              </h3>              </h3>

            </div>            </div>

            <TaxTable             <TaxTable 

              selectedMonth={selectedMonth}              selectedMonth={selectedMonth}

              key={`tax-${refreshTrigger}`}              key={`tax-${refreshTrigger}`}

            />            />

          </div>          </div>

        )}        )}

      </div>      </div>

      </div>      </div>

    </div>    </div>

  );  );

}}



export default HomeContent;export default HomeContent;
