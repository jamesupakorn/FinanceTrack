import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CreditSpendItems from '../../src/frontend/components/CreditSpendItems';
import { creditCardAPI } from '../../src/shared/utils/frontend/apiUtils';
import { getCurrentDateInfo } from '../../src/shared/utils/dateUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  creditCardAPI: { listSpendItems: jest.fn(), createSpendItem: jest.fn(), updateSpendItem: jest.fn(), deleteSpendItem: jest.fn() }
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

const item = { id: 'si_000000000001', cardId: 'cc_000000000001', month: '2026-10', purchaseDate: '2026-10-10', name: 'อาหาร', amount: 125 };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(creditCardAPI.listSpendItems).mockResolvedValue({ items: [item], totals: { [item.cardId]: 125 } });
});

it('adds an item with a purchase date and previews the derived billing month and due date', async () => {
  const onChanged = jest.fn();
  jest.mocked(creditCardAPI.createSpendItem).mockResolvedValue({ item });
  render(<CreditSpendItems cardId={item.cardId} month={item.month} statementDay={15} dueDay={20} onChanged={onChanged} />);
  await screen.findByText('อาหาร');
  expect(screen.getByLabelText('วันที่ซื้อรายการไม่ผ่อน')).toHaveValue(getCurrentDateInfo()?.dateKey);
  fireEvent.change(screen.getByLabelText('ชื่อรายการไม่ผ่อน'), { target: { value: 'เดินทาง' } });
  fireEvent.change(screen.getByLabelText('จำนวนเงินรายการไม่ผ่อน'), { target: { value: '200' } });
  fireEvent.change(screen.getByLabelText('วันที่ซื้อรายการไม่ผ่อน'), { target: { value: '2026-10-16' } });
  expect(screen.getByRole('status')).toHaveTextContent('รอบบิล พ.ย. 2569 · ครบกำหนด 20 พ.ย. 2569');
  fireEvent.change(screen.getByLabelText('วันที่ซื้อรายการไม่ผ่อน'), { target: { value: '2026-10-10' } });
  fireEvent.click(screen.getByRole('button', { name: 'เพิ่มรายการ' }));
  await waitFor(() => expect(creditCardAPI.createSpendItem).toHaveBeenCalledWith({
    cardId: item.cardId, purchaseDate: '2026-10-10', name: 'เดินทาง', amount: '200'
  }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(onChanged).toHaveBeenCalledWith(item.month);
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

it('sends a changed date and navigates to the billing month returned by the server', async () => {
  const movedItem = { ...item, month: '2026-12', purchaseDate: '2026-11-16' };
  const onChanged = jest.fn();
  jest.mocked(creditCardAPI.updateSpendItem).mockResolvedValue({ item: movedItem });
  render(<CreditSpendItems cardId={item.cardId} month={item.month} statementDay={15} dueDay={20} onChanged={onChanged} />);
  await screen.findByText('อาหาร');
  fireEvent.click(screen.getByRole('button', { name: 'แก้ไข อาหาร' }));
  fireEvent.change(screen.getByLabelText('วันที่ซื้อรายการไม่ผ่อน'), { target: { value: '2026-11-16' } });
  fireEvent.click(screen.getByRole('button', { name: 'บันทึกรายการ' }));
  await waitFor(() => expect(creditCardAPI.updateSpendItem).toHaveBeenCalledWith({
    id: item.id, name: item.name, amount: String(item.amount), purchaseDate: '2026-11-16'
  }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledWith('2026-12'));
  expect(creditCardAPI.listSpendItems).toHaveBeenCalledTimes(1);
});

it('keeps a date-less legacy item date-less when editing its name and amount', async () => {
  const legacyItem = { id: item.id, cardId: item.cardId, month: item.month, name: item.name, amount: item.amount };
  jest.mocked(creditCardAPI.listSpendItems).mockResolvedValue({ items: [legacyItem], totals: { [item.cardId]: item.amount } });
  jest.mocked(creditCardAPI.updateSpendItem).mockResolvedValue({ item: legacyItem });
  render(<CreditSpendItems cardId={item.cardId} month={item.month} statementDay={15} dueDay={20} onChanged={jest.fn()} />);
  await screen.findByText('อาหาร');
  fireEvent.click(screen.getByRole('button', { name: 'แก้ไข อาหาร' }));
  expect(screen.getByLabelText('วันที่ซื้อรายการไม่ผ่อน')).toHaveValue('');
  expect(screen.getByLabelText('วันที่ซื้อรายการไม่ผ่อน')).not.toBeRequired();
  fireEvent.change(screen.getByLabelText('ชื่อรายการไม่ผ่อน'), { target: { value: 'อาหารที่แก้แล้ว' } });
  fireEvent.click(screen.getByRole('button', { name: 'บันทึกรายการ' }));
  await waitFor(() => expect(creditCardAPI.updateSpendItem).toHaveBeenCalledWith({
    id: item.id, name: 'อาหารที่แก้แล้ว', amount: String(item.amount)
  }));
});

// spec-credit-card-cross-month-due.md AC-9: billing-month due hint uses resolveCardDueDate
it('cross-month card (EOM/10): billing month 2026-10 is due 10 พ.ย. 2569, not 10 ต.ค.', async () => {
  render(<CreditSpendItems cardId={item.cardId} month={item.month} statementDay="EOM" dueDay={10} onChanged={jest.fn()} />);
  await screen.findByText('อาหาร');
  fireEvent.change(screen.getByLabelText('วันที่ซื้อรายการไม่ผ่อน'), { target: { value: '2026-10-16' } });
  expect(screen.getByRole('status')).toHaveTextContent('รอบบิล ต.ค. 2569 · ครบกำหนด 10 พ.ย. 2569');
  fireEvent.change(screen.getByLabelText('วันที่ซื้อรายการไม่ผ่อน'), { target: { value: '2026-12-02' } });
  expect(screen.getByRole('status')).toHaveTextContent('รอบบิล ธ.ค. 2569 · ครบกำหนด 10 ม.ค. 2570');
});
