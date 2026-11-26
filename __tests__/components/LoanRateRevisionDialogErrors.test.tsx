// Loan TD cleanup D2 (§I2, AC-TDC-05…10) — server error text mapping for LoanRateRevisionDialog.
// Covers the entries added on top of the pre-existing 7 SERVER_ERROR_TEXT entries (D1) and the
// rate-revision-limit prefix rule. This file is extended by later dispatches (D4/I4) — keep additions
// scoped to their own AC and don't rework the existing describe blocks without checking those ACs.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import LoanRateRevisionDialog from '../../src/frontend/components/LoanRateRevisionDialog';
import { creditCardAPI } from '../../src/shared/utils/frontend/apiUtils';
import { MAX_RATE_REVISIONS_PER_PLAN } from '../../src/shared/utils/creditCardBasics';
import { summarisePlan } from '../../src/shared/utils/creditCardRevolving';
import { buildRevisionFixturePlan } from '../helpers/loanRateRevisionFixture';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  creditCardAPI: { reviseLoanRate: jest.fn() }
}));

const reviseLoanRate = creditCardAPI.reviseLoanRate as jest.Mock;

function fixturePlan() {
  return summarisePlan(buildRevisionFixturePlan()) as unknown as React.ComponentProps<typeof LoanRateRevisionDialog>['plan'];
}

function renderDialog() {
  const onClose = jest.fn();
  const onSaved = jest.fn();
  render(
    <LoanRateRevisionDialog
      open
      plan={fixturePlan()}
      cardName="KBank บ้าน"
      currentMonthKey="2026-11"
      onClose={onClose}
      onSaved={onSaved}
    />
  );
  return { onClose, onSaved };
}

const rateInput = () => screen.getByLabelText('อัตราใหม่ต่อปี (%) *') as HTMLInputElement;
const confirmButton = () => screen.getByRole('button', { name: /ยืนยันปรับอัตรา|กำลังบันทึก/ });
const typeRate = (value: string) => fireEvent.change(rateInput(), { target: { value } });

/** Renders a fresh dialog, submits with the given server error, and returns its alert text.
 * Cleans up after itself so callers can invoke this more than once within a single test. */
async function submitWithError(message: string) {
  reviseLoanRate.mockRejectedValueOnce(new Error(message));
  renderDialog();
  typeRate('7');
  await act(async () => { fireEvent.click(confirmButton()); });
  const text = screen.getByRole('alert').textContent;
  cleanup();
  return text;
}

beforeEach(() => reviseLoanRate.mockReset());

describe('LoanRateRevisionDialog server error text — D2 additions', () => {
  it('AC-TDC-05: "plan has no remaining balance" maps to the no-remaining-balance text', async () => {
    const alert = await submitWithError('plan has no remaining balance');
    expect(alert).toContain('สินเชื่อนี้ไม่มีเงินต้นคงเหลือให้ปรับอัตราแล้ว');
  });

  it('AC-TDC-06: "plan schedule is malformed" maps to the malformed-schedule text', async () => {
    const alert = await submitWithError('plan schedule is malformed');
    expect(alert).toContain('ข้อมูลตารางผ่อนของสินเชื่อนี้ไม่สมบูรณ์ จึงปรับอัตราไม่ได้');
  });

  it.each([
    `rate revision limit reached (${MAX_RATE_REVISIONS_PER_PLAN})`,
    'rate revision limit reached (5)',
    'rate revision limit reached (999)'
  ])('AC-TDC-07: "%s" maps to the revision-limit-reached text regardless of the count', async message => {
    const alert = await submitWithError(message);
    expect(alert).toContain('ปรับอัตราดอกเบี้ยของสินเชื่อนี้ครบจำนวนครั้งสูงสุดแล้ว');
  });

  it('AC-TDC-08: SERVER_ERROR_TEXT has no key starting with the rate-revision-limit prefix, and the 7 pre-existing entries are unchanged', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../src/frontend/components/LoanRateRevisionDialog.tsx'),
      'utf8'
    );
    const match = source.match(/const SERVER_ERROR_TEXT: Record<string, string> = \{([\s\S]*?)\};/);
    expect(match).not.toBeNull();
    const body = match![1];
    expect(body).not.toMatch(/'rate revision limit reached/);

    const preExisting: Record<string, string> = {
      'plan not found': 'ไม่พบตารางผ่อนนี้แล้ว — ลองโหลดหน้าใหม่',
      'plan is not ongoing': 'สินเชื่อนี้ไม่ได้อยู่ระหว่างผ่อนแล้ว',
      'effectiveMonth is not an installment month': 'เดือนที่เลือกไม่ตรงกับงวดใดในตารางผ่อน',
      'tail has paid installments': 'มีงวดที่ชำระแล้วตั้งแต่เดือนที่เลือก — ลองโหลดหน้าใหม่',
      'effectiveMonth is before the latest revision': 'เลือกเดือนก่อนการปรับอัตราครั้งล่าสุดไม่ได้',
      'annualRate is unchanged': 'อัตราใหม่ต้องต่างจากอัตราปัจจุบัน',
      'annualRate must be between 0 and 100': 'อัตราดอกเบี้ยต้องอยู่ระหว่าง 0–100%'
    };
    for (const [key, value] of Object.entries(preExisting)) {
      expect(body).toContain(`'${key}': '${value}'`);
    }
  });

  it('AC-TDC-09: unmapped messages are shown verbatim, empty falls back to the default, and "constructor" is not treated as a prototype member', async () => {
    expect(await submitWithError('rate revision is only for loans')).toContain('rate revision is only for loans');
    expect(await submitWithError('')).toContain('ปรับอัตราดอกเบี้ยไม่สำเร็จ ลองอีกครั้ง');
    expect(await submitWithError('constructor')).toContain('constructor');
  });
});

