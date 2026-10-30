import { fireEvent, render, screen, within } from '@testing-library/react';
import CreditCardPlansBreakdown, { groupOngoingPlansByCard } from '../../src/frontend/components/CreditCardPlansBreakdown';

type Row = { no: number; dueMonth: string; payment: number | string; paid?: boolean };
const plan = (id: string, cardId: string, itemName: string, months: number, schedule?: Row[], status = 'ongoing') =>
  ({ id, cardId, itemName, months, status, schedule });
const card = (id: string, name: string, last4?: string) => ({ id, name, last4, statementDay: 1, dueDay: 25 });

describe('groupOngoingPlansByCard', () => {
  const cards = [card('a', 'A'), card('b', 'B')];

  it('filters completed, cancelled and orphan plans', () => {
    const groups = groupOngoingPlansByCard(cards, [
      plan('1', 'a', 'x', 1, [{ no: 1, dueMonth: '2026-11', payment: 1 }]),
      plan('2', 'a', 'y', 1, [], 'completed'),
      plan('3', 'b', 'z', 1, [], 'cancelled'),
      plan('4', 'zzz', 'w', 1, [{ no: 1, dueMonth: '2026-11', payment: 1 }])
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].plans.map(p => p.plan.id)).toEqual(['1']);
  });

  it('picks the lowest unpaid no even when rows are out of order, using months as total', () => {
    const rows: Row[] = [
      { no: 5, dueMonth: '2027-03', payment: 50 },
      { no: 4, dueMonth: '2027-02', payment: 40 },
      { no: 1, dueMonth: '2026-11', payment: 10, paid: true },
      { no: 2, dueMonth: '2026-12', payment: 20, paid: true },
      { no: 3, dueMonth: '2027-01', payment: 30, paid: true }
    ];
    const [group] = groupOngoingPlansByCard(cards, [plan('1', 'a', 'x', 10, rows)]);
    const [row] = group.plans;
    expect(row.remaining).toBe(2);
    expect(row.total).toBe(10);
    expect(row.next).toEqual({ payment: 40, dueMonth: '2027-02' });
  });

  it('handles missing and all-paid schedules and sorts them last', () => {
    const [group] = groupOngoingPlansByCard(cards, [
      plan('1', 'a', 'ก', 3, undefined),
      plan('2', 'a', 'ข', 3, [{ no: 1, dueMonth: '2026-11', payment: 1, paid: true }]),
      plan('3', 'a', 'ค', 3, [{ no: 1, dueMonth: '2026-12', payment: 1 }])
    ]);
    expect(group.plans.map(p => [p.plan.id, p.scheduleState, p.remaining])).toEqual([
      ['3', 'next', 1], ['1', 'none', 0], ['2', 'allPaid', 0]
    ]);
  });

  it('does not crash when the next row lacks dueMonth, and sorts it after dated plans', () => {
    const bad = { no: 1, payment: 5 } as unknown as Row;
    const [group] = groupOngoingPlansByCard(cards, [
      plan('1', 'a', 'ก', 2, [bad]),
      plan('2', 'a', 'ข', 2, [{ no: 1, dueMonth: '2027-01', payment: 6 }])
    ]);
    expect(group.plans.map(p => p.plan.id)).toEqual(['2', '1']);
  });

  it('tolerates null schedule rows (m-1): no crash, D-12 count, no-NaN fallback', () => {
    const nul = null as unknown as Row;
    const [group] = groupOngoingPlansByCard(cards, [
      plan('1', 'a', 'x', 3, [nul, { no: 2, dueMonth: '2026-12', payment: 7 }, nul]),
      plan('2', 'a', 'y', 3, [nul, { no: Number.NaN, dueMonth: '2027-01', payment: 8 }]),
      plan('3', 'a', 'z', 3, [nul])
    ]);
    const byId = Object.fromEntries(group.plans.map(p => [p.plan.id, p]));
    // D-12: remaining = rows where paid !== true, so a null row counts as unpaid
    expect(byId['1'].remaining).toBe(3);
    expect(byId['1'].next).toEqual({ payment: 7, dueMonth: '2026-12' });
    expect(byId['2'].next).toEqual({ payment: 8, dueMonth: '2027-01' });
    expect(byId['3'].scheduleState).toBe('allPaid');
    expect(byId['3'].next).toBeNull();
  });

  it('orders by next dueMonth, then itemName, then id; groups follow cards order', () => {
    const groups = groupOngoingPlansByCard(cards, [
      plan('3', 'b', 'b-plan', 1, [{ no: 1, dueMonth: '2026-11', payment: 1 }]),
      plan('2', 'a', 'ข', 1, [{ no: 1, dueMonth: '2026-11', payment: 1 }]),
      plan('1', 'a', 'ก', 1, [{ no: 1, dueMonth: '2026-11', payment: 1 }]),
      plan('0', 'a', 'ฮ', 1, [{ no: 1, dueMonth: '2026-10', payment: 1 }])
    ]);
    expect(groups.map(g => g.card.id)).toEqual(['a', 'b']);
    expect(groups[0].plans.map(p => p.plan.id)).toEqual(['0', '1', '2']);
  });
});

