/**
 * คอมโพเนนต์: SalaryCalculator
 * ฟอร์มคำนวณเงินเดือน รายรับ/รายหัก และภาษีรายเดือน
 */

import { useState, useEffect, type FocusEvent } from 'react';
import { createPortal } from 'react-dom';
import { formatCurrency, parseAndFormat, parseToNumber } from '../../shared/utils/frontend/numberUtils';
import { salaryAPI, incomeAPI, taxAPI } from '../../shared/utils/frontend/apiUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import {
  OT_MULTIPLIERS,
  LEGACY_OVERTIME_KEYS,
  calculateOvertimeRowAmount,
  calculateOvertimeTotal,
  coerceOvertimeHours,
  coerceOvertimeMultiplier,
  getSalaryHourlyRate,
  normaliseOvertimeRows
} from '../../shared/utils/overtimeUtils';
import type { OvertimeMultiplier } from '../../shared/utils/overtimeUtils';

type ItemType = 'income' | 'deduction';
type SalaryItem = { id: string; key: string; label: string; value: string; locked?: boolean };
type OvertimeRow = ReturnType<typeof normaliseOvertimeRows>[number];
type OvertimeFormItem = { id: string; hours: string; multiplier: OvertimeMultiplier };
type LegacyOvertimeItem = { id: string; label: string; amount: number | string };

interface SalaryCalculatorProps {
  selectedMonth?: string | null;
  onSalaryUpdate?: () => void;
  inModal?: boolean;
  footerTarget?: HTMLElement | null;
}

interface SalaryItemRowProps {
  type: ItemType;
  item: SalaryItem;
  typeLabelHint: string;
  onLabelChange: (id: string, value: string) => void;
  onValueChange: (id: string, value: string) => void;
  onValueBlur: (id: string, value: string) => void;
  onAmountFocus: (event: FocusEvent<HTMLInputElement>) => void;
  onRemove: (id: string) => void;
  removeAriaLabel: string;
}

interface OvertimeItemRowProps {
  row: OvertimeFormItem;
  amount: number;
  onHoursChange: (id: string, value: string) => void;
  onHoursBlur: (id: string, value: string) => void;
  onMultiplierChange: (id: string, value: string) => void;
  onRemove: (id: string) => void;
}

interface SalaryActionButtonsProps {
  clearAll: () => void;
  saveSalaryData: () => void | Promise<void>;
  isSaving: boolean;
}

const getThaiMonthName = (monthStr: string): string => {
  if (!monthStr) return '';
  const [, month] = monthStr.split('-');
  const monthNames = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  return `${monthNames[parseInt(month, 10) - 1]} ${monthStr.split('-')[0]}`;
};

const salaryKeyThaiMapping: Record<string, string> = {
  salary: 'เงินเดือน',
  bonus: 'โบนัส',
  other_income: 'เงินได้อื่นๆ',
  provident_fund: 'หักกองทุนสำรองเลี้ยงชีพ',
  social_security: 'หักสมทบประกันสังคม',
  tax: 'หักภาษี'
};

const LABELS_META_KEY = '__labels';
const SALARY_KEY = 'salary';
const incomePresetKeys = [SALARY_KEY, 'bonus', 'other_income'];
const deductionPresetKeys = ['provident_fund', 'social_security', 'tax'];
const LEGACY_OVERTIME_KEY_SET = new Set<string>(LEGACY_OVERTIME_KEYS);

const buildPresetItems = (keys: string[]): SalaryItem[] => keys.map(key => ({
  id: key,
  key,
  label: salaryKeyThaiMapping[key] || 'รายการใหม่',
  value: '',
  locked: key === SALARY_KEY
}));

