/** @jest-environment node */
// ทดสอบ logic ล้วน — mock data seams ของ monthlyLineSummary เหมือน monthlyLineSummary.test.js
jest.mock('../../../../src/backend/data/userUtils.js', () => ({ getUserData: jest.fn(() => ({})) }));
jest.mock('../../../../lib/dataSource', () => ({ isJsonMode: () => true, getMongoCollection: jest.fn() }));
jest.mock('../../../../src/shared/utils/backend/creditCardStore', () => ({ getUserCreditData: jest.fn(async () => ({})) }));
jest.mock('../../../../src/shared/utils/backend/creditCardSync', () => ({
  buildInstallmentExpenseRows: jest.fn(() => ({})),
  buildRevolvingExpenseRows: jest.fn(() => ({}))
}));

import {
  computeDelta,
  formatDeltaLabel,
  computeGoalProgress,
  buildUpcomingDues,
  getPrevMonthKey,
  getNextMonthKey
} from '../../../../src/shared/utils/backend/monthlySummaryContent';
import {
  buildMonthlySummaryFlex,
  formatMonthlySummaryText
} from '../../../../src/shared/utils/backend/monthlyLineSummary';

describe('computeDelta / formatDeltaLabel (AC-7)', () => {
  it('signed percent for a normal change', () => {
    const up = computeDelta(112, 100, true);
    expect(up).toMatchObject({ percent: 12, state: 'change' });
    expect(formatDeltaLabel(up)).toBe('เทียบเดือนที่แล้ว +12%');
    expect(formatDeltaLabel(computeDelta(80, 100, true))).toBe('เทียบเดือนที่แล้ว -20%');
  });
  it('no previous document → explicit state, no percent', () => {
    const d = computeDelta(500, 0, false);
    expect(d.percent).toBeNull();
    expect(formatDeltaLabel(d)).toBe('ไม่มีข้อมูลเดือนที่แล้ว');
  });
  it('previous 0 and current > 0 → "ใหม่", never Infinity', () => {
    const d = computeDelta(500, 0, true);
    expect(d.state).toBe('new');
    expect(formatDeltaLabel(d)).not.toMatch(/Infinity|NaN/);
  });
  it('both 0 → 0%, never NaN', () => {
    expect(formatDeltaLabel(computeDelta(0, 0, true))).toBe('เทียบเดือนที่แล้ว 0%');
    expect(formatDeltaLabel(computeDelta(NaN, 0, true))).not.toMatch(/NaN/);
  });
});

describe('computeGoalProgress (AC-8)', () => {
  it('matches savings-goals formula: 2dp and clamped to 100', () => {
    expect(computeGoalProgress(2000, 10000)).toBe(20);
    expect(computeGoalProgress(1, 3)).toBe(33.33);
    expect(computeGoalProgress(20000, 10000)).toBe(100);
  });
  it('target <= 0 → 0 without dividing by zero', () => {
    expect(computeGoalProgress(500, 0)).toBe(0);
    expect(computeGoalProgress(500, -1)).toBe(0);
  });
});

describe('month keys', () => {
  it('rolls over the year boundary', () => {
    expect(getNextMonthKey('2024-12')).toBe('2025-01');
    expect(getPrevMonthKey('2025-01')).toBe('2024-12');
    expect(getNextMonthKey('2024-01')).toBe('2024-02');
  });
});

describe('buildUpcomingDues (AC-9)', () => {
  const doc = {
    ค่าเน็ต: { actual: 600, dueDay: 25 },
    ค่าเช่า: { actual: 8000, dueDay: 5 },
    ประกัน: { actual: 1200, dueDay: 'EOM' },
    จ่ายแล้ว: { actual: 999, dueDay: 1, paid: true },
    ศูนย์: { actual: 0, dueDay: 2 },
    ไม่มีวัน: { actual: 100 },
    month: '2025-02',
    userId: 'u1'
  };

  it('sorts by due day, skips paid/zero/no-day items, resolves EOM for that month', () => {
    const result = buildUpcomingDues(doc, '2025-02');
    expect(result.items.map(i => [i.name, i.day])).toEqual([
      ['ค่าเช่า', 5], ['ค่าเน็ต', 25], ['ประกัน', 28]
    ]);
    expect(result.extraCount).toBe(0);
  });
  it('EOM in a leap February resolves to 29', () => {
    expect(buildUpcomingDues({ a: { actual: 1, dueDay: 'EOM' } }, '2024-02').items[0].day).toBe(29);
  });
  it('caps at 5 with an overflow count', () => {
    const many = {};
    for (let i = 1; i <= 8; i += 1) many[`r${i}`] = { actual: 10, dueDay: i };
    const result = buildUpcomingDues(many, '2025-03');
    expect(result.items).toHaveLength(5);
    expect(result.extraCount).toBe(3);
  });
  it('December → January year rollover uses January day count', () => {
    const result = buildUpcomingDues({ a: { actual: 1, dueDay: 31 } }, getNextMonthKey('2024-12'));
    expect(result.monthKey).toBe('2025-01');
    expect(result.items[0].day).toBe(31);
  });
  it('returns null (section omitted) when there is no document or nothing due', () => {
    expect(buildUpcomingDues(null, '2025-02')).toBeNull();
    expect(buildUpcomingDues({ a: { actual: 5, paid: true, dueDay: 3 } }, '2025-02')).toBeNull();
  });
});

describe('Flex / text parity (AC-10)', () => {
  const payload = {
    model: { netCashFlow: 1000, totalIncome: 50000, generalExpense: 8000, dailyExpense: 3000, savings: 5000, creditCard: 1500 },
    taxAccumulated: 0,
    goals: [{ name: 'ฉุกเฉิน', current: 2000, target: 10000, remaining: 8000, progress: 20 }],
    comparison: {
      income: computeDelta(50000, 40000, true),
      expense: computeDelta(12500, 10000, true),
      savings: computeDelta(5000, 0, false)
    },
    upcoming: buildUpcomingDues({ ค่าเช่า: { actual: 8000, dueDay: 5 } }, '2025-02')
  };
  const flexText = JSON.stringify(buildMonthlySummaryFlex('ม.ค. 2568', payload));
  const text = formatMonthlySummaryText('ม.ค. 2568', payload);

  it.each([
    'เทียบเดือนที่แล้ว +25%',
    'ไม่มีข้อมูลเดือนที่แล้ว',
    'ถึงเป้าแล้ว 20%',
    'ต้องจ่ายเดือนหน้า',
    'ค่าเช่า'
  ])('both formats contain "%s"', (needle) => {
    expect(flexText).toContain(needle);
    expect(text).toContain(needle);
  });

  it('omits the upcoming section when there is none', () => {
    const none = { ...payload, upcoming: null };
    expect(formatMonthlySummaryText('x', none)).not.toContain('ต้องจ่ายเดือนหน้า');
    expect(JSON.stringify(buildMonthlySummaryFlex('x', none))).not.toContain('ต้องจ่ายเดือนหน้า');
  });
});
