/**
 * savingsLoanSync.ts
 * เส้นทางเขียนของการคืนเงินกู้ออม (spec-savings-loan-withdrawal §4.9) — เรียกจาก pages/api/monthly_expense.ts เท่านั้น
 * - stripSavingsLoanRepaymentKeys: ตัดคีย์ slr_ ออกจาก payload ของการบันทึกเดือนปกติ (D-SLW-15, C-S3-7)
 * - applySavingsLoanRepayment: เขียนแถว slr_ + อัปเดตเงินกู้ + ตัดหน้าต่างเดือน ใน transaction เดียวของ withAudit
 *
 * ⚠ ต่างจาก creditCardSync โดยตั้งใจ: ไฟล์นี้ไม่กลืน error และไม่มี try/catch (parent C-4, C-S3-1)
 *   ความล้มเหลวทุกแบบต้องกลายเป็น status ≥ 400 หรือ throw ให้ withAudit rollback ทั้งแถวและเงินกู้พร้อมกัน
 *   (Mongo: WriteConflict ต้องไปถึง withTransaction เพื่อ retry — E-SLW-8)
 */

import crypto from 'crypto';
import { getMongoCollection, isJsonMode, withGeneratedId } from '../../../../lib/dataSource';
import { getUserData, updateUserData } from '../../../backend/data/userUtils';
import { enforceSharedMonthWindowJson, enforceSharedMonthWindowMongo } from './sharedMonthWindow';
import { loadLedgerContext, replaceLoan } from './savingsLedgerStore';
import {
  isSavingsLoanRepaymentRowKey,
  planRepayment,
  type SavingsLoan,
  type SavingsLoanRepayment,
  type SavingsLoanStatus
} from '../savingsLedger';
import type { SavingsGoal } from './savingsGoalBalances';

const EXPENSE_JSON_FILE = 'monthly_expense.json';
const EXPENSE_COLLECTION = 'monthly_expense';
const GOAL_NAME_MAX_LENGTH = 100;
const DEFAULT_ACCOUNT_LABEL = 'ไม่ระบุบัญชี';
const POOL_ROW_NAME = 'คืนเงินกู้ · ยอดกลาง';
const GOAL_ROW_NAME = 'คืนเงินกู้ · เป้าหมาย';
// สตริงเดียวกับ planPaidPatch (monthly_expense.ts) — C-S3-15 ให้ใช้ข้อความเดิมตรงตัว
export const LEGACY_EXPENSE_DOC_ERROR = 'Legacy expense document cannot be updated per row';

/**
 * ตัดคีย์แถวคืนเงินกู้ (slr_<24hex>) ออกจาก expense payload และออกจาก __removeKeys
 * แถว slr_ สร้างได้จาก flow คืนเงินกู้เท่านั้น — การบันทึกเดือนปกติต้องสร้าง/แก้/ลบไม่ได้
 * รูปแบบเดียวกับ stripCreditCardKeys (creditCardSync.ts) · ใช้ predicate แบบ strict ตัวเดียว (C-S3-10)
 * @param expenseData - payload หลัง applyCreditCardPaid
 * @returns payload ใหม่ที่ไม่มีคีย์ slr_ (ไม่แก้ object เดิม)
 */
export function stripSavingsLoanRepaymentKeys<T extends Record<string, unknown>>(expenseData: T): T {
  const cleaned: Record<string, unknown> = {};
  Object.keys(expenseData).forEach(key => {
    if (isSavingsLoanRepaymentRowKey(key)) return;
    cleaned[key] = expenseData[key];
  });

  // extractRemovalKeys ไม่สนค่าที่ไม่ใช่ array จึงกรองเฉพาะกรณี array
  if (Array.isArray(cleaned.__removeKeys)) {
    cleaned.__removeKeys = cleaned.__removeKeys.filter(
      (key: unknown) => !isSavingsLoanRepaymentRowKey(key)
    );
  }

  return cleaned as T;
}

// ---------------------------------------------------------------------------
// Repayment write (spec §4.9, C-S3-3…C-S3-6, C-S3-14, C-S3-15)
// ---------------------------------------------------------------------------

