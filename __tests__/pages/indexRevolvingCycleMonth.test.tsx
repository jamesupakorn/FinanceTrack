// spec-credit-card-cross-month-due.md AC-15 (RR-1): home-page revolving actions write to the event's
// own cycle month (event.cycleMonth ?? selectedMonth), from both the calendar and the upcoming list.
// buildMonthEvents / collectUpcomingPayments and the page's handlers are real; only the API client,
// session/router, and the presentational children are stubbed so the handlers can be driven directly.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import DashboardPage from '../../pages/index';
import { creditCardAPI, expenseAPI } from '../../src/shared/utils/frontend/apiUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  incomeAPI: { getByMonth: jest.fn(async () => ({})) },
  expenseAPI: { getByMonth: jest.fn(async () => ({})), getAll: jest.fn() },
  savingsAPI: { getByMonth: jest.fn(async () => ({})), confirmTransfer: jest.fn() },
  salaryAPI: { getByMonth: jest.fn(async () => ({})) },
  dailyExpenseAPI: { getByMonth: jest.fn(async () => ({ totalMonthly: 0 })) },
  taxAPI: { getByYear: jest.fn(async () => ({})) },
  userSettingsAPI: { get: jest.fn(async () => ({})) },
  creditCardAPI: {
    getCards: jest.fn(),
    getPlans: jest.fn(async () => ({ plans: [] })),
    setInstallmentPaid: jest.fn(),
    setRevolvingAction: jest.fn(async () => ({ cycles: [] })),
    getRevolving: jest.fn()
  },
  withCsrfHeaders: (headers: unknown) => headers
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));
jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn(), pathname: '/', query: {}, asPath: '/' }) }));
jest.mock('../../src/frontend/contexts/SessionContext', () => {
  const session = { currentUser: { id: 'u-home', bankAccounts: [] } };
  return { useSession: () => session };
});
jest.mock('../../src/frontend/components/Layout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>
}));
jest.mock('../../src/frontend/components/CashFlowRing', () => ({ __esModule: true, default: () => null }));
jest.mock('../../src/frontend/components/BudgetHealthPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('../../src/frontend/components/NotificationBell', () => ({ __esModule: true, default: () => null }));

type StubEvent = { id: string; type: string; source: string; cycleMonth?: string; [key: string]: unknown };
type Handler = (event: StubEvent) => void;

jest.mock('../../src/frontend/components/DashboardCalendarSection', () => ({
  __esModule: true,
  default: ({ calendarData, onRevolvingFull, onRevolvingMinimum, onRevolvingCancel }: {
    calendarData: { eventsByDay: Map<number, StubEvent[]> };
    onRevolvingFull: Handler; onRevolvingMinimum: Handler; onRevolvingCancel: Handler;
  }) => {
    const events = Array.from(calendarData.eventsByDay.values()).flat()
      .filter(event => event.type === 'expense' && event.source === 'revolving');
    return (
      <section aria-label="calendar-stub">
        {events.map(event => (
          <div key={event.id} data-testid={`cal-${event.id}`}>
            <button type="button" onClick={() => onRevolvingFull(event)}>cal-full</button>
            <button type="button" onClick={() => onRevolvingMinimum(event)}>cal-min</button>
            <button type="button" onClick={() => onRevolvingCancel(event)}>cal-undo</button>
            <button type="button" onClick={() => onRevolvingFull({ ...event, cycleMonth: undefined })}>cal-full-nocycle</button>
          </div>
        ))}
      </section>
    );
  }
}));
jest.mock('../../src/frontend/components/UpcomingPayments', () => ({
  __esModule: true,
  default: ({ upcoming, onRevolvingFull, onRevolvingMinimum }: {
    upcoming: { overdue: StubEvent[]; dueToday: StubEvent[]; dueSoon: StubEvent[] };
    onRevolvingFull: Handler; onRevolvingMinimum: Handler;
  }) => {
    const events = [...upcoming.overdue, ...upcoming.dueToday, ...upcoming.dueSoon].filter(event => event.source === 'revolving');
    return (
      <section aria-label="upcoming-stub">
        {events.map(event => (
          <div key={event.id} data-testid={`up-${event.id}`}>
            <button type="button" onClick={() => onRevolvingFull(event)}>up-full</button>
            <button type="button" onClick={() => onRevolvingMinimum(event)}>up-min</button>
          </div>
        ))}
      </section>
    );
  }
}));

const api = jest.mocked(creditCardAPI);
const expenses = jest.mocked(expenseAPI);

const SP_ID = 'cc_5e5e5e5e5e5e';
const SP_KEY = 'ccr_5e5e5e5e5e5e';
const SM_ID = 'cc_777777777777';
const SM_KEY = 'ccr_777777777777';
const revolvingRow = (name: string, resolvedDueDate: string, dueDay: number) => ({
  name, actual: 1500, paid: false, account: '', dueDay, derived: true, resolvedDueDate
});

function load(monthsMap: Record<string, unknown>) {
  expenses.getByMonth.mockResolvedValue({ ค่าเช่า: { name: 'ค่าเช่า', actual: 5000, paid: false, dueDay: 1 } } as never);
  expenses.getAll.mockResolvedValue({ months: monthsMap } as never);
  api.getCards.mockResolvedValue({ cards: [
    { id: SP_ID, name: 'Shopee', statementDay: 'EOM', dueDay: 10 },
    { id: SM_ID, name: 'Same Month', statementDay: 1, dueDay: 3 }
  ] } as never);
}

function useClock(date: Date) {
  // only Date is faked; real timers keep RTL's waitFor and promises working
  jest.useFakeTimers({ now: date, doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'nextTick', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'hrtime'] });
}

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});
afterEach(() => { jest.useRealTimers(); });

