import { summariseCard } from '../../../src/shared/utils/creditCardRevolving';

const CARD = {
  id: 'cc_upcoming',
  annualRate: 0,
  minPaymentPercent: 10,
  // same-month card (dueDay > statementDay) per spec-credit-card-cross-month-due.md §Test fallout rule
  statementDay: 1,
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

// spec-credit-card-cross-month-due.md AC-14 / RR-2: payable cycle derived on read, never stored
describe('summariseCard payableRevolvingDue / payableRevolvingMonth (AC-14)', () => {
  const SHOPEE = { id: 'cc_shopee', annualRate: 0, minPaymentPercent: 10, statementDay: 'EOM', dueDay: 10, creditLimit: 20000 };

  it('Shopee as of 2026-11 returns the Oct cycle as payable with its unpaid due', () => {
    const cycles = [
      { id: 'rc_oct', cardId: SHOPEE.id, month: '2026-10', newSpend: 1200 },
      { id: 'rc_nov', cardId: SHOPEE.id, month: '2026-11', newSpend: 300 }
    ];
    const originalCycles = JSON.stringify(cycles);
    const summary = summariseCard(SHOPEE, [], cycles, { asOfMonth: '2026-11' });

    expect(summary.payableRevolvingMonth).toBe('2026-10');
    expect(summary.payableRevolvingDue).toBe(1200);
    // current cycle is still the as-of month; unpaid Oct carries into Nov (why R-2 replaces, never adds)
    expect(summary.revolvingDueMonth).toBe('2026-11');
    expect(summary.revolvingDue).toBe(1500);
    // XM-9: totals keep using the current cycle only
    expect(summary.remainingPayable).toBe(1500);
    expect(summary.nextDueDate).toBe('2026-11-10');
    expect(JSON.stringify(cycles)).toBe(originalCycles);
    expect(cycles[0]).not.toHaveProperty('payableRevolvingDue');
  });

  it.each(['full', 'minimum'] as const)('payable Oct cycle confirmed %s -> payableRevolvingDue 0', paymentAction => {
    const summary = summariseCard(
      SHOPEE,
      [],
      [{ id: 'rc_oct', cardId: SHOPEE.id, month: '2026-10', newSpend: 1200, paymentAction }],
      { asOfMonth: '2026-11' }
    );
    expect(summary.payableRevolvingMonth).toBe('2026-10');
    expect(summary.payableRevolvingDue).toBe(0);
  });

  it('no stored or derived payable cycle -> payableRevolvingMonth null, due 0', () => {
    const summary = summariseCard(SHOPEE, [], [], { asOfMonth: '2026-11' });
    expect(summary.payableRevolvingMonth).toBeNull();
    expect(summary.payableRevolvingDue).toBe(0);
  });

  it('same-month card: payable fields equal the current-cycle fields', () => {
    const summary = summariseCard(
      CARD,
      [],
      [{ id: 'rc_cur', cardId: CARD.id, month: '2026-11', newSpend: 640 }],
      { asOfMonth: '2026-11' }
    );
    expect(summary.payableRevolvingMonth).toBe(summary.revolvingDueMonth);
    expect(summary.payableRevolvingMonth).toBe('2026-11');
    expect(summary.payableRevolvingDue).toBe(summary.revolvingDue);
    expect(summary.payableRevolvingDue).toBe(640);
  });
});
