import { useEffect, useRef, useState } from 'react';
import type { CardTotalExpenseRow } from '../../shared/utils/backend/creditCardSync';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';

const BUTTON = 'min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm text-primary disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

export default function CardTotalPaymentDialog({ row, paid, busy, onCancel, onConfirm }: {
  row: Pick<CardTotalExpenseRow, 'name' | 'breakdown'>;
  paid: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (action?: 'full' | 'minimum') => void;
}) {
  const [action, setAction] = useState<'full' | 'minimum'>('full');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const revolving = row.breakdown.revolving;
  const needsChoice = paid && revolving.totalDue > 0 && revolving.paymentAction === null;

  useEffect(() => {
    const opener = document.activeElement;
    cancelRef.current?.focus();
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, []);

  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-space-4">
    <div ref={dialogRef} role={paid ? 'dialog' : 'alertdialog'} aria-modal="true" aria-label={paid ? `ชำระ ${row.name}` : 'ยกเลิกการชำระทั้งหมดของบัตรนี้?'}
      className="w-full max-w-sm rounded-md bg-surface-3 p-space-5" onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onCancel(); }
        if (event.key !== 'Tab' || !dialogRef.current) return;
        const elements = getTabbableElements(dialogRef.current);
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <h2 className="text-lg font-semibold text-primary">{paid ? `ชำระ ${row.name}` : 'ยกเลิกการชำระทั้งหมดของบัตรนี้?'}</h2>
      <p className="my-space-3 text-sm text-secondary">งวดผ่อน (เต็มจำนวน) {formatCurrency(row.breakdown.installmentTotal)} ฿</p>
      {needsChoice && <fieldset className="mb-space-4 flex flex-col gap-space-3 text-primary">
        <legend className="mb-space-2">ยอดหมุนเวียน</legend>
        <label><input type="radio" name="card-payment" checked={action === 'full'} disabled={busy} onChange={() => setAction('full')} /> จ่ายเต็ม {formatCurrency(revolving.totalDue)} ฿</label>
        <label><input type="radio" name="card-payment" checked={action === 'minimum'} disabled={busy} onChange={() => setAction('minimum')} /> จ่ายขั้นต่ำ {formatCurrency(revolving.minPaymentDue)} ฿ (ส่วนที่เหลือยกไปพร้อมดอกเบี้ย)</label>
      </fieldset>}
      {paid && revolving.paymentAction === 'minimum' && <p className="mb-space-3 text-sm text-secondary">ยอดหมุนเวียนชำระขั้นต่ำแล้ว {formatCurrency(revolving.minPaymentDue)} ฿ — คงสถานะเดิม</p>}
      <div className="flex gap-space-3">
        <button ref={cancelRef} className={BUTTON} type="button" disabled={busy} onClick={onCancel}>ยกเลิก</button>
        <button className={BUTTON} type="button" disabled={busy} onClick={() => onConfirm(needsChoice ? action : undefined)}>ยืนยัน</button>
      </div>
    </div>
  </div>;
}
