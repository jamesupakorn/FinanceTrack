/**
 * creditCardSync.ts  (server-only)
 * เชื่อมแผนผ่อนชำระ + ยอดใช้จ่ายหมุนเวียน เข้ากับ ExpenseTable
 * แบบ derive-on-read / strip-on-write (ADR-009 · ADR-011 · BR-CC-007 · BR-CC-016)
 *
 * ค่าคงที่ของดีไซน์นี้:
 *   เอกสารใน monthly_expense ต้องไม่มีคีย์ที่ขึ้นต้นด้วย /^cci_/ หรือ /^ccr_/ เด็ดขาด
 *   - GET : inject แถวที่ derive ได้ ก่อน getAccountSummary / getExpenseTotals
 *   - POST: อ่านเฉพาะ paid กลับเข้าแผน/cycle แล้วลบคีย์ทิ้งก่อนเขียนลง storage
 *
 * ไม่มี write ทิศทาง card → expense จึงไม่มี loop ให้ต้องกัน และแถวซ้ำเป็นไปไม่ได้
 * เพราะคีย์เป็น pure function ของ (planId, installmentNo) และของ cardId
 */

import crypto from 'crypto';
import {
  INSTALLMENT_KEY_RE,
  INSTALLMENT_KEY_PREFIX,
  REVOLVING_KEY_PREFIX,
  buildInstallmentRowKey,
  parseInstallmentRowKey,
  buildRevolvingRowKey,
  parseRevolvingRowKey,
  resolvePlanStatus,
  resolveCardDueDate,
  getPayableCycleMonth,
  getCardDueMonth,
  getCurrentMonthKey,
  isCreditCardRowKey,
  isValidPaymentAction,
  round2,
  MAX_REVOLVING_CYCLES_PER_CARD,
  PLAN_STATUS
} from '../creditCardUtils';
import { getUserCreditData, updateUserCreditData } from './creditCardStore';
import { buildRevolvingCyclesForData, isMonthBeyondRevolvingCap } from '../creditCardRevolving';
import type { PlanLike, StoredRevolvingCycle, RevolvingCycleRow } from '../creditCardRevolving';
import { toBankAccountNames, UNASSIGNED_ACCOUNT_LABEL } from '../bankAccountShape';
import { normaliseBankAccountEntry } from './bankAccountIds';

export { INSTALLMENT_KEY_RE, INSTALLMENT_KEY_PREFIX, REVOLVING_KEY_PREFIX };

// ---------------------------------------------------------------------------
// Local structural types — narrow shapes reflecting only the fields this file
// actually reads/writes, same "type only what's needed" precedent as
// creditCardRevolving.ts's own CardLike/PlanLike (TD-H02, slice 13)
// ---------------------------------------------------------------------------

interface SyncCard {
  id?: string;
  name?: string;
  bankName?: string;
  bankAccountId?: string;
  /** type เท่านั้น — การ์ดที่เก็บไว้ถูกส่งมาทั้งก้อนอยู่แล้ว (normaliseCreditData) ไม่ต้อง passthrough */
  statementDay?: number | string | null;
  dueDay?: number | string;
  [key: string]: unknown;
}

interface SyncScheduleRow {
  no?: number;
  dueMonth?: string;
  payment?: number | string;
  paid?: boolean;
  paidAt?: string | null;
  paidSource?: string | null;
  [key: string]: unknown;
}

interface SyncPlan {
  id?: string;
  cardId?: string;
  itemName?: string;
  months?: number;
  status?: string;
  schedule?: SyncScheduleRow[];
  updatedAt?: string;
  [key: string]: unknown;
}

interface SyncCycle {
  id?: string;
  cardId?: string;
  month?: string;
  newSpend?: number | string;
  paymentAction?: string | null;
  paidAt?: string | null;
  paidSource?: string | null;
  [key: string]: unknown;
}

/** Loose shape accepted by the 4 read/derive functions — matches this file's own original JSDoc
 * (`@param {object} creditData - {cards, plans}`), deliberately not tied by name to
 * creditCardStore.ts's own CreditData (module-private, not exported). Structurally compatible either
 * way: CreditData's required `unknown[]` fields satisfy these optional ones with zero cast. */
interface CreditDataLike {
  cards?: unknown;
  plans?: unknown;
  cycles?: unknown;
  spendItems?: unknown;
}

/** spendItems ของ creditData แบบ defensive — เอกสารเก่าไม่มี field นี้ */
function spendItemsOf(creditData: CreditDataLike | null | undefined): Array<{ cardId?: unknown; month?: unknown }> {
  const raw = creditData?.spendItems;
  return (Array.isArray(raw) ? raw : []).filter(item => item && typeof item === 'object');
}

/** สายยอดหมุนเวียนของบัตร — ส่ง spendItems เสมอผ่าน wrapper (spec-credit-card-spend §5.2) */
function chainFor(card: SyncCard, creditData: CreditDataLike, throughMonth: string) {
  return buildRevolvingCyclesForData(
    card,
    { cycles: creditData.cycles, spendItems: creditData.spendItems },
    { throughMonth }
  );
}

/** The 2 update-instruction shapes derived from parsing ExpenseTable payload keys. */
interface InstallmentUpdate {
  planId: string;
  installmentNo: number;
  paid: boolean;
}
interface RevolvingUpdate {
  cardId: string;
  paid: boolean;
  /** cycleMonth ที่ client echo มาจากแถว GET — ใช้เป็นตัวกันข้อมูลเก่า (DP-4) เท่านั้น ไม่เคยเลือกรอบบิลเอง */
  cycleMonth: unknown;
}

/** รูปแบบเดียวกับ monthlyExpensePatchBodySchema.cycleMonth (เดือน 01-12) */
const CYCLE_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

type CycleGuardResult = 'ok' | 'malformed' | 'mismatch';

/**
 * ตัวกันข้อมูลเก่าของแถว ccr_ (DP-4): เซิร์ฟเวอร์คำนวณรอบบิลเป้าหมายเองเสมอ (expected)
 * cycleMonth จาก client ใช้ตรวจว่าตรงกันเท่านั้น — ไม่ส่ง (undefined/null) = ผ่าน (client เก่า)
 */
function checkCycleMonthGuard(cycleMonth: unknown, expected: string): CycleGuardResult {
  if (cycleMonth === undefined || cycleMonth === null) return 'ok';
  if (typeof cycleMonth !== 'string' || !CYCLE_MONTH_PATTERN.test(cycleMonth)) return 'malformed';
  return cycleMonth === expected ? 'ok' : 'mismatch';
}

/** One derived ExpenseTable row (the shape both buildInstallmentExpenseRows/buildRevolvingExpenseRows
 * return per key) — dueDay stays `unknown` (not `number | string`) because this file never itself
 * calls `resolveDueDayForMonth` on it; it only forwards `card.dueDay` verbatim for a downstream
 * consumer (expenseEvents.ts) to interpret. */
