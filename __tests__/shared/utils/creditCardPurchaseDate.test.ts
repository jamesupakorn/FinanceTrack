// Feature: credit-card-purchase-date-cycle — dispatch 1/4 (AC-PD-01..12) + dispatch 2/4 (AC-PD-13..19).
export {};

const fs: typeof import('fs') = require('fs');
const path: typeof import('path') = require('path');
const {
  isValidPurchaseDate,
  computeStartMonthFromPurchase,
  validatePlanInput,
  buildSchedule,
} = require('../../../src/shared/utils/creditCardUtils');

describe('computeStartMonthFromPurchase', () => {
  it('purchase day equal to statementDay stays in the purchase month, one day later moves to next month', () => {
    expect(computeStartMonthFromPurchase('2026-03-05', 5)).toBe('2026-03');
    expect(computeStartMonthFromPurchase('2026-03-06', 5)).toBe('2026-04');
  });

  it('EOM card always resolves to the purchase month, for every day of the month, case-insensitively', () => {
    for (let d = 1; d <= 31; d += 1) {
      const dd = String(d).padStart(2, '0');
      expect(computeStartMonthFromPurchase(`2026-01-${dd}`, 'EOM')).toBe('2026-01');
    }
    expect(computeStartMonthFromPurchase('2026-03-15', 'eom')).toBe('2026-03');
  });

  it('clamps statementDay to the number of days in the purchase month', () => {
    expect(computeStartMonthFromPurchase('2026-02-28', 31)).toBe('2026-02');
    expect(computeStartMonthFromPurchase('2028-02-29', 31)).toBe('2028-02');
    expect(computeStartMonthFromPurchase('2026-04-30', 31)).toBe('2026-04');
    expect(computeStartMonthFromPurchase('2026-02-28', 30)).toBe('2026-02');
  });

  it('does not clamp when statementDay already fits inside the month', () => {
    expect(computeStartMonthFromPurchase('2026-02-28', 27)).toBe('2026-03');
  });

  it('rolls over the year via addMonths', () => {
    expect(computeStartMonthFromPurchase('2026-12-26', 25)).toBe('2027-01');
    expect(computeStartMonthFromPurchase('2026-12-25', 25)).toBe('2026-12');
  });

  it('treats a numeric-string statementDay the same as a number', () => {
    expect(computeStartMonthFromPurchase('2026-01-21', '20')).toBe('2026-02');
    expect(computeStartMonthFromPurchase('2026-01-20', '20')).toBe('2026-01');
  });

  it('treats an absent statementDay as EOM', () => {
    expect(computeStartMonthFromPurchase('2026-05-15', undefined)).toBe('2026-05');
    expect(computeStartMonthFromPurchase('2026-05-15', null)).toBe('2026-05');
    expect(computeStartMonthFromPurchase('2026-05-15', '')).toBe('2026-05');
  });

  it('returns empty string for an invalid statementDay', () => {
    expect(computeStartMonthFromPurchase('2026-05-15', 0)).toBe('');
    expect(computeStartMonthFromPurchase('2026-05-15', 32)).toBe('');
    expect(computeStartMonthFromPurchase('2026-05-15', 'abc')).toBe('');
    expect(computeStartMonthFromPurchase('2026-05-15', NaN)).toBe('');
  });

  it('returns empty string for an invalid purchaseDate', () => {
    expect(computeStartMonthFromPurchase('2026-02-30', 5)).toBe('');
    expect(computeStartMonthFromPurchase('2026-13-01', 5)).toBe('');
    expect(computeStartMonthFromPurchase('2026-1-5', 5)).toBe('');
    expect(computeStartMonthFromPurchase('', 5)).toBe('');
    expect(computeStartMonthFromPurchase(null, 5)).toBe('');
    expect(computeStartMonthFromPurchase(20260105, 5)).toBe('');
  });

  it('source order check: computeStartMonthFromPurchase has no Number(statementDay) before isEndOfMonthDueDay(', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../../src/shared/utils/creditCardBasics.ts'), 'utf8');
    const fnStart = source.indexOf('export function computeStartMonthFromPurchase');
    const fnEnd = source.indexOf('\n}\n', fnStart);
    const fnBody = source.slice(fnStart, fnEnd);
    const eomIndex = fnBody.indexOf('isEndOfMonthDueDay(');
    const numberIndex = fnBody.indexOf('Number(statementDay)');
    expect(fnStart).toBeGreaterThan(-1);
    expect(eomIndex).toBeGreaterThan(-1);
    expect(numberIndex === -1 || numberIndex > eomIndex).toBe(true);
  });
});

