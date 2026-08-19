import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import IncomeTable from '../src/frontend/components/IncomeTable';
import ExpenseTable from '../src/frontend/components/ExpenseTable';
import SavingsTable from '../src/frontend/components/SavingsTable';
import SavingsGoalTracker from '../src/frontend/components/SavingsGoalTracker';
import InvestmentTable from '../src/frontend/components/InvestmentTable';
import DailyExpenseTable from '../src/frontend/components/DailyExpenseTable';

import TaxTable from '../src/frontend/components/TaxTable';
import SummaryReport from '../src/frontend/components/SummaryReport';
import SalaryCalculator from '../src/frontend/components/SalaryCalculator';
import MonthManager from '../src/frontend/components/MonthManager';
import { Icons } from '../src/frontend/components/Icons';
import ChangePasswordModal from '../src/frontend/components/ChangePasswordModal';
import ExpenseCalendarModal from '../src/frontend/components/ExpenseCalendarModal';
import { useTheme } from '../src/frontend/contexts/ThemeContext';
import { useSession } from '../src/frontend/contexts/SessionContext';
import { withApiTokenHeaders } from '../src/shared/utils/frontend/apiToken';
import { showToast } from '../src/shared/utils/frontend/toast';
import { incomeAPI, expenseAPI, savingsAPI, salaryAPI, taxAPI } from '../src/shared/utils/frontend/apiUtils';
import { getSummaryData, getChartData } from '../src/shared/utils/frontend/summaryUtils';
import { formatMonthLabelTH } from '../src/shared/utils/frontend/monthUtils';
import { downloadSummaryReportPdf } from '../src/shared/utils/frontend/reportPdf';
import styles from '../src/frontend/styles/Home.module.css';

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}


const SESSION_KEY = 'edit_last_activity';
const SELECTED_MONTH_KEY = 'edit_selected_month';

const DEFAULT_INCOME_LABELS = {
  salary: 'เงินเดือน',
  income2: 'แหล่งรายรับ 2',
  other: 'อื่นๆ'
};

const toNumericValue = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const numeric = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(numeric) ? numeric : 0;
  }
  return 0;
};

const isNumericLike = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.length) return false;
    return Number.isFinite(Number(trimmed.replace(/,/g, '')));
  }
  return false;
};

const buildIncomeDetailRows = (incomeData) => {
  const labels = incomeData?.__labels && typeof incomeData.__labels === 'object'
    ? incomeData.__labels
    : {};
  const ignoredFields = new Set(['month', '_id', 'รวม', '__labels', 'userId']);
  return Object.entries(incomeData || {})
    .filter(([key, value]) => !ignoredFields.has(key) && isNumericLike(value))
    .map(([key, value]) => ({
      item: (typeof labels[key] === 'string' && labels[key].trim())
        ? labels[key].trim()
        : (DEFAULT_INCOME_LABELS[key] || key),
      amount: toNumericValue(value)
    }));
};

const buildExpenseDetailRows = (expenseData) => {
  const ignoredFields = new Set(['totalActualPaid', 'accountSummary', 'month', '_id', 'userId']);
  return Object.entries(expenseData || {})
    .filter(([key, value]) => {
      if (ignoredFields.has(key)) return false;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      return 'actual' in value || 'name' in value;
    })
    .map(([key, value]) => ({
      item: (typeof value.name === 'string' && value.name.trim()) ? value.name.trim() : key,
      actual: toNumericValue(value.actual),
      paid: value.paid === true || value.paid === 'true' ? 'ชำระแล้ว' : 'ยังไม่ชำระ'
    }));
};

const buildSavingsDetailRows = (savingsData) => {
  const savingsList = Array.isArray(savingsData?.savings_list) ? savingsData.savings_list : [];
  return savingsList.map((item, index) => ({
    item: item?.savings_type || item?.รายการ || `รายการที่ ${index + 1}`,
    amount: toNumericValue(item?.savings_amount ?? item?.จำนวนเงิน ?? 0)
  }));
};

