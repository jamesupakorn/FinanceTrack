import { fireEvent, render, screen, within } from '@testing-library/react';
import CreditCardDashboard from '../../src/frontend/components/CreditCardDashboard';
import { END_OF_MONTH_DUE_DAY } from '../../src/shared/utils/dateUtils';

type TestCard = {
  id: string;
  name: string;
  dueDay: number | string;
  remainingPayable: number;
  availableCredit: number;
  revolvingDue?: number;
  revolvingTotalDue?: number;
  revolvingDueMonth?: string | null;
  statementDay?: number | string;
  payableRevolvingDue?: number;
  payableRevolvingMonth?: string | null;
};

type TestPlan = {
  id: string;
  cardId: string;
  itemName: string;
  months: number;
  status: 'ongoing';
  schedule: Array<{ no: number; dueMonth: string; payment: number; paid?: boolean }>;
};

const makeCard = (
  id: string,
  name = 'บัตรทดสอบ',
  dueDay: number | string = 29,
  fields: Partial<TestCard> = {}
): TestCard => ({
  id,
  name,
  // same-month default (statementDay < dueDay) per spec-credit-card-cross-month-due.md §Test fallout rule
  statementDay: 1,
  dueDay,
  remainingPayable: 0,
  availableCredit: 10000,
  ...fields
});

const makePlan = (
  id: string,
  cardId: string,
  rows: Array<{ dueMonth: string; payment: number; paid?: boolean }>
): TestPlan => ({
  id,
  cardId,
  itemName: 'รายการทดสอบ',
  months: rows.length,
  status: 'ongoing',
  schedule: rows.map((row, index) => ({ no: index + 1, ...row }))
});

