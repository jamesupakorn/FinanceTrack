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
import { BANK_ISSUERS } from './creditCardBankCatalog';

// ---------------------------------------------------------------------------
// ค่าคงที่
// ---------------------------------------------------------------------------

/**
 * สีพื้นฐาน 8 สีเดิม — ลำดับห้ามเปลี่ยน: index 0 เป็นค่า default/fallback ใน 3 จุด (V-5)
 * export เพื่อให้ฟอร์มแสดงเฉพาะ 8 สีนี้เมื่อเลือก "อื่นๆ" (D-5)
 */
export const BASE_CARD_COLORS: readonly string[] = [
  '#5d5bff',
  '#22c1a4',
  '#f2994a',
  '#eb5757',
  '#9b51e0',
  '#2f80ed',
  '#f2c94c',
  '#6b7280'
];

/**
 * ชุดสีประจำบัตร = 8 สีเดิม (BASE_CARD_COLORS) + สีแบรนด์ของผู้ออกบัตรจาก BANK_ISSUERS (BR-CC-021)
 * append-only หลัง release — ห้าม reorder หรือ prepend สีแบรนด์ (CARD_COLORS[0] ต้องเป็น
 * default/fallback เดิมเสมอ, V-5) ซ้ำกับสีที่มีอยู่แล้วจะถูก de-duplicate (Set)
 */
export const CARD_COLORS: string[] = Array.from(new Set([
  ...BASE_CARD_COLORS,
  ...Object.values(BANK_ISSUERS).map((issuer) => issuer.color)
]));

/** เพดานขนาดข้อมูลต่อผู้ใช้ (BR-CC-012 · BR-CC-018) */
export const MAX_CARDS_PER_USER: number = 20;
export const MAX_ACTIVE_PLANS_PER_USER: number = 50;
export const MAX_INSTALLMENTS_PER_PLAN: number = 60;
export const MAX_REVOLVING_CYCLES_PER_CARD: number = 60;

// รายการใช้จ่ายไม่ผ่อน (spend items)
// เก็บใน credit_cards doc เดียวกับ cycles: เพดานต่อบัตรกันเอกสารเกิน 16 MB (20 บัตร × 1000 × ~250 B ≈ 5 MB)
export const MAX_SPEND_ITEMS_PER_CYCLE: number = 100;
export const MAX_SPEND_ITEMS_PER_CARD: number = 1000;
export const MAX_SPEND_ITEM_NAME_LENGTH: number = 60;
/** ไม่มีเพดานยอดเงินเดิมใน creditCardBasics จึงใช้ค่าตาม DATA_MODEL */
export const MAX_SPEND_ITEM_AMOUNT: number = 9999999.99;
export const SPEND_ITEM_ID_RE: RegExp = /^si_[0-9a-f]{12}$/;

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
export const SPEND_MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * รูปแบบวันที่ซื้อ 'YYYY-MM-DD' — export เพื่อให้ creditCardRevolving.ts ใช้ตรวจรูปแบบได้
 * (ไม่ re-export จาก barrel เหมือน MONTH_KEY_RE — V-8)
 */
export const PURCHASE_DATE_RE: RegExp = /^\d{4}-\d{2}-\d{2}$/;

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
 *
 * primitive แบบ "เดือนเดียวกัน" เท่านั้น — ไม่รู้จักวันสรุปยอด ผู้เรียกที่แปลงบัตร + รอบบิล
 * เป็นวันครบกำหนดต้องใช้ resolveCardDueDate แทนเสมอ (XM-5)
 * ห้ามเรียกฟังก์ชันนี้ตรง ๆ จากนอกไฟล์นี้ (AC-11)
 * @returns 'YYYY-MM-DD'
 */
export function resolveInstallmentDueDate(dueDayValue: number | string, monthKey: string): string | null {
  if (typeof monthKey !== 'string' || !MONTH_KEY_RE.test(monthKey)) return null;
  const daysInMonth = getDaysInMonthKey(monthKey);
  const day = resolveDueDayForMonth(dueDayValue, daysInMonth) || daysInMonth;
  return `${monthKey}-${String(day).padStart(2, '0')}`;
}

type DayLike = number | string | null | undefined;

