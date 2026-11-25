/**
 * BackToCloseSavingsReports.test.tsx — D9 (I5e): useBackToClose wired into SavingsGoalAdjustmentDialog,
 * SavingsLoanDialog, SavingsWithdrawalDialog, and pages/reports.tsx's report-month modal
 * (spec-salary-row-and-back-close.md §I5 table rows 23-26).
 *
 * Covers AC-SBC-50 (all 4 surfaces), AC-SBC-51 (the 3 `blocked` surfaces: the Savings dialogs), AC-SBC-55,
 * AC-SBC-56. Also pins the SavingsGoalAdjustmentDialog-specific wiring note (spec §I5 row 23 / architecture
 * review Check 7): Back must reuse the Escape path's exact expression so the `'stale'` refetch signal survives.
 *
 * ModePasswordModal.tsx / LineConnectModal.tsx (rows 27-28, dead code, D-SBC-6) and the inventory guard
 * (AC-SBC-58) are covered by overlayInventory.test.ts, not here.
 *
 * Harness contract (binding, same as overlayHistory.test.ts / BackToCloseCredits.test.tsx / etc.): fake
 * timers, settle ONLY through createOverlayHistoryHarness()'s bounded HISTORY_SETTLE_MS advance
 * (t.pressBack()/t.settleHistory()), and assert pop/call counts beside every negative assertion.
 *
 * AC-SBC-55 ("existing Escape/backdrop/✕ tests pass unedited") is proven by the full Jest run, not by
 * anything in this file — this file only adds Back coverage, per the "don't touch existing tests" rule.
 *
 * KL-SBC-1 (Android hardware Back / iOS edge-swipe / desktop / installed-PWA Back) is OPEN — manual,
 * no agent here has a real browser or device. Not exercised, not claimed done.
 */

import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import SavingsGoalAdjustmentDialog from '../../src/frontend/components/SavingsGoalAdjustmentDialog';
import SavingsLoanDialog from '../../src/frontend/components/SavingsLoanDialog';
import SavingsWithdrawalDialog from '../../src/frontend/components/SavingsWithdrawalDialog';
import ReportsPage from '../../pages/reports';
import { savingsGoalsAPI, savingsLedgerAPI } from '../../src/shared/utils/frontend/apiUtils';
import { __resetOverlayHistoryForTests } from '../../src/shared/utils/frontend/overlayHistory';
import { createOverlayHistoryHarness, type OverlayHistoryHarness } from '../helpers/overlayHistoryHarness';

jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));
jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  savingsGoalsAPI: {
    getAll: jest.fn(),
    addAdjustment: jest.fn(),
    editAdjustment: jest.fn()
  },
  savingsLedgerAPI: {
    createLoan: jest.fn(),
    createWithdrawal: jest.fn()
  },
  incomeAPI: { getAll: jest.fn(), getByMonth: jest.fn() },
  expenseAPI: { getAll: jest.fn(), getByMonth: jest.fn() },
  savingsAPI: { getAll: jest.fn(), getByMonth: jest.fn() },
  salaryAPI: { getAll: jest.fn(), getByMonth: jest.fn() },
  investmentAPI: { getAll: jest.fn() },
  dailyExpenseAPI: { getByMonth: jest.fn() },
  taxAPI: { getByYear: jest.fn() }
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let h: OverlayHistoryHarness | null = null;
function harness(options: { asPath?: string } = {}): OverlayHistoryHarness {
  h = createOverlayHistoryHarness(options);
  return h;
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 10, 25, 10, 0, 0) });
  jest.mocked(savingsGoalsAPI.getAll).mockResolvedValue({ goals: [] });
});

