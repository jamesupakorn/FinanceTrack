import { afterEach, describe, expect, it } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ExpenseTable from '../../src/frontend/components/ExpenseTable';
import { expenseAPI, creditCardAPI } from '../../src/shared/utils/frontend/apiUtils';
import { formatMonthKeyTH } from '../../src/shared/utils/dateUtils';

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
const PREV = '2026-07';

const currentRows = {
  coffee: { name: 'กาแฟ', actual: '50.00', account: 'กรุงศรี', paid: false, dueDay: 'EOM' },
  tea: { name: 'ชา', actual: '20.00', account: 'กรุงศรี', paid: false, dueDay: 'EOM' },
};
// mixed paid / zero / negative rows (AC-23)
const prevRows = {
  oldA: { name: 'ค้างเก่า A', actual: '300.00', account: 'กรุงศรี', paid: false, dueDay: 5 },
  oldB: { name: 'ค้างเก่า B', actual: '150.50', account: 'กรุงศรี', paid: false, dueDay: 6 },
  oldPaid: { name: 'จ่ายแล้วเก่า', actual: '200.00', account: 'กรุงศรี', paid: true, dueDay: 7 },
  oldZero: { name: 'ศูนย์เก่า', actual: '0.00', account: 'กรุงศรี', paid: false, dueDay: 8 },
  oldNeg: { name: 'ติดลบเก่า', actual: '-50.00', account: 'กรุงศรี', paid: false, dueDay: 9 },
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

function mockMonths(byMonth: Record<string, unknown>) {
  api.getByMonth.mockImplementation((async (month: string) => byMonth[month] ?? {}) as never);
  cards.getMonthInstallments.mockResolvedValue([] as never);
  cards.getRevolving.mockResolvedValue(null as never);
}

const tableTrigger = (name: RegExp) =>
  screen.getAllByRole('button', { name }).find(button => button.closest('table'))!;

async function renderTable(month = MONTH) {
  const view = render(<ExpenseTable selectedMonth={month} onRegisterSave={() => {}} onSaved={() => {}} markDirty={() => {}} />);
  await waitFor(() => expect(document.querySelector('[data-expense-key="coffee"]')).not.toBeNull());
  return view;
}

afterEach(() => { jest.clearAllMocks(); });

describe('ExpenseTable bank account breakdown', () => {
  it('keeps previous-month rows: the prev panel lists them, and the unpaid banner matches (AC-5, AC-23)', async () => {
    mockMonths({ [MONTH]: currentRows, [PREV]: prevRows });
    await renderTable();
    const prevTrigger = await waitFor(() => tableTrigger(/^400\.50 แจกแจงยอดค้างเดือนก่อนของบัญชี กรุงศรี$/));
    fireEvent.click(prevTrigger);
    const panel = document.getElementById(prevTrigger.getAttribute('aria-controls')!)!;
    expect(panel).toHaveTextContent(`ค้างเดือนก่อน (${formatMonthKeyTH(PREV)}) · กรุงศรี`);
    expect(panel).toHaveTextContent('ค้างเก่า A');
    expect(panel).toHaveTextContent('ค้างเก่า B');
    expect(panel).toHaveTextContent('ติดลบเก่า');
    expect(panel).toHaveTextContent('ยังไม่กรอกยอดอีก 1 รายการ');
    expect(panel).not.toHaveTextContent('กาแฟ');
    // table figure is breakdown.total (300 + 150.50 - 50 = 400.50, negative rows count);
    // the banner keeps its old rule: only rows with amount > 0 (450.50 / 2 items)
    const banner = screen.getByText('ค้างจ่ายเดือนก่อน').parentElement!;
    expect(banner).toHaveTextContent('450.50');
    expect(banner).toHaveTextContent(`${formatMonthKeyTH(PREV)} · 2 รายการ`);
  });

  it('table figure equals the panel header and follows a live paid toggle (AC-10)', async () => {
    mockMonths({ [MONTH]: currentRows, [PREV]: {} });
    api.setPaid.mockResolvedValue({ success: true, paid: true, initialized: false } as never);
    await renderTable();
    const trigger = tableTrigger(/^70\.00 แจกแจงยอดเดือนนี้ของบัญชี กรุงศรี$/);
    fireEvent.click(trigger);
    const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    expect(panel).toHaveTextContent('รวม 70.00 บาท · 2 รายการ');

    const coffeeToggle = Array.from(document.querySelectorAll('[data-expense-key="coffee"]'))
      .flatMap(node => Array.from(node.querySelectorAll('button[aria-pressed]')))[0] as HTMLButtonElement;
    await act(async () => { fireEvent.click(coffeeToggle); });

    const updated = tableTrigger(/^20\.00 แจกแจงยอดเดือนนี้ของบัญชี กรุงศรี$/);
    expect(updated).toHaveAttribute('aria-expanded', 'true');
    const livePanel = document.getElementById(updated.getAttribute('aria-controls')!)!;
    expect(livePanel).toHaveTextContent('รวม 20.00 บาท · 1 รายการ');
    expect(within(livePanel).getByRole('button', { name: 'จ่ายแล้ว 1 รายการ (ไม่นับในยอด)' })).toBeInTheDocument();
  });

  it('closes an open panel when the month changes (AC-11)', async () => {
    mockMonths({ [MONTH]: currentRows, '2026-09': currentRows, [PREV]: {} });
    const view = await renderTable();
    fireEvent.click(tableTrigger(/^70\.00 แจกแจงยอดเดือนนี้/));
    expect(screen.getAllByRole('region').length).toBeGreaterThan(0);
    view.rerender(<ExpenseTable selectedMonth="2026-09" onRegisterSave={() => {}} onSaved={() => {}} markDirty={() => {}} />);
    await waitFor(() => expect(screen.queryByRole('region')).not.toBeInTheDocument());
  });

  it('a late previous-month response does not overwrite the newer month (AC-19 cancellation)', async () => {
    const lateJuly = deferred<unknown>();
    api.getByMonth.mockImplementation((async (month: string) => {
      if (month === PREV) return lateJuly.promise;
      if (month === '2026-08') return { ...currentRows, carry: { name: 'ค้างจากสิงหาคม', actual: '77.00', account: 'กรุงศรี', paid: false } };
      if (month === '2026-09') return currentRows;
      return {};
    }) as never);
    cards.getMonthInstallments.mockResolvedValue([] as never);
    cards.getRevolving.mockResolvedValue(null as never);

    const view = await renderTable(MONTH);
    view.rerender(<ExpenseTable selectedMonth="2026-09" onRegisterSave={() => {}} onSaved={() => {}} markDirty={() => {}} />);
    await waitFor(() => expect(screen.getByText('ค้างจ่ายเดือนก่อน').parentElement).toHaveTextContent(`${formatMonthKeyTH('2026-08')} · 3 รายการ`));

    await act(async () => { lateJuly.resolve(prevRows); });

    const banner = screen.getByText('ค้างจ่ายเดือนก่อน').parentElement!;
    expect(banner).toHaveTextContent('147.00');
    expect(banner).toHaveTextContent(`${formatMonthKeyTH('2026-08')} · 3 รายการ`);
    expect(banner).not.toHaveTextContent('450.50');
    expect(screen.queryByRole('button', { name: /^450\.50 แจกแจงยอดค้างเดือนก่อน/ })).not.toBeInTheDocument();
  });

  it('F-2: changing month clears the old previous-month banner and prev figures until the new response lands', async () => {
    const lateAugust = deferred<unknown>();
    let augustCalls = 0;
    api.getByMonth.mockImplementation((async (month: string) => {
      if (month === PREV) return prevRows;
      if (month === '2026-08') { augustCalls += 1; return augustCalls === 1 ? currentRows : lateAugust.promise; }
      return {};
    }) as never);
    cards.getMonthInstallments.mockResolvedValue([] as never);
    cards.getRevolving.mockResolvedValue(null as never);

    const view = await renderTable(MONTH);
    await waitFor(() => expect(screen.getByText('ค้างจ่ายเดือนก่อน').parentElement).toHaveTextContent('450.50'));
    view.rerender(<ExpenseTable selectedMonth="2026-09" onRegisterSave={() => {}} onSaved={() => {}} markDirty={() => {}} />);
    await waitFor(() => expect(augustCalls).toBe(2));

    // new month label is pending: the old July total must not appear under it
    expect(screen.queryByText('ค้างจ่ายเดือนก่อน')).not.toBeInTheDocument();
    expect(screen.queryByText(/450.50/)).not.toBeInTheDocument();

    await act(async () => { lateAugust.resolve({ carry: { name: 'ค้างจากสิงหาคม', actual: '77.00', account: 'กรุงศรี', paid: false } }); });
    const banner = await waitFor(() => screen.getByText('ค้างจ่ายเดือนก่อน').parentElement!);
    expect(banner).toHaveTextContent('77.00');
    expect(banner).toHaveTextContent(formatMonthKeyTH('2026-08'));
  });

  it('January looks at December of the previous year', async () => {
    mockMonths({ '2026-01': currentRows, '2025-12': prevRows });
    await renderTable('2026-01');
    await waitFor(() => expect(api.getByMonth).toHaveBeenCalledWith('2025-12'));
    await waitFor(() => expect(screen.getByText('ค้างจ่ายเดือนก่อน').parentElement).toHaveTextContent(`${formatMonthKeyTH('2025-12')} · 2 รายการ`));
  });

  it('failed previous-month fetch hides the prev column and triggers (AC-19)', async () => {
    api.getByMonth.mockImplementation((async (month: string) => {
      if (month === PREV) throw new Error('boom');
      return currentRows;
    }) as never);
    cards.getMonthInstallments.mockResolvedValue([] as never);
    cards.getRevolving.mockResolvedValue(null as never);
    await renderTable();
    await waitFor(() => expect(api.getByMonth).toHaveBeenCalledWith(PREV));
    expect(screen.queryByRole('button', { name: /แจกแจงยอดค้างเดือนก่อน/ })).not.toBeInTheDocument();
    expect(screen.queryByText('ค้างจ่ายเดือนก่อน')).not.toBeInTheDocument();
  });
});
