import { getMeaningfulMonthKeys } from '../../../../src/shared/utils/frontend/monthUtils';

describe('getMeaningfulMonthKeys', () => {
  it('treats empty {} / [] / zero-value / blank-string docs as not meaningful', () => {
    const keys = getMeaningfulMonthKeys({
      expense: { months: { '2027-01': {}, '2027-02': { rent: { value: 0, paid: false } }, '2027-03': { totalActualPaid: 0, accountSummary: { bank: { total: 5 } } } } },
      income: { months: { '2027-04': { month: '2027-04', รวม: 0 }, '2027-05': { bonus: '' } } },
      salary: { months: { '2027-06': { income: {}, deduct: {}, note: '  ', overtime: [], overtimeLegacy: [], saved_at: '2026-10-29T00:00:00.000Z', summary: { total_income: 0, total_deduct: 0, net_income: 0 } } } },
      savings: { months: { '2027-07': { total_savings: 0, savings_list: [], totalSavings: 0, รวมเงินเก็บ: 0 } } },
      investment: { '2027-08': [] }
    });
    expect(Array.from(keys)).toEqual([]);
  });

  it('detects real data in each collection shape', () => {
    const keys = getMeaningfulMonthKeys({
      expense: { months: { '2027-01': { rent: { value: 8000, paid: false } } } },
      income: { months: { '2027-02': { month: '2027-02', salary: 30000, รวม: 30000 } } },
      salary: { months: { '2027-03': { income: {}, deduct: {}, note: 'plan', overtime: [] } } },
      savings: { months: { '2027-04': { savings_list: [{ savings_amount: 500 }] } } },
      investment: { '2027-05': [{ name: 'fund', amount: 100 }] }
    });
    expect(Array.from(keys).sort()).toEqual(['2027-01', '2027-02', '2027-03', '2027-04', '2027-05']);
  });

  it('unions mixed collections and ignores derived credit-card rows and non-month keys', () => {
    const keys = getMeaningfulMonthKeys({
      expense: { months: { '2027-01': { cci_plan1: { value: 2500 } }, '2027-02': {}, bankAccounts: ['x'] } },
      income: { months: { '2027-02': { bonus: 1 } } },
      salary: undefined,
      investment: { '2027-01': [] }
    });
    expect(Array.from(keys)).toEqual(['2027-02']);
  });

  it('returns an empty set for missing / malformed input', () => {
    expect(getMeaningfulMonthKeys().size).toBe(0);
    expect(getMeaningfulMonthKeys({ expense: null, income: 'x', investment: 3 }).size).toBe(0);
  });
});
