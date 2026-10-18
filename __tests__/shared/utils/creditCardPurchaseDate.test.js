// Feature: credit-card-purchase-date-cycle — dispatch 1/4 (AC-PD-01..12) + dispatch 2/4 (AC-PD-13..19).
// Dispatch 2/4 adds `validatePlanInput`'s `purchaseDate` handling. plans.js/composePlan whitelist
// wiring and InstallmentPlanForm.js are out of scope here (steps 3 and 4).
const fs = require('fs');
const path = require('path');
const {
  isValidPurchaseDate,
  computeStartMonthFromPurchase,
  validatePlanInput,
  buildSchedule,
} = require('../../../src/shared/utils/creditCardUtils');

describe('computeStartMonthFromPurchase', () => {
  // AC-PD-01
  it('purchase day equal to statementDay stays in the purchase month, one day later moves to next month', () => {
    expect(computeStartMonthFromPurchase('2026-03-05', 5)).toBe('2026-03');
    expect(computeStartMonthFromPurchase('2026-03-06', 5)).toBe('2026-04');
  });

  // AC-PD-02 — R-1 regression guard: EOM must never be compared numerically.
  it('EOM card always resolves to the purchase month, for every day of the month, case-insensitively', () => {
    for (let d = 1; d <= 31; d += 1) {
      const dd = String(d).padStart(2, '0');
      expect(computeStartMonthFromPurchase(`2026-01-${dd}`, 'EOM')).toBe('2026-01');
    }
    expect(computeStartMonthFromPurchase('2026-03-15', 'eom')).toBe('2026-03');
  });

  // AC-PD-03 — clamp of an out-of-range statementDay against short months.
  it('clamps statementDay to the number of days in the purchase month', () => {
    expect(computeStartMonthFromPurchase('2026-02-28', 31)).toBe('2026-02');
    expect(computeStartMonthFromPurchase('2028-02-29', 31)).toBe('2028-02'); // leap year
    expect(computeStartMonthFromPurchase('2026-04-30', 31)).toBe('2026-04');
    expect(computeStartMonthFromPurchase('2026-02-28', 30)).toBe('2026-02');
  });

  // AC-PD-04 — no clamp effect when statementDay already fits in the month.
  it('does not clamp when statementDay already fits inside the month', () => {
    expect(computeStartMonthFromPurchase('2026-02-28', 27)).toBe('2026-03');
  });

  // AC-PD-05 — year rollover through addMonths.
  it('rolls over the year via addMonths', () => {
    expect(computeStartMonthFromPurchase('2026-12-26', 25)).toBe('2027-01');
    expect(computeStartMonthFromPurchase('2026-12-25', 25)).toBe('2026-12');
  });

  // AC-PD-06 — numeric string statementDay.
  it('treats a numeric-string statementDay the same as a number', () => {
    expect(computeStartMonthFromPurchase('2026-01-21', '20')).toBe('2026-02');
    expect(computeStartMonthFromPurchase('2026-01-20', '20')).toBe('2026-01');
  });

  // AC-PD-07 — absent statementDay behaves as EOM (N-3).
  it('treats an absent statementDay as EOM', () => {
    expect(computeStartMonthFromPurchase('2026-05-15', undefined)).toBe('2026-05');
    expect(computeStartMonthFromPurchase('2026-05-15', null)).toBe('2026-05');
    expect(computeStartMonthFromPurchase('2026-05-15', '')).toBe('2026-05');
  });

  // AC-PD-08 — invalid statementDay returns ''.
  it('returns empty string for an invalid statementDay', () => {
    expect(computeStartMonthFromPurchase('2026-05-15', 0)).toBe('');
    expect(computeStartMonthFromPurchase('2026-05-15', 32)).toBe('');
    expect(computeStartMonthFromPurchase('2026-05-15', 'abc')).toBe('');
    expect(computeStartMonthFromPurchase('2026-05-15', NaN)).toBe('');
  });

  // AC-PD-09 — invalid purchaseDate returns ''.
  it('returns empty string for an invalid purchaseDate', () => {
    expect(computeStartMonthFromPurchase('2026-02-30', 5)).toBe('');
    expect(computeStartMonthFromPurchase('2026-13-01', 5)).toBe('');
    expect(computeStartMonthFromPurchase('2026-1-5', 5)).toBe('');
    expect(computeStartMonthFromPurchase('', 5)).toBe('');
    expect(computeStartMonthFromPurchase(null, 5)).toBe('');
    expect(computeStartMonthFromPurchase(20260105, 5)).toBe('');
  });

  // AC-PD-10 — review + runtime check: no numeric comparison of statementDay before the EOM guard.
  // Reads the live .ts source (not the compiled function) so the check survives any transpiler's
  // import-binding rewrite of `isEndOfMonthDueDay`.
  it('source order check: computeStartMonthFromPurchase has no Number(statementDay) before isEndOfMonthDueDay(', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../src/shared/utils/creditCardBasics.ts'),
      'utf8'
    );
    const fnStart = source.indexOf('export function computeStartMonthFromPurchase');
    const fnEnd = source.indexOf('\n}\n', fnStart);
    const fnBody = source.slice(fnStart, fnEnd);
    const eomIndex = fnBody.indexOf('isEndOfMonthDueDay(');
    const numberIndex = fnBody.indexOf('Number(statementDay)');
    expect(fnStart).toBeGreaterThan(-1);
    expect(eomIndex).toBeGreaterThan(-1);
    // either Number(statementDay) never appears, or it appears strictly after the EOM guard
    expect(numberIndex === -1 || numberIndex > eomIndex).toBe(true);
  });
});

