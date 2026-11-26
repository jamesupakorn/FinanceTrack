/**
 * savings-loan-withdrawal S6 — goal-card loan/withdrawal display lines (UX_SPEC §7.1, AC-SLW-31)
 * and the delete-guard message (UX_SPEC §7.2, AC-SLW-32, R-SLW-6). New sibling test file per
 * D-S6-2 — SavingsGoalTracker.test.tsx itself is not edited.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SavingsGoalTracker from '../../src/frontend/components/SavingsGoalTracker';
import { savingsGoalsAPI, salaryAPI, incomeAPI, expenseAPI, dailyExpenseAPI } from '../../src/shared/utils/frontend/apiUtils';
import { showToast } from '../../src/shared/utils/frontend/toast';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  savingsGoalsAPI: {
    getAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    saveAllocations: jest.fn(),
    addAdjustment: jest.fn(),
    editAdjustment: jest.fn(),
    deleteAdjustment: jest.fn()
  },
  salaryAPI: { getByMonth: jest.fn() },
  incomeAPI: { getByMonth: jest.fn() },
  expenseAPI: { getByMonth: jest.fn() },
  dailyExpenseAPI: { getByMonth: jest.fn() }
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

const api = jest.mocked(savingsGoalsAPI);
const toastMock = jest.mocked(showToast);
void salaryAPI;
void incomeAPI;
void expenseAPI;
void dailyExpenseAPI;

function activeGoal(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    goalName: name,
    targetAmount: 100000,
    currentAmount: 5000,
    priority: 'medium',
    status: 'active',
    allocationPercent: 0,
    metadata: { progressPercentage: 10, remainingAmount: 95000, ...(overrides.metadata as object) },
    ...overrides
  };
}

function completedGoal(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    goalName: name,
    targetAmount: 50000,
    currentAmount: 50000,
    priority: 'medium',
    status: 'completed',
    allocationPercent: 0,
    metadata: { progressPercentage: 100, remainingAmount: 0, ...(overrides.metadata as object) },
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  api.delete.mockResolvedValue({ success: true } as never);
});

describe('goal-card loan/withdrawal lines (UX_SPEC §7.1, AC-SLW-31)', () => {
  it('shows neither line/link when outstandingLoansTotal and withdrawalsTotal are both 0 or absent', async () => {
    api.getAll.mockResolvedValue({ goals: [activeGoal('a', 'a-name')] } as never);
    render(<SavingsGoalTracker />);
    await screen.findByText('a-name');
    expect(screen.queryByText(/ยอดยืมออกจากเป้าหมายนี้/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ถอนออกแล้ว/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ดูประวัติยืม\/ถอน/)).not.toBeInTheDocument();
  });

  it('shows the outstanding-loan line with the "คืนครบจะเป็น" sum, and the history link, on an active goal', async () => {
    api.getAll.mockResolvedValue({
      goals: [activeGoal('a', 'a-name', { currentAmount: 5000, metadata: { outstandingLoansTotal: 1200 } })]
    } as never);
    render(<SavingsGoalTracker />);
    await screen.findByText('a-name');
    expect(screen.getByText(/ยอดยืมออกจากเป้าหมายนี้/)).toBeInTheDocument();
    expect(screen.getByText('1,200.00 ฿')).toBeInTheDocument();
    expect(screen.getByText(/คืนครบจะเป็น/)).toBeInTheDocument();
    expect(screen.getByText('6,200.00 ฿')).toBeInTheDocument(); // 5,000 + 1,200
    expect(screen.getByText('ดูประวัติยืม/ถอน →')).toBeInTheDocument();
    expect(screen.queryByText(/ถอนออกแล้ว/)).not.toBeInTheDocument();
  });

  it('shows the withdrawn line on an active goal when only withdrawalsTotal > 0', async () => {
    api.getAll.mockResolvedValue({
      goals: [activeGoal('a', 'a-name', { metadata: { withdrawalsTotal: 500 } })]
    } as never);
    render(<SavingsGoalTracker />);
    await screen.findByText('a-name');
    expect(screen.getByText(/ถอนออกแล้ว/)).toBeInTheDocument();
    expect(screen.getByText('500.00 ฿')).toBeInTheDocument();
    expect(screen.getByText('ดูประวัติยืม/ถอน →')).toBeInTheDocument();
    expect(screen.queryByText(/ยอดยืมออกจากเป้าหมายนี้/)).not.toBeInTheDocument();
  });

  it('also shows both lines on a completed goal (C-S6-4 — not gated on goal.status)', async () => {
    api.getAll.mockResolvedValue({
      goals: [completedGoal('c', 'c-name', { metadata: { outstandingLoansTotal: 800, withdrawalsTotal: 300 } })]
    } as never);
    render(<SavingsGoalTracker />);
    fireEvent.click(await screen.findByText(/เป้าหมายที่สำเร็จแล้ว/));
    expect(screen.getByText(/ยอดยืมออกจากเป้าหมายนี้/)).toBeInTheDocument();
    expect(screen.getByText(/ถอนออกแล้ว/)).toBeInTheDocument();
  });

  it('builds the history link href from selectedMonth', async () => {
    api.getAll.mockResolvedValue({
      goals: [activeGoal('a', 'a-name', { metadata: { outstandingLoansTotal: 100 } })]
    } as never);
    render(<SavingsGoalTracker selectedMonth="2026-11" />);
    await screen.findByText('a-name');
    expect(screen.getByText('ดูประวัติยืม/ถอน →')).toHaveAttribute('href', '/workspace/savings?month=2026-11#savings-ledger');
  });
});

describe('delete guard for a goal with an open loan (UX_SPEC §7.2, AC-SLW-32, R-SLW-6)', () => {
  it('shows the blocked-delete message with a single [ปิด] instead of the ยืนยัน/ยกเลิก pair', async () => {
    api.getAll.mockResolvedValue({
      goals: [activeGoal('a', 'a-name', { metadata: { outstandingLoansTotal: 1200 } })]
    } as never);
    render(<SavingsGoalTracker />);
    await screen.findByText('a-name');

    fireEvent.click(screen.getByLabelText('ลบ a-name'));
    expect(screen.getByText(/ลบไม่ได้/)).toBeInTheDocument();
    expect(screen.getByText(/ยังมีเงินยืมจากเป้าหมายนี้ค้างอยู่ 1,200.00 ฿/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ปิด' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ยืนยัน' })).not.toBeInTheDocument();
    expect(screen.queryByText('ลบ “a-name” ใช่หรือไม่?')).not.toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('focuses [ปิด] when shown, and Escape/click returns focus to the trash button', async () => {
    api.getAll.mockResolvedValue({
      goals: [activeGoal('a', 'a-name', { metadata: { outstandingLoansTotal: 1200 } })]
    } as never);
    render(<SavingsGoalTracker />);
    await screen.findByText('a-name');

    const trashButton = screen.getByLabelText('ลบ a-name');
    fireEvent.click(trashButton);
    const closeButton = await screen.findByRole('button', { name: 'ปิด' });
    await waitFor(() => expect(closeButton).toHaveFocus());

    fireEvent.keyDown(closeButton, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'ปิด' })).not.toBeInTheDocument();
    expect(trashButton).toHaveFocus();
  });

  it('normal confirm (ยืนยัน/ยกเลิก) still shows when outstandingLoansTotal is 0', async () => {
    api.getAll.mockResolvedValue({ goals: [activeGoal('a', 'a-name')] } as never);
    render(<SavingsGoalTracker />);
    await screen.findByText('a-name');
    fireEvent.click(screen.getByLabelText('ลบ a-name'));
    expect(screen.getByText('ลบ “a-name” ใช่หรือไม่?')).toBeInTheDocument();
    expect(screen.queryByText(/ลบไม่ได้/)).not.toBeInTheDocument();
  });

  it('a stale 409 goal_has_open_loans on confirm shows the same blocked message as a toast, never the generic ลบไม่สำเร็จ', async () => {
    // State changed in another tab: card still shows outstandingLoansTotal 0 (stale), so the
    // normal ยืนยัน/ยกเลิก pair renders, but the server now rejects with 409.
    api.getAll.mockResolvedValue({ goals: [activeGoal('a', 'a-name')] } as never);
    const err = Object.assign(new Error('goal_has_open_loans'), { code: 'goal_has_open_loans', data: { outstanding: 750 } });
    api.delete.mockRejectedValueOnce(err);
    render(<SavingsGoalTracker />);
    await screen.findByText('a-name');

    fireEvent.click(screen.getByLabelText('ลบ a-name'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' })); });

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(
      expect.stringContaining('ยังมีเงินยืมจากเป้าหมายนี้ค้างอยู่ 750.00 ฿'),
      'error'
    ));
    expect(toastMock).not.toHaveBeenCalledWith('ลบไม่สำเร็จ', 'error');
    await waitFor(() => expect(api.getAll).toHaveBeenCalledTimes(2)); // loadGoals() refetch
  });

  it('a different delete failure still falls back to the generic ลบไม่สำเร็จ', async () => {
    api.getAll.mockResolvedValue({ goals: [activeGoal('a', 'a-name')] } as never);
    api.delete.mockRejectedValueOnce(new Error('network down'));
    render(<SavingsGoalTracker />);
    await screen.findByText('a-name');

    fireEvent.click(screen.getByLabelText('ลบ a-name'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' })); });

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('ลบไม่สำเร็จ', 'error'));
  });
});
