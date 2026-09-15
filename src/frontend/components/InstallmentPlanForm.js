/**
 * คอมโพเนนต์: InstallmentPlanForm (หน้าจอ 3b)
 * ฟอร์มเพิ่ม/แก้ไขแผนผ่อนชำระ พร้อมตัวเลือกโหมดดอกเบี้ย A/B (C9 modal)
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
 *
 * Graphite redesign — Tailwind แทน CreditCardForm.module.css แล้ว focus trap เปลี่ยนมาใช้
 * getTabbableElements จาก focusTrap.js แทน querySelectorAll ของตัวเอง (TD-M06 conformance —
 * ดู CreditCardForm.js ซึ่งเป็น reference implementation ของแพทเทิร์นนี้อยู่แล้ว)
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
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';
import { Icons } from './Icons';

const MONTH_PRESETS = [3, 6, 10, 12, 18, 24, 36, 48, 60];
const CUSTOM_MONTHS = 'custom';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const INPUT = `min-h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-base text-primary outline-none transition-colors duration-fast ease-graphite focus:border-accent aria-[invalid=true]:border-neg ${FOCUS_RING}`;
const LABEL = 'text-sm font-medium text-secondary';
const HELPER = 'text-xs leading-relaxed text-tertiary';
const ERROR_TEXT = 'text-xs text-neg';
const GROUP_TITLE = 'text-xs font-semibold uppercase tracking-[0.02em] text-tertiary';
const READONLY_FIELD = 'flex min-h-11 items-center gap-space-2 rounded-sm border border-dashed border-border-default bg-surface-1 px-space-3 text-secondary';
const RADIO_OPTION = `flex min-h-11 flex-col items-center justify-center gap-[2px] rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-center text-sm font-medium text-secondary transition-colors duration-fast ease-graphite ${FOCUS_RING}`;
const RADIO_OPTION_ACTIVE = 'border-accent bg-accent-muted text-primary';

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
  // เก็บ onClose ล่าสุดไว้ใน ref แทนการใส่เป็น dependency ของ effect ด้านล่างตรงๆ — ถ้า parent
  // re-render ระหว่างเปิดโมดัล onClose prop (arrow function ใหม่ทุก render) จะทำให้ effect cleanup
  // แล้ว re-run กลางอากาศ ซึ่ง cleanup มี triggerRef.current?.focus?.() อยู่ด้วย — โฟกัสจะหลุดออกจาก
  // โมดัลไปที่หน้าเบื้องหลังทันทีแม้โมดัลยังเปิดอยู่ (พบจากการ live-verify รอบ Graphite นี้ — ไม่เคย
  // ถูกทดสอบในเบราว์เซอร์จริงมาก่อน ดู task-context/architecture-review Finding 3)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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

  // Escape ปิด · Tab วนอยู่ในโมดัลผ่าน getTabbableElements ตัวเดียวกับ CreditCardForm.js · คืน focus
  // ให้ปุ่มที่เปิดเมื่อปิด (TD-M06 — เดิมมี inline querySelectorAll ของตัวเองก่อน Graphite pass นี้)
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
        aria-label={plan ? 'แก้ไขแผนผ่อนชำระ' : 'เพิ่มแผนผ่อนชำระ'}
        onSubmit={handleSubmit}
      >
        <div className="flex shrink-0 items-center justify-between gap-space-3 border-b border-border-subtle px-space-5 py-space-4">
          <h2 className="m-0 text-lg font-semibold text-primary">{plan ? 'แก้ไขแผนผ่อนชำระ' : 'เพิ่มแผนผ่อนชำระ'}</h2>
          <button
            type="button"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-secondary hover:bg-surface-2 ${FOCUS_RING}`}
            onClick={onClose}
            aria-label="ปิด"
          >
            <Icons.X size={18} />
          </button>
        </div>

        {/* flex-1 ทำให้ div นี้เป็น flex child ที่ยืด/หดได้, min-h-0 อนุญาตให้หดต่ำกว่าความสูงเนื้อหา —
            รูปแบบเดียวกับ CreditCardForm.js (fix เดียวกันทุกประการ) ป้องกัน panel ทั้งก้อนถูกดันสูงเกิน
            max-h จน backdrop กลายเป็นตัวเลื่อนแทน body เอง ดันปุ่ม footer หลุดจอ (R-5) — ตาราง
            schedule-preview ที่ซ้อนอยู่ข้างใน (มี max-h-[260px] overflow-auto ของตัวเอง ด้านล่าง)
            เลื่อนอิสระจาก body นี้อยู่แล้ว ไม่ขึ้นกับ min-h-0 ตัวนี้ (R-6/E-11) */}
        <div className="flex flex-1 min-h-0 flex-col gap-space-4 overflow-y-auto px-space-5 py-space-4">
          {financialsLocked && (
            <div className="flex items-start gap-space-2 rounded-sm border border-warn/35 bg-warn/10 px-space-3 py-space-3 text-sm leading-relaxed text-warn">
              <Icons.AlertTriangle size={18} />
              <span>
                {`แผนนี้ชำระไปแล้ว ${installmentsPaid} งวด แก้ไขตัวเลขไม่ได้ — หากต้องการเปลี่ยน ให้ยกเลิกแผนนี้แล้วสร้างใหม่`}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-space-1">
            <label className={LABEL} htmlFor="ip-card">
              บัตรที่ใช้ผ่อน <span className="text-neg">*</span>
            </label>
            {lockedCardId || financialsLocked ? (
              <div className={READONLY_FIELD}>{selectedCard ? `${selectedCard.name}${selectedCard.last4 ? ` ····${selectedCard.last4}` : ''}` : '-'}</div>
            ) : (
              <select
                id="ip-card"
                name="cardId"
                className={INPUT}
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
            {errors.cardId && <span id="plan-cardId-error" className={ERROR_TEXT}>{errors.cardId}</span>}
          </div>

          <div className="flex flex-col gap-space-1">
            <label className={LABEL} htmlFor="ip-item">
              ชื่อสินค้า / รายการ <span className="text-neg">*</span>
            </label>
            <input
              id="ip-item"
              name="itemName"
              ref={firstFieldRef}
              type="text"
              className={INPUT}
              maxLength={60}
              value={form.itemName}
              onChange={(event) => setField('itemName', event.target.value)}
              placeholder="iPhone 17 Pro"
              aria-invalid={errors.itemName ? 'true' : undefined}
              aria-describedby={describedBy('itemName')}
            />
            {errors.itemName && <span id="plan-itemName-error" className={ERROR_TEXT}>{errors.itemName}</span>}
          </div>

          <div className="grid grid-cols-1 gap-space-3 md:grid-cols-2">
            <div className="flex flex-col gap-space-1">
              <label className={LABEL} htmlFor="ip-price">
                ราคาสินค้า (บาท) <span className="text-neg">*</span>
              </label>
              {financialsLocked ? (
                <div className={READONLY_FIELD}>
                  <Icons.Lock size={14} className="shrink-0 opacity-70" />
                  {formatCurrency(plan.totalPrice)}
                </div>
              ) : (
                <input
                  id="ip-price"
                  name="totalPrice"
                  type="text"
                  inputMode="decimal"
                  className={INPUT}
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
              {errors.totalPrice && <span id="plan-totalPrice-error" className={ERROR_TEXT}>{errors.totalPrice}</span>}
            </div>

            <div className="flex flex-col gap-space-1">
              <label className={LABEL} htmlFor="ip-months">
                จำนวนงวด <span className="text-neg">*</span>
              </label>
              {financialsLocked ? (
                <div className={READONLY_FIELD}>
                  <Icons.Lock size={14} className="shrink-0 opacity-70" />
                  {`${plan.months} งวด`}
                </div>
              ) : (
                <>
                  <select
                    id="ip-months"
                    className={INPUT}
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
                      className={`${INPUT} mt-space-2`}
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
              {errors.months && <span id="plan-months-error" className={ERROR_TEXT}>{errors.months}</span>}
            </div>
          </div>

          <div className="flex flex-col gap-space-1">
            <label className={LABEL} htmlFor="ip-start">
              เริ่มผ่อนเดือน <span className="text-neg">*</span>
            </label>
            {financialsLocked ? (
              <div className={READONLY_FIELD}>
                <Icons.Lock size={14} className="shrink-0 opacity-70" />
                {formatMonthKeyTH(plan.startMonth)}
              </div>
            ) : (
              <select
                id="ip-start"
                name="startMonth"
                className={INPUT}
                value={form.startMonth}
                onChange={(event) => setFieldAndPreview('startMonth', event.target.value)}
              >
                {startMonthOptions.map(monthKey => (
                  <option key={monthKey} value={monthKey}>{formatMonthKeyTH(monthKey)}</option>
                ))}
              </select>
            )}
            {errors.startMonth && <span id="plan-startMonth-error" className={ERROR_TEXT}>{errors.startMonth}</span>}
          </div>

          {!financialsLocked && (
            <>
              <div className="h-px bg-border-subtle" />

              <fieldset className="flex flex-col gap-space-3 border-0 p-0 m-0">
                <legend className={GROUP_TITLE}>ดอกเบี้ย / ค่าธรรมเนียม *</legend>
                <div className="grid grid-cols-1 gap-space-2 md:grid-cols-2" role="radiogroup" aria-label="รูปแบบดอกเบี้ย">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={form.interestMode === 'manual'}
                    className={`${RADIO_OPTION} ${form.interestMode === 'manual' ? RADIO_OPTION_ACTIVE : ''}`}
                    onClick={() => setFieldAndPreview('interestMode', 'manual')}
                  >
                    กรอกยอดเอง
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={form.interestMode === 'calculated'}
                    className={`${RADIO_OPTION} ${form.interestMode === 'calculated' ? RADIO_OPTION_ACTIVE : ''}`}
                    onClick={() => setFieldAndPreview('interestMode', 'calculated')}
                  >
                    คำนวณจาก %/ปี
                  </button>
                </div>

                {form.interestMode === 'manual' ? (
                  <div className="flex flex-col gap-space-1">
                    <label className={LABEL} htmlFor="ip-fee">
                      ค่าธรรมเนียม/ดอกเบี้ย ต่องวด (บาท) <span className="text-neg">*</span>
                    </label>
                    <input
                      id="ip-fee"
                      name="manualFeePerMonth"
                      type="text"
                      inputMode="decimal"
                      className={INPUT}
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
                    <span className={HELPER}>ใส่ยอดตามที่ระบุในใบแจ้งหนี้ ทุกงวดเท่ากัน ระบบจะไม่คำนวณเพิ่ม</span>
                    {errors.manualFeePerMonth && <span id="plan-manualFeePerMonth-error" className={ERROR_TEXT}>{errors.manualFeePerMonth}</span>}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-space-1">
                      <label className={LABEL} htmlFor="ip-rate">
                        อัตราดอกเบี้ยผ่อนชำระต่อปี (%) <span className="text-neg">*</span>
                      </label>
                      <input
                        id="ip-rate"
                        name="annualRate"
                        type="text"
                        inputMode="decimal"
                        className={INPUT}
                        value={form.annualRate}
                        onChange={(event) => setField('annualRate', event.target.value)}
                        onBlur={refreshPreview}
                        placeholder="0.8"
                        aria-invalid={errors.annualRate ? 'true' : undefined}
                        aria-describedby={describedBy('annualRate')}
                      />
                      <span className={HELPER}>
                        อัตรานี้มักอยู่ที่ 0.5–1.5% ต่อปี ไม่ใช่ตัวเลขเดียวกับอัตราดอกเบี้ยบัตรเครดิต (ซึ่งมักอยู่ที่ 16–25%)
                      </span>
                      {errors.annualRate && <span id="plan-annualRate-error" className={ERROR_TEXT}>{errors.annualRate}</span>}
                    </div>

                    <div className="flex flex-col gap-space-1">
                      <span className={LABEL} id="ip-calc-label">วิธีคำนวณ <span className="text-neg">*</span></span>
                      <div className="grid grid-cols-1 gap-space-2 md:grid-cols-2" role="radiogroup" aria-labelledby="ip-calc-label">
                        <button
                          type="button"
                          role="radio"
                          aria-checked={form.calcMethod === 'flat'}
                          className={`${RADIO_OPTION} ${form.calcMethod === 'flat' ? RADIO_OPTION_ACTIVE : ''}`}
                          onClick={() => setFieldAndPreview('calcMethod', 'flat')}
                        >
                          แบบคงที่
                          <span className="text-xs font-normal opacity-80">(Flat)</span>
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={form.calcMethod === 'effective'}
                          className={`${RADIO_OPTION} ${form.calcMethod === 'effective' ? RADIO_OPTION_ACTIVE : ''}`}
                          onClick={() => setFieldAndPreview('calcMethod', 'effective')}
                        >
                          ลดต้นลดดอก
                          <span className="text-xs font-normal opacity-80">(Effective)</span>
                        </button>
                      </div>
                      <span className={HELPER}>
                        แบบคงที่: ดอกเบี้ยเท่ากันทุกงวด · ลดต้นลดดอก: งวดแรกดอกเบี้ยสูงกว่างวดหลัง แต่ยอดชำระรวมเท่ากันทุกงวด
                        ไม่แน่ใจว่าบัตร/ร้านค้าคิดแบบไหน — ลองสลับดูได้ ตัวเลข &quot;ดอกเบี้ยรวม&quot; ด้านล่างจะปรับให้ทันที
                      </span>
                      {errors.calcMethod && <span id="plan-calcMethod-error" className={ERROR_TEXT}>{errors.calcMethod}</span>}
                    </div>
                  </>
                )}
              </fieldset>

              <div className="h-px bg-border-subtle" />

              {preview && (
                <div className="flex flex-col gap-space-2 rounded-sm border border-border-default bg-surface-2 p-space-4" aria-live="polite">
                  <h3 className="m-0 text-sm font-bold text-primary">สรุปแผนผ่อน</h3>
                  <div className="flex items-center justify-between gap-space-3 text-sm">
                    <span className="text-tertiary">ยอดชำระต่องวด</span>
                    <span className="font-[family-name:var(--font-numeric)] text-lg font-bold tabular-nums text-primary">{formatCurrency(preview.monthlyPayment)} บาท</span>
                  </div>
                  <div className="flex items-center justify-between gap-space-3 text-sm">
                    <span className="text-tertiary">ดอกเบี้ยรวม</span>
                    <span className="font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-primary">{formatCurrency(preview.totalInterest)} บาท</span>
                  </div>
                  <div className="flex items-center justify-between gap-space-3 text-sm">
                    <span className="text-tertiary">ยอดชำระทั้งหมด</span>
                    <span className="font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-primary">{formatCurrency(preview.totalPayable)} บาท</span>
                  </div>
                  <div className="flex items-center justify-between gap-space-3 text-sm">
                    <span className="text-tertiary">งวดแรก</span>
                    <span className="font-semibold text-primary">{formatMonthKeyTH(preview.firstMonth)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-space-3 text-sm">
                    <span className="text-tertiary">งวดสุดท้าย</span>
                    <span className="font-semibold text-primary">{formatMonthKeyTH(preview.lastMonth)}</span>
                  </div>
                  <button
                    type="button"
                    className={`min-h-11 rounded-sm border border-border-default bg-surface-1 text-sm font-semibold text-secondary ${FOCUS_RING}`}
                    onClick={() => setScheduleOpen(value => !value)}
                    aria-expanded={scheduleOpen}
                  >
                    {scheduleOpen ? 'ซ่อนตารางผ่อน' : 'ดูตารางผ่อนทั้งหมด'}
                  </button>
                  {scheduleOpen && (
                    <div className="mt-space-2 max-h-[260px] overflow-auto">
                      <table className="w-full border-collapse text-xs">
                        <thead>
                          <tr>
                            <th className="sticky top-0 whitespace-nowrap bg-surface-2 px-space-2 py-space-1 text-left font-semibold text-tertiary">งวด</th>
                            <th className="sticky top-0 whitespace-nowrap bg-surface-2 px-space-2 py-space-1 text-left font-semibold text-tertiary">เดือน</th>
                            <th className="sticky top-0 whitespace-nowrap bg-surface-2 px-space-2 py-space-1 text-right font-semibold text-tertiary">ยอดชำระ</th>
                            <th className="sticky top-0 whitespace-nowrap bg-surface-2 px-space-2 py-space-1 text-right font-semibold text-tertiary">เงินต้น</th>
                            <th className="sticky top-0 whitespace-nowrap bg-surface-2 px-space-2 py-space-1 text-right font-semibold text-tertiary">ดอกเบี้ย</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.schedule.map(row => (
                            <tr key={row.no} className="border-t border-border-subtle">
                              <td className="whitespace-nowrap px-space-2 py-space-1 text-primary">{row.no}</td>
                              <td className="whitespace-nowrap px-space-2 py-space-1 text-primary">{formatMonthKeyTH(row.dueMonth)}</td>
                              <td className="whitespace-nowrap px-space-2 py-space-1 text-right font-[family-name:var(--font-numeric)] tabular-nums text-primary">{formatCurrency(row.payment)}</td>
                              <td className="whitespace-nowrap px-space-2 py-space-1 text-right font-[family-name:var(--font-numeric)] tabular-nums text-primary">{formatCurrency(row.principal)}</td>
                              <td className="whitespace-nowrap px-space-2 py-space-1 text-right font-[family-name:var(--font-numeric)] tabular-nums text-primary">{formatCurrency(row.interest)}</td>
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

        <div className="flex shrink-0 flex-col-reverse items-stretch gap-space-3 border-t border-border-subtle px-space-5 py-space-4 md:flex-row md:items-center md:justify-end">
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
            {submitting ? 'กำลังบันทึก...' : 'บันทึกแผนผ่อน'}
          </button>
        </div>
      </form>
    </div>
  );
}
