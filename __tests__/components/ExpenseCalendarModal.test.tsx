import { afterEach, describe, expect, it } from '@jest/globals';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExpenseCalendarModal from '../../src/frontend/components/ExpenseCalendarModal';
import { expenseAPI, creditCardAPI } from '../../src/shared/utils/frontend/apiUtils';
import { formatCurrency } from '../../src/shared/utils/frontend/numberUtils';
import { getCurrentMonthKey, buildInstallmentRowKey, PLAN_STATUS, addMonths } from '../../src/shared/utils/creditCardUtils';

// The only collaborator this file mocks — apiUtils' expenseAPI/creditCardAPI exports (the modal's
// two API-client collaborators). Every other module (buildMonthEvents, getTabbableElements,
// ExpenseCalendar, showToast, Icons, formatCurrency, creditCardUtils helpers) is real, per spec
// §Scope and AC-3 ("exactly one jest.mock() call").
jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  expenseAPI: { getAll: jest.fn() },
  creditCardAPI: {
    getCards: jest.fn(),
    getPlans: jest.fn(),
    setInstallmentPaid: jest.fn(),
    setRevolvingAction: jest.fn(),
    getRevolving: jest.fn(),
  },
}));

const mockedExpenseAPI = jest.mocked(expenseAPI);
const mockedCreditCardAPI = jest.mocked(creditCardAPI);

// This component reads the real system clock via getCurrentMonthKey() at mount (monthKey is not an
// injectable prop) — compute the fixture's month key the same way rather than hardcode a string that
// would silently break once the wall clock moves past it (per spec §Fixture shape).
const SELECTED_MONTH = getCurrentMonthKey();

afterEach(() => {
  jest.clearAllMocks();
});

it('AC-S19 refetches nested card breakdown after pay and never replaces the full card total with cycle.amountDue', async () => {
  const cardId = 'cc_111111111111';
  const cardRow = {
    name: 'บัตร G', actual: 1300, paid: false, dueDay: 10,
    breakdown: {
      installmentTotal: 300,
      installments: [{ key: 'cci_bbbbbbbbbbbb_01', name: 'โทรศัพท์ งวด 1', amount: 300, paid: false }],
      revolving: { newSpend: 1000, carriedBalance: 0, cashbackAmount: 0, totalDue: 1000, minPaymentDue: 100, amountDue: 1000, paymentAction: null }
    }
  };
  mockLoadOk({
    expenseRows: { ccr_111111111111: cardRow },
    cards: [{ id: cardId, name: 'บัตร G' }],
    plans: [{ id: 'ip_bbbbbbbbbbbb', cardId }]
  });
  mockedCreditCardAPI.setRevolvingAction.mockResolvedValue({ cycles: [{ month: SELECTED_MONTH, amountDue: 0, paymentAction: 'full' }] });
  const user = userEvent.setup();
  render(<ExpenseCalendarModal open onClose={jest.fn()} />);
  const pay = await screen.findByRole('button', { name: /จ่ายเต็มจำนวน/ });
  mockedExpenseAPI.getAll.mockResolvedValue({ months: { [SELECTED_MONTH]: {
    ccr_111111111111: { ...cardRow, breakdown: { ...cardRow.breakdown, revolving: { ...cardRow.breakdown.revolving, paymentAction: 'full' } } }
  } } });
  await user.click(pay);
  await waitFor(() => expect(mockedExpenseAPI.getAll).toHaveBeenCalledTimes(2));
  const day = within(screen.getByRole('grid')).getByRole('gridcell', { name: /โทรศัพท์ งวด 1/ });
  expect(day).toHaveAttribute('aria-label', expect.stringContaining('300.00'));
  expect(day).toHaveAttribute('aria-label', expect.stringContaining('1,000.00'));
});

/** Escapes regex-special characters so formatCurrency()'s output can be used literally in a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface LoadFixture {
  expenseRows?: Record<string, unknown>;
  cards?: Array<Record<string, unknown>>;
  plans?: Array<Record<string, unknown>>;
}

/** Sets up all three loadData() calls to resolve successfully with the given fixture shapes. */
function mockLoadOk({ expenseRows = {}, cards = [], plans = [] }: LoadFixture = {}) {
  mockedExpenseAPI.getAll.mockResolvedValue({ months: { [SELECTED_MONTH]: expenseRows } });
  mockedCreditCardAPI.getCards.mockResolvedValue({ cards });
  mockedCreditCardAPI.getPlans.mockResolvedValue({ plans });
}

