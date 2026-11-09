// commonUtils.ts
// ฟังก์ชันใช้งานร่วมกันระหว่าง frontend, backend และ API

import type { ExpenseItem } from '../types/domain';
import type { CardTotalExpenseRow } from './backend/creditCardSync';

/**
 * ตรวจสอบว่ารายการถูกทำเครื่องหมายว่าชำระแล้วหรือไม่
 * @param {boolean|string} paid - ค่าจากฟิลด์ paid
 * @returns {boolean}
 */
export function isPaidFlag(paid: unknown): boolean {
  // ตรวจสอบว่าค่าอยู่ในรูปแบบ boolean หรือ string 'true' ทั้ง 2 แบบถือว่าชำระแล้ว
  return paid === true || paid === 'true';
}

/**
 * ดึงรายการ key ที่ต้องลบจาก payload
 * @param {object} payload - ข้อมูลที่มี __removeKeys
 * @returns {array} รายการ key ที่ต้องลบ
 */
export function extractRemovalKeys(payload: { __removeKeys?: unknown } = {}): string[] {
  // ดึงรายการ key ที่ต้องลบออกจาก payload
  const raw = payload?.__removeKeys;
  if (!Array.isArray(raw)) return []; // ถ้าไม่ใช่ array ให้คืน array ว่าง
  // กรอง key ที่เป็นข้อความและไม่ว่าง
  return raw.filter((key): key is string => typeof key === 'string' && key.length > 0);
}

/**
 * mapping สำหรับสรุปยอดตามบัญชี
 */
export const ACCOUNT_MAPPING: Record<string, string[]> = {
  "กรุงศรี": [],
  "ttb": ["house"],
  "กสิกร": ["shopee", "netflix", "youtube", "youtube_membership"],
  "UOB": []
};

export const DEFAULT_BANK_ACCOUNTS: string[] = Object.keys(ACCOUNT_MAPPING);
export const LEGACY_ITEM_ACCOUNT_MAP: Record<string, string> = Object.entries(ACCOUNT_MAPPING).reduce<Record<string, string>>((acc, [account, items]) => {
  items.forEach((item) => {
    acc[item] = account;
  });
  return acc;
}, { credit_kungsri: 'กรุงศรี', credit_ttb: 'ttb', credit_kbank: 'กสิกร', credit_uob: 'UOB' });

/**
 * คำนวณสรุปยอดตามบัญชีจากข้อมูลค่าใช้จ่าย
 * @param {object} expenseData - ข้อมูลค่าใช้จ่ายแบบ flat
 * @param {array} bankAccounts - รายชื่อบัญชีที่อนุญาต
 * @returns {object} สรุปยอด {ชื่อบัญชี: ยอดรวม}
 */
export interface AccountBreakdownItem {
  key: string;
  name: string;
  amount: number;
  account: string;
  paid: boolean;
  dueDay?: unknown;
  resolvedDueDate?: string;
  cycleMonth?: string;
  breakdown?: CardTotalExpenseRow['breakdown'];
}

export interface AccountBreakdown {
  items: AccountBreakdownItem[];
  paidItems: AccountBreakdownItem[];
  total: number;
}

// คีย์ metadata 8 ตัวที่ getAccountSummary ข้ามมาตั้งแต่เดิม (ไม่รวม 'id' — ต่างจาก EXPENSE_METADATA_KEYS โดยตั้งใจ เพื่อให้ accountSummary ที่บันทึกไม่เปลี่ยน)
const ACCOUNT_SUMMARY_SKIP_KEYS = ['month', '_id', 'userId', 'periodKey', 'accountSummary', 'totalActualPaid', '__removeKeys', 'bankAccounts'];

const legacyParseAmount = (value: unknown): number => parseFloat(String(value || 0));

