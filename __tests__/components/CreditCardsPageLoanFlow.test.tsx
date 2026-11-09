// Loan slice S3 — /credits orchestration: I-5 (loan create → plan step 2), the P0-1 back round trip
// (step 2 → edit step 1 → step 2 on save AND on cancel, no extra toast, AC-LN-S3-03), the BACK-face
// "+ เพิ่มตารางผ่อน" entry (P1-1), the E-23 only-loans add-expense guard and the loan delete-blocked toast.
// CreditCardForm / InstallmentPlanForm are stubbed to expose exactly the props the page drives.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import CreditCardsPage from '../../pages/credits';
import { creditCardAPI, userSettingsAPI } from '../../src/shared/utils/frontend/apiUtils';
import { showToast } from '../../src/shared/utils/frontend/toast';

let mockQuery: Record<string, string> = {};

jest.mock('next/router', () => ({
  useRouter: () => ({ isReady: true, pathname: '/credits', query: mockQuery, push: jest.fn(), replace: jest.fn() })
}));
jest.mock('../../src/frontend/contexts/SessionContext', () => ({
  useSession: () => ({ currentUser: { id: 'u-loan-1' } })
}));
jest.mock('../../src/frontend/components/Layout', () => ({
  __esModule: true,
  default: ({ children, headerActions }: { children?: ReactNode; headerActions?: ReactNode }) => <div>{headerActions}{children}</div>
}));
jest.mock('../../src/frontend/components/BackdatedInstallmentsDialog', () => ({ BackdatedPaidFailureDialog: () => null }));
jest.mock('../../src/frontend/components/CreditCardForm', () => ({
  __esModule: true,
  default: ({ open, card, onSubmit, onClose }: {
    open: boolean;
    card?: { id: string } | null;
    onSubmit?: (payload: Record<string, unknown>) => void;
    onClose?: () => void;
  }) => (open ? (
    <div data-testid="card-form" data-card-id={card?.id ?? ''}>
      <button type="button" onClick={() => onSubmit?.(card ? { id: card.id, name: 'ชื่อใหม่' } : { name: 'บ้าน', cardType: 'home_loan', creditLimit: 0 })}>submit-card</button>
      <button type="button" onClick={() => onSubmit?.({ name: 'KTC', cardType: 'credit_card' })}>submit-credit-card</button>
      <button type="button" onClick={onClose}>close-card</button>
    </div>
  ) : null)
}));
jest.mock('../../src/frontend/components/InstallmentPlanForm', () => ({
  __esModule: true,
  default: ({ open, lockedCardId, cards, onEditLockedCard, onClose }: {
    open: boolean;
    lockedCardId?: string | null;
    cards?: Array<{ id: string; name: string; cardType?: unknown }>;
    onEditLockedCard?: () => void;
    onClose?: () => void;
  }) => (open ? (
    <div data-testid="plan-form" data-locked={lockedCardId ?? ''}>
      <span data-testid="plan-form-card">{cards?.find(card => card.id === lockedCardId)?.name ?? ''}</span>
      {onEditLockedCard && <button type="button" onClick={onEditLockedCard}>กลับไปแก้ไขข้อมูลบัตร</button>}
      <button type="button" onClick={onClose}>close-plan</button>
    </div>
  ) : null)
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));
jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  creditCardAPI: {
    getCards: jest.fn(), getPlans: jest.fn(), saveCard: jest.fn(), deleteCard: jest.fn(),
    listSpendItems: jest.fn(), getRevolving: jest.fn()
  },
  expenseAPI: { getByMonth: jest.fn().mockResolvedValue({}) },
  userSettingsAPI: { get: jest.fn() }
}));

const loanCard = {
  id: 'cc_loan_new', name: 'บ้าน', cardType: 'home_loan', creditLimit: 0, statementDay: 'EOM', dueDay: 5,
  remainingPayable: 0, availableCredit: 0, ongoingPlanCount: 0, installmentCount: 0
};
const creditCard = { id: 'cc_card_1', name: 'KTC', statementDay: 25, dueDay: 10, creditLimit: 10000, remainingPayable: 0, availableCredit: 10000 };

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false
    })
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery = {};
  jest.mocked(creditCardAPI.getPlans).mockResolvedValue({ plans: [] } as never);
  jest.mocked(userSettingsAPI.get).mockResolvedValue({ bankAccounts: [] } as never);
});

