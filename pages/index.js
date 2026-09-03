/**
 * หน้า: / (ภาพรวม) — P2 · dashboard
 * แทนที่เนื้อหาชั่วคราวของ P1 ด้วยแดชบอร์ดจริง: การ์ด "ครบกำหนด", วงแหวนกระแสเงินสด, สุขภาพงบประมาณ
 * (พับเก็บเริ่มต้น), ปฏิทินค่าใช้จ่ายแบบฝังตรง (พับเก็บเริ่มต้นที่ base tier), กระดิ่งแจ้งเตือน, ทางลัด
 *
 * ทุกยอดเงินมาจาก getMonthlySummaryModel()/evaluateBudgetHealth() (P1) ทุกเหตุการณ์ปฏิทิน/รายการ
 * ครบกำหนดมาจาก expenseEvents.js ตัวเดียวกับปฏิทิน — หน้านี้ไม่คำนวณเงินหรือ derive เหตุการณ์เอง
 * (BR-DASH-005/011/012) ไม่มี quick-add modal — ทางลัดพาไปหน้า /workspace เสมอ (goal ของ spec)
 *
 * งานสี่ตัวจัดการบัตรเครดิต/ผ่อนชำระ (toggle งวด/จ่ายเต็ม/จ่ายขั้นต่ำ/ยกเลิก) เป็น "แหล่งเดียว" ของหน้านี้
 * ใช้ร่วมกันทั้งปฏิทินที่ฝัง (DashboardCalendarSection) และรายการที่จะครบกำหนด (UpcomingPayments)
 * — ไม่ใช่สำเนาที่สาม (ExpenseCalendarModal.js ยังมีสำเนาของตัวเองแยกเพราะเป็นอินสแตนซ์อิสระ ตามที่
 * architecture review ของ spec-dashboard.md ยอมรับไว้แล้วว่าเป็นการซ้ำที่ตั้งใจ)
 *
 * Graphite redesign (Dashboard pass) — Tailwind only (UX_SPEC §6.3 base / §6.4 lg), ไม่มี
 * Dashboard.module.css/CreditCard.module.css อีกต่อไป (architecture-review-dashboard-graphite.md
 * Finding 1) ลำดับ DOM จริงตอนนี้คือ "ครบกำหนด" ก่อน (journey J1) แล้วตามด้วยวงแหวน/สุขภาพงบประมาณ/
 * ปฏิทิน/ทางลัด — จัดด้วย JSX order ตรง ๆ ที่ base tier แล้วค่อยจัดผัง 2 คอลัมน์ด้วย CSS grid เฉพาะที่ lg
 * (Finding 4 — ไม่ใช้ grid-template-areas ที่ base tier เหมือนเดิมอีกต่อไป) ยังคง import
 * ExpenseCalendar.module.css (calStyles) สำหรับ "รูปร่างสเกเลตัน" ของปฏิทินเต็มที่ lg เท่านั้น (ปฏิทินเอง
 * ยังอยู่นอก scope ของ pass นี้ — ยังเป็น CSS Modules ต่อไป การอ้างอิงคลาสจริงของมันเพื่อให้สเกเลตันตรง
 * ความสูงจริงไม่ใช่ CreditCard.module.css coupling ที่ Finding 1 พูดถึง)
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
import calStyles from '../src/frontend/styles/ExpenseCalendar.module.css';

const SELECTED_MONTH_KEY = 'edit_selected_month'; // key เดียวกับ workspace (edit.js:31) — ตั้งใจให้ตรงกัน

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
// การ์ด/แผงหลักทุกใบใช้กติกาเดียวกัน (C1 §5 component vocabulary) — surface-1 + radius-md + border-default
// + elev-1 + padding space-4 (base) / space-5 (md+)
const CARD = 'rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 md:p-space-5';
// grid item ทุกตัวต้อง min-w-0 กัน string เงินไทยยาว ๆ ดันคอลัมน์กว้างเกิน track ของตัวเอง (bug-log-dashboard.md)
const GRID_ITEM = 'min-w-0';

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
    <div className="flex w-full flex-wrap items-center justify-between gap-space-3 md:w-auto md:justify-start">
      <div className="flex items-center gap-space-2">
        <button
          type="button"
          className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-border-default bg-surface-2 text-primary ${FOCUS_RING}`}
          onClick={() => handleNavigateMonth(-1)}
          aria-label="เดือนก่อนหน้า"
        >
          <Icons.ChevronLeft size={18} />
        </button>
        <span className="min-w-[96px] text-center text-sm font-bold text-primary md:min-w-[120px] md:text-base">{monthLabel}</span>
        <button
          type="button"
          className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-border-default bg-surface-2 text-primary ${FOCUS_RING}`}
          onClick={() => handleNavigateMonth(1)}
          aria-label="เดือนถัดไป"
        >
          <Icons.ChevronRight size={18} />
        </button>
      </div>
      <NotificationBell upcoming={upcoming} onSelectItem={handleSelectUpcomingItem} />
      <a
        href="/settings"
        className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-border-default bg-surface-2 text-primary no-underline ${FOCUS_RING}`}
        aria-label="ตั้งค่า"
      >
        <Icons.Settings size={18} />
      </a>
    </div>
  );

  // isTrulyEmpty ไม่มีปฏิทินให้เลื่อนไปหา (ไม่ได้ render DashboardCalendarSection เลย) จึงตัด "เปิดปฏิทิน" ออก
  const renderQuickActions = ({ includeCalendarAction = true } = {}) => (
    <section className={CARD} aria-label="ทางลัด">
      <h2 className="mb-space-4 text-xl font-semibold text-primary">ทางลัด</h2>
      <div className="grid grid-cols-2 gap-space-3 md:grid-cols-3 lg:grid-cols-6">
        {QUICK_ACTIONS
          .filter((item) => includeCalendarAction || item.action !== 'scroll-calendar')
          .map(({ id, label, Icon, href, action, primary }) => (
            <button
              key={id}
              type="button"
              className={`flex min-h-11 flex-col items-start gap-space-2 rounded-md border p-space-4 text-left font-semibold transition-transform duration-base hover:-translate-y-0.5 ${FOCUS_RING} ${
                primary
                  ? 'border-transparent bg-accent text-on-accent'
                  : 'border-border-default bg-surface-2 text-primary hover:bg-accent-muted'
              }`}
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
    // สเกเลตันขนาดจริงของทุกส่วน (AC-DB-26) — ต้องแบ่งตาม tier เพราะ DashboardCalendarSection พับเก็บ
    // เป็นค่าเริ่มต้นที่ base tier (ความสูงจริงคือแค่แถวหัวข้อเดียว ไม่ใช่ตาราง 42 ช่องอีกต่อไป) แต่ขยายเสมอ
    // ที่ lg (ความสูงจริงคือตารางเต็ม) — สเกเลตันของปฏิทินจึงมีสองรูปแบบคู่กัน สลับด้วย CSS responsive
    // class เดียวกับที่ DashboardCalendarSection ใช้จริง (hidden lg:block / block lg:hidden)
    body = (
      <div role="status" aria-busy="true">
        <span className="sr-only">กำลังโหลดภาพรวม...</span>
        <div className="flex flex-col gap-space-4 lg:grid lg:grid-cols-12 lg:items-start lg:gap-space-5">
          {/* 1. ครบกำหนด (J1) */}
          <div className={`${GRID_ITEM} lg:col-start-1 lg:col-span-5 lg:row-start-1`}>
            <div className={CARD}>
              <div className="mb-space-4 h-6 w-2/3 animate-pulse rounded-sm bg-surface-2" />
              <div className="flex flex-col gap-space-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <div key={index} className="h-[88px] animate-pulse rounded-md bg-surface-2" />
                ))}
              </div>
            </div>
          </div>

          {/* 2. วงแหวนกระแสเงินสด */}
          <div className={`${GRID_ITEM} lg:col-start-1 lg:col-span-5 lg:row-start-2`}>
            <div className={CARD}>
              {/* h-[31px], not h-6 (24px) — real <h2 className="text-xl"> is 30.8px under the fontSize
                  scale (§3.2), not Tailwind's stock 20px text-xl (Stage 4 round-2 finding) */}
              <div className="mb-space-4 h-[31px] w-2/3 animate-pulse rounded-sm bg-surface-2" />
              <div className="mx-auto mb-space-4 h-[220px] w-[220px] animate-pulse rounded-full bg-surface-2" />
              <div className="flex flex-col gap-space-1">
                {/* h-[79px] md:h-14 — CashFlowRing's own [@container(max-width:330px)] threshold wraps
                    each legend row to two lines at base tier (measured 79.375px live), but the ring
                    card is wide enough at md+ that no row wraps (measured 56px = h-14, was regressed to
                    a flat h-[76px] with no tier split in the previous pass — Stage 4 round-2 finding) */}
                {Array.from({ length: 5 }).map((_, index) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <div key={index} className="h-[79px] animate-pulse rounded-sm bg-surface-2 md:h-14" />
                ))}
              </div>
            </div>
          </div>

          {/* 3. สุขภาพงบประมาณ — พับเก็บเป็นค่าเริ่มต้นทุก tier รวม lg (AC-DB-29) แต่ TransferableSavingsAction
              (BudgetHealthPanel.js:148-154) render อยู่นอก !collapsed guard เสมอ ไม่ว่าจะพับหรือกาง — สเกเลตัน
              นี้จึงจงใจ target แค่ baseline "พับ" เท่านั้น (h-11 หัวข้อ + บล็อกนี้) ไม่ไล่ตามความสูงตอน
              auto-expand (attentionCount > 0) อีกต่อไป — กรณีนั้นความสูงแปรผันตามจำนวนแถวที่ต้องระวัง
              ประมาณล่วงหน้าไม่ได้จริง (สเปกเก่าเคยลองไล่ตามและพลาดหลัก 500-700px ทุกครั้ง) ผู้ใช้ตัดสินใจแล้วว่า
              ให้ BudgetHealthPanel เองรับผิดชอบ "การขยับความสูงให้นุ่มนวล" ตอน auto-expand ด้วยแอนิเมชันแทน
              (ดู BudgetHealthPanel.js) — ไม่ใช่หน้าที่ของสเกเลตันอีกต่อไป (BUG-DG-2 resolution, Stage 4 round 3)
              h-[121px] md:h-[66px] — TransferableSavingsAction (บล็อกเดียวที่ค้ำความสูงขั้นต่ำ) เป็น flex-col
              ที่ base แต่ md:flex-row (BudgetHealthPanel.js) จึงเตี้ยลงที่ md+ เดิมสเกเลตันมีแค่ค่าเดียว
              (base-tier only) ทำให้ overshoot ที่ md+ (Stage 4 round-2 finding) — เอา mt-space-4 เดิมออกด้วย
              เพราะ TransferableSavingsAction จริงมี pt-space-4 เป็น padding ภายในตัวเองอยู่แล้ว (ไม่ใช่ margin
              ภายนอก) ระยะห่างนี้จึงถูกนับซ้ำสองชั้นในสเกเลตันเดิม */}
          <div className={`${GRID_ITEM} lg:col-start-1 lg:col-span-5 lg:row-start-3`}>
            <div className={CARD}>
              <div className="h-11 animate-pulse rounded-sm bg-surface-2" />
              <div className="h-[121px] animate-pulse rounded-md bg-surface-2 md:h-[66px]" />
            </div>
          </div>

          {/* 4. ปฏิทิน — สองรูปแบบคู่กันตาม tier (ดูหมายเหตุด้านบน) */}
          <div className={`${GRID_ITEM} lg:col-start-6 lg:col-span-7 lg:row-start-1 lg:row-span-3`}>
            <div className={CARD}>
              {/* base/md: พับเก็บ — แถวหัวข้อเดียว */}
              <div className="h-11 animate-pulse rounded-sm bg-surface-2 lg:hidden" />
              {/* lg: ขยายเสมอ — ใช้ calStyles.calendarWrap/calendarNav/calendarLayout/calendarLegend/
                  calendarFooter ตัวจริงเพื่อสืบทอด padding/margin ของแต่ละส่วนอัตโนมัติ (ไม่ต้องเดา margin
                  เองอีกที) calStyles.calendarLayout เองมี container-type ที่สืบทอดมาจาก calendarWrap อยู่แล้ว
                  จึงพับเป็นคอลัมน์เดียวเองโดยอัตโนมัติผ่าน @container query จริงเมื่อคอลัมน์ dashboard แคบ
                  (ไม่ต้อง hardcode "single-column" เป็น flex-col เหมือนรอบก่อน) วันในตารางไม่ได้ใช้ calStyles.
                  calendarSkeletonGrid ตัวเดียวกับ ExpenseCalendarModal.js เพราะบริบทกว้างต่างกัน (modal กว้าง
                  960px ใช้เซลล์ 64px ได้จริง ส่วนคอลัมน์ dashboard ที่ lg แคบแค่ ~510-650px ทำให้
                  ExpenseCalendar.module.css:303's @container(max-width:700px) บังคับเซลล์จริงเหลือแค่ ~52px
                  gap 2px เสมอที่นี่ — วัดสดจริงคือ 47px/แถวโดยเฉลี่ย ไม่ใช่ 64px) จึงสร้างกริดของตัวเองแยกด้วย
                  Tailwind ล้วน ๆ แทนที่จะแก้ CSS module ที่ใช้ร่วมกับ modal (จะกระทบ modal โดยไม่ตั้งใจ) —
                  ตัวเลขทั้งหมดวัดสดจากบัญชีสาธิตจริงที่ lg (1280px), Stage 4 round 3 */}
              <div className="hidden lg:block">
                <div className="mb-space-4 h-[31px] w-1/3 animate-pulse rounded-sm bg-surface-2" />
                <div className={calStyles.calendarWrap}>
                  <div className={calStyles.calendarNav}>
                    <div className="h-11 w-11 animate-pulse rounded-md bg-surface-2" />
                    <div className="h-6 w-[140px] animate-pulse rounded-sm bg-surface-2" />
                    <div className="h-11 w-11 animate-pulse rounded-md bg-surface-2" />
                  </div>
                  <div className={calStyles.calendarLayout}>
                    <div>
                      {/* กริดวัน (หัวข้อวัน + 5 แถววันรวมเป็น 6 แถว) — เซลล์ 47px/gap 2px ไม่ใช่ 64px/4px
                          ของ calStyles.calendarSkeletonGrid (นั่นคาลิเบรตสำหรับบริบท modal ที่กว้างกว่า) */}
                      <div className="grid grid-cols-7 gap-[2px]">
                        {Array.from({ length: 42 }).map((_, index) => (
                          // eslint-disable-next-line react/no-array-index-key
                          <div key={index} className="h-[47px] animate-pulse rounded-sm bg-surface-2" />
                        ))}
                      </div>
                      <div className={calStyles.calendarLegend}>
                        <div className="h-4 w-[220px] animate-pulse rounded-sm bg-surface-2" />
                      </div>
                      <div className={calStyles.calendarFooter}>
                        <div className="h-5 w-[160px] animate-pulse rounded-sm bg-surface-2" />
                        <div className="mt-1 h-4 w-[200px] animate-pulse rounded-sm bg-surface-2" />
                      </div>
                    </div>
                    <div className="h-[111px] animate-pulse rounded-md bg-surface-2" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 5. ทางลัด */}
          <div className={`${GRID_ITEM} lg:col-start-1 lg:col-span-12 lg:row-start-4`}>
            <div className={CARD}>
              <div className="mb-space-4 h-[31px] w-1/3 animate-pulse rounded-sm bg-surface-2" />
              {/* ความสูงจริงต่อไทล์ไม่เท่ากันทุกไทล์ — ขึ้นกับว่า label ของไทล์นั้นตัดบรรทัดหรือไม่ (2 บรรทัด
                  ที่ความกว้างคอลัมน์แคบ) วัดสดจากบัญชีสาธิตจริง: ที่ base (grid-cols-2, 3 แถว) มีแค่แถวกลาง
                  (ไทล์ open-workspace — "เปิดแผนการเงินรายเดือน" ตัด 2 บรรทัด) สูง 115px ส่วนอีก 2 แถวสูง
                  90px ที่ md (grid-cols-3) กว้างพอไม่มีไทล์ไหนตัดบรรทัด ทุกไทล์ 90px ที่ lg (grid-cols-6, แถว
                  เดียว) แถวเดียวกันทั้งหมดจึงถูกไทล์ที่ยาวที่สุดดันความสูงทั้งแถวเป็น 115px เท่ากันหมด (CSS
                  Grid ให้ความสูง track = max ของไทล์ในแถวนั้นเสมอ ไม่ต้องบังคับทุกไทล์ให้ตัวเลขเดียวกันเอง —
                  ระบุแค่ไทล์ที่ตัดบรรทัดจริง ที่เหลือ CSS จะดันตามให้เอง) Stage 4 round 3
                  เลือกไทล์ด้วย item.id ไม่ใช่ตำแหน่ง index — สลับลำดับ QUICK_ACTIONS แล้วสเกเลตันยังชี้ไทล์
                  ที่ label ยาวจริงตัวเดิม (ค่าที่ render ออกมาเท่ากับเดิมทุกประการวันนี้ เพราะ open-workspace
                  อยู่ที่ index 2 พอดี) — Stage 5 review */}
              <div className="grid grid-cols-2 gap-space-3 md:grid-cols-3 lg:grid-cols-6">
                {QUICK_ACTIONS.map((item) => (
                  <div
                    key={item.id}
                    className={`animate-pulse rounded-md bg-surface-2 lg:h-[115px] ${
                      item.id === 'open-workspace' ? 'h-[115px] md:h-[90px]' : 'h-[90px]'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  } else if (fullError) {
    body = (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-space-3 rounded-md border border-neg/35 bg-neg/10 p-space-4 text-neg">
        <span>โหลดข้อมูลภาพรวมไม่สำเร็จ</span>
        <button
          type="button"
          className={`min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-semibold text-primary ${FOCUS_RING}`}
          onClick={refreshData}
        >
          ลองอีกครั้ง
        </button>
      </div>
    );
  } else if (isTrulyEmpty) {
    // ไม่ห่อข้อความว่างด้วย CARD อีกต่อไป — เดิมซ้อน renderQuickActions()'s section (การ์ดของมันเอง) ไว้
    // ข้างในการ์ดอีกใบ ผิดกติกา C1 "never nest a card inside a card" (Stage 4 finding) ข้อความว่างจึงเป็น
    // เนื้อหาเปล่า ๆ ไม่มี surface/border/shadow ของตัวเอง แล้วปล่อยให้ renderQuickActions() เป็นการ์ดใบเดียว
    body = (
      <div className="flex flex-col gap-space-4">
        <div className="flex flex-col items-center gap-space-3 py-space-7 text-center md:py-space-8">
          <Icons.BarChart size={40} color="var(--accent)" />
          <h2 className="text-xl font-semibold text-primary">ยังไม่มีข้อมูลของเดือนนี้</h2>
          <p className="text-secondary">เริ่มจากบันทึกรายรับของเดือนนี้ แล้วภาพรวมจะคำนวณให้อัตโนมัติ</p>
        </div>
        {renderQuickActions({ includeCalendarAction: false })}
      </div>
    );
  } else {
    body = (
      <>
        {partialErrorFields.length > 0 && !noticeDismissed && (
          <div role="alert" className="mb-space-4 flex flex-wrap items-center justify-between gap-space-3 rounded-md border border-neg bg-neg/10 p-space-4 text-primary">
            <span>{`โหลดข้อมูลบางส่วนไม่สำเร็จ: ${partialErrorFields.join(', ')}`}</span>
            <div className="flex items-center gap-space-2">
              <button
                type="button"
                className={`min-h-11 rounded-full border border-neg bg-transparent px-space-4 font-semibold text-primary ${FOCUS_RING}`}
                onClick={refreshData}
              >
                ลองอีกครั้ง
              </button>
              <button
                type="button"
                className={`min-h-11 min-w-11 rounded-full border-none bg-transparent text-secondary ${FOCUS_RING}`}
                onClick={() => setNoticeDismissed(true)}
                aria-label="ปิดข้อความแจ้งเตือน"
              >
                <Icons.X size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ลำดับ DOM จริง (ไม่ใช่แค่ผังภาพ) ตาม UX_SPEC §6.3: ครบกำหนด (J1) → วงแหวน → สุขภาพงบประมาณ →
            ปฏิทิน → ทางลัด — จัดผัง 2 คอลัมน์ด้วย CSS grid เฉพาะที่ lg (§6.4) เท่านั้น (Finding 4) */}
        <div className="flex flex-col gap-space-4 lg:grid lg:grid-cols-12 lg:items-start lg:gap-space-5">
          <div className={`${GRID_ITEM} lg:col-start-1 lg:col-span-5 lg:row-start-1`}>
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

          {isCarryoverOnly ? (
            <div className={`${GRID_ITEM} lg:col-start-1 lg:col-span-5 lg:row-start-2`}>
              <div className="rounded-md border border-dashed border-border-default bg-surface-1 p-space-4 text-center text-secondary">
                ยังไม่มีข้อมูลรายรับ/รายจ่ายอื่นสำหรับเดือนนี้
              </div>
            </div>
          ) : (
            <>
              <div className={`${GRID_ITEM} lg:col-start-1 lg:col-span-5 lg:row-start-2`}>
                <CashFlowRing model={model} selected={ringFilter} onSelect={setRingFilter} monthLabel={monthLabel} />
              </div>
              <div className={`${GRID_ITEM} lg:col-start-1 lg:col-span-5 lg:row-start-3`}>
                <BudgetHealthPanel
                  model={model}
                  thresholds={budgetThresholds}
                  onConfirmTransfer={handleConfirmTransfer}
                  isConfirmingTransfer={isConfirmingTransfer}
                />
              </div>
            </>
          )}

          <div className={`${GRID_ITEM} lg:col-start-6 lg:col-span-7 lg:row-start-1 lg:row-span-3`}>
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

          <div className={`${GRID_ITEM} lg:col-start-1 lg:col-span-12 lg:row-start-4`}>
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
