/**
 * คอมโพเนนต์: SavingsLoanRepaymentDialog — คืนเงินกู้ออมจากหน้ารายจ่าย (UX_SPEC-savings-loan-withdrawal.md §5, J-4)
 *
 * dialog shell/focus-trap เหมือน SavingsLoanDialog.tsx/SavingsWithdrawalDialog.tsx (z-[110], ไม่ซ้อนทับ
 * overlay อื่นในหน้านี้). ต่างจากทั้งสองตรงที่ตัวเลือกแรกเป็น role="radiogroup" ของปุ่ม <button> จริง
 * (ไม่ใช่ select ที่ไม่ forward ref) — ปุ่มตัวเลือกจึง focus ได้ตรงโดยไม่ต้องใช้ querySelector fallback
 * แบบ F-S4-8 แต่ยัง fallback ไป getTabbableElements เผื่อยังไม่มีเงินกู้ที่ยังไม่คืนตอนเปิด (กำลังโหลด).
 *
 * preview เป็นแค่ตัวเลขประมาณที่ไม่ถูกส่งไปไหน — server คลัมป์ยอดคืนเองเสมอ (D-SLW-10, C-S5-3).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { expenseAPI, savingsGoalsAPI, savingsLedgerAPI } from '../../shared/utils/frontend/apiUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { formatMonthKeyTH, formatThaiDate, getCurrentDateInfo } from '../../shared/utils/dateUtils';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';
import { showToast } from '../../shared/utils/frontend/toast';
import {
  formatLoanAge,
  formatSourceLabel,
  toLedgerAmount,
  type SavingsLoanWithBalance,
} from '../../shared/utils/savingsLedger';
import { Icons } from './Icons';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const CANCEL_BUTTON = `min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary disabled:opacity-60 ${FOCUS_RING}`;
const PRIMARY_BUTTON = `min-h-11 rounded-sm bg-accent px-space-5 text-sm font-semibold text-on-accent disabled:opacity-60 ${FOCUS_RING}`;
const FIELD = `min-h-11 w-full rounded-sm border border-border-interactive bg-surface-1 px-space-3 text-sm text-primary disabled:opacity-60 ${FOCUS_RING}`;
const OVERLAY = 'fixed inset-0 z-[110] flex items-end justify-center overflow-y-auto bg-[rgba(10,10,11,0.72)] p-0 backdrop-blur-sm md:items-center md:p-space-5';
const PANEL = 'flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-lg bg-surface-3 shadow-elev-3 md:max-h-[85vh] md:max-w-md md:rounded-lg';
const RADIO_OPTION = `flex min-h-11 w-full flex-col items-start gap-[2px] rounded-sm border border-border-interactive bg-surface-2 px-space-3 py-space-2 text-left text-sm font-medium text-secondary transition-colors duration-fast ease-graphite ${FOCUS_RING}`;
const RADIO_OPTION_ACTIVE = 'border-accent bg-accent-muted text-primary';

const TITLE_ID = 'savings-loan-repayment-title';
const RADIOGROUP_ID = 'savings-loan-repayment-radiogroup';
const AMOUNT_ID = 'savings-loan-repayment-amount';
const AMOUNT_ERROR_ID = 'savings-loan-repayment-amount-error';
const ACCOUNT_ID = 'savings-loan-repayment-account';
const ACK_ID = 'savings-loan-repayment-ack';
const ACK_ERROR_ID = 'savings-loan-repayment-ack-error';
const UNASSIGNED_ACCOUNT_LABEL = 'ไม่ระบุบัญชี';

/** "15 ม.ค. 2567" หรือ '-' เมื่อ parse ไม่ได้ — เหมือน SavingsLedgerHistory.tsx:formatDateTH (UX_SPEC §2 "Dates"). */
function formatDateTH(iso: string | null | undefined): string {
  const info = iso ? getCurrentDateInfo(iso) : null;
  return info ? formatThaiDate(info) : '-';
}

