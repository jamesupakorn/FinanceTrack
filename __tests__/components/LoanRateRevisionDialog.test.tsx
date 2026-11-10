// Loan slice S4 / D4 — LoanRateRevisionDialog (UX_SPEC loan-installments §7, §10; spec AC-LN-25, N-4).
// The preview is checked against the shared server functions directly (findRevisionInstallmentNo +
// reviseEffectiveScheduleTail) on the shared fixture; the route-side half of AC-LN-25 lives in
// __tests__/api/credit-cards/rate-revisions.test.ts and uses the same fixture.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LoanRateRevisionDialog, {
  computeLoanRateRevisionPreview,
  type LoanRateRevisionPlan
} from '../../src/frontend/components/LoanRateRevisionDialog';
import { findRevisionInstallmentNo, reviseEffectiveScheduleTail } from '../../src/shared/utils/creditCardAmortization';
import { summarisePlan } from '../../src/shared/utils/creditCardRevolving';
import { round2 } from '../../src/shared/utils/creditCardUtils';
import { formatCurrency } from '../../src/shared/utils/frontend/numberUtils';
import { creditCardAPI } from '../../src/shared/utils/frontend/apiUtils';
import { buildRevisionFixturePlan, REVISION_FIXTURE_INPUTS } from '../helpers/loanRateRevisionFixture';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  creditCardAPI: { reviseLoanRate: jest.fn() }
}));

const reviseLoanRate = creditCardAPI.reviseLoanRate as jest.Mock;

type StoredRow = { no: number; dueMonth: string; payment: number; principal: number; interest: number; paid?: boolean };

function fixturePlan(extra: Record<string, unknown> = {}): LoanRateRevisionPlan {
  return summarisePlan({ ...buildRevisionFixturePlan(), ...extra }) as unknown as LoanRateRevisionPlan;
}

/** Expected numbers straight from the server-side helpers — independent of the dialog's own preview function. */
function serverExpectation(effectiveMonth: string, annualRate: number) {
  const stored = buildRevisionFixturePlan();
  const rows = stored.schedule as unknown as StoredRow[];
  const k = findRevisionInstallmentNo(rows, effectiveMonth);
  if (k === null) throw new Error('fixture month not in schedule');
  const revised = reviseEffectiveScheduleTail({ totalPrice: stored.totalPrice as number, schedule: rows }, { fromInstallmentNo: k, annualRate: round2(annualRate) });
  if (!revised.ok) throw new Error(`fixture revision failed: ${revised.reason}`);
  const current = rows.find(row => row.paid !== true)!.payment;
  return { k, newPayment: revised.monthlyPayment, delta: round2(revised.monthlyPayment - current), totalInterest: revised.totalInterest };
}

function renderDialog(props: Partial<React.ComponentProps<typeof LoanRateRevisionDialog>> = {}) {
  const onClose = jest.fn();
  const onSaved = jest.fn();
  const utils = render(
    <LoanRateRevisionDialog
      open
      plan={fixturePlan()}
      cardName="KBank บ้าน"
      currentMonthKey="2026-11"
      onClose={onClose}
      onSaved={onSaved}
      {...props}
    />
  );
  return { ...utils, onClose, onSaved };
}

const monthSelect = () => screen.getByLabelText('มีผลตั้งแต่งวด *') as HTMLSelectElement;
const rateInput = () => screen.getByLabelText('อัตราใหม่ต่อปี (%) *') as HTMLInputElement;
const confirmButton = () => screen.getByRole('button', { name: /ยืนยันปรับอัตรา|กำลังบันทึก/ });
const cancelButton = () => screen.getByRole('button', { name: 'ยกเลิก' });
const closeButton = () => screen.getByRole('button', { name: 'ปิด' });
const typeRate = (value: string) => fireEvent.change(rateInput(), { target: { value } });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => reviseLoanRate.mockReset());

