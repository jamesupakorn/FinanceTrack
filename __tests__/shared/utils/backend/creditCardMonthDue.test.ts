/** @jest-environment node */
// spec-credit-card-tiles §3.2 / AC-T1, AC-T2, AC-T6 + review REV-2: buildCardMonthDueMap is a pure
// read of the ccr_<cardId> row of buildCardTotalExpenseRows. Pure functions only — no I/O.
import { buildRevolvingRowKey } from '../../../../src/shared/utils/creditCardUtils';
import {
  buildCardMonthDueMap,
  buildCardTotalExpenseRows
} from '../../../../src/shared/utils/backend/creditCardSync';

jest.mock('../../../../src/shared/utils/backend/creditCardStore', () => ({
  getUserCreditData: jest.fn(),
  updateUserCreditData: jest.fn()
}));

const MONTH = '2024-02';
const A = { id: 'cc_aaaaaaaaaaaa', name: 'A', annualRate: 0, minPaymentPercent: 10, dueDay: 20 };
const B = { id: 'cc_bbbbbbbbbbbb', name: 'B', annualRate: 0, minPaymentPercent: 10, dueDay: 5 };
const C = { id: 'cc_cccccccccccc', name: 'C', annualRate: 0, minPaymentPercent: 10, dueDay: 1 };

function fixture(actionA: 'full' | 'minimum' | null = null) {
  return {
    cards: [A, B, C],
    plans: [
      { id: 'ip_000000000001', cardId: A.id, itemName: 'TV', months: 2, status: 'ongoing',
        schedule: [{ no: 1, dueMonth: '2024-01', payment: 300, paid: true }, { no: 2, dueMonth: MONTH, payment: 300, paid: true }] },
      { id: 'ip_000000000002', cardId: A.id, itemName: 'Phone', months: 1, status: 'ongoing',
        schedule: [{ no: 1, dueMonth: MONTH, payment: 250.5, paid: false }] }
    ],
    cycles: [
      // carried balance from January (no payment recorded)
      { cardId: A.id, month: '2024-01', newSpend: 1000, paymentAction: null },
      { cardId: A.id, month: MONTH, newSpend: 0, cashbackAmount: 40, paymentAction: actionA },
      // credit balance: cashback larger than spend -> negative totalDue
      { cardId: B.id, month: MONTH, newSpend: 100, cashbackAmount: 600, paymentAction: null }
    ],
    spendItems: [
      { id: 'si_000000000001', cardId: A.id, month: MONTH, name: 'food', amount: 400, source: 'user' }
    ]
  };
}

describe('buildCardMonthDueMap', () => {
  it('AC-T1/AC-T2: mirrors the ccr_ row exactly (installments incl. paid + spend + carried + cashback)', () => {
    const data = fixture();
    const rows = buildCardTotalExpenseRows(data, MONTH);
    const map = buildCardMonthDueMap(data, MONTH);
    const row = rows[buildRevolvingRowKey(A.id)];

    expect(row).toBeDefined();
    expect(row.breakdown.revolving.carriedBalance).toBeGreaterThan(0);
    expect(row.breakdown.revolving.cashbackAmount).toBe(40);
    expect(row.breakdown.installmentTotal).toBe(550.5); // paid installment still counted
    expect(map[A.id]).toEqual({
      dueMonth: MONTH,
      installmentDueThisMonth: row.breakdown.installmentTotal,
      revolvingDueThisMonth: Math.max(0, row.breakdown.revolving.totalDue),
      totalDueThisMonth: row.actual
    });
    expect(map[A.id].totalDueThisMonth).toBeCloseTo(map[A.id].installmentDueThisMonth + map[A.id].revolvingDueThisMonth, 2);
  });

  it('REV-2: negative totalDue (credit balance) gives revolvingDueThisMonth 0 and total == row.actual', () => {
    const data = fixture();
    const row = buildCardTotalExpenseRows(data, MONTH)[buildRevolvingRowKey(B.id)];
    expect(row.breakdown.revolving.totalDue).toBeLessThan(0);
    expect(buildCardMonthDueMap(data, MONTH)[B.id]).toEqual({
      dueMonth: MONTH, installmentDueThisMonth: 0, revolvingDueThisMonth: 0, totalDueThisMonth: row.actual
    });
    expect(row.actual).toBe(0);
  });

  it('AC-T2: a card with no row still gets an entry of zeros', () => {
    const data = fixture();
    expect(buildCardTotalExpenseRows(data, MONTH)[buildRevolvingRowKey(C.id)]).toBeUndefined();
    expect(buildCardMonthDueMap(data, MONTH)[C.id]).toEqual({
      dueMonth: MONTH, installmentDueThisMonth: 0, revolvingDueThisMonth: 0, totalDueThisMonth: 0
    });
    expect(Object.keys(buildCardMonthDueMap(data, MONTH)).sort()).toEqual([A.id, B.id, C.id].sort());
  });

  it('AC-T6: choosing minimum payment still reports the full amount', () => {
    const none = buildCardMonthDueMap(fixture(null), MONTH)[A.id];
    const minimum = buildCardMonthDueMap(fixture('minimum'), MONTH)[A.id];
    const minRow = buildCardTotalExpenseRows(fixture('minimum'), MONTH)[buildRevolvingRowKey(A.id)];
    expect(minimum.totalDueThisMonth).toBe(none.totalDueThisMonth);
    expect(minimum.totalDueThisMonth).toBe(minRow.actual);
    expect(minimum.totalDueThisMonth).toBeGreaterThan(minRow.breakdown.revolving.minPaymentDue);
  });

  it('is defensive: null data / bad month -> zeros for each card, never throws, input not mutated', () => {
    expect(buildCardMonthDueMap(null, MONTH)).toEqual({});
    const data = fixture();
    const before = JSON.stringify(data);
    expect(buildCardMonthDueMap(data, 'bad')[A.id].totalDueThisMonth).toBe(0);
    buildCardMonthDueMap(data, MONTH);
    expect(JSON.stringify(data)).toBe(before);
  });
});
