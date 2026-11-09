import { getAccountBreakdown, getAccountSummary } from '../../../src/shared/utils/commonUtils';
import { formatCurrency, parseToNumber } from '../../../src/shared/utils/frontend/numberUtils';

const ACCOUNTS = ['กรุงศรี', 'ttb', 'กสิกร', 'UOB'];

const kbankShopeeBreakdown = {
  installments: [
    { key: 'cci_1', name: 'สินค้า A งวด 1/4', amount: 1000, paid: false },
    { key: 'cci_2', name: 'สินค้า B งวด 2/4', amount: 1500, paid: true },
    { key: 'cci_3', name: 'สินค้า C งวด 3/6', amount: 1000, paid: false },
    { key: 'cci_4', name: 'สินค้า D งวด 1/3', amount: 1000, paid: false }
  ],
  installmentTotal: 4500,
  revolving: { newSpend: 1965.34, carriedBalance: 0, cashbackAmount: 0, totalDue: 1965.34, minPaymentDue: 0, amountDue: 1965.34, paymentAction: null }
};

const november = () => ({
  month: '2026-11',
  bankAccounts: ACCOUNTS,
  beIn: { name: 'Be in', account: 'กสิกร', actual: '349.00', paid: false, dueDay: 12 },
  wed: { name: 'คืนพุธ Membership', account: 'กสิกร', actual: '80.00', paid: false },
  netflix: { name: 'Netflix', account: 'กสิกร', actual: '617.00', paid: false, dueDay: 5 },
  youtube: { name: 'YouTube', account: 'กสิกร', actual: '519.00', paid: false },
  rubsarb: { name: 'Rubsarb Membership', account: 'กสิกร', actual: '200.00', paid: false },
  ccr_kbankShopee: {
    name: 'ยอดบัตร K-bank Shopee', account: 'กสิกร', actual: '6,465.34', paid: false,
    cycleMonth: '2026-11', resolvedDueDate: '2026-11-20', breakdown: kbankShopeeBreakdown
  },
  ccr_shopeepay: {
    name: 'ยอดบัตร Shopee pay', account: 'กสิกร', actual: '4,475.66', paid: true,
    cycleMonth: '2026-10', resolvedDueDate: '2026-11-10', breakdown: { installments: [], installmentTotal: 0, revolving: kbankShopeeBreakdown.revolving }
  }
});

