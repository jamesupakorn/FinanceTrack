import { buildMonthEvents, collectUpcomingPayments } from '../../../../src/shared/utils/frontend/expenseEvents';
import { formatExpenseData } from '../../../../src/shared/utils/frontend/numberUtils';
import { getMonthlySummaryModel } from '../../../../src/shared/utils/frontend/monthlySummary';

const key = 'ccr_000000000001';
const row = {
  name: 'บัตร A', actual: 1300, paid: true, account: 'บัญชี A', dueDay: 20, derived: true,
  breakdown: {
    installmentTotal: 300,
    installments: [{ key: 'cci_000000000001_01', name: 'สินค้า งวด 1', amount: 300, paid: true }],
    revolving: { newSpend: 1000, carriedBalance: 0, cashbackAmount: 0, totalDue: 1000, minPaymentDue: 100, amountDue: 100, paymentAction: 'minimum' as const }
  }
};

it('AC-S19 expands nested installments and revolving without double counting even after minimum pay', () => {
  const calendar = buildMonthEvents({
    monthKey: '2026-10', monthsMap: { '2026-10': { [key]: row } },
    cards: [{ id: 'cc_000000000001', name: 'บัตร A' }],
    plans: [{ id: 'ip_000000000001', cardId: 'cc_000000000001' }]
  });
  const events = calendar.eventsByDay.get(20)!;
  expect(events).toHaveLength(2);
  expect(events.map(event => [event.source, event.amount, event.paid])).toEqual([['installment', 300, true], ['revolving', 1000, true]]);
  expect(events[0].installmentNo).toBe(1);
  expect(calendar.monthTotals).toEqual({ total: 1300, paid: 1300, remaining: 0 });
});

it('keeps breakdown through expense formatting and splits summary totals only once', () => {
  const formatted = formatExpenseData({ [key]: row }, '2026-10');
  expect(formatted.values[key]).toHaveProperty('breakdown', row.breakdown);
  const model = getMonthlySummaryModel({ month: '2026-10', expenseData: { [key]: row } });
  expect(model.creditCard).toBe(1300);
  expect(model.creditCardInstallment).toBe(300);
  expect(model.creditCardRevolving).toBe(1000);
});

