/**
 * คอมโพเนนต์: SavingsGoalAdjustmentDialog — เพิ่ม/ลด/แก้ไขยอดปรับของเป้าหมายเงินออม
 * (spec-savings-goal-adjustments §4.4, UX_SPEC §4, task-context-savings-goal-adjustments-s3 item 2)
 *
 * preview เป็นแค่คำแนะนำ — server เป็นผู้คำนวณ currentAmount ใหม่เองทั้งหมด (CLAUDE.md money rule),
 * หลังบันทึกสำเร็จ tracker จะ loadGoals() ใหม่เสมอ ไม่เชื่อค่า preview ของ dialog นี้
 *
 * shell/focus-trap/busy guard ลอกแบบจาก LoanRateRevisionDialog.tsx ทุกจุด ต่างกันแค่ z-[110] (S3-C-1 ไม่เกี่ยวกับ dialog นี้ตรง ๆ
 * แต่ deleteConfirm ของ history ที่อยู่นอก dialog นี้ใช้ slot เดียวกับการลบเป้าหมาย — ดู SavingsGoalTracker.tsx)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_ADJUSTMENT_AMOUNT,
  MAX_ADJUSTMENT_NOTE_LENGTH,
  isAdjustmentAmountWithinCap,
  normalizeAdjustmentNote,
  toAdjustmentAmount,
  type SavingsGoalAdjustment
} from '../../shared/utils/savingsGoalAdjustments';
import { savingsGoalsAPI } from '../../shared/utils/frontend/apiUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';
import { Icons } from './Icons';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const CANCEL_BUTTON = `min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary disabled:opacity-60 ${FOCUS_RING}`;
const PRIMARY_BUTTON = `min-h-11 rounded-sm bg-accent px-space-5 text-sm font-semibold text-on-accent disabled:opacity-60 ${FOCUS_RING}`;
const FIELD = `min-h-11 w-full rounded-sm border border-border-interactive bg-surface-1 px-space-3 text-sm text-primary disabled:opacity-60 ${FOCUS_RING}`;
const OVERLAY = 'fixed inset-0 z-[110] flex items-end justify-center overflow-y-auto bg-[rgba(10,10,11,0.72)] p-0 backdrop-blur-sm md:items-center md:p-space-5';
const PANEL = 'flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-lg bg-surface-3 shadow-elev-3 md:max-h-[85vh] md:max-w-md md:rounded-lg';
// InstallmentPlanForm.tsx:115-116 — คัดลอกมา (module-local ของไฟล์นั้น ไม่ export ให้ import)
const RADIO_OPTION = `flex min-h-11 flex-col items-center justify-center gap-[2px] rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-center text-sm font-medium text-secondary transition-colors duration-fast ease-graphite ${FOCUS_RING}`;
const RADIO_OPTION_ACTIVE = 'border-accent bg-accent-muted text-primary';

const TITLE_ID = 'savings-goal-adjustment-title';
const RADIOGROUP_LABEL_ID = 'savings-goal-adjustment-direction-label';
const AMOUNT_ID = 'savings-goal-adjustment-amount';
const AMOUNT_ERROR_ID = 'savings-goal-adjustment-amount-error';
const NOTE_ID = 'savings-goal-adjustment-note';
const NOTE_ERROR_ID = 'savings-goal-adjustment-note-error';
const MINUS_SIGN = '−';

/** คีย์เก็บ "หมายเหตุล่าสุด" ต่อเป้าหมาย ใน localStorage (UX review item 2, smart note default) */
const LAST_NOTE_STORAGE_PREFIX = 'financetrack.savingsGoalAdjustment.lastNote.v1.';

/** จำนวนเงินปรับสูงสุดต่อรายการ (S1 carry-forward) — ข้อความแยกจากข้อความ "กรอกจำนวนเงิน" ทั่วไป (S3-C-2) */
const CAP_ERROR_TEXT = `จำนวนเงินต้องไม่เกิน ${formatCurrency(MAX_ADJUSTMENT_AMOUNT)} บาทต่อรายการ`;
const GENERIC_AMOUNT_ERROR = 'กรอกจำนวนเงินมากกว่า 0 (เลือกเพิ่ม/ลดด้านบน)';
const NOTE_ERROR_TEXT = 'กรอกหมายเหตุ';

