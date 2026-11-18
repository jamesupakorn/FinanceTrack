// SavingsWithdrawalDialog (spec-savings-loan-withdrawal S4, UX_SPEC §4). AC-SLW-27: the required
// acknowledgement checkbox (§4.2.5), field validation and the server error mapping.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SavingsWithdrawalDialog from '../../src/frontend/components/SavingsWithdrawalDialog';
import { savingsGoalsAPI, savingsLedgerAPI } from '../../src/shared/utils/frontend/apiUtils';
import { showToast } from '../../src/shared/utils/frontend/toast';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  savingsLedgerAPI: { createWithdrawal: jest.fn() },
  savingsGoalsAPI: { getAll: jest.fn() }
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

const createWithdrawal = savingsLedgerAPI.createWithdrawal as jest.Mock;
const getAllGoals = savingsGoalsAPI.getAll as jest.Mock;

function renderDialog(props: Partial<React.ComponentProps<typeof SavingsWithdrawalDialog>> = {}) {
  const onClose = jest.fn();
  const onSaved = jest.fn().mockResolvedValue(undefined);
  const utils = render(<SavingsWithdrawalDialog open poolBalance={7500} onClose={onClose} onSaved={onSaved} {...props} />);
  return { ...utils, onClose, onSaved };
}

const amountInput = () => screen.getByLabelText('จำนวนเงิน (บาท) *') as HTMLInputElement;
const ackCheckbox = () => screen.getByLabelText('เข้าใจแล้ว ถอนครั้งนี้ไม่ต้องคืน') as HTMLInputElement;
const confirmButton = () => screen.getByRole('button', { name: /ยืนยันการถอน|กำลังบันทึก/ });

beforeEach(() => {
  jest.clearAllMocks();
  getAllGoals.mockResolvedValue({ goals: [] });
  // jsdom treats everything as offsetParent:null by default, which getTabbableElements (focusTrap.ts)
  // reads as hidden — fake a visible layout so the initial-focus/F-S4-8 tests below see real tab order.
  jest.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body);
});
afterEach(() => jest.restoreAllMocks());

it('requires the acknowledgement checkbox before submit even with a valid amount', async () => {
  renderDialog();
  fireEvent.change(amountInput(), { target: { value: '500' } });
  fireEvent.click(confirmButton());
  expect(await screen.findByText('ติ๊กยืนยันก่อนถอน')).toBeInTheDocument();
  expect(createWithdrawal).not.toHaveBeenCalled();
});

it('submits once the amount is valid and the checkbox is ticked', async () => {
  createWithdrawal.mockResolvedValue({ success: true, withdrawal: { _id: 'w1' } });
  const { onClose, onSaved } = renderDialog();
  fireEvent.change(amountInput(), { target: { value: '500' } });
  fireEvent.click(ackCheckbox());
  await act(async () => { fireEvent.click(confirmButton()); });
  await waitFor(() => expect(createWithdrawal).toHaveBeenCalledWith({ source: { type: 'pool' }, amount: 500, note: undefined }));
  expect(onSaved).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
  expect(showToast).toHaveBeenCalledWith('บันทึกการถอนแล้ว');
});

it('shows the approximate preview line labelled withdrawal, not loan', async () => {
  renderDialog();
  fireEvent.change(amountInput(), { target: { value: '1000' } });
  expect(await screen.findByTestId('savings-withdrawal-preview')).toHaveTextContent('ยอดยอดกลางหลังถอน (โดยประมาณ) 6,500.00 ฿');
});

it('maps goal_not_found to its copy and refetches the goal list', async () => {
  getAllGoals.mockResolvedValueOnce({ goals: [{ _id: 'g1', goalName: 'เที่ยวญี่ปุ่น', currentAmount: 1000 }] });
  renderDialog();
  await screen.findByRole('option', { name: /เที่ยวญี่ปุ่น/ });
  fireEvent.change(screen.getByLabelText('แหล่งเงิน *'), { target: { value: 'goal:g1' } });
  fireEvent.change(amountInput(), { target: { value: '500' } });
  fireEvent.click(ackCheckbox());
  createWithdrawal.mockRejectedValue(Object.assign(new Error('goal_not_found'), { code: 'goal_not_found' }));
  getAllGoals.mockResolvedValueOnce({ goals: [] });
  await act(async () => { fireEvent.click(confirmButton()); });
  expect(await screen.findByRole('alert')).toHaveTextContent('ไม่พบเป้าหมายนี้แล้ว — ลองเลือกแหล่งเงินใหม่');
});

it('blocks submit with the amount-required error before even checking the acknowledgement', async () => {
  renderDialog();
  fireEvent.click(ackCheckbox());
  fireEvent.click(confirmButton());
  expect(await screen.findByText('กรอกจำนวนเงินมากกว่า 0')).toBeInTheDocument();
  expect(createWithdrawal).not.toHaveBeenCalled();
});

