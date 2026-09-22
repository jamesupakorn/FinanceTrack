import {
  OT_MULTIPLIERS,
  LEGACY_OVERTIME_KEYS,
  LEGACY_OVERTIME_LABELS,
  getSalaryHourlyRate,
  calculateOvertimeRowAmount,
  calculateOvertimeTotal,
  normaliseOvertimeRows,
  extractLegacyOvertimeRows,
  stripLegacyOvertimeKeys
} from '../../../src/shared/utils/overtimeUtils';
import { calculateSalarySummary } from '../../../src/shared/utils/backend/apiUtils';

const row = (hours, multiplier, id = 'ot_test') => ({ id, hours, multiplier });

describe('OT_MULTIPLIERS', () => {
  it('is exactly the four statutory multipliers (BR-OT-003)', () => {
    expect(OT_MULTIPLIERS).toEqual([1, 1.5, 2, 3]);
  });
});

describe('getSalaryHourlyRate', () => {
  it('divides by the real calendar length of a 30-day month', () => {
    expect(getSalaryHourlyRate(30000, '2026-09')).toBe(125);
  });

  it('never rounds the rate (28-day February)', () => {
    expect(getSalaryHourlyRate(30000, '2026-02')).toBeCloseTo(133.92857142857142, 10);
  });

  it('uses 29 days in a leap February', () => {
    expect(getSalaryHourlyRate(30000, '2028-02')).toBeCloseTo(129.31034482758622, 10);
  });

  it('reads a salary stored as a string, like calculateSalarySummary does (A-3)', () => {
    expect(getSalaryHourlyRate('30000', '2026-09')).toBe(125);
  });

  it('returns 0 for a zero or negative salary', () => {
    expect(getSalaryHourlyRate(0, '2026-09')).toBe(0);
    expect(getSalaryHourlyRate(-5000, '2026-09')).toBe(0);
  });

  it('returns 0 — never NaN — for a non-finite salary', () => {
    expect(getSalaryHourlyRate(NaN, '2026-09')).toBe(0);
    expect(getSalaryHourlyRate(Infinity, '2026-09')).toBe(0);
    expect(getSalaryHourlyRate(undefined, '2026-09')).toBe(0);
  });

  it('returns 0 for a missing or malformed month key (edge case 9)', () => {
    expect(getSalaryHourlyRate(30000, '')).toBe(0);
    expect(getSalaryHourlyRate(30000, '2026-9')).toBe(0);
    expect(getSalaryHourlyRate(30000, 'garbage')).toBe(0);
    expect(getSalaryHourlyRate(30000, null)).toBe(0);
    expect(getSalaryHourlyRate(30000, '2026-13')).toBe(0);
  });
});

describe('calculateOvertimeRowAmount — spec worked examples E1–E7', () => {
  it('E1: 30,000 / 2026-09 (30d) × 1.5 × 10h → 1,875', () => {
    expect(calculateOvertimeRowAmount(row(10, 1.5), getSalaryHourlyRate(30000, '2026-09'))).toBe(1875);
  });

  it('E2: 30,000 / 2026-02 (28d) × 1.5 × 10h → 2,009', () => {
    expect(calculateOvertimeRowAmount(row(10, 1.5), getSalaryHourlyRate(30000, '2026-02'))).toBe(2009);
  });

  it('E3: 30,000 / 2028-02 (29d) × 1.5 × 10h → 1,940', () => {
    expect(calculateOvertimeRowAmount(row(10, 1.5), getSalaryHourlyRate(30000, '2028-02'))).toBe(1940);
  });

  it('E4: an exact .5 rounds half-up — 562.5 → 563, not 562 (D-3)', () => {
    expect(calculateOvertimeRowAmount(row(3, 1.5), getSalaryHourlyRate(30000, '2026-09'))).toBe(563);
  });

  it('E5: 25,500 / 2027-02 (28d) × 3 × 7.5h → 2,561', () => {
    expect(calculateOvertimeRowAmount(row(7.5, 3), getSalaryHourlyRate(25500, '2027-02'))).toBe(2561);
  });

  it('E6: salary 0/empty → 0 for any hours and multiplier', () => {
    expect(calculateOvertimeRowAmount(row(10, 3), getSalaryHourlyRate(0, '2026-09'))).toBe(0);
    expect(calculateOvertimeRowAmount(row(10, 3), getSalaryHourlyRate('', '2026-09'))).toBe(0);
  });

  it('E7: 0 hours → 0 (the row still exists, it is just worth nothing)', () => {
    expect(calculateOvertimeRowAmount(row(0, 2), getSalaryHourlyRate(30000, '2026-09'))).toBe(0);
  });
});

