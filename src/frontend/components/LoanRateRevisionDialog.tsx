/**
 * คอมโพเนนต์: LoanRateRevisionDialog — ปรับอัตราดอกเบี้ยสินเชื่อตั้งแต่งวดที่เลือก (UX_SPEC loan-installments §7, J-4)
 *
 * preview เป็นแค่คำแนะนำ — server คำนวณใหม่เองทั้งหมด (CLAUDE.md money rule) แต่ใช้โค้ดชุดเดียวกับ server:
 * k มาจาก findRevisionInstallmentNo และตัวเลขมาจาก reviseEffectiveScheduleTail (N-4, AC-LN-25)
 *
 * bottom sheet ต่ำกว่า 768px / กลางจอ max-w-md ตั้งแต่ 768px (`md:` ตัวเดียว) — ปุ่มยืนยันอยู่ footer ล่างสุดเสมอ
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { findRevisionInstallmentNo, reviseEffectiveScheduleTail } from '../../shared/utils/creditCardAmortization';
import { getCurrentMonthKey, round2, toAmount } from '../../shared/utils/creditCardUtils';
import { formatMonthKeyTH } from '../../shared/utils/dateUtils';
import { creditCardAPI } from '../../shared/utils/frontend/apiUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';
import { Icons } from './Icons';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const CANCEL_BUTTON = `min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary disabled:opacity-60 ${FOCUS_RING}`;
const PRIMARY_BUTTON = `min-h-11 rounded-sm bg-accent px-space-5 text-sm font-semibold text-on-accent disabled:opacity-60 ${FOCUS_RING}`;
const FIELD = `min-h-11 w-full rounded-sm border border-border-interactive bg-surface-1 px-space-3 text-sm text-primary disabled:opacity-60 ${FOCUS_RING}`;
const OVERLAY = 'fixed inset-0 z-[120] flex items-end justify-center overflow-y-auto bg-[rgba(10,10,11,0.72)] p-0 backdrop-blur-sm md:items-center md:p-space-5';
const PANEL = 'flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-lg bg-surface-3 shadow-elev-3 md:max-h-[85vh] md:max-w-md md:rounded-lg';

const TITLE_ID = 'loan-rate-revision-title';
const MONTH_ID = 'loan-rate-revision-month';
const RATE_ID = 'loan-rate-revision-rate';
const RATE_ERROR_ID = 'loan-rate-revision-rate-error';
const MINUS_SIGN = '−';

export interface LoanRateRevisionRow {
  no: number;
  dueMonth: string;
  payment: number | string;
  principal: number | string;
  interest: number | string;
  paid?: boolean;
}

export interface LoanRateRevisionPlan {
  id: string;
  itemName?: string;
  totalPrice: number | string;
  annualRate?: number | string;
  schedule?: LoanRateRevisionRow[];
  nextUnpaid?: { payment?: number | string } | null;
  rateRevisions?: Array<{ effectiveMonth?: unknown }>;
  [key: string]: unknown;
}

export type LoanRateRevisionPreview =
  | {
    ok: true;
    fromInstallmentNo: number;
    lastInstallmentNo: number;
    tailCount: number;
    newPayment: number;
    delta: number;
    totalInterest: number;
  }
  | { ok: false };

export interface LoanRateRevisionSaved {
  plan: unknown;
  effectiveMonth: string;
  newPayment: number;
}

interface LoanRateRevisionDialogProps {
  open: boolean;
  plan: LoanRateRevisionPlan | null;
  cardName?: string;
  /** เดือนปัจจุบันสำหรับเลือกค่าเริ่มต้น — ไม่ส่งมาใช้เดือนของเครื่อง */
  currentMonthKey?: string;
  onClose: () => void;
  /** เรียกหลัง server บันทึกสำเร็จ — plan คือผลจาก server (summarisePlan) ไม่ใช่ค่า preview */
  onSaved: (result: LoanRateRevisionSaved) => void;
}

// ข้อความ error ของ route (ภาษาอังกฤษ) → ข้อความที่ผู้ใช้อ่านได้ ไม่รู้จักก็แสดงข้อความ server ตรง ๆ
const SERVER_ERROR_TEXT: Record<string, string> = {
  'plan not found': 'ไม่พบตารางผ่อนนี้แล้ว — ลองโหลดหน้าใหม่',
  'plan is not ongoing': 'สินเชื่อนี้ไม่ได้อยู่ระหว่างผ่อนแล้ว',
  'effectiveMonth is not an installment month': 'เดือนที่เลือกไม่ตรงกับงวดใดในตารางผ่อน',
  'tail has paid installments': 'มีงวดที่ชำระแล้วตั้งแต่เดือนที่เลือก — ลองโหลดหน้าใหม่',
  'effectiveMonth is before the latest revision': 'เลือกเดือนก่อนการปรับอัตราครั้งล่าสุดไม่ได้',
  'annualRate is unchanged': 'อัตราใหม่ต้องต่างจากอัตราปัจจุบัน',
  'annualRate must be between 0 and 100': 'อัตราดอกเบี้ยต้องอยู่ระหว่าง 0–100%'
};

