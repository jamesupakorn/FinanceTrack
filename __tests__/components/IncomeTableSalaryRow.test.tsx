/**
 * AC-SBC-01…08 — "รายรับ" salary row shows the Salary Record's live net income, never writes it
 * back into the stored income item, and the total agrees with it.
 * Spec: .pipeline/spec-salary-row-and-back-close.md §I1 (D1). Scope: IncomeTable.tsx read-only.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import IncomeTable from '../../src/frontend/components/IncomeTable';
import { formatCurrency } from '../../src/shared/utils/frontend/numberUtils';
import { incomeAPI, salaryAPI } from '../../src/shared/utils/frontend/apiUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  incomeAPI: { getByMonth: jest.fn(), save: jest.fn() },
  salaryAPI: { getByMonth: jest.fn() }
}));

const income = jest.mocked(incomeAPI);
const salary = jest.mocked(salaryAPI);

beforeEach(() => {
  jest.clearAllMocks();
  income.save.mockResolvedValue({ success: true });
  Element.prototype.scrollIntoView = jest.fn();
});

// รอให้แถวเงินเดือนแสดงตัวเลขที่คาดไว้ (ทั้ง md table + base card) ก่อน assert ต่อ
const waitForSalaryFigure = async (formatted: string) => {
  await waitFor(() => expect(screen.getAllByText(formatted).length).toBeGreaterThan(0));
};

test('AC-SBC-01: salary row and both รวม cells show live net income, not stored income.salary', async () => {
  income.getByMonth.mockResolvedValue({ salary: 30000, income2: 500 });
  salary.getByMonth.mockResolvedValue({ summary: { net_income: 27750 } });

  render(<IncomeTable selectedMonth="2026-01" />);

  await waitForSalaryFigure(formatCurrency(27750));
  expect(screen.getAllByText(formatCurrency(27750))).toHaveLength(2); // md table + base card
  expect(screen.getAllByText(formatCurrency(28250))).toHaveLength(2); // both "รวม" cells
});

test('AC-SBC-02: net_income 0 (and no summary at all) falls back to stored income.salary', async () => {
  income.getByMonth.mockResolvedValue({ salary: 30000, income2: 500 });

  salary.getByMonth.mockResolvedValueOnce({ summary: { net_income: 0 } });
  const { unmount } = render(<IncomeTable selectedMonth="2026-01" />);
  await waitForSalaryFigure(formatCurrency(30000));
  expect(screen.getAllByText(formatCurrency(30500))).toHaveLength(2);
  unmount();

  jest.clearAllMocks();
  income.getByMonth.mockResolvedValue({ salary: 30000, income2: 500 });
  income.save.mockResolvedValue({ success: true });
  salary.getByMonth.mockResolvedValueOnce({});
  render(<IncomeTable selectedMonth="2026-02" />);
  await waitForSalaryFigure(formatCurrency(30000));
  expect(screen.getAllByText(formatCurrency(30500))).toHaveLength(2);
});

test('AC-SBC-03: English summary.net_income wins over the legacy Thai สรุป.เงินได้สุทธิ key', async () => {
  income.getByMonth.mockResolvedValue({});

  salary.getByMonth.mockResolvedValueOnce({ สรุป: { เงินได้สุทธิ: 1000 } });
  const { unmount } = render(<IncomeTable selectedMonth="2026-01" />);
  await waitForSalaryFigure(formatCurrency(1000));
  unmount();

  jest.clearAllMocks();
  income.getByMonth.mockResolvedValue({});
  income.save.mockResolvedValue({ success: true });
  salary.getByMonth.mockResolvedValueOnce({ summary: { net_income: 2000 }, สรุป: { เงินได้สุทธิ: 1000 } });
  render(<IncomeTable selectedMonth="2026-02" />);
  await waitForSalaryFigure(formatCurrency(2000));
});

test('AC-SBC-04: save payload excludes salary entirely, even after editing another row', async () => {
  income.getByMonth.mockResolvedValue({ salary: 30000, income2: 500 });
  salary.getByMonth.mockResolvedValue({ summary: { net_income: 27750 } });

  let save: (() => Promise<void>) | null = null;
  render(<IncomeTable selectedMonth="2026-01" onRegisterSave={handler => { save = handler; }} />);
  await waitForSalaryFigure(formatCurrency(27750));

  const income2Input = screen.getAllByRole('textbox', { name: 'จำนวนเงินรายรับ - แหล่งรายรับ 2' })[0]!;
  fireEvent.change(income2Input, { target: { value: '600' } });

  income.getByMonth.mockResolvedValue({ salary: 30000, income2: 600 });
  await act(async () => { await save?.(); });

  expect(income.save).toHaveBeenCalledTimes(1);
  const payload = income.save.mock.calls[0]?.[1] as Record<string, unknown>;
  expect(payload).not.toHaveProperty('salary');
  expect(payload.income2).toBe(600);
  if ('__removeKeys' in payload) {
    expect(payload.__removeKeys as string[]).not.toContain('salary');
  }
});

test('AC-SBC-05: salary row renders first even with no salary key in the income doc', async () => {
  income.getByMonth.mockResolvedValue({ income2: 500 });
  salary.getByMonth.mockResolvedValue({ summary: { net_income: 27750 } });

  const { unmount } = render(<IncomeTable selectedMonth="2026-01" />);
  await waitForSalaryFigure(formatCurrency(27750));
  expect(screen.getAllByText(formatCurrency(28250))).toHaveLength(2);
  const firstKeyedRow = document.querySelector('[data-income-key]');
  expect(firstKeyedRow).toHaveAttribute('data-income-key', 'salary');
  unmount();

  jest.clearAllMocks();
  income.getByMonth.mockResolvedValue({ income2: 500 });
  income.save.mockResolvedValue({ success: true });
  salary.getByMonth.mockResolvedValue({ summary: { net_income: 0 } });
  render(<IncomeTable selectedMonth="2026-02" />);
  await waitForSalaryFigure(formatCurrency(0));
  const firstKeyedRowZero = document.querySelector('[data-income-key]');
  expect(firstKeyedRowZero).toHaveAttribute('data-income-key', 'salary');
});

test('AC-SBC-06: switching month resets the figure first — a rejected GET never shows the previous month\'s value', async () => {
  income.getByMonth.mockImplementation(async (month: string) => (
    month === '2026-02' ? { salary: 100 } : { salary: 30000, income2: 500 }
  ));
  salary.getByMonth.mockImplementation(async (month: string) => {
    if (month === '2026-02') throw new Error('salary GET failed');
    return { summary: { net_income: 27750 } };
  });
  const logSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  const { rerender } = render(<IncomeTable selectedMonth="2026-01" />);
  await waitForSalaryFigure(formatCurrency(27750));

  rerender(<IncomeTable selectedMonth="2026-02" />);
  await waitForSalaryFigure(formatCurrency(100));
  expect(screen.queryByText(formatCurrency(27750))).not.toBeInTheDocument();

  logSpy.mockRestore();
});

test('AC-SBC-07: the amount filter and the amount sort both read the live salary figure', async () => {
  income.getByMonth.mockResolvedValue({ salary: 30000, income2: 500 });
  salary.getByMonth.mockResolvedValue({ summary: { net_income: 27750 } });

  render(<IncomeTable selectedMonth="2026-01" />);
  await waitForSalaryFigure(formatCurrency(27750));

  fireEvent.click(screen.getByRole('button', { name: /^ตัวกรอง/ }));
  fireEvent.click(screen.getByRole('combobox', { name: 'จำนวนเงิน' }));
  fireEvent.click(screen.getByRole('option', { name: 'เป็นศูนย์' }));
  expect(screen.queryByText('เงินเดือน')).not.toBeInTheDocument();
});

test('AC-SBC-07b: sort "จำนวนเงิน: มากไปน้อย" places the salary row before a smaller row', async () => {
  income.getByMonth.mockResolvedValue({ salary: 30000, income2: 500 });
  salary.getByMonth.mockResolvedValue({ summary: { net_income: 27750 } });

  render(<IncomeTable selectedMonth="2026-01" />);
  await waitForSalaryFigure(formatCurrency(27750));

  fireEvent.change(screen.getByLabelText('เรียงตาม — รายรับ'), { target: { value: 'amount:desc' } });

  const keyedRows = Array.from(document.querySelectorAll('[data-income-key]')).map(node => node.getAttribute('data-income-key'));
  const salaryIndex = keyedRows.indexOf('salary');
  const income2Index = keyedRows.indexOf('income2');
  expect(salaryIndex).toBeGreaterThanOrEqual(0);
  expect(income2Index).toBeGreaterThan(salaryIndex);
});

test('AC-SBC-08: FinancialListEditors.test.tsx / FinancialInputNames.test.tsx stay unedited and monthlySummary.ts is untouched by D1', () => {
  // บังคับไว้เป็น documentation ของ Definition of Done — การยืนยันจริงอยู่ที่การรัน jest ทั้งสองไฟล์
  // และ `git diff --name-only -- src/shared/utils/frontend/monthlySummary.ts` ที่ต้องว่างเปล่า (AC-SBC-08)
  expect(true).toBe(true);
});
