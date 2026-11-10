// creditCardAmortization.ts
// ตารางผ่อนชำระ (ADR-010)
//
// โมดูลนี้เป็น pure function ล้วน (ไม่มี I/O, ไม่มี state) จึง import ได้ทั้งฝั่ง server และ client
// ฟอร์มพรีวิวและ API ใช้ buildSchedule() ตัวเดียวกัน พรีวิวกับข้อมูลที่บันทึกจึงไม่มีทางไม่ตรงกัน
// (ADR-010 · BR-CC-004 · BR-CC-005)
//
// ย้ายออกมาจาก creditCardUtils.js (TD-H02 sub-slice 2/3) — creditCardUtils.js ยังคง re-export
// สัญลักษณ์ทั้ง 4 ตัวที่ export จากไฟล์นี้ ไม่มีการเปลี่ยนพฤติกรรมใด ๆ ในไฟล์นี้ — เฉพาะการเพิ่ม
// type annotation เท่านั้น

import { MONTH_KEY_RE, round2, toAmount, addMonths, getCurrentMonthKey } from './creditCardBasics';

/** แถวเดียวในตารางผ่อนชำระ */
type ScheduleRow = {
  no: number;
  dueMonth: string;
  payment: number;
  principal: number;
  interest: number;
  paid: boolean;
  paidAt: null;
  paidSource: null;
};

/** ผลลัพธ์รวมของตารางผ่อนชำระ */
type ScheduleSummary = {
  schedule: ScheduleRow[];
  monthlyPayment: number;
  totalInterest: number;
  totalPayable: number;
};

