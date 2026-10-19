export {};

const fs: typeof import('node:fs') = require('node:fs');
const path: typeof import('node:path') = require('node:path');
const {
  isValidCashbackAmount,
  buildRevolvingCycles,
  summariseRevolving,
  summariseCard,
  summariseTotals,
  validateRevolvingCycleInput,
  round2
} = require('../../../src/shared/utils/creditCardUtils');
const revolvingModule = require('../../../src/shared/utils/creditCardRevolving');

interface StoredCycle {
  cardId: string;
  month: string;
  [field: string]: unknown;
}

const CARD = { id: 'cc_x', annualRate: 12, minPaymentPercent: 10 };
const cycle = (month: string, fields: Record<string, unknown> = {}): StoredCycle => ({ cardId: 'cc_x', month, ...fields });

function chain(stored: StoredCycle[], throughMonth = stored[stored.length - 1].month): ReturnType<typeof import('../../../src/shared/utils/creditCardRevolving').buildRevolvingCycles> {
  return buildRevolvingCycles(CARD, stored, { throughMonth });
}

function byMonth<T extends { month: string }>(rows: T[], month: string): T | undefined {
  return rows.find(row => row.month === month);
}

const EDGE_FIXTURES: Record<string, StoredCycle[]> = {
  edge1: [cycle('2099-01', { newSpend: 1000, cashbackAmount: 100 })],
  edge2: [cycle('2099-01', { newSpend: 1000, cashbackAmount: 1000 })],
  edge3: [cycle('2099-01', { newSpend: 300, cashbackAmount: 500 }), cycle('2099-02', { newSpend: 1000 })],
  edge4: [cycle('2099-01', { cashbackAmount: 500 }), cycle('2099-03', { newSpend: 200 }), cycle('2099-04', { newSpend: 1000 })],
  edge5: [cycle('2099-01', { newSpend: 300, cashbackAmount: 500, paymentAction: 'full' }), cycle('2099-02', { newSpend: 1000 })],
  edge6: [cycle('2099-01', { newSpend: 300, cashbackAmount: 500, paymentAction: 'minimum' })],
  edge7: [cycle('2099-01', { newSpend: 2000, cashbackAmount: 500, paymentAction: 'minimum' })],
  edge8: [cycle('2099-01', { newSpend: 1000, paymentAction: 'minimum' }), cycle('2099-02', { cashbackAmount: 1000 })],
  edge9: [cycle('2099-01', { newSpend: 1000, paymentAction: 'minimum' }), cycle('2099-02', { cashbackAmount: 1000, paymentAction: 'full' })]
};

describe('isValidCashbackAmount', () => {
  it.each([0, 100, 0.01, '100', '1,234.50', '-0'])('accepts %p', (value: unknown) => {
    expect(isValidCashbackAmount(value)).toBe(true);
  });

  it.each([-0.01, -1, '', '  ', null, undefined, 'abc', NaN, Infinity, true, {}, []])('rejects %p', (value: unknown) => {
    expect(isValidCashbackAmount(value)).toBe(false);
  });

  it('is exported from the creditCardUtils barrel as the same function as the module export', () => {
    expect(typeof isValidCashbackAmount).toBe('function');
    expect(isValidCashbackAmount).toBe(revolvingModule.isValidCashbackAmount);
  });
});

