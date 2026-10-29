import { buildMonthEvents } from '../../../../src/shared/utils/frontend/expenseEvents';
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
