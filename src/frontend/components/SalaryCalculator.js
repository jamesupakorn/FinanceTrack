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
 * Salary OT Calculator (ADR-020): เพิ่ม section "รายการ OT" คั่นระหว่างรายได้กับรายการหัก ผู้ใช้กรอก
 * "ชั่วโมง + ตัวคูณ" แล้วระบบคิดยอดเงินให้จากเงินเดือนของเดือนนั้นกับจำนวนวันจริงของเดือน — คณิตศาสตร์
 * ทั้งหมดอยู่ใน overtimeUtils.ts ไฟล์เดียวกับที่ pages/api/salary.js ใช้ ตัวเลขที่เห็นกับที่บันทึกจึงต่างกันไม่ได้
 * แถวเงินเดือนถูกล็อก (ลบ/เปลี่ยนชื่อไม่ได้) เพราะเป็นตัวหารของสูตร และยอด OT แบบยอดคงที่ของเดิมแสดงเป็น
 * แถวอ่านอย่างเดียว "ข้อมูลเดิม" โดยค่าจริงยังอยู่ใน income ที่เดิมตลอดไป
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

// ป้าย OT แบบยอดคงที่ของเดิม (5 คีย์) ย้ายไปอยู่ที่ LEGACY_OVERTIME_LABELS ใน overtimeUtils.ts แล้ว —
// ที่นี่ไม่ต้องรู้จักมันอีก เพราะแถวเดิมมาจาก GET `overtimeLegacy` ซึ่งพกป้ายของตัวเองมาด้วย
const salaryKeyThaiMapping = {
  salary: 'เงินเดือน',
  bonus: 'โบนัส',
  other_income: 'เงินได้อื่นๆ',
  provident_fund: 'หักกองทุนสำรองเลี้ยงชีพ',
  social_security: 'หักสมทบประกันสังคม',
  tax: 'หักภาษี'
};

const LABELS_META_KEY = '__labels';
const SALARY_KEY = 'salary';
// 5 คีย์ OT แบบยอดคงที่ถูกถอดออกจาก preset แล้ว (AC-OT-17) — และต้องกันไม่ให้หลุดไปเป็น custom row ด้วย (V-5)
const incomePresetKeys = [SALARY_KEY, 'bonus', 'other_income'];
const deductionPresetKeys = ['provident_fund', 'social_security', 'tax'];
const LEGACY_OVERTIME_KEY_SET = new Set(LEGACY_OVERTIME_KEYS);