function createScheduleRow(no: number, startMonth: string, principal: number, interest: number): ScheduleRow {
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
function summariseSchedule(schedule: ScheduleRow[]): ScheduleSummary {
  const totalInterest = round2(schedule.reduce((sum, row) => sum + row.interest, 0));
  const totalPayable = round2(schedule.reduce((sum, row) => sum + row.payment, 0));
  return {
    schedule,
    monthlyPayment: schedule.length ? schedule[0].payment : 0,
    totalInterest,
    totalPayable
  };
}

function normaliseScheduleInput({
  totalPrice,
  months,
  startMonth
}: {
  totalPrice?: number | string;
  months?: number | string;
  startMonth?: string;
}): { price: number; count: number; start: string } {
  return {
    price: round2(totalPrice ?? ''),
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
export function buildManualSchedule(input: {
  totalPrice?: number | string;
  months?: number | string;
  startMonth?: string;
  manualFeePerMonth?: number | string;
} = {}): ScheduleSummary {
  const { price, count, start } = normaliseScheduleInput(input);
  const fee = round2(Math.max(0, toAmount(input.manualFeePerMonth ?? '') || 0));
  const basePrincipal = round2(price / count);
  const schedule: ScheduleRow[] = [];
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
export function buildFlatSchedule(input: {
  totalPrice?: number | string;
  months?: number | string;
  startMonth?: string;
  annualRate?: number | string;
} = {}): ScheduleSummary {
  const { price, count, start } = normaliseScheduleInput(input);
  const rate = Math.max(0, toAmount(input.annualRate ?? '') || 0);
  const totalInterest = round2(price * (rate / 100) * (count / 12));
  const baseInterest = round2(totalInterest / count);
  const basePrincipal = round2(price / count);
  const schedule: ScheduleRow[] = [];
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
export function buildEffectiveSchedule(input: {
  totalPrice?: number | string;
  months?: number | string;
  startMonth?: string;
  annualRate?: number | string;
} = {}): ScheduleSummary {
  const { price, count, start } = normaliseScheduleInput(input);
  const rate = Math.max(0, toAmount(input.annualRate ?? '') || 0);
  const monthlyRate = rate / 100 / 12;
  const nominalPayment = monthlyRate > 0
    ? (price * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -count))
    : price / count;
  const safeNominal = Number.isFinite(nominalPayment) ? nominalPayment : price / count;

  const schedule: ScheduleRow[] = [];
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

/** แถวที่บันทึกแล้วของแผนสินเชื่อ — อาจมี paidAt/paidSource จริง หรือ field อื่นเพิ่มเติม */
type RevisableScheduleRow = {
  no: number;
  dueMonth: string;
  payment: number;
  principal: number;
  interest: number;
  paid?: boolean;
};

export type ReviseTailFailureReason = 'paid_in_tail' | 'out_of_range' | 'no_balance';

export type ReviseTailResult<Row extends RevisableScheduleRow> =
  | {
    ok: true;
    schedule: Array<Row | ScheduleRow>;
    monthlyPayment: number;
    totalInterest: number;
    totalPayable: number;
  }
  | { ok: false; reason: ReviseTailFailureReason };

/**
 * แปลงเดือนที่มีผลเป็นเลขงวด k (1-based ตามตำแหน่งในตาราง) — null เมื่อไม่ตรงกับ dueMonth ของงวดใดเลย (E-14)
 * ตัวเดียวที่ทั้ง route rate-revisions และ preview ใน LoanRateRevisionDialog ใช้ (N-4) — ห้ามเขียนซ้ำที่อื่น
 */
export function findRevisionInstallmentNo(
  rows: readonly ({ dueMonth?: unknown } | null | undefined)[],
  effectiveMonth: string
): number | null {
  const index = rows.findIndex((row) => row?.dueMonth === effectiveMonth);
  return index === -1 ? null : index + 1;
}

/**
 * ปรับอัตราดอกเบี้ยสินเชื่อตั้งแต่งวด fromInstallmentNo เป็นต้นไป (spec loan-installments §I-3)
 * งวดก่อนหน้า k คงค่าเดิมทุก field · ส่วนท้ายคำนวณใหม่ด้วย buildEffectiveSchedule จากเงินต้นคงเหลือ
 * monthlyPayment = ค่างวดแรกของส่วนท้ายใหม่ · pure function ไม่แก้ไข plan ที่ส่งเข้ามา
 */
export function reviseEffectiveScheduleTail<Row extends RevisableScheduleRow>(
  plan: { totalPrice: number | string; schedule: readonly Row[] },
  { fromInstallmentNo, annualRate }: { fromInstallmentNo: number; annualRate: number | string }
): ReviseTailResult<Row> {
  const rows = plan.schedule;
  const k = fromInstallmentNo;
  if (!Number.isInteger(k) || k < 1 || k > rows.length) {
    return { ok: false, reason: 'out_of_range' };
  }
  if (rows.some((row) => row.no >= k && row.paid === true)) {
    return { ok: false, reason: 'paid_in_tail' };
  }

  const head = rows.slice(0, k - 1);
  const paidPrincipal = head.reduce((sum, row) => sum + row.principal, 0);
  const balance = round2(round2(plan.totalPrice) - paidPrincipal);
  if (balance <= 0) {
    return { ok: false, reason: 'no_balance' };
  }

  const offset = k - 1;
  const tail = buildEffectiveSchedule({
    totalPrice: balance,
    months: rows.length - offset,
    startMonth: rows[offset].dueMonth,
    annualRate
  }).schedule.map((row) => ({ ...row, no: row.no + offset }));

  // คัดลอกแถวเดิม (shallow) เพื่อไม่ให้ผลลัพธ์แชร์ object กับ input
  const schedule: Array<Row | ScheduleRow> = [...head.map((row) => ({ ...row })), ...tail];
  return {
    ok: true,
    schedule,
    monthlyPayment: tail[0].payment,
    totalInterest: round2(schedule.reduce((sum, row) => sum + row.interest, 0)),
    totalPayable: round2(schedule.reduce((sum, row) => sum + row.payment, 0))
  };
}

/**
 * สร้างตารางผ่อนตามโหมดที่เลือก
 * @returns {{schedule: array, monthlyPayment: number, totalInterest: number, totalPayable: number}}
 */
export function buildSchedule(input: {
  interestMode?: string;
  calcMethod?: string;
  totalPrice?: number | string;
  months?: number | string;
  startMonth?: string;
  manualFeePerMonth?: number | string;
  annualRate?: number | string;
} = {}): ScheduleSummary {
  if (input.interestMode === 'calculated') {
    return input.calcMethod === 'effective'
      ? buildEffectiveSchedule(input)
      : buildFlatSchedule(input);
  }
  return buildManualSchedule(input);
}
