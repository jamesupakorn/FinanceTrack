// SavingsLoanRepaymentDialog (spec-savings-loan-withdrawal S5, UX_SPEC §5). AC-SLW-30 coverage for the dialog
// itself: radiogroup labels (C-S5-6's goalNameById), the preview line, "คืนทั้งหมด", the required
// irreversibility checkbox and the server error-code mapping table (§5.4, C-S5-2's default arm).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SavingsLoanRepaymentDialog from '../../src/frontend/components/SavingsLoanRepaymentDialog';
import { expenseAPI, savingsGoalsAPI, savingsLedgerAPI } from '../../src/shared/utils/frontend/apiUtils';
import { showToast } from '../../src/shared/utils/frontend/toast';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  expenseAPI: { repayLoan: jest.fn() },
  savingsLedgerAPI: { getLoans: jest.fn() },
  savingsGoalsAPI: { getAll: jest.fn() }
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

const repayLoan = expenseAPI.repayLoan as jest.Mock;
const getLoans = savingsLedgerAPI.getLoans as jest.Mock;
const getAllGoals = savingsGoalsAPI.getAll as jest.Mock;

const poolLoan = {
  _id: 'loan-pool-1',
  userId: 'u1',
  source: { type: 'pool' },
  principalAmount: 3000,
  outstandingAmount: 2000,
  status: 'open',
  note: 'ค่าซ่อมรถ',
  createdAt: '2026-07-03T00:00:00.000Z',
  updatedAt: '2026-07-03T00:00:00.000Z',
  closedAt: null,
  repayments: []
};

const goalLoan = {
  _id: 'loan-goal-1',
  userId: 'u1',
  source: { type: 'goal', goalId: 'g1' },
  principalAmount: 1200,
  outstandingAmount: 1200,
  status: 'open',
  note: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  closedAt: null,
  repayments: []
};

function renderDialog(props: Partial<React.ComponentProps<typeof SavingsLoanRepaymentDialog>> = {}) {
  const onClose = jest.fn();
  const onSaved = jest.fn().mockResolvedValue(undefined);
  const utils = render(
    <SavingsLoanRepaymentDialog
      open
      month="2026-11"
      bankAccounts={['กรุงศรี', 'ไทยพาณิชย์']}
      onClose={onClose}
      onSaved={onSaved}
      {...props}
    />
  );
  return { ...utils, onClose, onSaved };
}

const amountInput = () => screen.getByLabelText('จำนวนเงินที่คืน (บาท) *') as HTMLInputElement;
const confirmButton = () => screen.getByRole('button', { name: /บันทึกการคืนเงิน|กำลังบันทึก/ });
const ackCheckbox = () => screen.getByLabelText('เข้าใจแล้ว รายการนี้แก้ไขหรือลบไม่ได้') as HTMLInputElement;

beforeEach(() => {
  jest.clearAllMocks();
  getLoans.mockResolvedValue({ loans: [poolLoan], summary: { totalOutstanding: 2000, openLoanCount: 1 } });
  getAllGoals.mockResolvedValue({ goals: [{ _id: 'g1', goalName: 'เที่ยวญี่ปุ่น' }] });
  // jsdom treats everything as offsetParent:null by default (getTabbableElements reads that as hidden) —
  // fake a visible layout so the radiogroup initial-focus tests below see real tab order.
  jest.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body);
});
afterEach(() => jest.restoreAllMocks());

it('pre-selects the only open loan and shows its radiogroup label with the goal name resolved', async () => {
  getLoans.mockResolvedValue({ loans: [poolLoan, goalLoan], summary: {} });
  renderDialog();
  const poolRadio = await screen.findByRole('radio', { name: /ยอดกลาง — ค้าง 2,000.00 ฿/ });
  // ไม่มีตัวเลือกเดียว (2 เงินกู้) จึงไม่ pre-select อัตโนมัติ
  expect(poolRadio).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByRole('radio', { name: /เป้าหมาย: เที่ยวญี่ปุ่น — ค้าง 1,200.00 ฿/ })).toBeInTheDocument();
  expect(screen.getByText(/ยืม 3,000.00 ฿ เมื่อ 3 ก.ค. 2569/)).toBeInTheDocument();
  expect(screen.getByText(/ค่าซ่อมรถ/)).toBeInTheDocument();
});