/**
 * แจกแจงรายการค่าใช้จ่ายตามบัญชี — แหล่งเดียวของกฎกรอง/จัดกลุ่มบัญชี
 * total = ผลรวมของรายการที่ยังไม่ชำระ (บวกต่อเนื่องตามลำดับ Object.entries)
 * @param {object} expenseData - ข้อมูลค่าใช้จ่ายแบบ flat
 * @param {array} bankAccounts - รายชื่อบัญชีที่อนุญาต
 * @param {object} options - parseAmount: ตัวแปลงยอด (ค่าเริ่มต้น = parse ฝั่ง server)
 */
export function getAccountBreakdown(
  expenseData: Record<string, unknown> | undefined,
  bankAccounts: string[] = DEFAULT_BANK_ACCOUNTS,
  options?: { parseAmount?: (value: unknown) => number }
): Record<string, AccountBreakdown> {
  return buildAccountData(expenseData, bankAccounts, options).breakdown;
}

/**
 * ตัวสร้างกลาง: breakdown (seed → บัญชีที่มีรายการยังไม่ชำระตามลำดับ → บัญชีที่มีแต่รายการชำระแล้ว)
 * และ summary ที่ตรงกับ implementation เดิม (HEAD) ทุกไบต์: แถวที่ชำระแล้วถูกข้ามก่อน resolve บัญชี/สร้าง bucket
 */
function buildAccountData(
  expenseData: Record<string, unknown> | undefined,
  bankAccounts: string[],
  options?: { parseAmount?: (value: unknown) => number }
): { breakdown: Record<string, AccountBreakdown>; summary: Record<string, number> } {
  const parseAmount = options?.parseAmount ?? legacyParseAmount;
  const result: Record<string, AccountBreakdown> = {};
  const summary: Record<string, number> = {};
  // บัญชีที่มีแต่รายการชำระแล้ว: เก็บแยก ต่อท้ายผลลัพธ์ภายหลัง เพื่อไม่ให้กระทบ key/ลำดับของ summary
  const paidOnly: Record<string, AccountBreakdown> = {};
  const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
  const normalizedAccounts = Array.isArray(bankAccounts)
    ? Array.from(new Set(bankAccounts.map((item) => String(item || '').trim()).filter(Boolean)))
    : [];

  normalizedAccounts.forEach((account) => {
    result[account] = { items: [], paidItems: [], total: 0 };
    summary[account] = 0;
  });

  Object.entries(expenseData || {}).forEach(([itemKey, itemValue]) => {
    if (!itemValue || typeof itemValue !== 'object' || Array.isArray(itemValue)) return;
    if (ACCOUNT_SUMMARY_SKIP_KEYS.includes(itemKey)) return;
    // ผ่านการกรอง metadata key แล้ว ที่เหลือคือรายการค่าใช้จ่ายจริง (รันไทม์รับประกันรูปร่างนี้)
    const item = itemValue as Partial<ExpenseItem> & {
      resolvedDueDate?: string;
      cycleMonth?: string;
      breakdown?: CardTotalExpenseRow['breakdown'];
      dueDay?: unknown;
    };
    const paid = isPaidFlag(item?.paid);

    const accountName = (typeof item.account === 'string' && item.account.trim().length > 0)
      ? item.account.trim()
      : (LEGACY_ITEM_ACCOUNT_MAP[itemKey] || 'ไม่ระบุบัญชี');

    const amount = parseAmount(item?.actual || 0);
    const trimmedName = typeof item.name === 'string' ? item.name.trim() : '';
    const entry: AccountBreakdownItem = {
      key: itemKey,
      name: trimmedName || itemKey,
      amount,
      account: accountName,
      paid
    };
    if (item.dueDay !== undefined) entry.dueDay = item.dueDay;
    if (item.resolvedDueDate !== undefined) entry.resolvedDueDate = item.resolvedDueDate;
    if (item.cycleMonth !== undefined) entry.cycleMonth = item.cycleMonth;
    if (item.breakdown !== undefined) entry.breakdown = item.breakdown;

    if (paid) {
      if (hasOwn(result, accountName)) {
        result[accountName].paidItems.push(entry);
      } else {
        if (!hasOwn(paidOnly, accountName)) paidOnly[accountName] = { items: [], paidItems: [], total: 0 };
        paidOnly[accountName].paidItems.push(entry);
      }
      return;
    }

    // แถวที่ยังไม่ชำระ: เหมือน HEAD ทุกประการ (เช็ค `in` แล้วสร้าง bucket แล้วบวกต่อเนื่อง รวม NaN)
    if (!(accountName in summary)) {
      summary[accountName] = 0;
    }
    summary[accountName] += amount;

    if (!hasOwn(result, accountName)) {
      result[accountName] = hasOwn(paidOnly, accountName)
        ? paidOnly[accountName]
        : { items: [], paidItems: [], total: 0 };
      delete paidOnly[accountName];
    }
    result[accountName].items.push(entry);
    result[accountName].total += amount;
  });

  Object.keys(paidOnly).forEach((account) => {
    result[account] = paidOnly[account];
  });

  return { breakdown: result, summary };
}

