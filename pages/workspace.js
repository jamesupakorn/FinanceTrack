import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import IncomeTable from '../src/frontend/components/IncomeTable';
import ExpenseTable from '../src/frontend/components/ExpenseTable';
import SavingsTable from '../src/frontend/components/SavingsTable';
import SavingsGoalTracker from '../src/frontend/components/SavingsGoalTracker';
import InvestmentTable from '../src/frontend/components/InvestmentTable';
import DailyExpenseTable from '../src/frontend/components/DailyExpenseTable';

import TaxTable from '../src/frontend/components/TaxTable';
import MonthManager from '../src/frontend/components/MonthManager';
import SalaryModal from '../src/frontend/components/SalaryModal';
import { Icons } from '../src/frontend/components/Icons';
import Layout from '../src/frontend/components/Layout';
import { useTheme } from '../src/frontend/contexts/ThemeContext';
import { useSession } from '../src/frontend/contexts/SessionContext';
import { incomeAPI, expenseAPI, savingsAPI, salaryAPI } from '../src/shared/utils/frontend/apiUtils';
import { formatMonthLabelTH } from '../src/shared/utils/frontend/monthUtils';
import styles from '../src/frontend/styles/Home.module.css';

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}


const SELECTED_MONTH_KEY = 'edit_selected_month';

// รายการแท็บที่ /workspace รองรับผ่าน query ?tab= (P3 · monthly-workspace)
const TAB_IDS = ['income', 'expense', 'savings', 'daily', 'tax'];

// ใช้แสดงชื่อเดือนบน floating bar เท่านั้น (Download Report PDF + buildMonthlyReportPayload
// ย้ายไปอยู่ที่ /reports ทั้งหมดแล้ว — P4 · reports-settings)
const getMonthLabel = (monthKey) => {
  try {
    return formatMonthLabelTH(monthKey);
  } catch (error) {
    return monthKey;
  }
};

