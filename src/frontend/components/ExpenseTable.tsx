/**
 * คอมโพเนนต์: ExpenseTable
 * หน้าจอหลักสำหรับจัดการค่าใช้จ่ายรายเดือน
 */

import { Fragment, useState, useEffect, useMemo, useRef, type FocusEvent, type ReactNode } from 'react';
import Link from 'next/link';
import type { ExpenseItem, MonthKey } from '../../shared/types/domain';
import {
  formatCurrency,
  parseToNumber,
  formatExpenseData,
  handleNumberInput,
  handleNumberBlur,
  DEFAULT_EXPENSE_ITEMS
} from '../../shared/utils/frontend/numberUtils';
import { getAccountBreakdown } from '../../shared/utils/commonUtils';
import { formatDueDayText, getValidResolvedDueDate, formatRowDueText, type DueRowLike } from '../../shared/utils/frontend/expenseDueText';
import { formatExpenseForSave, calculateExpenseTotal } from '../../shared/utils/expenseUtils';
import {
  END_OF_MONTH_DUE_DAY,
  isEndOfMonthDueDay,
  resolveDueDayForMonth,
  getDueDateFromDay,
  formatDueDateLabel,
  getStartOfToday,
  getDaysInMonth,
  formatMonthKeyTH
} from '../../shared/utils/dateUtils';
import { isCreditCardRowKey, isRevolvingRowKey, buildRevolvingRowKey, formatIsoDateTH, isValidPurchaseDate, isCardType, isLoanCardType, CARD_TYPE_LABELS } from '../../shared/utils/creditCardUtils';
import { isSavingsLoanRepaymentRowKey } from '../../shared/utils/savingsLedger';
import { toBankAccountNames } from '../../shared/utils/bankAccountShape';
import { compareListValues, matchesListQuery } from '../../shared/utils/frontend/listView';
import { useListProjection } from '../../shared/utils/frontend/useListProjection';
import { buildRowContexts, financialFieldLabel } from '../../shared/utils/frontend/fieldLabels';
import BankAccountTable from './BankAccountTable';
import LoadingNotice from './LoadingNotice';
import ListToolbar from './ListToolbar';
import SavingsLoanRepaymentDialog from './SavingsLoanRepaymentDialog';
import { expenseAPI, creditCardAPI, savingsLedgerAPI } from '../../shared/utils/frontend/apiUtils';
import { useSession } from '../contexts/SessionContext';
import { useListCriteria } from '../contexts/ListViewContext';
import { showToast } from '../../shared/utils/frontend/toast';
import { Icons } from './Icons';
import CardTotalPaymentDialog from './CardTotalPaymentDialog';
import CardExpenseDetailsDialog from './CardExpenseDetailsDialog';
import type { CardTotalExpenseRow } from '../../shared/utils/backend/creditCardSync';
import { randomInt } from '../../shared/utils/randomId';

type ExpenseRow = ExpenseItem & { [field: string]: unknown; dueDate?: unknown; breakdown?: CardTotalExpenseRow['breakdown']; cardType?: unknown };

/** ป้ายประเภทของแถวบัตร — cardType มาจากแถว ccr_ ของ server (แสดงผลเท่านั้น); ไม่มีค่า = บัตรเครดิต */
const cardRowTypeLabel = (row: ExpenseRow): string => CARD_TYPE_LABELS[isCardType(row.cardType) ? row.cardType : 'credit_card'].label;
type ExpenseValues = Record<string, ExpenseRow>;
type DueStatus = 'overdue' | 'dueToday' | 'dueSoon' | 'future' | 'done' | 'none';

interface ExpenseTableProps {
  selectedMonth: MonthKey | null | undefined;
  onRegisterSave?: (handler: (() => Promise<void>) | null) => void;
  onSaved?: () => void;
  markDirty?: () => void;
  /** key ของแถวที่ควร scroll ไปโฟกัสตอน mount (มาจาก ?focus= บน dashboard, S1) — null เมื่อไม่มี/ถูก consume แล้ว */
  focusKey?: string | null;
  /** เดือนที่ focusKey อ้างถึง — ต้องตรงกับเดือนที่โหลดอยู่จริง (loadedMonth) ก่อนจะ scroll (F-10) */
  focusMonth?: string | null;
  /** เรียกครั้งเดียวหลัง intake effect ประมวลผล focusKey เสร็จ (สำเร็จหรือ no-op) ให้ผู้เรียก consume token */
  onFocusHandled?: () => void;
}

interface InstallmentMetadata {
  key: string;
  cardId: string;
  cardName: string;
  cardColor?: string;
}

interface PreviousMonthUnpaid {
  total: number;
  count: number;
  monthKey: string;
}

interface DueTiming {
  status: DueStatus;
  badge: string;
  helper: string;
  date: Date | null;
  diffDays: number | null;
}

interface DueUpcomingItem {
  key: string;
  name: string;
  date: Date;
  diffDays: number;
  dueDay: unknown;
  resolvedDueDay: number | null;
  /** resolvedDueDate ของแถวบัตรเมื่ออยู่คนละเดือนกับ selectedMonth — ไม่เช่นนั้น null */
  crossMonthDueDate: string | null;
}

interface DueInsights {
  upcomingCount: number;
  urgentCount: number;
  overdueCount: number;
  overdueTotal: number;
  pendingTotal: number;
  nextDueLabel: string;
  nextDueName: string;
}

interface SelectedCardDetails {
  key: string;
  cardId: string;
  month: MonthKey;
}

const DEFAULT_EXPENSE_KEY_ORDER = DEFAULT_EXPENSE_ITEMS.map(item => item.key);
const DEFAULT_EXPENSE_LABEL_MAP = DEFAULT_EXPENSE_ITEMS.reduce<Record<string, string>>((acc, item) => {
  acc[item.key] = item.label;
  return acc;
}, {});

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DUE_SOON_THRESHOLD_DAYS = 5;

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const INPUT = `h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-base text-primary outline-none ${FOCUS_RING}`;
const SELECT = `h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-sm text-primary outline-none ${FOCUS_RING}`;
const REMOVE_BTN = `flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-interactive bg-surface-2 text-neg ${FOCUS_RING}`;
const CARD = 'rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1';

const DUE_BADGE_TONE: Record<DueStatus, string> = {
  overdue: 'border-neg/40 bg-neg/10 text-neg',
  dueToday: 'border-warn/40 bg-warn/10 text-warn',
  dueSoon: 'border-info/40 bg-info/10 text-info',
  future: 'border-pos/35 bg-pos/10 text-pos',
  done: 'border-pos/40 bg-pos/15 text-pos',
  none: 'border-dashed border-border-default text-secondary'
};

const getPreviousMonthKey = (monthKey: string | null | undefined): string | null => {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return null;
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  if (month === 1) return `${year - 1}-12`;
  return `${year}-${String(month - 1).padStart(2, '0')}`;
};

/**
 * รอบบิลที่แถวบัตร (ccr_) แสดง ('YYYY-MM') จาก GET monthly_expense — ไม่ถูกต้อง/ไม่มี => null
 * spec-credit-card-due-month-placement DP-4: label derive อย่างเดียว ไม่ใช่ข้อมูลเงิน
 */
const getRowCycleMonth = (row: { [field: string]: unknown } | null | undefined): MonthKey | null => {
  const value = row?.cycleMonth;
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value as MonthKey : null;
};

/**
 * วันครบกำหนดจริงของแถว — แถวบัตรใช้ resolvedDueDate (อาจอยู่เดือนถัดไป)
 * แถวปกติ/payload เก่าใช้ dueDay ของเดือนที่เลือกเหมือนเดิม · derive อ่านอย่างเดียว ไม่เก็บ
 */
