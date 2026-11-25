import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SalaryCalculator from '../../src/frontend/components/SalaryCalculator';
import {
  salaryAPI as salaryApi,
  incomeAPI as incomeApi,
  taxAPI as taxApi
} from '../../src/shared/utils/frontend/apiUtils';

// D2 (I2): SalaryCalculator's income-sync failure is shown to the user instead of being swallowed.
// Covers AC-SBC-10...13. The only collaborator mocked is apiUtils' salaryAPI/incomeAPI/taxAPI exports,
// matching the convention in SalaryCalculator.test.tsx.
jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  salaryAPI: { getByMonth: jest.fn(), save: jest.fn() },
  incomeAPI: { save: jest.fn() },
  taxAPI: { updateMonthlyDeductionFields: jest.fn() },
}));

const salaryAPI = jest.mocked(salaryApi);
const incomeAPI = jest.mocked(incomeApi);
const taxAPI = jest.mocked(taxApi);

// jsdom does not implement scrollIntoView; the pendingScrollItem effect (fired on every "+
// เพิ่มรายการ" click) calls it.
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

afterEach(() => {
  jest.clearAllMocks();
});

const INCOME_SYNC_FAILED_TEXT = 'บันทึกเงินเดือนแล้ว แต่อัปเดตยอดเงินเดือนในหน้ารายรับไม่สำเร็จ กดบันทึกอีกครั้ง';
const INCOME_SYNC_SUCCESS_TEXT = 'บันทึกข้อมูลเงินเดือนเรียบร้อย';

// Captures every `app:toast` CustomEvent dispatched during a test, in order.
interface ToastDetail {
  message: string;
  type: 'success' | 'error' | 'info';
  id: number;
}

function captureToasts(): { toasts: ToastDetail[]; cleanup: () => void } {
  const toasts: ToastDetail[] = [];
  const handler = (event: Event) => toasts.push((event as CustomEvent<ToastDetail>).detail);
  window.addEventListener('app:toast', handler);
  return { toasts, cleanup: () => window.removeEventListener('app:toast', handler) };
}

