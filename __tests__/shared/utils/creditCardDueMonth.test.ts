/** @jest-environment node */
// DP-AC-3 (edge cases P1–P10 + the three getCardDueMonth invariants).
import {
  getCardDueMonth,
  getPayableCycleMonth,
  resolveCardDueDate
} from '../../../src/shared/utils/creditCardBasics';
import * as barrel from '../../../src/shared/utils/creditCardUtils';

type Day = number | string | null | undefined;

// [label, statementDay, dueDay, tableMonth, expectedCycle, expectedResolvedDueDate]
const cases: Array<[string, Day, Day, string, string, string]> = [
  ['P1 Shopee EOM/10', 'EOM', 10, '2026-11', '2026-10', '2026-11-10'],
  ['P2 EOM/10 previous table', 'EOM', 10, '2026-10', '2026-09', '2026-10-10'],
  ['P3 5/25 same month', 5, 25, '2026-10', '2026-10', '2026-10-25'],
  ['P4 15/15 equal → offset 1', 15, 15, '2026-11', '2026-10', '2026-11-15'],
  ['P5 EOM/EOM', 'EOM', 'EOM', '2026-02', '2026-01', '2026-02-28'],
  ['P6 EOM/10 year rollover', 'EOM', 10, '2027-01', '2026-12', '2027-01-10'],
  ['P7 31(numeric)/30', 31, 30, '2026-02', '2026-01', '2026-02-28'],
  ['P8 10/EOM offset 0', 10, 'EOM', '2026-02', '2026-02', '2026-02-28'],
  ['P9 missing statementDay / 10', undefined, 10, '2026-11', '2026-10', '2026-11-10'],
  ['P10 20/abc junk → offset 0', 20, 'abc', '2026-10', '2026-10', '2026-10-31']
];

describe('getCardDueMonth — placement edge cases P1–P10 (DP-AC-3)', () => {
  test.each(cases)('%s', (_label, statementDay, dueDay, tableMonth, cycle, resolved) => {
    const card = { statementDay, dueDay };
    expect(getPayableCycleMonth(card, tableMonth)).toBe(cycle);
    expect(getCardDueMonth(card, cycle)).toBe(tableMonth);
    expect(resolveCardDueDate(card, cycle)).toBe(resolved);
  });

  test.each(cases)('%s — invariants hold', (_label, statementDay, dueDay, tableMonth, cycle) => {
    const card = { statementDay, dueDay };
    expect(getCardDueMonth(card, getPayableCycleMonth(card, tableMonth))).toBe(tableMonth);
    expect(getPayableCycleMonth(card, getCardDueMonth(card, cycle))).toBe(cycle);
    expect(resolveCardDueDate(card, cycle)!.slice(0, 7)).toBe(getCardDueMonth(card, cycle));
  });
});

describe('getCardDueMonth — invalid input', () => {
  // same MONTH_KEY_RE gate as getPayableCycleMonth (shape only, /^\d{4}-\d{2}$/)
  test.each(['', '2026-1', 'abc', '2026-10-01'])('returns %p unchanged', (value) => {
    expect(getCardDueMonth({ statementDay: 'EOM', dueDay: 10 }, value)).toBe(value);
  });
});

describe('getCardDueMonth — barrel re-export', () => {
  test('creditCardUtils re-exports the same function', () => {
    expect(barrel.getCardDueMonth).toBe(getCardDueMonth);
  });
});

// AC-LN-14 / BR-CC-037 — loans have no billing cycle: offset is always 0 whatever the stored days say.
// Credit-card cases above stay untouched; the control below re-asserts the same days on a card.
describe('loan cards — due-month offset is always 0 (AC-LN-14)', () => {
  const loanDays: Array<[Day, Day]> = [
    ['EOM', 5],
    ['EOM', 'EOM'],
    [15, 15],
    [31, 30],
    [20, 10],
    [5, 25],
    [undefined, 10]
  ];

  test.each(['personal_loan', 'home_loan'])('%s: due month equals the schedule month for every day pair', (cardType) => {
    loanDays.forEach(([statementDay, dueDay]) => {
      const loan = { statementDay, dueDay, cardType };
      expect(getCardDueMonth(loan, '2026-12')).toBe('2026-12');
      expect(getPayableCycleMonth(loan, '2026-12')).toBe('2026-12');
      expect(resolveCardDueDate(loan, '2026-12')!.slice(0, 7)).toBe('2026-12');
    });
  });

  test('loan dueDay 5, statementDay EOM → 2026-12-05; same days on a credit card still → 2027-01-05', () => {
    const loan = { statementDay: 'EOM', dueDay: 5, cardType: 'home_loan' };
    expect(resolveCardDueDate(loan, '2026-12')).toBe('2026-12-05');
    expect(getCardDueMonth(loan, '2026-12')).toBe('2026-12');

    const card = { statementDay: 'EOM', dueDay: 5 };
    expect(resolveCardDueDate(card, '2026-12')).toBe('2027-01-05');
    expect(resolveCardDueDate({ ...card, cardType: 'credit_card' }, '2026-12')).toBe('2027-01-05');
  });

  test('loan dueDay 31 clamps in a 30-day month; EOM resolves to the last day (E-10)', () => {
    expect(resolveCardDueDate({ statementDay: 'EOM', dueDay: 31, cardType: 'personal_loan' }, '2026-11')).toBe('2026-11-30');
    expect(resolveCardDueDate({ statementDay: 'EOM', dueDay: 'EOM', cardType: 'personal_loan' }, '2026-02')).toBe('2026-02-28');
  });

  test('an unknown cardType is treated as a credit card (offset rule unchanged)', () => {
    const card = { statementDay: 'EOM', dueDay: 5, cardType: 'car_loan' };
    expect(resolveCardDueDate(card, '2026-12')).toBe('2027-01-05');
  });
});
