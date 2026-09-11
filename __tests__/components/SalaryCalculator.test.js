import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SalaryCalculator from '../../src/frontend/components/SalaryCalculator';
import { salaryAPI, incomeAPI, taxAPI } from '../../src/shared/utils/frontend/apiUtils';
import { formatCurrency } from '../../src/shared/utils/frontend/numberUtils';

// The only collaborator this file mocks — apiUtils' salaryAPI/incomeAPI/taxAPI exports (3 modules, 4
// methods total). Every other collaborator (showToast, formatCurrency/parseAndFormat/parseToNumber) is
// real, per spec §Scope item 2 / AC-3 ("exactly one jest.mock() call, no accidental extra mock").
jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  salaryAPI: { getByMonth: jest.fn(), save: jest.fn() },
  incomeAPI: { save: jest.fn() },
  taxAPI: { updateMonthlyDeductionFields: jest.fn() },
}));

// jsdom does not implement scrollIntoView; the pendingScrollItem effect (fired on every "+
// เพิ่มรายการ" click) calls it. Test-file-local stub only — not added to jest.setup.js (AC-8).
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

afterEach(() => {
  jest.clearAllMocks();
});

// The "เงินได้สุทธิ" hero figure has no dedicated test id — its value lives in the <p> immediately
// after the <p> holding the "เงินได้สุทธิ" label text.
function getNetIncomeText() {
  return screen.getByText('เงินได้สุทธิ').nextElementSibling.textContent;
}

// Captures every `app:toast` CustomEvent dispatched during a test, in order.
function captureToasts() {
  const toasts = [];
  const handler = (event) => toasts.push(event.detail);
  window.addEventListener('app:toast', handler);
  return { toasts, cleanup: () => window.removeEventListener('app:toast', handler) };
}