describe('calculateOvertimeRowAmount — rounding discriminators (AC-OT-03)', () => {
  const rate = getSalaryHourlyRate(30000, '2026-02');

  it('does not round the hourly rate up to 134 first (would give 2,010)', () => {
    expect(calculateOvertimeRowAmount(row(10, 1.5), rate)).not.toBe(2010);
  });

  it('does not round the hourly rate to 133.5 first (would give 2,003)', () => {
    expect(calculateOvertimeRowAmount(row(10, 1.5), rate)).not.toBe(2003);
  });

  it('produces four different amounts for 28/29/30/31-day months (AC-OT-02)', () => {
    const amountFor = (monthKey) =>
      calculateOvertimeRowAmount(row(10, 1.5), getSalaryHourlyRate(30000, monthKey));
    const amounts = [
      amountFor('2026-02'), // 28 days
      amountFor('2028-02'), // 29 days
      amountFor('2026-09'), // 30 days
      amountFor('2026-01') // 31 days
    ];
    expect(amounts).toEqual([2009, 1940, 1875, 1815]);
    expect(new Set(amounts).size).toBe(4);
  });
});

describe('calculateOvertimeRowAmount — robustness', () => {
  const rate = getSalaryHourlyRate(30000, '2026-09');

  it('accepts hours held as a raw string while typing (K14)', () => {
    expect(calculateOvertimeRowAmount(row('10', 1.5), rate)).toBe(1875);
    expect(calculateOvertimeRowAmount(row('7.5', 1.5), rate)).toBe(1406);
  });

  it('treats non-numeric hours as 0 (edge case 4)', () => {
    expect(calculateOvertimeRowAmount(row('abc', 1.5), rate)).toBe(0);
    expect(calculateOvertimeRowAmount(row('', 1.5), rate)).toBe(0);
  });

  it('never produces a negative amount from negative hours (AC-OT-07)', () => {
    expect(calculateOvertimeRowAmount(row(-10, 1.5), rate)).toBe(0);
  });

  it('coerces an invalid multiplier instead of producing NaN', () => {
    expect(calculateOvertimeRowAmount(row(10, 'x'), rate)).toBe(1250);
  });

  it('returns 0 for a missing or non-object row', () => {
    expect(calculateOvertimeRowAmount(null, rate)).toBe(0);
    expect(calculateOvertimeRowAmount(undefined, rate)).toBe(0);
  });

  it('returns 0 for a non-finite hourly rate (AC-OT-08)', () => {
    expect(calculateOvertimeRowAmount(row(10, 1.5), NaN)).toBe(0);
    expect(calculateOvertimeRowAmount(row(10, 1.5), Infinity)).toBe(0);
  });
});

describe('calculateOvertimeTotal', () => {
  it('sums already-rounded rows, not the rounding of the sum (BR-OT-004)', () => {
    // 562.5 + 562.5 → 563 + 563 = 1126, not round(1125) = 1125
    const rows = [row(3, 1.5, 'a'), row(3, 1.5, 'b')];
    expect(calculateOvertimeTotal(rows, 30000, '2026-09')).toBe(1126);
  });

  it('matches the E1 + E5 sum of the spec worked examples', () => {
    expect(calculateOvertimeTotal([row(10, 1.5, 'a')], 30000, '2026-09')).toBe(1875);
    expect(calculateOvertimeTotal([row(7.5, 3, 'b')], 25500, '2027-02')).toBe(2561);
  });

  it('reproduces the DATA_MODEL document example (1,875 + 2,813)', () => {
    const rows = [row(10, 1.5, 'a'), row(7.5, 3, 'b')];
    expect(calculateOvertimeTotal(rows, 30000, '2026-09')).toBe(4688);
  });

  it('returns 0 for an empty list, a non-array, or a missing month', () => {
    expect(calculateOvertimeTotal([], 30000, '2026-09')).toBe(0);
    expect(calculateOvertimeTotal(null, 30000, '2026-09')).toBe(0);
    expect(calculateOvertimeTotal('garbage', 30000, '2026-09')).toBe(0);
    expect(calculateOvertimeTotal([row(10, 1.5)], 30000, undefined)).toBe(0);
  });

  it('returns an integer for every reachable input (AC-OT-08)', () => {
    const total = calculateOvertimeTotal([row(3, 1.5, 'a'), row('2.25', 3, 'b')], 30000, '2026-02');
    expect(Number.isInteger(total)).toBe(true);
    expect(Object.is(total, -0)).toBe(false);
  });
});