interface DerivedExpenseRow {
  name: string;
  actual: number;
  account: string;
  paid: boolean;
  dueDay: unknown;
  /**
   * วันครบกำหนดจริงของรอบบิลนี้ 'YYYY-MM-DD' (อาจอยู่เดือนถัดไป) จาก resolveCardDueDate (XM-5)
   * อ่านอย่างเดียว derive ทุกครั้งที่ GET ไม่เคยถูกเก็บ — POST/PATCH strip ทั้งคีย์ cci_/ccr_ (XM-8)
   * ตั้งชื่อไม่ให้ชนกับ dueDate เดิมของแถวธรรมดา (ADR-028)
   */
  resolvedDueDate: string | null;
}

/** Minimal shape needed to read `.paid` off an ExpenseTable payload row after the existing
 * `typeof row !== 'object'` runtime guard (same "narrow `object` doesn't have an index signature, cast
 * immediately after the existing guard" pattern as slice 9's ExpenseRowLike). */
interface PayloadRow {
  paid?: unknown;
  /** แถว ccr_ ที่ Save All echo มาจาก GET อาจมี cycleMonth (DP-4) — อ่านเป็นตัวกันเท่านั้น */
  cycleMonth?: unknown;
}

/** Resolve card dues by stable account id, then the legacy name, then the fixed unassigned bucket. */
function resolveRowAccount(card: SyncCard, bankAccounts: unknown[] = []): string {
  const list = Array.isArray(bankAccounts) ? bankAccounts : [];
  const linkedId = typeof card?.bankAccountId === 'string' ? card.bankAccountId.trim() : '';
  if (linkedId) {
    for (const entry of list) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const account = normaliseBankAccountEntry(entry);
      if (account?.id === linkedId) return account.name;
    }
  }
  const bankName = String(card?.bankName || '').trim();
  if (bankName && toBankAccountNames(list).includes(bankName)) return bankName;
  return UNASSIGNED_ACCOUNT_LABEL;
}

/**
 * แผนนี้ให้แถวของงวดนี้หรือไม่
 * แผนที่ถูกยกเลิกยังคงงวดที่ "ชำระแล้ว" ไว้เป็นประวัติ แต่ไม่ให้งวดอนาคตที่ยังไม่ชำระ (BR-CC-010)
 */
function shouldIncludeRow(plan: SyncPlan | undefined, row: SyncScheduleRow | undefined | null): boolean {
  if (!row) return false;
  if (plan?.status === PLAN_STATUS.CANCELLED) return row.paid === true;
  return true;
}

/**
 * สร้างแถวค่าใช้จ่ายที่ derive จากแผนผ่อนของเดือนที่ระบุ
 * หมายเหตุ (DP-1): ฟังก์ชัน legacy นี้ยังจัดกลุ่มตามรอบบิล (month = dueMonth ของงวด) และไม่ใช่เส้นทาง GET
 * แล้ว (ไม่มีผู้เรียกใน production) — GET ใช้ buildCardTotalExpenseRows ซึ่งจัดวางตามเดือนที่ชำระจริง
 * @param {object} creditData - { cards, plans }
 * @param {string} month - YYYY-MM
 * @param {array} bankAccounts - บัญชีธนาคารของผู้ใช้ (ใช้จับคู่ชื่อบัญชี)
 * @returns {object} map ของ { 'cci_xxx_NN': {name, actual, account, paid, dueDay} } — อาจว่าง
 */
