/**
 * Stage 4 tester additions for spec-upcoming-card-totals.md (suffix -upcoming-card-totals).
 * Covers gaps left by UpcomingPayments.test.tsx: AC-5 in the component, account filter, name/due sort,
 * collapse toggle, pending retention after refresh, contract-level grouping via collectUpcomingPayments,
 * the pre-existing pendingKeys-on-event.key quirk, and highlight expiry behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import UpcomingPayments from '../../src/frontend/components/UpcomingPayments';
import { collectUpcomingPayments } from '../../src/shared/utils/frontend/expenseEvents';

type Props = React.ComponentProps<typeof UpcomingPayments>;

const cardA = { id: 'cc_a', name: 'บัตร A', color: '#336699' };
const cardB = { id: 'cc_b', name: 'บัตร B', color: '#996633' };
const mk = (over: Record<string, unknown>) => ({
  type: 'expense', paid: false, isoDate: '2026-11-10', daysDiff: 3, account: 'KBank', cycleMonth: '2026-10', card: cardA, ...over
});
const inst1 = mk({ id: '2026-10_cci_1', key: 'cci_1', source: 'installment', name: 'ผ่อนทีวี', amount: 600 });
const rev = mk({ id: '2026-10_ccr_a', key: 'ccr_a', source: 'revolving', name: 'บัตร A', amount: 1000 });
const upcomingOf = (...soon: unknown[]) => ({ overdue: [], dueToday: [], dueSoon: soon, total: soon.length }) as unknown as Props['upcoming'];

describe('upcoming card totals: tester additions', () => {
  it('AC-5: a revolving line absent from upcoming (minimum confirmed) leaves only installments in the total', () => {
    render(<UpcomingPayments upcoming={upcomingOf(inst1)} />);
    expect(screen.getByText('600.00 บาท')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'กางดูรายการ (1)' })).toBeInTheDocument();
  });

  it('OQ-4: a single-line card is still a card row with a disclosure', () => {
    render(<UpcomingPayments upcoming={upcomingOf(rev)} />);
    expect(screen.getByRole('button', { name: 'กางดูรายการ (1)' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /จ่ายเต็มจำนวน/ })).not.toBeInTheDocument();
  });

  it('disclosure toggles open and closed; aria-controls points at the panel; no button nests another', () => {
    const { container } = render(<UpcomingPayments upcoming={upcomingOf(inst1, rev)} />);
    const toggle = screen.getByRole('button', { name: 'กางดูรายการ (2)' });
    const panelId = toggle.getAttribute('aria-controls') as string;
    expect(container.querySelector(`[id="${panelId}"]`)).not.toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'ซ่อนรายการ' })).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('#upcoming-item-cci_1')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ซ่อนรายการ' }));
    expect(screen.getByRole('button', { name: 'กางดูรายการ (2)' })).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('#upcoming-item-cci_1')).toBeNull();
    expect(container.querySelector('button button')).toBeNull();
    expect(toggle.className).toMatch(/min-h-11/);
    expect(toggle.className).toMatch(/focus-visible:outline/);
  });

  it('expanded state survives a data refresh with new totals (live values, frozen identity)', () => {
    const { rerender } = render(<UpcomingPayments upcoming={upcomingOf(inst1, rev)} />);
    fireEvent.click(screen.getByRole('button', { name: 'กางดูรายการ (2)' }));
    rerender(<UpcomingPayments upcoming={upcomingOf(inst1, { ...rev, amount: 1500 })} />);
    expect(screen.getByRole('button', { name: 'ซ่อนรายการ' })).toBeInTheDocument();
    expect(screen.getByText('2,100.00 บาท')).toBeInTheDocument();
  });

  it('pending retention: a paid line stays in its group while pending, then the total drops after pending clears', () => {
    const { rerender } = render(<UpcomingPayments upcoming={upcomingOf(inst1, rev)} pendingKeys={[]} />);
    rerender(<UpcomingPayments upcoming={upcomingOf(inst1, rev)} pendingKeys={['cci_1']} />);
    // server refresh: cci_1 now paid, so it leaves upcoming, but it is still pending
    rerender(<UpcomingPayments upcoming={upcomingOf(rev)} pendingKeys={['cci_1']} />);
    expect(screen.getByText('1,600.00 บาท')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ซ่อนรายการ' })).toBeInTheDocument();
    rerender(<UpcomingPayments upcoming={upcomingOf(rev)} pendingKeys={[]} />);
    expect(screen.getByText('1,000.00 บาท')).toBeInTheDocument();
  });

  it('last line paid: the group disappears from the list', () => {
    const { rerender } = render(<UpcomingPayments upcoming={upcomingOf(rev)} />);
    expect(screen.getByRole('button', { name: /กางดูรายการ/ })).toBeInTheDocument();
    rerender(<UpcomingPayments upcoming={upcomingOf()} />);
    expect(screen.queryByRole('button', { name: /กางดูรายการ/ })).not.toBeInTheDocument();
  });

  it('account filter operates on groups (AC-8)', () => {
    const b = mk({ id: 'b', key: 'ccr_b', source: 'revolving', name: 'บัตร B', amount: 77, card: cardB, account: 'SCB' });
    render(<UpcomingPayments upcoming={upcomingOf(inst1, rev, b)} />);
    fireEvent.click(screen.getByRole('button', { name: /^ตัวกรอง/ }));
    fireEvent.click(screen.getByRole('combobox', { name: /บัญชี/ }));
    fireEvent.click(screen.getByRole('option', { name: 'SCB' }));
    expect(screen.getAllByRole('button', { name: /กางดูรายการ/ })).toHaveLength(1);
    expect(screen.getByText('77.00 บาท')).toBeInTheDocument();
  });

  it('name and due sorts operate on groups (AC-8)', () => {
    const mkc = (id: string, name: string, isoDate: string) => mk({
      id: `2026-10_ccr_${id}`, key: `ccr_${id}`, source: 'revolving', name, amount: 10, card: { id: `cc_${id}`, name }, isoDate
    });
    render(<UpcomingPayments upcoming={upcomingOf(mkc('a', 'บัตร ข', '2026-11-08'), mkc('b', 'บัตร ก', '2026-11-12'))} />);
    const select = screen.getByRole('combobox', { name: /เรียงตาม/ });
    fireEvent.change(select, { target: { value: 'name:asc' } });
    expect(screen.getAllByText(/^บัตร [กข]$/).map(n => n.textContent)).toEqual(['บัตร ก', 'บัตร ข']);
    fireEvent.change(select, { target: { value: 'due:asc' } });
    expect(screen.getAllByText(/^บัตร [กข]$/).map(n => n.textContent)).toEqual(['บัตร ข', 'บัตร ก']);
  });

  it('end-to-end with collectUpcomingPayments: one card row whose total is the unpaid remainder', () => {
    const monthsMap = {
      '2026-11': {
        ccr_000000000001: {
          name: 'บัตร A', actual: 2100, dueDay: 10, account: 'KBank', cycleMonth: '2026-10', resolvedDueDate: '2026-11-10', paid: false,
          breakdown: {
            installments: [
              { key: 'cci_000000000001_01', name: 'ผ่อน 1', amount: 600, paid: false },
              { key: 'cci_000000000002_01', name: 'ผ่อน 2', amount: 300, paid: true }
            ],
            revolving: { totalDue: 1200, newSpend: 1200, paymentAction: null }
          }
        }
      }
    };
    const cards = [{ id: 'cc_000000000001', name: 'บัตร A' }] as any;
    const plans = [{ id: 'ip_000000000001', cardId: 'cc_000000000001' }, { id: 'ip_000000000002', cardId: 'cc_000000000001' }] as any;
    const upcoming = collectUpcomingPayments({ monthsMap, cards, plans, today: new Date(2026, 10, 7) });
    // contract unchanged: per-line events and line count total
    expect(upcoming.total).toBe(2);
    expect(Object.keys(upcoming).sort()).toEqual(['dueSoon', 'dueToday', 'overdue', 'total']);
    render(<UpcomingPayments upcoming={upcoming} />);
    expect(screen.getByText('1,800.00 บาท')).toBeInTheDocument();
    expect(screen.getByText('แสดง 1 จาก 1 รายการ')).toBeInTheDocument();
  });

  it('pre-existing quirk: pendingKeys match on event.key, so both cycles of ccr_a show busy (unchanged, not worsened)', () => {
    const next = mk({ id: '2026-11_ccr_a', key: 'ccr_a', source: 'revolving', name: 'บัตร A', amount: 200, cycleMonth: '2026-11', isoDate: '2026-12-10' });
    render(<UpcomingPayments upcoming={upcomingOf(rev, next)} pendingKeys={['ccr_a']} />);
    // both groups forced open, both revolving lines busy (same as pre-task individual rows)
    expect(screen.getAllByRole('button', { name: 'ซ่อนรายการ' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'กำลังบันทึก...' })).toHaveLength(2);
  });

  it('highlight expiry (M-1): group opened by highlightedKey stays open after the highlight clears', () => {
    const { container, rerender } = render(<UpcomingPayments upcoming={upcomingOf(inst1, rev)} highlightedKey="cci_1" />);
    expect(container.querySelector('#upcoming-item-cci_1')).not.toBeNull();
    // pages/index.tsx clears highlightedKey after 4000 ms
    act(() => { rerender(<UpcomingPayments upcoming={upcomingOf(inst1, rev)} highlightedKey={null} />); });
    expect(container.querySelector('#upcoming-item-cci_1')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'ซ่อนรายการ' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('highlighted-opened group can still be collapsed by the user (not forced)', () => {
    const { container } = render(<UpcomingPayments upcoming={upcomingOf(inst1, rev)} highlightedKey="cci_1" />);
    fireEvent.click(screen.getByRole('button', { name: 'ซ่อนรายการ' }));
    expect(container.querySelector('#upcoming-item-cci_1')).toBeNull();
  });

  it('forced-open toggle (m-1): while a line is pending the hide button is disabled and does not flip state', () => {
    const { container, rerender } = render(<UpcomingPayments upcoming={upcomingOf(inst1, rev)} pendingKeys={['cci_1']} />);
    const toggle = screen.getByRole('button', { name: 'ซ่อนรายการ' });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls');
    expect(toggle.className).toMatch(/min-h-11/);
    fireEvent.click(toggle);
    // pending clears: the click did not flip the Set, so the group is back to its own (collapsed) state
    rerender(<UpcomingPayments upcoming={upcomingOf(inst1, rev)} pendingKeys={[]} />);
    expect(screen.getByRole('button', { name: 'กางดูรายการ (2)' })).toBeEnabled();
    expect(container.querySelector('#upcoming-item-cci_1')).toBeNull();
  });
});

/**
 * Round 2 tester additions (review M-1/m-1 fixes). The harness mirrors the pages/index.tsx
 * handleSelectUpcomingItem contract (clear ring filter + set highlightedKey in one batch, a 60 ms
 * getElementById scrollIntoView, clear after 4000 ms) so the journey runs through state transitions
 * (null -> key -> null) rather than mounting with a highlight already set.
 */
