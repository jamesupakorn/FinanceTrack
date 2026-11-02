// Bug: a stale spendRefreshKey/spendSavedMonth from an earlier save must not pull a freshly opened detail page off the
// default month. After the detail redesign the default month is the PAYABLE cycle (OQ-4), read from the switcher label.
// Covers AC-CD6, AC-CD30, AC-CD31, AC-CD32 plus the null-then-card default-month and monthTouched-reset amendments.
import { useEffect } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import CreditCardDetail from '../../src/frontend/components/CreditCardDetail';
import { getCurrentMonthKey, getPayableCycleMonth } from '../../src/shared/utils/creditCardUtils';

const hookSpy = jest.fn();
// committed (effect-time) month per card — render-phase calls that React discards do not count as fetches
const committedSpy = jest.fn();
jest.mock('../../src/shared/utils/frontend/useRevolvingCycle', () => {
  const actual = jest.requireActual('../../src/shared/utils/frontend/useRevolvingCycle');
  return {
    ...actual,
    useRevolvingCycle: (options: unknown) => {
      hookSpy(options);
      const { card: hookCard, month } = options as { card?: { id: string } | null; month: string };
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useEffect(() => { if (hookCard) committedSpy(month); }, [hookCard?.id, month]);
      return {
        status: 'ready', currentCycle: actual.EMPTY_CYCLE, previousMonthCycle: null, history: [], truncated: false,
        cardTotal: null, cashbackDraft: '', busy: false,
        changeCashbackDraft: jest.fn(), focusCashback: jest.fn(), blurCashback: jest.fn(),
        payFull: jest.fn(), payMinimum: jest.fn(), undoPayment: jest.fn(), retry: jest.fn()
      };
    }
  };
});
jest.mock('../../src/frontend/components/CreditSpendItems', () => ({ __esModule: true, default: () => null }));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false
    })
  });
});

beforeEach(() => { hookSpy.mockClear(); committedSpy.mockClear(); });
afterEach(() => jest.useRealTimers());

const card = { id: 'cc_x', name: 'บัตรทดสอบ', creditLimit: 20000, remainingPayable: 0, availableCredit: 20000, statementDay: 5, dueDay: 25 };
const eomCard = { ...card, id: 'cc_eom', statementDay: 'EOM', dueDay: 10 };
const shownMonth = () => document.querySelector('[data-month]')?.getAttribute('data-month');
const firstFetchedMonth = () => committedSpy.mock.calls[0]?.[0];
const freeze = (iso: string) => jest.useFakeTimers({ now: new Date(iso), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame'] });

describe('AC-CD6 stale-key guard (default month = payable cycle)', () => {
  it('mounting with a leftover spendRefreshKey > 0 stays on the payable cycle', () => {
    render(<CreditCardDetail card={card} plans={[]} spendRefreshKey={3} spendSavedMonth="2031-01" />);
    expect(shownMonth()).toBe(getPayableCycleMonth(card, getCurrentMonthKey()));
    expect(screen.getByText(/^รอบบิล /)).toBeInTheDocument();
  });

  it('a key change after mount switches to the saved month', () => {
    const { rerender } = render(<CreditCardDetail card={card} plans={[]} spendRefreshKey={0} spendSavedMonth={null} />);
    expect(shownMonth()).toBe(getPayableCycleMonth(card, getCurrentMonthKey()));
    rerender(<CreditCardDetail card={card} plans={[]} spendRefreshKey={1} spendSavedMonth="2031-01" />);
    expect(shownMonth()).toBe('2031-01');
  });

  it('offset-1 card (EOM/10, now 2026-11-05): the stale key keeps the PAYABLE month 2026-10', () => {
    freeze('2026-11-05T09:00:00');
    render(<CreditCardDetail card={eomCard} plans={[]} spendRefreshKey={3} spendSavedMonth="2031-01" />);
    expect(shownMonth()).toBe('2026-10');
  });
});

describe('AC-CD30 default month on open (system date 2026-11-05)', () => {
  beforeEach(() => freeze('2026-11-05T09:00:00'));

  it.each([
    ['EOM / due 10', 'EOM', 10, '2026-10'],
    ['statement 5 / due 25', 5, 25, '2026-11'],
    ['statement 25 / due 10', 25, 10, '2026-10'],
    ['invalid days (offset 0 fallback)', 'abc', 'abc', '2026-11']
  ])('%s opens on %s', (_label, statementDay, dueDay, expected) => {
    render(<CreditCardDetail card={{ ...card, statementDay: statementDay as never, dueDay: dueDay as never }} plans={[]} />);
    expect(shownMonth()).toBe(expected);
    expect(firstFetchedMonth()).toBe(expected);
  });

  it('shows the payable badge and the "รอบที่ต้องชำระ" reset only after leaving the payable cycle', () => {
    render(<CreditCardDetail card={eomCard} plans={[]} />);
    expect(screen.getByText('ต้องชำระเดือนนี้')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /กลับไปรอบบิลที่ต้องชำระ/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /เดือนถัดไป/ }));
    expect(shownMonth()).toBe('2026-11');
    expect(screen.queryByText('ต้องชำระเดือนนี้')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'กลับไปรอบบิลที่ต้องชำระ (ต.ค. 2569)' }));
    expect(shownMonth()).toBe('2026-10');
  });

  it('null then card: the default month is initialised when card.id first becomes a value (not locked to the calendar month)', () => {
    const { rerender } = render(<CreditCardDetail card={null} plans={[]} />);
    expect(screen.getByText('ไม่พบบัตรใบนี้')).toBeInTheDocument();
    rerender(<CreditCardDetail card={eomCard} plans={[]} />);
    expect(shownMonth()).toBe('2026-10');
    // the calendar month was never committed (and so never fetched) for this card
    expect(committedSpy.mock.calls.map(call => call[0])).toEqual(['2026-10']);
  });
});