const renderDashboard = (
  cards: TestCard[],
  plans: TestPlan[] = [],
  props: Partial<React.ComponentProps<typeof CreditCardDashboard>> = {}
) => render(
  <CreditCardDashboard
    cards={cards}
    plans={plans}
    totals={{ remainingPayable: 0, availableCredit: 10000, creditLimit: 10000, ongoingPlanCount: plans.length, cardCount: cards.length }}
    {...props}
  />
);

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 9, 29, 12, 0, 0) });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('CreditCardDashboard upcoming groups', () => {
  it('aggregates all installment entries per card/date, preserves distinct card ids, and keeps the 1,504.33 subtotal', () => {
    const firstCard = makeCard('cc_a', 'บัตรชื่อซ้ำ');
    const secondCard = makeCard('cc_b', 'บัตรชื่อซ้ำ');
    const firstFive = [143.2, 25.6, 236.33, 210.8, 888.4].map(payment => ({
      dueMonth: '2026-10',
      payment
    }));
    const onOpenCard = jest.fn();
    renderDashboard(
      [firstCard, secondCard],
      [
        makePlan('plan_a', firstCard.id, firstFive),
        makePlan('plan_b', secondCard.id, [{ dueMonth: '2026-10', payment: 12.34 }])
      ],
      { onOpenCard }
    );

    const list = screen.getByRole('list', { name: 'รายการบัตรเครดิตที่ครบกำหนดเร็ว ๆ นี้' });
    const groups = within(list).getAllByRole('listitem');
    expect(groups).toHaveLength(2);
    expect(within(groups[0]).getByText('ผ่อนชำระ 5 งวด · 1,504.33 บาท')).toBeInTheDocument();
    expect(within(groups[0]).getByText('1,504.33 บาท')).toBeInTheDocument();
    expect(within(groups[1]).getByText('ผ่อนชำระ 1 งวด · 12.34 บาท')).toBeInTheDocument();

    const detailButtons = within(list).getAllByRole('button', { name: /ดูรายละเอียดบัตร บัตรชื่อซ้ำ/ });
    expect(detailButtons[0]).toHaveAccessibleName(/cc_a/);
    expect(detailButtons[1]).toHaveAccessibleName(/cc_b/);
    fireEvent.click(within(groups[0]).getByRole('button', { name: /ดูรายละเอียดบัตร บัตรชื่อซ้ำ/ }));
    expect(onOpenCard).toHaveBeenCalledWith(firstCard.id);
    expect(within(groups[0]).queryByRole('button', { name: /ชำระ|ยืนยันการชำระ/ })).not.toBeInTheDocument();
  });

  it('combines same-card installments and the selected revolving due once while keeping another date separate', () => {
    const card = makeCard('cc_mix', 'บัตรรวมยอด', 5, {
      revolvingDue: 700,
      revolvingDueMonth: '2026-11'
    });
    renderDashboard(
      [card],
      [makePlan('plan_mix', card.id, [
        { dueMonth: '2026-10', payment: 100 },
        { dueMonth: '2026-11', payment: 300 }
      ])]
    );

    const list = screen.getByRole('list', { name: 'รายการบัตรเครดิตที่ครบกำหนดเร็ว ๆ นี้' });
    const groups = within(list).getAllByRole('listitem');
    expect(groups).toHaveLength(2);
    expect(within(groups[0]).getByText('100.00 บาท')).toBeInTheDocument();
    expect(within(groups[1]).getByText('ผ่อนชำระ 1 งวด · 300.00 บาท')).toBeInTheDocument();
    expect(within(groups[1]).getByText('ยอดหมุนเวียน · 700.00 บาท')).toBeInTheDocument();
    expect(within(groups[1]).getByText('1,000.00 บาท')).toBeInTheDocument();
  });

  it('excludes zero, credit, and confirmed revolving amounts without offsetting unpaid installments', () => {
    const zeroCard = makeCard('cc_zero', 'บัตรจ่ายขั้นต่ำแล้ว', 29, {
      revolvingDue: 0,
      revolvingTotalDue: 700,
      revolvingDueMonth: '2026-10'
    });
    const creditCard = makeCard('cc_credit', 'บัตรเครดิตคงเหลือ', 29, {
      revolvingDue: -50,
      revolvingDueMonth: '2026-10'
    });
    renderDashboard(
      [zeroCard, creditCard],
      [makePlan('plan_zero', zeroCard.id, [{ dueMonth: '2026-10', payment: 300 }])]
    );

    const list = screen.getByRole('list', { name: 'รายการบัตรเครดิตที่ครบกำหนดเร็ว ๆ นี้' });
    const groups = within(list).getAllByRole('listitem');
    expect(groups).toHaveLength(1);
    expect(within(groups[0]).getByText('ผ่อนชำระ 1 งวด · 300.00 บาท')).toBeInTheDocument();
    expect(within(groups[0]).getByText('300.00 บาท')).toBeInTheDocument();
    expect(screen.queryByText(/ยอดหมุนเวียน/)).not.toBeInTheDocument();
  });

  it('includes overdue, today, and inclusive today-plus-seven obligations, but excludes plus-eight', () => {
    const cases = [
      { card: makeCard('cc_overdue', 'เกินกำหนด', 10), dueMonth: '2026-10', payment: 10 },
      { card: makeCard('cc_today', 'ครบวันนี้', 29), dueMonth: '2026-10', payment: 29 },
      { card: makeCard('cc_seven', 'อีกเจ็ดวัน', 5), dueMonth: '2026-11', payment: 5 },
      { card: makeCard('cc_eight', 'อีกแปดวัน', 6), dueMonth: '2026-11', payment: 6 }
    ];
    renderDashboard(
      cases.map(item => item.card),
      cases.map((item, index) => makePlan(`plan_${index}`, item.card.id, [{
        dueMonth: item.dueMonth,
        payment: item.payment
      }]))
    );

    const groups = within(screen.getByRole('list', { name: 'รายการบัตรเครดิตที่ครบกำหนดเร็ว ๆ นี้' })).getAllByRole('listitem');
    expect(groups).toHaveLength(3);
    expect(groups.map(group => group.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('เกินกำหนด'),
      expect.stringContaining('ครบวันนี้'),
      expect.stringContaining('อีกเจ็ดวัน')
    ]));
    expect(groups.every(group => !group.textContent?.includes('อีกแปดวัน'))).toBe(true);
  });

  it('limits disclosure to five groups while totals use all groups and distinct-card count', () => {
    const cardA = makeCard('cc_a', 'บัตรเอ', 10);
    const cardB = makeCard('cc_b', 'บัตรบี', 10);
    const plans = [
      makePlan('plan_jun', cardB.id, [{ dueMonth: '2026-06', payment: 600 }]),
      makePlan('plan_jul', cardA.id, [{ dueMonth: '2026-07', payment: 400 }]),
      makePlan('plan_aug', cardB.id, [{ dueMonth: '2026-08', payment: 300 }]),
      makePlan('plan_sep', cardA.id, [{ dueMonth: '2026-09', payment: 200 }]),
      makePlan('plan_oct_a', cardA.id, [{ dueMonth: '2026-10', payment: 100 }]),
      makePlan('plan_oct_b', cardB.id, [{ dueMonth: '2026-10', payment: 500 }])
    ];
    renderDashboard([cardB, cardA], plans);

    const list = screen.getByRole('list', { name: 'รายการบัตรเครดิตที่ครบกำหนดเร็ว ๆ นี้' });
    const toggle = screen.getByRole('button', { name: 'แสดงทั้งหมด (6 รายการ)' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByText('2,100.00').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/2 บัตร/).length).toBeGreaterThanOrEqual(2);

    fireEvent.click(toggle);
    expect(within(list).getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'แสดงน้อยลง' })).toHaveAttribute('aria-expanded', 'true');
    const expanded = within(list).getAllByRole('listitem');
    expect(expanded.map(group => group.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('บัตรเอ'),
      expect.stringContaining('บัตรบี')
    ]));
    expect(expanded.map(group => group.textContent?.match(/([\d,]+\.\d{2}) บาท/)?.[1])).toEqual([
      '600.00',
      '400.00',
      '300.00',
      '200.00',
      '100.00',
      '500.00'
    ]);
    expect(within(expanded[4]).getByText('100.00 บาท')).toBeInTheDocument();
    expect(within(expanded[5]).getByText('500.00 บาท')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'แสดงน้อยลง' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getAllByText('2,100.00').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/2 บัตร/).length).toBeGreaterThanOrEqual(2);
  });

  it('resolves end-of-month and leap-year installment dates with the existing due-day behavior', () => {
    jest.setSystemTime(new Date(2028, 2, 5, 12, 0, 0));
    const thirtyOne = makeCard('cc_day31', 'วันที่ 31', 31);
    const endOfMonth = makeCard('cc_eom', 'สิ้นเดือน', END_OF_MONTH_DUE_DAY);
    renderDashboard(
      [thirtyOne, endOfMonth],
      [
        makePlan('plan_31', thirtyOne.id, [{ dueMonth: '2028-02', payment: 31 }]),
        makePlan('plan_eom', endOfMonth.id, [{ dueMonth: '2028-02', payment: 29 }])
      ]
    );

    const groups = within(screen.getByRole('list', { name: 'รายการบัตรเครดิตที่ครบกำหนดเร็ว ๆ นี้' })).getAllByRole('listitem');
    expect(groups).toHaveLength(2);
    groups.forEach(group => expect(group.textContent).toContain('29 ก.พ. 2571'));
  });

  it.each([
    ['invalid selected month', { revolvingDueMonth: '2026-13', dueDay: 10 }],
    ['invalid due day', { revolvingDueMonth: '2026-10', dueDay: 99 }]
  ])('surfaces retryable error for a positive revolving obligation with %s', (_label, fields) => {
    const onRetry = jest.fn();
    const card = makeCard('cc_invalid', 'บัตรข้อมูลผิด', fields.dueDay, {
      revolvingDue: 500,
      revolvingDueMonth: fields.revolvingDueMonth
    });
    renderDashboard([card], [], { onRetry });

    expect(screen.getByRole('alert')).toHaveTextContent('ข้อมูลวันครบกำหนดของยอดหมุนเวียนบัตร บัตรข้อมูลผิด ไม่ถูกต้อง');
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('list', { name: 'รายการบัตรเครดิตที่ครบกำหนดเร็ว ๆ นี้' })).not.toBeInTheDocument();
  });

  it('renders loading, page error with retry, no-card, and no-upcoming states', () => {
    const { rerender } = render(<CreditCardDashboard loading />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('กำลังโหลดข้อมูลบัตรเครดิต')).toBeInTheDocument();

    const onRetry = jest.fn();
    rerender(<CreditCardDashboard error="โหลดข้อมูลไม่สำเร็จ" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('โหลดข้อมูลไม่สำเร็จ');
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    const onAddCard = jest.fn();
    rerender(<CreditCardDashboard onAddCard={onAddCard} />);
    expect(screen.getByText('ยังไม่มีบัตรเครดิต')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มบัตร' }));
    expect(onAddCard).toHaveBeenCalledTimes(1);

    rerender(<CreditCardDashboard cards={[makeCard('cc_no_due')]} />);
    expect(screen.getByText('ไม่มีรายการครบกำหนดใน 7 วันนี้ 🎉')).toBeInTheDocument();
  });
});

