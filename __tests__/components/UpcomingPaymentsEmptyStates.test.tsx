/**
 * Dashboard upcoming panel: loading vs true-empty vs filtered-empty vs incomplete-data
 * (spec-ui-review-remediation §B, AC 2-6). Pure presentation: payment callbacks, grouping and
 * the seven-day window are covered by the existing UpcomingPayments suites.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import UpcomingPayments from '../../src/frontend/components/UpcomingPayments';

type Props = React.ComponentProps<typeof UpcomingPayments>;

const plain = (key: string, name: string, over: Record<string, unknown> = {}) => ({
  id: `2026-11_${key}`, key, type: 'expense', source: 'plain', name, amount: 500, paid: false,
  isoDate: '2026-11-10', daysDiff: 3, account: 'KBank', ...over
});
const upcomingOf = (...soon: unknown[]) => ({ overdue: [], dueToday: [], dueSoon: soon, total: soon.length }) as unknown as Props['upcoming'];
const EMPTY = upcomingOf();
const EMPTY_MESSAGE = 'ไม่มีรายการที่ครบกำหนดใน 7 วันข้างหน้า';

const paidEvents = [
  { id: 'a', type: 'expense', source: 'revolving', key: 'rev1', name: 'บัตร A ยอดหมุนเวียน', amount: 1200, paid: true, card: { id: 'c1', name: 'บัตร A' }, isoDate: '2026-11-05' }
] as unknown as Props['paidEvents'];

describe('true-empty (loaded, nothing hidden)', () => {
  it('shows the heading, the compact message and the calendar action with no toolbar or 0/0 count', () => {
    const onViewCalendar = jest.fn();
    render(<UpcomingPayments upcoming={EMPTY} onViewCalendar={onViewCalendar} />);
    expect(screen.getByRole('heading', { name: 'รายการที่จะครบกำหนด' })).toBeInTheDocument();
    expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/0\s*\/\s*0/)).not.toBeInTheDocument();
    expect(screen.queryByText(/แสดงเฉพาะรายการที่ยังไม่ชำระภายใน 7 วัน/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ดูทั้งเดือนในปฏิทิน' }));
    expect(onViewCalendar).toHaveBeenCalledTimes(1);
  });

  it('keeps the paid-month disclosure reachable when there are no unpaid rows', () => {
    render(<UpcomingPayments upcoming={EMPTY} paidEvents={paidEvents} />);
    expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ชำระแล้วเดือนนี้ (1)' })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('loading and incomplete data are not confirmed-empty', () => {
  it('upcoming not yet available: status text, no empty claim, no toolbar', () => {
    render(<UpcomingPayments upcoming={undefined} />);
    expect(screen.getByRole('status')).toHaveTextContent('กำลังโหลดรายการที่จะครบกำหนด');
    expect(screen.queryByText(EMPTY_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ดูทั้งเดือนในปฏิทิน' })).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('partial load failure with no rows: alert + retry instead of "nothing due"', () => {
    const onRetry = jest.fn();
    render(<UpcomingPayments upcoming={EMPTY} incomplete onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('โหลดข้อมูลบางส่วนไม่สำเร็จ');
    expect(screen.queryByText(EMPTY_MESSAGE)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('partial load failure with rows still lists the rows', () => {
    render(<UpcomingPayments upcoming={upcomingOf(plain('exp_1', 'ค่าไฟ'))} incomplete />);
    expect(screen.getByText('ค่าไฟ')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('filtered-empty keeps a working clear route', () => {
  it('a search that hides existing rows says so, and clearing restores them', async () => {
    render(<UpcomingPayments upcoming={upcomingOf(plain('exp_1', 'ค่าไฟ'))} />);
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'ไม่มีชื่อนี้' } });
    expect(screen.getByText('ไม่พบรายการที่ตรงกับตัวกรอง')).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByText('ค่าไฟ')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรองรายการ' }));
    expect(screen.getByText('ค่าไฟ')).toBeInTheDocument();
    expect(screen.queryByText('ไม่พบรายการที่ตรงกับตัวกรอง')).not.toBeInTheDocument();
  });

  it('a persisted search is not stranded behind a hidden toolbar when the dataset later becomes empty', async () => {
    const { rerender } = render(<UpcomingPayments upcoming={upcomingOf(plain('exp_1', 'ค่าไฟ'))} />);
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'ไฟ' } });
    rerender(<UpcomingPayments upcoming={EMPTY} />);
    expect(screen.getByRole('searchbox')).toHaveValue('ไฟ');
    expect(screen.getByText('ไม่พบรายการที่ตรงกับตัวกรอง')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรองรายการ' }));
    expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('a ring filter with no matching rows keeps its copy, toolbar and escape control', () => {
    const onClearFilter = jest.fn();
    render(<UpcomingPayments upcoming={upcomingOf(plain('exp_1', 'ค่าไฟ'))} filter="savings" onClearFilter={onClearFilter} />);
    expect(screen.getByText('เงินออมไม่มีวันครบกำหนด')).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรองจากวงแหวน' }));
    expect(onClearFilter).toHaveBeenCalledTimes(1);
  });

  it('a ring filter on an otherwise empty dataset still offers the escape (not the compact state)', () => {
    render(<UpcomingPayments upcoming={EMPTY} filter="generalExpense" onClearFilter={jest.fn()} />);
    expect(screen.getByText('ไม่มีรายจ่ายทั่วไปที่ครบกำหนดในช่วงนี้')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ล้างตัวกรองจากวงแหวน' })).toBeInTheDocument();
  });
});

describe('pending-retained rows', () => {
  it('a row that disappears from the source while its save is pending stays visible, not the compact state', () => {
    const row = plain('exp_1', 'ค่าไฟ');
    const { rerender } = render(<UpcomingPayments upcoming={upcomingOf(row)} pendingKeys={[]} />);
    expect(screen.getByText('ค่าไฟ')).toBeInTheDocument();
    rerender(<UpcomingPayments upcoming={EMPTY} pendingKeys={['exp_1']} />);
    expect(screen.getByText('ค่าไฟ')).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_MESSAGE)).not.toBeInTheDocument();
  });
});
