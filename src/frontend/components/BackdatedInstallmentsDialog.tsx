import { useEffect, useRef, useState } from 'react';
import type { OverdueInstallment } from '../../shared/utils/installmentBackdate';
import { formatMonthKeyTH } from '../../shared/utils/dateUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';
import { Icons } from './Icons';
import {
  PAID_PILL_CLASS,
  PAID_PILL_ON_CLASS,
  PAID_PILL_LABEL_PAID,
  PAID_PILL_LABEL_UNPAID
} from './installmentPaidPill';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const CANCEL_BUTTON = `min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary disabled:opacity-60 ${FOCUS_RING}`;
const PRIMARY_BUTTON = `min-h-11 rounded-sm bg-accent px-space-5 text-sm font-semibold text-on-accent disabled:opacity-60 ${FOCUS_RING}`;
const OVERLAY = 'fixed inset-0 z-[120] flex items-end justify-center overflow-y-auto bg-[rgba(10,10,11,0.72)] p-0 backdrop-blur-sm md:items-center md:p-space-5';
const PANEL = 'flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-lg bg-surface-3 shadow-elev-3 md:max-h-[85vh] md:rounded-lg';

interface BackdatedInstallmentsDialogProps {
  open: boolean;
  months: number;
  currentMonthKey: string;
  rows: OverdueInstallment[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (paidInstallmentNos: number[]) => void;
}

interface FailedInstallment {
  no: number;
  dueMonth: string;
}

interface BackdatedPaidFailureDialogProps {
  open: boolean;
  itemName: string;
  months: number;
  requestedCount: number;
  failed: FailedInstallment[];
  onClose: () => void;
  onGoToCard: () => void;
}

export default function BackdatedInstallmentsDialog({
  open,
  months,
  currentMonthKey,
  rows,
  busy,
  onCancel,
  onConfirm
}: BackdatedInstallmentsDialogProps) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstPillRef = useRef<HTMLButtonElement | null>(null);
  const confirmingRef = useRef(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return undefined;
    setSelected(new Set());
    confirmingRef.current = false;
    const timer = setTimeout(() => firstPillRef.current?.focus(), 40);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (!busyRef.current) onCancelRef.current();
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
    };
  }, [open]);

  if (!open) return null;

  const toggle = (no: number) => setSelected(current => {
    const next = new Set(current);
    if (next.has(no)) next.delete(no);
    else next.add(no);
    return next;
  });

  const confirm = () => {
    if (busy || confirmingRef.current) return;
    confirmingRef.current = true;
    onConfirm([...selected].sort((a, b) => a - b));
  };

  return (
    <div
      className={OVERLAY}
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className={`${PANEL} md:max-w-md`}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="backdated-installments-title"
      >
        <div className="flex shrink-0 items-center justify-between gap-space-3 border-b border-border-subtle px-space-5 py-space-4">
          <h2 id="backdated-installments-title" className="m-0 text-lg font-semibold text-primary">
            {`มีงวดที่ผ่านมาแล้ว ${rows.length} งวด`}
          </h2>
          <button
            type="button"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-secondary hover:bg-surface-2 disabled:opacity-60 ${FOCUS_RING}`}
            onClick={() => { if (!busy) onCancel(); }}
            disabled={busy}
            aria-label="ปิด"
          >
            <Icons.X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-space-4 overflow-y-auto px-space-5 py-space-4">
          <p className="m-0 text-sm leading-relaxed text-secondary">
            {`แผนนี้เริ่มก่อนเดือนนี้ (${formatMonthKeyTH(currentMonthKey)}) — แตะยืนยันเฉพาะงวดที่ชำระไปแล้วจริง งวดที่ไม่ได้แตะจะบันทึกเป็น "ยังไม่ชำระ"`}
          </p>
          <div className="flex flex-col gap-space-3">
            {rows.map((row, index) => {
              const isPaid = selected.has(row.no);
              const labelId = `backdated-installment-${row.no}-label`;
              return (
                <div key={row.no} className="grid grid-cols-1 gap-space-2 md:grid-cols-[1fr_240px] md:items-center">
                  <p id={labelId} className="m-0 text-sm text-primary">
                    {`งวด ${row.no}/${months} · ${formatMonthKeyTH(row.dueMonth)} · ${formatCurrency(row.payment)} บาท`}
                  </p>
                  <button
                    ref={index === 0 ? firstPillRef : undefined}
                    type="button"
                    className={`${PAID_PILL_CLASS} ${isPaid ? PAID_PILL_ON_CLASS : ''}`}
                    aria-pressed={isPaid}
                    aria-describedby={labelId}
                    disabled={busy}
                    onClick={() => toggle(row.no)}
                  >
                    {isPaid ? PAID_PILL_LABEL_PAID : PAID_PILL_LABEL_UNPAID}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-space-3 border-t border-border-subtle px-space-5 py-space-4">
          <p className="m-0 text-sm text-secondary" aria-live="polite">
            {`ยืนยันว่าชำระแล้ว ${selected.size} จาก ${rows.length} งวด`}
          </p>
          {selected.size > 0 && (
            <p className="m-0 text-xs leading-relaxed text-warn">
              เมื่อบันทึกงวดที่ชำระแล้ว จะแก้ราคา จำนวนงวด ดอกเบี้ย และวันที่ซื้อ/รอบบิลของแผนนี้ไม่ได้อีก (แก้ชื่อได้)
            </p>
          )}
          <div className="flex flex-col-reverse items-stretch gap-space-3 md:flex-row md:items-center md:justify-end">
            <button type="button" className={CANCEL_BUTTON} onClick={() => { if (!busy) onCancel(); }} disabled={busy}>
              ยกเลิก
            </button>
            <button type="button" className={PRIMARY_BUTTON} onClick={confirm} disabled={busy}>
              {busy ? 'กำลังบันทึก...' : 'ยืนยัน'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BackdatedPaidFailureDialog({
  open,
  itemName,
  months,
  requestedCount,
  failed,
  onClose,
  onGoToCard
}: BackdatedPaidFailureDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const goToCardRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = setTimeout(() => goToCardRef.current?.focus(), 40);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = getTabbableElements(dialogRef.current);
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
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
      trigger?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={OVERLAY}
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`${PANEL} md:max-w-sm`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="backdated-paid-failure-title"
      >
        <div className="flex shrink-0 items-center justify-between gap-space-3 border-b border-border-subtle px-space-5 py-space-4">
          <h2 id="backdated-paid-failure-title" className="m-0 text-lg font-semibold text-primary">
            บันทึกชำระย้อนหลังไม่ครบ
          </h2>
          <button type="button" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-secondary hover:bg-surface-2 ${FOCUS_RING}`} onClick={onClose} aria-label="ปิด">
            <Icons.X size={18} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-space-3 overflow-y-auto px-space-5 py-space-4 text-sm leading-relaxed text-secondary">
          <p className="m-0">{`สร้างแผน "${itemName}" แล้ว`}</p>
          <p className="m-0">{`บันทึกว่าชำระแล้ว ${requestedCount - failed.length} จาก ${requestedCount} งวด`}</p>
          <p className="m-0">งวดต่อไปนี้ยังบันทึกไม่สำเร็จ:</p>
          <ul className="m-0 flex list-disc flex-col gap-space-1 pl-space-5">
            {failed.map(row => (
              <li key={row.no}>{`งวด ${row.no}/${months} · ${formatMonthKeyTH(row.dueMonth)}`}</li>
            ))}
          </ul>
          <p className="m-0">แตะ &quot;ยังไม่ชำระ — แตะเพื่อยืนยัน&quot; ที่งวดเหล่านี้ในตารางผ่อนของบัตรเพื่อลองอีกครั้ง</p>
        </div>
        <div className="flex shrink-0 flex-col gap-space-3 border-t border-border-subtle px-space-5 py-space-4">
          <button ref={goToCardRef} type="button" className={PRIMARY_BUTTON} onClick={onGoToCard}>
            ไปที่ตารางผ่อน
          </button>
          <button type="button" className={CANCEL_BUTTON} onClick={onClose}>ปิด</button>
        </div>
      </div>
    </div>
  );
}
