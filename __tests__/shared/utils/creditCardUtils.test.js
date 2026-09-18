const { validateCardInput, buildRevolvingCycles } = require('../../../src/shared/utils/creditCardUtils');

// TD-H02 creditCardUtils.js split (sub-slice 1): the file-split rewrite dropped
// END_OF_MONTH_DUE_DAY's import, which only threw at runtime on this exact path
// (invalid, non-empty dueDay/statementDay -> normaliseDayValue returns null ->
// validateCardInput's null branch reads the then-undefined name). Locking it in.
describe('validateCardInput — invalid due-day fallback (regression)', () => {
  it('falls back statementDay/dueDay to EOM when given an invalid non-empty value, without throwing', () => {
    const result = validateCardInput({
      name: 'test',
      dueDay: 'not-a-number',
      statementDay: 'not-a-number',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.statementDay).toBeDefined();
    expect(result.errors.dueDay).toBeDefined();
    expect(result.value.statementDay).toBe('EOM');
    expect(result.value.dueDay).toBe('EOM');
  });

  it('accepts explicit end-of-month input for dueDay/statementDay', () => {
    const result = validateCardInput({
      name: 'test',
      dueDay: 'EOM',
      statementDay: 'EOM',
    });

    expect(result.errors.dueDay).toBeUndefined();
    expect(result.errors.statementDay).toBeUndefined();
    expect(result.value.dueDay).toBe('EOM');
    expect(result.value.statementDay).toBe('EOM');
  });
});

// TD-H02 creditCardUtils.js split (sub-slice 3): buildRevolvingCycles attaches a
// non-enumerable `truncated` flag via Object.defineProperty. No existing test guards
// enumerable:false directly — a mutation test during review confirmed the full
// revolving.test.js suite stays green even if this flag silently flips to enumerable.
// Locking in the invariant explicitly, since it's load-bearing for JSON.stringify/
// spread/iteration (a `truncated` key must never appear in those).
describe('buildRevolvingCycles — truncated flag stays non-enumerable (regression)', () => {
  it('does not expose truncated via Object.keys, JSON.stringify, or spread', () => {
    const cycles = buildRevolvingCycles({ id: 'card1' }, [], {});

    const descriptor = Object.getOwnPropertyDescriptor(cycles, 'truncated');
    expect(descriptor).toBeDefined();
    expect(descriptor.enumerable).toBe(false);

    expect(Object.keys(cycles)).not.toContain('truncated');
    expect(JSON.parse(JSON.stringify(cycles)).truncated).toBeUndefined();
    expect([...cycles].truncated).toBeUndefined();

    // The flag itself must still be readable directly, just not enumerable.
    expect(typeof cycles.truncated).toBe('boolean');
  });
});
