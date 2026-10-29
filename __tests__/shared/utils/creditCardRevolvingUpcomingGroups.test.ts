import { summariseCard } from '../../../src/shared/utils/creditCardRevolving';

const CARD = {
  id: 'cc_upcoming',
  annualRate: 0,
  minPaymentPercent: 10,
  dueDay: 5,
  creditLimit: 10000
};

describe('summariseCard revolvingDueMonth', () => {
  it('returns the selected as-of cycle month and unpaid carried amount without mutating stored inputs', () => {
    const plans = [{
      id: 'plan_upcoming',
      cardId: CARD.id,
      status: 'ongoing',
      schedule: [{ no: 1, dueMonth: '2026-11', payment: 300, principal: 300, paid: false }]
    }];
    const cycles = [
      { id: 'cycle_old', cardId: CARD.id, month: '2026-09', newSpend: 700 },
      { id: 'cycle_future', cardId: CARD.id, month: '2026-11', newSpend: 500 }
    ];
    const originalCard = JSON.stringify(CARD);
    const originalPlans = JSON.stringify(plans);
    const originalCycles = JSON.stringify(cycles);

    const summary = summariseCard(CARD, plans, cycles, { asOfMonth: '2026-10' });

    expect(summary).toMatchObject({
      revolvingDue: 700,
      revolvingDueMonth: '2026-10',
      nextDueDate: '2026-09-05'
    });
    expect(summary.revolvingDueMonth).not.toBe(summary.nextDueDate?.slice(0, 7));
    expect(JSON.stringify(CARD)).toBe(originalCard);
    expect(JSON.stringify(plans)).toBe(originalPlans);
    expect(JSON.stringify(cycles)).toBe(originalCycles);
    expect(CARD).not.toHaveProperty('revolvingDueMonth');
    expect(cycles[0]).not.toHaveProperty('revolvingDueMonth');
  });

  it.each(['full', 'minimum'] as const)(
    'returns the selected month but zero upcoming due after %s confirmation',
    paymentAction => {
      const summary = summariseCard(
        CARD,
        [],
        [{ id: `cycle_${paymentAction}`, cardId: CARD.id, month: '2026-10', newSpend: 700, paymentAction }],
        { asOfMonth: '2026-10' }
      );

      expect(summary).toMatchObject({
        revolvingDue: 0,
        revolvingTotalDue: 700,
        revolvingDueMonth: '2026-10',
        revolvingAction: paymentAction
      });
    }
  );

  it('returns null when the selected summary has no cycle', () => {
    const summary = summariseCard(CARD, [], [], { asOfMonth: '2026-10' });

    expect(summary.revolvingDue).toBe(0);
    expect(summary.revolvingDueMonth).toBeNull();
  });

  it('keeps the cycle month independent of an earlier installment next due date', () => {
    const summary = summariseCard(
      CARD,
      [{
        id: 'plan_past',
        cardId: CARD.id,
        status: 'ongoing',
        schedule: [{ no: 1, dueMonth: '2026-09', payment: 300, principal: 300, paid: false }]
      }],
      [{ id: 'cycle_selected', cardId: CARD.id, month: '2026-10', newSpend: 700, paymentAction: 'full' }],
      { asOfMonth: '2026-10' }
    );

    expect(summary.revolvingDueMonth).toBe('2026-10');
    expect(summary.nextDueDate).toBe('2026-09-05');
  });
});