it('pre-selects automatically when there is exactly one open loan (UX_SPEC §5.2 item 1)', async () => {
  renderDialog();
  await waitFor(() => expect(screen.getByRole('radio', { name: /ยอดกลาง/ })).toHaveAttribute('aria-checked', 'true'));
});

it('shows the approximate preview and fills the outstanding amount via "คืนทั้งหมด"', async () => {
  renderDialog();
  await waitFor(() => expect(screen.getByRole('radio', { name: /ยอดกลาง/ })).toHaveAttribute('aria-checked', 'true'));
  expect(screen.getByText('กรอกจำนวนเงินเพื่อดูยอดคงเหลือ')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'คืนทั้งหมด' }));
  expect(amountInput().value).toBe('2000');
  expect(await screen.findByTestId('savings-loan-repayment-preview')).toHaveTextContent('หลังคืน: ปิดรายการยืมนี้ ✓');
});

it('shows the non-blocking over-outstanding notice without blocking submit on the amount field', async () => {
  renderDialog();
  await screen.findByRole('radio', { name: /ยอดกลาง/ });
  fireEvent.change(amountInput(), { target: { value: '5000' } });
  expect(await screen.findByText('เกินยอดค้าง — ระบบจะบันทึกเท่ากับยอดค้าง 2,000.00 ฿')).toBeInTheDocument();
});

it('blocks submit with the amount error when empty, and with the ack error when unticked', async () => {
  renderDialog();
  await screen.findByRole('radio', { name: /ยอดกลาง/ });
  fireEvent.click(confirmButton());
  expect(await screen.findByText('กรอกจำนวนเงินมากกว่า 0')).toBeInTheDocument();
  expect(repayLoan).not.toHaveBeenCalled();

  fireEvent.change(amountInput(), { target: { value: '500' } });
  fireEvent.click(confirmButton());
  expect(await screen.findByText('ติ๊กยืนยันก่อนบันทึก')).toBeInTheDocument();
  expect(repayLoan).not.toHaveBeenCalled();
});

it('submits the selected loan/amount/account, reports the outstanding toast, and closes', async () => {
  repayLoan.mockResolvedValue({ success: true, appliedAmount: 500, outstandingAmount: 1500, status: 'open', rowKey: 'slr_aaaaaaaaaaaaaaaaaaaaaaaa' });
  const { onClose, onSaved } = renderDialog();
  await screen.findByRole('radio', { name: /ยอดกลาง/ });
  fireEvent.change(amountInput(), { target: { value: '500' } });
  fireEvent.click(ackCheckbox());
  await act(async () => { fireEvent.click(confirmButton()); });
  await waitFor(() => expect(repayLoan).toHaveBeenCalledWith('2026-11', { loanId: 'loan-pool-1', amount: 500, account: 'กรุงศรี' }));
  expect(onSaved).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
  expect(showToast).toHaveBeenCalledWith('บันทึกการคืนเงินแล้ว — ยอดค้างเหลือ 1,500.00 ฿');
});

it('shows the "closed" toast when the response status is closed, even if applied < requested', async () => {
  repayLoan.mockResolvedValue({ success: true, appliedAmount: 2000, outstandingAmount: 0, status: 'closed', rowKey: 'slr_aaaaaaaaaaaaaaaaaaaaaaaa' });
  renderDialog();
  await screen.findByRole('radio', { name: /ยอดกลาง/ });
  fireEvent.change(amountInput(), { target: { value: '5000' } });
  fireEvent.click(ackCheckbox());
  await act(async () => { fireEvent.click(confirmButton()); });
  expect(showToast).toHaveBeenCalledWith('คืนครบแล้ว ปิดรายการยืม ✓');
});

it('shows the clamped-amount toast when the server applies less than requested but the loan stays open', async () => {
  repayLoan.mockResolvedValue({ success: true, appliedAmount: 1800, outstandingAmount: 0.2, status: 'open', rowKey: 'slr_aaaaaaaaaaaaaaaaaaaaaaaa' });
  renderDialog();
  await screen.findByRole('radio', { name: /ยอดกลาง/ });
  fireEvent.change(amountInput(), { target: { value: '2000' } });
  fireEvent.click(ackCheckbox());
  await act(async () => { fireEvent.click(confirmButton()); });
  expect(showToast).toHaveBeenCalledWith('บันทึก 1,800.00 ฿ (เท่ายอดค้าง)');
});