const generateItemId = (prefix: string): string => {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${prefix}_${stamp}`;
};

const createNewItem = (type: ItemType): SalaryItem => {
  const id = generateItemId(type);
  return { id, key: id, label: type === 'income' ? 'รายได้ใหม่' : 'รายการหักใหม่', value: '' };
};

const formatIncomingValue = (rawValue: unknown): string => {
  if (rawValue === undefined || rawValue === null || rawValue === '') return '';
  return parseAndFormat(rawValue as string | number);
};

const isNumericValue = (value: unknown): boolean => {
  if (typeof value === 'number') return true;
  return typeof value === 'string' && value.trim().length > 0;
};

const withLockedSalaryRow = (items: SalaryItem[]): SalaryItem[] => {
  const index = items.findIndex(item => item.key === SALARY_KEY);
  if (index === -1) {
    return [{ id: SALARY_KEY, key: SALARY_KEY, label: salaryKeyThaiMapping[SALARY_KEY], value: '', locked: true }, ...items];
  }
  const existing = items[index];
  const rest = items.filter((_, itemIndex) => itemIndex !== index);
  return [{ ...existing, label: salaryKeyThaiMapping[SALARY_KEY], locked: true }, ...rest];
};

const buildItemsFromSource = (sectionData: unknown, presetKeys: string[], type: ItemType): SalaryItem[] => {
  if (!sectionData || typeof sectionData !== 'object' || Array.isArray(sectionData)) return buildPresetItems(presetKeys);
  const source = sectionData as Record<string, unknown>;
  const labelsMap = source[LABELS_META_KEY] && typeof source[LABELS_META_KEY] === 'object'
    ? source[LABELS_META_KEY] as Record<string, unknown>
    : {};
  const items: SalaryItem[] = [];
  const seenKeys = new Set<string>();

  presetKeys.forEach(key => {
    seenKeys.add(key);
    const hasValue = Object.prototype.hasOwnProperty.call(source, key);
    const rawValue = source[key];
    const numValue = parseToNumber(rawValue as string | number | null | undefined);
    if (hasValue && numValue > 0) {
      items.push({
        id: key,
        key,
        label: typeof labelsMap[key] === 'string' ? labelsMap[key] as string : salaryKeyThaiMapping[key] || 'รายการใหม่',
        value: formatIncomingValue(rawValue)
      });
    }
  });

  Object.entries(source)
    .filter(([key, value]) => key !== LABELS_META_KEY && !seenKeys.has(key) && !LEGACY_OVERTIME_KEY_SET.has(key) && isNumericValue(value))
    .forEach(([key, value]) => {
      const numValue = parseToNumber(value as string | number | null | undefined);
      if (numValue > 0) {
        items.push({
          id: key,
          key,
          label: typeof labelsMap[key] === 'string' ? labelsMap[key] as string : 'รายการใหม่',
          value: formatIncomingValue(value)
        });
        seenKeys.add(key);
      }
    });

  if (type === 'income') return withLockedSalaryRow(items);
  return items.length ? items : [createNewItem(type)];
};

const pickLegacyIncomeData = (income: unknown): { values: Record<string, unknown>; labels: Record<string, string> } => {
  const values: Record<string, unknown> = {};
  const labels: Record<string, string> = {};
  if (!income || typeof income !== 'object' || Array.isArray(income)) return { values, labels };
  const source = income as Record<string, unknown>;
  const labelsMap = source[LABELS_META_KEY] && typeof source[LABELS_META_KEY] === 'object'
    ? source[LABELS_META_KEY] as Record<string, unknown>
    : {};
  LEGACY_OVERTIME_KEYS.forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(source, key)) return;
    values[key] = source[key];
    if (typeof labelsMap[key] === 'string' && labelsMap[key].trim()) labels[key] = labelsMap[key];
  });
  return { values, labels };
};

const buildOvertimeItemsFromSource = (raw: unknown): OvertimeFormItem[] =>
  normaliseOvertimeRows(raw).map(row => ({ id: row.id, hours: Number(row.hours) > 0 ? String(row.hours) : '', multiplier: row.multiplier }));

const createOvertimeItem = (): OvertimeFormItem => ({ id: generateItemId('ot'), hours: '', multiplier: 1.5 });

const formatBaht = (value: unknown): string => Math.round(parseToNumber(value as string | number | null | undefined)).toLocaleString('en-US');

const serializeItemsForSave = (items: SalaryItem[]): Record<string, unknown> => {
  const values: Record<string, unknown> = {};
  const labels: Record<string, string> = {};
  items.forEach(item => {
    const numValue = parseToNumber(item.value);
    if (numValue > 0) {
      values[item.key] = numValue;
      labels[item.key] = item.label?.trim() || 'รายการใหม่';
    }
  });
  if (Object.keys(labels).length > 0) values[LABELS_META_KEY] = labels;
  return values;
};

const sumItems = (items: SalaryItem[]) => items.reduce((sum, item) => sum + parseToNumber(item.value), 0);
const hasInputValue = (value: unknown) => String(value ?? '').trim() !== '';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const INPUT = `min-h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-base text-primary outline-none transition-colors duration-fast ease-graphite focus:border-accent ${FOCUS_RING}`;
const FIELD_LABEL = 'text-xs font-medium text-tertiary';
const SECTION_TITLE = 'm-0 text-xl font-semibold text-primary';

function SalaryItemRow({
  type,
  item,
  typeLabelHint,
  onLabelChange,
  onValueChange,
  onValueBlur,
  onAmountFocus,
  onRemove,
  removeAriaLabel
}: SalaryItemRowProps) {
  return (
    <div className="flex flex-col gap-space-2 border-b border-border-subtle py-space-3 last:border-b-0" data-salary-type={type} data-salary-id={item.id}>
      {item.locked ? <div className="flex items-end gap-space-2"><span className="flex-1 text-base text-primary">{item.label}</span></div> : (
        <div className="flex items-end gap-space-2">
          <div className="flex flex-1 flex-col gap-space-1"><span className={FIELD_LABEL}>ชื่อรายการ</span><input type="text" value={item.label} onChange={event => onLabelChange(item.id, event.target.value)} placeholder={typeLabelHint} className={INPUT} aria-label={`แก้ไขชื่อ${removeAriaLabel}`} /></div>
          <button type="button" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-secondary hover:bg-surface-2 hover:text-neg ${FOCUS_RING}`} onClick={() => onRemove(item.id)} aria-label={`ลบ${removeAriaLabel}นี้`}>✕</button>
        </div>
      )}
      <div className="flex flex-col gap-space-1"><span className={FIELD_LABEL}>จำนวนเงิน</span><input type="text" value={item.value} onChange={event => onValueChange(item.id, event.target.value)} onBlur={event => onValueBlur(item.id, event.target.value)} onFocus={onAmountFocus} placeholder="0.00" className={`${INPUT} font-numeric text-lg font-semibold tabular-nums`} aria-label={item.locked ? `จำนวนเงิน${item.label}` : `จำนวนเงิน${removeAriaLabel}`} inputMode="decimal" /></div>
    </div>
  );
}

