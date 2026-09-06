import {
  normalizeDueDayValue,
  isEndOfMonthDueDay,
  resolveDueDayForMonth,
  formatMonthKeyTH
} from '../../../src/shared/utils/dateUtils';

describe('normalizeDueDayValue', () => {
  it('accepts a valid numeric string', () => {
    expect(normalizeDueDayValue('10')).toBe(10);
  });

  it('accepts a valid number', () => {
    expect(normalizeDueDayValue(15)).toBe(15);
  });

  it('rejects 0 (below range)', () => {
    expect(normalizeDueDayValue(0)).toBeNull();
  });

  it('rejects 32 (above range)', () => {
    expect(normalizeDueDayValue(32)).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(normalizeDueDayValue('')).toBeNull();
  });
});

describe('isEndOfMonthDueDay', () => {
  it('recognises the exact "EOM" sentinel', () => {
    expect(isEndOfMonthDueDay('EOM')).toBe(true);
  });

  it('is case-insensitive ("eom")', () => {
    expect(isEndOfMonthDueDay('eom')).toBe(true);
  });

  it('returns false for a plain numeric day', () => {
    expect(isEndOfMonthDueDay(15)).toBe(false);
  });
});

describe('resolveDueDayForMonth', () => {
  it('resolves EOM to the last day of a 28-day February', () => {
    expect(resolveDueDayForMonth('EOM', 28)).toBe(28);
  });

  it('clamps a numeric day beyond daysInMonth down to daysInMonth (31 in a 30-day month)', () => {
    expect(resolveDueDayForMonth(31, 30)).toBe(30);
  });

  it('returns null for invalid input', () => {
    expect(resolveDueDayForMonth('not-a-day', 30)).toBeNull();
  });
});

describe('formatMonthKeyTH', () => {
  it('formats a known month key into a Buddhist-era-year Thai label', () => {
    // 2024 (CE) + 543 = 2567 (BE); month index 0 → 'ม.ค.'
    expect(formatMonthKeyTH('2024-01')).toBe('ม.ค. 2567');
  });

  it('returns the input unchanged for a malformed month key (existing fallback behavior)', () => {
    expect(formatMonthKeyTH('not-a-month-key')).toBe('not-a-month-key');
  });
});
