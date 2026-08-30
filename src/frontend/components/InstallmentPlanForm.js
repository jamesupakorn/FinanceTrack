/**
 * คอมโพเนนต์: InstallmentPlanForm (หน้าจอ 3b)
 * ฟอร์มเพิ่ม/แก้ไขแผนผ่อนชำระ พร้อมตัวเลือกโหมดดอกเบี้ย A/B
 *
 * พร็อพ:
 * - open {boolean}
 * - plan {object|null} แผนที่กำลังแก้ไข (null = เพิ่มใหม่)
 * - cards {array} บัตรของผู้ใช้
 * - lockedCardId {string|null} ล็อกบัตรไว้เมื่อเปิดจากหน้ารายละเอียดบัตร
 * - submitting {boolean}
 * - onClose {function}
 * - onSubmit {function(values)}
 *
 * แผงสรุปผลคำนวณใหม่ตอน blur เท่านั้น ไม่ใช่ทุกครั้งที่พิมพ์
 * (โปรเจกต์นี้มีบั๊กที่ทราบแล้วเรื่อง focus หลุดบนมือถือเมื่อ normalize ระหว่างพิมพ์)
 * และคำนวณด้วย buildSchedule() ตัวเดียวกับที่ server ใช้ พรีวิวจึงไม่มีทางต่างจากที่บันทึกจริง
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildSchedule,
  validatePlanInput,
  getCurrentMonthKey,
  addMonths,
  MAX_INSTALLMENTS_PER_PLAN
} from '../../shared/utils/creditCardUtils';
import { formatMonthKeyTH } from '../../shared/utils/dateUtils';
import { formatCurrency, parseAndFormat } from '../../shared/utils/frontend/numberUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import { Icons } from './Icons';
import styles from '../styles/CreditCardForm.module.css';

const MONTH_PRESETS = [3, 6, 10, 12, 18, 24, 36, 48, 60];
const CUSTOM_MONTHS = 'custom';

function buildStartMonthOptions() {
  const current = getCurrentMonthKey();
  const options = [];
  for (let offset = -12; offset <= 12; offset += 1) {
    options.push(addMonths(current, offset));
  }
  return options;
}

function createInitialForm(plan, lockedCardId, cards) {
  if (plan) {
    return {
      cardId: plan.cardId || '',
      itemName: plan.itemName || '',
      totalPrice: parseAndFormat(plan.totalPrice || 0),
      monthsPreset: MONTH_PRESETS.includes(plan.months) ? String(plan.months) : CUSTOM_MONTHS,
      months: String(plan.months || ''),
      startMonth: plan.startMonth || getCurrentMonthKey(),
      interestMode: plan.interestMode || 'manual',
      manualFeePerMonth: plan.interestMode === 'manual' ? parseAndFormat(plan.manualFeePerMonth || 0) : '',
      annualRate: plan.interestMode === 'calculated' ? String(plan.annualRate ?? '') : '',
      calcMethod: plan.calcMethod || 'flat'
    };
  }
  return {
    cardId: lockedCardId || cards[0]?.id || '',
    itemName: '',
    totalPrice: '',
    monthsPreset: '10',
    months: '10',
    startMonth: getCurrentMonthKey(),
    interestMode: 'manual',
    manualFeePerMonth: '',
    annualRate: '',
    calcMethod: 'flat'
  };
}

export default function InstallmentPlanForm({
  open,
  plan = null,
  cards = [],
  lockedCardId = null,
  submitting = false,
  onClose,
  onSubmit
}) {
  const [form, setForm] = useState(() => createInitialForm(null, lockedCardId, cards));
  const [errors, setErrors] = useState({});
  const [previewToken, setPreviewToken] = useState(0);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const dialogRef = useRef(null);
  const firstFieldRef = useRef(null);
  const triggerRef = useRef(null);
  const formRef = useRef(form);
  formRef.current = form;

  const installmentsPaid = useMemo(
    () => (Array.isArray(plan?.schedule) ? plan.schedule.filter(row => row?.paid === true).length : 0),
    [plan]
  );
  const financialsLocked = Boolean(plan) && installmentsPaid > 0;

  useEffect(() => {
    if (!open) return;
    triggerRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    setErrors({});
    setScheduleOpen(false);
    setForm(createInitialForm(plan, lockedCardId, cards));
    setPreviewToken(token => token + 1);
    const timer = setTimeout(() => firstFieldRef.current?.focus(), 40);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plan, lockedCardId]);

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

  const startMonthOptions = useMemo(buildStartMonthOptions, []);

  // อ่านจาก ref เพื่อให้พรีวิวอัปเดตเฉพาะตอนที่ previewToken เปลี่ยน (blur / เปลี่ยน select)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const preview = useMemo(() => {
    const current = formRef.current;
    const result = validatePlanInput(current);
    if (!result.valid) return null;
    const computed = buildSchedule(result.value);
    return {
      ...computed,
      firstMonth: computed.schedule[0]?.dueMonth || '',
      lastMonth: computed.schedule[computed.schedule.length - 1]?.dueMonth || ''
    };
  }, [previewToken]);

  if (!open) return null;

  const setField = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  /** เปลี่ยนค่าแล้วคำนวณพรีวิวทันที — ใช้กับ select / radio ที่ไม่มีปัญหา focus */
  const setFieldAndPreview = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setPreviewToken(token => token + 1);
  };

  const handleMonthsPreset = (value) => {
    if (value === CUSTOM_MONTHS) {
      setFieldAndPreview('monthsPreset', CUSTOM_MONTHS);
      return;
    }
    setForm(prev => ({ ...prev, monthsPreset: value, months: value }));
    setPreviewToken(token => token + 1);
  };

  const refreshPreview = () => setPreviewToken(token => token + 1);

  const handleSubmit = (event) => {
    event.preventDefault();

    if (financialsLocked) {
      const itemName = form.itemName.trim();
      if (!itemName) {
        setErrors({ itemName: 'กรุณาระบุชื่อสินค้า' });
        showToast('กรุณาตรวจสอบข้อมูลแผนผ่อนอีกครั้ง', 'error');
        return;
      }
      onSubmit?.({ itemName });
      return;
    }

    const result = validatePlanInput(form);
    if (!result.valid) {
      setErrors(result.errors);
      showToast('กรุณาตรวจสอบข้อมูลแผนผ่อนอีกครั้ง', 'error');
      const firstInvalid = Object.keys(result.errors)[0];
      dialogRef.current?.querySelector(`[name="${firstInvalid}"]`)?.focus();
      return;
    }
    setErrors({});
    onSubmit?.(result.value);
  };

  const describedBy = (field) => (errors[field] ? `plan-${field}-error` : undefined);
  const selectedCard = cards.find(item => item.id === form.cardId);

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose?.();
    }}>
      <form
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={plan ? 'แก้ไขแผนผ่อนชำระ' : 'เพิ่มแผนผ่อนชำระ'}
        onSubmit={handleSubmit}
      >
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{plan ? 'แก้ไขแผนผ่อนชำระ' : 'เพิ่มแผนผ่อนชำระ'}</h2>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="ปิด">
            <Icons.X size={18} />
          </button>
        </div>

        <div className={styles.modalBody}>
          {financialsLocked && (
            <div className={styles.banner}>
              <Icons.AlertTriangle size={18} />
              <span>
                {`แผนนี้ชำระไปแล้ว ${installmentsPaid} งวด แก้ไขตัวเลขไม่ได้ — หากต้องการเปลี่ยน ให้ยกเลิกแผนนี้แล้วสร้างใหม่`}
              </span>
            </div>
          )}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="ip-card">
              บัตรที่ใช้ผ่อน <span className={styles.required}>*</span>
            </label>
            {lockedCardId || financialsLocked ? (
              <div className={styles.readonlyField}>{selectedCard ? `${selectedCard.name}${selectedCard.last4 ? ` ····${selectedCard.last4}` : ''}` : '-'}</div>
            ) : (
              <select
                id="ip-card"
                name="cardId"
                className={styles.select}
                value={form.cardId}
                onChange={(event) => setFieldAndPreview('cardId', event.target.value)}
                aria-invalid={errors.cardId ? 'true' : undefined}
                aria-describedby={describedBy('cardId')}
              >
                <option value="">— เลือกบัตร —</option>
                {cards.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}{item.last4 ? ` ····${item.last4}` : ''}
                  </option>
                ))}
              </select>
            )}
            {errors.cardId && <span id="plan-cardId-error" className={styles.error}>{errors.cardId}</span>}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="ip-item">
              ชื่อสินค้า / รายการ <span className={styles.required}>*</span>
            </label>
            <input
              id="ip-item"
              name="itemName"
              ref={firstFieldRef}
              type="text"
              className={styles.input}
              maxLength={60}
              value={form.itemName}
              onChange={(event) => setField('itemName', event.target.value)}
              placeholder="iPhone 17 Pro"
              aria-invalid={errors.itemName ? 'true' : undefined}
              aria-describedby={describedBy('itemName')}
            />
            {errors.itemName && <span id="plan-itemName-error" className={styles.error}>{errors.itemName}</span>}
          </div>

          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="ip-price">
                ราคาสินค้า (บาท) <span className={styles.required}>*</span>
              </label>
              {financialsLocked ? (
                <div className={styles.readonlyField}>
                  <Icons.Lock size={14} />
                  {formatCurrency(plan.totalPrice)}
                </div>
              ) : (
                <input
                  id="ip-price"
                  name="totalPrice"
                  type="text"
                  inputMode="decimal"
                  className={styles.input}
                  value={form.totalPrice}
                  onChange={(event) => setField('totalPrice', event.target.value)}
                  onBlur={(event) => {
                    if (event.target.value.trim()) setField('totalPrice', parseAndFormat(event.target.value));
                    refreshPreview();
                  }}
                  placeholder="45,000"
                  aria-invalid={errors.totalPrice ? 'true' : undefined}
                  aria-describedby={describedBy('totalPrice')}
                />
              )}
              {errors.totalPrice && <span id="plan-totalPrice-error" className={styles.error}>{errors.totalPrice}</span>}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="ip-months">
                จำนวนงวด <span className={styles.required}>*</span>
              </label>
              {financialsLocked ? (
                <div className={styles.readonlyField}>
                  <Icons.Lock size={14} />
                  {`${plan.months} งวด`}
                </div>
              ) : (
                <>
                  <select
                    id="ip-months"
                    className={styles.select}
                    value={form.monthsPreset}
                    onChange={(event) => handleMonthsPreset(event.target.value)}
                  >
                    {MONTH_PRESETS.map(value => (
                      <option key={value} value={String(value)}>{`${value} งวด`}</option>
                    ))}
                    <option value={CUSTOM_MONTHS}>กำหนดเอง</option>
                  </select>
                  {form.monthsPreset === CUSTOM_MONTHS && (
                    <input
                      name="months"
                      type="text"
                      inputMode="numeric"
                      className={styles.input}
                      value={form.months}
                      onChange={(event) => setField('months', event.target.value.replace(/\D/g, ''))}
                      onBlur={refreshPreview}
                      placeholder={`1–${MAX_INSTALLMENTS_PER_PLAN}`}
                      aria-invalid={errors.months ? 'true' : undefined}
                      aria-describedby={describedBy('months')}
                    />
                  )}
                </>
              )}
              {errors.months && <span id="plan-months-error" className={styles.error}>{errors.months}</span>}
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="ip-start">
              เริ่มผ่อนเดือน <span className={styles.required}>*</span>
            </label>
            {financialsLocked ? (
              <div className={styles.readonlyField}>
                <Icons.Lock size={14} />
                {formatMonthKeyTH(plan.startMonth)}
              </div>
            ) : (
              <select
                id="ip-start"
                name="startMonth"
                className={styles.select}
                value={form.startMonth}
                onChange={(event) => setFieldAndPreview('startMonth', event.target.value)}
              >
                {startMonthOptions.map(monthKey => (
                  <option key={monthKey} value={monthKey}>{formatMonthKeyTH(monthKey)}</option>
                ))}
              </select>
            )}
            {errors.startMonth && <span id="plan-startMonth-error" className={styles.error}>{errors.startMonth}</span>}
          </div>

          {!financialsLocked && (
            <>
              <div className={styles.divider} />

              <fieldset className={styles.group}>
                <legend className={styles.groupTitle}>ดอกเบี้ย / ค่าธรรมเนียม *</legend>
                <div className={styles.radioRow} role="radiogroup" aria-label="รูปแบบดอกเบี้ย">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={form.interestMode === 'manual'}
                    className={`${styles.radioOption} ${form.interestMode === 'manual' ? styles.radioOptionActive : ''}`}
                    onClick={() => setFieldAndPreview('interestMode', 'manual')}
                  >
                    กรอกยอดเอง
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={form.interestMode === 'calculated'}
                    className={`${styles.radioOption} ${form.interestMode === 'calculated' ? styles.radioOptionActive : ''}`}
                    onClick={() => setFieldAndPreview('interestMode', 'calculated')}
                  >
                    คำนวณจาก %/ปี
                  </button>
                </div>

                {form.interestMode === 'manual' ? (
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="ip-fee">
                      ค่าธรรมเนียม/ดอกเบี้ย ต่องวด (บาท) <span className={styles.required}>*</span>
                    </label>
                    <input
                      id="ip-fee"
                      name="manualFeePerMonth"
                      type="text"
                      inputMode="decimal"
                      className={styles.input}
                      value={form.manualFeePerMonth}
                      onChange={(event) => setField('manualFeePerMonth', event.target.value)}
                      onBlur={(event) => {
                        if (event.target.value.trim()) setField('manualFeePerMonth', parseAndFormat(event.target.value));
                        refreshPreview();
                      }}
                      placeholder="150"
                      aria-invalid={errors.manualFeePerMonth ? 'true' : undefined}
                      aria-describedby={describedBy('manualFeePerMonth')}
                    />
                    <span className={styles.helper}>ใส่ยอดตามที่ระบุในใบแจ้งหนี้ ทุกงวดเท่ากัน ระบบจะไม่คำนวณเพิ่ม</span>
                    {errors.manualFeePerMonth && <span id="plan-manualFeePerMonth-error" className={styles.error}>{errors.manualFeePerMonth}</span>}
                  </div>
                ) : (
                  <>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="ip-rate">
                        อัตราดอกเบี้ยผ่อนชำระต่อปี (%) <span className={styles.required}>*</span>
                      </label>
                      <input
                        id="ip-rate"
                        name="annualRate"
                        type="text"
                        inputMode="decimal"
                        className={styles.input}
                        value={form.annualRate}
                        onChange={(event) => setField('annualRate', event.target.value)}
                        onBlur={refreshPreview}
                        placeholder="0.8"
                        aria-invalid={errors.annualRate ? 'true' : undefined}
                        aria-describedby={describedBy('annualRate')}
                      />
                      <span className={styles.helper}>
                        อัตรานี้มักอยู่ที่ 0.5–1.5% ต่อปี ไม่ใช่ตัวเลขเดียวกับอัตราดอกเบี้ยบัตรเครดิต (ซึ่งมักอยู่ที่ 16–25%)
                      </span>
                      {errors.annualRate && <span id="plan-annualRate-error" className={styles.error}>{errors.annualRate}</span>}
                    </div>

                    <div className={styles.field}>
                      <span className={styles.label} id="ip-calc-label">วิธีคำนวณ <span className={styles.required}>*</span></span>
                      <div className={styles.radioRow} role="radiogroup" aria-labelledby="ip-calc-label">
                        <button
                          type="button"
                          role="radio"
                          aria-checked={form.calcMethod === 'flat'}
                          className={`${styles.radioOption} ${form.calcMethod === 'flat' ? styles.radioOptionActive : ''}`}
                          onClick={() => setFieldAndPreview('calcMethod', 'flat')}
                        >
                          แบบคงที่
                          <span className={styles.radioSub}>(Flat)</span>
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={form.calcMethod === 'effective'}
                          className={`${styles.radioOption} ${form.calcMethod === 'effective' ? styles.radioOptionActive : ''}`}
                          onClick={() => setFieldAndPreview('calcMethod', 'effective')}
                        >
                          ลดต้นลดดอก
                          <span className={styles.radioSub}>(Effective)</span>
                        </button>
                      </div>
                      <span className={styles.helper}>
                        แบบคงที่: ดอกเบี้ยเท่ากันทุกงวด · ลดต้นลดดอก: งวดแรกดอกเบี้ยสูงกว่างวดหลัง แต่ยอดชำระรวมเท่ากันทุกงวด
                        ไม่แน่ใจว่าบัตร/ร้านค้าคิดแบบไหน — ลองสลับดูได้ ตัวเลข &quot;ดอกเบี้ยรวม&quot; ด้านล่างจะปรับให้ทันที
                      </span>
                      {errors.calcMethod && <span id="plan-calcMethod-error" className={styles.error}>{errors.calcMethod}</span>}
                    </div>
                  </>
                )}
              </fieldset>

              <div className={styles.divider} />

              {preview && (
                <div className={styles.resultPanel} aria-live="polite">
                  <h3 className={styles.resultTitle}>สรุปแผนผ่อน</h3>
                  <div className={styles.resultRow}>
                    <span className={styles.resultLabel}>ยอดชำระต่องวด</span>
                    <span className={`${styles.resultValue} ${styles.resultValueStrong}`}>{formatCurrency(preview.monthlyPayment)} บาท</span>
                  </div>
                  <div className={styles.resultRow}>
                    <span className={styles.resultLabel}>ดอกเบี้ยรวม</span>
                    <span className={styles.resultValue}>{formatCurrency(preview.totalInterest)} บาท</span>
                  </div>
                  <div className={styles.resultRow}>
                    <span className={styles.resultLabel}>ยอดชำระทั้งหมด</span>
                    <span className={styles.resultValue}>{formatCurrency(preview.totalPayable)} บาท</span>
                  </div>
                  <div className={styles.resultRow}>
                    <span className={styles.resultLabel}>งวดแรก</span>
                    <span className={styles.resultValue}>{formatMonthKeyTH(preview.firstMonth)}</span>
                  </div>
                  <div className={styles.resultRow}>
                    <span className={styles.resultLabel}>งวดสุดท้าย</span>
                    <span className={styles.resultValue}>{formatMonthKeyTH(preview.lastMonth)}</span>
                  </div>
                  <button
                    type="button"
                    className={styles.previewToggle}
                    onClick={() => setScheduleOpen(value => !value)}
                    aria-expanded={scheduleOpen}
                  >
                    {scheduleOpen ? 'ซ่อนตารางผ่อน' : 'ดูตารางผ่อนทั้งหมด'}
                  </button>
                  {scheduleOpen && (
                    <div className={styles.previewTableWrap}>
                      <table className={styles.previewTable}>
                        <thead>
                          <tr>
                            <th>งวด</th>
                            <th>เดือน</th>
                            <th>ยอดชำระ</th>
                            <th>เงินต้น</th>
                            <th>ดอกเบี้ย</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.schedule.map(row => (
                            <tr key={row.no}>
                              <td>{row.no}</td>
                              <td>{formatMonthKeyTH(row.dueMonth)}</td>
                              <td>{formatCurrency(row.payment)}</td>
                              <td>{formatCurrency(row.principal)}</td>
                              <td>{formatCurrency(row.interest)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className={styles.modalFooter}>
          <button type="button" className={styles.secondaryButton} onClick={onClose}>ยกเลิก</button>
          <button type="submit" className={styles.primaryButton} disabled={submitting}>
            {submitting ? 'กำลังบันทึก...' : 'บันทึกแผนผ่อน'}
          </button>
        </div>
      </form>
    </div>
  );
}
