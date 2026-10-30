import { resolveStatementCutoffDate } from '../../../src/shared/utils/creditCardUtils';

describe('resolveStatementCutoffDate', () => {
  it('returns the statement day within the month', () => {
    expect(resolveStatementCutoffDate(15, '2026-10')).toBe('2026-10-15');
  });
  it('clamps to end of month (31 in Feb, leap and non-leap)', () => {
    expect(resolveStatementCutoffDate(31, '2026-02')).toBe('2026-02-28');
    expect(resolveStatementCutoffDate(31, '2028-02')).toBe('2028-02-29');
    expect(resolveStatementCutoffDate('EOM', '2026-04')).toBe('2026-04-30');
  });
  it('returns null for an invalid month key', () => {
    expect(resolveStatementCutoffDate(10, 'bad')).toBeNull();
  });
});
