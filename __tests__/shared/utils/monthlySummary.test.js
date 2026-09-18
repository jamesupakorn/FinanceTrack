const { computeTotalIncome } = require('../../../src/shared/utils/frontend/monthlySummary');

// TD-H02 monthlySummary.js -> .ts conversion: the file-split rewrite briefly used toNumber()
// (collapses non-numeric strings straight to 0) instead of the original's parseFloat(x || 0)
// (only defaults *falsy* input to 0, otherwise lets parseFloat return NaN for the caller's
// Number.isFinite guard to handle later). These look equivalent but aren't: when one income
// field is a valid number and a sibling field is garbage, the original's NaN propagates through
// just the garbage term and gets zeroed by the isFinite guard, while toNumber's early-collapse-
// to-0 gets subtracted mid-formula instead, producing a different (usually lower) total.
// Caught during Stage 5 review by independently reproducing both code paths, not by tests --
// this test suite is the permanent guard against a regression of that same class.
describe('computeTotalIncome — malformed-field / falsy-fallback regression', () => {
  it('drops only the malformed field, keeping a valid sibling field intact', () => {
    // รวม is garbage, salary is valid — total should equal just the valid salary (100),
    // not 0 (which is what a premature-collapse-to-0 bug would produce).
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

  it('falls back to the Thai net-income field only when net_income is genuinely falsy, matching || (not ??) semantics', () => {
    // net_income is 0 (falsy, not undefined) -- must fall through to the Thai field, same as `||`.
    // A ?? -based rewrite would incorrectly keep the falsy-but-defined 0 and skip the fallback.
    const result = computeTotalIncome({
      salaryData: { summary: { net_income: 0 }, สรุป: { เงินได้สุทธิ: 300 } },
      incomeData: { salary: '50' },
    });
    expect(result).toBe(250); // 300 (fallback net income) - 50 (nonSalaryIncome term)
  });

  it('treats a garbage net_income the same as the original: falls through the isFinite guard to 0 contribution', () => {
    const result = computeTotalIncome({
      salaryData: { summary: { net_income: 'abc' } },
      incomeData: { salary: '100' },
    });
    expect(result).toBe(0);
  });
});
