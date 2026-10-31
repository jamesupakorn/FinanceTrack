import { describe, expect, it } from '@jest/globals';
import { cardGroupKey, groupUpcomingByCard, isCardGroup } from '../../../../src/shared/utils/frontend/upcomingCardGroups';
import { collectUpcomingPayments } from '../../../../src/shared/utils/frontend/expenseEvents';

const card = { id: 'c1', name: 'บัตร A', color: '#123456' };
const base = { isoDate: '2026-11-10', daysDiff: 3, urgency: 'soon', account: 'KBank', cycleMonth: '2026-10' };

function line(over: Record<string, unknown>) {
  return { ...base, card, ...over } as any;
}

describe('groupUpcomingByCard', () => {
  it('groups installments and revolving into one card with a round2 total, installments first (AC-1)', () => {
    const rows = [
      line({ key: 'ccr_c1', source: 'revolving', name: 'หมุนเวียน', amount: 0.3 }),
      line({ key: 'cci_p1_1', source: 'installment', name: 'ผ่อน 1', amount: 0.1 }),
      line({ key: 'cci_p2_1', source: 'installment', name: 'ผ่อน 2', amount: 0.2 })
    ];
    const result = groupUpcomingByCard(rows);
    expect(result).toHaveLength(1);
    const group = result[0];
    expect(isCardGroup(group)).toBe(true);
    if (!isCardGroup(group)) return;
    expect(group.amount).toBe(0.6); // 0.1+0.2+0.3 would be 0.6000000000000001 unrounded
    expect(group.lines.map(l => l.key)).toEqual(['cci_p1_1', 'cci_p2_1', 'ccr_c1']);
    expect(group.groupKey).toBe(cardGroupKey('2026-10', 'c1'));
    expect(group.name).toBe('บัตร A');
  });

  it('keeps the same card in two cycles as two groups with distinct keys (AC-3)', () => {
    const result = groupUpcomingByCard([
      line({ key: 'ccr_c1', source: 'revolving', amount: 100, cycleMonth: '2026-10' }),
      line({ key: 'ccr_c1', source: 'revolving', amount: 200, cycleMonth: '2026-11', isoDate: '2026-12-10', daysDiff: 33 })
    ]);
    expect(result).toHaveLength(2);
    const keys = result.map(r => (isCardGroup(r) ? r.groupKey : ''));
    expect(new Set(keys).size).toBe(2);
  });

  it('passes plain rows and unresolvable card events through as individual rows (AC-10)', () => {
    const plain = line({ key: 'p1', source: 'plain', amount: 10, card: null });
    const orphan = line({ key: 'cci_gone_1', source: 'installment', amount: 20, card: null });
    const result = groupUpcomingByCard([plain, orphan]);
    expect(result).toEqual([plain, orphan]);
    expect(result.every(r => !isCardGroup(r))).toBe(true);
  });

  it('total reflects only the lines supplied, so a paid line lowers it (AC-4/AC-5)', () => {
    const all = [
      line({ key: 'cci_p1_1', source: 'installment', amount: 900 }),
      line({ key: 'ccr_c1', source: 'revolving', amount: 1200 })
    ];
    const full = groupUpcomingByCard(all)[0] as any;
    const afterRevolvingMinimum = groupUpcomingByCard([all[0]])[0] as any;
    expect(full.amount).toBe(2100);
    expect(afterRevolvingMinimum.amount).toBe(900);
  });

  it('uses the most urgent line defensively if urgency ever disagrees', () => {
    const group = groupUpcomingByCard([
      line({ key: 'cci_p1_1', source: 'installment', amount: 1, daysDiff: 3, urgency: 'soon' }),
      line({ key: 'ccr_c1', source: 'revolving', amount: 1, daysDiff: -1, urgency: 'overdue', isoDate: '2026-11-06' })
    ])[0] as any;
    expect(group.urgency).toBe('overdue');
    expect(group.daysDiff).toBe(-1);
    expect(group.isoDate).toBe('2026-11-06');
  });

  it('lines of one server row share one urgency and sum to row.actual (AC-6, no double counting)', () => {
    const today = new Date(2026, 10, 7);
    const monthsMap = {
      '2026-11': {
        ccr_000000000001: {
          name: 'บัตร A', actual: 2100, dueDay: 10, account: 'KBank', cycleMonth: '2026-10', resolvedDueDate: '2026-11-10',
          paid: false,
          breakdown: {
            installments: [
              { key: 'cci_000000000001_01', name: 'ผ่อน 1', amount: 600, paid: false },
              { key: 'cci_000000000002_01', name: 'ผ่อน 2', amount: 300, paid: true }
            ],
            revolving: { totalDue: 1200, newSpend: 1200, paymentAction: null }
          }
        }
      }
    };
    const cards = [{ id: 'cc_000000000001', name: 'บัตร A' }] as any;
    const plans = [{ id: 'ip_000000000001', cardId: 'cc_000000000001' }, { id: 'ip_000000000002', cardId: 'cc_000000000001' }] as any;
    const upcoming = collectUpcomingPayments({ monthsMap, cards, plans, today });
    const rows = [...upcoming.overdue, ...upcoming.dueToday, ...upcoming.dueSoon].map(e => ({ ...e, urgency: 'soon' }));
    const group = groupUpcomingByCard(rows as any)[0] as any;
    expect(new Set(group.lines.map((l: any) => l.daysDiff)).size).toBe(1);
    // unpaid lines 600 + 1200; plus the paid 300 equals the row actual 2100
    expect(group.amount).toBe(1800);
    expect(group.amount + 300).toBe(monthsMap['2026-11'].ccr_000000000001.actual);
  });
});
