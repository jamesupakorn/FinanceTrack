export {};

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

// Feature: credit-card-bank-issuer-logo — AC-BI-07..10.
// bankIssuer is additive: a valid catalog key is kept as-is (including the literal 'other'), an
// invalid/unknown/missing one is OMITTED from `value` (never coerced to 'other' — pitfall #1 /
// edge case 8: coercing would silently migrate every legacy card on its next unrelated edit).
describe('validateCardInput — bankIssuer (AC-BI-07..10)', () => {
  it('AC-BI-07: keeps a valid named issuer key', () => {
    const result = validateCardInput({ name: 'x', bankIssuer: 'kbank' });

    expect(result.value.bankIssuer).toBe('kbank');
  });

  it('AC-BI-08: omits bankIssuer (no error, valid=true) for absent/invalid values', () => {
    const cases = [undefined, '', null, 'citi', 'KBANK', 'constructor', 42];

    cases.forEach((bankIssuer) => {
      const input = bankIssuer === undefined ? { name: 'x' } : { name: 'x', bankIssuer };
      const result = validateCardInput(input);

      expect('bankIssuer' in result.value).toBe(false);
      expect(result.errors.bankIssuer).toBeUndefined();
      expect(result.valid).toBe(true);
    });
  });

  it('AC-BI-09: keeps the explicit literal "other" (a valid catalog key)', () => {
    const result = validateCardInput({ name: 'x', bankIssuer: 'other' });

    expect(result.value.bankIssuer).toBe('other');
  });

  it('AC-BI-10: color accepts a brand hex, and an off-palette hex still falls back to CARD_COLORS[0]', () => {
    const brandResult = validateCardInput({ name: 'x', color: '#138f2d' });
    expect(brandResult.value.color).toBe('#138f2d');

    const offPaletteResult = validateCardInput({ name: 'x', color: '#123456' });
    expect(offPaletteResult.value.color).toBe('#5d5bff');
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
    expect(descriptor!.enumerable).toBe(false);

    expect(Object.keys(cycles)).not.toContain('truncated');
    expect(JSON.parse(JSON.stringify(cycles)).truncated).toBeUndefined();
    expect(([...cycles] as unknown[] & { truncated?: boolean }).truncated).toBeUndefined();

    // The flag itself must still be readable directly, just not enumerable.
    expect(typeof cycles.truncated).toBe('boolean');
  });
});