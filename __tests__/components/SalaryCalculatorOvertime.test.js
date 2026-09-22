import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SalaryCalculator from '../../src/frontend/components/SalaryCalculator';
import { salaryAPI, incomeAPI, taxAPI } from '../../src/shared/utils/frontend/apiUtils';

// Increment 3 (SalaryCalculator OT section). Lives in its own file so the existing
// SalaryCalculator.test.js — which Increment 4 owns and updates — is not touched here.
// Same single-mock rule as that file: only apiUtils is mocked; numberUtils, overtimeUtils and
// showToast are the real implementations, so these tests exercise the real OT math.
jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  salaryAPI: { getByMonth: jest.fn(), save: jest.fn() },
  incomeAPI: { save: jest.fn() },
  taxAPI: { updateMonthlyDeductionFields: jest.fn() },
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

afterEach(() => {
  jest.clearAllMocks();
});

// A month whose only OT is the pre-feature flat amount — the AC-OT-13 fixture.
const LEGACY_MONTH = {
  income: {
    salary: 30000,
    overtime_1_5x: 3200,
    __labels: { salary: 'เงินเดือน', overtime_1_5x: 'ค่าล่วงเวลา 1.5 เท่า' },
  },
  deduct: { tax: 1500, __labels: { tax: 'หักภาษี' } },
  overtime: [],
  overtimeLegacy: [
    { id: 'legacy_overtime_1_5x', key: 'overtime_1_5x', label: 'ค่าล่วงเวลา 1.5 เท่า', amount: 3200 },
  ],
};

const getOvertimeRows = () => document.querySelectorAll('[data-salary-type="overtime"]');
const getSalaryRow = () => screen.getByText('เงินเดือน').closest('[data-salary-type="income"]');

async function addOvertimeRow(user, { hours, multiplier } = {}) {
  await user.click(screen.getByRole('button', { name: '+ เพิ่มรายการ OT' }));
  const rows = getOvertimeRows();
  const row = rows[rows.length - 1];
  if (hours !== undefined) {
    await user.type(within(row).getByLabelText('จำนวนชั่วโมง OT'), hours);
  }
  if (multiplier !== undefined) {
    await user.selectOptions(within(row).getByLabelText('ตัวคูณ OT'), String(multiplier));
  }
  return row;
}