it('defaults to the first enabled goal when the pool is disabled (F-S4-2a)', async () => {
  getAllGoals.mockResolvedValue({ goals: [{ _id: 'g1', goalName: 'เที่ยวญี่ปุ่น', currentAmount: 5000 }] });
  renderDialog({ poolBalance: 0 });
  await screen.findByRole('option', { name: /เที่ยวญี่ปุ่น/ });
  await waitFor(() => expect((screen.getByLabelText('แหล่งเงิน *') as HTMLSelectElement).value).toBe('goal:g1'));
});

it('resets the selected source on reopen instead of carrying over the previous selection (F-S4-2b)', async () => {
  getAllGoals.mockResolvedValue({ goals: [
    { _id: 'g1', goalName: 'เที่ยวญี่ปุ่น', currentAmount: 5000 },
    { _id: 'g2', goalName: 'ซื้อบ้าน', currentAmount: 9000 }
  ] });
  const { rerender } = renderDialog();
  await screen.findByRole('option', { name: /เที่ยวญี่ปุ่น/ });
  fireEvent.change(screen.getByLabelText('แหล่งเงิน *'), { target: { value: 'goal:g2' } });
  expect((screen.getByLabelText('แหล่งเงิน *') as HTMLSelectElement).value).toBe('goal:g2');

  rerender(<SavingsWithdrawalDialog open={false} poolBalance={7500} onClose={jest.fn()} onSaved={jest.fn()} />);
  rerender(<SavingsWithdrawalDialog open poolBalance={7500} onClose={jest.fn()} onSaved={jest.fn()} />);
  await screen.findByRole('option', { name: /เที่ยวญี่ปุ่น/ });
  await waitFor(() => expect((screen.getByLabelText('แหล่งเงิน *') as HTMLSelectElement).value).toBe('pool'));
});

it('focuses the source select on open when it is enabled (happy path)', async () => {
  renderDialog();
  await waitFor(() => expect(screen.getByLabelText('แหล่งเงิน *')).toHaveFocus());
});

it('focuses something inside the dialog, not the disabled source select, when there is no usable source (F-S4-8)', async () => {
  const opener = document.createElement('button');
  document.body.appendChild(opener);
  opener.focus();
  renderDialog({ poolBalance: 0 });
  await screen.findByText('ยังไม่มีเงินออมที่ใช้ได้ — บันทึกเงินออมก่อน แล้วค่อยกลับมา');

  const dialog = screen.getByRole('dialog');
  await waitFor(() => expect(document.activeElement).not.toBe(opener));
  expect(document.activeElement).not.toBe(screen.getByLabelText('แหล่งเงิน *'));
  expect(dialog).toContainElement(document.activeElement as HTMLElement);

  // Tab-trap only wraps focus when it is already inside the dialog — confirm the fallback focus
  // target actually puts us inside it, so Shift+Tab/Tab stay trapped instead of reaching `opener`.
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
  expect(document.activeElement).not.toBe(opener);
  opener.remove();
});

it('still shows the goal_not_found copy on a retry after the stale selection is dropped, not the generic fallback (F-S4-2c)', async () => {
  getAllGoals.mockResolvedValueOnce({ goals: [{ _id: 'g1', goalName: 'เที่ยวญี่ปุ่น', currentAmount: 1000 }] });
  renderDialog();
  await screen.findByRole('option', { name: /เที่ยวญี่ปุ่น/ });
  fireEvent.change(screen.getByLabelText('แหล่งเงิน *'), { target: { value: 'goal:g1' } });
  fireEvent.change(amountInput(), { target: { value: '500' } });
  fireEvent.click(ackCheckbox());

  createWithdrawal.mockRejectedValue(Object.assign(new Error('goal_not_found'), { code: 'goal_not_found' }));
  getAllGoals.mockResolvedValueOnce({ goals: [] }); // goal ถูกลบไปแล้ว — refetch ไม่เจออีก
  await act(async () => { fireEvent.click(confirmButton()); });
  expect(await screen.findByRole('alert')).toHaveTextContent('ไม่พบเป้าหมายนี้แล้ว — ลองเลือกแหล่งเงินใหม่');

  // retry: sourceKey ควรถูก re-pick กลับไปที่ pool (ตัวเดียวที่ enabled) แทนที่จะค้างเป็น null
  await waitFor(() => expect((screen.getByLabelText('แหล่งเงิน *') as HTMLSelectElement).value).toBe('pool'));
  getAllGoals.mockResolvedValueOnce({ goals: [] });
  await act(async () => { fireEvent.click(confirmButton()); });
  expect(await screen.findByRole('alert')).toHaveTextContent('ไม่พบเป้าหมายนี้แล้ว — ลองเลือกแหล่งเงินใหม่');
  expect(createWithdrawal).toHaveBeenCalledTimes(2);
});
