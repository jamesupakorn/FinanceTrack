import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import IncomeTable from '../src/frontend/components/IncomeTable';
import ExpenseTable from '../src/frontend/components/ExpenseTable';
import SavingsTable from '../src/frontend/components/SavingsTable';
import TaxTable from '../src/frontend/components/TaxTable';
import SummaryReport from '../src/frontend/components/SummaryReport';
import SalaryCalculator from '../src/frontend/components/SalaryCalculator';
import MonthManager from '../src/frontend/components/MonthManager';
import { Icons } from '../src/frontend/components/Icons';
import ChangePasswordModal from '../src/frontend/components/ChangePasswordModal';
import { useTheme } from '../src/frontend/contexts/ThemeContext';
import { useSession } from '../src/frontend/contexts/SessionContext';
import { incomeAPI, expenseAPI, savingsAPI, salaryAPI } from '../src/shared/utils/frontend/apiUtils';
import styles from '../src/frontend/styles/Home.module.css';

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}


const SESSION_KEY = 'edit_last_activity';
const SELECTED_MONTH_KEY = 'edit_selected_month';

export default function EditPage() {
  const router = useRouter();
  // Session timeout: 1 hour (3600 seconds)
  const SESSION_TIMEOUT = 60 * 60 * 1000;
  const { currentUser, isReady, logout } = useSession();
  const sessionKey = useMemo(() => currentUser ? `${SESSION_KEY}_${currentUser.id}` : SESSION_KEY, [currentUser?.id]);
  const selectedMonthKey = useMemo(() => currentUser ? `${SELECTED_MONTH_KEY}_${currentUser.id}` : SELECTED_MONTH_KEY, [currentUser?.id]);
  const clearStoredMonth = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(selectedMonthKey);
  }, [selectedMonthKey]);
  const isLocked = !isReady || !currentUser;

  // Update last activity timestamp
  const updateActivity = () => {
    if (!currentUser) return;
    localStorage.setItem(sessionKey, Date.now().toString());
  };

  // Set up event listeners for user activity
  React.useEffect(() => {
    if (!currentUser) return undefined;
    updateActivity();
    const events = ['mousemove', 'keydown', 'click', 'scroll'];
    events.forEach(event => window.addEventListener(event, updateActivity));
    return () => {
      events.forEach(event => window.removeEventListener(event, updateActivity));
    };
  }, [currentUser, sessionKey]);

  // Check for session timeout every 1 minute
  React.useEffect(() => {
    if (!currentUser) return undefined;
    const checkTimeout = () => {
      const last = parseInt(localStorage.getItem(sessionKey), 10);
      if (!last || Date.now() - last > SESSION_TIMEOUT) {
        localStorage.removeItem(sessionKey);
        clearStoredMonth();
        logout();
        router.replace('/profiles');
      }
    };
    const interval = setInterval(checkTimeout, 60 * 1000);
    // Also check immediately on mount
    checkTimeout();
    return () => clearInterval(interval);
  }, [router, currentUser, sessionKey, logout, clearStoredMonth]);
  const { theme } = useTheme();
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [activeTab, setActiveTab] = useState('income');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [salaryUpdateTrigger, setSalaryUpdateTrigger] = useState(0);
  const [months, setMonths] = useState([]);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState('');
  const [changePasswordSubmitting, setChangePasswordSubmitting] = useState(false);
  const [passwordToast, setPasswordToast] = useState(null);
  React.useEffect(() => {
    if (isReady && !currentUser) {
      router.replace('/profiles');
    }
  }, [isReady, currentUser, router]);

  React.useEffect(() => {
    if (!passwordToast) return undefined;
    const timer = setTimeout(() => setPasswordToast(null), 4000);
    return () => clearTimeout(timer);
  }, [passwordToast]);

  // ดึงเดือนทั้งหมดจากข้อมูลใน DB แล้วรวม key
  const fetchMonths = async () => {
    try {
      const [expenseRes, incomeRes, savingsRes, salaryRes, investmentRes] = await Promise.all([
        expenseAPI.getAll(),
        incomeAPI.getAll(),
        savingsAPI.getAll(),
        salaryAPI.getAll(),
        (await import('../src/shared/utils/frontend/apiUtils')).investmentAPI.getAll()
      ]);
      const expenseMonths = expenseRes?.months ? Object.keys(expenseRes.months) : [];
      const incomeMonths = incomeRes?.months ? Object.keys(incomeRes.months) : [];
      const savingsMonths = savingsRes?.months ? Object.keys(savingsRes.months) : [];
      const salaryMonths = salaryRes?.months
        ? Object.entries(salaryRes.months)
          .filter(([, doc]) => {
            if (!doc || typeof doc !== 'object') return false;
            const note = typeof doc.note === 'string' ? doc.note.trim() : '';
            const summary = doc.summary || {};
            const hasSummary = [summary.total_income, summary.total_deduct, summary.net_income]
              .some(value => Number(value) > 0);
            const income = doc.income || {};
            const deduct = doc.deduct || {};
            const hasIncome = Object.values(income).some(value => Number(value) > 0);
            const hasDeduct = Object.values(deduct).some(value => Number(value) > 0);
            return hasSummary || hasIncome || hasDeduct || note.length > 0;
          })
          .map(([month]) => month)
        : [];
      const investmentMonths = investmentRes && typeof investmentRes === 'object'
        ? Object.keys(investmentRes).filter(key => key !== 'months')
        : [];
      const currentMonth = getCurrentMonth();
      const allMonths = Array.from(new Set([
        ...expenseMonths,
        ...incomeMonths,
        ...savingsMonths,
        ...salaryMonths,
        ...investmentMonths
      ])).sort().reverse();
      const normalizedMonths = allMonths.length ? allMonths : [currentMonth];
      setMonths(normalizedMonths);
      const hasMonthFromData = normalizedMonths.length > 0;
      const monthToSelect = hasMonthFromData ? normalizedMonths[0] : currentMonth;
      const shouldUpdateSelection = !selectedMonth || (hasMonthFromData && !normalizedMonths.includes(selectedMonth));
      if (shouldUpdateSelection && monthToSelect) {
        setSelectedMonth(monthToSelect);
        if (typeof window !== 'undefined') {
          localStorage.setItem(selectedMonthKey, monthToSelect);
        }
      }
    } catch (err) {
      setMonths([getCurrentMonth()]);
    }
  };


  React.useEffect(() => {
    if (currentUser) {
      fetchMonths();
    }
  }, [refreshTrigger, currentUser, selectedMonthKey]);

  const handleDataRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  // Callback สำหรับ SalaryCalculator เมื่อบันทึกเงินเดือน
  const handleSalaryUpdate = () => {
    setSalaryUpdateTrigger(prev => prev + 1);
  };

  const handleMonthSelected = (month) => {
    setSelectedMonth(month);
    if (typeof window !== 'undefined') {
      localStorage.setItem(selectedMonthKey, month);
    }
  };

  const handleSwitchProfile = () => {
    setUserMenuOpen(false);
    clearStoredMonth();
    setSelectedMonth(null);
    logout();
    router.replace('/profiles');
  };

  const handleLogoutClick = () => {
    setUserMenuOpen(false);
    clearStoredMonth();
    setSelectedMonth(null);
    logout();
    router.replace('/profiles');
  };

  const handleOpenChangePassword = () => {
    setUserMenuOpen(false);
    setChangePasswordError('');
    setChangePasswordOpen(true);
  };

  const handleCloseChangePassword = () => {
    setChangePasswordError('');
    setChangePasswordOpen(false);
  };

  const handleChangePasswordSubmit = async ({ currentPassword, newPassword }) => {
    setChangePasswordSubmitting(true);
    setChangePasswordError('');
    try {
      const response = await fetch('/api/change_password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, userId: currentUser?.id })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setChangePasswordError(data?.error || 'ไม่สามารถเปลี่ยนรหัสได้');
        return;
      }
      setChangePasswordOpen(false);
      setPasswordToast({ type: 'success', message: 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว' });
    } catch (error) {
      setChangePasswordError('เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setChangePasswordSubmitting(false);
    }
  };

  const userMenuRef = React.useRef(null);

  React.useEffect(() => {
    if (!userMenuOpen) return undefined;
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setUserMenuOpen(false);
      }
    };
    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [userMenuOpen]);

  if (isLocked) {
    return (
      <div className={styles.guardContainer}>
        <Icons.Lock size={48} color="var(--color-primary)" />
        <p>กำลังตรวจสอบสิทธิ์ผู้ใช้...</p>
      </div>
    );
  }

  return (
  <>
    {passwordToast && (
      <div className={`${styles.actionToast} ${passwordToast.type === 'success' ? styles.actionToastSuccess : ''}`}>
        <Icons.Check size={20} />
        <span>{passwordToast.message}</span>
      </div>
    )}
    <div className={styles.homeContainer} onClick={updateActivity} onKeyDown={updateActivity} onMouseMove={updateActivity}>
      <div className={styles.mainContent}>
        <header className={styles.pageHeader}>
          <div className={styles.headerTopRow}>
            <div className={styles.headerIntro}>
              <div className={styles.headerIcon}>
                <Icons.Wallet size={36} color="#0b2155" />
              </div>
              <div className={styles.headerCopy}>
                <p className={styles.headerEyebrow}>Finance Workspace</p>
                <h1 className={styles.pageTitle}>โหมดแก้ไขข้อมูล</h1>
                <p className={styles.pageLead}>
                  บริหารข้อมูลรายรับรายจ่ายและเงินออมแบบเรียลไทม์ในที่เดียว
                </p>
              </div>
            </div>
            <div className={styles.headerUserControls}>
              <div className={styles.userMenuWrapper} ref={userMenuRef}>
                <button
                  type="button"
                  className={styles.userMenuButton}
                  onClick={() => setUserMenuOpen(prev => !prev)}
                  aria-haspopup="true"
                  aria-expanded={userMenuOpen}
                  data-open={userMenuOpen}
                >
                  จัดการผู้ใช้
                  <Icons.ChevronDown size={16} />
                </button>
                {userMenuOpen && (
                  <div className={styles.userDropdown} role="menu">
                    <button type="button" className={`${styles.userMenuItem} ${styles.userMenuAccent}`} onClick={handleOpenChangePassword}>
                      <Icons.Edit size={16} />
                      <div>
                        <p>เปลี่ยนรหัสผ่าน</p>
                        <span>อัปเดตรหัสเพื่อความปลอดภัย</span>
                      </div>
                    </button>
                    <button type="button" className={styles.userMenuItem} onClick={handleSwitchProfile}>
                      <Icons.Settings size={16} />
                      <div>
                        <p>สลับผู้ใช้</p>
                        <span>กลับไปหน้าเลือกโปรไฟล์</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      className={`${styles.userMenuItem} ${styles.userMenuDanger}`}
                      onClick={handleLogoutClick}
                    >
                      <Icons.Lock size={16} />
                      <div>
                        <p>ออกจากระบบ</p>
                        <span>ปิดเซสชันและล็อกระบบ</span>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

      <MonthManager 
        selectedMonth={selectedMonth}
        onMonthSelected={handleMonthSelected}
        onDataRefresh={handleDataRefresh}
        months={months}
      />


      <div className={styles.sectionCard}>
        <SalaryCalculator 
          selectedMonth={selectedMonth}
          onSalaryUpdate={handleSalaryUpdate}
          key={refreshTrigger}
        />
      </div>

      <div className={styles.sectionCard}>
        <SummaryReport 
          selectedMonth={selectedMonth}
          key={`summary-${refreshTrigger}`}
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
    <ChangePasswordModal
      open={changePasswordOpen}
      onClose={handleCloseChangePassword}
      onSubmit={handleChangePasswordSubmit}
      errorMessage={changePasswordError}
      isSubmitting={changePasswordSubmitting}
    />
  </>
  );
}