// ข้อความ error ของ route (ภาษาอังกฤษ) → ข้อความที่ผู้ใช้อ่านได้ ไม่รู้จักก็ใช้ข้อความกลาง (ไม่โชว์ raw)
const SERVER_ERROR_TEXT: Record<string, string> = {
  'Goal not found': 'ไม่พบเป้าหมายนี้แล้ว — ลองโหลดหน้าใหม่',
  'Adjustment not found': 'ไม่พบรายการปรับยอดนี้แล้ว — ลองโหลดหน้าใหม่',
  'adjustment limit reached (120)': 'ปรับยอดได้สูงสุด 120 รายการต่อเป้าหมาย — ลบรายการเก่าก่อน',
  'amount must be a non-zero number': 'กรอกจำนวนเงินมากกว่า 0',
  'amount too large': CAP_ERROR_TEXT,
  'note required': NOTE_ERROR_TEXT,
  'note too long': `หมายเหตุยาวได้ไม่เกิน ${MAX_ADJUSTMENT_NOTE_LENGTH} ตัวอักษร`
};

export interface SavingsGoalAdjustmentDialogGoal {
  _id: string;
  goalName: string;
  currentAmount?: number;
}

interface SavingsGoalAdjustmentDialogProps {
  open: boolean;
  goal: SavingsGoalAdjustmentDialogGoal | null;
  /** null = โหมดเพิ่ม; ไม่ null = โหมดแก้ไขรายการนี้ */
  editing: SavingsGoalAdjustment | null;
  /** reason === 'stale' เมื่อปิดหลัง server ตอบ "ไม่พบเป้าหมาย/รายการปรับยอดนี้แล้ว" — ผู้เรียกควร refetch (UX_SPEC §4.4) */
  onClose: (reason?: 'stale') => void;
  onSaved: () => void | Promise<void>;
}

/** server error สองค่านี้แปลว่าข้อมูลที่การ์ด/แถวกำลังโชว์อาจเก่าไปแล้ว — ปิด dialog ต้องสั่ง refetch (deviation (a)) */
const STALE_DATA_ERRORS = new Set(['Goal not found', 'Adjustment not found']);

type Direction = 'increase' | 'decrease';

function formatSigned(value: number): string {
  if (value === 0) return `±${formatCurrency(0)}`;
  return `${value > 0 ? '+' : MINUS_SIGN}${formatCurrency(Math.abs(value))}`;
}

function readLastNote(goalId: string | undefined): string {
  if (!goalId || typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(`${LAST_NOTE_STORAGE_PREFIX}${goalId}`) ?? '';
  } catch {
    return '';
  }
}

