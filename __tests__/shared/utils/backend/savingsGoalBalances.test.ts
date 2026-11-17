/** @jest-environment node */
// savings-loan-withdrawal S2, dispatch 1: the pure `ledgerByGoal` term added to `computeCurrentAmounts`
// (spec §4.2, D-SLW-17, R-SLW-3). Covers: a goal with ledger activity gets the reduced balance; a goal
// absent from the map (or no map at all) stays bit-identical (AC-SLW-11); stored junk metadata never
// shadows the derived fields (C-S2-5 / S2-F-4, mirroring the sibling's adjustments H-2 pattern).
import { computeCurrentAmounts, type SavingsGoal, type GoalLedgerTotals } from '../../../../src/shared/utils/backend/savingsGoalBalances';

function makeGoal(overrides: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    _id: 'goal-1',
    goalName: 'บ้าน',
    targetAmount: 1000,
    status: 'active',
    ...overrides,
  };
}

describe('computeCurrentAmounts — ledgerByGoal term (S2)', () => {
  it('subtracts outstanding + withdrawn for a goal with ledger activity, rounded to 2dp', () => {
    const goal = makeGoal({ _id: 'goal-1' });
    const ledgerByGoal = new Map<string, GoalLedgerTotals>([
      ['goal-1', { outstanding: 100.333, withdrawn: 50 }],
    ]);

    const [result] = computeCurrentAmounts([goal], [], ledgerByGoal);

    // currentAmount starts at 0 (no savings docs, no adjustments) → 0 - 150.333 = -150.333 → round2
    expect(result.currentAmount).toBe(Math.round((0 - 150.333) * 100) / 100);
    expect(result.metadata.outstandingLoansTotal).toBe(100.333);
    expect(result.metadata.withdrawalsTotal).toBe(50);
  });

  it('is bit-identical when the goal has no entry in the map', () => {
    const goal = makeGoal({ _id: 'goal-no-ledger' });
    const ledgerByGoal = new Map<string, GoalLedgerTotals>([
      ['some-other-goal', { outstanding: 999, withdrawn: 999 }],
    ]);

    const [withMap] = computeCurrentAmounts([goal], [], ledgerByGoal);
    const [withoutMap] = computeCurrentAmounts([goal], []);

    expect(withMap.currentAmount).toBe(withoutMap.currentAmount);
    expect(withMap.metadata.progressPercentage).toBe(withoutMap.metadata.progressPercentage);
    expect(withMap.metadata.remainingAmount).toBe(withoutMap.metadata.remainingAmount);
    expect(withMap.metadata.outstandingLoansTotal).toBe(0);
    expect(withMap.metadata.withdrawalsTotal).toBe(0);
  });

  it('is bit-identical when no map is passed at all (AC-SLW-11)', () => {
    const goal = makeGoal({ _id: 'goal-1' });

    const [result] = computeCurrentAmounts([goal], []);

    expect(result.currentAmount).toBe(0);
    expect(result.metadata.outstandingLoansTotal).toBe(0);
    expect(result.metadata.withdrawalsTotal).toBe(0);
  });

  it('does not round a goal with zero ledger activity differently than before (S2-F-5)', () => {
    // Float dust case: savings entries that sum to a value with floating-point error.
    const goal = makeGoal({ _id: 'goal-dust' });
    const savingsDocs = [
      { savings_list: [{ savings_type: 'บ้าน', savings_amount: 0.1 }, { savings_type: 'บ้าน', savings_amount: 0.2 }] },
    ];

    const [withEmptyMap] = computeCurrentAmounts([goal], savingsDocs, new Map());
    const [withoutMap] = computeCurrentAmounts([goal], savingsDocs);

    // Pre-S2 behavior: currentAmount stays unrounded (e.g. 0.30000000000000004) when the ledger term
    // never fires. A goal with no ledger entry must not get a "free" rounding fix.
    expect(withEmptyMap.currentAmount).toBe(0.1 + 0.2);
    expect(withEmptyMap.currentAmount).toBe(withoutMap.currentAmount);
  });

  it('overrides stored junk metadata.outstandingLoansTotal with the computed value (C-S2-5)', () => {
    const goal = makeGoal({
      _id: 'goal-1',
      metadata: { outstandingLoansTotal: 'not-a-real-value', withdrawalsTotal: 123456 },
    });
    const ledgerByGoal = new Map<string, GoalLedgerTotals>([
      ['goal-1', { outstanding: 25, withdrawn: 5 }],
    ]);

    const [result] = computeCurrentAmounts([goal], [], ledgerByGoal);

    expect(result.metadata.outstandingLoansTotal).toBe(25);
    expect(result.metadata.withdrawalsTotal).toBe(5);
  });

  it('overrides stored junk metadata even when no ledger entry exists for the goal', () => {
    const goal = makeGoal({
      _id: 'goal-1',
      metadata: { outstandingLoansTotal: 999999, withdrawalsTotal: 999999 },
    });

    const [result] = computeCurrentAmounts([goal], []);

    expect(result.metadata.outstandingLoansTotal).toBe(0);
    expect(result.metadata.withdrawalsTotal).toBe(0);
  });
});