const toNumber = (value: unknown) => toAmount(value as number | string);

/** แปลงแถวเป็นตัวเลข (server เก็บเป็นตัวเลขอยู่แล้ว) — preview ทำบนสำเนา ไม่แตะ plan ที่ส่งเข้ามา */
function toNumericRows(rows: readonly LoanRateRevisionRow[]) {
  return rows.map(row => ({
    no: Number(row.no),
    dueMonth: row.dueMonth,
    payment: toNumber(row.payment),
    principal: toNumber(row.principal),
    interest: toNumber(row.interest),
    paid: row.paid === true
  }));
}

/**
 * ตัวเลข preview ของการปรับอัตรา — ใช้ helper ชุดเดียวกับ route ทั้ง k และตาราง (N-4)
 * delta เทียบกับค่างวดปัจจุบัน (nextUnpaid.payment)
 */
export function computeLoanRateRevisionPreview(
  plan: Pick<LoanRateRevisionPlan, 'totalPrice' | 'schedule' | 'nextUnpaid'>,
  effectiveMonth: string,
  annualRate: number
): LoanRateRevisionPreview {
  const rows = toNumericRows(Array.isArray(plan.schedule) ? plan.schedule : []);
  const k = findRevisionInstallmentNo(rows, effectiveMonth);
  if (k === null || !Number.isFinite(annualRate)) return { ok: false };
  // route ปัด round2 ก่อนคำนวณ (newRate) — ปัดเหมือนกันเพื่อให้ preview ตรงกับค่าที่บันทึก
  const revised = reviseEffectiveScheduleTail(
    { totalPrice: plan.totalPrice, schedule: rows },
    { fromInstallmentNo: k, annualRate: round2(annualRate) }
  );
  if (!revised.ok) return { ok: false };
  const currentPayment = toNumber(plan.nextUnpaid?.payment ?? NaN);
  return {
    ok: true,
    fromInstallmentNo: k,
    lastInstallmentNo: rows.length,
    tailCount: rows.length - k + 1,
    newPayment: revised.monthlyPayment,
    delta: Number.isFinite(currentPayment) ? round2(revised.monthlyPayment - currentPayment) : 0,
    totalInterest: revised.totalInterest
  };
}

/** งวดที่เลือกได้: หลังงวดที่ชำระล่าสุด และไม่ก่อนเดือนของการปรับครั้งล่าสุด (BR-CC-040, E-13/E-15) */
function eligibleRows(plan: LoanRateRevisionPlan | null) {
  const rows = Array.isArray(plan?.schedule) ? plan!.schedule : [];
  let lastPaidIndex = -1;
  rows.forEach((row, index) => { if (row?.paid === true) lastPaidIndex = index; });
  const revisions = Array.isArray(plan?.rateRevisions) ? plan!.rateRevisions : [];
  const latestMonth = revisions.length ? String(revisions[revisions.length - 1]?.effectiveMonth ?? '') : '';
  return rows
    .map((row, index) => ({ no: index + 1, dueMonth: row.dueMonth, index }))
    .filter(row => row.index > lastPaidIndex && typeof row.dueMonth === 'string' && row.dueMonth >= latestMonth);
}

function formatDelta(delta: number) {
  if (delta === 0) return `±${formatCurrency(0)}`;
  return `${delta > 0 ? '+' : MINUS_SIGN}${formatCurrency(Math.abs(delta))}`;
}

function validateRate(raw: string, currentRate: number): string | null {
  if (!raw.trim()) return null;
  const rate = toAmount(raw);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return 'อัตราดอกเบี้ยต้องอยู่ระหว่าง 0–100%';
  if (Number.isFinite(currentRate) && round2(rate) === round2(currentRate)) return 'อัตราใหม่ต้องต่างจากอัตราปัจจุบัน';
  return null;
}