describe('isValidPurchaseDate', () => {
  it('rejects malformed or impossible dates', () => {
    expect(isValidPurchaseDate('2026-02-30')).toBe(false);
    expect(isValidPurchaseDate('2026-02-29')).toBe(false);
    expect(isValidPurchaseDate('2026-04-31')).toBe(false);
    expect(isValidPurchaseDate('2026-00-10')).toBe(false);
    expect(isValidPurchaseDate('2026-01-00')).toBe(false);
    expect(isValidPurchaseDate(' 2026-01-01')).toBe(false);
    expect(isValidPurchaseDate('2026-01-01T00:00:00Z')).toBe(false);
    expect(isValidPurchaseDate(20260101)).toBe(false);
    expect(isValidPurchaseDate(null)).toBe(false);
  });

  it('accepts valid calendar dates, including a leap-year Feb 29', () => {
    expect(isValidPurchaseDate('2028-02-29')).toBe(true);
    expect(isValidPurchaseDate('2026-12-31')).toBe(true);
    expect(isValidPurchaseDate('2026-01-01')).toBe(true);
  });
});

describe('validatePlanInput — purchaseDate handling (dispatch 2/4)', () => {
  const VALID_BASE = {
    cardId: 'card-1',
    itemName: 'ของทดสอบ',
    totalPrice: 1200,
    months: 3,
    startMonth: '2026-01',
    interestMode: 'manual',
    manualFeePerMonth: 0
  };

  it('no purchaseDate, no options -> valid, no error key, value.purchaseDate is empty string', () => {
    const result = validatePlanInput(VALID_BASE);
    expect(result.valid).toBe(true);
    expect('purchaseDate' in result.errors).toBe(false);
    expect(result.value.purchaseDate).toBe('');
  });

  it('same input with requirePurchaseDate: true -> errors.purchaseDate, invalid', () => {
    const result = validatePlanInput(VALID_BASE, { requirePurchaseDate: true });
    expect(result.errors.purchaseDate).toBe('กรุณาเลือกวันที่ซื้อ');
    expect(result.valid).toBe(false);
  });

  it('an impossible calendar date is always rejected, required or not, and value is omitted', () => {
    const notRequired = validatePlanInput({ ...VALID_BASE, purchaseDate: '2026-02-30' });
    expect(notRequired.errors.purchaseDate).toBe('วันที่ซื้อไม่ถูกต้อง');
    expect(notRequired.value.purchaseDate).toBe('');
    const required = validatePlanInput({ ...VALID_BASE, purchaseDate: '2026-02-30' }, { requirePurchaseDate: true });
    expect(required.errors.purchaseDate).toBe('วันที่ซื้อไม่ถูกต้อง');
    expect(required.value.purchaseDate).toBe('');
  });

  it('a valid purchaseDate passes through to value with no error', () => {
    const result = validatePlanInput({ ...VALID_BASE, purchaseDate: '2026-01-20' });
    expect(result.value.purchaseDate).toBe('2026-01-20');
    expect('purchaseDate' in result.errors).toBe(false);
    expect(result.valid).toBe(true);
  });

  it('purchaseDate and startMonth may disagree without any error; startMonth is stored as sent', () => {
    const result = validatePlanInput({ ...VALID_BASE, purchaseDate: '2026-01-20', startMonth: '2026-03' });
    expect(result.valid).toBe(true);
    expect(result.value.startMonth).toBe('2026-03');
    expect(result.value.purchaseDate).toBe('2026-01-20');
  });

  it('an invalid startMonth still gives exactly the pre-existing error message', () => {
    const result = validatePlanInput({ ...VALID_BASE, startMonth: '2026-1' });
    expect(result.errors.startMonth).toBe('กรุณาเลือกเดือนเริ่มผ่อน');
  });

  it('buildSchedule output is identical whether or not purchaseDate is present', () => {
    const withDate = validatePlanInput({ ...VALID_BASE, purchaseDate: '2026-01-20' }).value;
    const withoutDate = validatePlanInput(VALID_BASE).value;
    expect(buildSchedule(withDate)).toEqual(buildSchedule(withoutDate));
  });
});