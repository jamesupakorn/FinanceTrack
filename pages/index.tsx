/**
 * หน้า: / (ภาพรวม) — dashboard
 * ตัวเลขมาจาก getMonthlySummaryModel(), เหตุการณ์จาก expenseEvents และการทำรายการบัตรมีเจ้าของเดียวที่หน้านี้
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
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
import { buildMonthEvents, collectPaidCardPayments, collectUpcomingPayments } from '../src/shared/utils/frontend/expenseEvents';
import { formatMonthLabelTH } from '../src/shared/utils/frontend/monthUtils';
import { getCurrentMonthKey, addMonths, PLAN_STATUS } from '../src/shared/utils/creditCardUtils';
import calStyles from '../src/frontend/styles/ExpenseCalendar.module.css';

type MonthlyModel = ReturnType<typeof getMonthlySummaryModel>;
type MonthlySummaryInput = NonNullable<Parameters<typeof getMonthlySummaryModel>[0]>;
type TaxData = NonNullable<MonthlySummaryInput['taxData']>;
type CalendarData = ReturnType<typeof buildMonthEvents>;
type CalendarEvent = CalendarData['unscheduledEvents'][number];
type UpcomingData = ReturnType<typeof collectUpcomingPayments>;
type UpcomingEvent = UpcomingData['overdue'][number];
type DashboardCard = NonNullable<Parameters<typeof buildMonthEvents>[0]['cards']>[number];
type DashboardPlan = NonNullable<Parameters<typeof buildMonthEvents>[0]['plans']>[number];
type RingFilter = 'generalExpense' | 'dailyExpense' | 'savings' | 'creditCard';
type MinimumPreview = { remaining: number; interest: number; closingBalance: number };

interface DashboardFetchResult {
  incomeData: Record<string, unknown>;
  expenseData: Record<string, unknown>;
  savingsData: Record<string, unknown>;
  salaryData: Record<string, unknown>;
  dailyExpenseData: Record<string, unknown> & { totalMonthly?: number };
  taxData: TaxData;
  monthsMap: Record<string, unknown>;
  cards: DashboardCard[];
  plans: DashboardPlan[];
  failedFields: string[];
  allFailed: boolean;
}

interface ConfirmState {
  event: CalendarEvent;
  minPaymentDue: number;
  preview: MinimumPreview;
}

interface QuickActionBase {
  id: string;
  label: string;
  Icon: ComponentType<{ size?: number }>;
  primary?: boolean;
}

type QuickAction = (QuickActionBase & { href: string; action?: never })
  | (QuickActionBase & { action: 'scroll-calendar'; href?: never });

const SELECTED_MONTH_KEY = 'edit_selected_month';
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const CARD = 'rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 md:p-space-5';
const GRID_ITEM = 'min-w-0';

const QUICK_ACTIONS: QuickAction[] = [
  { id: 'add-income', label: 'เพิ่มรายรับ', Icon: Icons.TrendingUp, href: '/workspace/income', primary: true },
  { id: 'add-expense', label: 'เพิ่มรายจ่าย', Icon: Icons.TrendingDown, href: '/workspace/expense' },
  { id: 'open-workspace', label: 'เปิดแผนการเงินรายเดือน', Icon: Icons.Edit, href: '/workspace/income' },
  { id: 'view-credit-cards', label: 'ดูบัตรเครดิต', Icon: Icons.CreditCard, href: '/credit-cards' },
  { id: 'open-calendar', label: 'เปิดปฏิทิน', Icon: Icons.Calendar, action: 'scroll-calendar' },
  { id: 'salary-calculator', label: 'คำนวณเงินเดือน', Icon: Icons.DollarSign, href: '/workspace/income?salary=open' }
];

const MONTH_RE = /^\d{4}-\d{2}$/;

export default function DashboardPage() {
  const router = useRouter();
  const { currentUser } = useSession();

  const selectedMonthKey = useMemo(
    () => (currentUser ? `${SELECTED_MONTH_KEY}_${currentUser.id}` : SELECTED_MONTH_KEY),
    [currentUser?.id]
  );

  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [budgetThresholds, setBudgetThresholds] = useState(DEFAULT_BUDGET_THRESHOLDS);
  const [incomeData, setIncomeData] = useState<Record<string, unknown>>({});
  const [expenseData, setExpenseData] = useState<Record<string, unknown>>({});
  const [savingsData, setSavingsData] = useState<Record<string, unknown>>({});
  const [salaryData, setSalaryData] = useState<Record<string, unknown>>({});
  const [dailyExpenseData, setDailyExpenseData] = useState<Record<string, unknown> & { totalMonthly?: number }>({ totalMonthly: 0 });
  const [taxData, setTaxData] = useState<TaxData>({});
  const [monthsMap, setMonthsMap] = useState<Record<string, unknown>>({});
  const [cards, setCards] = useState<DashboardCard[]>([]);
  const [plans, setPlans] = useState<DashboardPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [fullError, setFullError] = useState(false);
  const [partialErrorFields, setPartialErrorFields] = useState<string[]>([]);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const hasLoadedRef = useRef(false);
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const pendingKeysRef = useRef<Set<string>>(new Set());
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const confirmDialogRef = useRef<HTMLDivElement | null>(null);
  const [ringFilter, setRingFilter] = useState<RingFilter | null>(null);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [isConfirmingTransfer, setIsConfirmingTransfer] = useState(false);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const calendarHeadingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (!confirmState || typeof document === 'undefined') return undefined;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, [confirmState]);

  useEffect(() => {
    if (!confirmState) return undefined;
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !confirmDialogRef.current) return;
      const focusable = Array.from(confirmDialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]'
      )).filter(element => element.tabIndex >= 0 && (element.offsetParent !== null || element.getClientRects().length > 0));
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

  useEffect(() => {
    if (!currentUser) return;
    const stored = typeof window !== 'undefined' ? localStorage.getItem(selectedMonthKey) : null;
    const currentMonth = getCurrentMonthKey();
    const initial = stored && MONTH_RE.test(stored) && stored <= currentMonth ? stored : currentMonth;
    setSelectedMonth(initial);
    if (typeof window !== 'undefined') localStorage.setItem(selectedMonthKey, initial);
    hasLoadedRef.current = false;
  }, [currentUser?.id, selectedMonthKey]);

  useEffect(() => {
    if (!currentUser || !selectedMonth || typeof window === 'undefined') return;
    localStorage.setItem(selectedMonthKey, selectedMonth);
  }, [currentUser, selectedMonth, selectedMonthKey]);

  useEffect(() => { setIsConfirmingTransfer(false); }, [selectedMonth]);

  useEffect(() => {
    if (!currentUser) return undefined;
    let cancelled = false;
    userSettingsAPI.get()
      .then(data => {
        if (!cancelled) setBudgetThresholds(data?.budgetThresholds || DEFAULT_BUDGET_THRESHOLDS);
      })
      .catch(() => {
        if (!cancelled) setBudgetThresholds(DEFAULT_BUDGET_THRESHOLDS);
      });
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser?.id || typeof window === 'undefined') return;
    const signalKey = `budgetThresholds_justUpdated_${currentUser.id}`;
    if (localStorage.getItem(signalKey)) {
      showToast('อัปเดตจากการเปลี่ยนเกณฑ์งบประมาณ', 'info');
      localStorage.removeItem(signalKey);
    }
  }, [currentUser?.id]);

  const fetchAll = useCallback(async (monthKey: string): Promise<DashboardFetchResult> => {
    const year = monthKey.split('-')[0];
    const results = await Promise.allSettled([
      incomeAPI.getByMonth(monthKey), expenseAPI.getByMonth(monthKey), savingsAPI.getByMonth(monthKey),
      salaryAPI.getByMonth(monthKey), dailyExpenseAPI.getByMonth(monthKey), taxAPI.getByYear(year),
      expenseAPI.getAll(), creditCardAPI.getCards(), creditCardAPI.getPlans()
    ]);
    const [incomeR, expenseR, savingsR, salaryR, dailyR, taxR, allExpenseR, cardsR, plansR] = results;
    const failedFields: string[] = [];
    const pick = <T,>(result: PromiseSettledResult<T>, fallback: T, label: string): T => {
      if (result.status === 'fulfilled') return result.value;
      failedFields.push(label);
      return fallback;
    };
    const allExpense = pick(allExpenseR, { months: {} }, 'ปฏิทิน/รายการครบกำหนด');
    const cardsResponse = pick(cardsR, { cards: [] }, 'บัตรเครดิต');
    const plansResponse = pick(plansR, { plans: [] }, 'แผนผ่อนชำระ');
    const monthsValue = allExpense?.months;
    return {
      incomeData: pick(incomeR, {}, 'รายรับ') as Record<string, unknown>,
      expenseData: pick(expenseR, {}, 'รายจ่ายทั่วไป/บัตรเครดิต') as Record<string, unknown>,
      savingsData: pick(savingsR, {}, 'เงินออม') as Record<string, unknown>,
      salaryData: pick(salaryR, {}, 'เงินเดือน') as Record<string, unknown>,
      dailyExpenseData: pick(dailyR, { totalMonthly: 0 }, 'รายจ่ายประจำวัน') as Record<string, unknown> & { totalMonthly?: number },
      taxData: pick(taxR, {}, 'ภาษี') as TaxData,
      monthsMap: monthsValue && typeof monthsValue === 'object' ? monthsValue as Record<string, unknown> : {},
      cards: Array.isArray(cardsResponse?.cards) ? cardsResponse.cards as DashboardCard[] : [],
      plans: Array.isArray(plansResponse?.plans) ? plansResponse.plans as DashboardPlan[] : [],
      failedFields,
      allFailed: results.every(result => result.status === 'rejected')
    };
  }, []);

  const applyFetchResult = useCallback((data: DashboardFetchResult) => {
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
    if (!hasLoadedRef.current) setLoading(true);
    void fetchAll(selectedMonth).then(data => {
      if (cancelled) return;
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

  const model: MonthlyModel = useMemo(() => getMonthlySummaryModel({
    month: selectedMonth as string | undefined,
    incomeData,
    expenseData,
    savingsData,
    dailyExpenseData,
    salaryData,
    taxData,
    thresholds: budgetThresholds
  }), [selectedMonth, incomeData, expenseData, savingsData, dailyExpenseData, salaryData, taxData, budgetThresholds]);

  const calendarData: CalendarData = useMemo(
    () => buildMonthEvents({ monthKey: selectedMonth as string, monthsMap, cards, plans }),
    [selectedMonth, monthsMap, cards, plans]
  );
  const paidCardEvents = useMemo(
    () => collectPaidCardPayments(calendarData.eventsByDay, selectedMonth as string),
    [calendarData, selectedMonth]
  );
  const upcoming: UpcomingData = useMemo(() => collectUpcomingPayments({ monthsMap, cards, plans, horizonDays: 7 }), [monthsMap, cards, plans]);

  const hasAnyDocumentThisMonth = model.totalIncome > 0 || model.generalExpense > 0 || model.creditCard > 0 || model.savings > 0 || model.taxAccumulated > 0;
  const isTrulyEmpty = !hasAnyDocumentThisMonth && model.dailyExpense === 0;
  const isCarryoverOnly = !hasAnyDocumentThisMonth && model.dailyExpense > 0;

  const handleNavigateMonth = useCallback((delta: number) => {
    setSelectedMonth(previous => addMonths(previous as string, delta));
  }, []);

  const handleConfirmTransfer = useCallback(async () => {
    if (!selectedMonth || model.transferableSavings <= 0 || isConfirmingTransfer) return;
    setIsConfirmingTransfer(true);
    try {
      const result = await savingsAPI.confirmTransfer(selectedMonth, model.transferableSavings, model.savings + model.transferableSavings);
      showToast(result?.created === false ? 'เงินออมรายการนี้ถูกเพิ่มไว้แล้ว' : 'เพิ่มเงินเหลือเข้าเงินออมแล้ว');
      await refreshData();
    } catch (error) {
      showToast((error as { message?: string } | null)?.message || 'เพิ่มเงินออมไม่สำเร็จ', 'error');
    } finally {
      setIsConfirmingTransfer(false);
    }
  }, [selectedMonth, model.transferableSavings, model.savings, isConfirmingTransfer, refreshData]);

  const scrollToCalendar = useCallback(() => {
    const element = calendarHeadingRef.current;
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    element.focus({ preventScroll: true });
  }, []);

  const setBusy = (key: string, busy: boolean) => {
    setPendingKeys(keys => busy ? [...keys, key] : keys.filter(item => item !== key));
  };

  const setInstallmentPaidLocal = useCallback((planId: string, installmentNo: number | string, paid: boolean) => {
    setPlans(current => current.map(plan => {
      if (plan.id !== planId || !Array.isArray(plan.schedule)) return plan;
      return { ...plan, schedule: plan.schedule.map(row => (String(row.no) === String(installmentNo) ? { ...row, paid } : row)) };
    }));
  }, []);

  const handleToggleInstallment = useCallback(async (event: CalendarEvent) => {
    if (!event.plan || pendingKeysRef.current.has(event.key)) return;
    const nextPaid = !event.paid;
    const planId = event.plan.id;
    const installmentNo = event.installmentNo as number | string;
    pendingKeysRef.current.add(event.key);
    setBusy(event.key, true);
    setInstallmentPaidLocal(planId, installmentNo, nextPaid);
    try {
      const response = await creditCardAPI.setInstallmentPaid(planId, installmentNo, nextPaid);
      showToast(response?.plan?.status === PLAN_STATUS.COMPLETED ? 'ผ่อนครบแล้ว 🎉' : 'อัปเดตสถานะงวดแล้ว');
      await refreshData();
    } catch (error) {
      setInstallmentPaidLocal(planId, installmentNo, !nextPaid);
      showToast((error as { message?: string } | null)?.message || 'อัปเดตสถานะงวดไม่สำเร็จ', 'error');
    } finally {
      pendingKeysRef.current.delete(event.key);
      setBusy(event.key, false);
    }
  }, [refreshData, setInstallmentPaidLocal]);

  const handleRevolvingFull = useCallback(async (event: CalendarEvent) => {
    if (!event.card || !selectedMonth) return;
    setBusy(event.key, true);
    try {
      await creditCardAPI.setRevolvingAction(event.card.id, event.cycleMonth ?? selectedMonth, 'full');
      showToast('บันทึกการชำระแล้ว');
      await refreshData();
    } catch (error) {
      showToast((error as { message?: string } | null)?.message || 'บันทึกไม่สำเร็จ', 'error');
    } finally {
      setBusy(event.key, false);
    }
  }, [selectedMonth, refreshData]);

  const handleRevolvingCancel = useCallback(async (event: CalendarEvent) => {
    if (!event.card || !selectedMonth) return;
    setBusy(event.key, true);
    try {
      await creditCardAPI.setRevolvingAction(event.card.id, event.cycleMonth ?? selectedMonth, null);
      showToast('ยกเลิกการชำระแล้ว');
      await refreshData();
    } catch (error) {
      showToast((error as { message?: string } | null)?.message || 'ยกเลิกการชำระไม่สำเร็จ', 'error');
    } finally {
      setBusy(event.key, false);
    }
  }, [selectedMonth, refreshData]);

  const handleRevolvingMinimumClick = useCallback(async (event: CalendarEvent) => {
    if (!event.card || !selectedMonth) return;
    // รอบบิลของ event (วันครบกำหนดข้ามเดือน / รายการเดือนถัดไปใน upcoming) — ไม่ใช่ selectedMonth เสมอไป (RR-1)
    const cycleMonth = event.cycleMonth ?? selectedMonth;
    setBusy(event.key, true);
    try {
      const response = await creditCardAPI.getRevolving({ cardId: event.card.id, month: cycleMonth });
      const cycle = (response?.cycles || []).find((item: { month?: string }) => item.month === cycleMonth);
      setConfirmState({ event, minPaymentDue: cycle?.minPaymentDue ?? 0, preview: cycle?.minimumPreview || { remaining: 0, interest: 0, closingBalance: 0 } });
    } catch (error) {
      showToast((error as { message?: string } | null)?.message || 'โหลดข้อมูลยอดหมุนเวียนไม่สำเร็จ', 'error');
    } finally {
      setBusy(event.key, false);
    }
  }, [selectedMonth]);

  const handleConfirmMinimum = useCallback(async () => {
    const event = confirmState?.event;
    if (!event?.card || !selectedMonth) {
      setConfirmState(null);
      return;
    }
    setConfirmBusy(true);
    try {
      await creditCardAPI.setRevolvingAction(event.card.id, event.cycleMonth ?? selectedMonth, 'minimum');
      showToast('บันทึกการชำระขั้นต่ำแล้ว');
      setConfirmState(null);
      await refreshData();
    } catch (error) {
      showToast((error as { message?: string } | null)?.message || 'บันทึกไม่สำเร็จ', 'error');
    } finally {
      setConfirmBusy(false);
    }
  }, [confirmState, selectedMonth, refreshData]);

  const handleSelectUpcomingItem = useCallback((key: string) => {
    setRingFilter(null);
    setHighlightedKey(key);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setTimeout(() => document.getElementById(`upcoming-item-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    highlightTimerRef.current = setTimeout(() => setHighlightedKey(null), 4000);
  }, []);

  useEffect(() => () => { if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current); }, []);

  const monthLabel = selectedMonth ? formatMonthLabelTH(selectedMonth) : '';
  const headerControls = (
    <div className="flex w-full flex-wrap items-center justify-between gap-space-3 md:w-auto md:justify-start">
      <div className="flex items-center gap-space-2">
        <button type="button" className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-border-default bg-surface-2 text-primary ${FOCUS_RING}`} onClick={() => handleNavigateMonth(-1)} aria-label="เดือนก่อนหน้า"><Icons.ChevronLeft size={18} /></button>
        <span className="min-w-[96px] text-center text-sm font-bold text-primary md:min-w-[120px] md:text-base">{monthLabel}</span>
        <button type="button" className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-border-default bg-surface-2 text-primary ${FOCUS_RING}`} onClick={() => handleNavigateMonth(1)} aria-label="เดือนถัดไป"><Icons.ChevronRight size={18} /></button>
      </div>
      <NotificationBell upcoming={upcoming} onSelectItem={handleSelectUpcomingItem} />
      <a href="/settings" className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-border-default bg-surface-2 text-primary no-underline ${FOCUS_RING}`} aria-label="ตั้งค่า"><Icons.Settings size={18} /></a>
    </div>
  );

  const renderQuickActions = ({ includeCalendarAction = true }: { includeCalendarAction?: boolean } = {}) => (
    <section className={CARD} aria-label="ทางลัด">
      <h2 className="mb-space-4 text-xl font-semibold text-primary">ทางลัด</h2>
      <div className="grid grid-cols-2 gap-space-3 md:grid-cols-3 lg:grid-cols-6">
        {QUICK_ACTIONS.filter(item => includeCalendarAction || item.action !== 'scroll-calendar').map(item => (
          <button key={item.id} type="button" className={`flex min-h-11 flex-col items-start gap-space-2 rounded-md border p-space-4 text-left font-semibold transition-transform duration-base hover:-translate-y-0.5 ${FOCUS_RING} ${item.primary ? 'border-transparent bg-accent text-on-accent' : 'border-border-default bg-surface-2 text-primary hover:bg-accent-muted'}`} onClick={() => { if (item.action === 'scroll-calendar') scrollToCalendar(); else void router.push(item.href); }}>
            <item.Icon size={22} /><span>{item.label}</span>
          </button>
        ))}
      </div>
    </section>
  );

  let body: ReactNode;
  if (loading) {
    body = (
      <div role="status" aria-busy="true">
        <span className="sr-only">กำลังโหลดภาพรวม...</span>
        <div className="flex flex-col gap-space-4 lg:grid lg:grid-cols-12 lg:items-start lg:gap-space-5">
          <div className={`${GRID_ITEM} flex flex-col gap-space-4 lg:col-span-5 lg:gap-space-5`}>
            <div className={CARD}><div className="mb-space-4 h-6 w-2/3 animate-pulse rounded-sm bg-surface-2" /><div className="flex flex-col gap-space-3">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-[88px] animate-pulse rounded-md bg-surface-2" />)}</div></div>
            <div className={CARD}><div className="mb-space-4 h-[31px] w-2/3 animate-pulse rounded-sm bg-surface-2" /><div className="mx-auto mb-space-4 h-[220px] w-[220px] animate-pulse rounded-full bg-surface-2" /><div className="flex flex-col gap-space-1">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-[79px] animate-pulse rounded-sm bg-surface-2 md:h-11" />)}</div></div>
          </div>
          <div className={`${GRID_ITEM} flex flex-col gap-space-4 lg:col-span-7 lg:gap-space-5`}>
            <div className={CARD}><div className="h-11 animate-pulse rounded-sm bg-surface-2 lg:hidden" /><div className="hidden lg:block"><div className="mb-space-4 h-[31px] w-1/3 animate-pulse rounded-sm bg-surface-2" /><div className={calStyles.calendarWrap}><div className={calStyles.calendarNav}><div className="h-11 w-11 animate-pulse rounded-md bg-surface-2" /><div className="h-6 w-[140px] animate-pulse rounded-sm bg-surface-2" /><div className="h-11 w-11 animate-pulse rounded-md bg-surface-2" /></div><div className={calStyles.calendarLayout}><div><div className="grid grid-cols-7 gap-[2px]">{Array.from({ length: 42 }).map((_, index) => <div key={index} className="h-[48px] animate-pulse rounded-sm bg-surface-2" />)}</div><div className={calStyles.calendarLegend}><div className="h-5 w-[220px] animate-pulse rounded-sm bg-surface-2" /></div><div className={calStyles.calendarFooter}><div className="h-6 w-[160px] animate-pulse rounded-sm bg-surface-2" /><div className="mt-1 h-5 w-[200px] animate-pulse rounded-sm bg-surface-2" /></div></div></div></div></div></div>
            <div className={CARD}><div className="h-11 animate-pulse rounded-sm bg-surface-2" /><div className="h-[121px] animate-pulse rounded-md bg-surface-2 md:h-[66px]" /></div>
          </div>
          <div className={`${GRID_ITEM} lg:col-span-12`}><div className={CARD}><div className="mb-space-4 h-[31px] w-1/3 animate-pulse rounded-sm bg-surface-2" /><div className="grid grid-cols-2 gap-space-3 md:grid-cols-3 lg:grid-cols-6">{QUICK_ACTIONS.map(item => <div key={item.id} className={`animate-pulse rounded-md bg-surface-2 lg:h-[115px] ${item.id === 'open-workspace' ? 'h-[115px] md:h-[90px]' : 'h-[90px]'}`} />)}</div></div></div>
        </div>
      </div>
    );
  } else if (fullError) {
    body = <div role="alert" className="flex flex-wrap items-center justify-between gap-space-3 rounded-md border border-neg/35 bg-neg/10 p-space-4 text-neg"><span>โหลดข้อมูลภาพรวมไม่สำเร็จ</span><button type="button" className={`min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-semibold text-primary ${FOCUS_RING}`} onClick={() => void refreshData()}>ลองอีกครั้ง</button></div>;
  } else if (isTrulyEmpty) {
    body = <div className="flex flex-col gap-space-4"><div className="flex flex-col items-center gap-space-3 py-space-7 text-center md:py-space-8"><Icons.BarChart size={40} color="var(--accent)" /><h2 className="text-xl font-semibold text-primary">ยังไม่มีข้อมูลของเดือนนี้</h2><p className="text-secondary">เริ่มจากบันทึกรายรับของเดือนนี้ แล้วภาพรวมจะคำนวณให้อัตโนมัติ</p></div>{renderQuickActions({ includeCalendarAction: false })}</div>;
  } else {
    body = <>
      {partialErrorFields.length > 0 && !noticeDismissed && <div role="alert" className="mb-space-4 flex flex-wrap items-center justify-between gap-space-3 rounded-md border border-neg bg-neg/10 p-space-4 text-primary"><span>{`โหลดข้อมูลบางส่วนไม่สำเร็จ: ${partialErrorFields.join(', ')}`}</span><div className="flex items-center gap-space-2"><button type="button" className={`min-h-11 rounded-full border border-neg bg-transparent px-space-4 font-semibold text-primary ${FOCUS_RING}`} onClick={() => void refreshData()}>ลองอีกครั้ง</button><button type="button" className={`min-h-11 min-w-11 rounded-full border-none bg-transparent text-secondary ${FOCUS_RING}`} onClick={() => setNoticeDismissed(true)} aria-label="ปิดข้อความแจ้งเตือน"><Icons.X size={16} /></button></div></div>}
      <div className="flex flex-col gap-space-4 lg:grid lg:grid-cols-12 lg:items-start lg:gap-space-5">
        <div className={`${GRID_ITEM} flex flex-col gap-space-4 lg:col-span-5 lg:gap-space-5`}>
          <UpcomingPayments upcoming={upcoming} filter={ringFilter} onClearFilter={() => setRingFilter(null)} onViewCalendar={scrollToCalendar} pendingKeys={pendingKeys} onToggleInstallment={handleToggleInstallment} onRevolvingFull={handleRevolvingFull} onRevolvingMinimum={handleRevolvingMinimumClick} highlightedKey={highlightedKey} paidEvents={paidCardEvents} onRevolvingCancel={handleRevolvingCancel} />
          {isCarryoverOnly ? <div className="rounded-md border border-dashed border-border-default bg-surface-1 p-space-4 text-center text-secondary">ยังไม่มีข้อมูลรายรับ/รายจ่ายอื่นสำหรับเดือนนี้</div> : <CashFlowRing model={model} selected={ringFilter} onSelect={setRingFilter} monthLabel={monthLabel} />}
        </div>
        <div className={`${GRID_ITEM} flex flex-col gap-space-4 lg:col-span-7 lg:gap-space-5`}>
          <DashboardCalendarSection headingRef={calendarHeadingRef} monthKey={selectedMonth as string} onNavigateMonth={handleNavigateMonth} calendarData={calendarData} cards={cards} loading={false} error={null} onRetry={refreshData} pendingKeys={pendingKeys} onToggleInstallment={handleToggleInstallment} onRevolvingFull={handleRevolvingFull} onRevolvingMinimum={handleRevolvingMinimumClick} onRevolvingCancel={handleRevolvingCancel} />
          {!isCarryoverOnly && <BudgetHealthPanel model={model} thresholds={budgetThresholds} onConfirmTransfer={handleConfirmTransfer} isConfirmingTransfer={isConfirmingTransfer} />}
        </div>
        <div className={`${GRID_ITEM} lg:col-span-12`}>{renderQuickActions()}</div>
      </div>
    </>;
  }

  return (
    <Layout activeNav="dashboard" title="ภาพรวม" headerActions={headerControls} onCalendarNavClick={scrollToCalendar}>
      {body}
      <RevolvingConfirmDialog open={Boolean(confirmState)} dialogRef={confirmDialogRef} restoreFocusRef={calendarHeadingRef as unknown as { current: HTMLButtonElement | null }} cardName={confirmState?.event.card?.name} minPaymentDue={confirmState?.minPaymentDue} preview={confirmState?.preview} busy={confirmBusy} onCancel={() => setConfirmState(null)} onConfirm={handleConfirmMinimum} />
    </Layout>
  );
}