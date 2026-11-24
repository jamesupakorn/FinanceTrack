// Loan TD cleanup D3 (§I4, AC-TDC-13) — the shared stored-schedule guard used by both the rate-revisions
// route and the LoanRateRevisionDialog preview. Every row must already be numeric: no conversion happens.
import { isRevisableSchedule } from '../../../src/shared/utils/creditCardAmortization';
import { buildRevisionFixturePlan } from '../../helpers/loanRateRevisionFixture';

type FixtureRow = Record<string, unknown>;

/** The shared fixture's stored schedule with one tail row (no 21) overridden. */
function scheduleWith(override: FixtureRow): unknown[] {
  const rows = buildRevisionFixturePlan().schedule.map(row => ({ ...row }));
  rows[20] = { ...rows[20], ...override };
  return rows;
}

describe('isRevisableSchedule', () => {
  it('accepts the shared fixture\'s stored schedule', () => {
    expect(isRevisableSchedule(buildRevisionFixturePlan().schedule)).toBe(true);
  });

  it('accepts an empty schedule', () => {
    expect(isRevisableSchedule([])).toBe(true);
  });

  it.each<[string, FixtureRow]>([
    ['a string payment', { payment: '7500.00' }],
    ['a non-integer no', { no: 1.5 }],
    ['a numeric dueMonth', { dueMonth: 202712 }],
    ['NaN interest', { interest: NaN }],
    ['Infinity principal', { principal: Infinity }]
  ])('rejects a row with %s', (_label, override) => {
    expect(isRevisableSchedule(scheduleWith(override))).toBe(false);
  });

  it('rejects a null row', () => {
    const rows: unknown[] = buildRevisionFixturePlan().schedule.map(row => ({ ...row }));
    rows[20] = null;
    expect(isRevisableSchedule(rows)).toBe(false);
  });
});
