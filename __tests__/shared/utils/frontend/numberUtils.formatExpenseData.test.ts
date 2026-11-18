import { formatExpenseData, DEFAULT_EXPENSE_ITEMS } from '../../../../src/shared/utils/frontend/numberUtils';

// savings-loan-withdrawal S3 — spec §4.11, AC-SLW-23, C-S3-10, C-S3-11
const MONTH = '2026-11';
const DEFAULT_KEYS = DEFAULT_EXPENSE_ITEMS.map(item => item.key);

const SLR_KEY = 'slr_0123456789abcdef01234567';
const SLR_KEY_2 = 'slr_abcdefabcdefabcdefabcdef';
const CCR_KEY = 'ccr_000000000001';
const CCI_KEY = 'cci_000000000001_01';

const repaymentRow = (actual: number) => ({
  name: 'ชำระคืนเงินยืม · เป้าหมาย', actual, account: 'บัญชี A', paid: true, dueDay: 'EOM'
});
const cardRow = { name: 'บัตร A', actual: 1300, account: 'บัญชี A', paid: false, dueDay: 20 };

describe('formatExpenseData — slr_ repayment rows (spec §4.11)', () => {
  it('AC-SLW-23: a repayment-only month still renders the 5 default rows plus the repayment rows', () => {
    const formatted = formatExpenseData(
      { [SLR_KEY]: repaymentRow(500), [SLR_KEY_2]: repaymentRow(250) },
      MONTH
    );

    expect(Object.keys(formatted.values).sort()).toEqual([...DEFAULT_KEYS, SLR_KEY, SLR_KEY_2].sort());
    // repayment rows are still shown with their stored values
    expect(formatted.values[SLR_KEY]).toMatchObject({ actual: '500.00', paid: true, account: 'บัญชี A' });
    // the returned persistedKeys never contains a strict slr_ key
    expect(formatted.persistedKeys).toEqual([]);
  });

  it('a month with ordinary rows plus repayment rows renders only the stored rows (no defaults)', () => {
    const formatted = formatExpenseData(
      { custom_1: { name: 'ค่ากาแฟ', actual: 80, account: 'บัญชี A', paid: false, dueDay: 5 }, [SLR_KEY]: repaymentRow(500) },
      MONTH
    );

    expect(Object.keys(formatted.values).sort()).toEqual(['custom_1', SLR_KEY].sort());
    expect(formatted.persistedKeys).toEqual(['custom_1']);
  });

  it('C-S3-11: persistedKeys excludes slr_ but deliberately still includes cci_/ccr_ (pinned divergence)', () => {
    const formatted = formatExpenseData(
      { [SLR_KEY]: repaymentRow(500), [CCR_KEY]: cardRow, [CCI_KEY]: cardRow },
      MONTH
    );

    expect(formatted.persistedKeys).not.toContain(SLR_KEY);
    expect(formatted.persistedKeys).toEqual(expect.arrayContaining([CCR_KEY, CCI_KEY]));
    expect(formatted.persistedKeys).toHaveLength(2);
    // card + repayment rows alone are non-ordinary, so the defaults still render
    expect(Object.keys(formatted.values).sort()).toEqual([...DEFAULT_KEYS, SLR_KEY, CCR_KEY, CCI_KEY].sort());
  });

  it('C-S3-10: a loose-prefix key that fails the strict predicate is an ordinary row', () => {
    const looseRow = { name: 'อื่นๆ', actual: 99, account: 'บัญชี A', paid: false, dueDay: 3 };
    const formatted = formatExpenseData({ slr_foo: looseRow }, MONTH);

    // stays in persistedKeys so Save All can still delete it
    expect(formatted.persistedKeys).toEqual(['slr_foo']);
    // counts as an ordinary persisted row, so the defaults are NOT added
    expect(Object.keys(formatted.values)).toEqual(['slr_foo']);
  });

  it('uppercase hex / wrong length slr_ keys are also ordinary rows', () => {
    const upper = 'slr_0123456789ABCDEF01234567';
    const short = 'slr_0123456789abcdef0123456';
    const row = { name: 'x', actual: 1, account: 'บัญชี A', paid: false, dueDay: 1 };
    const formatted = formatExpenseData({ [upper]: row, [short]: row }, MONTH);

    expect(formatted.persistedKeys.sort()).toEqual([upper, short].sort());
    expect(Object.keys(formatted.values).sort()).toEqual([upper, short].sort());
  });
});
