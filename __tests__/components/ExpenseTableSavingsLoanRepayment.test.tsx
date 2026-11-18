// ExpenseTable × savings-loan-withdrawal S5 (spec-savings-loan-withdrawal, UX_SPEC §5).
// AC-SLW-30: an slr_ row renders 🔒, the chip, static "✓ จ่ายแล้ว" with its aria-label, and has no
// remove control/input at either tier (C-S5-1's sortedExpenseKeys narrowing is what this guards).
// AC-SLW-29: the post-repayment row-scoped refresh preserves an unrelated row's in-progress edit and
// never calls markDirty (the FAB's dirty state).
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ExpenseTable from '../../src/frontend/components/ExpenseTable';
import { expenseAPI, creditCardAPI, savingsGoalsAPI, savingsLedgerAPI } from '../../src/shared/utils/frontend/apiUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  expenseAPI: { getByMonth: jest.fn(), setPaid: jest.fn(), repayLoan: jest.fn() },
  creditCardAPI: { getMonthInstallments: jest.fn(), getRevolving: jest.fn() },
  savingsLedgerAPI: { getLoans: jest.fn() },
  savingsGoalsAPI: { getAll: jest.fn() },
  withCsrfHeaders: (h: unknown) => h,
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));
jest.mock('../../src/frontend/contexts/SessionContext', () => {
  const session = { currentUser: { id: 'u1', bankAccounts: ['กรุงศรี'] } };
  return { useSession: () => session };
});

const api = jest.mocked(expenseAPI);
const cards = jest.mocked(creditCardAPI);
const ledger = jest.mocked(savingsLedgerAPI);
const goals = jest.mocked(savingsGoalsAPI);
const MONTH = '2026-11';

const repaymentRow = {
  name: 'คืนเงินกู้ · ยอดกลาง',
  actual: 500,
  account: 'กรุงศรี',
  paid: true,
  dueDay: 18
};

const openLoan = {
  _id: 'loan-1',
  userId: 'u1',
  source: { type: 'pool' },
  principalAmount: 2000,
  outstandingAmount: 2000,
  status: 'open',
  note: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  closedAt: null,
  repayments: []
};

function mockInitial(rows: Record<string, unknown>) {
  // default สำหรับทุก call ที่ไม่ได้ตั้งเฉพาะ (เช่น getByMonth ของเดือนก่อนที่ ExpenseTable fetch คู่กันเสมอ)
  api.getByMonth.mockResolvedValue({} as never);
  api.getByMonth.mockResolvedValueOnce(rows as never);
  cards.getMonthInstallments.mockResolvedValue([] as never);
  cards.getRevolving.mockResolvedValue({ cycles: [] } as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  ledger.getLoans.mockResolvedValue({ loans: [], summary: {} } as never);
  goals.getAll.mockResolvedValue({ goals: [] } as never);
  jest.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body);
});
afterEach(() => jest.restoreAllMocks());

describe('AC-SLW-30 read-only slr_ row rendering', () => {
  it('renders 🔒, the chip, static "✓ จ่ายแล้ว" with its aria-label, and no remove control at both tiers', async () => {
    mockInitial({ slr_aaaaaaaaaaaaaaaaaaaaaaaa: repaymentRow });
    render(<ExpenseTable selectedMonth={MONTH} />);
    await waitFor(() => expect(document.querySelectorAll('[data-expense-key="slr_aaaaaaaaaaaaaaaaaaaaaaaa"]').length).toBeGreaterThan(0));

    const rows = Array.from(document.querySelectorAll('[data-expense-key="slr_aaaaaaaaaaaaaaaaaaaaaaaa"]'));
    expect(rows.length).toBe(2); // desktop <tr> + mobile card
    rows.forEach(rowEl => {
      expect(rowEl.textContent).toContain('🔒');
      expect(rowEl.textContent).toContain('คืนเงินกู้ (เงินออม)');
      expect(rowEl.querySelector('input')).toBeNull();
      expect(rowEl.querySelector('button[aria-label^="ลบ"]')).toBeNull();
      const status = rowEl.querySelector('[aria-label="จ่ายแล้ว (แก้ไขไม่ได้)"]');
      expect(status).not.toBeNull();
      expect(status).toHaveTextContent('✓ จ่ายแล้ว');
      expect(status?.tagName).not.toBe('BUTTON');
    });
    expect(screen.getAllByRole('link', { name: 'ดูรายการยืมที่หน้าเงินออม →' }).length).toBe(2);
  });

  it('never renders through the editable customKeys branch (C-S5-1)', async () => {
    mockInitial({ slr_aaaaaaaaaaaaaaaaaaaaaaaa: repaymentRow });
    render(<ExpenseTable selectedMonth={MONTH} />);
    await waitFor(() => expect(document.querySelectorAll('[data-expense-key="slr_aaaaaaaaaaaaaaaaaaaaaaaa"]').length).toBeGreaterThan(0));
    // แถวที่แก้ไขได้มี input ชื่อรายการเสมอ — แถว slr_ ต้องไม่มีเลยสักที่
    document.querySelectorAll('[data-expense-key="slr_aaaaaaaaaaaaaaaaaaaaaaaa"] input').forEach(() => {
      throw new Error('slr_ row must never render an editable input');
    });
  });
});