// Loan TD cleanup D4 (§I5, AC-TDC-17…22) — re-capture focus after a failed save, because `busy` disables the
// focused confirm button and the browser's native disabled-focus-fixup drops focus to <body>, which the existing
// Tab-trap doesn't pull back in (see .pipeline/changes.md D4/I5 for the confirmed root-cause evidence).
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('LoanRateRevisionDialog focus re-capture after a failed save — D4 additions', () => {
  it('AC-TDC-17: focus moves back to confirm after a failed save, even though the disabled button drops focus to <body> mid-request', async () => {
    const pending = deferred<unknown>();
    reviseLoanRate.mockReturnValue(pending.promise);
    renderDialog();
    // let the dialog's own 40ms open-focus timer (moves focus to the month <select>) fire and settle
    // before we take focus manually, so it can never race the re-capture assertion below.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    typeRate('7');
    confirmButton().focus();
    expect(document.activeElement).toBe(confirmButton());

    fireEvent.click(confirmButton());
    // simulate the browser's real disabled-button focus-fixup, which jsdom does not reproduce on its own
    // (jsdom's own blur() no-ops on an already-disabled element, so this just mirrors the AC's instruction —
    // the real proof is the assertion below, driven by the new effect's own .focus() call)
    (document.activeElement as HTMLElement).blur();

    await act(async () => { pending.reject(new Error('tail has paid installments')); });

    expect(document.activeElement).toBe(confirmButton());
    expect(confirmButton()).toBeEnabled();
    expect(confirmButton()).toHaveTextContent('ยืนยันปรับอัตรา');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('AC-TDC-18: a second consecutive failure with the identical message moves focus back to confirm again', async () => {
    const first = deferred<unknown>();
    reviseLoanRate.mockReturnValueOnce(first.promise);
    renderDialog();
    // let the dialog's own 40ms open-focus timer fire and settle before taking focus manually,
    // so it can never race either of the re-capture assertions below.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    typeRate('7');
    confirmButton().focus();
    fireEvent.click(confirmButton());
    (document.activeElement as HTMLElement).blur();
    await act(async () => { first.reject(new Error('tail has paid installments')); });
    expect(document.activeElement).toBe(confirmButton());

    const second = deferred<unknown>();
    reviseLoanRate.mockReturnValueOnce(second.promise);
    fireEvent.click(confirmButton());
    (document.activeElement as HTMLElement).blur();

    // submit() clears serverError to null before each request, so even an identical message is a fresh
    // null -> string transition and the effect fires again.
    await act(async () => { second.reject(new Error('tail has paid installments')); });

    expect(document.activeElement).toBe(confirmButton());
    expect(screen.getByRole('alert')).toHaveTextContent('มีงวดที่ชำระแล้วตั้งแต่เดือนที่เลือก — ลองโหลดหน้าใหม่');
  });

  it('AC-TDC-19: falls back to the dialog panel when confirm is disabled by a mid-request plan swap', async () => {
    const pending = deferred<unknown>();
    reviseLoanRate.mockReturnValue(pending.promise);
    const plan = fixturePlan()!;
    const onClose = jest.fn();
    const onSaved = jest.fn();
    const { rerender } = render(
      <LoanRateRevisionDialog
        open
        plan={plan}
        cardName="KBank บ้าน"
        currentMonthKey="2026-11"
        onClose={onClose}
        onSaved={onSaved}
      />
    );
    // let the dialog's own 40ms open-focus timer fire and settle before taking focus manually,
    // so it can never race the dialog-panel-fallback assertion below.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    typeRate('7');
    confirmButton().focus();
    fireEvent.click(confirmButton());
    (document.activeElement as HTMLElement).blur();

    // swap in a plan (same id) whose schedule no longer has the currently-selected effectiveMonth —
    // the open-reset effect only re-runs on plan.id change, so effectiveMonth stays selected but now invalid
    const swappedSchedule = (plan.schedule ?? []).filter(row => row.dueMonth !== '2027-12');
    const swappedPlan: typeof plan = { ...plan, schedule: swappedSchedule };
    rerender(
      <LoanRateRevisionDialog
        open
        plan={swappedPlan}
        cardName="KBank บ้าน"
        currentMonthKey="2026-11"
        onClose={onClose}
        onSaved={onSaved}
      />
    );

    await act(async () => { pending.reject(new Error('tail has paid installments')); });

    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('AC-TDC-20: typing in the rate input after an error clears the alert and keeps focus in the rate input', async () => {
    reviseLoanRate.mockRejectedValueOnce(new Error('tail has paid installments'));
    renderDialog();
    // let the dialog's own 40ms open-focus timer fire and settle before the manual rate-input
    // focus below, so it can never race the final focus assertion.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    typeRate('7');
    await act(async () => { fireEvent.click(confirmButton()); });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rateInput().focus();
    typeRate('7.5');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(rateInput());
  });
});
