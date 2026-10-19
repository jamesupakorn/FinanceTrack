/**
 * รายการค่าใช้จ่ายมาตรฐานที่ใช้ร่วมกันทั้ง frontend (virtual defaults) และ backend (seed ตอน PATCH paid — ADR-028)
 */
import { END_OF_MONTH_DUE_DAY } from './dateUtils';

export const LEGACY_ITEM_ACCOUNT_MAP: Record<string, string> = {
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
