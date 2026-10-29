// monthUtils.ts
// รวมฟังก์ชันที่เกี่ยวกับการจัดการเดือน เช่น การคำนวณเดือนก่อนหน้า การแปลงข้อมูลเดือน ฯลฯ

import type { MonthKey } from '../../types/domain';

/**
 * ดึงข้อมูลเดือนจาก object (เช่น { months: { ... } })
 * @param {object} obj - object ที่มี key months
 * @param {string} month - เดือนที่ต้องการ (YYYY-MM)
 * @returns {object} - ข้อมูลเดือนนั้น หรือ {} ถ้าไม่มี
 */
export function getMonthData(obj: { months?: Record<string, unknown> } | undefined, month: MonthKey): Record<string, unknown> {
  if (!obj || !obj.months) return {};
  return obj.months[month] ? JSON.parse(JSON.stringify(obj.months[month])) : {};
}

/**
 * คำนวณเดือนก่อนหน้า (YYYY-MM)
 * @param {string} month - เดือนปัจจุบัน (YYYY-MM)
 * @returns {string} - เดือนก่อนหน้า (YYYY-MM)
 */
export function getPrevMonth(month: MonthKey): MonthKey {
  const [y, m] = month.split('-').map(Number);
  let prevY = y, prevM = m - 1;
  if (prevM < 1) { prevY -= 1; prevM = 12; }
  return `${prevY}-${String(prevM).padStart(2, '0')}`;
}

/**
 * แปลงเดือน (YYYY-MM) เป็น label ภาษาไทย เช่น 'ตุลาคม 2025'
 * @param {string} month - เดือน (YYYY-MM)
 * @returns {string} - label ภาษาไทย
 */
export function formatMonthLabelTH(month: MonthKey): string {
  const [year, m] = month.split('-');
  const date = new Date(Number(year), Number(m) - 1, 1);
  return date.toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });
}

export const MONTH_KEY_RE: RegExp = /^\d{4}-\d{2}$/;

export function getMonthKeys(data: { months?: Record<string, unknown> } | Record<string, unknown> | undefined): MonthKey[] {
  if (!data || typeof data !== 'object') return [];
  const source = 'months' in data && data.months && typeof data.months === 'object' ? data.months : data;
  return Object.keys(source).filter(month => MONTH_KEY_RE.test(month));
}

export function getMeaningfulSalaryMonths(data: { months?: Record<string, unknown> } | undefined): MonthKey[] {
  if (!data?.months || typeof data.months !== 'object') return [];
  return Object.entries(data.months)
    .filter(([month, doc]) => {
      if (!MONTH_KEY_RE.test(month) || !doc || typeof doc !== 'object') return false;
      const docObj = doc as Record<string, unknown>;
      const note = typeof docObj.note === 'string' ? docObj.note.trim() : '';
      const summary = (docObj.summary || {}) as Record<string, unknown>;
      const hasSummary = [summary.total_income, summary.total_deduct, summary.net_income]
        .some(value => Number(value) > 0);
      const income = (docObj.income || {}) as Record<string, unknown>;
      const deduct = (docObj.deduct || {}) as Record<string, unknown>;
      return hasSummary
        || Object.values(income).some(value => Number(value) > 0)
        || Object.values(deduct).some(value => Number(value) > 0)
        || note.length > 0;
    })
    .map(([month]) => month);
}

// ฟิลด์ metadata / ค่าที่ server คำนวณเพิ่มใน GET (ไม่ใช่ข้อมูลที่ผู้ใช้กรอก) — ไม่นับว่ามีข้อมูล
const NON_DATA_KEYS = new Set([
  '_id', 'userId', 'month', 'saved_at', 'createdAt', 'updatedAt',
  'รวม', 'totalActualPaid', 'accountSummary', 'overtimeLegacy', 'totalSavings', 'รวมเงินเก็บ'
]);
// แถวบัตรเครดิตที่ server derive ใส่ใน expense GET (cci_ งวดผ่อน / ccr_ ยอดหมุนเวียน) ไม่มีเอกสารเดือนจริง
// และไม่ถูกนับในหน้าต่าง 15 เดือนฝั่ง server — จึงไม่ทำให้เดือนอนาคตไกลโผล่ใน dropdown
const DERIVED_ROW_PREFIXES = ['cci_', 'ccr_'];

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(hasMeaningfulValue);
  return true;
}

function isMeaningfulMonthDoc(doc: unknown): boolean {
  if (Array.isArray(doc)) return doc.some(hasMeaningfulValue);
  if (!doc || typeof doc !== 'object') return hasMeaningfulValue(doc);
  return Object.entries(doc as Record<string, unknown>).some(([key, value]) => (
    !NON_DATA_KEYS.has(key)
    && !DERIVED_ROW_PREFIXES.some(prefix => key.startsWith(prefix))
    && hasMeaningfulValue(value)
  ));
}

/**
 * เดือนที่ "มีข้อมูลจริง" จากผลลัพธ์ getAll() ของ collection ที่ WorkspaceShell รวมไว้.
 * รูปแบบที่รองรับ: `{ months: { 'YYYY-MM': doc } }` (expense/income/savings/salary getAll) และ
 * `{ 'YYYY-MM': doc }` (investment getAll คืน map เดือน -> array). เอกสาร `{}` / `[]` / ค่าศูนย์ / '' = ไม่มีข้อมูล
 */
export function getMeaningfulMonthKeys({ expense, income, savings, salary, investment }: {
  expense?: unknown;
  income?: unknown;
  savings?: unknown;
  salary?: unknown;
  investment?: unknown;
} = {}): Set<MonthKey> {
  const result = new Set<MonthKey>();
  [expense, income, savings, salary, investment].forEach(data => {
    if (!data || typeof data !== 'object') return;
    const record = data as Record<string, unknown>;
    const source = 'months' in record && record.months && typeof record.months === 'object'
      ? record.months as Record<string, unknown>
      : record;
    Object.entries(source).forEach(([month, doc]) => {
      if (MONTH_KEY_RE.test(month) && isMeaningfulMonthDoc(doc)) result.add(month);
    });
  });
  return result;
}

export function collectMonthKeys({ expense, income, savings, salary, investment }: {
  expense?: unknown;
  income?: unknown;
  savings?: unknown;
  salary?: unknown;
  investment?: unknown;
} = {}): MonthKey[] {
  return Array.from(new Set([
    ...getMonthKeys(expense as Record<string, unknown> | undefined),
    ...getMonthKeys(income as Record<string, unknown> | undefined),
    ...getMonthKeys(savings as Record<string, unknown> | undefined),
    ...getMeaningfulSalaryMonths(salary as { months?: Record<string, unknown> } | undefined),
    ...getMonthKeys(investment as Record<string, unknown> | undefined)
  ])).sort((a, b) => b.localeCompare(a));
}