describe('normaliseOvertimeRows', () => {
  it('keeps only id, hours and multiplier — a client-sent amount is dropped (AC-OT-22)', () => {
    const result = normaliseOvertimeRows([
      { id: 'ot_1', hours: 10, multiplier: 1.5, amount: 99999, hourlyRate: 125 }
    ]);
    expect(result).toEqual([{ id: 'ot_1', hours: 10, multiplier: 1.5 }]);
  });

  it('returns [] for garbage, null, undefined and objects (edge case 23)', () => {
    expect(normaliseOvertimeRows('garbage')).toEqual([]);
    expect(normaliseOvertimeRows(null)).toEqual([]);
    expect(normaliseOvertimeRows(undefined)).toEqual([]);
    expect(normaliseOvertimeRows({ id: 'ot_1' })).toEqual([]);
  });

  it('drops malformed elements inside the array', () => {
    expect(normaliseOvertimeRows([null, 'x', 5, ['a'], { id: 'ot_1', hours: 2, multiplier: 2 }]))
      .toEqual([{ id: 'ot_1', hours: 2, multiplier: 2 }]);
  });

  it('coerces an out-of-set multiplier to the nearest valid one (edge case 24)', () => {
    expect(normaliseOvertimeRows([{ id: 'a', hours: 1, multiplier: 2.5 }])[0].multiplier).toBe(2);
    expect(normaliseOvertimeRows([{ id: 'a', hours: 1, multiplier: 2.9 }])[0].multiplier).toBe(3);
    expect(normaliseOvertimeRows([{ id: 'a', hours: 1, multiplier: 10 }])[0].multiplier).toBe(3);
    expect(normaliseOvertimeRows([{ id: 'a', hours: 1, multiplier: 0.2 }])[0].multiplier).toBe(1);
  });

  it('defaults a missing or non-numeric multiplier to 1', () => {
    expect(normaliseOvertimeRows([{ id: 'a', hours: 1 }])[0].multiplier).toBe(1);
    expect(normaliseOvertimeRows([{ id: 'a', hours: 1, multiplier: 'x' }])[0].multiplier).toBe(1);
  });

  it('accepts a numeric-string multiplier', () => {
    expect(normaliseOvertimeRows([{ id: 'a', hours: 1, multiplier: '1.5' }])[0].multiplier).toBe(1.5);
  });

  it('clamps hours to [0, 744] and never negates a negative (edge case 3)', () => {
    expect(normaliseOvertimeRows([{ id: 'a', hours: -8, multiplier: 1 }])[0].hours).toBe(0);
    expect(normaliseOvertimeRows([{ id: 'a', hours: 1000, multiplier: 1 }])[0].hours).toBe(744);
    expect(normaliseOvertimeRows([{ id: 'a', hours: 7.5, multiplier: 1 }])[0].hours).toBe(7.5);
  });

  it('coerces non-finite or non-numeric hours to 0', () => {
    expect(normaliseOvertimeRows([{ id: 'a', hours: NaN, multiplier: 1 }])[0].hours).toBe(0);
    expect(normaliseOvertimeRows([{ id: 'a', hours: 'abc', multiplier: 1 }])[0].hours).toBe(0);
    expect(normaliseOvertimeRows([{ id: 'a', multiplier: 1 }])[0].hours).toBe(0);
  });

  it('converts a numeric-string hours value to a number for storage', () => {
    expect(normaliseOvertimeRows([{ id: 'a', hours: '7.5', multiplier: 1 }])[0].hours).toBe(7.5);
  });

  it('generates an id when the client omits one', () => {
    const [result] = normaliseOvertimeRows([{ hours: 1, multiplier: 1 }]);
    expect(typeof result.id).toBe('string');
    expect(result.id).toMatch(/^ot_/);
  });

  it('keeps a zero-hour row — a row the user added must not vanish (K12)', () => {
    expect(normaliseOvertimeRows([{ id: 'a', hours: 0, multiplier: 3 }]))
      .toEqual([{ id: 'a', hours: 0, multiplier: 3 }]);
  });

  it('does not cap the number of rows (A-11)', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ id: `ot_${i}`, hours: 1, multiplier: 1 }));
    expect(normaliseOvertimeRows(many)).toHaveLength(250);
  });
});

