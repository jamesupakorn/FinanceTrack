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
 */

import { useState, useEffect, useMemo } from 'react';
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
  getDaysInMonth
} from '../../shared/utils/dateUtils';
import BankAccountTable from './BankAccountTable';
import { expenseAPI } from '../../shared/utils/frontend/apiUtils';
import { useSession } from '../contexts/SessionContext';
import { showToast } from '../../shared/utils/frontend/toast';
import styles from '../styles/ExpenseTable.module.css';

const DEFAULT_EXPENSE_KEY_ORDER = DEFAULT_EXPENSE_ITEMS.map(item => item.key);
const DEFAULT_EXPENSE_LABEL_MAP = DEFAULT_EXPENSE_ITEMS.reduce((acc, item) => {
  acc[item.key] = item.label;
  return acc;
}, {});

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DUE_SOON_THRESHOLD_DAYS = 5;

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

export default function ExpenseTable({ selectedMonth, triggerSave }) {
  const [editExpense, setEditExpense] = useState({});
  const [bankAccounts, setBankAccounts] = useState([]);
  const [previousMonthTotal, setPreviousMonthTotal] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [persistedKeys, setPersistedKeys] = useState([]);
  const [pendingScrollKey, setPendingScrollKey] = useState(null);
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
      })
      .catch(() => {
        setPreviousMonthTotal(null);
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
          await fetch('/api/user-bank-accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
    } catch (error) {
      console.error('Error saving expense data:', error);
      showToast('บันทึกไม่สำเร็จ กรุณาลองใหม่', 'error');
    }
  };

  useEffect(() => {
    if (triggerSave) {
      handleSave();
    }
  }, [triggerSave]);
  const sortedExpenseKeys = useMemo(() => {
    const keys = Object.keys(editExpense || {});
    const defaultKeys = DEFAULT_EXPENSE_KEY_ORDER.filter(key => keys.includes(key));
    const customKeys = keys.filter(key => !DEFAULT_EXPENSE_KEY_ORDER.includes(key));
    return [...defaultKeys, ...customKeys];
  }, [editExpense]);

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
    sortedExpenseKeys.forEach(item => {
      const row = editExpense[item];
      if (!row) return;
      const paid = row.paid === true || row.paid === 'true';
      if (paid) return;
      const parsedDate = getDueDateFromDay(row.dueDay, selectedMonth);
      if (!parsedDate) return;
      const resolvedDueDay = resolveDueDayForMonth(row.dueDay, daysInSelectedMonth);
      const diffDays = Math.ceil((parsedDate - today) / DAY_IN_MS);
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
  const monthDiffChipClass = monthDiffStatus === 'positive'
    ? styles.diffChipPositive
    : monthDiffStatus === 'negative'
      ? styles.diffChipNegative
      : styles.diffChipNeutral;
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

  return (
    <div className={styles.expenseTable}>
      <div className={styles.sectionHeader}>
        <div>
          <h3 className={styles.sectionTitle}>รายการค่าใช้จ่าย</h3>
          <p className={styles.sectionSubtitle}>บันทึกยอดค่าใช้จ่ายรายเดือนแบบยอดเดียว</p>
        </div>
        <button type="button" className={styles.addItemButton} onClick={handleAddExpenseItem}>
          + เพิ่มรายการค่าใช้จ่าย
        </button>
      </div>
      {hasExpenseRows && (
        <div className={styles.overviewRow}>
          <div className={styles.overviewCard}>
            <p className={styles.overviewLabel}>ยอดค่าใช้จ่ายรวม</p>
            <p className={styles.overviewValue}>{formatCurrency(totalActualValue)}</p>
            <span className={styles.overviewHint}>
              {typeof previousMonthTotal === 'number'
                ? `เทียบเดือนก่อน ${monthDiffLabel} (เดือนก่อน ${formatCurrency(previousMonthTotal)})`
                : 'สรุปยอดค่าใช้จ่ายทั้งหมดในเดือนนี้'}
            </span>
            <span className={`${styles.diffChip} ${monthDiffChipClass}`}>เปลี่ยนแปลง {monthDiffPercentText}</span>
          </div>
          <div className={`${styles.overviewCard} ${styles.overviewAccent}`}>
            <p className={styles.overviewLabel}>กำหนดชำระถัดไป</p>
            <p className={`${styles.overviewValue} ${styles.nextDueValue}`}>{dueInsights.nextDueLabel}</p>
            <span className={styles.overviewHint}>{dueInsights.nextDueName}</span>
            <span className={`${styles.diffChip} ${styles.diffChipNegative}`}>ยอดค้างชำระ {formatCurrency(totalUnpaidValue)}</span>
            <div className={styles.overviewMeta}>
              <span>{upcomingSummaryText}</span>
              {dueInsights.urgentCount > 0 && (
                <span className={styles.urgentHighlight}>{`เร่งด่วน ${dueInsights.urgentCount}`}</span>
              )}
              {dueInsights.overdueCount > 0 && (
                <span className={styles.overdueHighlight}>{`เกินกำหนด ${dueInsights.overdueCount}`}</span>
              )}
            </div>
          </div>
        </div>
      )}
      {isLoading && !hasExpenseRows && (
        <div className={styles.loadingState}>กำลังโหลดข้อมูล...</div>
      )}
      {hasExpenseRows && (
        <>
          {/* Desktop Table */}
          <div className={styles.hideOnMobile}>
            <div className={styles.tableContainer}>
              <table className={styles.table}>
              <thead className={styles.tableHeader}>
                <tr>
                  <th className={styles.tableHeaderCell}>รายการค่าใช้จ่าย</th>
                  <th className={`${styles.tableHeaderCell} ${styles.right}`}>ยอดค่าใช้จ่าย</th>
                  <th className={styles.tableHeaderCell}>บัญชีที่ใช้จ่าย</th>
                  <th className={styles.tableHeaderCell}>วันครบกำหนด</th>
                  <th className={`${styles.tableHeaderCell} ${styles.center}`}>สถานะชำระ / ยอดค้าง</th>
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
                  return (
                    <tr key={item} className={styles.tableRow} data-expense-key={item}>
                      <td className={styles.tableCell}>
                        <div className={styles.nameCell}>
                          <input
                            type="text"
                            value={displayName}
                            onChange={e => handleExpenseChange(item, 'name', e.target.value)}
                            onBlur={e => handleExpenseBlur(item, 'name', e.target.value)}
                            className={styles.nameInput}
                            placeholder="ชื่อรายการ"
                          />
                          <button
                            type="button"
                            className={styles.rowDeleteButton}
                            onClick={() => handleDeleteExpenseItem(item)}
                          >
                            ลบ
                          </button>
                        </div>
                      </td>
                      <td className={`${styles.tableCell} ${styles.right}`}>
                        <input
                          type="text"
                          value={row.actual ?? ''}
                          onChange={e => handleNumberInput(e.target.value, (val) => handleExpenseChange(item, 'actual', val))}
                          onBlur={e => handleNumberBlur(e.target.value, (val) => handleExpenseBlur(item, 'actual', val))}
                          onFocus={handleAmountInputFocus}
                          className={styles.expenseInput}
                        />
                      </td>
                      <td className={styles.tableCell}>
                        <select
                          value={selectedAccount}
                          onChange={e => handleExpenseChange(item, 'account', e.target.value)}
                          className={styles.dateInput}
                        >
                          {bankAccounts.map((account) => (
                            <option key={account} value={account}>{account}</option>
                          ))}
                        </select>
                      </td>
                      <td className={`${styles.tableCell} ${styles.dateCell}`}>
                        <div className={styles.dueDateWrapper}>
                          <select
                            value={row.dueDay || END_OF_MONTH_DUE_DAY}
                            onChange={e => handleExpenseChange(item, 'dueDay', e.target.value)}
                            className={styles.dateInput}
                          >
                            <option value={END_OF_MONTH_DUE_DAY}>วันสิ้นเดือน</option>
                            {dueDayOptions.map(day => (
                              <option key={day} value={day}>{day}</option>
                            ))}
                          </select>
                          <div className={styles.dueMeta}>
                            <span className={styles.dueBadge} data-status={dueInfo.status}>{dueInfo.badge}</span>
                            {dueInfo.helper && <span className={styles.dueHelper}>{dueInfo.helper}</span>}
                          </div>
                        </div>
                      </td>
                      <td className={`${styles.tableCell} ${styles.center} ${styles.checkboxCell}`}>
                        <label className={styles.checkboxLabel}>
                          <input
                            type="checkbox"
                            checked={paid}
                            onChange={e => handleExpenseChange(item, 'paid', e.target.checked)}
                          />
                        </label>
                      </td>
                    </tr>
                  );
                })}
                <tr className={styles.totalRow}>
                  <td className={styles.totalCell}>ยอดรวม</td>
                  <td className={`${styles.totalCell} ${styles.right}`}>{formatCurrency(totalActualValue)}</td>
                  <td className={styles.totalCell}></td>
                  <td className={`${styles.totalCell} ${styles.center}`}>รวมค้างชำระ</td>
                  <td className={`${styles.totalCell} ${styles.center}`}>{formatCurrency(totalUnpaidValue)}</td>
                </tr>
              </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card List */}
          <div className={styles.mobileCardList + ' ' + styles.hideOnDesktop}>
            {sortedExpenseKeys.map(item => {
              const row = editExpense[item] || {};
              const paid = row.paid === true || row.paid === 'true';
              const displayName = row.name ?? DEFAULT_EXPENSE_LABEL_MAP[item] ?? 'รายการใหม่';
              const selectedAccount = (typeof row.account === 'string' && row.account.trim().length > 0)
                ? row.account
                : (bankAccounts[0] || 'ไม่ระบุบัญชี');
              const dueInfo = describeDueTiming(row.dueDay, paid, selectedMonth);
              return (
                <div className={`${styles.expenseCard} ${paid ? styles.expenseCardPaid : ''}`} key={item} data-expense-key={item}>
                  {/* ชื่อ + ลบ */}
                  <div className={styles.cardHeaderRow}>
                    <input
                      type="text"
                      value={displayName}
                      onChange={e => handleExpenseChange(item, 'name', e.target.value)}
                      onBlur={e => handleExpenseBlur(item, 'name', e.target.value)}
                      className={styles.cardNameInput}
                      placeholder="ชื่อรายการ"
                    />
                    <button
                      type="button"
                      className={styles.cardDeleteBtn}
                      onClick={() => handleDeleteExpenseItem(item)}
                    >
                      ✕
                    </button>
                  </div>
                  {/* ยอด */}
                  <input
                    type="text"
                    value={row.actual ?? ''}
                    onChange={e => handleNumberInput(e.target.value, (val) => handleExpenseChange(item, 'actual', val))}
                    onBlur={e => handleNumberBlur(e.target.value, (val) => handleExpenseBlur(item, 'actual', val))}
                    onFocus={handleAmountInputFocus}
                    className={styles.cardAmountInput}
                    placeholder="0.00"
                  />
                  {/* บัญชี + วันครบ */}
                  <div className={styles.cardMetaRow}>
                    <select
                      value={selectedAccount}
                      onChange={e => handleExpenseChange(item, 'account', e.target.value)}
                      className={styles.cardSelect}
                    >
                      {bankAccounts.map((account) => (
                        <option key={account} value={account}>{account}</option>
                      ))}
                    </select>
                    <select
                      value={row.dueDay || END_OF_MONTH_DUE_DAY}
                      onChange={e => handleExpenseChange(item, 'dueDay', e.target.value)}
                      className={styles.cardSelect}
                    >
                      <option value={END_OF_MONTH_DUE_DAY}>สิ้นเดือน</option>
                      {dueDayOptions.map(day => (
                        <option key={day} value={day}>วันที่ {day}</option>
                      ))}
                    </select>
                  </div>
                  {dueInfo.helper && (
                    <span className={styles.dueHelper}>{dueInfo.helper}</span>
                  )}
                  {/* toggle full-width */}
                  <button
                    type="button"
                    className={`${styles.paidToggle} ${paid ? styles.paidToggleOn : ''}`}
                    onClick={() => handleExpenseChange(item, 'paid', !paid)}
                  >
                    {paid ? '✓ ชำระแล้ว' : 'ยังไม่ชำระ — แตะเพื่อยืนยัน'}
                  </button>
                </div>
              );
            })}
            {/* Total summary card */}
            <div className={styles.expenseCard + ' ' + styles.totalCard}>
              <div className={styles.cardRow}><span className={styles.cardLabel}>ยอดรวม</span></div>
              <div className={styles.cardRow}><span className={styles.cardLabel}>ยอดค่าใช้จ่าย</span><span>{formatCurrency(totalActualValue)}</span></div>
              <div className={styles.cardRow}><span className={styles.cardLabel}>ยอดค้างชำระ</span><span>{formatCurrency(totalUnpaidValue)}</span></div>
            </div>
          </div>
          {/* ตารางสรุปค่าใช้จ่ายแต่ละบัญชี (ใช้งานได้ทุกผู้ใช้) */}
          {shouldShowAccountTable && (
            <BankAccountTable
              accountSummary={accountSummary}
              accounts={bankAccounts}
              onChangeAccounts={handleBankAccountsChange}
            />
          )}
        </>
      )}
      {!isLoading && !hasExpenseRows && (
        <div className={styles.emptyState}>ยังไม่มีรายการค่าใช้จ่ายในเดือนนี้ กด "เพิ่มรายการ" เพื่อเริ่มต้น</div>
      )}
    </div>
  );
}