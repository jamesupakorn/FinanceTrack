import { describe, expect, it } from '@jest/globals';
import { collectPaidCardPayments } from '../../../../src/shared/utils/frontend/expenseEvents';

type Events = Parameters<typeof collectPaidCardPayments>[0];

function ev(overrides: Record<string, unknown>) {
  return { id: 'x', type: 'expense', source: 'revolving', key: 'k', name: 'n', amount: 100, paid: true, card: null, ...overrides };
}

describe('collectPaidCardPayments', () => {
  it('returns only paid revolving/installment expense events, sorted by day, with isoDate', () => {
    const map = new Map([
      [20, [ev({ key: 'inst', source: 'installment' })]],
      [5, [
        ev({ key: 'rev' }),
        ev({ key: 'plain', source: 'plain' }),
        ev({ key: 'unpaid', paid: false }),
        ev({ key: 'stmt', type: 'statement', source: 'statement' })
      ]]
    ]) as unknown as Events;
    const result = collectPaidCardPayments(map, '2026-10');
    expect(result.map(e => e.key)).toEqual(['rev', 'inst']);
    expect(result.map(e => e.isoDate)).toEqual(['2026-10-05', '2026-10-20']);
  });

  it('returns an empty array for an empty month', () => {
    expect(collectPaidCardPayments(new Map() as unknown as Events, '2026-10')).toEqual([]);
  });
});