describe('home page revolving actions use event.cycleMonth (AC-15)', () => {
  const NOV_VIEW = {
    '2026-10': { [SP_KEY]: revolvingRow('Shopee', '2026-11-10', 10) },
    '2026-11': { [SP_KEY]: revolvingRow('Shopee', '2026-12-10', 10) }
  };

  it('calendar (view 2026-11): full / undo / minimum on the Shopee 2026-10 event write and read cycle 2026-10', async () => {
    useClock(new Date(2026, 10, 5, 12, 0, 0));
    load(NOV_VIEW);
    api.getRevolving.mockResolvedValue({ cycles: [
      { month: '2026-10', minPaymentDue: 432, minimumPreview: { remaining: 1068, interest: 0, closingBalance: 1068 } },
      { month: '2026-11', minPaymentDue: 999, minimumPreview: { remaining: 1, interest: 1, closingBalance: 1 } }
    ] } as never);
    render(<DashboardPage />);
    const row = await screen.findByTestId(`cal-2026-10_${SP_KEY}`);
    // the Nov cycle (due 10 Dec) is not in the Nov calendar
    expect(screen.queryByTestId(`cal-2026-11_${SP_KEY}`)).not.toBeInTheDocument();

    fireEvent.click(within(row).getByText('cal-full'));
    await waitFor(() => expect(api.setRevolvingAction).toHaveBeenCalledWith(SP_ID, '2026-10', 'full'));

    fireEvent.click(within(await screen.findByTestId(`cal-2026-10_${SP_KEY}`)).getByText('cal-undo'));
    await waitFor(() => expect(api.setRevolvingAction).toHaveBeenCalledWith(SP_ID, '2026-10', null));

    fireEvent.click(within(await screen.findByTestId(`cal-2026-10_${SP_KEY}`)).getByText('cal-min'));
    await waitFor(() => expect(api.getRevolving).toHaveBeenCalledWith({ cardId: SP_ID, month: '2026-10' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('432');
    expect(dialog.textContent).not.toContain('999');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'ยืนยันจ่ายขั้นต่ำ' })); });
    await waitFor(() => expect(api.setRevolvingAction).toHaveBeenCalledWith(SP_ID, '2026-10', 'minimum'));
    expect(api.setRevolvingAction).not.toHaveBeenCalledWith(SP_ID, '2026-11', expect.anything());
  });

  it('an event without cycleMonth falls back to selectedMonth', async () => {
    useClock(new Date(2026, 10, 5, 12, 0, 0));
    load(NOV_VIEW);
    render(<DashboardPage />);
    fireEvent.click(within(await screen.findByTestId(`cal-2026-10_${SP_KEY}`)).getByText('cal-full-nocycle'));
    await waitFor(() => expect(api.setRevolvingAction).toHaveBeenCalledWith(SP_ID, '2026-11', 'full'));
  });

  it('upcoming list (today 2026-11-05): full / minimum on the Shopee item write and read cycle 2026-10', async () => {
    useClock(new Date(2026, 10, 5, 12, 0, 0));
    load(NOV_VIEW);
    api.getRevolving.mockResolvedValue({ cycles: [{ month: '2026-10', minPaymentDue: 432 }, { month: '2026-11', minPaymentDue: 999 }] } as never);
    render(<DashboardPage />);
    const item = await screen.findByTestId(`up-2026-10_${SP_KEY}`);
    fireEvent.click(within(item).getByText('up-full'));
    await waitFor(() => expect(api.setRevolvingAction).toHaveBeenCalledWith(SP_ID, '2026-10', 'full'));

    fireEvent.click(within(await screen.findByTestId(`up-2026-10_${SP_KEY}`)).getByText('up-min'));
    await waitFor(() => expect(api.getRevolving).toHaveBeenCalledWith({ cardId: SP_ID, month: '2026-10' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('432');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'ยืนยันจ่ายขั้นต่ำ' })); });
    await waitFor(() => expect(api.setRevolvingAction).toHaveBeenCalledWith(SP_ID, '2026-10', 'minimum'));
  });

  it('upcoming list: a next-month item (today 2026-11-28, same-month card cycle 2026-12 due 3 Dec) writes its own cycle 2026-12', async () => {
    useClock(new Date(2026, 10, 28, 12, 0, 0));
    load({
      '2026-11': { ค่าเช่า: { name: 'ค่าเช่า', actual: 5000, dueDay: 1 } },
      '2026-12': { [SM_KEY]: revolvingRow('Same Month', '2026-12-03', 3) }
    });
    render(<DashboardPage />);
    const item = await screen.findByTestId(`up-2026-12_${SM_KEY}`);
    fireEvent.click(within(item).getByText('up-full'));
    await waitFor(() => expect(api.setRevolvingAction).toHaveBeenCalledWith(SM_ID, '2026-12', 'full'));
    expect(api.setRevolvingAction).not.toHaveBeenCalledWith(SM_ID, '2026-11', expect.anything());
  });
});
