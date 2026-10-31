/**
 * รายการค่าใช้จ่ายมาตรฐานที่ใช้ร่วมกันทั้ง frontend (virtual defaults) และ backend (seed ตอน PATCH paid — ADR-028)
 */
import { END_OF_MONTH_DUE_DAY } from './dateUtils';

// แถว credit_<bank> แบบกรอกเองถูกเลิกใช้ (spec-credit-card-spend §6) — ยอดบัตรมาจากแถว ccr_ ยอดรวมบัตร
// map นี้ใช้เติมบัญชีให้แถวค่าเริ่มต้นตอน seed เท่านั้น จึงไม่มีคีย์ credit_* อีก
// (แถว credit_* เก่าที่เก็บไว้ยัง render ได้ตามเดิม — fallback บัญชีของมันอยู่ใน commonUtils/numberUtils)
export const LEGACY_ITEM_ACCOUNT_MAP: Record<string, string> = {
  house: 'ttb',
  shopee: 'กสิกร',
  netflix: 'กสิกร',
  youtube: 'กสิกร',
  youtube_membership: 'กสิกร'
};

export const DEFAULT_EXPENSE_ITEMS: { key: string; label: string }[] = [
  { key: 'house', label: 'ค่าบ้าน' },
  { key: 'water', label: 'ค่าน้ำ' },
  { key: 'internet', label: 'ค่าเน็ต' },
  { key: 'electricity', label: 'ค่าไฟ' },
  { key: 'mobile', label: 'โทรศัพท์มือถือ' }
];

export interface SeedExpenseRow {
  name: string;
  actual: number;
  account: string;
  paid: boolean;
  dueDay: string;
}

export function buildDefaultExpenseRows(bankAccounts: string[] = []): Record<string, SeedExpenseRow> {
  const rows: Record<string, SeedExpenseRow> = {};
  DEFAULT_EXPENSE_ITEMS.forEach(({ key, label }) => {
    rows[key] = {
      name: label,
      actual: 0,
      account: LEGACY_ITEM_ACCOUNT_MAP[key] || bankAccounts[0] || 'ไม่ระบุบัญชี',
      paid: false,
      dueDay: END_OF_MONTH_DUE_DAY
    };
  });
  return rows;
}
