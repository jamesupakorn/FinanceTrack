/**
 * คอมโพเนนต์: MonthManager
 * ตัวเลือกเดือนแบบเต็มที่ซ่อนอยู่หลัง tap-to-open พร้อมเพิ่ม/คัดลอกเดือน
 */

import { useState, useEffect, useMemo, useRef, type MouseEvent, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { getNextMonth } from '../../shared/utils/frontend/numberUtils';
import { getMonthData, getPrevMonth, formatMonthLabelTH } from '../../shared/utils/frontend/monthUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';
import { stripLegacyOvertimeKeys } from '../../shared/utils/overtimeUtils';
import { Icons } from './Icons';

interface MonthManagerProps {
  selectedMonth: string | null;
  onMonthSelected: (month: string) => void;
  onDataRefresh: () => void;
  months: string[];
  open: boolean;
  onRequestClose?: () => void;
}

type PendingAction = '' | 'create' | 'copy';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const INPUT = `h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-base text-primary outline-none ${FOCUS_RING}`;
const GHOST_BTN = `min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 py-space-3 text-left disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS_RING}`;
const SECONDARY_BTN = `min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary disabled:opacity-50 ${FOCUS_RING}`;
const PRIMARY_BTN = `min-h-11 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent disabled:opacity-60 ${FOCUS_RING}`;

// keep in sync with SHARED_WINDOW_LIMIT in src/shared/utils/backend/sharedMonthWindow.ts
const MONTH_WINDOW_LIMIT = 15;
const DANGER_BTN = `min-h-11 rounded-sm border border-neg/40 bg-neg/10 px-space-4 text-sm font-medium text-neg disabled:opacity-60 ${FOCUS_RING}`;

interface PruneConfirmState {
  month: string;
  pruned: string[];
}

const isValidMonth = (month: string): boolean => {
  if (!/^\d{4}-\d{2}$/.test(month)) return false;
  const [, monthNumber] = month.split('-').map(Number);
  return monthNumber >= 1 && monthNumber <= 12;
};

function resetCopiedExpensePaidStatus(expenseData: unknown): Record<string, unknown> {
  if (!expenseData || typeof expenseData !== 'object' || Array.isArray(expenseData)) return {};
  const normalized: Record<string, unknown> = {};
  Object.entries(expenseData).forEach(([key, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      normalized[key] = value;
      return;
    }
    normalized[key] = { ...value, paid: false };
  });
  return normalized;
}

export default function MonthManager({
  selectedMonth,
  onMonthSelected,
  onDataRefresh,
  months,
  open,
  onRequestClose
}: MonthManagerProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [showCopyConfirmation, setShowCopyConfirmation] = useState(false);
  const [newMonthName, setNewMonthName] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction>('');
  const pendingRef = useRef<PendingAction>('');
  const [pruneConfirm, setPruneConfirm] = useState<PruneConfirmState | null>(null);
  const pruneDialogRef = useRef<HTMLDivElement | null>(null);
  const pruneCancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const pruneTriggerRef = useRef<HTMLElement | null>(null);

  const copyDialogRef = useRef<HTMLDivElement | null>(null);
  const copyCancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const copyTriggerRef = useRef<HTMLElement | null>(null);
  const addFormDialogRef = useRef<HTMLDivElement | null>(null);
  const addFormCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const addFormTriggerRef = useRef<HTMLElement | null>(null);
  const pickerDialogRef = useRef<HTMLDivElement | null>(null);
  const pickerCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const pickerTriggerRef = useRef<HTMLElement | null>(null);

  const monthOptions = useMemo(
    () => (months || []).map(month => ({ value: month, label: formatMonthLabelTH(month) })),
    [months]
  );

  useEffect(() => {
    if (monthOptions.length > 0) {
      const monthValues = monthOptions.map(option => option.value);
      if (!selectedMonth || !monthValues.includes(selectedMonth)) onMonthSelected(monthOptions[0].value);
    }
  }, [monthOptions, selectedMonth, onMonthSelected]);

  useEffect(() => {
    if (!open) {
      setShowAddForm(false);
      setShowCopyConfirmation(false);
      setPruneConfirm(null);
    }
  }, [open]);

  useEffect(() => {
    if ((!open && !showAddForm && !showCopyConfirmation) || typeof document === 'undefined') return undefined;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => { body.style.overflow = previousOverflow; };
  }, [open, showAddForm, showCopyConfirmation]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    pickerTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = setTimeout(() => pickerCloseButtonRef.current?.focus(), 40);
    return () => {
      clearTimeout(timer);
      const opener = pickerTriggerRef.current;
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || showAddForm || showCopyConfirmation || typeof document === 'undefined') return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onRequestClose?.();
        return;
      }
      if (event.key !== 'Tab' || !pickerDialogRef.current) return;
      const focusable = getTabbableElements(pickerDialogRef.current);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, showAddForm, showCopyConfirmation, onRequestClose]);

  useEffect(() => {
    if (!showAddForm || typeof document === 'undefined') return undefined;
    addFormTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = setTimeout(() => addFormCloseButtonRef.current?.focus(), 40);
    return () => {
      clearTimeout(timer);
      const opener = addFormTriggerRef.current;
      if (opener?.isConnected) opener.focus();
    };
  }, [showAddForm]);

  useEffect(() => {
    if (!showAddForm || typeof document === 'undefined') return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setShowAddForm(false);
        return;
      }
      if (event.key !== 'Tab' || !addFormDialogRef.current) return;
      const focusable = getTabbableElements(addFormDialogRef.current);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showAddForm]);

  useEffect(() => {
    if (!showCopyConfirmation || typeof document === 'undefined') return undefined;
    copyTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = setTimeout(() => copyCancelButtonRef.current?.focus(), 40);
    return () => {
      clearTimeout(timer);
      const opener = copyTriggerRef.current as (HTMLElement & { disabled?: boolean }) | null;
      if (opener?.isConnected && !opener.disabled) opener.focus();
    };
  }, [showCopyConfirmation]);

  useEffect(() => {
    if (!showCopyConfirmation || typeof document === 'undefined') return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setShowCopyConfirmation(false);
        return;
      }
      if (event.key !== 'Tab' || !copyDialogRef.current) return;
      const focusable = getTabbableElements(copyDialogRef.current);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showCopyConfirmation]);

  const showPruneConfirm = Boolean(pruneConfirm);

  useEffect(() => {
    if (!showPruneConfirm || typeof document === 'undefined') return undefined;
    pruneTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = setTimeout(() => pruneCancelButtonRef.current?.focus(), 40);
    return () => {
      clearTimeout(timer);
      const opener = pruneTriggerRef.current as (HTMLElement & { disabled?: boolean }) | null;
      if (opener?.isConnected && !opener.disabled) opener.focus();
    };
  }, [showPruneConfirm]);

  useEffect(() => {
    if (!showPruneConfirm || typeof document === 'undefined') return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setPruneConfirm(null);
        return;
      }
      if (event.key !== 'Tab' || !pruneDialogRef.current) return;
      event.stopPropagation();
      const focusable = getTabbableElements(pruneDialogRef.current);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    // capture: ให้ dialog นี้รับ Escape ก่อน handler ของฟอร์มเพิ่มเดือนที่เปิดค้างอยู่ด้านล่าง
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [showPruneConfirm]);

  const startPendingAction = (action: Exclude<PendingAction, ''>) => {
    if (pendingRef.current) return false;
    pendingRef.current = action;
    setPendingAction(action);
    return true;
  };

  const clearPendingAction = () => {
    pendingRef.current = '';
    setPendingAction('');
  };

  const createEmptyMonth = async (month: string, confirmed = false): Promise<boolean> => {
    if (!isValidMonth(month)) {
      showToast('รูปแบบเดือนไม่ถูกต้อง กรุณาเลือกเดือนที่ถูกต้อง', 'error');
      return false;
    }
    if (monthOptions.some(option => option.value === month)) {
      showToast(`มีข้อมูลเดือน ${formatMonthLabelTH(month)} อยู่แล้ว`, 'info');
      onMonthSelected(month);
      setShowAddForm(false);
      onRequestClose?.();
      return false;
    }
    // เดือนว่างที่ไกลกว่าเดือนปัจจุบัน+1 ถูก server ข้ามในการจัดอันดับหน้าต่าง (ไม่ลบเดือนเก่า) — ไม่ต้องเตือนการลบ
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const skippedByServerWindow = month > getNextMonth(currentMonth);
    if (!confirmed && !skippedByServerWindow && monthOptions.length + 1 > MONTH_WINDOW_LIMIT) {
      // คาดการณ์เท่านั้น: รายการ UI รวม 5 collection (รวม savings) แต่หน้าต่างฝั่ง server ครอบคลุม 4
      const pruned = [...monthOptions.map(option => option.value), month]
        .sort((a, b) => b.localeCompare(a))
        .slice(MONTH_WINDOW_LIMIT);
      if (pruned.includes(month)) {
        showToast(`เพิ่มเดือน ${formatMonthLabelTH(month)} ไม่ได้ เพราะเก่ากว่าช่วง ${MONTH_WINDOW_LIMIT} เดือนล่าสุดและจะถูกลบทันที`, 'error');
        return false;
      }
      setPruneConfirm({ month, pruned });
      return false;
    }
    setPruneConfirm(null);
    if (!startPendingAction('create')) return false;
    try {
      const { expenseAPI, incomeAPI, salaryAPI, savingsAPI, investmentAPI } = await import('../../shared/utils/frontend/apiUtils');
      await Promise.all([
        expenseAPI.save(month, {}),
        incomeAPI.save(month, {}),
        salaryAPI.save(month, {}, {}, ''),
        savingsAPI.saveList ? savingsAPI.saveList(month, []) : Promise.resolve(),
        investmentAPI.saveList ? investmentAPI.saveList(month, []) : Promise.resolve()
      ]);
      onMonthSelected(month);
      onDataRefresh();
      setShowAddForm(false);
      setNewMonthName('');
      showToast(`เพิ่มเดือน ${formatMonthLabelTH(month)} แล้ว`, 'success');
      return true;
    } catch (error) {
      const message = (error as { message?: string } | null)?.message;
      showToast(message || 'สร้างเดือนใหม่ไม่สำเร็จ', 'error');
      return false;
    } finally {
      clearPendingAction();
    }
  };

  const handleAddNewMonth = () => createEmptyMonth(getNextMonth(selectedMonth || ''));

  const handleCopyPrevMonth = () => {
    if (!selectedMonth || !isValidMonth(selectedMonth)) {
      showToast('กรุณาเลือกเดือนที่ต้องการก่อน', 'info');
      return;
    }
    if (pendingRef.current) return;
    setShowCopyConfirmation(true);
  };

  const confirmCopyPrevMonth = async () => {
    setShowCopyConfirmation(false);
    if (!selectedMonth || !startPendingAction('copy')) return;
    try {
      const prevMonth = getPrevMonth(selectedMonth);
      const { expenseAPI, incomeAPI, salaryAPI, savingsAPI, investmentAPI, dailyExpenseAPI } = await import('../../shared/utils/frontend/apiUtils');
      const [expenseAll, incomeAll, salaryPrevDoc, savingsAll, investmentAll, dailyExpensePrevDoc] = await Promise.all([
        expenseAPI.getAll(),
        incomeAPI.getAll(),
        salaryAPI.getByMonth(prevMonth),
        savingsAPI.getAll ? savingsAPI.getAll() : Promise.resolve({}),
        investmentAPI.getAll ? investmentAPI.getAll() : Promise.resolve({}),
        dailyExpenseAPI.getByMonth(prevMonth)
      ]);
      const expensePrev = resetCopiedExpensePaidStatus(getMonthData(expenseAll, prevMonth));
      const incomePrev = getMonthData(incomeAll, prevMonth);
      let savingsPrev: unknown[] = [];
      const legacySavingsData = savingsAll as unknown as { savings_list?: Record<string, unknown> } | null;
      if (legacySavingsData?.savings_list?.[prevMonth]) savingsPrev = JSON.parse(JSON.stringify(legacySavingsData.savings_list[prevMonth])) as unknown[];
      let investmentPrev: unknown[] = [];
      if (investmentAll?.[prevMonth]) investmentPrev = JSON.parse(JSON.stringify(investmentAll[prevMonth])) as unknown[];
      const dailyExpensePrev = dailyExpensePrevDoc?.items || [];
      await Promise.all([
        expenseAPI.save(selectedMonth, expensePrev),
        incomeAPI.save(selectedMonth, incomePrev),
        salaryAPI.save(
          selectedMonth,
          stripLegacyOvertimeKeys(salaryPrevDoc?.income || {}),
          salaryPrevDoc?.deduct || {},
          salaryPrevDoc?.note || '',
          salaryPrevDoc?.overtime || []
        ),
        savingsAPI.saveList ? savingsAPI.saveList(selectedMonth, savingsPrev) : Promise.resolve(),
        investmentAPI.saveList ? investmentAPI.saveList(selectedMonth, investmentPrev) : Promise.resolve(),
        dailyExpenseAPI.save(selectedMonth, dailyExpensePrev)
      ]);
      onMonthSelected(selectedMonth);
      onDataRefresh();
      showToast(`คัดลอกข้อมูลจาก ${formatMonthLabelTH(prevMonth)} แล้ว`, 'success');
    } catch (error) {
      const message = (error as { message?: string } | null)?.message; // ApiValidationError.message = field path + message
      showToast(message || 'คัดลอกข้อมูลจากเดือนก่อนหน้าไม่สำเร็จ', 'error');
    } finally {
      clearPendingAction();
    }
  };

  const handleCustomMonth = () => {
    const month = newMonthName.trim();
    if (!isValidMonth(month)) {
      showToast('รูปแบบไม่ถูกต้อง กรุณากรอก YYYY-MM เช่น 2025-10', 'error');
      return undefined;
    }
    return createEmptyMonth(month);
  };

  const handleSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onMonthSelected(event.target.value);
    onRequestClose?.();
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-canvas/70 px-space-4 py-space-6" role="presentation" onMouseDown={(event: MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) onRequestClose?.(); }}>
        <div ref={pickerDialogRef} role="dialog" aria-modal="true" aria-labelledby="month-picker-title" className="mt-[calc(var(--topbar-safe-top,90px)+8px)] w-full max-w-sm rounded-lg border border-border-default bg-surface-3 p-space-4 shadow-elev-3">
          <div className="mb-space-4 flex items-center justify-between"><h2 id="month-picker-title" className="text-lg font-medium text-primary">เลือกเดือน</h2><button ref={pickerCloseButtonRef} type="button" onClick={onRequestClose} aria-label="ปิดตัวเลือกเดือน" className={`flex h-11 w-11 items-center justify-center rounded-full text-secondary hover:bg-surface-2 ${FOCUS_RING}`}><Icons.X size={18} /></button></div>
          <div className="mb-space-5">
            <label htmlFor="month-picker-select" className="mb-space-2 block text-sm text-secondary">เดือนที่กำลังวางแผน</label>
            <select id="month-picker-select" value={selectedMonth ?? ''} onChange={handleSelectChange} className={INPUT}>{monthOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            <p className="mt-space-2 text-xs text-tertiary">เลือกเดือนเพื่อดูและวางแผนการเงิน</p>
          </div>
          <div>
            <p className="text-sm font-medium text-primary">เริ่มต้นแผนของเดือน</p><p className="mb-space-3 text-xs text-tertiary">สร้างเดือนใหม่หรือใช้ข้อมูลเดือนก่อนหน้าเป็นจุดเริ่มต้น</p>
            <div className="flex flex-col gap-space-2">
              <button type="button" onClick={() => setShowAddForm(true)} className={GHOST_BTN} aria-label="เพิ่มเดือนใหม่" disabled={Boolean(pendingAction)} aria-busy={pendingAction === 'create'}><span className="block text-sm font-medium text-primary">+ เพิ่มเดือนใหม่</span><span className="block text-xs text-tertiary">สร้างเดือนถัดไปพร้อมหน้ากระดาษว่าง</span></button>
              <button type="button" onClick={handleCopyPrevMonth} className={GHOST_BTN} aria-label="คัดลอกข้อมูลจากเดือนก่อนหน้า" disabled={Boolean(pendingAction)} aria-busy={pendingAction === 'copy'}><span className="block text-sm font-medium text-primary">ดึงข้อมูลจากเดือนก่อนหน้า</span><span className="block text-xs text-tertiary">คัดลอกทุกรายการมาแก้ไขต่อได้ทันที</span></button>
            </div>
          </div>
        </div>
      </div>

      {showAddForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 px-space-4" role="presentation">
        <div ref={addFormDialogRef} className="w-full max-w-sm rounded-lg border border-border-default bg-surface-3 p-space-4 shadow-elev-3" tabIndex={-1} aria-modal="true" role="dialog" aria-label="เพิ่มเดือนใหม่">
          <div className="mb-space-3 flex items-center justify-between"><h4 className="text-lg font-medium text-primary">เพิ่มเดือนใหม่</h4><button ref={addFormCloseButtonRef} className={`flex h-11 w-11 items-center justify-center rounded-full text-secondary hover:bg-surface-2 ${FOCUS_RING}`} aria-label="ปิดหน้าต่าง" onClick={() => setShowAddForm(false)} type="button" tabIndex={0}><Icons.X size={18} /></button></div>
          <button onClick={() => void handleAddNewMonth()} className={`${SECONDARY_BTN} mb-space-3 w-full`} aria-label={`เพิ่มเดือนถัดไป (${getNextMonth(selectedMonth || '')})`} disabled={Boolean(pendingAction)} type="button" tabIndex={0}>เดือนถัดไป ({getNextMonth(selectedMonth || '')})</button>
          <div className="mb-space-3 flex gap-space-2"><input type="text" placeholder="YYYY-MM (เช่น 2025-10)" value={newMonthName} onChange={event => setNewMonthName(event.target.value)} className={INPUT} aria-label="กรอกเดือนใหม่ (YYYY-MM)" tabIndex={0} /><button onClick={() => void handleCustomMonth()} className={`${PRIMARY_BTN} shrink-0`} aria-label="เพิ่มเดือนที่กรอกเอง" disabled={Boolean(pendingAction)} type="button" tabIndex={0}>เพิ่ม</button></div>
          <button onClick={() => setShowAddForm(false)} className={`${SECONDARY_BTN} w-full`} aria-label="ยกเลิก" type="button" tabIndex={0}>ยกเลิก</button>
        </div>
      </div>}

      {showCopyConfirmation && <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 px-space-4" role="presentation" onMouseDown={(event: MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) setShowCopyConfirmation(false); }}>
        <div ref={copyDialogRef} className="w-full max-w-sm rounded-lg border border-border-default bg-surface-3 p-space-4 shadow-elev-3" role="alertdialog" aria-modal="true" aria-labelledby="copy-month-title" aria-describedby="copy-month-description">
          <h4 id="copy-month-title" className="mb-space-2 text-lg font-medium text-primary">เขียนทับข้อมูลเดือนนี้?</h4>
          <p id="copy-month-description" className="mb-space-4 text-sm text-secondary">ข้อมูลของ {formatMonthLabelTH(selectedMonth || '')} จะถูกแทนที่ด้วยข้อมูลจาก {formatMonthLabelTH(getPrevMonth(selectedMonth || ''))}</p>
          <div className="flex justify-end gap-space-2"><button ref={copyCancelButtonRef} type="button" className={SECONDARY_BTN} onClick={() => setShowCopyConfirmation(false)} tabIndex={0}>ยกเลิก</button><button type="button" className={PRIMARY_BTN} onClick={() => void confirmCopyPrevMonth()} tabIndex={0}>เขียนทับและคัดลอก</button></div>
        </div>
      </div>}

      {pruneConfirm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 px-space-4" role="presentation" onMouseDown={(event: MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) setPruneConfirm(null); }}>
        <div ref={pruneDialogRef} className="w-full max-w-sm rounded-lg border border-border-default bg-surface-3 p-space-4 shadow-elev-3" role="alertdialog" aria-modal="true" aria-labelledby="prune-month-title" aria-describedby="prune-month-description">
          <h4 id="prune-month-title" className="mb-space-2 text-lg font-medium text-primary">เพิ่ม {formatMonthLabelTH(pruneConfirm.month)} แล้วลบเดือนเก่า?</h4>
          <div id="prune-month-description" className="mb-space-4 text-sm text-secondary">
            <p className="mb-space-2">ระบบเก็บข้อมูลได้ {MONTH_WINDOW_LIMIT} เดือนล่าสุด เดือนต่อไปนี้จะถูกลบถาวรและกู้คืนไม่ได้:</p>
            <ul className="mb-space-2 list-disc pl-space-5 text-primary">{pruneConfirm.pruned.map(month => <li key={month}>{formatMonthLabelTH(month)}</li>)}</ul>
            <p className="text-xs text-tertiary">รายการนี้เป็นการคาดการณ์ อาจมีข้อมูลบางส่วน (เช่น เงินออม) ที่ถูกจำกัดแยกต่างหาก</p>
          </div>
          <div className="flex flex-wrap justify-end gap-space-2"><button ref={pruneCancelButtonRef} type="button" className={SECONDARY_BTN} onClick={() => setPruneConfirm(null)}>ยกเลิก</button><button type="button" className={DANGER_BTN} disabled={Boolean(pendingAction)} onClick={() => void createEmptyMonth(pruneConfirm.month, true)}>ลบเดือนเก่าและเพิ่มเดือนใหม่</button></div>
        </div>
      </div>}
    </>,
    document.body
  );
}