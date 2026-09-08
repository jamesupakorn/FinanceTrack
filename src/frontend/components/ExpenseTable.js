/**
 * คอมโพเนนต์: ExpenseTable
 * หน้าจอหลักสำหรับจัดการค่าใช้จ่ายรายเดือน
 *
 * ฟีเจอร์หลัก:
 * - เพิ่ม/แก้ไข/ลบรายการค่าใช้จ่ายแบบกำหนดเอง
 * - รองรับยอดค่าใช้จ่ายแบบยอดเดียว
 * - ติดตามสถานะชำระเงิน
 * - กำหนดวันครบกำหนดรายเดือน (1-31)
 * - แสดงสถานะครบกำหนด/ค้างชำระ/ใกล้ถึงกำหนด
 * - แสดงสรุปยอดตามบัญชีธนาคาร (เฉพาะผู้ดูแล)
 * - บันทึกแบบครั้งเดียวพร้อมรายการที่ต้องลบ
 *
 * พร็อพ:
 * - selectedMonth {string} เดือนที่เลือก (YYYY-MM)
 * - markDirty {function} (Graphite, K17) เรียกเป็นคำสั่งแรกใน handleAddExpenseItem/handleDeleteExpenseItem
 *   — ปุ่มเหล่านี้เป็น onClick ไม่ใช่ input/change จึงไม่โดน bubbled listener ของ WorkspaceShell.js จับเอง
 *
 * Graphite redesign (income-expense-graphite pass) — Tailwind only (UX_SPEC §5.1 C11 / §6.5 base /
 * §6.6 lg). แถวบัตรเครดิต (cci_/ccr_) ไม่ใช่ C11 — อ่านอย่างเดียวยกเว้นปุ่มชำระ, มี 3 สัญญาณเสมอ
 * (ล็อก + ชิป "บัตรเครดิต" + พื้น --surface-2, ไม่ใช้สีอย่างเดียวสื่อความหมาย — N2/E5) formatExpenseForSave
 * (การตัด cci_/ccr_ ก่อนบันทึก, Constraint 8/9) ไม่ถูกแตะเลยในพาสนี้
 */

