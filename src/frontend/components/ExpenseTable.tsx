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
  getAccountSummary,
  handleNumberInput,
  handleNumberBlur,
  DEFAULT_EXPENSE_ITEMS
} from '../../shared/utils/frontend/numberUtils';
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
import { isCreditCardRowKey, isRevolvingRowKey, buildRevolvingRowKey } from '../../shared/utils/creditCardUtils';
import { toBankAccountNames } from '../../shared/utils/bankAccountShape';
import { compareListValues, matchesListQuery } from '../../shared/utils/frontend/listView';
import { useListProjection } from '../../shared/utils/frontend/useListProjection';
import BankAccountTable from './BankAccountTable';
import LoadingNotice from './LoadingNotice';
import ListToolbar from './ListToolbar';
import { expenseAPI, creditCardAPI } from '../../shared/utils/frontend/apiUtils';
import { useSession } from '../contexts/SessionContext';
import { useListCriteria } from '../contexts/ListViewContext';
import { showToast } from '../../shared/utils/frontend/toast';
import { Icons } from './Icons';
import CardTotalPaymentDialog from './CardTotalPaymentDialog';
import type { CardTotalExpenseRow } from '../../shared/utils/backend/creditCardSync';

type ExpenseRow = ExpenseItem & { [field: string]: unknown; dueDate?: unknown; breakdown?: CardTotalExpenseRow['breakdown'] };
type ExpenseValues = Record<string, ExpenseRow>;
type DueStatus = 'overdue' | 'dueToday' | 'dueSoon' | 'future' | 'done' | 'none';

