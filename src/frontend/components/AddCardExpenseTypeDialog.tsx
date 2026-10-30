/**
 * ไดอะล็อกเลือกประเภท "เพิ่มรายจ่าย" ของบัตรเครดิต (spec-credit-card-add-expense §5.2)
 * - รายจ่ายธรรมดา -> CardSpendItemDialog / ผ่อนชำระ -> InstallmentPlanForm เดิม
 * - default focus = ยกเลิก, Escape = ยกเลิก, Tab วนในไดอะล็อก
 * - คืน focus ให้ opener เป็นหน้าที่ของหน้า (pages/credit-cards.tsx)
 */

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';

export type AddExpenseType = 'spend' | 'installment';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const CHOICE = `flex min-h-11 w-full flex-col items-start gap-[2px] rounded-sm border border-border-interactive bg-surface-2 px-space-3 py-space-2 text-left text-primary hover:bg-surface-3 ${FOCUS_RING}`;
const CANCEL = `min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-sm text-primary ${FOCUS_RING}`;

export default function AddCardExpenseTypeDialog({ open, cardName, onChoose, onCancel }: {
  open: boolean;
  cardName?: string | null;
  onChoose: (type: AddExpenseType) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key === 'Tab' && dialogRef.current) {
      const elements = getTabbableElements(dialogRef.current);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-space-4"
      onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-expense-type-title"
        aria-describedby={cardName ? 'add-expense-type-card' : undefined}
        className="flex w-full max-w-sm flex-col gap-space-3 rounded-md bg-surface-3 p-space-5"
        onKeyDown={handleKeyDown}
      >
        <h2 id="add-expense-type-title" className="m-0 text-lg font-semibold text-primary">เพิ่มรายจ่าย</h2>
        {cardName && <p id="add-expense-type-card" className="m-0 text-sm text-secondary">{`บัตร ${cardName}`}</p>}
        <button type="button" className={CHOICE} onClick={() => onChoose('spend')}>
          <span className="text-sm font-medium">รายจ่ายธรรมดา</span>
          <span className="text-xs text-secondary">จ่ายเต็มในรอบบิล ไม่แบ่งงวด</span>
        </button>
        <button type="button" className={CHOICE} onClick={() => onChoose('installment')}>
          <span className="text-sm font-medium">ผ่อนชำระ</span>
          <span className="text-xs text-secondary">แบ่งจ่ายเป็นงวดรายเดือน</span>
        </button>
        <button ref={cancelRef} type="button" className={CANCEL} onClick={onCancel}>ยกเลิก</button>
      </div>
    </div>
  );
}
