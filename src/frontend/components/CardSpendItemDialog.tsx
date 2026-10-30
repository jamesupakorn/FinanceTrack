/**
 * ไดอะล็อก "รายจ่ายธรรมดา" ของบัตรเครดิต (spec-credit-card-add-expense §5.3)
 * - ส่งเฉพาะ {cardId, purchaseDate, name, amount}; เดือนรอบบิลเซิร์ฟเวอร์เป็นผู้คำนวณ (SPEND-3)
 * - preview รอบบิลเป็นเพียง hint ใช้ helper เดียวกับ CreditSpendItems; ไม่มี optimistic UI
 * - คืน focus ให้ opener/refetch เป็นหน้าที่ของหน้า (onSaved/onCancel)
 */

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { creditCardAPI, type CreditSpendItem } from '../../shared/utils/frontend/apiUtils';
import { formatMonthKeyTH, getCurrentDateInfo } from '../../shared/utils/dateUtils';
import {
  computeStartMonthFromPurchase,
  formatIsoDateTH,
  isValidPurchaseDate,
  resolveCardDueDate,
  resolveStatementCutoffDate
} from '../../shared/utils/creditCardUtils';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';

export interface SpendDialogCard {
  id: string;
  name: string;
  statementDay?: number | string | null;
  dueDay?: number | string | null;
}

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const BUTTON = `min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-sm text-primary disabled:opacity-60 ${FOCUS_RING}`;
const INPUT = `min-h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-primary ${FOCUS_RING}`;
const GENERIC_ERROR = 'บันทึกรายการไม่สำเร็จ กรุณาลองใหม่';

function localToday(): string {
  return getCurrentDateInfo()?.dateKey ?? '';
}

/** วันที่ซื้อเริ่มต้น: today ถ้าอยู่ในรอบ M, ไม่งั้นวันตัดรอบของ M (§5.3.1) */
export function defaultPurchaseDate(card: SpendDialogCard | null | undefined, month: string): string {
  const today = localToday();
  if (!card || !month) return today;
  if (isValidPurchaseDate(today) && computeStartMonthFromPurchase(today, card.statementDay) === month) return today;
  const cutoff = resolveStatementCutoffDate(card.statementDay, month);
  return cutoff && isValidPurchaseDate(cutoff) ? cutoff : today;
}

/** ฟิลด์แรกตามลำดับในฟอร์มที่ `errors` ของ 400 (spend-items) ระบุ (§5.3.2); jsonFetch แนบ errors ไว้กับ Error */
function firstInvalidField(error: unknown): string | null {
  const errors = (error as { errors?: Record<string, unknown> } | null)?.errors;
  if (!errors || typeof errors !== 'object') return null;
  return ['name', 'amount', 'purchaseDate'].find(k => k in errors) ?? null;
}

