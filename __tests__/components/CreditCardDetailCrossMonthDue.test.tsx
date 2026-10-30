// AC-9 / AC-3: the "งวดถัดไป …" date uses resolveCardDueDate.
import { render, screen } from '@testing-library/react';
import CreditCardDetail from '../../src/frontend/components/CreditCardDetail';

// The revolving section fetches its own data; it is not part of this assertion.
jest.mock('../../src/frontend/components/RevolvingBalanceSection', () => ({ __esModule: true, default: () => null }));

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