function writeLastNote(goalId: string | undefined, note: string): void {
  if (!goalId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${LAST_NOTE_STORAGE_PREFIX}${goalId}`, note);
  } catch {
    // บันทึกไม่ได้ก็ไม่เป็นไร — เป็นแค่ความสะดวก ไม่ใช่ข้อมูลที่ต้องเชื่อถือ
  }
}

export default function SavingsGoalAdjustmentDialog({ open, goal, editing, onClose, onSaved }: SavingsGoalAdjustmentDialogProps) {
  const [direction, setDirection] = useState<Direction>('increase');
  const [amountInput, setAmountInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [noteTouched, setNoteTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [staleDataError, setStaleDataError] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const amountRef = useRef<HTMLInputElement | null>(null);
  const noteRef = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const staleDataErrorRef = useRef(false);
  staleDataErrorRef.current = staleDataError;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // รีเซ็ตฟอร์มเมื่อเปิดใหม่ หรือสลับโหมด/เป้าหมาย/รายการที่แก้ไข — ไม่ล้างระหว่างเปิดอยู่
  useEffect(() => {
    if (!open) return undefined;
    if (editing) {
      setDirection(editing.amount < 0 ? 'decrease' : 'increase');
      setAmountInput(formatCurrency(Math.abs(editing.amount)));
      setNoteInput(editing.note);
    } else {
      setDirection('increase');
      setAmountInput('');
      setNoteInput(readLastNote(goal?._id));
    }
    setAmountTouched(false);
    setNoteTouched(false);
    setServerError(null);
    setStaleDataError(false);
    setBusy(false);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goal?._id, editing?._id]);

  useEffect(() => {
    if (!open) return undefined;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = setTimeout(() => amountRef.current?.focus(), 40);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (!busyRef.current) onCloseRef.current(staleDataErrorRef.current ? 'stale' : undefined);
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = getTabbableElements(dialogRef.current);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
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
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
      trigger?.focus();
    };
  }, [open]);

  // เครื่องหมาย '-' พิมพ์เองไม่ได้ — สัญลักษณ์มาจาก toggle เพียงอย่างเดียว (D-SGA-17)
  const hasTypedMinus = amountInput.includes('-');
  const parsedAmount = hasTypedMinus ? null : toAdjustmentAmount(amountInput);
  const overCap = parsedAmount !== null && !isAdjustmentAmountWithinCap(parsedAmount);
  const amountError = parsedAmount === null ? GENERIC_AMOUNT_ERROR : overCap ? CAP_ERROR_TEXT : null;
  const amountValid = amountError === null;

  const normalizedNote = normalizeAdjustmentNote(noteInput);
  const noteError = normalizedNote === null ? NOTE_ERROR_TEXT : null;
  const noteValid = noteError === null;

  const signed = useMemo(() => {
    if (!amountValid || parsedAmount === null) return null;
    return direction === 'decrease' ? -Math.abs(parsedAmount) : Math.abs(parsedAmount);
  }, [amountValid, parsedAmount, direction]);

  const currentAmount = goal?.currentAmount ?? 0;
  const next = useMemo(() => {
    if (signed === null) return null;
    return editing ? currentAmount - editing.amount + signed : currentAmount + signed;
  }, [signed, editing, currentAmount]);

  if (!open || !goal) return null;

  const canSubmit = !busy;
  const close = () => { if (!busy) onClose(staleDataError ? 'stale' : undefined); };

  const submit = async () => {
    if (busyRef.current) return;
    if (!amountValid || !noteValid || signed === null) {
      setAmountTouched(true);
      setNoteTouched(true);
      (!amountValid ? amountRef.current : noteRef.current)?.focus();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setServerError(null);
    try {
      if (editing) {
        await savingsGoalsAPI.editAdjustment(goal._id, editing._id, { amount: signed, note: normalizedNote! });
      } else {
        await savingsGoalsAPI.addAdjustment(goal._id, { amount: signed, note: normalizedNote! });
      }
      writeLastNote(goal._id, normalizedNote!);
      busyRef.current = false;
      setBusy(false);
      await onSaved();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setServerError(SERVER_ERROR_TEXT[message] ?? 'บันทึกการปรับยอดไม่สำเร็จ ลองอีกครั้ง');
      setStaleDataError(STALE_DATA_ERRORS.has(message));
      busyRef.current = false;
      setBusy(false);
    }
  };

  const title = editing ? `แก้ไขการปรับยอด · ${goal.goalName}` : `ปรับยอด · ${goal.goalName}`;
  const amountErrorVisible = (amountTouched) && amountError !== null;
  const noteErrorVisible = (noteTouched) && noteError !== null;

  const previewText = next === null
    ? 'กรอกจำนวนเงินเพื่อดูยอดหลังปรับ'
    : `ยอดหลังปรับ (โดยประมาณ) ${formatCurrency(next)} ฿`;

  return (
    <div
      className={OVERLAY}
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className={PANEL}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        aria-busy={busy}
      >
        <div className="flex shrink-0 items-center justify-between gap-space-3 border-b border-border-subtle px-space-5 py-space-4">
          <h2 id={TITLE_ID} className="m-0 text-lg font-semibold text-primary">{title}</h2>
          <button
            type="button"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-secondary hover:bg-surface-2 disabled:opacity-60 ${FOCUS_RING}`}
            onClick={close}
            disabled={busy}
            aria-label="ปิด"
          >
            <Icons.X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-space-4 overflow-y-auto px-space-5 py-space-4">
          <p className="m-0 text-sm text-secondary">
            {`ยอดปัจจุบัน ${formatCurrency(currentAmount)} ฿`}
          </p>

          <div className="flex flex-col gap-space-2">
            <span id={RADIOGROUP_LABEL_ID} className="text-sm font-medium text-primary">ประเภทการปรับ *</span>
            <div className="grid grid-cols-2 gap-space-2" role="radiogroup" aria-labelledby={RADIOGROUP_LABEL_ID}>
              <button
                type="button"
                role="radio"
                aria-checked={direction === 'increase'}
                className={`${RADIO_OPTION} ${direction === 'increase' ? RADIO_OPTION_ACTIVE : ''}`}
                onClick={() => { setDirection('increase'); setServerError(null); }}
                disabled={busy}
              >
                เพิ่มยอด (+)
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={direction === 'decrease'}
                className={`${RADIO_OPTION} ${direction === 'decrease' ? RADIO_OPTION_ACTIVE : ''}`}
                onClick={() => { setDirection('decrease'); setServerError(null); }}
                disabled={busy}
              >
                ลดยอด (−)
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-space-2">
            <label htmlFor={AMOUNT_ID} className="text-sm font-medium text-primary">จำนวนเงิน (บาท) *</label>
            <input
              id={AMOUNT_ID}
              ref={amountRef}
              className={`${FIELD} text-right font-[family-name:var(--font-numeric)] tabular-nums`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="เช่น 1000"
              value={amountInput}
              onChange={event => { setAmountInput(event.target.value); setServerError(null); }}
              onBlur={() => setAmountTouched(true)}
              disabled={busy}
              aria-invalid={amountErrorVisible}
              aria-describedby={AMOUNT_ERROR_ID}
            />
            {/* เว้นบรรทัดไว้เสมอ ข้อความ error จึงไม่ดันเนื้อหาเลื่อน */}
            <p id={AMOUNT_ERROR_ID} className="m-0 min-h-5 text-xs text-neg">{amountErrorVisible ? amountError : ''}</p>
          </div>

          <div className="flex flex-col gap-space-2">
            <label htmlFor={NOTE_ID} className="text-sm font-medium text-primary">หมายเหตุ *</label>
            <input
              id={NOTE_ID}
              ref={noteRef}
              className={FIELD}
              type="text"
              maxLength={MAX_ADJUSTMENT_NOTE_LENGTH}
              placeholder="เช่น ยอดยกมาจากบัญชีเดิม"
              value={noteInput}
              onChange={event => { setNoteInput(event.target.value); setServerError(null); }}
              onBlur={() => setNoteTouched(true)}
              disabled={busy}
              aria-invalid={noteErrorVisible}
              aria-describedby={NOTE_ERROR_ID}
            />
            <div className="flex items-center justify-between gap-space-2">
              <p id={NOTE_ERROR_ID} className="m-0 min-h-5 text-xs text-neg">{noteErrorVisible ? noteError : ''}</p>
              <span className="shrink-0 text-xs text-tertiary tabular-nums">{`${noteInput.length}/${MAX_ADJUSTMENT_NOTE_LENGTH}`}</span>
            </div>
          </div>

          <section className="flex flex-col gap-space-1 border-t border-border-subtle pt-space-3" aria-live="polite">
            {editing && (
              <p className="m-0 text-xs text-secondary">
                {`เดิม ${formatSigned(editing.amount)} ฿`}
              </p>
            )}
            <p className={`m-0 text-sm ${next !== null && next < 0 ? 'text-neg' : 'text-primary'}`}>{previewText}</p>
          </section>
        </div>

        <div className="flex shrink-0 flex-col gap-space-3 border-t border-border-subtle px-space-5 py-space-4">
          {serverError && (
            <p role="alert" className="m-0 text-sm text-neg">{serverError}</p>
          )}
          <div className="flex flex-col-reverse items-stretch gap-space-3 md:flex-row md:items-center md:justify-end">
            <button type="button" className={CANCEL_BUTTON} onClick={close} disabled={busy}>
              ยกเลิก
            </button>
            <button type="button" className={PRIMARY_BUTTON} onClick={submit} disabled={!canSubmit}>
              {busy ? 'กำลังบันทึก...' : editing ? 'บันทึกการแก้ไข' : 'บันทึกการปรับยอด'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
