/**
 * คอมโพเนนต์: CreditCardForm (หน้าจอ 3a)
 * ฟอร์มเพิ่ม/แก้ไขบัตรเครดิต — modal บน desktop, full-screen sheet บนมือถือ
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
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { CARD_COLORS, validateCardInput } from '../../shared/utils/creditCardUtils';
import { END_OF_MONTH_DUE_DAY } from '../../shared/utils/dateUtils';
import { parseAndFormat } from '../../shared/utils/frontend/numberUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import { Icons } from './Icons';
import styles from '../styles/CreditCardForm.module.css';

const DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => String(index + 1));

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
        onClose?.();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
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
  }, [open, onClose]);

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
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose?.();
    }}>
      <form
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={card ? 'แก้ไขบัตรเครดิต' : 'เพิ่มบัตรเครดิต'}
        onSubmit={handleSubmit}
      >
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{card ? 'แก้ไขบัตรเครดิต' : 'เพิ่มบัตรเครดิต'}</h2>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="ปิด">
            <Icons.X size={18} />
          </button>
        </div>

        <div className={styles.modalBody}>
          <fieldset className={styles.group}>
            <legend className={styles.groupTitle}>ข้อมูลบัตร</legend>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="cc-name">
                ชื่อบัตร <span className={styles.required}>*</span>
              </label>
              <input
                id="cc-name"
                name="name"
                ref={firstFieldRef}
                type="text"
                className={styles.input}
                maxLength={40}
                value={form.name}
                onChange={(event) => setField('name', event.target.value)}
                placeholder="KTC Visa"
                aria-invalid={errors.name ? 'true' : undefined}
                aria-describedby={describedBy('name')}
              />
              {errors.name && <span id="card-name-error" className={styles.error}>{errors.name}</span>}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="cc-bank">ธนาคาร</label>
              <input
                id="cc-bank"
                name="bankName"
                type="text"
                className={styles.input}
                maxLength={40}
                value={form.bankName}
                onChange={(event) => setField('bankName', event.target.value)}
                placeholder="KTC"
              />
              <span className={styles.helper}>ถ้าตรงกับชื่อบัญชีธนาคารที่ใช้อยู่ ระบบจะรวมยอดผ่อนเข้าบัญชีนั้น</span>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="cc-last4">เลข 4 ตัวท้าย</label>
              <input
                id="cc-last4"
                name="last4"
                type="text"
                inputMode="numeric"
                className={`${styles.input} ${styles.inputShort}`}
                maxLength={4}
                value={form.last4}
                onChange={(event) => setField('last4', event.target.value.replace(/\D/g, ''))}
                placeholder="1234"
                aria-invalid={errors.last4 ? 'true' : undefined}
                aria-describedby={describedBy('last4')}
              />
              {errors.last4 && <span id="card-last4-error" className={styles.error}>{errors.last4}</span>}
            </div>

            <div className={styles.field}>
              <span className={styles.label} id="cc-color-label">สีประจำบัตร</span>
              <div className={styles.colorGrid} role="radiogroup" aria-labelledby="cc-color-label">
                {CARD_COLORS.map((color, index) => {
                  const selected = form.color === color;
                  return (
                    <button
                      key={color}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={`สีที่ ${index + 1}${usedColors.has(color) ? ' (ใช้กับบัตรอื่นแล้ว)' : ''}`}
                      className={`${styles.colorSwatch} ${selected ? styles.colorSwatchSelected : ''} ${usedColors.has(color) ? styles.colorSwatchUsed : ''}`}
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

          <div className={styles.divider} />

          <fieldset className={styles.group}>
            <legend className={styles.groupTitle}>วงเงินและกำหนดชำระ</legend>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="cc-limit">วงเงินบัตร (บาท)</label>
              <input
                id="cc-limit"
                name="creditLimit"
                type="text"
                inputMode="decimal"
                className={styles.input}
                value={form.creditLimit}
                onChange={(event) => setField('creditLimit', event.target.value)}
                onBlur={(event) => setField('creditLimit', event.target.value.trim() ? parseAndFormat(event.target.value) : '')}
                placeholder="100,000"
                aria-invalid={errors.creditLimit ? 'true' : undefined}
                aria-describedby={describedBy('creditLimit')}
              />
              <span className={styles.helper}>เว้นว่างหรือใส่ 0 หากไม่ต้องการติดตามวงเงิน</span>
              {errors.creditLimit && <span id="card-creditLimit-error" className={styles.error}>{errors.creditLimit}</span>}
            </div>

            <div className={styles.subGroup}>
              <span className={styles.subGroupTitle}>ยอดใช้จ่ายหมุนเวียน</span>
              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="cc-annual-rate">ดอกเบี้ยต่อปี (%)</label>
                  <input
                    id="cc-annual-rate"
                    name="annualRate"
                    type="text"
                    inputMode="decimal"
                    className={`${styles.input} ${styles.inputShort}`}
                    value={form.annualRate}
                    onChange={(event) => setField('annualRate', event.target.value)}
                    placeholder="18"
                    aria-invalid={errors.annualRate ? 'true' : undefined}
                    aria-describedby={describedBy('annualRate')}
                  />
                  {errors.annualRate && <span id="card-annualRate-error" className={styles.error}>{errors.annualRate}</span>}
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="cc-min-percent">ชำระขั้นต่ำ (%)</label>
                  <input
                    id="cc-min-percent"
                    name="minPaymentPercent"
                    type="text"
                    inputMode="decimal"
                    className={`${styles.input} ${styles.inputShort}`}
                    value={form.minPaymentPercent}
                    onChange={(event) => setField('minPaymentPercent', event.target.value)}
                    placeholder="10"
                    aria-invalid={errors.minPaymentPercent ? 'true' : undefined}
                    aria-describedby={describedBy('minPaymentPercent')}
                  />
                  {errors.minPaymentPercent && (
                    <span id="card-minPaymentPercent-error" className={styles.error}>{errors.minPaymentPercent}</span>
                  )}
                </div>
              </div>
              {/* ประโยคนี้กันความเข้าใจผิดว่าถูกคิดดอกเบี้ยทั้งที่จ่ายเต็มทุกเดือน */}
              <span className={styles.helper}>ใช้เฉพาะตอนเลือก “จ่ายขั้นต่ำ”</span>
              <span className={styles.helper}>ปกติบัตรส่วนใหญ่กำหนดขั้นต่ำไว้ที่ 5–10%</span>
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="cc-statement">วันสรุปยอด</label>
                <select
                  id="cc-statement"
                  name="statementDay"
                  className={styles.select}
                  value={String(form.statementDay)}
                  onChange={(event) => setField('statementDay', event.target.value)}
                >
                  <option value={END_OF_MONTH_DUE_DAY}>สิ้นเดือน</option>
                  {DAY_OPTIONS.map(day => <option key={day} value={day}>{day}</option>)}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="cc-due">วันครบกำหนดชำระ</label>
                <select
                  id="cc-due"
                  name="dueDay"
                  className={styles.select}
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

        <div className={styles.modalFooter}>
          <button type="button" className={styles.secondaryButton} onClick={onClose}>ยกเลิก</button>
          <button type="submit" className={styles.primaryButton} disabled={submitting}>
            {submitting ? 'กำลังบันทึก...' : 'บันทึกบัตร'}
          </button>
        </div>
      </form>
    </div>
  );
}
