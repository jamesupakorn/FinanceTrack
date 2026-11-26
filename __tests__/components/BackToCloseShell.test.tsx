/**
 * BackToCloseShell.test.tsx — D5 (I5a): useBackToClose wired into Layout's "เพิ่มเติม" sheet
 * (+ sequencing site S-1), ChangePasswordModal, ExpenseCalendarModal (main dialog + the nested
 * RevolvingConfirmDialog), and SalaryModal (spec-salary-row-and-back-close.md §I5 table rows 1-5).
 * Covers AC-SBC-50, 51, 52, 53, 55, 56, 57.
 *
 * Harness contract (binding, same as overlayHistory.test.ts / WorkspaceShellBackGuard.test.tsx):
 * fake timers, settle ONLY through createOverlayHistoryHarness()'s bounded HISTORY_SETTLE_MS advance
 * (t.pressBack()/t.settleHistory()), and assert pop/call counts beside every negative assertion.
 *
 * AC-SBC-55 ("existing Escape/backdrop/✕ tests pass unedited") is proven by the full Jest run, not by
 * anything in this file — this file only adds Back coverage, per the "don't touch existing tests" rule.
 *
 * KL-SBC-1 (Android hardware Back / iOS edge-swipe / desktop / installed-PWA Back) is OPEN — manual,
 * no agent here has a real browser or device. Not exercised, not claimed done.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import Layout from '../../src/frontend/components/Layout';
import ChangePasswordModal from '../../src/frontend/components/ChangePasswordModal';
import ExpenseCalendarModal from '../../src/frontend/components/ExpenseCalendarModal';
import SalaryModal from '../../src/frontend/components/SalaryModal';
import { expenseAPI, creditCardAPI, salaryAPI, incomeAPI, taxAPI } from '../../src/shared/utils/frontend/apiUtils';
import { getCurrentMonthKey } from '../../src/shared/utils/creditCardUtils';
import { __resetOverlayHistoryForTests } from '../../src/shared/utils/frontend/overlayHistory';
import { createOverlayHistoryHarness, type OverlayHistoryHarness } from '../helpers/overlayHistoryHarness';

// Keep withCsrfHeaders (used by Layout's change-password submit, not exercised here) and every other
// apiUtils export real. Only the clients these 5 surfaces' mounted children touch are stubbed — same
// "one jest.mock() call" convention as ExpenseCalendarModal.test.tsx/SalaryModal.test.tsx.
jest.mock('../../src/shared/utils/frontend/apiUtils', () => {
  const actual = jest.requireActual('../../src/shared/utils/frontend/apiUtils');
  return {
    ...actual,
    expenseAPI: { getAll: jest.fn() },
    creditCardAPI: {
      getCards: jest.fn(),
      getPlans: jest.fn(),
      setInstallmentPaid: jest.fn(),
      setRevolvingAction: jest.fn(),
      getRevolving: jest.fn()
    },
    salaryAPI: { getByMonth: jest.fn(), save: jest.fn() },
    incomeAPI: { save: jest.fn() },
    taxAPI: { updateMonthlyDeductionFields: jest.fn() }
  };
});

const mockedExpenseAPI = jest.mocked(expenseAPI);
const mockedCreditCardAPI = jest.mocked(creditCardAPI);
const mockedSalaryAPI = jest.mocked(salaryAPI);
const mockedIncomeAPI = jest.mocked(incomeAPI);
const mockedTaxAPI = jest.mocked(taxAPI);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentRouter: any;
jest.mock('next/router', () => ({ useRouter: () => currentRouter }));

jest.mock('../../src/frontend/contexts/SessionContext', () => ({
  useSession: () => ({ currentUser: { id: 'u-backtoclose' }, isReady: true, logout: jest.fn() })
}));

const SELECTED_MONTH = getCurrentMonthKey();

/** Sets up all three ExpenseCalendarModal loadData() calls to resolve successfully (same shape as
 * ExpenseCalendarModal.test.tsx's helper). */
