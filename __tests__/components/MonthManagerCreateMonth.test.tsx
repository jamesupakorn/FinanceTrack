/**
 * MonthManager — create-new-month flow + 15-month prune warning
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import MonthManager from '../../src/frontend/components/MonthManager';
import { expenseAPI, incomeAPI, salaryAPI, savingsAPI, investmentAPI } from '../../src/shared/utils/frontend/apiUtils';
import { showToast } from '../../src/shared/utils/frontend/toast';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  expenseAPI: { getAll: jest.fn(), save: jest.fn() },
  incomeAPI: { getAll: jest.fn(), save: jest.fn() },
  salaryAPI: { getByMonth: jest.fn(), save: jest.fn() },
  savingsAPI: { getAll: jest.fn(), saveList: jest.fn() },
  investmentAPI: { getAll: jest.fn(), saveList: jest.fn() },
  dailyExpenseAPI: { getByMonth: jest.fn(), save: jest.fn() }
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

function monthRange(from: string, count: number): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  for (let i = 0; i < count; i += 1) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out.sort((a, b) => b.localeCompare(a));
}

function mockSaves() {
  jest.mocked(expenseAPI.save).mockResolvedValue({ success: true });
  jest.mocked(incomeAPI.save).mockResolvedValue({ success: true });
  jest.mocked(salaryAPI.save).mockResolvedValue({ success: true });
  jest.mocked(savingsAPI.saveList).mockResolvedValue({ success: true });
  jest.mocked(investmentAPI.saveList).mockResolvedValue({ success: true });
}

function renderPicker(props: Partial<ComponentProps<typeof MonthManager>> = {}) {
  const onMonthSelected = jest.fn();
  const onDataRefresh = jest.fn();
  const onRequestClose = jest.fn();
  const utils = render(
    <MonthManager selectedMonth="2026-10" months={['2026-10', '2026-09']} onMonthSelected={onMonthSelected} onDataRefresh={onDataRefresh} open onRequestClose={onRequestClose} {...props} />
  );
  return { ...utils, onMonthSelected, onDataRefresh, onRequestClose };
}

async function openAddForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText('เพิ่มเดือนใหม่'));
  return screen.findByRole('dialog', { name: 'เพิ่มเดือนใหม่' });
}

async function addCustomMonth(user: ReturnType<typeof userEvent.setup>, month: string) {
  await openAddForm(user);
  await user.type(screen.getByLabelText('กรอกเดือนใหม่ (YYYY-MM)'), month);
  await user.click(screen.getByLabelText('เพิ่มเดือนที่กรอกเอง'));
}

const allSaveCalls = () => [expenseAPI.save, incomeAPI.save, salaryAPI.save, savingsAPI.saveList, investmentAPI.saveList]
  .reduce((sum, fn) => sum + jest.mocked(fn).mock.calls.length, 0);

beforeEach(() => {
  // pin the clock to 2026-10-29 (current 2026-10, next 2026-11)
  jest.useFakeTimers({ now: new Date(2026, 9, 29, 10, 0, 0), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'nextTick'] });
  mockSaves();
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe('MonthManager create month', () => {
  it('creates the next month, saves all 5 collections and selects it', async () => {
    const user = userEvent.setup();
    const { onMonthSelected, onDataRefresh } = renderPicker();
    await openAddForm(user);
    await user.click(screen.getByRole('button', { name: 'เพิ่มเดือนถัดไป (2026-11)' }));
    await waitFor(() => expect(onMonthSelected).toHaveBeenCalledWith('2026-11'));
    expect(allSaveCalls()).toBe(5);
    expect(onDataRefresh).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('เพิ่มเดือน'), 'success');
  });

  it('existing month -> info toast, switches to it, saves nothing', async () => {
    const user = userEvent.setup();
    const { onMonthSelected, onRequestClose } = renderPicker();
    await addCustomMonth(user, '2026-09');
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('อยู่แล้ว'), 'info');
    expect(onMonthSelected).toHaveBeenCalledWith('2026-09');
    expect(onRequestClose).toHaveBeenCalled();
    expect(allSaveCalls()).toBe(0);
  });

  it('> 15 months -> prune alertdialog lists the pruned months; cancel saves nothing', async () => {
    const months = monthRange('2025-08', 15); // 2025-08..2026-10
    const user = userEvent.setup();
    const { onMonthSelected } = renderPicker({ months });
    await openAddForm(user);
    await user.click(screen.getByRole('button', { name: 'เพิ่มเดือนถัดไป (2026-11)' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('ลบถาวร');
    expect(dialog).toHaveTextContent(new Date(2025, 7, 1).toLocaleDateString('th-TH', { year: 'numeric', month: 'long' }));
    expect(allSaveCalls()).toBe(0);
    const cancel = dialog.querySelector('button') as HTMLButtonElement; // first button = ยกเลิก (default focus)
    expect(cancel).toHaveTextContent('ยกเลิก');
    await waitFor(() => expect(cancel).toHaveFocus());

    await user.click(cancel);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(allSaveCalls()).toBe(0);
    expect(onMonthSelected).not.toHaveBeenCalledWith('2026-11');
  });

  it('Escape on the prune dialog cancels without saving', async () => {
    const user = userEvent.setup();
    renderPicker({ months: monthRange('2025-08', 15) });
    await openAddForm(user);
    await user.click(screen.getByRole('button', { name: 'เพิ่มเดือนถัดไป (2026-11)' }));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'เพิ่มเดือนใหม่' })).toBeInTheDocument();
    expect(allSaveCalls()).toBe(0);
  });

  it('confirm on the prune dialog saves and selects the new month', async () => {
    const user = userEvent.setup();
    const { onMonthSelected } = renderPicker({ months: monthRange('2025-08', 15) });
    await openAddForm(user);
    await user.click(screen.getByRole('button', { name: 'เพิ่มเดือนถัดไป (2026-11)' }));
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'ลบเดือนเก่าและเพิ่มเดือนใหม่' }));
    await waitFor(() => expect(onMonthSelected).toHaveBeenCalledWith('2026-11'));
    expect(allSaveCalls()).toBe(5);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('empty far-future new month (> current+1) at 15 months -> no destructive dialog, saves and selects (server skips it)', async () => {
    const user = userEvent.setup();
    const { onMonthSelected } = renderPicker({ months: monthRange('2025-08', 15) });
    await addCustomMonth(user, '2026-12');
    await waitFor(() => expect(onMonthSelected).toHaveBeenCalledWith('2026-12'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(allSaveCalls()).toBe(5);
  });

  it('new month that would itself be pruned -> error toast, blocked, no dialog', async () => {
    const user = userEvent.setup();
    renderPicker({ months: monthRange('2025-08', 15) });
    await addCustomMonth(user, '2024-01');
    expect(showToast).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(allSaveCalls()).toBe(0);
  });
});