/** ค่าวันที่ตั้งไว้ของบัตรเป็นตัวเลขเพื่อเปรียบเทียบ — EOM = 31, ไม่มีค่า = EOM, ค่าเสีย = null */
function toComparableDay(value: DayLike): number | null {
  const day = normaliseDayValue(value, { fallbackToEom: true });
  if (day === null) return null;
  return day === END_OF_MONTH_DUE_DAY ? 31 : day;
}

/**
 * จำนวนเดือนที่วันครบกำหนดเลื่อนไปจากรอบบิล (XM-2 / XM-3)
 * 1 เมื่อ dueDay <= statementDay (EOM = 31, เท่ากันถือว่าข้ามเดือน) ไม่เช่นนั้น 0
 * เทียบจากค่าที่ตั้งไว้ ไม่ใช่ค่าที่ clamp ต่อเดือน — บัตรหนึ่งใบจึงได้ offset เท่าเดิมทุกเดือน (รวม ก.พ.)
 * ค่าเสีย (เช่น 'abc', 0, 45) → 0 คงพฤติกรรมเดิมของข้อมูลเสีย
 */
export function getCardDueMonthOffset(statementDay: DayLike, dueDay: DayLike): 0 | 1 {
  const statement = toComparableDay(statementDay);
  const due = toComparableDay(dueDay);
  if (statement === null || due === null) return 0;
  return due <= statement ? 1 : 0;
}

/**
 * ฟังก์ชันเดียวที่แปลงบัตร + รอบบิล (YYYY-MM) เป็นวันครบกำหนดจริง (XM-5)
 * = dueDay ในเดือน addMonths(cycleMonth, offset) — EOM/clamp ผ่าน resolveDueDayForMonth (XM-4)
 * รอบบิลยังเป็นตัวจัดกลุ่มรายเดือนเหมือนเดิม (XM-1) เปลี่ยนเฉพาะวันที่ที่รอบบิลชี้ไป
 * ค่าที่ได้ derive ตอนอ่านเสมอ ห้ามเก็บลงฐานข้อมูล (XM-8)
 * @returns 'YYYY-MM-DD' หรือ null เมื่อ cycleMonth ไม่ถูกต้อง
 */
export function resolveCardDueDate(
  card: { statementDay?: DayLike; dueDay?: DayLike },
  cycleMonth: string
): string | null {
  if (typeof cycleMonth !== 'string' || !MONTH_KEY_RE.test(cycleMonth)) return null;
  const offset = getCardDueMonthOffset(card?.statementDay, card?.dueDay);
  return resolveInstallmentDueDate(card?.dueDay as number | string, addMonths(cycleMonth, offset));
}

/**
 * วันตัดรอบ (statement cut-off) ของเดือนปฏิทิน monthKey — clamp สิ้นเดือนแบบเดียวกับ resolveCardDueDate
 * ไม่ใช่วันครบกำหนด; ใช้แทนการเรียก resolveInstallmentDueDate จากนอกไฟล์นี้ (AC-11)
 * @returns 'YYYY-MM-DD' หรือ null เมื่อ monthKey ไม่ถูกต้อง
 */
export function resolveStatementCutoffDate(statementDay: DayLike, monthKey: string): string | null {
  return resolveInstallmentDueDate(statementDay as number | string, monthKey);
}

/**
 * รอบบิลที่ครบกำหนดชำระในเดือนปฏิทิน calendarMonth = addMonths(calendarMonth, -offset) (XM-6)
 * ใช้กับจุดแจ้งเตือนที่อิงวันที่ปฏิทิน (LINE card notify) — ยอดเงิน/สรุปยังอิงรอบบิลเหมือนเดิม
 * @returns 'YYYY-MM' — calendarMonth ไม่ถูกต้อง → คืนค่าเดิม
 */
export function getPayableCycleMonth(
  card: { statementDay?: DayLike; dueDay?: DayLike },
  calendarMonth: string
): string {
  if (typeof calendarMonth !== 'string' || !MONTH_KEY_RE.test(calendarMonth)) return calendarMonth;
  const offset = getCardDueMonthOffset(card?.statementDay, card?.dueDay);
  return addMonths(calendarMonth, -offset);
}

