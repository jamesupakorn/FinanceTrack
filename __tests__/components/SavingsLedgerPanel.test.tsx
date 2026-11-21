// SavingsLedgerPanel (spec-savings-loan-withdrawal S4, UX_SPEC §3). AC-SLW-25 (panel figures read verbatim from
// GET /api/savings-loans summary), AC-SLW-44 (carry-forward note's two states), C-S4-4 (reload-key wiring),
// C-S4-5 (never calls registerSave/markDirty — there is nothing to call here, the panel takes no such props).
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SavingsLedgerPanel from '../../src/frontend/components/SavingsLedgerPanel';
import { savingsGoalsAPI, savingsLedgerAPI } from '../../src/shared/utils/frontend/apiUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  savingsLedgerAPI: { getLoans: jest.fn(), getWithdrawals: jest.fn(), createLoan: jest.fn(), createWithdrawal: jest.fn(), deleteLoan: jest.fn(), deleteWithdrawal: jest.fn() },
  savingsGoalsAPI: { getAll: jest.fn() }
}));

const getLoans = savingsLedgerAPI.getLoans as jest.Mock;
const getWithdrawals = savingsLedgerAPI.getWithdrawals as jest.Mock;
const getAllGoals = savingsGoalsAPI.getAll as jest.Mock;

function summaryFixture(extra: Record<string, unknown> = {}) {
  return {
    poolSavingsTotal: 10000,
    poolOutstanding: 2000,
    poolWithdrawn: 500,
    poolBalance: 7500,
    poolCarriedForward: 0,
    totalOutstanding: 2000,
    openLoanCount: 1,
    ...extra
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getLoans.mockResolvedValue({ loans: [], summary: summaryFixture() });
  getWithdrawals.mockResolvedValue({ withdrawals: [] });
  getAllGoals.mockResolvedValue({ goals: [] });
});

it('shows the pool figures verbatim from the GET summary, and the fallback note when nothing is carried forward', async () => {
  render(<SavingsLedgerPanel />);
  await screen.findByText('7,500.00 ฿');
  expect(screen.getByText('10,000.00')).toBeInTheDocument();
  expect(screen.getByText('− 2,000.00')).toBeInTheDocument();
  expect(screen.getByText('− 500.00')).toBeInTheDocument();
  expect(screen.getByText('ⓘ คำนวณจากเงินออมทั้งหมดที่บันทึกไว้ในระบบ')).toBeInTheDocument();
});

it('shows the carry-forward note when poolCarriedForward > 0', async () => {
  getLoans.mockResolvedValue({ loans: [], summary: summaryFixture({ poolCarriedForward: 1250 }) });
  render(<SavingsLedgerPanel />);
  await screen.findByText('ⓘ รวมยอดยกมาจากเดือนที่เก่ากว่า 15 เดือน 1,250.00 ฿');
});

it('shows a negative pool balance with a minus sign and the negative-pool explainer', async () => {
  getLoans.mockResolvedValue({ loans: [], summary: summaryFixture({ poolBalance: -500 }) });
  render(<SavingsLedgerPanel />);
  await screen.findByText('−500.00 ฿');
  expect(screen.getByText(/ยอดกลางติดลบ/)).toBeInTheDocument();
});

it('bumps its own data via a reloadKey prop change, without unmounting (refetches silently)', async () => {
  const { rerender } = render(<SavingsLedgerPanel reloadKey={0} />);
  await screen.findByText('7,500.00 ฿');
  expect(getLoans).toHaveBeenCalledTimes(1);

  getLoans.mockResolvedValue({ loans: [], summary: summaryFixture({ poolBalance: 9000 }) });
  rerender(<SavingsLedgerPanel reloadKey={1} />);
  await waitFor(() => expect(getLoans).toHaveBeenCalledTimes(2));
  await screen.findByText('9,000.00 ฿');
});

