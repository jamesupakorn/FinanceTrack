/** @jest-environment node */
// savings-loan-withdrawal S2c, dispatch 2: the `carriedByGoal` term (4th argument) of `computeCurrentAmounts`
// (spec §4.2 / §5.6, C-S2c-4). Covers: the carried amount is added right after the matching loop and rounded;
// a goal with no or zero carry stays bit-identical, float dust included (AC-SLW-11, same guard as S2-F-5);
// in-function order matching → carry → adjustments → ledger; inherited/non-finite keys read as 0; stored junk
// metadata never shadows the derived fields, which derive from the carried total (C-S2-5 ordering).
import {
  computeCurrentAmounts,
  type GoalLedgerTotals,
  type SavingsDocument,
  type SavingsGoal,
} from '../../../../src/shared/utils/backend/savingsGoalBalances';

const GOAL_ID = 'c0c0c0c0c0c0c0c0c0c0c0c0';

function makeGoal(overrides: Partial<SavingsGoal> = {}): SavingsGoal {
  return { _id: GOAL_ID, goalName: 'บ้าน', targetAmount: 1000, status: 'active', ...overrides };
}

/** 0.1 + 0.2 = 0.30000000000000004: the float-dust fixture the no-carry path must keep. */
const DUST_DOCS: SavingsDocument[] = [
  { month: '2026-10', savings_list: [{ savings_type: 'บ้าน', savings_amount: 0.1 }] },
  { month: '2026-11', savings_list: [{ savings_type: 'บ้าน', savings_amount: 0.2 }] },
];