/**
 * เดือนตาราง (เดือนที่ชำระจริง) ของรอบบิล cycleMonth = addMonths(cycleMonth, offset) (DP-1)
 * เป็นฟังก์ชันผกผันของ getPayableCycleMonth และเท่ากับ resolveCardDueDate(card, cycleMonth).slice(0, 7)
 * ใช้จัดวางแถวบัตร ccr_ ในตารางรายจ่ายรายเดือน — derive ตอนอ่านเสมอ ไม่เก็บลงฐานข้อมูล (DP-3)
 * @returns 'YYYY-MM' — cycleMonth ไม่ถูกต้อง → คืนค่าเดิม (เหมือน getPayableCycleMonth)
 */
export function getCardDueMonth(
  card: { statementDay?: DayLike; dueDay?: DayLike },
  cycleMonth: string
): string {
  if (typeof cycleMonth !== 'string' || !MONTH_KEY_RE.test(cycleMonth)) return cycleMonth;
  const offset = getCardDueMonthOffset(card?.statementDay, card?.dueDay);
  return addMonths(cycleMonth, offset);
}

/**
 * true เมื่อเป็น 'YYYY-MM-DD' และเป็นวันที่ที่มีอยู่จริงในปฏิทิน
 * ปฏิเสธทั้งรูปแบบผิด และวันที่ที่ไม่มีจริง เช่น '2026-02-30', '2026-04-31', '2026-02-29'
 */
export function isValidPurchaseDate(value: unknown): value is string {
  if (typeof value !== 'string' || !PURCHASE_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  // สร้างจาก component แบบ local — ห้ามใช้ new Date(value) (parse เป็น UTC และ V8 อาจ roll-over วันที่เกิน)
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/**
 * คำนวณรอบบิล (YYYY-MM) จากวันที่ซื้อจริงและวันสรุปยอดของบัตร (BR-CC-025)
 * ซื้อ <= วันสรุปยอด → รอบบิลเดือนที่ซื้อ · ซื้อ > วันสรุปยอด → รอบบิลเดือนถัดไป
 * @returns 'YYYY-MM' หรือ '' เมื่อคำนวณไม่ได้ (purchaseDate ไม่ถูกต้อง / statementDay ไม่ถูกต้อง)
 */
export function computeStartMonthFromPurchase(
  purchaseDate: string,
  statementDay: number | string | null | undefined
): string {
  if (!isValidPurchaseDate(purchaseDate)) return '';
  // ห้ามใช้ getCurrentMonthKey(purchaseDate) หรือ new Date(purchaseDate) — ทั้งสองแปลงเป็น UTC
  // midnight ทำให้เดือนคลาดเคลื่อนได้ในโซนเวลาติดลบ (C-3) ตัด string ตรง ๆ แทน
  const purchaseMonth = purchaseDate.slice(0, 7);

  // 1) EOM ต้องเช็กก่อนการเปรียบเทียบตัวเลขเสมอ — Number('EOM') เป็น NaN และ NaN เทียบอะไรก็ false
  //    ถ้าเทียบตรง ๆ ทุกรายการของบัตร EOM จะถูกดันไปเดือนถัดไปแบบเงียบ ๆ (R-1)
  if (isEndOfMonthDueDay(statementDay)) return purchaseMonth;

  const day = normaliseDayValue(statementDay, { fallbackToEom: true });
  if (day === null) return '';
  if (day === END_OF_MONTH_DUE_DAY) return purchaseMonth; // ไม่มีค่า → EOM เหมือน validateCardInput

  // 2) clamp วันสรุปยอดให้ไม่เกินจำนวนวันของเดือนที่ซื้อ (แบบเดียวกับ resolveInstallmentDueDate)
  const cutoffDay = Math.min(day, getDaysInMonthKey(purchaseMonth));
  const purchaseDay = Number(purchaseDate.slice(8, 10));

  // 3) เดือนถัดไปผ่าน addMonths เท่านั้น — ทดปีให้เอง (ธ.ค. → ม.ค. ปีถัดไป)
  return purchaseDay <= cutoffDay ? purchaseMonth : addMonths(purchaseMonth, 1);
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
