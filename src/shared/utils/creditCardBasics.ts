// creditCardBasics.ts
// สัญลักษณ์พื้นฐานของโมดูลบัตรเครดิต — ค่าคงที่ (section 1), ตัวช่วยตัวเลข/วันที่พื้นฐาน (section 2),
// และตัวช่วยคีย์แถวใน ExpenseTable (section 3)
//
// ย้ายออกมาจาก creditCardUtils.js (TD-H02 sub-slice 1/3) — creditCardUtils.js ยังคง re-export
// สัญลักษณ์เหล่านี้ทั้งหมด (ยกเว้น MONTH_KEY_RE ที่ใช้ภายในเท่านั้น) เพื่อไม่ให้ 28 importer เดิม
// ต้องแก้ไขอะไรเลย ไม่มีการเปลี่ยนพฤติกรรมใด ๆ ในไฟล์นี้ — เฉพาะการเพิ่ม type annotation เท่านั้น

import {
  END_OF_MONTH_DUE_DAY,
  THAI_MONTH_LABELS,
  isEndOfMonthDueDay,
  getDaysInMonth,
  resolveDueDayForMonth
} from './dateUtils';

// ---------------------------------------------------------------------------
// ค่าคงที่
// ---------------------------------------------------------------------------

/** ชุดสีประจำบัตร (คงที่ 8 สี) — สีเป็นแค่การตกแต่ง ทุกที่ที่มีสีต้องมีชื่อบัตรกำกับเสมอ */
export const CARD_COLORS: string[] = [
  '#5d5bff',
  '#22c1a4',
  '#f2994a',
  '#eb5757',
  '#9b51e0',
  '#2f80ed',
  '#f2c94c',
  '#6b7280'
];

/** เพดานขนาดข้อมูลต่อผู้ใช้ (BR-CC-012 · BR-CC-018) */
export const MAX_CARDS_PER_USER: number = 20;
export const MAX_ACTIVE_PLANS_PER_USER: number = 50;
export const MAX_INSTALLMENTS_PER_PLAN: number = 60;
export const MAX_REVOLVING_CYCLES_PER_CARD: number = 60;

export const PLAN_STATUS = {
  ONGOING: 'ongoing',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled_early'
} as const;

export const INTEREST_MODES = ['manual', 'calculated'] as const;
export const CALC_METHODS = ['flat', 'effective'] as const;

/** การตัดสินใจชำระของยอดหมุนเวียน — null = ยังไม่ตัดสินใจ (BR-CC-014) */
export const PAYMENT_ACTIONS = ['full', 'minimum'] as const;

/** ค่าเริ่มต้นของฟิลด์ยอดหมุนเวียน — ใส่ตอนอ่านเสมอ ไม่ต้อง migrate ข้อมูลเดิม (BR-CC-017) */
export const DEFAULT_ANNUAL_RATE: number = 0;
export const DEFAULT_MIN_PAYMENT_PERCENT: number = 10;

/** คีย์ของแถวผ่อนชำระใน ExpenseTable — คีย์คือ tag (ADR-009) */
export const INSTALLMENT_KEY_PREFIX: string = 'cci_';
export const INSTALLMENT_KEY_RE: RegExp = /^cci_[0-9a-f]{12}_\d{2}$/;

/**
 * คีย์ของแถวยอดใช้จ่ายหมุนเวียนใน ExpenseTable (ADR-011)
 * ตั้งใจให้ไม่ขึ้นต้นด้วย 'cci_' เพื่อไม่ให้ isInstallmentRowKey / INSTALLMENT_KEY_RE เข้าใจผิด
 * และไม่ขึ้นต้นด้วย 'custom_' เพื่อไม่ให้ตัวกรองรายการว่างเปล่าลบทิ้ง
 */
export const REVOLVING_KEY_PREFIX: string = 'ccr_';
export const REVOLVING_KEY_RE: RegExp = /^ccr_[0-9a-f]{12}$/;

/**
 * ไม่ export จากไฟล์เดิม (creditCardUtils.js) แต่ต้อง export ที่นี่เพราะ section 4-7
 * (ยังอยู่ใน creditCardUtils.js) ต้อง import กลับไปใช้ — ไม่ใช่ public surface ใหม่ให้ 28 importer
 * ภายนอก (ไม่มีใครใช้ MONTH_KEY_RE จากภายนอกอยู่แล้ว)
 */