// spec-credit-card-cross-month-due.md AC-9 / AC-14 (R-2 override: replace, not add)
describe('CreditCardDashboard upcoming groups: cross-month cards', () => {
  const LIST = 'รายการบัตรเครดิตที่ครบกำหนดเร็ว ๆ นี้';
  const shopee = (fields: Partial<TestCard> = {}) => makeCard('cc_sp', 'Shopee SPayLater', 10, { statementDay: 'EOM', ...fields });

  it('AC-14: today 2026-11-05, unpaid Oct cycle listed on 10 Nov with payableRevolvingDue; Nov revolvingDue not added', () => {
    jest.setSystemTime(new Date(2026, 10, 5, 12, 0, 0));
    const card = shopee({ revolvingDue: 1500, revolvingDueMonth: '2026-11', payableRevolvingDue: 1200, payableRevolvingMonth: '2026-10' });
    renderDashboard([card], [makePlan('plan_sp', card.id, [{ dueMonth: '2026-10', payment: 250 }, { dueMonth: '2026-11', payment: 250 }])]);

    const groups = within(screen.getByRole('list', { name: LIST })).getAllByRole('listitem');
    expect(groups).toHaveLength(1);
    expect(groups[0].textContent).toContain('10 พ.ย. 2569');
    expect(within(groups[0]).getByText('ยอดหมุนเวียน · 1,200.00 บาท')).toBeInTheDocument();
    // AC-9: the Oct installment row is due 2026-11-10 too and lands in the same group
    expect(within(groups[0]).getByText('ผ่อนชำระ 1 งวด · 250.00 บาท')).toBeInTheDocument();
    expect(within(groups[0]).getByText('1,450.00 บาท')).toBeInTheDocument();
    expect(screen.queryByText(/1,500\.00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/2,700\.00/)).not.toBeInTheDocument();
  });

  it('AC-9: today 2026-10-29, the Shopee Oct installment is not shown as due 10 Oct (overdue) — it is due 10 Nov, outside 7 days', () => {
    const card = shopee();
    renderDashboard([card], [makePlan('plan_sp', card.id, [{ dueMonth: '2026-10', payment: 250 }])]);
    expect(screen.queryByRole('list', { name: LIST })).not.toBeInTheDocument();
    expect(screen.getByText('ไม่มีรายการครบกำหนดใน 7 วันนี้ 🎉')).toBeInTheDocument();
  });

  it('small dueDay (EOM/3, today 28 Nov): unpaid payable Oct entry replaces the Nov entry that is inside the window', () => {
    jest.setSystemTime(new Date(2026, 10, 28, 12, 0, 0));
    const card = makeCard('cc_small', 'บัตรวันที่ 3', 3, { statementDay: 'EOM', revolvingDue: 1500, revolvingDueMonth: '2026-11', payableRevolvingDue: 1200, payableRevolvingMonth: '2026-10' });
    renderDashboard([card]);
    const groups = within(screen.getByRole('list', { name: LIST })).getAllByRole('listitem');
    expect(groups).toHaveLength(1);
    expect(groups[0].textContent).toContain('3 พ.ย. 2569');
    expect(within(groups[0]).getByText('ยอดหมุนเวียน · 1,200.00 บาท')).toBeInTheDocument();
    expect(screen.queryByText(/3 ธ\.ค\. 2569/)).not.toBeInTheDocument();
  });

  it('payable cycle paid (payableRevolvingDue 0) → existing current-cycle path (Nov cycle due 3 Dec)', () => {
    jest.setSystemTime(new Date(2026, 10, 28, 12, 0, 0));
    const card = makeCard('cc_small', 'บัตรวันที่ 3', 3, { statementDay: 'EOM', revolvingDue: 1500, revolvingDueMonth: '2026-11', payableRevolvingDue: 0, payableRevolvingMonth: '2026-10' });
    renderDashboard([card]);
    const groups = within(screen.getByRole('list', { name: LIST })).getAllByRole('listitem');
    expect(groups).toHaveLength(1);
    expect(groups[0].textContent).toContain('3 ธ.ค. 2569');
    expect(within(groups[0]).getByText('ยอดหมุนเวียน · 1,500.00 บาท')).toBeInTheDocument();
  });

  it('invalid payableRevolvingMonth → existing path; current cycle used', () => {
    jest.setSystemTime(new Date(2026, 10, 28, 12, 0, 0));
    const card = makeCard('cc_small', 'บัตรวันที่ 3', 3, { statementDay: 'EOM', revolvingDue: 1500, revolvingDueMonth: '2026-11', payableRevolvingDue: 1200, payableRevolvingMonth: 'bad' });
    renderDashboard([card]);
    const groups = within(screen.getByRole('list', { name: LIST })).getAllByRole('listitem');
    expect(groups).toHaveLength(1);
    expect(within(groups[0]).getByText('ยอดหมุนเวียน · 1,500.00 บาท')).toBeInTheDocument();
  });

  it('invalid payableRevolvingMonth with invalid current month → the existing "invalid → error" guard still fires', () => {
    const card = makeCard('cc_bad', 'บัตรข้อมูลผิด', 10, { statementDay: 'EOM', revolvingDue: 500, revolvingDueMonth: '2026-13', payableRevolvingDue: 400, payableRevolvingMonth: '2026-13' });
    renderDashboard([card], [], { onRetry: jest.fn() });
    expect(screen.getByRole('alert')).toHaveTextContent('ข้อมูลวันครบกำหนดของยอดหมุนเวียนบัตร บัตรข้อมูลผิด ไม่ถูกต้อง');
  });

  it('payable cycle equals the current cycle (same-month card) → current revolvingDue used, payable amount ignored', () => {
    const card = makeCard('cc_same', 'บัตรเดือนเดียวกัน', 5, { revolvingDue: 700, revolvingDueMonth: '2026-11', payableRevolvingDue: 999, payableRevolvingMonth: '2026-11' });
    renderDashboard([card]);
    const groups = within(screen.getByRole('list', { name: LIST })).getAllByRole('listitem');
    expect(groups).toHaveLength(1);
    expect(groups[0].textContent).toContain('5 พ.ย. 2569');
    expect(within(groups[0]).getByText('ยอดหมุนเวียน · 700.00 บาท')).toBeInTheDocument();
    expect(screen.queryByText(/999/)).not.toBeInTheDocument();
  });
});

