// overtimeUtils.ts
// คณิตศาสตร์ของรายการ OT ทั้งหมด (BR-OT-001 … BR-OT-009) — โมดูลบริสุทธิ์ ไม่มี I/O
// ใช้ร่วมกันระหว่าง SalaryCalculator.js (พรีวิว) และ pages/api/salary.js (ค่าที่บันทึกจริง)
// เพื่อให้ตัวเลขที่ผู้ใช้เห็นกับตัวเลขที่เก็บลงฐานข้อมูลไม่มีทางต่างกัน (ADR-020, บทบาทเดียวกับ
// buildRevolvingCycles ของบัตรเครดิตใน ADR-011)
//
// กฎที่เป็น "การตัดสินใจ" ไม่ใช่รายละเอียดบังเอิญ:
//   1. hourlyRate ไม่เคยถูกปัดเศษ — ปัดเฉพาะยอดของแต่ละแถว (BR-OT-001)
//   2. ปัดทีละแถวแล้วค่อยบวก ไม่ใช่บวกแล้วค่อยปัด — ยอดรวมจึงเท่ากับผลบวกของแถวที่แสดงเสมอ (BR-OT-004)
//   3. ปัดแบบ half-up (Math.round) ไม่ใช่ banker's rounding — 562.5 → 563 (D-3)

import { getDaysInMonth } from './dateUtils';

// ---------------------------------------------------------------------------
// ค่าคงที่และชนิดข้อมูล
// ---------------------------------------------------------------------------

/** ตัวคูณ OT ตามกฎหมาย — ไม่รองรับค่ากำหนดเอง (BR-OT-003) */
export const OT_MULTIPLIERS = [1, 1.5, 2, 3] as const;

export type OvertimeMultiplier = typeof OT_MULTIPLIERS[number];

/** แถว OT ที่บันทึกจริง — เก็บแค่ 3 ฟิลด์นี้ ยอดเงินคำนวณตอนอ่านเสมอ (BR-OT-002) */
export interface OvertimeRow {
  id: string;
  hours: number | string;
  multiplier: OvertimeMultiplier;
}

/** แถว OT แบบยอดคงที่ของเดิม — derive จาก income ตอน GET เท่านั้น ไม่เคยถูกบันทึก (D-1) */
export interface LegacyOvertimeRow {
  id: string;
  key: string;
  label: string;
  amount: number;
}

/** คีย์ OT แบบยอดคงที่ของเดิมใน income — ลำดับนี้คือลำดับที่ต้องแสดงผล */
export const LEGACY_OVERTIME_KEYS = [
  'overtime_1x',
  'overtime_1_5x',
  'overtime_2x',
  'overtime_3x',
  'overtime_other'
] as const;

/** ป้ายภาษาไทยของคีย์เดิม — ย้ายมาจาก salaryKeyThaiMapping ใน SalaryCalculator.js แบบคำต่อคำ */
export const LEGACY_OVERTIME_LABELS: Record<string, string> = {
  overtime_1x: 'ค่าล่วงเวลา 1 เท่า',
  overtime_1_5x: 'ค่าล่วงเวลา 1.5 เท่า',
  overtime_2x: 'ค่าล่วงเวลา 2 เท่า',
  overtime_3x: 'ค่าล่วงเวลา 3 เท่า',
  overtime_other: 'ค่าล่วงเวลาอื่นๆ'
};

/** คีย์ที่เก็บป้ายชื่อที่ผู้ใช้ตั้งเองใน income (ตรงกับ LABELS_META_KEY ใน SalaryCalculator.js) */
const LABELS_META_KEY = '__labels';

/** ชั่วโมง OT สูงสุดต่อแถว = จำนวนชั่วโมงในเดือนที่ยาวที่สุด (31 × 24) */
const MAX_OVERTIME_HOURS = 744;

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;
const ID_PREFIX = 'ot_';
const HOURS_PER_DAY = 8;

// ---------------------------------------------------------------------------
// ตัวช่วยภายใน
// ---------------------------------------------------------------------------

/**
 * อ่านตัวเลขแบบเดียวกับ calculateSalarySummary (A-3) — ทำให้ salary/ยอด OT เดิมที่เก็บเป็นสตริง
 * ("30000", "1,200") ให้ผลเท่ากันทั้งฝั่ง summary และฝั่ง OT (invariant D-1)
 *
 * ต่างจาก `parseFloat(String(x)) || 0` ของ apiUtils.ts:15 อยู่จุดเดียว **โดยตั้งใจ**:
 * ที่นี่กรองด้วย Number.isFinite จึงแปลง `Infinity`/`-Infinity` เป็น 0 ด้วย ขณะที่ `|| 0` ปล่อยผ่าน
 * — AC-OT-08 ห้าม Infinity ปรากฏในยอด OT ใด ๆ ห้าม "แก้ให้เหมือนกัน" โดยตัด Number.isFinite ออก
 */
