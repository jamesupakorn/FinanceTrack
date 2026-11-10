/**
 * คอมโพเนนต์: InstallmentPlanForm (หน้าจอ 3b)
 * ฟอร์มเพิ่ม/แก้ไขแผนผ่อนชำระ พร้อมตัวเลือกโหมดดอกเบี้ย A/B (C9 modal)
 *
 * แผงสรุปผลคำนวณใหม่ตอน blur เท่านั้น ไม่ใช่ทุกครั้งที่พิมพ์
 * และคำนวณด้วย buildSchedule() ตัวเดียวกับที่ server ใช้
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  buildSchedule,
  validatePlanInput,
  getCurrentMonthKey,
  addMonths,
  cardDueMonthOffset,
  MAX_INSTALLMENTS_PER_PLAN,
  MAX_LOAN_INSTALLMENTS_PER_PLAN,
  isLoanCardType,
  computeStartMonthFromPurchase,
  isValidPurchaseDate,
  formatIsoDateTH,
  formatDayLabel
} from '../../shared/utils/creditCardUtils';
import { formatMonthKeyTH, THAI_MONTH_LABELS } from '../../shared/utils/dateUtils';
import { BANK_ISSUERS, isBankIssuerKey } from '../../shared/utils/creditCardBankCatalog';
import { formatCurrency, parseAndFormat } from '../../shared/utils/frontend/numberUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';
import { findTickableInstallments, type TickableInstallment } from '../../shared/utils/installmentBackdate';
import { Icons } from './Icons';
import BackdatedInstallmentsDialog from './BackdatedInstallmentsDialog';

export type ValidatedPlanValue = ReturnType<typeof validatePlanInput>['value'];

export interface PlanSubmitOptions {
  paidInstallmentNos: number[];
  /** D4 / Decision R: forwards live per-row progress during a loan's sequential backdated save. */
  onProgress?: (done: number, total: number) => void;
}

export type PlanSubmitValues = ValidatedPlanValue | Pick<ValidatedPlanValue, 'itemName'>;

interface BackdateState {
  values: ValidatedPlanValue;
  rows: TickableInstallment[];
  currentMonthKey: string;
}

interface InstallmentCardOption {
  id: string;
  name: string;
  last4?: string;
  statementDay?: number | string;
  cardType?: unknown;
  bankIssuer?: unknown;
  dueDay?: number | string;
}

interface InstallmentScheduleItem {
  paid?: boolean;
}

interface InstallmentPlanRecord {
  id?: string;
  cardId: string;
  itemName: string;
  totalPrice?: number | string;
  months: number;
  startMonth?: string;
  purchaseDate?: string | null;
  interestMode?: string;
  manualFeePerMonth?: number | string;
  annualRate?: number | string | null;
  calcMethod?: string;
  schedule?: InstallmentScheduleItem[];
}

interface PlanFormState {
  cardId: string;
  itemName: string;
  totalPrice: string;
  monthsPreset: string;
  months: string;
  startMonth: string;
  purchaseDate: string;
  interestMode: string;
  manualFeePerMonth: string;
  annualRate: string;
  calcMethod: string;
}

interface InstallmentPlanFormProps {
  open: boolean;
  plan?: InstallmentPlanRecord | null;
  cards?: InstallmentCardOption[];
  lockedCardId?: string | null;
  submitting?: boolean;
  onClose?: () => void;
  onSubmit?: (values: PlanSubmitValues, options?: PlanSubmitOptions) => void | Promise<void>;
  /** Loan setup step 2 only: reopen the locked card for editing (the page owns the round trip). */
  onEditLockedCard?: () => void;
}

const MONTH_PRESETS = [3, 6, 10, 12, 18, 24, 36, 48, 60];
const LOAN_MONTH_PRESETS = [12, 24, 36, 48, 60, 84, 120, 180, 240, 300, 360];
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

function buildStartMonthOptions(): string[] {
  const current = getCurrentMonthKey();
  const options: string[] = [];
  for (let offset = -12; offset <= 12; offset += 1) {
    options.push(addMonths(current, offset));
  }
  return options;
}

/** ปี ค.ศ. สำหรับ select งวดแรกของสินเชื่อ: ปีปัจจุบัน −40 … +1 (แสดงเป็น พ.ศ.) */
function buildLoanStartYearOptions(selectedYear: number): number[] {
  const currentYear = Number(getCurrentMonthKey().slice(0, 4));
  const years: number[] = [];
  for (let year = currentYear + 1; year >= currentYear - 40; year -= 1) years.push(year);
  return Number.isFinite(selectedYear) && !years.includes(selectedYear)
    ? [...years, selectedYear].sort((a, b) => b - a)
    : years;
}