export const MONTH_KEY_RE: RegExp = /^\d{4}-\d{2}$/;

// ---------------------------------------------------------------------------
// ตัวช่วยพื้นฐาน
// ---------------------------------------------------------------------------

/**
 * ปัดเป็นทศนิยม 2 ตำแหน่ง (สตางค์) แบบทนต่อความคลาดเคลื่อนของ floating point
 */
export function round2(value: number | string): number {
  const numeric = typeof value === 'string'
    ? Number(value.replace(/,/g, ''))
    : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const scaled = numeric * 100;
  const epsilon = Math.abs(scaled) * 1e-12 + 1e-9;
  return Math.round(scaled + (scaled >= 0 ? epsilon : -epsilon)) / 100;
}

/**
 * แปลงค่าที่ผู้ใช้กรอก (อาจมี comma) เป็นตัวเลข
 * @returns NaN เมื่อแปลงไม่ได้
 */
export function toAmount(value: number | string): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value === 'string') {
    const trimmed = value.replace(/,/g, '').trim();
    if (!trimmed) return NaN;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

/**
 * บวก/ลบเดือนบน month key แบบ YYYY-MM (ทดปีให้ถูกต้อง)
 */
export function addMonths(monthKey: string, offset: number = 0): string {
  if (typeof monthKey !== 'string' || !MONTH_KEY_RE.test(monthKey)) return monthKey;
  const [yearStr, monthStr] = monthKey.split('-');
  const totalMonths = Number(yearStr) * 12 + (Number(monthStr) - 1) + Math.trunc(Number(offset) || 0);
  const year = Math.floor(totalMonths / 12);
  const monthIndex = ((totalMonths % 12) + 12) % 12;
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

/** เดือนปัจจุบันในรูปแบบ YYYY-MM */
export function getCurrentMonthKey(dateInput?: number | string | Date): string {
  const date = dateInput ? new Date(dateInput) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** จำนวนวันของ month key */
export function getDaysInMonthKey(monthKey: string): number {
  if (typeof monthKey !== 'string' || !MONTH_KEY_RE.test(monthKey)) return 31;
  const [yearStr, monthStr] = monthKey.split('-');
  return getDaysInMonth(Number(yearStr), Number(monthStr) - 1);
}

/**
 * แปลง dueDay ของบัตร (1-31 หรือ EOM) เป็นวันที่จริงของเดือนนั้น
 * ใช้ resolveDueDayForMonth ตัวเดียวกับ ExpenseTable และ LINE (BR-CC-003)
 * @returns 'YYYY-MM-DD'
 */
export function resolveInstallmentDueDate(dueDayValue: number | string, monthKey: string): string | null {
  if (typeof monthKey !== 'string' || !MONTH_KEY_RE.test(monthKey)) return null;
  const daysInMonth = getDaysInMonthKey(monthKey);
  const day = resolveDueDayForMonth(dueDayValue, daysInMonth) || daysInMonth;
  return `${monthKey}-${String(day).padStart(2, '0')}`;
}

/**
 * ฟอร์แมตวันที่ ISO (YYYY-MM-DD) เป็นภาษาไทยแบบย่อ เช่น '5 ส.ค. 2569'
 */
export function formatIsoDateTH(isoDate: string): string {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return '';
  const [yearStr, monthStr, dayStr] = isoDate.split('-');
  const monthIndex = Number(monthStr) - 1;
  const monthLabel = THAI_MONTH_LABELS[monthIndex] || monthStr;
  return `${Number(dayStr)} ${monthLabel} ${Number(yearStr) + 543}`;
}

/**
 * จำนวนวันจากวันนี้ถึงวันที่ระบุ (ลบ = เลยกำหนดแล้ว)
 */
export function diffDaysFromToday(isoDate: string): number | null {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [yearStr, monthStr, dayStr] = isoDate.split('-');
  const target = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/** ข้อความบอกระยะเวลาถึงกำหนด */
export function describeDueDistance(diffDays: number | null | undefined): string {
  if (diffDays === null || diffDays === undefined) return '';
  if (diffDays === 0) return 'ครบกำหนดวันนี้';
  if (diffDays > 0) return `อีก ${diffDays} วัน`;
  return `เลยกำหนด ${Math.abs(diffDays)} วัน`;
}

/** ป้ายกำกับวันครบกำหนด/วันสรุปยอดสำหรับแสดงผล */
export function formatDayLabel(dayValue: number | string): string {
  if (isEndOfMonthDueDay(dayValue)) return 'สิ้นเดือน';
  const numeric = Number(dayValue);
  return Number.isFinite(numeric) && numeric >= 1 ? String(Math.floor(numeric)) : '-';
}

/**
 * ตรวจและแปลงค่าวัน (1-31 หรือ EOM) — คืน null เมื่อไม่ถูกต้อง
 */
export function normaliseDayValue(
  value: number | string | null | undefined,
  { fallbackToEom = false }: { fallbackToEom?: boolean } = {}
): number | typeof END_OF_MONTH_DUE_DAY | null {
  if (value === undefined || value === null || value === '') {
    return fallbackToEom ? END_OF_MONTH_DUE_DAY : null;
  }
  if (isEndOfMonthDueDay(value)) return END_OF_MONTH_DUE_DAY;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const day = Math.floor(numeric);
  if (day < 1 || day > 31) return null;
  return day;
}

// ---------------------------------------------------------------------------
// คีย์แถวผ่อนชำระใน ExpenseTable
// ---------------------------------------------------------------------------

/** ตัด prefix 'ip_' ออกจาก plan id เหลือ 12 hex */
export function planHexSuffix(planId: string | null | undefined): string {
  return String(planId || '').replace(/^ip_/, '');
}

/** สร้างคีย์แถว: cci_<12 hex>_<NN> */
export function buildInstallmentRowKey(planId: string, installmentNo: number): string {
  return `${INSTALLMENT_KEY_PREFIX}${planHexSuffix(planId)}_${String(installmentNo).padStart(2, '0')}`;
}

/** อ่านคีย์แถวกลับเป็น { planId, installmentNo } — คืน null เมื่อรูปแบบไม่ตรง */
export function parseInstallmentRowKey(key: string): { planId: string; installmentNo: number } | null {
  if (typeof key !== 'string' || !INSTALLMENT_KEY_RE.test(key)) return null;
  return {
    planId: `ip_${key.slice(4, 16)}`,
    installmentNo: parseInt(key.slice(17), 10)
  };
}

/** true เมื่อคีย์นี้เป็นแถวผ่อนชำระที่ derive มา (ใช้ฝั่ง UI) */
export function isInstallmentRowKey(key: string): boolean {
  return typeof key === 'string' && key.startsWith(INSTALLMENT_KEY_PREFIX);
}

// ---------------------------------------------------------------------------
// คีย์แถวยอดใช้จ่ายหมุนเวียนใน ExpenseTable (ADR-011)
// ---------------------------------------------------------------------------

/** ตัด prefix 'cc_' ออกจาก card id เหลือ 12 hex */
export function cardHexSuffix(cardId: string | null | undefined): string {
  return String(cardId || '').replace(/^cc_/, '');
}

/** สร้างคีย์แถว: ccr_<12 hex> — 1 แถวต่อ 1 บัตรต่อ 1 เดือน */
export function buildRevolvingRowKey(cardId: string): string {
  return `${REVOLVING_KEY_PREFIX}${cardHexSuffix(cardId)}`;
}

/** อ่านคีย์แถวกลับเป็น { cardId } — คืน null เมื่อรูปแบบไม่ตรง (เดือนไม่ได้อยู่ในคีย์) */
export function parseRevolvingRowKey(key: string): { cardId: string } | null {
  if (typeof key !== 'string' || !REVOLVING_KEY_RE.test(key)) return null;
  return { cardId: `cc_${key.slice(REVOLVING_KEY_PREFIX.length)}` };
}

/** true เมื่อคีย์นี้เป็นแถวยอดหมุนเวียนที่ derive มา */
export function isRevolvingRowKey(key: string): boolean {
  return typeof key === 'string' && key.startsWith(REVOLVING_KEY_PREFIX);
}

/**
 * true เมื่อคีย์นี้เป็นแถวบัตรเครดิตที่ derive มา (ผ่อนชำระ หรือ ยอดหมุนเวียน)
 * ใช้ในที่ที่ทั้งสองตระกูลต้องถูกปฏิบัติเหมือนกัน: แถว locked ใน UI, strip ก่อนเขียน,
 * และ guard hasPersistedRows ของ formatExpenseData (BR-CC-016)
 */
export function isCreditCardRowKey(key: string): boolean {
  return isInstallmentRowKey(key) || isRevolvingRowKey(key);
}