describe('CreditCardDashboard KPI drill-down', () => {
  const debtCards = () => [
    makeCard('cc_a', 'บัตรเอ', 29, { remainingPayable: 3000 }),
    makeCard('cc_b', 'บัตรบี', 29, { remainingPayable: 30000 }),
    makeCard('cc_c', 'บัตรซี', 29, { remainingPayable: 0 })
  ];
  const renderDebt = (props: Partial<React.ComponentProps<typeof CreditCardDashboard>> = {}) => render(
    <CreditCardDashboard
      cards={debtCards()}
      plans={[]}
      totals={{ remainingPayable: 33000, availableCredit: 10000, creditLimit: 10000, ongoingPlanCount: 0, cardCount: 3 }}
      {...props}
    />
  );
  const debtTriggers = () => screen.getAllByRole('button', { name: /^หนี้คงเหลือรวม/ });
  const getPanel = () => screen.queryByRole('region', { name: 'หนี้คงเหลือแยกตามบัตร' });

  it('toggles the panel with aria-expanded/aria-controls and a single panel id', () => {
    renderDebt();
    const [desktop, mobile] = debtTriggers();
    expect(desktop).toHaveAttribute('aria-expanded', 'false');
    expect(desktop).toHaveAttribute('aria-controls', 'cc-debt-breakdown');
    expect(mobile).toHaveAttribute('aria-controls', 'cc-debt-breakdown');
    expect(getPanel()).not.toBeInTheDocument();
    expect(screen.getByText('แตะเพื่อดูแยกตามบัตร')).toBeInTheDocument();

    fireEvent.click(desktop);
    expect(desktop).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelectorAll('#cc-debt-breakdown')).toHaveLength(1);
    const panel = getPanel()!;
    expect(within(panel).getByText('รวม 33,000.00 บาท · 2 บัตร')).toBeInTheDocument();
    expect(within(panel).getByText('บัตรที่ไม่มีหนี้คงเหลือ 1 ใบ')).toBeInTheDocument();
    expect(within(panel).getAllByRole('listitem')[0].textContent).toContain('บัตรบี');

    fireEvent.click(desktop);
    expect(getPanel()).not.toBeInTheDocument();
  });

  it('opens via the mobile card, and row click calls onOpenCard once', () => {
    const onOpenCard = jest.fn();
    renderDebt({ onOpenCard });
    fireEvent.click(debtTriggers()[1]);
    fireEvent.click(within(getPanel()!).getByRole('button', { name: /ดูรายละเอียดบัตร บัตรเอ หนี้คงเหลือ 3,000.00 บาท/ }));
    expect(onOpenCard).toHaveBeenCalledTimes(1);
    expect(onOpenCard).toHaveBeenCalledWith('cc_a');
  });

  it('closes on Escape from the panel or the trigger', () => {
    renderDebt();
    const [desktop] = debtTriggers();
    fireEvent.click(desktop);
    fireEvent.keyDown(within(getPanel()!).getAllByRole('button')[0], { key: 'Escape' });
    expect(getPanel()).not.toBeInTheDocument();

    fireEvent.click(desktop);
    fireEvent.keyDown(desktop, { key: 'Escape' });
    expect(getPanel()).not.toBeInTheDocument();
  });

  it('does not close on Escape pressed elsewhere', () => {
    renderDebt();
    fireEvent.click(debtTriggers()[0]);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(getPanel()).toBeInTheDocument();
  });

  it('hide button closes the panel and returns focus to the opening trigger', () => {
    renderDebt();
    const [desktop] = debtTriggers();
    // jsdom always reports offsetParent null
    Object.defineProperty(desktop, 'offsetParent', { configurable: true, get: () => document.body });
    fireEvent.click(desktop);
    fireEvent.click(within(getPanel()!).getByRole('button', { name: 'ซ่อนรายละเอียด' }));
    expect(getPanel()).not.toBeInTheDocument();
    expect(desktop).toHaveFocus();
  });

  it('keeps the credit and plan tiles static', () => {
    renderDebt();
    expect(screen.queryByRole('button', { name: /^วงเงินคงเหลือ/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^แผนที่กำลังผ่อน/ })).not.toBeInTheDocument();
  });

  describe('due-soon tile', () => {
    const scrollIntoView = jest.fn();
    let originalScroll: typeof Element.prototype.scrollIntoView;
    let originalMatchMedia: typeof window.matchMedia;
    beforeEach(() => {
      originalScroll = Element.prototype.scrollIntoView;
      originalMatchMedia = window.matchMedia;
      Element.prototype.scrollIntoView = scrollIntoView;
      scrollIntoView.mockClear();
    });
    afterEach(() => {
      Element.prototype.scrollIntoView = originalScroll;
      window.matchMedia = originalMatchMedia;
    });
    const mockReduced = (matches: boolean) => {
      window.matchMedia = jest.fn().mockReturnValue({ matches }) as unknown as typeof window.matchMedia;
    };

    it('scrolls smoothly to and focuses the heading when the upcoming list is empty', () => {
      mockReduced(false);
      renderDebt();
      fireEvent.click(screen.getByRole('button', { name: /^ครบกำหนดเร็ว ๆ นี้/ }));
      const heading = document.getElementById('upcoming-heading');
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
      expect(scrollIntoView.mock.instances[0]).toBe(heading);
      expect(heading).toHaveFocus();
      expect(getPanel()).not.toBeInTheDocument();
    });

    it('uses auto behaviour under reduced motion', () => {
      mockReduced(true);
      renderDebt();
      fireEvent.click(screen.getByRole('button', { name: /^ครบกำหนดเร็ว ๆ นี้/ }));
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
    });
  });
});
