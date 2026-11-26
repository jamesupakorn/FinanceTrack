// Savings goal adjustments S1 — pure helper contract (spec-savings-goal-adjustments §3/§4.1, AC-SGA-17,
// E-SGA-1/2/5/6/7/12/17, plus architecture-review H-4 post-rounding finiteness and the amount cap).
import {
  MAX_ADJUSTMENTS_PER_GOAL,
  MAX_ADJUSTMENT_AMOUNT,
  MAX_ADJUSTMENT_NOTE_LENGTH,
  applyAdjustmentAction,
  isAdjustmentAction,
  isAdjustmentAmountWithinCap,
  normalizeAdjustmentNote,
  readAdjustments,
  sumAdjustments,
  toAdjustmentAmount,
  type SavingsGoalAdjustment,
} from '../../../src/shared/utils/savingsGoalAdjustments';

const NOW = '2026-11-11T10:00:00.000Z';
const EARLIER = '2026-11-01T00:00:00.000Z';

function entry(overrides: Partial<SavingsGoalAdjustment> = {}): SavingsGoalAdjustment {
  return { _id: 'adj-1', amount: 100, note: 'แก้ยอด', createdAt: EARLIER, updatedAt: EARLIER, ...overrides };
}

describe('constants', () => {
  it('match the spec and the user-confirmed cap', () => {
    expect(MAX_ADJUSTMENTS_PER_GOAL).toBe(120);
    expect(MAX_ADJUSTMENT_NOTE_LENGTH).toBe(120);
    expect(MAX_ADJUSTMENT_AMOUNT).toBe(9999999.99);
  });
});

describe('isAdjustmentAction', () => {
  it.each(['addAdjustment', 'editAdjustment', 'deleteAdjustment'])('accepts %s', (value) => {
    expect(isAdjustmentAction(value)).toBe(true);
  });

  it.each([['foo'], [''], [null], [undefined], [1], [['addAdjustment']], [{}]])('rejects %p', (value) => {
    expect(isAdjustmentAction(value)).toBe(false);
  });
});

describe('readAdjustments', () => {
  it('E-SGA-1: missing field → []', () => {
    expect(readAdjustments({})).toEqual([]);
    expect(readAdjustments(null)).toEqual([]);
    expect(readAdjustments(undefined)).toEqual([]);
  });

  it.each([[null], [{ a: 1 }], ['abc'], [5]])('E-SGA-2: non-array %p → []', (value) => {
    expect(readAdjustments({ adjustments: value })).toEqual([]);
  });

  it('skips invalid entries and keeps stored order', () => {
    const a = entry({ _id: 'a', amount: 10 });
    const b = entry({ _id: 'b', amount: -5 });
    const list = [
      a,
      null,
      'junk',
      [1],
      { ...entry(), _id: '' },
      { ...entry(), _id: 7 },
      { ...entry(), amount: 0 },
      { ...entry(), amount: '10' },
      { ...entry(), amount: Infinity },
      { ...entry(), amount: NaN },
      { ...entry(), note: 5 },
      b,
    ];
    expect(readAdjustments({ adjustments: list })).toEqual([a, b]);
  });

  it('drops unknown keys from valid entries', () => {
    const stored = { ...entry(), extra: 'x' };
    expect(readAdjustments({ adjustments: [stored] })).toEqual([entry()]);
  });

  it('does not mutate the stored array', () => {
    const stored = [entry(), null];
    readAdjustments({ adjustments: stored });
    expect(stored).toHaveLength(2);
  });
});

describe('sumAdjustments', () => {
  it('empty list returns exactly +0', () => {
    expect(Object.is(sumAdjustments([]), 0)).toBe(true);
  });

  it('E-SGA-17: float accumulation is rounded to 2dp', () => {
    expect(sumAdjustments([entry({ amount: 0.1 }), entry({ amount: 0.2 })])).toBe(0.3);
  });

  it('sums signed values and can go negative', () => {
    expect(sumAdjustments([entry({ amount: 100 }), entry({ amount: -250.5 })])).toBe(-150.5);
  });
});

describe('toAdjustmentAmount', () => {
  it.each([
    [100, 100],
    [-42.5, -42.5],
    ['1,500.50', 1500.5], // E-SGA-5
    ['-1,000', -1000],
    [1.005, 1],
    [0.006, 0.01],
    ['1e3', 1000],
    ['0x10', 16],
  ])('%p → %p', (input, expected) => {
    expect(toAdjustmentAmount(input)).toBe(expected);
  });

  // E-SGA-6, plus '-0', unicode minus, and H-4 overflow-after-rounding
  it.each([
    [0], ['0'], [-0], ['-0'], ['0.001'], [0.004], ['abc'], [''], ['   '], [true], [false], [null], [undefined],
    [[5]], [{}], [Infinity], [-Infinity], [NaN], ['Infinity'], ['−5'], [1e307], ['1e307'], [-1e307],
  ])('%p → null', (input) => {
    expect(toAdjustmentAmount(input)).toBeNull();
  });
});

