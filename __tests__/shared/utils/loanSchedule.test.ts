/** @jest-environment node */
// Loan slice S4 / D1 — pure tail math for a loan rate revision (spec loan-installments §I-3).
// Covers AC-LN-18 numerics, E-8/E-16 (zero-rate tail), E-18 (k = 1, nothing paid), and the
// out_of_range / paid_in_tail / no_balance failure shapes.
import {
  buildEffectiveSchedule,
  reviseEffectiveScheduleTail
} from '../../../src/shared/utils/creditCardAmortization';
import { round2 } from '../../../src/shared/utils/creditCardBasics';

type StoredRow = {
  no: number;
  dueMonth: string;
  payment: number;
  principal: number;
  interest: number;
  paid: boolean;
  paidAt: string | null;
  paidSource: string | null;
};

const START_MONTH = '2026-01';

// AC-LN-08 loan: 1,000,000 over 240 months at 6% effective.
function buildLoanPlan(paidCount: number): { totalPrice: number; schedule: StoredRow[] } {
  const { schedule } = buildEffectiveSchedule({
    totalPrice: 1_000_000,
    months: 240,
    startMonth: START_MONTH,
    annualRate: 6
  });
  return {
    totalPrice: 1_000_000,
    schedule: schedule.map((row) => (row.no <= paidCount
      ? { ...row, paid: true, paidAt: `2026-${String(row.no).padStart(2, '0')}-05T00:00:00.000Z`, paidSource: 'manual' }
      : { ...row }))
  };
}

const sumPrincipal = (rows: Array<{ principal: number }>): number =>
  round2(rows.reduce((sum, row) => sum + row.principal, 0));

describe('reviseEffectiveScheduleTail — AC-LN-18 (rows 1–12 paid, 6% → 7% from row 13)', () => {
  const plan = buildLoanPlan(12);
  const snapshot = JSON.parse(JSON.stringify(plan));
  const result = reviseEffectiveScheduleTail(plan, { fromInstallmentNo: 13, annualRate: 7 });

  it('succeeds and keeps the full length', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schedule).toHaveLength(240);
    expect(result.schedule.map((row) => row.no)).toEqual(Array.from({ length: 240 }, (_, i) => i + 1));
  });

  it('keeps rows 1–12 deep-equal to the pre-revision values, including paidAt', () => {
    if (!result.ok) throw new Error('expected ok');
    expect(result.schedule.slice(0, 12)).toEqual(snapshot.schedule.slice(0, 12));
    expect(result.schedule[0]).not.toBe(plan.schedule[0]);
  });

  it('rebuilds rows 13–240 from buildEffectiveSchedule on the remaining balance, renumbered', () => {
    if (!result.ok) throw new Error('expected ok');
    const balance = round2(1_000_000 - sumPrincipal(plan.schedule.slice(0, 12)));
    const expectedTail = buildEffectiveSchedule({
      totalPrice: balance,
      months: 228,
      startMonth: plan.schedule[12].dueMonth,
      annualRate: 7
    }).schedule.map((row) => ({ ...row, no: row.no + 12 }));
    expect(result.schedule.slice(12)).toEqual(expectedTail);
    expect(result.schedule[12].dueMonth).toBe(plan.schedule[12].dueMonth);
    expect(result.schedule[239].dueMonth).toBe(plan.schedule[239].dueMonth);
    // 7% must cost more per month than the original 6% row 13.
    expect(result.schedule[12].payment).toBeGreaterThan(plan.schedule[12].payment);
  });

  it('Σ principal === 1,000,000.00 across the full schedule', () => {
    if (!result.ok) throw new Error('expected ok');
    expect(sumPrincipal(result.schedule)).toBe(1_000_000);
  });

  it('monthlyPayment === schedule[12].payment and totals are re-summed', () => {
    if (!result.ok) throw new Error('expected ok');
    expect(result.monthlyPayment).toBe(result.schedule[12].payment);
    expect(result.totalInterest).toBe(round2(result.schedule.reduce((s, r) => s + r.interest, 0)));
    expect(result.totalPayable).toBe(round2(result.schedule.reduce((s, r) => s + r.payment, 0)));
    expect(result.totalPayable).toBe(round2(1_000_000 + result.totalInterest));
  });

  it('does not mutate the input plan', () => {
    expect(plan).toEqual(snapshot);
  });
});

