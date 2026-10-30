/**
 * คอมโพเนนต์: WorkspaceShell
 * เชลล์ของ /workspace/* ทั้งเจ็ดเส้นทาง — resolve เดือนจาก URL/localStorage, dirty delegation,
 * Save FAB, UnsavedChangesDialog, beforePopState guard และ beforeunload
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useRouter, type NextRouter } from 'next/router';
import Link from 'next/link';
import Layout from './Layout';
import MonthManager from './MonthManager';
import UnsavedChangesDialog from './UnsavedChangesDialog';
import { Icons } from './Icons';
import { useSession } from '../contexts/SessionContext';
import { incomeAPI, expenseAPI, savingsAPI, salaryAPI, investmentAPI } from '../../shared/utils/frontend/apiUtils';
import { formatMonthLabelTH, collectMonthKeys, getMeaningfulMonthKeys } from '../../shared/utils/frontend/monthUtils';
import { getNextMonth } from '../../shared/utils/frontend/numberUtils';
import { WORKSPACE_SECTIONS, sectionHref } from '../../shared/utils/frontend/workspaceRoutes';
import { isListViewControl } from '../../shared/utils/frontend/listView';

interface WorkspacePayload {
  selectedMonth: string | null;
  months: string[];
  refreshTrigger: number;
  isDirty: boolean;
  markClean: () => void;
  markDirty: () => void;
  guard: (action: () => void, message: string) => void;
  registerSave: (save: (() => void | Promise<unknown>) | null) => void;
  router: NextRouter;
}

interface WorkspaceShellProps {
  section: string;
  overlay?: ReactNode | ((payload: WorkspacePayload) => ReactNode);
  children?: ReactNode | ((payload: WorkspacePayload) => ReactNode);
}

interface DialogState {
  message: string;
  onLeave: () => void;
}

interface SectionHeadingMeta {
  Icon: typeof Icons.TrendingUp;
  color: string;
}

const SELECTED_MONTH_KEY = 'edit_selected_month';
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const FOCUS_RING_ON_ACCENT = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2';

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const getMonthLabel = (monthKey: string): string => {
  try {
    return formatMonthLabelTH(monthKey);
  } catch {
    return monthKey;
  }
};

const PRIMARY_NAV = [
  { id: 'income', label: 'รายรับ', Icon: Icons.TrendingUp },
  { id: 'expense', label: 'บิล', Icon: Icons.CreditCard },
  { id: 'savings', label: 'เงินออม', Icon: Icons.PiggyBank },
  { id: 'daily', label: 'รายวัน', Icon: Icons.CreditCard },
  { id: 'tax', label: 'ภาษี', Icon: Icons.BarChart }
];
const SAVINGS_GROUP = ['savings', 'goals', 'investment'];
const SUB_NAV = [
  { id: 'savings', label: 'ภาพรวม' },
  { id: 'goals', label: 'เป้าหมาย' },
  { id: 'investment', label: 'ลงทุน' }
];

const SECTION_HEADING_META: Record<string, SectionHeadingMeta> = {
  income: { Icon: Icons.TrendingUp, color: 'var(--accent)' },
  expense: { Icon: Icons.CreditCard, color: 'var(--neg)' },
  savings: { Icon: Icons.PiggyBank, color: 'var(--info)' },
  goals: { Icon: Icons.Target, color: 'var(--info)' },
  investment: { Icon: Icons.TrendingUp, color: 'var(--info)' },
  daily: { Icon: Icons.CreditCard, color: 'var(--accent)' },
  tax: { Icon: Icons.BarChart, color: 'var(--warn)' }
};

const monthsCache = new Map<string, string[]>();
let hasHydratedOnce = false;

const buildLeaveCopy = (heading: string, monthLabel: string) => (
  `ข้อมูลใน "${heading}" ของเดือน ${monthLabel} ยังไม่ได้บันทึก ถ้าออกตอนนี้ข้อมูลที่แก้ไว้จะหายไป`
);
const buildMonthChangeCopy = (heading: string, monthLabel: string) => (
  `ข้อมูลใน "${heading}" ของเดือน ${monthLabel} ยังไม่ได้บันทึก ถ้าเปลี่ยนเดือนตอนนี้ข้อมูลที่แก้ไว้จะหายไป`
);

// เดือนที่ผู้ใช้เลือก/สร้างใน page session นี้ แยกตาม userId — อยู่ระดับ module เพื่อคงอยู่ข้ามการสลับ /workspace/* (แต่ละหน้า mount WorkspaceShell ใหม่)
// หายเมื่อ reload เต็มหน้า และไม่ปนข้ามผู้ใช้ — ห้ามส่งเข้า monthsCache
const sessionCreatedMonths = new Map<string, Set<string>>();

const getSessionMonths = (userId: string | null): Set<string> => {
  if (!userId) return new Set();
  let set = sessionCreatedMonths.get(userId);
  if (!set) {
    set = new Set();
    sessionCreatedMonths.set(userId, set);
  }
  return set;
};

const withSessionMonths = (list: string[], sessionMonths: Set<string>): string[] => {
  // merge เฉพาะเดือน > เดือนถัดไป (เดือนเดียวที่ BR-b ซ่อน) — เดือนที่ server ลบทิ้งแล้วต้องไม่โผล่กลับมา
  const nextMonth = getNextMonth(getCurrentMonth());
  const extra = Array.from(sessionMonths).filter(month => month > nextMonth && !list.includes(month));
  return extra.length ? [...list, ...extra].sort((a, b) => b.localeCompare(a)) : list;
};

export default function WorkspaceShell({ section, overlay, children }: WorkspaceShellProps) {
  const router = useRouter();
  const routerRef = useRef(router);
  const pendingMonthRef = useRef<string | null>(null);
  routerRef.current = router;
  const { currentUser } = useSession();
  const userId = currentUser?.id || null;
  const selectedMonthKey = useMemo(
    () => (userId ? `${SELECTED_MONTH_KEY}_${userId}` : SELECTED_MONTH_KEY),
    [userId]
  );

  const sectionMeta = WORKSPACE_SECTIONS[section] || WORKSPACE_SECTIONS.income;
  const headingMeta = SECTION_HEADING_META[section] || SECTION_HEADING_META.income;

  const isFirstHydrationRef = useRef(!hasHydratedOnce);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    if (isFirstHydrationRef.current) return null;
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get('month');
      if (fromUrl && MONTH_RE.test(fromUrl)) return fromUrl;
      const stored = userId ? localStorage.getItem(`${SELECTED_MONTH_KEY}_${userId}`) : null;
      if (stored && MONTH_RE.test(stored)) return stored;
    } catch {
      // localStorage can be unavailable in private browsing.
    }
    return null;
  });

  useEffect(() => {
    if (!isFirstHydrationRef.current) return;
    hasHydratedOnce = true;
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get('month');
      if (fromUrl && MONTH_RE.test(fromUrl)) {
        setSelectedMonth(fromUrl);
        return;
      }
      const stored = userId ? localStorage.getItem(`${SELECTED_MONTH_KEY}_${userId}`) : null;
      if (stored && MONTH_RE.test(stored)) setSelectedMonth(stored);
    } catch {
      // Month resolution below falls back to the current month.
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [months, setMonths] = useState<string[]>(() => (userId && monthsCache.has(userId) ? withSessionMonths(monthsCache.get(userId) || [], getSessionMonths(userId)) : []));
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [dialogState, setDialogState] = useState<DialogState | null>(null);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);

  const isDirtyRef = useRef(false);
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);

  const saveRef = useRef<(() => void | Promise<unknown>) | null>(null);
  const registerSave = useCallback((fn: (() => void | Promise<unknown>) | null) => { saveRef.current = fn; }, []);

  const fetchMonths = useCallback(async () => {
    try {
      const [expenseRes, incomeRes, savingsRes, salaryRes, investmentRes] = await Promise.all([
        expenseAPI.getAll(),
        incomeAPI.getAll(),
        savingsAPI.getAll(),
        salaryAPI.getAll(),
        investmentAPI.getAll()
      ]);
      const responses = { expense: expenseRes, income: incomeRes, savings: savingsRes, salary: salaryRes, investment: investmentRes };
      const allMonths = collectMonthKeys(responses);
      const meaningful = getMeaningfulMonthKeys(responses);
      const currentMonth = getCurrentMonth();
      const nextMonth = getNextMonth(currentMonth);
      // เดือน <= เดือนถัดไปที่มีเอกสารแสดงเสมอ (เดือนว่างที่เพิ่งสร้างยังอยู่หลัง refresh); เดือนไกลกว่านั้นต้องมีข้อมูลจริง
      const normalizedMonths = Array.from(new Set([currentMonth, ...allMonths.filter(month => month <= nextMonth || meaningful.has(month))])).sort((a, b) => b.localeCompare(a));
      setMonths(withSessionMonths(normalizedMonths, getSessionMonths(userId)));
      if (userId) monthsCache.set(userId, normalizedMonths);
    } catch {
      const currentMonth = getCurrentMonth();
      setMonths(withSessionMonths([currentMonth], getSessionMonths(userId)));
      if (userId) monthsCache.set(userId, [currentMonth]);
    }
  }, [userId]);

  useEffect(() => {
    if (!currentUser) return;
    if (userId && monthsCache.has(userId)) {
      setMonths(withSessionMonths(monthsCache.get(userId) || [], getSessionMonths(userId)));
      return;
    }
    fetchMonths();
  }, [refreshTrigger, currentUser, userId, fetchMonths]);

  const applyMonthChange = useCallback((month: string) => {
    // optimistic: เดือนที่เพิ่งสร้างต้องอยู่ใน months ทันที ไม่งั้น effect resolve เดือนจะดีดกลับ — ไม่เขียนลง monthsCache
    if (userId) getSessionMonths(userId).add(month);
    setMonths(prev => (prev.includes(month) ? prev : [...prev, month].sort((a, b) => b.localeCompare(a))));
    pendingMonthRef.current = month;
    setSelectedMonth(month);
    if (typeof window !== 'undefined' && userId) {
      try { localStorage.setItem(selectedMonthKey, month); } catch { /* private mode */ }
    }
    const currentRouter = routerRef.current;
    currentRouter.replace({ pathname: currentRouter.pathname, query: { ...currentRouter.query, month } }, undefined, { shallow: true });
  }, [selectedMonthKey, userId]);

  useEffect(() => {
    if (!router.isReady || !months.length) return;
    const queryMonth = typeof router.query.month === 'string' ? router.query.month : null;
    // shallow replace ของ applyMonthChange ยังไม่สะท้อนใน router.query — อย่า resolve จาก query เก่าจนกว่าจะตรงกัน
    const pendingMonth = pendingMonthRef.current;
    if (pendingMonth && months.includes(pendingMonth) && queryMonth !== pendingMonth) return;
    pendingMonthRef.current = null;
    let resolved: string;
    if (queryMonth && MONTH_RE.test(queryMonth) && months.includes(queryMonth)) {
      resolved = queryMonth;
    } else {
      let stored: string | null = null;
      try { stored = userId ? localStorage.getItem(selectedMonthKey) : null; } catch { /* noop */ }
      resolved = stored && MONTH_RE.test(stored) && months.includes(stored) ? stored : getCurrentMonth();
    }

    if (resolved !== selectedMonth) setSelectedMonth(resolved);
    if (typeof window !== 'undefined' && userId) {
      try { localStorage.setItem(selectedMonthKey, resolved); } catch { /* noop */ }
    }
    if (queryMonth !== resolved) {
      router.replace({ pathname: router.pathname, query: { ...router.query, month: resolved } }, undefined, { shallow: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, router.isReady, router.query.month, userId, selectedMonthKey]);

  const handleDataRefresh = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
    if (userId) monthsCache.delete(userId);
  }, [userId]);

  const markClean = useCallback(() => setIsDirty(false), []);
  const markDirty = useCallback(() => setIsDirty(true), []);
  const guard = useCallback((action: () => void, message: string) => {
    if (isDirtyRef.current) setDialogState({ message, onLeave: action });
    else action();
  }, []);

  const monthLabel = selectedMonth ? getMonthLabel(selectedMonth) : '';
  const leaveCopy = buildLeaveCopy(sectionMeta.heading, monthLabel);
  const monthChangeCopy = buildMonthChangeCopy(sectionMeta.heading, monthLabel);
  const currentMonthIndex = months.indexOf(selectedMonth || '');

  const guardedMonthChange = useCallback((month: string | null | undefined) => {
    if (!month) return;
    const shouldGuard = isDirtyRef.current && month !== selectedMonth && selectedMonth != null && months.includes(selectedMonth);
    if (shouldGuard) setDialogState({ message: monthChangeCopy, onLeave: () => applyMonthChange(month) });
    else applyMonthChange(month);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, months, applyMonthChange, monthChangeCopy]);

  const handlePrevMonth = () => {
    if (currentMonthIndex < months.length - 1) guardedMonthChange(months[currentMonthIndex + 1]);
  };
  const handleNextMonth = () => {
    if (currentMonthIndex > 0) guardedMonthChange(months[currentMonthIndex - 1]);
  };

  const handleBeforeNavigate = useCallback((href: string) => {
    if (!isDirtyRef.current) return true;
    setDialogState({ message: leaveCopy, onLeave: () => { void router.push(href); } });
    return false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, leaveCopy]);

  const handleNavLinkClick = (event: MouseEvent<HTMLAnchorElement>, targetId: string, active: boolean) => {
    if (active || !isDirty) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    guard(() => { void router.push(sectionHref(targetId, selectedMonth || undefined)); }, leaveCopy);
  };

  const bypassRef = useRef(false);
  const nextStateRef = useRef<unknown>(null);
  const leaveCopyRef = useRef(leaveCopy);
  useEffect(() => { leaveCopyRef.current = leaveCopy; }, [leaveCopy]);

  useEffect(() => {
    const captureState = () => { nextStateRef.current = window.history.state; };
    captureState();
    router.events.on('routeChangeComplete', captureState);

    router.beforePopState(() => {
      if (bypassRef.current) {
        bypassRef.current = false;
        return true;
      }
      if (!isDirtyRef.current) return true;
      window.history.pushState(nextStateRef.current, '', router.asPath);
      setDialogState({
        message: leaveCopyRef.current,
        onLeave: () => {
          bypassRef.current = true;
          window.history.back();
        }
      });
      return false;
    });

    return () => {
      router.events.off('routeChangeComplete', captureState);
      router.beforePopState(() => true);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!isDirty) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await saveRef.current?.();
    } finally {
      setIsSaving(false);
    }
  };

  const headerActions = (
    <div className="flex w-full flex-wrap items-center justify-between gap-space-3 lg:w-auto lg:flex-nowrap">
      <div className="flex items-center gap-space-2">
        <button type="button" onClick={handlePrevMonth} disabled={currentMonthIndex >= months.length - 1} aria-label="เดือนก่อนหน้า" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-default bg-surface-2 text-primary disabled:opacity-30 ${FOCUS_RING}`}><Icons.ChevronLeft size={18} /></button>
        <button type="button" onClick={() => setMonthPickerOpen(true)} aria-haspopup="dialog" aria-expanded={monthPickerOpen} className={`flex h-11 items-center gap-space-2 rounded-full border border-border-default bg-surface-2 px-space-4 text-sm font-medium text-primary ${FOCUS_RING}`}><span className="whitespace-nowrap">{monthLabel || 'เลือกเดือน'}</span><Icons.ChevronDown size={14} /></button>
        <button type="button" onClick={handleNextMonth} disabled={currentMonthIndex <= 0} aria-label="เดือนถัดไป" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-default bg-surface-2 text-primary disabled:opacity-30 ${FOCUS_RING}`}><Icons.ChevronRight size={18} /></button>
      </div>
    </div>
  );

  const payload: WorkspacePayload = { selectedMonth, months, refreshTrigger, isDirty, markClean, markDirty, guard, registerSave, router };
  const handleDialogStay = () => setDialogState(null);
  const handleDialogLeave = () => {
    const action = dialogState?.onLeave;
    setDialogState(null);
    action?.();
  };

  return (
    <Layout activeNav="workspace" title="แผนการเงินรายเดือน" headerActions={headerActions} onCalendarClose={({ changed }) => { if (changed) handleDataRefresh(); }} onBeforeNavigate={handleBeforeNavigate}>
      <div className="mx-auto max-w-[1200px]">
        <p role="status" aria-live="polite" className="mb-space-3 min-h-[1em] text-xs font-medium text-warn">{isDirty ? '● ยังไม่ได้บันทึก' : ''}</p>

        <nav className="mb-space-4 flex flex-wrap gap-x-space-1 gap-y-space-2 pb-space-1 lg:flex-nowrap lg:gap-x-space-2 lg:gap-y-space-2" aria-label="ส่วนของบันทึกรายเดือน">
          {PRIMARY_NAV.map(item => {
            const active = item.id === section || (item.id === 'savings' && SAVINGS_GROUP.includes(section));
            return (
              <Link key={item.id} href={sectionHref(item.id, selectedMonth || undefined)} className={`flex min-h-11 shrink-0 basis-[calc((100%-1rem)/5)] items-center justify-center gap-space-2 whitespace-nowrap rounded-sm border-b-2 px-space-2 py-space-3 text-xs font-medium transition-colors duration-fast ease-graphite lg:basis-auto lg:justify-start lg:px-space-4 lg:text-sm ${FOCUS_RING} ${active ? 'border-accent text-primary font-semibold' : 'border-transparent text-secondary hover:text-primary'}`} aria-current={active ? 'page' : undefined} onClick={event => handleNavLinkClick(event, item.id, active)}>
                <span className="hidden lg:inline-flex" aria-hidden="true"><item.Icon size={20} /></span>{item.label}
              </Link>
            );
          })}
        </nav>

        {SAVINGS_GROUP.includes(section) && (
          <nav className="mb-space-4 flex flex-wrap gap-space-2" aria-label="ส่วนย่อยของเงินออม">
            {SUB_NAV.map(item => {
              const active = item.id === section;
              return <Link key={item.id} href={sectionHref(item.id, selectedMonth || undefined)} className={`rounded-full bg-surface-2 px-space-3 py-space-2 text-sm ${FOCUS_RING} ${active ? 'font-semibold text-primary' : 'text-secondary hover:text-primary'}`} aria-current={active ? 'page' : undefined} onClick={event => handleNavLinkClick(event, item.id, active)}>{item.label}</Link>;
            })}
          </nav>
        )}

        <div className="min-h-[400px] rounded-md border border-border-default bg-surface-1 p-space-4 pb-[calc(var(--nav-safe-bottom,56px)+80px)] shadow-elev-1 md:p-space-5" onInput={event => { if (!isListViewControl(event.target)) setIsDirty(true); }} onChange={event => { if (!isListViewControl(event.target)) setIsDirty(true); }}>
          <div className="mb-space-5 flex items-center gap-space-3 border-b border-border-subtle pb-space-4"><headingMeta.Icon size={24} color={headingMeta.color} /><h3 className="text-xl font-semibold text-primary">{sectionMeta.heading}</h3></div>
          {typeof children === 'function' ? children(payload) : children}
        </div>
      </div>

      {typeof overlay === 'function' ? overlay(payload) : overlay}

      <MonthManager selectedMonth={selectedMonth} onMonthSelected={guardedMonthChange} onDataRefresh={handleDataRefresh} months={months} open={monthPickerOpen} onRequestClose={() => setMonthPickerOpen(false)} />

      <button type="button" onClick={handleSave} disabled={!isDirty || isSaving} aria-hidden={!isDirty} aria-label={sectionMeta.saveLabel} data-visible={isDirty} className={`fixed right-space-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-on-accent shadow-elev-3 transition-opacity duration-base ease-graphite ${FOCUS_RING_ON_ACCENT} ${isDirty ? 'opacity-100' : 'pointer-events-none opacity-0'}`} style={{ bottom: 'calc(var(--nav-safe-bottom, 56px) + 16px)' }}>
        {isSaving ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-on-accent border-t-transparent" aria-hidden="true" /> : <Icons.Save size={22} />}
      </button>

      <UnsavedChangesDialog open={!!dialogState} message={dialogState?.message || ''} onStay={handleDialogStay} onLeave={handleDialogLeave} />
    </Layout>
  );
}