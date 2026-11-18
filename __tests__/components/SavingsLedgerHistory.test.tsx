// SavingsLedgerHistory (spec-savings-loan-withdrawal S4, UX_SPEC §6). AC-SLW-28 (open-loan age label is plain
// info, never a deadline word), AC-SLW-43 (delete flow for both loans and withdrawals, incl. 409
// loan_has_repayments), C-S4-8 (one delete-confirm strip open at a time across both <details> sections).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SavingsLedgerHistory from '../../src/frontend/components/SavingsLedgerHistory';
import { savingsLedgerAPI } from '../../src/shared/utils/frontend/apiUtils';
import { showToast } from '../../src/shared/utils/frontend/toast';
import type { SavingsLoanWithBalance, SavingsWithdrawal } from '../../src/shared/utils/savingsLedger';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  savingsLedgerAPI: { deleteLoan: jest.fn(), deleteWithdrawal: jest.fn() }
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

const deleteLoan = savingsLedgerAPI.deleteLoan as jest.Mock;
const deleteWithdrawal = savingsLedgerAPI.deleteWithdrawal as jest.Mock;

const openLoanNoRepayments: SavingsLoanWithBalance = {
  _id: 'l1', userId: 'u1', source: { type: 'pool' }, principalAmount: 3000, outstandingAmount: 3000,
  status: 'open', note: 'ค่าซ่อมรถ', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 100).toISOString(),
  updatedAt: new Date().toISOString(), closedAt: null, repayments: []
};

const openLoanWithRepayments: SavingsLoanWithBalance = {
  _id: 'l2', userId: 'u1', source: { type: 'goal', goalId: 'g1' }, principalAmount: 5000, outstandingAmount: 2000,
  status: 'open', note: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), closedAt: null,
  repayments: [{ _id: 'r1', amount: 3000, expenseMonth: '2026-10', expenseRowKey: 'slr_r1', createdAt: new Date().toISOString(), balanceAfter: 2000 }]
};

const closedLoan: SavingsLoanWithBalance = {
  _id: 'l3', userId: 'u1', source: { type: 'pool' }, principalAmount: 1000, outstandingAmount: 0,
  status: 'closed', note: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z',
  closedAt: '2026-02-01T00:00:00.000Z', repayments: [{ _id: 'r2', amount: 1000, expenseMonth: '2026-02', expenseRowKey: 'slr_r2', createdAt: '2026-02-01T00:00:00.000Z', balanceAfter: 0 }]
};

const withdrawal: SavingsWithdrawal = { _id: 'w1', userId: 'u1', source: { type: 'pool' }, amount: 500, note: 'ดาวน์บ้าน', createdAt: '2026-03-01T00:00:00.000Z' };

const goalNameById = new Map([['g1', 'เที่ยวญี่ปุ่น']]);

function renderHistory(props: Partial<React.ComponentProps<typeof SavingsLedgerHistory>> = {}) {
  const onChanged = jest.fn().mockResolvedValue(undefined);
  const focusLoanButton = jest.fn();
  const focusWithdrawalButton = jest.fn();
  const utils = render(
    <SavingsLedgerHistory
      loans={[openLoanNoRepayments, openLoanWithRepayments, closedLoan]}
      withdrawals={[withdrawal]}
      goalNameById={goalNameById}
      onChanged={onChanged}
      focusLoanButton={focusLoanButton}
      focusWithdrawalButton={focusWithdrawalButton}
      {...props}
    />
  );
  return { ...utils, onChanged, focusLoanButton, focusWithdrawalButton };
}

beforeEach(() => jest.clearAllMocks());

it('shows open loans expanded by default, oldest first, with a plain-info age label (no deadline wording)', () => {
  const { container } = renderHistory();
  expect(screen.getByText('▼ เงินยืมที่ยังไม่คืน (2)')).toBeInTheDocument();
  expect(screen.getByText(/เปิดมา/)).toBeInTheDocument();
  const text = container.textContent ?? '';
  for (const forbidden of ['ครบกำหนด', 'เกินกำหนด', 'ค้างชำระ', 'เลยกำหนด', 'overdue']) {
    expect(text).not.toContain(forbidden);
  }
});

