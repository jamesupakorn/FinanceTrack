/**
 * Accessible names for the income / expense financial inputs (spec-ui-payment-clarity-accessibility AC 8-11).
 * jsdom ignores responsive CSS, so both the desktop table and the mobile cards are in the DOM here;
 * real visibility per width is covered by the browser check, not by these tests.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import IncomeTable from '../../src/frontend/components/IncomeTable';
import ExpenseTable from '../../src/frontend/components/ExpenseTable';
import { buildRowContexts, financialFieldLabel } from '../../src/shared/utils/frontend/fieldLabels';
import { incomeAPI, salaryAPI, expenseAPI, creditCardAPI } from '../../src/shared/utils/frontend/apiUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  incomeAPI: { getByMonth: jest.fn(), save: jest.fn() },
  salaryAPI: { getByMonth: jest.fn() },
  expenseAPI: { getByMonth: jest.fn(), setPaid: jest.fn() },
  creditCardAPI: { getMonthInstallments: jest.fn(), getRevolving: jest.fn() },
  withCsrfHeaders: (h: unknown) => h
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));
jest.mock('../../src/frontend/contexts/SessionContext', () => {
  const session = { currentUser: { id: 'u1', bankAccounts: ['กรุงศรี', 'ไทยพาณิชย์'] } };
  return { useSession: () => session };
});

const income = jest.mocked(incomeAPI);
const salary = jest.mocked(salaryAPI);
const expense = jest.mocked(expenseAPI);
const cards = jest.mocked(creditCardAPI);

beforeEach(() => {
  jest.clearAllMocks();
  Element.prototype.scrollIntoView = jest.fn();
});

describe('fieldLabels', () => {
  it('uses the row name when it is unique and non-blank', () => {
    expect(buildRowContexts(['ค่าไฟ', 'ค่าน้ำ'])).toEqual(['ค่าไฟ', 'ค่าน้ำ']);
  });

  it('adds a human ordinal for duplicate and blank names, never an opaque key', () => {
    expect(buildRowContexts(['ค่าไฟ', 'ค่าไฟ', '  ', null])).toEqual([
      'ค่าไฟ (รายการที่ 1)',
      'ค่าไฟ (รายการที่ 2)',
      'รายการไม่มีชื่อ (รายการที่ 3)',
      'รายการไม่มีชื่อ (รายการที่ 4)'
    ]);
  });

  it('joins purpose and row context', () => {
    expect(financialFieldLabel('จำนวนเงินรายรับ', 'โบนัส')).toBe('จำนวนเงินรายรับ - โบนัส');
  });
});

describe('IncomeTable amount names', () => {
  it('names every editable amount with purpose and row, in both responsive branches', async () => {
    income.getByMonth.mockResolvedValue({ custom_a: 90, custom_b: 1200, __labels: { custom_a: 'โบนัส', custom_b: 'ค่าเช่า' } });
    salary.getByMonth.mockResolvedValue({});
    render(<IncomeTable selectedMonth="2026-01" />);
    await screen.findAllByDisplayValue('โบนัส');

    const bonus = screen.getAllByRole('textbox', { name: 'จำนวนเงินรายรับ - โบนัส' });
    const rent = screen.getAllByRole('textbox', { name: 'จำนวนเงินรายรับ - ค่าเช่า' });
    expect(bonus).toHaveLength(2); // desktop table + mobile card
    expect(rent).toHaveLength(2);
    expect(bonus.map(input => (input as HTMLInputElement).value)).toEqual(['90.00', '90.00']);
  });

  it('keeps blank and duplicate rows distinguishable and follows renames', async () => {
    income.getByMonth.mockResolvedValue({ custom_a: 1, custom_b: 2, custom_c: 3, __labels: { custom_a: 'โบนัส', custom_b: 'โบนัส', custom_c: 'ค่าเช่า' } });
    salary.getByMonth.mockResolvedValue({});
    render(<IncomeTable selectedMonth="2026-01" />);
    await screen.findAllByDisplayValue('ค่าเช่า');

    const names = screen.getAllByRole('textbox')
      .map(input => input.getAttribute('aria-label'))
      .filter((label): label is string => Boolean(label?.startsWith('จำนวนเงินรายรับ')));
    // three rows x two branches; each row's name is unique within a branch
    expect(names).toHaveLength(6);
    expect(new Set(names).size).toBe(3);
    expect(names.filter(label => /โบนัส \(รายการที่ \d+\)/.test(label))).toHaveLength(4);
    expect(names).toContain('จำนวนเงินรายรับ - ค่าเช่า');

    fireEvent.change(screen.getAllByDisplayValue('ค่าเช่า')[0]!, { target: { value: 'ค่าเช่าห้อง' } });
    expect(screen.getAllByRole('textbox', { name: 'จำนวนเงินรายรับ - ค่าเช่าห้อง' })).toHaveLength(2);
  });

  it('does not give the salary-derived read-only row an input name', async () => {
    income.getByMonth.mockResolvedValue({ salary: 30000, custom_a: 10, __labels: { custom_a: 'โบนัส' } });
    salary.getByMonth.mockResolvedValue({});
    render(<IncomeTable selectedMonth="2026-01" />);
    await screen.findAllByDisplayValue('โบนัส');
    expect(screen.queryByRole('textbox', { name: /จำนวนเงินรายรับ - .*เงินเดือน/ })).not.toBeInTheDocument();
  });
});

describe('ExpenseTable amount / account / due-day names', () => {
  async function setup(rows: Record<string, unknown>) {
    expense.getByMonth.mockResolvedValue(rows as never);
    cards.getMonthInstallments.mockResolvedValue([] as never);
    cards.getRevolving.mockResolvedValue(null as never);
    render(<ExpenseTable selectedMonth="2026-08" onRegisterSave={() => {}} onSaved={() => {}} markDirty={() => {}} />);
    await waitFor(() => expect(document.querySelector('[data-expense-key="coffee"]')).not.toBeNull());
  }

  it('names amount, account and due-day controls with purpose and row on desktop and mobile', async () => {
    await setup({
      coffee: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false, dueDay: 'EOM' },
      tea: { name: 'ชา', actual: 20, account: 'ไทยพาณิชย์', paid: false, dueDay: '5' }
    });

    expect(screen.getAllByRole('textbox', { name: 'จำนวนเงินรายจ่าย - กาแฟ' })).toHaveLength(2);
    const accounts = screen.getAllByRole('combobox', { name: 'บัญชีที่ใช้จ่าย - ชา' });
    const dueDays = screen.getAllByRole('combobox', { name: 'วันครบกำหนด - ชา' });
    expect(accounts).toHaveLength(2);
    expect(dueDays).toHaveLength(2);
    // native selects keep their value and options
    expect(accounts.map(select => (select as HTMLSelectElement).value)).toEqual(['ไทยพาณิชย์', 'ไทยพาณิชย์']);
    expect(dueDays.map(select => (select as HTMLSelectElement).value)).toEqual(['5', '5']);

    // no visible target control is left without a name
    const desktopRow = document.querySelector('tr[data-expense-key="coffee"]') as HTMLElement;
    within(desktopRow).getAllByRole('combobox').forEach(select => expect(select).toHaveAccessibleName(/- กาแฟ$/));
  });

  it('keeps duplicate and blank row names distinguishable', async () => {
    await setup({
      coffee: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false, dueDay: 'EOM' },
      coffee2: { name: 'กาแฟ', actual: 60, account: 'กรุงศรี', paid: false, dueDay: 'EOM' },
      tea: { name: 'ชา', actual: 70, account: 'กรุงศรี', paid: false, dueDay: 'EOM' }
    });

    const amountNames = () => screen.getAllByRole('textbox')
      .map(input => input.getAttribute('aria-label'))
      .filter((label): label is string => Boolean(label?.startsWith('จำนวนเงินรายจ่าย')));
    expect(amountNames()).toHaveLength(6);
    expect(new Set(amountNames()).size).toBe(3);
    expect(amountNames().filter(label => /กาแฟ \(รายการที่ \d+\)/.test(label))).toHaveLength(4);

    // a name cleared while editing falls back to an ordinal label instead of an empty name
    fireEvent.change(screen.getAllByDisplayValue('ชา')[0]!, { target: { value: '' } });
    expect(amountNames().some(label => /^จำนวนเงินรายจ่าย - รายการไม่มีชื่อ \(รายการที่ \d+\)$/.test(label))).toBe(true);
    expect(new Set(amountNames()).size).toBe(3);
  });

  it('does not change values or the edit handlers when labelled', async () => {
    await setup({ coffee: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false, dueDay: 'EOM' } });
    const [desktopAmount] = screen.getAllByRole('textbox', { name: 'จำนวนเงินรายจ่าย - กาแฟ' }) as HTMLInputElement[];
    fireEvent.change(desktopAmount!, { target: { value: '75' } });
    expect(desktopAmount!.value).toBe('75');
  });
});
