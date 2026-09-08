/**
 * creditCardUtils.js
 * คณิตศาสตร์และ validation ของบัตรเครดิต / แผนผ่อนชำระ
 *
 * โมดูลนี้เป็น pure function ล้วน (ไม่มี I/O, ไม่มี state) จึง import ได้ทั้งฝั่ง server และ client
 * ฟอร์มพรีวิวและ API ใช้ buildSchedule() ตัวเดียวกัน พรีวิวกับข้อมูลที่บันทึกจึงไม่มีทางไม่ตรงกัน
 * (ADR-010 · BR-CC-004 · BR-CC-005)
 */

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
export const CARD_COLORS = [
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
export const MAX_CARDS_PER_USER = 20;
export const MAX_ACTIVE_PLANS_PER_USER = 50;
export const MAX_INSTALLMENTS_PER_PLAN = 60;
export const MAX_REVOLVING_CYCLES_PER_CARD = 60;

export const PLAN_STATUS = {
  ONGOING: 'ongoing',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled_early'
};

export const INTEREST_MODES = ['manual', 'calculated'];
export const CALC_METHODS = ['flat', 'effective'];

/** การตัดสินใจชำระของยอดหมุนเวียน — null = ยังไม่ตัดสินใจ (BR-CC-014) */
export const PAYMENT_ACTIONS = ['full', 'minimum'];

/** ค่าเริ่มต้นของฟิลด์ยอดหมุนเวียน — ใส่ตอนอ่านเสมอ ไม่ต้อง migrate ข้อมูลเดิม (BR-CC-017) */
export const DEFAULT_ANNUAL_RATE = 0;
export const DEFAULT_MIN_PAYMENT_PERCENT = 10;

/** คีย์ของแถวผ่อนชำระใน ExpenseTable — คีย์คือ tag (ADR-009) */
export const INSTALLMENT_KEY_PREFIX = 'cci_';
export const INSTALLMENT_KEY_RE = /^cci_[0-9a-f]{12}_\d{2}$/;

/**
 * คีย์ของแถวยอดใช้จ่ายหมุนเวียนใน ExpenseTable (ADR-011)
 * ตั้งใจให้ไม่ขึ้นต้นด้วย 'cci_' เพื่อไม่ให้ isInstallmentRowKey / INSTALLMENT_KEY_RE เข้าใจผิด
 * และไม่ขึ้นต้นด้วย 'custom_' เพื่อไม่ให้ตัวกรองรายการว่างเปล่าลบทิ้ง
 */
export const REVOLVING_KEY_PREFIX = 'ccr_';
export const REVOLVING_KEY_RE = /^ccr_[0-9a-f]{12}$/;

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

// ---------------------------------------------------------------------------
// ตัวช่วยพื้นฐาน
// ---------------------------------------------------------------------------

/**
 * ปัดเป็นทศนิยม 2 ตำแหน่ง (สตางค์) แบบทนต่อความคลาดเคลื่อนของ floating point
 * @param {number|string} value
 * @returns {number}
 */
export function round2(value) {
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
 * @param {number|string} value
 * @returns {number} NaN เมื่อแปลงไม่ได้
 */
export function toAmount(value) {
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
 * @param {string} monthKey
 * @param {number} offset
 * @returns {string}
 */
export function addMonths(monthKey, offset = 0) {
  if (typeof monthKey !== 'string' || !MONTH_KEY_RE.test(monthKey)) return monthKey;
  const [yearStr, monthStr] = monthKey.split('-');
  const totalMonths = Number(yearStr) * 12 + (Number(monthStr) - 1) + Math.trunc(Number(offset) || 0);
  const year = Math.floor(totalMonths / 12);
  const monthIndex = ((totalMonths % 12) + 12) % 12;
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

/** เดือนปัจจุบันในรูปแบบ YYYY-MM */
export function getCurrentMonthKey(dateInput) {
  const date = dateInput ? new Date(dateInput) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** จำนวนวันของ month key */
export function getDaysInMonthKey(monthKey) {
  if (typeof monthKey !== 'string' || !MONTH_KEY_RE.test(monthKey)) return 31;
  const [yearStr, monthStr] = monthKey.split('-');
  return getDaysInMonth(Number(yearStr), Number(monthStr) - 1);
}

/**
 * แปลง dueDay ของบัตร (1-31 หรือ EOM) เป็นวันที่จริงของเดือนนั้น
 * ใช้ resolveDueDayForMonth ตัวเดียวกับ ExpenseTable และ LINE (BR-CC-003)
 * @returns {string|null} 'YYYY-MM-DD'
 */
export function resolveInstallmentDueDate(dueDayValue, monthKey) {
  if (typeof monthKey !== 'string' || !MONTH_KEY_RE.test(monthKey)) return null;
  const daysInMonth = getDaysInMonthKey(monthKey);
  const day = resolveDueDayForMonth(dueDayValue, daysInMonth) || daysInMonth;
  return `${monthKey}-${String(day).padStart(2, '0')}`;
}

/**
 * ฟอร์แมตวันที่ ISO (YYYY-MM-DD) เป็นภาษาไทยแบบย่อ เช่น '5 ส.ค. 2569'
 * @param {string} isoDate
 * @returns {string}
 */
export function formatIsoDateTH(isoDate) {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return '';
  const [yearStr, monthStr, dayStr] = isoDate.split('-');
  const monthIndex = Number(monthStr) - 1;
  const monthLabel = THAI_MONTH_LABELS[monthIndex] || monthStr;
  return `${Number(dayStr)} ${monthLabel} ${Number(yearStr) + 543}`;
}

/**
 * จำนวนวันจากวันนี้ถึงวันที่ระบุ (ลบ = เลยกำหนดแล้ว)
 * @param {string} isoDate
 * @returns {number|null}
 */
export function diffDaysFromToday(isoDate) {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [yearStr, monthStr, dayStr] = isoDate.split('-');
  const target = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

/** ข้อความบอกระยะเวลาถึงกำหนด */
export function describeDueDistance(diffDays) {
  if (diffDays === null || diffDays === undefined) return '';
  if (diffDays === 0) return 'ครบกำหนดวันนี้';
  if (diffDays > 0) return `อีก ${diffDays} วัน`;
  return `เลยกำหนด ${Math.abs(diffDays)} วัน`;
}

/** ป้ายกำกับวันครบกำหนด/วันสรุปยอดสำหรับแสดงผล */
export function formatDayLabel(dayValue) {
  if (isEndOfMonthDueDay(dayValue)) return 'สิ้นเดือน';
  const numeric = Number(dayValue);
  return Number.isFinite(numeric) && numeric >= 1 ? String(Math.floor(numeric)) : '-';
}

/**
 * ตรวจและแปลงค่าวัน (1-31 หรือ EOM) — คืน null เมื่อไม่ถูกต้อง
 * @returns {number|'EOM'|null}
 */
export function normaliseDayValue(value, { fallbackToEom = false } = {}) {
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
export function planHexSuffix(planId) {
  return String(planId || '').replace(/^ip_/, '');
}

/** สร้างคีย์แถว: cci_<12 hex>_<NN> */
export function buildInstallmentRowKey(planId, installmentNo) {
  return `${INSTALLMENT_KEY_PREFIX}${planHexSuffix(planId)}_${String(installmentNo).padStart(2, '0')}`;
}

/** อ่านคีย์แถวกลับเป็น { planId, installmentNo } — คืน null เมื่อรูปแบบไม่ตรง */
export function parseInstallmentRowKey(key) {
  if (typeof key !== 'string' || !INSTALLMENT_KEY_RE.test(key)) return null;
  return {
    planId: `ip_${key.slice(4, 16)}`,
    installmentNo: parseInt(key.slice(17), 10)
  };
}

/** true เมื่อคีย์นี้เป็นแถวผ่อนชำระที่ derive มา (ใช้ฝั่ง UI) */
export function isInstallmentRowKey(key) {
  return typeof key === 'string' && key.startsWith(INSTALLMENT_KEY_PREFIX);
}

// ---------------------------------------------------------------------------
// คีย์แถวยอดใช้จ่ายหมุนเวียนใน ExpenseTable (ADR-011)
// ---------------------------------------------------------------------------

/** ตัด prefix 'cc_' ออกจาก card id เหลือ 12 hex */
export function cardHexSuffix(cardId) {
  return String(cardId || '').replace(/^cc_/, '');
}

/** สร้างคีย์แถว: ccr_<12 hex> — 1 แถวต่อ 1 บัตรต่อ 1 เดือน */
export function buildRevolvingRowKey(cardId) {
  return `${REVOLVING_KEY_PREFIX}${cardHexSuffix(cardId)}`;
}

/** อ่านคีย์แถวกลับเป็น { cardId } — คืน null เมื่อรูปแบบไม่ตรง (เดือนไม่ได้อยู่ในคีย์) */
export function parseRevolvingRowKey(key) {
  if (typeof key !== 'string' || !REVOLVING_KEY_RE.test(key)) return null;
  return { cardId: `cc_${key.slice(REVOLVING_KEY_PREFIX.length)}` };
}

/** true เมื่อคีย์นี้เป็นแถวยอดหมุนเวียนที่ derive มา */
export function isRevolvingRowKey(key) {
  return typeof key === 'string' && key.startsWith(REVOLVING_KEY_PREFIX);
}

/**
 * true เมื่อคีย์นี้เป็นแถวบัตรเครดิตที่ derive มา (ผ่อนชำระ หรือ ยอดหมุนเวียน)
 * ใช้ในที่ที่ทั้งสองตระกูลต้องถูกปฏิบัติเหมือนกัน: แถว locked ใน UI, strip ก่อนเขียน,
 * และ guard hasPersistedRows ของ formatExpenseData (BR-CC-016)
 */
export function isCreditCardRowKey(key) {
  return isInstallmentRowKey(key) || isRevolvingRowKey(key);
}

// ---------------------------------------------------------------------------
// ตารางผ่อนชำระ (ADR-010)
// ---------------------------------------------------------------------------

function createScheduleRow(no, startMonth, principal, interest) {
  return {
    no,
    dueMonth: addMonths(startMonth, no - 1),
    payment: round2(principal + interest),
    principal,
    interest,
    paid: false,
    paidAt: null,
    paidSource: null
  };
}

/**
 * รวมยอดจากตาราง — Σ principal === totalPrice และ Σ payment === totalPayable เสมอ
 * เพราะงวดสุดท้ายรับเศษไว้ทั้งหมด (BR-CC-005)
 */
function summariseSchedule(schedule) {
  const totalInterest = round2(schedule.reduce((sum, row) => sum + row.interest, 0));
  const totalPayable = round2(schedule.reduce((sum, row) => sum + row.payment, 0));
  return {
    schedule,
    monthlyPayment: schedule.length ? schedule[0].payment : 0,
    totalInterest,
    totalPayable
  };
}

function normaliseScheduleInput({ totalPrice, months, startMonth }) {
  return {
    price: round2(totalPrice),
    count: Math.max(1, Math.floor(Number(months) || 0)),
    start: typeof startMonth === 'string' && MONTH_KEY_RE.test(startMonth)
      ? startMonth
      : getCurrentMonthKey()
  };
}

/**
 * โหมด A — กรอกค่าธรรมเนียมต่องวดเอง
 * principal_k = totalPrice/months · interest_k = manualFeePerMonth (เท่ากันทุกงวด)
 */
export function buildManualSchedule(input = {}) {
  const { price, count, start } = normaliseScheduleInput(input);
  const fee = round2(Math.max(0, toAmount(input.manualFeePerMonth) || 0));
  const basePrincipal = round2(price / count);
  const schedule = [];
  let remaining = price;
  for (let no = 1; no <= count; no += 1) {
    const principal = no === count ? round2(remaining) : basePrincipal;
    schedule.push(createScheduleRow(no, start, principal, fee));
    remaining = round2(remaining - principal);
  }
  return summariseSchedule(schedule);
}

/**
 * โหมด B / flat — ดอกเบี้ยคิดจากราคาเต็ม เฉลี่ยเท่ากันทุกงวด
 * totalInterest = totalPrice × (annualRate/100) × (months/12)
 */
export function buildFlatSchedule(input = {}) {
  const { price, count, start } = normaliseScheduleInput(input);
  const rate = Math.max(0, toAmount(input.annualRate) || 0);
  const totalInterest = round2(price * (rate / 100) * (count / 12));
  const baseInterest = round2(totalInterest / count);
  const basePrincipal = round2(price / count);
  const schedule = [];
  let remainingPrincipal = price;
  let remainingInterest = totalInterest;
  for (let no = 1; no <= count; no += 1) {
    const interest = no === count ? round2(remainingInterest) : baseInterest;
    const principal = no === count ? round2(remainingPrincipal) : basePrincipal;
    schedule.push(createScheduleRow(no, start, principal, interest));
    remainingPrincipal = round2(remainingPrincipal - principal);
    remainingInterest = round2(remainingInterest - interest);
  }
  return summariseSchedule(schedule);
}

/**
 * โหมด B / effective — ลดต้นลดดอก
 * i = (annualRate/100)/12 · payment = totalPrice × i / (1 − (1+i)^(−months))
 * annualRate = 0 แยก branch ชัดเจน มิฉะนั้นสูตรหารด้วยศูนย์
 */
export function buildEffectiveSchedule(input = {}) {
  const { price, count, start } = normaliseScheduleInput(input);
  const rate = Math.max(0, toAmount(input.annualRate) || 0);
  const monthlyRate = rate / 100 / 12;
  const nominalPayment = monthlyRate > 0
    ? (price * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -count))
    : price / count;
  const safeNominal = Number.isFinite(nominalPayment) ? nominalPayment : price / count;

  const schedule = [];
  let balance = price;
  for (let no = 1; no <= count; no += 1) {
    const interest = monthlyRate > 0 ? round2(balance * monthlyRate) : 0;
    let principal = no === count ? round2(balance) : round2(safeNominal - interest);
    if (principal > balance) principal = round2(balance);
    if (principal < 0) principal = 0;
    schedule.push(createScheduleRow(no, start, principal, interest));
    balance = round2(balance - principal);
  }
  return summariseSchedule(schedule);
}

/**
 * สร้างตารางผ่อนตามโหมดที่เลือก
 * @returns {{schedule: array, monthlyPayment: number, totalInterest: number, totalPayable: number}}
 */
export function buildSchedule(input = {}) {
  if (input.interestMode === 'calculated') {
    return input.calcMethod === 'effective'
      ? buildEffectiveSchedule(input)
      : buildFlatSchedule(input);
  }
  return buildManualSchedule(input);
}

// ---------------------------------------------------------------------------
// ยอดใช้จ่ายหมุนเวียน (ADR-011 · BR-CC-013/014/015)
//
// ⚠ ห้ามเก็บ carriedBalance / totalDue / interest / closingBalance / amountDue ลง storage
//   ทั้งสายเงินถูก derive ใหม่ทุกครั้งที่อ่านด้วยฟังก์ชันบริสุทธิ์ตัวเดียวนี้
//   แก้ newSpend ของเดือนเก่า หรือแก้ annualRate/minPaymentPercent ของบัตร
//   เดือนถัด ๆ ไปจึงถูกคำนวณใหม่ให้ถูกต้องทันที ไม่มีสำเนาค้างให้ผิด
// ---------------------------------------------------------------------------

function clampPercent(value, min, max, fallback) {
  const numeric = toAmount(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

/**
 * เติมค่าเริ่มต้นของฟิลด์ยอดหมุนเวียนให้บัตร — ทำตอน "อ่าน" เสมอ
 * บัตรที่สร้างก่อนฟีเจอร์นี้จึงใช้งานได้ทันทีโดยไม่ต้อง migrate (BR-CC-017)
 * @param {object} card
 * @returns {object}
 */
export function normaliseCardDefaults(card = {}) {
  return {
    ...card,
    annualRate: clampPercent(card.annualRate, 0, 100, DEFAULT_ANNUAL_RATE),
    minPaymentPercent: clampPercent(card.minPaymentPercent, 1, 100, DEFAULT_MIN_PAYMENT_PERCENT)
  };
}

/** true เมื่อค่านี้เป็นการตัดสินใจชำระที่ถูกต้อง ('full' | 'minimum' | null) */
export function isValidPaymentAction(value) {
  return value === null || PAYMENT_ACTIONS.includes(value);
}

/** month key ที่เก่ากว่าในสองค่า (รูปแบบ YYYY-MM เทียบแบบ lexicographic ได้ตรงตามลำดับเวลา) */
function minMonthKey(a, b) {
  return a.localeCompare(b) <= 0 ? a : b;
}

/**
 * ติดธง truncated ไว้กับสายที่ derive แล้ว แบบ non-enumerable
 * ไม่กระทบ JSON.stringify / การ iterate / การ spread ของ array และคงลายเซ็นเดิมของ
 * buildRevolvingCycles() ไว้ (ทุก call site ยังใช้ผลลัพธ์เป็น array ตามเดิม)
 */
function withTruncationFlag(cycles, truncated) {
  Object.defineProperty(cycles, 'truncated', {
    value: truncated === true,
    enumerable: false,
    configurable: true
  });
  return cycles;
}

/**
 * สายเงินของยอดหมุนเวียน — แหล่งความจริงเดียวของ carriedBalance/totalDue/interest/closing
 * บทบาทเดียวกับ buildSchedule() ของแผนผ่อน (ADR-010): ทั้งพรีวิว, API, แถวใน ExpenseTable,
 * ยอดรวมบนแดชบอร์ด และข้อความ LINE เรียกฟังก์ชันนี้ตัวเดียวกัน จึงไม่มีทางไม่ตรงกัน
 *
 * @param {object} card - บัตร (ใช้ annualRate / minPaymentPercent)
 * @param {array} storedCycles - cycle ที่เก็บจริง (ทุกบัตร — จะถูกกรองด้วย card.id ให้เอง)
 * @param {{throughMonth?: string}} options - เดือนสุดท้ายที่ต้องการให้ materialise ถึง
 * @returns {array} cycle ที่ derive แล้ว เรียงตามเดือนจากเก่าไปใหม่
 *   พร้อมธง `truncated` (non-enumerable) — อ่านผ่าน isRevolvingChainTruncated() เท่านั้น
 */
export function buildRevolvingCycles(card = {}, storedCycles = [], options = {}) {
  const cardId = card?.id;
  if (!cardId) return withTruncationFlag([], false);

  const cycles = (Array.isArray(storedCycles) ? storedCycles : [])
    .filter(cycle => cycle?.cardId === cardId && typeof cycle?.month === 'string' && MONTH_KEY_RE.test(cycle.month))
    .sort((a, b) => a.month.localeCompare(b.month));
  if (!cycles.length) return withTruncationFlag([], false);

  const storedByMonth = new Map();
  cycles.forEach(cycle => storedByMonth.set(cycle.month, cycle));

  const lastStored = cycles[cycles.length - 1].month;
  const requested = typeof options.throughMonth === 'string' && MONTH_KEY_RE.test(options.throughMonth)
    ? options.throughMonth
    : getCurrentMonthKey();

  // หน้าต่าง materialise ยึดกับ "ข้อมูลที่ผู้ใช้ยังต้องเห็น" ไม่ใช่ cycle แรกสุดของบัตร
  //
  // ⚠ ถ้ายึดกับ cycle แรกสุด: บัตรที่มี cycle ปี 2020 แล้วทิ้งร้างไปกลับมาบันทึกยอดปี 2030
  //   จะถูกเพดาน 60 เดือนตัดจนยอดปี 2030 ไม่โผล่ที่ไหนเลย ทั้งที่เงินก้อนนั้นถูกบันทึกไว้จริง
  //   จึงเลื่อนจุดเริ่มมาที่ cycle ที่เก็บไว้ตัวแรกซึ่งยังอยู่ในระยะ 60 เดือนจาก lastStored
  //   หรือจาก throughMonth (เลือกขอบที่กว้างกว่า เพื่อไม่ให้การเปิดดูเดือนเก่าพัง)
  //   cycle เก่าที่หลุดหน้าต่างมักจ่ายปิดไปแล้ว (ยกไป 0) การเริ่มสายใหม่จึงไม่ทำให้ตัวเลขใดเพี้ยน
  //   และไม่ว่ากรณีใดก็ตาม การหลุดหน้าต่างจะถูกรายงานผ่าน truncated เสมอ (BR-CC-018)
  const windowFloor = minMonthKey(
    addMonths(lastStored, -(MAX_REVOLVING_CYCLES_PER_CARD - 1)),
    addMonths(requested, -(MAX_REVOLVING_CYCLES_PER_CARD - 1))
  );
  const start = (cycles.find(cycle => cycle.month.localeCompare(windowFloor) >= 0) || cycles[cycles.length - 1]).month;
  const hardStop = addMonths(start, MAX_REVOLVING_CYCLES_PER_CARD - 1);

  let end = lastStored.localeCompare(requested) >= 0 ? lastStored : requested;
  let truncated = false;
  if (end.localeCompare(hardStop) > 0) {
    end = hardStop;
    truncated = true;
  }

  // truncated ต้องเป็น "ข้อเท็จจริง" ไม่ใช่การเดาจากความยาวสาย: cycle ที่เก็บไว้จริงตัวใดหลุด
  // ช่วง [start, end] แปลว่าถูกตัดแน่นอน — สายอาจสั้นกว่า 60 แถวได้เพราะเดือนยอด 0 ถูกข้าม
  if (!truncated) {
    truncated = cycles.some(cycle => cycle.month.localeCompare(start) < 0 || cycle.month.localeCompare(end) > 0);
  }

  const normalised = normaliseCardDefaults(card);
  const monthlyRate = normalised.annualRate / 100 / 12;
  const minPct = normalised.minPaymentPercent;

  const derived = [];
  let carried = 0;

  for (let month = start; month.localeCompare(end) <= 0; month = addMonths(month, 1)) {
    const stored = storedByMonth.get(month) || null;

    // เดือนที่ไม่มีการบันทึกและไม่มียอดค้าง = ไม่มีอะไรจะแสดง → ข้ามไป ไม่ปล่อยแถวผีออกมา
    // จ่ายเต็มแล้วหยุดใช้บัตร จึงไม่เกิดแถวว่างยาวเป็นหางว่าว (BR-CC-014)
    //
    // ⚠ ต้อง "ข้าม" ไม่ใช่ "break": ผู้ใช้ที่จ่ายเต็มเดือน ส.ค. เว้นว่าง ก.ย.–ก.พ.
    //   แล้วกลับมาบันทึกยอดเดือน มี.ค. ต้องยังเห็นยอดเดือน มี.ค.
    //   ถ้า break ตรงนี้ ยอดที่บันทึกไว้จริงของทุกเดือนหลังช่องว่างจะหายไปทั้งหมด
    if (!stored && carried === 0) continue;

    const newSpend = round2(Math.max(0, toAmount(stored?.newSpend) || 0));
    const carriedBalance = carried;
    const totalDue = round2(carriedBalance + newSpend);
    const minPaymentDue = Math.min(totalDue, round2(totalDue * minPct / 100));
    const action = isValidPaymentAction(stored?.paymentAction) ? (stored?.paymentAction ?? null) : null;

    // ผลลัพธ์ถ้าเลือก "จ่ายขั้นต่ำ" — ใช้แสดงในกล่องยืนยันเท่านั้น ไม่ใช่ดอกเบี้ยที่เกิดขึ้นจริง
    // มีไว้เพื่อให้ UI ไม่ต้องคำนวณเงินเอง (ดอกเบี้ยเกิดจากการกดยืนยันเท่านั้น — BR-CC-015)
    const minimumRemaining = round2(totalDue - minPaymentDue);
    const minimumInterest = round2(minimumRemaining * monthlyRate);

    let paidAmount = 0;
    let interest = 0;
    let closingBalance = totalDue;

    if (action === 'full') {
      paidAmount = totalDue;
      interest = 0;
      closingBalance = 0;
    } else if (action === 'minimum') {
      paidAmount = minPaymentDue;
      interest = minimumInterest;
      closingBalance = round2(minimumRemaining + minimumInterest);
    }

    derived.push({
      id: stored?.id || null,
      cardId,
      month,
      newSpend,
      carriedBalance,
      totalDue,
      minPaymentDue,
      paymentAction: action,
      // ยังไม่ตัดสินใจ = เป็นหนี้ทั้งใบแจ้งหนี้ ไม่ใช่แค่ขั้นต่ำ (BR-CC-014)
      amountDue: action === 'minimum' ? minPaymentDue : totalDue,
      paidAmount,
      interest,
      closingBalance,
      paidAt: stored?.paidAt || null,
      paidSource: stored?.paidSource || null,
      minimumPreview: {
        remaining: minimumRemaining,
        interest: minimumInterest,
        closingBalance: round2(minimumRemaining + minimumInterest)
      },
      stored: Boolean(stored),
      isImplicit: !stored
    });

    carried = closingBalance;
  }

  return withTruncationFlag(derived, truncated);
}

/**
 * true เมื่อสายถูกตัดเพราะเพดาน MAX_REVOLVING_CYCLES_PER_CARD (BR-CC-018)
 *
 * อ่านธงที่ buildRevolvingCycles() ติดมากับผลลัพธ์โดยตรง ไม่เดาจากความยาวสายอีกต่อไป
 * (สายอาจสั้นกว่า 60 แถวทั้งที่ถูกตัดจริง เพราะเดือนยอด 0 ถูกข้าม และสาย 60 แถวพอดี
 *  ที่ไม่ได้ถูกตัดก็ไม่ควรถูกรายงานว่าถูกตัด)
 *
 * ⚠ ต้องส่ง array ที่ได้จาก buildRevolvingCycles() ตรง ๆ — การ map/filter จะทำให้ธงหาย
 * @param {array} derivedCycles
 * @returns {boolean}
 */
export function isRevolvingChainTruncated(derivedCycles = []) {
  return Array.isArray(derivedCycles) && derivedCycles.truncated === true;
}

/**
 * สรุปยอดหมุนเวียนของบัตร ณ เดือนหนึ่ง
 * @param {array} derivedCycles - ผลจาก buildRevolvingCycles
 * @param {{asOfMonth?: string}} options
 * @returns {{totalDue, minDue, due, outstanding, carryForward, paymentAction, cycle}}
 */
export function summariseRevolving(derivedCycles = [], options = {}) {
  const asOfMonth = typeof options.asOfMonth === 'string' && MONTH_KEY_RE.test(options.asOfMonth)
    ? options.asOfMonth
    : getCurrentMonthKey();
  const cycle = (Array.isArray(derivedCycles) ? derivedCycles : [])
    .find(item => item?.month === asOfMonth) || null;

  if (!cycle) {
    return {
      totalDue: 0,
      minDue: 0,
      due: 0,
      outstanding: 0,
      carryForward: 0,
      paymentAction: null,
      cycle: null
    };
  }

  return {
    totalDue: cycle.totalDue,
    minDue: cycle.minPaymentDue,
    // ยังต้อง "จ่ายออก" อีกเท่าไรในเดือนนี้
    due: cycle.paymentAction === null ? cycle.totalDue : 0,
    // ยอดหนี้ที่ยังกินวงเงินอยู่จริง ๆ ตอนนี้
    outstanding: cycle.paymentAction === null ? cycle.totalDue : cycle.closingBalance,
    carryForward: cycle.closingBalance,
    paymentAction: cycle.paymentAction,
    cycle
  };
}

// ---------------------------------------------------------------------------
// สรุปข้อมูล (คำนวณตอน GET เท่านั้น ไม่เก็บลงฐานข้อมูล — BR-006)
// ---------------------------------------------------------------------------

/** สถานะแผนตามตารางผ่อน — cancelled_early เป็นสถานะสุดท้าย (BR-CC-009) */
export function resolvePlanStatus(plan = {}) {
  if (plan.status === PLAN_STATUS.CANCELLED) return PLAN_STATUS.CANCELLED;
  const schedule = Array.isArray(plan.schedule) ? plan.schedule : [];
  if (schedule.length > 0 && schedule.every(row => row?.paid === true)) {
    return PLAN_STATUS.COMPLETED;
  }
  return PLAN_STATUS.ONGOING;
}

/** เพิ่มฟิลด์คำนวณให้แผนผ่อน */
export function summarisePlan(plan = {}) {
  const schedule = Array.isArray(plan.schedule) ? plan.schedule : [];
  const total = schedule.length;
  const installmentsPaid = schedule.filter(row => row?.paid === true).length;
  const installmentsRemaining = Math.max(0, total - installmentsPaid);
  const isCancelled = plan.status === PLAN_STATUS.CANCELLED;
  const unpaidRows = isCancelled ? [] : schedule.filter(row => row?.paid !== true);
  const nextUnpaidRow = unpaidRows[0] || null;

  return {
    ...plan,
    installmentsPaid,
    installmentsRemaining,
    progressPercent: total > 0 ? round2((installmentsPaid / total) * 100) : 0,
    nextUnpaid: nextUnpaidRow
      ? { no: nextUnpaidRow.no, dueMonth: nextUnpaidRow.dueMonth, payment: nextUnpaidRow.payment }
      : null,
    remainingPayable: round2(unpaidRows.reduce((sum, row) => sum + (Number(row?.payment) || 0), 0)),
    remainingPrincipal: round2(unpaidRows.reduce((sum, row) => sum + (Number(row?.principal) || 0), 0))
  };
}

/**
 * วันครบกำหนดถัดไปของบัตร — เดือนที่เร็วที่สุดจากงวดผ่อนที่ยังไม่ชำระ
 * รวมกับเดือนของ cycle หมุนเวียนที่ยังไม่ตัดสินใจชำระ (BR-CC-014)
 */
export function resolveCardNextDueDate(card = {}, plans = [], derivedCycles = []) {
  const dueMonths = [];
  plans.forEach(plan => {
    if (plan?.status !== PLAN_STATUS.ONGOING) return;
    (Array.isArray(plan.schedule) ? plan.schedule : []).forEach(row => {
      if (row?.paid === true) return;
      if (typeof row?.dueMonth === 'string') dueMonths.push(row.dueMonth);
    });
  });
  (Array.isArray(derivedCycles) ? derivedCycles : []).forEach(cycle => {
    if (cycle?.paymentAction !== null) return;
    if (!(Number(cycle?.amountDue) > 0)) return;
    if (typeof cycle?.month === 'string') dueMonths.push(cycle.month);
  });
  if (!dueMonths.length) return null;
  dueMonths.sort();
  return resolveInstallmentDueDate(card.dueDay, dueMonths[0]);
}

/**
 * เพิ่มฟิลด์คำนวณให้บัตร
 * @param {object} card
 * @param {array} plans - แผนผ่อนทั้งหมดของผู้ใช้
 * @param {array} cycles - cycle หมุนเวียนที่เก็บจริงทั้งหมดของผู้ใช้ (ค่าเริ่มต้น [] เพื่อความเข้ากันได้)
 * @param {{asOfMonth?: string}} options
 */
export function summariseCard(card = {}, plans = [], cycles = [], options = {}) {
  const cardPlans = plans.filter(plan => plan?.cardId === card.id);
  const ongoingPlans = cardPlans.filter(plan => plan?.status === PLAN_STATUS.ONGOING);

  let remainingPayable = 0;
  let remainingPrincipal = 0;
  ongoingPlans.forEach(plan => {
    (Array.isArray(plan.schedule) ? plan.schedule : []).forEach(row => {
      if (row?.paid === true) return;
      remainingPayable += Number(row?.payment) || 0;
      remainingPrincipal += Number(row?.principal) || 0;
    });
  });

  const asOfMonth = typeof options.asOfMonth === 'string' && MONTH_KEY_RE.test(options.asOfMonth)
    ? options.asOfMonth
    : getCurrentMonthKey();
  const normalisedCard = normaliseCardDefaults(card);
  const derivedCycles = buildRevolvingCycles(normalisedCard, cycles, { throughMonth: asOfMonth });
  const revolving = summariseRevolving(derivedCycles, { asOfMonth });

  // จ่ายขั้นต่ำแล้ว = ไม่ต้องจ่ายอะไรอีกเดือนนี้ (revolvingDue = 0)
  // แต่ยอดคงค้างยังกินวงเงินอยู่ (revolvingOutstanding) — บัตรจริงทำงานแบบนี้
  const installmentPayable = round2(remainingPayable);
  const installmentPrincipal = round2(remainingPrincipal);
  remainingPayable = round2(installmentPayable + revolving.due);
  remainingPrincipal = round2(installmentPrincipal + revolving.outstanding);

  const creditLimit = Number(card.creditLimit) || 0;
  return {
    ...normalisedCard,
    remainingPayable,
    remainingPrincipal,
    installmentPayable,
    installmentPrincipal,
    revolvingTotalDue: revolving.totalDue,
    revolvingMinDue: revolving.minDue,
    revolvingDue: revolving.due,
    revolvingOutstanding: revolving.outstanding,
    revolvingCarryForward: revolving.carryForward,
    revolvingAction: revolving.paymentAction,
    availableCredit: round2(Math.max(0, creditLimit - remainingPrincipal)),
    ongoingPlanCount: ongoingPlans.length,
    nextDueDate: resolveCardNextDueDate(card, ongoingPlans, derivedCycles)
  };
}

/** ยอดรวมทุกบัตรสำหรับ summary strip */
export function summariseTotals(summarisedCards = []) {
  const totals = summarisedCards.reduce((acc, card) => {
    acc.remainingPayable += Number(card.remainingPayable) || 0;
    acc.remainingPrincipal += Number(card.remainingPrincipal) || 0;
    acc.creditLimit += Number(card.creditLimit) || 0;
    acc.availableCredit += Number(card.availableCredit) || 0;
    acc.ongoingPlanCount += Number(card.ongoingPlanCount) || 0;
    acc.revolvingDue += Number(card.revolvingDue) || 0;
    acc.revolvingOutstanding += Number(card.revolvingOutstanding) || 0;
    return acc;
  }, {
    remainingPayable: 0,
    remainingPrincipal: 0,
    creditLimit: 0,
    availableCredit: 0,
    ongoingPlanCount: 0,
    revolvingDue: 0,
    revolvingOutstanding: 0
  });

  return {
    remainingPayable: round2(totals.remainingPayable),
    remainingPrincipal: round2(totals.remainingPrincipal),
    creditLimit: round2(totals.creditLimit),
    availableCredit: round2(totals.availableCredit),
    revolvingDue: round2(totals.revolvingDue),
    revolvingOutstanding: round2(totals.revolvingOutstanding),
    cardCount: summarisedCards.length,
    ongoingPlanCount: totals.ongoingPlanCount
  };
}

// ---------------------------------------------------------------------------
// Validation (ใช้ทั้งฝั่ง form และ API — API เป็นผู้ตัดสินเสมอ)
// ---------------------------------------------------------------------------

/**
 * ตรวจข้อมูลบัตร
 * @returns {{valid: boolean, errors: object, value: object}}
 */
export function validateCardInput(input = {}) {
  const errors = {};

  const name = String(input.name ?? '').trim();
  if (!name) errors.name = 'กรุณาระบุชื่อบัตร';
  else if (name.length > 40) errors.name = 'ชื่อบัตรยาวได้ไม่เกิน 40 ตัวอักษร';

  const bankName = String(input.bankName ?? '').trim();
  if (bankName.length > 40) errors.bankName = 'ชื่อธนาคารยาวได้ไม่เกิน 40 ตัวอักษร';

  const last4 = String(input.last4 ?? '').trim();
  if (last4 && !/^\d{4}$/.test(last4)) errors.last4 = 'ต้องเป็นตัวเลข 4 หลัก';

  const rawLimit = input.creditLimit === undefined || input.creditLimit === null || input.creditLimit === ''
    ? 0
    : toAmount(input.creditLimit);
  if (!Number.isFinite(rawLimit) || rawLimit < 0) errors.creditLimit = 'วงเงินต้องเป็นตัวเลขไม่ติดลบ';

  // ยอดใช้จ่ายหมุนเวียน — ว่าง = ใช้ค่าเริ่มต้น (BR-CC-017)
  const rawAnnualRate = input.annualRate === undefined || input.annualRate === null || input.annualRate === ''
    ? DEFAULT_ANNUAL_RATE
    : toAmount(input.annualRate);
  if (!Number.isFinite(rawAnnualRate) || rawAnnualRate < 0 || rawAnnualRate > 100) {
    errors.annualRate = 'ดอกเบี้ยต่อปีต้องอยู่ระหว่าง 0–100%';
  }

  // พื้นขั้นต่ำคือ 1 ไม่ใช่ 0 — ที่ 0 ยอดจะไม่มีวันลดแต่ UI จะบอกว่า "ชำระแล้ว"
  const rawMinPercent = input.minPaymentPercent === undefined || input.minPaymentPercent === null || input.minPaymentPercent === ''
    ? DEFAULT_MIN_PAYMENT_PERCENT
    : toAmount(input.minPaymentPercent);
  if (!Number.isFinite(rawMinPercent) || rawMinPercent < 1 || rawMinPercent > 100) {
    errors.minPaymentPercent = 'ขั้นต่ำต้องอยู่ระหว่าง 1–100%';
  }

  const statementDay = normaliseDayValue(input.statementDay, { fallbackToEom: true });
  if (statementDay === null) errors.statementDay = 'วันสรุปยอดต้องอยู่ระหว่าง 1–31 หรือสิ้นเดือน';

  const dueDay = normaliseDayValue(input.dueDay, { fallbackToEom: true });
  if (dueDay === null) errors.dueDay = 'วันครบกำหนดต้องอยู่ระหว่าง 1–31 หรือสิ้นเดือน';

  const color = CARD_COLORS.includes(input.color) ? input.color : CARD_COLORS[0];

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: {
      name,
      bankName,
      last4,
      color,
      creditLimit: Number.isFinite(rawLimit) && rawLimit >= 0 ? round2(rawLimit) : 0,
      annualRate: Number.isFinite(rawAnnualRate) ? round2(rawAnnualRate) : DEFAULT_ANNUAL_RATE,
      minPaymentPercent: Number.isFinite(rawMinPercent) ? round2(rawMinPercent) : DEFAULT_MIN_PAYMENT_PERCENT,
      statementDay: statementDay === null ? END_OF_MONTH_DUE_DAY : statementDay,
      dueDay: dueDay === null ? END_OF_MONTH_DUE_DAY : dueDay
    }
  };
}

/**
 * ตรวจข้อมูลยอดใช้จ่ายหมุนเวียนที่ผู้ใช้กรอก
 * รับเฉพาะ cardId / month / newSpend — ฟิลด์การเงินอื่นทั้งหมด server คำนวณเอง (BR-CC-013)
 * @returns {{valid: boolean, errors: object, value: {cardId: string, month: string, newSpend: number}}}
 */
export function validateRevolvingCycleInput(input = {}) {
  const errors = {};

  const cardId = String(input.cardId ?? '').trim();
  if (!cardId) errors.cardId = 'กรุณาเลือกบัตร';

  const month = String(input.month ?? '').trim();
  if (!MONTH_KEY_RE.test(month)) errors.month = 'เดือนต้องอยู่ในรูปแบบ YYYY-MM';

  const rawSpend = input.newSpend === undefined || input.newSpend === null || input.newSpend === ''
    ? 0
    : toAmount(input.newSpend);
  // การคืนเงิน/เครดิตยังไม่ถูกโมเดลในรอบนี้ ค่าติดลบจึงเป็น 400
  if (!Number.isFinite(rawSpend) || rawSpend < 0) {
    errors.newSpend = 'ยอดใช้จ่ายต้องเป็นตัวเลขไม่ติดลบ';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: {
      cardId,
      month,
      newSpend: Number.isFinite(rawSpend) && rawSpend >= 0 ? round2(rawSpend) : 0
    }
  };
}

/**
 * ตรวจข้อมูลแผนผ่อน
 * @returns {{valid: boolean, errors: object, value: object}}
 */
export function validatePlanInput(input = {}) {
  const errors = {};

  const cardId = String(input.cardId ?? '').trim();
  if (!cardId) errors.cardId = 'กรุณาเลือกบัตร';

  const itemName = String(input.itemName ?? '').trim();
  if (!itemName) errors.itemName = 'กรุณาระบุชื่อสินค้า';
  else if (itemName.length > 60) errors.itemName = 'ชื่อสินค้ายาวได้ไม่เกิน 60 ตัวอักษร';

  const totalPrice = toAmount(input.totalPrice);
  if (!Number.isFinite(totalPrice) || totalPrice <= 0) errors.totalPrice = 'ราคาต้องมากกว่า 0';

  const monthsValue = Number(input.months);
  const months = Number.isFinite(monthsValue) ? Math.floor(monthsValue) : NaN;
  if (!Number.isFinite(months) || months < 1 || months > MAX_INSTALLMENTS_PER_PLAN) {
    errors.months = `จำนวนงวดต้องอยู่ระหว่าง 1–${MAX_INSTALLMENTS_PER_PLAN}`;
  }

  const startMonth = String(input.startMonth ?? '').trim();
  if (!MONTH_KEY_RE.test(startMonth)) errors.startMonth = 'กรุณาเลือกเดือนเริ่มผ่อน';

  const interestMode = INTEREST_MODES.includes(input.interestMode) ? input.interestMode : 'manual';

  let manualFeePerMonth = 0;
  let annualRate = 0;
  let calcMethod = null;

  if (interestMode === 'manual') {
    const fee = input.manualFeePerMonth === undefined
      || input.manualFeePerMonth === null
      || input.manualFeePerMonth === ''
      ? 0
      : toAmount(input.manualFeePerMonth);
    if (!Number.isFinite(fee) || fee < 0) errors.manualFeePerMonth = 'ต้องเป็นตัวเลขไม่ติดลบ';
    else manualFeePerMonth = round2(fee);
  } else {
    const rate = toAmount(input.annualRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      errors.annualRate = 'อัตราดอกเบี้ยต้องอยู่ระหว่าง 0–100';
    } else {
      annualRate = rate;
    }
    if (!CALC_METHODS.includes(input.calcMethod)) errors.calcMethod = 'กรุณาเลือกวิธีคำนวณ';
    else calcMethod = input.calcMethod;
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: {
      cardId,
      itemName,
      totalPrice: Number.isFinite(totalPrice) ? round2(totalPrice) : 0,
      months: Number.isFinite(months) ? months : 0,
      startMonth,
      interestMode,
      manualFeePerMonth,
      annualRate,
      calcMethod
    }
  };
}
