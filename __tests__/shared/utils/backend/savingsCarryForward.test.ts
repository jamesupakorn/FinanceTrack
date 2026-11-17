/** @jest-environment node */
// savings-loan-withdrawal S2c (dispatch 1): pure carry-forward fold and the fail-closed prune
// cross-check (spec §5.8 A-1/A-2/A-5, architecture-review-s2c C-S2c-1, C-S2c-3, C-S2c-11). No I/O.
import {
  assertPrunedMonthsMatchPreview,
  foldPrunedMonths,
  normalizePrunedMonths,
  type CarryForwardGoal,
  type PrunedMonthDoc,
} from '../../../../src/shared/utils/backend/savingsCarryForward';

const NOW = '2026-11-17T00:00:00.000Z';
const LATER = '2026-11-18T00:00:00.000Z';
const GOAL_HOUSE = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const GOAL_CAR = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const goals: CarryForwardGoal[] = [
  { _id: GOAL_HOUSE, goalName: 'บ้าน', status: 'active' },
  { _id: GOAL_CAR, goalName: 'Car', status: 'active' },
];

function monthDoc(month: string, items: Array<[string, number | string]>): PrunedMonthDoc {
  return {
    month,
    savings_list: items.map(([type, amount]) => ({ savings_type: type, savings_amount: amount })),
  };
}

const opts = (excludeMonth: string | null = null, nowIso = NOW) => ({ excludeMonth, nowIso });

describe('normalizePrunedMonths', () => {
  it('keeps non-empty strings only', () => {
    expect(normalizePrunedMonths(['2024-01', '', null, 7, '2024-02'])).toEqual(['2024-01', '2024-02']);
  });

  it('reads non-arrays as []', () => {
    expect(normalizePrunedMonths(undefined)).toEqual([]);
    expect(normalizePrunedMonths('2024-01')).toEqual([]);
    expect(normalizePrunedMonths({ 0: '2024-01' })).toEqual([]);
  });
});