/**
 * คำนวณสรุปยอดตามบัญชีจากข้อมูลค่าใช้จ่าย (ผลลัพธ์ตรงกับ implementation เดิมทุกไบต์)
 * @param {object} expenseData - ข้อมูลค่าใช้จ่ายแบบ flat
 * @param {array} bankAccounts - รายชื่อบัญชีที่อนุญาต
 * @returns {object} สรุปยอด {ชื่อบัญชี: ยอดรวม}
 */
export function getAccountSummary(
  expenseData: Record<string, unknown> | undefined,
  bankAccounts: string[] = DEFAULT_BANK_ACCOUNTS,
  options?: { parseAmount?: (value: unknown) => number }
): Record<string, number> {
  return buildAccountData(expenseData, bankAccounts, options).summary;
}

/**
 * คีย์ metadata ที่ไม่ใช่แถวรายจ่ายจริง — ต้องข้ามตอนรวมยอด (TD-L04)
 * แหล่งเดียว: monthlySummary.ts (frontend) import ชุดนี้จากไฟล์นี้
 */
export const EXPENSE_METADATA_KEYS = new Set([
  'totalActualPaid', 'accountSummary', 'bankAccounts',
  'month', '_id', 'id', 'userId', 'periodKey', '__removeKeys'
]);

/**
 * คำนวณยอดรวมค่าใช้จ่ายจากข้อมูล
 * @param {object} expenseData - ข้อมูลค่าใช้จ่ายแบบ flat
 * @returns {object} {totalActualPaid}
 */
export function getExpenseTotals(expenseData: Record<string, unknown> | undefined): { totalActualPaid: number } {
  let totalActualPaid = 0; // รวมยอดจ่ายจริง
  // วนลูปแต่ละรายการค่าใช้จ่าย — ข้าม metadata key ที่รู้จักและค่าที่เป็น array เสมอ (TD-L04)
  Object.entries(expenseData || {}).forEach(([key, itemValue]) => {
    if (EXPENSE_METADATA_KEYS.has(key)) return;
    if (itemValue && typeof itemValue === 'object' && !Array.isArray(itemValue)) {
      const item = itemValue as Partial<{ actual: number | string }>;
      totalActualPaid += parseFloat(String(item.actual || 0));
    }
  });
  // คืนค่าโดยปัดเศษ 2 ตำแหน่ง
  return {
    totalActualPaid: Math.round(totalActualPaid * 100) / 100
  };
}

/**
 * ลบฟิลด์สรุปยอด/metadata ออกจากข้อมูล
 * @param {object} data - ข้อมูลดิบ
 * @returns {object} ข้อมูลที่ถูกทำความสะอาดแล้ว
 */
export function removeSummaryFields(data: Record<string, unknown> = {}): Record<string, unknown> {
  const cleaned = { ...data }; // คัดลอก data object
  // ลบฟิลด์ที่เป็น metadata และไม่ต้องบันทึกลงฐานข้อมูล
  ['totalActualPaid', 'accountSummary', 'month', '_id', '__removeKeys'].forEach(field => {
    delete cleaned[field];
  });
  return cleaned; // คืน object ที่ทำความสะอาดแล้ว
}