describe('isAdjustmentAmountWithinCap', () => {
  it('accepts up to ±MAX_ADJUSTMENT_AMOUNT and rejects beyond it', () => {
    expect(isAdjustmentAmountWithinCap(MAX_ADJUSTMENT_AMOUNT)).toBe(true);
    expect(isAdjustmentAmountWithinCap(-MAX_ADJUSTMENT_AMOUNT)).toBe(true);
    expect(isAdjustmentAmountWithinCap(10000000)).toBe(false);
    expect(isAdjustmentAmountWithinCap(-10000000)).toBe(false);
  });
});

describe('normalizeAdjustmentNote', () => {
  it('trims', () => {
    expect(normalizeAdjustmentNote('  ยอดตกหล่น  ')).toBe('ยอดตกหล่น');
  });

  it('E-SGA-7: blank → null', () => {
    expect(normalizeAdjustmentNote('   ')).toBeNull();
    expect(normalizeAdjustmentNote('')).toBeNull();
  });

  it.each([[null], [undefined], [5], [['x']], [{}]])('non-string %p → null', (value) => {
    expect(normalizeAdjustmentNote(value)).toBeNull();
  });

  it('length limit uses the trimmed length', () => {
    const max = 'ก'.repeat(MAX_ADJUSTMENT_NOTE_LENGTH);
    expect(normalizeAdjustmentNote(max)).toBe(max);
    expect(normalizeAdjustmentNote(`  ${max}  `)).toBe(max);
    expect(normalizeAdjustmentNote(`${max}x`)).toBeNull();
  });
});

describe('applyAdjustmentAction', () => {
  it('add appends with createdAt === updatedAt === now', () => {
    const current = [entry({ _id: 'a' })];
    const result = applyAdjustmentAction(current, { action: 'addAdjustment', amount: -20, note: 'x' }, NOW, 'new-id');
    expect(result).toEqual({
      ok: true,
      adjustment: { _id: 'new-id', amount: -20, note: 'x', createdAt: NOW, updatedAt: NOW },
      adjustments: [current[0], { _id: 'new-id', amount: -20, note: 'x', createdAt: NOW, updatedAt: NOW }],
    });
    expect(current).toHaveLength(1);
  });

  it('E-SGA-12: add at the cap → 409, edit and delete still work', () => {
    const full = Array.from({ length: MAX_ADJUSTMENTS_PER_GOAL }, (_, i) => entry({ _id: `a${i}` }));
    expect(applyAdjustmentAction(full, { action: 'addAdjustment', amount: 1, note: 'x' }, NOW, 'n'))
      .toEqual({ ok: false, status: 409, error: 'adjustment limit reached (120)' });

    const edited = applyAdjustmentAction(full, { action: 'editAdjustment', adjustmentId: 'a5', amount: 2, note: 'y' }, NOW, 'n');
    expect(edited.ok).toBe(true);
    const deleted = applyAdjustmentAction(full, { action: 'deleteAdjustment', adjustmentId: 'a5' }, NOW, 'n');
    expect(deleted.ok && deleted.adjustments).toHaveLength(MAX_ADJUSTMENTS_PER_GOAL - 1);
  });

  it('add below the cap (119) succeeds', () => {
    const list = Array.from({ length: MAX_ADJUSTMENTS_PER_GOAL - 1 }, (_, i) => entry({ _id: `a${i}` }));
    const result = applyAdjustmentAction(list, { action: 'addAdjustment', amount: 1, note: 'x' }, NOW, 'n');
    expect(result.ok && result.adjustments).toHaveLength(MAX_ADJUSTMENTS_PER_GOAL);
  });

  it('edit replaces amount/note, bumps updatedAt, keeps _id/createdAt/position', () => {
    const current = [entry({ _id: 'a' }), entry({ _id: 'b' }), entry({ _id: 'c' })];
    const result = applyAdjustmentAction(current, { action: 'editAdjustment', adjustmentId: 'b', amount: -7.5, note: 'ใหม่' }, NOW, 'n');
    expect(result).toEqual({
      ok: true,
      adjustment: { _id: 'b', amount: -7.5, note: 'ใหม่', createdAt: EARLIER, updatedAt: NOW },
      adjustments: [current[0], { _id: 'b', amount: -7.5, note: 'ใหม่', createdAt: EARLIER, updatedAt: NOW }, current[2]],
    });
    expect(current[1]).toEqual(entry({ _id: 'b' }));
  });

  it('delete removes exactly that entry and returns no adjustment', () => {
    const current = [entry({ _id: 'a' }), entry({ _id: 'b' })];
    const result = applyAdjustmentAction(current, { action: 'deleteAdjustment', adjustmentId: 'a' }, NOW, 'n');
    expect(result).toEqual({ ok: true, adjustments: [current[1]] });
    expect(current).toHaveLength(2);
  });

  it('edit/delete with an unknown id → 404', () => {
    const current = [entry({ _id: 'a' })];
    const notFound = { ok: false, status: 404, error: 'Adjustment not found' };
    expect(applyAdjustmentAction(current, { action: 'editAdjustment', adjustmentId: 'z', amount: 1, note: 'x' }, NOW, 'n')).toEqual(notFound);
    expect(applyAdjustmentAction(current, { action: 'deleteAdjustment', adjustmentId: 'z' }, NOW, 'n')).toEqual(notFound);
  });
});
