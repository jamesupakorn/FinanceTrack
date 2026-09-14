/**
 * Regression guard for the TD-H02 TypeScript migration (slice 1).
 *
 * The conversion of commonUtils/expenseUtils/monthUtils to `.ts` was meant to be annotation-only,
 * but three spots required rewriting a real runtime expression to satisfy `strict` mode:
 *   1. commonUtils: `parseFloat(item.actual || 0)`      → `parseFloat(String(item.actual || 0))`
 *   2. expenseUtils: `parseFloat(v)`                    → `parseFloat(String(v))`
 *   3. monthUtils:   `data.months && ...`               → `'months' in data && data.months && ...`
 * These modules had no direct unit coverage before the migration, so this file locks in the
 * observable behavior of those exact expressions against future drift.
 */

import {
  getAccountSummary,
  getExpenseTotals,
  isPaidFlag,
  extractRemovalKeys,
  removeSummaryFields,
} from '../../../src/shared/utils/commonUtils';
import { formatExpenseForSave, calculateExpenseTotal } from '../../../src/shared/utils/expenseUtils';
import { getMonthKeys, getMeaningfulSalaryMonths, collectMonthKeys } from '../../../src/shared/utils/frontend/monthUtils';

const parseToNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = parseFloat(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

describe('commonUtils.getAccountSummary — String() coercion of `actual`', () => {
  test('sums unpaid items per account and ignores metadata keys', () => {
    const summary = getAccountSummary({
      month: '2025-01',
      _id: 'doc',
      totalActualPaid: 999,
      accountSummary: { stale: 1 },
      bankAccounts: ['ttb'],
      house: { account: 'ttb', actual: '1,500', paid: false },
      netflix: { account: 'กสิกร', actual: 300, paid: false },
    }, ['ttb', 'กสิกร']);
    // '1,500' → parseFloat stops at the comma, matching the pre-migration behavior exactly
    expect(summary).toEqual({ ttb: 1, 'กสิกร': 300 });
  });

  test('paid items are excluded (both boolean true and string "true")', () => {
    const data = {
      a: { account: 'ttb', actual: 100, paid: true },
      b: { account: 'ttb', actual: 50, paid: 'true' },
      c: { account: 'ttb', actual: 25, paid: false },
    };
    expect(getAccountSummary(data, ['ttb'])).toEqual({ ttb: 25 });
  });

  test('non-numeric / nullish / structural `actual` values coerce the same as before', () => {
    const data = {
      nullActual: { account: 'ttb', actual: null, paid: false },
      undefActual: { account: 'ttb', paid: false },
      emptyActual: { account: 'ttb', actual: '', paid: false },
      boolActual: { account: 'ttb', actual: true, paid: false },
      arrActual: { account: 'ttb', actual: [7], paid: false },
      objActual: { account: 'ttb', actual: { x: 1 }, paid: false },
    };
    // null/undefined/''/false → `|| 0` → 0 ; true → NaN ; [7] → 7 ; {} → NaN
    // NaN propagates through the running total, exactly as the .js original did.
    expect(Number.isNaN(getAccountSummary(data, ['ttb']).ttb)).toBe(true);

    const { objActual, boolActual, ...numericOnly } = data;
    expect(getAccountSummary(numericOnly, ['ttb'])).toEqual({ ttb: 7 });
  });

  test('unlisted accounts are added on demand; account names are trimmed', () => {
    expect(getAccountSummary({ x: { account: '  ZZZ  ', actual: 5, paid: false } }, [])).toEqual({ ZZZ: 5 });
  });

  test('non-object entries and empty/absent input are skipped safely', () => {
    expect(getAccountSummary({ a: null, b: [1], c: 'str', d: 42 }, ['ttb'])).toEqual({ ttb: 0 });
    expect(getAccountSummary(undefined)).toEqual({
      'กรุงศรี': 0, ttb: 0, 'กสิกร': 0, UOB: 0,
    });
  });
});

describe('commonUtils.getExpenseTotals — String() coercion of `actual`', () => {
  test('rounds to 2dp and treats nullish `actual` as 0', () => {
    expect(getExpenseTotals({
      a: { actual: '10.555' },
      b: { actual: 5 },
      c: { actual: null },
      d: { actual: '' },
      e: 'not-an-object',
    })).toEqual({ totalActualPaid: 15.56 });
  });

  test('undefined input returns zero', () => {
    expect(getExpenseTotals(undefined)).toEqual({ totalActualPaid: 0 });
  });
});

describe('commonUtils — untouched helpers still behave', () => {
  test('isPaidFlag only accepts true / "true"', () => {
    expect([true, 'true'].map(isPaidFlag)).toEqual([true, true]);
    expect([false, 'false', 1, '1', null, undefined, 'TRUE'].map(isPaidFlag)).toEqual(
      [false, false, false, false, false, false, false]
    );
  });

  test('extractRemovalKeys filters to non-empty strings', () => {
    expect(extractRemovalKeys({ __removeKeys: ['a', '', 1, null, 'b'] })).toEqual(['a', 'b']);
    expect(extractRemovalKeys({ __removeKeys: 'nope' })).toEqual([]);
    expect(extractRemovalKeys()).toEqual([]);
  });

  test('removeSummaryFields strips metadata without mutating the input', () => {
    const input = { keep: 1, month: 'x', _id: 'y', totalActualPaid: 2, accountSummary: {}, __removeKeys: [] };
    expect(removeSummaryFields(input)).toEqual({ keep: 1 });
    expect(input.month).toBe('x');
  });
});

describe('expenseUtils.formatExpenseForSave — normalization contract', () => {
  test('trims name/account, booleanizes paid, clamps dueDay, drops legacy dueDate', () => {
    const result = formatExpenseForSave({
      house: { name: ' บ้าน ', account: ' ttb ', actual: '1,200', paid: 'true', dueDay: '15', dueDate: '2025-01-15' },
    }, parseToNumber);
    expect(result.house).toEqual({ name: 'บ้าน', account: 'ttb', actual: 1200, paid: true, dueDay: 15 });
    expect('dueDate' in result.house).toBe(false);
  });

  test('EOM is preserved case-insensitively and whitespace-tolerantly', () => {
    const result = formatExpenseForSave({
      a: { name: 'a', account: 'x', actual: 1, paid: false, dueDay: 'eom' },
      b: { name: 'b', account: 'x', actual: 1, paid: false, dueDay: '  EOM  ' },
    }, parseToNumber);
    expect(result.a.dueDay).toBe('EOM');
    expect(result.b.dueDay).toBe('EOM');
  });

  test('numeric dueDay is clamped into 1-31; unparseable dueDay becomes an empty string', () => {
    const result = formatExpenseForSave({
      tooBig: { name: 'a', account: 'x', actual: 1, paid: false, dueDay: '99' },
      zero: { name: 'a', account: 'x', actual: 1, paid: false, dueDay: 0 },
      trailing: { name: 'a', account: 'x', actual: 1, paid: false, dueDay: '31abc' },
      blank: { name: 'a', account: 'x', actual: 1, paid: false, dueDay: '' },
      nullish: { name: 'a', account: 'x', actual: 1, paid: false, dueDay: null },
      words: { name: 'a', account: 'x', actual: 1, paid: false, dueDay: 'abc' },
    }, parseToNumber);
    // Clamping (not rejection) is the documented pre-migration behavior — see the Math.min/max
    // in formatExpenseForSave. Only a NaN parse yields ''.
    expect(['tooBig', 'zero', 'trailing', 'blank', 'nullish', 'words'].map(k => result[k].dueDay))
      .toEqual([31, 1, 31, '', '', '']);
  });

  test('empty custom_* rows are skipped, filled ones are kept', () => {
    const result = formatExpenseForSave({
      custom_empty: { name: '   ', account: '', actual: 0, paid: false, dueDay: '' },
      custom_filled: { name: 'ของใหม่', account: 'ttb', actual: '10', paid: false, dueDay: 2 },
    }, parseToNumber);
    expect(Object.keys(result)).toEqual(['custom_filled']);
  });
});

describe('expenseUtils.calculateExpenseTotal — String() coercion of parseToNumber output', () => {
  test('sums the requested field and tolerates missing/undefined rows', () => {
    const data = {
      a: { actual: '1,000' },
      b: { actual: 250 },
      c: undefined,
      d: { plan: 5 },
    };
    expect(calculateExpenseTotal(data, 'actual', parseToNumber)).toBe(1250);
    expect(calculateExpenseTotal(data, 'plan', parseToNumber)).toBe(5);
    expect(calculateExpenseTotal(data, 'missing', parseToNumber)).toBe(0);
    expect(calculateExpenseTotal({}, 'actual', parseToNumber)).toBe(0);
  });
});

describe("monthUtils.getMonthKeys — `'months' in data` narrowing", () => {
  test('reads from .months when present, otherwise treats the object as the map itself', () => {
    expect(getMonthKeys({ months: { '2025-01': {}, bad: {}, '2025-13': {} } })).toEqual(['2025-01', '2025-13']);
    expect(getMonthKeys({ '2024-12': {}, nope: {} })).toEqual(['2024-12']);
  });

  test('falls back to the object itself when `months` is present but not a usable object', () => {
    expect(getMonthKeys({ months: null, '2025-05': {} })).toEqual(['2025-05']);
    expect(getMonthKeys({ months: 'nope', '2025-06': {} })).toEqual(['2025-06']);
  });

  test('non-object and nullish inputs return an empty list rather than throwing', () => {
    [undefined, null, 'string', 42].forEach(input => expect(getMonthKeys(input)).toEqual([]));
  });
});

describe('monthUtils.getMeaningfulSalaryMonths / collectMonthKeys', () => {
  const salary = {
    months: {
      '2025-01': { note: ' hi ', summary: {}, income: {}, deduct: {} },
      '2025-02': { summary: { total_income: 5 } },
      '2025-03': { income: { base: 0 }, deduct: { tax: 3 } },
      '2025-04': { summary: { net_income: 0 }, income: {}, deduct: {} },
      '2025-05': null,
      'bad-key': { note: 'x' },
    },
  };

  test('keeps months with a note, a positive summary, or positive income/deduct values', () => {
    expect(getMeaningfulSalaryMonths(salary).sort()).toEqual(['2025-01', '2025-02', '2025-03']);
  });

  test('returns empty for missing/invalid months containers', () => {
    [undefined, null, {}, { months: null }, { months: 'x' }].forEach(input =>
      expect(getMeaningfulSalaryMonths(input)).toEqual([]));
  });

  test('collectMonthKeys unions all sources and sorts descending', () => {
    expect(collectMonthKeys({
      expense: { months: { '2025-01': {} } },
      income: { '2025-07': {} },
      salary,
      savings: null,
      investment: undefined,
    })).toEqual(['2025-07', '2025-03', '2025-02', '2025-01']);
  });

  test('collectMonthKeys with no arguments returns an empty list', () => {
    expect(collectMonthKeys()).toEqual([]);
  });
});