describe('getAccountBreakdown', () => {
  test('AC-4 worked example with the client parser', () => {
    const result = getAccountBreakdown(november(), ACCOUNTS, { parseAmount: parseToNumber });
    expect(formatCurrency(result['กสิกร'].total)).toBe('8,230.34');
    expect(result['กสิกร'].items).toHaveLength(6);
    expect(result['กสิกร'].paidItems).toHaveLength(1);
    expect(result['กสิกร'].paidItems[0].name).toBe('ยอดบัตร Shopee pay');
    expect(result['กสิกร'].items.map(i => i.key)).toEqual(['beIn', 'wed', 'netflix', 'youtube', 'rubsarb', 'ccr_kbankShopee']);
    expect(result['กรุงศรี']).toEqual({ items: [], paidItems: [], total: 0 });
  });

  test('passes breakdown, cycleMonth, resolvedDueDate and dueDay through by reference', () => {
    const data = november();
    const result = getAccountBreakdown(data, ACCOUNTS, { parseAmount: parseToNumber });
    const card = result['กสิกร'].items.find(i => i.key === 'ccr_kbankShopee')!;
    expect(card.breakdown).toBe(data.ccr_kbankShopee.breakdown);
    expect(card.cycleMonth).toBe('2026-11');
    expect(card.resolvedDueDate).toBe('2026-11-20');
    const paid = result['กสิกร'].paidItems[0];
    expect(paid.resolvedDueDate).toBe('2026-11-10');
    expect(result['กสิกร'].items.find(i => i.key === 'netflix')!.dueDay).toBe(5);
    expect(result['กสิกร'].items.find(i => i.key === 'wed')!.dueDay).toBeUndefined();
  });

  test('default (server) parser keeps legacy parse: "1,500" -> 1; client parser strips commas', () => {
    const data = { a: { account: 'ttb', actual: '1,500', paid: false } };
    expect(getAccountBreakdown(data, ['ttb']).ttb.total).toBe(1);
    expect(getAccountBreakdown(data, ['ttb'], { parseAmount: parseToNumber }).ttb.total).toBe(1500);
  });

  test('item name is trimmed with key fallback', () => {
    const result = getAccountBreakdown({
      a: { name: '  ชื่อ  ', account: 'ttb', actual: 1 },
      b: { account: 'ttb', actual: 2 }
    }, ['ttb']);
    expect(result.ttb.items.map(i => i.name)).toEqual(['ชื่อ', 'b']);
  });

  test('AC-16 paid variants', () => {
    const data = {
      t: { account: 'ttb', actual: 1, paid: true },
      s: { account: 'ttb', actual: 2, paid: 'true' },
      f: { account: 'ttb', actual: 3, paid: false },
      sf: { account: 'ttb', actual: 4, paid: 'false' },
      u: { account: 'ttb', actual: 5 },
      z: { account: 'ttb', actual: 6, paid: 0 },
      y: { account: 'ttb', actual: 7, paid: 'yes' }
    };
    const result = getAccountBreakdown(data, ['ttb']);
    expect(result.ttb.paidItems.map(i => i.key)).toEqual(['t', 's']);
    expect(result.ttb.items.map(i => i.key)).toEqual(['f', 'sf', 'u', 'z', 'y']);
    expect(result.ttb.total).toBe(3 + 4 + 5 + 6 + 7);
  });

  test('AC-17 legacy keys, fallback bucket and trimmed accounts', () => {
    const result = getAccountBreakdown({
      netflix: { actual: 1 },
      house: { actual: 2 },
      credit_uob: { actual: 3 },
      mystery: { actual: 4 },
      x: { account: '  ZZZ  ', actual: 5 }
    }, ACCOUNTS);
    expect(result['กสิกร'].items.map(i => i.key)).toEqual(['netflix']);
    expect(result.ttb.items.map(i => i.key)).toEqual(['house']);
    expect(result.UOB.items.map(i => i.key)).toEqual(['credit_uob']);
    expect(result['ไม่ระบุบัญชี'].items.map(i => i.key)).toEqual(['mystery']);
    expect(result.ZZZ.total).toBe(5);
    expect(result.ZZZ.items[0].account).toBe('ZZZ');
  });

  test('AC-18 returns a bucket for an account not in the list', () => {
    const result = getAccountBreakdown({ x: { account: 'Other', actual: 9 } }, ['ttb']);
    expect(Object.keys(result)).toEqual(['ttb', 'Other']);
    expect(result.Other.total).toBe(9);
  });

  test('skips the 8 metadata keys and non-object values; "id" is NOT skipped (stored-summary parity)', () => {
    const result = getAccountBreakdown({
      month: { account: 'ttb', actual: 1 },
      _id: { account: 'ttb', actual: 1 },
      userId: { account: 'ttb', actual: 1 },
      periodKey: { account: 'ttb', actual: 1 },
      accountSummary: { account: 'ttb', actual: 1 },
      totalActualPaid: { account: 'ttb', actual: 1 },
      __removeKeys: { account: 'ttb', actual: 1 },
      bankAccounts: { account: 'ttb', actual: 1 },
      id: { account: 'ttb', actual: 10 },
      arr: [1], nul: null, str: 'x', num: 3
    }, ['ttb']);
    expect(result.ttb.items.map(i => i.key)).toEqual(['id']);
    expect(result.ttb.total).toBe(10);
  });

  test('empty/undefined input', () => {
    expect(getAccountBreakdown(undefined, ['ttb'])).toEqual({ ttb: { items: [], paidItems: [], total: 0 } });
    expect(Object.keys(getAccountBreakdown(undefined))).toEqual(ACCOUNTS);
    expect(getAccountBreakdown({}, undefined as never)).toBeDefined();
  });
});

