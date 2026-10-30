import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import CreditCardsPage from '../../pages/credit-cards';
import { creditCardAPI, userSettingsAPI } from '../../src/shared/utils/frontend/apiUtils';
import { showToast } from '../../src/shared/utils/frontend/toast';

let openFocus: Element | null = null;

jest.mock('next/router', () => ({
  useRouter: () => ({ isReady: true, pathname: '/credit-cards', query: {}, push: jest.fn(), replace: jest.fn() })
}));
jest.mock('../../src/frontend/contexts/SessionContext', () => ({
  useSession: () => ({ currentUser: { id: 'u-page-1' } })
}));
jest.mock('../../src/frontend/components/Layout', () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>
}));
jest.mock('../../src/frontend/components/CreditCardForm', () => ({ __esModule: true, default: () => null }));
jest.mock('../../src/frontend/components/BackdatedInstallmentsDialog', () => ({ BackdatedPaidFailureDialog: () => null }));
jest.mock('../../src/frontend/components/InstallmentPlanForm', () => ({
  __esModule: true,
  default: ({ open }: { open: boolean }) => {
    if (open) openFocus = document.activeElement;
    return open ? <div data-testid="plan-form">plan form</div> : null;
  }
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));
jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  creditCardAPI: { getCards: jest.fn(), getPlans: jest.fn(), createSpendItem: jest.fn() },
  expenseAPI: {},
  userSettingsAPI: { get: jest.fn() }
}));

const card = { id: 'c1', name: 'Shopee', statementDay: 25, dueDay: 10, limit: 10000 };

beforeEach(() => {
  jest.clearAllMocks();
  openFocus = null;
  jest.mocked(creditCardAPI.getPlans).mockResolvedValue({ plans: [] } as never);
  jest.mocked(userSettingsAPI.get).mockResolvedValue({ bankAccounts: [] } as never);
});

async function openAddExpense(user: ReturnType<typeof userEvent.setup>) {
  const button = await screen.findByRole('button', { name: /^เพิ่มรายจ่าย$/ });
  await user.click(button);
  return button;
}

test('no cards: dashboard offers no add-expense entry (toast guard is unreachable from the UI)', async () => {
  jest.mocked(creditCardAPI.getCards).mockResolvedValue({ cards: [], totals: null } as never);
  render(<CreditCardsPage />);
  await waitFor(() => expect(creditCardAPI.getCards).toHaveBeenCalled());
  await screen.findAllByRole('button', { name: /เพิ่มบัตร/ });
  expect(screen.queryByRole('button', { name: /เพิ่มรายจ่าย/ })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('type dialog -> installment restores opener focus, then opens the plan form', async () => {
  const user = userEvent.setup();
  jest.mocked(creditCardAPI.getCards).mockResolvedValue({ cards: [card], totals: null } as never);
  render(<CreditCardsPage />);
  await screen.findAllByText('Shopee');
  const opener = await openAddExpense(user);
  await user.click(await screen.findByRole('button', { name: /ผ่อนชำระ/ }));
  expect(await screen.findByTestId('plan-form')).toBeInTheDocument();
  expect(openFocus).toBe(opener);
});

test('type dialog -> spend save shows note, toast and silently reloads', async () => {
  const user = userEvent.setup();
  jest.mocked(creditCardAPI.getCards).mockResolvedValue({ cards: [card], totals: null } as never);
  jest.mocked(creditCardAPI.createSpendItem).mockResolvedValue({
    item: { id: 'i1', cardId: 'c1', name: 'ข้าว', amount: 50, month: '2026-11', purchaseDate: '2026-10-26' }
  } as never);
  render(<CreditCardsPage />);
  await screen.findAllByText('Shopee');
  await openAddExpense(user);
  await user.click(await screen.findByRole('button', { name: /รายจ่ายธรรมดา/ }));
  await user.selectOptions(await screen.findByLabelText('บัตร'), 'c1');
  await user.type(screen.getByLabelText('ชื่อรายการ'), 'ข้าว');
  await user.type(screen.getByLabelText('จำนวนเงิน (บาท)'), '50');
  const callsBefore = jest.mocked(creditCardAPI.getCards).mock.calls.length;
  await user.click(screen.getByRole('button', { name: 'บันทึกรายการ' }));
  expect(await screen.findByText(/เพิ่มรายการ ข้าว เข้ารอบบิล/)).toBeInTheDocument();
  expect(showToast).toHaveBeenCalledWith('เพิ่มรายจ่ายแล้ว');
  expect(jest.mocked(creditCardAPI.getCards).mock.calls.length).toBeGreaterThan(callsBefore);
  expect(screen.queryByRole('dialog')).toBeNull();
});