export function buildInstallmentExpenseRows(
  creditData: CreditDataLike | null | undefined,
  month: string,
  bankAccounts: unknown[] = []
): Record<string, DerivedExpenseRow> {
  const rows: Record<string, DerivedExpenseRow> = {};
  if (!creditData || typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return rows;

  const cards = (Array.isArray(creditData.cards) ? creditData.cards : []) as SyncCard[];
  const plans = (Array.isArray(creditData.plans) ? creditData.plans : []) as SyncPlan[];
  if (!plans.length) return rows;

  const cardById = new Map(cards.map(card => [card?.id, card]));

  plans.forEach(plan => {
    const card = cardById.get(plan?.cardId);
    if (!card) return;
    // Narrowing guard (§Design A.5.2): a plan lacking `id` could never have produced a valid,
    // matchable `cci_`-prefixed key in the original untyped `.js` either — behavior-preserving.
    if (!plan.id) return;
    // Additional cast (beyond the 4 documented in §Design A.5, required by `tsc`'s real run, not
    // predicted in the spec): TypeScript's control-flow narrowing of `plan.id` (a property access,
    // not a local variable) does not survive across the nested `schedule.forEach` closure below —
    // captured into a local `const` here so the narrowing carries through. Zero behavior change:
    // `planId` is read once, synchronously, from the same already-guarded `plan.id`.
    const planId = plan.id;
    const schedule = Array.isArray(plan.schedule) ? plan.schedule : [];
    schedule.forEach(row => {
      if (row?.dueMonth !== month) return;
      if (!shouldIncludeRow(plan, row)) return;
      // Narrowing guard (§Design A.5.2): a schedule row lacking `no` could never have produced a
      // valid, matchable key either — behavior-preserving.
      if (row.no === undefined) return;
      rows[buildInstallmentRowKey(planId, row.no)] = {
        name: `${plan.itemName} (งวด ${row.no}/${plan.months})`,
        actual: Number(row.payment) || 0,
        account: resolveRowAccount(card, bankAccounts),
        paid: row.paid === true,
        dueDay: card.dueDay,
        resolvedDueDate: resolveCardDueDate(card, month)
      };
    });
  });

  return rows;
}

/**
 * สร้างแถวค่าใช้จ่ายที่ derive จากยอดใช้จ่ายหมุนเวียนของเดือนที่ระบุ (BR-CC-016)
 * 1 แถวต่อ 1 บัตร และปล่อยออกเมื่อ amountDue > 0 เท่านั้น
 * หมายเหตุ (DP-1): ฟังก์ชัน legacy นี้ยังจัดกลุ่มตามรอบบิล (month = cycle.month) และไม่ใช่เส้นทาง GET
 * แล้ว (ไม่มีผู้เรียกใน production) — GET ใช้ buildCardTotalExpenseRows ซึ่งจัดวางตามเดือนที่ชำระจริง
 * @param {object} creditData - { cards, cycles }
 * @param {string} month - YYYY-MM
 * @param {array} bankAccounts
 * @returns {object} map ของ { 'ccr_xxx': {name, actual, account, paid, dueDay} } — อาจว่าง
 */
export function buildRevolvingExpenseRows(
  creditData: CreditDataLike | null | undefined,
  month: string,
  bankAccounts: unknown[] = []
): Record<string, DerivedExpenseRow> {
  const rows: Record<string, DerivedExpenseRow> = {};
  if (!creditData || typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return rows;

  const cards = (Array.isArray(creditData.cards) ? creditData.cards : []) as SyncCard[];
  const cycles = (Array.isArray(creditData.cycles) ? creditData.cycles : []) as SyncCycle[];
  if (!cards.length || (!cycles.length && !spendItemsOf(creditData).length)) return rows;

  cards.forEach(card => {
    // Narrowing guard (§Design A.5.3): buildRevolvingCycles itself already returns an empty chain
    // when `!cardId`, so this makes an already-true runtime outcome explicit for the type-checker.
    if (!card.id) return;
    const chain = chainFor(card, creditData, month);
    const cycle = chain.find(item => item.month === month);
    if (!cycle || !(cycle.amountDue > 0)) return;

    rows[buildRevolvingRowKey(card.id)] = {
      name: `ยอดใช้จ่ายบัตร ${card.name}${cycle.paymentAction === 'minimum' ? ' (ขั้นต่ำ)' : ''}`,
      actual: cycle.amountDue,
      account: resolveRowAccount(card, bankAccounts),
      paid: cycle.paymentAction !== null,
      dueDay: card.dueDay,
      resolvedDueDate: resolveCardDueDate(card, month)
    };
  });

  return rows;
}

/**
 * รายชื่อเดือนทั้งหมดที่มีแถวผ่อนชำระ
 * ใช้ union เข้ากับ branch "ทุกเดือน" ของ GET เพื่อให้เดือนที่ยังไม่เคยมีเอกสารก็ปรากฏ
 * (Stage 4 MAJOR-1 / AC-34)
 * คืน "เดือนตาราง" (DP-1): dueMonth ของงวด (รอบบิล) แปลงผ่าน getCardDueMonth ของบัตรเจ้าของแผน
 * @param {object} creditData
 * @returns {string[]}
 */
export function getInstallmentMonths(creditData: CreditDataLike | null | undefined): string[] {
  const months = new Set<string>();
  const cardsRaw = creditData?.cards;
  const plansRaw = creditData?.plans;
  const cards = (Array.isArray(cardsRaw) ? cardsRaw : []) as SyncCard[];
  const plans = (Array.isArray(plansRaw) ? plansRaw : []) as SyncPlan[];
  if (!plans.length || !cards.length) return [];
  const cardById = new Map(cards.map(card => [card?.id, card]));

  plans.forEach(plan => {
    const card = cardById.get(plan?.cardId);
    if (!card) return;
    // Narrowing guard (§Design A.5.4): `plan` here is already `SyncPlan` (see above), so
    // `plan.schedule` is already typed `SyncScheduleRow[] | undefined` — no additional cast beyond
    // the top-of-function `SyncPlan[]` cast is needed.
    (Array.isArray(plan.schedule) ? plan.schedule : []).forEach(row => {
      if (!shouldIncludeRow(plan, row)) return;
      if (typeof row?.dueMonth === 'string') months.add(getCardDueMonth(card, row.dueMonth));
    });
  });

  return Array.from(months);
}

/**
 * รายชื่อเดือนทั้งหมดที่มีแถวบัตรเครดิต (งวดผ่อน + ยอดหมุนเวียน)
 * เดือนที่มีเฉพาะแถวหมุนเวียนต้องอยู่ใน list นี้ด้วย มิฉะนั้น branch "ทุกเดือน" จะไม่มีเดือนนั้น
 * คืน "เดือนตาราง" (DP-1): cycle.month และ spend-item month แปลงผ่าน getCardDueMonth ของบัตรเจ้าของ
 * — รอบบิลปัจจุบันของบัตรข้ามเดือน (offset 1) จึงได้เดือนถัดไปมาด้วย (เดือน derive-only)
 * @param {object} creditData
 * @returns {string[]}
 */
export function getCreditCardMonths(creditData: CreditDataLike | null | undefined): string[] {
  const months = new Set(getInstallmentMonths(creditData));

  const cardsRaw = creditData?.cards;
  const cyclesRaw = creditData?.cycles;
  const cards = (Array.isArray(cardsRaw) ? cardsRaw : []) as SyncCard[];
  const cycles = (Array.isArray(cyclesRaw) ? cyclesRaw : []) as SyncCycle[];
  const spendItems = spendItemsOf(creditData);
  if (cards.length && (cycles.length || spendItems.length)) {
    // materialise ถึงเดือนปัจจุบันเสมอ เพื่อให้เดือนที่มีแต่ยอดยกมาก็ปรากฏ
    const throughMonth = getCurrentMonthKey();
    const cardById = new Map(cards.map(card => [card?.id, card]));
    cards.forEach(card => {
      if (!card?.id || !creditData) return;
      chainFor(card, creditData, throughMonth).forEach(cycle => {
        // ตรงกับกติกาแสดงแถวยอดรวมบัตร (§4.3 / R2 ตัวเลือก ก): totalDue ≠ 0 รวมเดือนเครดิตด้วย
        if (cycle.amountDue > 0 || cycle.totalDue !== 0) months.add(getCardDueMonth(card, cycle.month));
      });
    });
    // เดือนที่มีรายการไม่ผ่อน (แม้ผลรวม 0) ก็มีแถวยอดรวมบัตร
    spendItems.forEach(item => {
      const card = cardById.get(item.cardId as string | undefined);
      if (card && typeof item.month === 'string' && /^\d{4}-\d{2}$/.test(item.month)) {
        months.add(getCardDueMonth(card, item.month));
      }
    });
  }

  return Array.from(months);
}

// ---------------------------------------------------------------------------
// แถวยอดรวมบัตร (spec-credit-card-spend §4.3 · SPEND-4/6)
// ---------------------------------------------------------------------------

/** งวดผ่อนหนึ่งบรรทัดใน breakdown ของแถวยอดรวมบัตร (คีย์ cci_ อยู่ข้างใน ไม่ใช่คีย์ระดับบน) */
export interface CardTotalInstallmentLine {
  key: string;
  name: string;
  amount: number;
  paid: boolean;
}

/** ส่วนยอดหมุนเวียนของแถวยอดรวมบัตร — ทุกตัวเลขมาจาก buildRevolvingCycles (BR-CC-013) */
export interface CardTotalRevolvingPart {
  newSpend: number;
  carriedBalance: number;
  cashbackAmount: number;
  totalDue: number;
  minPaymentDue: number;
  amountDue: number;
  paymentAction: 'full' | 'minimum' | null;
}

/** แถว ccr_<cardId> แบบยอดรวมบัตร — derive ตอน GET เท่านั้น ไม่เคยถูกเก็บ */
export interface CardTotalExpenseRow extends DerivedExpenseRow {
  derived: true;
  /** รอบบิล (YYYY-MM) ที่แถวนี้แสดงตัวเลข (DP-4) — derive ตอน GET ไม่เคยถูกเก็บ ไม่ใช่ข้อมูลเงิน */
  cycleMonth: string;
  breakdown: {
    installments: CardTotalInstallmentLine[];
    installmentTotal: number;
    revolving: CardTotalRevolvingPart;
  };
}

const EMPTY_REVOLVING_PART: CardTotalRevolvingPart = {
  newSpend: 0,
  carriedBalance: 0,
  cashbackAmount: 0,
  totalDue: 0,
  minPaymentDue: 0,
  amountDue: 0,
  paymentAction: null
};

interface CardMonthState {
  installments: CardTotalInstallmentLine[];
  installmentTotal: number;
  cycle: RevolvingCycleRow | null;
  hasItems: boolean;
  /** SPEND-6 */
  paid: boolean;
}

/**
 * สถานะของบัตรหนึ่งใบในรอบบิลหนึ่ง — ใช้ร่วมกันระหว่าง GET (แสดงแถว) และการจ่ายยอดรวม (ฟังก์ชันล้วน)
 * @param month - cycleMonth: รอบบิล (ไม่ใช่เดือนตาราง) — ผู้เรียกแปลงด้วย getPayableCycleMonth แล้ว (DP-1)
 */
function computeCardMonthState(card: SyncCard, creditData: CreditDataLike, month: string): CardMonthState {
  const plans = (Array.isArray(creditData.plans) ? creditData.plans : []) as SyncPlan[];
  const installments: CardTotalInstallmentLine[] = [];
  plans.forEach(plan => {
    if (plan?.cardId !== card.id || !plan.id) return;
    const planId = plan.id;
    (Array.isArray(plan.schedule) ? plan.schedule : []).forEach(row => {
      if (row?.dueMonth !== month) return;
      if (!shouldIncludeRow(plan, row)) return;
      if (row.no === undefined) return;
      installments.push({
        key: buildInstallmentRowKey(planId, row.no),
        name: `${plan.itemName} (งวด ${row.no}/${plan.months})`,
        amount: Number(row.payment) || 0,
        paid: row.paid === true
      });
    });
  });
  const installmentTotal = round2(installments.reduce((sum, line) => sum + line.amount, 0));
  const cycle = card.id ? (chainFor(card, creditData, month).find(item => item.month === month) || null) : null;
  const hasItems = spendItemsOf(creditData).some(item => item.cardId === card.id && item.month === month);
  const amountDue = cycle ? cycle.amountDue : 0;
  const paid = installments.every(line => line.paid)
    && (cycle === null || cycle.paymentAction !== null || amountDue <= 0);
  return { installments, installmentTotal, cycle, hasItems, paid };
}

/**
 * แถวยอดรวมบัตรของเดือนตารางที่ระบุ: 1 แถว ccr_<cardId> ต่อบัตร (ไม่จัดกลุ่มตามธนาคาร)
 * month = เดือนตาราง (เดือนที่ชำระจริง, DP-1) — แต่ละบัตรแสดงรอบบิล cycleMonth = getPayableCycleMonth(card, month)
 *   บัตร offset 1 (dueDay <= statementDay) จึงแสดงรอบบิลเดือนก่อน · บัตร offset 0 แสดงรอบบิลเดือนเดียวกัน
 * แสดงเมื่อบัตรมีงวดผ่อนในรอบนั้น หรือมีรายการไม่ผ่อน หรือ totalDue ของยอดหมุนเวียน ≠ 0 (R2 ตัวเลือก ก)
 * actual = ผลรวมงวดผ่อน + max(0, totalDue) (SPEND-4) · จ่ายขั้นต่ำแสดงแยก · paid ตาม SPEND-6
 * งวดผ่อนอยู่ใน breakdown.installments เท่านั้น — ไม่มีคีย์ cci_ ระดับบน (§3.4 / R1c)
 */
export function buildCardTotalExpenseRows(
  creditData: CreditDataLike | null | undefined,
  month: string,
  bankAccounts: unknown[] = []
): Record<string, CardTotalExpenseRow> {
  const rows: Record<string, CardTotalExpenseRow> = {};
  if (!creditData || typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return rows;
  const cards = (Array.isArray(creditData.cards) ? creditData.cards : []) as SyncCard[];

  cards.forEach(card => {
    if (!card?.id) return;
    const cycleMonth = getPayableCycleMonth(card, month);
    const state = computeCardMonthState(card, creditData, cycleMonth);
    const { cycle } = state;
    if (!state.installments.length && !state.hasItems && !(cycle && cycle.totalDue !== 0)) return;

    const revolving: CardTotalRevolvingPart = cycle
      ? {
        newSpend: cycle.newSpend,
        carriedBalance: cycle.carriedBalance,
        cashbackAmount: cycle.cashbackAmount,
        totalDue: cycle.totalDue,
        minPaymentDue: cycle.minPaymentDue,
        amountDue: cycle.amountDue,
        paymentAction: cycle.paymentAction
      }
      : { ...EMPTY_REVOLVING_PART };

    rows[buildRevolvingRowKey(card.id)] = {
      name: `ยอดบัตร ${card.name}`,
      actual: round2(state.installmentTotal + Math.max(0, revolving.totalDue)),
      account: resolveRowAccount(card, bankAccounts),
      paid: state.paid,
      dueDay: card.dueDay,
      // จัดวางในเดือนที่ชำระจริง (DP-1 แทน XM-1) — ส่วนเดือนของ resolvedDueDate เท่ากับ month เสมอโดยโครงสร้าง
      resolvedDueDate: resolveCardDueDate(card, cycleMonth),
      derived: true,
      cycleMonth,
      breakdown: {
        installments: state.installments,
        installmentTotal: state.installmentTotal,
        revolving
      }
    };
  });

  return rows;
}

/** ยอดที่ต้องจ่ายของบัตรหนึ่งใบในเดือนหนึ่ง สำหรับ tile บน /credit-cards (spec-credit-card-tiles §3.2) */
export interface CardMonthDue {
  /** YYYY-MM ของเดือนที่คำนวณ (เดือนปฏิทินตามเวลาเซิร์ฟเวอร์ ไม่ใช่รอบบิล) */
  dueMonth: string;
  /** = row.breakdown.installmentTotal (รวมงวดที่จ่ายแล้ว เหมือนแถว ccr_) */
  installmentDueThisMonth: number;
  /** = max(0, row.breakdown.revolving.totalDue) — เทอมเดียวกับที่แถวใช้ (REV-2) */
  revolvingDueThisMonth: number;
  /** = row.actual (ยอดเต็ม แม้เลือกจ่ายขั้นต่ำ — SPEND-4) */
  totalDueThisMonth: number;
  /** จำนวนงวดผ่อนของบัตรในรอบนี้ = row.breakdown.installments.length (Addendum A) */
  installmentCount: number;
  /** จำนวนงวดที่ชำระแล้ว = breakdown.installments ที่ paid === true (Addendum A) */
  installmentPaidCount: number;
}

/**
 * แผนที่ cardId -> CardMonthDue อ่านจากแถว ccr_<cardId> ของ buildCardTotalExpenseRows เท่านั้น
 * (เรียกครั้งเดียว ไม่มีสูตรที่สอง) · ทุกบัตรใน creditData.cards มี entry เสมอ (ไม่มีแถว = ศูนย์)
 * month = เดือนปฏิทิน → ได้รอบบิลที่ต้องชำระในเดือนนั้นตาม DP-1 (OQ-1: tile == แถว ccr_ ของเดือนเดียวกัน)
 * คำนวณตอน request เท่านั้น ห้ามบันทึกลงเอกสาร (BR-CC-013)
 */
export function buildCardMonthDueMap(
  creditData: CreditDataLike | null | undefined,
  month: string
): Record<string, CardMonthDue> {
  const map: Record<string, CardMonthDue> = {};
  const rows = buildCardTotalExpenseRows(creditData, month);
  const cards = (Array.isArray(creditData?.cards) ? creditData?.cards : []) as SyncCard[];
  cards.forEach(card => {
    if (!card?.id) return;
    const row = rows[buildRevolvingRowKey(card.id)];
    map[card.id] = row
      ? {
        dueMonth: month,
        installmentDueThisMonth: row.breakdown.installmentTotal,
        revolvingDueThisMonth: Math.max(0, row.breakdown.revolving.totalDue),
        totalDueThisMonth: row.actual,
        installmentCount: row.breakdown.installments.length,
        installmentPaidCount: row.breakdown.installments.filter(line => line.paid).length
      }
      : {
        dueMonth: month,
        installmentDueThisMonth: 0,
        revolvingDueThisMonth: 0,
        totalDueThisMonth: 0,
        installmentCount: 0,
        installmentPaidCount: 0
      };
  });
  return map;
}

// ---------------------------------------------------------------------------
// จ่ายยอดรวมบัตร (spec-credit-card-spend §5.3 · SPEND-5/6/7/8/9)
// ---------------------------------------------------------------------------

export type CardTotalPayStatus = 'ok' | 'not_found' | 'needs_choice' | 'limit_reached';

interface CardTotalPayData {
  cards: unknown[];
  plans: unknown[];
  cycles: unknown[];
  spendItems: unknown[];
}

export interface CardTotalPayPlan {
  status: CardTotalPayStatus;
  /** สถานะ paid (SPEND-6) หลังการเปลี่ยน — หรือสถานะปัจจุบันเมื่อไม่เปลี่ยน */
  paid: boolean;
  /** จำนวนแถว (งวด + cycle) ที่เปลี่ยน */
  applied: number;
  /** มีเฉพาะเมื่อ status 'ok' และมีการเปลี่ยนจริง */
  next?: { plans: PlanLike[]; cycles: StoredRevolvingCycle[] };
}

/**
 * วางแผนการจ่าย/ยกเลิกจ่ายยอดรวมบัตรของเดือนหนึ่ง — ฟังก์ชันล้วน ตรวจทุกเงื่อนไขก่อนเปลี่ยนข้อมูล
 * จึงเป็น all-or-nothing: status ≠ 'ok' ไม่มี next เลย (งวดผ่อนไม่ถูกจ่ายครึ่ง ๆ กลาง ๆ — AC-S11)
 *
 * paid=true : งวดของแผนที่ไม่ถูกยกเลิก (dueMonth = month) → paid · ยอดหมุนเวียน totalDue > 0 และยังไม่มี
 *             action → ใช้ paymentAction ที่เลือก (ไม่ส่ง = 'needs_choice') · ยังไม่มี cycle เก็บไว้ → สร้างใหม่
 *             โดยไม่มี newSpend (เพดาน MAX_REVOLVING_CYCLES_PER_CARD → 'limit_reached')
 *             action เดิมที่ไม่ใช่ null คงไว้เสมอ — 'minimum' ไม่กลายเป็น 'full' เงียบ ๆ (BR-CC-016 / SPEND-8)
 * paid=false: กลับทั้งหมด (SPEND-7) — cycle ไม่ถูกลบ
 * แผนที่ยกเลิกแล้วไม่ถูกแตะเลย (BR-CC-009 / SPEND-9)
 *
 * onlyOnTransition: ใช้กับ POST แบบทั้งตาราง — ทำเฉพาะเมื่อสถานะ derive ปัจจุบันต่างจากที่ขอ
 *   (POST ส่ง paid=false ของแถวที่จ่ายไปบางงวดทุกครั้งที่กด Save All ห้ามไปยกเลิกงวดที่จ่ายแล้ว)
 *
 * @param month - cycleMonth: รอบบิลเป้าหมาย (ไม่ใช่เดือนตาราง) — ผู้เรียกแปลงด้วย getPayableCycleMonth (DP-8)
 */
export function planCardTotalPaid(
  data: CardTotalPayData,
  cardId: string,
  month: string,
  paid: boolean,
  paymentAction: 'full' | 'minimum' | null | undefined,
  { now = new Date().toISOString(), paidSource = 'card_total', onlyOnTransition = false }:
    { now?: string; paidSource?: string; onlyOnTransition?: boolean } = {}
): CardTotalPayPlan {
  const cardList = data.cards as SyncCard[];
  const card = cardList.find(item => item?.id === cardId);
  if (!card || typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
    return { status: 'not_found', paid, applied: 0 };
  }

  const state = computeCardMonthState(card, data, month);
  if (onlyOnTransition && state.paid === paid) return { status: 'ok', paid: state.paid, applied: 0 };

  const cycleList = data.cycles as SyncCycle[];
  const cycleIndex = cycleList.findIndex(cycle => cycle?.cardId === cardId && cycle?.month === month);
  const storedCycle = cycleIndex === -1 ? null : cycleList[cycleIndex];
  const storedAction = storedCycle && isValidPaymentAction(storedCycle.paymentAction) ? (storedCycle.paymentAction ?? null) : null;

  // --- ตรวจทุกเงื่อนไขก่อน (ยังไม่แตะข้อมูล) ---
  // F4 / AC-S11: เพดาน 60 cycle ตัดสายก่อนถึงเดือนนี้ → ไม่รู้ยอดหมุนเวียนจริง ห้ามจ่ายเฉพาะงวดผ่อน
  // (เดือนยอด 0 ที่แค่ถูกข้ามไม่นับ — ดูเฉพาะการที่เพดานตัดปลายสายก่อนถึงเดือนนี้)
  if (paid && state.cycle === null && isMonthBeyondRevolvingCap(chainFor(card, data, month), month)) {
    return { status: 'limit_reached', paid: state.paid, applied: 0 };
  }
  const needsRevolvingAction = paid && state.cycle !== null && state.cycle.totalDue > 0 && storedAction === null;
  if (needsRevolvingAction) {
    if (paymentAction !== 'full' && paymentAction !== 'minimum') return { status: 'needs_choice', paid: state.paid, applied: 0 };
    if (cycleIndex === -1 && cycleList.filter(cycle => cycle?.cardId === cardId).length >= MAX_REVOLVING_CYCLES_PER_CARD) {
      return { status: 'limit_reached', paid: state.paid, applied: 0 };
    }
  }

  // --- เปลี่ยนข้อมูล (สำเนาใหม่ทั้งหมด) ---
  let applied = 0;
  const plans = (data.plans as SyncPlan[]).map(plan => {
    if (plan?.cardId !== cardId || plan.status === PLAN_STATUS.CANCELLED) return plan;
    const schedule = Array.isArray(plan.schedule) ? plan.schedule : [];
    let changed = false;
    const nextSchedule = schedule.map(row => {
      if (row?.dueMonth !== month || (row.paid === true) === paid) return row;
      changed = true;
      applied += 1;
      return { ...row, paid, paidAt: paid ? now : null, paidSource: paid ? paidSource : null };
    });
    if (!changed) return plan;
    const nextPlan = { ...plan, schedule: nextSchedule, updatedAt: now };
    return { ...nextPlan, status: resolvePlanStatus(nextPlan) };
  });

  let cycles = [...cycleList];
  if (paid && needsRevolvingAction) {
    if (cycleIndex === -1) {
      cycles = [...cycles, {
        id: generateCycleId(),
        cardId,
        month,
        paymentAction,
        paidAt: now,
        paidSource,
        createdAt: now,
        updatedAt: now
      }];
    } else {
      cycles[cycleIndex] = { ...cycleList[cycleIndex], paymentAction, paidAt: now, paidSource, updatedAt: now };
    }
    applied += 1;
  } else if (!paid && storedCycle && storedAction !== null) {
    cycles[cycleIndex] = { ...storedCycle, paymentAction: null, paidAt: null, paidSource: null, updatedAt: now };
    applied += 1;
  }

  if (!applied) return { status: 'ok', paid: state.paid, applied: 0 };
  const after = computeCardMonthState(card, { ...data, plans, cycles }, month);
  return { status: 'ok', paid: after.paid, applied, next: { plans: plans as PlanLike[], cycles: cycles as StoredRevolvingCycle[] } };
}

function generateCycleId(): string {
  return `rc_${crypto.randomBytes(6).toString('hex')}`;
}

/** อัปเดตตารางผ่อนตาม paid ที่ส่งกลับมา — คืน { plans, applied } */
function applyInstallmentUpdates(
  data: { plans: unknown[] },
  updates: InstallmentUpdate[]
): { plans: PlanLike[]; applied: number } {
  if (!updates.length) return { plans: data.plans as PlanLike[], applied: 0 };

  // Cast immediately after arriving from an `unknown[]`-typed store boundary (§Design A.4).
  const planList = data.plans as SyncPlan[];

  let applied = 0;
  const plans = planList.map(plan => {
    const planUpdates = updates.filter(update => update.planId === plan?.id);
    if (!planUpdates.length) return plan;
    // แผนที่ยกเลิกแล้วเป็นสถานะสุดท้าย ห้ามแก้สถานะการชำระอีก (BR-CC-009)
    if (plan.status === PLAN_STATUS.CANCELLED) return plan;

    const schedule: SyncScheduleRow[] = Array.isArray(plan.schedule) ? [...plan.schedule] : [];
    let changed = false;
    planUpdates.forEach(({ installmentNo, paid }) => {
      const index = schedule.findIndex(row => row?.no === installmentNo);
      if (index === -1) return;
      if (schedule[index].paid === paid) return;
      schedule[index] = {
        ...schedule[index],
        paid,
        paidAt: paid ? new Date().toISOString() : null,
        paidSource: paid ? 'expense_table' : null
      };
      changed = true;
      applied += 1;
    });
    if (!changed) return plan;

    const nextPlan = { ...plan, schedule, updatedAt: new Date().toISOString() };
    return { ...nextPlan, status: resolvePlanStatus(nextPlan) };
  });

  return { plans, applied };
}

/**
 * เขียนเฉพาะ `paid` จาก payload ของ ExpenseTable กลับเข้าตารางผ่อนและ cycle หมุนเวียน
 * (BR-CC-008 · BR-CC-016 · spec-credit-card-spend §5.3)
 * คีย์ที่รูปแบบไม่ตรง regex ถือเป็นรายการค่าใช้จ่ายปกติ
 * คีย์ที่ตรง regex แต่ไม่พบแผน/บัตร จะถูกข้ามเงียบ ๆ ไม่โยน error
 *
 * ccr_ = แถวยอดรวมบัตร: จ่าย/ยกเลิกทั้งบัตรในครั้งเดียว (planCardTotalPaid) แบบ onlyOnTransition —
 *   Save All ส่ง paid ของทุกแถวทุกครั้ง แถวที่ derive เป็น false เพราะจ่ายไปบางงวด ต้องไม่ไปยกเลิกงวดที่จ่ายแล้ว
 *   paid=true ที่ยังไม่มี action ใช้ 'full' (พฤติกรรมเดิม) · เพดาน cycle เต็ม = ข้ามทั้งบัตร ไม่จ่ายครึ่ง ๆ
 *   month = เดือนตาราง (DP-1/DP-8): รอบบิลเป้าหมายต่อบัตร = getPayableCycleMonth(card, month) คำนวณจาก
 *   data.cards ภายใน updater เสมอ · cycleMonth ในแถว payload เป็นแค่ตัวกันข้อมูลเก่า (DP-4):
 *   ไม่ส่ง → ใช้ค่าที่คำนวณ · รูปแบบผิด หรือไม่ตรงค่าที่คำนวณ → ข้ามแถวบัตรนั้น (console.warn) แถวอื่นบันทึกต่อ
 *   ไม่พบบัตร → ข้ามคีย์นั้น (เหมือนเดิม)
 * cci_ = คีย์รายงวดแบบเดิม (client เก่า — GET ไม่ปล่อยคีย์นี้แล้ว) ยังรองรับเหมือนเดิม
 * ทุกอย่างอยู่ใน updateUserCreditData ครั้งเดียว
 *
 * @param {string} userId
 * @param {object} expenseData
 * @param {string} month - เดือนตาราง บังคับสำหรับแถว ccr_ เพราะคีย์ ccr_ ไม่ได้เข้ารหัสเดือนไว้ในตัวเอง
 * @returns {Promise<number>} จำนวนรายการที่ถูกอัปเดต
 */
export async function applyCreditCardPaidFromExpensePayload(
  userId: unknown,
  expenseData: Record<string, unknown> | null | undefined,
  month: string
): Promise<number> {
  if (!userId || !expenseData || typeof expenseData !== 'object') return 0;

  const installmentUpdates: InstallmentUpdate[] = [];
  const revolvingUpdates: RevolvingUpdate[] = [];
  Object.keys(expenseData).forEach(key => {
    const row = expenseData[key];
    if (!row || typeof row !== 'object') return;
    // Narrowing guard (§Design A.5.1): identical runtime comparison, only the compile-time view of
    // `row` changes.
    const payloadRow = row as PayloadRow;
    const paid = payloadRow.paid === true || payloadRow.paid === 'true';

    const installment = parseInstallmentRowKey(key);
    if (installment) {
      installmentUpdates.push({ ...installment, paid });
      return;
    }
    const revolving = parseRevolvingRowKey(key);
    if (revolving) revolvingUpdates.push({ ...revolving, paid, cycleMonth: payloadRow.cycleMonth });
  });

  if (!installmentUpdates.length && !revolvingUpdates.length) return 0;
  if (revolvingUpdates.length && (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month))) {
    revolvingUpdates.length = 0;
    if (!installmentUpdates.length) return 0;
  }

  let appliedCount = 0;
  await updateUserCreditData(userId, (data) => {
    appliedCount = 0;
    const { plans: installmentPlans, applied: plansApplied } = applyInstallmentUpdates(data, installmentUpdates);
    appliedCount += plansApplied;
    let current = { ...data, plans: installmentPlans };
    const now = new Date().toISOString();
    revolvingUpdates.forEach(({ cardId, paid, cycleMonth }) => {
      const card = (current.cards as SyncCard[]).find(item => item?.id === cardId);
      if (!card) return;
      const expected = getPayableCycleMonth(card, month);
      const guard = checkCycleMonthGuard(cycleMonth, expected);
      if (guard !== 'ok') {
        console.warn(
          `Credit card sync: skipped ${buildRevolvingRowKey(cardId)} on POST (${guard} cycleMonth, expected ${expected})`
        );
        return;
      }
      const plan = planCardTotalPaid(current, cardId, expected, paid, 'full', {
        now,
        paidSource: 'expense_table',
        onlyOnTransition: true
      });
      if (plan.status !== 'ok' || !plan.next) return;
      current = { ...current, plans: plan.next.plans, cycles: plan.next.cycles };
      appliedCount += plan.applied;
    });
    return current;
  });

  return appliedCount;
}

interface CreditCardPaidKeyResult {
  status: 'ok' | 'not_found' | 'cancelled' | 'limit_reached' | 'needs_choice' | 'cycle_mismatch';
  paid: boolean;
}

/**
 * ตั้งค่า paid ของแถวบัตรเครดิตเดียว (cci_/ccr_) แบบ strict ทีละแถว — ใช้โดย PATCH /api/monthly_expense
 * (ADR-028) เพื่อให้รู้ผลลัพธ์ที่แม่นยำกว่า applyCreditCardPaidFromExpensePayload (ซึ่งคืนแค่จำนวนรวม):
 *   - 'not_found'     ไม่พบแผนผ่อน/แถว หรือบัตรไม่ใช่ของ userId นี้
 *   - 'cancelled'      แผนผ่อนถูกยกเลิกแล้ว ห้ามแก้สถานะการชำระอีก (BR-CC-009)
 *   - 'limit_reached'  ยอดหมุนเวียนยังไม่มี cycle ของเดือนนี้ และสร้างใหม่ไม่ได้ (ครบ MAX_REVOLVING_CYCLES_PER_CARD)
 *                      — ไม่มีอะไรถูกเขียนเลย งวดผ่อนก็ไม่ถูกจ่าย (AC-S11)
 *   - 'needs_choice'   ccr_ paid=true, ยอดหมุนเวียน totalDue > 0, ยังไม่มี action และไม่ได้ส่ง paymentAction
 *   - 'cycle_mismatch' ccr_ เท่านั้น: cycleMonth ที่ส่งมาไม่ตรงกับรอบบิลที่เซิร์ฟเวอร์คำนวณ หรือ offset ของบัตร
 *                      เปลี่ยนระหว่าง snapshot กับตอนเขียน (DP-4) — ไม่มีอะไรถูกเขียน
 *   - 'ok'             เขียนสำเร็จ (หรือ idempotent no-op ที่ state ตรงกับที่ขอแล้ว) — `paid` คือสถานะสุดท้ายจริง
 *
 * ⚠ ความหมายของ `month` ต่างกันตามชนิดคีย์ (ตั้งใจ — spec-credit-card-due-month-placement R-3 ห้ามรวมเป็นแบบเดียว):
 *   - ccr_ : month = เดือนตาราง (เดือนที่หน้าแสดง) → รอบบิลเป้าหมาย = getPayableCycleMonth(card, month) (DP-8)
 *            cycleMonth (ไม่บังคับ) = ตัวกันข้อมูลเก่าเท่านั้น ไม่เคยใช้เลือกรอบบิลเอง
 *   - cci_ : month = dueMonth ของงวดในตารางผ่อน (รอบบิล) เหมือนเดิม — applyPaidSequentially
 *            (installmentBackdate.ts) ส่ง expenseAPI.setPaid(row.dueMonth, …) ห้ามเปลี่ยน · cycleMonth ถูกเพิกเฉย
 *
 * ccr_ = แถวยอดรวมบัตร (spec-credit-card-spend §5.3): จ่ายทุกงวด + ยอดหมุนเวียนใน updateUserCreditData ครั้งเดียว
 *   ตรวจเงื่อนไขกับ snapshot ก่อน ถ้าไม่ผ่านจะไม่เรียก updateUserCreditData เลย (ไม่ bump updatedAt)
 *   และตรวจซ้ำภายใน updater อีกครั้ง (กันข้อมูลเปลี่ยนระหว่างทาง รวมถึงรอบบิลเป้าหมายที่เปลี่ยน)
 */
export async function applyCreditCardPaidForKey(
  userId: unknown,
  key: string,
  paid: boolean,
  month: string,
  paymentAction?: 'full' | 'minimum' | null,
  cycleMonth?: string
): Promise<CreditCardPaidKeyResult> {
  const installment = parseInstallmentRowKey(key);
  if (installment) {
    let result: CreditCardPaidKeyResult = { status: 'not_found', paid };
    await updateUserCreditData(userId, (data) => {
      const planList = data.plans as SyncPlan[];
      const planIndex = planList.findIndex(plan => plan?.id === installment.planId);
      if (planIndex === -1) {
        result = { status: 'not_found', paid };
        return data;
      }
      const plan = planList[planIndex];
      if (plan.status === PLAN_STATUS.CANCELLED) {
        result = { status: 'cancelled', paid: false };
        return data;
      }
      const schedule: SyncScheduleRow[] = Array.isArray(plan.schedule) ? [...plan.schedule] : [];
      const rowIndex = schedule.findIndex(row => row?.no === installment.installmentNo && row?.dueMonth === month);
      if (rowIndex === -1) {
        result = { status: 'not_found', paid };
        return data;
      }
      if (schedule[rowIndex].paid === paid) {
        result = { status: 'ok', paid };
        return data;
      }
      schedule[rowIndex] = {
        ...schedule[rowIndex],
        paid,
        paidAt: paid ? new Date().toISOString() : null,
        paidSource: paid ? 'expense_table' : null
      };
      const nextPlan = { ...plan, schedule, updatedAt: new Date().toISOString() };
      const finalPlan = { ...nextPlan, status: resolvePlanStatus(nextPlan) };
      const plans = [...planList];
      plans[planIndex] = finalPlan;
      result = { status: 'ok', paid };
      return { ...data, plans };
    });
    return result;
  }

  const revolving = parseRevolvingRowKey(key);
  if (revolving) {
    const snapshot = await getUserCreditData(userId);
    const snapshotCard = (snapshot.cards as SyncCard[]).find(item => item?.id === revolving.cardId);
    if (!snapshotCard) return { status: 'not_found', paid };
    const expected = getPayableCycleMonth(snapshotCard, month);
    if (checkCycleMonthGuard(cycleMonth, expected) !== 'ok') return { status: 'cycle_mismatch', paid };

    const precheck = planCardTotalPaid(snapshot, revolving.cardId, expected, paid, paymentAction);
    if (precheck.status !== 'ok') return { status: precheck.status, paid: precheck.paid };
    if (!precheck.next) return { status: 'ok', paid: precheck.paid };

    let result: CreditCardPaidKeyResult = { status: 'ok', paid: precheck.paid };
    await updateUserCreditData(userId, (data) => {
      const card = (data.cards as SyncCard[]).find(item => item?.id === revolving.cardId);
      if (!card) {
        result = { status: 'not_found', paid };
        return data;
      }
      // offset ของบัตรเปลี่ยนระหว่าง snapshot กับตอนเขียน → ไม่เขียนผิดรอบบิล (DP-4)
      if (getPayableCycleMonth(card, month) !== expected) {
        result = { status: 'cycle_mismatch', paid };
        return data;
      }
      const plan = planCardTotalPaid(data, revolving.cardId, expected, paid, paymentAction);
      result = { status: plan.status, paid: plan.paid };
      if (plan.status !== 'ok' || !plan.next) return data;
      return { ...data, plans: plan.next.plans, cycles: plan.next.cycles };
    });
    return result;
  }

  return { status: 'not_found', paid };
}

/**
 * ลบคีย์บัตรเครดิต (cci_ และ ccr_) ออกจาก payload ก่อนเขียนลง storage
 * รวมถึงลบคีย์เหล่านั้นที่หลุดมาใน __removeKeys — แถวบัตรเครดิตลบได้จากหน้าบัตรเครดิตเท่านั้น
 * (BR-CC-008 · BR-CC-016)
 * @param {object} expenseData
 * @returns {object} payload ชุดใหม่ที่ปลอดคีย์ cci_ / ccr_
 */
export function stripCreditCardKeys(
  expenseData: Record<string, unknown> | null | undefined
): Record<string, unknown> | null | undefined {
  if (!expenseData || typeof expenseData !== 'object') return expenseData;

  const cleaned: Record<string, unknown> = {};
  Object.keys(expenseData).forEach(key => {
    if (isCreditCardRowKey(key)) return;
    cleaned[key] = expenseData[key];
  });

  if (Array.isArray(cleaned.__removeKeys)) {
    cleaned.__removeKeys = cleaned.__removeKeys.filter(
      (key: unknown) => typeof key === 'string' && !isCreditCardRowKey(key)
    );
  }

  return cleaned;
}

/**
 * โหลดข้อมูลที่จำเป็นสำหรับ inject แถวบัตรเครดิต
 * ความล้มเหลวใด ๆ จะถูก log แล้วคืน null — บัตรเครดิตต้องไม่มีวันทำให้หน้ารายจ่ายพัง (R-2)
 *
 * ⚠ ต้องผ่านเมื่อมี "แผนผ่อน หรือ cycle หมุนเวียน" อย่างใดอย่างหนึ่ง
 *   เงื่อนไขเดิมเช็คแค่ plans.length ทำให้ผู้ใช้ที่ใช้เฉพาะยอดหมุนเวียนไม่ได้แถวเลยสักแถว (AC-59)
 * @param {string} userId
 * @returns {Promise<{creditData: object, bankAccounts: string[]}|null>}
 */
export async function loadCreditCardContext(
  userId: unknown,
  bankAccounts: unknown[] = []
): Promise<{ creditData: CreditDataLike; bankAccounts: unknown[] } | null> {
  try {
    const creditData = await getUserCreditData(userId);
    if (!creditData) return null;
    const hasPlans = Array.isArray(creditData.plans) && creditData.plans.length > 0;
    const hasCycles = Array.isArray(creditData.cycles) && creditData.cycles.length > 0;
    // ผู้ใช้ที่มีแต่รายการไม่ผ่อน (ยังไม่มี cycle/แผน) ก็ต้องได้แถวยอดรวมบัตร (spec-credit-card-spend §3.1)
    const hasSpendItems = Array.isArray(creditData.spendItems) && creditData.spendItems.length > 0;
    if (!hasPlans && !hasCycles && !hasSpendItems) return null;
    return { creditData, bankAccounts };
  } catch (error) {
    console.error('Credit card sync: failed to read credit card store for user', userId, error);
    return null;
  }
}

function mergeAccounts(context: { bankAccounts?: unknown }, extraBankAccounts: unknown[]): unknown[] {
  return Array.from(new Set([
    ...(Array.isArray(context.bankAccounts) ? context.bankAccounts : []),
    ...(Array.isArray(extraBankAccounts) ? extraBankAccounts : [])
  ]));
}

/**
 * จุดต่อเดียวที่คืนแถวบัตรเครดิตให้ monthly_expense (ทั้ง 5 จุดเรียก — spec-credit-card-spend §4.3)
 * คืนเฉพาะแถวยอดรวมบัตร ccr_<cardId> หนึ่งแถวต่อบัตร — แทนที่ (ไม่ใช่เพิ่มบน) แถว cci_ รายงวดและแถว
 * ยอดหมุนเวียนแบบเดิม จึงไม่มีคีย์ cci_ ระดับบนในทุกเส้นทางของ GET (R1c) งวดผ่อนอยู่ใน breakdown
 * ไม่มีทางโยน error ออกมา (R-2)
 * @returns {object} map แถว ccr_
 */
export function safeBuildCreditCardRows(
  context: { creditData: CreditDataLike; bankAccounts: unknown[] } | null | undefined,
  month: string,
  extraBankAccounts: unknown[] = []
): Record<string, CardTotalExpenseRow> {
  if (!context) return {};
  try {
    return buildCardTotalExpenseRows(context.creditData, month, mergeAccounts(context, extraBankAccounts));
  } catch (error) {
    console.error('Credit card sync: failed to derive card total rows for month', month, error);
    return {};
  }
}

/** เรียก getCreditCardMonths แบบไม่มีทางโยน error ออกมา */
export function safeGetCreditCardMonths(
  context: { creditData: CreditDataLike; bankAccounts: unknown[] } | null | undefined
): string[] {
  if (!context) return [];
  try {
    return getCreditCardMonths(context.creditData);
  } catch (error) {
    console.error('Credit card sync: failed to collect credit card months', error);
    return [];
  }
}
