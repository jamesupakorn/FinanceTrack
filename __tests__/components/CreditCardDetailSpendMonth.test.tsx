// Bug: a stale spendRefreshKey/spendSavedMonth from an earlier save must not pull a freshly opened detail page off the current month.
import { render, screen } from '@testing-library/react';
import CreditCardDetail from '../../src/frontend/components/CreditCardDetail';
import { getCurrentMonthKey } from '../../src/shared/utils/creditCardUtils';

jest.mock('../../src/frontend/components/RevolvingBalanceSection', () => ({ __esModule: true, default: () => null }));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false
    })
  });
});

const card = { id: 'cc_x', name: 'บัตรทดสอบ', creditLimit: 20000, remainingPayable: 0, availableCredit: 20000, statementDay: 5, dueDay: 25 };
const monthInput = () => screen.getByLabelText('เดือนรอบบิล') as HTMLInputElement;

it('mounting with a leftover spendRefreshKey > 0 stays on the current month', () => {
  render(<CreditCardDetail card={card} plans={[]} spendRefreshKey={3} spendSavedMonth="2031-01" />);
  expect(monthInput().value).toBe(getCurrentMonthKey());
});

it('a key change after mount switches to the saved month', () => {
  const { rerender } = render(<CreditCardDetail card={card} plans={[]} spendRefreshKey={0} spendSavedMonth={null} />);
  expect(monthInput().value).toBe(getCurrentMonthKey());
  rerender(<CreditCardDetail card={card} plans={[]} spendRefreshKey={1} spendSavedMonth="2031-01" />);
  expect(monthInput().value).toBe('2031-01');
});