describe('buildRevolvingCycles with cashback (signed chain)', () => {
  it('edge 1: cashback smaller than the debt reduces totalDue and every figure derived from it', () => {
    const rows = chain(EDGE_FIXTURES.edge1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ newSpend: 1000, cashbackAmount: 100, carriedBalance: 0, totalDue: 900, minPaymentDue: 90, paymentAction: null, amountDue: 900, paidAmount: 0, interest: 0, closingBalance: 900, creditBalance: 0 });
    expect(rows[0].minimumPreview).toEqual({ remaining: 810, interest: 8.1, closingBalance: 818.1 });
  });

  it('edge 2: cashback equal to the debt gives a zero month and the next unstored month is skipped', () => {
    const rows = chain(EDGE_FIXTURES.edge2, '2099-03');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ totalDue: 0, minPaymentDue: 0, amountDue: 0, closingBalance: 0, creditBalance: 0 });
  });

  it('edge 3: cashback larger than the debt becomes a credit carried into next month', () => {
    const rows = chain(EDGE_FIXTURES.edge3);
    expect(rows).toHaveLength(2);
    const [jan, feb] = rows;
    expect(jan).toMatchObject({ totalDue: -200, minPaymentDue: 0, paidAmount: 0, interest: 0, amountDue: 0, closingBalance: -200, creditBalance: 200 });
    expect(jan.minimumPreview).toEqual({ remaining: -200, interest: 0, closingBalance: -200 });
    expect(feb).toMatchObject({ carriedBalance: -200, totalDue: 800, minPaymentDue: 80 });
  });

  it('edge 4: a credit carries across an unstored month as an implicit row until spend absorbs it', () => {
    const rows = chain(EDGE_FIXTURES.edge4);
    expect(rows.map((row: { month: string }) => row.month)).toEqual(['2099-01', '2099-02', '2099-03', '2099-04']);
    expect(byMonth(rows, '2099-01')?.totalDue).toBe(-500);
    expect(byMonth(rows, '2099-02')).toMatchObject({ isImplicit: true, stored: false, carriedBalance: -500, totalDue: -500, interest: 0, creditBalance: 500 });
    expect(byMonth(rows, '2099-03')?.totalDue).toBe(-300);
    expect(byMonth(rows, '2099-04')).toMatchObject({ totalDue: 700, minPaymentDue: 70 });
  });

  it("edge 5: a stored 'full' on a credit cycle does not erase the credit", () => {
    const [jan, feb] = chain(EDGE_FIXTURES.edge5);
    expect(jan).toMatchObject({ paymentAction: 'full', paidAmount: 0, interest: 0, closingBalance: -200, amountDue: 0 });
    expect(feb.totalDue).toBe(800);
  });

  it("edge 6: a stored 'minimum' on a credit cycle pays nothing and charges no interest", () => {
    const [jan] = chain(EDGE_FIXTURES.edge6);
    expect(jan).toMatchObject({ paymentAction: 'minimum', paidAmount: 0, interest: 0, closingBalance: -200 });
  });

  it("edge 7: cashback with 'minimum' on a positive balance behaves as today on the net total", () => {
    const [jan] = chain(EDGE_FIXTURES.edge7);
    expect(jan).toMatchObject({ totalDue: 1500, minPaymentDue: 150, paidAmount: 150, interest: 13.5, closingBalance: 1363.5, amountDue: 150 });
  });

  it('edges 8/9: cashback wipes out a carried interest-bearing balance, and full on that month keeps the credit', () => {
    const feb8 = byMonth(chain(EDGE_FIXTURES.edge8), '2099-02');
    expect(feb8).toMatchObject({ carriedBalance: 909, totalDue: -91, creditBalance: 91 });
    const feb9 = byMonth(chain(EDGE_FIXTURES.edge9), '2099-02');
    expect(feb9).toMatchObject({ paymentAction: 'full', paidAmount: 0, closingBalance: -91 });
  });

  it.each(['abc', -100, null, {}])('edge 10: a bad stored cashbackAmount %p is read as 0', (bad: unknown) => {
    const baseline = chain([cycle('2099-01', { newSpend: 1000 })])[0];
    const row = chain([cycle('2099-01', { newSpend: 1000, cashbackAmount: bad })])[0];
    expect(row.cashbackAmount).toBe(0);
    expect(row.totalDue).toBe(baseline.totalDue);
  });

  it("edge 10: a comma-formatted stored cashbackAmount '1,234.50' is read as 1234.5", () => {
    const row = chain([cycle('2099-01', { newSpend: 2000, cashbackAmount: '1,234.50' })])[0];
    expect(row.cashbackAmount).toBe(1234.5);
    expect(row.totalDue).toBe(765.5);
  });

  it('edge 11: floating drift that rounds to zero is not a credit cycle and emits no phantom rows', () => {
    const rows = chain([cycle('2099-01', { newSpend: 100.1 }), cycle('2099-02', { newSpend: 0.2, cashbackAmount: 100.3 })], '2099-04');
    expect(rows).toHaveLength(2);
    const feb = rows[1];
    expect(feb.totalDue === 0).toBe(true);
    expect(feb.amountDue === 0).toBe(true);
    expect(feb.minPaymentDue).toBe(0);
    expect(Object.is(feb.creditBalance, 0)).toBe(true);
  });

  const allEdgeRows = () => Object.values(EDGE_FIXTURES).flatMap(stored => chain(stored));

  it('no row of edges 1..9 has a negative payment, interest, amount due or credit, and creditBalance mirrors closing', () => {
    const rows = allEdgeRows();
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row: any) => {
      expect(row.minPaymentDue).toBeGreaterThanOrEqual(0);
      expect(row.interest).toBeGreaterThanOrEqual(0);
      expect(row.paidAmount).toBeGreaterThanOrEqual(0);
      expect(row.amountDue).toBeGreaterThanOrEqual(0);
      expect(row.minimumPreview.interest).toBeGreaterThanOrEqual(0);
      expect(row.creditBalance).toBeGreaterThanOrEqual(0);
      expect(row.creditBalance).toBe(round2(Math.max(0, -row.closingBalance)));
    });
  });

  it('every credit cycle closes at its own totalDue whatever paymentAction is stored', () => {
    const creditRows = allEdgeRows().filter((row: any) => row.totalDue < 0);
    expect(creditRows.map((row: any) => row.paymentAction)).toEqual(expect.arrayContaining([null, 'full', 'minimum']));
    creditRows.forEach((row: any) => expect(row.closingBalance).toBe(row.totalDue));
  });
});