const rowDueDate = (row: DueRowLike, monthKey: MonthKey | null | undefined): Date | null => {
  const resolved = getValidResolvedDueDate(row.resolvedDueDate);
  if (resolved) {
    const [year, month, day] = resolved.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  return getDueDateFromDay(row.dueDay, monthKey as MonthKey);
};

const describeDueTiming = (
  row: DueRowLike,
  paid: boolean,
  monthKey: MonthKey | null | undefined,
  amount: number
): DueTiming => {
  const parsedDate = rowDueDate(row, monthKey);
  const dueDayText = formatDueDayText(row.dueDay);
  if (paid) return { status: 'done', badge: 'ชำระแล้ว', helper: dueDayText ? `ครบกำหนดทุก${dueDayText}` : '', date: parsedDate, diffDays: null };
  if (!(amount > 0)) return { status: 'none', badge: 'ยังไม่กรอกยอด', helper: dueDayText ? `ครบกำหนดทุก${dueDayText}` : '', date: parsedDate, diffDays: null };
  if (!parsedDate) return { status: 'none', badge: 'ยังไม่กำหนด', helper: '', date: null, diffDays: null };
  const today = getStartOfToday();
  const diffDays = Math.ceil((parsedDate.getTime() - today.getTime()) / DAY_IN_MS);
  if (diffDays < 0) return { status: 'overdue', badge: `เกินกำหนด ${Math.abs(diffDays)} วัน`, helper: dueDayText ? `ทุก${dueDayText}` : '', date: parsedDate, diffDays };
  if (diffDays === 0) return { status: 'dueToday', badge: 'ครบกำหนดวันนี้', helper: '', date: parsedDate, diffDays };
  if (diffDays <= DUE_SOON_THRESHOLD_DAYS) return { status: 'dueSoon', badge: `อีก ${diffDays} วัน`, helper: dueDayText ? `ทุก${dueDayText}` : '', date: parsedDate, diffDays };
  return { status: 'future', badge: dueDayText ? `ทุก${dueDayText}` : 'ครบกำหนด', helper: 'ครบกำหนด', date: parsedDate, diffDays };
};

function DueBadge({ status, children }: { status: DueStatus; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-space-2 py-[2px] text-xs font-medium ${DUE_BADGE_TONE[status] || DUE_BADGE_TONE.none}`}>{children}</span>;
}

export default function ExpenseTable({ selectedMonth, onRegisterSave, onSaved, markDirty, focusKey = null, focusMonth = null, onFocusHandled }: ExpenseTableProps) {
  const [editExpense, setEditExpense] = useState<ExpenseValues>({});
  const [bankAccounts, setBankAccounts] = useState<string[]>([]);
  const [previousMonthTotal, setPreviousMonthTotal] = useState<number | null>(null);
  const [prevExpenseValues, setPrevExpenseValues] = useState<ExpenseValues>({});
  const [isLoading, setIsLoading] = useState(false);
  const [persistedKeys, setPersistedKeys] = useState<string[]>([]);
  const [pendingScrollKey, setPendingScrollKey] = useState<string | null>(null);
  // S1 (dashboard-upcoming-click-to-view): เดือนที่ editExpense ปัจจุบันเป็นข้อมูลจริงของ — ต้อง set คู่กับ
  // setEditExpense ใน .then/.catch ของ effect โหลดข้อมูล ไม่ derive จาก isLoading (isLoading flip ช้าไปหนึ่ง render)
  const [loadedMonth, setLoadedMonth] = useState<MonthKey | null>(null);
  // แถวที่เป็นปลายทางของการ arrival จาก dashboard — คงอยู่ตลอด (ไม่ timed) เพื่อไม่ให้ tabIndex หลุดตอน focus ค้าง (F-3)
  const [arrivalFocusKey, setArrivalFocusKey] = useState<string | null>(null);
  // แถวที่กำลังแสดง highlight outline — เคลียร์อัตโนมัติหลัง 4000ms เหมือน highlight บน dashboard
  const [arrivalHighlightKey, setArrivalHighlightKey] = useState<string | null>(null);
  const arrivalHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // โหมดของ tryScroll effect: 'edit' = โฟกัส input[type=text] เดิม (เพิ่มแถวใหม่), 'view' = โฟกัสตัว row เอง (arrival)
  const scrollFocusModeRef = useRef<'edit' | 'view'>('edit');
  // กันการประมวลผล focusKey/focusMonth คู่เดิมซ้ำ (เช่น remount จาก refreshTrigger ขณะ ?focus= ยังอยู่ใน URL, E-5/E-6)
  const handledFocusRef = useRef<string | null>(null);
  const [pendingPaidKeys, setPendingPaidKeys] = useState<string[]>([]);
  const [cardPayment, setCardPayment] = useState<{ key: string; month: string; paid: boolean; cycleMonth?: string; row: ExpenseRow & { breakdown: CardTotalExpenseRow['breakdown'] } } | null>(null);
  const [selectedCardDetails, setSelectedCardDetails] = useState<SelectedCardDetails | null>(null);
  const cardDetailsOpenerRef = useRef<HTMLButtonElement | null>(null);
  const expenseListFallbackRef = useRef<HTMLHeadingElement | null>(null);
  // S5 (savings-loan-withdrawal §5.1): ปุ่ม "คืนเงินกู้ (เงินออม)" แสดงเมื่อมีเงินกู้ที่ยังไม่คืน ≥ 1 รายการเท่านั้น
  // โหลดครั้งเดียวตอน mount + หลังคืนเงินทุกครั้ง; โหลดไม่สำเร็จ => ปุ่มไม่แสดงเฉยๆ ไม่ทำให้หน้ารายจ่ายพัง
  const [hasOpenSavingsLoan, setHasOpenSavingsLoan] = useState(false);
  const [repaymentDialogOpen, setRepaymentDialogOpen] = useState(false);
  const addExpenseButtonRef = useRef<HTMLButtonElement | null>(null);
  const repayButtonRef = useRef<HTMLButtonElement | null>(null);
  const selectedMonthRef = useRef(selectedMonth);
  selectedMonthRef.current = selectedMonth;
  useEffect(() => {
    setCardPayment(null);
    setSelectedCardDetails(null);
  }, [selectedMonth]);
  const pendingPaidRef = useRef<Set<string>>(new Set());

  // S5 §5.1: ตรวจเงินกู้ที่ยังไม่คืนครั้งเดียวตอน mount — ไม่ผูกกับ selectedMonth เพราะเงินกู้ไม่ใช่ข้อมูลรายเดือน
  const refreshSavingsLoanGate = async () => {
    try {
      const response = await savingsLedgerAPI.getLoans();
      const openCount = Array.isArray(response?.loans) ? response.loans.filter(loan => loan?.status === 'open').length : 0;
      setHasOpenSavingsLoan(openCount > 0);
    } catch {
      setHasOpenSavingsLoan(false);
    }
  };
  useEffect(() => {
    void refreshSavingsLoanGate();
  }, []);
  // F-S5-4: ปุ่ม "คืนเงินกู้ (เงินออม)" unmount ทันทีที่ hasOpenSavingsLoan เปลี่ยนเป็น false (เงินกู้ก้อนสุดท้ายปิด)
  // ต้องรอ transition นี้จริง (หลัง commit) แทนการใช้ timer คงที่ — เพราะตอนนี้ dialog ปิด (onClose) ก่อน
  // onSaved รีเฟรชเสร็จ (F-S5-3) ปุ่มนี้อาจยัง mount อยู่ตอนปิด dialog แล้ว unmount ทีหลังเมื่อ gate รีเฟรชเสร็จ
  // ทำให้โฟกัสที่เพิ่งคืนให้ปุ่มนี้หลุดไป <body> — ถ้าเกิดแบบนั้น ง้างโฟกัสไปปุ่ม "+ เพิ่มรายการ" แทน
  const hadOpenSavingsLoanRef = useRef(hasOpenSavingsLoan);
  useEffect(() => {
    const previouslyOpen = hadOpenSavingsLoanRef.current;
    hadOpenSavingsLoanRef.current = hasOpenSavingsLoan;
    if (!previouslyOpen || hasOpenSavingsLoan) return;
    const active = document.activeElement;
    const focusLost = !active || active === document.body || !document.contains(active);
    if (focusLost) addExpenseButtonRef.current?.focus();
  }, [hasOpenSavingsLoan]);
  const [installmentMeta, setInstallmentMeta] = useState<Record<string, InstallmentMetadata>>({});
  const [expenseLoadRevision, setExpenseLoadRevision] = useState(0);
  const [criteria, setCriteria] = useListCriteria('monthly-expenses');
  const { currentUser } = useSession();
  const shouldShowAccountTable = Boolean(currentUser?.id);

  useEffect(() => {
    if (!pendingScrollKey) return undefined;
    const tryScroll = () => {
      if (typeof document === 'undefined') return false;
      const targets = Array.from(document.querySelectorAll<HTMLElement>(`[data-expense-key="${pendingScrollKey}"]`));
      const target = targets.find(node => node.offsetParent !== null) || targets[0];
      if (!target) return false;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // S1: arrival จาก dashboard โฟกัสตัว row เอง (ต้องไม่เปิดคีย์บอร์ดมือถือ, F-9); flow เพิ่มแถวใหม่ยังโฟกัส input เดิม
      if (scrollFocusModeRef.current === 'view') {
        target.focus({ preventScroll: true });
      } else {
        target.querySelector<HTMLInputElement>('input[type="text"]')?.focus({ preventScroll: true });
      }
      return true;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!tryScroll()) {
      timer = setTimeout(() => {
        if (tryScroll()) {
          setPendingScrollKey(null);
          scrollFocusModeRef.current = 'edit';
        }
      }, 80);
      return () => { if (timer) clearTimeout(timer); };
    }
    setPendingScrollKey(null);
    scrollFocusModeRef.current = 'edit';
    return () => { if (timer) clearTimeout(timer); };
  }, [editExpense, pendingScrollKey]);

  useEffect(() => {
    if (!selectedMonth) {
      setEditExpense({});
      setBankAccounts([]);
      setPersistedKeys([]);
      setLoadedMonth(null);
      setExpenseLoadRevision(revision => revision + 1);
      return;
    }
    setIsLoading(true);
    expenseAPI.getByMonth(selectedMonth)
      .then(data => {
        const formatted = formatExpenseData(data || {}, selectedMonth);
        setEditExpense(formatted.values as ExpenseValues || {});
        const monthAccounts = formatted.bankAccounts || [];
        const mergedAccounts = toBankAccountNames([...monthAccounts, ...(currentUser?.bankAccounts || [])]);
        setBankAccounts(mergedAccounts);
        setPersistedKeys(formatted.persistedKeys || []);
        setLoadedMonth(selectedMonth);
      })
      .catch(error => {
        console.error('Error loading expense data:', error);
        const formatted = formatExpenseData({}, selectedMonth);
        setEditExpense(formatted.values as ExpenseValues || {});
        setBankAccounts(toBankAccountNames(currentUser?.bankAccounts));
        setPersistedKeys(formatted.persistedKeys || []);
        setLoadedMonth(selectedMonth);
      })
      .finally(() => {
        setExpenseLoadRevision(revision => revision + 1);
        setIsLoading(false);
      });
  }, [selectedMonth, currentUser?.bankAccounts]);

  // รอบบิลที่แถวบัตร (ccr_) ของตารางนี้แสดง — แถวของบัตรข้ามเดือนในตาราง M แสดงรอบ M-1
  // (spec-credit-card-due-month-placement DP-1) · เป็น string คงที่เพื่อไม่ให้ effect ยิงซ้ำตอนพิมพ์
  const cardCycleMonthsKey = useMemo(() => {
    const months = new Set<string>();
    // offset ∈ {0,1} => รอบบิลที่เป็นไปได้มีแค่ selectedMonth หรือเดือนก่อนหน้า (กันแถวค้างจากเดือนเดิมตอนสลับเดือน)
    const allowed = new Set([String(selectedMonth ?? ''), getPreviousMonthKey(selectedMonth) ?? '']);
    Object.entries(editExpense).forEach(([item, row]) => {
      if (!isRevolvingRowKey(item)) return;
      const cycleMonth = getRowCycleMonth(row) ?? String(selectedMonth ?? '');
      if (allowed.has(cycleMonth)) months.add(cycleMonth);
    });
    const list = Array.from(months).filter(Boolean).sort();
    return list.length > 0 ? list.join(',') : String(selectedMonth ?? '');
  }, [editExpense, selectedMonth]);

  useEffect(() => {
    if (!selectedMonth || !currentUser?.id) {
      setInstallmentMeta({});
      return undefined;
    }
    let cancelled = false;
    // ดึง metadata ของทุกรอบบิลที่แถวบัตรแสดง (สูงสุด 2 เดือน เพราะ offset ∈ {0,1}) ไม่มีแถวบัตร => selectedMonth
    const metaMonths = cardCycleMonthsKey ? cardCycleMonthsKey.split(',') : [selectedMonth];
    Promise.all(metaMonths.map(month => Promise.all([
      creditCardAPI.getMonthInstallments(month),
      creditCardAPI.getRevolving({ month }).catch(() => null)
    ]))).then(results => {
      if (cancelled) return;
      const map: Record<string, InstallmentMetadata> = {};
      results.forEach(([items, revolving]) => {
        (Array.isArray(items) ? items : []).forEach((item: InstallmentMetadata) => {
          map[item.key] = item;
          map[buildRevolvingRowKey(item.cardId)] = item;
        });
        (Array.isArray(revolving?.cycles) ? revolving.cycles : []).forEach((cycle: InstallmentMetadata) => {
          if (!cycle?.key) return;
          map[cycle.key] = { key: cycle.key, cardId: cycle.cardId, cardName: cycle.cardName, cardColor: cycle.cardColor };
        });
      });
      setInstallmentMeta(map);
    });
    return () => { cancelled = true; };
  }, [selectedMonth, currentUser?.id, cardCycleMonthsKey]);

  useEffect(() => {
    // ล้างค่าเดือนก่อนทันทีที่เปลี่ยนเดือน เพื่อไม่ให้ยอดค้างของเดือนเก่าแสดงใต้ป้ายเดือนใหม่ระหว่างรอ response
    setPreviousMonthTotal(null);
    setPrevExpenseValues({});
    if (!selectedMonth) {
      setPreviousMonthTotal(null);
      setPrevExpenseValues({});
      return undefined;
    }
    const previousMonthKey = getPreviousMonthKey(selectedMonth);
    if (!previousMonthKey) {
      setPreviousMonthTotal(null);
      setPrevExpenseValues({});
      return undefined;
    }
    // cancelled guard: response ของเดือนเก่าที่มาช้าต้องไม่ทับ state ของเดือนใหม่ (ทั้งแถว ยอดรวม และยอดค้าง)
    let cancelled = false;
    expenseAPI.getByMonth(previousMonthKey)
      .then(data => {
        if (cancelled) return;
        const previousFormatted = formatExpenseData(data || {}, previousMonthKey);
        const previousValues = (previousFormatted.values || {}) as ExpenseValues;
        const previousTotal = calculateExpenseTotal(previousValues as unknown as Record<string, Record<string, unknown> | undefined>, 'actual', parseToNumber);
        setPreviousMonthTotal(previousTotal);
        setPrevExpenseValues(previousValues);
      })
      .catch(() => {
        if (cancelled) return;
        setPreviousMonthTotal(null);
        setPrevExpenseValues({});
      });
    return () => { cancelled = true; };
  }, [selectedMonth]);

  const updateExpenseField = (item: string, field: keyof ExpenseItem, value: unknown) => {
    setEditExpense(previous => {
      const current = previous[item] || {
        name: DEFAULT_EXPENSE_LABEL_MAP[item] || 'รายการใหม่',
        actual: '0.00',
        account: bankAccounts[0] || 'ไม่ระบุบัญชี',
        paid: false,
        dueDay: END_OF_MONTH_DUE_DAY
      };
      return { ...previous, [item]: { ...current, [field]: value } as ExpenseRow };
    });
  };

  const handleExpenseChange = (item: string, field: keyof ExpenseItem, value: unknown) => {
    if (field === 'paid' || field === 'name' || field === 'dueDay' || field === 'account') {
      updateExpenseField(item, field, value);
      return;
    }
    handleNumberInput(String(value ?? ''), nextValue => updateExpenseField(item, field, nextValue));
  };

  const handleExpenseBlur = (item: string, field: keyof ExpenseItem, value: unknown) => {
    if (field === 'paid') {
      updateExpenseField(item, field, value);
      return;
    }
    if (field === 'name') {
      const cleanName = typeof value === 'string' && value.trim().length > 0 ? value.trim() : (DEFAULT_EXPENSE_LABEL_MAP[item] || 'รายการใหม่');
      updateExpenseField(item, field, cleanName);
      return;
    }
    if (field === 'dueDay') {
      if (isEndOfMonthDueDay(value)) {
        updateExpenseField(item, field, END_OF_MONTH_DUE_DAY);
        return;
      }
      const parsed = parseInt(String(value), 10);
      updateExpenseField(item, field, Number.isNaN(parsed) ? '' : String(Math.min(31, Math.max(1, parsed))));
      return;
    }
    updateExpenseField(item, field, value);
  };

  const handleAmountInputFocus = (event: FocusEvent<HTMLInputElement>) => event.target.select();

  const handleAddExpenseItem = () => {
    markDirty?.();
    const uniqueKey = `custom_${Date.now()}_${randomInt(1000)}`;
    setEditExpense(previous => ({
      ...previous,
      [uniqueKey]: { name: 'รายการใหม่', actual: '0.00', account: bankAccounts[0] || 'ไม่ระบุบัญชี', paid: false, dueDay: END_OF_MONTH_DUE_DAY }
    }));
    setPendingScrollKey(uniqueKey);
  };

  const handleDeleteExpenseItem = (item: string) => {
    markDirty?.();
    setEditExpense(previous => {
      const updated = { ...previous };
      delete updated[item];
      return updated;
    });
  };

  const setPendingPaid = (item: string, pending: boolean) => {
    if (pending) pendingPaidRef.current.add(item); else pendingPaidRef.current.delete(item);
    setPendingPaidKeys(Array.from(pendingPaidRef.current));
  };

  /** สลับ paid แบบ optimistic แล้วบันทึกทันทีเฉพาะแถวนี้ (ADR-028) */
  const handleTogglePaid = async (item: string) => {
    if (!selectedMonth || pendingPaidRef.current.has(item)) return;
    const row = editExpense[item];
    const previousPaid = row?.paid === true || row?.paid === 'true';
    const nextPaid = !previousPaid;
    if (isRevolvingRowKey(item) && row.breakdown) {
      const cycleMonth = getRowCycleMonth(row);
      setCardPayment({
        key: item,
        month: selectedMonth,
        paid: nextPaid,
        ...(cycleMonth ? { cycleMonth } : {}),
        row: { ...row, breakdown: row.breakdown }
      });
      return;
    }
    const derived = isCreditCardRowKey(item);
    const needsRow = !derived && !persistedKeys.includes(item);
    setPendingPaid(item, true);
    updateExpenseField(item, 'paid', nextPaid);
    try {
      const result = await expenseAPI.setPaid(
        selectedMonth,
        item,
        nextPaid,
        needsRow && row ? {
          name: String(row.name ?? DEFAULT_EXPENSE_LABEL_MAP[item] ?? 'รายการใหม่'),
          actual: String(row.actual ?? '0'),
          account: String(row.account || bankAccounts[0] || 'ไม่ระบุบัญชี'),
          dueDay: row.dueDay ?? END_OF_MONTH_DUE_DAY
        } : undefined
      );
      if (result?.initialized) {
        const added = result.seeded ? DEFAULT_EXPENSE_ITEMS.map(entry => entry.key) : [item];
        setPersistedKeys(previous => Array.from(new Set([...previous, ...added])));
      }
      onSaved?.();
    } catch (error) {
      updateExpenseField(item, 'paid', previousPaid);
      showToast(
        (error as { name?: string } | null)?.name === 'ApiValidationError' ? (error as Error).message : 'บันทึกสถานะการจ่ายไม่สำเร็จ ระบบคืนค่าเดิมให้แล้ว',
        'error'
      );
    } finally {
      setPendingPaid(item, false);
    }
  };

  const confirmCardPayment = async (action?: 'full' | 'minimum') => {
    if (!cardPayment || pendingPaidRef.current.has(cardPayment.key)) return;
    const { key, month, paid, cycleMonth } = cardPayment;
    // โหลดเฉพาะแถวบัตร (cci_/ccr_) ของเดือนนี้ใหม่ — แถวที่ผู้ใช้กำลังแก้ไม่ถูกแตะ
    const refreshCardRows = async () => {
      const data = await expenseAPI.getByMonth(month);
      const formatted = formatExpenseData(data || {}, month);
      if (selectedMonthRef.current === month) setEditExpense(previous => {
        const refreshed = formatted.values as ExpenseValues;
        const next = { ...previous };
        Object.keys(next).filter(isCreditCardRowKey).forEach(item => { delete next[item]; });
        Object.entries(refreshed).filter(([item]) => isCreditCardRowKey(item)).forEach(([item, row]) => { next[item] = row; });
        return next;
      });
    };
    setPendingPaid(key, true);
    try {
      // cycleMonth = staleness guard (DP-4) — server คำนวณรอบบิลเองเสมอ
      await expenseAPI.setPaid(month, key, paid, undefined, action, cycleMonth);
      await refreshCardRows();
      setCardPayment(null);
      onSaved?.();
    } catch (error) {
      const failure = error as (Error & { status?: number; code?: string }) | null;
      if (failure?.status === 409 && failure.code === 'cycle_mismatch') {
        // ตั้งค่ารอบบิลของบัตรเปลี่ยนระหว่าง GET กับ PATCH — ไม่มีอะไรถูกเขียน โหลดแถวบัตรใหม่แล้วแจ้งข้อความจาก server
        setCardPayment(null);
        showToast(failure.message || 'ข้อมูลรอบบิลของบัตรเปลี่ยนแล้ว กรุณาโหลดหน้านี้ใหม่', 'error');
        try {
          await refreshCardRows();
        } catch (refreshError) {
          console.error('Error reloading credit-card rows:', refreshError);
        }
        return;
      }
      showToast(error instanceof Error ? error.message : 'บันทึกสถานะบัตรไม่สำเร็จ กรุณาโหลดข้อมูลใหม่', 'error');
    } finally {
      setPendingPaid(key, false);
    }
  };

  /**
   * S5 §5.3, C-S5-4: รีเฟรชเฉพาะแถว slr_ ของเดือนที่เปิด dialog อยู่ หลังคืนเงินกู้สำเร็จ — refetch เดือนนั้น
   * แล้วแทนที่เฉพาะคีย์ slr_ ใน state แถวอื่นและ dirty state ของ FAB ไม่ถูกแตะ (AC-SLW-29)
   * sibling function แยกจาก refreshCardRows โดยตั้งใจ — ไม่แก้ refreshCardRows ให้รับ parameter เพิ่ม (C-S5-4)
   */
  const refreshRepaymentRows = async (month: string) => {
    const data = await expenseAPI.getByMonth(month);
    const formatted = formatExpenseData(data || {}, month);
    if (selectedMonthRef.current === month) setEditExpense(previous => {
      const refreshed = formatted.values as ExpenseValues;
      const next = { ...previous };
      Object.keys(next).filter(isSavingsLoanRepaymentRowKey).forEach(item => { delete next[item]; });
      Object.entries(refreshed).filter(([item]) => isSavingsLoanRepaymentRowKey(item)).forEach(([item, row]) => { next[item] = row; });
      return next;
    });
  };

  const handleRepaymentSaved = async () => {
    // F-S5-4 (minor): refreshSavingsLoanGate (and the focus-fallback effect it can trigger, above) must still run
    // even if refreshRepaymentRows throws — otherwise the repay button stays visible/stale after a failed row
    // refresh. Harmless either way (repayLoan itself already succeeded), but try/finally keeps the gate accurate.
    try {
      if (selectedMonth) await refreshRepaymentRows(selectedMonth);
    } finally {
      await refreshSavingsLoanGate();
    }
    // S5 fix (F-S5-1): a repayment is its own write, scoped to slr_ rows only — it must never call onSaved(),
    // which on /workspace/expense is wired to WorkspaceShell's markClean (WorkspaceShell.tsx:264). Calling it here
    // would clear the *whole page's* dirty state and hide the Save FAB / disarm the leave-guard even while another
    // row still has a genuine unsaved edit, silently risking that edit's loss (breaks AC-SLW-29, C-S5-7).
  };

  const closeRepaymentDialog = () => {
    setRepaymentDialogOpen(false);
    // §5.3 item 4: โฟกัสกลับปุ่ม "คืนเงินกู้ (เงินออม)" — dialog เองพยายามคืนโฟกัสให้ trigger element แล้ว
    // (ปุ่มนี้ยัง mount อยู่ตอนปิด เพราะ onClose เกิดก่อน onSaved รีเฟรชเสร็จ — F-S5-3). ถ้าเงินกู้ก้อนสุดท้าย
    // ถูกปิดจริง ปุ่มนี้จะ unmount ทีหลังตอน gate รีเฟรชเสร็จ — fallback ไปปุ่ม "+ เพิ่มรายการ" อยู่ใน effect
    // ด้านบนที่ฟัง hasOpenSavingsLoan transition (F-S5-4) ไม่ใช่ timer คงที่ที่นี่ เพราะจังหวะรีเฟรชไม่แน่นอน
  };

  /** caption "รอบบิล ..." เฉพาะแถวบัตรที่แสดงรอบบิลคนละเดือนกับตาราง (spec-credit-card-due-month-placement §UX) */
  const cycleCaption = (row: ExpenseRow) => {
    const cycleMonth = getRowCycleMonth(row);
    if (!cycleMonth || cycleMonth === selectedMonth) return null;
    return <span className="mt-space-1 block text-xs text-tertiary">{`รอบบิล ${formatMonthKeyTH(cycleMonth)}`}</span>;
  };

  const cardDetails = (item: string, row: ExpenseRow, meta?: InstallmentMetadata) => {
    if (!row.breakdown || !meta || !selectedMonth) return null;
    const isSelected = selectedCardDetails?.key === item && selectedCardDetails.month === selectedMonth;
    return (
      <button
        type="button"
        className={`mt-space-2 inline-flex min-h-11 items-center gap-space-2 text-left text-sm text-accent underline underline-offset-2 ${FOCUS_RING}`}
        aria-haspopup="dialog"
        aria-expanded={isSelected}
        aria-controls={isSelected ? 'expense-card-details-dialog' : undefined}
        onClick={event => {
          cardDetailsOpenerRef.current = event.currentTarget;
          setSelectedCardDetails({ key: item, cardId: meta.cardId, month: selectedMonth });
        }}
      >
        ดูรายละเอียด<span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center"><Icons.ChevronDown size={16} /></span>
      </button>
    );
  };

  const handleSave = async () => {
    if (!selectedMonth) return;
    try {
      const prepared: Record<string, unknown> = formatExpenseForSave(editExpense, parseToNumber);
      const normalizedAccounts = toBankAccountNames(bankAccounts);
      prepared.bankAccounts = normalizedAccounts;
      const preparedKeys = Object.keys(prepared || {});
      const removedKeys = persistedKeys.filter(key => key !== 'bankAccounts' && !preparedKeys.includes(key));
      if (removedKeys.length > 0) prepared.__removeKeys = removedKeys;
      await expenseAPI.save(selectedMonth, prepared);

      const data = await expenseAPI.getByMonth(selectedMonth);
      const formatted = formatExpenseData(data || {}, selectedMonth);
      setEditExpense(formatted.values as ExpenseValues || {});
      const monthAccounts = formatted.bankAccounts || [];
      const mergedAccounts = toBankAccountNames([...monthAccounts, ...(currentUser?.bankAccounts || [])]);
      setBankAccounts(mergedAccounts);
      setPersistedKeys(formatted.persistedKeys || []);
      expenseProjection.refresh();
      showToast('บันทึกค่าใช้จ่ายสำเร็จ');
      onSaved?.();
    } catch (error) {
      console.error('Error saving expense data:', error);
      showToast(
        (error as { name?: string } | null)?.name === 'ApiValidationError' ? (error as Error).message : 'บันทึกไม่สำเร็จ กรุณาลองใหม่',
        'error'
      );
    }
  };

  useEffect(() => {
    if (!onRegisterSave) return undefined;
    onRegisterSave(handleSave);
    return () => onRegisterSave(null);
  }, [onRegisterSave, handleSave]);

  const sortedExpenseKeys = useMemo(() => {
    const keys = Object.keys(editExpense || {});
    const defaultKeys = DEFAULT_EXPENSE_KEY_ORDER.filter(key => keys.includes(key));
    const revolvingKeys = keys.filter(key => isRevolvingRowKey(key));
    const installmentKeys = keys.filter(key => isCreditCardRowKey(key) && !isRevolvingRowKey(key));
    // S5 C-S5-1: ตัด slr_ ออกจาก customKeys ก่อน ไม่เช่นนั้นจะเรนเดอร์ผ่านแถวที่แก้ไขได้ (ช่องชื่อ/จำนวนเงิน/ปุ่มลบ)
    // แทน read-only branch — repaymentKeys แทรกหลัง customKeys ก่อนแถวบัตร (UX_SPEC §5.5)
    const repaymentKeys = keys.filter(key => isSavingsLoanRepaymentRowKey(key));
    const customKeys = keys.filter(key => !DEFAULT_EXPENSE_KEY_ORDER.includes(key) && !isCreditCardRowKey(key) && !isSavingsLoanRepaymentRowKey(key));
    return [...defaultKeys, ...customKeys, ...repaymentKeys, ...revolvingKeys, ...installmentKeys];
  }, [editExpense]);

  const accountOptions = useMemo(() => {
    const accounts = Array.from(new Set(sortedExpenseKeys.map(key => String(editExpense[key]?.account ?? '').trim()).filter(Boolean)));
    return [
      { value: '__unassigned', label: 'ไม่ระบุบัญชี' },
      ...accounts.map(account => ({ value: account, label: account }))
    ];
  }, [editExpense, sortedExpenseKeys]);
  const orders = useMemo(() => [
    { value: 'name-asc', label: 'ชื่อ: ก–ฮ / A–Z' },
    { value: 'name-desc', label: 'ชื่อ: ฮ–ก / Z–A' },
    { value: 'amount-asc', label: 'จำนวนเงิน: น้อยไปมาก' },
    { value: 'amount-desc', label: 'จำนวนเงิน: มากไปน้อย' },
    { value: 'due-asc', label: 'วันครบกำหนด: ใกล้ก่อน' },
    { value: 'due-desc', label: 'วันครบกำหนด: ไกลก่อน' },
  ], []);
  const expenseProjection = useListProjection({
    rows: sortedExpenseKeys,
    getId: key => key,
    matches: key => {
      const row = editExpense[key] || {};
      const name = String(row.name ?? DEFAULT_EXPENSE_LABEL_MAP[key] ?? 'รายการใหม่');
      if (!matchesListQuery(name, criteria.query)) return false;
      const account = String(row.account ?? '').trim();
      if (criteria.filters.account && (criteria.filters.account === '__unassigned' ? Boolean(account) : account !== criteria.filters.account)) return false;
      const paid = row.paid === true || row.paid === 'true';
      if (criteria.filters.paid && (criteria.filters.paid === 'paid' ? !paid : paid)) return false;
      const kind = isRevolvingRowKey(key) ? 'revolving' : isCreditCardRowKey(key) ? 'installment' : 'ordinary';
      if (criteria.filters.kind && kind !== criteria.filters.kind) return false;
      if (criteria.filters.due) {
        const date = rowDueDate(row, selectedMonth);
        const due = date ? new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() : null;
        const today = getStartOfToday().getTime();
        const status = due === null ? 'undated' : due < today ? (paid ? 'past-paid' : 'overdue') : due === today ? 'today' : 'future';
        if (criteria.filters.due !== status) return false;
      }
      return true;
    },
    compare: (a, b) => {
      const aRow = editExpense[a] || {};
      const bRow = editExpense[b] || {};
      const descending = criteria.order.endsWith('-desc');
      if (criteria.order.startsWith('name-')) {
        return compareListValues(aRow.name ?? DEFAULT_EXPENSE_LABEL_MAP[a] ?? 'รายการใหม่', bRow.name ?? DEFAULT_EXPENSE_LABEL_MAP[b] ?? 'รายการใหม่', descending);
      }
      if (criteria.order.startsWith('amount-')) {
        const amount = (value: unknown) => value == null || value === '' ? null : parseToNumber(value);
        return compareListValues(amount(aRow.actual), amount(bRow.actual), descending);
      }
      if (criteria.order.startsWith('due-')) {
        const due = (row: ExpenseRow) => rowDueDate(row, selectedMonth)?.getTime() ?? null;
        return compareListValues(due(aRow), due(bRow), descending);
      }
      return 0;
    },
    group: key => isCreditCardRowKey(key) ? 'credit' : 'ordinary',
    criteriaKey: JSON.stringify(criteria),
    datasetKey: `${selectedMonth ?? ''}:${isLoading ? 'loading' : 'ready'}:${expenseLoadRevision}`,
    editable: true,
  });

  // S1 (dashboard-upcoming-click-to-view): รับ focusKey/focusMonth จาก ?focus=/?month= ที่ parent ส่งมา —
  // เลียนแบบ pattern focusItemId ของ CreditSpendItems.tsx. handledFocusRef กัน token เดิมซ้ำ (E-5/E-6)
  useEffect(() => {
    if (!focusKey) return;
    const token = `${focusMonth}|${focusKey}`;
    if (handledFocusRef.current === token) return;
    if (loadedMonth == null) return; // รอข้อมูลเดือนปัจจุบันโหลดเสร็จก่อน (F-2)
    handledFocusRef.current = token;
    // F-10: key เดียวกันอาจมีอยู่ในหลายเดือน — ต้องตรงกับเดือนที่โหลดอยู่จริงก่อนค่อยค้นหา/scroll
    if (loadedMonth !== focusMonth) {
      onFocusHandled?.();
      return;
    }
    // E-4: ถูกซ่อนด้วย filter ของผู้ใช้เอง หรือถูกลบไปแล้ว — เงียบๆ ไม่แก้ filter ของผู้ใช้ (KL-1), ไม่ set pendingScrollKey (F-4)
    if (!expenseProjection.items.includes(focusKey)) {
      onFocusHandled?.();
      return;
    }
    scrollFocusModeRef.current = 'view';
    setArrivalFocusKey(focusKey);
    setArrivalHighlightKey(focusKey);
    if (arrivalHighlightTimerRef.current) clearTimeout(arrivalHighlightTimerRef.current);
    arrivalHighlightTimerRef.current = setTimeout(() => setArrivalHighlightKey(null), 4000);
    setPendingScrollKey(focusKey);
    onFocusHandled?.();
  }, [focusKey, focusMonth, loadedMonth, expenseProjection.items, onFocusHandled]);

  // เคลียร์ timer ของ highlight ตอน unmount กันเรียก setState หลัง component ถูกถอดออกไปแล้ว
  useEffect(() => () => {
    if (arrivalHighlightTimerRef.current) clearTimeout(arrivalHighlightTimerRef.current);
  }, []);

  const selectedCardDetailsRow = selectedCardDetails ? editExpense[selectedCardDetails.key] : undefined;
  const selectedCardDetailsMeta = selectedCardDetails ? installmentMeta[selectedCardDetails.key] : undefined;
  const showSelectedCardDetails = Boolean(
    selectedCardDetails
    && selectedCardDetails.month === selectedMonth
    && selectedCardDetailsMeta?.cardId === selectedCardDetails.cardId
    && selectedCardDetailsRow?.breakdown
    && expenseProjection.items.includes(selectedCardDetails.key)
  );
  useEffect(() => {
    if (selectedCardDetails && !showSelectedCardDetails) setSelectedCardDetails(null);
  }, [selectedCardDetails, showSelectedCardDetails]);
  const firstCreditCardKey = useMemo(() => expenseProjection.items.find(key => isCreditCardRowKey(key)) || null, [expenseProjection.items]);
  // S5 UX_SPEC §5.5: หัวกลุ่มแถวคืนเงินกู้ แสดงเฉพาะก่อนแถวแรกของกลุ่ม (รูปแบบเดียวกับ firstCreditCardKey)
  const firstRepaymentKey = useMemo(() => expenseProjection.items.find(key => isSavingsLoanRepaymentRowKey(key)) || null, [expenseProjection.items]);
  // หัวกลุ่มแถวบัตร: มีสินเชื่ออยู่ในกลุ่มด้วย → "บัตร & สินเชื่อ" (UX §3)
  const cardGroupLabel = expenseProjection.items.some(key => isCreditCardRowKey(key) && isLoanCardType(editExpense[key]?.cardType))
    ? 'บัตร & สินเชื่อ (ซิงก์อัตโนมัติ)'
    : 'บัตรเครดิต (ซิงก์อัตโนมัติ)';

  const daysInSelectedMonth = useMemo(() => {
    if (!selectedMonth || !/^\d{4}-\d{2}$/.test(selectedMonth)) {
      const now = new Date();
      return getDaysInMonth(now.getFullYear(), now.getMonth());
    }
    const [yearStr, monthStr] = selectedMonth.split('-');
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;
    if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) {
      const now = new Date();
      return getDaysInMonth(now.getFullYear(), now.getMonth());
    }
    return getDaysInMonth(year, monthIndex);
  }, [selectedMonth]);

  const dueDayOptions = useMemo(() => Array.from({ length: daysInSelectedMonth }, (_, index) => String(index + 1)), [daysInSelectedMonth]);

  const dueInsights = useMemo<DueInsights>(() => {
    const today = getStartOfToday();
    const upcoming: DueUpcomingItem[] = [];
    let overdueTotal = 0;
    let pendingTotal = 0;
    sortedExpenseKeys.forEach(item => {
      const row = editExpense[item];
      if (!row) return;
      const paid = row.paid === true || row.paid === 'true';
      if (paid) return;
      const amount = parseToNumber(row.actual);
      if (!(amount > 0)) return;
      const parsedDate = rowDueDate(row, selectedMonth);
      if (!parsedDate) {
        pendingTotal += amount;
        return;
      }
      const resolvedDueDay = resolveDueDayForMonth(row.dueDay, daysInSelectedMonth);
      const diffDays = Math.ceil((parsedDate.getTime() - today.getTime()) / DAY_IN_MS);
      if (diffDays < 0) overdueTotal += amount;
      else pendingTotal += amount;
      const resolvedIso = getValidResolvedDueDate((row as DueRowLike).resolvedDueDate);
      const crossMonthDueDate = resolvedIso && resolvedIso.slice(0, 7) !== selectedMonth ? resolvedIso : null;
      upcoming.push({ key: item, name: row.name || DEFAULT_EXPENSE_LABEL_MAP[item] || 'รายการ', date: parsedDate, diffDays, dueDay: row.dueDay, resolvedDueDay, crossMonthDueDate });
    });
    upcoming.sort((a, b) => a.date.getTime() - b.date.getTime());
    const urgentCount = upcoming.filter(item => item.diffDays >= 0 && item.diffDays <= DUE_SOON_THRESHOLD_DAYS).length;
    const overdueCount = upcoming.filter(item => item.diffDays < 0).length;
    const nextDue = upcoming[0];
    return {
      upcomingCount: upcoming.length,
      urgentCount,
      overdueCount,
      overdueTotal,
      pendingTotal,
      // แถวบัตรข้ามเดือน => วันที่เต็ม (เช่น "10 พ.ย. 2569") เหมือนช่องครบกำหนด · แถวอื่นเหมือนเดิม
      nextDueLabel: nextDue
        ? (nextDue.crossMonthDueDate ? formatIsoDateTH(nextDue.crossMonthDueDate) : nextDue.dueDay
          ? (isEndOfMonthDueDay(nextDue.dueDay) ? 'ทุกวันสิ้นเดือน' : `ทุกวันที่ ${nextDue.resolvedDueDay || nextDue.dueDay}`)
          : formatDueDateLabel(nextDue.date, { day: 'numeric', month: 'short' }))
        : 'ยังไม่กำหนด',
      nextDueName: nextDue ? nextDue.name : 'ไม่มีรายการ'
    };
  }, [daysInSelectedMonth, editExpense, selectedMonth, sortedExpenseKeys]);

  const hasExpenseRows = sortedExpenseKeys.length > 0;
  const totalActualValue = useMemo(() => calculateExpenseTotal(editExpense, 'actual', parseToNumber), [editExpense]);
  const monthDiffValue = useMemo(() => typeof previousMonthTotal !== 'number' ? null : totalActualValue - previousMonthTotal, [totalActualValue, previousMonthTotal]);
  const monthDiffPercent = useMemo(() => {
    if (typeof previousMonthTotal !== 'number') return null;
    if (previousMonthTotal === 0) return totalActualValue === 0 ? 0 : 100;
    return ((totalActualValue - previousMonthTotal) / previousMonthTotal) * 100;
  }, [totalActualValue, previousMonthTotal]);
  const monthDiffStatus = useMemo(() => {
    if (monthDiffValue === null) return 'neutral';
    if (monthDiffValue > 0) return 'negative';
    if (monthDiffValue < 0) return 'positive';
    return 'neutral';
  }, [monthDiffValue]);
  const monthDiffChipTone = monthDiffStatus === 'positive' ? 'border-pos/40 bg-pos/10 text-pos' : monthDiffStatus === 'negative' ? 'border-neg/40 bg-neg/10 text-neg' : 'border-border-default bg-surface-2 text-secondary';
  const monthDiffLabel = monthDiffValue === null ? 'ยังไม่มีข้อมูลเดือนก่อน' : monthDiffValue === 0 ? 'เท่ากับเดือนก่อน' : `${monthDiffValue > 0 ? 'เพิ่มขึ้น' : 'ลดลง'} ${formatCurrency(Math.abs(monthDiffValue))}`;
  const monthDiffPercentText = monthDiffPercent === null ? 'เปรียบเทียบไม่ได้' : `${monthDiffPercent > 0 ? '+' : ''}${monthDiffPercent.toFixed(1)}%`;
  const totalUnpaidValue = useMemo(() => sortedExpenseKeys.reduce((sum, key) => {
    const row = editExpense[key] || {};
    const paid = row.paid === true || row.paid === 'true';
    if (paid) return sum;
    return sum + parseToNumber(row.actual);
  }, 0), [editExpense, sortedExpenseKeys]);
  const accountBreakdown = useMemo(() => getAccountBreakdown(editExpense, bankAccounts, { parseAmount: parseToNumber }), [editExpense, bankAccounts]);
  const prevAccountBreakdown = useMemo(() => getAccountBreakdown(prevExpenseValues, bankAccounts, { parseAmount: parseToNumber }), [prevExpenseValues, bankAccounts]);
  const prevMonthKey = useMemo(() => getPreviousMonthKey(selectedMonth) as MonthKey | null, [selectedMonth]);
  // DD-6: ยอดค้างเดือนก่อน derive จาก breakdown เดียวกับตาราง (กฎ paid/บัญชีมีที่เดียว)
  const prevMonthUnpaid = useMemo<PreviousMonthUnpaid | null>(() => {
    if (!prevMonthKey) return null;
    const unpaidItems = Object.values(prevAccountBreakdown).flatMap(bucket => bucket.items).filter(item => item.amount > 0);
    const unpaidTotal = unpaidItems.reduce((sum, item) => sum + item.amount, 0);
    return unpaidTotal > 0 ? { total: unpaidTotal, count: unpaidItems.length, monthKey: prevMonthKey } : null;
  }, [prevAccountBreakdown, prevMonthKey]);
  const upcomingSummaryText = dueInsights.upcomingCount > 0 ? `${dueInsights.upcomingCount} รายการยังไม่จ่าย` : 'ยังไม่มีรายการค้างชำระ';
  // บริบทแถวคำนวณจากทุกแถว (ไม่ใช่เฉพาะที่ผ่าน filter) ลำดับ "รายการที่ N" จึงไม่เปลี่ยนตาม filter/เรียงลำดับ
  const rowContextByKey = useMemo(() => {
    const contexts = buildRowContexts(sortedExpenseKeys.map(key => editExpense[key]?.name ?? DEFAULT_EXPENSE_LABEL_MAP[key] ?? 'รายการใหม่'));
    return new Map(sortedExpenseKeys.map((key, index) => [key, contexts[index]]));
  }, [editExpense, sortedExpenseKeys]);
  const fieldLabel = (purpose: string, key: string) => financialFieldLabel(purpose, rowContextByKey.get(key) ?? 'รายการค่าใช้จ่าย');

  return (
    <div>
      <span role="status" aria-live="polite" className="sr-only">{pendingPaidKeys.length > 0 ? 'กำลังบันทึกสถานะการจ่าย' : ''}</span>
      <div className="mb-space-4 flex flex-wrap items-start justify-between gap-space-3">
        <div><h3 ref={expenseListFallbackRef} tabIndex={-1} className="text-lg font-medium text-primary">รายการค่าใช้จ่าย</h3><p className="mt-space-1 text-sm text-secondary">บันทึกยอดค่าใช้จ่ายรายเดือนแบบยอดเดียว</p></div>
        <div className="flex shrink-0 flex-wrap gap-space-2">
          {hasOpenSavingsLoan && (
            <button
              type="button"
              ref={repayButtonRef}
              className={`min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary hover:bg-surface-3 ${FOCUS_RING}`}
              onClick={() => setRepaymentDialogOpen(true)}
            >
              คืนเงินกู้ (เงินออม)
            </button>
          )}
          <button type="button" ref={addExpenseButtonRef} className="min-h-11 shrink-0 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" onClick={handleAddExpenseItem}>+ เพิ่มรายการค่าใช้จ่าย</button>
        </div>
      </div>

      {hasExpenseRows && (
        <div className="mb-space-5 grid grid-cols-1 gap-space-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className={CARD}>
            <p className="text-xs text-secondary">ยอดค่าใช้จ่ายรวม</p><p className="mt-space-1 font-[family-name:var(--font-numeric)] text-2xl font-semibold tabular-nums text-primary">{formatCurrency(totalActualValue)}</p>
            <p className="mt-space-1 text-xs text-tertiary">{typeof previousMonthTotal === 'number' ? `เทียบเดือนก่อน ${monthDiffLabel} (เดือนก่อน ${formatCurrency(previousMonthTotal)})` : 'สรุปยอดค่าใช้จ่ายทั้งหมดในเดือนนี้'}</p>
            <span className={`mt-space-2 inline-flex w-fit items-center rounded-full border px-space-2 py-[2px] text-xs font-medium ${monthDiffChipTone}`}>เปลี่ยนแปลง {monthDiffPercentText}</span>
          </div>
          <div className={`${CARD} border-info/30`}>
            <p className="text-xs text-secondary">กำหนดชำระถัดไป</p><p className="mt-space-1 text-lg font-semibold text-primary">{dueInsights.nextDueLabel}</p><p className="mt-space-1 text-xs text-tertiary">{dueInsights.nextDueName}</p>
            <div className="mt-space-2 flex flex-wrap gap-space-2"><span className="inline-flex items-center rounded-full border border-neg/40 bg-neg/10 px-space-2 py-[2px] text-xs font-medium text-neg">เลยกำหนด {formatCurrency(dueInsights.overdueTotal)}</span><span className="inline-flex items-center rounded-full border border-border-default bg-surface-2 px-space-2 py-[2px] text-xs font-medium text-secondary">ยังไม่ถึงกำหนด {formatCurrency(dueInsights.pendingTotal)}</span></div>
            <div className="mt-space-2 flex flex-wrap gap-space-2 text-xs text-secondary"><span>{upcomingSummaryText}</span>{dueInsights.urgentCount > 0 && <span className="font-medium text-warn">เร่งด่วน {dueInsights.urgentCount}</span>}{dueInsights.overdueCount > 0 && <span className="font-medium text-neg">เกินกำหนด {dueInsights.overdueCount}</span>}</div>
          </div>
          {prevMonthUnpaid && <div className={`${CARD} border-warn/30`}><p className="text-xs text-secondary">ค้างจ่ายเดือนก่อน</p><p className="mt-space-1 text-lg font-semibold text-warn">{formatCurrency(prevMonthUnpaid.total)}</p><p className="mt-space-1 text-xs text-tertiary">{formatMonthKeyTH(prevMonthUnpaid.monthKey)} · {prevMonthUnpaid.count} รายการ</p><span className="mt-space-2 inline-flex w-fit items-center rounded-full border border-neg/40 bg-neg/10 px-space-2 py-[2px] text-xs font-medium text-neg">ยังไม่ได้ชำระ</span></div>}
        </div>
      )}

      {isLoading && !hasExpenseRows && <LoadingNotice />}

      {!isLoading && (
        <ListToolbar
          label="รายการค่าใช้จ่าย"
          criteria={criteria}
          onChange={setCriteria}
          orders={orders}
          filters={[
            { key: 'account', label: 'บัญชี', options: accountOptions },
            { key: 'paid', label: 'สถานะ', options: [{ value: 'unpaid', label: 'ยังไม่ชำระ' }, { value: 'paid', label: 'ชำระแล้ว' }] },
            { key: 'kind', label: 'ประเภท', options: [{ value: 'ordinary', label: 'รายการทั่วไป' }, { value: 'installment', label: 'ผ่อนชำระ' }, { value: 'revolving', label: 'ยอดบัตรเครดิต' }] },
            { key: 'due', label: 'ครบกำหนด', options: [{ value: 'overdue', label: 'เลยกำหนด' }, { value: 'today', label: 'วันนี้' }, { value: 'future', label: 'ในอนาคต' }, { value: 'undated', label: 'ไม่ระบุวัน' }] },
          ]}
          visible={expenseProjection.items.length}
          total={sortedExpenseKeys.length}
          changed={expenseProjection.changed}
          onRefresh={expenseProjection.refresh}
          pinned={expenseProjection.pinnedIds.size}
        />
      )}

      {hasExpenseRows && (
        <>
          {expenseProjection.items.length > 0 && <>
          <div className="hidden overflow-x-auto rounded-md border border-border-default md:block">
            <table className="w-full border-collapse">
              <thead><tr className="border-b border-border-subtle bg-surface-2"><th className="p-space-3 text-left text-xs font-medium text-secondary">รายการค่าใช้จ่าย</th><th className="p-space-3 text-right text-xs font-medium text-secondary">ยอดค่าใช้จ่าย</th><th className="p-space-3 text-left text-xs font-medium text-secondary">บัญชีที่ใช้จ่าย</th><th className="p-space-3 text-left text-xs font-medium text-secondary">วันครบกำหนด</th><th className="p-space-3 text-center text-xs font-medium text-secondary">สถานะชำระ</th></tr></thead>
              <tbody>
                {expenseProjection.items.map(item => {
                  const row = editExpense[item] || {};
                  const paid = row.paid === true || row.paid === 'true';
                  const displayName = row.name ?? DEFAULT_EXPENSE_LABEL_MAP[item] ?? 'รายการใหม่';
                  const selectedAccount = typeof row.account === 'string' && row.account.trim().length > 0 ? row.account : bankAccounts[0] || 'ไม่ระบุบัญชี';
                  const dueInfo = describeDueTiming(row, paid, selectedMonth, parseToNumber(row.actual));
                  const isCreditCardRow = isCreditCardRowKey(item);
                  const isRepaymentRow = isSavingsLoanRepaymentRowKey(item);
                  const meta = installmentMeta[item];
                  if (isCreditCardRow) {
                    return <Fragment key={item}>
                      {item === firstCreditCardKey && <tr><td className="border-t border-dashed border-border-default p-space-3 text-xs font-medium text-tertiary" colSpan={5}>{cardGroupLabel}</td></tr>}
                      <tr className="border-b border-border-subtle bg-info/5" data-expense-key={item}>
                        <td className="p-space-3 align-middle"><span className="flex items-center gap-space-2 text-secondary" title={displayName}><span aria-hidden="true">🔒</span>{displayName}</span>{cycleCaption(row)}{meta && <div className="mt-space-1 flex flex-col gap-space-1"><span className="inline-flex w-fit items-center gap-1 rounded-full border border-info/35 bg-info/15 px-space-2 py-[2px] text-xs font-medium text-info">💳 {meta.cardName}</span><Link href={`/credits?card=${meta.cardId}`} className={`inline-flex min-h-11 items-center text-xs text-accent underline-offset-2 hover:underline ${FOCUS_RING}`}>จัดการที่หน้าบัตร & สินเชื่อ →</Link></div>}</td>
                        <td className="p-space-3 text-right align-middle"><div className="flex flex-col items-end"><span className="font-[family-name:var(--font-numeric)] tabular-nums text-secondary">{formatCurrency(row.actual)}</span>{cardDetails(item, row, meta)}</div></td><td className="p-space-3 align-middle text-secondary">{selectedAccount}</td><td className="p-space-3 align-middle text-secondary">{formatRowDueText(row, selectedMonth) || 'ไม่ระบุ'}</td>
                        <td className="p-space-3 text-center align-middle"><button type="button" className={`mx-auto flex h-11 items-center gap-space-2 rounded-full border px-space-3 text-xs font-semibold ${FOCUS_RING} ${paid ? 'border-pos/40 bg-pos/15 text-pos' : 'border-border-interactive bg-surface-2 text-secondary'}`} onClick={() => handleTogglePaid(item)} disabled={pendingPaidKeys.includes(item)} aria-busy={pendingPaidKeys.includes(item)} aria-pressed={paid}>{paid ? '✓ จ่ายแล้ว' : '○ ยังไม่จ่าย'}</button></td>
                      </tr>
                    </Fragment>;
                  }
                  // S5 UX_SPEC §5.5: แถวคืนเงินกู้ — อ่านอย่างเดียวทั้งหมด ไม่มี input/ปุ่มลบ/ปุ่มสลับ paid (D-SLW-15, C-S5-3)
                  if (isRepaymentRow) {
                    return <Fragment key={item}>
                      {item === firstRepaymentKey && <tr><td className="border-t border-dashed border-border-default p-space-3 text-xs font-medium text-tertiary" colSpan={5}>คืนเงินกู้ (เงินออม) · แก้ไข/ลบไม่ได้</td></tr>}
                      <tr className="border-b border-border-subtle bg-info/5" data-expense-key={item}>
                        <td className="p-space-3 align-middle">
                          <span className="flex items-center gap-space-2 text-secondary" title={displayName}><span aria-hidden="true">🔒</span>{displayName}</span>
                          <div className="mt-space-1 flex flex-col gap-space-1">
                            <span className="inline-flex w-fit items-center gap-1 rounded-full border border-info/35 bg-info/15 px-space-2 py-[2px] text-xs font-medium text-info">คืนเงินกู้ (เงินออม)</span>
                            <Link href="/workspace/savings#savings-ledger" className={`inline-flex min-h-11 items-center text-xs text-accent underline-offset-2 hover:underline ${FOCUS_RING}`}>ดูรายการยืมที่หน้าเงินออม →</Link>
                          </div>
                        </td>
                        <td className="p-space-3 text-right align-middle"><span className="font-[family-name:var(--font-numeric)] tabular-nums text-secondary">{formatCurrency(row.actual)}</span></td>
                        <td className="p-space-3 align-middle text-secondary">{selectedAccount}</td>
                        <td className="p-space-3 align-middle text-secondary">{formatRowDueText(row, selectedMonth) || 'ไม่ระบุ'}</td>
                        <td className="p-space-3 text-center align-middle"><span className="inline-flex items-center gap-space-2 text-xs font-semibold text-pos" aria-label="จ่ายแล้ว (แก้ไขไม่ได้)">✓ จ่ายแล้ว</span></td>
                      </tr>
                    </Fragment>;
                  }
                  return <tr key={item} className={`border-b border-border-subtle last:border-b-0 [scroll-margin-top:calc(var(--topbar-safe-top,90px)+8px)] ${arrivalFocusKey === item ? 'focus:outline-none' : ''} ${arrivalHighlightKey === item ? 'outline outline-2 outline-accent -outline-offset-2' : ''}`} data-expense-key={item} tabIndex={arrivalFocusKey === item ? -1 : undefined}>
                    <td className="p-space-3 align-middle"><div className="flex min-w-0 items-center gap-space-3"><input type="text" value={String(displayName)} onChange={event => handleExpenseChange(item, 'name', event.target.value)} onBlur={event => handleExpenseBlur(item, 'name', event.target.value)} className={`${INPUT} flex-1`} placeholder="ชื่อรายการ" /><button type="button" className={REMOVE_BTN} onClick={() => handleDeleteExpenseItem(item)} aria-label={`ลบ ${displayName}`}><Icons.X size={16} /></button></div></td>
                    <td className="p-space-3 align-middle"><input type="text" inputMode="decimal" value={String(row.actual ?? '')} onChange={event => handleNumberInput(event.target.value, value => handleExpenseChange(item, 'actual', value))} onBlur={event => handleNumberBlur(event.target.value, value => handleExpenseBlur(item, 'actual', value))} onFocus={handleAmountInputFocus} aria-label={fieldLabel('จำนวนเงินรายจ่าย', item)} className={`${INPUT} text-right font-[family-name:var(--font-numeric)] tabular-nums`} /></td>
                    <td className="p-space-3 align-middle"><select value={selectedAccount} onChange={event => handleExpenseChange(item, 'account', event.target.value)} aria-label={fieldLabel('บัญชีที่ใช้จ่าย', item)} className={SELECT}>{bankAccounts.map(account => <option key={account} value={account}>{account}</option>)}</select></td>
                    <td className="min-w-[150px] p-space-3 align-middle"><div className="flex flex-col gap-space-2"><select value={String(row.dueDay || END_OF_MONTH_DUE_DAY)} onChange={event => handleExpenseChange(item, 'dueDay', event.target.value)} aria-label={fieldLabel('วันครบกำหนด', item)} className={SELECT}><option value={END_OF_MONTH_DUE_DAY}>วันสิ้นเดือน</option>{dueDayOptions.map(day => <option key={day} value={day}>{day}</option>)}</select><div className="flex flex-wrap items-center gap-space-2"><DueBadge status={dueInfo.status}>{dueInfo.badge}</DueBadge>{dueInfo.helper && <span className="text-xs text-tertiary">{dueInfo.helper}</span>}</div></div></td>
                    <td className="p-space-3 text-center align-middle"><button type="button" className={`mx-auto flex h-11 items-center gap-space-2 rounded-full border px-space-3 text-xs font-semibold ${FOCUS_RING} ${paid ? 'border-pos/40 bg-pos/15 text-pos' : 'border-border-interactive bg-surface-2 text-secondary'}`} onClick={() => handleTogglePaid(item)} disabled={pendingPaidKeys.includes(item)} aria-busy={pendingPaidKeys.includes(item)} aria-pressed={paid}>{paid ? '✓ จ่ายแล้ว' : '○ ยังไม่จ่าย'}</button></td>
                  </tr>;
                })}
                <tr className="bg-surface-2"><td className="p-space-3 text-sm font-semibold text-primary">ยอดรวม</td><td className="p-space-3 text-right font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums text-primary">{formatCurrency(totalActualValue)}</td><td className="p-space-3" /><td className="p-space-3 text-sm font-semibold text-secondary">รวมค้างชำระ</td><td className="p-space-3 text-center font-[family-name:var(--font-numeric)] text-sm font-semibold tabular-nums text-neg">{formatCurrency(totalUnpaidValue)}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-space-3 md:hidden">
            {expenseProjection.items.map(item => {
              const row = editExpense[item] || {};
              const paid = row.paid === true || row.paid === 'true';
              const displayName = row.name ?? DEFAULT_EXPENSE_LABEL_MAP[item] ?? 'รายการใหม่';
              const selectedAccount = typeof row.account === 'string' && row.account.trim().length > 0 ? row.account : bankAccounts[0] || 'ไม่ระบุบัญชี';
              const dueInfo = describeDueTiming(row, paid, selectedMonth, parseToNumber(row.actual));
              const isCreditCardRow = isCreditCardRowKey(item);
              const isRepaymentRow = isSavingsLoanRepaymentRowKey(item);
              const meta = installmentMeta[item];
              if (isCreditCardRow) {
                return <Fragment key={item}>{item === firstCreditCardKey && <p className="mt-space-2 text-xs font-medium text-tertiary">{cardGroupLabel}</p>}<div className={`min-h-14 rounded-md border border-info/30 bg-surface-2 p-space-4 [scroll-margin-top:calc(var(--topbar-safe-top,90px)+8px)] ${paid ? 'opacity-70' : ''}`} data-expense-key={item}>
                  <div className="flex items-center justify-between gap-space-2"><span className="flex items-center gap-space-2 font-medium text-secondary" title={displayName}><span aria-hidden="true">🔒</span>{displayName}</span><span className="inline-flex w-fit shrink-0 items-center gap-1 rounded-full border border-info/35 bg-info/15 px-space-2 py-[2px] text-xs font-medium text-info">{cardRowTypeLabel(row)}</span></div>
                  {cycleCaption(row)}
                  {meta &&<span className="mt-space-1 inline-flex w-fit items-center gap-1 text-xs text-tertiary">💳 {meta.cardName}</span>}
                  <p className="mt-space-2 font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums text-primary">{formatCurrency(row.actual)}</p><p className="mt-space-1 text-xs text-secondary">{`ครบกำหนด ${formatRowDueText(row, selectedMonth) || 'ไม่ระบุ'} · ${selectedAccount}`}</p>
                  <button type="button" className={`mt-space-3 flex min-h-11 w-full items-center justify-center rounded-sm border px-space-4 text-sm font-semibold ${FOCUS_RING} ${paid ? 'border-pos/40 bg-pos/15 text-pos' : 'border-border-interactive bg-surface-1 text-secondary'}`} onClick={() => handleTogglePaid(item)} disabled={pendingPaidKeys.includes(item)} aria-busy={pendingPaidKeys.includes(item)} aria-pressed={paid}>{paid ? '✓ ชำระแล้ว' : 'ยังไม่ชำระ — แตะเพื่อยืนยัน'}</button>
                  {cardDetails(item, row, meta)}
                  {meta && <Link href={`/credits?card=${meta.cardId}`} className={`mt-space-2 inline-flex min-h-11 items-center text-xs text-accent underline-offset-2 hover:underline ${FOCUS_RING}`}>จัดการที่หน้าบัตร & สินเชื่อ →</Link>}
                </div></Fragment>;
              }
              // S5 UX_SPEC §5.5: มือถือ — เหมือนเดสก์ท็อป อ่านอย่างเดียวทั้งหมด ไม่มี input/ปุ่มลบ/ปุ่มสลับ paid
              if (isRepaymentRow) {
                return <Fragment key={item}>
                  {item === firstRepaymentKey && <p className="mt-space-2 text-xs font-medium text-tertiary">คืนเงินกู้ (เงินออม) · แก้ไข/ลบไม่ได้</p>}
                  <div className="min-h-14 rounded-md border border-info/30 bg-surface-2 p-space-4 opacity-70 [scroll-margin-top:calc(var(--topbar-safe-top,90px)+8px)]" data-expense-key={item}>
                    <div className="flex flex-wrap items-center justify-between gap-space-2">
                      <span className="flex min-w-0 flex-[1_1_12rem] items-center gap-space-2 font-medium text-secondary" title={displayName}><span aria-hidden="true">🔒</span><span className="min-w-0 break-words">{displayName}</span></span>
                      <span className="inline-flex w-fit shrink-0 items-center gap-1 rounded-full border border-info/35 bg-info/15 px-space-2 py-[2px] text-xs font-medium text-info">คืนเงินกู้ (เงินออม)</span>
                    </div>
                    <p className="mt-space-2 font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums text-primary">{formatCurrency(row.actual)}</p>
                    <p className="mt-space-1 text-xs text-secondary">{`ครบกำหนด ${formatRowDueText(row, selectedMonth) || 'ไม่ระบุ'} · ${selectedAccount}`}</p>
                    <span className="mt-space-3 flex min-h-11 w-full items-center justify-center text-sm font-semibold text-pos" aria-label="จ่ายแล้ว (แก้ไขไม่ได้)">✓ จ่ายแล้ว</span>
                    <Link href="/workspace/savings#savings-ledger" className={`mt-space-2 inline-flex min-h-11 items-center text-xs text-accent underline-offset-2 hover:underline ${FOCUS_RING}`}>ดูรายการยืมที่หน้าเงินออม →</Link>
                  </div>
                </Fragment>;
              }
              return <div className={`min-h-14 rounded-md border border-border-default bg-surface-2 p-space-4 [scroll-margin-top:calc(var(--topbar-safe-top,90px)+8px)] ${paid ? 'opacity-70' : ''} ${arrivalFocusKey === item ? 'focus:outline-none' : ''} ${arrivalHighlightKey === item ? 'outline outline-2 outline-accent outline-offset-2' : ''}`} key={item} data-expense-key={item} tabIndex={arrivalFocusKey === item ? -1 : undefined}>
                <div className="flex items-center gap-space-2"><input type="text" value={String(displayName)} onChange={event => handleExpenseChange(item, 'name', event.target.value)} onBlur={event => handleExpenseBlur(item, 'name', event.target.value)} className={`${INPUT} flex-1 font-medium`} placeholder="ชื่อรายการ" /><button type="button" className={REMOVE_BTN} onClick={() => handleDeleteExpenseItem(item)} aria-label={`ลบ ${displayName}`}><Icons.X size={16} /></button></div>
                <input type="text" inputMode="decimal" value={String(row.actual ?? '')} onChange={event => handleNumberInput(event.target.value, value => handleExpenseChange(item, 'actual', value))} onBlur={event => handleNumberBlur(event.target.value, value => handleExpenseBlur(item, 'actual', value))} onFocus={handleAmountInputFocus} aria-label={fieldLabel('จำนวนเงินรายจ่าย', item)} className={`${INPUT} mt-space-3 text-right font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums`} placeholder="0.00" />
                <div className="mt-space-3 flex gap-space-2"><select value={selectedAccount} onChange={event => handleExpenseChange(item, 'account', event.target.value)} aria-label={fieldLabel('บัญชีที่ใช้จ่าย', item)} className={`${SELECT} flex-1`}>{bankAccounts.map(account => <option key={account} value={account}>{account}</option>)}</select><select value={String(row.dueDay || END_OF_MONTH_DUE_DAY)} onChange={event => handleExpenseChange(item, 'dueDay', event.target.value)} aria-label={fieldLabel('วันครบกำหนด', item)} className={`${SELECT} flex-1`}><option value={END_OF_MONTH_DUE_DAY}>สิ้นเดือน</option>{dueDayOptions.map(day => <option key={day} value={day}>วันที่ {day}</option>)}</select></div>
                {dueInfo.helper && <p className="mt-space-2 text-xs text-tertiary">{dueInfo.helper}</p>}
                <button type="button" className={`mt-space-3 flex min-h-11 w-full items-center justify-center rounded-sm border px-space-4 text-sm font-semibold ${FOCUS_RING} ${paid ? 'border-pos/40 bg-pos/15 text-pos' : 'border-border-interactive bg-surface-1 text-secondary'}`} onClick={() => handleTogglePaid(item)} disabled={pendingPaidKeys.includes(item)} aria-busy={pendingPaidKeys.includes(item)} aria-pressed={paid}>{paid ? '✓ ชำระแล้ว' : 'ยังไม่ชำระ — แตะเพื่อยืนยัน'}</button>
              </div>;
            })}
            <div className={`${CARD} border-accent/40 bg-accent-muted`}><div className="flex items-center justify-between text-sm"><span className="text-secondary">ยอดค่าใช้จ่าย</span><span className="font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-primary">{formatCurrency(totalActualValue)}</span></div><div className="mt-space-2 flex items-center justify-between text-sm"><span className="text-secondary">ยอดค้างชำระ</span><span className="font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-neg">{formatCurrency(totalUnpaidValue)}</span></div></div>
          </div>
          </>}

          {shouldShowAccountTable && <div className="mt-space-5"><BankAccountTable accountBreakdown={accountBreakdown} prevAccountBreakdown={prevAccountBreakdown} accounts={bankAccounts} monthKey={selectedMonth ?? null} prevMonthKey={prevMonthKey} /></div>}
        </>
      )}
      {!isLoading && !hasExpenseRows && <div className="rounded-md border border-dashed border-border-default bg-sunken p-space-4 text-sm text-secondary">ยังไม่มีรายการค่าใช้จ่ายในเดือนนี้ กด &quot;เพิ่มรายการ&quot; เพื่อเริ่มต้น</div>}
      {showSelectedCardDetails && selectedCardDetails && selectedCardDetailsRow?.breakdown && selectedCardDetailsMeta && (
        <CardExpenseDetailsDialog
          cardId={selectedCardDetails.cardId}
          cardName={selectedCardDetailsMeta.cardName}
          month={getRowCycleMonth(selectedCardDetailsRow) ?? selectedCardDetails.month}
          total={selectedCardDetailsRow.actual}
          breakdown={selectedCardDetailsRow.breakdown}
          opener={cardDetailsOpenerRef.current}
          fallback={expenseListFallbackRef.current}
          onClose={() => setSelectedCardDetails(null)}
        />
      )}
      {cardPayment && <CardTotalPaymentDialog
        row={{ name: cardPayment.row.name || 'บัตรเครดิต', breakdown: cardPayment.row.breakdown }}
        paid={cardPayment.paid}
        busy={pendingPaidKeys.includes(cardPayment.key)}
        onCancel={() => setCardPayment(null)}
        onConfirm={confirmCardPayment}
      />}
      {repaymentDialogOpen && selectedMonth && (
        // S5 fix (F-S5-2, same shape as S4's F-S4-3): stop onInput/onChange from bubbling into WorkspaceShell's
        // dirty-tracking container (WorkspaceShell.tsx:402). The dialog persists on its own confirm button
        // (expenseAPI.repayLoan), so typing an amount or ticking the checkbox then cancelling must never mark a
        // clean page dirty. Pattern copied from SavingsLedgerPanel.tsx:79-86.
        <div onInput={event => event.stopPropagation()} onChange={event => event.stopPropagation()}>
          <SavingsLoanRepaymentDialog
            open={repaymentDialogOpen}
            month={selectedMonth}
            bankAccounts={bankAccounts}
            onClose={closeRepaymentDialog}
            onSaved={handleRepaymentSaved}
          />
        </div>
      )}
    </div>
  );
}