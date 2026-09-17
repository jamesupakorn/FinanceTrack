/**
 * numberUtils.ts
 * ฟังก์ชันช่วยจัดการตัวเลขและการเงินฝั่ง frontend
 * - จัดรูปแบบตัวเลข/สกุลเงิน
 * - แปลงข้อมูลรายรับ/รายจ่ายจาก API
 * - จัดรูปแบบข้อมูลภาษี/เงินออม
 * - จัดการ input/blur ของช่องตัวเลข
 * - จัดการตัวเลือกเดือนสำหรับ dropdown
 */

import type { MonthKey, ExpenseItem } from '../../types/domain';
import { END_OF_MONTH_DUE_DAY, isEndOfMonthDueDay } from '../dateUtils';
// isCreditCardRowKey ยังเป็น .js (นอก scope ของ slice นี้) — TS จะอนุมาน type แบบหลวมให้ตามที่
// task-context บันทึกไว้ (ดู spec §Scope A.1)
import { isCreditCardRowKey } from '../creditCardUtils';

const DEFAULT_BANK_ACCOUNTS = ['กรุงศรี', 'ttb', 'กสิกร', 'UOB'];
const LEGACY_ITEM_ACCOUNT_MAP: Record<string, string> = {
  credit_kungsri: 'กรุงศรี',
  house: 'ttb',
  credit_ttb: 'ttb',
  credit_kbank: 'กสิกร',
  shopee: 'กสิกร',
  netflix: 'กสิกร',
  youtube: 'กสิกร',
  youtube_membership: 'กสิกร',
  credit_uob: 'UOB'
};

/**
 * คำนวณสรุปยอดตามบัญชีจากข้อมูลค่าใช้จ่าย
 * รวมเฉพาะรายการที่ยังไม่ได้ชำระ
 *
 * หมายเหตุ: เป็น implementation แยกจาก `getAccountSummary` ใน commonUtils.ts (signature/logic ต่างกัน
 * — ตัวนี้รับ bankAccounts เป็นพารามิเตอร์ที่ 2 และเทียบ paid แบบตรงตัว ไม่ผ่าน isPaidFlag) จงใจไม่รวมกัน
 * ในรอบนี้ (ดู spec §Out of scope)
 */
export const getAccountSummary = (
  editExpense: Record<string, unknown> | undefined,
  bankAccounts: string[] = []
): Record<string, number> => {
  const summary: Record<string, number> = {};
  const normalizedAccounts = Array.isArray(bankAccounts)
    ? Array.from(new Set(bankAccounts.map((item) => String(item || '').trim()).filter(Boolean)))
    : [];

  normalizedAccounts.forEach((account) => {
    summary[account] = 0;
  });

  Object.entries(editExpense || {}).forEach(([itemKey, item]) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const expenseItem = item as Partial<ExpenseItem>;
    const paid = expenseItem?.paid;
    if (paid === true || paid === 'true') return;

    const accountName = (typeof expenseItem.account === 'string' && expenseItem.account.trim().length > 0)
      ? expenseItem.account.trim()
      : (LEGACY_ITEM_ACCOUNT_MAP[itemKey] || 'ไม่ระบุบัญชี');

    if (!(accountName in summary)) {
      summary[accountName] = 0;
    }

    summary[accountName] += parseToNumber(expenseItem?.actual || 0);
  });

  return summary;
};
// รายการค่าใช้จ่ายมาตรฐานที่ใช้สำหรับสร้างฟอร์ม (15 รายการ)
export const DEFAULT_EXPENSE_ITEMS: { key: string; label: string }[] = [
  { key: 'house', label: 'ค่าบ้าน' },
  { key: 'water', label: 'ค่าน้ำ' },
  { key: 'internet', label: 'ค่าเน็ต' },
  { key: 'electricity', label: 'ค่าไฟ' },
  { key: 'mobile', label: 'โทรศัพท์มือถือ' }
];

const DEFAULT_EXPENSE_KEYS = DEFAULT_EXPENSE_ITEMS.map(item => item.key);
const CUSTOM_EXPENSE_KEY_PREFIX = 'custom_';
const DEFAULT_CUSTOM_EXPENSE_NAME = 'รายการใหม่'; // Default new item placeholder name
const EXPENSE_IGNORED_FIELDS = new Set([
  // Metadata fields to exclude from expense item processing
  'totalActualPaid',
  'accountSummary',
  'bankAccounts',
  'month',
  '_id',
  'id'
]);

