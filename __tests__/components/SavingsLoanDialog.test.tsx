// SavingsLoanDialog (spec-savings-loan-withdrawal S4, UX_SPEC §4). AC-SLW-26: field validation, the preview
// line's "โดยประมาณ" wording, and the server error-code mapping table (§4.5).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SavingsLoanDialog from '../../src/frontend/components/SavingsLoanDialog';
import { savingsGoalsAPI, savingsLedgerAPI } from '../../src/shared/utils/frontend/apiUtils';
import { showToast } from '../../src/shared/utils/frontend/toast';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  savingsLedgerAPI: { createLoan: jest.fn() },
  savingsGoalsAPI: { getAll: jest.fn() }
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

const createLoan = savingsLedgerAPI.createLoan as jest.Mock;
const getAllGoals = savingsGoalsAPI.getAll as jest.Mock;

function renderDialog(props: Partial<React.ComponentProps<typeof SavingsLoanDialog>> = {}) {
  const onClose = jest.fn();
  const onSaved = jest.fn().mockResolvedValue(undefined);
  const utils = render(<SavingsLoanDialog open poolBalance={7500} onClose={onClose} onSaved={onSaved} {...props} />);
  return { ...utils, onClose, onSaved };
}

const amountInput = () => screen.getByLabelText('จำนวนเงิน (บาท) *') as HTMLInputElement;
const confirmButton = () => screen.getByRole('button', { name: /ยืนยันการยืม|กำลังบันทึก/ });

beforeEach(() => {
  jest.clearAllMocks();
  getAllGoals.mockResolvedValue({ goals: [{ _id: 'g1', goalName: 'เที่ยวญี่ปุ่น', currentAmount: 5000 }] });
  // jsdom treats everything as offsetParent:null by default, which getTabbableElements (focusTrap.ts)
  // reads as hidden — fake a visible layout so the initial-focus/F-S4-8 tests below see real tab order.
  jest.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body);
});
afterEach(() => jest.restoreAllMocks());

it('defaults the source to the pool and shows the approximate preview once a valid amount is entered', async () => {
  renderDialog();
  await screen.findByRole('option', { name: /เที่ยวญี่ปุ่น/ });
  expect(screen.getByText('กรอกจำนวนเงินเพื่อดูยอดคงเหลือ')).toBeInTheDocument();
  fireEvent.change(amountInput(), { target: { value: '1000' } });
  expect(await screen.findByTestId('savings-loan-preview')).toHaveTextContent('ยอดยอดกลางหลังยืม (โดยประมาณ) 6,500.00 ฿');
});

it('blocks submit and shows a field error when the amount exceeds the selected source', async () => {
  renderDialog();
  fireEvent.change(amountInput(), { target: { value: '99999' } });
  fireEvent.click(confirmButton());
  expect(await screen.findByText('เกินยอดที่ใช้ได้ของแหล่งนี้ (ใช้ได้ 7,500.00 ฿)')).toBeInTheDocument();
  expect(createLoan).not.toHaveBeenCalled();
});

it('blocks submit with "กรอกจำนวนเงินมากกว่า 0" when the amount is empty', async () => {
  renderDialog();
  fireEvent.click(confirmButton());
  expect(await screen.findByText('กรอกจำนวนเงินมากกว่า 0')).toBeInTheDocument();
  expect(createLoan).not.toHaveBeenCalled();
});

it('submits the pool source and amount, then reports success and closes', async () => {
  createLoan.mockResolvedValue({ success: true, loan: { _id: 'l1' } });
  const { onClose, onSaved } = renderDialog();
  fireEvent.change(amountInput(), { target: { value: '1,000' } });
  await act(async () => { fireEvent.click(confirmButton()); });
  await waitFor(() => expect(createLoan).toHaveBeenCalledWith({ source: { type: 'pool' }, amount: 1000, note: undefined }));
  expect(onSaved).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
  expect(showToast).toHaveBeenCalledWith('บันทึกการยืมแล้ว');
});

