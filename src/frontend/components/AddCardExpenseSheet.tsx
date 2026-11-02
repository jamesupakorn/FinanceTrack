/**
 * คอมโพเนนต์: AddCardExpenseSheet — sheet เดียวสำหรับ "เพิ่มรายจ่าย" ของบัตรเครดิต (create) และ "แก้ไขรายจ่าย" (edit)
 * แทน AddCardExpenseTypeDialog + CardSpendItemDialog (spec-credit-card-detail-redesign §6)
 *
 * - create: ขั้น `type` (เลือกรายจ่ายธรรมดา/ผ่อนชำระ) → ขั้น `spend` ใน dialog element เดิม; `initialStep='spend'` ข้ามขั้นแรก
 * - edit: เปิดที่ขั้น spend พร้อมค่าเดิมของรายการ; ส่ง purchaseDate เฉพาะเมื่อเปลี่ยน (S-5)
 * - ส่งเฉพาะ {cardId, purchaseDate, name, amount}; เดือนรอบบิลเซิร์ฟเวอร์เป็นผู้คำนวณ (SPEND-3)
 * - preview รอบบิลเป็นเพียง hint ไม่มี optimistic UI
 * - ผ่อนชำระ → onChooseInstallment() แล้วหน้าเป็นคนเปิด InstallmentPlanForm (DD-1)
 * - คืน focus ให้ opener / refetch เป็นหน้าที่ของหน้า (onSaved/onCancel)
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
import { Icons } from './Icons';

export interface SpendDialogCard {
  id: string;
  name: string;
  statementDay?: number | string | null;
  dueDay?: number | string | null;
}

export type AddExpenseSheetMode = 'create' | 'edit';
export type AddExpenseSheetStep = 'type' | 'spend';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const BUTTON = `min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-sm text-primary disabled:opacity-60 ${FOCUS_RING}`;
const INPUT = `min-h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-primary ${FOCUS_RING}`;
const CHOICE = `flex min-h-11 w-full flex-col items-start gap-[2px] rounded-sm border border-border-interactive bg-surface-2 px-space-3 py-space-2 text-left text-primary hover:bg-surface-3 ${FOCUS_RING}`;
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

export interface AddCardExpenseSheetProps {
  open: boolean;
  mode?: AddExpenseSheetMode;
  cards: SpendDialogCard[];
  /** บัตรที่เลือกไว้ล่วงหน้า; null = ให้ผู้ใช้เลือกในขั้น spend (เส้นทางจาก dashboard) */
  card: SpendDialogCard | null;
  /** เดือนรอบบิลเป้าหมาย (YYYY-MM) ใช้คำนวณวันที่เริ่มต้นเท่านั้น */
  month: string;
  /** รายการที่แก้ไข (mode='edit') */
  item?: CreditSpendItem | null;
  initialStep?: AddExpenseSheetStep;
  onChooseInstallment: () => void;
  onCancel: () => void;
  onSaved: (item: CreditSpendItem) => void | Promise<void>;
}

export default function AddCardExpenseSheet(props: AddCardExpenseSheetProps) {
  // unmount ตอนปิด เพื่อให้ state ของฟอร์มเริ่มใหม่ทุกครั้งที่เปิด
  if (!props.open) return null;
  return <SheetBody {...props} />;
}

