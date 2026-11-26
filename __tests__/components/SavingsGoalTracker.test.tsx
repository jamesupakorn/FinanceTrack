/**
 * SavingsGoalTracker allocation-input refetch fix (spec §4.6 S2, AC-SGA-24; validation F-3).
 * Covers the architecture-review's 3-row truth table for the "reset allocationInputs from
 * `goals`" effect (originally at `:298-306`):
 *   1. unsaved edit survives a same-value refetch (the bug being fixed)
 *   2. first mount / a goal with no prior saved-state entry always takes the server value (S2-C-2)
 *   3. unsaved edit yields to a genuinely-changed server value (proves the fix doesn't overcorrect)
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

function goal(id: string, name: string, allocationPercent: number) {
  return {
    _id: id,
    goalName: name,
    targetAmount: 100000,
    currentAmount: 0,
    priority: 'medium',
    status: 'active',
    allocationPercent,
    metadata: { progressPercentage: 0, remainingAmount: 100000 }
  };
}

function allocInput(id: string): HTMLInputElement {
  // The "สัดส่วน" label text repeats per card, so look up by the stable per-goal id instead.
  return document.querySelector(`#card-alloc-${id}`) as HTMLInputElement;
}

async function deleteGoal(goalId: string): Promise<void> {
  fireEvent.click(screen.getByLabelText(`ลบ ${goalId}-name`));
  fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }));
  // Wait for the refetch to actually land and re-render (not just for the mock to have been
  // called) — the deleted goal's card/input must be gone for the effect-under-test to have run.
  await waitFor(() => expect(allocInput(goalId)).toBeNull());
  // The effect that re-derives allocationInputs from the new `goals` reacts to the state
  // update above in a separate passive-effect pass; give React an extra tick to flush it
  // before reading the DOM, or the merge/overwrite under test may not have run yet.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

function goalWithAdjustments(id: string, name: string, adjustments: Array<{ _id: string; amount: number; note: string; createdAt: string; updatedAt: string }>) {
  const total = adjustments.reduce((sum, a) => sum + a.amount, 0);
  return {
    _id: id,
    goalName: name,
    targetAmount: 100000,
    currentAmount: total,
    priority: 'medium',
    status: 'active',
    allocationPercent: 0,
    adjustments,
    metadata: { progressPercentage: 0, remainingAmount: 100000 - total, adjustmentsTotal: total }
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  api.update.mockResolvedValue({ success: true } as never);
  api.delete.mockResolvedValue({ success: true } as never);
  api.create.mockResolvedValue({ success: true } as never);
  api.saveAllocations.mockResolvedValue({ success: true } as never);
  api.addAdjustment.mockResolvedValue({ success: true } as never);
  api.editAdjustment.mockResolvedValue({ success: true } as never);
  api.deleteAdjustment.mockResolvedValue({ success: true } as never);
});

describe('S3-C-1: goal-delete and adjustment-delete confirms share one slot', () => {
  it('opening an adjustment delete confirm closes an open goal delete confirm, and vice versa', async () => {
    const adjustment = { _id: 'adj-1', amount: 1000, note: 'โน้ต', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' };
    api.getAll.mockResolvedValue({
      goals: [goal('a', 'a-name', 20), goalWithAdjustments('b', 'b-name', [adjustment])]
    } as never);

    render(<SavingsGoalTracker />);
    await waitFor(() => expect(allocInput('a').value).toBe('20'));

    // Open the goal-delete confirm for goal "a".
    fireEvent.click(screen.getByLabelText('ลบ a-name'));
    expect(screen.getByText('ลบ “a-name” ใช่หรือไม่?')).toBeInTheDocument();

    // Expand the history and request deleting the adjustment on goal "b" — must close the goal strip.
    fireEvent.click(screen.getByText('▶ ประวัติการปรับยอด (1)'));
    fireEvent.click(screen.getByLabelText('ตัวเลือกของการปรับยอด โน้ต'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'ลบ' }));

    expect(screen.queryByText('ลบ “a-name” ใช่หรือไม่?')).not.toBeInTheDocument();
    expect(screen.getByText('ลบการปรับยอด +1,000.00 ฿ ใช่หรือไม่?')).toBeInTheDocument();

    // Opening the goal-delete confirm again must close the adjustment strip.
    fireEvent.click(screen.getByLabelText('ลบ a-name'));
    expect(screen.queryByText('ลบการปรับยอด +1,000.00 ฿ ใช่หรือไม่?')).not.toBeInTheDocument();
    expect(screen.getByText('ลบ “a-name” ใช่หรือไม่?')).toBeInTheDocument();
  });
});

describe('adjustment footer/history wiring (AC-SGA-18, 23, 25)', () => {
  it('shows the footer total and history only when the goal has adjustments', async () => {
    const adjustment = { _id: 'adj-1', amount: -500, note: 'ปรับลด', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' };
    api.getAll.mockResolvedValue({
      goals: [goal('a', 'a-name', 20), goalWithAdjustments('b', 'b-name', [adjustment])]
    } as never);

    render(<SavingsGoalTracker />);
    await waitFor(() => expect(allocInput('a').value).toBe('20'));

    // Goal "a" has no adjustments: no history disclosure, button sits alone.
    expect(screen.getByLabelText('ปรับยอด a-name')).toBeInTheDocument();
    expect(screen.queryByText(/ประวัติการปรับยอด \(0\)/)).not.toBeInTheDocument();

    // Goal "b" has one adjustment: footer total + history disclosure appear.
    expect(screen.getByLabelText('ปรับยอด b-name')).toBeInTheDocument();
    expect(screen.getByText('▶ ประวัติการปรับยอด (1)')).toBeInTheDocument();
    expect(screen.getAllByText('−500.00 ฿', { exact: false }).length).toBeGreaterThan(0);
  });

  it('deletes an adjustment, shows an undo affordance, and re-adds it on "เลิกทำ"', async () => {
    const adjustment = { _id: 'adj-1', amount: 1000, note: 'โน้ต', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' };
    api.getAll
      .mockResolvedValueOnce({ goals: [goalWithAdjustments('b', 'b-name', [adjustment])] } as never)
      .mockResolvedValueOnce({ goals: [goalWithAdjustments('b', 'b-name', [])] } as never);

    render(<SavingsGoalTracker />);
    await waitFor(() => expect(screen.getByText('▶ ประวัติการปรับยอด (1)')).toBeInTheDocument());

    fireEvent.click(screen.getByText('▶ ประวัติการปรับยอด (1)'));
    fireEvent.click(screen.getByLabelText('ตัวเลือกของการปรับยอด โน้ต'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'ลบ' }));
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }));

    await waitFor(() => expect(api.deleteAdjustment).toHaveBeenCalledWith('b', 'adj-1'));
    await waitFor(() => expect(screen.getByText('ลบการปรับยอดแล้ว · b-name')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'เลิกทำ' }));
    await waitFor(() => expect(api.addAdjustment).toHaveBeenCalledWith('b', { amount: 1000, note: 'โน้ต' }));
  });

  it('shows role="status" on the undo strip so screen readers announce the delete', async () => {
    const adjustment = { _id: 'adj-1', amount: 1000, note: 'โน้ต', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' };
    api.getAll
      .mockResolvedValueOnce({ goals: [goalWithAdjustments('b', 'b-name', [adjustment])] } as never)
      .mockResolvedValueOnce({ goals: [goalWithAdjustments('b', 'b-name', [])] } as never);

    render(<SavingsGoalTracker />);
    await waitFor(() => expect(screen.getByText('▶ ประวัติการปรับยอด (1)')).toBeInTheDocument());

    fireEvent.click(screen.getByText('▶ ประวัติการปรับยอด (1)'));
    fireEvent.click(screen.getByLabelText('ตัวเลือกของการปรับยอด โน้ต'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'ลบ' }));
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }));

    await waitFor(() => {
      const strip = screen.getByText('ลบการปรับยอดแล้ว · b-name').closest('[role="status"]');
      expect(strip).not.toBeNull();
    });
  });

  it('F-S3-1 (AC-SGA-25): deleting the LAST adjustment moves focus to the card\'s "ปรับยอด" button, not <body>', async () => {
    const adjustment = { _id: 'adj-1', amount: 1000, note: 'โน้ต', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' };
    api.getAll
      .mockResolvedValueOnce({ goals: [goalWithAdjustments('b', 'b-name', [adjustment])] } as never)
      .mockResolvedValueOnce({ goals: [goalWithAdjustments('b', 'b-name', [])] } as never);

    render(<SavingsGoalTracker />);
    await waitFor(() => screen.getByText('▶ ประวัติการปรับยอด (1)'));

    fireEvent.click(screen.getByText('▶ ประวัติการปรับยอด (1)'));
    fireEvent.click(screen.getByLabelText('ตัวเลือกของการปรับยอด โน้ต'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'ลบ' }));
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }));

    // The history disclosure must unmount (list is now empty) and focus must land on the
    // card's "ปรับยอด" button — not <body>. Regression for F-S3-1: SavingsGoalAdjustmentHistory
    // must stay mounted (no `hasAdjustments &&` guard) so its own focus-fallback effect can fire.
    await waitFor(() => expect(screen.queryByText(/ประวัติการปรับยอด/)).toBeNull());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(document.activeElement).toBe(screen.getByLabelText('ปรับยอด b-name'));
  });

  it('deviation (a): closing the dialog after a "Goal not found" error refetches goals', async () => {
    const goalData = goalWithAdjustments('b', 'b-name', []);
    api.getAll.mockResolvedValueOnce({ goals: [goalData] } as never);
    api.addAdjustment.mockRejectedValueOnce(new Error('Goal not found'));

    render(<SavingsGoalTracker />);
    await waitFor(() => screen.getByLabelText('ปรับยอด b-name'));

    fireEvent.click(screen.getByLabelText('ปรับยอด b-name'));
    fireEvent.change(screen.getByLabelText('จำนวนเงิน (บาท) *'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('หมายเหตุ *'), { target: { value: 'n' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการปรับยอด' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ไม่พบเป้าหมายนี้แล้ว'));

    expect(api.getAll).toHaveBeenCalledTimes(1);
    api.getAll.mockResolvedValueOnce({ goals: [goalData] } as never);
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    await waitFor(() => expect(api.getAll).toHaveBeenCalledTimes(2));
  });
});

describe('F-S3-2: adjustment delete-failure path (UX_SPEC §5.4 "On failure", AC-SGA-22)', () => {
  it('maps a non-stale server error to Thai, keeps the strip open, and returns focus to "ยืนยัน"', async () => {
    const adjustment = { _id: 'adj-1', amount: 1000, note: 'โน้ต', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' };
    api.getAll.mockResolvedValueOnce({ goals: [goalWithAdjustments('b', 'b-name', [adjustment])] } as never);
    api.deleteAdjustment.mockRejectedValueOnce(new Error('something unexpected'));

    render(<SavingsGoalTracker />);
    await waitFor(() => screen.getByText('▶ ประวัติการปรับยอด (1)'));

    fireEvent.click(screen.getByText('▶ ประวัติการปรับยอด (1)'));
    fireEvent.click(screen.getByLabelText('ตัวเลือกของการปรับยอด โน้ต'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'ลบ' }));
    const confirmButton = screen.getByRole('button', { name: 'ยืนยัน' });
    fireEvent.click(confirmButton);

    // (1) Toast is the mapped Thai fallback, never the raw English server message.
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('ลบการปรับยอดไม่สำเร็จ ลองอีกครั้ง', 'error'));
    expect(toastMock).not.toHaveBeenCalledWith('something unexpected', 'error');

    // (2)/(3) The strip stays open (not closed/removed) and focus returns to "ยืนยัน", not <body>.
    await waitFor(() => expect(screen.getByText('ลบการปรับยอด +1,000.00 ฿ ใช่หรือไม่?')).toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(confirmButton));

    // No refetch happened for a non-stale error — the row is still exactly as it was.
    expect(api.getAll).toHaveBeenCalledTimes(1);

    // (4) A later, unrelated refetch (e.g. after cancelling then saving a new adjustment) must
    // not use the stale afterDeleteIndexRef to jump focus to a row's ⋯ instead of "ปรับยอด".
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    api.getAll.mockResolvedValueOnce({ goals: [goalWithAdjustments('b', 'b-name', [])] } as never);
    // jsdom's fireEvent.click doesn't move focus the way a real browser click does, so focus the
    // button explicitly first — this is what lets the dialog shell capture it as the "opener" to
    // restore focus to afterwards, matching real browser behaviour.
    screen.getByLabelText('ปรับยอด b-name').focus();
    fireEvent.click(screen.getByLabelText('ปรับยอด b-name'));
    fireEvent.change(screen.getByLabelText('จำนวนเงิน (บาท) *'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('หมายเหตุ *'), { target: { value: 'z' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการปรับยอด' }));
    await waitFor(() => expect(api.getAll).toHaveBeenCalledTimes(2));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(document.activeElement).toBe(screen.getByLabelText('ปรับยอด b-name'));
  });

  it('maps "Adjustment not found" to Thai and refetches so the stale row disappears', async () => {
    const adjustment = { _id: 'adj-1', amount: 1000, note: 'โน้ต', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' };
    api.getAll
      .mockResolvedValueOnce({ goals: [goalWithAdjustments('b', 'b-name', [adjustment])] } as never)
      .mockResolvedValueOnce({ goals: [goalWithAdjustments('b', 'b-name', [])] } as never);
    api.deleteAdjustment.mockRejectedValueOnce(new Error('Adjustment not found'));

    render(<SavingsGoalTracker />);
    await waitFor(() => screen.getByText('▶ ประวัติการปรับยอด (1)'));

    fireEvent.click(screen.getByText('▶ ประวัติการปรับยอด (1)'));
    fireEvent.click(screen.getByLabelText('ตัวเลือกของการปรับยอด โน้ต'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'ลบ' }));
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('ไม่พบรายการปรับยอดนี้แล้ว — ลองโหลดหน้าใหม่', 'error'));
    // Stale row is gone server-side: the tracker refetches, and the strip/row disappear with it.
    await waitFor(() => expect(api.getAll).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/ใช่หรือไม่\?/)).not.toBeInTheDocument());
  });
});

describe('allocation input survives a same-value refetch (AC-SGA-24)', () => {
  it('keeps an unsaved edit when the refetch reports the same server allocationPercent', async () => {
    api.getAll
      .mockResolvedValueOnce({ goals: [goal('a', 'a-name', 20), goal('b', 'b-name', 30)] } as never)
      .mockResolvedValueOnce({ goals: [goal('a', 'a-name', 20)] } as never);

    render(<SavingsGoalTracker />);
    await waitFor(() => expect(allocInput('a').value).toBe('20'));

    fireEvent.change(allocInput('a'), { target: { value: '25' } });
    expect(allocInput('a').value).toBe('25');

    await deleteGoal('b');

    expect(allocInput('a').value).toBe('25');
    expect(screen.getByText('การเปลี่ยนแปลงสัดส่วนจะถูกบันทึกพร้อมปุ่มบันทึกหลักของหน้าเงินออม')).toBeInTheDocument();
  });
});

describe('first mount / new goal with no prior saved-state entry (S2-C-2)', () => {
  it('takes the server value on first load', async () => {
    api.getAll.mockResolvedValueOnce({ goals: [goal('c', 'c-name', 40)] } as never);
    render(<SavingsGoalTracker />);
    await waitFor(() => expect(allocInput('c').value).toBe('40'));
  });

  it('takes the server value for a goal newly added by a refetch', async () => {
    api.getAll
      .mockResolvedValueOnce({ goals: [goal('a', 'a-name', 20), goal('x', 'x-name', 99)] } as never)
      .mockResolvedValueOnce({ goals: [goal('a', 'a-name', 20), goal('d', 'd-name', 15)] } as never);

    render(<SavingsGoalTracker />);
    await waitFor(() => expect(allocInput('a').value).toBe('20'));

    await deleteGoal('x');

    await waitFor(() => expect(allocInput('d').value).toBe('15'));
  });
});

describe('a genuine server-side change wins over an unsaved edit', () => {
  it('overwrites the unsaved input once the server allocationPercent actually changed since the last save', async () => {
    api.getAll
      .mockResolvedValueOnce({ goals: [goal('a', 'a-name', 20), goal('b', 'b-name', 30)] } as never)
      .mockResolvedValueOnce({ goals: [goal('a', 'a-name', 50)] } as never);

    render(<SavingsGoalTracker />);
    await waitFor(() => expect(allocInput('a').value).toBe('20'));

    fireEvent.change(allocInput('a'), { target: { value: '25' } });
    expect(allocInput('a').value).toBe('25');

    await deleteGoal('b');

    await waitFor(() => expect(allocInput('a').value).toBe('50'));
  });
});