export default function CardSpendItemDialog({ cards, card, month, onCancel, onSaved }: {
  cards: SpendDialogCard[];
  /** บัตรที่เลือกไว้ล่วงหน้า; null = ให้ผู้ใช้เลือกในไดอะล็อก */
  card: SpendDialogCard | null;
  /** เดือนรอบบิลเป้าหมาย (YYYY-MM) ใช้คำนวณวันที่เริ่มต้นเท่านั้น */
  month: string;
  onCancel: () => void;
  onSaved: (item: CreditSpendItem) => void | Promise<void>;
}) {
  const [cardId, setCardId] = useState(card?.id ?? '');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(() => defaultPurchaseDate(card, month));
  const [errorText, setErrorText] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const dateEditedRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const [focusField, setFocusField] = useState<{ field: string; n: number } | null>(null);

  const selected = card ?? cards.find(c => c.id === cardId) ?? null;

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!focusField) return;
    const target = focusField.field === 'name' ? nameRef
      : focusField.field === 'amount' ? amountRef
      : focusField.field === 'purchaseDate' ? dateRef
      : submitRef;
    target.current?.focus();
  }, [focusField]);

  const billingMonth = selected && isValidPurchaseDate(purchaseDate)
    ? computeStartMonthFromPurchase(purchaseDate, selected.statementDay)
    : '';
  const dueDate = billingMonth && selected
    ? resolveCardDueDate({ statementDay: selected.statementDay, dueDay: selected.dueDay ?? 'EOM' }, billingMonth)
    : null;

  const handleCardChange = (id: string) => {
    setCardId(id);
    if (!dateEditedRef.current) {
      setPurchaseDate(defaultPurchaseDate(cards.find(c => c.id === id) ?? null, month));
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!busyRef.current) onCancel();
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

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current) return;
    const trimmedName = name.trim();
    if (!selected) { setErrorText('กรุณาเลือกบัตร'); return; }
    if (!trimmedName) { setErrorText('กรุณากรอกชื่อรายการ'); return; }
    if (!isValidPurchaseDate(purchaseDate)) { setErrorText('กรุณาเลือกวันที่ซื้อให้ถูกต้อง'); return; }
    busyRef.current = true;
    setBusy(true);
    setErrorText('');
    let item: CreditSpendItem;
    try {
      const response = await creditCardAPI.createSpendItem({
        cardId: selected.id,
        purchaseDate,
        name: trimmedName,
        amount
      });
      item = response.item;
    } catch (error) {
      setErrorText(error instanceof Error && error.message ? error.message : GENERIC_ERROR);
      // ไม่มีฟิลด์ที่ map ได้ → โฟกัสปุ่มบันทึก (effect ทำงานหลัง re-render ที่ปุ่มหยุด disabled แล้ว)
      const invalid = firstInvalidField(error) ?? 'submit';
      setFocusField(prev => ({ field: invalid, n: (prev?.n ?? 0) + 1 }));
      busyRef.current = false;
      setBusy(false);
      return;
    }
    busyRef.current = false;
    setBusy(false);
    await onSaved(item);
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-space-4"
      onMouseDown={event => { if (event.target === event.currentTarget && !busyRef.current) onCancel(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-spend-title"
        className="w-full max-w-md rounded-md bg-surface-3 p-space-5"
        onKeyDown={handleKeyDown}
      >
        <form className="flex flex-col gap-space-3" onSubmit={event => { void handleSubmit(event); }} noValidate>
          <h2 id="card-spend-title" className="m-0 text-lg font-semibold text-primary">รายจ่ายธรรมดา</h2>
          {card ? (
            <p className="m-0 text-sm text-secondary">{`บัตร ${card.name}`}</p>
          ) : (
            <label className="text-sm text-secondary">บัตร
              <select
                className={INPUT}
                required
                value={cardId}
                disabled={busy}
                onChange={event => handleCardChange(event.target.value)}
              >
                <option value="">— เลือกบัตร —</option>
                {cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          <label className="text-sm text-secondary">ชื่อรายการ
            <input
              ref={nameRef}
              className={INPUT}
              required
              maxLength={60}
              value={name}
              disabled={busy}
              aria-invalid={Boolean(errorText) || undefined}
              aria-describedby={errorText ? 'card-spend-error' : undefined}
              onChange={event => setName(event.target.value)}
            />
          </label>
          <label className="text-sm text-secondary">จำนวนเงิน (บาท)
            <input
              ref={amountRef}
              className={INPUT}
              required
              type="text"
              inputMode="decimal"
              value={amount}
              disabled={busy}
              onChange={event => setAmount(event.target.value)}
            />
          </label>
          <label className="text-sm text-secondary">วันที่ซื้อ
            <input
              ref={dateRef}
              className={INPUT}
              required
              type="date"
              value={purchaseDate}
              disabled={busy}
              onChange={event => { dateEditedRef.current = true; setPurchaseDate(event.target.value); }}
            />
          </label>
          {billingMonth && dueDate && (
            <p role="status" className="m-0 text-sm text-secondary">
              {`รอบบิล ${formatMonthKeyTH(billingMonth)} · ครบกำหนด ${formatIsoDateTH(dueDate)}`}
            </p>
          )}
          {errorText && <p id="card-spend-error" role="alert" className="m-0 text-sm text-neg">{errorText}</p>}
          <div className="flex gap-space-3">
            <button ref={cancelRef} type="button" className={BUTTON} disabled={busy} onClick={onCancel}>ยกเลิก</button>
            <button ref={submitRef} type="submit" className={BUTTON} disabled={busy}>บันทึกรายการ</button>
          </div>
        </form>
      </div>
    </div>
  );
}