describe('AC-SLW-29 row-scoped refresh after a repayment', () => {
  it('preserves an unrelated row\'s in-progress edit and never marks the page dirty', async () => {
    mockInitial({ custom_1: { name: 'ค่าไฟ', actual: '1200.00', account: 'กรุงศรี', paid: false, dueDay: 5 } });
    ledger.getLoans.mockResolvedValue({ loans: [openLoan], summary: {} } as never);
    const markDirty = jest.fn();
    render(<ExpenseTable selectedMonth={MONTH} markDirty={markDirty} />);

    // แถวเดียวกันแสดงทั้งเดสก์ท็อปและมือถือพร้อมกันใน jsdom (ไม่ได้ซ่อนด้วย CSS จริง) — แก้แค่ตัวแรกพอ
    const [nameInput] = await screen.findAllByDisplayValue('ค่าไฟ');
    fireEvent.change(nameInput, { target: { value: 'ค่าไฟ (แก้ไขอยู่)' } });

    const repayButton = await screen.findByRole('button', { name: 'คืนเงินกู้ (เงินออม)' });
    fireEvent.click(repayButton);

    await screen.findByRole('dialog');
    await screen.findByRole('radio', { name: /ยอดกลาง/ });
    fireEvent.change(screen.getByLabelText('จำนวนเงินที่คืน (บาท) *'), { target: { value: '500' } });
    fireEvent.click(screen.getByLabelText('เข้าใจแล้ว รายการนี้แก้ไขหรือลบไม่ได้'));

    api.getByMonth.mockResolvedValueOnce({
      custom_1: { name: 'ค่าไฟ', actual: '1200.00', account: 'กรุงศรี', paid: false, dueDay: 5 },
      slr_bbbbbbbbbbbbbbbbbbbbbbbb: repaymentRow
    } as never);
    ledger.getLoans.mockResolvedValue({ loans: [{ ...openLoan, outstandingAmount: 1500 }], summary: {} } as never);
    api.repayLoan.mockResolvedValue({ success: true, appliedAmount: 500, outstandingAmount: 1500, status: 'open', rowKey: 'slr_bbbbbbbbbbbbbbbbbbbbbbbb' });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'บันทึกการคืนเงิน' })); });

    await waitFor(() => expect(document.querySelector('[data-expense-key="slr_bbbbbbbbbbbbbbbbbbbbbbbb"]')).not.toBeNull());
    // แก้ที่อินพุตเดสก์ท็อป → state เดียวกันอัปเดตทั้งสองระดับการแสดงผล (เดสก์ท็อป+มือถือ) ยังคงค่าที่แก้ไว้
    expect(screen.getAllByDisplayValue('ค่าไฟ (แก้ไขอยู่)').length).toBe(2);
    expect(markDirty).not.toHaveBeenCalled();
  });
});

describe('Entry-point button gating (UX_SPEC §5.1)', () => {
  it('does not render the repay button when there is no open loan', async () => {
    mockInitial({});
    ledger.getLoans.mockResolvedValue({ loans: [], summary: {} } as never);
    render(<ExpenseTable selectedMonth={MONTH} />);
    await waitFor(() => expect(ledger.getLoans).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'คืนเงินกู้ (เงินออม)' })).toBeNull();
  });

  it('never breaks the expense page when the loan gate fetch fails', async () => {
    mockInitial({});
    ledger.getLoans.mockRejectedValue(new Error('network'));
    render(<ExpenseTable selectedMonth={MONTH} />);
    await waitFor(() => expect(ledger.getLoans).toHaveBeenCalled());
    // ไม่ขึ้นปุ่ม "คืนเงินกู้" แต่หน้ารายจ่ายยังแสดงรายการ/หัวข้อปกติ ไม่พัง (UX_SPEC §5.1)
    expect(screen.queryByRole('button', { name: 'คืนเงินกู้ (เงินออม)' })).toBeNull();
    expect(await screen.findByRole('heading', { name: 'รายการค่าใช้จ่าย' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '+ เพิ่มรายการค่าใช้จ่าย' })).toBeInTheDocument();
  });

  it('shows the button when there is at least one open loan', async () => {
    mockInitial({});
    ledger.getLoans.mockResolvedValue({ loans: [openLoan], summary: {} } as never);
    render(<ExpenseTable selectedMonth={MONTH} />);
    expect(await screen.findByRole('button', { name: 'คืนเงินกู้ (เงินออม)' })).toBeInTheDocument();
  });
});