function toNumber(value: unknown): number {
  const parsed = parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** สร้าง id ให้แถวที่ client ส่งมาโดยไม่มี id — ใช้เป็น React key เท่านั้น ไม่มีความหมายทางธุรกิจ */
function generateOvertimeId(): string {
  return `${ID_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** ลบ -0 ทิ้ง เพื่อไม่ให้ `-0` หลุดไปถึง summary (AC-OT-08) */
function normaliseZero(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * บังคับตัวคูณให้เป็นหนึ่งใน OT_MULTIPLIERS
 * ค่าที่แปลงเป็นตัวเลขไม่ได้ → 1 (ค่าเริ่มต้น); ค่าที่อยู่นอกชุด → ค่าที่ใกล้ที่สุด
 * กรณีระยะห่างเท่ากัน (เช่น 2.5) เลือกค่าที่น้อยกว่า เพื่อไม่ให้ค่าขยะทำให้รายได้สูงเกินจริง
 */
export function coerceOvertimeMultiplier(value: unknown): OvertimeMultiplier {
  const numeric = parseFloat(String(value));
  if (!Number.isFinite(numeric)) return 1;

  let nearest: OvertimeMultiplier = OT_MULTIPLIERS[0];
  let nearestDistance = Math.abs(numeric - nearest);
  for (const candidate of OT_MULTIPLIERS) {
    const distance = Math.abs(numeric - candidate);
    // `<` ล้วน ๆ (ไม่ใช่ `<=`) ทำให้กรณีเท่ากันคงค่าที่น้อยกว่าไว้ เพราะ OT_MULTIPLIERS เรียงจากน้อยไปมาก
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/**
 * บังคับชั่วโมงให้อยู่ในช่วง [0, 744]
 * ค่าติดลบถูกตัดเป็น 0 ไม่ใช่กลับเครื่องหมาย — OT ติดลบไม่มีอยู่จริง และจะไปลดฐานภาษีของผู้ใช้
 */
export function coerceOvertimeHours(value: unknown): number {
  const numeric = parseFloat(String(value));
  if (!Number.isFinite(numeric)) return 0;
  if (numeric <= 0) return 0;
  return Math.min(numeric, MAX_OVERTIME_HOURS);
}

// ---------------------------------------------------------------------------
// การคำนวณ
// ---------------------------------------------------------------------------

/**
 * อัตราค่าจ้างต่อชั่วโมง = เงินเดือน ÷ จำนวนวันจริงของเดือนนั้น ÷ 8 (BR-OT-001)
 * คืนค่าเต็มความละเอียด ไม่ปัดเศษ และไม่มีทางคืน NaN/Infinity —
 * NaN ที่หลุดไปถึง summary จะทำให้ total_income ของทั้งเดือนเสีย
 */
export function getSalaryHourlyRate(salaryAmount: number, monthKey: string): number {
  const salary = toNumber(salaryAmount);
  if (salary <= 0) return 0;
  if (typeof monthKey !== 'string' || !MONTH_KEY_RE.test(monthKey)) return 0;

  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  if (monthIndex < 0 || monthIndex > 11) return 0;

  const daysInMonth = getDaysInMonth(year, monthIndex);
  if (!Number.isFinite(daysInMonth) || daysInMonth <= 0) return 0;

  const rate = salary / daysInMonth / HOURS_PER_DAY;
  return Number.isFinite(rate) ? rate : 0;
}

/**
 * ยอดเงินของแถว OT หนึ่งแถว — จำนวนเต็มบาท ปัดแบบ half-up (BR-OT-004)
 * รับแถวดิบจาก state ของฟอร์มได้ (hours อาจเป็นสตริงระหว่างพิมพ์ ตาม K14)
 */
export function calculateOvertimeRowAmount(row: OvertimeRow, hourlyRate: number): number {
  if (!row || typeof row !== 'object') return 0;
  const rate = Number.isFinite(hourlyRate) && hourlyRate > 0 ? hourlyRate : 0;
  if (rate === 0) return 0;

  const hours = coerceOvertimeHours(row.hours);
  if (hours === 0) return 0;

  const amount = Math.round(rate * coerceOvertimeMultiplier(row.multiplier) * hours);
  return Number.isFinite(amount) ? normaliseZero(amount) : 0;
}

/**
 * ยอด OT รวมของเดือน = ผลบวกของยอดแต่ละแถว "ที่ปัดเศษแล้ว" (BR-OT-004)
 * ไม่ใช่บวกก่อนแล้วปัด — ยอดรวมที่ไม่เท่ากับแถวที่เห็นอ่านได้เป็นบั๊กข้อมูล (K16)
 */
export function calculateOvertimeTotal(
  rows: OvertimeRow[],
  salaryAmount: number,
  monthKey: string
): number {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const hourlyRate = getSalaryHourlyRate(salaryAmount, monthKey);
  if (hourlyRate === 0) return 0;

  const total = rows.reduce(
    (sum, row) => sum + calculateOvertimeRowAmount(row, hourlyRate),
    0
  );
  return Number.isFinite(total) ? normaliseZero(total) : 0;
}

// ---------------------------------------------------------------------------
// การทำข้อมูลให้ถูกต้อง (write guard) และการดึงข้อมูลเดิม
// ---------------------------------------------------------------------------

/**
 * ด่านกันข้อมูลฝั่งเขียน — คืนเฉพาะ { id, hours, multiplier } เท่านั้น
 * property อื่นที่ client ส่งมา (เช่น amount, hourlyRate) ถูกทิ้งทั้งหมด ยอดเงินจึงไม่มีทางเข้าเอกสาร
 * ค่าที่ไม่ใช่อาร์เรย์ (null / string / object) → [] (edge case 23)
 * ไม่มีการจำกัดจำนวนแถว โดยตั้งใจ — สอดคล้องกับ income/deduct ที่เป็น map ไม่จำกัดคีย์อยู่แล้ว (A-11)
 */
export function normaliseOvertimeRows(raw: unknown): OvertimeRow[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
    .map((row) => {
      const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : generateOvertimeId();
      return {
        id,
        hours: coerceOvertimeHours(row.hours),
        multiplier: coerceOvertimeMultiplier(row.multiplier)
      };
    });
}

/**
 * ดึงรายการ OT แบบยอดคงที่ของเดิมออกมาเป็นแถวอ่านอย่างเดียว (D-1)
 * - เฉพาะคีย์ที่มีค่า > 0 (ศูนย์ไม่ใช่ประวัติที่ควรแสดง — edge case 13)
 * - เรียงตาม LEGACY_OVERTIME_KEYS เสมอ: 1x, 1.5x, 2x, 3x, other
 * - **ไม่แตะต้อง income** — เป็นการแปลงตอนแสดงผลล้วน ๆ คีย์เดิมยังอยู่ที่เดิมตลอดไป
 * ป้ายชื่อใช้ของที่ผู้ใช้ตั้งไว้ใน income.__labels ถ้ามี ไม่งั้นใช้ LEGACY_OVERTIME_LABELS
 */
export function extractLegacyOvertimeRows(income: Record<string, unknown>): LegacyOvertimeRow[] {
  if (!income || typeof income !== 'object' || Array.isArray(income)) return [];

  const storedLabels = income[LABELS_META_KEY];
  const labels: Record<string, unknown> =
    storedLabels && typeof storedLabels === 'object' && !Array.isArray(storedLabels)
      ? (storedLabels as Record<string, unknown>)
      : {};

  const rows: LegacyOvertimeRow[] = [];
  for (const key of LEGACY_OVERTIME_KEYS) {
    const amount = toNumber(income[key]);
    if (amount <= 0) continue;
    const storedLabel = labels[key];
    const label =
      typeof storedLabel === 'string' && storedLabel.trim()
        ? storedLabel.trim()
        : LEGACY_OVERTIME_LABELS[key];
    rows.push({ id: `legacy_${key}`, key, label, amount });
  }
  return rows;
}

/**
 * คืน income ชุดใหม่ที่ไม่มีคีย์ OT เดิม — ใช้กับ carry-forward (V-3) และ copy-previous-month (V-7)
 * ไม่แก้ไข object ต้นฉบับ: เอกสารที่บันทึกไว้แล้วต้องคง income.overtime_* ไว้ตลอดไป
 * ป้ายชื่อใน __labels ของคีย์เหล่านั้นถูกตัดออกด้วย เพื่อไม่ให้เหลือ label ที่ไม่มีค่าคู่กัน
 */
export function stripLegacyOvertimeKeys(income: Record<string, unknown>): Record<string, unknown> {
  if (!income || typeof income !== 'object' || Array.isArray(income)) return {};

  const legacyKeys = new Set<string>(LEGACY_OVERTIME_KEYS);
  const stripped: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(income)) {
    if (legacyKeys.has(key)) continue;
    stripped[key] = value;
  }

  const storedLabels = stripped[LABELS_META_KEY];
  if (storedLabels && typeof storedLabels === 'object' && !Array.isArray(storedLabels)) {
    const strippedLabels: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(storedLabels as Record<string, unknown>)) {
      if (legacyKeys.has(key)) continue;
      strippedLabels[key] = value;
    }
    stripped[LABELS_META_KEY] = strippedLabels;
  }

  return stripped;
}
