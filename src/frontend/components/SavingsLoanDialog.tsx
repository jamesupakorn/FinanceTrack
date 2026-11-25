/**
 * คอมโพเนนต์: SavingsLoanDialog — ยืมเงินออม (UX_SPEC-savings-loan-withdrawal.md §4, J-1/J-2)
 *
 * preview (ยอดหลังยืม) เป็นแค่ตัวเลขประมาณที่ไม่ถูกส่งไปไหน — server คำนวณและตรวจยอดใหม่เองเสมอตอนบันทึก
 * (CLAUDE.md money rule, architecture-review-savings-loan-withdrawal-s4.md C-S4-2). dialog shell/focus-trap
 * เหมือน LoanRateRevisionDialog.tsx แต่ z-[110] (ไม่ซ้อนทับ overlay อื่นในหน้านี้).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { savingsGoalsAPI, savingsLedgerAPI } from '../../shared/utils/frontend/apiUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';
import { useBackToClose } from '../../shared/utils/frontend/useBackToClose';
import { showToast } from '../../shared/utils/frontend/toast';
import { MAX_LEDGER_NOTE_LENGTH, toLedgerAmount } from '../../shared/utils/savingsLedger';
import SavingsSourceSelect, { buildSavingsSourceOptions, type SavingsSourceGoalOption } from './SavingsSourceSelect';
import { Icons } from './Icons';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const CANCEL_BUTTON = `min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary disabled:opacity-60 ${FOCUS_RING}`;
const PRIMARY_BUTTON = `min-h-11 rounded-sm bg-accent px-space-5 text-sm font-semibold text-on-accent disabled:opacity-60 ${FOCUS_RING}`;
const FIELD = `min-h-11 w-full rounded-sm border border-border-interactive bg-surface-1 px-space-3 text-sm text-primary disabled:opacity-60 ${FOCUS_RING}`;
const OVERLAY = 'fixed inset-0 z-[110] flex items-end justify-center overflow-y-auto bg-[rgba(10,10,11,0.72)] p-0 backdrop-blur-sm md:items-center md:p-space-5';
const PANEL = 'flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-lg bg-surface-3 shadow-elev-3 md:max-h-[85vh] md:max-w-md md:rounded-lg';

const TITLE_ID = 'savings-loan-dialog-title';
const SOURCE_ID = 'savings-loan-source';
const AMOUNT_ID = 'savings-loan-amount';
const AMOUNT_ERROR_ID = 'savings-loan-amount-error';
const NOTE_ID = 'savings-loan-note';

// error.code (jsonFetch promotes the server's `{ error: '<code>' }` string here) → ข้อความที่ผู้ใช้อ่านได้
// (UX_SPEC §4.5; unmapped → generic fallback, ไม่แสดงรหัสดิบ)
function serverErrorText(code: string | undefined, available: number | undefined): string {
  switch (code) {
    case 'insufficient_balance':
      return `ยอดของแหล่งนี้ไม่พอ (ใช้ได้ ${formatCurrency(available ?? 0)} ฿) — ยอดอาจเปลี่ยนจากอีกแท็บ`;
    case 'goal_not_found':
      return 'ไม่พบเป้าหมายนี้แล้ว — ลองเลือกแหล่งเงินใหม่';
    case 'open_loan_limit':
      return 'มีเงินยืมที่ยังไม่คืนครบ 50 รายการแล้ว — คืนรายการเก่าก่อน';
    case 'invalid_amount':
      return 'กรอกจำนวนเงินมากกว่า 0';
    case 'note_too_long':
    case 'invalid_note':
      return 'หมายเหตุยาวได้ไม่เกิน 120 ตัวอักษร';
    case 'invalid_source':
    case 'goal_id_required':
      return 'เลือกแหล่งเงิน';
    default:
      return 'บันทึกไม่สำเร็จ ลองอีกครั้ง';
  }
}

export interface SavingsLoanDialogProps {
  open: boolean;
  /** ยอดกลางล่าสุดจากแผง (summary.poolBalance ของ server) — ไม่คำนวณใหม่ที่นี่ */
  poolBalance: number;
  onClose: () => void;
  /** เรียกหลังบันทึกสำเร็จ — ให้แผงรีเฟรชรายการ/ยอด */
  onSaved: () => Promise<void> | void;
}