import { Fragment, useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
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
import { isCreditCardRowKey, isRevolvingRowKey } from '../../shared/utils/creditCardUtils';
import BankAccountTable from './BankAccountTable';
import { expenseAPI, creditCardAPI } from '../../shared/utils/frontend/apiUtils';
import { withApiTokenHeaders } from '../../shared/utils/frontend/apiToken';
import { useSession } from '../contexts/SessionContext';
import { showToast } from '../../shared/utils/frontend/toast';
import { Icons } from './Icons';

const DEFAULT_EXPENSE_KEY_ORDER = DEFAULT_EXPENSE_ITEMS.map(item => item.key);
const DEFAULT_EXPENSE_LABEL_MAP = DEFAULT_EXPENSE_ITEMS.reduce((acc, item) => {
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

// C8 chip — data-status ตัวไหน สีอะไร (N2: ทุกสถานะมี glyph/ตัวอักษรกำกับเสมอ ไม่ใช้สีอย่างเดียว)
const DUE_BADGE_TONE = {
  overdue: 'border-neg/40 bg-neg/10 text-neg',
  dueToday: 'border-warn/40 bg-warn/10 text-warn',
  dueSoon: 'border-info/40 bg-info/10 text-info',
  future: 'border-pos/35 bg-pos/10 text-pos',
  done: 'border-pos/40 bg-pos/15 text-pos',
  none: 'border-dashed border-border-default text-secondary'
};

const getPreviousMonthKey = (monthKey) => {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return null;
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  if (month === 1) {
    return `${year - 1}-12`;
  }
  return `${year}-${String(month - 1).padStart(2, '0')}`;
};

const formatDueDayText = (dueDayValue) => {
  if (isEndOfMonthDueDay(dueDayValue)) {
    return 'วันสิ้นเดือน';
  }
  return dueDayValue ? `วันที่ ${dueDayValue}` : '';
};


const describeDueTiming = (dueDayValue, paid, monthKey) => {
  const parsedDate = getDueDateFromDay(dueDayValue, monthKey);
  const dueDayText = formatDueDayText(dueDayValue);
  if (paid) {
    return {
      status: 'done',
      badge: 'ชำระแล้ว',
      helper: dueDayText ? `ครบกำหนดทุก${dueDayText}` : '',
      date: parsedDate,
      diffDays: null
    };
  }
  if (!parsedDate) {
    return {
      status: 'none',
      badge: 'ยังไม่กำหนด',
      helper: '',
      date: null,
      diffDays: null
    };
  }
  const today = getStartOfToday();
  const diffDays = Math.ceil((parsedDate - today) / DAY_IN_MS);
  if (diffDays < 0) {
    return {
      status: 'overdue',
      badge: `เกินกำหนด ${Math.abs(diffDays)} วัน`,
      helper: dueDayText ? `ทุก${dueDayText}` : '',
      date: parsedDate,
      diffDays
    };
  }
  if (diffDays === 0) {
    return {
      status: 'dueToday',
      badge: 'ครบกำหนดวันนี้',
      helper: '',
      date: parsedDate,
      diffDays
    };
  }
  if (diffDays <= DUE_SOON_THRESHOLD_DAYS) {
    return {
      status: 'dueSoon',
      badge: `อีก ${diffDays} วัน`,
      helper: dueDayText ? `ทุก${dueDayText}` : '',
      date: parsedDate,
      diffDays
    };
  }
  return {
    status: 'future',
    badge: dueDayText ? `ทุก${dueDayText}` : 'ครบกำหนด',
    helper: 'ครบกำหนด',
    date: parsedDate,
    diffDays
  };
};

export default function ExpenseTable({ selectedMonth, onRegisterSave, onSaved, markDirty }) {
  const [editExpense, setEditExpense] = useState({});
  const [bankAccounts, setBankAccounts] = useState([]);
  const [previousMonthTotal, setPreviousMonthTotal] = useState(null);
  const [prevMonthUnpaid, setPrevMonthUnpaid] = useState(null);
  const [prevAccountSummary, setPrevAccountSummary] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [persistedKeys, setPersistedKeys] = useState([]);
  const [pendingScrollKey, setPendingScrollKey] = useState(null);
  // metadata ของแถวผ่อนบัตรเครดิต (ชื่อบัตร/สี/ลิงก์) — ตัวแถวเองมาจาก API รายจ่ายอยู่แล้ว
  const [installmentMeta, setInstallmentMeta] = useState({});
  const { currentUser } = useSession();
  const shouldShowAccountTable = Boolean(currentUser?.id);

  useEffect(() => {
    if (!pendingScrollKey) return;
    const tryScroll = () => {
      if (typeof document === 'undefined') return false;
      const targets = Array.from(document.querySelectorAll(`[data-expense-key="${pendingScrollKey}"]`));
      const target = targets.find((node) => node.offsetParent !== null) || targets[0];
      if (!target) return false;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const firstInput = target.querySelector('input[type="text"]');
      if (firstInput && typeof firstInput.focus === 'function') {
        firstInput.focus({ preventScroll: true });
      }
      return true;
    };

    let timer = null;
    const done = tryScroll();
    if (!done) {
      timer = setTimeout(() => {
        if (tryScroll()) {
          setPendingScrollKey(null);
        }
      }, 80);
      return () => clearTimeout(timer);
    }
    setPendingScrollKey(null);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [editExpense, pendingScrollKey]);

  useEffect(() => {
    if (!selectedMonth) {
      setEditExpense({});
      setBankAccounts([]);
      setPersistedKeys([]);
      return;
    }
    setIsLoading(true);
    expenseAPI.getByMonth(selectedMonth)
      .then(data => {
        const formatted = formatExpenseData(data || {}, selectedMonth);
        setEditExpense(formatted.values || {});
        // รวมบัญชีจากโปรไฟล์ user กับบัญชีของเดือนนี้ (ถ้ามี)
        const monthAccounts = formatted.bankAccounts || [];
        const mergedAccounts = Array.from(new Set([
          ...monthAccounts,
          ...(currentUser?.bankAccounts || [])
        ])).filter(Boolean);
        setBankAccounts(mergedAccounts);
        setPersistedKeys(formatted.persistedKeys || []);
      })
      .catch(error => {
        console.error('Error loading expense data:', error);
        const formatted = formatExpenseData({}, selectedMonth);
        setEditExpense(formatted.values || {});
        // ใช้บัญชีจากโปรไฟล์ user เป็นค่าเริ่มต้น
        const userAccounts = currentUser?.bankAccounts || [];
        setBankAccounts(userAccounts);
        setPersistedKeys(formatted.persistedKeys || []);
      })
      .finally(() => setIsLoading(false));
  }, [selectedMonth, currentUser?.bankAccounts]);

  useEffect(() => {
    if (!selectedMonth || !currentUser?.id) {
      setInstallmentMeta({});
      return;
    }
    let cancelled = false;
    // metadata ของทั้งสองตระกูล — ล้มเหลวแล้วแค่ไม่มีป้ายบัตร ไม่ทำให้หน้ารายจ่ายพัง
    Promise.all([
      creditCardAPI.getMonthInstallments(selectedMonth),
      creditCardAPI.getRevolving({ month: selectedMonth }).catch(() => null)
    ]).then(([items, revolving]) => {
      if (cancelled) return;
      const map = {};
      items.forEach((item) => { map[item.key] = item; });
      (Array.isArray(revolving?.cycles) ? revolving.cycles : []).forEach((cycle) => {
        if (!cycle?.key) return;
        map[cycle.key] = {
          key: cycle.key,
          cardId: cycle.cardId,
          cardName: cycle.cardName,
          cardColor: cycle.cardColor
        };
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
      .then((data) => {
        const previousFormatted = formatExpenseData(data || {}, previousMonthKey);
        const previousValues = previousFormatted.values || {};
        const previousTotal = calculateExpenseTotal(previousValues, 'actual', parseToNumber);
        setPreviousMonthTotal(previousTotal);
        const unpaidItems = Object.values(previousValues).filter(row => {
          if (!row || typeof row !== 'object') return false;
          if (row.paid === true || row.paid === 'true') return false;
          return parseToNumber(row.actual) > 0;
        });
        const unpaidTotal = unpaidItems.reduce((s, row) => s + parseToNumber(row.actual), 0);
        setPrevMonthUnpaid(unpaidTotal > 0 ? { total: unpaidTotal, count: unpaidItems.length, monthKey: previousMonthKey } : null);
        setPrevAccountSummary(getAccountSummary(previousValues, bankAccounts));
      })
      .catch(() => {
        setPreviousMonthTotal(null);
        setPrevMonthUnpaid(null);
        setPrevAccountSummary({});
      });
  }, [selectedMonth]);

  const updateExpenseField = (item, field, value) => {
    setEditExpense(prev => {
      const current = prev[item] || {
        name: DEFAULT_EXPENSE_LABEL_MAP[item] || 'รายการใหม่',
        actual: '0.00',
        account: bankAccounts[0] || 'ไม่ระบุบัญชี',
        paid: false,
        dueDay: END_OF_MONTH_DUE_DAY
      };
      return {
        ...prev,
        [item]: { ...current, [field]: value }
      };
    });
  };

  const handleExpenseChange = (item, field, value) => {
    if (field === 'paid' || field === 'name' || field === 'dueDay' || field === 'account') {
      updateExpenseField(item, field, value);
      return;
    }
    handleNumberInput(value, (val) => updateExpenseField(item, field, val));
  };

  const handleExpenseBlur = (item, field, value) => {
    if (field === 'paid') {
      updateExpenseField(item, field, value);
      return;
    }
    if (field === 'name') {
      const cleanName = (typeof value === 'string' && value.trim().length > 0)
        ? value.trim()
        : (DEFAULT_EXPENSE_LABEL_MAP[item] || 'รายการใหม่');
      updateExpenseField(item, field, cleanName);
      return;
    }
    if (field === 'dueDay') {
      if (isEndOfMonthDueDay(value)) {
        updateExpenseField(item, field, END_OF_MONTH_DUE_DAY);
        return;
      }
      const parsed = parseInt(value, 10);
      if (Number.isNaN(parsed)) {
        updateExpenseField(item, field, '');
      } else {
        updateExpenseField(item, field, String(Math.min(31, Math.max(1, parsed))));
      }
      return;
    }
    updateExpenseField(item, field, value);
  };

  const handleAmountInputFocus = (event) => {
    event.target.select();
  };

  const handleAddExpenseItem = () => {
    markDirty?.(); // K17 — คำสั่งแรกเสมอ: ปุ่มนี้เป็น onClick ไม่ใช่ input/change (spec.md §Files "The
                    // C11 dirty signal")
    const uniqueKey = `custom_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    setEditExpense(prev => ({
      ...prev,
      [uniqueKey]: {
        name: 'รายการใหม่',
        actual: '0.00',
        account: bankAccounts[0] || 'ไม่ระบุบัญชี',
        paid: false,
        dueDay: END_OF_MONTH_DUE_DAY
      }
    }));
    setPendingScrollKey(uniqueKey);
  };

  const handleDeleteExpenseItem = (item) => {
    markDirty?.(); // K17 — เดียวกับข้างบน
    setEditExpense(prev => {
      const updated = { ...prev };
      delete updated[item];
      return updated;
    });
  };

  const handleBankAccountsChange = (nextAccounts) => {
    const rawAccounts = Array.isArray(nextAccounts)
      ? nextAccounts.map((item) => String(item ?? ''))
      : [];
    const validAccounts = Array.from(new Set(
      rawAccounts
        .map((item) => item.trim())
        .filter(Boolean)
    ));

    setBankAccounts(rawAccounts);

    setEditExpense((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((key) => {
        const row = next[key];
        if (!row || typeof row !== 'object') return;
        const currentAccount = typeof row.account === 'string' ? row.account.trim() : '';
        if (!currentAccount || validAccounts.includes(currentAccount)) return;
        next[key] = { ...row, account: validAccounts[0] || 'ไม่ระบุบัญชี' };
      });
      return next;
    });
  };

  const handleSave = async () => {
    if (!selectedMonth) return;
    try {
      const prepared = formatExpenseForSave(editExpense, parseToNumber);
      const normalizedAccounts = Array.from(new Set(
        (bankAccounts || [])
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      ));
      prepared.bankAccounts = normalizedAccounts;
      const preparedKeys = Object.keys(prepared || {});
      const removedKeys = persistedKeys.filter(key => key !== 'bankAccounts' && !preparedKeys.includes(key));
      if (removedKeys.length > 0) {
        prepared.__removeKeys = removedKeys;
      }

      // บันทึกข้อมูลค่าใช้จ่ายรายเดือน
      await expenseAPI.save(selectedMonth, prepared);

      // อัปเดตบัญชีในโปรไฟล์ user (เพื่อให้เดือนหน้าใช้เป็นค่าเริ่มต้น)
      if (currentUser?.id) {
        try {
          // ต้องแนบ Bearer token เพราะ endpoint นี้ผ่าน assertApiToken (เดียวกับ TD-H05)
          await fetch('/api/user-bank-accounts', {
            method: 'POST',
            headers: withApiTokenHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ bankAccounts: normalizedAccounts, userId: currentUser.id })
          });
        } catch (error) {
          console.warn('Warning: Could not update user bank accounts:', error);
        }
      }

      // รีเฟรชข้อมูลหลังบันทึก
      const data = await expenseAPI.getByMonth(selectedMonth);
      const formatted = formatExpenseData(data || {}, selectedMonth);
      setEditExpense(formatted.values || {});
      // รวมบัญชีจากโปรไฟล์ user กับบัญชีของเดือนนี้
      const monthAccounts = formatted.bankAccounts || [];
      const mergedAccounts = Array.from(new Set([
        ...monthAccounts,
        ...(currentUser?.bankAccounts || [])
      ])).filter(Boolean);
      setBankAccounts(mergedAccounts);
      setPersistedKeys(formatted.persistedKeys || []);
      showToast('บันทึกค่าใช้จ่ายสำเร็จ');
      onSaved?.();
    } catch (error) {
      console.error('Error saving expense data:', error);
      showToast('บันทึกไม่สำเร็จ กรุณาลองใหม่', 'error');
    }
  };

  // ลงทะเบียนฟังก์ชันบันทึกกับ ref ของ WorkspaceShell แทนตัวนับ Save All เดิม (Amendment A5 —
  // ดูคำอธิบายเต็มใน IncomeTable.js ที่จุดเดียวกัน)
  useEffect(() => {
    if (!onRegisterSave) return undefined;
    onRegisterSave(handleSave);
    return () => onRegisterSave(null);
  }, [onRegisterSave, handleSave]);
  // สามกลุ่ม: รายการมาตรฐาน → รายการที่ผู้ใช้เพิ่มเอง → แถวบัตรเครดิต (ท้ายสุดเสมอ)
  // ภายในกลุ่มบัตรเครดิต: ยอดหมุนเวียนมาก่อนงวดผ่อน เพราะยอดในใบแจ้งหนี้เป็นภาระหลักของบัตร
  const sortedExpenseKeys = useMemo(() => {
    const keys = Object.keys(editExpense || {});
    const defaultKeys = DEFAULT_EXPENSE_KEY_ORDER.filter(key => keys.includes(key));
    const revolvingKeys = keys.filter(key => isRevolvingRowKey(key));
    const installmentKeys = keys.filter(key => isCreditCardRowKey(key) && !isRevolvingRowKey(key));
    const customKeys = keys.filter(key => !DEFAULT_EXPENSE_KEY_ORDER.includes(key) && !isCreditCardRowKey(key));
    return [...defaultKeys, ...customKeys, ...revolvingKeys, ...installmentKeys];
  }, [editExpense]);

  const firstCreditCardKey = useMemo(
    () => sortedExpenseKeys.find(key => isCreditCardRowKey(key)) || null,
    [sortedExpenseKeys]
  );

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

  const dueDayOptions = useMemo(
    () => Array.from({ length: daysInSelectedMonth }, (_, index) => String(index + 1)),
    [daysInSelectedMonth]
  );

  const dueInsights = useMemo(() => {
    const today = getStartOfToday();
    const upcoming = [];
    let overdueTotal = 0;
    let pendingTotal = 0;
    sortedExpenseKeys.forEach(item => {
      const row = editExpense[item];
      if (!row) return;
      const paid = row.paid === true || row.paid === 'true';
      if (paid) return;
      const amount = parseToNumber(row.actual);
      const parsedDate = getDueDateFromDay(row.dueDay, selectedMonth);
      if (!parsedDate) {
        pendingTotal += amount;
        return;
      }
      const resolvedDueDay = resolveDueDayForMonth(row.dueDay, daysInSelectedMonth);
      const diffDays = Math.ceil((parsedDate - today) / DAY_IN_MS);
      if (diffDays < 0) {
        overdueTotal += amount;
      } else {
        pendingTotal += amount;
      }
      upcoming.push({
        key: item,
        name: row.name || DEFAULT_EXPENSE_LABEL_MAP[item] || 'รายการ',
        date: parsedDate,
        diffDays,
        dueDay: row.dueDay,
        resolvedDueDay
      });
    });
    upcoming.sort((a, b) => a.date - b.date);
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
          ? (isEndOfMonthDueDay(nextDue.dueDay)
            ? 'ทุกวันสิ้นเดือน'
            : `ทุกวันที่ ${nextDue.resolvedDueDay || nextDue.dueDay}`)
          : formatDueDateLabel(nextDue.date, { day: 'numeric', month: 'short' }))
        : 'ยังไม่กำหนด',
      nextDueName: nextDue ? nextDue.name : 'ไม่มีรายการ',
    };
  }, [daysInSelectedMonth, editExpense, selectedMonth, sortedExpenseKeys]);

  const hasExpenseRows = sortedExpenseKeys.length > 0;
  const totalActualValue = useMemo(() => calculateExpenseTotal(editExpense, 'actual', parseToNumber), [editExpense]);
  const monthDiffValue = useMemo(() => {
    if (typeof previousMonthTotal !== 'number') return null;
    return totalActualValue - previousMonthTotal;
  }, [totalActualValue, previousMonthTotal]);
  const monthDiffPercent = useMemo(() => {
    if (typeof previousMonthTotal !== 'number') return null;
    if (previousMonthTotal === 0) {
      return totalActualValue === 0 ? 0 : 100;
    }
    return ((totalActualValue - previousMonthTotal) / previousMonthTotal) * 100;
  }, [totalActualValue, previousMonthTotal]);
  const monthDiffStatus = useMemo(() => {
    if (monthDiffValue === null) return 'neutral';
    if (monthDiffValue > 0) return 'negative';
    if (monthDiffValue < 0) return 'positive';
    return 'neutral';
  }, [monthDiffValue]);
  const monthDiffChipTone = monthDiffStatus === 'positive'
    ? 'border-pos/40 bg-pos/10 text-pos'
    : monthDiffStatus === 'negative'
      ? 'border-neg/40 bg-neg/10 text-neg'
      : 'border-border-default bg-surface-2 text-secondary';
  const monthDiffLabel = monthDiffValue === null
    ? 'ยังไม่มีข้อมูลเดือนก่อน'
    : monthDiffValue === 0
      ? 'เท่ากับเดือนก่อน'
      : `${monthDiffValue > 0 ? 'เพิ่มขึ้น' : 'ลดลง'} ${formatCurrency(Math.abs(monthDiffValue))}`;
  const monthDiffPercentText = monthDiffPercent === null
    ? 'เปรียบเทียบไม่ได้'
    : `${monthDiffPercent > 0 ? '+' : ''}${monthDiffPercent.toFixed(1)}%`;
  const totalUnpaidValue = useMemo(
    () => sortedExpenseKeys.reduce((sum, key) => {
      const row = editExpense[key] || {};
      const paid = row.paid === true || row.paid === 'true';
      if (paid) return sum;
      return sum + parseToNumber(row.actual);
    }, 0),
    [editExpense, sortedExpenseKeys]
  );
  const accountSummary = useMemo(() => getAccountSummary(editExpense, bankAccounts), [editExpense, bankAccounts]);
  const upcomingSummaryText = dueInsights.upcomingCount > 0
    ? `${dueInsights.upcomingCount} รายการยังไม่จ่าย`
    : 'ยังไม่มีรายการค้างชำระ';

  const DueBadge = ({ status, children }) => (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-space-2 py-[2px] text-xs font-medium ${DUE_BADGE_TONE[status] || DUE_BADGE_TONE.none}`}>
      {children}
    </span>
  );

  return (
    <div>
      <div className="mb-space-4 flex flex-wrap items-start justify-between gap-space-3">
        <div>
          <h3 className="text-lg font-medium text-primary">รายการค่าใช้จ่าย</h3>
          <p className="mt-space-1 text-sm text-secondary">บันทึกยอดค่าใช้จ่ายรายเดือนแบบยอดเดียว</p>
        </div>
        <button
          type="button"
          className="min-h-11 shrink-0 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
          onClick={handleAddExpenseItem}
        >
          + เพิ่มรายการค่าใช้จ่าย
        </button>
      </div>

      {hasExpenseRows && (
        <div className="mb-space-5 grid grid-cols-1 gap-space-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className={CARD}>
            <p className="text-xs text-secondary">ยอดค่าใช้จ่ายรวม</p>
            <p className="mt-space-1 font-[family-name:var(--font-numeric)] text-2xl font-semibold tabular-nums text-primary">{formatCurrency(totalActualValue)}</p>
            <p className="mt-space-1 text-xs text-tertiary">
              {typeof previousMonthTotal === 'number'
                ? `เทียบเดือนก่อน ${monthDiffLabel} (เดือนก่อน ${formatCurrency(previousMonthTotal)})`
                : 'สรุปยอดค่าใช้จ่ายทั้งหมดในเดือนนี้'}
            </p>
            <span className={`mt-space-2 inline-flex w-fit items-center rounded-full border px-space-2 py-[2px] text-xs font-medium ${monthDiffChipTone}`}>
              เปลี่ยนแปลง {monthDiffPercentText}
            </span>
          </div>

          <div className={`${CARD} border-info/30`}>
            <p className="text-xs text-secondary">กำหนดชำระถัดไป</p>
            <p className="mt-space-1 text-lg font-semibold text-primary">{dueInsights.nextDueLabel}</p>
            <p className="mt-space-1 text-xs text-tertiary">{dueInsights.nextDueName}</p>
            <div className="mt-space-2 flex flex-wrap gap-space-2">
              <span className="inline-flex items-center rounded-full border border-neg/40 bg-neg/10 px-space-2 py-[2px] text-xs font-medium text-neg">
                เลยกำหนด {formatCurrency(dueInsights.overdueTotal)}
              </span>
              <span className="inline-flex items-center rounded-full border border-border-default bg-surface-2 px-space-2 py-[2px] text-xs font-medium text-secondary">
                ยังไม่ถึงกำหนด {formatCurrency(dueInsights.pendingTotal)}
              </span>
            </div>
            <div className="mt-space-2 flex flex-wrap gap-space-2 text-xs text-secondary">
              <span>{upcomingSummaryText}</span>
              {dueInsights.urgentCount > 0 && <span className="font-medium text-warn">เร่งด่วน {dueInsights.urgentCount}</span>}
              {dueInsights.overdueCount > 0 && <span className="font-medium text-neg">เกินกำหนด {dueInsights.overdueCount}</span>}
            </div>
          </div>

          {prevMonthUnpaid && (
            <div className={`${CARD} border-warn/30`}>
              <p className="text-xs text-secondary">ค้างจ่ายเดือนก่อน</p>
              <p className="mt-space-1 text-lg font-semibold text-warn">{formatCurrency(prevMonthUnpaid.total)}</p>
              <p className="mt-space-1 text-xs text-tertiary">{formatMonthKeyTH(prevMonthUnpaid.monthKey)} · {prevMonthUnpaid.count} รายการ</p>
              <span className="mt-space-2 inline-flex w-fit items-center rounded-full border border-neg/40 bg-neg/10 px-space-2 py-[2px] text-xs font-medium text-neg">
                ยังไม่ได้ชำระ
              </span>
            </div>
          )}
        </div>
      )}

      {isLoading && !hasExpenseRows && (
        <div role="status" aria-live="polite" className="rounded-md border border-dashed border-border-default bg-sunken p-space-4 text-sm text-secondary">กำลังโหลดข้อมูล...</div>
      )}

      {hasExpenseRows && (
        <>
          {/* md+: C5 table */}
          <div className="hidden overflow-x-auto rounded-md border border-border-default md:block">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-subtle bg-surface-2">
                  <th className="p-space-3 text-left text-xs font-medium text-secondary">รายการค่าใช้จ่าย</th>
                  <th className="p-space-3 text-right text-xs font-medium text-secondary">ยอดค่าใช้จ่าย</th>
                  <th className="p-space-3 text-left text-xs font-medium text-secondary">บัญชีที่ใช้จ่าย</th>
                  <th className="p-space-3 text-left text-xs font-medium text-secondary">วันครบกำหนด</th>
                  <th className="p-space-3 text-center text-xs font-medium text-secondary">สถานะชำระ</th>
                </tr>
              </thead>
              <tbody>
                {sortedExpenseKeys.map((item) => {
                  const row = editExpense[item] || {};
                  const paid = row.paid === true || row.paid === 'true';
                  const displayName = row.name ?? DEFAULT_EXPENSE_LABEL_MAP[item] ?? 'รายการใหม่';
                  const selectedAccount = (typeof row.account === 'string' && row.account.trim().length > 0)
                    ? row.account
                    : (bankAccounts[0] || 'ไม่ระบุบัญชี');
                  const dueInfo = describeDueTiming(row.dueDay, paid, selectedMonth);
                  const isCreditCardRow = isCreditCardRowKey(item);
                  const meta = installmentMeta[item];

                  // แถวบัตรเครดิต: ชื่อ/ยอด/บัญชี/วันครบกำหนดเป็นข้อความอ่านอย่างเดียว — ไม่ใช่ C11
                  // (E5/§6.5) 3 สัญญาณ: ล็อกกลอน + ชิป "บัตรเครดิต" + พื้น --surface-2 เหลือแค่ paid ที่กดได้
                  if (isCreditCardRow) {
                    return (
                      <Fragment key={item}>
                        {item === firstCreditCardKey && (
                          <tr>
                            <td className="border-t border-dashed border-border-default p-space-3 text-xs font-medium text-tertiary" colSpan={5}>
                              บัตรเครดิต (ซิงก์อัตโนมัติ)
                            </td>
                          </tr>
                        )}
                        <tr className="border-b border-border-subtle bg-info/5" data-expense-key={item}>
                          <td className="p-space-3 align-middle">
                            <span className="flex items-center gap-space-2 text-secondary" title={displayName}>
                              <span aria-hidden="true">🔒</span>{displayName}
                            </span>
                            {meta && (
                              <div className="mt-space-1 flex flex-col gap-space-1">
                                <span className="inline-flex w-fit items-center gap-1 rounded-full border border-info/35 bg-info/15 px-space-2 py-[2px] text-xs font-medium text-info">
                                  💳 {meta.cardName}
                                </span>
                                <Link href={`/credit-cards?card=${meta.cardId}`} className={`text-xs text-accent underline-offset-2 hover:underline ${FOCUS_RING}`}>
                                  จัดการที่หน้าบัตรเครดิต →
                                </Link>
                              </div>
                            )}
                          </td>
                          <td className="p-space-3 text-right align-middle">
                            <span className="font-[family-name:var(--font-numeric)] tabular-nums text-secondary">{formatCurrency(row.actual)}</span>
                          </td>
                          <td className="p-space-3 align-middle text-secondary">{selectedAccount}</td>
                          <td className="p-space-3 align-middle text-secondary">{formatDueDayText(row.dueDay) || 'ไม่ระบุ'}</td>
                          <td className="p-space-3 text-center align-middle">
                            <button
                              type="button"
                              className={`mx-auto flex h-11 items-center gap-space-2 rounded-full border px-space-3 text-xs font-semibold ${FOCUS_RING} ${paid ? 'border-pos/40 bg-pos/15 text-pos' : 'border-border-interactive bg-surface-2 text-secondary'}`}
                              onClick={() => handleExpenseChange(item, 'paid', !paid)}
                              aria-pressed={paid}
                            >
                              {paid ? '✓ จ่ายแล้ว' : '○ ยังไม่จ่าย'}
                            </button>
                          </td>
                        </tr>
                      </Fragment>
                    );
                  }

                  return (
                    <tr key={item} className="border-b border-border-subtle last:border-b-0" data-expense-key={item}>
                      <td className="p-space-3 align-middle">
                        <div className="flex min-w-0 items-center gap-space-3">
                          <input
                            type="text"
                            value={displayName}
                            onChange={e => handleExpenseChange(item, 'name', e.target.value)}
                            onBlur={e => handleExpenseBlur(item, 'name', e.target.value)}
                            className={`${INPUT} flex-1`}
                            placeholder="ชื่อรายการ"
                          />
                          <button
                            type="button"
                            className={REMOVE_BTN}
                            onClick={() => handleDeleteExpenseItem(item)}
                            aria-label={`ลบ ${displayName}`}
                          >
                            <Icons.X size={16} />
                          </button>
                        </div>
                      </td>
                      <td className="p-space-3 align-middle">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.actual ?? ''}
                          onChange={e => handleNumberInput(e.target.value, (val) => handleExpenseChange(item, 'actual', val))}
                          onBlur={e => handleNumberBlur(e.target.value, (val) => handleExpenseBlur(item, 'actual', val))}
                          onFocus={handleAmountInputFocus}
                          className={`${INPUT} text-right font-[family-name:var(--font-numeric)] tabular-nums`}
                        />
                      </td>
                      <td className="p-space-3 align-middle">
                        <select
                          value={selectedAccount}
                          onChange={e => handleExpenseChange(item, 'account', e.target.value)}
                          className={SELECT}
                        >
                          {bankAccounts.map((account) => (
                            <option key={account} value={account}>{account}</option>
                          ))}
                        </select>
                      </td>
                      <td className="min-w-[150px] p-space-3 align-middle">
                        <div className="flex flex-col gap-space-2">
                          <select
                            value={row.dueDay || END_OF_MONTH_DUE_DAY}
                            onChange={e => handleExpenseChange(item, 'dueDay', e.target.value)}
                            className={SELECT}
                          >
                            <option value={END_OF_MONTH_DUE_DAY}>วันสิ้นเดือน</option>
                            {dueDayOptions.map(day => (
                              <option key={day} value={day}>{day}</option>
                            ))}
                          </select>
                          <div className="flex flex-wrap items-center gap-space-2">
                            <DueBadge status={dueInfo.status}>{dueInfo.badge}</DueBadge>
                            {dueInfo.helper && <span className="text-xs text-tertiary">{dueInfo.helper}</span>}
                          </div>
                        </div>
                      </td>
                      <td className="p-space-3 text-center align-middle">
                        <button
                          type="button"
                          className={`mx-auto flex h-11 items-center gap-space-2 rounded-full border px-space-3 text-xs font-semibold ${FOCUS_RING} ${paid ? 'border-pos/40 bg-pos/15 text-pos' : 'border-border-interactive bg-surface-2 text-secondary'}`}
                          onClick={() => handleExpenseChange(item, 'paid', !paid)}
                          aria-pressed={paid}
                        >
                          {paid ? '✓ จ่ายแล้ว' : '○ ยังไม่จ่าย'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-surface-2">
                  <td className="p-space-3 text-sm font-semibold text-primary">ยอดรวม</td>
                  <td className="p-space-3 text-right font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums text-primary">{formatCurrency(totalActualValue)}</td>
                  <td className="p-space-3" />
                  <td className="p-space-3 text-sm font-semibold text-secondary">รวมค้างชำระ</td>
                  <td className="p-space-3 text-center font-[family-name:var(--font-numeric)] text-sm font-semibold tabular-nums text-neg">{formatCurrency(totalUnpaidValue)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* base tier: C4/C11 cards */}
          <div className="flex flex-col gap-space-3 md:hidden">
            {sortedExpenseKeys.map(item => {
              const row = editExpense[item] || {};
              const paid = row.paid === true || row.paid === 'true';
              const displayName = row.name ?? DEFAULT_EXPENSE_LABEL_MAP[item] ?? 'รายการใหม่';
              const selectedAccount = (typeof row.account === 'string' && row.account.trim().length > 0)
                ? row.account
                : (bankAccounts[0] || 'ไม่ระบุบัญชี');
              const dueInfo = describeDueTiming(row.dueDay, paid, selectedMonth);
              const isCreditCardRow = isCreditCardRowKey(item);
              const meta = installmentMeta[item];

              if (isCreditCardRow) {
                return (
                  <Fragment key={item}>
                    {item === firstCreditCardKey && (
                      <p className="mt-space-2 text-xs font-medium text-tertiary">บัตรเครดิต (ซิงก์อัตโนมัติ)</p>
                    )}
                    <div
                      className={`min-h-14 rounded-md border border-info/30 bg-surface-2 p-space-4 [scroll-margin-top:calc(var(--topbar-safe-top,90px)+8px)] ${paid ? 'opacity-70' : ''}`}
                      data-expense-key={item}
                    >
                      <div className="flex items-center justify-between gap-space-2">
                        <span className="flex items-center gap-space-2 font-medium text-secondary" title={displayName}>
                          <span aria-hidden="true">🔒</span>{displayName}
                        </span>
                        <span className="inline-flex w-fit shrink-0 items-center gap-1 rounded-full border border-info/35 bg-info/15 px-space-2 py-[2px] text-xs font-medium text-info">
                          บัตรเครดิต
                        </span>
                      </div>
                      {meta && <span className="mt-space-1 inline-flex w-fit items-center gap-1 text-xs text-tertiary">💳 {meta.cardName}</span>}
                      <p className="mt-space-2 font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums text-primary">{formatCurrency(row.actual)}</p>
                      <p className="mt-space-1 text-xs text-secondary">
                        {`ครบกำหนด ${formatDueDayText(row.dueDay) || 'ไม่ระบุ'} · ${selectedAccount}`}
                      </p>
                      <button
                        type="button"
                        className={`mt-space-3 flex min-h-11 w-full items-center justify-center rounded-sm border px-space-4 text-sm font-semibold ${FOCUS_RING} ${paid ? 'border-pos/40 bg-pos/15 text-pos' : 'border-border-interactive bg-surface-1 text-secondary'}`}
                        onClick={() => handleExpenseChange(item, 'paid', !paid)}
                        aria-pressed={paid}
                      >
                        {paid ? '✓ ชำระแล้ว' : 'ยังไม่ชำระ — แตะเพื่อยืนยัน'}
                      </button>
                      {meta && (
                        <Link href={`/credit-cards?card=${meta.cardId}`} className={`mt-space-2 inline-block text-xs text-accent underline-offset-2 hover:underline ${FOCUS_RING}`}>
                          จัดการที่หน้าบัตรเครดิต →
                        </Link>
                      )}
                    </div>
                  </Fragment>
                );
              }

              return (
                <div
                  className={`min-h-14 rounded-md border border-border-default bg-surface-2 p-space-4 [scroll-margin-top:calc(var(--topbar-safe-top,90px)+8px)] ${paid ? 'opacity-70' : ''}`}
                  key={item}
                  data-expense-key={item}
                >
                  <div className="flex items-center gap-space-2">
                    <input
                      type="text"
                      value={displayName}
                      onChange={e => handleExpenseChange(item, 'name', e.target.value)}
                      onBlur={e => handleExpenseBlur(item, 'name', e.target.value)}
                      className={`${INPUT} flex-1 font-medium`}
                      placeholder="ชื่อรายการ"
                    />
                    <button
                      type="button"
                      className={REMOVE_BTN}
                      onClick={() => handleDeleteExpenseItem(item)}
                      aria-label={`ลบ ${displayName}`}
                    >
                      <Icons.X size={16} />
                    </button>
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.actual ?? ''}
                    onChange={e => handleNumberInput(e.target.value, (val) => handleExpenseChange(item, 'actual', val))}
                    onBlur={e => handleNumberBlur(e.target.value, (val) => handleExpenseBlur(item, 'actual', val))}
                    onFocus={handleAmountInputFocus}
                    className={`${INPUT} mt-space-3 text-right font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums`}
                    placeholder="0.00"
                  />
                  <div className="mt-space-3 flex gap-space-2">
                    <select
                      value={selectedAccount}
                      onChange={e => handleExpenseChange(item, 'account', e.target.value)}
                      className={`${SELECT} flex-1`}
                    >
                      {bankAccounts.map((account) => (
                        <option key={account} value={account}>{account}</option>
                      ))}
                    </select>
                    <select
                      value={row.dueDay || END_OF_MONTH_DUE_DAY}
                      onChange={e => handleExpenseChange(item, 'dueDay', e.target.value)}
                      className={`${SELECT} flex-1`}
                    >
                      <option value={END_OF_MONTH_DUE_DAY}>สิ้นเดือน</option>
                      {dueDayOptions.map(day => (
                        <option key={day} value={day}>วันที่ {day}</option>
                      ))}
                    </select>
                  </div>
                  {dueInfo.helper && <p className="mt-space-2 text-xs text-tertiary">{dueInfo.helper}</p>}
                  <button
                    type="button"
                    className={`mt-space-3 flex min-h-11 w-full items-center justify-center rounded-sm border px-space-4 text-sm font-semibold ${FOCUS_RING} ${paid ? 'border-pos/40 bg-pos/15 text-pos' : 'border-border-interactive bg-surface-1 text-secondary'}`}
                    onClick={() => handleExpenseChange(item, 'paid', !paid)}
                    aria-pressed={paid}
                  >
                    {paid ? '✓ ชำระแล้ว' : 'ยังไม่ชำระ — แตะเพื่อยืนยัน'}
                  </button>
                </div>
              );
            })}
            {/* Total summary card — K16 live total */}
            <div className={`${CARD} border-accent/40 bg-accent-muted`}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-secondary">ยอดค่าใช้จ่าย</span>
                <span className="font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-primary">{formatCurrency(totalActualValue)}</span>
              </div>
              <div className="mt-space-2 flex items-center justify-between text-sm">
                <span className="text-secondary">ยอดค้างชำระ</span>
                <span className="font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-neg">{formatCurrency(totalUnpaidValue)}</span>
              </div>
            </div>
          </div>

          {/* ตารางสรุปค่าใช้จ่ายแต่ละบัญชี (ใช้งานได้ทุกผู้ใช้) */}
          {shouldShowAccountTable && (
            <div className="mt-space-5">
              <BankAccountTable
                accountSummary={accountSummary}
                prevAccountSummary={prevAccountSummary}
                accounts={bankAccounts}
                onChangeAccounts={handleBankAccountsChange}
                markDirty={markDirty}
              />
            </div>
          )}
        </>
      )}
      {!isLoading && !hasExpenseRows && (
        <div className="rounded-md border border-dashed border-border-default bg-sunken p-space-4 text-sm text-secondary">
          ยังไม่มีรายการค่าใช้จ่ายในเดือนนี้ กด &quot;เพิ่มรายการ&quot; เพื่อเริ่มต้น
        </div>
      )}
    </div>
  );
}