it('shows "⋯" only on the open loan with zero repayments, not on the one with repayments', () => {
  renderHistory();
  expect(screen.getByRole('button', { name: /ตัวเลือกของรายการยืม 3,000.00 บาท/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /ตัวเลือกของรายการยืม 5,000.00 บาท/ })).toBeNull();
});

it('closed loans and withdrawals share one collapsed history list, newest first', async () => {
  const user = userEvent.setup();
  renderHistory();
  await user.click(screen.getByText('▶ ประวัติการยืม/ถอน (2)'));
  expect(screen.getByText(/ถอนจากยอดกลาง/)).toBeInTheDocument();
  expect(screen.getByText(/คืนครบแล้ว/)).toBeInTheDocument();
});

it('deletes a zero-repayment loan after the inline confirm, and refetches', async () => {
  deleteLoan.mockResolvedValue({ success: true });
  const user = userEvent.setup();
  const { onChanged } = renderHistory();
  await user.click(screen.getByRole('button', { name: /ตัวเลือกของรายการยืม 3,000.00 บาท/ }));
  await user.click(screen.getByRole('menuitem', { name: 'ลบ (บันทึกผิด)' }));
  expect(screen.getByText(/ลบรายการยืม 3,000.00 ฿ นี้/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));
  await waitFor(() => expect(deleteLoan).toHaveBeenCalledWith('l1'));
  expect(onChanged).toHaveBeenCalled();
  expect(showToast).toHaveBeenCalledWith('ลบรายการแล้ว');
});

it('maps 409 loan_has_repayments to its copy and keeps the strip open', async () => {
  deleteLoan.mockRejectedValue(Object.assign(new Error('loan_has_repayments'), { code: 'loan_has_repayments' }));
  const user = userEvent.setup();
  renderHistory();
  await user.click(screen.getByRole('button', { name: /ตัวเลือกของรายการยืม 3,000.00 บาท/ }));
  await user.click(screen.getByRole('menuitem', { name: 'ลบ (บันทึกผิด)' }));
  await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('รายการนี้มีการคืนเงินแล้ว ลบไม่ได้');
});

it('deletes a withdrawal after confirm', async () => {
  deleteWithdrawal.mockResolvedValue({ success: true });
  const user = userEvent.setup();
  const { onChanged } = renderHistory();
  await user.click(screen.getByText('▶ ประวัติการยืม/ถอน (2)'));
  await user.click(screen.getByRole('button', { name: /ตัวเลือกของรายการถอน 500.00 บาท/ }));
  await user.click(screen.getByRole('menuitem', { name: 'ลบ (บันทึกผิด)' }));
  await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));
  await waitFor(() => expect(deleteWithdrawal).toHaveBeenCalledWith('w1'));
  expect(onChanged).toHaveBeenCalled();
});

