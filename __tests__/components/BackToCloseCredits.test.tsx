/**
 * BackToCloseCredits.test.tsx — D8 (I5d): useBackToClose wired into CreditCardForm, AddCardExpenseSheet,
 * InstallmentPlanForm, BackdatedInstallmentsDialog (both exports), LoanRateRevisionDialog,
 * CreditSpendItems's delete confirm, and pages/credits.tsx's ConfirmDialog
 * (spec-salary-row-and-back-close.md §I5 table rows 15-22).
 *
 * Covers AC-SBC-50 (all 8 surfaces), AC-SBC-51 (the 4 blocked surfaces: AddCardExpenseSheet,
 * BackdatedInstallmentsDialog main, LoanRateRevisionDialog, CreditSpendItems), AC-SBC-52 (the #17+#18
 * nested pair only — InstallmentPlanForm + BackdatedInstallmentsDialog main), AC-SBC-55, AC-SBC-56.
 *
 * Per the architecture review's correction to the handoff's/spec's "3-deep nested" framing: the exported
 * `BackdatedPaidFailureDialog` (#19) is never a DOM descendant of #17/#18 — it's a sibling `pages/credits.tsx`
 * renders directly, swapped in via the already-shipped "close A (and its nested child), open B in one commit"
 * mechanism (spec E-SBC-11), not a true 3-deep Back-press chain. It's modeled here as an ordinary AC-SBC-50
 * case, not folded into the #17+#18 nested-pair assertion.
 *
 * Harness contract (binding, same as overlayHistory.test.ts / BackToCloseExpense.test.tsx / etc.): fake
 * timers, settle ONLY through createOverlayHistoryHarness()'s bounded HISTORY_SETTLE_MS advance
 * (t.pressBack()/t.settleHistory()), and assert pop/call counts beside every negative assertion.
 *
 * AC-SBC-55 ("existing Escape/backdrop/✕ tests pass unedited") is proven by the full Jest run, not by
 * anything in this file — this file only adds Back coverage, per the "don't touch existing tests" rule.
 *
 * KL-SBC-1 (Android hardware Back / iOS edge-swipe / desktop / installed-PWA Back) is OPEN — manual,
 * no agent here has a real browser or device. Not exercised, not claimed done.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import CreditCardForm from '../../src/frontend/components/CreditCardForm';
import AddCardExpenseSheet from '../../src/frontend/components/AddCardExpenseSheet';
import InstallmentPlanForm from '../../src/frontend/components/InstallmentPlanForm';
import BackdatedInstallmentsDialog, { BackdatedPaidFailureDialog } from '../../src/frontend/components/BackdatedInstallmentsDialog';
import LoanRateRevisionDialog from '../../src/frontend/components/LoanRateRevisionDialog';
import CreditSpendItems from '../../src/frontend/components/CreditSpendItems';
import CreditCardsPage from '../../pages/credits';
import type { TickableInstallment } from '../../src/shared/utils/installmentBackdate';
import { creditCardAPI, userSettingsAPI } from '../../src/shared/utils/frontend/apiUtils';
import { summarisePlan } from '../../src/shared/utils/creditCardRevolving';
import { buildRevisionFixturePlan } from '../helpers/loanRateRevisionFixture';
import type { LoanRateRevisionPlan } from '../../src/frontend/components/LoanRateRevisionDialog';
import { __resetOverlayHistoryForTests } from '../../src/shared/utils/frontend/overlayHistory';
import { createOverlayHistoryHarness, type OverlayHistoryHarness } from '../helpers/overlayHistoryHarness';

// Hoisted file-wide (jest.mock calls always are) — harmless for the earlier describes, which don't touch
// next/router, SessionContext or Layout at all. Needed only by row 22's full-page render, at the bottom.
jest.mock('next/router', () => ({
  useRouter: () => ({ isReady: true, pathname: '/credits', query: {}, push: jest.fn(), replace: jest.fn() })
}));
jest.mock('../../src/frontend/contexts/SessionContext', () => ({
  useSession: () => ({ currentUser: { id: 'u-back-to-close' } })
}));
jest.mock('../../src/frontend/components/Layout', () => ({
  __esModule: true,
  default: ({ children }: { children?: import('react').ReactNode }) => <div>{children}</div>
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));
jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  creditCardAPI: {
    createSpendItem: jest.fn(),
    updateSpendItem: jest.fn(),
    listSpendItems: jest.fn(),
    deleteSpendItem: jest.fn(),
    reviseLoanRate: jest.fn(),
    getCards: jest.fn(),
    getPlans: jest.fn(),
    getRevolving: jest.fn(),
    deleteCard: jest.fn()
  },
  expenseAPI: { getByMonth: jest.fn().mockResolvedValue({}) },
  userSettingsAPI: { get: jest.fn() }
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
  jest.useFakeTimers({ now: new Date(2026, 9, 17, 10, 0, 0) });
});

afterEach(() => {
  h?.cleanup();
  h = null;
  __resetOverlayHistoryForTests();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// ---- row 15: CreditCardForm --------------------------------------------

function CreditCardFormHarness({ onCloseSpy }: { onCloseSpy: () => void }) {
  const [open, setOpen] = useState(true);
  return <CreditCardForm open={open} onClose={() => { onCloseSpy(); setOpen(false); }} onSubmit={jest.fn()} />;
}

describe('CreditCardForm (table row 15)', () => {
  it('AC-SBC-50: Back runs onClose, no navigation', () => {
    const t = harness();
    const onClose = jest.fn();
    render(<CreditCardFormHarness onCloseSpy={onClose} />);
    expect(screen.getByRole('dialog', { name: 'เพิ่มบัตรเครดิต' })).toBeInTheDocument();

    expect(t.pressBack()).toBe(1);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(t.router.replace).not.toHaveBeenCalled();
  });

  it('AC-SBC-56: Escape releases its entry with one history.go(-1); the later self-pop does not call onClose again', () => {
    const t = harness();
    const onClose = jest.fn();
    render(<CreditCardFormHarness onCloseSpy={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'เพิ่มบัตรเครดิต' });

    const go = jest.spyOn(window.history, 'go');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);

    expect(t.settleHistory()).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---- row 16: AddCardExpenseSheet ----------------------------------------

const cardA = { id: 'a', name: 'Shopee', statementDay: 25, dueDay: 10 };

function AddCardExpenseSheetHarness({ onCancelSpy }: { onCancelSpy: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <AddCardExpenseSheet
      open={open}
      mode="create"
      cards={[cardA]}
      card={cardA}
      month="2026-10"
      initialStep="spend"
      onChooseInstallment={jest.fn()}
      onCancel={() => { onCancelSpy(); setOpen(false); }}
      onSaved={jest.fn()}
    />
  );
}

describe('AddCardExpenseSheet (table row 16)', () => {
  it('AC-SBC-50: Back runs onCancel, no navigation', () => {
    const t = harness();
    const onCancel = jest.fn();
    render(<AddCardExpenseSheetHarness onCancelSpy={onCancel} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    expect(t.pressBack()).toBe(1);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(t.router.replace).not.toHaveBeenCalled();
  });

  it('AC-SBC-51: blocked (busy, mirrors the disabled ✕/ยกเลิก buttons during save) keeps it open on Back; closes once unblocked', async () => {
    const t = harness();
    const onCancel = jest.fn();
    const pending = deferred<unknown>();
    jest.mocked(creditCardAPI.createSpendItem).mockReturnValue(pending.promise as never);
    render(<AddCardExpenseSheetHarness onCancelSpy={onCancel} />);

    fireEvent.change(screen.getByLabelText('ชื่อรายการ'), { target: { value: 'ข้าว' } });
    fireEvent.change(screen.getByLabelText('จำนวนเงิน (บาท)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกรายการ' }));
    expect(screen.getByRole('button', { name: 'บันทึกรายการ' })).toBeDisabled();

    expect(t.pressBack()).toBe(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // reject (not resolve) so busy clears WITHOUT the save itself closing the sheet — isolates
    // "blocked clears" from "the save succeeded and the parent closed it", same as D7's pattern.
    await act(async () => { pending.reject(new Error('network')); });
    expect(screen.getByRole('button', { name: 'บันทึกรายการ' })).not.toBeDisabled();

    expect(t.pressBack()).toBe(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('AC-SBC-56: Escape releases its entry with one history.go(-1); the later self-pop does not call onCancel again', () => {
    const t = harness();
    const onCancel = jest.fn();
    render(<AddCardExpenseSheetHarness onCancelSpy={onCancel} />);
    const dialog = screen.getByRole('dialog');

    const go = jest.spyOn(window.history, 'go');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);

    expect(t.settleHistory()).toBe(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// ---- row 17/18: InstallmentPlanForm + BackdatedInstallmentsDialog main (AC-SBC-52 pair) ----

const PLAN_CARD = { id: 'c5', name: 'บัตรห้า', statementDay: 5 };

/** Mirrors InstallmentPlanFormBackdate.test.tsx's fixture: startMonth in the past relative to the fake
 * "now" (2026-10-17) produces 5 tickable installments, opening the nested BackdatedInstallmentsDialog. */