describe('ExpenseCalendarModal', () => {
  it('1. renders nothing when closed', () => {
    const { container } = render(<ExpenseCalendarModal open={false} onClose={jest.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('2. shows the loading state while the three loadData calls are still pending', () => {
    mockedExpenseAPI.getAll.mockReturnValue(new Promise(() => {})); // never resolves
    mockedCreditCardAPI.getCards.mockReturnValue(new Promise(() => {}));
    mockedCreditCardAPI.getPlans.mockReturnValue(new Promise(() => {}));
    render(<ExpenseCalendarModal open={true} onClose={jest.fn()} />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('กำลังโหลดปฏิทิน...');
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('3. shows a retryable error state when loadData rejects, and retries loadData on click', async () => {
    mockedExpenseAPI.getAll.mockRejectedValue(new Error('network down'));
    mockedCreditCardAPI.getCards.mockResolvedValue({ cards: [] });
    mockedCreditCardAPI.getPlans.mockResolvedValue({ plans: [] });
    const user = userEvent.setup();
    render(<ExpenseCalendarModal open={true} onClose={jest.fn()} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('โหลดข้อมูลปฏิทินไม่สำเร็จ');
    expect(mockedExpenseAPI.getAll).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));

    await waitFor(() => expect(mockedExpenseAPI.getAll).toHaveBeenCalledTimes(2));
  });

  it('4. wires a plain due-date row through buildMonthEvents into the rendered calendar grid', async () => {
    mockLoadOk({
      expenseRows: {
        exp_plain_1: { name: 'ค่าไฟ', actual: 1234, account: 'กสิกร', paid: false, dueDay: 10 },
      },
    });
    render(<ExpenseCalendarModal open={true} onClose={jest.fn()} />);

    const grid = await screen.findByRole('grid');
    const amountLabel = escapeRegExp(formatCurrency(1234));
    const cell = within(grid).getByRole('gridcell', {
      name: new RegExp(`ครบกำหนด ค่าไฟ ${amountLabel} บาท`),
    });
    expect(cell).toBeInTheDocument();
  });

  it('5. closes via the X button and reports onClose({ changed: false }) (no toggle occurred)', async () => {
    mockLoadOk({ expenseRows: {} });
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(<ExpenseCalendarModal open={true} onClose={onClose} />);
    await screen.findByRole('grid');

    await user.click(screen.getByRole('button', { name: 'ปิด' }));

    expect(onClose).toHaveBeenCalledWith({ changed: false });
  });

  it('6. closes on a backdrop click, but not on a click inside the dialog', async () => {
    mockLoadOk({ expenseRows: {} });
    const onClose = jest.fn();
    const user = userEvent.setup();
    const { container } = render(<ExpenseCalendarModal open={true} onClose={onClose} />);
    await screen.findByRole('grid');

    // Click inside the dialog (event.target !== event.currentTarget of the backdrop) must not close.
    await user.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();

    // Click on the backdrop element itself must close.
    await user.click(container.firstChild as Element);
    expect(onClose).toHaveBeenCalledWith({ changed: false });
  });

  it('7. Escape closes the main modal only when no confirm dialog is open, and only the confirm dialog otherwise', async () => {
    const cardId = 'cc_eeeeeeeeeeee';
    mockLoadOk({
      expenseRows: {
        ccr_eeeeeeeeeeee: { name: 'ยอดใช้จ่ายบัตร E', actual: 5000, account: '', paid: false, dueDay: 10 },
      },
      cards: [{ id: cardId, name: 'บัตร E', color: '#111111' }],
    });
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(<ExpenseCalendarModal open={true} onClose={onClose} />);
    await screen.findByRole('grid');

    // No confirm dialog open yet — Escape closes the main modal.
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();

    // Open the minimum-payment confirm dialog (test case 10's flow, used here only to reach the
    // two-layer-modal state this test needs). findByRole (not getByRole): the day-detail pane's
    // auto-selected-day effect commits in a passive-effect pass after the grid itself is visible.
    mockedCreditCardAPI.getRevolving.mockResolvedValue({
      cycles: [{ month: SELECTED_MONTH, minPaymentDue: 500, minimumPreview: { remaining: 4500, interest: 50, closingBalance: 4550 } }],
    });
    await user.click(await screen.findByRole('button', { name: 'จ่ายขั้นต่ำ' }));
    await screen.findByRole('alertdialog');

    // Confirm dialog is open — Escape must close only that layer (onCancel), not the main modal.
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('8. moves focus to the close button ~40ms after the modal opens', async () => {
    mockLoadOk({ expenseRows: {} });
    render(<ExpenseCalendarModal open={true} onClose={jest.fn()} />);

    const closeButton = screen.getByRole('button', { name: 'ปิด' });
    await waitFor(() => expect(closeButton).toHaveFocus());
  });

  it('9. installment toggle: API call, refetch and server-confirmed status', async () => {
    const planId = 'ip_bbbbbbbbbbbb';
    const rowKey = buildInstallmentRowKey(planId, 1); // cci_bbbbbbbbbbbb_01
    mockLoadOk({
      expenseRows: {
        [rowKey]: { name: 'ผ่อนโทรศัพท์', actual: 1000, account: 'กสิกร', paid: false, dueDay: 10 },
      },
      cards: [{ id: 'cc_dddddddddddd', name: 'บัตร D', color: '#222222' }],
      plans: [{ id: planId, cardId: 'cc_dddddddddddd', itemName: 'โทรศัพท์', months: 10, status: PLAN_STATUS.ONGOING }],
    });
    mockedCreditCardAPI.setInstallmentPaid.mockResolvedValue({ plan: { status: PLAN_STATUS.ONGOING } });
    const user = userEvent.setup();
    render(<ExpenseCalendarModal open={true} onClose={jest.fn()} />);
    await screen.findByRole('grid');

    // findByRole (not getByRole): the day-detail pane's auto-selected-day effect commits in a
    // passive-effect pass after the grid itself is visible.
    const toggleButton = await screen.findByRole('button', { name: /ยังไม่ชำระ/ });
    mockedExpenseAPI.getAll.mockResolvedValue({ months: { [SELECTED_MONTH]: {
      [rowKey]: { name: 'ผ่อนโทรศัพท์', actual: 1000, account: 'กสิกร', paid: true, dueDay: 10 }
    } } });
    await user.click(toggleButton);

    expect(mockedCreditCardAPI.setInstallmentPaid).toHaveBeenCalledWith(planId, 1, true);
    expect(mockedExpenseAPI.getAll).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByRole('button', { name: /ชำระแล้ว/ })).toBeInTheDocument());
  });

  it('9b. F6: a failed refetch after a successful installment pay shows an info notice, not an error', async () => {
    const planId = 'ip_bbbbbbbbbbbb';
    const rowKey = buildInstallmentRowKey(planId, 1);
    mockLoadOk({
      expenseRows: {
        [rowKey]: { name: 'ผ่อนโทรศัพท์', actual: 1000, account: 'กสิกร', paid: false, dueDay: 10 },
      },
      cards: [{ id: 'cc_dddddddddddd', name: 'บัตร D', color: '#222222' }],
      plans: [{ id: planId, cardId: 'cc_dddddddddddd', itemName: 'โทรศัพท์', months: 10, status: PLAN_STATUS.ONGOING }],
    });
    mockedCreditCardAPI.setInstallmentPaid.mockResolvedValue({ plan: { status: PLAN_STATUS.ONGOING } });
    const toasts: Array<{ message: string; type: string }> = [];
    const onToast = (e: Event) => toasts.push((e as CustomEvent).detail);
    window.addEventListener('app:toast', onToast);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const onClose = jest.fn();
    try {
      const user = userEvent.setup();
      render(<ExpenseCalendarModal open={true} onClose={onClose} />);
      await screen.findByRole('grid');
      const toggleButton = await screen.findByRole('button', { name: /ยังไม่ชำระ/ });
      mockedExpenseAPI.getAll.mockRejectedValueOnce(new Error('network down'));
      await user.click(toggleButton);

      expect(mockedCreditCardAPI.setInstallmentPaid).toHaveBeenCalledWith(planId, 1, true);
      await waitFor(() => expect(toasts).toHaveLength(1));
      expect(toasts[0].type).toBe('info');
      expect(toasts[0].message).toContain('อัปเดตสถานะงวดแล้ว');
      expect(toasts.some(t => t.type === 'error')).toBe(false);
      // the write did happen: closing reports changed so the parent reloads
      await user.click(screen.getByRole('button', { name: 'ปิด' }));
      expect(onClose).toHaveBeenCalledWith({ changed: true });
    } finally {
      window.removeEventListener('app:toast', onToast);
      consoleError.mockRestore();
    }
  });

  it('10. BR-CC-015: revolving minimum payment requires an explicit confirm step before committing', async () => {
    const cardId = 'cc_ffffffffffff';
    mockLoadOk({
      expenseRows: {
        ccr_ffffffffffff: { name: 'ยอดใช้จ่ายบัตร F', actual: 8000, account: '', paid: false, dueDay: 10 },
      },
      cards: [{ id: cardId, name: 'บัตร F', color: '#333333' }],
    });
    mockedCreditCardAPI.getRevolving.mockResolvedValue({
      cycles: [{ month: SELECTED_MONTH, minPaymentDue: 800, minimumPreview: { remaining: 7200, interest: 100, closingBalance: 7300 } }],
    });
    const user = userEvent.setup();
    render(<ExpenseCalendarModal open={true} onClose={jest.fn()} />);
    await screen.findByRole('grid');

    // findByRole (not getByRole): the day-detail pane's auto-selected-day effect commits in a
    // passive-effect pass after the grid itself is visible.
    await user.click(await screen.findByRole('button', { name: 'จ่ายขั้นต่ำ' }));

    expect(mockedCreditCardAPI.getRevolving).toHaveBeenCalledWith({ cardId, month: SELECTED_MONTH });
    expect(mockedCreditCardAPI.setRevolvingAction).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('alertdialog', { name: /บัตร F/ });
    expect(within(dialog).getByText(new RegExp(escapeRegExp(formatCurrency(800))))).toBeInTheDocument();

    // Cancel path: must NOT call setRevolvingAction at all.
    await user.click(within(dialog).getByRole('button', { name: 'ยกเลิก' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(mockedCreditCardAPI.setRevolvingAction).not.toHaveBeenCalled();

    // Reopen and confirm this time.
    mockedCreditCardAPI.getRevolving.mockClear();
    await user.click(await screen.findByRole('button', { name: 'จ่ายขั้นต่ำ' }));
    const dialog2 = await screen.findByRole('alertdialog');
    mockedCreditCardAPI.setRevolvingAction.mockResolvedValue({
      cycles: [{ month: SELECTED_MONTH, amountDue: 0, paymentAction: 'minimum' }],
    });
    await user.click(within(dialog2).getByRole('button', { name: 'ยืนยันจ่ายขั้นต่ำ' }));

    expect(mockedCreditCardAPI.setRevolvingAction).toHaveBeenCalledWith(cardId, SELECTED_MONTH, 'minimum');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('11. revolving full-payment and cancel-payment call setRevolvingAction directly, with no confirmation dialog', async () => {
    const user = userEvent.setup();

    // Full-payment path — unpaid revolving row.
    const fullCardId = 'cc_111111111111';
    mockLoadOk({
      expenseRows: {
        ccr_111111111111: { name: 'ยอดใช้จ่ายบัตร G', actual: 3000, account: '', paid: false, dueDay: 10 },
      },
      cards: [{ id: fullCardId, name: 'บัตร G', color: '#444444' }],
    });
    mockedCreditCardAPI.setRevolvingAction.mockResolvedValue({
      cycles: [{ month: SELECTED_MONTH, amountDue: 0, paymentAction: 'full' }],
    });
    const { unmount } = render(<ExpenseCalendarModal open={true} onClose={jest.fn()} />);
    await screen.findByRole('grid');

    // findByRole (not getByRole): the day-detail pane's auto-selected-day effect commits in a
    // passive-effect pass after the grid itself is visible.
    await user.click(await screen.findByRole('button', { name: /จ่ายเต็มจำนวน/ }));
    expect(mockedCreditCardAPI.setRevolvingAction).toHaveBeenCalledWith(fullCardId, SELECTED_MONTH, 'full');
    expect(mockedCreditCardAPI.getRevolving).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    unmount();

    // Cancel-payment path — paid revolving row, fresh instance so it's the only revolving row shown.
    jest.clearAllMocks();
    const cancelCardId = 'cc_222222222222';
    mockLoadOk({
      expenseRows: {
        ccr_222222222222: { name: 'ยอดใช้จ่ายบัตร H', actual: 1500, account: '', paid: true, dueDay: 10 },
      },
      cards: [{ id: cancelCardId, name: 'บัตร H', color: '#555555' }],
    });
    mockedCreditCardAPI.setRevolvingAction.mockResolvedValue({
      cycles: [{ month: SELECTED_MONTH, amountDue: 1500, paymentAction: null }],
    });
    render(<ExpenseCalendarModal open={true} onClose={jest.fn()} />);
    await screen.findByRole('grid');

    await user.click(await screen.findByRole('button', { name: 'ยกเลิกการชำระ' }));
    expect(mockedCreditCardAPI.setRevolvingAction).toHaveBeenCalledWith(cancelCardId, SELECTED_MONTH, null);
    expect(mockedCreditCardAPI.getRevolving).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

// spec-credit-card-cross-month-due.md AC-6: actions on a cross-month event write to the event's cycle month
describe('ExpenseCalendarModal cross-month revolving actions (AC-6)', () => {
  const CYCLE_MONTH = addMonths(SELECTED_MONTH, -1);
  const cardId = 'cc_5e5e5e5e5e5e';
  const loadCrossMonth = (paid: boolean) => {
    mockedExpenseAPI.getAll.mockResolvedValue({ months: {
      [CYCLE_MONTH]: {
        ccr_5e5e5e5e5e5e: { name: 'ยอดใช้จ่ายบัตร Shopee', actual: 4000, account: '', paid, dueDay: 10, resolvedDueDate: `${SELECTED_MONTH}-10` }
      },
      [SELECTED_MONTH]: {}
    } });
    mockedCreditCardAPI.getCards.mockResolvedValue({ cards: [{ id: cardId, name: 'บัตร Shopee', color: '#ee4d2d', statementDay: 'EOM', dueDay: 10 }] });
    mockedCreditCardAPI.getPlans.mockResolvedValue({ plans: [] });
  };

  it('full payment writes the cycle month, not the viewed month', async () => {
    loadCrossMonth(false);
    mockedCreditCardAPI.setRevolvingAction.mockResolvedValue({ cycles: [] });
    const user = userEvent.setup();
    render(<ExpenseCalendarModal open onClose={jest.fn()} />);
    const grid = await screen.findByRole('grid');
    // the statement event (EOM) may be auto-selected; open the 10th, where the cross-month due sits
    await user.click(within(grid).getByRole('gridcell', { name: /ยอดใช้จ่ายบัตร Shopee/ }));
    await user.click(await screen.findByRole('button', { name: /จ่ายเต็มจำนวน/ }));
    expect(mockedCreditCardAPI.setRevolvingAction).toHaveBeenCalledWith(cardId, CYCLE_MONTH, 'full');
    expect(mockedCreditCardAPI.setRevolvingAction).not.toHaveBeenCalledWith(cardId, SELECTED_MONTH, expect.anything());
  });

  it('undo writes the cycle month', async () => {
    loadCrossMonth(true);
    mockedCreditCardAPI.setRevolvingAction.mockResolvedValue({ cycles: [] });
    const user = userEvent.setup();
    render(<ExpenseCalendarModal open onClose={jest.fn()} />);
    const grid = await screen.findByRole('grid');
    // the statement event (EOM) may be auto-selected; open the 10th, where the cross-month due sits
    await user.click(within(grid).getByRole('gridcell', { name: /ยอดใช้จ่ายบัตร Shopee/ }));
    await user.click(await screen.findByRole('button', { name: 'ยกเลิกการชำระ' }));
    expect(mockedCreditCardAPI.setRevolvingAction).toHaveBeenCalledWith(cardId, CYCLE_MONTH, null);
  });

  it('minimum: getRevolving and .find use the cycle month, confirm writes the cycle month', async () => {
    loadCrossMonth(false);
    mockedCreditCardAPI.getRevolving.mockResolvedValue({ cycles: [
      { month: CYCLE_MONTH, minPaymentDue: 432, minimumPreview: { remaining: 3568, interest: 10, closingBalance: 3578 } },
      { month: SELECTED_MONTH, minPaymentDue: 999, minimumPreview: { remaining: 1, interest: 1, closingBalance: 1 } }
    ] });
    mockedCreditCardAPI.setRevolvingAction.mockResolvedValue({ cycles: [] });
    const user = userEvent.setup();
    render(<ExpenseCalendarModal open onClose={jest.fn()} />);
    const grid = await screen.findByRole('grid');
    // the statement event (EOM) may be auto-selected; open the 10th, where the cross-month due sits
    await user.click(within(grid).getByRole('gridcell', { name: /ยอดใช้จ่ายบัตร Shopee/ }));
    await user.click(await screen.findByRole('button', { name: 'จ่ายขั้นต่ำ' }));
    expect(mockedCreditCardAPI.getRevolving).toHaveBeenCalledWith({ cardId, month: CYCLE_MONTH });
    const dialog = await screen.findByRole('alertdialog', { name: /บัตร Shopee/ });
    expect(within(dialog).getByText(new RegExp(escapeRegExp(formatCurrency(432))))).toBeInTheDocument();
    expect(within(dialog).queryByText(new RegExp(escapeRegExp(formatCurrency(999))))).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'ยืนยันจ่ายขั้นต่ำ' }));
    expect(mockedCreditCardAPI.setRevolvingAction).toHaveBeenCalledWith(cardId, CYCLE_MONTH, 'minimum');
  });
});
