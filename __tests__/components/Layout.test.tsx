import { render, screen } from '@testing-library/react';
import Layout from '../../src/frontend/components/Layout';
import NotificationBell from '../../src/frontend/components/NotificationBell';
import userEvent from '@testing-library/user-event';

let mockAsPath = '/';

jest.mock('next/router', () => ({
  useRouter: () => ({ asPath: mockAsPath, push: jest.fn(), replace: jest.fn() })
}));

jest.mock('../../src/frontend/contexts/SessionContext', () => ({
  useSession: () => ({
    currentUser: { id: 'layout-test' },
    isReady: true,
    logout: jest.fn()
  })
}));

jest.mock('../../src/frontend/components/ChangePasswordModal', () => ({
  __esModule: true,
  default: () => null
}));

jest.mock('../../src/frontend/components/ExpenseCalendarModal', () => ({
  __esModule: true,
  default: () => null
}));

beforeEach(() => {
  mockAsPath = '/';
  localStorage.clear();
});

test('contains positioned accessible content inside the main scroll area', () => {
  render(
    <Layout activeNav="dashboard" title="Dashboard">
      <ul className="sr-only" aria-label="Summary"><li>Income 100</li></ul>
    </Layout>
  );

  const main = screen.getByRole('main');
  expect(main).toHaveClass('relative', 'min-h-0', 'overflow-y-auto');
  expect(main).toContainElement(screen.getByRole('list', { name: 'Summary' }));
  expect(screen.getByText('Income 100')).toBeInTheDocument();
});

test('resets the main scroll position on navigation', () => {
  const { rerender } = render(<Layout activeNav="dashboard" title="Dashboard" />);
  const main = screen.getByRole('main');
  main.scrollTop = 300;
  mockAsPath = '/credit-cards';

  rerender(<Layout activeNav="credit-cards" title="Cards" />);

  expect(main.scrollTop).toBe(0);
});

test('allows the notification dropdown to escape the wrapping header actions', async () => {
  const user = userEvent.setup();
  render(<Layout activeNav="dashboard" title="Dashboard" headerActions={<NotificationBell />} />);

  const bell = screen.getByRole('button', { name: 'การแจ้งเตือน' });
  const actions = bell.parentElement?.parentElement;
  expect(actions).toHaveClass('flex-wrap');
  expect(actions).not.toHaveClass('overflow-x-auto');

  await user.click(bell);
  expect(bell).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('menu')).toHaveTextContent('ไม่มีรายการที่ต้องจัดการ');
  expect(screen.getByRole('menu')).toHaveClass('md:left-0', 'md:right-auto');

  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(bell).toHaveFocus();
});