describe('computeCurrentAmounts — carriedByGoal term (S2c)', () => {
  it('adds the goal\'s carried amount after matching, rounded to 2dp', () => {
    const [result] = computeCurrentAmounts([makeGoal()], DUST_DOCS, undefined, { [GOAL_ID]: 100 });
    expect(result.currentAmount).toBe(100.3);
  });

  it('carries a goal with no retained savings at all', () => {
    const [result] = computeCurrentAmounts([makeGoal()], [], undefined, { [GOAL_ID]: 250.5 });
    expect(result.currentAmount).toBe(250.5);
    expect(result.metadata.remainingAmount).toBe(749.5);
    expect(result.metadata.progressPercentage).toBe(25.05);
  });

  describe('AC-SLW-11 guard: no change without carry-forward', () => {
    const baseline = () => computeCurrentAmounts([makeGoal()], DUST_DOCS)[0];

    it('keeps float dust when no map is passed', () => {
      expect(baseline().currentAmount).toBe(0.1 + 0.2);
      expect(baseline().currentAmount).not.toBe(0.3);
    });

    it.each<[string, Record<string, number> | undefined]>([
      ['undefined map', undefined],
      ['empty map', {}],
      ['entry for another goal only', { 'other-goal': 999 }],
      ['explicit zero entry', { [GOAL_ID]: 0 }],
      ['negative-zero entry', { [GOAL_ID]: -0 }],
    ])('is bit-identical with %s (no "free" rounding)', (_label, carried) => {
      const [result] = computeCurrentAmounts([makeGoal()], DUST_DOCS, undefined, carried);
      expect(result).toEqual(baseline());
      expect(Object.is(result.currentAmount, baseline().currentAmount)).toBe(true);
    });

    it('keeps the 3-argument (S2) result identical when a zero carry is added', () => {
      const ledger = new Map<string, GoalLedgerTotals>([[GOAL_ID, { outstanding: 10, withdrawn: 0 }]]);
      const [s2] = computeCurrentAmounts([makeGoal()], DUST_DOCS, ledger);
      const [s2c] = computeCurrentAmounts([makeGoal()], DUST_DOCS, ledger, { [GOAL_ID]: 0 });
      expect(s2c).toEqual(s2);
    });
  });

  it('applies matching → carry → adjustments → ledger, in that order', () => {
    const goal = makeGoal({
      adjustments: [{ _id: 'adj-1', amount: 50.25, note: '', createdAt: '', updatedAt: '' }],
    });
    const ledger = new Map<string, GoalLedgerTotals>([[GOAL_ID, { outstanding: 20, withdrawn: 5.5 }]]);
    const [result] = computeCurrentAmounts([goal], DUST_DOCS, ledger, { [GOAL_ID]: 100.1 });

    let expected = 0.1 + 0.2;
    expected = Math.round((expected + 100.1) * 100) / 100;
    expected += 50.25;
    expected = Math.round((expected - 25.5) * 100) / 100;
    expect(result.currentAmount).toBe(expected);
    expect(result.currentAmount).toBe(125.15);
    expect(result.metadata.adjustmentsTotal).toBe(50.25);
    expect(result.metadata.outstandingLoansTotal).toBe(20);
    expect(result.metadata.withdrawalsTotal).toBe(5.5);
  });

  it('keys by String(goal._id) and leaves other goals untouched', () => {
    const other = makeGoal({ _id: 'goal-2', goalName: 'รถ' });
    const [withCarry, withoutCarry] = computeCurrentAmounts(
      [makeGoal(), other],
      DUST_DOCS,
      undefined,
      { [GOAL_ID]: 10 }
    );
    expect(withCarry.currentAmount).toBe(10.3);
    expect(withoutCarry).toEqual(computeCurrentAmounts([other], DUST_DOCS)[0]);
  });

  it('allows a negative carried amount and does not clamp', () => {
    const [result] = computeCurrentAmounts([makeGoal()], [], undefined, { [GOAL_ID]: -40 });
    expect(result.currentAmount).toBe(-40);
    expect(result.metadata.remainingAmount).toBe(1040);
  });

  describe('defensive key handling (C-S2c-4)', () => {
    it('ignores inherited keys such as constructor', () => {
      const goal = makeGoal({ _id: 'constructor' });
      const [result] = computeCurrentAmounts([goal], DUST_DOCS, undefined, {});
      expect(result).toEqual(computeCurrentAmounts([goal], DUST_DOCS)[0]);
    });

    it.each([NaN, Infinity, -Infinity, '500' as unknown as number, null as unknown as number])(
      'reads a non-finite or non-number value (%p) as 0',
      (value) => {
        const [result] = computeCurrentAmounts([makeGoal()], DUST_DOCS, undefined, { [GOAL_ID]: value });
        expect(result).toEqual(computeCurrentAmounts([makeGoal()], DUST_DOCS)[0]);
      }
    );
  });

  describe('metadata ordering (C-S2-5): stored junk never shadows derived fields', () => {
    it('derives progress and remaining from the carried total, overriding stored values', () => {
      const goal = makeGoal({
        metadata: {
          progressPercentage: 999,
          remainingAmount: -1,
          adjustmentsTotal: 777,
          outstandingLoansTotal: 555,
          withdrawalsTotal: 444,
          note: 'kept',
        },
      });
      const [result] = computeCurrentAmounts([goal], [], undefined, { [GOAL_ID]: 400 });
      expect(result.currentAmount).toBe(400);
      expect(result.metadata).toEqual({
        note: 'kept',
        progressPercentage: 40,
        remainingAmount: 600,
        adjustmentsTotal: 0,
        outstandingLoansTotal: 0,
        withdrawalsTotal: 0,
      });
    });

    it('does not read a stored metadata field as a carry-forward source', () => {
      const goal = makeGoal({ metadata: { carriedForward: 5000, goalAmounts: { [GOAL_ID]: 5000 } } });
      const [result] = computeCurrentAmounts([goal], DUST_DOCS);
      expect(result.currentAmount).toBe(0.1 + 0.2);
    });
  });

  it('does not mutate the carried map or the goal', () => {
    const carried = { [GOAL_ID]: 12.34 };
    const goal = makeGoal({ metadata: { a: 1 } });
    computeCurrentAmounts([goal], DUST_DOCS, undefined, carried);
    expect(carried).toEqual({ [GOAL_ID]: 12.34 });
    expect(goal.metadata).toEqual({ a: 1 });
  });
});