function SheetBody({
  mode = 'create',
  cards,
  card,
  month,
  item = null,
  initialStep = 'type',
  onChooseInstallment,
  onCancel,
  onSaved
}: AddCardExpenseSheetProps) {
  const isEdit = mode === 'edit' && item !== null;
  const startStep: AddExpenseSheetStep = isEdit ? 'spend' : initialStep;
  const initialValues = useRef({
    cardId: card?.id ?? (isEdit ? item.cardId : ''),
    name: isEdit ? item.name : '',
    amount: isEdit ? String(item.amount) : '',
    purchaseDate: isEdit ? (item.purchaseDate ?? '') : defaultPurchaseDate(card, month)
  });
  const [step, setStep] = useState<AddExpenseSheetStep>(startStep);
  const [cardId, setCardId] = useState(initialValues.current.cardId);
  const [name, setName] = useState(initialValues.current.name);
  const [amount, setAmount] = useState(initialValues.current.amount);
  const [purchaseDate, setPurchaseDate] = useState(initialValues.current.purchaseDate);
  const [errorText, setErrorText] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const dateEditedRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const spendChoiceRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const stepFocusRef = useRef<'heading' | 'choice' | null>(null);
  const [focusField, setFocusField] = useState<{ field: string; n: number } | null>(null);

  const selected = card ?? cards.find(c => c.id === cardId) ?? null;
  const dirty = name !== initialValues.current.name
    || amount !== initialValues.current.amount
    || purchaseDate !== initialValues.current.purchaseDate
    || cardId !== initialValues.current.cardId;

  // default focus = "ยกเลิก" (ไม่เด้งคีย์บอร์ดมือถือ — AC-AE2/AC-AE4)
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  // S-3: ล็อกการเลื่อนพื้นหลังขณะเปิด แล้วคืนค่าเดิมตอนปิด
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  // ขั้นเปลี่ยน → ปุ่มที่กดถูก unmount จึงต้องย้าย focus เอง (S-10)
  useEffect(() => {
    const target = stepFocusRef.current;
    if (!target) return;
    stepFocusRef.current = null;
    (target === 'heading' ? headingRef.current : spendChoiceRef.current)?.focus();
  }, [step]);

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

  const failWith = (error: unknown) => {
    setErrorText(error instanceof Error && error.message ? error.message : GENERIC_ERROR);
    // ไม่มีฟิลด์ที่ map ได้ → โฟกัสปุ่มบันทึก (effect ทำงานหลัง re-render ที่ปุ่มหยุด disabled แล้ว)
    const invalid = firstInvalidField(error) ?? 'submit';
    setFocusField(prev => ({ field: invalid, n: (prev?.n ?? 0) + 1 }));
    busyRef.current = false;
    setBusy(false);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current) return;
    const trimmedName = name.trim();
    if (!selected) { setErrorText('กรุณาเลือกบัตร'); return; }
    if (!trimmedName) { setErrorText('กรุณากรอกชื่อรายการ'); return; }
    // edit: รายการเก่าไม่มีวันที่ → ฟิลด์ว่างได้ (ไม่ required); ตรวจเฉพาะเมื่อ required หรือมีค่า
    const dateRequired = !isEdit || Boolean(item?.purchaseDate);
    if ((dateRequired || purchaseDate) && !isValidPurchaseDate(purchaseDate)) {
      setErrorText('กรุณาเลือกวันที่ซื้อให้ถูกต้อง');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setErrorText('');
    let saved: CreditSpendItem;
    try {
      if (isEdit) {
        const response = await creditCardAPI.updateSpendItem({
          id: item.id,
          name: trimmedName,
          amount,
          ...(purchaseDate && purchaseDate !== item.purchaseDate ? { purchaseDate } : {})
        });
        saved = response.item;
      } else {
        const response = await creditCardAPI.createSpendItem({
          cardId: selected.id,
          purchaseDate,
          name: trimmedName,
          amount
        });
        saved = response.item;
      }
    } catch (error) {
      failWith(error);
      return;
    }
    busyRef.current = false;
    setBusy(false);
    await onSaved(saved);
  };

  const headingText = step === 'type' ? 'เพิ่มรายจ่าย' : isEdit ? 'แก้ไขรายจ่าย' : 'รายจ่ายธรรมดา';
  const showBackToType = step === 'spend' && !isEdit && initialStep === 'type';

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/70 md:items-center md:p-space-5"
      onMouseDown={event => {
        // S-12: แตะพื้นหลังปิดได้เฉพาะเมื่อฟอร์มยังไม่ถูกแก้ และไม่ busy
        if (event.target === event.currentTarget && !busyRef.current && !dirty) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-expense-sheet-title"
        aria-describedby={card ? 'add-expense-sheet-card' : undefined}
        className="flex max-h-[95vh] w-full animate-[sheetSlideUp_180ms_cubic-bezier(0.22,1,0.36,1)] flex-col rounded-t-lg bg-surface-3 md:max-h-[85vh] md:max-w-md md:rounded-lg"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-start justify-between gap-space-3 px-space-5 pt-space-4">
          <div className="flex min-w-0 flex-col gap-space-1">
            <h2
              id="add-expense-sheet-title"
              ref={headingRef}
              tabIndex={-1}
              className="m-0 text-lg font-semibold text-primary outline-none"
            >
              {headingText}
            </h2>
            {card && <p id="add-expense-sheet-card" className="m-0 text-sm text-secondary">{`บัตร ${card.name}`}</p>}
          </div>
          <button
            type="button"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-secondary hover:bg-surface-2 ${FOCUS_RING}`}
            aria-label="ปิด"
            disabled={busy}
            onClick={onCancel}
          >
            <Icons.X size={18} />
          </button>
        </div>

        {step === 'type' ? (
          <>
            <div className="flex flex-col gap-space-3 overflow-y-auto px-space-5 py-space-4">
              <button
                ref={spendChoiceRef}
                type="button"
                className={CHOICE}
                onClick={() => { stepFocusRef.current = 'heading'; setStep('spend'); }}
              >
                <span className="text-sm font-medium">รายจ่ายธรรมดา</span>
                <span className="text-xs text-secondary">จ่ายเต็มในรอบบิล ไม่แบ่งงวด</span>
              </button>
              <button type="button" className={CHOICE} onClick={onChooseInstallment}>
                <span className="text-sm font-medium">ผ่อนชำระ</span>
                <span className="text-xs text-secondary">แบ่งจ่ายเป็นงวดรายเดือน</span>
              </button>
            </div>
            <div className="flex gap-space-3 px-space-5 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] pt-space-3">
              <button ref={cancelRef} type="button" className={BUTTON} onClick={onCancel}>ยกเลิก</button>
            </div>
          </>
        ) : (
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => { void handleSubmit(event); }} noValidate>
            <div className="flex flex-col gap-space-3 overflow-y-auto px-space-5 py-space-4">
              {showBackToType && (
                <button
                  type="button"
                  className={`min-h-11 self-start rounded-sm px-space-2 text-sm font-medium text-accent hover:underline ${FOCUS_RING}`}
                  disabled={busy}
                  onClick={() => { stepFocusRef.current = 'choice'; setStep('type'); }}
                >
                  ‹ เปลี่ยนประเภท
                </button>
              )}
              {!card && !isEdit && (
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
                  required={!isEdit || Boolean(item?.purchaseDate)}
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
            </div>
            <div className="flex gap-space-3 px-space-5 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] pt-space-3">
              <button ref={cancelRef} type="button" className={BUTTON} disabled={busy} onClick={onCancel}>ยกเลิก</button>
              <button ref={submitRef} type="submit" className={BUTTON} disabled={busy}>บันทึกรายการ</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