const buildPresetItems = (keys) =>
  keys.map((key) => ({
    id: key,
    key,
    label: salaryKeyThaiMapping[key] || 'รายการใหม่',
    value: '',
    // แถวเงินเดือนคือ "ตัวหาร" ของสูตร OT — ลบ/เปลี่ยนชื่อไม่ได้ (BR-OT-005)
    locked: key === SALARY_KEY
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

/**
 * บังคับให้รายการรายได้มีแถว "เงินเดือน" ที่ล็อกไว้เป็นแถวแรกเสมอ (V-4 / AC-OT-04)
 * ซ่อนปุ่ม ✕ อย่างเดียวไม่พอ: buildItemsFromSource ตัด preset ที่ค่าเป็น 0/ไม่มีค่าออก เดือนเก่าที่ไม่มีคีย์
 * salary จึงจะไม่มีตัวหารของสูตร OT เลย
 */
const withLockedSalaryRow = (items) => {
  const index = items.findIndex((item) => item.key === SALARY_KEY);
  if (index === -1) {
    return [{ id: SALARY_KEY, key: SALARY_KEY, label: salaryKeyThaiMapping[SALARY_KEY], value: '', locked: true }, ...items];
  }
  const existing = items[index];
  const rest = items.filter((_, i) => i !== index);
  return [{ ...existing, label: salaryKeyThaiMapping[SALARY_KEY], locked: true }, ...rest];
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
  // คีย์ OT เดิมถูกกันออกตรงนี้ (V-5) — ถ้าไม่กัน การถอดมันออกจาก incomePresetKeys จะทำให้มันเลื่อนขั้นเป็น
  // custom row ที่แก้ไข/ลบได้ ซึ่งตรงข้ามกับ "ข้อมูลเดิมอ่านอย่างเดียว" พอดี (AC-OT-12)
  Object.entries(sectionData)
    .filter(([key, value]) =>
      key !== LABELS_META_KEY && !seenKeys.has(key) && !LEGACY_OVERTIME_KEY_SET.has(key) && isNumericValue(value))
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

  if (type === 'income') {
    return withLockedSalaryRow(items);
  }
  return items.length ? items : [createNewItem(type)];
};

/**
 * ดึงคีย์ OT เดิมและป้ายของมันออกจาก income ที่โหลดมา เพื่อส่งกลับไปตอนบันทึก "ตามเดิมทุกตัวอักษร" (V-2)
 * serializeItemsForSave ไม่ผลิตคีย์เหล่านี้แล้ว และ POST เขียนทับ income ทั้งก้อน — ถ้าไม่เก็บไว้ตรงนี้
 * การเปิดเดือนเก่าแล้วกดบันทึกเฉย ๆ จะลบยอด OT เดิมทิ้งถาวร (R-1)
 * เก็บเฉพาะคีย์/ป้ายที่ "มีอยู่จริง" ในเอกสาร ไม่ประดิษฐ์ป้ายขึ้นใหม่ (AC-OT-13 = ต้องไม่เปลี่ยนแปลง)
 */
const pickLegacyIncomeData = (income) => {
  const values = {};
  const labels = {};
  if (!income || typeof income !== 'object') return { values, labels };

  const labelsMap =
    income[LABELS_META_KEY] && typeof income[LABELS_META_KEY] === 'object' ? income[LABELS_META_KEY] : {};

  LEGACY_OVERTIME_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(income, key)) return;
    values[key] = income[key];
    if (typeof labelsMap[key] === 'string' && labelsMap[key].trim()) {
      labels[key] = labelsMap[key];
    }
  });
  return { values, labels };
};

/** แถว OT ที่โหลดมาจาก server → รูปแบบที่ฟอร์มใช้ (hours เป็นสตริง เพื่อให้พิมพ์ได้ตาม K14) */
const buildOvertimeItemsFromSource = (raw) =>
  normaliseOvertimeRows(raw).map((row) => ({
    id: row.id,
    hours: row.hours > 0 ? String(row.hours) : '',
    multiplier: row.multiplier
  }));

const createOvertimeItem = () => ({
  id: generateItemId('ot'),
  hours: '',
  // 1.5 เท่าคือ OT วันทำงานปกติ = ค่าที่ผู้ใช้เลือกบ่อยที่สุด (UX spec §4.4)
  multiplier: 1.5
});

/** ยอด OT แสดงเป็นจำนวนเต็มบาทเสมอ — ไม่มีทศนิยมให้แสดง (BR-OT-004) */
const formatBaht = (value) => Math.round(parseToNumber(value)).toLocaleString('en-US');

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
      {/* แถวที่ล็อก (เงินเดือน): ชื่อเป็นข้อความคงที่ และ "ไม่ render ปุ่ม ✕ เลย" ไม่ใช่ disabled —
          ปุ่มที่กดแล้วไม่เกิดอะไรขึ้นชวนให้ผู้ใช้ถาม ปุ่มที่ไม่มีอยู่ไม่ทำให้เกิดคำถาม (UX spec §3) */}
      {item.locked ? (
        <div className="flex items-end gap-space-2">
          <span className="flex-1 text-base text-primary">{item.label}</span>
        </div>
      ) : (
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
      )}
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
          aria-label={item.locked ? `จำนวนเงิน${item.label}` : `จำนวนเงิน${removeAriaLabel}`}
          inputMode="decimal"
        />
      </div>
    </div>
  );
}

/**
 * แถว OT หนึ่งแถว — ชั่วโมง + ตัวคูณ + ยอดเงิน (คำนวณ) + ปุ่มลบ
 * ไม่มีช่องชื่อรายการโดยตั้งใจ: ตัวตนของแถว OT คือ "ตัวคูณ" ของมัน (ข้อยกเว้น C11 ข้อ 2, UX spec §7)
 * ยอดเงินเป็นข้อความ ไม่ใช่ input ที่ disabled — กล่อง input สีจางบอกว่า "เดี๋ยวแก้ได้" ส่วนข้อความบอกว่า
 * "นี่คือผลลัพธ์" (UX spec §4.2)
 */