// spec-credit-card-cross-month-due.md AC-5 / AC-7 / AC-3: derived card rows placed on their real due date
describe('cross-month card rows (AC-5, AC-7)', () => {
  const SP_KEY = 'ccr_00000000005e';
  const SP_CARD = { id: 'cc_00000000005e', name: 'Shopee SPayLater', statementDay: 'EOM', dueDay: 10 };
  const SP_PLAN = { id: 'ip_0000000000aa', cardId: SP_CARD.id };
  const SM_KEY = 'ccr_000000000077';
  const SM_CARD = { id: 'cc_000000000077', name: 'Same Month', statementDay: 5, dueDay: 25 };
  const shopeeRow = (month: string, resolvedDueDate: string) => ({
    name: 'Shopee SPayLater', actual: 1500, paid: false, account: 'บัญชี B', dueDay: 10, derived: true, resolvedDueDate,
    breakdown: {
      installmentTotal: 500,
      installments: [{ key: 'cci_0000000000aa_01', name: `สินค้า ${month} งวด 1`, amount: 500, paid: false }],
      revolving: { newSpend: 1000, carriedBalance: 0, cashbackAmount: 0, totalDue: 1000, minPaymentDue: 100, amountDue: 1000, paymentAction: null }
    }
  });
  const sameMonthRow = { name: 'Same Month', actual: 800, paid: false, dueDay: 25, derived: true, resolvedDueDate: '2026-10-25' };
  const monthsMap = {
    '2026-09': { [SP_KEY]: shopeeRow('2026-09', '2026-10-10') },
    '2026-10': { [SP_KEY]: shopeeRow('2026-10', '2026-11-10'), [SM_KEY]: sameMonthRow, rent: { name: 'ค่าเช่า', actual: 5000, dueDay: 1 } },
    '2026-11': { rent: { name: 'ค่าเช่า', actual: 5000, dueDay: 1 } }
  };
  const cards = [SP_CARD, SM_CARD];
  const plans = [SP_PLAN];

  it('AC-5: view 2026-11 places the Shopee 2026-10 row and its expanded cci_ line on day 10 with cycleMonth 2026-10', () => {
    const view = buildMonthEvents({ monthKey: '2026-11', monthsMap, cards, plans });
    const day10 = (view.eventsByDay.get(10) || []).filter(event => event.type === 'expense');
    expect(day10.map(event => [event.source, event.key, event.cycleMonth, event.id, event.amount])).toEqual([
      ['installment', 'cci_0000000000aa_01', '2026-10', '2026-10_cci_0000000000aa_01', 500],
      ['revolving', SP_KEY, '2026-10', `2026-10_${SP_KEY}`, 1000]
    ]);
    expect(day10[0].name).toBe('สินค้า 2026-10 งวด 1');
    expect(day10[0].card).toBe(SP_CARD);
    // the Oct same-month row (due 25 Oct) is not pulled into November
    const allKeys = Array.from(view.eventsByDay.values()).flat().map(event => event.key);
    expect(allKeys).not.toContain(SM_KEY);
    // monthTotals = events placed in Nov: 500 + 1000 + Nov rent 5000
    expect(view.monthTotals).toEqual({ total: 6500, paid: 0, remaining: 6500 });
  });

  it('AC-5: view 2026-10 shows the 2026-09 cycle on 10 Oct and does not contain the 2026-10 cycle', () => {
    const view = buildMonthEvents({ monthKey: '2026-10', monthsMap, cards, plans });
    const expense = Array.from(view.eventsByDay.entries()).flatMap(([day, events]) => events.filter(e => e.type === 'expense').map(e => [day, e.key, e.cycleMonth, e.name]));
    expect(expense).toEqual(expect.arrayContaining([
      [10, 'cci_0000000000aa_01', '2026-09', 'สินค้า 2026-09 งวด 1'],
      [10, SP_KEY, '2026-09', 'Shopee SPayLater'],
      [25, SM_KEY, '2026-10', 'Same Month'],
      [1, 'rent', '2026-10', 'ค่าเช่า']
    ]));
    expect(expense.filter(([, , cycle]) => cycle === '2026-10').map(([, key]) => key).sort()).toEqual(['rent', SM_KEY].sort());
    // the plain Sep row path is never consulted from M-1 (only card rows with resolvedDueDate)
    expect(expense).toHaveLength(4);
  });

  it('plain rows and card rows without resolvedDueDate from M-1 are never pulled in', () => {
    const view = buildMonthEvents({
      monthKey: '2026-11',
      monthsMap: { '2026-10': { rent: { name: 'ค่าเช่า', actual: 5000, dueDay: 1 }, [SP_KEY]: { name: 'legacy', actual: 10, dueDay: 10 } } },
      cards, plans
    });
    expect(Array.from(view.eventsByDay.values()).flat().filter(e => e.type === 'expense')).toEqual([]);
    expect(view.windowState).toBe('future');
  });

  it('future view with only M-1 present still shows the cross-month events (windowState unchanged)', () => {
    const view = buildMonthEvents({ monthKey: '2026-12', monthsMap: { '2026-11': { [SP_KEY]: shopeeRow('2026-11', '2026-12-10') } }, cards, plans });
    expect(view.windowState).toBe('future');
    expect((view.eventsByDay.get(10) || []).filter(e => e.type === 'expense').map(e => e.cycleMonth)).toEqual(['2026-11', '2026-11']);
  });

  it('statement events carry the view month as cycleMonth', () => {
    const view = buildMonthEvents({ monthKey: '2026-11', monthsMap, cards, plans });
    const statements = Array.from(view.eventsByDay.values()).flat().filter(e => e.type === 'statement');
    expect(statements.map(e => [e.key, e.cycleMonth])).toEqual(expect.arrayContaining([[`st_${SP_CARD.id}`, '2026-11'], [`st_${SM_CARD.id}`, '2026-11']]));
  });

  it('AC-3 regression: a same-month row with resolvedDueDate in M renders on the same day it did via dueDay', () => {
    const withResolved = buildMonthEvents({ monthKey: '2026-10', monthsMap: { '2026-10': { [SM_KEY]: sameMonthRow } }, cards, plans });
    const { resolvedDueDate: _omit, ...legacyRow } = sameMonthRow;
    const legacy = buildMonthEvents({ monthKey: '2026-10', monthsMap: { '2026-10': { [SM_KEY]: legacyRow } }, cards, plans });
    expect(Array.from(withResolved.eventsByDay.keys()).sort()).toEqual(Array.from(legacy.eventsByDay.keys()).sort());
    expect(withResolved.monthTotals).toEqual(legacy.monthTotals);
  });

  it('review.md minor finding 3: an impossible resolvedDueDate (2026-02-30) is rejected, not placed on day 30', () => {
    // in-month: falls back to dueDay (10) in the viewed month
    const inMonth = buildMonthEvents({ monthKey: '2026-02', monthsMap: { '2026-02': { [SP_KEY]: shopeeRow('2026-02', '2026-02-30') } }, cards, plans });
    expect(inMonth.eventsByDay.get(30)).toBeUndefined();
    expect((inMonth.eventsByDay.get(10) || []).filter(e => e.type === 'expense').map(e => e.cycleMonth)).toEqual(['2026-02', '2026-02']);
    // from M-1: the invalid date never pulls the January row into February
    const fromPrev = buildMonthEvents({ monthKey: '2026-02', monthsMap: { '2026-01': { [SP_KEY]: shopeeRow('2026-01', '2026-02-30') } }, cards, plans });
    expect(Array.from(fromPrev.eventsByDay.values()).flat().filter(e => e.type === 'expense')).toEqual([]);
  });

  it('AC-7: today 2026-11-05 lists the Shopee 2026-10 obligation in dueSoon with isoDate 2026-11-10', () => {
    const upcoming = collectUpcomingPayments({ monthsMap, cards, plans, today: new Date(2026, 10, 5, 9, 0, 0) });
    const shopee = upcoming.dueSoon.filter(event => event.card?.id === SP_CARD.id);
    expect(shopee.map(event => [event.key, event.isoDate, event.daysDiff, event.cycleMonth])).toEqual([
      ['cci_0000000000aa_01', '2026-11-10', 5, '2026-10'],
      [SP_KEY, '2026-11-10', 5, '2026-10']
    ]);
    // not reported again as overdue on 10 Oct (that is the Sep cycle's date and today's view excludes Oct)
    expect(upcoming.overdue.filter(event => event.card?.id === SP_CARD.id)).toEqual([]);
  });
});
