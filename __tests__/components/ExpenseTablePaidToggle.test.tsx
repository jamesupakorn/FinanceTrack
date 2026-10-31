import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExpenseTable from '../../src/frontend/components/ExpenseTable';
import { expenseAPI, creditCardAPI } from '../../src/shared/utils/frontend/apiUtils';
import { showToast } from '../../src/shared/utils/frontend/toast';
import { formatCurrency } from '../../src/shared/utils/frontend/numberUtils';

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
const MONTH = '2026-08';

const rows = {
  coffee: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false, dueDay: 'EOM' },
  tea: { name: 'ชา', actual: 20, account: 'กรุงศรี', paid: false, dueDay: 'EOM' },
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function setup() {
  api.getByMonth.mockResolvedValue(rows as never);
  cards.getMonthInstallments.mockResolvedValue([] as never);
  cards.getRevolving.mockResolvedValue(null as never);
  render(<ExpenseTable selectedMonth={MONTH} onRegisterSave={() => {}} onSaved={() => {}} markDirty={() => {}} />);
  await waitFor(() => expect(document.querySelector('[data-expense-key="coffee"]')).not.toBeNull());
  const rowButton = (key: string) => {
    const nodes = Array.from(document.querySelectorAll(`[data-expense-key="${key}"]`));
    const btn = nodes.flatMap(n => Array.from(n.querySelectorAll('button[aria-pressed]')))[0];
    return btn as HTMLButtonElement;
  };
  const buttons = () => [rowButton('coffee'), rowButton('tea')];
  return { buttons };
}

afterEach(() => { jest.clearAllMocks(); });