describe('AC-2 getAccountSummary is the .total projection', () => {
  let seed = 12345;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)];
  const amounts: unknown[] = ['1,234.56', '0.10', '0.20', 12.5, '', null, undefined, 'abc', '1,500', 0, -40.25, true, [7], '9,999.99'];
  const paids: unknown[] = [true, 'true', false, 'false', undefined, 0, 'yes'];
  const accts: unknown[] = ['กสิกร', 'ttb', '  UOB  ', 'Unlisted', '', undefined, 42];
  const keys = ['netflix', 'house', 'credit_uob', 'custom_a', 'custom_b', 'ccr_x', 'shopee', 'misc'];

  const buildData = () => {
    const data: Record<string, unknown> = {};
    keys.forEach(key => {
      if (rand() < 0.2) return;
      data[key] = { name: key, actual: pick(amounts), paid: pick(paids), account: pick(accts) };
    });
    return data;
  };

  test.each([
    ['default parser', undefined],
    ['client parser', { parseAmount: parseToNumber }]
  ])('total equals summary exactly for random inputs (%s)', (_label, options) => {
    for (let run = 0; run < 200; run += 1) {
      const data = buildData();
      const breakdown = getAccountBreakdown(data, ACCOUNTS, options);
      const summary = getAccountSummary(data, ACCOUNTS, options);
      // summary = HEAD keys (seeded or >=1 unpaid item) in breakdown order; paid-only buckets trail the breakdown
      const summaryKeys = Object.keys(summary);
      expect(Object.keys(breakdown).slice(0, summaryKeys.length)).toEqual(summaryKeys);
      Object.keys(breakdown).slice(summaryKeys.length).forEach(account => {
        expect(breakdown[account].items).toEqual([]);
        expect(breakdown[account].total).toBe(0);
      });
      summaryKeys.forEach(account => {
        // Object.is/toEqual so NaN (legacy parse of `true`) compares equal to itself
        expect(Object.is(summary[account], breakdown[account].total)).toBe(true);
        const sum = breakdown[account].items.reduce((s, i) => s + i.amount, 0);
        if (Number.isFinite(sum)) {
          expect(formatCurrency(sum)).toBe(formatCurrency(breakdown[account].total));
        } else {
          expect(Number.isNaN(breakdown[account].total)).toBe(Number.isNaN(sum));
        }
      });
    }
  });

  test('NaN propagates identically (toEqual treats NaN as equal)', () => {
    const data = { a: { account: 'ttb', actual: true, paid: false } };
    expect(getAccountSummary(data, ['ttb'])).toEqual({ ttb: NaN });
    expect(getAccountBreakdown(data, ['ttb']).ttb.total).toEqual(NaN);
  });
});

describe('F-1 paid-only buckets trail the breakdown and never reach getAccountSummary', () => {
  test('paid-only account keeps paidItems in the breakdown but is absent from the summary', () => {
    const data = {
      p: { account: 'PaidOnly', actual: '9', paid: true },
      q: { account: 'Late', actual: '1' },
      r: { account: 'PaidOnly', actual: '4', paid: true }
    };
    expect(Object.keys(getAccountBreakdown(data, ['ttb']))).toEqual(['ttb', 'Late', 'PaidOnly']);
    expect(getAccountBreakdown(data, ['ttb']).PaidOnly.paidItems.map(i => i.key)).toEqual(['p', 'r']);
    expect(JSON.stringify(getAccountSummary(data, ['ttb']))).toBe('{"ttb":0,"Late":1}');
  });

  test('a paid row seen before the first unpaid row of the same account keeps its paidItems', () => {
    const data = { p: { account: 'B', actual: '2', paid: true }, u: { account: 'B', actual: '3' } };
    const result = getAccountBreakdown(data, []);
    expect(result.B.paidItems.map(i => i.key)).toEqual(['p']);
    expect(result.B.items.map(i => i.key)).toEqual(['u']);
    expect(result.B.total).toBe(3);
  });
});
