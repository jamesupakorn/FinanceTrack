import { useEffect, useRef, type KeyboardEvent } from 'react';
import Link from 'next/link';
import type { CardTotalExpenseRow } from '../../shared/utils/backend/creditCardSync';
import { formatMonthKeyTH } from '../../shared/utils/dateUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';
import type { MonthKey } from '../../shared/types/domain';
import { Icons } from './Icons';

const DIALOG_ID = 'expense-card-details-dialog';
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

interface CardExpenseDetailsDialogProps {
  cardId: string;
  cardName: string;
  month: MonthKey;
  total: number | string;
  breakdown: CardTotalExpenseRow['breakdown'];
  opener: HTMLButtonElement | null;
  fallback: HTMLElement | null;
  onClose: () => void;
}

export default function CardExpenseDetailsDialog({
  cardId,
  cardName,
  month,
  total,
  breakdown,
  opener,
  fallback,
  onClose
}: CardExpenseDetailsDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const pageScrollContainer = dialogRef.current?.closest<HTMLElement>('main') ?? null;
    const previousOverflow = document.body.style.overflow;
    const previousPageOverflowY = pageScrollContainer?.style.overflowY ?? '';
    document.body.style.overflow = 'hidden';
    if (pageScrollContainer) pageScrollContainer.style.overflowY = 'hidden';
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (pageScrollContainer) pageScrollContainer.style.overflowY = previousPageOverflowY;
      if (opener?.isConnected) {
        opener.focus();
        if (document.activeElement === opener) return;
      }
      fallback?.focus();
    };
  }, [fallback, opener]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== 'Tab' || !dialogRef.current) return;
    const elements = getTabbableElements(dialogRef.current);
    const first = elements[0];
    const last = elements[elements.length - 1];

    if (elements.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/70 md:items-center md:p-space-4"
      role="presentation"
      onClick={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        id={DIALOG_ID}
        className="flex max-h-[calc(100dvh_-_env(safe-area-inset-top,0px))] w-full min-w-0 max-w-xl flex-col overflow-hidden rounded-t-lg border border-border-default bg-surface-3 shadow-elev-3 md:max-h-[90dvh] md:rounded-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="expense-card-details-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className="flex shrink-0 items-start justify-between gap-space-3 border-b border-border-subtle p-space-4">
          <div className="min-w-0">
            <h2 id="expense-card-details-title" className="break-words text-lg font-semibold text-primary [overflow-wrap:anywhere]">
              {cardName}
            </h2>
            <p className="mt-space-1 text-sm text-secondary">{formatMonthKeyTH(month)}</p>
            <p className="mt-space-2 text-sm text-secondary">ยอดค่าใช้จ่ายรายเดือน</p>
            <p className="font-[family-name:var(--font-numeric)] text-xl font-semibold tabular-nums text-primary">
              {formatCurrency(total)} ฿
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-interactive bg-surface-2 text-primary ${FOCUS_RING}`}
            aria-label="ปิดรายละเอียดบัตร"
            onClick={onClose}
          >
            <Icons.X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-space-4 py-space-3">
          <section aria-labelledby="expense-card-installments-title">
            <h3 id="expense-card-installments-title" className="text-sm font-semibold text-primary">รายการผ่อนชำระ</h3>
            {breakdown.installments.length > 0 ? (
              <ul className="mt-space-2 divide-y divide-border-subtle">
                {breakdown.installments.map(line => (
                  <li key={line.key} className="flex min-w-0 items-start justify-between gap-space-3 py-space-3 text-sm">
                    <span className="min-w-0 break-words text-primary [overflow-wrap:anywhere]">{line.name}</span>
                    <span className="shrink-0 text-right">
                      <span className="block font-[family-name:var(--font-numeric)] tabular-nums text-primary">{formatCurrency(line.amount)} ฿</span>
                      <span className="mt-space-1 block text-xs text-secondary">{line.paid ? 'ชำระแล้ว' : 'ยังไม่ชำระ'}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-space-2 text-sm text-secondary">ไม่มีรายการผ่อนชำระในเดือนนี้</p>
            )}
          </section>

          <section className="mt-space-4 border-t border-border-subtle pt-space-4" aria-labelledby="expense-card-new-spend-title">
            <h3 id="expense-card-new-spend-title" className="text-sm font-semibold text-primary">ยอดใช้จ่ายไม่ผ่อน</h3>
            <p className="mt-space-2 font-[family-name:var(--font-numeric)] text-sm tabular-nums text-secondary">
              {formatCurrency(breakdown.revolving.newSpend)} ฿
            </p>
            {breakdown.revolving.paymentAction === 'minimum' && (
              <p className="mt-space-3 text-sm text-secondary">
                ชำระขั้นต่ำแล้ว {formatCurrency(breakdown.revolving.minPaymentDue)} ฿
              </p>
            )}
          </section>
        </div>

        <footer className="shrink-0 border-t border-border-subtle p-space-4 pb-[calc(env(safe-area-inset-bottom,0px)_+_1rem)]">
          <Link
            href={`/credit-cards?card=${encodeURIComponent(cardId)}`}
            className={`flex min-h-11 w-full items-center justify-center rounded-sm bg-accent px-space-4 text-sm font-semibold text-on-accent ${FOCUS_RING}`}
          >
            ไปหน้าจัดการบัตร
          </Link>
        </footer>
      </div>
    </div>
  );
}