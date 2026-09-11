import { render, screen, within, waitFor } from '@testing-library/react';
import MonthComparison from '../../src/frontend/components/MonthComparison';
import { incomeAPI, expenseAPI, savingsAPI, dailyExpenseAPI } from '../../src/shared/utils/frontend/apiUtils';
import { formatMonthLabelTH } from '../../src/shared/utils/frontend/monthUtils';
import { formatCurrency } from '../../src/shared/utils/frontend/numberUtils';

// The only collaborator this file mocks — apiUtils' incomeAPI/expenseAPI/savingsAPI/dailyExpenseAPI
// exports (4 modules, 4 methods total). getMonthlySummaryModel/formatCurrency/formatMonthLabelTH/round2/
// Icons all run real, per spec §Scope item 2 / AC-3 ("exactly one jest.mock() call, no accidental extra
// mock").
jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  incomeAPI: { getAll: jest.fn() },
  expenseAPI: { getAll: jest.fn() },
  savingsAPI: { getAll: jest.fn() },
  dailyExpenseAPI: { getByMonth: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

// Canonical two-month fixture — reused by tests 5, 6, and 10.
// Every numeric value across both months is deliberately distinct (with the sole intentional exception
// of creditCard, which is 0 for both — not asserted on in the parity test) so getAllByText count
// assertions in the parity test (test 10) are unambiguous.
//
// NOTE (verified against the real, unmocked getMonthlySummaryModel/computeTotalIncome — do not
// re-derive by hand without re-checking against the source): computeTotalIncome derives totalIncome as
// (salaryNetIncome>0 ? salaryNetIncome : salary) + (รวม - salary) — a fixture with only `salary` and no
// `รวม` yields nonSalaryIncome = 0 - salary = -salary, cancelling totalIncome to 0. Every fixture below
// sets รวม === salary (no non-salary income component) so totalIncome resolves to the plain salary
// figure.
const FEB = {
  incomeData: { salary: 50000, รวม: 50000 },
  expenseData: { rent: { actual: 21000, paid: true } },
  savingsData: { รวมเงินเก็บ: 6000 },
  dailyExpenseData: { totalMonthly: 3000 },
}; // -> totalIncome 50000, generalExpense 21000, dailyExpense 3000, savings 6000, creditCard 0,
   //    netCashFlow 50000 - (21000+3000+6000+0) = 20000
const JAN = {
  incomeData: { salary: 40000, รวม: 40000 },
  expenseData: { rent: { actual: 22000, paid: true } },
  savingsData: { รวมเงินเก็บ: 5500 },
  dailyExpenseData: { totalMonthly: 2500 },
}; // -> totalIncome 40000, generalExpense 22000, dailyExpense 2500, savings 5500, creditCard 0,
   //    netCashFlow 40000 - (22000+2500+5500+0) = 10000
// Δ (Feb vs. Jan, months sort descending -> Feb index 0 / Jan index 1):
// amount = round2(20000 - 10000) = 10000, percent = round2((10000/10000)*100) = 100
// -> "เพิ่มขึ้น 100%" (isUp, since 10000 >= 0)

function mockCanonicalTwoMonths() {
  incomeAPI.getAll.mockResolvedValue({ months: { '2026-02': FEB.incomeData, '2026-01': JAN.incomeData } });
  expenseAPI.getAll.mockResolvedValue({ months: { '2026-02': FEB.expenseData, '2026-01': JAN.expenseData } });
  savingsAPI.getAll.mockResolvedValue({ months: { '2026-02': FEB.savingsData, '2026-01': JAN.savingsData } });
  dailyExpenseAPI.getByMonth.mockImplementation((month) =>
    Promise.resolve(month === '2026-02' ? FEB.dailyExpenseData : JAN.dailyExpenseData)
  );
}

describe('MonthComparison', () => {
  it('1. loading state renders synchronously and fires all three getAll fetches unconditionally', () => {
    incomeAPI.getAll.mockReturnValue(new Promise(() => {}));
    expenseAPI.getAll.mockReturnValue(new Promise(() => {}));
    savingsAPI.getAll.mockReturnValue(new Promise(() => {}));

    render(<MonthComparison />);

    expect(screen.getByText('กำลังโหลดข้อมูลเปรียบเทียบ...')).toBeInTheDocument();
    expect(incomeAPI.getAll).toHaveBeenCalledTimes(1);
    expect(expenseAPI.getAll).toHaveBeenCalledTimes(1);
    expect(savingsAPI.getAll).toHaveBeenCalledTimes(1);
  });

  it('2. load failure (Promise.all rejects) shows the error message, logs, and never fetches dailyExpense', async () => {
    incomeAPI.getAll.mockRejectedValue(new Error('network down'));
    expenseAPI.getAll.mockResolvedValue({ months: {} });
    savingsAPI.getAll.mockResolvedValue({ months: {} });
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(<MonthComparison />);

    await screen.findByText('โหลดข้อมูลเปรียบเทียบไม่สำเร็จ');
    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to load month comparison:', expect.any(Error));
    expect(dailyExpenseAPI.getByMonth).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('3. insufficient data (exactly 1 real month) shows the min-2-months message, still fetches daily data, and does not log', async () => {
    incomeAPI.getAll.mockResolvedValue({ months: { '2026-01': JAN.incomeData } });
    expenseAPI.getAll.mockResolvedValue({ months: {} });
    savingsAPI.getAll.mockResolvedValue({ months: {} });
    dailyExpenseAPI.getByMonth.mockResolvedValue(JAN.dailyExpenseData);
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(<MonthComparison />);

    await screen.findByText('ต้องมีข้อมูลอย่างน้อย 2 เดือนจึงจะเปรียบเทียบได้');
    expect(dailyExpenseAPI.getByMonth).toHaveBeenCalledTimes(1);
    expect(dailyExpenseAPI.getByMonth).toHaveBeenCalledWith('2026-01');
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('4. MONTH_RE filters non-YYYY-MM keys — a stray metadata key does not become a phantom row', async () => {
    incomeAPI.getAll.mockResolvedValue({
      months: { '2026-02': FEB.incomeData, '2026-01': JAN.incomeData, totalActualPaid: { some: 'junk' } },
    });
    expenseAPI.getAll.mockResolvedValue({ months: { '2026-02': FEB.expenseData, '2026-01': JAN.expenseData } });
    savingsAPI.getAll.mockResolvedValue({ months: { '2026-02': FEB.savingsData, '2026-01': JAN.savingsData } });
    dailyExpenseAPI.getByMonth.mockImplementation((month) =>
      Promise.resolve(month === '2026-02' ? FEB.dailyExpenseData : JAN.dailyExpenseData)
    );

    render(<MonthComparison />);

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3); // 1 header row + 2 month rows (no row for the stray key)
  });

  it('5. populated render — canonical fixture, exact values (table-scoped)', async () => {
    mockCanonicalTwoMonths();

    render(<MonthComparison />);
    const table = await screen.findByRole('table');
    const withinTable = within(table);

    expect(withinTable.getByText(formatMonthLabelTH('2026-02'))).toBeInTheDocument();
    expect(withinTable.getByText(formatMonthLabelTH('2026-01'))).toBeInTheDocument();

    const febRow = withinTable.getByText(formatMonthLabelTH('2026-02')).closest('tr');
    const janRow = withinTable.getByText(formatMonthLabelTH('2026-01')).closest('tr');

    [
      [febRow, [50000, 21000, 3000, 6000, 0, 20000]],
      [janRow, [40000, 22000, 2500, 5500, 0, 10000]],
    ].forEach(([row, [income, generalExpense, dailyExpense, savings, creditCard, netCashFlow]]) => {
      const withinRow = within(row);
      expect(withinRow.getByText(formatCurrency(income))).toBeInTheDocument();
      expect(withinRow.getByText(formatCurrency(generalExpense))).toBeInTheDocument();
      expect(withinRow.getByText(formatCurrency(dailyExpense))).toBeInTheDocument();
      expect(withinRow.getByText(formatCurrency(savings))).toBeInTheDocument();
      expect(withinRow.getByText(formatCurrency(creditCard))).toBeInTheDocument();
      expect(withinRow.getByText(formatCurrency(netCashFlow))).toBeInTheDocument();
    });

    expect(incomeAPI.getAll).toHaveBeenCalledTimes(1);
    expect(expenseAPI.getAll).toHaveBeenCalledTimes(1);
    expect(savingsAPI.getAll).toHaveBeenCalledTimes(1);
    expect(dailyExpenseAPI.getByMonth).toHaveBeenCalledTimes(2);
    expect(dailyExpenseAPI.getByMonth).toHaveBeenCalledWith('2026-02');
    expect(dailyExpenseAPI.getByMonth).toHaveBeenCalledWith('2026-01');
  });

  it('6. delta — up direction on the newest row, and no-delta ("—") on the oldest row', async () => {
    mockCanonicalTwoMonths();

    render(<MonthComparison />);
    const table = await screen.findByRole('table');
    const withinTable = within(table);

    const febRow = withinTable.getByText(formatMonthLabelTH('2026-02')).closest('tr');
    const janRow = withinTable.getByText(formatMonthLabelTH('2026-01')).closest('tr');

    expect(within(febRow).getByText('เพิ่มขึ้น 100 เปอร์เซ็นต์')).toBeInTheDocument();
    // Jan is the oldest row (no rows[2] to compare against) -> literal "—", no delta badge.
    const janDeltaCell = janRow.querySelector('td:last-child');
    expect(within(janDeltaCell).getByText('—')).toBeInTheDocument();
  });

  it('7. delta zero-guard — previousModel.netCashFlow === 0 forces percent null ("—") even though amount is nonzero', async () => {
    // Jan: netCashFlow = 10000 - 10000 = 0. Feb: netCashFlow = 15000 - 5000 = 10000.
    incomeAPI.getAll.mockResolvedValue({
      months: { '2026-02': { salary: 15000, รวม: 15000 }, '2026-01': { salary: 10000, รวม: 10000 } },
    });
    expenseAPI.getAll.mockResolvedValue({
      months: {
        '2026-02': { rent: { actual: 5000, paid: true } },
        '2026-01': { rent: { actual: 10000, paid: true } },
      },
    });
    savingsAPI.getAll.mockResolvedValue({ months: { '2026-02': {}, '2026-01': {} } });
    dailyExpenseAPI.getByMonth.mockResolvedValue({ totalMonthly: 0 });

    render(<MonthComparison />);
    const table = await screen.findByRole('table');
    const withinTable = within(table);

    const febRow = withinTable.getByText(formatMonthLabelTH('2026-02')).closest('tr');
    const febDeltaCell = febRow.querySelector('td:last-child');
    // Not "Infinity%"/"NaN%" — the divide-by-zero guard actually fires.
    expect(within(febDeltaCell).getByText('—')).toBeInTheDocument();
    expect(within(febDeltaCell).queryByText(/Infinity/)).not.toBeInTheDocument();
    expect(within(febDeltaCell).queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('8. per-month dailyExpense failure isolation (AC-RS-20/E12) — one month failing does not blank the table or the row', async () => {
    incomeAPI.getAll.mockResolvedValue({ months: { '2026-02': FEB.incomeData, '2026-01': JAN.incomeData } });
    expenseAPI.getAll.mockResolvedValue({ months: { '2026-02': FEB.expenseData, '2026-01': JAN.expenseData } });
    savingsAPI.getAll.mockResolvedValue({ months: { '2026-02': FEB.savingsData, '2026-01': JAN.savingsData } });
    dailyExpenseAPI.getByMonth.mockImplementation((month) =>
      month === '2026-01' ? Promise.reject(new Error('daily fetch down')) : Promise.resolve(FEB.dailyExpenseData)
    );

    render(<MonthComparison />);
    const table = await screen.findByRole('table');
    const withinTable = within(table);

    const febRow = withinTable.getByText(formatMonthLabelTH('2026-02')).closest('tr');
    const janRow = withinTable.getByText(formatMonthLabelTH('2026-01')).closest('tr');

    // Jan's row: partial-data chip present + dailyExpense cell shows literal "—", not formatCurrency(0).
    expect(within(janRow).getByText('ข้อมูลบางส่วนไม่ครบ')).toBeInTheDocument();
    const janDailyExpenseCell = janRow.querySelectorAll('td')[2];
    expect(within(janDailyExpenseCell).getByText('—')).toBeInTheDocument();
    expect(within(janDailyExpenseCell).queryByText(formatCurrency(0))).not.toBeInTheDocument();

    // Feb's row: entirely unaffected.
    expect(within(febRow).queryByText('ข้อมูลบางส่วนไม่ครบ')).not.toBeInTheDocument();
    expect(within(febRow).getByText(formatCurrency(3000))).toBeInTheDocument();

    // No top-level load error.
    expect(screen.queryByText('โหลดข้อมูลเปรียบเทียบไม่สำเร็จ')).not.toBeInTheDocument();
  });

  it('9. MAX_MONTHS cap — 7 valid months, only the most recent 6 render, oldest month dropped', async () => {
    incomeAPI.getAll.mockResolvedValue({
      months: {
        '2026-02': {}, '2026-01': {}, '2025-12': {}, '2025-11': {}, '2025-10': {}, '2025-09': {}, '2025-08': {},
      },
    });
    expenseAPI.getAll.mockResolvedValue({ months: {} });
    savingsAPI.getAll.mockResolvedValue({ months: {} });
    dailyExpenseAPI.getByMonth.mockResolvedValue({ totalMonthly: 0 });

    render(<MonthComparison />);
    const table = await screen.findByRole('table');
    const withinTable = within(table);

    ['2026-02', '2026-01', '2025-12', '2025-11', '2025-10', '2025-09'].forEach((month) => {
      expect(withinTable.getByText(formatMonthLabelTH(month))).toBeInTheDocument();
    });
    expect(screen.queryByText(formatMonthLabelTH('2025-08'))).not.toBeInTheDocument();

    expect(dailyExpenseAPI.getByMonth).toHaveBeenCalledTimes(6);
    expect(dailyExpenseAPI.getByMonth).not.toHaveBeenCalledWith('2025-08');
  });

  it('10. dual-render parity — table and card variants both mount with matching data', async () => {
    mockCanonicalTwoMonths();

    render(<MonthComparison />);
    await screen.findByRole('table');

    // Each month label appears once in the table's <th scope="row"> and once in the card header <span>.
    expect(screen.getAllByText(formatMonthLabelTH('2026-02'))).toHaveLength(2);
    expect(screen.getAllByText(formatMonthLabelTH('2026-01'))).toHaveLength(2);

    // Feb's netCashFlow value (20000, distinct from every other figure in the fixture) appears in the
    // table's rightmost <td> and the card's emphasized ComparisonRow. NOTE: the table's label for this
    // figure is "กระแสเงินสดสุทธิ" while the card's is the shorter "สุทธิ" — a deliberate design
    // difference (task-context §CSS container-query dual-render finding). This assertion checks the
    // *value* count only, not a matching label count, so it does not false-fail on that by-design label
    // difference.
    expect(screen.getAllByText(formatCurrency(20000))).toHaveLength(2);

    // The DeltaBadge component instance is reused once per block, so its sr-only text is identical in
    // both — unlike the hand-written row labels above.
    expect(screen.getAllByText('เพิ่มขึ้น 100 เปอร์เซ็นต์')).toHaveLength(2);

    await waitFor(() => expect(dailyExpenseAPI.getByMonth).toHaveBeenCalledTimes(2));
  });
});
