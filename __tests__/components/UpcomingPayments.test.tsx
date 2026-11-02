import { describe, expect, it } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import UpcomingPayments from '../../src/frontend/components/UpcomingPayments';

type Props = React.ComponentProps<typeof UpcomingPayments>;
type Paid = NonNullable<Props['paidEvents']>;

const TITLE = /ชำระแล้วเดือนนี้ \(2\)/;

function paid(): Paid {
  return [
    { id: 'a', type: 'expense', source: 'revolving', key: 'rev1', name: 'บัตร A ยอดหมุนเวียน', amount: 1200, paid: true, card: { id: 'c1', name: 'บัตร A' }, isoDate: '2026-10-05' },
    { id: 'b', type: 'expense', source: 'installment', key: 'inst1', name: 'ผ่อนโทรศัพท์', amount: 900, paid: true, card: { id: 'c1', name: 'บัตร A' }, isoDate: '2026-10-12' }
  ] as unknown as Paid;
}

const emptyUpcoming = { overdue: [], dueToday: [], dueSoon: [], total: 0 };

function renderPayments(extra: Partial<Props> = {}) {
  return render(<UpcomingPayments upcoming={emptyUpcoming} paidEvents={paid()} {...extra} />);
}

describe('UpcomingPayments paid group', () => {
  it('is hidden when paidEvents is empty or omitted', () => {
    const { rerender } = render(<UpcomingPayments upcoming={emptyUpcoming} paidEvents={[]} />);
    expect(screen.queryByText(/ชำระแล้วเดือนนี้/)).not.toBeInTheDocument();
    rerender(<UpcomingPayments upcoming={emptyUpcoming} />);
    expect(screen.queryByText(/ชำระแล้วเดือนนี้/)).not.toBeInTheDocument();
  });

  it('is collapsed by default, with aria wiring, and visible when the 7-day list is empty', () => {
    renderPayments();
    expect(screen.getByText('ไม่มีรายการที่ครบกำหนดใน 7 วันข้างหน้า')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: TITLE });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls');
    expect(screen.queryByText('ผ่อนโทรศัพท์')).not.toBeInTheDocument();
  });

  it('expands to list the paid rows', () => {
    renderPayments();
    fireEvent.click(screen.getByRole('button', { name: TITLE }));
    expect(screen.getByRole('button', { name: TITLE })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/ผ่อนโทรศัพท์/, { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText(/บัตร A ยอดหมุนเวียน/, { selector: 'span' })).toBeInTheDocument();
  });

  it('revolving cancel button calls onRevolvingCancel', () => {
    const onRevolvingCancel = jest.fn();
    renderPayments({ onRevolvingCancel });
    fireEvent.click(screen.getByRole('button', { name: TITLE }));
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิกการชำระ' }));
    expect(onRevolvingCancel).toHaveBeenCalledWith(expect.objectContaining({ key: 'rev1' }));
  });

  it('installment un-pay button calls onToggleInstallment', () => {
    const onToggleInstallment = jest.fn();
    renderPayments({ onToggleInstallment });
    fireEvent.click(screen.getByRole('button', { name: TITLE }));
    fireEvent.click(screen.getByRole('button', { name: '✓ ชำระแล้ว — แตะเพื่อยกเลิก' }));
    expect(onToggleInstallment).toHaveBeenCalledWith(expect.objectContaining({ key: 'inst1' }));
  });

  it('disables a busy row and shows the saving label', () => {
    const onRevolvingCancel = jest.fn();
    renderPayments({ pendingKeys: ['rev1'], onRevolvingCancel, onToggleInstallment: jest.fn() });
    fireEvent.click(screen.getByRole('button', { name: TITLE }));
    const busy = screen.getByRole('button', { name: 'กำลังบันทึก...' });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(onRevolvingCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '✓ ชำระแล้ว — แตะเพื่อยกเลิก' })).toBeEnabled();
  });

  it('disables the action buttons when their handlers are not provided', () => {
    renderPayments();
    fireEvent.click(screen.getByRole('button', { name: TITLE }));
    expect(screen.getByRole('button', { name: 'ยกเลิกการชำระ' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '✓ ชำระแล้ว — แตะเพื่อยกเลิก' })).toBeDisabled();
  });

  it('keeps paid rows out of the list toolbar counts', () => {
    const upcoming = {
      overdue: [{ id: 'x', type: 'expense', source: 'plain', key: 'plain1', name: 'ค่าไฟ', amount: 500, paid: false, isoDate: '2026-10-01', daysDiff: -3 }],
      dueToday: [],
      dueSoon: [],
      total: 1
    } as unknown as Props['upcoming'];
    render(<UpcomingPayments upcoming={upcoming} paidEvents={paid()} />);
    expect(screen.getByText('แสดง 1 จาก 1 รายการ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: TITLE })).toBeInTheDocument();
  });

  it('is hidden under non credit-card ring filters and shown under creditCard', () => {
    const { rerender } = renderPayments({ filter: 'generalExpense' });
    expect(screen.queryByText(/ชำระแล้วเดือนนี้/)).not.toBeInTheDocument();
    rerender(<UpcomingPayments upcoming={emptyUpcoming} paidEvents={paid()} filter="dailyExpense" />);
    expect(screen.queryByText(/ชำระแล้วเดือนนี้/)).not.toBeInTheDocument();
    rerender(<UpcomingPayments upcoming={emptyUpcoming} paidEvents={paid()} filter="creditCard" />);
    expect(screen.getByRole('button', { name: TITLE })).toBeInTheDocument();
  });
});