describe('SalaryCalculator', () => {
  it('1. initial render with no selectedMonth shows the full 8/3-item preset lists, all values empty, and does not call getByMonth', () => {
    render(<SalaryCalculator />);

    expect(screen.getAllByLabelText('แก้ไขชื่อรายการรายได้')).toHaveLength(8);
    expect(screen.getAllByLabelText('แก้ไขชื่อรายการค่าใช้จ่ายหักออก')).toHaveLength(3);
    expect(screen.getByDisplayValue('เงินเดือน')).toBeInTheDocument();
    expect(screen.getByDisplayValue('หักภาษี')).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('')).toHaveLength(11); // every amount input starts empty

    expect(screen.getByText('คำนวณเงินเดือน - กรุณาเลือกเดือน')).toBeInTheDocument();
    expect(salaryAPI.getByMonth).not.toHaveBeenCalled();
  });

  it('2. inModal suppresses the heading entirely (not just restyled)', () => {
    render(<SalaryCalculator inModal />);

    expect(screen.queryByText(/คำนวณเงินเดือน/)).not.toBeInTheDocument();
  });

  it('3. populated load renders only nonzero presets + custom items with __labels, not the full preset set', async () => {
    salaryAPI.getByMonth.mockResolvedValue({
      income: {
        salary: 30000,
        bonus: 5000,
        custom_side_gig: 2000,
        __labels: { custom_side_gig: 'งานเสริม' },
      },
      deduct: { tax: 1500, provident_fund: 750 },
    });
    render(<SalaryCalculator selectedMonth="2026-01" />);

    await screen.findByDisplayValue('30,000.00');

    // Income: exactly 3 rows — เงินเดือน/โบนัส/งานเสริม — not the full 8-item preset list.
    expect(screen.getAllByLabelText('แก้ไขชื่อรายการรายได้')).toHaveLength(3);
    expect(screen.getByDisplayValue('เงินเดือน')).toBeInTheDocument();
    expect(screen.getByDisplayValue('30,000.00')).toBeInTheDocument();
    expect(screen.getByDisplayValue('โบนัส')).toBeInTheDocument();
    expect(screen.getByDisplayValue('5,000.00')).toBeInTheDocument();
    expect(screen.getByDisplayValue('งานเสริม')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2,000.00')).toBeInTheDocument();

    // Deduction: exactly 2 rows — หักภาษี/หักกองทุนสำรองเลี้ยงชีพ — social_security absent (0/missing).
    expect(screen.getAllByLabelText('แก้ไขชื่อรายการค่าใช้จ่ายหักออก')).toHaveLength(2);
    expect(screen.getByDisplayValue('หักภาษี')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1,500.00')).toBeInTheDocument();
    expect(screen.getByDisplayValue('หักกองทุนสำรองเลี้ยงชีพ')).toBeInTheDocument();
    expect(screen.getByDisplayValue('750.00')).toBeInTheDocument();
  });

  it('4. an all-zero/empty section falls back to exactly one blank row, not the full preset list', async () => {
    salaryAPI.getByMonth.mockResolvedValue({ income: { salary: 0 }, deduct: {} });
    render(<SalaryCalculator selectedMonth="2026-01" />);

    await screen.findByDisplayValue('รายได้ใหม่');

    const incomeLabels = screen.getAllByLabelText('แก้ไขชื่อรายการรายได้');
    expect(incomeLabels).toHaveLength(1);
    expect(incomeLabels[0]).toHaveValue('รายได้ใหม่');

    const deductionLabels = screen.getAllByLabelText('แก้ไขชื่อรายการค่าใช้จ่ายหักออก');
    expect(deductionLabels).toHaveLength(1);
    expect(deductionLabels[0]).toHaveValue('รายการหักใหม่');
  });

  it('5. getByMonth rejection resets to the full preset list and logs via console.error (distinct from test 4)', async () => {
    salaryAPI.getByMonth.mockRejectedValue(new Error('network down'));
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(<SalaryCalculator selectedMonth="2026-01" />);

    await waitFor(() => expect(consoleErrorSpy).toHaveBeenCalled());

    expect(screen.getAllByLabelText('แก้ไขชื่อรายการรายได้')).toHaveLength(8);
    expect(screen.getAllByLabelText('แก้ไขชื่อรายการค่าใช้จ่ายหักออก')).toHaveLength(3);
    expect(screen.getAllByDisplayValue('')).toHaveLength(11);

    consoleErrorSpy.mockRestore();
  });

  it('6. switching selectedMonth from a value to falsy resets to the full preset list, not stale data', async () => {
    salaryAPI.getByMonth.mockResolvedValue({ income: { salary: 5000 }, deduct: {} });
    const { rerender } = render(<SalaryCalculator selectedMonth="2026-01" />);
    await screen.findByDisplayValue('5,000.00');

    rerender(<SalaryCalculator selectedMonth={null} />);

    expect(screen.getAllByLabelText('แก้ไขชื่อรายการรายได้')).toHaveLength(8);
    expect(screen.queryByDisplayValue('5,000.00')).not.toBeInTheDocument();
    expect(screen.getAllByDisplayValue('')).toHaveLength(11);
  });

  it('7. K16: เงินได้สุทธิ recalculates live from typed input, no blur required', async () => {
    const user = userEvent.setup();
    render(<SalaryCalculator />);

    expect(getNetIncomeText()).toBe(formatCurrency(0));

    const salaryRow = screen.getByDisplayValue('เงินเดือน').closest('[data-salary-type="income"]');
    const amountInput = within(salaryRow).getByLabelText('จำนวนเงินรายการรายได้');

    await user.type(amountInput, '5');
    expect(getNetIncomeText()).toBe(formatCurrency(5));

    await user.type(amountInput, '0');
    expect(getNetIncomeText()).toBe(formatCurrency(50));
  });

  it('8. K14: raw onChange value, comma-formatted only on blur', async () => {
    const user = userEvent.setup();
    render(<SalaryCalculator />);

    const salaryRow = screen.getByDisplayValue('เงินเดือน').closest('[data-salary-type="income"]');
    const amountInput = within(salaryRow).getByLabelText('จำนวนเงินรายการรายได้');

    await user.type(amountInput, '5000');
    expect(amountInput.value).toBe('5000'); // raw, uncommaed, while still focused

    await user.tab();
    expect(amountInput.value).toBe('5,000.00'); // formatted only after blur
  });

  it('9. K12: add-row default labels are non-empty; the new row is scrolled and focused', async () => {
    const user = userEvent.setup();
    render(<SalaryCalculator />);

    // First "+ เพิ่มรายการ" is the income section's (rendered before the deduction section in the DOM).
    const addButtons = screen.getAllByRole('button', { name: '+ เพิ่มรายการ' });

    await user.click(addButtons[0]);
    const newIncomeLabelInputs = screen.getAllByDisplayValue('รายได้ใหม่');
    expect(newIncomeLabelInputs).toHaveLength(1);
    expect(newIncomeLabelInputs[0]).toHaveFocus();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    await user.click(addButtons[1]);
    const newDeductionLabelInputs = screen.getAllByDisplayValue('รายการหักใหม่');
    expect(newDeductionLabelInputs).toHaveLength(1);
    expect(newDeductionLabelInputs[0]).toHaveFocus();
  });

  it('10. K13 (delete-by-id selection, not "React key reconciliation"): deleting the middle item removes it by identity, not position', async () => {
    salaryAPI.getByMonth.mockResolvedValue({
      income: {
        item_a: 10,
        item_b: 20,
        item_c: 30,
        __labels: { item_a: 'A', item_b: 'B', item_c: 'C' },
      },
      deduct: {},
    });
    const user = userEvent.setup();
    render(<SalaryCalculator selectedMonth="2026-01" />);
    await screen.findByDisplayValue('B');

    // Scope the click to B's own row container (found via B's own display value, not a positional
    // index into a flat list) — this proves handleRemoveItem's id-based .filter() selection logic;
    // every input here is fully controlled, so it does not independently prove key={item.id} vs.
    // key={index} on the row wrapper.
    const rowB = screen.getByDisplayValue('B').closest('[data-salary-type="income"]');
    const deleteButtonB = within(rowB).getByRole('button', { name: /ลบ/ });
    await user.click(deleteButtonB);

    expect(screen.queryByDisplayValue('B')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('A')).toBeInTheDocument();
    expect(screen.getByDisplayValue('C')).toBeInTheDocument();
  });

  it('11. removing the last remaining item in a section leaves exactly one fresh blank row, not zero rows', async () => {
    salaryAPI.getByMonth.mockResolvedValue({
      income: { item_x: 100, __labels: { item_x: 'X' } },
      deduct: {},
    });
    const user = userEvent.setup();
    render(<SalaryCalculator selectedMonth="2026-01" />);
    await screen.findByDisplayValue('X');

    const deleteButton = screen.getByLabelText('ลบรายการรายได้นี้');
    await user.click(deleteButton);

    const remainingLabels = screen.getAllByLabelText('แก้ไขชื่อรายการรายได้');
    expect(remainingLabels).toHaveLength(1);
    expect(remainingLabels[0]).toHaveValue('รายได้ใหม่');
  });

  it('12. clearAll clears every value input without calling any save API', async () => {
    salaryAPI.getByMonth.mockResolvedValue({ income: { salary: 30000 }, deduct: { tax: 1500 } });
    const user = userEvent.setup();
    render(<SalaryCalculator selectedMonth="2026-01" />);
    await screen.findByDisplayValue('30,000.00');

    await user.click(screen.getByRole('button', { name: 'ล้างข้อมูล' }));

    expect(screen.getByDisplayValue('เงินเดือน')).toBeInTheDocument(); // labels unchanged
    expect(screen.getByDisplayValue('หักภาษี')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('30,000.00')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('1,500.00')).not.toBeInTheDocument();
    expect(getNetIncomeText()).toBe(formatCurrency(0));

    expect(salaryAPI.save).not.toHaveBeenCalled();
    expect(incomeAPI.save).not.toHaveBeenCalled();
    expect(taxAPI.updateMonthlyDeductionFields).not.toHaveBeenCalled();
  });

  it('13. save with no selectedMonth shows an info toast and never calls salaryAPI.save', async () => {
    const { toasts, cleanup } = captureToasts();
    const user = userEvent.setup();
    render(<SalaryCalculator />);

    await user.click(screen.getByRole('button', { name: 'บันทึกเงินเดือน' }));

    expect(toasts.length).toBeGreaterThan(0);
    const last = toasts[toasts.length - 1];
    expect(last.message).toBe('กรุณาเลือกเดือนที่ต้องการก่อน');
    expect(last.type).toBe('info');
    expect(salaryAPI.save).not.toHaveBeenCalled();

    cleanup();
  });

  it('14. save success orchestrates salaryAPI.save -> taxAPI.updateMonthlyDeductionFields -> incomeAPI.save -> onSalaryUpdate -> success toast, with exact payloads', async () => {
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

    expect(salaryAPI.save).toHaveBeenCalledWith(
      '2026-01',
      { salary: 30000, __labels: { salary: 'เงินเดือน' } },
      { tax: 1500, provident_fund: 750, __labels: { tax: 'หักภาษี', provident_fund: 'หักกองทุนสำรองเลี้ยงชีพ' } }
    );
    expect(taxAPI.updateMonthlyDeductionFields).toHaveBeenCalledWith('2026', '01', {
      tax: 1500,
      provident: 750,
      income: 30000,
    });
    expect(incomeAPI.save).toHaveBeenCalledWith('2026-01', { salary: 27750 }); // 30000 - 1500 - 750

    const last = toasts[toasts.length - 1];
    expect(last.message).toBe('บันทึกข้อมูลเงินเดือนเรียบร้อย');

    cleanup();
  });

  it('15. asymmetry #1: taxAPI.updateMonthlyDeductionFields rejecting is silently swallowed — no error surfaced, flow still completes', async () => {
    salaryAPI.getByMonth.mockResolvedValue({
      income: { salary: 30000 },
      deduct: { tax: 1500, provident_fund: 750 },
    });
    salaryAPI.save.mockResolvedValue({ success: true });
    taxAPI.updateMonthlyDeductionFields.mockRejectedValue(new Error('tax sync down'));
    incomeAPI.save.mockResolvedValue(undefined);
    const onSalaryUpdate = jest.fn();
    const { toasts, cleanup } = captureToasts();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const user = userEvent.setup();
    render(<SalaryCalculator selectedMonth="2026-01" onSalaryUpdate={onSalaryUpdate} />);
    await screen.findByDisplayValue('30,000.00');

    await user.click(screen.getByRole('button', { name: 'บันทึกเงินเดือน' }));
    await waitFor(() => expect(onSalaryUpdate).toHaveBeenCalledTimes(1));

    expect(incomeAPI.save).toHaveBeenCalledWith('2026-01', { salary: 27750 });
    const last = toasts[toasts.length - 1];
    expect(last.message).toBe('บันทึกข้อมูลเงินเดือนเรียบร้อย');
    expect(last.type).toBe('success');
    expect(consoleErrorSpy).not.toHaveBeenCalled(); // "ไม่ต้องแจ้ง error ให้ user" — genuinely silent

    cleanup();
    consoleErrorSpy.mockRestore();
  });

  it('16. asymmetry #2: incomeAPI.save rejecting logs via console.error but still does not block success', async () => {
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

    await user.click(screen.getByRole('button', { name: 'บันทึกเงินเดือน' }));
    await waitFor(() => expect(onSalaryUpdate).toHaveBeenCalledTimes(1));

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to sync monthly income salary value:',
      expect.any(Error)
    );
    const last = toasts[toasts.length - 1];
    expect(last.message).toBe('บันทึกข้อมูลเงินเดือนเรียบร้อย');

    cleanup();
    consoleErrorSpy.mockRestore();
  });

  it('17. save returns { success: false, error } — exact error toast, post-save orchestration entirely skipped', async () => {
    salaryAPI.getByMonth.mockResolvedValue({ income: { salary: 30000 }, deduct: { tax: 1500 } });
    salaryAPI.save.mockResolvedValue({ success: false, error: 'เดือนนี้ถูกล็อก' });
    const onSalaryUpdate = jest.fn();
    const { toasts, cleanup } = captureToasts();

    const user = userEvent.setup();
    render(<SalaryCalculator selectedMonth="2026-01" onSalaryUpdate={onSalaryUpdate} />);
    await screen.findByDisplayValue('30,000.00');

    await user.click(screen.getByRole('button', { name: 'บันทึกเงินเดือน' }));
    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));

    const last = toasts[toasts.length - 1];
    expect(last.message).toBe('เกิดข้อผิดพลาด: เดือนนี้ถูกล็อก');
    expect(last.type).toBe('error');
    expect(taxAPI.updateMonthlyDeductionFields).not.toHaveBeenCalled();
    expect(incomeAPI.save).not.toHaveBeenCalled();
    expect(onSalaryUpdate).not.toHaveBeenCalled();

    cleanup();
  });

  it('18. salaryAPI.save itself rejecting shows a generic error toast, logs, and re-enables the save button', async () => {
    salaryAPI.getByMonth.mockResolvedValue({ income: { salary: 30000 }, deduct: {} });
    salaryAPI.save.mockRejectedValue(new Error('network down'));
    const { toasts, cleanup } = captureToasts();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const user = userEvent.setup();
    render(<SalaryCalculator selectedMonth="2026-01" />);
    await screen.findByDisplayValue('30,000.00');

    const saveButton = screen.getByRole('button', { name: 'บันทึกเงินเดือน' });
    await user.click(saveButton);
    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));

    const last = toasts[toasts.length - 1];
    expect(last.message).toBe('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    expect(last.type).toBe('error');
    expect(consoleErrorSpy).toHaveBeenCalled();

    expect(saveButton).not.toBeDisabled();
    expect(saveButton).toHaveTextContent('บันทึกเงินเดือน');

    cleanup();
    consoleErrorSpy.mockRestore();
  });
});
