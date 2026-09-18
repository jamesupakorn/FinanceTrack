/**
 * creditCardUtils.js
 * Pure re-export barrel — โมดูลนี้ไม่มี function/constant/type ของตัวเองแล้ว (TD-H02, split
 * เสร็จสมบูรณ์ทั้ง 3 sub-slice) ตรรกะทั้งหมดย้ายไปอยู่ที่ 3 ไฟล์ต่อไปนี้:
 *   - ./creditCardBasics.ts       — ค่าคงที่ / ตัวช่วยตัวเลข-วันที่พื้นฐาน / คีย์แถวใน ExpenseTable
 *   - ./creditCardAmortization.ts — ตารางผ่อนชำระ (ADR-010)
 *   - ./creditCardRevolving.ts    — ยอดใช้จ่ายหมุนเวียน (ADR-011) / สรุปข้อมูล (BR-006) / validation
 *
 * ไฟล์นี้ยังคงอยู่ (ไม่ลบ ไม่เปลี่ยนชื่อ) เพื่อให้ 28+ importer เดิมไม่ต้องแก้ไขอะไรเลย — import
 * path เดิม (`./creditCardUtils`) ยังคง resolve ทุกชื่อได้เหมือนเดิมทุกประการ
 */

export {
  CARD_COLORS,
  MAX_CARDS_PER_USER,
  MAX_ACTIVE_PLANS_PER_USER,
  MAX_INSTALLMENTS_PER_PLAN,
  MAX_REVOLVING_CYCLES_PER_CARD,
  PLAN_STATUS,
  INTEREST_MODES,
  CALC_METHODS,
  PAYMENT_ACTIONS,
  DEFAULT_ANNUAL_RATE,
  DEFAULT_MIN_PAYMENT_PERCENT,
  INSTALLMENT_KEY_PREFIX,
  INSTALLMENT_KEY_RE,
  REVOLVING_KEY_PREFIX,
  REVOLVING_KEY_RE,
  round2,
  toAmount,
  addMonths,
  getCurrentMonthKey,
  getDaysInMonthKey,
  resolveInstallmentDueDate,
  formatIsoDateTH,
  diffDaysFromToday,
  describeDueDistance,
  formatDayLabel,
  normaliseDayValue,
  planHexSuffix,
  buildInstallmentRowKey,
  parseInstallmentRowKey,
  isInstallmentRowKey,
  cardHexSuffix,
  buildRevolvingRowKey,
  parseRevolvingRowKey,
  isRevolvingRowKey,
  isCreditCardRowKey
} from './creditCardBasics';

export {
  buildManualSchedule,
  buildFlatSchedule,
  buildEffectiveSchedule,
  buildSchedule
} from './creditCardAmortization';

export {
  normaliseCardDefaults,
  isValidPaymentAction,
  buildRevolvingCycles,
  isRevolvingChainTruncated,
  summariseRevolving,
  resolvePlanStatus,
  summarisePlan,
  resolveCardNextDueDate,
  summariseCard,
  summariseTotals,
  validateCardInput,
  validateRevolvingCycleInput,
  validatePlanInput
} from './creditCardRevolving';