// Regression harness for F-S5-1 / F-S5-2 — mirrors WorkspaceShell.tsx's real wiring rather than a shallow mock:
// `onSaved` -> `markClean` (WorkspaceShell.tsx:264) and a wrapping container's `onInput`/`onChange` ->
// `setIsDirty(true)` (WorkspaceShell.tsx:402). A shallow prop-spy (like the markDirty assertion above) cannot
// catch F-S5-1 because that bug was never about `markDirty` — it was `onSaved` reaching `markClean` and
// clearing page-level dirty state out from under an unrelated unsaved edit.
function ShellHarness() {
  const [dirty, setDirty] = useState(false);
  const markClean = () => setDirty(false);
  const markDirty = () => setDirty(true);
  return (
    <div>
      <span data-testid="shell-dirty-state">{dirty ? 'dirty' : 'clean'}</span>
      {/* WorkspaceShell.tsx:402's own container: marks the whole page dirty on any bubbled onInput/onChange */}
      <div onInput={() => setDirty(true)} onChange={() => setDirty(true)}>
        <ExpenseTable selectedMonth={MONTH} onSaved={markClean} markDirty={markDirty} />
      </div>
    </div>
  );
}

describe('F-S5-1 regression — a repayment must not clear unrelated page-level dirty state', () => {
  it('leaves the shell dirty after a successful repayment when another row has an unsaved edit', async () => {
    mockInitial({ custom_1: { name: 'ค่าไฟ', actual: '1200.00', account: 'กรุงศรี', paid: false, dueDay: 5 } });
    ledger.getLoans.mockResolvedValue({ loans: [openLoan], summary: {} } as never);
    render(<ShellHarness />);

    expect(screen.getByTestId('shell-dirty-state')).toHaveTextContent('clean');

    const [nameInput] = await screen.findAllByDisplayValue('ค่าไฟ');
    fireEvent.change(nameInput, { target: { value: 'ค่าไฟ (แก้ไขอยู่)' } });
    expect(screen.getByTestId('shell-dirty-state')).toHaveTextContent('dirty');

    const repayButton = await screen.findByRole('button', { name: 'คืนเงินกู้ (เงินออม)' });
    fireEvent.click(repayButton);
    await screen.findByRole('dialog');
    await screen.findByRole('radio', { name: /ยอดกลาง/ });
    fireEvent.change(screen.getByLabelText('จำนวนเงินที่คืน (บาท) *'), { target: { value: '500' } });
    fireEvent.click(screen.getByLabelText('เข้าใจแล้ว รายการนี้แก้ไขหรือลบไม่ได้'));

    api.getByMonth.mockResolvedValueOnce({
      custom_1: { name: 'ค่าไฟ', actual: '1200.00', account: 'กรุงศรี', paid: false, dueDay: 5 },
      slr_cccccccccccccccccccccccc: repaymentRow
    } as never);
    ledger.getLoans.mockResolvedValue({ loans: [{ ...openLoan, outstandingAmount: 1500 }], summary: {} } as never);
    api.repayLoan.mockResolvedValue({ success: true, appliedAmount: 500, outstandingAmount: 1500, status: 'open', rowKey: 'slr_cccccccccccccccccccccccc' });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'บันทึกการคืนเงิน' })); });

    await waitFor(() => expect(document.querySelector('[data-expense-key="slr_cccccccccccccccccccccccc"]')).not.toBeNull());
    // The repayment succeeded (its own onSaved-equivalent chain ran: row refresh + loan-gate refresh), but the
    // *page's* dirty state — set by the still-unsaved name edit above — must survive it (F-S5-1).
    expect(screen.getByTestId('shell-dirty-state')).toHaveTextContent('dirty');
  });
});

// Delays resolution by `ms` — reproduces the tester-reviewer's repro for F-S5-4 (a real network round-trip
// slower than the old 50ms fallback timer in ExpenseTable.tsx's closeRepaymentDialog).
function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(value), ms));
}