describe('ExpenseTable optimistic paid toggle (ADR-028)', () => {
  it('flips immediately, marks the row busy, and persists only that row', async () => {
    const pending = deferred<{ success: boolean; paid: boolean; initialized: boolean }>();
    api.setPaid.mockReturnValue(pending.promise as never);
    const { buttons } = await setup();
    const user = userEvent.setup();

    await user.click(buttons()[0]);

    expect(buttons()[0]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons()[0]).toBeDisabled();
    expect(buttons()[0]).toHaveAttribute('aria-busy', 'true');
    expect(buttons()[1]).not.toBeDisabled();
    expect(api.setPaid).toHaveBeenCalledTimes(1);
    expect(api.setPaid.mock.calls[0].slice(0, 3)).toEqual([MONTH, expect.any(String), true]);

    await act(async () => { pending.resolve({ success: true, paid: true, initialized: false }); });
    await waitFor(() => expect(buttons()[0]).not.toBeDisabled());
    expect(buttons()[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('card-total pay waits for confirmation and server refetch, retaining ordinary draft edits', async () => {
    const key = 'ccr_000000000001';
    const cardRow = {
      name: 'บัตร A', actual: 1300, paid: false, dueDay: 20, account: 'กรุงศรี',
      breakdown: {
        installments: [{ key: 'cci_000000000001_01', name: 'สินค้า งวด 1', amount: 300, paid: false }],
        installmentTotal: 300,
        revolving: { newSpend: 1000, carriedBalance: 0, cashbackAmount: 0, totalDue: 1000, minPaymentDue: 100, amountDue: 1000, paymentAction: null }
      }
    };
    api.getByMonth.mockImplementation(async requested => requested === MONTH ? { ...rows, [key]: cardRow } : rows);
    cards.getMonthInstallments.mockResolvedValue([]);
    cards.getRevolving.mockResolvedValue({ cycles: [] });
    const pending = deferred<{ success: boolean }>();
    api.setPaid.mockReturnValue(pending.promise);
    render(<ExpenseTable selectedMonth={MONTH} />);
    await waitFor(() => expect(document.querySelector(`[data-expense-key="${key}"]`)).not.toBeNull());
    const trigger = document.querySelector<HTMLButtonElement>(`[data-expense-key="${key}"] button[aria-pressed]`)!;
    const draft = document.querySelector<HTMLInputElement>('[data-expense-key="coffee"] input[inputmode="decimal"]')!;
    fireEvent.change(draft, { target: { value: '75' } });
    trigger.focus();
    fireEvent.click(trigger);
    expect(api.setPaid).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: /จ่ายขั้นต่ำ/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'ยืนยัน' }));
    // 6th arg = cycleMonth guard (spec-credit-card-due-month-placement DP-4); this row has none → undefined
    expect(api.setPaid).toHaveBeenCalledWith(MONTH, key, true, undefined, 'minimum', undefined);
    expect(trigger).toHaveAttribute('aria-pressed', 'false');
    api.getByMonth.mockResolvedValue({ ...rows, [key]: { ...cardRow, paid: true } });
    await act(async () => { pending.resolve({ success: true }); });
    await waitFor(() => expect(trigger).toHaveAttribute('aria-pressed', 'true'));
    expect(draft).toHaveValue('75');
  });

  it('opens card details without changing payment intent, dirty state, or making a mutation request', async () => {
    const key = 'ccr_000000000001';
    const cardRow = {
      name: 'บัตร A', actual: 1300, paid: false, dueDay: 20, account: 'กรุงศรี',
      breakdown: {
        installments: [{ key: 'cci_000000000001_01', name: 'สินค้า งวด 1', amount: 300, paid: false }],
        installmentTotal: 300,
        revolving: { newSpend: 1000, carriedBalance: 0, cashbackAmount: 0, totalDue: 1000, minPaymentDue: 100, amountDue: 1000, paymentAction: null }
      }
    };
    api.getByMonth.mockResolvedValue({ ...rows, [key]: cardRow } as never);
    cards.getMonthInstallments.mockResolvedValue([{ key: 'cci_000000000001_01', cardId: '000000000001', cardName: 'บัตร A' }] as never);
    cards.getRevolving.mockResolvedValue({ cycles: [] } as never);
    const markDirty = jest.fn();
    render(<ExpenseTable selectedMonth={MONTH} markDirty={markDirty} />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'ดูรายละเอียด' })).toHaveLength(2));
    const callCount = api.getByMonth.mock.calls.length;
    const paymentButton = document.querySelector<HTMLButtonElement>(`[data-expense-key="${key}"] button[aria-pressed]`)!;
    const triggers = screen.getAllByRole('button', { name: 'ดูรายละเอียด' });

    expect(triggers[0]).toHaveAttribute('aria-haspopup', 'dialog');
    expect(triggers[0]).toHaveClass('min-h-11', 'focus-visible:outline');
    expect(triggers[0].querySelector('svg')).toBeInTheDocument();
    expect(triggers[0].querySelector('span[aria-hidden="true"]')).toHaveClass('h-4', 'w-4', 'items-center');
    fireEvent.click(triggers[0]);

    const dialog = screen.getByRole('dialog', { name: 'บัตร A' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(dialog).getByText(`${formatCurrency(1300)} ฿`)).toBeInTheDocument();
    expect(paymentButton).toHaveAttribute('aria-pressed', 'false');
    expect(api.setPaid).not.toHaveBeenCalled();
    expect(api.getByMonth).toHaveBeenCalledTimes(callCount);
    expect(markDirty).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'ปิดรายละเอียดบัตร' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'ดูรายละเอียด' })[1]);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(api.setPaid).not.toHaveBeenCalled();
    expect(markDirty).not.toHaveBeenCalled();
  });

  it('closes stale details when the selected month changes', async () => {
    const key = 'ccr_000000000001';
    const cardRow = {
      name: 'บัตร A', actual: 1300, paid: false, dueDay: 20, account: 'กรุงศรี',
      breakdown: {
        installments: [],
        installmentTotal: 0,
        revolving: { newSpend: 0, carriedBalance: 0, cashbackAmount: 0, totalDue: 0, minPaymentDue: 0, amountDue: 0, paymentAction: null }
      }
    };
    api.getByMonth.mockResolvedValue({ ...rows, [key]: cardRow } as never);
    cards.getMonthInstallments.mockResolvedValue([{ key: 'cci_000000000001_01', cardId: '000000000001', cardName: 'บัตร A' }] as never);
    cards.getRevolving.mockResolvedValue({ cycles: [] } as never);
    const view = render(<ExpenseTable selectedMonth={MONTH} />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'ดูรายละเอียด' })).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('button', { name: 'ดูรายละเอียด' })[0]);
    expect(screen.getByRole('dialog', { name: 'บัตร A' })).toBeInTheDocument();

    view.rerender(<ExpenseTable selectedMonth="2026-09" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes details and restores focus when the selected row is filtered out', async () => {
    const key = 'ccr_000000000001';
    const cardRow = {
      name: 'บัตร A', actual: 1300, paid: false, dueDay: 20, account: 'กรุงศรี',
      breakdown: {
        installments: [],
        installmentTotal: 0,
        revolving: { newSpend: 0, carriedBalance: 0, cashbackAmount: 0, totalDue: 0, minPaymentDue: 0, amountDue: 0, paymentAction: null }
      }
    };
    api.getByMonth.mockResolvedValue({ ...rows, [key]: cardRow } as never);
    cards.getMonthInstallments.mockResolvedValue([{ key: 'cci_000000000001_01', cardId: '000000000001', cardName: 'บัตร A' }] as never);
    cards.getRevolving.mockResolvedValue({ cycles: [] } as never);
    render(<ExpenseTable selectedMonth={MONTH} />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'ดูรายละเอียด' })).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('button', { name: 'ดูรายละเอียด' })[0]);
    expect(screen.getByRole('dialog', { name: 'บัตร A' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'ตัวกรอง' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'ประเภท' }));
    fireEvent.click(screen.getByRole('option', { name: 'รายการทั่วไป' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'รายการค่าใช้จ่าย' })).toHaveFocus();
  });

  it('prevents same-row double submit while pending', async () => {
    const pending = deferred<{ success: boolean; paid: boolean; initialized: boolean }>();
    api.setPaid.mockReturnValue(pending.promise as never);
    const { buttons } = await setup();
    const user = userEvent.setup();
    await user.click(buttons()[0]);
    await user.click(buttons()[0]);
    expect(api.setPaid).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve({ success: true, paid: true, initialized: false }); });
  });

  it('rolls back only the failed row and shows an error toast; other rows stay', async () => {
    const first = deferred<never>();
    const second = deferred<{ success: boolean; paid: boolean; initialized: boolean }>();
    api.setPaid.mockReturnValueOnce(first.promise as never).mockReturnValueOnce(second.promise as never);
    const { buttons } = await setup();
    const user = userEvent.setup();

    await user.click(buttons()[0]);
    await user.click(buttons()[1]);
    expect(api.setPaid).toHaveBeenCalledTimes(2);

    await act(async () => { first.reject(new Error('boom')); });
    await waitFor(() => expect(buttons()[0]).toHaveAttribute('aria-pressed', 'false'));
    expect(buttons()[1]).toHaveAttribute('aria-pressed', 'true');
    expect(showToast).toHaveBeenCalledWith(expect.any(String), 'error');

    await act(async () => { second.resolve({ success: true, paid: true, initialized: false }); });
    await waitFor(() => expect(buttons()[1]).not.toBeDisabled());
    expect(buttons()[1]).toHaveAttribute('aria-pressed', 'true');
  });

  it('preserves unsaved draft edits in other fields when a toggle is saved', async () => {
    api.setPaid.mockResolvedValue({ success: true, paid: true, initialized: false } as never);
    const { buttons } = await setup();
    const user = userEvent.setup();
    const amount = document.querySelector('[data-expense-key="coffee"] input[type="number"], [data-expense-key="coffee"] input[inputmode="decimal"]') as HTMLInputElement as HTMLInputElement;
    await user.clear(amount);
    await user.type(amount, '75');
    await user.click(buttons()[0]);
    await waitFor(() => expect(buttons()[0]).not.toBeDisabled());
    expect(screen.getAllByDisplayValue(/^75/).length).toBeGreaterThan(0);
  });
});