export default function SavingsLoanDialog({ open, poolBalance, onClose, onSaved }: SavingsLoanDialogProps) {
  const [goals, setGoals] = useState<SavingsSourceGoalOption[]>([]);
  const [sourceKey, setSourceKey] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const sourceRef = useRef<HTMLSelectElement | null>(null);
  const amountRef = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const options = useMemo(() => buildSavingsSourceOptions(poolBalance, goals), [poolBalance, goals]);
  const selected = options.find(option => option.key === sourceKey) ?? null;

  const refreshGoals = async () => {
    try {
      const response = await savingsGoalsAPI.getAll() as { goals?: Array<{ _id: string; goalName: string; currentAmount: number }> } | null;
      setGoals((response?.goals ?? []).map(goal => ({ _id: String(goal._id), goalName: goal.goalName, currentAmount: goal.currentAmount })));
    } catch {
      setGoals([]);
    }
  };

  useEffect(() => {
    if (!open) return;
    setAmountInput('');
    setNoteInput('');
    setTouched(false);
    setServerError(null);
    setBusy(false);
    setSourceKey(''); // รีเซ็ตแหล่งเงินทุกครั้งที่เปิด — ไม่ให้ค้างจากครั้งก่อน (F-S4-2)
    void refreshGoals();
    // ตั้งค่าใหม่เฉพาะตอนเปิด — refetch ระหว่างเปิดไม่ล้างค่าที่ผู้ใช้กรอก
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // เลือกแหล่งเงินตั้งต้นใหม่ทุกครั้งที่ตัวเลือกเปลี่ยน (เช่น goals โหลดเสร็จทีหลัง pool) ไม่ใช่แค่ตอน
  // sourceKey ว่างครั้งแรก — ถ้าตัวที่เลือกอยู่หายไปจาก options หรือถูก disable ทั้งที่มีตัวอื่นใช้ได้
  // ให้ไล่ไปตัวแรกที่ enabled เสมอ (UX_SPEC §4.2.1 "Default: the first enabled option", F-S4-2)
  useEffect(() => {
    if (!open) return;
    const current = options.find(option => option.key === sourceKey);
    const hasEnabled = options.some(option => !option.disabled);
    const needsReselect = !current || (current.disabled && hasEnabled);
    if (!needsReselect) return;
    const preferred = options.find(option => !option.disabled) ?? options[0];
    if (preferred && preferred.key !== sourceKey) setSourceKey(preferred.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, options, sourceKey]);

  useEffect(() => {
    if (!open) return undefined;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // select อาจถูก disable อยู่ตอนนี้ (pool <= 0 ระหว่างรอ goals โหลด หรือไม่มีแหล่งเงินที่ใช้ได้เลย) —
    // focus() บน disabled element ไม่มีผลอะไร ทำให้ focus ค้างอยู่หลัง modal (ปุ่มที่เปิด dialog) และ
    // Tab-trap ด้านล่างจะไม่ถูกเรียกเพราะ focus ไม่ได้อยู่ในกล่องโต้ตอบ — ต้อง fallback ไป element
    // ที่ focus ได้จริงภายใน dialog เสมอ (F-S4-8). ใช้ querySelector ด้วย SOURCE_ID แทน sourceRef
    // เพราะ SavingsSourceSelect เป็น function component ที่ไม่ forward ref มาถึง <select> จริง
    const timer = setTimeout(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      // ถ้า focus ขยับเข้าไปในกล่องโต้ตอบไปแล้วก่อนถึง 40ms (เช่น ผู้ใช้/เทสต์พิมพ์เร็วมาก) ไม่ต้องแย่ง
      // focus กลับมาที่ select — เป้าหมายของ effect นี้คือห้าม focus ค้างอยู่นอก dialog เท่านั้น
      if (dialog.contains(document.activeElement)) return;
      const source = dialog.querySelector<HTMLSelectElement>(`#${SOURCE_ID}`) ?? null;
      if (source && !source.disabled) {
        source.focus();
        return;
      }
      const focusable = getTabbableElements(dialog);
      (focusable[0] ?? dialog).focus();
    }, 40);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (!busyRef.current) onCloseRef.current();
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

  // Back = Escape path เดิม (D-SBC-3)
  useBackToClose(open, onClose, { blocked: busy });

  if (!open) return null;

  const hasUsableSource = options.some(option => !option.disabled);
  const amount = toLedgerAmount(amountInput);
  const amountError = amountInput.trim() === ''
    ? (touched ? 'กรอกจำนวนเงินมากกว่า 0' : null)
    : amount === null
      ? 'กรอกจำนวนเงินมากกว่า 0'
      : selected && amount > selected.available
        ? `เกินยอดที่ใช้ได้ของแหล่งนี้ (ใช้ได้ ${formatCurrency(selected.available)} ฿)`
        : null;
  const amountValid = amount !== null && amountError === null;
  const preview = amountValid && selected ? selected.available - (amount as number) : null;

  const canConfirm = !busy && hasUsableSource;
  const close = () => { if (!busy) onClose(); };

  const submit = async () => {
    if (busyRef.current) return;
    setTouched(true);
    if (!hasUsableSource) return;
    if (!amountValid) {
      amountRef.current?.focus();
      return;
    }
    // selected อาจยังเป็น null ชั่วขณะ (เช่น goal ที่เลือกถูกลบไปแล้วก่อน options จะ re-pick ทัน) —
    // กันไว้ไม่ให้ throw ตอนอ่าน selected!.source ซึ่งจะเบี่ยงไป error ทั่วไปที่ไม่ตรง (F-S4-2)
    if (!selected) {
      sourceRef.current?.focus();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setServerError(null);
    try {
      await savingsLedgerAPI.createLoan({ source: selected.source, amount: amount as number, note: noteInput.trim() || undefined });
      await onSaved();
      busyRef.current = false;
      setBusy(false);
      showToast('บันทึกการยืมแล้ว');
      onClose();
    } catch (error) {
      const code = (error as Error & { code?: string; available?: number })?.code;
      const available = (error as { available?: number })?.available;
      setServerError(serverErrorText(code, available));
      if (code === 'insufficient_balance' || code === 'goal_not_found') void refreshGoals();
      busyRef.current = false;
      setBusy(false);
    }
  };

  const noteCount = noteInput.length;
  const amountErrorVisible = touched && amountError !== null;

  return (
    <div className={OVERLAY} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialogRef} className={PANEL} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={TITLE_ID} aria-busy={busy}>
        <div className="flex shrink-0 items-center justify-between gap-space-3 border-b border-border-subtle px-space-5 py-space-4">
          <h2 id={TITLE_ID} className="m-0 text-lg font-semibold text-primary">ยืมเงินออม</h2>
          <button type="button" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-secondary hover:bg-surface-2 disabled:opacity-60 ${FOCUS_RING}`} onClick={close} disabled={busy} aria-label="ปิด">
            <Icons.X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-space-4 overflow-y-auto px-space-5 py-space-4">
          <div className="flex flex-col gap-space-2">
            <label htmlFor={SOURCE_ID} className="text-sm font-medium text-primary">แหล่งเงิน *</label>
            <SavingsSourceSelect id={SOURCE_ID} className={FIELD} options={options} value={sourceKey} onChange={setSourceKey} disabled={busy || !hasUsableSource} />
            {!hasUsableSource && (
              <p className="m-0 text-sm text-secondary">ยังไม่มีเงินออมที่ใช้ได้ — บันทึกเงินออมก่อน แล้วค่อยกลับมา</p>
            )}
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
              disabled={busy || !hasUsableSource}
              aria-invalid={amountErrorVisible}
              aria-describedby={AMOUNT_ERROR_ID}
            />
            <p id={AMOUNT_ERROR_ID} className="m-0 min-h-5 text-xs text-neg">{amountErrorVisible ? amountError : ''}</p>
          </div>

          <div className="flex flex-col gap-space-2">
            <label htmlFor={NOTE_ID} className="text-sm font-medium text-primary">หมายเหตุ (ไม่บังคับ)</label>
            <input
              id={NOTE_ID}
              className={FIELD}
              type="text"
              maxLength={MAX_LEDGER_NOTE_LENGTH}
              placeholder="เช่น ค่าซ่อมรถ"
              value={noteInput}
              onChange={event => setNoteInput(event.target.value)}
              disabled={busy}
            />
            <p className="m-0 text-right text-xs text-tertiary">{`${noteCount}/${MAX_LEDGER_NOTE_LENGTH}`}</p>
          </div>

          <section className="flex flex-col gap-space-1 border-t border-border-subtle pt-space-3" aria-live="polite">
            {preview !== null ? (
              <p className="m-0 text-sm text-primary" data-testid="savings-loan-preview">
                {`ยอด${selected?.label ?? ''}หลังยืม (โดยประมาณ) ${formatCurrency(preview)} ฿`}
              </p>
            ) : (
              <p className="m-0 text-sm text-secondary">กรอกจำนวนเงินเพื่อดูยอดคงเหลือ</p>
            )}
          </section>

          <p className="m-0 rounded-sm border border-border-subtle bg-surface-2 p-space-3 text-sm text-secondary">
            ยืมแล้วคืนเมื่อไรก็ได้ ทีละเท่าไรก็ได้ ไม่มีดอกเบี้ยและไม่มีกำหนดคืน — คืนได้ที่หน้า รายจ่าย › &quot;คืนเงินกู้&quot;
          </p>
        </div>

        <div className="flex shrink-0 flex-col gap-space-3 border-t border-border-subtle px-space-5 py-space-4">
          {serverError && <p role="alert" className="m-0 text-sm text-neg">{serverError}</p>}
          <div className="flex flex-col-reverse items-stretch gap-space-3 md:flex-row md:items-center md:justify-end">
            <button type="button" className={CANCEL_BUTTON} onClick={close} disabled={busy}>ยกเลิก</button>
            <button type="button" className={PRIMARY_BUTTON} onClick={() => void submit()} disabled={!canConfirm}>
              {busy ? 'กำลังบันทึก...' : 'ยืนยันการยืม'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