function OvertimeItemRow({ row, amount, onHoursChange, onHoursBlur, onMultiplierChange, onRemove }) {
  return (
    <div
      className="flex flex-col gap-space-2 border-b border-border-subtle py-space-3 last:border-b-0"
      data-salary-type="overtime"
      data-salary-id={row.id}
    >
      <div className="flex items-end gap-space-2">
        <div className="flex w-24 flex-col gap-space-1">
          <span className={FIELD_LABEL}>ชั่วโมง</span>
          <input
            type="text"
            value={row.hours}
            onChange={(e) => onHoursChange(row.id, e.target.value)}
            onBlur={(e) => onHoursBlur(row.id, e.target.value)}
            placeholder="0"
            className={`${INPUT} font-numeric tabular-nums`}
            aria-label="จำนวนชั่วโมง OT"
            inputMode="decimal"
          />
        </div>
        <div className="flex flex-1 flex-col gap-space-1">
          <span className={FIELD_LABEL}>ตัวคูณ</span>
          <select
            value={String(row.multiplier)}
            onChange={(e) => onMultiplierChange(row.id, e.target.value)}
            className={INPUT}
            aria-label="ตัวคูณ OT"
          >
            {OT_MULTIPLIERS.map((multiplier) => (
              <option key={multiplier} value={multiplier}>{`${multiplier} เท่า`}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-end gap-space-2">
        <div className="flex flex-1 flex-col gap-space-1">
          <span className={FIELD_LABEL}>จำนวนเงิน</span>
          <span className="font-numeric text-lg font-semibold tabular-nums text-primary">{formatBaht(amount)}</span>
        </div>
        <button
          type="button"
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-secondary hover:bg-surface-2 hover:text-neg ${FOCUS_RING}`}
          onClick={() => onRemove(row.id)}
          aria-label="ลบรายการ OT นี้"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/**
 * แถว OT แบบยอดคงที่ของเดิม — อ่านอย่างเดียวทั้งแถว ไม่มีอะไรให้กด
 * ชิป "ข้อมูลเดิม" คือสิ่งที่สื่อความหมาย ไม่ใช่ opacity — สถานะต้องไม่สื่อด้วยสี/น้ำหนักอย่างเดียว (ADR-006)
 */
function LegacyOvertimeRow({ row }) {
  return (
    <div
      className="flex flex-col gap-space-2 border-b border-border-subtle py-space-3 opacity-70 last:border-b-0"
      data-salary-type="overtime-legacy"
      data-salary-id={row.id}
    >
      <div className="flex flex-wrap items-center gap-space-2">
        <span className="whitespace-nowrap rounded-full bg-surface-2 px-space-2 py-space-1 text-xs font-medium text-tertiary">
          ข้อมูลเดิม
        </span>
        <span className="text-sm text-secondary">{row.label}</span>
      </div>
      <span className="font-numeric text-lg font-semibold tabular-nums text-primary">{formatBaht(row.amount)}</span>
    </div>
  );
}

const SalaryCalculator = ({ selectedMonth, onSalaryUpdate, inModal = false, footerTarget = null }) => {
  const [incomeItems, setIncomeItems] = useState(() => buildPresetItems(incomePresetKeys));
  const [deductionItems, setDeductionItems] = useState(() => buildPresetItems(deductionPresetKeys));
  const [overtimeItems, setOvertimeItems] = useState([]);
  const [legacyOvertime, setLegacyOvertime] = useState([]);
  // คีย์ OT เดิมใน income เก็บไว้เพื่อส่งกลับตอนบันทึกเท่านั้น ไม่เคยถูกแก้ไขและไม่เคยแสดงเป็นแถวรายได้ (V-2)
  const [legacyIncomeKeys, setLegacyIncomeKeys] = useState({});
  const [legacyIncomeLabels, setLegacyIncomeLabels] = useState({});
  const [pendingScrollItem, setPendingScrollItem] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  // โหลดเดือนนี้ล้มเหลวหรือไม่ — ถ้าล้มเหลว ฟอร์มจะดูเหมือนเดือนว่างทั้งที่ legacyIncomeKeys ถูกล้างไปแล้ว
  // การบันทึกทับตอนนั้นจะลบยอด OT เดิมถาวร (R-1 / AC-OT-13) จึงต้องบล็อกไว้ก่อน (m-11)
  const [loadFailed, setLoadFailed] = useState(false);

  // ── ยอดรวมทั้งหมดเป็นค่า derived ต่อ render ไม่ใช่ state (K16) ──────────────────────────────────
  // salaryAmount ต้องอ่านจาก state ของฟอร์มทุก render ห้าม cache — การ cache คือทางเดียวที่จะทำให้ยอด OT
  // ค้างอยู่กับเงินเดือนค่าเก่า (spec §The formula)
  const salaryAmount = parseToNumber(incomeItems.find((item) => item.key === SALARY_KEY)?.value ?? '');
  const hourlyRate = getSalaryHourlyRate(salaryAmount, selectedMonth || '');
  const computedOvertimeTotal = calculateOvertimeTotal(overtimeItems, salaryAmount, selectedMonth || '');
  // ยอดเดิมแบบไม่ปัดใช้กับยอดรวมรายได้ (ต้องเท่ากับ total_income ฝั่งเซิร์ฟเวอร์ที่ sum ค่าดิบใน income)
  const legacyOvertimeTotal = legacyOvertime.reduce((sum, row) => sum + parseToNumber(row.amount), 0);
  // ยอดรวมของ section OT รวมแถวข้อมูลเดิมด้วย — ยอดรวมที่ไม่นับแถวที่มองเห็นอยู่ในหมวดเดียวกันคือบั๊กข้อมูล
  // ปัดทีละแถวแล้วค่อยรวม (BR-OT-004, m-13) เพื่อให้ "รวม OT" เท่ากับผลรวมของแถวที่แสดงอยู่พอดี
  const overtimeSectionTotal =
    computedOvertimeTotal +
    legacyOvertime.reduce((sum, row) => sum + Math.round(parseToNumber(row.amount)), 0);
  const sectionIncomeTotal = sumItems(incomeItems);
  // เท่ากับ total_income ฝั่งเซิร์ฟเวอร์เสมอ: Σ income (ซึ่งมีคีย์ OT เดิมอยู่ด้วย) + ยอด OT ที่คำนวณได้
  const totalIncome = sectionIncomeTotal + computedOvertimeTotal + legacyOvertimeTotal;
  const totalDeduct = sumItems(deductionItems);
  const netIncomeValue = totalIncome - totalDeduct;
  const hasOvertimeRows = overtimeItems.length > 0 || legacyOvertime.length > 0;

  useEffect(() => {
    setLoadFailed(false);
    if (!selectedMonth) {
      setIncomeItems(buildPresetItems(incomePresetKeys));
      setDeductionItems(buildPresetItems(deductionPresetKeys));
      resetOvertimeState();
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
  }, [pendingScrollItem, incomeItems, deductionItems, overtimeItems]);

  const resetOvertimeState = () => {
    setOvertimeItems([]);
    setLegacyOvertime([]);
    setLegacyIncomeKeys({});
    setLegacyIncomeLabels({});
  };

  const loadSalaryData = async (month) => {
    try {
      const data = await salaryAPI.getByMonth(month);
      setIncomeItems(buildItemsFromSource(data?.income, incomePresetKeys, 'income'));
      setDeductionItems(buildItemsFromSource(data?.deduct, deductionPresetKeys, 'deduction'));
      setOvertimeItems(buildOvertimeItemsFromSource(data?.overtime));
      // overtimeLegacy เป็นฟิลด์ GET-only ที่เซิร์ฟเวอร์ derive จาก income ให้แล้ว (D-1)
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
      // กันเชิงลึก: ปุ่ม ✕ ของแถวที่ล็อกไม่ถูก render อยู่แล้ว แต่ถ้าวันหนึ่งมีฟีเจอร์ "ลบทั้งหมด" กลับมา
      // มันต้องลบตัวหารของสูตร OT ไม่ได้ (BR-OT-005, V-4)
      if (prev.find((item) => item.id === id)?.locked) return prev;
      const filtered = prev.filter((item) => item.id !== id);
      if (filtered.length === 0) {
        return [createNewItem(type)];
      }
      return filtered;
    });
  };

  // ── รายการ OT ────────────────────────────────────────────────────────────────────────────────
  const updateOvertimeRow = (id, patch) => {
    setOvertimeItems((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  // K14: ระหว่างพิมพ์เก็บสตริงดิบไว้ตามนั้น ("7." ต้องพิมพ์ต่อได้) ค่อยจัดให้เรียบร้อยตอน blur
  const handleOvertimeHoursChange = (id, value) => updateOvertimeRow(id, { hours: value });

  const handleOvertimeHoursBlur = (id, value) => {
    const isBlank = String(value ?? '').trim() === '';
    updateOvertimeRow(id, { hours: isBlank ? '' : String(coerceOvertimeHours(value)) });
  };

  const handleOvertimeMultiplierChange = (id, value) => {
    updateOvertimeRow(id, { multiplier: coerceOvertimeMultiplier(value) });
  };

  const handleAddOvertimeRow = () => {
    const newRow = createOvertimeItem();
    setOvertimeItems((prev) => [...prev, newRow]);
    setPendingScrollItem({ type: 'overtime', id: newRow.id });
  };

  // แถว OT ลบได้จนหมดจริง ๆ — ไม่มีการเติมแถวว่างคืนเหมือน income/deduct เพราะเดือนที่ไม่มี OT คือสถานะปกติ
  const handleRemoveOvertimeRow = (id) => {
    setOvertimeItems((prev) => prev.filter((row) => row.id !== id));
  };

  const saveSalaryData = async () => {
    if (isSaving) return;
    try {
      if (!selectedMonth) {
        showToast('กรุณาเลือกเดือนที่ต้องการก่อน', 'info');
        return;
      }

      // ฟอร์มที่ยังโหลดไม่สำเร็จไม่ใช่ตัวแทนของข้อมูลในเดือนนั้น — บันทึกทับจะลบข้อมูลเดิมถาวร (m-11)
      if (loadFailed) {
        showToast('โหลดข้อมูลเดือนนี้ไม่สำเร็จ กรุณารีเฟรชหน้าก่อนบันทึก เพื่อป้องกันข้อมูลเดิมหาย', 'error');
        return;
      }

      setIsSaving(true);
      const incomePayload = serializeItemsForSave(incomeItems);
      // ยอด OT เดิมอยู่ใน income และแก้ไขไม่ได้ — ต้องส่งกลับไปเหมือนเดิมทุกตัวอักษร ไม่งั้น POST ที่เขียนทับ
      // income ทั้งก้อนจะลบมันทิ้งถาวร (V-2 / AC-OT-13) ห้ามเรียก stripLegacyOvertimeKeys บน path นี้
      Object.assign(incomePayload, legacyIncomeKeys);
      // A-7: serializeItemsForSave สร้าง __labels ให้เฉพาะเมื่อมีรายการที่ค่า > 0 — เดือนที่มีแต่ OT เดิม
      // จะไม่มี object นี้เลย ต้องสร้างก่อน merge ไม่งั้นได้ยอดคืนแต่ป้ายหายถาวร
      if (Object.keys(legacyIncomeLabels).length > 0) {
        incomePayload[LABELS_META_KEY] = { ...(incomePayload[LABELS_META_KEY] || {}), ...legacyIncomeLabels };
      }
      const deductionPayload = serializeItemsForSave(deductionItems);
      // normaliseOvertimeRows คือด่านเดียวกับฝั่งเซิร์ฟเวอร์: เหลือแค่ {id, hours, multiplier} (BR-OT-002)
      const overtimePayload = normaliseOvertimeRows(overtimeItems);

      // A-6: overtime เป็นอาร์กิวเมนต์ที่ 5 เท่านั้น ตำแหน่งที่ 4 เป็นของ note — สลับที่แล้วอาร์เรย์แถว OT
      // จะไปลงใน note เงียบ ๆ โดยไม่มี error (V-6)
      const result = await salaryAPI.save(selectedMonth, incomePayload, deductionPayload, '', overtimePayload);

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
    // ล้างเฉพาะชั่วโมง แถวยังอยู่ (K12) และแถวข้อมูลเดิมไม่ถูกแตะต้องเลย
    setOvertimeItems((prev) => prev.map((row) => ({ ...row, hours: '' })));
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
            {formatCurrency(sectionIncomeTotal)}
          </span>
        </div>
      </section>

      {/* รายการ OT — วางไว้ "ใต้" ช่องเงินเดือนโดยตั้งใจ เพราะยอด OT คำนวณจากเงินเดือน ผู้ใช้ที่ไล่อ่าน
          จากบนลงล่างจึงเจอเหตุก่อนผล (UX spec §2) */}
      <section className="flex flex-col gap-space-3">
        <div className="flex items-center justify-between gap-space-3">
          <h3 className={SECTION_TITLE}>รายการ OT</h3>
        </div>
        {/* ไม่ใช่ error — ผู้ใช้แค่ยังไม่ได้กรอกเงินเดือน สีแดง/เหลืองตรงนี้จะสอนให้ผู้ใช้เมินคำเตือนจริง */}
        {salaryAmount <= 0 && (
          <p className="m-0 text-xs text-tertiary">กรอกเงินเดือนก่อน แล้วระบบจะคำนวณค่า OT ให้อัตโนมัติ</p>
        )}
        {hasOvertimeRows && (
          <div className="rounded-md border border-border-default bg-surface-1 px-space-4">
            {overtimeItems.map((row) => (
              <OvertimeItemRow
                key={row.id}
                row={row}
                amount={calculateOvertimeRowAmount(row, hourlyRate)}
                onHoursChange={handleOvertimeHoursChange}
                onHoursBlur={handleOvertimeHoursBlur}
                onMultiplierChange={handleOvertimeMultiplierChange}
                onRemove={handleRemoveOvertimeRow}
              />
            ))}
            {/* แถวข้อมูลเดิมอยู่ท้ายสุดเสมอ — ประวัติอยู่ล่าง สิ่งที่ผู้ใช้มาทำอยู่บน (UX spec §4.5) */}
            {legacyOvertime.map((row) => (
              <LegacyOvertimeRow key={row.id} row={row} />
            ))}
          </div>
        )}
        <button
          type="button"
          className={`flex min-h-11 w-full items-center justify-center rounded-sm border border-border-interactive bg-surface-2 text-sm font-medium text-primary ${FOCUS_RING}`}
          onClick={handleAddOvertimeRow}
        >
          + เพิ่มรายการ OT
        </button>
        {hasOvertimeRows && (
          <div className="flex items-center justify-between rounded-sm bg-surface-2 px-space-3 py-space-2">
            <span className="text-sm text-secondary">รวม OT</span>
            <span className="font-numeric text-base font-semibold tabular-nums text-primary">
              {formatBaht(overtimeSectionTotal)}
            </span>
          </div>
        )}
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
            {formatCurrency(totalDeduct)}
          </span>
        </div>
      </section>

      {/* เงินได้สุทธิ — ฮีโร่ text-3xl เดียวของโมดัลนี้ (K16: อัปเดตทุก render ก่อนบันทึก ไม่ใช่แค่ตอนกดบันทึก)
          เพิ่ม 2 บรรทัดสรุปด้านบน (D-2): "รวมรายได้" ของ section อยู่ "เหนือ" รายการ OT จึงห้ามเปลี่ยนความหมาย
          ให้รวม OT เงียบ ๆ — เลยเพิ่มบรรทัดใหม่ที่ขอบเขตชัดเจนแทน ไม่ลบอะไรทิ้ง */}
      <div className="rounded-md border border-border-default bg-surface-2 p-space-5 shadow-elev-1">
        <div className="flex items-center justify-between gap-space-3">
          <span className="text-sm text-secondary">รวมรายได้ทั้งหมด</span>
          <span className="font-numeric text-base tabular-nums text-primary">{formatCurrency(totalIncome)}</span>
        </div>
        <div className="mt-space-1 flex items-center justify-between gap-space-3">
          <span className="text-sm text-secondary">รวมหัก</span>
          <span className="font-numeric text-base tabular-nums text-primary">{formatCurrency(totalDeduct)}</span>
        </div>
        <div className="my-space-3 border-t border-border-subtle" />
        <div className="text-center">
          <p className="m-0 text-sm font-medium text-secondary">เงินได้สุทธิ</p>
          <p className="font-numeric m-0 text-3xl tabular-nums text-primary">
            {formatCurrency(netIncomeValue)}
          </p>
        </div>
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