describe('regression: data without cashback derives exactly as before', () => {
  const CARD_A = { id: 'cc_a', annualRate: 12, minPaymentPercent: 10 };
  const ROW1 = { cardId: 'cc_a', month: '2099-01', newSpend: 1000, carriedBalance: 0, totalDue: 1000, minPaymentDue: 100, paymentAction: null, amountDue: 1000, paidAmount: 0, interest: 0, closingBalance: 1000, minimumPreview: { remaining: 900, interest: 9, closingBalance: 909 }, stored: true, isImplicit: false };
  const ROW2 = { cardId: 'cc_a', month: '2099-02', newSpend: 500, carriedBalance: 1000, totalDue: 1500, minPaymentDue: 150, paymentAction: 'minimum', amountDue: 150, paidAmount: 150, interest: 13.5, closingBalance: 1363.5, minimumPreview: { remaining: 1350, interest: 13.5, closingBalance: 1363.5 }, stored: true, isImplicit: false };
  const ROW3 = { cardId: 'cc_a', month: '2099-03', newSpend: 0, carriedBalance: 1363.5, totalDue: 1363.5, minPaymentDue: 136.35, paymentAction: 'full', amountDue: 1363.5, paidAmount: 1363.5, interest: 0, closingBalance: 0, minimumPreview: { remaining: 1227.15, interest: 12.27, closingBalance: 1239.42 }, stored: true, isImplicit: false };
  const ROW2_IMPLICIT = { cardId: 'cc_a', month: '2099-02', newSpend: 0, carriedBalance: 1000, totalDue: 1000, minPaymentDue: 100, paymentAction: null, amountDue: 1000, paidAmount: 0, interest: 0, closingBalance: 1000, minimumPreview: { remaining: 900, interest: 9, closingBalance: 909 }, stored: false, isImplicit: true };
  const ROW3_AFTER_IMPLICIT = { cardId: 'cc_a', month: '2099-03', newSpend: 0, carriedBalance: 1000, totalDue: 1000, minPaymentDue: 100, paymentAction: 'full', amountDue: 1000, paidAmount: 1000, interest: 0, closingBalance: 0, minimumPreview: { remaining: 900, interest: 9, closingBalance: 909 }, stored: true, isImplicit: false };
  const NEW_FIELDS = { cashbackAmount: 0, creditBalance: 0 };

  it('the 3-month carry-forward chain keeps every pre-existing field and adds cashbackAmount 0 / creditBalance 0', () => {
    const rows = buildRevolvingCycles(CARD_A, [
      { cardId: 'cc_a', month: '2099-01', newSpend: 1000, paymentAction: null },
      { cardId: 'cc_a', month: '2099-02', newSpend: 500, paymentAction: 'minimum' },
      { cardId: 'cc_a', month: '2099-03', newSpend: 0, paymentAction: 'full' }
    ], { throughMonth: '2099-03' });
    expect(rows).toHaveLength(3);
    [ROW1, ROW2, ROW3].forEach((expected, index) => expect(rows[index]).toMatchObject({ ...expected, ...NEW_FIELDS }));
  });

  it('implicit rows keep every pre-existing field and add cashbackAmount 0 / creditBalance 0', () => {
    const rows = buildRevolvingCycles(CARD_A, [
      { cardId: 'cc_a', month: '2099-01', newSpend: 1000, paymentAction: null },
      { cardId: 'cc_a', month: '2099-03', newSpend: 0, paymentAction: 'full' }
    ], { throughMonth: '2099-03' });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ ...ROW1, ...NEW_FIELDS });
    expect(rows[1]).toMatchObject({ ...ROW2_IMPLICIT, ...NEW_FIELDS });
    expect(rows[2]).toMatchObject({ ...ROW3_AFTER_IMPLICIT, ...NEW_FIELDS });
  });

  it('validateRevolvingCycleInput still rejects a negative newSpend and never carries cashbackAmount', () => {
    const result = validateRevolvingCycleInput({ cardId: 'c', month: '2099-01', newSpend: -1 });
    expect(result.errors.newSpend).toBe('ยอดใช้จ่ายต้องเป็นตัวเลขไม่ติดลบ');
    expect(result.value).not.toHaveProperty('cashbackAmount');
    const withCashback = validateRevolvingCycleInput({ cardId: 'c', month: '2099-01', newSpend: 10, cashbackAmount: 5 });
    expect(Object.keys(withCashback.value)).toEqual(['cardId', 'month', 'newSpend']);
  });
});

