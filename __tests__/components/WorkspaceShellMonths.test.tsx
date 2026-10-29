/**
 * WorkspaceShell — month list rule + applyMonthChange (.pipeline/spec.md §3.2, §6).
 * Clock pinned to 2026-10-29 (current 2026-10, next 2026-11). All APIs mocked.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import WorkspaceShell from '../../src/frontend/components/WorkspaceShell';
import { expenseAPI, incomeAPI, savingsAPI, salaryAPI, investmentAPI } from '../../src/shared/utils/frontend/apiUtils';

const mockReplace = jest.fn();
let mockInitialQuery: Record<string, string> = {};
const mockUser = { id: 'u-shell-0' };

jest.mock('next/router', () => {
  const React = jest.requireActual('react');
  return {
    useRouter: () => {
      const [query, setQuery] = React.useState(mockInitialQuery);
      const replace = (url: { query: Record<string, string> }) => {
        mockReplace(url);
        // shallow replace resolves asynchronously in Next — mimic that
        return Promise.resolve().then(() => setQuery(url.query));
      };
      return { isReady: true, pathname: '/workspace/income', query, replace, push: jest.fn(), events: { on: jest.fn(), off: jest.fn() }, beforePopState: jest.fn() };
    }
  };
});

jest.mock('../../src/frontend/contexts/SessionContext', () => ({
  useSession: () => ({ currentUser: mockUser, isReady: true, selectUser: jest.fn(), logout: jest.fn() })
}));

jest.mock('../../src/frontend/components/Layout', () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>
}));

jest.mock('../../src/frontend/components/MonthManager', () => ({
  __esModule: true,
  default: ({ months, onMonthSelected, onDataRefresh }: { months: string[]; onMonthSelected: (m: string) => void; onDataRefresh: () => void }) => (
    <div>
      <output data-testid="months">{months.join(',')}</output>
      <button type="button" onClick={() => onMonthSelected('2026-11')}>pick-2026-11</button>
      <button type="button" onClick={() => { onMonthSelected('2026-12'); onDataRefresh(); }}>create-2026-12</button>
    </div>
  )
}));

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  expenseAPI: { getAll: jest.fn() },
  incomeAPI: { getAll: jest.fn() },
  savingsAPI: { getAll: jest.fn() },
  salaryAPI: { getAll: jest.fn() },
  investmentAPI: { getAll: jest.fn() }
}));

let userSeq = 0;
const storageKey = () => `edit_selected_month_${mockUser.id}`;

function mockReads({ expense = {}, income = {}, savings = {}, salary = {}, investment = {} }: Record<string, unknown> = {}) {
  jest.mocked(expenseAPI.getAll).mockResolvedValue({ months: expense });
  jest.mocked(incomeAPI.getAll).mockResolvedValue({ months: income });
  jest.mocked(savingsAPI.getAll).mockResolvedValue({ months: savings });
  jest.mocked(salaryAPI.getAll).mockResolvedValue({ months: salary });
  jest.mocked(investmentAPI.getAll).mockResolvedValue(investment);
}

function renderShell(section = 'income') {
  return render(
    <WorkspaceShell section={section}>
      {({ selectedMonth }) => <p data-testid="selected">{selectedMonth}</p>}
    </WorkspaceShell>
  );
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 9, 29, 10, 0, 0), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'nextTick'] });
  mockReplace.mockClear();
  mockInitialQuery = {};
  userSeq += 1;
  mockUser.id = `u-shell-${userSeq}`;
  localStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('WorkspaceShell month list rule', () => {
  it('always includes current, keeps an empty next month, hides an empty far-future month, shows a far-future month with data', async () => {
    mockReads({
      expense: { '2026-09': { rent: { value: 100 } }, '2026-11': {}, '2027-03': {}, '2027-05': { rent: { value: 900, paid: false } } },
      salary: { '2027-03': { income: {}, deduct: {}, note: '', overtime: [], overtimeLegacy: [], summary: { total_income: 0, total_deduct: 0, net_income: 0 } } },
      investment: { '2027-03': [] }
    });
    renderShell();
    await waitFor(() => expect(screen.getByTestId('months')).toHaveTextContent(/^2027-05,2026-11,2026-10,2026-09$/));
  });

  it('?month=2030-01 not in the list falls back to the current month', async () => {
    mockInitialQuery = { month: '2030-01' };
    mockReads({ expense: { '2026-09': { rent: { value: 100 } }, '2030-01': {} } });
    renderShell();
    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent(/^2026-10$/));
    expect(screen.getByTestId('months')).toHaveTextContent(/^2026-10,2026-09$/);
    expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ month: '2026-10' }) }));
  });
});

describe('WorkspaceShell applyMonthChange', () => {
  it.each(['income', 'expense'])('selects a month not yet in the list and keeps it (section %s); URL + localStorage match', async (section) => {
    mockReads({ expense: { '2026-09': { rent: { value: 100 } } } });
    renderShell(section);
    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent(/^2026-10$/));

    await userEvent.click(screen.getByRole('button', { name: 'pick-2026-11' }));
    await act(async () => { await Promise.resolve(); });

    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent(/^2026-11$/));
    expect(screen.getByTestId('months')).toHaveTextContent(/^2026-11,2026-10,2026-09$/);
    expect(localStorage.getItem(storageKey())).toBe('2026-11');
    expect(mockReplace).toHaveBeenLastCalledWith(expect.objectContaining({ query: expect.objectContaining({ month: '2026-11' }) }));
  });

  it('does not write the optimistic list to monthsCache (a remount re-reads the server list)', async () => {
    mockReads({ expense: { '2026-09': { rent: { value: 100 } } } });
    const first = renderShell();
    await waitFor(() => expect(screen.getByTestId('months')).toHaveTextContent(/^2026-10,2026-09$/));
    await userEvent.click(screen.getByRole('button', { name: 'pick-2026-11' }));
    await waitFor(() => expect(screen.getByTestId('months')).toHaveTextContent(/^2026-11,2026-10,2026-09$/));
    first.unmount();

    // Server never stored 2026-11; let the next fetch hang so only the cache seeds the initial list.
    jest.mocked(expenseAPI.getAll).mockReturnValue(new Promise(() => {}));
    renderShell();
    expect(screen.getByTestId('months')).toHaveTextContent(/^2026-10,2026-09$/);
  });

  it('F-1(b): a created current+2 month survives the post-create reload (selection/URL/localStorage), then is hidden again after remount', async () => {
    mockReads({ expense: { '2026-09': { rent: { value: 100 } } } });
    const first = renderShell();
    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent(/^2026-10$/));
    const fetchesBefore = jest.mocked(expenseAPI.getAll).mock.calls.length;

    await userEvent.click(screen.getByRole('button', { name: 'create-2026-12' }));
    // reload triggered by onDataRefresh resolves WITHOUT the empty far-future month (BR-b)
    await waitFor(() => expect(jest.mocked(expenseAPI.getAll).mock.calls.length).toBeGreaterThan(fetchesBefore));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

    expect(screen.getByTestId('months')).toHaveTextContent(/^2026-12,2026-10,2026-09$/);
    expect(screen.getByTestId('selected')).toHaveTextContent(/^2026-12$/);
    expect(localStorage.getItem(storageKey())).toBe('2026-12');
    expect(mockReplace).toHaveBeenLastCalledWith(expect.objectContaining({ query: expect.objectContaining({ month: '2026-12' }) }));
    first.unmount();

    // remount: no session state, server still has no data for 2026-12 -> hidden again, falls back to current
    mockInitialQuery = {};
    renderShell();
    await waitFor(() => expect(screen.getByTestId('months')).toHaveTextContent(/^2026-10,2026-09$/));
    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent(/^2026-10$/));
  });
});