async function renderWith(cards: unknown[]) {
  jest.mocked(creditCardAPI.getCards).mockResolvedValue({ cards, totals: null } as never);
  render(<CreditCardsPage />);
  await waitFor(() => expect(creditCardAPI.getCards).toHaveBeenCalled());
}

test('header button reads เพิ่มบัตร / สินเชื่อ', async () => {
  await renderWith([creditCard]);
  expect(await screen.findByRole('button', { name: 'เพิ่มบัตร / สินเชื่อ' })).toBeInTheDocument();
});

test('I-5: creating a loan closes step 1 and opens step 2 locked to the new card with one toast', async () => {
  await renderWith([creditCard]);
  jest.mocked(creditCardAPI.saveCard).mockResolvedValue({ success: true, card: loanCard } as never);
  jest.mocked(creditCardAPI.getCards).mockResolvedValue({ cards: [creditCard, loanCard], totals: null } as never);
  fireEvent.click(await screen.findByRole('button', { name: 'เพิ่มบัตร / สินเชื่อ' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'submit-card' })); });

  expect(screen.queryByTestId('card-form')).toBeNull();
  const planForm = await screen.findByTestId('plan-form');
  expect(planForm).toHaveAttribute('data-locked', 'cc_loan_new');
  expect(within(planForm).getByTestId('plan-form-card')).toHaveTextContent('บ้าน');
  expect(showToast).toHaveBeenCalledTimes(1);
  expect(showToast).toHaveBeenCalledWith('บันทึกสินเชื่อแล้ว · กรอกตารางผ่อนต่อ');

  // cancel step 2: the loan stays, no second toast (D-S3-1)
  fireEvent.click(screen.getByRole('button', { name: 'close-plan' }));
  expect(screen.queryByTestId('plan-form')).toBeNull();
  expect(showToast).toHaveBeenCalledTimes(1);
});

test('creating a credit card keeps today\'s behaviour (close + เพิ่มบัตรแล้ว, no plan step)', async () => {
  await renderWith([]);
  jest.mocked(creditCardAPI.saveCard).mockResolvedValue({ success: true, card: { ...creditCard, cardType: 'credit_card' } } as never);
  fireEvent.click((await screen.findAllByRole('button', { name: /เพิ่มบัตร/ }))[0]);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'submit-credit-card' })); });
  expect(screen.queryByTestId('card-form')).toBeNull();
  expect(screen.queryByTestId('plan-form')).toBeNull();
  expect(showToast).toHaveBeenCalledWith('เพิ่มบัตรแล้ว');
});

test('P0-1: step 2 → back opens an EDIT of the same card; save returns to step 2 with no toast', async () => {
  await renderWith([creditCard]);
  jest.mocked(creditCardAPI.saveCard).mockResolvedValue({ success: true, card: loanCard } as never);
  jest.mocked(creditCardAPI.getCards).mockResolvedValue({ cards: [creditCard, loanCard], totals: null } as never);
  fireEvent.click(await screen.findByRole('button', { name: 'เพิ่มบัตร / สินเชื่อ' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'submit-card' })); });
  await screen.findByTestId('plan-form');
  jest.mocked(showToast).mockClear();

  fireEvent.click(screen.getByRole('button', { name: 'กลับไปแก้ไขข้อมูลบัตร' }));
  expect(screen.queryByTestId('plan-form')).toBeNull();
  expect(screen.getByTestId('card-form')).toHaveAttribute('data-card-id', 'cc_loan_new');

  const renamed = { ...loanCard, name: 'ชื่อใหม่' };
  jest.mocked(creditCardAPI.saveCard).mockResolvedValue({ success: true, card: renamed } as never);
  jest.mocked(creditCardAPI.getCards).mockResolvedValue({ cards: [creditCard, renamed], totals: null } as never);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'submit-card' })); });

  expect(creditCardAPI.saveCard).toHaveBeenLastCalledWith({ id: 'cc_loan_new', name: 'ชื่อใหม่' });
  expect(screen.queryByTestId('card-form')).toBeNull();
  const planForm = screen.getByTestId('plan-form');
  expect(planForm).toHaveAttribute('data-locked', 'cc_loan_new');
  expect(within(planForm).getByTestId('plan-form-card')).toHaveTextContent('ชื่อใหม่');
  expect(showToast).not.toHaveBeenCalled();
});

