/**
 * คอมโพเนนต์: CreditCardForm (หน้าจอ 3a)
 * ฟอร์มเพิ่ม/แก้ไขบัตรเครดิต — modal บน desktop, full-screen sheet บนมือถือ (C9)
 *
 * พร็อพ:
 * - open {boolean}
 * - card {object|null} บัตรที่กำลังแก้ไข (null = เพิ่มใหม่)
 * - existingCards {array} ใช้ทำเครื่องหมายสีที่ถูกใช้ไปแล้ว
 * - submitting {boolean}
 * - onClose {function}
 * - onSubmit {function(cardPayload)}
 *
 * หมายเหตุ: ช่องตัวเลขเป็น type="text" + inputMode เสมอ (ADR-006)
 * และไม่ normalize ค่าระหว่างพิมพ์ — จัดรูปแบบตอน blur เท่านั้น เพื่อไม่ให้ focus หลุดบนมือถือ
 *
 * Graphite redesign — Tailwind แทน CreditCardForm.module.css แล้ว (ไฟล์ .module.css เดิมยังอยู่บน
 * disk เพราะ ExpenseCalendarModal.js/SalaryModal.js/UnsavedChangesDialog.js ยัง depend อยู่)
 * ไฟล์นี้เป็น reference implementation ของ focus trap (getTabbableElements) ที่
 * InstallmentPlanForm.js และ ConfirmDialog ใน pages/credit-cards.js เอาไปใช้ตามในรอบนี้ด้วย
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { CARD_COLORS, validateCardInput } from '../../shared/utils/creditCardUtils';
import { END_OF_MONTH_DUE_DAY } from '../../shared/utils/dateUtils';
import { parseAndFormat } from '../../shared/utils/frontend/numberUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';
import { Icons } from './Icons';

const DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => String(index + 1));

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const INPUT = `min-h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-base text-primary outline-none transition-colors duration-fast ease-graphite focus:border-accent aria-[invalid=true]:border-neg ${FOCUS_RING}`;
const LABEL = 'text-sm font-medium text-secondary';
const HELPER = 'text-xs leading-relaxed text-tertiary';
const ERROR_TEXT = 'text-xs text-neg';
const GROUP_TITLE = 'text-xs font-semibold uppercase tracking-[0.02em] text-tertiary';

const emptyForm = {
  name: '',
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
}) {
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const dialogRef = useRef(null);
  const firstFieldRef = useRef(null);
  const triggerRef = useRef(null);
  // เก็บ onClose ล่าสุดไว้ใน ref แทนการใส่เป็น dependency ของ effect ด้านล่างตรงๆ — ถ้า parent
  // re-render ระหว่างเปิดโมดัล onClose prop (arrow function ใหม่ทุก render) จะทำให้ effect cleanup
  // แล้ว re-run กลางอากาศ ซึ่ง cleanup มี triggerRef.current?.focus?.() อยู่ด้วย — โฟกัสจะหลุดออกจาก
  // โมดัลไปที่หน้าเบื้องหลังทันทีแม้โมดัลยังเปิดอยู่ (พบจากการ live-verify รอบ Graphite นี้ — ไม่เคย
  // ถูกทดสอบในเบราว์เซอร์จริงมาก่อน ดู task-context/architecture-review Finding 3)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    triggerRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    setErrors({});
    setForm(card
      ? {
        name: card.name || '',
        bankName: card.bankName || '',
        last4: card.last4 || '',
        color: CARD_COLORS.includes(card.color) ? card.color : CARD_COLORS[0],
        creditLimit: card.creditLimit === undefined || card.creditLimit === null ? '' : parseAndFormat(card.creditLimit),
        // ค่าเริ่มต้นเดียวกับที่ API ใส่ให้ตอนอ่าน — บัตรเก่าที่ไม่มีสองฟิลด์นี้จึงแสดงถูกต้อง
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

  // Escape ปิด · Tab วนอยู่ในโมดัล · คืน focus ให้ปุ่มที่เปิดเมื่อปิด
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
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
      triggerRef.current?.focus?.();
    };
  }, [open]);

  const usedColors = useMemo(() => new Set(
    existingCards.filter(item => item?.id !== card?.id).map(item => item?.color)
  ), [existingCards, card?.id]);

  if (!open) return null;

  const setField = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const result = validateCardInput(form);
    if (!result.valid) {
      setErrors(result.errors);
      showToast('กรุณาตรวจสอบข้อมูลบัตรอีกครั้ง', 'error');
      const firstInvalid = Object.keys(result.errors)[0];
      dialogRef.current?.querySelector(`[name="${firstInvalid}"]`)?.focus();
      return;
    }
    setErrors({});
    onSubmit?.({ ...result.value, ...(card?.id ? { id: card.id } : {}) });
  };

  const describedBy = (field) => (errors[field] ? `card-${field}-error` : undefined);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto bg-[rgba(10,10,11,0.72)] p-0 backdrop-blur-sm md:items-center md:p-space-5"
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
        <div className="flex items-center justify-between gap-space-3 border-b border-border-subtle px-space-5 py-space-4">
          <h2 className="m-0 text-lg font-semibold text-primary">{card ? 'แก้ไขบัตรเครดิต' : 'เพิ่มบัตรเครดิต'}</h2>
          <button
            type="button"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-secondary hover:bg-surface-2 ${FOCUS_RING}`}
            onClick={onClose}
            aria-label="ปิด"
          >
            <Icons.X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-space-4 overflow-y-auto px-space-5 py-space-4">
          <fieldset className="flex flex-col gap-space-3 border-0 p-0 m-0">
            <legend className={GROUP_TITLE}>ข้อมูลบัตร</legend>

            <div className="flex flex-col gap-space-1">
              <label className={LABEL} htmlFor="cc-name">
                ชื่อบัตร <span className="text-neg">*</span>
              </label>
              <input
                id="cc-name"
                name="name"
                ref={firstFieldRef}
                type="text"
                className={INPUT}
                maxLength={40}
                value={form.name}
                onChange={(event) => setField('name', event.target.value)}
                placeholder="KTC Visa"
                aria-invalid={errors.name ? 'true' : undefined}
                aria-describedby={describedBy('name')}
              />
              {errors.name && <span id="card-name-error" className={ERROR_TEXT}>{errors.name}</span>}
            </div>

            <div className="flex flex-col gap-space-1">
              <label className={LABEL} htmlFor="cc-bank">ธนาคาร</label>
              <input
                id="cc-bank"
                name="bankName"
                type="text"
                className={INPUT}
                maxLength={40}
                value={form.bankName}
                onChange={(event) => setField('bankName', event.target.value)}
                placeholder="KTC"
              />
              <span className={HELPER}>ถ้าตรงกับชื่อบัญชีธนาคารที่ใช้อยู่ ระบบจะรวมยอดผ่อนเข้าบัญชีนั้น</span>
            </div>

            <div className="flex flex-col gap-space-1">
              <label className={LABEL} htmlFor="cc-last4">เลข 4 ตัวท้าย</label>
              <input
                id="cc-last4"
                name="last4"
                type="text"
                inputMode="numeric"
                className={`${INPUT} max-w-[140px]`}
                maxLength={4}
                value={form.last4}
                onChange={(event) => setField('last4', event.target.value.replace(/\D/g, ''))}
                placeholder="1234"
                aria-invalid={errors.last4 ? 'true' : undefined}
                aria-describedby={describedBy('last4')}
              />
              {errors.last4 && <span id="card-last4-error" className={ERROR_TEXT}>{errors.last4}</span>}
            </div>

            <div className="flex flex-col gap-space-1">
              <span className={LABEL} id="cc-color-label">สีประจำบัตร</span>
              <div className="grid grid-cols-8 gap-space-2" role="radiogroup" aria-labelledby="cc-color-label">
                {CARD_COLORS.map((color, index) => {
                  const selected = form.color === color;
                  return (
                    <button
                      key={color}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={`สีที่ ${index + 1}${usedColors.has(color) ? ' (ใช้กับบัตรอื่นแล้ว)' : ''}`}
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

          <fieldset className="flex flex-col gap-space-3 border-0 p-0 m-0">
            <legend className={GROUP_TITLE}>วงเงินและกำหนดชำระ</legend>

            <div className="flex flex-col gap-space-1">
              <label className={LABEL} htmlFor="cc-limit">วงเงินบัตร (บาท)</label>
              <input
                id="cc-limit"
                name="creditLimit"
                type="text"
                inputMode="decimal"
                className={INPUT}
                value={form.creditLimit}
                onChange={(event) => setField('creditLimit', event.target.value)}
                onBlur={(event) => setField('creditLimit', event.target.value.trim() ? parseAndFormat(event.target.value) : '')}
                placeholder="100,000"
                aria-invalid={errors.creditLimit ? 'true' : undefined}
                aria-describedby={describedBy('creditLimit')}
              />
              <span className={HELPER}>เว้นว่างหรือใส่ 0 หากไม่ต้องการติดตามวงเงิน</span>
              {errors.creditLimit && <span id="card-creditLimit-error" className={ERROR_TEXT}>{errors.creditLimit}</span>}
            </div>

            <div className="flex flex-col gap-space-2 rounded-sm border border-border-subtle bg-surface-2 p-space-3">
              <span className={GROUP_TITLE}>ยอดใช้จ่ายหมุนเวียน</span>
              <div className="grid grid-cols-1 gap-space-3 md:grid-cols-2">
                <div className="flex flex-col gap-space-1">
                  <label className={LABEL} htmlFor="cc-annual-rate">ดอกเบี้ยต่อปี (%)</label>
                  <input
                    id="cc-annual-rate"
                    name="annualRate"
                    type="text"
                    inputMode="decimal"
                    className={`${INPUT} max-w-[140px]`}
                    value={form.annualRate}
                    onChange={(event) => setField('annualRate', event.target.value)}
                    placeholder="18"
                    aria-invalid={errors.annualRate ? 'true' : undefined}
                    aria-describedby={describedBy('annualRate')}
                  />
                  {errors.annualRate && <span id="card-annualRate-error" className={ERROR_TEXT}>{errors.annualRate}</span>}
                </div>
                <div className="flex flex-col gap-space-1">
                  <label className={LABEL} htmlFor="cc-min-percent">ชำระขั้นต่ำ (%)</label>
                  <input
                    id="cc-min-percent"
                    name="minPaymentPercent"
                    type="text"
                    inputMode="decimal"
                    className={`${INPUT} max-w-[140px]`}
                    value={form.minPaymentPercent}
                    onChange={(event) => setField('minPaymentPercent', event.target.value)}
                    placeholder="10"
                    aria-invalid={errors.minPaymentPercent ? 'true' : undefined}
                    aria-describedby={describedBy('minPaymentPercent')}
                  />
                  {errors.minPaymentPercent && (
                    <span id="card-minPaymentPercent-error" className={ERROR_TEXT}>{errors.minPaymentPercent}</span>
                  )}
                </div>
              </div>
              {/* ประโยคนี้กันความเข้าใจผิดว่าถูกคิดดอกเบี้ยทั้งที่จ่ายเต็มทุกเดือน */}
              <span className={HELPER}>ใช้เฉพาะตอนเลือก “จ่ายขั้นต่ำ”</span>
              <span className={HELPER}>ปกติบัตรส่วนใหญ่กำหนดขั้นต่ำไว้ที่ 5–10%</span>
            </div>

            <div className="grid grid-cols-1 gap-space-3 md:grid-cols-2">
              <div className="flex flex-col gap-space-1">
                <label className={LABEL} htmlFor="cc-statement">วันสรุปยอด</label>
                <select
                  id="cc-statement"
                  name="statementDay"
                  className={INPUT}
                  value={String(form.statementDay)}
                  onChange={(event) => setField('statementDay', event.target.value)}
                >
                  <option value={END_OF_MONTH_DUE_DAY}>สิ้นเดือน</option>
                  {DAY_OPTIONS.map(day => <option key={day} value={day}>{day}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-space-1">
                <label className={LABEL} htmlFor="cc-due">วันครบกำหนดชำระ</label>
                <select
                  id="cc-due"
                  name="dueDay"
                  className={INPUT}
                  value={String(form.dueDay)}
                  onChange={(event) => setField('dueDay', event.target.value)}
                >
                  <option value={END_OF_MONTH_DUE_DAY}>สิ้นเดือน</option>
                  {DAY_OPTIONS.map(day => <option key={day} value={day}>{day}</option>)}
                </select>
              </div>
            </div>
          </fieldset>
        </div>

        <div className="flex flex-col-reverse items-stretch gap-space-3 border-t border-border-subtle px-space-5 py-space-4 md:flex-row md:items-center md:justify-end">
          <button
            type="button"
            className={`min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary ${FOCUS_RING}`}
            onClick={onClose}
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            className={`min-h-11 rounded-sm bg-accent px-space-5 text-sm font-semibold text-on-accent disabled:opacity-60 ${FOCUS_RING}`}
            disabled={submitting}
          >
            {submitting ? 'กำลังบันทึก...' : 'บันทึกบัตร'}
          </button>
        </div>
      </form>
    </div>
  );
}