describe('summary boundary: debt floored at 0, credit reported separately (BR-CC-031)', () => {
  const LIMITED_CARD = { ...CARD, creditLimit: 10000 };
  const DEBT_FIELDS = ['totalDue', 'minDue', 'due', 'outstanding', 'carryForward'];
  const withoutCycle = ({ cycle: _cycle, ...rest }: Record<string, any>) => rest;

  it('edge 14: a credit cycle reports every debt figure as 0 and the credit as credit', () => {
    const rows = chain(EDGE_FIXTURES.edge3);
    const summary = summariseRevolving(rows, { asOfMonth: '2099-01' });
    expect(withoutCycle(summary)).toEqual({ totalDue: 0, minDue: 0, due: 0, outstanding: 0, carryForward: 0, credit: 200, paymentAction: null });
    expect(summary.cycle).toBe(byMonth(rows, '2099-01'));
    expect(summary.cycle).toMatchObject({ totalDue: -200, closingBalance: -200, amountDue: 0 });
  });

  it('a stored full / minimum on a credit cycle still floors outstanding and keeps the credit', () => {
    ['edge5', 'edge6'].forEach(key => {
      const summary = summariseRevolving(chain(EDGE_FIXTURES[key], '2099-01'), { asOfMonth: '2099-01' });
      expect(withoutCycle(summary)).toEqual({ totalDue: 0, minDue: 0, due: 0, outstanding: 0, carryForward: 0, credit: 200, paymentAction: key === 'edge5' ? 'full' : 'minimum' });
    });
  });

  it('no summary figure is ever negative and credit always equals the row creditBalance (edges 1-9, every month)', () => {
    Object.values(EDGE_FIXTURES).forEach(fixture => {
      const rows = chain(fixture);
      rows.forEach((row: any) => {
        const summary = summariseRevolving(rows, { asOfMonth: row.month });
        DEBT_FIELDS.forEach(field => expect(summary[field]).toBeGreaterThanOrEqual(0));
        expect(summary.credit).toBeGreaterThanOrEqual(0);
        expect(summary.credit).toBe(row.creditBalance);
        if (summary.credit > 0) expect(summary.carryForward).toBe(0);
      });
    });
  });

  it('an empty chain and a missing month both return credit 0 with the existing zeros', () => {
    const EMPTY = { totalDue: 0, minDue: 0, due: 0, outstanding: 0, carryForward: 0, credit: 0, paymentAction: null, cycle: null };
    expect(summariseRevolving([], { asOfMonth: '2099-01' })).toEqual(EMPTY);
    expect(summariseRevolving(chain(EDGE_FIXTURES.edge3), { asOfMonth: '2098-12' })).toEqual(EMPTY);
  });

  it('edge 15: summariseCard surfaces revolvingCredit and never lets the credit raise availableCredit', () => {
    const card = summariseCard(LIMITED_CARD, [], EDGE_FIXTURES.edge3, { asOfMonth: '2099-01' });
    expect(card).toMatchObject({ revolvingCredit: 200, revolvingTotalDue: 0, revolvingDue: 0, revolvingOutstanding: 0, revolvingCarryForward: 0, remainingPayable: 0, remainingPrincipal: 0, availableCredit: 10000 });
  });

  it('edge 16: a credit never offsets installment debt', () => {
    const plan = { id: 'p_x', cardId: 'cc_x', status: 'ongoing', schedule: [{ no: 1, dueMonth: '2099-01', payment: 1000, principal: 1000, paid: false }] };
    const card = summariseCard(LIMITED_CARD, [plan], EDGE_FIXTURES.edge3, { asOfMonth: '2099-01' });
    expect(card).toMatchObject({ revolvingCredit: 200, installmentPayable: 1000, installmentPrincipal: 1000, remainingPayable: 1000, remainingPrincipal: 1000, availableCredit: 9000 });
  });

  it('availableCredit never exceeds creditLimit and remainingPayable is never negative (edges 3-9, every month)', () => {
    ['edge3', 'edge4', 'edge5', 'edge6', 'edge7', 'edge8', 'edge9'].forEach(key => {
      const fixture = EDGE_FIXTURES[key];
      chain(fixture).forEach((row: any) => {
        const card = summariseCard(LIMITED_CARD, [], fixture, { asOfMonth: row.month });
        expect(card.availableCredit).toBeLessThanOrEqual(10000);
        expect(card.remainingPayable).toBeGreaterThanOrEqual(0);
        expect(card.remainingPrincipal).toBeGreaterThanOrEqual(0);
        expect(card.revolvingCredit).toBe(row.creditBalance);
      });
    });
  });

  it('edge 17: summariseTotals keeps its exact 8 keys and does not net one card credit against another debt', () => {
    const cardA = { id: 'cc_a', annualRate: 12, minPaymentPercent: 10, creditLimit: 10000 };
    const cardB = { id: 'cc_b', annualRate: 12, minPaymentPercent: 10, creditLimit: 10000 };
    const cycles = [cycle('2099-01', { cardId: 'cc_a', newSpend: 300, cashbackAmount: 500, paymentAction: null }), cycle('2099-01', { cardId: 'cc_b', newSpend: 1000, paymentAction: null })];
    const cards = [cardA, cardB].map(card => summariseCard(card, [], cycles, { asOfMonth: '2099-01' }));
    expect(cards[0].revolvingCredit).toBe(200);
    expect(cards[1].revolvingCredit).toBe(0);
    const totals = summariseTotals(cards);
    expect(Object.keys(totals)).toEqual(['remainingPayable', 'remainingPrincipal', 'creditLimit', 'availableCredit', 'revolvingDue', 'revolvingOutstanding', 'cardCount', 'ongoingPlanCount']);
    expect(totals).toEqual({ remainingPayable: 1000, remainingPrincipal: 1000, creditLimit: 20000, availableCredit: 19000, revolvingDue: 1000, revolvingOutstanding: 1000, cardCount: 2, ongoingPlanCount: 0 });
  });

  describe('a positive chain (no cashback) summarises exactly as before, plus credit 0', () => {
    const legacySummary = (cycleRow: any) => ({
      totalDue: cycleRow.totalDue,
      minDue: cycleRow.minPaymentDue,
      due: cycleRow.paymentAction === null ? cycleRow.totalDue : 0,
      outstanding: cycleRow.paymentAction === null ? cycleRow.totalDue : cycleRow.closingBalance,
      carryForward: cycleRow.closingBalance,
      paymentAction: cycleRow.paymentAction
    });
    const POSITIVE_CHAINS: Record<string, StoredCycle[]> = {
      undecidedThenMinimumThenFull: [cycle('2099-01', { newSpend: 1000, paymentAction: null }), cycle('2099-02', { newSpend: 500, paymentAction: 'minimum' }), cycle('2099-03', { newSpend: 0, paymentAction: 'full' })],
      minimumWithImplicitMonth: [cycle('2099-01', { newSpend: 1000, paymentAction: 'minimum' }), cycle('2099-03', { newSpend: 250, paymentAction: null })],
      zeroSpendFull: [cycle('2099-01', { newSpend: 0, paymentAction: 'full' })]
    };
    it.each(Object.keys(POSITIVE_CHAINS))('%s: every month matches the legacy figures', (key: string) => {
      const rows = chain(POSITIVE_CHAINS[key]);
      expect(rows.length).toBeGreaterThan(0);
      rows.forEach((row: any) => {
        const summary = summariseRevolving(rows, { asOfMonth: row.month });
        expect(withoutCycle(summary)).toEqual({ ...legacySummary(row), credit: 0 });
        expect(summary.cycle).toBe(row);
      });
    });
    it('literal values for the minimum-then-implicit chain', () => {
      const rows = chain(POSITIVE_CHAINS.minimumWithImplicitMonth);
      expect(withoutCycle(summariseRevolving(rows, { asOfMonth: '2099-01' }))).toEqual({ totalDue: 1000, minDue: 100, due: 0, outstanding: 909, carryForward: 909, credit: 0, paymentAction: 'minimum' });
      expect(withoutCycle(summariseRevolving(rows, { asOfMonth: '2099-02' }))).toEqual({ totalDue: 909, minDue: 90.9, due: 909, outstanding: 909, carryForward: 909, credit: 0, paymentAction: null });
      expect(withoutCycle(summariseRevolving(rows, { asOfMonth: '2099-03' }))).toEqual({ totalDue: 1159, minDue: 115.9, due: 1159, outstanding: 1159, carryForward: 1159, credit: 0, paymentAction: null });
    });
    it('summariseCard on a positive chain reports revolvingCredit 0', () => {
      const card = summariseCard(LIMITED_CARD, [], POSITIVE_CHAINS.undecidedThenMinimumThenFull, { asOfMonth: '2099-02' });
      expect(card.revolvingCredit).toBe(0);
      expect(card).toMatchObject({ revolvingDue: 0, revolvingOutstanding: 1363.5, availableCredit: 8636.5 });
    });
  });
});