/**
 * Parse string or number to numeric format for expense amounts
 * Removes comma currency formatting and converts to float
 * Returns 0 for invalid/empty values
 */
function parseExpenseNumeric(value: unknown): number {
  // หากเป็นตัวเลขให้คืนค่าเดิม ถ้าไม่ใช่ให้คืน 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    // ลบ comma ก่อนแปลงเป็นตัวเลข (40,560.00 → 40560.00)
    const parsed = parseFloat(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0; // คืน 0 หากรูปแบบไม่ถูกต้อง
}

/**
 * Check if a custom expense row is effectively empty/should be hidden
 * Identifies placeholder rows that were created but never filled in:
 * - Name is empty or default "รายการใหม่" label
 * - No actual amount
 * - No due day set
 * - Not marked as paid
 */
function isEffectivelyEmptyCustomExpenseRow(key: unknown, source?: Record<string, unknown>): boolean {
  // ตรวจสอบว่า key เริ่มด้วย 'custom_'
  if (!String(key || '').startsWith(CUSTOM_EXPENSE_KEY_PREFIX)) return false;
  // ถ้าไม่มีข้อมูลหรือไม่ใช่ object ให้ถือว่าเป็นแถวว่าง
  if (!source || typeof source !== 'object') return true;
  const name = typeof source.name === 'string' ? source.name.trim() : '';
  const actual = parseExpenseNumeric(source.actual);
  const dueDay = source.dueDay == null ? '' : String(source.dueDay).trim();
  const paid = source.paid === true || source.paid === 'true';
  // แถวว่าง: ชื่อเริ่มต้น/ว่าง, ยอดเป็น 0, ไม่มี dueDay, ยังไม่ชำระ
  const isDefaultName = !name || name === DEFAULT_CUSTOM_EXPENSE_NAME;
  return isDefaultName && actual === 0 && dueDay === '' && !paid;
}
// Utility functions สำหรับจัดการตัวเลขและเงิน

/**
 * จัดรูปแบบตัวเลขเป็นทศนิยม 2 ตำแหน่ง พร้อมคั่นหลักพัน
 */
export const formatNumber = (value: number | string): string => {
  // รองรับ input ที่มี comma เช่น 40,560.00
  const cleaned = typeof value === 'string' ? value.replace(/,/g, '') : value;
  const numValue = parseFloat(String(cleaned)) || 0;
  // จัดรูปแบบเพิ่ม comma และทศนิยม 2 ตำแหน่ง
  return numValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * แปลงและจัดรูปแบบตัวเลขในขั้นตอนเดียว
 */
export const parseAndFormat = (value: number | string): string => {
  // แปลงและจัดรูปแบบ เช่น 40560.00 → 40,560.00
  return formatNumber(value);
};

/**
 * แปลงตัวเลขสำหรับบันทึกลงฐานข้อมูล (ตัด comma ออก)
 */
export const parseToNumber = (value: number | string): number => {
  // ลบ comma และแปลงเป็นตัวเลข
  if (typeof value === 'string') {
    // หากเป็น string ให้ลบ comma ก่อน
    return parseFloat(value.replace(/,/g, '')) || 0;
  }
  return parseFloat(String(value)) || 0; // คืน 0 หากไม่สามารถแปลงได้
};

/**
 * จัดรูปแบบตัวเลขเป็นสกุลเงิน (ทศนิยม 2 ตำแหน่ง)
 */
export const formatCurrency = (value: number | string): string => {
  // แปลงค่าเป็นเงิน (40560 → 40,560.00)
  const num = parseFloat(typeof value === 'string' ? value.replace(/,/g, '') : String(value)) || 0;
  // จัดรูปแบบเป็นสตริงตัวเลขพร้อมทศนิยม 2 ตำแหน่ง
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * รวมค่าตัวเลขใน array
 */
export const calculateSum = (values: (number | string)[]): number => {
  return values.reduce((sum: number, value) => sum + (parseFloat(String(value)) || 0), 0);
};

/**
 * จัดการการพิมพ์ตัวเลขแบบเรียลไทม์ (ยังไม่ format)
 * setState เป็น `unknown` แบบตั้งใจ — ไฟล์นี้ไม่มี React import และรูปแบบการเรียกทั้งสอง
 * (setState(prev => ...) และ setState(value)) รองรับได้ด้วยฟังก์ชันรับพารามิเตอร์เดียวใดๆ
 */
export const handleNumberInput = (value: string, setState: (arg: unknown) => void, key: string | null = null): void => {
  // ไม่ format ทันที ให้เก็บ raw value เพื่อให้พิมพ์ได้หลายหลัก
  if (key) {
    setState((prev: unknown) => ({ ...(prev as Record<string, unknown>), [key]: value }));
  } else {
    setState(value);
  }
};

/**
 * จัดรูปแบบตัวเลขเมื่อออกจากช่อง (blur)
 */
export const handleNumberBlur = (value: string, setState: (arg: unknown) => void, key: string | null = null): void => {
  const formattedValue = parseAndFormat(value);
  if (key) {
    setState((prev: unknown) => ({ ...(prev as Record<string, unknown>), [key]: formattedValue }));
  } else {
    setState(formattedValue);
  }
};

// Default preset income categories (3 basic items, expandable with custom rows)
export const DEFAULT_INCOME_ITEMS: { key: string; label: string }[] = [
  { key: 'salary', label: 'เงินเดือน' },
  { key: 'income2', label: 'แหล่งรายรับ 2' },
  { key: 'other', label: 'อื่นๆ' }
];

const DEFAULT_INCOME_KEYS = DEFAULT_INCOME_ITEMS.map(item => item.key);
const INCOME_LABELS_FIELD = '__labels'; // Special field for storing custom labels
const INCOME_IGNORED_FIELDS = new Set([
  // Metadata fields to exclude from income item processing
  'month',
  '_id',
  'รวม',  // Thai for 'Total'
  INCOME_LABELS_FIELD
]);

/**
 * จัดรูปแบบข้อมูลรายรับจาก API ให้พร้อมใช้งานในฟอร์ม
 * รองรับแถว custom และ label แบบกำหนดเอง
 */
export const formatIncomeData = (
  data: Record<string, unknown> | undefined,
  month: MonthKey
): { values: Record<string, string>; labels: Record<string, unknown>; persistedKeys: string[] } => {
  const formattedData: Record<string, string> = {};
  let monthData: Record<string, unknown> = {};
  if (data && typeof data === 'object') {
    const months = data.months as Record<string, unknown> | undefined;
    if (months && typeof months === 'object' && months[month]) {
      monthData = months[month] as Record<string, unknown>;
    } else {
      monthData = data;
    }
  }

  const labelsField = monthData[INCOME_LABELS_FIELD];
  const storedLabels: Record<string, unknown> = (labelsField && typeof labelsField === 'object' && !Array.isArray(labelsField))
    ? { ...(labelsField as Record<string, unknown>) }
    : {};

  const persistedValueKeys = Object.keys(monthData || {}).filter(key => {
    if (INCOME_IGNORED_FIELDS.has(key)) return false;
    const value = monthData[key];
    if (typeof value === 'number') return true;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed.length) return false;
      return !Number.isNaN(parseFloat(trimmed));
    }
    return false;
  });

  const hasStoredValues = persistedValueKeys.length > 0;
  const baselineKeys = hasStoredValues ? persistedValueKeys : DEFAULT_INCOME_KEYS;
  const keysToFormat = Array.from(new Set(baselineKeys));

  if (!keysToFormat.length && DEFAULT_INCOME_KEYS.length) {
    keysToFormat.push(...DEFAULT_INCOME_KEYS);
  }

  keysToFormat.forEach(key => {
    formattedData[key] = parseAndFormat((monthData[key] as number | string) ?? 0);
  });

  const persistedKeys = Array.from(new Set(persistedValueKeys));
  return {
    values: formattedData,
    labels: storedLabels,
    persistedKeys
  };
};

/**
 * จัดรูปแบบข้อมูลค่าใช้จ่ายจาก API ให้พร้อมใช้งานในฟอร์ม
 * รองรับรายการ custom และกรองแถวว่าง
 */
export const formatExpenseData = (
  data: Record<string, unknown> | undefined,
  month: MonthKey
): { values: Record<string, ExpenseItem>; persistedKeys: string[]; emptyKeysToDelete: string[]; bankAccounts: string[] } => {
  // สร้างแบบหลวมก่อน (ค่า dueDay ที่แท้จริงเป็น string เสมอในไฟล์นี้ สำหรับแสดงผลในฟอร์ม
  // ไม่ตรงกับ DueDay type ของ ExpenseItem เป๊ะๆ) แล้วค่อย cast เป็น ExpenseItem ครั้งเดียวตอน return
  const formattedData: Record<string, { name: string; actual: string; account: string; paid: boolean; dueDay: string }> = {};
  let monthData: Record<string, unknown> = {};
  if (data && typeof data === 'object') {
    const months = data.months as Record<string, unknown> | undefined;
    if (months && typeof months === 'object' && months[month]) {
      monthData = months[month] as Record<string, unknown>;
    } else {
      monthData = data;
    }
  }

  // เก็บทุกรายการที่ไม่ใช่ metadata ก่อนกรอง
  const allDynamicKeys = Object.keys(monthData || {}).filter(key => {
    if (EXPENSE_IGNORED_FIELDS.has(key)) return false;
    if (typeof monthData[key] !== 'object' || Array.isArray(monthData[key])) return false;
    return true; // เก็บทั้งหมด ก่อนกรอง
  });

  const rawBankAccounts = monthData?.bankAccounts;
  const storedBankAccounts = Array.isArray(rawBankAccounts)
    ? Array.from(new Set(rawBankAccounts.map((item) => String(item || '').trim()).filter(Boolean)))
    : [];

  // ระบุรายการว่างเปล่าที่ต้องลบออกจากการแสดงผล
  const emptyCustomKeys = allDynamicKeys.filter(key =>
    isEffectivelyEmptyCustomExpenseRow(key, monthData[key] as Record<string, unknown>)
  );

  // ระบุรายการที่ใช้งาน (ไม่ใช่ว่าง)
  const dynamicKeys = allDynamicKeys.filter(key =>
    !isEffectivelyEmptyCustomExpenseRow(key, monthData[key] as Record<string, unknown>)
  );

  // ถ้าเดือนนี้ยังไม่มีข้อมูลจริงเลย ให้แสดงรายการมาตรฐานเป็นค่าเริ่มต้น
  // แต่ถ้ามีข้อมูลที่บันทึกแล้ว ให้แสดงเฉพาะ key ที่มีอยู่จริง (เพื่อให้การลบรายการคงอยู่)
  //
  // ⚠ แถวบัตรเครดิต (cci_ งวดผ่อน · ccr_ ยอดหมุนเวียน) เป็นแถวที่ derive มาตอน GET
  //   ไม่ใช่ข้อมูลที่ผู้ใช้บันทึกไว้ ถ้านับรวมในการเช็คนี้ เดือนที่ยังไม่เคยแก้ไข
  //   แต่บังเอิญมีแถวบัตรเครดิต 1 แถว จะแสดงเฉพาะแถวนั้นแถวเดียว รายการมาตรฐานทั้งชุดหายไป
  //   และ Save All จะบันทึกการหายนั้นทับลงไป
  //   ต้องครอบทั้งสอง prefix — บั๊กนี้เคยหลุดขึ้น production มาแล้วครั้งหนึ่งกับ cci_
  //   (Stage 4 MAJOR-2 / AC-32 / AC-53)
  const creditCardKeys = dynamicKeys.filter(isCreditCardRowKey);
  const persistedKeys = dynamicKeys.filter(key => !isCreditCardRowKey(key));
  const hasPersistedRows = persistedKeys.length > 0;
  const allKeys = Array.from(new Set([
    ...(hasPersistedRows ? persistedKeys : DEFAULT_EXPENSE_KEYS),
    ...creditCardKeys
  ]));

  allKeys.forEach(item => {
    const source = (monthData && monthData[item]) ? (monthData[item] as Record<string, unknown>) : {};
    const defaultLabel = DEFAULT_EXPENSE_ITEMS.find(expense => expense.key === item)?.label;
    formattedData[item] = {
      name: (typeof source.name === 'string' && source.name.trim().length > 0)
        ? source.name
        : (defaultLabel || 'รายการใหม่'),
      actual: parseAndFormat((source?.actual as number | string) ?? 0),
      account: (typeof source?.account === 'string' && source.account.trim().length > 0)
        ? source.account.trim()
        : (LEGACY_ITEM_ACCOUNT_MAP[item] || storedBankAccounts[0] || 'ไม่ระบุบัญชี'),
      paid: source?.paid === true || source?.paid === 'true',
      dueDay: (() => {
        if (typeof source?.dueDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.dueDay)) {
          return String(parseInt(source.dueDay.slice(-2), 10));
        }
        if (typeof source?.dueDay === 'number' || typeof source?.dueDay === 'string') {
          const rawDueDay = String(source.dueDay).trim();
          if (isEndOfMonthDueDay(rawDueDay)) {
            return END_OF_MONTH_DUE_DAY;
          }
          return rawDueDay;
        }
        if (typeof source?.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.dueDate)) {
          return String(parseInt(source.dueDate.slice(-2), 10));
        }
        // รายการมาตรฐาน (house/water/internet/electricity/mobile) ที่ยังไม่เคยบันทึก dueDay
        // ต้อง default เป็น 'EOM' ให้ตรงกับที่ <select> แสดงผลอยู่แล้ว (value={row.dueDay || END_OF_MONTH_DUE_DAY})
        // ไม่งั้น dueInsights จะไม่นับแถวนี้เป็น overdue เลย แม้ผู้ใช้เห็นว่า "สิ้นเดือน" ถูกเลือกอยู่
        return defaultLabel ? END_OF_MONTH_DUE_DAY : '';
      })()
    };
  });

  return {
    // ทุก field ของ ExpenseItem ถูกกำหนดค่าเสมอในลูปด้านบน (ไม่มี field ใดถูกข้ามแบบมีเงื่อนไข)
    // จึงใช้ cast เดียวที่นี่แทนการประกาศ type ซ้ำ
    values: formattedData as Record<string, ExpenseItem>,
    persistedKeys: allDynamicKeys, // ← ส่งทั้งหมด รวมรายการว่างด้วย เพื่อให้ระบบรู้ว่าอะไรมาจาก API
    emptyKeysToDelete: emptyCustomKeys, // ← ส่งรายการว่างเพื่อลบ
    bankAccounts: Array.from(new Set([
      ...storedBankAccounts,
      ...Object.values(monthData || {})
        .map((row) => (typeof (row as Record<string, unknown>)?.account === 'string' ? ((row as Record<string, unknown>).account as string).trim() : ''))
        .filter(Boolean)
    ]))
  };
};