// error.code (jsonFetch promotes the server's `{ error: '<code>' }` string here) → ข้อความที่ผู้ใช้อ่านได้
// (UX_SPEC §5.4; ต้องมี default arm เสมอเพราะตารางไม่ครบทุก code ที่ server คืนได้ เช่น legacy-document 409
// (C-S3-15) — ไม่รู้จักก็ไปข้อความทั่วไป ไม่เคยแสดงรหัสดิบ, C-S5-2)
function serverErrorText(code: string | undefined): string {
  switch (code) {
    case 'loan_closed':
      return 'รายการยืมนี้คืนครบแล้ว — โหลดรายการใหม่ให้แล้ว';
    case 'loan_not_found':
      return 'ไม่พบรายการยืมนี้แล้ว — โหลดรายการใหม่ให้แล้ว';
    case 'repayment_limit':
      return 'รายการนี้คืนครบจำนวนครั้งสูงสุดแล้ว (360 ครั้ง) — คืนส่วนที่เหลือครั้งเดียว';
    case 'month_out_of_range':
      return 'คืนเงินได้เฉพาะเดือนปัจจุบันและย้อนหลังไม่เกิน 14 เดือน';
    case 'invalid_amount':
      return 'กรอกจำนวนเงินมากกว่า 0';
    default:
      return 'บันทึกไม่สำเร็จ ลองอีกครั้ง';
  }
}

export interface SavingsLoanRepaymentDialogProps {
  open: boolean;
  /** เดือนตาราง (M) ของ ExpenseTable ที่กำลังแสดง — แถวคืนเงินกู้จะถูกเขียนลงเดือนนี้ */
  month: string;
  /** บัญชีของตารางนี้ — ตัวเลือกเดียวกับที่แถวค่าใช้จ่ายอื่นใช้ */
  bankAccounts: readonly string[];
  onClose: () => void;
  /** เรียกหลังบันทึกสำเร็จ — ให้ ExpenseTable รีเฟรชแถว slr_ + รายการเงินกู้ที่ยังไม่คืน */
  onSaved: () => Promise<void> | void;
}

