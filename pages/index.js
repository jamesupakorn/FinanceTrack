/**
 * หน้า: / (ภาพรวม) — P2 · dashboard
 * แทนที่เนื้อหาชั่วคราวของ P1 ด้วยแดชบอร์ดจริง: 6 การ์ดสรุปยอด, วงแหวนกระแสเงินสด, สุขภาพงบประมาณ
 * (พับเก็บเริ่มต้น), ปฏิทินค่าใช้จ่ายแบบฝังตรง, รายการที่จะครบกำหนด, กระดิ่งแจ้งเตือน, ทางลัด
 *
 * ทุกยอดเงินมาจาก getMonthlySummaryModel()/evaluateBudgetHealth() (P1) ทุกเหตุการณ์ปฏิทิน/รายการ
 * ครบกำหนดมาจาก expenseEvents.js ตัวเดียวกับปฏิทิน — หน้านี้ไม่คำนวณเงินหรือ derive เหตุการณ์เอง
 * (BR-DASH-005/011/012) ไม่มี quick-add modal — ทางลัดพาไปหน้า /workspace เสมอ (goal ของ spec)
 *
 * งานสี่ตัวจัดการบัตรเครดิต/ผ่อนชำระ (toggle งวด/จ่ายเต็ม/จ่ายขั้นต่ำ/ยกเลิก) เป็น "แหล่งเดียว" ของหน้านี้
 * ใช้ร่วมกันทั้งปฏิทินที่ฝัง (DashboardCalendarSection) และรายการที่จะครบกำหนด (UpcomingPayments)
 * — ไม่ใช่สำเนาที่สาม (ExpenseCalendarModal.js ยังมีสำเนาของตัวเองแยกเพราะเป็นอินสแตนซ์อิสระ ตามที่
 * architecture review ของ spec-dashboard.md ยอมรับไว้แล้วว่าเป็นการซ้ำที่ตั้งใจ)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../src/frontend/components/Layout';
import { Icons } from '../src/frontend/components/Icons';
import CashFlowRing from '../src/frontend/components/CashFlowRing';
import BudgetHealthPanel from '../src/frontend/components/BudgetHealthPanel';
import DashboardCalendarSection from '../src/frontend/components/DashboardCalendarSection';
import UpcomingPayments from '../src/frontend/components/UpcomingPayments';
import NotificationBell from '../src/frontend/components/NotificationBell';
import { RevolvingConfirmDialog } from '../src/frontend/components/ExpenseCalendarModal';
import { useSession } from '../src/frontend/contexts/SessionContext';
import { showToast } from '../src/shared/utils/frontend/toast';
import {
  incomeAPI, expenseAPI, savingsAPI, salaryAPI, dailyExpenseAPI, taxAPI, creditCardAPI, userSettingsAPI
} from '../src/shared/utils/frontend/apiUtils';
import { getMonthlySummaryModel, DEFAULT_BUDGET_THRESHOLDS } from '../src/shared/utils/frontend/monthlySummary';
import { buildMonthEvents, collectUpcomingPayments } from '../src/shared/utils/frontend/expenseEvents';
import { formatMonthLabelTH } from '../src/shared/utils/frontend/monthUtils';
import { getCurrentMonthKey, addMonths, PLAN_STATUS } from '../src/shared/utils/creditCardUtils';
import cardStyles from '../src/frontend/styles/CreditCard.module.css';
import calStyles from '../src/frontend/styles/ExpenseCalendar.module.css';
import styles from '../src/frontend/styles/Dashboard.module.css';

const SELECTED_MONTH_KEY = 'edit_selected_month'; // key เดียวกับ workspace (edit.js:31) — ตั้งใจให้ตรงกัน

// href เจ็ดจุดนี้เปลี่ยนจาก /workspace?tab=... เป็น /workspace/... ตรง ๆ แล้ว (Amendment A5 —
// /workspace/* กลายเป็น route family จริง 8 เส้นทาง ไม่ใช่ query param อีกต่อไป)
const QUICK_ACTIONS = [
  { id: 'add-income', label: 'เพิ่มรายรับ', Icon: Icons.TrendingUp, href: '/workspace/income', primary: true },
  { id: 'add-expense', label: 'เพิ่มรายจ่าย', Icon: Icons.TrendingDown, href: '/workspace/expense' },
  { id: 'open-workspace', label: 'เปิดแผนการเงินรายเดือน', Icon: Icons.Edit, href: '/workspace/income' },
  { id: 'view-credit-cards', label: 'ดูบัตรเครดิต', Icon: Icons.CreditCard, href: '/credit-cards' },
  { id: 'open-calendar', label: 'เปิดปฏิทิน', Icon: Icons.Calendar, action: 'scroll-calendar' },
  // ทางเข้าเครื่องคำนวณเงินเดือนจุดที่หนึ่ง (Amendment A3 — ยกเลิกแผนหน้าแยก /salary ของ A1 แล้ว)
  // พาไปหน้า "รายรับ" ใน /workspace แล้วเปิด SalaryModal ให้อัตโนมัติผ่าน ?salary=open
  {
    id: 'salary-calculator',
    label: 'คำนวณเงินเดือน',
    Icon: Icons.DollarSign,
    href: '/workspace/income?salary=open'
  }
];

const MONTH_RE = /^\d{4}-\d{2}$/;

export default function DashboardPage() {
  const router = useRouter();
  const { currentUser } = useSession();

  const selectedMonthKey = useMemo(
    () => (currentUser ? `${SELECTED_MONTH_KEY}_${currentUser.id}` : SELECTED_MONTH_KEY),
    [currentUser?.id]
  );

  const [selectedMonth, setSelectedMonth] = useState(null);

  // เกณฑ์สุขภาพงบประมาณ — persist ต่อผู้ใช้แล้วใน P4 (ไม่ผูกกับเดือน จึงโหลดครั้งเดียวต่อผู้ใช้ ไม่ใช่
  // ทุกครั้งที่เปลี่ยนเดือน) เริ่มจากค่าเริ่มต้นเสมอ แล้วค่อยเปลี่ยนถ้าโหลดสำเร็จ (AC-RS-15)
  const [budgetThresholds, setBudgetThresholds] = useState(DEFAULT_BUDGET_THRESHOLDS);

  // ------------------------------------------------------------ ข้อมูลดิบต่อเดือน (9 คำขอ — ไม่มี userSettingsAPI ใน P2)
  const [incomeData, setIncomeData] = useState({});
  const [expenseData, setExpenseData] = useState({});
  const [savingsData, setSavingsData] = useState({});
  const [salaryData, setSalaryData] = useState({});
  const [dailyExpenseData, setDailyExpenseData] = useState({ totalMonthly: 0 });
  const [taxData, setTaxData] = useState({});
  const [monthsMap, setMonthsMap] = useState({}); // ทุกเดือน จาก expenseAPI.getAll() — ใช้กับปฏิทิน/รายการครบกำหนด
  const [cards, setCards] = useState([]);
  const [plans, setPlans] = useState([]);

  const [loading, setLoading] = useState(true);
  const [fullError, setFullError] = useState(false);
  const [partialErrorFields, setPartialErrorFields] = useState([]);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  const hasLoadedRef = useRef(false);

  // ปุ่มทำรายการบัตรเครดิต/ผ่อนชำระ — สถานะร่วมของทั้งหน้า (ปฏิทินฝัง + รายการที่จะครบกำหนด)
  const [pendingKeys, setPendingKeys] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const confirmDialogRef = useRef(null);

  const [ringFilter, setRingFilter] = useState(null);
  const [highlightedKey, setHighlightedKey] = useState(null);
  const [isConfirmingTransfer, setIsConfirmingTransfer] = useState(false);
  const highlightTimerRef = useRef(null);

  const calendarHeadingRef = useRef(null);

  // ล็อก scroll ของหน้าเบื้องหลังขณะกล่องยืนยัน "จ่ายขั้นต่ำ" เปิดอยู่ — แพทเทิร์นเดียวกับ ExpenseCalendarModal.js
  useEffect(() => {
    if (!confirmState || typeof document === 'undefined') return undefined;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, [confirmState]);

  // ดัก Tab ให้วนอยู่ในกล่องยืนยันเท่านั้น (ตรรกะเดียวกับ getTabbableElements ของ ExpenseCalendarModal.js/
  // Layout.js — คัดลอกมาเป็นอิสระที่นี่ ไม่แตะไฟล์เดิม เพื่อไม่ให้กระทบ AC-DB-11)
  useEffect(() => {
    if (!confirmState) return undefined;
    const handleTab = (event) => {
      if (event.key !== 'Tab' || !confirmDialogRef.current) return;
      const focusable = Array.from(confirmDialogRef.current.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]'
      )).filter((el) => el.tabIndex >= 0 && (el.offsetParent !== null || el.getClientRects().length > 0));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!confirmDialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [confirmState]);

  // ------------------------------------------------------------ เลือกเดือนเริ่มต้น (คงเดือนเดียวกับ workspace)
  useEffect(() => {
    if (!currentUser) return;
    const stored = typeof window !== 'undefined' ? localStorage.getItem(selectedMonthKey) : null;
    const currentMonth = getCurrentMonthKey();
    const initial = stored && MONTH_RE.test(stored) && stored <= currentMonth
      ? stored
      : currentMonth;
    setSelectedMonth(initial);
    if (typeof window !== 'undefined') {
      localStorage.setItem(selectedMonthKey, initial);
    }
    hasLoadedRef.current = false; // ผู้ใช้เปลี่ยน → ถือเป็นการโหลดครั้งแรกใหม่ (E15)
  }, [currentUser?.id, selectedMonthKey]);

  useEffect(() => {
    if (!currentUser || !selectedMonth || typeof window === 'undefined') return;
    localStorage.setItem(selectedMonthKey, selectedMonth);
  }, [currentUser, selectedMonth, selectedMonthKey]);

  useEffect(() => {
    setIsConfirmingTransfer(false);
  }, [selectedMonth]);

  // ------------------------------------------------------------ เกณฑ์สุขภาพงบประมาณ (P4) — โหลดครั้งเดียว
  // ต่อผู้ใช้ (ไม่ใช่ทุกเดือน) ล้มเหลวแล้ว fallback เป็นค่าเริ่มต้นเงียบ ๆ ไม่มี error โชว์ผู้ใช้ เพราะเกณฑ์
  // เป็นค่ากำหนดเอง ไม่ใช่ข้อมูลการเงินจริง (AC-RS-15)
  useEffect(() => {
    if (!currentUser) return undefined;
    let cancelled = false;
    userSettingsAPI.get()
      .then((data) => {
        if (cancelled) return;
        setBudgetThresholds(data?.budgetThresholds || DEFAULT_BUDGET_THRESHOLDS);
      })
      .catch(() => {
        if (cancelled) return;
        setBudgetThresholds(DEFAULT_BUDGET_THRESHOLDS);
      });
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  // toast ครั้งเดียวหลังบันทึกเกณฑ์ใหม่จาก /settings — ปิดความกำกวมระหว่าง "ฉันเปลี่ยนเกณฑ์เอง" กับ
  // "พฤติกรรมใช้จ่ายเปลี่ยน" ตอนแถบสี Budget Health ขยับ (UX Review §Threshold-change signal, AC-RS-31)
  // ล้าง flag ทันทีที่อ่าน — toast จึงขึ้นครั้งเดียวต่อการบันทึกเกณฑ์หนึ่งครั้ง ไม่ใช่ทุกครั้งที่เข้าหน้านี้ (E16/E17)
  useEffect(() => {
    if (!currentUser?.id || typeof window === 'undefined') return;
    const signalKey = `budgetThresholds_justUpdated_${currentUser.id}`;
    if (localStorage.getItem(signalKey)) {
      showToast('อัปเดตจากการเปลี่ยนเกณฑ์งบประมาณ', 'info');
      localStorage.removeItem(signalKey);
    }
  }, [currentUser?.id]);

  // ------------------------------------------------------------ ดึงข้อมูลทั้งหมด (E13/E14 — ล้มเหลวทีละจุด)
  const fetchAll = useCallback(async (monthKey) => {
    const year = monthKey.split('-')[0];
    const results = await Promise.allSettled([
      incomeAPI.getByMonth(monthKey),
      expenseAPI.getByMonth(monthKey),
      savingsAPI.getByMonth(monthKey),
      salaryAPI.getByMonth(monthKey),
      dailyExpenseAPI.getByMonth(monthKey),
      taxAPI.getByYear(year),
      expenseAPI.getAll(),
      creditCardAPI.getCards(),
      creditCardAPI.getPlans()
    ]);
    const [incomeR, expenseR, savingsR, salaryR, dailyR, taxR, allExpenseR, cardsR, plansR] = results;
    const failedFields = [];
    const pick = (result, fallback, label) => {
      if (result.status === 'fulfilled') return result.value;
      failedFields.push(label);
      return fallback;
    };

    return {
      incomeData: pick(incomeR, {}, 'รายรับ'),
      expenseData: pick(expenseR, {}, 'รายจ่ายทั่วไป/บัตรเครดิต'),
      savingsData: pick(savingsR, {}, 'เงินออม'),
      salaryData: pick(salaryR, {}, 'เงินเดือน'),
      dailyExpenseData: pick(dailyR, { totalMonthly: 0 }, 'รายจ่ายประจำวัน'),
      taxData: pick(taxR, {}, 'ภาษี'),
      monthsMap: (() => {
        const allExpense = pick(allExpenseR, { months: {} }, 'ปฏิทิน/รายการครบกำหนด');
        return allExpense?.months && typeof allExpense.months === 'object' ? allExpense.months : {};
      })(),
      cards: (() => {
        const res = pick(cardsR, { cards: [] }, 'บัตรเครดิต');
        return Array.isArray(res?.cards) ? res.cards : [];
      })(),
      plans: (() => {
        const res = pick(plansR, { plans: [] }, 'แผนผ่อนชำระ');
        return Array.isArray(res?.plans) ? res.plans : [];
      })(),
      failedFields,
      allFailed: results.every((result) => result.status === 'rejected')
    };
  }, []);

  const applyFetchResult = useCallback((data) => {
    setIncomeData(data.incomeData);
    setExpenseData(data.expenseData);
    setSavingsData(data.savingsData);
    setSalaryData(data.salaryData);
    setDailyExpenseData(data.dailyExpenseData);
    setTaxData(data.taxData);
    setMonthsMap(data.monthsMap);
    setCards(data.cards);
    setPlans(data.plans);
    setFullError(data.allFailed);
    setPartialErrorFields(data.allFailed ? [] : data.failedFields);
    if (data.failedFields.length > 0 && !data.allFailed) setNoticeDismissed(false);
  }, []);

  useEffect(() => {
    if (!currentUser || !selectedMonth) return undefined;
    let cancelled = false;
    if (!hasLoadedRef.current) setLoading(true); // สเกเลตันเฉพาะการโหลดครั้งแรก ไม่ใช่ทุกครั้งที่เปลี่ยนเดือน (E18)

    fetchAll(selectedMonth).then((data) => {
      if (cancelled) return; // ผู้ใช้สลับผู้ใช้/เดือนไปแล้วก่อน request นี้เสร็จ — ทิ้งผลลัพธ์เก่า (E15/E18)
      applyFetchResult(data);
      hasLoadedRef.current = true;
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [currentUser, selectedMonth, fetchAll, applyFetchResult]);

  const refreshData = useCallback(async () => {
    if (!selectedMonth) return;
    const data = await fetchAll(selectedMonth);
    applyFetchResult(data);
  }, [selectedMonth, fetchAll, applyFetchResult]);

  // ------------------------------------------------------------ โมเดล/เหตุการณ์ (P1 คำนวณเงินให้ทั้งหมด)
  const model = useMemo(() => getMonthlySummaryModel({
    month: selectedMonth,
    incomeData,
    expenseData,
    savingsData,
    dailyExpenseData,
    salaryData,
    taxData,
    thresholds: budgetThresholds
  }), [selectedMonth, incomeData, expenseData, savingsData, dailyExpenseData, salaryData, taxData, budgetThresholds]);

  const calendarData = useMemo(
    () => buildMonthEvents({ monthKey: selectedMonth, monthsMap, cards, plans }),
    [selectedMonth, monthsMap, cards, plans]
  );

  const upcoming = useMemo(
    () => collectUpcomingPayments({ monthsMap, cards, plans, horizonDays: 7 }),
    [monthsMap, cards, plans]
  );

  // E1 (ว่างจริง) vs E1b (มีแค่ยอดยกมารายวัน) — BR-DASH-008
  const hasAnyDocumentThisMonth = model.totalIncome > 0
    || model.generalExpense > 0
    || model.creditCard > 0
    || model.savings > 0
    || model.taxAccumulated > 0;
  const isTrulyEmpty = !hasAnyDocumentThisMonth && model.dailyExpense === 0;
  const isCarryoverOnly = !hasAnyDocumentThisMonth && model.dailyExpense > 0;

  // ------------------------------------------------------------ นำทางเดือน — ไม่จำกัดขอบเขต เหมือนปฏิทินเดิม (ADR-012)
  const handleNavigateMonth = useCallback((delta) => {
    setSelectedMonth((prev) => addMonths(prev, delta));
  }, []);

  const handleConfirmTransfer = useCallback(async () => {
    if (!selectedMonth || model.transferableSavings <= 0 || isConfirmingTransfer) return;
    setIsConfirmingTransfer(true);
    try {
      const result = await savingsAPI.confirmTransfer(
        selectedMonth,
        model.transferableSavings,
        model.savings + model.transferableSavings
      );
      showToast(result?.created === false ? 'เงินออมรายการนี้ถูกเพิ่มไว้แล้ว' : 'เพิ่มเงินเหลือเข้าเงินออมแล้ว');
      await refreshData();
    } catch (error) {
      showToast(error.message || 'เพิ่มเงินออมไม่สำเร็จ', 'error');
    } finally {
      setIsConfirmingTransfer(false);
    }
  }, [selectedMonth, model.transferableSavings, isConfirmingTransfer, refreshData]);

  const scrollToCalendar = useCallback(() => {
    const el = calendarHeadingRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  }, []);

  // ------------------------------------------------------------ ปุ่มทำรายการ — แหล่งเดียวของทั้งหน้า
  const setBusy = (key, busy) => {
    setPendingKeys((keys) => (busy ? [...keys, key] : keys.filter((item) => item !== key)));
  };

  const handleToggleInstallment = useCallback(async (event) => {
    if (!event.plan) return;
    const nextPaid = !event.paid;
    setBusy(event.key, true);
    try {
      const response = await creditCardAPI.setInstallmentPaid(event.plan.id, event.installmentNo, nextPaid);
      showToast(response?.plan?.status === PLAN_STATUS.COMPLETED ? 'ผ่อนครบแล้ว 🎉' : 'อัปเดตสถานะงวดแล้ว');
      await refreshData();
    } catch (err) {
      showToast(err.message || 'อัปเดตสถานะงวดไม่สำเร็จ', 'error');
    } finally {
      setBusy(event.key, false);
    }
  }, [refreshData]);

  const handleRevolvingFull = useCallback(async (event) => {
    if (!event.card || !selectedMonth) return;
    setBusy(event.key, true);
    try {
      await creditCardAPI.setRevolvingAction(event.card.id, selectedMonth, 'full');
      showToast('บันทึกการชำระแล้ว');
      await refreshData();
    } catch (err) {
      showToast(err.message || 'บันทึกไม่สำเร็จ', 'error');
    } finally {
      setBusy(event.key, false);
    }
  }, [selectedMonth, refreshData]);

  const handleRevolvingCancel = useCallback(async (event) => {
    if (!event.card || !selectedMonth) return;
    setBusy(event.key, true);
    try {
      await creditCardAPI.setRevolvingAction(event.card.id, selectedMonth, null);
      showToast('ยกเลิกการชำระแล้ว');
      await refreshData();
    } catch (err) {
      showToast(err.message || 'ยกเลิกการชำระไม่สำเร็จ', 'error');
    } finally {
      setBusy(event.key, false);
    }
  }, [selectedMonth, refreshData]);

  const handleRevolvingMinimumClick = useCallback(async (event) => {
    if (!event.card || !selectedMonth) return;
    setBusy(event.key, true);
    try {
      const response = await creditCardAPI.getRevolving({ cardId: event.card.id, month: selectedMonth });
      const cycle = (response?.cycles || []).find((item) => item.month === selectedMonth);
      setConfirmState({
        event,
        minPaymentDue: cycle?.minPaymentDue ?? 0,
        preview: cycle?.minimumPreview || { remaining: 0, interest: 0, closingBalance: 0 }
      });
    } catch (err) {
      showToast(err.message || 'โหลดข้อมูลยอดหมุนเวียนไม่สำเร็จ', 'error');
    } finally {
      setBusy(event.key, false);
    }
  }, [selectedMonth]);

  const handleConfirmMinimum = useCallback(async () => {
    const event = confirmState?.event;
    if (!event?.card || !selectedMonth) { setConfirmState(null); return; }
    setConfirmBusy(true);
    try {
      await creditCardAPI.setRevolvingAction(event.card.id, selectedMonth, 'minimum');
      showToast('บันทึกการชำระขั้นต่ำแล้ว');
      setConfirmState(null);
      await refreshData();
    } catch (err) {
      showToast(err.message || 'บันทึกไม่สำเร็จ', 'error');
    } finally {
      setConfirmBusy(false);
    }
  }, [confirmState, selectedMonth, refreshData]);

  // ------------------------------------------------------------ กระดิ่ง → เลื่อนไปเน้นรายการในการ์ด "ครบกำหนด"
  const handleSelectUpcomingItem = useCallback((key) => {
    setRingFilter(null); // ล้างตัวกรองไว้ก่อน ไม่งั้นรายการที่เลือกอาจถูกกรองออกจนมองไม่เห็น
    setHighlightedKey(key);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    // ต้องรอ 1 tick ให้ DOM re-render ตามตัวกรองที่เพิ่งล้างก่อนค่อยเลื่อนไปหา element จริง
    setTimeout(() => {
      document.getElementById(`upcoming-item-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
    highlightTimerRef.current = setTimeout(() => setHighlightedKey(null), 4000);
  }, []);

  useEffect(() => () => { if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current); }, []);

  const monthLabel = selectedMonth ? formatMonthLabelTH(selectedMonth) : '';

  const headerControls = (
    <div className={styles.headerControls}>
      <div className={styles.monthNavGroup}>
        <button type="button" className={styles.monthNavButton} onClick={() => handleNavigateMonth(-1)} aria-label="เดือนก่อนหน้า">
          <Icons.ChevronLeft size={18} />
        </button>
        <span className={styles.monthNavLabel}>{monthLabel}</span>
        <button type="button" className={styles.monthNavButton} onClick={() => handleNavigateMonth(1)} aria-label="เดือนถัดไป">
          <Icons.ChevronRight size={18} />
        </button>
      </div>
      <NotificationBell upcoming={upcoming} onSelectItem={handleSelectUpcomingItem} />
      <a href="/settings" className={styles.settingsGearButton} aria-label="ตั้งค่า">
        <Icons.Settings size={18} />
      </a>
    </div>
  );

  // isTrulyEmpty ไม่มีปฏิทินให้เลื่อนไปหา (ไม่ได้ render DashboardCalendarSection เลย) จึงตัด "เปิดปฏิทิน" ออก
  const renderQuickActions = ({ includeCalendarAction = true } = {}) => (
    <section className={styles.quickActionsSection} aria-label="ทางลัด">
      <h2 className={styles.sectionTitle}>ทางลัด</h2>
      <div className={styles.quickActionsGrid}>
        {QUICK_ACTIONS
          .filter((item) => includeCalendarAction || item.action !== 'scroll-calendar')
          .map(({ id, label, Icon, href, action, primary }) => (
            <button
              key={id}
              type="button"
              className={`${styles.quickActionButton} ${primary ? styles.quickActionButtonPrimary : ''}`}
              onClick={() => (action === 'scroll-calendar' ? scrollToCalendar() : router.push(href))}
            >
              <Icon size={22} />
              <span>{label}</span>
            </button>
          ))}
      </div>
    </section>
  );

  let body;
  if (loading) {
    // สเกเลตันขนาดจริงของทุกส่วน (AC-DB-26) — ใช้ dashboardGrid เดียวกับเนื้อหาจริงเพื่อไม่ให้ layout กระโดด
    body = (
      <div role="status" aria-busy="true">
        <span className={cardStyles.srOnly}>กำลังโหลดภาพรวม...</span>
        <div className={styles.dashboardGrid}>
          <div className={styles.insightsArea}>
            {/*
              * AC-DB-26: insights จริงคือ 2 การ์ดแยก (ringSection + panelCard ของ Budget Health ที่พับเก็บ
              * เป็นค่าเริ่มต้นเสมอ — AC-DB-29) ไม่ใช่บล็อกเดียวยาว ๆ — ห่อด้วยคลาสจริงจาก Dashboard.module.css
              * เพื่อให้ padding/gap ตรงกับของจริง แถวสรุปกระแสเงินสด (ringLegend) มี 5 แถวคงที่เสมอ (รายรับ +
              * รายจ่ายทั่วไป/รายจ่ายประจำวัน/เงินออม/บัตรเครดิต — ชุดคงที่จาก DashboardSummaryTiles/CashFlowRing
              * ไม่ผันตามข้อมูลผู้ใช้) จึงจับคู่ได้แน่นอน ต่างจาก panelCard ที่พับเก็บ (สูงคงที่ 1 แถวหัวข้อเสมอ)
              */}
            <div className={styles.ringSection}>
              <div className={cardStyles.skeleton} style={{ height: 22, width: '65%', borderRadius: 6, marginBottom: 16 }} />
              <div className={cardStyles.skeleton} style={{ width: 220, height: 220, borderRadius: '50%', margin: '0 auto 16px' }} />
              <div className={styles.ringLegend}>
                {Array.from({ length: 5 }).map((_, index) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <div key={index} className={cardStyles.skeleton} style={{ height: 44, borderRadius: 10 }} />
                ))}
              </div>
            </div>
            <div className={styles.panelCard}>
              <div className={cardStyles.skeleton} style={{ height: 44, borderRadius: 10 }} />
            </div>
          </div>
          <div className={styles.calendarArea}>
            {/*
              * AC-DB-26 (bug-log-dashboard.md): เดิมสเกเลตันมีแค่ตาราง 42 ช่อง ไม่มี nav/legend/footer/
              * แผงรายละเอียดวัน (day-detail) เลย ทำให้ต่ำกว่าความสูงจริงมาก (วัดจริงต่างกันหลักร้อย px)
              * แล้วดัน upcomingArea ที่อยู่แถวถัดไปในคอลัมน์เดียวกันของ dashboardGrid ลงไปกระโดด — ใช้คลาส
              * ".calendarWrap/.calendarNav/.calendarLayout" ตัวจริงจาก ExpenseCalendar.module.css ห่อ
              * เนื้อหาหลอกไว้แทน เพื่อให้ผัง 2 คอลัมน์ (ปฏิทิน + day-detail 320px) เหมือนของจริงเป๊ะ ๆ โดยไม่ต้อง
              * เดาตัวเลข px เอง (ทั้งสองที่ import ExpenseCalendar.module.css ตัวเดียวกันอยู่แล้ว)
              * หมายเหตุ: เดือนที่มีรายการ/บัตรจำนวนมากผิดปกติ (legend หลายบรรทัด, day-detail มีหลายรายการ)
              * ยังอาจขยับเกิน 8px ได้อยู่ดี เพราะความสูงจริงขึ้นกับจำนวนข้อมูลผันแปร ไม่ใช่ค่าคงที่ — ข้อจำกัด
              * เดียวกับ upcomingArea/รายการ "ครบกำหนด" ด้านล่าง ไม่มีสเกเลตันคงที่ใดจับคู่ความยาวลิสต์ผันแปรได้
              * เป๊ะ 100% ต้องแก้ที่สถาปัตยกรรม (เช่น max-height + scroll ภายใน) ถ้าจะการันตีทุกกรณี
              */}
            <div className={calStyles.calendarWrap}>
              <div className={calStyles.calendarNav}>
                <div className={cardStyles.skeleton} style={{ width: 44, height: 44, borderRadius: 12 }} />
                <div className={cardStyles.skeleton} style={{ width: 140, height: 22, borderRadius: 6 }} />
                <div className={cardStyles.skeleton} style={{ width: 44, height: 44, borderRadius: 12 }} />
              </div>
              <div className={calStyles.calendarLayout}>
                <div>
                  {/* แถวหัวตัวย่อวัน (อา/จ/อ/...) เป็น grid row แรกใน .calendarGrid จริง (ไม่ใช่แถวแยก) —
                      .calendarSkeletonGrid ไม่มีแถวนี้ ทำให้ขาดไปราว 30px ต่อความสูงจริงเสมอถ้าไม่จำลองไว้ */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
                    {Array.from({ length: 7 }).map((_, index) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <div key={index} className={cardStyles.skeleton} style={{ height: 15, borderRadius: 4 }} />
                    ))}
                  </div>
                  <div className={calStyles.calendarSkeletonGrid}>
                    {Array.from({ length: 42 }).map((_, index) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <div key={index} className={cardStyles.skeleton} />
                    ))}
                  </div>
                  <div className={cardStyles.skeleton} style={{ height: 18, width: '55%', borderRadius: 6, marginTop: 14 }} />
                  <div className={cardStyles.skeleton} style={{ height: 62, borderRadius: 10, marginTop: 14 }} />
                </div>
                <div>
                  <div className={cardStyles.skeleton} style={{ height: 20, width: '70%', borderRadius: 6, marginBottom: 10 }} />
                  {Array.from({ length: 3 }).map((_, index) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <div key={index} className={cardStyles.skeleton} style={{ height: 70, borderRadius: 16, marginBottom: 10 }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className={styles.upcomingArea}>
            {Array.from({ length: 3 }).map((_, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <div key={index} className={cardStyles.skeleton} style={{ height: 72, borderRadius: 16, marginBottom: 10 }} />
            ))}
          </div>
        </div>
      </div>
    );
  } else if (fullError) {
    body = (
      <div className={cardStyles.errorState} role="alert">
        <span>โหลดข้อมูลภาพรวมไม่สำเร็จ</span>
        <button type="button" className={cardStyles.ghostButton} onClick={refreshData}>ลองอีกครั้ง</button>
      </div>
    );
  } else if (isTrulyEmpty) {
    body = (
      <div className={styles.pageEmptyState}>
        <Icons.BarChart size={40} color="var(--color-primary)" />
        <h2 className={styles.sectionTitle}>ยังไม่มีข้อมูลของเดือนนี้</h2>
        <p>เริ่มจากบันทึกรายรับของเดือนนี้ แล้วภาพรวมจะคำนวณให้อัตโนมัติ</p>
        {renderQuickActions({ includeCalendarAction: false })}
      </div>
    );
  } else {
    body = (
      <>
        {partialErrorFields.length > 0 && !noticeDismissed && (
          <div className={styles.errorNotice} role="alert">
            <span>{`โหลดข้อมูลบางส่วนไม่สำเร็จ: ${partialErrorFields.join(', ')}`}</span>
            <div>
              <button type="button" className={styles.errorNoticeRetry} onClick={refreshData}>ลองอีกครั้ง</button>
              <button
                type="button"
                className={styles.errorNoticeDismiss}
                onClick={() => setNoticeDismissed(true)}
                aria-label="ปิดข้อความแจ้งเตือน"
              >
                <Icons.X size={16} />
              </button>
            </div>
          </div>
        )}

        <div className={styles.dashboardGrid}>
          <div className={styles.insightsArea}>
            {isCarryoverOnly ? (
              <div className={styles.carryoverNote}>
                ยังไม่มีข้อมูลรายรับ/รายจ่ายอื่นสำหรับเดือนนี้
              </div>
            ) : (
              <>
                <CashFlowRing model={model} selected={ringFilter} onSelect={setRingFilter} monthLabel={monthLabel} />
                <BudgetHealthPanel
                  model={model}
                  thresholds={budgetThresholds}
                  onConfirmTransfer={handleConfirmTransfer}
                  isConfirmingTransfer={isConfirmingTransfer}
                />
              </>
            )}
          </div>

          <div className={styles.calendarArea}>
            <DashboardCalendarSection
              headingRef={calendarHeadingRef}
              monthKey={selectedMonth}
              onNavigateMonth={handleNavigateMonth}
              calendarData={calendarData}
              cards={cards}
              loading={false}
              error={null}
              onRetry={refreshData}
              pendingKeys={pendingKeys}
              onToggleInstallment={handleToggleInstallment}
              onRevolvingFull={handleRevolvingFull}
              onRevolvingMinimum={handleRevolvingMinimumClick}
              onRevolvingCancel={handleRevolvingCancel}
            />
          </div>

          <div className={styles.upcomingArea}>
            <UpcomingPayments
              upcoming={upcoming}
              filter={ringFilter}
              onClearFilter={() => setRingFilter(null)}
              onViewCalendar={scrollToCalendar}
              pendingKeys={pendingKeys}
              onToggleInstallment={handleToggleInstallment}
              onRevolvingFull={handleRevolvingFull}
              onRevolvingMinimum={handleRevolvingMinimumClick}
              highlightedKey={highlightedKey}
            />
          </div>

          <div className={styles.quickActionsArea}>
            {renderQuickActions()}
          </div>
        </div>
      </>
    );
  }

  return (
    <Layout
      activeNav="dashboard"
      title="ภาพรวม"
      headerActions={headerControls}
      onCalendarNavClick={scrollToCalendar}
    >
      {body}

      {/* จ่ายขั้นต่ำต้องยืนยันก่อนเสมอ (BR-CC-015) — อินสแตนซ์เดียวของทั้งหน้า ใช้ร่วมกันทั้งปฏิทินและรายการครบกำหนด */}
      <RevolvingConfirmDialog
        open={Boolean(confirmState)}
        dialogRef={confirmDialogRef}
        restoreFocusRef={calendarHeadingRef}
        cardName={confirmState?.event?.card?.name}
        minPaymentDue={confirmState?.minPaymentDue}
        preview={confirmState?.preview}
        busy={confirmBusy}
        onCancel={() => setConfirmState(null)}
        onConfirm={handleConfirmMinimum}
      />
    </Layout>
  );
}