/** วันนี้แบบ local 'YYYY-MM-DD' — ห้ามใช้ toISOString() เพราะเป็นวันที่ UTC */
function todayIsoDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** ข้อความอธิบายการคำนวณรอบบิล ตามวันสรุปยอดของบัตรที่เลือก (UX_SPEC §4) */
function buildCycleHelperText(card: InstallmentCardOption | undefined): string {
  const suffix = ' — ซื้อหลังวันสรุปยอดจะไปรอบบิลเดือนถัดไป เปลี่ยนเองได้ถ้าธนาคารตัดรอบต่างจากนี้';
  const label = formatDayLabel(card?.statementDay ?? '');
  if (label === '-') return `คำนวณจากวันสรุปยอดของบัตร${suffix}`;
  if (label === 'สิ้นเดือน') return `คำนวณจากวันสรุปยอดของบัตร (สิ้นเดือน)${suffix}`;
  return `คำนวณจากวันสรุปยอดของบัตร (วันที่ ${label})${suffix}`;
}

function createInitialForm(
  plan: InstallmentPlanRecord | null,
  lockedCardId: string | null,
  cards: InstallmentCardOption[]
): PlanFormState {
  const loan = isLoanCardType(cards.find(item => item.id === (plan?.cardId || lockedCardId))?.cardType);
  const presets = loan ? LOAN_MONTH_PRESETS : MONTH_PRESETS;
  if (plan) {
    return {
      cardId: plan.cardId || '',
      itemName: plan.itemName || '',
      totalPrice: parseAndFormat(plan.totalPrice || 0),
      monthsPreset: presets.includes(plan.months) ? String(plan.months) : CUSTOM_MONTHS,
      months: String(plan.months || ''),
      startMonth: plan.startMonth || getCurrentMonthKey(),
      purchaseDate: isValidPurchaseDate(plan.purchaseDate) ? plan.purchaseDate : '',
      interestMode: plan.interestMode || 'calculated',
      manualFeePerMonth: plan.interestMode === 'manual' ? parseAndFormat(plan.manualFeePerMonth || 0) : '',
      annualRate: plan.interestMode === 'calculated' ? String(plan.annualRate ?? '') : '',
      calcMethod: plan.calcMethod || 'flat',
      // Loans are always calculated + effective (BR-CC-035); the radios are hidden so force the hidden fields.
      ...(loan ? { interestMode: 'calculated', calcMethod: 'effective' } : {})
    };
  }
  // The unlocked picker lists credit cards only — a loan's one plan is always added locked to it (BR-CC-034).
  const cardId = lockedCardId || cards.find(item => !isLoanCardType(item.cardType))?.id || '';
  const card = cards.find(item => item.id === cardId);
  const purchaseDate = todayIsoDate();
  const defaultMonths = loan ? String(LOAN_MONTH_PRESETS[0]) : '10';
  return {
    cardId,
    itemName: '',
    totalPrice: '',
    monthsPreset: defaultMonths,
    months: defaultMonths,
    // Loans have no billing cycle (BR-CC-037): the first instalment defaults to the contract month.
    startMonth: computeStartMonthFromPurchase(purchaseDate, loan ? undefined : card?.statementDay) || getCurrentMonthKey(),
    purchaseDate,
    interestMode: 'calculated',
    manualFeePerMonth: '',
    annualRate: '',
    calcMethod: loan ? 'effective' : 'flat'
  };
}

