const { computeTotalIncome } = require('../../../src/shared/utils/frontend/monthlySummary');

describe('computeTotalIncome — malformed-field / falsy-fallback regression', () => {
  it('drops only the malformed field, keeping a valid sibling field intact', () => {
    expect(computeTotalIncome({ incomeData: { รวม: 'abc', salary: '100' } })).toBe(100);
    expect(computeTotalIncome({ incomeData: { รวม: 'abc', salary: 100 } })).toBe(100);
  });

  it('sums two valid numeric-string fields normally', () => {
    expect(computeTotalIncome({ incomeData: { รวม: '500', salary: '100' } })).toBe(500);
  });

  it('returns 0 for missing/empty income data', () => {
    expect(computeTotalIncome()).toBe(0);
    expect(computeTotalIncome({})).toBe(0);
    expect(computeTotalIncome({ incomeData: {} })).toBe(0);
  });

  it('falls back to the Thai net-income field only when net_income is genuinely falsy, matching || semantics', () => {
    const result = computeTotalIncome({
      salaryData: { summary: { net_income: 0 }, สรุป: { เงินได้สุทธิ: 300 } },
      incomeData: { salary: '50' }
    });
    expect(result).toBe(250);
  });

  it('treats a garbage net_income the same as the original: falls through the isFinite guard to 0 contribution', () => {
    const result = computeTotalIncome({ salaryData: { summary: { net_income: 'abc' } }, incomeData: { salary: '100' } });
    expect(result).toBe(0);
  });
});