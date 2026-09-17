const { validateCardInput } = require('../../../src/shared/utils/creditCardUtils');

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