// AC-8: card rows show/use their server-derived resolvedDueDate
describe('ExpenseTable cross-month card due date (AC-8)', () => {
  const OCT = '2026-10';
  const emptyBreakdown = {
    installments: [],
    installmentTotal: 0,
    revolving: { newSpend: 0, carriedBalance: 0, cashbackAmount: 0, totalDue: 0, minPaymentDue: 0, amountDue: 0, paymentAction: null }
  };
  const SHOPEE_KEY = 'ccr_00000000005e';
  const SAME_KEY = 'ccr_000000000077';
  const monthRows = {
    coffee: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false, dueDay: 12 },
    [SHOPEE_KEY]: { name: 'Shopee SPayLater', actual: 1500, paid: false, dueDay: 10, account: 'กรุงศรี', derived: true, resolvedDueDate: '2026-11-10', breakdown: emptyBreakdown },
    [SAME_KEY]: { name: 'Same Month Card', actual: 800, paid: false, dueDay: 25, account: 'กรุงศรี', derived: true, resolvedDueDate: '2026-10-25', breakdown: emptyBreakdown }
  };
  const dueCellText = (key: string) => {
    const row = document.querySelector(`tr[data-expense-key="${key}"]`);
    return row ? row.textContent || '' : '';
  };

  it('Shopee row for 2026-10 shows "10 พ.ย. 2569"; same-month card row still shows "วันที่ 25"', async () => {
    api.getByMonth.mockResolvedValue(monthRows as never);
    cards.getMonthInstallments.mockResolvedValue([] as never);
    cards.getRevolving.mockResolvedValue({ cycles: [] } as never);
    render(<ExpenseTable selectedMonth={OCT} />);
    await waitFor(() => expect(document.querySelector(`[data-expense-key="${SHOPEE_KEY}"]`)).not.toBeNull());
    expect(dueCellText(SHOPEE_KEY)).toContain('10 พ.ย. 2569');
    expect(dueCellText(SHOPEE_KEY)).not.toContain('วันที่ 10');
    expect(dueCellText(SAME_KEY)).toContain('วันที่ 25');
    expect(dueCellText('coffee')).toContain('วันที่ 12');
  });

  // review.md minor finding 1: the "กำหนดชำระถัดไป" insight uses the full date for a cross-month card row
  describe('next-due insight label', () => {
    const nextDueLabel = () => screen.getByText('กำหนดชำระถัดไป').nextElementSibling?.textContent;
    const renderOnly = async (rows: Record<string, unknown>, waitKey: string) => {
      api.getByMonth.mockResolvedValue(rows as never);
      cards.getMonthInstallments.mockResolvedValue([] as never);
      cards.getRevolving.mockResolvedValue({ cycles: [] } as never);
      render(<ExpenseTable selectedMonth={OCT} />);
      await waitFor(() => expect(document.querySelector(`tr[data-expense-key="${waitKey}"]`)).not.toBeNull());
    };

    it('cross-month Shopee row on the 2026-10 page shows "10 พ.ย. 2569"', async () => {
      await renderOnly({ [SHOPEE_KEY]: monthRows[SHOPEE_KEY] }, SHOPEE_KEY);
      expect(nextDueLabel()).toBe('10 พ.ย. 2569');
    });

    it('same-month card row is unchanged ("ทุกวันที่ 25")', async () => {
      await renderOnly({ [SAME_KEY]: monthRows[SAME_KEY] }, SAME_KEY);
      expect(nextDueLabel()).toBe('ทุกวันที่ 25');
    });

    it('plain row is unchanged ("ทุกวันที่ 12") when it is the earliest due', async () => {
      await renderOnly(monthRows, SHOPEE_KEY);
      expect(nextDueLabel()).toBe('ทุกวันที่ 12');
    });
  });

  // Badge/filter/sort/insights must use the real due date (2026-11-10), not dueDay-in-selected-month (2026-10-10).
  // Only Date is faked so RTL waitFor / React scheduling keep real timers.
  describe('with today faked to 2026-11-05', () => {
    beforeEach(() => {
      jest.useFakeTimers({
        now: new Date(2026, 10, 5, 12, 0, 0),
        doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
          'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
          'setTimeout', 'clearTimeout']
      });
    });
    afterEach(() => { jest.useRealTimers(); });

    const renderRows = async (rowsForMonth: Record<string, unknown>) => {
      api.getByMonth.mockResolvedValue(rowsForMonth as never);
      cards.getMonthInstallments.mockResolvedValue([] as never);
      cards.getRevolving.mockResolvedValue({ cycles: [] } as never);
      render(<ExpenseTable selectedMonth={OCT} />);
      await waitFor(() => expect(document.querySelector(`tr[data-expense-key="${SHOPEE_KEY}"]`)).not.toBeNull());
    };
    const visible = (key: string) => document.querySelector(`tr[data-expense-key="${key}"]`) !== null;
    const pickDue = (label: string) => {
      fireEvent.click(screen.getByRole('button', { name: /ตัวกรอง/ }));
      fireEvent.click(screen.getByRole('combobox', { name: 'ครบกำหนด' }));
      fireEvent.click(screen.getByRole('option', { name: label }));
    };
    const creditRowOrder = () => Array.from(document.querySelectorAll('tr[data-expense-key]'))
      .map(node => node.getAttribute('data-expense-key'))
      .filter(key => key === SHOPEE_KEY || key === SAME_KEY);

    it('due filter "ในอนาคต" keeps the Shopee row (due 2026-11-10) and drops the overdue same-month rows', async () => {
      await renderRows(monthRows);
      pickDue('ในอนาคต');
      await waitFor(() => expect(visible(SAME_KEY)).toBe(false));
      expect(visible(SHOPEE_KEY)).toBe(true);
      expect(visible('coffee')).toBe(false);
    });

    it('due filter "เลยกำหนด" excludes the Shopee row (it would be overdue if 2026-10-10 were used)', async () => {
      await renderRows(monthRows);
      pickDue('เลยกำหนด');
      await waitFor(() => expect(visible(SHOPEE_KEY)).toBe(false));
      expect(visible(SAME_KEY)).toBe(true);
      expect(visible('coffee')).toBe(true);
    });

    it('due sort orders the Shopee row by 2026-11-10 (after the 2026-10-25 card when asc, before it when desc)', async () => {
      await renderRows(monthRows);
      const sortSelect = screen.getByRole('combobox', { name: 'เรียงตาม — รายการค่าใช้จ่าย' });
      fireEvent.change(sortSelect, { target: { value: 'due-asc' } });
      await waitFor(() => expect(creditRowOrder()).toEqual([SAME_KEY, SHOPEE_KEY]));
      fireEvent.change(sortSelect, { target: { value: 'due-desc' } });
      await waitFor(() => expect(creditRowOrder()).toEqual([SHOPEE_KEY, SAME_KEY]));
    });

    it('due insights count Shopee as pending and urgent (5 days), not overdue', async () => {
      await renderRows(monthRows);
      // overdue: coffee (2026-10-12, 50) + same-month card (2026-10-25, 800); pending: Shopee (2026-11-10, 1500, 5 days -> urgent)
      expect(screen.getByText(`เลยกำหนด ${formatCurrency(850)}`)).toBeInTheDocument();
      expect(screen.getByText(`ยังไม่ถึงกำหนด ${formatCurrency(1500)}`)).toBeInTheDocument();
      expect(screen.getByText('เร่งด่วน 1')).toBeInTheDocument();
      expect(screen.getByText('เกินกำหนด 2')).toBeInTheDocument();
    });

    it('a card row with an invalid resolvedDueDate falls back to dueDay in the selected month (overdue)', async () => {
      await renderRows({ ...monthRows, [SHOPEE_KEY]: { ...monthRows[SHOPEE_KEY], resolvedDueDate: '2026-02-30' } });
      expect(dueCellText(SHOPEE_KEY)).toContain('วันที่ 10');
      expect(screen.getByText(`เลยกำหนด ${formatCurrency(2350)}`)).toBeInTheDocument();
      expect(screen.getByText('เกินกำหนด 3')).toBeInTheDocument();
      expect(screen.queryByText(/^เร่งด่วน/)).not.toBeInTheDocument();
    });
  });
});
