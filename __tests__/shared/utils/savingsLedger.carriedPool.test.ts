// savings-loan-withdrawal S2c, dispatch 2: the `carriedPool` term of `computePoolBalance` (spec §5.6).
// With the default 0 every S1 result is unchanged; a carried amount enters poolSavingsTotal and so poolBalance.
import { computePoolBalance, type LedgerSummary } from '../../../src/shared/utils/savingsLedger';

function summary(outstanding: number, withdrawn: number): LedgerSummary {
  return { pool: { outstanding, withdrawn }, byGoal: new Map(), totalOutstanding: outstanding, openLoanCount: 0 };
}

describe('computePoolBalance — carriedPool (S2c)', () => {
  it('is unchanged without carriedPool or with an explicit 0', () => {
    const s = summary(2000, 500);
    expect(computePoolBalance(10000, s, 0)).toEqual(computePoolBalance(10000, s));
    expect(computePoolBalance(10000, s)).toEqual({
      poolSavingsTotal: 10000,
      poolOutstanding: 2000,
      poolWithdrawn: 500,
      poolBalance: 7500,
      poolCarriedForward: 0,
    });
  });

  it('is bit-identical to the S1 rounding on float-dust lifetimes when carriedPool is 0', () => {
    const s = summary(0.1, 0.2);
    [0.30000000000000004, 0.7999999999999999, -0, 1e-9].forEach(lifetime => {
      expect(computePoolBalance(lifetime, s, 0)).toEqual(computePoolBalance(lifetime, s));
    });
  });

  it('adds the carried amount to poolSavingsTotal and poolBalance', () => {
    expect(computePoolBalance(10000, summary(2000, 500), 3000)).toEqual({
      poolSavingsTotal: 13000,
      poolOutstanding: 2000,
      poolWithdrawn: 500,
      poolBalance: 10500,
      poolCarriedForward: 3000,
    });
  });

  it('rounds the sum to 2dp', () => {
    const result = computePoolBalance(0.2, summary(0, 0), 0.1);
    expect(result.poolSavingsTotal).toBe(0.3);
    expect(result.poolBalance).toBe(0.3);
  });

  it('carries the pool even when no month is retained', () => {
    expect(computePoolBalance(0, summary(0, 0), 1234.56).poolBalance).toBe(1234.56);
  });

  it('stays unclamped: the pool can still go negative (E-SLW-12)', () => {
    expect(computePoolBalance(100, summary(1000, 0), 200).poolBalance).toBe(-700);
  });
});

describe('computePoolBalance — poolCarriedForward (S2c, C-S2c-5)', () => {
  it('reports the carried amount when carriedPool is nonzero', () => {
    expect(computePoolBalance(10000, summary(2000, 500), 3000).poolCarriedForward).toBe(3000);
    expect(computePoolBalance(0, summary(0, 0), 1234.56).poolCarriedForward).toBe(1234.56);
  });

  it('rounds the reported carried amount to 2dp', () => {
    expect(computePoolBalance(0, summary(0, 0), 0.1 + 0.2).poolCarriedForward).toBe(0.3);
  });

  it('is 0 with the default or an explicit 0 carriedPool', () => {
    expect(computePoolBalance(10000, summary(2000, 500)).poolCarriedForward).toBe(0);
    expect(computePoolBalance(10000, summary(2000, 500), 0).poolCarriedForward).toBe(0);
    expect(Object.is(computePoolBalance(10000, summary(0, 0), -0).poolCarriedForward, 0)).toBe(true);
  });
});