afterEach(() => {
  h?.cleanup();
  h = null;
  __resetOverlayHistoryForTests();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// ---- row 23: SavingsGoalAdjustmentDialog --------------------------------

const goal = { _id: 'g1', goalName: 'ไปเที่ยวญี่ปุ่น', currentAmount: 10000 };

function AdjustmentHarness({ onCloseSpy }: { onCloseSpy: (reason?: 'stale') => void }) {
  const [open, setOpen] = useState(true);
  return (
    <SavingsGoalAdjustmentDialog
      open={open}
      goal={goal}
      editing={null}
      onClose={(reason) => { onCloseSpy(reason); setOpen(false); }}
      onSaved={jest.fn()}
    />
  );
}

describe('SavingsGoalAdjustmentDialog (table row 23)', () => {
  it('AC-SBC-50: Back runs the Escape path (onClose, no stale reason), no navigation', () => {
    const t = harness();
    const onClose = jest.fn();
    render(<AdjustmentHarness onCloseSpy={onClose} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    expect(t.pressBack()).toBe(1);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith(undefined);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(t.router.replace).not.toHaveBeenCalled();
  });

  it('AC-SBC-51: blocked (busy during save) keeps it open on Back; closes once busy clears', async () => {
    const t = harness();
    const onClose = jest.fn();
    const pending = deferred<unknown>();
    jest.mocked(savingsGoalsAPI.addAdjustment).mockReturnValue(pending.promise as never);
    render(<AdjustmentHarness onCloseSpy={onClose} />);

    fireEvent.click(screen.getByRole('radio', { name: 'เพิ่มยอด (+)' }));
    fireEvent.change(screen.getByLabelText('จำนวนเงิน (บาท) *'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('หมายเหตุ *'), { target: { value: 'เงินโบนัส' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการปรับยอด' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');

    expect(t.pressBack()).toBe(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // reject so busy clears WITHOUT onSaved/onClose firing — isolates "blocked clears" from a
    // successful save closing the dialog on its own path.
    await act(async () => { pending.reject(new Error('amount too large')); });
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-busy', 'true');

    expect(t.pressBack()).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("wiring note (spec §I5 row 23): a stale server error reclassifies Back's close reason to 'stale'", async () => {
    const t = harness();
    const onClose = jest.fn();
    jest.mocked(savingsGoalsAPI.addAdjustment).mockRejectedValue(new Error('Goal not found'));
    render(<AdjustmentHarness onCloseSpy={onClose} />);

    fireEvent.click(screen.getByRole('radio', { name: 'เพิ่มยอด (+)' }));
    fireEvent.change(screen.getByLabelText('จำนวนเงิน (บาท) *'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('หมายเหตุ *'), { target: { value: 'เงินโบนัส' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'บันทึกการปรับยอด' })); });
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    expect(t.pressBack()).toBe(1);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith('stale');
  });

  it('AC-SBC-56: Escape releases its entry with one history.go(-1); the later self-pop does not call onClose again', () => {
    const t = harness();
    const onClose = jest.fn();
    render(<AdjustmentHarness onCloseSpy={onClose} />);
    const dialog = screen.getByRole('dialog');

    const go = jest.spyOn(window.history, 'go');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);

    expect(t.settleHistory()).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---- row 24: SavingsLoanDialog -------------------------------------------

function LoanHarness({ onCloseSpy }: { onCloseSpy: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <SavingsLoanDialog
      open={open}
      poolBalance={5000}
      onClose={() => { onCloseSpy(); setOpen(false); }}
      onSaved={jest.fn()}
    />
  );
}

describe('SavingsLoanDialog (table row 24)', () => {
  it('AC-SBC-50: Back runs onClose, no navigation', async () => {
    const t = harness();
    const onClose = jest.fn();
    render(<LoanHarness onCloseSpy={onClose} />);
    await screen.findByRole('dialog');

    expect(t.pressBack()).toBe(1);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(t.router.replace).not.toHaveBeenCalled();
  });

  it('AC-SBC-51: blocked (busy during save) keeps it open on Back; closes once busy clears', async () => {
    const t = harness();
    const onClose = jest.fn();
    const pending = deferred<unknown>();
    jest.mocked(savingsLedgerAPI.createLoan).mockReturnValue(pending.promise as never);
    render(<LoanHarness onCloseSpy={onClose} />);
    await screen.findByRole('dialog');

    fireEvent.change(screen.getByLabelText('จำนวนเงิน (บาท) *'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันการยืม' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');

    expect(t.pressBack()).toBe(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await act(async () => { pending.reject(new Error('network')); });
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-busy', 'true');

    expect(t.pressBack()).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('AC-SBC-56: Escape releases its entry with one history.go(-1); the later self-pop does not call onClose again', async () => {
    const t = harness();
    const onClose = jest.fn();
    render(<LoanHarness onCloseSpy={onClose} />);
    const dialog = await screen.findByRole('dialog');

    const go = jest.spyOn(window.history, 'go');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);

    expect(t.settleHistory()).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---- row 25: SavingsWithdrawalDialog -------------------------------------

function WithdrawalHarness({ onCloseSpy }: { onCloseSpy: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <SavingsWithdrawalDialog
      open={open}
      poolBalance={5000}
      onClose={() => { onCloseSpy(); setOpen(false); }}
      onSaved={jest.fn()}
    />
  );
}

describe('SavingsWithdrawalDialog (table row 25)', () => {
  it('AC-SBC-50: Back runs onClose, no navigation', async () => {
    const t = harness();
    const onClose = jest.fn();
    render(<WithdrawalHarness onCloseSpy={onClose} />);
    await screen.findByRole('dialog');

    expect(t.pressBack()).toBe(1);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(t.router.replace).not.toHaveBeenCalled();
  });

  it('AC-SBC-51: blocked (busy during save) keeps it open on Back; closes once busy clears', async () => {
    const t = harness();
    const onClose = jest.fn();
    const pending = deferred<unknown>();
    jest.mocked(savingsLedgerAPI.createWithdrawal).mockReturnValue(pending.promise as never);
    render(<WithdrawalHarness onCloseSpy={onClose} />);
    await screen.findByRole('dialog');

    fireEvent.change(screen.getByLabelText('จำนวนเงิน (บาท) *'), { target: { value: '500' } });
    fireEvent.click(screen.getByLabelText('เข้าใจแล้ว ถอนครั้งนี้ไม่ต้องคืน'));
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันการถอน' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');

    expect(t.pressBack()).toBe(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await act(async () => { pending.reject(new Error('network')); });
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-busy', 'true');

    expect(t.pressBack()).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('AC-SBC-56: Escape releases its entry with one history.go(-1); the later self-pop does not call onClose again', async () => {
    const t = harness();
    const onClose = jest.fn();
    render(<WithdrawalHarness onCloseSpy={onClose} />);
    const dialog = await screen.findByRole('dialog');

    const go = jest.spyOn(window.history, 'go');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);

    expect(t.settleHistory()).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---- row 26: pages/reports.tsx report-month modal ------------------------

jest.mock('../../src/frontend/contexts/SessionContext', () => ({
  useSession: () => ({ currentUser: { id: 'u001' } })
}));
jest.mock('../../src/frontend/components/Layout', () => ({
  __esModule: true,
  default: ({ children, headerActions }: { children: ReactNode; headerActions: ReactNode }) =>
    <><header>{headerActions}</header>{children}</>
}));
jest.mock('../../src/frontend/components/SummaryReport', () => () => null);
jest.mock('../../src/frontend/components/MonthComparison', () => () => null);

describe("pages/reports.tsx's report-month modal (table row 26)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('edit_selected_month_u001', '2026-08');
    const { incomeAPI, expenseAPI, savingsAPI, salaryAPI, investmentAPI, dailyExpenseAPI, taxAPI } =
      jest.requireMock('../../src/shared/utils/frontend/apiUtils');
    for (const api of [incomeAPI, expenseAPI, savingsAPI, salaryAPI]) {
      jest.mocked(api.getAll).mockResolvedValue({ months: { '2026-08': {} } });
    }
    jest.mocked(investmentAPI.getAll).mockResolvedValue({});
    for (const api of [incomeAPI, expenseAPI, savingsAPI, salaryAPI, dailyExpenseAPI]) {
      jest.mocked(api.getByMonth).mockResolvedValue({});
    }
    jest.mocked(taxAPI.getByYear).mockResolvedValue({});
  });

  async function openReportMonthModal() {
    render(<ReportsPage />);
    const pdfButton = await screen.findByRole('button', { name: 'ดาวน์โหลด PDF' });
    await waitFor(() => expect(pdfButton).toBeEnabled());
    fireEvent.click(pdfButton);
    return screen.getByRole('dialog');
  }

  it('AC-SBC-50: Back closes the modal, no navigation', async () => {
    const t = harness();
    await openReportMonthModal();

    expect(t.pressBack()).toBe(1);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(t.router.replace).not.toHaveBeenCalled();
  });

  it('AC-SBC-56: Escape releases its entry with one history.go(-1); the later self-pop does not double-close', async () => {
    const t = harness();
    const dialog = await openReportMonthModal();

    const go = jest.spyOn(window.history, 'go');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(go).toHaveBeenCalledTimes(1);

    expect(t.settleHistory()).toBe(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
