/**
 * คอมโพเนนต์: CreditCardForm (หน้าจอ 3a)
 * ฟอร์มเพิ่ม/แก้ไขบัตรเครดิต — modal บน desktop, full-screen sheet บนมือถือ (C9)
 *
 * ช่องตัวเลขเป็น type="text" + inputMode เสมอ และไม่ normalize ค่าระหว่างพิมพ์
 * จัดรูปแบบตอน blur เท่านั้น เพื่อไม่ให้ focus หลุดบนมือถือ
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CARD_COLORS, validateCardInput } from '../../shared/utils/creditCardUtils';
import { BASE_CARD_COLORS } from '../../shared/utils/creditCardBasics';
import { BANK_ISSUERS, BANK_ISSUER_KEYS, isBankIssuerKey } from '../../shared/utils/creditCardBankCatalog';
import { END_OF_MONTH_DUE_DAY } from '../../shared/utils/dateUtils';
import { parseAndFormat } from '../../shared/utils/frontend/numberUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';
import { Icons } from './Icons';
import BankIssuerMark from './BankIssuerMark';

interface CreditCardFormRecord {
  id?: string;
  name?: string;
  bankIssuer?: unknown;
  bankName?: string;
  last4?: string;
  color?: string;
  creditLimit?: number | string | null;
  annualRate?: number | string | null;
  minPaymentPercent?: number | string | null;
  statementDay?: number | string | null;
  dueDay?: number | string | null;
}

interface ExistingCardColor {
  id?: string;
  color?: string;
}

interface CreditCardFormState {
  name: string;
  bankIssuer: string;
  bankName: string;
  last4: string;
  color: string;
  creditLimit: string;
  annualRate: string;
  minPaymentPercent: string;
  statementDay: number | string;
  dueDay: number | string;
}

interface CreditCardFormProps {
  open: boolean;
  card?: CreditCardFormRecord | null;
  existingCards?: ExistingCardColor[];
  submitting?: boolean;
  onClose?: () => void;
  onSubmit?: (payload: Record<string, unknown>) => void | Promise<void>;
}

const DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => String(index + 1));

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const INPUT = `min-h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-base text-primary outline-none transition-colors duration-fast ease-graphite focus:border-accent aria-[invalid=true]:border-neg ${FOCUS_RING}`;
const LABEL = 'text-sm font-medium text-secondary';
const HELPER = 'text-xs leading-relaxed text-tertiary';
const ERROR_TEXT = 'text-xs text-neg';
const GROUP_TITLE = 'text-xs font-semibold uppercase tracking-[0.02em] text-tertiary';

const emptyForm: CreditCardFormState = {
  name: '',
  bankIssuer: '',
  bankName: '',
  last4: '',
  color: CARD_COLORS[0],
  creditLimit: '',
  annualRate: '',
  minPaymentPercent: '10',
  statementDay: END_OF_MONTH_DUE_DAY,
  dueDay: END_OF_MONTH_DUE_DAY
};

export default function CreditCardForm({
  open,
  card = null,
  existingCards = [],
  submitting = false,
  onClose,
  onSubmit
}: CreditCardFormProps) {
  const [form, setForm] = useState<CreditCardFormState>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dialogRef = useRef<HTMLFormElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    triggerRef.current = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setErrors({});
    setForm(card
      ? {
        name: card.name || '',
        // Unknown issuers load as empty; never persist a read-time fallback that the user did not select.
        bankIssuer: isBankIssuerKey(card.bankIssuer) ? card.bankIssuer : '',
        bankName: card.bankName || '',
        last4: card.last4 || '',
        color: CARD_COLORS.includes(card.color || '') ? card.color || '' : CARD_COLORS[0],
        creditLimit: card.creditLimit === undefined || card.creditLimit === null ? '' : parseAndFormat(card.creditLimit),
        annualRate: card.annualRate === undefined || card.annualRate === null ? '' : String(card.annualRate),
        minPaymentPercent: card.minPaymentPercent === undefined || card.minPaymentPercent === null
          ? '10'
          : String(card.minPaymentPercent),
        statementDay: card.statementDay ?? END_OF_MONTH_DUE_DAY,
        dueDay: card.dueDay ?? END_OF_MONTH_DUE_DAY
      }
      : emptyForm);
    const timer = setTimeout(() => firstFieldRef.current?.focus(), 40);
    return () => clearTimeout(timer);
  }, [open, card]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current?.();
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
      document.removeEventListener('keydown', handleKeyDown);
      triggerRef.current?.focus();
    };
  }, [open]);

  const usedColors = useMemo(() => new Set(
    existingCards.filter(item => item?.id !== card?.id).map(item => item?.color)
  ), [existingCards, card?.id]);

  if (!open) return null;

  const setField = (field: keyof CreditCardFormState, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  // Only issuer selection changes the brand color; mounting and loading a card never do.
  const handleIssuerChange = (key: string) => {
    if (!isBankIssuerKey(key)) return;
    setForm(prev => (key === 'other'
      ? { ...prev, bankIssuer: key, color: '' }
      : { ...prev, bankIssuer: key, color: BANK_ISSUERS[key].color }));
  };

  const isNamedIssuer = isBankIssuerKey(form.bankIssuer) && form.bankIssuer !== 'other';
  const swatchColors = isNamedIssuer ? CARD_COLORS : BASE_CARD_COLORS;

  const getSwatchLabel = (color: string) => {
    const baseIndex = BASE_CARD_COLORS.indexOf(color);
    if (baseIndex !== -1) return `สีที่ ${baseIndex + 1}`;
    const issuerEntry = Object.entries(BANK_ISSUERS).find(([key, issuer]) => key !== 'other' && issuer.color === color);
    return issuerEntry ? `สี${issuerEntry[1].label}` : `สีที่ ${swatchColors.indexOf(color) + 1}`;
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validateCardInput(form);
    if (!result.valid) {
      setErrors(result.errors);
      showToast('กรุณาตรวจสอบข้อมูลบัตรอีกครั้ง', 'error');
      const firstInvalid = Object.keys(result.errors)[0];
      dialogRef.current?.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }
    setErrors({});
    onSubmit?.({ ...result.value, ...(card?.id ? { id: card.id } : {}) });
  };

  const describedBy = (field: string) => (errors[field] ? `card-${field}-error` : undefined);

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center overflow-y-auto bg-[rgba(10,10,11,0.72)] p-0 backdrop-blur-sm md:items-center md:p-space-5"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <form
        ref={dialogRef}
        className="flex max-h-[95vh] w-full flex-col overflow-hidden rounded-t-lg bg-surface-3 shadow-elev-3 md:max-h-[85vh] md:max-w-lg md:rounded-lg"
        role="dialog"
        aria-modal="true"
        aria-label={card ? 'แก้ไขบัตรเครดิต' : 'เพิ่มบัตรเครดิต'}
        onSubmit={handleSubmit}
      >
        <div className="flex shrink-0 items-center justify-between gap-space-3 border-b border-border-subtle px-space-5 py-space-4">
          <h2 className="m-0 text-lg font-semibold text-primary">{card ? 'แก้ไขบัตรเครดิต' : 'เพิ่มบัตรเครดิต'}</h2>
          <button type="button" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-secondary hover:bg-surface-2 ${FOCUS_RING}`} onClick={onClose} aria-label="ปิด">
            <Icons.X size={18} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0 flex-col gap-space-4 overflow-y-auto px-space-5 py-space-4">
          <fieldset className="m-0 flex flex-col gap-space-3 border-0 p-0">
            <legend className={GROUP_TITLE}>ข้อมูลบัตร</legend>

            <div className="flex flex-col gap-space-1">
              <label className={LABEL} htmlFor="cc-name">ชื่อบัตร <span className="text-neg">*</span></label>
              <input id="cc-name" name="name" ref={firstFieldRef} type="text" className={INPUT} maxLength={40} value={form.name} onChange={(event) => setField('name', event.target.value)} placeholder="KTC Visa" aria-invalid={errors.name ? 'true' : undefined} aria-describedby={describedBy('name')} />
              {errors.name && <span id="card-name-error" className={ERROR_TEXT}>{errors.name}</span>}
            </div>

            <div className="flex flex-col gap-space-1">
              <label className={LABEL} htmlFor="cc-issuer">ธนาคาร / ผู้ออกบัตร</label>
              <div className="flex items-center gap-space-2">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-border-interactive bg-surface-2">
                  <BankIssuerMark card={{ bankIssuer: form.bankIssuer, color: form.color }} size={40} decorative />
                </div>
                <select id="cc-issuer" name="bankIssuer" className={`${INPUT} flex-1`} value={form.bankIssuer || 'other'} onChange={(event) => handleIssuerChange(event.target.value)} aria-describedby="cc-issuer-help">
                  {BANK_ISSUER_KEYS.map(key => <option key={key} value={key}>{BANK_ISSUERS[key].label}</option>)}
                </select>
              </div>
              <span id="cc-issuer-help" className={HELPER}>เลือกแล้วระบบจะเลือกสีแบรนด์ให้ เปลี่ยนสีเองได้ด้านล่าง</span>
            </div>

            <div className="flex flex-col gap-space-1">
              <label className={LABEL} htmlFor="cc-bank">ชื่อบัญชีที่ใช้รวมยอด / ชื่อผลิตภัณฑ์ (ไม่บังคับ)</label>
              <input id="cc-bank" name="bankName" type="text" className={INPUT} maxLength={40} value={form.bankName} onChange={(event) => setField('bankName', event.target.value)} placeholder="เช่น KTC หรือ SPayLater" aria-describedby="cc-bank-help-1 cc-bank-help-2" />
              <span id="cc-bank-help-1" className={HELPER}>ถ้าตรงกับชื่อบัญชีธนาคารที่ใช้อยู่ ระบบจะรวมยอดผ่อนเข้าบัญชีนั้น</span>
              <span id="cc-bank-help-2" className={HELPER}>ใส่ชื่อผลิตภัณฑ์เพิ่มได้ เช่น SPayLater</span>
            </div>

            <div className="flex flex-col gap-space-1">
              <label className={LABEL} htmlFor="cc-last4">เลข 4 ตัวท้าย</label>
              <input id="cc-last4" name="last4" type="text" inputMode="numeric" className={`${INPUT} max-w-[140px]`} maxLength={4} value={form.last4} onChange={(event) => setField('last4', event.target.value.replace(/\D/g, ''))} placeholder="1234" aria-invalid={errors.last4 ? 'true' : undefined} aria-describedby={describedBy('last4')} />
              {errors.last4 && <span id="card-last4-error" className={ERROR_TEXT}>{errors.last4}</span>}
            </div>

            <div className="flex flex-col gap-space-1">
              <span className={LABEL} id="cc-color-label">สีประจำบัตร</span>
              <div className="flex flex-wrap gap-space-2" role="radiogroup" aria-labelledby="cc-color-label">
                {swatchColors.map(color => {
                  const selected = form.color === color;
                  return (
                    <button
                      key={color}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={`${getSwatchLabel(color)}${usedColors.has(color) ? ' (ใช้กับบัตรอื่นแล้ว)' : ''}`}
                      className={`relative flex h-11 w-11 items-center justify-center rounded-sm border-2 text-white ${selected ? 'border-white shadow-[0_0_0_3px_rgba(212,168,87,0.45)]' : 'border-transparent'} ${FOCUS_RING} ${usedColors.has(color) ? 'after:absolute after:bottom-1 after:h-1 after:w-1 after:rounded-full after:bg-white/85 after:content-[\'\']' : ''}`}
                      style={{ background: color }}
                      onClick={() => setField('color', color)}
                    >
                      {selected && <Icons.Check size={16} color="#fff" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </fieldset>

          <div className="h-px bg-border-subtle" />

          <fieldset className="m-0 flex flex-col gap-space-3 border-0 p-0">
            <legend className={GROUP_TITLE}>วงเงินและกำหนดชำระ</legend>
            <div className="flex flex-col gap-space-1">
              <label className={LABEL} htmlFor="cc-limit">วงเงินบัตร (บาท)</label>
              <input id="cc-limit" name="creditLimit" type="text" inputMode="decimal" className={INPUT} value={form.creditLimit} onChange={(event) => setField('creditLimit', event.target.value)} onBlur={(event) => setField('creditLimit', event.target.value.trim() ? parseAndFormat(event.target.value) : '')} placeholder="100,000" aria-invalid={errors.creditLimit ? 'true' : undefined} aria-describedby={describedBy('creditLimit')} />
              <span className={HELPER}>เว้นว่างหรือใส่ 0 หากไม่ต้องการติดตามวงเงิน</span>
              {errors.creditLimit && <span id="card-creditLimit-error" className={ERROR_TEXT}>{errors.creditLimit}</span>}
            </div>

            <div className="flex flex-col gap-space-2 rounded-sm border border-border-subtle bg-surface-2 p-space-3">
              <span className={GROUP_TITLE}>ยอดใช้จ่ายหมุนเวียน</span>
              <div className="grid grid-cols-1 gap-space-3 md:grid-cols-2">
                <div className="flex flex-col gap-space-1">
                  <label className={LABEL} htmlFor="cc-annual-rate">ดอกเบี้ยต่อปี (%)</label>
                  <input id="cc-annual-rate" name="annualRate" type="text" inputMode="decimal" className={`${INPUT} max-w-[140px]`} value={form.annualRate} onChange={(event) => setField('annualRate', event.target.value)} placeholder="18" aria-invalid={errors.annualRate ? 'true' : undefined} aria-describedby={describedBy('annualRate')} />
                  {errors.annualRate && <span id="card-annualRate-error" className={ERROR_TEXT}>{errors.annualRate}</span>}
                </div>
                <div className="flex flex-col gap-space-1">
                  <label className={LABEL} htmlFor="cc-min-percent">ชำระขั้นต่ำ (%)</label>
                  <input id="cc-min-percent" name="minPaymentPercent" type="text" inputMode="decimal" className={`${INPUT} max-w-[140px]`} value={form.minPaymentPercent} onChange={(event) => setField('minPaymentPercent', event.target.value)} placeholder="10" aria-invalid={errors.minPaymentPercent ? 'true' : undefined} aria-describedby={describedBy('minPaymentPercent')} />
                  {errors.minPaymentPercent && <span id="card-minPaymentPercent-error" className={ERROR_TEXT}>{errors.minPaymentPercent}</span>}
                </div>
              </div>
              <span className={HELPER}>ใช้เฉพาะตอนเลือก “จ่ายขั้นต่ำ”</span>
              <span className={HELPER}>ปกติบัตรส่วนใหญ่กำหนดขั้นต่ำไว้ที่ 5–10%</span>
            </div>

            <div className="grid grid-cols-1 gap-space-3 md:grid-cols-2">
              <div className="flex flex-col gap-space-1">
                <label className={LABEL} htmlFor="cc-statement">วันสรุปยอด</label>
                <select id="cc-statement" name="statementDay" className={INPUT} value={String(form.statementDay)} onChange={(event) => setField('statementDay', event.target.value)}>
                  <option value={END_OF_MONTH_DUE_DAY}>สิ้นเดือน</option>
                  {DAY_OPTIONS.map(day => <option key={day} value={day}>{day}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-space-1">
                <label className={LABEL} htmlFor="cc-due">วันครบกำหนดชำระ</label>
                <select id="cc-due" name="dueDay" className={INPUT} value={String(form.dueDay)} onChange={(event) => setField('dueDay', event.target.value)}>
                  <option value={END_OF_MONTH_DUE_DAY}>สิ้นเดือน</option>
                  {DAY_OPTIONS.map(day => <option key={day} value={day}>{day}</option>)}
                </select>
              </div>
            </div>
          </fieldset>
        </div>

        <div className="flex shrink-0 flex-col-reverse items-stretch gap-space-3 border-t border-border-subtle px-space-5 py-space-4 md:flex-row md:items-center md:justify-end">
          <button type="button" className={`min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary ${FOCUS_RING}`} onClick={onClose}>ยกเลิก</button>
          <button type="submit" className={`min-h-11 rounded-sm bg-accent px-space-5 text-sm font-semibold text-on-accent disabled:opacity-60 ${FOCUS_RING}`} disabled={submitting}>{submitting ? 'กำลังบันทึก...' : 'บันทึกบัตร'}</button>
        </div>
      </form>
    </div>
  );
}