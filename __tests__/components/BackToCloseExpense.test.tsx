/**
 * BackToCloseExpense.test.tsx — D7 (I5c): useBackToClose wired into CardExpenseDetailsDialog,
 * CardTotalPaymentDialog and SavingsLoanRepaymentDialog (spec-salary-row-and-back-close.md §I5 table
 * rows 12-14), plus sequencing site S-2 (CardExpenseDetailsDialog's management Link).
 * Covers AC-SBC-50, 51 (CardTotalPaymentDialog/SavingsLoanRepaymentDialog only — AC-SBC-51 is N/A for
 * CardExpenseDetailsDialog, which has no busy/blocked flag), 54, 55, 56.
 *
 * Harness contract (binding, same as overlayHistory.test.ts / BackToCloseShell.test.tsx): fake timers,
 * settle ONLY through createOverlayHistoryHarness()'s bounded HISTORY_SETTLE_MS advance
 * (t.pressBack()/t.settleHistory()), and assert pop/call counts beside every negative assertion.
 *
 * AC-SBC-55 ("existing Escape/backdrop/✕ tests pass unedited") is proven by the full Jest run, not by
 * anything in this file — this file only adds Back/S-2 coverage, per the "don't touch existing tests" rule.
 * The existing CardExpenseDetailsDialog.test.tsx's focus-trap test (which touches the management Link via
 * focus/Tab but never clicks it) is confirmed to pass unedited by that same full run.
 *
 * KL-SBC-1 (Android hardware Back / iOS edge-swipe / desktop / installed-PWA Back) is OPEN — manual,
 * no agent here has a real browser or device. Not exercised, not claimed done.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import CardExpenseDetailsDialog from '../../src/frontend/components/CardExpenseDetailsDialog';
import CardTotalPaymentDialog from '../../src/frontend/components/CardTotalPaymentDialog';
import SavingsLoanRepaymentDialog from '../../src/frontend/components/SavingsLoanRepaymentDialog';
import { expenseAPI, savingsGoalsAPI, savingsLedgerAPI } from '../../src/shared/utils/frontend/apiUtils';
import { __resetOverlayHistoryForTests } from '../../src/shared/utils/frontend/overlayHistory';
import { createOverlayHistoryHarness, type OverlayHistoryHarness } from '../helpers/overlayHistoryHarness';

// S-2 imports the next/router singleton default export (not useRouter) specifically so the existing
// CardExpenseDetailsDialog.test.tsx, which mounts with no router context at all, keeps passing — mock only
// the default export's `push`, same shape the component relies on.
jest.mock('next/router', () => ({ __esModule: true, default: { push: jest.fn() } }));
import Router from 'next/router';
const mockedRouterPush = (Router as unknown as { push: jest.Mock }).push;

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  expenseAPI: { repayLoan: jest.fn() },
  savingsLedgerAPI: { getLoans: jest.fn() },
  savingsGoalsAPI: { getAll: jest.fn() }
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

const mockedGetLoans = savingsLedgerAPI.getLoans as jest.Mock;
const mockedGetAllGoals = savingsGoalsAPI.getAll as jest.Mock;

const DETAILS = {
  installments: [],
  installmentTotal: 0,
  revolving: {
    newSpend: 0,
    carriedBalance: 0,
    cashbackAmount: 0,
    totalDue: 0,
    minPaymentDue: 0,
    amountDue: 0,
    paymentAction: null as null | 'minimum'
  }
};

let h: OverlayHistoryHarness | null = null;
function harness(options: { asPath?: string } = {}): OverlayHistoryHarness {
  h = createOverlayHistoryHarness(options);
  return h;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockedGetLoans.mockResolvedValue({ loans: [] });
  mockedGetAllGoals.mockResolvedValue({ goals: [] });
  mockedRouterPush.mockClear();
});

afterEach(() => {
  h?.cleanup();
  h = null;
  __resetOverlayHistoryForTests();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/** Mirrors ExpenseTable.tsx:1069-1080's conditional mount/unmount — this dialog has no `open` prop. */
function CardExpenseDetailsHarness({ onCloseSpy }: { onCloseSpy: () => void }) {
  const [show, setShow] = useState(true);
  const openerRef = useRef<HTMLButtonElement>(null);
  return (
    <main>
      <button ref={openerRef} type="button">opener</button>
      {show && (
        <CardExpenseDetailsDialog
          cardId="card123"
          cardName="บัตรทดสอบ"
          month="2026-08"
          total={1300}
          breakdown={DETAILS}
          opener={openerRef.current}
          fallback={null}
          onClose={() => { onCloseSpy(); setShow(false); }}
        />
      )}
    </main>
  );
}

