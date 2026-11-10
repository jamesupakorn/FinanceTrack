/** @jest-environment node */
// AC-LN-11 / AC-LN-12 (BR-CC-036): the installment key regex accepts 2- or 3-digit installment numbers
// without changing any existing key.
import {
  INSTALLMENT_KEY_RE,
  buildInstallmentRowKey,
  parseInstallmentRowKey
} from '../../../src/shared/utils/creditCardUtils';
import { applyPaidSequentially } from '../../../src/shared/utils/installmentBackdate';

const OLD_INSTALLMENT_KEY_RE = /^cci_[0-9a-f]{12}_\d{2}$/;
const PLAN_ID = 'ip_9f3a12b0c7d4';
const HEX = '9f3a12b0c7d4';

describe('installment row key — 2- and 3-digit segments (AC-LN-11)', () => {
  test('builds 2-digit keys unchanged and 3-digit keys for no >= 100', () => {
    expect(buildInstallmentRowKey(PLAN_ID, 3)).toBe('cci_9f3a12b0c7d4_03');
    expect(buildInstallmentRowKey(PLAN_ID, 120)).toBe('cci_9f3a12b0c7d4_120');
    expect(buildInstallmentRowKey(PLAN_ID, 480)).toBe('cci_9f3a12b0c7d4_480');
  });

  test.each([1, 3, 9, 10, 60, 99, 100, 120, 150, 240, 480])('round-trips installment %i', (no) => {
    expect(parseInstallmentRowKey(buildInstallmentRowKey(PLAN_ID, no))).toEqual({ planId: PLAN_ID, installmentNo: no });
  });

  test('rejects a zero-padded 3-digit segment and other malformed segments', () => {
    expect(parseInstallmentRowKey(`cci_${HEX}_005`)).toBeNull();
    expect(parseInstallmentRowKey(`cci_${HEX}_099`)).toBeNull();
    expect(parseInstallmentRowKey(`cci_${HEX}_5`)).toBeNull();
    expect(parseInstallmentRowKey(`cci_${HEX}_1000`)).toBeNull();
    expect(parseInstallmentRowKey(`cci_${HEX}_12a`)).toBeNull();
  });

  test('_00 still matches as before (E-9)', () => {
    expect(parseInstallmentRowKey(`cci_${HEX}_00`)).toEqual({ planId: PLAN_ID, installmentNo: 0 });
  });
});

describe('installment row key — old keys stay valid (AC-LN-12)', () => {
  test('every key accepted by the old regex over 00–99 is accepted by the new regex', () => {
    for (let n = 0; n <= 99; n += 1) {
      const key = `cci_${HEX}_${String(n).padStart(2, '0')}`;
      expect(OLD_INSTALLMENT_KEY_RE.test(key)).toBe(true);
      expect(INSTALLMENT_KEY_RE.test(key)).toBe(true);
    }
  });

  test('the only newly accepted segments are 100–999', () => {
    for (let n = 0; n <= 999; n += 1) {
      const padded3 = String(n).padStart(3, '0');
      expect(INSTALLMENT_KEY_RE.test(`cci_${HEX}_${padded3}`)).toBe(n >= 100);
    }
  });
});

describe('installmentBackdate consumer of INSTALLMENT_KEY_RE', () => {
  test('2-digit keys behave as before and 3-digit keys are now accepted', async () => {
    const calls: string[] = [];
    const setPaid = async (_month: string, key: string) => { calls.push(key); return { paid: true }; };
    await expect(applyPaidSequentially(PLAN_ID, [
      { no: 2, dueMonth: '2026-06' },
      { no: 120, dueMonth: '2036-05' }
    ], setPaid)).resolves.toEqual({ succeededNos: [2, 120], failedNos: [] });
    expect(calls).toEqual(['cci_9f3a12b0c7d4_02', 'cci_9f3a12b0c7d4_120']);
  });
});