function mockLoadOk({
  expenseRows = {},
  cards = [],
  plans = []
}: { expenseRows?: Record<string, unknown>; cards?: Array<Record<string, unknown>>; plans?: Array<Record<string, unknown>> } = {}) {
  mockedExpenseAPI.getAll.mockResolvedValue({ months: { [SELECTED_MONTH]: expenseRows } });
  mockedCreditCardAPI.getCards.mockResolvedValue({ cards });
  mockedCreditCardAPI.getPlans.mockResolvedValue({ plans });
}

let h: OverlayHistoryHarness | null = null;
function harness(options: { asPath?: string } = {}): OverlayHistoryHarness {
  h = createOverlayHistoryHarness(options);
  currentRouter = { ...h.router, pathname: h.router.asPath, query: {}, isReady: true, push: jest.fn() };
  return h;
}

beforeAll(() => {
  // SalaryCalculator (mounted inside SalaryModal) calls this on some rows; jsdom has no layout engine.
  Element.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => {
  jest.useFakeTimers();
  mockLoadOk();
  mockedCreditCardAPI.setInstallmentPaid.mockResolvedValue({});
  mockedCreditCardAPI.setRevolvingAction.mockResolvedValue({});
  mockedCreditCardAPI.getRevolving.mockResolvedValue({ cycles: [] });
  mockedSalaryAPI.getByMonth.mockResolvedValue({ income: {}, deduct: {} });
  mockedSalaryAPI.save.mockResolvedValue({ success: true });
  mockedIncomeAPI.save.mockResolvedValue({});
  mockedTaxAPI.updateMonthlyDeductionFields.mockResolvedValue({});
});

afterEach(() => {
  h?.cleanup();
  h = null;
  __resetOverlayHistoryForTests();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('Layout "เพิ่มเติม" sheet (table row 1, S-1)', () => {
  it('AC-SBC-50/57: Back closes the sheet via setMoreSheetOpen(false), no navigation, asPath unchanged', () => {
    const t = harness({ asPath: '/workspace/savings' });
    render(<Layout activeNav="workspace" title="Workspace" />);

    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มเติม' }));
    expect(screen.getByRole('dialog', { name: 'เมนูเพิ่มเติม' })).toBeInTheDocument();

    expect(t.pressBack()).toBe(1);

    expect(screen.queryByRole('dialog', { name: 'เมนูเพิ่มเติม' })).not.toBeInTheDocument();
    expect(currentRouter.push).not.toHaveBeenCalled();
    expect(t.router.replace).not.toHaveBeenCalled();
    expect(t.router.asPath).toBe('/workspace/savings');
  });

  it('AC-SBC-56: Escape-closing the sheet releases its entry with one history.go(-1) and no double close', () => {
    const t = harness();
    render(<Layout activeNav="dashboard" title="Dashboard" />);
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มเติม' }));
    expect(screen.getByRole('dialog', { name: 'เมนูเพิ่มเติม' })).toBeInTheDocument();

    const go = jest.spyOn(window.history, 'go');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'เมนูเพิ่มเติม' })).not.toBeInTheDocument();
    expect(go).toHaveBeenCalledTimes(1);

    // the self-pop settles; it must be swallowed (no onBack call re-opens or re-closes anything)
    expect(t.settleHistory()).toBe(1);
    expect(go).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'เมนูเพิ่มเติม' })).not.toBeInTheDocument();
  });

  it('AC-SBC-53: tapping a sheet nav item pushes exactly once, only after the sheets own self-pop settles', () => {
    const t = harness();
    render(<Layout activeNav="dashboard" title="Dashboard" />);
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มเติม' }));
    const openedSheet = screen.getByRole('dialog', { name: 'เมนูเพิ่มเติม' });
    const settingsItem = within(openedSheet).getByRole('button', { name: 'ตั้งค่า' });

    const go = jest.spyOn(window.history, 'go');
    fireEvent.click(settingsItem);

    // the sheet closes immediately (plain React state) but the navigation is deferred
    expect(screen.queryByRole('dialog', { name: 'เมนูเพิ่มเติม' })).not.toBeInTheDocument();
    expect(go).toHaveBeenCalledTimes(1);
    expect(currentRouter.push).not.toHaveBeenCalled();

    expect(t.settleHistory()).toBe(1);
    expect(currentRouter.push).toHaveBeenCalledTimes(1);
    expect(currentRouter.push).toHaveBeenCalledWith('/settings');
  });

  it('AC-SBC-53: a sidebar click (sheet already closed) still pushes synchronously, same as today', () => {
    harness();
    render(<Layout activeNav="dashboard" title="Dashboard" />);

    fireEvent.click(screen.getByRole('button', { name: 'แผนการเงินรายเดือน' }));

    expect(currentRouter.push).toHaveBeenCalledTimes(1);
    expect(currentRouter.push).toHaveBeenCalledWith('/workspace/income');
  });

  it('nested, non-AC (architecture-review.md Check 3): opening ChangePasswordModal from inside the still-open sheet stacks on top; Back closes ChangePasswordModal first, then the sheet', () => {
    const t = harness();
    render(<Layout activeNav="dashboard" title="Dashboard" />);

    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มเติม' }));
    const sheet = screen.getByRole('dialog', { name: 'เมนูเพิ่มเติม' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'เปลี่ยนรหัสผ่าน' }));

    // handleOpenChangePassword never calls setMoreSheetOpen(false) — both are stacked overlays now.
    expect(screen.getByRole('dialog', { name: 'เมนูเพิ่มเติม' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ยกเลิก' })).toBeInTheDocument(); // ChangePasswordModal's cancel button (no role="dialog" on this modal, a separately-tracked a11y gap)

    // Back 1: the generic LIFO overlay stack (D3) closes the top-most entry, ChangePasswordModal, only
    expect(t.pressBack()).toBe(1);
    expect(screen.queryByRole('button', { name: 'ยกเลิก' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'เมนูเพิ่มเติม' })).toBeInTheDocument();

    // Back 2: closes the sheet
    expect(t.pressBack()).toBe(1);
    expect(screen.queryByRole('dialog', { name: 'เมนูเพิ่มเติม' })).not.toBeInTheDocument();
    expect(currentRouter.push).not.toHaveBeenCalled();
  });
});