// aria-busy gap: UX_SPEC §10 requires aria-busy during ANY in-flight fetch, including a reloadKey-triggered
// refetch, not just the initial mount load — while still not re-showing the skeleton on reload (§3.2's
// "Loading" vs background-refresh distinction).
it('sets aria-busy on the section during a reloadKey-triggered refetch, without re-showing the skeleton', async () => {
  const { rerender } = render(<SavingsLedgerPanel reloadKey={0} />);
  await screen.findByText('7,500.00 ฿');
  const section = screen.getByRole('region', { name: 'ยอดกลาง (เงินออมสะสม)' });
  expect(section).not.toHaveAttribute('aria-busy', 'true');

  let resolveSecondLoad: (value: { loans: unknown[]; summary: ReturnType<typeof summaryFixture> }) => void = () => {};
  getLoans.mockReturnValue(new Promise(resolve => { resolveSecondLoad = resolve; }));
  rerender(<SavingsLedgerPanel reloadKey={1} />);

  // Mid-flight: aria-busy is true, but the skeleton (which replaces the figures) never reappears.
  await waitFor(() => expect(section).toHaveAttribute('aria-busy', 'true'));
  expect(screen.getByText('7,500.00 ฿')).toBeInTheDocument();
  expect(screen.queryByText('กำลังโหลดยอดกลาง...')).not.toBeInTheDocument();

  resolveSecondLoad({ loans: [], summary: summaryFixture({ poolBalance: 9000 }) });
  await screen.findByText('9,000.00 ฿');
  expect(section).not.toHaveAttribute('aria-busy', 'true');
});

it('shows a load error with a retry button when the GET fails', async () => {
  getLoans.mockRejectedValue(new Error('fail'));
  render(<SavingsLedgerPanel />);
  await screen.findByText('โหลดข้อมูลยอดกลางไม่สำเร็จ');
  expect(screen.getByRole('button', { name: 'ลองอีกครั้ง' })).toBeInTheDocument();
});

it('opens the borrow and withdraw dialogs from their buttons', async () => {
  render(<SavingsLedgerPanel />);
  await screen.findByText('7,500.00 ฿');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'ยืมเงิน' }));
  expect(screen.getByRole('dialog', { name: 'ยืมเงินออม' })).toBeInTheDocument();
});

// F-S4-3: typing in a dialog field must not bubble as an onInput/onChange "page is dirty" signal to an ancestor
// container like WorkspaceShell.tsx:402 — the panel never calls registerSave/markDirty (C-S4-5); every dialog
// write is already saved by its own confirm button. Simulate that ancestor with a spy wrapper, the same shape
// WorkspaceShell uses, and prove it never fires while the create flow still completes end to end.
it('does not let a dialog field change bubble to an ancestor onInput/onChange listener (F-S4-3), while the dialog still saves', async () => {
  const createLoan = savingsLedgerAPI.createLoan as jest.Mock;
  createLoan.mockResolvedValue({});
  getAllGoals.mockResolvedValue({ goals: [{ _id: 'g1', goalName: 'เป้าหมาย A', currentAmount: 5000 }] });

  const ancestorInput = jest.fn();
  const ancestorChange = jest.fn();
  render(
    <div onInput={ancestorInput} onChange={ancestorChange}>
      <SavingsLedgerPanel />
    </div>
  );
  await screen.findByText('7,500.00 ฿');

  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'ยืมเงิน' }));
  const dialog = screen.getByRole('dialog', { name: 'ยืมเงินออม' });

  await user.type(screen.getByLabelText('จำนวนเงิน (บาท) *'), '100');
  await user.type(screen.getByLabelText('หมายเหตุ (ไม่บังคับ)'), 'ค่าซ่อมรถ');
  await user.selectOptions(screen.getByLabelText('แหล่งเงิน *'), 'goal:g1');

  expect(ancestorInput).not.toHaveBeenCalled();
  expect(ancestorChange).not.toHaveBeenCalled();

  // The dialog's own save flow still works end to end despite the stopped propagation.
  await user.click(screen.getByRole('button', { name: 'ยืนยันการยืม' }));
  await waitFor(() => expect(createLoan).toHaveBeenCalledWith({ source: { type: 'goal', goalId: 'g1' }, amount: 100, note: 'ค่าซ่อมรถ' }));
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
});
