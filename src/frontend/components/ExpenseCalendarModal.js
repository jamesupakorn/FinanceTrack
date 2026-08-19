/**
 * คอมโพเนนต์: ExpenseCalendarModal
 * เชลล์ของปฏิทินรวมค่าใช้จ่าย — backdrop, focus trap, Esc-to-close, คืน focus ให้ปุ่มที่เปิด
 * เป็นเจ้าของ monthKey + การดึงข้อมูล + การ derive เหตุการณ์ + ตัวจัดการ toggle ทั้งหมด
 * (ExpenseCalendar.js เป็นแค่ presentational — ADR-012)
 *
 * แหล่งข้อมูลเหตุการณ์ "ครบกำหนดชำระ" มาจาก monthly_expense เท่านั้น (expenseAPI.getAll())
 * ซึ่งรวมแถว cci_/ccr_ ไว้แล้วตั้งแต่ Feature 1 — ห้าม derive due-event จาก plans/cycles ตรง ๆ
 * เพราะจะนับซ้ำ (BR-CC-019 / AC-65) cards/plans ใช้แค่ตกแต่ง (ชื่อ/สี/งวด n/N) และเป็น action target
 *
 * focus trap / Esc / focus-restore คัดลอกรูปแบบมาจาก CreditCardForm.js:78-106 (ไม่ได้คิดใหม่)
 * ต่างจากต้นแบบ 2 จุด เพราะที่นี่มีกล่องยืนยันซ้อนอยู่ (RevolvingConfirmDialog):
 * 1) การคืน focus ให้ปุ่มที่เปิด แยกไปอยู่ใน effect ที่ผูกกับ [open] อย่างเดียว — ต้นแบบรวมไว้ใน
 *    cleanup ของ effect เดียวกับ keydown ได้เพราะ dep เปลี่ยนเฉพาะตอนปิด แต่ที่นี่ dep มี
 *    confirmState/handleClose ซึ่งเปลี่ยนระหว่างโมดัลยังเปิดอยู่ (React เรียก cleanup ทุกครั้งที่ dep เปลี่ยน)
 * 2) กล่องยืนยันเป็นเจ้าของปุ่ม Esc ของตัวเอง แต่ Tab ต้องถูกดักตลอดเวลา และดักที่กล่องบนสุด
 * 3) รายการ focusable ต้องกรองเหลือเฉพาะตัวที่ Tab ไปถึงได้จริง (getTabbableElements) เพราะปฏิทิน
 *    ใช้ roving tabindex บนปุ่มวัน ซึ่งต้นแบบไม่มี — selector ของต้นแบบอย่างเดียวจะทำให้ trap รั่ว
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ExpenseCalendar from './ExpenseCalendar';
import { Icons } from './Icons';
import { expenseAPI, creditCardAPI } from '../../shared/utils/frontend/apiUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import { formatCurrency, parseToNumber } from '../../shared/utils/frontend/numberUtils';
import { resolveDueDayForMonth } from '../../shared/utils/dateUtils';
import {
  addMonths,
  getCurrentMonthKey,
  getDaysInMonthKey,
  round2,
  isRevolvingRowKey,
  isInstallmentRowKey,
  parseRevolvingRowKey,
  parseInstallmentRowKey,
  PLAN_STATUS
} from '../../shared/utils/creditCardUtils';
import cardStyles from '../styles/CreditCard.module.css';
import formStyles from '../styles/CreditCardForm.module.css';
import calStyles from '../styles/ExpenseCalendar.module.css';

// ฟิลด์ระบบที่ไม่ใช่แถวค่าใช้จ่าย — ชุดเดียวกับ EXPENSE_IGNORED_FIELDS ของ line_due_notify.js:51-58
const IGNORED_ROW_KEYS = new Set([
  '_id', 'month', 'userId', 'periodKey', 'accountSummary', 'totalActualPaid', 'bankAccounts'
]);

// selector กว้างไว้ก่อน แล้วค่อยกรองด้วยความจริงของ element ทีหลัง (ดู getTabbableElements)
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]'
].join(', ');

/**
 * element ที่ลำดับ Tab ของเบราว์เซอร์ไปถึงได้ "จริง" ตามลำดับ DOM
 *
 * ต้องกรองเอง ไม่ใช้แค่ selector: ตะแกรงวันของ ExpenseCalendar เป็น <button> ที่ใช้ roving tabindex
 * (tabIndex = -1 ทุกวันยกเว้นวันที่เลือก) selector อย่างเดียวจึงจับวันที่ Tab ไปไม่ถึงมาด้วยทั้งเดือน
 * ทำให้ last ของ focus trap กลายเป็นวันสุดท้ายของเดือน เงื่อนไขวนกลับไม่มีวันเป็นจริง แล้ว Tab
 * เดินหลุดออกไปโดนปุ่มของหน้าเบื้องหลัง (เช่น "บันทึก" ของ floating bar ใน /edit)
 * เกณฑ์จึงเป็น "tabIndex >= 0 และมองเห็นอยู่" ซึ่งครอบคลุม element ที่ตั้งใจข้ามจาก trap ทุกแบบ
 */