describe('CreditCardPlansBreakdown', () => {
  const cards = [card('a', 'บัตรเอ', '4321')];
  const plans = [
    plan('1', 'a', 'iPhone', 10, [
      { no: 1, dueMonth: '2026-11', payment: '833.33', paid: true },
      { no: 2, dueMonth: '2026-12', payment: '4990' }
    ])
  ];
  const render1 = (p = plans, onOpenCard = jest.fn(), onClose = jest.fn()) => {
    render(<CreditCardPlansBreakdown id="cc-plans-breakdown" cards={cards} plans={p} totalPlans={42} onOpenCard={onOpenCard} onClose={onClose} />);
    return { onOpenCard, onClose };
  };

  it('renders headline from props, counts, and only fixture payment values', () => {
    render1();
    const panel = screen.getByRole('region', { name: 'แผนที่กำลังผ่อนแยกตามแผน' });
    expect(within(panel).getByText('42 แผน · 1 บัตร')).toBeInTheDocument();
    expect(within(panel).getByText('เหลือ 1/10 งวด')).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { level: 3 })).toHaveTextContent('บัตรเอ ····4321 · 1 แผน');
    const moneyTexts = (panel.textContent || '').match(/\d{1,3}(,\d{3})*\.\d{2}/g) || [];
    expect(moneyTexts).toEqual(['4,990.00']);
    expect(within(panel).getByRole('button', { name: 'ดูรายละเอียดบัตร บัตรเอ ····4321 แผน iPhone เหลือ 1 จาก 10 งวด งวดถัดไป 4,990.00 บาท' })).toBeInTheDocument();
  });

  it('shows empty state when there are no ongoing plans', () => {
    render1([]);
    expect(screen.getByText('ไม่มีแผนที่กำลังผ่อน')).toBeInTheDocument();
    expect(screen.getByText('42 แผน · 0 บัตร')).toBeInTheDocument();
  });

  it('shows missing / all-paid messages', () => {
    render1([
      plan('1', 'a', 'ก', 3, undefined),
      plan('2', 'a', 'ข', 3, [{ no: 1, dueMonth: '2026-11', payment: 1, paid: true }])
    ]);
    expect(screen.getByText('ไม่มีข้อมูลตารางผ่อน')).toBeInTheDocument();
    expect(screen.getByText('ชำระครบทุกงวดแล้ว')).toBeInTheDocument();
    expect(screen.getAllByText('เหลือ 0/3 งวด')).toHaveLength(2);
  });

  it('opens the owning card, closes on hide and Escape', () => {
    const { onOpenCard, onClose } = render1();
    fireEvent.click(screen.getByRole('button', { name: /แผน iPhone/ }));
    expect(onOpenCard).toHaveBeenCalledTimes(1);
    expect(onOpenCard).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByRole('button', { name: 'ซ่อนรายละเอียด' }));
    fireEvent.keyDown(screen.getByRole('button', { name: /แผน iPhone/ }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
