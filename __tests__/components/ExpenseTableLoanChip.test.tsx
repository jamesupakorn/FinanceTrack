// Loan slice S3 — AC-LN-37: the card-total row chip and the card group header follow the row's server cardType.
import { afterEach, describe, expect, it } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import ExpenseTable from '../../src/frontend/components/ExpenseTable';
import { expenseAPI, creditCardAPI } from '../../src/shared/utils/frontend/apiUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  expenseAPI: { getByMonth: jest.fn(), setPaid: jest.fn() },
  creditCardAPI: { getMonthInstallments: jest.fn(), getRevolving: jest.fn() },
  withCsrfHeaders: (h: unknown) => h,
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));
jest.mock('../../src/frontend/contexts/SessionContext', () => {
  const session = { currentUser: { id: 'u1', bankAccounts: ['กรุงศรี'] } };
  return { useSession: () => session };
});

const api = jest.mocked(expenseAPI);
const cards = jest.mocked(creditCardAPI);
const MONTH = '2026-08';

const breakdown = {
  installments: [{ key: 'cci_000000000001_01', name: 'งวด 1', amount: 300, paid: false }],
  installmentTotal: 300,
  revolving: { newSpend: 0, carriedBalance: 0, cashbackAmount: 0, totalDue: 0, minPaymentDue: 0, amountDue: 0, paymentAction: null }
};
const cardRow = (name: string, cardType?: string) => ({
  name, actual: 300, paid: false, dueDay: 5, account: 'กรุงศรี', derived: true, breakdown, ...(cardType ? { cardType } : {})
});

async function renderRows(rows: Record<string, unknown>) {
  api.getByMonth.mockResolvedValue(rows as never);
  cards.getMonthInstallments.mockResolvedValue([] as never);
  cards.getRevolving.mockResolvedValue({ cycles: [] } as never);
  render(<ExpenseTable selectedMonth={MONTH} />);
  await waitFor(() => expect(document.querySelector('[data-expense-key="ccr_000000000001"]')).not.toBeNull());
}

afterEach(() => { jest.clearAllMocks(); });

describe('AC-LN-37 ExpenseTable card-row type chip', () => {
  it('labels each card row by its cardType and switches the group header when a loan is present', async () => {
    await renderRows({
      ccr_000000000001: cardRow('ค่างวดสินเชื่อบ้าน บ้าน', 'home_loan'),
      ccr_000000000002: cardRow('ค่างวดสินเชื่อส่วนบุคคล รถ', 'personal_loan'),
      ccr_000000000003: cardRow('ยอดบัตร KTC', 'credit_card')
    });
    const chip = (key: string) => {
      const mobile = Array.from(document.querySelectorAll(`[data-expense-key="${key}"]`)).find(node => node.tagName === 'DIV') as HTMLElement;
      return mobile.querySelector('.rounded-full') as HTMLElement;
    };
    expect(chip('ccr_000000000001')).toHaveTextContent('สินเชื่อบ้าน');
    expect(chip('ccr_000000000002')).toHaveTextContent('สินเชื่อส่วนบุคคล');
    expect(chip('ccr_000000000003')).toHaveTextContent('บัตรเครดิต');
    expect(screen.getAllByText('บัตร & สินเชื่อ (ซิงก์อัตโนมัติ)').length).toBeGreaterThan(0);
    expect(screen.queryByText('บัตรเครดิต (ซิงก์อัตโนมัติ)')).toBeNull();
  });

  it('credit cards only (or rows without cardType): unchanged chip and header', async () => {
    await renderRows({ ccr_000000000001: cardRow('ยอดบัตร KTC') });
    expect(screen.getAllByText('บัตรเครดิต (ซิงก์อัตโนมัติ)').length).toBeGreaterThan(0);
    expect(screen.queryByText(/บัตร & สินเชื่อ \(ซิงก์อัตโนมัติ\)/)).toBeNull();
  });
});