export default function WorkspacePage() {
  const router = useRouter();
  // Session guard, 60-min inactivity timeout, user menu และ ExpenseCalendarModal ย้ายไปรวมที่ Layout
  // แล้ว (shell-navigation P1) — เดิมอยู่ที่นี่ (edit.js:168-212, 239-242, 462-494, 584-625, 859-872)
  const { currentUser } = useSession();
  const selectedMonthKey = useMemo(() => currentUser ? `${SELECTED_MONTH_KEY}_${currentUser.id}` : SELECTED_MONTH_KEY, [currentUser?.id]);
  const { theme } = useTheme();
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [activeTab, setActiveTab] = useState('income');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  // เครื่องคำนวณเงินเดือนกลับมาอยู่ที่นี่แล้ว — เป็น modal ที่เปิดจากแถว "เงินเดือน" ใน IncomeTable
  // (Amendment A3, ยกเลิกแผน /salary แยกหน้าของ A1) ตัวนับนี้จึง "ละลาย" กลับมาใช้งานจริงอีกครั้ง —
  // ผูกกับปุ่มบันทึกของ modal เอง (SalaryModal → handleSalaryModalSaved) ไม่ใช่ Save All อีกต่อไป
  const [salaryUpdateTrigger, setSalaryUpdateTrigger] = useState(0);
  const [salaryModalOpen, setSalaryModalOpen] = useState(false);
  const [triggerSave, setTriggerSave] = useState(0);
  const [months, setMonths] = useState([]);
  const [isDirty, setIsDirty] = useState(false);
  const navTimeoutRef = React.useRef(null);

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

  // ซิงก์แท็บที่ active กับ ?tab= ใน URL (mount และทุกครั้งที่ query เปลี่ยน) — ค่าที่ไม่รู้จักหรือไม่มี
  // จะ fallback เป็น 'income' ตามค่าเริ่มต้นเดิม และไม่เขียนกลับลง URL
  React.useEffect(() => {
    const tabFromQuery = router.query.tab;
    if (TAB_IDS.includes(tabFromQuery)) {
      setActiveTab(tabFromQuery);
    }
  }, [router.query.tab]);

  // ทางเข้า modal เงินเดือนจากลิงก์ภายนอก (Dashboard Quick Action, ลิงก์ท้าย /reports) ผ่าน
  // ?tab=income&salary=open — เปิด modal อัตโนมัติ + บังคับแท็บเป็น "รายรับ" เสมอ (E16/D-4: ลิงก์
  // ที่ส่ง tab อื่นมาพร้อม salary=open ก็ต้องลงเอยที่แท็บรายรับ ไม่ใช่แท็บที่ส่งมา)
  // ตัด salary ออกจาก URL "ตอนเปิด" ทันที ไม่ใช่ตอนปิด — reload ระหว่าง modal เปิดอยู่จะได้ไม่เปิดซ้ำ (E16)
  React.useEffect(() => {
    if (router.query.salary !== 'open') return;
    setSalaryModalOpen(true);
    setActiveTab('income');
    const { salary, ...restQuery } = router.query;
    router.replace({ pathname: '/workspace', query: { ...restQuery, tab: 'income' } }, undefined, { shallow: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query.salary]);

  // useCallback ให้ reference คงที่ข้าม render (ไม่มี dependency ภายนอกที่ใช้จริง เพราะใช้แค่
  // setState แบบ updater function) — MonthManager ผูก effect ของตัวเองไว้กับ reference ของ
  // onDataRefresh (MonthManager.js:112) ถ้าไม่ memoize ที่นี่ ทุก re-render ของ WorkspacePage
  // (เช่น สลับ tab, พิมพ์แล้ว isDirty เปลี่ยน) จะทำให้ effect นั้นยิง fetch เดือนซ้ำโดยไม่จำเป็น
  const handleDataRefresh = React.useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

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

  // ปิดการนำทางออกจากหน้านี้แบบเงียบๆ ตอนมีข้อมูลยังไม่ได้บันทึก (E4 · UX Review) — ใช้ auto-save
  // แพทเทิร์นเดียวกับตอนเปลี่ยนเดือน (ADR-006 Decision 6) เพียงแต่ไม่หน่วง 300ms เพราะดีเลย์นั้นมีไว้กัน
  // การกดลูกศรเปลี่ยนเดือนรัวๆ ซึ่งไม่เกี่ยวกับการแตะเมนูนำทางครั้งเดียว ถ้าบันทึกไม่สำเร็จก็ยังนำทางต่อ
  // ไปหน้าใหม่อยู่ดี (toast แจ้งความล้มเหลวจากแต่ละ section เดิมยังทำงานเหมือนเดิม ไม่ปล่อยผู้ใช้ค้างหน้า)
  const handleBeforeNavigate = React.useCallback(async () => {
    if (isDirty) {
      handleSaveAll();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty]);

  const tabContentRef = React.useRef(null);

  const handleTabClick = (tabId) => {
    setActiveTab(tabId);
    tabContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // ตัด salary=open ทิ้งก่อน spread query เดิม ไม่งั้นสลับแท็บแล้วโดนเขียนกลับเข้า URL ซ้ำ (N-4)
    const { salary, ...restQuery } = router.query;
    router.replace(
      { pathname: '/workspace', query: { ...restQuery, tab: tabId } },
      undefined,
      { shallow: true }
    );
  };

  // ต้องเช็ค isDirty ก่อนเปิด modal เสมอ ไม่ใช่แค่ป้องกันไว้เฉยๆ — พอบันทึกเงินเดือนสำเร็จ
  // salaryUpdateTrigger จะดันให้ IncomeTable รีเฟรชค่าจากเซิร์ฟเวอร์ทั้งแถว ถ้าแถวอื่นมีค่าพิมพ์ค้าง
  // (ยังไม่ได้ save) อยู่ ค่านั้นจะถูกเขียนทับหายไปเงียบๆ โดยไม่มี toast เตือนเลย (E9)
  // ใช้ shape เดียวกับ handleBeforeNavigate (:197-202) ที่แก้ปัญหาเดียวกันตอนเปลี่ยนหน้า
  const handleOpenSalaryModal = () => {
    if (isDirty) {
      handleSaveAll();
    }
    setSalaryModalOpen(true);
  };

  const handleCloseSalaryModal = () => {
    setSalaryModalOpen(false);
  };

  const handleSalaryModalSaved = () => {
    setSalaryUpdateTrigger(prev => prev + 1);
    handleCloseSalaryModal();
  };

  return (
  <Layout
    activeNav="workspace"
    title="บันทึกรายเดือน"
    onCalendarClose={({ changed } = {}) => { if (changed) handleDataRefresh(); }}
    onBeforeNavigate={handleBeforeNavigate}
  >
    <div className={styles.mainContent}>
      <MonthManager
        selectedMonth={selectedMonth}
        onMonthSelected={handleMonthSelected}
        onDataRefresh={handleDataRefresh}
        months={months}
      />

      <div className={styles.tabNavigation} ref={tabContentRef}>
        {[{ id: 'income', label: 'รายรับ', icon: <Icons.TrendingUp size={20} /> },
          { id: 'expense', label: 'รายจ่าย', icon: <Icons.CreditCard size={20} /> },
          { id: 'savings', label: 'เงินออม', icon: <Icons.PiggyBank size={20} /> },
          { id: 'daily', label: 'รายวัน', icon: <Icons.CreditCard size={20} /> },
          { id: 'tax', label: 'ภาษี', icon: <Icons.BarChart size={20} /> }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab.id)}
            className={`${styles.tabButton} ${activeTab === tab.id ? styles.active : ''}`}
            aria-current={activeTab === tab.id ? 'true' : undefined}
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
              onOpenSalaryModal={handleOpenSalaryModal}
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
    {/* modal เป็น sibling ของ .mainContent/.floatingBar ไม่ใช่ลูกของ .tabContent — .tabContent มี
        onInput/onChange ที่ตั้ง isDirty=true จากทุก input ข้างใน ถ้า modal ซ้อนอยู่ในนั้น การพิมพ์ใน
        modal จะไปตั้งค่า dirty ปลอมให้อีก 5 แท็บที่ไม่ได้แตะ (planner gate B-blocker บน Amendment A3) */}
    <SalaryModal
      open={salaryModalOpen}
      selectedMonth={selectedMonth}
      onClose={handleCloseSalaryModal}
      onSaved={handleSalaryModalSaved}
    />
    {/* ซ่อน floating bar ระหว่างเปิด modal เงินเดือน — กันการกด "บันทึก" (Save All) ระหว่างที่ modal
        กำลังบันทึกอยู่พร้อมกัน ซึ่งอาจแข่งกันเขียนทับค่า salary ใน income เดือนเดียวกัน (N-2) */}
    {selectedMonth && !salaryModalOpen && (
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
  </Layout>
  );
}