export default function SavingsLoanRepaymentDialog({ open, month, bankAccounts, onClose, onSaved }: SavingsLoanRepaymentDialogProps) {
  const [loans, setLoans] = useState<SavingsLoanWithBalance[]>([]);
  const [goalNameById, setGoalNameById] = useState<ReadonlyMap<string, string>>(new Map());
  const [selectedLoanId, setSelectedLoanId] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [account, setAccount] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const amountRef = useRef<HTMLInputElement | null>(null);
  const ackRef = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const accountOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: string[] = [];
    [...bankAccounts, UNASSIGNED_ACCOUNT_LABEL].forEach(entry => {
      const trimmed = String(entry ?? '').trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      options.push(trimmed);
    });
    return options.length > 0 ? options : [UNASSIGNED_ACCOUNT_LABEL];
  }, [bankAccounts]);

  // เงินกู้ที่ยังไม่คืน เก่าสุดก่อน (ตาม SavingsLedgerHistory.tsx's openLoans — D-SLW-9, ไม่มี badge/สีเร่งด่วน)
  const openLoans = useMemo(
    () => loans
      .filter(loan => loan.status === 'open')
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)),
    [loans]
  );
  const selectedLoan = openLoans.find(loan => loan._id === selectedLoanId) ?? null;

  const refreshLoans = async () => {
    try {
      const response = await savingsLedgerAPI.getLoans();
      setLoans(Array.isArray(response?.loans) ? response.loans : []);
    } catch {
      setLoans([]);
    }
  };

  const refreshGoals = async () => {
    try {
      const response = await savingsGoalsAPI.getAll() as { goals?: Array<{ _id: string; goalName: string }> } | null;
      setGoalNameById(new Map((response?.goals ?? []).map(goal => [String(goal._id), goal.goalName])));
    } catch {
      // C-S5-6: โหลด goal ไม่สำเร็จ → ใช้ map เปล่า (formatSourceLabel จะคืน "เป้าหมายที่ลบแล้ว" เอง)
      // ไม่บล็อกการเปิด dialog
      setGoalNameById(new Map());
    }
  };

  useEffect(() => {
    if (!open) return;
    setAmountInput('');
    setAccount('');
    setAcknowledged(false);
    setTouched(false);
    setServerError(null);
    setBusy(false);
    setSelectedLoanId('');
    void refreshLoans();
    void refreshGoals();
    // ตั้งค่าใหม่เฉพาะตอนเปิด — refetch ระหว่างเปิดไม่ล้างค่าที่ผู้ใช้กรอก
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // เลือกบัญชีตั้งต้น = ตัวแรกของรายการ ทุกครั้งที่ตัวเลือกเปลี่ยน (เช่น bankAccounts โหลดเสร็จทีหลัง)
  useEffect(() => {
    if (!open) return;
    if (accountOptions.includes(account)) return;
    setAccount(accountOptions[0] ?? UNASSIGNED_ACCOUNT_LABEL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accountOptions]);

  // เลือกเงินกู้ตั้งต้นเมื่อมีรายการเดียว (UX_SPEC §5.2 item 1 "Pre-selected when there is exactly one open loan")
  useEffect(() => {
    if (!open) return;
    if (selectedLoanId && openLoans.some(loan => loan._id === selectedLoanId)) return;
    if (openLoans.length === 1) setSelectedLoanId(openLoans[0]._id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, openLoans]);

  useEffect(() => {
    if (!open) return undefined;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = setTimeout(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (dialog.contains(document.activeElement)) return;
      // ตัวเลือกแรกของ radiogroup เป็น <button role="radio"> จริง focus ได้ตรง ไม่ต้องผ่าน ref ของ
      // คอมโพเนนต์แม่ (ต่างจาก F-S4-8 ที่ select ถูกห่อใน custom component ที่ไม่ forward ref) —
      // แต่ตอนกำลังโหลด (ยังไม่มีเงินกู้) radiogroup จะว่าง ต้อง fallback ไป element ที่ focus ได้จริง
      // ภายใน dialog เสมอ เพื่อไม่ให้ Tab-trap ด้านล่างทำงานผิดเพราะ focus ค้างอยู่นอก dialog
      const firstRadio = dialog.querySelector<HTMLButtonElement>('[role="radio"]');
      if (firstRadio) {
        firstRadio.focus();
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

  if (!open) return null;

  const hasOpenLoan = openLoans.length > 0;
  const amount = toLedgerAmount(amountInput);
  const amountError = amountInput.trim() === ''
    ? (touched ? 'กรอกจำนวนเงินมากกว่า 0' : null)
    : amount === null
      ? 'กรอกจำนวนเงินมากกว่า 0'
      : null;
  const amountValid = amount !== null && amountError === null;
  // เกินยอดค้าง — ไม่บล็อก แค่แจ้งว่า server จะคลัมป์ (D-SLW-10, UX_SPEC §5.2 item 2)
  const exceedsOutstanding = amountValid && selectedLoan ? (amount as number) > selectedLoan.outstandingAmount : false;
  const appliedPreview = amountValid && selectedLoan ? Math.min(amount as number, selectedLoan.outstandingAmount) : null;
  const ackError = touched && !acknowledged ? 'ติ๊กยืนยันก่อนบันทึก' : null;

  const canConfirm = !busy && hasOpenLoan;
  const close = () => { if (!busy) onClose(); };

  const fillFullAmount = () => {
    if (!selectedLoan) return;
    setAmountInput(String(selectedLoan.outstandingAmount));
    setServerError(null);
  };

  const submit = async () => {
    if (busyRef.current) return;
    setTouched(true);
    if (!hasOpenLoan) return;
    if (!selectedLoan) return;
    if (!amountValid) {
      amountRef.current?.focus();
      return;
    }
    if (!acknowledged) {
      ackRef.current?.focus();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setServerError(null);
    let result: Awaited<ReturnType<typeof expenseAPI.repayLoan>>;
    try {
      result = await expenseAPI.repayLoan(month, {
        loanId: selectedLoan._id,
        amount: amount as number,
        account: account === UNASSIGNED_ACCOUNT_LABEL ? undefined : account
      });
    } catch (error) {
      // repayLoan itself failed — nothing was written, so the generic retry-eligible failure path is correct.
      const code = (error as Error & { code?: string })?.code;
      setServerError(serverErrorText(code));
      if (code === 'loan_closed' || code === 'loan_not_found') {
        setSelectedLoanId('');
        void refreshLoans();
      }
      busyRef.current = false;
      setBusy(false);
      return;
    }
    // F-S5-3: ตั้งแต่ตรงนี้ repayLoan เขียนแถวคืนเงิน (append-only, ลบไม่ได้) ไปแล้ว — ห้ามให้ผู้ใช้กด
    // submit ซ้ำได้อีกไม่ว่า onSaved (รีเฟรช) ด้านล่างจะพังแค่ไหน ไม่งั้นจะเขียนรายการคืนเงินซ้ำสองครั้ง.
    // toast ต้องมาจาก response ของ repayLoan เองเท่านั้น ไม่พึ่ง onSaved ที่อาจพังได้.
    busyRef.current = false;
    setBusy(false);
    const outstandingAfter = Number(result?.outstandingAmount ?? 0);
    const appliedAmount = Number(result?.appliedAmount ?? 0);
    const toastMessage = result?.status === 'closed'
      ? 'คืนครบแล้ว ปิดรายการยืม ✓'
      : appliedAmount < (amount as number)
        ? `บันทึก ${formatCurrency(appliedAmount)} ฿ (เท่ายอดค้าง)`
        : `บันทึกการคืนเงินแล้ว — ยอดค้างเหลือ ${formatCurrency(outstandingAfter)} ฿`;
    showToast(toastMessage);
    onClose();
    try {
      await onSaved();
    } catch {
      // รีเฟรชพังหลังบันทึกสำเร็จแล้ว — มุมมองอาจเก่า แต่รายการคืนเงินบันทึกแล้วจริง ไม่ถือเป็น failure
      // (ไม่เปิด dialog ซ้ำ ไม่โชว์ข้อความ failure ทั่วไป)
    }
  };

  const amountErrorVisible = touched && amountError !== null;

  return (
    <div className={OVERLAY} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialogRef} className={PANEL} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={TITLE_ID} aria-busy={busy}>
        <div className="flex shrink-0 items-center justify-between gap-space-3 border-b border-border-subtle px-space-5 py-space-4">
          <h2 id={TITLE_ID} className="m-0 text-lg font-semibold text-primary">{`คืนเงินกู้ (เงินออม) · ${formatMonthKeyTH(month)}`}</h2>
          <button type="button" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-secondary hover:bg-surface-2 disabled:opacity-60 ${FOCUS_RING}`} onClick={close} disabled={busy} aria-label="ปิด">
            <Icons.X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-space-4 overflow-y-auto px-space-5 py-space-4">
          <div className="flex flex-col gap-space-2">
            <span id={RADIOGROUP_ID} className="text-sm font-medium text-primary">คืนให้รายการไหน *</span>
            {hasOpenLoan ? (
              <div role="radiogroup" aria-labelledby={RADIOGROUP_ID} className="flex flex-col gap-space-2">
                {openLoans.map(loan => {
                  const isActive = loan._id === selectedLoanId;
                  const sourceLabel = formatSourceLabel(loan.source, goalNameById);
                  const ageText = formatLoanAge(loan.createdAt, Date.now());
                  const secondLine = `ยืม ${formatCurrency(loan.principalAmount)} ฿ เมื่อ ${formatDateTH(loan.createdAt)}${ageText ? ` · ${ageText}` : ''}${loan.note ? ` · ${loan.note}` : ''}`;
                  return (
                    <button
                      key={loan._id}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      className={`${RADIO_OPTION} ${isActive ? RADIO_OPTION_ACTIVE : ''}`}
                      disabled={busy}
                      onClick={() => { setSelectedLoanId(loan._id); setServerError(null); }}
                    >
                      <span>{`${sourceLabel} — ค้าง ${formatCurrency(loan.outstandingAmount)} ฿`}</span>
                      <span className="text-xs text-tertiary">{secondLine}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="m-0 text-sm text-secondary">ไม่มีเงินกู้ที่ยังไม่คืนในตอนนี้</p>
            )}
          </div>

          <div className="flex flex-col gap-space-2">
            <div className="flex items-center justify-between gap-space-2">
              <label htmlFor={AMOUNT_ID} className="text-sm font-medium text-primary">จำนวนเงินที่คืน (บาท) *</label>
              <button type="button" className={`min-h-11 rounded-sm border border-border-interactive px-space-3 text-xs font-medium text-accent disabled:opacity-60 ${FOCUS_RING}`} onClick={fillFullAmount} disabled={busy || !selectedLoan}>
                คืนทั้งหมด
              </button>
            </div>
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
              disabled={busy || !hasOpenLoan}
              aria-invalid={amountErrorVisible}
              aria-describedby={AMOUNT_ERROR_ID}
            />
            <p id={AMOUNT_ERROR_ID} className="m-0 min-h-5 text-xs text-neg">{amountErrorVisible ? amountError : ''}</p>
            {exceedsOutstanding && selectedLoan && (
              <p className="m-0 text-xs text-secondary">{`เกินยอดค้าง — ระบบจะบันทึกเท่ากับยอดค้าง ${formatCurrency(selectedLoan.outstandingAmount)} ฿`}</p>
            )}
          </div>

          <div className="flex flex-col gap-space-2">
            <label htmlFor={ACCOUNT_ID} className="text-sm font-medium text-primary">จ่ายจากบัญชี</label>
            <select id={ACCOUNT_ID} className={FIELD} value={account} onChange={event => setAccount(event.target.value)} disabled={busy}>
              {accountOptions.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>

          <section className="flex flex-col gap-space-1 border-t border-border-subtle pt-space-3" aria-live="polite">
            {appliedPreview !== null && selectedLoan ? (
              <p className="m-0 text-sm text-primary" data-testid="savings-loan-repayment-preview">
                {selectedLoan.outstandingAmount - appliedPreview <= 0
                  ? 'หลังคืน: ปิดรายการยืมนี้ ✓'
                  : `หลังคืน: ค้าง ${formatCurrency(selectedLoan.outstandingAmount - appliedPreview)} ฿`}
              </p>
            ) : (
              <p className="m-0 text-sm text-secondary">กรอกจำนวนเงินเพื่อดูยอดคงเหลือ</p>
            )}
          </section>

          <div className="flex flex-col gap-space-2 rounded-sm border border-warn/40 bg-warn/10 p-space-3 text-sm text-primary" role="note">
            <p className="m-0">รายการคืนเงินกู้ แก้ไขหรือลบไม่ได้หลังบันทึก — ตรวจยอดและรายการให้ถูกต้องก่อนยืนยัน</p>
            <label htmlFor={ACK_ID} className="flex min-h-11 items-center gap-space-2 text-sm text-primary">
              <input
                id={ACK_ID}
                ref={ackRef}
                type="checkbox"
                checked={acknowledged}
                onChange={event => { setAcknowledged(event.target.checked); setServerError(null); }}
                disabled={busy}
                aria-invalid={ackError !== null}
                aria-describedby={ACK_ERROR_ID}
              />
              เข้าใจแล้ว รายการนี้แก้ไขหรือลบไม่ได้
            </label>
            <p id={ACK_ERROR_ID} className="m-0 min-h-5 text-xs text-neg">{ackError ?? ''}</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-space-3 border-t border-border-subtle px-space-5 py-space-4">
          {serverError && <p role="alert" className="m-0 text-sm text-neg">{serverError}</p>}
          <div className="flex flex-col-reverse items-stretch gap-space-3 md:flex-row md:items-center md:justify-end">
            <button type="button" className={CANCEL_BUTTON} onClick={close} disabled={busy}>ยกเลิก</button>
            <button type="button" className={PRIMARY_BUTTON} onClick={() => void submit()} disabled={!canConfirm}>
              {busy ? 'กำลังบันทึก...' : 'บันทึกการคืนเงิน'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
