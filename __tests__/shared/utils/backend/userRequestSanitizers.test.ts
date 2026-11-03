import { asPlainString, parseBearerToken } from '../../../../src/shared/utils/backend/userRequest';

describe('asPlainString (Mongo filter operand guard)', () => {
  it('returns strings unchanged', () => {
    expect(asPlainString('2026-11')).toBe('2026-11');
    expect(asPlainString('')).toBe('');
  });

  it.each([
    ['operator object', { $ne: null }],
    ['array', ['2026-11']],
    ['number', 202611],
    ['null', null],
    ['undefined', undefined],
    ['boolean', true]
  ])('rejects %s so it can never become a query operator', (_label, value) => {
    expect(asPlainString(value)).toBeUndefined();
  });
});

describe('parseBearerToken (no backtracking regex)', () => {
  it('extracts and trims the token, case-insensitive scheme', () => {
    expect(parseBearerToken('Bearer abc123')).toBe('abc123');
    expect(parseBearerToken('bearer   abc123  ')).toBe('abc123');
    expect(parseBearerToken('BEARER\tabc')).toBe('abc');
  });

  it('keeps the old shape rules', () => {
    expect(parseBearerToken('Bearer')).toBeNull();
    expect(parseBearerToken('Bearer ')).toBeNull();
    expect(parseBearerToken('Basic abc')).toBeNull();
    expect(parseBearerToken('Bearerabc')).toBeNull();
    expect(parseBearerToken('')).toBeNull();
  });

  it('stays fast on a long whitespace run (the polynomial-ReDoS input)', () => {
    const hostile = `Bearer${' '.repeat(200000)}x\n`;
    const started = Date.now();
    parseBearerToken(hostile);
    expect(Date.now() - started).toBeLessThan(200);
  });
});
