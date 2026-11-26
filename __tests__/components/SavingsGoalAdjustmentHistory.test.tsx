/**
 * SavingsGoalAdjustmentHistory (spec-savings-goal-adjustments §4.5, AC-SGA-23, 25, 26) — newest-first
 * list with a show-all toggle over 5 rows, an inline delete-confirm strip, and the UX_SPEC §5.4 focus
 * chain: next row's ⋯ → previous row's ⋯ → the card's "ปรับยอด" button once the list empties.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import SavingsGoalAdjustmentHistory from '../../src/frontend/components/SavingsGoalAdjustmentHistory';
import type { SavingsGoalAdjustment } from '../../src/shared/utils/savingsGoalAdjustments';

function entry(id: string, amount: number, note: string, createdAt: string): SavingsGoalAdjustment {
  return { _id: id, amount, note, createdAt, updatedAt: createdAt };
}

function baseProps(adjustments: SavingsGoalAdjustment[]) {
  return {
    goalName: 'กองทุนฉุกเฉิน',
    adjustments,
    deletingId: null,
    onEdit: jest.fn(),
    onRequestDelete: jest.fn(),
    onCancelDelete: jest.fn(),
    onConfirmDelete: jest.fn().mockResolvedValue(undefined),
    onEmptyFocusFallback: jest.fn()
  };
}

it('renders newest-first and collapses to 5 rows with a show-all toggle', () => {
  const adjustments = Array.from({ length: 6 }, (_, i) => entry(`a${i}`, 100, `โน้ต ${i}`, `2026-11-0${i + 1}T00:00:00.000Z`));
  render(<SavingsGoalAdjustmentHistory {...baseProps(adjustments)} />);
  fireEvent.click(screen.getByText('▶ ประวัติการปรับยอด (6)'));

  const rows = screen.getAllByText(/^โน้ต \d$/);
  expect(rows).toHaveLength(5);
  expect(rows[0]).toHaveTextContent('โน้ต 5'); // newest createdAt first

  fireEvent.click(screen.getByRole('button', { name: 'แสดงทั้งหมด (6 รายการ)' }));
  expect(screen.getAllByText(/^โน้ต \d$/)).toHaveLength(6);
});

it('opens the inline delete-confirm strip and calls onRequestDelete/onConfirmDelete', async () => {
  const adjustments = [entry('a1', 500, 'โน้ตเดียว', '2026-11-01T00:00:00.000Z')];
  const props = baseProps(adjustments);
  const { rerender } = render(<SavingsGoalAdjustmentHistory {...props} />);
  fireEvent.click(screen.getByText('▶ ประวัติการปรับยอด (1)'));

  fireEvent.click(screen.getByLabelText('ตัวเลือกของการปรับยอด โน้ตเดียว'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'ลบ' }));
  expect(props.onRequestDelete).toHaveBeenCalledWith('a1');

  // Parent owns the open/close slot (S3-C-1) — simulate it granting this row the strip.
  rerender(<SavingsGoalAdjustmentHistory {...props} deletingId="a1" />);
  expect(screen.getByText('ลบการปรับยอด +500.00 ฿ ใช่หรือไม่?')).toBeInTheDocument();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' })); });
  expect(props.onConfirmDelete).toHaveBeenCalledWith(adjustments[0]);
});

it('focuses the card\'s "ปรับยอด" button once the last row is deleted', async () => {
  const adjustments = [entry('a1', 500, 'โน้ตเดียว', '2026-11-01T00:00:00.000Z')];
  const props = baseProps(adjustments);
  const { rerender } = render(<SavingsGoalAdjustmentHistory {...props} />);
  fireEvent.click(screen.getByText('▶ ประวัติการปรับยอด (1)'));
  fireEvent.click(screen.getByLabelText('ตัวเลือกของการปรับยอด โน้ตเดียว'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'ลบ' }));
  rerender(<SavingsGoalAdjustmentHistory {...props} deletingId="a1" />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' })); });

  // The parent reloads data and the goal's `adjustments` list is now empty — same component
  // instance (same key), so its captured delete index survives into this re-render.
  rerender(<SavingsGoalAdjustmentHistory {...props} adjustments={[]} deletingId={null} />);
  expect(props.onEmptyFocusFallback).toHaveBeenCalled();
});