describe('SalaryCalculator income-sync failure (D2/I2)', () => {
  it('AC-SBC-10: incomeAPI.save rejecting skips onSalaryUpdate, shows the exact error toast, logs via console.error, and re-enables the save button', async () => {
    salaryAPI.getByMonth.mockResolvedValue({
      income: { salary: 30000 },
      deduct: { tax: 1500, provident_fund: 750 },
    });
    salaryAPI.save.mockResolvedValue({ success: true });
    taxAPI.updateMonthlyDeductionFields.mockResolvedValue(undefined);
    incomeAPI.save.mockRejectedValue(new Error('income sync down'));
    const onSalaryUpdate = jest.fn();
    const { toasts, cleanup } = captureToasts();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const user = userEvent.setup();
    render(<SalaryCalculator selectedMonth="2026-01" onSalaryUpdate={onSalaryUpdate} />);
    await screen.findByDisplayValue('30,000.00');

    const saveButton = screen.getByRole('button', { name: 'บันทึกเงินเดือน' });
    await user.click(saveButton);
    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));

    expect(onSalaryUpdate).not.toHaveBeenCalled();
    const last = toasts[toasts.length - 1];
    expect(last.message).toBe(INCOME_SYNC_FAILED_TEXT);
    expect(last.type).toBe('error');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to sync monthly income salary value:',
      expect.any(Error)
    );
    expect(saveButton).not.toBeDisabled();

    cleanup();
    consoleErrorSpy.mockRestore();
  });

  it('AC-SBC-11: SalaryCalculator.test.tsx tests 14/15 and SalaryCalculatorOvertime.test.tsx are unaffected by this change (sanity check via a passing happy path here)', async () => {
    salaryAPI.getByMonth.mockResolvedValue({
      income: { salary: 30000 },
      deduct: { tax: 1500, provident_fund: 750 },
    });
    salaryAPI.save.mockResolvedValue({ success: true });
    taxAPI.updateMonthlyDeductionFields.mockResolvedValue(undefined);
    incomeAPI.save.mockResolvedValue(undefined);
    const onSalaryUpdate = jest.fn();
    const { toasts, cleanup } = captureToasts();

    const user = userEvent.setup();
    render(<SalaryCalculator selectedMonth="2026-01" onSalaryUpdate={onSalaryUpdate} />);
    await screen.findByDisplayValue('30,000.00');

    await user.click(screen.getByRole('button', { name: 'บันทึกเงินเดือน' }));
    await waitFor(() => expect(onSalaryUpdate).toHaveBeenCalledTimes(1));

    const last = toasts[toasts.length - 1];
    expect(last.message).toBe(INCOME_SYNC_SUCCESS_TEXT);
    expect(last.type).toBe('success');

    cleanup();
  });

  it('AC-SBC-12: retry — incomeAPI.save rejects on the first click then resolves on the second; onSalaryUpdate fires exactly once (on the second click) and the final toast is the success message', async () => {
    salaryAPI.getByMonth.mockResolvedValue({
      income: { salary: 30000 },
      deduct: { tax: 1500, provident_fund: 750 },
    });
    salaryAPI.save.mockResolvedValue({ success: true });
    taxAPI.updateMonthlyDeductionFields.mockResolvedValue(undefined);
    incomeAPI.save
      .mockRejectedValueOnce(new Error('income sync down'))
      .mockResolvedValueOnce(undefined);
    const onSalaryUpdate = jest.fn();
    const { toasts, cleanup } = captureToasts();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const user = userEvent.setup();
    render(<SalaryCalculator selectedMonth="2026-01" onSalaryUpdate={onSalaryUpdate} />);
    await screen.findByDisplayValue('30,000.00');

    const saveButton = screen.getByRole('button', { name: 'บันทึกเงินเดือน' });

    // First click: income sync rejects — modal stays open (onSalaryUpdate must not fire), error toast shown.
    await user.click(saveButton);
    await waitFor(() => expect(toasts.length).toBe(1));
    expect(onSalaryUpdate).not.toHaveBeenCalled();
    expect(toasts[0].message).toBe(INCOME_SYNC_FAILED_TEXT);
    expect(toasts[0].type).toBe('error');
    expect(saveButton).not.toBeDisabled();

    // Second click (retry): income sync resolves — onSalaryUpdate fires exactly once, success toast shown.
    await user.click(saveButton);
    await waitFor(() => expect(onSalaryUpdate).toHaveBeenCalledTimes(1));

    expect(incomeAPI.save).toHaveBeenCalledTimes(2);
    const last = toasts[toasts.length - 1];
    expect(last.message).toBe(INCOME_SYNC_SUCCESS_TEXT);
    expect(last.type).toBe('success');

    cleanup();
    consoleErrorSpy.mockRestore();
  });

  it('AC-SBC-13: the income-sync failure toast uses the exact spec copy (C-SBC-1 / D-SBC-8), distinct from the generic error toasts', async () => {
    salaryAPI.getByMonth.mockResolvedValue({ income: { salary: 30000 }, deduct: {} });
    salaryAPI.save.mockResolvedValue({ success: true });
    taxAPI.updateMonthlyDeductionFields.mockResolvedValue(undefined);
    incomeAPI.save.mockRejectedValue(new Error('income sync down'));
    const { toasts, cleanup } = captureToasts();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const user = userEvent.setup();
    render(<SalaryCalculator selectedMonth="2026-01" />);
    await screen.findByDisplayValue('30,000.00');

    await user.click(screen.getByRole('button', { name: 'บันทึกเงินเดือน' }));
    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));

    const last = toasts[toasts.length - 1];
    expect(last.message).toBe('บันทึกเงินเดือนแล้ว แต่อัปเดตยอดเงินเดือนในหน้ารายรับไม่สำเร็จ กดบันทึกอีกครั้ง');
    expect(last.type).toBe('error');

    cleanup();
    consoleErrorSpy.mockRestore();
  });
});
