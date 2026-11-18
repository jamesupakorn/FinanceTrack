// Savings loan & withdrawal S3 — Asia/Bangkok "current month" helper (C-S3-13, D-SLW-22/23).
import { toBangkokMonthDay } from '../../../src/shared/utils/savingsLedger';

describe('toBangkokMonthDay (C-S3-13)', () => {
  it('returns the Bangkok month at YYYY-MM-01T00:30+07:00, while UTC is still the previous month', () => {
    const now = '2026-12-01T00:30:00+07:00';
    expect(new Date(now).toISOString()).toBe('2026-11-30T17:30:00.000Z');
    expect(toBangkokMonthDay(now)).toEqual({ monthKey: '2026-12', day: 1 });
  });

  it('crosses the year boundary in Bangkok before UTC does', () => {
    expect(toBangkokMonthDay('2027-01-01T00:30:00+07:00')).toEqual({ monthKey: '2027-01', day: 1 });
    expect(toBangkokMonthDay('2026-12-31T16:59:59.999Z')).toEqual({ monthKey: '2026-12', day: 31 });
    expect(toBangkokMonthDay('2026-12-31T17:00:00.000Z')).toEqual({ monthKey: '2027-01', day: 1 });
  });

  it('keeps the same day when UTC and Bangkok agree', () => {
    expect(toBangkokMonthDay('2026-11-18T05:00:00.000Z')).toEqual({ monthKey: '2026-11', day: 18 });
  });

  it('returns the last day of the month just before Bangkok midnight', () => {
    expect(toBangkokMonthDay('2026-11-30T23:59:59+07:00')).toEqual({ monthKey: '2026-11', day: 30 });
    expect(toBangkokMonthDay('2028-02-29T12:00:00+07:00')).toEqual({ monthKey: '2028-02', day: 29 });
  });

  it('zero-pads single-digit months', () => {
    expect(toBangkokMonthDay('2026-03-15T12:00:00+07:00')?.monthKey).toBe('2026-03');
  });

  it('accepts Date, ISO string and epoch-millisecond inputs alike', () => {
    const iso = '2026-12-01T00:30:00+07:00';
    const expected = { monthKey: '2026-12', day: 1 };
    expect(toBangkokMonthDay(new Date(iso))).toEqual(expected);
    expect(toBangkokMonthDay(new Date(iso).getTime())).toEqual(expected);
    expect(toBangkokMonthDay(new Date(iso).toISOString())).toEqual(expected);
  });

  it('returns null for unparseable input', () => {
    expect(toBangkokMonthDay('not-a-date')).toBeNull();
    expect(toBangkokMonthDay(new Date(Number.NaN))).toBeNull();
    expect(toBangkokMonthDay(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
