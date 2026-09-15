/**
 * คอมโพเนนต์: SalaryCalculator
 * ฟอร์มคำนวณเงินเดือน รายรับ/รายหัก และภาษีรายเดือน
 * ดึงข้อมูลจาก API และสรุปผลให้ผู้ใช้
 *
 * Graphite redesign (SalaryModal/SalaryCalculator pass) — Tailwind only, เลิก import
 * SalaryCalculator.module.css (sole owner ของไฟล์นั้น, ลบไฟล์นี้ไปพร้อมกันในคอมมิตนี้ — ADR-019 rule 5)
 *
 * เลย์เอาต์เปลี่ยนจาก 2 คอลัมน์ (รายได้ | รายการหัก เคียงข้างกัน) เป็นคอลัมน์เดียว (C1, max 680px)
 * ตาม UX_SPEC §9's SalaryModal/SalaryCalculator.js entry: รายการรายได้ → รายการหัก → เงินได้สุทธิ
 * (ฮีโร่ text-3xl เดียวของโมดัลนี้) เรียงต่อกันทุก breakpoint — นี่คือการเปลี่ยนเลย์เอาต์จริง ไม่ใช่แค่
 * retint ของกริด 2 คอลัมน์เดิม (อ่านตรงตามตัวสเปก ไม่ใช่การตีความ)
 *
 * รายการรายได้/รายการหักทั้งสองชุดเป็น C11 (editable list) — คอมโพเนนต์นี้คือ reference implementation
 * ของ primitive นี้ (UX_SPEC §5.1): K12 (เพิ่มแถวใหม่ไม่ว่าง), K13 (key คงที่ ไม่ใช่ index), K14
 * (แยก onChange ดิบ / onBlur ค่อยจัด format) ผ่านอยู่แล้วในโค้ดเดิม — พาสนี้แค่คงพฤติกรรมเดิมไว้ผ่านการ
 * ปรับ markup/className เท่านั้น ไม่แตะ logic
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { formatCurrency, parseAndFormat, parseToNumber } from '../../shared/utils/frontend/numberUtils';
import { salaryAPI, incomeAPI, taxAPI } from '../../shared/utils/frontend/apiUtils';
import { showToast } from '../../shared/utils/frontend/toast';

// ฟังก์ชันสำหรับแปลงเดือนเป็นชื่อภาษาไทย
const getThaiMonthName = (monthStr) => {
  if (!monthStr) return '';
  const [year, month] = monthStr.split('-');
  const monthNames = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];
  return `${monthNames[parseInt(month) - 1]} ${year}`;
};

const salaryKeyThaiMapping = {
  salary: 'เงินเดือน',
  overtime_1x: 'ค่าล่วงเวลา 1 เท่า',
  overtime_1_5x: 'ค่าล่วงเวลา 1.5 เท่า',
  overtime_2x: 'ค่าล่วงเวลา 2 เท่า',
  overtime_3x: 'ค่าล่วงเวลา 3 เท่า',
  overtime_other: 'ค่าล่วงเวลาอื่นๆ',
  bonus: 'โบนัส',
  other_income: 'เงินได้อื่นๆ',
  provident_fund: 'หักกองทุนสำรองเลี้ยงชีพ',
  social_security: 'หักสมทบประกันสังคม',
  tax: 'หักภาษี'
};

const LABELS_META_KEY = '__labels';
const incomePresetKeys = [
  'salary',
  'overtime_1x',
  'overtime_1_5x',
  'overtime_2x',
  'overtime_3x',
  'overtime_other',
  'bonus',
  'other_income'
];
const deductionPresetKeys = ['provident_fund', 'social_security', 'tax'];

const buildPresetItems = (keys) =>
  keys.map((key) => ({
    id: key,
    key,
    label: salaryKeyThaiMapping[key] || 'รายการใหม่',
    value: ''
  }));

const generateItemId = (prefix) => {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${prefix}_${stamp}`;
};

const createNewItem = (type) => {
  const id = generateItemId(type);
  return {
    id,
    key: id,
    label: type === 'income' ? 'รายได้ใหม่' : 'รายการหักใหม่',
    value: ''
  };
};

const formatIncomingValue = (rawValue) => {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return '';
  }
  return parseAndFormat(rawValue);
};

const isNumericValue = (value) => {
  if (typeof value === 'number') return true;
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return false;
};

const buildItemsFromSource = (sectionData, presetKeys, type) => {
  if (!sectionData || typeof sectionData !== 'object') {
    return buildPresetItems(presetKeys);
  }

  const labelsMap =
    sectionData[LABELS_META_KEY] && typeof sectionData[LABELS_META_KEY] === 'object'
      ? sectionData[LABELS_META_KEY]
      : {};

  const items = [];
  const seenKeys = new Set();

  // แสดงเฉพาะ preset items ที่มีค่าจริง (ไม่ใช่ 0 หรือว่าง)
  presetKeys.forEach((key) => {
    seenKeys.add(key);
    const hasValue = Object.prototype.hasOwnProperty.call(sectionData, key);
    const rawValue = sectionData[key];
    const numValue = parseToNumber(rawValue);

    // เพิ่มเฉพาะรายการที่มีค่ามากกว่า 0
    if (hasValue && numValue > 0) {
      items.push({
        id: key,
        key,
        label: labelsMap[key] || salaryKeyThaiMapping[key] || 'รายการใหม่',
        value: formatIncomingValue(rawValue)
      });
    }
  });

  // เพิ่มรายการที่ไม่ใช่ preset (custom items)
  Object.entries(sectionData)
    .filter(([key, value]) => key !== LABELS_META_KEY && !seenKeys.has(key) && isNumericValue(value))
    .forEach(([key, value]) => {
      const numValue = parseToNumber(value);
      if (numValue > 0) {
        items.push({
          id: key,
          key,
          label: labelsMap[key] || 'รายการใหม่',
          value: formatIncomingValue(value)
        });
        seenKeys.add(key);
      }
    });

  return items.length ? items : [createNewItem(type)];
};

const serializeItemsForSave = (items) => {
  const values = {};
  const labels = {};
  items.forEach((item) => {
    const numValue = parseToNumber(item.value);
    // บันทึกเฉพาะรายการที่มีค่ามากกว่า 0
    if (numValue > 0) {
      values[item.key] = numValue;
      labels[item.key] = item.label?.trim() || 'รายการใหม่';
    }
  });
  // บันทึก labels เฉพาะเมื่อมีรายการ
  if (Object.keys(labels).length > 0) {
    values[LABELS_META_KEY] = labels;
  }
  return values;
};

const sumItems = (items) => items.reduce((sum, item) => sum + parseToNumber(item.value), 0);
const hasInputValue = (value) => String(value ?? '').trim() !== '';

// ── Graphite design tokens (ตัวคงที่เดียวกับ CreditCardForm.js/pages/reports.js) ──────────────────
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const INPUT = `min-h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-base text-primary outline-none transition-colors duration-fast ease-graphite focus:border-accent ${FOCUS_RING}`;
const FIELD_LABEL = 'text-xs font-medium text-tertiary';
const SECTION_TITLE = 'm-0 text-xl font-semibold text-primary';

/**
 * แถวหนึ่งของ C11 editable list — ชื่อรายการ + จำนวนเงิน + ปุ่มลบ
 * เก็บ data-salary-type/data-salary-id ไว้บน container เดิม — pendingScrollItem effect (ด้านล่าง)
 * ค้นหาแถวใหม่ด้วย selector นี้ ไม่ใช่ของตกแต่ง (ห้ามถอดออกตอนปรับ markup)
 */
