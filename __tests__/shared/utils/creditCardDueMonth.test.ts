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