describe('foldPrunedMonths', () => {
  it('folds pool and per-goal amounts into an absent carry-forward', () => {
    const docs = [
      monthDoc('2024-01', [['บ้าน', 100], ['Car', '1,000.50'], ['other', 25]]),
      monthDoc('2024-02', [['บ้าน', 50.25], ['  car  ', 10]]),
    ];
    const { next, creditedMonths } = foldPrunedMonths(null, docs, goals, opts());

    expect(creditedMonths).toEqual(['2024-01', '2024-02']);
    expect(next).toEqual({
      poolAmount: 1185.75,
      goalAmounts: { [GOAL_HOUSE]: 150.25, [GOAL_CAR]: 1010.5 },
      goalAudit: {
        [GOAL_HOUSE]: { goalNameAtPrune: 'บ้าน', lastPrunedAt: NOW },
        [GOAL_CAR]: { goalNameAtPrune: 'Car', lastPrunedAt: NOW },
      },
      prunedMonths: ['2024-01', '2024-02'],
      updatedAt: NOW,
    });
    expect(next).not.toHaveProperty('_id');
    expect(next).not.toHaveProperty('userId');
  });

  it('adds onto existing totals and keeps untouched goals as they were', () => {
    const current = {
      _id: 'u001',
      userId: 'u001',
      poolAmount: 200,
      goalAmounts: { [GOAL_HOUSE]: 80, ccccccccccccccccccccccc0: 12.5 },
      goalAudit: { ccccccccccccccccccccccc0: { goalNameAtPrune: 'Old', lastPrunedAt: 'x' } },
      prunedMonths: ['2023-12'],
      updatedAt: 'earlier',
    };
    const { next } = foldPrunedMonths(current, [monthDoc('2024-01', [['บ้าน', 20]])], goals, opts());

    expect(next.poolAmount).toBe(220);
    expect(next.goalAmounts).toEqual({ [GOAL_HOUSE]: 100, ccccccccccccccccccccccc0: 12.5 });
    expect(next.goalAudit.ccccccccccccccccccccccc0).toEqual({ goalNameAtPrune: 'Old', lastPrunedAt: 'x' });
    expect(next.goalAudit[GOAL_HOUSE]).toEqual({ goalNameAtPrune: 'บ้าน', lastPrunedAt: NOW });
    expect(next.prunedMonths).toEqual(['2023-12', '2024-01']);
    expect(next).not.toHaveProperty('_id');
    expect(next).not.toHaveProperty('userId');
  });

  it('gives a goal no entry when its match is zero (AC-SLW-42)', () => {
    const { next } = foldPrunedMonths(null, [monthDoc('2024-01', [['บ้าน', 100], ['Car', 0]])], goals, opts());
    expect(next.goalAmounts).toEqual({ [GOAL_HOUSE]: 100 });
    expect(Object.keys(next.goalAudit)).toEqual([GOAL_HOUSE]);
  });

  it('skips abandoned goals and goals without an id', () => {
    const goalsWithJunk: CarryForwardGoal[] = [
      { _id: GOAL_HOUSE, goalName: 'บ้าน', status: 'abandoned' },
      { goalName: 'Car', status: 'active' },
    ];
    const { next } = foldPrunedMonths(null, [monthDoc('2024-01', [['บ้าน', 100], ['Car', 5]])], goalsWithJunk, opts());
    expect(next.goalAmounts).toEqual({});
    expect(next.poolAmount).toBe(105);
  });

  it('rounds every stored figure to 2dp', () => {
    const docs = [monthDoc('2024-01', [['บ้าน', 0.1], ['บ้าน', 0.2], ['x', 0.005]])];
    const { next } = foldPrunedMonths({ poolAmount: 0.1, goalAmounts: { [GOAL_HOUSE]: 0.1 } }, docs, goals, opts());
    expect(next.poolAmount).toBe(0.41);
    expect(next.goalAmounts[GOAL_HOUSE]).toBe(0.4);
  });

  it('credits every duplicate doc of one month but records the month once (A-5)', () => {
    const docs = [monthDoc('2024-01', [['บ้าน', 10]]), monthDoc('2024-01', [['บ้าน', 5], ['x', 1]])];
    const { next, creditedMonths } = foldPrunedMonths(null, docs, goals, opts());
    expect(creditedMonths).toEqual(['2024-01']);
    expect(next.prunedMonths).toEqual(['2024-01']);
    expect(next.poolAmount).toBe(16);
    expect(next.goalAmounts[GOAL_HOUSE]).toBe(15);
  });

  it('ignores docs without a usable month key', () => {
    const docs: PrunedMonthDoc[] = [
      { savings_list: [{ savings_type: 'บ้าน', savings_amount: 999 }] },
      { month: '', savings_list: [{ savings_type: 'บ้าน', savings_amount: 999 }] },
      monthDoc('2024-01', [['บ้าน', 1]]),
    ];
    const { next, creditedMonths } = foldPrunedMonths(null, docs, goals, opts());
    expect(creditedMonths).toEqual(['2024-01']);
    expect(next.poolAmount).toBe(1);
  });

  it('credits an all-empty month: poolAmount 0, month still recorded', () => {
    const { next, creditedMonths } = foldPrunedMonths(null, [{ month: '2024-01', savings_list: [] }], goals, opts());
    expect(creditedMonths).toEqual(['2024-01']);
    expect(next).toEqual({ poolAmount: 0, goalAmounts: {}, goalAudit: {}, prunedMonths: ['2024-01'], updatedAt: NOW });
  });

  describe('idempotency (A-1, F-13/C-9)', () => {
    it('drops already-recorded months before summing', () => {
      const current = { poolAmount: 100, goalAmounts: { [GOAL_HOUSE]: 100 }, prunedMonths: ['2024-01'] };
      const docs = [monthDoc('2024-01', [['บ้าน', 100]]), monthDoc('2024-02', [['บ้าน', 7]])];
      const { next, creditedMonths } = foldPrunedMonths(current, docs, goals, opts());

      expect(creditedMonths).toEqual(['2024-02']);
      expect(next.poolAmount).toBe(107);
      expect(next.goalAmounts[GOAL_HOUSE]).toBe(107);
      expect(next.prunedMonths).toEqual(['2024-01', '2024-02']);
    });

    it('a second fold over overlapping docs does not double-credit', () => {
      const first = foldPrunedMonths(
        null,
        [monthDoc('2024-01', [['บ้าน', 100]]), monthDoc('2024-02', [['Car', 40]])],
        goals,
        opts()
      );
      const second = foldPrunedMonths(
        first.next,
        [monthDoc('2024-02', [['Car', 40]]), monthDoc('2024-03', [['บ้าน', 1]])],
        goals,
        opts(null, LATER)
      );

      expect(second.creditedMonths).toEqual(['2024-03']);
      expect(second.next.poolAmount).toBe(141);
      expect(second.next.goalAmounts).toEqual({ [GOAL_HOUSE]: 101, [GOAL_CAR]: 40 });
      expect(second.next.goalAudit[GOAL_CAR].lastPrunedAt).toBe(NOW);
      expect(second.next.goalAudit[GOAL_HOUSE].lastPrunedAt).toBe(LATER);
      expect(second.next.prunedMonths).toEqual(['2024-01', '2024-02', '2024-03']);
    });

    it('returns the input unchanged with no credited months when everything is already recorded', () => {
      const current = {
        poolAmount: 5,
        goalAmounts: { [GOAL_HOUSE]: 5 },
        goalAudit: {},
        prunedMonths: ['2024-01'],
        updatedAt: 'earlier',
      };
      const { next, creditedMonths } = foldPrunedMonths(current, [monthDoc('2024-01', [['บ้าน', 5]])], goals, opts());
      expect(creditedMonths).toEqual([]);
      expect(next).toEqual(current);
    });

    it('returns no credited months for an empty prune', () => {
      expect(foldPrunedMonths(null, [], goals, opts()).creditedMonths).toEqual([]);
    });
  });

  describe('excludeMonth (D-SLW-28 as amended, C-S2c-11 / F-6)', () => {
    const docs = [monthDoc('2024-01', [['บ้าน', 30]]), monthDoc('2024-02', [['บ้าน', 70]])];

    it('does not credit the own month when this request created it (excludeMonth set)', () => {
      const { next, creditedMonths } = foldPrunedMonths(null, docs, goals, opts('2024-01'));
      expect(creditedMonths).toEqual(['2024-02']);
      expect(next.prunedMonths).not.toContain('2024-01');
      expect(next.poolAmount).toBe(70);
      expect(next.goalAmounts[GOAL_HOUSE]).toBe(70);
    });

    it('credits the own month with its content when it already existed (excludeMonth null)', () => {
      const { next, creditedMonths } = foldPrunedMonths(null, docs, goals, opts(null));
      expect(creditedMonths).toEqual(['2024-01', '2024-02']);
      expect(next.poolAmount).toBe(100);
      expect(next.goalAmounts[GOAL_HOUSE]).toBe(100);
    });

    it('produces nothing to write when the only pruned month is the excluded one', () => {
      const { creditedMonths } = foldPrunedMonths(null, [docs[0]], goals, opts('2024-01'));
      expect(creditedMonths).toEqual([]);
    });

    it('never re-credits a recorded month, excluded or not', () => {
      const current = { poolAmount: 30, prunedMonths: ['2024-01'] };
      for (const excludeMonth of [null, '2024-01']) {
        const { next, creditedMonths } = foldPrunedMonths(current, [docs[0]], goals, opts(excludeMonth));
        expect(creditedMonths).toEqual([]);
        expect(next.poolAmount).toBe(30);
        expect(next.prunedMonths).toEqual(['2024-01']);
      }
    });
  });

  describe('defensive normalization of the stored state', () => {
    it('reads non-finite pool and junk maps as empty, keeping own finite goal amounts only', () => {
      const inherited = Object.create({ [GOAL_CAR]: 999 });
      inherited[GOAL_HOUSE] = 10;
      inherited.junk = 'x';
      inherited.nan = Number.NaN;
      const current = { poolAmount: Number.POSITIVE_INFINITY, goalAmounts: inherited, goalAudit: [], prunedMonths: 'x' };
      const { next } = foldPrunedMonths(current, [monthDoc('2024-01', [['Car', 1]])], goals, opts());

      expect(next.poolAmount).toBe(1);
      expect(next.goalAmounts).toEqual({ [GOAL_HOUSE]: 10, [GOAL_CAR]: 1 });
      expect(next.prunedMonths).toEqual(['2024-01']);
    });

    it('does not treat an inherited key as a prior goal amount', () => {
      const constructorGoal: CarryForwardGoal[] = [{ _id: 'constructor', goalName: 'บ้าน', status: 'active' }];
      const { next } = foldPrunedMonths(null, [monthDoc('2024-01', [['บ้าน', 3]])], constructorGoal, opts());
      expect(next.goalAmounts.constructor).toBe(3);
    });
  });

  it('every fold that credits strictly grows prunedMonths (C-S2c-3 revision invariant)', () => {
    const cases: Array<[unknown, PrunedMonthDoc[], string | null]> = [
      [null, [monthDoc('2024-01', [])], null],
      [{ prunedMonths: ['2023-01', '', 5] }, [monthDoc('2024-01', []), monthDoc('2024-02', [])], null],
      [{ prunedMonths: ['2024-01'] }, [monthDoc('2024-01', []), monthDoc('2024-02', [])], '2024-03'],
      [{ prunedMonths: 'junk' }, [monthDoc('2024-01', []), monthDoc('2024-01', [])], null],
    ];
    cases.forEach(([current, docs, excludeMonth]) => {
      const { next, creditedMonths } = foldPrunedMonths(current, docs, goals, opts(excludeMonth));
      expect(creditedMonths.length).toBeGreaterThanOrEqual(1);
      const before = normalizePrunedMonths((current as { prunedMonths?: unknown } | null)?.prunedMonths);
      expect(next.prunedMonths.length).toBeGreaterThan(before.length);
      expect(next.prunedMonths).toEqual([...before, ...creditedMonths]);
    });
  });

  it('does not mutate its inputs', () => {
    const current = { poolAmount: 1, goalAmounts: { [GOAL_HOUSE]: 1 }, goalAudit: {}, prunedMonths: ['2023-01'], updatedAt: 'e' };
    const snapshot = JSON.parse(JSON.stringify(current));
    const docs = [monthDoc('2024-01', [['บ้าน', 2]])];
    const docsSnapshot = JSON.parse(JSON.stringify(docs));
    foldPrunedMonths(current, docs, goals, opts());
    expect(current).toEqual(snapshot);
    expect(docs).toEqual(docsSnapshot);
  });
});