function SalaryItemRow({
  type, item, typeLabelHint, onLabelChange, onValueChange, onValueBlur, onAmountFocus, onRemove, removeAriaLabel
}) {
  return (
    <div
      className="flex flex-col gap-space-2 border-b border-border-subtle py-space-3 last:border-b-0"
      data-salary-type={type}
      data-salary-id={item.id}
    >
      <div className="flex items-end gap-space-2">
        <div className="flex flex-1 flex-col gap-space-1">
          <span className={FIELD_LABEL}>ชื่อรายการ</span>
          <input
            type="text"
            value={item.label}
            onChange={(e) => onLabelChange(item.id, e.target.value)}
            placeholder={typeLabelHint}
            className={INPUT}
            aria-label={`แก้ไขชื่อ${removeAriaLabel}`}
          />
        </div>
        <button
          type="button"
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-secondary hover:bg-surface-2 hover:text-neg ${FOCUS_RING}`}
          onClick={() => onRemove(item.id)}
          aria-label={`ลบ${removeAriaLabel}นี้`}
        >
          ✕
        </button>
      </div>
      <div className="flex flex-col gap-space-1">
        <span className={FIELD_LABEL}>จำนวนเงิน</span>
        <input
          type="text"
          value={item.value}
          onChange={(e) => onValueChange(item.id, e.target.value)}
          onBlur={(e) => onValueBlur(item.id, e.target.value)}
          onFocus={onAmountFocus}
          placeholder="0.00"
          className={`${INPUT} font-numeric text-lg font-semibold tabular-nums`}
          aria-label={`จำนวนเงิน${removeAriaLabel}`}
          inputMode="decimal"
        />
      </div>
    </div>
  );
}

const SalaryCalculator = ({ selectedMonth, onSalaryUpdate, inModal = false, footerTarget = null }) => {
  const [incomeItems, setIncomeItems] = useState(() => buildPresetItems(incomePresetKeys));
  const [deductionItems, setDeductionItems] = useState(() => buildPresetItems(deductionPresetKeys));
  const [pendingScrollItem, setPendingScrollItem] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [calculatedResults, setCalculatedResults] = useState({
    รวมรายได้: 0,
    รวมหัก: 0,
    เงินได้สุทธิ: 0
  });

  useEffect(() => {
    const totalIncome = sumItems(incomeItems);
    const totalDeduction = sumItems(deductionItems);
    setCalculatedResults({
      รวมรายได้: totalIncome,
      รวมหัก: totalDeduction,
      เงินได้สุทธิ: totalIncome - totalDeduction
    });
  }, [incomeItems, deductionItems]);

  useEffect(() => {
    if (!selectedMonth) {
      setIncomeItems(buildPresetItems(incomePresetKeys));
      setDeductionItems(buildPresetItems(deductionPresetKeys));
      return;
    }
    loadSalaryData(selectedMonth);
  }, [selectedMonth]);

  useEffect(() => {
    if (!pendingScrollItem?.id || !pendingScrollItem?.type) return;
    const { id, type } = pendingScrollItem;

    const tryScroll = () => {
      if (typeof document === 'undefined') return false;
      const selector = `[data-salary-type="${type}"][data-salary-id="${id}"]`;
      const target = document.querySelector(selector);
      if (!target) return false;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const firstInput = target.querySelector('input[type="text"]');
      if (firstInput && typeof firstInput.focus === 'function') {
        firstInput.focus({ preventScroll: true });
      }
      return true;
    };

    let timer = null;
    const done = tryScroll();
    if (!done) {
      timer = setTimeout(() => {
        if (tryScroll()) {
          setPendingScrollItem(null);
        }
      }, 80);
      return () => clearTimeout(timer);
    }
    setPendingScrollItem(null);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [pendingScrollItem, incomeItems, deductionItems]);

  const loadSalaryData = async (month) => {
    try {
      const data = await salaryAPI.getByMonth(month);
      setIncomeItems(buildItemsFromSource(data?.income, incomePresetKeys, 'income'));
      setDeductionItems(buildItemsFromSource(data?.deduct, deductionPresetKeys, 'deduction'));
    } catch (error) {
      console.error('Error loading salary data:', error);
      setIncomeItems(buildPresetItems(incomePresetKeys));
      setDeductionItems(buildPresetItems(deductionPresetKeys));
    }
  };

  const updateItems = (type, updater) => {
    if (type === 'income') {
      setIncomeItems((prev) => updater(prev));
      return;
    }
    setDeductionItems((prev) => updater(prev));
  };

  const handleLabelChange = (type, id, nextLabel) => {
    updateItems(type, (prev) => prev.map((item) => (item.id === id ? { ...item, label: nextLabel } : item)));
  };

  const handleValueChange = (type, id, value) => {
    updateItems(type, (prev) => prev.map((item) => (item.id === id ? { ...item, value } : item)));
  };

  const handleValueBlur = (type, id, value) => {
    updateItems(type, (prev) =>
      prev.map((item) => (item.id === id ? { ...item, value: formatIncomingValue(value) } : item))
    );
  };

  const handleAmountInputFocus = (event) => {
    event.target.select();
  };

  const handleAddItem = (type) => {
    const newItem = createNewItem(type);
    updateItems(type, (prev) => [...prev, newItem]);
    setPendingScrollItem({ type, id: newItem.id });
  };

  const handleRemoveItem = (type, id) => {
    updateItems(type, (prev) => {
      const filtered = prev.filter((item) => item.id !== id);
      if (filtered.length === 0) {
        return [createNewItem(type)];
      }
      return filtered;
    });
  };

  const saveSalaryData = async () => {
    if (isSaving) return;
    try {
      if (!selectedMonth) {
        showToast('กรุณาเลือกเดือนที่ต้องการก่อน', 'info');
        return;
      }

      setIsSaving(true);
      const incomePayload = serializeItemsForSave(incomeItems);
      const deductionPayload = serializeItemsForSave(deductionItems);
      const totalIncome = sumItems(incomeItems);
      const totalDeduct = sumItems(deductionItems);
      const netIncomeValue = totalIncome - totalDeduct;

      const result = await salaryAPI.save(selectedMonth, incomePayload, deductionPayload);

      if (result.success) {
        try {
          const [yearStr, monthStr] = selectedMonth.split('-');
          const year = yearStr;
          const month = monthStr.padStart(2, '0');
          const taxItem = deductionItems.find((item) => item.key === 'tax');
          const providentItem = deductionItems.find((item) => item.key === 'provident_fund');
          const taxValue = taxItem && hasInputValue(taxItem.value) ? parseToNumber(taxItem.value) : undefined;
          const providentValue = providentItem && hasInputValue(providentItem.value)
            ? parseToNumber(providentItem.value)
            : undefined;
          await taxAPI.updateMonthlyDeductionFields(year, month, {
            tax: taxValue,
            provident: providentValue,
            income: totalIncome
          });
        } catch (e) {
          // ไม่ต้องแจ้ง error ให้ user
        }
        try {
          await incomeAPI.save(selectedMonth, { salary: netIncomeValue });
        } catch (e) {
          console.error('Failed to sync monthly income salary value:', e);
        }
        // เรียก callback เพื่อให้ parent component อัพเดต
        if (onSalaryUpdate) {
          onSalaryUpdate();
        }
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
    setIncomeItems((prev) => prev.map((item) => ({ ...item, value: '' })));
    setDeductionItems((prev) => prev.map((item) => ({ ...item, value: '' })));
  };

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-space-5">
      {/* เมื่ออยู่ใน modal ตัว shell (SalaryModal) เป็นคนแสดงหัวข้อ/เดือนแทนแล้ว — ไม่งั้นซ้อนกัน 2 หัวข้อ */}
      {!inModal && (
        <h2 className={SECTION_TITLE}>
          คำนวณเงินเดือน - {selectedMonth ? getThaiMonthName(selectedMonth) : 'กรุณาเลือกเดือน'}
        </h2>
      )}

      {/* C11 editable list #1 — รายได้ (single column ตาม UX_SPEC §9, ไม่ใช่กริด 2 คอลัมน์เดิม) */}
      <section className="flex flex-col gap-space-3">
        <div className="flex items-center justify-between gap-space-3">
          <h3 className={SECTION_TITLE}>รายได้</h3>
        </div>
        <div className="rounded-md border border-border-default bg-surface-1 px-space-4">
          {incomeItems.map((item) => (
            <SalaryItemRow
              key={item.id}
              type="income"
              item={item}
              typeLabelHint="เช่น ค่า OT พิเศษ"
              onLabelChange={(id, value) => handleLabelChange('income', id, value)}
              onValueChange={(id, value) => handleValueChange('income', id, value)}
              onValueBlur={(id, value) => handleValueBlur('income', id, value)}
              onAmountFocus={handleAmountInputFocus}
              onRemove={(id) => handleRemoveItem('income', id)}
              removeAriaLabel="รายการรายได้"
            />
          ))}
        </div>
        <button
          type="button"
          className={`flex min-h-11 w-full items-center justify-center rounded-sm border border-border-interactive bg-surface-2 text-sm font-medium text-primary ${FOCUS_RING}`}
          onClick={() => handleAddItem('income')}
        >
          + เพิ่มรายการ
        </button>
        <div className="flex items-center justify-between rounded-sm bg-surface-2 px-space-3 py-space-2">
          <span className="text-sm text-secondary">รวมรายได้</span>
          <span className="font-numeric text-base font-semibold tabular-nums text-primary">
            {formatCurrency(calculatedResults.รวมรายได้)}
          </span>
        </div>
      </section>

      {/* C11 editable list #2 — รายการหัก */}
      <section className="flex flex-col gap-space-3">
        <div className="flex items-center justify-between gap-space-3">
          <h3 className={SECTION_TITLE}>ค่าใช้จ่ายหักออก</h3>
        </div>
        <div className="rounded-md border border-border-default bg-surface-1 px-space-4">
          {deductionItems.map((item) => (
            <SalaryItemRow
              key={item.id}
              type="deduction"
              item={item}
              typeLabelHint="เช่น เงินกู้กยศ"
              onLabelChange={(id, value) => handleLabelChange('deduction', id, value)}
              onValueChange={(id, value) => handleValueChange('deduction', id, value)}
              onValueBlur={(id, value) => handleValueBlur('deduction', id, value)}
              onAmountFocus={handleAmountInputFocus}
              onRemove={(id) => handleRemoveItem('deduction', id)}
              removeAriaLabel="รายการค่าใช้จ่ายหักออก"
            />
          ))}
        </div>
        <button
          type="button"
          className={`flex min-h-11 w-full items-center justify-center rounded-sm border border-border-interactive bg-surface-2 text-sm font-medium text-primary ${FOCUS_RING}`}
          onClick={() => handleAddItem('deduction')}
        >
          + เพิ่มรายการ
        </button>
        <div className="flex items-center justify-between rounded-sm bg-surface-2 px-space-3 py-space-2">
          <span className="text-sm text-secondary">รวมหัก</span>
          <span className="font-numeric text-base font-semibold tabular-nums text-primary">
            {formatCurrency(calculatedResults.รวมหัก)}
          </span>
        </div>
      </section>

      {/* เงินได้สุทธิ — ฮีโร่ text-3xl เดียวของโมดัลนี้ (K16: อัปเดตทุก render ก่อนบันทึก ไม่ใช่แค่ตอนกดบันทึก) */}
      <div className="rounded-md border border-border-default bg-surface-2 p-space-5 text-center shadow-elev-1">
        <p className="m-0 text-sm font-medium text-secondary">เงินได้สุทธิ</p>
        <p className="font-numeric m-0 text-3xl tabular-nums text-primary">
          {formatCurrency(calculatedResults.เงินได้สุทธิ)}
        </p>
      </div>

      {/* ปุ่มจัดการ — บันทึกทันทีเมื่อกด ไม่ผูกกับ triggerSave ของ Save All อีกต่อไป (Amendment A3)
          state/handler (isSaving, clearAll, saveSalaryData) เป็นของ component นี้เสมอ ไม่ว่าปุ่มจะ
          render อยู่ตรงนี้ (inline) หรือถูก portal ไปที่ footer ของ SalaryModal ก็ตาม (M-3) —
          footerTarget มีค่าเฉพาะตอนถูกเรียกจาก SalaryModal ที่ footer <div> ของมัน mount เสร็จแล้ว
          เท่านั้น (ดู SalaryModal.js's setFooterNode) ไม่ใช่ path ที่ Jest ของไฟล์นี้ใช้เลย —
          render(<SalaryCalculator />) แบบไม่มี footerTarget (รวมถึง inModal เฉยๆ ไม่มี footerTarget)
          จะ render ปุ่มชุดนี้ inline เหมือนเดิมทุกประการ (M-4) */}
      {footerTarget
        ? createPortal(<SalaryActionButtons clearAll={clearAll} saveSalaryData={saveSalaryData} isSaving={isSaving} />, footerTarget)
        : <SalaryActionButtons clearAll={clearAll} saveSalaryData={saveSalaryData} isSaving={isSaving} />}
    </div>
  );
};

/**
 * ปุ่ม ล้างข้อมูล / บันทึกเงินเดือน — แยกออกมาเป็นคอมโพเนนต์ย่อยเพื่อใช้ซ้ำได้ทั้ง path inline
 * และ path portal (footerTarget) โดยไม่มี markup สองชุด (M-1: ต้องมีปุ่มแต่ละอันแค่ชุดเดียวในเอกสาร
 * เสมอ ไม่ว่าจะ render ทางไหน) — ไม่ถือ state เอง รับมาจาก SalaryCalculator ทั้งหมด (M-3)
 */
function SalaryActionButtons({ clearAll, saveSalaryData, isSaving }) {
  return (
    <div className="flex flex-col-reverse gap-space-3 sm:flex-row">
      <button
        type="button"
        onClick={clearAll}
        className={`min-h-11 flex-1 rounded-sm border border-border-interactive bg-surface-2 text-sm font-medium text-primary ${FOCUS_RING}`}
        aria-label="ล้างข้อมูล"
      >
        ล้างข้อมูล
      </button>
      <button
        type="button"
        onClick={saveSalaryData}
        className={`min-h-11 flex-1 rounded-sm bg-accent text-sm font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
        aria-label="บันทึกเงินเดือน"
        disabled={isSaving}
      >
        {isSaving ? 'กำลังบันทึก...' : 'บันทึกเงินเดือน'}
      </button>
    </div>
  );
}

export default SalaryCalculator;
