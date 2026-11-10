// Shared AC-LN-25 fixture: the same stored loan plan and revision input feed both the dialog preview test
// (__tests__/components/LoanRateRevisionDialog.test.tsx) and the route parity case
// (__tests__/api/credit-cards/rate-revisions.test.ts), so the two cannot drift apart silently.
import { buildSchedule } from '../../src/shared/utils/creditCardUtils';

export const FIXTURE_LOAN_CARD_ID = 'cc_10a010a010a0';
export const FIXTURE_LOAN_PLAN_ID = 'ip_aaaaaaaaaaaa';

const LOAN_INPUT = {
  totalPrice: 1000000,
  months: 240,
  startMonth: '2026-12',
  interestMode: 'calculated',
  annualRate: 6,
  calcMethod: 'effective'
};

/** AC-LN-08 loan (1,000,000 / 240 / 6% effective), rows 1–12 paid — the stored document shape. */
export function buildRevisionFixturePlan(): Record<string, unknown> & { schedule: Array<Record<string, unknown> & { dueMonth: string }> } {
  const computed = buildSchedule(LOAN_INPUT);
  const schedule = computed.schedule.map(row => (row.no <= 12
    ? { ...row, paid: true, paidAt: '2027-01-10T03:00:00.000Z', paidSource: 'credit_card' }
    : { ...row, paid: false, paidAt: null, paidSource: null }));
  return {
    id: FIXTURE_LOAN_PLAN_ID,
    cardId: FIXTURE_LOAN_CARD_ID,
    itemName: 'บ้านหลังแรก',
    ...LOAN_INPUT,
    purchaseDate: '2026-11-15',
    manualFeePerMonth: 0,
    monthlyPayment: computed.monthlyPayment,
    totalInterest: computed.totalInterest,
    totalPayable: computed.totalPayable,
    schedule,
    status: 'ongoing',
    cancelledAt: null,
    createdAt: '2026-11-15T00:00:00.000Z',
    updatedAt: '2026-11-15T00:00:00.000Z'
  };
}

/** Revision input: first unpaid row (13, 2027-12). The 3-decimal rate exercises the shared round2 step. */
export const REVISION_FIXTURE_INPUTS = [
  { effectiveMonth: '2027-12', annualRate: 7 },
  { effectiveMonth: '2027-12', annualRate: 7.125 },
  { effectiveMonth: '2028-06', annualRate: 4.5 }
] as const;