export interface SavingsLoanRepaymentInput {
  loanId: string;
  /** ผ่าน toLedgerAmount มาแล้ว (route ตรวจ 400 invalid_amount ก่อนเรียก) */
  amount: number;
  /** 'YYYY-MM' ที่ผ่านการตรวจช่วง D-SLW-22 แล้ว */
  month: string;
  account?: string;
}

/** นาฬิกาของ request เดียว (C-S3-5, C-S3-13): now ตัวเดียว และ "วันนี้" แบบ Asia/Bangkok ที่ derive จาก now */
export interface RepaymentClock {
  now: string;
  today: { monthKey: string; day: number };
}

export type SavingsLoanRepaymentResult =
  | {
      ok: true;
      repayment: SavingsLoanRepayment;
      appliedAmount: number;
      outstandingAmount: number;
      status: SavingsLoanStatus;
      rowKey: string;
    }
  | { ok: false; status: 404 | 409; error: string };

interface RepaymentExpenseRow {
  name: string;
  actual: number;
  account: string;
  paid: true;
  dueDay: number | 'EOM';
}

/** D-SLW-23: ชื่อแถว — เป้าหมายที่หาไม่เจอ (ลบ/abandoned) ใช้ "เป้าหมาย" เปล่า ๆ ไม่ถือเป็น error */
function buildRowName(loan: SavingsLoan, goals: SavingsGoal[]): string {
  if (loan.source.type !== 'goal') return POOL_ROW_NAME;
  const goal = goals.find(entry => String(entry._id) === loan.source.goalId);
  const goalName = typeof goal?.goalName === 'string' ? goal.goalName.trim() : '';
  if (!goalName) return GOAL_ROW_NAME;
  // ตัดตาม code point เพื่อไม่ผ่าครึ่ง surrogate pair (E-SLW-29)
  return `${GOAL_ROW_NAME} ${Array.from(goalName).slice(0, GOAL_NAME_MAX_LENGTH).join('')}`;
}

function buildRepaymentRow(
  name: string,
  appliedAmount: number,
  account: string | undefined,
  month: string,
  today: RepaymentClock['today']
): RepaymentExpenseRow {
  const trimmedAccount = (account ?? '').trim();
  return {
    name,
    actual: appliedAmount,
    account: trimmedAccount || DEFAULT_ACCOUNT_LABEL,
    paid: true,
    dueDay: month === today.monthKey ? today.day : 'EOM'
  };
}

/** เอกสารเดือนแบบ legacy (`actual` เป็น record) เขียนรายแถวไม่ได้ — เกณฑ์เดียวกับ planPaidPatch */
function isLegacyExpenseDoc(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return false;
  const actual = (doc as Record<string, unknown>).actual;
  return actual !== null && typeof actual === 'object' && !Array.isArray(actual);
}

function readMonthDocJson(userId: string, month: string): unknown {
  return (getUserData(EXPENSE_JSON_FILE, userId) as Record<string, unknown>)[month];
}

function writeRepaymentRowJson(userId: string, month: string, rowKey: string, row: RepaymentExpenseRow): void {
  updateUserData(EXPENSE_JSON_FILE, userId, bucket => {
    const existing = bucket[month];
    const base = existing && typeof existing === 'object' ? (existing as Record<string, unknown>) : {};
    return { ...bucket, [month]: withGeneratedId({ ...base, [rowKey]: row, month }) };
  });
}

// Mongo: getMongoCollection คืน handle ที่ผูก session ของ withAudit แล้ว (wrapCollection) — การอ่าน/เขียนทุกครั้ง
// อยู่ใน transaction เดียวกับ replaceLoan ห้ามใช้ db.collection() ตรง ๆ (S2c review)
// ไม่มี try/catch: WriteConflict ต้องไปถึง withTransaction เพื่อ retry ทั้ง callback (C-S3-1, E-SLW-8)

async function readMonthDoc(userId: string, month: string): Promise<unknown> {
  if (isJsonMode()) return readMonthDocJson(userId, month);
  const collection = await getMongoCollection(EXPENSE_COLLECTION);
  return collection.findOne({ month, userId });
}