describe('isValidPurchaseDate', () => {
  // AC-PD-11
  it('rejects malformed or impossible dates', () => {
    expect(isValidPurchaseDate('2026-02-30')).toBe(false);
    expect(isValidPurchaseDate('2026-02-29')).toBe(false); // not a leap year
    expect(isValidPurchaseDate('2026-04-31')).toBe(false);
    expect(isValidPurchaseDate('2026-00-10')).toBe(false);
    expect(isValidPurchaseDate('2026-01-00')).toBe(false);
    expect(isValidPurchaseDate(' 2026-01-01')).toBe(false);
    expect(isValidPurchaseDate('2026-01-01T00:00:00Z')).toBe(false);
    expect(isValidPurchaseDate(20260101)).toBe(false);
    expect(isValidPurchaseDate(null)).toBe(false);
  });

  // AC-PD-12
  it('accepts valid calendar dates, including a leap-year Feb 29', () => {
    expect(isValidPurchaseDate('2028-02-29')).toBe(true);
    expect(isValidPurchaseDate('2026-12-31')).toBe(true);
    expect(isValidPurchaseDate('2026-01-01')).toBe(true);
  });
});

describe('validatePlanInput — purchaseDate handling (dispatch 2/4)', () => {
  // A minimal, otherwise-valid plan input. No purchaseDate here on purpose — every AC-PD-13..19
  // case adds/overrides only what it needs, so a mistake in one field cannot mask a purchaseDate
  // assertion in another.
  const VALID_BASE = {
    cardId: 'card-1',
    itemName: 'ของทดสอบ',
    totalPrice: 1200,
    months: 3,
    startMonth: '2026-01',
    interestMode: 'manual',
    manualFeePerMonth: 0
  };

  // AC-PD-13
  it('no purchaseDate, no options -> valid, no error key, value.purchaseDate is empty string', () => {
    const result = validatePlanInput(VALID_BASE);
    expect(result.valid).toBe(true);
    expect('purchaseDate' in result.errors).toBe(false);
    expect(result.value.purchaseDate).toBe('');
  });

  // AC-PD-14
  it('same input with requirePurchaseDate: true -> errors.purchaseDate, invalid', () => {
    const result = validatePlanInput(VALID_BASE, { requirePurchaseDate: true });
    expect(result.errors.purchaseDate).toBe('กรุณาเลือกวันที่ซื้อ');
    expect(result.valid).toBe(false);
  });

  // AC-PD-15
  it('an impossible calendar date is always rejected, required or not, and value is omitted', () => {
    const notRequired = validatePlanInput({ ...VALID_BASE, purchaseDate: '2026-02-30' });
    expect(notRequired.errors.purchaseDate).toBe('วันที่ซื้อไม่ถูกต้อง');
    expect(notRequired.value.purchaseDate).toBe('');

    const required = validatePlanInput(
      { ...VALID_BASE, purchaseDate: '2026-02-30' },
      { requirePurchaseDate: true }
    );
    expect(required.errors.purchaseDate).toBe('วันที่ซื้อไม่ถูกต้อง');
    expect(required.value.purchaseDate).toBe('');
  });

  // AC-PD-16
  it('a valid purchaseDate passes through to value with no error', () => {
    const result = validatePlanInput({ ...VALID_BASE, purchaseDate: '2026-01-20' });
    expect(result.value.purchaseDate).toBe('2026-01-20');
    expect('purchaseDate' in result.errors).toBe(false);
    expect(result.valid).toBe(true);
  });

  // AC-PD-17 — purchaseDate and startMonth are never coupled by the validator.
  it('purchaseDate and startMonth may disagree without any error; startMonth is stored as sent', () => {
    const result = validatePlanInput({
      ...VALID_BASE,
      purchaseDate: '2026-01-20',
      startMonth: '2026-03'
    });
    expect(result.valid).toBe(true);
    expect(result.value.startMonth).toBe('2026-03');
    expect(result.value.purchaseDate).toBe('2026-01-20');
  });

  // AC-PD-18 — startMonth's own validation path is byte-for-byte unchanged.
  it('an invalid startMonth still gives exactly the pre-existing error message', () => {
    const result = validatePlanInput({ ...VALID_BASE, startMonth: '2026-1' });
    expect(result.errors.startMonth).toBe('กรุณาเลือกเดือนเริ่มผ่อน');
  });

  // AC-PD-19 — the schedule never depends on purchaseDate.
  it('buildSchedule output is identical whether or not purchaseDate is present', () => {
    const withDate = validatePlanInput({ ...VALID_BASE, purchaseDate: '2026-01-20' }).value;
    const withoutDate = validatePlanInput(VALID_BASE).value;
    expect(buildSchedule(withDate)).toEqual(buildSchedule(withoutDate));
  });
});