test('P0-1 / E-29: cancelling the reopened edit also returns to step 2 of the same card', async () => {
  await renderWith([creditCard, loanCard]);
  fireEvent.click(await screen.findByRole('button', { name: '+ เพิ่มตารางผ่อน', hidden: true }));
  expect(screen.getByTestId('plan-form')).toHaveAttribute('data-locked', 'cc_loan_new');
  fireEvent.click(screen.getByRole('button', { name: 'กลับไปแก้ไขข้อมูลบัตร' }));
  expect(screen.getByTestId('card-form')).toHaveAttribute('data-card-id', 'cc_loan_new');
  fireEvent.click(screen.getByRole('button', { name: 'close-card' }));
  expect(screen.queryByTestId('card-form')).toBeNull();
  expect(screen.getByTestId('plan-form')).toHaveAttribute('data-locked', 'cc_loan_new');
  expect(showToast).not.toHaveBeenCalled();
  expect(creditCardAPI.saveCard).not.toHaveBeenCalled();

  // a normal card-form close outside the round trip just closes
  fireEvent.click(screen.getByRole('button', { name: 'close-plan' }));
  fireEvent.click(screen.getByRole('button', { name: 'เพิ่มบัตร / สินเชื่อ' }));
  fireEvent.click(screen.getByRole('button', { name: 'close-card' }));
  expect(screen.queryByTestId('plan-form')).toBeNull();
});

test('P1-1: BACK-face "+ เพิ่มตารางผ่อน" opens the plan step locked to that loan (not the add-expense sheet)', async () => {
  await renderWith([creditCard, loanCard]);
  fireEvent.click(await screen.findByRole('button', { name: '+ เพิ่มตารางผ่อน', hidden: true }));
  expect(screen.getByTestId('plan-form')).toHaveAttribute('data-locked', 'cc_loan_new');
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('E-23: only loans → เพิ่มรายจ่าย shows the credit-card toast and opens nothing', async () => {
  await renderWith([loanCard]);
  fireEvent.click(await screen.findByRole('button', { name: /^เพิ่มรายจ่าย$/ }));
  expect(showToast).toHaveBeenCalledWith('กรุณาเพิ่มบัตรเครดิตก่อนเพิ่มรายจ่าย', 'error');
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('E-23 does not fire when a credit card exists alongside loans', async () => {
  await renderWith([loanCard, creditCard]);
  fireEvent.click(await screen.findByRole('button', { name: /^เพิ่มรายจ่าย$/ }));
  expect(showToast).not.toHaveBeenCalledWith('กรุณาเพิ่มบัตรเครดิตก่อนเพิ่มรายจ่าย', 'error');
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});

test('deleting a loan that still has an active plan shows the loan delete-blocked toast', async () => {
  await renderWith([{ ...loanCard, ongoingPlanCount: 1, installmentCount: 1 }]);
  jest.mocked(creditCardAPI.deleteCard).mockRejectedValue(new Error('card has active installment plans'));
  fireEvent.click(await screen.findByRole('button', { name: /ตัวเลือกของบัตร บ้าน/, hidden: true }));
  fireEvent.click(screen.getByRole('menuitem', { name: /ลบสินเชื่อ/, hidden: true }));
  const confirm = screen.getByRole('alertdialog', { name: 'ลบสินเชื่อ' });
  await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'ลบสินเชื่อ' })); });
  expect(showToast).toHaveBeenCalledWith('สินเชื่อนี้ยังผ่อนไม่จบ — ต้องยกเลิกตารางผ่อนหรือผ่อนให้ครบก่อน', 'error');
});
