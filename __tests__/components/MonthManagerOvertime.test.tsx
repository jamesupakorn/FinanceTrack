/**
 * MonthManager — copy-previous-month and the OT contract (salary-ot-calculator, Increment 4)
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import MonthManager from '../../src/frontend/components/MonthManager';
import {
  expenseAPI,
  incomeAPI,
  salaryAPI,
  savingsAPI,
  investmentAPI,
  dailyExpenseAPI
} from '../../src/shared/utils/frontend/apiUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  expenseAPI: { getAll: jest.fn(), save: jest.fn() },
  incomeAPI: { getAll: jest.fn(), save: jest.fn() },
  salaryAPI: { getByMonth: jest.fn(), save: jest.fn() },
  savingsAPI: { getAll: jest.fn(), saveList: jest.fn() },
  investmentAPI: { getAll: jest.fn(), saveList: jest.fn() },
  dailyExpenseAPI: { getByMonth: jest.fn(), save: jest.fn() }
}));

const mockedExpenseAPI = jest.mocked(expenseAPI);
const mockedIncomeAPI = jest.mocked(incomeAPI);
const mockedSalaryAPI = jest.mocked(salaryAPI);
const mockedSavingsAPI = jest.mocked(savingsAPI);
const mockedInvestmentAPI = jest.mocked(investmentAPI);
const mockedDailyExpenseAPI = jest.mocked(dailyExpenseAPI);

const MONTHS = ['2026-03', '2026-02'];

const PREV_SALARY_DOC = {
  income: {
    salary: 30000,
    bonus: 5000,
    overtime_1_5x: 3200,
    __labels: {
      salary: 'เงินเดือน',
      bonus: 'โบนัส',
      overtime_1_5x: 'ค่าล่วงเวลา 1.5 เท่า'
    }
  },
  deduct: { tax: 1500, social_security: 750 },
  note: 'เดือนก่อน',
  overtime: [
    { id: 'ot_prev_a', hours: 10, multiplier: 1.5 },
    { id: 'ot_prev_b', hours: 7.5, multiplier: 3 }
  ],
  overtimeLegacy: [
    { id: 'legacy_overtime_1_5x', key: 'overtime_1_5x', label: 'ค่าล่วงเวลา 1.5 เท่า', amount: 3200 }
  ],
  summary: { total_income: 39688, total_deduct: 2250, net_income: 37438 }
};

function mockAllReads(salaryDoc: unknown) {
  mockedExpenseAPI.getAll.mockResolvedValue({} as Awaited<ReturnType<typeof expenseAPI.getAll>>);
  mockedIncomeAPI.getAll.mockResolvedValue({} as Awaited<ReturnType<typeof incomeAPI.getAll>>);
  mockedSalaryAPI.getByMonth.mockResolvedValue(salaryDoc as Awaited<ReturnType<typeof salaryAPI.getByMonth>>);
  mockedSavingsAPI.getAll.mockResolvedValue({} as Awaited<ReturnType<typeof savingsAPI.getAll>>);
  mockedInvestmentAPI.getAll.mockResolvedValue({} as Awaited<ReturnType<typeof investmentAPI.getAll>>);
  mockedDailyExpenseAPI.getByMonth.mockResolvedValue({ items: [] } as Awaited<ReturnType<typeof dailyExpenseAPI.getByMonth>>);

  mockedExpenseAPI.save.mockResolvedValue({ success: true } as Awaited<ReturnType<typeof expenseAPI.save>>);
  mockedIncomeAPI.save.mockResolvedValue({ success: true } as Awaited<ReturnType<typeof incomeAPI.save>>);
  mockedSalaryAPI.save.mockResolvedValue({ success: true } as Awaited<ReturnType<typeof salaryAPI.save>>);
  mockedSavingsAPI.saveList.mockResolvedValue({ success: true } as Awaited<ReturnType<typeof savingsAPI.saveList>>);
  mockedInvestmentAPI.saveList.mockResolvedValue({ success: true } as Awaited<ReturnType<typeof investmentAPI.saveList>>);
  mockedDailyExpenseAPI.save.mockResolvedValue({ success: true } as Awaited<ReturnType<typeof dailyExpenseAPI.save>>);
}

function renderPicker(props: Partial<ComponentProps<typeof MonthManager>> = {}) {
  return render(
    <MonthManager
      selectedMonth="2026-03"
      months={MONTHS}
      onMonthSelected={jest.fn()}
      onDataRefresh={jest.fn()}
      open
      onRequestClose={jest.fn()}
      {...props}
    />
  );
}

async function runCopyPrevMonth(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText('คัดลอกข้อมูลจากเดือนก่อนหน้า'));
  await user.click(await screen.findByRole('button', { name: 'เขียนทับและคัดลอก' }));
  await waitFor(() => expect(mockedSalaryAPI.save).toHaveBeenCalledTimes(1));
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('MonthManager — copy-previous-month OT contract', () => {
  it('AC-OT-15: copies overtime as argument five and strips legacy overtime keys and labels', async () => {
    mockAllReads(PREV_SALARY_DOC);
    const user = userEvent.setup();
    renderPicker();
    await runCopyPrevMonth(user);

    expect(mockedSalaryAPI.save).toHaveBeenCalledWith(
      '2026-03',
      { salary: 30000, bonus: 5000, __labels: { salary: 'เงินเดือน', bonus: 'โบนัส' } },
      { tax: 1500, social_security: 750 },
      'เดือนก่อน',
      [
        { id: 'ot_prev_a', hours: 10, multiplier: 1.5 },
        { id: 'ot_prev_b', hours: 7.5, multiplier: 3 }
      ]
    );
    expect(mockedSalaryAPI.getByMonth).toHaveBeenCalledWith('2026-02');
  });

  it('AC-OT-15 (BR-OT-007): never forwards the legacy overtime rows', async () => {
    mockAllReads(PREV_SALARY_DOC);
    const user = userEvent.setup();
    renderPicker();
    await runCopyPrevMonth(user);

    const args = mockedSalaryAPI.save.mock.calls[0];
    expect(JSON.stringify(args)).not.toContain('overtimeLegacy');
    expect(JSON.stringify(args)).not.toContain('legacy_overtime_1_5x');
    expect(JSON.stringify(args)).not.toContain('overtime_1_5x');
    expect(JSON.stringify(args)).not.toContain('3200');
  });

  it('A-6: argument four remains the note and argument five is the overtime array', async () => {
    mockAllReads(PREV_SALARY_DOC);
    const user = userEvent.setup();
    renderPicker();
    await runCopyPrevMonth(user);

    const args = mockedSalaryAPI.save.mock.calls[0];
    expect(args).toHaveLength(5);
    expect(typeof args[3]).toBe('string');
    expect(Array.isArray(args[4])).toBe(true);
  });

  it('A-9: an older document without overtime explicitly sends an empty array', async () => {
    mockAllReads({ income: { salary: 30000 }, deduct: {}, note: '' });
    const user = userEvent.setup();
    renderPicker();
    await runCopyPrevMonth(user);
    expect(mockedSalaryAPI.save).toHaveBeenCalledWith('2026-03', { salary: 30000 }, {}, '', []);
  });

  it('A-9: a missing previous-month document still sends a well-formed five-argument call', async () => {
    mockAllReads(null);
    const user = userEvent.setup();
    renderPicker();
    await runCopyPrevMonth(user);
    expect(mockedSalaryAPI.save).toHaveBeenCalledWith('2026-03', {}, {}, '', []);
  });

  it('AC-OT-23: creating an empty month keeps the four-argument salary save call', async () => {
    mockAllReads(PREV_SALARY_DOC);
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByLabelText('เพิ่มเดือนใหม่'));
    await user.click(await screen.findByLabelText('เพิ่มเดือนถัดไป (2026-04)'));
    await waitFor(() => expect(mockedSalaryAPI.save).toHaveBeenCalledTimes(1));
    expect(mockedSalaryAPI.save.mock.calls[0]).toEqual(['2026-04', {}, {}, '']);
  });
});