export default function LoanRateRevisionDialog({
  open,
  plan,
  cardName,
  currentMonthKey,
  onClose,
  onSaved
}: LoanRateRevisionDialogProps) {
  const [effectiveMonth, setEffectiveMonth] = useState('');
  const [rateInput, setRateInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const monthRef = useRef<HTMLSelectElement | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const options = useMemo(() => eligibleRows(plan), [plan]);
  const currentRate = toNumber(plan?.annualRate ?? NaN);

  useEffect(() => {
    if (!open) return undefined;
    const thisMonth = currentMonthKey || getCurrentMonthKey();
    const preferred = options.find(row => row.dueMonth >= thisMonth) ?? options[0];
    setEffectiveMonth(preferred?.dueMonth ?? '');
    setRateInput('');
    setServerError(null);
    setBusy(false);
    // ตั้งค่าใหม่เมื่อเปิดหรือเปลี่ยนแผนเท่านั้น — refetch ระหว่างเปิดไม่ล้างค่าที่ผู้ใช้กรอก
  }, [open, plan?.id]);

  useEffect(() => {
    if (!open) return undefined;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = setTimeout(() => monthRef.current?.focus(), 40);
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

  const rateError = validateRate(rateInput, currentRate);
  const rate = toAmount(rateInput);
  const rateValid = rateInput.trim() !== '' && rateError === null;
  const preview = useMemo(
    () => (plan && effectiveMonth && rateValid ? computeLoanRateRevisionPreview(plan, effectiveMonth, rate) : null),
    [plan, effectiveMonth, rateValid, rate]
  );

  if (!open || !plan) return null;

  const canConfirm = !busy && rateValid && preview?.ok === true;
  const close = () => { if (!busy) onClose(); };

  const submit = async () => {
    if (!canConfirm || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setServerError(null);
    try {
      const response = await creditCardAPI.reviseLoanRate(plan.id, effectiveMonth, round2(rate));
      const savedPlan = response?.plan;
      const savedPayment = toNumber((savedPlan as { monthlyPayment?: unknown } | undefined)?.monthlyPayment ?? NaN);
      busyRef.current = false;
      setBusy(false);
      onSaved({
        plan: savedPlan,
        effectiveMonth,
        newPayment: Number.isFinite(savedPayment) ? savedPayment : (preview?.ok ? preview.newPayment : 0)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setServerError(SERVER_ERROR_TEXT[message] ?? (message || 'ปรับอัตราดอกเบี้ยไม่สำเร็จ ลองอีกครั้ง'));
      busyRef.current = false;
      setBusy(false);
    }
  };

  const title = `ปรับอัตราดอกเบี้ย${cardName ? ` · ${cardName}` : ''}`;
  const rateFieldErrorVisible = rateError !== null;

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
            {`อัตราปัจจุบัน ${Number.isFinite(currentRate) ? currentRate.toFixed(2) : '-'}% ต่อปี`}
          </p>

          <div className="flex flex-col gap-space-2">
            <label htmlFor={MONTH_ID} className="text-sm font-medium text-primary">มีผลตั้งแต่งวด *</label>
            <select
              id={MONTH_ID}
              ref={monthRef}
              className={FIELD}
              value={effectiveMonth}
              onChange={event => { setEffectiveMonth(event.target.value); setServerError(null); }}
              disabled={busy || options.length === 0}
            >
              {options.map(row => (
                <option key={row.dueMonth} value={row.dueMonth}>
                  {`งวด ${row.no} · ${formatMonthKeyTH(row.dueMonth)}`}
                </option>
              ))}
            </select>
            {options.length === 0 && (
              <p className="m-0 text-sm text-secondary">ไม่มีงวดที่ยังไม่ชำระให้ปรับอัตรา</p>
            )}
          </div>

          <div className="flex flex-col gap-space-2">
            <label htmlFor={RATE_ID} className="text-sm font-medium text-primary">อัตราใหม่ต่อปี (%) *</label>
            <input
              id={RATE_ID}
              className={FIELD}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder={Number.isFinite(currentRate) ? currentRate.toFixed(2) : ''}
              value={rateInput}
              onChange={event => { setRateInput(event.target.value); setServerError(null); }}
              disabled={busy}
              aria-invalid={rateFieldErrorVisible}
              aria-describedby={RATE_ERROR_ID}
            />
            {/* เว้นบรรทัดไว้เสมอ ข้อความ error จึงไม่ดันเนื้อหาเลื่อน */}
            <p id={RATE_ERROR_ID} className="m-0 min-h-5 text-xs text-neg">{rateError ?? ''}</p>
          </div>

          <section className="flex flex-col gap-space-2 border-t border-border-subtle pt-space-3" aria-live="polite">
            <h3 className="m-0 text-sm font-semibold text-primary">ผลกระทบ (คำนวณใหม่เฉพาะงวดที่ยังไม่ชำระ)</h3>
            {preview?.ok ? (
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-space-4 gap-y-space-1 text-sm">
                <dt className="text-secondary">ค่างวดใหม่</dt>
                <dd className="m-0 text-primary" data-testid="loan-rate-preview-payment">
                  {`${formatCurrency(preview.newPayment)} ฿ (${formatDelta(preview.delta)} ฿/งวด)`}
                </dd>
                <dt className="text-secondary">งวดที่ปรับ</dt>
                <dd className="m-0 text-primary">
                  {`${preview.fromInstallmentNo}–${preview.lastInstallmentNo} (${preview.tailCount} งวด, จำนวนงวดเท่าเดิม)`}
                </dd>
                <dt className="text-secondary">ดอกเบี้ยรวมใหม่</dt>
                <dd className="m-0 text-primary">{`${formatCurrency(preview.totalInterest)} ฿`}</dd>
              </dl>
            ) : (
              <p className="m-0 text-sm text-secondary">กรอกอัตราใหม่เพื่อดูค่างวดที่คำนวณใหม่</p>
            )}
            <p className="m-0 text-xs text-secondary">งวดที่ชำระแล้วไม่เปลี่ยนแปลง</p>
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
            <button type="button" className={PRIMARY_BUTTON} onClick={submit} disabled={!canConfirm}>
              {busy ? 'กำลังบันทึก...' : 'ยืนยันปรับอัตรา'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