interface ExpenseTableProps {
  selectedMonth: MonthKey | null | undefined;
  onRegisterSave?: (handler: (() => Promise<void>) | null) => void;
  onSaved?: () => void;
  markDirty?: () => void;
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

const formatDueDayText = (dueDayValue: unknown): string => {
  if (isEndOfMonthDueDay(dueDayValue)) return 'วันสิ้นเดือน';
  return dueDayValue ? `วันที่ ${String(dueDayValue)}` : '';
};

const describeDueTiming = (
  dueDayValue: unknown,
  paid: boolean,
  monthKey: MonthKey | null | undefined,
  amount: number
): DueTiming => {
  const parsedDate = getDueDateFromDay(dueDayValue, monthKey as MonthKey);
  const dueDayText = formatDueDayText(dueDayValue);
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

export default function ExpenseTable({ selectedMonth, onRegisterSave, onSaved, markDirty }: ExpenseTableProps) {
  const [editExpense, setEditExpense] = useState<ExpenseValues>({});
  const [bankAccounts, setBankAccounts] = useState<string[]>([]);
  const [previousMonthTotal, setPreviousMonthTotal] = useState<number | null>(null);
  const [prevMonthUnpaid, setPrevMonthUnpaid] = useState<PreviousMonthUnpaid | null>(null);
  const [prevAccountSummary, setPrevAccountSummary] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [persistedKeys, setPersistedKeys] = useState<string[]>([]);
  const [pendingScrollKey, setPendingScrollKey] = useState<string | null>(null);
  const [pendingPaidKeys, setPendingPaidKeys] = useState<string[]>([]);
  const [cardPayment, setCardPayment] = useState<{ key: string; month: string; paid: boolean; row: ExpenseRow & { breakdown: CardTotalExpenseRow['breakdown'] } } | null>(null);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const selectedMonthRef = useRef(selectedMonth);
  selectedMonthRef.current = selectedMonth;
  useEffect(() => {
    setCardPayment(null);
    setExpandedCards(new Set());
  }, [selectedMonth]);
  const pendingPaidRef = useRef<Set<string>>(new Set());
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
      target.querySelector<HTMLInputElement>('input[type="text"]')?.focus({ preventScroll: true });
      return true;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!tryScroll()) {
      timer = setTimeout(() => {
        if (tryScroll()) setPendingScrollKey(null);
      }, 80);
      return () => { if (timer) clearTimeout(timer); };
    }
    setPendingScrollKey(null);
    return () => { if (timer) clearTimeout(timer); };
  }, [editExpense, pendingScrollKey]);

  useEffect(() => {
    if (!selectedMonth) {
      setEditExpense({});
      setBankAccounts([]);
      setPersistedKeys([]);
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
      })
      .catch(error => {
        console.error('Error loading expense data:', error);
        const formatted = formatExpenseData({}, selectedMonth);
        setEditExpense(formatted.values as ExpenseValues || {});
        setBankAccounts(toBankAccountNames(currentUser?.bankAccounts));
        setPersistedKeys(formatted.persistedKeys || []);
      })
      .finally(() => {
        setExpenseLoadRevision(revision => revision + 1);
        setIsLoading(false);
      });
  }, [selectedMonth, currentUser?.bankAccounts]);

  useEffect(() => {
    if (!selectedMonth || !currentUser?.id) {
      setInstallmentMeta({});
      return undefined;
    }
    let cancelled = false;
    Promise.all([
      creditCardAPI.getMonthInstallments(selectedMonth),
      creditCardAPI.getRevolving({ month: selectedMonth }).catch(() => null)
    ]).then(([items, revolving]) => {
      if (cancelled) return;
      const map: Record<string, InstallmentMetadata> = {};
      items.forEach((item: InstallmentMetadata) => {
        map[item.key] = item;
        map[buildRevolvingRowKey(item.cardId)] = item;
      });
      (Array.isArray(revolving?.cycles) ? revolving.cycles : []).forEach((cycle: InstallmentMetadata) => {
        if (!cycle?.key) return;
        map[cycle.key] = { key: cycle.key, cardId: cycle.cardId, cardName: cycle.cardName, cardColor: cycle.cardColor };
      });
      setInstallmentMeta(map);
    });
    return () => { cancelled = true; };
  }, [selectedMonth, currentUser?.id]);

  useEffect(() => {
    if (!selectedMonth) {
      setPreviousMonthTotal(null);
      return;
    }
    const previousMonthKey = getPreviousMonthKey(selectedMonth);
    if (!previousMonthKey) {
      setPreviousMonthTotal(null);
      return;
    }
    expenseAPI.getByMonth(previousMonthKey)
      .then(data => {
        const previousFormatted = formatExpenseData(data || {}, previousMonthKey);
        const previousValues = previousFormatted.values || {};
        const previousTotal = calculateExpenseTotal(previousValues as unknown as Record<string, Record<string, unknown> | undefined>, 'actual', parseToNumber);
        setPreviousMonthTotal(previousTotal);
        const unpaidItems = Object.values(previousValues).filter(row => {
          if (!row || typeof row !== 'object') return false;
          if (row.paid === true || row.paid === 'true') return false;
          return parseToNumber(row.actual) > 0;
        });
        const unpaidTotal = unpaidItems.reduce((sum, row) => sum + parseToNumber(row.actual), 0);
        setPrevMonthUnpaid(unpaidTotal > 0 ? { total: unpaidTotal, count: unpaidItems.length, monthKey: previousMonthKey } : null);
        setPrevAccountSummary(getAccountSummary(previousValues, bankAccounts));
      })
      .catch(() => {
        setPreviousMonthTotal(null);
        setPrevMonthUnpaid(null);
        setPrevAccountSummary({});
      });
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
    const uniqueKey = `custom_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
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
      setCardPayment({ key: item, month: selectedMonth, paid: nextPaid, row: { ...row, breakdown: row.breakdown } });
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
    const { key, month, paid } = cardPayment;
    setPendingPaid(key, true);
    try {
      await expenseAPI.setPaid(month, key, paid, undefined, action);
      const data = await expenseAPI.getByMonth(month);
      const formatted = formatExpenseData(data || {}, month);
      if (selectedMonthRef.current === month) setEditExpense(previous => {
        const refreshed = formatted.values as ExpenseValues;
        const next = { ...previous };
        Object.keys(next).filter(isCreditCardRowKey).forEach(item => { delete next[item]; });
        Object.entries(refreshed).filter(([item]) => isCreditCardRowKey(item)).forEach(([item, row]) => { next[item] = row; });
        return next;
      });
      setCardPayment(null);
      onSaved?.();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'บันทึกสถานะบัตรไม่สำเร็จ กรุณาโหลดข้อมูลใหม่', 'error');
    } finally {
      setPendingPaid(key, false);
    }
  };

  const cardDetails = (item: string, row: ExpenseRow, view: 'desktop' | 'mobile') => {
    if (!row.breakdown) return null;
    const id = `card-breakdown-${view}-${item}`;
    const expanded = expandedCards.has(item);
    return <div className="mt-space-2 text-sm text-secondary">
      <button type="button" className={`min-h-11 underline ${FOCUS_RING}`} aria-expanded={expanded} aria-controls={id} onClick={() => setExpandedCards(previous => {
        const next = new Set(previous);
        if (next.has(item)) next.delete(item); else next.add(item);
        return next;
      })}>รายละเอียดบัตร</button>
      <div id={id} hidden={!expanded}>
        {row.breakdown.installments.map(line => <p key={line.key}>{line.name} · {formatCurrency(line.amount)} ฿ · {line.paid ? 'ชำระแล้ว' : 'ยังไม่ชำระ'}</p>)}
        <p>ไม่ผ่อน {formatCurrency(row.breakdown.revolving.newSpend)} ฿</p>
        {row.breakdown.revolving.paymentAction === 'minimum' && <p>ชำระขั้นต่ำ {formatCurrency(row.breakdown.revolving.minPaymentDue)} ฿</p>}
      </div>
    </div>;
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
    const customKeys = keys.filter(key => !DEFAULT_EXPENSE_KEY_ORDER.includes(key) && !isCreditCardRowKey(key));
    return [...defaultKeys, ...customKeys, ...revolvingKeys, ...installmentKeys];
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
        const date = getDueDateFromDay(row.dueDay, selectedMonth as MonthKey);
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
        const due = (row: ExpenseRow) => getDueDateFromDay(row.dueDay, selectedMonth as MonthKey)?.getTime() ?? null;
        return compareListValues(due(aRow), due(bRow), descending);
      }
      return 0;
    },
    group: key => isCreditCardRowKey(key) ? 'credit' : 'ordinary',
    criteriaKey: JSON.stringify(criteria),
    datasetKey: `${selectedMonth ?? ''}:${isLoading ? 'loading' : 'ready'}:${expenseLoadRevision}`,
    editable: true,
  });
  const firstCreditCardKey = useMemo(() => expenseProjection.items.find(key => isCreditCardRowKey(key)) || null, [expenseProjection.items]);

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
      const parsedDate = getDueDateFromDay(row.dueDay, selectedMonth as MonthKey);
      if (!parsedDate) {
        pendingTotal += amount;
        return;
      }
      const resolvedDueDay = resolveDueDayForMonth(row.dueDay, daysInSelectedMonth);
      const diffDays = Math.ceil((parsedDate.getTime() - today.getTime()) / DAY_IN_MS);
      if (diffDays < 0) overdueTotal += amount;
      else pendingTotal += amount;
      upcoming.push({ key: item, name: row.name || DEFAULT_EXPENSE_LABEL_MAP[item] || 'รายการ', date: parsedDate, diffDays, dueDay: row.dueDay, resolvedDueDay });
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
      nextDueLabel: nextDue
        ? (nextDue.dueDay
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
  const accountSummary = useMemo(() => getAccountSummary(editExpense, bankAccounts), [editExpense, bankAccounts]);
  const upcomingSummaryText = dueInsights.upcomingCount > 0 ? `${dueInsights.upcomingCount} รายการยังไม่จ่าย` : 'ยังไม่มีรายการค้างชำระ';

  return (
    <div>
      <span role="status" aria-live="polite" className="sr-only">{pendingPaidKeys.length > 0 ? 'กำลังบันทึกสถานะการจ่าย' : ''}</span>
      <div className="mb-space-4 flex flex-wrap items-start justify-between gap-space-3">
        <div><h3 className="text-lg font-medium text-primary">รายการค่าใช้จ่าย</h3><p className="mt-space-1 text-sm text-secondary">บันทึกยอดค่าใช้จ่ายรายเดือนแบบยอดเดียว</p></div>
        <button type="button" className="min-h-11 shrink-0 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" onClick={handleAddExpenseItem}>+ เพิ่มรายการค่าใช้จ่าย</button>
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
                  const dueInfo = describeDueTiming(row.dueDay, paid, selectedMonth, parseToNumber(row.actual));
                  const isCreditCardRow = isCreditCardRowKey(item);
                  const meta = installmentMeta[item];
                  if (isCreditCardRow) {
                    return <Fragment key={item}>
                      {item === firstCreditCardKey && <tr><td className="border-t border-dashed border-border-default p-space-3 text-xs font-medium text-tertiary" colSpan={5}>บัตรเครดิต (ซิงก์อัตโนมัติ)</td></tr>}
                      <tr className="border-b border-border-subtle bg-info/5" data-expense-key={item}>
                        <td className="p-space-3 align-middle"><span className="flex items-center gap-space-2 text-secondary" title={displayName}><span aria-hidden="true">🔒</span>{displayName}</span>{meta && <div className="mt-space-1 flex flex-col gap-space-1"><span className="inline-flex w-fit items-center gap-1 rounded-full border border-info/35 bg-info/15 px-space-2 py-[2px] text-xs font-medium text-info">💳 {meta.cardName}</span><Link href={`/credit-cards?card=${meta.cardId}`} className={`text-xs text-accent underline-offset-2 hover:underline ${FOCUS_RING}`}>จัดการที่หน้าบัตรเครดิต →</Link></div>}</td>
                        <td className="p-space-3 text-right align-middle"><span className="font-[family-name:var(--font-numeric)] tabular-nums text-secondary">{formatCurrency(row.actual)}</span>{cardDetails(item, row, 'desktop')}</td><td className="p-space-3 align-middle text-secondary">{selectedAccount}</td><td className="p-space-3 align-middle text-secondary">{formatDueDayText(row.dueDay) || 'ไม่ระบุ'}</td>
                        <td className="p-space-3 text-center align-middle"><button type="button" className={`mx-auto flex h-11 items-center gap-space-2 rounded-full border px-space-3 text-xs font-semibold ${FOCUS_RING} ${paid ? 'border-pos/40 bg-pos/15 text-pos' : 'border-border-interactive bg-surface-2 text-secondary'}`} onClick={() => handleTogglePaid(item)} disabled={pendingPaidKeys.includes(item)} aria-busy={pendingPaidKeys.includes(item)} aria-pressed={paid}>{paid ? '✓ จ่ายแล้ว' : '○ ยังไม่จ่าย'}</button></td>
                      </tr>
                    </Fragment>;
                  }
                  return <tr key={item} className="border-b border-border-subtle last:border-b-0" data-expense-key={item}>
                    <td className="p-space-3 align-middle"><div className="flex min-w-0 items-center gap-space-3"><input type="text" value={String(displayName)} onChange={event => handleExpenseChange(item, 'name', event.target.value)} onBlur={event => handleExpenseBlur(item, 'name', event.target.value)} className={`${INPUT} flex-1`} placeholder="ชื่อรายการ" /><button type="button" className={REMOVE_BTN} onClick={() => handleDeleteExpenseItem(item)} aria-label={`ลบ ${displayName}`}><Icons.X size={16} /></button></div></td>
                    <td className="p-space-3 align-middle"><input type="text" inputMode="decimal" value={String(row.actual ?? '')} onChange={event => handleNumberInput(event.target.value, value => handleExpenseChange(item, 'actual', value))} onBlur={event => handleNumberBlur(event.target.value, value => handleExpenseBlur(item, 'actual', value))} onFocus={handleAmountInputFocus} className={`${INPUT} text-right font-[family-name:var(--font-numeric)] tabular-nums`} /></td>
                    <td className="p-space-3 align-middle"><select value={selectedAccount} onChange={event => handleExpenseChange(item, 'account', event.target.value)} className={SELECT}>{bankAccounts.map(account => <option key={account} value={account}>{account}</option>)}</select></td>
                    <td className="min-w-[150px] p-space-3 align-middle"><div className="flex flex-col gap-space-2"><select value={String(row.dueDay || END_OF_MONTH_DUE_DAY)} onChange={event => handleExpenseChange(item, 'dueDay', event.target.value)} className={SELECT}><option value={END_OF_MONTH_DUE_DAY}>วันสิ้นเดือน</option>{dueDayOptions.map(day => <option key={day} value={day}>{day}</option>)}</select><div className="flex flex-wrap items-center gap-space-2"><DueBadge status={dueInfo.status}>{dueInfo.badge}</DueBadge>{dueInfo.helper && <span className="text-xs text-tertiary">{dueInfo.helper}</span>}</div></div></td>
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
              const dueInfo = describeDueTiming(row.dueDay, paid, selectedMonth, parseToNumber(row.actual));
              const isCreditCardRow = isCreditCardRowKey(item);
              const meta = installmentMeta[item];
              if (isCreditCardRow) {
                return <Fragment key={item}>{item === firstCreditCardKey && <p className="mt-space-2 text-xs font-medium text-tertiary">บัตรเครดิต (ซิงก์อัตโนมัติ)</p>}<div className={`min-h-14 rounded-md border border-info/30 bg-surface-2 p-space-4 [scroll-margin-top:calc(var(--topbar-safe-top,90px)+8px)] ${paid ? 'opacity-70' : ''}`} data-expense-key={item}>
                  <div className="flex items-center justify-between gap-space-2"><span className="flex items-center gap-space-2 font-medium text-secondary" title={displayName}><span aria-hidden="true">🔒</span>{displayName}</span><span className="inline-flex w-fit shrink-0 items-center gap-1 rounded-full border border-info/35 bg-info/15 px-space-2 py-[2px] text-xs font-medium text-info">บัตรเครดิต</span></div>
                  {meta && <span className="mt-space-1 inline-flex w-fit items-center gap-1 text-xs text-tertiary">💳 {meta.cardName}</span>}
                  <p className="mt-space-2 font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums text-primary">{formatCurrency(row.actual)}</p><p className="mt-space-1 text-xs text-secondary">{`ครบกำหนด ${formatDueDayText(row.dueDay) || 'ไม่ระบุ'} · ${selectedAccount}`}</p>
                  <button type="button" className={`mt-space-3 flex min-h-11 w-full items-center justify-center rounded-sm border px-space-4 text-sm font-semibold ${FOCUS_RING} ${paid ? 'border-pos/40 bg-pos/15 text-pos' : 'border-border-interactive bg-surface-1 text-secondary'}`} onClick={() => handleTogglePaid(item)} disabled={pendingPaidKeys.includes(item)} aria-busy={pendingPaidKeys.includes(item)} aria-pressed={paid}>{paid ? '✓ ชำระแล้ว' : 'ยังไม่ชำระ — แตะเพื่อยืนยัน'}</button>
                  {cardDetails(item, row, 'mobile')}
                  {meta && <Link href={`/credit-cards?card=${meta.cardId}`} className={`mt-space-2 inline-block text-xs text-accent underline-offset-2 hover:underline ${FOCUS_RING}`}>จัดการที่หน้าบัตรเครดิต →</Link>}
                </div></Fragment>;
              }
              return <div className={`min-h-14 rounded-md border border-border-default bg-surface-2 p-space-4 [scroll-margin-top:calc(var(--topbar-safe-top,90px)+8px)] ${paid ? 'opacity-70' : ''}`} key={item} data-expense-key={item}>
                <div className="flex items-center gap-space-2"><input type="text" value={String(displayName)} onChange={event => handleExpenseChange(item, 'name', event.target.value)} onBlur={event => handleExpenseBlur(item, 'name', event.target.value)} className={`${INPUT} flex-1 font-medium`} placeholder="ชื่อรายการ" /><button type="button" className={REMOVE_BTN} onClick={() => handleDeleteExpenseItem(item)} aria-label={`ลบ ${displayName}`}><Icons.X size={16} /></button></div>
                <input type="text" inputMode="decimal" value={String(row.actual ?? '')} onChange={event => handleNumberInput(event.target.value, value => handleExpenseChange(item, 'actual', value))} onBlur={event => handleNumberBlur(event.target.value, value => handleExpenseBlur(item, 'actual', value))} onFocus={handleAmountInputFocus} className={`${INPUT} mt-space-3 text-right font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums`} placeholder="0.00" />
                <div className="mt-space-3 flex gap-space-2"><select value={selectedAccount} onChange={event => handleExpenseChange(item, 'account', event.target.value)} className={`${SELECT} flex-1`}>{bankAccounts.map(account => <option key={account} value={account}>{account}</option>)}</select><select value={String(row.dueDay || END_OF_MONTH_DUE_DAY)} onChange={event => handleExpenseChange(item, 'dueDay', event.target.value)} className={`${SELECT} flex-1`}><option value={END_OF_MONTH_DUE_DAY}>สิ้นเดือน</option>{dueDayOptions.map(day => <option key={day} value={day}>วันที่ {day}</option>)}</select></div>
                {dueInfo.helper && <p className="mt-space-2 text-xs text-tertiary">{dueInfo.helper}</p>}
                <button type="button" className={`mt-space-3 flex min-h-11 w-full items-center justify-center rounded-sm border px-space-4 text-sm font-semibold ${FOCUS_RING} ${paid ? 'border-pos/40 bg-pos/15 text-pos' : 'border-border-interactive bg-surface-1 text-secondary'}`} onClick={() => handleTogglePaid(item)} disabled={pendingPaidKeys.includes(item)} aria-busy={pendingPaidKeys.includes(item)} aria-pressed={paid}>{paid ? '✓ ชำระแล้ว' : 'ยังไม่ชำระ — แตะเพื่อยืนยัน'}</button>
              </div>;
            })}
            <div className={`${CARD} border-accent/40 bg-accent-muted`}><div className="flex items-center justify-between text-sm"><span className="text-secondary">ยอดค่าใช้จ่าย</span><span className="font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-primary">{formatCurrency(totalActualValue)}</span></div><div className="mt-space-2 flex items-center justify-between text-sm"><span className="text-secondary">ยอดค้างชำระ</span><span className="font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-neg">{formatCurrency(totalUnpaidValue)}</span></div></div>
          </div>
          </>}

          {shouldShowAccountTable && <div className="mt-space-5"><BankAccountTable accountSummary={accountSummary} prevAccountSummary={prevAccountSummary} accounts={bankAccounts} /></div>}
        </>
      )}
      {!isLoading && !hasExpenseRows && <div className="rounded-md border border-dashed border-border-default bg-sunken p-space-4 text-sm text-secondary">ยังไม่มีรายการค่าใช้จ่ายในเดือนนี้ กด &quot;เพิ่มรายการ&quot; เพื่อเริ่มต้น</div>}
      {cardPayment && <CardTotalPaymentDialog
        row={{ name: cardPayment.row.name || 'บัตรเครดิต', breakdown: cardPayment.row.breakdown }}
        paid={cardPayment.paid}
        busy={pendingPaidKeys.includes(cardPayment.key)}
        onCancel={() => setCardPayment(null)}
        onConfirm={confirmCardPayment}
      />}
    </div>
  );
}