describe('SalaryCalculator — รายการ OT (Increment 3)', () => {
  it('AC-OT-13: saving an untouched legacy month round-trips income.overtime_1_5x AND its __labels entry, and sends overtime as the 5th argument', async () => {
    salaryAPI.getByMonth.mockResolvedValue(LEGACY_MONTH);
    salaryAPI.save.mockResolvedValue({ success: true });
    const user = userEvent.setup();

    render(<SalaryCalculator selectedMonth="2026-09" />);
    await screen.findByDisplayValue('30,000.00');

    await user.click(screen.getByRole('button', { name: 'บันทึกเงินเดือน' }));
    await waitFor(() => expect(salaryAPI.save).toHaveBeenCalledTimes(1));

    // Exact payload, not expect.anything(): the legacy amount and its label must be byte-identical
    // to what was loaded, and `note` must still occupy position 4 (A-6).
    expect(salaryAPI.save).toHaveBeenCalledWith(
      '2026-09',
      {
        salary: 30000,
        overtime_1_5x: 3200,
        __labels: { salary: 'เงินเดือน', overtime_1_5x: 'ค่าล่วงเวลา 1.5 เท่า' },
      },
      { tax: 1500, __labels: { tax: 'หักภาษี' } },
      '',
      []
    );
  });

  it('A-7: a month whose only income is legacy OT still sends __labels, created from scratch', async () => {
    salaryAPI.getByMonth.mockResolvedValue({
      income: { overtime_1_5x: 3200, __labels: { overtime_1_5x: 'OT กะดึก' } },
      deduct: {},
      overtime: [],
      overtimeLegacy: [
        { id: 'legacy_overtime_1_5x', key: 'overtime_1_5x', label: 'OT กะดึก', amount: 3200 },
      ],
    });
    salaryAPI.save.mockResolvedValue({ success: true });
    const user = userEvent.setup();

    render(<SalaryCalculator selectedMonth="2026-09" />);
    await screen.findByText('OT กะดึก');

    await user.click(screen.getByRole('button', { name: 'บันทึกเงินเดือน' }));
    await waitFor(() => expect(salaryAPI.save).toHaveBeenCalledTimes(1));

    const incomePayload = salaryAPI.save.mock.calls[0][1];
    expect(incomePayload).toEqual({
      overtime_1_5x: 3200,
      __labels: { overtime_1_5x: 'OT กะดึก' },
    });
  });

  it('AC-OT-12 / V-5: a legacy OT key renders as a read-only OT row, never as an editable income row', async () => {
    salaryAPI.getByMonth.mockResolvedValue(LEGACY_MONTH);
    render(<SalaryCalculator selectedMonth="2026-09" />);
    await screen.findByDisplayValue('30,000.00');

    // No editable row carries the legacy label, and the legacy row has no controls at all.
    expect(screen.queryByDisplayValue('ค่าล่วงเวลา 1.5 เท่า')).not.toBeInTheDocument();
    const legacyRow = screen.getByText('ค่าล่วงเวลา 1.5 เท่า').closest('[data-salary-type="overtime-legacy"]');
    expect(legacyRow).toBeInTheDocument();
    expect(within(legacyRow).getByText('ข้อมูลเดิม')).toBeInTheDocument();
    expect(within(legacyRow).queryByRole('button')).not.toBeInTheDocument();
    expect(within(legacyRow).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(legacyRow).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(legacyRow).getByText('3,200')).toBeInTheDocument();
  });

  it('AC-OT-17: none of the five flat OT presets appears in the income list of an empty month', () => {
    render(<SalaryCalculator />);

    ['ค่าล่วงเวลา 1 เท่า', 'ค่าล่วงเวลา 1.5 เท่า', 'ค่าล่วงเวลา 2 เท่า', 'ค่าล่วงเวลา 3 เท่า', 'ค่าล่วงเวลาอื่นๆ']
      .forEach((label) => {
        expect(screen.queryByDisplayValue(label)).not.toBeInTheDocument();
      });
    expect(screen.getAllByLabelText('แก้ไขชื่อรายการรายได้')).toHaveLength(2); // โบนัส + เงินได้อื่นๆ
  });

  it('AC-OT-04 / 09 / 10: a month with no salary key still renders a locked เงินเดือน row — static label, no ✕', async () => {
    salaryAPI.getByMonth.mockResolvedValue({
      income: { bonus: 5000, __labels: { bonus: 'โบนัส' } },
      deduct: {},
      overtime: [],
      overtimeLegacy: [],
    });
    render(<SalaryCalculator selectedMonth="2026-09" />);
    await screen.findByDisplayValue('5,000.00');

    const salaryRow = getSalaryRow();
    expect(salaryRow).toBeInTheDocument();
    expect(within(salaryRow).queryByLabelText('แก้ไขชื่อรายการรายได้')).not.toBeInTheDocument();
    expect(within(salaryRow).queryByRole('button')).not.toBeInTheDocument(); // absent, not disabled
    expect(within(salaryRow).getByLabelText('จำนวนเงินเงินเดือน')).toHaveValue('');

    // AC-OT-11: every other row keeps its name input and a working ✕.
    const bonusRow = screen.getByDisplayValue('โบนัส').closest('[data-salary-type="income"]');
    expect(within(bonusRow).getByRole('button', { name: 'ลบรายการรายได้นี้' })).toBeInTheDocument();
  });

  it('AC-OT-01/03/06/24: hours × multiplier × live salary, rounded half-up per row, summed into รวม OT', async () => {
    const user = userEvent.setup();
    render(<SalaryCalculator selectedMonth="2026-09" />);
    await waitFor(() => expect(salaryAPI.getByMonth).toHaveBeenCalled());

    await user.type(within(getSalaryRow()).getByLabelText('จำนวนเงินเงินเดือน'), '30000');

    // E1: 30,000 / 30 days / 8 = 125 → 125 × 1.5 × 10 = 1,875
    const row1 = await addOvertimeRow(user, { hours: '10' });
    expect(within(row1).getByText('1,875')).toBeInTheDocument();

    // E5-style second row at 3× : 125 × 3 × 7.5 = 2,812.5 → 2,813 (half-up)
    const row2 = await addOvertimeRow(user, { hours: '7.5', multiplier: 3 });
    expect(within(row2).getByText('2,813')).toBeInTheDocument();

    // AC-OT-24: รวม OT equals the sum of the two visible rows, and it recomputed with no blur/save.
    expect(screen.getByText('รวม OT').nextElementSibling).toHaveTextContent('4,688');
  });

  it('AC-OT-02/03: identical hours in February (28 days) give 2,009 — the rate is never rounded first', async () => {
    const user = userEvent.setup();
    render(<SalaryCalculator selectedMonth="2026-02" />);
    await waitFor(() => expect(salaryAPI.getByMonth).toHaveBeenCalled());

    await user.type(within(getSalaryRow()).getByLabelText('จำนวนเงินเงินเดือน'), '30000');
    const row = await addOvertimeRow(user, { hours: '10' });

    // 30,000 / 28 / 8 = 133.928571…; × 1.5 × 10 = 2,008.93 → 2,009 (not 2,010, not 2,003)
    expect(within(row).getByText('2,009')).toBeInTheDocument();
  });

  it('AC-OT-05: salary 0 shows the inline hint and every OT row reads 0; the hint clears the moment salary is typed', async () => {
    const user = userEvent.setup();
    render(<SalaryCalculator selectedMonth="2026-09" />);
    await waitFor(() => expect(salaryAPI.getByMonth).toHaveBeenCalled());

    const hint = 'กรอกเงินเดือนก่อน แล้วระบบจะคำนวณค่า OT ให้อัตโนมัติ';
    expect(screen.getByText(hint)).toBeInTheDocument();

    const row = await addOvertimeRow(user, { hours: '10' });
    expect(within(row).getByText('0')).toBeInTheDocument();

    await user.type(within(getSalaryRow()).getByLabelText('จำนวนเงินเงินเดือน'), '30000');
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    expect(within(row).getByText('1,875')).toBeInTheDocument();
  });

  it('K14/AC-OT-28: hours keep the raw string while typing and normalise only on blur; adding a row never reformats another field', async () => {
    const user = userEvent.setup();
    render(<SalaryCalculator selectedMonth="2026-09" />);
    await waitFor(() => expect(salaryAPI.getByMonth).toHaveBeenCalled());

    const row = await addOvertimeRow(user);
    const hoursInput = within(row).getByLabelText('จำนวนชั่วโมง OT');
    expect(hoursInput).toHaveAttribute('type', 'text'); // AC-OT-27 — never type="number"
    expect(hoursInput).toHaveAttribute('inputMode', 'decimal');
    expect(hoursInput).not.toHaveAttribute('min');
    expect(hoursInput).not.toHaveAttribute('step');

    await user.type(hoursInput, '7.');
    expect(hoursInput).toHaveValue('7.'); // survives mid-typing
    await user.tab();
    expect(hoursInput).toHaveValue('7');

    // Negative hours clamp to 0 on blur, never negate (AC-OT-07).
    await user.clear(hoursInput);
    await user.type(hoursInput, '-5');
    await user.tab();
    expect(hoursInput).toHaveValue('0');
  });

  it('AC-OT-19: deleting every OT row sends overtime: [] — the rows are not silently left behind', async () => {
    salaryAPI.getByMonth.mockResolvedValue({
      income: { salary: 30000, __labels: { salary: 'เงินเดือน' } },
      deduct: {},
      overtime: [{ id: 'ot_seed1', hours: 10, multiplier: 1.5 }],
      overtimeLegacy: [],
    });
    salaryAPI.save.mockResolvedValue({ success: true });
    const user = userEvent.setup();

    render(<SalaryCalculator selectedMonth="2026-09" />);
    await screen.findByDisplayValue('30,000.00');
    expect(getOvertimeRows()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'ลบรายการ OT นี้' }));
    expect(getOvertimeRows()).toHaveLength(0);
    expect(screen.queryByText('รวม OT')).not.toBeInTheDocument(); // a 0 total under nothing is noise

    await user.click(screen.getByRole('button', { name: 'บันทึกเงินเดือน' }));
    await waitFor(() => expect(salaryAPI.save).toHaveBeenCalledTimes(1));
    expect(salaryAPI.save.mock.calls[0][4]).toEqual([]);
  });

  it('AC-OT-18/25: the saved rows carry only {id, hours, multiplier}, and the tax/income syncs both include OT', async () => {
    salaryAPI.getByMonth.mockResolvedValue({
      income: { salary: 30000, __labels: { salary: 'เงินเดือน' } },
      deduct: { tax: 1500, __labels: { tax: 'หักภาษี' } },
      overtime: [{ id: 'ot_seed1', hours: 10, multiplier: 1.5 }],
      overtimeLegacy: [
        { id: 'legacy_overtime_1_5x', key: 'overtime_1_5x', label: 'ค่าล่วงเวลา 1.5 เท่า', amount: 3200 },
      ],
    });
    salaryAPI.save.mockResolvedValue({ success: true });
    taxAPI.updateMonthlyDeductionFields.mockResolvedValue(undefined);
    incomeAPI.save.mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<SalaryCalculator selectedMonth="2026-09" />);
    await screen.findByDisplayValue('30,000.00');

    await user.click(screen.getByRole('button', { name: 'บันทึกเงินเดือน' }));
    await waitFor(() => expect(incomeAPI.save).toHaveBeenCalled());

    expect(salaryAPI.save.mock.calls[0][4]).toEqual([{ id: 'ot_seed1', hours: 10, multiplier: 1.5 }]);
    // 30,000 income + 1,875 computed OT + 3,200 legacy = 35,075 (legacy counted exactly once)
    expect(taxAPI.updateMonthlyDeductionFields).toHaveBeenCalledWith('2026', '09', {
      tax: 1500,
      provident: undefined,
      income: 35075,
    });
    expect(incomeAPI.save).toHaveBeenCalledWith('2026-09', { salary: 33575 }); // 35,075 − 1,500
  });

  it('m-13 / AC-OT-24: รวม OT sums the ROUNDED legacy rows, while the synced total income keeps the raw amounts (= server total_income)', async () => {
    salaryAPI.getByMonth.mockResolvedValue({
      income: { salary: 30000, overtime_1_5x: 3200.5, overtime_2x: 100.5, __labels: { salary: 'เงินเดือน' } },
      deduct: { tax: 1500, __labels: { tax: 'หักภาษี' } },
      overtime: [],
      overtimeLegacy: [
        { id: 'legacy_overtime_1_5x', key: 'overtime_1_5x', label: 'ค่าล่วงเวลา 1.5 เท่า', amount: 3200.5 },
        { id: 'legacy_overtime_2x', key: 'overtime_2x', label: 'ค่าล่วงเวลา 2 เท่า', amount: 100.5 },
      ],
    });
    salaryAPI.save.mockResolvedValue({ success: true });
    taxAPI.updateMonthlyDeductionFields.mockResolvedValue(undefined);
    incomeAPI.save.mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<SalaryCalculator selectedMonth="2026-09" />);
    await screen.findByDisplayValue('30,000.00');

    // Visible rows: 3,201 + 101 (each rounded half-up) → รวม OT must be their sum, 3,302 — not round(3,301).
    expect(screen.getByText('3,201')).toBeInTheDocument();
    expect(screen.getByText('101')).toBeInTheDocument();
    expect(screen.getByText('รวม OT').nextElementSibling).toHaveTextContent('3,302');

    await user.click(screen.getByRole('button', { name: 'บันทึกเงินเดือน' }));
    await waitFor(() => expect(taxAPI.updateMonthlyDeductionFields).toHaveBeenCalled());
    // The downstream total is NOT rounded per row: 30,000 + 3,200.5 + 100.5 = 33,301 (server's Σ income).
    expect(taxAPI.updateMonthlyDeductionFields).toHaveBeenCalledWith('2026', '09', {
      tax: 1500,
      provident: undefined,
      income: 33301,
    });
  });

  it('AC-OT-32: every OT control is a ≥44px tap target (min-h-11 / h-11 w-11)', async () => {
    const user = userEvent.setup();
    render(<SalaryCalculator selectedMonth="2026-09" />);
    await waitFor(() => expect(salaryAPI.getByMonth).toHaveBeenCalled());

    const addButton = screen.getByRole('button', { name: '+ เพิ่มรายการ OT' });
    expect(addButton.className).toContain('min-h-11');

    const row = await addOvertimeRow(user);
    expect(within(row).getByLabelText('จำนวนชั่วโมง OT').className).toContain('min-h-11');
    expect(within(row).getByLabelText('ตัวคูณ OT').className).toContain('min-h-11');
    const removeButton = within(row).getByRole('button', { name: 'ลบรายการ OT นี้' });
    expect(removeButton.className).toContain('h-11');
    expect(removeButton.className).toContain('w-11');
  });

  // m-11: a failed load blanks the form AND clears legacyIncomeKeys, so a save at that moment would
  // overwrite income with the blank payload and destroy the legacy OT amounts permanently (R-1).
  describe('m-11 — a month that failed to load must not be saved over', () => {
    let toastEvents;
    let toastListener;
    let consoleErrorSpy;

    beforeEach(() => {
      toastEvents = [];
      toastListener = (event) => toastEvents.push(event.detail);
      window.addEventListener('app:toast', toastListener);
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      window.removeEventListener('app:toast', toastListener);
      consoleErrorSpy.mockRestore();
    });

    it('getByMonth rejecting blocks the save and reports it with a toast instead', async () => {
      salaryAPI.getByMonth.mockRejectedValue(new Error('network down'));
      const user = userEvent.setup();

      render(<SalaryCalculator selectedMonth="2026-09" />);
      await waitFor(() => expect(consoleErrorSpy).toHaveBeenCalled());

      await user.click(screen.getByRole('button', { name: 'บันทึกเงินเดือน' }));

      expect(salaryAPI.save).not.toHaveBeenCalled();
      expect(taxAPI.updateMonthlyDeductionFields).not.toHaveBeenCalled();
      expect(incomeAPI.save).not.toHaveBeenCalled();
      expect(toastEvents).toEqual([
        {
          message: 'โหลดข้อมูลเดือนนี้ไม่สำเร็จ กรุณารีเฟรชหน้าก่อนบันทึก เพื่อป้องกันข้อมูลเดิมหาย',
          type: 'error',
          id: expect.any(Number),
        },
      ]);
    });

    it('switching to a month that loads successfully clears the block — save still sends the A-6 5-arg call with legacy keys intact', async () => {
      salaryAPI.getByMonth.mockRejectedValueOnce(new Error('network down'));
      salaryAPI.getByMonth.mockResolvedValue(LEGACY_MONTH);
      salaryAPI.save.mockResolvedValue({ success: true });
      const user = userEvent.setup();

      const { rerender } = render(<SalaryCalculator selectedMonth="2026-09" />);
      await waitFor(() => expect(consoleErrorSpy).toHaveBeenCalled());

      rerender(<SalaryCalculator selectedMonth="2026-10" />);
      await screen.findByDisplayValue('30,000.00');

      await user.click(screen.getByRole('button', { name: 'บันทึกเงินเดือน' }));
      await waitFor(() => expect(salaryAPI.save).toHaveBeenCalledTimes(1));

      expect(salaryAPI.save).toHaveBeenCalledWith(
        '2026-10',
        {
          salary: 30000,
          overtime_1_5x: 3200,
          __labels: { salary: 'เงินเดือน', overtime_1_5x: 'ค่าล่วงเวลา 1.5 เท่า' },
        },
        { tax: 1500, __labels: { tax: 'หักภาษี' } },
        '',
        []
      );
      expect(toastEvents.some((toast) => toast.type === 'error')).toBe(false);
    });
  });
});
