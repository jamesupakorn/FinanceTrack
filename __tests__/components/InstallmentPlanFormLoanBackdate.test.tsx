// N-1 regression (architecture-review/task-type/task-size `loan-installments-s6`): the backdated-row
// detection at InstallmentPlanForm.tsx used to call the raw, non-loan-aware `getCardDueMonthOffset`
// primitive instead of the loan-aware `cardDueMonthOffset(card)` wrapper. A loan's `statementDay` is
// never submitted client-side (it defaults server-side to END_OF_MONTH_DUE_DAY), so the raw primitive
// always computed offset 1 for loans instead of the BR-CC-037-correct 0 — silently shifting
// `findTickableInstallments`'s cutoff by one month and dropping the current-month row from the
// backdated-paid dialog's list, even though the dialog promises to include it.
//
// This test exercises the REAL (unmocked) BackdatedInstallmentsDialog through the real submit path,
// unlike CreditCardsPageLoanFlow.test.tsx / LoanS3TesterSupplement.test.tsx, which mock the dialog
// module down to only BackdatedPaidFailureDialog and never reach this calculation. It fails on the
// pre-fix code (the dialog never opens because the only row is excluded) and passes after the fix.
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import InstallmentPlanForm, { type PlanSubmitOptions, type PlanSubmitValues } from '../../src/frontend/components/InstallmentPlanForm';

jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

// No `statementDay` — matches a real loan card: the field is never submitted in loan mode and the
// server normalises it to END_OF_MONTH_DUE_DAY. This is exactly the shape that exposes the N-1 defect.
const LOAN_CARD = { id: 'cc_loan_1', name: 'บ้านลาดพร้าว', cardType: 'home_loan', bankIssuer: 'kbank', dueDay: 5 };

beforeEach(() => {
  jest.useFakeTimers({
    now: new Date(2026, 9, 17, 3, 0, 0), // 2026-10-17 → getCurrentMonthKey() === '2026-10'
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'queueMicrotask', 'nextTick']
  });
});

afterEach(() => jest.useRealTimers());

function fillLoanPlan() {
  fireEvent.change(document.querySelector<HTMLInputElement>('[name="itemName"]')!, { target: { value: 'สัญญา 999' } });
  fireEvent.change(document.querySelector<HTMLInputElement>('[name="totalPrice"]')!, { target: { value: '120000' } });
  fireEvent.change(document.querySelector<HTMLInputElement>('[name="annualRate"]')!, { target: { value: '0' } });
  // Year/month selects are left at their default (today's month, per the component's own
  // pre-fill behaviour), so the plan's first instalment is due in the current month, 2026-10.
  fireEvent.click(screen.getByRole('button', { name: 'บันทึกสินเชื่อ' }));
}

describe('InstallmentPlanForm — loan backdated dialog, N-1 offset regression (BR-CC-037)', () => {
  it('lists the current-month installment as tickable for a loan (offset must be 0, not 1)', () => {
    const onSubmit = jest.fn();
    render(<InstallmentPlanForm open cards={[LOAN_CARD]} lockedCardId="cc_loan_1" onSubmit={onSubmit} />);

    fillLoanPlan();

    // Pre-fix: the raw offset primitive returns 1 for this loan (no statementDay → EOM → 31,
    // dueDay 5 <= 31), shifting the cutoff so the only row (due 2026-10, the current month) is
    // excluded. `rows.length` is then 0, the dialog never opens, and onSubmit fires immediately
    // with no `paidInstallmentNos` option — this assertion fails on HEAD.
    const dialog = screen.getByRole('dialog', { name: 'มีงวดที่ถึงกำหนดแล้ว 1 งวด' });
    expect(dialog).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    const pill = within(dialog).getByRole('button', { name: 'ยังไม่ชำระ — แตะเพื่อยืนยัน' });
    fireEvent.click(pill);
    fireEvent.click(within(dialog).getByRole('button', { name: 'ยืนยัน' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    // D4 (loan-installments-s6): the options bag now also carries `onProgress` (Decision R), so this
    // checks the N-1-relevant field directly instead of exact-matching the whole options object.
    expect(onSubmit.mock.calls[0][1]?.paidInstallmentNos).toEqual([1]);
  });
});

// D4 (loan-installments-s6): live progress plumbing (N-2 part b, Decision R/S/T). The page owns no
// progress state of its own — it only forwards `onProgress` from the options bag to
// `applyPaidSequentially`'s 4th argument — so this drives the form through a loan backdated confirm
// with a stubbed save (standing in for `applyPaidSequentially`/`setPaid`) and asserts the live line
// in the real, unmocked `BackdatedInstallmentsDialog` advances and reaches `N/N` (catches a stuck
// counter, the main risk) instead of staying frozen or disappearing early.
function LoanBackdateProgressHarness({
  onConfirmSave
}: {
  onConfirmSave: (values: PlanSubmitValues, options?: PlanSubmitOptions) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = async (values: PlanSubmitValues, options?: PlanSubmitOptions) => {
    setSubmitting(true);
    try {
      await onConfirmSave(values, options);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <InstallmentPlanForm open cards={[LOAN_CARD]} lockedCardId="cc_loan_1" submitting={submitting} onSubmit={handleSubmit} />
  );
}

describe('InstallmentPlanForm — live progress line during a loan backdated save (D4)', () => {
  it('advances the live progress line from 1/N to N/N and the dialog stays open until it settles', async () => {
    const total = 3;
    const stubbedSave = jest.fn(async (_values: PlanSubmitValues, options?: PlanSubmitOptions) => {
      for (let done = 1; done <= total; done++) {
        // Real `setTimeout` (not faked, see `doNotFake` above) so each step yields a separate tick,
        // letting the test observe intermediate renders instead of only the final one.
        await new Promise(resolve => setTimeout(resolve, 5));
        options?.onProgress?.(done, total);
        // Extra yield after the last step so the `N/N` render flushes and is observable before this
        // save settles and the dialog's `finally` closes it (otherwise the two updates batch together
        // and `N/N` is never actually painted — the exact "stuck counter" failure mode this test guards).
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    });

    render(<LoanBackdateProgressHarness onConfirmSave={stubbedSave} />);
    fillLoanPlan();

    const dialog = screen.getByRole('dialog', { name: 'มีงวดที่ถึงกำหนดแล้ว 1 งวด' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'ยังไม่ชำระ — แตะเพื่อยืนยัน' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'ยืนยัน' }));

    // Decision S: the progress line replaces the selection-count line while busy — only one
    // `aria-live` region is active, never both.
    expect(await within(dialog).findByText('กำลังบันทึกงวดที่ชำระแล้ว 1/3…')).toBeInTheDocument();
    expect(within(dialog).queryByText(/ยืนยันว่าชำระแล้ว/)).not.toBeInTheDocument();

    expect(await within(dialog).findByText('กำลังบันทึกงวดที่ชำระแล้ว 2/3…')).toBeInTheDocument();
    expect(await within(dialog).findByText('กำลังบันทึกงวดที่ชำระแล้ว 3/3…')).toBeInTheDocument();

    // Once the stubbed save settles, the backdated dialog closes (matches the real `finally` /
    // `setBackdate(null)` path), leaving only the loan setup form behind.
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /มีงวดที่ถึงกำหนดแล้ว/ })).not.toBeInTheDocument();
    });
    expect(screen.queryByText(/กำลังบันทึกงวดที่ชำระแล้ว/)).not.toBeInTheDocument();
    expect(stubbedSave).toHaveBeenCalledTimes(1);
  });
});