async function writeRepaymentRow(userId: string, month: string, rowKey: string, row: RepaymentExpenseRow): Promise<void> {
  if (isJsonMode()) {
    writeRepaymentRowJson(userId, month, rowKey, row);
    return;
  }
  // rowKey ผ่าน REPAYMENT_ROW_KEY_RE (slr_<24hex>) จึงใช้เป็น field path ของ $set ได้ปลอดภัย (C-S3-5, C-S3-6)
  const collection = await getMongoCollection(EXPENSE_COLLECTION);
  await collection.updateOne(
    { month, userId },
    { $set: { [rowKey]: row, month, userId } },
    { upsert: true }
  );
}

async function enforceMonthWindow(userId: string, month: string): Promise<void> {
  if (isJsonMode()) {
    enforceSharedMonthWindowJson(userId, { extraMonth: month });
    return;
  }
  await enforceSharedMonthWindowMongo(userId, { extraMonth: month });
}

/**
 * บันทึกการคืนเงินกู้หนึ่งครั้ง (spec §4.9). ต้องเรียกภายใน withAudit — การเขียนทั้งหมดอยู่ใน transaction เดียว
 * ผลลัพธ์ ok:false ต้องถูกส่งต่อเป็น HTTP status เดียวกัน (≥ 400) เพื่อให้ withAudit ไม่ commit อะไรเลย
 * รวมถึงแถวที่เขียนไปแล้วในกรณี replaceLoan คืน false (C-S3-4)
 *
 * ลำดับ: เงินกู้ (404) → planRepayment (409) → ชื่อเป้าหมาย → เอกสาร legacy (409) → เขียนแถว slr_
 * → replaceLoan (false = 404) → ตัดหน้าต่าง 15 เดือนเป็นการเขียนสุดท้าย
 * ผลของการตัดหน้าต่างไม่ถูกตรวจ: เดือนของการคืนเองอาจถูกตัดใน request เดียวกันได้ (C-S3-14, Q-S3-2)
 * — ข้อมูลเงินกู้อยู่คนละ collection จึงไม่กระทบ หายแค่แถวที่แสดง
 */
export async function applySavingsLoanRepayment(
  userId: string,
  input: SavingsLoanRepaymentInput,
  clock: RepaymentClock
): Promise<SavingsLoanRepaymentResult> {
  const { loanId, amount, month, account } = input;

  // ไม่มี single-loan read ใน store — ใช้ context + find แบบเดียวกับ DELETE ของ S1 (C-S3-3)
  const ctx = await loadLedgerContext(userId, { includeGoals: true });
  const loan = ctx.loans.find(entry => entry._id === loanId);
  if (!loan) return { ok: false, status: 404, error: 'loan_not_found' };

  const repaymentId = crypto.randomBytes(12).toString('hex');
  const plan = planRepayment(loan, amount, clock.now, repaymentId, month);
  if (!plan.ok) return { ok: false, status: plan.status, error: plan.error };

  const rowKey = plan.repayment.expenseRowKey;
  const row = buildRepaymentRow(buildRowName(loan, ctx.goals ?? []), plan.applied, account, month, clock.today);

  // ตรวจก่อนเขียนใด ๆ — ไม่มีอะไรถูก commit (C-S3-15)
  if (isLegacyExpenseDoc(await readMonthDoc(userId, month))) {
    return { ok: false, status: 409, error: LEGACY_EXPENSE_DOC_ERROR };
  }

  await writeRepaymentRow(userId, month, rowKey, row);

  // เงินกู้หายไประหว่างทาง (ถูกลบพร้อมกัน) → 404 ซึ่งทำให้ withAudit ทิ้งแถวที่เพิ่งเขียน (C-S3-4)
  // (JSON: runJsonTransaction ไม่ commit · Mongo: AbortMutation ใน withTransaction → abort ทั้ง transaction)
  if (!(await replaceLoan(userId, plan.nextLoan))) {
    return { ok: false, status: 404, error: 'loan_not_found' };
  }

  // การเขียนสุดท้ายเสมอ มิฉะนั้นเดือนเก่าที่เพิ่งถูกตัดจะถูกสร้างกลับ (§2(f)3)
  await enforceMonthWindow(userId, month);

  return {
    ok: true,
    repayment: plan.repayment,
    appliedAmount: plan.applied,
    outstandingAmount: plan.nextLoan.outstandingAmount,
    status: plan.nextLoan.status,
    rowKey
  };
}
