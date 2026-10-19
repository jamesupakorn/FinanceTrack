import { afterEach, describe, expect, it } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
