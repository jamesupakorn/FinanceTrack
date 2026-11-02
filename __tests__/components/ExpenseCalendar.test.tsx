import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import ExpenseCalendar from '../../src/frontend/components/ExpenseCalendar';
import ExpenseCalendarModal, { RevolvingConfirmDialog } from '../../src/frontend/components/ExpenseCalendarModal';

// Only the API clients are mocked (the modal loads through them); everything else is real.
jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  expenseAPI: { getAll: jest.fn(() => new Promise(() => {})) },
  creditCardAPI: {
    getCards: jest.fn(() => new Promise(() => {})),
    getPlans: jest.fn(() => new Promise(() => {})),
    setInstallmentPaid: jest.fn(),
    setRevolvingAction: jest.fn(),
    getRevolving: jest.fn()
  }
}));

// A past month so "overdue" is deterministic regardless of the wall clock.
const MONTH = '2020-01';

type Props = React.ComponentProps<typeof ExpenseCalendar>;
type EventsByDay = Props['eventsByDay'];

function makeEvents(events: Array<Record<string, unknown>>, day = 10): EventsByDay {
  return new Map([[day, events]]) as unknown as EventsByDay;
}

function expense(overrides: Record<string, unknown>) {
  return {
    type: 'expense', source: 'plain', key: 'k1', name: 'ค่าไฟ', amount: 500, paid: false, ...overrides
  };
}

function renderCalendar(events: Array<Record<string, unknown>>, extra: Partial<Props> = {}) {
  return render(
    <ExpenseCalendar monthKey={MONTH} onNavigateMonth={jest.fn()} eventsByDay={makeEvents(events)} {...extra} />
  );
}

describe('ExpenseCalendar (Graphite tokens)', () => {
  it('uses var(--accent) for a card-less dot and the card hex for a card event', () => {
    const { container } = renderCalendar([
      expense({ key: 'a' }),
      expense({ key: 'b', name: 'ผ่อน', card: { id: 'c1', name: 'บัตร A', color: '#00338e' } })
    ]);
    const dots = Array.from(container.querySelectorAll<HTMLElement>('[role="gridcell"] [style*="--dot-color"]'));
    const values = dots.map(dot => dot.style.getPropertyValue('--dot-color'));
    expect(values).toContain('var(--accent)');
    expect(values).toContain('#00338e');
  });

  it('never emits legacy palette values in inline styles', () => {
    const { container } = renderCalendar(
      [expense({ card: { id: 'c1', name: 'บัตร A' } })],
      { cards: [{ id: 'c1', name: 'บัตร A' }] as Props['cards'] }
    );
    const styles = Array.from(container.querySelectorAll('[style]')).map(node => node.getAttribute('style') || '');
    styles.forEach(style => {
      expect(style).not.toContain('#5d5bff');
      expect(style).not.toContain('--color-primary');
      expect(style).not.toContain('--card-accent');
    });
  });

  it('demotes a paid event with text tokens instead of opacity and keeps the check mark', () => {
    renderCalendar([
      expense({
        source: 'installment', paid: true, installmentNo: 1, plan: { id: 'p1', itemName: 'โทรศัพท์', months: 3 },
        card: { id: 'c1', name: 'บัตร A', color: '#22c1a4' }
      })
    ]);
    const pill = screen.getByRole('button', { name: '✓ ชำระแล้ว' });
    expect(pill).toHaveClass('text-pos');
    const card = pill.closest('div') as HTMLElement;
    expect(card.style.opacity).toBe('');
    expect(card.className).not.toMatch(/opacity/);
    expect(card).toHaveTextContent('✓');
  });

  it('marks an overdue unpaid day with the warning prefix', () => {
    renderCalendar([expense({})]);
    expect(screen.getByText('⚠ 10')).toBeInTheDocument();
  });

  it('hides the selected-day event list when showDayDetail is false but keeps the grid', () => {
    renderCalendar([expense({})], { showDayDetail: false });
    expect(screen.queryByText('ค่าไฟ')).not.toBeInTheDocument();
    expect(screen.queryByText(/ไม่มีรายการ/)).not.toBeInTheDocument();
    expect(screen.getByText('⚠ 10')).toBeInTheDocument();
  });

  it('renders no .dayDetail element when showDayDetail is false and nothing is unscheduled (FIX-AC-3)', () => {
    const { container } = renderCalendar([expense({})], { showDayDetail: false });
    expect(container.querySelector('.dayDetail')).toBeNull();
  });

  it('still renders .dayDetail with only the tray when showDayDetail is false but unscheduled exist', () => {
    const { container } = renderCalendar([expense({})], {
      showDayDetail: false,
      unscheduledEvents: [expense({ key: 'u1', name: 'ไม่ระบุวัน' })] as unknown as Props['unscheduledEvents']
    });
    const detail = container.querySelector('.dayDetail');
    expect(detail).not.toBeNull();
    expect(screen.getByRole('button', { name: /ไม่ระบุวันครบกำหนด \(1\)/ })).toBeInTheDocument();
    expect(detail!.querySelector('h3')).toBeNull();
    expect(screen.queryByText('ค่าไฟ')).not.toBeInTheDocument();
  });

  it('keeps .dayDetail by default (showDayDetail true)', () => {
    const { container } = renderCalendar([expense({})]);
    expect(container.querySelector('.dayDetail')).not.toBeNull();
    expect(screen.getByText('ค่าไฟ')).toBeInTheDocument();
  });

  it('gives a card-less event card a default left border and no inline colour', () => {
    renderCalendar([expense({})]);
    const card = screen.getByText('ค่าไฟ').closest('div')!.parentElement as HTMLElement;
    expect(card).toHaveClass('border-l-border-default');
    expect(card.style.borderLeftColor).toBe('');
  });

  it('keeps the card colour on the left border and outlines every colour chip', () => {
    const { container } = renderCalendar(
      [expense({ card: { id: 'c1', name: 'บัตร A', color: '#4e2a84' } })],
      { cards: [{ id: 'c1', name: 'บัตร A', color: '#4e2a84' }] as Props['cards'] }
    );
    const card = screen.getByText('ค่าไฟ').closest('div')!.parentElement as HTMLElement;
    expect(card.style.borderLeftColor).toBe('rgb(78, 42, 132)');
    const chips = container.querySelectorAll('span.rounded-xs');
    expect(chips.length).toBeGreaterThan(0);
    chips.forEach(chip => expect(chip).toHaveClass('ring-tertiary'));
  });
});

describe('overlay layering above the mobile nav', () => {
  it('puts the calendar modal backdrop at z-[110]', () => {
    const { container } = render(<ExpenseCalendarModal open onClose={jest.fn()} />);
    expect(container.firstChild).toHaveClass('z-[110]');
  });

  it('puts the confirm dialog backdrop at z-[120] with surface-3 panel', () => {
    const { container } = render(
      <RevolvingConfirmDialog open dialogRef={{ current: null }} busy={false} cardName="บัตร A" onConfirm={jest.fn()} />
    );
    expect(container.firstChild).toHaveClass('z-[120]');
    expect(screen.getByRole('alertdialog')).toHaveClass('bg-surface-3');
  });
});