function OvertimeItemRow({ row, amount, onHoursChange, onHoursBlur, onMultiplierChange, onRemove }: OvertimeItemRowProps) {
  return (
    <div className="flex flex-col gap-space-2 border-b border-border-subtle py-space-3 last:border-b-0" data-salary-type="overtime" data-salary-id={row.id}>
      <div className="flex items-end gap-space-2">
        <div className="flex w-24 flex-col gap-space-1"><span className={FIELD_LABEL}>ชั่วโมง</span><input type="text" value={row.hours} onChange={event => onHoursChange(row.id, event.target.value)} onBlur={event => onHoursBlur(row.id, event.target.value)} placeholder="0" className={`${INPUT} font-numeric tabular-nums`} aria-label="จำนวนชั่วโมง OT" inputMode="decimal" /></div>
        <div className="flex flex-1 flex-col gap-space-1"><span className={FIELD_LABEL}>ตัวคูณ</span><select value={String(row.multiplier)} onChange={event => onMultiplierChange(row.id, event.target.value)} className={INPUT} aria-label="ตัวคูณ OT">{OT_MULTIPLIERS.map(multiplier => <option key={multiplier} value={multiplier}>{`${multiplier} เท่า`}</option>)}</select></div>
      </div>
      <div className="flex items-end gap-space-2"><div className="flex flex-1 flex-col gap-space-1"><span className={FIELD_LABEL}>จำนวนเงิน</span><span className="font-numeric text-lg font-semibold tabular-nums text-primary">{formatBaht(amount)}</span></div><button type="button" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-secondary hover:bg-surface-2 hover:text-neg ${FOCUS_RING}`} onClick={() => onRemove(row.id)} aria-label="ลบรายการ OT นี้">✕</button></div>
    </div>
  );
}

function LegacyOvertimeRow({ row }: { row: LegacyOvertimeItem }) {
  return (
    <div className="flex flex-col gap-space-2 border-b border-border-subtle py-space-3 opacity-70 last:border-b-0" data-salary-type="overtime-legacy" data-salary-id={row.id}>
      <div className="flex flex-wrap items-center gap-space-2"><span className="whitespace-nowrap rounded-full bg-surface-2 px-space-2 py-space-1 text-xs font-medium text-tertiary">ข้อมูลเดิม</span><span className="text-sm text-secondary">{row.label}</span></div>
      <span className="font-numeric text-lg font-semibold tabular-nums text-primary">{formatBaht(row.amount)}</span>
    </div>
  );
}

function SalaryActionButtons({ clearAll, saveSalaryData, isSaving }: SalaryActionButtonsProps) {
  return (
    <div className="flex flex-col-reverse gap-space-3 sm:flex-row">
      <button type="button" onClick={clearAll} className={`min-h-11 flex-1 rounded-sm border border-border-interactive bg-surface-2 text-sm font-medium text-primary ${FOCUS_RING}`} aria-label="ล้างข้อมูล">ล้างข้อมูล</button>
      <button type="button" onClick={saveSalaryData} className={`min-h-11 flex-1 rounded-sm bg-accent text-sm font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`} aria-label="บันทึกเงินเดือน" disabled={isSaving}>{isSaving ? 'กำลังบันทึก...' : 'บันทึกเงินเดือน'}</button>
    </div>
  );
}

export default function SalaryCalculator({ selectedMonth, onSalaryUpdate, inModal = false, footerTarget = null }: SalaryCalculatorProps) {
  const [incomeItems, setIncomeItems] = useState<SalaryItem[]>(() => buildPresetItems(incomePresetKeys));
  const [deductionItems, setDeductionItems] = useState<SalaryItem[]>(() => buildPresetItems(deductionPresetKeys));
  const [overtimeItems, setOvertimeItems] = useState<OvertimeFormItem[]>([]);
  const [legacyOvertime, setLegacyOvertime] = useState<LegacyOvertimeItem[]>([]);
  const [legacyIncomeKeys, setLegacyIncomeKeys] = useState<Record<string, unknown>>({});
  const [legacyIncomeLabels, setLegacyIncomeLabels] = useState<Record<string, string>>({});
  const [pendingScrollItem, setPendingScrollItem] = useState<{ type: string; id: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const salaryAmount = parseToNumber(incomeItems.find(item => item.key === SALARY_KEY)?.value ?? '');
  const hourlyRate = getSalaryHourlyRate(salaryAmount, selectedMonth || '');
  const computedOvertimeTotal = calculateOvertimeTotal(overtimeItems, salaryAmount, selectedMonth || '');
  const legacyOvertimeTotal = legacyOvertime.reduce((sum, row) => sum + parseToNumber(row.amount), 0);
  const overtimeSectionTotal = computedOvertimeTotal + legacyOvertime.reduce((sum, row) => sum + Math.round(parseToNumber(row.amount)), 0);
  const sectionIncomeTotal = sumItems(incomeItems);
  const totalIncome = sectionIncomeTotal + computedOvertimeTotal + legacyOvertimeTotal;
  const totalDeduct = sumItems(deductionItems);
  const netIncomeValue = totalIncome - totalDeduct;
  const hasOvertimeRows = overtimeItems.length > 0 || legacyOvertime.length > 0;

  const resetOvertimeState = () => {
    setOvertimeItems([]);
    setLegacyOvertime([]);
    setLegacyIncomeKeys({});
    setLegacyIncomeLabels({});
  };

  const loadSalaryData = async (month: string) => {
    try {
      const data = await salaryAPI.getByMonth(month);
      setIncomeItems(buildItemsFromSource(data?.income, incomePresetKeys, 'income'));
      setDeductionItems(buildItemsFromSource(data?.deduct, deductionPresetKeys, 'deduction'));
      setOvertimeItems(buildOvertimeItemsFromSource(data?.overtime));
      setLegacyOvertime(Array.isArray(data?.overtimeLegacy) ? data.overtimeLegacy : []);
      const legacy = pickLegacyIncomeData(data?.income);
      setLegacyIncomeKeys(legacy.values);
      setLegacyIncomeLabels(legacy.labels);
      setLoadFailed(false);
    } catch (error) {
      console.error('Error loading salary data:', error);
      setIncomeItems(buildPresetItems(incomePresetKeys));
      setDeductionItems(buildPresetItems(deductionPresetKeys));
      resetOvertimeState();
      setLoadFailed(true);
    }
  };

  useEffect(() => {
    setLoadFailed(false);
    if (!selectedMonth) {
      setIncomeItems(buildPresetItems(incomePresetKeys));
      setDeductionItems(buildPresetItems(deductionPresetKeys));
      resetOvertimeState();
      return;
    }
    void loadSalaryData(selectedMonth);
  }, [selectedMonth]);

  useEffect(() => {
    if (!pendingScrollItem?.id || !pendingScrollItem.type) return undefined;
    const { id, type } = pendingScrollItem;
    const tryScroll = () => {
      if (typeof document === 'undefined') return false;
      const target = document.querySelector<HTMLElement>(`[data-salary-type="${type}"][data-salary-id="${id}"]`);
      if (!target) return false;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.querySelector<HTMLInputElement>('input[type="text"]')?.focus({ preventScroll: true });
      return true;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!tryScroll()) {
      timer = setTimeout(() => {
        if (tryScroll()) setPendingScrollItem(null);
      }, 80);
      return () => { if (timer) clearTimeout(timer); };
    }
    setPendingScrollItem(null);
    return () => { if (timer) clearTimeout(timer); };
  }, [pendingScrollItem, incomeItems, deductionItems, overtimeItems]);

  const updateItems = (type: ItemType, updater: (items: SalaryItem[]) => SalaryItem[]) => {
    if (type === 'income') setIncomeItems(previous => updater(previous));
    else setDeductionItems(previous => updater(previous));
  };

  const handleLabelChange = (type: ItemType, id: string, nextLabel: string) => {
    updateItems(type, previous => previous.map(item => item.id === id ? { ...item, label: nextLabel } : item));
  };

  const handleValueChange = (type: ItemType, id: string, value: string) => {
    updateItems(type, previous => previous.map(item => item.id === id ? { ...item, value } : item));
  };

  const handleValueBlur = (type: ItemType, id: string, value: string) => {
    updateItems(type, previous => previous.map(item => item.id === id ? { ...item, value: formatIncomingValue(value) } : item));
  };

  const handleAmountInputFocus = (event: FocusEvent<HTMLInputElement>) => event.target.select();

  const handleAddItem = (type: ItemType) => {
    const newItem = createNewItem(type);
    updateItems(type, previous => [...previous, newItem]);
    setPendingScrollItem({ type, id: newItem.id });
  };

  const handleRemoveItem = (type: ItemType, id: string) => {
    updateItems(type, previous => {
      if (previous.find(item => item.id === id)?.locked) return previous;
      const filtered = previous.filter(item => item.id !== id);
      return filtered.length ? filtered : [createNewItem(type)];
    });
  };

  const updateOvertimeRow = (id: string, patch: Partial<OvertimeFormItem>) => {
    setOvertimeItems(previous => previous.map(row => row.id === id ? { ...row, ...patch } : row));
  };

  const handleOvertimeHoursChange = (id: string, value: string) => updateOvertimeRow(id, { hours: value });
  const handleOvertimeHoursBlur = (id: string, value: string) => {
    const isBlank = String(value ?? '').trim() === '';
    updateOvertimeRow(id, { hours: isBlank ? '' : String(coerceOvertimeHours(value)) });
  };
  const handleOvertimeMultiplierChange = (id: string, value: string) => updateOvertimeRow(id, { multiplier: coerceOvertimeMultiplier(value) });
  const handleAddOvertimeRow = () => {
    const newRow = createOvertimeItem();
    setOvertimeItems(previous => [...previous, newRow]);
    setPendingScrollItem({ type: 'overtime', id: newRow.id });
  };
  const handleRemoveOvertimeRow = (id: string) => setOvertimeItems(previous => previous.filter(row => row.id !== id));

  const saveSalaryData = async () => {
    if (isSaving) return;
    try {
      if (!selectedMonth) {
        showToast('กรุณาเลือกเดือนที่ต้องการก่อน', 'info');
        return;
      }
      if (loadFailed) {
        showToast('โหลดข้อมูลเดือนนี้ไม่สำเร็จ กรุณารีเฟรชหน้าก่อนบันทึก เพื่อป้องกันข้อมูลเดิมหาย', 'error');
        return;
      }
      setIsSaving(true);
      const incomePayload = serializeItemsForSave(incomeItems);
      Object.assign(incomePayload, legacyIncomeKeys);
      if (Object.keys(legacyIncomeLabels).length > 0) {
        incomePayload[LABELS_META_KEY] = { ...(incomePayload[LABELS_META_KEY] as Record<string, string> || {}), ...legacyIncomeLabels };
      }
      const deductionPayload = serializeItemsForSave(deductionItems);
      const overtimePayload = normaliseOvertimeRows(overtimeItems);
      const result = await salaryAPI.save(selectedMonth, incomePayload, deductionPayload, '', overtimePayload);

      if (result.success) {
        try {
          const [yearStr, monthStr] = selectedMonth.split('-');
          const taxItem = deductionItems.find(item => item.key === 'tax');
          const providentItem = deductionItems.find(item => item.key === 'provident_fund');
          const taxValue = taxItem && hasInputValue(taxItem.value) ? parseToNumber(taxItem.value) : undefined;
          const providentValue = providentItem && hasInputValue(providentItem.value) ? parseToNumber(providentItem.value) : undefined;
          await taxAPI.updateMonthlyDeductionFields(yearStr, monthStr.padStart(2, '0'), { tax: taxValue, provident: providentValue, income: totalIncome });
        } catch {
          // Tax sync is best-effort; salary data has already been saved.
        }
        try {
          await incomeAPI.save(selectedMonth, { salary: netIncomeValue });
        } catch (error) {
          console.error('Failed to sync monthly income salary value:', error);
        }
        onSalaryUpdate?.();
        showToast('บันทึกข้อมูลเงินเดือนเรียบร้อย');
      } else {
        showToast('เกิดข้อผิดพลาด: ' + (result.error || 'ไม่สามารถบันทึกได้'), 'error');
      }
    } catch (error) {
      console.error('Error saving salary data:', error);
      showToast('เกิดข้อผิดพลาดในการบันทึกข้อมูล', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const clearAll = () => {
    setIncomeItems(previous => previous.map(item => ({ ...item, value: '' })));
    setDeductionItems(previous => previous.map(item => ({ ...item, value: '' })));
    setOvertimeItems(previous => previous.map(row => ({ ...row, hours: '' })));
  };

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-space-5">
      {!inModal && <h2 className={SECTION_TITLE}>คำนวณเงินเดือน - {selectedMonth ? getThaiMonthName(selectedMonth) : 'กรุณาเลือกเดือน'}</h2>}

      <section className="flex flex-col gap-space-3">
        <div className="flex items-center justify-between gap-space-3"><h3 className={SECTION_TITLE}>รายได้</h3></div>
        <div className="rounded-md border border-border-default bg-surface-1 px-space-4">{incomeItems.map(item => <SalaryItemRow key={item.id} type="income" item={item} typeLabelHint="เช่น ค่า OT พิเศษ" onLabelChange={(id, value) => handleLabelChange('income', id, value)} onValueChange={(id, value) => handleValueChange('income', id, value)} onValueBlur={(id, value) => handleValueBlur('income', id, value)} onAmountFocus={handleAmountInputFocus} onRemove={id => handleRemoveItem('income', id)} removeAriaLabel="รายการรายได้" />)}</div>
        <button type="button" className={`flex min-h-11 w-full items-center justify-center rounded-sm border border-border-interactive bg-surface-2 text-sm font-medium text-primary ${FOCUS_RING}`} onClick={() => handleAddItem('income')}>+ เพิ่มรายการ</button>
        <div className="flex items-center justify-between rounded-sm bg-surface-2 px-space-3 py-space-2"><span className="text-sm text-secondary">รวมรายได้</span><span className="font-numeric text-base font-semibold tabular-nums text-primary">{formatCurrency(sectionIncomeTotal)}</span></div>
      </section>

      <section className="flex flex-col gap-space-3">
        <div className="flex items-center justify-between gap-space-3"><h3 className={SECTION_TITLE}>รายการ OT</h3></div>
        {salaryAmount <= 0 && <p className="m-0 text-xs text-tertiary">กรอกเงินเดือนก่อน แล้วระบบจะคำนวณค่า OT ให้อัตโนมัติ</p>}
        {hasOvertimeRows && <div className="rounded-md border border-border-default bg-surface-1 px-space-4">{overtimeItems.map(row => <OvertimeItemRow key={row.id} row={row} amount={calculateOvertimeRowAmount(row, hourlyRate)} onHoursChange={handleOvertimeHoursChange} onHoursBlur={handleOvertimeHoursBlur} onMultiplierChange={handleOvertimeMultiplierChange} onRemove={handleRemoveOvertimeRow} />)}{legacyOvertime.map(row => <LegacyOvertimeRow key={row.id} row={row} />)}</div>}
        <button type="button" className={`flex min-h-11 w-full items-center justify-center rounded-sm border border-border-interactive bg-surface-2 text-sm font-medium text-primary ${FOCUS_RING}`} onClick={handleAddOvertimeRow}>+ เพิ่มรายการ OT</button>
        {hasOvertimeRows && <div className="flex items-center justify-between rounded-sm bg-surface-2 px-space-3 py-space-2"><span className="text-sm text-secondary">รวม OT</span><span className="font-numeric text-base font-semibold tabular-nums text-primary">{formatBaht(overtimeSectionTotal)}</span></div>}
      </section>

      <section className="flex flex-col gap-space-3">
        <div className="flex items-center justify-between gap-space-3"><h3 className={SECTION_TITLE}>ค่าใช้จ่ายหักออก</h3></div>
        <div className="rounded-md border border-border-default bg-surface-1 px-space-4">{deductionItems.map(item => <SalaryItemRow key={item.id} type="deduction" item={item} typeLabelHint="เช่น เงินกู้กยศ" onLabelChange={(id, value) => handleLabelChange('deduction', id, value)} onValueChange={(id, value) => handleValueChange('deduction', id, value)} onValueBlur={(id, value) => handleValueBlur('deduction', id, value)} onAmountFocus={handleAmountInputFocus} onRemove={id => handleRemoveItem('deduction', id)} removeAriaLabel="รายการค่าใช้จ่ายหักออก" />)}</div>
        <button type="button" className={`flex min-h-11 w-full items-center justify-center rounded-sm border border-border-interactive bg-surface-2 text-sm font-medium text-primary ${FOCUS_RING}`} onClick={() => handleAddItem('deduction')}>+ เพิ่มรายการ</button>
        <div className="flex items-center justify-between rounded-sm bg-surface-2 px-space-3 py-space-2"><span className="text-sm text-secondary">รวมหัก</span><span className="font-numeric text-base font-semibold tabular-nums text-primary">{formatCurrency(totalDeduct)}</span></div>
      </section>

      <div className="rounded-md border border-border-default bg-surface-2 p-space-5 shadow-elev-1">
        <div className="flex items-center justify-between gap-space-3"><span className="text-sm text-secondary">รวมรายได้ทั้งหมด</span><span className="font-numeric text-base tabular-nums text-primary">{formatCurrency(totalIncome)}</span></div>
        <div className="mt-space-1 flex items-center justify-between gap-space-3"><span className="text-sm text-secondary">รวมหัก</span><span className="font-numeric text-base tabular-nums text-primary">{formatCurrency(totalDeduct)}</span></div>
        <div className="my-space-3 border-t border-border-subtle" />
        <div className="text-center"><p className="m-0 text-sm font-medium text-secondary">เงินได้สุทธิ</p><p className="font-numeric m-0 text-3xl tabular-nums text-primary">{formatCurrency(netIncomeValue)}</p></div>
      </div>

      {footerTarget ? createPortal(<SalaryActionButtons clearAll={clearAll} saveSalaryData={saveSalaryData} isSaving={isSaving} />, footerTarget) : <SalaryActionButtons clearAll={clearAll} saveSalaryData={saveSalaryData} isSaving={isSaving} />}
    </div>
  );
}