describe('ChangePasswordModal (table row 2)', () => {
  function renderChangePassword(initialSubmitting: boolean): { getCloseCalls: () => number } {
    let closeCalls = 0;
    function Harness() {
      const [open, setOpen] = useState(true);
      const [submitting, setSubmitting] = useState(initialSubmitting);
      return (
        <>
          <button type="button" onClick={() => setSubmitting(false)}>unblock</button>
          <ChangePasswordModal
            open={open}
            onClose={() => { closeCalls += 1; setOpen(false); }}
            onSubmit={jest.fn()}
            errorMessage=""
            isSubmitting={submitting}
          />
        </>
      );
    }
    render(<Harness />);
    return { getCloseCalls: () => closeCalls };
  }

  it('AC-SBC-50: Back runs onClose (the same path "ยกเลิก" uses), no navigation', () => {
    const t = harness();
    const { getCloseCalls } = renderChangePassword(false);
    expect(screen.getByRole('button', { name: 'ยกเลิก' })).toBeInTheDocument();

    expect(t.pressBack()).toBe(1);

    expect(getCloseCalls()).toBe(1);
    expect(screen.queryByRole('button', { name: 'ยกเลิก' })).not.toBeInTheDocument();
    expect(t.router.replace).not.toHaveBeenCalled();
  });

  it('AC-SBC-51: blocked (isSubmitting, mirrors the disabled cancel button) keeps it open on Back; closes once unblocked', () => {
    const t = harness();
    const { getCloseCalls } = renderChangePassword(true);

    expect(t.pressBack()).toBe(1);
    expect(getCloseCalls()).toBe(0);
    expect(screen.getByRole('button', { name: 'ยกเลิก' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'unblock' }));
    expect(t.pressBack()).toBe(1);

    expect(getCloseCalls()).toBe(1);
    expect(screen.queryByRole('button', { name: 'ยกเลิก' })).not.toBeInTheDocument();
  });
});