function getTabbableElements(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(element => (
    !element.disabled
    && element.tabIndex >= 0
    // display:none → ไม่มีทั้ง offsetParent และกล่องเรขาคณิต; position:fixed → ไม่มี offsetParent แต่ยังมีกล่อง
    && (element.offsetParent !== null || element.getClientRects().length > 0)
  ));
}

/**
 * กล่องยืนยัน "จ่ายขั้นต่ำ" — เพราะมันสร้างหนี้ยกไปเดือนหน้าพร้อมดอกเบี้ย (BR-CC-015)
 * รูปแบบเดียวกับ ConfirmDialog ใน pages/credit-cards.js ใช้คลาสร่วมจาก CreditCardForm.module.css
 * ตัวเลขทุกตัวมาจาก minimumPreview ที่ server คำนวณให้ — ไม่คำนวณเงินเอง (ADR-011)
 */
function RevolvingConfirmDialog({
  open, dialogRef, restoreFocusRef, cardName, minPaymentDue, preview, busy, onCancel, onConfirm
}) {
  const cancelButtonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel?.();
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [open, onCancel]);

  // ย้าย focus เข้ากล่องนี้ทันทีที่เปิด ไม่งั้น screen reader ไม่ประกาศ alertdialog เลย (BR-CC-015)
  // ปุ่ม "จ่ายขั้นต่ำ" ถูก disable ระหว่างรอ preview เบราว์เซอร์จึงทิ้ง focus ไว้ที่ <body> ก่อนกล่องนี้เปิด
  // หน่วง 40ms รูปแบบเดียวกับโมดัลหลัก (ให้ผ่านช่วง mount) และผูก dep กับ [open] เท่านั้นตามบทเรียน BUG-2
  useEffect(() => {
    if (!open) return undefined;
    const opener = typeof document !== 'undefined' ? document.activeElement : null;
    const timer = setTimeout(() => cancelButtonRef.current?.focus(), 40);
    return () => {
      clearTimeout(timer);
      // ปิดกล่อง: คืน focus ให้ปุ่มเดิมถ้ายังกดได้จริง ไม่งั้นให้ปุ่มปิดของปฏิทิน — ห้ามปล่อยตกไปที่ <body>
      // ถ้าปฏิทินกำลังปิดตามไปด้วย ปุ่มปิดจะหลุดจาก DOM แล้ว จึงข้ามไป ปล่อยให้ effect ของโมดัลหลัก
      // คืน focus ให้ปุ่มที่เปิดปฏิทินตามเดิม (อย่าไปแย่งงานของมัน)
      const usableOpener = opener && opener !== document.body && opener.isConnected && !opener.disabled;
      const fallback = restoreFocusRef?.current?.isConnected ? restoreFocusRef.current : null;
      const target = usableOpener ? opener : fallback;
      target?.focus?.();
    };
  }, [open, restoreFocusRef]);

  if (!open) return null;

  const message = `จ่าย ${formatCurrency(minPaymentDue)} ฿ วันนี้ · ยอด ${formatCurrency(preview?.remaining)} ฿ `
    + `จะถูกยกไปเดือนหน้าพร้อมดอกเบี้ย ${formatCurrency(preview?.interest)} ฿ (รวม ${formatCurrency(preview?.closingBalance)} ฿)`;

  return (
    <div className={formStyles.backdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel?.();
    }}>
      <div
        ref={dialogRef}
        className={`${formStyles.modal} ${formStyles.modalNarrow}`}
        role="alertdialog"
        aria-modal="true"
        aria-label={`จ่ายขั้นต่ำ · ${cardName || ''}`}
      >
        <div className={formStyles.modalHeader}>
          <h2 className={formStyles.modalTitle}>{`จ่ายขั้นต่ำ · ${cardName || ''}`}</h2>
          <button type="button" className={formStyles.closeButton} onClick={onCancel} aria-label="ปิด">
            <Icons.X size={18} />
          </button>
        </div>
        <div className={formStyles.modalBody}>
          <p className={formStyles.confirmText}>{message}</p>
        </div>
        <div className={formStyles.modalFooter}>
          <button ref={cancelButtonRef} type="button" className={formStyles.secondaryButton} onClick={onCancel}>ยกเลิก</button>
          <button type="button" className={formStyles.dangerButton} onClick={onConfirm} disabled={busy}>
            {busy ? 'กำลังดำเนินการ...' : 'ยืนยันจ่ายขั้นต่ำ'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ExpenseCalendarModal({ open, onClose }) {
  const [monthKey, setMonthKey] = useState(() => getCurrentMonthKey());
  const [monthsMap, setMonthsMap] = useState({});
  const [cards, setCards] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pendingKeys, setPendingKeys] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const dialogRef = useRef(null);
  const confirmDialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const triggerRef = useRef(null);
  const changedRef = useRef(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [expenseRes, cardsRes, plansRes] = await Promise.all([
        expenseAPI.getAll(),
        creditCardAPI.getCards(),
        creditCardAPI.getPlans()
      ]);
      setMonthsMap(expenseRes?.months && typeof expenseRes.months === 'object' ? expenseRes.months : {});
      setCards(Array.isArray(cardsRes?.cards) ? cardsRes.cards : []);
      setPlans(Array.isArray(plansRes?.plans) ? plansRes.plans : []);
    } catch (err) {
      console.error('Error loading calendar data:', err);
      setError('โหลดข้อมูลปฏิทินไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleClose = useCallback(() => {
    const changed = changedRef.current;
    changedRef.current = false;
    onClose?.({ changed });
  }, [onClose]);

  // เปิดโมดัล: จำปุ่มที่เปิด, กลับไปเดือนปัจจุบันเสมอ (J11), โหลดข้อมูลใหม่ 1 ครั้งต่อการเปิด
  useEffect(() => {
    if (!open) return undefined;
    triggerRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    setMonthKey(getCurrentMonthKey());
    setConfirmState(null);
    changedRef.current = false;
    loadData();
    const timer = setTimeout(() => closeButtonRef.current?.focus(), 40);
    return () => clearTimeout(timer);
  }, [open, loadData]);

  // ล็อก scroll ของหน้าเบื้องหลังขณะโมดัลเปิดอยู่ — ตัวการ์ดปฏิทินเองยัง scroll ได้
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, [open]);

  // คืน focus ให้ปุ่มที่เปิดโมดัล — ผูกกับอายุของโมดัลเท่านั้น จึงวิ่งตอน "ปิดจริง" ครั้งเดียว
  // (ห้ามรวมไว้ใน cleanup ของ effect ด้านล่าง: dep ของมันเปลี่ยนระหว่างโมดัลยังเปิดอยู่)
  useEffect(() => {
    if (!open) return undefined;
    return () => { triggerRef.current?.focus?.(); };
  }, [open]);

  // Escape ปิด · Tab วนอยู่ในโมดัล (คัดลอกจาก CreditCardForm.js:78-106) — cleanup ถอด listener เท่านั้น
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        // กล่องยืนยัน "จ่ายขั้นต่ำ" มี Esc handler ของตัวเอง — อย่าปิดปฏิทินทั้งก้อนทับกัน
        // (จำกัดเฉพาะสาขา Escape เท่านั้น — Tab ต้องถูกดักตลอดเวลาที่โมดัลเปิด)
        if (confirmState) return;
        event.stopPropagation();
        handleClose();
        return;
      }
      if (event.key !== 'Tab') return;
      // ดักที่กล่องบนสุด: ถ้ากล่องยืนยันเปิดอยู่ Tab ต้องวนอยู่ในกล่องยืนยัน ไม่ใช่ปฏิทินที่อยู่ข้างหลัง
      const trapRoot = (confirmState && confirmDialogRef.current) || dialogRef.current;
      if (!trapRoot) return;
      const focusable = getTabbableElements(trapRoot);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!trapRoot.contains(document.activeElement)) {
        // focus อยู่นอกกล่องบนสุด (เช่นเพิ่งเปิดกล่องยืนยัน) — ดึงกลับเข้ามาแทนที่จะปล่อยหลุด
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
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, confirmState, handleClose]);

  const cardById = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);
  const planById = useMemo(() => new Map(plans.map(plan => [plan.id, plan])), [plans]);

  // ---------------------------------------------------------------- event derivation (ADR-012)
  const calendarData = useMemo(() => {
    const daysInMonth = getDaysInMonthKey(monthKey);
    const eventsByDay = new Map();
    const unscheduledEvents = [];
    const pushDay = (day, event) => {
      if (!eventsByDay.has(day)) eventsByDay.set(day, []);
      eventsByDay.get(day).push(event);
    };

    // สถานะเทียบกับหน้าต่างข้อมูล 15 เดือน (KL-1 / BR-CC-019) — ดูตาราง 3 สถานะใน spec §Feature 2
    const monthKeys = Object.keys(monthsMap).sort();
    let windowState = 'in-window';
    if (!Object.prototype.hasOwnProperty.call(monthsMap, monthKey) && monthKeys.length > 0) {
      windowState = monthKey < monthKeys[0] ? 'pruned' : 'future';
    }

    const rows = (monthsMap[monthKey] && typeof monthsMap[monthKey] === 'object') ? monthsMap[monthKey] : {};
    Object.entries(rows).forEach(([key, row]) => {
      if (IGNORED_ROW_KEYS.has(key)) return;
      if (!row || typeof row !== 'object') return;

      const source = isRevolvingRowKey(key) ? 'revolving' : (isInstallmentRowKey(key) ? 'installment' : 'plain');
      let card = null;
      let plan = null;
      let installmentNo = null;

      if (source === 'revolving') {
        const parsed = parseRevolvingRowKey(key);
        card = parsed ? cardById.get(parsed.cardId) || null : null;
      } else if (source === 'installment') {
        const parsed = parseInstallmentRowKey(key);
        if (parsed) {
          plan = planById.get(parsed.planId) || null;
          installmentNo = parsed.installmentNo;
          card = plan ? cardById.get(plan.cardId) || null : null;
        }
      }

      const event = {
        id: `${monthKey}_${key}`,
        type: 'expense',
        source,
        key,
        name: row.name || 'รายการ',
        amount: parseToNumber(row.actual),
        account: row.account || '',
        paid: row.paid === true || row.paid === 'true',
        dueDay: row.dueDay,
        card,
        plan,
        installmentNo
      };

      // dueDay แก้ไม่ได้/แก้ไม่ออก → ไม่ทิ้ง แต่ไปอยู่ถาดด้านล่างแทน (BR-003, edge case 22)
      const day = resolveDueDayForMonth(row.dueDay, daysInMonth);
      if (!day) {
        unscheduledEvents.push(event);
        return;
      }
      pushDay(day, event);
    });

    // วันสรุปยอด — สิ่งเดียวของบัตรที่ไม่มีแถวใน monthly_expense เลย มีทุกเดือนแม้ไม่มีรายจ่าย
    cards.forEach(card => {
      const statementDay = resolveDueDayForMonth(card.statementDay, daysInMonth);
      if (statementDay) {
        pushDay(statementDay, {
          id: `${monthKey}_st_${card.id}`,
          type: 'statement',
          source: 'statement',
          key: `st_${card.id}`,
          card
        });
      }
    });

    let total = 0;
    let paidTotal = 0;
    eventsByDay.forEach(events => {
      events.forEach(event => {
        if (event.type !== 'expense') return;
        total += event.amount;
        if (event.paid) paidTotal += event.amount;
      });
    });

    return {
      eventsByDay,
      unscheduledEvents,
      windowState,
      monthTotals: { total: round2(total), paid: round2(paidTotal), remaining: round2(total - paidTotal) }
    };
  }, [monthKey, monthsMap, cards, cardById, planById]);

  // ------------------------------------------------------------------- toggle handlers
  const setBusy = (key, busy) => {
    setPendingKeys(keys => (busy ? [...keys, key] : keys.filter(item => item !== key)));
  };

  const updateRow = (key, patch) => {
    setMonthsMap(prev => {
      const monthRows = prev[monthKey];
      if (!monthRows || !monthRows[key]) return prev;
      return {
        ...prev,
        [monthKey]: { ...monthRows, [key]: { ...monthRows[key], ...patch } }
      };
    });
  };

  const handleToggleInstallment = async (event) => {
    if (!event.plan) return;
    const nextPaid = !event.paid;
    setBusy(event.key, true);
    updateRow(event.key, { paid: nextPaid });
    try {
      const response = await creditCardAPI.setInstallmentPaid(event.plan.id, event.installmentNo, nextPaid);
      changedRef.current = true;
      showToast(response?.plan?.status === PLAN_STATUS.COMPLETED ? 'ผ่อนครบแล้ว 🎉' : 'อัปเดตสถานะงวดแล้ว');
    } catch (err) {
      updateRow(event.key, { paid: event.paid });
      showToast(err.message || 'อัปเดตสถานะงวดไม่สำเร็จ', 'error');
    } finally {
      setBusy(event.key, false);
    }
  };

  /** ใช้ผลลัพธ์ cycle จาก server เขียนทับแถว ccr_ ในเดือนนี้ — ตรงตามกติกาการ inject ของ Feature 1 */
  const applyCycleToRow = (event, cycle) => {
    if (!cycle) return;
    updateRow(event.key, {
      actual: cycle.amountDue,
      paid: cycle.paymentAction !== null,
      name: `ยอดใช้จ่ายบัตร ${event.card?.name || ''}${cycle.paymentAction === 'minimum' ? ' (ขั้นต่ำ)' : ''}`
    });
  };

  const handleRevolvingFull = async (event) => {
    if (!event.card) return;
    setBusy(event.key, true);
    try {
      const response = await creditCardAPI.setRevolvingAction(event.card.id, monthKey, 'full');
      applyCycleToRow(event, (response?.cycles || []).find(cycle => cycle.month === monthKey));
      changedRef.current = true;
      showToast('บันทึกการชำระแล้ว');
    } catch (err) {
      showToast(err.message || 'บันทึกไม่สำเร็จ', 'error');
    } finally {
      setBusy(event.key, false);
    }
  };

  const handleRevolvingCancel = async (event) => {
    if (!event.card) return;
    setBusy(event.key, true);
    try {
      const response = await creditCardAPI.setRevolvingAction(event.card.id, monthKey, null);
      applyCycleToRow(event, (response?.cycles || []).find(cycle => cycle.month === monthKey));
      changedRef.current = true;
      showToast('ยกเลิกการชำระแล้ว');
    } catch (err) {
      showToast(err.message || 'ยกเลิกการชำระไม่สำเร็จ', 'error');
    } finally {
      setBusy(event.key, false);
    }
  };

  // จ่ายขั้นต่ำต้องยืนยันก่อน เพราะมันสร้างหนี้ยกไปเดือนหน้าพร้อมดอกเบี้ย (เหมือน credit-cards.js)
  const handleRevolvingMinimumClick = async (event) => {
    if (!event.card) return;
    setBusy(event.key, true);
    try {
      const response = await creditCardAPI.getRevolving({ cardId: event.card.id, month: monthKey });
      const cycle = (response?.cycles || []).find(item => item.month === monthKey);
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
  };

  const handleConfirmMinimum = async () => {
    const event = confirmState?.event;
    if (!event?.card) { setConfirmState(null); return; }
    setConfirmBusy(true);
    try {
      const response = await creditCardAPI.setRevolvingAction(event.card.id, monthKey, 'minimum');
      applyCycleToRow(event, (response?.cycles || []).find(cycle => cycle.month === monthKey));
      changedRef.current = true;
      showToast('บันทึกการชำระขั้นต่ำแล้ว');
      setConfirmState(null);
    } catch (err) {
      showToast(err.message || 'บันทึกไม่สำเร็จ', 'error');
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleNavigateMonth = (delta) => setMonthKey(prev => addMonths(prev, delta));

  if (!open) return null;

  return (
    <div className={formStyles.backdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) handleClose();
    }}>
      <div
        ref={dialogRef}
        className={`${formStyles.modal} ${calStyles.calendarModal}`}
        role="dialog"
        aria-modal="true"
        aria-label="ปฏิทินค่าใช้จ่าย"
      >
        <div className={formStyles.modalHeader}>
          <h2 className={formStyles.modalTitle}>
            <Icons.Calendar size={18} /> ปฏิทินค่าใช้จ่าย
          </h2>
          <button ref={closeButtonRef} type="button" className={formStyles.closeButton} onClick={handleClose} aria-label="ปิด">
            <Icons.X size={18} />
          </button>
        </div>

        <div className={`${formStyles.modalBody} ${calStyles.calendarModalBody}`}>
          {loading && (
            <div role="status" aria-busy="true">
              <span className={cardStyles.srOnly}>กำลังโหลดปฏิทิน...</span>
              <p className={cardStyles.hint}>กำลังโหลดปฏิทิน...</p>
              <div className={calStyles.calendarSkeletonGrid}>
                {Array.from({ length: 42 }).map((_, index) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <div key={index} className={cardStyles.skeleton} />
                ))}
              </div>
            </div>
          )}

          {!loading && error && (
            <div className={cardStyles.errorState} role="alert">
              <span>{error}</span>
              <button type="button" className={cardStyles.ghostButton} onClick={loadData}>ลองอีกครั้ง</button>
            </div>
          )}

          {!loading && !error && (
            <ExpenseCalendar
              monthKey={monthKey}
              onNavigateMonth={handleNavigateMonth}
              eventsByDay={calendarData.eventsByDay}
              unscheduledEvents={calendarData.unscheduledEvents}
              cards={cards}
              monthTotals={calendarData.monthTotals}
              windowState={calendarData.windowState}
              pendingKeys={pendingKeys}
              onToggleInstallment={handleToggleInstallment}
              onRevolvingFull={handleRevolvingFull}
              onRevolvingMinimum={handleRevolvingMinimumClick}
              onRevolvingCancel={handleRevolvingCancel}
            />
          )}
        </div>
      </div>

      <RevolvingConfirmDialog
        open={Boolean(confirmState)}
        dialogRef={confirmDialogRef}
        restoreFocusRef={closeButtonRef}
        cardName={confirmState?.event?.card?.name}
        minPaymentDue={confirmState?.minPaymentDue}
        preview={confirmState?.preview}
        busy={confirmBusy}
        onCancel={() => setConfirmState(null)}
        onConfirm={handleConfirmMinimum}
      />
    </div>
  );
}