/**
 * จัดรูปแบบข้อมูลเงินออมให้พร้อมใช้งานในฟอร์ม
 * (รูปแบบข้อมูลนี้เป็น Thai-keyed shape เฉพาะไฟล์นี้ ไม่ได้ promote ไปที่ domain.ts — นอก scope ของ slice นี้)
 */
export const formatSavingsData = (
  data: { ยอดออมสะสม?: number | string; รายการเงินออม?: Array<Record<string, unknown>> }
): { ยอดออมสะสม: string; รายการเงินออม: Array<Record<string, unknown>> } => {
  return {
    ยอดออมสะสม: parseAndFormat(data.ยอดออมสะสม || 0),
    รายการเงินออม: (data.รายการเงินออม || []).map(item => ({
      ...item,
      จำนวนเงิน: parseAndFormat((item.จำนวนเงิน as number | string) || 0)
    }))
  };
};

/**
 * จัดรูปแบบข้อมูลภาษีให้พร้อมใช้งานในฟอร์ม
 */
export const formatTaxData = (
  data: { ภาษีสะสมตั้งแต่เดือนแรก?: number | string; ภาษีรายเดือน?: Record<string, number | string> }
): { ภาษีสะสม: string; ภาษีรายเดือน: Record<string, string> } => {
  const formattedภาษีรายเดือน: Record<string, string> = {};
  Object.keys(data.ภาษีรายเดือน || {}).forEach(month => {
    formattedภาษีรายเดือน[month] = parseAndFormat((data.ภาษีรายเดือน as Record<string, number | string>)[month]);
  });

  return {
    ภาษีสะสม: parseAndFormat(data.ภาษีสะสมตั้งแต่เดือนแรก || 0),
    ภาษีรายเดือน: formattedภาษีรายเดือน
  };
};

/**
 * สร้างตัวเลือกเดือนย้อนหลัง 15 เดือนสำหรับ dropdown
 */
export const generateMonthOptions = (): { value: MonthKey; label: string }[] => {
  const months: { value: MonthKey; label: string }[] = [];
  const currentDate = new Date();

  for (let i = 0; i < 15; i++) {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
    const monthValue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const monthLabel = date.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'long'
    });

    months.push({
      value: monthValue,
      label: monthLabel
    });
  }

  return months;
};

/**
 * คำนวณเดือนถัดไปจากเดือนปัจจุบัน
 */
export const getNextMonth = (currentMonth: MonthKey): MonthKey => {
  const [year, month] = currentMonth.split('-').map(Number);
  const nextDate = new Date(year, month, 1); // month+1 เนื่องจาก Date constructor month เริ่มจาก 0
  return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
};