const parseYearFromMonth = (monthKey) => {
  if (typeof monthKey !== 'string' || !/^\d{4}-\d{2}$/.test(monthKey)) {
    return String(new Date().getFullYear());
  }
  return monthKey.split('-')[0];
};

const getMonthLabel = (monthKey) => {
  try {
    return formatMonthLabelTH(monthKey);
  } catch (error) {
    return monthKey;
  }
};

const buildMonthlyReportPayload = async (monthKey, taxByYearCache) => {
  const currentYear = parseYearFromMonth(monthKey);
  let taxData = taxByYearCache.get(currentYear);

  if (!taxData) {
    try {
      taxData = await taxAPI.getByYear(currentYear);
    } catch (error) {
      taxData = {};
    }
    taxByYearCache.set(currentYear, taxData);
  }

  const [incomeData, expenseData, savingsData, salaryData] = await Promise.all([
    incomeAPI.getByMonth(monthKey).catch(() => ({})),
    expenseAPI.getByMonth(monthKey).catch(() => ({})),
    savingsAPI.getByMonth(monthKey).catch(() => ({})),
    salaryAPI.getByMonth(monthKey).catch(() => ({}))
  ]);

  const summaryData = getSummaryData({
    incomeData,
    expenseData,
    savingsData,
    taxData,
    salaryData,
    currentMonth: monthKey,
    currentYear
  });

  const chartData = getChartData({
    totalIncome: summaryData.ยอดรวมรายรับรายเดือน,
    totalExpenseActual: summaryData.ยอดรวมค่าใช้จ่ายรายเดือน_จ่ายจริง
  });

  return {
    reportMonth: monthKey,
    monthLabel: getMonthLabel(monthKey),
    summaryData,
    chartData,
    details: {
      incomeRows: buildIncomeDetailRows(incomeData),
      expenseRows: buildExpenseDetailRows(expenseData),
      savingsRows: buildSavingsDetailRows(savingsData)
    }
  };
};

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
  const isMobileInit = typeof window !== 'undefined' && window.innerWidth < 768;
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [activeTab, setActiveTab] = useState('income');
  const [salaryCollapsed, setSalaryCollapsed] = useState(isMobileInit);
  const [summaryCollapsed, setSummaryCollapsed] = useState(isMobileInit);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [salaryUpdateTrigger, setSalaryUpdateTrigger] = useState(0);
  const [triggerSave, setTriggerSave] = useState(0);
  const [allocatableAmount, setAllocatableAmount] = useState(0);
  // Reset to 0 on month change so SummaryReport doesn't show stale planner value
  // when user navigates months while on a non-savings tab.
  React.useEffect(() => { setAllocatableAmount(0); }, [selectedMonth]);
  const [months, setMonths] = useState([]);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState('');
  const [changePasswordSubmitting, setChangePasswordSubmitting] = useState(false);
  const [passwordToast, setPasswordToast] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const navTimeoutRef = React.useRef(null);
  const [isDownloadingReport, setIsDownloadingReport] = useState(false);
  const [reportMonthModalOpen, setReportMonthModalOpen] = useState(false);
  const [selectedReportMonths, setSelectedReportMonths] = useState([]);
  const [calendarOpen, setCalendarOpen] = useState(false);
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
      const monthToSelect = hasMonthFromData
        ? (normalizedMonths.includes(currentMonth) ? currentMonth : normalizedMonths[0])
        : currentMonth;
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

  const handleSaveAll = () => {
    setTriggerSave(prev => prev + 1);
    setIsDirty(false);
  };

  const currentMonthIndex = months.indexOf(selectedMonth);

  const navigateToMonth = React.useCallback((newMonth) => {
    if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
    if (isDirty) {
      setTriggerSave(prev => prev + 1); // fires save with current selectedMonth before re-render
      navTimeoutRef.current = setTimeout(() => {
        handleMonthSelected(newMonth);
        setIsDirty(false);
      }, 300);
    } else {
      handleMonthSelected(newMonth);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, selectedMonth]);

  const handlePrevMonth = () => {
    if (currentMonthIndex < months.length - 1) {
      navigateToMonth(months[currentMonthIndex + 1]);
    }
  };
  const handleNextMonth = () => {
    if (currentMonthIndex > 0) {
      navigateToMonth(months[currentMonthIndex - 1]);
    }
  };

  React.useEffect(() => () => { if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current); }, []);

  React.useEffect(() => {
    setSelectedReportMonths((previous) => {
      const validMonths = previous.filter((month) => months.includes(month));
      if (validMonths.length > 0) {
        return validMonths;
      }
      if (selectedMonth && months.includes(selectedMonth)) {
        return [selectedMonth];
      }
      if (months.length > 0) {
        return [months[0]];
      }
      return [];
    });
  }, [months, selectedMonth]);

  const orderedSelectedReportMonths = React.useMemo(() => {
    return months.filter((month) => selectedReportMonths.includes(month));
  }, [months, selectedReportMonths]);

  const reportMonthLabel = React.useMemo(() => {
    if (orderedSelectedReportMonths.length === 0) {
      return 'ยังไม่ได้เลือกเดือน';
    }
    if (orderedSelectedReportMonths.length === 1) {
      return getMonthLabel(orderedSelectedReportMonths[0]);
    }
    return `${orderedSelectedReportMonths.length} เดือน`;
  }, [orderedSelectedReportMonths]);

  const toggleReportMonthSelection = (month) => {
    setSelectedReportMonths((previous) => {
      if (previous.includes(month)) {
        return previous.filter((value) => value !== month);
      }
      return [...previous, month];
    });
  };

  const handleSelectAllReportMonths = () => {
    setSelectedReportMonths([...months]);
  };

  const handleClearReportMonths = () => {
    setSelectedReportMonths([]);
  };

  const handleOpenReportMonthModal = () => {
    if (isDownloadingReport) return;
    setReportMonthModalOpen(true);
  };

  const handleDownloadReport = async () => {
    if (isDownloadingReport) {
      showToast('กำลังเตรียมข้อมูลรายงาน กรุณาลองอีกครั้ง', 'info');
      return;
    }

    const targetMonths = orderedSelectedReportMonths;
    if (!targetMonths.length) {
      showToast('ไม่พบเดือนที่ใช้สร้างรายงาน กรุณาเลือกเดือนก่อนดาวน์โหลด', 'error');
      return;
    }

    setReportMonthModalOpen(false);
    setIsDownloadingReport(true);
    try {
      const taxByYearCache = new Map();
      const reportItems = await Promise.all(
        targetMonths.map((monthKey) => buildMonthlyReportPayload(monthKey, taxByYearCache))
      );

      await downloadSummaryReportPdf({ reportItems });
    } catch (error) {
      console.error('Error downloading report PDF from header:', error);
      showToast('ไม่สามารถดาวน์โหลดรายงาน PDF ได้ กรุณาลองใหม่', 'error');
    } finally {
      setIsDownloadingReport(false);
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
        headers: withApiTokenHeaders({ 'Content-Type': 'application/json' }),
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
  const tabContentRef = React.useRef(null);

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

  React.useEffect(() => {
    if (!reportMonthModalOpen) return undefined;
    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        setReportMonthModalOpen(false);
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('keydown', handleEsc);
    };
  }, [reportMonthModalOpen]);

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
              <h1 className={styles.pageTitle}>โหมดแก้ไขข้อมูล</h1>
            </div>
            <div className={styles.headerUserControls}>
              <div className={styles.headerActionGroup}>
                <button
                  type="button"
                  className={styles.calendarLinkButton}
                  onClick={() => setCalendarOpen(true)}
                  aria-label="เปิดปฏิทินค่าใช้จ่าย"
                >
                  <Icons.Calendar size={16} />
                  ปฏิทิน
                </button>
                <button
                  type="button"
                  className={styles.creditCardsLinkButton}
                  onClick={() => router.push('/credit-cards')}
                >
                  <Icons.CreditCard size={16} />
                  บัตรเครดิต
                </button>
                <button
                  type="button"
                  className={styles.reportDownloadButton}
                  onClick={handleOpenReportMonthModal}
                  disabled={isDownloadingReport || months.length === 0}
                >
                  <Icons.Save size={16} />
                  {isDownloadingReport ? 'กำลังสร้าง PDF...' : 'Download Report PDF'}
                </button>
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
          </div>
        </header>

      <MonthManager 
        selectedMonth={selectedMonth}
        onMonthSelected={handleMonthSelected}
        onDataRefresh={handleDataRefresh}
        months={months}
      />


      <div className={styles.sectionCard}>
        <button
          type="button"
          className={styles.collapsibleHeader}
          onClick={() => setSalaryCollapsed(prev => !prev)}
          aria-expanded={!salaryCollapsed}
        >
          <span className={styles.collapsibleTitle}>
            <Icons.BarChart size={18} />
            คำนวณเงินเดือน
          </span>
          <span className={`${styles.collapsibleChevron} ${salaryCollapsed ? '' : styles.collapsibleChevronOpen}`}>
            <Icons.ChevronDown size={18} />
          </span>
        </button>
        <div style={salaryCollapsed ? { display: 'none' } : undefined}>
          <SalaryCalculator
            selectedMonth={selectedMonth}
            onSalaryUpdate={handleSalaryUpdate}
            triggerSave={triggerSave}
            key={refreshTrigger}
          />
        </div>
      </div>

      <div className={styles.sectionCard}>
        <button
          type="button"
          className={styles.collapsibleHeader}
          onClick={() => setSummaryCollapsed(prev => !prev)}
          aria-expanded={!summaryCollapsed}
        >
          <span className={styles.collapsibleTitle}>
            <Icons.TrendingUp size={18} />
            งบประมาณ / สรุป
          </span>
          <span className={`${styles.collapsibleChevron} ${summaryCollapsed ? '' : styles.collapsibleChevronOpen}`}>
            <Icons.ChevronDown size={18} />
          </span>
        </button>
        {!summaryCollapsed && (
          <SummaryReport
            selectedMonth={selectedMonth}
            key={`summary-${refreshTrigger}`}
            allocatableAmount={allocatableAmount}
          />
        )}
      </div>

      <div className={styles.tabNavigation} ref={tabContentRef}>
        {[{ id: 'income', label: 'รายรับ', icon: <Icons.TrendingUp size={20} /> },
          { id: 'expense', label: 'รายจ่าย', icon: <Icons.CreditCard size={20} /> },
          { id: 'savings', label: 'เงินออม', icon: <Icons.PiggyBank size={20} /> },
          { id: 'daily', label: 'รายวัน', icon: <Icons.CreditCard size={20} /> },
          { id: 'tax', label: 'ภาษี', icon: <Icons.BarChart size={20} /> }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              tabContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className={`${styles.tabButton} ${activeTab === tab.id ? styles.active : ''}`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      <div className={styles.tabContent} onInput={() => setIsDirty(true)} onChange={() => setIsDirty(true)}>
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
              triggerSave={triggerSave}
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
              triggerSave={triggerSave}
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
              triggerSave={triggerSave}
              key={`savings-${refreshTrigger}`}
            />
            <SavingsGoalTracker
              key={selectedMonth}
              refreshTrigger={refreshTrigger}
              selectedMonth={selectedMonth}
              onAllocatableChange={setAllocatableAmount}
              triggerSave={triggerSave}
            />
            <InvestmentTable
              selectedMonth={selectedMonth}
              key={`investment-${refreshTrigger}`}
            />

          </div>
        )}
        {activeTab === 'daily' && (
          <div>
            <div className={styles.tabHeader}>
              <h3 className={styles.tabTitle}>
                <Icons.CreditCard size={24} color="var(--color-primary)" />
                ค่าใช้จ่ายรายวัน
              </h3>
            </div>
            <DailyExpenseTable
              selectedMonth={selectedMonth}
              triggerSave={triggerSave}
              key={`daily-${refreshTrigger}`}
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
              triggerSave={triggerSave}
              selectedMonth={selectedMonth}
              salaryUpdateTrigger={salaryUpdateTrigger}
              key={`tax-${refreshTrigger}`}
            />
          </div>
        )}
      </div>

      </div>
    </div>
    {reportMonthModalOpen && (
      <div
        className={styles.reportMonthModalBackdrop}
        role="presentation"
        onClick={() => setReportMonthModalOpen(false)}
      >
        <div
          className={styles.reportMonthModal}
          role="dialog"
          aria-modal="true"
          aria-label="เลือกเดือนในรายงาน"
          onClick={(event) => event.stopPropagation()}
        >
          <div className={styles.reportMonthModalHeader}>
            <h3 className={styles.reportMonthModalTitle}>เลือกเดือนในรายงาน</h3>
          </div>
          <p className={styles.reportMonthModalHint}>เดือนที่เลือก: {reportMonthLabel}</p>
          <div className={styles.reportMonthActions}>
            <button type="button" onClick={handleSelectAllReportMonths}>เลือกทั้งหมด</button>
            <button type="button" onClick={handleClearReportMonths}>ล้างที่เลือก</button>
          </div>
          <div className={styles.reportMonthList}>
            {months.map((month) => {
              const checked = selectedReportMonths.includes(month);
              return (
                <label key={month} className={styles.reportMonthItem}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleReportMonthSelection(month)}
                  />
                  <span>{getMonthLabel(month)}</span>
                </label>
              );
            })}
          </div>
          <div className={styles.reportMonthModalFooter}>
            <button
              type="button"
              className={styles.reportMonthModalCancelButton}
              onClick={() => setReportMonthModalOpen(false)}
            >
              ยกเลิก
            </button>
            <button
              type="button"
              className={styles.reportMonthModalConfirmButton}
              onClick={handleDownloadReport}
              disabled={isDownloadingReport || orderedSelectedReportMonths.length === 0}
            >
              {isDownloadingReport ? 'กำลังสร้าง PDF...' : 'ดาวน์โหลดรายงาน'}
            </button>
          </div>
        </div>
      </div>
    )}
    <ChangePasswordModal
      open={changePasswordOpen}
      onClose={handleCloseChangePassword}
      onSubmit={handleChangePasswordSubmit}
      errorMessage={changePasswordError}
      isSubmitting={changePasswordSubmitting}
    />
    <ExpenseCalendarModal
      open={calendarOpen}
      onClose={({ changed } = {}) => {
        setCalendarOpen(false);
        if (changed) handleDataRefresh();
      }}
    />
    {selectedMonth && (
      <div className={styles.floatingBar}>
        <button
          type="button"
          className={styles.floatingBarNavBtn}
          onClick={handlePrevMonth}
          disabled={currentMonthIndex >= months.length - 1}
          title="เดือนก่อนหน้า"
          aria-label="เดือนก่อนหน้า"
        >
          <span style={{ display: 'flex', transform: 'rotate(90deg)' }}>
            <Icons.ChevronDown size={16} />
          </span>
        </button>
        <span className={styles.floatingBarMonth}>{getMonthLabel(selectedMonth)}</span>
        <button
          type="button"
          className={styles.floatingBarNavBtn}
          onClick={handleNextMonth}
          disabled={currentMonthIndex <= 0}
          title="เดือนถัดไป"
          aria-label="เดือนถัดไป"
        >
          <span style={{ display: 'flex', transform: 'rotate(-90deg)' }}>
            <Icons.ChevronDown size={16} />
          </span>
        </button>
        <div className={styles.floatingBarDivider} />
        <button
          type="button"
          className={styles.floatingBarSaveBtn}
          onClick={handleSaveAll}
        >
          <Icons.Save size={14} />
          บันทึก
        </button>
      </div>
    )}
  </>
  );
}
