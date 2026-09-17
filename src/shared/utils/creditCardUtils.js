/**
 * creditCardUtils.js
 * คณิตศาสตร์และ validation ของบัตรเครดิต / แผนผ่อนชำระ
 *
 * โมดูลนี้เป็น pure function ล้วน (ไม่มี I/O, ไม่มี state) จึง import ได้ทั้งฝั่ง server และ client
 * ฟอร์มพรีวิวและ API ใช้ buildSchedule() ตัวเดียวกัน พรีวิวกับข้อมูลที่บันทึกจึงไม่มีทางไม่ตรงกัน
 * (ADR-010 · BR-CC-004 · BR-CC-005)
 */

import {
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
  MONTH_KEY_RE,
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
import { END_OF_MONTH_DUE_DAY } from './dateUtils';
import { buildManualSchedule, buildFlatSchedule, buildEffectiveSchedule, buildSchedule } from './creditCardAmortization';

// สัญลักษณ์ 34 ตัวนี้ย้ายไป creditCardBasics.ts แล้ว (TD-H02 sub-slice 1/3) — re-export ต่อที่นี่
// เพื่อให้ 28 importer เดิมของ creditCardUtils ไม่ต้องแก้ไขอะไรเลย (MONTH_KEY_RE ไม่ re-export
// เพราะไม่มี external importer ใช้งาน — ใช้เฉพาะภายในไฟล์นี้ สำหรับ section 5-7 ด้านล่าง)
// END_OF_MONTH_DUE_DAY ไม่ได้ย้ายมา — ไฟล์เดิม import ตรงจาก dateUtils อยู่แล้วสำหรับ section 7
// (validateCardInput) เท่านั้น ไม่มี external importer ใช้ผ่าน creditCardUtils เลย จึงไม่ re-export
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
  isCreditCardRowKey,
  buildManualSchedule,
  buildFlatSchedule,
  buildEffectiveSchedule,
  buildSchedule
};

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