it('F-S5-3: closes with the success toast built from repayLoan\'s own response when the post-save refresh fails, without showing the generic failure message or leaving submit retry-able', async () => {
  repayLoan.mockResolvedValue({ success: true, appliedAmount: 500, outstandingAmount: 1500, status: 'open', rowKey: 'slr_aaaaaaaaaaaaaaaaaaaaaaaa' });
  const onClose = jest.fn();
  const onSaved = jest.fn().mockRejectedValue(new Error('network blip'));
  render(
    <SavingsLoanRepaymentDialog
      open
      month="2026-11"
      bankAccounts={['กรุงศรี', 'ไทยพาณิชย์']}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
  await screen.findByRole('radio', { name: /ยอดกลาง/ });
  fireEvent.change(amountInput(), { target: { value: '500' } });
  fireEvent.click(ackCheckbox());
  await act(async () => { fireEvent.click(confirmButton()); });

  // repayLoan เขียนแถวไปแล้ว — ต้องถือเป็นสำเร็จไม่ว่า onSaved (รีเฟรช) จะพังแค่ไหน
  expect(onSaved).toHaveBeenCalled();
  expect(showToast).toHaveBeenCalledWith('บันทึกการคืนเงินแล้ว — ยอดค้างเหลือ 1,500.00 ฿');
  expect(showToast).not.toHaveBeenCalledWith('บันทึกไม่สำเร็จ ลองอีกครั้ง');
  expect(onClose).toHaveBeenCalled();
  // ไม่มีข้อความ failure ทั่วไปโผล่ขึ้นมา และไม่มี alert ค้างอยู่
  expect(screen.queryByText('บันทึกไม่สำเร็จ ลองอีกครั้ง')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('maps named server error codes to their UX_SPEC §5.4 copy', async () => {
  repayLoan.mockRejectedValue(Object.assign(new Error('loan_closed'), { code: 'loan_closed' }));
  renderDialog();
  await screen.findByRole('radio', { name: /ยอดกลาง/ });
  fireEvent.change(amountInput(), { target: { value: '500' } });
  fireEvent.click(ackCheckbox());
  await act(async () => { fireEvent.click(confirmButton()); });
  expect(await screen.findByRole('alert')).toHaveTextContent('รายการยืมนี้คืนครบแล้ว — โหลดรายการใหม่ให้แล้ว');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('falls back to the generic message for an unmapped error code (C-S5-2 default arm)', async () => {
  repayLoan.mockRejectedValue(Object.assign(new Error('Legacy expense document cannot be updated per row'), { code: 'Legacy expense document cannot be updated per row' }));
  renderDialog();
  await screen.findByRole('radio', { name: /ยอดกลาง/ });
  fireEvent.change(amountInput(), { target: { value: '500' } });
  fireEvent.click(ackCheckbox());
  await act(async () => { fireEvent.click(confirmButton()); });
  expect(await screen.findByRole('alert')).toHaveTextContent('บันทึกไม่สำเร็จ ลองอีกครั้ง');
});

it('focuses the first radio option on open (not the disabled select pattern of the sibling dialogs)', async () => {
  renderDialog();
  const radio = await screen.findByRole('radio', { name: /ยอดกลาง/ });
  await waitFor(() => expect(radio).toHaveFocus());
});

it('falls back to a focusable element inside the dialog when there is no open loan yet (loading)', async () => {
  getLoans.mockResolvedValue({ loans: [], summary: {} });
  const opener = document.createElement('button');
  document.body.appendChild(opener);
  opener.focus();
  renderDialog();
  await screen.findByText('ไม่มีเงินกู้ที่ยังไม่คืนในตอนนี้');
  const dialog = screen.getByRole('dialog');
  await waitFor(() => expect(document.activeElement).not.toBe(opener));
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
  opener.remove();
});

it('degrades to the built-in "เป้าหมายที่ลบแล้ว" label when the goals fetch fails (C-S5-6)', async () => {
  getLoans.mockResolvedValue({ loans: [goalLoan], summary: {} });
  getAllGoals.mockRejectedValue(new Error('network'));
  renderDialog();
  expect(await screen.findByRole('radio', { name: /เป้าหมายที่ลบแล้ว — ค้าง 1,200.00 ฿/ })).toBeInTheDocument();
});