describe('extractLegacyOvertimeRows', () => {
  it('returns one row per legacy key with a positive value, in fixed order (edge case 12)', () => {
    const income = {
      salary: 30000,
      overtime_other: 100,
      overtime_3x: 300,
      overtime_1x: 100,
      overtime_2x: 200,
      overtime_1_5x: 150
    };
    expect(extractLegacyOvertimeRows(income).map((r) => r.key)).toEqual([...LEGACY_OVERTIME_KEYS]);
  });

  it('builds id, key, label and amount from the income map', () => {
    expect(extractLegacyOvertimeRows({ overtime_1_5x: 3200 })).toEqual([
      {
        id: 'legacy_overtime_1_5x',
        key: 'overtime_1_5x',
        label: LEGACY_OVERTIME_LABELS.overtime_1_5x,
        amount: 3200
      }
    ]);
  });

  it('skips keys whose value is 0, negative or absent (edge case 13)', () => {
    expect(extractLegacyOvertimeRows({ overtime_1x: 0, overtime_2x: -50, salary: 30000 })).toEqual([]);
  });

  it('parses an amount stored as a string', () => {
    expect(extractLegacyOvertimeRows({ overtime_2x: '1200' })[0].amount).toBe(1200);
  });

  // S-2: pin การ "อ่านเลขแบบเดียวกับ calculateSalarySummary" ไม่ใช่การจัดรูปแบบที่อยากได้
  // '1,200' → 1 เพราะ apiUtils.ts:15 ใช้ parseFloat(String(val)) เหมือนกัน ยอดที่แสดงจึงเท่ากับยอดที่เก็บเสมอ
  // (invariant D-1) — ถ้า "แก้" ให้ตัดลูกน้ำออกที่นี่ที่เดียว ยอดสองฝั่งจะไม่ตรงกันทันที
  it('parses a comma-formatted amount exactly as calculateSalarySummary does, not as the user would read it (D-1 parity)', () => {
    const income = { overtime_1x: '1,200' };

    expect(extractLegacyOvertimeRows(income)[0].amount).toBe(1);
    // ฝั่ง summary ก็ได้ 1 เท่ากัน — ผิดเหมือนกันแต่ตรงกัน จึงไม่เกิดยอดรวมที่ไม่เท่ากับแถวที่เห็น (K16)
    expect(calculateSalarySummary({ income }).total_income).toBe(1);
  });

  it('prefers a user-set label from income.__labels over the canonical Thai label', () => {
    const income = { overtime_1x: 500, __labels: { overtime_1x: 'OT กะดึก' } };
    expect(extractLegacyOvertimeRows(income)[0].label).toBe('OT กะดึก');
  });

  it('falls back to the canonical label when __labels is missing or blank', () => {
    const income = { overtime_1x: 500, __labels: { overtime_1x: '   ' } };
    expect(extractLegacyOvertimeRows(income)[0].label).toBe(LEGACY_OVERTIME_LABELS.overtime_1x);
  });

  it('does not mutate the income map — the legacy keys stay put (D-1)', () => {
    const income = { salary: 30000, overtime_1_5x: 3200 };
    extractLegacyOvertimeRows(income);
    expect(income).toEqual({ salary: 30000, overtime_1_5x: 3200 });
  });

  it('returns [] for a missing or non-object income', () => {
    expect(extractLegacyOvertimeRows(null)).toEqual([]);
    expect(extractLegacyOvertimeRows(undefined)).toEqual([]);
    expect(extractLegacyOvertimeRows([])).toEqual([]);
  });
});

describe('stripLegacyOvertimeKeys', () => {
  it('removes every legacy OT key and keeps everything else (V-3)', () => {
    const income = {
      salary: 30000,
      bonus: 5000,
      overtime_1x: 100,
      overtime_1_5x: 150,
      overtime_2x: 200,
      overtime_3x: 300,
      overtime_other: 400
    };
    expect(stripLegacyOvertimeKeys(income)).toEqual({ salary: 30000, bonus: 5000 });
  });

  it('strips the matching __labels entries but keeps the others', () => {
    const income = {
      salary: 30000,
      overtime_1_5x: 150,
      __labels: { salary: 'เงินเดือน', overtime_1_5x: 'ค่าล่วงเวลา 1.5 เท่า' }
    };
    expect(stripLegacyOvertimeKeys(income)).toEqual({
      salary: 30000,
      __labels: { salary: 'เงินเดือน' }
    });
  });

  it('does not mutate the source income map', () => {
    const income = { salary: 30000, overtime_1x: 100, __labels: { overtime_1x: 'x' } };
    stripLegacyOvertimeKeys(income);
    expect(income).toEqual({ salary: 30000, overtime_1x: 100, __labels: { overtime_1x: 'x' } });
  });

  it('returns {} for a missing or non-object income', () => {
    expect(stripLegacyOvertimeKeys(null)).toEqual({});
    expect(stripLegacyOvertimeKeys(undefined)).toEqual({});
    expect(stripLegacyOvertimeKeys('garbage')).toEqual({});
  });
});