it('maps insufficient_balance to the server-error copy and keeps the dialog open', async () => {
  const error = Object.assign(new Error('insufficient_balance'), { code: 'insufficient_balance', available: 500 });
  createLoan.mockRejectedValue(error);
  renderDialog();
  fireEvent.change(amountInput(), { target: { value: '1000' } });
  await act(async () => { fireEvent.click(confirmButton()); });
  expect(await screen.findByRole('alert')).toHaveTextContent('ยอดของแหล่งนี้ไม่พอ (ใช้ได้ 500.00 ฿) — ยอดอาจเปลี่ยนจากอีกแท็บ');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('maps open_loan_limit to its copy', async () => {
  createLoan.mockRejectedValue(Object.assign(new Error('open_loan_limit'), { code: 'open_loan_limit' }));
  renderDialog();
  fireEvent.change(amountInput(), { target: { value: '1000' } });
  await act(async () => { fireEvent.click(confirmButton()); });
  expect(await screen.findByRole('alert')).toHaveTextContent('มีเงินยืมที่ยังไม่คืนครบ 50 รายการแล้ว — คืนรายการเก่าก่อน');
});

it('falls back to the generic message for an unmapped error code', async () => {
  createLoan.mockRejectedValue(Object.assign(new Error('weird'), { code: 'something_else' }));
  renderDialog();
  fireEvent.change(amountInput(), { target: { value: '1000' } });
  await act(async () => { fireEvent.click(confirmButton()); });
  expect(await screen.findByRole('alert')).toHaveTextContent('บันทึกไม่สำเร็จ ลองอีกครั้ง');
});

it('disables the source select and shows the no-usable-source explainer when every option is 0 or less', async () => {
  getAllGoals.mockResolvedValue({ goals: [] });
  renderDialog({ poolBalance: 0 });
  expect(await screen.findByText('ยังไม่มีเงินออมที่ใช้ได้ — บันทึกเงินออมก่อน แล้วค่อยกลับมา')).toBeInTheDocument();
  expect(confirmButton()).toBeDisabled();
});

it('defaults to the first enabled goal when the pool is disabled (F-S4-2a)', async () => {
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

  rerender(<SavingsLoanDialog open={false} poolBalance={7500} onClose={jest.fn()} onSaved={jest.fn()} />);
  rerender(<SavingsLoanDialog open poolBalance={7500} onClose={jest.fn()} onSaved={jest.fn()} />);
  await screen.findByRole('option', { name: /เที่ยวญี่ปุ่น/ });
  await waitFor(() => expect((screen.getByLabelText('แหล่งเงิน *') as HTMLSelectElement).value).toBe('pool'));
});

it('still shows the goal_not_found copy on a retry after the stale selection is dropped, not the generic fallback (F-S4-2c)', async () => {
  renderDialog();
  await screen.findByRole('option', { name: /เที่ยวญี่ปุ่น/ });
  fireEvent.change(screen.getByLabelText('แหล่งเงิน *'), { target: { value: 'goal:g1' } });
  fireEvent.change(amountInput(), { target: { value: '500' } });

  createLoan.mockRejectedValue(Object.assign(new Error('goal_not_found'), { code: 'goal_not_found' }));
  getAllGoals.mockResolvedValueOnce({ goals: [] }); // goal ถูกลบไปแล้ว — refetch ไม่เจออีก
  await act(async () => { fireEvent.click(confirmButton()); });
  expect(await screen.findByRole('alert')).toHaveTextContent('ไม่พบเป้าหมายนี้แล้ว — ลองเลือกแหล่งเงินใหม่');

  // retry: sourceKey ควรถูก re-pick กลับไปที่ pool (ตัวเดียวที่ enabled) แทนที่จะค้างเป็น null
  await waitFor(() => expect((screen.getByLabelText('แหล่งเงิน *') as HTMLSelectElement).value).toBe('pool'));
  getAllGoals.mockResolvedValueOnce({ goals: [] });
  await act(async () => { fireEvent.click(confirmButton()); });
  expect(await screen.findByRole('alert')).toHaveTextContent('ไม่พบเป้าหมายนี้แล้ว — ลองเลือกแหล่งเงินใหม่');
  expect(createLoan).toHaveBeenCalledTimes(2);
});

it('focuses the source select on open when it is enabled (happy path)', async () => {
  renderDialog();
  await screen.findByRole('option', { name: /เที่ยวญี่ปุ่น/ });
  await waitFor(() => expect(screen.getByLabelText('แหล่งเงิน *')).toHaveFocus());
});

it('focuses something inside the dialog, not the disabled source select, when there is no usable source (F-S4-8)', async () => {
  getAllGoals.mockResolvedValue({ goals: [] });
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

it('closes on Escape when not busy and restores focus to the opening element', async () => {
  const trigger = document.createElement('button');
  document.body.appendChild(trigger);
  trigger.focus();
  const { onClose, rerender } = renderDialog();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalled();
  rerender(<SavingsLoanDialog open={false} poolBalance={7500} onClose={jest.fn()} onSaved={jest.fn()} />);
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