/** Mirrors the real call site (Layout owns `open` via state and flips it off in onClose) — these
 * components never unmount themselves, so the harness must do what the real parent does. */
function ExpenseCalendarHarness({ onCloseSpy }: { onCloseSpy: (result: { changed: boolean }) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <ExpenseCalendarModal
      open={open}
      onClose={(result) => { onCloseSpy(result); setOpen(false); }}
    />
  );
}

describe('ExpenseCalendarModal main dialog (table row 3)', () => {
  it('AC-SBC-50: Back (no confirm layer open) runs handleClose, no navigation', async () => {
    const t = harness();
    const onClose = jest.fn();
    render(<ExpenseCalendarHarness onCloseSpy={onClose} />);
    await screen.findByRole('grid');

    expect(t.pressBack()).toBe(1);

    expect(onClose).toHaveBeenCalledWith({ changed: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(t.router.replace).not.toHaveBeenCalled();
  });
});

describe('ExpenseCalendarModal + nested RevolvingConfirmDialog (table row 4, AC-SBC-52 pair)', () => {
  it('AC-SBC-50/52: Back closes one layer at a time, top (confirm) first', async () => {
    const cardId = 'cc_ffffffffffff';
    mockLoadOk({
      expenseRows: { ccr_ffffffffffff: { name: 'ยอดใช้จ่ายบัตร F', actual: 8000, account: '', paid: false, dueDay: 10 } },
      cards: [{ id: cardId, name: 'บัตร F', color: '#333333' }]
    });
    mockedCreditCardAPI.getRevolving.mockResolvedValue({
      cycles: [{ month: SELECTED_MONTH, minPaymentDue: 800, minimumPreview: { remaining: 7200, interest: 100, closingBalance: 7300 } }]
    });
    const onClose = jest.fn();
    const t = harness();
    const user = userEvent.setup({ delay: null, advanceTimers: jest.advanceTimersByTime });
    render(<ExpenseCalendarHarness onCloseSpy={onClose} />);
    await screen.findByRole('grid');

    await user.click(await screen.findByRole('button', { name: 'จ่ายขั้นต่ำ' }));
    await screen.findByRole('alertdialog');

    // Back 1: closes the top layer (the confirm dialog) only — main calendar stays open
    expect(t.pressBack()).toBe(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Back 2: closes the main calendar
    expect(t.pressBack()).toBe(1);
    expect(onClose).toHaveBeenCalledWith({ changed: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

function SalaryModalOpenToggle({ onCloseSpy }: { onCloseSpy: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <SalaryModal
      open={open}
      selectedMonth="2026-01"
      onClose={() => { onCloseSpy(); setOpen(false); }}
      onSaved={jest.fn()}
    />
  );
}

describe('SalaryModal (table row 5)', () => {
  it('AC-SBC-50: Back runs onClose, no navigation', async () => {
    const t = harness();
    const onClose = jest.fn();
    render(<SalaryModalOpenToggle onCloseSpy={onClose} />);
    await screen.findByLabelText('บันทึกเงินเดือน');

    expect(t.pressBack()).toBe(1);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(t.router.replace).not.toHaveBeenCalled();
  });

  it('AC-SBC-56: Escape releases with one history.go(-1); the later self-pop does not call onClose again', async () => {
    const t = harness();
    const onClose = jest.fn();
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <SalaryModal
          open={open}
          selectedMonth="2026-01"
          onClose={() => { onClose(); setOpen(false); }}
          onSaved={jest.fn()}
        />
      );
    }
    render(<Harness />);
    await screen.findByLabelText('บันทึกเงินเดือน');

    const go = jest.spyOn(window.history, 'go');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);

    expect(t.settleHistory()).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
