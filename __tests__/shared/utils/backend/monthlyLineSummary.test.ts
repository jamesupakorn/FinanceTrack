/** @jest-environment node */
// Pure-logic tests for monthlyLineSummary.ts formatters, plus a JSON-mode payload-building
// happy path. Does not touch the network — no LINE call happens anywhere in this file.
import {
  buildMonthlySummaryFlex,
  formatMonthlySummaryText,
  buildMonthlySummaryPayload
} from '../../../../src/shared/utils/backend/monthlyLineSummary';
import {
  LINE_THEME,
  textComponent,
  valueRow,
  mutedLine,
  separator,
  tintBox,
  ctaButton
} from '../../../../src/shared/utils/backend/lineFlexTheme';
import { getUserCreditData } from '../../../../src/shared/utils/backend/creditCardStore';
import { buildCardTotalExpenseRows } from '../../../../src/shared/utils/backend/creditCardSync';

// buildMonthlySummaryPayload pulls from userUtils/getMongoCollection/creditCardStore — in JSON
// mode (the repo default when DATA_MODE isn't 'mongo') it reads real per-user JSON fixtures via
// getUserData(filename, userId). We isolate this test from repo fixture data entirely by mocking
// the two data-access seams the module imports, so the assertions are about monthlyLineSummary.ts's
// own aggregation logic, not about what happens to be in src/backend/data/*.json today.
jest.mock('../../../../src/backend/data/userUtils', () => ({
  getUserData: jest.fn((filename: string, userId: string) => {
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
  // spec-credit-card-spend R1: the LINE summary now reads only the card-total builder
  buildCardTotalExpenseRows: jest.fn(() => ({}))
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
      { name: 'กองทุนฉุกเฉิน', current: 2000, target: 10000, remaining: 8000, progress: 20 }
    ]);
  });

  it('excludes goals with status abandoned/completed', async () => {
    const userUtils = require('../../../../src/backend/data/userUtils');
    userUtils.getUserData.mockImplementation((filename: string) => {
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

  it('AC-S18 uses the real card-total builder and counts installments plus full revolving once after minimum pay', async () => {
      const realSync = jest.requireActual<typeof import('../../../../src/shared/utils/backend/creditCardSync')>('../../../../src/shared/utils/backend/creditCardSync');
      const mockedBuilder = jest.mocked(buildCardTotalExpenseRows);
      mockedBuilder.mockImplementation(realSync.buildCardTotalExpenseRows);
      jest.mocked(getUserCreditData).mockResolvedValueOnce({
        cards: [{ id: 'cc_000000000001', name: 'บัตร A', annualRate: 0, minPaymentPercent: 10, statementDay: 10, dueDay: 20 }],
        plans: [{ id: 'ip_000000000001', cardId: 'cc_000000000001', itemName: 'สินค้า', months: 1, status: 'ongoing', schedule: [{ no: 1, dueMonth: '2024-01', payment: 300, paid: true }] }],
        cycles: [{ cardId: 'cc_000000000001', month: '2024-01', newSpend: 1000, paymentAction: 'minimum' }],
        spendItems: [], updatedAt: null
      });
      const payload = await buildMonthlySummaryPayload('u001', '2024-01');
      expect(payload.model.creditCard).toBe(1300);
      expect(payload.model.creditCardInstallment).toBe(300);
      expect(payload.model.creditCardRevolving).toBe(1000);
      mockedBuilder.mockImplementation(() => ({}));
  });

  it('preserves legacy savings labels and comma-formatted amounts across months', async () => {
    const userUtils = require('../../../../src/backend/data/userUtils');
    userUtils.getUserData.mockImplementation((filename: string) => {
      if (filename === 'savings-goals.json') {
        return { goals: [{ goalName: ' Emergency ', targetAmount: '2000', status: 'active' }] };
      }
      if (filename === 'savings.json') {
        return {
          '2024-01': { savings_list: [{ รายการ: 'emergency', จำนวนเงิน: '1,200.50' }] },
          '2024-02': { savings_list: [{ savings_type: 'EMERGENCY', savings_amount: 300 }] }
        };
      }
      return {};
    });

    const payload = await buildMonthlySummaryPayload('u001', '2024-02');
    expect(payload.goals).toEqual([{
      name: ' Emergency ',
      current: 1500.5,
      target: 2000,
      remaining: 499.5,
      progress: 75.03
    }]);
  });

  // S4: getGoalSummary's own calculator (independent of computeCurrentAmounts) must include a
  // goal's embedded adjustments[] in current/remaining/progress, same as the app side (S1).
  it('S4 adds a goal\'s adjustments[] sum into current/remaining/progress', async () => {
    const userUtils = require('../../../../src/backend/data/userUtils');
    userUtils.getUserData.mockImplementation((filename: string) => {
      if (filename === 'savings-goals.json') {
        return {
          goals: [{
            goalName: 'กองทุนฉุกเฉิน',
            targetAmount: 10000,
            status: 'active',
            adjustments: [
              { _id: 'a1', amount: 500, note: '', createdAt: '', updatedAt: '' },
              { _id: 'a2', amount: 300, note: '', createdAt: '', updatedAt: '' }
            ]
          }]
        };
      }
      if (filename === 'savings.json') {
        return {
          '2024-01': {
            รวมเงินเก็บ: 5000,
            savings_list: [{ savings_type: 'กองทุนฉุกเฉิน', savings_amount: 2000 }]
          }
        };
      }
      return {};
    });

    const payload = await buildMonthlySummaryPayload('u001', '2024-01');

    // savings-matched 2000 + adjustment sum 800 = 2800
    expect(payload.goals).toEqual([
      { name: 'กองทุนฉุกเฉิน', current: 2800, target: 10000, remaining: 7200, progress: 28 }
    ]);
  });
});

describe('LINE Flex theme primitives', () => {
  it('preserves text defaults, empty-value handling and weight mapping', () => {
    expect(textComponent(null)).toEqual({
      type: 'text', text: ' ', size: 'sm', color: LINE_THEME.textPrimary,
      weight: 'regular', flex: 1, wrap: true
    });
    expect(textComponent(0).text).toBe(' ');
    expect(textComponent('Amount', 'xl', LINE_THEME.danger, '700')).toEqual({
      type: 'text', text: 'Amount', size: 'xl', color: LINE_THEME.danger,
      weight: 'bold', flex: 1, wrap: true
    });
    expect(mutedLine('Note')).toEqual(textComponent('Note', 'xs', LINE_THEME.textSecondary));
  });

  it('keeps value rows and tint boxes in their original payload shape', () => {
    const row = valueRow('Icon', 'Label', '1,234.50', LINE_THEME.warning);
    expect(row).toEqual({
      type: 'box', layout: 'horizontal', spacing: 'sm', margin: 'md', alignItems: 'center',
      contents: [
        textComponent('Icon', 'sm', LINE_THEME.warning, '700'),
        textComponent('Label', 'sm', LINE_THEME.textSecondary),
        textComponent('1,234.50', 'sm', LINE_THEME.textPrimary, '700')
      ]
    });
    const contents = [row, separator()];
    expect(tintBox(LINE_THEME.tintNeutral, contents)).toEqual({
      type: 'box', layout: 'vertical', margin: 'xl', paddingAll: 'lg',
      backgroundColor: LINE_THEME.tintNeutral, cornerRadius: 'md', contents
    });
    expect(separator('lg')).toEqual({ type: 'separator', margin: 'lg', color: LINE_THEME.separator });
  });

  it('keeps the URI action and brand color on CTA buttons', () => {
    expect(ctaButton('Open', 'https://example.com')).toEqual({
      type: 'button', style: 'primary', color: LINE_THEME.brand,
      action: { type: 'uri', label: 'Open', uri: 'https://example.com' }
    });
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
    expect(text).toContain('บัตร & สินเชื่อ: 1,500.00 บาท');
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

  // S4-C-2: a negative current (driven by adjustments) must clamp only the displayed percent to
  // 0 — the underlying SummaryGoal.progress value itself stays negative (unclamped model).
  it('clamps a negative progress percent to 0 in the rendered text, not in the model', () => {
    const negativeGoal = { name: 'กองทุนฉุกเฉิน', current: -2000, target: 10000, remaining: 12000, progress: -20 };
    const text = formatMonthlySummaryText('ม.ค. 2567', { ...payload, goals: [negativeGoal] });
    expect(text).toContain('ถึงเป้าแล้ว 0%');
    expect(text).not.toContain('-20%');
    expect(negativeGoal.progress).toBe(-20);
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

  // S4-C-2: same render-only clamp as formatMonthlySummaryText, applied to the Flex goalContents
  // text node instead of the plain-text string.
  it('clamps a negative progress percent to 0 in the Flex text node, not in the model', () => {
    const negativeGoal = { name: 'กองทุนฉุกเฉิน', current: -2000, target: 10000, remaining: 12000, progress: -20 };
    const flex = buildMonthlySummaryFlex('ม.ค. 2567', { ...payload, goals: [negativeGoal] });
    const flattened = JSON.stringify(flex);
    expect(flattened).toContain('ถึงเป้าแล้ว 0%');
    expect(flattened).not.toContain('-20%');
    expect(negativeGoal.progress).toBe(-20);
  });
});

describe('buildMonthlySummaryPayload — comparison & upcoming (AC-7/AC-9)', () => {
  it('diffs against the previous month and lists next-month dues across the Dec→Jan boundary', async () => {
    const userUtils = require('../../../../src/backend/data/userUtils');
    userUtils.getUserData.mockImplementation((filename: string) => {
      if (filename === 'monthly_income.json') {
        return { '2024-11': { รวม: 40000, salary: 40000 }, '2024-12': { รวม: 50000, salary: 50000 } };
      }
      if (filename === 'monthly_expense.json') {
        return {
          '2024-11': { ค่าเช่า: { actual: 8000, paid: true } },
          '2024-12': { ค่าเช่า: { actual: 10000, paid: true } },
          '2025-01': { ค่าเช่า: { actual: 10000, dueDay: 5 } }
        };
      }
      return {};
    });

    const payload = await buildMonthlySummaryPayload('u001', '2024-12');

    expect(payload.comparison.income).toMatchObject({ current: 50000, previous: 40000, percent: 25 });
    expect(payload.comparison.expense).toMatchObject({ current: 10000, previous: 8000, percent: 25 });
    expect(payload.upcoming).not.toBeNull();
    if (payload.upcoming === null) throw new Error('Expected upcoming dues for next month');
    expect(payload.upcoming.monthKey).toBe('2025-01');
    // UpcomingDue gained an ISO dueDate (cross-month-due); the day is unchanged
    expect(payload.upcoming.items).toEqual([{ name: 'ค่าเช่า', amount: 10000, day: 5, dueDate: '2025-01-05' }]);
  });

  // DP-AC-12 (cash basis): a cycle whose due date falls in the next month (dueDay <= statementDay) is
  // counted in the DUE month's LINE summary, not in the cycle month's.
  it('DP-AC-12 counts a cross-month card cycle in its due month only', async () => {
    const userUtils = require('../../../../src/backend/data/userUtils');
    userUtils.getUserData.mockImplementation((filename: string) => {
      if (filename === 'monthly_income.json') {
        return { '2026-10': { รวม: 50000, salary: 50000 }, '2026-11': { รวม: 50000, salary: 50000 } };
      }
      return {};
    });
    const realSync = jest.requireActual<typeof import('../../../../src/shared/utils/backend/creditCardSync')>('../../../../src/shared/utils/backend/creditCardSync');
    const mockedBuilder = jest.mocked(buildCardTotalExpenseRows);
    mockedBuilder.mockImplementation(realSync.buildCardTotalExpenseRows);
    jest.mocked(getUserCreditData).mockResolvedValue({
      cards: [{ id: 'cc_000000000001', name: 'Shopee SPayLater', annualRate: 0, minPaymentPercent: 10, statementDay: 25, dueDay: 10 }],
      plans: [],
      cycles: [{ cardId: 'cc_000000000001', month: '2026-10', newSpend: 1500 }],
      spendItems: [], updatedAt: null
    });
    try {
      const october = await buildMonthlySummaryPayload('u001', '2026-10');
      const november = await buildMonthlySummaryPayload('u001', '2026-11');
      expect(october.model.creditCard).toBe(0);
      expect(november.model.creditCard).toBe(1500);
    } finally {
      mockedBuilder.mockImplementation(() => ({}));
      jest.mocked(getUserCreditData).mockResolvedValue({ cards: [], plans: [], cycles: [], spendItems: [], updatedAt: null });
    }
  });

  it('marks comparison as noPrevious when the previous month has no documents', async () => {
    const userUtils = require('../../../../src/backend/data/userUtils');
    userUtils.getUserData.mockImplementation((filename: string) =>
      filename === 'monthly_income.json' ? { '2024-12': { รวม: 50000, salary: 50000 } } : {});

    const payload = await buildMonthlySummaryPayload('u001', '2024-12');
    expect(payload.comparison.income.state).toBe('noPrevious');
    expect(payload.upcoming).toBeNull();
  });
});

// Stage 4 (tester) — S4 end-to-end: drive adjustments through buildMonthlySummaryPayload (not a
// hand-built SummaryGoal) so the model value and both render sites are checked from one source.
describe('S4 adjustments — end-to-end through getGoalSummary and both renderers', () => {
  const userUtils = require('../../../../src/backend/data/userUtils');
  const mockGoals = (goals: unknown[], savingsAmount = 2000) => {
    userUtils.getUserData.mockImplementation((filename: string) => {
      if (filename === 'savings-goals.json') return { goals };
      if (filename === 'savings.json') {
        return { '2024-01': { savings_list: [{ savings_type: 'กองทุนฉุกเฉิน', savings_amount: savingsAmount }] } };
      }
      return {};
    });
  };
  const adj = (id: string, amount: number, note = '') => ({ _id: id, amount, note, createdAt: '', updatedAt: '' });

  it('negative adjustments drive current/progress negative in the model; renders clamp % only, money keeps its sign', async () => {
    mockGoals([{ goalName: 'กองทุนฉุกเฉิน', targetAmount: 10000, status: 'active', adjustments: [adj('a1', -4000)] }]);
    const payload = await buildMonthlySummaryPayload('u001', '2024-01');

    // model: 2000 - 4000 = -2000 → progress -20 (unclamped), remaining 12000 (> target, legitimate)
    expect(payload.goals).toEqual([
      { name: 'กองทุนฉุกเฉิน', current: -2000, target: 10000, remaining: 12000, progress: -20 }
    ]);

    const text = formatMonthlySummaryText('ม.ค. 2567', payload);
    const flex = JSON.stringify(buildMonthlySummaryFlex('ม.ค. 2567', payload));
    expect(text).toContain('(ถึงเป้าแล้ว 0%)');
    expect(text).not.toContain('-20%');
    expect(flex).toContain('ถึงเป้าแล้ว 0%');
    expect(flex).not.toContain('-20%');
    // money figure is not clamped: negative current renders with its sign in the Flex value row
    expect(flex).toContain('-2,000.00');
    expect(text).toContain('คงเหลือ 12,000.00 บาท');
    // render calls did not mutate the model
    expect(payload.goals[0].progress).toBe(-20);
    expect(payload.goals[0].current).toBe(-2000);
  });

  it('mixed-sign adjustments net out and the sum is rounded to 2dp (0.1 + 0.2)', async () => {
    mockGoals([{ goalName: 'กองทุนฉุกเฉิน', targetAmount: 10000, status: 'active',
      adjustments: [adj('a1', 0.1), adj('a2', 0.2), adj('a3', 1000), adj('a4', -500)] }]);
    const payload = await buildMonthlySummaryPayload('u001', '2024-01');
    expect(payload.goals[0].current).toBe(2500.3);
    expect(payload.goals[0].remaining).toBe(7499.7);
    expect(payload.goals[0].progress).toBe(25);
  });

  it('positive adjustments past target cap progress at 100 and remaining at 0 (existing clamps)', async () => {
    mockGoals([{ goalName: 'กองทุนฉุกเฉิน', targetAmount: 10000, status: 'active', adjustments: [adj('a1', 9000)] }]);
    const payload = await buildMonthlySummaryPayload('u001', '2024-01');
    expect(payload.goals[0]).toEqual({ name: 'กองทุนฉุกเฉิน', current: 11000, target: 10000, remaining: 0, progress: 100 });
    expect(formatMonthlySummaryText('ม.ค. 2567', payload)).toContain('(ถึงเป้าแล้ว 100%)');
  });

  it('malformed / non-array adjustments are ignored (legacy-identical output)', async () => {
    for (const adjustments of [null, 'oops', { amount: 500 }, [{ amount: 500 }, { _id: 'x', amount: 'NaN', note: '' }, { _id: 'z', amount: 0, note: '' }]]) {
      mockGoals([{ goalName: 'กองทุนฉุกเฉิน', targetAmount: 10000, status: 'active', adjustments }]);
      const payload = await buildMonthlySummaryPayload('u001', '2024-01');
      expect(payload.goals).toEqual([
        { name: 'กองทุนฉุกเฉิน', current: 2000, target: 10000, remaining: 8000, progress: 20 }
      ]);
    }
  });

  it('adjustment-only goal (no matching savings) and target 0 → progress 0, no NaN', async () => {
    mockGoals([{ goalName: 'ไม่มีออม', targetAmount: 0, status: 'active', adjustments: [adj('a1', 750)] }]);
    const payload = await buildMonthlySummaryPayload('u001', '2024-01');
    expect(payload.goals).toEqual([{ name: 'ไม่มีออม', current: 750, target: 0, remaining: 0, progress: 0 }]);
  });

  it('adjustments on completed/abandoned goals do not surface (status filter unchanged)', async () => {
    mockGoals([
      { goalName: 'กองทุนฉุกเฉิน', targetAmount: 10000, status: 'completed', adjustments: [adj('a1', 100)] },
      { goalName: 'เที่ยว', targetAmount: 5000, status: 'abandoned', adjustments: [adj('a2', 100)] }
    ]);
    const payload = await buildMonthlySummaryPayload('u001', '2024-01');
    expect(payload.goals).toEqual([]);
  });

  it('adjustment note text never appears in LINE output (privacy / out-of-scope)', async () => {
    const secret = 'NOTE_SHOULD_NOT_LEAK_123';
    mockGoals([{ goalName: 'กองทุนฉุกเฉิน', targetAmount: 10000, status: 'active', adjustments: [adj('a1', 100, secret)] }]);
    const payload = await buildMonthlySummaryPayload('u001', '2024-01');
    expect(JSON.stringify(payload.goals)).not.toContain(secret);
    expect(formatMonthlySummaryText('ม.ค. 2567', payload)).not.toContain(secret);
    expect(JSON.stringify(buildMonthlySummaryFlex('ม.ค. 2567', payload))).not.toContain(secret);
  });
});
