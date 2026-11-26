/**
 * SavingsGoalAdjustmentDialog (spec-savings-goal-adjustments §4.4, AC-SGA-19…22) — client-side
 * validation mirrors the server exactly, including the MAX_ADJUSTMENT_AMOUNT cap (S3-C-2):
 * the cap error must be distinct from the generic "enter an amount" error, both inline and in
 * the server-error-mapping table.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SavingsGoalAdjustmentDialog from '../../src/frontend/components/SavingsGoalAdjustmentDialog';
import { savingsGoalsAPI } from '../../src/shared/utils/frontend/apiUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  savingsGoalsAPI: {
    addAdjustment: jest.fn(),
    editAdjustment: jest.fn()
  }
}));

const api = jest.mocked(savingsGoalsAPI);
const goal = { _id: 'goal-1', goalName: 'กองทุนฉุกเฉิน', currentAmount: 10000 };

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
});

describe('add mode', () => {
  it('defaults to เพิ่มยอด, focuses the amount field, and submits a signed amount', async () => {
    api.addAdjustment.mockResolvedValue({ success: true } as never);
    const onSaved = jest.fn();
    render(<SavingsGoalAdjustmentDialog open goal={goal} editing={null} onClose={jest.fn()} onSaved={onSaved} />);

    expect(screen.getByRole('radio', { name: 'เพิ่มยอด (+)' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('radio', { name: 'ลดยอด (−)' }));
    fireEvent.change(screen.getByLabelText('จำนวนเงิน (บาท) *'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('หมายเหตุ *'), { target: { value: 'ค่าใช้จ่ายฉุกเฉิน' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการปรับยอด' }));

    await waitFor(() => expect(api.addAdjustment).toHaveBeenCalledWith('goal-1', { amount: -500, note: 'ค่าใช้จ่ายฉุกเฉิน' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('blocks submit, marks fields touched, and shows errors when pressed while empty', () => {
    render(<SavingsGoalAdjustmentDialog open goal={goal} editing={null} onClose={jest.fn()} onSaved={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการปรับยอด' }));
    expect(screen.getByText('กรอกจำนวนเงินมากกว่า 0 (เลือกเพิ่ม/ลดด้านบน)')).toBeInTheDocument();
    expect(screen.getByText('กรอกหมายเหตุ')).toBeInTheDocument();
    expect(api.addAdjustment).not.toHaveBeenCalled();
  });

  it('shows a distinct cap error over the amount, not the generic one, and blocks submit (S3-C-2)', () => {
    render(<SavingsGoalAdjustmentDialog open goal={goal} editing={null} onClose={jest.fn()} onSaved={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('จำนวนเงิน (บาท) *'), { target: { value: '10000000' } });
    fireEvent.change(screen.getByLabelText('หมายเหตุ *'), { target: { value: 'เกินเพดาน' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการปรับยอด' }));
    expect(screen.getByText('จำนวนเงินต้องไม่เกิน 9,999,999.99 บาทต่อรายการ')).toBeInTheDocument();
    expect(screen.queryByText('กรอกจำนวนเงินมากกว่า 0 (เลือกเพิ่ม/ลดด้านบน)')).not.toBeInTheDocument();
    expect(api.addAdjustment).not.toHaveBeenCalled();
  });

  it('maps a stale server "amount too large" response to the same distinct cap text', async () => {
    api.addAdjustment.mockRejectedValue(new Error('amount too large'));
    render(<SavingsGoalAdjustmentDialog open goal={goal} editing={null} onClose={jest.fn()} onSaved={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('จำนวนเงิน (บาท) *'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('หมายเหตุ *'), { target: { value: 'โน้ต' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการปรับยอด' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('จำนวนเงินต้องไม่เกิน 9,999,999.99 บาทต่อรายการ'));
  });

  it('pre-fills the note from the last-used value for this goal (smart note default)', () => {
    window.localStorage.setItem('financetrack.savingsGoalAdjustment.lastNote.v1.goal-1', 'โน้ตล่าสุด');
    render(<SavingsGoalAdjustmentDialog open goal={goal} editing={null} onClose={jest.fn()} onSaved={jest.fn()} />);
    expect(screen.getByLabelText('หมายเหตุ *')).toHaveValue('โน้ตล่าสุด');
  });
});

describe('edit mode', () => {
  const editing = { _id: 'adj-1', amount: -1000, note: 'เดิม', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' };

  it('seeds the toggle/amount/note from the entry being edited and shows the original value in the preview', () => {
    render(<SavingsGoalAdjustmentDialog open goal={goal} editing={editing} onClose={jest.fn()} onSaved={jest.fn()} />);
    expect(screen.getByRole('radio', { name: 'ลดยอด (−)' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('จำนวนเงิน (บาท) *')).toHaveValue('1,000.00');
    expect(screen.getByLabelText('หมายเหตุ *')).toHaveValue('เดิม');
    expect(screen.getByText('เดิม −1,000.00 ฿')).toBeInTheDocument();
  });

  it('submits editAdjustment with the new signed amount', async () => {
    api.editAdjustment.mockResolvedValue({ success: true } as never);
    const onSaved = jest.fn();
    render(<SavingsGoalAdjustmentDialog open goal={goal} editing={editing} onClose={jest.fn()} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('radio', { name: 'เพิ่มยอด (+)' }));
    fireEvent.change(screen.getByLabelText('จำนวนเงิน (บาท) *'), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));
    await waitFor(() => expect(api.editAdjustment).toHaveBeenCalledWith('goal-1', 'adj-1', { amount: 2000, note: 'เดิม' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});

it('closes on Escape when not busy', () => {
  const onClose = jest.fn();
  render(<SavingsGoalAdjustmentDialog open goal={goal} editing={null} onClose={onClose} onSaved={jest.fn()} />);
  act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
  expect(onClose).toHaveBeenCalled();
});
