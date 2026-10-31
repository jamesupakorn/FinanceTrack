// spec-credit-card-due-month-placement DP-AC-11 / DP-4 / DP-8: ExpenseTable shows a cross-month card row in its
// due (table) month with a "รอบบิล ..." caption, loads card metadata for the row's cycle month, and sends the
// cycleMonth staleness guard on pay. 409 cycle_mismatch refetches and toasts the server message.
import { afterEach, describe, expect, it } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ExpenseTable from '../../src/frontend/components/ExpenseTable';
import { expenseAPI, creditCardAPI } from '../../src/shared/utils/frontend/apiUtils';
import { showToast } from '../../src/shared/utils/frontend/toast';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  expenseAPI: { getByMonth: jest.fn(), setPaid: jest.fn() },
  creditCardAPI: { getMonthInstallments: jest.fn(), getRevolving: jest.fn() },
  withCsrfHeaders: (h: unknown) => h,
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));
jest.mock('../../src/frontend/contexts/SessionContext', () => {
  const session = { currentUser: { id: 'u1', bankAccounts: ['กรุงศรี'] } };
  return { useSession: () => session };
});

const api = jest.mocked(expenseAPI);
const cards = jest.mocked(creditCardAPI);

const NOV = '2026-11';
const SHOPEE_ID = '00000000005e';
const SHOPEE_KEY = `ccr_${SHOPEE_ID}`;
const SAME_ID = '000000000077';
const SAME_KEY = `ccr_${SAME_ID}`;
const breakdown = {
  installments: [{ key: `cci_${SHOPEE_ID}_01`, name: 'สินค้า งวด 1', amount: 500, paid: false }],
  installmentTotal: 500,
  revolving: { newSpend: 1000, carriedBalance: 0, cashbackAmount: 0, totalDue: 1000, minPaymentDue: 100, amountDue: 1000, paymentAction: null }
};
const emptyBreakdown = {
  installments: [],
  installmentTotal: 0,
  revolving: { newSpend: 800, carriedBalance: 0, cashbackAmount: 0, totalDue: 800, minPaymentDue: 80, amountDue: 800, paymentAction: null }
};
// GET-shaped Nov rows: Shopee (EOM/10) shows its Oct cycle; the 5/25 card shows its Nov cycle
const novRows = {
  coffee: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false, dueDay: 12 },
  [SHOPEE_KEY]: {
    name: 'Shopee SPayLater', actual: 1500, paid: false, dueDay: 10, account: 'กรุงศรี', derived: true,
    resolvedDueDate: '2026-11-10', cycleMonth: '2026-10', breakdown
  },
  [SAME_KEY]: {
    name: 'Same Month Card', actual: 800, paid: false, dueDay: 25, account: 'กรุงศรี', derived: true,
    resolvedDueDate: '2026-11-25', cycleMonth: '2026-11', breakdown: emptyBreakdown
  }
};

function mockMeta() {
  cards.getMonthInstallments.mockImplementation((async (month: string) => (month === '2026-10'
    ? [{ key: `cci_${SHOPEE_ID}_01`, cardId: SHOPEE_ID, cardName: 'Shopee SPayLater' }]
    : [])) as never);
  cards.getRevolving.mockImplementation((async ({ month }: { month: string }) => (month === NOV
    ? { cycles: [{ key: SAME_KEY, cardId: SAME_ID, cardName: 'Same Month Card' }] }
    : { cycles: [] })) as never);
}

async function renderNov() {
  api.getByMonth.mockResolvedValue(novRows as never);
  mockMeta();
  render(<ExpenseTable selectedMonth={NOV} />);
  await waitFor(() => expect(document.querySelector(`tr[data-expense-key="${SHOPEE_KEY}"]`)).not.toBeNull());
}

const nodesFor = (key: string) => Array.from(document.querySelectorAll(`[data-expense-key="${key}"]`));
const payButton = (key: string) => document.querySelector<HTMLButtonElement>(`tr[data-expense-key="${key}"] button[aria-pressed]`)!;

afterEach(() => { jest.clearAllMocks(); });

