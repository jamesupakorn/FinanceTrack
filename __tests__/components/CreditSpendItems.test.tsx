import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CreditSpendItems from '../../src/frontend/components/CreditSpendItems';
import { creditCardAPI } from '../../src/shared/utils/frontend/apiUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  creditCardAPI: { listSpendItems: jest.fn(), createSpendItem: jest.fn(), updateSpendItem: jest.fn(), deleteSpendItem: jest.fn() }
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

const item = { id: 'si_000000000001', cardId: 'cc_000000000001', month: '2026-10', name: 'อาหาร', amount: 125 };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(creditCardAPI.listSpendItems).mockResolvedValue({ items: [item], totals: { [item.cardId]: 125 } });
});

it('adds an item through the new endpoint and reloads server totals', async () => {
  const onChanged = jest.fn();
  jest.mocked(creditCardAPI.createSpendItem).mockResolvedValue({ item });
  render(<CreditSpendItems cardId={item.cardId} month={item.month} onChanged={onChanged} />);
  await screen.findByText('อาหาร');
  fireEvent.change(screen.getByLabelText('ชื่อรายการไม่ผ่อน'), { target: { value: 'เดินทาง' } });
  fireEvent.change(screen.getByLabelText('จำนวนเงินรายการไม่ผ่อน'), { target: { value: '200' } });
  fireEvent.click(screen.getByRole('button', { name: 'เพิ่มรายการ' }));
  await waitFor(() => expect(creditCardAPI.createSpendItem).toHaveBeenCalledWith({
    cardId: item.cardId, month: item.month, name: 'เดินทาง', amount: '200'
  }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(creditCardAPI.listSpendItems).toHaveBeenCalledTimes(2);
});

it('edits without sending immutable fields, and deletion defaults to cancel with focus restored', async () => {
  jest.mocked(creditCardAPI.updateSpendItem).mockResolvedValue({ item });
  render(<CreditSpendItems cardId={item.cardId} month={item.month} onChanged={jest.fn()} />);
  await screen.findByText('อาหาร');
  fireEvent.click(screen.getByRole('button', { name: 'แก้ไข อาหาร' }));
  fireEvent.change(screen.getByLabelText('ชื่อรายการไม่ผ่อน'), { target: { value: 'อาหารเย็น' } });
  fireEvent.click(screen.getByRole('button', { name: 'บันทึกรายการ' }));
  await waitFor(() => expect(creditCardAPI.updateSpendItem).toHaveBeenCalledWith({ id: item.id, name: 'อาหารเย็น', amount: '125' }));
  const trigger = screen.getByRole('button', { name: 'ลบ อาหาร' });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole('alertdialog');
  expect(screen.getByRole('button', { name: 'ยกเลิกการลบ' })).toHaveFocus();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(creditCardAPI.deleteSpendItem).not.toHaveBeenCalled();
});
