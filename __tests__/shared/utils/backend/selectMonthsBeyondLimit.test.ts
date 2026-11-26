/** @jest-environment node */
// savings-loan-withdrawal S2b: `selectMonthsBeyondLimit` extracted out of `enforceMonthLimit`'s
// own dedupe/sort/slice logic (spec §5.8 A-5, AC-SLW-37). Pure, no I/O. Proves the extraction is
// behaviour-identical to the pre-extraction inline logic (apiUtils.ts:60-108, pre-S2b) for the
// same inputs, plus the additive-`prunedMonths`-via-`pruned` shape `enforceMonthLimit` now delegates to.
import { selectMonthsBeyondLimit, enforceMonthLimit } from '../../../../src/shared/utils/backend/apiUtils';

/** Reproduces the exact pre-extraction inline logic (apiUtils.ts, pre-S2b) for comparison. */
function inlineReference(
  months: unknown[],
  limit: number,
  options: { additionalMonths?: string[]; sortComparator?: (a: string, b: string) => number } = {}
): { retained: string[]; pruned: string[] } {
  const { additionalMonths = [], sortComparator } = options;
  const monthSet = new Set<string>();
  months.forEach(m => {
    if (typeof m === 'string' && m.length > 0) monthSet.add(m);
  });
  additionalMonths.forEach(m => {
    if (typeof m === 'string' && m.length > 0) monthSet.add(m);
  });
  const comparator = typeof sortComparator === 'function'
    ? sortComparator
    : (a: string, b: string) => b.localeCompare(a);
  const ordered = Array.from(monthSet).sort(comparator);
  return { retained: ordered.slice(0, limit), pruned: ordered.slice(limit) };
}

describe('selectMonthsBeyondLimit', () => {
  it('drops non-string/empty entries', () => {
    const result = selectMonthsBeyondLimit(['2026-01', '', null, undefined, 42, '2026-02'], 15);
    expect(result).toEqual({ retained: ['2026-02', '2026-01'], pruned: [] });
  });

  it('collapses duplicates', () => {
    const result = selectMonthsBeyondLimit(['2026-01', '2026-01', '2026-02'], 15);
    expect(result.retained).toEqual(['2026-02', '2026-01']);
  });

  it('unions with additionalMonths (same filter applied)', () => {
    const result = selectMonthsBeyondLimit(['2026-01'], 15, {
      additionalMonths: ['2026-02', '', null as unknown as string],
    });
    expect(result.retained).toEqual(['2026-02', '2026-01']);
  });

  it('respects a custom sortComparator', () => {
    const ascending = (a: string, b: string) => a.localeCompare(b);
    const result = selectMonthsBeyondLimit(['2026-02', '2026-01', '2026-03'], 2, {
      sortComparator: ascending,
    });
    expect(result).toEqual({ retained: ['2026-01', '2026-02'], pruned: ['2026-03'] });
  });

  it('returns pruned: [] when limit >= length', () => {
    const result = selectMonthsBeyondLimit(['2026-01', '2026-02'], 15);
    expect(result.pruned).toEqual([]);
  });

  it('splits retained/pruned at the limit, default newest-first comparator', () => {
    const months = ['2025-01', '2025-02', '2025-03', '2025-04'];
    const result = selectMonthsBeyondLimit(months, 2);
    expect(result).toEqual({ retained: ['2025-04', '2025-03'], pruned: ['2025-02', '2025-01'] });
  });

  it('matches the pre-extraction inline logic for arbitrary inputs (default comparator)', () => {
    const months = ['2024-11', '2024-12', '2025-01', '2024-11', '', 'junk-not-a-month-but-still-a-string'];
    const options = { additionalMonths: ['2025-02'] };
    expect(selectMonthsBeyondLimit(months, 3, options)).toEqual(inlineReference(months, 3, options));
  });

  it('matches the pre-extraction inline logic for arbitrary inputs (custom comparator)', () => {
    const months = ['2024-03', '2024-01', '2024-02'];
    const options = { sortComparator: (a: string, b: string) => a.localeCompare(b) };
    expect(selectMonthsBeyondLimit(months, 1, options)).toEqual(inlineReference(months, 1, options));
  });

  it('treats a missing/empty months array as empty, additionalMonths still honoured', () => {
    const result = selectMonthsBeyondLimit([], 15, { additionalMonths: ['2026-05'] });
    expect(result).toEqual({ retained: ['2026-05'], pruned: [] });
  });
});

/** Minimal in-memory fake collection, enough for enforceMonthLimit's own find/deleteMany calls. */
function fakeMonthCollection(months: string[]) {
  const docs = months.map(month => ({ month }));
  return {
    find() {
      return { toArray: async () => docs.map(doc => ({ ...doc })) };
    },
    async deleteMany(filter: { month: { $in: string[] } }) {
      const toDelete = new Set(filter.month.$in);
      for (let i = docs.length - 1; i >= 0; i -= 1) {
        if (toDelete.has(docs[i].month)) docs.splice(i, 1);
      }
      return {};
    },
  };
}

describe('enforceMonthLimit — additive prunedMonths field (S2b)', () => {
  it('is additive: prunedMonths matches the deleted months, retainedMonths unaffected', async () => {
    const collection = fakeMonthCollection(['2025-01', '2025-02', '2025-03', '2025-04']);

    const result = await enforceMonthLimit(collection, 2);

    expect(result.retainedMonths).toEqual(['2025-04', '2025-03']);
    expect(result.prunedMonths).toEqual(['2025-02', '2025-01']);
  });

  it('returns prunedMonths: [] (not undefined) on the early-return no-collection path', async () => {
    const result = await enforceMonthLimit(null, 15);
    expect(result).toEqual({ retainedMonths: [], prunedMonths: [] });
  });

  it('returns prunedMonths: [] when nothing exceeds the limit', async () => {
    const collection = fakeMonthCollection(['2025-01', '2025-02']);
    const result = await enforceMonthLimit(collection, 15);
    expect(result).toEqual({ retainedMonths: ['2025-02', '2025-01'], prunedMonths: [] });
  });
});
