import React, { useState } from 'react';
import { useRouter } from 'next/router';
import IncomeTable from '../src/frontend/components/IncomeTable';
import ExpenseTable from '../src/frontend/components/ExpenseTable';
import SavingsTable from '../src/frontend/components/SavingsTable';
import TaxTable from '../src/frontend/components/TaxTable';
import SummaryReport from '../src/frontend/components/SummaryReport';
import SalaryCalculator from '../src/frontend/components/SalaryCalculator';
import MonthManager from '../src/frontend/components/MonthManager';
import ThemeToggle from '../src/frontend/components/ThemeToggle';
import ModePasswordModal from '../src/frontend/components/ModePasswordModal';
import { ENCODED_EDIT_PASSWORD } from '../src/frontend/config/password.enc';
import { decodePassword } from '../src/shared/utils/authUtils';
import { Icons } from '../src/frontend/components/Icons';
import { useTheme } from '../src/frontend/contexts/ThemeContext';
import { incomeAPI, expenseAPI, savingsAPI, salaryAPI } from '../src/shared/utils/frontend/apiUtils';
import styles from '../src/frontend/styles/Home.module.css';

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}


const EDIT_PASSWORD = decodePassword(ENCODED_EDIT_PASSWORD);
const SESSION_KEY = 'edit_last_activity'; // สำหรับ activity
const SESSION_KEY_PASSWORD = 'edit_password_verified'; // สำหรับ password

export default function EditPage() {
    // สำหรับ LINE แจ้งเตือน
    const [lineMessage, setLineMessage] = useState('');
    const [lineStatus, setLineStatus] = useState('');
  const router = useRouter();
  // Session timeout: 1 hour (3600 seconds)
  const SESSION_TIMEOUT = 60 * 60 * 1000;

  // Update last activity timestamp
  const updateActivity = () => {
    localStorage.setItem(SESSION_KEY, Date.now().toString());
  };

  // Set up event listeners for user activity
  React.useEffect(() => {
    updateActivity();
    const events = ['mousemove', 'keydown', 'click', 'scroll'];
    events.forEach(event => window.addEventListener(event, updateActivity));
    return () => {
      events.forEach(event => window.removeEventListener(event, updateActivity));
    };
  }, []);

  // Check for session timeout every 1 minute
  React.useEffect(() => {
    const checkTimeout = () => {
      const last = parseInt(localStorage.getItem(SESSION_KEY), 10);
      if (!last || Date.now() - last > SESSION_TIMEOUT) {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(SESSION_KEY_PASSWORD); // เคลียร์ password ด้วย
        router.replace('/');
      }
    };
    const interval = setInterval(checkTimeout, 60 * 1000);
    // Also check immediately on mount
    checkTimeout();
    return () => clearInterval(interval);
  }, [router]);
  const { theme } = useTheme();
  const [mode] = useState('edit');
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [activeTab, setActiveTab] = useState('income');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [salaryUpdateTrigger, setSalaryUpdateTrigger] = useState(0);
  const [months, setMonths] = useState([]);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  // ตรวจสอบ session password
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const verified = localStorage.getItem(SESSION_KEY_PASSWORD);
      // เช็ค password จาก query string
      const urlParams = new URLSearchParams(window.location.search);
      const passwordFromQuery = urlParams.get('pass');
      if (passwordFromQuery) {
        if (passwordFromQuery === EDIT_PASSWORD) {
          localStorage.setItem(SESSION_KEY_PASSWORD, 'true');
          setShowPasswordModal(false);
          return;
        } else {
          localStorage.removeItem(SESSION_KEY_PASSWORD);
          setShowPasswordModal(true);
          return;
        }
      }
      if (verified !== 'true') {
        setShowPasswordModal(true);
      }
    }
  }, []);

  const handlePasswordSubmit = (password) => {
    if (password === EDIT_PASSWORD) {
      localStorage.setItem(SESSION_KEY_PASSWORD, 'true');
      setShowPasswordModal(false);
    } else {
      alert('รหัสผ่านไม่ถูกต้อง');
      localStorage.removeItem(SESSION_KEY_PASSWORD);
      setShowPasswordModal(true);
    }
  };

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

  if (showPasswordModal) {
    return (
      <ModePasswordModal
        open={true}
        onClose={() => {}}
        onSubmit={handlePasswordSubmit}
        forceOpen
      />
    );
  }

  return (
  <div className={styles.homeContainer} onClick={updateActivity} onKeyDown={updateActivity} onMouseMove={updateActivity}>
      <div className={styles.mainContent}>
        <header className={styles.pageHeader}>
          <div className={styles.headerAction}>
            <button
              className={styles.normalModeButton}
              onClick={() => router.push('/')}
              type="button"
            >
              กลับโหมดปกติ
            </button>
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
          { id: 'tax', label: 'ภาษี', icon: <Icons.BarChart size={20} /> },
          { id: 'line', label: 'LINE แจ้งเตือน', icon: <Icons.Message size={20} /> }
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
        {activeTab === 'line' && (
          <div style={{ maxWidth: 500, margin: '40px auto', background: '#fff', borderRadius: 12, boxShadow: '0 2px 12px #eee', padding: 32 }}>
            <h3 style={{ marginBottom: 16 }}>ส่งข้อความไป LINE</h3>
            <input
              type="text"
              value={lineMessage}
              onChange={e => setLineMessage(e.target.value)}
              placeholder="ข้อความที่ต้องการส่ง"
              style={{ width: '100%', padding: 12, fontSize: 16, borderRadius: 8, border: '1px solid #ccc', marginBottom: 16 }}
            />
            <button
              style={{ padding: '10px 24px', borderRadius: 8, background: '#218bff', color: '#fff', fontWeight: 600, border: 'none', fontSize: 16 }}
              onClick={async () => {
                setLineStatus('');
                try {
                  const res = await fetch('/api/line_notify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: lineMessage })
                  });
                  const data = await res.json();
                  if (data.success) {
                    setLineStatus('ส่งข้อความสำเร็จ');
                  } else {
                    setLineStatus('ส่งข้อความไม่สำเร็จ: ' + (data.error || ''));
                  }
                } catch (err) {
                  setLineStatus('เกิดข้อผิดพลาดในการส่งข้อความ');
                }
              }}
              disabled={!lineMessage}
            >ส่งข้อความ</button>
            {lineStatus && <div style={{ marginTop: 16, color: lineStatus.includes('สำเร็จ') ? '#1a7f37' : '#cf222e' }}>{lineStatus}</div>}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