describe('LoanRateRevisionDialog', () => {
  it('is a labelled dialog, moves focus to the month select on open, and restores focus on close', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const { rerender, onClose, onSaved } = renderDialog();

    expect(screen.getByRole('dialog', { name: 'ปรับอัตราดอกเบี้ย · KBank บ้าน' })).toBeInTheDocument();
    await waitFor(() => expect(monthSelect()).toHaveFocus());

    rerender(<LoanRateRevisionDialog open={false} plan={fixturePlan()} onClose={onClose} onSaved={onSaved} />);
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('offers only the unpaid tail, labelled "งวด n · <เดือน พ.ศ.>", defaulting to the first eligible row', () => {
    renderDialog();
    const options = Array.from(monthSelect().options);
    expect(options).toHaveLength(228);
    expect(options[0]).toHaveTextContent('งวด 13 · ธ.ค. 2570');
    expect(options[0].value).toBe('2027-12');
    expect(options[options.length - 1]).toHaveTextContent('งวด 240');
    expect(monthSelect().value).toBe('2027-12');
  });

  it('defaults to the first eligible row in or after the current month', () => {
    renderDialog({ currentMonthKey: '2028-03' });
    expect(monthSelect().value).toBe('2028-03');
    expect(monthSelect().options[0].value).toBe('2027-12');
  });

  it('starts the options at the latest revision month when it is later than the first unpaid row', () => {
    renderDialog({ plan: fixturePlan({ rateRevisions: [{ effectiveMonth: '2028-06' }] }) });
    const options = Array.from(monthSelect().options);
    expect(options[0].value).toBe('2028-06');
    expect(options[0]).toHaveTextContent('งวด 19 ·');
  });

  it.each(REVISION_FIXTURE_INPUTS)('AC-LN-25: preview equals the shared server computation ($effectiveMonth @ $annualRate%)', ({ effectiveMonth, annualRate }) => {
    renderDialog();
    fireEvent.change(monthSelect(), { target: { value: effectiveMonth } });
    typeRate(String(annualRate));

    const expected = serverExpectation(effectiveMonth, annualRate);
    const sign = expected.delta > 0 ? '+' : expected.delta < 0 ? '−' : '±';
    expect(screen.getByTestId('loan-rate-preview-payment')).toHaveTextContent(
      `${formatCurrency(expected.newPayment)} ฿ (${sign}${formatCurrency(Math.abs(expected.delta))} ฿/งวด)`
    );
    expect(screen.getByText(`${expected.k}–240 (${241 - expected.k} งวด, จำนวนงวดเท่าเดิม)`)).toBeInTheDocument();
    expect(screen.getByText(`${formatCurrency(expected.totalInterest)} ฿`)).toBeInTheDocument();
    expect(screen.getByText('งวดที่ชำระแล้วไม่เปลี่ยนแปลง')).toBeInTheDocument();

    // the exported preview function the dialog renders from agrees too
    const preview = computeLoanRateRevisionPreview(fixturePlan(), effectiveMonth, annualRate);
    expect(preview).toMatchObject({ ok: true, newPayment: expected.newPayment, delta: expected.delta, fromInstallmentNo: expected.k });
    expect(confirmButton()).toBeEnabled();
  });

  it('shows a text minus sign (not colour only) when the new payment is lower', () => {
    renderDialog();
    typeRate('5');
    expect(screen.getByTestId('loan-rate-preview-payment').textContent).toMatch(/\(−[\d,]+\.\d{2} ฿\/งวด\)/);
  });

  it('inline validation: confirm stays disabled while the rate is empty, out of range, non-numeric or unchanged', () => {
    renderDialog();
    expect(confirmButton()).toBeDisabled();

    typeRate('6');
    expect(screen.getByText('อัตราใหม่ต้องต่างจากอัตราปัจจุบัน')).toBeInTheDocument();
    expect(rateInput()).toHaveAttribute('aria-invalid', 'true');
    expect(confirmButton()).toBeDisabled();

    typeRate('6.001');
    expect(screen.getByText('อัตราใหม่ต้องต่างจากอัตราปัจจุบัน')).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();

    for (const bad of ['100.01', '-1', 'abc']) {
      typeRate(bad);
      expect(screen.getByText('อัตราดอกเบี้ยต้องอยู่ระหว่าง 0–100%')).toBeInTheDocument();
      expect(confirmButton()).toBeDisabled();
    }

    typeRate('0');
    expect(rateInput()).toHaveAttribute('aria-invalid', 'false');
    expect(confirmButton()).toBeEnabled();
  });

  it('busy: shows กำลังบันทึก..., disables every control, and makes every close path inert', async () => {
    const pending = deferred<unknown>();
    reviseLoanRate.mockReturnValue(pending.promise);
    const { onClose, onSaved } = renderDialog();
    typeRate('7');
    fireEvent.click(confirmButton());

    expect(reviseLoanRate).toHaveBeenCalledWith('ip_aaaaaaaaaaaa', '2027-12', 7);
    expect(confirmButton()).toHaveTextContent('กำลังบันทึก...');
    expect(confirmButton()).toBeDisabled();
    expect(cancelButton()).toBeDisabled();
    expect(closeButton()).toBeDisabled();
    expect(monthSelect()).toBeDisabled();
    expect(rateInput()).toBeDisabled();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');

    fireEvent.click(cancelButton());
    fireEvent.click(closeButton());
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByRole('presentation'));
    fireEvent.click(confirmButton());
    expect(onClose).not.toHaveBeenCalled();
    expect(reviseLoanRate).toHaveBeenCalledTimes(1);

    const saved = { ...fixturePlan(), monthlyPayment: 7500.12 };
    await act(async () => { pending.resolve({ success: true, plan: saved }); });
    expect(onSaved).toHaveBeenCalledWith({ plan: saved, effectiveMonth: '2027-12', newPayment: 7500.12 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('server failure: shows the error inline with role="alert", keeps the dialog open, and re-enables confirm', async () => {
    reviseLoanRate.mockRejectedValueOnce(new Error('tail has paid installments'));
    const { onClose, onSaved } = renderDialog();
    typeRate('7');
    await act(async () => { fireEvent.click(confirmButton()); });

    expect(await screen.findByRole('alert')).toHaveTextContent('มีงวดที่ชำระแล้วตั้งแต่เดือนที่เลือก — ลองโหลดหน้าใหม่');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(confirmButton()).toHaveTextContent('ยืนยันปรับอัตรา');
    expect(confirmButton()).toBeEnabled();
    expect(cancelButton()).toBeEnabled();

    // an unmapped server message is shown as is
    reviseLoanRate.mockRejectedValueOnce(new Error('rate revision limit reached (120)'));
    await act(async () => { fireEvent.click(confirmButton()); });
    expect(screen.getByRole('alert')).toHaveTextContent('rate revision limit reached (120)');
  });

  it('cancel, ✕, Escape and the backdrop close the dialog when idle', () => {
    const { onClose } = renderDialog();
    fireEvent.click(cancelButton());
    fireEvent.click(closeButton());
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('buttons meet the 44px touch target and the footer is the bottom-sheet thumb zone below 768px', () => {
    renderDialog();
    expect(cancelButton().className).toContain('min-h-11');
    expect(confirmButton().className).toContain('min-h-11');
    // bottom sheet below md, centred max-w-md at md and up; actions sit in the last (footer) block of the panel
    const overlay = screen.getByRole('presentation');
    expect(overlay.className).toContain('items-end');
    expect(overlay.className).toContain('md:items-center');
    const panel = screen.getByRole('dialog');
    expect(panel.className).toContain('md:max-w-md');
    expect(panel.lastElementChild).toContainElement(confirmButton());
    expect(panel.lastElementChild?.className).not.toMatch(/sticky|top-0/);
  });
});

describe('creditCardAPI.reviseLoanRate', () => {
  it('POSTs only planId / effectiveMonth / annualRate to /api/credit-cards/rate-revisions', async () => {
    const actual = jest.requireActual('../../src/shared/utils/frontend/apiUtils') as typeof import('../../src/shared/utils/frontend/apiUtils');
    (jest.requireActual('../../src/shared/utils/frontend/sessionClient') as typeof import('../../src/shared/utils/frontend/sessionClient'))
      .setActiveUserId('rr-user-a');
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) });
    const originalFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      await expect(actual.creditCardAPI.reviseLoanRate('ip_aaaaaaaaaaaa', '2027-12', 7)).resolves.toEqual({ success: true });
    } finally {
      global.fetch = originalFetch;
    }
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/credit-cards/rate-revisions');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({ planId: 'ip_aaaaaaaaaaaa', effectiveMonth: '2027-12', annualRate: 7 });
    expect(Object.keys(body).filter(key => !['planId', 'effectiveMonth', 'annualRate', 'userId'].includes(key))).toEqual([]);
  });
});