function fillBackdatedPlan() {
  fireEvent.change(document.querySelector<HTMLInputElement>('[name="itemName"]')!, { target: { value: 'โทรศัพท์' } });
  fireEvent.change(document.querySelector<HTMLInputElement>('[name="totalPrice"]')!, { target: { value: '45000' } });
  fireEvent.change(document.querySelector<HTMLSelectElement>('[name="startMonth"]')!, { target: { value: '2026-06' } });
  fireEvent.change(document.querySelector<HTMLInputElement>('[name="annualRate"]')!, { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'บันทึกแผนผ่อน' }));
}

function InstallmentPlanFormHarness({ onCloseSpy }: { onCloseSpy: () => void }) {
  const [open, setOpen] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setSubmitting(true)}>set busy</button>
      <button type="button" onClick={() => setSubmitting(false)}>unblock</button>
      <InstallmentPlanForm
        open={open}
        cards={[PLAN_CARD]}
        submitting={submitting}
        onClose={() => { onCloseSpy(); setOpen(false); }}
        onSubmit={jest.fn()}
      />
    </>
  );
}

describe('InstallmentPlanForm alone (table row 17)', () => {
  it('AC-SBC-50: Back runs onClose, no navigation', () => {
    const t = harness();
    const onClose = jest.fn();
    render(<InstallmentPlanFormHarness onCloseSpy={onClose} />);
    expect(screen.getByRole('dialog', { name: 'เพิ่มแผนผ่อนชำระ' })).toBeInTheDocument();

    expect(t.pressBack()).toBe(1);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(t.router.replace).not.toHaveBeenCalled();
  });

  it('AC-SBC-56: Escape releases its entry with one history.go(-1); the later self-pop does not call onClose again', () => {
    const t = harness();
    const onClose = jest.fn();
    render(<InstallmentPlanFormHarness onCloseSpy={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'เพิ่มแผนผ่อนชำระ' });

    const go = jest.spyOn(window.history, 'go');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);

    expect(t.settleHistory()).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('InstallmentPlanForm + BackdatedInstallmentsDialog main, nested (table rows 17+18, AC-SBC-52)', () => {
  it('AC-SBC-50/52: Back closes one layer at a time, top (backdated confirm) first', () => {
    const t = harness();
    const onClose = jest.fn();
    render(<InstallmentPlanFormHarness onCloseSpy={onClose} />);
    fillBackdatedPlan();
    expect(screen.getByRole('dialog', { name: 'มีงวดที่ถึงกำหนดแล้ว 5 งวด' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'เพิ่มแผนผ่อนชำระ' })).toBeInTheDocument();

    // Back 1: closes the top layer only — the plan form stays open
    expect(t.pressBack()).toBe(1);
    expect(screen.queryByRole('dialog', { name: 'มีงวดที่ถึงกำหนดแล้ว 5 งวด' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'เพิ่มแผนผ่อนชำระ' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Back 2: closes the plan form
    expect(t.pressBack()).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'เพิ่มแผนผ่อนชำระ' })).not.toBeInTheDocument();
  });

  it('AC-SBC-51: blocked (busy = submitting, mirrors the disabled ✕/ยกเลิก/ยืนยัน buttons) keeps the nested dialog open on Back; closes once unblocked', () => {
    const t = harness();
    const onClose = jest.fn();
    render(<InstallmentPlanFormHarness onCloseSpy={onClose} />);
    fillBackdatedPlan();
    expect(screen.getByRole('dialog', { name: 'มีงวดที่ถึงกำหนดแล้ว 5 งวด' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'set busy' }));
    expect(t.pressBack()).toBe(1);
    expect(screen.getByRole('dialog', { name: 'มีงวดที่ถึงกำหนดแล้ว 5 งวด' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'unblock' }));
    expect(t.pressBack()).toBe(1);
    expect(screen.queryByRole('dialog', { name: 'มีงวดที่ถึงกำหนดแล้ว 5 งวด' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'เพิ่มแผนผ่อนชำระ' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ---- row 19: BackdatedPaidFailureDialog, ordinary single-overlay case (AC-SBC-50) ----
// Per the architecture review: this is a sibling pages/credits.tsx renders directly, swapped in via a
// "close #17+#18, open #19" single-commit transition, never a DOM descendant of #17/#18 — modeled here
// as an ordinary single-overlay case, not folded into the #17+#18 nested-pair test above.

function makeFailedRows(): Array<{ no: number; dueMonth: string }> {
  return [{ no: 2, dueMonth: '2026-07' }];
}

function BackdatedPaidFailureHarness({ onCloseSpy }: { onCloseSpy: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <BackdatedPaidFailureDialog
      open={open}
      itemName="โทรศัพท์"
      months={10}
      requestedCount={3}
      failed={makeFailedRows()}
      onClose={() => { onCloseSpy(); setOpen(false); }}
      onGoToCard={jest.fn()}
    />
  );
}

describe('BackdatedPaidFailureDialog (table row 19)', () => {
  it('AC-SBC-50: Back runs onClose, no navigation', () => {
    const t = harness();
    const onClose = jest.fn();
    render(<BackdatedPaidFailureHarness onCloseSpy={onClose} />);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    expect(t.pressBack()).toBe(1);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(t.router.replace).not.toHaveBeenCalled();
  });

  it('AC-SBC-56: Escape releases its entry with one history.go(-1); the later self-pop does not call onClose again', () => {
    const t = harness();
    const onClose = jest.fn();
    render(<BackdatedPaidFailureHarness onCloseSpy={onClose} />);
    const dialog = screen.getByRole('alertdialog');

    const go = jest.spyOn(window.history, 'go');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);

    expect(t.settleHistory()).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---- row 20: LoanRateRevisionDialog --------------------------------------

function fixturePlan(extra: Record<string, unknown> = {}): LoanRateRevisionPlan {
  return summarisePlan({ ...buildRevisionFixturePlan(), ...extra }) as unknown as LoanRateRevisionPlan;
}

function LoanRateRevisionHarness({ onCloseSpy }: { onCloseSpy: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <LoanRateRevisionDialog
      open={open}
      plan={fixturePlan()}
      cardName="KBank บ้าน"
      currentMonthKey="2026-11"
      onClose={() => { onCloseSpy(); setOpen(false); }}
      onSaved={jest.fn()}
    />
  );
}

describe('LoanRateRevisionDialog (table row 20)', () => {
  it('AC-SBC-50: Back runs onClose, no navigation', () => {
    const t = harness();
    const onClose = jest.fn();
    render(<LoanRateRevisionHarness onCloseSpy={onClose} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    expect(t.pressBack()).toBe(1);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(t.router.replace).not.toHaveBeenCalled();
  });

  it('AC-SBC-51: blocked (busy during save) keeps it open on Back; closes once busy clears', async () => {
    const t = harness();
    const onClose = jest.fn();
    const pending = deferred<unknown>();
    jest.mocked(creditCardAPI.reviseLoanRate).mockReturnValue(pending.promise as never);
    render(<LoanRateRevisionHarness onCloseSpy={onClose} />);

    fireEvent.change(screen.getByLabelText('อัตราใหม่ต่อปี (%) *'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันปรับอัตรา' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');

    expect(t.pressBack()).toBe(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // reject so busy clears WITHOUT onSaved/onClose firing — isolates "blocked clears" from "the save
    // itself closed the dialog" (onSaved never calls onClose anyway; this keeps the two paths distinct).
    await act(async () => { pending.reject(new Error('tail has paid installments')); });
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-busy', 'true');

    expect(t.pressBack()).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('AC-SBC-56: Escape releases its entry with one history.go(-1); the later self-pop does not call onClose again', () => {
    const t = harness();
    const onClose = jest.fn();
    render(<LoanRateRevisionHarness onCloseSpy={onClose} />);
    const dialog = screen.getByRole('dialog');

    const go = jest.spyOn(window.history, 'go');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);

    expect(t.settleHistory()).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---- row 21: CreditSpendItems delete confirm -----------------------------

const SPEND_CARD_ID = 'cc_000000000001';
const spendItem = { id: 'si_000000000001', cardId: SPEND_CARD_ID, month: '2026-10', purchaseDate: '2026-10-01', name: 'อาหาร', amount: 125 };

async function openSpendDeleteConfirm() {
  render(<CreditSpendItems cardId={SPEND_CARD_ID} month="2026-10" onEdit={jest.fn()} onChanged={jest.fn()} />);
  await screen.findByText('อาหาร');
  fireEvent.click(screen.getByRole('button', { name: 'ตัวเลือกของรายการ อาหาร' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'ลบรายการ' }));
  return screen.getByRole('alertdialog', { name: 'ยืนยันลบรายการไม่ผ่อน' });
}

describe('CreditSpendItems delete confirm (table row 21)', () => {
  beforeEach(() => {
    jest.mocked(creditCardAPI.listSpendItems).mockResolvedValue({ items: [spendItem], totals: { [SPEND_CARD_ID]: 125 } } as never);
  });

  it('AC-SBC-50: Back runs the cancel path, no navigation', async () => {
    const t = harness();
    await openSpendDeleteConfirm();

    expect(t.pressBack()).toBe(1);

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(t.router.replace).not.toHaveBeenCalled();
  });

  it('AC-SBC-51: blocked (busy during delete) keeps it open on Back; closes once busy clears', async () => {
    const t = harness();
    const pending = deferred<unknown>();
    jest.mocked(creditCardAPI.deleteSpendItem).mockReturnValue(pending.promise as never);
    await openSpendDeleteConfirm();

    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันลบ' }));
    expect(screen.getByRole('button', { name: 'ยืนยันลบ' })).toBeDisabled();

    expect(t.pressBack()).toBe(1);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    // reject so busy clears WITHOUT the delete itself closing the dialog
    await act(async () => { pending.reject(new Error('network')); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันลบ' })).not.toBeDisabled());

    expect(t.pressBack()).toBe(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('AC-SBC-56: Escape releases its entry with one history.go(-1); the later self-pop does not double-close', async () => {
    const t = harness();
    const dialog = await openSpendDeleteConfirm();

    const go = jest.spyOn(window.history, 'go');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(go).toHaveBeenCalledTimes(1);

    expect(t.settleHistory()).toBe(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

// ---- row 22: pages/credits.tsx's ConfirmDialog ---------------------------

// CreditCardForm/InstallmentPlanForm/LoanRateRevisionDialog/BackdatedPaidFailureDialog are deliberately NOT
// mocked here (unlike CreditCardsPageAddExpense.test.tsx): they're already rendered real, unmocked, earlier
// in this same file (jest.mock calls are hoisted file-wide, so mocking them here would break those tests).
// They stay closed (open=false) in this scenario, so their own hook call is a no-op and nothing extra renders.
const confirmDialogCard = {
  id: 'cc_page_1', name: 'Shopee', statementDay: 25, dueDay: 10,
  remainingPayable: 0, availableCredit: 0
};

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false
    })
  });
});

async function openDeleteCardConfirm() {
  jest.mocked(creditCardAPI.getCards).mockResolvedValue({ cards: [confirmDialogCard], totals: null } as never);
  jest.mocked(creditCardAPI.getPlans).mockResolvedValue({ plans: [] } as never);
  jest.mocked(creditCardAPI.getRevolving).mockResolvedValue({ cycles: [], truncated: false } as never);
  jest.mocked(creditCardAPI.listSpendItems).mockResolvedValue({ items: [], totals: {} } as never);
  jest.mocked(userSettingsAPI.get).mockResolvedValue({ bankAccounts: [] } as never);
  render(<CreditCardsPage />);
  await screen.findAllByText('Shopee');
  // the tile shows the ⋯ menu only on its back face (tap-to-flip, REV-6 — no flip button, no role) —
  // flip it first, same as CreditCardTileTapFlip.test.tsx
  fireEvent.click(screen.getByTestId('cc-tile-amount'));
  fireEvent.click(screen.getByRole('button', { name: 'ตัวเลือกของบัตร Shopee' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'ลบบัตร' }));
  return screen.getByRole('alertdialog', { name: 'ลบบัตรเครดิต' });
}

describe("pages/credits.tsx's ConfirmDialog (table row 22)", () => {
  it('AC-SBC-50: Back runs onCancel (never onConfirm — Back never navigates), no navigation', async () => {
    const t = harness();
    await openDeleteCardConfirm();

    expect(t.pressBack()).toBe(1);

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(creditCardAPI.deleteCard).not.toHaveBeenCalled();
    expect(t.router.replace).not.toHaveBeenCalled();
  });

  it('AC-SBC-56: Escape releases its entry with one history.go(-1); the later self-pop does not double-close', async () => {
    const t = harness();
    const dialog = await openDeleteCardConfirm();

    const go = jest.spyOn(window.history, 'go');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(go).toHaveBeenCalledTimes(1);

    expect(t.settleHistory()).toBe(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

// ---- Stage 4 (tester) additions ------------------------------------------
// (1) AC-SBC-56 for row 18 — the implementer's file covered Escape for 7 of the 8 surfaces, not the nested
//     BackdatedInstallmentsDialog main.
// (2) E-SBC-11 with the real D8 components: the "close #17+#18, open #19 in one commit" swap that
//     pages/credits.tsx's handleSubmitPlan performs (setBackdateFailure + setPlanFormOpen(false)). The
//     architecture review relies on overlayHistory's queue to serialize it; this proves it end to end.

describe('Stage 4 additions: row 18 Escape, and the #17+#18 → #19 single-commit swap', () => {
  it('AC-SBC-56 (row 18): Escape on the nested backdated dialog releases only its entry; the plan form stays open and held', () => {
    const t = harness();
    const onClose = jest.fn();
    render(<InstallmentPlanFormHarness onCloseSpy={onClose} />);
    fillBackdatedPlan();
    const nested = screen.getByRole('dialog', { name: 'มีงวดที่ถึงกำหนดแล้ว 5 งวด' });

    const go = jest.spyOn(window.history, 'go');
    fireEvent.keyDown(nested, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'มีงวดที่ถึงกำหนดแล้ว 5 งวด' })).not.toBeInTheDocument();
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(-1);

    expect(t.settleHistory()).toBe(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'เพิ่มแผนผ่อนชำระ' })).toBeInTheDocument();

    // the plan form's own entry is still there: the next Back closes it, without routing
    expect(t.pressBack()).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(t.beforePopStateResults).toEqual([false, false]);
    expect(t.router.replace).not.toHaveBeenCalled();
  });

  function SwapHarness({ onPlanClose, onFailureClose }: { onPlanClose: () => void; onFailureClose: () => void }) {
    const [planOpen, setPlanOpen] = useState(true);
    const [failureOpen, setFailureOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => { setFailureOpen(true); setPlanOpen(false); }}>swap</button>
        <InstallmentPlanForm
          open={planOpen}
          cards={[PLAN_CARD]}
          onClose={() => { onPlanClose(); setPlanOpen(false); }}
          onSubmit={jest.fn()}
        />
        <BackdatedPaidFailureDialog
          open={failureOpen}
          itemName="โทรศัพท์"
          months={10}
          requestedCount={3}
          failed={makeFailedRows()}
          onClose={() => { onFailureClose(); setFailureOpen(false); }}
          onGoToCard={jest.fn()}
        />
      </>
    );
  }

  it('E-SBC-11: closing #17+#18 and opening #19 in one commit leaves exactly one held entry; one Back closes #19 only', () => {
    const t = harness();
    const onPlanClose = jest.fn();
    const onFailureClose = jest.fn();
    render(<SwapHarness onPlanClose={onPlanClose} onFailureClose={onFailureClose} />);
    fillBackdatedPlan();
    expect(screen.getByRole('dialog', { name: 'มีงวดที่ถึงกำหนดแล้ว 5 งวด' })).toBeInTheDocument();
    const baseLength = window.history.length;

    const go = jest.spyOn(window.history, 'go');
    fireEvent.click(screen.getByRole('button', { name: 'swap' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    // two serialized self-pops (INV-4: never two go() in flight), then #19's queued push
    let settled = 0;
    for (let i = 0; i < 4 && settled < 2; i += 1) settled += t.settleHistory();
    expect(settled).toBe(2);
    expect(go).toHaveBeenCalledTimes(2);
    // e17+e18 traversed off (forward entries discarded by the next push), e19 pushed on top of the base entry
    expect(window.history.length).toBe(baseLength - 1);
    expect(typeof (window.history.state as Record<string, unknown>).__ftOverlay).toBe('string');

    expect(t.pressBack()).toBe(1);
    expect(onFailureClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onPlanClose).not.toHaveBeenCalled();
    expect(t.router.replace).not.toHaveBeenCalled();
    // every pop so far was consumed by overlayHistory, none reached Next routing
    expect(t.beforePopStateResults.every(result => result === false)).toBe(true);
  });
});