describe('reviseEffectiveScheduleTail — zero rate tail (E-8, E-16)', () => {
  it('uses the zero branch: interest 0, equal principal, balance fully repaid', () => {
    const plan = buildLoanPlan(12);
    const result = reviseEffectiveScheduleTail(plan, { fromInstallmentNo: 13, annualRate: 0 });
    if (!result.ok) throw new Error('expected ok');
    const tail = result.schedule.slice(12);
    expect(tail.every((row) => row.interest === 0)).toBe(true);
    const balance = round2(1_000_000 - sumPrincipal(plan.schedule.slice(0, 12)));
    const base = round2(balance / 228);
    expect(tail.slice(0, -1).every((row) => row.principal === base)).toBe(true);
    expect(sumPrincipal(result.schedule)).toBe(1_000_000);
    expect(result.monthlyPayment).toBe(base);
    expect(result.totalInterest).toBe(round2(plan.schedule.slice(0, 12).reduce((s, r) => s + r.interest, 0)));
  });
});

describe('reviseEffectiveScheduleTail — k = 1 with nothing paid (E-18)', () => {
  it('recomputes the whole schedule, equal to a fresh build at the new rate', () => {
    const plan = buildLoanPlan(0);
    const snapshot = JSON.parse(JSON.stringify(plan));
    const result = reviseEffectiveScheduleTail(plan, { fromInstallmentNo: 1, annualRate: 7 });
    if (!result.ok) throw new Error('expected ok');
    const fresh = buildEffectiveSchedule({
      totalPrice: 1_000_000,
      months: 240,
      startMonth: START_MONTH,
      annualRate: 7
    });
    expect(result.schedule).toEqual(fresh.schedule);
    expect(result.monthlyPayment).toBe(fresh.monthlyPayment);
    expect(result.totalInterest).toBe(fresh.totalInterest);
    expect(result.totalPayable).toBe(fresh.totalPayable);
    expect(plan).toEqual(snapshot);
  });
});

describe('reviseEffectiveScheduleTail — failure shapes', () => {
  it('returns out_of_range at k = 0', () => {
    expect(reviseEffectiveScheduleTail(buildLoanPlan(0), { fromInstallmentNo: 0, annualRate: 7 }))
      .toEqual({ ok: false, reason: 'out_of_range' });
  });

  it('returns out_of_range at k > schedule.length', () => {
    expect(reviseEffectiveScheduleTail(buildLoanPlan(0), { fromInstallmentNo: 241, annualRate: 7 }))
      .toEqual({ ok: false, reason: 'out_of_range' });
  });

  it('returns out_of_range for a non-integer k', () => {
    expect(reviseEffectiveScheduleTail(buildLoanPlan(0), { fromInstallmentNo: 12.5, annualRate: 7 }))
      .toEqual({ ok: false, reason: 'out_of_range' });
  });

  it('returns paid_in_tail when any row at or after k is paid', () => {
    const plan = buildLoanPlan(12);
    expect(reviseEffectiveScheduleTail(plan, { fromInstallmentNo: 12, annualRate: 7 }))
      .toEqual({ ok: false, reason: 'paid_in_tail' });
    const gapPlan = buildLoanPlan(0);
    gapPlan.schedule[99] = { ...gapPlan.schedule[99], paid: true, paidAt: '2034-04-05T00:00:00.000Z' };
    expect(reviseEffectiveScheduleTail(gapPlan, { fromInstallmentNo: 13, annualRate: 7 }))
      .toEqual({ ok: false, reason: 'paid_in_tail' });
  });

  it('returns no_balance when the rows before k already cover the principal', () => {
    const plan = {
      totalPrice: 1000,
      schedule: [
        { no: 1, dueMonth: '2026-01', payment: 1000, principal: 1000, interest: 0, paid: true },
        { no: 2, dueMonth: '2026-02', payment: 0, principal: 0, interest: 0, paid: false }
      ]
    };
    expect(reviseEffectiveScheduleTail(plan, { fromInstallmentNo: 2, annualRate: 7 }))
      .toEqual({ ok: false, reason: 'no_balance' });
  });
});