describe('UpcomingPayments per-card totals', () => {
  const cardA = { id: 'cc_a', name: 'บัตร A', color: '#336699' };
  const cardB = { id: 'cc_b', name: 'บัตร B', color: '#996633' };
  const mk = (over: Record<string, unknown>) => ({
    type: 'expense', paid: false, isoDate: '2026-11-10', daysDiff: 3, account: 'KBank', cycleMonth: '2026-10', card: cardA, ...over
  });
  const inst1 = mk({ id: '2026-10_cci_1', key: 'cci_1', source: 'installment', name: 'ผ่อนทีวี', amount: 600 });
  const inst2 = mk({ id: '2026-10_cci_2', key: 'cci_2', source: 'installment', name: 'ผ่อนตู้เย็น', amount: 300.5 });
  const rev = mk({ id: '2026-10_ccr_a', key: 'ccr_a', source: 'revolving', name: 'บัตร A', amount: 1000 });
  const plain = mk({ id: '2026-11_rent', key: 'rent', source: 'plain', name: 'ค่าเช่า', amount: 5000, card: null, account: 'SCB' });
  const upcomingOf = (...soon: unknown[]) => ({ overdue: [], dueToday: [], dueSoon: soon, total: soon.length }) as unknown as Props['upcoming'];
  const open = () => fireEvent.click(screen.getByRole('button', { name: /กางดูรายการ/ }));

  it('renders one collapsed card with the remaining total and hides the lines (AC-1)', () => {
    render(<UpcomingPayments upcoming={upcomingOf(inst1, inst2, rev)} />);
    expect(screen.getByText('1,900.50 บาท')).toBeInTheDocument();
    expect(screen.getByText('ครบกำหนดใน 7 วัน (1)')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'กางดูรายการ (3)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls');
    expect(screen.queryByText('ผ่อนทีวี')).not.toBeInTheDocument();
    expect(screen.getByText('แสดง 1 จาก 1 รายการ')).toBeInTheDocument();
  });

  it('expands to the same pay buttons calling the same handlers with the same event (AC-2)', () => {
    const onToggleInstallment = jest.fn();
    const onRevolvingFull = jest.fn();
    const onRevolvingMinimum = jest.fn();
    render(<UpcomingPayments upcoming={upcomingOf(inst1, rev)} {...{ onToggleInstallment, onRevolvingFull, onRevolvingMinimum }} />);
    open();
    expect(screen.getByRole('button', { name: 'ซ่อนรายการ' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'ยังไม่ชำระ — แตะเพื่อยืนยัน' }));
    expect(onToggleInstallment).toHaveBeenCalledWith(expect.objectContaining({ key: 'cci_1', cycleMonth: '2026-10' }));
    fireEvent.click(screen.getByRole('button', { name: /จ่ายเต็มจำนวน/ }));
    expect(onRevolvingFull).toHaveBeenCalledWith(expect.objectContaining({ key: 'ccr_a', cycleMonth: '2026-10' }));
    fireEvent.click(screen.getByRole('button', { name: 'จ่ายขั้นต่ำ' }));
    expect(onRevolvingMinimum).toHaveBeenCalledWith(expect.objectContaining({ key: 'ccr_a' }));
  });

  it('shows two cycles of the same card as two cards (AC-3)', () => {
    const next = mk({ id: '2026-11_ccr_a', key: 'ccr_a', source: 'revolving', name: 'บัตร A', amount: 200, cycleMonth: '2026-11', isoDate: '2026-12-10' });
    render(<UpcomingPayments upcoming={upcomingOf(rev, next)} />);
    expect(screen.getAllByRole('button', { name: /กางดูรายการ/ })).toHaveLength(2);
    expect(screen.getByText('1,000.00 บาท')).toBeInTheDocument();
    expect(screen.getByText('200.00 บาท')).toBeInTheDocument();
  });

  it('shows the paid hint only when something is paid and counts it in n (AC-4)', () => {
    const paidLine = { id: '2026-10_cci_9', key: 'cci_9', source: 'installment', name: 'ผ่อนแล้ว', amount: 400, paid: true, cycleMonth: '2026-10', card: cardA, isoDate: '2026-10-05' };
    const { rerender } = render(<UpcomingPayments upcoming={upcomingOf(inst1, rev)} />);
    expect(screen.queryByText(/ชำระแล้ว \d+\/\d+ รายการ/)).not.toBeInTheDocument();
    rerender(<UpcomingPayments upcoming={upcomingOf(inst1, rev)} paidEvents={[paidLine] as unknown as Paid} />);
    expect(screen.getByText('ชำระแล้ว 1/3 รายการ')).toBeInTheDocument();
    expect(screen.getByText('1,600.00 บาท')).toBeInTheDocument();
  });

  it('leaves plain rows and unresolved card events as individual rows (AC-10)', () => {
    const orphan = mk({ id: 'o', key: 'cci_gone', source: 'installment', name: 'ผ่อนกำพร้า', amount: 50, card: null });
    render(<UpcomingPayments upcoming={upcomingOf(plain, orphan)} />);
    expect(screen.getByText('ค่าเช่า')).toBeInTheDocument();
    expect(screen.getByText('ผ่อนกำพร้า')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /กางดูรายการ/ })).not.toBeInTheDocument();
  });

  it('ring filter keeps card groups under creditCard and drops them under generalExpense (AC-7)', () => {
    const { rerender } = render(<UpcomingPayments upcoming={upcomingOf(plain, inst1)} filter="creditCard" />);
    expect(screen.getByRole('button', { name: /กางดูรายการ/ })).toBeInTheDocument();
    expect(screen.queryByText('ค่าเช่า')).not.toBeInTheDocument();
    rerender(<UpcomingPayments upcoming={upcomingOf(plain, inst1)} filter="generalExpense" />);
    expect(screen.queryByRole('button', { name: /กางดูรายการ/ })).not.toBeInTheDocument();
    expect(screen.getByText('ค่าเช่า')).toBeInTheDocument();
  });

  it('search matches a card by a line name and never narrows its total (AC-8)', () => {
    const b = mk({ id: 'b', key: 'cci_b', source: 'installment', name: 'ผ่อนโน้ตบุ๊ก', amount: 77, card: cardB });
    render(<UpcomingPayments upcoming={upcomingOf(inst1, rev, b)} />);
    expect(screen.getAllByRole('button', { name: /กางดูรายการ/ })).toHaveLength(2);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ทีวี' } });
    expect(screen.getAllByRole('button', { name: /กางดูรายการ/ })).toHaveLength(1);
    expect(screen.getByText('1,600.00 บาท')).toBeInTheDocument();
  });

  it('type filter keeps groups that contain a line of that source with the full total (AC-8)', () => {
    const b = mk({ id: 'b', key: 'ccr_b', source: 'revolving', name: 'บัตร B', amount: 77, card: cardB });
    render(<UpcomingPayments upcoming={upcomingOf(inst1, rev, b, plain)} />);
    fireEvent.click(screen.getByRole('button', { name: /^ตัวกรอง/ }));
    const typeSelect = screen.getByRole('combobox', { name: /ประเภท/ });
    fireEvent.click(typeSelect);
    fireEvent.click(screen.getByRole('option', { name: 'บัตรที่มีรายการผ่อนชำระ' }));
    expect(screen.getAllByRole('button', { name: /กางดูรายการ/ })).toHaveLength(1);
    expect(screen.getByText('1,600.00 บาท')).toBeInTheDocument();
    expect(screen.queryByText('ค่าเช่า')).not.toBeInTheDocument();
  });

  it('auto-expands the group that owns the highlighted line and keeps its element id (AC-9)', () => {
    const { container } = render(<UpcomingPayments upcoming={upcomingOf(inst1, rev)} highlightedKey="cci_1" />);
    expect(screen.getByRole('button', { name: 'ซ่อนรายการ' })).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('#upcoming-item-cci_1')).not.toBeNull();
  });

  it('keeps a group expanded while one of its lines is pending', () => {
    render(<UpcomingPayments upcoming={upcomingOf(inst1, rev)} pendingKeys={['cci_1']} />);
    expect(screen.getByRole('button', { name: 'ซ่อนรายการ' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('button', { name: 'กำลังบันทึก...' }).length).toBeGreaterThan(0);
  });

  it('keeps the paid group working next to card rows', () => {
    render(<UpcomingPayments upcoming={upcomingOf(inst1)} paidEvents={paid()} />);
    expect(screen.getByRole('button', { name: TITLE })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /กางดูรายการ/ })).toBeInTheDocument();
  });
});

describe('UpcomingPayments card sort', () => {
  const mkc = (id: string, name: string, amount: number, over: Record<string, unknown> = {}) => ({
    type: 'expense', paid: false, isoDate: '2026-11-10', daysDiff: 3, account: '', cycleMonth: '2026-10',
    id: `2026-10_ccr_${id}`, key: `ccr_${id}`, source: 'revolving', name, amount, card: { id: `cc_${id}`, name }, ...over
  });

  it('sorts card groups by their total within the section (AC-8)', () => {
    const upcoming = { overdue: [], dueToday: [], dueSoon: [mkc('a', 'บัตร ก', 100), mkc('b', 'บัตร ข', 900)], total: 2 } as unknown as Props['upcoming'];
    render(<UpcomingPayments upcoming={upcoming} />);
    fireEvent.change(screen.getByRole('combobox', { name: /เรียงตาม/ }), { target: { value: 'amount:desc' } });
    const headings = screen.getAllByText(/^บัตร [กข]$/).map(node => node.textContent);
    expect(headings).toEqual(['บัตร ข', 'บัตร ก']);
  });
});
