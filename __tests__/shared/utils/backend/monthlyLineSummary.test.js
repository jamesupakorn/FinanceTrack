/** @jest-environment node */
// Pure-logic tests for monthlyLineSummary.js formatters, plus a JSON-mode payload-building
// happy path. Does not touch the network — no LINE call happens anywhere in this file.
import {
  buildMonthlySummaryFlex,
  formatMonthlySummaryText,
  buildMonthlySummaryPayload
} from '../../../../src/shared/utils/backend/monthlyLineSummary';

// buildMonthlySummaryPayload pulls from userUtils/getMongoCollection/creditCardStore — in JSON
// mode (the repo default when DATA_MODE isn't 'mongo') it reads real per-user JSON fixtures via
// getUserData(filename, userId). We isolate this test from repo fixture data entirely by mocking
// the two data-access seams the module imports, so the assertions are about monthlyLineSummary.js's
// own aggregation logic, not about what happens to be in src/backend/data/*.json today.
jest.mock('../../../../src/backend/data/userUtils.js', () => ({
  getUserData: jest.fn((filename, userId) => {
    if (filename === 'monthly_income.json') {
      return { '2024-01': { รวม: 50000, salary: 50000 } };
    }
    if (filename === 'monthly_expense.json') {
      return { '2024-01': { ค่าเช่า: { actual: 8000, paid: true } } };
    }
    if (filename === 'savings.json') {
      return {
        '2024-01': {
          รวมเงินเก็บ: 5000,
          savings_list: [{ savings_type: 'กองทุนฉุกเฉิน', savings_amount: 2000 }]
        }
      };
    }
    if (filename === 'daily_expenses.json') {
      return { '2024-01': { totalMonthly: 3000 } };
    }
    if (filename === 'tax_accumulated.json') {
      return { 2024: { accumulated_tax: 1200 } };
    }
    if (filename === 'savings-goals.json') {
      return { goals: [{ goalName: 'กองทุนฉุกเฉิน', targetAmount: 10000, status: 'active' }] };
    }
    return {};
  })
}));

jest.mock('../../../../lib/dataSource', () => ({
  isJsonMode: () => true,
  getMongoCollection: jest.fn()
}));

jest.mock('../../../../src/shared/utils/backend/creditCardStore', () => ({
  getUserCreditData: jest.fn(async () => ({ cards: [], plans: [], cycles: [] }))
}));

jest.mock('../../../../src/shared/utils/backend/creditCardSync', () => ({
  buildInstallmentExpenseRows: jest.fn(() => ({})),
  buildRevolvingExpenseRows: jest.fn(() => ({}))
}));

describe('buildMonthlySummaryPayload (JSON mode, mocked data seams)', () => {
  it('aggregates income/expense/savings/tax/goals into the shared model + goal summary', async () => {
    const payload = await buildMonthlySummaryPayload('u001', '2024-01');

    expect(payload.model.totalIncome).toBe(50000);
    expect(payload.model.generalExpense).toBe(8000);
    expect(payload.model.dailyExpense).toBe(3000);
    expect(payload.model.savings).toBe(5000);
    expect(payload.taxAccumulated).toBe(1200);

    // Goal: target 10000, current summed from savings_list matching goal name case-insensitively = 2000
    expect(payload.goals).toEqual([
      { name: 'กองทุนฉุกเฉิน', current: 2000, target: 10000, remaining: 8000 }
    ]);
  });

  it('excludes goals with status abandoned/completed', async () => {
    const userUtils = require('../../../../src/backend/data/userUtils.js');
    userUtils.getUserData.mockImplementation((filename) => {
      if (filename === 'savings-goals.json') {
        return {
          goals: [
            { goalName: 'ปิดแล้ว', targetAmount: 1000, status: 'completed' },
            { goalName: 'ยกเลิก', targetAmount: 1000, status: 'abandoned' }
          ]
        };
      }
      return {};
    });

    const payload = await buildMonthlySummaryPayload('u001', '2024-02');
    expect(payload.goals).toEqual([]);
  });
});

describe('formatMonthlySummaryText', () => {
  const payload = {
    model: {
      netCashFlow: 12345.5,
      totalIncome: 50000,
      generalExpense: 8000,
      dailyExpense: 3000,
      savings: 5000,
      creditCard: 1500
    },
    taxAccumulated: 1200,
    goals: [{ name: 'กองทุนฉุกเฉิน', current: 2000, target: 10000, remaining: 8000 }]
  };

  it('includes every required summary line for a positive net cash flow', () => {
    const text = formatMonthlySummaryText('ม.ค. 2567', payload);
    expect(text).toContain('สรุปการเงินประจำเดือน ม.ค. 2567');
    expect(text).toContain('กระแสเงินสดสุทธิ: +12,345.50 บาท');
    expect(text).toContain('รายรับ: 50,000.00 บาท');
    expect(text).toContain('รายจ่ายทั่วไป: 8,000.00 บาท');
    expect(text).toContain('รายจ่ายประจำวัน: 3,000.00 บาท');
    expect(text).toContain('เงินออม: 5,000.00 บาท');
    expect(text).toContain('บัตรเครดิต: 1,500.00 บาท');
    expect(text).toContain('ภาษีสะสม: 1,200.00 บาท');
    expect(text).toContain('กองทุนฉุกเฉิน: คงเหลือ 8,000.00 บาท');
  });

  it('renders a negative sign for a negative net cash flow', () => {
    const text = formatMonthlySummaryText('ม.ค. 2567', { ...payload, model: { ...payload.model, netCashFlow: -500 } });
    expect(text).toContain('กระแสเงินสดสุทธิ: -500.00 บาท');
  });

  it('falls back to a no-goals message when there are no active goals', () => {
    const text = formatMonthlySummaryText('ม.ค. 2567', { ...payload, goals: [] });
    expect(text).toContain('ยังไม่มีเป้าหมายเงินออม');
  });
});

describe('buildMonthlySummaryFlex', () => {
  const payload = {
    model: {
      netCashFlow: 500,
      totalIncome: 50000,
      generalExpense: 8000,
      dailyExpense: 3000,
      savings: 5000,
      creditCard: 1500
    },
    taxAccumulated: 1200,
    goals: [{ name: 'กองทุนฉุกเฉิน', current: 2000, target: 10000, remaining: 8000 }]
  };

  it('produces a valid LINE Flex bubble shape', () => {
    const flex = buildMonthlySummaryFlex('ม.ค. 2567', payload);
    expect(flex.type).toBe('bubble');
    expect(flex.body.type).toBe('box');
    expect(Array.isArray(flex.body.contents)).toBe(true);
    // Footer has a button that deep-links back into the app.
    expect(flex.footer.contents[0].action.type).toBe('uri');
  });

  it('shows a placeholder box when there are no active goals', () => {
    const flex = buildMonthlySummaryFlex('ม.ค. 2567', { ...payload, goals: [] });
    const flattened = JSON.stringify(flex);
    expect(flattened).toContain('ยังไม่มีเป้าหมายเงินออมที่กำลังดำเนินการ');
  });
});
