// AC-9 / AC-3: the "งวดถัดไป …" date uses resolveCardDueDate. AC-CD3 / AC-CD30: the summary due line is the full due date
// of the payable cycle.
import { render, screen } from '@testing-library/react';
import CreditCardDetail from '../../src/frontend/components/CreditCardDetail';

// The revolving fetch is not part of this assertion: feed the detail an inert "ready" cycle with something due.
jest.mock('../../src/shared/utils/frontend/useRevolvingCycle', () => {
  const actual = jest.requireActual('../../src/shared/utils/frontend/useRevolvingCycle');
  return {
    ...actual,
    useRevolvingCycle: () => ({
      status: 'ready',
      currentCycle: { ...actual.EMPTY_CYCLE, totalDue: 500, minPaymentDue: 50, newSpend: 500, stored: true, isImplicit: false },
      previousMonthCycle: null, history: [], truncated: false, cardTotal: null, cashbackDraft: '', busy: false,
      changeCashbackDraft: jest.fn(), focusCashback: jest.fn(), blurCashback: jest.fn(),
      payFull: jest.fn(), payMinimum: jest.fn(), undoPayment: jest.fn(), retry: jest.fn()
    })
  };
});
jest.mock('../../src/frontend/components/CreditSpendItems', () => ({ __esModule: true, default: () => null }));

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false, media: query, onchange: null,
        addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false
      })
    });
  }
});

afterEach(() => jest.useRealTimers());

const plan = (dueMonth: string) => ({
  id: 'ip_0000000000aa', cardId: 'cc_x', itemName: 'โทรศัพท์', status: 'ongoing', installmentsPaid: 0, installmentsRemaining: 3,
  months: 3, totalPrice: 900, progressPercent: 0, monthlyPayment: 300, remainingPayable: 900, interestMode: 'manual', manualFeePerMonth: 0,
  schedule: [{ no: 1, dueMonth, payment: 300, principal: 300, interest: 0, paid: false }],
  nextUnpaid: { no: 1, dueMonth, payment: 300, principal: 300, interest: 0, paid: false }
});
const card = (statementDay: number | string, dueDay: number | string) => ({
  id: 'cc_x', name: 'บัตรทดสอบ', creditLimit: 20000, remainingPayable: 900, availableCredit: 19100, statementDay, dueDay
});

it('cross-month card (EOM/10): next installment of cycle 2026-10 shows 10 พ.ย. 2569', () => {
  render(<CreditCardDetail card={card('EOM', 10)} plans={[plan('2026-10')]} />);
  expect(screen.getByText(/งวดถัดไป 1\/3 · 10 พ\.ย\. 2569/)).toBeInTheDocument();
  expect(screen.queryByText(/งวดถัดไป 1\/3 · 10 ต\.ค\. 2569/)).not.toBeInTheDocument();
});

it('AC-3 same-month card (5/25): next installment of cycle 2026-10 still shows 25 ต.ค. 2569', () => {
  render(<CreditCardDetail card={card(5, 25)} plans={[plan('2026-10')]} />);
  expect(screen.getByText(/งวดถัดไป 1\/3 · 25 ต\.ค\. 2569/)).toBeInTheDocument();
});

it('AC-CD3 / AC-CD30: for the EOM/10 card on 2026-11-05 the summary opens on cycle 2026-10 and reads "ครบกำหนด 10 พ.ย. 2569"', () => {
  jest.useFakeTimers({ now: new Date('2026-11-05T09:00:00'), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask'] });
  render(<CreditCardDetail card={card('EOM', 10)} plans={[]} />);
  expect(screen.getByText('รอบบิล ต.ค. 2569')).toBeInTheDocument();
  expect(screen.getByText('ครบกำหนด 10 พ.ย. 2569')).toBeInTheDocument();
});

it('AC-CD3: the 5/25 card on 2026-10-20 reads "ครบกำหนด 25 ต.ค. 2569"', () => {
  jest.useFakeTimers({ now: new Date('2026-10-20T09:00:00'), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask'] });
  render(<CreditCardDetail card={card(5, 25)} plans={[]} />);
  expect(screen.getByText('ครบกำหนด 25 ต.ค. 2569')).toBeInTheDocument();
});