describe('ExpenseTable due-month placement (DP-AC-11)', () => {
  it('shows "รอบบิล ต.ค. 2569" under the Shopee row on desktop and mobile; same-month card has no caption', async () => {
    await renderNov();
    const shopeeNodes = nodesFor(SHOPEE_KEY);
    // desktop <tr> + mobile card (md:hidden list) both render in jsdom
    expect(shopeeNodes.length).toBe(2);
    shopeeNodes.forEach(node => expect(within(node as HTMLElement).getByText('รอบบิล ต.ค. 2569')).toBeInTheDocument());
    nodesFor(SAME_KEY).forEach(node => expect(node.textContent).not.toContain('รอบบิล'));
    expect(nodesFor('coffee').every(node => !(node.textContent || '').includes('รอบบิล'))).toBe(true);
  });

  it('due cell reads "วันที่ 10" (the due date is in the viewed month)', async () => {
    await renderNov();
    const text = document.querySelector(`tr[data-expense-key="${SHOPEE_KEY}"]`)!.textContent || '';
    expect(text).toContain('วันที่ 10');
    expect(text).not.toContain('พ.ย.');
  });

  it('fetches card metadata for each distinct cycle month (2026-10 and 2026-11) and shows the details button', async () => {
    await renderNov();
    await waitFor(() => expect(cards.getMonthInstallments).toHaveBeenCalledWith('2026-10'));
    expect(cards.getMonthInstallments).toHaveBeenCalledWith(NOV);
    expect(cards.getRevolving).toHaveBeenCalledWith({ month: '2026-10' });
    // Shopee's meta comes only from the 2026-10 fetch: the card chip and details button must render
    await waitFor(() => expect(within(document.querySelector(`tr[data-expense-key="${SHOPEE_KEY}"]`) as HTMLElement)
      .getByRole('button', { name: 'ดูรายละเอียด' })).toBeInTheDocument());
    expect(within(document.querySelector(`tr[data-expense-key="${SHOPEE_KEY}"]`) as HTMLElement).getByText(/💳 Shopee SPayLater/)).toBeInTheDocument();
  });

  it('card details dialog subtitle shows the cycle month "รอบบิล ต.ค. 2569"', async () => {
    await renderNov();
    const shopeeTr = document.querySelector(`tr[data-expense-key="${SHOPEE_KEY}"]`) as HTMLElement;
    await waitFor(() => expect(within(shopeeTr).getByRole('button', { name: 'ดูรายละเอียด' })).toBeInTheDocument());
    fireEvent.click(within(shopeeTr).getByRole('button', { name: 'ดูรายละเอียด' }));
    const dialog = screen.getByRole('dialog', { name: 'Shopee SPayLater' });
    expect(within(dialog).getByText('รอบบิล ต.ค. 2569')).toBeInTheDocument();
  });

  it('only fetches the selected month when every card row is same-month (fetch count unchanged)', async () => {
    api.getByMonth.mockResolvedValue({ [SAME_KEY]: novRows[SAME_KEY] } as never);
    mockMeta();
    render(<ExpenseTable selectedMonth={NOV} />);
    await waitFor(() => expect(document.querySelector(`tr[data-expense-key="${SAME_KEY}"]`)).not.toBeNull());
    await waitFor(() => expect(cards.getMonthInstallments).toHaveBeenCalled());
    expect(cards.getMonthInstallments.mock.calls.every(([month]) => month === NOV)).toBe(true);
  });

  it('paying the Shopee row sends cycleMonth "2026-10" as the 6th setPaid argument with the table month', async () => {
    await renderNov();
    api.setPaid.mockResolvedValue({ success: true } as never);
    fireEvent.click(payButton(SHOPEE_KEY));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: /จ่ายเต็ม/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'ยืนยัน' }));
    expect(api.setPaid).toHaveBeenCalledWith(NOV, SHOPEE_KEY, true, undefined, 'full', '2026-10');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('paying the same-month row sends its own cycle (2026-11)', async () => {
    await renderNov();
    api.setPaid.mockResolvedValue({ success: true } as never);
    fireEvent.click(payButton(SAME_KEY));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: /จ่ายเต็ม/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'ยืนยัน' }));
    expect(api.setPaid).toHaveBeenCalledWith(NOV, SAME_KEY, true, undefined, 'full', '2026-11');
  });

  it('409 cycle_mismatch: closes the dialog, toasts the server message and refetches card rows', async () => {
    await renderNov();
    const failure = Object.assign(new Error('ข้อมูลรอบบิลของบัตรเปลี่ยนแล้ว กรุณาโหลดหน้านี้ใหม่'), { status: 409, code: 'cycle_mismatch' });
    api.setPaid.mockRejectedValue(failure as never);
    const callsBefore = api.getByMonth.mock.calls.length;
    // after the config flip the server now shows Shopee's Nov cycle in the Nov table (offset 0)
    api.getByMonth.mockResolvedValue({ ...novRows, [SHOPEE_KEY]: { ...novRows[SHOPEE_KEY], cycleMonth: NOV, resolvedDueDate: '2026-11-10' } } as never);
    fireEvent.click(payButton(SHOPEE_KEY));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: /จ่ายเต็ม/ }));
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'ยืนยัน' })); });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('ข้อมูลรอบบิลของบัตรเปลี่ยนแล้ว กรุณาโหลดหน้านี้ใหม่', 'error'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(api.getByMonth.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(api.getByMonth).toHaveBeenLastCalledWith(NOV);
    // refreshed row has no caption any more and is still unpaid
    await waitFor(() => nodesFor(SHOPEE_KEY).forEach(node => expect(node.textContent).not.toContain('รอบบิล')));
    expect(payButton(SHOPEE_KEY)).toHaveAttribute('aria-pressed', 'false');
    expect(payButton(SHOPEE_KEY)).not.toBeDisabled();
  });

  it('other errors keep the generic error toast and do not refetch', async () => {
    await renderNov();
    api.setPaid.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }) as never);
    const callsBefore = api.getByMonth.mock.calls.length;
    fireEvent.click(payButton(SHOPEE_KEY));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: /จ่ายเต็ม/ }));
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'ยืนยัน' })); });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('boom', 'error'));
    expect(api.getByMonth.mock.calls.length).toBe(callsBefore);
  });
});