describe('delete confirm strip focus management (UX_SPEC §6.4, F-S4-4)', () => {
  const loanA: SavingsLoanWithBalance = {
    _id: 'fa1', userId: 'u1', source: { type: 'pool' }, principalAmount: 1000, outstandingAmount: 1000,
    status: 'open', note: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', closedAt: null, repayments: []
  };
  const loanB: SavingsLoanWithBalance = { ...loanA, _id: 'fa2', principalAmount: 2000, outstandingAmount: 2000, createdAt: '2026-01-02T00:00:00.000Z' };
  const loanC: SavingsLoanWithBalance = { ...loanA, _id: 'fa3', principalAmount: 3000, outstandingAmount: 3000, createdAt: '2026-01-03T00:00:00.000Z' };
  const withdrawalX: SavingsWithdrawal = { _id: 'fw1', userId: 'u1', source: { type: 'pool' }, amount: 1500, note: null, createdAt: '2026-04-01T00:00:00.000Z' };
  const withdrawalY: SavingsWithdrawal = { _id: 'fw2', userId: 'u1', source: { type: 'pool' }, amount: 2500, note: null, createdAt: '2026-04-02T00:00:00.000Z' };

  function renderFocus(loans: SavingsLoanWithBalance[], withdrawals: SavingsWithdrawal[] = []) {
    const onChanged = jest.fn().mockResolvedValue(undefined);
    const focusLoanButton = jest.fn();
    const focusWithdrawalButton = jest.fn();
    const utils = render(
      <SavingsLedgerHistory
        loans={loans}
        withdrawals={withdrawals}
        goalNameById={goalNameById}
        onChanged={onChanged}
        focusLoanButton={focusLoanButton}
        focusWithdrawalButton={focusWithdrawalButton}
      />
    );
    return { ...utils, onChanged, focusLoanButton, focusWithdrawalButton };
  }

  it('moves focus to "ยกเลิก" when the strip opens', async () => {
    const user = userEvent.setup();
    renderFocus([loanA]);
    await user.click(screen.getByRole('button', { name: /ตัวเลือกของรายการยืม 1,000.00 บาท/ }));
    await user.click(screen.getByRole('menuitem', { name: 'ลบ (บันทึกผิด)' }));
    expect(screen.getByRole('button', { name: 'ยกเลิก' })).toHaveFocus();
  });

  it('Escape closes the strip and returns focus to that row\'s ⋯', async () => {
    const user = userEvent.setup();
    renderFocus([loanA]);
    const trigger = screen.getByRole('button', { name: /ตัวเลือกของรายการยืม 1,000.00 บาท/ });
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'ลบ (บันทึกผิด)' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'ยกเลิก' }), { key: 'Escape' });
    expect(screen.queryByText(/ลบรายการยืม/)).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('clicking "ยกเลิก" returns focus to that row\'s ⋯', async () => {
    const user = userEvent.setup();
    renderFocus([loanA]);
    const trigger = screen.getByRole('button', { name: /ตัวเลือกของรายการยืม 1,000.00 บาท/ });
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'ลบ (บันทึกผิด)' }));
    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    expect(trigger).toHaveFocus();
  });

  it('after a successful delete, focuses the next surviving row\'s ⋯ in the same list', async () => {
    deleteLoan.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    const { rerender } = renderFocus([loanA, loanB, loanC]);
    await user.click(screen.getByRole('button', { name: /ตัวเลือกของรายการยืม 2,000.00 บาท/ }));
    await user.click(screen.getByRole('menuitem', { name: 'ลบ (บันทึกผิด)' }));
    await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));
    await waitFor(() => expect(deleteLoan).toHaveBeenCalledWith('fa2'));
    rerender(
      <SavingsLedgerHistory
        loans={[loanA, loanC]}
        withdrawals={[]}
        goalNameById={goalNameById}
        onChanged={jest.fn().mockResolvedValue(undefined)}
        focusLoanButton={jest.fn()}
        focusWithdrawalButton={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /ตัวเลือกของรายการยืม 3,000.00 บาท/ })).toHaveFocus();
  });

  it('after deleting the last row, falls back to the previous row\'s ⋯', async () => {
    deleteLoan.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    const { rerender } = renderFocus([loanA, loanB, loanC]);
    await user.click(screen.getByRole('button', { name: /ตัวเลือกของรายการยืม 3,000.00 บาท/ }));
    await user.click(screen.getByRole('menuitem', { name: 'ลบ (บันทึกผิด)' }));
    await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));
    await waitFor(() => expect(deleteLoan).toHaveBeenCalledWith('fa3'));
    rerender(
      <SavingsLedgerHistory
        loans={[loanA, loanB]}
        withdrawals={[]}
        goalNameById={goalNameById}
        onChanged={jest.fn().mockResolvedValue(undefined)}
        focusLoanButton={jest.fn()}
        focusWithdrawalButton={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /ตัวเลือกของรายการยืม 2,000.00 บาท/ })).toHaveFocus();
  });

  it('after deleting the only open loan, falls back to the panel\'s "ยืมเงิน" button', async () => {
    deleteLoan.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    const { rerender, focusLoanButton } = renderFocus([loanA]);
    await user.click(screen.getByRole('button', { name: /ตัวเลือกของรายการยืม 1,000.00 บาท/ }));
    await user.click(screen.getByRole('menuitem', { name: 'ลบ (บันทึกผิด)' }));
    await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));
    await waitFor(() => expect(deleteLoan).toHaveBeenCalledWith('fa1'));
    rerender(
      <SavingsLedgerHistory
        loans={[]}
        withdrawals={[]}
        goalNameById={goalNameById}
        onChanged={jest.fn().mockResolvedValue(undefined)}
        focusLoanButton={focusLoanButton}
        focusWithdrawalButton={jest.fn()}
      />
    );
    expect(focusLoanButton).toHaveBeenCalled();
  });

  it('after deleting the only withdrawal, falls back to the panel\'s "ถอนเงินออม" button', async () => {
    deleteWithdrawal.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    const { rerender, focusWithdrawalButton } = renderFocus([], [withdrawalX]);
    await user.click(screen.getByText('▶ ประวัติการยืม/ถอน (1)'));
    await user.click(screen.getByRole('button', { name: /ตัวเลือกของรายการถอน 1,500.00 บาท/ }));
    await user.click(screen.getByRole('menuitem', { name: 'ลบ (บันทึกผิด)' }));
    await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));
    await waitFor(() => expect(deleteWithdrawal).toHaveBeenCalledWith('fw1'));
    rerender(
      <SavingsLedgerHistory
        loans={[]}
        withdrawals={[]}
        goalNameById={goalNameById}
        onChanged={jest.fn().mockResolvedValue(undefined)}
        focusLoanButton={jest.fn()}
        focusWithdrawalButton={focusWithdrawalButton}
      />
    );
    expect(focusWithdrawalButton).toHaveBeenCalled();
  });

  it('after a successful delete, focuses the next surviving withdrawal row\'s ⋯ in the history list', async () => {
    deleteWithdrawal.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    const { rerender } = renderFocus([], [withdrawalX, withdrawalY]);
    await user.click(screen.getByText('▶ ประวัติการยืม/ถอน (2)'));
    // newest first: withdrawalY (2026-04-02) renders before withdrawalX (2026-04-01)
    await user.click(screen.getByRole('button', { name: /ตัวเลือกของรายการถอน 2,500.00 บาท/ }));
    await user.click(screen.getByRole('menuitem', { name: 'ลบ (บันทึกผิด)' }));
    await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));
    await waitFor(() => expect(deleteWithdrawal).toHaveBeenCalledWith('fw2'));
    rerender(
      <SavingsLedgerHistory
        loans={[]}
        withdrawals={[withdrawalX]}
        goalNameById={goalNameById}
        onChanged={jest.fn().mockResolvedValue(undefined)}
        focusLoanButton={jest.fn()}
        focusWithdrawalButton={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /ตัวเลือกของรายการถอน 1,500.00 บาท/ })).toHaveFocus();
  });

  describe('F-S4-6: post-delete focus skips a neighbor row with no ⋯', () => {
    it('open-loans list: scans forward past a repayment-bearing loan (no ⋯) to the next loan\'s ⋯', async () => {
      deleteLoan.mockResolvedValue({ success: true });
      const user = userEvent.setup();
      const loanWithRepay = {
        ...loanB,
        repayments: [{ _id: 'r9', amount: 100, expenseMonth: '2026-01', expenseRowKey: 'slr_r9', createdAt: '2026-01-01T00:00:00.000Z', balanceAfter: 1900 }]
      };
      const { rerender } = renderFocus([loanA, loanWithRepay, loanC]);
      await user.click(screen.getByRole('button', { name: /ตัวเลือกของรายการยืม 1,000.00 บาท/ }));
      await user.click(screen.getByRole('menuitem', { name: 'ลบ (บันทึกผิด)' }));
      await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));
      await waitFor(() => expect(deleteLoan).toHaveBeenCalledWith('fa1'));
      // loanWithRepay has repayments → no ⋯ at all, so it must be skipped
      expect(screen.queryByRole('button', { name: /ตัวเลือกของรายการยืม 2,000.00 บาท/ })).toBeNull();
      rerender(
        <SavingsLedgerHistory
          loans={[loanWithRepay, loanC]}
          withdrawals={[]}
          goalNameById={goalNameById}
          onChanged={jest.fn().mockResolvedValue(undefined)}
          focusLoanButton={jest.fn()}
          focusWithdrawalButton={jest.fn()}
        />
      );
      expect(screen.getByRole('button', { name: /ตัวเลือกของรายการยืม 3,000.00 บาท/ })).toHaveFocus();
    });

    it('open-loans list: scans backward past a repayment-bearing loan (no ⋯) to the previous loan\'s ⋯', async () => {
      deleteLoan.mockResolvedValue({ success: true });
      const user = userEvent.setup();
      const loanWithRepay = {
        ...loanB,
        repayments: [{ _id: 'r10', amount: 100, expenseMonth: '2026-01', expenseRowKey: 'slr_r10', createdAt: '2026-01-01T00:00:00.000Z', balanceAfter: 1900 }]
      };
      const { rerender } = renderFocus([loanA, loanWithRepay, loanC]);
      await user.click(screen.getByRole('button', { name: /ตัวเลือกของรายการยืม 3,000.00 บาท/ }));
      await user.click(screen.getByRole('menuitem', { name: 'ลบ (บันทึกผิด)' }));
      await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));
      await waitFor(() => expect(deleteLoan).toHaveBeenCalledWith('fa3'));
      rerender(
        <SavingsLedgerHistory
          loans={[loanA, loanWithRepay]}
          withdrawals={[]}
          goalNameById={goalNameById}
          onChanged={jest.fn().mockResolvedValue(undefined)}
          focusLoanButton={jest.fn()}
          focusWithdrawalButton={jest.fn()}
        />
      );
      expect(screen.getByRole('button', { name: /ตัวเลือกของรายการยืม 1,000.00 บาท/ })).toHaveFocus();
    });

    const closedLoanMid: SavingsLoanWithBalance = {
      _id: 'fc1', userId: 'u1', source: { type: 'pool' }, principalAmount: 400, outstandingAmount: 0,
      status: 'closed', note: null, createdAt: '2025-12-01T00:00:00.000Z', updatedAt: '2026-01-15T00:00:00.000Z',
      closedAt: '2026-01-15T00:00:00.000Z', repayments: []
    };
    const withdrawalNew: SavingsWithdrawal = { _id: 'fh1', userId: 'u1', source: { type: 'pool' }, amount: 100, note: null, createdAt: '2026-02-01T00:00:00.000Z' };
    const withdrawalOld: SavingsWithdrawal = { _id: 'fh2', userId: 'u1', source: { type: 'pool' }, amount: 200, note: null, createdAt: '2026-01-01T00:00:00.000Z' };

    it('history list: scans forward past a closed loan (no ⋯) to the next withdrawal\'s ⋯', async () => {
      deleteWithdrawal.mockResolvedValue({ success: true });
      const user = userEvent.setup();
      const { rerender } = renderFocus([closedLoanMid], [withdrawalNew, withdrawalOld]);
      await user.click(screen.getByText('▶ ประวัติการยืม/ถอน (3)'));
      await user.click(screen.getByRole('button', { name: /ตัวเลือกของรายการถอน 100.00 บาท/ }));
      await user.click(screen.getByRole('menuitem', { name: 'ลบ (บันทึกผิด)' }));
      await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));
      await waitFor(() => expect(deleteWithdrawal).toHaveBeenCalledWith('fh1'));
      rerender(
        <SavingsLedgerHistory
          loans={[closedLoanMid]}
          withdrawals={[withdrawalOld]}
          goalNameById={goalNameById}
          onChanged={jest.fn().mockResolvedValue(undefined)}
          focusLoanButton={jest.fn()}
          focusWithdrawalButton={jest.fn()}
        />
      );
      expect(screen.getByRole('button', { name: /ตัวเลือกของรายการถอน 200.00 บาท/ })).toHaveFocus();
    });

    it('history list: scans backward past a closed loan (no ⋯) to the previous withdrawal\'s ⋯', async () => {
      deleteWithdrawal.mockResolvedValue({ success: true });
      const user = userEvent.setup();
      const { rerender } = renderFocus([closedLoanMid], [withdrawalNew, withdrawalOld]);
      await user.click(screen.getByText('▶ ประวัติการยืม/ถอน (3)'));
      await user.click(screen.getByRole('button', { name: /ตัวเลือกของรายการถอน 200.00 บาท/ }));
      await user.click(screen.getByRole('menuitem', { name: 'ลบ (บันทึกผิด)' }));
      await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));
      await waitFor(() => expect(deleteWithdrawal).toHaveBeenCalledWith('fh2'));
      rerender(
        <SavingsLedgerHistory
          loans={[closedLoanMid]}
          withdrawals={[withdrawalNew]}
          goalNameById={goalNameById}
          onChanged={jest.fn().mockResolvedValue(undefined)}
          focusLoanButton={jest.fn()}
          focusWithdrawalButton={jest.fn()}
        />
      );
      expect(screen.getByRole('button', { name: /ตัวเลือกของรายการถอน 100.00 บาท/ })).toHaveFocus();
    });
  });

  describe('F-S4-7: a not-found delete error behaves like success for the strip and focus', () => {
    it('loan_not_found: closes the strip, toasts instead of an inline alert, and still runs the focus-fallback chain', async () => {
      deleteLoan.mockRejectedValue(Object.assign(new Error('loan_not_found'), { code: 'loan_not_found' }));
      const user = userEvent.setup();
      const { rerender } = renderFocus([loanA, loanB, loanC]);
      await user.click(screen.getByRole('button', { name: /ตัวเลือกของรายการยืม 2,000.00 บาท/ }));
      await user.click(screen.getByRole('menuitem', { name: 'ลบ (บันทึกผิด)' }));
      await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));
      await waitFor(() => expect(deleteLoan).toHaveBeenCalledWith('fa2'));
      await waitFor(() => expect(showToast).toHaveBeenCalledWith('ไม่พบรายการนี้แล้ว', 'error'));
      // the strip closes with the row still mounted — no inline alert survives to show the message
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByText(/ลบรายการยืม 2,000.00 ฿ นี้/)).toBeNull();
      // simulate the refetch that onChanged() triggers in the real parent, removing the now-gone loan
      rerender(
        <SavingsLedgerHistory
          loans={[loanA, loanC]}
          withdrawals={[]}
          goalNameById={goalNameById}
          onChanged={jest.fn().mockResolvedValue(undefined)}
          focusLoanButton={jest.fn()}
          focusWithdrawalButton={jest.fn()}
        />
      );
      expect(screen.getByRole('button', { name: /ตัวเลือกของรายการยืม 3,000.00 บาท/ })).toHaveFocus();
    });

    it('withdrawal_not_found: still falls back to the panel button when it was the only row', async () => {
      deleteWithdrawal.mockRejectedValue(Object.assign(new Error('withdrawal_not_found'), { code: 'withdrawal_not_found' }));
      const user = userEvent.setup();
      const { rerender, focusWithdrawalButton } = renderFocus([], [withdrawalX]);
      await user.click(screen.getByText('▶ ประวัติการยืม/ถอน (1)'));
      await user.click(screen.getByRole('button', { name: /ตัวเลือกของรายการถอน 1,500.00 บาท/ }));
      await user.click(screen.getByRole('menuitem', { name: 'ลบ (บันทึกผิด)' }));
      await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));
      await waitFor(() => expect(deleteWithdrawal).toHaveBeenCalledWith('fw1'));
      await waitFor(() => expect(showToast).toHaveBeenCalledWith('ไม่พบรายการนี้แล้ว', 'error'));
      expect(screen.queryByRole('alert')).toBeNull();
      rerender(
        <SavingsLedgerHistory
          loans={[]}
          withdrawals={[]}
          goalNameById={goalNameById}
          onChanged={jest.fn().mockResolvedValue(undefined)}
          focusLoanButton={jest.fn()}
          focusWithdrawalButton={focusWithdrawalButton}
        />
      );
      expect(focusWithdrawalButton).toHaveBeenCalled();
    });
  });
});

it('allows only one delete-confirm strip open at a time across both sections', async () => {
  const user = userEvent.setup();
  renderHistory();
  await user.click(screen.getByText('▶ ประวัติการยืม/ถอน (2)'));
  await user.click(screen.getByRole('button', { name: /ตัวเลือกของรายการยืม 3,000.00 บาท/ }));
  await user.click(screen.getByRole('menuitem', { name: 'ลบ (บันทึกผิด)' }));
  expect(screen.getByText(/ลบรายการยืม 3,000.00 ฿ นี้/)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /ตัวเลือกของรายการถอน 500.00 บาท/ }));
  await user.click(screen.getByRole('menuitem', { name: 'ลบ (บันทึกผิด)' }));
  expect(screen.queryByText(/ลบรายการยืม 3,000.00 ฿ นี้/)).toBeNull();
  expect(screen.getByText(/ลบรายการถอน 500.00 ฿ นี้/)).toBeInTheDocument();
});