describe('F-S5-4 regression — focus after a full repayment closes the last loan', () => {
  it('lands focus on "+ เพิ่มรายการค่าใช้จ่าย" when the refresh takes longer than the old 50ms timer', async () => {
    mockInitial({});
    ledger.getLoans.mockResolvedValue({ loans: [openLoan], summary: {} } as never);
    render(<ExpenseTable selectedMonth={MONTH} />);

    const repayButton = await screen.findByRole('button', { name: 'คืนเงินกู้ (เงินออม)' });
    fireEvent.click(repayButton);
    await screen.findByRole('dialog');
    await screen.findByRole('radio', { name: /ยอดกลาง/ });
    fireEvent.change(screen.getByLabelText('จำนวนเงินที่คืน (บาท) *'), { target: { value: '2000' } });
    fireEvent.click(screen.getByLabelText('เข้าใจแล้ว รายการนี้แก้ไขหรือลบไม่ได้'));

    // Full repayment closes the only open loan — both refreshRepaymentRows (getByMonth) and
    // refreshSavingsLoanGate (getLoans) resolve after a 200ms round-trip, well past the old 50ms timer.
    api.getByMonth.mockImplementationOnce(() => delay({ slr_dddddddddddddddddddddddd: { ...repaymentRow, actual: 2000 } }, 200) as never);
    ledger.getLoans.mockImplementationOnce(() => delay({ loans: [], summary: {} }, 200) as never);
    api.repayLoan.mockResolvedValue({ success: true, appliedAmount: 2000, outstandingAmount: 0, status: 'closed', rowKey: 'slr_dddddddddddddddddddddddd' });

    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการคืนเงิน' }));

    // F-S5-3: the dialog closes immediately, before the slow refresh settles — don't wait on the refresh here.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // The repay button unmounts once the slow gate refresh resolves (hasOpenSavingsLoan -> false). Before the
    // F-S5-4 fix, focus dropped to <body> at that point instead of moving to "+ เพิ่มรายการค่าใช้จ่าย".
    await waitFor(() => expect(screen.queryByRole('button', { name: 'คืนเงินกู้ (เงินออม)' })).toBeNull(), { timeout: 2000 });
    await waitFor(() => expect(screen.getByRole('button', { name: '+ เพิ่มรายการค่าใช้จ่าย' })).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
  });

  it('still lands focus correctly when the refresh resolves instantly (fast-refresh case)', async () => {
    mockInitial({});
    ledger.getLoans.mockResolvedValue({ loans: [openLoan], summary: {} } as never);
    render(<ExpenseTable selectedMonth={MONTH} />);

    const repayButton = await screen.findByRole('button', { name: 'คืนเงินกู้ (เงินออม)' });
    fireEvent.click(repayButton);
    await screen.findByRole('dialog');
    await screen.findByRole('radio', { name: /ยอดกลาง/ });
    fireEvent.change(screen.getByLabelText('จำนวนเงินที่คืน (บาท) *'), { target: { value: '2000' } });
    fireEvent.click(screen.getByLabelText('เข้าใจแล้ว รายการนี้แก้ไขหรือลบไม่ได้'));

    api.getByMonth.mockResolvedValueOnce({ slr_eeeeeeeeeeeeeeeeeeeeeeee: { ...repaymentRow, actual: 2000 } } as never);
    ledger.getLoans.mockResolvedValue({ loans: [], summary: {} } as never);
    api.repayLoan.mockResolvedValue({ success: true, appliedAmount: 2000, outstandingAmount: 0, status: 'closed', rowKey: 'slr_eeeeeeeeeeeeeeeeeeeeeeee' });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'บันทึกการคืนเงิน' })); });

    await waitFor(() => expect(screen.queryByRole('button', { name: 'คืนเงินกู้ (เงินออม)' })).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: '+ เพิ่มรายการค่าใช้จ่าย' })).toHaveFocus());
  });
});

describe('F-S5-2 regression — dialog field changes must not bubble into page-level dirty state', () => {
  it('does not mark a clean page dirty when typing in the dialog and then cancelling', async () => {
    mockInitial({});
    ledger.getLoans.mockResolvedValue({ loans: [openLoan], summary: {} } as never);
    render(<ShellHarness />);

    expect(screen.getByTestId('shell-dirty-state')).toHaveTextContent('clean');

    const repayButton = await screen.findByRole('button', { name: 'คืนเงินกู้ (เงินออม)' });
    fireEvent.click(repayButton);
    await screen.findByRole('dialog');
    await screen.findByRole('radio', { name: /ยอดกลาง/ });

    fireEvent.change(screen.getByLabelText('จำนวนเงินที่คืน (บาท) *'), { target: { value: '500' } });
    fireEvent.click(screen.getByLabelText('เข้าใจแล้ว รายการนี้แก้ไขหรือลบไม่ได้'));
    expect(screen.getByTestId('shell-dirty-state')).toHaveTextContent('clean');

    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('shell-dirty-state')).toHaveTextContent('clean');
  });
});
