/**
 * Stage 4 tester gap test (bank-account-breakdown, AC-3 / R7).
 * The GET /api/monthly_expense `accountSummary` must stay byte-identical to the pre-change
 * getAccountSummary. The old implementation returned early for paid rows BEFORE resolving the
 * account and seeding the bucket, so a paid row never added a key and never fixed a key's
 * position. Expected values below were produced by running the HEAD (pre-change) version.
 * JSON.stringify is used so key ORDER is compared too (toEqual ignores key order).
 */
import { getAccountSummary } from '../../../src/shared/utils/commonUtils';

describe('getAccountSummary stored-output parity with the pre-change implementation', () => {
  test('a paid row with an unlisted account adds no key', () => {
    const data = { a: { account: 'ZZZ', actual: '100', paid: true }, b: { account: 'กสิกร', actual: '5' } };
    expect(JSON.stringify(getAccountSummary(data, ['กสิกร']))).toBe('{"กสิกร":5}');
  });

  test('a paid unknown key with no account adds no ไม่ระบุบัญชี key (derived-only month passes [])', () => {
    const data = { foo: { actual: '1', paid: 'true' } };
    expect(JSON.stringify(getAccountSummary(data, []))).toBe('{}');
  });

  test('a paid row seen first does not change bucket key order', () => {
    const data = {
      x: { account: 'B', actual: '1', paid: true },
      y: { account: 'A', actual: '2' },
      z: { account: 'B', actual: '3' }
    };
    expect(JSON.stringify(getAccountSummary(data, []))).toBe('{"A":2,"B":3}');
  });
});