describe('CardExpenseDetailsDialog (table row 12)', () => {
  it('AC-SBC-50: Back runs onClose, no navigation', () => {
    const t = harness();
    const onClose = jest.fn();
    render(<CardExpenseDetailsHarness onCloseSpy={onClose} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    expect(t.pressBack()).toBe(1);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockedRouterPush).not.toHaveBeenCalled();
    expect(t.router.replace).not.toHaveBeenCalled();
  });

  it('AC-SBC-56: Escape releases its entry with one history.go(-1); the later self-pop does not call onClose again', () => {
    const t = harness();
    const onClose = jest.fn();
    render(<CardExpenseDetailsHarness onCloseSpy={onClose} />);
    const dialog = screen.getByRole('dialog');

    const go = jest.spyOn(window.history, 'go');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);

    expect(t.settleHistory()).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('S-2: management Link sequencing (AC-SBC-54)', () => {
    function openDialog(onClose = jest.fn()) {
      render(<CardExpenseDetailsHarness onCloseSpy={onClose} />);
      const link = screen.getByRole('link', { name: 'จัดการที่หน้าบัตร & สินเชื่อ →' });
      return { link, onClose };
    }

    it('plain click while held: preventDefault, then Router.push only after the dialogs own popstate settles', () => {
      harness();
      const { link } = openDialog();

      const go = jest.spyOn(window.history, 'go');
      const notCanceled = fireEvent.click(link, { button: 0 });

      // defaultPrevented: fireEvent's dispatchEvent return value is false once preventDefault() ran
      expect(notCanceled).toBe(false);
      expect(go).toHaveBeenCalledTimes(1);
      // the dialog's own entry must be gone from history before the cross-page push, not concurrently
      expect(mockedRouterPush).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      expect(h!.settleHistory()).toBe(1);
      expect(mockedRouterPush).toHaveBeenCalledTimes(1);
      expect(mockedRouterPush).toHaveBeenCalledWith('/credits?card=card123');
    });

    it('ctrl/meta click is not prevented (open-in-new-tab stays intact)', () => {
      harness();
      const { link } = openDialog();

      const go = jest.spyOn(window.history, 'go');
      const notCanceled = fireEvent.click(link, { button: 0, ctrlKey: true });

      expect(notCanceled).toBe(true);
      expect(mockedRouterPush).not.toHaveBeenCalled();
      expect(go).not.toHaveBeenCalled();
    });

    it('meta click is not prevented (open-in-new-tab stays intact)', () => {
      harness();
      const { link } = openDialog();

      const go = jest.spyOn(window.history, 'go');
      const notCanceled = fireEvent.click(link, { button: 0, metaKey: true });

      expect(notCanceled).toBe(true);
      expect(mockedRouterPush).not.toHaveBeenCalled();
      expect(go).not.toHaveBeenCalled();
    });

    it('not installed: not prevented, Router.push is never called by this handler', () => {
      // deliberately no harness() call — overlayHistory stays uninstalled, back.isHeld() is false
      const onClose = jest.fn();
      render(<CardExpenseDetailsHarness onCloseSpy={onClose} />);
      const link = screen.getByRole('link', { name: 'จัดการที่หน้าบัตร & สินเชื่อ →' });

      const go = jest.spyOn(window.history, 'go');
      const notCanceled = fireEvent.click(link, { button: 0 });

      expect(notCanceled).toBe(true);
      expect(mockedRouterPush).not.toHaveBeenCalled();
      expect(go).not.toHaveBeenCalled();
    });

    it('a second plain click before the first click\'s go(-1) popstate settles is unconditionally prevented; only one Router.push happens after settle (review Minor #1)', () => {
      harness();
      const { link } = openDialog();

      const go = jest.spyOn(window.history, 'go');

      const firstNotCanceled = fireEvent.click(link, { button: 0 });
      expect(firstNotCanceled).toBe(false);
      expect(go).toHaveBeenCalledTimes(1);
      expect(mockedRouterPush).not.toHaveBeenCalled();

      // Second plain click arrives while the first click's go(-1) popstate is still in flight — i.e.
      // before settleHistory() is called. navigatingRef must prevent it unconditionally, without a
      // second history.go(-1) and without queuing a second push.
      const secondNotCanceled = fireEvent.click(link, { button: 0 });
      expect(secondNotCanceled).toBe(false);
      expect(go).toHaveBeenCalledTimes(1);
      expect(mockedRouterPush).not.toHaveBeenCalled();

      expect(h!.settleHistory()).toBe(1);
      expect(mockedRouterPush).toHaveBeenCalledTimes(1);
      expect(mockedRouterPush).toHaveBeenCalledWith('/credits?card=card123');
    });
  });
});

function CardTotalPaymentHarness({ onCancelSpy, busy = false }: { onCancelSpy: () => void; busy?: boolean }) {
  const [show, setShow] = useState(true);
  const [isBusy, setIsBusy] = useState(busy);
  return (
    <>
      <button type="button" onClick={() => setIsBusy(false)}>unblock</button>
      {show && (
        <CardTotalPaymentDialog
          row={{ name: 'บัตรทดสอบ', breakdown: DETAILS }}
          paid
          busy={isBusy}
          onCancel={() => { onCancelSpy(); setShow(false); }}
          onConfirm={jest.fn()}
        />
      )}
    </>
  );
}

describe('CardTotalPaymentDialog (table row 13)', () => {
  it('AC-SBC-50: Back runs onCancel, no navigation', () => {
    const t = harness();
    const onCancel = jest.fn();
    render(<CardTotalPaymentHarness onCancelSpy={onCancel} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    expect(t.pressBack()).toBe(1);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(t.router.replace).not.toHaveBeenCalled();
  });

  it('AC-SBC-51: blocked (busy, mirrors the disabled cancel button) keeps it open on Back; closes once unblocked', () => {
    const t = harness();
    const onCancel = jest.fn();
    render(<CardTotalPaymentHarness onCancelSpy={onCancel} busy />);

    expect(t.pressBack()).toBe(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'unblock' }));
    expect(t.pressBack()).toBe(1);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('AC-SBC-56: Escape releases its entry with one history.go(-1); the later self-pop does not call onCancel again', () => {
    const t = harness();
    const onCancel = jest.fn();
    render(<CardTotalPaymentHarness onCancelSpy={onCancel} />);
    const dialog = screen.getByRole('dialog');

    const go = jest.spyOn(window.history, 'go');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);

    expect(t.settleHistory()).toBe(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

function SavingsLoanRepaymentHarness({ onCloseSpy }: { onCloseSpy: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <SavingsLoanRepaymentDialog
      open={open}
      month="2026-11"
      bankAccounts={['กรุงศรี']}
      onClose={() => { onCloseSpy(); setOpen(false); }}
      onSaved={jest.fn().mockResolvedValue(undefined)}
    />
  );
}

describe('SavingsLoanRepaymentDialog (table row 14)', () => {
  it('AC-SBC-50: Back runs onClose, no navigation', async () => {
    const t = harness();
    const onClose = jest.fn();
    render(<SavingsLoanRepaymentHarness onCloseSpy={onClose} />);
    await act(async () => {});
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    expect(t.pressBack()).toBe(1);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(t.router.replace).not.toHaveBeenCalled();
  });

  it('AC-SBC-51: blocked (busy, mirrors the Escape handlers own !busy guard) keeps it open on Back', async () => {
    mockedGetLoans.mockResolvedValue({
      loans: [{
        _id: 'loan-1', userId: 'u1', source: { type: 'pool' }, principalAmount: 1000,
        outstandingAmount: 1000, status: 'open', note: null,
        createdAt: '2026-07-03T00:00:00.000Z', updatedAt: '2026-07-03T00:00:00.000Z',
        closedAt: null, repayments: []
      }]
    });
    const t = harness();
    const onClose = jest.fn();
    render(<SavingsLoanRepaymentHarness onCloseSpy={onClose} />);
    await act(async () => {});
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // submit() sets busy=true synchronously before awaiting repayLoan; repayLoan is left pending so
    // the dialog stays busy for the first Back assertion below (mirrors the real in-flight-save window).
    // Rejecting it (rather than resolving) exercises submit()'s catch branch, which clears busy WITHOUT
    // calling onClose — this isolates "blocked clears" from "the save itself closed the dialog", so the
    // second Back below is the thing that actually closes it, not a side effect of the save succeeding.
    const { expenseAPI: mockedExpenseAPI } = jest.requireMock('../../src/shared/utils/frontend/apiUtils');
    let rejectRepay: (reason: unknown) => void = () => {};
    mockedExpenseAPI.repayLoan.mockImplementation(() => new Promise((_resolve, reject) => { rejectRepay = reject; }));
    fireEvent.click(screen.getByRole('radio'));
    fireEvent.change(screen.getByLabelText('จำนวนเงินที่คืน (บาท) *'), { target: { value: '500' } });
    fireEvent.click(screen.getByLabelText('เข้าใจแล้ว รายการนี้แก้ไขหรือลบไม่ได้'));
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการคืนเงิน' }));
    expect(screen.getByRole('button', { name: 'กำลังบันทึก...' })).toBeInTheDocument();

    expect(t.pressBack()).toBe(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await act(async () => { rejectRepay(new Error('network')); });
    expect(screen.getByRole('button', { name: 'บันทึกการคืนเงิน' })).not.toBeDisabled();

    expect(t.pressBack()).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('AC-SBC-56: Escape releases its entry with one history.go(-1); the later self-pop does not call onClose again', async () => {
    const t = harness();
    const onClose = jest.fn();
    render(<SavingsLoanRepaymentHarness onCloseSpy={onClose} />);
    await act(async () => {});
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const go = jest.spyOn(window.history, 'go');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);

    expect(t.settleHistory()).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