describe('assertPrunedMonthsMatchPreview (C-S2c-1)', () => {
  it('passes when the deleted set equals the preview set, regardless of order', () => {
    expect(() => assertPrunedMonthsMatchPreview(['2024-01', '2024-02'], ['2024-02', '2024-01'])).not.toThrow();
    expect(() => assertPrunedMonthsMatchPreview([], [])).not.toThrow();
  });

  it('throws when the prune deleted a month the preview did not credit', () => {
    expect(() => assertPrunedMonthsMatchPreview([], ['2024-01'])).toThrow(/diverged/);
  });

  it('throws when the preview credited a month the prune did not delete', () => {
    expect(() => assertPrunedMonthsMatchPreview(['2024-01', '2024-02'], ['2024-01'])).toThrow(/diverged/);
  });

  it('throws on a disjoint set of equal size', () => {
    expect(() => assertPrunedMonthsMatchPreview(['2024-01'], ['2024-02'])).toThrow(Error);
  });

  it('throws when fed a stub prune result that diverges from a stub preview', async () => {
    // Collaborator stubs standing in for the preview read and enforceMonthLimit; the wrapper-level
    // test (collection stub whose second find differs) lands with the Mongo wrapper in dispatch 4.
    const previewPruned = async () => ['2024-01'];
    const enforceStub = async () => ({ retainedMonths: [], prunedMonths: ['2024-01', '2024-02'] });
    const pruned = await previewPruned();
    const { prunedMonths } = await enforceStub();
    expect(() => assertPrunedMonthsMatchPreview(pruned, prunedMonths)).toThrow(/2024-02/);
  });
});