describe('upcoming card totals: Round 2 NotificationBell journey', () => {
  const scrollIntoView = jest.fn();
  let originalScroll: typeof Element.prototype.scrollIntoView;
  beforeEach(() => {
    jest.useFakeTimers();
    originalScroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView as unknown as typeof Element.prototype.scrollIntoView;
    scrollIntoView.mockClear();
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = originalScroll;
    jest.useRealTimers();
  });

  function Harness({ upcoming, initialFilter = null }: { upcoming: Props['upcoming']; initialFilter?: Props['filter'] }) {
    const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
    const [filter, setFilter] = useState<Props['filter']>(initialFilter);
    const select = (key: string) => {
      setFilter(null);
      setHighlightedKey(key);
      setTimeout(() => document.getElementById(`upcoming-item-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
      setTimeout(() => setHighlightedKey(null), 4000);
    };
    return (
      <>
        <button type="button" onClick={() => select('cci_1')}>bell-cci_1</button>
        <button type="button" onClick={() => select('ccr_a')}>bell-ccr_a</button>
        <UpcomingPayments upcoming={upcoming} filter={filter} highlightedKey={highlightedKey} />
      </>
    );
  }

  it('null -> key: group expands before the 60 ms scroll, scroll targets the line, group stays open after 4 s', () => {
    const { container } = render(<Harness upcoming={upcomingOf(inst1, rev)} />);
    expect(container.querySelector('#upcoming-item-cci_1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'bell-cci_1' }));
    const line = container.querySelector('#upcoming-item-cci_1');
    expect(line).not.toBeNull();
    expect(line?.className).toMatch(/outline-accent/);
    act(() => { jest.advanceTimersByTime(60); });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(line);
    act(() => { jest.advanceTimersByTime(4000); });
    const after = container.querySelector('#upcoming-item-cci_1');
    expect(after).not.toBeNull();
    expect(after?.className).not.toMatch(/outline-accent/);
    expect(screen.getByRole('button', { name: 'ซ่อนรายการ' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('bell pick while a generalExpense ring filter hides cards: filter clears and the group expands in the same batch', () => {
    const { container } = render(<Harness upcoming={upcomingOf(inst1, rev)} initialFilter="generalExpense" />);
    expect(screen.queryByRole('button', { name: /กางดูรายการ/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'bell-cci_1' }));
    expect(container.querySelector('#upcoming-item-cci_1')).not.toBeNull();
    act(() => { jest.advanceTimersByTime(60); });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('user collapses during the highlight; a data refresh with the same highlightedKey does not re-expand it', () => {
    const { container, rerender } = render(<Harness upcoming={upcomingOf(inst1, rev)} />);
    fireEvent.click(screen.getByRole('button', { name: 'bell-cci_1' }));
    fireEvent.click(screen.getByRole('button', { name: 'ซ่อนรายการ' }));
    expect(container.querySelector('#upcoming-item-cci_1')).toBeNull();
    // refresh mid-highlight (new totals), highlightedKey unchanged
    rerender(<Harness upcoming={upcomingOf(inst1, { ...rev, amount: 1500 })} />);
    expect(container.querySelector('#upcoming-item-cci_1')).toBeNull();
    expect(screen.getByText('2,100.00 บาท')).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(4060); });
    expect(container.querySelector('#upcoming-item-cci_1')).toBeNull();
  });

  it('observed edge: re-picking the SAME bell item within 4 s after collapsing does not re-expand (highlightedKey unchanged)', () => {
    const { container } = render(<Harness upcoming={upcomingOf(inst1, rev)} />);
    fireEvent.click(screen.getByRole('button', { name: 'bell-cci_1' }));
    act(() => { jest.advanceTimersByTime(60); });
    fireEvent.click(screen.getByRole('button', { name: 'ซ่อนรายการ' }));
    scrollIntoView.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'bell-cci_1' }));
    act(() => { jest.advanceTimersByTime(60); });
    expect(container.querySelector('#upcoming-item-cci_1')).toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('pre-existing key ambiguity: ccr_a in two cycles expands exactly one group, so exactly one line id exists', () => {
    const next = mk({ id: '2026-11_ccr_a', key: 'ccr_a', source: 'revolving', name: 'บัตร A', amount: 200, cycleMonth: '2026-11', isoDate: '2026-12-10' });
    const { container } = render(<Harness upcoming={upcomingOf(rev, next)} />);
    fireEvent.click(screen.getByRole('button', { name: 'bell-ccr_a' }));
    expect(container.querySelectorAll('[id="upcoming-item-ccr_a"]')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'ซ่อนรายการ' })).toHaveLength(1);
  });

  it('disabled-while-pending disclosure: no nested buttons, panel id resolves, re-enabled toggle works after pending clears', () => {
    const { container, rerender } = render(<UpcomingPayments upcoming={upcomingOf(inst1, rev)} pendingKeys={['cci_1']} />);
    const toggle = screen.getByRole('button', { name: 'ซ่อนรายการ' });
    expect(toggle).toBeDisabled();
    expect(container.querySelector(`[id="${toggle.getAttribute('aria-controls')}"]`)).not.toBeNull();
    expect(container.querySelector('button button')).toBeNull();
    rerender(<UpcomingPayments upcoming={upcomingOf(inst1, rev)} pendingKeys={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'กางดูรายการ (2)' }));
    expect(screen.getByRole('button', { name: 'ซ่อนรายการ' })).toBeEnabled();
    expect(container.querySelector('#upcoming-item-cci_1')).not.toBeNull();
  });
});