export default function InstallmentPlanForm({
  open,
  plan = null,
  cards = [],
  lockedCardId = null,
  submitting = false,
  onClose,
  onSubmit,
  onEditLockedCard
}: InstallmentPlanFormProps) {
  const [form, setForm] = useState<PlanFormState>(() => createInitialForm(null, lockedCardId, cards));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [previewToken, setPreviewToken] = useState(0);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [backdate, setBackdate] = useState<BackdateState | null>(null);
  // D4 / Decision R: progress-counter state lives here, not in the dialog or the page.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const dialogRef = useRef<HTMLFormElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const backdateOpenRef = useRef(false);
  const restoreSubmitFocusRef = useRef(false);
  const formRef = useRef(form);
  formRef.current = form;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  backdateOpenRef.current = Boolean(backdate);

  const installmentsPaid = useMemo(
    () => (Array.isArray(plan?.schedule) ? plan.schedule.filter(row => row?.paid === true).length : 0),
    [plan]
  );
  const financialsLocked = Boolean(plan) && installmentsPaid > 0;
  const requirePurchaseDate = !plan || Boolean(plan?.purchaseDate);
  const lockedCard = cards.find(item => item.id === (lockedCardId || plan?.cardId || form.cardId));
  const lockedCardType = lockedCard?.cardType;
  const loanMode = isLoanCardType(lockedCardType);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setErrors({});
    setScheduleOpen(false);
    setBackdate(null);
    setForm(createInitialForm(plan, lockedCardId, cards));
    setPreviewToken(token => token + 1);
    const timer = setTimeout(() => firstFieldRef.current?.focus(), 40);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plan, lockedCardId]);

  // The page may open this form before its reloaded `cards` include a just-created loan. When loan
  // mode resolves, re-seed loan defaults so hidden interest/calc fields never keep credit-card values.
  useEffect(() => {
    if (!open || !loanMode) return;
    setForm(prev => (plan
      ? { ...prev, interestMode: 'calculated', calcMethod: 'effective' }
      : (prev.calcMethod === 'effective' ? prev : createInitialForm(null, lockedCardId, cards))));
    setPreviewToken(token => token + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loanMode]);

  useEffect(() => {
    if (backdate || !restoreSubmitFocusRef.current) return;
    restoreSubmitFocusRef.current = false;
    submitButtonRef.current?.focus();
  }, [backdate]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (backdateOpenRef.current) return;
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

  const startMonthOptions = useMemo(() => {
    const base = buildStartMonthOptions();
    return form.startMonth && !base.includes(form.startMonth)
      ? [...base, form.startMonth].sort()
      : base;
  }, [form.startMonth]);

  // อ่านจาก ref เพื่อให้พรีวิวอัปเดตเฉพาะตอนที่ previewToken เปลี่ยน (blur / เปลี่ยน select)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const preview = useMemo(() => {
    const result = validatePlanInput(formRef.current, { requirePurchaseDate, cardType: lockedCardType });
    if (!result.valid) return null;
    const computed = buildSchedule({ ...result.value, calcMethod: result.value.calcMethod ?? undefined });
    return {
      ...computed,
      firstMonth: computed.schedule[0]?.dueMonth || '',
      lastMonth: computed.schedule[computed.schedule.length - 1]?.dueMonth || ''
    };
  }, [previewToken]);

  if (!open) return null;

  const setField = (field: keyof PlanFormState, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  /** เปลี่ยนค่าแล้วคำนวณพรีวิวทันที — ใช้กับ select / radio ที่ไม่มีปัญหา focus */
  const setFieldAndPreview = (field: keyof PlanFormState, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setPreviewToken(token => token + 1);
  };

  const withComputedStartMonth = (next: PlanFormState): PlanFormState => {
    const card = cards.find(item => item.id === next.cardId);
    const computed = computeStartMonthFromPurchase(next.purchaseDate, loanMode ? undefined : card?.statementDay);
    return computed ? { ...next, startMonth: computed } : next;
  };

  const handlePurchaseDateChange = (value: string) => {
    setForm(prev => withComputedStartMonth({ ...prev, purchaseDate: value }));
    setPreviewToken(token => token + 1);
  };

  const handleCardChange = (cardId: string) => {
    setForm(prev => withComputedStartMonth({ ...prev, cardId }));
    setPreviewToken(token => token + 1);
  };

  const handleMonthsPreset = (value: string) => {
    if (value === CUSTOM_MONTHS) {
      setFieldAndPreview('monthsPreset', CUSTOM_MONTHS);
      return;
    }
    setForm(prev => ({ ...prev, monthsPreset: value, months: value }));
    setPreviewToken(token => token + 1);
  };

  const refreshPreview = () => setPreviewToken(token => token + 1);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
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

    const result = validatePlanInput(form, { requirePurchaseDate, cardType: lockedCardType });
    if (!result.valid) {
      setErrors(result.errors);
      showToast('กรุณาตรวจสอบข้อมูลแผนผ่อนอีกครั้ง', 'error');
      const firstInvalid = Object.keys(result.errors)[0];
      dialogRef.current?.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }
    setErrors({});
    if (!plan) {
      const currentMonthKey = getCurrentMonthKey();
      const { schedule } = buildSchedule({
        ...result.value,
        calcMethod: result.value.calcMethod ?? undefined
      });
      const selectedCard = cards.find(item => item.id === result.value.cardId);
      const rows = findTickableInstallments(
        schedule,
        currentMonthKey,
        cardDueMonthOffset(selectedCard ?? {})
      );
      if (rows.length > 0) {
        setBackdate({ values: result.value, rows, currentMonthKey });
        return;
      }
    }
    onSubmit?.(result.value);
  };

  const handleBackdateCancel = () => {
    restoreSubmitFocusRef.current = true;
    setBackdate(null);
  };

  const handleBackdateConfirm = async (paidInstallmentNos: number[]) => {
    if (!backdate) return;
    try {
      // D4 / Decision R: `onProgress` is loan-only — credit cards keep the pre-existing options
      // bag shape byte-identical (hard constraint: credit-card behaviour unchanged).
      await Promise.resolve(onSubmit?.(backdate.values, {
        paidInstallmentNos,
        ...(loanMode ? { onProgress: (done: number, total: number) => setProgress({ done, total }) } : {})
      }));
    } finally {
      setBackdate(null);
      setProgress(null);
    }
  };

  const describedBy = (field: string) => (errors[field] ? `plan-${field}-error` : undefined);
  const selectedCard = cards.find(item => item.id === form.cardId);
  const showLoanHeader = loanMode && Boolean(lockedCardId);
  const loanBankLabel = isBankIssuerKey(lockedCard?.bankIssuer) ? BANK_ISSUERS[lockedCard.bankIssuer].label : 'ไม่ระบุธนาคาร';
  const monthPresets = loanMode ? LOAN_MONTH_PRESETS : MONTH_PRESETS;
  const title = plan
    ? (loanMode ? 'แก้ไขตารางผ่อน' : 'แก้ไขแผนผ่อนชำระ')
    : (loanMode ? 'ตารางผ่อนสินเชื่อ · ขั้นที่ 2/2' : 'เพิ่มแผนผ่อนชำระ');
  const startYear = Number(form.startMonth.slice(0, 4));
  const startMonthIndex = Number(form.startMonth.slice(5, 7));
  const setLoanStartMonth = (year: number, month: number) => {
    setFieldAndPreview('startMonth', `${year}-${String(month).padStart(2, '0')}`);
  };

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
        aria-label={title}
        onSubmit={handleSubmit}
      >
        <div className="flex shrink-0 items-center justify-between gap-space-3 border-b border-border-subtle px-space-5 py-space-4">
          <h2 className="m-0 text-lg font-semibold text-primary">{title}</h2>
          <button
            type="button"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-secondary hover:bg-surface-2 ${FOCUS_RING}`}
            onClick={onClose}
            aria-label="ปิด"
          >
            <Icons.X size={18} />
          </button>
        </div>

        {showLoanHeader && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-space-2 border-b border-border-subtle bg-surface-1 px-space-5 py-space-2 text-sm text-secondary">
            <span className="min-w-0 break-words">{`${loanBankLabel} · ${lockedCard?.name ?? ''} · ครบกำหนดวันที่ ${formatDayLabel(lockedCard?.dueDay ?? '')}`}</span>
            {onEditLockedCard && (
              <button
                type="button"
                className={`flex min-h-11 items-center gap-space-1 rounded-sm px-space-2 text-sm font-medium text-accent hover:bg-surface-2 ${FOCUS_RING}`}
                onClick={onEditLockedCard}
              >
                <span aria-hidden="true" className="flex"><Icons.ChevronLeft size={16} /></span>
                กลับไปแก้ไขข้อมูลบัตร
              </button>
            )}
          </div>
        )}

        <div className="flex flex-1 min-h-0 flex-col gap-space-4 overflow-y-auto px-space-5 py-space-4">
          {financialsLocked && (
            <div className="flex items-start gap-space-2 rounded-sm border border-warn/35 bg-warn/10 px-space-3 py-space-3 text-sm leading-relaxed text-warn">
              <Icons.AlertTriangle size={18} />
              <span>{`แผนนี้ชำระไปแล้ว ${installmentsPaid} งวด แก้ไขตัวเลขไม่ได้ — หากต้องการเปลี่ยน ให้ยกเลิกแผนนี้แล้วสร้างใหม่`}</span>
            </div>
          )}

          {!showLoanHeader && (
          <div className="flex flex-col gap-space-1">
            <label className={LABEL} htmlFor="ip-card">บัตรที่ใช้ผ่อน <span className="text-neg">*</span></label>
            {lockedCardId || financialsLocked ? (
              <div className={READONLY_FIELD}>{selectedCard ? `${selectedCard.name}${selectedCard.last4 ? ` ····${selectedCard.last4}` : ''}` : '-'}</div>
            ) : (
              <select
                id="ip-card"
                name="cardId"
                className={INPUT}
                value={form.cardId}
                onChange={(event) => handleCardChange(event.target.value)}
                aria-invalid={errors.cardId ? 'true' : undefined}
                aria-describedby={describedBy('cardId')}
              >
                <option value="">— เลือกบัตร —</option>
                {cards.filter(item => !isLoanCardType(item.cardType)).map(item => <option key={item.id} value={item.id}>{item.name}{item.last4 ? ` ····${item.last4}` : ''}</option>)}
              </select>
            )}
            {errors.cardId && <span id="plan-cardId-error" className={ERROR_TEXT}>{errors.cardId}</span>}
          </div>
          )}

          <div className="flex flex-col gap-space-1">
            <label className={LABEL} htmlFor="ip-item">{loanMode ? 'ชื่อสัญญา / เลขที่สัญญา' : 'ชื่อสินค้า / รายการ'} <span className="text-neg">*</span></label>
            <input
              id="ip-item"
              name="itemName"
              ref={firstFieldRef}
              type="text"
              className={INPUT}
              maxLength={60}
              value={form.itemName}
              onChange={(event) => setField('itemName', event.target.value)}
              placeholder={loanMode ? 'เช่น สัญญาเลขที่ 123456789' : 'iPhone 17 Pro'}
              aria-invalid={errors.itemName ? 'true' : undefined}
              aria-describedby={describedBy('itemName')}
            />
            {errors.itemName && <span id="plan-itemName-error" className={ERROR_TEXT}>{errors.itemName}</span>}
          </div>

          <div className="grid grid-cols-1 gap-space-3 md:grid-cols-2">
            <div className="flex flex-col gap-space-1">
              <label className={LABEL} htmlFor="ip-price">{loanMode ? 'ยอดเงินกู้ (บาท)' : 'ราคาสินค้า (บาท)'} <span className="text-neg">*</span></label>
              {plan && financialsLocked ? (
                  <div className={READONLY_FIELD}><Icons.Lock size={14} className="shrink-0 opacity-70" />{formatCurrency(plan.totalPrice || 0)}</div>
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
              <label className={LABEL} htmlFor="ip-months">จำนวนงวด <span className="text-neg">*</span></label>
              {plan && financialsLocked ? (
                <div className={READONLY_FIELD}><Icons.Lock size={14} className="shrink-0 opacity-70" />{`${plan.months} งวด`}</div>
              ) : (
                <>
                  <select id="ip-months" className={INPUT} value={form.monthsPreset} onChange={(event) => handleMonthsPreset(event.target.value)}>
                    {monthPresets.map(value => <option key={value} value={String(value)}>{`${value} งวด`}</option>)}
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
                      placeholder={`1–${loanMode ? MAX_LOAN_INSTALLMENTS_PER_PLAN : MAX_INSTALLMENTS_PER_PLAN}`}
                      aria-invalid={errors.months ? 'true' : undefined}
                      aria-describedby={describedBy('months')}
                    />
                  )}
                </>
              )}
              {errors.months && <span id="plan-months-error" className={ERROR_TEXT}>{errors.months}</span>}
            </div>
          </div>

          {plan && financialsLocked ? (
            plan.purchaseDate ? (
              <div className="grid grid-cols-2 gap-space-3">
                <div className="flex flex-col gap-space-1"><span className={LABEL}>วันที่ซื้อ</span><div className={READONLY_FIELD}><Icons.Lock size={14} className="shrink-0 opacity-70" />{formatIsoDateTH(plan.purchaseDate)}</div></div>
                <div className="flex flex-col gap-space-1"><span className={LABEL}>รอบบิลเดือน</span><div className={READONLY_FIELD}><Icons.Lock size={14} className="shrink-0 opacity-70" />{formatMonthKeyTH(plan.startMonth || '')}</div></div>
              </div>
            ) : (
              <div className="flex flex-col gap-space-1"><span className={LABEL}>รอบบิลเดือน</span><div className={READONLY_FIELD}><Icons.Lock size={14} className="shrink-0 opacity-70" />{formatMonthKeyTH(plan.startMonth || '')}</div></div>
            )
          ) : (
            <div className="grid grid-cols-2 gap-space-3">
              <div className="flex min-w-0 flex-col gap-space-1">
                <label className={LABEL} htmlFor="ip-purchase">{loanMode ? 'วันที่ทำสัญญา' : 'วันที่ซื้อ'} {requirePurchaseDate && <span className="text-neg">*</span>}</label>
                <input
                  id="ip-purchase"
                  name="purchaseDate"
                  type="date"
                  className={`${INPUT} min-w-0`}
                  value={form.purchaseDate}
                  onChange={(event) => handlePurchaseDateChange(event.target.value)}
                  aria-required={requirePurchaseDate ? 'true' : undefined}
                  aria-invalid={errors.purchaseDate ? 'true' : undefined}
                  aria-describedby={`ip-cycle-help${errors.purchaseDate ? ' plan-purchaseDate-error' : ''}`}
                />
                {errors.purchaseDate && <span id="plan-purchaseDate-error" className={ERROR_TEXT}>{errors.purchaseDate}</span>}
              </div>
              {loanMode ? (
                <fieldset className="m-0 flex min-w-0 flex-col gap-space-1 border-0 p-0">
                  <legend className={LABEL}>งวดแรกเดือน <span className="text-neg">*</span></legend>
                  <div className="grid grid-cols-2 gap-space-2">
                    <select
                      id="ip-start-year"
                      aria-label="ปี (พ.ศ.)"
                      className={`${INPUT} min-w-0`}
                      value={String(startYear)}
                      onChange={(event) => setLoanStartMonth(Number(event.target.value), startMonthIndex || 1)}
                      aria-invalid={errors.startMonth ? 'true' : undefined}
                      aria-describedby={`ip-cycle-help${errors.startMonth ? ' plan-startMonth-error' : ''}`}
                    >
                      {buildLoanStartYearOptions(startYear).map(year => <option key={year} value={String(year)}>{year + 543}</option>)}
                    </select>
                    <select
                      id="ip-start"
                      name="startMonth"
                      aria-label="เดือน"
                      className={`${INPUT} min-w-0`}
                      value={String(startMonthIndex)}
                      onChange={(event) => setLoanStartMonth(startYear, Number(event.target.value))}
                      aria-invalid={errors.startMonth ? 'true' : undefined}
                      aria-describedby={`ip-cycle-help${errors.startMonth ? ' plan-startMonth-error' : ''}`}
                    >
                      {THAI_MONTH_LABELS.map((label, index) => <option key={label} value={String(index + 1)}>{label}</option>)}
                    </select>
                  </div>
                  {errors.startMonth && <span id="plan-startMonth-error" className={ERROR_TEXT}>{errors.startMonth}</span>}
                </fieldset>
              ) : (
              <div className="flex min-w-0 flex-col gap-space-1">
                <label className={LABEL} htmlFor="ip-start">รอบบิลเดือน <span className="text-neg">*</span></label>
                <select id="ip-start" name="startMonth" className={INPUT} value={form.startMonth} onChange={(event) => setFieldAndPreview('startMonth', event.target.value)} aria-invalid={errors.startMonth ? 'true' : undefined} aria-describedby={`ip-cycle-help${errors.startMonth ? ' plan-startMonth-error' : ''}`}>
                  {startMonthOptions.map(monthKey => <option key={monthKey} value={monthKey}>{formatMonthKeyTH(monthKey)}</option>)}
                </select>
                {errors.startMonth && <span id="plan-startMonth-error" className={ERROR_TEXT}>{errors.startMonth}</span>}
              </div>
              )}
              <span id="ip-cycle-help" className={`${HELPER} col-span-2`}>
                {loanMode
                  ? 'ตั้งต้นเป็นเดือนเดียวกับวันที่ทำสัญญา — เปลี่ยนเองได้ถ้างวดแรกเริ่มเดือนอื่น'
                  : buildCycleHelperText(selectedCard)}
                {!requirePurchaseDate && <><br />แผนนี้สร้างก่อนมีช่องวันที่ซื้อ จะใส่หรือเว้นว่างไว้ก็ได้</>}
              </span>
            </div>
          )}

          {!financialsLocked && (
            <>
              <div className="h-px bg-border-subtle" />
              {loanMode ? (
              <fieldset className="m-0 flex flex-col gap-space-3 border-0 p-0">
                <legend className={GROUP_TITLE}>ดอกเบี้ย *</legend>
                <div className="flex flex-col gap-space-1">
                  <label className={LABEL} htmlFor="ip-rate">อัตราดอกเบี้ยต่อปี (%) <span className="text-neg">*</span></label>
                  <input id="ip-rate" name="annualRate" type="text" inputMode="decimal" className={INPUT} value={form.annualRate} onChange={(event) => setField('annualRate', event.target.value)} onBlur={refreshPreview} placeholder="3.5" aria-invalid={errors.annualRate ? 'true' : undefined} aria-describedby={describedBy('annualRate')} />
                  <span className={HELPER}>อัตรานี้มักอยู่ที่ 3–8% ต่อปีสำหรับสินเชื่อบ้าน/ส่วนบุคคล — ตรวจสอบจากสัญญาเงินกู้ของคุณ</span>
                  {errors.annualRate && <span id="plan-annualRate-error" className={ERROR_TEXT}>{errors.annualRate}</span>}
                </div>
                <p className={`${HELPER} m-0`}>คำนวณแบบลดต้นลดดอก (Effective) ตามมาตรฐานสินเชื่อธนาคาร</p>
                {errors.calcMethod && <span id="plan-calcMethod-error" className={ERROR_TEXT}>{errors.calcMethod}</span>}
                {errors.interestMode && <span id="plan-interestMode-error" className={ERROR_TEXT}>{errors.interestMode}</span>}
              </fieldset>
              ) : (
              <fieldset className="m-0 flex flex-col gap-space-3 border-0 p-0">
                <legend className={GROUP_TITLE}>ดอกเบี้ย / ค่าธรรมเนียม *</legend>
                <div className="grid grid-cols-1 gap-space-2 md:grid-cols-2" role="radiogroup" aria-label="รูปแบบดอกเบี้ย">
                  <button type="button" role="radio" aria-checked={form.interestMode === 'calculated'} className={`${RADIO_OPTION} ${form.interestMode === 'calculated' ? RADIO_OPTION_ACTIVE : ''}`} onClick={() => setFieldAndPreview('interestMode', 'calculated')}>คำนวณจาก %/ปี</button>
                  <button type="button" role="radio" aria-checked={form.interestMode === 'manual'} className={`${RADIO_OPTION} ${form.interestMode === 'manual' ? RADIO_OPTION_ACTIVE : ''}`} onClick={() => setFieldAndPreview('interestMode', 'manual')}>กรอกยอดเอง</button>
                </div>

                {form.interestMode !== 'manual' ? (
                  <>
                    <div className="flex flex-col gap-space-1">
                      <label className={LABEL} htmlFor="ip-rate">อัตราดอกเบี้ยผ่อนชำระต่อปี (%) <span className="text-neg">*</span></label>
                      <input id="ip-rate" name="annualRate" type="text" inputMode="decimal" className={INPUT} value={form.annualRate} onChange={(event) => setField('annualRate', event.target.value)} onBlur={refreshPreview} placeholder="0.8" aria-invalid={errors.annualRate ? 'true' : undefined} aria-describedby={describedBy('annualRate')} />
                      <span className={HELPER}>อัตรานี้มักอยู่ที่ 0.5–1.5% ต่อปี ไม่ใช่ตัวเลขเดียวกับอัตราดอกเบี้ยบัตรเครดิต (ซึ่งมักอยู่ที่ 16–25%)</span>
                      {errors.annualRate && <span id="plan-annualRate-error" className={ERROR_TEXT}>{errors.annualRate}</span>}
                    </div>

                    <div className="flex flex-col gap-space-1">
                      <span className={LABEL} id="ip-calc-label">วิธีคำนวณ <span className="text-neg">*</span></span>
                      <div className="grid grid-cols-1 gap-space-2 md:grid-cols-2" role="radiogroup" aria-labelledby="ip-calc-label">
                        <button type="button" role="radio" aria-checked={form.calcMethod === 'flat'} className={`${RADIO_OPTION} ${form.calcMethod === 'flat' ? RADIO_OPTION_ACTIVE : ''}`} onClick={() => setFieldAndPreview('calcMethod', 'flat')}>แบบคงที่<span className="text-xs font-normal opacity-80">(Flat)</span></button>
                        <button type="button" role="radio" aria-checked={form.calcMethod === 'effective'} className={`${RADIO_OPTION} ${form.calcMethod === 'effective' ? RADIO_OPTION_ACTIVE : ''}`} onClick={() => setFieldAndPreview('calcMethod', 'effective')}>ลดต้นลดดอก<span className="text-xs font-normal opacity-80">(Effective)</span></button>
                      </div>
                      <span className={HELPER}>แบบคงที่: ดอกเบี้ยเท่ากันทุกงวด · ลดต้นลดดอก: งวดแรกดอกเบี้ยสูงกว่างวดหลัง แต่ยอดชำระรวมเท่ากันทุกงวด ไม่แน่ใจว่าบัตร/ร้านค้าคิดแบบไหน — ลองสลับดูได้ ตัวเลข &quot;ดอกเบี้ยรวม&quot; ด้านล่างจะปรับให้ทันที</span>
                      {errors.calcMethod && <span id="plan-calcMethod-error" className={ERROR_TEXT}>{errors.calcMethod}</span>}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col gap-space-1">
                    <label className={LABEL} htmlFor="ip-fee">ค่าธรรมเนียม/ดอกเบี้ย ต่องวด (บาท) <span className="text-neg">*</span></label>
                    <input id="ip-fee" name="manualFeePerMonth" type="text" inputMode="decimal" className={INPUT} value={form.manualFeePerMonth} onChange={(event) => setField('manualFeePerMonth', event.target.value)} onBlur={(event) => { if (event.target.value.trim()) setField('manualFeePerMonth', parseAndFormat(event.target.value)); refreshPreview(); }} placeholder="150" aria-invalid={errors.manualFeePerMonth ? 'true' : undefined} aria-describedby={describedBy('manualFeePerMonth')} />
                    <span className={HELPER}>ใส่ยอดตามที่ระบุในใบแจ้งหนี้ ทุกงวดเท่ากัน ระบบจะไม่คำนวณเพิ่ม</span>
                    {errors.manualFeePerMonth && <span id="plan-manualFeePerMonth-error" className={ERROR_TEXT}>{errors.manualFeePerMonth}</span>}
                  </div>
                )}
              </fieldset>
              )}

              <div className="h-px bg-border-subtle" />
              {preview && (
                <div className="flex flex-col gap-space-2 rounded-sm border border-border-default bg-surface-2 p-space-4" aria-live="polite">
                  <h3 className="m-0 text-sm font-bold text-primary">สรุปแผนผ่อน</h3>
                  <div className="flex items-center justify-between gap-space-3 text-sm"><span className="text-tertiary">ยอดชำระต่องวด</span><span className="font-[family-name:var(--font-numeric)] text-lg font-bold tabular-nums text-primary">{formatCurrency(preview.monthlyPayment)} บาท</span></div>
                  <div className="flex items-center justify-between gap-space-3 text-sm"><span className="text-tertiary">ดอกเบี้ยรวม</span><span className="font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-primary">{formatCurrency(preview.totalInterest)} บาท</span></div>
                  <div className="flex items-center justify-between gap-space-3 text-sm"><span className="text-tertiary">ยอดชำระทั้งหมด</span><span className="font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-primary">{formatCurrency(preview.totalPayable)} บาท</span></div>
                  <div className="flex items-center justify-between gap-space-3 text-sm"><span className="text-tertiary">งวดแรก</span><span className="font-semibold text-primary">{formatMonthKeyTH(preview.firstMonth)}</span></div>
                  <div className="flex items-center justify-between gap-space-3 text-sm"><span className="text-tertiary">งวดสุดท้าย</span><span className="font-semibold text-primary">{formatMonthKeyTH(preview.lastMonth)}</span></div>
                  <button type="button" className={`min-h-11 rounded-sm border border-border-default bg-surface-1 text-sm font-semibold text-secondary ${FOCUS_RING}`} onClick={() => setScheduleOpen(value => !value)} aria-expanded={scheduleOpen}>{scheduleOpen ? 'ซ่อนตารางผ่อน' : 'ดูตารางผ่อนทั้งหมด'}</button>
                  {scheduleOpen && (
                    <div className="mt-space-2 max-h-[260px] overflow-auto">
                      <table className="w-full border-collapse text-xs">
                        <thead><tr>
                          <th className="sticky top-0 whitespace-nowrap bg-surface-2 px-space-2 py-space-1 text-left font-semibold text-tertiary">งวด</th>
                          <th className="sticky top-0 whitespace-nowrap bg-surface-2 px-space-2 py-space-1 text-left font-semibold text-tertiary">เดือน</th>
                          <th className="sticky top-0 whitespace-nowrap bg-surface-2 px-space-2 py-space-1 text-right font-semibold text-tertiary">ยอดชำระ</th>
                          <th className="sticky top-0 whitespace-nowrap bg-surface-2 px-space-2 py-space-1 text-right font-semibold text-tertiary">เงินต้น</th>
                          <th className="sticky top-0 whitespace-nowrap bg-surface-2 px-space-2 py-space-1 text-right font-semibold text-tertiary">ดอกเบี้ย</th>
                        </tr></thead>
                        <tbody>{preview.schedule.map(row => (
                          <tr key={row.no} className="border-t border-border-subtle">
                            <td className="whitespace-nowrap px-space-2 py-space-1 text-primary">{row.no}</td>
                            <td className="whitespace-nowrap px-space-2 py-space-1 text-primary">{formatMonthKeyTH(row.dueMonth)}</td>
                            <td className="whitespace-nowrap px-space-2 py-space-1 text-right font-[family-name:var(--font-numeric)] tabular-nums text-primary">{formatCurrency(row.payment)}</td>
                            <td className="whitespace-nowrap px-space-2 py-space-1 text-right font-[family-name:var(--font-numeric)] tabular-nums text-primary">{formatCurrency(row.principal)}</td>
                            <td className="whitespace-nowrap px-space-2 py-space-1 text-right font-[family-name:var(--font-numeric)] tabular-nums text-primary">{formatCurrency(row.interest)}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-col-reverse items-stretch gap-space-3 border-t border-border-subtle px-space-5 py-space-4 md:flex-row md:items-center md:justify-end">
          <button type="button" className={`min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary ${FOCUS_RING}`} onClick={onClose}>ยกเลิก</button>
          <button ref={submitButtonRef} type="submit" className={`min-h-11 rounded-sm bg-accent px-space-5 text-sm font-semibold text-on-accent disabled:opacity-60 ${FOCUS_RING}`} disabled={submitting}>{submitting ? 'กำลังบันทึก...' : (loanMode ? 'บันทึกสินเชื่อ' : 'บันทึกแผนผ่อน')}</button>
        </div>
      </form>
      <BackdatedInstallmentsDialog
        open={Boolean(backdate)}
        months={backdate?.values.months ?? 0}
        currentMonthKey={backdate?.currentMonthKey ?? ''}
        rows={backdate?.rows ?? []}
        busy={submitting}
        loanMode={loanMode}
        progress={progress}
        onCancel={handleBackdateCancel}
        onConfirm={handleBackdateConfirm}
      />
    </div>
  );
}