describe('AC-CD31 add-flow month (DD-7), EOM/10 card at 2026-11-05', () => {
  beforeEach(() => freeze('2026-11-05T09:00:00'));

  it('passes the calendar month until the user navigates, then the viewed month; the reset button restores the calendar month', () => {
    const onAddPlanForCard = jest.fn();
    render(<CreditCardDetail card={eomCard} plans={[]} onAddPlanForCard={onAddPlanForCard} />);
    const add = () => fireEvent.click(screen.getByRole('button', { name: 'เพิ่มรายจ่าย' }));
    add();
    expect(onAddPlanForCard).toHaveBeenLastCalledWith(eomCard, '2026-11');
    fireEvent.click(screen.getByRole('button', { name: /เดือนก่อนหน้า/ }));
    add();
    expect(onAddPlanForCard).toHaveBeenLastCalledWith(eomCard, '2026-09');
    fireEvent.click(screen.getByRole('button', { name: /กลับไปรอบบิลที่ต้องชำระ/ }));
    add();
    expect(onAddPlanForCard).toHaveBeenLastCalledWith(eomCard, '2026-11');
  });

  it('a save-driven month switch counts as navigation', () => {
    const onAddPlanForCard = jest.fn();
    const { rerender } = render(<CreditCardDetail card={eomCard} plans={[]} onAddPlanForCard={onAddPlanForCard} spendRefreshKey={0} />);
    rerender(<CreditCardDetail card={eomCard} plans={[]} onAddPlanForCard={onAddPlanForCard} spendRefreshKey={1} spendSavedMonth="2026-12" />);
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มรายจ่าย' }));
    expect(onAddPlanForCard).toHaveBeenLastCalledWith(eomCard, '2026-12');
  });

  it('M-1: a save that lands in the viewed month does not set monthTouched', () => {
    const onAddPlanForCard = jest.fn();
    const { rerender } = render(<CreditCardDetail card={eomCard} plans={[]} onAddPlanForCard={onAddPlanForCard} spendRefreshKey={0} />);
    const viewed = shownMonth() as string;
    rerender(<CreditCardDetail card={eomCard} plans={[]} onAddPlanForCard={onAddPlanForCard} spendRefreshKey={1} spendSavedMonth={viewed} spendSavedItemId="new" />);
    expect(shownMonth()).toBe(viewed);
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มรายจ่าย' }));
    expect(onAddPlanForCard).toHaveBeenLastCalledWith(eomCard, '2026-11');
  });

  it('M-1: a same-month save leaves focus on the opener', () => {
    const { rerender } = render(<CreditCardDetail card={eomCard} plans={[]} spendRefreshKey={0} />);
    const opener = screen.getByRole('button', { name: 'เพิ่มรายจ่าย' });
    opener.focus();
    rerender(<CreditCardDetail card={eomCard} plans={[]} spendRefreshKey={1} spendSavedMonth={shownMonth()} spendSavedItemId="new" />);
    expect(document.activeElement).toBe(opener);
  });
});

describe('AC-CD32 card switch (DD-8)', () => {
  beforeEach(() => freeze('2026-11-05T09:00:00'));

  it('a different card.id resets the month to that card\'s payable cycle', () => {
    const { rerender } = render(<CreditCardDetail card={card} plans={[]} />);
    expect(shownMonth()).toBe('2026-11');
    rerender(<CreditCardDetail card={eomCard} plans={[]} />);
    expect(shownMonth()).toBe('2026-10');
  });

  it('the same card with a new object identity (loadData refresh) keeps the navigated month', () => {
    const { rerender } = render(<CreditCardDetail card={eomCard} plans={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /เดือนก่อนหน้า/ }));
    expect(shownMonth()).toBe('2026-09');
    rerender(<CreditCardDetail card={{ ...eomCard }} plans={[]} />);
    expect(shownMonth()).toBe('2026-09');
  });

  it('monthTouched resets with the card: after navigating on card A, card B adds with the calendar month again', () => {
    const onAddPlanForCard = jest.fn();
    const { rerender } = render(<CreditCardDetail card={eomCard} plans={[]} onAddPlanForCard={onAddPlanForCard} />);
    fireEvent.click(screen.getByRole('button', { name: /เดือนก่อนหน้า/ }));
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มรายจ่าย' }));
    expect(onAddPlanForCard).toHaveBeenLastCalledWith(eomCard, '2026-09');
    rerender(<CreditCardDetail card={card} plans={[]} onAddPlanForCard={onAddPlanForCard} />);
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มรายจ่าย' }));
    expect(onAddPlanForCard).toHaveBeenLastCalledWith(card, '2026-11');
  });

  it('s-1: card A -> no card -> card B resets the month and monthTouched', () => {
    const onAddPlanForCard = jest.fn();
    const { rerender } = render(<CreditCardDetail card={eomCard} plans={[]} onAddPlanForCard={onAddPlanForCard} />);
    fireEvent.click(screen.getByRole('button', { name: /เดือนก่อนหน้า/ }));
    expect(shownMonth()).toBe('2026-09');
    rerender(<CreditCardDetail card={null} plans={[]} onAddPlanForCard={onAddPlanForCard} />);
    rerender(<CreditCardDetail card={card} plans={[]} onAddPlanForCard={onAddPlanForCard} />);
    expect(shownMonth()).toBe('2026-11');
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มรายจ่าย' }));
    expect(onAddPlanForCard).toHaveBeenLastCalledWith(card, '2026-11');
  });
});
