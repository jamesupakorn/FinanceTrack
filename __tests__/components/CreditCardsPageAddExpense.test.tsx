import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import CreditCardsPage from '../../pages/credits';
import { creditCardAPI, userSettingsAPI } from '../../src/shared/utils/frontend/apiUtils';
import { showToast } from '../../src/shared/utils/frontend/toast';

let openFocus: Element | null = null;
let mockQuery: Record<string, string> = {};

jest.mock('next/router', () => ({
  useRouter: () => ({ isReady: true, pathname: '/credits', query: mockQuery, push: jest.fn(), replace: jest.fn() })
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
  creditCardAPI: {
    getCards: jest.fn(), getPlans: jest.fn(), createSpendItem: jest.fn(), updateSpendItem: jest.fn(),
    listSpendItems: jest.fn(), getRevolving: jest.fn()
  },
  expenseAPI: { getByMonth: jest.fn().mockResolvedValue({}) },
  userSettingsAPI: { get: jest.fn() }
}));

const card = { id: 'c1', name: 'Shopee', statementDay: 25, dueDay: 10, limit: 10000, remainingPayable: 0, availableCredit: 0 };

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

afterEach(() => jest.useRealTimers());

beforeEach(() => {
  jest.clearAllMocks();
  openFocus = null;
  mockQuery = {};
  jest.mocked(creditCardAPI.listSpendItems).mockResolvedValue({ items: [], totals: {} } as never);
  jest.mocked(creditCardAPI.getRevolving).mockResolvedValue({ cycles: [], truncated: false } as never);
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
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /รายจ่ายธรรมดา/ }));
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

describe('detail page (?card=c1)', () => {
  beforeEach(() => {
    mockQuery = { card: 'c1' };
    jest.mocked(creditCardAPI.getCards).mockResolvedValue({ cards: [card], totals: null } as never);
  });

  test('edit path: row menu -> sheet titled "แก้ไขรายจ่าย" -> save sends the update, toasts and returns focus to the row trigger', async () => {
    const user = userEvent.setup();
    const item = { id: 'si_1', cardId: 'c1', month: '2026-10', purchaseDate: '2026-10-10', name: 'อาหาร', amount: 125 };
    jest.mocked(creditCardAPI.listSpendItems).mockResolvedValue({ items: [item], totals: { c1: 125 } } as never);
    jest.mocked(creditCardAPI.updateSpendItem).mockResolvedValue({ item: { ...item, name: 'อาหารเย็น' } } as never);
    render(<CreditCardsPage />);
    await screen.findByText('อาหาร');
    const trigger = screen.getByRole('button', { name: 'ตัวเลือกของรายการ อาหาร' });
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'แก้ไขรายการ' }));
    const dialog = await screen.findByRole('dialog', { name: 'แก้ไขรายจ่าย' });
    expect(screen.getByLabelText('ชื่อรายการ')).toHaveValue('อาหาร');
    fireEvent.change(screen.getByLabelText('ชื่อรายการ'), { target: { value: 'อาหารเย็น' } });
    await user.click(screen.getByRole('button', { name: 'บันทึกรายการ' }));
    await waitFor(() => expect(creditCardAPI.updateSpendItem).toHaveBeenCalledWith({ id: 'si_1', name: 'อาหารเย็น', amount: '125' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(showToast).toHaveBeenCalledWith('บันทึกรายการแล้ว · รอบบิล ต.ค. 2569');
    expect(screen.queryByText(/เพิ่มรายการ .* เข้ารอบบิล/)).toBeNull();
    expect(screen.getByRole('button', { name: 'ตัวเลือกของรายการ อาหาร' })).toHaveFocus();
  });

  test('AC-CD31 / DD-7: the add control hands the calendar month to the sheet (default date = today in cycle 2026-11, not the 10-25 cut-off)', async () => {
    const user = userEvent.setup();
    jest.useFakeTimers({ now: new Date('2026-11-05T09:00:00'), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask'] });
    render(<CreditCardsPage />);
    // statement 25 / due 10 is an offset-1 card: the detail opens on the payable cycle 2026-10
    await waitFor(() => expect(document.querySelector('[data-month="2026-10"]')).not.toBeNull());
    await user.click(await screen.findByRole('button', { name: 'เพิ่มรายจ่าย' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /รายจ่ายธรรมดา/ }));
    expect(screen.getByLabelText('วันที่ซื้อ')).toHaveValue('2026-11-05');
  });

  test('S-13: cancelling with the opener gone focuses the VISIBLE fallback, not the first match', async () => {
    const user = userEvent.setup();
    const original = HTMLElement.prototype.getClientRects;
    HTMLElement.prototype.getClientRects = function getClientRects(this: HTMLElement) {
      return (this.hasAttribute('data-ghost') ? [] : [{}]) as unknown as DOMRectList;
    };
    const ghost = document.createElement('button');
    ghost.setAttribute('data-add-expense-fallback', '');
    ghost.setAttribute('data-ghost', '');
    document.body.prepend(ghost);
    try {
      render(<CreditCardsPage />);
      const opener = await screen.findByRole('button', { name: 'เพิ่มรายจ่าย' });
      await user.click(opener);
      Object.defineProperty(opener, 'isConnected', { configurable: true, get: () => false });
      await user.click(await screen.findByRole('button', { name: 'ยกเลิก' }));
      expect(opener).toHaveFocus();
      expect(ghost).not.toHaveFocus();
    } finally {
      ghost.remove();
      HTMLElement.prototype.getClientRects = original;
    }
  });
});
